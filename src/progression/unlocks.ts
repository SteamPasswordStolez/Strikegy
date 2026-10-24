/**
 * What levels open (progression plan step 3, progression.md 3-3 / 3-4): five
 * weapons at low levels (owner, 2026-10-19: the other 18 are open from the
 * start), the marshal's menu track at level 1000 (owner, 2026-10-24), and each
 * weapon's own level, 1-20 at 10,000 weapon XP a level (that gun's kill score
 * x10, after the match's multipliers). The room setting "전부 해금" (off by
 * default) opens every weapon in that room. Import-free but for the curve:
 * the server, the menu and the game share it.
 */
import { levelOf } from './levels';

/** Weapon -> the player level that opens it. */
export const WEAPON_UNLOCKS: Readonly<Record<string, number>> = {
  smg3: 4, // MP5SD
  sg3: 8, // M1014
  lmg2: 14, // M60E4
  sr2: 22, // L115A3
  pistol3: 32, // APS
};

/** The level whose rank is 원수: the menu's track becomes the marshal's. */
export const MARSHAL_MUSIC_LEVEL = 1000;

export const WEAPON_LEVEL_XP = 10_000;
export const WEAPON_LEVEL_MAX = 20;

/** The player level a weapon needs (1: open from the start). */
export function weaponUnlockLevel(id: string): number {
  return WEAPON_UNLOCKS[id] ?? 1;
}

/** Locked for someone with `xp` (unless everything is open in this match). */
export function weaponLocked(id: string, xp: number, allUnlocked = false): boolean {
  if (allUnlocked) return false;
  const need = WEAPON_UNLOCKS[id];
  return need !== undefined && levelOf(xp).level < need;
}

/** The weapons a level opens (for the notice when it is reached). */
export function weaponsOpenedAt(level: number): string[] {
  return Object.entries(WEAPON_UNLOCKS)
    .filter(([, l]) => l === level)
    .map(([id]) => id);
}

export interface WeaponLevel {
  level: number;
  /** XP into this level, and the level's size (0 at the top). */
  into: number;
  need: number;
}

/** A weapon's level from its XP. */
export function weaponLevelOf(xp: number): WeaponLevel {
  const x = Math.max(0, Math.floor(xp));
  const level = Math.min(WEAPON_LEVEL_MAX, 1 + Math.floor(x / WEAPON_LEVEL_XP));
  if (level >= WEAPON_LEVEL_MAX) return { level, into: 0, need: 0 };
  return { level, into: x - (level - 1) * WEAPON_LEVEL_XP, need: WEAPON_LEVEL_XP };
}
