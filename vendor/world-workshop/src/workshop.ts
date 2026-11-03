import * as THREE from 'three';
import { Assets, disposeObject } from './core/assets';
import { AudioSys } from './core/audio';
import { Input } from './core/input';
import { makeAxe, makeDao } from './chars/weapons';
import { GUARD_GRIP, HERO_GRIP } from './chars/grips';
import { GUARDIAN_MAP, HEROINE2_MAP, Retargeter } from './chars/retarget';
import { Character } from './chars/character';
import { Ponytail } from './chars/ponytail';
import { trimRegion } from './chars/meshtrim';
import { Fighter } from './game/fighter';
import { Encounter, GUARD_POST } from './game/encounter';
import { CameraRig } from './game/camera';
import { HERO_MOVES, PARRY } from './game/moves';
import { Fx } from './fx/fx';
import { Post } from './fx/post';
import { buildWorld, type WorldBuild } from './world/world';
import { heightAt, houseInside, standAt } from './world/layout';
import { Hud } from './ui/hud';
import { t } from './i18n';
import type { EncounterState, GameEntry, Language, Mode, MountOptions, Section, WorkshopState } from './types';

const VICTORY_KEY = 'ww.world-workshop.victory.v1';

const HERO_CLIPS = ['idle', 'look', 'practice', 'walk', 'run', 'dodge', 'parry', 'light1', 'light2', 'light3', 'light4', 'heavy', 'counter', 'hit', 'death', 'jump', 'land', 'sprint'];
const GUARD_CLIPS = ['idle', 'look', 'taunt', 'walk', 'run', 'chop', 'sweep', 'back', 'axe1', 'axe2', 'axe3', 'slam1', 'slam2', 'slam3', 'recoil', 'stagger', 'knockdown', 'getup', 'defeated'];

export class Workshop {
  container: HTMLElement;
  opts: MountOptions;
  hud: Hud;
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  rig: CameraRig;
  input: Input;
  assets: Assets;
  audio!: AudioSys;
  world!: WorldBuild;
  hero!: Fighter;
  /** triangles cut from the generated heroine's fused side lock (QA) */
  heroTrimmed = 0;
  guard!: Fighter;
  enc!: Encounter;
  fx!: Fx;
  post!: Post;
  mode: Mode = 'browse';
  section: Section = 'arrival';
  language: Language = 'zh';
  games: GameEntry[] = [];
  quality: 'high' | 'low';
  ready = false;
  readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private raf = 0;
  private last = 0;
  private userPaused = false;
  private autoPaused = false;
  private hitstopT = 0;
  private gateOpen = 0;
  private gateTex = new Map<string, THREE.Texture>();
  private disposed = false;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private savedScroll: { y: number; overflow: string } | null = null;
  private reduced = false;
  private mql: MediaQueryList | null = null;
  private dprScale = 1;
  private fpsAcc = { t: 0, n: 0 };
  fps = 0;
  private soundWanted = false;
  private gateNear = false;
  private onVis = () => this.updateAutoPause();
  private onReduced = () => this.applyReduced();
  frameCount = 0;
  firstFrameMs = 0;
  loadMs = 0;
  buildMs = 0;
  private t0 = performance.now();

