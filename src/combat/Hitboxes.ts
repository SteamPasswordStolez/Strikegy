import type * as THREE from 'three';
import type { HitPart } from '@/core/events';
import type { Team } from '@/world/mapTypes';

/** Who dealt damage (for hit direction, kill feed and bot awareness). */
export interface DamageSource {
  pos: THREE.Vector3;
  name: string;
  team: Team | null;
  weapon: string;
  /** Combatant id of the attacker (player = 0). */
  id: number;
}

/**
 * What kind of hit: bullets barely scratch armour, `heavy` is a mounted gun
 * (vehicle MGs, aircraft cannon: what brings planes down), AT weapons are made
 * for armour (people take all kinds the same).
 */
export type DamageKind = 'bullet' | 'heavy' | 'explosive' | 'at';

export interface Damageable {
  readonly id: number;
  /** Display name for the kill feed. */
  readonly name: string;
  readonly alive: boolean;
  /** Team for friendly-fire checks; null = neutral (practice targets). */
  readonly team?: Team | null;
  /** Returns true if this damage killed the target. */
  applyDamage(amount: number, part: HitPart, source?: DamageSource, kind?: DamageKind): boolean;
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
