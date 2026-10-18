import type { SeatSpec, StationKind, VehicleGunSpec, VehicleSpec } from './vehicleData';

/**
 * Warships (2026-10-18, big maps plan step 5; numbers in docs/design/big-maps.md
 * section 3): destroyer, aircraft carrier, battleship and submarine at their
 * real lengths and about real speeds. Every one is a floating hull with a deck
 * people walk on; its seats are stations one walks up to and mans (E). The
 * helm steers by engine telegraph (five steps) and rudder, and works the
 * stations nobody mans (never the AA; on the battleship not the main and
 * secondary guns without someone at fire control). Physics numbers come from
 * the plan's table: thrust and drag give the top speed and the time to reach
 * it; the rudder and the water's yaw drag give the turning circle and the
 * rudder's lag.
 */

/** Naval guns. Shells fly (flight time matters at range); torpedoes run just under the surface. */
export const NAVAL_GUNS: Record<'naval5in' | 'naval6in' | 'naval16in' | 'aa40' | 'torpedo' | 'depthcharge' | 'deckgun', VehicleGunSpec> = {
  // Destroyer main gun: a 5-inch every 3 s, out to ~5 km.
  naval5in: { rpm: 20, damage: 999, spread: 0.45, range: 5000, vsVehicle: 1400, blast: 6, burst: 1, cool: 3, shell: { speed: 520, gravity: 9.8 } },
  // Battleship secondaries: 6-inch every 5 s.
  naval6in: { rpm: 12, damage: 999, spread: 0.5, range: 5000, vsVehicle: 1800, blast: 7, burst: 1, cool: 5, shell: { speed: 540, gravity: 9.8 } },
  // Battleship main battery: a 16-inch salvo every 30 s, 600 m/s, ~6 km.
  naval16in: { rpm: 2, damage: 999, spread: 0.35, range: 6500, vsVehicle: 9000, blast: 14, burst: 1, cool: 30, shell: { speed: 600, gravity: 9.8 } },
  // Twin 40 mm AA: fast, airburst-ish (small blast), against aircraft mostly.
  aa40: { rpm: 240, damage: 80, spread: 0.6, range: 2200, vsVehicle: 70, blast: 2.5, burst: 40, cool: 4, shell: { speed: 880, gravity: 9.8 } },
  // Torpedo: 25 m/s along the surface, a big hole and flooding.
  torpedo: { rpm: 3, damage: 999, spread: 0.4, range: 3500, vsVehicle: 20000, blast: 8, burst: 1, cool: 20, shell: { speed: 25, gravity: 0 }, torpedo: true },
  // Depth charges: rolled off the stern, they sink and go off at depth.
  depthcharge: { rpm: 6, damage: 999, spread: 1.5, range: 60, vsVehicle: 9000, blast: 18, burst: 1, cool: 10, shell: { speed: 10, gravity: 9.8 }, depth: true },
  // A submarine's deck gun (surfaced only).
  deckgun: { rpm: 12, damage: 999, spread: 0.6, range: 4000, vsVehicle: 900, blast: 5, burst: 1, cool: 5, shell: { speed: 480, gravity: 9.8 } },
};

/** Floats down both sides along a hull `len` m long, `half` m wide, at `y` (two rows, `n` a side). */
function floats(len: number, half: number, y: number, n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const z = -len / 2 + (len * (i + 0.5)) / n;
    // Narrower toward the bow.
    const w = half * (z < -len * 0.3 ? 0.65 : 0.95);
    out.push([-w, y, z], [w, y, z]);
  }
  return out;
}

const seat = (role: SeatSpec['role'], kind: StationKind, eye: [number, number, number], at: [number, number, number], more: Partial<SeatSpec> = {}): SeatSpec => ({
  role,
  eye,
  exposed: true,
  station: { kind, at },
  ...more,
});

const SHIP_BASE = {
  wheels: [],
  wheelRadius: 0,
  suspension: { rest: 0, travel: 0, stiffness: 0, damping: 0 },
  engine: 0,
  brake: 0,
  steer: 0,
  grip: 0,
  friction: 0,
  mult: { bullet: 0.01, heavy: 0.05, explosive: 0.3, at: 1 },
} as const;

