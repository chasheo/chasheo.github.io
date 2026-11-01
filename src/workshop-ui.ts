import './workshop.css';

type WorkshopState = { playerHealth: number; enemyHealth: number; maxPlayerHealth?: number; maxEnemyHealth?: number; won: boolean; lost: boolean; mode?: string; objective?: string; canEnterPortal?: boolean;combo?:number;counterReady?:boolean;feedback?:string };
const copy = {
  title: ['世界工坊', 'World Workshop'], subtitle: ['山间试炼', 'Mountain trial'],
  enter: ['进入工坊', 'Enter workshop'], loading: ['正在准备工坊…', 'Preparing workshop…'], failed: ['工坊加载失败，刷新重试', 'Workshop unavailable. Reload to retry.'],
  observe: ['自由观察', 'Look around'], resume: ['继续试炼', 'Resume trial'], exit: ['返回主页', 'Back to website'],
  player: ['女侠', 'Wanderer'], enemy: ['守关者', 'Sentinel'], objective: ['击败守关者，唤醒世界入口。', 'Defeat the sentinel to awaken the world gate.'],
  observing: ['拖动环顾院落，滚轮调整距离。', 'Drag to orbit the courtyard. Scroll to zoom.'],
  hint: ['WASD 移动 · 左键 / J 连击 · 右键 / K 弹反 · 空格闪避 · 拖动观察', 'WASD Move · Left click / J Combo · Right click / K Parry · Space Dodge · Drag to look'],
  win: ['世界，为你开启。', 'A world opens for you.'], winBody: ['试炼完成。选择下一场探索，或留在工坊继续练习。', 'Trial complete. Choose your next world, or stay and practice.'],
  lose: ['再来一次。', 'One more try.'], loseBody: ['留意守关者的起手，闪避后寻找出剑的时机。', 'Watch the sentinel’s wind-up. Dodge, then find your opening.'],
  library: ['进入游戏库', 'Explore the games'], retry: ['重新试炼', 'Try again'], attack: ['连击', 'Combo'], dodge: ['闪避', 'Dodge'],parry:['弹反','Parry'],
  stay: ['留在工坊', 'Stay in the workshop'], portal: ['穿过光门', 'Enter the gate'], gateOpen: ['入口已开启，靠近光门按 E 进入游戏库。', 'The gate is open. Approach it and press E to explore the games.'],
  forward: ['向前移动', 'Move forward'], left: ['向左移动', 'Move left'], back: ['向后移动', 'Move backward'], right: ['向右移动', 'Move right'],
  caseTitle: ['下一站，由你选择。', 'Choose your next world.'], caseBody: ['同一座工坊，通往不同世界。', 'One workshop. Different worlds.'],
  forest: ['森林入口', 'Forest gate'], orbital: ['轨道车库', 'Orbital garage'], available: ['已接入游戏', 'Game connected'], concept: ['展示样例 · 未接入游戏', 'Display concept · no game connected'],
  caseNote: ['入口预览不占用游玩席位。', 'Previewing a gate does not reserve a play session.'],
  forestNote: ['Mystic Forest · 进入游戏库可领取入场券。', 'Mystic Forest · Join the queue from the game library.'],
  orbitalNote: ['Orbital Garage · 独立主题展示，暂未提供游玩。', 'Orbital Garage · An alternate theme, with no playable game yet.'],
  forestArt: ['森林入口概念视觉', 'Forest gate concept art'], orbitalArt: ['轨道车库建筑概念图', 'Orbital garage architectural concept'],
} as const;
type CopyKey = keyof typeof copy;

