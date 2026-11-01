/** Fixed-step browser-local combat. Each clip has a distinct contact window. */
export type ActorAction = 'idle' | 'run' | 'attack' | 'attack2' | 'heavy' | 'cleave' | 'sweep' | 'counter' | 'parry' | 'stagger' | 'dodge' | 'hurt' | 'death';
export interface ActorState {
    x: number;
    z: number;
    facing: number;
    action: ActorAction;
    actionTime: number;
    health: number;
    maxHealth: number;
}
export interface CombatInput {
    moveX: number;
    moveZ: number;
    attack: boolean;
    dodge: boolean;
    parry?: boolean;
}
export interface CombatEvent {
    type: 'hit' | 'dodge' | 'victory' | 'defeat' | 'parry' | 'swing';
    actor: 'player' | 'enemy';
    x: number;
    z: number;
    damage?: number;
    heavy?: boolean;
}
export const COMBAT = {
    bounds: { minX: -3.5, maxX: 3.5, minZ: -1.6, maxZ: 3.5 }, playerSpeed: 2.65, enemySpeed: 1.35, bodyRadius: .38,
    playerAttackDuration: .78, playerStrikeTime: .34, playerReach: 1.85,
    enemyAttackDuration: 1.38, enemyStrikeTime: .65, enemyReach: 1.75,
    dodgeDuration: .44, dodgeSpeed: 5.7, dodgeCooldown: .95, dodgeInvulnerableStart: .035, dodgeInvulnerableEnd: .34,
    parryWindow: .16, parryLateGrace: .10, parryCooldown: .48, counterWindow: 1.15,
} as const;
export const ATTACKS: Partial<Record<ActorAction, {
    duration: number;
    contact: number;
    damage: number;
    reach: number;
    heavy?: boolean;
}>> = {
    attack: { duration: .78, contact: .34, damage: 12, reach: 1.85 },
    attack2: { duration: .8, contact: .36, damage: 16, reach: 1.9 },
    heavy: { duration: 1.12, contact: .59, damage: 34, reach: 2.05, heavy: true },
    counter: { duration: .78, contact: .32, damage: 30, reach: 2.1, heavy: true },
    cleave: { duration: 1.38, contact: .65, damage: 22, reach: 1.75 },
    sweep: { duration: 1.14, contact: .54, damage: 18, reach: 1.95 },
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const dist = (a: ActorState, b: ActorState) => Math.hypot(a.x - b.x, a.z - b.z);
const actor = (x: number, z: number, facing: number): ActorState => ({ x, z, facing, action: 'idle', actionTime: 0, health: 100, maxHealth: 100 });
export class WorkshopCombat {
    player = actor(-1.1, 2.2, Math.PI);
    enemy = actor(.9, -1.2, 0);
    won = false;
    lost = false;
    private held = { attack: false, dodge: false, parry: false };
    private attackBuffer = 0;
    private dodgeBuffer = 0;
    private dodgeRemaining = 0;
    private parryRemaining = 0;
    private enemyRecovery = .75;
    private protection = 0;
    private playerStruck = false;
    private enemyStruck = false;
    private dodgeX = 0;
    private dodgeZ = 1;
    private accumulator = 0;
    private comboQueued = false;
    private counterRemaining = 0;
    private enemySequence = 0;
    private recentHit: {
        remaining: number;
        damage: number;
        facing: number;
    } | null = null;
    private pushX = 0;
    private pushZ = 0;
    get enemyWindup() { const s = ATTACKS[this.enemy.action]; return s && this.enemy.actionTime < s.contact ? clamp(this.enemy.actionTime / s.contact, .001, 1) : 0; }
    get enemyPhase(): 'none' | 'windup' | 'strike' | 'recovery' { const s = ATTACKS[this.enemy.action]; return !s ? 'none' : this.enemy.actionTime < s.contact ? 'windup' : this.enemy.actionTime < s.contact + .13 ? 'strike' : 'recovery'; }
    get canDodge() { return this.dodgeRemaining <= 0 && !this.lost; }
    get playerInvulnerable() { return this.player.action === 'dodge' && this.player.actionTime >= COMBAT.dodgeInvulnerableStart && this.player.actionTime <= COMBAT.dodgeInvulnerableEnd; }
    get parryActive() { return this.player.action === 'parry' && this.player.actionTime <= COMBAT.parryWindow; }
    get counterReady() { return this.counterRemaining > 0; }
    get comboStage() { return this.player.action === 'attack' ? 1 : this.player.action === 'attack2' ? 2 : this.player.action === 'heavy' ? 3 : 0; }
    reset() { this.player = actor(-1.1, 2.2, Math.PI); this.enemy = actor(.9, -1.2, 0); this.won = this.lost = false; this.held = { attack: false, dodge: false, parry: false }; this.attackBuffer = this.dodgeBuffer = this.dodgeRemaining = this.parryRemaining = this.protection = this.counterRemaining = this.accumulator = 0; this.enemyRecovery = .75; this.enemySequence = 0; this.playerStruck = this.enemyStruck = this.comboQueued = false; this.recentHit = null; this.pushX = this.pushZ = 0; }
    private set(a: ActorState, s: ActorAction) { a.action = s; a.actionTime = 0; }
    private move(a: ActorState, b: ActorState, dx: number, dz: number) { const r = COMBAT.bodyRadius * 2, B = COMBAT.bounds; let x = clamp(a.x + dx, B.minX, B.maxX), z = clamp(a.z + dz, B.minZ, B.maxZ); if (b.health > 0) {
        const d = Math.hypot(x - b.x, z - b.z);
        if (d < r) {
            const t = d > .0001 ? Math.atan2(x - b.x, z - b.z) : a.facing + Math.PI;
            x = b.x + Math.sin(t) * r;
            z = b.z + Math.cos(t) * r;
        }
    } a.x = clamp(x, B.minX, B.maxX); a.z = clamp(z, B.minZ, B.maxZ); }
    private inStrike(a: ActorState, b: ActorState, reach: number) { const x = b.x - a.x, z = b.z - a.z, d = Math.hypot(x, z); return d <= reach && (d < .001 || (Math.sin(a.facing) * x + Math.cos(a.facing) * z) / d >= .38); }
    private startAttack(action: ActorAction, events: CombatEvent[], facing?: number) { this.player.facing = facing ?? Math.atan2(this.enemy.x - this.player.x, this.enemy.z - this.player.z); this.set(this.player, action); this.playerStruck = false; this.attackBuffer = 0; this.comboQueued = false; events.push({ type: 'swing', actor: 'player', x: this.player.x, z: this.player.z, heavy: ATTACKS[action]?.heavy }); }
    private staggerEnemy(strength: number) { this.set(this.enemy, 'stagger'); this.enemyStruck = true; this.enemyRecovery = 1; const d = dist(this.player, this.enemy) || 1; this.pushX = (this.enemy.x - this.player.x) / d * strength; this.pushZ = (this.enemy.z - this.player.z) / d * strength; }
    private parry(events: CombatEvent[]) { if (this.recentHit) {
        this.player.health = Math.min(100, this.player.health + this.recentHit.damage);
        this.lost = false;
        this.recentHit = null;
    } this.set(this.player, 'parry'); this.staggerEnemy(2.8); this.counterRemaining = COMBAT.counterWindow; this.protection = .4; events.push({ type: 'parry', actor: 'player', x: (this.player.x + this.enemy.x) / 2, z: (this.player.z + this.enemy.z) / 2 }); }
    private damage(target: 'player' | 'enemy', spec: NonNullable<typeof ATTACKS[ActorAction]>, events: CombatEvent[]) {
        const a = target === 'player' ? this.player : this.enemy;
        if (a.health <= 0)
            return;
        if (target === 'player' && (this.playerInvulnerable || this.protection > 0))
            return;
        if (target === 'player' && this.parryActive && this.inStrike(this.player, this.enemy, 3)) {
            this.parry(events);
            return;
        }
        a.health = Math.max(0, a.health - spec.damage);
        events.push({ type: 'hit', actor: target, x: a.x, z: a.z, damage: spec.damage, heavy: spec.heavy });
        if (a.health === 0) {
            this.set(a, 'death');
            if (target === 'enemy')
                this.won = true;
            else
                this.lost = true;
            events.push({ type: target === 'enemy' ? 'victory' : 'defeat', actor: target, x: a.x, z: a.z });
            if (target === 'enemy')
                return;
        }
        if (target === 'enemy') {
            if (spec.heavy && a.health > 0)
                this.staggerEnemy(4.2); /* Light hits preserve enemy attacks and poise. */
        }
        else {
            this.recentHit = { remaining: COMBAT.parryLateGrace, damage: spec.damage, facing: this.enemy.facing };
            this.protection = .48;
            if (a.health > 0)
                this.set(a, 'hurt');
            this.comboQueued = false;
        }
    }
    update(dt: number, input: CombatInput): CombatEvent[] {
        const events: CombatEvent[] = [];
        if (!Number.isFinite(dt) || dt <= 0)
            return events;
        if (input.attack && !this.held.attack) {
            if (this.comboStage > 0 && this.player.actionTime > .08)
                this.comboQueued = true;
            else
                this.attackBuffer = .23;
        }
        if (input.dodge && !this.held.dodge)
            this.dodgeBuffer = .18;
        if (input.parry && !this.held.parry && this.parryRemaining <= 0 && !this.won && (!this.lost || this.recentHit)) {
            this.player.facing = Math.atan2(this.enemy.x - this.player.x, this.enemy.z - this.player.z);
            this.parryRemaining = COMBAT.parryCooldown;
            this.comboQueued = false;
            this.attackBuffer = 0;
            if (this.recentHit && this.inStrike(this.player, this.enemy, 3))
                this.parry(events);
            else if (!['dodge', 'death'].includes(this.player.action))
                this.set(this.player, 'parry');
        }
        this.held = { attack: input.attack, dodge: input.dodge, parry: Boolean(input.parry) };
        let x = Number.isFinite(input.moveX) ? input.moveX : 0, z = Number.isFinite(input.moveZ) ? input.moveZ : 0;
        const d = Math.hypot(x, z);
        if (d > 1) {
            x /= d;
            z /= d;
        }
        this.accumulator += Math.min(dt, .1);
        while (this.accumulator + 1e-9 >= 1 / 120) {
            this.tick(1 / 120, x, z, events);
            this.accumulator -= 1 / 120;
        }
        return events;
    }
    private tick(dt: number, x: number, z: number, events: CombatEvent[]) {
        const p = this.player, e = this.enemy;
        p.actionTime += dt;
        e.actionTime += dt;
        this.dodgeRemaining = Math.max(0, this.dodgeRemaining - dt);
        this.parryRemaining = Math.max(0, this.parryRemaining - dt);
        this.enemyRecovery = Math.max(0, this.enemyRecovery - dt);
        this.protection = Math.max(0, this.protection - dt);
        this.counterRemaining = Math.max(0, this.counterRemaining - dt);
        if (this.recentHit) {
            this.recentHit.remaining -= dt;
            if (this.recentHit.remaining <= 0)
                this.recentHit = null;
        }
        if (this.lost)
            return;
        const spec = ATTACKS[p.action];
        if (spec) {
            if (!this.playerStruck && p.actionTime >= spec.contact) {
                this.playerStruck = true;
                if (!this.won && this.inStrike(p, e, spec.reach))
                    this.damage('enemy', spec, events);
            }
            if (p.actionTime >= spec.duration) {
                const next = p.action === 'attack' ? 'attack2' : p.action === 'attack2' ? 'heavy' : null;
                if (this.comboQueued && next)
                    this.startAttack(next, events);
                else {
                    this.set(p, 'idle');
                    this.comboQueued = false;
                }
            }
        }
        else if (p.action === 'dodge') {
            this.move(p, e, this.dodgeX * COMBAT.dodgeSpeed * dt, this.dodgeZ * COMBAT.dodgeSpeed * dt);
            if (p.actionTime >= COMBAT.dodgeDuration)
                this.set(p, 'idle');
        }
        else if ((p.action === 'hurt' && p.actionTime >= .36) || (p.action === 'parry' && p.actionTime >= .34))
            this.set(p, 'idle');
        const moving = Math.hypot(x, z) > .05, canAct = p.action === 'idle' || p.action === 'run';
        if (this.dodgeBuffer > 0 && this.canDodge && (canAct || Boolean(ATTACKS[p.action]) && p.actionTime > .35 || p.action === 'parry')) {
            this.dodgeX = moving ? x : -Math.sin(p.facing);
            this.dodgeZ = moving ? z : -Math.cos(p.facing);
            const n = Math.hypot(this.dodgeX, this.dodgeZ) || 1;
            this.dodgeX /= n;
            this.dodgeZ /= n;
            this.set(p, 'dodge');
            this.dodgeRemaining = COMBAT.dodgeCooldown;
            this.dodgeBuffer = this.attackBuffer = 0;
            this.comboQueued = false;
            events.push({ type: 'dodge', actor: 'player', x: p.x, z: p.z });
        }
        else if (this.attackBuffer > 0 && (canAct || p.action === 'parry' && this.counterReady)) {
            const counter = this.counterReady;
            this.startAttack(counter ? 'counter' : 'attack', events, moving && !counter ? Math.atan2(x, z) : undefined);
            if (counter)
                this.counterRemaining = 0;
        }
        else if (canAct) {
            if (moving) {
                p.facing = Math.atan2(x, z);
                this.move(p, e, x * COMBAT.playerSpeed * dt, z * COMBAT.playerSpeed * dt);
                if (p.action !== 'run')
                    this.set(p, 'run');
            }
            else if (p.action !== 'idle')
                this.set(p, 'idle');
        }
        this.attackBuffer = Math.max(0, this.attackBuffer - dt);
        this.dodgeBuffer = Math.max(0, this.dodgeBuffer - dt);
        if (this.won)
            return;
        const es = ATTACKS[e.action];
        if (es) {
            if (!this.enemyStruck && e.actionTime >= es.contact) {
                this.enemyStruck = true;
                if (this.inStrike(e, p, es.reach))
                    this.damage('player', es, events);
            }
            if (e.actionTime >= es.duration) {
                this.set(e, 'idle');
                this.enemyRecovery = .42;
            }
        }
        else if (e.action === 'stagger') {
            this.move(e, p, this.pushX * dt, this.pushZ * dt);
            this.pushX *= Math.exp(-dt * 7);
            this.pushZ *= Math.exp(-dt * 7);
            if (e.actionTime >= .9)
                this.set(e, 'idle');
        }
        else if (e.action !== 'death') {
            e.facing = Math.atan2(p.x - e.x, p.z - e.z);
            if (dist(p, e) <= 1.5 && this.enemyRecovery <= 0) {
                const action = this.enemySequence++ % 2 === 0 ? 'cleave' : 'sweep';
                this.set(e, action);
                this.enemyStruck = false;
                events.push({ type: 'swing', actor: 'enemy', x: e.x, z: e.z, heavy: action === 'cleave' });
            }
            else if (dist(p, e) > 1.2) {
                if (e.action !== 'run')
                    this.set(e, 'run');
                this.move(e, p, Math.sin(e.facing) * COMBAT.enemySpeed * dt, Math.cos(e.facing) * COMBAT.enemySpeed * dt);
            }
            else if (e.action !== 'idle')
                this.set(e, 'idle');
        }
    }
}
