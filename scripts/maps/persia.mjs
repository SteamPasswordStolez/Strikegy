// Generates public/maps/persia.json — "페르시아 침공" (Persian Invasion), desert.
// Small 3-zone map for 1v1 to 2v2 (~180 x 140 m, layout from the owner's sketch).
// Blue comes in from the north-west, red from the south-east. A shallow wadi
// runs north-south through rocky ground: A the round village square with its
// market lanes west of it, B the oasis bridge over it, C the walled outpost
// fort east of it. A watch post sits on a hill in the north-east, a ridge path
// and a rock canyon in the south give the long way round.
import { writeFileSync } from 'node:fs';
import { block, edgeDist, inside, lineDist, rng, round, smoothClosed, smoothOpen, stripAlong, wallLine } from './lib.mjs';

const R = rng(20261003);
const objects = [];
const buildings = [];
const props = [];

/** Sketch pixels (1448 x 1086 image) to metres; x east, z south. */
const S = 0.14;
const P = (px, py) => [round((px - 725) * S, 1), round((py - 555) * S, 1)];
const Ps = (list) => list.map(([x, y]) => P(x, y));

// --- Outline -----------------------------------------------------------------
const boundary = smoothClosed(
  Ps([
    [30, 260], [60, 120], [160, 70], [330, 55], [520, 75], [700, 48], [880, 60], [1060, 85], [1230, 70], [1360, 120],
    [1420, 260], [1400, 430], [1430, 600], [1410, 800], [1420, 960], [1320, 1050], [1120, 1040], [960, 1068], [760, 1060],
    [560, 1030], [380, 1000], [230, 940], [90, 850], [40, 680], [20, 480],
  ]),
  2,
).map(([x, z]) => [round(x, 1), round(z, 1)]);
const inMap = (x, z, pad = 0) => inside(boundary, x, z) && edgeDist(boundary, x, z) > pad;

// --- Wadi ---------------------------------------------------------------------
const river = {
  pts: smoothOpen(Ps([[740, -120], [760, 60], [770, 150], [758, 260], [742, 390], [715, 525], [700, 630], [692, 730], [722, 830], [745, 940], [770, 1060], [800, 1250]]), 3).map(([x, z]) => [round(x, 1), round(z, 1)]),
  width: 5,
  depth: 2.4,
  bank: 3.5,
  water: 0.35,
};
const RIVER_CLEAR = river.width / 2 + river.bank;
const nearRiver = (x, z, pad) => lineDist(x, z, river.pts) < RIVER_CLEAR + pad;
function riverDir(x, z) {
  let best = Infinity;
  let dir = [0, 1];
  const p = river.pts;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i];
    const [bx, bz] = p[i + 1];
    const d = Math.hypot((ax + bx) / 2 - x, (az + bz) / 2 - z);
    if (d < best) {
      best = d;
      const L = Math.hypot(bx - ax, bz - az);
      dir = [(bx - ax) / L, (bz - az) / L];
    }
  }
  return dir;
}
function onRiver(x, z) {
  let best = Infinity;
  let out = [x, z];
  const p = river.pts;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i];
    const [bx, bz] = p[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) {
      best = d;
      out = [ax + dx * t, az + dz * t];
    }
  }
  return out.map((v) => round(v, 1));
}

// --- Zones and bases -------------------------------------------------------------
const Z = {
  A: P(430, 335), // round village square
  B: P(715, 525), // oasis bridge
  C: P(1160, 520), // outpost fort
};
const BLUE = P(150, 175);
const RED = P(1320, 920);
const WATCH = P(1235, 235);

const bridges = [
  { at: onRiver(...Z.B), len: 16, w: 5, kind: 'stone' },
  { at: onRiver(...P(770, 150)), len: 11, w: 2.4, kind: 'wood' },
].map((b) => {
  const [tx, tz] = riverDir(b.at[0], b.at[1]);
  const [cx, cz] = [-tz, tx];
  return { ...b, x: b.at[0], z: b.at[1], cx, cz, yaw: round((Math.atan2(cx, cz) * 180) / Math.PI, 1), deck: 0.3 };
});
river.crossings = bridges.map((b) => [b.x, b.z]);

