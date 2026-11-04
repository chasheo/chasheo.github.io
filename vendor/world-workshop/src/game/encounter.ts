import * as THREE from 'three';
import { angleDiff } from '../chars/character';
import type { Element, Fx } from '../fx/fx';
import { ELEMENT_COLOR } from '../fx/fx';
import type { Post } from '../fx/post';
import type { AudioSys } from '../core/audio';
import type { InputState } from '../core/input';
import type { Collider } from '../world/buildings';
import { heightAt, standAt } from '../world/layout';
import type { StrKey } from '../i18n';
import type { EncounterState, Mode } from '../types';
import { Fighter } from './fighter';
import { GUARD_COMBOS, GUARD_MOVES, HERO_CHAIN, HERO_MOVES, PARRY, STATS, type HitSpec, type MoveSpec } from './moves';

export interface EncounterHooks {
  fx: Fx;
  audio: AudioSys;
  post: Post;
  shake(a: number): void;
  hitstop(t: number): void;
  word(key: StrKey, kind: 'parry' | 'counter' | 'broken' | 'stagger' | 'warn' | 'fail'): void;
  onState(s: EncounterState): void;
  onBossCard(): void;
}

type HeroState = 'ai' | 'free' | 'move' | 'parry' | 'hit' | 'dead' | 'victory' | 'air' | 'land';

/** player jump: take-off speed / gravity give ~1 m apex and ~0.67 s airtime; air control steers the carried run speed */
const JUMP = { vy: 6.0, gravity: 18, airAccel: 4.0, minCarry: 3.4, landTime: 0.36, landCancel: 0.12 };
/** run speeds (m/s): walk-run blend with the stick, long-held Shift (or a fully pushed stick) sprints */
const RUN_SPEED = 3.4, SPRINT_SPEED = 5.8;
type GuardState = 'post' | 'return' | 'approach' | 'hold' | 'attack' | 'recover' | 'recoil' | 'stagger' | 'broken' | 'getup' | 'defeated';

interface PendingHit {
  t: number;
  hit: HitSpec;
  point: THREE.Vector3;
  dir: THREE.Vector3;
  move: MoveSpec;
}

export const GUARD_POST = new THREE.Vector3(3.4, 0, -4.4);

/**
 * Which element each move carries. The heroine's chain builds from cold steel into fire (heavy) and the
 * parry counter discharges lightning; the guardian's axe burns. Kept data-only so VFX, trail tint and the
 * hit burst always agree.
 */
const MOVE_ELEMENT: Record<string, Element> = {
  light1: 'blade', light2: 'frost', light3: 'wood', light4: 'storm', heavy: 'fire', counter: 'storm', dodge: 'blade',
  chop: 'fire', sweep: 'fire', back: 'fire', axe1: 'fire', axe2: 'fire', axe3: 'fire', slam1: 'fire', slam2: 'fire', slam3: 'fire',
};
const HERO_SPOTS: [number, number][] = [[-2.4, 1.6], [0.6, 2.8], [-4.2, -1.6], [-0.8, -2.2], [2.0, 1.0], [-5.6, 2.4]];

export class Encounter {
  heroState: HeroState = 'ai';
  guardState: GuardState = 'post';
  state: EncounterState = 'dormant';
  posture = 0;
  postureCd = 0;
  now = 0;
  comboStep = 0;
  queuedAttack = false;
  lastAttackSeen = -1;
  lastParrySeen = -1;
  lastDodgeSeen = -1;
  lastJumpSeen = -1;
  private jumpVel = new THREE.Vector3();
  private landT = 0;
  private dashDir = new THREE.Vector3();
  private dashDone = 0;
  parryPressT = -9;
  parryLockUntil = -9;
  parryT = 0;
  counterUntil = -9;
  lastHurtT = -9;
  pending: PendingHit[] = [];
  heroHitT = 0;
  guardTimer = 0;
  attackCd = 1.2;
  whiff = false;
  danger = 0;
  victoryT = 0;
  defeatT = 0;
  private aiTimer = 0;
  private aiTarget: THREE.Vector3 | null = null;
  private aiAction: 'walk' | 'idle' | 'kata' | 'look' = 'idle';
  private aiStuckT = 0;
  private aiLastPos = new THREE.Vector3();
  private kataStep = 0;
  private guardIdleT = 0;
  private recoverDur = 0;
  private hitThisMove = false;
  private tmp = new THREE.Vector3();
  stats = { parries: 0, counters: 0, heavyInterrupts: 0, damageTaken: 0, startT: 0, endT: 0, early: 0, late: 0 };

  constructor(public hero: Fighter, public guard: Fighter, public colliders: Collider[], public hooks: EncounterHooks, persistedVictory: boolean) {
    hero.pos.set(-1.5, 0, 2.2);
    hero.yaw = 0.6;
    guard.pos.copy(GUARD_POST);
    guard.yaw = Math.atan2(-GUARD_POST.x, -GUARD_POST.z);
    hero.ch.play('idle', { fade: 0, loop: true });
    guard.ch.play('idle', { fade: 0, loop: true });
    if (persistedVictory) this.setVictoryInstant();
  }

  private setVictoryInstant() {
    this.state = 'victory';
    this.gateUnlocked = true;
    this.guardState = 'defeated';
    this.guard.hp = 0;
    // the library "Defeated" clip never leaves a standing slump (head stays ~1.7 m), which reads as "still standing,
    // ignoring me"; the knock-down ends lying on the ground and the rematch "getup" rises from exactly that pose
    const a = this.guard.ch.play('knockdown', { fade: 0, loop: false });
    if (a) a.time = a.getClip().duration - 0.05;
    this.victoryT = 99;
  }

  /** the gate stays open for good once the guardian has been beaten, even while he is fought again */
  private gateUnlocked = false;
  get portalOpen() {
    return this.gateUnlocked;
  }

