// Generates public/maps/iron_gate.json — "철문 주둔지" (Iron Gate Garrison).
// Third layout (2026-10-05, owner: fights were too rare; BFV references):
// a compact 5-zone town map, about 330 x 210 m, for 12v12. The blue FOB
// stands at the west edge, the red garrison at the east edge. Five zones in a
// cross: on the main road the factory district (A, blue side), the old-town
// square with its townhall (B, middle) and the walled iron gate checkpoint
// (C, red side); the five-storey hospital (D, north) and the gas station (E,
// south) halfway between the bases. A canal crosses the town north to south.
// Three lanes run west-east: the north lane past the five-storey hospital
// and the rail freight yard, the main road through the middle (tanks), and
// the south lane past the gas station and its fuel tanks. Everything else is
// town: streets lined with buildings, alleys and backyards.
import { writeFileSync } from 'node:fs';
import { block, densify, edgeDist, inside, lineDist, rng, round, smoothClosed, smoothOpen, stripAlong, wallLine } from './lib.mjs';

const R = rng(20261005);
const DEG = Math.PI / 180;
const objects = [];
const buildings = [];
const props = [];
const trees = [];
const pick = (list) => list[Math.floor(R() * list.length)];
const between = (a, b) => a + R() * (b - a);

// --- Outline -------------------------------------------------------------------
const outline = [
  [-150, -84], [-118, -102], [-60, -106], [0, -102], [60, -106], [118, -102], [152, -82], [166, -30], [162, 20], [166, 62],
  [134, 98], [64, 106], [0, 102], [-64, 106], [-132, 98], [-166, 62], [-162, 15], [-166, -34],
];
const boundary = smoothClosed(outline, 2).map(([x, z]) => [round(x, 1), round(z, 1)]);
const inMap = (x, z, pad = 0) => inside(boundary, x, z) && edgeDist(boundary, x, z) > pad;

// --- Zones, bases, local frames --------------------------------------------------
// Five zones in a cross (BFV Devastation): the square in the middle, the factories (blue side) and the
// gate (red side) on the main road, the hospital on the north lane and the gas station on the south
// lane, both as far from either base (keys are the script's own names; ids A-E are given at the end).
const Z = { D: [-78, 8], B: [0, 0], E: [84, -8], N: [-2, -52], S: [4, 60] };
const ZR = { D: 24, B: 24, E: 24, N: 22, S: 22 };
const BLUE = [-132, 12]; // blue spawn centre
const RED = [134, -12]; // red spawn centre
const HOSP = [-2, -66];
// The canal (Rotterdam): straight north-south between the square and the gate, 3 m below the
// streets, quay walls on both sides, crossed by five bridges.
const CANAL_X = 45;
const CANAL = { pts: [[CANAL_X, -140], [CANAL_X, 140]], width: 9, depth: 3.2, bank: 1.2, water: 0.7 };
const CANAL_EDGE = CANAL.width / 2 + CANAL.bank; // quay edge from the centre line
const nearCanal = (x, z, pad = 0) => Math.abs(x - CANAL_X) < CANAL_EDGE + pad;
/** Bridges over the canal: crossing along x at z, deck `w` wide. */
const CANAL_BRIDGES = [
  { z: -5, w: 10, kind: 'road' }, // the main road (tanks)
  { z: -41.5, w: 7, kind: 'road' }, // north street
  { z: 47.5, w: 7, kind: 'road' }, // south street
  { z: 22, w: 2.6, kind: 'foot' },
  { z: -88.5, w: 6.5, kind: 'rail' },
];
CANAL.crossings = CANAL_BRIDGES.filter((b) => b.kind !== 'rail').map((b) => [CANAL_X, b.z]);

/** A local frame at `o` turned by `deg` (map yaw): local x -> world (cos, -sin), local z -> (sin, cos). */
const frame = (o, deg) => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  const f = (lx, lz) => [round(o[0] + lx * c + lz * s), round(o[1] - lx * s + lz * c)];
  f.deg = deg;
  return f;
};
const fD = frame(Z.D, 0); // u along the main road through the factories
const fE = frame(Z.E, 0); // u along the main road toward the red garrison
const fH = frame(HOSP, 0); // hospital: local +z faces the square
const fF = frame([-130, 12], 0); // FOB: local +x faces the front (east)
const fC = frame([-6, 70], 0); // gas station, the south lane

// --- Occupancy: oriented boxes of everything solid placed so far -----------------
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
/** Points over a box: centre, corners and along the edges every `step` m. */
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
/** Adds a map object and, unless it is ground paint, marks its footprint taken. */
function put(o) {
  objects.push(o);
  if (o.type !== 'floor' || o.size[1] > 0.6) occupy(o.pos[0], o.pos[2], o.size[0], o.size[2], o.rot?.[1] ?? 0);
  return o;
}
const putAll = (list) => list.forEach(put);
/** Ground paint (a pad, a bay line): a thin snapped floor, `y` = its lift above the ground. */
const paint = ([x, z], w, d, yaw, y, color, material = 'concrete_floor') =>
  objects.push({ type: 'floor', pos: [round(x), round(y - 0.15), round(z)], size: [w, 0.3, d], ...(yaw ? { rot: [0, round(yaw, 1), 0] } : {}), material, color, snap: true });
function addBuilding(b) {
  buildings.push(b);
  occupy(b.pos[0], b.pos[1], b.size[0], b.size[1], b.rot ?? 0, 0.3);
  return b;
}
/** A building placed in a local frame (rot relative to the frame). */
const building = (f, lx, lz, w, d, opts = {}) => addBuilding({ pos: f(lx, lz), size: [w, d], ...opts, rot: round(f.deg + (opts.rot ?? 0), 1) });
/** A kit model / box placed in a local frame. */
const thing = (f, lx, lz, w, h, d, opts = {}) => put(block(...f(lx, lz), w, h, d, { ...opts, yaw: f.deg + (opts.yaw ?? 0) }));
const prop = (model, x, z, yaw = R() * 360) => props.push({ model, pos: [round(x), 0, round(z)], rot: [0, round(yaw), 0], snap: true });

