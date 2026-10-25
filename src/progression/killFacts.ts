/**
 * What a kill was, for the progression (step 5: camo challenges, ribbons,
 * missions, bounties): distance, hip fire, kills in one magazine, grenade /
 * call-in / vehicle, in a held zone, beside a squad mate, the victim's standing.
 * One helper for solo `Game` and the game server's rooms, so both count alike.
 * It also keeps each soldier's kills in the current life (`LifeKills`).
 */
import type * as THREE from 'three';
import { t } from '@/i18n';
import type { FinishExtra, KillInfo } from './tracker';

/** Kills in each soldier's current life (bounties for ending a streak). */
export class LifeKills {
  private readonly n = new Map<number, number>();
  kill(by: number): void {
    this.n.set(by, (this.n.get(by) ?? 0) + 1);
  }
  died(id: number): void {
    this.n.delete(id);
  }
  of(id: number): number {
    return this.n.get(id) ?? 0;
  }
}

/** Kills in one magazine, per shooter (the camo "two kills in one magazine"). */
export class MagKills {
  private last = new Map<number, { weapon: string; reloads: number; n: number }>();
  /** A kill by `by` with `weapon`, its magazine number `reloads`: kills with this magazine so far. */
  kill(by: number, weapon: string, reloads: number): number {
    const l = this.last.get(by);
    const n = l && l.weapon === weapon && l.reloads === reloads ? l.n + 1 : 1;
    this.last.set(by, { weapon, reloads, n });
    return n;
  }
}

export interface KillContext {
  weaponId: string | null;
  weaponName: string;
  headshot: boolean;
  melee: boolean;
  killer: THREE.Vector3;
  victim: THREE.Vector3 | null;
  /** Aiming down the sights at the moment (0..1). */
  ads: number;
  riding: boolean;
  magKills: number;
  /** Zones the killer's side holds (centre and radius). */
  held: readonly { x: number; z: number; r: number }[];
  /** Squad mates' feet (alive). */
  mates: readonly THREE.Vector3[];
  victimTop: boolean;
  victimStreak: number;
}

let names: { grenade: Set<string>; callin: Set<string> } | null = null;

function weaponNames(): { grenade: Set<string>; callin: Set<string> } {
  // The kill feed's names in this page's language (the server's default).
  names ??= {
    grenade: new Set([t('grenade.frag')]),
    callin: new Set([t('support.mortar'), t('support.artillery')]),
  };
  return names;
}

/** One's standing at the end (MVP of everyone, place on one's side) from the scoreboard's rows. */
export function standing(rows: readonly { id: number; team: string; score: number }[], id: number, team: string): FinishExtra {
  const all = [...rows].sort((a, b) => b.score - a.score);
  const mine = all.filter((r) => r.team === team);
  const me = all.find((r) => r.id === id);
  if (!me || me.score <= 0) return {};
  return { mvp: all[0]?.id === id, place: mine.findIndex((r) => r.id === id) + 1 };
}

export function killFacts(c: KillContext): KillInfo {
  const n = weaponNames();
  const dist = c.victim ? Math.hypot(c.victim.x - c.killer.x, c.victim.y - c.killer.y, c.victim.z - c.killer.z) : undefined;
  const at = c.victim ?? c.killer;
  return {
    weapon: c.weaponId,
    headshot: c.headshot,
    melee: c.melee,
    dist,
    hip: c.weaponId ? c.ads < 0.5 : undefined,
    magKills: c.weaponId ? c.magKills : undefined,
    grenade: n.grenade.has(c.weaponName),
    callin: n.callin.has(c.weaponName),
    vehicle: c.riding,
    defend: c.held.some((z) => Math.hypot(at.x - z.x, at.z - z.z) < z.r || Math.hypot(c.killer.x - z.x, c.killer.z - z.z) < z.r),
    squad: c.mates.some((m) => Math.hypot(m.x - c.killer.x, m.y - c.killer.y, m.z - c.killer.z) < 30),
    victimTop: c.victimTop,
    victimStreak: c.victimStreak,
  };
}