  /** the beaten guardian can be asked for a rematch (victory card button or E beside him) */
  get canRematch() {
    return this.state === 'victory' && this.guardState === 'defeated';
  }

  /** guardian rises, walks back to his post and waits; approaching him starts the fight exactly like the first time */
  rematch(): boolean {
    if (!this.canRematch) return false;
    const guard = this.guard;
    guard.hp = guard.maxHp;
    guard.move = null;
    guard.trail.active = false;
    guard.weapon.uniforms.uGlow.value = 0;
    this.posture = 0;
    this.pending = [];
    this.guardCombo = null;
    this.attackCd = 1.2;
    this.victoryT = 0;
    this.stats = { parries: 0, counters: 0, heavyInterrupts: 0, damageTaken: 0, startT: 0, endT: 0, early: 0, late: 0 };
    this.guardState = 'getup';
    guard.ch.play('getup', { fade: 0.3, restart: true, speed: 1.3 });
    this.guardTimer = guard.ch.clips.get('getup')!.clip.duration / 1.3 - 0.2;
    this.state = 'dormant';
    this.hooks.onState('dormant');
    return true;
  }

  /* ------------------------------------------------------------ */
  update(dt: number, mode: Mode, inp: InputState, camYaw: number, cameraPos: THREE.Vector3) {
    this.now += dt;
    const hero = this.hero, guard = this.guard;
    const play = mode === 'play';
    // hero control mode
    if (play && this.heroState === 'ai') this.heroState = 'free';
    if (!play && this.heroState !== 'dead' && this.heroState !== 'ai') {
      this.heroState = 'ai';
      hero.airborne = false;
      hero.move = null;
      hero.trail.active = false;
      this.aiTimer = 0.5;
    }
    if (!play && this.heroState === 'dead') this.retry();
    if (play) this.updateHero(dt, inp, camYaw);
    else this.updateHeroAI(dt, cameraPos, mode);
    this.updateGuard(dt, play);
    this.resolvePending();
    // posture regen
    if (this.guardState !== 'broken' && this.guardState !== 'getup') {
      this.postureCd -= dt;
      if (this.postureCd <= 0) this.posture = Math.max(0, this.posture - STATS.postureRegen * dt);
    }
    hero.separate(guard);
    hero.collide(this.colliders);
    guard.collide(this.colliders);
    this.danger = Math.max(0, this.danger - dt * 2.5);
  }

