import * as THREE from 'three';
import type { VehicleKind } from '@/vehicles/vehicleData';

/**
 * Engine sounds for vehicles and aircraft. A running engine is held open for
 * as long as the vehicle is near enough to matter and retuned every frame
 * from its speed and throttle:
 * - ground vehicles play the recorded heavy-engine loop (`engine_heavy`),
 *   pitched by kind and speed, through a lowpass that opens with load;
 *   tracked hulls add the clatter of their tracks (noise chopped at a rate
 *   that follows the speed);
 * - jets are a roar, a turbine whine and a hiss, and play the recorded jet
 *   pass (`jet_pass`) as they go by close;
 * - the recon plane plays the recorded propeller loop (`prop_loop`).
 * Everything shifts with the Doppler effect. Missing recordings fall back to
 * oscillators. Only the nearest few run at once (`ENGINE_LIMIT`); the rest
 * fade out and give their nodes back.
 */

export type EngineKind = VehicleKind | 'recon';

interface EngineVoice {
  /** Recording and its playback rate at rest / flat out (ground and prop engines). */
  sample?: string;
  rate?: [number, number];
  /** Oscillator note (Hz) at idle / flat out, when the recording is missing. */
  idle: number;
  top: number;
  /** Speed (m/s) counted as flat out. */
  speed: number;
  gain: number;
  /** Distance (m) the sound starts falling off from (inverse model): bigger = carries farther. */
  ref: number;
  tracks?: boolean;
  jet?: boolean;
  /** Lowpass over the engine (Hz at rest; opens with load). */
  rumble: number;
}

const VOICE: Record<EngineKind, EngineVoice> = {
  bike: { sample: 'engine_heavy', rate: [1.5, 2.3], idle: 46, top: 150, speed: 26, gain: 0.3, ref: 6, rumble: 1600 },
  jeep: { sample: 'engine_heavy', rate: [1.1, 1.75], idle: 34, top: 95, speed: 22, gain: 0.34, ref: 7, rumble: 1200 },
  apc: { sample: 'engine_heavy', rate: [0.85, 1.35], idle: 27, top: 70, speed: 17, gain: 0.45, ref: 10, rumble: 900 },
  rocket: { sample: 'engine_heavy', rate: [0.85, 1.3], idle: 26, top: 66, speed: 16, gain: 0.45, ref: 10, rumble: 900 },
  tank: { sample: 'engine_heavy', rate: [0.7, 1.15], idle: 22, top: 55, speed: 12, gain: 0.55, ref: 12, tracks: true, rumble: 700 },
  spg: { sample: 'engine_heavy', rate: [0.7, 1.15], idle: 22, top: 55, speed: 11, gain: 0.55, ref: 12, tracks: true, rumble: 700 },
  td: { sample: 'engine_heavy', rate: [0.72, 1.18], idle: 23, top: 58, speed: 12, gain: 0.55, ref: 12, tracks: true, rumble: 750 },
  fighter: { idle: 0, top: 0, speed: 125, gain: 0.85, ref: 60, jet: true, rumble: 700 },
  cas: { idle: 0, top: 0, speed: 100, gain: 0.8, ref: 55, jet: true, rumble: 520 },
  recon: { sample: 'prop_loop', rate: [1, 1], idle: 90, top: 90, speed: 60, gain: 0.6, ref: 45, rumble: 3000 },
};

/** Engines sounding at once: ground vehicles, aircraft. */
const ENGINE_LIMIT = { ground: 6, air: 4 };
/** Farther than this an engine is never started (m). */
const ENGINE_RANGE = { ground: 260, air: 1600 };
/** A jet passing closer than this plays the recorded pass. */
const JET_PASS_M = 160;
const SOUND_SPEED = 343;

/** What the engines need from the game's audio (`AudioSystem.engineHost`). */
export interface EngineHost {
  ctx: AudioContext;
  dest: AudioNode;
  noise: AudioBuffer;
  /** A decoded recording, or null when it isn't loaded. */
  buffer(id: string): AudioBuffer | null;
  /** A one-shot recording at a world position. */
  oneShot(id: string, pos: THREE.Vector3, gain: number, rate: number, ref: number): void;
}

