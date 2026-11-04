import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxUV, type Collider } from './buildings';
import { heightAt } from './layout';
import { mulberry } from './util';

/**
 * A courtyard well in the local tradition, built at real scale from the shared 2K stone / timber PBR sets:
 * - a stone apron of eight bevelled trapezoid slabs with drainage gaps, slightly settled and uneven;
 * - an octagonal stone well-curb (井栏) with chamfered edges, a carved waist band and a worn round mouth;
 * - a dark shaft and a still water surface ~1 m down that reflects the sky;
 * - a timber windlass (辘轳): two posts on stone footings, a round drum wrapped with rope, an iron crank;
 * - the rope hanging into the shaft. The wooden bucket is a library prop placed on the curb by the caller.
 */
export function buildWell(
  x: number,
  z: number,
  ry: number,
  mats: { stone: THREE.Material; carved: THREE.Material; slab: THREE.Material; timber: THREE.Material; timberDark: THREE.Material; iron: THREE.Material },
) {
  const group = new THREE.Group();
  group.name = 'well';
  const rnd = mulberry(91);
  const y0 = heightAt(x, z);
  group.position.set(x, y0, z);
  group.rotation.y = ry;
  const disposables: { dispose(): void }[] = [];

  // ---- apron: 8 slabs around the curb ----
  const slabs: THREE.BufferGeometry[] = [];
  const rIn = 0.6, rOut = 1.3;
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2 + Math.PI / 8, a1 = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8;
    const gap = 0.035;
    const sh = new THREE.Shape();
    const p = (r: number, a: number) => new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
    const pts = [p(rIn, a0 + gap / rIn), p(rOut, a0 + gap / rOut), p(rOut, a1 - gap / rOut), p(rIn, a1 - gap / rIn)];
    sh.setFromPoints(pts);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: true, bevelSize: 0.022, bevelThickness: 0.022, bevelSegments: 2, curveSegments: 1 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -0.07 + (rnd() - 0.5) * 0.035, 0);
    g.rotateY((rnd() - 0.5) * 0.02);
    slabs.push(boxUV(g.toNonIndexed(), 0.6));
  }
  const apron = new THREE.Mesh(mergeGeometries(slabs), mats.slab);
  apron.receiveShadow = apron.castShadow = true;
  group.add(apron);

  // ---- octagonal curb with a round mouth ----
  const R = 0.6, mouth = 0.36, curbH = 0.62;
  const oct = (r: number) => {
    const s = new THREE.Shape();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const v = new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
      if (i === 0) s.moveTo(v.x, v.y); else s.lineTo(v.x, v.y);
    }
    s.closePath();
    return s;
  };
  const curbPart = (r: number, h: number, yb: number, bevel: number) => {
    const s = oct(r);
    const hole = new THREE.Path();
    hole.absarc(0, 0, mouth, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: h - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 40 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, yb + bevel, 0);
    return boxUV(g.toNonIndexed(), 0.42);
  };
  // plinth course, carved waist band (inset), main block, capstone with a softer chamfer
  const curb = new THREE.Mesh(
    mergeGeometries([curbPart(R + 0.04, 0.16, 0.06, 0.02), curbPart(R - 0.035, 0.08, 0.22, 0.012), curbPart(R, 0.26, 0.3, 0.02), curbPart(R + 0.025, 0.12, curbH - 0.06, 0.035)]),
    mats.carved,
  );
  curb.castShadow = curb.receiveShadow = true;
  group.add(curb);
  // damp moss / grime ring where the curb meets the apron (splashed water never dries there)
  const mossMat = new THREE.MeshStandardMaterial({ color: 0x2f3a24, roughness: 0.95, transparent: true, opacity: 0.55, depthWrite: false });
  disposables.push(mossMat);
  const moss = new THREE.Mesh(new THREE.RingGeometry(R - 0.02, R + 0.32, 8, 1, Math.PI / 8), mossMat);
  moss.rotation.x = -Math.PI / 2;
  moss.position.y = 0.113;
  moss.renderOrder = 1;
  group.add(moss);
  // rope-worn grooves on the inner lip where the rope has run for generations
  const grooveMat = new THREE.MeshStandardMaterial({ color: 0x2c2a26, roughness: 0.55 });
  disposables.push(grooveMat);
  for (const a of [0.25, 0.55, 2.9]) {
    const gr = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.07), grooveMat);
    gr.position.set(Math.cos(a) * (mouth + 0.012), curbH + 0.058, Math.sin(a) * (mouth + 0.012));
    gr.rotation.y = -a;
    group.add(gr);
  }

  // ---- shaft and water ----
  const shaftMat = new THREE.MeshStandardMaterial({ color: 0x3a3a36, roughness: 1, side: THREE.BackSide });
  disposables.push(shaftMat);
  const shaftG = new THREE.CylinderGeometry(mouth, mouth, 1.3, 40, 1, true);
  boxUV(shaftG, 0.6);
  shaftMat.map = (mats.stone as THREE.MeshStandardMaterial).map ?? null;
  shaftMat.normalMap = (mats.stone as THREE.MeshStandardMaterial).normalMap ?? null;
  const shaft = new THREE.Mesh(shaftG, shaftMat);
  shaft.position.y = curbH - 0.6;
  group.add(shaft);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(mouth, 40),
    new THREE.MeshPhysicalMaterial({ color: 0x0b1310, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 }),
  );
  disposables.push(water.material as THREE.Material);
  water.rotation.x = -Math.PI / 2;
  water.position.y = curbH - 1.05;
  group.add(water);

  // ---- windlass frame (辘轳架) ----
  const postH = 1.75, span = R + 0.16;
  const frame: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const post = new RoundedBoxGeometry(0.13, postH, 0.13, 3, 0.02).toNonIndexed();
    post.translate(s * span, postH / 2 + 0.04, 0);
    frame.push(boxUV(post, 0.5));
    // fork at the top that cradles the drum axle
    for (const dz of [-0.045, 0.045]) {
      const prong = new RoundedBoxGeometry(0.13, 0.14, 0.035, 2, 0.01).toNonIndexed();
      prong.translate(s * span, postH + 0.1, dz);
      frame.push(boxUV(prong, 0.5));
    }
    // diagonal brace into the apron
    const br = new RoundedBoxGeometry(0.07, 0.8, 0.07, 2, 0.012).toNonIndexed();
    br.rotateZ(s * 0.62);
    br.translate(s * (span + 0.24), 0.36, 0);
    frame.push(boxUV(br, 0.5));
  }
  const frameMesh = new THREE.Mesh(mergeGeometries(frame), mats.timber);
  frameMesh.castShadow = frameMesh.receiveShadow = true;
  group.add(frameMesh);
  // stone footings for the posts
  for (const s of [-1, 1]) {
    const ft = new THREE.Mesh(boxUV(new RoundedBoxGeometry(0.26, 0.14, 0.26, 2, 0.03).toNonIndexed(), 0.42), mats.carved);
    ft.position.set(s * span, 0.05, 0);
    ft.castShadow = ft.receiveShadow = true;
    group.add(ft);
  }
  // drum with rope coils and an iron crank
  const axleY = postH + 0.08;
  const drumG = new THREE.CylinderGeometry(0.09, 0.09, span * 2 - 0.2, 24);
  drumG.rotateZ(Math.PI / 2);
  boxUV(drumG, 0.4);
  const drum = new THREE.Mesh(drumG, mats.timberDark);
  drum.position.y = axleY;
  drum.castShadow = true;
  group.add(drum);
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8c7552, roughness: 0.95 });
  disposables.push(ropeMat);
  const coils: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 9; k++) {
    const t = new THREE.TorusGeometry(0.1, 0.014, 6, 28);
    t.rotateY(Math.PI / 2);
    t.translate(-0.18 + k * 0.03, axleY, 0);
    coils.push(t);
  }
  const rope = new THREE.CylinderGeometry(0.011, 0.011, axleY - (curbH - 0.75), 6);
  rope.translate(0.06, (axleY + curbH - 0.75) / 2, 0.1);
  coils.push(rope);
  const ropeMesh = new THREE.Mesh(mergeGeometries(coils.map((g) => g.toNonIndexed())), ropeMat);
  ropeMesh.castShadow = true;
  group.add(ropeMesh);
  const crankParts: THREE.BufferGeometry[] = [];
  const axle = new THREE.CylinderGeometry(0.022, 0.022, 0.32, 10);
  axle.rotateZ(Math.PI / 2);
  axle.translate(span + 0.1, axleY, 0);
  const arm = new THREE.BoxGeometry(0.03, 0.34, 0.04);
  arm.translate(span + 0.25, axleY - 0.15, 0);
  const grip = new THREE.CylinderGeometry(0.02, 0.02, 0.2, 10);
  grip.rotateZ(Math.PI / 2);
  grip.translate(span + 0.33, axleY - 0.31, 0);
  crankParts.push(axle.toNonIndexed(), arm.toNonIndexed(), grip.toNonIndexed());
  const crank = new THREE.Mesh(mergeGeometries(crankParts), mats.iron);
  crank.castShadow = true;
  group.add(crank);
  const gripWood = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 12), mats.timber);
  gripWood.rotation.z = Math.PI / 2;
  gripWood.position.set(span + 0.36, axleY - 0.31, 0);
  group.add(gripWood);

  group.updateMatrixWorld(true);
  // the curb, posts and the bucket beside it block the walk; the outer apron slabs stay walkable
  const colliders: Collider[] = [{ x, z, hw: span + 0.15, hd: R + 0.42, rot: -ry }];
  /** where the bucket stands: on the apron slabs beside the curb (world space) */
  const bucketSpot = new THREE.Vector3(0.42, 0.1, 0.86).applyMatrix4(group.matrixWorld);
  return { group, colliders, bucketSpot, curbTop: curbH, dispose: () => disposables.forEach((d) => d.dispose()) };
}
