from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
from pathlib import Path
import shutil

import aiohttp
from aiohttp import web

from .process import HostLock, WindowsJobProcess, current_process_receipt
from .sessions import Sessions
from .community import Community, RateLimited, VisitorIdentity
from .ice import IceConfiguration

ROOT = Path(__file__).resolve().parents[1]
LOG = logging.getLogger('demo.host')


def create_app(config: dict, *, process_factory=WindowsJobProcess) -> web.Application:
    runtime = Path(config['runtime_dir']).resolve()
    runtime.mkdir(parents=True, exist_ok=True)
    entries = config.get('games') or [{'id': 'mystic-forest', 'title': 'Mystic Forest',
        'description': '在雾气与光之间，探索森林中的未知。', 'image': '/media/forest-portal.png',
        'image_label': '世界概念视觉', 'images': [{'url': '/media/mystic-forest-browser.png', 'label': '实机画面 · 浏览器截图'}],
        'executable': config['game_executable'], 'cwd': config.get('game_cwd')}]
    games = {}
    for entry in entries:
        game_id = entry.get('id', '')
        if not isinstance(game_id, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', game_id) or len(game_id) > 48 or game_id in games:
            raise ValueError('Game IDs must be unique lowercase slugs.')
        executable = Path(entry['executable']).resolve()
        if not executable.is_file():
            raise FileNotFoundError(f'Game executable not found: {executable}')
        games[game_id] = {**entry, 'executable': executable}
    signal_port = int(config.get('signal_port', 18791))
    streamer_port = int(config.get('streamer_port', 18888))
    signal_base = f'http://127.0.0.1:{signal_port}'
    # Community records are durable user data, independent from disposable demo logs/packages.
    data_dir = Path(config.get('data_dir') or Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'chasheo-worlds')
    community = Community(data_dir / 'community.sqlite3')
    identities = VisitorIdentity(data_dir / 'visitor-signing.key')
    ice = IceConfiguration(config, runtime)

    @web.middleware
    async def errors(request, handler):
        # Pages and the gateway have separate origins. Never use a wildcard for capabilities.
        origin = request.headers.get('Origin')
        allowed = {f'{request.scheme}://{request.host}', *config.get('allowed_origins', [])}
        if config.get('public_origin'):
            allowed.add(config['public_origin'])
        if origin and origin not in allowed:
            return web.json_response({'error': '此来源未被允许访问本机游戏。'}, status=403)
        try:
            if request.method == 'OPTIONS':
                requested_headers = {h.strip().lower() for h in request.headers.get('Access-Control-Request-Headers', '').split(',') if h.strip()}
                if (not origin or not request.path.startswith('/api/')
                        or request.headers.get('Access-Control-Request-Method') not in {'GET', 'POST', 'DELETE'}
                        or requested_headers - {'authorization', 'content-type', 'x-visitor-token'}):
                    raise web.HTTPForbidden(reason='Preflight request is not allowed.')
                response = web.Response(status=204, headers={
                    'Access-Control-Allow-Methods': 'GET, POST, DELETE',
                    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Visitor-Token',
                    'Access-Control-Max-Age': '600'})
            else:
                response = await handler(request)
        except RateLimited as error:
            response = web.json_response({'error': str(error)}, status=429)
        except ValueError as error:
            response = web.json_response({'error': str(error)}, status=409)
        except web.HTTPException as error:
            response = web.json_response({'error': error.reason}, status=error.status)
        if origin:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Vary'] = 'Origin'
        response.headers['Cache-Control'] = 'no-store' if request.path.startswith('/api/') else 'no-cache'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    app = web.Application(middlewares=[errors], client_max_size=4096)
    http = None

    def launch(session_id, game_id):
        game = games[game_id]
        executable = game['executable']
        argv = [str(executable), '-RenderOffscreen', '-AudioMixer', '-Unattended',
                '-Windowed', '-ForceRes', '-ResX=1920', '-ResY=1080',
                f'-PixelStreamingURL=ws://127.0.0.1:{streamer_port}',
                f'-PixelStreamingID={session_id}', '-PixelStreamingEnableOnLaunch',
                '-PixelStreamingWebRTCMaxFps=45', '-t.MaxFPS=45',
                '-PixelStreamingEncoderCodec=H264', '-PixelStreamingWebRTCMaxBitrate=15000000',
                '-PixelStreamingWebRTCStartBitrate=8000000', '-NoScreenMessages',
                '-log', f'-abslog={runtime / ("game-" + session_id + ".log")}']
        argv.extend(game.get('extra_args', config.get('game_extra_args', [])))
        return process_factory(argv, str(game.get('cwd') or executable.parent))

    async def ready(session_id):
        try:
            async with http.get(signal_base + '/streamers') as response:
                streamers = await response.json()
                return any(s.get('streamerId') == session_id for s in streamers)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
            return False

    async def prepare(_):
        await ice.prepare(http)

    manager = Sessions(launch, ready, prepare=prepare)
    app['sessions'] = manager
    app['community'] = community

    def visitor(request, required=True):
        header = request.headers.get('X-Visitor-Token', '')
        cookie = request.cookies.get('chasheo_visitor', '')
        who = identities.verify(header or cookie)
        # Preserve existing local authorship when upgrading the old HttpOnly cookie.
        if not header and len(cookie) == 48 and all(c in '0123456789abcdef' for c in cookie):
            who = cookie
        if not who and required:
            raise web.HTTPUnauthorized(reason='请刷新页面后重试，访客凭证已失效。')
        return who or ''

    async def identify(request):
        value = identities.issue(visitor(request, required=False) or None)
        response = web.json_response({'visitor_token': value})
        response.set_cookie('chasheo_visitor', value, max_age=31536000,
                            httponly=True, samesite='Lax', secure=request.secure)
        return response

    async def statistics(request):
        return web.json_response(community.stats())

    async def list_games(request):
        who = visitor(request, required=False)
        result = []
        for game_id, game in games.items():
            entry = {'id': game_id, 'title': str(game.get('title', game_id)),
                     'description': str(game.get('description', '')),
                     'image_label': str(game.get('image_label', '游戏视觉'))[:80]}
            for field in ('image', 'video', 'download_url'):
                value = game.get(field, '')
                if isinstance(value, str) and (value.startswith('https://') or (field != 'download_url' and value.startswith('/media/'))):
                    entry[field] = value
            images = game.get('images', [])
            if isinstance(images, list):
                entry['images'] = []
                for value in images[:12]:
                    url = value.get('url', '') if isinstance(value, dict) else value
                    label = value.get('label', '游戏图片') if isinstance(value, dict) else '游戏图片'
                    if isinstance(url, str) and (url.startswith('https://') or url.startswith('/media/')):
                        entry['images'].append({'url': url, 'label': str(label)[:80]})
            result.append({**entry, **community.game_likes(game_id, who)})
        return web.json_response({'games': result})

    async def like_game(request):
        game_id = request.match_info['id']
        if game_id not in games:
            raise web.HTTPNotFound(reason='没有找到这个游戏。')
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError('点赞状态不正确。')
        return web.json_response(community.set_game_like(game_id, visitor(request), body.get('liked')))

    async def visit(request):
        who = visitor(request)
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError('访问记录格式不正确。')
        return web.json_response(community.visit(body.get('event_id'), who))

    async def comments(request):
        return web.json_response(community.comments(visitor(request, required=False), request.query.get('before')))

    async def post_comment(request):
        who = visitor(request)
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError('留言格式不正确。')
        comment = community.post(who, body.get('name', ''), body.get('body', ''), body.get('website', ''))
        return web.json_response({'comment': comment, 'stats': community.stats()}, status=201)

    async def delete_comment(request):
        return web.json_response(community.delete(int(request.match_info['id']), visitor(request)))

    async def play_start(request):
        async with manager.lock:
            await manager.expire_active()
            s = manager.require(token(request))
            if manager.active is not s or s.state != 'ready' or not s.ws:
                raise ValueError('只有已连接游戏的当前玩家可以记录游玩。')
            return web.json_response(community.play(s.id))

    def token(request):
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            raise web.HTTPUnauthorized(text='A session token is required.')
        return header[7:]

    async def health(request):
        return web.json_response({'ok': not bool(manager.cleanup_error),
                                  'busy': manager.active is not None,
                                  'waiting': len(manager.queue),
                                  'capacity': 1, 'heartbeat_timeout': manager.heartbeat_timeout,
                                  'media_relay_configured': bool(config.get('cloudflare_turn_file') or config.get('ice_config_file')),
                                  'title': 'Mystic Forest', 'mode': 'public' if config.get('public_origin') else 'local'})

    async def join(request):
        old = request.headers.get('Authorization', '').removeprefix('Bearer ')
        key, state = await manager.join(old)
        return web.json_response({'token': key, **state})

    async def heartbeat(request):
        return web.json_response(await manager.status(token(request), heartbeat=True))

    async def status(request):
        return web.json_response(await manager.status(token(request)))

    async def claim(request):
        body = await request.json() if request.can_read_body else {}
        if not isinstance(body, dict):
            raise ValueError('请选择一个游戏。')
        game_id = body.get('game_id', next(iter(games)))
        if not isinstance(game_id, str) or game_id not in games:
            raise ValueError('所选游戏不可用，请重新选择。')
        return web.json_response(await manager.claim(token(request), game_id))

    async def leave(request):
        return web.json_response(await manager.leave(token(request)))

    async def ticket(request):
        key = await manager.ticket(token(request))
        return web.json_response({'ticket': key})

    async def stream(request):
        s = await manager.consume_ticket(request.query.get('ticket', ''))
        downstream = web.WebSocketResponse(heartbeat=20, timeout=3, max_msg_size=2**20)
        # Serialize admission with teardown, and invalidate an older connection of this same seat.
        async with manager.lock:
            if manager.active is not s or s.state != 'ready':
                raise ValueError('席位已过期，请重新加入。')
            if s.ws:
                await s.ws.close(code=4000, message=b'Replaced by reconnect')
            if s.upstream:
                await s.upstream.close()
            upstream = await http.ws_connect(signal_base, heartbeat=20, max_msg_size=2**20)
            await downstream.prepare(request)
            s.ws = downstream
            s.upstream = upstream

        async def relay(source, target):
            async for message in source:
                if message.type == aiohttp.WSMsgType.TEXT:
                    await target.send_str(message.data)
                elif message.type == aiohttp.WSMsgType.BINARY:
                    await target.send_bytes(message.data)
                elif message.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.ERROR):
                    break

        tasks = [asyncio.create_task(relay(downstream, upstream)),
                 asyncio.create_task(relay(upstream, downstream))]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await upstream.close()
            await downstream.close()
            if s.ws is downstream:
                s.ws = None
            if s.upstream is upstream:
                s.upstream = None
        return downstream

    async def index(request):
        return web.FileResponse(ROOT / 'dist' / 'index.html')

    async def preflight(request):
        return web.Response(status=204)

    async def lifecycle(app):
        nonlocal http
        host_lock = HostLock(runtime / 'host.lock')
        ice.initialize()
        (runtime / 'service.json').write_text(json.dumps(current_process_receipt()), encoding='utf-8')
        signal = None
        tick_task = None
        http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=3))
        try:
            node = shutil.which('node')
            if not node:
                raise RuntimeError('Node.js is required for Pixel Streaming signalling.')
            # Pass a private file path, never permanent keys or credentials in arguments.
            old = {k: os.environ.get(k) for k in ('DEMO_SIGNAL_PORT', 'DEMO_STREAMER_PORT', 'DEMO_ICE_CONFIG')}
            os.environ['DEMO_SIGNAL_PORT'], os.environ['DEMO_STREAMER_PORT'] = str(signal_port), str(streamer_port)
            os.environ['DEMO_ICE_CONFIG'] = str(ice.path)
            try:
                signal = process_factory([node, str(ROOT / 'server' / 'signalling.cjs')], str(ROOT))
            finally:
                for key, value in old.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value
            for _ in range(40):
                if signal.poll() is not None:
                    raise RuntimeError('Signalling process exited during startup.')
                try:
                    async with http.get(signal_base + '/health') as response:
                        if response.status == 200:
                            break
                except (aiohttp.ClientError, asyncio.TimeoutError):
                    pass
                await asyncio.sleep(0.25)
            else:
                raise RuntimeError('Signalling service did not become ready.')

            async def watchdog():
                while True:
                    if signal.poll() is not None:
                        async with manager.lock:
                            manager.cleanup_error = 'Signalling service stopped.'
                            if manager.active:
                                await manager.finish(manager.active, '推流服务已停止。')
                        LOG.error('Signalling stopped; admission disabled')
                        return
                    await manager.tick()
                    await asyncio.sleep(0.5)

            tick_task = asyncio.create_task(watchdog())
            LOG.info('Host ready: one game seat, heartbeat timeout=%s seconds', manager.heartbeat_timeout)
            yield
        finally:
            if tick_task:
                tick_task.cancel()
                await asyncio.gather(tick_task, return_exceptions=True)
            await manager.shutdown()
            await http.close()
            if signal:
                await asyncio.to_thread(signal.stop)
            host_lock.close()

    app.cleanup_ctx.append(lifecycle)
    app.add_routes([web.get('/api/health', health), web.post('/api/join', join),
                    web.get('/api/games', list_games), web.post('/api/games/{id:[a-z0-9-]+}/like', like_game),
                    web.post('/api/visitor', identify),
                    web.get('/api/stats', statistics), web.post('/api/visit', visit),
                    web.get('/api/comments', comments), web.post('/api/comments', post_comment),
                    web.delete('/api/comments/{id:\\d+}', delete_comment),
                    web.post('/api/play-start', play_start),
                    web.get('/api/session', status), web.post('/api/heartbeat', heartbeat),
                    web.post('/api/claim', claim), web.post('/api/leave', leave),
                    web.post('/api/stream-ticket', ticket), web.get('/stream', stream),
                    web.get('/', index), web.options('/{path:.*}', preflight)])
    app.router.add_static('/assets', ROOT / 'dist' / 'assets', show_index=False)
    app.router.add_static('/media', ROOT / 'dist' / 'media', show_index=False)
    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default=str(ROOT / '.local.json'))
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', default=18790, type=int)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding='utf-8-sig'))
    runtime = Path(config['runtime_dir'])
    runtime.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s',
                        handlers=[logging.FileHandler(runtime / 'host.log', encoding='utf-8')])
    # Access logs are deliberately off: admission tickets never enter request logs.
    web.run_app(create_app(config), host=args.host, port=args.port, access_log=None)


if __name__ == '__main__':
    main()