/** Destroyer: 115 m, 19 m/s; helm, two 5-inch, torpedoes, AA, depth charges and sonar. */
const DD_DECK = 3;
export const DESTROYER: VehicleSpec = {
  ...SHIP_BASE,
  kind: 'dd',
  half: [6, 3, 57.5],
  mass: 2.5e6,
  top: 19,
  reverse: 5,
  health: 60000,
  seats: [
    seat('driver', 'helm', [0, DD_DECK + 7.6, -15], [3.6, DD_DECK, -5]),
    seat('gunner', 'main', [0, DD_DECK + 3.4, -35], [0, DD_DECK, -30.5], { gun: 'naval5in', traverse: 2.6, pitch: [-0.05, 0.75], turn: 0.4, elevate: 0.25 }),
    seat('gunner', 'main', [0, DD_DECK + 3.4, 42], [0, DD_DECK, 37.5], { gun: 'naval5in', facing: Math.PI, traverse: 2.6, pitch: [-0.05, 0.75], turn: 0.4, elevate: 0.25 }),
    seat('gunner', 'torpedo', [0, DD_DECK + 2.3, 18], [0, DD_DECK, 21.5], { gun: 'torpedo', traverse: Math.PI, pitch: [-0.05, 0.05], turn: 0.5, elevate: 0.5 }),
    seat('gunner', 'aa', [-4.2, DD_DECK + 2.6, 22], [-3.2, DD_DECK, 25.5], { gun: 'aa40', pitch: [-0.05, 1.45] }),
    seat('gunner', 'asw', [0, DD_DECK + 2, 53], [0, DD_DECK, 49], { gun: 'depthcharge', facing: Math.PI, traverse: 0.3, pitch: [0.1, 0.4] }),
  ],
  boat: {
    floats: floats(112, 6, -2.9, 7),
    draft: 3,
    thrust: 3.3e6,
    reverse: 0.35,
    stern: 55,
    rudder: 3.3e6,
    drag: [30000, 2.2e6, 2.5e5],
    yawDrag: 7e8,
  },
  deck: {
    parts: [
      // Bridge and its tower, the funnels' housing, gun houses, the torpedo mount.
      { half: [4, 3.2, 6], pos: [0, DD_DECK + 3.2, -12] },
      { half: [2.6, 2.4, 9], pos: [0, DD_DECK + 2.4, 4] },
      { half: [2.2, 1.6, 2.6], pos: [0, DD_DECK + 1.6, -35] },
      { half: [2.2, 1.6, 2.6], pos: [0, DD_DECK + 1.6, 42] },
      // Rails down both sides.
      { half: [0.05, 0.55, 54], pos: [-5.95, DD_DECK + 0.55, 1] },
      { half: [0.05, 0.55, 54], pos: [5.95, DD_DECK + 0.55, 1] },
    ],
  },
  ship: { stationsNeeded: [] },
};

/** Aircraft carrier: 250 m, 17 m/s; helm, flight control, four AA, engine room, damage control. */
const CV_DECK = 8;
export const CARRIER: VehicleSpec = {
  ...SHIP_BASE,
  kind: 'cv',
  half: [16, 8, 125],
  mass: 3.0e7,
  top: 17,
  reverse: 4,
  health: 135000,
  seats: [
    seat('driver', 'helm', [12, CV_DECK + 14, -8], [9, CV_DECK, -4]),
    seat('passenger', 'flight', [12, CV_DECK + 10, 8], [9, CV_DECK, 10]),
    seat('gunner', 'aa', [-14.5, CV_DECK + 2, -95], [-13, CV_DECK, -91], { gun: 'aa40', pitch: [-0.05, 1.45] }),
    seat('gunner', 'aa', [14.5, CV_DECK + 2, -95], [13, CV_DECK, -91], { gun: 'aa40', pitch: [-0.05, 1.45] }),
    seat('gunner', 'aa', [-14.5, CV_DECK + 2, 100], [-13, CV_DECK, 96], { gun: 'aa40', facing: Math.PI, pitch: [-0.05, 1.45] }),
    seat('gunner', 'aa', [14.5, CV_DECK + 2, 100], [13, CV_DECK, 96], { gun: 'aa40', facing: Math.PI, pitch: [-0.05, 1.45] }),
    seat('passenger', 'engine', [-6, CV_DECK + 1.7, 40], [-6, CV_DECK, 44]),
    seat('passenger', 'dc', [-6, CV_DECK + 1.7, -40], [-6, CV_DECK, -36]),
  ],
  boat: {
    floats: floats(244, 15, -7.9, 9),
    draft: 7,
    thrust: 1.2e7,
    reverse: 0.3,
    stern: 122,
    rudder: 1.8e7,
    drag: [1.35e5, 3e7, 3e6],
    yawDrag: 1.33e10,
  },
  deck: {
    parts: [
      // The island (bridge, funnel) on the starboard edge.
      { half: [2.6, 6, 14], pos: [12.5, CV_DECK + 6, 2] },
      { half: [2, 4, 4], pos: [12.5, CV_DECK + 14, 6] },
      // Gun tubs at the corners, edge rails.
      { half: [0.05, 0.5, 120], pos: [-15.95, CV_DECK + 0.5, 0] },
      { half: [0.05, 0.5, 120], pos: [15.95, CV_DECK + 0.5, 0] },
    ],
  },
  ship: { stationsNeeded: [] },
};

