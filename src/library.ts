import { HAS_SERVICE } from './service';
import { request } from './community';

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
    id: g.id, title: g.title, description: g.description,
    cover: new URL(g.image || g.images?.[0]?.url || fallback.image!, location.origin).href,
    availability: g.showcase ? 'showcase' : 'playable'
  })) }));
}

function updateStage(game: Game) {
  const title = document.getElementById('stage-game-title')!;
  title.textContent = game.title.toUpperCase();
  const image = document.getElementById('stage-poster') as HTMLImageElement;
  image.src = game.image || game.images?.[0]?.url || fallback.image!;
  image.alt = `${game.title} 游戏视觉`;
  const disclosure = document.querySelector<HTMLElement>('.poster-disclosure');
  if (disclosure) disclosure.textContent = game.id === 'neon-embers'
    ? '游戏截图 / 入场后切换为实机画面' : '概念视觉 / 入场后切换为实机画面';
}

function render() {
  library.replaceChildren();
  games.forEach((game, index) => {
    const card = document.createElement('article');
    card.className = 'game-card' + (game.id === chosen ? ' selected' : '');
    const visual = document.createElement('div'); visual.className = 'game-card-visual';
    const img = document.createElement('img'); img.loading = 'lazy';
    img.src = game.image || game.images?.[0]?.url || fallback.image!; img.alt = `${game.title} 游戏视觉`;
    const badge = document.createElement('span'); badge.className = 'game-card-badge';
    badge.textContent = `WORLD ${String(index + 1).padStart(2, '0')} / ${game.id === chosen ? 'SELECTED' : 'EXPLORE'}`;
    const caption = document.createElement('span'); caption.className = 'game-card-caption';
    caption.textContent = game.image_label || '游戏视觉';
    visual.append(img, badge, caption);
    let coverTitle: HTMLElement | undefined;
    if (game.id === 'neon-embers') {
      coverTitle = document.createElement('div'); coverTitle.className = 'neon-cover-title';
      coverTitle.innerHTML = '<span>NEW HARBOR CITY</span><strong>霓虹余烬</strong><small>NEON EMBERS</small>';
      visual.append(coverTitle);
    }
    const content = document.createElement('div'); content.className = 'game-card-content';
    const title = document.createElement('h4'); title.textContent = game.title;
    const description = document.createElement('p'); description.textContent = game.description;
    const actions = document.createElement('div'); actions.className = 'game-card-actions';
    const choose = document.createElement('button'); choose.className = 'game-select';
    choose.textContent = game.showcase ? '推流接入中' : game.id === chosen ? '已选择 ✓' : '选择这个世界 ↗';
    choose.disabled = locked || Boolean(game.showcase); choose.setAttribute('aria-pressed', String(game.id === chosen));
    choose.addEventListener('click', () => { chosen = game.id; updateStage(game); render(); });
    const like = document.createElement('button'); like.className = 'game-like';
    like.disabled = !HAS_SERVICE || typeof game.likes !== 'number';
    like.textContent = `${game.liked ? '♥' : '♡'} ${typeof game.likes === 'number' ? game.likes : '—'}`;
    like.setAttribute('aria-label', game.liked ? `取消点赞 ${game.title}` : `点赞 ${game.title}`);
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
    actions.append(choose, like, download);
    content.append(title, description, actions);
    const images = [...(game.image ? [{ url: game.image, label: game.image_label || '游戏视觉' }] : []), ...(game.images || [])]
      .filter((item, i, all) => all.findIndex(other => other.url === item.url) === i);
    if (images.length > 1) {
      const media = document.createElement('div'); media.className = 'game-media';
      images.forEach((item, i) => {
        const thumb = document.createElement('button'); thumb.setAttribute('aria-label', `查看第 ${i + 1} 张图片：${item.label}`);
        const picture = document.createElement('img'); picture.src = item.url; picture.alt = ''; picture.loading = 'lazy';
        thumb.append(picture); thumb.addEventListener('click', () => {
          img.src = item.url; img.alt = item.label; caption.textContent = item.label;
          if (coverTitle) coverTitle.hidden = item.url !== game.image;
          img.classList.toggle('browser-capture', item.url.endsWith('/mystic-forest-browser.png'));
        }); media.append(thumb);
      });
      content.append(media);
    }
    if (game.video) {
      const video = document.createElement('video'); video.controls = true; video.preload = 'none';
      video.src = game.video; video.className = 'game-preview-video';
      video.setAttribute('aria-label', `${game.title} 游戏预告`); content.append(video);
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
  render(); publishGames();
  if (!HAS_SERVICE) { feedback.textContent = '世界服务离线，暂时展示本地预览。'; return; }
  try {
    const result = await request('games') as { games: Game[] };
    if (!Array.isArray(result.games) || !result.games.length) throw new Error('empty');
    games = result.games.some(g => g.id === neonPreview.id) ? result.games : [...result.games, neonPreview];
    if (activeGameId && games.some(g => g.id === activeGameId)) chosen = activeGameId;
    if (!games.some(g => g.id === chosen)) chosen = games[0].id;
    updateStage(games.find(g => g.id === chosen)!); render(); publishGames();
  } catch { feedback.textContent = '世界目录暂时无法连接，显示已保存的预览。'; }
}
