import { Config, PixelStreaming, Logger, LogLevel } from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.5';
import './style.css';
import { initMotion, setPlaying } from './motion';
import { initCommunity, updateStats } from './community';
import { HAS_SERVICE, apiUrl, streamUrl, selectService } from './service';
import { initLibrary, selectedGame, setLibrarySession } from './library';

type SessionState = { id: string; state: string; position: number; waiting: number; reason: string; game_id?: string;
  offer_remaining: number; lease_remaining: number | null; heartbeat_timeout: number };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const primary = el<HTMLButtonElement>('primary');
const stage = el('stage');
const playerShell = el('player-shell');
let token = sessionStorage.getItem('chasheo-session') || '';
let current: SessionState | null = null;
let stream: PixelStreaming | null = null;
let connecting = false;
let busy = false;
let online = false;
let hasFrames = false;
let muted = true;
let pollPending = false;
let heartbeatDue = false;
let lastError = '';
let recordedSession = '';
let immersive = false;
class ExpiredSession extends Error {}
Logger.InitLogging(LogLevel.Warning, false);

async function api(path: string, method = 'POST', body?: object) {
  const response = await fetch(apiUrl(path), { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('世界服务暂时离线，请稍后重试。');
  const result = await response.json();
  if (!response.ok) {
    if ((path === 'session' || path === 'heartbeat') && [401, 409].includes(response.status)) {
      token = ''; current = null; sessionStorage.removeItem('chasheo-session'); disconnect();
      throw new ExpiredSession();
    }
    throw new Error(result.error || '请求失败，请稍后重试。');
  }
  return result;
}

function button(text: string, disabled = false) {
  primary.querySelector('span')!.textContent = text;
  primary.disabled = disabled || busy;
}

function recordPlay() {
  if (!current || current.state !== 'ready' || !hasFrames || recordedSession === current.id) return;
  const id = current.id;
  recordedSession = id;
  void api('play-start').then(updateStats).catch(() => { if (recordedSession === id) recordedSession = ''; });
}

function render() {
  const s = current;
  const active = s?.state === 'starting' || s?.state === 'ready';
  setLibrarySession(Boolean(active), s?.game_id);
  el('leave').hidden = !s || s.state === 'ended';
  el('reconnect').hidden = s?.state !== 'ready' || hasFrames;
  el<HTMLButtonElement>('fullscreen').disabled = !hasFrames;
  el('sound').hidden = !hasFrames;
  el('pointer').hidden = !hasFrames;
  if (s?.state === 'waiting') {
    el('number-label').textContent = 'YOUR QUEUE POSITION';
    el('queue-number').textContent = String(s.position).padStart(2, '0');
    el('queue-detail').textContent = '轮到你时会在这里提醒';
    el('session-message').textContent = lastError || '请保留此页面，我们正在为你等候席位。';
    button('正在排队', true);
  } else if (s?.state === 'offered') {
    el('number-label').textContent = 'YOUR SEAT IS READY';
    el('queue-number').textContent = '01';
    el('queue-detail').textContent = `请在 ${s.offer_remaining} 秒内确认入场`;
    el('session-message').textContent = lastError || '轮到你了。选择世界后确认启动。';
    button('启动所选游戏');
  } else if (active) {
    el('number-label').textContent = 'YOUR EXPLORATION';
    el('queue-number').textContent = '01';
    el('queue-detail').textContent = s.state === 'starting' ? '世界正在启动' : '席位由你独享';
    el('session-message').textContent = lastError || (s.state === 'starting' ? '正在唤醒世界与连接画面，请稍候。' : hasFrames ? '画面已连接。点击画面，开始探索。' : '正在连接实时画面。');
    button(s.state === 'starting' ? '正在启动世界' : hasFrames ? '沉浸游玩' : '正在连接画面', !hasFrames);
  } else {
    el('number-label').textContent = 'AVAILABLE SEATS';
    el('session-message').textContent = lastError || s?.reason || '准备好开启一小段探索了吗？';
    button(online ? '领取入场券' : '重新连接服务');
  }
  el('stage-message').textContent = active ? (hasFrames ? '' : s?.state === 'starting' ? '正在唤醒世界，请稍候…' : '正在建立实时连接…') : '选择世界，等你入场。';
  el('live-label').textContent = hasFrames ? 'LIVE / YOUR WORLD' : active ? 'ESTABLISHING CONNECTION' : 'WAITING FOR EXPLORER';
}

function disconnect() {
  void closeFullscreen();
  const old = stream;
  stream = null;
  old?.disconnect();
  el('video-host').replaceChildren();
  connecting = false;
  hasFrames = false;
  setPlaying(false);
  muted = true;
  el('sound').textContent = '开启声音';
  stage.classList.remove('live');
  el('play-video').hidden = true;
}

async function connectStream() {
  if (connecting || stream || current?.state !== 'ready') return;
  connecting = true;
  try {
    const { ticket } = await api('stream-ticket');
    if (current?.state !== 'ready') { connecting = false; return; }
    const url = streamUrl(ticket);
    const config = new Config({ useUrlParams: false, initialSettings: {
      ss: url, AutoConnect: false, AutoPlayVideo: true, StartVideoMuted: true,
      UseMic: false, UseCamera: false, HoveringMouse: true, MatchViewportRes: false,
      MaxReconnectAttempts: 0, StreamerId: current.id, FakeMouseWithTouches: true, KeyboardInput: false
    }});
    const instance = new PixelStreaming(config, { videoElementParent: el('video-host') });
    stream = instance;
    instance.addEventListener('playStreamRejected', () => { if (stream === instance) el('play-video').hidden = false; });
    instance.addEventListener('webRtcDisconnected', () => {
      if (stream !== instance) return;
      hasFrames = false;
      setPlaying(false);
      void closeFullscreen();
      stage.classList.remove('live');
      lastError = '画面连接中断，2 分钟内可重新连接本局。';
      render();
    });
    instance.addEventListener('videoInitialized', () => {
      const video = el('video-host').querySelector('video');
      if (!video) return;
      const showFrame = () => {
        if (stream !== instance || !video.videoWidth) return;
        hasFrames = true;
        connecting = false;
        lastError = '';
        stage.classList.add('live');
        setPlaying(true);
        el('video-info').textContent = `${video.videoWidth} × ${video.videoHeight} · LIVE`;
        el('play-video').hidden = true;
        render();
        recordPlay();
      };
      video.addEventListener('playing', showFrame);
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(showFrame);
      if (video.readyState >= 2) showFrame();
    });
    instance.connect();
    render();
  } catch (error) {
    disconnect();
    lastError = error instanceof Error ? error.message : '画面连接失败，请重试。';
    render();
  }
}

async function poll(heartbeat = false) {
  // A slow public request must not silently discard the 15-second lease renewal.
  heartbeatDue ||= heartbeat;
  if (pollPending) return;
  pollPending = true;
  const renew = heartbeatDue;
  heartbeatDue = false;
  try {
    const health = await api('health', 'GET');
    online = health.ok;
    el('seat-state').textContent = !health.ok ? '世界暂时无法连接' : health.busy ? '一位访客正在探索' : '席位空闲 · 可以入场';
    el('seat-dot').className = `status-dot ${!health.ok ? 'offline' : health.busy ? 'busy' : ''}`;
    if (!current || current.state === 'ended') {
      el('queue-number').textContent = health.busy ? '00' : '01';
      el('queue-detail').textContent = health.busy ? `${health.waiting} 位访客正在等候` : '属于下一位探索者';
    }
    if (token && current?.state !== 'ended') {
      current = await api(renew ? 'heartbeat' : 'session', renew ? 'POST' : 'GET');
      if (current!.state === 'ended') disconnect();
    }
    render();
    if (hasFrames) recordPlay();
    if (current?.state === 'ready' && !stream && !connecting) void connectStream();
  } catch (error) {
    if (error instanceof ExpiredSession) {
      lastError = ''; render(); return;
    }
    online = false;
    el('seat-state').textContent = '世界暂时离线，请稍后重试';
    el('seat-dot').className = 'status-dot offline';
    lastError = error instanceof Error ? error.message : '连接失败，请重试。';
    render();
  } finally {
    pollPending = false;
    if (heartbeatDue) void poll();
  }
}

primary.addEventListener('click', async () => {
  if (hasFrames) { await toggleFullscreen(); return; }
  busy = true;
  lastError = '';
  render();
  try {
    if (current?.state === 'offered') current = await api('claim', 'POST', { game_id: selectedGame() });
    else {
      const result = await api('join');
      token = result.token;
      sessionStorage.setItem('chasheo-session', token);
      current = result;
    }
  } catch (error) { lastError = error instanceof Error ? error.message : '暂时无法入场。'; }
  finally { busy = false; render(); await poll(); }
});
el('leave').addEventListener('click', async () => {
  busy = true;
  try { current = await api('leave'); disconnect(); lastError = ''; }
  catch (error) { lastError = error instanceof Error ? error.message : '退出失败，请重试。'; }
  finally { busy = false; render(); await poll(); }
});
el('reconnect').addEventListener('click', () => { disconnect(); lastError = ''; void connectStream(); });
el('play-video').addEventListener('click', () => { stream?.play(); });
async function toggleFullscreen() {
  if (document.fullscreenElement === playerShell || immersive) { await closeFullscreen(); return; }
  try {
    await playerShell.requestFullscreen();
  } catch {
    // A browser can reject native fullscreen in an inactive tab or embedded context.
    // Keep a clearly named viewport-only mode as a usable, escapable fallback.
    immersive = true;
    playerShell.classList.add('is-immersive');
    document.body.classList.add('immersive-open');
    playerShell.setAttribute('role', 'dialog');
    playerShell.setAttribute('aria-modal', 'true');
    playerShell.setAttribute('aria-label', '游戏网页沉浸模式');
    syncFullscreen();
    el('exit-fullscreen').focus();
    el('toast').textContent = '已进入网页沉浸模式，按 Esc 或点击「退出」返回。'; el('toast').hidden = false;
    setTimeout(() => { el('toast').hidden = true; }, 4000);
  }
}
async function closeFullscreen() {
  if (document.fullscreenElement === playerShell) await document.exitFullscreen().catch(() => {});
  if (immersive) {
    immersive = false;
    playerShell.classList.remove('is-immersive'); document.body.classList.remove('immersive-open');
    playerShell.removeAttribute('role'); playerShell.removeAttribute('aria-modal'); playerShell.removeAttribute('aria-label');
  }
  syncFullscreen();
}
function syncFullscreen() {
  const full = document.fullscreenElement === playerShell || immersive;
  el('fullscreen').textContent = full ? (immersive ? '退出沉浸模式 ↙' : '退出全屏 ↙') : '全屏游玩 ↗';
  el('fullscreen').setAttribute('aria-pressed', String(full));
  el('exit-fullscreen').textContent = immersive ? '退出沉浸模式 ×' : '退出全屏 ×';
  el('exit-fullscreen').setAttribute('aria-label', immersive ? '退出沉浸模式' : '退出全屏');
  el('exit-fullscreen').hidden = !full;
}
el('fullscreen').addEventListener('click', () => { void toggleFullscreen(); });
el('exit-fullscreen').addEventListener('click', () => { void toggleFullscreen(); });
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('keydown', event => {
  if (!immersive) return;
  if (event.key === 'Escape') { event.preventDefault(); void closeFullscreen(); }
  if (event.key === 'Tab') {
    const targets = Array.from(playerShell.querySelectorAll<HTMLElement>('button:not([disabled]):not([hidden]), [tabindex="0"]'));
    const first = targets[0], last = targets.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}, true);
el('video-host').addEventListener('pointerdown', () => { stream?.config.setFlagEnabled('KeyboardInput', true); });
document.addEventListener('focusin', event => {
  if (!(event.target instanceof Element) || !event.target.closest('#video-host, #stage'))
    stream?.config.setFlagEnabled('KeyboardInput', false);
});
document.addEventListener('pointerdown', event => {
  if (!(event.target instanceof Element) || !event.target.closest('#video-host'))
    stream?.config.setFlagEnabled('KeyboardInput', false);
});
el('pointer').addEventListener('click', () => {
  if (!stream) return;
  const locked = document.pointerLockElement !== null;
  stream.config.setFlagEnabled('HoveringMouse', locked);
  if (locked) document.exitPointerLock();
  else { stream.config.setFlagEnabled('KeyboardInput', true); el('video-host').requestPointerLock(); }
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement !== null;
  el('pointer').textContent = locked ? '释放鼠标' : '锁定鼠标';
  if (!locked) stream?.config.setFlagEnabled('HoveringMouse', true);
});
el('sound').addEventListener('click', () => {
  muted = !muted;
  // Epic owns a detached audio element; use its public config/play API for both tracks.
  stream?.config.setFlagEnabled('StartVideoMuted', muted);
  stream?.play();
  el('sound').textContent = muted ? '开启声音' : '关闭声音';
});
async function initializeServices() {
await selectService();
if (HAS_SERVICE) {
  void poll(true);
  setInterval(() => void poll(), 2000);
  setInterval(() => void poll(true), 15000);
  window.addEventListener('online', () => void poll(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll(true); });
} else {
  el('seat-state').textContent = '游戏服务尚未接入';
  el('seat-dot').className = 'status-dot offline';
  el('number-label').textContent = 'WORLD PREVIEW';
  el('queue-number').textContent = '—';
  el('queue-detail').textContent = '实机体验稍后开放';
  el('session-message').textContent = '当前可以浏览世界。游戏服务接入后，即可在这里排队入场。';
  el('stage-message').textContent = '实机体验将在游戏服务接入后开放。';
  button('游戏服务待接入', true);
}
void initLibrary();
void initCommunity();
}
initMotion();
void import('./world-scene').then(({ initWorldScene }) => initWorldScene()).catch(() => {});
void initializeServices();
