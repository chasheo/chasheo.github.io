import asyncio
import uuid

import pytest

from server.community import Community, RateLimited, VisitorIdentity


def test_real_counts_are_durable_and_network_retries_do_not_inflate_them(tmp_path):
    path = tmp_path / 'community.sqlite3'
    db = Community(path)
    assert db.stats() == dict(visits=0, visitors=0, plays=0, comments=0)
    event = str(uuid.uuid4())
    db.visit(event, 'alice')
    db.visit(event.upper(), 'alice')
    db.visit(str(uuid.uuid4()), 'alice')
    db.visit(str(uuid.uuid4()), 'bob')
    db.play('game-a')
    db.play('game-a')  # refresh / reconnect is still the same run
    db.play('game-b')
    assert Community(path).stats() == dict(visits=3, visitors=2, plays=2, comments=0)


def test_comments_remain_plain_text_and_can_only_be_retracted_by_their_author(tmp_path):
    db = Community(tmp_path / 'community.sqlite3')
    body = '<img src=x onerror="alert(1)">\n这段文字应该原样保存。'
    comment = db.post('alice', '  旅人 A  ', body)
    assert comment['name'] == '旅人 A' and comment['body'] == body
    assert db.comments('alice')['items'][0]['is_own']
    assert not db.comments('bob')['items'][0]['is_own']
    with pytest.raises(ValueError):
        db.delete(comment['id'], 'bob')
    assert db.stats()['comments'] == 1
    db.delete(comment['id'], 'alice')
    assert db.stats()['comments'] == 0 and not db.comments('alice')['items']
    with db.connection() as connection:
        assert connection.execute('SELECT deleted FROM comments').fetchone()[0] == 1


def test_comment_rate_limit_survives_restarts_and_deletion(tmp_path):
    now = [1000.0]
    path = tmp_path / 'community.sqlite3'
    db = Community(path, clock=lambda: now[0])
    comment = db.post('alice', '', '第一条')
    assert comment['name'] == '一位旅人'
    db.delete(comment['id'], 'alice')
    now[0] += 29.99
    with pytest.raises(RateLimited):
        Community(path, clock=lambda: now[0]).post('alice', '', '不能通过删除绕过频率限制')
    now[0] += .01
    db.post('alice', '', '30 秒后可以继续发言')
    assert db.stats()['comments'] == 1


def test_comments_have_stable_pagination_without_duplicates(tmp_path):
    now = [1000.0]
    db = Community(tmp_path / 'community.sqlite3', clock=lambda: now[0])
    for i in range(15):
        db.post(f'visitor-{i}', '', f'comment-{i}')
    first = db.comments('viewer')
    second = db.comments('viewer', first['next'])
    assert len(first['items']) == 12 and len(second['items']) == 3
    assert second['next'] is None
    assert len({row['id'] for row in first['items'] + second['items']}) == 15


@pytest.mark.parametrize('name,body,website', [('x' * 25, 'hello', ''), ('ok', ' ', ''),
    ('ok', 'x' * 601, ''), ('ok', 'text\0', ''), ('ok', 'hello', 'spam.example')])
def test_invalid_or_honeypot_comments_do_not_create_records(tmp_path, name, body, website):
    db = Community(tmp_path / 'community.sqlite3')
    with pytest.raises(ValueError):
        db.post('visitor', name, body, website)
    assert db.stats()['comments'] == 0


def test_visitor_capability_survives_restart_and_rejects_forgery(tmp_path):
    key = tmp_path / 'visitor-signing.key'
    first = VisitorIdentity(key)
    token = first.issue()
    assert VisitorIdentity(key).verify(token) == first.verify(token)
    assert first.verify(first.issue()) != first.verify(token)
    parts = token.split('.')
    parts[1] = 'f' * 48
    assert first.verify('.'.join(parts)) is None
    assert first.verify(token[:-1] + '界') is None
    assert first.verify('f' * 48) is None


def test_github_pages_cors_and_comment_ownership_without_cookies(tmp_path, monkeypatch):
    from aiohttp import CookieJar
    from aiohttp.test_utils import TestClient, TestServer
    import server.app as gateway

    (tmp_path / 'dist' / 'assets').mkdir(parents=True)
    (tmp_path / 'dist' / 'media').mkdir()
    monkeypatch.setattr(gateway, 'ROOT', tmp_path)

    async def check():
        app = gateway.create_app({'runtime_dir': str(tmp_path / 'runtime'),
            'game_executable': __file__, 'data_dir': str(tmp_path / 'data'),
            'allowed_origins': ['https://chasheo.github.io']})
        # Exercise actual HTTP boundaries while keeping production process startup out of this test.
        app.cleanup_ctx.clear()
        async with TestClient(TestServer(app), cookie_jar=CookieJar()) as client:
            origin = {'Origin': 'https://chasheo.github.io'}
            preflight = await client.options('/api/comments', headers={**origin,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type, x-visitor-token, authorization'})
            assert preflight.status == 204
            assert preflight.headers['Access-Control-Allow-Origin'] == origin['Origin']
            assert preflight.headers['Vary'] == 'Origin'
            bad = await client.options('/api/comments', headers={**origin,
                'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-unexpected'})
            assert bad.status == 403
            denied = await client.post('/api/join', headers={'Origin': 'https://untrusted.example'})
            assert denied.status == 403 and 'Access-Control-Allow-Origin' not in denied.headers
            denied_ws = await client.get('/stream?ticket=invalid', headers={'Origin': 'https://untrusted.example'})
            assert denied_ws.status == 403
            unauthorized = await client.post('/api/comments', headers=origin, json={'body': 'no identity'})
            assert unauthorized.status == 401
            assert unauthorized.headers['Access-Control-Allow-Origin'] == origin['Origin']
            response = await client.post('/api/visitor', headers=origin)
            first = (await response.json())['visitor_token']
            assert not list(client.session.cookie_jar)  # IP host cookies are blocked, like third-party cookies.
            headers = {**origin, 'X-Visitor-Token': first}
            event = str(uuid.uuid4())
            for _ in range(2):
                response = await client.post('/api/visit', headers=headers, json={'event_id': event})
                assert response.status == 200
                assert (await response.json())['visits'] == 1
            response = await client.post('/api/comments', headers=headers, json={'name': 'Visitor', 'body': '<script>plain text</script>'})
            assert response.status == 201
            comment = (await response.json())['comment']
            response = await client.get('/api/comments', headers=headers)
            assert (await response.json())['items'][0]['is_own']
            response = await client.post('/api/visitor', headers=origin)
            second = (await response.json())['visitor_token']
            response = await client.delete(f'/api/comments/{comment["id"]}', headers={**origin, 'X-Visitor-Token': second})
            assert response.status == 409
            response = await client.delete(f'/api/comments/{comment["id"]}', headers=headers)
            assert response.status == 200 and (await response.json())['comments'] == 0
            response = await client.post('/api/visit', headers={**origin, 'X-Visitor-Token': first[:-1] + 'x'}, json={'event_id': str(uuid.uuid4())})
            assert response.status == 401
            response = await client.get('/api/health', headers=origin)
            assert (await response.json())['heartbeat_timeout'] == 120

    asyncio.run(check())
