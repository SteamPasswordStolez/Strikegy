// Generates public/maps/iron_gate.json — "철문 주둔지" (Iron Gate Garrison).
// 5-zone Zone map, about 500 x 360 m. The blue FOB stands in the south-west,
// the red garrison in the north-east behind its fortified checkpoint, the
// "iron gate" (E). Between them lies an old town around a square (B) with a
// five-storey hospital on the rise to its north-west, a rail freight yard (A,
// north-west), a fuel depot with a gas station (C, south-east) and a factory
// district (D) in front of the blue FOB. Main roads run from both bases to
// every zone; open fields with copses lie between the zones for the tanks.
import { writeFileSync } from 'node:fs';
import { block, edgeDist, inside, lineDist, rng, round, smoothClosed, smoothOpen, stripAlong, wallLine } from './lib.mjs';

const R = rng(20261002);
const DEG = Math.PI / 180;
const objects = [];
const buildings = [];
const props = [];
const trees = [];
const pick = (list) => list[Math.floor(R() * list.length)];
const between = (a, b) => a + R() * (b - a);

// --- Outline -------------------------------------------------------------------
const outline = [
  [-240, -140], [-200, -170], [-130, -178], [-60, -170], [0, -182], [70, -174], [130, -182], [190, -178], [236, -158],
  [252, -110], [244, -50], [252, 10], [236, 70], [205, 125], [150, 158], [80, 176], [10, 168], [-60, 180], [-130, 172],
  [-190, 170], [-238, 150], [-254, 100], [-240, 40], [-252, -30], [-238, -90],
];
const boundary = smoothClosed(outline, 2).map(([x, z]) => [round(x, 1), round(z, 1)]);
const inMap = (x, z, pad = 0) => inside(boundary, x, z) && edgeDist(boundary, x, z) > pad;

// --- Zones, bases, local frames --------------------------------------------------
const CROAD = [75, 112]; // the south road through the depot
const Z = { A: [-75, -112], B: [0, 0], C: [81, 116], D: [-115, 55], E: [115, -55] };
const ZR = { A: 36, B: 34, C: 38, D: 36, E: 34 };
const FOB = [-185, 108];
const BLUE = [-180, 105]; // blue spawn centre (front half of the FOB)
const RED = [176, -100]; // red spawn centre (inside the garrison)
const HOSP = [-42, -62];

/** A local frame at `o` turned by `deg` (map yaw): local x -> world (cos, -sin), local z -> (sin, cos). */
const frame = (o, deg) => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  const f = (lx, lz) => [round(o[0] + lx * c + lz * s), round(o[1] - lx * s + lz * c)];
  f.deg = deg;
  return f;
};
const fD = frame(Z.D, 32); // u along the main road through the factories
const fE = frame(Z.E, 31); // u along the main road toward the red garrison
const fC = frame(CROAD, 15); // u along the south road
const fH = frame(HOSP, 30); // hospital: local +z faces the old town
const fF = frame(FOB, 30); // FOB: local +x faces the front (north-east)

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
  noise: 0.5,
  hills: [
    { pos: [-190, -50], radius: 55, height: 7 }, // west hills between the FOB road and the yard
    { pos: [-150, -95], radius: 30, height: 3.5 },
    { pos: HOSP, radius: 46, height: 3 }, // the hospital stands on a low rise
    { pos: [40, -136], radius: 40, height: 3.5 }, // field rise south of the rail curve
    { pos: [178, 36], radius: 45, height: 4 }, // east fields between the depot and the gate
    { pos: [182, 128], radius: 42, height: 5 },
    { pos: [-62, 148], radius: 40, height: 3 }, // south fields
    { pos: [-205, 30], radius: 35, height: 3 },
    { pos: [35, 62], radius: 26, height: -1.4 }, // a dip between the town and the depot
    { pos: [192, -112], radius: 70, height: 2.2 }, // garrison plateau
  ],
  flats: [
    { pos: [-75, -126], radius: 42, blend: 12 },
    { pos: Z.B, radius: 46, blend: 15 },
    { pos: [80, 115], radius: 40, blend: 12 },
    { pos: Z.D, radius: 42, blend: 12 },
    { pos: Z.E, radius: 40, blend: 12 },
    { pos: FOB, radius: 42, blend: 12 },
    { pos: [192, -110], radius: 50, blend: 12 },
  ],
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
    const keep = (s) => inMap(s.pos[0], s.pos[2], -3);
    objects.push(...stripAlong(line, w, { color, y }).filter(keep));
    // Town streets get pavements on both sides (a wider strip under the street).
    if (town) objects.push(...stripAlong(line, w + 3.4, { color: PAVE, material: 'concrete_floor', y: 0.03 }).filter(keep));
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

