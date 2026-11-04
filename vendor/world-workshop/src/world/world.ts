import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Assets } from '../core/assets';
import { buildHouse, latticeTexture, plaqueTexture, type BuildingMaterials, type Collider, type HouseBuild } from './buildings';
import { buildTerrain } from './terrain';
import { buildLeafLitter, buildVegetation, LeafFall, windUniforms, instanceModel } from './vegetation';
import { ATMOS, buildAtmosphereCards, buildRidges, buildSky } from './sky';
import { WorldGate } from './gate';
import { GATE, HOUSES, heightAt, houseWorld, insideWorld, type HouseSpec } from './layout';
import { mulberry } from './util';
import { buildYard } from './yard';
import { buildWell } from './well';

export interface WorldBuild {
  root: THREE.Group;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  gate: WorldGate;
  colliders: Collider[];
  occluders: THREE.Object3D[];
  leafFall: LeafFall;
  lanternLights: THREE.PointLight[];
  lanternMat: THREE.MeshStandardMaterial;
  /** cut away the roof layer of the house the player stands in (null: every roof back) */
  setCutaway(houseId: string | null): void;
  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera): void;
  dispose(): void;
}

/**
 * Library props come with a mix of PBR conventions: many furniture packs flag wood as fully metallic through the
 * metal channel, which reads as dark grey chrome under our low environment light. Only real metal keeps metalness.
 */
function fixPropMaterial(m: THREE.Material) {
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial) return;
  const metal = /metal|iron|bronze|brass|steel|anvil|trim_metal|ding|bucket_metal/i.test(s.name);
  if (!metal) {
    s.metalness = 0;
    s.metalnessMap = null;
  } else s.metalness = Math.min(s.metalness, 0.75);
  s.envMapIntensity = 0.6;
  if (s.transparent && !/curtain|glass|paper/i.test(s.name)) {
    s.transparent = false;
    s.alphaTest = Math.max(0.4, s.alphaTest);
  }
  s.needsUpdate = true;
}

/** a scaled clone of a loaded prop model, base at y = 0, origin at its footprint centre */
function propClone(src: THREE.Object3D, height: number, cast = true) {
  const o = src.clone(true);
  const b = new THREE.Box3().setFromObject(o);
  const s = height / Math.max(1e-6, b.max.y - b.min.y);
  const inner = new THREE.Group();
  o.scale.setScalar(s);
  o.position.set(-((b.min.x + b.max.x) / 2) * s, -b.min.y * s, -((b.min.z + b.max.z) / 2) * s);
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    (Array.isArray(m.material) ? m.material : [m.material]).forEach(fixPropMaterial);
  });
  inner.add(o);
  const size = new THREE.Vector3((b.max.x - b.min.x) * s, height, (b.max.z - b.min.z) * s);
  return { obj: inner, size };
}

function texMat(a: Assets, key: string, opts: { color?: THREE.ColorRepresentation; repeat?: number; rough?: number; normalScale?: number } = {}) {
  const T = a.textures;
  const m = new THREE.MeshStandardMaterial({
    map: T[key + '_color'],
    normalMap: T[key + '_normal'],
    roughnessMap: T[key + '_roughness'],
    color: opts.color ?? 0xffffff,
    roughness: opts.rough ?? 1,
    metalness: 0,
  });
  if (opts.normalScale) m.normalScale.setScalar(opts.normalScale);
  return m;
}

/** Plaster gets a rising-damp stain toward the ground and slight wetness — avoids flat white walls. */
function weatherPlaster(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix*vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP;
        float hh(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
        float nn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(hh(i),hh(i+vec2(1,0)),u.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),u.x),u.y);}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        { float n = nn(vWP.xz*1.3 + vWP.y*0.7) * 0.6 + nn(vWP.xy*3.1)*0.4;
          float streak = smoothstep(0.55, 0.9, nn(vec2(vWP.x*6.0 + vWP.z*6.0, vWP.y*0.4)));
          float grime = smoothstep(0.35, 0.8, nn(vWP.xz*0.6 + vWP.y*0.25));
          diffuseColor.rgb *= (1.0 - streak*0.14) * mix(1.0, 0.82, grime*0.6) * (0.94 + n*0.1);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'ww-plaster';
}

