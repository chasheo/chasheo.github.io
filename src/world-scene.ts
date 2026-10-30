import * as THREE from 'three';

// A self-contained 3D scene: no external model download or input interception.
export async function initWorldScene() {
  const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  } catch { return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#060a13');
  scene.fog = new THREE.FogExp2('#060a13', .023);
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 100);
  camera.position.set(0, 0, 15);
  scene.add(new THREE.AmbientLight(0x7784af, 1.35));
  const key = new THREE.PointLight(0x79ddff, 70, 30);
  key.position.set(4, 4, 7); scene.add(key);
  const rim = new THREE.PointLight(0xb087ff, 95, 30);
  rim.position.set(8, -4, -1); scene.add(rim);

  const system = new THREE.Group();
  scene.add(system);
  const sculpture = new THREE.Group();
  sculpture.rotation.set(.28, -.22, -.12);
  system.add(sculpture);

  const metal = new THREE.MeshStandardMaterial({ color: 0x7c90ac, metalness: .82, roughness: .28 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x172b48, metalness: .75, roughness: .28 });
  const cyan = new THREE.MeshBasicMaterial({ color: 0x8ceaff });
  const violet = new THREE.MeshBasicMaterial({ color: 0xa999ff });
  const transparentCyan = new THREE.MeshBasicMaterial({ color: 0x75d8fa, transparent: true, opacity: .45, wireframe: true });

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 128;
  const glowContext = glowCanvas.getContext('2d');
  if (glowContext) {
    const gradient = glowContext.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(102,192,255,.7)');
    gradient.addColorStop(.22, 'rgba(36,102,235,.3)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    glowContext.fillStyle = gradient; glowContext.fillRect(0, 0, 128, 128);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCanvas),
      transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.z = -1; glow.scale.set(6.5, 6.5, 1); sculpture.add(glow);
  }

  // Faceted core, nested wireframe and metal collars are actual meshes.
  const core = new THREE.Group();
  const crystal = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1),
    new THREE.MeshPhysicalMaterial({ color: 0x204d77, metalness: .58, roughness: .18, clearcoat: .9, clearcoatRoughness: .15 }));
  core.add(crystal);
  core.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.24, 1), transparentCyan));
  core.add(new THREE.Mesh(new THREE.IcosahedronGeometry(.55, 0),
    new THREE.MeshBasicMaterial({ color: 0xc2f8ff, wireframe: true, transparent: true, opacity: .9 })));
  sculpture.add(core);

  const innerRing = new THREE.Group();
  innerRing.rotation.set(.9, .22, .3);
  innerRing.add(new THREE.Mesh(new THREE.TorusGeometry(1.78, .045, 12, 128), metal));
  innerRing.add(new THREE.Mesh(new THREE.TorusGeometry(1.66, .014, 8, 128, Math.PI * 1.25), cyan));
  sculpture.add(innerRing);

  const outerRing = new THREE.Group();
  outerRing.rotation.set(-.6, .66, -.3);
  outerRing.add(new THREE.Mesh(new THREE.TorusGeometry(2.48, .035, 12, 160), metal));
  outerRing.add(new THREE.Mesh(new THREE.TorusGeometry(2.58, .02, 8, 160, Math.PI * 1.32), violet));
  sculpture.add(outerRing);
  const outerArc = new THREE.Mesh(new THREE.TorusGeometry(2.87, .008, 6, 160, Math.PI * 1.6),
    new THREE.MeshBasicMaterial({ color: 0x70d8ff, transparent: true, opacity: .58 }));
  outerArc.rotation.set(.38, -.44, .14); sculpture.add(outerArc);

  const blocks = new THREE.Group();
  const blockGeometry = new THREE.BoxGeometry(.31, .14, .3);
  for (let i = 0; i < 16; i++) {
    const angle = i / 16 * Math.PI * 2;
    const block = new THREE.Mesh(blockGeometry, i % 4 === 0 ? cyan : metal);
    block.position.set(Math.cos(angle) * 2.22, Math.sin(angle) * 2.22, 0);
    block.rotation.z = angle;
    blocks.add(block);
  }
  blocks.rotation.set(.8, .4, .1); sculpture.add(blocks);

  // Small independent forms give parallax a visible near/middle/far depth.
  const fragments = new THREE.Group();
  const shapes = [new THREE.OctahedronGeometry(.23, 0), new THREE.BoxGeometry(.3, .3, .3), new THREE.TetrahedronGeometry(.27, 0)];
  for (let i = 0; i < 21; i++) {
    const angle = i * 2.399;
    const radius = 3.05 + (i % 4) * .3;
    const item = new THREE.Mesh(shapes[i % shapes.length], i % 3 ? darkMetal : metal);
    item.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * .75, (i % 5 - 2) * .6);
    item.rotation.set(i * .31, i * .67, i * .19);
    item.scale.setScalar(.5 + (i % 3) * .25);
    fragments.add(item);
  }
  sculpture.add(fragments);

  const positions = new Float32Array(300 * 3);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (Math.random() - .5) * 38;
    positions[i + 1] = (Math.random() - .5) * 24;
    positions[i + 2] = Math.random() * 32 - 24;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: 0x9edffb, size: .035, transparent: true, opacity: .65, depthWrite: false }));
  scene.add(particles);
  const grid = new THREE.GridHelper(45, 45, 0x24608d, 0x162b46);
  grid.position.y = -5; grid.position.z = -5;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = .28;
  scene.add(grid);

  let pointerX = 0, pointerY = 0, scroll = 0, scheduled = false, previous = 0;
  const draw = (time: number) => {
    camera.position.x += (pointerX * 1.1 - camera.position.x) * .045;
    camera.position.y += (-pointerY * .65 + scroll * .55 - camera.position.y) * .045;
    camera.lookAt(0, 0, 0);
    const t = reduced ? 0 : time * .001;
    sculpture.rotation.y = -.22 + Math.sin(t * .25) * .12 + scroll * .65;
    sculpture.rotation.x = .28 + pointerY * .22 + scroll * .24;
    core.rotation.y = t * .12; core.rotation.z = t * .07;
    innerRing.rotation.z = .3 + t * .16;
    outerRing.rotation.z = -.3 - t * .09;
    blocks.rotation.z = .1 + t * .12;
    fragments.rotation.z = -t * .025;
    particles.rotation.y = t * .006 + scroll * .08;
    renderer.render(scene, camera);
  };
  const resize = () => {
    const mobile = innerWidth < 760;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
    system.position.set(mobile ? 1.6 : 3.45, mobile ? -3.0 : .05, 0);
    system.scale.setScalar(mobile ? .52 : 1);
    draw(0);
  };
  const shouldRun = () => !reduced && !document.hidden && !document.body.classList.contains('is-playing');
  const frame = (time: number) => {
    scheduled = false;
    if (!shouldRun()) return;
    if (time - previous >= 32) { previous = time; draw(time); }
    schedule();
  };
  const schedule = () => { if (!scheduled && shouldRun()) { scheduled = true; requestAnimationFrame(frame); } };
  window.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { pointerX = e.clientX / innerWidth - .5; pointerY = e.clientY / innerHeight - .5; } }, { passive: true });
  window.addEventListener('scroll', () => { scroll = window.scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight); }, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('gameplaychange', schedule);
  canvas.addEventListener('webglcontextlost', () => document.body.classList.remove('has-3d'));
  resize();
  document.body.classList.add('has-3d');
  schedule();
}
