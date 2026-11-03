import * as THREE from 'three';
import type { AnimPack, DecodedClip } from '../core/animpack';
import type { Character } from './character';

/**
 * Rest-pose-aware retargeting (not bone renaming).
 * For each frame: D = W_src(t) * W_src_rest^-1 (world-space rotation of every source bone away from its rest),
 * W_dst(t) = D * A * W_dst_rest, where A aligns the target rest pose to the source rest pose (bone direction +
 * a secondary axis for hips/chest/hands so twist and palm orientation carry over), then
 * local_dst = W_dst(parent)^-1 * W_dst. Hips translation is transferred as a world displacement scaled by hip height.
 */

export type BoneMap = Record<string, string>; // canonical (Mixamo) -> target node name

// canonical -> [primary child, secondary pair for side axis]
const AXES: Record<string, { child: string; side?: [string, string] }> = {
  Hips: { child: 'Spine', side: ['LeftUpLeg', 'RightUpLeg'] },
  Spine: { child: 'Spine1' },
  Spine1: { child: 'Spine2' },
  Spine2: { child: 'Neck', side: ['LeftShoulder', 'RightShoulder'] },
  Neck: { child: 'Head' },
  LeftShoulder: { child: 'LeftArm' },
  LeftArm: { child: 'LeftForeArm' },
  LeftForeArm: { child: 'LeftHand' },
  LeftHand: { child: 'LeftHandMiddle1', side: ['LeftHandIndex1', 'LeftHandPinky1'] },
  RightShoulder: { child: 'RightArm' },
  RightArm: { child: 'RightForeArm' },
  RightForeArm: { child: 'RightHand' },
  RightHand: { child: 'RightHandMiddle1', side: ['RightHandIndex1', 'RightHandPinky1'] },
  LeftUpLeg: { child: 'LeftLeg' },
  LeftLeg: { child: 'LeftFoot' },
  LeftFoot: { child: 'LeftToeBase' },
  RightUpLeg: { child: 'RightLeg' },
  RightLeg: { child: 'RightFoot' },
  RightFoot: { child: 'RightToeBase' },
};
for (const s of ['Left', 'Right'])
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
    AXES[`${s}Hand${f}1`] = { child: `${s}Hand${f}2` };
    AXES[`${s}Hand${f}2`] = { child: `${s}Hand${f}3` };
  }

interface Rig {
  root: THREE.Object3D; // mini hierarchy root (character space)
  bones: Map<string, THREE.Object3D>; // node name -> object
  canon: Map<string, THREE.Object3D>; // canonical -> object
}

/** Copy only the bone hierarchy (with the static ancestors baked) into a lightweight tree in character space. */
function miniRig(ch: Character, canonToNode: Map<string, string>): Rig {
  ch.root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(ch.root.matrixWorld).invert();
  const hips = ch.bone('Hips')!;
  const top = new THREE.Object3D();
  const hp = hips.parent!;
  const rel = rootInv.clone().multiply(hp.matrixWorld);
  rel.decompose(top.position, top.quaternion, top.scale);
  const bones = new Map<string, THREE.Object3D>();
  const copy = (src: THREE.Object3D, parent: THREE.Object3D) => {
    if (!(src as THREE.Bone).isBone) return;
    const b = new THREE.Bone();
    b.name = src.name;
    b.position.copy(src.position);
    b.quaternion.copy(src.quaternion);
    b.scale.copy(src.scale);
    parent.add(b);
    bones.set(src.name, b);
    for (const c of src.children) copy(c, b);
  };
  copy(hips, top);
  top.updateMatrixWorld(true);
  const canon = new Map<string, THREE.Object3D>();
  for (const [c, n] of canonToNode) {
    const o = bones.get(n);
    if (o) canon.set(c, o);
  }
  return { root: top, bones, canon };
}

const wq = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());
const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

