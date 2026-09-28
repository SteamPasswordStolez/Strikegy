// Generates public/maps/ardennes.json — "아르덴 숲" (Ardennes Forest), winter.
// 7-zone Zone map, ~200,000 m². A river runs north-south through the middle and
// is the front line: blue holds the west bank, red the east. The river is knee
// deep (wadeable but exposed); the stone bridge (C), a footbridge at the
// sawmill (A) and the rail bridge by the halt (G) are the covered crossings.
// Dense conifer woods fill the ground between the zones.
import { writeFileSync } from 'node:fs';
import { block, edgeDist, inside, lineDist, rng, round, smoothClosed, smoothOpen, stripAlong, wallLine } from './lib.mjs';

const R = rng(20261205);
const objects = [];
const buildings = [];
const props = [];

// --- Outline -----------------------------------------------------------------
const outline = [
  [-250, -170], [-180, -205], [-95, -212], [-25, -232], [40, -220], [120, -202], [190, -214], [255, -170],
  [288, -100], [278, -20], [296, 52], [268, 122], [228, 176], [160, 200], [82, 214], [12, 230], [-62, 214],
  [-140, 202], [-212, 180], [-262, 128], [-292, 58], [-280, -20], [-296, -92], [-272, -142],
];
const boundary = smoothClosed(outline, 2).map(([x, z]) => [round(x * 0.95, 1), round(z * 0.95, 1)]);

// --- River -------------------------------------------------------------------
const river = {
  pts: smoothOpen([[-30, -320], [-18, -220], [4, -160], [18, -100], [8, -42], [-4, 0], [6, 52], [22, 104], [14, 158], [-4, 212], [4, 320]], 3).map(([x, z]) => [round(x, 1), round(z, 1)]),
  width: 14,
  depth: 2.3,
  bank: 6,
  water: 0.7,
};
/** River centre x at a given z (the course runs north-south). */
const riverX = (z) => {
  const p = river.pts;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i];
    const [bx, bz] = p[i + 1];
    if ((z - az) * (z - bz) <= 0 && az !== bz) return ax + ((bx - ax) * (z - az)) / (bz - az);
  }
  return 0;
};
const RIVER_CLEAR = river.width / 2 + river.bank;
const nearRiver = (x, z, pad) => lineDist(x, z, river.pts) < RIVER_CLEAR + pad;

// --- Zones and bases -----------------------------------------------------------
const Z = {
  A: [-38, -150], // sawmill, west bank
  B: [-150, 108], // farm
  C: [round(riverX(0)), 0], // stone bridge
  D: [98, 8], // village crossroads
  E: [-152, -58], // chapel hill
  F: [158, -118], // bunker ridge
  G: [64, 150], // rail halt, east bank
};
const BLUE = [-238, 18];
const RED = [238, -14];

// --- Terrain -----------------------------------------------------------------
const flats = [
  { pos: Z.A, radius: 20, blend: 10 },
  { pos: Z.B, radius: 24, blend: 10 },
  { pos: Z.D, radius: 26, blend: 10 },
  { pos: Z.G, radius: 20, blend: 10 },
  { pos: BLUE, radius: 22, blend: 10 },
  { pos: RED, radius: 22, blend: 10 },
];
// Bridge abutments sit at a known height so the decks (absolute y) meet the ground.
const bridgeC = { x: Z.C[0], z: 0, len: 34, w: 7.5 };
const footA = { x: round(riverX(-150)), z: -150, len: 30, w: 2.6 };
const railZ = (x) => {
  // Rail line: gentle curve through the south, crossing the river near x = 18.
  const pts = rail;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    if ((x - ax) * (x - bx) <= 0) return az + ((bz - az) * (x - ax)) / (bx - ax);
  }
  return pts[pts.length - 1][1];
};
const rail = smoothOpen([[-330, 196], [-220, 186], [-110, 180], [-20, 176], [60, 166], [150, 142], [240, 118], [330, 104]], 2);
/** Unit direction of the rail (west to east) at x. */
const railDir = (x) => {
  const dz = (railZ(x + 2) - railZ(x - 2)) / 4;
  const L = Math.hypot(1, dz);
  return [1 / L, dz / L];
};
const railCrossX = round(riverX(railZ(15)));
const bridgeG = { x: railCrossX, z: round(railZ(railCrossX)), len: 36, w: 5 };
// The stone bridge sits on raised approaches (so its arches clear the water);
// the others sit at the banks' level.
bridgeC.deck = 0.95;
for (const b of [bridgeC, footA, bridgeG]) {
  for (const s of [-1, 1]) flats.push({ pos: [round(b.x + s * (b.len / 2 - 3)), b.z], radius: 7, height: round((b.deck ?? 0.12) - 0.1), blend: 12 });
}
river.crossings = [bridgeC, footA, bridgeG].map((b) => [b.x, b.z]);
const terrain = {
  cell: 2,
  noise: 1.1,
  hills: [
    { pos: [-152, -58], radius: 58, height: 10 }, // chapel hill
    { pos: [120, -150], radius: 40, height: 6.5 }, // bunker ridge, a chain of rises
    { pos: [150, -118], radius: 42, height: 8 },
    { pos: [185, -95], radius: 40, height: 7 },
    { pos: [215, -70], radius: 34, height: 5 },
    { pos: [-225, -140], radius: 70, height: 6 },
    { pos: [-230, 150], radius: 60, height: 4.5 },
    { pos: [215, 95], radius: 60, height: 5 },
    { pos: [75, -190], radius: 50, height: 4 },
    { pos: [-80, 60], radius: 45, height: 3 },
  ],
  flats,
  rivers: [river],
};

