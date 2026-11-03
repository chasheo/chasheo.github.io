import * as THREE from 'three';

/** Procedural weapons with real-world dimensions (meters). Grip center at origin, blade/head along +Y. */
export interface Weapon {
  group: THREE.Group;
  base: THREE.Vector3; // local point where the cutting edge starts
  tip: THREE.Vector3; // local tip
  edgeMat: THREE.MeshStandardMaterial;
  uniforms: { uGlow: { value: number }; uGlowColor: { value: THREE.Color } };
  dispose(): void;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function steelTextures() {
  const r = rng(7);
  const rough = canvasTex(256, 512, (g) => {
    g.fillStyle = '#5a5a5a';
    g.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 900; i++) {
      const y = r() * 512, x = r() * 256;
      g.strokeStyle = `rgba(${r() < 0.5 ? 30 : 140},${r() < 0.5 ? 30 : 140},${r() < 0.5 ? 30 : 140},${0.08 + r() * 0.15})`;
      g.lineWidth = 0.5 + r();
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 6, y + 20 + r() * 60);
      g.stroke();
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(120,80,50,${0.05 + r() * 0.1})`;
      g.beginPath();
      g.arc(r() * 256, r() * 512, 2 + r() * 10, 0, 7);
      g.fill();
    }
  }, false);
  return { rough };
}

function glowify(mat: THREE.MeshStandardMaterial, u: Weapon['uniforms'], edgeAxis: 'x' | 'z') {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = u.uGlow;
    sh.uniforms.uGlowColor = u.uGlowColor;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow; uniform vec3 uGlowColor; varying vec3 vLocal;')
      .replace(
        '#include <opaque_fragment>',
        `float fr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.0);
         outgoingLight += uGlowColor * uGlow * (0.35 + 1.4 * fr);
         #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'ww-weapon-glow-' + edgeAxis;
}

/** Curved single-edged dao (柳叶刀). Total ~0.98 m. */
export function makeDao(): Weapon {
  const group = new THREE.Group();
  group.name = 'dao';
  const u = { uGlow: { value: 0 }, uGlowColor: { value: new THREE.Color(1.0, 0.62, 0.3) } };
  const { rough } = steelTextures();
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9ced3, metalness: 1, roughness: 0.34, roughnessMap: rough, envMapIntensity: 1.3 });
  glowify(steel, u, 'z');
  // blade cross-section: spine (back) thick, edge thin; sweep along a gentle curve
  const L = 0.74, segs = 48;
  const prof = (s: number) => {
    // width profile (m): widening toward the tip (willow-leaf), then a clipped point
    const w = 0.032 + 0.008 * Math.sin(Math.PI * Math.min(1, s * 1.15));
    const tip = s > 0.88 ? Math.pow((1 - s) / 0.12, 0.85) : 1;
    return w * tip;
  };
  const curve = (s: number) => new THREE.Vector3(0, s * L, -0.07 * s * s); // curve backward (spine side = -z)
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  // section points: [z offset (0=spine,1=edge), x half-thickness]
  const sec = [
    [0, 0.0032], [0.08, 0.0036], [0.55, 0.0027], [0.72, 0.0014], [1, 0.0001],
  ];
  const ring: number[][] = [];
  for (const [z, x] of sec) ring.push([z, x]);
  for (let i = sec.length - 2; i >= 0; i--) ring.push([sec[i][0], -sec[i][1]]);
  // ring: spine->edge on +x side, then edge->spine on -x side
  const R = ring.length;
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    const c = curve(s);
    const w = prof(s);
    const thick = 1 - 0.55 * s;
    for (let k = 0; k < R; k++) {
      const [zf, xf] = ring[k];
      pos.push(xf * thick, c.y, c.z + zf * w);
      uv.push(zf, s);
      nrm.push(Math.sign(xf || 1), 0, 0);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let k = 0; k < R; k++) {
      const a = i * R + k, b = i * R + ((k + 1) % R), c2 = (i + 1) * R + k, d = (i + 1) * R + ((k + 1) % R);
      idx.push(a, c2, b, b, c2, d);
    }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  bg.setIndex(idx);
  bg.computeVertexNormals();
  const blade = new THREE.Mesh(bg, steel);
  blade.position.y = 0.155;
  blade.castShadow = true;
  group.add(blade);
  // fuller groove: dark inset line along the spine on both faces
  const fullerMat = new THREE.MeshStandardMaterial({ color: 0x6f747a, metalness: 1, roughness: 0.5 });
  for (const sx of [1, -1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const s = 0.05 + (i / 20) * 0.7;
      const c = curve(s);
      pts.push(new THREE.Vector3(sx * 0.0033 * (1 - 0.55 * s), c.y + 0.155, c.z + prof(s) * 0.22));
    }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0016, 5, false), fullerMat);
    tube.scale.x = 0.4;
    group.add(tube);
  }
  // guard (oval tsuba-like with lobes), brass
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a4a, metalness: 1, roughness: 0.38 });
  const gShape = new THREE.Shape();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r = 1 + 0.12 * Math.cos(a * 4);
    const x = Math.cos(a) * 0.036 * r, y = Math.sin(a) * 0.05 * r;
    if (i === 0) gShape.moveTo(x, y);
    else gShape.lineTo(x, y);
  }
  const guard = new THREE.Mesh(new THREE.ExtrudeGeometry(gShape, { depth: 0.008, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2 }), brass);
  guard.rotation.x = -Math.PI / 2;
  guard.position.y = 0.15;
  guard.position.z = 0.012;
  group.add(guard);
  // collar
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.02, 24), brass);
  collar.position.y = 0.13;
  collar.scale.z = 1.35;
  group.add(collar);
  // grip: cord-wrapped handle using a diamond-pattern canvas texture
  const cord = canvasTex(128, 256, (g) => {
    g.fillStyle = '#1a2430';
    g.fillRect(0, 0, 128, 256);
    for (let y = -64; y < 320; y += 22) {
      for (const dir of [1, -1]) {
        g.strokeStyle = '#3c5266';
        g.lineWidth = 9;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(128, y + dir * 40);
        g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.lineWidth = 2;
        g.stroke();
      }
    }
  });
  cord.repeat.set(1, 2);
  const gripMat = new THREE.MeshStandardMaterial({ map: cord, roughness: 0.85, metalness: 0 });
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0155, 0.24, 20), gripMat);
  grip.scale.z = 1.3;
  grip.position.y = 0.0;
  group.add(grip);
  // pommel with ring
  const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.013, 0.025, 20), brass);
  pommel.position.y = -0.13;
  pommel.scale.z = 1.3;
  group.add(pommel);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.0045, 10, 28), brass);
  ring2.position.y = -0.16;
  group.add(ring2);
  // tassel
  const tasselMat = new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.9 });
  const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.09, 10, 1, true), tasselMat);
  tassel.position.y = -0.22;
  tassel.rotation.x = Math.PI;
  group.add(tassel);
  group.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : 0));
  const tip = curve(0.98).add(new THREE.Vector3(0, 0.155, 0.01));
  const base = new THREE.Vector3(0, 0.2, 0.01);
  return {
    group, base, tip, edgeMat: steel, uniforms: u,
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.MeshStandardMaterial).map?.dispose();
          (m.material as THREE.MeshStandardMaterial).roughnessMap?.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
    },
  };
}

