import type { HitPart } from '@/core/events';

export interface Damageable {
  readonly id: number;
  /** Display name for the kill feed. */
  readonly name: string;
  readonly alive: boolean;
  /** Returns true if this damage killed the target. */
  applyDamage(amount: number, part: HitPart): boolean;
}

export const PART_MULT: Record<HitPart, number> = { head: 1, body: 1, limb: 0.85 };

/** Maps physics collider handles to the damageable entity and body part they belong to. */
export class HitboxRegistry {
  private map = new Map<number, { owner: Damageable; part: HitPart }>();

  register(colliderHandle: number, owner: Damageable, part: HitPart): void {
    this.map.set(colliderHandle, { owner, part });
  }

  unregister(colliderHandle: number): void {
    this.map.delete(colliderHandle);
  }

  lookup(colliderHandle: number): { owner: Damageable; part: HitPart } | undefined {
    return this.map.get(colliderHandle);
  }
}

/** Final damage for one bullet/pellet on a given part. */
export function computeDamage(base: number, part: HitPart, headshotMult: number): number {
  return part === 'head' ? base * headshotMult : base * PART_MULT[part];
}