// Main road: blue FOB -> factories (D) -> old town square (B) -> iron gate (E) -> red garrison.
const M1W = road([BLUE, fF(28, 0), fD(-40, 0), Z.D, fD(40, 0), [-55, 20], [-23, 6]], 10, { y: 0.07 });
const M1E = road([[23, -6], [55, -22], fE(-45, 0), fE(-28, 0), Z.E, fE(28, 0), fE(55, 0), RED], 10, { y: 0.07 });
// North road: iron gate -> along the rise north of the hospital -> freight yard (A).
const NORTH = road([fE(-12, -6), fE(-15, -24), fE(-17, -34), [70, -86], [40, -97], [10, -98], [-15, -97], [-35, -100], [-52, -100]], 8, { y: 0.065 });
// South road: blue FOB -> south fields -> gas station / fuel depot (C) -> east fields -> iron gate.
road([BLUE, fF(0, 27), [-140, 140], [-90, 142], [-40, 135], [-5, 130], fC(-50, 0), CROAD, fC(50, 0), [138, 70], [146, 25], fE(-9, 34), fE(-9, 24), fE(-9, 6)], 9, { y: 0.065 });
// West road: factories -> over the west hills -> freight yard.
road([fD(-38, 0), [-165, 45], [-168, 5], [-155, -35], [-135, -70], [-112, -90]], 8, { y: 0.065 });
// Branches from the square to the yard (past the hospital) and to the depot.
const BA = road([[20, -18], [28, -40], [24, -62], [8, -84], [-10, -97]], 7, { y: 0.06, town: true });
const BC = road([[6, 18], [12, 45], [28, 75], [38, 116]], 7, { y: 0.06, town: true });
// Hospital drive.
road([fH(24, 16), [10, -60], [24, -61]], 6, { y: 0.055, smooth: 1 });
// Old-town streets: two long streets south of the main road, a north-east
// quarter street, a lane round the hospital side, short cross lanes between them.
const street = (pts, w = 5.5, y = 0.05) => road(pts, w, { y, town: true, smooth: 1 });
const lane = (pts) => road(pts, 4.5, { y: 0.045, town: true, color: LANE, smooth: 1 });
const STREETS = [
  street([[-56, 50], [-30, 45], [-2, 40], [34, 33], [62, 20], [86, 17]]),
  street([[-66, 90], [-42, 83], [-2, 80], [24, 73], [48, 69]]),
  street([[26, -30], [48, -37], [64, -27]]),
  street([[-23, -12], [-45, -10], [-68, -4], [-84, 10], [-87, 32]]),
];
const LANES = [
  lane([[-45, 15.5], [-43, 31], [-42, 46]]),
  lane([[38, -13], [41, 10], [42, 31]]),
  lane([[-16, 18], [-19, 30], [-22, 43]]),
  lane([[-50, 50], [-52, 66], [-54, 85]]),
  lane([[60, 21], [66, 44], [58, 68]]),
  lane([[-30, 81], [-33, 105], [-36, 133]]),
];
// Country lane from the town's east end out to the south road.
road([[86, 17], [110, 30], [143, 47]], 5, { y: 0.045, color: LANE, smooth: 1 });

// --- Rail ----------------------------------------------------------------------------
const RAIL_MAIN = smoothOpen([[-290, -140], [-200, -144], [-130, -150], [-60, -151], [0, -150], [40, -156], [75, -172], [100, -205]], 2);
const S1 = smoothOpen([[-140, -150], [-120, -142], [-100, -139], [-40, -139], [-20, -146], [0, -150]], 2);
const S2 = smoothOpen([[-120, -142], [-100, -130], [-50, -128], [-38, -129]], 2);
const S3 = smoothOpen([[-100, -130], [-86, -119], [-52, -118]], 2);
const tracks = [RAIL_MAIN, S1, S2, S3];
for (const line of tracks) {
  const inside_ = line.filter(([x, z]) => inMap(x, z, -25));
  objects.push(...stripAlong(inside_, 3.2, { color: '#5b5048', material: 'ground', y: 0.12, thickness: 0.4 }).filter((s) => inMap(s.pos[0], s.pos[2], -2)));
  for (const off of [-0.72, 0.72]) {
    const pts = inside_.map(([x, z], i) => {
      const [ax, az] = inside_[Math.max(0, i - 1)];
      const [bx, bz] = inside_[Math.min(inside_.length - 1, i + 1)];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      return [x + (-(bz - az) / len) * off, z + ((bx - ax) / len) * off];
    });
    objects.push(...stripAlong(pts, 0.12, { color: '#6d6a66', material: 'metal', y: 0.28, thickness: 0.16, type: 'prop' }).filter((s) => inMap(s.pos[0], s.pos[2], -2)));
  }
}
const nearRail = (x, z, pad) => tracks.some((t) => lineDist(x, z, t) < pad);
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

