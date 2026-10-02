// Generates public/maps/ardennes.json — "아르덴 숲" (Ardennes Forest), winter.
// 7-zone Zone map, about 800 x 650 m. A meandering river runs north-south
// through the middle and is the front line: blue holds the west bank, red the
// east. It is knee deep and wadeable everywhere; three bridges cross it: the
// stone bridge in the central village (D, carries the main road), the
// footbridge at the watermill (B) and the planked rail bridge at the halt (F,
// carries the south roads too). Zones read like the minimap: A B C across the
// north (chapel hill, watermill, sawmill), D in the middle (village under the
// big hotel), E F G across the south (farm, rail halt, bunker ridge).
// Dense conifer woods fill the ground between the zones; open fields round the
// farm, under the chapel hill, at the sawmill and in front of the bunker ridge.
import { writeFileSync } from 'node:fs';
import { besideLine, block, densify, edgeDist, ellipseIn, inside, lineDist, rng, round, smoothClosed, smoothOpen, stripAlong, wallLine, zAtX } from './lib.mjs';

const R = rng(20261002);
const objects = [];
const buildings = [];
const props = [];

// --- Outline -----------------------------------------------------------------
const outline = [
  [-398, -248], [-338, -318], [-246, -332], [-150, -322], [-66, -340], [12, -326], [92, -342], [172, -322], [252, -334],
  [334, -306], [394, -246], [410, -150], [398, -58], [414, 30], [400, 122], [406, 212], [374, 282], [302, 328], [212, 318],
  [120, 340], [30, 324], [-50, 342], [-140, 324], [-232, 336], [-322, 312], [-390, 252], [-406, 160], [-396, 70], [-412, -20],
  [-400, -112], [-408, -192],
];
const boundary = smoothClosed(outline, 2).map(([x, z]) => [round(x * 0.97, 1), round(z * 0.97, 1)]);
const inMap = (x, z, pad = 0) => inside(boundary, x, z) && edgeDist(boundary, x, z) > pad;

// --- River -------------------------------------------------------------------
// Bends west north of the village and east south of it, and runs straight
// north-south at the three bridges (z = -232 / -220, 0, 220).
const WAVE = 220;
const riverX = (z) => {
  const s = z < 0 ? 1 : -1;
  const env = Math.sin((Math.PI * z) / WAVE) ** 2;
  return s * 25 * (Math.cos((2 * Math.PI * z) / WAVE) - 1) + 7 * Math.sin(z / 41 + 0.7) * env;
};
const river = {
  pts: Array.from({ length: 148 }, (_, i) => {
    const z = -440 + i * 6;
    return [round(riverX(z), 1), z];
  }),
  width: 14,
  depth: 2.3,
  // Wide banks: gentle enough for wheels and tracks to drive down into the ford.
  bank: 8,
  water: 0.7,
};
const RIVER_CLEAR = river.width / 2 + river.bank;
const nearRiver = (x, z, pad) => lineDist(x, z, river.pts) < RIVER_CLEAR + pad;

// --- Zones and bases -----------------------------------------------------------
const Z = {
  A: [-228, -150], // chapel hill, west bank
  B: [0, -220], // watermill, on the river
  C: [228, -140], // sawmill, east bank
  D: [0, 0], // village and stone bridge, on the river
  E: [-222, 150], // farm, west bank
  F: [0, 220], // rail halt and rail bridge, on the river
  G: [238, 158], // bunker ridge, east bank
};
const RADIUS = { A: 34, B: 36, C: 36, D: 40, E: 38, F: 36, G: 36 };
const BLUE = [-330, 0];
const RED = [330, 0];

// --- Rail ----------------------------------------------------------------------
// Across the south, straight over the river at the halt (F).
const rail = smoothOpen([[-450, 252], [-300, 240], [-170, 228], [-60, 220], [0, 220], [60, 220], [160, 230], [270, 254], [450, 272]], 2);
// Sidings: boxcars by the freight shed (west bank), into the engine shed (east bank).
const sidingW = smoothOpen([[-52, 220], [-58, 222], [-66, 226], [-112, 228]], 2);
const sidingE = smoothOpen([[22, 220], [30, 223], [38, 232], [44, 235], [50, 236]], 2);

// --- Bridges -----------------------------------------------------------------
const bridgeD = { x: round(riverX(0)), z: 0, len: 38, w: 8.5, deck: 0.95 };
const footB = { x: round(riverX(-232)), z: -232, len: 36, w: 2.6, deck: 0.35 };
const railF = { x: round(riverX(220)), z: 220, len: 40, w: 6.5, deck: 0.3 };
river.crossings = [bridgeD, footB, railF].map((b) => [b.x, b.z]);