// --- Terrain -----------------------------------------------------------------
const flats = [
  { pos: Z.A, radius: 30, blend: 8 },
  { pos: Z.C, radius: 32, blend: 8 },
  { pos: BLUE, radius: 14, blend: 8 },
  { pos: RED, radius: 14, blend: 8 },
];
for (const b of bridges) {
  for (const s of [-1, 1]) flats.push({ pos: [round(b.x + s * b.cx * (b.len / 2 - 2)), round(b.z + s * b.cz * (b.len / 2 - 2))], radius: 4.5, height: round(b.deck - 0.1), blend: 7 });
}
// Rocky high ground: the western and southern hills, canyon walls by the wadi in
// the south, the watch-post hill; the sketch's cliffs rise along the edges.
const terrain = {
  cell: 1.5,
  noise: 0.6,
  hills: [
    { pos: P(130, 560), radius: 26, height: 9 },
    { pos: P(180, 760), radius: 28, height: 10 },
    { pos: P(330, 860), radius: 24, height: 8 },
    { pos: P(460, 760), radius: 18, height: 5 }, // ridge path crest
    { pos: P(560, 900), radius: 20, height: 7 },
    { pos: P(860, 780), radius: 18, height: 8 }, // canyon east wall
    { pos: P(560, 700), radius: 14, height: 6 }, // canyon west wall
    { pos: P(900, 960), radius: 22, height: 9 },
    { pos: WATCH, radius: 22, height: 8 },
    { pos: P(1000, 220), radius: 18, height: 4 },
    { pos: P(1390, 520), radius: 20, height: 6 },
    { pos: P(520, 90), radius: 22, height: 5 },
    { pos: P(1080, 980), radius: 18, height: 5 },
  ],
  flats,
  rivers: [river],
};

// --- Tracks --------------------------------------------------------------------
const SANDY = '#cdb08c';
const at = (b, s) => [round(b.x + s * b.cx * (b.len / 2 + 0.5)), round(b.z + s * b.cz * (b.len / 2 + 0.5))];
const [bB, bN] = bridges;
const roads = [
  // Blue base -> square -> oasis bridge -> fort gate -> red base.
  { pts: smoothOpen([BLUE, P(250, 230), P(330, 290), Z.A]), w: 4 },
  { pts: smoothOpen([Z.A, P(540, 420), P(615, 520), at(bB, bB.cx < 0 ? 1 : -1)]), w: 4 },
  { pts: smoothOpen([at(bB, bB.cx < 0 ? -1 : 1), P(850, 560), P(960, 580), P(1015, 565)]), w: 4 },
  { pts: smoothOpen([P(1170, 690), P(1220, 790), P(1280, 860), RED]), w: 4 },
  // Round the fort's south side to the red base.
  { pts: smoothOpen([P(960, 580), P(960, 720), P(1080, 760), P(1220, 790)]), w: 3.5 },
  // North: square -> footbridge -> watch post.
  { pts: smoothOpen([Z.A, P(520, 200), P(650, 150), at(bN, bN.cx < 0 ? 1 : -1)]), w: 3 },
  { pts: smoothOpen([at(bN, bN.cx < 0 ? -1 : 1), P(920, 170), P(1080, 200), WATCH]), w: 3 },
  { pts: smoothOpen([WATCH, P(1260, 330), P(1220, 380)]), w: 3 },
  // South-west ridge path from the square down to the canyon.
  { pts: smoothOpen([Z.A, P(330, 470), P(260, 590), P(330, 700), P(470, 760), P(600, 790), P(680, 820)]), w: 2.5 },
];
for (const r of roads) {
  const strips = stripAlong(r.pts, r.w, { color: SANDY, material: 'sand', y: 0.04 });
  objects.push(...strips.filter((s) => !nearRiver(s.pos[0], s.pos[2], 0.3) && inMap(s.pos[0], s.pos[2], -3)));
}
const nearRoad = (x, z, pad) => roads.some((r) => lineDist(x, z, r.pts) < r.w / 2 + pad);