export function buildWorld(a: Assets, quality: 'high' | 'low'): WorldBuild {
  const root = new THREE.Group();
  root.name = 'world';
  const T = a.textures;
  const disposables: { dispose(): void }[] = [];

  // ---- lights: low warm sun + cool sky fill ----
  const sun = new THREE.DirectionalLight(ATMOS.sunColor, 4.8);
  sun.position.copy(ATMOS.sunDir).multiplyScalar(60);
  sun.castShadow = true;
  const sm = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 5; sc.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  root.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x7c93ae, 0x2c241b, 0.48);
  root.add(hemi);

  // ---- terrain ----
  const terrain = buildTerrain(T, quality);
  root.add(terrain.mesh);

  // ---- sky / ridges / atmosphere ----
  const sky = buildSky();
  root.add(sky.mesh);
  root.add(buildRidges());
  const atmos = buildAtmosphereCards(null);
  root.add(atmos.group);

  // ---- materials (2K library PBR sets, see docs/ASSETS.md) ----
  const timber = texMat(a, 'timber', { color: 0xd9c4ae, normalScale: 0.9 });
  const timberDark = texMat(a, 'timber', { color: 0x806a5a, normalScale: 0.9 });
  const plaster = texMat(a, 'plaster', { color: 0xe8e1d2, normalScale: 0.8 });
  weatherPlaster(plaster);
  // the 2K wet-rock set is about half as bright as the previous one (mean albedo 83 vs 171): lift it back
  const stone = texMat(a, 'wetrock', { color: new THREE.Color(1.5, 1.48, 1.42), normalScale: 1.1 });
  const floor = texMat(a, 'floorwood', { color: 0xc2ab96, normalScale: 0.8 });
  const brick = texMat(a, 'brick', { color: 0xb6b2aa, normalScale: 1.0 });
  // roof tiles: each tile samples a small patch of the weathered-tile texture (per-instance tint adds variety)
  const tileMap = (k: string) => {
    const t = T['rooftile_' + k].clone();
    t.repeat.set(0.16, 0.16);
    t.needsUpdate = true;
    return t;
  };
  const tile = new THREE.MeshStandardMaterial({ color: 0x8b9094, map: tileMap('color'), normalMap: tileMap('normal'), roughnessMap: tileMap('roughness'), roughness: 1, metalness: 0.02, envMapIntensity: 0.9 });
  tile.normalScale.setScalar(0.8);
  const latTex = latticeTexture();
  const lattice = new THREE.MeshStandardMaterial({ map: latTex, alphaTest: 0.5, color: 0x8a6a52, roughness: 0.8, side: THREE.DoubleSide });
  const paper = new THREE.MeshStandardMaterial({ color: 0xe9ddc2, roughness: 1, emissive: new THREE.Color(1.0, 0.72, 0.42), emissiveIntensity: 0.0, transparent: true, opacity: 0.86, side: THREE.DoubleSide });
  const plaqueTex = plaqueTexture('世界工坊', 'WORLD  WORKSHOP  ·  chasheo');
  const plaque = new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.5, metalness: 0.2 });
  const lantern = new THREE.MeshStandardMaterial({ color: 0xb8402e, roughness: 0.7, emissive: new THREE.Color(1.0, 0.45, 0.2), emissiveIntensity: 0.6, transparent: true, opacity: 0.95 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.32 });
  const mats: BuildingMaterials = { timber, timberDark, plaster, stone, tile, lattice, paper, plaque, floor, lantern, brick };
  disposables.push(timber, timberDark, plaster, stone, floor, tile, lattice, paper, plaque, lantern, brass, latTex, plaqueTex, brick);

  // ---- houses (enterable) ----
  const colliders: Collider[] = [];
  const occluders: THREE.Object3D[] = [];
  const lanternPos: THREE.Vector3[] = [];
  const props = a.models;
  const houses: { spec: HouseSpec; b: HouseBuild }[] = [];
  for (const h of HOUSES) {
    const b = buildHouse(h, mats, quality, h.id === 'hall' ? { plaque: plaqueTex } : {});
    root.add(b.group);
    colliders.push(...b.colliders);
    occluders.push(...b.occluders);
    lanternPos.push(...b.lanterns);
    houses.push({ spec: h, b });
  }
  // cut-away: an invisible (no colour, no depth) stand-in that still renders into the sun's shadow map
  const cutMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  disposables.push(cutMat);
  let cutId: string | null = null;
  const setCutaway = (id: string | null) => {
    if (id === cutId) return;
    cutId = id;
    for (const { spec, b } of houses) {
      const hide = spec.id === id;
      b.upper.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (!m.userData.mat) m.userData.mat = m.material;
        m.material = hide ? cutMat : m.userData.mat;
        m.userData.cutaway = hide;
      });
    }
  };

  /** furniture from the asset library, placed in house-local metres on the floor; each piece blocks movement */
  const furnish = (spec: HouseSpec, b: HouseBuild, key: string, height: number, lx: number, lz: number, ry = 0, y = 0, collide = true) => {
    const src = props['p2_' + key]?.scene;
    if (!src) return;
    const { obj, size } = propClone(src, height, quality === 'high');
    obj.position.set(lx, b.floorY + y, lz);
    obj.rotation.y = ry;
    b.group.add(obj);
    if (!collide) return;
    const w = houseWorld(spec, lx, lz);
    colliders.push({ x: w.x, z: w.z, hw: size.x / 2 * 0.92, hd: size.z / 2 * 0.92, rot: -(spec.rot + ry) });
  };
  for (const { spec, b } of houses) {
    const D = spec.depth, backZ = -D / 2;
    if (spec.id === 'hall') {
      furnish(spec, b, 'altar_table', 0.95, 0, backZ + 0.75);
      furnish(spec, b, 'landscape_painting', 1.2, 0, backZ + 0.12, 0, 1.25, false);
      furnish(spec, b, 'ming_chair', 1.1, -1.55, backZ + 1.55);
      furnish(spec, b, 'ming_chair', 1.1, 1.55, backZ + 1.55);
      furnish(spec, b, 'incense_ding', 0.55, 0, backZ + 0.75, 0, 0.95, false);
      furnish(spec, b, 'scholar_desk', 1.3, -3.9, -1.2, Math.PI / 2);
      furnish(spec, b, 'bookcase', 1.9, -4.9, backZ + 0.45);
      furnish(spec, b, 'porcelain_vase', 0.9, -2.9, backZ + 0.5);
      furnish(spec, b, 'porcelain_vase', 0.75, 2.9, backZ + 0.5, 1.1);
      furnish(spec, b, 'low_chest', 0.85, 4.4, backZ + 0.45);
      furnish(spec, b, 'tea_set', 0.25, 4.4, backZ + 0.45, 0.3, 0.85, false);
      furnish(spec, b, 'lattice_screen', 2.0, 4.6, -0.6, -Math.PI / 2);
      furnish(spec, b, 'jar_shelf', 1.4, 3.9, 1.55, Math.PI);
    } else if (spec.id === 'west') {
      furnish(spec, b, 'canopy_bed', 2.3, -2.5, backZ + 1.35);
      furnish(spec, b, 'low_chest', 0.85, 2.1, backZ + 0.45);
      furnish(spec, b, 'porcelain_vase', 0.8, 3.55, backZ + 0.45);
      furnish(spec, b, 'ming_chair', 1.1, 2.8, -0.2, -Math.PI / 2);
      furnish(spec, b, 'landscape_painting', 1.0, 0.6, backZ + 0.12, 0, 1.3, false);
      furnish(spec, b, 'tea_set', 0.25, 2.1, backZ + 0.45, -0.4, 0.85, false);
    } else {
      furnish(spec, b, 'workbench_b', 1.0, -1.9, backZ + 0.85);
      furnish(spec, b, 'anvil', 0.75, 1.1, -0.6, 0.6);
      furnish(spec, b, 'jar_brown', 0.7, 2.75, backZ + 0.5);
      furnish(spec, b, 'bookcase', 1.9, 1.6, backZ + 0.35);
    }
  }
  // retaining wall below the east terrace (dry stone), with steps up
  {
    const g = new THREE.Group();
    const rnd = mulberry(21);
    // battered dry-stone face following the terrace contour (h ≈ 0.9 m), capstones on top, gap for the stair
    const wallMat = texMat(a, 'cliff', { color: 0xb3b0a6, normalScale: 1.3 });
    disposables.push(wallMat);
    const contour: THREE.Vector3[] = [];
    for (let z = 4.6; z >= -10.6; z -= 0.4) {
      // the face sits where the ground rises 0.35 m above the courtyard / gate-lane floor in front of it
      const x0 = z < -6.2 ? 7.3 : 6;
      const floor = heightAt(x0 - 0.3, z) + 0.35;
      let x = x0;
      while (x < 15 && heightAt(x, z) < floor) x += 0.05;
      contour.push(new THREE.Vector3(x, 0, z));
    }
    const inGap = (z: number) => z < -0.7 && z > -2.5; // stair up to the terrace
    const lowStep = (c: THREE.Vector3) => heightAt(c.x + 2.6, c.z) - heightAt(c.x - 0.8, c.z) < 0.5;
    const pos: number[] = [];
    const uv: number[] = [];
    let run = 0;
    for (let i = 0; i < contour.length - 1; i++) {
      const a0 = contour[i], a1 = contour[i + 1];
      const seg = a0.distanceTo(a1);
      if (inGap(a0.z) || lowStep(a0) || lowStep(a1)) { run += seg; continue; }
      const b0 = heightAt(a0.x - 0.8, a0.z) - 0.3, b1 = heightAt(a1.x - 0.8, a1.z) - 0.3;
      const t0 = heightAt(a0.x + 2.6, a0.z) + 0.2, t1 = heightAt(a1.x + 2.6, a1.z) + 0.2;
      const batter = 0.38; // top leans back into the slope
      const q = [
        [a0.x, b0, a0.z, run, b0], [a1.x + batter, t1, a1.z, run + seg, t1], [a1.x, b1, a1.z, run + seg, b1],
        [a0.x, b0, a0.z, run, b0], [a0.x + batter, t0, a0.z, run, t0], [a1.x + batter, t1, a1.z, run + seg, t1],
      ];
      for (const [x, y, z, u, v] of q) { pos.push(x, y, z); uv.push(u / 1.6, v / 1.6); }
      run += seg;
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    wg.computeVertexNormals();
    const wall = new THREE.Mesh(wg, wallMat);
    wall.castShadow = wall.receiveShadow = true;
    g.add(wall);
    const capG = new RoundedBoxGeometry(0.62, 0.16, 0.5, 2, 0.04);
    const caps: THREE.Matrix4[] = [];
    for (let i = 0; i < contour.length - 1; i += 1) {
      const c = contour[i];
      if (inGap(c.z) || lowStep(c)) continue;
      const y = heightAt(c.x + 2.6, c.z) + 0.26;
      caps.push(new THREE.Matrix4().compose(new THREE.Vector3(c.x + 0.62, y, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.06, Math.PI / 2 + (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.06)), new THREE.Vector3(1, 0.9 + rnd() * 0.3, 0.9 + rnd() * 0.25)));
    }
    const im = new THREE.InstancedMesh(capG, stone, caps.length);
    caps.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = im.receiveShadow = true;
    g.add(im);
    for (let s = 0; s < 7; s++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.42), stone);
      const x = 8.4 + s * 0.42;
      st.position.set(x, heightAt(x, -1.6) + 0.05, -1.6);
      st.rotation.y = Math.PI / 2;
      st.castShadow = st.receiveShadow = true;
      g.add(st);
    }
    root.add(g);
    // colliders follow the actual wall line (oriented boxes over 3-point runs, set just behind the face)
    for (let i = 0; i + 2 < contour.length; i += 2) {
      const a0 = contour[i], a1 = contour[i + 2];
      if (inGap(a0.z) || inGap(a1.z) || (lowStep(a0) && lowStep(a1))) continue;
      const sx = a1.x - a0.x, sz = a1.z - a0.z, len = Math.hypot(sx, sz);
      colliders.push({ x: (a0.x + a1.x) / 2 + 0.35, z: (a0.z + a1.z) / 2, hw: 0.35, hd: len / 2 + 0.08, rot: Math.atan2(-sx, sz) });
    }
  }

  // ---- props: life in the yard, scaled in meters (env_* = first-round models, p2_* = library props) ----
  const placeProp = (key: string, x: number, z: number, height: number, ry = 0, solid = true) => {
    const src = (props['p2_' + key] ?? props['env_' + key])?.scene;
    if (!src) return;
    const { obj, size } = propClone(src, height, quality === 'high' || height > 1.2);
    obj.position.set(x, heightAt(x, z) - 0.02, z);
    obj.rotation.y = ry;
    root.add(obj);
    if (solid) colliders.push({ x, z, hw: Math.max(0.2, size.x / 2 * 0.9), hd: Math.max(0.2, size.z / 2 * 0.9), rot: -ry });
  };
  // hall front: guardian lions flank the steps, a bronze cauldron in the axis, wine jars by the plinth
  placeProp('stone_lion', -3.35, -5.9, 1.5, 0);
  placeProp('stone_lion', 0.15, -5.9, 1.5, 0);
  placeProp('incense_ding', -1.6, -3.9, 1.05, 0.2);
  // (everything stays clear of the house plinths/decks: those are walkable floors now)
  placeProp('winejar', -5.2, -6.35, 0.62, 0.4);
  placeProp('winejar', -4.55, -6.1, 0.5, 1.2);
  placeProp('logpile', -6.4, -6.2, 0.9, 0.1);
  placeProp('water_vat', -7.6, -6.2, 0.8, 0.3);
  placeProp('basket', 3.4, -6.6, 0.45, 0.6);
  // west edge: weapon rack, lanterns flanking the west wing steps, buckets, the drying rack
  placeProp('weapon_rack', -7.7, -4.6, 1.9, Math.PI / 2);
  placeProp('stone_lantern_b', -8.0, -1.4, 2.0, 0.2);
  placeProp('stone_lantern_b', -8.0, 2.8, 2.0, -0.3);
  placeProp('bucket', -7.6, 4.2, 0.42, 0.2);
  placeProp('jar', -8.2, 4.7, 0.55, 1.0);
  placeProp('drying_rack', -6.4, 5.9, 1.9, 0.05);
  placeProp('water_vat', -7.8, -2.6, 0.75, 1.1);
  // east side and the terrace
  placeProp('sacks', 6.9, 4.6, 0.6, -0.6);
  placeProp('barrel1', 7.2, 3.6, 0.85, 0.3);
  placeProp('stump', 5.6, 5.6, 0.45, 0.0);
  placeProp('water_vat', 7.1, 5.7, 0.7, 2.1);
  placeProp('hand_cart', 9.9, -3.7, 1.1, -0.9);
  placeProp('jar_brown', 10.5, -2.8, 0.75, 0.4);
  placeProp('stone_lantern_a', 7.9, -5.9, 1.5, 0.1);
  // stone lanterns lining the yard and the gate lane
  for (const [x, z] of [[-4.4, 6.8], [6.3, 6.4], [5.4, -10.6], [6.7, -13.6]] as [number, number][]) placeProp('lantern', x, z, 1.5, 0.3);

  // ---- courtyard dressing ----
  const slab = texMat(a, 'wetrock', { color: new THREE.Color(1.38, 1.36, 1.3), normalScale: 0.8 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x5b5f63, metalness: 0.9, roughness: 0.5 });
  disposables.push(slab, iron);
  const yard = buildYard({ stone, slab, timber, timberDark, iron });
  root.add(yard.group);
  occluders.push(...yard.group.children);
  colliders.push(...yard.colliders);
  // stone well with a timber windlass (procedural, shared PBR sets); the library bucket rests on its curb
  // the curb is cut from the coarse cliff-rock set (darker source albedo, lifted) so its chisel texture reads up close
  const carved = texMat(a, 'cliff', { color: new THREE.Color(1.75, 1.7, 1.6), normalScale: 1.6 });
  disposables.push(carved);
  const well = buildWell(-4.0, 4.0, 0.5, { stone, carved, slab, timber, timberDark, iron });
  root.add(well.group);
  colliders.push(...well.colliders);
  disposables.push({ dispose: well.dispose });
  {
    const src = props.env_bucket?.scene;
    if (src) {
      const { obj } = propClone(src, 0.4, true);
      obj.position.copy(well.bucketSpot);
      obj.rotation.y = 0.8;
      root.add(obj);
    }
  }

  // ---- vegetation ----
  const vegModels: Record<string, THREE.Object3D> = {};
  for (const k of ['bamboo', 'tree_broad', 'tree_broad_far', 'pine', 'fir', 'fern', 'shrub_hb', 'shrub_box', 'grassclip', 'drygrass', 'mossrock']) vegModels[k] = props['env_' + k].scene;
  // detailed library vegetation (high tier near the settlement; the first-round models stay for mass and low tier)
  for (const k of ['tree_broad_a', 'tree_broad_b', 'tree_maple', 'pine_a', 'pine_b', 'bamboo_a', 'bush_b', 'fern_a', 'grass_b']) if (props['v2_' + k]) vegModels[k] = props['v2_' + k].scene;
  const veg = buildVegetation(vegModels, quality);
  root.add(veg.group);
  colliders.push(...veg.colliders);

  // ---- gate ----
  const gatePlaster = texMat(a, 'lime', { color: 0xe4ddce, normalScale: 0.6 });
  disposables.push(gatePlaster);
  const gate = new WorldGate({ plaster: gatePlaster, stone, tile, timberDark, brass });
  root.add(gate.group);
  colliders.push(gate.collider);
  occluders.push(...gate.occluders);

  // ---- lantern lights (warm) ----
  const lanternLights: THREE.PointLight[] = [];
  const maxL = quality === 'high' ? 4 : 2;
  const chosen = lanternPos.filter((_, i) => i % 3 !== 0 || i === 0).slice(0, maxL);
  for (const p of chosen) {
    const l = new THREE.PointLight(0xffa860, 1.4, 7, 1.8);
    l.position.copy(p).add(new THREE.Vector3(0, -0.2, 0));
    root.add(l);
    lanternLights.push(l);
  }

  // ---- interior light: one warm lamp that follows whichever house is being visited (default: the hall) ----
  const lamp = new THREE.PointLight(0xffb878, 0, 9, 1.6);
  root.add(lamp);
  const lampAt = (id: string) => {
    const hb = houses.find((x) => x.spec.id === id)!;
    const d = hb.spec;
    const p = new THREE.Vector3(0, hb.b.floorY + 2.4, -d.depth / 2 + (d.depth - d.veranda) * 0.45).applyMatrix4(hb.b.group.matrixWorld);
    return p;
  };
  let lampTarget = lampAt('hall');
  lamp.position.copy(lampTarget);
  let lampK = 0;

  // ---- falling leaves ----
  const leafFall = new LeafFall(T.leaf_atlas, quality === 'high' ? 420 : 160);
  root.add(leafFall.points);
  root.add(buildLeafLitter(T.leaf_atlas, quality, veg.trunks));

  const tmpV = new THREE.Vector3();
  return {
    root,
    sun,
    hemi,
    gate,
    colliders,
    occluders,
    leafFall,
    lanternLights,
    lanternMat: lantern,
    setCutaway(id) {
      setCutaway(id);
      lampTarget = lampAt(id ?? 'hall');
    },
    update(dt, focus, camera) {
      windUniforms.uTime.value += dt;
      sky.uniforms.uTime.value += dt;
      atmos.uniforms.uTime.value += dt;
      terrain.uniforms.uTime.value += dt;
      leafFall.uniforms.uFocus.value.copy(focus);
      lamp.position.lerp(lampTarget, Math.min(1, dt * 6));
      lampK += ((cutId ? 1 : 0.45) - lampK) * Math.min(1, dt * 2);
      lamp.intensity = 2.6 * lampK;
      // shadow camera follows the action focus (texel snapping avoids shimmer)
      tmpV.copy(focus);
      const snap = (52 / sm) * 2;
      tmpV.x = Math.round(tmpV.x / snap) * snap;
      tmpV.z = Math.round(tmpV.z / snap) * snap;
      sun.target.position.copy(tmpV);
      sun.position.copy(tmpV).addScaledVector(ATMOS.sunDir, 60);
      sky.mesh.position.copy(camera.position);
      void insideWorld;
      void GATE;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mt = m.material as THREE.Material | THREE.Material[] | undefined;
        if (mt) (Array.isArray(mt) ? mt : [mt]).forEach((x) => x.dispose());
      });
    },
  };
}

export { instanceModel };