// --- Terrain -----------------------------------------------------------------
const flats = [
  { pos: [Z.A[0] + 2, Z.A[1] - 2], radius: 20, blend: 14 },
  { pos: [240, -146], radius: 30, blend: 12 },
  { pos: [-214, 150], radius: 32, blend: 12 },
  // Bases: wide level ground with room for the vehicle pads and tank spots.
  // The mill reach: a known bed level for the wheel (absolute heights).
  { pos: [round(riverX(-212) + 4), -212], radius: 14, height: 0, blend: 10 },
  { pos: BLUE, radius: 44, blend: 18 },
  { pos: RED, radius: 44, blend: 18 },
];
// Bridge abutments sit at the deck height so the decks (absolute y) meet the ground.
for (const b of [bridgeD, footB, railF]) {
  for (const s of [-1, 1]) flats.push({ pos: [round(b.x + s * (b.len / 2 - 3)), b.z], radius: b === footB ? 4 : 7, height: round(b.deck - 0.1), blend: 12 });
}
const hills = [
  // West bank: plateau behind the blue base, chapel hill, ridges, knolls.
  { pos: [-310, 0], radius: 200, height: 6 },
  { pos: [-228, -150], radius: 85, height: 13 },
  { pos: [-300, -235], radius: 70, height: 7 },
  { pos: [-120, -270], radius: 75, height: 6 },
  { pos: [-110, 85], radius: 55, height: 6 },
  { pos: [-330, 245], radius: 70, height: 7 },
  { pos: [-60, 290], radius: 60, height: 5 },
  // A hollow inside the river's western bend.
  { pos: [-100, -115], radius: 45, height: -2.5 },
  // East bank: plateau behind the red base, the heights over the sawmill valley,
  // the bunker ridge (a chain of rises), a hollow inside the eastern bend.
  { pos: [310, 0], radius: 200, height: 6 },
  { pos: [322, -250], radius: 90, height: 13 },
  { pos: [150, -95], radius: 60, height: 7 },
  { pos: [130, -265], radius: 65, height: 6 },
  { pos: [242, 105], radius: 55, height: 8 },
  { pos: [252, 160], radius: 58, height: 11 },
  { pos: [244, 220], radius: 52, height: 8 },
  { pos: [100, 120], radius: 45, height: -2 },
  { pos: [60, -290], radius: 60, height: 5 },
  // The hotel's terrace above the village square.
  { pos: [58, -42], radius: 45, height: 3.5 },
];
// Shell craters in the field in front of the bunker ridge.
for (const [x, z] of [[150, 128], [176, 176], [192, 142], [138, 186], [196, 196], [158, 140]]) hills.push({ pos: [x, z], radius: 3.5, height: -0.9 });
const terrain = { cell: 2, noise: 1.2, hills, flats, rivers: [river] };

// --- Roads -------------------------------------------------------------------
const MUD = '#8c8378';
const road = (pts, w) => ({ pts: smoothOpen(pts, 2), w });
const roads = {
  // Main road: blue base -> stone bridge -> village square -> red base.
  mainW: road([[-318, 0], [-270, 8], [-215, 4], [-185, -2], [-140, -10], [-95, -6], [-55, 0], [-30, 0], [-19, 0]], 9),
  mainE: road([[19, 0], [32, 0], [55, 4], [90, 8], [130, 2], [185, -2], [230, 6], [280, 4], [318, 0]], 9),
  // Ring roads on each bank: chapel / sawmill -> main road -> farm / bunker ridge.
  ringW: road([[-222, -128], [-210, -95], [-196, -55], [-188, -20], [-185, -2], [-190, 30], [-200, 75], [-206, 110], [-214, 134]], 8),
  ringE: road([[228, -124], [212, -85], [196, -45], [187, -15], [185, -2], [188, 30], [196, 70], [214, 108], [236, 130], [248, 142]], 8),
  // North: to the watermill from both banks (people cross on the footbridge).
  northW: road([[-250, -146], [-254, -180], [-228, -204], [-180, -216], [-150, -222], [-95, -232], [-50, -226], [-21, -222]], 7),
  northE: road([[224, -128], [200, -150], [170, -195], [120, -215], [70, -222], [40, -220]], 7),
  // South: farm / bunker ridge -> rail halt, over the planked rail bridge.
  southW: road([[-228, 172], [-214, 196], [-180, 205], [-130, 212], [-80, 214], [-50, 216.5], [-21, 219.5]], 7),
  southE: road([[250, 176], [238, 196], [206, 208], [150, 214], [80, 214], [50, 216], [21, 219.5]], 7),
  // Forest tracks: along each bank from the village, and from each base to its high ground.
  trackW: road([[-62, -4], [-64, -30], [-75, -60], [-82, -95], [-80, -130], [-62, -170], [-50, -200], [-52, -224]], 5),
  trackE: road([[50, 16], [50, 40], [62, 62], [78, 85], [80, 125], [66, 170], [68, 212]], 5),
  baseW: road([[-318, -12], [-300, -60], [-275, -105], [-252, -138]], 5),
  baseE: road([[318, 12], [300, 60], [278, 108], [256, 140], [250, 146]], 5),
};
const roadList = Object.values(roads);
for (const r of roadList) {
  const strips = stripAlong(r.pts, r.w, { color: MUD, material: 'ground', y: 0.04 });
  objects.push(...strips.filter((s) => !nearRiver(s.pos[0], s.pos[2], 1) && inMap(s.pos[0], s.pos[2])));
}
const nearRoad = (x, z, pad) => roadList.some((r) => lineDist(x, z, r.pts) < r.w / 2 + pad);

// Rail: ballast + two rails, left out over the river (the bridge carries it).
const railIn = rail.filter(([x, z]) => inMap(x, z, -30));
function lay(line) {
  for (const off of [null, -0.72, 0.72]) {
    const pts = off === null ? line : line.map(([x, z], i) => {
      const [ax, az] = line[Math.max(0, i - 1)];
      const [bx, bz] = line[Math.min(line.length - 1, i + 1)];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      return [x + (-(bz - az) / len) * off, z + ((bx - ax) / len) * off];
    });
    const strips = off === null
      ? stripAlong(pts, 3.2, { color: '#5b5048', material: 'ground', y: 0.12, thickness: 0.4 })
      : stripAlong(pts, 0.12, { color: '#6d6a66', material: 'metal', y: 0.28, thickness: 0.16, type: 'prop' });
    objects.push(...strips.filter((s) => !nearRiver(s.pos[0], s.pos[2], 2) && inMap(s.pos[0], s.pos[2], -2)));
  }
}
for (const line of [railIn, sidingW, sidingE]) lay(line);
const nearRail = (x, z, pad) => [railIn, sidingW, sidingE].some((l) => lineDist(x, z, l) < pad);

