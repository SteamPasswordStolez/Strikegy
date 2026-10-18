import * as THREE from 'three';
import type { Team } from '@/world/mapTypes';
import { KitBuilder } from '@/world/modelKits';
import type { MountNodes, VehicleModel } from './vehicleModels';
import { bakeInto } from './vehicleLooks';

/**
 * Warship models (2026-10-18, big maps plan step 5): destroyer, carrier,
 * battleship and submarine, procedural like every vehicle, front -z, the
 * origin at the hull box's centre (vehicleData / warships.ts sizes). Painted
 * in the aircraft livery's greys (warships aren't in camouflage). Gun
 * stations get turret / gun / muzzle nodes in seat order; the rest none.
 */

const LIVERY = 'air' as const;

/** Hull sides from keel to deck down both sides, a sharp raked bow, a flat transom; and the deck. */
function hull(b: KitBuilder, len: number, beam: number, keel: number, deck: number, bow = 0.22, deckMat: 'dark' | 'wood' = 'dark'): void {
  const L0 = -len / 2;
  const L1 = len / 2;
  const half = (u: number) => beam * Math.min(1, Math.sqrt(Math.max(0, u) / bow)) * (u > 0.94 ? 0.94 + (1 - u) * 0.8 : 1);
  for (const side of [-1, 1]) {
    b.grid(
      'paint',
      22,
      4,
      (u, v) => {
        const z = L0 + (L1 - L0) * u;
        const w = half(u);
        // Flat-ish bottom rising at the bow, flared sides.
        const k = keel + (deck - keel) * 0.5 * Math.max(0, 1 - u / 0.12) ** 2;
        const x = w * (v < 0.25 ? 0.6 + v * 1.6 : 1);
        const y = k + (deck + 0.6 * Math.max(0, 1 - u / 0.3) - k) * v;
        return [side * x, y, z];
      },
      true,
    );
  }
  b.box('paint', [beam * 1.8, deck - keel, 0.1], [0, (deck + keel) / 2, L1]);
  // The deck: a slab inside the sides; a boot topping stripe at the waterline.
  b.loft(deckMat, [[-beam * 0.15, L0 + len * 0.03], [beam * 0.15, L0 + len * 0.03], [beam * 0.95, L1 - 0.2], [-beam * 0.95, L1 - 0.2]], [[-beam * 0.15, L0 + len * 0.03], [beam * 0.15, L0 + len * 0.03], [beam * 0.95, L1 - 0.2], [-beam * 0.95, L1 - 0.2]], deck - 0.05, deck + 0.05);
  b.loft(deckMat, [[-beam * 0.98, L0 + len * bow], [beam * 0.98, L0 + len * bow], [beam * 0.98, L1 - 0.3], [-beam * 0.98, L1 - 0.3]], [[-beam * 0.98, L0 + len * bow], [beam * 0.98, L0 + len * bow], [beam * 0.98, L1 - 0.3], [-beam * 0.98, L1 - 0.3]], deck - 0.04, deck + 0.06);
}

/** A gun house on a ring: turret yaws, the barrels pitch from the house's front; returns the nodes. */
function gunHouse(root: THREE.Group, team: Team | null, at: [number, number, number], size: { w: number; h: number; d: number; barrels: number; bore: number; length: number; spacing: number }): MountNodes {
  const turret = new THREE.Group();
  turret.position.set(...at);
  root.add(turret);
  const tb = new KitBuilder();
  const { w, h, d } = size;
  tb.cyl('dark', w * 0.45, w * 0.5, 0.4, [0, -0.2, 0], [0, 0, 0], 20);
  tb.loft('paint', [[-w / 2, -d * 0.45], [w / 2, -d * 0.45], [w / 2, d / 2], [-w / 2, d / 2]], [[-w * 0.42, -d * 0.35], [w * 0.42, -d * 0.35], [w * 0.45, d * 0.48], [-w * 0.45, d * 0.48]], 0, h);
  tb.box('dark', [w * 0.6, 0.12, 0.6], [0, h + 0.06, d * 0.2]);
  bakeInto(turret, tb, team, LIVERY);
  const gun = new THREE.Group();
  gun.position.set(0, h * 0.5, -d * 0.45);
  turret.add(gun);
  const gb = new KitBuilder();
  for (let i = 0; i < size.barrels; i++) {
    const x = (i - (size.barrels - 1) / 2) * size.spacing;
    gb.cyl('dark', size.bore, size.bore * 1.5, size.length, [x, 0, -size.length / 2], [Math.PI / 2, 0, 0], 12);
    gb.cyl('dark', size.bore * 1.2, size.bore * 1.2, size.length * 0.08, [x, 0, -size.length * 0.98], [Math.PI / 2, 0, 0], 12);
  }
  bakeInto(gun, gb, team, LIVERY);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -size.length);
  gun.add(muzzle);
  return { turret, gun, muzzle };
}

