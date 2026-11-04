import * as THREE from 'three';
import { heightAt, HOUSES, PATH_GATE, PATH_MAIN, YARD, GATE } from './layout';
import { distToPolyline, fbm, mulberry } from './util';
import type { Collider } from './buildings';

export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0.8, 0.35) },
  uWindStrength: { value: 1 },
};

/**
 * Wind sway shader injected into vegetation materials: displacement grows with height above the
 * instance origin (trunk stays planted), with a per-instance phase and a gusting low-frequency term.
 */
export function addWind(mat: THREE.Material, stiffness = 1, key = 'veg') {
  const m = mat as THREE.MeshStandardMaterial;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uTime = windUniforms.uTime;
    sh.uniforms.uWind = windUniforms.uWind;
    sh.uniforms.uWindStrength = windUniforms.uWindStrength;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec2 uWind; uniform float uWindStrength;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #else
            ip = modelMatrix[3].xyz;
          #endif
          float ph = dot(ip.xz, vec2(0.37, 0.71));
          float hgt = max(0.0, transformed.y);
          float bend = hgt * hgt * ${(0.0035 / stiffness).toFixed(5)};
          float gust = 0.6 + 0.4 * sin(uTime * 0.35 + ip.x * 0.05) * sin(uTime * 0.21 + ip.z * 0.07);
          float sway = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25;
          vec2 d = uWind * uWindStrength * bend * (gust + sway * 0.5);
          // leaf flutter on thin geometry far from the trunk
          float fl = sin(uTime * 7.0 + position.x * 9.0 + position.z * 7.0 + ph) * 0.012 * min(hgt, 6.0) / ${stiffness.toFixed(2)};
          transformed.x += d.x + fl;
          transformed.z += d.y + fl * 0.6;
          transformed.y -= length(d) * 0.15;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'ww-wind-' + key + stiffness;
}

/**
 * Instance a loaded model (all of its meshes) with the given transforms. Returns the created meshes.
 * `split`: heavy hero models (a handful of copies of a 50k–160k-triangle tree) become one Mesh per copy sharing
 * geometry and material, so each copy is frustum-culled on its own (camera and shadow camera) instead of the whole
 * InstancedMesh being drawn whenever any copy is visible.
 */
export function instanceModel(src: THREE.Object3D, mats: THREE.Matrix4[], opts: { castShadow?: boolean; wind?: number; key?: string; alphaFix?: boolean; split?: boolean } = {}) {
  src.updateMatrixWorld(true);
  const out: THREE.Mesh[] = [];
  const box = new THREE.Box3().setFromObject(src);
  const baseY = box.min.y;
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    g.translate(0, -baseY, 0);
    const srcMats = Array.isArray(m.material) ? m.material : [m.material];
    const mm = srcMats.map((s) => {
      const c = (s as THREE.MeshStandardMaterial).clone();
      if (opts.alphaFix && (c.transparent || c.alphaTest > 0 || c.alphaMap || /leaf|clip|grass|fern|frond/i.test(c.name))) {
        c.transparent = false;
        c.alphaTest = Math.max(0.42, c.alphaTest);
        c.side = THREE.DoubleSide;
        c.depthWrite = true;
      }
      c.envMapIntensity = 0.5;
      if (opts.wind) addWind(c, opts.wind, (opts.key ?? 'm') + (c.alphaTest > 0 ? 'a' : 'o'));
      return c;
    });
    const material = mm.length === 1 ? mm[0] : mm;
    const am = mm[0] as THREE.MeshStandardMaterial;
    const depth = opts.castShadow !== false && am.alphaTest > 0 && am.map ? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: am.map, alphaTest: am.alphaTest }) : null;
    if (opts.split) {
      g.computeBoundingSphere();
      for (const x of mats) {
        const one = new THREE.Mesh(g, material);
        one.matrixAutoUpdate = false;
        one.matrix.copy(x);
        one.castShadow = opts.castShadow ?? true;
        one.receiveShadow = true;
        if (depth) one.customDepthMaterial = depth;
        out.push(one);
      }
      return;
    }
    const im = new THREE.InstancedMesh(g, material, mats.length);
    mats.forEach((x, i) => im.setMatrixAt(i, x));
    im.castShadow = opts.castShadow ?? true;
    im.receiveShadow = true;
    if (depth) im.customDepthMaterial = depth;
    im.computeBoundingSphere();
    out.push(im);
  });
  return out;
}

