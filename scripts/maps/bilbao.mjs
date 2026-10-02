// Generates public/maps/bilbao.json — "빌바오 공방전" (Bilbao Siege Sector), city.
// Built for the Conquest mode (not made yet; until then it plays as a Zone map).
// ~260 x 180 m of dense streets (layout from the owner's sketch): the defenders
// (blue) come in from the north-west, the attackers (red) from the east. A the
// warehouse yard with its gantry crane and rail sidings in the east, B the tank
// square with the fountain and a knocked-out tank in the middle, C the cathedral
// in its walled close in the west; an alley quarter to the north, a gun battery
// on a hill in the far west, and the river with its quay and stone bridge along
// the south.
import { writeFileSync } from 'node:fs';
import { block, edgeDist, inside, lineDist, rng, round, smoothClosed, smoothOpen, stripAlong, wallLine } from './lib.mjs';

const R = rng(20261004);
const objects = [];
const buildings = [];
const props = [];

/** Sketch pixels (1448 x 1086 image) to metres; x east, z south. */
const S = 0.205;
const P = (px, py) => [round((px - 745) * S, 1), round((py - 600) * S, 1)];
const Ps = (list) => list.map(([x, y]) => P(x, y));

// --- Outline -----------------------------------------------------------------
const boundary = smoothClosed(
  Ps([
    [75, 260], [110, 190], [250, 160], [420, 175], [600, 160], [800, 165], [1000, 180], [1200, 175], [1330, 210],
    [1410, 300], [1420, 480], [1400, 620], [1420, 780], [1390, 900], [1300, 990], [1150, 1020], [950, 1035], [750, 1040],
    [550, 1035], [350, 1020], [190, 990], [90, 900], [70, 760], [55, 560], [65, 400],
  ]),
  2,
).map(([x, z]) => [round(x, 1), round(z, 1)]);
const inMap = (x, z, pad = 0) => inside(boundary, x, z) && edgeDist(boundary, x, z) > pad;

// --- River and quay -------------------------------------------------------------
// A wide, deep-looking river along the south: the quay wall stops people on foot
// (only the bridge goes over it; the far bank is outside the map).
const river = {
  pts: smoothOpen(Ps([[-200, 905], [80, 900], [300, 915], [520, 925], [745, 930], [980, 940], [1200, 935], [1450, 920], [1700, 915]]), 2).map(([x, z]) => [round(x, 1), round(z, 1)]),
  width: 34,
  depth: 3.2,
  bank: 2,
  water: 1.1,
};
const RIVER_CLEAR = river.width / 2 + river.bank;
const nearRiver = (x, z, pad) => lineDist(x, z, river.pts) < RIVER_CLEAR + pad;
const riverZ = (x) => {
  const p = river.pts;
  for (let i = 0; i < p.length - 1; i++) if ((x - p[i][0]) * (x - p[i + 1][0]) <= 0) return p[i][1] + ((p[i + 1][1] - p[i][1]) * (x - p[i][0])) / (p[i + 1][0] - p[i][0]);
  return p[p.length - 1][1];
};
const quayZ = (x) => riverZ(x) - RIVER_CLEAR - 1;

// --- Zones and bases -------------------------------------------------------------
const Z = {
  A: P(1120, 510), // warehouse yard
  B: P(765, 590), // tank square
  C: P(470, 470), // cathedral close
};
const BLUE = P(250, 255); // defenders
const RED = P(1360, 700); // attackers
const HILL = P(150, 450); // gun battery
const BRIDGE_X = P(750, 0)[0];

// --- Terrain -----------------------------------------------------------------
const flats = [
  { pos: Z.A, radius: 40, blend: 10 },
  { pos: Z.B, radius: 26, blend: 10 },
  { pos: Z.C, radius: 30, blend: 10 },
  { pos: BLUE, radius: 16, blend: 8 },
  { pos: RED, radius: 16, blend: 8 },
];
const terrain = {
  cell: 2,
  noise: 0.15,
  hills: [
    { pos: HILL, radius: 30, height: 7 },
    { pos: P(110, 300), radius: 26, height: 4 },
    { pos: P(330, 230), radius: 30, height: 2 },
  ],
  flats,
  rivers: [river],
};

