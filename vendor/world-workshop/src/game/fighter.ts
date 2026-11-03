import * as THREE from 'three';
import { Character, angleDiff, dampAngle } from '../chars/character';
import { HandGrip, type Grip } from '../chars/grips';
import type { Weapon } from '../chars/weapons';
import type { Ponytail } from '../chars/ponytail';
import { WeaponTrail } from '../fx/fx';
import type { Collider } from '../world/buildings';
import { heightAt, standAt } from '../world/layout';
import type { HitSpec, MoveSpec } from './moves';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export interface HitEvent {
  attacker: Fighter;
  target: Fighter;
  hit: HitSpec;
  index: number;
  point: THREE.Vector3;
  dir: THREE.Vector3;
  move: MoveSpec;
}

/** closest distance between segments p1-q1 and p2-q2, writes closest point on the first segment into out */
export function segSegDist(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, out: THREE.Vector3) {
  const d1 = _a.subVectors(q1, p1), d2 = _b.subVectors(q2, p2), r = _v.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= 1e-8 && e <= 1e-8) {
    out.copy(p1);
    return p1.distanceTo(p2);
  }
  if (a <= 1e-8) {
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-8) s = THREE.MathUtils.clamp(-c / a, 0, 1);
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  const c1 = new THREE.Vector3().copy(p1).addScaledVector(d1, s);
  const c2 = new THREE.Vector3().copy(p2).addScaledVector(d2, t);
  out.copy(c1);
  return c1.distanceTo(c2);
}

export class Fighter {
  ch: Character;
  grip: HandGrip;
  trail = new WeaponTrail(30);
  pos = new THREE.Vector3();
  yaw = 0;
  vel = new THREE.Vector3();
  radius: number;
  bodyH: number;
  hp: number;
  maxHp: number;
  // move playback
  move: MoveSpec | null = null;
  moveT = 0;
  moveSpeed = 1;
  hitDone: boolean[] = [];
  sfxDone: boolean[] = [];
  chargeHeld = 0;
  charging = false;
  // weapon edge sampling
  base = new THREE.Vector3();
  tip = new THREE.Vector3();
  prevBase = new THREE.Vector3();
  prevTip = new THREE.Vector3();
  private tipObj = new THREE.Object3D();
  private baseObj = new THREE.Object3D();
  locoSpeed = 0;
  naturalWalk = 1.4;
  naturalRun = 3.8;
  /** natural speed of the optional sprint clip (0 = no sprint clip) */
  naturalSprint = 0;
  lookTarget: THREE.Vector3 | null = null;
  /** accept a hit at the swing peak from measured reach + arc (see testContact); off for blades checked exactly */
  peakFallback = true;
  lookWeight = 0;
  private neck?: THREE.Bone;
  private head?: THREE.Bone;
  knock = new THREE.Vector3();
  /** jump arc in progress: pose() leaves pos.y alone */
  airborne = false;
  /** simulated ponytail (secondary motion), if the model has one */
  hair: Ponytail | null = null;

  constructor(public name: string, src: THREE.Object3D, height: number, public weapon: Weapon, grip: Grip, opts: { radius: number; hp: number; rim: THREE.Color; alphaFix?: string[]; boneAlias?: Record<string, string> }) {
    this.ch = new Character(src, { height, rim: opts.rim, alphaTestFor: opts.alphaFix, boneAlias: opts.boneAlias });
    this.ch.uniforms.uRim.value.copy(opts.rim);
    this.grip = new HandGrip(this.ch, grip).build(weapon.group);
    this.tipObj.position.copy(weapon.tip);
    this.baseObj.position.copy(weapon.base);
    weapon.group.add(this.tipObj, this.baseObj);
    this.radius = opts.radius;
    this.bodyH = height;
    this.hp = this.maxHp = opts.hp;
    this.neck = this.ch.bone('Neck');
    this.head = this.ch.bone('Head');
  }

  get root() {
    return this.ch.root;
  }

