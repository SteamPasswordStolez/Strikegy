import type { WeaponController } from '@/weapons/WeaponController';
import type { WeaponId } from '@/weapons/weaponData';
import { GunGameRules } from './matchRules';

/** What gun game's step `level` carries: its gun, or on the last step the last pistol, empty (only the butt kills). */
export function gunGameKit(level: number): { weapon: WeaponId; empty: boolean } {
  const w = GunGameRules.weaponAt(level);
  return { weapon: w ?? 'pistol2', empty: !w };
}

/** Last soldier standing: the pistol, and the primary from a crate once found (full ammo with each crate). */
export function armLoot(weapons: WeaponController, primary: string | null): void {
  weapons.setLoadout(primary ? [primary as WeaponId, 'pistol1'] : ['pistol1'], false);
}

/** Puts step `level`'s gun in a person's hands, nothing else (endless reserve: no hunting for ammo). */
export function armForLevel(weapons: WeaponController, level: number): void {
  const k = gunGameKit(level);
  weapons.setLoadout([k.weapon], true);
  if (k.empty) {
    const s = weapons.state;
    s.ammo = 0;
    s.reserve = 0;
  }
}
