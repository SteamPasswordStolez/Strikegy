// Generates public/maps/lyon.json — "리옹 초원 전선" (Lyon fields), summer.
// Second layout (2026-10-11, owner: redesign it with BFV's Provence as the reference): a
// hilltop village of stone houses in terraces, ring streets round the hill and steep alleys
// between them, the church on top; round it lavender fields in rows, stone walls, hedges and
// olive groves; a stream along the west and south with a watermill. About 350 x 265 m for 16v16 (five zones need more people than the old 10v10 map).
// Red comes from the west, blue from the east. Five zones:
//   A the upper square (west), B the church on the hilltop, C the market square in the middle
//   of the village, D the watermill by the stream (red side), E the farm (blue side).
import { writeFileSync } from 'node:fs';
import { edgeDist, inside, lineDist, rng, round, smoothClosed, smoothOpen } from './lib.mjs';
import { createTown, frame, obb, outlineStats, sAtX, along, samples, spawnRings } from './town.mjs';
import { block } from './lib.mjs';

const R = rng(20261012);

// --- Outline -----------------------------------------------------------------------------
const outline = [
  [-186, -96], [-150, -136], [-80, -146], [0, -140], [80, -148], [150, -128], [190, -80], [196, 0], [188, 70], [160, 120],
  [96, 140], [20, 138], [-60, 142], [-130, 128], [-178, 90], [-196, 20],
];
const boundary = smoothClosed(outline, 2).map(([x, z]) => [round(x * 0.9, 1), round(z * 0.92, 1)]);
const inMap = (x, z, pad = 0) => inside(boundary, x, z) && edgeDist(boundary, x, z) > pad;

// --- Zones, bases, the village hill -------------------------------------------------------------
const V = [0, -34]; // the hill's top
// B on the hilltop, A and C on the lower terrace (north-west and south).
const Z = { A: [-46, -80], B: [0, -34], C: [4, 30], D: [-112, 46], E: [108, 74] };
const ZR = { A: 22, B: 20, C: 22, D: 28, E: 28 };
const RED = [-150, -30];
const BLUE = [152, 14];

// --- The stream (west and south, knee deep) --------------------------------------------------
const STREAM = {
  pts: smoothOpen([[-170, -230], [-150, -150], [-132, -70], [-126, -20], [-120, 30], [-106, 74], [-70, 108], [-10, 124], [60, 132], [140, 138], [260, 146]], 2),
  width: 6,
  depth: 1.9,
  bank: 4,
  water: 0.55,
};
const streamDist = (x, z) => lineDist(x, z, STREAM.pts);
const BRIDGES = [
  { at: [-126, -22], w: 7 }, // the main road's stone bridge
  { at: [-112, 52], w: 2.6, foot: true }, // the mill's footbridge
];
STREAM.crossings = BRIDGES.map((b) => b.at);
const nearStream = (x, z, pad = 0) => streamDist(x, z) < STREAM.width / 2 + STREAM.bank + pad;

// --- Terrain: the hill in terraces -------------------------------------------------------------
const HILL = { pos: V, radius: 132, height: 12.5 };
// The village in three levels: the hilltop (church), the upper terrace round it, the lower
// terrace further out; steps of ~3 m between them with walls and stairs.
const TOP = { r: 15, h: 12.3 };
const BAND1 = { r: 31, half: 13, h: 9.4 };
const BAND2 = { r: 64, half: 14, h: 6.2 };
const flats = [{ pos: V, radius: TOP.r, height: TOP.h, blend: 3 }];
for (const band of [BAND1, BAND2]) {
  const n = Math.ceil((2 * Math.PI * band.r) / 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    flats.push({ pos: [round(V[0] + Math.cos(a) * band.r), round(V[1] + Math.sin(a) * band.r)], radius: band.half + 1, height: band.h, blend: 3 });
  }
}
flats.push({ pos: [-74, 30], radius: 10, blend: 6 }, { pos: Z.D, radius: 26, blend: 10 }, { pos: Z.E, radius: 28, blend: 10 }, { pos: RED, radius: 24, blend: 10 }, { pos: BLUE, radius: 24, blend: 10 });
for (const b of BRIDGES) flats.push({ pos: b.at, radius: 10, height: 0, blend: 6 });
const terrain = {
  cell: 2,
  noise: 0.6,
  hills: [
    HILL,
    { pos: [150, -110], radius: 70, height: 6 }, // a rise north-east (olive terraces)
    { pos: [-150, 110], radius: 50, height: 3 },
    ...[[-60, 60], [60, 60], [-90, -100], [110, -30], [-30, 100], [140, 50]].map(([x, z]) => ({ pos: [x, z], radius: 4.5, height: -1.1 })),
  ],
  flats,
  rivers: [STREAM],
};

