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
  /**
   * Aim kick per shot in degrees; `first` multiplies the first shot of a spray,
   * `drift` leans the spray sideways (-1 left .. 1 right, a share of `side`;
   * each gun's own, so its pattern can be learnt).
   */
  recoil: { up: number; side: number; first: number; drift?: number };
  /** What a shot looks like in first person (it never moves the aim; see `ShotKick`). */
  kick: ShotKick;
  /** Extra spread (degrees) added per shot while firing continuously. */
  bloomPerShot: number;
  /** Absolute vertical FOV while aiming, relative to a 78° base. */
  adsFov: number;
  adsTime: number;
  /** Out of a sprint the gun comes up before it fires or aims (s; gunplay audit, 2026-10-18). */
  sprintOut: number;
  /** Taking the gun out (s). */
  drawTime: number;
  scope?: '3x' | '4x' | '6x' | '8x';
  /** Damage steps by distance (overrides the class's `FALLOFF`). */
  falloff?: readonly DamageStep[];
  /** Integrally suppressed: heard over a much shorter distance. */
  suppressed?: boolean;
}

/**
 * The visible recoil of one shot (gunplay audit, 2026-10-18: every gun used to
 * kick the same). The hands shove the gun back (`back`, m), its muzzle rises
 * (`rise`, rad) and twists (`roll`, rad, either way), the camera takes a punch
 * (`punch`, rad, up with a little roll); all of it settles at `settle` (1/s).
 * Only the look moves: where the round goes is `recoil` and the spread.
 */
export interface ShotKick {
  back: number;
  rise: number;
  roll: number;
  punch: number;
  settle: number;
}

type Base = Pick<WeaponDef, 'spreadHip' | 'spreadAds' | 'recoil' | 'kick' | 'bloomPerShot' | 'adsTime' | 'sprintOut' | 'drawTime' | 'reloadStyle'>;

/*
 * Per-class defaults; individual weapons override what they need.
 * Aiming down the sights sends rounds where the sight is (Modern Warfare
 * style, owner 2026-10-18): `spreadAds` is 0 except for the shotguns' pellet
 * cone, and the bloom works on hip fire only. What makes a spray hard is the
 * recoil one sees and pulls against.
 */
const CLASS_BASE: Record<WeaponClass, Base> = {
  ar: { spreadHip: 1.7, spreadAds: 0, recoil: { up: 0.5, side: 0.22, first: 1.35 }, kick: { back: 0.032, rise: 0.05, roll: 0.025, punch: 0.0045, settle: 16 }, bloomPerShot: 0.28, adsTime: 0.24, sprintOut: 0.2, drawTime: 0.4, reloadStyle: 'mag' },
  smg: { spreadHip: 1.4, spreadAds: 0, recoil: { up: 0.36, side: 0.28, first: 1.1 }, kick: { back: 0.022, rise: 0.034, roll: 0.022, punch: 0.003, settle: 20 }, bloomPerShot: 0.2, adsTime: 0.19, sprintOut: 0.15, drawTime: 0.3, reloadStyle: 'mag' },
  lmg: { spreadHip: 2.4, spreadAds: 0, recoil: { up: 0.48, side: 0.3, first: 1.5 }, kick: { back: 0.036, rise: 0.05, roll: 0.03, punch: 0.0055, settle: 14 }, bloomPerShot: 0.3, adsTime: 0.38, sprintOut: 0.35, drawTime: 0.6, reloadStyle: 'mag' },
  sg: { spreadHip: 6.5, spreadAds: 4.5, recoil: { up: 3.2, side: 0.7, first: 1 }, kick: { back: 0.085, rise: 0.17, roll: 0.05, punch: 0.017, settle: 8 }, bloomPerShot: 0, adsTime: 0.23, sprintOut: 0.2, drawTime: 0.4, reloadStyle: 'perShell' },
  dmr: { spreadHip: 2.5, spreadAds: 0, recoil: { up: 1.4, side: 0.35, first: 1 }, kick: { back: 0.05, rise: 0.09, roll: 0.035, punch: 0.009, settle: 11 }, bloomPerShot: 0.6, adsTime: 0.28, sprintOut: 0.25, drawTime: 0.45, reloadStyle: 'mag' },
  sr: { spreadHip: 5.0, spreadAds: 0, recoil: { up: 3.5, side: 0.4, first: 1 }, kick: { back: 0.095, rise: 0.19, roll: 0.05, punch: 0.02, settle: 7 }, bloomPerShot: 0, adsTime: 0.42, sprintOut: 0.38, drawTime: 0.55, reloadStyle: 'perShell' },
  pistol: { spreadHip: 1.2, spreadAds: 0, recoil: { up: 1.0, side: 0.3, first: 1 }, kick: { back: 0.03, rise: 0.12, roll: 0.03, punch: 0.004, settle: 14 }, bloomPerShot: 0.35, adsTime: 0.15, sprintOut: 0.11, drawTime: 0.25, reloadStyle: 'mag' },
};

