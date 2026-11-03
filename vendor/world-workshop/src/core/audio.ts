/**
 * Web Audio mixer. No AudioContext is created until the visitor explicitly enables sound
 * (taking control or pressing the sound toggle), so browsing never autoplays audio.
 */
export class AudioSys {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  buffers: Record<string, AudioBuffer> = {};
  private raw: Record<string, ArrayBuffer>;
  private loops: Record<string, { src: AudioBufferSourceNode; gain: GainNode; target: number }> = {};
  enabled = false;
  private decoding: Promise<void> | null = null;

  constructor(raw: Record<string, ArrayBuffer>) {
    this.raw = raw;
  }

  async enable() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this.decoding = Promise.all(
        Object.entries(this.raw).map(([k, b]) =>
          this.ctx!.decodeAudioData(b.slice(0)).then(
            (buf) => {
              this.buffers[k] = buf;
            },
            () => console.warn('[audio] decode failed', k),
          ),
        ),
      ).then(() => undefined);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
    this.enabled = true;
    await this.decoding;
  }

  disable() {
    this.enabled = false;
    for (const k of Object.keys(this.loops)) this.stopLoop(k, 0.3);
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => undefined);
  }

  play(name: string, vol = 1, rate = 1, vary = 0.04) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const b = this.buffers[name];
    if (!b) return;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 2 * vary);
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(g).connect(this.master);
    s.start();
  }

  loop(name: string, vol: number, fade = 1.5) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const cur = this.loops[name];
    if (cur) {
      cur.target = vol;
      cur.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      cur.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, fade / 3);
      return;
    }
    const b = this.buffers[name];
    if (!b) return;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(vol, this.ctx.currentTime, fade / 3);
    s.connect(g).connect(this.master);
    s.start();
    this.loops[name] = { src: s, gain: g, target: vol };
  }

  stopLoop(name: string, fade = 1.2) {
    const cur = this.loops[name];
    if (!cur || !this.ctx) return;
    cur.gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    const src = cur.src;
    setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }, fade * 1000 + 100);
    delete this.loops[name];
  }

  dispose() {
    for (const k of Object.keys(this.loops)) {
      try {
        this.loops[k].src.stop();
      } catch {
        /* noop */
      }
    }
    this.loops = {};
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.buffers = {};
  }
}