// --- Bridges -------------------------------------------------------------------
const ADOBE = '#fff2e0';
for (const b of bridges) {
  const wood = b.kind === 'wood';
  const thick = wood ? 0.25 : 0.5;
  const material = wood ? 'wood' : 'sand';
  const color = wood ? '#7a6248' : '#efdcc0';
  const sx = b.cz;
  const sz = -b.cx;
  objects.push({ type: 'floor', pos: [b.x, round(b.deck - thick / 2), b.z], size: [b.w, thick, b.len], rot: [0, b.yaw, 0], material, color });
  for (const s of [-1, 1]) {
    const rail = wood ? 0.1 : 0.4;
    const off = b.w / 2 - rail / 2;
    objects.push({ type: 'wall', pos: [round(b.x + sx * s * off), round(b.deck + 0.45), round(b.z + sz * s * off)], size: [rail, 0.9, b.len], rot: [0, b.yaw, 0], material, color });
  }
  objects.push({ type: 'wall', pos: [b.x, round((b.deck - thick - 2.8) / 2), b.z], size: [b.w + 0.4, round(2.8 + thick), wood ? 0.4 : 1.4], rot: [0, b.yaw, 0], material, color });
}

// --- Placement -----------------------------------------------------------------
const placed = [];
const reserve = (x, z, r) => placed.push({ x, z, r });
const free = (x, z, r) => placed.every((p) => Math.hypot(x - p.x, z - p.z) > p.r + r);
const addBuilding = (b) => {
  buildings.push(b);
  reserve(b.pos[0], b.pos[1], Math.hypot(b.size[0], b.size[1]) / 2 + 0.5);
};
const obj = (o, r = 2) => {
  objects.push(o);
  reserve(o.pos[0], o.pos[2], r);
};
for (const b of bridges) reserve(b.x, b.z, b.len / 2 + 1);
const house = (x, z, w, d, rot, floors = 1, doors = 's', solid = false) =>
  addBuilding({ pos: [round(x), round(z)], size: [w, d], style: 'shop', floors, doors, rot: round(rot, 1), material: 'sand', color: ADOBE, solid });
const STALL_COLORS = ['#a8433a', '#c9b48a', '#6f4f7a', '#3f6a6a', '#b58a3a'];
const stall = (x, z, yaw) => obj(block(x, z, 3, 2.6, 2.4, { yaw, material: 'wood', color: STALL_COLORS[Math.floor(R() * STALL_COLORS.length)], model: 'stall', sink: 0.1 }), 2);
const sandbags = (x, z, len, yaw) => obj(block(x, z, len, 1.1, 0.9, { yaw, material: 'ground', color: '#b39e7c', model: 'sandbags' }), len / 2 + 0.5);
const mudWall = (pts, gaps = [], height = 1.4, thick = 0.5) => {
  for (const p of wallLine(pts, { height, thick, material: 'sand', color: '#f4e4cc', type: 'cover', gaps })) if (!nearRiver(p.pos[0], p.pos[2], 0.3)) objects.push(p);
};

