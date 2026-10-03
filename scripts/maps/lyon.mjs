// Generates public/maps/lyon.json — "리옹 초원 전선" (Lyon Meadow Front), summer.
// 3-zone Zone map for about 10v10, ~420 x 320 m (layout from the owner's sketch).
// Blue comes from the north, red from the south. A creek runs west-east across
// the southern half (knee deep, three bridges), so red has to cross it to reach
// the zones: A the farm in the middle, B the barn and silo in the west, C the
// orchard in the east. A rocky ridge in the south-east looks over the creek.
import { writeFileSync } from 'node:fs';
import { block, edgeDist, inside, lineDist, rng, round, smoothClosed, smoothOpen, stripAlong, wallLine } from './lib.mjs';

const R = rng(20261002);
const objects = [];
const buildings = [];
const props = [];

/** Sketch pixels (1448 x 1086 image) to metres; x east, z south. */
const S = 0.345;
const P = (px, py) => [round((px - 727) * S, 1), round((py - 580) * S, 1)];
const Ps = (list) => list.map(([x, y]) => P(x, y));

// --- Outline -----------------------------------------------------------------
const boundary = smoothClosed(
  Ps([
    [40, 600], [70, 470], [125, 335], [210, 250], [330, 200], [470, 175], [600, 130], [700, 98], [860, 92], [1000, 100],
    [1140, 135], [1290, 180], [1385, 265], [1422, 400], [1420, 560], [1400, 760], [1335, 935], [1200, 1005], [1010, 1045],
    [820, 1062], [600, 1052], [400, 1038], [250, 990], [125, 905], [55, 770],
  ]),
  2,
).map(([x, z]) => [round(x, 1), round(z, 1)]);
const inMap = (x, z, pad = 0) => inside(boundary, x, z) && edgeDist(boundary, x, z) > pad;

// --- Creek ---------------------------------------------------------------------
const river = {
  pts: smoothOpen(Ps([[-150, 560], [40, 605], [200, 690], [365, 742], [520, 702], [650, 686], [765, 668], [940, 625], [1105, 612], [1250, 560], [1420, 505], [1600, 470]]), 3).map(([x, z]) => [round(x, 1), round(z, 1)]),
  width: 8,
  depth: 1.9,
  bank: 5,
  water: 0.55,
};
const RIVER_CLEAR = river.width / 2 + river.bank;
const nearRiver = (x, z, pad) => lineDist(x, z, river.pts) < RIVER_CLEAR + pad;
/** Unit tangent of the creek near (x, z). */
function riverDir(x, z) {
  let best = Infinity;
  let dir = [1, 0];
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
/** Nearest point on the creek's centre line. */
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
    const qx = ax + dx * t;
    const qz = az + dz * t;
    const d = Math.hypot(qx - x, qz - z);
    if (d < best) {
      best = d;
      out = [qx, qz];
    }
  }
  return out.map((v) => round(v, 1));
}

// --- Zones and bases -------------------------------------------------------------
const Z = {
  A: P(770, 500), // central farm (pulled south of the sketch so both sides have a similar walk)
  B: P(330, 545), // barn and silo
  C: P(1215, 480), // orchard
};
const BLUE = P(805, 165);
const RED = P(745, 900);
const RIDGE = P(1235, 820);

// Bridges cross the creek square to its flow.
const bridges = [
  { at: onRiver(...P(365, 742)), len: 22, w: 4.5, kind: 'stone' },
  { at: onRiver(...P(765, 668)), len: 24, w: 7, kind: 'arch' },
  { at: onRiver(...P(1105, 612)), len: 20, w: 3, kind: 'wood' },
].map((b) => {
  const [tx, tz] = riverDir(b.at[0], b.at[1]);
  // Crossing direction (across the flow) and its yaw (map yaw: 0 faces -z).
  const [cx, cz] = [-tz, tx];
  return { ...b, x: b.at[0], z: b.at[1], cx, cz, yaw: round((Math.atan2(cx, cz) * 180) / Math.PI, 1) };
});
river.crossings = bridges.map((b) => [b.x, b.z]);

