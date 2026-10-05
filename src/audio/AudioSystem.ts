import type * as THREE from 'three';
import type { WeaponClass } from '@/weapons/weaponData';
import type { ImpactSurface } from '@/physics/surfaces';
import type { ReloadCue } from '@/core/events';
import { Ambience } from './Ambience';
import type { AmbienceLevels } from './ambienceDirector';

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
  grass: { type: 'lowpass', freq: 700, q: 0.7, len: 0.09 },
  snow: { type: 'lowpass', freq: 600, q: 0.7, len: 0.1 },
};

/** How each class's parts sound when handled: pitch scale and weight (loudness/body). */
const HANDLING: Record<WeaponClass, { pitch: number; weight: number }> = {
  pistol: { pitch: 1.3, weight: 0.7 },
  smg: { pitch: 1.12, weight: 0.85 },
  ar: { pitch: 1, weight: 1 },
  dmr: { pitch: 0.95, weight: 1.05 },
  sg: { pitch: 0.9, weight: 1.1 },
  sr: { pitch: 0.95, weight: 1 },
  lmg: { pitch: 0.8, weight: 1.3 },
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Surface -> recorded sample set (see sounds.manifest.json). */
const STEP_SAMPLE: Record<ImpactSurface, string> = {
  dirt: 'step_dirt',
  concrete: 'step_concrete',
  brick: 'step_concrete',
  metal: 'step_metal',
  wood: 'step_wood',
  rubber: 'step_dirt',
  grass: 'step_grass',
  snow: 'step_snow',
};
const HIT_SAMPLE: Record<ImpactSurface, string> = {
  dirt: 'hit_dirt',
  concrete: 'hit_concrete',
  brick: 'hit_concrete',
  metal: 'hit_metal',
  wood: 'hit_wood',
  rubber: 'hit_rubber',
  grass: 'hit_dirt',
  snow: 'hit_rubber',
};
/** Beyond this distance remote gunfire uses the "far" recordings. */
const FAR_GUNFIRE_M = 45;
/**
 * Voice limits for world sounds. Every spatial sound costs a panner on the
 * audio thread; big bot fights (10v15) fire well over 100 sounds a second and
 * the thread falls behind, which the player hears as audio cutting out. Only
 * the loudest voices play, and only the nearest few use (expensive) HRTF.
 */
const MAX_SPATIAL = 40;
const MAX_HRTF = 10;
const HRTF_RANGE_M = 30;
/** Other people's footsteps are inaudible past this anyway. */
const REMOTE_STEP_RANGE_M = 30;

interface Voice {
  until: number;
  /** Rough loudness at the listener, used to pick which voices to drop. */
  loud: number;
  hrtf: boolean;
  /** Set once the voice is admitted (nodes are only made for admitted sounds). */
  gain: GainNode | null;
}

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
  private voices: Voice[] = [];
  private listenerPos = { x: 0, y: 0, z: 0 };
  private ambience: Ambience | null = null;
  private ambienceLevels: AmbienceLevels | null = null;

  /** Nearest voices that get HRTF panning (0 on phones). */
  maxHrtf = MAX_HRTF;

  constructor(private volume: number) {}

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) this.build();
    if (this.ctx!.state === 'suspended') void this.ctx!.resume();
    this.decodePending();
    this.startAmbience();
  }

  /** On any click / tap / key: starts the sound when a page opened straight from a link left it waiting for one. */
  wake(): void {
    if (this.ctx?.state !== 'running') this.unlock();
  }

  /** Background levels for the current map; starts once audio is unlocked. */
  setAmbience(levels: AmbienceLevels): void {
    this.ambienceLevels = levels;
    this.ambience?.dispose();
    this.ambience = null;
    this.startAmbience();
  }

  /** Call every frame (wind gusts, birds, far-off fighting). */
  updateAmbience(dt: number): void {
    if (this.ready) this.ambience?.update(dt);
  }

  private startAmbience(): void {
    if (this.ambience || !this.ambienceLevels || !this.ctx) return;
    this.ambience = new Ambience(
      {
        ctx: this.ctx,
        dest: this.world!,
        reverb: this.reverb!,
        sample: (id, dest, t, gain, rate) => this.sample(id, dest, t, gain, rate),
        noiseBurst: (dest, t, len, gain, filter) => this.noiseBurst(dest, t, len, gain, filter),
        tone: (dest, t, freq, len, gain, type, endFreq) => this.tone(dest, t, freq, len, gain, type, endFreq),
      },
      this.ambienceLevels,
    );
  }

  /** Nearby fighting: ducks the background and scares off birds. */
  private excite(amount: number): void {
    this.ambience?.director.excite(amount);
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
    this.listenerPos.x = pos.x;
    this.listenerPos.y = pos.y;
    this.listenerPos.z = pos.z;
    l.positionX.setValueAtTime(pos.x, t);
    l.positionY.setValueAtTime(pos.y, t);
    l.positionZ.setValueAtTime(pos.z, t);
    l.forwardX.setValueAtTime(forward.x, t);
    l.forwardY.setValueAtTime(forward.y, t);
    l.forwardZ.setValueAtTime(forward.z, t);
    this.ambience?.setListenerForward(forward.x, forward.z);
    l.upX.setValueAtTime(up.x, t);
    l.upY.setValueAtTime(up.y, t);
    l.upZ.setValueAtTime(up.z, t);
  }

  // ---------- building blocks ----------

  private distanceTo(pos: THREE.Vector3): number {
    const l = this.listenerPos;
    return Math.hypot(pos.x - l.x, pos.y - l.y, pos.z - l.z);
  }

  /**
   * Reserves a world voice for `seconds`. Returns null when the sound should be
   * skipped because enough louder sounds are already playing; a louder new sound
   * fades out the quietest one instead.
   */
  private claimVoice(pos: THREE.Vector3, weight: number, seconds: number): Voice | null {
    const now = this.ctx!.currentTime;
    // Drop finished voices in place.
    const vs = this.voices;
    let live = 0;
    for (const v of vs) if (v.until > now) vs[live++] = v;
    vs.length = live;
    const dist = this.distanceTo(pos);
    const loud = weight / Math.max(2.5, dist);
    if (this.voices.length >= MAX_SPATIAL) {
      let quietest = this.voices[0]!;
      for (const v of this.voices) if (v.loud < quietest.loud) quietest = v;
      if (quietest.loud >= loud) return null;
      quietest.gain?.gain.setTargetAtTime(0, now, 0.015);
      this.voices.splice(this.voices.indexOf(quietest), 1);
    }
    let hrtfCount = 0;
    for (const v of this.voices) if (v.hrtf) hrtfCount++;
    const voice: Voice = { until: now + seconds, loud, hrtf: dist < HRTF_RANGE_M && hrtfCount < this.maxHrtf, gain: null };
    this.voices.push(voice);
    return voice;
  }

  /**
   * Destination for a sound: 2D (player) or a panner at `pos`, plus a reverb
   * send. World sounds pass their loudness `weight` and length for voice
   * limiting and get null when culled.
   */
  private out(pos: null, reverbSend: number): AudioNode;
  private out(pos: THREE.Vector3, reverbSend: number, weight: number, seconds: number): AudioNode | null;
  private out(pos: THREE.Vector3 | null, reverbSend: number, weight = 1, seconds = 1): AudioNode | null {
    const ctx = this.ctx!;
    // A culled world sound (a big fight fills the voices) costs no nodes at all.
    const voice = pos ? this.claimVoice(pos, weight, seconds) : null;
    if (pos && !voice) return null;
    const input = ctx.createGain();
    let dry: AudioNode = input;
    if (pos && voice) {
      voice.gain = input;
      const p = ctx.createPanner();
      p.panningModel = voice.hrtf ? 'HRTF' : 'equalpower';
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

  /** Small metal part snapping home: a narrow noise tick plus a faint ring. */
  private mechClick(out: AudioNode, t: number, freq: number, gain: number): void {
    this.noiseBurst(out, t, 0.018, gain, { type: 'bandpass', freq, q: 3 });
    this.tone(out, t, freq * 1.31, 0.04, gain * 0.12, 'triangle');
  }

  /** Metal sliding on metal: a band of noise sweeping between two frequencies. */
  private slide(out: AudioNode, t: number, len: number, from: number, to: number, gain: number): void {
    this.noiseBurst(out, t, len, gain, { type: 'bandpass', freq: from, q: 2.5, endFreq: to });
  }

  private get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  // ---------- weapons ----------

  gunshot(cls: WeaponClass, ads: boolean, suppressed = false): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const v = VOICES[cls];
    const pitch = rand(0.94, 1.06);
    const out = this.out(null, suppressed ? v.tail * 0.3 : v.tail);
    this.excite(suppressed ? 0.02 : 0.08);
    const g = v.gain * (ads ? 0.92 : 1);
    if (suppressed) {
      // A muffled cough and the action cycling: most of the report stays in the can.
      this.noiseBurst(out, t, 0.06, g * 0.45, { type: 'lowpass', freq: 1500 * pitch, endFreq: 260 }, pitch);
      this.tone(out, t, v.thump * 1.6 * pitch, 0.07, g * 0.3, 'sine', v.thump * 0.5);
      this.tone(out, t + 0.01, 2600 * pitch, 0.02, g * 0.1, 'square');
    } else if (this.sample(`gun_${cls}`, out, t, 0.95, rand(0.97, 1.03))) {
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
    this.excite(0.5 / Math.max(5, distance));
    const out = this.out(pos, 0.6, 1, 1.5);
    if (!out) return;
    const id = distance > FAR_GUNFIRE_M ? `gunfar_${cls}` : `gun_${cls}`;
    if (!this.sample(id, out, t, 0.9, rand(0.96, 1.04))) {
      const v = VOICES[cls];
      this.noiseBurst(out, t, v.decay * 1.5, v.gain, { type: 'lowpass', freq: Math.max(800, v.cutoff - distance * 20), endFreq: 200 });
    }
  }

  reloadCue(cue: ReloadCue, cls: WeaponClass): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0.05);
    const { pitch: p, weight: w } = HANDLING[cls];
    switch (cue) {
      case 'magOut':
        // Release button, then the magazine sliding out of the well.
        if (!this.sample(cls === 'pistol' || cls === 'smg' ? 'mag_out' : 'mag_out_rifle', out, t, 0.5 * w, rand(0.96, 1.04) / Math.sqrt(p))) {
          this.mechClick(out, t, 3200 * p, 0.28 * w);
          this.slide(out, t + 0.02, 0.12, 1800 * p, 900 * p, 0.2 * w);
        }
        if (cls === 'lmg') this.mechClick(out, t + 0.16, 1500, 0.18); // feed cover
        break;
      case 'magIn':
        this.slide(out, t, 0.05, 900 * p, 2200 * p, 0.08 * w);
        this.sample('mag_in', out, t + 0.005, 0.25 * w, 1.5 * p);
        if (cls !== 'pistol') this.sample('mag_in_rifle', out, t + 0.01, 0.4 * w, rand(0.96, 1.04) / Math.sqrt(p));
        this.mechClick(out, t + 0.03, 2500 * p, 0.28 * w);
        this.tone(out, t + 0.03, 180 * p, 0.06, 0.2 * w, 'sine', 90 * p);
        break;
      case 'chamber':
        if (cls === 'pistol') {
          // Slide release: one sharp slam.
          if (this.sample('slide', out, t, 0.6, rand(0.97, 1.05))) break;
          this.mechClick(out, t, 2900, 1.4);
          this.noiseBurst(out, t, 0.04, 0.4, { type: 'lowpass', freq: 700 });
          break;
        }
        // Charging handle back to its stop, then released to slam forward.
        if (this.sample('charge', out, t, 0.55 * w, rand(0.96, 1.04) / Math.sqrt(p))) {
          if (cls === 'lmg') this.mechClick(out, t + 0.3, 1400, 0.22); // cover shut
          break;
        }
        this.slide(out, t, 0.08, 1500 * p, 3000 * p, 0.12 * w);
        this.mechClick(out, t + 0.08, 3100 * p, 0.18 * w);
        this.mechClick(out, t + 0.16, 2400 * p, 0.3 * w);
        this.noiseBurst(out, t + 0.16, 0.05, 0.14 * w, { type: 'lowpass', freq: 500 });
        if (cls === 'lmg') this.mechClick(out, t + 0.3, 1400, 0.22); // cover shut
        break;
      case 'shell':
        if (cls === 'sg') {
          // Plastic shell thumbed into the tube.
          this.noiseBurst(out, t, 0.05, 0.3, { type: 'lowpass', freq: 900 });
          this.mechClick(out, t + 0.02, 1600, 0.2);
        } else {
          // Brass round pressed into a rifle's magazine.
          this.mechClick(out, t, 3800, 0.35);
          this.slide(out, t + 0.01, 0.05, 2600, 1800, 0.12);
          this.tone(out, t + 0.02, 5400, 0.08, 0.03, 'sine');
        }
        break;
    }
  }

  /** Bolt or pump action. */
  cycle(cls: WeaponClass): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0.08);
    if (cls === 'sg') {
      // Pump: back "chk", forward "chk" (the forward stroke is the louder).
      if (this.sample('pump', out, t, 0.6, rand(0.97, 1.03))) return;
      this.slide(out, t, 0.07, 900, 1600, 0.24);
      this.mechClick(out, t + 0.07, 1300, 0.44);
      this.slide(out, t + 0.16, 0.06, 1600, 900, 0.2);
      this.mechClick(out, t + 0.22, 1500, 0.58);
      this.noiseBurst(out, t + 0.22, 0.05, 0.2, { type: 'lowpass', freq: 450 });
      return;
    }
    // Bolt: lift, pull back to the stop, push forward, turn down to lock.
    if (this.sample('bolt_open', out, t, 0.5, rand(0.95, 1.03))) {
      this.sample('bolt_close', out, t + 0.24, 0.6, rand(0.95, 1.03));
      return;
    }
    this.mechClick(out, t, 2800, 0.27);
    this.slide(out, t + 0.04, 0.1, 1400, 3200, 0.2);
    this.mechClick(out, t + 0.14, 3300, 0.34);
    this.slide(out, t + 0.22, 0.09, 3000, 1500, 0.19);
    this.mechClick(out, t + 0.31, 2000, 0.5);
    this.noiseBurst(out, t + 0.31, 0.05, 0.17, { type: 'lowpass', freq: 500 });
  }

  switchWeapon(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    this.noiseBurst(out, t, 0.12, 0.14, { type: 'bandpass', freq: 600, q: 0.8, endFreq: 1400 });
    this.mechClick(out, t + 0.1, 1800, 0.3);
  }

  /** Melee swing: cloth and air, a rising whoosh. */
  meleeSwing(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    this.noiseBurst(out, t + 0.08, 0.2, 0.22, { type: 'bandpass', freq: 380, q: 1.2, endFreq: 1500 });
    this.noiseBurst(out, t, 0.12, 0.08, { type: 'lowpass', freq: 900 });
  }

  /** The stock lands: a dull thump on a body, a hard knock on a wall (the impact sound adds the surface). */
  meleeHit(body: boolean): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0.04);
    if (body) {
      this.tone(out, t, 110, 0.12, 0.7, 'sine', 55);
      this.noiseBurst(out, t, 0.09, 0.6, { type: 'lowpass', freq: 520 });
      this.noiseBurst(out, t + 0.01, 0.05, 0.2, { type: 'bandpass', freq: 1400, q: 1.5 });
    } else {
      this.tone(out, t, 160, 0.07, 0.35, 'sine', 90);
      this.noiseBurst(out, t, 0.06, 0.45, { type: 'bandpass', freq: 900, q: 1.1 });
      this.mechClick(out, t + 0.005, 2200, 0.2);
    }
  }

  /** Inspection magazine check: the reload sounds, softer. */
  inspectCue(cue: 'magOut' | 'magIn', cls: WeaponClass): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0.03);
    const { pitch: p, weight: w } = HANDLING[cls];
    if (cue === 'magOut') {
      this.mechClick(out, t, 3200 * p, 0.12 * w);
      this.slide(out, t + 0.02, 0.07, 1600 * p, 1100 * p, 0.07 * w);
    } else {
      this.slide(out, t, 0.04, 1000 * p, 2000 * p, 0.05 * w);
      if (!this.sample('mag_in', out, t + 0.01, 0.12 * w, 1.5 * p)) this.mechClick(out, t + 0.02, 2500 * p, 0.14 * w);
    }
  }

  /** Dry fire: the hammer/striker falls on nothing. */
  click(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    this.mechClick(out, t, 3800, 0.35);
    this.tone(out, t, 240, 0.03, 0.08, 'sine', 120);
  }

  // ---------- world ----------

  impact(pos: THREE.Vector3, surface: ImpactSurface): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    // Budget so shotgun volleys don't stack a dozen identical transients.
    if (t < this.impactBudget) return;
    this.impactBudget = t + 0.015;
    const s = SURFACE_SOUND[surface];
    const out = this.out(pos, 0.2, 0.4, 0.4);
    if (!out) return;
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
    if (this.distanceTo(pos) > REMOTE_STEP_RANGE_M) return;
    const out = this.out(pos, 0.05, sprinting ? 0.5 : 0.32, 0.45);
    if (!out) return;
    this.sample(STEP_SAMPLE[surface], out, this.ctx!.currentTime, sprinting ? 0.5 : 0.32, rand(0.9, 1.1));
  }

  /** Landing from a jump or fall; harder landings are louder with more gear rattle. */
  land(impactSpeed: number, surface?: ImpactSurface): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0.05);
    const k = Math.min(1, Math.max(0, (impactSpeed - 7) / 8));
    if (surface) {
      // Both feet, a hair apart.
      this.sample(STEP_SAMPLE[surface], out, t, 0.25 + 0.15 * k, rand(0.78, 0.86));
      this.sample(STEP_SAMPLE[surface], out, t + rand(0.03, 0.06), 0.14 + 0.1 * k, rand(0.8, 0.9));
    }
    this.tone(out, t, 110, 0.12, 0.18 + 0.17 * k, 'sine', 50);
    this.noiseBurst(out, t, 0.08, 0.14 + 0.12 * k, { type: 'lowpass', freq: 700 });
    this.noiseBurst(out, t + 0.02, 0.07, 0.04 + 0.08 * k, { type: 'bandpass', freq: 2400, q: 1.2 });
  }

  /** Sliding: a drop onto the hip, then a scuff that fades as the slide slows. */
  bodySlide(surface?: ImpactSurface): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0.05);
    if (surface) this.sample(STEP_SAMPLE[surface], out, t, 0.22, rand(0.7, 0.78));
    this.noiseBurst(out, t + 0.03, 0.75, 0.16, { type: 'bandpass', freq: surface === 'snow' ? 900 : 1500, q: 0.8, endFreq: 500 });
    this.noiseBurst(out, t, 0.1, 0.1, { type: 'lowpass', freq: 600 });
  }

  // ---------- grenades ----------

  /** Medkit: a zip, a tear and the syringe click. */
  medkit(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    this.noiseBurst(out, t, 0.16, 0.1, { type: 'bandpass', freq: 3400, q: 1.2, endFreq: 1900 });
    this.noiseBurst(out, t + 0.2, 0.08, 0.08, { type: 'highpass', freq: 2200 });
    this.mechClick(out, t + 0.42, 2600, 0.08);
  }

  /** Revived (or revived someone): a short rising pair of tones. */
  revived(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0.1);
    this.tone(out, t, 660, 0.12, 0.05, 'triangle');
    this.tone(out, t + 0.1, 990, 0.18, 0.05, 'triangle');
  }

  /** One blow while building: nails into boards, a sack thumped down, or a clang on steel. */
  hammer(kind: 'wood' | 'bag' | 'metal'): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    const v = 0.85 + Math.random() * 0.3;
    if (kind === 'bag') {
      this.noiseBurst(out, t, 0.14 * v, 0.16, { type: 'lowpass', freq: 520, endFreq: 180 });
      this.noiseBurst(out, t + 0.02, 0.05 * v, 0.1, { type: 'bandpass', freq: 1500, q: 0.7 });
    } else if (kind === 'metal') {
      this.mechClick(out, t, 1700 * v, 0.14);
      this.tone(out, t, 880 * v, 0.35, 0.03, 'triangle');
      this.tone(out, t, 1330 * v, 0.25, 0.015, 'sine');
    } else {
      this.mechClick(out, t, 2100 * v, 0.14);
      this.noiseBurst(out, t, 0.1 * v, 0.07, { type: 'bandpass', freq: 700, q: 1.1, endFreq: 420 });
    }
  }

  /** Handing a kit over / receiving one. */
  resupply(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    this.mechClick(out, t, 1800, 0.1);
    this.noiseBurst(out, t + 0.03, 0.12, 0.08, { type: 'bandpass', freq: 900, q: 0.9, endFreq: 600 });
  }

  /**
   * Class gadgets: a panzerfaust going off (bang and a roaring back-blast), a
   * rifle grenade popping off the muzzle, a beacon or mine set down. `pos`
   * null = the player's own.
   */
  gadget(kind: 'rocket' | 'rifle' | 'place', pos: THREE.Vector3 | null): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = pos ? this.out(pos, 0.5, kind === 'rocket' ? 3 : 1, 1.5) : this.out(null, 0.3);
    if (!out) return;
    if (kind === 'rocket') {
      this.noiseBurst(out, t, 0.05, 1.1, { type: 'lowpass', freq: 5000 });
      this.noiseBurst(out, t, 0.9, 0.7, { type: 'bandpass', freq: 900, q: 0.6, endFreq: 260 });
      this.tone(out, t, 70, 0.5, 0.6, 'sine', 35);
    } else if (kind === 'rifle') {
      this.noiseBurst(out, t, 0.06, 0.6, { type: 'bandpass', freq: 1400, q: 0.8 });
      this.tone(out, t, 180, 0.15, 0.25, 'triangle', 90);
    } else {
      this.mechClick(out, t, 1300, 0.12);
      this.noiseBurst(out, t + 0.05, 0.12, 0.08, { type: 'lowpass', freq: 600 });
    }
  }

  /** A shell about a second out: a falling whistle at the spot (heard from afar). */
  incoming(pos: THREE.Vector3): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(pos, 0.35, 2, 2);
    if (!out) return;
    this.tone(out, t, 2300, 1.0, 0.09, 'sine', 700);
    this.noiseBurst(out, t + 0.3, 0.7, 0.05, { type: 'bandpass', freq: 1800, q: 2, endFreq: 600 });
  }

  /** Holding the breath behind a scope: a short intake, a slow exhale, or a gasp after too long. */
  breath(kind: 'in' | 'out' | 'gasp'): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    if (kind === 'in') {
      this.noiseBurst(out, t, 0.32, 0.05, { type: 'bandpass', freq: 700, q: 0.7, endFreq: 1500 });
    } else if (kind === 'out') {
      this.noiseBurst(out, t, 0.6, 0.045, { type: 'bandpass', freq: 900, q: 0.6, endFreq: 450 });
    } else {
      // Air let go all at once, then two quick pulls.
      this.noiseBurst(out, t, 0.35, 0.09, { type: 'bandpass', freq: 1000, q: 0.6, endFreq: 500 });
      this.noiseBurst(out, t + 0.45, 0.22, 0.08, { type: 'bandpass', freq: 650, q: 0.7, endFreq: 1500 });
      this.noiseBurst(out, t + 0.85, 0.22, 0.07, { type: 'bandpass', freq: 650, q: 0.7, endFreq: 1400 });
    }
  }

  /**
   * Panzerfaust reload, timed to the first-person motion: the spent tube hits
   * the ground, the next one is pulled off the back and shouldered, the sight
   * flips up and the firing lever is cocked.
   */
  launcherReload(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    this.noiseBurst(out, t + 0.7, 0.12, 0.12, { type: 'lowpass', freq: 500 });
    this.tone(out, t + 0.7, 210, 0.12, 0.05, 'triangle', 150);
    this.noiseBurst(out, t + 1.05, 0.3, 0.06, { type: 'bandpass', freq: 800, q: 0.8, endFreq: 500 });
    this.mechClick(out, t + 1.75, 900, 0.12);
    this.mechClick(out, t + 2.2, 2600, 0.1);
    this.mechClick(out, t + 2.55, 1500, 0.14);
    this.mechClick(out, t + 2.62, 2200, 0.08);
  }

  pinAndThrow(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    // Pin pulled (a ringing ping), spoon flies off, arm swing.
    this.mechClick(out, t, 3000, 0.12);
    this.tone(out, t + 0.01, 5200, 0.25, 0.02, 'sine');
    this.tone(out, t + 0.01, 7300, 0.18, 0.012, 'sine');
    this.mechClick(out, t + 0.22, 2400, 0.1);
    this.tone(out, t + 0.22, 4100, 0.2, 0.015, 'sine');
    this.noiseBurst(out, t + 0.25, 0.25, 0.14, { type: 'bandpass', freq: 400, q: 0.8, endFreq: 1400 });
  }

  grenadeBounce(pos: THREE.Vector3, speed: number): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const g = Math.min(0.5, speed / 20);
    const out = this.out(pos, 0.1, g, 0.3);
    if (!out) return;
    if (this.sample('grenade_bounce', out, t, g * 1.4, rand(1.1, 1.3))) return;
    this.tone(out, t, rand(1700, 2000), 0.09, g * 0.3, 'triangle');
    this.tone(out, t, rand(2600, 2900), 0.06, g * 0.2, 'sine');
    this.noiseBurst(out, t, 0.04, g * 0.5, { type: 'bandpass', freq: 1200, q: 1 });
  }

  explosion(pos: THREE.Vector3, distance: number): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.excite(2 / Math.max(4, distance));
    const out = this.out(pos, 0.9, 4, 3.5);
    if (!out) return;
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
    const out = this.out(pos, 0.8, 3, 1);
    if (!out) return;
    this.noiseBurst(out, t, 0.03, 1.6, { type: 'highpass', freq: 1500 });
    this.noiseBurst(out, t, 0.6, 0.6, { type: 'lowpass', freq: 3000, endFreq: 200 });
  }

  smokePop(pos: THREE.Vector3, duration: number): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(pos, 0.2, 0.6, Math.min(8, duration * 0.4) + 0.2);
    if (!out) return;
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

  /** Zone captured (good) or lost (bad): a short two-note cue. */
  zoneCue(good: boolean): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0.1);
    const [a, b] = good ? [523, 784] : [440, 311];
    this.tone(out, t, a, 0.16, 0.16, 'triangle');
    this.tone(out, t + 0.14, b, 0.28, 0.16, 'triangle');
  }

  hurt(amount: number): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const out = this.out(null, 0);
    this.excite(0.3);
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
