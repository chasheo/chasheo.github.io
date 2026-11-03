import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxUV, type Collider } from './buildings';
import { heightAt, YARD } from './layout';
import { mulberry } from './util';

/**
 * Courtyard dressing in real meters: an irregular slab walk from the gate-in to the hall steps, kerbstones on the
 * yard edge, a wooden training post (木人桩) and a weapon rack — the "life" props of a sword workshop.
 */
export function buildYard(mats: { stone: THREE.Material; slab: THREE.Material; timber: THREE.Material; timberDark: THREE.Material; iron: THREE.Material }) {
  const group = new THREE.Group();
  group.name = 'yard';
  const colliders: Collider[] = [];
  const rnd = mulberry(1234);
  // ---- slab walk: individually sized slabs, slight rotations and heights; no repeated stamp ----
  const slabs: THREE.BufferGeometry[] = [];
  const walk = (ax: number, az: number, bx: number, bz: number, width: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const dir = Math.atan2(bx - ax, bz - az);
    let t = 0;
    while (t < len) {
      const sl = 0.55 + rnd() * 0.45;
      let off = -width / 2;
      while (off < width / 2 - 0.1) {
        const sw = Math.min(width / 2 - off, 0.45 + rnd() * 0.5);
        const cx = ax + Math.sin(dir) * (t + sl / 2) + Math.cos(dir) * (off + sw / 2);
        const cz = az + Math.cos(dir) * (t + sl / 2) - Math.sin(dir) * (off + sw / 2);
        const g = new RoundedBoxGeometry(sw - 0.035, 0.1, sl - 0.035, 2, 0.018).toNonIndexed();
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(cx, heightAt(cx, cz) - 0.025 + rnd() * 0.012, cz),
          new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.02, dir + (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.02)),
          new THREE.Vector3(1, 1, 1),
        );
        g.applyMatrix4(m);
        boxUV(g, 0.9);
        slabs.push(g);
        off += sw;
      }
      t += sl;
    }
  };
  walk(1.6, 6.6, -1.4, -6.6, 1.5); // south entrance -> hall steps
  walk(-1.2, 0.2, 7.6, -1.6, 1.0); // cross walk -> east terrace stair
  const slabMesh = new THREE.Mesh(mergeGeometries(slabs)!, mats.slab);
  slabMesh.receiveShadow = true;
  slabMesh.castShadow = false;
  group.add(slabMesh);
  slabs.forEach((g) => g.dispose());
  // ---- kerbstones around the paved yard ----
  const kerbs: THREE.BufferGeometry[] = [];
  const edge = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az), dir = Math.atan2(bx - ax, bz - az);
    let t = 0;
    while (t < len) {
      const l = Math.min(len - t, 0.7 + rnd() * 0.5);
      const x = ax + Math.sin(dir) * (t + l / 2), z = az + Math.cos(dir) * (t + l / 2);
      const g = new RoundedBoxGeometry(0.26, 0.18, l - 0.03, 2, 0.03).toNonIndexed();
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z) + 0.02, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, dir + (rnd() - 0.5) * 0.03, 0)), new THREE.Vector3(1, 1, 1)));
      boxUV(g, 0.8);
      kerbs.push(g);
      t += l;
    }
  };
  const hw = YARD.hw + 0.15, hd = YARD.hd + 0.15;
  edge(-hw, hd, -0.3, hd); // south edge (gap for the path entrance)
  edge(3.4, hd, hw, hd);
  edge(-hw, -hd + 2.5, -hw, hd); // west
  edge(hw, 1.2, hw, hd); // east (south part; north part is the terrace wall)
  const kerbMesh = new THREE.Mesh(mergeGeometries(kerbs)!, mats.stone);
  kerbMesh.receiveShadow = kerbMesh.castShadow = true;
  group.add(kerbMesh);
  kerbs.forEach((g) => g.dispose());
  // ---- training post (木人桩) ----
  const dummy = new THREE.Group();
  const trunkG = new THREE.CylinderGeometry(0.14, 0.15, 1.75, 16);
  const trunk = new THREE.Mesh(trunkG, mats.timberDark);
  trunk.position.y = 0.875;
  dummy.add(trunk);
  const armG = new THREE.CylinderGeometry(0.035, 0.04, 0.52, 8);
  for (const [y, ry, rz] of [[1.25, 0.6, 1.35], [1.25, -0.6, 1.35], [0.85, 0, 1.45]] as [number, number, number][]) {
    const a = new THREE.Mesh(armG, mats.timber);
    a.position.set(Math.sin(ry) * 0.3, y, Math.cos(ry) * 0.3);
    a.rotation.set(0, ry, 0);
    a.rotateX(rz);
    dummy.add(a);
  }
  const legG = new THREE.CylinderGeometry(0.04, 0.045, 0.62, 8);
  const leg = new THREE.Mesh(legG, mats.timber);
  leg.position.set(0, 0.32, 0.3);
  leg.rotation.x = 1.0;
  dummy.add(leg);
  for (const y of [0.35, 1.55]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.012, 6, 24), mats.iron);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    dummy.add(band);
  }
  const base = new THREE.Mesh(boxUV(new RoundedBoxGeometry(0.7, 0.16, 0.7, 2, 0.03).toNonIndexed(), 0.8), mats.stone);
  base.position.y = 0.06;
  dummy.add(base);
  dummy.position.set(-5.8, heightAt(-5.8, -2.8), -2.8);
  dummy.rotation.y = 0.9;
  dummy.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true) : 0));
  group.add(dummy);
  colliders.push({ x: -5.8, z: -2.8, hw: 0.45, hd: 0.45, rot: 0 });
  // the weapon rack and the well are library models placed by world.ts (placeProp)
  void rnd;
  return { group, colliders };
}