// --- Terrain -----------------------------------------------------------------
const flats = [
  { pos: Z.A, radius: 30, blend: 12 },
  { pos: Z.B, radius: 24, blend: 10 },
  { pos: Z.C, radius: 18, blend: 12 },
  { pos: BLUE, radius: 22, blend: 10 },
  { pos: RED, radius: 22, blend: 10 },
];
for (const b of bridges) {
  b.deck = b.kind === 'arch' ? 0.9 : 0.25;
  for (const s of [-1, 1]) flats.push({ pos: [round(b.x + s * b.cx * (b.len / 2 - 2.5)), round(b.z + s * b.cz * (b.len / 2 - 2.5))], radius: 6, height: round(b.deck - 0.1), blend: 10 });
}
const terrain = {
  cell: 2,
  noise: 0.8,
  hills: [
    { pos: RIDGE, radius: 55, height: 10 }, // the ridge
    { pos: P(1330, 880), radius: 40, height: 6 },
    { pos: P(1120, 900), radius: 35, height: 4 },
    { pos: P(500, 330), radius: 70, height: 3 },
    { pos: P(1050, 300), radius: 60, height: 2.5 },
    { pos: P(200, 850), radius: 60, height: 3 },
    { pos: P(560, 860), radius: 50, height: 2 },
    { pos: P(1350, 300), radius: 45, height: 3 },
  ],
  flats,
  rivers: [river],
};

// --- Roads -------------------------------------------------------------------
const DIRT = '#b39a78';
const at = (b, s) => [round(b.x + s * b.cx * (b.len / 2 + 1)), round(b.z + s * b.cz * (b.len / 2 + 1))];
const [bW, bC, bE] = bridges;
const roads = [
  // Main north-south lane: blue base -> farm -> creek bridge -> red base.
  { pts: smoothOpen([BLUE, P(800, 260), P(785, 330), Z.A, P(765, 520), P(766, 600), at(bC, -1)]), w: 6 },
  { pts: smoothOpen([at(bC, 1), P(760, 780), P(752, 860), RED]), w: 6 },
  // Northern arc.
  { pts: smoothOpen([P(170, 430), P(260, 330), P(420, 250), P(600, 222), P(800, 215), P(1000, 228), P(1150, 272), P(1300, 340), P(1360, 420)]), w: 5 },
  // Farm to barn, farm to orchard.
  { pts: smoothOpen([Z.A, P(640, 470), P(480, 505), Z.B]), w: 5 },
  { pts: smoothOpen([Z.A, P(900, 420), P(1050, 430), Z.C]), w: 5 },
  // West: northern arc -> barn -> west bridge -> south.
  { pts: smoothOpen([P(260, 330), P(300, 450), Z.B, P(355, 650), at(bW, -1)]), w: 5 },
  { pts: smoothOpen([at(bW, 1), P(420, 830), P(560, 880), P(660, 900), RED]), w: 5 },
  // East: orchard -> east bridge -> ridge foot -> red base.
  { pts: smoothOpen([Z.C, P(1180, 500), P(1130, 560), at(bE, -1)]), w: 4 },
  { pts: smoothOpen([at(bE, 1), P(1080, 700), P(980, 790), P(860, 860), RED]), w: 4 },
  { pts: smoothOpen([P(1080, 700), P(1170, 760), RIDGE]), w: 3.5 },
];
for (const r of roads) {
  const strips = stripAlong(r.pts, r.w, { color: DIRT, material: 'sand', y: 0.04 });
  objects.push(...strips.filter((s) => !nearRiver(s.pos[0], s.pos[2], 0.5) && inMap(s.pos[0], s.pos[2], -4)));
}
const nearRoad = (x, z, pad) => roads.some((r) => lineDist(x, z, r.pts) < r.w / 2 + pad);