/** A vehicle (or recon plane) as the engines see it. */
export interface EngineSource {
  id: number;
  kind: EngineKind;
  pos: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Someone aboard (an empty vehicle's engine is off unless it is still rolling). */
  crewed: boolean;
  wrecked: boolean;
  /** Aircraft throttle 0..1 (others: null). */
  throttle: number | null;
}

interface Engine {
  id: number;
  voice: EngineVoice;
  panner: PannerNode;
  out: GainNode;
  body: BiquadFilterNode;
  /** The recording, or the oscillators standing in for it. */
  loop: AudioBufferSourceNode | null;
  oscs: OscillatorNode[];
  /** Noise: exhaust body (oscillator engines) or the jet roar. */
  noise: AudioBufferSourceNode | null;
  noiseFilter: BiquadFilterNode | null;
  clatter: { gate: GainNode; lfo: OscillatorNode; src: AudioBufferSourceNode } | null;
  whine: OscillatorNode | null;
  /** Jets: closing speed last frame (a pass is closing turning to opening). */
  closing: number;
  dying: boolean;
  dropped: boolean;
  seen: boolean;
}

export class EngineSounds {
  private readonly engines = new Map<number, Engine>();
  private readonly rel = new THREE.Vector3();

  constructor(private readonly host: EngineHost) {}

  /** Once a frame: starts, retunes and stops engines for `list` heard from `ear` (moving at `earVel`). */
  update(list: readonly EngineSource[], ear: THREE.Vector3, earVel: THREE.Vector3): void {
    const t = this.host.ctx.currentTime;
    const want = new Set<number>();
    for (const air of [false, true]) {
      const near = list
        .filter((s) => !s.wrecked && !!(VOICE[s.kind].jet || s.kind === 'recon') === air && (s.crewed || s.velocity.lengthSq() > 1))
        .map((s) => ({ s, d: s.pos.distanceTo(ear) }))
        .filter((x) => x.d < (air ? ENGINE_RANGE.air : ENGINE_RANGE.ground))
        .sort((a, b) => a.d - b.d)
        .slice(0, air ? ENGINE_LIMIT.air : ENGINE_LIMIT.ground);
      for (const { s } of near) want.add(s.id);
    }
    for (const e of this.engines.values()) e.seen = false;
    for (const s of list) {
      if (!want.has(s.id)) continue;
      let e = this.engines.get(s.id);
      if (!e || e.dying) {
        if (e) this.drop(e, true);
        e = this.start(s);
        this.engines.set(s.id, e);
      }
      e.seen = true;
      this.tune(e, s, ear, earVel, t);
    }
    for (const e of [...this.engines.values()]) if (!e.seen && !e.dying) this.stop(e);
  }

  /** Everything off at once (leaving a match). */
  dispose(): void {
    for (const e of [...this.engines.values()]) this.drop(e, true);
  }