const T = createTown(R, {
  inMap,
  terrain,
  zones: Z,
  radii: ZR,
  stone: '#b8ab92',
  sand: '#a8987a',
  blocked: (x, z, pad) => nearStream(x, z, pad),
});
const { put, putAll, paint, addBuilding, building, thing, road, offRoad, kit, scatter, copse, frontage, kerbCars, H, pick, between } = T;

// --- Roads and village streets ---------------------------------------------------------------
const DIRT = '#9a8566';
const keepOffStream = (x, z) => !nearStream(x, z, -1);
const ring = (cx, cz, r, n, a0 = 0, a1 = Math.PI * 2) => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + (i / n) * (a1 - a0);
  return [round(cx + Math.cos(a) * r), round(cz + Math.sin(a) * r)];
});
// Main road: red base -> the stone bridge -> round the south of the village on the lower
// terrace, through the market (C) -> east -> blue.
const MAIN = road([RED, [-126, -22], [-96, -32], ...ring(V[0], V[1], BAND2.r, 12, Math.PI, 0), [86, -30], [112, -4], [134, 10], BLUE], 7, { y: 0.07, keep: keepOffStream, smooth: 1 });
const STREET = { color: '#8f8778', material: 'cobble', town: true, pave: '#b5aa96', paveMaterial: 'cobble', y: 0.055 };
// The lower ring's north half (the south half is the main road) and the upper ring.
const RING = road(ring(V[0], V[1], BAND2.r, 14, Math.PI, Math.PI * 2), 4.5, { ...STREET, smooth: 1 });
const UPPER = road(ring(V[0], V[1], BAND1.r, 18), 4, { ...STREET, smooth: 1 });
// Alleys (stairs) up the steps between the levels.
const ALLEY_ANGLES = [0.4, 1.4, 2.3, 3.3, 4.3, 5.3];
const at = (a, r) => [round(V[0] + Math.cos(a) * r), round(V[1] + Math.sin(a) * r)];
const ALLEYS = ALLEY_ANGLES.map((a) => road([at(a, BAND2.r - 6), at(a, BAND1.r + 5)], 3.4, { ...STREET, smooth: 0 }));
const TOP_ALLEYS = [1.0, 2.9, 4.9].map((a) => road([at(a, BAND1.r - 5), at(a, TOP.r - 2)], 3.4, { ...STREET, smooth: 0 }));
// Dirt lanes: to the mill, to the farm, the north lane round the hill (the tanks' way round).
// Dirt lanes (painted; buildings keep off them).
const LANE_ROADS = [
  road([[-96, -32], [-98, 10], [-92, 40], [-86, 70], [-70, 92]], 4.5, { color: DIRT, material: 'ground', y: 0.045, keep: keepOffStream }),
  road([at(0.35, BAND2.r), [80, 20], [100, 50], [104, 66]], 4.5, { color: DIRT, material: 'ground', y: 0.045 }),
  road([[-96, -32], [-92, -64], [-80, -104], [-30, -124], [40, -126], [100, -104], [124, -60], [134, 10]], 5, { color: DIRT, material: 'ground', y: 0.045, keep: keepOffStream }),
  road([at(0, BAND2.r), [80, -70], [100, -104]], 4.5, { color: DIRT, material: 'ground', y: 0.045 }),
];
void LANE_ROADS;

