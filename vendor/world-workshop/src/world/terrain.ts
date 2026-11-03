import * as THREE from 'three';
import { heightAt, surfaceAt } from './layout';

export interface TerrainTextures {
  [k: string]: THREE.Texture;
}

/**
 * Heightfield terrain with a 5-layer splat material.
 * Layers are sampled in world meters: paving setts 1.6 m tile, gravel 2.2 m, mud 3 m, moss 3.4 m, leaf litter 2.4 m,
 * with a rotated second tap blended by noise to break visible repetition (no stamped patterns).
 */
export function buildTerrain(tex: TerrainTextures, quality: 'high' | 'low') {
  const size = 150;
  const seg = quality === 'high' ? 240 : 150;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(-1, 0, 4);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const masks = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    const s = surfaceAt(x, z);
    masks[i * 4] = s.paving;
    masks[i * 4 + 1] = s.path;
    masks[i * 4 + 2] = s.moss;
    masks[i * 4 + 3] = s.leaves;
  }
  geo.setAttribute('splat', new THREE.BufferAttribute(masks, 4));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = {
    tPaveC: { value: tex.paving_color }, tPaveN: { value: tex.paving_normal },
    tGravC: { value: tex.gravel_color }, tGravN: { value: tex.gravel_normal },
    tMudC: { value: tex.mud_color }, tMudN: { value: tex.mud_normal },
    tMossC: { value: tex.moss_color }, tMossN: { value: tex.moss_normal },
    tLeafC: { value: tex.pleaf_color }, tLeafN: { value: tex.pleaf_normal },
    tRockC: { value: tex.cliff_color }, tRockN: { value: tex.cliff_normal },
    uWet: { value: 0.55 },
    uTime: { value: 0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat; varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNrm;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvSplat = splat; vWPos = (modelMatrix * vec4(transformed,1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tPaveC, tPaveN, tGravC, tGravN, tMudC, tMudN, tMossC, tMossN, tLeafC, tLeafN, tRockC, tRockN;
        // triplanar sample for steep banks: no stretched UVs on slopes
        vec3 triW(vec3 n){ vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
        vec3 triC(sampler2D t, vec3 p, vec3 w, float s){ return texture2D(t, p.zy/s).rgb*w.x + texture2D(t, p.xz/s).rgb*w.y + texture2D(t, p.xy/s).rgb*w.z; }
        uniform float uWet; uniform float uTime;
        varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNrm;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
        float fbm2(vec2 p){ return vn(p)*0.5 + vn(p*2.03)*0.25 + vn(p*4.1)*0.125; }
        // two taps (second rotated & offset) blended by low-frequency noise to break tiling
        vec4 tap2(sampler2D t, vec2 uv, float k){ vec2 r = mat2(0.8,-0.6,0.6,0.8)*uv*0.83 + vec2(0.37,0.11);
          return mix(texture2D(t, uv), texture2D(t, r), k); }
        vec3 nrm2(sampler2D t, vec2 uv, float k){ vec2 r = mat2(0.8,-0.6,0.6,0.8)*uv*0.83 + vec2(0.37,0.11);
          vec3 a = texture2D(t, uv).xyz*2.0-1.0; vec3 b = texture2D(t, r).xyz*2.0-1.0;
          b.xy = mat2(0.8,0.6,-0.6,0.8)*b.xy; return normalize(mix(a,b,k)); }`,
      )
      .replace(
        '#include <map_fragment>',
        `vec2 wp = vWPos.xz;
        float k = smoothstep(0.35, 0.65, fbm2(wp*0.07));
        vec4 sp = clamp(vSplat, 0.0, 1.0);
        // per-pixel edge breakup
        float nb = fbm2(wp*0.9);
        sp.x = smoothstep(0.25, 0.75, sp.x + (nb-0.5)*0.35);
        sp.y = smoothstep(0.2, 0.8, sp.y + (nb-0.5)*0.4);
        vec3 cMud = tap2(tMudC, wp/3.0, k).rgb;
        vec3 cMoss = tap2(tMossC, wp/3.4, k).rgb;
        vec3 cLeaf = tap2(tLeafC, wp/2.4, k).rgb;
        vec3 cGrav = tap2(tGravC, wp/2.2, k).rgb;
        vec3 cPave = texture2D(tPaveC, wp/1.6).rgb;
        // paving: per-sett tint variation so setts do not read as one stamp
        vec2 cell = floor(wp/1.6*8.0);
        cPave *= 0.86 + 0.24*h21(cell);
        vec3 col = cMud;
        col = mix(col, cLeaf, sp.w);
        col = mix(col, cMoss, sp.z);
        col = mix(col, cGrav*vec3(0.6,0.57,0.52), sp.y);
        col = mix(col, cPave, sp.x);
        // moss creeping into paving joints at the yard edge
        float joint = 1.0 - smoothstep(0.0, 0.18, dot(cPave, vec3(0.333)));
        col = mix(col, cMoss*0.8, sp.x*joint*0.35*smoothstep(0.4,0.8,fbm2(wp*0.25)));
        // wetness after rain: darker, more saturated in low/flat areas; puddles in the yard
        float flatK = smoothstep(0.85, 0.98, vWNrm.y);
        float puddle = sp.x * flatK * smoothstep(0.58, 0.66, fbm2(wp*0.18 + 4.0)) ;
        float wet = clamp(uWet * (0.55 + 0.45*flatK) + puddle, 0.0, 1.0);
        col *= mix(1.0, 0.68, wet);
        // steep banks: blend to triplanar rock so slopes never show stretched ground textures
        float steep = 1.0 - smoothstep(0.62, 0.84, vWNrm.y);
        vec3 tw = triW(normalize(vWNrm));
        if (steep > 0.001) col = mix(col, triC(tRockC, vWPos, tw, 3.2) * vec3(0.95, 0.93, 0.88), steep);
        diffuseColor.rgb *= col;
        float tRough = mix(0.92, 0.42, wet);
        tRough = mix(tRough, 0.06, puddle);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = tRough;',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
          vec3 nMud = nrm2(tMudN, wp/3.0, k), nMoss = nrm2(tMossN, wp/3.4, k), nLeaf = nrm2(tLeafN, wp/2.4, k);
          vec3 nGrav = nrm2(tGravN, wp/2.2, k), nPave = texture2D(tPaveN, wp/1.6).xyz*2.0-1.0;
          vec3 tn = nMud; tn = mix(tn, nLeaf, sp.w); tn = mix(tn, nMoss, sp.z); tn = mix(tn, nGrav, sp.y); tn = mix(tn, nPave*vec3(1.4,1.4,1.0), sp.x);
          tn = mix(tn, vec3(0.0, 0.0, 1.0), steep * 0.85); // rock relief comes from the triplanar albedo; avoid stretched normals
          tn.xy *= (1.0 - puddle*0.9);
          // world-space TBN for a heightfield: T=+X, B=-Z (uv.y = -z after rotateX), N=surface normal
          vec3 N = normalize(vWNrm); vec3 T = normalize(vec3(1.0,0.0,0.0) - N*N.x); vec3 B = cross(N, T);
          vec3 nw = normalize(T*tn.x + B*tn.y + N*tn.z);
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'ww-terrain';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return { mesh, uniforms };
}
