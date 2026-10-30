"""Real Windows game lifecycle check; keeps the next visitor alive for 120 seconds.

Run against an idle local host. Tokens remain in memory and never enter the receipt.
"""
import asyncio
import argparse
import ctypes
from ctypes import wintypes
from contextlib import AsyncExitStack
import json
from pathlib import Path
import re
import time

import aiohttp
import psutil

BASE = 'http://127.0.0.1:18790'
ORIGIN = 'https://chasheo.github.io'
RUNTIME = Path(__file__).resolve().parents[1] / '.local.json'
RUNTIME = Path(json.loads(RUNTIME.read_text())['runtime_dir'])


async def verify():
    receipt = {'heartbeat_timeout': 120, 'base_url': BASE, 'checks': {}, 'events': [], 'status': 'running'}
    evidence = RUNTIME / 'evidence'
    evidence.mkdir(exist_ok=True)

    def event(name, **facts):
        entry = {'event': name, **facts}
        receipt['events'].append(entry)
        (evidence / 'lifecycle.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(entry, ensure_ascii=False), flush=True)

    def game_processes():
        # Windows can briefly enumerate an exited process while another observer
        # holds its handle. Count running processes, not signalled kernel objects.
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        def running(pid):
            handle = kernel.OpenProcess(0x100000, False, pid)
            if not handle:
                return False
            try:
                return kernel.WaitForSingleObject(handle, 0) == 258
            finally:
                kernel.CloseHandle(handle)
        return [p.pid for p in psutil.process_iter(['name', 'exe'])
                if p.info['name'] == 'MCPGameProject.exe' and p.info['exe']
                and 'chasheo-demo' in p.info['exe'] and running(p.pid)]

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15), headers={'Origin': ORIGIN}) as http, AsyncExitStack() as cleanup:
        async def call(path, token='', method='POST', expect=200):
            async with http.request(method, BASE + '/api/' + path,
                                    headers={'Authorization': 'Bearer ' + token} if token else {}) as response:
                body = await response.json()
                assert response.status == expect, (path, response.status, body.get('error'))
                return body

        health = await call('health', method='GET')
        assert health['heartbeat_timeout'] == 120 and not health['busy'] and not health['waiting']
        a = await call('join')
        b = await call('join')
        at, bt = a.pop('token'), b.pop('token')
        async def release(owned):
            try:
                await call('leave', owned)
            except (aiohttp.ClientError, asyncio.TimeoutError):
                pass
        cleanup.push_async_callback(release, at)
        cleanup.push_async_callback(release, bt)
        assert a['state'] == 'offered' and b['state'] == 'waiting'
        await call('claim', at)
        await call('claim', at)  # idempotent double-click
        await call('claim', bt, expect=409)
        await call('stream-ticket', bt, expect=409)
        async with http.get(BASE + '/stream?ticket=invalid') as response:
            assert response.status == 409
        async with http.post(BASE + '/api/join', headers={'Origin': 'https://untrusted.example'}) as response:
            assert response.status == 403
        receipt['checks']['unauthorized_admission_rejected'] = True
        for _ in range(120):
            state = await call('heartbeat', at)
            await call('heartbeat', bt)
            assert len(game_processes()) <= 1
            if state['state'] == 'ready':
                break
            assert state['state'] == 'starting', state
            await asyncio.sleep(1)
        else:
            raise AssertionError('Game did not become ready')
        first_pid = game_processes()
        assert len(first_pid) == 1
        admission = await call('stream-ticket', at)
        stream = await http.ws_connect(BASE + '/stream?ticket=' + admission['ticket'])
        async with http.get(BASE + '/stream?ticket=' + admission['ticket']) as response:
            assert response.status == 409
        async def drain():
            async for _ in stream:
                pass
        stream_task = asyncio.create_task(drain())
        receipt['checks']['stream_ticket_is_single_use'] = True
        await call('heartbeat', at)
        start = time.monotonic()
        event('last_active_player_heartbeat', game_pid=first_pid[0], next_visitor=b['id'])
        next_heartbeat = 0
        last_checkpoint = -1
        while True:
            elapsed = time.monotonic() - start
            if elapsed >= next_heartbeat:
                await call('heartbeat', bt)  # Must not extend a's lease.
                next_heartbeat += 15
            state = await call('session', at, method='GET')
            processes = game_processes()
            assert len(processes) <= 1
            if state['state'] == 'ended':
                assert elapsed >= 119.5, elapsed
                assert first_pid[0] not in processes
                event('heartbeat_expired_and_game_stopped', elapsed_seconds=round(elapsed, 2))
                receipt['expiry_elapsed_seconds'] = round(elapsed, 2)
                break
            assert elapsed < 126, 'Game did not stop at the expected timeout'
            if elapsed < 119:
                assert processes == first_pid
            checkpoint = int(elapsed // 30)
            if checkpoint != last_checkpoint:
                event('waiting_visitor_heartbeat_only', elapsed_seconds=round(elapsed, 2), game_pid=processes)
                last_checkpoint = checkpoint
            await asyncio.sleep(1)
        await call('stream-ticket', at, expect=409)
        # Allow Internet close-frame propagation independently from the exact server lease.
        closed_after = time.monotonic()
        await asyncio.wait_for(stream_task, 15)
        receipt['ws_close_confirmation_seconds'] = round(time.monotonic() - closed_after, 2)
        assert stream.closed
        receipt['checks']['stream_connection_revoked_on_expiry'] = True
        assert (await call('session', bt, method='GET'))['state'] == 'offered'
        receipt['checks']['real_120_second_expiry'] = True
        receipt['checks']['waiting_heartbeat_did_not_renew_player'] = True
        await call('claim', bt)
        for _ in range(120):
            state = await call('heartbeat', bt)
            assert len(game_processes()) <= 1
            if state['state'] == 'ready':
                break
            await asyncio.sleep(1)
        else:
            raise AssertionError('Next visitor did not become ready')
        second_pid = game_processes()
        assert len(second_pid) == 1 and second_pid != first_pid
        assert (await call('heartbeat', at))['state'] == 'ended'
        await call('leave', at)
        assert (await call('session', bt, method='GET'))['state'] == 'ready'
        assert game_processes() == second_pid
        event('next_player_ready_old_token_has_no_effect', game_pid=second_pid[0])
        receipt['checks']['single_instance_and_handoff'] = True
        receipt['checks']['stale_token_did_not_affect_next_player'] = True
        await call('leave', bt)
        assert not game_processes()
        assert not (await call('health', method='GET'))['busy']
        receipt['checks']['explicit_exit_releases_game'] = True
        receipt['status'] = 'passed'
        evidence = RUNTIME / 'evidence'
        evidence.mkdir(exist_ok=True)
        (evidence / 'lifecycle.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
        event('verification_complete', status='passed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default=BASE)
    args = parser.parse_args()
    BASE = args.base_url.rstrip('/')
    asyncio.run(verify())