// --- Streets -----------------------------------------------------------------
const ASPHALT = '#5d5b57';
const COBBLE = '#8a8174';
const streets = [
  // East-west boulevard: attackers' base -> yard -> square -> cathedral -> west.
  { pts: smoothOpen([RED, P(1180, 700), P(1000, 705), P(860, 650), Z.B, P(620, 630), P(450, 650), P(330, 720), P(120, 760)]), w: 9, c: ASPHALT },
  // North-south avenue: north edge -> alley quarter -> square -> bridge.
  { pts: smoothOpen([P(800, 165), P(795, 300), P(785, 430), Z.B, [BRIDGE_X, quayZ(BRIDGE_X) - 2]]), w: 8, c: ASPHALT },
  // Riverside promenade along the quay.
  { pts: Ps([[80, 800], [300, 812], [520, 820], [745, 826], [980, 834], [1200, 830], [1420, 815]]).map(([x]) => [x, round(quayZ(x) - 3.5, 1)]), w: 7, c: COBBLE },
  // Around the cathedral close.
  { pts: smoothOpen([P(250, 290), P(290, 330), P(285, 560), P(330, 610), P(560, 590), P(600, 540), P(600, 330), P(560, 290), P(290, 300)]), w: 6, c: COBBLE },
  // Northern street and the defenders' way in.
  { pts: smoothOpen([BLUE, P(400, 250), P(600, 240), P(800, 240), P(1000, 250), P(1150, 280)]), w: 6, c: ASPHALT },
  // Yard roads.
  { pts: smoothOpen([P(900, 540), P(1000, 540), P(1150, 560), P(1300, 600), RED]), w: 7, c: ASPHALT },
  { pts: smoothOpen([P(980, 330), P(985, 480), P(990, 700), P(1000, 820)]), w: 6, c: ASPHALT },
  // Lanes through the alley quarter.
  { pts: smoothOpen([P(600, 400), P(700, 420), P(785, 430), P(880, 420), P(960, 400)]), w: 4.5, c: COBBLE },
  { pts: smoothOpen([P(680, 250), P(690, 340), P(700, 420), P(660, 520)]), w: 4.5, c: COBBLE },
  // Square to the battery hill and the west.
  { pts: smoothOpen([P(285, 450), P(220, 440), HILL]), w: 5, c: COBBLE },
  { pts: smoothOpen([P(560, 640), P(560, 760), P(600, 805)]), w: 5, c: COBBLE },
  { pts: smoothOpen([P(1000, 705), P(1150, 790), P(1220, 815)]), w: 5, c: ASPHALT },
];
for (const s of streets) {
  const strips = stripAlong(s.pts, s.w, { color: s.c, material: 'concrete_floor', y: 0.05 });
  objects.push(...strips.filter((o) => !nearRiver(o.pos[0], o.pos[2], 0.5) && inMap(o.pos[0], o.pos[2], -4)));
}
const nearStreet = (x, z, pad) => streets.some((s) => lineDist(x, z, s.pts) < s.w / 2 + pad);

// Rail: from the north-east down through the yard sidings.
const rails = [
  smoothOpen(Ps([[1100, 150], [1200, 300], [1300, 420], [1450, 520]])),
  smoothOpen(Ps([[860, 610], [1000, 625], [1150, 640], [1280, 650], [1450, 640]])),
];
for (const line of rails) {
  const inside = line.filter(([x, z]) => inMap(x, z, -20));
  objects.push(...stripAlong(inside, 3, { color: '#5b5048', material: 'ground', y: 0.12, thickness: 0.4 }).filter((s) => inMap(s.pos[0], s.pos[2], -2)));
  for (const off of [-0.72, 0.72]) {
    const shifted = inside.map(([x, z], i) => {
      const [ax, az] = inside[Math.max(0, i - 1)];
      const [bx, bz] = inside[Math.min(inside.length - 1, i + 1)];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      return [x + (-(bz - az) / L) * off, z + ((bx - ax) / L) * off];
    });
    objects.push(...stripAlong(shifted, 0.12, { color: '#6d6a66', material: 'metal', y: 0.28, thickness: 0.16, type: 'prop' }).filter((s) => inMap(s.pos[0], s.pos[2], -2)));
  }
}
const nearRail = (x, z, pad) => rails.some((l) => lineDist(x, z, l) < pad);

