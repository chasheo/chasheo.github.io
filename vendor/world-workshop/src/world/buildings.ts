import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HouseSpec } from './layout';
import { houseDims, houseWorld } from './layout';
import { mulberry } from './util';

export interface BuildingMaterials {
  timber: THREE.MeshStandardMaterial;
  timberDark: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  tile: THREE.MeshStandardMaterial;
  lattice: THREE.MeshStandardMaterial;
  paper: THREE.MeshStandardMaterial;
  plaque: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  lantern: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
}

export interface Collider {
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
}

/** Recompute UVs by box projection in meters so every surface has real-world texel density. */
export function boxUV(g: THREE.BufferGeometry, scale = 1) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / scale;
    uv[i * 2 + 1] = v / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

class Bucket {
  parts: THREE.BufferGeometry[] = [];
  /** pieces entirely above `cut` (roof, eave beams, loft): cut away when someone is inside the house */
  upper: THREE.BufferGeometry[] = [];
  /** set while the roof is being built: roof pieces belong to the cut-away layer even where low eaves dip below `cut` */
  forceUpper = false;
  constructor(public cut = Infinity) {}
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, uvScale?: number) {
    let gg = g.index ? g.toNonIndexed() : g.clone();
    gg.applyMatrix4(m);
    if (!gg.attributes.normal) gg.computeVertexNormals();
    if (uvScale) boxUV(gg, uvScale);
    if (!gg.attributes.uv) boxUV(gg, 1);
    for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k);
    gg.computeBoundingBox();
    (this.forceUpper || gg.boundingBox!.min.y >= this.cut - 0.02 ? this.upper : this.parts).push(gg);
  }
  private mesh(list: THREE.BufferGeometry[], mat: THREE.Material, cast: boolean) {
    if (!list.length) return null;
    const g = mergeGeometries(list, false)!;
    for (const p of list) p.dispose();
    list.length = 0;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  }
  build(mat: THREE.Material, cast = true) {
    return this.mesh(this.parts, mat, cast);
  }
  buildUpper(mat: THREE.Material, cast = true) {
    return this.mesh(this.upper, mat, cast);
  }
}

const M = (x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));

const rbox = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01));

