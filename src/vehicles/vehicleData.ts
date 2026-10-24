/**
 * Vehicles (design: docs/design/m4c-classes-economy.md §8-1). Pure data and
 * the spawn rules, no Three / Rapier.
 *
 * - Jeep: 2 seats (driver, MG gunner), from a pad at each base.
 * - APC: 4 seats (driver, autocannon gunner, 2 passengers), from a pad at
 *   each base, ceil(bots / 8) a side.
 * - Motorbike: 1 seat, a few around each zone.
 * - Jets (picked on the deploy screen, ceil(bots / 32) a side): fighter (1
 *   seat: cannon, heat-seeking missiles), close air support (2: cannon and
 *   rockets, rear gunner). They start in the air off their side of the map.
 * - Tanks (picked on the deploy screen, ceil(bots / 32) a side, all kinds
 *   together): medium tank, self-propelled gun, tank destroyer. Four seats:
 *   the driver also works the main gun, a roof MG, a hull MG, one inside.
 *
 * Base pads: a new one appears 10 s after the last drove off, but never
 * sooner than 1 min after the last one appeared there.
 */

import type { DamageKind } from '@/combat/Hitboxes';
import { BATTLESHIP, CARRIER, DESTROYER, NAVAL_GUNS, SUBMARINE } from './warships';
import { CARRIER_PLANE_SPECS, PLANE_GUNS, type CarrierPlaneKind } from './carrierPlanes';
import { EMPLACEMENT_GUNS, EMPLACEMENT_SPECS, type EmplacementKind } from './emplacements';

export type VehicleKind = 'jeep' | 'apc' | 'bike' | 'tank' | 'spg' | 'td' | 'rocket' | 'fighter' | 'cas' | 'boat' | 'lcvp' | 'patrol' | 'dd' | 'cv' | 'bb' | 'ss' | CarrierPlaneKind | EmplacementKind;
export type SeatRole = 'driver' | 'gunner' | 'passenger';
export type VehicleGunId = 'mg' | 'autocannon' | 'tankgun' | 'howitzer' | 'atgun' | 'rockets' | 'jetcannon' | 'gau' | 'aam' | 'jetrockets' | 'naval5in' | 'naval6in' | 'naval16in' | 'aa40' | 'torpedo' | 'depthcharge' | 'deckgun' | 'planeMg' | 'rearMg' | 'bomb' | 'airTorpedo' | 'airDepth' | 'planeRockets' | 'hmgpost' | 'fieldgun';
/** Tank kinds (one limit for all of them). */
export const TANK_KINDS: readonly VehicleKind[] = ['tank', 'spg', 'td'];
/** Jet kinds (one limit for all of them). */
export const JET_KINDS: readonly VehicleKind[] = ['fighter', 'cas'];

export type { DamageKind };

export interface SeatSpec {
  role: SeatRole;
  /** Eye position in the vehicle's frame (x right, y up, z back; m). */
  eye: readonly [number, number, number];
  /** Sitting out in the open (can be shot); armoured seats can't. */
  exposed: boolean;
  /** Mounted gun this seat works (trigger), and a second one (aim button: missiles, rockets). */
  gun?: VehicleGunId;
  alt?: VehicleGunId;
  /** How far the gun turns either way from straight ahead (rad; default all round), and its pitch range. */
  traverse?: number;
  pitch?: readonly [number, number];
  /**
   * How fast the gun turns (rad/s) and elevates (owner, 2026-10-12: the
   * driver's sight is fixed to the gun, which follows the view with a delay
   * and only as far as it can turn; 2026-10-14: about 1.5x faster, the first
   * rates made tanks too hard to handle). None: it points where the view does at once.
   */
  turn?: number;
  elevate?: number;
  /** Which way the gun faces on the hull when centred (rad, 0 = ahead; a ship's aft turret faces back, pi). */
  facing?: number;
  /**
   * A ship's station (2026-10-18, big maps plan step 5): what it is and where
   * on deck one stands to man it (walk up, E). Getting out puts you back there.
   */
  station?: { kind: StationKind; at: readonly [number, number, number] };
  /** The gun lays itself onto what the view is on, elevation for the range (warship guns do this anyway; field guns, AA). */
  lay?: boolean;
  /** First-person view in this seat when it isn't the usual one for its gun and cover (Game.rideViewKind). */
  view?: 'open' | 'sight' | 'mg';
}

