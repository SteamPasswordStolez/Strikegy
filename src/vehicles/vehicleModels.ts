import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Team } from '@/world/mapTypes';
import { KitBuilder, type KitMaterial } from '@/world/modelKits';
import { VEHICLES, type VehicleKind } from './vehicleData';
import { bakeInto } from './vehicleLooks';
import { buildBattleship, buildCarrier, buildDestroyer, buildSubmarine } from './warshipModels';

/**
 * Procedural vehicle models. Origin is the chassis centre, forward is -z.
 * Wheels come back in the spec's wheel order (spun and steered by the
 * vehicle); the gun seat's turret yaws on `turret` and the barrel pitches on
 * `gun`, with `muzzle` at the end. No shadows: the sun's shadow map is baked for static scenery.
 */
export interface MountNodes {
  /** Yaws with the gun (null: fixed), pitches the barrel, the muzzle at its end. */
  turret: THREE.Object3D | null;
  gun: THREE.Object3D;
  muzzle: THREE.Object3D;
}

export interface VehicleModel {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  /** Gun pivots by seat (null for seats without a gun). */
  mounts: (MountNodes | null)[];
  /**
   * Far look: everything merged per material into the hull and each turret
   * (wheels stop turning, barrels rest level), a few draw calls instead of ~14.
   */
  setFar?: (far: boolean, fine?: boolean) => void;
}

export function buildVehicleModel(kind: VehicleKind, team: Team | null): VehicleModel {
  const m = buildParts(kind, team);
  // Dozens of small parts per vehicle: merge them into one mesh per material
  // within each moving piece (hull, turret, barrel, each wheel).
  const pivots = new Set<THREE.Object3D>(m.wheels);
  for (const n of m.mounts) if (n) for (const o of [n.turret, n.gun, n.muzzle]) if (o) pivots.add(o);
  mergeTree(m.root, pivots);
  m.setFar = buildFarLook(m);
  return m;
}

/**
 * Builds the merged far look (hidden) and returns a switch between it and the
 * detailed parts. Each mesh goes to the nearest turret above it, or the hull,
 * in the pose the model was built in.
 */
function buildFarLook(m: VehicleModel): (far: boolean) => void {
  const turrets = new Set<THREE.Object3D>();
  for (const n of m.mounts) if (n?.turret) turrets.add(n.turret);
  m.root.updateMatrixWorld(true);
  const detail: THREE.Mesh[] = [];
  const groups = new Map<THREE.Object3D, Map<THREE.Material, THREE.BufferGeometry[]>>();
  const inv = new THREE.Matrix4();
  m.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    // Far-only stand-ins go into the far look and are never shown near.
    if (!mesh.userData.farOnly) detail.push(mesh);
    // Small and near-only parts don't make it into the far look.
    if (mesh.userData.fine || mesh.userData.nearOnly) return;
    let anchor: THREE.Object3D = m.root;
    for (let p = mesh.parent; p && p !== m.root; p = p.parent) {
      if (turrets.has(p)) {
        anchor = p;
        break;
      }
    }
    inv.copy(anchor.matrixWorld).invert();
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(inv.multiply(mesh.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    const byMat = groups.get(anchor) ?? new Map<THREE.Material, THREE.BufferGeometry[]>();
    groups.set(anchor, byMat);
    const list = byMat.get(mesh.material as THREE.Material) ?? [];
    list.push(g);
    byMat.set(mesh.material as THREE.Material, list);
  });
  const far: THREE.Mesh[] = [];
  for (const [anchor, byMat] of groups) {
    for (const [mt, geos] of byMat) {
      const merged = mergeGeometries(geos);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mt);
      mesh.visible = false;
      mesh.name = 'far';
      anchor.add(mesh);
      far.push(mesh);
    }
  }
  let isFar = false;
  let showFine = true;
  return (want, fine = true) => {
    if (want === isFar && fine === showFine) return;
    isFar = want;
    showFine = fine;
    for (const d of detail) d.visible = !want && (fine || !d.userData.fine);
    for (const f of far) f.visible = want;
  };
}

function buildParts(kind: VehicleKind, team: Team | null): VehicleModel {
  if (kind === 'jeep') return buildJeep(team);
  if (kind === 'apc') return buildApc(team);
  if (kind === 'tank') return buildTank(team);
  if (kind === 'spg') return buildSpg(team);
  if (kind === 'td') return buildTd(team);
  if (kind === 'rocket') return buildRocketTruck(team);
  if (kind === 'fighter') return buildFighter(team);
  if (kind === 'cas') return buildCas(team);
  if (kind === 'boat') return buildBoat(team);
  if (kind === 'lcvp') return buildLcvp(team);
  if (kind === 'patrol') return buildPatrol(team);
  if (kind === 'dd') return buildDestroyer(team);
  if (kind === 'cv') return buildCarrier(team);
  if (kind === 'bb') return buildBattleship(team);
  if (kind === 'ss') return buildSubmarine(team);
  return buildBike(team);
}

/** Merges each node's plain mesh children by material (pivots and their children stay apart), all the way down. */
function mergeTree(node: THREE.Object3D, pivots: Set<THREE.Object3D>): void {
  const byMat = new Map<THREE.Material, THREE.Mesh[]>();
  for (const c of node.children) {
    const mesh = c as THREE.Mesh;
    // Fine parts stay apart (the far look leaves them out).
    if (!mesh.isMesh || pivots.has(c) || c.children.length || Array.isArray(mesh.material) || mesh.userData.fine || mesh.userData.nearOnly || mesh.userData.farOnly) continue;
    const list = byMat.get(mesh.material as THREE.Material) ?? [];
    list.push(mesh);
    byMat.set(mesh.material as THREE.Material, list);
  }
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geos = list.map((mesh) => {
      mesh.updateMatrix();
      const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrix);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      return g;
    });
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    for (const mesh of list) node.remove(mesh);
    node.add(new THREE.Mesh(merged, mat));
  }
  for (const c of [...node.children]) if (c.children.length) mergeTree(c, pivots);
}

/** A fixed gun / launcher point on an aircraft (fires along the nose). */
function fixedMount(parent: THREE.Object3D, x: number, y: number, z: number): MountNodes {
  const gun = new THREE.Group();
  gun.position.set(x, y, z);
  parent.add(gun);
  const muzzle = new THREE.Object3D();
  gun.add(muzzle);
  return { turret: null, gun, muzzle };
}

/** Hull-frame height of the ground under each tracked vehicle at rest (m, measured in game on Lyon, 2026-10-11). */
const TRACK_GROUND = { tank: -0.98, spg: -1.02, td: -1.04 } as const;

/**
 * Tracked running gear down both sides at |x| = `x`: dual road wheels with
 * rubber tyres and hubs, a toothed drive sprocket at the back (+z), an idler at
 * the front, return rollers, and a track of separate links wrapped round them
 * (the physics wheels are invisible hubs on tracked vehicles).
 */
function runningGear(b: KitBuilder, g: number, x: number, len: number, wheels: number, skirt: boolean): void {
  const rw = 0.33;
  const tw = 0.56;
  const front = -len / 2;
  const back = len / 2;
  const idler = { z: front + 0.35, y: g + 0.5, r: 0.3 };
  const sprocket = { z: back - 0.35, y: g + 0.55, r: 0.32 };
  const top = g + 0.97;
  for (const s of [-1, 1]) {
    const cx = s * x;
    // Road wheels: two discs with rubber rims, a hub with bolts between them
    // (far away: one plain disc a wheel).
    for (let i = 0; i < wheels; i++) {
      const zf = front + 0.95 + (i * (len - 1.9)) / (wheels - 1);
      b.only('far', () => b.cyl('dark', rw, rw, 0.42, [cx, g + rw, zf], [0, 0, Math.PI / 2], 10));
    }
    b.lod = 'near';
    for (let i = 0; i < wheels; i++) {
      const z = front + 0.95 + (i * (len - 1.9)) / (wheels - 1);
      for (const o of [-0.14, 0.14]) {
        b.cyl('dark', rw - 0.05, rw - 0.05, 0.16, [cx + o, g + rw, z], [0, 0, Math.PI / 2], 16);
        b.cyl('rubber', rw, rw, 0.12, [cx + o, g + rw, z], [0, 0, Math.PI / 2], 16, true);
      }
      b.cyl('metal', 0.11, 0.13, 0.08, [cx + s * 0.26, g + rw, z], [0, 0, (s * Math.PI) / 2], 8);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        b.cyl('metal', 0.018, 0.018, 0.04, [cx + s * 0.24, g + rw + Math.cos(a) * 0.17, z + Math.sin(a) * 0.17], [0, 0, Math.PI / 2], 5);
      }
    }
    b.lod = undefined;
    // Sprocket with teeth, idler, return rollers.
    b.cyl('dark', sprocket.r - 0.04, sprocket.r - 0.04, 0.42, [cx, sprocket.y, sprocket.z], [0, 0, Math.PI / 2], 16);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      for (const o of [-0.16, 0.16]) b.box('dark', [0.06, 0.09, 0.07], [cx + o, sprocket.y + Math.cos(a) * sprocket.r, sprocket.z + Math.sin(a) * sprocket.r], [-a, 0, 0]);
    }
    b.cyl('metal', 0.12, 0.12, 0.5, [cx, sprocket.y, sprocket.z], [0, 0, Math.PI / 2], 10);
    b.cyl('dark', idler.r, idler.r, 0.36, [cx, idler.y, idler.z], [0, 0, Math.PI / 2], 16);
    b.cyl('metal', 0.1, 0.1, 0.42, [cx, idler.y, idler.z], [0, 0, Math.PI / 2], 10);
    for (let i = 0; i < 3; i++) b.cyl('dark', 0.09, 0.09, 0.2, [cx, top - 0.13, front + 1.6 + i * ((len - 3.2) / 2)], [0, 0, Math.PI / 2], 10);
    // Track: a closed loop of links (bottom run, round the sprocket, top run, round the idler).
    const path: [number, number][] = [];
    const arc = (c: { z: number; y: number; r: number }, a0: number, a1: number) => {
      for (let k = 0; k <= 8; k++) {
        const a = a0 + ((a1 - a0) * k) / 8;
        path.push([c.z + Math.sin(a) * (c.r + 0.04), c.y - Math.cos(a) * (c.r + 0.04)]);
      }
    };
    path.push([idler.z + 0.2, g + 0.035]);
    path.push([sprocket.z - 0.2, g + 0.035]);
    arc(sprocket, 0.35, Math.PI);
    path.push([idler.z, top]);
    arc(idler, Math.PI, Math.PI * 2 - 0.4);
    path.push([idler.z + 0.2, g + 0.035]);
    // Far away the track is one belt round the loop.
    b.only('far', () =>
      b.grid('dark', path.length - 1, 1, (u, v) => {
        const k = Math.min(path.length - 1, Math.round(u * (path.length - 1)));
        const [z, y] = path[k]!;
        return [cx + (v - 0.5) * tw * s, y, z];
      }, true),
    );
    // Walk the loop, a link every 0.17 m (near only).
    b.lod = 'near';
    const pitch = 0.17;
    let carry = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const [z0, y0] = path[i]!;
      const [z1, y1] = path[i + 1]!;
      const segLen = Math.hypot(z1 - z0, y1 - y0);
      const ang = Math.atan2(y1 - y0, z1 - z0);
      for (let t = carry; t < segLen; t += pitch) {
        const f = t / segLen;
        const z = z0 + (z1 - z0) * f;
        const y = y0 + (y1 - y0) * f;
        b.box('dark', [tw, 0.06, pitch * 0.82], [cx, y, z], [ang, 0, 0]);
        b.box('metal', [0.05, 0.08, 0.05], [cx, y + 0.05 * Math.cos(ang), z - 0.05 * Math.sin(ang)], [ang, 0, 0]);
      }
      carry = (carry + Math.ceil((segLen - carry) / pitch) * pitch) - segLen;
    }
    b.lod = undefined;
    // Fender over the track, and side skirts with panel joints.
    b.box('paint', [tw + 0.1, 0.05, len + 0.35], [cx, g + 1.12, 0.05]);
    if (skirt) {
      for (let k = 0; k < 4; k++) {
        const zl = len / 4 - 0.04;
        b.box('paint', [0.04, 0.42, zl], [cx + s * (tw / 2 + 0.06), g + 0.92, front + 0.2 + zl / 2 + k * (zl + 0.04)]);
      }
    }
  }
}