// --- Roads and rail ----------------------------------------------------------
const MUD = '#8c8378';
const roads = [
  // Main road: blue base -> bridge -> village -> red base.
  { pts: smoothOpen([BLUE, [-190, 20], [-130, 12], [-70, 4], [-26, 0], [bridgeC.x - bridgeC.len / 2, 0]]), w: 7 },
  { pts: smoothOpen([[bridgeC.x + bridgeC.len / 2, 0], [40, 4], [Z.D[0], Z.D[1]], [160, 2], [205, -8], RED]), w: 7 },
  // East bank north-south through the crossroads.
  { pts: smoothOpen([[Z.F[0] - 16, Z.F[1] + 10], [128, -70], [Z.D[0], Z.D[1]], [90, 70], [76, 118], [Z.G[0] + 4, Z.G[1] - 10]]), w: 6 },
  // West bank: sawmill -> chapel foot -> main road -> farm.
  { pts: smoothOpen([[Z.A[0] - 8, Z.A[1]], [-78, -118], [-108, -70], [-112, -20], [-100, 6]]), w: 5 },
  { pts: smoothOpen([[-110, 8], [-120, 60], [Z.B[0] + 10, Z.B[1] - 6]]), w: 5 },
  // Lane up the chapel hill.
  { pts: smoothOpen([[-110, -40], [-130, -52], [Z.E[0] + 8, Z.E[1]]]), w: 4 },
  // Sawmill yard to the footbridge.
  { pts: [[Z.A[0] + 6, Z.A[1]], [footA.x - footA.len / 2, footA.z]], w: 4 },
  // East bank: footbridge -> bunker ridge (forest track).
  { pts: smoothOpen([[footA.x + footA.len / 2, footA.z], [60, -150], [100, -140], [Z.F[0] - 14, Z.F[1] - 4]]), w: 4 },
];
const inMap = (x, z, pad = 0) => inside(boundary, x, z) && edgeDist(boundary, x, z) > pad;
for (const r of roads) {
  const strips = stripAlong(r.pts, r.w, { color: MUD, material: 'ground', y: 0.04 });
  objects.push(...strips.filter((s) => !nearRiver(s.pos[0], s.pos[2], 1) && inMap(s.pos[0], s.pos[2], -4)));
}
const nearRoad = (x, z, pad) => roads.some((r) => lineDist(x, z, r.pts) < r.w / 2 + pad);

// Rail: ballast + two rails, left out over the river (the bridge carries it).
const railIn = rail.filter(([x, z]) => inMap(x, z, -30));
for (const off of [null, -0.72, 0.72]) {
  const line = off === null ? railIn : railIn.map(([x, z], i) => {
    const [ax, az] = railIn[Math.max(0, i - 1)];
    const [bx, bz] = railIn[Math.min(railIn.length - 1, i + 1)];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    return [x + (-(bz - az) / len) * off, z + ((bx - ax) / len) * off];
  });
  const strips = off === null
    ? stripAlong(line, 3.2, { color: '#5b5048', material: 'ground', y: 0.12, thickness: 0.4 })
    : stripAlong(line, 0.12, { color: '#6d6a66', material: 'metal', y: 0.28, thickness: 0.16, type: 'prop' });
  objects.push(...strips.filter((s) => !nearRiver(s.pos[0], s.pos[2], 2) && inMap(s.pos[0], s.pos[2], -2)));
}
const nearRail = (x, z, pad) => lineDist(x, z, railIn) < pad;

