// Generates public/maps/iron_gate.json — "철문 주둔지" (Iron Gate Garrison).
// 5-zone Zone map: blue FOB (SW) -> old town -> red military base (NE).
// Outline traced from the user's sketch (50 m = 120 px).
import { writeFileSync } from 'node:fs';
import { block, edgeDist, inside, lineDist, rng, round, smoothClosed, smoothOpen, stripAlong, wallLine } from './lib.mjs';

const PX = 50 / 120;
const m = (px, py) => [round((px - 595) * PX), round((py - 315) * PX)];
const sketch = [[150,262],[215,268],[250,258],[280,288],[308,336],[370,318],[410,275],[458,250],[472,230],[428,196],[425,162],[480,148],[530,130],[555,102],[575,82],[640,95],[683,100],[660,72],[615,58],[608,35],[655,48],[700,42],[760,38],[810,46],[860,40],[928,30],[893,60],[965,95],[960,150],[1048,178],[1055,290],[1010,362],[960,410],[920,462],[830,470],[780,500],[700,522],[600,540],[500,562],[420,590],[330,598],[230,572],[175,525],[265,512],[275,432],[235,455],[200,488],[160,430],[132,380],[135,275]];
const boundary = smoothClosed(sketch.map(([x, y]) => m(x, y)), 1).map(([x, z]) => [round(x, 1), round(z, 1)]);

const Z = { A: m(225, 340), B: m(535, 210), C: m(870, 120), D: m(560, 460), E: m(855, 290) };
const BLUE = m(245, 548);
const RED = [69, -98];

const R = rng(20260927);
const objects = [];
const buildings = [];
const props = [];

// --- Terrain ---------------------------------------------------------------
const terrain = {
  cell: 2,
  noise: 0.5,
  hills: [
    { pos: [-160, 4], radius: 48, height: 4.5 }, // A sits on a low hill west of town
    { pos: [110, -70], radius: 90, height: 1.8 }, // base plateau
    { pos: [-60, 40], radius: 40, height: -0.8 }, // shallow dip in the south of town
  ],
  flats: [
    { pos: Z.B, radius: 20, blend: 8 },
    { pos: Z.D, radius: 26, blend: 10 },
    { pos: Z.E, radius: 20, blend: 8 },
    { pos: BLUE, radius: 18, blend: 8 },
  ],
};

// --- Roads & rail ----------------------------------------------------------
const ASPHALT = '#5a5955';
const roads = [
  { pts: smoothOpen([BLUE, [-112, 92], [-62, 80], [-18, 68], [28, 50], [74, 20], [106, -10], [118, -28], [118, -50]]), w: 10 },
  { pts: smoothOpen([[-18, 70], [-20, 22], [-24, -44], [-30, -82]]), w: 9 },
  { pts: smoothOpen([Z.A, [-116, 14], [-70, 22], [-20, 20], [36, 2], [74, 20]]), w: 8 },
  { pts: smoothOpen([[-24, -44], [20, -48], [45, -44], [70, -50], [110, -50], [135, -50]]), w: 7 },
  { pts: smoothOpen([[118, -50], [112, -70], [95, -86], [72, -92]]), w: 6 },
  // Side streets that cut the old town into blocks.
  { pts: smoothOpen([[-104, 44], [-62, 48], [-20, 46]]), w: 6 },
  { pts: smoothOpen([[-74, -52], [-64, -14], [-70, 22]]), w: 6 },
  { pts: smoothOpen([[-20, -10], [16, -18], [40, -30]]), w: 6 },
  { pts: smoothOpen([[28, 50], [52, 34], [60, 6]]), w: 6 },
];
for (const r of roads) objects.push(...stripAlong(r.pts, r.w, { color: ASPHALT, y: 0.04 }));
const rail = smoothOpen([[-128, 112], [-70, 104], [-10, 90], [50, 74], [104, 56], [146, 28], [166, -8]]);
const siding = smoothOpen([[-70, 97], [-35, 84], [5, 78], [40, 68]]);
for (const line of [rail, siding]) {
  objects.push(...stripAlong(line, 3.2, { color: '#5b5048', material: 'ground', y: 0.12, thickness: 0.4 }));
  for (const off of [-0.72, 0.72]) {
    // Rails: offset copies of the line.
    const pts = line.map(([x, z], i) => {
      const [ax, az] = line[Math.max(0, i - 1)];
      const [bx, bz] = line[Math.min(line.length - 1, i + 1)];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      return [x + (-(bz - az) / len) * off, z + ((bx - ax) / len) * off];
    });
    objects.push(...stripAlong(pts, 0.12, { color: '#6d6a66', material: 'metal', y: 0.28, thickness: 0.16, type: 'prop' }));
  }
}
const nearRoad = (x, z, pad) => roads.some((r) => lineDist(x, z, r.pts) < r.w / 2 + pad);
const nearRail = (x, z, pad) => lineDist(x, z, rail) < pad || lineDist(x, z, siding) < pad;