  /** compute natural locomotion speeds from root motion so feet don't slide */
  calibrate(walk: string, run: string, sprint?: string) {
    const nat = (name: string) => {
      const d = this.ch.clips.get(name);
      if (!d || !d.root) return 0;
      const n = d.root.length / 2;
      const dx = d.root[(n - 1) * 2], dz = d.root[(n - 1) * 2 + 1];
      return (Math.hypot(dx, dz) * this.ch.modelScale * this.ch.modelUnit()) / d.clip.duration;
    };
    this.naturalWalk = nat(walk) || 1.4;
    this.naturalRun = nat(run) || 3.8;
    this.naturalSprint = sprint ? nat(sprint) : 0;
  }

  startMove(m: MoveSpec, fade = 0.12) {
    this.move = m;
    this.moveT = m.start;
    this.stepIn = null;
    this.hitDone = m.hits.map(() => false);
    this.sfxDone = m.sfx.map(() => false);
    this.chargeHeld = 0;
    this.charging = !!m.charge;
    const a = this.ch.play(m.clip, { fade, restart: true, at: m.start, loop: false });
    if (a) a.timeScale = 0; // we drive time manually for exact windows
    this.ch.consumeRootMotion(_v);
    this.trail.clear();
  }

  /** advance the current move; returns events for hits/sfx/impact */
  advanceMove(dt: number, held: boolean): { done: boolean; sfx: string[]; impact: boolean; hitWindows: number[] } {
    const m = this.move!;
    let speed = m.speed;
    if (m.windup && this.moveT < m.hits[0]?.from) speed *= m.windup;
    let stepT = dt * speed;
    if (m.charge && this.charging) {
      if (this.moveT >= m.charge.from && this.moveT < m.charge.until) stepT *= m.charge.slow;
      if (this.moveT >= m.charge.until) {
        if (held && this.chargeHeld < m.charge.maxHold) {
          this.chargeHeld += dt;
          stepT = 0;
        } else this.charging = false;
      }
    }
    const prev = this.moveT;
    this.moveT = Math.min(m.end, this.moveT + stepT);
    this.applyStepIn();
    const a = this.ch.current;
    if (a) a.time = this.moveT;
    const sfx: string[] = [];
    m.sfx.forEach(([t, s], i) => {
      if (!this.sfxDone[i] && this.moveT >= t) {
        this.sfxDone[i] = true;
        sfx.push(s);
      }
    });
    const impact = m.impactAt != null && prev < m.impactAt && this.moveT >= m.impactAt;
    const hitWindows: number[] = [];
    m.hits.forEach((h, i) => {
      if (!this.hitDone[i] && this.moveT >= h.from && prev <= h.to) hitWindows.push(i);
    });
    this.trail.active = this.moveT >= m.trail[0] && this.moveT <= m.trail[1];
    return { done: this.moveT >= m.end - 1e-4, sfx, impact, hitWindows };
  }

  inIframes() {
    const m = this.move;
    return !!(m && m.iframes && this.moveT >= m.iframes[0] && this.moveT <= m.iframes[1]);
  }

  setLoco(speed: number, dt: number, walkClip: string, runClip: string, idleClip: string, fade = 0.22, sprintClip?: string) {
    this.locoSpeed = speed;
    if (speed < 0.15) {
      if (this.ch.currentName !== idleClip) this.ch.play(idleClip, { fade, loop: true });
      return;
    }
    const useSprint = !!sprintClip && this.naturalSprint > 0 && speed > (this.naturalRun + this.naturalSprint) / 2;
    const useRun = speed > (this.naturalWalk + this.naturalRun) * 0.42;
    const clip = useSprint ? sprintClip! : useRun ? runClip : walkClip;
    const nat = useSprint ? this.naturalSprint : useRun ? this.naturalRun : this.naturalWalk;
    const a = this.ch.currentName === clip ? this.ch.current : this.ch.play(clip, { fade, loop: true });
    if (a) a.timeScale = THREE.MathUtils.clamp(speed / nat, 0.55, 1.6);
    void dt;
  }

  faceToward(target: THREE.Vector3, rate: number, dt: number) {
    const y = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.yaw = dampAngle(this.yaw, y, rate, dt);
  }

  facingError(target: THREE.Vector3) {
    return Math.abs(angleDiff(this.yaw, Math.atan2(target.x - this.pos.x, target.z - this.pos.z)));
  }

