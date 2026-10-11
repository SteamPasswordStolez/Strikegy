// Generates public/maps/ardennes.json — "아르덴 숲" (Ardennes), winter.
// Fourth layout (2026-10-11, owner: redesign it with BFV's Narvik as the reference for the
// feel — a snowy mountainside coming down to a town on wide water). Read here as a Meuse
// valley town (Dinant): a strip of town between a steep snowy slope and the wide river,
// about 480 x 280 m for 16v16. The river runs along the whole south edge, outside the
// playable area (it is deep); a quay wall, a rail line along the quay and a quay road
// edge the town. A creek in a ravine comes down the mountain and cuts the map in two:
// the wooded slope and the fishing hamlet west of it, the town east of it.
// Six zones in two rows from the blue (west) end to the red (east) end:
//   upper row: A the sawmill on the slope, C the hotel square on the upper terrace, E the church hill;
//   lower row: B the fishing hamlet on the point, D the station and depot, F the rail yard and harbour.
// The upper terrace stands ~7 m above the lower town; the bank between them is steep, with
// stairs, ramps and climbing streets. Blue comes in from the mountain road in the west, red
// from the east end of the valley.
import { writeFileSync } from 'node:fs';
import { block, densify, edgeDist, inside, lineDist, rng, round, smoothClosed, smoothOpen, stripAlong, wallLine } from './lib.mjs';

const R = rng(20261011);
const DEG = Math.PI / 180;
const objects = [];
const buildings = [];
const props = [];
const trees = [];
const pick = (list) => list[Math.floor(R() * list.length)];
const between = (a, b) => a + R() * (b - a);

// --- Outline -------------------------------------------------------------------
// North edge on the mountainside, south edge on the quay; the point (B) pushes out into the river.
const outline = [
  [-242, -96], [-176, -118], [-96, -122], [-20, -116], [60, -122], [140, -118], [214, -104], [246, -50], [242, 20], [248, 82],
  [214, 108], [140, 110], [60, 110], [6, 116], [-30, 128], [-62, 150], [-100, 160], [-138, 150], [-164, 124], [-206, 104],
  [-246, 64], [-240, 0], [-250, -50],
];
const boundary = smoothClosed(outline, 2).map(([x, z]) => [round(x, 1), round(z, 1)]);
const inMap = (x, z, pad = 0) => inside(boundary, x, z) && edgeDist(boundary, x, z) > pad;

// --- Zones, bases ----------------------------------------------------------------------------
const Z = { A: [-118, -50], B: [-98, 118], C: [14, -54], D: [30, 62], E: [140, -58], F: [154, 70] };
const ZR = { A: 32, B: 30, C: 32, D: 32, E: 30, F: 34 };
const BLUE = [-206, 22];
const RED = [214, 6];

// --- Rivers: the wide river (deep, beyond the quay) and the creek in its ravine -------------
const RIVER = {
  pts: smoothOpen([[-460, 214], [-300, 222], [-180, 236], [-100, 246], [-30, 230], [30, 205], [100, 194], [240, 192], [460, 198]], 2),
  width: 130,
  depth: 16,
  bank: 9,
  water: 14.6,
};
const CREEK_PTS = smoothOpen([[-62, -320], [-50, -170], [-44, -100], [-38, -40], [-36, 10], [-38, 60], [-42, 110], [-46, 170]], 2);
// Bridges over the creek: the upper road (stone), the lower street (stone), the quay road and the rail (truss).
const CREEK_BRIDGES = [
  { z: -58, w: 8, kind: 'road' },
  { z: 22, w: 7, kind: 'road' },
  { z: 74, w: 9, kind: 'road' },
  { z: 96, w: 6, kind: 'rail' },
];
const creekX = (z) => {
  let best = CREEK_PTS[0];
  for (const p of CREEK_PTS) if (Math.abs(p[1] - z) < Math.abs(best[1] - z)) best = p;
  return best[0];
};
const CREEK = { pts: CREEK_PTS, width: 5, depth: 4.2, bank: 6, water: 0.5, crossings: CREEK_BRIDGES.filter((b) => b.kind !== 'rail').map((b) => [round(creekX(b.z)), b.z]) };
const CREEK_EDGE = CREEK.width / 2 + CREEK.bank;
const nearCreek = (x, z, pad = 0) => lineDist(x, z, CREEK_PTS) < CREEK_EDGE + pad;
// The quay: the ground ends at the river's bank top; a wall stands on it.
const nearRiverBank = (x, z, pad = 0) => lineDist(x, z, RIVER.pts) < RIVER.width / 2 + RIVER.bank + pad;

// --- Terrain -----------------------------------------------------------------------------------
// The mountain rises to the north-west; a lower ridge behind the town; pads give the zones,
// the upper terrace and the lower town their levels. H() mirrors the engine's heightAt (without
// noise and rivers) so lots can be checked for slope here.
const UPPER = 7.2; // the upper terrace
const LOWER = 1.2; // the lower town
const QUAY = 0.6;
const hills = [
  { pos: [-310, -300], radius: 430, height: 52 }, // the mountain
  { pos: [70, -270], radius: 230, height: 46 }, // the ridge behind the town
  { pos: [250, -200], radius: 160, height: 30 },
  // Knolls and drifts on the slope (cover in the open).
  ...[[-170, -80], [-150, 10], [-80, -20], [-200, -40], [-130, 40], [-70, 30]].map(([x, z]) => ({ pos: [x, z], radius: between(9, 15), height: between(1.2, 2.4) })),
  // Shell craters in the town and on the slope.
  ...[[-96, -6], [-60, -82], [62, -20], [96, 30], [180, 30], [120, -84], [-150, 70], [70, 96], [-10, 40]].map(([x, z]) => ({ pos: [x, z], radius: between(3.5, 5), height: -between(0.8, 1.3) })),
];
const flats = [
  // Upper terrace (C, E and the streets between them).
  ...[-6, 30, 66, 102, 138, 174, 206].map((x) => ({ pos: [x, -54], radius: 34, height: UPPER, blend: 14 })),
  // Lower town and quay.
  ...[-6, 34, 74, 114, 154, 194, 226].map((x) => ({ pos: [x, 40], radius: 34, height: LOWER, blend: 12 })),
  ...[-10, 40, 90, 140, 190, 232].map((x) => ({ pos: [x, 92], radius: 24, height: QUAY, blend: 8 })),
  { pos: Z.A, radius: 36, blend: 12 },
  { pos: Z.B, radius: 40, height: 0.9, blend: 14 },
  { pos: [-100, 72], radius: 24, height: 1.4, blend: 14 },
  { pos: BLUE, radius: 26, blend: 10 },
  { pos: RED, radius: 26, height: 3.6, blend: 14 },
  // Level ground at both ends of the creek bridges (decks at these heights).
  ...CREEK_BRIDGES.flatMap((b) => {
    const h = b.z < 0 ? UPPER : b.z < 50 ? LOWER : QUAY;
    return [-1, 1].map((sd) => ({ pos: [creekX(b.z) + sd * (CREEK_EDGE + 5), b.z], radius: Math.max(6, b.w / 2 + 3), height: h, blend: 8 }));
  }),
];
const terrain = { cell: 2, noise: 0.5, hills, flats, rivers: [RIVER, CREEK] };
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function H(x, z) {
  let h = 0;
  for (const hl of hills) {
    const d = Math.hypot(x - hl.pos[0], z - hl.pos[1]) / hl.radius;
    if (d < 1) h += hl.height * (0.5 + 0.5 * Math.cos(Math.PI * d));
  }
  const base = h;
  for (const p of flats) {
    const d = Math.hypot(x - p.pos[0], z - p.pos[1]);
    const bl = p.blend ?? 8;
    if (d >= p.radius + bl) continue;
    let t = p.height;
    if (t === undefined) {
      t = 0;
      for (const hl of hills) {
        const dd = Math.hypot(p.pos[0] - hl.pos[0], p.pos[1] - hl.pos[1]) / hl.radius;
        if (dd < 1) t += hl.height * (0.5 + 0.5 * Math.cos(Math.PI * dd));
      }
    }
    const w = 1 - smooth(p.radius, p.radius + bl, d);
    h += (t - h) * w;
  }
  void base;
  return h;
}
/** Height spread under a box (max - min over its samples). */
const slopeUnder = (r) => {
  const hs = samples(r, 3).map(([x, z]) => H(x, z));
  return Math.max(...hs) - Math.min(...hs);
};