  constructor(container: HTMLElement, opts: MountOptions) {
    this.container = container;
    this.opts = opts;
    this.language = opts.language ?? 'zh';
    this.mode = opts.mode ?? 'browse';
    this.section = opts.section ?? 'arrival';
    this.games = opts.games ?? [];
    const touch = opts.touch ?? (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
    const weak = (navigator.hardwareConcurrency ?? 8) <= 4 || ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
    this.quality = opts.quality === 'high' ? 'high' : opts.quality === 'low' ? 'low' : touch || weak || innerWidth < 760 ? 'low' : 'high';
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.readyPromise = new Promise((r) => (this.resolveReady = r));
    const base = opts.assetBase ?? './';
    this.assets = new Assets(base, (r) => this.hud?.setProgress(r));
    this.hud = new Hud(container, {
      takeover: () => {
        this.opts.onEnterPlay?.();
        this.setMode('play');
      },
      exitPlay: () => this.exitPlay(),
      retry: () => this.retry(),
      rematch: () => this.rematch(),
      section: (s) => this.setSection(s),
      toggleSound: () => this.setSound(!this.soundWanted),
      togglePause: () => {
        if (this.userPaused) this.resume();
        else {
          this.pause();
          this.hud.setPaused(true);
        }
      },
      openLibrary: () => this.opts.onOpenLibrary?.(),
      selectGame: (id) => this.opts.onSelectGame?.(id),
      gateIndex: (i) => this.selectGate(i),
      closeGate: () => this.hud.showGate(false),
      stick: (x, y) => {
        this.input.stick.x = x;
        this.input.stick.y = y;
      },
      touchAction: (a) => {
        const s = this.input.state, now = this.enc ? this.enc.now : 0;
        if (a === 'attack') { s.attackPressed = now; s.attackDown = true; }
        if (a === 'attackUp') s.attackDown = false;
        if (a === 'parry') s.parryPressed = now;
        if (a === 'dodge') s.dodgePressed = now;
        if (a === 'jump') s.jumpPressed = now;
        if (a === 'use') s.usePressed = now;
      },
    }, { builtinBrowseUI: opts.builtinBrowseUI !== false, touch, assetUrl: (p) => this.assets.url(p), introVideo: opts.introVideo !== false, reducedMotion: opts.respectReducedMotion !== false && matchMedia('(prefers-reduced-motion: reduce)').matches });
    this.hud.setLanguage(this.language);
    this.hud.setGames(this.games);
    // renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false });
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'ww-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', t('title', this.language));
    this.hud.root.prepend(this.canvas);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.rig = new CameraRig(1);
    this.input = new Input(this.canvas);
    this.input.now = () => (this.enc ? this.enc.now : 0);
    this.input.onEscape = () => this.exitPlay();
    this.input.onRetry = () => {
      if (this.enc?.state === 'defeat') this.retry();
    };
    this.mql = matchMedia('(prefers-reduced-motion: reduce)');
    this.mql.addEventListener?.('change', this.onReduced);
    this.applyReduced();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.io = new IntersectionObserver((e) => {
      this.offscreen = !e[0].isIntersecting;
      this.updateAutoPause();
    });
    this.io.observe(container);
    document.addEventListener('visibilitychange', this.onVis);
    this.load().catch((e) => {
      console.error('[world-workshop] load failed', e);
      this.hud.introOut();
      this.hud.prompt('Load failed: ' + (e?.message ?? e));
    });
  }
  private offscreen = false;

  private applyReduced() {
    const pref = this.opts.respectReducedMotion !== false && !!this.mql?.matches;
    this.reduced = pref;
    this.rig.reduced = pref;
    this.hud.root.classList.toggle('ww-reduced', pref);
  }

