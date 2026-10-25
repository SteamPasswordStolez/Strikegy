/**
 * Attachments, Modern Warfare style (progression plan step 4; progression.md
 * 3-4, progression-data.md A): five slots — optic, muzzle, under, magazine,
 * laser — one attachment each or none. An attachment only multiplies numbers
 * the weapon already has (aiming time, out-of-sprint time, recoil, the
 * visible kick, hip spread, damage-step distances, magazine size, reload) and
 * adds a few flags (suppressed, flash, louder, laser, bipod). Damage, the
 * headshot multiplier and the rate of fire are never touched, so a gun's time
 * to kill is the same however it is built.
 *
 * `withAttachments(def, set)` gives the weapon as fitted: the same id (sounds,
 * spray pattern, kill feed) with the multiplied numbers. Everything that
 * fires a gun — the player's controller, bots, the game server — uses that.
 *
 * Each attachment opens at a weapon level (1-20, `attachLevels`). What a gun
 * carries with nothing fitted (`LOOKS` in gunModels.ts, `optics.ts`) is its
 * default kit: looks only, no effect. Import-light: the server uses it.
 */
import { opticFor } from './optics';
import { FALLOFF, WEAPONS, type AttachSet, type AttachSlot, type DamageStep, type WeaponClass, type WeaponDef } from './weaponData';

export type { AttachSet, AttachSlot } from './weaponData';

export const ATTACH_SLOTS: readonly AttachSlot[] = ['optic', 'muzzle', 'under', 'mag', 'laser'];

/** What one attachment multiplies (1 = unchanged) and the flags it adds. */
export interface AttachEffect {
  ads?: number;
  sprintOut?: number;
  up?: number;
  side?: number;
  hip?: number;
  /** Shotgun pellet cone (`spreadAds`). */
  pellets?: number;
  /** Damage-step distances. */
  falloff?: number;
  mag?: number;
  reload?: number;
  /** Shell-by-shell inserts only. */
  insert?: number;
  /** Optics: how many times it magnifies (1 = a 1x sight). */
  zoom?: number;
  /** A magnified scope seen full screen (breath hold, sway). */
  scope?: boolean;
  suppressed?: boolean;
  flash?: 'none' | 'small';
  hear?: number;
  laser?: 'hip' | 'tac';
  bipod?: boolean;
  /** Sight look (1x sights: the model and its reticle). */
  sight?: 'reddot' | 'reflex' | 'holo' | 'kobra' | 'prism' | 'pdot';
}

export interface AttachDef {
  id: string;
  slot: AttachSlot;
  /** Weapon kinds it fits. */
  fits: readonly WeaponClass[];
  effect: AttachEffect;
  /** Only these weapons (the M1014's drum, the pumps' shell holder). */
  only?: (def: WeaponDef) => boolean;
}

const pumpOrBolt = (d: WeaponDef) => d.fireMode === 'pump' || d.fireMode === 'bolt';

