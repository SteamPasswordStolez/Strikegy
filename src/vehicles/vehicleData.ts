/**
 * Vehicles (design: docs/design/m4c-classes-economy.md §8-1). Pure data and
 * the spawn rules, no Three / Rapier.
 *
 * - Jeep: 2 seats (driver, MG gunner), from a pad at each base.
 * - APC: 4 seats (driver, autocannon gunner, 2 passengers), from a pad at
 *   each base, at most 6 on the map (3 a side).
 * - Motorbike: 1 seat, a few around each zone.
 * - Tanks (picked on the deploy screen, ceil(bots / 8) a side, all kinds
 *   together): medium tank, self-propelled gun, tank destroyer. Four seats:
 *   the driver also works the main gun, a roof MG, a hull MG, one inside.
 *
 * Base pads: a new one appears 10 s after the last drove off, but never
 * sooner than 1 min after the last one appeared there.
 */

import type { DamageKind } from '@/combat/Hitboxes';

export type VehicleKind = 'jeep' | 'apc' | 'bike' | 'tank' | 'spg' | 'td' | 'rocket';
export type SeatRole = 'driver' | 'gunner' | 'passenger';
export type VehicleGunId = 'mg' | 'autocannon' | 'tankgun' | 'howitzer' | 'atgun' | 'rockets';
/** Tank kinds (one limit for all of them). */
export const TANK_KINDS: readonly VehicleKind[] = ['tank', 'spg', 'td'];

export type { DamageKind };

export interface SeatSpec {
  role: SeatRole;
  /** Eye position in the vehicle's frame (x right, y up, z back; m). */
  eye: readonly [number, number, number];
  /** Sitting out in the open (can be shot); armoured seats can't. */
  exposed: boolean;
  /** Mounted gun this seat works. */
  gun?: VehicleGunId;
  /** How far the gun turns either way from straight ahead (rad; default all round), and its pitch range. */
  traverse?: number;
  pitch?: readonly [number, number];
}

export interface WheelSpec {
  /** Hub in the vehicle frame (m). */
  pos: readonly [number, number, number];
  steer: boolean;
  drive: boolean;
}

export interface VehicleSpec {
  kind: VehicleKind;
  seats: readonly SeatSpec[];
  /** Chassis box half extents (m). */
  half: readonly [number, number, number];
  mass: number;
  wheels: readonly WheelSpec[];
  wheelRadius: number;
  suspension: { rest: number; travel: number; stiffness: number; damping: number };
  /** Engine force per driven wheel (N), brake per wheel, max steering angle (rad). */
  engine: number;
  brake: number;
  steer: number;
  /** Top speed forward / in reverse (m/s). */
  top: number;
  reverse: number;
  /** Side grip (Rapier side friction stiffness) and tyre grip. */
  grip: number;
  friction: number;
  health: number;
  /** Damage taken per point of damage, by kind. */
  mult: Record<DamageKind, number>;
  /** Tracks: steers by turning on the spot (rad/s) instead of steering wheels. */
  turnRate?: number;
}