/** A machine gun on a pivot (roof and hull MG seats): receiver, barrel with a flash hider, ammo box, a small shield. */
function mgMount(parent: THREE.Object3D, x: number, y: number, z: number, team: Team | null = null, shield = false): MountNodes {
  const turret = new THREE.Group();
  turret.position.set(x, y, z);
  parent.add(turret);
  const gun = new THREE.Group();
  gun.position.set(0, 0.1, 0);
  turret.add(gun);
  const b = new KitBuilder();
  b.box('dark', [0.11, 0.13, 0.5], [0, 0, 0.02]);
  b.box('dark', [0.08, 0.08, 0.16], [0, -0.03, 0.3]);
  b.cyl('dark', 0.022, 0.022, 0.62, [0, 0.015, -0.53], [Math.PI / 2, 0, 0], 8);
  b.cyl('dark', 0.032, 0.03, 0.1, [0, 0.015, -0.88], [Math.PI / 2, 0, 0], 8);
  b.tinted('#3c4232', () => b.box('paint', [0.1, 0.16, 0.24], [-0.12, -0.04, 0.02]));
  b.box('dark', [0.04, 0.1, 0.04], [0, -0.1, 0.02]);
  if (shield) b.box('paint', [0.5, 0.36, 0.025], [0, 0.04, -0.25]);
  bakeInto(gun, b, team);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.015, -0.95);
  gun.add(muzzle);
  return { turret, gun, muzzle };
}

/**
 * Main gun on its pivot: a mantlet block, barrel in thermal-sleeve sections
 * with clamp bands, a bore evacuator and (optional) a muzzle brake. The barrel
 * runs from `from` to `to` (negative z, forward).
 */
function mainGun(b: KitBuilder, from: number, to: number, r: number, evac: number, brake: boolean): void {
  const len = from - to;
  b.cyl('dark', r, r * 1.08, len, [0, 0, (from + to) / 2], [Math.PI / 2, 0, 0], 14);
  for (let k = 1; k < 4; k++) b.cyl('dark', r * 1.22, r * 1.22, 0.05, [0, 0, from - (len * k) / 4], [Math.PI / 2, 0, 0], 14);
  b.lathe('dark', [[r * 1.02, 0], [r * 1.65, 0.12], [r * 1.65, 0.45], [r * 1.02, 0.6]], [0, 0, 0], 16);
  // The lathe stands on y; turn it onto the barrel at `evac` along it.
  const p = b.pieces[b.pieces.length - 1]!;
  p.geo.rotateX(-Math.PI / 2);
  p.geo.translate(0, 0, from - len * evac);
  if (brake) {
    b.box('dark', [r * 3.2, r * 2.1, 0.42], [0, 0, to - 0.15]);
    for (const s of [-1, 1]) b.box('dark', [0.02, r * 1.6, 0.3], [s * r * 1.65, 0, to - 0.15]);
  } else b.cyl('dark', r * 1.15, r * 1.15, 0.12, [0, 0, to + 0.06], [Math.PI / 2, 0, 0], 14);
}

/** Tracked vehicles keep their physics wheels as invisible hubs (the road wheels are part of the hull). */
function hiddenWheels(root: THREE.Group, kind: VehicleKind): THREE.Object3D[] {
  return VEHICLES[kind].wheels.map((w) => {
    const o = new THREE.Object3D();
    o.position.set(w.pos[0], w.pos[1] - VEHICLES[kind].suspension.rest, w.pos[2]);
    root.add(o);
    return o;
  });
}

function buildTank(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const g = TRACK_GROUND.tank;
  const hull = new KitBuilder();
  runningGear(hull, g, 1.45, 6.6, 7, true);
  // Hull: lower front plate, upper glacis, flat deck, sloped rear; sponsons over the tracks.
  hull.profile(
    'paint',
    [
      [-3.0, g + 0.45],
      [3.15, g + 0.45],
      [3.4, g + 0.85],
      [3.35, g + 1.48],
      [-2.15, g + 1.48],
      [-3.55, g + 1.0],
    ],
    2.3,
  );
  for (const s of [-1, 1]) hull.box('paint', [0.62, 0.36, 6.0], [s * 1.45, g + 1.31, 0.2]);
  // Glacis details: driver's hatch and periscopes, spare track links, lights with guards, tow hooks.
  hull.cyl('paint', 0.34, 0.36, 0.08, [0.55, g + 1.52, -2.0], [0, 0, 0], 16);
  for (const dx of [-0.2, 0, 0.2]) hull.box('glass', [0.14, 0.06, 0.04], [0.55 + dx, g + 1.5, -2.32]);
  for (let k = 0; k < 4; k++) hull.box('dark', [0.55, 0.05, 0.16], [-0.6, g + 1.2 - k * 0.08, -2.75 - k * 0.2], [-0.33, 0, 0]);
  for (const s of [-1, 1]) {
    hull.box('light', [0.16, 0.12, 0.05], [s * 1.0, g + 1.28, -3.22]);
    hull.tube('metal', [[s * 0.85, g + 1.2, -3.25], [s * 1.0, g + 1.42, -3.35], [s * 1.15, g + 1.2, -3.25]], 0.015, 6, 4);
    hull.box('dark', [0.12, 0.16, 0.2], [s * 0.7, g + 0.55, -3.1]);
    hull.box('dark', [0.12, 0.16, 0.2], [s * 0.7, g + 0.6, 3.3]);
    hull.box('redLight', [0.1, 0.08, 0.03], [s * 1.0, g + 1.3, 3.4]);
  }
  // Engine deck: grilles, exhausts, tow cable, tools.
  for (let k = 0; k < 6; k++) hull.box('mesh', [1.7, 0.03, 0.12], [0, g + 1.5, 1.4 + k * 0.28]);
  for (const s of [-1, 1]) hull.box('mesh', [0.5, 0.04, 1.6], [s * 0.6, g + 1.5, 2.5]);
  hull.tube('dark', [[-1.0, g + 1.5, 3.25], [-0.3, g + 1.52, 3.0], [0.3, g + 1.52, 3.2], [1.0, g + 1.5, 3.0]], 0.03, 16, 5);
  hull.tinted('#5e4a34', () => hull.rod('wood', [1.55, g + 1.53, -1.0], [1.55, g + 1.53, 0.4], 0.025, 6));
  hull.box('metal', [0.16, 0.03, 0.28], [1.55, g + 1.53, -1.15]);
  hull.box('dark', [0.3, 0.2, 0.08], [1.0, g + 1.38, 3.36]);
  bakeInto(root, hull, team);
  // Turret on its ring: angular welded armour, mantlet, cupola, sight, smoke dischargers, bustle rack.
  const turret = new THREE.Group();
  turret.position.set(0, 0.55, 0.2);
  root.add(turret);
  const t = new KitBuilder();
  t.loft(
    'paint',
    [[-0.55, -1.75], [0.55, -1.75], [1.15, -1.0], [1.2, 0.9], [1.0, 1.55], [-1.0, 1.55], [-1.2, 0.9], [-1.15, -1.0]],
    [[-0.45, -1.45], [0.45, -1.45], [1.0, -0.85], [1.05, 0.85], [0.9, 1.45], [-0.9, 1.45], [-1.05, 0.85], [-1.0, -0.85]],
    0.02,
    0.78,
  );
  t.cyl('dark', 1.05, 1.05, 0.06, [0, 0.0, 0.0], [0, 0, 0], 24);
  // Cupola with vision blocks and an open hatch, gunner's sight, loader's hatch.
  t.cyl('paint', 0.33, 0.36, 0.22, [-0.45, 0.89, 0.6], [0, 0, 0], 16);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    t.box('glass', [0.1, 0.06, 0.03], [-0.45 + Math.sin(a) * 0.34, 0.92, 0.6 + Math.cos(a) * 0.34], [0, a, 0]);
  }
  t.cyl('paint', 0.3, 0.3, 0.05, [-0.45, 1.25, 0.95], [1.3, 0, 0], 16);
  t.box('paint', [0.36, 0.3, 0.4], [0.6, 0.93, -0.75]);
  t.box('glass', [0.28, 0.16, 0.03], [0.6, 0.95, -0.96]);
  t.cyl('paint', 0.28, 0.28, 0.05, [0.5, 0.81, 0.55], [0, 0, 0], 14);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) t.cyl('dark', 0.055, 0.055, 0.3, [s * 1.08, 0.62 + (k % 2) * 0.12, -0.55 + Math.floor(k / 2) * 0.13], [0, 0, (s * Math.PI) / 2 - s * 0.35], 8);
    t.box('paint', [0.3, 0.4, 1.0], [s * 1.18, 0.4, 0.35]);
    t.rod('metal', [s * 0.8, 0.78, 1.3], [s * 0.85, 2.6, 1.4], 0.012, 4);
  }
  // Bustle rack with a rolled tarp and boxes.
  for (const s of [-1, 1]) t.rod('metal', [s * 0.95, 0.75, 1.55], [s * 0.95, 0.75, 2.05], 0.025, 5);
  t.rod('metal', [-0.95, 0.75, 2.05], [0.95, 0.75, 2.05], 0.025, 5);
  t.rod('metal', [-0.95, 0.4, 2.05], [0.95, 0.4, 2.05], 0.025, 5);
  t.cyl('canvas', 0.17, 0.17, 1.6, [0, 0.62, 1.8], [0, 0, Math.PI / 2], 12);
  t.tinted('#3c4232', () => t.box('paint', [0.45, 0.32, 0.36], [0.55, 0.36, 1.8]));
  bakeInto(turret, t, team);
  const gun = new THREE.Group();
  gun.position.set(0, 0.35, -1.6);
  turret.add(gun);
  const gb = new KitBuilder();
  gb.loft('paint', [[-0.42, -0.1], [0.42, -0.1], [0.36, 0.35], [-0.36, 0.35]], [[-0.36, -0.05], [0.36, -0.05], [0.3, 0.3], [-0.3, 0.3]], -0.3, 0.3);
  gb.cyl('dark', 0.05, 0.05, 0.45, [0.3, 0.02, -0.15], [Math.PI / 2, 0, 0], 8);
  mainGun(gb, -0.1, -4.75, 0.1, 0.55, false);
  bakeInto(gun, gb, team);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -4.75);
  gun.add(muzzle);
  const roof = mgMount(root, -0.45, 1.75, 0.6, team, true);
  const hullMg = mgMount(root, 0.6, 0.45, -3.0, team);
  return { root, wheels: hiddenWheels(root, 'tank'), mounts: [{ turret, gun, muzzle }, roof, hullMg, null] };
}