  private start(s: EngineSource): Engine {
    const { ctx, dest, noise } = this.host;
    const v = VOICE[s.kind];
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = v.ref;
    panner.rolloffFactor = 1;
    panner.maxDistance = 5000;
    panner.positionX.value = s.pos.x;
    panner.positionY.value = s.pos.y;
    panner.positionZ.value = s.pos.z;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.setTargetAtTime(v.gain, ctx.currentTime, 0.4);
    out.connect(panner).connect(dest);
    const body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = v.rumble;
    body.Q.value = 0.7;
    body.connect(out);
    const e: Engine = { id: s.id, voice: v, panner, out, body, loop: null, oscs: [], noise: null, noiseFilter: null, clatter: null, whine: null, closing: 0, dying: false, dropped: false, seen: true };
    const rec = v.sample ? this.host.buffer(v.sample) : null;
    if (rec) {
      const src = ctx.createBufferSource();
      src.buffer = rec;
      src.loop = true;
      src.playbackRate.value = v.rate![0];
      src.connect(body);
      src.start(0, Math.random() * rec.duration);
      e.loop = src;
    } else if (!v.jet) {
      // Firing note, its octave below and a slightly detuned partner: a lumpy piston beat.
      for (const [type, mul, g] of [['sawtooth', 1, 0.5], ['square', 0.5, 0.35], ['sawtooth', 1.01, 0.3]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = v.idle * mul;
        const og = ctx.createGain();
        og.gain.value = g;
        o.connect(og).connect(body);
        o.start();
        e.oscs.push(o);
      }
    }
    if (v.jet || !rec) {
      // Noise: the jet's roar, or the exhaust under the oscillators.
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = v.jet ? 'bandpass' : 'lowpass';
      nf.frequency.value = v.jet ? v.rumble : v.rumble * 0.4;
      nf.Q.value = v.jet ? 0.5 : 0.7;
      const ng = ctx.createGain();
      ng.gain.value = v.jet ? 1.4 : 0.5;
      src.connect(nf).connect(ng).connect(v.jet ? out : body);
      src.start(0, Math.random() * 0.9);
      e.noise = src;
      e.noiseFilter = nf;
    }
    if (v.jet) {
      const w = ctx.createOscillator();
      w.type = 'sine';
      w.frequency.value = 2400;
      const wg = ctx.createGain();
      wg.gain.value = 0.05;
      w.connect(wg).connect(out);
      w.start();
      e.whine = w;
    }
    if (v.tracks) {
      // Track links slapping: high noise chopped by a square wave whose rate follows the speed.
      const tn = ctx.createBufferSource();
      tn.buffer = noise;
      tn.loop = true;
      tn.playbackRate.value = 0.8;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1600;
      bp.Q.value = 0.8;
      const gate = ctx.createGain();
      gate.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 1;
      const depth = ctx.createGain();
      depth.gain.value = 0;
      lfo.connect(depth).connect(gate.gain);
      tn.connect(bp).connect(gate).connect(out);
      tn.start(0, Math.random() * 0.9);
      lfo.start();
      e.clatter = { gate: depth, lfo, src: tn };
    }
    return e;
  }

  private tune(e: Engine, s: EngineSource, ear: THREE.Vector3, earVel: THREE.Vector3, t: number): void {
    const v = e.voice;
    const p = e.panner;
    p.positionX.setTargetAtTime(s.pos.x, t, 0.03);
    p.positionY.setTargetAtTime(s.pos.y, t, 0.03);
    p.positionZ.setTargetAtTime(s.pos.z, t, 0.03);
    const speed = s.velocity.length();
    const load = Math.min(1, speed / v.speed);
    // Doppler: closing in raises the pitch, going away lowers it (big for jets).
    const to = this.rel.subVectors(ear, s.pos);
    const d = Math.max(1, to.length());
    to.divideScalar(d);
    const closing = s.velocity.dot(to) - earVel.dot(to);
    const doppler = THREE.MathUtils.clamp(SOUND_SPEED / (SOUND_SPEED - closing), 0.6, 1.6);
    if (v.jet) {
      const thr = s.throttle ?? 0.7;
      e.noiseFilter!.frequency.setTargetAtTime(v.rumble * (0.6 + 0.4 * thr) * doppler, t, 0.1);
      e.noise!.playbackRate.setTargetAtTime(0.7 + 0.5 * thr * doppler, t, 0.1);
      e.whine!.frequency.setTargetAtTime((1800 + 1600 * thr) * doppler, t, 0.1);
      e.out.gain.setTargetAtTime(v.gain * (0.55 + 0.45 * thr), t, 0.2);
      // The recorded pass as it goes by close: closing turns to opening.
      if (e.closing > 8 && closing <= 8 && d < JET_PASS_M) this.host.oneShot('jet_pass', s.pos, 1, THREE.MathUtils.clamp(speed / 100, 0.85, 1.15), 40);
      e.closing = closing;
      return;
    }
    if (e.loop) {
      const [r0, r1] = v.rate!;
      e.loop.playbackRate.setTargetAtTime((r0 + (r1 - r0) * load) * doppler, t, 0.2);
    } else if (e.oscs.length) {
      const note = (v.idle + (v.top - v.idle) * load) * doppler;
      e.oscs[0]!.frequency.setTargetAtTime(note, t, 0.15);
      e.oscs[1]!.frequency.setTargetAtTime(note * 0.5, t, 0.15);
      e.oscs[2]!.frequency.setTargetAtTime(note * 1.01, t, 0.15);
    }
    e.body.frequency.setTargetAtTime(v.rumble * (0.8 + 1.4 * load), t, 0.15);
    e.out.gain.setTargetAtTime(v.gain * (0.55 + 0.45 * load) * (s.crewed ? 1 : 0.6), t, 0.2);
    if (e.clatter) {
      e.clatter.lfo.frequency.setTargetAtTime(Math.max(0.5, speed * 2.2), t, 0.1);
      e.clatter.gate.gain.setTargetAtTime(Math.min(0.6, speed * 0.09), t, 0.1);
    }
  }

  private stop(e: Engine): void {
    e.dying = true;
    e.out.gain.setTargetAtTime(0.0001, this.host.ctx.currentTime, 0.3);
    setTimeout(() => this.drop(e, false), 1500);
  }

  private drop(e: Engine, now: boolean): void {
    if (this.engines.get(e.id) === e) this.engines.delete(e.id);
    if (e.dropped) return;
    e.dropped = true;
    const t = this.host.ctx.currentTime + (now ? 0 : 0.05);
    e.loop?.stop(t);
    for (const o of e.oscs) o.stop(t);
    e.whine?.stop(t);
    e.noise?.stop(t);
    if (e.clatter) {
      e.clatter.src.stop(t);
      e.clatter.lfo.stop(t);
    }
    e.out.disconnect();
  }
}
