/**
 * What this browser's player may pick right now (progression step 3): the
 * profile's XP for the locked weapons, each weapon's own XP for its level, and
 * whether the match opens everything (the room's "전부 해금", the range).
 * Module state like `MATCH`: one player a page. The kit picker and the loadout
 * store read it; `Game` sets it at the start and as levels rise.
 */
import { weaponLocked } from './unlocks';

export interface Access {
  /** The profile's XP (live in a match). */
  xp: number;
  /** Everything open in this match. */
  all: boolean;
  /** Weapon id -> its XP (live in a match). */
  weaponXp: Record<string, number>;
}

export const ACCESS: Access = { xp: 0, all: false, weaponXp: {} };

export function setAccess(a: Partial<Access>): void {
  Object.assign(ACCESS, a);
}

/** Can't be picked yet. */
export function isLocked(id: string): boolean {
  return weaponLocked(id, ACCESS.xp, ACCESS.all);
}
