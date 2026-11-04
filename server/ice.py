"""Public WebRTC configuration; long-lived TURN keys never enter signalling messages."""
import asyncio
import json
from pathlib import Path
import re

import aiohttp


class IceConfiguration:
    def __init__(self, config, runtime):
        self.secret_file = config.get('cloudflare_turn_file')
        self.path = Path(config.get('ice_config_file') or Path(runtime) / 'peer-options.json')
        self.static = bool(config.get('ice_config_file'))
        if self.secret_file and self.static:
            raise ValueError('Choose cloudflare_turn_file or ice_config_file, not both.')

    def initialize(self):
        # Call only after acquiring the host lock: a duplicate host must not reset live credentials.
        if not self.static:
            self.write({'iceServers': [{'urls': ['stun:stun.cloudflare.com:3478']}]})

    def write(self, options):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.pending')
        temporary.write_text(json.dumps(options), encoding='utf-8')
        temporary.replace(self.path)

    async def prepare(self, http):
        if not self.secret_file:
            return
        try:
            secret = json.loads(Path(self.secret_file).read_text(encoding='utf-8-sig'))
            key_id, api_token = secret['turn_key_id'], secret['api_token']
            if not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', key_id) or not isinstance(api_token, str) or not api_token.strip():
                raise ValueError('Invalid TURN configuration')
            endpoint = f'https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers'
            async with http.post(endpoint, headers={'Authorization': 'Bearer ' + api_token},
                                 json={'ttl': 86400}, timeout=aiohttp.ClientTimeout(total=12)) as response:
                if response.status != 201:
                    raise ValueError('TURN credential request failed')
                options = await response.json()
            servers = options.get('iceServers')
            if not isinstance(servers, list) or not servers:
                raise ValueError('No ICE servers returned')
            self.write({'iceServers': servers})
        except (OSError, ValueError, KeyError, TypeError, aiohttp.ClientError, asyncio.TimeoutError):
            # Provider responses and permanent keys must never appear in logs or public errors.
            raise RuntimeError('媒体中继暂时无法连接，请稍后重试。') from None
