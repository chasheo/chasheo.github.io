from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import logging
import secrets
import time
from typing import Callable

LOG = logging.getLogger('demo.sessions')


@dataclass
class Session:
    token: str
    id: str
    last_seen: float
    state: str = 'waiting'
    offer_until: float = 0
    reason: str = ''
    ended_at: float = 0
    ws: object | None = None
    upstream: object | None = None
    tickets: dict[str, float] = field(default_factory=dict)


class Sessions:
    def __init__(self, launch: Callable, ready: Callable, *, clock=time.monotonic,
                 heartbeat_timeout=180, queue_timeout=90, offer_timeout=30,
                 startup_timeout=120):
        self.launch, self.ready, self.clock = launch, ready, clock
        self.heartbeat_timeout = heartbeat_timeout
        self.queue_timeout, self.offer_timeout = queue_timeout, offer_timeout
        self.startup_timeout = startup_timeout
        self.lock = asyncio.Lock()
        self.sessions: dict[str, Session] = {}
        self.queue: list[Session] = []
        self.active: Session | None = None
        self.process = None
        self.task = None
        self.cleanup_error = ''
        self.launch_count = 0

    def require(self, token: str) -> Session:
        session = self.sessions.get(token)
        if not session:
            raise ValueError('会话已失效，请重新加入队列。')
        return session

    def promote(self):
        if self.active or self.cleanup_error:
            return
        if self.queue and self.queue[0].state == 'waiting':
            self.queue[0].state = 'offered'
            self.queue[0].offer_until = self.clock() + self.offer_timeout

    def snapshot(self, s: Session) -> dict:
        position = self.queue.index(s) + 1 if s in self.queue else 0
        return {'id': s.id, 'state': s.state, 'position': position,
                'waiting': len(self.queue), 'reason': s.reason,
                'offer_remaining': max(0, round(s.offer_until - self.clock())),
                'heartbeat_timeout': self.heartbeat_timeout,
                'lease_remaining': max(0, round(self.heartbeat_timeout - (self.clock() - s.last_seen)))
                if self.active is s else None}

    async def join(self, previous=''):
        async with self.lock:
            await self.expire_active()
            old = self.sessions.get(previous)
            if old and old.state != 'ended':
                old.last_seen = self.clock()
                return old.token, self.snapshot(old)
            if len(self.queue) >= 100:
                raise ValueError('队列暂时已满，请稍后再试。')
            s = Session(secrets.token_urlsafe(32), secrets.token_hex(8), self.clock())
            self.sessions[s.token] = s
            self.queue.append(s)
            self.promote()
            return s.token, self.snapshot(s)

    async def status(self, token, heartbeat=False):
        async with self.lock:
            await self.expire_active()
            s = self.require(token)
            if heartbeat and s.state != 'ended':
                # Only this authenticated session's lease is renewed.
                s.last_seen = self.clock()
            return self.snapshot(s)

    async def claim(self, token):
        async with self.lock:
            await self.expire_active()
            s = self.require(token)
            if self.active is s:
                return self.snapshot(s)  # double-click / retried request is idempotent
            if self.active or self.cleanup_error or not self.queue or self.queue[0] is not s:
                raise ValueError('尚未轮到你，请继续等待。')
            if s.state != 'offered' or self.clock() >= s.offer_until:
                raise ValueError('入场确认已过期，请重新排队。')
            self.queue.pop(0)
            self.active = s
            s.state, s.last_seen = 'starting', self.clock()
            self.task = asyncio.create_task(self.start_game(s))
            return self.snapshot(s)

    async def start_game(self, s):
        try:
            async with self.lock:
                if self.active is not s:
                    return
                if self.process:
                    raise RuntimeError('Previous game still owns the seat.')
                self.process = self.launch(s.id)
                self.launch_count += 1
                LOG.info('Game launched session=%s pid=%s', s.id, self.process.pid)
            deadline = self.clock() + self.startup_timeout
            while self.clock() < deadline:
                async with self.lock:
                    if self.active is not s:
                        return
                    if self.process.poll() is not None:
                        raise RuntimeError('游戏在初始化期间退出。')
                if await self.ready(s.id):
                    async with self.lock:
                        if self.active is s:
                            s.state = 'ready'
                            LOG.info('Stream ready session=%s', s.id)
                    return
                await asyncio.sleep(0.5)
            raise RuntimeError('游戏启动超时，请重新排队。')
        except asyncio.CancelledError:
            raise
        except Exception as error:
            LOG.exception('Game startup failed session=%s', s.id)
            async with self.lock:
                if self.active is s:
                    await self.finish(s, str(error))

    async def finish(self, s, reason):
        # Caller holds lock. Never release a seat before the entire owned tree exits.
        if self.active is s:
            if s.upstream:
                await s.upstream.close()
                s.upstream = None
            if s.ws:
                await s.ws.close(code=4001, message=b'Session ended')
                s.ws = None
            if self.process:
                try:
                    await asyncio.to_thread(self.process.stop)
                except Exception as error:
                    self.cleanup_error = str(error)
                    LOG.exception('Cleanup failed; refusing another game')
                    s.reason = '游戏清理遇到问题，服务已暂停接待。'
                    return
                self.process = None
            LOG.info('Game stopped session=%s reason=%s', s.id, reason)
            self.active = None
        if s in self.queue:
            self.queue.remove(s)
        s.state, s.reason, s.ended_at = 'ended', reason, self.clock()
        s.tickets.clear()
        self.promote()

    async def leave(self, token):
        async with self.lock:
            s = self.require(token)
            await self.finish(s, '你已退出本次体验。')
            return self.snapshot(s)

    async def tick(self):
        async with self.lock:
            now = self.clock()
            await self.expire_active()
            if self.active:
                s = self.active
                if self.process and self.process.poll() is not None:
                    await self.finish(s, '游戏已退出，席位已释放。')
            for s in list(self.queue):
                if (s.state == 'offered' and now >= s.offer_until) or now - s.last_seen >= self.queue_timeout:
                    await self.finish(s, '排队或入场确认超时，请重新加入。')
            for token, s in list(self.sessions.items()):
                if s.state == 'ended' and now - s.ended_at > 300:
                    del self.sessions[token]
                else:
                    s.tickets = {t: until for t, until in s.tickets.items() if until > now}
            self.promote()

    async def expire_active(self):
        if self.active and self.clock() - self.active.last_seen >= self.heartbeat_timeout:
            await self.finish(self.active, '连接已失去心跳 180 秒，席位已释放。')

    async def ticket(self, token):
        async with self.lock:
            await self.expire_active()
            s = self.require(token)
            if self.active is not s or s.state != 'ready':
                raise ValueError('当前会话尚未准备好推流。')
            s.tickets.clear()
            ticket = secrets.token_urlsafe(32)
            s.tickets[ticket] = self.clock() + 30
            return ticket

    async def consume_ticket(self, ticket):
        async with self.lock:
            await self.expire_active()
            s = self.active
            if not s or s.state != 'ready' or s.tickets.pop(ticket, 0) <= self.clock():
                raise ValueError('推流入场凭证已失效。')
            return s

    async def shutdown(self):
        if self.task and not self.task.done():
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        async with self.lock:
            if self.active:
                await self.finish(self.active, '服务已停止。')
