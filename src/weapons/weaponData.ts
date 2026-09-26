export type FireMode = 'auto' | 'semi' | 'burst' | 'pump' | 'bolt';
export type WeaponClass = 'ar' | 'smg' | 'lmg' | 'sg' | 'dmr' | 'sr' | 'pistol';
export type ReloadStyle = 'mag' | 'perShell';

export interface WeaponDef {
  id: string;
  name: string;
  class: WeaponClass;
  fireMode: FireMode;
  /** Rounds per minute (burst: rate inside a burst is burst.intervalMs). */
  rpm: number;
  /** Extra delay after a pump/bolt shot before the next one, in ms. */
  cycleMs?: number;
  burst?: { count: number; intervalMs: number };
  /** Max effective distance in meters; damage falls off towards it. */
  range: number;
  magSize: number;
  reserve: number;
  reloadStyle: ReloadStyle;
  /** Full reload time in seconds (mag style). */
  reloadTime: number;
  /** Per-round insert time in ms (perShell style). */
  insertMs?: number;
  damage: number;
  headshotMult: number;
  pellets?: number;
  /** Cone half-angle in degrees. */
  spreadHip: number;
  spreadAds: number;
  /** Camera kick per shot in degrees; `first` multiplies the first shot of a spray. */
  recoil: { up: number; side: number; first: number };
  /** Extra spread (degrees) added per shot while firing continuously. */
  bloomPerShot: number;
  /** Absolute vertical FOV while aiming, relative to a 78° base. */
  adsFov: number;
  adsTime: number;
  scope?: '3x' | '6x' | '8x';
}

type Base = Pick<WeaponDef, 'spreadHip' | 'spreadAds' | 'recoil' | 'bloomPerShot' | 'adsTime' | 'reloadStyle'>;

// Per-class defaults; individual weapons override what they need.
const CLASS_BASE: Record<WeaponClass, Base> = {
  ar: { spreadHip: 1.7, spreadAds: 0.25, recoil: { up: 0.5, side: 0.22, first: 1.35 }, bloomPerShot: 0.28, adsTime: 0.187, reloadStyle: 'mag' },
  smg: { spreadHip: 1.4, spreadAds: 0.45, recoil: { up: 0.36, side: 0.28, first: 1.1 }, bloomPerShot: 0.2, adsTime: 0.145, reloadStyle: 'mag' },
  lmg: { spreadHip: 2.4, spreadAds: 0.5, recoil: { up: 0.48, side: 0.3, first: 1.5 }, bloomPerShot: 0.3, adsTime: 0.272, reloadStyle: 'mag' },
  sg: { spreadHip: 6.5, spreadAds: 4.5, recoil: { up: 3.2, side: 0.7, first: 1 }, bloomPerShot: 0, adsTime: 0.187, reloadStyle: 'perShell' },
  dmr: { spreadHip: 2.5, spreadAds: 0.08, recoil: { up: 1.4, side: 0.35, first: 1 }, bloomPerShot: 0.6, adsTime: 0.23, reloadStyle: 'mag' },
  sr: { spreadHip: 5.0, spreadAds: 0.0, recoil: { up: 3.5, side: 0.4, first: 1 }, bloomPerShot: 0, adsTime: 0.297, reloadStyle: 'perShell' },
  pistol: { spreadHip: 1.2, spreadAds: 0.3, recoil: { up: 1.0, side: 0.3, first: 1 }, bloomPerShot: 0.35, adsTime: 0.128, reloadStyle: 'mag' },
};

function def(w: Omit<WeaponDef, keyof Base> & Partial<Base>): WeaponDef {
  return { ...CLASS_BASE[w.class], ...w };
}