/** What a warship's station does (plan section 3). */
export type StationKind = 'helm' | 'main' | 'secondary' | 'aa' | 'torpedo' | 'asw' | 'fire' | 'engine' | 'dc' | 'flight' | 'catapult' | 'periscope' | 'sonar' | 'deckgun';

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
  /** Aircraft: flies itself toward where the pilot looks (no wheels). */
  flight?: FlightSpec;
  /** Boats: float on the water (no wheels; see `Vehicle.sail`). */
  boat?: BoatSpec;
  /**
   * A deck people walk on while it moves (2026-10-18, big maps plan step 4):
   * solid parts on it besides the hull box (deckhouse, railings, gun mounts),
   * in the vehicle frame. Someone getting out of a seat steps onto the deck.
   */
  deck?: { parts: readonly { half: readonly [number, number, number]; pos: readonly [number, number, number] }[] };
  /** A warship (see warships.ts): damage control, flooding, fires, the helm's rules. */
  ship?: ShipSpec;
  /** A carrier plane (see carrierPlanes.ts): launched from a carrier's deck for `cost` RP. */
  plane?: { cost: number };
  /** Never moves (emplacements.ts): a fixed body, origin on the ground; `half` is its solid box above it. */
  fixed?: boolean;
}

/** What makes a vehicle a warship. */
export interface ShipSpec {
  /** Station kinds the helm may only work while a station of kind `needs` is manned (the battleship's guns and fire control). */
  stationsNeeded: readonly { kinds: readonly StationKind[]; needs: StationKind }[];
  /** A submarine: top speed dived, the helm's depths (m under the surface: surfaced, periscope, deep) and air dived (s). */
  sub?: { divedTop: number; depths: readonly number[]; oxygen: number };
}

/**
 * A boat (2026-10-18, big maps plan step 2): a dynamic hull held up by
 * floats against the sea's surface, pushed by a propeller and turned by a
 * rudder at the stern. Forces in N, points in the vehicle frame (z back).
 */
export interface BoatSpec {
  /** Points along the bottom of the hull where it floats (m). */
  floats: readonly (readonly [number, number, number])[];
  /** How deep the hull sits at rest (m): sets the float stiffness. */
  draft: number;
  /** Propeller push forward (N) and back (share of it), where it pushes (z, m). */
  thrust: number;
  reverse: number;
  stern: number;
  /** Turning: rudder torque per m/s of water past it (N m), and a little at a standstill (the propeller's wash). */
  rudder: number;
  /** Water drag per m/s: along the hull, across it (the keel), up and down (per float). */
  drag: readonly [number, number, number];
  /** Water resisting the hull turning (N m per rad/s): with `rudder` it sets how fast it turns. */
  yawDrag: number;
  /** Top speed afloat (m/s) when it differs from `top` (an amphibian is slower in the water). */
  waterTop?: number;
  /** People get out over the bow (a landing craft's ramp) rather than the sides. */
  bowExit?: boolean;
}

export interface FlightSpec {
  /** Stall and top speed (m/s), turn rate (rad/s), acceleration (m/s²). */
  minSpeed: number;
  maxSpeed: number;
  turn: number;
  accel: number;
  /** Wing hitbox: half sizes and centre along the body's z (the hull box alone missed every shot at the wings). */
  wings: { half: readonly [number, number, number]; z: number };
}

/**
 * Air space around the map: jets turn back `margin` metres past the edge of
 * the playable area, stay `outsideAlt` up while outside it (clear of the
 * scenery hills, which have no collision), and start at `startAlt`.
 */
export const AIRSPACE = { margin: 450, outsideAlt: 230, startAlt: 230 };

/** A 7.4 m assault boat: open, driver at the stern console, an MG on the bow, two aboard. */
const BOAT: VehicleSpec = {
  kind: 'boat',
  seats: [
    { role: 'driver', eye: [0.45, 1.55, 1.9], exposed: true },
    { role: 'gunner', eye: [0, 1.75, -2.3], exposed: true, gun: 'mg' },
    { role: 'passenger', eye: [-0.5, 1.25, 0.4], exposed: true },
    { role: 'passenger', eye: [0.5, 1.25, 0.4], exposed: true },
  ],
  half: [1.25, 0.5, 3.7],
  mass: 2400,
  wheels: [],
  wheelRadius: 0,
  suspension: { rest: 0, travel: 0, stiffness: 0, damping: 0 },
  engine: 0,
  brake: 0,
  steer: 0,
  top: 15,
  reverse: 4,
  grip: 0,
  friction: 0,
  health: 480,
  mult: { bullet: 0.25, heavy: 0.3, explosive: 1, at: 1.8 },
  boat: {
    floats: [
      [-1.0, -0.45, -2.6],
      [1.0, -0.45, -2.6],
      [-1.15, -0.45, -0.8],
      [1.15, -0.45, -0.8],
      [-1.15, -0.45, 1.0],
      [1.15, -0.45, 1.0],
      [-1.1, -0.45, 2.9],
      [1.1, -0.45, 2.9],
    ],
    draft: 0.32,
    thrust: 14000,
    reverse: 0.4,
    stern: 3.6,
    rudder: 650,
    drag: [160, 1700, 1100],
    yawDrag: 19000,
  },
};