function buildSpg(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const g = TRACK_GROUND.spg;
  const hull = new KitBuilder();
  runningGear(hull, g, 1.4, 6.4, 7, false);
  // Hull: sloped nose, flat deck, the big turret over the back; a recoil spade at the rear.
  hull.profile('paint', [[-2.85, g + 0.45], [3.15, g + 0.45], [3.3, g + 1.45], [-2.0, g + 1.45], [-3.35, g + 1.0]], 2.3);
  for (const s of [-1, 1]) hull.box('paint', [0.6, 0.33, 5.8], [s * 1.4, g + 1.29, 0.15]);
  hull.cyl('paint', 0.3, 0.32, 0.07, [0.6, g + 1.49, -1.9], [0, 0, 0], 14);
  for (const s of [-1, 1]) {
    hull.box('light', [0.16, 0.12, 0.05], [s * 0.95, g + 1.25, -3.05]);
    hull.box('dark', [0.12, 0.16, 0.2], [s * 0.7, g + 0.55, -2.95]);
  }
  hull.box('dark', [2.0, 0.42, 0.14], [0, g + 0.95, 3.32], [-0.4, 0, 0]);
  for (const s of [-1, 1]) hull.rod('dark', [s * 0.8, g + 1.1, 3.2], [s * 0.9, g + 0.75, 3.4], 0.05, 6);
  bakeInto(root, hull, team);
  const turret = new THREE.Group();
  turret.position.set(0, 0.5, 0.9);
  root.add(turret);
  const t = new KitBuilder();
  // A tall box turret with sloped front and sides, crew hatches, stowage baskets, a travel lock on the hull.
  t.loft(
    'paint',
    [[-1.3, -1.5], [1.3, -1.5], [1.35, 1.75], [-1.35, 1.75]],
    [[-1.15, -1.1], [1.15, -1.1], [1.2, 1.7], [-1.2, 1.7]],
    0.0,
    1.35,
  );
  t.cyl('paint', 0.3, 0.32, 0.18, [-0.55, 1.44, 1.0], [0, 0, 0], 14);
  t.cyl('paint', 0.26, 0.26, 0.05, [0.55, 1.37, 0.9], [0, 0, 0], 14);
  for (const s of [-1, 1]) {
    t.box('dark', [0.04, 0.45, 2.2], [s * 1.42, 0.8, 0.3]);
    for (let k = 0; k < 5; k++) t.box('metal', [0.1, 0.03, 0.03], [s * 1.38, 0.6 + (k % 2) * 0.4, -0.7 + k * 0.5]);
    t.box('dark', [0.08, 0.6, 0.08], [s * 1.37, 0.6, 1.4]);
  }
  t.box('dark', [1.2, 1.0, 0.05], [0, 0.65, 1.78]);
  t.rod('metal', [0.9, 1.35, 1.4], [0.95, 3.4, 1.5], 0.012, 4);
  bakeInto(turret, t, team);
  const gun = new THREE.Group();
  gun.position.set(0, 0.75, -1.6);
  turret.add(gun);
  const gb = new KitBuilder();
  gb.loft('paint', [[-0.4, -0.15], [0.4, -0.15], [0.35, 0.3], [-0.35, 0.3]], [[-0.34, -0.1], [0.34, -0.1], [0.3, 0.25], [-0.3, 0.25]], -0.32, 0.32);
  for (const s of [-1, 1]) gb.cyl('metal', 0.07, 0.07, 1.3, [s * 0.25, 0.25, -0.55], [Math.PI / 2, 0, 0], 10);
  mainGun(gb, -0.15, -6.1, 0.12, 0.5, true);
  bakeInto(gun, gb, team);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -6.1);
  gun.add(muzzle);
  const roof = mgMount(root, -0.55, 2.0, 1.6, team, true);
  return { root, wheels: hiddenWheels(root, 'spg'), mounts: [{ turret, gun, muzzle }, roof, null, null] };
}

function buildTd(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const g = TRACK_GROUND.td;
  const hull = new KitBuilder();
  runningGear(hull, g, 1.4, 6.8, 7, true);
  // Low hull and a sloped casemate built onto it; the gun sits in a ball mantlet.
  hull.profile('paint', [[-3.1, g + 0.45], [3.3, g + 0.45], [3.45, g + 1.4], [-2.4, g + 1.4], [-3.65, g + 0.95]], 2.3);
  for (const s of [-1, 1]) hull.box('paint', [0.6, 0.3, 6.2], [s * 1.4, g + 1.26, 0.15]);
  hull.loft(
    'paint',
    [[-1.3, -2.25], [1.3, -2.25], [1.3, 2.2], [-1.3, 2.2]],
    [[-1.0, -1.0], [1.0, -1.0], [1.05, 2.15], [-1.05, 2.15]],
    g + 1.4,
    g + 2.45,
  );
  for (const s of [-1, 1]) {
    hull.box('light', [0.16, 0.12, 0.05], [s * 1.0, g + 1.2, -3.35]);
    hull.box('dark', [0.12, 0.16, 0.2], [s * 0.7, g + 0.55, -3.15]);
    hull.box('paint', [0.3, 0.35, 1.2], [s * 1.18, g + 1.85, 1.2]);
  }
  hull.cyl('paint', 0.32, 0.34, 0.16, [-0.5, g + 2.53, 0.6], [0, 0, 0], 14);
  for (let k = 0; k < 6; k++) hull.box('mesh', [1.6, 0.03, 0.12], [0, g + 1.42, 2.4 + k * 0.17]);
  hull.cyl('canvas', 0.16, 0.16, 1.5, [0, g + 2.6, 1.7], [0, 0, Math.PI / 2], 12);
  hull.rod('metal', [0.8, g + 2.45, 1.8], [0.85, g + 4.2, 1.9], 0.012, 4);
  bakeInto(root, hull, team);
  const turret = new THREE.Group();
  turret.position.set(0.3, 0.85, -2.0);
  root.add(turret);
  const t = new KitBuilder();
  t.sphere('paint', 0.46, [0, 0, 0], [1, 0.9, 0.8]);
  bakeInto(turret, t, team);
  const gun = new THREE.Group();
  turret.add(gun);
  const gb = new KitBuilder();
  gb.cyl('paint', 0.22, 0.26, 0.5, [0, 0, -0.35], [Math.PI / 2, 0, 0], 14);
  mainGun(gb, -0.5, -5.35, 0.11, 0.45, true);
  bakeInto(gun, gb, team);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -5.35);
  gun.add(muzzle);
  const roof = mgMount(root, -0.5, 1.45, 0.6, team, true);
  const hullMg = mgMount(root, -0.6, 0.35, -3.2, team);
  return { root, wheels: hiddenWheels(root, 'td'), mounts: [{ turret, gun, muzzle }, roof, hullMg, null] };
}

/**
 * A road wheel turning about x: a tyre with a rounded section and chevron
 * tread lugs, a dished rim in the side's paint, a hub with bolts on the
 * outer face (`side` -1 left / 1 right).
 */