// --- Bridges -------------------------------------------------------------------
const STONE = '#8d887e';
/** Deck boxes at absolute heights (not snapped): top of the deck at y = `top`. */
function bridge({ x, z, len, w }, { top = 0.12, thick = 0.7, rail = 1, material = 'concrete', color = STONE, piers = [-5, 5], pierW = 2.2, parapet = 0.5, yaw = 0 } = {}) {
  const c = Math.cos((yaw * Math.PI) / 180);
  const s = Math.sin((yaw * Math.PI) / 180);
  const at = (u, v) => [round(x + u * c + v * s), round(z - u * s + v * c)];
  const rot = yaw ? { rot: [0, yaw, 0] } : {};
  const [dx, dz] = at(0, 0);
  objects.push({ type: 'floor', pos: [dx, round(top - thick / 2), dz], size: [len, thick, w], material, color, ...rot });
  for (const side of [-1, 1]) {
    const [px, pz] = at(0, side * (w / 2 - parapet / 2));
    objects.push({ type: 'wall', pos: [px, round(top + rail / 2), pz], size: [len, rail, parapet], material, color, ...rot });
  }
  // Piers down to the river bed, and a cutwater nose upstream.
  for (const u of piers) {
    const [px, pz] = at(u, 0);
    objects.push({ type: 'wall', pos: [px, round((top - thick - 3.4) / 2 + 0.2), pz], size: [pierW, round(3.4 + thick), w + 0.6], material, color, ...rot });
  }
}
/** A bridge model (world/modelKits) at absolute heights: deck top at `deck`, footings below the river bed. */
function bridgeModel({ x, z, len, w }, model, { deck, above, yaw, color, material }) {
  const bottom = -3.4;
  const top = deck + above;
  objects.push({ type: 'wall', pos: [round(x), round((top + bottom) / 2), round(z)], size: [w, round(top - bottom), len], rot: [0, round(yaw, 1), 0], material, color, model, base: 0 });
}
// Stone arch bridge (runs east-west): the model's parapets stand 1.25 m above its deck.
bridgeModel(bridgeC, 'archBridge', { deck: bridgeC.deck, above: 1.25, yaw: 90, color: STONE, material: 'concrete' });
// Wooden footbridge at the sawmill: planks on two trestles, low handrails.
bridge(footA, { top: 0.35, thick: 0.25, rail: 1, material: 'wood', color: '#6e5a44', piers: [-4, 4], pierW: 0.5, parapet: 0.12 });
// Rail bridge: steel through-truss on two piers (the truss is 55% of the model's height).
{
  const [ux, uz] = railDir(bridgeG.x);
  const deck = 0.3;
  const trussOver = ((deck + 3.4) / 0.45) * 0.55;
  bridgeModel(bridgeG, 'trussBridge', { deck, above: trussOver, yaw: (Math.atan2(ux, uz) * 180) / Math.PI, color: '#4a5055', material: 'metal' });
}

// --- Buildings, objects -----------------------------------------------------
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
const SANDBAG = '#9c8f76';
/** Extra points along a polyline so no piece is longer than `step`. */
const densify = (pts, step) => {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
};
const sandbags = (x, z, len, yaw) => obj(block(x, z, len, 1.1, 0.9, { yaw, material: 'ground', color: SANDBAG, model: 'sandbags' }), len / 2 + 0.5);
const logs = (x, z, len, yaw, h = 1.6) => obj(block(x, z, len, h, 2.4, { yaw, material: 'wood', color: '#86684a', model: 'logPile' }), len / 2 + 1);

