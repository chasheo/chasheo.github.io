"""Durable, anonymous visitor statistics and plain-text guestbook."""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import hmac
import secrets
import sqlite3
import time
import uuid


class RateLimited(ValueError):
    pass


class VisitorIdentity:
    """An anonymous capability that works when third-party cookies are blocked."""

    def __init__(self, key_path: Path):
        key_path = Path(key_path)
        key_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with key_path.open('xb') as key_file:
                key_file.write(secrets.token_bytes(32))
        except FileExistsError:
            pass
        self.key = key_path.read_bytes()
        if len(self.key) != 32:
            raise ValueError('Visitor identity signing key is invalid.')

    def issue(self, visitor_id=None):
        visitor_id = visitor_id or secrets.token_hex(24)
        payload = 'v1.' + visitor_id
        signature = hmac.new(self.key, payload.encode(), hashlib.sha256).hexdigest()
        return payload + '.' + signature

    def verify(self, token):
        if not isinstance(token, str) or len(token) != 116:
            return None
        version, visitor_id, signature = token.split('.') if token.count('.') == 2 else ('', '', '')
        if (version != 'v1' or len(visitor_id) != 48 or len(signature) != 64
                or any(c not in '0123456789abcdef' for c in visitor_id + signature)):
            return None
        expected = self.issue(visitor_id).rsplit('.', 1)[1]
        return visitor_id if hmac.compare_digest(signature, expected) else None


class Community:
    def __init__(self, path: Path, *, clock=time.time):
        self.path, self.clock = Path(path), clock
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS visits (
                    event_id TEXT PRIMARY KEY, visitor TEXT NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS plays (
                    session_id TEXT PRIMARY KEY, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS comments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    visitor TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL,
                    created REAL NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
                CREATE INDEX IF NOT EXISTS comments_visitor_time ON comments(visitor, created);
                CREATE TABLE IF NOT EXISTS game_likes (
                    game_id TEXT NOT NULL, visitor TEXT NOT NULL, created REAL NOT NULL,
                    PRIMARY KEY (game_id, visitor));
            ''')

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def stats(self):
        with self.connection() as db:
            return {'visits': db.execute('SELECT count(*) FROM visits').fetchone()[0],
                    'visitors': db.execute('SELECT count(DISTINCT visitor) FROM visits').fetchone()[0],
                    'plays': db.execute('SELECT count(*) FROM plays').fetchone()[0],
                    'comments': db.execute('SELECT count(*) FROM comments WHERE deleted=0').fetchone()[0]}

    def visit(self, event_id, visitor):
        try:
            event_id = uuid.UUID(str(event_id)).hex
        except (ValueError, TypeError, AttributeError):
            raise ValueError('访问记录格式不正确。') from None
        with self.connection() as db:
            db.execute('INSERT OR IGNORE INTO visits VALUES (?,?,?)', (event_id, visitor, self.clock()))
        return self.stats()

    def play(self, session_id):
        with self.connection() as db:
            db.execute('INSERT OR IGNORE INTO plays VALUES (?,?)', (session_id, self.clock()))
        return self.stats()

    def game_likes(self, game_id, visitor):
        with self.connection() as db:
            count = db.execute('SELECT count(*) FROM game_likes WHERE game_id=?', (game_id,)).fetchone()[0]
            liked = bool(visitor and db.execute('SELECT 1 FROM game_likes WHERE game_id=? AND visitor=?', (game_id, visitor)).fetchone())
        return {'likes': count, 'liked': liked}

    def set_game_like(self, game_id, visitor, liked):
        if not isinstance(liked, bool):
            raise ValueError('点赞状态不正确。')
        with self.connection() as db:
            if liked:
                db.execute('INSERT OR IGNORE INTO game_likes VALUES (?,?,?)', (game_id, visitor, self.clock()))
            else:
                db.execute('DELETE FROM game_likes WHERE game_id=? AND visitor=?', (game_id, visitor))
        return self.game_likes(game_id, visitor)

    def comments(self, visitor, before=None):
        before = int(before) if before is not None else 2**63 - 1
        if not 1 <= before <= 2**63 - 1:
            raise ValueError('留言页码不正确。')
        with self.connection() as db:
            rows = db.execute('SELECT * FROM comments WHERE deleted=0 AND id<? ORDER BY id DESC LIMIT 13',
                              (before,)).fetchall()
        return {'items': [self.public(row, visitor) for row in rows[:12]],
                'next': rows[11]['id'] if len(rows) > 12 else None}

    @staticmethod
    def public(row, visitor):
        return {'id': row['id'], 'name': row['name'], 'body': row['body'],
                'created_at': datetime.fromtimestamp(row['created'], timezone.utc).isoformat(),
                'is_own': row['visitor'] == visitor}

    def post(self, visitor, name, body, website=''):
        if not isinstance(name, str) or not isinstance(body, str) or website:
            raise ValueError('留言格式不正确。')
        name, body = name.strip() or '一位旅人', body.strip()
        if len(name) > 24 or not 1 <= len(body) <= 600 or '\0' in body or '\0' in name:
            raise ValueError('昵称最多 24 字，留言请填写 1～600 字。')
        now = self.clock()
        with self.connection() as db:
            # Serialize the rate check and insert, including concurrent requests.
            db.execute('BEGIN IMMEDIATE')
            last = db.execute('SELECT max(created) FROM comments WHERE visitor=?', (visitor,)).fetchone()[0]
            if last is not None and now - last < 30:
                raise RateLimited('刚刚已经留下足迹，请稍等 30 秒再发言。')
            cursor = db.execute('INSERT INTO comments(visitor,name,body,created) VALUES(?,?,?,?)',
                                (visitor, name, body, now))
            row = db.execute('SELECT * FROM comments WHERE id=?', (cursor.lastrowid,)).fetchone()
        return self.public(row, visitor)

    def delete(self, comment_id, visitor):
        if not 1 <= comment_id <= 2**63 - 1:
            raise ValueError('留言编号不正确。')
        with self.connection() as db:
            row = db.execute('SELECT visitor FROM comments WHERE id=? AND deleted=0', (comment_id,)).fetchone()
            if not row or row['visitor'] != visitor:
                raise ValueError('只能收回这个浏览器自己留下的留言。')
            db.execute('UPDATE comments SET deleted=1 WHERE id=?', (comment_id,))
        return self.stats()
