// Generates public/maps/ashfall.json — "재의 섬" (Ashfall Isle), the tropical island landing
// (big maps plan step 3, 2026-10-18). An invented volcanic island: Midway's airfield and palms,
// Iwo Jima's black-sand beach, extinct cone and dug-in defences, neither of them traced. About
// 1.8 x 1.4 km of play for 64v64; the island carries on past the edges (the volcano's cone
// stands just north of the boundary) and the sea runs all round.
// Blue holds the island (bases on the volcano's lower slopes, north). Red lands from the sea:
// its base is a transport anchored offshore (south) with landing craft waiting by it.
// Seven zones in four sectors, south to north:
//   A west beach (pillbox line) · B east beach (pier, coastal gun on the bluff)
//   C coastal village            · D jungle radar station on its hill
//   E airfield hangars           · F control tower
//   G the cave HQ dug into the volcano's foot
import { writeFileSync } from 'node:fs';
import { edgeDist, inside, rng, round, smoothClosed, smoothOpen } from './lib.mjs';
import { createTown, frame, heightFn, obb, outlineStats } from './town.mjs';

const R = rng(20261019);

// --- Play area ---------------------------------------------------------------------------
const outline = [
  [-900, -520], [-760, -690], [-380, -700], [0, -700], [380, -700], [760, -690], [900, -520], [905, 200], [880, 520],
  [700, 690], [0, 700], [-700, 690], [-880, 520], [-905, 200],
];
const boundary = smoothClosed(outline, 2).map(([x, z]) => [round(x, 1), round(z, 1)]);
const inMap = (x, z, pad = 0) => inside(boundary, x, z) && edgeDist(boundary, x, z) > pad;

// --- The island ----------------------------------------------------------------------------
// The shore line (sea level): a long south beach in a shallow arc, the rest of the island well
// past the boundary east, west and north.
const SHORE = smoothClosed([
  [-1500, 150], [-1100, 228], [-750, 268], [-450, 298], [-150, 316], [150, 313], [450, 298], [750, 262], [1100, 208], [1500, 118],
  [1700, -300], [1500, -900], [800, -1300], [0, -1420], [-800, -1300], [-1500, -900], [-1700, -300],
], 2).map(([x, z]) => [round(x, 1), round(z, 1)]);
const shoreZ = (x) => {
  // z of the south shore at x (the beach arc).
  let best = -Infinity;
  for (let i = 0; i < SHORE.length; i++) {
    const [ax, az] = SHORE[i];
    const [bx, bz] = SHORE[(i + 1) % SHORE.length];
    if ((ax - x) * (bx - x) > 0 || az < 0 || bz < 0) continue;
    const t = bx === ax ? 0 : (x - ax) / (bx - ax);
    best = Math.max(best, az + (bz - az) * t);
  }
  return best;
};

const Z = { A: [-330, 228], B: [300, 232], C: [-430, 10], D: [240, 30], E: [-200, -200], F: [270, -210], G: [0, -425] };
const ZR = { A: 38, B: 38, C: 38, D: 34, E: 40, F: 36, G: 34 };
// Blue's base: one shelf on the volcano's lower slope behind the HQ (the motor pool needs one base).
const BLUE = [[-90, -600]];
const SHIP = { x: 0, z: 600, len: 132, beam: 18, deck: 7.2 };
const RUNWAY = { z: -205, x0: -560, x1: 500, w: 46 };
const VOLCANO = [0, -940];
const RADAR_HILL = [250, 45];

