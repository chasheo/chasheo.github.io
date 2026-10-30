"""Durable, anonymous visitor statistics and plain-text guestbook."""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import time
import uuid


class RateLimited(ValueError):
    pass


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
