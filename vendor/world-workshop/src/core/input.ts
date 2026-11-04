/**
 * Scoped input. Pointer listeners live on the canvas element only. Keyboard listeners are attached to
 * window but ignore everything unless the module is in Play mode, so host navigation, comments and the
 * UE stream keep their keys during Browse/Inspect.
 */
export interface InputState {
  move: { x: number; y: number };
  sprint: boolean;
  attackDown: boolean; // currently held
  attackPressed: number; // timestamp of last press edge (sim time)
  parryPressed: number;
  dodgePressed: number;
  jumpPressed: number;
  usePressed: number;
  camYaw: number; // accumulated deltas consumed by camera
  camPitch: number;
  zoom: number;
}

export class Input {
  state: InputState = { move: { x: 0, y: 0 }, sprint: false, attackDown: false, attackPressed: -1, parryPressed: -1, dodgePressed: -1, jumpPressed: -1, usePressed: -1, camYaw: 0, camPitch: 0, zoom: 0 };
  /** Shift: a tap (released within this many seconds) dodges, holding longer sprints */
  static readonly SPRINT_HOLD = 0.2;
  private shiftDownT = -1;
  private keys = new Set<string>();
  playActive = false;
  inspectActive = false;
  now = () => 0;
  onEscape: () => void = () => {};
  onRetry: () => void = () => {};
  private dragging = false;
  private dragBtn = -1;
  private lastX = 0;
  private lastY = 0;
  private pinch = 0;
  private touches = new Map<number, { x: number; y: number }>();
  private off: (() => void)[] = [];
  /** touch joystick vector (set by HUD) */
  stick = { x: 0, y: 0 };