/** One-handed bearded battle axe (单手战斧). Haft ~0.82 m. */
export function makeAxe(): Weapon {
  const group = new THREE.Group();
  group.name = 'axe';
  const u = { uGlow: { value: 0 }, uGlowColor: { value: new THREE.Color(1.0, 0.25, 0.12) } };
  const r = rng(11);
  const woodTex = canvasTex(128, 512, (g) => {
    const grd = g.createLinearGradient(0, 0, 128, 0);
    grd.addColorStop(0, '#3b2516');
    grd.addColorStop(0.5, '#5a3a22');
    grd.addColorStop(1, '#3b2516');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 512);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(20,10,5,${0.15 + r() * 0.3})`;
      g.lineWidth = 0.6 + r() * 1.4;
      const x = r() * 128;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (r() - 0.5) * 12, 170, x + (r() - 0.5) * 12, 340, x + (r() - 0.5) * 8, 512);
      g.stroke();
    }
  });
  const wood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.72, metalness: 0 });
  const haftGeo = new THREE.CylinderGeometry(0.016, 0.019, 0.82, 18, 8);
  const hp = haftGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < hp.count; i++) {
    const y = hp.getY(i);
    hp.setX(i, hp.getX(i) * (1 + 0.08 * Math.sin(y * 9)));
    hp.setZ(i, hp.getZ(i) * 1.25);
  }
  haftGeo.computeVertexNormals();
  const haft = new THREE.Mesh(haftGeo, wood);
  haft.position.y = 0.26;
  group.add(haft);
  // leather wrap at grip
  const leather = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.9 });
  for (let i = 0; i < 7; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0205, 0.0045, 6, 20), leather);
    ring.rotation.x = Math.PI / 2;
    ring.scale.y = 1.25;
    ring.position.y = -0.08 + i * 0.028;
    group.add(ring);
  }
  const { rough } = steelTextures();
  const iron = new THREE.MeshStandardMaterial({ color: 0x8c8f93, metalness: 1, roughness: 0.48, roughnessMap: rough, envMapIntensity: 1.2 });
  glowify(iron, u, 'x');
  // ferrules
  for (const y of [0.18, -0.13]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 18), iron);
    f.scale.z = 1.25;
    f.position.y = y;
    group.add(f);
  }
  // bearded head profile (in X-Y plane, blade toward +X)
  const s = new THREE.Shape();
  s.moveTo(-0.03, 0.05);
  s.lineTo(0.05, 0.045);
  s.quadraticCurveTo(0.11, 0.06, 0.17, 0.11); // upper horn
  s.quadraticCurveTo(0.205, 0.02, 0.19, -0.07); // cutting edge (curved)
  s.quadraticCurveTo(0.17, -0.15, 0.12, -0.17); // beard
  s.quadraticCurveTo(0.08, -0.07, 0.05, -0.045);
  s.lineTo(-0.03, -0.045);
  s.lineTo(-0.065, -0.02);
  s.lineTo(-0.065, 0.02);
  s.closePath();
  const headGeo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 3, curveSegments: 18 });
  headGeo.translate(0, 0, -0.006);
  // taper toward the edge: squeeze z by x
  const ap = headGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < ap.count; i++) {
    const x = ap.getX(i);
    const k = x > 0.06 ? Math.max(0.12, 1 - (x - 0.06) / 0.14) : 1;
    ap.setZ(i, ap.getZ(i) * k);
  }
  headGeo.computeVertexNormals();
  const head = new THREE.Mesh(headGeo, iron);
  head.position.set(0, 0.6, 0);
  group.add(head);
  // bright honed edge strip
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe1e4e6, metalness: 1, roughness: 0.22 });
  glowify(edgeMat, u, 'x');
  const edgeCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.17, 0.105, 0), new THREE.Vector3(0.205, 0.02, 0), new THREE.Vector3(0.12, -0.165, 0));
  const edge = new THREE.Mesh(new THREE.TubeGeometry(edgeCurve, 20, 0.0035, 5, false), edgeMat);
  edge.scale.z = 0.5;
  edge.position.copy(head.position);
  group.add(edge);
  // socket & rivets
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.12, 18), iron);
  socket.scale.z = 1.25;
  socket.position.y = 0.6;
  group.add(socket);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), iron);
  top.position.y = 0.66;
  top.scale.z = 1.25;
  group.add(top);
  for (const y of [0.57, 0.63]) {
    const rv = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), iron);
    rv.position.set(0, y, 0.031);
    group.add(rv);
  }
  // back spike
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 4), iron);
  spike.rotation.z = Math.PI / 2;
  spike.position.set(-0.09, 0.6, 0);
  spike.scale.z = 0.5;
  group.add(spike);
  group.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : 0));
  return {
    group,
    base: new THREE.Vector3(0.12, 0.42, 0),
    tip: new THREE.Vector3(0.2, 0.62, 0),
    edgeMat: iron,
    uniforms: u,
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mt = m.material as THREE.MeshStandardMaterial;
          mt.map?.dispose();
          mt.roughnessMap?.dispose();
          mt.dispose();
        }
      });
    },
  };
}
