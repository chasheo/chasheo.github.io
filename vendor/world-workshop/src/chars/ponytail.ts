import * as THREE from 'three';
import { angleDiff, type Character } from './character';

/**
 * Secondary motion for a ponytail that the auto-rig skinned rigidly to the head.
 *
 * At load the ponytail vertices are found in bind space (head-weighted, behind the skull, below the hair tie), a
 * chain of bones is inserted under the head along their centre line and those vertices are re-skinned onto the
 * chain (smooth two-bone blend, the top half-segment still blends into the head so the tie stays put). Each frame a
 * verlet chain follows the animated chain with gravity, inertia and drag, stays out of the body (capsules along the
 * spine and skull) and above the ground, and the chain bones are rotated to the simulated points.
 */
export interface PonytailOpts {
  /** hair tie height above the head joint (bind units): vertices above it stay on the head */
  tieAbove: number;
  /** vertices further back than this behind the head joint (bind units) belong to the ponytail */
  behind: number;
  segments?: number;
  /** pull back toward the animated shape per 1/120 s step, root -> tip */
  stiffness?: [number, number];
  /** velocity kept per 1/120 s step */
  damping?: number;
  /** strand half-thickness kept clear of the body (bind units) */
  thickness?: number;
}

interface Capsule {
  a: THREE.Object3D;
  b: THREE.Object3D;
  bOffset: THREE.Vector3; // local offset on b (head top)
  r: number; // world metres
}

const STEP = 1 / 120;
/** swing limit away from the animated strand, root -> tip (radians) */
const MAX_ANGLE: [number, number] = [0.7, 1.05];
/** a facing change bigger than this in one frame is a gameplay snap, not a turn */
const SNAP_YAW = 0.35;
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

export class Ponytail {
  bones: THREE.Bone[] = [];
  /** vertices moved onto the chain (QA) */
  vertexCount = 0;
  private restQ: THREE.Quaternion[] = [];
  private x: THREE.Vector3[] = [];
  private px: THREE.Vector3[] = [];
  private target: THREE.Vector3[] = [];
  private len: number[] = [];
  private caps: Capsule[] = [];
  private acc = 0;
  private live = false;
  private stiff: [number, number];
  private damp: number;
  private thick: number;
  /** world ground height under the character (set by the owner every frame) */
  groundY = -1e9;
  private root: THREE.Object3D;
  private prevYaw = 0;

  private yawOf() {
    this.root.getWorldQuaternion(_q);
    const f = _a.set(0, 0, 1).applyQuaternion(_q);
    return Math.atan2(f.x, f.z);
  }