  private async load() {
    const A = this.assets;
    const jobs: Promise<unknown>[] = [];
    // heroine.glb (Mixamo Kachujin) is kept only as the motion source skeleton; heroine2.glb is the visible heroine
    jobs.push(A.model('heroine', 'assets/models/heroine.glb'), A.model('heroine2', 'assets/models/heroine2.glb'), A.model('guardian', 'assets/models/guardian.glb'));
    jobs.push(A.pack('heroine', 'assets/anims/heroine'), A.pack('guardian', 'assets/anims/guardian'));
    const env = ['bamboo', 'tree_broad', 'tree_broad_far', 'pine', 'fir', 'fern', 'shrub_hb', 'shrub_box', 'grassclip', 'drygrass', 'mossrock', 'logpile', 'winejar', 'bucket', 'basket', 'lantern', 'stump', 'sacks', 'jar', 'barrel1'];
    for (const e of env) jobs.push(A.model('env_' + e, `assets/models/env/${e}.glb`));
    // realism round: detailed library vegetation (heavy hero trees only on the high tier) and library props
    const veg2 = this.quality === 'high'
      ? ['tree_broad_a', 'tree_broad_b', 'tree_maple', 'pine_a', 'pine_b', 'bamboo_a', 'bush_b', 'fern_a', 'grass_b']
      : ['fern_a', 'grass_b'];
    for (const e of veg2) jobs.push(A.model('v2_' + e, `assets/models/env2/${e}.glb`));
    const props2 = ['altar_table', 'anvil', 'bookcase', 'canopy_bed', 'drying_rack', 'hand_cart', 'incense_ding', 'jar_brown', 'jar_shelf', 'landscape_painting', 'lattice_screen', 'low_chest', 'ming_chair', 'porcelain_vase', 'scholar_desk', 'stone_lantern_a', 'stone_lantern_b', 'stone_lion', 'tea_set', 'water_vat', 'weapon_rack', 'workbench_b'];
    for (const e of props2) jobs.push(A.model('p2_' + e, `assets/models/props2/${e}.glb`));
    const tex: [string, boolean][] = [];
    const rough = ['paving', 'gravel', 'mud', 'pleaf', 'timber', 'plaster', 'wetrock', 'cliff', 'floorwood', 'rooftile', 'brick'];
    for (const k of ['paving', 'gravel', 'mud', 'moss', 'pleaf', 'timber', 'plaster', 'wetrock', 'cliff', 'lime', 'floorwood', 'rooftile', 'brick']) {
      tex.push([k + '_color', true], [k + '_normal', false]);
      if (rough.includes(k)) tex.push([k + '_roughness', false]);
    }
    for (const [k, s] of tex) jobs.push(A.texture(k, `assets/tex/${k}.jpg`, { srgb: s }));
    jobs.push(A.texture('leaf_atlas', 'assets/tex/leaf_atlas.png', { srgb: true, repeat: false }));
    jobs.push(A.texture('cut_flash', 'assets/fx/cut_flash.png', { srgb: true, repeat: false }));
    jobs.push(A.hdri('assets/tex/overcast.hdr'));
    const sounds = ['swing_light', 'swing_heavy', 'clash', 'clash_hit', 'parry', 'flesh', 'thud', 'dodge', 'guardbreak', 'gong', 'wind', 'rain', 'bgm_explore', 'bgm_battle', 'sting_victory', 'sting_death'];
    const soundJobs = sounds.map((s) => A.sound(s, `assets/audio/${s}.mp3`));
    await Promise.all(jobs);
    this.loadMs = performance.now() - this.t0;
    if (this.disposed) return;
    this.build();
    this.buildMs = performance.now() - this.t0;
    // audio decodes lazily; raw buffers may still be streaming in
    Promise.all(soundJobs).then(() => {
      if (this.audio) Object.assign((this.audio as unknown as { raw: Record<string, ArrayBuffer> }).raw, A.audio);
    });
  }

