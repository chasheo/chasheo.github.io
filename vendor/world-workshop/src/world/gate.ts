import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GATE } from './layout';
import { boxUV, type Collider } from './buildings';

/**
 * Gate of Worlds (moon gate): a plaster wall with a round opening framed in stone. The opening holds the
 * portal surface shader that shows the currently selected game (cover or muted video), sealed until victory.
 */
export class WorldGate {
  group = new THREE.Group();
  portal: THREE.Mesh;
  uniforms = {
    uTime: { value: 0 },
    uOpen: { value: 0 },
    uCover: { value: null as THREE.Texture | null },
    uHasCover: { value: 0 },
    uAccent: { value: new THREE.Color('#7fd6a4') },
    uSwap: { value: 0 },
    uHover: { value: 0 },
  };
  collider: Collider;
  focus = new THREE.Vector3();
  lightPos = new THREE.Vector3();
  light: THREE.PointLight;
  device: THREE.Group;
  deviceRings: THREE.Mesh[] = [];
  deviceGlow: THREE.MeshStandardMaterial;
  occluders: THREE.Object3D[] = [];

  constructor(mats: { plaster: THREE.Material; stone: THREE.Material; tile: THREE.Material; timberDark: THREE.Material; brass: THREE.MeshStandardMaterial }) {
    const g = this.group;
    g.position.set(GATE.x, GATE.ground, GATE.z);
    g.rotation.y = GATE.rot;
    const R = 1.7, cy = 2.05, wallW = 7.2, wallH = 4.3, t = 0.5;
    // wall with circular hole: shape extrusion
    const shape = new THREE.Shape();
    shape.moveTo(-wallW / 2, 0);
    shape.lineTo(wallW / 2, 0);
    shape.lineTo(wallW / 2, wallH);
    shape.lineTo(-wallW / 2, wallH);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, cy, R, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const wg = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 64 });
    wg.translate(0, 0, -t / 2);
    boxUV(wg, 1.6);
    const wall = new THREE.Mesh(wg, mats.plaster);
    wall.castShadow = wall.receiveShadow = true;
    g.add(wall);
    this.occluders.push(wall);
    // stone frame ring (lathe of a squared profile)
    const ringG = new THREE.TorusGeometry(R + 0.06, 0.16, 10, 96);
    ringG.scale(1, 1, 3.4);
    const ring = new THREE.Mesh(ringG, mats.stone);
    ring.position.set(0, cy, 0);
    ring.castShadow = true;
    g.add(ring);
    // coping: dark tile cap with eaves
    const cap = new THREE.Mesh(new RoundedBoxGeometry(wallW + 0.5, 0.18, t + 0.6, 2, 0.04), mats.tile);
    cap.position.y = wallH + 0.09;
    cap.castShadow = true;
    g.add(cap);
    const capRidge = new THREE.Mesh(new RoundedBoxGeometry(wallW + 0.3, 0.2, 0.26, 2, 0.05), mats.tile);
    capRidge.position.y = wallH + 0.28;
    g.add(capRidge);
    const tileG = new THREE.CylinderGeometry(0.06, 0.06, t + 0.62, 8, 1, true, -Math.PI / 2, Math.PI);
    tileG.rotateX(Math.PI / 2);
    tileG.rotateZ(Math.PI / 2);
    const nt = Math.round((wallW + 0.4) / 0.2);
    const tiles = new THREE.InstancedMesh(tileG, mats.tile, nt);
    for (let i = 0; i < nt; i++) tiles.setMatrixAt(i, new THREE.Matrix4().makeTranslation(-wallW / 2 - 0.2 + i * 0.2 + 0.1, wallH + 0.2, 0));
    tiles.castShadow = true;
    g.add(tiles);
    // stone threshold steps
    for (let s = 0; s < 3; s++) {
      const st = new THREE.Mesh(boxUV(new RoundedBoxGeometry(3.2 - s * 0.3, 0.16, 0.5, 2, 0.03).toNonIndexed(), 1), mats.stone);
      st.position.set(0, 0.08 + s * 0.16 - 0.32, 0.9 - s * 0.4);
      st.receiveShadow = st.castShadow = true;
      g.add(st);
    }
    // portal surface
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vV = -mv.xyz; vN = normalMatrix*normal; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `
        uniform float uTime, uOpen, uHasCover, uSwap, uHover; uniform sampler2D uCover; uniform vec3 uAccent;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
        float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.03; a*=0.5;} return s; }
        void main(){
          vec2 c = vUv - 0.5;
          float r = length(c) * 2.0;
          if (r > 1.0) discard;
          float ang = atan(c.y, c.x);
          // swirl field
          float sw = fbm(vec2(ang*1.6 + uTime*0.25 + r*3.0, r*4.0 - uTime*0.6));
          float sw2 = fbm(vec2(ang*3.0 - uTime*0.35, r*7.0 + uTime*0.3));
          // sealed look: dark ink mist with faint accent rune ring
          vec3 sealed = mix(vec3(0.03,0.035,0.04), uAccent*0.18, sw*0.6);
          float runes = smoothstep(0.012, 0.0, abs(r - 0.82)) * step(0.5, fract(ang*12.0/6.2831 + uTime*0.03)) * 0.8;
          runes += smoothstep(0.02, 0.0, abs(r - 0.9)) * 0.4;
          sealed += uAccent * runes * (0.4 + 0.3*sin(uTime*2.0));
          // open look: the selected world seen through a lens-like distorted window
          vec2 dir = normalize(c + 1e-5);
          float lens = (1.0 - r*r) * 0.12;
          vec2 uv = vUv + dir * (sw - 0.5) * 0.05 * r - dir * lens * 0.1;
          uv = (uv - 0.5) * vec2(0.9, 0.9 * 0.5625 * 1.6) + 0.5; // keep 16:9 covers centered in the round
          vec3 world = uHasCover > 0.5 ? texture2D(uCover, uv).rgb : mix(uAccent*0.25, uAccent, sw);
          world *= 0.9 + 0.25*uHover;
          float rim = smoothstep(0.75, 1.0, r);
          vec3 open = mix(world, uAccent * (1.4 + sw2), rim * (0.65 + 0.35*sw2));
          open += uAccent * pow(1.0 - r, 3.0) * 0.08;
          // reveal front: expands from the center, with a bright band
          float front = uOpen * 1.15;
          float rv = smoothstep(front, front - 0.12 - sw*0.15, r);
          float band = smoothstep(0.08, 0.0, abs(r - front + sw*0.1)) * (1.0 - step(1.0, uOpen));
          vec3 col = mix(sealed, open, rv) + uAccent * band * 2.5;
          // swap flash when the selected game changes
          col = mix(col, uAccent*1.6, uSwap * (1.0 - r) );
          float alpha = mix(0.92, 1.0, rv);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.portal = new THREE.Mesh(new THREE.CircleGeometry(R, 96), mat);
    this.portal.position.set(0, cy, 0.02);
    this.portal.renderOrder = 5;
    g.add(this.portal);
    this.light = new THREE.PointLight(0x7fd6a4, 0, 9, 1.6);
    this.light.position.set(0, cy, 1.2);
    g.add(this.light);
    // workshop device (浑天仪): brass armillary that spins and glows after the gate opens
    this.device = new THREE.Group();
    const base = new THREE.Mesh(boxUV(new RoundedBoxGeometry(0.9, 0.7, 0.9, 2, 0.05).toNonIndexed(), 1), mats.stone);
    base.position.y = 0.35;
    base.castShadow = true;
    this.device.add(base);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.6, 12), mats.brass);
    post.position.y = 1.0;
    this.device.add(post);
    this.deviceGlow = new THREE.MeshStandardMaterial({ color: 0x2a3a34, emissive: new THREE.Color('#7fd6a4'), emissiveIntensity: 0.0, roughness: 0.3, metalness: 0.2 });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 2), this.deviceGlow);
    core.position.y = 1.62;
    this.device.add(core);
    for (let i = 0; i < 3; i++) {
      const rg = new THREE.Mesh(new THREE.TorusGeometry(0.42 - i * 0.07, 0.016, 8, 64), mats.brass);
      rg.position.y = 1.62;
      rg.rotation.set(i * 0.9, i * 0.6, 0);
      rg.castShadow = true;
      this.device.add(rg);
      this.deviceRings.push(rg);
    }
    this.device.position.set(-wallW / 2 - 1.0, 0, 1.3);
    g.add(this.device);
    g.updateMatrixWorld(true);
    this.focus.set(0, cy, 0).applyMatrix4(g.matrixWorld);
    this.lightPos.copy(this.light.position).applyMatrix4(g.matrixWorld);
    this.collider = { x: GATE.x, z: GATE.z, hw: wallW / 2 + 0.2, hd: 0.45, rot: GATE.rot };
  }

  /** world-space point in front of the gate where the player can interact */
  interactPoint(out = new THREE.Vector3()) {
    return out.set(0, 0, 1.8).applyMatrix4(this.group.matrixWorld);
  }

  setCover(tex: THREE.Texture | null, accent: string) {
    this.uniforms.uCover.value = tex;
    this.uniforms.uHasCover.value = tex ? 1 : 0;
    this.uniforms.uAccent.value.set(accent);
    this.light.color.set(accent);
    this.deviceGlow.emissive.set(accent);
    this.uniforms.uSwap.value = 1;
  }

  update(dt: number, open: number) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uOpen.value = open;
    u.uSwap.value = Math.max(0, u.uSwap.value - dt * 2.5);
    this.light.intensity = 0.4 + open * 6;
    this.deviceGlow.emissiveIntensity = open * 2.2;
    const spin = 0.15 + open * 0.9;
    this.deviceRings.forEach((r, i) => {
      r.rotation.y += dt * spin * (i % 2 ? -1 : 1) * (1 + i * 0.3);
      r.rotation.x += dt * spin * 0.4 * (i + 1);
    });
  }
}