function modelHeight(o: THREE.Object3D) {
  const b = new THREE.Box3().setFromObject(o);
  return b.max.y - b.min.y;
}

function nearBuilding(x: number, z: number, pad: number) {
  for (const h of HOUSES) {
    const c = Math.cos(-h.rot), s = Math.sin(-h.rot);
    const dx = x - h.x, dz = z - h.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < h.width / 2 + pad && Math.abs(lz) < h.depth / 2 + pad + 1.2) return true;
  }
  if (Math.hypot(x - GATE.x, z - GATE.z) < 3.4 + pad) return true;
  return false;
}

function onPath(x: number, z: number, w: number) {
  return distToPolyline(x, z, PATH_MAIN) < w || distToPolyline(x, z, PATH_GATE) < w * 0.8;
}

function inYard(x: number, z: number, pad: number) {
  return Math.abs(x) < YARD.hw + pad && Math.abs(z) < YARD.hd + pad;
}

export interface VegetationBuild {
  group: THREE.Group;
  colliders: Collider[];
  trunks: THREE.Vector3[];
}

/**
 * Ecological placement:
 * - bamboo groves on the moist, shaded west slope and behind the west wing (dense clumps, varied heights)
 * - broadleaf trees around the courtyard edges and along the lower path (shade, medium density)
 * - pines/firs on the higher, drier north and east slopes as the background silhouette
 * - ferns + shrubs under trees and along the path edges, dry grass in sunnier south openings
 */
