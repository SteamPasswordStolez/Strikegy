/**
 * Each weapon's camo challenges (progression step 5; progression-data.md B):
 * six tiers, each opening only once the one before is done (bot kills count).
 * 1 kills 25, 2 headshots 15, 3 kills 75, 4 the kind's own feat, 5 three
 * kills in one life five times, 6 brass when 1-5 are done. Every gun of a
 * kind in brass opens obsidian for that kind; all 23 in obsidian open the blue
 * dragon for every gun. Import-free but for the catalog's look type.
 */
import { item, type CamoLook } from './catalog';
import type { WeaponClass } from '@/weapons/weaponData';

/** What a match counted toward one weapon's challenges. */
export interface CamoCounts {
  kills: number;
  headshots: number;
  /** Times three kills came in one life. */
  triples: number;
  /** The kind's feat (tier 4). */
  special: number;
}

export type CamoTierKind = keyof CamoCounts;

export interface CamoTier {
  id: string;
  kind: CamoTierKind;
  n: number;
  name: [string, string];
  look: CamoLook;
}

/** Tier 4 by kind of gun: what counts and how many. */
export const SPECIAL: Record<WeaponClass, { n: number; what: 'far50' | 'hip' | 'double' | 'close8' | 'headshots' | 'far150'; name: [string, string] }> = {
  ar: { n: 15, what: 'far50', name: ['50 m 넘게 처치', 'Kills past 50 m'] },
  smg: { n: 20, what: 'hip', name: ['지향 사격 처치', 'Hip-fire kills'] },
  lmg: { n: 10, what: 'double', name: ['한 탄창으로 2킬', 'Two kills in one magazine'] },
  sg: { n: 30, what: 'close8', name: ['8 m 안 처치', 'Kills within 8 m'] },
  dmr: { n: 30, what: 'headshots', name: ['헤드샷', 'Headshots'] },
  sr: { n: 15, what: 'far150', name: ['150 m 넘게 처치', 'Kills past 150 m'] },
  pistol: { n: 5, what: 'double', name: ['한 탄창으로 2킬', 'Two kills in one magazine'] },
};

export const CAMO_TIERS: readonly CamoTier[] = [
  { id: 'wc1', kind: 'kills', n: 25, name: ['올리브 드랩', 'Olive drab'], look: { pattern: 'solid', colors: [0x5a5c36, 0x45472a, 0x6a6c40], scale: 6 } },
  { id: 'wc2', kind: 'headshots', n: 15, name: ['갈색 얼룩', 'Brown blotch'], look: { pattern: 'blotch', colors: [0x6a5236, 0x3f3020, 0x8a6e48], scale: 6 } },
  { id: 'wc3', kind: 'kills', n: 75, name: ['숲 띠무늬', 'Woodland bands'], look: { pattern: 'bands', colors: [0x3f4a2a, 0x23291a, 0x6a5a38], scale: 6 } },
  { id: 'wc4', kind: 'special', n: 0, name: ['갈대', 'Reeds'], look: { pattern: 'stripes', colors: [0x8c7f52, 0x5e5534, 0xb3a46d], scale: 9 } },
  { id: 'wc5', kind: 'triples', n: 5, name: ['호랑이 줄무늬', 'Tiger stripes'], look: { pattern: 'tiger', colors: [0x6a6a3a, 0x18180c, 0x9a8a4a], scale: 6 } },
];

export const BRASS: { id: string; name: [string, string]; look: CamoLook } = {
  id: 'brass',
  name: ['황동', 'Brass'],
  look: { pattern: 'metal', colors: [0xc8a050, 0x8a6a2a, 0xffe8a0], scale: 10, metal: 0.95 },
};
export const OBSIDIAN: { id: string; name: [string, string]; look: CamoLook } = {
  id: 'obsidian',
  name: ['흑요석', 'Obsidian'],
  look: { pattern: 'obsidian', colors: [0x0c0b0e, 0x020203, 0xd0202a], scale: 5, metal: 0.8, flow: 0.25 },
};
export const DRAGON: { id: string; name: [string, string]; look: CamoLook } = {
  id: 'dragon',
  name: ['청룡', 'Blue dragon'],
  look: { pattern: 'scales', colors: [0x1a5aa8, 0x0a1a3a, 0x8ae0ff], scale: 9, metal: 0.75, flow: 0.45 },
};

/** How many of a tier's kind count (tier 4 by the gun's kind). */
export function tierTarget(tier: number, cls: WeaponClass): number {
  const t = CAMO_TIERS[tier];
  if (!t) return 0;
  return t.kind === 'special' ? SPECIAL[cls].n : t.n;
}

/** One weapon's progress: tiers done (0-6) and the count toward the next. */
export interface CamoState {
  tier: number;
  prog: number;
}

/**
 * Adds a match's counts to a weapon's challenges. Only the tier in progress
 * counts (a count left over when it finishes doesn't carry to the next);
 * tier 6 (brass) follows tier 5 at once. Returns the tiers finished.
 */
export function advanceCamo(state: CamoState, counts: CamoCounts, cls: WeaponClass): number[] {
  const done: number[] = [];
  let guard = 8;
  const used: Partial<Record<CamoTierKind, boolean>> = {};
  while (state.tier < 6 && guard-- > 0) {
    if (state.tier === 5) {
      state.tier = 6;
      state.prog = 0;
      done.push(6);
      break;
    }
    const t = CAMO_TIERS[state.tier]!;
    // Each kind of count goes into one tier a match (no double use of the same kills).
    if (used[t.kind]) break;
    used[t.kind] = true;
    state.prog += counts[t.kind];
    const need = tierTarget(state.tier, cls);
    if (state.prog < need) break;
    state.tier++;
    state.prog = 0;
    done.push(state.tier);
  }
  return done;
}

/** The camo id a finished tier opens (1-5 the tier camos, 6 brass). */
export function tierCamo(tier: number): string {
  return tier >= 6 ? BRASS.id : CAMO_TIERS[tier - 1]!.id;
}

/** A challenge camo's look (tier camos, brass, obsidian, dragon). */
export function challengeLook(id: string): CamoLook | undefined {
  if (id === BRASS.id) return BRASS.look;
  if (id === OBSIDIAN.id) return OBSIDIAN.look;
  if (id === DRAGON.id) return DRAGON.look;
  return CAMO_TIERS.find((t) => t.id === id)?.look;
}

/** Any camo's look: a challenge camo or a shared one from the catalog. */
export function camoLookOf(id: string): CamoLook | undefined {
  return challengeLook(id) ?? item(id)?.camo;
}

/** Any camo's name. */
export function camoNameOf(id: string): [string, string] | undefined {
  return challengeName(id) ?? item(id)?.name;
}

export function challengeName(id: string): [string, string] | undefined {
  if (id === BRASS.id) return BRASS.name;
  if (id === OBSIDIAN.id) return OBSIDIAN.name;
  if (id === DRAGON.id) return DRAGON.name;
  return CAMO_TIERS.find((t) => t.id === id)?.name;
}
