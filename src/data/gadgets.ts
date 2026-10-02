/**
 * Class gadgets (M4-C step 5): numbers and who carries what. Pure data.
 *
 * - Assault: panzerfaust, a shoulder-fired rocket (direct hit kills, 4 m
 *   blast, knocks down fortifications).
 * - Medic: rifle smoke grenade, fired off the muzzle in a lob (~40 m).
 * - Recon: spawn beacon (the squad can deploy on it) or AP mines (picked on
 *   the deploy screen).
 * - Support has the ammo box instead (handed out with E), no gadget on 4.
 */
import type { ClassId, ReconGadget } from './classes';

export type GadgetId = 'panzerfaust' | 'riflesmoke' | ReconGadget;

export interface GadgetSpec {
  id: GadgetId;
  /** Carried per life (and restocked to at an ammo station). */
  count: number;
  /** Seconds before the next use (panzerfaust: the full reload, see `PANZERFAUST_TOSS`; placing). */
  cycle: number;
}

export const GADGETS: Record<GadgetId, GadgetSpec> = {
  panzerfaust: { id: 'panzerfaust', count: 2, cycle: 3.0 },
  riflesmoke: { id: 'riflesmoke', count: 2, cycle: 0.9 },
  beacon: { id: 'beacon', count: 1, cycle: 0.8 },
  mine: { id: 'mine', count: 2, cycle: 0.7 },
};

/** The gadget a class carries (null: support, whose ammo box is handed out with E). */
export function classGadget(cls: ClassId, reconGadget: ReconGadget): GadgetId | null {
  if (cls === 'assault') return 'panzerfaust';
  if (cls === 'medic') return 'riflesmoke';
  if (cls === 'recon') return reconGadget;
  return null;
}

/**
 * Panzerfaust reload (3 s, `cycle`): spent tube dropped by 0.9 s, the next
 * one shouldered by 1.9 s, sight up by 2.2 s, lever cocked by 2.7 s. After
 * the last shot only the drop happens.
 */
export const PANZERFAUST_TOSS = 0.9;
/** Panzerfaust rocket: muzzle speed (m/s) and a light drop (m/s²). */
export const ROCKET = { speed: 60, gravity: 3, life: 4, directDamage: 250 };
/** Rifle smoke grenade: lobbed at ~45° to land ~40 m out. */
export const RIFLE_SMOKE = { speed: 22, gravity: 9.8, life: 6, loft: 0.5 };
/** Spawn beacon: squad deploys left, and how much shooting breaks it. */
export const BEACON = { uses: 5, health: 60 };
/**
 * AP mine: an enemy within `radius` sets it off after `delay` s; walking
 * crouched over it doesn't. Each recon keeps at most `perOwner` down.
 */
export const MINE = { radius: 1.5, delay: 0.3, perOwner: 2, health: 1 };
/** Placing a beacon or a mine: how far ahead it can go (m). */
export const PLACE_REACH = 2.6;
