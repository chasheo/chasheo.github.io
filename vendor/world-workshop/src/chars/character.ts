import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimPack, canonicalBone, type DecodedClip } from '../core/animpack';

export interface PlayOpts {
  fade?: number;
  loop?: boolean;
  speed?: number;
  /** start offset in seconds */
  at?: number;
  /** restart even if already playing */
  restart?: boolean;
}

export interface CharacterOpts {
  height: number;
  rim: THREE.Color;
  /** material fixups by material name substring */
  alphaTestFor?: string[];
  envIntensity?: number;
  /** canonical (Mixamo) bone name -> node name, for rigs that do not use Mixamo names */
  boneAlias?: Record<string, string>;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Skinned humanoid with Mixamo skeleton, animation playback, root-motion extraction and readable shading. */
export class Character {
  root = new THREE.Group(); // world transform (yaw + position)
  body: THREE.Object3D; // scaled/oriented model
  mixer: THREE.AnimationMixer;
  bones = new Map<string, THREE.Bone>();
  boneMap = new Map<string, string>();
  clips = new Map<string, DecodedClip>();
  actions = new Map<string, THREE.AnimationAction>();
  current: THREE.AnimationAction | null = null;
  currentName = '';
  hipsRestY = 100;
  modelScale = 1;
  materials: THREE.MeshStandardMaterial[] = [];
  uniforms = {
    uRim: { value: new THREE.Color(0, 0, 0) },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    /** world-space centre of a local hit flash; uFlashR = 0 means the whole body */
    uFlashPos: { value: new THREE.Vector3() },
    uFlashR: { value: 0 },
    uCharge: { value: 0 },
  };
  private rootPrevT = 0;
  private flashT = 0;
  private flashDur = 0.12;
  meshes: THREE.SkinnedMesh[] = [];