// --- Quay and bridge -------------------------------------------------------------
const STONE = '#a49a8a';
{
  // Quay wall: a parapet along the top, the river below.
  const pts = [];
  for (let x = -150; x <= 150; x += 6) pts.push([x, round(quayZ(x) + 0.6, 1)]);
  const quay = wallLine(pts, { height: 1.1, thick: 0.6, material: 'concrete', color: STONE, gaps: [] });
  for (const q of quay) if (inMap(q.pos[0], q.pos[2], -1) && Math.abs(q.pos[0] - BRIDGE_X) > 6) objects.push(q);
  // Stone bridge over the river (the far end runs off the map into the boundary).
  const len = 2 * (RIVER_CLEAR + 8);
  const bz = round(riverZ(BRIDGE_X), 1);
  const deck = 0.95;
  flats.push({ pos: [BRIDGE_X, round(bz - len / 2 + 3)], radius: 6, height: round(deck - 0.1), blend: 10 });
  objects.push({ type: 'wall', pos: [BRIDGE_X, round((deck + 1.25 - 3.8) / 2), bz], size: [9, round(deck + 1.25 + 3.8), len], rot: [0, 0, 0], material: 'concrete', color: STONE, model: 'archBridge', base: 0 });
  // Lamp posts and benches on the promenade.
  for (let x = -120; x <= 120; x += 18) {
    if (Math.abs(x - BRIDGE_X) < 8) continue;
    const z = quayZ(x) - 1.2;
    if (!inMap(x, z, 2)) continue;
    objects.push(block(x, z, 0.2, 4, 0.2, { type: 'prop', material: 'metal', color: '#2f3230' }));
    if (R() < 0.5) objects.push(block(x + 3, z - 0.2, 2.2, 0.8, 0.6, { material: 'wood', color: '#5b4a38', model: 'bench' }));
  }
  river.crossings = [[BRIDGE_X, bz]];
}

// --- Placement bookkeeping -------------------------------------------------------
const placed = [];
const reserve = (x, z, r, building = false) => placed.push({ x, z, r, building });
/** Clear of other things; `buildings: false` ignores houses (they test their rectangles instead). */
const free = (x, z, r, buildings = true) => placed.every((p) => (!buildings && p.building) || Math.hypot(x - p.x, z - p.z) > p.r + r);
/** Building footprints as oriented rectangles (separating-axis overlap test, so blocks can sit close). */
const rects = [];
const corners = (x, z, w, d, yaw) => {
  const c = Math.cos((yaw * Math.PI) / 180);
  const s = Math.sin((yaw * Math.PI) / 180);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [x + (u * w * c) / 2 + (v * d * s) / 2, z - (u * w * s) / 2 + (v * d * c) / 2]);
};
const overlaps = (a, b) => {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = poly[i];
      const [x2, z2] = poly[(i + 1) % 4];
      const nx = z2 - z1;
      const nz = x1 - x2;
      const pa = a.map(([x, z]) => x * nx + z * nz);
      const pb = b.map(([x, z]) => x * nx + z * nz);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
};
const roomFor = (x, z, w, d, yaw, gap = 4) => {
  const me = corners(x, z, w + gap, d + gap, yaw);
  return rects.every((r) => !overlaps(me, r));
};
const addBuilding = (b) => {
  buildings.push(b);
  rects.push(corners(b.pos[0], b.pos[1], b.size[0], b.size[1], b.rot ?? 0));
  // Other things (props, trees) keep off the inscribed circle; buildings use the rectangles.
  reserve(b.pos[0], b.pos[1], Math.min(b.size[0], b.size[1]) / 2 + 0.5, true);
};
const obj = (o, r = 2) => {
  objects.push(o);
  reserve(o.pos[0], o.pos[2], r);
};
const sandbags = (x, z, len, yaw) => obj(block(x, z, len, 1.1, 0.9, { yaw, material: 'ground', color: '#8f846c', model: 'sandbags' }), len / 2 + 0.5);
/** A street barricade: sandbags, a car on its side, crates or a truck across the road. */
const barricade = (x, z, yaw) => {
  const c = Math.cos((yaw * Math.PI) / 180);
  const s = Math.sin((yaw * Math.PI) / 180);
  sandbags(x - c * 3, z + s * 3, 3, yaw);
  obj(block(x + c * 2, z - s * 2, 1.9, 1.5, 4.4, { yaw: yaw + 80, material: 'metal', color: '#4a4f45', model: 'car' }), 2.5);
  props.push({ model: 'wooden_military_crate', pos: [round(x + c * 5.5), 0, round(z - s * 5.5)], rot: [0, round(R() * 360), 0], snap: true });
};

