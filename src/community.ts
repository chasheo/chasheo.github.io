import { userError } from './i18n';
import gsap from 'gsap';
import { HAS_SERVICE, apiUrl } from './service';

type Stats = { visits: number; visitors: number; plays: number; comments: number };
type Comment = { id: number; name: string; body: string; created_at: string; is_own: boolean };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let cursor: number | null = null;
let stats: Stats | null = null;
let submitting = false;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let visitorToken = localStorage.getItem('chasheo-visitor-token') || '';
let identifying: Promise<string> | null = null;

async function identify() {
  if (visitorToken) return visitorToken;
  if (!identifying) identifying = (async () => {
    const response = await fetch(apiUrl('visitor'), { method: 'POST', credentials: 'same-origin',
      signal: AbortSignal.timeout(8000) });
    if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('留言服务暂时离线，请稍后重试。');
    const result = await response.json();
    if (!response.ok || !result.visitor_token) throw new Error('暂时无法建立访客身份，请稍后重试。');
    visitorToken = result.visitor_token;
    localStorage.setItem('chasheo-visitor-token', visitorToken);
    return visitorToken;
  })().finally(() => { identifying = null; });
  return identifying;
}

export async function request(path: string, method = 'GET', body?: object, retry = true): Promise<any> {
  const identity = await identify();
  const response = await fetch(apiUrl(path), { method, credentials: 'same-origin',
    headers: { 'X-Visitor-Token': identity, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('留言服务暂时离线，请稍后重试。');
  const result = await response.json();
  if (response.status === 401 && retry) {
    visitorToken = ''; localStorage.removeItem('chasheo-visitor-token');
    return request(path, method, body, false);
  }
  if (!response.ok) throw new Error(result.error || '暂时无法连接世界记录，请稍后重试。');
  return result;
}

export function updateStats(next: Stats) {
  (['visits', 'plays', 'comments'] as const).forEach(key => {
    if (stats?.[key] === next[key]) return;
    document.querySelectorAll<HTMLElement>(`[data-stat="${key}"]`).forEach(node => {
      const value = { n: stats?.[key] || 0 };
      gsap.to(value, { n: next[key], duration: reduced ? 0 : .8, ease: 'power2.out',
        onUpdate: () => { node.textContent = Math.round(value.n).toLocaleString('en-US'); } });
      node.setAttribute('aria-label', String(next[key]));
    });
  });
  $('nav-comments').textContent = String(next.comments).padStart(2, '0');
  $('comment-total').textContent = String(next.comments).padStart(2, '0');
  $('stats-note').textContent = '真实记录 · 每次成功进入游戏计为一次游玩';
  stats = next;
}

function renderComment(comment: Comment) {
  const article = document.createElement('article');
  article.className = 'comment-row';
  article.dataset.id = String(comment.id);
  const avatar = document.createElement('span');
  avatar.className = 'comment-avatar'; avatar.ariaHidden = 'true';
  avatar.textContent = Array.from(comment.name)[0]?.toUpperCase() || '旅';
  const content = document.createElement('div'); content.className = 'comment-content';
  const meta = document.createElement('div'); meta.className = 'comment-meta';
  const name = document.createElement('strong'); name.textContent = comment.name;
  const time = document.createElement('time'); time.dateTime = comment.created_at;
  time.textContent = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(comment.created_at));
  const body = document.createElement('p'); body.textContent = comment.body;
  meta.append(name, time); content.append(meta, body);
  if (comment.is_own) {
    const remove = document.createElement('button'); remove.className = 'comment-delete';
    remove.textContent = '收回这条留言';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try { updateStats(await request(`comments/${comment.id}`, 'DELETE')); article.remove(); if (!$('comments-list').childElementCount) empty(); }
      catch (error) { feedback(userError(error, '收回失败，请重试。'), true); remove.disabled = false; }
    });
    content.append(remove);
  }
  article.append(avatar, content);
  return article;
}

function empty(text = '第一条足迹，留给你。\n这个世界正在等一个新声音。') {
  const message = document.createElement('p'); message.className = 'empty-comments'; message.style.whiteSpace = 'pre-line';
  text.split('\n').forEach((line, index) => { if (index) message.append(document.createElement('br')); message.append(document.createTextNode(line)); });
  $('comments-list').replaceChildren(message);
}

async function loadComments(append = false) {
  const result = await request(`comments${append && cursor ? `?before=${cursor}` : ''}`) as { items: Comment[]; next: number | null };
  if (!append) $('comments-list').replaceChildren();
  result.items.forEach(comment => $('comments-list').append(renderComment(comment)));
  cursor = result.next;
  $('more-comments').hidden = cursor === null;
  if (!$('comments-list').childElementCount) empty();
}

function feedback(message: string, error = false) {
  $('comment-feedback').textContent = message;
  $('comment-feedback').classList.toggle('error', error);
}

export async function initCommunity() {
  const body = $<HTMLTextAreaElement>('comment-body');
  const name = $<HTMLInputElement>('comment-name');
  const submit = $<HTMLButtonElement>('comment-submit');
  if (!HAS_SERVICE) {
    name.disabled = true; body.disabled = true; submit.disabled = true;
    body.placeholder = '公开留言将在世界服务接入后开放。';
    submit.textContent = '留言服务待接入';
    $('refresh-comments').setAttribute('disabled', '');
    $('stats-note').textContent = '实时统计将在世界服务接入后显示';
    feedback('留言功能将在服务接入后开放。');
    empty('这里将记录每位探索者的足迹。\n留言服务正在准备中。');
    return;
  }
  name.value = localStorage.getItem('chasheo-display-name') || '';
  body.addEventListener('input', () => {
    $('comment-length').textContent = String(body.value.length);
    submit.disabled = !body.value.trim() || submitting;
  });
  $('comment-form').addEventListener('submit', async event => {
    event.preventDefault(); if (submitting || !body.value.trim()) return;
    submitting = true; submit.disabled = true; feedback('正在把足迹留在这个世界…');
    try {
      const result = await request('comments', 'POST', { name: name.value, body: body.value,
        website: ($<HTMLFormElement>('comment-form').elements.namedItem('website') as HTMLInputElement).value });
      localStorage.setItem('chasheo-display-name', name.value);
      updateStats(result.stats);
      body.value = ''; $('comment-length').textContent = '0';
      await loadComments(); feedback('足迹已留下。谢谢你来过。');
      if (!reduced) gsap.from('.comment-row:first-child', { opacity: 0, y: 12, duration: .5 });
    } catch (error) { feedback(userError(error, '留言未发出，请重试。'), true); }
    finally { submitting = false; submit.disabled = !body.value.trim(); }
  });
  $('refresh-comments').addEventListener('click', () => void loadComments().catch(error => feedback(userError(error), true)));
  $('more-comments').addEventListener('click', async () => {
    const button = $<HTMLButtonElement>('more-comments'); button.disabled = true;
    try { await loadComments(true); } catch (error) { feedback(userError(error), true); }
    finally { button.disabled = false; }
  });
  try {
    // A page-open UUID makes network retries idempotent; reloads are new PV events.
    updateStats(await request('visit', 'POST', { event_id: crypto.randomUUID() }));
    await loadComments();
  } catch (error) { $('stats-note').textContent = '记录暂时无法连接'; empty('暂时无法读取足迹，点击「刷新」重试。'); }
  setInterval(() => {
    if (!document.hidden) void request('stats').then(updateStats).catch(() => { $('stats-note').textContent = '记录暂时无法连接'; });
  }, 20000);
}