// --- Bridges -------------------------------------------------------------------
const STONE = '#a59d8c';
for (const b of bridges) {
  if (b.kind === 'arch') {
    // Stone arch: the model's parapets stand 1.25 m above its deck; footings below the bed.
    const bottom = -3;
    const top = b.deck + 1.25;
    objects.push({ type: 'wall', pos: [b.x, round((top + bottom) / 2), b.z], size: [b.w, round(top - bottom), b.len], rot: [0, b.yaw, 0], material: 'concrete', color: STONE, model: 'archBridge', base: 0 });
    continue;
  }
  // Flat deck (local z along the crossing), low parapets / hand rails, piers.
  const wood = b.kind === 'wood';
  const thick = wood ? 0.25 : 0.6;
  const material = wood ? 'wood' : 'concrete';
  const color = wood ? '#6e5a44' : STONE;
  const sx = b.cz;
  const sz = -b.cx;
  objects.push({ type: 'floor', pos: [b.x, round(b.deck - thick / 2), b.z], size: [b.w, thick, b.len], rot: [0, b.yaw, 0], material, color });
  for (const s of [-1, 1]) {
    const rail = wood ? 0.12 : 0.45;
    const off = b.w / 2 - rail / 2;
    objects.push({ type: 'wall', pos: [round(b.x + sx * s * off), round(b.deck + 0.5), round(b.z + sz * s * off)], size: [rail, 1, b.len], rot: [0, b.yaw, 0], material, color });
  }
  for (const u of [-3.5, 3.5]) {
    objects.push({ type: 'wall', pos: [round(b.x + b.cx * u), round((b.deck - thick - 2.6) / 2), round(b.z + b.cz * u)], size: [b.w + 0.4, round(2.6 + thick), wood ? 0.5 : 1.6], rot: [0, b.yaw, 0], material, color });
  }
}

// --- Placement bookkeeping -------------------------------------------------------
const placed = [];
const reserve = (x, z, r) => placed.push({ x, z, r });
const free = (x, z, r) => placed.every((p) => Math.hypot(x - p.x, z - p.z) > p.r + r);
const addBuilding = (b) => {
  buildings.push(b);
  reserve(b.pos[0], b.pos[1], Math.hypot(b.size[0], b.size[1]) / 2 + 1);
};
const obj = (o, r = 2) => {
  objects.push(o);
  reserve(o.pos[0], o.pos[2], r);
};
const hay = (x, z, yaw) => obj(block(x, z, 2.6, 1.5, 1.5, { yaw, material: 'wood', color: '#c2a35e', model: 'hayBale' }), 2);
const sandbags = (x, z, len, yaw) => obj(block(x, z, len, 1.1, 0.9, { yaw, material: 'ground', color: '#9c8f76', model: 'sandbags' }), len / 2 + 0.5);
const stoneWall = (pts, gaps = [], height = 1.1) => {
  const pieces = wallLine(densify(pts, 4), { height, thick: 0.55, material: 'concrete', color: '#b8a98c', type: 'cover', gaps });
  for (const p of pieces) if (!nearRiver(p.pos[0], p.pos[2], 0.5) && !nearRoad(p.pos[0], p.pos[2], 0.5)) objects.push(p);
};
/** Extra points along a polyline so no piece is longer than `step`. */
function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}
for (const b of bridges) reserve(b.x, b.z, b.len / 2 + 2);

// --- Fields --------------------------------------------------------------------
// Wheat / hay / ploughed patches (ground paint), edged by stone walls or hedges.
// [material, tint]: ripe wheat, stubble, ploughed earth, young crop.
const FIELD_COLORS = [['sand', '#e6c46a'], ['sand', '#d9c27e'], ['ground', '#c9a27c'], ['sand', '#e8cf80'], ['grass', '#d6e08e']];
const fields = [
  [P(250, 300), 34, 24, 15],
  [P(450, 360), 30, 22, -10],
  [P(1180, 230), 32, 18, 12],
  [P(1340, 300), 22, 20, 30],
  [P(1330, 640), 30, 18, -20], // vineyard
  [P(140, 820), 30, 26, 30],
  [P(330, 900), 36, 24, -15],
  [P(650, 760), 26, 20, 10],
  [P(970, 710), 22, 18, -25],
  [P(580, 610), 20, 16, 5],
  [P(980, 330), 24, 18, -5],
];
const fieldRects = [];
for (const [[x, z], w, d, yaw] of fields) {
  if (!inMap(x, z, 8)) continue;
  const [material, color] = FIELD_COLORS[Math.floor(R() * FIELD_COLORS.length)];
  objects.push({ type: 'floor', pos: [x, 0.02, z], size: [w, 0.1, d], rot: [0, yaw, 0], material, color, snap: true });
  fieldRects.push({ x, z, w, d, yaw });
  // A low stone wall along two sides, with a gap for a lane.
  const c = Math.cos((yaw * Math.PI) / 180);
  const s = Math.sin((yaw * Math.PI) / 180);
  const pt = (u, v) => [x + u * c + v * s, z - u * s + v * c];
  if (R() < 0.7) stoneWall([pt(-w / 2 - 1, -d / 2 - 1), pt(w / 2 + 1, -d / 2 - 1), pt(w / 2 + 1, d / 2 + 1)], [[w * 0.4, w * 0.4 + 4]]);
}
const inField = (x, z, pad = 0) =>
  fieldRects.some((f) => {
    const c = Math.cos((f.yaw * Math.PI) / 180);
    const s = Math.sin((f.yaw * Math.PI) / 180);
    const dx = x - f.x;
    const dz = z - f.z;
    const u = dx * c - dz * s;
    const v = dx * s + dz * c;
    return Math.abs(u) < f.w / 2 + pad && Math.abs(v) < f.d / 2 + pad;
  });