  constructor(ch: Character, o: PonytailOpts) {
    this.root = ch.root;
    const sm = ch.meshes[0];
    const head = ch.bone('Head');
    const hips = ch.bone('Hips');
    if (!sm || !head || !hips) throw new Error('[ponytail] needs a skinned mesh with Hips/Head');
    const skel = sm.skeleton;
    const hi = skel.bones.indexOf(head);
    if (hi < 0) throw new Error('[ponytail] head bone not in skeleton');
    const segs = o.segments ?? 4;
    this.stiff = o.stiffness ?? [0.05, 0.012];
    this.damp = o.damping ?? 0.985;
    // bind-space ("S") rest matrices of the rig's own bones
    const restS = (b: THREE.Bone) => new THREE.Matrix4().copy(skel.boneInverses[skel.bones.indexOf(b)]).invert();
    const posS = (b: THREE.Bone | undefined) => (b ? new THREE.Vector3().setFromMatrixPosition(restS(b)) : null);
    const headS = restS(head);
    const hS = new THREE.Vector3().setFromMatrixPosition(headS);
    const up = new THREE.Vector3(0, 1, 0);
    const lS = posS(ch.bone('LeftUpLeg'))!, rS = posS(ch.bone('RightUpLeg'))!;
    const fwd = new THREE.Vector3().crossVectors(lS.clone().sub(rS).setY(0).normalize(), up).normalize();

    // geometry is shared with the cached glTF scene: work on a private copy
    const geo = sm.geometry.clone();
    sm.geometry = geo;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const si = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
    const sw = geo.getAttribute('skinWeight') as THREE.BufferAttribute;
    const n = pos.count;
    const S: THREE.Vector3[] = new Array(n);
    const member: number[] = [];
    const tieY = hS.y + o.tieAbove;
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(sm.bindMatrix);
      S[i] = p;
      let hw = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === hi) hw += sw.getComponent(i, k);
      const back = -_a.copy(p).sub(hS).dot(fwd);
      if (hw > 0.3 && back > o.behind && p.y < tieY) member.push(i);
    }
    if (member.length < 20) throw new Error(`[ponytail] only ${member.length} ponytail vertices found`);
    let yBot = Infinity;
    for (const i of member) yBot = Math.min(yBot, S[i].y);
    const span = tieY - yBot;
    // chain joints on the strand centre line (tip joint = end of the last bone)
    const joints: THREE.Vector3[] = [];
    for (let k = 0; k <= segs; k++) {
      const y = tieY - (span * k) / segs;
      const slab = span / segs / 2;
      const c = new THREE.Vector3();
      let m = 0;
      for (const i of member) {
        if (Math.abs(S[i].y - y) < slab) { c.add(S[i]); m++; }
      }
      if (!m) throw new Error('[ponytail] empty chain slab');
      c.multiplyScalar(1 / m).setY(y);
      joints.push(c);
    }
    // bones: rest orientation = head's, positioned on the joints
    const B = joints.map((j) => headS.clone().setPosition(j));
    const inverses: THREE.Matrix4[] = [];
    let parent: THREE.Bone = head, parentS = headS;
    for (let k = 0; k <= segs; k++) {
      const b = new THREE.Bone();
      b.name = `hair_${k}`;
      const local = parentS.clone().invert().multiply(B[k]);
      local.decompose(b.position, b.quaternion, b.scale);
      parent.add(b);
      this.bones.push(b);
      this.restQ.push(b.quaternion.clone());
      inverses.push(B[k].clone().invert());
      parent = b;
      parentS = B[k];
    }
    const base = skel.bones.length;
    // re-skin: vertex at chain parameter t (0 = tie, segs = tip) blends the two nearest bone centres (k + 0.5);
    // above the first centre it blends into the head
    for (const i of member) {
      const t = THREE.MathUtils.clamp(((tieY - S[i].y) / span) * segs, 0, segs - 1e-3);
      const c = t - 0.5;
      let i0: number, i1: number, f: number;
      if (c < 0) {
        // between the tie and the first bone centre: fade from the head (rigid tie) into the chain
        i0 = hi; i1 = base; f = t / 0.5;
      } else {
        const k0 = Math.floor(c);
        f = c - k0;
        i0 = base + k0;
        i1 = base + Math.min(segs - 1, k0 + 1);
      }
      si.setXYZW(i, i0, i1, 0, 0);
      sw.setXYZW(i, 1 - f, f, 0, 0);
    }
    si.needsUpdate = true;
    sw.needsUpdate = true;
    this.vertexCount = member.length;
    const skel2 = new THREE.Skeleton([...skel.bones, ...this.bones], [...skel.boneInverses, ...inverses]);
    sm.bind(skel2, sm.bindMatrix);

    // body capsules along the spine and skull; radius = how far the body reaches backward at that height
    ch.root.updateMatrixWorld(true);
    const wScale = head.getWorldPosition(_a).distanceTo(hips.getWorldPosition(_b)) / hS.distanceTo(posS(hips)!);
    this.thick = (o.thickness ?? 0.02) * wScale;
    const memberSet = new Set(member);
    const side = new THREE.Vector3().crossVectors(fwd, up);
    const reachBack = (yLo: number, yHi: number, axis: THREE.Vector3) => {
      let r = 0;
      for (let i = 0; i < n; i++) {
        if (memberSet.has(i)) continue;
        const p = S[i];
        if (p.y < yLo || p.y > yHi) continue;
        const d = _c.copy(p).sub(axis);
        if (Math.abs(d.dot(side)) > 0.09) continue; // only the body's centre strip (not arms / sleeves)
        r = Math.max(r, -d.dot(fwd));
      }
      return r;
    };
    const chain = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck'].map((c) => ch.bone(c)).filter((b): b is THREE.Bone => !!b);
    for (let k = 0; k + 1 < chain.length; k++) {
      const a = posS(chain[k])!, b = posS(chain[k + 1])!;
      const r = Math.max(reachBack(a.y, b.y, a), reachBack(a.y, b.y, b));
      this.caps.push({ a: chain[k], b: chain[k + 1], bOffset: new THREE.Vector3(), r: r * wScale });
    }
    // skull: neck joint -> top of the head (local offset of the top expressed in the head bone's frame)
    const neck = chain[chain.length - 1];
    const topS = hS.clone().addScaledVector(up, o.tieAbove);
    const topLocal = topS.clone().applyMatrix4(headS.clone().invert());
    const skullAxis = hS.clone().addScaledVector(up, o.tieAbove * 0.5);
    this.caps.push({ a: neck, b: head, bOffset: topLocal, r: reachBack(hS.y - 0.02, tieY, skullAxis) * wScale });
  }

  /** forget the simulated state (teleport / mode switch): next update snaps to the animated shape */
  reset() {
    this.live = false;
  }

  /** run after the skeleton's world matrices are current for this frame */
  update(dt: number) {
    const bones = this.bones, N = bones.length;
    for (let k = 0; k < N; k++) bones[k].quaternion.copy(this.restQ[k]);
    bones[0].updateMatrixWorld(true);
    for (let k = 0; k < N; k++) {
      if (!this.target[k]) this.target[k] = new THREE.Vector3();
      bones[k].getWorldPosition(this.target[k]);
    }
    if (!this.live || this.target[0].distanceTo(this.x[0] ?? this.target[0]) > 1.0) {
      for (let k = 0; k < N; k++) {
        this.x[k] = this.target[k].clone();
        this.px[k] = this.target[k].clone();
        if (k) this.len[k] = this.target[k].distanceTo(this.target[k - 1]);
      }
      this.live = true;
    } else {
      // gameplay snaps the facing (dodge, hit reaction, start of a cut): carry the strand round with the body
      const dy = angleDiff(this.prevYaw, this.yawOf());
      if (Math.abs(dy) > SNAP_YAW) {
        this.root.getWorldPosition(_d);
        for (let k = 1; k < N; k++) {
          for (const v of [this.x[k], this.px[k]]) v.sub(_d).applyAxisAngle(UP, dy).add(_d);
        }
      }
    }
    this.prevYaw = this.yawOf();
    if (dt > 0) {
      this.acc = Math.min(this.acc + dt, 0.1);
      const g = -9.8 * STEP * STEP;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        this.x[0].copy(this.target[0]);
        this.px[0].copy(this.target[0]);
        for (let k = 1; k < N; k++) {
          const x = this.x[k], p = this.px[k];
          _a.subVectors(x, p).multiplyScalar(this.damp);
          p.copy(x);
          x.add(_a);
          x.y += g;
          const s = THREE.MathUtils.lerp(this.stiff[0], this.stiff[1], (k - 1) / Math.max(1, N - 2));
          x.lerp(this.target[k], s);
        }
        for (let it = 0; it < 2; it++) {
          for (let k = 1; k < N; k++) {
            const x = this.x[k];
            _a.subVectors(x, this.x[k - 1]);
            const d = _a.length() || 1e-6;
            _a.multiplyScalar(1 / d);
            // never swing further than maxAngle away from the animated strand (no whipping over the shoulders,
            // no getting caught on the wrong side of the body)
            _b.subVectors(this.target[k], this.target[k - 1]).normalize();
            const maxA = THREE.MathUtils.lerp(MAX_ANGLE[0], MAX_ANGLE[1], (k - 1) / Math.max(1, N - 2));
            const ang = Math.acos(THREE.MathUtils.clamp(_a.dot(_b), -1, 1));
            if (ang > maxA) {
              _c.crossVectors(_b, _a);
              if (_c.lengthSq() < 1e-10) _c.set(1, 0, 0);
              _a.copy(_b).applyAxisAngle(_c.normalize(), maxA);
            }
            x.copy(this.x[k - 1]).addScaledVector(_a, this.len[k]);
            this.collide(x);
          }
        }
      }
    }
    // aim each chain bone at the next simulated point
    for (let k = 0; k < N - 1; k++) {
      const b = bones[k];
      b.getWorldPosition(_a);
      bones[k + 1].getWorldPosition(_b);
      const cur = _b.sub(_a).normalize();
      const want = _c.subVectors(this.x[k + 1], _a).normalize();
      _q.setFromUnitVectors(cur, want);
      b.getWorldQuaternion(_q2);
      _q2.premultiply(_q);
      b.parent!.getWorldQuaternion(_q).invert();
      b.quaternion.copy(_q.multiply(_q2));
      b.updateMatrixWorld(true);
    }
  }

  private collide(x: THREE.Vector3) {
    for (const c of this.caps) {
      c.a.getWorldPosition(_a);
      _b.copy(c.bOffset).applyMatrix4(c.b.matrixWorld);
      _c.subVectors(_b, _a);
      const t = THREE.MathUtils.clamp(_d.subVectors(x, _a).dot(_c) / Math.max(1e-6, _c.lengthSq()), 0, 1);
      const q = _a.addScaledVector(_c, t);
      _d.subVectors(x, q);
      const d = _d.length(), r = c.r + this.thick;
      if (d < r && d > 1e-6) x.copy(q).addScaledVector(_d, r / d);
    }
    if (x.y < this.groundY + this.thick) x.y = this.groundY + this.thick;
  }
}