/** Euler XYZ (degrees) for a box turned by yaw, then tipped by pitch about its own x axis. */
function yawPitch(yawDeg, pitchDeg) {
  const p = yawDeg * DEG;
  const t = pitchDeg * DEG;
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  const st = Math.sin(t);
  const ct = Math.cos(t);
  return [round(Math.atan2(st, cp * ct) / DEG, 2), round(Math.asin(sp * ct) / DEG, 2), round(Math.atan2(-sp * st, cp) / DEG, 2)];
}
/** A walkable ramp from the ground up to `rise`, rising toward local -z of yaw (high end at x, z). */
function ramp(x, z, yawDeg, len, width, rise, color = '#8f8b82') {
  const fx = Math.sin(yawDeg * DEG);
  const fz = Math.cos(yawDeg * DEG);
  const cx = x + fx * (len / 2);
  const cz = z + fz * (len / 2);
  put({
    type: 'ramp',
    pos: [round(cx), round(rise / 2 - 0.12), round(cz)],
    size: [width, 0.3, round(Math.hypot(len, rise) + 0.2)],
    rot: yawPitch(yawDeg, (Math.atan2(rise, len) / DEG)),
    material: 'concrete',
    color,
    snap: true,
  });
}

// --- Terrain -----------------------------------------------------------------------
const terrain = {
  cell: 2,
  noise: 0.35,
  hills: [
    { pos: [-8, -8], radius: 46, height: 3.6 }, // the old town on its rise; the square on top
    { pos: [-30, 40], radius: 26, height: 1.6 },
    { pos: HOSP, radius: 34, height: 3.2 }, // the hospital stands higher still
    { pos: [-126, -74], radius: 34, height: 2.5 },
    { pos: [122, 72], radius: 34, height: 2.2 },
    { pos: [60, 82], radius: 26, height: -1.2 }, // a dip behind the south lane
    // Shell craters.
    ...[[-96, 30], [-58, -30], [-64, 64], [-20, 70], [12, -48], [70, 30], [100, -52], [96, 62], [-110, -58], [-40, -76]].map(([x, z]) => ({ pos: [x, z], radius: between(3.5, 5), height: -between(0.9, 1.4) })),
  ],
  flats: [
    { pos: Z.D, radius: 36, blend: 10 },
    { pos: Z.B, radius: 40, blend: 12 },
    { pos: Z.E, radius: 36, blend: 10 },
    { pos: BLUE, radius: 26, blend: 10 },
    { pos: RED, radius: 28, blend: 10 },
    { pos: [72, -66], radius: 30, blend: 10 },
    { pos: [-10, 74], radius: 30, blend: 10 },
    // Level ground at both ends of every canal bridge (decks at absolute heights).
    ...CANAL_BRIDGES.flatMap((b) => [-1, 1].map((sd) => ({ pos: [CANAL_X + sd * (CANAL_EDGE + 4), b.z], radius: Math.max(5, b.w / 2 + 2), height: 0, blend: 8 }))),
  ],
  rivers: [CANAL],
};

