import type { WeaponId } from '@/weapons/weaponData';

/**
 * Fighting styles. Every bot rolls one on creation so a team is a mix of
 * people who rush, people who hold, and people who shoot from afar, instead
 * of a column of identical soldiers.
 */
export type Archetype = 'rusher' | 'rifleman' | 'anchor' | 'marksman';

export interface Personality {
  archetype: Archetype;
  /** 0..1: pushes, chases and trades rather than waiting. */
  aggression: number;
  /** 0..1: fights from cover, approaches carefully, retreats sooner. */
  caution: number;
  /** Multiplier on the time to notice an enemy. */
  reaction: number;
  /** Multiplier on aim error. */
  aim: number;
  /** Multiplier on the weapon's preferred fighting distance. */
  range: number;
  /** Walk / sprint speed multiplier. */
  pace: number;
  /** Side of the path this bot keeps to (-1..1), so a group spreads out instead of walking single file. */
  lane: number;
  /** 0..1: how readily grenades and smoke come out. */
  grenades: number;
}

interface Style {
  weight: number;
  weapons: [WeaponId, number][];
  aggression: [number, number];
  caution: [number, number];
  range: [number, number];
  pace: [number, number];
  grenades: [number, number];
}

const STYLES: Record<Archetype, Style> = {
  rusher: {
    weight: 25,
    weapons: [
      ['smg1', 3],
      ['smg2', 2],
      ['sg1', 2],
      ['ar1', 1],
    ],
    aggression: [0.7, 1],
    caution: [0, 0.3],
    range: [0.7, 0.9],
    pace: [1, 1.05],
    grenades: [0.5, 0.9],
  },
  rifleman: {
    weight: 45,
    weapons: [
      ['ar1', 3],
      ['ar2', 2],
      ['ar3', 1],
      ['smg1', 1],
    ],
    aggression: [0.35, 0.65],
    caution: [0.3, 0.6],
    range: [0.9, 1.1],
    pace: [0.95, 1.02],
    grenades: [0.4, 0.8],
  },
  anchor: {
    weight: 20,
    weapons: [
      ['lmg1', 3],
      ['ar2', 1],
      ['ar1', 1],
    ],
    aggression: [0.1, 0.4],
    caution: [0.6, 0.9],
    range: [1, 1.25],
    pace: [0.9, 0.97],
    grenades: [0.3, 0.6],
  },
  marksman: {
    weight: 10,
    weapons: [
      ['dmr1', 3],
      ['dmr2', 1],
    ],
    aggression: [0.05, 0.3],
    caution: [0.6, 1],
    range: [1.1, 1.4],
    pace: [0.9, 0.97],
    grenades: [0.1, 0.4],
  },
};

/** Every weapon a bot can carry (for model prewarming). */
export const BOT_WEAPONS: WeaponId[] = [...new Set(Object.values(STYLES).flatMap((s) => s.weapons.map(([id]) => id)))];

function pick<T>(items: [T, number][], rand: () => number): T {
  let r = rand() * items.reduce((a, [, w]) => a + w, 0);
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[0]![0];
}

const between = ([lo, hi]: [number, number], rand: () => number) => lo + (hi - lo) * rand();

export function rollPersonality(rand: () => number = Math.random): Personality {
  const archetype = pick(
    (Object.keys(STYLES) as Archetype[]).map((a) => [a, STYLES[a].weight] as [Archetype, number]),
    rand,
  );
  const s = STYLES[archetype];
  return {
    archetype,
    aggression: between(s.aggression, rand),
    caution: between(s.caution, rand),
    reaction: 0.85 + rand() * 0.35,
    aim: 0.85 + rand() * 0.35,
    range: between(s.range, rand),
    pace: between(s.pace, rand),
    lane: rand() * 2 - 1,
    grenades: between(s.grenades, rand),
  };
}

/** A weapon that suits the style (re-rolled on every respawn). */
export function weaponFor(p: Personality, rand: () => number = Math.random): WeaponId {
  return pick(STYLES[p.archetype].weapons, rand);
}