// --- Military base (NE) ----------------------------------------------------
const fence = [[22, -90], [42, -104], [128, -104], [142, -84], [176, -58], [172, -34], [132, -26], [62, -30], [26, -52], [22, -90]];
/** Distance along the fence polyline of the point nearest (x, z). */
const along = (x, z) => {
  let best = Infinity;
  let at = 0;
  let acc = 0;
  for (let i = 0; i < fence.length - 1; i++) {
    const [ax, az] = fence[i];
    const [bx, bz] = fence[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len)));
    const d = Math.hypot(x - (ax + t * (bx - ax)), z - (az + t * (bz - az)));
    if (d < best) {
      best = d;
      at = acc + t * len;
    }
    acc += len;
  }
  return at;
};
const gate = (x, z, w) => [along(x, z) - w / 2, along(x, z) + w / 2];
objects.push(
  ...wallLine(fence, {
    height: 3.6,
    thick: 0.5,
    color: '#a39f93',
    gaps: [gate(45, -44, 9), gate(118, -28, 10), gate(160, -46, 5), gate(34, -97, 4)],
  }),
);
for (const [x, z] of [[42, -104], [128, -104], [176, -58], [132, -26], [26, -52]]) {
  objects.push(block(x, z, 3, 7.5, 3, { type: 'wall', material: 'wood', color: '#6d6450' }));
}
buildings.push({ pos: [96, -95], size: [24, 11], style: 'hq', floors: 2, doors: 'sw' });
for (const [x, z] of [[92, -78], [134, -77], [92, -63], [134, -63]]) {
  buildings.push({ pos: [x, z], size: [24, 8], style: 'barracks', doors: 'ew' });
}
buildings.push({ pos: [150, -42], size: [26, 18], style: 'hangar', doors: 'w' });
for (let i = 0; i < 4; i++) objects.push(block(64 + (i % 2) * 8, -62 + Math.floor(i / 2) * 10, 2.5, 3, 7, { color: '#55603f', material: 'metal' }));
// Sandbag rings at C.
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2 + 0.3;
  objects.push(block(Z.C[0] + Math.cos(a) * 9, Z.C[1] + Math.sin(a) * 9, 3, 1.1, 0.8, { yaw: (a * 180) / Math.PI + 90, material: 'ground', color: '#9c8a64' }));
}

// --- E: helipad + fuel depot -----------------------------------------------
objects.push({ type: 'floor', pos: [Z.E[0] - 10, 0.05, Z.E[1] + 2], size: [20, 0.3, 20], material: 'concrete_floor', color: '#8e8c86', snap: true });
for (const [dx, dz] of [[16, -12], [22, 6], [10, 18]]) objects.push(block(Z.E[0] + dx, Z.E[1] + dz, 6, 5, 6, { type: 'wall', material: 'metal', color: '#c9c6ba' }));
buildings.push({ pos: [Z.E[0] - 6, Z.E[1] + 20], size: [9, 6], style: 'shed', doors: 'n' });
objects.push(...wallLine([[Z.E[0] - 22, Z.E[1] - 12], [Z.E[0] - 22, Z.E[1] + 14]], { height: 1.1, thick: 0.9, material: 'ground', color: '#9c8a64', gaps: [[11, 15]], type: 'cover' }));