// --- A: central farm -------------------------------------------------------------
{
  const [ax, az] = Z.A;
  addBuilding({ pos: [ax - 18, az - 16], size: [13, 9], style: 'house', floors: 2, doors: 'se', rot: 4, material: 'concrete', color: '#b3a68f' });
  addBuilding({ pos: [ax + 20, az - 14], size: [16, 10], style: 'barn', doors: 'ew', rot: -6 });
  addBuilding({ pos: [ax - 22, az + 12], size: [11, 8], style: 'house', floors: 1, doors: 'ne', rot: -8, material: 'concrete', color: '#a99c86' });
  addBuilding({ pos: [ax + 22, az + 15], size: [10, 8], style: 'house', floors: 2, doors: 'nw', rot: 10, material: 'concrete', color: '#bcae95' });
  addBuilding({ pos: [ax + 2, az - 30], size: [9, 7], style: 'shed', doors: 's', rot: 0 });
  addBuilding({ pos: [ax + 8, az + 32], size: [9, 7], style: 'shed', doors: 'ns', rot: 5 });
  // Ruined outbuilding: broken walls round an open floor.
  objects.push(...wallLine([[ax - 6, az + 20], [ax - 14, az + 20], [ax - 14, az + 27]], { height: 2.2, thick: 0.5, material: 'concrete', color: '#9d9483', gaps: [[4, 5.5]] }));
  // Farmyard wall with gates on the lanes.
  const yard = [[ax - 34, az - 30], [ax + 34, az - 30], [ax + 36, az + 30], [ax - 34, az + 32], [ax - 34, az - 30]];
  stoneWall(yard, [[30, 38], [96, 104], [160, 168], [228, 236]], 1.3);
  for (const [dx, dz, yaw] of [[-6, -6, 10], [8, 6, 80], [-4, 10, 30]]) hay(ax + dx, az + dz, yaw);
  obj(block(ax + 4, az - 8, 2.4, 2.6, 5, { yaw: 30, material: 'metal', color: '#5b4a3a', model: 'truck' }), 3);
  obj(block(ax - 8, az + 2, 1.6, 1.4, 1.6, { material: 'concrete', color: '#8f8a80', model: 'pump' }), 1.5);
  sandbags(ax + 10, az - 2, 4, 90);
  sandbags(ax - 12, az - 4, 3, 0);
}

// --- B: barn and silo ----------------------------------------------------------
{
  const [bx, bz] = Z.B;
  addBuilding({ pos: [bx - 22, bz + 12], size: [24, 14], style: 'barn', doors: 'ew', rot: 80 });
  obj(block(bx - 17, bz - 8, 6, 15, 6, { type: 'wall', material: 'concrete', color: '#b9b4a8', model: 'silo', sink: 0.1 }), 4);
  addBuilding({ pos: [bx + 10, bz - 18], size: [11, 8], style: 'house', floors: 2, doors: 'sw', rot: 15, material: 'concrete', color: '#c2b49a' });
  addBuilding({ pos: [bx + 18, bz + 14], size: [8, 6], style: 'shed', doors: 'w', rot: -10 });
  for (const [dx, dz, yaw] of [[0, 0, 0], [4, 6, 30], [-4, -2, 80], [12, 2, 10], [6, 16, 60], [16, -4, 45]]) hay(bx + dx, bz + dz, yaw);
  obj(block(bx + 2, bz - 10, 2.4, 2.6, 5, { yaw: -20, material: 'metal', color: '#7b3a2a', model: 'truck' }), 3);
  const pad = [[bx + 24, bz - 4], [bx + 36, bz - 2], [bx + 36, bz + 16], [bx + 26, bz + 18]];
  objects.push(...wallLine([...pad, pad[0]], { height: 1.1, thick: 0.3, material: 'wood', color: '#6e5a44', type: 'cover', model: 'fence', gaps: [[6, 9]] }));
}