// --- A: round village square ---------------------------------------------------------
{
  const [ax, az] = Z.A;
  // A fountain in the middle; flat-roofed houses in a ring, facing in, lanes between.
  obj(block(ax, az, 3.6, 1, 3.6, { material: 'concrete', color: '#d8c8a8', model: 'fountain' }), 3);
  const ring = 16;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    // Gaps for the lanes: east (bridge road), north-east (footbridge), west (market), south-west (ridge path).
    const deg = ((a * 180) / Math.PI) % 360;
    if ([[-15, 25], [300, 330], [165, 200], [115, 140]].some(([lo, hi]) => (deg >= lo && deg <= hi) || (deg - 360 >= lo && deg - 360 <= hi))) continue;
    const r = ring + 3 + R() * 1.5;
    const x = ax + Math.cos(a) * r;
    const z = az + Math.sin(a) * r;
    const yaw = (Math.atan2(Math.cos(a), Math.sin(a)) * 180) / Math.PI;
    house(x, z, 6 + R() * 1.5, 5.5 + R(), yaw, R() < 0.35 ? 2 : 1, 'n');
  }
  // Outer houses, some closed.
  for (let i = 0; i < 10; i++) {
    const a = R() * Math.PI * 2;
    const r = 30 + R() * 8;
    const x = ax + Math.cos(a) * r;
    const z = az + Math.sin(a) * r;
    if (!inMap(x, z, 5) || nearRoad(x, z, 3) || nearRiver(x, z, 4) || !free(x, z, 4.5)) continue;
    house(x, z, 6 + R() * 2, 5 + R() * 2, R() * 360, 1, 'ns', R() < 0.4);
  }
  // Market: rows of stalls in the lane west of the square, a few more in the square.
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const x = ax - 20 - t * 14;
    const z = az + 2 + t * 7;
    for (const s of [-1, 1]) if (free(x, z + s * 3, 1.2)) stall(x, z + s * 3, s > 0 ? 0 : 180);
  }
  for (const [dx, dz, yaw] of [[7, -6, 30], [-6, 7, 200], [-8, -5, 120]]) stall(ax + dx, az + dz, yaw);
  sandbags(ax + 9, az + 4, 3, 60);
}

// --- B: oasis bridge -------------------------------------------------------------
{
  const [bx, bz] = Z.B;
  sandbags(bx - 12, bz - 4, 3, 90);
  sandbags(bx + 12, bz + 5, 3, 90);
  house(bx - 16, bz + 10, 6, 5, 80, 1, 'e');
  house(bx + 15, bz - 12, 6, 5, -100, 1, 'w');
  mudWall([[bx - 22, bz - 12], [bx - 12, bz - 16]]);
  mudWall([[bx + 12, bz + 16], [bx + 22, bz + 12]]);
  for (const [dx, dz] of [[-8, 10], [9, -10]]) props.push({ model: 'barrel_03', pos: [round(bx + dx), 0, round(bz + dz)], rot: [0, round(R() * 360), 0], snap: true });
}

// --- C: outpost fort ---------------------------------------------------------------
{
  const [cx, cz] = Z.C;
  const hw = 22;
  const hd = 20;
  const WALL = '#f6e2c4';
  const corners = [[cx - hw, cz - hd], [cx + hw, cz - hd], [cx + hw, cz + hd], [cx - hw, cz + hd]];
  // Curtain walls with a west gate (the bridge road), a south gate and a breach in the north wall.
  const side = (a, b, gaps) => objects.push(...wallLine([a, b], { height: 4.5, thick: 1.2, material: 'sand', color: WALL, gaps }));
  side(corners[0], corners[1], [[24, 28]]);
  side(corners[1], corners[2], []);
  side(corners[2], corners[3], [[18, 23]]);
  side(corners[3], corners[0], [[17, 22]]);
  // Corner towers.
  for (const [x, z] of corners) obj(block(x, z, 5, 7, 5, { type: 'wall', material: 'sand', color: '#eed6b4' }), 4);
  // Inside: the commander's house, a store shed, broken inner walls, crates.
  addBuilding({ pos: [round(cx + 8), round(cz - 8)], size: [12, 8], style: 'hq', floors: 2, doors: 'sw', rot: 0, material: 'sand', color: ADOBE });
  addBuilding({ pos: [round(cx + 12), round(cz + 10)], size: [10, 7], style: 'warehouse', doors: 'w', rot: 0, material: 'wood', color: '#7a6248' });
  addBuilding({ pos: [round(cx - 10), round(cz - 9)], size: [7, 6], style: 'shop', floors: 1, doors: 's', rot: 0, material: 'sand', color: ADOBE });
  mudWall([[cx - 12, cz + 4], [cx - 4, cz + 4], [cx - 4, cz + 12]], [[3, 4.5]], 2.2, 0.7);
  mudWall([[cx - 2, cz - 2], [cx + 2, cz - 2]], [], 1.3);
  sandbags(cx - 6, cz - 2, 3, 0);
  obj(block(cx - 12, cz + 14, 2.4, 2.8, 6, { yaw: 90, material: 'metal', color: '#8a7a5a', model: 'truck' }), 3.5);
  for (const [dx, dz] of [[2, 4], [4, 5], [-14, -3], [16, -2]]) {
    props.push({ model: R() < 0.5 ? 'wooden_military_crate' : 'old_military_crate', pos: [round(cx + dx), 0, round(cz + dz)], rot: [0, round(R() * 360), 0], snap: true });
  }
  for (const [x, z] of corners) reserve(x, z, 4);
  reserve(cx, cz, 24);
}