function wheel(r: number, width: number, side: number, team: Team | null = null): THREE.Group {
  const g = new THREE.Group();
  const b = new KitBuilder();
  const hw = width / 2;
  // Far away: a plain tyre and rim.
  b.only('far', () => {
    b.cyl('rubber', r, r, width, [0, 0, 0], [0, 0, Math.PI / 2], 12);
    b.cyl('paint', r * 0.6, r * 0.6, width + 0.02, [0, 0, 0], [0, 0, Math.PI / 2], 8);
  });
  b.lod = 'near';
  b.lathe(
    'rubber',
    [[r * 0.62, -hw], [r * 0.9, -hw], [r * 0.97, -hw + width * 0.12], [r, -hw + width * 0.3], [r, hw - width * 0.3], [r * 0.97, hw - width * 0.12], [r * 0.9, hw], [r * 0.62, hw]],
    [0, 0, 0],
    24,
  );
  b.pieces[b.pieces.length - 1]!.geo.rotateZ(Math.PI / 2);
  // Tread lugs in a chevron: two staggered rows.
  const lugs = 18;
  for (let i = 0; i < lugs; i++) {
    for (const o of [-1, 1]) {
      const a = ((i + (o > 0 ? 0.5 : 0)) / lugs) * Math.PI * 2;
      b.box('rubber', [width * 0.36, 0.03, r * 0.16], [o * width * 0.2, Math.cos(a) * r, Math.sin(a) * r], [-a, o * 0.35, 0]);
    }
  }
  // Rim: a dish set in from the outer face, a ring of bolts and the hub cap.
  const face = side * hw * 0.55;
  b.cyl('paint', r * 0.62, r * 0.62, width * 0.7, [0, 0, 0], [0, 0, Math.PI / 2], 20, true);
  b.cyl('paint', r * 0.58, r * 0.58, 0.03, [face, 0, 0], [0, 0, Math.PI / 2], 20);
  b.cyl('metal', r * 0.22, r * 0.25, 0.1, [face + side * 0.05, 0, 0], [0, 0, Math.PI / 2], 10);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.cyl('metal', 0.015, 0.015, 0.04, [face + side * 0.02, Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36], [0, 0, Math.PI / 2], 5);
  }
  b.lod = undefined;
  bakeInto(g, b, team);
  return g;
}

function addWheels(root: THREE.Group, kind: VehicleKind, team: Team | null = null): THREE.Object3D[] {
  const spec = VEHICLES[kind];
  const width = kind === 'bike' ? 0.12 : kind === 'apc' || kind === 'rocket' ? 0.42 : kind === 'jeep' ? 0.26 : 0.45;
  const out: THREE.Object3D[] = [];
  spec.wheels.forEach((w, i) => {
    // The bike's paired ray wheels share one visible wheel each.
    if (kind === 'bike' && i % 2 === 1) {
      out.push(out[i - 1]!);
      return;
    }
    const g = kind === 'bike' ? spokedWheel(spec.wheelRadius, width) : wheel(spec.wheelRadius, width, Math.sign(w.pos[0]) || 1, team);
    g.position.set(kind === 'bike' ? 0 : w.pos[0], w.pos[1] - spec.suspension.rest, w.pos[2]);
    root.add(g);
    out.push(g);
  });
  return out;
}

/** A motorbike wheel: knobby tyre, a thin rim, 24 spokes to the hub, a drum brake. */
function spokedWheel(r: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const b = new KitBuilder();
  const hw = width / 2;
  b.lathe('rubber', [[r * 0.78, -hw], [r * 0.93, -hw], [r, -hw * 0.4], [r, hw * 0.4], [r * 0.93, hw], [r * 0.78, hw]], [0, 0, 0], 22);
  b.pieces[b.pieces.length - 1]!.geo.rotateZ(Math.PI / 2);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    b.box('rubber', [width * 0.8, 0.025, 0.04], [0, Math.cos(a) * r, Math.sin(a) * r], [-a, 0, 0]);
  }
  b.cyl('metal', r * 0.78, r * 0.78, width * 0.5, [0, 0, 0], [0, 0, Math.PI / 2], 22, true);
  b.cyl('metal', 0.07, 0.07, 0.14, [0, 0, 0], [0, 0, Math.PI / 2], 10);
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const o = k % 2 ? 0.05 : -0.05;
    b.rod('metal', [o, Math.cos(a + 0.2) * 0.06, Math.sin(a + 0.2) * 0.06], [0, Math.cos(a) * r * 0.77, Math.sin(a) * r * 0.77], 0.004, 3);
  }
  bakeInto(g, b, null);
  return g;
}

function buildJeep(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const b = new KitBuilder();
  // Body tub: flat sides with the cut-outs for the seats, the rear panel, floor.
  b.profile('paint', [[-0.7, -0.22], [1.55, -0.22], [1.6, 0.0], [1.6, 0.32], [0.65, 0.32], [0.55, 0.12], [0.05, 0.12], [-0.05, 0.32], [-0.7, 0.32]], 1.6);
  // Bonnet over the engine, cowl, grille with vertical slots, round headlights, bumper.
  b.loft('paint', [[-0.74, -2.05], [0.74, -2.05], [0.76, -0.68], [-0.76, -0.68]], [[-0.7, -2.02], [0.7, -2.02], [0.72, -0.68], [-0.72, -0.68]], 0.0, 0.48);
  b.box('paint', [1.52, 0.5, 0.06], [0, 0.17, -2.05]);
  for (let i = -4; i <= 4; i++) b.box('dark', [0.06, 0.32, 0.03], [i * 0.11, 0.18, -2.085]);
  for (const s of [-1, 1]) {
    b.cyl('light', 0.09, 0.09, 0.05, [s * 0.58, 0.22, -2.1], [Math.PI / 2, 0, 0], 14);
    b.cyl('paint', 0.11, 0.11, 0.06, [s * 0.58, 0.22, -2.08], [Math.PI / 2, 0, 0], 14);
    // Wings: flat tops, the front edge curving down over the wheel.
    b.profile('paint', [[-2.0, 0.25], [-0.75, 0.25], [-0.75, 0.29], [-2.0, 0.29], [-2.1, 0.16]], 0.32, [s * 0.92, 0, 0]);
    b.box('paint', [0.32, 0.04, 0.95], [s * 0.92, 0.3, 1.25]);
    // Step, mirrors, tool on the side.
    b.box('dark', [0.06, 0.03, 0.4], [s * 0.82, -0.1, -0.3]);
  }
  b.box('dark', [1.9, 0.12, 0.12], [0, -0.22, -2.12]);
  for (const s of [-1, 1]) b.box('metal', [0.06, 0.12, 0.14], [s * 0.6, -0.15, -2.2]);
  // Windscreen: frame and two panes, hinged at the cowl.
  b.box('paint', [1.52, 0.05, 0.06], [0, 0.98, -0.66]);
  b.box('paint', [1.52, 0.05, 0.06], [0, 0.5, -0.7]);
  for (const x of [-0.75, 0, 0.75]) b.box('paint', [0.05, 0.5, 0.05], [x, 0.74, -0.68], [0.12, 0, 0]);
  for (const s of [-1, 1]) b.box('glass', [0.7, 0.42, 0.02], [s * 0.37, 0.74, -0.68], [0.12, 0, 0]);
  // Seats with cushions, steering wheel, gear levers.
  for (const s of [-0.4, 0.4]) {
    b.tinted('#3b3a30', () => {
      b.box('canvas', [0.48, 0.12, 0.46], [s, 0.42, 0.1]);
      b.box('canvas', [0.48, 0.46, 0.1], [s, 0.66, 0.36], [-0.12, 0, 0]);
    });
    b.box('dark', [0.42, 0.25, 0.38], [s, 0.24, 0.1]);
  }
  b.rod('dark', [-0.4, 0.45, -0.45], [-0.4, 0.8, -0.3], 0.02, 6);
  b.tube('dark', Array.from({ length: 13 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return [-0.4 + Math.cos(a) * 0.18, 0.82 + Math.sin(a) * 0.18 * 0.42, -0.3 + Math.sin(a) * 0.18 * 0.9] as [number, number, number];
  }), 0.015, 24, 5);
  b.rod('dark', [0.05, 0.12, -0.3], [0.08, 0.55, -0.2], 0.012, 4);
  // Rear: bench, spare wheel on the back, jerrycan, roll bar.
  b.box('dark', [1.3, 0.1, 0.5], [0, 0.36, 1.2]);
  b.tinted('#4a4e3a', () => b.box('paint', [0.16, 0.34, 0.26], [0.65, 0.5, 1.45]));
  for (const s of [-1, 1]) b.rod('metal', [s * 0.75, 0.32, 0.8], [s * 0.75, 1.3, 0.75], 0.03, 8);
  b.tube('metal', [[-0.75, 1.3, 0.75], [-0.6, 1.4, 0.75], [0.6, 1.4, 0.75], [0.75, 1.3, 0.75]], 0.03, 10, 8);
  // Pintle post for the heavy machine gun.
  b.rod('metal', [0, 0.32, 1.1], [0, 1.17, 1.1], 0.05, 8);
  bakeInto(root, b, team);
  const spare = wheel(0.38, 0.26, 1, team);
  spare.rotation.y = Math.PI / 2;
  spare.position.set(0, 0.3, 1.66);
  root.add(spare);
  const turret = new THREE.Group();
  turret.position.set(0, 1.2, 1.1);
  root.add(turret);
  const gun = new THREE.Group();
  gun.position.set(0, 0.08, 0);
  turret.add(gun);
  const gb = new KitBuilder();
  // Heavy machine gun: receiver, perforated jacket, barrel, spade grips, feed tray, ammo can, sight.
  gb.box('dark', [0.16, 0.18, 0.72], [0, 0, -0.05]);
  gb.box('dark', [0.17, 0.05, 0.3], [0, 0.11, -0.15]);
  gb.cyl('dark', 0.05, 0.05, 0.36, [0, 0.02, -0.55], [Math.PI / 2, 0, 0], 10);
  for (let k = 0; k < 4; k++) gb.cyl('dark', 0.052, 0.052, 0.02, [0, 0.02, -0.42 - k * 0.07], [Math.PI / 2, 0, 0], 10);
  gb.cyl('dark', 0.025, 0.025, 0.6, [0, 0.02, -1.0], [Math.PI / 2, 0, 0], 8);
  gb.cyl('dark', 0.035, 0.03, 0.08, [0, 0.02, -1.3], [Math.PI / 2, 0, 0], 8);
  for (const s of [-1, 1]) gb.rod('metal', [s * 0.06, -0.02, 0.32], [s * 0.07, -0.14, 0.4], 0.018, 6);
  gb.tinted('#3c4232', () => gb.box('paint', [0.14, 0.2, 0.3], [-0.17, -0.04, -0.05]));
  gb.box('dark', [0.03, 0.1, 0.03], [0, 0.15, -0.35]);
  gb.box('paint', [0.5, 0.28, 0.025], [0, 0.12, -0.32]);
  bakeInto(gun, gb, team);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -1.33);
  gun.add(muzzle);
  return { root, wheels: addWheels(root, 'jeep', team), mounts: [null, { turret, gun, muzzle }] };
}

/**
 * Patrol boat (26 m, front -z): a hull flaring to a raked bow, the deck with
 * planking, the wheelhouse amidships with windows and a mast, a twin cannon
 * on the foredeck, an MG on the stern, railings, liferafts, depth markings.
 * Its deck parts are colliders too (vehicleData `deck`): this is drawn over them.
 */
