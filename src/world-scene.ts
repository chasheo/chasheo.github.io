import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WorkshopCombat, type ActorState, COMBAT } from './workshop-gameplay';

const emit = (name: string, detail: unknown) => window.dispatchEvent(new CustomEvent(`workshop:${name}`, { detail }));
const clamp = THREE.MathUtils.clamp;
type Puppet = { root: THREE.Group; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; current: string; actionTime: number };

// Batch static architecture by material; animated leaves retain their hierarchy.
function batchEnvironment(world: THREE.Group) {
  world.updateMatrixWorld(true);
  const batches = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  world.traverse(o => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh || Array.isArray(o.material) || o.morphTargetInfluences) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (/Drifting/i.test(p.name)) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const key = o.material.uuid + Object.keys(g.attributes).sort().join(',') + Boolean(g.index);
    const batch = batches.get(key) || { material: o.material, geometries: [] as THREE.BufferGeometry[], meshes: [] as THREE.Mesh[] };
    batch.geometries.push(g); batch.meshes.push(o); batches.set(key, batch);
  });
  const group = new THREE.Group();
  batches.forEach(({ material, geometries, meshes }) => {
    const merged = mergeGeometries(geometries, false);
    if (merged) { const mesh = new THREE.Mesh(merged, material); mesh.receiveShadow = true; group.add(mesh); meshes.forEach(o => { o.visible = false; }); }
    geometries.forEach(g => g.dispose());
  });
  return group;
}

function puppet(gltf: GLTF): Puppet {
  const root = new THREE.Group(); root.add(gltf.scene);
  gltf.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const actions = new Map<string, THREE.AnimationAction>();
  gltf.animations.forEach(clip => { actions.set(clip.name.toLowerCase().split(/[|.]/).at(-1)!, mixer.clipAction(clip)); });
  return { root, mixer, actions, current: '', actionTime: 0 };
}

