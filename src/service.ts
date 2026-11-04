import { chooseReachableService } from './select-service';
// GitHub Pages serves the presentation; public entries both reach the same game host.
const configured = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const fallback = (import.meta.env.VITE_API_FALLBACK_URL || '').trim().replace(/\/+$/, '');
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
function publicBase(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? url.origin : null;
  } catch { return null; }
}
const candidates = [...new Set([publicBase(configured), publicBase(fallback)].filter((x): x is string => Boolean(x)))];
export let SERVICE_BASE: string | null = loopback ? location.origin : candidates[0] || null;
export const HAS_SERVICE = SERVICE_BASE !== null;
export async function selectService() {
  if (loopback || candidates.length < 2) return;
  SERVICE_BASE = await chooseReachableService(candidates, async base => {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      const health = await response.json();
      return response.ok && health.ok === true && health.capacity === 1;
    } catch { return false; }
  });
}
export function apiUrl(path: string) {
  if (!SERVICE_BASE) throw new Error('世界服务尚未接入。');
  return `${SERVICE_BASE}/api/${path}`;
}
export function streamUrl(ticket: string) {
  if (!SERVICE_BASE) throw new Error('游戏服务尚未接入。');
  const url = new URL(`${SERVICE_BASE}/stream`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket);
  return url.href;
}
