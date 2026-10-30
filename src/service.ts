// GitHub Pages serves the presentation; a public game host must be configured explicitly.
const configured = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
function publicBase(): string | null {
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? configured : null;
  } catch { return null; }
}
export const SERVICE_BASE: string | null = loopback ? location.origin : publicBase();
export const HAS_SERVICE = SERVICE_BASE !== null;
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
