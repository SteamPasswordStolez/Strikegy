// Generates public/maps/coral_reach.json — "산호 해역" (Coral Reach), the naval battle map
// (big maps plan step 7, 2026-10-19). A Pacific sea of about 6 x 5 km with a Battle of
// Midway feel: each side's fleet (carrier, battleship, destroyer, submarine) starts off its
// own end, between them a scatter of volcanic islets to hide behind and coral reefs to keep
// off (too shallow for any keel). Fleet battle only: the ships are the spawn points, a sunk
// ship is gone, sinking the whole enemy fleet wins, after 30 minutes the larger fleet health
// left wins. 40 a side. Each side also has a small harbour islet far behind its fleet where
// people waiting for a free station stand (it is no base: nobody deploys there while a ship
// of theirs is afloat). The islands are cover only: no infantry fighting.
import { writeFileSync } from 'node:fs';
import { block, rng, round } from './lib.mjs';

const R = rng(20261020);
const HALF = [3000, 2500];
const boundary = [[-HALF[0], -HALF[1]], [HALF[0], -HALF[1]], [HALF[0], HALF[1]], [-HALF[0], HALF[1]]];
// The sea bed (as on the test sea: one huge shallow bowl, islands rising out of it).
const BED = 45;
const islands = [];
const island = (x, z, radius, rise) => islands.push({ pos: [round(x), round(z)], radius: round(radius), height: round(BED + rise, 1) });
// Harbour islets far behind each fleet.
island(-2780, 0, 170, 6);
island(2780, 0, 170, 6);
// The middle: a volcanic island with a cone (good cover for a whole fleet), two lesser ones.
island(0, 0, 420, 18);
island(0, -60, 160, 40);
island(-650, 1400, 300, 14);
island(-640, 1420, 110, 26);
island(700, -1450, 300, 14);
island(690, -1440, 110, 26);
// Islets scattered over both halves, mirrored so neither side has better cover.
for (let k = 0; k < 7; k++) {
  const x = 350 + R() * 1150;
  const z = -2100 + R() * 4200;
  const r = 90 + R() * 160;
  const h = 6 + R() * 18;
  island(x, z, r, h);
  island(-x, -z, r, h);
}
// Coral reefs: wide, a metre or two under the surface — any keel runs aground on them.
const reefs = [];
for (let k = 0; k < 6; k++) {
  const x = 300 + R() * 1200;
  const z = -2200 + R() * 4400;
  const r = 140 + R() * 220;
  reefs.push({ pos: [round(x), round(z)], radius: round(r), height: round(BED - 1.6, 1) });
  reefs.push({ pos: [round(-x), round(-z)], radius: round(r), height: round(BED - 1.6, 1) });
}
const terrain = {
  // 4 m cells: the sea bed is smooth, the islands are cover, not ground to fight over.
  cell: 4,
  hills: [{ pos: [0, 0], radius: 30000, height: -BED }, ...islands, ...reefs],
  flats: [{ pos: [-2780, 0], radius: 40, blend: 40 }, { pos: [2780, 0], radius: 40, blend: 40 }, { pos: [0, 0], radius: 30, blend: 30 }],
};

// The spawn points on the harbour islets (where spare people wait).
const spawns = [];
for (const [team, x, yaw] of [['blue', -2780, -90], ['red', 2780, 90]]) {
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    spawns.push({ team, pos: [round(x + Math.cos(a) * 14), 0.1, round(Math.sin(a) * 14)], yaw });
  }
}
// One zone for the engine (hidden in the fleet battle), on the middle island.
const zones = [{ id: 'A', pos: [0, 0, 0], radius: 40 }];
// A few huts and sandbags on the harbour islets.
const objects = [];
for (const x of [-2780, 2780]) {
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.4;
    objects.push(block(x + Math.cos(a) * 30, Math.sin(a) * 30, 3.2, 1.2, 0.8, { yaw: (-a * 180) / Math.PI, material: 'concrete' }));
  }
}
// Palms on the islands' shores and slopes.
const trees = [];
for (const isl of islands) {
  const n = Math.min(40, Math.round(isl.radius / 10));
  for (let k = 0; k < n; k++) {
    const a = R() * Math.PI * 2;
    const d = isl.radius * (0.15 + R() * 0.45);
    trees.push([round(isl.pos[0] + Math.cos(a) * d), round(isl.pos[1] + Math.sin(a) * d), round(0.8 + R() * 0.5, 2)]);
  }
}
// The fleets, bows toward each other; the carrier furthest back.
const FLEET = [['cv', -2300, -350], ['bb', -1950, 250], ['dd', -1750, 750], ['ss', -1850, -900]];
const vehicles = [];
for (const [kind, x, z] of FLEET) {
  vehicles.push({ kind, pos: [x, z], yaw: -90, team: 'blue' });
  vehicles.push({ kind, pos: [-x, -z], yaw: 90, team: 'red' });
}

const map = {
  meta: { id: 'coral_reach', name: '산호 해역', version: 2 },
  world: {
    size: [HALF[0] * 2 + 600, HALF[1] * 2 + 600],
    boundary,
    terrain,
    visualProfile: 'tropical',
    groundMaterial: 'grass',
    flora: 'jungle',
    sea: { level: 0, waves: 'moderate', floor: -BED },
    shore: { top: 2.4, color: '#e2d3a8' },
    view: { far: 6500 },
    vehicles: 'fixed',
    ambience: { birds: 0.15, wind: 0.6 },
  },
  spawns,
  zones,
  modes: { default: 'fleet', fleet: { time: 1800 } },
  objects,
  trees,
  vehicles,
};
writeFileSync(new URL('../../public/maps/coral_reach.json', import.meta.url), JSON.stringify(map));
console.log(`coral_reach: ${islands.length} islands, ${reefs.length} reefs, ${trees.length} palms, ${vehicles.length} warships`);
