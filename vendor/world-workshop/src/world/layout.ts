import { clamp, distToPolyline, fbm, smooth } from './util';

/** World layout in meters. +Y up. The courtyard center is the origin; the arrival path comes from the south-east (+z). */

export interface HouseSpec {
  id: string;
  x: number;
  z: number;
  /** yaw: house front (+z local) rotated by this angle */
  rot: number;
  width: number;
  depth: number;
  /** ground pad height at the house */
  ground: number;
  /** plinth (stone base) height above ground */
  plinth: number;
  /** column (eave) height above plinth */
  colH: number;
  bays: number;
  veranda: number;
  roofPitch: number;
  overhang: number;
  storeys: 1 | 2;
  stilts?: number;
  seed: number;
}

export const HOUSES: HouseSpec[] = [
  // Main hall (north): widest, raised plinth, two-storey loft, faces the courtyard.
  { id: 'hall', x: -1.6, z: -11.2, rot: 0.04, width: 11.6, depth: 7.4, ground: 0.25, plinth: 0.72, colH: 3.4, bays: 5, veranda: 1.4, roofPitch: 0.62, overhang: 1.25, storeys: 2, seed: 3 },
  // West wing: lower, rotated to face east, partly hidden by bamboo.
  { id: 'west', x: -12.2, z: 0.2, rot: 1.42, width: 8.4, depth: 5.8, ground: 0.35, plinth: 0.42, colH: 3.0, bays: 3, veranda: 1.1, roofPitch: 0.58, overhang: 1.05, storeys: 1, seed: 7 },
  // East workshop on a higher terrace (stilted front), faces south-west down to the yard.
  { id: 'east', x: 11.4, z: -7.6, rot: -0.86, width: 7.2, depth: 5.4, ground: 1.85, plinth: 0.36, colH: 2.9, bays: 3, veranda: 1.2, roofPitch: 0.66, overhang: 1.0, storeys: 1, stilts: 1.6, seed: 11 },
];

/** The world gate (光门) sits up the north-east lane between the hall and the workshop. */
export const GATE = { x: 6.4, z: -18.6, rot: 0.02, ground: 2.7 };

export const YARD = { hw: 8.6, hd: 6.4 };

/** Arrival path from the valley up to the yard; secondary lane from yard to the gate. */
export const PATH_MAIN: [number, number][] = [
  [15, 40], [12.5, 31], [9.0, 23], [6.6, 16], [4.4, 10.5], [3.0, 6.0], [1.5, 2.0],
];
export const PATH_GATE: [number, number][] = [
  [4.0, -3.5], [6.1, -7.0], [6.6, -11.5], [6.4, -16.4],
];

export const SECTIONS = {
  arrival: { target: [1.6, 2.2, -1.5] as const, yaw: 0.36, pitch: 0.2, dist: 20, minDist: 10, maxDist: 26 },
  courtyard: { target: [0.2, 1.1, -0.6] as const, yaw: 0.35, pitch: 0.24, dist: 9.5, minDist: 5, maxDist: 15 },
  worlds: { target: [6.4, 4.4, -18.2] as const, yaw: 0.22, pitch: 0.12, dist: 9.2, minDist: 4.5, maxDist: 11 },
};

interface Pad {
  id: string;
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
  y: number;
  blend: number;
}

const PADS: Pad[] = [
  { id: 'yard', x: 0, z: 0, hw: YARD.hw + 0.5, hd: YARD.hd + 0.4, rot: 0, y: 0, blend: 1.4 },
  ...HOUSES.map((h) => ({ id: h.id, x: h.x, z: h.z, hw: h.width / 2 + 1.6, hd: h.depth / 2 + 1.6, rot: h.rot, y: h.ground, blend: h.id === 'east' ? 1.2 : 2.4 })),
  { id: 'gate', x: GATE.x, z: GATE.z, hw: 3.4, hd: 2.6, rot: GATE.rot, y: GATE.ground, blend: 2.6 },
];

/** 1 inside the paved courtyard, fading to 0 within 1 m outside it. */
function yardCore(x: number, z: number) {
  const ox = Math.max(0, Math.abs(x) - (YARD.hw - 0.2)), oz = Math.max(0, Math.abs(z) - (YARD.hd - 0.2));
  return 1 - smooth(0, 1.0, Math.hypot(ox, oz));
}