// --- B: tank square ------------------------------------------------------------------
{
  const [bx, bz] = Z.B;
  // Paved square, the fountain, the knocked-out tank as a monument, barricades on the ways in.
  objects.push({ type: 'floor', pos: [bx, 0.06, bz], size: [34, 0.12, 30], material: 'concrete_floor', color: '#9a9082', snap: true });
  obj(block(bx + 2, bz + 6, 6, 1.1, 6, { material: 'concrete', color: '#c8bfae', model: 'fountain' }), 4);
  obj(block(bx - 9, bz - 5, 3.4, 2.6, 7, { yaw: 35, material: 'metal', color: '#56604a', model: 'tankWreck' }), 4.5);
  obj(block(bx + 10, bz - 8, 0.9, 3.4, 0.9, { material: 'concrete', color: '#7d7a72', model: 'statue' }), 1.5);
  barricade(bx + 22, bz - 4, 90);
  barricade(bx - 22, bz + 6, 90);
  barricade(bx + 4, bz - 20, 0);
  sandbags(bx - 4, bz + 14, 4, 0);
  // A tram stopped in the street west of the square.
  obj(block(bx - 30, bz + 7, 2.6, 3.2, 11, { yaw: 95, type: 'wall', material: 'metal', color: '#8b3a2e', model: 'boxcar' }), 6);
  reserve(bx, bz, 15);
}

// --- C: cathedral close ------------------------------------------------------------
{
  const [cx, cz] = Z.C;
  addBuilding({ pos: [round(cx - 9), round(cz - 6)], size: [14, 30], style: 'chapel', doors: 'se', rot: 0, material: 'brick', color: '#8e8577' });
  obj(block(cx - 9, cz - 24, 7, 26, 7, { type: 'wall', material: 'brick', color: '#8a8173', model: 'steeple', sink: 0.3 }), 5);
  // Walled close, gates on each side.
  const yard = [[cx - 28, cz - 34], [cx + 24, cz - 34], [cx + 24, cz + 26], [cx - 28, cz + 26], [cx - 28, cz - 34]];
  objects.push(...wallLine(yard, { height: 2.2, thick: 0.6, material: 'concrete', color: STONE, gaps: [[24, 30], [80, 86], [134, 140], [196, 202]] }));
  // Cross on a plinth, trees in the close, a few graves.
  obj(block(cx + 9, cz - 3, 1.2, 4, 1.2, { material: 'concrete', color: '#bdb5a5', model: 'statue' }), 1.5);
  for (let i = 0; i < 10; i++) obj(block(cx + 8 + (i % 5) * 2.2, cz + 10 + Math.floor(i / 5) * 3, 0.6, 0.9, 0.2, { material: 'concrete', color: '#a19c92' }), 0.4);
  sandbags(cx + 14, cz - 14, 4, 90);
  reserve(cx - 9, cz - 6, 18);
}

// --- A: warehouse yard ----------------------------------------------------------
{
  const [ax, az] = Z.A;
  addBuilding({ pos: [round(ax - 4), round(az - 22)], size: [42, 18], style: 'warehouse', doors: 'sn', rot: -12 });
  addBuilding({ pos: [round(ax - 16), round(az + 26)], size: [36, 18], style: 'warehouse', doors: 'n', rot: -8 });
  obj(block(ax + 14, az - 12, 10, 12, 6, { yaw: -12, type: 'wall', material: 'metal', color: '#3f4a3c', model: 'crane', sink: 0.1 }), 5);
  obj(block(ax + 32, az - 8, 7, 9, 7, { type: 'wall', material: 'metal', color: '#7a7f78', model: 'fuelTank' }), 4.5);
  // Stacks of crates and containers in the yard.
  for (const [dx, dz, yaw] of [[-6, 4, 0], [4, 8, 90], [20, 6, -10], [-20, 2, 80]]) obj(block(ax + dx, az + dz, 2.44, 2.6, 6.1, { yaw, type: 'wall', material: 'metal', color: ['#7a3b2a', '#2e4a5e', '#5d6b3a'][Math.floor(R() * 3)], model: 'container' }), 3.5);
  for (let i = 0; i < 10; i++) {
    const x = ax - 24 + R() * 48;
    const z = az - 6 + R() * 14;
    if (!free(x, z, 1)) continue;
    props.push({ model: R() < 0.5 ? 'wooden_military_crate' : 'old_military_crate', pos: [round(x), 0, round(z)], rot: [0, round(R() * 360), 0], snap: true });
    reserve(x, z, 1);
  }
  // Goods wagons on the sidings.
  for (const dx of [-30, -14]) obj(block(ax + dx, az + 23 - 5, 3, 3.6, 12, { yaw: 87, lift: 0.36, type: 'wall', material: 'metal', color: '#5a3d31', model: 'boxcar' }), 6);
  barricade(ax - 34, az + 6, 0);
  sandbags(ax + 4, az - 2, 4, 0);
}