// --- The village levels: walls along the drops, stairs up the alleys -------------------------------
{
  const STONEC = '#b8ab92';
  const wallRing = (r, gapAngles, h = 1.0) => {
    const n = Math.ceil((2 * Math.PI * r) / 4);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      if (gapAngles.some((g) => Math.abs(Math.atan2(Math.sin(am - g), Math.cos(am - g))) * r < 3.2)) continue;
      // Not across a street.
      const [x, z] = at(am, r);
      if (!offRoad(x, z, 0.6)) continue;
      put(block(x, z, 0.5, h, round(r * (a1 - a0) + 0.3, 2), { yaw: round((am * 180) / Math.PI + 90, 1), type: 'cover', material: 'concrete', color: STONEC }));
    }
  };
  wallRing(TOP.r + 0.8, [1.0, 2.9, 4.9]);
  wallRing(BAND1.r + 14.6, ALLEY_ANGLES);
  for (const a of [1.0, 2.9, 4.9]) T.stairs(at(a, BAND1.r - 6), at(a, TOP.r - 0.5), 3, { parapet: STONEC });
  for (const a of ALLEY_ANGLES) T.stairs(at(a, BAND2.r - 12.5), at(a, BAND1.r + 14), 3, { parapet: STONEC });
}

// --- Bridges ---------------------------------------------------------------------------------
{
  const STONE = '#a59d8c';
  for (const b of BRIDGES) {
    // Crossing direction: across the stream at that point.
    let best = 0;
    for (let i = 1; i < STREAM.pts.length; i++) if (Math.hypot(STREAM.pts[i][0] - b.at[0], STREAM.pts[i][1] - b.at[1]) < Math.hypot(STREAM.pts[best][0] - b.at[0], STREAM.pts[best][1] - b.at[1])) best = i;
    const p = STREAM.pts[Math.max(1, best)];
    const q = STREAM.pts[Math.max(0, best - 1)];
    const yaw = round((Math.atan2(p[0] - q[0], p[1] - q[1]) * 180) / Math.PI + 90, 1);
    const len = STREAM.width + STREAM.bank * 2 + 4;
    const wood = !!b.foot;
    const thick = wood ? 0.25 : 0.6;
    const top = wood ? 0.3 : 0.12;
    objects().push({ type: 'floor', pos: [b.at[0], round(top - thick / 2), b.at[1]], size: [b.w, thick, len], rot: [0, yaw, 0], material: wood ? 'wood' : 'concrete', color: wood ? '#6e5a44' : STONE });
    const f = frame(b.at, yaw);
    for (const s of [-1, 1]) {
      const [x, z] = f(s * (b.w / 2 - 0.2), 0);
      objects().push({ type: 'wall', pos: [x, round(top + 0.5), z], size: [wood ? 0.12 : 0.4, 1, len], rot: [0, yaw, 0], material: wood ? 'wood' : 'concrete', color: wood ? '#6e5a44' : STONE });
    }
  }
}
function objects() {
  return T.objects;
}

// --- Red base (west): an army camp in an orchard ----------------------------------------------
{
  const f = frame(RED, 90); // local +z faces east
  for (const [lx, lz] of [[-10, -12], [0, -14], [10, -12], [-12, 10]]) thing(f, lx, lz, 5, 3, 4, { type: 'wall', material: 'canvas', color: '#b8b08e', model: 'tent' });
  kit.tower(...f(-16, 16));
  kit.tower(...f(16, -18));
  kit.truck(...f(10, 10), f.deg + 90, '#5a5a44');
  paint(f(0, 0), 24, 24, f.deg, 0.04, '#9a8a66', 'ground');
  scatter(...RED, 6, 14, 4);
}
// --- Blue base (east): a camp by the road --------------------------------------------------------
{
  const f = frame(BLUE, -90);
  for (const [lx, lz] of [[-10, -12], [0, -14], [10, -12], [12, 10]]) thing(f, lx, lz, 5, 3, 4, { type: 'wall', material: 'canvas', color: '#b8b08e', model: 'tent' });
  kit.tower(...f(-16, 16));
  kit.tower(...f(16, -18));
  kit.truck(...f(-10, 10), f.deg - 90, '#4d5a3c');
  paint(f(0, 0), 24, 24, f.deg, 0.04, '#9a8a66', 'ground');
  scatter(...BLUE, 6, 14, 4);
}