// --- Blue FOB (south-west) -------------------------------------------------------------
{
  // Hesco ring; gates: front (main road), right (south road), left (footpath north).
  const ring = [fF(28, -26), fF(28, 26), fF(-28, 28), fF(-30, -24), fF(28, -26)];
  hesco(ring, [[19, 33], [74, 86], [190, 197]]);
  // Tents and supplies along the sides of the front half; the back half is the vehicle park.
  for (const [lx, lz] of [[16, -19], [6, -19], [-4, -20]]) thing(fF, lx, lz, 5, 3, 4, { type: 'wall', material: 'wood', color: '#6f6e4e', model: 'tent' });
  for (const [lx, lz] of [[18, 19], [8, 20]]) thing(fF, lx, lz, 5, 3, 4, { type: 'wall', material: 'wood', color: '#6f6e4e', model: 'tent' });
  container(fF, -6, 22, 90);
  container(fF, -14, 22, 90, 2);
  thing(fF, 22, -12, 0.9, 1.1, 3.4, { material: 'ground', color: SAND, model: 'sandbags' });
  thing(fF, 22, 12, 0.9, 1.1, 3.4, { material: 'ground', color: SAND, model: 'sandbags' });
  for (const [lx, lz] of [[27, -24], [26, 24], [-27, 26], [-28, -22]]) tower(...fF(lx, lz), fF.deg);
  // Gravel motor pool in the back half (paint only).
  paint(fF(-15, 0), 26, 44, fF.deg, 0.04, '#8a8070', 'ground');
  scatter(...fF(4, 0), 10, 20, 5);
}

// --- Red garrison (north-east) ---------------------------------------------------------
const BASE_WALL = [[141.5, -117.6], [160, -150], [190, -160], [220, -146], [234, -100], [220, -60], [177.5, -57.6], [141.5, -117.6]];
{
  const len = (i) => Math.hypot(BASE_WALL[i + 1][0] - BASE_WALL[i][0], BASE_WALL[i + 1][1] - BASE_WALL[i][1]);
  let acc = 0;
  const offs = BASE_WALL.slice(0, -1).map((_, i) => ((acc += len(i)), acc - len(i)));
  // Main gate where the road comes through from the checkpoint; a side gate to the north fields.
  const mainAt = offs[6] + Math.hypot(162.1 - 177.5, -83.3 + 57.6);
  putAll(wallLine(BASE_WALL, { height: 3.6, thick: 0.5, color: '#a39f93', gaps: [[mainAt - 7.5, mainAt + 7.5], [offs[0] + 14, offs[0] + 20], [offs[6] + 6, offs[6] + 9]] }));
  for (const [x, z] of BASE_WALL.slice(0, -1)) tower(x, z);
  addBuilding({ pos: [178, -140], size: [26, 12], style: 'hq', floors: 3, rot: 18, doors: 'sn' });
  addBuilding({ pos: [207, -136], size: [22, 18], style: 'hangar', rot: 18, doors: 's' });
  addBuilding({ pos: [190, -70], size: [20, 8], style: 'barracks', doors: 'n' });
  addBuilding({ pos: [210, -73], size: [14, 8], style: 'barracks', doors: 'nw' });
  for (const [x, z] of [[155, -120], [162, -110]]) put(block(x, z, 5, 3, 4, { yaw: 30, type: 'wall', material: 'wood', color: '#6f6e4e', model: 'tent' }));
  for (const [x, z, yaw] of [[226, -118, 165], [225, -106, 168], [198, -86, 90]]) truck(x, z, yaw);
  // Concrete motor pool east of the spawns (pads and tank spots are found on it at load).
  paint([203, -104], 30, 32, 18, 0.04, '#8e8c86');
  container(frame([150, -98], 30), 0, 0, 0, 2);
  container(frame([155, -92], 30), 0, 0, 10);
  scatter(170, -125, 4, 12, 4);
}

