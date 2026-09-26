import { hash01 } from '@/render/noise';

export interface RecoilSpec {
  /** Vertical kick per shot in degrees. */
  up: number;
  /** Max horizontal kick per shot in degrees. */
  side: number;
  /** Multiplier on the first shot of a spray. */
  first: number;
}

/** Shots after which vertical climb eases off and horizontal sway takes over. */
const PLATEAU_SHOT = 8;

/**
 * Deterministic, learnable spray pattern: each spray gets a seed; within it the
 * horizontal drift follows a smooth wave plus a little per-shot jitter, so the
 * same weapon feels consistent but not perfectly identical every spray.
 * Returns kick in degrees (positive pitch = up, positive yaw = left).
 */
export function recoilKick(spec: RecoilSpec, shotIndex: number, seed: number): { pitch: number; yaw: number } {
  const climb = shotIndex === 0 ? spec.first : shotIndex < PLATEAU_SHOT ? 1 : 0.7;
  const wave = Math.sin(seed * 6.283 + shotIndex * 0.55);
  const jitter = hash01(Math.floor(seed * 1e6) + shotIndex * 7919) - 0.5;
  const sideScale = shotIndex < 3 ? 0.35 : shotIndex < PLATEAU_SHOT ? 0.8 : 1.2;
  return {
    pitch: spec.up * climb,
    yaw: spec.side * (wave * 0.7 + jitter * 0.6) * sideScale,
  };
}

export interface RecoilModifiers {
  adsBlend: number;
  crouched: boolean;
}

export function recoilScale(m: RecoilModifiers): number {
  return (1 - 0.3 * m.adsBlend) * (m.crouched ? 0.8 : 1);
}