function animate(p: Puppet, actor: ActorState, dt: number, opponent = false) {
  const name = p.actions.has(actor.action) ? actor.action : 'idle';
  if (name !== p.current || actor.actionTime < p.actionTime - .02) {
    const next = p.actions.get(name), previous = p.actions.get(p.current);
    if (next) {
      next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
      next.setLoop(['idle', 'run'].includes(name) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      next.clampWhenFinished = true; next.fadeIn(.12).play();
      if (previous && previous !== next) previous.fadeOut(.12);
    }
    p.current = name;
  }
  p.actionTime = actor.actionTime;
  p.root.position.set(actor.x, .025, actor.z); p.root.rotation.y = actor.facing;
  const action = p.actions.get(name);
  // One-shot animation duration follows combat timing; idle/run remain free-running.
  const duration = name === 'attack' ? (opponent ? COMBAT.enemyAttackDuration : COMBAT.playerAttackDuration) : name === 'dodge' ? COMBAT.dodgeDuration : name === 'hurt' ? (opponent ? .28 : .36) : 0;
  if (action && duration) action.setEffectiveTimeScale(action.getClip().duration / duration);
  p.mixer.update(dt);
}

export async function initWorldScene() {
  const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch { emit('ready', { ready: false, error: '当前设备无法开启 3D。你仍可直接浏览游戏库。' }); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = .95;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#aab4b5'); scene.fog = new THREE.Fog('#aab4b5', 30, 100);
  scene.add(new THREE.HemisphereLight(0xd3e4ed, 0x504232, 1.65));
  const sun = new THREE.DirectionalLight(0xffdfb0, 2.5); sun.position.set(-8, 13, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 });
  sun.shadow.normalBias = .04; sun.shadow.bias = -.0002; scene.add(sun);
  const camera = new THREE.PerspectiveCamera(43, 1, .08, 180); camera.position.set(-2, 3.2, 13.8);
  const target = new THREE.Vector3(0, 1.5, 0), desired = new THREE.Vector3(), desiredTarget = new THREE.Vector3();
  function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.fov = camera.aspect < .8 ? 52 : 43; camera.updateProjectionMatrix(); }
  resize(); window.addEventListener('resize', resize);
  const decoder = new DRACOLoader(); decoder.setDecoderPath('/draco/');
  const loader = new GLTFLoader(); loader.setDRACOLoader(decoder); emit('ready', { ready: false });
  let environment: GLTF, female: GLTF, male: GLTF;
  try {
    [environment, female, male] = await Promise.all([loader.loadAsync('/media/mountain-world.glb'), loader.loadAsync('/media/workshop/heroine.glb'), loader.loadAsync('/media/workshop/opponent.glb')]);
  } catch { emit('ready', { ready: false, error: '世界素材加载失败，请刷新重试。游戏库仍可直接访问。' }); return; }
  [...environment.scene.children].forEach(o => { if (/swordswoman|swordsman|Duel/i.test(o.name)) environment.scene.remove(o); });
  scene.add(environment.scene, batchEnvironment(environment.scene));
  const leaves = new THREE.AnimationMixer(environment.scene);
  environment.animations.filter(c => /Drifting/i.test(c.name)).forEach(c => leaves.clipAction(c).play());
  const hero = puppet(female), enemy = puppet(male); scene.add(hero.root, enemy.root);
  const game = new WorkshopCombat();
  let active = false, observing = false, yaw = .18, pitch = .42, distance = 6.8, drag = false;
  let pointerX = 0, pointerY = 0, hudAt = 0, time = 0;
  const keys = new Set<string>(); let attackPressed = false, dodgePressed = false;
  const rings = new THREE.Group(); scene.add(rings);
  function groundRing(color: number, radius: number) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(radius - .025, radius, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .45, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = .04; rings.add(mesh); return mesh;
  }
  const heroRing = groundRing(0xe9dab7, .48), enemyRing = groundRing(0xd9684f, .5), warning = groundRing(0xff7848, 1.7);
  const portal = new THREE.Group(); portal.position.set(3, 0, -.6); scene.add(portal);
  const frameMesh = new THREE.Mesh(new THREE.TorusGeometry(1.13, .045, 12, 80), new THREE.MeshStandardMaterial({ color: 0x645a48, metalness: .7, roughness: .38 }));
  frameMesh.position.y = 1.6; portal.add(frameMesh);
  const portalMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, open: { value: 0 }, tint: { value: new THREE.Color(0x89d4b2) } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec2 vUv; uniform float time; uniform float open; uniform vec3 tint;
      void main(){vec2 p=(vUv-.5)*2.; float r=length(p); float a=atan(p.y,p.x);
      float rim=smoothstep(.72,.95,r)*(1.-smoothstep(.95,1.,r));
      float wave=sin(a*8.-r*18.+time*1.8)*.5+.5;
      float mist=(1.-r)*(.18+.13*wave); float alpha=(rim+mist)*mix(.08,.85,open);
      gl_FragColor=vec4(tint*(.7+rim*1.5),alpha); }`
  });
  const surface = new THREE.Mesh(new THREE.CircleGeometry(1.08, 64), portalMaterial); surface.position.y = 1.6; portal.add(surface);
  const beacon = new THREE.PointLight(0x89d4b2, 0, 6, 2); beacon.position.set(0, 1.3, .5); portal.add(beacon);
  const sparks: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
  const sparkGeometry = new THREE.SphereGeometry(.025, 4, 3);
  function hitEffect(x: number, z: number, color: number) {
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(sparkGeometry, new THREE.MeshBasicMaterial({ color, transparent: true })); mesh.position.set(x, .9, z); scene.add(mesh);
      sparks.push({ mesh, velocity: new THREE.Vector3((Math.random() - .5) * 3, Math.random() * 2, (Math.random() - .5) * 3), life: .45 });
    }
  }
  const slash = new THREE.Mesh(new THREE.RingGeometry(.7, .84, 40, 1, -.7, 1.4), new THREE.MeshBasicMaterial({ color: 0xffe5ac, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  slash.rotation.x = -Math.PI / 2; scene.add(slash);
  let audio: AudioContext | undefined;
  function sound(hit: boolean) {
    if (!audio || audio.state !== 'running') return;
    const oscillator = audio.createOscillator(), gain = audio.createGain(); oscillator.type = hit ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(hit ? 180 : 500, audio.currentTime); oscillator.frequency.exponentialRampToValueAtTime(hit ? 55 : 120, audio.currentTime + .12);
    gain.gain.setValueAtTime(.035, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .15);
    oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .16);
  }
  const nearPortal = () => game.won && Math.hypot(game.player.x - portal.position.x, game.player.z - portal.position.z) < 1.9;
  function enterPortal() { if (!nearPortal()) return; emit('exit', {}); document.getElementById('play')?.scrollIntoView({ behavior: 'smooth' }); }
  window.addEventListener('workshop:portal', enterPortal);
  function publish() { emit('state', { playerHealth: game.player.health, enemyHealth: game.enemy.health, maxPlayerHealth: game.player.maxHealth, maxEnemyHealth: game.enemy.maxHealth, won: game.won, lost: game.lost, canEnterPortal: nearPortal(), mode: observing ? 'observe' : 'explore' }); }
  function clearInput() { keys.clear(); attackPressed = dodgePressed = false; drag = false; }
  window.addEventListener('workshop:start', () => { active = true; observing = false; clearInput(); if (!audio) audio = new AudioContext(); void audio.resume(); publish(); });
  window.addEventListener('workshop:exit', () => { active = false; clearInput(); });
  window.addEventListener('workshop:retry', () => { game.reset(); observing = false; clearInput(); publish(); });
  window.addEventListener('workshop:observe', () => { observing = !observing; clearInput(); publish(); });
  window.addEventListener('workshop:theme', e => { const color = (e as CustomEvent).detail.theme === 'orbital' ? 0x85b9ff : 0x89d4b2; portalMaterial.uniforms.tint.value.setHex(color); beacon.color.setHex(color); });
  function input(key: string, pressed: boolean) {
    if (!active || observing) return;
    if (pressed) { keys.add(key); if (key === 'attack') attackPressed = true; if (key === 'dodge') dodgePressed = true; } else keys.delete(key);
  }
  window.addEventListener('workshop:input', e => { const d = (e as CustomEvent).detail; input(d.key, d.pressed); });
  const keyMap: Record<string, string> = { KeyW: 'w', ArrowUp: 'w', KeyS: 's', ArrowDown: 's', KeyA: 'a', ArrowLeft: 'a', KeyD: 'd', ArrowRight: 'd', KeyJ: 'attack', Space: 'dodge', ShiftLeft: 'dodge' };
  window.addEventListener('keydown', e => {
    if (!active || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (keyMap[e.code]) { e.preventDefault(); if (!e.repeat) input(keyMap[e.code], true); }
    if (e.code === 'KeyE') enterPortal();
  });
  window.addEventListener('keyup', e => { if (keyMap[e.code]) input(keyMap[e.code], false); });
  window.addEventListener('blur', clearInput); document.addEventListener('visibilitychange', clearInput);
  canvas.addEventListener('pointerdown', e => { if (!active) return; drag = true; pointerX = e.clientX; pointerY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!drag || !active) return; yaw -= (e.clientX - pointerX) * .006; pitch = clamp(pitch + (e.clientY - pointerY) * .004, .2, 1.05); pointerX = e.clientX; pointerY = e.clientY; });
  canvas.addEventListener('pointerup', () => { drag = false; }); canvas.addEventListener('pointercancel', () => { drag = false; });
  canvas.addEventListener('wheel', e => { if (active) { e.preventDefault(); distance = clamp(distance + e.deltaY * .004, 3.5, 9); } }, { passive: false });
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); active = false; emit('exit', {}); emit('ready', { ready: false, error: '3D 画面已暂停，请刷新页面恢复。' }); });
  const clock = new THREE.Clock();
  const anchorPositions = [new THREE.Vector3(-2, 3.2, 13.8), new THREE.Vector3(5, 3.3, 8), new THREE.Vector3(-4.5, 3, 7)];
  const anchorTargets = [new THREE.Vector3(0, 1.4, -.4), new THREE.Vector3(2.3, 1.5, -2), new THREE.Vector3(0, 1.5, -1.5)];
  const raycaster = new THREE.Raycaster(), obstacles: THREE.Object3D[] = [];
  for (const [x, z, w, d, h] of [[2, -7, 7, 4, 7], [-7, -7, 4, 4, 5], [9, -14, 5, 5, 7]]) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false })); box.position.set(x, h / 2, z); scene.add(box); obstacles.push(box);
  }
  document.body.classList.add('has-3d'); emit('ready', { ready: true }); publish();
  function frame() {
    requestAnimationFrame(frame); const dt = Math.min(clock.getDelta(), .05);
    if (document.hidden || document.body.classList.contains('is-playing')) return;
    time += dt; leaves.update(dt);
    if (active && !observing) {
      const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const v = forward.multiplyScalar(Number(keys.has('w')) - Number(keys.has('s'))).addScaledVector(right, Number(keys.has('d')) - Number(keys.has('a')));
      const events = game.update(dt, { moveX: v.x, moveZ: v.z, attack: attackPressed, dodge: dodgePressed }); attackPressed = dodgePressed = false;
      events.forEach(e => { if (e.type === 'hit') { hitEffect(e.x, e.z, e.actor === 'enemy' ? 0xffd291 : 0xd67863); sound(true); } if (e.type === 'dodge') sound(false); });
    }
    const resting = !active || observing;
    animate(hero, resting && !game.lost ? { ...game.player, action: 'idle', actionTime: time } : game.player, dt);
    animate(enemy, game.lost || (resting && !game.won) ? { ...game.enemy, action: 'idle', actionTime: time } : game.enemy, dt, true);
    heroRing.position.set(game.player.x, .045, game.player.z); enemyRing.position.set(game.enemy.x, .046, game.enemy.z); rings.visible = active; enemyRing.visible = !game.won;
    warning.position.set(game.enemy.x, .05, game.enemy.z); warning.visible = active && game.enemyWindup > 0 && !game.won;
    warning.scale.setScalar(.5 + game.enemyWindup * .5); (warning.material as THREE.MeshBasicMaterial).opacity = .25 + game.enemyWindup * .55;
    slash.position.set(game.player.x, 1, game.player.z); slash.rotation.z = -game.player.facing + Math.PI / 2;
    (slash.material as THREE.MeshBasicMaterial).opacity = game.player.action === 'attack' && game.player.actionTime > .15 && game.player.actionTime < .45 ? .55 : 0;
    for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.life -= dt; s.velocity.y -= dt * 5; s.mesh.position.addScaledVector(s.velocity, dt); (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.life * 2); if (s.life <= 0) { scene.remove(s.mesh); (s.mesh.material as THREE.Material).dispose(); sparks.splice(i, 1); } }
    portalMaterial.uniforms.open.value = THREE.MathUtils.damp(portalMaterial.uniforms.open.value, game.won ? 1 : .12, 2, dt); portalMaterial.uniforms.time.value = time; beacon.intensity = game.won ? 3 : .1;
    if (active) {
      desiredTarget.set(observing ? 0 : game.won ? game.player.x : game.player.x * .7 + game.enemy.x * .3, 1.1, observing ? -.5 : game.won ? game.player.z : game.player.z * .7 + game.enemy.z * .3);
      const viewDistance = distance * (camera.aspect < .8 ? 1.6 : 1);
      desired.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(viewDistance).add(desiredTarget);
      raycaster.set(desiredTarget, desired.clone().sub(desiredTarget).normalize()); raycaster.far = viewDistance; const collision = raycaster.intersectObjects(obstacles, false)[0];
      if (collision) desired.copy(desiredTarget).addScaledVector(raycaster.ray.direction, Math.max(1.8, collision.distance - .35));
    } else {
      const playTop = document.getElementById('play')?.getBoundingClientRect().top ?? 1000;
      const communityTop = document.getElementById('guestbook')?.getBoundingClientRect().top ?? 1000;
      const anchor = communityTop < innerHeight * .65 ? 2 : playTop < innerHeight * .7 ? 1 : 0;
      desired.copy(anchorPositions[anchor]); desiredTarget.copy(anchorTargets[anchor]);
    }
    const smoothing = 1 - Math.exp(-dt * 4); camera.position.lerp(desired, smoothing); target.lerp(desiredTarget, smoothing); camera.lookAt(target);
    if (active && time - hudAt > .1) { publish(); hudAt = time; }
    renderer.render(scene, camera);
  }
  frame();
}