// --- C: orchard ------------------------------------------------------------------
const orchard = [];
{
  const [cx, cz] = Z.C;
  addBuilding({ pos: [cx - 28, cz + 26], size: [9, 7], style: 'house', floors: 1, doors: 'n', rot: 20, material: 'concrete', color: '#c4b8a0' });
  addBuilding({ pos: [cx + 34, cz + 4], size: [10, 7], style: 'house', floors: 2, doors: 'w', rot: -30, material: 'concrete', color: '#b8aa90' });
  addBuilding({ pos: [cx - 6, cz - 26], size: [7, 6], style: 'shed', doors: 's', rot: 8 });
  for (const [dx, dz, yaw] of [[3, 4, 20], [-5, -3, 70]]) hay(cx + dx, cz + dz, yaw);
  sandbags(cx + 6, cz - 6, 4, 30);
  // Rows of fruit trees, a few gaps, low stone walls between plots.
  for (let i = -6; i <= 6; i++) {
    for (let j = -4; j <= 4; j++) {
      const x = cx + i * 7 + (j % 2) * 2 + (R() - 0.5) * 1.2;
      const z = cz + j * 7.5 + (R() - 0.5) * 1.2;
      if (Math.hypot(x - cx, z - cz) < 9 || R() < 0.12) continue;
      if (!inMap(x, z, 3) || nearRoad(x, z, 1.5) || nearRiver(x, z, 2) || !free(x, z, 1.5)) continue;
      orchard.push([round(x, 1), round(z, 1), round(0.3 + R() * 0.07)]);
    }
  }
  stoneWall([[cx - 46, cz - 34], [cx - 46, cz + 12]], [[20, 24]]);
  stoneWall([[cx + 10, cz - 36], [cx + 46, cz - 36]]);
  stoneWall([[cx - 10, cz + 36], [cx + 30, cz + 36]], [[16, 20]]);
}

// --- Ridge -----------------------------------------------------------------------
{
  const [rx, rz] = RIDGE;
  // A watch post on the crest: the old stone tower and a shepherd's hut.
  obj(block(rx, rz, 5, 14, 5, { type: 'wall', material: 'brick', color: '#958b7c', model: 'steeple', sink: 0.3 }), 4);
  addBuilding({ pos: [rx + 16, rz - 30], size: [9, 7], style: 'house', floors: 1, doors: 'w', rot: -15, material: 'concrete', color: '#a39886' });
  addBuilding({ pos: [rx + 26, rz - 24], size: [7, 6], style: 'shed', doors: 'w', rot: -15 });
  sandbags(rx - 6, rz - 6, 4, -40);
  sandbags(rx + 6, rz - 7, 4, 40);
  // Rocks across the slope.
  for (let i = 0; i < 9; i++) {
    const a = R() * Math.PI * 2;
    const r = 10 + R() * 34;
    const x = rx + Math.cos(a) * r;
    const z = rz + Math.sin(a) * r * 0.8;
    if (!inMap(x, z, 3) || nearRoad(x, z, 1.5) || !free(x, z, 2)) continue;
    props.push({ model: R() < 0.5 ? 'rock_moss_set_01' : 'rock_moss_set_02', pos: [round(x), -0.2, round(z)], rot: [0, round(R() * 360), 0], scale: round(0.9 + R() * 0.6), snap: true });
    reserve(x, z, 4);
  }
}
// Boulders along the creek banks.
for (let i = 0; i < 12; i++) {
  const p = river.pts[Math.floor(R() * river.pts.length)];
  const [tx, tz] = riverDir(p[0], p[1]);
  const side = R() < 0.5 ? -1 : 1;
  const off = RIVER_CLEAR + 0.5 + R() * 3;
  const x = p[0] - tz * off * side;
  const z = p[1] + tx * off * side;
  if (!inMap(x, z, 3) || nearRoad(x, z, 2) || !free(x, z, 1.5)) continue;
  props.push({ model: R() < 0.5 ? 'rock_moss_set_01' : 'rock_moss_set_02', pos: [round(x), -0.2, round(z)], rot: [0, round(R() * 360), 0], scale: round(0.5 + R() * 0.4), snap: true });
  reserve(x, z, 3);
}