// A: sawmill — long mill hall, saw shed, log yard, lumber truck.
{
  const [ax, az] = Z.A;
  addBuilding({ pos: [ax - 16, az - 14], size: [26, 12], style: 'warehouse', material: 'wood', color: '#6b5139', doors: 'se', rot: 8 });
  // Open saw shed beside the mill hall, logs going in on one side.
  obj(block(ax + 4, az - 1, 13, 5.2, 7, { yaw: 8, type: 'wall', material: 'wood', color: '#5c4633', model: 'sawShed', sink: 0.1 }), 7);
  addBuilding({ pos: [ax - 12, az + 16], size: [10, 8], style: 'shed', doors: 'ne', rot: -10 });
  addBuilding({ pos: [ax - 34, az + 4], size: [11, 9], style: 'house', floors: 2, doors: 'e', rot: 85 });
  for (const [dx, dz, yaw] of [[6, 9, 12], [-2, 12, 80], [16, -12, 20], [16, 4, 15]]) logs(ax + dx, az + dz, 6 + R() * 2, yaw);
  obj(block(ax + 2, az - 18, 2.5, 3, 7, { yaw: 100, material: 'metal', color: '#4d5a3c', model: 'truck' }), 4);
  sandbags(ax - 2, az - 24, 4, 90);
}
// B: farm — farmhouse, big barn, shed, hay bales, split-rail paddock.
{
  const [bx, bz] = Z.B;
  addBuilding({ pos: [bx + 8, bz - 16], size: [12, 9], style: 'house', floors: 2, doors: 'se', rot: 4 });
  addBuilding({ pos: [bx - 14, bz + 2], size: [22, 13], style: 'barn', doors: 'ew', rot: 92 });
  addBuilding({ pos: [bx + 14, bz + 14], size: [8, 6], style: 'shed', doors: 'n', rot: -6 });
  for (const [dx, dz, yaw] of [[2, 4, 0], [6, 12, 30], [-2, -6, 80], [18, -2, 10]]) obj(block(bx + dx, bz + dz, 2.6, 1.5, 1.5, { yaw, material: 'wood', color: '#b89a5a', model: 'hayBale' }), 2);
  const pad = [[bx + 22, bz - 6], [bx + 40, bz - 4], [bx + 42, bz + 22], [bx + 24, bz + 26]];
  objects.push(...wallLine([...pad, pad[0]], { height: 1.1, thick: 0.3, material: 'wood', color: '#6e5a44', type: 'cover', model: 'fence', gaps: [[8, 12], [52, 56]] }));
  obj(block(bx - 2, bz + 18, 2.4, 2.6, 5, { yaw: 20, material: 'metal', color: '#7b3a2a', model: 'truck' }), 3);
}
// C: stone bridge — cottages at both ends, sandbag nests on the approaches.
{
  const [cx] = Z.C;
  for (const [dx, dz, rot, doors] of [[-30, -16, 0, 's'], [-34, 16, 180, 's'], [30, -18, 0, 's'], [36, 15, 180, 's']]) {
    addBuilding({ pos: [cx + dx, dz], size: [10, 8], style: 'house', floors: 2, doors, rot });
  }
  sandbags(cx - 22, -5, 4, 0);
  sandbags(cx - 22, 6, 3, 20);
  sandbags(cx + 22, 5, 4, 0);
  sandbags(cx + 22, -6, 3, -20);
}
// E: chapel hill — chapel nave and tower, low churchyard wall, gravestones.
{
  const [ex, ez] = Z.E;
  addBuilding({ pos: [ex + 2, ez - 4], size: [9, 18], style: 'chapel', doors: 'se', rot: 0 });
  // Bell tower and spire against the north end of the nave.
  obj(block(ex + 2, ez - 15.6, 5, 22, 5, { type: 'wall', material: 'brick', color: '#948b7e', model: 'steeple', sink: 0.3 }), 4);
  // Short pieces so the wall follows the hillside instead of standing out over it.
  const yard = densify([[ex - 14, ez - 20], [ex + 16, ez - 20], [ex + 16, ez + 14], [ex - 14, ez + 14], [ex - 14, ez - 20]], 3);
  objects.push(...wallLine(yard, { height: 1.0, thick: 0.5, material: 'concrete', color: STONE, type: 'cover', gaps: [[40, 46], [98, 104]] }));
  for (let i = 0; i < 14; i++) {
    const x = ex - 10 + (i % 4) * 2.2 + (i >= 8 ? 20 : 0) - (i >= 8 ? 12 : 0);
    const z = ez + 2 + Math.floor((i % 8) / 4) * 3 + (i >= 8 ? -14 : 0);
    obj(block(x, z, 0.6, 0.9, 0.2, { material: 'concrete', color: '#9d998f' }), 0.5);
  }
}
// D: village crossroads — houses along both roads, an inn, parked cars.
{
  const [dx, dz] = Z.D;
  addBuilding({ pos: [dx - 16, dz - 16], size: [14, 10], style: 'townhall', floors: 2, doors: 'se', rot: 0 });
  addBuilding({ pos: [dx + 17, dz + 17], size: [12, 9], style: 'shop', floors: 2, doors: 'nw', rot: 180 });
  const crossRoads = [roads[1], roads[2]];
  for (const road of crossRoads) {
    const pts = road.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.round(len / 3));
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const px = ax + (bx - ax) * t;
        const pz = az + (bz - az) * t;
        if (Math.hypot(px - dx, pz - dz) > 70) continue;
        for (const side of [-1, 1]) {
          if (R() < 0.3) continue;
          const w = 8 + R() * 3;
          const d = 7.5 + R() * 2;
          const nx = (-(bz - az) / len) * side;
          const nz = ((bx - ax) / len) * side;
          const setback = road.w / 2 + 2 + d / 2;
          const x = px + nx * setback;
          const z = pz + nz * setback;
          const r = Math.hypot(w, d) / 2 + 1;
          if (nearRoad(x, z, d / 2 - 0.5) || !free(x, z, r) || Math.hypot(x - dx, z - dz) < 12 || nearRiver(x, z, 4)) continue;
          const yaw = (Math.atan2(-nx, -nz) * 180) / Math.PI;
          const close = Math.hypot(x - dx, z - dz) < 45;
          addBuilding({ pos: [round(x), round(z)], size: [round(w), round(d)], style: R() < 0.25 ? 'shop' : 'house', rot: round(yaw + (R() - 0.5) * 4, 1), doors: ['sn', 'se', 'sw'][Math.floor(R() * 3)], solid: close ? R() < 0.2 : R() < 0.55 });
        }
      }
    }
  }
  const carColors = ['#5a2a24', '#2e3f55', '#8f8a7c', '#353633', '#4c5a3a'];
  for (const [ox, oz, yaw] of [[-8, 6, 90], [10, -6, 95], [4, 22, 5], [-6, -24, 0]]) obj(block(dx + ox, dz + oz, 1.9, 1.5, 4.4, { yaw, material: 'metal', color: carColors[Math.floor(R() * carColors.length)], model: 'car' }), 3);
  sandbags(dx + 8, dz + 8, 4, 45);
  sandbags(dx - 8, dz - 8, 4, 45);
}
// F: bunker ridge — pillboxes on the crest facing the river, sandbag lines between.
{
  const [fx, fz] = Z.F;
  for (const [dx, dz, yaw] of [[-30, -20, -60], [0, 0, -70], [28, 18, -80]]) {
    // Slit (local -z) faces west/south-west, toward the river.
    obj(block(fx + dx, fz + dz, 7, 3, 5, { yaw, type: 'wall', material: 'concrete', color: '#8f8c84', model: 'bunker', sink: 0.2 }), 5);
  }
  sandbags(fx - 14, fz - 12, 6, 30);
  sandbags(fx + 14, fz + 10, 6, 40);
  sandbags(fx - 4, fz + 14, 4, -20);
  addBuilding({ pos: [fx + 20, fz - 16], size: [8, 6], style: 'shed', doors: 's', rot: 30 });
}
// G: rail halt — station building, platform, freight shed, boxcars, logs waiting.
{
  const [gx, gz] = Z.G;
  const [ux, uz] = railDir(gx);
  const yaw = (Math.atan2(ux, uz) * 180) / Math.PI;
  const [nx, nz] = [-uz, ux];
  const rz = railZ(gx);
  const side = gz < rz ? -1 : 1;
  const at = (u, v) => [gx + ux * u + nx * v * side, rz + uz * u + nz * v * side];
  const [px, pz] = at(0, 5.2);
  obj(block(px, pz, 4, 1.0, 40, { yaw, type: 'floor', material: 'concrete', color: '#96918a' }), 4);
  const [sx, sz] = at(-4, 13);
  addBuilding({ pos: [round(sx), round(sz)], size: [16, 8], style: 'station', doors: 'ns', rot: round(yaw - 90, 1) });
  const [wx, wz] = at(24, 14);
  addBuilding({ pos: [round(wx), round(wz)], size: [18, 10], style: 'warehouse', material: 'wood', color: '#5f4c3a', doors: 'sn', rot: round(yaw - 90, 1) });
  for (const u of [-34, -20]) {
    const [bx, bz] = at(u, 0);
    obj(block(bx, bz, 3, 3.6, 12, { yaw, lift: 0.36, type: 'wall', material: 'metal', color: '#5a3d31', model: 'boxcar' }), 6);
  }
  for (const [u, v] of [[10, -8], [18, -9], [2, -9]]) {
    const [lx, lz] = at(u, v);
    logs(lx, lz, 7, yaw, 1.8);
  }
}