// Initial balance numbers are carried over from Strikegy p1 (WeaponData.js, patch 7-1A/7-3C).
export const WEAPONS = {
  ar1: def({ id: 'ar1', name: 'AR-1 Ranger', class: 'ar', fireMode: 'auto', rpm: 780, range: 250, magSize: 30, reserve: 90, reloadTime: 2.35, damage: 28, headshotMult: 1.5, adsFov: 62 }),
  ar2: def({ id: 'ar2', name: 'AR-2 Viper', class: 'ar', fireMode: 'auto', rpm: 650, range: 250, magSize: 30, reserve: 90, reloadTime: 2.6, damage: 26, headshotMult: 1.5, adsFov: 62 }),
  ar3: def({ id: 'ar3', name: 'AR-3 Sentinel', class: 'ar', fireMode: 'burst', rpm: 380, burst: { count: 3, intervalMs: 80 }, range: 250, magSize: 30, reserve: 90, reloadTime: 2.5, damage: 30, headshotMult: 1.5, adsFov: 62 }),

  smg1: def({ id: 'smg1', name: 'SMG-1 Swift', class: 'smg', fireMode: 'auto', rpm: 980, range: 180, magSize: 30, reserve: 120, reloadTime: 2.0, damage: 20, headshotMult: 1.5, adsFov: 64 }),
  smg2: def({ id: 'smg2', name: 'SMG-2 Wasp', class: 'smg', fireMode: 'auto', rpm: 900, range: 180, magSize: 30, reserve: 120, reloadTime: 2.1, damage: 21, headshotMult: 1.5, adsFov: 64 }),
  smg3: def({ id: 'smg3', name: 'SMG-3 Phantom', class: 'smg', fireMode: 'auto', rpm: 820, range: 180, magSize: 30, reserve: 120, reloadTime: 2.3, damage: 19, headshotMult: 1.5, adsFov: 64 }),
  smg4: def({ id: 'smg4', name: 'SMG-4 Riot', class: 'smg', fireMode: 'auto', rpm: 760, range: 180, magSize: 30, reserve: 120, reloadTime: 2.45, damage: 22, headshotMult: 1.5, adsFov: 64 }),

  lmg1: def({ id: 'lmg1', name: 'LMG-1 Bulwark', class: 'lmg', fireMode: 'auto', rpm: 660, range: 260, magSize: 60, reserve: 120, reloadTime: 3.35, damage: 25, headshotMult: 1.5, adsFov: 60 }),
  lmg2: def({ id: 'lmg2', name: 'LMG-2 Hammer', class: 'lmg', fireMode: 'auto', rpm: 540, range: 260, magSize: 60, reserve: 120, reloadTime: 3.6, damage: 27, headshotMult: 1.5, adsFov: 60 }),

  // Shotgun damage is per pellet.
  sg1: def({ id: 'sg1', name: 'SG-1 Breaker', class: 'sg', fireMode: 'pump', rpm: 90, cycleMs: 650, range: 90, magSize: 8, reserve: 32, reloadTime: 2.25, insertMs: 450, damage: 12, pellets: 10, headshotMult: 1.25, adsFov: 70 }),
  sg2: def({ id: 'sg2', name: 'SG-2 Reaper', class: 'sg', fireMode: 'pump', rpm: 80, cycleMs: 720, range: 90, magSize: 8, reserve: 32, reloadTime: 2.25, insertMs: 450, damage: 15, pellets: 8, headshotMult: 1.25, spreadHip: 5.5, spreadAds: 4.0, adsFov: 70 }),

  dmr1: def({ id: 'dmr1', name: 'DMR-1 Marksman', class: 'dmr', fireMode: 'semi', rpm: 360, range: 320, magSize: 20, reserve: 60, reloadTime: 2.7, damage: 45, headshotMult: 1.75, adsFov: 58 }),
  dmr2: def({ id: 'dmr2', name: 'DMR-2 Longshot', class: 'dmr', fireMode: 'semi', rpm: 300, range: 320, magSize: 20, reserve: 60, reloadTime: 2.9, damage: 50, headshotMult: 1.75, adsFov: 45, scope: '3x' }),

  sr1: def({ id: 'sr1', name: 'SR-1 Pioneer', class: 'sr', fireMode: 'bolt', rpm: 60, cycleMs: 900, range: 520, magSize: 5, reserve: 15, reloadTime: 3.2, insertMs: 720, damage: 80, headshotMult: 2.0, adsFov: 28, scope: '6x' }),
  sr2: def({ id: 'sr2', name: 'SR-2 Valkyrie', class: 'sr', fireMode: 'bolt', rpm: 50, cycleMs: 1100, range: 520, magSize: 5, reserve: 15, reloadTime: 3.6, insertMs: 720, damage: 85, headshotMult: 2.0, adsFov: 20, scope: '8x' }),

  pistol1: def({ id: 'pistol1', name: 'Base Pistol', class: 'pistol', fireMode: 'semi', rpm: 420, range: 120, magSize: 15, reserve: 45, reloadTime: 1.55, damage: 34, headshotMult: 1.5, adsFov: 68 }),
  p2: def({ id: 'p2', name: 'Pistol Standard+', class: 'pistol', fireMode: 'semi', rpm: 450, range: 130, magSize: 15, reserve: 45, reloadTime: 1.5, damage: 34, headshotMult: 1.5, adsFov: 66 }),
  p3: def({ id: 'p3', name: 'Pistol Quickdraw', class: 'pistol', fireMode: 'semi', rpm: 480, range: 130, magSize: 15, reserve: 45, reloadTime: 1.45, damage: 28, headshotMult: 1.5, adsFov: 66 }),
  p4: def({ id: 'p4', name: 'Pistol Heavy', class: 'pistol', fireMode: 'semi', rpm: 320, range: 130, magSize: 12, reserve: 36, reloadTime: 1.75, damage: 45, headshotMult: 1.5, adsFov: 66 }),
  mp1: def({ id: 'mp1', name: 'Machine Pistol', class: 'pistol', fireMode: 'auto', rpm: 900, range: 110, magSize: 20, reserve: 60, reloadTime: 2.0, damage: 18, headshotMult: 1.5, adsFov: 66 }),
} satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;

/** Linear falloff to 60% damage between 40% and 100% of range. */
export function damageAtDistance(w: WeaponDef, distance: number): number {
  const start = w.range * 0.4;
  if (distance <= start) return w.damage;
  const t = Math.min(1, (distance - start) / (w.range - start));
  return w.damage * (1 - 0.4 * t);
}