export function buildVegetation(models: Record<string, THREE.Object3D>, quality: 'high' | 'low'): VegetationBuild {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const rnd = mulberry(42);
  const colliders: Collider[] = [];
  const trunks: THREE.Vector3[] = [];
  const q = quality === 'high' ? 1 : 0.5;
  const tf = (x: number, z: number, scale: number, ry = rnd() * Math.PI * 2, tilt = 0.04) => {
    const y = heightAt(x, z) - 0.05 * scale;
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * tilt, ry, (rnd() - 0.5) * tilt)),
      new THREE.Vector3(scale, scale * (0.9 + rnd() * 0.2), scale),
    );
  };
  const scatter = (n: number, area: () => [number, number] | null) => {
    const pts: [number, number][] = [];
    let guard = 0;
    while (pts.length < n && guard++ < n * 40) {
      const p = area();
      if (p) pts.push(p);
    }
    return pts;
  };

  // ---- bamboo groves (west, north-west) ----
  const bambooH = modelHeight(models.bamboo);
  const bamboo: THREE.Matrix4[] = [];
  const groveCenters: [number, number][] = [[-17, 6], [-18.5, -4], [-15, -10], [-21, 1], [-12.5, 9.5], [-9, -17], [-20, 11], [-24, -6]];
  for (const [gi, [cx, cz]] of groveCenters.entries()) {
    if (quality === 'low' && gi % 2) continue;
    const n = Math.round((3 + rnd() * 4) * q + 2);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 3.2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (nearBuilding(x, z, 0.8) || onPath(x, z, 2) || inYard(x, z, 0.6)) continue;
      const target = 6 + rnd() * 5;
      bamboo.push(tf(x, z, target / bambooH, undefined, 0.12));
    }
    colliders.push({ x: cx, z: cz, hw: 2.0, hd: 2.0, rot: 0 });
  }
  const hiShadow = quality === 'high';
  group.add(...instanceModel(models.bamboo, bamboo, { wind: 0.8, key: 'bamboo', alphaFix: true, castShadow: hiShadow }));
  // high tier: three dense, detailed bamboo clumps close to the west wing and the yard edge
  const hi = quality === 'high';
  if (hi && models.bamboo_a) {
    const bH = modelHeight(models.bamboo_a);
    const clumps: THREE.Matrix4[] = [];
    for (const [x, z] of [[-10.8, -6.4], [-15.2, 5.4], [-10.2, 8.8], [-5.4, -15.6]] as [number, number][]) {
      if (nearBuilding(x, z, 0.4) || inYard(x, z, 0.4)) continue;
      clumps.push(tf(x, z, (6.5 + rnd() * 2) / bH, undefined, 0.06));
      colliders.push({ x, z, hw: 1.2, hd: 1.2, rot: 0 });
    }
    group.add(...instanceModel(models.bamboo_a, clumps, { wind: 0.9, key: 'bamboo_a', alphaFix: true, castShadow: false, split: true }));
  }

  // ---- broadleaf trees: detailed hero trees around the settlement on high tier ----
  const treeH = modelHeight(models.tree_broad);
  const trees: THREE.Matrix4[] = [];
  const heroA: THREE.Matrix4[] = [], heroB: THREE.Matrix4[] = [], maples: THREE.Matrix4[] = [];
  const treeSpots: [number, number][] = [[12.5, 3.5], [14.5, -2], [-6.5, -17.5], [1.5, -19.5], [17.5, 14.5], [-8, 13], [18, 7], [-3.5, 19], [17, -12], [-13, -14], [-11, 21]];
  const kind = (i: number) => (!hi ? 'old' : i === 2 ? 'b' : i === 3 || i === 5 ? 'maple' : 'a');
  for (const [i, [x, z]] of treeSpots.entries()) {
    if (nearBuilding(x, z, 1)) continue;
    const k = kind(i);
    if (k === 'a' && models.tree_broad_a) heroA.push(tf(x, z, (8.5 + rnd() * 3) / modelHeight(models.tree_broad_a)));
    else if (k === 'b' && models.tree_broad_b) heroB.push(tf(x, z, (10 + rnd() * 2) / modelHeight(models.tree_broad_b)));
    else if (k === 'maple' && models.tree_maple) maples.push(tf(x, z, (6 + rnd() * 1.5) / modelHeight(models.tree_maple)));
    else trees.push(tf(x, z, (8.5 + rnd() * 4) / treeH));
    trunks.push(new THREE.Vector3(x, heightAt(x, z), z));
    colliders.push({ x, z, hw: 0.45, hd: 0.45, rot: 0 });
  }
  group.add(...instanceModel(models.tree_broad, trees, { wind: 3.2, key: 'broad', alphaFix: true, castShadow: hiShadow }));
  if (heroA.length) group.add(...instanceModel(models.tree_broad_a, heroA, { wind: 3.2, key: 'broadA', alphaFix: true, castShadow: true, split: true }));
  if (heroB.length) group.add(...instanceModel(models.tree_broad_b, heroB, { wind: 3.6, key: 'broadB', alphaFix: true, castShadow: true, split: true }));
  if (maples.length) group.add(...instanceModel(models.tree_maple, maples, { wind: 2.6, key: 'maple', alphaFix: true, castShadow: true, split: true }));
  // far broadleaf ring (lower slopes, south valley)
  const farH = modelHeight(models.tree_broad_far);
  const far: THREE.Matrix4[] = [];
  for (const [x, z] of scatter(Math.round(quality === 'high' ? 60 : 18), () => {
    const x = -60 + rnd() * 120, z = -50 + rnd() * 110;
    const d = Math.hypot(x, z - 2);
    if (d < 24 || onPath(x, z, 3)) return null;
    if (z < -30) return null;
    return [x, z];
  })) far.push(tf(x, z, (9 + rnd() * 6) / farH));
  group.add(...instanceModel(models.tree_broad_far, far, { wind: 4, key: 'far', castShadow: false, alphaFix: true }));

  // ---- pines & firs on the upper slopes ----
  const pineModel = hi && models.pine_a ? models.pine_a : models.pine;
  const pineH = modelHeight(pineModel), firH = modelHeight(models.fir);
  const pines: THREE.Matrix4[] = [], firs: THREE.Matrix4[] = [], ridge: THREE.Matrix4[] = [];
  for (const [x, z] of scatter(Math.round(quality === 'high' ? 140 : 50), () => {
    const x = -70 + rnd() * 140, z = -75 + rnd() * 60;
    const h = heightAt(x, z);
    if (h < 4.5 || nearBuilding(x, z, 2) || onPath(x, z, 2)) return null;
    if (Math.hypot(x - GATE.x, z - GATE.z) < 6) return null;
    // density increases with altitude
    if (rnd() > Math.min(1, (h - 3) / 6)) return null;
    return [x, z];
  })) {
    const big = 10 + rnd() * 9;
    if (rnd() < 0.3) pines.push(tf(x, z, big / pineH)); else firs.push(tf(x, z, big / firH));
  }
  // a few pines on the east ridge above the workshop (detailed model on high tier)
  const ridgeModel = hi && models.pine_b ? models.pine_b : pineModel;
  for (let i = 0; i < 8; i++) {
    const x = 16 + rnd() * 10, z = -18 + rnd() * 16;
    if (nearBuilding(x, z, 2)) continue;
    if (hi && models.pine_b && i % 2) continue; // 54k-tri pines: half as many
    ridge.push(tf(x, z, (9 + rnd() * 6) / modelHeight(ridgeModel)));
  }
  group.add(...instanceModel(pineModel, pines, { wind: 5, key: 'pine', alphaFix: true, castShadow: false }));
  group.add(...instanceModel(ridgeModel, ridge, { wind: 5, key: 'pineR', alphaFix: true, castShadow: false, split: hi }));
  group.add(...instanceModel(models.fir, firs, { wind: 5, key: 'fir', alphaFix: true, castShadow: false }));

  // ---- understory: ferns, shrubs, dry grass, grass clumps ----
  const fernModel = hi && models.fern_a ? models.fern_a : models.fern;
  const fernH = modelHeight(fernModel);
  const ferns: THREE.Matrix4[] = [];
  const shrubs: THREE.Matrix4[] = [], shrubs2: THREE.Matrix4[] = [], bushes: THREE.Matrix4[] = [];
  const grass: THREE.Matrix4[] = [], dry: THREE.Matrix4[] = [];
  const shH = modelHeight(models.shrub_hb), sh2H = modelHeight(models.shrub_box);
  const grH = modelHeight(models.grassclip), dryH = modelHeight(models.drygrass);
  for (const [x, z] of scatter(Math.round(quality === 'high' ? 260 : 90), () => {
    const x = -30 + rnd() * 52, z = -24 + rnd() * 50;
    if (inYard(x, z, 0.2) || nearBuilding(x, z, 0.3) || onPath(x, z, 1.1)) return null;
    return [x, z];
  })) {
    const moist = (x < -6 ? 0.7 : 0.2) + fbm(x * 0.1, z * 0.1, 3) * 0.6 + (trunks.some((t) => Math.hypot(t.x - x, t.z - z) < 5) ? 0.4 : 0);
    const r = rnd();
    const nearHome = Math.hypot(x, z + 2) < 20;
    if (moist > 0.85 && r < 0.6) ferns.push(tf(x, z, (0.7 + rnd() * 0.6) / fernH));
    else if (r < 0.32 && hi && models.bush_b && nearHome && bushes.length < 34) bushes.push(tf(x, z, (0.9 + rnd() * 0.8) / modelHeight(models.bush_b)));
    else if (r < 0.32) shrubs.push(tf(x, z, (0.8 + rnd() * 0.9) / shH));
    else if (r < 0.45) shrubs2.push(tf(x, z, (0.9 + rnd() * 0.7) / sh2H));
    else if (moist < 0.7) dry.push(tf(x, z, (0.45 + rnd() * 0.35) / dryH));
    else grass.push(tf(x, z, (0.35 + rnd() * 0.3) / grH));
  }
  // path edges and yard edges: grass tufts poking between setts (sparse)
  for (const [x, z] of scatter(Math.round(quality === 'high' ? 90 : 30), () => {
    const x = -12 + rnd() * 28, z = -10 + rnd() * 30;
    const dp = distToPolyline(x, z, PATH_MAIN);
    const edgeYard = Math.abs(Math.abs(x) - YARD.hw) < 0.8 || Math.abs(Math.abs(z) - YARD.hd) < 0.8;
    if (!((dp > 1.0 && dp < 1.9) || edgeYard) || nearBuilding(x, z, 0.1)) return null;
    return [x, z];
  })) grass.push(tf(x, z, (0.3 + rnd() * 0.25) / grH));
  // fine wild-grass cards: dense fringe along the yard edge, the paths and under the house eaves (cheap: 117 tris)
  const wild: THREE.Matrix4[] = [];
  if (models.grass_b) {
    const wH = modelHeight(models.grass_b);
    for (const [x, z] of scatter(Math.round(quality === 'high' ? 420 : 140), () => {
      const x = -16 + rnd() * 32, z = -16 + rnd() * 34;
      const dp = Math.min(distToPolyline(x, z, PATH_MAIN), distToPolyline(x, z, PATH_GATE));
      const edgeYard = Math.abs(Math.abs(x) - YARD.hw) < 1.6 || Math.abs(Math.abs(z) - YARD.hd) < 1.6;
      if (inYard(x, z, -0.4) || nearBuilding(x, z, -0.3)) return null;
      if (!(edgeYard || (dp > 0.9 && dp < 3.0) || rnd() < 0.25)) return null;
      return [x, z];
    })) wild.push(tf(x, z, (0.35 + rnd() * 0.35) / wH, undefined, 0.15));
  }
  group.add(...instanceModel(fernModel, ferns, { wind: 0.6, key: 'fern', alphaFix: true, castShadow: false }));
  group.add(...instanceModel(models.shrub_hb, shrubs, { wind: 0.8, key: 'shrub', alphaFix: true, castShadow: false }));
  if (bushes.length) group.add(...instanceModel(models.bush_b, bushes, { wind: 0.7, key: 'bush', alphaFix: true, castShadow: hi }));
  if (wild.length) group.add(...instanceModel(models.grass_b, wild, { wind: 0.3, key: 'wild', alphaFix: true, castShadow: false }));
  group.add(...instanceModel(models.shrub_box, shrubs2, { wind: 0.8, key: 'shrub2', alphaFix: true, castShadow: false }));
  group.add(...instanceModel(models.grassclip, grass, { wind: 0.25, key: 'grass', castShadow: false, alphaFix: true }));
  group.add(...instanceModel(models.drygrass, dry, { wind: 0.3, key: 'dry', castShadow: false, alphaFix: true }));

  // ---- rocks ----
  const rockH = modelHeight(models.mossrock);
  const rocks: THREE.Matrix4[] = [];
  for (const [x, z] of scatter(Math.round(40 * q + 10), () => {
    const x = -26 + rnd() * 48, z = -26 + rnd() * 50;
    if (inYard(x, z, 0.5) || nearBuilding(x, z, 0.8) || onPath(x, z, 1.4)) return null;
    if (Math.hypot(x - 8.5, z - 16.8) < 7 || Math.hypot(x - 6.6, z - 9.6) < 3) return null; // keep camera corridors clear
    return [x, z];
  })) {
    const s = (0.4 + rnd() * 1.4) / rockH;
    const m = tf(x, z, s, undefined, 0.5);
    m.multiply(new THREE.Matrix4().makeTranslation(0, -0.15 / s, 0));
    rocks.push(m);
  }
  group.add(...instanceModel(models.mossrock, rocks, { castShadow: false }));
  return { group, colliders, trunks };
}