/** Battleship: 245 m, 15 m/s; sixteen stations (plan section 3: less AA, more secondaries, a catapult). */
const BB_DECK = 7;
export const BATTLESHIP: VehicleSpec = {
  ...SHIP_BASE,
  kind: 'bb',
  half: [17, 7, 122.5],
  mass: 4.5e7,
  top: 15,
  reverse: 4,
  health: 180000,
  seats: [
    seat('driver', 'helm', [0, BB_DECK + 18, -22], [7.5, BB_DECK, -11]),
    seat('passenger', 'fire', [0, BB_DECK + 28, -18], [-7.5, BB_DECK, -11]),
    seat('gunner', 'main', [0, BB_DECK + 5, -66], [0, BB_DECK, -58], { gun: 'naval16in', traverse: 2.4, pitch: [-0.03, 0.75], turn: 0.08, elevate: 0.1 }),
    seat('gunner', 'main', [0, BB_DECK + 8.5, -46], [0, BB_DECK, -38], { gun: 'naval16in', traverse: 2.4, pitch: [-0.03, 0.75], turn: 0.08, elevate: 0.1 }),
    seat('gunner', 'main', [0, BB_DECK + 5, 66], [0, BB_DECK, 58], { gun: 'naval16in', facing: Math.PI, traverse: 2.4, pitch: [-0.03, 0.75], turn: 0.08, elevate: 0.1 }),
    seat('gunner', 'secondary', [-12, BB_DECK + 3, -14], [-10, BB_DECK, -8], { gun: 'naval6in', facing: -Math.PI / 2, traverse: 1.4, pitch: [-0.05, 0.7], turn: 0.3, elevate: 0.3 }),
    seat('gunner', 'secondary', [-12, BB_DECK + 3, 16], [-10, BB_DECK, 22], { gun: 'naval6in', facing: -Math.PI / 2, traverse: 1.4, pitch: [-0.05, 0.7], turn: 0.3, elevate: 0.3 }),
    seat('gunner', 'secondary', [12, BB_DECK + 3, -14], [10, BB_DECK, -8], { gun: 'naval6in', facing: Math.PI / 2, traverse: 1.4, pitch: [-0.05, 0.7], turn: 0.3, elevate: 0.3 }),
    seat('gunner', 'secondary', [12, BB_DECK + 3, 16], [10, BB_DECK, 22], { gun: 'naval6in', facing: Math.PI / 2, traverse: 1.4, pitch: [-0.05, 0.7], turn: 0.3, elevate: 0.3 }),
    seat('gunner', 'aa', [-10, BB_DECK + 9, 34], [-8, BB_DECK, 38], { gun: 'aa40', pitch: [-0.05, 1.45] }),
    seat('gunner', 'aa', [10, BB_DECK + 9, 34], [8, BB_DECK, 38], { gun: 'aa40', pitch: [-0.05, 1.45] }),
    seat('gunner', 'aa', [0, BB_DECK + 12, 46], [0, BB_DECK, 50], { gun: 'aa40', facing: Math.PI, pitch: [-0.05, 1.45] }),
    seat('passenger', 'catapult', [6, BB_DECK + 2, 100], [6, BB_DECK, 96]),
    seat('passenger', 'engine', [-6, BB_DECK + 1.7, 30], [-6, BB_DECK, 34]),
    seat('passenger', 'dc', [-6, BB_DECK + 1.7, -88], [-6, BB_DECK, -84]),
    seat('passenger', 'dc', [-6, BB_DECK + 1.7, 84], [-6, BB_DECK, 88]),
  ],
  boat: {
    floats: floats(240, 16, -6.9, 9),
    draft: 8,
    thrust: 1.35e7,
    reverse: 0.3,
    stern: 120,
    rudder: 2.3e7,
    drag: [1.9e5, 4.5e7, 4.5e6],
    yawDrag: 1.64e10,
  },
  deck: {
    parts: [
      // The tower (bridge, fire control on top), the funnel and aft superstructure, turrets and barbettes.
      { half: [6, 9, 8], pos: [0, BB_DECK + 9, -16] },
      { half: [5, 6, 12], pos: [0, BB_DECK + 6, 22] },
      { half: [5.5, 2.2, 6], pos: [0, BB_DECK + 2.2, -66] },
      { half: [5.5, 3.8, 6], pos: [0, BB_DECK + 3.8, -46] },
      { half: [5.5, 2.2, 6], pos: [0, BB_DECK + 2.2, 66] },
      // The AA platforms' towers.
      { half: [1.7, 3.8, 1.7], pos: [-10, BB_DECK + 3.8, 34] },
      { half: [1.7, 3.8, 1.7], pos: [10, BB_DECK + 3.8, 34] },
      { half: [1.7, 5.3, 1.7], pos: [0, BB_DECK + 5.3, 46] },
      { half: [0.05, 0.55, 118], pos: [-16.95, BB_DECK + 0.55, 0] },
      { half: [0.05, 0.55, 118], pos: [16.95, BB_DECK + 0.55, 0] },
    ],
  },
  ship: { stationsNeeded: [{ kinds: ['main', 'secondary'], needs: 'fire' }] },
};