export const VEHICLES: Record<VehicleKind, VehicleSpec> = {
  jeep: {
    kind: 'jeep',
    seats: [
      { role: 'driver', eye: [-0.4, 1.25, 0.15], exposed: true },
      { role: 'gunner', eye: [0, 1.95, 1.1], exposed: true, gun: 'mg' },
    ],
    half: [0.92, 0.42, 2.05],
    mass: 1600,
    wheels: [
      { pos: [-0.86, -0.12, -1.35], steer: true, drive: true },
      { pos: [0.86, -0.12, -1.35], steer: true, drive: true },
      { pos: [-0.86, -0.12, 1.3], steer: false, drive: true },
      { pos: [0.86, -0.12, 1.3], steer: false, drive: true },
    ],
    wheelRadius: 0.42,
    suspension: { rest: 0.32, travel: 0.25, stiffness: 28, damping: 3.2 },
    engine: 2200,
    brake: 60,
    steer: 0.55,
    top: 24,
    reverse: 8,
    grip: 1.4,
    friction: 2.2,
    health: 420,
    mult: { bullet: 0.22, explosive: 1, at: 1.7 },
  },
  apc: {
    kind: 'apc',
    seats: [
      { role: 'driver', eye: [-0.55, 1.75, -1.6], exposed: false },
      { role: 'gunner', eye: [0, 2.6, 0.1], exposed: false, gun: 'autocannon' },
      { role: 'passenger', eye: [-0.5, 1.6, 1.6], exposed: false },
      { role: 'passenger', eye: [0.5, 1.6, 1.6], exposed: false },
    ],
    half: [1.35, 0.85, 3.2],
    mass: 13000,
    wheels: [
      { pos: [-1.3, -0.45, -2.1], steer: true, drive: true },
      { pos: [1.3, -0.45, -2.1], steer: true, drive: true },
      { pos: [-1.3, -0.45, 0], steer: false, drive: true },
      { pos: [1.3, -0.45, 0], steer: false, drive: true },
      { pos: [-1.3, -0.45, 2.1], steer: false, drive: true },
      { pos: [1.3, -0.45, 2.1], steer: false, drive: true },
    ],
    wheelRadius: 0.55,
    suspension: { rest: 0.35, travel: 0.3, stiffness: 30, damping: 4 },
    engine: 9500,
    brake: 400,
    steer: 0.45,
    top: 17,
    reverse: 6,
    grip: 1.6,
    friction: 2.4,
    health: 1100,
    mult: { bullet: 0, explosive: 0.45, at: 1.6 },
  },
  tank: {
    kind: 'tank',
    seats: [
      { role: 'driver', eye: [0.35, 2.55, 0.2], exposed: false, gun: 'tankgun', pitch: [-0.15, 0.35] },
      { role: 'gunner', eye: [-0.45, 3.15, 0.6], exposed: true, gun: 'mg' },
      { role: 'gunner', eye: [0.6, 1.55, -2.4], exposed: false, gun: 'mg', traverse: 0.45, pitch: [-0.2, 0.3] },
      { role: 'passenger', eye: [-0.5, 1.7, 1.6], exposed: false },
    ],
    half: [1.65, 0.75, 3.4],
    mass: 22000,
    wheels: [
      { pos: [-1.45, -0.35, -2.1], steer: false, drive: true },
      { pos: [1.45, -0.35, -2.1], steer: false, drive: true },
      { pos: [-1.45, -0.35, -0.7], steer: false, drive: true },
      { pos: [1.45, -0.35, -0.7], steer: false, drive: true },
      { pos: [-1.45, -0.35, 0.7], steer: false, drive: true },
      { pos: [1.45, -0.35, 0.7], steer: false, drive: true },
      { pos: [-1.45, -0.35, 2.1], steer: false, drive: true },
      { pos: [1.45, -0.35, 2.1], steer: false, drive: true },
    ],
    wheelRadius: 0.45,
    suspension: { rest: 0.3, travel: 0.25, stiffness: 32, damping: 4.5 },
    engine: 15000,
    brake: 900,
    steer: 0,
    top: 13,
    reverse: 5,
    grip: 2.2,
    friction: 2.6,
    health: 1200,
    mult: { bullet: 0, explosive: 0.3, at: 1 },
    turnRate: 0.75,
  },
  spg: {
    kind: 'spg',
    seats: [
      { role: 'driver', eye: [0, 2.85, 0.9], exposed: false, gun: 'howitzer', pitch: [-0.05, 0.95] },
      { role: 'gunner', eye: [-0.55, 3.1, 1.6], exposed: true, gun: 'mg' },
      { role: 'passenger', eye: [0.5, 1.7, 0.4], exposed: false },
      { role: 'passenger', eye: [-0.5, 1.7, 0.4], exposed: false },
    ],
    half: [1.6, 0.7, 3.3],
    mass: 19000,
    wheels: [
      { pos: [-1.4, -0.35, -2.1], steer: false, drive: true },
      { pos: [1.4, -0.35, -2.1], steer: false, drive: true },
      { pos: [-1.4, -0.35, -0.7], steer: false, drive: true },
      { pos: [1.4, -0.35, -0.7], steer: false, drive: true },
      { pos: [-1.4, -0.35, 0.7], steer: false, drive: true },
      { pos: [1.4, -0.35, 0.7], steer: false, drive: true },
      { pos: [-1.4, -0.35, 2.1], steer: false, drive: true },
      { pos: [1.4, -0.35, 2.1], steer: false, drive: true },
    ],
    wheelRadius: 0.45,
    suspension: { rest: 0.3, travel: 0.25, stiffness: 32, damping: 4.5 },
    engine: 12500,
    brake: 800,
    steer: 0,
    top: 11,
    reverse: 4,
    grip: 2.2,
    friction: 2.6,
    health: 900,
    mult: { bullet: 0, explosive: 0.4, at: 1 },
    turnRate: 0.7,
  },
  td: {
    kind: 'td',
    seats: [
      { role: 'driver', eye: [0.3, 2.3, -0.6], exposed: false, gun: 'atgun', traverse: 0.22, pitch: [-0.1, 0.25] },
      { role: 'gunner', eye: [-0.5, 2.85, 0.6], exposed: true, gun: 'mg' },
      { role: 'gunner', eye: [-0.6, 1.5, -2.5], exposed: false, gun: 'mg', traverse: 0.45, pitch: [-0.2, 0.3] },
      { role: 'passenger', eye: [0.5, 1.6, 1.6], exposed: false },
    ],
    half: [1.6, 0.68, 3.5],
    mass: 20000,
    wheels: [
      { pos: [-1.4, -0.35, -2.1], steer: false, drive: true },
      { pos: [1.4, -0.35, -2.1], steer: false, drive: true },
      { pos: [-1.4, -0.35, -0.7], steer: false, drive: true },
      { pos: [1.4, -0.35, -0.7], steer: false, drive: true },
      { pos: [-1.4, -0.35, 0.7], steer: false, drive: true },
      { pos: [1.4, -0.35, 0.7], steer: false, drive: true },
      { pos: [-1.4, -0.35, 2.1], steer: false, drive: true },
      { pos: [1.4, -0.35, 2.1], steer: false, drive: true },
    ],
    wheelRadius: 0.45,
    suspension: { rest: 0.3, travel: 0.25, stiffness: 32, damping: 4.5 },
    engine: 15000,
    brake: 900,
    steer: 0,
    top: 14,
    reverse: 5,
    grip: 2.2,
    friction: 2.6,
    health: 1300,
    mult: { bullet: 0, explosive: 0.3, at: 0.9 },
    turnRate: 0.7,
  },
  // Rocket launcher truck (a call-in): the squad leader drives and fires the salvo.
  rocket: {
    kind: 'rocket',
    seats: [
      { role: 'driver', eye: [-0.5, 2.15, -2.3], exposed: false, gun: 'rockets', pitch: [0.1, 1.1] },
      { role: 'gunner', eye: [0.5, 2.7, -1.6], exposed: true, gun: 'mg' },
    ],
    half: [1.25, 0.8, 3.6],
    mass: 9000,
    wheels: [
      { pos: [-1.15, -0.45, -2.5], steer: true, drive: true },
      { pos: [1.15, -0.45, -2.5], steer: true, drive: true },
      { pos: [-1.15, -0.45, 1.2], steer: false, drive: true },
      { pos: [1.15, -0.45, 1.2], steer: false, drive: true },
      { pos: [-1.15, -0.45, 2.6], steer: false, drive: true },
      { pos: [1.15, -0.45, 2.6], steer: false, drive: true },
    ],
    wheelRadius: 0.55,
    suspension: { rest: 0.35, travel: 0.3, stiffness: 30, damping: 4 },
    engine: 7500,
    brake: 300,
    steer: 0.45,
    top: 18,
    reverse: 6,
    grip: 1.6,
    friction: 2.4,
    health: 700,
    mult: { bullet: 0.08, explosive: 0.6, at: 1.4 },
  },
  bike: {
    kind: 'bike',
    seats: [{ role: 'driver', eye: [0, 1.6, 0.25], exposed: true }],
    half: [0.28, 0.35, 1.0],
    mass: 260,
    // Two pairs of narrow wheels (one pair per real wheel) keep it upright.
    wheels: [
      { pos: [-0.2, -0.05, -0.75], steer: true, drive: false },
      { pos: [0.2, -0.05, -0.75], steer: true, drive: false },
      { pos: [-0.2, -0.05, 0.72], steer: false, drive: true },
      { pos: [0.2, -0.05, 0.72], steer: false, drive: true },
    ],
    wheelRadius: 0.33,
    suspension: { rest: 0.25, travel: 0.2, stiffness: 30, damping: 3 },
    engine: 900,
    brake: 12,
    steer: 0.5,
    top: 27,
    reverse: 4,
    grip: 1.5,
    friction: 2.4,
    health: 160,
    mult: { bullet: 0.5, explosive: 1.2, at: 2 },
  },
};