// --- Gun battery on the west hill ---------------------------------------------------
{
  const [hx, hz] = HILL;
  const ring = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ring.push([hx + Math.cos(a) * 14, hz + Math.sin(a) * 11]);
  }
  objects.push(...wallLine(ring, { height: 1.3, thick: 0.8, material: 'concrete', color: '#958b7b', type: 'cover', gaps: [[2, 8], [44, 49]] }));
  obj(block(hx - 2, hz - 2, 7, 3, 5, { yaw: 100, type: 'wall', material: 'concrete', color: '#8f8c84', model: 'bunker', sink: 0.2 }), 5);
  obj(block(hx + 6, hz + 4, 3, 7.5, 3, { type: 'wall', material: 'wood', color: '#6b5a44', model: 'watchtower' }), 2.5);
  sandbags(hx + 4, hz - 6, 4, 70);
  reserve(hx, hz, 15);
}

// --- Bases -------------------------------------------------------------------
for (const [[x, z], yaw] of [[BLUE, 135], [RED, -90]]) {
  for (let i = 0; i < 2; i++) obj(block(x - 6 + i * 9, z + (yaw > 0 ? -10 : 10), 5, 3, 4, { type: 'wall', material: 'wood', color: '#cfcbbd', model: 'tent' }), 3);
  obj(block(x + (yaw > 0 ? -10 : 10), z, 2.5, 3, 7, { yaw: 90, material: 'metal', color: '#4b5340', model: 'truck' }), 4);
  reserve(x, z, 12);
}

// --- City blocks -------------------------------------------------------------------
// Houses along every street, set back to the pavement and turned to face it.
// Close to the zones they are enterable; further off most are closed blocks.
const STYLES = ['apartment', 'apartment', 'shop', 'house', 'townhall'];
const keepClear = (x, z, r, w, d, yaw) =>
  nearStreet(x, z, Math.min(w, d) / 2 - 0.3) || nearRiver(x, z, r * 0.5) || nearRail(x, z, r * 0.6) || !inMap(x, z, r * 0.6 + 1) || !free(x, z, Math.min(w, d) / 2, false) || !roomFor(x, z, w, d, yaw) ||
  Math.hypot(x - BLUE[0], z - BLUE[1]) < 18 || Math.hypot(x - RED[0], z - RED[1]) < 18;
for (const s of streets) {
  const pts = s.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.round(len / 6));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      for (const side of [-1, 1]) {
        if (R() < 0.15) continue;
        const style = STYLES[Math.floor(R() * STYLES.length)];
        const w = 11 + R() * 6;
        const d = 10 + R() * 5;
        const nx = (-(bz - az) / len) * side;
        const nz = ((bx - ax) / len) * side;
        const setback = s.w / 2 + 1.5 + d / 2;
        const x = px + nx * setback;
        const z = pz + nz * setback;
        const r = Math.hypot(w, d) / 2;
        const yaw = (Math.atan2(-nx, -nz) * 180) / Math.PI;
        if (keepClear(x, z, r, w, d, yaw)) continue;
        const nearZone = Object.values(Z).some(([zx, zz]) => Math.hypot(x - zx, z - zz) < 50);
        addBuilding({
          pos: [round(x), round(z)],
          size: [round(w), round(d)],
          style,
          floors: style === 'house' ? 2 : 2 + Math.floor(R() * 2),
          rot: round(yaw + (R() - 0.5) * 3, 1),
          doors: ['sn', 'se', 'sw'][Math.floor(R() * 3)],
          solid: nearZone ? R() < 0.25 : R() < 0.7,
        });
      }
    }
  }
}
// Fill the back lots between the streets (tighter, smaller houses in the alley quarter).
for (let i = 0; i < 4000; i++) {
  const [x, z] = P(80 + R() * 1340, 170 + R() * 650);
  const alleys = x > P(560, 0)[0] && x < P(940, 0)[0] && z < P(0, 440)[1];
  const w = alleys ? 8 + R() * 3 : 10 + R() * 6;
  const d = alleys ? 7 + R() * 3 : 9 + R() * 5;
  const r = Math.hypot(w, d) / 2;
  const yaw = round((R() < 0.5 ? 0 : 90) + (R() - 0.5) * 8, 1);
  if (keepClear(x, z, r, w, d, yaw)) continue;
  addBuilding({ pos: [round(x), round(z)], size: [round(w), round(d)], style: R() < 0.5 ? 'house' : 'apartment', floors: 2, rot: yaw, doors: 'ns', solid: R() < 0.5 });
}