  private build() {
    const A = this.assets;
    const scene = this.scene;
    // environment lighting from the overcast HDR (PMREM-prefiltered), kept low so the dusk sun reads
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envRT = pmrem.fromEquirectangular(A.hdr!);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.3;
    pmrem.dispose();
    this.envRT = envRT;
    scene.fog = new THREE.FogExp2(new THREE.Color(0.47, 0.5, 0.53), 0.0125);
    this.world = buildWorld(A, this.quality);
    scene.add(this.world.root);
    this.rig.occluders = this.world.occluders;
    // characters
    const dao = makeDao(), axe = makeAxe();
    // the Mixamo source rig: never shown, it plays the pack clips that are baked onto both fighters' own skeletons
    const motionSrc = new Character(A.models.heroine.scene, { height: 1.68, rim: new THREE.Color(0, 0, 0) });
    motionSrc.load(A.packs.heroine, HERO_CLIPS);
    this.hero = new Fighter('heroine', A.models.heroine2.scene, 1.68, dao, HERO_GRIP, { radius: 0.32, hp: 100, rim: new THREE.Color(0.22, 0.3, 0.38), boneAlias: HEROINE2_MAP });
    this.hero.peakFallback = false; // the dao's edge lies on its base->tip line: only a real sweep through the body counts
    this.guard = new Fighter('guardian', A.models.guardian.scene, 2.08, axe, GUARD_GRIP, { radius: 0.46, hp: 300, rim: new THREE.Color(0.3, 0.16, 0.12), boneAlias: GUARDIAN_MAP });
    // both auto-rigs have their own rest orientations (A-pose): bake clips through the rest-pose retargeter
    this.hero.ch.loadRetargeted(A.packs.heroine, HERO_CLIPS, new Retargeter(motionSrc, this.hero.ch, HEROINE2_MAP, { headFromChest: true }));
    // the generated heroine's ponytail was skinned rigidly to her head: give it a simulated bone chain
    this.hero.hair = new Ponytail(this.hero.ch, { tieAbove: 0.18, behind: 0.07 });
    // the generated model fused a long side lock onto her right shoulder and breastplate (it moved with the torso,
    // looking pasted on): cut it back to a jaw-length lock that is skinned to the head; the armour behind it is
    // modelled. Box 1 = the lock over the breastplate, box 2 = its chest-skinned tail between jaw and collar.
    this.heroTrimmed =
      trimRegion(this.hero.ch, { min: [-0.2, 1.0, 0.1], max: [-0.03, 1.4, 0.3] }) +
      trimRegion(this.hero.ch, { min: [-0.12, 1.28, 0.065], max: [-0.03, 1.4, 0.3] });
    this.guard.ch.loadRetargeted(A.packs.guardian, GUARD_CLIPS, new Retargeter(motionSrc, this.guard.ch, GUARDIAN_MAP));
    motionSrc.dispose();
    this.hero.calibrate('walk', 'run', 'sprint');
    this.guard.calibrate('walk', 'run');
    this.hero.trail.uniforms.uColor.value.setRGB(0.72, 0.88, 1.0);
    this.guard.trail.uniforms.uColor.value.setRGB(1.0, 0.42, 0.22);
    this.guard.trail.life = 0.2;
    scene.add(this.hero.root, this.guard.root, this.hero.trail.mesh, this.guard.trail.mesh);
    this.fx = new Fx(A.textures.cut_flash);
    this.fx.groundAt = standAt;
    scene.add(this.fx.group);
    this.audio = new AudioSys({ ...A.audio });
    this.post = new Post(this.renderer, scene, this.rig.camera, this.quality);
    let persisted = false;
    try {
      persisted = localStorage.getItem(VICTORY_KEY) === '1';
    } catch {
      /* storage blocked */
    }
    this.enc = new Encounter(this.hero, this.guard, this.world.colliders, {
      fx: this.fx,
      audio: this.audio,
      post: this.post,
      shake: (a) => this.rig.shake(a),
      hitstop: (tt) => (this.hitstopT = Math.max(this.hitstopT, this.reduced ? tt * 0.5 : tt)),
      word: (k, kind) => this.hud.word(k, kind),
      onState: (s) => this.onEncounter(s),
      onBossCard: () => {
        this.hud.bossCard();
        this.audio.play('gong', 0.6);
      },
    }, persisted);
    if (persisted) {
      this.gateOpen = 1;
      this.hud.locked = false;
      this.hud.renderGate();
    }
    this.applyGateCover();
    this.rig.snapTo(this.section);
    this.resize();
    // warm up shaders to avoid first-swing hitches
    this.renderer.compile(scene, this.rig.camera);
    this.ready = true;
    this.hud.setReady();
    this.setMode(this.mode);
    this.start();
  }
  private envRT: THREE.WebGLRenderTarget | null = null;