/** A gun that fires a shell (flies and drops) instead of a hitscan round. */
export interface ShellSpec {
  /** Muzzle speed (m/s), drop (m/s²); `lob`: fired in an arc onto the point aimed at. */
  speed: number;
  gravity: number;
  lob?: boolean;
}

export interface VehicleGunSpec {
  /** Rounds a minute, damage per hit (people), spread (deg), range (m). */
  rpm: number;
  damage: number;
  spread: number;
  range: number;
  /** Damage to vehicles per hit (armour piercing for the cannon). */
  vsVehicle: number;
  /** Explosive rounds: blast radius (m), 0 for bullets. */
  blast: number;
  /** Rounds before it has to cool off, and the cool-off (s). */
  burst: number;
  cool: number;
  /** Shell guns: how it flies; a direct hit kills people outright. */
  shell?: ShellSpec;
}

export const VEHICLE_GUNS: Record<VehicleGunId, VehicleGunSpec> = {
  // Heavy machine gun on the jeep.
  mg: { rpm: 550, damage: 34, spread: 0.7, range: 320, vsVehicle: 9, blast: 0, burst: 60, cool: 3 },
  // 30 mm autocannon on the APC: slow, explosive, hurts light vehicles.
  autocannon: { rpm: 200, damage: 70, spread: 0.35, range: 400, vsVehicle: 40, blast: 2.2, burst: 20, cool: 3.5 },
  // Medium tank main gun: a shell every 4 s, kills on a direct hit, 4 hits wreck a tank.
  tankgun: { rpm: 15, damage: 999, spread: 0.12, range: 700, vsVehicle: 380, blast: 5, burst: 1, cool: 4, shell: { speed: 320, gravity: 4 } },
  // Self-propelled gun: lobs a heavy shell onto the point aimed at, slow to load.
  howitzer: { rpm: 9, damage: 999, spread: 0.3, range: 900, vsVehicle: 300, blast: 10, burst: 1, cool: 6.5, shell: { speed: 120, gravity: 9.8, lob: true } },
  // Tank destroyer: a fast, hard-hitting gun with little traverse.
  atgun: { rpm: 17, damage: 999, spread: 0.08, range: 800, vsVehicle: 520, blast: 3, burst: 1, cool: 3.5, shell: { speed: 480, gravity: 3 } },
  // Rocket tank launcher: a salvo of 12 lobbed onto the aim point, then 20 s to reload.
  rockets: { rpm: 400, damage: 999, spread: 1.6, range: 900, vsVehicle: 200, blast: 7, burst: 12, cool: 20, shell: { speed: 90, gravity: 9.8, lob: true } },
};