function buildPatrol(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const b = new KitBuilder();
  const D = 1.2;
  // Hull: a narrow keel line widening to the deck, the bow raked forward.
  b.loft('paint', [[-0.5, -11.6], [0.5, -11.6], [1.6, 12.6], [-1.6, 12.6]], [[-1.4, -13.6], [1.4, -13.6], [2.7, 13], [-2.7, 13]], -1.2, D);
  b.loft('paint', [[-1.4, -13.6], [1.4, -13.6], [2.2, -9], [-2.2, -9]], [[-0.2, -14.4], [0.2, -14.4], [2.4, -9], [-2.4, -9]], D, D + 0.5);
  // Boot topping and the deck planking.
  for (const s of [-1, 1]) b.box('dark', [0.06, 0.25, 25], [s * 2.62, -0.2, 0.2]);
  b.box('wood', [5.1, 0.06, 21.6], [0, D + 0.03, 1.8]);
  // Wheelhouse: walls with a band of windows, the roof, the mast with radar and lights.
  b.box('paint', [3.2, 1.2, 5.2], [0, D + 0.6, 1.6]);
  b.box('glass', [3.24, 0.7, 5.24], [0, D + 1.55, 1.6]);
  for (const z of [-0.9, 0.4, 1.6, 2.8, 4.1]) for (const s of [-1, 1]) b.box('paint', [0.06, 0.7, 0.12], [s * 1.62, D + 1.55, z]);
  for (const x of [-1.0, 0, 1.0]) b.box('paint', [0.12, 0.7, 0.06], [x, D + 1.55, -1.02]);
  b.box('paint', [3.4, 0.14, 5.4], [0, D + 2.35, 1.6]);
  b.rod('metal', [0, D + 2.4, 2.4], [0, D + 6.4, 2.6], 0.07, 8);
  b.box('dark', [1.6, 0.12, 0.25], [0, D + 5.6, 2.55]);
  b.cyl('light', 0.08, 0.08, 0.2, [0, D + 6.5, 2.6], [0, 0, 0], 8);
  // Railings: posts and two wires down both sides and across the stern.
  for (let z = -10.5; z <= 12.5; z += 1.5) for (const s of [-1, 1]) b.rod('metal', [s * 2.6, D, z], [s * 2.6, D + 1.0, z], 0.025, 5);
  for (const y of [0.55, 1.0]) for (const s of [-1, 1]) b.rod('metal', [s * 2.6, D + y, -10.5], [s * 2.6, D + y, 12.5], 0.015, 4);
  for (const y of [0.55, 1.0]) b.rod('metal', [-2.6, D + y, 12.85], [2.6, D + y, 12.85], 0.015, 4);
  // The cannon's mount ring and the MG's pedestal; liferafts in canisters; a towing bitt.
  b.cyl('paint', 1.0, 1.1, 0.7, [0, D + 0.35, -7.4], [0, 0, 0], 16);
  b.cyl('dark', 0.3, 0.35, 0.8, [0, D + 0.4, 9.6], [0, 0, 0], 10);
  for (const s of [-1, 1]) b.cyl('paint', 0.35, 0.35, 1.2, [s * 1.9, D + 0.4, 6.0], [Math.PI / 2, 0, 0], 10);
  b.box('metal', [0.4, 0.3, 0.3], [0, D + 0.15, 12.3]);
  // Numbers on the bow.
  for (const s of [-1, 1]) b.box('light', [0.04, 0.5, 1.4], [s * 2.0, D - 0.1, -9.5]);
  bakeInto(root, b, team);
  // The twin cannon: a shielded turret on the ring, two barrels.
  const turret = new THREE.Group();
  turret.position.set(0, D + 0.7, -7.4);
  root.add(turret);
  const gun = new THREE.Group();
  gun.position.set(0, 0.55, 0);
  turret.add(gun);
  const tb = new KitBuilder();
  tb.loft('paint', [[-0.9, -0.8], [0.9, -0.8], [0.9, 0.9], [-0.9, 0.9]], [[-0.7, -0.5], [0.7, -0.5], [0.7, 0.8], [-0.7, 0.8]], 0, 1.2);
  bakeInto(turret, tb, team);
  const gb = new KitBuilder();
  for (const s of [-1, 1]) {
    gb.cyl('dark', 0.06, 0.07, 2.4, [s * 0.22, 0, -1.6], [Math.PI / 2, 0, 0], 10);
    gb.cyl('dark', 0.09, 0.09, 0.2, [s * 0.22, 0, -2.8], [Math.PI / 2, 0, 0], 10);
  }
  gb.box('dark', [0.7, 0.4, 0.8], [0, 0, -0.2]);
  bakeInto(gun, gb, team);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -2.95);
  gun.add(muzzle);
  const aft = pintleMg(root, [0, D + 1.4, 9.6], team);
  return { root, wheels: [], mounts: [null, { turret, gun, muzzle }, aft] };
}

/** An MG on a pintle (boats): turret and gun pivots, the gun pointing -z. */
function pintleMg(root: THREE.Group, at: [number, number, number], team: Team | null): MountNodes {
  const turret = new THREE.Group();
  turret.position.set(...at);
  root.add(turret);
  const gun = new THREE.Group();
  gun.position.set(0, 0.08, 0);
  turret.add(gun);
  const gb = new KitBuilder();
  gb.box('dark', [0.16, 0.18, 0.72], [0, 0, -0.05]);
  gb.box('dark', [0.17, 0.05, 0.3], [0, 0.11, -0.15]);
  gb.cyl('dark', 0.05, 0.05, 0.36, [0, 0.02, -0.55], [Math.PI / 2, 0, 0], 10);
  gb.cyl('dark', 0.025, 0.025, 0.6, [0, 0.02, -1.0], [Math.PI / 2, 0, 0], 8);
  gb.cyl('dark', 0.035, 0.03, 0.08, [0, 0.02, -1.3], [Math.PI / 2, 0, 0], 8);
  for (const s of [-1, 1]) gb.rod('metal', [s * 0.06, -0.02, 0.32], [s * 0.07, -0.14, 0.4], 0.018, 6);
  gb.tinted('#3c4232', () => gb.box('paint', [0.14, 0.2, 0.3], [-0.17, -0.04, -0.05]));
  bakeInto(gun, gb, team);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -1.33);
  gun.add(muzzle);
  return { turret, gun, muzzle };
}

/**
 * Landing craft (11 m, front -z): a flat-bottomed box hull, high plywood
 * sides, the bow ramp (up, hinged at the deck), the well with ribs and
 * benches, the coxswain's station at the stern with two MGs either side,
 * the engine house and a towing bitt.
 */
function buildLcvp(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const b = new KitBuilder();
  const H = 0.9;
  // Hull: the bottom rising toward the bow, slab sides, the transom.
  b.loft('paint', [[-1.25, -4.6], [1.25, -4.6], [1.35, 5.3], [-1.35, 5.3]], [[-1.6, -5.4], [1.6, -5.4], [1.6, 5.4], [-1.6, 5.4]], -0.9, -0.3);
  for (const s of [-1, 1]) {
    b.box('paint', [0.12, H + 0.3, 10.6], [s * 1.54, H / 2 - 0.15, 0]);
    // Rub rail and the deck edge.
    b.box('dark', [0.08, 0.1, 10.6], [s * 1.62, -0.05, 0]);
    b.box('dark', [0.22, 0.06, 10.6], [s * 1.5, H + 0.03, 0]);
  }
  b.box('paint', [3.2, H + 0.3, 0.12], [0, H / 2 - 0.15, 5.36]);
  // The well's floor, ribs up the sides, a bench either side.
  b.box('dark', [2.9, 0.06, 9.0], [0, -0.28, -0.6]);
  for (let z = -4.2; z < 3.6; z += 1.2) for (const s of [-1, 1]) b.box('trim', [0.08, H, 0.1], [s * 1.44, H / 2 - 0.2, z]);
  for (const s of [-1, 1]) b.box('wood', [0.4, 0.08, 6.2], [s * 1.2, 0.25, -0.9]);
  // The ramp: a steel plate raised at the bow, hinged at the deck, its cables.
  b.box('paint', [2.8, 2.0, 0.14], [0, 0.55, -5.25], [-0.12, 0, 0]);
  for (let k = -2; k <= 2; k++) b.box('dark', [0.05, 1.9, 0.06], [k * 0.55, 0.55, -5.33], [-0.12, 0, 0]);
  for (const s of [-1, 1]) b.rod('metal', [s * 1.3, 1.5, -5.2], [s * 1.45, 1.6, -3.6], 0.012, 4);
  // Stern: the deck, the engine house, the coxswain's armoured tub and wheel.
  b.box('paint', [3.0, 0.1, 2.4], [0, 0.95, 4.2]);
  b.box('paint', [2.0, 0.85, 1.6], [0, 0.45, 4.2]);
  b.box('paint', [1.0, 0.95, 0.08], [0, 1.45, 3.55]);
  b.box('paint', [0.08, 0.95, 0.9], [-0.5, 1.45, 4.0]);
  b.box('paint', [0.08, 0.95, 0.9], [0.5, 1.45, 4.0]);
  b.tube('dark', Array.from({ length: 13 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return [Math.cos(a) * 0.2, 1.55 + Math.sin(a) * 0.2, 3.75] as [number, number, number];
  }), 0.015, 24, 5);
  // MG tubs either side of the coxswain.
  for (const s of [-1, 1]) {
    b.cyl('paint', 0.45, 0.45, 0.7, [s * 1.05, 1.3, 4.1], [0, 0, 0], 14, true);
    b.rod('metal', [s * 1.05, 1.0, 4.1], [s * 1.05, 1.95, 4.1], 0.04, 8);
  }
  b.box('metal', [0.3, 0.25, 0.3], [0, 1.1, 5.1]);
  bakeInto(root, b, team);
  const left = pintleMg(root, [-1.05, 2.0, 4.1], team);
  const right = pintleMg(root, [1.05, 2.0, 4.1], team);
  return { root, wheels: [], mounts: [null, left, right, null, null, null, null, null, null] };
}

/**
 * Assault boat (7.4 m, front -z): a V hull rising to a sharp bow, an
 * inflatable collar along the gunwale, a deck, the driver's console with a
 * windscreen at the stern, an outboard, benches and an MG on the bow.
 */