/**
 * Landing craft (2026-10-18, Ashfall Isle): an 11 m open boat with a bow ramp,
 * the coxswain at the stern, an MG either side of him, six in the well. Slow
 * and steady; it runs up on the beach and everyone goes out over the ramp.
 */
const LCVP: VehicleSpec = {
  kind: 'lcvp',
  seats: [
    { role: 'driver', eye: [0, 2.35, 4.4], exposed: true },
    { role: 'gunner', eye: [-1.05, 2.45, 4.0], exposed: true, gun: 'mg' },
    { role: 'gunner', eye: [1.05, 2.45, 4.0], exposed: true, gun: 'mg' },
    { role: 'passenger', eye: [-0.7, 1.55, -2.4], exposed: true },
    { role: 'passenger', eye: [0.7, 1.55, -2.4], exposed: true },
    { role: 'passenger', eye: [-0.7, 1.55, -0.6], exposed: true },
    { role: 'passenger', eye: [0.7, 1.55, -0.6], exposed: true },
    { role: 'passenger', eye: [-0.7, 1.55, 1.2], exposed: true },
    { role: 'passenger', eye: [0.7, 1.55, 1.2], exposed: true },
  ],
  half: [1.6, 0.9, 5.4],
  mass: 9000,
  wheels: [],
  wheelRadius: 0,
  suspension: { rest: 0, travel: 0, stiffness: 0, damping: 0 },
  engine: 0,
  brake: 0,
  steer: 0,
  top: 9,
  reverse: 3,
  grip: 0,
  friction: 0,
  health: 900,
  mult: { bullet: 0.1, heavy: 0.3, explosive: 0.8, at: 1.4 },
  boat: {
    floats: [
      [-1.35, -0.85, -4.6],
      [1.35, -0.85, -4.6],
      [-1.45, -0.85, -1.6],
      [1.45, -0.85, -1.6],
      [-1.45, -0.85, 1.4],
      [1.45, -0.85, 1.4],
      [-1.4, -0.85, 4.6],
      [1.4, -0.85, 4.6],
    ],
    draft: 0.55,
    thrust: 42000,
    reverse: 0.4,
    stern: 5.3,
    rudder: 2600,
    drag: [900, 7000, 3800],
    yawDrag: 110000,
    bowExit: true,
  },
};

/**
 * A 26 m patrol boat (2026-10-18, step 4's test ship): a deck to walk round,
 * the wheelhouse amidships (the helm), a twin cannon on the foredeck, an MG
 * aft. Everyone else stands on deck: it carries them.
 */