  constructor(private el: HTMLElement) {
    const on = <K extends keyof HTMLElementEventMap>(t: HTMLElement | Window, ev: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(ev, fn as EventListener, opts));
    };
    on(window, 'keydown', (e: KeyboardEvent) => this.key(e, true));
    on(window, 'keyup', (e: KeyboardEvent) => this.key(e, false));
    on(window, 'blur', () => this.clear());
    on(el, 'contextmenu', (e: MouseEvent) => {
      if (this.playActive) e.preventDefault();
    });
    on(el, 'pointerdown', (e: PointerEvent) => this.pdown(e));
    on(window, 'pointermove', (e: PointerEvent) => this.pmove(e));
    on(window, 'pointerup', (e: PointerEvent) => this.pup(e));
    on(window, 'pointercancel', (e: PointerEvent) => this.pup(e));
    on(el, 'wheel', (e: WheelEvent) => this.wheel(e), { passive: false });
    on(document as unknown as HTMLElement, 'pointerlockchange', () => this.lockChange());
  }

  /** mouse-look sensitivity (radians per pixel) */
  lookSpeed = { yaw: 0.0032, pitch: 0.0024 };
  private lockedByUs = false;

  /** enter/leave Play: mouse-look only exists while playing; leaving releases any pointer lock we took */
  setPlay(on: boolean) {
    this.playActive = on;
    if (!on && this.lockedByUs && document.pointerLockElement === this.el) {
      this.lockedByUs = false;
      document.exitPointerLock?.();
    }
  }

  private requestLock() {
    if (document.pointerLockElement === this.el || !this.el.requestPointerLock) return;
    try {
      const r = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      this.lockedByUs = true;
      if (r && typeof r.catch === 'function') r.catch(() => (this.lockedByUs = false));
    } catch {
      this.lockedByUs = false; // pointer lock unavailable (iframe sandbox etc.): hover mouse-look still works
    }
  }

  private lockChange() {
    const locked = document.pointerLockElement === this.el;
    if (!locked && this.lockedByUs) {
      this.lockedByUs = false;
      // the browser swallows Esc to release the lock; treat that as the visitor's "back to homepage"
      if (this.playActive && document.hasFocus()) this.onEscape();
    }
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.playActive) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const k = e.code;
    const handled = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyJ', 'KeyK', 'KeyL', 'KeyQ', 'KeyR', 'Escape', 'KeyF', 'KeyI'];
    if (!handled.includes(k)) return;
    e.preventDefault();
    if (down) {
      if (this.keys.has(k)) return; // ignore auto-repeat: holding never re-triggers actions
      this.keys.add(k);
      const t0 = this.now();
      if (k === 'Space') this.state.jumpPressed = t0;
      if ((k === 'ShiftLeft' || k === 'ShiftRight') && this.shiftDownT < 0) this.shiftDownT = t0;
      if (k === 'KeyE' || k === 'KeyF') this.state.usePressed = t0;
      if (k === 'KeyJ') { this.state.attackPressed = t0; this.state.attackDown = true; }
      if (k === 'KeyK' || k === 'KeyI') this.state.parryPressed = t0;
      if (k === 'Escape') this.onEscape();
      if (k === 'KeyR') this.onRetry();
    } else {
      this.keys.delete(k);
      if (k === 'KeyJ') this.state.attackDown = false;
      if ((k === 'ShiftLeft' || k === 'ShiftRight') && !this.keys.has('ShiftLeft') && !this.keys.has('ShiftRight')) {
        const t = this.now();
        // a short tap is a dodge (fires on release); a hold was a sprint and does nothing on release
        if (this.shiftDownT >= 0 && t - this.shiftDownT < Input.SPRINT_HOLD) this.state.dodgePressed = t;
        this.shiftDownT = -1;
      }
    }
    this.updateMove();
  }

  private updateMove() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyA')) x -= 1;
    if (k.has('KeyD')) x += 1;
    this.state.sprint = this.shiftDownT >= 0 && this.now() - this.shiftDownT >= Input.SPRINT_HOLD;
    if (k.has('ArrowLeft')) this.state.camYaw += 0; // handled continuously in poll()
    this.state.move.x = x;
    this.state.move.y = y;
  }

  /** continuous inputs (arrow-key camera turn, joystick) */
  poll(dt: number) {
    if (!this.playActive) return;
    // Shift held past the tap threshold turns into a sprint without waiting for another key event
    if (this.shiftDownT >= 0 && this.now() - this.shiftDownT >= Input.SPRINT_HOLD) this.state.sprint = true;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyQ')) this.state.camYaw += 2.2 * dt;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyL')) this.state.camYaw -= 2.2 * dt;
    if (Math.abs(this.stick.x) + Math.abs(this.stick.y) > 0.05) {
      this.state.move.x = this.stick.x;
      this.state.move.y = this.stick.y;
      this.state.sprint = Math.hypot(this.stick.x, this.stick.y) > 0.92;
    } else if (!this.keys.size) {
      this.state.move.x = 0;
      this.state.move.y = 0;
    }
  }

  private pdown(e: PointerEvent) {
    if (e.target !== this.el && !(e.target as HTMLElement).classList?.contains('ww-canvas')) return;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      if (this.playActive || this.inspectActive) {
        this.dragging = true;
        this.dragBtn = 0;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
      return;
    }
    if (this.playActive) {
      e.preventDefault();
      if (e.button === 0 || e.button === 2) this.requestLock();
      if (e.button === 0) {
        this.state.attackPressed = this.now();
        this.state.attackDown = true;
      } else if (e.button === 2) this.state.parryPressed = this.now();
      else if (e.button === 1) {
        this.dragging = true;
        this.dragBtn = 1;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
      return;
    }
    if (this.inspectActive && e.button === 0) {
      this.dragging = true;
      this.dragBtn = 0;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  }

  private pmove(e: PointerEvent) {
    // Play: the mouse steers the camera directly (pointer-locked after the first click, otherwise while hovering
    // the game canvas); no button needs to be held
    if (this.playActive && e.pointerType === 'mouse' && !this.dragging) {
      const locked = document.pointerLockElement === this.el;
      const overCanvas = e.target === this.el || (e.target as HTMLElement | null)?.classList?.contains('ww-canvas');
      if (locked || overCanvas) {
        this.state.camYaw -= (e.movementX || 0) * this.lookSpeed.yaw;
        this.state.camPitch += (e.movementY || 0) * this.lookSpeed.pitch;
        return;
      }
    }
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2 && this.inspectActive) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.state.zoom += (this.pinch - d) * 0.01;
        this.pinch = d;
        return;
      }
    }
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.state.camYaw -= dx * 0.005;
    this.state.camPitch += dy * 0.004;
  }

  private pup(e: PointerEvent) {
    if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
    if (e.button === 0 && e.pointerType !== 'touch') this.state.attackDown = false;
    if (this.dragging && (e.pointerType === 'touch' || e.button === this.dragBtn)) this.dragging = false;
  }

  private wheel(e: WheelEvent) {
    // only zoom when the visitor is deliberately inspecting/playing over the canvas itself; otherwise let the host page scroll
    if (!(this.inspectActive || this.playActive)) return;
    if (e.target !== this.el && !(e.target as HTMLElement).classList?.contains('ww-canvas')) return;
    e.preventDefault();
    this.state.zoom += Math.sign(e.deltaY) * 0.6;
  }

  clear() {
    this.keys.clear();
    this.state.move.x = this.state.move.y = 0;
    this.state.attackDown = false;
    this.state.sprint = false;
    this.shiftDownT = -1;
    this.dragging = false;
    this.stick.x = this.stick.y = 0;
  }

  dispose() {
    if (this.lockedByUs && document.pointerLockElement === this.el) document.exitPointerLock?.();
    this.lockedByUs = false;
    for (const f of this.off) f();
    this.off = [];
  }
}