function buildBoat(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const b = new KitBuilder();
  const L0 = -3.7;
  const L1 = 3.55;
  /** Half beam at the gunwale along the hull (u: 0 bow .. 1 stern). */
  const beam = (u: number) => 1.05 * Math.min(1, Math.sqrt(Math.max(0, u) / 0.42)) * (u > 0.97 ? 0.97 + (1 - u) : 1);
  /** Keel height: rises toward the bow. */
  const keel = (u: number) => -0.5 + 0.42 * Math.max(0, 1 - u / 0.38) ** 2;
  /** Sheer (gunwale height) rising a little at the bow. */
  const sheer = (u: number) => 0.22 + 0.18 * Math.max(0, 1 - u / 0.5) ** 2;
  for (const side of [-1, 1]) {
    b.grid(
      'paint',
      18,
      5,
      (u, v) => {
        const z = L0 + (L1 - L0) * u;
        const w = beam(u);
        const k = keel(u);
        // Keel to chine (a V), then a near-upright topside to the gunwale.
        const x = v < 0.5 ? w * 0.86 * (v / 0.5) : w * (0.86 + 0.14 * ((v - 0.5) / 0.5));
        const chine = Math.max(k, -0.26);
        const y = v < 0.5 ? k + (chine - k) * (v / 0.5) : chine + (sheer(u) - chine) * ((v - 0.5) / 0.5);
        return [side * x, y, z];
      },
      true,
    );
  }
  // Transom across the stern.
  b.loft('paint', [[-0.9, L1 - 0.06], [0.9, L1 - 0.06], [0.9, L1], [-0.9, L1]], [[-1.0, L1 - 0.06], [1.0, L1 - 0.06], [1.0, L1], [-1.0, L1]], -0.42, 0.22);
  // Deck and the collar (a grey rubber tube along both gunwales, meeting at the bow).
  b.box('dark', [1.7, 0.06, 5.2], [0, -0.12, 0.7]);
  const collar: [number, number, number][] = [];
  for (let i = 0; i <= 14; i++) {
    const u = 0.04 + (i / 14) * 0.95;
    collar.push([beam(u) + 0.08, sheer(u) + 0.08, L0 + (L1 - L0) * u]);
  }
  b.tinted('#3f4244', () => {
    for (const side of [-1, 1]) b.tube('rubber', collar.map(([x, y, z]) => [side * x, y, z] as [number, number, number]), 0.2, 24, 10);
    b.tube('rubber', [[-0.3, sheer(0.06) + 0.08, L0 + 0.5], [0, sheer(0.02) + 0.1, L0 + 0.25], [0.3, sheer(0.06) + 0.08, L0 + 0.5]], 0.19, 6, 10);
  });
  // Rub strakes and grab lines.
  for (const side of [-1, 1]) {
    b.tube('dark', collar.map(([x, y, z]) => [side * (x + 0.17), y + 0.08, z] as [number, number, number]), 0.015, 24, 4);
    b.box('dark', [0.05, 0.05, 6.2], [side * 1.0, -0.05, 0.4]);
  }
  // Console: a box with a windscreen, wheel and throttle.
  b.box('paint', [0.7, 0.75, 0.7], [0.45, 0.25, 1.55]);
  b.box('dark', [0.72, 0.06, 0.72], [0.45, 0.64, 1.55]);
  b.box('glass', [0.68, 0.34, 0.02], [0.45, 0.82, 1.18], [-0.35, 0, 0]);
  b.box('metal', [0.7, 0.03, 0.03], [0.45, 0.99, 1.13]);
  b.tube('dark', Array.from({ length: 13 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return [0.45 + Math.cos(a) * 0.16, 0.86 + Math.sin(a) * 0.16 * 0.6, 1.33 + Math.sin(a) * 0.16 * 0.75] as [number, number, number];
  }), 0.014, 24, 5);
  b.rod('dark', [0.75, 0.64, 1.45], [0.8, 0.78, 1.38], 0.02, 6);
  // Benches with cushions, a jerrycan and ammo boxes on the deck.
  for (const z of [0.35, -0.6]) {
    b.box('dark', [1.5, 0.3, 0.42], [0, 0.05, z]);
    b.tinted('#34372f', () => b.box('canvas', [1.4, 0.08, 0.38], [0, 0.24, z]));
  }
  b.tinted('#4a4e3a', () => b.box('paint', [0.18, 0.34, 0.28], [-0.65, 0.07, 2.6]));
  for (const x of [-0.45, -0.1]) b.tinted('#545a40', () => b.box('paint', [0.3, 0.2, 0.18], [x, -0.0, -1.6]));
  // Outboard on the transom: cowl, leg, cavitation plate, propeller.
  b.box('dark', [0.5, 0.5, 0.55], [0, 0.42, L1 + 0.3]);
  b.box('dark', [0.46, 0.08, 0.5], [0, 0.17, L1 + 0.3]);
  b.box('dark', [0.14, 0.75, 0.25], [0, -0.25, L1 + 0.34]);
  b.box('dark', [0.36, 0.03, 0.42], [0, -0.42, L1 + 0.36]);
  b.cyl('metal', 0.04, 0.04, 0.22, [0, -0.56, L1 + 0.24], [Math.PI / 2, 0, 0], 8);
  for (let k = 0; k < 3; k++) b.box('metal', [0.04, 0.24, 0.05], [0, -0.56, L1 + 0.16], [0, 0, (k * Math.PI * 2) / 3]);
  // Bow: a cleat, the navigation light, the MG's pintle.
  b.box('metal', [0.16, 0.04, 0.05], [0, sheer(0.05) + 0.24, L0 + 0.45]);
  b.rod('metal', [0, -0.1, -2.3], [0, 0.66, -2.3], 0.05, 8);
  bakeInto(root, b, team);
  const turret = new THREE.Group();
  turret.position.set(0, 0.7, -2.3);
  root.add(turret);
  const gun = new THREE.Group();
  gun.position.set(0, 0.08, 0);
  turret.add(gun);
  const gb = new KitBuilder();
  gb.box('dark', [0.16, 0.18, 0.72], [0, 0, -0.05]);
  gb.box('dark', [0.17, 0.05, 0.3], [0, 0.11, -0.15]);
  gb.cyl('dark', 0.05, 0.05, 0.36, [0, 0.02, -0.55], [Math.PI / 2, 0, 0], 10);
  gb.cyl('dark', 0.025, 0.025, 0.6, [0, 0.02, -1.0], [Math.PI / 2, 0, 0], 8);
  gb.cyl('dark', 0.035, 0.03, 0.08, [0, 0.02, -1.3], [Math.PI / 2, 0, 0], 8);
  for (const s of [-1, 1]) gb.rod('metal', [s * 0.06, -0.02, 0.32], [s * 0.07, -0.14, 0.4], 0.018, 6);
  gb.tinted('#3c4232', () => gb.box('paint', [0.14, 0.2, 0.3], [-0.17, -0.04, -0.05]));
  gb.box('paint', [0.5, 0.28, 0.025], [0, 0.12, -0.32]);
  bakeInto(gun, gb, team);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -1.33);
  gun.add(muzzle);
  return { root, wheels: [], mounts: [null, { turret, gun, muzzle }, null, null] };
}

