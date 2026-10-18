import type { SeatSpec, VehicleGunSpec, VehicleKind, VehicleSpec } from './vehicleData';

/**
 * Carrier planes (2026-10-19, big maps plan step 6; plan section 3): WW2-style
 * propeller planes that live on an aircraft carrier's deck. The flight
 * control station launches one with the squad's RP (it comes up on the deck
 * at the stern), someone gets in and rolls it down the deck into the air;
 * coming in over the stern low and slow, the landing aid takes it down onto
 * the deck, where it is repaired and rearmed. Their ammunition runs out
 * (`VehicleGunSpec.ammo`). A side may have `planeCap` of them out at once.
 * [제안] numbers.
 */

export type CarrierPlaneKind = 'cvfighter' | 'cvdive' | 'cvtorp' | 'cvscout' | 'cvasw' | 'cvcas';

/** In the order the flight control station lists them (1..6). */
export const CARRIER_PLANES: readonly CarrierPlaneKind[] = ['cvfighter', 'cvdive', 'cvtorp', 'cvscout', 'cvasw', 'cvcas'];

/** RP to launch one (plan section 3). */
export const PLANE_COST: Record<CarrierPlaneKind, number> = { cvscout: 250, cvfighter: 300, cvasw: 350, cvdive: 450, cvcas: 450, cvtorp: 500 };

/** Planes a side may have out at once: a quarter of the side, at least one, at most 20 (owner). */
export function planeCap(teamSize: number): number {
  return Math.max(1, Math.min(20, Math.floor(teamSize / 4)));
}

/**
 * Deck operations: the take-off roll's push (m/s² at full throttle), the
 * brake, the landing aid's corridor behind the stern (m back, half width,
 * height over the deck, most speed over the carrier's), the glide slope,
 * how hard the wires stop it, and how long a parked plane takes to be
 * repaired and rearmed (s).
 */
export const DECK = { accel: 7, brake: 6, approach: 450, halfWidth: 28, height: 70, maxRel: 70, slope: 0.07, arrest: 18, rearm: 8, sideSpeed: 4 };

/** Carrier planes' guns: few rounds, each one counts. */
export const PLANE_GUNS: Record<'planeMg' | 'bomb' | 'airTorpedo' | 'airDepth' | 'planeRockets' | 'rearMg', VehicleGunSpec> = {
  // Wing machine guns: a fighter's six .50s, ~25 s of fire.
  planeMg: { rpm: 1000, damage: 40, spread: 0.5, range: 900, vsVehicle: 40, blast: 0, burst: 150, cool: 3, ammo: 420 },
  // The rear gunner's twin MG.
  rearMg: { rpm: 800, damage: 34, spread: 0.7, range: 600, vsVehicle: 20, blast: 0, burst: 80, cool: 3, ammo: 400 },
  // A 1,000 lb armour-piercing bomb, dropped from a dive.
  bomb: { rpm: 30, damage: 999, spread: 0.2, range: 2000, vsVehicle: 24000, blast: 12, burst: 1, cool: 2, shell: { speed: 0, gravity: 9.8, drop: true }, ammo: 1 },
  // An aerial torpedo: dropped low, it runs on under the surface like a ship's.
  airTorpedo: { rpm: 30, damage: 999, spread: 0.3, range: 3000, vsVehicle: 20000, blast: 8, burst: 1, cool: 2, shell: { speed: 0, gravity: 9.8, drop: true }, torpedo: true, ammo: 1 },
  // Depth charges for the submarine hunter.
  airDepth: { rpm: 60, damage: 999, spread: 0.6, range: 600, vsVehicle: 9000, blast: 18, burst: 1, cool: 1, shell: { speed: 0, gravity: 9.8, drop: true }, depth: true, ammo: 4 },
  // Rockets under the wings.
  planeRockets: { rpm: 300, damage: 999, spread: 0.8, range: 1200, vsVehicle: 3500, blast: 5, burst: 8, cool: 2, shell: { speed: 220, gravity: 4 }, ammo: 8 },
};

const PLANE_BASE = {
  wheels: [],
  wheelRadius: 0.3,
  suspension: { rest: 0.2, travel: 0.1, stiffness: 20, damping: 2 },
  engine: 0,
  brake: 0,
  steer: 0,
  reverse: 0,
  grip: 1,
  friction: 1,
  mult: { bullet: 0.4, heavy: 1, explosive: 0.8, at: 1.5 },
} as const;

const pilot = (gun: SeatSpec['gun'], alt?: SeatSpec['alt']): SeatSpec => ({ role: 'driver', eye: [0, 1.1, -0.6], exposed: false, gun, ...(alt ? { alt } : {}), traverse: 0.02, pitch: [-0.02, 0.02] });
const rear: SeatSpec = { role: 'gunner', eye: [0, 1.1, 1.6], exposed: false, gun: 'rearMg', pitch: [-0.6, 0.8] };

function plane(kind: CarrierPlaneKind, seats: SeatSpec[], f: { min: number; max: number; turn: number; accel: number; health: number; span: number; len: number }): VehicleSpec {
  return {
    ...PLANE_BASE,
    kind,
    seats,
    half: [0.9, 0.9, f.len / 2],
    mass: 4500,
    top: f.max,
    health: f.health,
    flight: { minSpeed: f.min, maxSpeed: f.max, turn: f.turn, accel: f.accel, wings: { half: [f.span / 2, 0.25, 1.3], z: -0.6 } },
    plane: { cost: PLANE_COST[kind] },
  };
}

/** The six carrier planes (speeds about real, a little slower than the jets). */
export const CARRIER_PLANE_SPECS: Record<CarrierPlaneKind, VehicleSpec> = {
  cvfighter: plane('cvfighter', [pilot('planeMg')], { min: 36, max: 105, turn: 1.15, accel: 13, health: 260, span: 12, len: 10.2 }),
  cvdive: plane('cvdive', [pilot('bomb', 'planeMg'), rear], { min: 33, max: 88, turn: 0.85, accel: 10, health: 340, span: 12.6, len: 10.1 }),
  cvtorp: plane('cvtorp', [pilot('airTorpedo', 'planeMg'), rear], { min: 32, max: 80, turn: 0.75, accel: 9, health: 380, span: 16.5, len: 12.2 }),
  cvscout: plane('cvscout', [pilot('planeMg'), rear], { min: 30, max: 95, turn: 0.95, accel: 11, health: 220, span: 12, len: 9.4 }),
  cvasw: plane('cvasw', [pilot('airDepth', 'planeMg'), rear], { min: 31, max: 82, turn: 0.8, accel: 9, health: 300, span: 16, len: 12 }),
  cvcas: plane('cvcas', [pilot('planeRockets', 'planeMg')], { min: 34, max: 98, turn: 1.0, accel: 12, health: 320, span: 12.5, len: 10.5 }),
};

export const isCarrierPlane = (kind: VehicleKind): kind is CarrierPlaneKind => (CARRIER_PLANES as readonly string[]).includes(kind);

/** Why a flight control station can't launch `kind` now (`up` planes out of `cap`, `rp` in the squad), or null when it can. */
export function launchBlock(kind: CarrierPlaneKind, rp: number, up: number, cap: number, hasSquad: boolean): 'noSquad' | 'cap' | 'rp' | null {
  if (!hasSquad) return 'noSquad';
  if (up >= cap) return 'cap';
  if (rp < PLANE_COST[kind]) return 'rp';
  return null;
}