// --- Occupancy (oriented boxes of everything solid) -----------------------------------------
function obb(x, z, w, d, yawDeg = 0, pad = 0) {
  const c = Math.cos(yawDeg * DEG);
  const s = Math.sin(yawDeg * DEG);
  return { x, z, hw: w / 2 + pad, hd: d / 2 + pad, ax: [c, -s], az: [s, c] };
}
function overlap(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [ux, uz] of [a.ax, a.az, b.ax, b.az]) {
    const ra = a.hw * Math.abs(a.ax[0] * ux + a.ax[1] * uz) + a.hd * Math.abs(a.az[0] * ux + a.az[1] * uz);
    const rb = b.hw * Math.abs(b.ax[0] * ux + b.ax[1] * uz) + b.hd * Math.abs(b.az[0] * ux + b.az[1] * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}
function samples(r, step = 2) {
  const at = (u, w) => [r.x + u * r.ax[0] + w * r.az[0], r.z + u * r.ax[1] + w * r.az[1]];
  const pts = [[r.x, r.z]];
  const nx = Math.max(1, Math.ceil((2 * r.hw) / step));
  const nz = Math.max(1, Math.ceil((2 * r.hd) / step));
  for (let i = 0; i <= nx; i++) for (const s of [-1, 1]) pts.push(at(-r.hw + (2 * r.hw * i) / nx, s * r.hd));
  for (let i = 1; i < nz; i++) for (const s of [-1, 1]) pts.push(at(s * r.hw, -r.hd + (2 * r.hd * i) / nz));
  return pts;
}
const occ = [];
const occupy = (x, z, w, d, yaw = 0, pad = 0) => occ.push(obb(x, z, w, d, yaw, pad));
const isFree = (r) => occ.every((o) => !overlap(o, r));
function put(o) {
  objects.push(o);
  if (o.type !== 'floor' || o.size[1] > 0.6) occupy(o.pos[0], o.pos[2], o.size[0], o.size[2], o.rot?.[1] ?? 0);
  return o;
}
const putAll = (list) => list.forEach(put);
const paint = ([x, z], w, d, yaw, y, color, material = 'concrete_floor') =>
  objects.push({ type: 'floor', pos: [round(x), round(y - 0.15), round(z)], size: [w, 0.3, d], ...(yaw ? { rot: [0, round(yaw, 1), 0] } : {}), material, color, snap: true });
function addBuilding(b) {
  buildings.push({ ...b, pos: [round(b.pos[0]), round(b.pos[1])], ...(b.rot !== undefined ? { rot: round(b.rot, 1) } : {}) });
  occupy(b.pos[0], b.pos[1], b.size[0], b.size[1], b.rot ?? 0, 0.3);
  return b;
}
const frame = (o, deg) => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  const f = (lx, lz) => [round(o[0] + lx * c + lz * s), round(o[1] - lx * s + lz * c)];
  f.deg = deg;
  return f;
};
const building = (f, lx, lz, w, d, opts = {}) => addBuilding({ pos: f(lx, lz), size: [w, d], ...opts, rot: round(f.deg + (opts.rot ?? 0), 1) });
const thing = (f, lx, lz, w, h, d, opts = {}) => put(block(...f(lx, lz), w, h, d, { ...opts, yaw: f.deg + (opts.yaw ?? 0) }));
function yawPitch(yawDeg, pitchDeg) {
  const p = yawDeg * DEG;
  const t = pitchDeg * DEG;
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  const st = Math.sin(t);
  const ct = Math.cos(t);
  return [round(Math.atan2(st, cp * ct) / DEG, 2), round(Math.asin(sp * ct) / DEG, 2), round(Math.atan2(-sp * st, cp) / DEG, 2)];
}
/** A flight of steps (a ramp) between two ground points, absolute heights (not snapped). */
function stairs(a, b, width, color = '#8f8b82') {
  const ya = H(...a);
  const yb = H(...b);
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz) / DEG;
  const rise = yb - ya;
  put({
    type: 'ramp',
    pos: [round((a[0] + b[0]) / 2), round((ya + yb) / 2 - 0.12), round((a[1] + b[1]) / 2)],
    size: [width, 0.3, round(Math.hypot(len, rise) + 0.4)],
    rot: yawPitch(yaw + 180, (Math.atan2(rise, len) / DEG)),
    material: 'concrete',
    color,
  });
  // Low parapets either side.
  for (const s of [-1, 1]) {
    const ox = (-dz / len) * s * (width / 2 + 0.2);
    const oz = (dx / len) * s * (width / 2 + 0.2);
    put({ type: 'cover', pos: [round((a[0] + b[0]) / 2 + ox), round((ya + yb) / 2 + 0.35), round((a[1] + b[1]) / 2 + oz)], size: [0.4, 1.0, round(Math.hypot(len, rise) + 0.4)], rot: yawPitch(yaw + 180, (Math.atan2(rise, len) / DEG)), material: 'concrete', color: STONE });
  }
}