// --- C: the market square -------------------------------------------------------------------
{
  const [cx, cz] = Z.C;
  paint([cx, cz - 2], 36, 26, 0, 0.06, '#b9ae98', 'cobble');
  put(block(cx, cz - 10, 6, 1, 6, { material: 'concrete', color: '#c9c0aa', model: 'fountain' }));
  for (const [dx, dz, yaw] of [[-12, -8, 0], [-6, -15, 0], [7, -15, 0], [13, -8, 20], [-12, 8, 180], [11, 8, 180]]) kit.stall(cx + dx, cz + dz, yaw);
  for (const [dx, dz, yaw] of [[-16, -12, 80], [17, -12, 100]]) kit.cart(cx + dx, cz + dz, yaw);
  kit.sandbags(cx - 4, cz + 10, 4, 0);
  kit.wreckCar(cx + 16, cz + 10, 60);
  // Plane trees round the square.
  for (const [dx, dz] of [[-17, -12], [17, -12], [-17, 8], [17, 8]]) T.trees.push([cx + dx, cz + dz, 1.25]);
  scatter(cx, cz, 6, 18, 4);
}
// --- B: the church on the hilltop ---------------------------------------------------------
{
  const [bx, bz] = Z.B;
  addBuilding({ pos: [bx + 3, bz], size: [11, 20], style: 'chapel', doors: 'se', rot: 90, material: 'plaster', color: '#d6c6a4' });
  put(block(bx - 10.5, bz, 5.5, 22, 5.5, { type: 'wall', material: 'concrete', color: '#c4b59a', model: 'steeple', sink: 0.3 }));
  paint([bx, bz + 10], 22, 8, 0, 0.06, '#b9ae98', 'cobble');
  kit.sandbags(bx + 8, bz + 10, 3.5, 20);
  kit.sandbags(bx - 6, bz - 10, 3.5, 160);
  scatter(bx, bz, 6, 16, 3);
}
// --- A: the upper square: the mairie and a well ------------------------------------------------
{
  const [ax, az] = Z.A;
  // The mairie on the inner side of the street (its door to the street), the square in front.
  const u = [(ax - V[0]) / Math.hypot(ax - V[0], az - V[1]), (az - V[1]) / Math.hypot(ax - V[0], az - V[1])];
  const yawOut = round((Math.atan2(u[0], u[1]) * 180) / Math.PI, 1);
  addBuilding({ pos: [V[0] + u[0] * 53.5, V[1] + u[1] * 53.5], size: [16, 9], style: 'townhall', floors: 2, doors: 'sn', rot: yawOut, material: 'plaster', color: '#dccfb2' });
  paint([ax, az], 20, 16, yawOut, 0.06, '#b9ae98', 'cobble');
  put(block(ax + u[0] * 8, az + u[1] * 8, 2.4, 1.1, 2.4, { material: 'concrete', color: '#a59d8c' }));
  kit.cart(ax + u[0] * 9 + 6, az + u[1] * 9 - 4, 30);
  kit.sandbags(ax + u[0] * 10 - 6, az + u[1] * 10 + 4, 3.5, 70);
  scatter(ax, az, 6, 16, 3);
}
// --- D: the watermill by the stream ---------------------------------------------------------
{
  const [dx, dz] = Z.D;
  // The mill on the bank with its wheel in the race, a barn, the miller's house.
  addBuilding({ pos: [dx + 9, dz + 2], size: [12, 9], style: 'mill', floors: 2, doors: 'ew', rot: 80, material: 'plaster', color: '#cbb894' });
  put(block(dx + 2.4, dz + 2, 1.4, 6, 6, { yaw: 80, type: 'wall', material: 'wood', color: '#5e4a36', model: 'millWheel', sink: 1.2 }));
  addBuilding({ pos: [-74, 30], size: [14, 9], style: 'barn', doors: 'sn', rot: 0 });
  addBuilding({ pos: [dx + 6, dz + 26], size: [9, 8.6], style: 'house', floors: 2, doors: 'sn', rot: 160, material: 'plaster', color: '#d8c7a4' });
  for (const [x, z, yaw] of [[dx + 14, dz - 10, 20], [-66, 44, 80], [dx + 12, dz + 16, 0]]) kit.hay(x, z, yaw);
  kit.cart(dx + 16, dz + 6, 100);
  kit.fence([[-66, 20], [-60, 40], [-66, 58]], [[8, 12]]);
  kit.sandbags(dx + 14, dz - 22, 4, 10);
  kit.nest(-62, 6, 90);
  scatter(dx + 12, dz, 6, 20, 5);
}
// --- E: the farm (a mas with its barns) ----------------------------------------------------
{
  const [ex, ez] = Z.E;
  addBuilding({ pos: [ex - 16, ez - 4], size: [16, 9], style: 'house', floors: 2, doors: 'sne', rot: 90, material: 'plaster', color: '#dcc9a6' });
  addBuilding({ pos: [ex + 18, ez + 2], size: [16, 10], style: 'barn', doors: 'sw', rot: 90 });
  addBuilding({ pos: [ex - 6, ez + 22], size: [12, 8.6], style: 'shed', doors: 'n', rot: 180 });
  put(block(ex + 14, ez + 22, 6, 14, 6, { type: 'wall', material: 'concrete', color: '#b9b4a8', model: 'silo', sink: 0.1 }));
  for (const [x, z, yaw] of [[ex + 2, ez + 10, 10], [ex + 6, ez + 14, 80], [ex - 28, ez - 2, 30], [ex + 30, ez - 12, 0]]) kit.hay(x, z, yaw);
  kit.truck(ex + 6, ez - 14, 120, '#7a6a4a');
  kit.cart(ex - 2, ez + 6, 40);
  kit.stoneWall([[ex - 30, ez - 24], [ex + 30, ez - 24]], [[26, 34]], 1.0, '#b8ab92');
  kit.nest(ex - 20, ez - 18, 270);
  kit.wreck(ex - 30, ez + 22, 60);
  scatter(ex, ez, 6, 22, 5);
}