function basis(rig: Rig, c: string): THREE.Quaternion | null {
  const ax = AXES[c];
  const b = rig.canon.get(c);
  if (!ax || !b) return null;
  const ch = rig.canon.get(ax.child);
  if (!ch) return null;
  const y = wp(ch).sub(wp(b)).normalize();
  let x: THREE.Vector3;
  if (ax.side) {
    const a = rig.canon.get(ax.side[0]), d = rig.canon.get(ax.side[1]);
    if (!a || !d) return null;
    x = wp(d).sub(wp(a));
  } else {
    // stable secondary axis: world forward (+Z) unless nearly parallel
    x = new THREE.Vector3(0, 0, 1).cross(y);
    if (x.lengthSq() < 1e-4) x.set(1, 0, 0);
  }
  x.addScaledVector(y, -x.dot(y)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export class Retargeter {
  private src: Rig;
  private dst: Rig;
  private dstOrder: THREE.Object3D[] = [];
  private align = new Map<string, THREE.Quaternion>(); // canonical -> A (world)
  private srcRest = new Map<string, THREE.Quaternion>();
  private dstRest = new Map<THREE.Object3D, THREE.Quaternion>();
  private dstCanonOf = new Map<THREE.Object3D, string>();
  private hipsScale = 1;
  private srcHipsRest = new THREE.Vector3();
  private dstHipsRest = new THREE.Vector3();
  private srcMixer: THREE.AnimationMixer;

  constructor(public srcCh: Character, public dstCh: Character, dstMap: BoneMap, opts: { headFromChest?: boolean } = {}) {
    const srcCanon = new Map<string, string>(srcCh.boneMap);
    const dstCanon = new Map<string, string>(Object.entries(dstMap));
    this.src = miniRig(srcCh, srcCanon);
    this.dst = miniRig(dstCh, dstCanon);
    this.srcMixer = new THREE.AnimationMixer(this.src.root);
    for (const [c, o] of this.dst.canon) this.dstCanonOf.set(o, c);
    this.dst.root.traverse((o) => {
      if (o !== this.dst.root) this.dstOrder.push(o);
    });
    for (const o of this.dstOrder) this.dstRest.set(o, wq(o));
    for (const [c, o] of this.src.canon) this.srcRest.set(c, wq(o));
    // alignment per canonical bone: A = B_src * B_dst^-1 (falls back to parent's alignment)
    const order = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'];
    for (const s of ['Left', 'Right']) for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) for (const k of [1, 2, 3]) order.push(`${s}Hand${f}${k}`);
    const parentCanon = (c: string) => {
      const o = this.dst.canon.get(c);
      let p = o?.parent;
      while (p && !this.dstCanonOf.has(p)) p = p.parent;
      return p ? this.dstCanonOf.get(p)! : null;
    };
    for (const c of order) {
      if (!this.dst.canon.has(c) || !this.src.canon.has(c)) continue;
      const bs = basis(this.src, c), bd = basis(this.dst, c);
      if (bs && bd) this.align.set(c, bs.clone().multiply(bd.clone().invert()));
      else {
        const pc = parentCanon(c);
        this.align.set(c, pc && this.align.get(pc) ? this.align.get(pc)!.clone() : new THREE.Quaternion());
      }
    }
    // Auto-rigs often put the head joint low and behind the neck joint (here 33 deg backward of vertical). Aligning
    // that neck->head line with the Mixamo one pitches the whole head forward, so the character stares at the floor
    // in every clip. Both rest poses hold the head upright, so neck and head simply follow the chest alignment.
    if (opts.headFromChest && this.align.has('Spine2')) {
      for (const c of ['Neck', 'Head']) if (this.align.has(c)) this.align.set(c, this.align.get('Spine2')!.clone());
    }
    const sh = this.src.canon.get('Hips')!, dh = this.dst.canon.get('Hips')!;
    this.srcHipsRest.copy(wp(sh));
    this.dstHipsRest.copy(wp(dh));
    const footS = this.src.canon.get('LeftFoot'), footD = this.dst.canon.get('LeftFoot');
    const legS = footS ? this.srcHipsRest.y - wp(footS).y : 1;
    const legD = footD ? this.dstHipsRest.y - wp(footD).y : 1;
    this.hipsScale = legD / legS;
  }

  /** decode a pack clip for the source, then bake it onto the target skeleton */
  retarget(pack: AnimPack, name: string): DecodedClip {
    const sd = pack.decode(name, this.srcCh.boneMap, this.srcCh.hipsRestY);
    const clip = sd.clip;
    const fps = sd.fps;
    const n = Math.max(2, Math.round(clip.duration * fps) + 1);
    const action = this.srcMixer.clipAction(clip);
    action.play();
    const times = new Float32Array(n);
    const qOut = new Map<THREE.Object3D, Float32Array>();
    for (const o of this.dst.canon.values()) qOut.set(o, new Float32Array(n * 4));
    const hipsOut = new Float32Array(n * 3);
    const W = new Map<THREE.Object3D, THREE.Quaternion>();
    const tq = new THREE.Quaternion(), d = new THREE.Quaternion();
    const dHips = this.dst.canon.get('Hips')!;
    const dHipsParentW = wq(dHips.parent!);
    const dHipsParentInv = new THREE.Matrix4().copy(dHips.parent!.matrixWorld).invert();
    for (let i = 0; i < n; i++) {
      const t = Math.min(clip.duration - 1e-4, i / fps);
      times[i] = t;
      this.srcMixer.setTime(t);
      this.src.root.updateMatrixWorld(true);
      W.clear();
      for (const o of this.dstOrder) {
        const c = this.dstCanonOf.get(o);
        const parentW = o.parent === this.dst.root ? dHipsParentW : W.get(o.parent!)!;
        let world: THREE.Quaternion;
        if (c && this.src.canon.has(c)) {
          d.copy(wq(this.src.canon.get(c)!)).multiply(tq.copy(this.srcRest.get(c)!).invert());
          world = d.clone().multiply(this.align.get(c)!).multiply(this.dstRest.get(o)!);
        } else {
          world = parentW.clone().multiply(o.quaternion); // unmapped bones keep their rest local
        }
        W.set(o, world);
        const out = qOut.get(o);
        if (out) {
          const local = parentW.clone().invert().multiply(world);
          out[i * 4] = local.x;
          out[i * 4 + 1] = local.y;
          out[i * 4 + 2] = local.z;
          out[i * 4 + 3] = local.w;
        }
      }
      // hips translation: world displacement scaled by leg length, expressed in the target hips parent space
      const disp = wp(this.src.canon.get('Hips')!).sub(this.srcHipsRest).multiplyScalar(this.hipsScale);
      const p = this.dstHipsRest.clone().add(disp).applyMatrix4(dHipsParentInv);
      hipsOut[i * 3] = p.x;
      hipsOut[i * 3 + 1] = p.y;
      hipsOut[i * 3 + 2] = p.z;
    }
    action.stop();
    this.srcMixer.uncacheClip(clip);
    const tracks: THREE.KeyframeTrack[] = [];
    for (const [o, arr] of qOut) tracks.push(new THREE.QuaternionKeyframeTrack(o.name + '.quaternion', times, arr));
    tracks.push(new THREE.VectorKeyframeTrack(dHips.name + '.position', times, hipsOut));
    const out = new THREE.AnimationClip(name, clip.duration, tracks);
    // root motion: source root (src local units) -> world meters -> target local units
    let root: Float32Array | null = null;
    if (sd.root) {
      const k = (this.srcCh.modelScale * this.srcCh.modelUnit() * this.hipsScale) / (this.dstCh.modelScale * this.dstCh.modelUnit());
      root = new Float32Array(sd.root.length);
      for (let i = 0; i < root.length; i++) root[i] = sd.root[i] * k;
    }
    return { clip: out, loop: sd.loop, root, fps, name };
  }
}

/** joint mapping for the auto-rigged gatekeeper (SkinTokens rig, faces +X, left side on -Z); derived from hierarchy + joint positions */
export const GUARDIAN_MAP: BoneMap = skinTokensMap({ spine: [1, 2, 4], neck: 5, head: 6, leftArm: 7, rightArm: 26, leftLeg: 45, rightLeg: 49 });

/**
 * joint mapping for the round-11 heroine (generated from the loading-poster design, SkinTokens auto-rig, 52 joints,
 * faces +Z, A-pose); derived from hierarchy + joint positions: bone_6..24 sit on +X (her left), toes point +Z
 */
export const HEROINE2_MAP: BoneMap = skinTokensMap({ spine: [1, 2, 3], neck: 4, head: 5, leftArm: 6, rightArm: 25, leftLeg: 44, rightLeg: 48 });

function skinTokensMap(o: { spine: [number, number, number]; neck: number; head: number; leftArm: number; rightArm: number; leftLeg: number; rightLeg: number }): BoneMap {
  const m: BoneMap = { Hips: 'bone_0', Spine: `bone_${o.spine[0]}`, Spine1: `bone_${o.spine[1]}`, Spine2: `bone_${o.spine[2]}`, Neck: `bone_${o.neck}`, Head: `bone_${o.head}` };
  const arm = (side: string, base: number) => {
    m[`${side}Shoulder`] = `bone_${base}`;
    m[`${side}Arm`] = `bone_${base + 1}`;
    m[`${side}ForeArm`] = `bone_${base + 2}`;
    m[`${side}Hand`] = `bone_${base + 3}`;
    ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].forEach((f, k) => {
      for (let j = 0; j < 3; j++) m[`${side}Hand${f}${j + 1}`] = `bone_${base + 4 + k * 3 + j}`;
    });
  };
  arm('Left', o.leftArm);
  arm('Right', o.rightArm);
  const leg = (side: string, base: number) => {
    m[`${side}UpLeg`] = `bone_${base}`;
    m[`${side}Leg`] = `bone_${base + 1}`;
    m[`${side}Foot`] = `bone_${base + 2}`;
    m[`${side}ToeBase`] = `bone_${base + 3}`;
  };
  leg('Left', o.leftLeg);
  leg('Right', o.rightLeg);
  return m;
}