// --- Roads ---------------------------------------------------------------------------
const ASPHALT = '#575652';
const LANE = '#626059';
const PAVE = '#a29d92';
const roads = [];
/** A road: painted strips, and remembered for keeping buildings / trees / cars off it. */
function road(pts, w, { y = 0.05, color = ASPHALT, smooth = 2, town = false, paint = true } = {}) {
  const line = smooth ? smoothOpen(pts, smooth) : pts;
  const xs = line.map((p) => p[0]);
  const zs = line.map((p) => p[1]);
  const r = { pts: line, w, town, bb: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
  roads.push(r);
  if (paint) {
    const keep = (s) => inMap(s.pos[0], s.pos[2], -3) && !nearCanal(s.pos[0], s.pos[2], 0.3);
    objects.push(...stripAlong(line, w, { color, y, material: 'asphalt' }).filter(keep));
    // Town streets get pavements on both sides (a wider strip under the street).
    if (town) objects.push(...stripAlong(line, w + 3.4, { color: PAVE, material: 'cobble', y: 0.03 }).filter(keep));
  }
  return r;
}
/** Clearance from roads: false if (x, z) is within `pad` of a road's edge. */
const offRoad = (x, z, pad) =>
  roads.every((r) => {
    const m = r.w / 2 + pad;
    if (x < r.bb[0] - m || x > r.bb[2] + m || z < r.bb[1] - m || z > r.bb[3] + m) return true;
    return lineDist(x, z, r.pts) >= m;
  });

// Main road (the tank lane): blue FOB -> factories (D) -> square (B) -> iron gate (E) -> red garrison.
const M1W = road([BLUE, [-110, 12], Z.D, [-50, 6], [-24, 3]], 9, { y: 0.07 });
const M1E = road([[24, -3], [36, -5], [56, -5], Z.E, [110, -12], RED], 9, { y: 0.07, smooth: 1 });
// North and south streets: the lanes' spines, edge to edge.
const NS = road([[-170, -50], [-120, -46], [-60, -42], [0, -40], [60, -42], [120, -46], [170, -50]], 5.5, { y: 0.06, town: true, smooth: 1 });
const SS = road([[-170, 56], [-120, 52], [-60, 48], [0, 46], [60, 48], [120, 52], [170, 56]], 5.5, { y: 0.06, town: true, smooth: 1 });
// Cross streets either side of the square, linking the three lanes.
const XW = road([[-44, -42], [-45, 0], [-44, 48]], 5, { y: 0.055, smooth: 1 });
const lane = (pts) => road(pts, 4.5, { y: 0.045, town: true, color: LANE, smooth: 1 });
const LANES = [
  lane([[-100, -45], [-101, -70], [-102, -98]]),
  lane([[-100, 51], [-101, 76], [-102, 100]]),
  lane([[100, 51], [101, 76], [102, 100]]),
  lane([[-62, -42], [-64, -70], [-66, -98]]),
  lane([[69, -32], [69, -42]]), // the checkpoint's north gate
  lane([[-64, 51], [-65, 76], [-66, 100]]),
  lane([[72, 51], [73, 76], [74, 100]]),
  lane([[-170, -70], [-130, -71], [-100, -70], [-70, -69], [-36, -70]]), // back lanes
  lane([[-170, 79], [-130, 78], [-100, 78], [-64, 77]]),
  lane([[56, 78], [100, 78], [130, 79], [170, 80]]),
];

// --- Rail: along the north edge, a siding into the freight yard ------------------------------------
const RAIL_MAIN = smoothOpen([[-200, -88], [-120, -89], [-40, -88], [40, -89], [120, -88], [200, -87]], 2);
const S1 = smoothOpen([[30, -88], [50, -82], [70, -80], [112, -80], [128, -86]], 2);
const tracks = [RAIL_MAIN, S1];
for (const line of tracks) {
  const inside_ = line.filter(([x, z]) => inMap(x, z, -25));
  objects.push(...stripAlong(inside_, 3.2, { color: '#5b5048', material: 'ground', y: 0.12, thickness: 0.4 }).filter((s) => inMap(s.pos[0], s.pos[2], -2) && !nearCanal(s.pos[0], s.pos[2], 1)));
  for (const off of [-0.72, 0.72]) {
    const pts = inside_.map(([x, z], i) => {
      const [ax, az] = inside_[Math.max(0, i - 1)];
      const [bx, bz] = inside_[Math.min(inside_.length - 1, i + 1)];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      return [x + (-(bz - az) / len) * off, z + ((bx - ax) / len) * off];
    });
    objects.push(...stripAlong(pts, 0.12, { color: '#6d6a66', material: 'metal', y: 0.28, thickness: 0.16, type: 'prop' }).filter((s) => inMap(s.pos[0], s.pos[2], -2) && !nearCanal(s.pos[0], s.pos[2], 1)));
  }
}
const nearRail = (x, z, pad) => tracks.some((t) => lineDist(x, z, t) < pad);

// --- The canal: bridges, quay walls, steps down to the water ----------------------------------------
const STONE = '#8d887e';
{
  for (const b of CANAL_BRIDGES) {
    const len = CANAL_EDGE * 2 + 4;
    if (b.kind === 'rail') {
      // Steel through-truss rail bridge, planked between the rails (the truss is 55% of the model's height).
      const deck = 0.3;
      const above = ((deck + 3.4) / 0.45) * 0.55;
      objects.push({ type: 'wall', pos: [CANAL_X, round((deck + above - 3.4) / 2), b.z], size: [b.w, round(deck + above + 3.4), len], rot: [0, 90, 0], material: 'metal', color: '#4a5055', model: 'trussBridge', base: 0 });
      continue;
    }
    // Flat deck at street level, parapets, two piers in the canal (absolute heights, not snapped).
    const foot = b.kind === 'foot';
    const top = foot ? 0.3 : 0.12;
    const thick = foot ? 0.25 : 0.7;
    const material = foot ? 'wood' : 'concrete';
    const color = foot ? '#6e5a44' : STONE;
    objects.push({ type: 'floor', pos: [CANAL_X, round(top - thick / 2), b.z], size: [len, thick, b.w], material, color });
    const rail = foot ? 0.12 : 0.45;
    for (const side of [-1, 1]) objects.push({ type: 'wall', pos: [CANAL_X, round(top + 0.5), round(b.z + side * (b.w / 2 - rail / 2))], size: [len, 1, rail], material, color });
    for (const u of [-2.6, 2.6]) objects.push({ type: 'wall', pos: [CANAL_X + u, round((top - thick - 3.4) / 2 + 0.2), b.z], size: [foot ? 0.4 : 1.4, round(3.4 + thick), b.w + 0.4], material, color });
  }
  // Quay walls along both edges: gaps at the bridges and at the steps.
  const STEPS = [-66, -22, 12, 34, 72];
  for (const side of [-1, 1]) {
    const x = CANAL_X + side * (CANAL_EDGE + 0.3);
    const z0 = -110;
    const gaps = [...CANAL_BRIDGES.map((b) => [b.z - b.w / 2 - 0.6 - z0, b.z + b.w / 2 + 0.6 - z0]), ...STEPS.map((z) => [z - 1.8 - z0 + side * 4, z + 1.8 - z0 + side * 4])];
    for (const p of wallLine(densify([[x, z0], [x, 110]], 4), { height: 1, thick: 0.5, type: 'cover', material: 'concrete', color: STONE, gaps })) if (inMap(p.pos[0], p.pos[2], 2)) put(p);
    // Steps: a ramp along the wall down to the bed, its top at the gap.
    for (const z of STEPS) {
      const zz = z + side * 4;
      const rx = CANAL_X + side * (CANAL_EDGE - 1.6);
      put({ type: 'ramp', pos: [round(rx), round(-CANAL.depth / 2 - 0.12), round(zz - side * 4.2)], size: [2.6, 0.3, round(Math.hypot(8, CANAL.depth) + 0.2)], rot: yawPitch(side > 0 ? 180 : 0, (Math.atan2(CANAL.depth, 8) / DEG)), material: 'concrete', color: '#8f8b82', base: 0 });
    }
  }
  // Barges moored in the canal: cover in the sunken lane.
  for (const [z, len] of [[-58, 14], [30, 12], [78, 16]]) put(block(CANAL_X + 2, z, 4, 2.2, len, { lift: 0.2, sink: 0, type: 'wall', material: 'metal', color: '#3b3f3a' }));
}
/** Point and yaw at distance `s` along a polyline. */
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
/** The distance along a polyline of the point nearest x. */
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

// --- Shared clutter ------------------------------------------------------------------
const CONTAINER_COLORS = ['#b5523b', '#3b6aa0', '#5f7f45', '#c28a2c', '#7d7d7d', '#8a3b3b', '#2f5f6a'];
const CAR_COLORS = ['#7a2b24', '#2e4a6b', '#c9c5b9', '#3c3c3a', '#5b6b3e', '#a38a3a', '#8c8f93', '#e1ded6', '#4b3b5a'];
const WRECK = ['#2b2724', '#3a302a', '#4a3d33'];
const SAND = '#9c8a64';
const CRATES = ['wooden_military_crate', 'old_military_crate', 'barrel_03', 'ammo_box', 'old_tyre', 'metal_jerrycan_green'];
function container(f, lx, lz, yaw = 0, stack = 1) {
  const color = pick(CONTAINER_COLORS);
  for (let s = 0; s < stack; s++) {
    thing(f, lx, lz, 2.44, 2.6, 6.1, { yaw: yaw + (s ? (R() - 0.5) * 4 : 0), lift: s * 2.6, sink: s ? 0 : 0.3, type: 'cover', material: 'metal', color: s ? pick(CONTAINER_COLORS) : color, model: 'container' });
  }
}
const car = (x, z, yaw, color = pick(CAR_COLORS)) => put(block(x, z, 1.9, 1.5, 4.4, { yaw, material: 'metal', color, model: 'car' }));
const truck = (x, z, yaw, color = '#55603f') => put(block(x, z, 2.5, 3, 7, { yaw, material: 'metal', color, model: 'truck' }));
const sandbags = (x, z, len, yaw, h = 1.1) => put(block(x, z, len, h, 0.9, { yaw, material: 'ground', color: SAND, model: 'sandbags' }));
/** A U-shaped sandbag nest opening toward local +z of yaw. */
function nest(x, z, yaw) {
  const f = frame([x, z], yaw);
  thing(f, 0, -1.6, 3.6, 1.1, 0.9, { material: 'ground', color: SAND, model: 'sandbags' });
  thing(f, -1.6, 0, 0.9, 1.1, 2.6, { material: 'ground', color: SAND, model: 'sandbags' });
  thing(f, 1.6, 0, 0.9, 1.1, 2.6, { material: 'ground', color: SAND, model: 'sandbags' });
}
const hesco = (pts, gaps = []) => putAll(wallLine(pts, { height: 2.1, thick: 1.1, material: 'ground', color: '#a89a74', gaps, model: 'hesco' }));
const tower = (x, z, yaw = 0) => put(block(x, z, 3.4, 8, 3.4, { yaw, type: 'wall', material: 'wood', color: '#6d6450', model: 'watchtower' }));
/** Concrete road barriers in a row across (yaw = row direction). */
function barriers(x, z, yaw, n) {
  const fx = Math.sin(yaw * DEG);
  const fz = Math.cos(yaw * DEG);
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2;
    props.push({ model: 'concrete_road_barrier', pos: [round(x + fx * k * 2.1), 0, round(z + fz * k * 2.1)], rot: [0, round(yaw + 90 + (R() - 0.5) * 6), 0], snap: true });
  }
}
/** Loose clutter (crates, barrels, tyres) round a point, off roads and solid things. */
function scatter(cx, cz, rMin, rMax, n, models = CRATES) {
  for (let i = 0, placed = 0; placed < n && i < n * 12; i++) {
    const a = R() * Math.PI * 2;
    const r = between(rMin, rMax);
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (!inMap(x, z, 4) || !offRoad(x, z, 0.8) || nearRail(x, z, 2.5) || !isFree(obb(x, z, 1.2, 1.2, 0, 0.4))) continue;
    // Small groups: a crate or barrel and one or two more beside it.
    const m = pick(models);
    prop(m, x, z);
    occupy(x, z, 1.2, 1.2);
    if (R() < 0.5) prop(m, x + (R() - 0.5) * 1.6, z + (R() < 0.5 ? 1 : -1) * 1.1);
    placed++;
  }
}