// --- E: the iron gate checkpoint ---------------------------------------------------------
{
  const W = { height: 4.2, thick: 0.6, color: '#9a978c', material: 'concrete' };
  // Front (towards the town): the iron gate in the middle, a breach in the north part.
  putAll(wallLine([fE(-28, -24), fE(-28, 24)], { ...W, gaps: [[18, 30], [5, 8.5]] }));
  // Rear (towards the garrison).
  putAll(wallLine([fE(28, -24), fE(28, 24)], { ...W, gaps: [[18, 30]] }));
  // North-west side: gate for the north road. South-east side: gate for the south road and a breach.
  putAll(wallLine([fE(-28, -24), fE(28, -24)], { ...W, gaps: [[8, 18]] }));
  putAll(wallLine([fE(-28, 24), fE(28, 24)], { ...W, gaps: [[14, 24], [42, 45]] }));
  for (const [u, v] of [[-25.5, -21.5], [25.5, -21.5], [-25.5, 21.5], [25.5, 21.5]]) tower(...fE(u, v), fE.deg);
  // The gate itself: two steel leaves standing open, a gantry over the opening.
  for (const s of [-1, 1]) {
    thing(fE, -24.6, s * 6.6, 6, 4.4, 0.35, { yaw: 90, type: 'wall', material: 'metal', color: '#3f4448' });
    thing(fE, -28, s * 7, 1.2, 6.2, 1.2, { type: 'wall', material: 'concrete', color: '#85827a' });
  }
  const [gx, gz] = fE(-28, 0);
  put({ type: 'wall', pos: [gx, 6.1, gz], size: [1, 0.9, 15.2], rot: [0, fE.deg, 0], material: 'metal', color: '#3f4448', snap: true });
  // HQ and barracks inside.
  building(fE, 15, -14, 22, 12, { style: 'hq', floors: 2, doors: 'swe' });
  building(fE, 12, 15.5, 20, 8, { style: 'barracks', doors: 'nw' });
  // Guard booths, hesco firing lines, sandbag nests at the gates, containers, trucks.
  thing(fE, -22, -10, 2.4, 2.8, 2.4, { type: 'wall', material: 'wood', color: '#6d6450', model: 'booth' });
  thing(fE, -22, 10, 2.4, 2.8, 2.4, { type: 'wall', material: 'wood', color: '#6d6450', model: 'booth' });
  hesco([fE(-16, -20), fE(-16, -9)]);
  hesco([fE(-10, 9), fE(-10, 18)]);
  hesco([fE(2, -3.5), fE(2, -8)]);
  nest(...fE(-23, -16), fE.deg - 90);
  nest(...fE(-23, 16), fE.deg - 90);
  nest(...fE(24, -10), fE.deg + 90);
  nest(...fE(-6, 20), fE.deg);
  container(fE, 0, -18, 90, 2);
  container(fE, 8, 4.5, 90);
  container(fE, 22, 15, 0);
  truck(...fE(-4, 10), fE.deg + 90);
  truck(...fE(20, -3.5), fE.deg - 90, '#4d5a3c');
  scatter(...Z.E, 6, 24, 7);
  // Outside the gate: a staggered roadblock, wrecks, hesco wings and a dead tank in the field.
  barriers(...fE(-40, -6), fE.deg + 90, 4);
  barriers(...fE(-48, 6), fE.deg + 90, 4);
  hesco([fE(-33, -12), fE(-33, -22)]);
  hesco([fE(-33, 12), fE(-33, 22)]);
  car(...fE(-37, 11), fE.deg + 70, pick(WRECK));
  car(...fE(-52, -10), fE.deg + 15, pick(WRECK));
  put(block(...fE(-58, 20), 3.6, 2.6, 7.2, { yaw: fE.deg + 50, type: 'wall', material: 'metal', color: '#4a4c3e', model: 'tankWreck' }));
  nest(...fE(-36, -28), fE.deg - 90);
}

// --- D: factory district ----------------------------------------------------------------
{
  // North of the road: the big hall with an office annex at its east end.
  building(fD, -4, -25, 44, 22, { style: 'factory', doors: 'snew' });
  building(fD, 25.6, -24, 14, 12, { style: 'office', floors: 3, doors: 'se' });
  // South of the road: second hall with a loading dock and trucks backed up to it.
  building(fD, 6, 32, 38, 20, { style: 'factory', doors: 'nsw' });
  thing(fD, 6, 20, 32, 1.2, 4, { type: 'floor', material: 'concrete', color: '#9b978d' });
  ramp(...fD(-10.2, 20), fD.deg - 90, 5, 3.6, 1.2);
  for (const u of [-4, 6, 16]) truck(...fD(u, 13.6), fD.deg + 180, pick(['#55603f', '#7a6a4a', '#5a5f66']));
  // Boiler house with its brick chimney, a store shed east.
  building(fD, -32, 26, 14, 12, { style: 'warehouse', doors: 'ne' });
  thing(fD, -32, 36, 3.2, 28, 3.2, { type: 'wall', material: 'brick', color: '#7b4a3a' });
  building(fD, 36, 26, 18, 14, { style: 'warehouse', doors: 'nw' });
  // Yard clutter, containers, a burnt-out tank on the road edge (the halls furnish themselves).
  container(fD, -28, -9, 0, 2);
  container(fD, 30, -9, 90);
  container(fD, 24, 11, 0);
  container(fD, -20, 11, 90, 2);
  put(block(...fD(-14, 8.4), 3.6, 2.6, 7.2, { yaw: fD.deg + 80, type: 'wall', material: 'metal', color: '#4a4c3e', model: 'tankWreck' }));
  sandbags(...fD(0, -8), 4, fD.deg + 90);
  sandbags(...fD(-36, 9), 3.5, fD.deg + 90);
  scatter(...Z.D, 6, 30, 9);
}

