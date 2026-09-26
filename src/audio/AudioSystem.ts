import type * as THREE from 'three';
import type { WeaponClass } from '@/weapons/weaponData';
import type { ImpactSurface } from '@/physics/surfaces';
import type { ReloadCue } from '@/core/events';

interface GunVoice {
  /** Low-pass cutoff of the body noise, Hz. */
  cutoff: number;
  /** Body thump frequency, Hz. */
  thump: number;
  decay: number;
  gain: number;
  /** Reverb send; bigger guns echo more. */
  tail: number;
}

const VOICES: Record<WeaponClass, GunVoice> = {
  ar: { cutoff: 5200, thump: 85, decay: 0.16, gain: 0.55, tail: 0.35 },
  smg: { cutoff: 6500, thump: 115, decay: 0.11, gain: 0.45, tail: 0.25 },
  lmg: { cutoff: 4200, thump: 72, decay: 0.2, gain: 0.6, tail: 0.4 },
  sg: { cutoff: 2800, thump: 58, decay: 0.3, gain: 0.8, tail: 0.5 },
  dmr: { cutoff: 4000, thump: 68, decay: 0.26, gain: 0.7, tail: 0.5 },
  sr: { cutoff: 3200, thump: 52, decay: 0.4, gain: 0.85, tail: 0.65 },
  pistol: { cutoff: 6000, thump: 135, decay: 0.12, gain: 0.45, tail: 0.25 },
};