// --- Bases -------------------------------------------------------------------
{
  // North: a row of farm buildings the column has taken over, tents, vehicles.
  const [bx, bz] = BLUE;
  for (const [dx, dz, w, d, style] of [[-34, 6, 10, 7, 'shed'], [-16, -6, 12, 8, 'barracks'], [22, -6, 12, 8, 'barracks'], [38, 6, 10, 7, 'shed']]) {
    addBuilding({ pos: [bx + dx, bz + dz], size: [w, d], style, doors: 's', rot: 0 });
  }
  for (let i = 0; i < 3; i++) obj(block(bx - 10 + i * 9, bz + 16, 5, 3, 4, { type: 'wall', material: 'wood', color: '#c9c8b8', model: 'tent' }), 3);
  for (const [dx, dz, yaw] of [[18, 22, 0], [-18, 22, 0]]) sandbags(bx + dx, bz + dz, 5, yaw);
}
{
  const [rx, rz] = RED;
  for (const [dx, dz, w, d, style] of [[-38, -4, 12, 8, 'house'], [-18, 8, 12, 8, 'barracks'], [20, 8, 12, 8, 'barracks'], [38, -6, 10, 7, 'shed'], [-30, 20, 9, 7, 'shed']]) {
    addBuilding({ pos: [rx + dx, rz + dz], size: [w, d], style, doors: 'n', rot: 0, ...(style === 'house' ? { material: 'concrete', color: '#b5a68e' } : {}) });
  }
  for (let i = 0; i < 3; i++) obj(block(rx - 10 + i * 9, rz - 16, 5, 3, 4, { type: 'wall', material: 'wood', color: '#c9c8b8', model: 'tent' }), 3);
  for (const [dx, dz, yaw] of [[18, -22, 0], [-18, -22, 0]]) sandbags(rx + dx, rz + dz, 5, yaw);
}