// --- A: rail freight yard ------------------------------------------------------------------
{
  const fA = frame([0, 0], 0);
  // Freight warehouse behind a loading platform along the spur, a second shed at the west end.
  addBuilding({ pos: [-78, -102], size: [36, 16], style: 'warehouse', doors: 'nse' });
  put(block(-77, -113, 44, 1.1, 4, { type: 'floor', material: 'concrete', color: '#a19c90' }));
  ramp(-99, -113, -90, 5, 3.4, 1.1);
  ramp(-55, -113, 90, 5, 3.4, 1.1);
  addBuilding({ pos: [-138, -113], size: [14, 26], style: 'warehouse', doors: 'ew' });
  // Freight office by the east throat, water tower by the west one.
  addBuilding({ pos: [-16, -122], size: [14, 9], style: 'station', doors: 'ns' });
  put(block(-110, -122, 7, 20, 7, { type: 'wall', material: 'metal', color: '#6f6a5e', model: 'waterTower' }));
  // Wagons on the tracks.
  for (const x of [-48, -34]) boxcar(RAIL_MAIN, x);
  for (const x of [-104, -91, -66]) boxcar(S1, x);
  for (const x of [-78, -54]) boxcar(S2, x);
  for (const x of [-77, -63]) boxcar(S3, x);
  // Container stacks east of the sidings (alleys between the rows).
  for (const [x, z, s] of [[-42, -122, 2], [-42, -114, 3], [-33, -120, 1], [-33, -112, 2], [-24, -116, 2], [-48, -106, 1]]) container(fA, x, z, 90, s);
  container(fA, -28, -104, 0);
  container(fA, -120, -96, 20, 2);
  truck(-55.5, -88, 0, '#7a6a4a');
  truck(-122, -86, 160);
  // South yard: lorries backed up to the warehouse, a container row, the yard office.
  for (const x of [-88, -70]) truck(x, -89.5, 180, pick(['#7a6a4a', '#5a5f66', '#55603f']));
  for (const [x, s] of [[-98, 2], [-91.5, 1], [-64, 1]]) container(fA, x, -80, 0, s);
  addBuilding({ pos: [-79, -79], size: [8, 6], style: 'shed', doors: 'ns' });
  sandbags(-104, -96, 3.5, 0);
  sandbags(-70, -124, 4, 90);
  sandbags(-86, -134, 3.5, 90);
  nest(-30, -132, 180);
  scatter(...Z.A, 6, 30, 10);
}

// --- C: fuel depot and gas station -----------------------------------------------------------
{
  // Gas station north of the road: canopy over two pump islands, the shop behind it, cars at the pumps.
  thing(fC, -18, -14, 16, 5.2, 10, { type: 'wall', material: 'metal', color: '#d9d4c7', model: 'fuelCanopy' });
  for (const s of [-1, 1]) {
    thing(fC, -18 + s * 4, -14, 1.2, 0.25, 5, { type: 'floor', material: 'concrete', color: '#bdb7aa' });
    for (const dz of [-1.5, 1.5]) thing(fC, -18 + s * 4, -14 + dz, 0.6, 1.6, 0.9, { color: '#b3312b', material: 'metal', model: 'pump' });
  }
  car(...fC(-24.2, -13.5), fC.deg + 2);
  car(...fC(-11.8, -15), fC.deg - 3);
  building(fC, -18, -29, 14, 9, { style: 'gasShop', doors: 'se' });
  for (const [i, u] of [-30, -27.4, -6.6].entries()) if (i !== 1 || R() < 0.7) car(...fC(u, -30), fC.deg + (R() - 0.5) * 6);
  // Depot south of the road: two big tanks in a bund, two smaller ones, a pipe rack, the loading gantry.
  const T = (u, v, w, h) => thing(fC, u, v, w, h, w, { type: 'wall', material: 'metal', color: '#c9c6ba', model: 'fuelTank' });
  T(4, 26, 13, 10);
  T(23, 26, 13, 10);
  T(42, 19, 9, 7);
  T(42, 33, 7, 6);
  putAll(wallLine([fC(-5, 17), fC(32, 17), fC(32, 36), fC(-5, 36), fC(-5, 17)], { height: 1.2, thick: 0.5, type: 'cover', material: 'concrete', color: '#a7a398', gaps: [[16, 21], [70, 75]] }));
  for (const y of [0.8, 1.35]) thing(fC, 18, 11, 50, 0.45, 0.45, { lift: y, sink: 0, material: 'metal', color: '#8b8d86' });
  for (let u = -6; u <= 42; u += 6) thing(fC, u, 11, 0.25, 1.6, 0.8, { material: 'metal', color: '#6b6d66' });
  thing(fC, 56, 20, 14, 6.5, 8, { type: 'wall', material: 'metal', color: '#c8c3b5', model: 'fuelCanopy' });
  truck(...fC(56, 20), fC.deg + 90, '#d7d4cc');
  truck(...fC(54, 33), fC.deg + 95, '#b9b6ae');
  truck(...fC(-30, 18), fC.deg + 80, '#d7d4cc');
  building(fC, -12, 28, 8, 6, { style: 'shed', doors: 'n' });
  nest(...fC(8, 7.5), fC.deg + 180);
  sandbags(...fC(-14, 6), 4, fC.deg);
  car(...fC(30, -10), fC.deg + 130, pick(WRECK));
  // North-east of the road: the depot office, a container stack, a burnt tanker.
  building(fC, 30, -24, 15, 10, { style: 'office', floors: 2, doors: 'sw' });
  container(fC, 14, -22, 90, 2);
  container(fC, 14, -14, 85);
  truck(...fC(44, -12), fC.deg + 60, '#2f2a26');
  scatter(...Z.C, 8, 34, 9, ['barrel_03', 'barrel_03', 'metal_jerrycan_green', 'old_tyre', 'wooden_military_crate']);
}