  /* ------------------------- hero (player) ------------------------- */
  private updateHero(dt: number, inp: InputState, camYaw: number): void {
    const hero = this.hero;
    const fresh = (t: number, seen: number, win = 0.35) => t > seen && this.now - t < win;
    const attackReq = fresh(inp.attackPressed, this.lastAttackSeen);
    const parryReq = inp.parryPressed > this.lastParrySeen;
    const dodgeReq = fresh(inp.dodgePressed, this.lastDodgeSeen, 0.25);
    const jumpReq = fresh(inp.jumpPressed, this.lastJumpSeen, 0.2);
    if (this.heroState !== 'air') hero.airborne = false;
    const mv = new THREE.Vector3(inp.move.x, 0, inp.move.y);
    const fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const wish = fwd.multiplyScalar(mv.z).addScaledVector(right, mv.x);
    const wishLen = Math.min(1, wish.length());
    if (wishLen > 0.01) wish.normalize();
    const engaged = this.state === 'engaged';
    const lockT = engaged ? this.guardChest() : null;

    // parry press (edge, lockout prevents spamming / holding)
    if (parryReq) {
      this.lastParrySeen = inp.parryPressed;
      if (this.now - this.lastHurtT < PARRY.lateFeedback && this.heroState === 'hit') {
        this.hooks.word('late', 'fail');
        this.stats.late++;
      }
      const canParry = this.heroState === 'free' || this.heroState === 'land' || (this.heroState === 'move' && this.canCancelMove()) || this.heroState === 'parry';
      if (canParry && this.now < this.parryLockUntil) {
        // mashing: presses inside the lockout never register and push the lockout further out
        this.parryLockUntil = Math.max(this.parryLockUntil, this.now + PARRY.spamPenalty);
      } else if (canParry) {
        this.parryPressT = this.now;
        this.parryLockUntil = this.now + PARRY.lockout;
        this.heroState = 'parry';
        this.parryT = 0;
        hero.move = null;
        hero.trail.active = false;
        hero.ch.play('parry', { fade: 0.06, restart: true, speed: 1.6 });
        if (lockT) hero.faceToward(lockT, 30, 1);
      }
    }

    if (this.heroState === 'dead') {
      hero.stopLook();
      hero.pose(dt, dt);
      return;
    }

    if (this.heroState === 'free') {
      if (dodgeReq) return this.startDodge(wish, wishLen, dt);
      if (attackReq) {
        this.lastAttackSeen = inp.attackPressed;
        if (this.now < this.counterUntil) {
          this.counterUntil = -9;
          this.startHeroMove(HERO_MOVES.counter, lockT, wish);
          this.stats.counters++;
          this.hooks.word('counter', 'counter');
        } else {
          this.comboStep = 0;
          this.startHeroMove(HERO_MOVES.light1, lockT, wish);
        }
        return this.updateHero(0, inp, camYaw);
      }
      const speed = wishLen * (inp.sprint ? SPRINT_SPEED : RUN_SPEED);
      if (jumpReq) return this.startJump(wish, speed, dt);
      if (wishLen > 0.01) {
        const y = Math.atan2(wish.x, wish.z);
        hero.yaw += angleDiff(hero.yaw, y) * (1 - Math.exp(-12 * dt));
        hero.pos.addScaledVector(wish, speed * dt);
      }
      hero.setLoco(speed, dt, 'walk', 'run', 'idle', 0.22, 'sprint');
      hero.lookTarget = lockT;
      hero.pose(dt, dt);
      return;
    }

    if (this.heroState === 'air') {
      // no double jump, no dodge / attack mid-air: steer the carried velocity, fall, land
      const carry = Math.max(JUMP.minCarry, this.jumpVel.length());
      const want = wish.clone().multiplyScalar(wishLen * carry);
      this.jumpVel.lerp(want, 1 - Math.exp(-JUMP.airAccel * dt));
      hero.pos.addScaledVector(this.jumpVel, dt);
      if (wishLen > 0.01) hero.yaw += angleDiff(hero.yaw, Math.atan2(wish.x, wish.z)) * (1 - Math.exp(-6 * dt));
      this.jumpVy -= JUMP.gravity * dt;
      hero.pos.y += this.jumpVy * dt;
      const gy = standAt(hero.pos.x, hero.pos.z);
      if (this.jumpVy <= 0 && hero.pos.y <= gy) {
        hero.pos.y = gy;
        hero.airborne = false;
        this.heroState = 'land';
        this.landT = 0;
        hero.ch.play('land', { fade: 0.06, restart: true, loop: false, speed: 1.3 });
        this.hooks.audio.play('thud', 0.35, 1.25);
      }
      hero.lookTarget = lockT;
      hero.pose(dt, dt);
      return;
    }

    if (this.heroState === 'land') {
      this.landT += dt;
      const canAct = this.landT >= JUMP.landCancel;
      if (canAct && dodgeReq) return this.startDodge(wish, wishLen, dt);
      if (canAct && jumpReq) return this.startJump(wish, wishLen * (inp.sprint ? SPRINT_SPEED : RUN_SPEED), dt);
      if (canAct && (attackReq || wishLen > 0.01) || this.landT >= JUMP.landTime) {
        this.heroState = 'free';
        return this.updateHero(dt, inp, camYaw);
      }
      hero.lookTarget = lockT;
      hero.pose(dt, dt);
      return;
    }

    if (this.heroState === 'parry') {
      this.parryT += dt;
      if (lockT) hero.faceToward(lockT, 10, dt);
      hero.pose(dt, dt);
      if (this.parryT > 0.42) {
        this.heroState = 'free';
        hero.ch.play('idle', { fade: 0.2, loop: true });
      }
      return;
    }

    if (this.heroState === 'hit') {
      this.heroHitT -= dt;
      hero.pose(dt, dt);
      if (this.heroHitT <= 0) {
        this.heroState = 'free';
        hero.ch.play('idle', { fade: 0.25, loop: true });
      }
      return;
    }

    if (this.heroState === 'move' && hero.move) {
      const m = hero.move;
      // buffer the next combo input during the late part of the current swing (not before: holding never auto-fires)
      if (attackReq && m.chainFrom != null) {
        const earliest = m.hits[0] ? m.hits[0].from - 0.3 : m.start;
        if (hero.moveT >= earliest) {
          this.queuedAttack = true;
          this.lastAttackSeen = inp.attackPressed;
        }
      }
      if (dodgeReq && this.canCancelMove()) return this.startDodge(wish, wishLen, dt);
      if (lockT && hero.moveT < m.turnUntil) hero.faceToward(lockT, 14, dt);
      else if (!lockT && wishLen > 0.01 && hero.moveT < m.turnUntil) hero.faceToward(hero.pos.clone().add(wish), 10, dt);
      const ev = hero.advanceMove(dt, inp.attackDown);
      hero.rootStep(m.rootScale);
      if (m.dash) {
        // the evade covers a fixed distance along the chosen direction: fast burst, eased stop
        const p = THREE.MathUtils.clamp((hero.moveT - m.start) / (m.dash.until - m.start), 0, 1);
        const target = m.dash.dist * (1 - Math.pow(1 - p, 2.2));
        // sub-stepped so a fast burst (or a slow frame) can't tunnel through a thin wall / prop collider
        const step = target - this.dashDone, n = Math.max(1, Math.ceil(step / 0.15));
        for (let i = 0; i < n; i++) {
          hero.pos.addScaledVector(this.dashDir, step / n);
          hero.collide(this.colliders);
        }
        this.dashDone = target;
      }
      for (const s of ev.sfx) this.hooks.audio.play(s, 0.7);
      if (m.charge) {
        const k = hero.charging && hero.moveT >= m.charge.from ? Math.min(1, 0.35 + hero.chargeHeld / m.charge.maxHold) : 0;
        hero.ch.uniforms.uCharge.value = k;
        hero.weapon.uniforms.uGlow.value = k * 1.2;
        if (k > 0) this.hooks.fx.charge(hero.tip, k);
      }
      if (ev.impact) {
        // the finisher's landing: weight only (shake + thud); the visible impact belongs on the gatekeeper's body
        this.hooks.shake(hero.hitDone.some(Boolean) ? 0.25 : 0.12);
        this.hooks.audio.play('thud', 0.6, 0.8);
      }
      hero.pose(dt, 0);
      if (hero.trail.active) this.swingFx(hero, m);
      if (m.id === 'dodge' && m.iframes) {
        // three afterimages spread across the invulnerable part of the evade
        const slots = [m.iframes[0] + 0.02, (m.iframes[0] + m.iframes[1]) / 2, m.iframes[1] - 0.04];
        while (this.ghostIdx < slots.length && hero.moveT >= slots[this.ghostIdx]) {
          this.hooks.fx.ghost(hero.ch.meshes, ELEMENT_COLOR.frost, 0.34 - this.ghostIdx * 0.05);
          this.ghostIdx++;
        }
      }
      this.heroHits(ev.hitWindows);
      if (m.chainFrom != null && this.queuedAttack && hero.moveT >= m.chainFrom) {
        this.queuedAttack = false;
        const next = HERO_CHAIN[m.id];
        if (next) return this.startHeroMove(HERO_MOVES[next], lockT, wish), void 0;
      }
      if (ev.done) {
        this.heroState = 'free';
        hero.move = null;
        hero.ch.uniforms.uCharge.value = 0;
        hero.weapon.uniforms.uGlow.value = 0;
        hero.ch.play('idle', { fade: 0.3, loop: true });
        this.comboStep = 0;
      }
    }
  }