/** A twin 40 mm AA mount in a round tub. */
function aaMount(root: THREE.Group, team: Team | null, at: [number, number, number], tub = true): MountNodes {
  if (tub) {
    const b = new KitBuilder();
    b.cyl('paint', 1.7, 1.7, 1.1, [at[0], at[1] - 1.3, at[2]], [0, 0, 0], 18, true);
    bakeInto(root, b, team, LIVERY);
  }
  return gunHouse(root, team, [at[0], at[1] - 0.6, at[2]], { w: 1.4, h: 0.9, d: 1.6, barrels: 2, bore: 0.05, length: 2.8, spacing: 0.35 });
}

/** A torpedo mount: a cluster of tubes that turns. */
function torpedoMount(root: THREE.Group, team: Team | null, at: [number, number, number], tubes = 4, length = 7): MountNodes {
  const turret = new THREE.Group();
  turret.position.set(...at);
  root.add(turret);
  const gun = new THREE.Group();
  turret.add(gun);
  const b = new KitBuilder();
  b.cyl('dark', 1.0, 1.1, 0.5, [0, -0.6, 0], [0, 0, 0], 16);
  for (let i = 0; i < tubes; i++) b.cyl('paint', 0.3, 0.3, length, [(i - (tubes - 1) / 2) * 0.7, 0, 0], [Math.PI / 2, 0, 0], 10);
  b.box('paint', [tubes * 0.7 + 0.4, 0.5, 1.2], [0, 0.2, 1.5]);
  bakeInto(gun, b, team, LIVERY);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -length / 2 - 0.3);
  gun.add(muzzle);
  return { turret, gun, muzzle };
}

/** A fixed launcher (bow tubes, depth charge rails): no turret, the muzzle where things leave. */
function fixedLauncher(root: THREE.Group, at: [number, number, number], back = false): MountNodes {
  const gun = new THREE.Group();
  gun.position.set(...at);
  if (back) gun.rotation.y = Math.PI;
  root.add(gun);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -1);
  gun.add(muzzle);
  return { turret: null, gun, muzzle };
}

/** Rails: posts and two wires along a deck edge from z0 to z1 at x. */
function rails(b: KitBuilder, x: number, deck: number, z0: number, z1: number): void {
  for (let z = z0; z <= z1; z += 3) b.rod('metal', [x, deck, z], [x, deck + 1.0, z], 0.03, 4);
  for (const y of [0.55, 1.0]) b.rod('metal', [x, deck + y, z0], [x, deck + y, z1], 0.018, 4);
}

export function buildDestroyer(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const D = 3;
  const b = new KitBuilder();
  hull(b, 115, 6, -3, D);
  // Bridge: a stepped block with a band of windows, the compass platform on top; the mast and radar.
  b.box('paint', [8, 3.2, 10], [0, D + 1.6, -12]);
  b.box('paint', [6.5, 2.6, 6], [0, D + 4.5, -14]);
  b.box('glass', [6.6, 0.9, 6.1], [0, D + 5.0, -14]);
  b.box('paint', [7, 0.25, 6.6], [0, D + 5.9, -14]);
  b.rod('metal', [0, D + 6, -10], [0, D + 17, -9.5], 0.18, 8);
  b.box('dark', [3.4, 0.2, 0.8], [0, D + 14, -9.6]);
  b.rod('metal', [-2, D + 12, -9.7], [2, D + 12, -9.7], 0.06, 4);
  // Two raked funnels on the deckhouse, boats in davits, the aft deckhouse.
  b.box('paint', [5.2, 4.8, 18], [0, D + 2.4, 4]);
  for (const z of [-1, 9]) {
    b.cyl('paint', 1.5, 1.7, 5.5, [0, D + 7.4, z], [-0.08, 0, 0], 14);
    b.cyl('dark', 1.45, 1.45, 0.4, [0, D + 10.2, z - 0.2], [-0.08, 0, 0], 14);
  }
  for (const s of [-1, 1]) b.box('paint', [1.4, 0.9, 6], [s * 3.9, D + 1.7, 17]);
  b.box('paint', [4.4, 2.6, 7], [0, D + 1.3, 30]);
  // Depth charge racks at the stern, anchors and a jack staff at the bow.
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) b.cyl('dark', 0.35, 0.35, 0.9, [s * 1.6, D + 0.45, 50 + k * 1.0], [0, 0, Math.PI / 2], 10);
  for (const s of [-1, 1]) b.box('dark', [0.5, 0.8, 0.3], [s * 3.6, D - 0.6, -48]);
  b.rod('metal', [0, D + 0.6, -55], [0, D + 4, -55.5], 0.04, 4);
  rails(b, -5.9, D, -45, 54);
  rails(b, 5.9, D, -45, 54);
  // Hull number on the bow.
  for (const s of [-1, 1]) b.box('light', [0.05, 1.6, 3.6], [s * 4.1, D - 1.4, -44]);
  bakeInto(root, b, team, LIVERY);
  const gunSize = { w: 4.2, h: 3.0, d: 5.0, barrels: 1, bore: 0.12, length: 6.2, spacing: 0 };
  const fore = gunHouse(root, team, [0, D + 0.4, -35], gunSize);
  const aft = gunHouse(root, team, [0, D + 0.4, 42], gunSize);
  const torp = torpedoMount(root, team, [0, D + 1.3, 9], 4, 7);
  const aa = aaMount(root, team, [-4.2, D + 2.0, 22]);
  const asw = fixedLauncher(root, [0, D + 0.5, 56], true);
  return { root, wheels: [], mounts: [null, fore, aft, torp, aa, asw] };
}