function padMask(p: Pad, x: number, z: number) {
  const c = Math.cos(-p.rot), s = Math.sin(-p.rot);
  const dx = x - p.x, dz = z - p.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const ox = Math.max(0, Math.abs(lx) - p.hw), oz = Math.max(0, Math.abs(lz) - p.hd);
  const d = Math.hypot(ox, oz);
  const m = 1 - smooth(0, p.blend, d);
  // the rotated east-terrace pad must not lift the courtyard's north-east corner (the fight happens there)
  return p.id === 'east' ? m * (1 - yardCore(x, z)) : m;
}

/** Natural terrain before pads/paths. */
function rawHeight(x: number, z: number) {
  let h = 0;
  // north mountain slope behind the hall (pines above)
  const n = smooth(-8, -42, z);
  h += 11 * Math.pow(n, 1.25) + Math.max(0, -z - 40) * 0.75;
  // east terrace and ridge
  h += 1.9 * smooth(7.5, 12.5, x) * (1 - 0.7 * smooth(2, 10, z));
  h += Math.max(0, x - 18) * 0.42 * (1 - 0.5 * smooth(5, 20, z));
  // west rise (bamboo slope), gentler
  h += 1.0 * smooth(-10, -20, x) + Math.max(0, -x - 20) * 0.38;
  // south: descend toward the valley the path climbs from
  h -= Math.max(0, z - 8) * 0.17 * (1 - 0.6 * smooth(10, 26, x));
  // natural undulation grows away from the settlement
  const away = smooth(9, 22, Math.hypot(x * 0.9, z));
  h += (fbm(x * 0.045 + 3.1, z * 0.045 - 1.7, 5) - 0.5) * (0.6 + 3.2 * away);
  h += (fbm(x * 0.21, z * 0.21, 3) - 0.5) * 0.25;
  return h;
}

export function pathMask(x: number, z: number) {
  const d1 = distToPolyline(x, z, PATH_MAIN);
  const d2 = distToPolyline(x, z, PATH_GATE);
  const w1 = 1.35 + 0.35 * fbm(x * 0.3, z * 0.3, 2);
  const m1 = 1 - smooth(w1 * 0.55, w1, d1);
  const m2 = 1 - smooth(0.6, 1.15, d2);
  return Math.max(m1, m2);
}

/** Ground height used by rendering, collision and character feet. */
export function heightAt(x: number, z: number) {
  let h = rawHeight(x, z);
  for (const p of PADS) {
    const m = padMask(p, x, z);
    if (m > 0) h = h + (p.y - h) * m;
  }
  // path: soften local bumps along the trail
  const pm = pathMask(x, z);
  if (pm > 0) {
    const hs = (rawHeight(x + 1.2, z) + rawHeight(x - 1.2, z) + rawHeight(x, z + 1.2) + rawHeight(x, z - 1.2)) / 4;
    let target = hs;
    for (const p of PADS) {
      const m = padMask(p, x, z);
      if (m > 0) target = target + (p.y - target) * m;
    }
    h = h + (target - h) * pm * 0.7;
  }
  // gate lane: an even ramp (~15°) from the courtyard's north-east corner up to the gate terrace
  if (z < -5.2) {
    const lm = (1 - smooth(1.1, 2.1, distToPolyline(x, z, LANE))) * smooth(-5.2, -6.4, z);
    if (lm > 0) h = h + (laneHeight(z) - h) * lm;
  }
  return h;
}

/** Centre line of the ramped lane to the gate (starts at the courtyard corner). */
export const LANE: [number, number][] = [[5.0, -5.4], [6.1, -7.0], [6.6, -11.5], [6.4, -16.4]];
export function laneHeight(z: number) {
  return GATE.ground * clamp((-5.9 - z) / 10.4, 0, 1);
}

/** Surface masks (0..1): paving in yard, gravel path, moss, leaf litter. */
export function surfaceAt(x: number, z: number) {
  const yardLx = Math.max(0, Math.abs(x) - YARD.hw), yardLz = Math.max(0, Math.abs(z) - YARD.hd);
  const edgeNoise = (fbm(x * 0.6, z * 0.6, 3) - 0.5) * 1.2;
  const yd = Math.hypot(yardLx, yardLz) + edgeNoise;
  const paving = (1 - smooth(-0.2, 0.6, yd)) * (1 - smooth(0.12, 0.45, Math.abs(heightAt(x, z))));
  const path = clamp(pathMask(x, z) * (1 - paving), 0, 1);
  const dist = Math.hypot(x, z);
  const wetSlope = smooth(-6, -18, x) + smooth(-12, -26, z) * 0.6;
  const moss = clamp((fbm(x * 0.12 + 7, z * 0.12, 4) - 0.38) * 2.2 + wetSlope * 0.35, 0, 1) * (1 - paving * 0.85) * (1 - path * 0.8);
  const leaves = clamp((fbm(x * 0.09 - 4, z * 0.09 + 2, 4) - 0.42) * 2.4 + smooth(8, 18, dist) * 0.3, 0, 1) * (1 - paving * 0.75) * (1 - path * 0.6);
  return { paving, path, moss, leaves };
}

