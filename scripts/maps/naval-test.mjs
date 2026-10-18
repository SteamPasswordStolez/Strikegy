// Generates public/maps/naval_test.json — the warship test sea (big maps plan step 5,
// 2026-10-19). Not in the lobby: `?map=naval_test`. A 2 x 1.6 km sea about 40 m deep with a
// few islets; each side has one of each warship (carrier, battleship, destroyer, submarine)
// lying off its home islet, bows toward the other side. People deploy onto a ship's deck
// (the deploy screen lists the side's ships) and walk up to a station; bots are seated at
// stations from their islet. Three zones on the islets give the zone mode something to count
// (nobody fights for them: bots don't swim and there are no boats).
import { writeFileSync } from 'node:fs';
import { block, round } from './lib.mjs';

const HALF = [1000, 800];
const boundary = [[-HALF[0], -HALF[1]], [HALF[0], -HALF[1]], [HALF[0], HALF[1]], [-HALF[0], HALF[1]]];
// The sea bed: one huge dip (flat to a metre or two over the play area), islets rising out of it.
const BED = 42;
const ISLETS = [
  // Home islets (bases), west and east; a middle islet and two reefs to steer round.
  { pos: [-880, 0], radius: 150, height: BED + 6 },
  { pos: [880, 0], radius: 150, height: BED + 6 },
  { pos: [0, 0], radius: 120, height: BED + 4 },
  { pos: [-260, 520], radius: 90, height: BED + 1.5 },
  { pos: [300, -540], radius: 90, height: BED + 1.5 },
];
const terrain = {
  cell: 2,
  hills: [{ pos: [0, 0], radius: 12000, height: -BED }, ...ISLETS.map((i) => ({ pos: i.pos, radius: i.radius, height: round(i.height, 1) }))],
  flats: ISLETS.slice(0, 3).map((i) => ({ pos: i.pos, radius: 34, blend: 30 })),
};
// Ground height on an islet's flat top (the dip there is ~-BED + the islet's height).
const top = (i) => round(ISLETS[i].height - BED + BED * (1 - Math.cos(Math.PI * Math.hypot(...ISLETS[i].pos) / 12000)) * 0.5, 1);

const spawns = [];
for (const [team, i, yaw] of [['blue', 0, -90], ['red', 1, 90]]) {
  const [x, z] = ISLETS[i].pos;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    spawns.push({ team, pos: [round(x + Math.cos(a) * 12), 0.1, round(z + Math.sin(a) * 12)], yaw });
  }
}
const zones = [
  { id: 'A', pos: [ISLETS[0].pos[0], 0, 0], radius: 30 },
  { id: 'B', pos: [0, 0, 0], radius: 30 },
  { id: 'C', pos: [ISLETS[1].pos[0], 0, 0], radius: 30 },
];
// A little cover on the islets so they read as places.
const objects = [];
for (const i of [0, 1, 2]) {
  const [x, z] = ISLETS[i].pos;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    objects.push(block(x + Math.cos(a) * 24, z + Math.sin(a) * 24, 3, 1.2, 0.8, { yaw: (-a * 180) / Math.PI, material: 'concrete' }));
  }
}
// The fleets: in a line abreast off each home islet (x: 270 m off its centre), bows to the enemy.
const FLEET = [['cv', -330], ['bb', -60], ['dd', 150], ['ss', 290]];
const vehicles = [];
for (const [team, sx, yaw] of [['blue', -1, -90], ['red', 1, 90]]) {
  for (const [kind, z] of FLEET) vehicles.push({ kind, pos: [sx * 610, sx * z], yaw, team });
}

const map = {
  meta: { id: 'naval_test', name: 'Naval Test', version: 2 },
  world: {
    size: [HALF[0] * 2 + 400, HALF[1] * 2 + 400],
    boundary,
    terrain,
    visualProfile: 'tropical',
    groundMaterial: 'grass',
    flora: 'jungle',
    sea: { level: 0, waves: 'moderate', floor: -BED },
    shore: { top: 2.2, color: '#d9c9a0' },
    view: { far: 4000 },
    vehicles: 'fixed',
  },
  spawns,
  zones,
  modes: { default: 'zone', zone: { target: 1000 } },
  objects,
  vehicles,
};
writeFileSync(new URL('../../public/maps/naval_test.json', import.meta.url), JSON.stringify(map));
console.log(`naval_test: ${vehicles.length} warships, islet tops ${[0, 1, 2].map(top).join(' / ')} m`);