// --- A: checkpoint + gas station ------------------------------------------
{
  const [ax, az] = Z.A;
  // Canopy on four pillars.
  for (const [dx, dz] of [[-7, -4], [7, -4], [-7, 4], [7, 4]]) objects.push(block(ax + 2 + dx, az - 8 + dz, 0.4, 4.6, 0.4, { type: 'wall', color: '#d9d4c7' }));
  objects.push({ type: 'floor', pos: [ax + 2, 4.6, az - 8], size: [18, 0.4, 11], material: 'metal', color: '#d9d4c7', snap: true });
  for (const dx of [-3, 3]) objects.push(block(ax + 2 + dx, az - 8, 1, 1.6, 0.6, { color: '#b3312b', material: 'metal' }));
  buildings.push({ pos: [ax - 12, az - 6], size: [11, 8], style: 'shop', floors: 1, doors: 'e' });
  objects.push(block(ax + 12, az + 6, 2.4, 2.8, 2.4, { type: 'wall', material: 'wood', color: '#6d6450' }));
  for (let i = 0; i < 5; i++) props.push({ model: 'concrete_road_barrier', pos: [round(ax + 20 + i * 1.6), 0, round(az + 12 + (i % 2) * 0.4)], rot: [0, 90, 0], snap: true });
  for (const [dx, dz, yaw] of [[-4, 14, 0], [8, -20, 90], [-18, 10, 30]]) objects.push(block(ax + dx, az + dz, 4, 1.1, 0.9, { yaw, material: 'ground', color: '#9c8a64' }));
}
for (const [x, z] of [[-178, -24], [-162, 32], [-140, -32], [-184, 12], [-150, 28]]) {
  buildings.push({ pos: [x, z], size: [10 + R() * 3, 8 + R() * 2], style: 'house', doors: 'ns', rot: round((R() - 0.5) * 20) });
}

// --- B: town hall square ---------------------------------------------------
{
  const [bx, bz] = Z.B;
  objects.push({ type: 'floor', pos: [bx, 0.05, bz], size: [34, 0.3, 26], material: 'concrete_floor', color: '#b9b2a3', snap: true });
  buildings.push({ pos: [bx, bz - 21], size: [28, 12], style: 'townhall', doors: 's' });
  objects.push(block(bx, bz + 1, 3.4, 1, 3.4, { material: 'concrete', color: '#c9c3b5' }));
  objects.push(block(bx, bz + 1, 0.8, 3.2, 0.8, { material: 'concrete', color: '#8a8478' }));
  for (const [dx, dz] of [[-10, 6], [10, 6], [-10, -5], [10, -5]]) objects.push(block(bx + dx, bz + dz, 2.2, 0.8, 0.6, { material: 'wood', color: '#6a4a33' }));
}

// --- D: freight station ----------------------------------------------------
{
  const [dx, dz] = Z.D;
  buildings.push({ pos: [dx - 26, dz + 6], size: [30, 14], style: 'warehouse', doors: 'ns' });
  buildings.push({ pos: [dx + 24, dz + 2], size: [22, 12], style: 'warehouse', doors: 'nw' });
  const colors = ['#b5523b', '#3b6aa0', '#5f7f45', '#c28a2c', '#7d7d7d'];
  const cont = (x, z, yaw, stack = 1) => {
    for (let s = 0; s < stack; s++) {
      objects.push(block(x, z, 2.44, 2.6, 6.1, { yaw, lift: s * 2.6, sink: s ? 0 : 0.3, type: 'cover', material: 'metal', color: colors[Math.floor(R() * colors.length)] }));
    }
  };
  cont(dx - 6, dz - 8, 90, 2);
  cont(dx + 3, dz - 10, 90);
  cont(dx + 9, dz - 3, 0, 2);
  cont(dx - 2, dz + 2, 15);
  cont(dx - 12, dz - 16, 0);
  cont(dx + 14, dz - 14, 80);
  // Platform along the siding and boxcars on it.
  objects.push(block(dx - 4, dz + 17, 36, 1.1, 4, { yaw: -15, type: 'floor', material: 'concrete', color: '#a19c90' }));
  for (const [x, z] of [[-50, 92], [-30, 84], [18, 74]]) objects.push(block(x, z, 3, 3.6, 12, { yaw: 68, lift: 0.35, type: 'wall', material: 'metal', color: '#6a4a3a' }));
}