// --- Bridges -------------------------------------------------------------------
const STONE = '#8d887e';
/** Deck boxes at absolute heights (not snapped): top of the deck at y = `top`. */
function bridge({ x, z, len, w }, { top = 0.12, thick = 0.7, rail = 1, material = 'concrete', color = STONE, piers = [-5, 5], pierW = 2.2, parapet = 0.5 } = {}) {
  objects.push({ type: 'floor', pos: [x, round(top - thick / 2), z], size: [len, thick, w], material, color });
  for (const side of [-1, 1]) objects.push({ type: 'wall', pos: [x, round(top + rail / 2), round(z + side * (w / 2 - parapet / 2))], size: [len, rail, parapet], material, color });
  // Piers down to the river bed.
  for (const u of piers) objects.push({ type: 'wall', pos: [round(x + u), round((top - thick - 3.4) / 2 + 0.2), z], size: [pierW, round(3.4 + thick), w + 0.6], material, color });
}
/** A bridge model (world/modelKits) at absolute heights: deck top at `deck`, footings below the river bed. */
function bridgeModel({ x, z, len, w }, model, { deck, above, yaw, color, material }) {
  const bottom = -3.4;
  const top = deck + above;
  objects.push({ type: 'wall', pos: [round(x), round((top + bottom) / 2), round(z)], size: [w, round(top - bottom), len], rot: [0, round(yaw, 1), 0], material, color, model, base: 0 });
}
// Stone arch bridge (east-west): the model's parapets stand 1.25 m above its deck.
bridgeModel(bridgeD, 'archBridge', { deck: bridgeD.deck, above: 1.25, yaw: 90, color: STONE, material: 'concrete' });
// Wooden footbridge by the watermill: planks on trestles, low handrails.
bridge(footB, { top: footB.deck, thick: 0.25, rail: 1, material: 'wood', color: '#6e5a44', piers: [-4.5, 4.5], pierW: 0.5, parapet: 0.12 });
// Rail bridge: steel through-truss on two piers, planked between the rails so
// vehicles cross it too (the truss is 55% of the model's height).
bridgeModel(railF, 'trussBridge', { deck: railF.deck, above: ((railF.deck + 3.4) / 0.45) * 0.55, yaw: 90, color: '#4a5055', material: 'metal' });

// --- Placement helpers ----------------------------------------------------------
const placed = [];
const reserve = (x, z, r) => placed.push({ x, z, r });
const free = (x, z, r) => placed.every((p) => Math.hypot(x - p.x, z - p.z) > p.r + r);
const addBuilding = (b) => {
  buildings.push({ ...b, pos: [round(b.pos[0]), round(b.pos[1])], ...(b.rot !== undefined ? { rot: round(b.rot, 1) } : {}) });
  reserve(b.pos[0], b.pos[1], Math.hypot(b.size[0], b.size[1]) / 2 + 1);
};
const obj = (o, r = 2) => {
  objects.push(o);
  reserve(o.pos[0], o.pos[2], r);
};
const SANDBAG = '#9c8f76';
const WOOD = '#6e5a44';
const deg = (rad) => (rad * 180) / Math.PI;
const sandbags = (x, z, len, yaw) => obj(block(x, z, len, 1.1, 0.9, { yaw, material: 'ground', color: SANDBAG, model: 'sandbags' }), len / 2 + 0.5);
const logs = (x, z, len, yaw, h = 1.6) => obj(block(x, z, len, h, 2.4, { yaw, material: 'wood', color: '#86684a', model: 'logPile' }), len / 2 + 1);
const hay = (x, z, yaw) => obj(block(x, z, 2.6, 1.5, 1.5, { yaw, material: 'wood', color: '#b89a5a', model: 'hayBale' }), 2);
// Vehicles and carts: length along local z.
const CAR_COLORS = ['#5a2a24', '#2e3f55', '#8f8a7c', '#4c5a3a'];
const car = (x, z, yaw) => obj(block(x, z, 1.9, 1.5, 4.4, { yaw, material: 'metal', color: CAR_COLORS[Math.floor(R() * CAR_COLORS.length)], model: 'car' }), 3);
const truck = (x, z, yaw, color = '#4d5a3c') => obj(block(x, z, 2.5, 3, 7, { yaw, material: 'metal', color, model: 'truck' }), 4);
const cart = (x, z, yaw) => obj(block(x, z, 1.7, 1.6, 3.6, { yaw, material: 'wood', color: WOOD, model: 'cart' }), 2.5);
const bus = (x, z, yaw) => obj(block(x, z, 2.6, 3.2, 11, { yaw, type: 'wall', material: 'metal', color: '#6f7a5c', model: 'bus' }), 6);
const wreck = (x, z, yaw) => obj(block(x, z, 3.6, 2.6, 7.2, { yaw, type: 'wall', material: 'metal', color: '#4a4d42', model: 'tankWreck' }), 5);
/** A pillbox with its firing slit (the kit's local -z) facing yaw `face` (map yaw: 0 = north, 90 = west). */
const bunker = (x, z, face) => obj(block(x, z, 7, 3, 5, { yaw: face, type: 'wall', material: 'concrete', color: '#8f8c84', model: 'bunker', sink: 0.2 }), 5);
const tent = (x, z, yaw = 0, color = '#e3e4df') => obj(block(x, z, 5, 3, 4, { yaw, type: 'wall', material: 'wood', color, model: 'tent' }), 3.5);
const tower = (x, z) => obj(block(x, z, 3, 7.5, 3, { type: 'wall', material: 'wood', color: '#6d6450', model: 'watchtower' }), 3);
const stoneWall = (pts, gaps = [], height = 1.0) => objects.push(...wallLine(densify(pts, 3), { height, thick: 0.5, material: 'concrete', color: STONE, type: 'cover', gaps }));
const fence = (pts, gaps = []) => objects.push(...wallLine(densify(pts, 6), { height: 1.1, thick: 0.3, material: 'wood', color: WOOD, type: 'cover', model: 'fence', gaps }));
const bagLine = (pts, gaps = []) => objects.push(...wallLine(densify(pts, 4), { height: 1.1, thick: 0.9, material: 'ground', color: SANDBAG, type: 'cover', model: 'sandbags', gaps }));
const timber = (pts, gaps = []) => objects.push(...wallLine(densify(pts, 4), { height: 1.4, thick: 0.25, material: 'wood', color: '#5c4633', type: 'cover', gaps }));
/** Timber barricade (plain boxes, cheap): long side along local x. */
const barricade = (x, z, len, yaw) => obj(block(x, z, len, 1.25, 0.35, { yaw, material: 'wood', color: '#5c4633' }), len / 2 + 0.5);
// Scanned props (barrels, ammo boxes, crates) are instanced on every frame
// wherever they are, at 1.5-7k triangles each: only a few, the rest of the
// clutter is plain crate boxes.
const CRATES = ['barrel_03', 'ammo_box', 'barrel_03', 'old_military_crate', 'ammo_box'];
const PROPS_PER_ZONE = 3;
const propsIn = {};
const zoneAt = (x, z) => Object.keys(Z).find((id) => Math.hypot(x - Z[id][0], z - Z[id][1]) < RADIUS[id] + 8);
const CRATE_COLORS = ['#6f5a3e', '#5d6346'];
const crate = (x, z) => {
  const id = zoneAt(x, z);
  if (id && (propsIn[id] = (propsIn[id] ?? 0) + 1) <= PROPS_PER_ZONE) props.push({ model: CRATES[props.length % CRATES.length], pos: [round(x), 0, round(z)], rot: [0, round(R() * 360), 0], snap: true });
  else {
    const s = 0.8 + R() * 0.5;
    const yaw = R() * 90;
    const color = CRATE_COLORS[Math.floor(R() * CRATE_COLORS.length)];
    objects.push(block(x, z, s * 1.3, s * 0.8, s, { yaw, material: 'wood', color }));
    if (R() < 0.4) objects.push(block(x, z, s * 0.9, s * 0.7, s * 0.8, { yaw: yaw + 20, lift: s * 0.8, sink: 0, material: 'wood', color }));
  }
  reserve(x, z, 1);
};
/** A few crates / barrels huddled together. */
const stack = (x, z, n = 3) => {
  for (let i = 0; i < n; i++) crate(x + (R() - 0.5) * 2.4, z + (R() - 0.5) * 2.4);
};
/** Something on the verge of a road, `frac` of the way along it, long side along the road. */
const verge = (r, frac, side, place) => {
  const p = besideLine(r.pts, frac, side * (r.w / 2 + 2.6));
  place(p.x, p.z, deg(Math.atan2(p.dx, p.dz)));
};

