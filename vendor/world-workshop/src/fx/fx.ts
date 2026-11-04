import * as THREE from 'three';

/**
 * Ribbon trail sampled from the real weapon edge (base & tip world positions) every frame.
 * Visible only while `active` (attack windows) and fades out afterwards — never spawned per key press.
 */
export class WeaponTrail {
  mesh: THREE.Mesh;
  private n: number;
  private base: THREE.Vector3[] = [];
  private tip: THREE.Vector3[] = [];
  private age: number[] = [];
  private pos: Float32Array;
  private alpha: Float32Array;
  private geo: THREE.BufferGeometry;
  uniforms = { uColor: { value: new THREE.Color(0.75, 0.88, 1.0) }, uIntensity: { value: 1 } };
  active = false;
  life = 0.16;

  constructor(n = 28) {
    this.n = n;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    const uv = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      uv[i * 4] = i / (n - 1);
      uv[i * 4 + 1] = 0;
      uv[i * 4 + 2] = i / (n - 1);
      uv[i * 4 + 3] = 1;
      if (i < n - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `attribute float aAlpha; varying float vA; varying vec2 vUv; void main(){ vA = aAlpha; vUv = uv; gl_Position = projectionMatrix*viewMatrix*vec4(position,1.0);} `,
      fragmentShader: `uniform vec3 uColor; uniform float uIntensity; varying float vA; varying vec2 vUv;
        void main(){ float edge = pow(vUv.y, 2.2); float core = smoothstep(0.75, 1.0, vUv.y);
          float a = vA * (edge*0.8 + core*0.9) * uIntensity;
          gl_FragColor = vec4(uColor * (0.6 + core*1.2) * a, a); }`,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  push(base: THREE.Vector3, tip: THREE.Vector3, dt: number) {
    for (let i = 0; i < this.age.length; i++) this.age[i] += dt;
    if (this.active) {
      // subdivide between the previous and the new sample so fast swings stay smooth
      const pb = this.base[0], pt = this.tip[0];
      if (pb) {
        const steps = Math.min(4, Math.max(1, Math.round(pt.distanceTo(tip) / 0.08)));
        for (let s = 1; s < steps; s++) {
          const k = s / steps;
          this.base.unshift(pb.clone().lerp(base, k));
          this.tip.unshift(pt.clone().lerp(tip, k));
          this.age.unshift(dt * (1 - k));
        }
      }
      this.base.unshift(base.clone());
      this.tip.unshift(tip.clone());
      this.age.unshift(0);
    }
    while (this.base.length > this.n) {
      this.base.pop();
      this.tip.pop();
      this.age.pop();
    }
    while (this.age.length && this.age[this.age.length - 1] > this.life) {
      this.base.pop();
      this.tip.pop();
      this.age.pop();
    }
    const m = this.base.length;
    this.mesh.visible = m > 1;
    if (m < 2) return;
    for (let i = 0; i < this.n; i++) {
      const j = Math.min(i, m - 1);
      const b = this.base[j], t = this.tip[j];
      this.pos.set([b.x, b.y, b.z], i * 6);
      this.pos.set([t.x, t.y, t.z], i * 6 + 3);
      const a = i < m ? Math.max(0, 1 - this.age[j] / this.life) * (1 - i / this.n) : 0;
      this.alpha[i * 2] = a;
      this.alpha[i * 2 + 1] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.base = [];
    this.tip = [];
    this.age = [];
    this.mesh.visible = false;
  }
  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

interface Particle {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
  drag: number;
  grav: number;
  /** 0 = fade to nothing, 1 = shrink hard, 2 = cool from white to the tint (embers) */
  mode?: number;
  /** soft additive with a wide falloff (smoke, mist, glow) instead of a hot point */
  soft?: boolean;
}

/** Element identities used for slash arcs, trails, impacts and status bursts. */
export type Element = 'blade' | 'fire' | 'frost' | 'storm' | 'wood';

export const ELEMENT_COLOR: Record<Element, THREE.Color> = {
  blade: new THREE.Color(0.78, 0.9, 1.0),
  fire: new THREE.Color(1.0, 0.46, 0.14),
  frost: new THREE.Color(0.55, 0.86, 1.0),
  storm: new THREE.Color(0.62, 0.72, 1.0),
  wood: new THREE.Color(0.52, 0.95, 0.52),
};

/** CPU-simulated additive particles (sparks, embers, dust) + flash cards + expanding rings. */
export class Fx {
  group = new THREE.Group();
  private parts: Particle[] = [];
  private max = 600;
  private geo = new THREE.BufferGeometry();
  private posA: Float32Array;
  private colA: Float32Array;
  private sizeA: Float32Array;
  private points: THREE.Points;
  private flashes: { m: THREE.Mesh; t: number; max: number; s0: number; s1: number }[] = [];
  private rings: { m: THREE.Mesh; t: number; max: number; r1: number }[] = [];
  private arcs: { m: THREE.Mesh; t: number; max: number }[] = [];
  private ghosts: { g: THREE.Group; t: number; max: number }[] = [];
  private flashTex: THREE.Texture | null;
  private ringMat: THREE.ShaderMaterial;
  private dust: Particle[] = [];
  private blood: (Particle & { landed?: boolean })[] = [];
  private bMax = 260;
  private bGeo = new THREE.BufferGeometry();
  private bPos: Float32Array;
  private bCol: Float32Array;
  private bSize: Float32Array;
  private bPoints: THREE.Points;
  private splatMat: THREE.ShaderMaterial;
  private splats: { m: THREE.Mesh; t: number; max: number }[] = [];
  /** ground height for blood spatters (set by the workshop) */
  groundAt: (x: number, z: number) => number = () => 0;

  /**
   * Blood: a short directional spurt of dark droplets from the wound plus a fine mist, droplets that reach the
   * ground leave small spatters that fade after a few seconds.
   */
  bleed(at: THREE.Vector3, dir: THREE.Vector3, power = 1) {
    const n = Math.round(26 * power);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(1.5 + Math.random() * 3.5 * power)
        .addScaledVector(up, 0.6 + Math.random() * 2.2)
        .add(new THREE.Vector3((Math.random() - 0.5) * 1.8, 0, (Math.random() - 0.5) * 1.8));
      const dark = 0.16 + Math.random() * 0.12;
      this.addBlood({ p: at.clone(), v, life: 0, max: 0.6 + Math.random() * 0.5, size: 0.025 + Math.random() * 0.035, color: new THREE.Color(dark, 0.008, 0.01), drag: 1.2, grav: 9.8 });
    }
    for (let i = 0; i < 6; i++) {
      const v = dir.clone().multiplyScalar(0.6 + Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.5, (Math.random() - 0.5) * 0.8));
      this.addBlood({ p: at.clone(), v, life: 0, max: 0.35 + Math.random() * 0.2, size: 0.12 + Math.random() * 0.08, color: new THREE.Color(0.2, 0.015, 0.015), drag: 4, grav: 0.5, soft: true });
    }
  }

  private addBlood(p: Particle) {
    if (this.blood.length >= this.bMax) this.blood.shift();
    this.blood.push(p);
  }

  private splat(x: number, z: number, s: number) {
    if (this.splats.length > 40) {
      const old = this.splats.shift()!;
      this.group.remove(old.m);
      old.m.geometry.dispose();
      (old.m.material as THREE.Material).dispose();
    }
    const mat = this.splatMat.clone();
    mat.uniforms.uSeed.value = Math.random() * 100;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI * 2;
    m.position.set(x, this.groundAt(x, z) + 0.015, z);
    m.renderOrder = 2;
    this.group.add(m);
    this.splats.push({ m, t: 0, max: 7 });
  }

  constructor(flashTex: THREE.Texture | null) {
    this.flashTex = flashTex;
    this.posA = new Float32Array(this.max * 3);
    this.colA = new Float32Array(this.max * 3);
    this.sizeA = new Float32Array(this.max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.posA, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colA, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.sizeA, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      vertexShader: `attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = size * 300.0 / -mv.z; }`,
      fragmentShader: `varying vec3 vC; void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC*a, a); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    this.group.add(this.points);
    // blood: normal-blended (not glowing) droplets with an alpha channel, plus flat ground spatters
    this.bPos = new Float32Array(this.bMax * 3);
    this.bCol = new Float32Array(this.bMax * 4);
    this.bSize = new Float32Array(this.bMax);
    this.bGeo.setAttribute('position', new THREE.BufferAttribute(this.bPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.bGeo.setAttribute('bcolor', new THREE.BufferAttribute(this.bCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.bGeo.setAttribute('size', new THREE.BufferAttribute(this.bSize, 1).setUsage(THREE.DynamicDrawUsage));
    const bmat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: `attribute float size; attribute vec4 bcolor; varying vec4 vC; void main(){ vC = bcolor; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = size * 300.0 / -mv.z; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); float a = smoothstep(0.5, 0.32, d) * vC.a; if (a < 0.02) discard; gl_FragColor = vec4(vC.rgb, a); }`,
    });
    this.bPoints = new THREE.Points(this.bGeo, bmat);
    this.bPoints.frustumCulled = false;
    this.bPoints.renderOrder = 6;
    this.group.add(this.bPoints);
    this.splatMat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 1 }, uSeed: { value: 0 } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float uA, uSeed; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uSeed) * 43758.5453); }
        void main(){ vec2 c = vUv - 0.5; float r = length(c); float ang = atan(c.y, c.x);
          // soft irregular drop: low-amplitude lobes + per-texel noise so no two spatters read as the same stamp
          float edge = 0.3 + 0.035 * sin(ang * 3.0 + uSeed * 5.0) + 0.025 * sin(ang * 7.0 + uSeed * 2.3);
          float a = smoothstep(edge, edge - 0.14, r) * (0.65 + 0.35 * h(floor(vUv * 18.0)));
          if (a < 0.02) discard; gl_FragColor = vec4(0.07, 0.004, 0.004, a * 0.62 * uA); }`,
    });
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uT: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `uniform vec3 uColor; uniform float uT; varying vec2 vUv; void main(){ float r = length(vUv-0.5)*2.0; float w = 0.06 + 0.1*(1.0-uT);
        float a = smoothstep(w, 0.0, abs(r - 0.92)) * (1.0-uT); gl_FragColor = vec4(uColor*a*1.6, a); }`,
    });
  }

  private add(p: Particle) {
    if (this.parts.length >= this.max) this.parts.shift();
    this.parts.push(p);
  }

  /** metal-on-armor hit: warm short sparks along the swing direction */
  hitSparks(at: THREE.Vector3, dir: THREE.Vector3, n = 22, color = new THREE.Color(1.0, 0.62, 0.28)) {
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(2 + Math.random() * 5).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3.5, (Math.random() - 0.5) * 4));
      this.add({ p: at.clone(), v, life: 0, max: 0.18 + Math.random() * 0.25, size: 0.025 + Math.random() * 0.03, color: color.clone(), drag: 2.5, grav: 9 });
    }
    this.flash(at, new THREE.Color(1.0, 0.75, 0.45), 0.09, 0.25, 0.7);
  }

  /** parry: cold white-cyan starburst, bright core flash, expanding ring, long-lived embers */
  parryBurst(at: THREE.Vector3, normal: THREE.Vector3) {
    for (let i = 0; i < 46; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      const v = d.multiplyScalar(4 + Math.random() * 8).addScaledVector(normal, 2);
      this.add({ p: at.clone(), v, life: 0, max: 0.25 + Math.random() * 0.45, size: 0.03 + Math.random() * 0.04, color: new THREE.Color(0.7, 0.92, 1.0), drag: 3, grav: 6 });
    }
    this.flash(at, new THREE.Color(0.75, 0.95, 1.0), 0.16, 0.3, 1.6);
    this.ring(at, normal, new THREE.Color(0.55, 0.9, 1.0), 0.32, 1.6);
  }

  /** heavy impact on the ground: dust burst + warm ring */
  groundImpact(at: THREE.Vector3, color = new THREE.Color(0.55, 0.5, 0.45)) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a), 0.4 + Math.random() * 0.6, Math.sin(a)).multiplyScalar(1.5 + Math.random() * 2.5);
      this.dust.push({ p: at.clone().add(new THREE.Vector3(0, 0.1, 0)), v, life: 0, max: 0.6 + Math.random() * 0.5, size: 0.3 + Math.random() * 0.3, color: color.clone(), drag: 3.5, grav: -0.5 });
    }
    this.ring(at.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0, 1, 0), new THREE.Color(1.0, 0.7, 0.4), 0.35, 2.2);
  }

  charge(at: THREE.Vector3, k: number) {
    if (Math.random() > 0.35 + k * 0.5) return;
    const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.add({ p: at.clone().addScaledVector(d, 0.45), v: d.multiplyScalar(-1.6), life: 0, max: 0.25, size: 0.02 + k * 0.03, color: new THREE.Color(1.0, 0.7 + k * 0.2, 0.35), drag: 0, grav: 0 });
  }

  /* ---------------------------- elemental combat fx ---------------------------- */

  /**
   * Crescent slash that lies in the real swing plane: `pivot` is the fighter's chest, `tip` the blade tip now and
   * `vel` the tip velocity. The bright head sits on the tip and the body trails back along where the blade came from.
   */
  slashArc(pivot: THREE.Vector3, tip: THREE.Vector3, vel: THREE.Vector3, color: THREE.Color, life = 0.28, sweep = Math.PI * 0.8, width = 0.55) {
    const x = tip.clone().sub(pivot);
    const radius = x.length();
    if (radius < 0.2 || vel.lengthSq() < 1e-4) return;
    x.normalize();
    const z = new THREE.Vector3().crossVectors(x, vel).normalize();
    if (!Number.isFinite(z.x) || z.lengthSq() < 0.5) return;
    const y = new THREE.Vector3().crossVectors(z, x);
    const geo = new THREE.PlaneGeometry(2, 2, 1, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color.clone() }, uT: { value: 0 }, uSweep: { value: sweep }, uInner: { value: 1 - width } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uColor; uniform float uT, uSweep, uInner; varying vec2 vP;
        void main(){
          float r = length(vP);
          float th = atan(vP.y, vP.x);                    // 0 at the blade tip, negative = where it came from
          float head = uT * uSweep * 0.35;                 // the crescent keeps running a little past the tip
          float along = (head - th) / uSweep;              // 0 at the head, 1 at the tail
          if (along < 0.0 || along > 1.0) discard;
          float band = smoothstep(uInner, uInner + 0.12, r) * (1.0 - smoothstep(1.0, 1.1, r));
          float tail = pow(1.0 - along, 1.3);
          float rim = smoothstep(0.88, 1.0, r) * (1.0 - smoothstep(1.02, 1.1, r));
          float fade = 1.0 - smoothstep(0.45, 1.0, uT);
          float a = (band * tail * 0.45 + rim * tail * 1.1) * fade;
          vec3 hot = mix(uColor, vec3(1.0), rim * 0.5 * (1.0 - along));
          gl_FragColor = vec4(hot * a * 1.5, clamp(a, 0.0, 1.0));
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.matrixAutoUpdate = false;
    m.matrix.makeBasis(x.multiplyScalar(radius), y.multiplyScalar(radius), z).setPosition(pivot);
    m.renderOrder = 8;
    m.frustumCulled = false;
    this.group.add(m);
    this.arcs.push({ m, t: 0, max: life });
  }

  /** Element-tinted sparks + embers at a hit point. */
  hitBurst(at: THREE.Vector3, dir: THREE.Vector3, element: Element, power = 1) {
    const c = ELEMENT_COLOR[element];
    const n = Math.round((element === 'blade' ? 18 : 30) * power);
    for (let i = 0; i < n; i++) {
      const spread = element === 'fire' ? 2.6 : 4.4;
      const v = dir.clone().multiplyScalar(2 + Math.random() * 6 * power)
        .add(new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * 3.6, (Math.random() - 0.5) * spread));
      this.add({
        p: at.clone(), v, life: 0, max: 0.16 + Math.random() * 0.35,
        size: (element === 'fire' ? 0.03 : 0.022) + Math.random() * 0.03,
        color: c.clone().lerp(new THREE.Color(1, 1, 1), element === 'blade' ? 0.45 : 0.15),
        drag: element === 'wood' ? 4 : 2.4, grav: element === 'frost' ? 4 : 9, mode: 2,
      });
    }
    // element-specific body: embers rise, frost drifts, leaves tumble, storm crackles
    if (element === 'fire') {
      for (let i = 0; i < 10; i++) {
        this.add({ p: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.4, (Math.random() - 0.5) * 0.5)), v: new THREE.Vector3((Math.random() - 0.5) * 0.7, 1.4 + Math.random(), (Math.random() - 0.5) * 0.7), life: 0, max: 0.6 + Math.random() * 0.5, size: 0.05 + Math.random() * 0.05, color: new THREE.Color(1.0, 0.55, 0.18), drag: 1.2, grav: -0.4, mode: 2, soft: true });
      }
      this.flash(at, new THREE.Color(1.0, 0.55, 0.22), 0.11, 0.2, 0.7);
    } else if (element === 'frost') {
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        this.add({ p: at.clone(), v: new THREE.Vector3(Math.cos(a) * 1.5, 0.2 + Math.random() * 1.2, Math.sin(a) * 1.5), life: 0, max: 0.5 + Math.random() * 0.5, size: 0.04 + Math.random() * 0.05, color: new THREE.Color(0.75, 0.95, 1.0), drag: 2.6, grav: 2.4, mode: 1, soft: true });
      }
      this.flash(at, new THREE.Color(0.72, 0.95, 1.0), 0.12, 0.2, 0.6);
      this.ring(at, dir, new THREE.Color(0.6, 0.9, 1.0), 0.34, 1.1);
    } else if (element === 'storm') {
      this.flash(at, new THREE.Color(0.85, 0.9, 1.0), 0.08, 0.25, 0.8);
      // jagged bolt lines away from the impact
      for (let i = 0; i < 3; i++) this.ring(at, new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize(), new THREE.Color(0.7, 0.8, 1.0), 0.16, 0.8 + Math.random());
    } else if (element === 'wood') {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        this.add({ p: at.clone(), v: new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2), 1 + Math.random() * 1.6, Math.sin(a) * (1 + Math.random() * 2)), life: 0, max: 0.6 + Math.random() * 0.6, size: 0.05 + Math.random() * 0.04, color: new THREE.Color(0.45, 0.9, 0.4), drag: 3.2, grav: 2.2, mode: 1 });
      }
      this.ring(at, new THREE.Vector3(0, 1, 0), new THREE.Color(0.5, 0.95, 0.5), 0.3, 1.2);
    }
  }

  /**
   * Afterimage: bakes the current skinned pose of `meshes` into a static, additive, tinted silhouette that fades out
   * in place. Used during dodges so the evade reads as a burst of speed.
   */
  ghost(meshes: THREE.SkinnedMesh[], color: THREE.Color, life = 0.32) {
    const g = new THREE.Group();
    const v = new THREE.Vector3();
    for (const sm of meshes) {
      const src = sm.geometry;
      const pos = src.getAttribute('position') as THREE.BufferAttribute;
      if (!pos) continue;
      const baked = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i);
        sm.applyBoneTransform(i, v);
        v.applyMatrix4(sm.matrixWorld);
        baked[i * 3] = v.x; baked[i * 3 + 1] = v.y; baked[i * 3 + 2] = v.z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(baked, 3));
      if (src.index) geo.setIndex(src.index);
      geo.computeVertexNormals();
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: color.clone() }, uA: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = viewMatrix*vec4(position,1.0); vN = normalize(mat3(viewMatrix)*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
        fragmentShader: 'uniform vec3 uColor; uniform float uA; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.0); float a = (0.12 + f * 0.9) * uA; gl_FragColor = vec4(uColor * a * 1.6, a); }',
      });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 7;
      g.add(m);
    }
    this.group.add(g);
    this.ghosts.push({ g, t: 0, max: life });
  }
  dodgeBurst(at: THREE.Vector3, dir: THREE.Vector3, element: Element = 'blade') {
    const c = ELEMENT_COLOR[element];
    this.ring(at.clone().setY(at.y + 0.06), new THREE.Vector3(0, 1, 0), c.clone(), 0.34, 1.9);
    for (let i = 0; i < 22; i++) {
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const v = side.clone().multiplyScalar((Math.random() - 0.5) * 2.4).add(new THREE.Vector3(0, 0.4 + Math.random() * 1.2, 0)).addScaledVector(dir, -1.2 - Math.random());
      this.add({ p: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.1 + Math.random() * 0.9, (Math.random() - 0.5) * 0.5)), v, life: 0, max: 0.35 + Math.random() * 0.35, size: 0.03 + Math.random() * 0.04, color: c.clone(), drag: 3, grav: 1.2, mode: 1, soft: true });
    }
  }

  /** Parry: lightning bloom at the contact point plus a hard white flash and a double ring. */
  parryShock(at: THREE.Vector3, normal: THREE.Vector3) {
    this.parryBurst(at, normal);
    this.flash(at, new THREE.Color(1, 1, 1), 0.07, 0.5, 2.4);
    for (let i = 0; i < 5; i++) {
      this.ring(at, normal.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2)).normalize(), new THREE.Color(0.72, 0.86, 1.0), 0.12 + Math.random() * 0.1, 0.9 + Math.random() * 1.2);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.add({ p: at.clone(), v: new THREE.Vector3(Math.cos(a) * 3.4, 0.6 + Math.random(), Math.sin(a) * 3.4), life: 0, max: 0.3 + Math.random() * 0.2, size: 0.05, color: new THREE.Color(0.8, 0.92, 1.0), drag: 4, grav: 3, mode: 2 });
    }
  }

  flash(at: THREE.Vector3, color: THREE.Color, max: number, s0: number, s1: number) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.flashTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 1 }),
    );
    m.position.copy(at);
    m.renderOrder = 8;
    m.rotation.z = Math.random() * Math.PI;
    this.group.add(m);
    this.flashes.push({ m, t: 0, max, s0, s1 });
  }

  ring(at: THREE.Vector3, normal: THREE.Vector3, color: THREE.Color, max: number, r1: number) {
    const mat = this.ringMat.clone();
    mat.uniforms.uColor.value = color;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.position.copy(at);
    m.lookAt(at.clone().add(normal));
    m.renderOrder = 8;
    this.group.add(m);
    this.rings.push({ m, t: 0, max, r1 });
  }

  update(dt: number, camera: THREE.Camera) {
    let k = 0;
    const all = this.parts;
    for (let i = all.length - 1; i >= 0; i--) {
      const p = all[i];
      p.life += dt;
      if (p.life > p.max) {
        all.splice(i, 1);
        continue;
      }
      p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.v.y -= p.grav * dt;
      p.p.addScaledVector(p.v, dt);
    }
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const p = this.dust[i];
      p.life += dt;
      if (p.life > p.max) {
        this.dust.splice(i, 1);
        continue;
      }
      p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.v.y -= p.grav * dt;
      p.p.addScaledVector(p.v, dt);
    }
    // blood droplets: fall, and leave a spatter where a droplet first reaches the ground
    let bk = 0;
    for (let i = this.blood.length - 1; i >= 0; i--) {
      const p = this.blood[i];
      p.life += dt;
      if (p.life > p.max) {
        this.blood.splice(i, 1);
        continue;
      }
      p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.v.y -= p.grav * dt;
      p.p.addScaledVector(p.v, dt);
      if (!p.soft && !p.landed) {
        const gy = this.groundAt(p.p.x, p.p.z);
        if (p.p.y <= gy + 0.02) {
          p.landed = true;
          if (Math.random() < 0.12) this.splat(p.p.x, p.p.z, 0.08 + Math.random() * 0.14);
          p.life = p.max; // absorbed
        }
      }
    }
    for (const p of this.blood) {
      if (bk >= this.bMax) break;
      const f = 1 - p.life / p.max;
      this.bPos.set([p.p.x, p.p.y, p.p.z], bk * 3);
      this.bCol.set([p.color.r, p.color.g, p.color.b, (p.soft ? 0.45 : 0.95) * Math.min(1, f * 2.5)], bk * 4);
      this.bSize[bk] = p.size * (p.soft ? 1 + (1 - f) * 1.5 : 1);
      bk++;
    }
    this.bGeo.setDrawRange(0, bk);
    this.bGeo.attributes.position.needsUpdate = true;
    this.bGeo.attributes.bcolor.needsUpdate = true;
    this.bGeo.attributes.size.needsUpdate = true;
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      s.t += dt;
      if (s.t >= s.max) {
        this.group.remove(s.m);
        s.m.geometry.dispose();
        (s.m.material as THREE.Material).dispose();
        this.splats.splice(i, 1);
        continue;
      }
      ((s.m.material as THREE.ShaderMaterial).uniforms.uA as THREE.IUniform).value = 1 - Math.max(0, (s.t - s.max + 2) / 2);
    }
    for (const p of all) {
      if (k >= this.max) break;
      const f = 1 - p.life / p.max;
      this.posA.set([p.p.x, p.p.y, p.p.z], k * 3);
      const mode = p.mode ?? 0;
      // mode 2: hot core that cools into the element tint as it dies (embers, sparks)
      const heat = mode === 2 ? f * f : f;
      const cr = p.color.r + (1 - p.color.r) * heat * 0.9;
      const cg = p.color.g + (1 - p.color.g) * heat * 0.9;
      const cb = p.color.b + (1 - p.color.b) * heat * 0.9;
      const lit = mode === 2 ? 1.2 + heat * 1.6 : (p.soft ? 0.8 : 2);
      this.colA.set([cr * f * lit, cg * f * lit, cb * f * lit], k * 3);
      this.sizeA[k] = p.size * (mode === 1 ? 0.35 + f * 0.9 : 0.5 + f * 0.5) * (p.soft ? 2.4 : 1);
      k++;
    }
    for (const p of this.dust) {
      if (k >= this.max) break;
      const f = 1 - p.life / p.max;
      this.posA.set([p.p.x, p.p.y, p.p.z], k * 3);
      this.colA.set([p.color.r * f * 0.35, p.color.g * f * 0.35, p.color.b * f * 0.35], k * 3);
      this.sizeA[k] = p.size * (1 + p.life * 2);
      k++;
    }
    this.geo.setDrawRange(0, k);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      const k2 = f.t / f.max;
      if (k2 >= 1) {
        this.group.remove(f.m);
        f.m.geometry.dispose();
        (f.m.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      f.m.quaternion.copy(camera.quaternion);
      f.m.scale.setScalar(f.s0 + (f.s1 - f.s0) * Math.sqrt(k2));
      (f.m.material as THREE.MeshBasicMaterial).opacity = 1 - k2;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k2 = r.t / r.max;
      if (k2 >= 1) {
        this.group.remove(r.m);
        r.m.geometry.dispose();
        (r.m.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      r.m.scale.setScalar(0.2 + r.r1 * Math.sqrt(k2));
      ((r.m.material as THREE.ShaderMaterial).uniforms.uT as THREE.IUniform).value = k2;
    }
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.t += dt;
      const k2 = a.t / a.max;
      if (k2 >= 1) {
        this.group.remove(a.m);
        a.m.geometry.dispose();
        (a.m.material as THREE.Material).dispose();
        this.arcs.splice(i, 1);
        continue;
      }
      ((a.m.material as THREE.ShaderMaterial).uniforms.uT as THREE.IUniform).value = k2;
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const gh = this.ghosts[i];
      gh.t += dt;
      const k2 = gh.t / gh.max;
      if (k2 >= 1) {
        this.disposeGhost(gh.g);
        this.ghosts.splice(i, 1);
        continue;
      }
      for (const c of gh.g.children) (((c as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uA as THREE.IUniform).value = (1 - k2) * (1 - k2);
    }
  }

  private disposeGhost(g: THREE.Group) {
    this.group.remove(g);
    for (const c of g.children) {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }

  dispose() {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
    this.ringMat.dispose();
    for (const f of this.flashes) f.m.geometry.dispose();
    for (const r of this.rings) r.m.geometry.dispose();
    for (const a of this.arcs) { a.m.geometry.dispose(); (a.m.material as THREE.Material).dispose(); }
    for (const gh of this.ghosts) this.disposeGhost(gh.g);
    this.ghosts = [];
    this.bGeo.dispose();
    (this.bPoints.material as THREE.Material).dispose();
    this.splatMat.dispose();
    for (const s of this.splats) { s.m.geometry.dispose(); (s.m.material as THREE.Material).dispose(); }
    this.splats = [];
  }
}