// --- Blue FOB (west edge) -----------------------------------------------------------------------
{
  // Hesco ring; gates: front (main road), the north and south streets' side, a footpath back.
  const ring = [fF(18, -22), fF(18, 22), fF(-18, 22), fF(-18, -22), fF(18, -22)];
  // The front gate is wide enough for a tank to turn out of the motor pool (16 m).
  hesco(ring, [[14, 30], [58, 64], [100, 106], [130, 136]]);
  // Tents and stores along the side walls, clear of the lane from the motor pool to the gate.
  for (const [lx, lz] of [[10, -19], [1, -19]]) thing(fF, lx, lz, 5, 3, 3, { type: 'wall', material: 'wood', color: '#6f6e4e', model: 'tent' });
  for (const [lx, lz] of [[10, 19], [1, 19]]) thing(fF, lx, lz, 5, 3, 3, { type: 'wall', material: 'wood', color: '#6f6e4e', model: 'tent' });
  container(fF, -12, 20, 90);
  container(fF, -12, -20, 90, 2);
  for (const [lx, lz] of [[17, -21], [17, 21], [-17, 21], [-17, -21]]) tower(...fF(lx, lz), fF.deg);
  // Gravel motor pool in the back half (paint only).
  paint(fF(-9, 0), 16, 30, fF.deg, 0.04, '#8a8070', 'ground');
  scatter(...fF(6, 0), 6, 12, 3);
}

// --- Red garrison (east edge) ------------------------------------------------------------------
{
  const WALL = [[116, -40], [150, -44], [156, -14], [150, 14], [116, 12], [116, -40]];
  // Main gate where the main road comes in (west wall), side gates north and south.
  putAll(wallLine(WALL, { height: 3.6, thick: 0.5, color: '#a39f93', gaps: [[12, 18], [108, 114], [145, 158]] }));
  for (const [x, z] of WALL.slice(0, -1)) tower(x, z);
  addBuilding({ pos: [137, -35], size: [18, 8], style: 'hq', floors: 2, doors: 's' });
  addBuilding({ pos: [137, 6], size: [16, 7], style: 'barracks', doors: 'n' });
  truck(150, -38, 75);
  truck(147, 8, 100, '#4d5a3c');
  paint([138, -12], 16, 22, 0, 0.04, '#8e8c86');
  scatter(124, -30, 3, 8, 3);
}

// --- E: the iron gate checkpoint ---------------------------------------------------------
{
  const W = { height: 4.2, thick: 0.6, color: '#9a978c', material: 'concrete' };
  // Front (towards the square): the iron gate in the middle, a breach in the north part.
  putAll(wallLine([fE(-26, -24), fE(-26, 24)], { ...W, gaps: [[18, 30], [5, 8.5]] }));
  // Rear (towards the garrison).
  putAll(wallLine([fE(26, -24), fE(26, 24)], { ...W, gaps: [[18, 30]] }));
  // North side: gate for the lane from the north street. South side: a gate and a breach to the south lane.
  putAll(wallLine([fE(-26, -24), fE(26, -24)], { ...W, gaps: [[8, 18]] }));
  putAll(wallLine([fE(-26, 24), fE(26, 24)], { ...W, gaps: [[14, 24], [42, 45]] }));
  for (const [u, v] of [[-23.5, -21.5], [23.5, -21.5], [-23.5, 21.5], [23.5, 21.5]]) tower(...fE(u, v), fE.deg);
  // The gate itself: two steel leaves standing open, a gantry over the opening.
  for (const s of [-1, 1]) {
    thing(fE, -22.6, s * 6.6, 6, 4.4, 0.35, { yaw: 90, type: 'wall', material: 'metal', color: '#3f4448' });
    thing(fE, -26, s * 7, 1.2, 6.2, 1.2, { type: 'wall', material: 'concrete', color: '#85827a' });
  }
  const [gx, gz] = fE(-26, 0);
  put({ type: 'wall', pos: [gx, 6.1, gz], size: [1, 0.9, 15.2], rot: [0, fE.deg, 0], material: 'metal', color: '#3f4448', snap: true });
  // HQ (two floors, the zone's strongpoint) and barracks inside.
  building(fE, 13, -14, 22, 12, { style: 'hq', floors: 2, doors: 'swe' });
  building(fE, 12, 15.5, 20, 8, { style: 'barracks', doors: 'nw' });
  // Guard booths, hesco firing lines, sandbag nests at the gates, containers, trucks.
  thing(fE, -22, -10, 2.4, 2.8, 2.4, { type: 'wall', material: 'wood', color: '#6d6450', model: 'booth' });
  thing(fE, -22, 10, 2.4, 2.8, 2.4, { type: 'wall', material: 'wood', color: '#6d6450', model: 'booth' });
  hesco([fE(-16, -20), fE(-16, -9)]);
  hesco([fE(-10, 9), fE(-10, 18)]);
  // The main road through the compound stays clear for vehicles (local z -6..6).
  hesco([fE(-6, -10), fE(-6, -14)]);
  nest(...fE(-23, -16), fE.deg - 90);
  nest(...fE(-23, 16), fE.deg - 90);
  nest(...fE(24, -10), fE.deg + 90);
  nest(...fE(-6, 20), fE.deg);
  container(fE, -9, -18, 90, 2);
  container(fE, 8, 8, 90);
  container(fE, 22, 15, 0);
  truck(...fE(-4, 10), fE.deg + 90);
  truck(...fE(20, 6.5), fE.deg - 90, '#4d5a3c');
  scatter(...Z.E, 6, 22, 6);
}