const hills = [
  // The extinct cone: a broad base, the steep cone on it, the crater in the top.
  { pos: VOLCANO, radius: 640, height: 70 },
  { pos: VOLCANO, radius: 330, height: 120 },
  { pos: VOLCANO, radius: 70, height: -34 },
  { pos: RADAR_HILL, radius: 120, height: 13 },
  // Bluffs either side of the beach (the coastal guns), rolling ground inland.
  { pos: [-760, 170], radius: 150, height: 16 },
  { pos: [720, 160], radius: 150, height: 18 },
  ...[[-600, -60], [-80, 80], [520, -40], [-660, -340], [600, -360], [-80, -120], [120, 160], [-520, 120]].map(([x, z]) => ({ pos: [x, z], radius: round(90 + R() * 70), height: round(4 + R() * 6, 1) })),
  // Shell craters on the beach terraces and round the zones.
  ...Array.from({ length: 34 }, () => {
    const x = -700 + R() * 1400;
    const z = 120 + R() * 170;
    return { pos: [round(x), round(z)], radius: round(3 + R() * 4, 1), height: round(-(0.8 + R() * 1.0), 1) };
  }),
];
const terrain = {
  cell: 2,
  land: { outline: SHORE, height: 9, inland: 150, shelf: 240, depth: 26 },
  hills,
  flats: [
    ...Object.entries(Z).map(([id, p]) => ({ pos: p, radius: ZR[id] * 0.6, blend: 24 })),
    // The bases: a level shelf on the slope with room for the motor pool.
    ...BLUE.map((p) => ({ pos: p, radius: 58, blend: 30 })),
  ],
  rivers: [],
};
const H0 = heightFn(terrain);
// The runway: level pads along it at the mean height.
{
  let sum = 0;
  let n = 0;
  for (let x = RUNWAY.x0; x <= RUNWAY.x1; x += 20) {
    sum += H0(x, RUNWAY.z);
    n++;
  }
  const h = round(sum / n, 2);
  for (let x = RUNWAY.x0 - 20; x <= RUNWAY.x1 + 20; x += 30) terrain.flats.push({ pos: [x, RUNWAY.z], radius: RUNWAY.w / 2 + 14, height: h, blend: 30 });
  RUNWAY.y = h;
}
// Trenches: dry channels 3 m wide, 1.6 m deep, behind the beach and round the HQ.
const TRENCHES = [
  smoothOpen([[-470, 180], [-400, 168], [-330, 190], [-260, 172], [-190, 186]], 1),
  smoothOpen([[170, 188], [240, 172], [300, 192], [370, 176], [430, 188]], 1),
  smoothOpen([[-110, -380], [-60, -392], [0, -378], [60, -392], [110, -380]], 1),
  smoothOpen([[-60, 140], [0, 128], [60, 142]], 1),
];
for (const pts of TRENCHES) terrain.rivers.push({ pts: pts.map(([x, z]) => [round(x, 1), round(z, 1)]), width: 2.4, depth: 1.6, bank: 0.7, water: 0 });
// The cutting into the volcano's foot that leads to the HQ (a ravine with concrete at its end).
const CUT = [[0, -380], [0, -430], [0, -470]];
terrain.rivers.push({ pts: CUT, width: 9, depth: 5, bank: 4, water: 0 });
const H = heightFn(terrain);

const nearTrench = (x, z, pad = 0) => terrain.rivers.some((r) => r.pts.some(([px, pz], i) => i > 0 && segNear(x, z, r.pts[i - 1], [px, pz], r.width / 2 + r.bank + pad)));
function segNear(x, z, [ax, az], [bx, bz], d) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = dx * dx + dz * dz;
  const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
  return Math.hypot(x - ax - t * dx, z - az - t * dz) < d;
}
const onLand = (x, z, above = 1.5) => inside(SHORE, x, z) && H(x, z) > above;
const T = createTown(R, { inMap, terrain, zones: Z, radii: ZR, stone: '#7c766c', sand: '#6f6355', blocked: (x, z, pad) => nearTrench(x, z, pad) || !onLand(x, z, 1.2) || H(x, z) > 44 });
const { put, road, offRoad, kit, copse, frontage, scatter, addBuilding, between, pick, building } = T;