// --- Blue FOB (SW) -----------------------------------------------------------
{
  const [bx, bz] = BLUE;
  const ring = [[bx - 20, bz - 16], [bx + 18, bz - 20], [bx + 26, bz + 4], [bx + 6, bz + 16], [bx - 18, bz + 12], [bx - 20, bz - 16]];
  objects.push(...wallLine(ring, { height: 2.1, thick: 1.1, material: 'ground', color: '#a89a74', gaps: [[33, 43], [70, 76]] }));
  // Tents at the back of the compound, clear of the spawn ring.
  for (let i = 0; i < 3; i++) objects.push(block(bx - 12 + i * 8, bz + 9.5, 5, 3, 4, { type: 'wall', material: 'wood', color: '#6f6e4e' }));
}

// --- Old town ---------------------------------------------------------------
const town = [[-118, -40], [-80, -72], [-40, -88], [25, -76], [40, -40], [60, -10], [92, 30], [70, 55], [24, 58], [-40, 66], [-110, 64], [-118, 28]];
const clear = [[Z.B, 22], [[Z.B[0], Z.B[1] - 21], 16], [Z.D, 30], [Z.A, 24]];
let lots = 0;
const placed = buildings.map((b) => ({ x: b.pos[0], z: b.pos[1], r: Math.hypot(b.size[0], b.size[1]) / 2 }));
const free = (x, z, r) => placed.every((p) => Math.hypot(x - p.x, z - p.z) > p.r + r - 1.2);
const okLot = (x, z, r) =>
  inside(town, x, z) && inside(boundary, x, z) && edgeDist(boundary, x, z) > 8 && !nearRail(x, z, 8) && !inside(fence, x, z) &&
  !clear.some(([c, cr]) => Math.hypot(x - c[0], z - c[1]) < cr) && free(x, z, r);
const addLot = (x, z, w, d, yaw, byRoad) => {
  const nearZone = Math.min(Math.hypot(x - Z.B[0], z - Z.B[1]), Math.hypot(x - Z.D[0], z - Z.D[1]));
  const roll = R();
  const style = byRoad && roll < 0.35 ? 'shop' : roll < 0.15 ? 'apartment' : 'house';
  buildings.push({
    pos: [round(x), round(z)],
    size: [round(w), round(d)],
    style,
    rot: round(yaw, 1),
    // Street side is local south; a second door at the back or side.
    doors: ['sn', 'se', 'sw'][Math.floor(R() * 3)],
    // Buildings near the fights are enterable; the rest are closed blocks.
    solid: !(nearZone < 55 || byRoad ? R() < 0.8 : R() < 0.35),
  });
  placed.push({ x, z, r: Math.hypot(w, d) / 2 });
  lots++;
};
// 1) Frontage: houses lined up along both sides of the town streets, facing them.
for (const road of roads) {
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
      for (const side of [-1, 1]) {
        if (R() < 0.15) continue;
        const w = 8 + R() * 3;
        const d = 7.5 + R() * 2.5;
        const nx = (-(bz - az) / len) * side;
        const nz = ((bx - ax) / len) * side;
        const setback = road.w / 2 + 1.8 + d / 2;
        const x = px + nx * setback;
        const z = pz + nz * setback;
        if (nearRoad(x, z, d / 2 - 0.5) || !okLot(x, z, Math.hypot(w, d) / 2)) continue;
        // Face the street: local +z (south wall, the door side) points at the road.
        const yaw = (Math.atan2(-nx, -nz) * 180) / Math.PI;
        addLot(x, z, w, d, yaw + (R() - 0.5) * 3, true);
      }
    }
  }
}
// 2) Backyards: fill what is left inside the blocks.
for (let gx = -120; gx <= 94; gx += 7) {
  for (let gz = -90; gz <= 70; gz += 7) {
    const x = gx + (R() - 0.5) * 3;
    const z = gz + (R() - 0.5) * 3;
    const w = 7.5 + R() * 2;
    const d = 7 + R() * 2;
    if (nearRoad(x, z, 5) || !okLot(x, z, Math.hypot(w, d) / 2) || R() < 0.3) continue;
    addLot(x, z, w, d, (R() < 0.5 ? 0 : 90) + (R() - 0.5) * 6, false);
  }
}