// --- Hospital: the landmark on the rise between the yard and the square -------------------------
{
  building(fH, 0, 0, 48, 20, { style: 'hospital', floors: 5, doors: 'snew' });
  // Forecourt with parking bays, the entrance canopy and ambulances.
  paint(fH(0, 16), 60, 12, fH.deg, 0.055, '#9d9a93');
  thing(fH, 0, 13, 10, 4.2, 6, { type: 'wall', material: 'concrete', color: '#e2ded6', model: 'fuelCanopy' });
  truck(...fH(-8, 13.5), fH.deg + 90, '#e8e6e0');
  truck(...fH(9, 13.5), fH.deg - 90, '#e8e6e0');
  for (const side of [-1, 1]) {
    for (let k = 0; k < 7; k++) {
      const lx = side * (14 + k * 2.6);
      paint(fH(lx - 1.3, 18.5), 0.12, 5, fH.deg, 0.07, '#e5e2da');
      if (R() < 0.7) car(...fH(lx, 18.5), fH.deg + (R() < 0.5 ? 0 : 180) + (R() - 0.5) * 4);
    }
  }
  // Park behind: benches, sandbags where the defenders dug in.
  for (const lx of [-16, -4, 8, 20]) thing(fH, lx, -14, 2.2, 0.8, 0.6, { material: 'wood', color: '#6a4a33', model: 'bench' });
  sandbags(...fH(-26, 4), 3.5, fH.deg + 90);
  sandbags(...fH(26, -4), 3.5, fH.deg + 90);
}

// --- B: old-town square ----------------------------------------------------------------------
{
  paint([0, 0], 50, 40, 0, 0.055, '#b9b2a3');
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
  addBuilding({ pos: [-31.5, -2.5], size: [8, 12], style: 'apartment', floors: 4, rot: 90, doors: 'snew' });
  addBuilding({ pos: [-5.7, 25.2], size: [13, 11], style: 'apartment', floors: 4, rot: 180, doors: 'sn' });
  addBuilding({ pos: [19.5, 26], size: [11, 11], style: 'office', rot: 180, doors: 'se' });
  addBuilding({ pos: [30.5, 10], size: [14, 12], style: 'tower', rot: -90, doors: 'sn' });
  addBuilding({ pos: [-28.5, -23.5], size: [11, 10], style: 'shop', floors: 3, rot: 0, doors: 'se' });
}