/** Every attachment (progression-data.md A's table). */
export const ATTACHMENTS: readonly AttachDef[] = [
  // Optics. The 1x sights only change the reticle (taste).
  { id: 'reddot', slot: 'optic', fits: ['ar', 'smg', 'lmg', 'sg', 'dmr'], effect: { zoom: 1, sight: 'reddot' } },
  { id: 'reflex', slot: 'optic', fits: ['ar', 'smg', 'lmg', 'sg', 'dmr'], effect: { zoom: 1, sight: 'reflex' } },
  { id: 'holo', slot: 'optic', fits: ['ar', 'smg', 'lmg', 'sg', 'dmr'], effect: { zoom: 1, sight: 'holo' } },
  { id: 'kobra', slot: 'optic', fits: ['ar', 'smg', 'lmg', 'sg', 'dmr'], effect: { zoom: 1, sight: 'kobra' } },
  { id: 'pdot', slot: 'optic', fits: ['pistol'], effect: { zoom: 1, sight: 'pdot' } },
  { id: 'prism25', slot: 'optic', fits: ['ar', 'lmg', 'dmr'], effect: { zoom: 2.5, ads: 1.08, sight: 'prism' } },
  { id: 'scope4', slot: 'optic', fits: ['ar', 'lmg', 'dmr'], effect: { zoom: 4, ads: 1.15, scope: true } },
  { id: 'scope8', slot: 'optic', fits: ['dmr', 'sr'], effect: { zoom: 8, ads: 1.1, scope: true } },
  { id: 'scope12', slot: 'optic', fits: ['sr'], effect: { zoom: 12, ads: 1.18, scope: true } },
  { id: 'cqscope', slot: 'optic', fits: ['sr'], effect: { zoom: 1.5, ads: 0.85, sight: 'prism' } },
  // Muzzle.
  { id: 'suppressor', slot: 'muzzle', fits: ['ar', 'smg', 'lmg', 'dmr', 'sr', 'pistol'], effect: { suppressed: true, flash: 'none', ads: 1.05, falloff: 0.9 } },
  { id: 'brake', slot: 'muzzle', fits: ['ar', 'smg', 'lmg', 'dmr', 'sr'], effect: { up: 0.9, hear: 1.3, ads: 1.04 } },
  { id: 'flashhider', slot: 'muzzle', fits: ['ar', 'smg', 'lmg', 'dmr'], effect: { flash: 'small', side: 0.95 } },
  { id: 'comp', slot: 'muzzle', fits: ['ar', 'smg', 'lmg', 'pistol'], effect: { side: 0.88, up: 1.04 } },
  { id: 'choke', slot: 'muzzle', fits: ['sg'], effect: { pellets: 0.8, hip: 1.1 } },
  // Under the barrel.
  { id: 'vgrip', slot: 'under', fits: ['ar', 'smg', 'lmg', 'sg', 'dmr'], effect: { up: 0.92, ads: 1.04 } },
  { id: 'agrip', slot: 'under', fits: ['ar', 'smg', 'lmg', 'sg', 'dmr'], effect: { ads: 0.94, up: 1.04 } },
  { id: 'sgrip', slot: 'under', fits: ['ar', 'smg', 'sg'], effect: { hip: 0.85, side: 1.05 } },
  { id: 'bipod', slot: 'under', fits: ['lmg', 'dmr', 'sr'], effect: { bipod: true, ads: 1.06, sprintOut: 1.08 } },
  // Magazine.
  { id: 'extmag', slot: 'mag', fits: ['ar', 'smg', 'dmr', 'pistol'], effect: { mag: 1.5, reload: 1.12, ads: 1.06 } },
  { id: 'fastmag', slot: 'mag', fits: ['ar', 'smg', 'lmg', 'dmr', 'sr', 'pistol'], effect: { reload: 0.85, insert: 0.85 } },
  { id: 'drum', slot: 'mag', fits: ['lmg', 'sg'], effect: { mag: 1.5, reload: 1.2, insert: 1.2, sprintOut: 1.1 }, only: (d) => d.class !== 'sg' || d.id === 'sg3' },
  { id: 'shellholder', slot: 'mag', fits: ['sg', 'sr'], effect: { insert: 0.8 }, only: pumpOrBolt },
  // Laser.
  { id: 'laser', slot: 'laser', fits: ['ar', 'smg', 'lmg', 'sg', 'pistol'], effect: { hip: 0.8, laser: 'hip' } },
  { id: 'taclaser', slot: 'laser', fits: ['ar', 'smg', 'lmg', 'sg', 'dmr', 'pistol'], effect: { sprintOut: 0.88, laser: 'tac' } },
];

const BY_ID = new Map(ATTACHMENTS.map((a) => [a.id, a]));

export function attachDef(id: string): AttachDef | undefined {
  return BY_ID.get(id);
}

/** Limits on everything fitted together (progression-data.md A). */
export const ATTACH_LIMITS = {
  ads: [0.8, 1.2],
  sprintOut: [0.8, 1.2],
  recoil: [0.75, 1.25],
  hip: [0.7, 1.3],
} as const;

/** Fits this weapon (its kind, its own rule; an integrally suppressed gun has no muzzle slot). */
export function fits(def: WeaponDef, a: AttachDef): boolean {
  if (!a.fits.includes(def.class)) return false;
  if (a.only && !a.only(def)) return false;
  if (a.slot === 'muzzle' && WEAPONS[def.id as keyof typeof WEAPONS]?.suppressed) return false;
  return true;
}

/** The attachments a weapon can take, slot by slot. */
export function attachmentsFor(def: WeaponDef): AttachDef[] {
  return ATTACHMENTS.filter((a) => fits(def, a) && !isDefaultSight(def, a));
}

