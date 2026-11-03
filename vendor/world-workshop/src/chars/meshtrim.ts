import * as THREE from 'three';
import type { Character } from './character';

/**
 * Drop the triangles whose three corners all lie inside an axis-aligned box given in the mesh's bind space
 * (glTF units, model facing +Z). Used to trim geometry the image-to-3D model fused onto the body, e.g. the long
 * side lock of the generated heroine that hung over her right shoulder and chest and moved with the torso: the
 * armour modelled behind it stays, so the cut shows a clean breastplate and a shoulder-length lock at the face.
 * Works on a private copy of the geometry (the cached glTF scene is not modified). Returns the triangles removed.
 */
export function trimRegion(ch: Character, box: { min: [number, number, number]; max: [number, number, number] }) {
  const sm = ch.meshes[0];
  if (!sm || !sm.geometry.index) throw new Error('[trimRegion] needs an indexed skinned mesh');
  const geo = sm.geometry.clone();
  sm.geometry = geo;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const b = new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max));
  const inside = new Uint8Array(pos.count);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) inside[i] = b.containsPoint(p.fromBufferAttribute(pos, i).applyMatrix4(sm.bindMatrix)) ? 1 : 0;
  const src = geo.index!.array;
  const keep: number[] = [];
  let removed = 0;
  for (let t = 0; t < src.length; t += 3) {
    if (inside[src[t]] && inside[src[t + 1]] && inside[src[t + 2]]) { removed++; continue; }
    keep.push(src[t], src[t + 1], src[t + 2]);
  }
  geo.setIndex(keep);
  geo.clearGroups();
  return removed;
}