  private canCancelMove() {
    const m = this.hero.move;
    if (!m) return true;
    if (m.id === 'dodge') return false;
    const last = m.hits[m.hits.length - 1];
    return !last || this.hero.moveT > last.to + 0.05;
  }

  private startDodge(wish: THREE.Vector3, wishLen: number, dt: number) {
    const hero = this.hero;
    this.lastDodgeSeen = this.now;
    hero.yaw = wishLen > 0.01 ? Math.atan2(wish.x, wish.z) : hero.yaw + Math.PI;
    hero.startMove(HERO_MOVES.dodge, 0.08);
    this.dashDir.set(Math.sin(hero.yaw), 0, Math.cos(hero.yaw));
    this.dashDone = 0;
    this.ghostIdx = 0;
    this.heroState = 'move';
    this.queuedAttack = false;
    const back = new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw));
    this.hooks.fx.dodgeBurst(hero.pos.clone().setY(heightAt(hero.pos.x, hero.pos.z)), back, 'blade');
    hero.pose(dt, 0);
  }

  private jumpVy = 0;

  /** take off: vertical impulse plus the current run velocity, the clip plays the tuck over the rise */
  private startJump(wish: THREE.Vector3, speed: number, dt: number) {
    const hero = this.hero;
    this.lastJumpSeen = this.now;
    this.heroState = 'air';
    hero.airborne = true;
    hero.move = null;
    hero.trail.active = false;
    this.jumpVy = JUMP.vy;
    this.jumpVel.copy(wish).multiplyScalar(speed);
    if (speed > 0.1) hero.yaw = Math.atan2(wish.x, wish.z);
    const clip = hero.ch.clips.get('jump');
    const air = (2 * JUMP.vy) / JUMP.gravity;
    hero.ch.play('jump', { fade: 0.08, restart: true, loop: false, speed: clip ? clip.clip.duration / (air * 0.85) : 1 });
    this.hooks.audio.play('dodge', 0.3, 1.2);
    hero.pose(dt, dt);
  }

  /** element of a move: drives trail tint, slash arc colour and the impact burst */
  private elementOf(id: string): Element {
    return MOVE_ELEMENT[id] ?? 'blade';
  }

  /** trail tint for the active element; one crescent arc in the real swing plane once the blade passes its peak */
  private swingFx(who: Fighter, m: MoveSpec) {
    const el = this.elementOf(m.id);
    const color = ELEMENT_COLOR[el];
    who.trail.uniforms.uColor.value.copy(color);
    who.trail.uniforms.uIntensity.value = el === 'blade' ? 1.1 : 1.5;
    who.trail.life = el === 'fire' ? 0.22 : 0.17;
    const h = m.hits[0];
    if (!h || this.arcFor.get(who) === m || who.moveT < h.peak) return;
    this.arcFor.set(who, m);
    const vel = who.tip.clone().sub(who.prevTip);
    const pivot = who.pos.clone().setY(who.pos.y + (who === this.guard ? 1.35 : 1.15));
    // arc just past the blade tip; a thin band so the fighter's body stays readable behind it
    const tip = pivot.clone().lerp(who.tip, 1.06);
    const sweep = Math.min(Math.PI * 1.1, (h.arc * Math.PI) / 180);
    this.hooks.fx.slashArc(pivot, tip, vel, color, el === 'fire' ? 0.3 : 0.24, sweep, h.heavy ? 0.34 : 0.26);
    // no burst at the blade tip here: impact effects only spawn on the victim's body when the blade really connects
  }
  private arcFor = new WeakMap<Fighter, MoveSpec>();
  private ghostIdx = 0;

  private startHeroMove(m: MoveSpec, lockT: THREE.Vector3 | null, wish: THREE.Vector3) {
    const hero = this.hero;
    if (lockT && hero.facingError(lockT) < 1.6) hero.faceToward(lockT, 50, 1);
    else if (wish.lengthSq() > 0.01) hero.yaw = Math.atan2(wish.x, wish.z);
    hero.startMove(m, m.id === 'light1' ? 0.1 : 0.14);
    hero.ch.uniforms.uCharge.value = 0;
    this.heroState = 'move';
    this.queuedAttack = false;
    this.hitThisMove = false;
    if (this.state === 'dormant' && this.distHeroGuard() < 4.5) this.engage();
    // close in on the gatekeeper during the windup instead of cutting the air from out of reach
    if (this.guardState !== 'defeated' && this.distHeroGuard() < 4.5) hero.planStepIn(this.guard, 1.2);
  }

  private heroHits(windows: number[]) {
    const hero = this.hero, guard = this.guard, m = hero.move!;
    if (this.guardState === 'defeated' || !windows.length) return;
    for (const i of windows) {
      const h = m.hits[i];
      const atPeak = hero.moveT >= h.peak;
      const p = new THREE.Vector3();
      if (!hero.testContact(guard, h, atPeak, p)) continue;
      hero.hitDone[i] = true;
      this.hitGuard(h, p, m, hero.chargeHeld / (m.charge?.maxHold ?? 1));
    }
  }

  /**
   * A visible point on the victim's body surface facing the attacker, at the height where the blade met the body
   * (clamped to the torso band). Hit sparks, blood and the local flash all spawn here, not at the blade or ground.
   */
  private woundPoint(victim: Fighter, attacker: Fighter, contact: THREE.Vector3) {
    const toAtt = attacker.pos.clone().sub(victim.pos).setY(0);
    if (toAtt.lengthSq() < 1e-6) toAtt.set(0, 0, 1);
    toAtt.normalize();
    const y = THREE.MathUtils.clamp(contact.y, victim.pos.y + victim.bodyH * 0.38, victim.pos.y + victim.bodyH * 0.8);
    return victim.pos.clone().setY(y).addScaledVector(toAtt, victim.radius * 0.95);
  }

  private hitGuard(h: HitSpec, p: THREE.Vector3, m: MoveSpec, charge: number) {
    const guard = this.guard, hero = this.hero;
    if (this.state === 'dormant') this.engage();
    const broken = this.guardState === 'broken' || this.guardState === 'getup';
    const mult = (broken ? 1.3 : 1) * (1 + (m.charge ? Math.min(1, charge) * 0.5 : 0));
    guard.hp = Math.max(0, guard.hp - h.dmg * mult);
    const dir = guard.pos.clone().sub(hero.pos).setY(0).normalize();
    const el = this.elementOf(m.id);
    const wound = this.woundPoint(guard, hero, p);
    this.hooks.fx.hitBurst(wound, dir.clone().negate().lerp(dir, 0.35).normalize(), el, h.heavy ? 1.3 : 0.8);
    this.hooks.fx.bleed(wound, dir, h.heavy ? 1.4 : 0.8);
    guard.ch.flash(h.heavy ? 0xffc890 : 0xffe6d6, h.heavy ? 0.16 : 0.1, wound, h.heavy ? 0.55 : 0.38);
    // steel on steel first (blade meets axe haft / armour), body impact underneath
    this.hooks.audio.play('clash', h.heavy ? 0.95 : 0.75, h.heavy ? 0.9 : 1.0, 0.06);
    if (h.heavy) this.hooks.audio.play('clash_hit', 0.4, 0.8);
    this.hooks.audio.play('flesh', h.heavy ? 0.4 : 0.25, h.heavy ? 0.85 : 1.0);
    this.hooks.shake(h.heavy ? 0.3 : 0.1);
    this.hooks.hitstop(h.heavy ? 0.085 : 0.045);
    if (!broken) {
      this.posture = Math.min(STATS.guardPosture, this.posture + h.posture * mult);
      this.postureCd = STATS.postureRegenDelay;
    }
    if (guard.hp <= 0) return this.guardDefeated();
    if (!broken && this.posture >= STATS.guardPosture) return this.guardBreak(dir);
    if (h.heavy && !broken) {
      // heavy interrupts any guardian action and knocks him back into a natural stagger
      if (this.guardState === 'attack') this.stats.heavyInterrupts++;
      this.guardState = 'stagger';
      guard.move = null;
      guard.trail.active = false;
      guard.weapon.uniforms.uGlow.value = 0;
      guard.ch.play('stagger', { fade: 0.08, restart: true, speed: 1.15 });
      guard.knock.copy(dir).multiplyScalar((h.knock ?? 1.2) * 6);
      this.guardTimer = 1.15;
      this.hooks.post.pulse('heavy');
      this.hooks.word('stagger', 'stagger');
    } else if (this.guardState === 'post' || this.guardState === 'hold' || this.guardState === 'approach' || this.guardState === 'recover') {
      // light hits never interrupt; they only shove him slightly and make him answer sooner
      guard.knock.copy(dir).multiplyScalar(1.5);
      this.attackCd = Math.min(this.attackCd, 0.9 + Math.random() * 0.3);
    }
  }

  private guardBreak(dir: THREE.Vector3) {
    const guard = this.guard;
    this.guardState = 'broken';
    guard.stopLook();
    guard.move = null;
    guard.trail.active = false;
    guard.weapon.uniforms.uGlow.value = 0;
    guard.ch.play('knockdown', { fade: 0.1, restart: true, speed: 1.25 });
    guard.knock.copy(dir).multiplyScalar(12);
    this.guardTimer = guard.ch.clips.get('knockdown')!.clip.duration / 1.25 + 0.6;
    this.hooks.word('broken', 'broken');
    this.hooks.audio.play('guardbreak', 0.9);
    this.hooks.post.pulse('heavy');
    this.hooks.shake(0.45);
    this.hooks.hitstop(0.12);
  }

  private guardDefeated() {
    const guard = this.guard;
    this.guardState = 'defeated';
    guard.stopLook();
    guard.move = null;
    guard.trail.active = false;
    guard.weapon.uniforms.uGlow.value = 0;
    guard.ch.play('knockdown', { fade: 0.15, restart: true, loop: false, speed: 0.9 });
    this.hooks.audio.play('guardbreak', 0.8, 0.8);
    this.hooks.hitstop(0.18);
    this.hooks.shake(0.5);
    this.victoryT = 0;
    this.stats.endT = this.now;
  }

  /* ------------------------- hero AI (browse) ------------------------- */
  private updateHeroAI(dt: number, cameraPos: THREE.Vector3, mode: Mode) {
    const hero = this.hero;
    this.aiTimer -= dt;
    // look at the visitor's camera when it is close (inspect), otherwise at the gatekeeper now and then
    const camD = cameraPos.distanceTo(hero.pos);
    hero.lookTarget = mode === 'inspect' && camD < 9 ? cameraPos : this.state === 'victory' ? null : this.distHeroGuard() < 9 && this.aiAction === 'idle' ? this.guardChest() : null;
    if (hero.move) {
      const ev = hero.advanceMove(dt, false);
      hero.rootStep(hero.move.rootScale);
      hero.pose(dt, 0);
      if (ev.done) {
        hero.move = null;
        if (this.aiAction === 'kata' && this.kataStep === 1) {
          this.kataStep = 2;
          hero.startMove(HERO_MOVES.light2, 0.14);
        } else {
          hero.ch.play('idle', { fade: 0.3, loop: true });
          this.aiAction = 'idle';
          this.aiTimer = 2 + Math.random() * 2;
        }
      }
      return;
    }
    if (this.aiAction === 'walk' && this.aiTarget) {
      const d = this.tmp.copy(this.aiTarget).sub(hero.pos).setY(0);
      const dist = d.length();
      if (dist < 0.3 || this.aiStuckT > 1.5) {
        // arrived, or blocked by a wall / the fallen guardian: stop and choose something else instead of marching in place
        this.aiAction = 'idle';
        this.aiTimer = this.aiStuckT > 1.5 ? 0.8 : 2.5 + Math.random() * 3;
        this.aiStuckT = 0;
        hero.setLoco(0, dt, 'walk', 'run', 'idle');
      } else {
        d.normalize();
        hero.yaw += angleDiff(hero.yaw, Math.atan2(d.x, d.z)) * (1 - Math.exp(-5 * dt));
        hero.pos.addScaledVector(d, 1.25 * dt);
        hero.setLoco(1.25, dt, 'walk', 'run', 'idle');
        // progress check against the position after last frame's collision push-back
        const moved = this.aiLastPos.distanceTo(hero.pos);
        this.aiStuckT = moved < 0.25 * 1.25 * dt ? this.aiStuckT + dt : Math.max(0, this.aiStuckT - dt);
      }
      this.aiLastPos.copy(hero.pos);
    } else if (this.aiTimer <= 0) {
      const r = Math.random();
      // the same yard stroll before and after the victory (the old post-victory trip to the gate walked into the
      // yard wall and marched in place forever)
      if (r < 0.45) {
        const s = HERO_SPOTS[Math.floor(Math.random() * HERO_SPOTS.length)];
        this.aiTarget = new THREE.Vector3(s[0], 0, s[1]);
        this.aiAction = 'walk';
        this.aiStuckT = 0;
        this.aiLastPos.copy(hero.pos);
      } else if (r < 0.75) {
        this.aiAction = 'kata';
        this.kataStep = 1;
        hero.startMove(HERO_MOVES.light1, 0.18);
      } else {
        this.aiAction = 'look';
        hero.ch.play(Math.random() < 0.5 ? 'look' : 'practice', { fade: 0.4, loop: false });
        this.aiTimer = 4.5;
      }
      if (this.aiAction === 'look') this.aiTimer = 4.5;
    } else if (this.aiAction === 'look' && this.aiTimer < 0.6 && hero.ch.currentName !== 'idle') {
      hero.ch.play('idle', { fade: 0.5, loop: true });
    }
    hero.pose(dt, dt);
  }

  /* ------------------------- guardian ------------------------- */
  private updateGuard(dt: number, play: boolean) {
    const guard = this.guard, hero = this.hero;
    const toHero = hero.pos.clone().sub(guard.pos).setY(0);
    const d = toHero.length();
    // victory sequence
    if (this.guardState === 'defeated') {
      guard.lookTarget = null;
      guard.pose(dt, dt);
      if (this.state !== 'victory') {
        this.victoryT += dt;
        if (this.victoryT > 1.4) {
          this.state = 'victory';
          this.gateUnlocked = true;
          this.hooks.onState('victory');
        }
      }
      return;
    }
    // engagement rules
    if (play && this.state === 'dormant' && this.heroState !== 'dead' && this.guardState !== 'getup' && hero.pos.distanceTo(GUARD_POST) < 7.5) this.engage();
    if (this.state === 'engaged' && (!play || hero.pos.distanceTo(GUARD_POST) > 17)) this.disengage();

    switch (this.guardState) {
      case 'post': {
        guard.lookTarget = d < 10 ? this.heroHead() : null;
        const home = GUARD_POST.clone().sub(guard.pos).setY(0);
        if (home.length() > 0.4) {
          this.guardState = 'return';
          break;
        }
        guard.faceToward(d < 9 ? hero.pos : new THREE.Vector3(0, 0, 0), 2, dt);
        this.guardIdleT -= dt;
        if (this.guardIdleT <= 0 && guard.ch.currentName === 'idle') {
          const r = Math.random();
          guard.ch.play(r < 0.45 ? 'look' : 'idle', { fade: 0.5, loop: r >= 0.45 });
          this.guardIdleT = 6 + Math.random() * 5;
        } else if (this.guardIdleT < 6 && guard.ch.currentName !== 'idle' && guard.ch.current && !guard.ch.current.isRunning()) {
          guard.ch.play('idle', { fade: 0.4, loop: true });
        }
        guard.pose(dt, dt);
        return;
      }
      case 'return': {
        guard.lookTarget = null;
        const home = GUARD_POST.clone().sub(guard.pos).setY(0);
        if (home.length() < 0.35) {
          this.guardState = 'post';
          guard.ch.play('idle', { fade: 0.4, loop: true });
          this.guardIdleT = 3;
        } else {
          home.normalize();
          guard.faceToward(guard.pos.clone().add(home), 6, dt);
          guard.pos.addScaledVector(home, 1.6 * dt);
          guard.setLoco(1.6, dt, 'walk', 'run', 'idle');
        }
        guard.pose(dt, dt);
        return;
      }
      case 'approach':
      case 'hold': {
        guard.lookTarget = this.heroHead();
        this.attackCd -= dt;
        guard.faceToward(hero.pos, 5, dt);
        if (this.heroState === 'dead') {
          guard.setLoco(0, dt, 'walk', 'run', 'idle');
          guard.pose(dt, dt);
          return;
        }
        // walk in to fighting distance (the axe reaches ~1.5 m; the step-in covers the rest)
        if (d > 2.2) {
          const sp = d > 6 ? 3.6 : 1.8;
          guard.pos.addScaledVector(toHero.normalize(), sp * dt);
          guard.setLoco(sp, dt, 'walk', 'run', 'idle');
        } else {
          guard.setLoco(0, dt, 'walk', 'run', 'idle');
          if (this.attackCd <= 0 && guard.facingError(hero.pos) < 0.5) {
            const r = Math.random();
            this.startGuardAttack(d < 1.9 ? (r < 0.3 ? 'chop' : r < 0.7 ? 'hack' : 'slam') : (r < 0.5 ? 'sweep' : 'slam'));
          }
        }
        guard.pose(dt, dt);
        return;
      }
      case 'attack': {
        const m = guard.move!;
        guard.lookTarget = this.heroHead();
        if (guard.moveT < m.turnUntil) guard.faceToward(hero.pos, 4.5, dt);
        const ev = guard.advanceMove(dt, false);
        for (const s of ev.sfx) this.hooks.audio.play(s, 0.8, 0.85);
        // burning axe: embers stream off the edge during the windup and the swing
        if (m.tell != null && guard.moveT >= m.tell && guard.moveT < m.hits[0].to) {
          const k = Math.min(1, (guard.moveT - m.tell) / (m.hits[0].from - m.tell));
          this.hooks.fx.charge(guard.tip, 0.35 + k * 0.6);
        }
        // telegraph: edge glint + danger vignette from the tell until contact
        if (m.tell != null && guard.moveT >= m.tell && guard.moveT < m.hits[0].from) {
          const k = (guard.moveT - m.tell) / (m.hits[0].from - m.tell);
          guard.weapon.uniforms.uGlow.value = 0.4 + k * 1.4;
          this.danger = Math.max(this.danger, 0.25 + k * 0.45);
        } else guard.weapon.uniforms.uGlow.value *= 0.85;
        guard.pose(dt, 0);
        if (guard.trail.active) this.swingFx(guard, m);
        if (ev.impact) {
          this.hooks.fx.groundImpact(guard.tip.clone().setY(heightAt(guard.tip.x, guard.tip.z)), new THREE.Color(0.5, 0.45, 0.4));
          this.hooks.shake(0.2);
          this.hooks.audio.play('thud', 0.7, 0.7);
        }
        for (const i of ev.hitWindows) {
          const h = m.hits[i];
          const p = new THREE.Vector3();
          if (this.heroState === 'dead') continue;
          if (guard.testContact(hero, h, guard.moveT >= h.peak, p)) {
            guard.hitDone[i] = true;
            this.hitThisMove = true;
            this.pending.push({ t: this.now, hit: h, point: p, dir: hero.pos.clone().sub(guard.pos).setY(0).normalize(), move: m });
          }
        }
        if (ev.done) {
          guard.move = null;
          guard.weapon.uniforms.uGlow.value = 0;
          // string follow-up: next hit of the current combo, if the heroine is still in reach
          const combo = this.guardCombo;
          if (combo && this.guardComboIdx + 1 < combo.moves.length && d < 2.6 && this.heroState !== 'dead' && Math.random() < combo.follow) {
            this.guardComboIdx++;
            this.startGuardMove(combo.moves[this.guardComboIdx], 0.1);
            return;
          }
          this.guardCombo = null;
          this.guardState = 'recover';
          this.recoverDur = (this.hitThisMove ? 0.35 : 0.9) + Math.random() * 0.3; // whiffs leave him open longer
          this.guardTimer = this.recoverDur;
          guard.ch.play('idle', { fade: 0.35, loop: true });
        }
        return;
      }
      case 'recover': {
        this.guardTimer -= dt;
        guard.faceToward(hero.pos, 2.5, dt);
        guard.pose(dt, dt);
        if (this.guardTimer <= 0) {
          this.guardState = 'hold';
          this.attackCd = 0.6 + Math.random() * 1.1;
        }
        return;
      }
      case 'recoil':
      case 'stagger': {
        this.guardTimer -= dt;
        guard.pose(dt, dt);
        if (this.guardTimer <= 0) {
          this.guardState = 'hold';
          this.attackCd = 0.5 + Math.random() * 0.6;
          guard.ch.play('idle', { fade: 0.35, loop: true });
        }
        return;
      }
      case 'broken': {
        this.guardTimer -= dt;
        guard.pose(dt, dt);
        if (this.guardTimer <= 0) {
          this.guardState = 'getup';
          guard.ch.play('getup', { fade: 0.25, restart: true, speed: 1.9 });
          this.guardTimer = guard.ch.clips.get('getup')!.clip.duration / 1.9 - 0.2;
        }
        return;
      }
      case 'getup': {
        this.guardTimer -= dt;
        guard.pose(dt, dt);
        if (this.guardTimer <= 0) {
          this.posture = 0;
          // rematch rise (not engaged yet): walk home to the post; a fight-time rise goes straight back to fighting
          this.guardState = this.state === 'engaged' ? 'hold' : 'return';
          this.attackCd = 0.4;
          guard.ch.play('idle', { fade: 0.4, loop: true });
        }
        return;
      }
    }
  }

  /** start a guardian string (key of GUARD_COMBOS) or, for a bare move id, a single move */
  startGuardAttack(id: string) {
    const combo = GUARD_COMBOS[id];
    this.guardCombo = combo ?? null;
    this.guardComboIdx = 0;
    this.startGuardMove(combo ? combo.moves[0] : id, 0.15);
  }

  private startGuardMove(id: string, fade: number) {
    const guard = this.guard;
    const m = GUARD_MOVES[id];
    if (!m) throw new Error('[encounter] unknown guardian move ' + id);
    guard.startMove(m, fade);
    guard.moveSpeed = 1;
    this.guardState = 'attack';
    this.hitThisMove = false;
    if (this.heroState !== 'dead') guard.planStepIn(this.hero, 1.0);
  }
  private guardCombo: { moves: string[]; follow: number } | null = null;
  private guardComboIdx = 0;

  /* ------------------------- contact resolution & parry ------------------------- */
  private resolvePending() {
    const hero = this.hero, guard = this.guard;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const ph = this.pending[i];
      const dtPress = ph.t - this.parryPressT; // >0 pressed before contact
      const parryOk = dtPress <= PARRY.pre && dtPress >= -PARRY.post && this.parryPressT > 0;
      if (hero.inIframes()) {
        this.pending.splice(i, 1);
        continue;
      }
      if (parryOk && this.heroState !== 'dead' && this.heroState !== 'hit') {
        this.pending.splice(i, 1);
        this.parrySuccess(ph);
        continue;
      }
      if (this.now - ph.t < PARRY.post) continue; // wait for the post tolerance
      this.pending.splice(i, 1);
      if (dtPress > PARRY.pre && dtPress < PARRY.earlyFeedback) {
        this.hooks.word('early', 'fail');
        this.stats.early++;
      }
      this.hurtHero(ph);
    }
    void guard;
  }

  private parrySuccess(ph: PendingHit) {
    const hero = this.hero, guard = this.guard;
    this.stats.parries++;
    this.parryPressT = -9; // consumed: one press parries one blow
    this.parryLockUntil = this.now + 0.1;
    this.counterUntil = this.now + PARRY.counterWindow;
    const p = hero.tip.clone().lerp(guard.tip, 0.5);
    this.hooks.fx.parryShock(p, ph.dir.clone().negate());
    this.hooks.post.pulse('parry');
    this.hooks.audio.play('parry', 1.0, 1, 0.03);
    this.hooks.audio.play('clash_hit', 0.85, 1.12);
    this.hooks.shake(0.32);
    this.hooks.hitstop(0.11);
    this.hooks.word('parry', 'parry');
    hero.knock.copy(ph.dir).multiplyScalar(1.6);
    hero.ch.play('parry', { fade: 0.03, restart: true, speed: 1.2, at: 0.12 });
    this.heroState = 'parry';
    this.parryT = 0.1;
    // weapon recoil: interrupt the attack, posture damage
    guard.move = null;
    guard.trail.active = false;
    guard.weapon.uniforms.uGlow.value = 0;
    this.posture = Math.min(STATS.guardPosture, this.posture + STATS.parryPosture);
    this.postureCd = STATS.postureRegenDelay;
    if (this.posture >= STATS.guardPosture) return this.guardBreak(ph.dir);
    this.guardState = 'recoil';
    guard.ch.play('recoil', { fade: 0.06, restart: true, speed: 1.25, at: 0.08 });
    guard.knock.copy(ph.dir).multiplyScalar(-3.2);
    this.guardTimer = 1.05;
  }

  private hurtHero(ph: PendingHit) {
    const hero = this.hero;
    hero.hp = Math.max(0, hero.hp - ph.hit.dmg);
    this.stats.damageTaken += ph.hit.dmg;
    this.lastHurtT = this.now;
    const wound = this.woundPoint(hero, this.guard, ph.point);
    this.hooks.fx.hitBurst(wound, ph.dir.clone().negate(), this.elementOf(ph.move.id), 0.6);
    this.hooks.fx.bleed(wound, ph.dir, 0.9);
    hero.ch.flash(0xff8a70, 0.14, wound, 0.4);
    this.hooks.post.pulse('hurt');
    this.hooks.audio.play('clash', 0.45, 0.78);
    this.hooks.audio.play('flesh', 0.8, 0.9);
    this.hooks.shake(0.35);
    this.hooks.hitstop(0.06);
    hero.move = null;
    hero.trail.active = false;
    hero.ch.uniforms.uCharge.value = 0;
    hero.weapon.uniforms.uGlow.value = 0;
    hero.knock.copy(ph.dir).multiplyScalar(3.2);
    if (hero.hp <= 0) {
      this.heroState = 'dead';
      hero.stopLook();
      hero.ch.play('death', { fade: 0.15, restart: true, loop: false });
      this.hooks.audio.play('sting_death', 0.7);
      this.state = 'defeat';
      this.hooks.onState('defeat');
      return;
    }
    this.heroState = 'hit';
    this.heroHitT = 0.55;
    hero.ch.play('hit', { fade: 0.06, restart: true, speed: 1.15 });
    hero.yaw = Math.atan2(-ph.dir.x, -ph.dir.z);
  }

  /* ------------------------- state helpers ------------------------- */
  engage() {
    if (this.state !== 'dormant') return;
    this.state = 'engaged';
    this.attackCd = 1.0;
    this.stats.startT = this.now;
    // hit while still rising from a rematch: let him finish getting up, then he joins the fight
    if (this.guardState !== 'getup') {
      this.guardState = 'approach';
      this.guard.ch.play('idle', { fade: 0.3, loop: true });
    }
    this.hooks.onState('engaged');
    this.hooks.onBossCard();
  }

  disengage() {
    if (this.state !== 'engaged') return;
    this.state = 'dormant';
    this.guardState = 'return';
    this.guard.move = null;
    this.guard.trail.active = false;
    this.guard.weapon.uniforms.uGlow.value = 0;
    this.posture = 0;
    this.pending = [];
    this.hooks.onState('dormant');
  }

  retry() {
    const hero = this.hero, guard = this.guard;
    hero.hp = hero.maxHp;
    hero.move = null;
    hero.pos.set(-1.5, 0, 2.6);
    hero.yaw = Math.atan2(GUARD_POST.x + 1.5, GUARD_POST.z - 2.6);
    hero.ch.play('idle', { fade: 0.2, loop: true });
    this.heroState = 'free';
    this.pending = [];
    if (this.state !== 'victory') {
      guard.hp = guard.maxHp;
      this.posture = 0;
      guard.move = null;
      guard.pos.copy(GUARD_POST);
      guard.yaw = Math.atan2(-GUARD_POST.x, -GUARD_POST.z);
      guard.ch.play('idle', { fade: 0.2, loop: true });
      this.guardState = 'post';
      this.state = 'dormant';
      this.hooks.onState('dormant');
    }
    this.counterUntil = -9;
    this.parryPressT = -9;
    hero.trail.clear();
    guard.trail.clear();
  }

  distHeroGuard() {
    return this.hero.pos.distanceTo(this.guard.pos);
  }
  guardChest() {
    return new THREE.Vector3(this.guard.pos.x, this.guard.pos.y + 1.4, this.guard.pos.z);
  }
  heroHead() {
    return new THREE.Vector3(this.hero.pos.x, this.hero.pos.y + 1.5, this.hero.pos.z);
  }
}
