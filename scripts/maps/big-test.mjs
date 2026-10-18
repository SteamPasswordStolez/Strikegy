// Generates public/maps/big_test.json — a placeholder for the big-map engine work (2026-10-18,
// docs/design/big-maps.md section 7 step 1): the size the island map Ashfall Isle will have,
// about 1.8 x 1.4 km playable for 64v64, so load times, the navmesh bake, frame times and the
// server's tick can be measured before that map is built. Not offered in the lobby (`?map=big_test`).
// What it holds is meant to weigh about what the real map will: a volcano in the north, rolling
// hills, five villages / towns at zones and two hamlets, roads between them, woods (~6,000 trees).
import { writeFileSync } from 'node:fs';
import { edgeDist, inside, rng, round, smoothClosed } from './lib.mjs';
import { createTown, frame, obb, outlineStats, spawnRings } from './town.mjs';

const R = rng(20261018);

// --- Outline: an island-like blob ----------------------------------------------------------
const outline = [
  [-900, -120], [-820, -420], [-560, -640], [-200, -700], [160, -680], [520, -620], [820, -420], [900, -80], [880, 260],
  [720, 560], [380, 690], [0, 700], [-380, 680], [-700, 540], [-880, 260],
];
const boundary = smoothClosed(outline, 2).map(([x, z]) => [round(x, 1), round(z, 1)]);
const inMap = (x, z, pad = 0) => inside(boundary, x, z) && edgeDist(boundary, x, z) > pad;

// --- Zones, bases ------------------------------------------------------------------------------
const Z = { A: [-520, 260], B: [-460, -300], C: [-60, 40], D: [180, 420], E: [220, -360], F: [500, 160], G: [600, -260] };
const ZR = { A: 36, B: 36, C: 40, D: 34, E: 36, F: 36, G: 34 };
const BLUE = [-780, 20];
const RED = [780, 0];
const PEAK = [-40, 560];

// --- Terrain -------------------------------------------------------------------------------------
const hills = [{ pos: PEAK, radius: 300, height: 85 }];
for (let i = 0; i < 26; i++) {
  const x = -820 + R() * 1640;
  const z = -620 + R() * 1100;
  hills.push({ pos: [round(x), round(z)], radius: round(80 + R() * 160), height: round((R() < 0.25 ? -1 : 1) * (4 + R() * 14), 1) });
}
const flats = [
  ...Object.entries(Z).map(([id, p]) => ({ pos: p, radius: ZR[id] + 30, blend: 30 })),
  { pos: BLUE, radius: 40, blend: 20 },
  { pos: RED, radius: 40, blend: 20 },
];
const terrain = { cell: 2, noise: 3, hills, flats };

const T = createTown(R, { inMap, terrain, zones: Z, radii: ZR });
const { road, kit, copse, frontage, kerbCars, scatter, pick, between, offRoad, addBuilding } = T;

// --- Roads between the bases and zones ---------------------------------------------------------------
const links = [
  [BLUE, Z.A], [BLUE, Z.B], [Z.A, Z.C], [Z.B, Z.C], [Z.A, Z.D], [Z.C, Z.D], [Z.C, Z.E], [Z.B, Z.E],
  [Z.D, Z.F], [Z.C, Z.F], [Z.E, Z.G], [Z.F, Z.G], [Z.F, RED], [Z.G, RED],
];
const wiggle = (a, b) => {
  const pts = [a];
  for (let k = 1; k < 4; k++) {
    const t = k / 4;
    pts.push([a[0] + (b[0] - a[0]) * t + (R() - 0.5) * 60, a[1] + (b[1] - a[1]) * t + (R() - 0.5) * 60]);
  }
  pts.push(b);
  return pts;
};
const roads = links.map(([a, b]) => road(wiggle(a, b), 7, { town: false }));

