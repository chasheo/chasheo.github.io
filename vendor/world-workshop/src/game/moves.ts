/**
 * Move tables. All times are CLIP time in seconds (speed 1), measured from the real blade-tip speed curve
 * (tools/cut-windows.mjs, see docs/ANIMATION.md). `hits[].from/to` bracket the >45%-of-peak blade speed window.
 */
export interface HitSpec {
  from: number;
  to: number;
  peak: number;
  dmg: number;
  posture: number;
  heavy?: boolean;
  knock?: number;
  /**
   * Real weapon reach in metres: furthest horizontal distance of the blade tip from the attacker during the hit
   * window, measured in the running game (tests/reach-probe.js). Used for the step-in before the swing and for the
   * peak fallback, which only accepts the target's body surface inside this reach (never a hit through thin air).
   */
  range: number;
  arc: number; // degrees
}

export interface MoveSpec {
  id: string;
  clip: string;
  start: number;
  end: number;
  speed: number;
  hits: HitSpec[];
  chainFrom?: number;
  turnUntil: number;
  trail: [number, number];
  sfx: [number, string][];
  rootScale: number;
  iframes?: [number, number];
  /**
   * gameplay-driven dash (used by the dodge instead of the clip's own root motion): `dist` metres along the chosen
   * direction, covered by clip time `until` on an ease-out curve (fast burst, soft stop)
   */
  dash?: { dist: number; until: number };
  /** charge: clip time range [from, until] slowed by `slow` while held; held at `until` up to maxHold seconds */
  charge?: { from: number; until: number; slow: number; maxHold: number };
  /** telegraph (danger glint) start, clip time */
  tell?: number;
  /** windup playback multiplier before the first hit (enemy rhythm) */
  windup?: number;
  impactAt?: number;
}

export const HERO_MOVES: Record<string, MoveSpec> = {
  // four quick cuts cut from ONE continuous Mixamo combo (1070941): each cut ends in the pose the next one starts
  // from, so chaining reads as one flowing sequence. Played at 1.3x for a brisk rhythm.
  light1: {
    id: 'light1', clip: 'light1', start: 0.0, end: 0.93, speed: 1.3,
    hits: [{ from: 0.42, to: 0.7, peak: 0.52, dmg: 8, posture: 7, range: 1.45, arc: 150 }],
    chainFrom: 0.6, turnUntil: 0.38, trail: [0.38, 0.74], sfx: [[0.4, 'swing_light']], rootScale: 0.3,
  },
  light2: {
    id: 'light2', clip: 'light2', start: 0.0, end: 0.87, speed: 1.3,
    hits: [{ from: 0.46, to: 0.68, peak: 0.53, dmg: 8, posture: 7, range: 1.25, arc: 150 }],
    chainFrom: 0.62, turnUntil: 0.4, trail: [0.42, 0.7], sfx: [[0.44, 'swing_light']], rootScale: 0.3,
  },
  light3: {
    id: 'light3', clip: 'light3', start: 0.0, end: 1.0, speed: 1.3,
    hits: [{ from: 0.58, to: 0.84, peak: 0.7, dmg: 9, posture: 8, range: 1.6, arc: 150 }],
    chainFrom: 0.78, turnUntil: 0.52, trail: [0.54, 0.86], sfx: [[0.56, 'swing_light']], rootScale: 0.3,
  },
  light4: {
    id: 'light4', clip: 'light4', start: 0.0, end: 0.93, speed: 1.3,
    hits: [{ from: 0.38, to: 0.64, peak: 0.48, dmg: 10, posture: 9, range: 1.05, arc: 170 }],
    chainFrom: 0.58, turnUntil: 0.34, trail: [0.34, 0.68], sfx: [[0.36, 'swing_light']], rootScale: 0.3,
  },
  // finisher (Great Sword Jump Attack 1080464): crouch (charge: hold the button to stay crouched and build power),
  // leap with the blade overhead, chop straight down onto the target and land.
  heavy: {
    id: 'heavy', clip: 'heavy', start: 0.0, end: 1.75, speed: 1.05,
    // hit window = the actual downward chop (tip falls from 1.9 m overhead to 0.75 m at 0.86-1.0 s); before that
    // the blade is still raised behind the head
    hits: [{ from: 0.86, to: 1.04, peak: 0.94, dmg: 22, posture: 32, heavy: true, knock: 1.5, range: 1.75, arc: 160 }],
    turnUntil: 0.6, trail: [0.8, 1.06], sfx: [[0.84, 'swing_heavy']], rootScale: 0.28,
    charge: { from: 0.05, until: 0.2, slow: 0.4, maxHold: 0.9 }, impactAt: 1.02,
  },
  counter: {
    id: 'counter', clip: 'counter', start: 0.05, end: 1.6, speed: 1.15,
    hits: [
      { from: 0.34, to: 0.52, peak: 0.42, dmg: 12, posture: 20, range: 1.1, arc: 220 },
      { from: 0.92, to: 1.2, peak: 1.02, dmg: 18, posture: 28, heavy: true, knock: 1.1, range: 1.9, arc: 220 },
    ],
    turnUntil: 0.3, trail: [0.3, 1.24], sfx: [[0.33, 'swing_heavy'], [0.9, 'swing_heavy']], rootScale: 0.22, iframes: [0, 0.6],
  },
  dodge: {
    id: 'dodge', clip: 'dodge', start: 0.0, end: 0.86, speed: 1.55, hits: [], turnUntil: 0.05, trail: [9, 9], sfx: [[0.02, 'dodge']], rootScale: 0, iframes: [0.03, 0.6],
    dash: { dist: 3.4, until: 0.5 },
  },
};