  constructor(src: THREE.Object3D, public opts: CharacterOpts) {
    const model = SkeletonUtils.clone(src);
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        const c = canonicalBone(o.name);
        if (!this.bones.has(c)) {
          this.bones.set(c, o as THREE.Bone);
          this.boneMap.set(c, o.name);
        }
      }
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        if (m.isSkinnedMesh) this.meshes.push(m);
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const out = mats.map((mt) => this.prepMaterial(mt as THREE.MeshStandardMaterial));
        m.material = Array.isArray(m.material) ? out : out[0];
      }
    });
    if (opts.boneAlias) {
      for (const [canon, node] of Object.entries(opts.boneAlias)) {
        let found: THREE.Bone | undefined;
        model.traverse((o) => {
          if (!found && (o as THREE.Bone).isBone && o.name === node) found = o as THREE.Bone;
        });
        if (found) {
          this.bones.set(canon, found);
          this.boneMap.set(canon, node);
        }
      }
    }
    const hips = this.bones.get('Hips');
    if (!hips) throw new Error('[character] no Hips bone');
    this.hipsRestY = hips.position.y;

    // orientation: make the model face +Z based on leg positions at bind pose
    const L = this.bones.get('LeftUpLeg')!, R = this.bones.get('RightUpLeg')!;
    const lp = L.getWorldPosition(new THREE.Vector3()), rp = R.getWorldPosition(new THREE.Vector3());
    const left = lp.sub(rp).setY(0).normalize();
    const fwd = new THREE.Vector3().crossVectors(left, new THREE.Vector3(0, 1, 0)).normalize();
    const yaw = Math.atan2(fwd.x, fwd.z);
    const holder = new THREE.Group();
    holder.add(model);
    holder.rotation.y = -yaw;
    // scale to height using head top estimate (Head bone + margin) vs foot
    const box = new THREE.Box3();
    for (const sm of this.meshes) {
      sm.geometry.computeBoundingBox();
      sm.skeleton.update();
    }
    box.setFromObject(model, true);
    const h = box.max.y - box.min.y;
    this.modelScale = opts.height / h;
    holder.scale.setScalar(this.modelScale);
    holder.position.y = -box.min.y * this.modelScale;
    this.body = holder;
    this.root.add(holder);
    this.mixer = new THREE.AnimationMixer(model);
  }

  private prepMaterial(src: THREE.MeshStandardMaterial) {
    const mt = src.clone() as THREE.MeshStandardMaterial;
    if (mt.map) mt.map.anisotropy = 8;
    const name = (mt.name || '').toLowerCase();
    if (mt.transparent || this.opts.alphaTestFor?.some((s) => name.includes(s))) {
      mt.transparent = false;
      mt.alphaTest = 0.45;
      mt.depthWrite = true;
      mt.side = THREE.DoubleSide;
    }
    mt.envMapIntensity = this.opts.envIntensity ?? 0.9;
    const u = this.uniforms;
    mt.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = u.uRim;
      sh.uniforms.uFlash = u.uFlash;
      sh.uniforms.uFlashColor = u.uFlashColor;
      sh.uniforms.uFlashPos = u.uFlashPos;
      sh.uniforms.uFlashR = u.uFlashR;
      sh.uniforms.uCharge = u.uCharge;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPosF;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPosF = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uFlash; uniform vec3 uFlashColor; uniform vec3 uFlashPos; uniform float uFlashR; uniform float uCharge; varying vec3 vWPosF;')
        .replace(
          '#include <opaque_fragment>',
          `{ float fr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
             outgoingLight += uRim * fr + vec3(0.95,0.55,0.25) * uCharge * fr * 1.6;
             // hit flash: a soft spot around the impact point (or the whole body when uFlashR == 0)
             float fl = uFlash;
             if (uFlashR > 0.0) fl *= 1.0 - smoothstep(uFlashR * 0.25, uFlashR, distance(vWPosF, uFlashPos));
             outgoingLight = mix(outgoingLight, uFlashColor, fl * (0.35 + 0.65 * fr)); }
           #include <opaque_fragment>`,
        );
    };
    mt.customProgramCacheKey = () => 'ww-char-rim-v2';
    this.materials.push(mt);
    return mt;
  }

  load(pack: AnimPack, names: string[], alias: Record<string, string> = {}) {
    for (const n of names) {
      const src = alias[n] ?? n;
      if (!pack.has(src)) {
        console.warn('[character] clip not in pack', src);
        continue;
      }
      const d = pack.decode(src, this.boneMap, this.hipsRestY);
      d.name = n;
      d.clip.name = n;
      this.clips.set(n, d);
    }
  }

  /** bake pack clips onto this (non-Mixamo-rest) skeleton through a rest-pose-aware retargeter */
  loadRetargeted(pack: AnimPack, names: string[], rt: { retarget(p: AnimPack, n: string): DecodedClip }, alias: Record<string, string> = {}) {
    for (const n of names) {
      const src = alias[n] ?? n;
      if (!pack.has(src)) {
        console.warn('[character] clip not in pack', src);
        continue;
      }
      const d = rt.retarget(pack, src);
      d.name = n;
      d.clip.name = n;
      this.clips.set(n, d);
    }
  }

  action(name: string) {
    let a = this.actions.get(name);
    if (!a) {
      const d = this.clips.get(name);
      if (!d) throw new Error('[character] no clip ' + name);
      a = this.mixer.clipAction(d.clip);
      this.actions.set(name, a);
    }
    return a;
  }

  play(name: string, o: PlayOpts = {}) {
    const d = this.clips.get(name);
    if (!d) {
      console.warn('[character] missing clip', name);
      return null;
    }
    const a = this.action(name);
    const fade = o.fade ?? 0.18;
    if (this.current === a && !o.restart) {
      a.timeScale = o.speed ?? 1;
      return a;
    }
    a.reset();
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.timeScale = o.speed ?? 1;
    a.setLoop(o.loop ?? d.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    if (o.at) a.time = o.at;
    if (this.current && this.current !== a) {
      a.crossFadeFrom(this.current, fade, false);
    } else if (fade > 0 && !this.current) {
      a.fadeIn(fade);
    }
    a.play();
    this.current = a;
    this.currentName = name;
    this.rootPrevT = a.time;
    return a;
  }

  get time() {
    return this.current ? this.current.time : 0;
  }
  get duration() {
    return this.current ? this.current.getClip().duration : 0;
  }

  /** Root displacement (model-local XZ, scaled to world) accumulated since the previous call for the current clip. */
  consumeRootMotion(out: THREE.Vector3) {
    out.set(0, 0, 0);
    const a = this.current;
    if (!a) return out;
    const d = this.clips.get(this.currentName);
    if (!d || !d.root) return out;
    const t = a.time;
    const t0 = this.rootPrevT;
    this.rootPrevT = t;
    if (t < t0) return out; // looped
    const s0 = this.sampleRoot(d, t0), s1 = this.sampleRoot(d, t);
    // model scale (cm->world) and holder orientation
    const sc = this.modelScale * this.modelUnit();
    out.set((s1[0] - s0[0]) * sc, 0, (s1[1] - s0[1]) * sc);
    out.applyAxisAngle(_v.set(0, 1, 0), this.body.rotation.y);
    return out;
  }

  private unitCache = 0;
  /** scale of the skeleton root relative to the holder (e.g. Armature 0.01) */
  modelUnit() {
    if (this.unitCache) return this.unitCache;
    const hips = this.bones.get('Hips')!;
    let s = 1;
    let p: THREE.Object3D | null = hips.parent;
    while (p && p !== this.body) {
      s *= p.scale.y;
      p = p.parent;
    }
    this.unitCache = s;
    return s;
  }

  private sampleRoot(d: DecodedClip, t: number): [number, number] {
    const r = d.root!;
    const n = r.length / 2;
    const f = Math.min(n - 1, Math.max(0, t * d.fps));
    const i = Math.floor(f), j = Math.min(n - 1, i + 1), k = f - i;
    return [r[i * 2] + (r[j * 2] - r[i * 2]) * k, r[i * 2 + 1] + (r[j * 2 + 1] - r[i * 2 + 1]) * k];
  }

  /** hit flash; pass `at` (world) + `radius` (m) for a local flash around the impact instead of the whole body */
  flash(color: THREE.ColorRepresentation, dur = 0.12, at?: THREE.Vector3, radius = 0) {
    this.uniforms.uFlashColor.value.set(color);
    this.uniforms.uFlashR.value = at ? radius : 0;
    if (at) this.uniforms.uFlashPos.value.copy(at);
    this.flashT = dur;
    this.flashDur = dur;
  }

  update(dt: number) {
    this.mixer.update(dt);
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      this.uniforms.uFlash.value = (this.flashT / this.flashDur) * 0.85;
    } else this.uniforms.uFlash.value = 0;
  }

  bone(name: string) {
    return this.bones.get(name);
  }

  /**
   * Analyse a clip offline: returns time (s, at speed 1) of peak right-hand (or tip) speed within [from,to] fraction.
   * Used to align hit frames, VFX and SFX with the actual swing.
   */
  analyseSwing(name: string, probe: THREE.Object3D, from = 0.1, to = 0.9) {
    const d = this.clips.get(name);
    if (!d) return { peak: 0, start: 0, end: 0, dur: 0 };
    const tmp = new THREE.AnimationMixer(this.mixer.getRoot() as THREE.Object3D);
    const a = tmp.clipAction(d.clip);
    a.play();
    const dur = d.clip.duration;
    const steps = Math.ceil(dur * 60);
    const pts: THREE.Vector3[] = [];
    const inv = new THREE.Matrix4();
    this.root.updateMatrixWorld(true);
    inv.copy(this.root.matrixWorld).invert();
    for (let i = 0; i <= steps; i++) {
      tmp.setTime((i / steps) * dur);
      this.root.updateMatrixWorld(true);
      pts.push(probe.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv));
    }
    tmp.stopAllAction();
    tmp.uncacheRoot(tmp.getRoot());
    let best = 0, bi = 0;
    const sp: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const v = pts[i].distanceTo(pts[i - 1]) * (steps / dur);
      sp.push(v);
      const f = i / steps;
      if (f >= from && f <= to && v > best) {
        best = v;
        bi = i;
      }
    }
    // active window: contiguous region around the peak where speed > 45% of peak
    let s = bi, e = bi;
    while (s > 1 && sp[s - 2] > best * 0.45) s--;
    while (e < sp.length && sp[e] > best * 0.45) e++;
    // restore pose
    this.mixer.update(0);
    const profile: number[] = [];
    for (let i = 0; i < sp.length; i += 3) profile.push(Math.round(sp[i] * 10) / 10);
    return { peak: (bi / steps) * dur, start: (s / steps) * dur, end: (e / steps) * dur, dur, speed: best, profile };
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    for (const m of this.materials) m.dispose();
  }
}

export function yawTo(from: THREE.Vector3, to: THREE.Vector3) {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(cur: number, target: number, rate: number, dt: number) {
  return cur + angleDiff(cur, target) * (1 - Math.exp(-rate * dt));
}

export { _q };