// --- Roads ---------------------------------------------------------------------------------
const ASPHALT = '#4f4e4b';
const LANE = '#5b5955';
const PAVE = '#a29d92';
const roads = [];
function road(pts, w, { y = 0.05, color = ASPHALT, smooth: sm = 2, town = false, material = 'asphalt' } = {}) {
  const line = sm ? smoothOpen(pts, sm) : pts;
  const xs = line.map((p) => p[0]);
  const zs = line.map((p) => p[1]);
  const r = { pts: line, w, town, bb: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
  roads.push(r);
  const keep = (s) => inMap(s.pos[0], s.pos[2], -3) && !nearCreek(s.pos[0], s.pos[2], -1);
  objects.push(...stripAlong(line, w, { color, y, material }).filter(keep));
  if (town) objects.push(...stripAlong(line, w + 3.4, { color: PAVE, material: 'cobble', y: 0.03 }).filter(keep));
  return r;
}
const offRoad = (x, z, pad) =>
  roads.every((r) => {
    const m = r.w / 2 + pad;
    if (x < r.bb[0] - m || x > r.bb[2] + m || z < r.bb[1] - m || z > r.bb[3] + m) return true;
    return lineDist(x, z, r.pts) >= m;
  });

// Quay road (the tank lane along the water): from the blue road's foot past the hamlet,
// over the creek, along the quay to the rail yard and up to the red base.
const QR = road([[-240, 40], [-196, 52], [-150, 70], [-100, 80], [-60, 76], [-38, 74], [0, 76], [60, 80], [120, 82], [180, 80], [214, 60], [214, 20]], 8.5, { y: 0.07 });
// Upper road: blue base up the slope to the sawmill, along the terrace through C and E to red.
const UR = road([[-206, 10], [-186, -16], [-160, -36], [-130, -48], [-96, -56], [-60, -58], [-36, -58], [0, -60], [60, -62], [110, -60], [160, -58], [196, -40], [214, -8]], 7.5, { y: 0.07 });
// Lower town street (mid): from the creek bridge east under the terrace bank.
const MS = road([[-60, 24], [-36, 22], [0, 24], [60, 26], [120, 24], [180, 26], [240, 30]], 5.5, { y: 0.06, town: true, smooth: 1 });
// Streets climbing from the lower town to the terrace (steep: ~7 m over 35-45 m).
const CLIMB = [
  road([[64, 76], [66, 26], [70, -14], [74, -60]], 5, { y: 0.06, town: true, smooth: 1 }),
  road([[196, 80], [196, 26], [190, -14], [184, -56]], 5.5, { y: 0.06, smooth: 1 }),
];
// Back street on the terrace and lanes.
const BS = road([[-20, -92], [40, -94], [100, -92], [160, -90], [210, -84]], 4.5, { y: 0.05, town: true, color: LANE, smooth: 1 });
const lane = (pts) => road(pts, 4, { y: 0.045, town: true, color: LANE, smooth: 1 });
const LANES = [
  lane([[-4, 24], [-6, 76]]),
  lane([[120, 24], [120, 80]]),
  lane([[104, -60], [104, -92]]),
];
// Hamlet track down the point, and the blue base track to the quay road.
road([[-100, 80], [-98, 100], [-96, 132]], 5, { y: 0.05, color: '#6b645a', material: 'ground' });
road([[-206, 22], [-206, 40], [-196, 52]], 6, { y: 0.06 });

// --- Rail: along the quay, sidings into the yard (F) ----------------------------------------
const RAIL_MAIN = smoothOpen([[-260, 30], [-190, 46], [-140, 64], [-80, 88], [-40, 96], [20, 100], [100, 101], [180, 100], [260, 100]], 2);
const S1 = smoothOpen([[96, 101], [120, 94], [150, 90], [200, 90], [228, 94]], 2);
const S2 = smoothOpen([[130, 94], [160, 84], [206, 84]], 2);
const tracks = [RAIL_MAIN, S1, S2];
for (const line of tracks) {
  const pts = line.filter(([x, z]) => inMap(x, z, -25));
  objects.push(...stripAlong(pts, 3.2, { color: '#5b5048', material: 'ground', y: 0.12, thickness: 0.4 }).filter((s) => inMap(s.pos[0], s.pos[2], -2) && !nearCreek(s.pos[0], s.pos[2], 1)));
  for (const off of [-0.72, 0.72]) {
    const rail = pts.map(([x, z], i) => {
      const [ax, az] = pts[Math.max(0, i - 1)];
      const [bx, bz] = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      return [x + (-(bz - az) / len) * off, z + ((bx - ax) / len) * off];
    });
    objects.push(...stripAlong(rail, 0.12, { color: '#6d6a66', material: 'metal', y: 0.28, thickness: 0.16, type: 'prop' }).filter((s) => inMap(s.pos[0], s.pos[2], -2) && !nearCreek(s.pos[0], s.pos[2], 1)));
  }
}
const nearRail = (x, z, pad) => tracks.some((t) => lineDist(x, z, t) < pad);
function along(pts, s) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (s <= len || i === pts.length - 2) {
      const t = len ? Math.min(1, s / len) : 0;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx: (bx - ax) / (len || 1), tz: (bz - az) / (len || 1), yaw: (Math.atan2(bx - ax, bz - az) * 180) / Math.PI };
    }
    s -= len;
  }
  return null;
}
const lengthOf = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
function sAtX(pts, x) {
  let best = Infinity;
  let at = 0;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const d = Math.abs((pts[i][0] + pts[i + 1][0]) / 2 - x);
    if (d < best) {
      best = d;
      at = acc + len / 2;
    }
    acc += len;
  }
  return at;
}
const BOXCAR_COLORS = ['#6a4a3a', '#5d4033', '#4f5a4a', '#6b5a3c', '#3f4b55'];
function boxcar(line, x) {
  const p = along(line, sAtX(line, x));
  put(block(p.x, p.z, 3, 3.6, 12, { yaw: p.yaw, lift: 0.36, type: 'wall', material: 'metal', color: pick(BOXCAR_COLORS), model: 'boxcar' }));
}