/**
 * Settled leaf litter: flat leaf cards from the leaf atlas, gathered where wind and people would leave them —
 * under the trees, in the yard corners and along walls and steps, thinner in the walked middle of the yard.
 */
export function buildLeafLitter(atlas: THREE.Texture, quality: 'high' | 'low', trunks: THREE.Vector3[]) {
  const group = new THREE.Group();
  group.name = 'leaf_litter';
  const rnd = mulberry(77);
  const total = quality === 'high' ? 2600 : 900;
  const pts: { x: number; z: number }[] = [];
  let guard = 0;
  while (pts.length < total && guard++ < total * 30) {
    let x: number, z: number;
    const r = rnd();
    if (r < 0.4 && trunks.length) {
      const t = trunks[Math.floor(rnd() * trunks.length)];
      const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.7) * 5.5;
      x = t.x + Math.cos(a) * d;
      z = t.z + Math.sin(a) * d;
    } else if (r < 0.75) {
      // drifts along the yard rim and into the corners
      const side = Math.floor(rnd() * 4);
      const u = rnd() * 2 - 1, inset = Math.pow(rnd(), 2.2) * 1.8;
      x = side < 2 ? u * YARD.hw : (side === 2 ? -1 : 1) * (YARD.hw - inset);
      z = side < 2 ? (side === 0 ? -1 : 1) * (YARD.hd - inset) : u * YARD.hd;
    } else {
      x = -20 + rnd() * 40;
      z = -18 + rnd() * 38;
      // sparse in the middle of the yard (swept)
      if (inYard(x, z, -1.8) && rnd() < 0.85) continue;
    }
    if (nearBuilding(x, z, -0.2)) continue;
    pts.push({ x, z });
  }
  const g0 = new THREE.PlaneGeometry(1, 1);
  g0.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  mat.envMapIntensity = 0.4;
  const tint = [new THREE.Color(0.78, 0.55, 0.32), new THREE.Color(0.62, 0.42, 0.25), new THREE.Color(0.85, 0.7, 0.4), new THREE.Color(0.55, 0.6, 0.35), new THREE.Color(0.45, 0.32, 0.22)];
  const per = Math.ceil(pts.length / 4);
  for (let tile = 0; tile < 4; tile++) {
    const g = g0.clone();
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const ox = (tile % 2) * 0.5, oy = Math.floor(tile / 2) * 0.5;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, ox + uv.getX(i) * 0.5, oy + uv.getY(i) * 0.5);
    const slice = pts.slice(tile * per, (tile + 1) * per);
    const im = new THREE.InstancedMesh(g, mat, slice.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    slice.forEach((pt, i) => {
      const size = 0.1 + rnd() * 0.09;
      e.set((rnd() - 0.5) * 0.5, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.5, 'YXZ');
      p.set(pt.x, heightAt(pt.x, pt.z) + 0.012 + rnd() * 0.02, pt.z);
      m.compose(p, q.setFromEuler(e), s.set(size, size, size * (0.8 + rnd() * 0.4)));
      im.setMatrixAt(i, m);
      im.setColorAt(i, tint[Math.floor(rnd() * tint.length)]);
    });
    im.receiveShadow = true;
    im.castShadow = false;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
}