/**
 * Houses lined up along a road within `maxR` of (cx, cz): each faces the road
 * (door side 's'), set back behind a verge, skipped where anything is in the way.
 */
function street(r, { cx, cz, maxR, minR = 0, skip = 0.3, near = 45, solidNear = 0.2, solidFar = 0.55, shop = 0.25 }) {
  const pts = r.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.round(len / 3));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      const dc = Math.hypot(px - cx, pz - cz);
      if (dc > maxR || dc < minR) continue;
      for (const side of [-1, 1]) {
        if (R() < skip) continue;
        const w = 8 + R() * 3;
        const d = 7.5 + R() * 2;
        const nx = (-(bz - az) / len) * side;
        const nz = ((bx - ax) / len) * side;
        const setback = r.w / 2 + 2.5 + d / 2;
        const x = px + nx * setback;
        const z = pz + nz * setback;
        const rr = Math.hypot(w, d) / 2 + 1;
        if (nearRoad(x, z, Math.hypot(w, d) / 2 - 0.5) || !free(x, z, rr) || nearRiver(x, z, 5) || nearRail(x, z, 8) || !inMap(x, z, 12)) continue;
        if (Object.entries(Z).some(([id, [zx, zz]]) => id !== 'D' && Math.hypot(x - zx, z - zz) < RADIUS[id] + 4)) continue;
        const yaw = deg(Math.atan2(-nx, -nz));
        const close = Math.hypot(x - cx, z - cz) < near;
        addBuilding({ pos: [x, z], size: [round(w), round(d)], style: R() < shop ? 'shop' : 'house', rot: yaw + (R() - 0.5) * 4, doors: ['sn', 'se', 'sw'][Math.floor(R() * 3)], solid: close ? R() < solidNear : R() < solidFar });
      }
    }
  }
}

