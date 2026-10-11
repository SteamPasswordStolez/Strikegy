// Generates public/maps/persia.json — "페르시아 침공" (Persian Invasion), desert.
// Second layout (2026-10-11, owner: redesign the other maps too, so fights come often): a
// compact desert village, about 170 x 125 m for 4v4 (the old 1v1-2v2 map was 25,000 m² and
// its fights were rare). Blue comes in from the north-west, red from the south-east. A wadi
// runs north-south through the middle, green with palms at the oasis:
//   A the round village square with its well and market lanes (west of the wadi),
//   B the oasis bridge over the wadi, a ruined caravanserai beside it,
//   C the walled fort (east of the wadi): a gate, a breach, barracks and the commander's house.
// A watch post on a rise in the north-east, rocky ground and a ford in the south give the long way round.
import { writeFileSync } from 'node:fs';
import { block, edgeDist, inside, lineDist, rng, round, smoothClosed, smoothOpen, wallLine } from './lib.mjs';
import { createTown, frame, obb, outlineStats, spawnRings } from './town.mjs';

const R = rng(20261013);

// --- Outline ---------------------------------------------------------------------------
const outline = [
  [-86, -40], [-70, -60], [-30, -64], [10, -60], [50, -66], [80, -54], [90, -20], [86, 20], [90, 50], [70, 64],
  [30, 62], [-10, 66], [-50, 60], [-82, 46], [-90, 6],
];
const boundary = smoothClosed(outline, 2).map(([x, z]) => [round(x, 1), round(z, 1)]);
const inMap = (x, z, pad = 0) => inside(boundary, x, z) && edgeDist(boundary, x, z) > pad;

// --- Zones, bases ---------------------------------------------------------------------
const Z = { A: [-48, -4], B: [6, 2], C: [52, 6] };
const ZR = { A: 15, B: 13, C: 15 };
const BLUE = [-72, -44];
const RED = [74, 44];
const WATCH = [50, -44];

// --- The wadi ---------------------------------------------------------------------------
const WADI = {
  pts: smoothOpen([[2, -140], [4, -60], [10, -30], [6, 0], [2, 30], [10, 60], [14, 140]], 2),
  width: 5,
  depth: 2.4,
  bank: 3.5,
  water: 0.3,
};
const nearWadi = (x, z, pad = 0) => lineDist(x, z, WADI.pts) < WADI.width / 2 + WADI.bank + pad;
const wadiX = (z) => {
  let best = WADI.pts[0];
  for (const p of WADI.pts) if (Math.abs(p[1] - z) < Math.abs(best[1] - z)) best = p;
  return best[0];
};
const BRIDGES = [
  { z: 0, w: 5, kind: 'stone' }, // the oasis bridge (B)
  { z: -42, w: 2.4, kind: 'wood' }, // footbridge north
];
WADI.crossings = BRIDGES.map((b) => [round(wadiX(b.z)), b.z]);

// --- Terrain: rocky rises round the edges, the watch-post hill, low ground at the oasis ---------
const terrain = {
  cell: 1.5,
  noise: 0.5,
  hills: [
    { pos: WATCH, radius: 20, height: 4.5 },
    { pos: [-40, 46], radius: 18, height: 4 },
    { pos: [-14, 52], radius: 14, height: 3 },
    { pos: [40, -60], radius: 16, height: 3.5 },
    { pos: [-80, 14], radius: 14, height: 3 },
    { pos: [84, -10], radius: 14, height: 3 },
    ...[[-20, -30], [30, 30], [-30, 24], [26, -24]].map(([x, z]) => ({ pos: [x, z], radius: 3.5, height: -0.9 })),
  ],
  flats: [
    { pos: Z.A, radius: 20, blend: 6 },
    { pos: Z.C, radius: 22, blend: 6 },
    { pos: BLUE, radius: 12, blend: 6 },
    { pos: RED, radius: 12, blend: 6 },
    ...BRIDGES.flatMap((b) => [-1, 1].map((s) => ({ pos: [round(wadiX(b.z) + s * 8), b.z], radius: 4, height: 0.2, blend: 6 }))),
  ],
  rivers: [WADI],
};

