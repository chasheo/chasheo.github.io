// Fixed public entry point; queue, credentials and process ownership stay in the local gateway.
const API_METHODS = new Map([
  ['health', ['GET', 'HEAD']], ['join', ['POST']], ['session', ['GET']],
  ['heartbeat', ['POST']], ['claim', ['POST']], ['leave', ['POST']],
  ['stream-ticket', ['POST']], ['visitor', ['POST']], ['stats', ['GET', 'HEAD']],
  ['visit', ['POST']], ['comments', ['GET', 'POST']], ['play-start', ['POST']]
]);
const SITE_ORIGIN = 'https://chasheo.github.io';

function reply(request, status, message, allowOrigin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
  if (allowOrigin) {
    headers['Access-Control-Allow-Origin'] = request.headers.get('Origin');
    headers.Vary = 'Origin';
  }
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowedOrigin = Boolean(origin && (origin === SITE_ORIGIN || origin === url.origin));
    if (origin && !allowedOrigin) return reply(request, 403, '此来源未被允许访问游戏。', false);

    const endpoint = url.pathname.startsWith('/api/') ? url.pathname.slice(5) : '';
    const methods = /^comments\/[1-9]\d*$/.test(endpoint) ? ['DELETE'] : API_METHODS.get(endpoint);
    const isStream = url.pathname === '/stream';
    if (!methods && !isStream) return reply(request, 404, '此入口仅提供游戏连接与社区服务。', allowedOrigin);
    const validMethod = isStream ? request.method === 'GET'
      : methods.includes(request.method) || request.method === 'OPTIONS';
    if (!validMethod) return reply(request, 405, '此请求方法未开放。', allowedOrigin);

    const target = new URL('http://chasheo.internal');
    target.pathname = url.pathname;
    target.search = url.search;
    const forwarded = new Request(target, request);
    forwarded.headers.delete('Host');
    try {
      // Return the response directly so a WebSocket upgrade remains attached to its socket.
      return await env.GAME_HOST.fetch(forwarded);
    } catch {
      // Do not log the request URL, admission ticket, headers, or provider exception.
      return reply(request, 503, '世界服务暂时离线，请稍后重试。', allowedOrigin);
    }
  }
};