  /** resolve collisions against oriented boxes and keep feet on the terrain */
  collide(colliders: Collider[]) {
    for (const c of colliders) {
      const cs = Math.cos(-c.rot), sn = Math.sin(-c.rot);
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      const qx = THREE.MathUtils.clamp(lx, -c.hw, c.hw), qz = THREE.MathUtils.clamp(lz, -c.hd, c.hd);
      let ox = lx - qx, oz = lz - qz;
      let d = Math.hypot(ox, oz);
      if (d >= this.radius) continue;
      if (d < 1e-5) {
        // inside: push out along the shallowest axis
        const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
        if (px < pz) { ox = Math.sign(lx) || 1; oz = 0; d = 0; this.pushLocal(c, ox * (px + this.radius), 0); }
        else { ox = 0; oz = Math.sign(lz) || 1; d = 0; this.pushLocal(c, 0, oz * (pz + this.radius)); }
        continue;
      }
      const k = (this.radius - d) / d;
      this.pushLocal(c, ox * k, oz * k);
    }
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -24, 22);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -22, 30);
  }

  private pushLocal(c: Collider, lx: number, lz: number) {
    const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
    this.pos.x += lx * cs - lz * sn;
    this.pos.z += lx * sn + lz * cs;
  }

  separate(o: Fighter) {
    const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
    const d = Math.hypot(dx, dz), min = this.radius + o.radius;
    if (d < min && d > 1e-4) {
      const k = (min - d) / d / 2;
      this.pos.x += dx * k;
      this.pos.z += dz * k;
      o.pos.x -= dx * k;
      o.pos.z -= dz * k;
    }
  }

  /** update animation & attachments; must run after gameplay changed pos/yaw */
  pose(dt: number, animDt: number) {
    // knockback impulse
    if (this.knock.lengthSq() > 1e-4) {
      this.pos.addScaledVector(this.knock, dt);
      this.knock.multiplyScalar(Math.max(0, 1 - 6 * dt));
    }
    // feet: terrain or house floor / plinth / steps / deck; ease up steps so the body doesn't pop
    // (while airborne the jump arc owns pos.y; the encounter lands the fighter when it reaches the ground)
    const gy = standAt(this.pos.x, this.pos.z);
    const dy = gy - this.pos.y;
    if (!this.airborne) this.pos.y = Math.abs(dy) < 0.02 || Math.abs(dy) > 1.2 ? gy : this.pos.y + dy * Math.min(1, dt * 16);
    // Moves drive their clip time by hand (action.timeScale = 0), but the mixer clock must still advance or the
    // cross-fade into the move never progresses and the move stays at weight 0 (the body freezes in the old pose).
    this.ch.update(this.move ? dt : animDt);
    this.grip.apply();
    this.applyLook(dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.root.updateMatrixWorld(true);
    if (this.hair) {
      this.hair.groundY = standAt(this.pos.x, this.pos.z);
      this.hair.update(dt);
    }
    this.prevBase.copy(this.base);
    this.prevTip.copy(this.tip);
    this.baseObj.getWorldPosition(this.base);
    this.tipObj.getWorldPosition(this.tip);
    this.trail.push(this.base, this.tip, dt);
  }

  /** root motion of attack/dodge clips (manual time) in world space */
  rootStep(scale: number) {
    const d = this.ch.consumeRootMotion(_v);
    if (!scale) return;
    d.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.pos.x += d.x * scale;
    this.pos.z += d.z * scale;
  }

  /** drop any head tracking immediately (death / knock-down): the look is a world-up yaw and spins a lying head */
  stopLook() {
    this.lookTarget = null;
    this.lookWeight = 0;
  }

  private stepIn: { target: Fighter; total: number; done: number; from: number; until: number } | null = null;

  /**
   * Step-in for the move just started: if the target stands in front but beyond the blade's real reach, glide
   * toward it during the windup (eased, at most `cap` metres) so the edge actually reaches the body when the hit
   * window opens. Returns the planned distance.
   */
  planStepIn(target: Fighter, cap: number) {
    this.stepIn = null;
    const m = this.move, h = m?.hits[0];
    if (!m || !h) return 0;
    const dx = target.pos.x - this.pos.x, dz = target.pos.z - this.pos.z;
    if (Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz))) > 1.3) return 0;
    const want = Math.hypot(dx, dz) - target.radius - (h.range - 0.55);
    if (want <= 0.02) return 0;
    const total = Math.min(cap, want);
    this.stepIn = { target, total, done: 0, from: m.start, until: Math.max(m.start + 0.05, h.from) };
    return total;
  }

  private applyStepIn() {
    const si = this.stepIn;
    if (!si) return;
    const k = THREE.MathUtils.clamp((this.moveT - si.from) / (si.until - si.from), 0, 1);
    const want = si.total * k * k * (3 - 2 * k);
    const d = want - si.done;
    si.done = want;
    const dx = si.target.pos.x - this.pos.x, dz = si.target.pos.z - this.pos.z;
    const len = Math.hypot(dx, dz);
    // never push into the target: stop at body contact
    if (d > 0 && len > this.radius + si.target.radius + 0.05) {
      const s = Math.min(d, len - this.radius - si.target.radius - 0.05) / len;
      this.pos.x += dx * s;
      this.pos.z += dz * s;
    }
    if (k >= 1) this.stepIn = null;
  }

  private applyLook(dt: number) {
    const target = this.lookTarget;
    const wTarget = target ? 1 : 0;
    this.lookWeight += (wTarget - this.lookWeight) * Math.min(1, dt * 3);
    if (this.lookWeight < 0.01 || !this.head || !target) return;
    const hp = this.head.getWorldPosition(new THREE.Vector3());
    const to = target.clone().sub(hp);
    let yaw = angleDiff(this.yaw, Math.atan2(to.x, to.z));
    yaw = THREE.MathUtils.clamp(yaw, -1.0, 1.0);
    const pitch = THREE.MathUtils.clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.4, 0.35);
    const w = this.lookWeight;
    for (const [b, k] of [[this.neck, 0.4], [this.head, 0.6]] as [THREE.Bone | undefined, number][]) {
      if (!b) continue;
      const parentQ = b.parent!.getWorldQuaternion(new THREE.Quaternion());
      const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch * k * w, yaw * k * w, 0, 'YXZ'));
      // apply in world space then convert back to local
      const cur = b.getWorldQuaternion(new THREE.Quaternion());
      const rootQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      const delta = rootQ.clone().multiply(wq).multiply(rootQ.clone().invert());
      const nw = delta.multiply(cur);
      b.quaternion.copy(parentQ.invert().multiply(nw));
      b.updateMatrixWorld(true);
    }
  }

  /** test whether the weapon edge touches `target` this frame for hit index i */
  testContact(target: Fighter, h: HitSpec, atPeak: boolean, out: THREE.Vector3) {
    const p0 = new THREE.Vector3(target.pos.x, target.pos.y + 0.35, target.pos.z);
    const p1 = new THREE.Vector3(target.pos.x, target.pos.y + target.bodyH * 0.86, target.pos.z);
    const r = target.radius + 0.06;
    let d = segSegDist(this.base, this.tip, p0, p1, out);
    if (d < r) return true;
    // swept path of points along the blade between the last frame and this one (fast swings must not skip the body)
    for (const k of [1, 0.75, 0.5, 0.25]) {
      const a = this.prevBase.clone().lerp(this.prevTip, k), b = this.base.clone().lerp(this.tip, k);
      d = segSegDist(a, b, p0, p1, out);
      if (d < r) return true;
    }
    // peak fallback only for weapons whose striking part is not on the base->tip line (the gatekeeper's axe head):
    // the target's body surface must lie inside the measured reach of the swing
    if (atPeak && this.peakFallback) {
      const dx = target.pos.x - this.pos.x, dz = target.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz) - target.radius;
      const ang = Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz)));
      if (dist < h.range && ang < THREE.MathUtils.degToRad(h.arc / 2)) {
        segSegDist(this.base, this.tip, p0, p1, out);
        out.lerp(new THREE.Vector3(target.pos.x, target.pos.y + target.bodyH * 0.6, target.pos.z), 0.5);
        return true;
      }
    }
    return false;
  }

  dispose() {
    this.ch.dispose();
    this.trail.dispose();
    this.weapon.dispose();
  }
}