/* ---------------- procedural textures ---------------- */

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function latticeTexture() {
  // 步步锦 lattice: nested rectangles with short connecting bars, drawn in timber color on transparent
  const c = makeCanvas(256, 512);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 512);
  g.strokeStyle = '#3a2416';
  g.lineCap = 'square';
  const frame = 14;
  g.lineWidth = frame;
  g.strokeRect(frame / 2, frame / 2, 256 - frame, 512 - frame);
  g.lineWidth = 6;
  const cellW = 256 / 4, cellH = 512 / 8;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 8; j++) {
      const x = i * cellW, y = j * cellH;
      const inset = (i + j) % 2 ? 10 : 18;
      g.strokeRect(x + inset, y + inset, cellW - inset * 2, cellH - inset * 2);
      g.beginPath();
      g.moveTo(x + cellW / 2, y);
      g.lineTo(x + cellW / 2, y + inset);
      g.moveTo(x + cellW / 2, y + cellH - inset);
      g.lineTo(x + cellW / 2, y + cellH);
      g.moveTo(x, y + cellH / 2);
      g.lineTo(x + inset, y + cellH / 2);
      g.moveTo(x + cellW - inset, y + cellH / 2);
      g.lineTo(x + cellW, y + cellH / 2);
      g.stroke();
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function plaqueTexture(text: string, sub: string) {
  const c = makeCanvas(1024, 300);
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 300);
  grd.addColorStop(0, '#2a1a12');
  grd.addColorStop(1, '#1a0f0a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 300);
  g.strokeStyle = '#8a6a32';
  g.lineWidth = 14;
  g.strokeRect(14, 14, 996, 272);
  g.strokeStyle = '#4a3218';
  g.lineWidth = 4;
  g.strokeRect(34, 34, 956, 232);
  g.fillStyle = '#d6b36a';
  g.font = 'bold 150px "STKaiti","KaiTi","Kaiti SC","Songti SC","Noto Serif CJK SC",serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 6;
  g.fillText(text, 512, 145);
  g.font = '26px "Segoe UI",sans-serif';
  g.fillStyle = '#9c824c';
  g.fillText(sub, 512, 252);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ---------------- house ---------------- */

export interface HouseBuild {
  group: THREE.Group;
  /** roof, eave beams, loft and tiles: hidden from the view (still casting shadow) while someone is inside */
  upper: THREE.Group;
  /** wall segments, plinth / deck edges and veranda columns; the door bay and the steps stay open */
  colliders: Collider[];
  lanterns: THREE.Vector3[];
  /** meshes used for camera occlusion tests */
  occluders: THREE.Object3D[];
  lanternMats: THREE.MeshStandardMaterial[];
  /** floor height (house-local y) for furnishing */
  floorY: number;
}

export function buildHouse(h: HouseSpec, mats: BuildingMaterials, quality: 'high' | 'low', opts: { plaque?: THREE.Texture } = {}): HouseBuild {
  const rnd = mulberry(h.seed);
  const group = new THREE.Group();
  group.name = 'house_' + h.id;
  group.position.set(h.x, h.ground, h.z);
  group.rotation.y = h.rot;
  const W = h.width, D = h.depth;
  const stilts = h.stilts ?? 0;
  const baseY = h.plinth + stilts; // floor level
  const colH = h.colH * (h.storeys === 2 ? 1.65 : 1);
  const eaveY = baseY + colH;
  // everything that starts above head height belongs to the cut-away roof layer
  const cut = baseY + 2.35;
  const B = { timber: new Bucket(cut), dark: new Bucket(cut), plaster: new Bucket(cut), stone: new Bucket(cut), floor: new Bucket(cut), paper: new Bucket(cut), lattice: new Bucket(cut), brick: new Bucket(cut) };
  /** vertical slab (sx × [y0,y1] × sz) split at the cut line so its top half joins the cut-away layer */
  const vbox = (b: Bucket, sx: number, sz: number, y0: number, y1: number, x: number, z: number, uv: number) => {
    const parts: [number, number][] = y0 < cut - 0.05 && y1 > cut + 0.05 ? [[y0, cut], [cut, y1]] : [[y0, y1]];
    for (const [a, c] of parts) b.add(rbox(sx, c - a, sz, 0.01), M(x, (a + c) / 2, z), uv);
  };
  /** vertical card (lattice / paper) split at the cut line, UVs kept continuous across the split */
  const vplane = (b: Bucket, w: number, y0: number, y1: number, x: number, z: number, ry = 0) => {
    const parts: [number, number][] = y0 < cut - 0.05 && y1 > cut + 0.05 ? [[y0, cut], [cut, y1]] : [[y0, y1]];
    for (const [a, c] of parts) {
      const g = new THREE.PlaneGeometry(w, c - a);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const v0 = (a - y0) / (y1 - y0), v1 = (c - y0) / (y1 - y0);
      for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
      b.add(g, M(x, (a + c) / 2, z, ry), undefined);
    }
  };
  /** column split at the cut line */
  const vcol = (b: Bucket, r: number, y0: number, y1: number, x: number, z: number, seg: number) => {
    const parts: [number, number][] = y0 < cut - 0.05 && y1 > cut + 0.05 ? [[y0, cut], [cut, y1]] : [[y0, y1]];
    for (const [a, c] of parts) {
      const ra = r * (1 - 0.08 * (a - y0) / (y1 - y0)), rc = r * (1 - 0.08 * (c - y0) / (y1 - y0));
      b.add(new THREE.CylinderGeometry(rc, ra, c - a, seg, 1), M(x, (a + c) / 2, z), 0.7);
    }
  };
  const colR = h.id === 'hall' ? 0.14 : 0.115;
  const frontZ = D / 2;
  const wallZ = D / 2 - h.veranda;
  const backZ = -D / 2;
  const xs: number[] = [];
  for (let i = 0; i <= h.bays; i++) xs.push(-W / 2 + (i * W) / h.bays);

  // --- plinth / stilts ---
  if (!stilts) {
    const pg = rbox(W + 1.1, h.plinth + 0.6, D + 1.0, 0.06);
    B.stone.add(pg, M(0, (h.plinth - 0.6) / 2, 0.05), 1.3);
    // front steps (stone, slightly irregular)
    const steps = Math.max(2, Math.round(h.plinth / 0.17));
    for (let s = 0; s < steps; s++) {
      const sh = h.plinth * (1 - s / steps);
      const sw = 2.6 + (rnd() - 0.5) * 0.08;
      B.stone.add(rbox(sw, sh, 0.36, 0.03), M((rnd() - 0.5) * 0.04, sh / 2, D / 2 + 0.55 + s * 0.34), 1.2);
    }
  } else {
    // stilted front (吊脚): stone footing on the slope + timber posts + deck
    B.stone.add(rbox(W + 0.8, h.plinth + 0.8, D * 0.55, 0.06), M(0, (h.plinth - 0.8) / 2 + stilts - 0.1, -D * 0.22), 1.3);
    for (const x of xs)
      for (const z of [frontZ, wallZ, 0.2]) {
        B.dark.add(new THREE.CylinderGeometry(colR * 0.9, colR, baseY + 2.2, 10), M(x, (baseY - 2.2) / 2, z), 1);
        B.stone.add(rbox(0.42, 0.3, 0.42, 0.04), M(x, -2.05, z), 0.8);
      }
    // diagonal braces
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i], x1 = xs[i + 1];
      const len = Math.hypot(x1 - x0, baseY + 1.6);
      B.dark.add(rbox(0.07, len, 0.07, 0.01), M((x0 + x1) / 2, baseY / 2 - 1, frontZ, 0, 0, Math.atan2(x1 - x0, baseY + 1.6) * (i % 2 ? 1 : -1)), 1);
    }
    // deck & a usable side stair from the terrace up to the veranda (steps rise toward the front)
    B.floor.add(rbox(W + 0.4, 0.12, D + 0.3, 0.02), M(0, baseY - 0.06, 0.1), 1);
    const dd = houseDims(h);
    const sx = (dd.stairX0 + dd.stairX1) / 2, sw = dd.stairX1 - dd.stairX0;
    const botZ = dd.stairTopZ - (dd.stairN - 1) * dd.stairRun - dd.stairRun / 2;
    const span = dd.stairTopZ + dd.stairRun / 2 - botZ;
    for (let s = 0; s < dd.stairN; s++) {
      const zc = dd.stairTopZ - s * dd.stairRun;
      const top = baseY * ((zc + dd.stairRun / 2 - botZ) / span);
      B.dark.add(rbox(sw, 0.07, dd.stairRun + 0.02, 0.01), M(sx, top - 0.035, zc), 1);
      B.dark.add(rbox(sw - 0.1, top - 0.04, 0.05, 0.005), M(sx, (top - 0.04) / 2, zc - dd.stairRun / 2 + 0.03), 1);
    }
    const sl = Math.hypot(span, baseY), ang = Math.atan2(baseY, span);
    for (const x of [dd.stairX0 + 0.03, dd.stairX1 - 0.03]) {
      B.dark.add(rbox(0.07, 0.2, sl, 0.01), M(x, baseY / 2 - 0.05, botZ + span / 2, 0, -ang, 0), 1);
      // hand rail on posts (outer side only: the inner side opens onto the veranda landing at the top)
      if (x < dd.stairX1 - 0.1) continue;
      B.dark.add(rbox(0.06, 0.06, sl, 0.01), M(x, baseY / 2 + 0.85, botZ + span / 2, 0, -ang, 0), 1);
      for (let k = 0; k <= 3; k++) {
        const z = botZ + (span * k) / 3, y = baseY * (k / 3);
        B.dark.add(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), M(x, y + 0.42, z), 1);
      }
    }
  }
  // floor boards
  if (!stilts) B.floor.add(rbox(W - 0.1, 0.06, D - 0.1, 0.01), M(0, baseY + 0.03, 0), 1);

  // --- columns with stone bases ---
  for (const x of xs)
    for (const z of [frontZ, wallZ, backZ]) {
      vcol(B.timber, colR, baseY, baseY + colH, x, z, 14);
      B.stone.add(new THREE.CylinderGeometry(colR * 1.45, colR * 1.75, 0.2, 14), M(x, baseY + 0.1, z), 0.6);
    }
  // side columns (mid depth)
  for (const x of [xs[0], xs[xs.length - 1]]) vcol(B.timber, colR, baseY, baseY + colH, x, (wallZ + backZ) / 2, 12);

  // --- beams: eave beam, lintels, tie beams ---
  const beamH = 0.26;
  for (const z of [frontZ, wallZ, backZ]) B.timber.add(rbox(W + 0.5, beamH, 0.2, 0.02), M(0, eaveY - beamH / 2, z), 1);
  for (const x of xs) B.timber.add(rbox(0.18, beamH * 0.9, D + 0.4, 0.02), M(x, eaveY - beamH * 0.55, 0), 1);
  B.timber.add(rbox(W, 0.14, 0.14, 0.015), M(0, eaveY - 0.62, frontZ), 1); // veranda lintel
  // brackets (雀替) under front lintel at each column
  for (const x of xs)
    for (const s of [-1, 1]) {
      if ((x === xs[0] && s < 0) || (x === xs[xs.length - 1] && s > 0)) continue;
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.lineTo(0.55, 0);
      sh.quadraticCurveTo(0.2, -0.05, 0, -0.32);
      sh.closePath();
      const eg = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false, curveSegments: 6 });
      eg.translate(0, 0, -0.04);
      B.dark.add(eg, M(x + s * colR, eaveY - 0.69, frontZ, 0, 0, 0, s, 1, 1), 0.5);
    }

  // --- walls ---
  const wallT = 0.12;
  const sillH = 0.85; // lower timber/stone panel
  // 槛墙: grey brick dado under the plaster on the hall and the west wing, timber on the stilted workshop
  const lowerColor = h.id === 'east' ? B.dark : B.brick;
  const floorTop = h.storeys === 2 ? baseY + h.colH : eaveY;
  const addPlasterPanel = (x0: number, x1: number, z: number, y0: number, y1: number, win: boolean) => {
    const w = x1 - x0 - colR * 1.6;
    const cx = (x0 + x1) / 2;
    if (w <= 0.05) return;
    lowerColor.add(rbox(w, sillH, wallT + 0.02, 0.01), M(cx, y0 + sillH / 2, z), 0.9);
    if (!win) {
      vbox(B.plaster, w, wallT, y0 + sillH, y1, cx, z, 1.6);
    } else {
      const ww = Math.min(1.1, w * 0.45), wh = 0.75, wy = y0 + sillH + 0.55;
      const sideW = (w - ww) / 2;
      vbox(B.plaster, sideW, wallT, y0 + sillH, y1, cx - ww / 2 - sideW / 2, z, 1.6);
      vbox(B.plaster, sideW, wallT, y0 + sillH, y1, cx + ww / 2 + sideW / 2, z, 1.6);
      B.plaster.add(rbox(ww, wy - y0 - sillH - wh / 2, wallT, 0.01), M(cx, (y0 + sillH + wy - wh / 2) / 2, z), 1.6);
      vbox(B.plaster, ww, wallT, wy + wh / 2, y1, cx, z, 1.6);
      B.dark.add(rbox(ww + 0.12, 0.08, wallT + 0.06, 0.01), M(cx, wy - wh / 2 - 0.04, z), 1);
      B.dark.add(rbox(ww + 0.12, 0.08, wallT + 0.06, 0.01), M(cx, wy + wh / 2 + 0.04, z), 1);
      const lat = new THREE.PlaneGeometry(ww, wh);
      for (const s of [1, -1]) B.lattice.add(lat, M(cx, wy, z + s * (wallT / 2 + 0.005), s > 0 ? 0 : Math.PI), undefined);
      B.paper.add(new THREE.PlaneGeometry(ww, wh), M(cx, wy, z), undefined);
    }
    // timber frame band (horizontal) on plaster
    B.dark.add(rbox(w, 0.09, wallT + 0.05, 0.01), M(cx, y0 + sillH + 0.02, z), 1);
  };
  // back wall
  for (let i = 0; i < h.bays; i++) addPlasterPanel(xs[i], xs[i + 1], backZ, baseY, eaveY - beamH, i % 2 === 1);
  // side walls
  for (const sx of [-1, 1]) {
    const x = sx * W / 2;
    const zs = [backZ, (wallZ + backZ) / 2, wallZ];
    for (let i = 0; i < 2; i++) {
      const g0 = new THREE.Group();
      const z0 = zs[i], z1 = zs[i + 1];
      const len = z1 - z0 - colR * 1.6;
      lowerColor.add(rbox(wallT + 0.02, sillH, len, 0.01), M(x, baseY + sillH / 2, (z0 + z1) / 2), 0.9);
      vbox(B.plaster, wallT, len, baseY + sillH, eaveY - beamH, x, (z0 + z1) / 2, 1.6);
      B.dark.add(rbox(wallT + 0.05, 0.09, len, 0.01), M(x, baseY + sillH + 0.02, (z0 + z1) / 2), 1);
      void g0;
    }
  }
  // front wall: center door bay (open leaves), lattice windows elsewhere, end bays plaster
  const mid = Math.floor(h.bays / 2);
  const doorH = Math.min(2.6, (h.storeys === 2 ? h.colH : colH) - 0.45);
  for (let i = 0; i < h.bays; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    const cx = (x0 + x1) / 2, w = x1 - x0 - colR * 1.6;
    if (i === mid) {
      // threshold + door frame
      B.dark.add(rbox(w, 0.16, 0.18, 0.02), M(cx, baseY + 0.08, wallZ), 1);
      B.dark.add(rbox(w, 0.14, 0.2, 0.02), M(cx, baseY + doorH + 0.07, wallZ), 1);
      if (floorTop - beamH - baseY - doorH - 0.14 > 0.1) {
        const tH = floorTop - (h.storeys === 2 ? 0.1 : beamH) - (baseY + doorH + 0.14);
        const tl = new THREE.PlaneGeometry(w, tH);
        B.lattice.add(tl, M(cx, baseY + doorH + 0.14 + tH / 2, wallZ + 0.04), undefined);
        B.paper.add(new THREE.PlaneGeometry(w, tH), M(cx, baseY + doorH + 0.14 + tH / 2, wallZ + 0.02), undefined);
      }
      // two leaves open inward at different angles: reveals the interior
      const leafW = w / 2;
      for (const s of [-1, 1]) {
        const a = s < 0 ? 1.25 : 0.9; // opening angle
        const hx = cx + s * w / 2;
        const theta = s > 0 ? Math.PI - a : a; // rotates leaf +X from hinge toward the inside
        const m0 = new THREE.Matrix4().compose(new THREE.Vector3(hx, baseY + 0.16, wallZ - 0.03), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), theta), new THREE.Vector3(1, 1, 1));
        const at = (x: number, y: number, z = 0, ry = 0) => m0.clone().multiply(M(x, y, z, ry));
        const fh = doorH - 0.16;
        B.dark.add(rbox(leafW, 0.07, 0.06, 0.01), at(leafW / 2, 0.035), 1);
        B.dark.add(rbox(leafW, 0.07, 0.06, 0.01), at(leafW / 2, fh - 0.035), 1);
        B.dark.add(rbox(0.07, fh, 0.06, 0.01), at(0.035, fh / 2), 1);
        B.dark.add(rbox(0.07, fh, 0.06, 0.01), at(leafW - 0.035, fh / 2), 1);
        B.dark.add(rbox(leafW, 0.06, 0.06, 0.01), at(leafW / 2, fh * 0.38), 1);
        B.dark.add(rbox(leafW - 0.1, fh * 0.36, 0.035, 0.005), at(leafW / 2, fh * 0.19), 1);
        const lh = fh * 0.58;
        const ly = fh * 0.38 + lh / 2 + 0.03;
        B.lattice.add(new THREE.PlaneGeometry(leafW - 0.1, lh), at(leafW / 2, ly, 0.032));
        B.lattice.add(new THREE.PlaneGeometry(leafW - 0.1, lh), at(leafW / 2, ly, -0.032, Math.PI));
        B.paper.add(new THREE.PlaneGeometry(leafW - 0.1, lh), at(leafW / 2, ly, 0));
      }
    } else if (i === 0 || i === h.bays - 1) {
      addPlasterPanel(x0, x1, wallZ, baseY, (h.storeys === 2 ? floorTop - 0.1 : eaveY - beamH), true);
    } else {
      // lattice window bay (槛窗) over a timber sill wall
      B.timber.add(rbox(w, sillH, wallT + 0.02, 0.01), M(cx, baseY + sillH / 2, wallZ), 0.9);
      const top = (h.storeys === 2 ? floorTop - 0.1 : eaveY - beamH);
      const lh = top - baseY - sillH - 0.1;
      B.dark.add(rbox(w, 0.08, wallT + 0.06, 0.01), M(cx, baseY + sillH + 0.04, wallZ), 1);
      const nl = Math.max(2, Math.round(w / 0.62));
      for (let k = 0; k < nl; k++) {
        const lw = w / nl;
        const lx = x0 + colR * 0.8 + lw * (k + 0.5);
        const ly0 = baseY + sillH + 0.08;
        vplane(B.lattice, lw - 0.05, ly0, ly0 + lh, lx, wallZ + 0.05);
        vplane(B.lattice, lw - 0.05, ly0, ly0 + lh, lx, wallZ - 0.05, Math.PI);
        vbox(B.dark, 0.05, 0.1, ly0, ly0 + lh, x0 + colR * 0.8 + lw * k, wallZ, 1);
      }
      vplane(B.paper, w, baseY + sillH + 0.08, baseY + sillH + 0.08 + lh, cx, wallZ);
    }
  }
  // second storey (loft): balcony rail + upper lattice band
  if (h.storeys === 2) {
    const fy = floorTop;
    B.floor.add(rbox(W + 0.3, 0.14, D - h.veranda + 0.2, 0.02), M(0, fy, (wallZ + backZ) / 2), 1);
    B.timber.add(rbox(W + 0.3, 0.2, 0.22, 0.02), M(0, fy, wallZ), 1);
    // projecting balcony over veranda
    B.floor.add(rbox(W - 0.2, 0.1, h.veranda - 0.2, 0.01), M(0, fy, (frontZ + wallZ) / 2), 1);
    for (let k = 0; k <= Math.round(W / 0.24); k++) {
      const x = -W / 2 + 0.15 + k * ((W - 0.3) / Math.round(W / 0.24));
      B.dark.add(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 6), M(x, fy + 0.42, frontZ - 0.05), 1);
    }
    B.dark.add(rbox(W - 0.1, 0.08, 0.1, 0.01), M(0, fy + 0.8, frontZ - 0.05), 1);
    B.dark.add(rbox(W - 0.1, 0.06, 0.08, 0.01), M(0, fy + 0.1, frontZ - 0.05), 1);
    for (let i = 0; i < h.bays; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, w = xs[i + 1] - xs[i] - colR * 1.6;
      const lh = eaveY - beamH - fy - 0.35;
      B.timber.add(rbox(w, 0.3, wallT + 0.02, 0.01), M(cx, fy + 0.22, wallZ), 0.9);
      B.lattice.add(new THREE.PlaneGeometry(w - 0.06, lh), M(cx, fy + 0.37 + lh / 2, wallZ + 0.05));
      B.lattice.add(new THREE.PlaneGeometry(w - 0.06, lh), M(cx, fy + 0.37 + lh / 2, wallZ - 0.05, Math.PI));
      B.paper.add(new THREE.PlaneGeometry(w - 0.06, lh), M(cx, fy + 0.37 + lh / 2, wallZ));
    }
  }

  // --- interior: furnished with library models by world.ts (furnishHouse); here only the hanging lanterns ---
  const intZ = (wallZ + backZ) / 2;
  const lanterns: THREE.Vector3[] = [];
  const lanternMats: THREE.MeshStandardMaterial[] = [];
  const addLantern = (x: number, y: number, z: number, scale = 1) => {
    const lg = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.2 * scale, 14, 10), mats.lantern);
    body.scale.y = 1.25;
    lg.add(body);
    for (const sy of [1, -1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * scale, 0.11 * scale, 0.05 * scale, 12), mats.timberDark);
      cap.position.y = sy * 0.25 * scale;
      lg.add(cap);
    }
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 4), mats.timberDark);
    cord.position.y = 0.48 * scale;
    lg.add(cord);
    lg.position.set(x, y, z);
    group.add(lg);
    lanterns.push(new THREE.Vector3(x, y, z));
  };
  addLantern(-0.4, eaveY - (h.storeys === 2 ? h.colH * 0.65 + 0.9 : 0.95), intZ + 0.2, 1);
  for (const sx of [-1, 1]) addLantern(sx * (W / h.bays) * 0.55, eaveY - 0.95, frontZ - 0.1, 0.85);
  lanternMats.push(mats.lantern);

  // --- roof: curved slab with thickness, underside boards, rafter ends, tiles, ridge ---
  // (the whole roof joins the cut-away layer: on the low single-storey houses the eaves dip below head height)
  for (const b of Object.values(B)) b.forceUpper = true;
  const oh = h.overhang;
  const halfL = W / 2 + oh * 0.75; // gable overhang (悬山)
  const run = D / 2 + oh;
  const rise = (D / 2) * h.roofPitch + 0.35;
  const thick = 0.24;
  const prof = (t: number) => rise * Math.pow(1 - t, 1.32); // concave (举折) profile
  const ridgeY = eaveY + 0.32;
  const roofTop = (x: number, t: number, side: number) => new THREE.Vector3(x, ridgeY + prof(t) - rise + 0.0, side * t * run);
  // slab geometry per side
  const nu = 2, nt = 16;
  const slabTop: number[] = [], slabBot: number[] = [], edge: number[] = [];
  const slab = (side: number) => {
    const pos: number[] = [];
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, arr: number[]) => arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    for (let i = 0; i < nt; i++) {
      const t0 = i / nt, t1 = (i + 1) / nt;
      for (let j = 0; j < nu; j++) {
        const x0 = -halfL + (2 * halfL * j) / nu, x1 = -halfL + (2 * halfL * (j + 1)) / nu;
        const a = roofTop(x0, t0, side), b = roofTop(x1, t0, side), c = roofTop(x1, t1, side), d = roofTop(x0, t1, side);
        if (side > 0) quad(a, d, c, b, slabTop); else quad(a, b, c, d, slabTop);
        const off = new THREE.Vector3(0, -thick, 0);
        const a2 = a.clone().add(off), b2 = b.clone().add(off), c2 = c.clone().add(off), d2 = d.clone().add(off);
        if (side > 0) quad(a2, b2, c2, d2, slabBot); else quad(a2, d2, c2, b2, slabBot);
      }
      // gable edges
      for (const x of [-halfL, halfL]) {
        const a = roofTop(x, t0, side), d = roofTop(x, t1, side);
        const a2 = a.clone().setY(a.y - thick), d2 = d.clone().setY(d.y - thick);
        if (x * side > 0) quad(a, a2, d2, d, edge); else quad(a, d, d2, a2, edge);
      }
    }
    // eave fascia
    const e0 = roofTop(-halfL, 1, side), e1 = roofTop(halfL, 1, side);
    const f0 = e0.clone().setY(e0.y - thick), f1 = e1.clone().setY(e1.y - thick);
    if (side > 0) quad(e0, f0, f1, e1, edge); else quad(e0, e1, f1, f0, edge);
    void pos;
  };
  slab(1);
  slab(-1);
  const toGeo = (arr: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    return g;
  };
  B.timber.add(toGeo(slabBot), new THREE.Matrix4(), 0.9); // exposed underside boards
  B.dark.add(toGeo(edge), new THREE.Matrix4(), 0.6);
  // mortar bed (dark) visible between tiles
  B.stone.add(toGeo(slabTop), M(0, -0.01, 0), 2);
  // rafter ends under the eaves (椽头)
  for (const side of [1, -1]) {
    const n = Math.round((2 * halfL) / 0.24);
    for (let k = 0; k <= n; k++) {
      const x = -halfL + 0.1 + k * ((2 * halfL - 0.2) / n);
      const p = roofTop(x, 0.97, side);
      B.timber.add(new THREE.CylinderGeometry(0.045, 0.045, 0.9, 8), M(x, p.y - thick - 0.04, p.z - side * 0.38, 0, Math.PI / 2 - side * 0.35, 0), 0.3);
    }
    // purlins visible under the overhang (檩)
    for (const t of [0.55, 0.8]) {
      const p = roofTop(0, t, side);
      B.timber.add(new THREE.CylinderGeometry(0.09, 0.09, 2 * halfL, 10), M(0, p.y - thick - 0.08, p.z, 0, 0, Math.PI / 2), 0.6);
    }
  }
  // gable boards (博风板) & hanging fish (悬鱼)
  for (const sx of [-1, 1]) {
    const pts: number[] = [];
    for (let i = 0; i < 12; i++) {
      for (const side of [1, -1]) {
        const t0 = i / 12, t1 = (i + 1) / 12;
        const a = roofTop(sx * (halfL + 0.03), t0, side), b = roofTop(sx * (halfL + 0.03), t1, side);
        const a2 = a.clone().setY(a.y - 0.42), b2 = b.clone().setY(b.y - 0.42);
        if (sx * side > 0) pts.push(a.x, a.y + 0.04, a.z, b.x, b.y + 0.04, b.z, b2.x, b2.y, b2.z, a.x, a.y + 0.04, a.z, b2.x, b2.y, b2.z, a2.x, a2.y, a2.z);
        else pts.push(a.x, a.y + 0.04, a.z, b2.x, b2.y, b2.z, b.x, b.y + 0.04, b.z, a.x, a.y + 0.04, a.z, a2.x, a2.y, a2.z, b2.x, b2.y, b2.z);
      }
    }
    const bg = toGeo(pts);
    B.dark.add(bg, new THREE.Matrix4(), 0.6);
    B.dark.add(bg, M(-sx * 0.05, 0, 0), 0.6);
    const fish = new THREE.Shape();
    fish.moveTo(0, 0);
    fish.bezierCurveTo(0.18, -0.15, 0.16, -0.45, 0, -0.62);
    fish.bezierCurveTo(-0.16, -0.45, -0.18, -0.15, 0, 0);
    B.dark.add(new THREE.ExtrudeGeometry(fish, { depth: 0.04, bevelEnabled: false }), M(sx * (halfL + 0.06), ridgeY - 0.3, 0, Math.PI / 2), 0.5);
    // gable plaster triangle above the side wall
    const tri: number[] = [];
    for (let i = 0; i < 10; i++) {
      for (const side of [1, -1]) {
        const t0 = i / 10, t1 = (i + 1) / 10;
        const a = roofTop(sx * W / 2, t0 * (D / 2) / run, side), b = roofTop(sx * W / 2, t1 * (D / 2) / run, side);
        const ay = a.y - thick, by = b.y - thick;
        const fy = eaveY - beamH;
        if (sx * side > 0) tri.push(a.x, ay, a.z, b.x, fy, b.z, b.x, by, b.z, a.x, ay, a.z, a.x, fy, a.z, b.x, fy, b.z);
        else tri.push(a.x, ay, a.z, b.x, by, b.z, b.x, fy, b.z, a.x, ay, a.z, b.x, fy, b.z, a.x, fy, a.z);
      }
    }
    B.plaster.add(toGeo(tri), new THREE.Matrix4(), 1.6);
  }
  // tiles (instanced): alternating pan (板瓦) and cover (筒瓦) lines down each slope
  const tileLen = 0.3;
  const pitchX = 0.26;
  const coverG = new THREE.CylinderGeometry(0.068, 0.068, tileLen + 0.04, quality === 'high' ? 10 : 6, 1, true, -Math.PI / 2, Math.PI);
  coverG.rotateX(Math.PI / 2);
  coverG.rotateZ(Math.PI / 2);
  const panG = new THREE.CylinderGeometry(0.3, 0.3, tileLen + 0.06, quality === 'high' ? 8 : 5, 1, true, Math.PI - 0.38, 0.76);
  panG.rotateX(Math.PI / 2);
  panG.rotateZ(Math.PI / 2);
  panG.translate(0, 0.31, 0);
  const endG = new THREE.CylinderGeometry(0.075, 0.075, 0.03, 12); // 瓦当
  endG.rotateX(Math.PI / 2);
  const dripG = new THREE.ConeGeometry(0.12, 0.12, 3); // 滴水 lip
  dripG.rotateX(Math.PI);
  const covers: THREE.Matrix4[] = [], pans: THREE.Matrix4[] = [], ends: THREE.Matrix4[] = [], drips: THREE.Matrix4[] = [];
  const nLines = Math.floor((2 * halfL - 0.2) / pitchX);
  for (const side of [1, -1]) {
    const slopeLen = (() => {
      let L = 0;
      for (let i = 0; i < 40; i++) L += roofTop(0, i / 40, side).distanceTo(roofTop(0, (i + 1) / 40, side));
      return L;
    })();
    const rows = Math.ceil(slopeLen / (tileLen * 0.92));
    for (let li = 0; li <= nLines; li++) {
      const x = -halfL + 0.1 + li * ((2 * halfL - 0.2) / nLines);
      const isCover = li % 2 === 1;
      for (let r = 0; r < rows; r++) {
        const t = Math.min(0.995, (r + 0.5) / rows);
        const p = roofTop(x, t, side);
        const p2 = roofTop(x, Math.min(1, t + 0.01), side);
        const dz = p2.clone().sub(p).normalize(); // downslope
        const ny = new THREE.Vector3(1, 0, 0).cross(dz).multiplyScalar(side > 0 ? 1 : -1).normalize();
        if (ny.y < 0) ny.negate();
        const xax = new THREE.Vector3().crossVectors(ny, dz).normalize();
        const m = new THREE.Matrix4().makeBasis(xax, ny, dz);
        const jitter = (rnd() - 0.5) * 0.012;
        m.setPosition(p.x + jitter, p.y + (isCover ? 0.035 : -0.005), p.z);
        (isCover ? covers : pans).push(m);
      }
      const pe = roofTop(x, 1, side);
      const pe2 = roofTop(x, 0.99, side);
      const dz = pe.clone().sub(pe2).normalize();
      const ny = new THREE.Vector3(1, 0, 0).cross(dz).multiplyScalar(side > 0 ? 1 : -1).normalize();
      if (ny.y < 0) ny.negate();
      const xax = new THREE.Vector3().crossVectors(ny, dz).normalize();
      const m = new THREE.Matrix4().makeBasis(xax, ny, dz);
      m.setPosition(pe.x, pe.y + (isCover ? 0.035 : -0.03), pe.z + side * 0.02);
      (isCover ? ends : drips).push(m);
    }
  }
  const upper = new THREE.Group();
  upper.name = 'roof_' + h.id;
  group.add(upper);
  const mkInst = (g: THREE.BufferGeometry, arr: THREE.Matrix4[]) => {
    const im = new THREE.InstancedMesh(g, mats.tile, arr.length);
    const col = new THREE.Color();
    arr.forEach((m, i) => {
      im.setMatrixAt(i, m);
      // weathered roofs are never one grey: per-tile tone, a few greener (moss) or browner (soot) pieces
      const v = 0.82 + rnd() * 0.3, r = rnd();
      col.setRGB(v * (r < 0.12 ? 0.92 : r > 0.94 ? 1.08 : 1), v * (r < 0.12 ? 1.06 : 1), v * (r > 0.94 ? 0.9 : 1));
      im.setColorAt(i, col);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    upper.add(im);
    return im;
  };
  mkInst(coverG, covers);
  mkInst(panG, pans);
  mkInst(endG, ends);
  mkInst(dripG, drips);
  // ridge (正脊) with layered tiles + curled ends
  const ridgeLen = 2 * halfL + 0.1;
  B.stone.add(rbox(ridgeLen, 0.34, 0.34, 0.04), M(0, ridgeY + 0.12, 0), 0.8);
  const ridgeTiles: THREE.Matrix4[] = [];
  const nr = Math.round(ridgeLen / 0.09);
  for (let k = 0; k < nr; k++) ridgeTiles.push(M(-ridgeLen / 2 + 0.05 + k * (ridgeLen - 0.1) / nr, ridgeY + 0.36, 0, 0, 0, 0.35));
  const rtG = new THREE.BoxGeometry(0.03, 0.16, 0.26);
  mkInst(rtG, ridgeTiles);
  for (const sx of [-1, 1]) {
    const curl = new THREE.TorusGeometry(0.22, 0.07, 8, 16, Math.PI * 1.3);
    B.stone.add(curl, M(sx * (ridgeLen / 2 - 0.05), ridgeY + 0.55, 0, Math.PI / 2, 0, sx > 0 ? -0.6 : Math.PI + 0.6), 0.5);
  }

  // build merged meshes (lower layer stays, upper layer is the cut-away roof)
  const occluders: THREE.Object3D[] = [];
  const add = (b: Bucket, m: THREE.Material, cast = true) => {
    const lo = b.build(m, cast);
    if (lo) {
      group.add(lo);
      occluders.push(lo);
    }
    const up = b.buildUpper(m, cast);
    if (up) {
      upper.add(up);
      occluders.push(up);
    }
  };
  add(B.timber, mats.timber);
  add(B.dark, mats.timberDark);
  add(B.plaster, mats.plaster);
  add(B.stone, mats.stone);
  add(B.floor, mats.floor);
  add(B.brick, mats.brick);
  const pLo = B.paper.build(mats.paper, false), pUp = B.paper.buildUpper(mats.paper, false);
  if (pLo) group.add(pLo);
  if (pUp) upper.add(pUp);
  const latDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: mats.lattice.map, alphaTest: 0.5 });
  const lm = B.lattice.build(mats.lattice, true), lu = B.lattice.buildUpper(mats.lattice, true);
  if (lm) { lm.customDepthMaterial = latDepth; group.add(lm); }
  if (lu) { lu.customDepthMaterial = latDepth; upper.add(lu); }
  // plaque over the door
  if (opts.plaque) {
    const pl = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 0.08), [mats.timberDark, mats.timberDark, mats.timberDark, mats.timberDark, mats.plaque, mats.timberDark]);
    pl.position.set(0, (h.storeys === 2 ? floorTop : eaveY) - 0.48, wallZ + 0.12);
    pl.rotation.x = -0.08;
    pl.castShadow = true;
    upper.add(pl);
  }
  const colliders = houseColliders(h, xs, colR, mid);
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.matrixAutoUpdate = false;
    o.updateMatrix();
  });
  group.updateMatrixWorld(true);
  const lw = lanterns.map((p) => p.clone().applyMatrix4(group.matrixWorld));
  return { group, upper, colliders, lanterns: lw, occluders, lanternMats, floorY: baseY + (stilts ? 0 : 0.06) };
}