// --- Shared clutter ------------------------------------------------------------------------
const STONE = '#8d887e';
const SAND = '#9c8f76';
const WOOD = '#6e5a44';
const CAR_COLORS = ['#5a2a24', '#2e3f55', '#8f8a7c', '#4c5a3a', '#3c3c3a', '#6b5a3c'];
const WRECK = ['#2b2724', '#3a302a', '#4a3d33'];
const CONTAINER_COLORS = ['#8a4a3a', '#3b5a80', '#56704a', '#9a7a3c', '#6d6d6d'];
const car = (x, z, yaw, color = pick(CAR_COLORS)) => put(block(x, z, 1.9, 1.5, 4.4, { yaw, material: 'metal', color, model: 'car' }));
const truck = (x, z, yaw, color = '#4d5a3c') => put(block(x, z, 2.5, 3, 7, { yaw, material: 'metal', color, model: 'truck' }));
const sandbags = (x, z, len, yaw, h = 1.1) => put(block(x, z, len, h, 0.9, { yaw, material: 'ground', color: SAND, model: 'sandbags' }));
function nest(x, z, yaw) {
  const f = frame([x, z], yaw);
  thing(f, 0, -1.6, 3.6, 1.1, 0.9, { material: 'ground', color: SAND, model: 'sandbags' });
  thing(f, -1.6, 0, 0.9, 1.1, 2.6, { material: 'ground', color: SAND, model: 'sandbags' });
  thing(f, 1.6, 0, 0.9, 1.1, 2.6, { material: 'ground', color: SAND, model: 'sandbags' });
}
const logs = (x, z, len, yaw, h = 1.6) => put(block(x, z, len, h, 2.4, { yaw, material: 'wood', color: '#86684a', model: 'logPile' }));
const cart = (x, z, yaw) => put(block(x, z, 1.7, 1.6, 3.6, { yaw, material: 'wood', color: WOOD, model: 'cart' }));
const wreck = (x, z, yaw) => put(block(x, z, 3.6, 2.6, 7.2, { yaw, type: 'wall', material: 'metal', color: '#4a4d42', model: 'tankWreck' }));
const bunker = (x, z, face) => put(block(x, z, 7, 3, 5, { yaw: face, type: 'wall', material: 'concrete', color: '#8f8c84', model: 'bunker', sink: 0.2 }));
const tower = (x, z, yaw = 0) => put(block(x, z, 3.4, 8, 3.4, { yaw, type: 'wall', material: 'wood', color: '#6d6450', model: 'watchtower' }));
const fence = (pts, gaps = []) => putAll(wallLine(densify(pts, 6), { height: 1.1, thick: 0.3, material: 'wood', color: WOOD, type: 'cover', model: 'fence', gaps }));
const stoneWall = (pts, gaps = [], height = 1.0) => putAll(wallLine(densify(pts, 3), { height, thick: 0.5, material: 'concrete', color: STONE, type: 'cover', gaps }));
function container(f, lx, lz, yaw = 0, stack = 1) {
  for (let s = 0; s < stack; s++) thing(f, lx, lz, 2.44, 2.6, 6.1, { yaw: yaw + (s ? (R() - 0.5) * 4 : 0), lift: s * 2.6, sink: s ? 0 : 0.3, type: 'cover', material: 'metal', color: pick(CONTAINER_COLORS), model: 'container' });
}
/** A rock outcrop: a few tipped boulders (cover on the open slope). */
function outcrop(x, z, size = 1) {
  for (let k = 0; k < 3; k++) {
    const w = between(2, 4.5) * size;
    const h = between(1.2, 2.6) * size;
    put({ type: 'wall', pos: [round(x + (R() - 0.5) * 3 * size), round(h / 2 - 0.4), round(z + (R() - 0.5) * 3 * size)], size: [round(w, 1), round(h + 0.8, 1), round(between(1.8, 3.6) * size, 1)], rot: yawPitch(R() * 360, between(-14, 14)), material: 'rock', color: pick(['#6d6a66', '#5f5d5a', '#77736d']), snap: true });
  }
}
// Scanned props cost 1.5-7k triangles each wherever they are: a few per zone, plain crates elsewhere.
const CRATES = ['barrel_03', 'ammo_box', 'old_military_crate'];
const PROPS_PER_ZONE = 3;
const propsIn = {};
const zoneAt = (x, z) => Object.keys(Z).find((id) => Math.hypot(x - Z[id][0], z - Z[id][1]) < ZR[id] + 8);
function crate(x, z) {
  const id = zoneAt(x, z);
  if (id && (propsIn[id] = (propsIn[id] ?? 0) + 1) <= PROPS_PER_ZONE) props.push({ model: pick(CRATES), pos: [round(x), 0, round(z)], rot: [0, round(R() * 360), 0], snap: true });
  else {
    const s = 0.8 + R() * 0.5;
    const yaw = R() * 90;
    const color = pick(['#6f5a3e', '#5d6346']);
    objects.push(block(x, z, s * 1.3, s * 0.8, s, { yaw, material: 'wood', color }));
    if (R() < 0.4) objects.push(block(x, z, s * 0.9, s * 0.7, s * 0.8, { yaw: yaw + 20, lift: s * 0.8, sink: 0, material: 'wood', color }));
  }
  occupy(x, z, 1.4, 1.4);
}
function scatter(cx, cz, rMin, rMax, n) {
  for (let i = 0, placed = 0; placed < n && i < n * 12; i++) {
    const a = R() * Math.PI * 2;
    const r = between(rMin, rMax);
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (!inMap(x, z, 4) || !offRoad(x, z, 0.8) || nearRail(x, z, 2.5) || nearCreek(x, z, 1) || !isFree(obb(x, z, 1.6, 1.6, 0, 0.4))) continue;
    crate(x, z);
    placed++;
  }
}

// --- The quay wall along the river, the creek's ravine and its bridges -----------------------------
{
  // Quay wall on the bank top, just inside the boundary: chest high, a few bollards and mooring posts.
  const edge = boundary.filter(([x, z]) => z > 60 && Math.abs(x) < 240 && !(x > -175 && x < -20 && z > 100));
  const QPTS = edge.sort((a, b) => a[0] - b[0]).map(([x, z]) => [x, z - 2.4]);
  for (const p of wallLine(densify(QPTS, 4), { height: 1.1, thick: 0.6, type: 'cover', material: 'concrete', color: STONE })) if (inMap(p.pos[0], p.pos[2], 0.5)) put(p);
  // Bridges over the creek: flat stone decks at the pads' level, parapets; the rail on a truss.
  for (const b of CREEK_BRIDGES) {
    const x = creekX(b.z);
    const len = CREEK_EDGE * 2 + 6;
    const top = b.z < 0 ? UPPER : b.z < 50 ? LOWER : QUAY;
    if (b.kind === 'rail') {
      const deck = top + 0.3;
      const above = ((0.3 + 3.4) / 0.45) * 0.55;
      objects.push({ type: 'wall', pos: [round(x), round(top + (0.3 + above - 4.2) / 2), b.z], size: [b.w, round(0.3 + above + 4.2), len], rot: [0, 90, 0], material: 'metal', color: '#4a5055', model: 'trussBridge', base: 0 });
      void deck;
      continue;
    }
    const thick = 0.8;
    objects.push({ type: 'floor', pos: [round(x), round(top + 0.12 - thick / 2), b.z], size: [len, thick, b.w], material: 'concrete', color: STONE });
    for (const side of [-1, 1]) objects.push({ type: 'wall', pos: [round(x), round(top + 0.62), round(b.z + side * (b.w / 2 - 0.22))], size: [len, 1, 0.45], material: 'concrete', color: STONE });
    objects.push({ type: 'wall', pos: [round(x), round(top - CREEK.depth / 2), b.z], size: [1.6, round(CREEK.depth + 0.4), b.w + 0.4], material: 'concrete', color: STONE });
  }
}

