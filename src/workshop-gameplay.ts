/** Browser-local combat. Rendering, animation clips and network sessions stay outside this model. */
export type ActorAction = 'idle' | 'run' | 'attack' | 'dodge' | 'hurt' | 'death';
export interface ActorState {
  x: number; z: number; facing: number; action: ActorAction; actionTime: number;
  health: number; maxHealth: number;
}
export interface CombatInput { moveX: number; moveZ: number; attack: boolean; dodge: boolean }
export interface CombatEvent {
  type: 'hit' | 'dodge' | 'victory' | 'defeat'; actor: 'player' | 'enemy';
  x: number; z: number; damage?: number;
}

export const COMBAT = {
  bounds: { minX: -3.5, maxX: 3.5, minZ: -1.6, maxZ: 3.5 },
  playerSpeed: 2.65, enemySpeed: 1.35, bodyRadius: 0.38,
  playerAttackDuration: 0.95, playerStrikeTime: 0.45, playerReach: 1.85,
  enemyAttackDuration: 1.38, enemyStrikeTime: 0.65, enemyReach: 1.6,
  dodgeDuration: 0.44, dodgeSpeed: 5.7, dodgeCooldown: 0.95,
  dodgeInvulnerableStart: 0.035, dodgeInvulnerableEnd: 0.34,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const distance = (a: ActorState, b: ActorState) => Math.hypot(a.x - b.x, a.z - b.z);
const makeActor = (x: number, z: number, facing: number): ActorState => ({
  x, z, facing, action: 'idle', actionTime: 0, health: 100, maxHealth: 100,
});

export class WorkshopCombat {
  player = makeActor(-1.1, 2.2, Math.PI);
  enemy = makeActor(0.9, -1.2, 0);
  won = false;
  lost = false;
  private attackHeld = false;
  private dodgeHeld = false;
  private attackBuffer = 0;
  private dodgeBuffer = 0;
  private dodgeRemaining = 0;
  private enemyRecovery = 0.75;
  private playerProtection = 0;
  private playerStruck = false;
  private enemyStruck = false;
  private dodgeX = 0;
  private dodgeZ = 1;
  private accumulator = 0;

  /** 0 outside a windup; rises toward 1 before the enemy's damaging frame. */
  get enemyWindup(): number {
    return this.enemy.action === 'attack' && this.enemy.actionTime < COMBAT.enemyStrikeTime
      ? clamp(this.enemy.actionTime / COMBAT.enemyStrikeTime, 0.001, 1) : 0;
  }
  get enemyPhase(): 'none' | 'windup' | 'strike' | 'recovery' {
    if (this.enemy.action !== 'attack') return 'none';
    if (this.enemy.actionTime < COMBAT.enemyStrikeTime) return 'windup';
    return this.enemy.actionTime < COMBAT.enemyStrikeTime + 0.13 ? 'strike' : 'recovery';
  }
  get canDodge(): boolean { return this.dodgeRemaining <= 0 && !this.lost; }
  get playerInvulnerable(): boolean {
    return this.player.action === 'dodge' && this.player.actionTime >= COMBAT.dodgeInvulnerableStart
      && this.player.actionTime <= COMBAT.dodgeInvulnerableEnd;
  }

  reset(): void {
    this.player = makeActor(-1.1, 2.2, Math.PI);
    this.enemy = makeActor(0.9, -1.2, 0);
    this.won = this.lost = false;
    this.attackHeld = this.dodgeHeld = false;
    this.attackBuffer = this.dodgeBuffer = this.dodgeRemaining = this.playerProtection = 0;
    this.enemyRecovery = 0.75;
    this.playerStruck = this.enemyStruck = false;
    this.accumulator = 0;
  }

  /** Inputs are world-space. Attack and dodge are press edges, never automatic repeats. */
  update(dt: number, input: CombatInput): CombatEvent[] {
    const events: CombatEvent[] = [];
    if (!Number.isFinite(dt) || dt <= 0) return events;
    if (input.attack && !this.attackHeld) this.attackBuffer = 0.22;
    if (input.dodge && !this.dodgeHeld) this.dodgeBuffer = 0.18;
    this.attackHeld = input.attack;
    this.dodgeHeld = input.dodge;
    let moveX = Number.isFinite(input.moveX) ? input.moveX : 0;
    let moveZ = Number.isFinite(input.moveZ) ? input.moveZ : 0;
    const length = Math.hypot(moveX, moveZ);
    if (length > 1) { moveX /= length; moveZ /= length; }
    // Fixed simulation steps preserve hit windows at different rendering frame rates.
    // Time spent in a background tab is deliberately not fast-forwarded into combat.
    this.accumulator += Math.min(dt, 0.1);
    const step = 1 / 120;
    while (this.accumulator + 1e-9 >= step) {
      this.tick(step, moveX, moveZ, events);
      this.accumulator -= step;
    }
    return events;
  }

  private setAction(actor: ActorState, action: ActorAction): void {
    if (actor.action !== action) { actor.action = action; actor.actionTime = 0; }
  }

  private move(actor: ActorState, other: ActorState, dx: number, dz: number): void {
    const b = COMBAT.bounds;
    let x = clamp(actor.x + dx, b.minX, b.maxX);
    let z = clamp(actor.z + dz, b.minZ, b.maxZ);
    if (other.health > 0) {
      const separation = Math.hypot(x - other.x, z - other.z);
      const radius = COMBAT.bodyRadius * 2;
      if (separation < radius) {
        const angle = separation > 0.0001 ? Math.atan2(x - other.x, z - other.z) : actor.facing + Math.PI;
        x = other.x + Math.sin(angle) * radius;
        z = other.z + Math.cos(angle) * radius;
      }
    }
    actor.x = clamp(x, b.minX, b.maxX);
    actor.z = clamp(z, b.minZ, b.maxZ);
  }

  private inStrike(attacker: ActorState, victim: ActorState, reach: number): boolean {
    const dx = victim.x - attacker.x, dz = victim.z - attacker.z;
    const length = Math.hypot(dx, dz);
    return length <= reach && (length < 0.001 ||
      (Math.sin(attacker.facing) * dx + Math.cos(attacker.facing) * dz) / length >= 0.38);
  }

  private hit(target: 'player' | 'enemy', damage: number, events: CombatEvent[]): void {
    const victim = target === 'player' ? this.player : this.enemy;
    if (victim.health <= 0) return;
    if (target === 'player' && (this.playerInvulnerable || this.playerProtection > 0)) return;
    victim.health = Math.max(0, victim.health - damage);
    events.push({ type: 'hit', actor: target, x: victim.x, z: victim.z, damage });
    if (victim.health === 0) {
      this.setAction(victim, 'death');
      if (target === 'enemy') this.won = true; else this.lost = true;
      events.push({ type: target === 'enemy' ? 'victory' : 'defeat', actor: target, x: victim.x, z: victim.z });
      return;
    }
    // A late committed enemy strike has poise, so repeated clicks cannot cancel every attack.
    const committed = target === 'enemy' && victim.action === 'attack'
      && victim.actionTime >= 0.30 && victim.actionTime <= COMBAT.enemyStrikeTime + 0.10;
    if (!committed) this.setAction(victim, 'hurt');
    if (target === 'player') this.playerProtection = 0.60;
  }

  private tick(dt: number, moveX: number, moveZ: number, events: CombatEvent[]): void {
    const p = this.player, e = this.enemy;
    p.actionTime += dt;
    e.actionTime += dt;
    this.dodgeRemaining = Math.max(0, this.dodgeRemaining - dt);
    this.enemyRecovery = Math.max(0, this.enemyRecovery - dt);
    this.playerProtection = Math.max(0, this.playerProtection - dt);

    if (this.lost) return;

    if (p.action === 'attack') {
      if (!this.playerStruck && p.actionTime >= COMBAT.playerStrikeTime) {
        this.playerStruck = true;
        if (!this.won && this.inStrike(p, e, COMBAT.playerReach)) this.hit('enemy', 25, events);
      }
      if (p.actionTime >= COMBAT.playerAttackDuration) this.setAction(p, 'idle');
    } else if (p.action === 'dodge') {
      this.move(p, e, this.dodgeX * COMBAT.dodgeSpeed * dt, this.dodgeZ * COMBAT.dodgeSpeed * dt);
      if (p.actionTime >= COMBAT.dodgeDuration) this.setAction(p, 'idle');
    } else if (p.action === 'hurt' && p.actionTime >= 0.36) this.setAction(p, 'idle');

    const moving = Math.hypot(moveX, moveZ) > 0.05;
    const canAct = p.action === 'idle' || p.action === 'run';
    const canCancel = p.action === 'attack' && p.actionTime > 0.40;
    if (this.dodgeBuffer > 0 && this.dodgeRemaining <= 0 && (canAct || canCancel)) {
      this.dodgeX = moving ? moveX : -Math.sin(p.facing);
      this.dodgeZ = moving ? moveZ : -Math.cos(p.facing);
      const length = Math.hypot(this.dodgeX, this.dodgeZ) || 1;
      this.dodgeX /= length; this.dodgeZ /= length;
      this.setAction(p, 'dodge');
      this.dodgeRemaining = COMBAT.dodgeCooldown;
      this.dodgeBuffer = 0;
      this.attackBuffer = 0;
      events.push({ type: 'dodge', actor: 'player', x: p.x, z: p.z });
    } else if (this.attackBuffer > 0 && canAct) {
      // Gentle aim assistance when stationary; moving attacks follow the chosen direction.
      if (!moving && e.health > 0 && distance(p, e) < 3.5) p.facing = Math.atan2(e.x - p.x, e.z - p.z);
      else if (moving) p.facing = Math.atan2(moveX, moveZ);
      this.setAction(p, 'attack');
      this.playerStruck = false;
      this.attackBuffer = 0;
    } else if (canAct) {
      if (moving) {
        p.facing = Math.atan2(moveX, moveZ);
        this.move(p, e, moveX * COMBAT.playerSpeed * dt, moveZ * COMBAT.playerSpeed * dt);
        this.setAction(p, 'run');
      } else this.setAction(p, 'idle');
    }
    this.attackBuffer = Math.max(0, this.attackBuffer - dt);
    this.dodgeBuffer = Math.max(0, this.dodgeBuffer - dt);

    if (this.won) return;
    if (e.action === 'attack') {
      if (!this.enemyStruck && e.actionTime >= COMBAT.enemyStrikeTime) {
        this.enemyStruck = true;
        if (this.inStrike(e, p, COMBAT.enemyReach)) this.hit('player', 22, events);
      }
      if (e.actionTime >= COMBAT.enemyAttackDuration) {
        this.setAction(e, 'idle');
        this.enemyRecovery = 0.48;
      }
    } else if (e.action === 'hurt') {
      if (e.actionTime >= 0.28) this.setAction(e, 'idle');
    } else if (e.action !== 'death') {
      const range = distance(p, e);
      e.facing = Math.atan2(p.x - e.x, p.z - e.z);
      if (range <= 1.48 && this.enemyRecovery <= 0) {
        this.setAction(e, 'attack');
        this.enemyStruck = false;
      } else if (range > 1.15) {
        this.setAction(e, 'run');
        this.move(e, p, Math.sin(e.facing) * COMBAT.enemySpeed * dt, Math.cos(e.facing) * COMBAT.enemySpeed * dt);
      } else this.setAction(e, 'idle');
    }
  }
}