// --- A: chapel hill — chapel and steeple in a walled churchyard on the crest,
// the presbytery and a cottage on the slope, sandbagged posts looking east.
{
  const [ax, az] = Z.A;
  addBuilding({ pos: [ax + 2, az - 2], size: [9.5, 19], style: 'chapel', doors: 'se', rot: 0 });
  // Bell tower and spire against the north end of the nave.
  obj(block(ax + 2, az - 14.1, 5, 22, 5, { type: 'wall', material: 'brick', color: '#948b7e', model: 'steeple', sink: 0.3 }), 4);
  // Churchyard wall: gates on the east side and on the south side (the road).
  stoneWall([[ax - 15, az - 24], [ax + 18, az - 24], [ax + 18, az + 16], [ax - 15, az + 16], [ax - 15, az - 24]], [[44, 50], [82, 90]]);
  // Gravestones in rows east and west of the nave, a stone cross.
  for (let i = 0; i < 24; i++) {
    const west = i < 12;
    const x = ax + (west ? -11 : 9) + (i % 4) * 2;
    const z = az - 16 + Math.floor((i % 12) / 4) * 4 + (west ? 10 : 0);
    obj(block(x, z, 0.6, 0.9, 0.2, { material: 'concrete', color: STONE }), 0.4);
  }
  obj(block(ax + 12, az + 10, 0.8, 3, 0.8, { material: 'concrete', color: STONE, model: 'statue' }), 1);
  // Presbytery and its garden east of the yard, a cottage below the south gate, a shed.
  addBuilding({ pos: [ax + 28, az + 12], size: [11, 9], style: 'house', floors: 2, doors: 'sn', rot: -90 });
  fence([[ax + 20, az + 22], [ax + 38, az + 22], [ax + 38, az + 2]], [[4, 8]]);
  addBuilding({ pos: [ax - 14, az + 34], size: [9, 8], style: 'house', floors: 1, doors: 's', rot: 160 });
  addBuilding({ pos: [ax - 34, az - 6], size: [7, 6], style: 'shed', doors: 'e', rot: 10 });
  cart(ax + 24, az + 24, 80);
  car(ax + 22, az - 6, 5);
  logs(ax - 38, az + 10, 5, 80, 1.2);
  sandbags(ax + 22, az - 20, 4, 30);
  barricade(ax + 20, az + 30, 5, -10);
  barricade(ax - 8, az + 26, 4, 0);
  barricade(ax - 18, az - 30, 4, 90);
  stack(ax + 6, az - 20);
  stack(ax - 6, az + 20, 2);
}

// --- B: watermill — the mill on the east bank with its wheel in the river,
// the miller's house and granary on the west bank, the footbridge between.
{
  const rx = riverX(-212);
  // Mill wall just above the water; the wheel (absolute heights) turns in the river beside it.
  addBuilding({ pos: [rx + 19, -212], size: [13, 16], style: 'mill', floors: 2, doors: 'en', rot: 0 });
  objects.push({ type: 'wall', pos: [round(rx + 9.6), 0.8, -212], size: [2, 5.6, 5.6], material: 'wood', color: '#5c4633', model: 'millWheel', base: 0 });
  reserve(rx + 9.6, -212, 3.5);
  // Mill yard: carts, sacks and barrels, the miller's truck, a log pile for the stove.
  cart(rx + 30, -226, 10);
  cart(rx + 33, -200, 95);
  truck(rx + 37, -208, 0, '#5a4a36');
  stack(rx + 28, -230, 4);
  stack(rx + 28, -196, 3);
  logs(rx + 30, -242, 6, 0, 1.4);
  hay(rx + 42, -230, 30);
  addBuilding({ pos: [rx + 46, -238], size: [8, 6], style: 'shed', doors: 'n', rot: 0 });
  fence([[rx + 52, -250], [rx + 52, -190]], [[25, 35]]);
  // West bank: miller's house, granary, garden fence, a cart by the door.
  addBuilding({ pos: [rx - 26, -208], size: [11, 9], style: 'house', floors: 2, doors: 'sw', rot: 90 });
  addBuilding({ pos: [rx - 30, -238], size: [10, 8], style: 'shed', doors: 's', rot: 90 });
  fence([[rx - 36, -196], [rx - 18, -196], [rx - 18, -186]], [[6, 10]]);
  cart(rx - 36, -214, 170);
  hay(rx - 44, -212, 80);
  stack(rx - 20, -246, 2);
  // Sandbags at both ends of the footbridge.
  sandbags(rx - 24, -239, 4, 0);
  sandbags(rx + 20, -239, 4, 0);
  barricade(rx + 14, -190, 4, -20);
  barricade(rx - 30, -190, 4, 10);
}

// --- C: sawmill — the long mill hall and open saw shed, a log yard, the office.
{
  addBuilding({ pos: [240, -160], size: [28, 12], style: 'warehouse', material: 'wood', color: '#6b5139', doors: 'sw', rot: 6 });
  obj(block(232, -138, 13, 5.2, 7, { yaw: 6, type: 'wall', material: 'wood', color: '#5c4633', model: 'sawShed', sink: 0.1 }), 7);
  addBuilding({ pos: [254, -122], size: [10, 8], style: 'house', floors: 2, doors: 'sw', rot: 186 });
  addBuilding({ pos: [206, -130], size: [9, 7], style: 'shed', doors: 'n', rot: 10 });
  addBuilding({ pos: [266, -146], size: [8, 6], style: 'shed', doors: 'w', rot: 0 });
  // Log yard: trunks waiting to be sawn, planks stacked to dry.
  for (const [x, z, yaw, len, h] of [[244, -140, 6, 8, 1.6], [244, -134, 6, 8, 1.6], [256, -138, 96, 7, 1.6], [218, -158, 80, 7, 1.6], [212, -118, 20, 6, 1.4], [236, -112, 50, 6, 1.2], [270, -128, 0, 6, 1.6], [200, -120, 90, 6, 1.4], [214, -150, 50, 6, 1.0]]) {
    logs(x, z, len, yaw, h);
  }
  truck(236, -176, 96, '#4d5a3c');
  truck(262, -114, 10, '#7b3a2a');
  cart(222, -146, 40);
  stack(248, -146, 3);
  stack(230, -126, 3);
  stack(208, -160, 2);
  logs(198, -134, 4, 90, 1.2);
  barricade(244, -184, 4, 0);
  logs(276, -132, 4, 100, 1.2);
}