// --- Blue base: a camp on the mountain road (west) ---------------------------------------------
{
  const f = frame(BLUE, -90); // local +z faces east (into the map)
  for (const [lx, lz] of [[-12, -10], [-4, -12], [6, -12], [-12, 8]]) thing(f, lx, lz, 5, 3, 4, { type: 'wall', material: 'wood', color: '#e3e4df', model: 'tent' });
  for (const [lx, lz] of [[-16, -16], [16, -16], [16, 16]]) tower(...f(lx, lz));
  truck(...f(12, 10), f.deg + 90);
  truck(...f(6, 10), f.deg + 90, '#5a6046');
  logs(...f(-14, 14), 6, f.deg);
  paint(f(0, 0), 26, 26, f.deg, 0.04, '#cfd3d6', 'ground');
  scatter(...BLUE, 6, 14, 4);
}

// --- Red base: the east end of the valley ---------------------------------------------------
{
  const f = frame(RED, 90); // local +z faces west
  addBuilding({ pos: [228, -14], size: [16, 9], style: 'barracks', doors: 'w', rot: 90 });
  for (const [lx, lz] of [[-10, -12], [10, -12]]) thing(f, lx, lz, 5, 3, 4, { type: 'wall', material: 'wood', color: '#e3e4df', model: 'tent' });
  tower(...f(-15, 14));
  tower(...f(15, 14));
  truck(...f(0, -6), f.deg + 90, '#5d5a4a');
  paint(f(0, 0), 26, 22, f.deg, 0.04, '#cfd3d6', 'ground');
  scatter(...RED, 6, 14, 4);
}

// --- A: the sawmill on the slope --------------------------------------------------------------
{
  const [ax, az] = Z.A;
  const f = frame(Z.A, 8);
  thing(f, -4, -6, 13, 5.2, 7, { type: 'wall', material: 'wood', color: '#5c4633', model: 'sawShed', sink: 0.1 });
  building(f, 16, -18, 12, 9, { style: 'mill', floors: 2, doors: 'sw' });
  building(f, -16, 22, 10, 9, { style: 'inn', floors: 2, doors: 'sn' });
  building(f, 10, 16, 7, 6, { style: 'shed', doors: 'w' });
  for (const [lx, lz, len, yaw] of [[-2, 8, 7, 90], [4, 6, 6, 80], [-12, -16, 7, 0], [20, 4, 5, 20], [-24, -6, 6, 100], [0, 20, 5, 10]]) logs(...f(lx, lz), len, f.deg + yaw, between(1.2, 1.8));
  cart(...f(8, -18), f.deg + 70);
  truck(...f(-14, -2), f.deg + 30, '#5a4a3a');
  // Dug in toward the town (east): a bunker on the knoll, sandbags.
  bunker(ax + 26, az + 18, 270);
  nest(ax + 22, az - 22, -90);
  sandbags(ax - 6, az + 24, 4, 10);
  outcrop(ax - 30, az - 26, 1.2);
  outcrop(ax + 30, az - 4, 0.9);
  scatter(ax, az, 6, 26, 6);
}

// --- B: the fishing hamlet on the point -----------------------------------------------------
{
  const [bx, bz] = Z.B;
  // Chapel with its spire on the point, the landmark seen from the whole river front.
  addBuilding({ pos: [bx - 18, bz + 6], size: [9.5, 18], style: 'chapel', doors: 'se', rot: 12 });
  put(block(bx - 20.5, bz - 6, 5, 20, 5, { yaw: 12, type: 'wall', material: 'brick', color: '#948b7e', model: 'steeple', sink: 0.3 }));
  // Fishermen's houses and boat sheds round a little landing.
  for (const [x, z, w, d, rot, style, fl] of [
    [bx + 8, bz - 18, 9, 8, 180, 'house', 2], [bx + 22, bz - 6, 8.6, 8.6, 260, 'house', 2], [bx + 20, bz + 14, 10, 7, 300, 'shed', 1],
    [bx - 2, bz + 24, 12, 7, 350, 'shed', 1], [bx - 30, bz - 14, 8.6, 8.6, 100, 'house', 2], [bx + 12, bz + 2, 9, 8.6, 200, 'shop', 2],
  ]) addBuilding({ pos: [x, z], size: [w, d], style, floors: fl, rot, doors: 'sn' });
  // Net racks and drying fences, boats pulled up on the shingle, a timber jetty.
  fence([[bx - 8, bz + 30], [bx + 6, bz + 34]]);
  fence([[bx + 26, bz + 24], [bx + 30, bz + 10]]);
  for (const [x, z, yaw] of [[bx - 14, bz + 30, 20], [bx + 12, bz + 30, -30], [bx + 30, bz - 22, 70]]) put(block(x, z, 1.8, 0.9, 5.5, { yaw, material: 'wood', color: pick(['#4d5f6e', '#6e4a3a', '#5a6a4e']) }));
  put({ type: 'floor', pos: [bx + 4, 0.55, bz + 40], size: [3.2, 0.3, 16], rot: [0, 10, 0], material: 'wood', color: '#5e4c3a', snap: true });
  // The hamlet was held: sandbags across the track, a nest at the landing, crates.
  nest(bx + 4, bz - 30, 0);
  sandbags(bx - 16, bz - 26, 4, 70);
  sandbags(bx + 30, bz + 2, 3.5, 100);
  wreck(bx - 34, bz + 18, 40);
  scatter(bx, bz, 6, 24, 6);
}