// --- Watch post ------------------------------------------------------------------
{
  const [wx, wz] = WATCH;
  obj(block(wx + 4, wz - 2, 3, 7.5, 3, { type: 'wall', material: 'wood', color: '#7a6248', model: 'watchtower' }), 3);
  house(wx - 5, wz + 2, 6, 5, 10, 1, 's');
  // Radio mast.
  obj(block(wx - 9, wz - 4, 0.6, 12, 0.6, { type: 'wall', material: 'metal', color: '#6d6a66' }), 1);
  sandbags(wx + 2, wz + 7, 3, 20);
}

// --- Bases -------------------------------------------------------------------
{
  const [bx, bz] = BLUE;
  obj(block(bx + 4, bz - 8, 5, 3, 4, { type: 'wall', material: 'wood', color: '#c9b791', model: 'tent' }), 3);
  obj(block(bx - 6, bz - 4, 5, 3, 4, { type: 'wall', material: 'wood', color: '#c9b791', model: 'tent' }), 3);
  sandbags(bx + 8, bz + 6, 4, -45);
}
{
  const [rx, rz] = RED;
  obj(block(rx - 4, rz + 8, 5, 3, 4, { type: 'wall', material: 'wood', color: '#c9b791', model: 'tent' }), 3);
  obj(block(rx + 6, rz + 3, 5, 3, 4, { type: 'wall', material: 'wood', color: '#c9b791', model: 'tent' }), 3);
  obj(block(rx + 2, rz - 8, 2.5, 3, 7, { yaw: 60, material: 'metal', color: '#a08c66', model: 'truck' }), 4);
  sandbags(rx - 8, rz - 6, 4, -45);
}

// Small walled fields south of the fort.
{
  const [fx, fz] = P(1010, 770);
  objects.push({ type: 'floor', pos: [fx, 0.02, fz], size: [12, 0.1, 9], rot: [0, 8, 0], material: 'grass', color: '#c9c48a', snap: true });
  mudWall([[fx - 7, fz - 5.5], [fx + 7, fz - 4.5], [fx + 7, fz + 5]], [[6, 8]], 1.1);
  reserve(fx, fz, 7);
}

// --- Rocks ---------------------------------------------------------------------
// Boulders in the canyon and on the slopes, along the wadi.
const rockSpots = [];
for (let i = 0; i < 70 && rockSpots.length < 24; i++) {
  const x = (R() - 0.5) * 180;
  const z = (R() - 0.5) * 140;
  if (!inMap(x, z, 2) || nearRoad(x, z, 1.5) || nearRiver(x, z, 0.5) || !free(x, z, 3)) continue;
  if (Object.values(Z).some(([zx, zz]) => Math.hypot(x - zx, z - zz) < 16)) continue;
  rockSpots.push([x, z]);
  props.push({ model: R() < 0.5 ? 'rock_moss_set_01' : 'rock_moss_set_02', pos: [round(x), -0.3, round(z)], rot: [0, round(R() * 360), 0], scale: round(0.6 + R() * 0.5), snap: true });
  reserve(x, z, 3);
}