  /* ---------------------------- loop ---------------------------- */
  private start() {
    if (this.raf || this.disposed) return;
    this.last = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      // rAF timestamps can precede the performance.now() stored at (re)start: never feed a negative step
      const wall = Math.max(0, (now - this.last) / 1000);
      const dt = Math.min(0.05, wall);
      this.last = Math.max(this.last, now);
      this.frame(dt);
      // resolution scaling and the reported FPS use real elapsed time (the simulation step is clamped)
      if (this.ready) this.adapt(Math.min(wall, 2));
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame(dt: number, render = true) {
    if (!this.ready) return;
    // hit-stop slows the simulation only (camera/UI keep running)
    let simDt = dt;
    if (this.hitstopT > 0) {
      this.hitstopT -= dt;
      simDt = dt * 0.06;
    }
    this.input.poll(dt);
    const inp = this.input.state;
    this.enc.update(simDt, this.mode, inp, this.rig.moveYaw, this.rig.camera.position);
    // gate interaction
    const ip = this.world.gate.interactPoint();
    const near = this.mode === 'play' && this.hero.pos.distanceTo(ip) < 3.2;
    if (near !== this.gateNear) {
      this.gateNear = near;
      if (!near && this.hud.gateVisible && this.mode === 'play') this.hud.showGate(false);
    }
    if (this.mode === 'play') {
      const nearFallen = !near && this.enc.canRematch && this.hero.pos.distanceTo(this.guard.pos) < 3.5;
      if (near && !this.hud.gateVisible) this.hud.prompt(this.enc.portalOpen ? t('enterGate', this.language) : t('gateLocked', this.language));
      else if (nearFallen) this.hud.prompt(t('rematchPrompt', this.language));
      else if (this.enc.state === 'dormant' && this.hero.pos.distanceTo(GUARD_POST) < 11 && this.hero.pos.distanceTo(GUARD_POST) > 7.5) this.hud.prompt(t('challenge', this.language));
      else this.hud.prompt(null);
      if (nearFallen && inp.usePressed > (this.lastUse ?? -1) && this.enc.now - inp.usePressed < 0.4) {
        this.lastUse = inp.usePressed;
        this.rematch();
      }
      if (near && inp.usePressed > (this.lastUse ?? -1)) {
        this.lastUse = inp.usePressed;
        if (this.hud.locked !== !this.enc.portalOpen) {
          this.hud.locked = !this.enc.portalOpen;
          this.hud.renderGate();
        }
        this.hud.showGate(!this.hud.gateVisible);
        this.audio.play(this.hud.gateVisible ? 'clash' : 'thud', 0.3, 1.6);
      }
    }
    // gate opening animation (persistent result)
    const target = this.enc.portalOpen ? 1 : 0;
    this.gateOpen += (target - this.gateOpen) * Math.min(1, dt * 0.6);
    if (target === 1 && this.gateOpen > 0.995) this.gateOpen = 1;
    this.world.gate.update(dt, this.gateOpen);
    const lanternK = 0.55 + this.gateOpen * 0.9;
    for (const l of this.world.lanternLights) l.intensity = 1.2 * lanternK;
    this.world.lanternMat.emissiveIntensity = 0.5 + this.gateOpen * 1.6;
    // camera
    const lock = this.mode === 'play' && this.enc.state === 'engaged' && this.enc.distHeroGuard() < 12 ? this.enc.guardChest() : null;
    // enterable houses: cut away the roof/upper walls of the house the heroine stands in and frame it from above
    const inside = this.mode === 'play' ? houseInside(this.hero.pos.x, this.hero.pos.z) : null;
    this.world.setCutaway(inside ? inside.id : null);
    this.rig.indoor = !!inside;
    this.rig.update(dt, this.mode, this.section, this.hero.pos, lock, { yaw: inp.camYaw, pitch: inp.camPitch, zoom: inp.zoom }, this.hero.yaw);
    inp.camYaw = inp.camPitch = inp.zoom = 0;
    // fx, world animation, post
    this.fx.update(simDt, this.rig.camera);
    const focus = this.mode === 'play' ? this.hero.pos : this.rig.target;
    this.world.update(this.reduced ? dt * 0.4 : dt, focus, this.rig.camera);
    this.world.leafFall.points.visible = !this.reduced || this.mode === 'play';
    this.post.update(dt, this.mode === 'play' ? this.enc.danger : 0, this.enc.heroState === 'dead' ? 0.7 : 0, this.reduced);
    // hud
    if (this.mode === 'play') {
      const engaged = this.enc.state === 'engaged';
      this.hud.bars(this.hero.hp / this.hero.maxHp, engaged ? this.guard.hp / this.guard.maxHp : null, this.enc.posture / 100);
      this.hud.counter(this.enc.now < this.enc.counterUntil);
      const m = this.hero.move;
      this.hud.charge(m?.id === 'heavy' && this.hero.charging && this.hero.moveT >= (m.charge?.from ?? 9) ? Math.min(1, 0.3 + this.hero.chargeHeld / (m.charge!.maxHold)) : 0);
    }
    if (!render) return;
    this.renderer.info.reset();
    this.post.renderFrame();
    this.frameCount++;
    if (this.frameCount === 1) {
      this.firstFrameMs = performance.now() - this.t0;
      this.hud.introOut(); // the live scene is on screen: dissolve the loading poster into it
    }
  }
  private lastUse = -1;

  /** dynamic resolution: keeps frame time near target by scaling the pixel ratio */
  private adapt(dt: number) {
    this.fpsAcc.t += dt;
    this.fpsAcc.n++;
    if (this.fpsAcc.t < 2) return;
    this.fps = this.fpsAcc.n / this.fpsAcc.t;
    this.fpsAcc.t = this.fpsAcc.n = 0;
    const target = this.quality === 'high' ? 55 : 30;
    let s = this.dprScale;
    if (this.fps < target - 6) s = Math.max(0.6, s - 0.1);
    else if (this.fps > target + 4 && s < 1) s = Math.min(1, s + 0.05);
    if (s !== this.dprScale) {
      this.dprScale = s;
      this.resize();
    }
  }

  /* ---------------------------- modes ---------------------------- */
  setMode(m: Mode) {
    const prev = this.mode;
    this.mode = m;
    this.input.setPlay(m === 'play');
    this.input.inspectActive = m === 'inspect';
    if (!this.ready) return;
    this.hud.setMode(m, this.section);
    if (m === 'play' && prev !== 'play') {
      // take over: lock host scroll (restored on exit), focus canvas, enable sound (explicit visitor action)
      if (this.opts.lockScrollInPlay !== false) {
        this.savedScroll = { y: window.scrollY, overflow: document.documentElement.style.overflow };
        document.documentElement.style.overflow = 'hidden';
      }
      this.canvas.focus({ preventScroll: true });
      this.rig.playYaw = this.rig.moveYaw;
      this.setSound(true);
      this.hud.showGate(false);
      this.hud.showVictory(false);
    }
    if (m !== 'play' && prev === 'play') {
      this.input.clear();
      if (this.savedScroll) {
        document.documentElement.style.overflow = this.savedScroll.overflow;
        window.scrollTo({ top: this.savedScroll.y, behavior: 'instant' as ScrollBehavior });
        this.savedScroll = null;
      }
      this.setSound(false);
      this.hud.showDefeat(false);
      this.hud.showVictory(false);
      this.hud.prompt(null);
    }
    this.syncGateLock();
    if (m !== 'play') this.hud.showGate(this.section === 'worlds' && this.opts.builtinBrowseUI !== false && this.mode === 'inspect');
    this.emit();
  }

  exitPlay() {
    if (this.mode !== 'play') return;
    this.setMode('browse');
    this.opts.onExitPlay?.();
  }

  setSection(s: Section) {
    this.section = s;
    if (!this.ready) return;
    this.rig.userYaw = this.rig.userPitch = this.rig.userZoom = 0;
    this.hud.setMode(this.mode, s);
    this.syncGateLock();
    if (this.mode !== 'play') this.hud.showGate(s === 'worlds' && this.opts.builtinBrowseUI !== false && this.mode === 'inspect');
    this.emit();
  }

  setLanguage(l: Language) {
    this.language = l;
    this.hud.setLanguage(l);
    this.emit();
  }

  setGames(g: GameEntry[]) {
    this.games = g;
    this.hud.gateIdx = 0;
    this.hud.setGames(g);
    for (const tx of this.gateTex.values()) tx.dispose();
    this.gateTex.clear();
    if (this.ready) this.applyGateCover();
  }

  private syncGateLock() {
    const locked = !this.enc?.portalOpen;
    if (this.hud.locked !== locked) {
      this.hud.locked = locked;
      this.hud.renderGate();
    }
  }

  private selectGate(i: number) {
    this.hud.gateIdx = i;
    this.hud.renderGate();
    this.hud.showGate(true);
    this.applyGateCover();
  }

  private applyGateCover() {
    const g = this.games[this.hud.gateIdx];
    if (!g) {
      this.world.gate.setCover(null, '#7fd6a4');
      return;
    }
    const accent = g.accent ?? (g.theme === 'scifi' || g.theme === 'racing' ? '#59d7ff' : '#7fd6a4');
    if (!g.cover) return this.world.gate.setCover(null, accent);
    const url = this.assets.url(g.cover);
    const cached = this.gateTex.get(url);
    if (cached) return this.world.gate.setCover(cached, accent);
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      url,
      (tx) => {
        tx.colorSpace = THREE.SRGBColorSpace;
        this.gateTex.set(url, tx);
        if (this.games[this.hud.gateIdx] === g) this.world.gate.setCover(tx, accent);
      },
      undefined,
      () => this.world.gate.setCover(null, accent),
    );
  }