/** Submarine: 95 m, 10.5 m/s surfaced, 5 dived; helm (speed and depth), periscope, two tubes, sonar, deck gun. */
const SS_DECK = 3.5;
export const SUBMARINE: VehicleSpec = {
  ...SHIP_BASE,
  kind: 'ss',
  half: [4, 3.5, 47.5],
  mass: 1.5e6,
  top: 10.5,
  reverse: 3,
  health: 36000,
  seats: [
    seat('driver', 'helm', [0, SS_DECK + 5.6, -6], [1, SS_DECK, 1]),
    seat('passenger', 'periscope', [0, SS_DECK + 9, -8], [-1, SS_DECK, 1]),
    seat('gunner', 'torpedo', [0, SS_DECK + 0.8, -42], [0, SS_DECK, -36], { gun: 'torpedo', traverse: 0.15, pitch: [-0.05, 0.05] }),
    seat('gunner', 'torpedo', [0, SS_DECK + 0.8, 42], [0, SS_DECK, 36], { gun: 'torpedo', facing: Math.PI, traverse: 0.15, pitch: [-0.05, 0.05] }),
    seat('passenger', 'sonar', [0, SS_DECK + 0.8, -26], [0, SS_DECK, -22]),
    seat('gunner', 'deckgun', [0, SS_DECK + 2, -14], [0, SS_DECK, -17], { gun: 'deckgun', traverse: 2.6, pitch: [-0.05, 0.6], turn: 0.5, elevate: 0.4 }),
  ],
  boat: {
    floats: floats(92, 4, -3.4, 6),
    draft: 4.6,
    thrust: 5.2e5,
    reverse: 0.4,
    stern: 46,
    rudder: 1.28e6,
    drag: [13700, 1.4e6, 1.5e5],
    yawDrag: 2.27e8,
  },
  deck: {
    parts: [
      // The conning tower (sail) and the deck gun's base.
      { half: [1.6, 3.2, 5], pos: [0, SS_DECK + 3.2, -6] },
      { half: [0.8, 0.6, 0.8], pos: [0, SS_DECK + 0.6, -14] },
    ],
  },
  ship: { stationsNeeded: [], sub: { divedTop: 5, depths: [0, 9, 22], oxygen: 120 } },
};
