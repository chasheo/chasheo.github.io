import uuid

import pytest

from server.community import Community, RateLimited


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
