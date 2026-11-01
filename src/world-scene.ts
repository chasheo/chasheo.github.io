import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export async function initWorldScene() {
  const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#a6b4ae');
  scene.fog = new THREE.Fog('#a6b4ae', 32, 110);
  scene.add(new THREE.HemisphereLight(0xe5efff, 0x64523c, 2.0));
  const sunlight = new THREE.DirectionalLight(0xffd6a0, 2.1);
  sunlight.position.set(-8, 15, 10);
  scene.add(sunlight);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.08, 250);
  const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  resize();
  window.addEventListener('resize', resize);
  const decoder = new DRACOLoader();
  decoder.setDecoderPath('/draco/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(decoder);
  const gltf = await loader.loadAsync('/media/mountain-world.glb');
  scene.add(gltf.scene);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  gltf.animations.forEach(clip => mixer.clipAction(clip).play());
  document.body.classList.add('has-3d');
  const clock = new THREE.Clock();
  const from = new THREE.Vector3(-2.0, 3.2, 13.8);
  const near = new THREE.Vector3(2.4, 1.66, 4.05);
  const end = new THREE.Vector3(2.0, 2.2, 6.4);
  const fromTarget = new THREE.Vector3(.15, 1.7, -.8);
  const nearTarget = new THREE.Vector3(0, 1.22, -.03);
  const endTarget = new THREE.Vector3(0, 1.25, -.1);
  const target = new THREE.Vector3();
  function frame() {
    requestAnimationFrame(frame);
    const delta = Math.min(clock.getDelta(), .1);
    if (!document.hidden) mixer.update(delta);
    const range = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const progress = THREE.MathUtils.clamp(scrollY / range, 0, 1);
    if (progress < .65) {
      const t = progress / .65;
      camera.position.lerpVectors(from, near, t);
      target.lerpVectors(fromTarget, nearTarget, t);
    } else {
      const t = (progress - .65) / .35;
      camera.position.lerpVectors(near, end, t);
      target.lerpVectors(nearTarget, endTarget, t);
    }
    camera.lookAt(target);
    renderer.render(scene, camera);
  }
  frame();
}