// --- Roads ---------------------------------------------------------------------------------
const DIRT = '#6b5a45';
const track = (pts, w = 6) => road(pts, w, { color: DIRT, material: 'ground', y: 0.04, keep: (x, z) => !nearTrench(x, z, -0.5) && onLand(x, z, 0.5) });
const MAIN = track([[0, 250], [-10, 120], [-120, 40], [-200, -60], [-215, -150]], 8);
const NORTH = track([[-60, -268], [-30, -320], [0, -360]], 7);
const EAST = track([[300, 230], [270, 120], [240, 50], [250, -80], [270, -160]], 7);
const WEST = track([[-330, 220], [-400, 120], [-430, 10], [-380, -100], [-260, -170]], 7);
const CROSS = track([[-430, 10], [-200, -60], [0, 20], [240, 50], [520, 20]], 6);
const BASE_W = track([[-90, -600], [-150, -500], [-160, -400], [-60, -268]], 6);
const BASE_E = track([[-90, -600], [60, -560], [160, -440], [160, -360], [300, -270]], 6);
const PERIM = track([[-560, -250], [-300, -265], [0, -270], [300, -270], [500, -250]], 5);
void [MAIN, NORTH, EAST, WEST, CROSS, BASE_W, BASE_E, PERIM];

// --- Sector 1: the beach ------------------------------------------------------------------------
// Pillboxes along the first terrace facing the sea, sandbagged MG nests between, wire on the
// sand, tank traps (hedgehog-like steel) at the waterline, wrecked landing craft from an
// earlier try, a timber pier at B.
const CONCRETE = '#8d8a80';
for (const [x0, x1] of [[-620, -60], [80, 620]]) {
  for (let x = x0; x <= x1; x += between(52, 70)) {
    const z = shoreZ(x) - between(55, 75);
    if (!inMap(x, z, 10) || nearTrench(x, z, 4)) continue;
    put({ ...blockAt(x, z, 7, 3.0, 6, 180 + between(-12, 12), 'pillbox', CONCRETE, 'concrete') });
  }
  for (let x = x0 + 25; x <= x1; x += between(40, 60)) {
    const z = shoreZ(x) - between(30, 45);
    if (inMap(x, z, 10) && !nearTrench(x, z, 3)) kit.nest(x, z, 180 + between(-20, 20));
  }
  // Tank traps and wire just above the waterline.
  for (let x = x0; x <= x1; x += between(9, 15)) {
    const z = shoreZ(x) - between(4, 12);
    if (!inMap(x, z, 6)) continue;
    put(blockAt(x, z, 1.8, 1.3, 1.8, R() * 90, null, '#3a3a3a', 'metal', 'cover'));
  }
}
function blockAt(x, z, w, h, d, yaw, model, color, material = 'concrete', type = 'wall') {
  return { type, pos: [round(x), round((h - 0.3) / 2), round(z)], size: [w, h + 0.3, d], rot: [0, round(yaw, 1), 0], material, color, snap: true, ...(model ? { model, base: 0.3 } : {}) };
}
// Wrecked landing craft half sunk at the waterline.
for (const x of [-520, -180, 140, 460]) {
  const z = shoreZ(x) + 6;
  put({ type: 'wall', pos: [x, 0.4, round(z)], size: [3.2, 2.2, 10], rot: [0, round(between(-25, 25), 1), round(between(-8, 8), 1)], material: 'metal', color: '#4a4d48' });
}
// B's pier and a beached supply barge.
{
  const x = 300;
  const z0 = shoreZ(x) - 6;
  for (let z = z0; z < z0 + 70; z += 6) {
    put({ type: 'floor', pos: [x, 1.2, round(z + 3)], size: [4, 0.3, 6], material: 'wood', color: '#6d5640' });
    for (const s of [-1, 1]) put({ type: 'prop', pos: [x + s * 1.8, -6, round(z + 3)], size: [0.35, 14.4, 0.35], material: 'wood', color: '#4d3d2e' });
  }
  for (let i = 0; i < 5; i++) put({ type: 'floor', pos: [x, round(1.0 - i * 0.25, 2), round(z0 - 1 - i * 0.6)], size: [4, 0.3, 0.6], material: 'wood', color: '#6d5640' });
}
// Coastal guns on the bluffs, looking out to sea, with their ready rooms.
for (const [x, z] of [[-740, 150], [700, 140]]) {
  if (!inMap(x, z, 12)) continue;
  put(blockAt(x, z, 13, 3.2, 13, 180, 'coastalGun', CONCRETE));
  kit.bunker(x + (x < 0 ? 16 : -16), z - 12, 180);
  kit.sandbags(x, z - 12, 6, 0);
}