// --- D: village — inn and cottages at the west bridgehead, the square at the
// east bridgehead with the grand hotel above it, houses along the main road.
{
  // West bridgehead.
  addBuilding({ pos: [-40, -17], size: [20, 11], style: 'inn', floors: 2, doors: 'se', rot: 0 });
  car(-52, -7.5, 90);
  truck(-25, -15, 0, '#5a4a36');
  cart(-58, -16, 0);
  addBuilding({ pos: [-34, 17], size: [10, 8.5], style: 'house', floors: 2, doors: 'sw', rot: 180 });
  addBuilding({ pos: [-26, 38], size: [9, 8], style: 'house', floors: 2, doors: 'se', rot: 90 });
  addBuilding({ pos: [-52, 24], size: [11, 9], style: 'shop', floors: 2, doors: 'se', rot: 180 });
  fence([[-40, 30], [-40, 50], [-16, 50]], [[8, 12]]);
  sandbags(-24, -7, 4, 90);
  sandbags(-24, 8, 4, 90);
  stack(-20, 22, 3);
  car(-44, 8, 92);
  // East bridgehead: the square (cobbles, fountain, benches) and the hotel.
  objects.push({ type: 'floor', pos: [54, -0.24, 2], size: [46, 0.3, 36], material: 'concrete_floor', color: '#8e8a84', snap: true });
  obj(block(56, -9, 3.4, 1, 3.4, { material: 'concrete', color: STONE, model: 'fountain' }), 2.5);
  for (const [x, z] of [[49, -13], [63, -13], [49, -5], [63, -5]]) obj(block(x, z, 2.2, 0.8, 0.6, { material: 'wood', color: WOOD, model: 'bench' }), 1.2);
  addBuilding({ pos: [58, -36], size: [54, 18], style: 'hotel', floors: 4, doors: 'sn', rot: 0 });
  bus(72, -20, 90);
  for (const x of [38, 42.5, 47]) car(x, -21, 0);
  car(102, -4, 90);
  stack(30, -22, 3);
  addBuilding({ pos: [21, -34], size: [8, 7], style: 'shed', doors: 's', rot: -90 });
  addBuilding({ pos: [38, 30], size: [12, 9], style: 'shop', floors: 2, doors: 'sn', rot: 180 });
  addBuilding({ pos: [64, 31], size: [11, 9], style: 'house', floors: 2, doors: 'sn', rot: 180 });
  addBuilding({ pos: [92, -18], size: [14, 10], style: 'townhall', floors: 2, doors: 'sn', rot: 0 });
  addBuilding({ pos: [80, 30], size: [10, 9], style: 'house', floors: 2, doors: 'se', rot: 180 });
  truck(86, 16, 92, '#4d5a3c');
  sandbags(24, -7, 4, 90);
  sandbags(24, 8, 4, 90);
  barricade(38, 16, 4, 0);
  stack(70, 18, 3);
  wreck(122, 30, 70);
  // The rest of the village along the main road and the bank tracks.
  street(roads.mainW, { cx: -60, cz: 0, maxR: 75, minR: 18 });
  street(roads.mainE, { cx: 110, cz: 4, maxR: 50, minR: 8 });
  street(roads.trackW, { cx: -70, cz: -50, maxR: 30, skip: 0.45 });
  street(roads.trackE, { cx: 66, cz: 66, maxR: 30, skip: 0.45 });
}

// --- E: farm — farmhouse, two barns and sheds round a yard, hay, carts, paddocks.
{
  addBuilding({ pos: [-196, 138], size: [12, 9], style: 'house', floors: 2, doors: 'sn', rot: -90 });
  addBuilding({ pos: [-236, 154], size: [24, 13], style: 'barn', doors: 'ew', rot: 90 });
  addBuilding({ pos: [-206, 172], size: [16, 10], style: 'barn', doors: 'n', rot: 0 });
  addBuilding({ pos: [-240, 126], size: [8, 6], style: 'shed', doors: 's', rot: 20 });
  addBuilding({ pos: [-188, 160], size: [7, 6], style: 'shed', doors: 's', rot: -90 });
  for (const [x, z, yaw] of [[-224, 146, 0], [-220, 152, 30], [-228, 140, 80], [-212, 148, 10], [-216, 160, 60], [-250, 182, 0], [-252, 186, 90], [-282, 130, 20], [-170, 182, 70], [-262, 120, 0]]) hay(x, z, yaw);
  cart(-206, 146, 20);
  cart(-226, 166, 100);
  cart(-188, 150, 170);
  truck(-226, 122, 80, '#7b3a2a');
  car(-196, 124, 90);
  logs(-196, 186, 6, 0, 1.4);
  const pad = [[-180, 130], [-160, 132], [-158, 162], [-178, 166]];
  fence([...pad, pad[0]], [[8, 12], [56, 60]]);
  fence([[-266, 120], [-266, 190], [-232, 194]], [[30, 36]]);
  stoneWall([[-292, 118], [-292, 200]], [[36, 42]], 0.9);
  hay(-228, 114, 10);
  barricade(-182, 176, 4, 90);
  stack(-218, 170, 3);
  stack(-248, 140, 2);
  // Burnt-out tanks in the fields.
  wreck(-160, 118, 50);
  wreck(-280, 160, -20);
}

// --- F: rail halt — station and platform on the west bank, freight shed and
// boxcars on the siding; engine shed and water tower on the east bank.
{
  obj(block(-36, 224.4, 30, 1.0, 4, { type: 'floor', material: 'concrete', color: '#96918a' }), 2);
  addBuilding({ pos: [-34, 230.4], size: [16, 8], style: 'station', doors: 'ns', rot: 0 });
  addBuilding({ pos: [-40, 200], size: [9, 8], style: 'house', floors: 2, doors: 's', rot: 0 });
  addBuilding({ pos: [-84, 241], size: [18, 10], style: 'warehouse', material: 'wood', color: '#5f4c3a', doors: 'sn', rot: 0 });
  for (const x of [-76, -92]) obj(block(x, zAtX(sidingW, x), 3, 3.6, 12, { yaw: 90, lift: 0.36, type: 'wall', material: 'metal', color: '#5a3d31', model: 'boxcar' }), 6);
  addBuilding({ pos: [64, 236], size: [28, 12], style: 'depot', doors: 'ew', rot: 0 });
  obj(block(28, 206, 5, 13, 5, { type: 'wall', material: 'wood', color: '#5c4633', model: 'waterTower', sink: 0.2 }), 3.5);
  // Coal heap by the water tower, crates by the station, carts and trucks in the yards.
  obj(block(44, 206, 6, 1.6, 4, { material: 'ground', color: '#2f2c2a' }), 3.5);
  stack(-20, 234, 3);
  stack(-48, 234, 2);
  cart(-24, 204, 0);
  truck(-60, 205, 90, '#4d5a3c');
  logs(58, 252, 6, 0, 1.4);
  logs(-36, 254, 7, 0, 1.8);
  sandbags(-18, 228, 4, 90);
  sandbags(24, 210, 4, 90);
  barricade(22, 246, 4, 30);
  barricade(-20, 190, 4, -20);
  stack(36, 244, 3);
}