// --- Old town: buildings lining the streets ------------------------------------------------------
const TOWN = [[-100, -12], [-84, -38], [-58, -28], [-10, -50], [4, -80], [0, -114], [66, -114], [74, -78], [70, -60], [92, -25], [104, 22], [86, 58], [52, 92], [0, 108], [-50, 104], [-92, 80], [-104, 30]];
const keepOut = [
  [Z.D, ZR.D + 8],
  [Z.E, ZR.E + 6],
  [fE(-45, 0), 20],
  [Z.C, ZR.C + 8],
  [Z.A, ZR.A + 6],
];
const hospitalYard = obb(...fH(0, 4), 66, 38, fH.deg);
const square = obb(0, 0, 46, 36, 0);
let townLots = 0;
function lotOK(r) {
  if (!inside(TOWN, r.x, r.z) || overlap(r, hospitalYard) || overlap(r, square)) return false;
  for (const [x, z] of samples(r, 2)) {
    if (!inMap(x, z, 6) || keepOut.some(([c, cr]) => Math.hypot(x - c[0], z - c[1]) < cr)) return false;
    if (!offRoad(x, z, 1.2)) return false;
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
      const lot = tries < 3 ? lotStyle(p0.x, p0.z, kind) : { style: 'house', w: 7.5, d: 8, floors: 2 };
      if (tries === 2) lot.d = Math.min(lot.d, 9);
      if (s + lot.w > total + 1) continue;
      const mid = along(pts, s + lot.w / 2);
      const nx = -mid.tz * side;
      const nz = mid.tx * side;
      const off = halfW + (kind === 'square' ? 1.5 : 1.9) + lot.d / 2;
      const x = mid.x + nx * off;
      const z = mid.z + nz * off;
      const yaw = (Math.atan2(-nx, -nz) * 180) / Math.PI;
      if (!lotOK(obb(x, z, lot.w, lot.d, yaw))) continue;
      const dZone = Math.min(...Object.entries(Z).map(([id, c]) => Math.hypot(x - c[0], z - c[1]) - ZR[id]));
      // Near the fights and in the old core: enterable. Further out: closed blocks with painted fronts.
      const open = Math.hypot(x, z) < 70 || dZone < 22 || R() < 0.2;
      const doors = 's' + (R() < 0.6 ? 'n' : '') + (R() < 0.3 ? pick(['e', 'w']) : '');
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
for (const r of [BA, BC, ...STREETS, ...LANES]) for (const side of [-1, 1]) frontage(r.pts, r.w / 2, side, 'street');
for (const side of [-1, 1]) frontage(NORTH.pts, NORTH.w / 2, side, 'street'); // rail workers' row on the north road
// Courtyards: a shed or garage here and there behind the street fronts.
for (let gx = -100; gx <= 95; gx += 9) {
  for (let gz = -60; gz <= 104; gz += 9) {
    const x = gx + (R() - 0.5) * 4;
    const z = gz + (R() - 0.5) * 4;
    if (R() < 0.7) continue;
    const r = obb(x, z, between(5, 7), between(4.5, 6), R() * 360, 1.5);
    if (!lotOK(r)) continue;
    addBuilding({ pos: [round(x), round(z)], size: [round(r.hw * 2 - 3, 1), round(r.hd * 2 - 3, 1)], style: 'shed', rot: round(Math.atan2(r.ax[1], r.ax[0]) / -DEG, 1), doors: pick(['s', 'n', 'e']) });
  }
}

// --- Cars along the kerbs, barricades where the streets enter the zones -----------------------------
let parked = 0;
for (const r of [M1W, M1E, BA, BC, STREETS[0], STREETS[1]]) {
  const total = lengthOf(r.pts);
  for (const side of [-1, 1]) {
    for (let s = 6; s < total - 6; s += between(5.5, 9)) {
      if (R() < (r.w >= 10 ? 0.62 : 0.7)) continue;
      const p = along(r.pts, s);
      const off = r.w / 2 - 1.1;
      const x = p.x - p.tz * side * off;
      const z = p.z + p.tx * side * off;
      // Not in junctions, the square or the zones' middles.
      if (!inMap(x, z, 5) || Math.abs(x) < 27 && Math.abs(z) < 22) continue;
      if (roads.some((o) => o !== r && lineDist(x, z, o.pts) < o.w / 2 + 3)) continue;
      if (Object.values(Z).some(([zx, zz]) => Math.hypot(x - zx, z - zz) < 14)) continue;
      const box = obb(x, z, 1.9, 4.4, p.yaw, 0.3);
      if (!isFree(box)) continue;
      car(x, z, p.yaw + (side < 0 ? 180 : 0) + (R() - 0.5) * 4);
      parked++;
    }
  }
}
/** A roadblock across a road at distance s: wrecks askew, sandbags, barriers, a lane left open. */
function roadblock(r, s, opts = {}) {
  const p = along(r.pts, s);
  const nx = -p.tz;
  const nz = p.tx;
  const half = r.w / 2;
  const at = (k, f = 0) => [p.x + nx * k + p.tx * f, p.z + nz * k + p.tz * f];
  car(...at(-half + 1.6, 0.5), p.yaw + 70 + (R() - 0.5) * 20, pick(WRECK));
  if (opts.both !== false) car(...at(half - 1.4, -2.5), p.yaw - 60 + (R() - 0.5) * 20, pick(WRECK));
  sandbags(...at(-half - 0.2, -4), 3.2, p.yaw + 90 + 90);
  barriers(...at(half * 0.3, 3.5), p.yaw + 90, 2);
}
roadblock(M1W, sAtX(M1W.pts, -63), {});
roadblock(M1E, sAtX(M1E.pts, 58), {});
roadblock(BC, 38, { both: false });
roadblock(BA, 26, { both: false });

// --- Out in the fields: a chapel on the west hill, two farms, stone walls, wrecks -------------
const STONE = '#8d887e';
/** A low stone field wall along a line, broken where it meets roads, tracks or anything solid. */
function fieldWall(pts) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 4));
    const yaw = (Math.atan2(bx - ax, bz - az) * 180) / Math.PI;
    for (let k = 0; k < n; k++) {
      if (R() < 0.14) continue; // tumbled-down gaps
      const t = (k + 0.5) / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const piece = obb(x, z, 0.7, len / n + 0.05, yaw, 0.4);
      if (!inMap(x, z, 3) || !offRoad(x, z, 2) || nearRail(x, z, 3) || !isFree(piece)) continue;
      put(block(x, z, 0.7, between(0.95, 1.15), len / n + 0.05, { yaw, type: 'cover', material: 'concrete', color: STONE }));
    }
  }
}
{
  // Chapel with its steeple in a walled churchyard on the crest of the west hill.
  const fK = frame([-192, -50], 10);
  building(fK, 0, 2, 9.5, 19, { style: 'chapel', doors: 'se' });
  thing(fK, 0, -10, 5, 22, 5, { type: 'wall', material: 'brick', color: '#948b7e', model: 'steeple' });
  putAll(wallLine([fK(-14, -20), fK(14, -20), fK(14, 22), fK(-14, 22), fK(-14, -20)], { height: 1.1, thick: 0.6, type: 'cover', material: 'concrete', color: STONE, gaps: [[60, 64], [84, 88], [124, 127]] }));
  for (let i = 0; i < 14; i++) thing(fK, (i % 2 ? 1 : -1) * between(7, 11.5), -14 + Math.floor(i / 2) * 4.6, 0.7, 0.9, 0.22, { type: 'cover', material: 'concrete', color: '#9b968c' });
  occupy(...fK(0, 1), 30, 44, fK.deg);
}
{
  // Farm by the south road: barn, farmhouse, hay, logs, a walled yard.
  const fM = frame([-112, 119], 0);
  building(fM, -6, 0, 20, 12, { style: 'barn', doors: 'ew' });
  building(fM, 16, 2, 10, 9, { style: 'house', floors: 2, rot: 180, doors: 'snew' });
  for (const [u, v, yaw] of [[-4, 10, 0], [-1, 10.5, 10], [2, 10, -5], [-6, -9, 90]]) thing(fM, u, v, 2.6, 1.5, 1.5, { yaw, material: 'wood', color: '#b89a5a', model: 'hayBale' });
  thing(fM, 8, -9, 6, 1.6, 2.4, { material: 'wood', color: '#86684a', model: 'logPile' });
  thing(fM, 6, 9, 1.6, 1.3, 2.4, { yaw: 30, material: 'wood', color: '#7a5a3a', model: 'cart' });
  fieldWall([fM(-20, -12), fM(26, -12), fM(26, 12)]);
}
{
  // Farm in the east fields between the depot and the gate.
  const fM = frame([186, 76], 20);
  building(fM, 0, 0, 18, 12, { style: 'barn', doors: 'ew' });
  building(fM, -16, 14, 9, 9, { style: 'house', floors: 2, doors: 'sw' });
  for (const [u, v, yaw] of [[10, 10, 0], [13, 10.4, 6], [10, 13, 90]]) thing(fM, u, v, 2.6, 1.5, 1.5, { yaw, material: 'wood', color: '#b89a5a', model: 'hayBale' });
  thing(fM, -6, -10, 6, 1.6, 2.4, { material: 'wood', color: '#86684a', model: 'logPile' });
  fieldWall([fM(-26, -14), fM(18, -14), fM(18, 22)]);
}
for (const line of [
  [[-218, 12], [-182, 2], [-150, -14]],
  [[-80, 152], [-40, 158], [0, 152], [30, 156]],
  [[150, -8], [182, 2], [214, -8]],
  [[120, 52], [134, 84], [154, 104]],
  [[16, -118], [55, -122], [88, -112]],
  [[212, 20], [208, 52]],
  [[-150, -100], [-170, -128], [-206, -128]],
  [[-60, 104], [-90, 102]],
]) fieldWall(line);
// Burnt-out tank in the east fields, a burnt truck by the north road, a wreck by the south road.
put(block(162, 36, 3.6, 2.6, 7.2, { yaw: 35, type: 'wall', material: 'metal', color: '#4a4c3e', model: 'tankWreck' }));
truck(56, -108, 75, '#2f2a26');
car(-60, 146, 80, pick(WRECK));

