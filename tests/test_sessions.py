import asyncio

import pytest

from server.sessions import Sessions


class Clock:
    now = 1000.0

    def __call__(self):
        return self.now


class Process:
    pid = 123

    def __init__(self):
        self.stopped = False

    def poll(self):
        return 0 if self.stopped else None

    def stop(self):
        self.stopped = True


async def ready(_):
    return True


def fixture():
    clock, processes = Clock(), []

    def launch(_):
        process = Process()
        processes.append(process)
        return process

    return Sessions(launch, ready, clock=clock), clock, processes


async def start(manager, token):
    await manager.claim(token)
    await asyncio.sleep(0)
    assert (await manager.status(token))['state'] == 'ready'


def test_fifo_and_concurrent_claims_only_launch_one_game():
    async def check():
        m, _, procs = fixture()
        a, _ = await m.join()
        b, state = await m.join()
        assert state['position'] == 2
        outcomes = await asyncio.gather(m.claim(a), m.claim(a), m.claim(b), return_exceptions=True)
        await asyncio.sleep(0)
        assert isinstance(outcomes[2], ValueError)
        assert len(procs) == 1
        assert m.active.token == a
        with pytest.raises(ValueError):
            await m.ticket(b)
        await m.shutdown()
    asyncio.run(check())


def test_exact_120_second_expiry_and_stale_heartbeat_cannot_touch_next_player():
    async def check():
        m, clock, procs = fixture()
        a, _ = await m.join()
        b, _ = await m.join()
        await start(m, a)
        clock.now += 119.999
        await m.status(b, heartbeat=True)
        await m.tick()
        assert m.active.token == a and not procs[0].stopped
        clock.now += 0.001
        # A late heartbeat must expire the lease before attempting renewal.
        assert (await m.status(a, heartbeat=True))['state'] == 'ended'
        assert procs[0].stopped
        assert (await m.status(b))['state'] == 'offered'
        await start(m, b)
        last_seen = m.active.last_seen
        await m.status(a, heartbeat=True)
        await m.leave(a)
        assert m.active.token == b and m.active.last_seen == last_seen
        assert len(procs) == 2 and not procs[1].stopped
        await m.shutdown()
    asyncio.run(check())


def test_queue_heartbeat_does_not_renew_current_player():
    async def check():
        m, clock, procs = fixture()
        a, _ = await m.join()
        b, _ = await m.join()
        await start(m, a)
        for _ in range(8):
            clock.now += 15
            await m.status(b, heartbeat=True)
            await m.tick()
        assert procs[0].stopped
        assert m.active is None
        assert (await m.status(b))['state'] == 'offered'
        await m.shutdown()
    asyncio.run(check())


def test_async_media_preparation_cannot_launch_an_abandoned_seat():
    async def check():
        m, _, procs = fixture()
        gate = asyncio.Event()
        async def prepare(_):
            await gate.wait()
        m.prepare = prepare
        a, _ = await m.join()
        b, _ = await m.join()
        await m.claim(a)
        await asyncio.sleep(0)
        await m.leave(a)
        await m.claim(b)
        gate.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert m.active.token == b and len(procs) == 1
        assert (await m.status(a))['state'] == 'ended'
        await m.shutdown()
    asyncio.run(check())


def test_media_preparation_failure_releases_seat_without_starting_a_game():
    async def check():
        m, _, procs = fixture()
        async def prepare(_):
            raise RuntimeError('Media relay unavailable')
        m.prepare = prepare
        a, _ = await m.join()
        b, _ = await m.join()
        await m.claim(a)
        await asyncio.sleep(0)
        assert (await m.status(a))['state'] == 'ended'
        assert (await m.status(b))['state'] == 'offered'
        assert not procs and m.active is None
        await m.shutdown()
    asyncio.run(check())


def test_turn_permanent_key_never_enters_public_ice_configuration(tmp_path):
    import json
    from server.ice import IceConfiguration

    secret = tmp_path / 'turn.private.json'
    secret.write_text(json.dumps({'turn_key_id': 'a' * 32, 'api_token': 'private-test-value'}))
    ice = IceConfiguration({'cloudflare_turn_file': str(secret)}, tmp_path / 'runtime')
    class Reply:
        status = 201
        async def __aenter__(self):
            return self
        async def __aexit__(self, *_):
            pass
        async def json(self):
            return {'iceServers': [{'urls': ['turn:turn.cloudflare.com:3478'],
                                    'username': 'short-lived-user', 'credential': 'short-lived-password'}]}
    class Http:
        def post(self, endpoint, **kwargs):
            assert endpoint.startswith('https://rtc.live.cloudflare.com/')
            assert kwargs['headers']['Authorization'] == 'Bearer private-test-value'
            return Reply()
    asyncio.run(ice.prepare(Http()))
    content = ice.path.read_text()
    assert 'private-test-value' not in content and 'a' * 32 not in content
    assert json.loads(content)['iceServers'][0]['credential'] == 'short-lived-password'


def test_stream_tickets_are_one_use_and_invalid_after_handoff():
    async def check():
        m, _, _ = fixture()
        a, _ = await m.join()
        await start(m, a)
        ticket = await m.ticket(a)
        assert (await m.consume_ticket(ticket)).token == a
        with pytest.raises(ValueError):
            await m.consume_ticket(ticket)
        ticket = await m.ticket(a)
        await m.leave(a)
        b, _ = await m.join()
        await start(m, b)
        with pytest.raises(ValueError):
            await m.consume_ticket(ticket)
        await m.shutdown()
    asyncio.run(check())


def test_absent_queue_head_is_skipped_and_cleanup_failure_blocks_new_launch():
    async def check():
        m, clock, procs = fixture()
        a, _ = await m.join()
        b, _ = await m.join()
        clock.now += 30
        await m.tick()
        assert (await m.status(a))['state'] == 'ended'
        assert (await m.status(b))['state'] == 'offered'
        await start(m, b)
        c, _ = await m.join()

        def fail_cleanup():
            raise RuntimeError('Simulated unreaped process')

        procs[0].stop = fail_cleanup
        await m.leave(b)
        with pytest.raises(ValueError):
            await m.claim(c)
        assert m.cleanup_error and m.active.token == b
        assert len(procs) == 1
        procs[0].stop = lambda: setattr(procs[0], 'stopped', True)
        await m.shutdown()
    asyncio.run(check())


def test_game_crash_releases_seat_and_start_failure_recovers():
    async def check():
        m, _, procs = fixture()
        a, _ = await m.join()
        b, _ = await m.join()
        await start(m, a)
        procs[0].stopped = True
        await m.tick()
        assert m.active is None and (await m.status(b))['state'] == 'offered'
        m.launch = lambda _: (_ for _ in ()).throw(OSError('Missing executable'))
        await m.claim(b)
        await asyncio.sleep(0)
        assert m.active is None and (await m.status(b))['state'] == 'ended'
        await m.shutdown()
    asyncio.run(check())