// --- Second pass (2026-10-02, owner: "a bit dull") --------------------------------------
// A front line along the creek's north bank (blue dug in at each bridgehead),
// tanks knocked out crossing the southern fields, a watermill by the east bridge,
// a hamlet with an inn on the northern road, carts at the farms.
const spot = (x, z, r, roadPad = 1.5) => inMap(x, z, 3) && !nearRoad(x, z, roadPad) && !nearRiver(x, z, 1) && free(x, z, r);
/** The free spot nearest (x, z) within `reach`, or null. */
const near = (x, z, r, reach = 12, roadPad = 1.5) => {
  for (let d = 0; d <= reach; d += 1.5) {
    const n = Math.max(1, Math.round(d * 2));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      if (spot(x + Math.cos(a) * d, z + Math.sin(a) * d, r, roadPad)) return [x + Math.cos(a) * d, z + Math.sin(a) * d];
    }
  }
  return null;
};
const wreck = (x, z, yaw) => {
  const p = near(x, z, 4.2);
  if (p) obj(block(p[0], p[1], 3.6, 2.6, 7.4, { yaw, material: 'metal', color: '#4f5640', model: 'tankWreck' }), 4.2);
};
const cart = (x, z, yaw) => {
  const p = near(x, z, 2.2, 8, 0.8);
  if (p) obj(block(p[0], p[1], 1.8, 1.7, 4.2, { yaw, material: 'wood', color: '#7a5a3c', model: 'cart' }), 2.2);
};
// Bridgehead positions on the north bank: sandbag arcs either side of the road, facing south.
for (const b of bridges) {
  const north = b.cz < 0 ? 1 : -1; // the crossing direction that points north (-z)
  const [hx, hz] = [b.x - north * b.cx * (b.len / 2 + 9), b.z - north * b.cz * (b.len / 2 + 9)];
  const [tx, tz] = riverDir(b.x, b.z);
  const yaw = (Math.atan2(-tx, -tz) * 180) / Math.PI + 90;
  for (const side of [-1, 1]) {
    const p = near(hx + tx * side * 9, hz + tz * side * 9, 2.5, 6, 1);
    if (p) sandbags(p[0], p[1], 4, yaw);
    const q = near(hx + tx * side * 17, hz + tz * side * 17, 2.5, 6, 1);
    if (q) sandbags(q[0], q[1], 3, yaw + side * 25);
  }
}
// Tanks that didn't make it across, and one that did.
wreck(...P(700, 790), 20);
wreck(...P(980, 760), -35);
wreck(...P(460, 700), 60);
wreck(...P(860, 420), 160);
// Carts at the farms.
for (const [dx, dz, yaw] of [[14, 8, 30], [-10, 18, 110]]) cart(Z.A[0] + dx, Z.A[1] + dz, yaw);
for (const [dx, dz, yaw] of [[8, 10, 70], [-6, -14, 10]]) cart(Z.B[0] + dx, Z.B[1] + dz, yaw);
cart(Z.C[0] - 14, Z.C[1] + 10, 45);
// Watermill on the north bank between the middle and east bridges, its wheel on the river side.
{
  const [rx, rz] = onRiver(...P(940, 625));
  const [tx, tz] = riverDir(rx, rz);
  const n = tz > 0 ? [tz, -tx] : [-tz, tx]; // the bank-normal that points north (-z)
  const off = RIVER_CLEAR + 5.5;
  const [mx, mz] = [rx + n[0] * off, rz + n[1] * off];
  const rot = round((Math.atan2(-tz, tx) * 180) / Math.PI, 1);
  if (free(mx, mz, 6)) {
    addBuilding({ pos: [round(mx), round(mz)], size: [12, 9], style: 'mill', floors: 2, doors: 'ew', rot, material: 'concrete', color: '#b1a48e' });
    // The wheel against the river-side wall: kit -x side to the wall, so its +x points at the river.
    const [wx, wz] = [mx - n[0] * (4.5 + 0.8), mz - n[1] * (4.5 + 0.8)];
    const wyaw = round((Math.atan2(n[1], -n[0]) * 180) / Math.PI, 1);
    objects.push(block(wx, wz, 1.4, 6, 6, { yaw: wyaw, type: 'wall', material: 'wood', color: '#5e4a36', model: 'millWheel', sink: 1.2 }));
    hay(mx + tx * 9, mz + tz * 9, 20);
    cart(mx - tx * 9 + n[0] * 3, mz - tz * 9 + n[1] * 3, rot + 90);
  }
}
// Hamlet on the northern road between the farm and the orchard: an inn at the crossroads, two houses, a well.
{
  const [hx, hz] = P(1000, 262);
  const homes = [
    [0, 0, 16, 10, 'inn', 2, 'sw', 0],
    [-20, 6, 9, 8, 'house', 2, 'e', 12],
    [18, 10, 9, 8, 'house', 1, 'w', -10],
  ];
  for (const [dx, dz, w, d, style, floors, doors, rot] of homes) {
    const x = hx + dx;
    const z = hz + dz;
    if (!inMap(x, z, 6) || nearRoad(x, z, Math.min(w, d) / 2 + 1) || !free(x, z, Math.hypot(w, d) / 2)) continue;
    addBuilding({ pos: [round(x), round(z)], size: [w, d], style, floors, doors, rot, ...(style === 'house' || style === 'inn' ? { material: 'concrete', color: '#bfb196' } : {}) });
  }
  const wp = near(hx - 6, hz + 14, 1.2, 6, 1);
  if (wp) obj(block(wp[0], wp[1], 1.6, 1.4, 1.6, { material: 'concrete', color: '#8f8a80', model: 'pump' }), 1.5);
  cart(hx + 10, hz - 4, 80);
  stoneWall([[hx - 30, hz + 22], [hx - 8, hz + 26], [hx + 14, hz + 28]], [[10, 13]]);
}