/** the heroine's chain: each light cut buffers into the next, the fifth is the charged finisher */
export const HERO_CHAIN: Record<string, string> = { light1: 'light2', light2: 'light3', light3: 'light4', light4: 'heavy' };

export const GUARD_MOVES: Record<string, MoveSpec> = {
  chop: {
    id: 'chop', clip: 'chop', start: 0.0, end: 2.0, speed: 0.95,
    hits: [{ from: 1.16, to: 1.56, peak: 1.38, dmg: 22, posture: 0, range: 1.75, arc: 95 }],
    turnUntil: 1.0, trail: [1.02, 1.66], sfx: [[1.1, 'swing_heavy']], rootScale: 0.3, tell: 0.5, windup: 0.9, impactAt: 1.45,
  },
  sweep: {
    id: 'sweep', clip: 'sweep', start: 0.12, end: 1.8, speed: 1.0,
    hits: [{ from: 0.82, to: 1.04, peak: 0.94, dmg: 18, posture: 0, range: 1.7, arc: 170 }],
    turnUntil: 0.7, trail: [0.76, 1.1], sfx: [[0.8, 'swing_heavy']], rootScale: 0, tell: 0.4, windup: 0.95,
  },
  back: {
    id: 'back', clip: 'back', start: 0.0, end: 1.15, speed: 1.0,
    hits: [{ from: 0.32, to: 0.56, peak: 0.44, dmg: 16, posture: 0, range: 1.1, arc: 140 }],
    turnUntil: 0.26, trail: [0.24, 0.62], sfx: [[0.3, 'swing_heavy']], rootScale: 0.25, tell: 0.1, windup: 1.05,
  },
  // one-hand axe hacks (One Hand Club Combo 1076105): fast forehand, backhand, then a low crushing overhand
  axe1: {
    id: 'axe1', clip: 'axe1', start: 0.0, end: 0.87, speed: 1.0,
    hits: [{ from: 0.3, to: 0.52, peak: 0.38, dmg: 12, posture: 0, range: 1.55, arc: 130 }],
    turnUntil: 0.26, trail: [0.26, 0.58], sfx: [[0.28, 'swing_heavy']], rootScale: 0.25, tell: 0.0, windup: 0.7,
  },
  axe2: {
    id: 'axe2', clip: 'axe2', start: 0.0, end: 0.8, speed: 1.0,
    hits: [{ from: 0.36, to: 0.56, peak: 0.4, dmg: 12, posture: 0, range: 1.75, arc: 130 }],
    turnUntil: 0.3, trail: [0.32, 0.6], sfx: [[0.34, 'swing_heavy']], rootScale: 0.25, tell: 0.1, windup: 0.85,
  },
  axe3: {
    id: 'axe3', clip: 'axe3', start: 0.0, end: 1.0, speed: 1.0,
    hits: [{ from: 0.24, to: 0.5, peak: 0.33, dmg: 18, posture: 0, range: 1.75, arc: 110 }],
    turnUntil: 0.2, trail: [0.2, 0.56], sfx: [[0.22, 'swing_heavy']], rootScale: 0.25, tell: 0.0, windup: 0.75, impactAt: 0.5,
  },
  // two-handed crushing slams (Two Hand Club Combo 1076791): overhead slam, deeper slam, rising swing
  slam1: {
    id: 'slam1', clip: 'slam1', start: 0.1, end: 1.33, speed: 1.0,
    hits: [{ from: 0.64, to: 0.92, peak: 0.78, dmg: 20, posture: 0, range: 1.55, arc: 100 }],
    turnUntil: 0.55, trail: [0.56, 0.98], sfx: [[0.6, 'swing_heavy']], rootScale: 0.3, tell: 0.3, windup: 0.9, impactAt: 0.82,
  },
  slam2: {
    id: 'slam2', clip: 'slam2', start: 0.15, end: 1.33, speed: 1.0,
    hits: [{ from: 0.66, to: 0.96, peak: 0.82, dmg: 22, posture: 0, range: 1.55, arc: 100 }],
    turnUntil: 0.58, trail: [0.6, 1.0], sfx: [[0.64, 'swing_heavy']], rootScale: 0.3, tell: 0.35, windup: 0.95, impactAt: 0.86,
  },
  slam3: {
    id: 'slam3', clip: 'slam3', start: 0.2, end: 1.33, speed: 1.0,
    hits: [{ from: 0.66, to: 0.96, peak: 0.83, dmg: 18, posture: 0, range: 1.45, arc: 150 }],
    turnUntil: 0.6, trail: [0.6, 1.0], sfx: [[0.64, 'swing_heavy']], rootScale: 0.3, tell: 0.4, windup: 1.0,
  },
};

