import * as THREE from 'three';

/** Runtime decoder for packs produced by tools/build-anims.mjs. */
export interface PackClip {
  name: string;
  frames: number;
  duration: number;
  loop: boolean;
  hipsRestY: number;
  tracks: { bone: string; type: 'q' | 'p'; offset: number }[];
  root?: number;
}
export interface PackIndex {
  version: number;
  fps: number;
  clips: PackClip[];
}

export interface DecodedClip {
  clip: THREE.AnimationClip;
  loop: boolean;
  /** Root (XZ) displacement in target-model local units, sampled at fps. */
  root: Float32Array | null;
  fps: number;
  /** Peak right-hand speed time (s) computed later by Character. */
  name: string;
}

export class AnimPack {
  constructor(public index: PackIndex, public bin: ArrayBuffer) {}

  has(name: string) {
    return this.index.clips.some((c) => c.name === name);
  }

  /**
   * Build an AnimationClip for a specific skeleton.
   * boneMap: canonical bone name (e.g. 'Hips') -> node name in the target model.
   * hipsRestY: the target skeleton's Hips rest local Y (for scaling hips translation).
   */
  decode(name: string, boneMap: Map<string, string>, targetHipsRestY: number, opts?: { speed?: number }): DecodedClip {
    const c = this.index.clips.find((x) => x.name === name);
    if (!c) throw new Error('[anim] missing clip ' + name);
    const fps = this.index.fps;
    const n = c.frames;
    const speed = opts?.speed ?? 1;
    const times = new Float32Array(n);
    for (let i = 0; i < n; i++) times[i] = i / fps / speed;
    const tracks: THREE.KeyframeTrack[] = [];
    const s = targetHipsRestY / c.hipsRestY;
    for (const tr of c.tracks) {
      const node = boneMap.get(tr.bone);
      if (!node) continue;
      if (tr.type === 'q') {
        const q = new Int16Array(this.bin, tr.offset, n * 4);
        const v = new Float32Array(n * 4);
        for (let i = 0; i < n * 4; i++) v[i] = q[i] / 32767;
        tracks.push(new THREE.QuaternionKeyframeTrack(node + '.quaternion', times, v));
      } else {
        const p = new Float32Array(this.bin, tr.offset, n * 3);
        const v = new Float32Array(n * 3);
        for (let i = 0; i < n * 3; i++) v[i] = p[i] * s;
        tracks.push(new THREE.VectorKeyframeTrack(node + '.position', times, v));
      }
    }
    let root: Float32Array | null = null;
    if (c.root != null) {
      const r = new Float32Array(this.bin, c.root, n * 2);
      root = new Float32Array(n * 2);
      for (let i = 0; i < n * 2; i++) root[i] = r[i] * s;
    }
    const clip = new THREE.AnimationClip(name, c.duration / speed, tracks);
    return { clip, loop: c.loop, root, fps: fps * speed, name };
  }
}

export function canonicalBone(name: string): string {
  return name.replace(/^.*mixamorig[:_]?/i, '').replace(/^.*:/, '');
}
