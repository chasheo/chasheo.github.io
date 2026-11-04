import * as THREE from 'three';
import type { Mode, Section } from '../types';
import { heightAt, SECTIONS } from '../world/layout';

/**
 * Camera rig decoupled from page scroll: each section is a local orbit (target, yaw, pitch, distance) the
 * camera eases toward from wherever it is; Inspect adds bounded drag/zoom; Play follows the heroine with
 * lock-on framing. Occlusion: a ray from the focus to the desired eye is tested against building meshes and the
 * eye is pulled in front of the first hit; the eye also never dips below the terrain.
 */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  yaw = 0.6;
  pitch = 0.2;
  dist = 14;
  target = new THREE.Vector3();
  // smoothed state
  private cTarget = new THREE.Vector3();
  private cYaw = 0.6;
  private cPitch = 0.2;
  private cDist = 14;
  userYaw = 0;
  userPitch = 0;
  userZoom = 0;
  playYaw = 0;
  playPitch = 0.22;
  shakeAmt = 0;
  private ray = new THREE.Raycaster();
  occluders: THREE.Object3D[] = [];
  private drift = 0;
  reduced = false;
  private lockBlend = 0;
  /** smoothed occlusion distance: snaps in when something blocks the view, eases back out when it clears */
  private occDist = Infinity;
  private occPulled = false;
  private lastHero = new THREE.Vector3(NaN, 0, 0);
  /** seconds left during which auto-framing yields to the visitor's own camera input */
  private manualT = 0;
  /** heroine is inside a house (its roof and upper walls are cut away): frame the room from above */
  indoor = false;
  private indoorBlend = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 1200);
  }

  snapTo(section: Section) {
    const s = SECTIONS[section];
    this.cTarget.set(s.target[0], s.target[1], s.target[2]);
    this.cYaw = s.yaw;
    this.cPitch = s.pitch;
    this.cDist = s.dist;
    this.occDist = Infinity;
    this.occPulled = false;
    this.apply(0);
  }

  update(dt: number, mode: Mode, section: Section, hero: THREE.Vector3, lockTarget: THREE.Vector3 | null, input: { yaw: number; pitch: number; zoom: number }, heroYaw = 0) {
    const s = SECTIONS[section];
    let tYaw: number, tPitch: number, tDist: number;
    const tTarget = new THREE.Vector3();
    let rate = 2.2; // seconds-ish smoothing for section transitions
    const heroSpeed = dt > 0 && Number.isFinite(this.lastHero.x) ? this.lastHero.distanceTo(hero) / dt : 0;
    this.lastHero.copy(hero);
    if (mode === 'play') {
      this.playYaw += input.yaw;
      this.playPitch = THREE.MathUtils.clamp(this.playPitch + input.pitch, -0.05, 0.85);
      this.userZoom = THREE.MathUtils.clamp(this.userZoom + input.zoom * 0.5, -1.5, 3);
      // the visitor's own camera input wins: suspend auto-framing for a moment after any mouse/key turn
      if (Math.abs(input.yaw) > 1e-4 || Math.abs(input.pitch) > 1e-4) this.manualT = 1.5;
      else this.manualT = Math.max(0, this.manualT - dt);
      const auto = this.manualT > 0 ? 0 : 1;
      tTarget.set(hero.x, hero.y + 1.35, hero.z);
      this.indoorBlend += ((this.indoor ? 1 : 0) - this.indoorBlend) * Math.min(1, dt * 3);
      this.lockBlend += ((lockTarget ? 1 : 0) - this.lockBlend) * Math.min(1, dt * 2.5);
      if (lockTarget) {
        // keep both fighters in frame: look at a point between them and swing behind the heroine
        // (indoors the heroine stays near the centre: walls would otherwise hide her under a far-off midpoint)
        const mid = tTarget.clone().lerp(lockTarget, 0.38 * (1 - 0.75 * this.indoorBlend));
        tTarget.lerp(mid, this.lockBlend);
        const away = Math.atan2(hero.x - lockTarget.x, hero.z - lockTarget.z);
        const dy = ((away - this.playYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        this.playYaw += dy * Math.min(1, dt * 2.2) * this.lockBlend * auto;
      } else if (heroSpeed > 0.8 && auto) {
        // free roaming without camera input: drift behind the heroine while she moves roughly forward
        // (strafing or running toward the camera does not swing it, so camera-relative steering stays stable)
        const behind = ((heroYaw + Math.PI - this.playYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        if (Math.abs(behind) < 1.2) this.playYaw += behind * Math.min(1, dt * 0.9) * (1 - this.lockBlend);
      }
      tYaw = this.playYaw;
      tPitch = this.playPitch;
      tDist = (5.4 + this.userZoom + this.lockBlend * 0.8) * (this.camera.aspect < 0.8 ? 1.25 : 1);
      // indoors: look down into the room over the cut-away walls (dollhouse framing), a bit closer
      tPitch = THREE.MathUtils.lerp(tPitch, Math.max(tPitch, 0.92), this.indoorBlend);
      tDist = THREE.MathUtils.lerp(tDist, Math.min(tDist, 5.6), this.indoorBlend);
      rate = 9;
    } else {
      if (mode === 'inspect') {
        this.userYaw = THREE.MathUtils.clamp(this.userYaw + input.yaw, -1.1, 1.1);
        this.userPitch = THREE.MathUtils.clamp(this.userPitch + input.pitch, -0.12, 0.4);
        this.userZoom = THREE.MathUtils.clamp(this.userZoom + input.zoom, s.minDist - s.dist, s.maxDist - s.dist);
      } else {
        // browse: slowly return any inspect offsets, gentle drift for life
        this.userYaw *= 1 - Math.min(1, dt * 0.6);
        this.userPitch *= 1 - Math.min(1, dt * 0.6);
        this.userZoom *= 1 - Math.min(1, dt * 0.6);
      }
      this.drift += dt;
      const dr = this.reduced ? 0 : Math.sin(this.drift * 0.07) * 0.08;
      tTarget.set(s.target[0], s.target[1], s.target[2]);
      tYaw = s.yaw + this.userYaw + (mode === 'browse' ? dr : 0);
      tPitch = s.pitch + this.userPitch;
      tDist = (s.dist + this.userZoom) * (this.camera.aspect < 0.8 ? 1.45 : 1);
      this.playYaw = this.cYaw;
    }
    const k = 1 - Math.exp(-dt * rate);
    const kk = this.reduced && mode !== 'play' ? 1 - Math.exp(-dt * rate * 2.5) : k;
    this.cTarget.lerp(tTarget, kk);
    const dy = ((tYaw - this.cYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.cYaw += dy * kk;
    this.cPitch += (tPitch - this.cPitch) * kk;
    this.cDist += (tDist - this.cDist) * kk;
    this.apply(dt);
  }

  private apply(dt: number) {
    const cp = Math.cos(this.cPitch);
    const dir = new THREE.Vector3(Math.sin(this.cYaw) * cp, Math.sin(this.cPitch), Math.cos(this.cYaw) * cp);
    let dist = this.cDist;
    // occlusion: pull the eye in front of buildings between focus and eye. Snap in at once (never look through a
    // wall), but ease back out so a ray grazing a column cannot make the camera pop between near and far.
    let want = dist;
    if (this.occluders.length) {
      this.ray.set(this.cTarget, dir);
      this.ray.far = dist;
      const hit = this.ray.intersectObjects(this.occluders, true).find((h) => !h.object.userData.cutaway);
      if (hit) want = Math.max(1.2, hit.distance - 0.35);
    }
    if (want < dist - 1e-4 && (want < this.occDist - 1e-4 || dt <= 0)) {
      this.occDist = want;
      this.occPulled = true;
    } else if (this.occPulled && dt > 0) {
      this.occDist += (want - this.occDist) * (1 - Math.exp(-dt * 1.6));
      if (want - this.occDist < 0.02) this.occPulled = false;
    } else {
      this.occDist = want;
      this.occPulled = false;
    }
    dist = Math.min(dist, this.occDist);
    const eye = this.cTarget.clone().addScaledVector(dir, dist);
    const g = heightAt(eye.x, eye.z) + 0.6;
    if (eye.y < g) eye.y = g;
    if (this.shakeAmt > 0 && !this.reduced) {
      const s = this.shakeAmt * this.shakeAmt * 0.12;
      eye.x += (Math.random() - 0.5) * s;
      eye.y += (Math.random() - 0.5) * s;
      eye.z += (Math.random() - 0.5) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    } else this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    this.camera.position.copy(eye);
    this.camera.lookAt(this.cTarget);
    this.target.copy(this.cTarget);
  }

  /** yaw used to make movement camera-relative */
  get moveYaw() {
    return this.cYaw;
  }

  shake(a: number) {
    this.shakeAmt = Math.min(1, Math.max(this.shakeAmt, a * 2));
  }
}