export function buildCarrier(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const D = 8;
  const b = new KitBuilder();
  hull(b, 250, 14.5, -8, D - 1.5, 0.15);
  // The flight deck: overhanging the hull, wood planked, its markings and lifts.
  b.box('wood', [32, 0.6, 250], [0, D - 0.3, 0]);
  b.box('dark', [32.2, 1.6, 250.2], [0, D - 1.4, 0]);
  for (let z = -110; z <= 110; z += 20) b.box('light', [0.5, 0.04, 8], [0, D + 0.03, z]);
  for (const s of [-1, 1]) b.box('light', [0.3, 0.04, 244], [s * 14, D + 0.03, 0]);
  for (const z of [-70, 10, 80]) b.box('dark', [12, 0.05, 12], [0, D + 0.04, z]);
  // The island: bridge, funnel, mast, radar.
  b.box('paint', [5.2, 12, 28], [12.5, D + 6, 2]);
  b.box('glass', [5.3, 1.2, 14], [12.5, D + 10.5, -6]);
  b.box('paint', [4, 8, 8], [12.5, D + 14, 6]);
  b.cyl('dark', 1.6, 1.6, 0.4, [12.5, D + 18.2, 6], [0, 0, 0], 14);
  b.rod('metal', [12.5, D + 12, -2], [12.5, D + 26, -2], 0.25, 8);
  b.box('dark', [5, 0.3, 1.2], [12.5, D + 22, -2]);
  // Gun tubs along both sides below the deck edge, catwalks.
  for (const s of [-1, 1]) {
    for (const z of [-60, -20, 30, 70]) b.cyl('paint', 1.6, 1.6, 1.2, [s * 16.5, D - 1.4, z], [0, 0, 0], 14, true);
    b.box('dark', [1.2, 0.15, 230], [s * 16.6, D - 1.2, 0]);
  }
  bakeInto(root, b, team, LIVERY);
  const aa = (x: number, z: number) => aaMount(root, team, [x, D + 1.2, z]);
  return { root, wheels: [], mounts: [null, null, aa(-14.5, -95), aa(14.5, -95), aa(-14.5, 100), aa(14.5, 100), null, null] };
}