// Crates and barrels around the zones.
const crateModels = ['wooden_military_crate', 'old_military_crate', 'barrel_03', 'ammo_box'];
for (const [zx, zz] of Object.values(Z)) {
  for (let i = 0; i < 6; i++) {
    const a = R() * Math.PI * 2;
    const r = 5 + R() * 10;
    const x = zx + Math.cos(a) * r;
    const z = zz + Math.sin(a) * r;
    if (nearRoad(x, z, 1) || nearRiver(x, z, 1) || !free(x, z, 1)) continue;
    props.push({ model: crateModels[Math.floor(R() * crateModels.length)], pos: [round(x), 0, round(z)], rot: [0, round(R() * 360), 0], snap: true });
    reserve(x, z, 1);
  }
}

// --- Trees -------------------------------------------------------------------
// Smooth value noise for copses and hedgerows.
const hash = (i, j) => {
  let h = (i * 374761393 + j * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const vnoise = (x, z) => {
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * sx;
  const b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * sx;
  return a + (b - a) * sz;
};
const woods = (x, z) => 0.6 * vnoise(x / 45, z / 45) + 0.4 * vnoise(x / 17 + 11, z / 17 - 7);
const zoneClear = (x, z) => Object.values(Z).some(([zx, zz]) => Math.hypot(x - zx, z - zz) < 30);
const trees = [...orchard];
const STEP = 5;
for (let gx = -240; gx <= 240; gx += STEP) {
  for (let gz = -170; gz <= 170; gz += STEP) {
    const x = gx + (R() - 0.5) * STEP * 0.9;
    const z = gz + (R() - 0.5) * STEP * 0.9;
    if (!inMap(x, z, 1.5)) continue;
    const edge = edgeDist(boundary, x, z);
    // Copses and tree lines in the meadows, a thick belt along the edge, the creek lined with trees.
    const w = woods(x, z);
    let p = w > 0.6 ? 0.6 : w > 0.54 ? 0.16 : 0.02;
    if (edge < 16) p = Math.max(p, 0.5 - edge / 32);
    const creek = lineDist(x, z, river.pts) - RIVER_CLEAR;
    if (creek > 1 && creek < 7) p = Math.max(p, 0.22);
    if (R() > p) continue;
    if (zoneClear(x, z) || nearRoad(x, z, 2.5) || nearRiver(x, z, 1.5) || inField(x, z, 1) || !free(x, z, 1.5)) continue;
    if (Math.hypot(x - BLUE[0], z - BLUE[1]) < 40 || Math.hypot(x - RED[0], z - RED[1]) < 40) continue;
    trees.push([round(x, 1), round(z, 1), round(0.5 + R() * 0.3)]);
  }
}

// --- Spawns & zones ----------------------------------------------------------
const spawns = [];
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  spawns.push({ team: 'blue', pos: [round(BLUE[0] + Math.cos(a) * 6), 0.1, round(BLUE[1] + 4 + Math.sin(a) * 4)], yaw: 180 });
  spawns.push({ team: 'red', pos: [round(RED[0] + Math.cos(a) * 6), 0.1, round(RED[1] - 4 + Math.sin(a) * 4)], yaw: 0 });
}
const zones = [
  // About 1.5x the first pass (owner, 2026-10-02: bigger zones).
  { id: 'A', pos: [Z.A[0], 0, Z.A[1]], radius: 30 },
  { id: 'B', pos: [Z.B[0], 0, Z.B[1]], radius: 27 },
  { id: 'C', pos: [Z.C[0], 0, Z.C[1]], radius: 27 },
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
const margin = 70;
const halfX = Math.max(-Math.min(...xs), Math.max(...xs)) + margin;
const halfZ = Math.max(-Math.min(...zs), Math.max(...zs)) + margin;

const map = {
  meta: { id: 'lyon', name: '리옹 초원 전선', version: 2 },
  world: {
    size: [Math.ceil(halfX * 2), Math.ceil(halfZ * 2)],
    visualProfile: 'outdoor_day',
    groundMaterial: 'grass',
    flora: 'broadleaf',
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
writeFileSync(new URL('../../public/maps/lyon.json', import.meta.url), JSON.stringify(map));
console.log(`lyon: ${objects.length} objects, ${buildings.length} buildings, ${props.length} props, ${trees.length} trees, area ${Math.round(area)} m², size ${map.world.size}`);