// --- D: factory district ----------------------------------------------------------------
{
  // North of the road: the big hall with an office block (three floors) at its east end.
  building(fD, -4, -22, 36, 16, { style: 'factory', doors: 'snew' });
  building(fD, 22, -20, 12, 12, { style: 'office', floors: 3, doors: 'sw' });
  // South of the road: second hall with a loading dock and lorries backed up to it.
  building(fD, -2, 26, 34, 16, { style: 'factory', doors: 'nsw' });
  thing(fD, -2, 16.5, 28, 1.2, 3, { type: 'floor', material: 'concrete', color: '#9b978d' });
  ramp(...fD(-16.2, 16.5), fD.deg - 90, 4, 3, 1.2);
  for (const u of [-6, 4]) truck(...fD(u, 11.6), fD.deg + 180, pick(['#55603f', '#7a6a4a', '#5a5f66']));
  // The boiler chimney, a landmark seen from the whole map.
  thing(fD, -22, 22, 3.2, 28, 3.2, { type: 'wall', material: 'brick', color: '#7b4a3a' });
  // Yard clutter: containers, a burnt-out tank, sandbags (the halls furnish themselves).
  // The yard strips either side of the road (the road itself stays clear for tanks).
  container(fD, -20, -9, 90, 2);
  container(fD, 12, -9.5, 90);
  container(fD, 18, 21, 0);
  car(...fD(-8, -9), fD.deg + 80, pick(WRECK));
  car(...fD(2, -10.5), fD.deg + 95, pick(WRECK));
  nest(...fD(-28, -9), fD.deg + 90);
  sandbags(...fD(24, -8), 3.5, fD.deg);
  hesco([fD(-2, -12), fD(-2, -7)]);
  put(block(...fD(-16, 10), 3.6, 2.6, 7.2, { yaw: fD.deg + 20, type: 'wall', material: 'metal', color: '#4a4c3e', model: 'tankWreck' }));
  car(...fD(12, 8), fD.deg - 70, pick(WRECK));
  sandbags(...fD(-26, 8), 3.5, fD.deg);
  sandbags(...fD(-8, 7.5), 3, fD.deg);
  car(...fD(-30, -7), fD.deg + 60, pick(WRECK));
  sandbags(...fD(20, 9), 3.5, fD.deg);
  sandbags(...fD(-30, 18), 3.5, fD.deg + 90);
  nest(...fD(28, 6), fD.deg - 90);
  scatter(...Z.D, 6, 26, 7);
}

// --- North lane: the hospital (five floors, the landmark) --------------------------------------
{
  building(fH, 0, 0, 48, 20, { style: 'hospital', floors: 5, doors: 'snew' });
  // Forecourt with parking bays, the entrance canopy and ambulances.
  paint(fH(0, 16), 60, 12, fH.deg, 0.055, '#9d9a93');
  thing(fH, 0, 13, 10, 4.2, 6, { type: 'wall', material: 'concrete', color: '#e2ded6', model: 'fuelCanopy' });
  truck(...fH(-8, 13.5), fH.deg + 90, '#e8e6e0');
  truck(...fH(9, 13.5), fH.deg - 90, '#e8e6e0');
  for (const side of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const lx = side * (14 + k * 2.6);
      paint(fH(lx - 1.3, 18.5), 0.12, 5, fH.deg, 0.07, '#e5e2da');
      if (R() < 0.6) car(...fH(lx, 18.5), fH.deg + (R() < 0.5 ? 0 : 180) + (R() - 0.5) * 4);
    }
  }
  // Park behind, against the rail: benches, sandbags where the defenders dug in.
  for (const lx of [-16, -4, 8, 20]) thing(fH, lx, -13.5, 2.2, 0.8, 0.6, { material: 'wood', color: '#6a4a33', model: 'bench' });
  sandbags(...fH(-27, 4), 3.5, fH.deg + 90);
  sandbags(...fH(27, -4), 3.5, fH.deg + 90);
  // Zone D's forecourt dug in: nests by the entrance, wrecks across the bays.
  nest(...fH(-14, 13), fH.deg);
  nest(...fH(16, 12), fH.deg);
  car(...fH(-22, 14), fH.deg + 70, pick(WRECK));
  car(...fH(24, 15), fH.deg - 60, pick(WRECK));
}

// --- North lane: rail freight yard (east) and the water tower (west) -----------------------------
{
  addBuilding({ pos: [72, -66], size: [32, 14], style: 'warehouse', doors: 'nse' });
  put(block(72, -56, 36, 1.1, 4, { type: 'floor', material: 'concrete', color: '#a19c90' }));
  ramp(54, -56, -90, 4, 3.4, 1.1);
  ramp(90, -56, 90, 4, 3.4, 1.1);
  for (const x of [-120, -74, 6]) boxcar(RAIL_MAIN, x);
  for (const x of [58, 84, 104]) boxcar(S1, x);
  const fA = frame([0, 0], 0);
  for (const [x, z, s] of [[100, -66, 2], [108, -64, 1], [104, -56, 2]]) container(fA, x, z, 0, s);
  container(fA, 40, -58, 90);
  truck(48, -72, 0, '#7a6a4a');
  put(block(-136, -86, 7, 20, 7, { type: 'wall', material: 'metal', color: '#6f6a5e', model: 'waterTower' }));
  sandbags(60, -50, 4, 90);
  nest(110, -48, 180);
  scatter(72, -62, 18, 30, 5);
}