/**
 * Guardian strings. Each entry: the moves in order and the chance each follow-up continues (so the visitor can't
 * memorise a fixed count). Every hit keeps its own telegraph and parry window; a parry or heavy hit ends the string.
 */
export const GUARD_COMBOS: Record<string, { moves: string[]; follow: number }> = {
  chop: { moves: ['chop', 'back'], follow: 0.45 },
  sweep: { moves: ['sweep'], follow: 0 },
  hack: { moves: ['axe1', 'axe2', 'axe3'], follow: 0.85 },
  slam: { moves: ['slam1', 'slam2', 'slam3'], follow: 0.8 },
};

/** Parry tuning (seconds). Exposed through window.__ww.tuning in the standalone page for iteration. */
export const PARRY = {
  pre: 0.18, // press up to this long before contact
  post: 0.06, // small tolerance after contact (damage is deferred by this much)
  lockout: 0.42, // a press cannot be repeated within this time (no spamming)
  spamPenalty: 0.3, // pressing again inside the lockout extends it by this much
  earlyFeedback: 0.55, // presses between pre and this read as "too early"
  lateFeedback: 0.3, // presses within this after taking a hit read as "too late"
  counterWindow: 1.15,
};

export const STATS = {
  heroHP: 100,
  guardHP: 300,
  guardPosture: 100,
  postureRegen: 9,
  postureRegenDelay: 1.6,
  parryPosture: 28,
  brokenTime: 2.6,
};