/*
 * Bots don't aim down a sight the way a person does: their rounds keep the old
 * aimed cone (per class) on top of their own aim error, so making the player's
 * sights exact left the bots as dangerous as they were.
 */
export const BOT_ADS_SPREAD: Record<WeaponClass, number> = { ar: 0.25, smg: 0.45, lmg: 0.5, sg: 4.5, dmr: 0.08, sr: 0, pistol: 0.3 };

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
  ar1: def({ id: 'ar1', name: 'M4A1', class: 'ar', fireMode: 'auto', rpm: 780, range: 250, magSize: 30, reserve: 120, reloadTime: 2.35, damage: 25, headshotMult: 1.5, adsFov: 62, recoil: { up: 0.5, side: 0.22, first: 1.35, drift: -0.2 } }), // 4, all-rounder
  ar2: def({ id: 'ar2', name: 'AKM', class: 'ar', fireMode: 'auto', rpm: 620, range: 280, magSize: 25, reserve: 100, reloadTime: 2.6, damage: 31, headshotMult: 1.5, adsFov: 60, falloff: [[45, 1], [90, 0.85], [160, 0.75], [Infinity, 0.65]], recoil: { up: 0.66, side: 0.27, first: 1.4, drift: 0.45 }, kick: { back: 0.038, rise: 0.062, roll: 0.032, punch: 0.006, settle: 14 }, adsTime: 0.26 }), // 4, reaches farther, kicks harder
  ar3: def({ id: 'ar3', name: 'M16A4', class: 'ar', fireMode: 'burst', rpm: 380, burst: { count: 3, intervalMs: 75 }, range: 260, magSize: 30, reserve: 120, reloadTime: 2.5, damage: 34, headshotMult: 1.5, adsFov: 62, recoil: { up: 0.5, side: 0.22, first: 1.35, drift: 0.15 }, kick: { back: 0.034, rise: 0.055, roll: 0.022, punch: 0.005, settle: 15 } }), // 3: one burst
  ar4: def({ id: 'ar4', name: 'Mk 18', class: 'ar', fireMode: 'auto', rpm: 860, range: 200, magSize: 30, reserve: 120, reloadTime: 2.0, damage: 22, headshotMult: 1.5, adsFov: 63, falloff: [[35, 1], [70, 0.85], [130, 0.75], [Infinity, 0.65]], spreadHip: 1.45, adsTime: 0.22, recoil: { up: 0.44, side: 0.26, first: 1.3, drift: 0.3 }, kick: { back: 0.028, rise: 0.046, roll: 0.026, punch: 0.004, settle: 18 } }), // 5, short carbine, quick in hand

  // Submachine guns: close quarters.
  smg1: def({ id: 'smg1', name: 'MP7', class: 'smg', fireMode: 'auto', rpm: 1000, range: 150, magSize: 32, reserve: 128, reloadTime: 2.0, damage: 18, headshotMult: 1.5, adsFov: 64, recoil: { up: 0.36, side: 0.28, first: 1.1, drift: 0.35 }, kick: { back: 0.018, rise: 0.028, roll: 0.02, punch: 0.0025, settle: 22 }, adsTime: 0.18 }), // 6, fastest trigger
  smg2: def({ id: 'smg2', name: 'PP-19 Vityaz', class: 'smg', fireMode: 'auto', rpm: 880, range: 170, magSize: 30, reserve: 120, reloadTime: 2.1, damage: 21, headshotMult: 1.5, adsFov: 64, recoil: { up: 0.36, side: 0.28, first: 1.1, drift: -0.25 } }), // 5, balanced
  smg3: def({ id: 'smg3', name: 'MP5SD', class: 'smg', fireMode: 'auto', rpm: 800, range: 150, magSize: 30, reserve: 120, reloadTime: 2.3, damage: 20, headshotMult: 1.5, adsFov: 64, suppressed: true, recoil: { up: 0.36, side: 0.28, first: 1.1, drift: 0.1 }, kick: { back: 0.02, rise: 0.03, roll: 0.018, punch: 0.0025, settle: 20 } }), // 5, suppressed
  smg4: def({ id: 'smg4', name: 'UMP45', class: 'smg', fireMode: 'auto', rpm: 640, range: 190, magSize: 25, reserve: 100, reloadTime: 2.4, damage: 27, headshotMult: 1.5, adsFov: 64, falloff: [[25, 1], [50, 0.75], [Infinity, 0.6]], recoil: { up: 0.46, side: 0.3, first: 1.15, drift: -0.4 }, kick: { back: 0.028, rise: 0.044, roll: 0.026, punch: 0.004, settle: 17 }, adsTime: 0.2 }), // 4, slow and heavy

  // Light machine guns: sustained fire.
  lmg1: def({ id: 'lmg1', name: 'M249', class: 'lmg', fireMode: 'auto', rpm: 700, range: 260, magSize: 100, reserve: 200, reloadTime: 5.0, damage: 24, headshotMult: 1.5, adsFov: 60, recoil: { up: 0.48, side: 0.3, first: 1.5, drift: 0.3 } }), // 5, 100-round belt
  lmg2: def({ id: 'lmg2', name: 'M60E4', class: 'lmg', fireMode: 'auto', rpm: 560, range: 300, magSize: 60, reserve: 180, reloadTime: 3.8, damage: 30, headshotMult: 1.5, adsFov: 58, recoil: { up: 0.58, side: 0.32, first: 1.5, drift: -0.35 }, kick: { back: 0.044, rise: 0.064, roll: 0.034, punch: 0.0075, settle: 12 }, adsTime: 0.4 }), // 4, heavy calibre
  lmg3: def({ id: 'lmg3', name: 'RPK-74', class: 'lmg', fireMode: 'auto', rpm: 760, range: 250, magSize: 45, reserve: 180, reloadTime: 2.8, damage: 25, headshotMult: 1.5, adsFov: 61, spreadHip: 2.0, adsTime: 0.33, recoil: { up: 0.48, side: 0.3, first: 1.5, drift: 0.45 } }), // 4, magazine-fed, handles like a rifle

  // Shotguns.
  sg1: def({ id: 'sg1', name: 'M590', class: 'sg', fireMode: 'pump', rpm: 90, cycleMs: 650, range: 90, magSize: 8, reserve: 32, reloadTime: 2.25, insertMs: 450, damage: 12, pellets: 10, headshotMult: 1.25, adsFov: 70 }), // pump, wide
  sg2: def({ id: 'sg2', name: 'M870', class: 'sg', fireMode: 'pump', rpm: 80, cycleMs: 720, range: 100, magSize: 7, reserve: 28, reloadTime: 2.25, insertMs: 450, damage: 15, pellets: 8, headshotMult: 1.25, spreadHip: 5.2, spreadAds: 3.6, adsFov: 70 }), // pump, tight choke
  sg3: def({ id: 'sg3', name: 'M1014', class: 'sg', fireMode: 'semi', rpm: 220, range: 75, magSize: 6, reserve: 30, reloadTime: 2.25, insertMs: 400, damage: 10, pellets: 9, headshotMult: 1.25, recoil: { up: 2.6, side: 0.8, first: 1 }, kick: { back: 0.07, rise: 0.13, roll: 0.045, punch: 0.013, settle: 10 }, adsFov: 70 }), // semi-auto, needs two shots

  // Designated marksman rifles.
  dmr1: def({ id: 'dmr1', name: 'Mk 12 SPR', class: 'dmr', fireMode: 'semi', rpm: 360, range: 320, magSize: 20, reserve: 80, reloadTime: 2.7, damage: 45, headshotMult: 1.75, adsFov: 58, kick: { back: 0.042, rise: 0.075, roll: 0.03, punch: 0.0075, settle: 13 } }), // 3, red dot
  dmr2: def({ id: 'dmr2', name: 'M110', class: 'dmr', fireMode: 'semi', rpm: 300, range: 360, magSize: 20, reserve: 80, reloadTime: 2.9, damage: 52, headshotMult: 1.75, adsFov: 45, scope: '3x', adsTime: 0.3 }), // 2 + chip, 3x
  dmr3: def({ id: 'dmr3', name: 'SVD', class: 'dmr', fireMode: 'semi', rpm: 220, range: 400, magSize: 10, reserve: 50, reloadTime: 3.1, damage: 64, headshotMult: 1.75, adsFov: 38, scope: '4x', recoil: { up: 2.1, side: 0.4, first: 1 }, kick: { back: 0.06, rise: 0.11, roll: 0.04, punch: 0.012, settle: 10 }, adsTime: 0.32 }), // 2, battle rifle

  // Sniper rifles (bolt action).
  sr1: def({ id: 'sr1', name: 'M24', class: 'sr', fireMode: 'bolt', rpm: 60, cycleMs: 900, range: 520, magSize: 5, reserve: 20, reloadTime: 3.2, insertMs: 720, damage: 85, headshotMult: 2.0, adsFov: 28, scope: '6x' }), // head: 1
  sr2: def({ id: 'sr2', name: 'L115A3', class: 'sr', fireMode: 'bolt', rpm: 50, cycleMs: 1100, range: 600, magSize: 5, reserve: 20, reloadTime: 3.6, insertMs: 760, damage: 105, headshotMult: 2.0, adsFov: 20, scope: '8x', kick: { back: 0.11, rise: 0.22, roll: 0.055, punch: 0.024, settle: 6 }, adsTime: 0.43 }), // body 1 up close, 8x
  sr3: def({ id: 'sr3', name: 'SV-98', class: 'sr', fireMode: 'bolt', rpm: 85, cycleMs: 600, range: 420, magSize: 6, reserve: 24, reloadTime: 2.9, insertMs: 620, damage: 72, headshotMult: 2.0, adsFov: 34, scope: '4x', adsTime: 0.38, kick: { back: 0.085, rise: 0.17, roll: 0.045, punch: 0.017, settle: 8 } }), // straight pull, fast follow-ups

  // Sidearms.
  pistol1: def({ id: 'pistol1', name: 'M9', class: 'pistol', fireMode: 'semi', rpm: 420, range: 120, magSize: 15, reserve: 60, reloadTime: 1.55, damage: 34, headshotMult: 1.5, adsFov: 68 }), // 3
  pistol2: def({ id: 'pistol2', name: 'M1911', class: 'pistol', fireMode: 'semi', rpm: 300, range: 130, magSize: 8, reserve: 40, reloadTime: 1.8, damage: 50, headshotMult: 1.5, adsFov: 67, recoil: { up: 1.8, side: 0.4, first: 1 }, kick: { back: 0.04, rise: 0.17, roll: 0.04, punch: 0.006, settle: 11 } }), // 2, heavy
  pistol3: def({ id: 'pistol3', name: 'APS', class: 'pistol', fireMode: 'auto', rpm: 950, range: 90, magSize: 20, reserve: 80, reloadTime: 1.9, damage: 17, headshotMult: 1.5, adsFov: 68, bloomPerShot: 0.3, recoil: { up: 1.0, side: 0.3, first: 1, drift: 0.5 }, kick: { back: 0.022, rise: 0.07, roll: 0.03, punch: 0.003, settle: 18 } }), // 6, machine pistol
} satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;