// --- Trees: copses in the fields and the hospital park ----------------------------------------------
function copse(cx, cz, radius, n) {
  for (let i = 0, placed = 0; placed < n && i < n * 10; i++) {
    const a = R() * Math.PI * 2;
    const r = Math.sqrt(R()) * radius;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (!inMap(x, z, 3) || !offRoad(x, z, 3) || nearRail(x, z, 4)) continue;
    if (Object.entries(Z).some(([id, c]) => Math.hypot(x - c[0], z - c[1]) < ZR[id] + 2)) continue;
    if (!isFree(obb(x, z, 1, 1, 0, 2.5)) || trees.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 3.2)) continue;
    trees.push([round(x, 1), round(z, 1), round(between(0.75, 1.3), 2)]);
    placed++;
  }
}
for (const [x, z, r, n] of [
  [-195, -60, 40, 60], // west hills
  [-205, 20, 22, 18],
  [-150, -10, 18, 12],
  [-150, 148, 16, 10], // south fields
  [-75, 128, 14, 10],
  [-55, 150, 24, 20],
  [5, 150, 18, 12],
  [135, 140, 22, 18], // behind the depot
  [185, 60, 24, 22], // east fields
  [170, 5, 14, 9],
  [105, 30, 14, 10],
  [40, -130, 26, 22], // north field by the rail curve
  [90, -125, 18, 12],
  [-165, -150, 20, 12],
  [-200, 150, 14, 8],
  [...fH(-10, -18), 16, 10], // hospital park
  [228, -30, 16, 10],
]) copse(x, z, r, n);

// --- Spawns & zones ----------------------------------------------------------------------------
const spawns = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  spawns.push({ team: 'blue', pos: [round(BLUE[0] + Math.cos(a) * 6), 0.1, round(BLUE[1] + Math.sin(a) * 5)], yaw: -60 });
  spawns.push({ team: 'red', pos: [round(RED[0] + Math.cos(a) * 6), 0.1, round(RED[1] + Math.sin(a) * 5)], yaw: 120 });
}
const zones = Object.entries(Z).map(([id, [x, z]]) => ({ id, pos: [x, 0, z], radius: ZR[id] }));

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
  trees,
};
writeFileSync(new URL('../../public/maps/iron_gate.json', import.meta.url), JSON.stringify(map));
const styles = {};
for (const b of buildings) styles[b.style + (b.solid ? '*' : '')] = (styles[b.style + (b.solid ? '*' : '')] ?? 0) + 1;
console.log(
  `iron_gate: ${objects.length} objects, ${buildings.length} buildings (${townLots} town lots), ${props.length} props, ${trees.length} trees, ${parked} parked cars, ` +
    `outline ${round(Math.max(...xs) - Math.min(...xs), 0)} x ${round(Math.max(...zs) - Math.min(...zs), 0)} m, size ${map.world.size}`,
);
console.log(Object.entries(styles).map(([k, v]) => `${k} ${v}`).join(', '));
