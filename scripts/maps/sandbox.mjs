// Generates public/maps/sandbox.json — the practice range ("사격장").
// The range itself is the original hand-made 120 x 120 m yard (walls, cover, platforms,
// dummies, props). Since 2026-10-18 (big maps plan step 2: "try the sea on the range") its
// east wall is gone: a sandy beach runs down into a bay with a wooden pier and an assault
// boat at its end, the sea all round the range out to the horizon.
import { writeFileSync } from 'node:fs';
import { round } from './lib.mjs';

// --- The yard (as it was) ------------------------------------------------------------------
const objects = [
  {'type':'wall','pos':[0,3,-60],'size':[120,6,1]},
  {'type':'wall','pos':[0,3,60],'size':[120,6,1]},
  {'type':'wall','pos':[-60,3,0],'size':[1,6,120]},
  {'type':'wall','pos':[0,3,-50],'size':[40,6,1],'material':'brick'},
  {'type':'cover','pos':[-6,0.6,32],'size':[3,1.2,0.6]},
  {'type':'cover','pos':[6,0.6,32],'size':[3,1.2,0.6]},
  {'type':'cover','pos':[-12,1.25,20],'size':[1,2.5,4],'material':'concrete'},
  {'type':'floor','pos':[35,1.5,-10],'size':[10,3,10]},
  {'type':'ramp','pos':[35,1.29,-0.88],'size':[4,0.4,8.77],'rot':[20,0,0]},
  {'type':'floor','pos':[-35,1.2,-10],'size':[10,2.4,10]},
  {'type':'floor','pos':[-35,1.05,-4.8],'size':[3,2.1,0.4],'material':'wood'},
  {'type':'floor','pos':[-35,0.9,-4.4],'size':[3,1.8,0.4],'material':'wood'},
  {'type':'floor','pos':[-35,0.75,-4],'size':[3,1.5,0.4],'material':'wood'},
  {'type':'floor','pos':[-35,0.6,-3.6],'size':[3,1.2,0.4],'material':'wood'},
  {'type':'floor','pos':[-35,0.45,-3.2],'size':[3,0.9,0.4],'material':'wood'},
  {'type':'floor','pos':[-35,0.3,-2.8],'size':[3,0.6,0.4],'material':'wood'},
  {'type':'floor','pos':[-35,0.15,-2.4],'size':[3,0.3,0.4],'material':'wood'},
  {'type':'wall','pos':[18.5,0.7,20],'size':[0.5,1.4,6]},
  {'type':'wall','pos':[21.5,0.7,20],'size':[0.5,1.4,6]},
  {'type':'floor','pos':[20,1.55,20],'size':[3.5,0.3,6],'material':'metal'},
  {'type':'prop','pos':[14,0.4,8],'size':[2,0.8,2],'material':'metal'},
  {'type':'prop','pos':[17,0.75,8],'size':[2,1.5,2],'material':'metal'},
  {'type':'wall','pos':[-25,1.75,20],'size':[10,3.5,0.4],'material':'brick'},
  {'type':'wall','pos':[-30,1.75,25],'size':[0.4,3.5,10],'material':'brick'},
  {'type':'wall','pos':[-20,1.75,25],'size':[0.4,3.5,10],'material':'brick'},
  {'type':'wall','pos':[-28.25,1.75,30],'size':[3.5,3.5,0.4],'material':'brick'},
  {'type':'wall','pos':[-21.75,1.75,30],'size':[3.5,3.5,0.4],'material':'brick'},
  {'type':'floor','pos':[-25,3.6,25],'size':[10.4,0.2,10.4]},
];
const spawns = [
  {'team':'player','pos':[0,0.1,45],'yaw':0},
  {'team':'blue','pos':[-12,0.1,50],'yaw':0},
  {'team':'blue','pos':[12,0.1,50],'yaw':0},
  {'team':'blue','pos':[-28,0.1,48],'yaw':0},
  {'team':'blue','pos':[28,0.1,48],'yaw':0},
  {'team':'red','pos':[-10,0.1,-55],'yaw':180},
  {'team':'red','pos':[0,0.1,-55],'yaw':180},
  {'team':'red','pos':[10,0.1,-55],'yaw':180},
  {'team':'red','pos':[-32,0.1,-48],'yaw':180},
  {'team':'red','pos':[32,0.1,-48],'yaw':180},
];
const targets = [
  {'pos':[-6,0,20]},
  {'pos':[4,0,10]},
  {'pos':[-3,0,-5]},
  {'pos':[8,0,-25]},
  {'pos':[0,0,-45]},
  {'pos':[35,3,-12]},
  {'pos':[-25,0,23]},
];
const props = [
  {'model':'concrete_road_barrier','pos':[-9,0,14]},
  {'model':'concrete_road_barrier','pos':[-7.45,0,14.1],'rot':[0,4,0]},
  {'model':'concrete_road_barrier','pos':[9,0,-8],'rot':[0,-10,0]},
  {'model':'concrete_road_barrier','pos':[10.55,0,-8.35],'rot':[0,-6,0]},
  {'model':'concrete_road_barrier','pos':[-16,0,0],'rot':[0,90,0]},
  {'model':'concrete_road_barrier','pos':[-16.05,0,-1.6],'rot':[0,86,0]},
  {'model':'barrel_03','pos':[-18,0,34]},
  {'model':'barrel_03','pos':[-17.3,0,34.65],'rot':[0,40,0]},
  {'model':'barrel_03','pos':[-18.6,0,35.2],'rot':[0,75,0]},
  {'model':'metal_jerrycan_green','pos':[-16.7,0,33.5],'rot':[0,25,0]},
  {'model':'metal_jerrycan_green','pos':[-16.35,0,34.1],'rot':[0,-40,0]},
  {'model':'wooden_military_crate','pos':[3.5,0,40],'rot':[0,10,0]},
  {'model':'wooden_military_crate','pos':[3.45,0.465,40.05],'rot':[0,4,0]},
  {'model':'ammo_box','pos':[3.8,0.93,40],'rot':[0,70,0],'collide':false},
  {'model':'ammo_box','pos':[3.2,0.93,40.1],'rot':[0,95,0],'collide':false},
  {'model':'old_military_crate','pos':[11,0,25],'rot':[0,-20,0]},
  {'model':'old_tyre','pos':[15,0.083,15],'rot':[90,0,0]},
  {'model':'old_tyre','pos':[15.05,0.249,15.02],'rot':[90,0,0]},
  {'model':'old_tyre','pos':[14.97,0.415,14.98],'rot':[90,0,0]},
  {'model':'old_tyre','pos':[16,0.3,16.3],'rot':[0,30,0]},
  {'model':'old_military_crate','pos':[33,3,-7],'rot':[0,15,0]},
  {'model':'barrel_03','pos':[38,3,-13]},
  {'model':'wooden_military_crate','pos':[-27,0,22],'rot':[0,0,0]},
  {'model':'ammo_box','pos':[-27.4,0.465,22],'rot':[0,80,0],'collide':false},
  {'model':'metal_jerrycan_green','pos':[-22,0,21],'rot':[0,-15,0]},
];

