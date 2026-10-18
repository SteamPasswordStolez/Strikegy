/**
 * The sea's surface (2026-10-18, big maps plan step 2): a sum of Gerstner
 * waves, computed by the same numbers here (the sim: swimmers, boats, the
 * game server) and in the water shader (`seaGlsl`, fed from `waveUniforms`),
 * so the browser and the server see the same surface. Pure maths, no Three.
 *
 * A Gerstner wave moves surface points in circles: a point that rests at
 * (x0, z0) is at
 *   x = x0 + sum(dx * h * cos f),  z = z0 + sum(dz * h * cos f),  y = level + sum(a * sin f)
 * with f = k (d . p0) - w t + phase, k = 2 pi / length, w = sqrt(g k) (deep
 * water), h = steep / (k n) the sideways reach (steep <= 1 never folds).
 * The height under a world point is found by walking back from it.
 */

export interface WaveDef {
  /** Heading the wave runs toward (degrees, 0 = -z, 90 = +x). */
  dir: number;
  /** Crest to crest (m). */
  length: number;
  /** Height of a crest over the mean (m). */
  amp: number;
  /** 0..1: how sharp the crests are (Gerstner's Q share). */
  steep: number;
}

export interface SeaDef {
  /** Mean water level (m). */
  level: number;
  /** A named sea state or the waves themselves. */
  waves?: 'calm' | 'moderate' | 'rough' | WaveDef[];
  /** Sea bed beyond the boundary (m, absolute; default level - 30): the ground eases down to it. */
  floor?: number;
}

/**
 * Sea states. Gameplay first (boats must stay drivable and swimmers in
 * sight): 'moderate' is ~0.9 m from trough to crest, what a sheltered bay
 * shows on a breezy day.
 */
export const SEA_STATES: Record<'calm' | 'moderate' | 'rough', WaveDef[]> = {
  calm: [
    { dir: 20, length: 38, amp: 0.16, steep: 0.5 },
    { dir: 60, length: 17, amp: 0.07, steep: 0.6 },
    { dir: -30, length: 9, amp: 0.03, steep: 0.5 },
    { dir: 110, length: 5.5, amp: 0.015, steep: 0.4 },
  ],
  moderate: [
    { dir: 20, length: 52, amp: 0.34, steep: 0.55 },
    { dir: 55, length: 27, amp: 0.16, steep: 0.6 },
    { dir: -15, length: 14, amp: 0.07, steep: 0.6 },
    { dir: 95, length: 8, amp: 0.035, steep: 0.5 },
    { dir: 140, length: 4.5, amp: 0.015, steep: 0.4 },
  ],
  rough: [
    { dir: 20, length: 70, amp: 0.75, steep: 0.6 },
    { dir: 50, length: 36, amp: 0.36, steep: 0.65 },
    { dir: -20, length: 18, amp: 0.15, steep: 0.6 },
    { dir: 85, length: 10, amp: 0.07, steep: 0.5 },
    { dir: 135, length: 5, amp: 0.03, steep: 0.4 },
  ],
};

/** Most waves the shader takes. */
export const MAX_WAVES = 6;
const G = 9.81;

/** One wave in the form both sides compute with. */
interface Term {
  dx: number;
  dz: number;
  k: number;
  w: number;
  a: number;
  /** Sideways reach (m). */
  h: number;
  phase: number;
}

export class Sea {
  readonly level: number;
  readonly floor: number;
  readonly terms: readonly Term[];
  /** Sea time (s): the match clock on both sides. */
  time = 0;
  /** Trough to crest at most (m). */
  readonly swell: number;

  constructor(def: SeaDef) {
    this.level = def.level;
    this.floor = def.floor ?? def.level - 30;
    const waves = typeof def.waves === 'object' ? def.waves : SEA_STATES[def.waves ?? 'moderate'];
    const list = waves.slice(0, MAX_WAVES);
    const n = Math.max(1, list.length);
    this.terms = list.map((w, i) => {
      const rad = (w.dir * Math.PI) / 180;
      const k = (Math.PI * 2) / w.length;
      return { dx: Math.sin(rad), dz: -Math.cos(rad), k, w: Math.sqrt(G * k), a: w.amp, h: Math.min(1, w.steep) / (k * n), phase: i * 1.7 };
    });
    this.swell = 2 * this.terms.reduce((s, t) => s + t.a, 0);
  }