const PATROL: VehicleSpec = {
  kind: 'patrol',
  seats: [
    { role: 'driver', eye: [0.6, 3.0, 1.0], exposed: true },
    { role: 'gunner', eye: [0, 3.1, -7.4], exposed: true, gun: 'autocannon', turn: 1.4, elevate: 0.8, pitch: [-0.15, 0.7] },
    { role: 'gunner', eye: [0, 2.9, 9.6], exposed: true, gun: 'mg' },
  ],
  half: [2.7, 1.2, 13],
  mass: 42000,
  wheels: [],
  wheelRadius: 0,
  suspension: { rest: 0, travel: 0, stiffness: 0, damping: 0 },
  engine: 0,
  brake: 0,
  steer: 0,
  top: 14,
  reverse: 4,
  grip: 0,
  friction: 0,
  health: 2600,
  mult: { bullet: 0.05, heavy: 0.25, explosive: 0.7, at: 1.2 },
  boat: {
    floats: [
      [-2.0, -1.15, -11],
      [2.0, -1.15, -11],
      [-2.5, -1.15, -5],
      [2.5, -1.15, -5],
      [-2.6, -1.15, 1],
      [2.6, -1.15, 1],
      [-2.6, -1.15, 7],
      [2.6, -1.15, 7],
      [-2.5, -1.15, 12],
      [2.5, -1.15, 12],
    ],
    draft: 0.8,
    thrust: 140000,
    reverse: 0.4,
    stern: 12.6,
    rudder: 11000,
    drag: [4200, 70000, 26000],
    yawDrag: 3200000,
  },
  deck: {
    parts: [
      // Wheelhouse (solid), its roof the radar platform.
      { half: [1.6, 1.15, 2.6], pos: [0, 2.35, 1.6] },
      // Railings along both sides and across the stern, the bow's bulwark.
      { half: [0.05, 0.5, 11.5], pos: [-2.62, 1.7, 0] },
      { half: [0.05, 0.5, 11.5], pos: [2.62, 1.7, 0] },
      { half: [2.6, 0.5, 0.05], pos: [0, 1.7, 12.9] },
      // The cannon's mount and the MG's pedestal.
      { half: [1.0, 0.35, 1.0], pos: [0, 1.55, -7.4] },
      { half: [0.35, 0.4, 0.35], pos: [0, 1.6, 9.6] },
    ],
  },
};

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
    mult: { bullet: 0.22, heavy: 0.22, explosive: 1, at: 1.7 },
  },
  apc: {
    kind: 'apc',
    seats: [
      { role: 'driver', eye: [-0.55, 1.75, -1.6], exposed: false },
      { role: 'gunner', eye: [0, 2.6, 0.1], exposed: false, gun: 'autocannon', turn: 1.2, elevate: 0.6 },
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
    mult: { bullet: 0, heavy: 0, explosive: 0.45, at: 1.6 },
    // Amphibious (2026-10-18, like the BTRs and AAVs it stands for): in deep water it
    // floats and its water jets push it along at a walking pace and a bit.
    boat: {
      floats: [
        [-1.25, -0.8, -2.6],
        [1.25, -0.8, -2.6],
        [-1.3, -0.8, 0],
        [1.3, -0.8, 0],
        [-1.25, -0.8, 2.6],
        [1.25, -0.8, 2.6],
      ],
      draft: 0.9,
      thrust: 60000,
      reverse: 0.4,
      stern: 3.1,
      rudder: 6000,
      drag: [1600, 14000, 9000],
      yawDrag: 260000,
      waterTop: 4.5,
    },
  },
  tank: {
    kind: 'tank',
    seats: [
      { role: 'driver', eye: [0.35, 2.55, 0.2], exposed: false, gun: 'tankgun', pitch: [-0.15, 0.35], turn: 1.05, elevate: 0.45 },
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
    mult: { bullet: 0, heavy: 0, explosive: 0.3, at: 1 },
    turnRate: 0.75,
  },
  spg: {
    kind: 'spg',
    seats: [
      { role: 'driver', eye: [0, 2.85, 0.9], exposed: false, gun: 'howitzer', pitch: [-0.05, 0.95], turn: 0.7, elevate: 0.4 },
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
    mult: { bullet: 0, heavy: 0, explosive: 0.4, at: 1 },
    turnRate: 0.7,
  },
  td: {
    kind: 'td',
    seats: [
      { role: 'driver', eye: [0.3, 2.3, -0.6], exposed: false, gun: 'atgun', traverse: 0.22, pitch: [-0.1, 0.25], turn: 0.6, elevate: 0.35 },
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
    mult: { bullet: 0, heavy: 0, explosive: 0.3, at: 0.9 },
    turnRate: 0.7,
  },
  // Rocket launcher truck (a call-in): the squad leader drives and fires the salvo.
  rocket: {
    kind: 'rocket',
    seats: [
      { role: 'driver', eye: [-0.5, 2.15, -2.3], exposed: false, gun: 'rockets', pitch: [0.1, 1.1], turn: 0.8, elevate: 0.45 },
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
    mult: { bullet: 0.08, heavy: 0.08, explosive: 0.6, at: 1.4 },
  },
  fighter: {
    kind: 'fighter',
    seats: [{ role: 'driver', eye: [0, 0.75, -3.0], exposed: false, gun: 'jetcannon', alt: 'aam', traverse: 0.02, pitch: [-0.02, 0.02] }],
    half: [1.3, 0.8, 7],
    mass: 12000,
    wheels: [],
    wheelRadius: 0.3,
    suspension: { rest: 0.2, travel: 0.1, stiffness: 20, damping: 2 },
    engine: 0,
    brake: 0,
    steer: 0,
    reverse: 0,
    grip: 1,
    friction: 1,
    top: 125,
    // Fragile (owner, 2026-10-02: "a few cannon hits and it's in trouble"): a
    // short burst from a fighter's cannon (8 hits) or one missile brings it down.
    health: 280,
    mult: { bullet: 0.35, heavy: 1.6, explosive: 1.2, at: 1.6 },
    flight: { minSpeed: 55, maxSpeed: 125, turn: 1.05, accel: 14, wings: { half: [5.3, 0.3, 2.4], z: 0.9 } },
  },
  cas: {
    kind: 'cas',
    seats: [
      { role: 'driver', eye: [0, 1.0, -3.2], exposed: false, gun: 'gau', alt: 'jetrockets', traverse: 0.02, pitch: [-0.02, 0.02] },
      { role: 'gunner', eye: [0, 1.25, -1.6], exposed: false, gun: 'mg', pitch: [-0.8, 0.5] },
    ],
    half: [1.5, 1.0, 7.5],
    mass: 16000,
    wheels: [],
    wheelRadius: 0.3,
    suspension: { rest: 0.2, travel: 0.1, stiffness: 20, damping: 2 },
    engine: 0,
    brake: 0,
    steer: 0,
    reverse: 0,
    grip: 1,
    friction: 1,
    top: 100,
    // Tougher than the fighter, still down to about 12 cannon hits or one missile.
    health: 380,
    mult: { bullet: 0.3, heavy: 1.3, explosive: 1.1, at: 1.4 },
    flight: { minSpeed: 45, maxSpeed: 100, turn: 0.85, accel: 10, wings: { half: [8.8, 0.35, 1.5], z: 0 } },
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
    mult: { bullet: 0.5, heavy: 0.5, explosive: 1.2, at: 2 },
  },
  boat: BOAT,
  lcvp: LCVP,
  patrol: PATROL,
  dd: DESTROYER,
  cv: CARRIER,
  bb: BATTLESHIP,
  ss: SUBMARINE,
  ...CARRIER_PLANE_SPECS,
  // Last: snapshots number vehicle kinds in this order (matchProtocol VEHICLE_KINDS).
  ...EMPLACEMENT_SPECS,
};

/** A gun that fires a shell (flies and drops) instead of a hitscan round. */
export interface ShellSpec {
  /** Muzzle speed (m/s), drop (m/s²); `lob`: fired in an arc onto the point aimed at. */
  speed: number;
  gravity: number;
  lob?: boolean;
  /** Dropped from a plane: it leaves with the plane's own velocity (bombs, aerial torpedoes, depth charges). */
  drop?: boolean;
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
  /** Missiles: home on a locked enemy aircraft. */
  homing?: boolean;
  /** A torpedo: runs just under the surface (it ignores `gravity`) and floods what it hits. */
  torpedo?: boolean;
  /** A depth charge: sinks and goes off under water (hurts submarines). */
  depth?: boolean;
  /** Rounds carried (carrier planes: refilled on the deck); none: no limit. */
  ammo?: number;
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
  // Jets. Fighter cannon, CAS 30 mm, air-to-air missiles, rocket pods.
  jetcannon: { rpm: 1100, damage: 45, spread: 0.45, range: 1000, vsVehicle: 22, blast: 0, burst: 120, cool: 4 },
  gau: { rpm: 900, damage: 80, spread: 0.55, range: 900, vsVehicle: 45, blast: 1.8, burst: 90, cool: 5 },
  aam: { rpm: 60, damage: 999, spread: 0, range: 1500, vsVehicle: 320, blast: 4, burst: 2, cool: 14, shell: { speed: 260, gravity: 0 }, homing: true },
  jetrockets: { rpm: 600, damage: 999, spread: 0.9, range: 1000, vsVehicle: 220, blast: 5, burst: 14, cool: 12, shell: { speed: 230, gravity: 2 } },
  ...NAVAL_GUNS,
  ...PLANE_GUNS,
  ...EMPLACEMENT_GUNS,
};

/** Base pads: seconds after a vehicle leaves before the next, the least time between two, how far it has to go to count as gone. */
export const PADS = { afterLeave: 10, cooldown: 60, leaveDistance: 12 };

/**
 * Most of a kind one side can have out, from the number of soldiers in the
 * match (owner, 2026-10-02, halved the same day): APCs one per 8, rounded up.
 * Tanks and jets one per 16 of a side's soldiers (owner, 2026-10-24; was one
 * per 8 of a side), i.e. one per 32 in the match, rounded up (24 in the match:
 * 3 APCs, 1 tank, 1 jet a side; 64: 2 each). Jeeps: 4 a side.
 */
export function vehicleLimit(kind: VehicleKind, bots: number): number {
  if (kind === 'apc') return Math.ceil(bots / 8);
  if (kind === 'jeep') return 4;
  if (TANK_KINDS.includes(kind) || JET_KINDS.includes(kind)) return Math.ceil(bots / 32);
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
