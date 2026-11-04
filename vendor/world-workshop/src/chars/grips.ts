import * as THREE from 'three';
import type { Character } from './character';

/**
 * Grip calibration derived from the hand skeleton (not hand-tuned Euler angles):
 * - handle axis (weapon +Y) is parallel to the knuckle line Pinky1 -> Index1
 * - the cutting edge faces along the finger direction (perpendicular to the handle)
 * - fingers are curled procedurally around that axis every frame (after the animation mixer),
 *   so the fist closes on the handle in every clip, including open-hand idles
 * - the handle center is the centroid of the curled fist (knuckles + middle phalanges)
 * Fine offsets were checked with lab.html close-ups (see docs/ANIMATION.md).
 */
export interface Grip {
  bone: 'RightHand' | 'LeftHand';
  edge: 'x' | 'z';
  /** offset in grip frame: [along handle, toward fingers, toward palm] meters */
  offset: [number, number, number];
  roll: number;
  /** curl angles per phalanx (deg) */
  curl: [number, number, number];
  thumb: number;
}

export const HERO_GRIP: Grip = { bone: 'RightHand', edge: 'z', offset: [0.0, -0.03, -0.005], roll: 0, curl: [62, 80, 50], thumb: 35 };
export const GUARD_GRIP: Grip = { bone: 'RightHand', edge: 'x', offset: [0.0, -0.012, 0.0], roll: 0, curl: [66, 84, 55], thumb: 40 };

const V = () => new THREE.Vector3();
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

interface Joint {
  bone: THREE.Bone;
  q: THREE.Quaternion; // final local quaternion when fully gripped
}

export class HandGrip {
  joints: Joint[] = [];
  weight = 1;
  holder = new THREE.Group();
  center = V();
  axisY = V();
  f = V();
  n = V();
  constructor(public ch: Character, public g: Grip) {}

  /** must be called with the character in bind pose (before any animation is applied) */
  build(weapon: THREE.Object3D) {
    const side = this.g.bone === 'RightHand' ? 'Right' : 'Left';
    const ch = this.ch;
    const hand = ch.bone(side + 'Hand')!;
    ch.root.updateMatrixWorld(true);
    const P = (n: string) => ch.bone(side + 'Hand' + n);
    const I1 = P('Index1')!, K1 = P('Pinky1')!, M1 = P('Middle1')!;
    const handInv = new THREE.Matrix4().copy(hand.matrixWorld).invert();
    const inHand = (b: THREE.Object3D) => b.getWorldPosition(V()).applyMatrix4(handInv);
    const axisY = inHand(I1).sub(inHand(K1)).normalize();
    const m = inHand(M1);
    const f = m.clone().sub(axisY.clone().multiplyScalar(m.dot(axisY))).normalize();
    const n = V().crossVectors(axisY, f).normalize();
    const thumb = P('Thumb2') || P('Thumb1');
    const mid = inHand(I1).add(inHand(K1)).multiplyScalar(0.5);
    if (thumb && inHand(thumb).sub(mid).dot(n) < 0) n.negate();
    this.axisY.copy(axisY);
    this.f.copy(f);
    this.n.copy(n);
    // world axis & palm normal at bind
    const hq = hand.getWorldQuaternion(new THREE.Quaternion());
    const Aw = axisY.clone().applyQuaternion(hq);
    const Nw = n.clone().applyQuaternion(hq);
    const Fw = f.clone().applyQuaternion(hq);
    const deg = THREE.MathUtils.degToRad;
    const restore: [THREE.Bone, THREE.Quaternion][] = [];
    for (const fn of FINGERS) {
      for (let k = 1; k <= 3; k++) {
        const b = P(fn + k);
        if (!b) continue;
        const child = b.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
        const wq = b.getWorldQuaternion(new THREE.Quaternion());
        const a = Aw.clone().applyQuaternion(wq.clone().invert()).normalize();
        const nl = Nw.clone().applyQuaternion(wq.clone().invert());
        const fl = Fw.clone().applyQuaternion(wq.clone().invert());
        const p = child ? child.position.clone() : fl.clone();
        const ang = deg(this.g.curl[k - 1]);
        const qa = new THREE.Quaternion().setFromAxisAngle(a, ang);
        const qb = new THREE.Quaternion().setFromAxisAngle(a, -ang);
        const da = p.clone().applyQuaternion(qa).sub(p).dot(nl);
        const db = p.clone().applyQuaternion(qb).sub(p).dot(nl);
        const q = b.quaternion.clone().multiply(da > db ? qa : qb);
        this.joints.push({ bone: b, q });
        // apply now so the fist centroid can be measured (rest restored afterwards)
        restore.push([b, b.quaternion.clone()]);
        b.quaternion.copy(q);
      }
    }
    // thumb: wrap over the handle (rotate toward fingers around the palm normal-ish axis)
    for (const k of [1, 2]) {
      const b = P('Thumb' + k);
      if (!b) continue;
      const wq = b.getWorldQuaternion(new THREE.Quaternion());
      const a = Fw.clone().applyQuaternion(wq.clone().invert()).normalize();
      const child = b.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
      const p = child ? child.position.clone() : V().set(0, 1, 0);
      const nl = Nw.clone().applyQuaternion(wq.clone().invert());
      const ang = deg(this.g.thumb);
      const qa = new THREE.Quaternion().setFromAxisAngle(a, ang), qb = new THREE.Quaternion().setFromAxisAngle(a, -ang);
      const da = p.clone().applyQuaternion(qa).sub(p).dot(nl), db = p.clone().applyQuaternion(qb).sub(p).dot(nl);
      const q = b.quaternion.clone().multiply(da > db ? qa : qb);
      this.joints.push({ bone: b, q });
      restore.push([b, b.quaternion.clone()]);
      b.quaternion.copy(q);
    }
    ch.root.updateMatrixWorld(true);
    // fist centroid: knuckles + middle phalanges of the four fingers
    const pts: THREE.Vector3[] = [];
    for (const fn of FINGERS) {
      const b1 = P(fn + '1'), b2 = P(fn + '2'), b3 = P(fn + '3');
      if (b1 && b2 && b3) pts.push(inHand(b1), inHand(b2), inHand(b3));
    }
    const c = pts.reduce((s, p) => s.add(p), V()).multiplyScalar(1 / Math.max(1, pts.length));
    const ws = hand.getWorldScale(V()).x / ch.root.getWorldScale(V()).x;
    c.addScaledVector(axisY, this.g.offset[0] / ws).addScaledVector(f, this.g.offset[1] / ws).addScaledVector(n, this.g.offset[2] / ws);
    this.center.copy(c);
    for (const [b, q0] of restore) b.quaternion.copy(q0);
    // holder basis
    const basis = new THREE.Matrix4();
    if (this.g.edge === 'z') basis.makeBasis(V().crossVectors(axisY, f).normalize(), axisY, f);
    else basis.makeBasis(f, axisY, V().crossVectors(f, axisY).normalize());
    this.holder.name = 'weaponHolder';
    this.holder.quaternion.setFromRotationMatrix(basis);
    if (this.g.roll) this.holder.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(V().set(0, 1, 0), deg(this.g.roll)));
    this.holder.position.copy(c);
    this.holder.scale.setScalar(1 / ws);
    this.holder.add(weapon);
    hand.add(this.holder);
    return this;
  }

  /** call after mixer.update(): overrides finger rotations with the grip pose */
  apply() {
    if (this.weight <= 0) return;
    for (const j of this.joints) {
      if (this.weight >= 1) j.bone.quaternion.copy(j.q);
      else j.bone.quaternion.slerp(j.q, this.weight);
    }
  }
}