// --- Sector 2: the coastal village and the radar station ---------------------------------------
const VILLAGE = ['#d8cdb8', '#c8b89a', '#e1d7c2', '#b8a88c', '#cfc2a8'];
const lotOK = (r) => {
  const pts = [[r.x, r.z], ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, w]) => [r.x + u * r.hw * r.ax[0] + w * r.hd * r.az[0], r.z + u * r.hw * r.ax[1] + w * r.hd * r.az[1]])];
  return pts.every(([x, z]) => inMap(x, z, 10) && offRoad(x, z, 0.6) && !nearTrench(x, z, 2) && onLand(x, z, 2));
};
const villageLot = () => ({ style: pick(['house', 'house', 'shop', 'inn']), w: between(8.6, 11), d: between(8.6, 10), floors: R() < 0.5 ? 2 : 1, material: 'plaster', color: pick(VILLAGE), ruinColors: VILLAGE, ruinMaterial: 'plaster' });
{
  const [cx, cz] = Z.C;
  const f = frame([cx, cz], 18);
  const streets = [
    road([f(-110, 0), f(110, 0)], 7, { town: true, smooth: 0, color: '#5d554b', material: 'ground' }),
    road([f(0, -90), f(0, 90)], 7, { town: true, smooth: 0, color: '#5d554b', material: 'ground' }),
    road([f(-70, 45), f(70, 45)], 5, { town: true, smooth: 0, color: '#5d554b', material: 'ground' }),
    road([f(-70, -45), f(70, -45)], 5, { town: true, smooth: 0, color: '#5d554b', material: 'ground' }),
  ];
  let lots = 0;
  for (const s of streets) for (const side of [-1, 1]) lots += frontage(s.pts, s.w / 2 + 1.7, side, { lotOK, lotStyle: villageLot, ruins: 0.3, maxSlope: 1.6 });
  // A whitewashed chapel and the harbour-master's office on the square.
  addBuilding({ pos: f(26, 22), size: [10, 16], style: 'chapel', doors: 'sn', rot: 18, material: 'plaster', color: '#e8e2d4' });
  scatter(cx, cz, 6, 30, 10);
  kit.nest(cx - 12, cz + 18, 160);
  kit.nest(cx + 16, cz - 14, 30);
  console.log(`village lots ${lots}`);
}
{
  // The radar station on its hill: a lattice mast, the operations hut, a ring of trenches and nests.
  const [rx, rz] = Z.D;
  put({ type: 'wall', pos: [rx + 8, 9, rz - 6], size: [3, 18, 3], material: 'metal', color: '#6a6e6a', model: 'waterTower', snap: true });
  addBuilding({ pos: [rx - 22, rz + 20], size: [12, 9], style: 'barracks', doors: 'sw', material: 'concrete', color: '#9a9888' });
  addBuilding({ pos: [rx + 20, rz - 24], size: [8, 7], style: 'shed', doors: 's', material: 'concrete', color: '#8e8c80' });
  // Keep the nests clear of the two huts (two of them stood inside or against one,
  // and bots building there could never finish): turn a nest along the ring until clear.
  const huts = [[rx - 22, rz + 20, 6, 4.5], [rx + 20, rz - 24, 4, 3.5]];
  const clear = (x, z) => huts.every(([hx, hz, hw, hd]) => Math.abs(x - hx) > hw + 4 || Math.abs(z - hz) > hd + 4);
  for (let k = 0; k < 6; k++) {
    let a = (k / 6) * Math.PI * 2 + 0.3;
    for (let t = 0; t < 8 && !clear(rx + Math.cos(a) * 26, rz + Math.sin(a) * 26); t++) a += 0.12;
    kit.nest(rx + Math.cos(a) * 26, rz + Math.sin(a) * 26, (-a * 180) / Math.PI + 90);
  }
  put(blockAt(rx - 22, rz - 18, 9, 4, 9, 30, 'aaGun', '#5d6252', 'metal'));
  scatter(rx, rz, 6, 24, 8);
}