/**
 * Enterable footprint: thin oriented boxes along the walls (door bay left open), the plinth / deck edges (steps and
 * stair top left open) and the free-standing veranda columns. Built in house-local metres, converted to world.
 */
function houseColliders(h: HouseSpec, xs: number[], colR: number, mid: number): Collider[] {
  const d = houseDims(h);
  const local: [number, number, number, number][] = []; // cx, cz, hw, hd
  const t = 0.13;
  // walls
  local.push([0, d.backZ, d.W / 2 + t, t]);
  for (const s of [-1, 1]) local.push([s * d.W / 2, (d.wallZ + d.backZ) / 2, t, (d.wallZ - d.backZ) / 2 + t]);
  const doorL = xs[mid] + colR * 0.8, doorR = xs[mid + 1] - colR * 0.8;
  local.push([(-d.W / 2 + doorL) / 2, d.wallZ, (doorL + d.W / 2) / 2, t]);
  local.push([(doorR + d.W / 2) / 2, d.wallZ, (d.W / 2 - doorR) / 2, t]);
  // veranda columns (front row)
  for (const x of xs) local.push([x, d.frontZ, colR + 0.04, colR + 0.04]);
  if (!d.stilts) {
    // plinth edge: no climbing onto the 0.4–0.7 m stone base except up the front steps
    const e = 0.12;
    local.push([0, d.plinthZ0, d.plinthHW + e, e]);
    for (const s of [-1, 1]) local.push([s * d.plinthHW, (d.plinthZ0 + d.plinthZ1) / 2, e, (d.plinthZ1 - d.plinthZ0) / 2 + e]);
    for (const s of [-1, 1]) local.push([s * (d.plinthHW + 1.3) / 2, d.plinthZ1, (d.plinthHW - 1.3) / 2, e]);
    // stair cheeks beside the steps
    for (const s of [-1, 1]) local.push([s * 1.42, (d.plinthZ1 + d.stepsZ1) / 2, 0.1, (d.stepsZ1 - d.plinthZ1) / 2]);
  } else {
    const e = 0.14;
    const botZ = d.stairTopZ - (d.stairN - 1) * d.stairRun - d.stairRun / 2;
    const topEnd = d.stairTopZ + d.stairRun / 2;
    // deck front, left side, right side up to the stair landing (the landing opens between the side wall's
    // front end and the front veranda column: ~0.9 m, wide enough for the 0.64 m character capsule)
    local.push([0, d.deckZ1, d.deckHW + e, e]);
    local.push([-d.deckHW, (d.deckZ0 + d.deckZ1) / 2, e, (d.deckZ1 - d.deckZ0) / 2 + e]);
    const landing0 = d.wallZ + 0.15;
    local.push([d.deckHW, (d.deckZ0 + landing0) / 2, e, (landing0 - d.deckZ0) / 2]);
    local.push([0, d.deckZ0, d.deckHW + e, e]);
    // stair: outer cheek and the closed top end
    local.push([d.stairX1 + 0.05, (botZ + topEnd) / 2, e, (topEnd - botZ) / 2]);
    local.push([(d.stairX0 + d.stairX1) / 2 + 0.1, topEnd + 0.12, (d.stairX1 - d.stairX0) / 2 + 0.1, e]);
  }
  return local.map(([cx, cz, hw, hd]) => {
    const w = houseWorld(h, cx, cz);
    return { x: w.x, z: w.z, hw, hd, rot: -h.rot };
  });
}
