import { AmbienceDirector, type AmbienceEvent, type AmbienceLevels } from './ambienceDirector';

/** What the ambience borrows from AudioSystem. */
export interface AmbienceHost {
  ctx: AudioContext;
  /** Feeds the world bus (muffled by flashbangs, like other world sounds). */
  dest: AudioNode;
  reverb: AudioNode;
  sample(id: string, dest: AudioNode, t: number, gain: number, rate?: number): boolean;
  noiseBurst(dest: AudioNode, t: number, len: number, gain: number, filter: { type: BiquadFilterType; freq: number; q?: number; endFreq?: number }): void;
  tone(dest: AudioNode, t: number, freq: number, len: number, gain: number, type?: OscillatorType, endFreq?: number): void;
}

/** Seconds between wind/duck parameter updates (cheaper than every frame). */
const PARAM_STEP_S = 0.25;
/** At most this many ambient one-shots (birds, far shots) at once. */
const MAX_EVENTS = 4;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Background sound: a looping wind bed plus occasional birds and far-off
 * fighting. Everything is 2D (stereo-panned toward a world direction) so it
 * never takes one of the spatial world voices.
 */
export class Ambience {
  readonly director: AmbienceDirector;
  private readonly bus: GainNode;
  private rumble: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private whistle: { gain: GainNode; filter: BiquadFilterNode; pan: StereoPannerNode } | null = null;
  private paramTimer = 0;
  private active: number[] = [];
  /** Listener forward on the ground plane (x, z). */
  private fwdX = 0;
  private fwdZ = -1;

  constructor(
    private readonly host: AmbienceHost,
    levels: AmbienceLevels,
  ) {
    this.director = new AmbienceDirector(levels);
    this.bus = host.ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(host.dest);
    if (levels.wind > 0) this.startWind();
  }

  setListenerForward(x: number, z: number): void {
    const len = Math.hypot(x, z);
    if (len < 1e-4) return;
    this.fwdX = x / len;
    this.fwdZ = z / len;
  }

  update(dt: number): void {
    const ctx = this.host.ctx;
    const t = ctx.currentTime;
    for (const e of this.director.update(dt)) this.play(e, t);
    this.paramTimer -= dt;
    if (this.paramTimer > 0) return;
    this.paramTimer = PARAM_STEP_S;
    const d = this.director;
    // A nearby fight pushes the background down so real gunfire reads clearly.
    this.bus.gain.setTargetAtTime(1 - 0.6 * d.tension, t, 0.4);
    const w = d.wind;
    if (this.rumble) {
      this.rumble.gain.gain.setTargetAtTime(0.07 * w, t, 0.6);
      this.rumble.filter.frequency.setTargetAtTime(160 + 260 * w, t, 0.8);
    }
    if (this.whistle) {
      this.whistle.gain.gain.setTargetAtTime(0.025 * w * w, t, 0.6);
      this.whistle.filter.frequency.setTargetAtTime(420 + 900 * w, t, 0.9);
      this.whistle.pan.pan.setTargetAtTime(Math.sin(t * 0.11) * 0.5, t, 1);
    }
  }

  dispose(): void {
    this.bus.disconnect();
  }

  /** Two filtered layers over one looping stereo noise bed. */
  private startWind(): void {
    const ctx = this.host.ctx;
    const len = Math.floor(ctx.sampleRate * 4);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      // Brown-ish noise: less hiss, more body than white noise.
      const data = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
        data[i] = last * 3.2;
      }
      // Crossfade the loop seam.
      const fade = Math.floor(ctx.sampleRate * 0.25);
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        data[i] = data[i]! * k + data[len - fade + i]! * (1 - k);
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopEnd = (len - Math.floor(ctx.sampleRate * 0.25)) / ctx.sampleRate;

    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 250;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    src.connect(rumbleFilter).connect(rumbleGain).connect(this.bus);
    this.rumble = { gain: rumbleGain, filter: rumbleFilter };