// --- South lane: gas station and fuel tanks ------------------------------------------------------
{
  thing(fC, 0, -6, 16, 5.2, 10, { type: 'wall', material: 'metal', color: '#d9d4c7', model: 'fuelCanopy' });
  for (const s of [-1, 1]) {
    thing(fC, s * 4, -6, 1.2, 0.25, 5, { type: 'floor', material: 'concrete', color: '#bdb7aa' });
    for (const dz of [-1.5, 1.5]) thing(fC, s * 4, -6 + dz, 0.6, 1.6, 0.9, { color: '#b3312b', material: 'metal', model: 'pump' });
  }
  car(...fC(-6.2, -5.5), fC.deg + 2);
  car(...fC(6.2, -7), fC.deg - 3);
  building(fC, 0, 10, 14, 9, { style: 'gasShop', floors: 2, doors: 'ns' });
  building(fC, 30, 8, 15, 10, { style: 'office', floors: 2, doors: 'nw' });
  // Two tanks in a low bund west of the shop, a pipe rack, a tanker.
  const T = (u, v, w, h) => thing(fC, u, v, w, h, w, { type: 'wall', material: 'metal', color: '#c9c6ba', model: 'fuelTank' });
  T(-30, 14, 9, 7);
  T(-44, 14, 7, 6);
  putAll(wallLine([fC(-50, 6), fC(-24, 6), fC(-24, 22), fC(-50, 22), fC(-50, 6)], { height: 1.2, thick: 0.5, type: 'cover', material: 'concrete', color: '#a7a398', gaps: [[10, 15], [52, 57]] }));
  for (const y of [0.8, 1.35]) thing(fC, -12, 4, 22, 0.45, 0.45, { lift: y, sink: 0, material: 'metal', color: '#8b8d86' });
  truck(...fC(-18, 24), fC.deg + 90, '#d7d4cc');
  nest(...fC(16, -4), fC.deg + 180);
  sandbags(...fC(-14, -10), 4, fC.deg);
  car(...fC(22, -12), fC.deg + 130, pick(WRECK));
  // Round the forecourt: a corner shop, a house, a burnt tanker and sandbags (zone E's cover).
  addBuilding({ pos: [-34, 62], size: [12, 10], style: 'shop', floors: 2, doors: 'sne' });
  addBuilding({ pos: [22, 60], size: [10, 9], style: 'house', floors: 2, doors: 'snw' });
  truck(...fC(12, 6), fC.deg + 75, '#2f2a26');
  sandbags(...fC(-12, 2), 3.5, fC.deg + 90);
  nest(...fC(6, 16), fC.deg);
  scatter(...fC(0, 4), 10, 24, 5, ['barrel_03', 'barrel_03', 'metal_jerrycan_green', 'old_tyre', 'wooden_military_crate']);
}

// --- B: old-town square ----------------------------------------------------------------------
{
  paint([0, 0], 50, 40, 0, 0.055, '#b9b2a3', 'cobble');
  addBuilding({ pos: [0, -27.5], size: [32, 14], style: 'townhall', floors: 2, doors: 'sn' });
  put(block(0, 0, 6, 1, 6, { material: 'concrete', color: '#c9c3b5', model: 'fountain' }));
  put(block(0, 0, 1, 3.6, 1, { material: 'concrete', color: '#8a8478', model: 'statue' }));
  put(block(-9, 13.5, 2.55, 3.2, 12, { yaw: 90, type: 'wall', material: 'metal', color: '#c9a227', model: 'bus' }));
  for (const [x, z, yaw] of [[-12, -12, 10], [-6, -14, 80], [8, -13, -15], [14, -11, 95]]) put(block(x, z, 1.6, 1.3, 2.4, { yaw, material: 'wood', color: '#7a5a3a', model: 'cart' }));
  for (const [x, z, yaw] of [[-18, -4, 90], [-18, 4, 90], [18, -2, 90], [18, 6, 90], [-6, 17, 0], [8, 17, 0]]) put(block(x, z, 2.2, 0.8, 0.6, { yaw, material: 'wood', color: '#6a4a33', model: 'bench' }));
  // Defenders' barricade at the townhall steps; sandbag walls where streets meet the square.
  sandbags(-5, -18.5, 4, 0);
  sandbags(6, -18.5, 4, 0);
  sandbags(-21, 15, 3, 90);
  sandbags(21, -15, 3, 90);
  for (const [x, z, yaw] of [[16, 10, 40], [20, 14.5, 120]]) car(x, z, yaw);
  scatter(0, 0, 8, 20, 4, ['wooden_military_crate', 'old_military_crate', 'ammo_box']);
  // The square's own fronts: tall blocks between the street mouths.
  addBuilding({ pos: [-31.5, -11], size: [8, 12], style: 'apartment', floors: 4, rot: 90, doors: 'snew' });
  addBuilding({ pos: [-5.7, 25.2], size: [13, 11], style: 'apartment', floors: 4, rot: 180, doors: 'sn' });
  addBuilding({ pos: [19.5, 26], size: [11, 11], style: 'office', rot: 180, doors: 'se' });
  addBuilding({ pos: [30.5, 10], size: [14, 12], style: 'tower', rot: -90, doors: 'sn' });
  addBuilding({ pos: [-28.5, -23.5], size: [11, 10], style: 'shop', floors: 3, rot: 0, doors: 'se' });
}