const T = createTown(R, { inMap, terrain, zones: Z, radii: ZR, stone: '#d8c4a0', sand: '#c9b08a', blocked: (x, z, pad) => nearWadi(x, z, pad) });
const { put, putAll, paint, addBuilding, thing, road, offRoad, kit, scatter, copse, frontage, pick, between } = T;
const ADOBE = ['#f3e2c6', '#ead6b4', '#f6e8d0', '#e6cfaa'];
const SANDY = '#cdb08c';
const keepOffWadi = (x, z) => !nearWadi(x, z, -0.5);
const track = (pts, w = 4.5) => road(pts, w, { color: SANDY, material: 'sand', y: 0.04, keep: keepOffWadi });

// --- Tracks ------------------------------------------------------------------------------
const MAIN = track([BLUE, [-62, -26], [-48, -4], [-24, 0], [6, 0], [30, 4], [52, 6], [57, 20], [64, 34], RED], 5.5);
const NORTH = track([BLUE, [-40, -46], [-10, -44], [6, -42], [30, -46], WATCH, [62, -20], [56, -10]], 4);
const SOUTH = track([[-48, -4], [-40, 20], [-20, 34], [8, 40], [36, 44], RED], 4);
const LANES = [
  track([[-48, -4], [-70, 0], [-82, 10]], 3.2),
  track([[-56, -40], [-36, -32], [-16, -30]], 3.2),
];

// --- Bridges -----------------------------------------------------------------------------
{
  for (const b of BRIDGES) {
    const x = round(wadiX(b.z));
    const len = WADI.width + WADI.bank * 2 + 4;
    const wood = b.kind === 'wood';
    const thick = wood ? 0.25 : 0.6;
    const top = 0.3;
    put({ type: 'floor', pos: [x, round(top - thick / 2), b.z], size: [len, thick, b.w], material: wood ? 'wood' : 'concrete', color: wood ? '#7a6248' : '#d8c8a8' });
    for (const s of [-1, 1]) put({ type: 'wall', pos: [x, round(top + 0.5), round(b.z + s * (b.w / 2 - 0.2))], size: [len, 1, wood ? 0.12 : 0.4], material: wood ? 'wood' : 'concrete', color: wood ? '#7a6248' : '#d8c8a8' });
  }
  // A ford in the south: a sandy ramp down and up (no bridge).
  paint([wadiX(40), 40], 14, 3.5, 90, 0.05, '#c2a47c', 'sand');
}

// --- Bases ---------------------------------------------------------------------------------
{
  const f = frame(BLUE, 135);
  for (const [lx, lz] of [[-6, -6], [6, -6]]) thing(f, lx, lz, 5, 3, 4, { type: 'wall', material: 'canvas', color: '#c9b48a', model: 'tent' });
  kit.truck(...f(0, 8), f.deg + 90, '#8a7a5a');
  scatter(...BLUE, 5, 10, 2);
}
{
  const f = frame(RED, -45);
  for (const [lx, lz] of [[-6, -6], [6, -6]]) thing(f, lx, lz, 5, 3, 4, { type: 'wall', material: 'canvas', color: '#c9b48a', model: 'tent' });
  kit.truck(...f(0, 8), f.deg + 90, '#6e5a44');
  scatter(...RED, 5, 10, 2);
}

// --- A: the round village square, its well, the market ----------------------------------------
{
  const [ax, az] = Z.A;
  paint([ax, az], 22, 22, 45, 0.05, '#d9c3a0', 'sand');
  put(block(ax, az, 3.6, 1, 3.6, { material: 'concrete', color: '#d8c8a8', model: 'fountain' }));
  for (const [dx, dz, yaw] of [[7, -6, 30], [-6, 7, 200], [-8, -5, 120], [6, 8, 300]]) kit.stall(ax + dx, az + dz, yaw);
  kit.cart(ax + 10, az + 2, 80);
  kit.sandbags(ax - 2, az - 11, 3.5, 0);
  // A ring of houses round the square (a closed round square, streets leave from it).
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const r = 20;
    const x = ax + Math.cos(a) * r;
    const z = az + Math.sin(a) * r;
    const yaw = (Math.atan2(ax - x, az - z) * 180) / Math.PI;
    const ob = obb(x, z, 8.6, 8.6, yaw);
    if (!T.isFree(ob) || !inMap(x, z, 6)) { if (process.env.DBG) console.log('ring', i, 'free', T.isFree(ob), 'in', inMap(x, z, 6)); continue; }
    let onRoad = false;
    for (const [u, w] of [[-4.3, -4.3], [4.3, -4.3], [4.3, 4.3], [-4.3, 4.3], [0, 0]]) {
      const px = x + u * ob.ax[0] + w * ob.az[0];
      const pz = z + u * ob.ax[1] + w * ob.az[1];
      if (!offRoad(px, pz, 0.6)) onRoad = true;
    }
    if (onRoad) { if (process.env.DBG) console.log('ring', i, 'road'); continue; }
    addBuilding({ pos: [x, z], size: [8.6, 8.6], style: R() < 0.5 ? 'shop' : 'house', floors: 2, doors: 'sn', rot: yaw, material: 'sand', color: pick(ADOBE) });
  }
  scatter(ax, az, 4, 12, 3);
}