/** A 1x sight the gun already carries as its default look is no choice at all. */
function isDefaultSight(def: WeaponDef, a: AttachDef): boolean {
  if (a.slot !== 'optic' || a.effect.zoom !== 1 || !a.effect.sight) return false;
  const base = WEAPONS[def.id as keyof typeof WEAPONS] ?? def;
  return !base.scope && opticFor(base).model === a.effect.sight;
}

// ---------------------------------------------------------------------------
// The weapon as fitted.

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** The vertical FOV of a sight that magnifies `zoom` times (1x: the gun's own 1x FOV). */
export function zoomFov(zoom: number, oneX: number): number {
  if (zoom <= 1) return oneX;
  // The lineup's scopes: 3x 45, 4x 38, 6x 28, 8x 20; past that a little closer.
  const table: [number, number][] = [
    [1, oneX],
    [1.5, 52],
    [2.5, 47],
    [3, 45],
    [4, 38],
    [6, 28],
    [8, 20],
    [12, 13],
  ];
  for (let i = 1; i < table.length; i++) {
    const [z1, f1] = table[i]!;
    if (zoom <= z1) {
      const [z0, f0] = table[i - 1]!;
      return f0 + ((f1 - f0) * (zoom - z0)) / (z1 - z0);
    }
  }
  return 13;
}

/** A 1x sight's FOV for this kind of gun (what a scoped gun gets when its scope comes off). */
const ONE_X: Record<WeaponClass, number> = { ar: 62, smg: 64, lmg: 60, sg: 70, dmr: 58, sr: 55, pistol: 68 };

const SCOPE_LABEL: Record<number, WeaponDef['scope']> = { 4: '4x', 8: '8x', 12: '12x' };

/**
 * The weapon with `set` fitted: unknown ids and ones that don't fit are left
 * out, the multipliers are taken together and held to `ATTACH_LIMITS`.
 */
export function withAttachments(base: WeaponDef, set: AttachSet | undefined): WeaponDef {
  const fitted = cleanSet(base, set);
  const slots = Object.values(fitted);
  if (!slots.length) return base;
  let ads = 1;
  let sprintOut = 1;
  let up = 1;
  let side = 1;
  let hip = 1;
  let pellets = 1;
  let falloff = 1;
  let mag = 1;
  let reload = 1;
  let insert = 1;
  const d: WeaponDef = { ...base, attach: fitted };
  for (const id of slots) {
    const e = BY_ID.get(id!)!.effect;
    ads *= e.ads ?? 1;
    sprintOut *= e.sprintOut ?? 1;
    up *= e.up ?? 1;
    side *= e.side ?? 1;
    hip *= e.hip ?? 1;
    pellets *= e.pellets ?? 1;
    falloff *= e.falloff ?? 1;
    mag *= e.mag ?? 1;
    reload *= e.reload ?? 1;
    insert *= e.insert ?? 1;
    if (e.suppressed) d.suppressed = true;
    if (e.flash) d.flash = e.flash;
    if (e.hear) d.hearMult = e.hear;
    if (e.laser) d.laser = e.laser;
    if (e.bipod) d.bipod = true;
    if (e.zoom !== undefined) {
      // A new sight: its magnification replaces the gun's own.
      d.adsFov = zoomFov(e.zoom, base.scope ? ONE_X[base.class] : base.adsFov);
      if (e.scope) d.scope = SCOPE_LABEL[e.zoom] ?? '4x';
      else delete d.scope;
    }
  }
  ads = clamp(ads, ATTACH_LIMITS.ads);
  sprintOut = clamp(sprintOut, ATTACH_LIMITS.sprintOut);
  up = clamp(up, ATTACH_LIMITS.recoil);
  side = clamp(side, ATTACH_LIMITS.recoil);
  hip = clamp(hip, ATTACH_LIMITS.hip);
  d.adsTime = base.adsTime * ads;
  d.sprintOut = base.sprintOut * sprintOut;
  d.recoil = { ...base.recoil, up: base.recoil.up * up, side: base.recoil.side * side };
  // The visible kick follows the recoil it shows.
  d.kick = { ...base.kick, rise: base.kick.rise * up, punch: base.kick.punch * up, roll: base.kick.roll * side };
  d.spreadHip = base.spreadHip * hip;
  if (base.class === 'sg') d.spreadAds = base.spreadAds * pellets;
  if (falloff !== 1) {
    const steps = base.falloff ?? FALLOFF[base.class];
    if (steps) d.falloff = steps.map(([to, m]): DamageStep => [to === Infinity ? to : to * falloff, m]);
    else d.range = base.range * falloff;
  }
  if (mag !== 1) d.magSize = Math.floor(base.magSize * mag);
  d.reloadTime = base.reloadTime * reload;
  if (base.insertMs !== undefined) d.insertMs = base.insertMs * insert;
  return d;
}

/** Only known attachments that fit, one a slot (in the right slot). */
export function cleanSet(def: WeaponDef, raw: unknown, owned?: (id: string) => boolean): AttachSet {
  const out: AttachSet = {};
  if (typeof raw !== 'object' || !raw) return out;
  for (const slot of ATTACH_SLOTS) {
    const id = (raw as Record<string, unknown>)[slot];
    if (typeof id !== 'string') continue;
    const a = BY_ID.get(id);
    if (!a || a.slot !== slot || !fits(def, a) || isDefaultSight(def, a)) continue;
    if (owned && !owned(id)) continue;
    out[slot] = id;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weapon levels: what opens when (progression-data.md A's order).

/** Per level, the attachments to try in order; `opt1`..`opt3` are the 1x sights the gun doesn't carry. */
const ORDER: [number, string[]][] = [
  [2, ['opt1']],
  [3, ['vgrip', 'bipod', 'fastmag', 'shellholder']],
  [4, ['fastmag', 'shellholder']],
  [5, ['flashhider', 'choke']],
  [7, ['agrip']],
  [8, ['laser']],
  [9, ['opt2']],
  [10, ['comp', 'brake']],
  [11, ['extmag', 'drum']],
  [12, ['prism25', 'cqscope']],
  [13, ['sgrip', 'bipod']],
  [14, ['taclaser']],
  [15, ['brake', 'comp', 'flashhider']],
  [16, ['opt3']],
  [17, ['scope4', 'scope8']],
  [18, ['*']],
  [19, ['suppressor']],
  [20, ['scope12', 'scope8', '*']],
];

const levelCache = new Map<string, Map<string, number>>();

/** Attachment id -> the weapon level that opens it, for one weapon. */
export function attachLevels(def: WeaponDef): Map<string, number> {
  const hit = levelCache.get(def.id);
  if (hit) return hit;
  const all = attachmentsFor(WEAPONS[def.id as keyof typeof WEAPONS] ?? def);
  const sights = all.filter((a) => a.slot === 'optic' && a.effect.zoom === 1).map((a) => a.id);
  const left = new Set(all.map((a) => a.id));
  const out = new Map<string, number>();
  const give = (id: string, level: number) => {
    if (!left.has(id)) return false;
    left.delete(id);
    out.set(id, level);
    return true;
  };
  for (const [level, wants] of ORDER) {
    for (const w of wants) {
      if (w === '*') {
        // What is still closed: magazines and the rest at 18, anything left at 20 (never the suppressor or top scope early).
        for (const id of [...left]) if (level === 20 || (id !== 'suppressor' && id !== 'scope12' && id !== 'scope8')) give(id, level);
        break;
      }
      const id = /^opt\d$/.test(w) ? sights.find((s) => left.has(s)) : w;
      if (id && give(id, level)) break;
    }
  }
  levelCache.set(def.id, out);
  return out;
}

/** The weapon level an attachment needs on this weapon (Infinity: it doesn't fit). */
export function attachLevel(def: WeaponDef, id: string): number {
  return attachLevels(def).get(id) ?? Infinity;
}

/** The attachments a weapon level opens (the notice). */
export function attachOpenedAt(def: WeaponDef, level: number): string[] {
  return [...attachLevels(def)].filter(([, l]) => l === level).map(([id]) => id);
}

/** How far a shot from this gun is heard (bots; m): suppressed close by only, a muzzle brake farther. */
export function shotHeard(def: WeaponDef): number {
  return def.suppressed ? 22 : 70 * (def.hearMult ?? 1);
}

/** A key for a gun as fitted (model caches: the same gun with other attachments is another model). */
export function gunKey(def: WeaponDef): string {
  const a = def.attach;
  const camo = def.camo ? `#${def.camo}` : '';
  if (!a) return def.id + camo;
  return `${def.id}|${ATTACH_SLOTS.map((s) => a[s] ?? '').join(',')}${camo}`;
}
