import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Decorative WebGL is isolated from the game stream and never captures input.
export async function initWorldScene() {
  const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
  } catch { return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b1515');
  scene.fog = new THREE.FogExp2('#0b1515', .035);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 120);
  camera.position.set(0, 0, 12);

  const texture = await new THREE.TextureLoader().loadAsync('/media/forest-portal.png').catch(() => null);
  if (!texture) { renderer.dispose(); return; }
  texture.colorSpace = THREE.SRGBColorSpace;
  const background = new THREE.Mesh(new THREE.PlaneGeometry(56, 34), new THREE.MeshBasicMaterial({ map: texture, color: 0x8faaa0 }));
  background.position.set(0, 0, -27);
  scene.add(background);
  scene.add(new THREE.HemisphereLight(0xc8e1d0, 0x17251b, 2.1));
  const light = new THREE.DirectionalLight(0xe8d6a3, 1.4);
  light.position.set(5, 8, 7); scene.add(light);

  const portal = new THREE.Group();
  portal.position.set(3.2, .4, -2);
  portal.rotation.set(.2, -.38, -.12);
  scene.add(portal);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xd9eab1, transparent: true, opacity: .53 });
  const outer = new THREE.Mesh(new THREE.TorusGeometry(2.05, .012, 6, 160), ringMat);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(1.68, .008, 6, 160), ringMat.clone());
  inner.rotation.y = .37;
  portal.add(outer, inner);
  const points = new Float32Array(240 * 3);
  for (let i = 0; i < points.length; i += 3) {
    points[i] = (Math.random() - .5) * 32;
    points[i + 1] = (Math.random() - .5) * 19;
    points[i + 2] = Math.random() * 28 - 20;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xd8dfa6, size: .035, transparent: true, opacity: .55, depthWrite: false }));
  scene.add(dust);
  const shardGeometry = new THREE.OctahedronGeometry(.15, 0);
  const shardMaterial = new THREE.MeshBasicMaterial({ color: 0xdbe5c2, wireframe: true, transparent: true, opacity: .3 });
  for (let i = 0; i < 24; i++) {
    const shard = new THREE.Mesh(shardGeometry, shardMaterial);
    const angle = i * 2.399;
    const radius = 2.5 + (i % 5) * .55;
    shard.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * .7, (i % 4) * .4 - 1);
    shard.scale.setScalar(.35 + (i % 4) * .2);
    portal.add(shard);
  }
  // CC0 foliage is loaded after the first frame and shared between clones.
  // Avoid the large optional download when the visitor has enabled data saving.
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (!connection?.saveData) {
    void new GLTFLoader().loadAsync('/media/pine-web.glb').then(gltf => {
      const left = gltf.scene;
      left.scale.setScalar(3.8); left.position.set(-9, -4.8, -8);
      left.rotation.y = -.2; scene.add(left);
      const right = left.clone(); right.position.set(7.5, -5.3, -12);
      right.rotation.y = 2.2; right.scale.setScalar(4.5); scene.add(right);
      draw(0);
    }).catch(() => {});
  }
  let x = 0, y = 0, scroll = 0, scheduled = false, previous = 0;
  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
    portal.position.x = innerWidth < 760 ? 1.8 : 3.2;
    draw(0);
  };
  const draw = (time: number) => {
    camera.position.x += (x * .6 - camera.position.x) * .035;
    camera.position.y += (-y * .35 + scroll * .8 - camera.position.y) * .035;
    camera.lookAt(0, 0, -10);
    portal.rotation.z = -.12 + scroll * .45 + (reduced ? 0 : time * .000035);
    inner.rotation.z = reduced ? 0 : -time * .00009;
    dust.rotation.y = scroll * .14 + (reduced ? 0 : time * .000008);
    renderer.render(scene, camera);
  };
  const shouldRun = () => !reduced && !document.hidden && !document.body.classList.contains('is-playing');
  const frame = (time: number) => {
    scheduled = false;
    if (!shouldRun()) return;
    if (time - previous >= 32) { previous = time; draw(time); }
    schedule();
  };
  const schedule = () => { if (!scheduled && shouldRun()) { scheduled = true; requestAnimationFrame(frame); } };
  window.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { x = e.clientX / innerWidth - .5; y = e.clientY / innerHeight - .5; } }, { passive: true });
  window.addEventListener('scroll', () => { scroll = window.scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight); }, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('gameplaychange', schedule);
  canvas.addEventListener('webglcontextlost', () => document.body.classList.remove('has-3d'));
  resize();
  document.body.classList.add('has-3d');
  schedule();
}