// --- B: the oasis bridge, palms, the caravanserai ruin ------------------------------------------
{
  const [bx, bz] = Z.B;
  // Caravanserai: a square of broken walls with arches, west of the bridge, a well in the yard.
  const f = frame([bx - 18, bz + 14], 0);
  const c = [f(-8, -8), f(8, -8), f(8, 8), f(-8, 8), f(-8, -8)];
  putAll(wallLine(c, { height: 3.2, thick: 0.9, material: 'sand', color: '#ead6b4', type: 'wall', gaps: [[6, 10], [20, 22], [36, 40], [52, 56]] }));
  put(block(bx - 18, bz + 14, 2.4, 1.1, 2.4, { material: 'concrete', color: '#d8c8a8' }));
  kit.sandbags(bx + 10, bz - 6, 3.5, 90);
  kit.sandbags(bx - 10, bz + 5, 3.5, 90);
  kit.wreckCar(bx + 12, bz + 8, 30);
  kit.cart(bx - 8, bz - 8, 120);
  // Palms round the oasis.
  copse(bx, bz, 20, 14, { minGap: 3, scale: [0.8, 1.2], inZones: true });
  scatter(bx, bz, 4, 12, 3);
}

// --- C: the walled fort --------------------------------------------------------------------------
{
  const [cx, cz] = Z.C;
  const WALL = '#f6e2c4';
  const H = 16;
  const side = (a, b, gaps) => putAll(wallLine([a, b], { height: 4.5, thick: 1.2, material: 'sand', color: WALL, gaps }));
  // Gate west (toward the bridge, the main track), a breach south, a postern north.
  side([cx - H, cz - H], [cx - H, cz + H], [[13, 19]]);
  side([cx - H, cz + H], [cx + H, cz + H], [[20, 23.5]]);
  side([cx + H, cz + H], [cx + H, cz - H], [[13, 19]]);
  side([cx + H, cz - H], [cx - H, cz - H], [[10, 12.5]]);
  for (const [x, z] of [[cx - H, cz - H], [cx + H, cz - H], [cx + H, cz + H], [cx - H, cz + H]]) put(block(x, z, 4, 6.5, 4, { type: 'wall', material: 'sand', color: WALL }));
  addBuilding({ pos: [cx + 7, cz - 7], size: [12, 9], style: 'hq', floors: 2, doors: 'sw', material: 'sand', color: pick(ADOBE) });
  addBuilding({ pos: [cx - 8.5, cz + 9], size: [9, 7], style: 'barracks', doors: 'nw', material: 'sand', color: pick(ADOBE) });
  addBuilding({ pos: [cx - 9, cz - 9], size: [7, 6], style: 'shed', doors: 's', material: 'sand', color: pick(ADOBE) });
  kit.nest(cx + 10, cz + 9, 270);
  kit.sandbags(cx - 4, cz - 1, 3.5, 90);
  kit.truck(cx + 9, cz + 2, 90, '#6e5a44');
  kit.tower(cx + H - 2.5, cz - H + 2.5);
  scatter(cx, cz, 4, 12, 3);
}

// --- The rest of the village: houses along the tracks west of the wadi, a few east ----------------
const keepOut = [[BLUE, 14], [RED, 14], [Z.A, 24], [Z.B, 16], [Z.C, 24], [WATCH, 8]];
function lotOK(r) {
  for (const [x, z] of [[r.x, r.z], ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, w]) => [r.x + u * r.hw * r.ax[0] + w * r.hd * r.az[0], r.z + u * r.hw * r.ax[1] + w * r.hd * r.az[1]])]) {
    if (!inMap(x, z, 4) || keepOut.some(([c, cr]) => Math.hypot(x - c[0], z - c[1]) < cr)) return false;
    if (!offRoad(x, z, 0.8) || nearWadi(x, z, 2)) return false;
  }
  for (const [u, w] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) if (!offRoad(r.x + u * r.hw * r.ax[0] + w * r.hd * r.az[0], r.z + u * r.hw * r.ax[1] + w * r.hd * r.az[1], 0.6)) return false;
  return true;
}
const lotStyle = () => ({ style: R() < 0.6 ? 'house' : 'shop', w: between(8.6, 10), d: between(8.6, 9.5), floors: R() < 0.5 ? 2 : 1, material: 'sand', color: pick(ADOBE), ruinColors: ADOBE, ruinMaterial: 'sand' });
let lots = 0;
for (const r of [MAIN, NORTH, SOUTH, ...LANES]) for (const s of [-1, 1]) lots += frontage(r.pts, r.w / 2, s, { lotOK, lotStyle, ruins: 0.2, gap: 0.4, maxSlope: 1.2, setback: 1.4 });