// --- Sector 3: the airfield ----------------------------------------------------------------------
{
  const { z, x0, x1, w } = RUNWAY;
  // The runway: crushed coral and asphalt strips, a taxiway and the apron by the hangars.
  for (let x = x0; x < x1; x += 20) put({ type: 'floor', pos: [x + 10, round(RUNWAY.y + 0.05, 2), z], size: [20, 0.3, w], material: 'asphalt', color: '#6e6a64' });
  for (let x = x0 + 10; x < x1 - 10; x += 30) put({ type: 'floor', pos: [x + 6, round(RUNWAY.y + 0.21, 2), z], size: [12, 0.02, 0.8], material: 'concrete_floor', color: '#e8e4dc' });
  for (const s of [-1, 1]) for (let x = x0; x < x1; x += 40) put({ type: 'floor', pos: [x + 20, round(RUNWAY.y + 0.21, 2), z + s * (w / 2 - 1)], size: [40, 0.02, 0.5], material: 'concrete_floor', color: '#e0dcd2' });
  // Hangars and workshops north of the runway at E; the control tower and offices at F.
  const [ex, ez] = Z.E;
  building(frame([ex, ez - 48], 0), -34, 0, 30, 24, { style: 'hangar', doors: 'sn', material: 'metal', color: '#7a7f78' });
  building(frame([ex, ez - 48], 0), 2, 0, 30, 24, { style: 'hangar', doors: 'sn', material: 'metal', color: '#727870' });
  building(frame([ex, ez - 48], 0), 38, 2, 22, 14, { style: 'warehouse', doors: 'sn', material: 'concrete', color: '#9a978a' });
  const [fx, fz] = Z.F;
  addBuilding({ pos: [fx + 8, fz - 34], size: [10, 10], style: 'tower', floors: 4, doors: 'sw', material: 'concrete', color: '#c8c2b0' });
  addBuilding({ pos: [fx - 22, fz - 36], size: [20, 10], style: 'office', floors: 2, doors: 'sn', material: 'concrete', color: '#b8b2a0' });
  addBuilding({ pos: [fx + 40, fz - 30], size: [16, 9], style: 'barracks', doors: 'sw', material: 'concrete', color: '#a8a290' });
  // Wrecked planes along the runway and in revetments; fuel drums; AA guns round the field.
  for (const [x, dz, yaw] of [[-470, 30, 20], [-330, -34, 160], [-90, 32, 210], [60, -30, 40], [180, 34, 300], [380, -32, 120]]) {
    put(blockAt(x, z + dz, 11, 3, 9, yaw, 'planeWreck', pick(['#5a6650', '#6b6f5f', '#55604e']), 'metal'));
  }
  for (const [x, dz] of [[-540, -60], [-260, 60], [20, -70], [240, 64], [460, -66]]) put(blockAt(x, z + dz, 9, 4, 9, between(0, 360), 'aaGun', '#5d6252', 'metal'));
  // Revetments: low earth walls in a U round the parked wrecks.
  for (const [x, dz] of [[-400, 70], [-150, 72], [120, 74], [340, 72]]) {
    const f = frame([x, z + dz], 0);
    for (const [lx, lz, lw, ld] of [[0, 8, 20, 2.4], [-10, 0, 2.4, 16], [10, 0, 2.4, 16]]) put(blockAt(...f(lx, lz), lw, 2.2, ld, 0, null, '#6b5f4e', 'ground', 'cover'));
  }
  scatter(ex, ez, 8, 32, 10);
  scatter(fx, fz, 8, 32, 10);
}

// --- Sector 4: the cave HQ ------------------------------------------------------------------------
{
  const [gx, gz] = Z.G;
  // The cutting ends at a concrete face with the HQ behind it (its back in the hillside).
  addBuilding({ pos: [gx, gz - 52], size: [22, 14], style: 'hq', floors: 2, doors: 'sn', material: 'concrete', color: '#8f8b80' });
  for (const s of [-1, 1]) put({ type: 'wall', pos: [gx + s * 7.5, 2.5, gz - 40], size: [4, 5, 12], material: 'concrete', color: CONCRETE, snap: true });
  // Pillboxes covering the approach, nests on the slope either side.
  for (const [dx, dz, yaw] of [[-40, -10, 200], [42, -14, 160], [-70, -40, 190], [72, -44, 170]]) put(blockAt(gx + dx, gz + dz, 7, 3, 6, yaw, 'pillbox', CONCRETE));
  for (const [dx, dz] of [[-24, 20], [24, 18], [-56, 8], [58, 6]]) kit.nest(gx + dx, gz + dz, 180);
  scatter(gx, gz, 6, 28, 8);
}