/** Falling / drifting leaves: GPU-animated points recycled within a volume around a focus point. */
export class LeafFall {
  points: THREE.Points;
  uniforms: Record<string, THREE.IUniform>;
  constructor(atlas: THREE.Texture, count: number) {
    const g = new THREE.BufferGeometry();
    const rnd = mulberry(9);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seed[i * 4] = rnd();
      seed[i * 4 + 1] = rnd();
      seed[i * 4 + 2] = rnd();
      seed[i * 4 + 3] = rnd();
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    this.uniforms = {
      uTime: windUniforms.uTime,
      uWind: windUniforms.uWind,
      uFocus: { value: new THREE.Vector3() },
      uAtlas: { value: atlas },
      uSize: { value: 26 },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0.01 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute vec4 seed; uniform float uTime; uniform vec2 uWind; uniform vec3 uFocus; uniform float uSize;
        varying float vRot; varying float vTile; varying float vA; varying float vFog;
        void main(){
          float life = 9.0 + seed.x * 6.0;
          float t = mod(uTime + seed.y * life, life) / life;
          vec3 box = vec3(28.0, 12.0, 28.0);
          vec3 p = (seed.xyz - 0.5) * box;
          p.y = mix(11.0, -0.5, t) + seed.w * 2.0;
          p.xz += uWind * (t * 9.0) + vec2(sin(uTime*1.3 + seed.z*20.0), cos(uTime*1.1 + seed.x*17.0)) * 0.8;
          vec3 wp = uFocus + p;
          wp.xz = uFocus.xz + mod(wp.xz - uFocus.xz + box.xz*0.5, box.xz) - box.xz*0.5;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (0.6 + seed.w*0.7) / -mv.z;
          vRot = uTime * (1.5 + seed.y * 3.0) + seed.z * 6.28;
          vTile = floor(seed.w * 4.0);
          vA = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.9, 1.0, t));
          vFog = -mv.z;
        }`,
      fragmentShader: `
        uniform sampler2D uAtlas; uniform vec3 uFogColor; uniform float uFogDensity;
        varying float vRot; varying float vTile; varying float vA; varying float vFog;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float s = sin(vRot), co = cos(vRot);
          c = mat2(co, -s, s, co) * c;
          c.y *= 1.0 + 0.6*abs(sin(vRot*0.7)); // tumbling
          vec2 uv = c + 0.5;
          if (uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) discard;
          vec2 tile = vec2(mod(vTile,2.0), floor(vTile/2.0)) * 0.5;
          vec4 col = texture2D(uAtlas, tile + uv*0.5);
          if (col.a < 0.4) discard;
          float f = 1.0 - exp(-uFogDensity*uFogDensity*vFog*vFog);
          gl_FragColor = vec4(mix(col.rgb*0.85, uFogColor, f), col.a * vA);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }
}
