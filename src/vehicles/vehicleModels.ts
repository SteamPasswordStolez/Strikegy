import * as THREE from 'three';
import type { Team } from '@/world/mapTypes';
import { VEHICLES, type VehicleKind } from './vehicleData';

/**
 * Procedural vehicle models. Origin is the chassis centre, forward is -z.
 * Wheels come back in the spec's wheel order (spun and steered by the
 * vehicle); the gun seat's turret yaws on `turret` and the barrel pitches on
 * `gun`, with `muzzle` at the end. No shadows: the sun's shadow map is baked for static scenery.
 */
export interface VehicleModel {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  turret: THREE.Object3D | null;
  gun: THREE.Object3D | null;
  muzzle: THREE.Object3D | null;
}

const mats = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = mats.get(key);
  if (!m) mats.set(key, (m = make()));
  return m;
}

const paint = (team: Team | null) =>
  mat(`paint-${team}`, () => new THREE.MeshStandardMaterial({ color: team === 'red' ? 0x6a6448 : team === 'blue' ? 0x4f5a43 : 0x585c4a, roughness: 0.75, metalness: 0.15 }));
const dark = () => mat('dark', () => new THREE.MeshStandardMaterial({ color: 0x1f2124, roughness: 0.6, metalness: 0.5 }));
const rubber = () => mat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }));
const metal = () => mat('metal', () => new THREE.MeshStandardMaterial({ color: 0x5c6066, roughness: 0.4, metalness: 0.8 }));
const glass = () => mat('glass', () => new THREE.MeshStandardMaterial({ color: 0x2a3540, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.45 }));
const canvas = () => mat('canvas', () => new THREE.MeshStandardMaterial({ color: 0x5a5a44, roughness: 0.95, side: THREE.DoubleSide }));
const lamp = () => mat('lamp', () => new THREE.MeshStandardMaterial({ color: 0xdedcc8, emissive: 0x333022, roughness: 0.3 }));

function box(parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  parent.add(mesh);
  return mesh;
}

function cyl(parent: THREE.Object3D, m: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', seg = 12): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'x') geo.rotateZ(Math.PI / 2);
  if (axis === 'z') geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** A wheel (tyre, rim, hub) turning about x; `side` -1 left / 1 right puts the hub face outward. */
function wheel(r: number, width: number, side: number): THREE.Group {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.3, 8, 18).rotateY(Math.PI / 2), rubber());
  tyre.scale.set(width / (r * 0.6), 1, 1);
  g.add(tyre);
  cyl(g, metal(), r * 0.55, width * 0.8, 0, 0, 0, 'x', 12);
  cyl(g, dark(), r * 0.2, width * 0.9, side * 0.02, 0, 0, 'x', 8);
  // Tread blocks so the spin shows.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    box(g, rubber(), width * 0.95, r * 0.12, r * 0.22, 0, Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97, a);
  }
  return g;
}

function addWheels(root: THREE.Group, kind: VehicleKind): THREE.Object3D[] {
  const spec = VEHICLES[kind];
  const width = kind === 'bike' ? 0.16 : kind === 'apc' ? 0.42 : 0.3;
  const out: THREE.Object3D[] = [];
  spec.wheels.forEach((w, i) => {
    // The bike's paired ray wheels share one visible wheel each.
    if (kind === 'bike' && i % 2 === 1) {
      out.push(out[i - 1]!);
      return;
    }
    const g = wheel(spec.wheelRadius, width, Math.sign(w.pos[0]) || 1);
    g.position.set(kind === 'bike' ? 0 : w.pos[0], w.pos[1] - spec.suspension.rest, w.pos[2]);
    root.add(g);
    out.push(g);
  });
  return out;
}

export function buildVehicleModel(kind: VehicleKind, team: Team | null): VehicleModel {
  if (kind === 'jeep') return buildJeep(team);
  if (kind === 'apc') return buildApc(team);
  return buildBike(team);
}

function buildJeep(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const p = paint(team);
  // Body tub, bonnet, grille, wings.
  box(root, p, 1.66, 0.55, 3.0, 0, 0.05, 0.25);
  box(root, p, 1.5, 0.32, 1.25, 0, 0.32, -1.45, -0.05);
  box(root, dark(), 1.3, 0.42, 0.06, 0, 0.12, -2.08);
  for (let i = -3; i <= 3; i++) box(root, metal(), 0.05, 0.36, 0.03, i * 0.17, 0.12, -2.12);
  for (const s of [-1, 1]) {
    box(root, p, 0.3, 0.08, 1.0, s * 0.92, 0.36, -1.35);
    box(root, p, 0.3, 0.08, 0.95, s * 0.92, 0.36, 1.3);
    box(root, lamp(), 0.18, 0.18, 0.05, s * 0.5, 0.33, -2.1);
  }
  // Windscreen frame, seats, roll bar, spare wheel, jerrycan.
  box(root, dark(), 1.5, 0.05, 0.05, 0, 0.98, -0.68);
  box(root, glass(), 1.4, 0.48, 0.03, 0, 0.72, -0.68, 0.12);
  for (const s of [-1, 1]) box(root, dark(), 0.05, 0.6, 0.05, s * 0.74, 0.7, -0.68, 0.12);
  for (const s of [-0.4, 0.4]) {
    box(root, dark(), 0.5, 0.12, 0.5, s, 0.42, 0.1);
    box(root, dark(), 0.5, 0.5, 0.1, s, 0.66, 0.38, -0.12);
  }
  box(root, dark(), 0.06, 0.06, 0.06, -0.4, 0.75, -0.25);
  cyl(root, dark(), 0.18, 0.04, -0.4, 0.82, -0.32, 'y', 14).rotation.x = -0.9;
  const bar = new THREE.Group();
  for (const s of [-1, 1]) box(bar, metal(), 0.06, 1.0, 0.06, s * 0.75, 0.8, 0.75);
  box(bar, metal(), 1.56, 0.06, 0.06, 0, 1.3, 0.75);
  root.add(bar);
  box(root, dark(), 0.5, 0.06, 0.5, 0, 0.36, 1.2);
  const spare = wheel(0.38, 0.26, 1);
  spare.rotation.y = Math.PI / 2;
  spare.position.set(0, 0.3, 1.86);
  root.add(spare);
  box(root, p, 0.16, 0.34, 0.26, 0.6, 0.5, 1.4);
  // Pintle mount and heavy machine gun.
  cyl(root, metal(), 0.05, 0.85, 0, 0.75, 1.1, 'y', 8);
  const turret = new THREE.Group();
  turret.position.set(0, 1.2, 1.1);
  root.add(turret);
  const gun = new THREE.Group();
  gun.position.set(0, 0.08, 0);
  turret.add(gun);
  box(gun, dark(), 0.16, 0.18, 0.72, 0, 0, -0.05);
  cyl(gun, dark(), 0.03, 0.95, 0, 0.02, -0.85, 'z', 8);
  cyl(gun, dark(), 0.05, 0.36, 0, 0.02, -0.5, 'z', 10);
  box(gun, dark(), 0.12, 0.14, 0.2, -0.13, -0.03, 0.05);
  box(gun, metal(), 0.03, 0.14, 0.03, -0.06, -0.06, 0.38);
  box(gun, metal(), 0.03, 0.14, 0.03, 0.06, -0.06, 0.38);
  box(gun, dark(), 0.5, 0.28, 0.025, 0, 0.12, -0.32);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -1.33);
  gun.add(muzzle);
  return { root, wheels: addWheels(root, 'jeep'), turret, gun, muzzle };
}

