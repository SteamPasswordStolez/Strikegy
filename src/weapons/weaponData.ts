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
  scope?: '3x' | '4x' | '6x' | '8x';
  /** Integrally suppressed: heard over a much shorter distance. */
  suppressed?: boolean;
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

/*
 * The lineup (2026-09-29 remake). Every class has distinct picks instead of
 * near-copies: an all-rounder, a hard hitter, a fast-handling option and a
 * specialist. Bodies take 100 damage; the comments give bullets to kill up close.
 * Shotgun damage is per pellet. Names are military designations where one
 * exists (no maker brands); the numbers are game balance, not real ballistics.
 */
export const WEAPONS = {
  // Assault rifles: the mid-range backbone.
  ar1: def({ id: 'ar1', name: 'M4A1', class: 'ar', fireMode: 'auto', rpm: 780, range: 250, magSize: 30, reserve: 120, reloadTime: 2.35, damage: 25, headshotMult: 1.5, adsFov: 62 }), // 4, all-rounder
  ar2: def({ id: 'ar2', name: 'AKM', class: 'ar', fireMode: 'auto', rpm: 620, range: 280, magSize: 25, reserve: 100, reloadTime: 2.6, damage: 31, headshotMult: 1.5, adsFov: 60, recoil: { up: 0.66, side: 0.27, first: 1.4 }, adsTime: 0.21 }), // 4, reaches farther, kicks harder
  ar3: def({ id: 'ar3', name: 'M16A4', class: 'ar', fireMode: 'burst', rpm: 380, burst: { count: 3, intervalMs: 75 }, range: 260, magSize: 30, reserve: 120, reloadTime: 2.5, damage: 34, headshotMult: 1.5, adsFov: 62 }), // 3: one burst
  ar4: def({ id: 'ar4', name: 'Mk 18', class: 'ar', fireMode: 'auto', rpm: 860, range: 200, magSize: 30, reserve: 120, reloadTime: 2.0, damage: 22, headshotMult: 1.5, adsFov: 63, spreadHip: 1.45, adsTime: 0.16, recoil: { up: 0.44, side: 0.26, first: 1.3 } }), // 5, short carbine, quick in hand

  // Submachine guns: close quarters.
  smg1: def({ id: 'smg1', name: 'MP7', class: 'smg', fireMode: 'auto', rpm: 1000, range: 150, magSize: 32, reserve: 128, reloadTime: 2.0, damage: 18, headshotMult: 1.5, adsFov: 64 }), // 6, fastest trigger
  smg2: def({ id: 'smg2', name: 'PP-19 Vityaz', class: 'smg', fireMode: 'auto', rpm: 880, range: 170, magSize: 30, reserve: 120, reloadTime: 2.1, damage: 21, headshotMult: 1.5, adsFov: 64 }), // 5, balanced
  smg3: def({ id: 'smg3', name: 'MP5SD', class: 'smg', fireMode: 'auto', rpm: 800, range: 150, magSize: 30, reserve: 120, reloadTime: 2.3, damage: 20, headshotMult: 1.5, adsFov: 64, suppressed: true }), // 5, suppressed
  smg4: def({ id: 'smg4', name: 'UMP45', class: 'smg', fireMode: 'auto', rpm: 640, range: 190, magSize: 25, reserve: 100, reloadTime: 2.4, damage: 27, headshotMult: 1.5, adsFov: 64, recoil: { up: 0.46, side: 0.3, first: 1.15 } }), // 4, slow and heavy

  // Light machine guns: sustained fire.
  lmg1: def({ id: 'lmg1', name: 'M249', class: 'lmg', fireMode: 'auto', rpm: 700, range: 260, magSize: 100, reserve: 200, reloadTime: 5.0, damage: 24, headshotMult: 1.5, adsFov: 60 }), // 5, 100-round belt
  lmg2: def({ id: 'lmg2', name: 'M60E4', class: 'lmg', fireMode: 'auto', rpm: 560, range: 300, magSize: 60, reserve: 180, reloadTime: 3.8, damage: 30, headshotMult: 1.5, adsFov: 58, recoil: { up: 0.58, side: 0.32, first: 1.5 } }), // 4, heavy calibre
  lmg3: def({ id: 'lmg3', name: 'RPK-74', class: 'lmg', fireMode: 'auto', rpm: 760, range: 250, magSize: 45, reserve: 180, reloadTime: 2.8, damage: 25, headshotMult: 1.5, adsFov: 61, spreadHip: 2.0, adsTime: 0.22 }), // 4, magazine-fed, handles like a rifle

  // Shotguns.
  sg1: def({ id: 'sg1', name: 'M590', class: 'sg', fireMode: 'pump', rpm: 90, cycleMs: 650, range: 90, magSize: 8, reserve: 32, reloadTime: 2.25, insertMs: 450, damage: 12, pellets: 10, headshotMult: 1.25, adsFov: 70 }), // pump, wide
  sg2: def({ id: 'sg2', name: 'M870', class: 'sg', fireMode: 'pump', rpm: 80, cycleMs: 720, range: 100, magSize: 7, reserve: 28, reloadTime: 2.25, insertMs: 450, damage: 15, pellets: 8, headshotMult: 1.25, spreadHip: 5.2, spreadAds: 3.6, adsFov: 70 }), // pump, tight choke
  sg3: def({ id: 'sg3', name: 'M1014', class: 'sg', fireMode: 'semi', rpm: 220, range: 75, magSize: 6, reserve: 30, reloadTime: 2.25, insertMs: 400, damage: 10, pellets: 9, headshotMult: 1.25, recoil: { up: 2.6, side: 0.8, first: 1 }, adsFov: 70 }), // semi-auto, needs two shots

  // Designated marksman rifles.
  dmr1: def({ id: 'dmr1', name: 'Mk 12 SPR', class: 'dmr', fireMode: 'semi', rpm: 360, range: 320, magSize: 20, reserve: 80, reloadTime: 2.7, damage: 45, headshotMult: 1.75, adsFov: 58 }), // 3, red dot
  dmr2: def({ id: 'dmr2', name: 'M110', class: 'dmr', fireMode: 'semi', rpm: 300, range: 360, magSize: 20, reserve: 80, reloadTime: 2.9, damage: 52, headshotMult: 1.75, adsFov: 45, scope: '3x' }), // 2 + chip, 3x
  dmr3: def({ id: 'dmr3', name: 'SVD', class: 'dmr', fireMode: 'semi', rpm: 220, range: 400, magSize: 10, reserve: 50, reloadTime: 3.1, damage: 64, headshotMult: 1.75, adsFov: 38, scope: '4x', recoil: { up: 2.1, side: 0.4, first: 1 }, adsTime: 0.26 }), // 2, battle rifle

  // Sniper rifles (bolt action).
  sr1: def({ id: 'sr1', name: 'M24', class: 'sr', fireMode: 'bolt', rpm: 60, cycleMs: 900, range: 520, magSize: 5, reserve: 20, reloadTime: 3.2, insertMs: 720, damage: 85, headshotMult: 2.0, adsFov: 28, scope: '6x' }), // head: 1
  sr2: def({ id: 'sr2', name: 'L115A3', class: 'sr', fireMode: 'bolt', rpm: 50, cycleMs: 1100, range: 600, magSize: 5, reserve: 20, reloadTime: 3.6, insertMs: 760, damage: 105, headshotMult: 2.0, adsFov: 20, scope: '8x' }), // body 1 up close, 8x
  sr3: def({ id: 'sr3', name: 'SV-98', class: 'sr', fireMode: 'bolt', rpm: 85, cycleMs: 600, range: 420, magSize: 6, reserve: 24, reloadTime: 2.9, insertMs: 620, damage: 72, headshotMult: 2.0, adsFov: 34, scope: '4x', adsTime: 0.25 }), // straight pull, fast follow-ups

  // Sidearms.
  pistol1: def({ id: 'pistol1', name: 'M9', class: 'pistol', fireMode: 'semi', rpm: 420, range: 120, magSize: 15, reserve: 60, reloadTime: 1.55, damage: 34, headshotMult: 1.5, adsFov: 68 }), // 3
  pistol2: def({ id: 'pistol2', name: 'M1911', class: 'pistol', fireMode: 'semi', rpm: 300, range: 130, magSize: 8, reserve: 40, reloadTime: 1.8, damage: 50, headshotMult: 1.5, adsFov: 67, recoil: { up: 1.8, side: 0.4, first: 1 } }), // 2, heavy
  pistol3: def({ id: 'pistol3', name: 'APS', class: 'pistol', fireMode: 'auto', rpm: 950, range: 90, magSize: 20, reserve: 80, reloadTime: 1.9, damage: 17, headshotMult: 1.5, adsFov: 68, bloomPerShot: 0.3 }), // 6, machine pistol
} satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;

/** Linear falloff to 60% damage between 40% and 100% of range. */
export function damageAtDistance(w: WeaponDef, distance: number): number {
  const start = w.range * 0.4;
  if (distance <= start) return w.damage;
  const t = Math.min(1, (distance - start) / (w.range - start));
  return w.damage * (1 - 0.4 * t);
}
