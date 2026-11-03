import { selectGameById } from './library';
import './delivered-workshop.css';

type Mode = 'browse' | 'inspect' | 'play';
type Section = 'arrival' | 'courtyard' | 'worlds';
type Game = { id: string; title: string; description: string; cover: string; availability: string };
type World = {
  ready: Promise<void>;
  setMode(mode: Mode): void;
  setSection(section: Section): void;
  setLanguage(language: 'zh' | 'en'): void;
  setGames(games: Game[]): void;
  pause(): void;
  resume(): void;
  getState(): { mode: Mode };
};

export async function initDeliveredWorkshop() {
  const container = document.getElementById('world-canvas')!;
  document.body.classList.add('world-loading');
  const enter = document.getElementById('workshop-enter') as HTMLButtonElement;
  const label = enter.querySelector<HTMLElement>('[data-workshop-label]')!;
  const lang = () => document.documentElement.lang.startsWith('en') ? 'en' : 'zh';
  const text = (zh: string, en: string) => lang() === 'en' ? en : zh;
  const inspect = document.createElement('button');
  inspect.type = 'button'; inspect.className = 'world-inspect';
  const exitInspect = document.createElement('button');
  exitInspect.type = 'button'; exitInspect.className = 'world-inspect-exit'; exitInspect.hidden = true;
  enter.after(inspect); document.body.append(exitInspect);
  let world: World | undefined;
  let selectedSection: Section = 'arrival';
  let pendingGames: Game[] = [];
  const updateText = () => {
    label.textContent = world ? text('进入工坊', 'Enter workshop') : text('正在准备工坊…', 'Preparing workshop…');
    inspect.textContent = text('自由观察', 'Look around');
    exitInspect.textContent = text('退出观察 ×', 'Exit observation ×');
    world?.setLanguage(lang());
  };
  const applyMode = (mode: Mode) => {
    document.body.classList.toggle('world-controlled', mode !== 'browse');
    document.body.classList.toggle('world-play', mode === 'play');
    document.querySelectorAll<HTMLElement>('header.masthead, main, footer.footer').forEach(el => { el.inert = mode === 'play'; });
    exitInspect.hidden = mode !== 'inspect';
  };
  const openLibrary = (id?: string) => {
    world?.setMode('browse');
    if (id) selectGameById(id);
    requestAnimationFrame(() => document.getElementById('play')?.scrollIntoView({ behavior: 'smooth' }));
  };
  window.addEventListener('chasheo:games', event => {
    pendingGames = (event as CustomEvent<Game[]>).detail;
    world?.setGames(pendingGames);
  });
  new MutationObserver(updateText).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  new MutationObserver(() => {
    if (document.body.classList.contains('is-playing')) world?.pause(); else world?.resume();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  enter.addEventListener('click', () => world?.setMode('play'));
  inspect.addEventListener('click', () => world?.setMode('inspect'));
  exitInspect.addEventListener('click', () => world?.setMode('browse'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && world?.getState().mode === 'inspect') world.setMode('browse'); });
  const syncSection = () => {
    if (world?.getState().mode !== 'browse') return;
    const play = document.getElementById('play')!.getBoundingClientRect().top;
    const comments = document.getElementById('guestbook')!.getBoundingClientRect().top;
    const next: Section = comments < innerHeight * .55 ? 'worlds' : play < innerHeight * .55 ? 'courtyard' : 'arrival';
    if (next !== selectedSection) { selectedSection = next; world?.setSection(next); }
  };
  window.addEventListener('scroll', syncSection, { passive: true });
  updateText(); inspect.disabled = true;
  try {
    const moduleUrl = new URL('/world-workshop/lib/world-workshop.js', location.origin).href;
    const { mount } = await import(/* @vite-ignore */ moduleUrl);
    world = mount(container, {
      assetBase: '/world-workshop/', language: lang(), games: pendingGames,
      builtinBrowseUI: false, introVideo: true,
      onOpenLibrary: () => openLibrary(), onSelectGame: (id: string) => openLibrary(id),
      onExitPlay: () => applyMode('browse'),
      onStateChange: (state: { mode: Mode }) => applyMode(state.mode),
    }) as World;
    if (pendingGames.length) world.setGames(pendingGames);
    await world.ready;
    document.body.classList.remove('world-loading');
    document.body.classList.add('has-3d');
    enter.disabled = false; inspect.disabled = false; updateText(); syncSection();
  } catch (error) {
    document.body.classList.remove('world-loading');
    console.error('Workshop could not load', error);
    label.textContent = text('工坊加载失败，请刷新重试', 'Workshop unavailable. Please reload.');
  }
}