// --- Street clutter: cars, barriers, crates ----------------------------------
const carColors = ['#7a2b24', '#2e4a6b', '#c9c5b9', '#3c3c3a', '#5b6b3e', '#a38a3a'];
for (let i = 0, placed = 0; placed < 26 && i < 400; i++) {
  const r = roads[Math.floor(R() * 3)];
  const k = Math.floor(R() * (r.pts.length - 1));
  const [ax, az] = r.pts[k];
  const [bx, bz] = r.pts[k + 1];
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const side = R() < 0.5 ? -1 : 1;
  const off = r.w / 2 - 1.4;
  const x = (ax + bx) / 2 + (-(bz - az) / len) * off * side;
  const z = (az + bz) / 2 + ((bx - ax) / len) * off * side;
  if (!inside(boundary, x, z) || Object.values(Z).some(([zx, zz]) => Math.hypot(x - zx, z - zz) < 8)) continue;
  const yaw = (Math.atan2(bx - ax, bz - az) * 180) / Math.PI + (R() - 0.5) * 20;
  objects.push(block(x, z, 1.9, 1.5, 4.4, { yaw, material: 'metal', color: carColors[Math.floor(R() * carColors.length)] }));
  placed++;
}
const crateModels = ['wooden_military_crate', 'old_military_crate', 'barrel_03', 'ammo_box', 'old_tyre'];
for (const [zx, zz] of Object.values(Z)) {
  for (let i = 0; i < 7; i++) {
    const a = R() * Math.PI * 2;
    const r = 6 + R() * 10;
    const x = zx + Math.cos(a) * r;
    const z = zz + Math.sin(a) * r;
    if (nearRoad(x, z, 1)) continue;
    props.push({ model: crateModels[Math.floor(R() * crateModels.length)], pos: [round(x), 0, round(z)], rot: [0, round(R() * 360), 0], snap: true });
  }
}

// --- Spawns & zones ----------------------------------------------------------
const spawns = [];
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  spawns.push({ team: 'blue', pos: [round(BLUE[0] + Math.cos(a) * 6), 0.1, round(BLUE[1] + Math.sin(a) * 5)], yaw: 60 });
  spawns.push({ team: 'red', pos: [round(RED[0] + Math.cos(a) * 5 - 4), 0.1, round(RED[1] + 6 + Math.sin(a) * 3)], yaw: 220 });
}
const zones = [
  { id: 'A', pos: [Z.A[0], 0, Z.A[1]], radius: 16 },
  { id: 'B', pos: [Z.B[0], 0, Z.B[1]], radius: 18 },
  { id: 'C', pos: [Z.C[0], 0, Z.C[1]], radius: 16 },
  { id: 'D', pos: [Z.D[0], 0, Z.D[1]], radius: 20 },
  { id: 'E', pos: [Z.E[0], 0, Z.E[1]], radius: 16 },
];

const xs = boundary.map((p) => p[0]);
const zs = boundary.map((p) => p[1]);
const margin = 70;
const halfX = Math.max(-Math.min(...xs), Math.max(...xs)) + margin;
const halfZ = Math.max(-Math.min(...zs), Math.max(...zs)) + margin;

const map = {
  meta: { id: 'iron_gate', name: '철문 주둔지', version: 2 },
  world: {
    size: [Math.ceil(halfX * 2), Math.ceil(halfZ * 2)],
    visualProfile: 'outdoor_day',
    groundMaterial: 'ground',
    boundary,
    terrain,
  },
  spawns,
  zones,
  objects,
  buildings,
  props,
};
writeFileSync(new URL('../../public/maps/iron_gate.json', import.meta.url), JSON.stringify(map));
console.log(`iron_gate: ${objects.length} objects, ${buildings.length} buildings (${lots} town lots), ${props.length} props, size ${map.world.size}`);
