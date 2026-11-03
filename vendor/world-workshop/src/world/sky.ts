import * as THREE from 'three';
import { mulberry } from './util';

export const ATMOS = {
  sunDir: new THREE.Vector3(-0.66, 0.3, 0.5).normalize(), // low dusk sun from the west-southwest
  sunColor: new THREE.Color(1.0, 0.6, 0.34),
  skyTop: new THREE.Color(0.2, 0.27, 0.38),
  skyHorizon: new THREE.Color(0.72, 0.62, 0.55),
  fog: new THREE.Color(0.47, 0.5, 0.52),
  fogDensity: 0.0125,
};

/** Dusk-after-rain sky dome: gradient, sun glow, layered drifting clouds. */
export function buildSky() {
  const uniforms = {
    uSun: { value: ATMOS.sunDir.clone() },
    uSunColor: { value: ATMOS.sunColor.clone() },
    uTop: { value: ATMOS.skyTop.clone() },
    uHorizon: { value: ATMOS.skyHorizon.clone() },
    uFog: { value: ATMOS.fog.clone() },
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 uSun, uSunColor, uTop, uHorizon, uFog; uniform float uTime; varying vec3 vDir;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.07; a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        float sd = max(dot(d, normalize(uSun)), 0.0);
        vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.6, h), 0.7));
        // warm band toward the sun at the horizon
        col += uSunColor * pow(sd, 6.0) * 0.55 * (1.0 - smoothstep(0.0, 0.5, h));
        col += uSunColor * pow(sd, 120.0) * 1.6;
        col += vec3(1.0,0.86,0.7) * pow(sd, 1600.0) * 4.0;
        // clouds: projected onto a dome, drifting slowly
        vec2 cp = d.xz / max(0.08, d.y + 0.15) * 1.4 + vec2(uTime*0.006, uTime*0.002);
        float c = fbm(cp*0.8);
        c = smoothstep(0.42, 0.78, c) * smoothstep(0.0, 0.25, h);
        vec3 cloudLit = mix(vec3(0.32,0.34,0.4), uSunColor*1.05, pow(sd, 3.0)*0.8 + 0.15);
        col = mix(col, cloudLit, c * 0.75);
        // below horizon fade into fog color
        col = mix(col, uFog, smoothstep(0.06, -0.12, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, uniforms };
}

/** Distant mountain ridge layers fading into haze (aerial perspective). */
export function buildRidges() {
  const group = new THREE.Group();
  const rnd = mulberry(77);
  const layers = [
    { r: 150, h: 46, col: new THREE.Color(0.33, 0.37, 0.4), arc: [0.6, 5.7] },
    { r: 240, h: 85, col: new THREE.Color(0.42, 0.45, 0.49), arc: [0.0, 6.28] },
    { r: 380, h: 135, col: new THREE.Color(0.53, 0.54, 0.56), arc: [0.0, 6.28] },
  ];
  for (const L of layers) {
    const seg = 220;
    const pos: number[] = [], col: number[] = [];
    const phase = rnd() * 100;
    for (let i = 0; i <= seg; i++) {
      const a = L.arc[0] + ((L.arc[1] - L.arc[0]) * i) / seg;
      const n = Math.sin(a * 3 + phase) * 0.35 + Math.sin(a * 7.3 + phase * 2) * 0.22 + Math.sin(a * 17 + phase) * 0.08 + Math.sin(a * 41) * 0.03;
      const top = L.h * (0.55 + n * 0.6);
      const x = Math.sin(a) * L.r, z = Math.cos(a) * L.r;
      pos.push(x, -20, z, x, top, z);
      col.push(L.col.r, L.col.g, L.col.b, L.col.r * 1.04, L.col.g * 1.04, L.col.b * 1.06);
    }
    const idx: number[] = [];
    for (let i = 0; i < seg; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false, depthWrite: true }));
    m.renderOrder = -5;
    group.add(m);
  }
  return group;
}

/**
 * Layered mist + light-shaft cards. Renderer has no native volumetrics, so this uses depth-faded noise cards
 * (soft particles) for valley/hill fog and additive, noise-modulated beams for sun shafts through the canopy.
 */