/** Up to `to` metres a round does `mult` of its damage (the last step runs on). */
export type DamageStep = readonly [to: number, mult: number];

/*
 * Damage by distance in steps, Modern Warfare style (gunplay audit, owner
 * 2026-10-18): each kind of gun has its distance. Submachine guns and pistols
 * lose a quarter past ~20 m, rifles and machine guns step down past 40-45 m,
 * marksman and sniper rifles keep their damage. Close range (the time to
 * kill) is as before. Shotguns keep the even fade over their range.
 */
export const FALLOFF: Record<WeaponClass, readonly DamageStep[] | null> = {
  smg: [
    [20, 1],
    [45, 0.75],
    [Infinity, 0.6],
  ],
  pistol: [
    [20, 1],
    [40, 0.8],
    [Infinity, 0.65],
  ],
  ar: [
    [40, 1],
    [80, 0.85],
    [150, 0.75],
    [Infinity, 0.65],
  ],
  lmg: [
    [45, 1],
    [90, 0.85],
    [160, 0.75],
    [Infinity, 0.65],
  ],
  dmr: [[Infinity, 1]],
  sr: [[Infinity, 1]],
  sg: null,
};

/** A round's damage at `distance` (before the body part). */
export function damageAtDistance(w: WeaponDef, distance: number): number {
  const steps = w.falloff ?? FALLOFF[w.class];
  if (steps) {
    for (const [to, mult] of steps) if (distance <= to) return w.damage * mult;
    return w.damage * steps[steps.length - 1]![1];
  }
  // Shotgun pellets: even fade to 60 % between 40 % and all of the range.
  const start = w.range * 0.4;
  if (distance <= start) return w.damage;
  const t = Math.min(1, (distance - start) / (w.range - start));
  return w.damage * (1 - 0.4 * t);
}
