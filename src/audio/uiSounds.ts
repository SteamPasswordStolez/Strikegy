/**
 * Menu sounds (design system, 2026-10-17): every hover, step, pick, back and
 * screen change answers with a short sound, the way BF / CoD menus do.
 * Recorded CC0 clips from Kenney's Interface Sounds / UI Audio (`ui_*` in
 * sounds.manifest.json, built by `npm run sounds`); until they have loaded,
 * or if they fail to, a synthesised stand-in plays instead.
 */
export type UiSound = 'hover' | 'move' | 'select' | 'back' | 'open' | 'error' | 'start';

const KINDS: readonly UiSound[] = ['hover', 'move', 'select', 'back', 'open', 'error', 'start'];
/** Level of each clip (the clips are all normalised to a -1 dB peak). */
const LEVEL: Record<UiSound, number> = { hover: 0.22, move: 0.3, select: 0.45, back: 0.45, open: 0.35, error: 0.45, start: 0.6 };

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let volume = 0.8;
let noise: AudioBuffer | null = null;
const clips = new Map<UiSound, AudioBuffer>();
let loading: Promise<void> | null = null;

/** Fetches and decodes the recorded clips (once; later calls share the first). */
export function loadUiSounds(): Promise<void> {
  const a = context();
  if (!a) return Promise.resolve();
  loading ??= Promise.all(
    KINDS.map(async (k) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}assets/sounds/ui_${k}.wav`);
        if (!res.ok) return;
        clips.set(k, await a.ctx.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // The synthesised stand-in keeps playing for this one.
      }
    }),
  ).then(() => undefined);
  return loading;
}

function playClip(c: AudioContext, dest: AudioNode, buf: AudioBuffer, gain: number): void {
  const s = c.createBufferSource();
  s.buffer = buf;
  // A touch of pitch variety so repeated hovers don't sound like a loop.
  s.playbackRate.value = 0.97 + Math.random() * 0.06;
  const g = c.createGain();
  g.gain.value = gain;
  s.connect(g).connect(dest);
  s.start();
}

function context(): { ctx: AudioContext; out: GainNode } | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
    out = ctx.createGain();
    out.gain.value = volume;
    out.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return { ctx, out: out! };
}

export function setUiVolume(v: number): void {
  volume = v;
  if (out) out.gain.value = v;
}

/** A sine / square blip with a fast attack and an exponential tail. */
function tone(c: AudioContext, dest: AudioNode, at: number, freq: number, len: number, gain: number, type: OscillatorType = 'sine', glide = 0): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, at + len);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(dest);
  o.start(at);
  o.stop(at + len + 0.02);
}

/** Band-passed noise: ticks, clicks and swishes. */
function hiss(c: AudioContext, dest: AudioNode, at: number, len: number, gain: number, from: number, to = from, q = 1.2): void {
  const s = c.createBufferSource();
  s.buffer = noise;
  s.playbackRate.value = 1;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(from, at);
  f.frequency.exponentialRampToValueAtTime(to, at + len);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.006, len / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  s.connect(f).connect(g).connect(dest);
  s.start(at, Math.random() * 0.5);
  s.stop(at + len + 0.02);
}

let lastHover = 0;

export function uiSound(kind: UiSound): void {
  const a = context();
  if (!a) return;
  const { ctx: c, out: o } = a;
  const t = c.currentTime + 0.002;
  if (kind === 'hover') {
    // Rapid sweeps over a list would chatter: at most one tick per 40 ms.
    if (t - lastHover < 0.04) return;
    lastHover = t;
  }
  const clip = clips.get(kind);
  if (clip) {
    playClip(c, o, clip, LEVEL[kind]);
    return;
  }
  void loadUiSounds();
  switch (kind) {
    case 'hover':
      hiss(c, o, t, 0.018, 0.06, 5200, 5200, 2.5);
      break;
    case 'move':
      hiss(c, o, t, 0.022, 0.08, 3600, 3600, 3);
      tone(c, o, t, 1750, 0.03, 0.025);
      break;
    case 'select':
      hiss(c, o, t, 0.015, 0.12, 2600, 2600, 2);
      tone(c, o, t, 880, 0.06, 0.05, 'triangle');
      tone(c, o, t + 0.045, 1320, 0.09, 0.045, 'triangle');
      break;
    case 'back':
      hiss(c, o, t, 0.015, 0.1, 2200, 2200, 2);
      tone(c, o, t, 1100, 0.07, 0.04, 'triangle', 0.6);
      break;
    case 'open':
      hiss(c, o, t, 0.2, 0.07, 700, 3800, 0.8);
      break;
    case 'error':
      tone(c, o, t, 196, 0.09, 0.06, 'square');
      tone(c, o, t + 0.11, 165, 0.12, 0.06, 'square');
      break;
    case 'start':
      tone(c, o, t, 70, 0.35, 0.22, 'sine', 0.5);
      hiss(c, o, t, 0.5, 0.1, 400, 2600, 0.7);
      tone(c, o, t + 0.06, 660, 0.12, 0.04, 'triangle');
      tone(c, o, t + 0.13, 990, 0.22, 0.04, 'triangle');
      break;
  }
}