  private onEncounter(s: EncounterState) {
    if (s === 'victory') {
      this.hud.locked = false;
      this.hud.renderGate();
      try {
        localStorage.setItem(VICTORY_KEY, '1');
      } catch {
        /* ignore */
      }
      this.audio.play('sting_victory', 0.8);
      this.audio.play('gong', 0.7, 0.9);
      this.audio.stopLoop('bgm_battle', 2);
      if (this.mode === 'play') this.hud.showVictory(true);
    }
    if (s === 'defeat') {
      this.hud.showDefeat(true);
      this.audio.stopLoop('bgm_battle', 1);
    }
    if (s === 'engaged') {
      this.audio.loop('bgm_battle', 0.35, 2);
      this.audio.stopLoop('bgm_explore', 2);
    }
    if (s === 'dormant' && this.mode === 'play') {
      this.audio.stopLoop('bgm_battle', 2);
      this.audio.loop('bgm_explore', 0.25, 2);
    }
    this.emit();
  }

  retry() {
    this.enc.retry();
    this.hud.showDefeat(false);
    if (this.mode === 'play') this.audio.loop('bgm_explore', 0.25, 2);
    this.emit();
  }

  /** rematch the beaten guardian; the gate stays open */
  rematch() {
    if (!this.enc.rematch()) return;
    this.hud.showVictory(false);
    this.audio.play('gong', 0.5, 1.1);
    this.emit();
  }