export function buildBattleship(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const D = 7;
  const b = new KitBuilder();
  hull(b, 245, 17, -7, D, 0.2, 'wood');
  // Armoured citadel, the tower (bridge decks stepping up to fire control), the funnel, the aft superstructure.
  b.box('paint', [14, 2.4, 80], [0, D + 1.2, 0]);
  b.box('paint', [12, 6, 16], [0, D + 5.4, -16]);
  b.box('paint', [9, 5, 11], [0, D + 10.8, -17]);
  b.box('glass', [9.1, 1.2, 11.1], [0, D + 12.4, -17]);
  b.box('paint', [6.5, 6, 7], [0, D + 16.2, -18]);
  b.box('paint', [5, 3, 5], [0, D + 20.6, -18]);
  b.cyl('dark', 2.2, 2.2, 1.2, [0, D + 22.6, -18], [0, 0, 0], 16);
  b.box('dark', [7, 0.4, 2], [0, D + 23.6, -18]);
  b.cyl('paint', 3.6, 4, 10, [0, D + 12, 6], [-0.05, 0, 0], 18);
  b.cyl('dark', 3.5, 3.5, 0.5, [0, D + 17.1, 5.6], [-0.05, 0, 0], 18);
  b.box('paint', [10, 8, 22], [0, D + 6, 24]);
  b.rod('metal', [0, D + 12, 30], [0, D + 30, 31], 0.3, 8);
  // Catapult and the floatplane on it at the stern; boats; the anchor chains.
  b.box('dark', [1.2, 0.6, 18], [6, D + 1.3, 100], [0, 0.3, 0]);
  b.box('paint', [1.1, 1.1, 8], [6, D + 2.4, 100]);
  b.box('paint', [11, 0.2, 1.6], [6, D + 2.8, 99]);
  for (const s of [-1, 1]) b.box('paint', [2.4, 1.2, 8], [s * 6, D + 3, 38]);
  rails(b, -16.9, D, -100, 110);
  rails(b, 16.9, D, -100, 110);
  bakeInto(root, b, team, LIVERY);
  const main = { w: 11, h: 3.6, d: 12, barrels: 3, bore: 0.32, length: 17, spacing: 2.3 };
  const A = gunHouse(root, team, [0, D + 0.6, -66], main);
  const B = gunHouse(root, team, [0, D + 4.0, -46], main);
  const C = gunHouse(root, team, [0, D + 0.6, 66], main);
  const sec = { w: 4.5, h: 2.4, d: 5, barrels: 2, bore: 0.12, length: 6.5, spacing: 1.0 };
  const s1 = gunHouse(root, team, [-12, D + 2.2, -14], sec);
  const s2 = gunHouse(root, team, [-12, D + 2.2, 16], sec);
  const s3 = gunHouse(root, team, [12, D + 2.2, -14], sec);
  const s4 = gunHouse(root, team, [12, D + 2.2, 16], sec);
  const a1 = aaMount(root, team, [-10, D + 7.6, 34], false);
  const a2 = aaMount(root, team, [10, D + 7.6, 34], false);
  const a3 = aaMount(root, team, [0, D + 10.6, 46], false);
  return { root, wheels: [], mounts: [null, null, A, B, C, s1, s2, s3, s4, a1, a2, a3, null, null, null, null] };
}

export function buildSubmarine(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const D = 3.5;
  const b = new KitBuilder();
  // The pressure hull: a long body of revolution laid along z, the casing deck on top.
  const L = 95;
  const r = 3.6;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const prof = t < 0.12 ? Math.sin((t / 0.12) * Math.PI * 0.5) : t > 0.8 ? Math.cos(((t - 0.8) / 0.2) * Math.PI * 0.5) * 0.9 + 0.1 : 1;
    pts.push([Math.max(0.15, r * prof), t * L]);
  }
  const body = new KitBuilder();
  body.lathe('paint', pts, [0, 0, 0], 18);
  for (const p of body.pieces) {
    for (const g of [p.geo, p.far]) {
      if (!g) continue;
      g.rotateX(Math.PI / 2);
      g.translate(0, -0.4, -L / 2);
    }
    b.pieces.push(p);
  }
  b.box('dark', [3.4, 0.4, 70], [0, D - 0.2, -2]);
  // The sail (conning tower), its bridge rail, periscopes and masts; diving planes; the rudder.
  b.loft('paint', [[-1.6, -11], [1.6, -11], [1.6, -1], [-1.6, -1]], [[-1.2, -10], [1.2, -10], [1.3, -2], [-1.3, -2]], D, D + 6.4);
  b.box('dark', [2.4, 0.15, 8.5], [0, D + 6.45, -6]);
  for (const [z, h] of [[-8, 4], [-6.5, 5], [-4.5, 3.5]] as const) b.rod('metal', [0, D + 6.4, z], [0, D + 6.4 + h, z], 0.12, 6);
  for (const s of [-1, 1]) {
    b.box('paint', [5, 0.25, 1.6], [s * 3.8, -0.4, -36]);
    b.box('paint', [4, 0.25, 1.4], [s * 2.8, -0.4, 44]);
  }
  b.box('paint', [0.3, 4, 3], [0, -0.4, 46]);
  bakeInto(root, b, team, LIVERY);
  const fore = fixedLauncher(root, [0, -0.6, -46]);
  const aft = fixedLauncher(root, [0, -0.6, 46], true);
  const deckGun = gunHouse(root, team, [0, D + 0.8, -14], { w: 1.6, h: 1.2, d: 1.8, barrels: 1, bore: 0.09, length: 4, spacing: 0 });
  return { root, wheels: [], mounts: [null, null, fore, aft, null, deckGun] };
}