// --- Town: buildings lining the streets ------------------------------------------------------
const TOWN = [[-160, -104], [160, -104], [160, 104], [-160, 104]];
const keepOut = [
  [Z.D, 24],
  [Z.E, ZR.E + 4],
  [BLUE, 30],
  [RED, 34],
];
const hospitalYard = obb(...fH(0, 4), 66, 38, fH.deg);
const square = obb(0, 0, 46, 36, 0);
const checkpoint = obb(...Z.E, 56, 52, fE.deg);
const freightYard = obb(78, -64, 64, 24, 0);
const gasStation = obb(...fC(-8, 6), 70, 40, fC.deg);
let townLots = 0;
function lotOK(r) {
  if (!inside(TOWN, r.x, r.z) || [hospitalYard, square, checkpoint, freightYard, gasStation].some((o) => overlap(r, o))) return false;
  for (const [x, z] of samples(r, 2)) {
    if (!inMap(x, z, 6) || keepOut.some(([c, cr]) => Math.hypot(x - c[0], z - c[1]) < cr)) return false;
    if (!offRoad(x, z, 1.2) || nearRail(x, z, 4) || nearCanal(x, z, 1.5)) return false;
  }
  return isFree(r);
}
/** Style, size and height for a lot: denser and taller near the square. */
function lotStyle(x, z, kind) {
  const dB = Math.hypot(x, z);
  const roll = R();
  if (kind === 'square') {
    if (roll < 0.45) return { style: 'shop', w: between(9, 13), d: between(10, 12), floors: R() < 0.5 ? 3 : 2 };
    if (roll < 0.75) return { style: 'apartment', w: between(11, 15), d: between(10, 12), floors: R() < 0.5 ? 4 : 3 };
    if (roll < 0.9) return { style: 'tower', w: between(14, 17), d: between(11, 13) };
    return { style: 'office', w: between(12, 15), d: between(11, 12) };
  }
  if (dB < 62 || kind === 'main') {
    if (roll < 0.34) return { style: 'shop', w: between(9, 12), d: between(9, 11), floors: R() < 0.4 ? 3 : 2 };
    if (roll < 0.6) return { style: 'apartment', w: between(11, 15), d: between(9.5, 11.5), floors: R() < 0.3 ? 4 : 3 };
    if (roll < 0.9) return { style: 'house', w: between(8, 10.5), d: between(8, 9.5), floors: R() < 0.25 ? 3 : 2 };
    return { style: 'tower', w: between(14, 17), d: between(11, 13) };
  }
  if (roll < 0.62) return { style: 'house', w: between(7.5, 10), d: between(8, 9.5), floors: R() < 0.3 ? 1 : 2 };
  if (roll < 0.82) return { style: 'shop', w: between(9, 11), d: between(9, 10.5), floors: 2 };
  return { style: 'apartment', w: between(11, 14), d: between(9.5, 11), floors: 3 };
}
/** A ruined house: broken walls of uneven height with blown-out gaps, rubble heaped inside. */
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
  // Rubble: tumbled blocks inside, one heap spilling out of a gap.
  for (let k = 0; k < 4; k++) {
    const [rx, rz] = f(between(-w / 2 + 1.5, w / 2 - 1.5), between(-d / 2 + 1.5, d / 2 - 1.5));
    put({ type: 'cover', pos: [round(rx), round(between(0.2, 0.5)), round(rz)], size: [round(between(1.4, 2.6), 1), round(between(0.6, 1.2), 1), round(between(1.2, 2.2), 1)], rot: yawPitch(R() * 360, between(-12, 12)), material: 'concrete', color: pick(['#8a8178', '#7b6a5e', '#968b80']), snap: true });
  }
  occupy(x, z, w, d, yaw);
}
/**
 * Buildings shoulder to shoulder along one side of a street, fronts (local
 * south, the door side) to the street, with now and then an alley between two.
 */
function frontage(pts, halfW, side, kind) {
  const total = lengthOf(pts);
  let s = 1;
  while (s < total - 3) {
    const p0 = along(pts, s);
    let done = false;
    // A few tries at this spot (smaller each time) before moving on.
    for (let tries = 0; tries < 4 && !done; tries++) {
      const lot = tries < 3 ? lotStyle(p0.x, p0.z, kind) : { style: 'house', w: 7.5, d: 8, floors: 1 };
      if (tries === 2) lot.d = Math.min(lot.d, 9);
      // Upper floors need a short side of ~8.6 m or the stairs don't link them up for bots
      // (navmesh tiles): two-storey lots grow to that rather than lose their upper floor.
      if ((lot.floors ?? 1) > 1) {
        lot.w = Math.max(lot.w, 8.6);
        lot.d = Math.max(lot.d, 8.6);
      }
      if (s + lot.w > total + 1) continue;
      const mid = along(pts, s + lot.w / 2);
      const nx = -mid.tz * side;
      const nz = mid.tx * side;
      const off = halfW + (kind === 'square' ? 1.5 : 1.9) + lot.d / 2;
      const x = mid.x + nx * off;
      const z = mid.z + nz * off;
      const yaw = (Math.atan2(-nx, -nz) * 180) / Math.PI;
      if (!lotOK(obb(x, z, lot.w, lot.d, yaw))) continue;
      // Now and then a house that took a shell: a roofless shell of walls and rubble.
      if (kind !== 'square' && lot.style !== 'tower' && Math.hypot(x, z) > 32 && R() < 0.14) {
        ruin(x, z, lot.w, lot.d, yaw);
        townLots++;
        s += lot.w + 0.5;
        done = true;
        continue;
      }
      // Every building can be entered, most from front and back, some from a side too:
      // the town is fought through, not only round (owner, 2026-10-05).
      const open = true;
      const doors = 's' + (R() < 0.85 ? 'n' : '') + (R() < 0.45 ? pick(['e', 'w']) : '');
      addBuilding({
        pos: [round(x), round(z)],
        size: [round(lot.w, 1), round(lot.d, 1)],
        style: lot.style,
        ...(lot.floors ? { floors: lot.floors } : {}),
        rot: round(yaw + (R() - 0.5) * 2, 1),
        doors: open ? doors : 's',
        ...(open ? {} : { solid: true }),
      });
      townLots++;
      // Mostly shoulder to shoulder; an alley every few buildings.
      s += lot.w + (R() < 0.25 ? between(2.6, 3.6) : 0.5);
      done = true;
    }
    if (!done) s += 1;
  }
}
const SQUARE_EDGES = [
  [[-23, -18], [-23, 18]],
  [[-23, 18], [23, 18]],
  [[23, 18], [23, -18]],
];
for (const e of SQUARE_EDGES) frontage(e, 0, 1, 'square');
for (const r of [M1W, M1E]) for (const side of [-1, 1]) frontage(r.pts, r.w / 2, side, 'main');
for (const r of [NS, SS, XW, ...LANES]) for (const side of [-1, 1]) frontage(r.pts, r.w / 2, side, 'street');
// Courtyards: a shed or garage here and there behind the street fronts.
for (let gx = -104; gx <= 104; gx += 8) {
  for (let gz = -96; gz <= 96; gz += 8) {
    const x = gx + (R() - 0.5) * 4;
    const z = gz + (R() - 0.5) * 4;
    if (R() < 0.45) continue;
    const r = obb(x, z, between(5, 7), between(4.5, 6), R() * 360, 1.5);
    if (!lotOK(r)) continue;
    addBuilding({ pos: [round(x), round(z)], size: [round(r.hw * 2 - 3, 1), round(r.hd * 2 - 3, 1)], style: 'shed', rot: round(Math.atan2(r.ax[1], r.ax[0]) / -DEG, 1), doors: pick(['s', 'n', 'e']) });
  }
}