function buildApc(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const p = paint(team);
  // Hull with a sloped glacis and bevelled sides.
  box(root, p, 2.5, 1.15, 5.6, 0, 0.15, 0.35);
  box(root, p, 2.5, 0.9, 1.3, 0, 0.0, -2.75, 0.6);
  box(root, p, 2.2, 0.4, 5.0, 0, 0.85, 0.5);
  for (const s of [-1, 1]) {
    box(root, p, 0.1, 0.5, 5.4, s * 1.28, -0.2, 0.3, 0, 0, s * 0.25);
    box(root, dark(), 0.06, 0.12, 0.5, s * 1.29, 0.45, -1.5);
    for (let i = 0; i < 3; i++) box(root, dark(), 0.04, 0.22, 0.12, s * 1.26, 0.4, 0.2 + i * 0.6);
  }
  box(root, dark(), 1.2, 1.0, 0.06, 0, 0.25, 3.06);
  box(root, metal(), 0.06, 0.06, 0.6, 0.45, 0.3, 3.08);
  for (const s of [-1, 1]) box(root, lamp(), 0.15, 0.1, 0.05, s * 0.9, 0.55, -3.1);
  // Driver's hatch, periscopes.
  cyl(root, dark(), 0.3, 0.08, -0.55, 1.1, -1.6, 'y', 14);
  box(root, glass(), 0.3, 0.08, 0.06, -0.55, 1.05, -1.95);
  // Turret with the 30 mm autocannon and coax.
  const turret = new THREE.Group();
  turret.position.set(0, 1.1, 0.1);
  root.add(turret);
  box(turret, p, 1.5, 0.5, 1.7, 0, 0.25, 0);
  box(turret, p, 1.3, 0.3, 0.6, 0, 0.2, -1.0, -0.3);
  cyl(turret, dark(), 0.3, 0.1, 0.35, 0.55, 0.3, 'y', 14);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) cyl(turret, dark(), 0.06, 0.3, s * 0.8, 0.35, -0.3 + i * 0.13, 'x', 8);
  const gun = new THREE.Group();
  gun.position.set(0, 0.3, -1.1);
  turret.add(gun);
  box(gun, p, 0.4, 0.34, 0.5, 0, 0, 0);
  cyl(gun, dark(), 0.06, 2.2, 0, 0, -1.3, 'z', 10);
  cyl(gun, dark(), 0.09, 0.4, 0, 0, -2.3, 'z', 10);
  cyl(gun, dark(), 0.03, 0.7, 0.24, 0.02, -0.55, 'z', 8);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -2.5);
  gun.add(muzzle);
  return { root, wheels: addWheels(root, 'apc'), turret, gun, muzzle };
}

function buildBike(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const p = paint(team);
  // Frame, tank, seat, forks, bars, exhaust.
  box(root, dark(), 0.1, 0.1, 1.2, 0, 0.18, 0, 0.12);
  box(root, p, 0.3, 0.24, 0.55, 0, 0.42, -0.25, 0.08);
  box(root, dark(), 0.26, 0.1, 0.6, 0, 0.42, 0.32);
  box(root, metal(), 0.22, 0.26, 0.32, 0, 0.12, 0.0);
  for (const s of [-1, 1]) box(root, metal(), 0.04, 0.7, 0.04, s * 0.09, 0.05, -0.68, -0.35);
  box(root, dark(), 0.7, 0.04, 0.04, 0, 0.62, -0.55);
  box(root, lamp(), 0.16, 0.16, 0.08, 0, 0.42, -0.85);
  cyl(root, metal(), 0.045, 0.8, 0.17, 0.0, 0.45, 'z', 8);
  box(root, p, 0.28, 0.05, 0.4, 0, 0.12, 0.72);
  box(root, canvas(), 0.36, 0.3, 0.3, 0, 0.55, 0.62);
  return { root, wheels: addWheels(root, 'bike'), turret: null, gun: null, muzzle: null };
}
