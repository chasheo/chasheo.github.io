import { HAS_SERVICE } from './service';
import { request } from './community';
import { currentLanguage, localize } from './i18n';

const names: Record<string, { zh: string; en: string }> = {
  'mystic-forest': { zh: '魔法森林', en: 'Mystic Forest' },
  'neon-embers': { zh: '霓虹余烬', en: 'Neon Embers' },
};
const gameTags: Record<string, string[]> = { 'mystic-forest': ['肉鸽', '魔法', '无限模式'], 'neon-embers': ['多武器', '赛博朋克', '剧情'] };
const gameName = (game: Game) => names[game.id]?.[currentLanguage()] || game.title;

type Game = { id: string; title: string; description: string; image?: string; image_label?: string; images?: { url: string; label: string }[];
  video?: string; download_url?: string; likes?: number; liked?: boolean; showcase?: boolean };
const fallback: Game = { id: 'mystic-forest', title: 'Mystic Forest',
  description: '在雾气与光之间，探索森林中的未知。', image: '/media/forest-portal.png' };
const neonPreview: Game = { id: 'neon-embers', title: '霓虹余烬 · Neon Embers',
  description: '漫步新港城的雨夜街区，在霓虹与暗巷之间探索、战斗，追寻第一单。',
  image: '/media/neon-embers-cover.webp', image_label: '游戏城市画面', showcase: true,
  images: [{ url: '/media/neon-embers-menu.webp', label: '游戏主菜单' },
    { url: '/media/neon-embers-firefight.webp', label: '实机画面 · 街区交火' },
    { url: '/media/neon-embers-blades.webp', label: '实机画面 · 螳刀战斗' }] };
let games: Game[] = [fallback, neonPreview];
let chosen = fallback.id;
let locked = false;
let activeGameId = '';
const library = document.getElementById('game-library')!;
const feedback = document.getElementById('library-feedback')!;

export function selectedGame() { return chosen; }
export function selectGameById(id: string) {
  const game = games.find(item => item.id === id);
  if (!game || game.showcase || (locked && id !== chosen)) return false;
  chosen = id; updateStage(game); render(); return true;
}
function publishGames() {
  window.dispatchEvent(new CustomEvent('chasheo:games', { detail: games.map(g => ({
    id: g.id, title: names[g.id] || g.title,
    description: { zh: localize(g.description, 'zh'), en: localize(g.description, 'en') },
    tags: (gameTags[g.id] || []).map(tag => ({ zh: tag, en: localize(tag, 'en') })),
    cover: new URL(g.image || g.images?.[0]?.url || fallback.image!, location.origin).href,
    availability: g.showcase ? 'showcase' : 'playable'
  })) }));
}

function updateStage(game: Game) {
  const title = document.getElementById('stage-game-title')!;
  title.textContent = gameName(game);
  const image = document.getElementById('stage-poster') as HTMLImageElement;
  image.src = game.image || game.images?.[0]?.url || fallback.image!;
  image.alt = `${gameName(game)} · ${localize('游戏视觉')}`;
  const disclosure = document.querySelector<HTMLElement>('.poster-disclosure');
  if (disclosure) disclosure.textContent = game.id === 'neon-embers'
    ? '游戏截图 / 入场后切换为实机画面' : '概念视觉 / 入场后切换为实机画面';
}