// --- Bases -------------------------------------------------------------------
{
  const [bx, bz] = BLUE;
  for (let i = 0; i < 3; i++) obj(block(bx - 10 + i * 8, bz + 14, 5, 3, 4, { type: 'wall', material: 'wood', color: '#e3e4df', model: 'tent' }), 3);
  for (const [dx, dz, yaw] of [[18, -8, 90], [18, 8, 90], [0, -18, 0]]) sandbags(bx + dx, bz + dz, 5, yaw);
  obj(block(bx - 16, bz - 10, 2.5, 3, 7, { yaw: 0, material: 'metal', color: '#dcdcd4', model: 'truck' }), 4);
}
{
  const [rx, rz] = RED;
  for (let i = 0; i < 3; i++) obj(block(rx + 10 - i * 8, rz - 14, 5, 3, 4, { type: 'wall', material: 'wood', color: '#dcddd6', model: 'tent' }), 3);
  for (const [dx, dz, yaw] of [[-18, 8, 90], [-18, -8, 90], [0, 18, 0]]) sandbags(rx + dx, rz + dz, 5, yaw);
  obj(block(rx + 16, rz + 10, 2.5, 3, 7, { yaw: 180, material: 'metal', color: '#cfd0c8', model: 'truck' }), 4);
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

// --- Forest ------------------------------------------------------------------
// Smooth value noise for the woods' shape (clumps, clearings, glades).
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
const woods = (x, z) => 0.65 * vnoise(x / 70, z / 70) + 0.35 * vnoise(x / 23 + 11, z / 23 - 7);
const zoneClear = (x, z) => Object.values(Z).some(([zx, zz]) => Math.hypot(x - zx, z - zz) < 34);
const trees = [];
const STEP = 4.2;
for (let gx = -300; gx <= 300; gx += STEP) {
  for (let gz = -240; gz <= 240; gz += STEP) {
    const x = gx + (R() - 0.5) * STEP * 0.9;
    const z = gz + (R() - 0.5) * STEP * 0.9;
    if (!inMap(x, z, 1.5)) continue;
    const edge = edgeDist(boundary, x, z);
    // Thick along the outer edge, clumped woods inside, open near the fights.
    const w = woods(x, z);
    let p = w > 0.56 ? 0.55 : w > 0.5 ? 0.14 : 0.015;
    if (edge < 18) p = Math.max(p, 0.55 - edge / 36);
    if (R() > p) continue;
    if (zoneClear(x, z) || nearRoad(x, z, 3) || nearRiver(x, z, 2) || nearRail(x, z, 6) || !free(x, z, 1.2)) continue;
    if (Math.hypot(x - BLUE[0], z - BLUE[1]) < 42 || Math.hypot(x - RED[0], z - RED[1]) < 42) continue;
    trees.push([round(x, 1), round(z, 1), round(0.62 + R() * 0.42)]);
  }
}

// --- Spawns & zones ----------------------------------------------------------
const spawns = [];
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  spawns.push({ team: 'blue', pos: [round(BLUE[0] + Math.cos(a) * 6), 0.1, round(BLUE[1] + Math.sin(a) * 5)], yaw: -90 });
  spawns.push({ team: 'red', pos: [round(RED[0] + Math.cos(a) * 6), 0.1, round(RED[1] + Math.sin(a) * 5)], yaw: 90 });
}
const zones = [
  { id: 'A', pos: [Z.A[0], 0, Z.A[1]], radius: 17 },
  { id: 'B', pos: [Z.B[0], 0, Z.B[1]], radius: 18 },
  { id: 'C', pos: [Z.C[0], 0, Z.C[1]], radius: 18 },
  { id: 'D', pos: [Z.D[0], 0, Z.D[1]], radius: 20 },
  { id: 'E', pos: [Z.E[0], 0, Z.E[1]], radius: 16 },
  { id: 'F', pos: [Z.F[0], 0, Z.F[1]], radius: 18 },
  { id: 'G', pos: [Z.G[0], 0, Z.G[1]], radius: 17 },
];

// Playable area, for the report.
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
  meta: { id: 'ardennes', name: '아르덴 숲', version: 2 },
  world: {
    size: [Math.ceil(halfX * 2), Math.ceil(halfZ * 2)],
    visualProfile: 'winter',
    groundMaterial: 'snow',
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
writeFileSync(new URL('../../public/maps/ardennes.json', import.meta.url), JSON.stringify(map));
console.log(`ardennes: ${objects.length} objects, ${buildings.length} buildings, ${props.length} props, ${trees.length} trees, area ${Math.round(area)} m², size ${map.world.size}`);
