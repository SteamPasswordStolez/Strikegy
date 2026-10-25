import { hash01 } from '@/render/noise';

export interface RecoilSpec {
  /** Vertical kick per shot in degrees. */
  up: number;
  /** Max horizontal kick per shot in degrees. */
  side: number;
  /** Multiplier on the first shot of a spray. */
  first: number;
  /** The gun's own sideways lean (-1 left .. 1 right, a share of `side`). */
  drift?: number;
}

/** Shots after which vertical climb eases off and horizontal sway takes over. */
const PLATEAU_SHOT = 8;

/**
 * A learnable spray (gunplay audit, 2026-10-18; Modern Warfare style): each gun
 * has its own pattern — a lean (`drift`) and a slow wave whose phase comes from
 * the gun (`pattern`, 0..1, fixed per weapon) — so the same gun pulls the same
 * way every spray; the spray's seed only adds a little jitter on top.
 * Returns kick in degrees (positive pitch = up, positive yaw = left).
 */
export function recoilKick(spec: RecoilSpec, shotIndex: number, seed: number, pattern = 0): { pitch: number; yaw: number } {
  const climb = shotIndex === 0 ? spec.first : shotIndex < PLATEAU_SHOT ? 1 : 0.7;
  const wave = Math.sin(pattern * 6.283 + shotIndex * 0.5);
  const jitter = hash01(Math.floor(seed * 1e6) + shotIndex * 7919) - 0.5;
  const sideScale = shotIndex < 3 ? 0.35 : shotIndex < PLATEAU_SHOT ? 0.8 : 1.2;
  // Positive drift leans right, which is negative yaw.
  const lean = -(spec.drift ?? 0) * 0.8;
  return {
    pitch: spec.up * climb,
    yaw: spec.side * (lean + wave * 0.55 + jitter * 0.35) * sideScale,
  };
}

/** The fixed phase (0..1) of a gun's spray wave, from its id. */
export function gunPattern(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return hash01(h);
}

export interface RecoilModifiers {
  adsBlend: number;
  crouched: boolean;
  /** A bipod fitted, crouched and still (attachments): x0.8 more. */
  braced?: boolean;
}

export function recoilScale(m: RecoilModifiers): number {
  return (1 - 0.3 * m.adsBlend) * (m.crouched ? 0.8 : 1) * (m.braced ? 0.8 : 1);
}