  async setSound(on: boolean) {
    this.soundWanted = on;
    this.hud.setSound(on);
    if (!this.audio) return;
    if (on) {
      await this.audio.enable();
      if (!this.soundWanted) return this.audio.disable();
      this.audio.loop('wind', 0.22);
      this.audio.loop('rain', 0.1);
      if (this.mode === 'play') this.audio.loop(this.enc?.state === 'engaged' ? 'bgm_battle' : 'bgm_explore', 0.28, 2);
    } else this.audio.disable();
  }

  pause() {
    this.userPaused = true;
    this.updateAutoPause();
    this.emit();
  }

  resume() {
    this.userPaused = false;
    this.hud.setPaused(false);
    this.updateAutoPause();
    this.emit();
  }

  private updateAutoPause() {
    this.autoPaused = document.hidden || this.offscreen;
    const run = !this.userPaused && !this.autoPaused && this.ready && !this.disposed;
    if (run) {
      // resume from now: paused time is never accumulated into the simulation
      this.last = performance.now();
      this.start();
      if (this.soundWanted) this.audio?.ctx?.resume().catch(() => undefined);
    } else {
      this.stop();
      this.input.clear();
      if (this.audio?.ctx?.state === 'running') this.audio.ctx.suspend().catch(() => undefined);
    }
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth), hgt = Math.max(1, this.container.clientHeight);
    const dprMax = this.quality === 'high' ? 1.5 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, dprMax) * this.dprScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, hgt, false);
    this.rig.camera.aspect = w / hgt;
    this.rig.camera.fov = w / hgt < 0.8 ? 58 : 42;
    this.rig.camera.updateProjectionMatrix();
    // keep the post chain at the same pixel ratio as the renderer (adaptive resolution changes it at runtime)
    this.post?.composer.setPixelRatio(dpr);
    this.post?.setSize(w, hgt);
  }

  getState(): WorkshopState {
    return {
      ready: this.ready,
      mode: this.mode,
      section: this.section,
      language: this.language,
      paused: this.userPaused,
      encounter: this.enc?.state ?? 'dormant',
      portalOpen: !!this.enc?.portalOpen,
      quality: this.quality,
    };
  }

  private emit() {
    this.opts.onStateChange?.(this.getState());
  }

  /** test/QA helpers (exposed by the standalone page only) */
  debug() {
    return {
      ws: this,
      tuning: PARRY,
      moves: HERO_MOVES,
      /** advance the simulation with a fixed step and no rendering (QA automation) */
      sim: (seconds: number, step = 1 / 60) => {
        const n = Math.round(seconds / step);
        for (let i = 0; i < n; i++) this.frame(step, false);
        return this.enc.now;
      },
      press: (k: 'attack' | 'attackUp' | 'parry' | 'dodge' | 'jump' | 'use') => {
        const s = this.input.state, now = this.enc.now;
        if (k === 'attack') { s.attackPressed = now; s.attackDown = true; }
        if (k === 'attackUp') s.attackDown = false;
        if (k === 'parry') s.parryPressed = now;
        if (k === 'dodge') s.dodgePressed = now;
        if (k === 'jump') s.jumpPressed = now;
        if (k === 'use') s.usePressed = now;
      },
      setMove: (x: number, y: number) => { this.input.stick.x = x; this.input.stick.y = y; },
      place: (hx: number, hz: number, gx?: number, gz?: number) => {
        this.hero.pos.set(hx, 0, hz);
        if (gx != null && gz != null) this.guard.pos.set(gx, 0, gz);
      },
      resetVictory: () => {
        try {
          localStorage.removeItem(VICTORY_KEY);
        } catch {
          /* ignore */
        }
      },
      rematch: () => this.rematch(),
      info: () => ({
        fps: +this.fps.toFixed(1),
        dpr: this.renderer.getPixelRatio(),
        calls: this.renderer.info.render.calls,
        tris: this.renderer.info.render.triangles,
        heroHP: this.hero?.hp,
        guardHP: this.guard?.hp,
        posture: this.enc?.posture,
        heroState: this.enc?.heroState,
        guardState: this.enc?.guardState,
        guardMove: this.guard?.move?.id ?? null,
        guardMoveT: this.guard?.moveT,
        heroMove: this.hero?.move?.id ?? null,
        encounter: this.enc?.state,
        stats: this.enc?.stats,
        dist: this.enc?.distHeroGuard(),
        firstFrameMs: Math.round(this.firstFrameMs),
        assetsLoadedMs: Math.round(this.loadMs),
        sceneBuiltMs: Math.round(this.buildMs),
        quality: this.quality,
      }),
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    if (this.mode === 'play') this.setMode('browse');
    document.removeEventListener('visibilitychange', this.onVis);
    this.mql?.removeEventListener?.('change', this.onReduced);
    this.io?.disconnect();
    this.ro?.disconnect();
    this.input.dispose();
    this.audio?.dispose();
    this.hero?.dispose();
    this.guard?.dispose();
    this.fx?.dispose();
    this.post?.dispose();
    this.world?.dispose();
    for (const tx of this.gateTex.values()) tx.dispose();
    this.envRT?.dispose();
    disposeObject(this.scene);
    this.assets.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.hud.dispose();
  }
}