function buildApc(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const b = new KitBuilder();
  // Hull: a V-shaped belly, sloped upper sides, a raked glacis and a flat roof.
  b.loft('paint', [[-0.7, -2.5], [0.7, -2.5], [0.7, 2.9], [-0.7, 2.9]], [[-1.28, -2.7], [1.28, -2.7], [1.28, 3.0], [-1.28, 3.0]], -0.65, -0.05);
  b.loft('paint', [[-1.28, -2.7], [1.28, -2.7], [1.28, 3.0], [-1.28, 3.0]], [[-1.1, -1.6], [1.1, -1.6], [1.1, 2.95], [-1.1, 2.95]], -0.05, 1.05);
  b.loft('paint', [[-1.28, -3.25], [1.28, -3.25], [1.28, -2.7], [-1.28, -2.7]], [[-1.1, -1.9], [1.1, -1.9], [1.1, -1.6], [-1.1, -1.6]], -0.05, 1.05);
  b.loft('paint', [[-0.7, -2.95], [0.7, -2.95], [0.7, -2.5], [-0.7, -2.5]], [[-1.28, -3.25], [1.28, -3.25], [1.28, -2.7], [-1.28, -2.7]], -0.65, -0.05);
  // Trim vane on the nose, lights in guards, tow hooks.
  b.box('paint', [2.0, 0.6, 0.05], [0, 0.2, -3.0], [-0.95, 0, 0]);
  for (const s of [-1, 1]) {
    b.box('light', [0.16, 0.1, 0.05], [s * 0.9, 0.45, -2.85]);
    b.tube('metal', [[s * 0.75, 0.4, -2.85], [s * 0.9, 0.58, -2.95], [s * 1.05, 0.4, -2.85]], 0.015, 6, 4);
    b.box('dark', [0.12, 0.14, 0.18], [s * 0.6, -0.35, -2.95]);
    // Side: vision blocks, a side hatch, stowage box, bolt rows.
    for (let k = 0; k < 3; k++) b.box('glass', [0.03, 0.08, 0.2], [s * 1.2, 0.7, -0.6 + k * 0.9], [0, 0, s * 0.16]);
    b.box('paint', [0.05, 0.6, 0.8], [s * 1.24, 0.35, 0.9], [0, 0, s * 0.16]);
    b.box('metal', [0.03, 0.04, 0.12], [s * 1.28, 0.35, 0.65]);
    b.box('paint', [0.25, 0.3, 1.0], [s * 1.25, -0.25, 2.2]);
    for (let k = 0; k < 10; k++) b.cyl('metal', 0.015, 0.015, 0.03, [s * 1.29, -0.02, -2.4 + k * 0.55], [0, 0, Math.PI / 2], 5);
    // Wheel arches.
    for (const z of [-2.1, 0, 2.1]) b.box('dark', [0.3, 0.06, 1.4], [s * 1.25, 0.05, z]);
  }
  // Roof: driver's hatch with periscopes, commander's hatch, exhaust grille, rear ramp.
  b.cyl('paint', 0.3, 0.32, 0.08, [-0.55, 1.09, -1.3], [0, 0, 0], 14);
  for (const dx of [-0.18, 0, 0.18]) b.box('glass', [0.12, 0.06, 0.04], [-0.55 + dx, 1.08, -1.62]);
  b.cyl('paint', 0.28, 0.28, 0.06, [0.6, 1.08, 1.6], [0, 0, 0], 14);
  for (let k = 0; k < 5; k++) b.box('mesh', [0.6, 0.03, 0.1], [0.6, 1.06, -0.9 + k * 0.16]);
  b.box('paint', [1.6, 1.1, 0.08], [0, 0.35, 3.0], [-0.06, 0, 0]);
  b.box('dark', [0.08, 0.9, 0.04], [0.85, 0.35, 3.05]);
  for (const s of [-1, 1]) b.box('redLight', [0.1, 0.08, 0.03], [s * 1.0, 0.75, 3.02]);
  b.rod('metal', [0.9, 1.05, 2.5], [0.95, 3.2, 2.6], 0.012, 4);
  bakeInto(root, b, team);
  // Turret with the 30 mm autocannon, coax, sights and smoke dischargers.
  const turret = new THREE.Group();
  turret.position.set(0, 1.1, 0.1);
  root.add(turret);
  const t = new KitBuilder();
  t.loft('paint', [[-0.4, -1.0], [0.4, -1.0], [0.78, -0.4], [0.8, 0.85], [-0.8, 0.85], [-0.78, -0.4]], [[-0.3, -0.75], [0.3, -0.75], [0.62, -0.3], [0.65, 0.75], [-0.65, 0.75], [-0.62, -0.3]], 0.0, 0.5);
  t.cyl('paint', 0.28, 0.3, 0.12, [0.35, 0.56, 0.3], [0, 0, 0], 14);
  t.box('paint', [0.24, 0.24, 0.3], [-0.45, 0.62, -0.4]);
  t.box('glass', [0.18, 0.12, 0.03], [-0.45, 0.64, -0.56]);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) t.cyl('dark', 0.05, 0.05, 0.26, [s * 0.75, 0.32 + (k % 2) * 0.1, -0.35 + k * 0.12], [0, 0, (s * Math.PI) / 2 - s * 0.35], 8);
  t.rod('metal', [-0.5, 0.5, 0.7], [-0.55, 2.4, 0.8], 0.012, 4);
  bakeInto(turret, t, team);
  const gun = new THREE.Group();
  gun.position.set(0, 0.3, -1.1);
  turret.add(gun);
  const gb = new KitBuilder();
  gb.loft('paint', [[-0.22, -0.2], [0.22, -0.2], [0.2, 0.25], [-0.2, 0.25]], [[-0.18, -0.15], [0.18, -0.15], [0.16, 0.2], [-0.16, 0.2]], -0.17, 0.17);
  gb.cyl('dark', 0.055, 0.06, 2.0, [0, 0, -1.2], [Math.PI / 2, 0, 0], 10);
  gb.cyl('dark', 0.08, 0.08, 0.5, [0, 0, -0.45], [Math.PI / 2, 0, 0], 10);
  gb.cyl('dark', 0.075, 0.07, 0.3, [0, 0, -2.32], [Math.PI / 2, 0, 0], 10);
  for (let k = 0; k < 3; k++) gb.box('dark', [0.02, 0.1, 0.06], [0.08, 0, -2.25 - k * 0.07]);
  gb.cyl('dark', 0.025, 0.025, 0.7, [0.24, 0.02, -0.55], [Math.PI / 2, 0, 0], 8);
  bakeInto(gun, gb, team);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -2.5);
  gun.add(muzzle);
  return { root, wheels: addWheels(root, 'apc', team), mounts: [null, { turret, gun, muzzle }, null, null] };
}

/** Six-wheel truck with a cab and a rocket launcher box on a turntable at the back. */
function buildRocketTruck(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const b = new KitBuilder();
  // Frame rails, fuel tanks and battery box between the axles, mudguards.
  for (const s of [-1, 1]) b.box('dark', [0.14, 0.3, 7.0], [s * 0.5, -0.35, 0]);
  for (let k = 0; k < 5; k++) b.box('dark', [1.0, 0.1, 0.1], [0, -0.35, -3.0 + k * 1.5]);
  b.tinted('#4a4e3a', () => b.cyl('paint', 0.28, 0.28, 0.9, [-0.85, -0.2, -0.6], [Math.PI / 2, 0, 0], 16));
  b.box('dark', [0.45, 0.35, 0.6], [0.85, -0.2, -0.6]);
  for (const s of [-1, 1]) {
    b.profile('paint', [[-3.2, 0.1], [-1.8, 0.1], [-1.8, 0.16], [-3.2, 0.16]], 0.5, [s * 1.15, 0, 0]);
    b.box('paint', [0.5, 0.06, 2.6], [s * 1.15, 0.2, 1.9]);
  }
  // Cab: rounded front, split windscreen, doors with windows, mirrors, bumper, grille, steps.
  b.loft('paint', [[-1.2, -3.4], [1.2, -3.4], [1.2, -1.7], [-1.2, -1.7]], [[-1.12, -3.15], [1.12, -3.15], [1.12, -1.75], [-1.12, -1.75]], -0.2, 1.15);
  b.loft('paint', [[-1.12, -3.15], [1.12, -3.15], [1.12, -1.75], [-1.12, -1.75]], [[-1.0, -2.9], [1.0, -2.9], [1.0, -1.8], [-1.0, -1.8]], 1.15, 1.3);
  for (const s of [-1, 1]) {
    b.box('glass', [0.95, 0.55, 0.03], [s * 0.52, 0.78, -3.29], [0.12, 0, 0]);
    b.box('glass', [0.03, 0.45, 0.75], [s * 1.17, 0.8, -2.45]);
    b.box('dark', [0.04, 1.1, 0.04], [s * 1.18, 0.3, -1.95]);
    b.box('metal', [0.03, 0.03, 0.15], [s * 1.2, 0.45, -2.2]);
    b.rod('dark', [s * 1.18, 1.0, -3.1], [s * 1.45, 1.0, -3.2], 0.015, 4);
    b.box('dark', [0.06, 0.3, 0.18], [s * 1.47, 0.85, -3.2]);
    b.box('light', [0.18, 0.14, 0.05], [s * 0.85, 0.02, -3.42]);
    b.box('dark', [0.5, 0.05, 0.25], [s * 1.0, -0.35, -2.4]);
  }
  b.box('paint', [0.05, 0.6, 0.05], [0, 0.78, -3.29]);
  for (let i = -4; i <= 4; i++) b.box('dark', [0.12, 0.04, 0.03], [0, 0.0 + i * 0.05, -3.42]);
  b.box('dark', [2.5, 0.2, 0.15], [0, -0.32, -3.45]);
  // Bed with low sides and the turntable.
  b.box('paint', [2.4, 0.15, 4.6], [0, 0.0, 1.3]);
  for (const s of [-1, 1]) b.box('paint', [0.06, 0.35, 4.6], [s * 1.18, 0.22, 1.3]);
  b.box('paint', [2.4, 0.35, 0.06], [0, 0.22, 3.58]);
  for (const s of [-1, 1]) b.box('redLight', [0.12, 0.08, 0.03], [s * 1.0, -0.15, 3.6]);
  bakeInto(root, b, team);
  const turret = new THREE.Group();
  turret.position.set(0, 0.4, 1.4);
  root.add(turret);
  const t = new KitBuilder();
  t.cyl('dark', 0.8, 0.85, 0.3, [0, 0, 0], [0, 0, 0], 20);
  for (const s of [-1, 1]) t.loft('paint', [[s * 0.95 - 0.08, -0.5], [s * 0.95 + 0.08, -0.5], [s * 0.95 + 0.08, 0.9], [s * 0.95 - 0.08, 0.9]], [[s * 0.95 - 0.08, 0.2], [s * 0.95 + 0.08, 0.2], [s * 0.95 + 0.08, 0.8], [s * 0.95 - 0.08, 0.8]], 0.15, 0.8);
  bakeInto(turret, t, team);
  const gun = new THREE.Group();
  gun.position.set(0, 0.4, 0.6);
  turret.add(gun);
  const gb = new KitBuilder();
  // The pod: frame, the tube ends as a grid with rims, a hydraulic ram underneath.
  gb.box('paint', [1.9, 1.0, 3.6], [0, 0.5, -1.4]);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) {
      gb.cyl('dark', 0.13, 0.13, 0.06, [-0.6 + c * 0.4, 0.2 + r * 0.3, -3.22], [Math.PI / 2, 0, 0], 12);
      gb.cyl('metal', 0.15, 0.15, 0.03, [-0.6 + c * 0.4, 0.2 + r * 0.3, -3.2], [Math.PI / 2, 0, 0], 12, true);
    }
  for (const s of [-1, 1]) gb.box('dark', [0.05, 1.05, 3.65], [s * 0.97, 0.5, -1.4]);
  gb.rod('metal', [0, -0.3, 0.2], [0, 0.0, -1.2], 0.07, 8);
  bakeInto(gun, gb, team);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.5, -3.4);
  gun.add(muzzle);
  const roof = mgMount(root, 0.5, 1.35, -2.0, team, true);
  return { root, wheels: addWheels(root, 'rocket', team), mounts: [{ turret, gun, muzzle }, roof] };
}