// --- Blue bases (on the volcano's slopes) and red's transport offshore ----------------------------
for (const [x, z] of BLUE) {
  const f = frame([x, z], 0);
  for (const [lx, lz] of [[-12, -8], [0, -10], [12, -8]]) T.thing(f, lx, lz, 5, 3, 4, { type: 'wall', material: 'canvas', color: '#7d7a5c', model: 'tent' });
  kit.truck(...f(-14, 10), 90, '#4d5a3c');
  kit.tower(...f(18, 12));
  scatter(x, z, 6, 16, 4);
}
const shipObjects = [];
{
  const { x, z, len, beam, deck } = SHIP;
  const grey = '#5f666a';
  const ship = (o) => shipObjects.push({ material: 'metal', color: grey, ...o });
  // Hull below and above the water, the deck, bulwarks; the bow tapering west.
  ship({ type: 'wall', pos: [x, deck / 2 - 2, z - beam / 2 + 0.3], size: [len, deck + 4, 0.6] });
  ship({ type: 'wall', pos: [x, deck / 2 - 2, z + beam / 2 - 0.3], size: [len, deck + 4, 0.6] });
  ship({ type: 'wall', pos: [x + len / 2 - 0.3, deck / 2 - 2, z], size: [0.6, deck + 4, beam] });
  ship({ type: 'wall', pos: [x - len / 2 - 6, deck / 2 - 2, z], size: [14, deck + 4, beam * 0.55], rot: [0, 0, 0] });
  ship({ type: 'floor', pos: [x - 3.5, deck - 0.3, z], size: [len + 7, 0.6, beam] });
  for (const s of [-1, 1]) ship({ type: 'cover', pos: [x - 3.5, deck + 0.55, z + s * (beam / 2 - 0.15)], size: [len + 7, 1.1, 0.3] });
  // Superstructure, funnel, cargo hatches, kingposts, the davits the landing craft came off.
  ship({ type: 'wall', pos: [x + 18, deck + 4, z], size: [22, 8, 13], color: '#b8bcb6' });
  ship({ type: 'wall', pos: [x + 18, deck + 9.5, z], size: [14, 3, 10], color: '#c4c8c2' });
  ship({ type: 'wall', pos: [x + 26, deck + 11, z], size: [4, 8, 4], color: '#3e4244' });
  for (const hx of [-48, -30, -12, 40, 54]) ship({ type: 'cover', pos: [x + hx, deck + 0.6, z], size: [10, 1.2, 8], color: '#4d5254' });
  for (const hx of [-40, -4, 47]) ship({ type: 'prop', pos: [x + hx, deck + 7, z], size: [0.6, 14, 0.6], color: '#4a4e50' });
  for (let k = 0; k < 6; k++) for (const s of [-1, 1]) ship({ type: 'prop', pos: [x - 50 + k * 18, deck + 2, z + s * (beam / 2 - 0.5)], size: [0.4, 4, 0.4], color: '#3e4244' });
  // Scrambling nets down the north side (to swim back aboard: a wide ramp, read as nets).
  ship({ type: 'ramp', pos: [x - 20, deck / 2 - 0.4, z - beam / 2 - 3.2], size: [20, 0.3, Math.hypot(deck + 0.8, 6.4)], rot: [round((-Math.atan2(deck + 0.8, 6.4) * 180) / Math.PI, 1), 0, 0], material: 'canvas', color: '#5a5240' });
}