// --- The beach, the bay, the pier ----------------------------------------------------------
// One wide dip east of the yard: flat in the yard, the beach from x ~60, the water's edge at
// x ~80 (sea level -0.6), swimming depth from x ~118, then the open bay.
const SEA_LEVEL = -0.6;
const terrain = { cell: 2, hills: [{ pos: [430, 0], radius: 400, height: -16 }] };
const boundary = [
  [-61, -61], [61, -61], [61, -100], [300, -100], [300, 100], [61, 100], [61, 61], [-61, 61],
];
// The pier: decking on posts from the beach out into the bay, a ladder of steps at its end.
const PIER = { z: -30, x0: 70, x1: 132, w: 3, top: 0.75 };
for (let x = PIER.x0; x < PIER.x1; x += 6) {
  objects.push({ type: 'floor', pos: [round(x + 3), PIER.top - 0.12, PIER.z], size: [6, 0.24, PIER.w], material: 'wood', color: '#7a6248' });
  for (const s of [-1, 1]) objects.push({ type: 'prop', pos: [round(x + 3), -3.5, PIER.z + s * (PIER.w / 2 - 0.15)], size: [0.3, 8.4, 0.3], material: 'wood', color: '#5d4a38' });
}
for (const s of [-1, 1]) objects.push({ type: 'cover', pos: [round((PIER.x0 + PIER.x1) / 2), PIER.top + 0.5, PIER.z + s * (PIER.w / 2 - 0.05)], size: [PIER.x1 - PIER.x0, 0.08, 0.08], material: 'wood', color: '#6e5a44' });
// Steps down into the water at the far end.
for (let i = 0; i < 5; i++) objects.push({ type: 'floor', pos: [PIER.x1 + 0.4 + i * 0.4, PIER.top - 0.3 - i * 0.3, PIER.z - 2.1], size: [0.4, 0.2, 1.2], material: 'wood', color: '#7a6248' });
// Steps up from the sand at the beach end.
for (let i = 0; i < 4; i++) objects.push({ type: 'floor', pos: [PIER.x0 - 0.4 - i * 0.6, round(PIER.top - 0.3 - i * 0.3, 2), PIER.z], size: [0.6, 0.6, PIER.w], material: 'wood', color: '#7a6248' });

const map = {
  meta: { id: 'sandbox', name: 'Sandbox Range', version: 2 },
  world: {
    size: [800, 400],
    boundary,
    terrain,
    visualProfile: 'outdoor_day',
    groundMaterial: 'ground',
    sea: { level: SEA_LEVEL, waves: 'moderate', floor: -16 },
    view: { far: 4000 },
  },
  spawns,
  objects,
  props,
  targets,
  vehicles: [{ kind: 'boat', pos: [PIER.x1 - 4, PIER.z + 4.5], yaw: -90 }],
};
writeFileSync(new URL('../../public/maps/sandbox.json', import.meta.url), JSON.stringify(map));
console.log(`sandbox: ${objects.length} objects, sea at ${SEA_LEVEL} m`);