// --- The village: houses along the streets, in terraces -----------------------------------------
const PLASTER = ['#eadbb8', '#f0e2c4', '#e2c898', '#ecd0aa', '#e4d2b0', '#f2e6cc'];
const keepOut = [[RED, 28], [BLUE, 28], [Z.A, 18], [Z.B, 20], [Z.C, 20], [Z.D, 30], [Z.E, 32]];
const inVillage = (x, z) => Math.hypot(x - V[0], z - V[1]) < 84;
function lotOK(r) {
  if (!inVillage(r.x, r.z)) return false;
  for (const [x, z] of [[r.x, r.z], ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, w]) => [r.x + u * r.hw * r.ax[0] + w * r.hd * r.az[0], r.z + u * r.hw * r.ax[1] + w * r.hd * r.az[1]])]) {
    if (!inMap(x, z, 6) || keepOut.some(([c, cr]) => Math.hypot(x - c[0], z - c[1]) < cr)) return false;
    if (!offRoad(x, z, 1) || nearStream(x, z, 3)) return false;
  }
  for (let i = 0; i < 9; i++) {
    const x = r.x + (((i % 3) - 1) * r.hw * r.ax[0]) + ((Math.floor(i / 3) - 1) * r.hd * r.az[0]);
    const z = r.z + (((i % 3) - 1) * r.hw * r.ax[1]) + ((Math.floor(i / 3) - 1) * r.hd * r.az[1]);
    if (!offRoad(x, z, 0.8)) return false;
  }
  return true;
}
function lotStyle() {
  const roll = R();
  const color = pick(PLASTER);
  if (roll < 0.62) return { style: 'house', w: between(8.6, 10.5), d: between(8.6, 10), floors: R() < 0.4 ? 3 : 2, material: 'plaster', color };
  if (roll < 0.85) return { style: 'shop', w: between(9, 11), d: between(8.6, 10), floors: 2, material: 'plaster', color };
  return { style: 'inn', w: between(11, 14), d: between(9, 10.5), floors: 3, material: 'plaster', color };
}
let lots = 0;
const lotOpts = { lotOK, lotStyle, ruins: 0.1, gap: 0.3, maxSlope: 1.2 };
for (const r of [RING, UPPER, MAIN, ...ALLEYS, ...TOP_ALLEYS]) for (const side of [-1, 1]) lots += frontage(r.pts, r.w / 2, side, lotOpts);