/** Filter band and length describing how each surface sounds when struck. */
const SURFACE_SOUND: Record<ImpactSurface, { type: BiquadFilterType; freq: number; q: number; len: number; ring?: number[] }> = {
  dirt: { type: 'lowpass', freq: 900, q: 0.7, len: 0.08 },
  concrete: { type: 'bandpass', freq: 2200, q: 1.2, len: 0.06 },
  brick: { type: 'bandpass', freq: 1600, q: 1.1, len: 0.07 },
  metal: { type: 'bandpass', freq: 3200, q: 2, len: 0.05, ring: [2240, 3170, 4410] },
  wood: { type: 'bandpass', freq: 650, q: 1.5, len: 0.09 },
  rubber: { type: 'lowpass', freq: 400, q: 0.8, len: 0.08 },
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Surface -> recorded sample set (see sounds.manifest.json). */
const STEP_SAMPLE: Record<ImpactSurface, string> = {
  dirt: 'step_dirt',
  concrete: 'step_concrete',
  brick: 'step_concrete',
  metal: 'step_concrete',
  wood: 'step_wood',
  rubber: 'step_dirt',
};
const HIT_SAMPLE: Record<ImpactSurface, string> = {
  dirt: 'hit_dirt',
  concrete: 'hit_concrete',
  brick: 'hit_concrete',
  metal: 'hit_metal',
  wood: 'hit_wood',
  rubber: 'hit_rubber',
};
/** Beyond this distance remote gunfire uses the "far" recordings. */
const FAR_GUNFIRE_M = 45;

/**
 * Game audio. Recorded CC0 samples (public/assets/sounds) are used when loaded;
 * every sound also has a procedural fallback so nothing goes silent if a file is
 * missing. Player-owned sounds are 2D; world sounds go through HRTF panners that
 * follow the camera. Everything feeds a reverb send and a compressor.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Muffles the world (not UI) when deafened by a flashbang. */
  private muffle: BiquadFilterNode | null = null;
  private world: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private tinnitus: { osc: OscillatorNode; gain: GainNode } | null = null;
  private heartbeatAt = 0;
  private impactBudget = 0;
  /** Encoded sample files fetched before the AudioContext exists. */
  private raw = new Map<string, ArrayBuffer[]>();
  private samples = new Map<string, AudioBuffer[]>();

  constructor(private volume: number) {}

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) this.build();
    if (this.ctx!.state === 'suspended') void this.ctx!.resume();
    this.decodePending();
  }

  /** Fetches the sample index and files; decoding waits for the AudioContext. */
  async preload(baseUrl: string): Promise<void> {
    try {
      const index = (await (await fetch(`${baseUrl}index.json`)).json()) as Record<string, number>;
      await Promise.all(
        Object.entries(index).map(async ([id, n]) => {
          const urls = n > 1 ? Array.from({ length: n }, (_, i) => `${baseUrl}${id}_${i}.wav`) : [`${baseUrl}${id}.wav`];
          const files = await Promise.all(urls.map(async (u) => (await fetch(u)).arrayBuffer()));
          this.raw.set(id, files);
        }),
      );
    } catch (err) {
      console.warn('[audio] samples unavailable, using procedural sounds', err);
    }
    this.decodePending();
  }

  private decodePending(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const [id, files] of this.raw) {
      Promise.all(files.map((f) => ctx.decodeAudioData(f)))
        .then((bufs) => this.samples.set(id, bufs))
        .catch((err) => console.warn(`[audio] decode failed: ${id}`, err));
    }
    this.raw.clear();
  }

  /** Plays a random variant of a sample; returns false if it isn't loaded. */
  private sample(id: string, dest: AudioNode, t: number, gain: number, rate = 1): boolean {
    const bufs = this.samples.get(id);
    if (!bufs || bufs.length === 0) return false;
    const src = this.ctx!.createBufferSource();
    src.buffer = bufs[Math.floor(Math.random() * bufs.length)]!;
    src.playbackRate.value = rate;
    const g = this.ctx!.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start(t);
    return true;
  }

  private build(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);

    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.connect(this.master);
    this.world = ctx.createGain();
    this.world.connect(this.muffle);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(1.6, 2.8);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.world);

    const len = Math.floor(ctx.sampleRate * 1);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Outdoor-ish impulse: sparse early reflections + exponentially decaying noise. */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * 0.5;
      for (const ms of [23, 41, 67, 97, 131]) {
        const at = Math.floor((ms / 1000) * ctx.sampleRate) + ch * 7;
        if (at < len) d[at] = (d[at] ?? 0) + 0.6 * (1 - ms / 200);
      }
    }
    return buf;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Keeps the Web Audio listener on the camera. */
  setListener(pos: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void {
    const l = this.ctx?.listener;
    if (!l || !l.positionX) return;
    const t = this.ctx!.currentTime;
    l.positionX.setValueAtTime(pos.x, t);
    l.positionY.setValueAtTime(pos.y, t);
    l.positionZ.setValueAtTime(pos.z, t);
    l.forwardX.setValueAtTime(forward.x, t);
    l.forwardY.setValueAtTime(forward.y, t);
    l.forwardZ.setValueAtTime(forward.z, t);
    l.upX.setValueAtTime(up.x, t);
    l.upY.setValueAtTime(up.y, t);
    l.upZ.setValueAtTime(up.z, t);
  }

  // ---------- building blocks ----------

  /** Destination for a sound: 2D (player) or a panner at `pos`. Also returns a reverb send. */
  private out(pos: THREE.Vector3 | null, reverbSend: number): AudioNode {
    const ctx = this.ctx!;
    const input = ctx.createGain();
    let dry: AudioNode = input;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 2.5;
      p.rolloffFactor = 1.1;
      p.maxDistance = 600;
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
      input.connect(p);
      dry = p;
    }
    dry.connect(this.world!);
    if (reverbSend > 0) {
      const send = ctx.createGain();
      send.gain.value = reverbSend;
      dry.connect(send).connect(this.reverb!);
    }
    return input;
  }

  private noiseBurst(
    dest: AudioNode,
    t: number,
    len: number,
    gain: number,
    filter: { type: BiquadFilterType; freq: number; q?: number; endFreq?: number },
    rate = 1,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.setValueAtTime(filter.freq, t);
    if (filter.endFreq) f.frequency.exponentialRampToValueAtTime(filter.endFreq, t + len);
    f.Q.value = filter.q ?? 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.02);
  }

  private tone(
    dest: AudioNode,
    t: number,
    freq: number,
    len: number,
    gain: number,
    type: OscillatorType = 'sine',
    endFreq?: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  private get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  // ---------- weapons ----------

  gunshot(cls: WeaponClass, ads: boolean): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const v = VOICES[cls];
    const pitch = rand(0.94, 1.06);
    const out = this.out(null, v.tail);
    const g = v.gain * (ads ? 0.92 : 1);
    if (this.sample(`gun_${cls}`, out, t, 0.95, rand(0.97, 1.03))) {
      // Recordings are taken beside the shooter; a little sub thump restores first-person weight.
      this.tone(out, t, v.thump * 2 * pitch, 0.1, g * 0.35, 'sine', v.thump * 0.5);
    } else {
      // Transient crack, body, low thump and a hint of mechanism.
      this.noiseBurst(out, t, 0.012, g * 0.9, { type: 'highpass', freq: 2500 });
      this.noiseBurst(out, t, v.decay, g, { type: 'lowpass', freq: v.cutoff * pitch, endFreq: 350 }, pitch);
      this.tone(out, t, v.thump * 2 * pitch, 0.12, g * 0.9, 'sine', v.thump * 0.5);
      this.tone(out, t + 0.004, 3100 * pitch, 0.015, g * 0.08, 'square');
    }
    // Brass hitting the ground a moment later.
    if (cls !== 'sg' && Math.random() < 0.7) {
      const d = t + rand(0.35, 0.6);
      this.tone(out, d, rand(4800, 6200), 0.035, 0.03, 'triangle');
      this.tone(out, d + rand(0.06, 0.12), rand(5200, 6800), 0.025, 0.02, 'triangle');
    }
  }

  /** Someone else's gunfire at a world position (bots, M3). */
  remoteGunshot(cls: WeaponClass, pos: THREE.Vector3, distance: number): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(pos, 0.6);
    const id = distance > FAR_GUNFIRE_M ? `gunfar_${cls}` : `gun_${cls}`;
    if (!this.sample(id, out, t, 0.9, rand(0.96, 1.04))) {
      const v = VOICES[cls];
      this.noiseBurst(out, t, v.decay * 1.5, v.gain, { type: 'lowpass', freq: Math.max(800, v.cutoff - distance * 20), endFreq: 200 });
    }
  }

  reloadCue(cue: ReloadCue): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0.05);
    switch (cue) {
      case 'magOut':
        this.tone(out, t, 1800, 0.02, 0.1, 'square');
        this.noiseBurst(out, t + 0.02, 0.09, 0.12, { type: 'bandpass', freq: 1500, q: 1.5, endFreq: 900 });
        break;
      case 'magIn':
        this.sample('mag_in', out, t, 0.25, 1.5);
        this.noiseBurst(out, t, 0.035, 0.3, { type: 'bandpass', freq: 2600, q: 1.4 });
        this.tone(out, t, 180, 0.06, 0.2, 'sine', 90);
        break;
      case 'chamber':
        this.noiseBurst(out, t, 0.03, 0.25, { type: 'bandpass', freq: 3200, q: 2 });
        this.noiseBurst(out, t + 0.09, 0.04, 0.3, { type: 'bandpass', freq: 2500, q: 2 });
        break;
      case 'shell':
        this.tone(out, t, 1400, 0.02, 0.08, 'square');
        this.noiseBurst(out, t + 0.015, 0.04, 0.18, { type: 'bandpass', freq: 900, q: 1.2 });
        break;
    }
  }

  /** Bolt or pump action. */
  cycle(cls: WeaponClass): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0.08);
    const f = cls === 'sg' ? 1400 : 2600;
    this.noiseBurst(out, t, 0.05, 0.28, { type: 'bandpass', freq: f, q: 1.6 });
    this.noiseBurst(out, t + 0.05, 0.08, 0.08, { type: 'bandpass', freq: f * 0.6, q: 1, endFreq: f });
    this.noiseBurst(out, t + 0.15, 0.05, 0.32, { type: 'bandpass', freq: f * 1.15, q: 1.8 });
  }

  switchWeapon(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    this.noiseBurst(out, t, 0.12, 0.08, { type: 'bandpass', freq: 600, q: 0.8, endFreq: 1400 });
    this.tone(out, t + 0.1, 1500, 0.02, 0.06, 'square');
  }

  click(): void {
    if (!this.ready) return;
    this.tone(this.out(null, 0), this.ctx!.currentTime, 2400, 0.025, 0.15, 'square');
  }

  // ---------- world ----------

  impact(pos: THREE.Vector3, surface: ImpactSurface): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    // Budget so shotgun volleys don't stack a dozen identical transients.
    if (t < this.impactBudget) return;
    this.impactBudget = t + 0.015;
    const s = SURFACE_SOUND[surface];
    const out = this.out(pos, 0.2);
    if (this.sample(HIT_SAMPLE[surface], out, t, 0.7, rand(0.9, 1.15))) return;
    this.noiseBurst(out, t, s.len, 0.5, { type: s.type, freq: s.freq * rand(0.85, 1.15), q: s.q });
    if (s.ring) for (const f of s.ring) this.tone(out, t, f * rand(0.97, 1.03), 0.22, 0.06, 'sine');
  }

  footstep(surface: ImpactSurface, sprinting: boolean): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0.03);
    const g = sprinting ? 0.22 : 0.14;
    if (this.sample(STEP_SAMPLE[surface], out, t, sprinting ? 0.55 : 0.38, rand(0.92, 1.08))) return;
    const s = SURFACE_SOUND[surface];
    if (surface === 'dirt') {
      // Gravel crunch: a few tiny grains.
      for (let i = 0; i < 4; i++) {
        this.noiseBurst(out, t + i * rand(0.006, 0.014), 0.03, g * 0.7, { type: 'bandpass', freq: rand(1800, 3500), q: 1.5 });
      }
      this.noiseBurst(out, t, 0.06, g, { type: 'lowpass', freq: 500 });
    } else {
      this.noiseBurst(out, t, s.len, g, { type: s.type, freq: s.freq * rand(0.8, 1.1), q: s.q });
      if (s.ring) this.tone(out, t, 900 * rand(0.9, 1.1), 0.12, g * 0.2, 'sine');
    }
  }

  /** Someone else's footstep at a world position (bots): quieter, spatialized. */
  remoteFootstep(surface: ImpactSurface, pos: THREE.Vector3, sprinting: boolean): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.sample(STEP_SAMPLE[surface], this.out(pos, 0.05), t, sprinting ? 0.5 : 0.32, rand(0.9, 1.1));
  }

  land(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0.05);
    this.tone(out, t, 110, 0.12, 0.3, 'sine', 55);
    this.noiseBurst(out, t, 0.08, 0.2, { type: 'lowpass', freq: 700 });
  }

  // ---------- grenades ----------

  pinAndThrow(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    this.tone(out, t, 3000, 0.02, 0.1, 'square');
    this.tone(out, t + 0.05, 2200, 0.03, 0.06, 'triangle');
    this.noiseBurst(out, t + 0.25, 0.25, 0.14, { type: 'bandpass', freq: 400, q: 0.8, endFreq: 1400 });
  }

  grenadeBounce(pos: THREE.Vector3, speed: number): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(pos, 0.1);
    const g = Math.min(0.5, speed / 20);
    if (this.sample('grenade_bounce', out, t, g * 1.4, rand(1.1, 1.3))) return;
    this.tone(out, t, rand(1700, 2000), 0.09, g * 0.3, 'triangle');
    this.tone(out, t, rand(2600, 2900), 0.06, g * 0.2, 'sine');
    this.noiseBurst(out, t, 0.04, g * 0.5, { type: 'bandpass', freq: 1200, q: 1 });
  }

  explosion(pos: THREE.Vector3, distance: number): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(pos, 0.9);
    // Distance muffles high frequencies.
    const top = Math.max(500, 6000 - distance * 60);
    if (this.sample(distance > 60 ? 'explosion_far' : 'explosion', out, t, 1, rand(0.94, 1.04))) {
      this.tone(out, t, 80, 0.8, 0.7, 'sine', 28);
      return;
    }
    this.noiseBurst(out, t, 0.04, 1.4, { type: 'lowpass', freq: top });
    this.noiseBurst(out, t, 1.6, 1.2, { type: 'lowpass', freq: Math.min(top, 1400), endFreq: 90 });
    this.tone(out, t, 90, 0.9, 1.2, 'sine', 28);
    for (let i = 0; i < 6; i++) {
      this.noiseBurst(out, t + rand(0.05, 0.5), 0.05, 0.15, { type: 'bandpass', freq: rand(800, 2500), q: 2 });
    }
  }

  flashbang(pos: THREE.Vector3): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(pos, 0.8);
    this.noiseBurst(out, t, 0.03, 1.6, { type: 'highpass', freq: 1500 });
    this.noiseBurst(out, t, 0.6, 0.6, { type: 'lowpass', freq: 3000, endFreq: 200 });
  }

  smokePop(pos: THREE.Vector3, duration: number): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(pos, 0.2);
    this.tone(out, t, 160, 0.1, 0.4, 'sine', 70);
    this.noiseBurst(out, t + 0.05, Math.min(8, duration * 0.4), 0.18, { type: 'bandpass', freq: 4200, q: 0.6, endFreq: 2500 });
  }

  /** Ringing ears + muffled world for `duration` seconds. */
  deafen(intensity: number, duration: number): void {
    if (!this.ready || intensity <= 0) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.tinnitus?.osc.stop();
    const osc = ctx.createOscillator();
    osc.frequency.value = 3700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09 * intensity, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration + 1);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + duration + 1.1);
    this.tinnitus = { osc, gain: g };
    const f = this.muffle!.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(Math.max(300, 2000 * (1 - intensity)), t);
    f.exponentialRampToValueAtTime(20000, t + duration + 0.8);
  }

  // ---------- feedback ----------

  hit(headshot: boolean, killed: boolean): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    if (killed) {
      this.tone(out, t, 660, 0.12, 0.25, 'triangle');
      this.tone(out, t + 0.06, 990, 0.16, 0.22, 'triangle');
    } else if (headshot) this.tone(out, t, 1800, 0.08, 0.2, 'triangle');
    else this.tone(out, t, 1200, 0.04, 0.12, 'square');
  }

  hurt(amount: number): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    const g = Math.min(0.6, 0.2 + amount / 100);
    this.tone(out, t, 140, 0.18, g, 'sine', 60);
    this.noiseBurst(out, t, 0.08, g * 0.5, { type: 'lowpass', freq: 600 });
  }

  /** Call every frame; plays a heartbeat while health is low. */
  updateVitals(health: number, alive: boolean): void {
    if (!this.ready || !alive || health > 35) return;
    const t = this.ctx!.currentTime;
    if (t < this.heartbeatAt) return;
    const out = this.out(null, 0);
    const g = 0.35 * (1 - health / 35) + 0.1;
    this.tone(out, t, 55, 0.12, g, 'sine', 40);
    this.tone(out, t + 0.18, 50, 0.12, g * 0.7, 'sine', 38);
    this.heartbeatAt = t + 0.85;
  }
}
