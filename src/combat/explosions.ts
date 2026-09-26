export type GrenadeType = 'frag' | 'flash' | 'smoke';

export interface GrenadeSpec {
  type: GrenadeType;
  /** Seconds from pin pull (throw) to detonation. */
  fuse: number;
  /** Throw speed in m/s. */
  throwSpeed: number;
  /** Frag: lethal core and max damage radius; flash: effective radius; smoke: cloud radius. */
  innerRadius: number;
  radius: number;
  maxDamage: number;
  /** Smoke only: seconds the cloud lasts. */
  duration?: number;
}

export const GRENADES: Record<GrenadeType, GrenadeSpec> = {
  frag: { type: 'frag', fuse: 3.2, throwSpeed: 17, innerRadius: 2.5, radius: 7, maxDamage: 130 },
  flash: { type: 'flash', fuse: 1.6, throwSpeed: 18, innerRadius: 3, radius: 18, maxDamage: 0 },
  smoke: { type: 'smoke', fuse: 1.8, throwSpeed: 15, innerRadius: 1, radius: 5.5, maxDamage: 0, duration: 20 },
};

/**
 * Frag damage at a distance: full damage inside the core, quadratic falloff to
 * zero at the edge. Occluded targets only take damage inside the core, halved.
 */
export function fragDamage(spec: GrenadeSpec, distance: number, occluded: boolean): number {
  if (distance >= spec.radius) return 0;
  if (occluded) return distance <= spec.innerRadius ? spec.maxDamage * 0.5 : 0;
  if (distance <= spec.innerRadius) return spec.maxDamage;
  const t = (distance - spec.innerRadius) / (spec.radius - spec.innerRadius);
  return spec.maxDamage * (1 - t) * (1 - t);
}

/**
 * Flashbang blindness 0..1. `facing` is the dot product between the view
 * direction and the direction to the flash (1 = looking straight at it).
 */
export function flashIntensity(spec: GrenadeSpec, distance: number, facing: number, occluded: boolean): number {
  if (occluded || distance >= spec.radius) return 0;
  const range = Math.pow(1 - distance / spec.radius, 0.6);
  const look = 0.3 + 0.7 * Math.max(0, (facing + 0.2) / 1.2);
  const close = distance < spec.innerRadius ? 1 : look;
  return Math.min(1, range * close);
}

/** Seconds the screen stays white for a given flash intensity. */
export function flashDuration(intensity: number): number {
  return intensity <= 0 ? 0 : 0.4 + 4.2 * intensity;
}