// --- C: the hotel square on the upper terrace ------------------------------------------------
{
  const [cx, cz] = Z.C;
  paint([cx, cz + 4], 44, 30, 0, 0.055, '#b9b2a3', 'cobble');
  // The grand hotel (four floors, 54 m): the landmark, the north side of the square.
  addBuilding({ pos: [cx + 4, cz - 26], size: [54, 18], style: 'hotel', floors: 4, doors: 'sn' });
  put(block(cx, cz + 6, 6, 1, 6, { material: 'concrete', color: '#c9c3b5', model: 'fountain' }));
  put(block(cx, cz + 6, 1, 3.6, 1, { material: 'concrete', color: '#8a8478', model: 'statue' }));
  // The square's other fronts: a townhall, a café, apartments.
  addBuilding({ pos: [cx - 30, cz + 14], size: [12, 16], style: 'townhall', floors: 2, doors: 'ew', rot: 90 });
  addBuilding({ pos: [cx + 34, cz + 8], size: [12, 10], style: 'shop', floors: 3, doors: 'sw', rot: -90 });
  // The terrace edge (south): a balustrade over the bank with a gap at the stairs.
  stoneWall([[cx - 26, cz + 24], [cx + 26, cz + 24]], [[22, 30]], 1.0);
  // Barricades and dug-in positions.
  sandbags(cx - 8, cz - 12, 4, 0);
  sandbags(cx + 10, cz - 12, 4, 0);
  for (const [x, z, yaw] of [[cx + 16, cz + 14, 40], [cx - 16, cz + 16, -30]]) car(x, z, yaw, pick(WRECK));
  put(block(cx - 14, cz - 2, 2.6, 3.2, 11, { yaw: 80, type: 'wall', material: 'metal', color: '#6f7a5c', model: 'bus' }));
  for (const [x, z, yaw] of [[cx + 10, cz + 2, 15], [cx + 18, cz - 4, 100]]) cart(x, z, yaw);
  scatter(cx, cz, 8, 22, 5);
}

// --- D: the station, the engine depot and the water tower (lower town) --------------------------
{
  const [dx, dz] = Z.D;
  addBuilding({ pos: [dx - 14, 89.5], size: [18, 8.6], style: 'station', floors: 2, doors: 'ns' });
  addBuilding({ pos: [dx + 26, 90.5], size: [28, 10], style: 'depot', doors: 'ew' });
  // Platform along the rail, a water tower, boxcars and a tank wreck in the station yard.
  put({ type: 'floor', pos: [dx - 14, 0.5, 96.6], size: [30, 0.9, 2.6], material: 'concrete', color: '#a19c90', snap: true });
  put(block(dx + 2, dz - 6, 5, 13, 5, { type: 'wall', material: 'wood', color: '#5c4633', model: 'waterTower', sink: 0.2 }));
  for (const x of [-120, -10, 70]) boxcar(RAIL_MAIN, x);
  wreck(dx - 20, dz - 4, 70);
  for (const [x, z, yaw] of [[dx + 14, dz - 6, 100], [dx - 4, dz - 14, 20]]) truck(x, z, yaw, pick(['#4d5a3c', '#5a4a3a']));
  nest(dx + 8, dz - 18, 180);
  sandbags(dx - 26, dz + 6, 4, 90);
  scatter(dx, dz, 6, 24, 6);
}

// --- E: the church hill (upper terrace, east) -----------------------------------------------
{
  const [ex, ez] = Z.E;
  addBuilding({ pos: [ex - 2, ez - 22], size: [14, 26], style: 'chapel', doors: 'se', rot: 90, material: 'brick', color: '#8e8577' });
  put(block(ex + 14.5, ez - 22, 7, 26, 7, { type: 'wall', material: 'brick', color: '#8a8173', model: 'steeple', sink: 0.3 }));
  // Churchyard north of the road (walled, gates to the road and the back street), gravestones.
  stoneWall([[ex - 26, ez - 8], [ex - 26, ez - 36], [ex + 24, ez - 36], [ex + 24, ez - 8], [ex - 26, ez - 8]], [[12, 18], [60, 66], [100, 108]]);
  for (let i = 0; i < 16; i++) put(block(ex - 22 + (i % 4) * 2.4, ez - 32 + Math.floor(i / 4) * 5, 0.6, 0.9, 0.2, { material: 'concrete', color: STONE }));
  addBuilding({ pos: [ex - 24, ez + 18], size: [10, 9], style: 'house', floors: 2, doors: 'sn', rot: 180 });
  addBuilding({ pos: [ex + 22, ez + 18], size: [11, 9], style: 'inn', floors: 2, doors: 'sn', rot: 180 });
  nest(ex - 6, ez + 20, 180);
  sandbags(ex + 18, ez + 22, 4, 0);
  car(ex + 6, ez + 28, 70, pick(WRECK));
  scatter(ex, ez, 6, 24, 5);
}

// --- F: the rail yard and the harbour (east) -------------------------------------------------
{
  const [fx, fz] = Z.F;
  addBuilding({ pos: [fx - 6, 52], size: [34, 14], style: 'warehouse', doors: 'nsw' });
  addBuilding({ pos: [fx + 24, 52], size: [20, 12], style: 'warehouse', doors: 'sw' });
  put(block(fx - 34, fz + 4, 10, 12, 6, { yaw: 90, type: 'wall', material: 'metal', color: '#3f4a3c', model: 'crane', sink: 0.1 }));
  put(block(fx + 26, fz + 8, 10, 12, 6, { yaw: 90, type: 'wall', material: 'metal', color: '#3f4a3c', model: 'crane', sink: 0.1 }));
  for (const x of [140, 176]) boxcar(S1, x);
  for (const x of [150, 190]) boxcar(S2, x);
  for (const x of [120, 214]) boxcar(RAIL_MAIN, x);
  const fF = frame(Z.F, 0);
  container(fF, -18, 2, 90, 2);
  container(fF, 12, -2, 0, 2);
  container(fF, 30, -6, 90);
  for (const [lx, lz] of [[-24, -6], [40, 4]]) thing(fF, lx, lz, 6, 5, 6, { type: 'wall', material: 'metal', color: '#9a978c', model: 'fuelTank' });
  truck(fx + 4, fz + 2, 90, '#5a5f66');
  nest(fx - 8, fz + 4, 270);
  sandbags(fx + 18, fz - 6, 4, 90);
  wreck(fx - 40, fz - 10, 100);
  scatter(fx, fz, 6, 26, 6);
}

// --- The bank between the terrace and the lower town: stairs and retaining walls -----------------
{
  for (const x of [-12, 40, 96, 130, 166]) {
    const top = [x, -24];
    const bottom = [x + 2, 6];
    stairs(bottom, top, 3);
  }
  // Retaining wall pieces on the upper edge (cover looking down on the lower town).
  for (let x = -20; x < 205; x += 10) {
    if ([-12, 40, 96, 130, 166, 66, 70, 184, 190].some((g) => Math.abs(g - x) < 6)) continue;
    put(block(x, -22, 8, 1.1, 0.6, { material: 'concrete', color: STONE, type: 'cover' }));
  }
}