// --- G: bunker ridge — pillboxes on the crest facing the river, sandbag and
// timber trench lines between them, a command post behind.
{
  for (const [x, z] of [[208, 130], [214, 158], [212, 184], [236, 146], [234, 176]]) bunker(x, z, 90 + (R() - 0.5) * 20);
  bagLine([[206, 140], [210, 150]]);
  bagLine([[212, 166], [208, 176]]);
  bagLine([[210, 192], [214, 198]]);
  timber([[220, 124], [222, 146], [222, 168], [220, 188]], [[30, 34]]);
  tent(256, 158, 0, '#7a7b62');
  tent(256, 166, 0, '#7a7b62');
  addBuilding({ pos: [262, 182], size: [8, 6], style: 'shed', doors: 'w', rot: -90 });
  tower(250, 124);
  truck(264, 140, 10, '#4d5a3c');
  stack(244, 160, 4);
  stack(228, 194, 3);
  barricade(230, 136, 4, 60);
  barricade(244, 188, 4, -30);
  // Field in front: a burnt-out tank, a lost truck.
  wreck(170, 152, 110);
  truck(186, 118, 140, '#4d5a3c');
}

// --- Bases -------------------------------------------------------------------
// Tents, a hut and sandbags on the flanks; the ground behind is left clear for
// the vehicle pads and tank spots (found at load by ray casts).
for (const [[bx, bz], s] of [[BLUE, 1], [RED, -1]]) {
  for (let i = 0; i < 3; i++) {
    tent(bx - s * 6 + s * i * 8, bz - 26, 0);
    tent(bx - s * 6 + s * i * 8, bz + 26, 0);
  }
  for (const dz of [-12, 12]) barricade(bx + s * 24, bz + dz, 5, 90);
  tower(bx + s * 26, bz - 32);
  addBuilding({ pos: [bx + s * 4, bz - 40], size: [14, 7], style: 'barracks', doors: 's', rot: 0 });
  truck(bx + s * 30, bz + 30, 90, '#dcdcd4');
  stack(bx + s * 16, bz - 20, 3);
}

// --- Between the zones -------------------------------------------------------
// Roadside inns at the ring-road junctions, a forester's lodge, woodcutters'
// huts, hunting stands, timber stacked by the tracks, broken-down trucks.
addBuilding({ pos: [-166, -22], size: [18, 10], style: 'inn', floors: 2, doors: 'sw', rot: 180 });
truck(-150, -24, 0, '#5a4a36');
car(-178, -32, 90);
cart(-160, -34, 90);
addBuilding({ pos: [166, 22], size: [18, 10], style: 'inn', floors: 2, doors: 'se', rot: 0 });
truck(150, 24, 180, '#5a4a36');
car(178, 32, 90);
cart(160, 34, 90);
addBuilding({ pos: [-120, -62], size: [10, 8], style: 'house', floors: 2, doors: 'se', rot: 30 });
addBuilding({ pos: [128, 52], size: [10, 8], style: 'house', floors: 2, doors: 'nw', rot: 210 });
addBuilding({ pos: [-150, 250], size: [7, 6], style: 'shed', doors: 'n', rot: 15 });
addBuilding({ pos: [140, -250], size: [7, 6], style: 'shed', doors: 's', rot: -15 });
for (const [x, z] of [[-300, -130], [300, 130], [-90, 190], [92, -190], [-150, -150], [150, 150]]) tower(x, z);
for (const [r, frac, side] of [[roads.ringW, 0.3, 1], [roads.ringE, 0.7, -1], [roads.northW, 0.55, -1], [roads.northE, 0.45, 1], [roads.southW, 0.4, 1], [roads.southE, 0.6, -1], [roads.trackW, 0.6, 1], [roads.trackE, 0.4, -1]]) {
  verge(r, frac, side, (x, z, yaw) => logs(x, z, 7, yaw - 90, 1.6));
}
verge(roads.ringW, 0.82, -1, (x, z, yaw) => truck(x, z, yaw + 8, '#4d5a3c'));
verge(roads.ringE, 0.18, 1, (x, z, yaw) => truck(x, z, yaw - 8, '#4d5a3c'));