// --- Mud walls, rocks, the watch post ---------------------------------------------------------
{
  // Broken mud walls along the tracks and round yards (cover in the open).
  for (let i = 0, n = 0; i < 300 && n < 14; i++) {
    const x = between(-80, 80);
    const z = between(-56, 56);
    const yaw = between(0, 180);
    const len = between(5, 10);
    const ob = obb(x, z, len, 0.8, yaw, 1);
    if (!inMap(x, z, 4) || !offRoad(x, z, 2) || nearWadi(x, z, 2) || !T.isFree(ob)) continue;
    if (Object.entries(Z).some(([id, c]) => Math.hypot(x - c[0], z - c[1]) < ZR[id] - 2)) continue;
    const f = frame([x, z], yaw);
    putAll(wallLine([f(-len / 2, 0), f(len / 2, 0)], { height: round(between(1.1, 1.8), 1), thick: 0.7, material: 'sand', color: pick(ADOBE), type: 'cover', gaps: [[len * between(0.3, 0.6), len * between(0.6, 0.7)]] }));
    n++;
  }
  for (const [x, z, s] of [[-40, 44, 1.1], [-16, 50, 0.9], [36, -58, 1], [-78, 14, 0.9], [80, -12, 1], [24, 52, 0.8]]) kit.outcrop(x, z, s, ['#b89a74', '#a88a66', '#c4a680']);
  kit.tower(WATCH[0], WATCH[1]);
  kit.sandbags(WATCH[0] - 4, WATCH[1] + 3, 3.5, 30);
  kit.sandbags(WATCH[0] + 4, WATCH[1] + 4, 3.5, 150);
  for (const [x, z] of [[-60, 30], [20, -20], [-10, 22], [66, -34], [-30, -48]]) copse(x, z, 6, 2, { minGap: 4, scale: [0.8, 1.1] });
  // Palms along the wadi.
  for (let z = -56; z <= 56; z += 7) for (const s of [-1, 1]) if (R() < 0.45) copse(wadiX(z) + s * 9, z, 2, 1, { minGap: 4, scale: [0.8, 1.3] });
}

// --- Spawns, zones, write ----------------------------------------------------------------------
T.check();
const st = outlineStats(boundary, 70);
const spawns = spawnRings(BLUE, RED, -135, 45).map((s) => ({ ...s, pos: [round(s.pos[0] * 1, 2), s.pos[1], s.pos[2]] }));
const zones = Object.entries(Z).map(([id, [x, z]]) => ({ id, pos: [x, 0, z], radius: ZR[id] }));
const map = {
  meta: { id: 'persia', name: '페르시아 침공', version: 2 },
  world: { size: st.size, visualProfile: 'desert', groundMaterial: 'sand', flora: 'palm', vehicles: 'light', ambience: { birds: 0.05 }, boundary, terrain },
  spawns,
  zones,
  // Frontline A -> B -> C (B starts neutral); Zone to 200.
  modes: { zone: { target: 200 }, frontline: { sectors: [['A'], ['B'], ['C']], matchTime: 900, attackTime: 180 } },
  objects: T.objects,
  buildings: T.buildings,
  props: T.props,
  trees: T.trees,
};
writeFileSync(new URL('../../public/maps/persia.json', import.meta.url), JSON.stringify(map));
const styles = {};
for (const b of T.buildings) styles[b.style] = (styles[b.style] ?? 0) + 1;
console.log(`persia: ${T.objects.length} objects, ${T.buildings.length} buildings (${lots} lots), ${T.props.length} props, ${T.trees.length} trees, outline ${round(st.w, 0)} x ${round(st.d, 0)} m (${round(st.area, 0)} m²), size ${st.size}`);
console.log(Object.entries(styles).map(([k, v]) => `${k} ${v}`).join(', '));
void lineDist;
void paint;
void scatter;