    const whistleFilter = ctx.createBiquadFilter();
    whistleFilter.type = 'bandpass';
    whistleFilter.frequency.value = 700;
    whistleFilter.Q.value = 3.5;
    const whistleGain = ctx.createGain();
    whistleGain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    src.connect(whistleFilter).connect(whistleGain).connect(pan).connect(this.bus);
    this.whistle = { gain: whistleGain, filter: whistleFilter, pan };
    src.start();
  }

  /** Stereo pan and "behind you" darkness for a world direction. */
  private direction(azimuth: number): { pan: number; front: number } {
    const dx = Math.sin(azimuth);
    const dz = Math.cos(azimuth);
    // Right = forward x up on the ground plane.
    const pan = dx * -this.fwdZ + dz * this.fwdX;
    const front = dx * this.fwdX + dz * this.fwdZ;
    return { pan: Math.max(-0.9, Math.min(0.9, pan)), front };
  }

  /** A short-lived chain: filter -> panner -> ambience bus (+ reverb send). */
  private chain(t: number, seconds: number, azimuth: number, cutoff: number, reverb: number): AudioNode | null {
    this.active = this.active.filter((until) => until > t);
    if (this.active.length >= MAX_EVENTS) return null;
    this.active.push(t + seconds);
    const ctx = this.host.ctx;
    const { pan, front } = this.direction(azimuth);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff * (0.75 + 0.25 * front);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    filter.connect(p).connect(this.bus);
    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      p.connect(send).connect(this.host.reverb);
    }
    return filter;
  }

  private play(e: AmbienceEvent, t: number): void {
    const h = this.host;
    switch (e.kind) {
      case 'bird': {
        const out = this.chain(t, 2, e.azimuth, 9000, 0.35);
        if (!out) return;
        if (h.sample('bird', out, t, 0.25 * e.gain, rand(0.92, 1.08))) return;
        this.birdCall(out, t, e.species, 0.045 * e.gain);
        return;
      }
      case 'burst': {
        const len = e.shots * e.interval + 1.6;
        const out = this.chain(t, len, e.azimuth, rand(700, 1300), 0.9);
        if (!out) return;
        for (let i = 0; i < e.shots; i++) {
          const at = t + i * e.interval * rand(0.9, 1.15);
          if (!h.sample(`gunfar_${e.cls}`, out, at, 0.07 * e.gain, rand(0.9, 1.0))) {
            h.noiseBurst(out, at, 0.25, 0.05 * e.gain, { type: 'lowpass', freq: 900, endFreq: 150 });
          }
        }
        return;
      }
      case 'single': {
        const out = this.chain(t, 2.2, e.azimuth, rand(800, 1500), 0.9);
        if (!out) return;
        if (!h.sample(`gunfar_${e.cls}`, out, t, 0.09 * e.gain, rand(0.9, 1.0))) {
          h.noiseBurst(out, t, 0.4, 0.06 * e.gain, { type: 'lowpass', freq: 900, endFreq: 120 });
        }
        return;
      }
      case 'artillery': {
        const out = this.chain(t, 3.6, e.azimuth, 380, 1);
        if (!out) return;
        if (!h.sample('explosion_far', out, t, 0.14 * e.gain, rand(0.75, 0.9))) {
          h.noiseBurst(out, t, 2.2, 0.1 * e.gain, { type: 'lowpass', freq: 400, endFreq: 60 });
        }
        h.tone(out, t, 55, 1.4, 0.06 * e.gain, 'sine', 30);
        return;
      }
    }
  }

  /** Procedural stand-in songs until a bird sample is loaded. */
  private birdCall(out: AudioNode, t: number, species: number, g: number): void {
    const tone = this.host.tone;
    switch (species) {
      case 0: {
        // Rising tweets.
        const n = 2 + Math.floor(Math.random() * 3);
        const base = rand(3000, 3600);
        for (let i = 0; i < n; i++) tone(out, t + i * 0.14, base, 0.07, g, 'sine', base * 1.55);
        break;
      }
      case 1: {
        // Fast trill.
        const n = 8 + Math.floor(Math.random() * 7);
        const f = rand(4200, 5200);
        for (let i = 0; i < n; i++) tone(out, t + i * 0.042, f * rand(0.97, 1.03), 0.028, g * 0.8, 'sine', f * 0.9);
        break;
      }
      case 2: {
        // Two-note whistle, high then low ("fee-bee").
        const f = rand(2600, 3100);
        tone(out, t, f, 0.2, g, 'sine', f * 0.98);
        tone(out, t + 0.26, f * 0.8, 0.26, g * 0.9, 'sine', f * 0.78);
        break;
      }
      default: {
        // Falling chirps.
        for (let i = 0; i < 3; i++) tone(out, t + i * 0.1, rand(4800, 5400), 0.05, g, 'sine', rand(2800, 3200));
      }
    }
  }
}