// --- Towns: two crossing streets lined with buildings at each zone, a few hamlets -----------------------
const COLORS = ['#d8cbb2', '#c9b79a', '#e2d6bf', '#b9a58a', '#cfc0a6'];
const lotStyle = () => {
  const two = R() < 0.55;
  return { style: pick(['house', 'house', 'shop', 'apartment']), w: between(8.6, 12), d: between(8.6, 11), floors: two ? 2 : 1, material: 'plaster', color: pick(COLORS) };
};
const corners = (r) => [[r.x, r.z], ...[[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]].map(([u, w]) => [r.x + u * r.hw * r.ax[0] + w * r.hd * r.az[0], r.z + u * r.hw * r.ax[1] + w * r.hd * r.az[1]])];
const lotOK = (r) => corners(r).every(([x, z]) => inMap(x, z, 8) && offRoad(x, z, 0.6));
let lots = 0;
const towns = [...Object.values(Z), [-200, -520], [420, 520]];
towns.forEach(([cx, cz], i) => {
  const big = i === 2 ? 1.6 : i >= 7 ? 0.6 : 1;
  const yaw = R() * 180;
  const f = frame([cx, cz], yaw);
  const half = 90 * big;
  const streets = [
    road([f(-half, 0), f(half, 0)], 8, { town: true, smooth: 0 }),
    road([f(0, -half), f(0, half)], 8, { town: true, smooth: 0 }),
    road([f(-half * 0.7, half * 0.45), f(half * 0.7, half * 0.45)], 6, { town: true, smooth: 0 }),
  ];
  if (big > 1) streets.push(road([f(-half * 0.7, -half * 0.45), f(half * 0.7, -half * 0.45)], 6, { town: true, smooth: 0 }));
  for (const s of streets) {
    for (const side of [-1, 1]) lots += frontage(s.pts, s.w / 2 + 1.7, side, { lotOK, lotStyle, ruins: 0.12, maxSlope: 1.4 });
    kerbCars(s, { chance: 0.2 });
  }
  scatter(cx, cz, 6, 30, 8);
});
// A landmark-sized block per big town (a hospital-sized hall), so the far views carry something big.
for (const id of ['C', 'F']) {
  const [x, z] = Z[id];
  for (let k = 0; k < 40; k++) {
    const a = R() * Math.PI * 2;
    const p = [x + Math.cos(a) * 150, z + Math.sin(a) * 150];
    const r = obb(p[0], p[1], 40, 18, 0, 2);
    if (!corners(r).every(([cx, cz]) => inMap(cx, cz, 30) && offRoad(cx, cz, 2)) || !T.isFree(r) || T.slopeUnder(r) > 1.2) continue;
    addBuilding({ pos: p, size: [40, 18], style: 'office', floors: 4, doors: 'nsew', material: 'plaster', color: '#cfc4b0' });
    break;
  }
}

// --- Positions at zones -----------------------------------------------------------------------------
for (const [id, [x, z]] of Object.entries(Z)) {
  for (let k = 0; k < 4; k++) {
    const a = R() * Math.PI * 2;
    const r = ZR[id] * between(0.4, 0.9);
    kit.sandbags(x + Math.cos(a) * r, z + Math.sin(a) * r, 3.5, R() * 180);
  }
  kit.nest(x + 8, z - 8, R() * 360);
}

// --- Woods ---------------------------------------------------------------------------------------------
for (let i = 0, n = 0; i < 3000 && n < 260; i++) {
  const x = -860 + R() * 1720;
  const z = -660 + R() * 1320;
  if (!inMap(x, z, 20)) continue;
  if (towns.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 130)) continue;
  copse(x, z, between(20, 45), Math.round(between(12, 34)), { minGap: 4.5 });
  n++;
}
for (let i = 0; i < 40; i++) {
  const x = -860 + R() * 1720;
  const z = -660 + R() * 1320;
  if (inMap(x, z, 10) && offRoad(x, z, 4)) kit.outcrop(x, z, between(0.8, 1.6));
}
void roads;

// --- Spawns, zones, write ----------------------------------------------------------------------------
T.check();
const st = outlineStats(boundary, 120);
const spawns = spawnRings(BLUE, RED, -90, 90);
const zones = Object.entries(Z).map(([id, [x, z]]) => ({ id, pos: [x, 0, z], radius: ZR[id] }));
const map = {
  meta: { id: 'big_test', name: 'Big map test', version: 2 },
  world: { size: st.size, visualProfile: 'outdoor_day', groundMaterial: 'grass', flora: 'broadleaf', boundary, terrain, view: { far: 3000 } },
  spawns,
  zones,
  modes: { zone: { target: 1000 }, frontline: { sectors: [['A', 'B'], ['C'], ['D', 'E'], ['F', 'G']] } },
  objects: T.objects,
  buildings: T.buildings,
  props: T.props,
  trees: T.trees,
};
writeFileSync(new URL('../../public/maps/big_test.json', import.meta.url), JSON.stringify(map));
console.log(`big_test: ${T.objects.length} objects, ${T.buildings.length} buildings (${lots} lots), ${T.props.length} props, ${T.trees.length} trees, outline ${round(st.w, 0)} x ${round(st.d, 0)} m (${round(st.area, 0)} m²), size ${st.size}`);