/** Base pads: seconds after a vehicle leaves before the next, the least time between two, how far it has to go to count as gone. */
export const PADS = { afterLeave: 10, cooldown: 60, leaveDistance: 12 };

/**
 * Most of a kind one side can have out, from the number of bots in the match
 * (owner, 2026-10-02): APCs one per 4 bots, tanks and jets one per 8, rounded
 * up (24 bots: 6 APCs, 3 tanks, 3 jets a side). Jeeps: 4 a side.
 */
export function vehicleLimit(kind: VehicleKind, bots: number): number {
  if (kind === 'apc') return Math.ceil(bots / 4);
  if (kind === 'jeep') return 4;
  if (TANK_KINDS.includes(kind)) return Math.ceil(bots / 8);
  return 0;
}
/** Motorbikes: per zone, seconds to bring a lost one back, and how long one can sit unused away from its zone. */
export const BIKES = { perZone: 1, respawn: 45, abandon: 90, abandonDistance: 40 };
/** Running someone over: speed (m/s) above which it kills, and the reach around the hull (m). */
export const ROADKILL = { speed: 5.5, pad: 0.45 };
/** Entering: how close to the hull the player has to be (m). */
export const ENTER_REACH = 2.2;

export interface PadState {
  kind: VehicleKind;
  /** Vehicle standing on the pad, or null. */
  vehicle: number | null;
  /** When the last one drove off (or was lost), and when the last one appeared. */
  leftAt: number;
  spawnedAt: number;
}

/**
 * Should the pad bring out a new vehicle now? Empty pad, 10 s after the last
 * left, a minute since the last appeared, and under the side's limit (`vehicleLimit`).
 */
export function padReady(p: PadState, time: number, outOnSide: number, limit: number): boolean {
  if (p.vehicle !== null) return false;
  if (outOnSide >= limit) return false;
  return time >= p.leftAt + PADS.afterLeave && time >= p.spawnedAt + PADS.cooldown;
}

/** Damage a vehicle takes from `amount` of `kind`. */
export function vehicleDamage(kind: VehicleKind, amount: number, dmg: DamageKind): number {
  return amount * VEHICLES[kind].mult[dmg];
}

/** Engine force to apply for throttle -1..1 at the current forward speed: none past the top speed. */
export function engineForce(spec: VehicleSpec, throttle: number, forwardSpeed: number): number {
  if (throttle > 0) return forwardSpeed >= spec.top ? 0 : spec.engine * throttle;
  if (throttle < 0) return -forwardSpeed >= spec.reverse ? 0 : spec.engine * 0.6 * throttle;
  return 0;
}