// Clutter so no zone is an empty clearing: crates, barrels, sandbags, logs.
for (const [id, [zx, zz]] of Object.entries(Z)) {
  const r0 = RADIUS[id];
  let n = 0;
  for (let i = 0; i < 80 && n < 14; i++) {
    const a = R() * Math.PI * 2;
    const r = 6 + R() * (r0 - 4);
    const x = zx + Math.cos(a) * r;
    const z = zz + Math.sin(a) * r;
    if (nearRoad(x, z, 1.5) || nearRiver(x, z, 1) || nearRail(x, z, 3) || !free(x, z, 1.6)) continue;
    const k = R();
    if (k < 0.55) crate(x, z);
    else if (k < 0.8) barricade(x, z, 3 + R() * 2, R() * 180);
    else logs(x, z, 4 + R() * 2, R() * 180, 1.2);
    n++;
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
const noiseAt = (x, z) => 0.65 * vnoise(x / 80 + 3, z / 80) + 0.35 * vnoise(x / 26 + 11, z / 26 - 7);
// Mirrored through the map centre (the zone layout is too), blended across the
// middle: each side gets the same woods.
const woods = (x, z) => {
  const t = Math.min(1, Math.max(0, (x + 40) / 80));
  const k = t * t * (3 - 2 * t);
  return noiseAt(x, z) * (1 - k) + noiseAt(-x, -z) * k;
};
// Open ground: fields and meadows (room for tanks), ellipses [cx, cz, rx, rz, yaw].
const fields = [
  [-245, 172, 98, 64, 10], // farm fields
  [-255, -62, 64, 34, -15], // meadow under the chapel hill
  [166, 156, 64, 58, 0], // in front of the bunker ridge
  [258, -70, 56, 32, 20], // sawmill meadow
  [-96, 150, 42, 28, 30], // west bank, south
  [100, -156, 42, 28, -30], // east bank, north
];
const fieldAt = (x, z) => Math.min(...fields.map(([cx, cz, rx, rz, yaw]) => ellipseIn(x, z, cx, cz, rx, rz, yaw)));
// Candidates with a chance each, then thinned evenly to about TREES in all.
const TREES = 2800;
const STEP = 5;
const cand = [];
for (let gx = -420; gx <= 420; gx += STEP) {
  for (let gz = -350; gz <= 350; gz += STEP) {
    const x = gx + (R() - 0.5) * STEP * 0.9;
    const z = gz + (R() - 0.5) * STEP * 0.9;
    if (!inMap(x, z, 1.5)) continue;
    const edge = edgeDist(boundary, x, z);
    // Clumped woods with glades, deepest away from the roads, open near the
    // fights. (The scenery outside draws the forest beyond the edge, so the
    // band inside stays thin.)
    const w = woods(x, z);
    let p = 0.02 + 0.9 * Math.min(1, Math.max(0, (w - 0.4) / 0.16));
    let roadGap = Infinity;
    for (const r of roadList) roadGap = Math.min(roadGap, lineDist(x, z, r.pts) - r.w / 2);
    if (roadGap > 30) p += 0.2;
    if (edge < 12) p = Math.max(p, 0.5 - edge / 24);
    const f = fieldAt(x, z);
    if (f < 1) continue;
    if (f < 1.2) p *= 0.25; // hedgerows at the field edges
    let zoneGap = Infinity;
    for (const [id, [zx, zz]] of Object.entries(Z)) zoneGap = Math.min(zoneGap, Math.hypot(x - zx, z - zz) - RADIUS[id]);
    if (zoneGap < 3) continue;
    if (zoneGap < 16) p *= 0.3;
    if (Math.hypot(x, z) < 95) p *= 0.25; // village gardens
    if (roadGap < 3 || nearRiver(x, z, 2) || nearRail(x, z, 6) || !free(x, z, 1.2)) continue;
    if (Math.hypot(x - BLUE[0], z - BLUE[1]) < 75 || Math.hypot(x - RED[0], z - RED[1]) < 75) continue;
    cand.push([x, z, Math.min(1, p)]);
  }
}
const thin = Math.min(1, TREES / cand.reduce((a, c) => a + c[2], 0));
const trees = [];
for (const [x, z, p] of cand) if (R() < p * thin) trees.push([round(x, 1), round(z, 1), round(0.62 + R() * 0.42)]);

// --- Spawns & zones ----------------------------------------------------------
// A line across each base, facing the river: the vehicle pads are found behind
// the spawns' middle, so a line keeps them clear of where people appear.
const spawns = [];
for (let i = 0; i < 6; i++) {
  const dz = (i - 2.5) * 4.4;
  spawns.push({ team: 'blue', pos: [BLUE[0], 0.1, round(BLUE[1] + dz)], yaw: -90 });
  spawns.push({ team: 'red', pos: [RED[0], 0.1, round(RED[1] - dz)], yaw: 90 });
}
const zones = Object.entries(Z).map(([id, [x, z]]) => ({ id, pos: [round(x), 0, round(z)], radius: RADIUS[id] }));

// --- Checks (printed, not fatal): nothing solid on a road, the river or a bridge.
const kitsOnRoads = objects.filter((o) => o.model && o.snap && !['fence', 'sandbags'].includes(o.model) && nearRoad(o.pos[0], o.pos[2], Math.min(o.size[0], o.size[2]) / 2 - 0.3));
const blocked = buildings.filter((b) => nearRoad(b.pos[0], b.pos[1], Math.min(...b.size) / 2 - 0.5) || nearRiver(b.pos[0], b.pos[1], Math.min(...b.size) / 2 - 4));
for (const o of kitsOnRoads) console.warn(`  on a road: ${o.model} at ${o.pos[0]}, ${o.pos[2]}`);
for (const b of blocked) console.warn(`  building on a road / the river: ${b.style} at ${b.pos}`);

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
const styles = {};
for (const b of buildings) styles[b.style] = (styles[b.style] ?? 0) + 1;
const kits = {};
for (const o of objects) if (o.model) kits[o.model] = (kits[o.model] ?? 0) + 1;
console.log(`ardennes: ${objects.length} objects, ${buildings.length} buildings, ${props.length} props, ${trees.length} trees, area ${Math.round(area)} m², bounds ${Math.round(Math.max(...xs) - Math.min(...xs))} x ${Math.round(Math.max(...zs) - Math.min(...zs))} m, size ${map.world.size}`);
console.log('  styles', JSON.stringify(styles));
console.log('  kits', JSON.stringify(kits));