export function initWorkshopUI() {
  if (document.getElementById('workshop-hud')) return;
  let ready = false;
  let failed = false;
  let active = false;
  let resultDismissed = false;
  let theme: 'forest' | 'orbital' = 'forest';
  let beforeFocus: HTMLElement | null = null;
  let last: WorkshopState = { playerHealth: 100, enemyHealth: 100, won: false, lost: false, mode: 'explore' };
  const english = () => document.documentElement.lang.startsWith('en');
  const t = (key: CopyKey) => copy[key][english() ? 1 : 0];
  const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(`workshop:${name}`, { detail }));
  const hud = document.createElement('section');
  hud.id = 'workshop-hud';
  hud.className = 'workshop-hud';
  hud.hidden = true;
  hud.setAttribute('role', 'dialog');
  hud.setAttribute('aria-modal', 'true');
  hud.setAttribute('aria-labelledby', 'workshop-title');
  hud.tabIndex = -1;
  hud.innerHTML = `
    <div class="workshop-topbar">
      <div class="workshop-wordmark"><span data-wcopy="subtitle"></span><strong id="workshop-title" data-wcopy="title"></strong></div>
      <div class="workshop-tools"><button type="button" id="workshop-observe"></button><button type="button" id="workshop-language"></button><button type="button" id="workshop-exit" data-wcopy="exit"></button></div>
    </div>
    <div class="workshop-vitals"><div class="workshop-health"><div><span data-wcopy="player"></span><span id="workshop-player-value">100</span></div><div class="workshop-health-track" role="progressbar" aria-label="女侠生命值" aria-valuemin="0" aria-valuemax="100" id="workshop-player-meter"><i></i></div></div><div class="workshop-health enemy"><div><span data-wcopy="enemy"></span><span id="workshop-enemy-value">100</span></div><div class="workshop-health-track" role="progressbar" aria-label="守关者生命值" aria-valuemin="0" aria-valuemax="100" id="workshop-enemy-meter"><i></i></div></div></div>
    <p class="workshop-objective" id="workshop-objective"></p>
    <div class="workshop-result" id="workshop-result" hidden aria-live="polite"><span class="workshop-result-mark" aria-hidden="true">✧</span><h2 id="workshop-result-title"></h2><p id="workshop-result-body"></p><div class="workshop-result-actions"><button type="button" id="workshop-library" data-wcopy="library"></button><button type="button" id="workshop-retry" data-wcopy="retry"></button><button type="button" id="workshop-stay" data-wcopy="stay"></button></div></div>
    <button type="button" class="workshop-portal-action" id="workshop-portal" data-wcopy="portal" hidden></button>
    <p class="workshop-keyboard" data-wcopy="hint"></p>
    <div class="workshop-touch" id="workshop-touch"><div class="workshop-pad"><button type="button" class="up" data-wkey="w" data-wlabel="forward">↑</button><button type="button" class="left" data-wkey="a" data-wlabel="left">←</button><button type="button" class="down" data-wkey="s" data-wlabel="back">↓</button><button type="button" class="right" data-wkey="d" data-wlabel="right">→</button></div><div class="workshop-touch-actions"><button type="button" data-wkey="dodge" data-wcopy="dodge"></button><button type="button" data-wkey="attack" data-wcopy="attack"></button></div></div>`;
  document.body.append(hud);
  const combatHint=document.createElement('p');combatHint.className='workshop-combat-hint';hud.append(combatHint);
  const parryButton=document.createElement('button');parryButton.type='button';parryButton.dataset.wkey='parry';parryButton.dataset.wcopy='parry';hud.querySelector('.workshop-touch-actions')?.prepend(parryButton);
  const seatNotice = document.createElement('button');
  seatNotice.type = 'button'; seatNotice.className = 'workshop-seat-notice'; seatNotice.hidden = true;
  hud.append(seatNotice);
  seatNotice.addEventListener('click', () => { emit('exit'); document.getElementById('play')?.scrollIntoView({ behavior: 'smooth' }); });
  window.addEventListener('workshop:seat', event => {
    const seat = (event as CustomEvent<{offered: boolean; seconds: number}>).detail;
    seatNotice.hidden = !seat.offered;
    seatNotice.textContent = english() ? `Your game seat is ready · ${seat.seconds}s · Choose a game →` : `轮到你了 · ${seat.seconds} 秒内选择游戏 →`;
  });
  const cases = document.createElement('section');
  cases.className = 'workshop-cases section-wrap';
  cases.setAttribute('aria-labelledby', 'workshop-cases-title');
  cases.innerHTML = `<div class="workshop-cases-heading"><h2 id="workshop-cases-title" data-wcopy="caseTitle"></h2><p data-wcopy="caseBody"></p></div><div class="workshop-case-options"><button type="button" data-workshop-theme="forest" aria-pressed="true"><div class="workshop-case-art"><img src="/media/forest-portal.png" alt="森林入口概念视觉" data-walt="forestArt" loading="lazy"/><span data-wcopy="forestArt"></span></div><div class="workshop-case-info"><span>01</span><div><strong>Mystic Forest</strong><small data-wcopy="available"></small></div><i aria-hidden="true">↗</i></div></button><button type="button" data-workshop-theme="orbital" aria-pressed="false"><div class="workshop-case-art"><img src="/media/workshop/orbital-garage-concept.svg" alt="轨道车库建筑概念图" data-walt="orbitalArt" loading="lazy"/><span data-wcopy="orbitalArt"></span></div><div class="workshop-case-info"><span>02</span><div><strong>Orbital Garage</strong><small data-wcopy="concept"></small></div><i aria-hidden="true">↗</i></div></button></div><p class="workshop-case-note" id="workshop-case-note"></p>`;
  document.querySelector('.stats-band')?.after(cases);

  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const setText = (id: string, value: string) => { const node = el(id); if (node.textContent !== value) node.textContent = value; };
  const entry = el<HTMLButtonElement>('workshop-enter');
  function texts() {
    for (const root of [hud, cases]) {
      root.querySelectorAll<HTMLElement>('[data-wcopy]').forEach(node => { node.textContent = t(node.dataset.wcopy as CopyKey); });
      root.querySelectorAll<HTMLElement>('[data-wlabel]').forEach(node => node.setAttribute('aria-label', t(node.dataset.wlabel as CopyKey)));
      root.querySelectorAll<HTMLElement>('[data-walt]').forEach(node => node.setAttribute('alt', t(node.dataset.walt as CopyKey)));
    }
    if (entry) {
      const label = entry.querySelector('[data-workshop-label]');
      if (label) label.textContent = t(failed ? 'failed' : ready ? 'enter' : 'loading');
      entry.disabled = !ready;
    }
    el('workshop-language').textContent = english() ? 'EN / 中文' : '中文 / EN';
    el('workshop-language').setAttribute('aria-label', english() ? '切换到中文' : 'Switch to English');
    el('workshop-player-meter').setAttribute('aria-label', english() ? 'Wanderer health' : '女侠生命值');
    el('workshop-enemy-meter').setAttribute('aria-label', english() ? 'Sentinel health' : '守关者生命值');
    el('workshop-case-note').textContent = t(theme === 'forest' ? 'forestNote' : 'orbitalNote');
    render(last);
  }
  function render(state: WorkshopState) {
    if (!state.won && !state.lost) resultDismissed = false;
    last = state;
    combatHint.textContent=state.feedback==='parry'?(english()?'PARRY · Attack now to counter':'震刀成功 · 立即攻击可反击'):state.feedback==='heavy'?(english()?'HEAVY HIT · Guard broken':'重击命中 · 击退破招'):state.counterReady?(english()?'COUNTER READY':'反击窗口已开启'):state.combo?(english()?`COMBO ${state.combo} / 3 · Finish with a heavy strike`:`连击 ${state.combo} / 3 · 末段重击`):(english()?'Light hits do not interrupt. Parry at impact, then counter.':'轻击不会打断敌人 · 迎击瞬间弹反，随后反击');
    const health = (prefix: 'player' | 'enemy', value: number, max: number) => {
      const safe = Math.max(0, Math.min(max, value));
      setText(`workshop-${prefix}-value`, String(Math.ceil(safe)));
      const meter = el(`workshop-${prefix}-meter`);
      meter.setAttribute('aria-valuenow', String(Math.round(safe)));
      meter.setAttribute('aria-valuemax', String(max));
      meter.querySelector<HTMLElement>('i')!.style.transform = `scaleX(${safe / Math.max(1, max)})`;
    };
    health('player', state.playerHealth, state.maxPlayerHealth || 100);
    health('enemy', state.enemyHealth, state.maxEnemyHealth || 100);
    const observe = state.mode === 'observe';
    setText('workshop-observe', t(observe ? 'resume' : 'observe'));
    el('workshop-observe').setAttribute('aria-pressed', String(observe));
    setText('workshop-objective', t(observe ? 'observing' : state.won ? 'gateOpen' : 'objective'));
    const finished = state.won || state.lost;
    const showingResult = finished && !resultDismissed;
    el('workshop-result').hidden = !showingResult;
    setText('workshop-result-title', t(state.won ? 'win' : 'lose'));
    setText('workshop-result-body', t(state.won ? 'winBody' : 'loseBody'));
    el('workshop-library').hidden = !state.won;
    el('workshop-stay').hidden = !state.won;
    el('workshop-portal').hidden = !state.canEnterPortal || !state.won || showingResult || observe;
    el('workshop-touch').classList.toggle('inactive', observe || showingResult || state.lost);
    hud.classList.toggle('finished', showingResult);
  }
  function setActive(value: boolean) {
    if (active === value) return;
    active = value;
    if (value) beforeFocus = document.activeElement as HTMLElement;
    hud.hidden = !value;
    document.body.classList.toggle('workshop-active', value);
    document.querySelectorAll<HTMLElement>('body > main, body > header, body > footer').forEach(node => { node.inert = value; });
    if (value) hud.focus({ preventScroll: true });
    else { releaseInputs(); beforeFocus?.focus({ preventScroll: true }); }
  }
  const pressed = new Set<string>();
  function releaseInputs() { pressed.forEach(key => emit('input', { key, pressed: false })); pressed.clear(); hud.querySelectorAll('.pressed').forEach(node => node.classList.remove('pressed')); }
  entry?.addEventListener('click', () => { if (ready) emit('start'); });
  el('workshop-exit').addEventListener('click', () => emit('exit'));
  el('workshop-observe').addEventListener('click', () => { releaseInputs(); emit('observe'); });
  el('workshop-language').addEventListener('click', () => document.querySelector<HTMLButtonElement>('.language-toggle')?.click());
  el('workshop-retry').addEventListener('click', () => { emit('retry'); hud.focus({ preventScroll: true }); });
  el('workshop-stay').addEventListener('click', () => { resultDismissed = true; render(last); hud.focus({ preventScroll: true }); });
  el('workshop-portal').addEventListener('click', () => emit('portal'));
  el('workshop-library').addEventListener('click', () => { emit('exit'); location.hash = 'play'; el('play').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); });
  hud.querySelectorAll<HTMLButtonElement>('[data-wkey]').forEach(button => {
    const key = button.dataset.wkey!;
    button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); pressed.add(key); button.classList.add('pressed'); emit('input', { key, pressed: true }); });
    const release = () => { if (pressed.delete(key)) emit('input', { key, pressed: false }); button.classList.remove('pressed'); };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  });
  cases.querySelectorAll<HTMLButtonElement>('[data-workshop-theme]').forEach(button => button.addEventListener('click', () => {
    theme = button.dataset.workshopTheme as typeof theme;
    cases.querySelectorAll('[data-workshop-theme]').forEach(node => node.setAttribute('aria-pressed', String((node as HTMLElement).dataset.workshopTheme === theme)));
    texts();
    emit('theme', { theme });
  }));
  window.addEventListener('workshop:start', () => setActive(true));
  window.addEventListener('workshop:exit', () => setActive(false));
  window.addEventListener('workshop:ready', event => { const detail = (event as CustomEvent<{ready: boolean; error?: string}>).detail; ready = detail.ready; failed = Boolean(detail.error); texts(); });
  window.addEventListener('workshop:state', event => render((event as CustomEvent<WorkshopState>).detail));
  window.addEventListener('blur', releaseInputs);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseInputs(); });
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); emit('exit'); }
    if (event.key === 'Tab') {
      const controls = [...hud.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(node => !node.hidden && node.offsetParent !== null);
      const first = controls[0]; const lastControl = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); lastControl?.focus(); }
      else if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); first?.focus(); }
    }
  });
  new MutationObserver(texts).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  texts();
}