export function insideWorld(x: number, z: number) {
  return x > -26 && x < 24 && z > -26 && z < 34;
}

/* ---------------- enterable houses: local frame, walkable floors ---------------- */

/** world -> house-local (the house group is rotated by `rot` about +Y and placed at (x, ground, z)) */
export function houseLocal(h: HouseSpec, x: number, z: number) {
  const c = Math.cos(h.rot), s = Math.sin(h.rot);
  const dx = x - h.x, dz = z - h.z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

/** house-local -> world */
export function houseWorld(h: HouseSpec, lx: number, lz: number) {
  const c = Math.cos(h.rot), s = Math.sin(h.rot);
  return { x: h.x + lx * c + lz * s, z: h.z - lx * s + lz * c };
}

/** shared dimensions used by geometry, colliders and the floor function (keep them in one place) */
export function houseDims(h: HouseSpec) {
  const stilts = h.stilts ?? 0;
  const baseY = h.plinth + stilts;
  const W = h.width, D = h.depth;
  const steps = Math.max(2, Math.round(h.plinth / 0.17));
  return {
    W, D, stilts, baseY,
    wallZ: D / 2 - h.veranda,
    backZ: -D / 2,
    frontZ: D / 2,
    // stone plinth (non-stilted houses)
    plinthHW: (W + 1.1) / 2,
    plinthZ0: 0.05 - (D + 1.0) / 2,
    plinthZ1: 0.05 + (D + 1.0) / 2,
    steps,
    stepsZ1: D / 2 + 0.55 + (steps - 1) * 0.34 + 0.18,
    // timber deck + side stair (stilted house)
    deckHW: (W + 0.4) / 2,
    deckZ0: 0.1 - (D + 0.3) / 2,
    deckZ1: 0.1 + (D + 0.3) / 2,
    stairX0: W / 2 + 0.1,
    stairX1: W / 2 + 1.75,
    stairTopZ: D / 2 - 0.3,
    stairN: 9,
    stairRun: 0.34,
  };
}

/** walkable surface of one house at (x,z) in world height, or null when outside it */
export function houseFloorAt(h: HouseSpec, x: number, z: number): number | null {
  const { lx, lz } = houseLocal(h, x, z);
  const d = houseDims(h);
  if (!d.stilts) {
    if (Math.abs(lx) <= d.plinthHW && lz >= d.plinthZ0 && lz <= d.plinthZ1) {
      const onBoards = Math.abs(lx) < (d.W - 0.1) / 2 && Math.abs(lz) < (d.D - 0.1) / 2;
      return h.ground + d.baseY + (onBoards ? 0.06 : 0);
    }
    if (Math.abs(lx) <= 1.3 && lz > d.plinthZ1 && lz <= d.stepsZ1) {
      const t = (lz - d.plinthZ1) / (d.stepsZ1 - d.plinthZ1);
      return h.ground + h.plinth * (1 - t);
    }
    return null;
  }
  if (Math.abs(lx) <= d.deckHW && lz >= d.deckZ0 && lz <= d.deckZ1) return h.ground + d.baseY;
  const botZ = d.stairTopZ - (d.stairN - 1) * d.stairRun - d.stairRun / 2;
  if (lx >= d.stairX0 && lx <= d.stairX1 && lz >= botZ && lz <= d.stairTopZ + d.stairRun / 2) {
    const t = (lz - botZ) / (d.stairTopZ + d.stairRun / 2 - botZ);
    return h.ground + d.baseY * t;
  }
  return null;
}

/** ground height for feet: terrain, or a house floor / plinth / steps / deck where one is under the point */
export function standAt(x: number, z: number) {
  let y = heightAt(x, z);
  for (const h of HOUSES) {
    const f = houseFloorAt(h, x, z);
    if (f !== null && f > y) y = f;
  }
  return y;
}

/** the house whose walls enclose (x,z), if any (used to cut away the roof and pull the camera in) */
export function houseInside(x: number, z: number): HouseSpec | null {
  for (const h of HOUSES) {
    const { lx, lz } = houseLocal(h, x, z);
    const d = houseDims(h);
    if (Math.abs(lx) < d.W / 2 - 0.05 && lz > d.backZ + 0.05 && lz < d.wallZ - 0.02) return h;
  }
  return null;
}
