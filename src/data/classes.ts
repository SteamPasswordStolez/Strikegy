import { WEAPONS, type WeaponClass, type WeaponDef, type WeaponId } from '@/weapons/weaponData';
import type { GrenadeType } from '@/combat/explosions';

/**
 * Classes (M4-C, designed with the owner: docs/design/m4c-classes-economy.md).
 * Everyone can revive and build; each class adds its own weapons, kit and
 * passives. Numbers marked [제안] in the design doc live here.
 */
export type ClassId = 'assault' | 'medic' | 'support' | 'recon';
export const CLASS_IDS: readonly ClassId[] = ['assault', 'medic', 'support', 'recon'];

export type ReconGadget = 'beacon' | 'mine';

export interface ClassDef {
  id: ClassId;
  /** Weapon classes allowed in the two primary slots. */
  primaries: readonly WeaponClass[];
  /** Revive hold time (s) and the health the revived soldier gets back. */
  reviveTime: number;
  reviveHealth: number;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  assault: { id: 'assault', primaries: ['ar', 'smg', 'sg', 'lmg', 'dmr', 'sr'], reviveTime: 5, reviveHealth: 30 },
  medic: { id: 'medic', primaries: ['ar', 'smg', 'dmr', 'sr'], reviveTime: 1.5, reviveHealth: 100 },
  support: { id: 'support', primaries: ['ar', 'lmg'], reviveTime: 5, reviveHealth: 30 },
  recon: { id: 'recon', primaries: ['dmr', 'sr'], reviveTime: 5, reviveHealth: 30 },
};

/** Movement bonus (sprint, walk, crouch-walk): assault always, support with a machine gun in hand. */
export const SPEED_BONUS = 1.08;
/** Assault: wading costs half as much speed (stands in for swimming until maps have deep water). */
export const ASSAULT_WADE_EASE = 0.5;
/** Recon: scoped weapons zoom this much further (toggle with the wheel while aiming). */
export const RECON_ZOOM = 1.5;

export function moveBonus(cls: ClassId, held: WeaponDef): number {
  if (cls === 'assault') return SPEED_BONUS;
  if (cls === 'support' && held.class === 'lmg') return SPEED_BONUS;
  return 1;
}

/** Vertical FOV (deg) of a scope zoomed `zoom` times further than `adsFov`. */
export function zoomedFov(adsFov: number, zoom: number): number {
  const half = (adsFov * Math.PI) / 360;
  return (Math.atan(Math.tan(half) / zoom) * 360) / Math.PI;
}

/** Scope label after the recon bonus ('6x' -> '9x'). */
export function zoomedLabel(scope: string, zoom: number): string {
  const n = Number.parseFloat(scope) * zoom;
  return `${Number.isInteger(n) ? n : n.toFixed(1)}x`;
}

export const MEDKIT = {
  /** Kit carried by every class but the medic (who has an endless supply on a cooldown). */
  carried: 1,
  medicCooldown: 15,
  /** A medic hands the same soldier a kit at most this often. */
  giveCooldown: 30,
  /** Weapon lowered while using one; health fills over `healTime`. */
  useTime: 0.6,
  healTime: 1,
} as const;

export const AMMO_GIVE_COOLDOWN = 20;
/** Reach for handing out kits and reviving (m). */
export const GIVE_RANGE = 4;
export const REVIVE_RANGE = 1.8;

export const DOWN = {
  /** Down until bled out. */
  bleedOut: 15,
  /** Hold to give up while down. */
  giveUpHold: 1,
  /** Can't be hurt this long after being revived. */
  reviveShield: 1,
} as const;

/** One grenade type per life, chosen on the deploy screen. */
export const GRENADE_COUNT: Record<GrenadeType, number> = { frag: 2, flash: 2, smoke: 2 };
export const GRENADE_TYPES: readonly GrenadeType[] = ['frag', 'flash', 'smoke'];

export interface Loadout {
  cls: ClassId;
  primary: [WeaponId, WeaponId];
  pistol: WeaponId;
  grenade: GrenadeType;
  /** Recon's pick (the other classes have one fixed gadget). */
  reconGadget: ReconGadget;
}

const ALL = Object.keys(WEAPONS) as WeaponId[];

/** Primary weapons a class can pick, in lineup order. */
export function primariesFor(cls: ClassId): WeaponId[] {
  const allowed = CLASSES[cls].primaries;
  return ALL.filter((id) => allowed.includes(WEAPONS[id].class));
}

export const PISTOLS: readonly WeaponId[] = ALL.filter((id) => WEAPONS[id].class === 'pistol');

const DEFAULT_PRIMARY: Record<ClassId, [WeaponId, WeaponId]> = {
  assault: ['ar1', 'smg2'],
  medic: ['smg2', 'ar4'],
  support: ['lmg1', 'ar1'],
  recon: ['sr1', 'dmr1'],
};

export function defaultLoadout(cls: ClassId): Loadout {
  return { cls, primary: [...DEFAULT_PRIMARY[cls]], pistol: 'pistol1', grenade: 'frag', reconGadget: 'beacon' };
}

/** Repairs a stored or edited loadout: weapons the class may use, two different primaries, known grenade. */
export function sanitizeLoadout(l: Partial<Loadout> & { cls: ClassId }): Loadout {
  const d = defaultLoadout(l.cls);
  const ok = primariesFor(l.cls);
  const a = l.primary?.[0] && ok.includes(l.primary[0]) ? l.primary[0] : d.primary[0];
  let b = l.primary?.[1] && ok.includes(l.primary[1]) ? l.primary[1] : d.primary[1];
  if (b === a) b = ok.find((id) => id !== a) ?? a;
  return {
    cls: l.cls,
    primary: [a, b],
    pistol: l.pistol && PISTOLS.includes(l.pistol) ? l.pistol : d.pistol,
    grenade: l.grenade && GRENADE_TYPES.includes(l.grenade) ? l.grenade : d.grenade,
    reconGadget: l.reconGadget === 'mine' ? 'mine' : 'beacon',
  };
}

/** The weapons carried, in slot order (keys 1, 2, 3). */
export function loadoutWeapons(l: Loadout): WeaponId[] {
  return [l.primary[0], l.primary[1], l.pistol];
}

/** 0..1 ratings for the loadout picker's bars. */
export function weaponStats(w: WeaponDef): { damage: number; rate: number; range: number; handling: number } {
  const perShot = w.damage * (w.pellets ?? 1);
  const interval = Math.max(60 / w.rpm, (w.cycleMs ?? 0) / 1000);
  // Bursts: rpm is the pace of trigger pulls, each firing `count` rounds.
  const rate = w.burst ? (w.rpm / 60) * w.burst.count : 1 / interval;
  const handling = 1 - (w.adsTime - 0.12) / 0.2 - (w.reloadTime - 1.5) / 8;
  const clamp = (v: number) => Math.max(0.04, Math.min(1, v));
  return {
    damage: clamp(perShot / 110),
    rate: clamp(rate / 17),
    range: clamp(w.range / 600),
    handling: clamp(handling),
  };
}
