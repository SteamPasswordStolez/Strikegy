/**
 * The radio sound for the battle briefing (docs/design/battle-briefing.md §6):
 * the voice files stay clean and become a field radio at playback — band
 * limited to a handset's 320 Hz - 3.2 kHz with a little presence and drive,
 * squeezed hard, a hiss under it, a squelch burst and click when the key goes
 * down and up, and now and then a short drop-out. The announcer (modes
 * without sides) plays clean.
 */
export type RadioPreset = 'hq' | 'clean';

interface Preset {
  low: number;
  high: number;
  presence: number;
  drive: number;
  hiss: number;
  keys: boolean;
  dropouts: number;
}

const PRESETS: Record<RadioPreset, Preset> = {
  hq: { low: 320, high: 3200, presence: 4, drive: 3, hiss: 0.022, keys: true, dropouts: 0.035 },
  clean: { low: 80, high: 14000, presence: 0, drive: 0, hiss: 0, keys: false, dropouts: 0 },
};

/** Lead-in before the voice (the key going down) and tail after it. */
const LEAD = 0.12;
const TAIL = 0.2;

let noise: AudioBuffer | null = null;
const curves = new Map<number, Float32Array<ArrayBuffer>>();

function noiseOf(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

/** Soft clipping: (1 + k) x / (1 + k |x|). */
function curveOf(k: number): Float32Array<ArrayBuffer> {
  let c = curves.get(k);
  if (!c) {
    c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    curves.set(k, c);
  }
  return c;
}

/** A short band-passed noise burst (squelch) at `t`. */
function burst(ctx: AudioContext, dest: AudioNode, t: number, len: number, gain: number, freq: number): void {
  const s = ctx.createBufferSource();
  s.buffer = noiseOf(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  s.connect(f).connect(g).connect(dest);
  s.start(t, Math.random());
  s.stop(t + len + 0.02);
}

/** The key's click: a few milliseconds of a square wave. */
function click(ctx: AudioContext, dest: AudioNode, t: number, freq: number, gain: number): void {
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.02);
}

export interface RadioLine {
  /** Seconds from now to the end of the tail. */
  duration: number;
  /** When the voice itself runs (context time), for ducking. */
  voiceFrom: number;
  voiceTo: number;
  /** Cuts the line off now (a more urgent one takes the air). */
  stop(): void;
}

/** Plays `buffer` through the radio on `dest`, starting now. */
export function playRadio(ctx: AudioContext, dest: AudioNode, buffer: AudioBuffer, preset: RadioPreset, rng: () => number = Math.random): RadioLine {
  const p = PRESETS[preset];
  const t0 = ctx.currentTime + 0.02;
  const lead = p.keys ? LEAD : 0;
  const voiceFrom = t0 + lead;
  const voiceTo = voiceFrom + buffer.duration;
  const end = voiceTo + (p.keys ? TAIL : 0.05);

  // Everything of this line goes through one gain, so a cut can silence it at once.
  const line = ctx.createGain();
  line.connect(dest);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  let node: AudioNode = src;
  const chain = (n: AudioNode) => {
    node.connect(n);
    node = n;
  };
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = p.low;
  hp.Q.value = 0.8;
  chain(hp);
  if (p.presence) {
    const pk = ctx.createBiquadFilter();
    pk.type = 'peaking';
    pk.frequency.value = 1800;
    pk.Q.value = 1;
    pk.gain.value = p.presence;
    chain(pk);
  }
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = p.high;
  lp.Q.value = 0.8;
  chain(lp);
  if (p.drive) {
    const ws = ctx.createWaveShaper();
    ws.curve = curveOf(p.drive);
    ws.oversample = '2x';
    chain(ws);
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = p.drive ? -24 : -14;
  comp.ratio.value = p.drive ? 6 : 2.5;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  chain(comp);
  // Drop-outs: the signal sags for a few tens of milliseconds now and then.
  const sag = ctx.createGain();
  if (p.dropouts) {
    for (let t = voiceFrom + 0.3; t < voiceTo - 0.2; t += 0.4) {
      if (rng() >= p.dropouts) continue;
      const len = 0.03 + rng() * 0.03;
      sag.gain.setValueAtTime(1, t);
      sag.gain.linearRampToValueAtTime(0.12, t + 0.008);
      sag.gain.setValueAtTime(0.12, t + len);
      sag.gain.linearRampToValueAtTime(1, t + len + 0.01);
    }
  }
  chain(sag);
  node.connect(line);
  src.start(voiceFrom);

  const extra: AudioScheduledSourceNode[] = [src];
  if (p.hiss) {
    const h = ctx.createBufferSource();
    h.buffer = noiseOf(ctx);
    h.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2000;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(p.hiss, t0 + 0.03);
    g.gain.setValueAtTime(p.hiss, end - 0.05);
    g.gain.linearRampToValueAtTime(0.0001, end);
    h.connect(f).connect(g).connect(line);
    h.start(t0, rng());
    h.stop(end + 0.05);
    extra.push(h);
  }
  if (p.keys) {
    burst(ctx, line, t0, 0.05, 0.12, 2600);
    click(ctx, line, t0, 900, 0.05);
    burst(ctx, line, voiceTo + 0.02, 0.09, 0.14, 2200);
    click(ctx, line, voiceTo + 0.11, 600, 0.06);
  }
  return {
    duration: end - ctx.currentTime,
    voiceFrom,
    voiceTo,
    stop: () => {
      const now = ctx.currentTime;
      line.gain.cancelScheduledValues(now);
      line.gain.setValueAtTime(line.gain.value, now);
      line.gain.linearRampToValueAtTime(0, now + 0.03);
      for (const s of extra) {
        try {
          s.stop(now + 0.05);
        } catch {
          // Already stopped.
        }
      }
      if (p.keys) burst(ctx, dest, now + 0.03, 0.06, 0.1, 2400);
    },
  };
}
