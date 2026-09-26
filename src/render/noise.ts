/** Deterministic PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LATTICE = 256;

/**
 * Tileable 2D value noise. Coordinates are in [0, 1) texture space; every
 * frequency is an integer lattice period so the result wraps seamlessly.
 */
export class TileNoise {
  private readonly values: Float32Array;

  constructor(seed: number) {
    const rng = makeRng(seed);
    this.values = new Float32Array(LATTICE * LATTICE);
    for (let i = 0; i < this.values.length; i++) this.values[i] = rng();
  }

  /** Value noise at (u, v) with integer frequency `freq` (<= 256). Returns [0, 1]. */
  sample(u: number, v: number, freq: number): number {
    const x = u * freq;
    const y = v * freq;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = ((xi % freq) + freq) % freq;
    const y0 = ((yi % freq) + freq) % freq;
    const x1 = (x0 + 1) % freq;
    const y1 = (y0 + 1) % freq;
    const vals = this.values;
    const a = vals[y0 * LATTICE + x0]!;
    const b = vals[y0 * LATTICE + x1]!;
    const c = vals[y1 * LATTICE + x0]!;
    const d = vals[y1 * LATTICE + x1]!;
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  /** Anisotropic variant: separate integer frequencies per axis (streaks, grain). */
  sampleXY(u: number, v: number, fx: number, fy: number): number {
    const x = u * fx;
    const y = v * fy;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = ((xi % fx) + fx) % fx;
    const y0 = ((yi % fy) + fy) % fy;
    const x1 = (x0 + 1) % fx;
    const y1 = (y0 + 1) % fy;
    const vals = this.values;
    const a = vals[y0 * LATTICE + x0]!;
    const b = vals[y0 * LATTICE + x1]!;
    const c = vals[y1 * LATTICE + x0]!;
    const d = vals[y1 * LATTICE + x1]!;
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  /** Fractal sum of octaves; result roughly in [0, 1]. */
  fbm(u: number, v: number, baseFreq: number, octaves: number, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = baseFreq;
    for (let o = 0; o < octaves; o++) {
      sum += this.sample(u, v, Math.min(f, LATTICE)) * amp;
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }
}

/** Integer hash to [0, 1). */
export function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function fract(x: number): number {
  return x - Math.floor(x);
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export type RGB = [number, number, number];

export function hexToRgb(hex: number): RGB {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