// --- The town: buildings along the streets -----------------------------------------------------
const keepOut = [[BLUE, 30], [RED, 32], [Z.A, 32], [Z.B, 34], [Z.C, 30], [Z.D, 30], [Z.E, 30], [Z.F, 34]];
let townLots = 0;
function lotOK(r) {
  for (const [x, z] of samples(r, 2)) {
    if (!inMap(x, z, 6) || keepOut.some(([c, cr]) => Math.hypot(x - c[0], z - c[1]) < cr)) return false;
    if (!offRoad(x, z, 1.2) || nearRail(x, z, 4.5) || nearCreek(x, z, 2) || nearRiverBank(x, z, 4)) return false;
  }
  if (slopeUnder(r) > 1.1) return false;
  return isFree(r);
}
function lotStyle(x, z) {
  const roll = R();
  const upper = z < -10;
  if (x < -40) {
    if (roll < 0.7) return { style: 'house', w: between(8.6, 10), d: between(8.6, 9.5), floors: 2 };
    return { style: 'shed', w: between(6, 8), d: between(5, 7) };
  }
  if (roll < 0.32) return { style: 'shop', w: between(9, 12), d: between(9, 11), floors: R() < 0.4 ? 3 : 2 };
  if (roll < 0.6) return { style: 'apartment', w: between(11, 15), d: between(9.5, 11.5), floors: upper ? (R() < 0.5 ? 4 : 3) : 3 };
  if (roll < 0.9) return { style: 'house', w: between(8.6, 10.5), d: between(8.6, 9.5), floors: R() < 0.3 ? 3 : 2 };
  return { style: 'inn', w: between(12, 15), d: between(9.5, 11), floors: 3 };
}
/** A ruined house: broken walls with blown-out gaps, rubble inside (the town was shelled). */
function ruin(x, z, w, d, yaw) {
  const f = frame([x, z], yaw);
  const corners = [f(-w / 2, -d / 2), f(w / 2, -d / 2), f(w / 2, d / 2), f(-w / 2, d / 2), f(-w / 2, -d / 2)];
  for (let i = 0; i < 4; i++) {
    const len = i % 2 ? d : w;
    const a = between(0.15, 0.55) * len;
    const gaps = [[a, a + between(1.4, 2.6)]];
    if (R() < 0.5) gaps.push([len * 0.75, len * 0.75 + between(1, 2)]);
    putAll(wallLine([corners[i], corners[i + 1]], { height: round(between(1.2, 3.6), 1), thick: 0.45, type: 'wall', material: 'brick', color: pick(['#8b6a55', '#7d5e4c', '#94765f']), gaps }));
  }
  for (let k = 0; k < 4; k++) {
    const [rx, rz] = f(between(-w / 2 + 1.5, w / 2 - 1.5), between(-d / 2 + 1.5, d / 2 - 1.5));
    put({ type: 'cover', pos: [round(rx), round(between(0.2, 0.5)), round(rz)], size: [round(between(1.4, 2.6), 1), round(between(0.6, 1.2), 1), round(between(1.2, 2.2), 1)], rot: yawPitch(R() * 360, between(-12, 12)), material: 'concrete', color: pick(['#8a8178', '#7b6a5e', '#968b80']), snap: true });
  }
  occupy(x, z, w, d, yaw);
}
function frontage(pts, halfW, side) {
  const total = lengthOf(pts);
  let s = 1;
  while (s < total - 3) {
    const p0 = along(pts, s);
    let done = false;
    for (let tries = 0; tries < 4 && !done; tries++) {
      const lot = tries < 3 ? lotStyle(p0.x, p0.z) : { style: 'house', w: 8.6, d: 8.6, floors: 2 };
      if ((lot.floors ?? 1) > 1) {
        lot.w = Math.max(lot.w, 8.6);
        lot.d = Math.max(lot.d, 8.6);
      }
      if (s + lot.w > total + 1) continue;
      const mid = along(pts, s + lot.w / 2);
      const nx = -mid.tz * side;
      const nz = mid.tx * side;
      const off = halfW + 1.9 + lot.d / 2;
      const x = mid.x + nx * off;
      const z = mid.z + nz * off;
      const yaw = (Math.atan2(-nx, -nz) * 180) / Math.PI;
      if (!lotOK(obb(x, z, lot.w, lot.d, yaw))) continue;
      if (lot.style !== 'shed' && R() < 0.16) {
        ruin(x, z, lot.w, lot.d, yaw);
        townLots++;
        s += lot.w + 0.5;
        done = true;
        continue;
      }
      const doors = 's' + (R() < 0.85 ? 'n' : '') + (R() < 0.45 ? pick(['e', 'w']) : '');
      addBuilding({ pos: [x, z], size: [round(lot.w, 1), round(lot.d, 1)], style: lot.style, ...(lot.floors ? { floors: lot.floors } : {}), rot: round(yaw + (R() - 0.5) * 2, 1), doors });
      townLots++;
      s += lot.w + (R() < 0.25 ? between(2.6, 3.6) : 0.5);
      done = true;
    }
    if (!done) s += 1;
  }
}
for (const r of [UR, MS, BS, ...CLIMB, ...LANES, QR]) for (const side of [-1, 1]) frontage(r.pts, r.w / 2, side);
// Sheds and garages in the yards behind the street fronts.
for (let gx = -30; gx <= 214; gx += 8) {
  for (let gz = -110; gz <= 90; gz += 8) {
    if (R() < 0.5) continue;
    const x = gx + (R() - 0.5) * 4;
    const z = gz + (R() - 0.5) * 4;
    const r = obb(x, z, between(5, 7), between(4.5, 6), R() * 360, 1.5);
    if (!lotOK(r)) continue;
    addBuilding({ pos: [round(x), round(z)], size: [round(r.hw * 2 - 3, 1), round(r.hd * 2 - 3, 1)], style: 'shed', rot: round(Math.atan2(r.ax[1], r.ax[0]) / -DEG, 1), doors: pick(['s', 'n', 'e']) });
  }
}