function render() {
  library.replaceChildren();
  games.forEach(game => {
    const card = document.createElement('article');
    card.className = 'game-card' + (game.id === chosen ? ' selected' : '');
    const selectable = !locked && !game.showcase;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `${gameName(game)} · ${currentLanguage() === 'en' ? (game.id === chosen ? 'Selected' : 'Press Enter to select') : (game.id === chosen ? '已选择' : '按回车选择')}`);
    if (game.id === chosen) card.setAttribute('aria-current', 'true');
    if (selectable) card.tabIndex = 0;
    else card.classList.add('selection-locked');
    const select = () => { if (selectable && game.id !== chosen && selectGameById(game.id)) document.querySelector<HTMLElement>(`.game-card[data-game-id="${game.id}"]`)?.focus({ preventScroll: true }); };
    card.dataset.gameId = game.id;
    card.addEventListener('click', event => { if (!(event.target as Element).closest('button,a,video,input')) select(); });
    card.addEventListener('keydown', event => { if (event.target === card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(); } });
    const visual = document.createElement('div'); visual.className = 'game-card-visual';
    const img = document.createElement('img'); img.loading = 'lazy';
    img.src = game.image || game.images?.[0]?.url || fallback.image!; img.alt = `${gameName(game)} · ${localize('游戏视觉')}`;
    const caption = document.createElement('span'); caption.className = 'game-card-caption';
    caption.textContent = localize(game.image_label || '游戏视觉');
    visual.append(img, caption);
    const content = document.createElement('div'); content.className = 'game-card-content';
    const title = document.createElement('h4'); title.textContent = gameName(game);
    const description = document.createElement('p'); description.textContent = localize(game.description);
    const actions = document.createElement('div'); actions.className = 'game-card-actions';
    const like = document.createElement('button'); like.className = 'game-like';
    like.disabled = !HAS_SERVICE || typeof game.likes !== 'number';
    like.textContent = `${game.liked ? '♥' : '♡'} ${typeof game.likes === 'number' ? game.likes : '—'}`;
    like.setAttribute('aria-label', `${currentLanguage() === 'en' ? (game.liked ? 'Unlike' : 'Like') : (game.liked ? '取消点赞' : '点赞')} ${gameName(game)}`);
    like.setAttribute('aria-pressed', String(Boolean(game.liked)));
    like.addEventListener('click', async () => {
      like.disabled = true; feedback.textContent = '';
      try { Object.assign(game, await request(`games/${game.id}/like`, 'POST', { liked: !game.liked })); render(); }
      catch { feedback.textContent = '点赞暂时未能保存，请检查连接后重试。'; like.disabled = false; }
    });
    const download = game.download_url ? document.createElement('a') : document.createElement('span');
    download.className = 'game-download';
    download.textContent = game.download_url ? '下载游戏 ↗' : '下载准备中';
    if (download instanceof HTMLAnchorElement && game.download_url) {
      download.href = game.download_url; download.target = '_blank'; download.rel = 'noopener noreferrer';
    }
    if (game.showcase) { const note = document.createElement('span'); note.className = 'game-availability'; note.textContent = localize('推流接入中'); actions.append(note); }
    actions.append(like, download);
    content.append(title, description);
    if (gameTags[game.id]) {
      const tags = document.createElement('ul'); tags.className = 'game-tags';
      tags.setAttribute('aria-label', currentLanguage() === 'en' ? 'Game tags' : '游戏标签');
      gameTags[game.id].forEach(tag => { const item = document.createElement('li'); item.textContent = localize(tag); tags.append(item); });
      content.append(tags);
    }
    content.append(actions);
    const images = [...(game.image ? [{ url: game.image, label: game.image_label || '游戏视觉' }] : []), ...(game.images || [])]
      .filter((item, i, all) => all.findIndex(other => other.url === item.url) === i);
    if (images.length > 1) {
      const media = document.createElement('div'); media.className = 'game-media';
      images.forEach((item, i) => {
        const thumb = document.createElement('button'); thumb.setAttribute('aria-label', currentLanguage() === 'en' ? `View image ${i + 1}: ${localize(item.label)}` : `查看第 ${i + 1} 张图片：${localize(item.label)}`);
        const picture = document.createElement('img'); picture.src = item.url; picture.alt = ''; picture.loading = 'lazy';
        thumb.append(picture); thumb.addEventListener('click', () => {
          img.src = item.url; img.alt = localize(item.label); caption.textContent = localize(item.label);
          img.classList.toggle('browser-capture', item.url.endsWith('/mystic-forest-browser.png'));
        }); media.append(thumb);
      });
      content.append(media);
    }
    if (game.video) {
      const video = document.createElement('video'); video.controls = true; video.preload = 'none';
      video.src = game.video; video.className = 'game-preview-video';
      video.setAttribute('aria-label', `${gameName(game)} · ${currentLanguage() === 'en' ? 'Trailer' : '游戏预告'}`); content.append(video);
    }
    card.append(visual, content); library.append(card);
  });
}

export function setLibrarySession(active: boolean, gameId?: string) {
  activeGameId = active ? gameId || '' : '';
  const next = active && gameId && games.some(g => g.id === gameId) ? gameId : chosen;
  if (locked === active && next === chosen) return;
  locked = active; chosen = next;
  const game = games.find(g => g.id === chosen); if (game) updateStage(game);
  render();
}

export async function initLibrary() {
  window.addEventListener('chasheo:language', () => { render(); const game = games.find(g => g.id === chosen); if (game) updateStage(game); });
  updateStage(games[0]);
  render(); publishGames();
  if (!HAS_SERVICE) { feedback.textContent = '游戏服务离线，暂时展示本地预览。'; return; }
  try {
    const result = await request('games') as { games: Game[] };
    if (!Array.isArray(result.games) || !result.games.length) throw new Error('empty');
    games = result.games.some(g => g.id === neonPreview.id) ? result.games : [...result.games, neonPreview];
    if (activeGameId && games.some(g => g.id === activeGameId)) chosen = activeGameId;
    if (!games.some(g => g.id === chosen)) chosen = games[0].id;
    updateStage(games.find(g => g.id === chosen)!); render(); publishGames();
  } catch { feedback.textContent = '游戏目录暂时无法连接，显示已保存的预览。'; }
}