export function buildAtmosphereCards(depthTex: THREE.DepthTexture | null) {
  const group = new THREE.Group();
  const uniforms = {
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color(0.62, 0.64, 0.66) },
    uSunColor: { value: ATMOS.sunColor.clone() },
    uIntensity: { value: 1 },
  };
  const mistMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform float uTime, uIntensity; uniform vec3 uFogColor, uSunColor; varying vec2 vUv; varying vec3 vW;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
      float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.1; a*=0.5;} return s; }
      void main(){
        vec2 p = vW.xz*0.05 + vec2(uTime*0.012, uTime*0.004);
        float n = fbm(p) * fbm(p*1.7 + 3.0);
        float edge = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y) * smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
        float camFade = smoothstep(14.0, 45.0, distance(cameraPosition, vW));
        float a = smoothstep(0.1, 0.45, n) * edge * 0.32 * uIntensity * camFade;
        vec3 c = mix(uFogColor, uSunColor*0.9 + uFogColor*0.4, 0.18);
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
  });
  const rnd = mulberry(5);
  const mistSpots: [number, number, number, number, number, number][] = [
    // x, y, z, width, height, rotY
    [6, -3.5, 34, 60, 9, 0.2],
    [-22, 2.5, -20, 40, 10, 0.9],
    [18, 6, -30, 44, 10, -0.6],
    [-6, 9, -42, 70, 12, 0.05],
    [30, 1, 12, 40, 8, -1.3],
    [-34, 0, 18, 46, 9, 1.4],
  ];
  for (const [x, y, z, w, h, ry] of mistSpots) {
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mistMat);
      m.position.set(x + (rnd() - 0.5) * 6, y + k * 2.5, z + (rnd() - 0.5) * 6);
      m.rotation.y = ry + (rnd() - 0.5) * 0.3;
      m.renderOrder = 3;
      group.add(m);
    }
  }
  // god rays: tall additive beams slanted along the sun direction through the east canopy and the yard
  const rayMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    vertexShader: `varying vec2 vUv; varying float vSeed; varying float vCam; attribute float seed; void main(){ vUv = uv; vSeed = seed; vec4 w = modelMatrix*vec4(position,1.0); vCam = distance(cameraPosition, w.xyz); gl_Position = projectionMatrix*viewMatrix*w;} `,
    fragmentShader: `
      uniform float uTime, uIntensity; uniform vec3 uSunColor; varying vec2 vUv; varying float vSeed; varying float vCam;
      void main(){
        float x = vUv.x;
        float beam = smoothstep(0.0, 0.35, x) * smoothstep(1.0, 0.65, x);
        float stripes = 0.55 + 0.45*sin(x*23.0 + vSeed*10.0 + uTime*0.3) * sin(x*7.0 - uTime*0.17 + vSeed*3.0);
        float fade = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
        float flick = 0.75 + 0.25*sin(uTime*0.6 + vSeed*12.0);
        float a = beam * stripes * fade * flick * 0.06 * uIntensity * smoothstep(3.0, 10.0, vCam);
        gl_FragColor = vec4(uSunColor * a, 1.0);
      }`,
  });
  const sun = ATMOS.sunDir;
  const rays: [number, number, number][] = [[13, 4, -1], [10, 5, 6], [-4, 6, -15], [4, 7, -19], [-14, 4, 4]];
  for (const [x, y, z] of rays) {
    for (let k = 0; k < 3; k++) {
      const g = new THREE.PlaneGeometry(1.6 + rnd() * 1.8, 16);
      const seed = new Float32Array(g.attributes.position.count).fill(rnd());
      g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
      const m = new THREE.Mesh(g, rayMat);
      m.position.set(x + (rnd() - 0.5) * 3, y, z + (rnd() - 0.5) * 3);
      // align the beam's long axis with the incoming sun direction
      const up = sun.clone();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      m.quaternion.copy(q);
      m.rotateY(rnd() * Math.PI);
      m.renderOrder = 4;
      group.add(m);
    }
  }
  void depthTex;
  return { group, uniforms };
}