// --- Jungle ------------------------------------------------------------------------------------
const keepClear = [...Object.entries(Z).map(([id, p]) => [p, ZR[id] + 6]), ...BLUE.map((p) => [p, 75]), [RADAR_HILL, 30]];
const clear = (x, z) => keepClear.every(([p, r]) => Math.hypot(x - p[0], z - p[1]) > r) && Math.abs(z - RUNWAY.z) > RUNWAY.w / 2 + 40;
for (let i = 0, n = 0; i < 6000 && n < 330; i++) {
  const x = -880 + R() * 1760;
  const z = -680 + R() * 1360;
  if (!inMap(x, z, 18) || !onLand(x, z, 3) || !clear(x, z) || H(x, z) > 42) continue;
  // Thinner on the beach terraces (shot away), thicker inland.
  const beach = z > 120;
  copse(x, z, between(18, 40), Math.round(beach ? between(3, 8) : between(14, 34)), { minGap: 4.2, scale: [0.7, 1.25] });
  n++;
}
for (let i = 0; i < 46; i++) {
  const x = -880 + R() * 1760;
  const z = -680 + R() * 1100;
  if (inMap(x, z, 10) && onLand(x, z, 3) && offRoad(x, z, 4) && clear(x, z)) kit.outcrop(x, z, between(0.9, 1.8), ['#3d3a38', '#4a4643', '#34312f']);
}

// --- Spawns, zones, modes, write ------------------------------------------------------------------
T.check();
const st = outlineStats(boundary, 120);
const spawns = [];
for (const [bx, bz] of BLUE) {
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    spawns.push({ team: 'blue', pos: [round(bx + Math.cos(a) * 9), 0.1, round(bz + Math.sin(a) * 7)], yaw: 180 });
  }
}
// Red's spawns on the transport's deck (y relative to the sea bed under it).
for (let i = 0; i < 16; i++) {
  const x = SHIP.x - 56 + (i % 8) * 9;
  const z = SHIP.z + (i < 8 ? -4 : 4);
  spawns.push({ team: 'red', pos: [round(x), round(SHIP.deck + 0.1 - H(x, z), 2), z], yaw: 0 });
}
// Landing craft along the transport's beach side, bows to the island; two swimming APCs.
const vehicles = [];
for (let k = 0; k < 9; k++) vehicles.push({ kind: 'lcvp', pos: [SHIP.x - 96 + k * 24, SHIP.z - SHIP.beam / 2 - 14], yaw: 0, team: 'red' });
for (const x of [-130, 130]) vehicles.push({ kind: 'apc', pos: [x, SHIP.z - 30], yaw: 0, team: 'red' });
const zones = Object.entries(Z).map(([id, [x, z]]) => ({ id, pos: [x, 0, z], radius: ZR[id] }));
const map = {
  meta: { id: 'ashfall', name: '재의 섬', version: 2 },
  world: {
    size: st.size,
    boundary,
    terrain,
    visualProfile: 'tropical',
    groundMaterial: 'grass',
    flora: 'jungle',
    sea: { level: 0, waves: 'moderate', floor: -26 },
    shore: { top: 2.8, color: '#3b3735', ash: { above: 46, color: '#5a5450' } },
    view: { far: 3500 },
    landing: 'red',
    ambience: { birds: 0.45, wind: 0.45 },
  },
  spawns,
  zones,
  // Breakthrough: red lands and takes the island south to north; also the zone and frontline modes.
  modes: {
    default: 'conquest',
    conquest: { attacker: 'red', sectors: [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G']] },
    zone: { target: 1500 },
    frontline: { sectors: [['G'], ['E', 'F'], ['C', 'D'], ['A', 'B']], attackTime: 300, matchTime: 1800 },
  },
  objects: [...T.objects, ...shipObjects],
  buildings: T.buildings,
  props: T.props,
  trees: T.trees,
  vehicles,
};
writeFileSync(new URL('../../public/maps/ashfall.json', import.meta.url), JSON.stringify(map));
const styles = {};
for (const b of T.buildings) styles[b.style] = (styles[b.style] ?? 0) + 1;
console.log(`ashfall: ${map.objects.length} objects, ${T.buildings.length} buildings, ${T.trees.length} trees, outline ${round(st.w, 0)} x ${round(st.d, 0)} m (${round(st.area, 0)} m²), size ${st.size}`);
console.log(Object.entries(styles).map(([k, v]) => `${k} ${v}`).join(', '));
void obb;