// --- Cars along the kerbs, roadblocks --------------------------------------------------------
let parked = 0;
for (const r of [QR, MS, UR]) {
  const total = lengthOf(r.pts);
  for (const side of [-1, 1]) {
    for (let s = 6; s < total - 6; s += between(6, 10)) {
      if (R() < 0.62) continue;
      const p = along(r.pts, s);
      const off = r.w / 2 - 1.1;
      const x = p.x - p.tz * side * off;
      const z = p.z + p.tx * side * off;
      if (!inMap(x, z, 5) || x < -40 || nearCreek(x, z, 3) || Object.values(Z).some(([zx, zz]) => Math.hypot(x - zx, z - zz) < 14)) continue;
      if (roads.some((o) => o !== r && lineDist(x, z, o.pts) < o.w / 2 + 3)) continue;
      if (!isFree(obb(x, z, 1.9, 4.4, p.yaw, 0.3))) continue;
      car(x, z, p.yaw + (side < 0 ? 180 : 0) + (R() - 0.5) * 4, R() < 0.3 ? pick(WRECK) : undefined);
      parked++;
    }
  }
}
/** A roadblock closing one side of a road (the other side left open for tanks). */
function roadblock(r, s) {
  const p = along(r.pts, s);
  const nx = -p.tz;
  const nz = p.tx;
  const half = r.w / 2;
  const at = (k, f = 0) => [p.x + nx * k + p.tx * f, p.z + nz * k + p.tz * f];
  car(...at(-half + 1.2, 0.5), p.yaw + 15, pick(WRECK));
  sandbags(...at(-half - 0.2, -4), 3.2, p.yaw + 180);
}
roadblock(QR, sAtX(QR.pts, -10));
roadblock(QR, sAtX(QR.pts, 100));
roadblock(UR, sAtX(UR.pts, -70));
roadblock(UR, sAtX(UR.pts, 80));

// --- The mountainside: woods, outcrops, firing positions ----------------------------------------
function copse(cx, cz, radius, n, minGap = 3.4) {
  for (let i = 0, placed = 0; placed < n && i < n * 12; i++) {
    const a = R() * Math.PI * 2;
    const r = Math.sqrt(R()) * radius;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (!inMap(x, z, 2) || !offRoad(x, z, 3) || nearRail(x, z, 4) || nearCreek(x, z, 1) || nearRiverBank(x, z, 3)) continue;
    if (Object.entries(Z).some(([id, c]) => Math.hypot(x - c[0], z - c[1]) < ZR[id] - 4)) continue;
    if (!isFree(obb(x, z, 1, 1, 0, 2.2)) || trees.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < minGap)) continue;
    trees.push([round(x, 1), round(z, 1), round(between(0.75, 1.35), 2)]);
    placed++;
  }
}
// Wooded slope west of the creek (blue's approach) and along the ravine.
for (const [x, z, r, n] of [
  [-190, -80, 30, 40], [-150, -100, 26, 30], [-80, -96, 28, 34], [-170, 70, 18, 14], [-60, -20, 18, 18], [-80, 40, 18, 16],
  [-200, -20, 18, 12], [-140, 10, 14, 10], [-54, 80, 12, 8], [-130, 90, 12, 8],
  // Behind the town on the ridge foot and in the yards.
  [40, -108, 16, 10], [130, -108, 16, 10], [210, -70, 14, 8], [226, 50, 12, 6],
]) copse(x, z, r, n);
for (const [x, z, s] of [[-170, -50, 1.3], [-100, -90, 1.1], [-70, -40, 1], [-150, 40, 1.1], [-190, -60, 0.9], [-60, 50, 0.8], [-130, -20, 0.9], [-210, -90, 1.2]]) outcrop(x, z, s);
for (const [x, z, yaw] of [[-80, -40, 90], [-64, 8, 90], [-150, -20, 60], [-120, 60, 120]]) nest(x, z, yaw);

// --- Spawns & zones ------------------------------------------------------------------------
const spawns = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  spawns.push({ team: 'blue', pos: [round(BLUE[0] + Math.cos(a) * 6), 0.1, round(BLUE[1] + Math.sin(a) * 5)], yaw: -90 });
  spawns.push({ team: 'red', pos: [round(RED[0] + Math.cos(a) * 6), 0.1, round(RED[1] + Math.sin(a) * 5)], yaw: 90 });
}
const zones = Object.entries(Z).map(([id, [x, z]]) => ({ id, pos: [x, 0, z], radius: ZR[id] }));

// --- Self-check ---------------------------------------------------------------------------
const problems = [];
for (const b of buildings) {
  const r = obb(b.pos[0], b.pos[1], b.size[0], b.size[1], b.rot ?? 0);
  if (samples(r, 2).some(([x, z]) => !offRoad(x, z, 0))) problems.push(`building ${b.style} at ${b.pos} is on a road`);
  if (samples(r, 4).some(([x, z]) => !inMap(x, z, 1))) problems.push(`building ${b.style} at ${b.pos} leaves the map`);
  const sl = slopeUnder(r);
  if (sl > 1.6) problems.push(`building ${b.style} at ${b.pos} stands on a ${round(sl, 1)} m slope`);
}
for (const o of objects) {
  if (o.type === 'floor' && o.size[1] < 0.6) continue;
  if (!inMap(o.pos[0], o.pos[2], -1)) problems.push(`object ${o.model ?? o.type} at ${o.pos} is outside the map`);
}
if (problems.length) console.warn(problems.join('\n'));

const xs = boundary.map((p) => p[0]);
const zs = boundary.map((p) => p[1]);
const margin = 70;
const halfX = Math.max(-Math.min(...xs), Math.max(...xs)) + margin;
const halfZ = Math.max(-Math.min(...zs), Math.max(...zs)) + margin;
let area = 0;
for (let i = 0; i < boundary.length; i++) {
  const [ax, az] = boundary[i];
  const [bx, bz] = boundary[(i + 1) % boundary.length];
  area += ax * bz - bx * az;
}

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
  // Frontline from the blue end: A, B / C, D / E, F (the middle row starts neutral); Zone to 500.
  modes: { zone: { target: 500 }, frontline: { sectors: [['A', 'B'], ['C', 'D'], ['E', 'F']] } },
  objects,
  buildings,
  props,
  trees,
};
writeFileSync(new URL('../../public/maps/ardennes.json', import.meta.url), JSON.stringify(map));
const styles = {};
for (const b of buildings) styles[b.style] = (styles[b.style] ?? 0) + 1;
console.log(
  `ardennes: ${objects.length} objects, ${buildings.length} buildings (${townLots} town lots), ${props.length} props, ${trees.length} trees, ${parked} parked cars, ` +
    `outline ${round(Math.max(...xs) - Math.min(...xs), 0)} x ${round(Math.max(...zs) - Math.min(...zs), 0)} m (${round(Math.abs(area) / 2, 0)} m²), size ${map.world.size}`,
);
console.log(Object.entries(styles).map(([k, v]) => `${k} ${v}`).join(', '));