// --- Fields round the village: lavender in rows, wheat, walls and hedges, olive groves --------------
const fieldsTaken = [];
function field(cx, cz, w, d, yaw, kind) {
  const r = obb(cx, cz, w, d, yaw, 2);
  if (fieldsTaken.some((o) => Math.hypot(o.x - r.x, o.z - r.z) < (Math.max(o.hw, o.hd) + Math.max(r.hw, r.hd)) * 0.75)) return false;
  for (let i = 0; i < 25; i++) {
    const x = cx + ((i % 5) / 4 - 0.5) * w * Math.cos((yaw * Math.PI) / 180) + ((Math.floor(i / 5) / 4 - 0.5) * d * Math.sin((yaw * Math.PI) / 180));
    const z = cz - ((i % 5) / 4 - 0.5) * w * Math.sin((yaw * Math.PI) / 180) + ((Math.floor(i / 5) / 4 - 0.5) * d * Math.cos((yaw * Math.PI) / 180));
    if (!inMap(x, z, 5) || !offRoad(x, z, 2) || nearStream(x, z, 3) || inVillage(x, z) || Object.entries(Z).some(([id, c]) => Math.hypot(x - c[0], z - c[1]) < ZR[id] + 4)) return false;
    if ([RED, BLUE].some((c) => Math.hypot(x - c[0], z - c[1]) < 26)) return false;
  }
  if (!T.isFree(obb(cx, cz, w, d, yaw))) return false;
  fieldsTaken.push(r);
  const f = frame([cx, cz], yaw);
  if (kind === 'lavender') {
    // Rows of lavender: purple strips on the field's long axis, a strip of bare earth between.
    paint([cx, cz], w, d, yaw, 0.035, '#8a7a5c', 'ground');
    for (let u = -w / 2 + 1; u <= w / 2 - 1; u += 1.7) paint(f(u, 0), 1.0, d - 2, yaw, 0.07, pick(['#7d68aa', '#7462a0', '#8672b2']), 'grass');
  } else if (kind === 'wheat') {
    paint([cx, cz], w, d, yaw, 0.04, pick(['#c8ad6a', '#bfa35e', '#cdb577']), 'straw');
  } else {
    paint([cx, cz], w, d, yaw, 0.035, '#8f7a58', 'ground');
  }
  // Walls and hedges on two or three sides, with gaps.
  const corners = [f(-w / 2, -d / 2), f(w / 2, -d / 2), f(w / 2, d / 2), f(-w / 2, d / 2), f(-w / 2, -d / 2)];
  for (let i = 0; i < 4; i++) {
    if (R() < 0.35) continue;
    const len = i % 2 ? d : w;
    const g = between(0.2, 0.7) * len;
    if (R() < 0.55) kit.stoneWall([corners[i], corners[i + 1]], [[g, g + 4]], 1.0, '#b8ab92');
    else kit.hedge([corners[i], corners[i + 1]], [[g, g + 4]], 1.6);
  }
  return true;
}
let fields = 0;
for (let i = 0; i < 3000 && fields < 22; i++) {
  const x = between(-180, 180);
  const z = between(-140, 135);
  const w = between(22, 42);
  const d = between(16, 30);
  const yaw = between(-25, 25) + (R() < 0.5 ? 0 : 90);
  if (field(x, z, w, d, yaw, R() < 0.6 ? 'lavender' : R() < 0.6 ? 'wheat' : 'fallow')) fields++;
}
// Olive groves and cypress lines on the slopes, trees along the stream, a few farm sheds.
for (const [x, z, r, n] of [[150, -100, 26, 22], [-150, 100, 20, 12], [-100, -110, 18, 12], [90, -128, 16, 10], [-40, 120, 16, 8], [150, 50, 14, 8], [-160, -80, 16, 10]]) copse(x, z, r, n, { minGap: 5.5, scale: [0.6, 0.9] });
for (let i = 0; i < 40; i++) {
  const p = along(STREAM.pts, between(40, 380));
  if (!p) continue;
  const side = R() < 0.5 ? -1 : 1;
  copse(p.x - p.tz * side * 9, p.z + p.tx * side * 9, 3, 1, { minGap: 6, scale: [0.9, 1.3] });
}
for (let i = 0, n = 0; i < 200 && n < 8; i++) {
  const x = between(-170, 170);
  const z = between(-130, 125);
  const r = obb(x, z, between(6, 8), between(5, 6.5), between(0, 360), 1.5);
  if (inVillage(x, z) || !inMap(x, z, 8) || samples(r, 2).some(([px, pz]) => !offRoad(px, pz, 0.5)) || nearStream(x, z, 4) || !T.isFree(r) || T.slopeUnder(r) > 0.8) continue;
  if (Object.entries(Z).some(([id, c]) => Math.hypot(x - c[0], z - c[1]) < ZR[id] + 6)) continue;
  addBuilding({ pos: [round(x), round(z)], size: [round(r.hw * 2 - 3, 1), round(r.hd * 2 - 3, 1)], style: 'shed', rot: round(Math.atan2(r.ax[1], r.ax[0]) * -57.2958, 1), doors: 's', material: 'plaster', color: pick(PLASTER) });
  n++;
}
// Dug-in positions out in the fields (the village was fought over).
for (const [x, z, yaw] of [[-80, 40, 270], [70, -86, 0], [-60, -110, 0], [120, 30, 90], [-96, -50, 270], [40, 90, 180]]) if (T.isFree(obb(x, z, 4, 4))) kit.nest(x, z, yaw);
for (const [x, z, yaw] of [[-150, 20, 30], [140, -30, 140]]) kit.wreck(x, z, yaw);
let parked = kerbCars(MAIN, { chance: 0.25, skip: (x) => Math.abs(x) > 150 });