// Wrecked cars and debris on the streets.
const carColors = ['#5a2a24', '#2e3f55', '#8f8a7c', '#353633', '#4c5a3a'];
for (let i = 0; i < 18; i++) {
  const s = streets[Math.floor(R() * streets.length)];
  const p = s.pts[Math.floor(R() * s.pts.length)];
  const x = p[0] + (R() - 0.5) * s.w * 0.6;
  const z = p[1] + (R() - 0.5) * s.w * 0.6;
  if (!inMap(x, z, 4) || nearRiver(x, z, 2) || !free(x, z, 2.5)) continue;
  obj(block(x, z, 1.9, 1.5, 4.4, { yaw: round(R() * 360), material: 'metal', color: carColors[Math.floor(R() * carColors.length)], model: 'car' }), 2.5);
}
const crateModels = ['wooden_military_crate', 'old_military_crate', 'barrel_03', 'ammo_box', 'metal_jerrycan_green'];
for (const [zx, zz] of Object.values(Z)) {
  for (let i = 0; i < 6; i++) {
    const a = R() * Math.PI * 2;
    const r = 5 + R() * 10;
    const x = zx + Math.cos(a) * r;
    const z = zz + Math.sin(a) * r;
    if (!free(x, z, 1)) continue;
    props.push({ model: crateModels[Math.floor(R() * crateModels.length)], pos: [round(x), 0, round(z)], rot: [0, round(R() * 360), 0], snap: true });
    reserve(x, z, 1);
  }
}

// --- Trees -----------------------------------------------------------------------
// Street trees in the cathedral close and on the battery hill.
const trees = [];
for (let i = 0; i < 80 && trees.length < 34; i++) {
  const [cx, cz, rad] = R() < 0.6 ? [...Z.C, 28] : R() < 0.5 ? [...HILL, 20] : [...BLUE, 26];
  const a = R() * Math.PI * 2;
  const x = cx + Math.cos(a) * rad * Math.sqrt(R());
  const z = cz + Math.sin(a) * rad * Math.sqrt(R());
  if (!inMap(x, z, 2) || nearStreet(x, z, 1) || !free(x, z, 1.5)) continue;
  trees.push([round(x, 1), round(z, 1), round(0.38 + R() * 0.12)]);
  reserve(x, z, 1.5);
}

// --- Spawns & zones ----------------------------------------------------------
const spawns = [];
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  spawns.push({ team: 'blue', pos: [round(BLUE[0] + Math.cos(a) * 5), 0.1, round(BLUE[1] + Math.sin(a) * 4)], yaw: 135 });
  spawns.push({ team: 'red', pos: [round(RED[0] + Math.cos(a) * 4), 0.1, round(RED[1] + Math.sin(a) * 5)], yaw: -90 });
}
const zones = [
  { id: 'A', pos: [Z.A[0], 0, Z.A[1]], radius: 16 },
  { id: 'B', pos: [Z.B[0], 0, Z.B[1]], radius: 15 },
  { id: 'C', pos: [Z.C[0], 0, Z.C[1]], radius: 16 },
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
  meta: { id: 'bilbao', name: '빌바오 공방전', version: 2 },
  world: {
    size: [Math.ceil(halfX * 2), Math.ceil(halfZ * 2)],
    visualProfile: 'overcast',
    groundMaterial: 'ground',
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
writeFileSync(new URL('../../public/maps/bilbao.json', import.meta.url), JSON.stringify(map));
console.log(`bilbao: ${objects.length} objects, ${buildings.length} buildings, ${props.length} props, ${trees.length} trees, area ${Math.round(area)} m², size ${map.world.size}`);
