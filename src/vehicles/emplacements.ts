import type { VehicleGunSpec, VehicleSpec } from './vehicleData';

/**
 * Fixed weapons at the zones (owner, 2026-10-24: "like Battlefield V: a fixed
 * machine gun and field guns at set places, with things to build round
 * them", then an AA gun too): a heavy machine gun on a tripod, a field gun
 * that lays itself onto what the view is on (straight at what is near, an arc
 * onto what is far, like a warship's guns) and a 40 mm AA gun. They are
 * vehicles that never move (`fixed`: a fixed body standing on the ground,
 * origin at the ground under the gun): one seat, walk up and E, anyone's.
 * Planned per zone with the fortifications (fortify.ts `POSTS`); a wrecked one
 * leaves a blueprint built back in build mode (FortKind `hmgPost` / `gunPost` / `aaPost`).
 */

export type EmplacementKind = 'hmg' | 'fieldgun' | 'aagun';

export const EMPLACEMENT_GUNS: Record<'hmgpost' | 'fieldgun', VehicleGunSpec> = {
  // Tripod heavy machine gun: steadier and longer bursts than the jeep's pintle gun.
  hmgpost: { rpm: 600, damage: 34, spread: 0.4, range: 450, vsVehicle: 9, blast: 0, burst: 90, cool: 3 },
  // Field gun: a shell every 5 s, laid onto the point aimed at (low arc), out to 1.5 km.
  fieldgun: { rpm: 12, damage: 999, spread: 0.18, range: 1500, vsVehicle: 380, blast: 5, burst: 1, cool: 5, shell: { speed: 260, gravity: 9.8 } },
};

const FIXED = {
  fixed: true,
  mass: 0,
  wheels: [],
  wheelRadius: 0,
  suspension: { rest: 0, travel: 0, stiffness: 0, damping: 0 },
  engine: 0,
  brake: 0,
  steer: 0,
  top: 0,
  reverse: 0,
  grip: 0,
  friction: 0,
} as const;

/**
 * `half`: the solid box (shield, tripod and gun), standing on the ground at
 * the origin. Bullets hardly scratch them (the crew behind them can be shot),
 * a rocket or two, a tank shell or a few grenades wreck them.
 */
export const EMPLACEMENT_SPECS: Record<EmplacementKind, VehicleSpec> = {
  hmg: {
    kind: 'hmg',
    ...FIXED,
    // Fires over the sandbags of the nest round it (0.95 m) from a tripod 1.2 m up.
    seats: [{ role: 'gunner', eye: [0, 1.55, 0.72], exposed: true, gun: 'hmgpost', traverse: 1.0, pitch: [-0.3, 0.5], view: 'open' }],
    half: [0.32, 0.62, 0.5],
    health: 450,
    mult: { bullet: 0.04, heavy: 0.25, explosive: 1.6, at: 1.6 },
  },
  fieldgun: {
    kind: 'fieldgun',
    ...FIXED,
    // The gun layer beside the breech, behind the shield; the sight zooms. Slow to traverse on its split trail.
    seats: [{ role: 'gunner', eye: [-0.5, 1.45, 0.55], exposed: true, gun: 'fieldgun', traverse: 0.5, pitch: [-0.08, 0.78], turn: 0.5, elevate: 0.35, lay: true, view: 'sight' }],
    half: [1.0, 0.68, 0.42],
    health: 700,
    mult: { bullet: 0.03, heavy: 0.2, explosive: 1.3, at: 1.3 },
  },
  aagun: {
    kind: 'aagun',
    ...FIXED,
    // On the mount over the pivot, all round and up to the zenith; aimed by the view, the shells drop a little.
    seats: [{ role: 'gunner', eye: [0, 1.85, 0.3], exposed: true, gun: 'aa40', pitch: [-0.05, 1.45], lay: true, view: 'open' }],
    half: [0.7, 0.75, 0.7],
    health: 600,
    mult: { bullet: 0.04, heavy: 0.25, explosive: 1.4, at: 1.4 },
  },
};

export function isEmplacement(kind: string): kind is EmplacementKind {
  return kind === 'hmg' || kind === 'fieldgun' || kind === 'aagun';
}