// --- Cars along the kerbs, roadblocks on the main road ------------------------------------------
let parked = 0;
for (const r of [M1W, M1E, NS, SS]) {
  const total = lengthOf(r.pts);
  for (const side of [-1, 1]) {
    for (let s = 6; s < total - 6; s += between(5.5, 9)) {
      if (R() < (r.w >= 9 ? 0.6 : 0.62)) continue;
      const p = along(r.pts, s);
      const off = r.w / 2 - 1.1;
      const x = p.x - p.tz * side * off;
      const z = p.z + p.tx * side * off;
      // Not in junctions, the square, the bases or the zones' middles.
      if (!inMap(x, z, 5) || (Math.abs(x) < 27 && Math.abs(z) < 22) || Math.abs(x) > 110 || nearCanal(x, z, 2)) continue;
      if (roads.some((o) => o !== r && lineDist(x, z, o.pts) < o.w / 2 + 3)) continue;
      if (Object.values(Z).some(([zx, zz]) => Math.hypot(x - zx, z - zz) < 14)) continue;
      const box = obb(x, z, 1.9, 4.4, p.yaw, 0.3);
      if (!isFree(box)) continue;
      car(x, z, p.yaw + (side < 0 ? 180 : 0) + (R() - 0.5) * 4);
      parked++;
    }
  }
}
/**
 * A roadblock across a road at distance s: a wreck, sandbags and barriers
 * closing one side, the other side left open wide enough for a tank (5 m;
 * a slalom of wrecks across the whole road stopped every bot-driven hull).
 */
function roadblock(r, s, opts = {}) {
  const p = along(r.pts, s);
  const nx = -p.tz;
  const nz = p.tx;
  const half = r.w / 2;
  const at = (k, f = 0) => [p.x + nx * k + p.tx * f, p.z + nz * k + p.tz * f];
  car(...at(-half + 1.2, 0.5), p.yaw + 15 + (R() - 0.5) * 10, pick(WRECK));
  if (opts.both !== false) car(...at(-half + 1.2, -7), p.yaw - 10 + (R() - 0.5) * 10, pick(WRECK));
  sandbags(...at(-half - 0.2, -4), 3.2, p.yaw + 90 + 90);
  barriers(...at(-half * 0.45, 3.5), p.yaw + 90, 2);
}
roadblock(M1W, sAtX(M1W.pts, -36), {});
roadblock(M1E, sAtX(M1E.pts, 34), {});

// --- Trees: the hospital park and a few backyards ----------------------------------------------------
function copse(cx, cz, radius, n) {
  for (let i = 0, placed = 0; placed < n && i < n * 10; i++) {
    const a = R() * Math.PI * 2;
    const r = Math.sqrt(R()) * radius;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (!inMap(x, z, 3) || !offRoad(x, z, 3) || nearRail(x, z, 4) || nearCanal(x, z, 3)) continue;
    if (Object.entries(Z).some(([id, c]) => Math.hypot(x - c[0], z - c[1]) < ZR[id] + 2)) continue;
    if (!isFree(obb(x, z, 1, 1, 0, 2.5)) || trees.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 3.2)) continue;
    trees.push([round(x, 1), round(z, 1), round(between(0.75, 1.3), 2)]);
    placed++;
  }
}
for (const [x, z, r, n] of [
  [...fH(-12, -16), 14, 8], // hospital park
  [...fH(16, -16), 10, 5],
  [-136, -66, 20, 12], // behind the FOB
  [-138, 76, 18, 10],
  [138, -70, 18, 10], // behind the garrison
  [136, 70, 20, 12],
  [-80, 84, 12, 6], // backyards
  [76, 84, 12, 6],
  [-30, -84, 10, 5],
]) copse(x, z, r, n);

// --- Spawns & zones ----------------------------------------------------------------------------
const spawns = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  spawns.push({ team: 'blue', pos: [round(BLUE[0] + Math.cos(a) * 6), 0.1, round(BLUE[1] + Math.sin(a) * 5)], yaw: -90 });
  spawns.push({ team: 'red', pos: [round(RED[0] + Math.cos(a) * 6), 0.1, round(RED[1] + Math.sin(a) * 5)], yaw: 90 });
}
// Zone ids: A the factories, B the square, C the iron gate, D the hospital, E the gas station.
const ZONE_ID = { D: 'A', B: 'B', E: 'C', N: 'D', S: 'E' };
const zones = Object.entries(Z).map(([id, [x, z]]) => ({ id: ZONE_ID[id], pos: [x, 0, z], radius: ZR[id] }));

// --- Self-check: hand-placed buildings off the roads, nothing outside the outline ---------------
const problems = [];
for (const b of buildings) {
  const r = obb(b.pos[0], b.pos[1], b.size[0], b.size[1], b.rot ?? 0);
  if (samples(r, 2).some(([x, z]) => !offRoad(x, z, 0))) problems.push(`building ${b.style} at ${b.pos} is on a road`);
  if (samples(r, 4).some(([x, z]) => !inMap(x, z, 2))) problems.push(`building ${b.style} at ${b.pos} leaves the map`);
}
for (const o of objects) {
  if (o.type === 'floor' && o.size[1] < 0.6) continue;
  if (!inMap(o.pos[0], o.pos[2], 0)) problems.push(`object ${o.model ?? o.type} at ${o.pos} is outside the map`);
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
  // Modes: Frontline A -> D, B, E -> C (the middle row starts neutral); Zone to 400 (five zones).
  modes: { zone: { target: 400 }, frontline: { sectors: [['A'], ['D', 'B', 'E'], ['C']] } },
  objects,
  buildings,
  props,
  trees,
};
writeFileSync(new URL('../../public/maps/iron_gate.json', import.meta.url), JSON.stringify(map));
const styles = {};
for (const b of buildings) styles[b.style + (b.solid ? '*' : '')] = (styles[b.style + (b.solid ? '*' : '')] ?? 0) + 1;
console.log(
  `iron_gate: ${objects.length} objects, ${buildings.length} buildings (${townLots} town lots), ${props.length} props, ${trees.length} trees, ${parked} parked cars, ` +
    `outline ${round(Math.max(...xs) - Math.min(...xs), 0)} x ${round(Math.max(...zs) - Math.min(...zs), 0)} m (${round(Math.abs(area) / 2, 0)} m²), size ${map.world.size}`,
);
console.log(Object.entries(styles).map(([k, v]) => `${k} ${v}`).join(', '));