function buildBike(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const b = new KitBuilder();
  // Frame tubes: backbone, down tube, cradle, rear stays.
  b.tube('dark', [[0, 0.55, -0.6], [0, 0.48, -0.1], [0, 0.42, 0.35], [0, 0.2, 0.72]], 0.028, 10, 6);
  b.tube('dark', [[0, 0.5, -0.58], [0, 0.1, -0.35], [0, -0.05, -0.05], [0, 0.0, 0.35]], 0.025, 10, 6);
  for (const s of [-1, 1]) b.rod('dark', [s * 0.08, 0.42, 0.3], [s * 0.1, -0.05, 0.72], 0.016, 5);
  // Fuel tank, seat, side covers, engine block with fins, exhaust.
  b.sphere('paint', 0.2, [0, 0.58, -0.25], [0.75, 0.55, 1.3]);
  b.tinted('#2a2824', () => b.box('canvas', [0.24, 0.08, 0.5], [0, 0.55, 0.22], [0.08, 0, 0]));
  b.box('metal', [0.2, 0.22, 0.3], [0, 0.12, -0.05]);
  for (let k = 0; k < 5; k++) b.box('metal', [0.26, 0.015, 0.2], [0, 0.26 + k * 0.03, -0.12]);
  b.tube('metal', [[0.06, 0.2, -0.2], [0.14, 0.0, -0.15], [0.16, -0.02, 0.3], [0.17, 0.05, 0.8]], 0.032, 14, 6);
  // Forks, headlight, handlebar with grips, fenders.
  for (const s of [-1, 1]) b.rod('metal', [s * 0.09, 0.62, -0.62], [s * 0.09, -0.05, -0.75], 0.022, 6);
  b.lathe('dark', [[0.0, 0], [0.09, 0.02], [0.1, 0.1], [0.07, 0.14]], [0, 0.48, -0.78], 12);
  b.pieces[b.pieces.length - 1]!.geo.rotateX(-Math.PI / 2);
  b.cyl('light', 0.075, 0.075, 0.02, [0, 0.48, -0.93], [Math.PI / 2, 0, 0], 12);
  b.tube('dark', [[-0.36, 0.72, -0.5], [-0.15, 0.68, -0.6], [0.15, 0.68, -0.6], [0.36, 0.72, -0.5]], 0.014, 10, 5);
  for (const s of [-1, 1]) b.cyl('rubber', 0.02, 0.02, 0.1, [s * 0.32, 0.72, -0.52], [0, 0, Math.PI / 2], 6);
  for (const z of [-0.75, 0.72]) b.grid('paint', 1, 8, (u, v) => {
    const a = -0.9 + v * 1.9;
    const r = 0.4;
    return [-0.08 + u * 0.16, -0.05 + Math.cos(a) * r, z + Math.sin(a) * r];
  }, true);
  // Pannier bags.
  for (const s of [-1, 1]) b.tinted('#4b4a36', () => b.box('canvas', [0.12, 0.28, 0.32], [s * 0.2, 0.35, 0.6]));
  bakeInto(root, b, team);
  return { root, wheels: addWheels(root, 'bike', team), mounts: [null] };
}

/** A body of revolution along z (nose at -z): `pts` are (radius, z) from the nose back; squashed by `sy` in height. */
function fuselage(b: KitBuilder, mat: KitMaterial, pts: [number, number][], at: [number, number, number], sy = 1, seg = 20): void {
  b.lathe(mat, pts, [0, 0, 0], seg);
  const g = b.pieces[b.pieces.length - 1]!.geo;
  g.rotateX(Math.PI / 2);
  g.scale(1, sy, 1);
  g.translate(...at);
}

/** A flat-ish panel (wing, tailplane) from a planform outline seen from above, `t` thick, its top a little inset. */
function panel(b: KitBuilder, mat: KitMaterial, pts: [number, number][], y: number, t: number): void {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const top = pts.map(([x, z]) => [cx + (x - cx) * 0.97, cz + (z - cz) * 0.94] as [number, number]);
  b.loft(mat, pts, top, y - t / 2, y + t / 2);
}

/** An air-to-air missile along z at (x, y, z): body, nose cone, fins. */
function missile(b: KitBuilder, x: number, y: number, z: number): void {
  b.tinted('#c9c9c2', () => {
    b.cyl('paint', 0.07, 0.07, 2.6, [x, y, z], [Math.PI / 2, 0, 0], 8);
    b.cyl('paint', 0, 0.07, 0.35, [x, y, z - 1.47], [-Math.PI / 2, 0, 0], 8);
    for (let k = 0; k < 4; k++) b.box('paint', [0.01, 0.22, 0.25], [x, y, z + 1.1], [0, 0, (k * Math.PI) / 2]);
  });
}

function buildFighter(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const b = new KitBuilder();
  // Area-ruled fuselage, a long nose, the engine nozzle at the back.
  fuselage(b, 'paint', [[0, -7.6], [0.18, -7.1], [0.42, -6.2], [0.66, -4.9], [0.86, -3.2], [0.98, -1.2], [1.0, 1.0], [0.92, 3.6], [0.82, 5.4], [0.72, 6.3]], [0, 0, 0], 0.85, 22);
  b.rod('metal', [0, 0, -7.55], [0, 0, -8.3], 0.02, 5);
  // Intakes on the sides under the wing roots.
  for (const s of [-1, 1]) b.loft('dark', [[s * 0.75, -3.4], [s * 1.25, -3.4], [s * 1.25, -0.6], [s * 0.75, -0.6]], [[s * 0.8, -3.2], [s * 1.18, -3.2], [s * 1.18, -0.6], [s * 0.8, -0.6]], -0.55, 0.2);
  // Canopy: tinted bubble, frame bows.
  b.tinted('#3a2e18', () => b.sphere('glass', 0.55, [0, 0.52, -3.4], [1, 0.95, 3.0]));
  for (const z of [-4.6, -3.1]) b.tube('dark', [[-0.5, 0.45, z], [-0.35, 0.92, z], [0.35, 0.92, z], [0.5, 0.45, z]], 0.018, 8, 4);
  // Wings, tailplanes, twin fins canted out.
  for (const s of [-1, 1]) {
    panel(b, 'paint', [[s * 0.9, -2.6], [s * 5.2, 1.2], [s * 5.2, 2.3], [s * 0.9, 3.0]], -0.1, 0.14);
    panel(b, 'paint', [[s * 0.8, 4.4], [s * 2.8, 5.8], [s * 2.8, 6.6], [s * 0.8, 6.8]], 0.0, 0.08);
    const fin = new KitBuilder();
    fin.profile('paint', [[4.0, 0], [6.6, 0], [6.6, 0.4], [6.1, 2.6], [5.4, 2.6]], 0.08);
    for (const p of fin.pieces) {
      p.geo.rotateZ(-s * 0.3);
      p.geo.translate(s * 0.62, 0.45, 0);
      b.pieces.push(p);
    }
    // Wingtip missiles and a pylon tank.
    missile(b, s * 5.3, -0.1, 1.2);
    b.box('dark', [0.08, 0.25, 0.8], [s * 3.2, -0.3, 0.8]);
  }
  // Nozzle: petals round a dark throat.
  fuselage(b, 'metal', [[0.58, 6.2], [0.62, 6.6], [0.55, 7.05]], [0, 0, 0], 1, 16);
  b.cyl('dark', 0.5, 0.5, 0.1, [0, 0, 6.9], [Math.PI / 2, 0, 0], 16);
  bakeInto(root, b, team, 'air');
  const gun = fixedMount(root, 0.7, 0.2, -5.0);
  return { root, wheels: [], mounts: [gun] };
}

function buildCas(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const b = new KitBuilder();
  // A long straight fuselage, the cannon's barrels under the nose.
  fuselage(b, 'paint', [[0, -7.45], [0.4, -7.2], [0.7, -6.4], [0.85, -5.0], [0.9, -2.0], [0.88, 2.0], [0.7, 4.5], [0.45, 6.4], [0.3, 7.0]], [0, -0.05, 0], 1.05, 18);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    b.cyl('dark', 0.035, 0.035, 0.9, [Math.cos(a) * 0.1, -0.35 + Math.sin(a) * 0.1, -7.55], [Math.PI / 2, 0, 0], 6);
  }
  b.tinted('#3a2e18', () => b.sphere('glass', 0.6, [0, 0.72, -3.6], [1, 0.95, 2.4]));
  b.tube('dark', [[-0.55, 0.62, -3.0], [-0.4, 1.25, -3.0], [0.4, 1.25, -3.0], [0.55, 0.62, -3.0]], 0.02, 8, 4);
  for (const s of [-1, 1]) {
    // Straight wings with a little dihedral out of the centre section, drooped tips.
    panel(b, 'paint', [[s * 0.85, -2.0], [s * 8.4, -1.3], [s * 8.4, 0.3], [s * 0.85, 1.0]], -0.5, 0.22);
    b.box('paint', [0.4, 0.12, 1.5], [s * 8.55, -0.55, -0.5], [0, 0, s * 0.4]);
    // Engine pods high on the rear fuselage, on stub pylons.
    fuselage(b, 'dark', [[0.2, 1.0], [0.6, 1.3], [0.62, 2.6], [0.55, 3.8], [0.45, 4.2]], [s * 1.4, 1.2, 0], 1, 16);
    b.cyl('metal', 0.5, 0.5, 0.05, [s * 1.4, 1.2, 1.25], [Math.PI / 2, 0, 0], 16);
    b.loft('paint', [[s * 0.6, 2.0], [s * 1.0, 2.0], [s * 1.0, 3.3], [s * 0.6, 3.3]], [[s * 0.8, 2.2], [s * 1.2, 2.2], [s * 1.2, 3.2], [s * 0.8, 3.2]], 0.5, 0.75);
    // Tailplane ends carry the twin fins.
    const fin = new KitBuilder();
    fin.profile('paint', [[4.6, -0.7], [6.4, -0.7], [6.4, 1.6], [5.4, 1.8], [4.9, 1.6]], 0.1);
    for (const p of fin.pieces) {
      p.geo.translate(s * 2.65, 1.0, 0);
      b.pieces.push(p);
    }
    // Pylons with rocket pods and bombs.
    for (const [x, kind] of [[2.6, 'pod'], [4.2, 'bomb'], [5.8, 'pod']] as const) {
      b.box('dark', [0.08, 0.25, 0.9], [s * x, -0.75, -0.6]);
      if (kind === 'pod') {
        b.cyl('dark', 0.2, 0.2, 1.8, [s * x, -1.05, -0.6], [Math.PI / 2, 0, 0], 12);
        b.cyl('metal', 0.19, 0.19, 0.04, [s * x, -1.05, -1.52], [Math.PI / 2, 0, 0], 12);
      } else {
        b.tinted('#4a5040', () => {
          b.cyl('paint', 0.16, 0.16, 1.5, [s * x, -1.0, -0.6], [Math.PI / 2, 0, 0], 10);
          b.cyl('paint', 0, 0.16, 0.4, [s * x, -1.0, -1.55], [-Math.PI / 2, 0, 0], 10);
        });
      }
    }
  }
  panel(b, 'paint', [[-2.7, 4.8], [2.7, 4.8], [2.7, 6.3], [-2.7, 6.3]], 1.0, 0.1);
  bakeInto(root, b, team, 'air');
  const gun = fixedMount(root, 0, -0.35, -8.0);
  const rear = mgMount(root, 0, 1.2, -1.6, team);
  return { root, wheels: [], mounts: [gun, rear] };
}