  /** Where the surface point resting at (x0, z0) is at time t: writes [x, y, z]. */
  displaced(x0: number, z0: number, t: number, out: number[]): number[] {
    let x = x0;
    let y = this.level;
    let z = z0;
    for (const w of this.terms) {
      const f = w.k * (w.dx * x0 + w.dz * z0) - w.w * t + w.phase;
      const c = Math.cos(f);
      x += w.dx * w.h * c;
      z += w.dz * w.h * c;
      y += w.a * Math.sin(f);
    }
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  }

  private readonly tmp = [0, 0, 0];

  /** Water height over (x, z) at time t (default: `time`). */
  heightAt(x: number, z: number, t = this.time): number {
    // Walk back to the resting point that ends up over (x, z): the sideways
    // reach is small next to the wave lengths, so a few rounds settle it.
    let x0 = x;
    let z0 = z;
    const p = this.tmp;
    for (let i = 0; i < 4; i++) {
      this.displaced(x0, z0, t, p);
      x0 += x - p[0]!;
      z0 += z - p[2]!;
    }
    return this.displaced(x0, z0, t, p)[1]!;
  }

  /** Surface normal over (x, z) (finite differences of `heightAt`): writes [nx, ny, nz]. */
  normalAt(x: number, z: number, out: number[], t = this.time): number[] {
    const e = 0.5;
    const hx = this.heightAt(x + e, z, t) - this.heightAt(x - e, z, t);
    const hz = this.heightAt(x, z + e, t) - this.heightAt(x, z - e, t);
    const len = Math.hypot(hx, 2 * e, hz);
    out[0] = -hx / len;
    out[1] = (2 * e) / len;
    out[2] = -hz / len;
    return out;
  }

  /** Vertical speed of the surface over (x, z) (m/s). */
  riseAt(x: number, z: number, t = this.time): number {
    const dt = 0.05;
    return (this.heightAt(x, z, t + dt) - this.heightAt(x, z, t - dt)) / (2 * dt);
  }
}

/** The waves as shader uniforms: per wave (dx, dz, k, w) and (a, h, phase, 0). */
export function waveUniforms(sea: Sea): { dir: Float32Array; shape: Float32Array; count: number } {
  const dir = new Float32Array(MAX_WAVES * 4);
  const shape = new Float32Array(MAX_WAVES * 4);
  sea.terms.forEach((w, i) => {
    dir.set([w.dx, w.dz, w.k, w.w], i * 4);
    shape.set([w.a, w.h, w.phase, 0], i * 4);
  });
  return { dir, shape, count: sea.terms.length };
}

/**
 * GLSL for the same sum (needs uniforms `seaDir[MAX_WAVES]`, `seaShape[MAX_WAVES]`,
 * `seaCount`, `seaTime`, `seaLevel`). `seaFade` (0..1 per wave) lets the
 * caller fade waves too short for the mesh far from the camera.
 */
export const seaGlsl = /* glsl */ `
#define SEA_WAVES ${MAX_WAVES}
uniform vec4 seaDir[SEA_WAVES];
uniform vec4 seaShape[SEA_WAVES];
uniform int seaCount;
uniform float seaTime;
uniform float seaLevel;
// Displacement of the point resting at p0 (xz), and the surface's slope there (dh/dx, dh/dz)
// for its normal; waves shorter than minLen fade out (too short for the mesh there).
vec3 seaDisplace(vec2 p0, float minLen, out vec2 slope) {
  vec3 d = vec3(0.0, seaLevel, 0.0);
  slope = vec2(0.0);
  for (int i = 0; i < SEA_WAVES; i++) {
    if (i >= seaCount) break;
    vec4 a = seaDir[i];
    vec4 b = seaShape[i];
    float fade = smoothstep(minLen, minLen * 2.0, 6.2831853 / a.z);
    float f = a.z * dot(a.xy, p0) - a.w * seaTime + b.z;
    float c = cos(f);
    float s = sin(f);
    d.xz += a.xy * (b.y * c * fade);
    d.y += b.x * s * fade;
    slope += a.xy * (a.z * b.x * c * fade);
  }
  return d;
}
`;
