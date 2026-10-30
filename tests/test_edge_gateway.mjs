import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../edge/gateway.mjs';

const BASE = 'https://chasheo-home-gateway.personal.workers.dev';
const ORIGIN = 'https://chasheo.github.io';

test('forwards the session capability, visitor capability, JSON body and request path', async () => {
  const expected = new Response('{"state":"ready"}', { headers: { 'Content-Type': 'application/json' } });
  let forwarded;
  const result = await gateway.fetch(new Request(BASE + '/api/comments?before=99', {
    method: 'POST', headers: { Origin: ORIGIN, Authorization: 'Bearer test-session',
      'X-Visitor-Token': 'test-visitor', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: '<script>plain text</script>' })
  }), { GAME_HOST: { async fetch(request) { forwarded = request; return expected; } } });
  assert.equal(result, expected);
  assert.equal(forwarded.url, 'http://chasheo.internal/api/comments?before=99');
  assert.equal(forwarded.headers.get('Authorization'), 'Bearer test-session');
  assert.equal(forwarded.headers.get('X-Visitor-Token'), 'test-visitor');
  assert.equal(forwarded.headers.get('Origin'), ORIGIN);
  assert.deepEqual(await forwarded.json(), { body: '<script>plain text</script>' });
});

test('passes WebSocket headers and the single-use ticket without wrapping the upgrade response', async () => {
  const upgraded = { status: 101, webSocket: { testSocket: true } };
  const result = await gateway.fetch(new Request(BASE + '/stream?ticket=test-ticket', {
    headers: { Origin: ORIGIN, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'test-protocol' }
  }), { GAME_HOST: { async fetch(request) {
    assert.equal(request.url, 'http://chasheo.internal/stream?ticket=test-ticket');
    assert.equal(request.headers.get('Upgrade'), 'websocket');
    assert.equal(request.headers.get('Sec-WebSocket-Protocol'), 'test-protocol');
    return upgraded;
  } } });
  assert.equal(result, upgraded);
});

test('forwards cross-origin preflight intact to the authoritative gateway', async () => {
  const result = await gateway.fetch(new Request(BASE + '/api/comments', {
    method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, x-visitor-token, content-type' }
  }), { GAME_HOST: { async fetch(request) {
    assert.equal(request.method, 'OPTIONS');
    assert.equal(request.headers.get('Access-Control-Request-Headers'), 'authorization, x-visitor-token, content-type');
    return new Response(null, { status: 204 });
  } } });
  assert.equal(result.status, 204);
});

test('rejects unrelated origins, private paths and unlisted API methods without reaching the host', async () => {
  const env = { GAME_HOST: { fetch() { assert.fail('Private host should not be called'); } } };
  for (const [path, method, origin, expected] of [
    ['/api/join', 'POST', 'https://untrusted.example', 403],
    ['/assets/private-file', 'GET', ORIGIN, 404],
    ['/api/admin', 'GET', ORIGIN, 404],
    ['/api/comments/10', 'GET', ORIGIN, 405],
    ['/stream', 'POST', ORIGIN, 405],
    ['/api/comments/0', 'DELETE', ORIGIN, 404]
  ]) {
    const response = await gateway.fetch(new Request(BASE + path, { method, headers: { Origin: origin } }), env);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), expected === 403 ? null : ORIGIN);
  }
});

test('host failure returns a readable uncached error without exposing a ticket or exception', async () => {
  const response = await gateway.fetch(new Request(BASE + '/stream?ticket=private-test-ticket', {
    headers: { Origin: ORIGIN }
  }), { GAME_HOST: { async fetch() { throw new Error('secret exception'); } } });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const body = await response.text();
  assert.ok(!body.includes('private-test-ticket') && !body.includes('secret exception'));
});