// --- Palms -----------------------------------------------------------------------
const trees = [];
const palm = (x, z, s = 0.55 + R() * 0.2) => {
  if (!inMap(x, z, 1.5) || nearRoad(x, z, 1.2) || nearRiver(x, z, 0.3) || !free(x, z, 1.2)) return;
  trees.push([round(x, 1), round(z, 1), round(s)]);
  reserve(x, z, 1.2);
};
// Oasis groves along the wadi, thickest by the bridge.
for (let i = 0; i < 600; i++) {
  const p = river.pts[Math.floor(R() * river.pts.length)];
  const [tx, tz] = riverDir(p[0], p[1]);
  const side = R() < 0.5 ? -1 : 1;
  const off = RIVER_CLEAR + 0.8 + R() * 7;
  const near = Math.hypot(p[0] - Z.B[0], p[1] - Z.B[1]);
  if (R() > (near < 30 ? 0.7 : 0.3)) continue;
  palm(p[0] - tz * off * side, p[1] + tx * off * side);
}
// A few in and around the village and by the bases.
for (let i = 0; i < 40; i++) {
  const [cx, cz] = R() < 0.6 ? Z.A : R() < 0.5 ? Z.C : R() < 0.5 ? BLUE : RED;
  const a = R() * Math.PI * 2;
  const r = 10 + R() * 26;
  palm(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
}

// --- Spawns & zones ----------------------------------------------------------
const spawns = [];
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2;
  spawns.push({ team: 'blue', pos: [round(BLUE[0] + Math.cos(a) * 3), 0.1, round(BLUE[1] + Math.sin(a) * 3)], yaw: 120 });
  spawns.push({ team: 'red', pos: [round(RED[0] + Math.cos(a) * 3), 0.1, round(RED[1] + Math.sin(a) * 3)], yaw: -60 });
}
const zones = [
  { id: 'A', pos: [Z.A[0], 0, Z.A[1]], radius: 12 },
  { id: 'B', pos: [Z.B[0], 0, Z.B[1]], radius: 10 },
  { id: 'C', pos: [Z.C[0], 0, Z.C[1]], radius: 12 },
];

let area = 0;
for (let i = 0; i < boundary.length; i++) {
  const [x1, z1] = boundary[i];
  const [x2, z2] = boundary[(i + 1) % boundary.length];
  area += x1 * z2 - x2 * z1;
}
area = Math.abs(area / 2);
const xs = boundary.map((p) => p[0]);
const zs = boundary.map((p) => p[1]);
const margin = 60;
const halfX = Math.max(-Math.min(...xs), Math.max(...xs)) + margin;
const halfZ = Math.max(-Math.min(...zs), Math.max(...zs)) + margin;

const map = {
  meta: { id: 'persia', name: '페르시아 침공', version: 2 },
  world: {
    size: [Math.ceil(halfX * 2), Math.ceil(halfZ * 2)],
    visualProfile: 'desert',
    groundMaterial: 'sand',
    flora: 'palm',
    vehicles: 'light',
    ambience: { birds: 0.05 },
    boundary,
    terrain,
  },
  spawns,
  zones,
  objects,
  buildings,
  props,
  trees,
};
writeFileSync(new URL('../../public/maps/persia.json', import.meta.url), JSON.stringify(map));
console.log(`persia: ${objects.length} objects, ${buildings.length} buildings, ${props.length} props, ${trees.length} trees, area ${Math.round(area)} m², size ${map.world.size}`);
