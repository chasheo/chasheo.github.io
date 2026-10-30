// Epic's UE5.5 protocol implementation, with private loopback listeners only.
const http = require('node:http');
const { SignallingServer } = require('@epicgames-ps/lib-pixelstreamingsignalling-ue5.5');
const playerPort = Number(process.env.DEMO_SIGNAL_PORT || 18791);
const streamerPort = Number(process.env.DEMO_STREAMER_PORT || 18888);
let signalling;
const server = http.createServer((req, res) => {
  if (req.url !== '/health' && req.url !== '/streamers') {
    res.writeHead(404).end(); return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(req.url === '/health' ? { ok: true } :
    signalling.streamerRegistry.streamers.map(s => s.getStreamerInfo())));
});
signalling = new SignallingServer({
  httpServer: server, streamerPort, peerOptions: {}, maxSubscribers: 1,
  streamerWsOptions: { host: '127.0.0.1' }
});
server.listen(playerPort, '127.0.0.1', () => console.log(`Signalling ready on loopback:${playerPort}`));
