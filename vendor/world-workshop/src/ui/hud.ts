import { loc, t, type StrKey } from '../i18n';
import type { GameEntry, Language, Mode, Section } from '../types';
import { CSS } from './styles';

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export interface HudCallbacks {
  takeover(): void;
  exitPlay(): void;
  retry(): void;
  rematch(): void;
  section(s: Section): void;
  toggleSound(): void;
  togglePause(): void;
  openLibrary(): void;
  selectGame(id: string): void;
  gateIndex(i: number): void;
  closeGate(): void;
  stick(x: number, y: number): void;
  touchAction(a: 'attack' | 'attackUp' | 'parry' | 'dodge' | 'jump' | 'use'): void;
}

let styleRefs = 0;
let styleEl: HTMLStyleElement | null = null;

export class Hud {
  root: HTMLDivElement;
  lang: Language = 'zh';
  private el: Record<string, HTMLElement> = {};
  /** animated loading cover (removed with the cover) */
  private introVid: HTMLVideoElement | null = null;
  private wordTimer = 0;
  games: GameEntry[] = [];
  gateIdx = 0;
  /** world gate still sealed (encounter not won): play is disabled, library stays available */
  locked = true;
  touch = false;
  private soundOn = false;

  constructor(container: HTMLElement, private cb: HudCallbacks, opts: { builtinBrowseUI: boolean; touch: boolean; assetUrl: (p: string) => string; introVideo?: boolean; reducedMotion?: boolean }) {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.dataset.ww = 'world-workshop';
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);
    }
    styleRefs++;
    this.touch = opts.touch;
    this.assetUrl = opts.assetUrl;
    this.root = h('div', 'ww-root') as HTMLDivElement;
    this.root.setAttribute('data-ww-root', '');
    // material skin textures (sliced from the round-10 UI atlas), resolved against the embed's asset base
    const ui: Record<string, string> = {
      paper: 'panels_paper', 'wood-band': 'panels_wood_band', 'bar-frame': 'hud_bar_frame', 'btn-cinnabar': 'buttons_cinnabar',
      'btn-paper': 'buttons_paper', 'btn-jade': 'buttons_jade', bronze: 'controls_bronze_disc', 'cell-empty': 'hud_cell_empty',
      'cell-filled': 'hud_cell_filled', 'brush-wide': 'decor_brush_wide', 'brush-thin': 'decor_brush_thin', 'ink-splat': 'decor_ink_splat', seal: 'decor_seal',
    };
    for (const [k, f] of Object.entries(ui)) this.root.style.setProperty('--ui-' + k, `url("${opts.assetUrl(`assets/ui/${f}.png`)}")`);
    container.appendChild(this.root);
    const E = this.el;
    // browse layer
    E.browse = h('div', 'ww-layer');
    const panel = h('div', 'ww-browse');
    E.title = h('div', 'ww-title');
    E.sub = h('div', 'ww-sub');
    E.chips = h('div', 'ww-chips');
    for (const s of ['arrival', 'courtyard', 'worlds'] as Section[]) {
      const c = h('button', 'ww-chip');
      c.dataset.s = s;
      c.addEventListener('click', () => cb.section(s));
      E.chips.appendChild(c);
    }
    E.progress = h('div', 'ww-progress');
    for (let i = 0; i < 12; i++) E.progress.appendChild(h('i'));
    E.progress.appendChild(h('b', '', '0%'));
    E.takeover = h('button', 'ww-btn primary ww-hide');
    E.takeover.addEventListener('click', () => cb.takeover());
    panel.append(E.title, E.sub, E.chips, E.progress, E.takeover);
    E.hint = h('div', 'ww-hint ww-hide');
    E.browse.append(panel, E.hint);
    if (!opts.builtinBrowseUI) panel.classList.add('ww-hide');
    // play hud
    E.hud = h('div', 'ww-hud ww-hide');
    const plate = h('div', 'ww-plate');
    E.heroName = h('div', 'ww-name');
    E.heroBar = h('div', 'ww-bar', '<u></u><i></i>');
    plate.append(E.heroName, E.heroBar);
    E.boss = h('div', 'ww-boss ww-hide');
    E.bossName = h('div', 'ww-name');
    E.bossBar = h('div', 'ww-bar', '<u></u><i></i>');
    E.postureBar = h('div', 'ww-bar posture', '<i></i>');
    E.boss.append(E.bossName, E.bossBar, E.postureBar);
    E.topRight = h('div', 'ww-top-right');
    E.soundBtn = h('button', 'ww-btn small');
    E.soundBtn.addEventListener('click', () => cb.toggleSound());
    E.pauseBtn = h('button', 'ww-btn small');
    E.pauseBtn.textContent = 'Ⅱ';
    E.pauseBtn.addEventListener('click', () => cb.togglePause());
    E.backBtn = h('button', 'ww-btn small cool');
    E.backBtn.addEventListener('click', () => cb.exitPlay());
    E.topRight.append(E.soundBtn, E.pauseBtn, E.backBtn);
    E.word = h('div', 'ww-word');
    E.counter = h('div', 'ww-counter');
    E.charge = h('div', 'ww-charge', '<i></i>');
    E.prompt = h('div', 'ww-prompt ww-hide');
    E.strip = h('div', 'ww-strip');
    E.bosscard = h('div', 'ww-bosscard', '<b></b><span></span>');
    E.hud.append(plate, E.boss, E.topRight, E.word, E.counter, E.charge, E.prompt, E.strip, E.bosscard);
    // overlays
    E.defeat = h('div', 'ww-center ww-hide');
    const dc = h('div', 'ww-card');
    E.defeatBig = h('div', 'big');
    E.defeatText = h('p');
    E.retryBtn = h('button', 'ww-btn primary');
    E.retryBtn.addEventListener('click', () => cb.retry());
    const drow = h('div', 'row');
    drow.append(E.retryBtn);
    dc.append(E.defeatBig, E.defeatText, drow);
    E.defeat.append(dc);
    E.victory = h('div', 'ww-center ww-hide');
    const vc = h('div', 'ww-card');
    E.victoryBig = h('div', 'big');
    E.victoryBig.style.color = 'var(--cool)';
    E.victoryText = h('p');
    const vrow = h('div', 'row');
    E.vLib = h('button', 'ww-btn primary');
    E.vLib.addEventListener('click', () => cb.openLibrary());
    E.vStay = h('button', 'ww-btn');
    E.vStay.addEventListener('click', () => this.showVictory(false));
    E.vAgain = h('button', 'ww-btn');
    E.vAgain.addEventListener('click', () => cb.rematch());
    vrow.append(E.vLib, E.vAgain, E.vStay);
    vc.append(E.victoryBig, E.victoryText, vrow);
    E.victory.append(vc);
    E.paused = h('div', 'ww-paused ww-hide');
    // gate panel
    E.gate = h('div', 'ww-gate ww-hide');
    // touch
    E.touch = h('div', 'ww-touch ww-hide');
    if (opts.touch) this.buildTouch(E.touch);
    this.root.append(E.browse, E.hud, E.defeat, E.victory, E.gate, E.touch, E.paused);
    // loading cover: the text-free key art (heroine between heaven and earth) over everything until the first 3D
    // frame, then it fades out on its own. The poster shows at once; the animated version of the same shot (wind in
    // her hair and ribbons, drifting cloud sea, moving sun rays; seamless 10 s loop) fades in over it as soon as it
    // can play. Visitors who prefer reduced motion keep the still poster.
    if (opts.introVideo !== false) {
      E.intro = h('div', 'ww-intro');
      const img = document.createElement('img');
      img.className = 'ww-intro-art';
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.decoding = 'async';
      img.setAttribute('fetchpriority', 'high');
      img.srcset = `${opts.assetUrl('assets/intro/heroine_poster_1440.jpg')} 1440w, ${opts.assetUrl('assets/intro/heroine_poster_2560.jpg')} 2560w`;
      // object-fit: cover on a 16:9 poster: the rendered width is the larger of the viewport width and 16/9 × its height
      img.sizes = 'max(100vw, 178vh)';
      img.src = opts.assetUrl('assets/intro/heroine_poster_1440.jpg');
      E.intro.append(img);
      if (!opts.reducedMotion) {
        const v = document.createElement('video');
        v.className = 'ww-intro-art ww-intro-video';
        v.muted = true;
        v.defaultMuted = true;
        v.loop = true;
        v.autoplay = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.setAttribute('aria-hidden', 'true');
        v.disablePictureInPicture = true;
        // same width rule as the poster: 1080p once the covered width exceeds ~1400 device pixels, else 720p
        const coverPx = Math.max(window.innerWidth, (window.innerHeight * 16) / 9) * Math.min(2, window.devicePixelRatio || 1);
        v.src = opts.assetUrl(coverPx > 1400 ? 'assets/intro/intro_loop_1080.mp4' : 'assets/intro/intro_loop_720.mp4');
        v.addEventListener('playing', () => v.classList.add('on'), { once: true });
        // autoplay refused or the file failed: the poster simply stays
        v.play()?.catch(() => undefined);
        this.introVid = v;
        E.intro.append(v);
      }
      E.introBar = h('div', 'ww-intro-bar', '<i></i>');
      E.intro.append(h('div', 'ww-intro-shade'), E.introBar);
      this.root.append(E.intro);
    }
    this.setLanguage('zh');
  }

  /** fade the loading cover out (after the first rendered 3D frame) */
  introOut() {
    const el = this.el.intro;
    if (!el || el.classList.contains('out')) return;
    el.classList.add('out');
    window.setTimeout(() => this.dropIntro(), 900);
  }

  private dropIntro() {
    const v = this.introVid;
    if (v) {
      // release the decoder and the network request
      v.pause();
      v.removeAttribute('src');
      v.load();
      this.introVid = null;
    }
    this.el.intro?.remove();
    delete this.el.intro;
  }
  private assetUrl: (p: string) => string;

  private buildTouch(layer: HTMLElement) {
    const stick = h('div', 'ww-stick', '<i></i>');
    const knob = stick.firstElementChild as HTMLElement;
    let id = -1;
    const R = 50;
    const upd = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      const l = Math.hypot(x, y);
      if (l > R) { x *= R / l; y *= R / l; }
      knob.style.transform = `translate(${x}px,${y}px)`;
      this.cb.stick(x / R, -y / R);
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); upd(e); e.preventDefault(); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) upd(e); });
    const end = (e: PointerEvent) => { if (e.pointerId !== id) return; id = -1; knob.style.transform = ''; this.cb.stick(0, 0); };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    const btns = h('div', 'ww-tbtns');
    const mk = (key: StrKey, cls: string, down: () => void, up?: () => void) => {
      const b = h('button', 'ww-btn ' + cls);
      b.dataset.k = key;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); down(); });
      if (up) { b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); }
      btns.appendChild(b);
    };
    mk('btnUse', '', () => this.cb.touchAction('use'));
    mk('btnJump', '', () => this.cb.touchAction('jump'));
    mk('btnParry', 'cool', () => this.cb.touchAction('parry'));
    mk('btnDodge', '', () => this.cb.touchAction('dodge'));
    mk('btnAttack', 'primary', () => this.cb.touchAction('attack'), () => this.cb.touchAction('attackUp'));
    layer.append(stick, btns);
  }

  setLanguage(l: Language) {
    this.lang = l;
    const E = this.el;
    E.title.textContent = t('title', l);
    E.sub.textContent = t('subtitle', l);
    E.takeover.textContent = t('takeover', l);
    const names: Record<Section, StrKey> = { arrival: 'sectionArrival', courtyard: 'sectionCourtyard', worlds: 'sectionWorlds' };
    E.chips.querySelectorAll<HTMLElement>('.ww-chip').forEach((c) => (c.textContent = t(names[c.dataset.s as Section], l)));
    E.hint.textContent = t('dragHint', l);
    E.heroName.textContent = t('heroine', l);
    E.bossName.textContent = t('guardian', l);
    E.backBtn.innerHTML = `${t('backHome', l)} <kbd>Esc</kbd>`;
    E.strip.textContent = this.touch ? t('controlsTouch', l) : t('controlsPC', l);
    E.defeatBig.textContent = t('dead', l);
    E.defeatText.textContent = t('deadSub', l);
    E.retryBtn.textContent = t('retry', l);
    E.victoryBig.textContent = t('victory', l);
    E.victoryText.textContent = t('victorySub', l);
    E.vLib.textContent = t('openLibrary', l);
    E.vStay.textContent = t('close', l);
    E.vAgain.textContent = t('rematch', l);
    E.counter.textContent = t('counter', l);
    E.paused.textContent = t('paused', l);
    (E.bosscard.firstElementChild as HTMLElement).textContent = t('guardian', l);
    (E.bosscard.lastElementChild as HTMLElement).textContent = t('guardianSub', l);
    E.touch.querySelectorAll<HTMLElement>('button[data-k]').forEach((b) => (b.textContent = t(b.dataset.k as StrKey, l)));
    this.setSound(this.soundOn);
    this.renderGate();
  }

  setSound(on: boolean) {
    this.soundOn = on;
    this.el.soundBtn.textContent = (on ? '♪ ' : '× ') + t('sound', this.lang);
  }

  setProgress(r: number) {
    const n = Math.round(r * 12);
    this.el.progress.querySelectorAll('i').forEach((e, i) => e.classList.toggle('on', i < n));
    (this.el.progress.querySelector('b') as HTMLElement).textContent = Math.round(r * 100) + '%';
    const bar = this.el.introBar?.firstElementChild as HTMLElement | null;
    if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, r))})`;
  }

  setReady() {
    this.el.progress.classList.add('ww-hide');
    this.el.takeover.classList.remove('ww-hide');
  }

  setMode(m: Mode, section: Section) {
    const E = this.el;
    E.browse.classList.toggle('ww-hide', m === 'play');
    E.hud.classList.toggle('ww-hide', m !== 'play');
    E.touch.classList.toggle('ww-hide', m !== 'play' || !this.touch);
    E.hint.classList.toggle('ww-hide', m !== 'inspect');
    E.chips.querySelectorAll<HTMLElement>('.ww-chip').forEach((c) => c.classList.toggle('on', c.dataset.s === section));
    if (m !== 'play') {
      E.defeat.classList.add('ww-hide');
      E.prompt.classList.add('ww-hide');
    }
  }

  setPaused(p: boolean) {
    this.el.paused.classList.toggle('ww-hide', !p);
  }

  bars(hero: number, boss: number | null, posture: number) {
    const E = this.el;
    const set = (bar: HTMLElement, v: number) => {
      (bar.querySelector('i') as HTMLElement).style.width = (v * 100).toFixed(1) + '%';
      const u = bar.querySelector('u') as HTMLElement | null;
      if (u) u.style.width = (v * 100).toFixed(1) + '%';
    };
    set(E.heroBar, hero);
    E.boss.classList.toggle('ww-hide', boss == null);
    if (boss != null) {
      set(E.bossBar, boss);
      (E.postureBar.querySelector('i') as HTMLElement).style.width = (posture * 100).toFixed(1) + '%';
    }
  }

  word(key: StrKey, kind: string) {
    const w = this.el.word;
    w.className = 'ww-word ' + kind;
    w.textContent = t(key, this.lang);
    void w.offsetWidth;
    w.classList.add('show');
    clearTimeout(this.wordTimer);
    this.wordTimer = window.setTimeout(() => w.classList.remove('show'), 900);
  }

  bossCard() {
    const b = this.el.bosscard;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  counter(on: boolean) {
    this.el.counter.classList.toggle('on', on);
  }

  charge(k: number) {
    this.el.charge.classList.toggle('on', k > 0);
    (this.el.charge.firstElementChild as HTMLElement).style.width = Math.min(100, k * 100).toFixed(0) + '%';
  }

  prompt(text: string | null) {
    this.el.prompt.classList.toggle('ww-hide', !text);
    if (text) this.el.prompt.textContent = text;
  }

  showDefeat(on: boolean) {
    this.el.defeat.classList.toggle('ww-hide', !on);
  }

  showVictory(on: boolean) {
    this.el.victory.classList.toggle('ww-hide', !on);
  }

  /* ---------------- gate / game card ---------------- */
  setGames(games: GameEntry[]) {
    this.games = games;
    this.gateIdx = Math.min(this.gateIdx, Math.max(0, games.length - 1));
    this.renderGate();
  }

  showGate(on: boolean) {
    this.el.gate.classList.toggle('ww-hide', !on || !this.games.length);
    if (!on) this.el.gate.querySelectorAll('video').forEach((v) => (v as HTMLVideoElement).pause());
    else this.el.gate.querySelectorAll('video').forEach((v) => (v as HTMLVideoElement).play().catch(() => undefined));
  }

  get gateVisible() {
    return !this.el.gate.classList.contains('ww-hide');
  }

  renderGate() {
    const g = this.games[this.gateIdx];
    const E = this.el;
    if (!E.gate) return;
    E.gate.innerHTML = '';
    if (!g) return;
    const l = this.lang;
    const x = h('button', 'ww-btn small x', '×');
    x.addEventListener('click', () => this.cb.closeGate());
    const cover = h('div', 'cover');
    if (g.cover) cover.style.backgroundImage = `url("${this.assetUrl(g.cover)}")`;
    if (g.video) {
      const v = document.createElement('video');
      v.src = this.assetUrl(g.video);
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'none';
      cover.appendChild(v);
    }
    const badgeKey: StrKey = g.availability === 'playable' ? 'playable' : g.availability === 'queue' ? 'queue' : g.availability === 'offline' ? 'offline' : 'showcaseOnly';
    const badge = h('span', 'badge ' + g.availability, t(badgeKey, l));
    cover.appendChild(badge);
    const body = h('div', 'body');
    body.appendChild(h('h3', '', escapeHtml(loc(g.title, l))));
    if (g.tags?.length) body.appendChild(h('div', 'tags', g.tags.map((x) => escapeHtml(loc(x, l))).join(' · ')));
    body.appendChild(h('p', '', escapeHtml(loc(g.description, l))));
    const row = h('div', 'row');
    const playable = g.availability === 'playable' || g.availability === 'queue';
    const canPlay = playable && !this.locked;
    const play = h('button', 'ww-btn primary small', !playable ? t('showcaseOnly', l) : this.locked ? t('gateSealed', l) : t('playGame', l)) as HTMLButtonElement;
    play.disabled = !canPlay;
    play.dataset.role = 'play';
    play.addEventListener('click', () => canPlay && this.cb.selectGame(g.id));
    const lib = h('button', 'ww-btn small', t('openLibrary', l));
    lib.dataset.role = 'library';
    lib.addEventListener('click', () => this.cb.openLibrary());
    row.append(play, lib);
    body.appendChild(row);
    if (playable) body.appendChild(h('div', 'tags', t('queueHint', l)));
    const nav = h('div', 'nav');
    const prev = h('button', 'ww-btn small', '‹ ' + t('prev', l));
    const next = h('button', 'ww-btn small', t('next', l) + ' ›');
    prev.addEventListener('click', () => this.cb.gateIndex((this.gateIdx - 1 + this.games.length) % this.games.length));
    next.addEventListener('click', () => this.cb.gateIndex((this.gateIdx + 1) % this.games.length));
    nav.append(prev, h('span', '', `${this.gateIdx + 1} / ${this.games.length}`), next);
    E.gate.append(x, cover, body);
    if (this.games.length > 1) E.gate.append(nav);
  }

  dispose() {
    clearTimeout(this.wordTimer);
    this.dropIntro();
    this.root.remove();
    styleRefs--;
    if (styleRefs <= 0 && styleEl) {
      styleEl.remove();
      styleEl = null;
      styleRefs = 0;
    }
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
