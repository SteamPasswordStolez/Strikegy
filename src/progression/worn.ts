/**
 * What someone wears that others see (progression step 6): gun skins and
 * charms by weapon, kill effects by weapon ('*' for every gun without its
 * own), vehicle skins by family. A signed-in player's comes from their account
 * on the server (never from the browser), goes out with the room's roster, and
 * the kill event names the killer's effect.
 */
import { item, type VehicleClass } from './catalog';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';

export interface Worn {
  skin?: Record<string, string>;
  charm?: Record<string, string>;
  kfx?: Record<string, string>;
  vskin?: Record<string, string>;
}

type Slot = keyof Worn;
const SLOTS: Slot[] = ['skin', 'charm', 'kfx', 'vskin'];

/** The parts of an economy's `equip` others see. */
export function wornOf(equip: { skin?: Record<string, string>; charm?: Record<string, string>; kfx?: Record<string, string>; vskin?: Record<string, string> }): Worn | undefined {
  const out: Worn = {};
  for (const s of SLOTS) if (equip[s] && Object.keys(equip[s]!).length) out[s] = { ...equip[s] };
  return Object.keys(out).length ? out : undefined;
}

/** A worn set from outside, kept to real catalog items of the right kind. */
export function cleanWorn(raw: unknown): Worn | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Worn = {};
  for (const s of SLOTS) {
    const m = (raw as Record<string, unknown>)[s];
    if (!m || typeof m !== 'object') continue;
    const kept: Record<string, string> = {};
    for (const [k, v] of Object.entries(m as Record<string, unknown>).slice(0, 40)) {
      if (typeof v !== 'string' || !/^[\w.*-]{1,16}$/.test(k)) continue;
      const it = item(v);
      if (it?.kind !== s) continue;
      if (s === 'skin' && it.weapon !== k) continue;
      if (s === 'vskin' && it.vclass !== k) continue;
      kept[k] = v;
    }
    if (Object.keys(kept).length) out[s] = kept;
  }
  return Object.keys(out).length ? out : undefined;
}

let byName: Map<string, string> | null = null;
/** A weapon id from its id or its display name (kill events carry the name). */
function weaponIdOf(w: string): string {
  if (w in WEAPONS) return w;
  byName ??= new Map(Object.entries(WEAPONS).map(([id, d]) => [d.name, id]));
  return byName.get(w) ?? w;
}

/** The kill effect someone has on a weapon (its own, else their effect for every gun). */
export function kfxFor(w: Worn | undefined, weapon: string): string | undefined {
  if (!w?.kfx) return undefined;
  return w.kfx[weaponIdOf(weapon)] ?? w.kfx['*'];
}

/** The skin / charm someone has on a weapon. */
export function gunWorn(w: Worn | undefined, weapon: WeaponId | string): { skin?: string; charm?: string } {
  const id = weaponIdOf(weapon);
  return { ...(w?.skin?.[id] ? { skin: w.skin[id] } : {}), ...(w?.charm?.[id] ? { charm: w.charm[id] } : {}) };
}

/** Which vehicle skin family a vehicle kind belongs to (none for fixed weapons). */
export function vehicleClassOf(kind: string): VehicleClass | null {
  if (['tank', 'spg', 'td', 'apc', 'rocket'].includes(kind)) return 'armor';
  if (['jeep', 'bike', 'boat', 'lcvp'].includes(kind)) return 'car';
  if (['fighter', 'cas'].includes(kind) || kind.startsWith('cv') && kind.length > 2) return 'air';
  if (['dd', 'cv', 'bb', 'ss', 'patrol'].includes(kind)) return 'ship';
  return null;
}
