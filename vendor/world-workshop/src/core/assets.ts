import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { AnimPack, type PackIndex } from './animpack';

export type Progress = (ratio: number, label: string) => void;

/** bounded retry for transient network failures (CDN resets, many parallel requests) */
async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let err: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw err;
}

/** Loads every runtime asset relative to assetBase; tracks GPU resources for dispose(). */
export class Assets {
  gltf = new GLTFLoader();
  draco = new DRACOLoader();
  tex = new THREE.TextureLoader();
  models: Record<string, GLTF> = {};
  textures: Record<string, THREE.Texture> = {};
  packs: Record<string, AnimPack> = {};
  audio: Record<string, ArrayBuffer> = {};
  hdr: THREE.DataTexture | null = null;
  private total = 0;
  private done = 0;
  bytes = 0;

  constructor(public base: string, private onProgress: Progress) {
    if (!this.base.endsWith('/')) this.base += '/';
    this.draco.setDecoderPath(this.url('assets/draco/'));
    this.gltf.setDRACOLoader(this.draco);
  }

  url(p: string) {
    if (/^(https?:|data:|blob:)/.test(p)) return p;
    return this.base + p.replace(/^\.\//, '');
  }

  private tick(label: string) {
    this.done++;
    this.onProgress(this.done / Math.max(1, this.total), label);
  }

  model(key: string, path: string) {
    this.total++;
    return retry(() => this.gltf.loadAsync(this.url(path))).then((g) => {
      this.models[key] = g;
      this.tick(key);
      return g;
    });
  }

  texture(key: string, path: string, opts: { srgb?: boolean; repeat?: boolean; aniso?: number } = {}) {
    this.total++;
    return retry(() => this.tex.loadAsync(this.url(path))).then((t) => {
      if (opts.srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = opts.aniso ?? 8;
      this.textures[key] = t;
      this.tick(key);
      return t;
    });
  }

  pack(key: string, path: string) {
    this.total++;
    return Promise.all([
      retry(() => fetch(this.url(path + '.anim.json'))).then((r) => {
        if (!r.ok) throw new Error('anim pack ' + path + ' ' + r.status);
        return r.json() as Promise<PackIndex>;
      }),
      retry(() => fetch(this.url(path + '.anim.bin'))).then((r) => {
        if (!r.ok) throw new Error('anim bin ' + path + ' ' + r.status);
        return r.arrayBuffer();
      }),
    ]).then(([idx, bin]) => {
      this.bytes += bin.byteLength;
      this.packs[key] = new AnimPack(idx, bin);
      this.tick(key);
    });
  }

  sound(key: string, path: string) {
    // audio is optional: failures must not block the world
    return retry(() => fetch(this.url(path)))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        this.audio[key] = b;
      })
      .catch((e) => console.warn('[audio] skip', key, e.message));
  }

  hdri(path: string) {
    this.total++;
    return retry(() => new RGBELoader().loadAsync(this.url(path))).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      this.hdr = t;
      this.tick('sky');
    });
  }

  dispose() {
    for (const t of Object.values(this.textures)) t.dispose();
    this.hdr?.dispose();
    for (const g of Object.values(this.models)) {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mt of mats) disposeMaterial(mt);
        }
      });
    }
    this.draco.dispose();
    this.models = {};
    this.textures = {};
    this.packs = {};
    this.audio = {};
  }
}

export function disposeMaterial(mt: THREE.Material | undefined) {
  if (!mt) return;
  for (const k of Object.keys(mt)) {
    const v = (mt as unknown as Record<string, unknown>)[k];
    if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
  }
  mt.dispose();
}

export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mt of mats) disposeMaterial(mt);
    }
  });
}