// --- Spawns, zones, write -----------------------------------------------------------------
T.check();
const st = outlineStats(boundary);
const spawns = spawnRings(BLUE, RED, 90, -90);
const zones = Object.entries(Z).map(([id, [x, z]]) => ({ id, pos: [x, 0, z], radius: ZR[id] }));
const map = {
  meta: { id: 'lyon', name: '리옹 초원 전선', version: 2 },
  world: { size: st.size, visualProfile: 'outdoor_day', groundMaterial: 'grass', flora: 'broadleaf', boundary, terrain },
  spawns,
  zones,
  // Frontline from the blue (east) end: E, B / C / A, D (C starts neutral); Zone to 300.
  modes: { zone: { target: 300 }, frontline: { sectors: [['E', 'B'], ['C'], ['A', 'D']] } },
  objects: T.objects,
  buildings: T.buildings,
  props: T.props,
  trees: T.trees,
};
writeFileSync(new URL('../../public/maps/lyon.json', import.meta.url), JSON.stringify(map));
const styles = {};
for (const b of T.buildings) styles[b.style] = (styles[b.style] ?? 0) + 1;
console.log(`lyon: ${T.objects.length} objects, ${T.buildings.length} buildings (${lots} village lots), ${fields} fields, ${T.props.length} props, ${T.trees.length} trees, ${parked} cars, outline ${round(st.w, 0)} x ${round(st.d, 0)} m (${round(st.area, 0)} m²), size ${st.size}`);
console.log(Object.entries(styles).map(([k, v]) => `${k} ${v}`).join(', '));
void H;
void sAtX;
void putAll;
void building;
