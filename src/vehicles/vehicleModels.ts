import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Team } from '@/world/mapTypes';
import { VEHICLES, type VehicleKind } from './vehicleData';

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
  const width = kind === 'bike' ? 0.16 : kind === 'apc' || kind === 'rocket' ? 0.42 : kind === 'jeep' ? 0.3 : 0.45;
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
  const m = buildParts(kind, team);
  // Dozens of small parts per vehicle: merge them into one mesh per material
  // within each moving piece (hull, turret, barrel, each wheel).
  const pivots = new Set<THREE.Object3D>(m.wheels);
  for (const n of m.mounts) if (n) for (const o of [n.turret, n.gun, n.muzzle]) if (o) pivots.add(o);
  mergeTree(m.root, pivots);
  return m;
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
  return buildBike(team);
}

/** Merges each node's plain mesh children by material (pivots and their children stay apart), all the way down. */
function mergeTree(node: THREE.Object3D, pivots: Set<THREE.Object3D>): void {
  const byMat = new Map<THREE.Material, THREE.Mesh[]>();
  for (const c of node.children) {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh || pivots.has(c) || c.children.length || Array.isArray(mesh.material)) continue;
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

const greyPaint = (team: Team | null) =>
  mat(`air-${team}`, () => new THREE.MeshStandardMaterial({ color: team === 'red' ? 0x8a8a7c : 0x7c8690, roughness: 0.55, metalness: 0.35 }));
const canopy = () => mat('canopy', () => new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.08, metalness: 0.6 }));

/** Swept wing panel (flat, thin), its root at x0 on the side `s`. */
function wing(root: THREE.Object3D, m: THREE.Material, s: number, span: number, rootChord: number, tipChord: number, sweep: number, x0: number, y: number, z: number): void {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(span, sweep);
  shape.lineTo(span, sweep + tipChord);
  shape.lineTo(0, rootChord);
  shape.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, m);
  mesh.scale.x = s;
  mesh.position.set(s * x0, y + 0.06, z);
  root.add(mesh);
}

function buildFighter(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const p = greyPaint(team);
  // Fuselage, nose cone, intakes, canopy, tail fins, exhaust.
  cyl(root, p, 0.85, 10, 0, 0, 0.6, 'z', 14);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.85, 3.2, 14).rotateX(-Math.PI / 2), p);
  nose.position.set(0, 0, -6.2);
  root.add(nose);
  for (const s of [-1, 1]) box(root, dark(), 0.5, 0.8, 2.2, s * 1.0, -0.15, -1.2);
  const can = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 2.6), canopy());
  can.position.set(0, 0.6, -3.0);
  root.add(can);
  for (const s of [-1, 1]) {
    wing(root, p, s, 4.6, 5.0, 1.2, 3.0, 0.7, -0.1, -1.6);
    wing(root, p, s, 1.9, 2.0, 0.8, 1.2, 0.6, 0.0, 4.0);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.0, 2.2), p);
    fin.position.set(s * 0.6, 1.3, 4.6);
    fin.rotation.set(-0.35, 0, s * 0.25);
    root.add(fin);
    cyl(root, dark(), 0.12, 2.6, s * 3.8, -0.35, 0.4, 'z', 8);
  }
  cyl(root, dark(), 0.7, 0.8, 0, 0, 6.0, 'z', 14);
  const gun = fixedMount(root, 0.7, 0.2, -5.0);
  return { root, wheels: [], mounts: [gun] };
}

function buildCas(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const p = paint(team);
  // Straight-wing ground attack plane: long fuselage, two engine pods high at the back, twin tails.
  box(root, p, 1.6, 1.7, 11, 0, 0, 0.3);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.4, 12).rotateX(-Math.PI / 2), p);
  nose.position.set(0, -0.1, -6.3);
  root.add(nose);
  const can = new THREE.Mesh(new THREE.SphereGeometry(0.65, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 2.2), canopy());
  can.position.set(0, 0.85, -3.4);
  root.add(can);
  for (const s of [-1, 1]) {
    wing(root, p, s, 8.0, 3.0, 1.8, 0.6, 0.8, -0.5, -1.5);
    cyl(root, dark(), 0.6, 3.0, s * 1.4, 1.2, 2.6, 'z', 12);
    box(root, p, 0.12, 2.2, 1.8, s * 2.6, 1.0, 5.2);
    for (let i = 0; i < 2; i++) cyl(root, dark(), 0.18, 1.8, s * (3.0 + i * 1.6), -0.85, -0.8, 'z', 8);
  }
  box(root, p, 5.6, 0.12, 1.6, 0, 1.0, 5.2);
  cyl(root, dark(), 0.12, 1.4, 0, -0.35, -7.4, 'z', 8);
  const gun = fixedMount(root, 0, -0.35, -8.0);
  const rear = mgMount(root, 0, 1.2, -1.6);
  return { root, wheels: [], mounts: [gun, rear] };
}

/** Six-wheel truck with a cab and a rocket launcher box on a turntable at the back. */
function buildRocketTruck(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const p = paint(team);
  box(root, dark(), 2.0, 0.35, 7.0, 0, -0.35, 0);
  // Cab.
  box(root, p, 2.4, 1.4, 1.8, 0, 0.45, -2.55);
  box(root, glass(), 2.0, 0.55, 0.05, 0, 0.75, -3.46, 0.15);
  for (const s of [-1, 1]) {
    box(root, lamp(), 0.18, 0.14, 0.05, s * 0.85, 0.05, -3.47);
    box(root, p, 0.5, 0.1, 1.2, s * 1.15, 0.2, -2.5);
    box(root, p, 0.5, 0.1, 2.6, s * 1.15, 0.2, 1.9);
  }
  // Bed and launcher.
  box(root, p, 2.4, 0.3, 4.6, 0, 0.0, 1.3);
  const turret = new THREE.Group();
  turret.position.set(0, 0.4, 1.4);
  root.add(turret);
  cyl(turret, dark(), 0.8, 0.3, 0, 0, 0, 'y', 16);
  const gun = new THREE.Group();
  gun.position.set(0, 0.4, 0.6);
  turret.add(gun);
  // A pod of tubes (3 x 4), pointing forward when level.
  box(gun, p, 1.9, 1.0, 3.6, 0, 0.5, -1.4);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) cyl(gun, dark(), 0.13, 0.08, -0.6 + c * 0.4, 0.2 + r * 0.3, -3.22, 'z', 8);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.5, -3.4);
  gun.add(muzzle);
  const roof = mgMount(root, 0.5, 1.35, -2.0);
  return { root, wheels: addWheels(root, 'rocket'), mounts: [{ turret, gun, muzzle }, roof] };
}

/** Tracks down both sides: a belt box over the road wheels, sprocket and idler. */
function tracks(root: THREE.Group, x: number, y: number, len: number, p: THREE.Material): void {
  for (const s of [-1, 1]) {
    box(root, rubber(), 0.55, 0.95, len, s * x, y, 0);
    box(root, p, 0.62, 0.08, len + 0.2, s * x, y + 0.52, 0);
    cyl(root, dark(), 0.42, 0.5, s * x, y + 0.08, -len / 2 + 0.2, 'x', 12);
    cyl(root, dark(), 0.38, 0.5, s * x, y + 0.08, len / 2 - 0.2, 'x', 12);
    for (let i = 0; i < 6; i++) cyl(root, metal(), 0.36, 0.56, s * x, y - 0.12, -len / 2 + 0.75 + i * ((len - 1.5) / 5), 'x', 12);
  }
}

/** A machine gun on a pivot (for roof and hull MG seats). */
function mgMount(parent: THREE.Object3D, x: number, y: number, z: number): MountNodes {
  const turret = new THREE.Group();
  turret.position.set(x, y, z);
  parent.add(turret);
  const gun = new THREE.Group();
  gun.position.set(0, 0.1, 0);
  turret.add(gun);
  box(gun, dark(), 0.12, 0.14, 0.55, 0, 0, 0);
  cyl(gun, dark(), 0.025, 0.7, 0, 0.02, -0.6, 'z', 8);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.95);
  gun.add(muzzle);
  return { turret, gun, muzzle };
}

function buildTank(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const p = paint(team);
  tracks(root, 1.45, -0.35, 6.6, p);
  // Hull: upper deck, sloped glacis, engine deck grilles, lights.
  box(root, p, 2.4, 0.7, 6.4, 0, 0.1, 0.05);
  box(root, p, 2.4, 0.9, 1.2, 0, -0.05, -3.0, 0.9);
  box(root, p, 3.2, 0.12, 5.6, 0, 0.47, 0.3);
  for (let i = 0; i < 4; i++) box(root, dark(), 1.6, 0.04, 0.12, 0, 0.55, 1.6 + i * 0.35);
  for (const s of [-1, 1]) box(root, lamp(), 0.14, 0.1, 0.06, s * 1.0, 0.35, -3.25);
  // Turret with the main gun, mantlet, cupola, smoke dischargers, stowage.
  const turret = new THREE.Group();
  turret.position.set(0, 0.55, 0.2);
  root.add(turret);
  box(turret, p, 2.2, 0.75, 2.6, 0, 0.38, 0.2);
  box(turret, p, 1.8, 0.6, 0.9, 0, 0.35, -1.25, -0.25);
  box(turret, p, 2.0, 0.5, 0.8, 0, 0.32, 1.7);
  cyl(turret, p, 0.32, 0.25, -0.45, 0.85, 0.6, 'y', 14);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) cyl(turret, dark(), 0.06, 0.28, s * 1.05, 0.55, -0.6 + i * 0.14, 'x', 8);
  box(turret, canvas(), 1.8, 0.3, 0.4, 0, 0.3, 2.15);
  const gun = new THREE.Group();
  gun.position.set(0, 0.35, -1.6);
  turret.add(gun);
  box(gun, p, 0.7, 0.5, 0.5, 0, 0, 0);
  cyl(gun, dark(), 0.1, 4.4, 0, 0, -2.4, 'z', 12);
  cyl(gun, dark(), 0.16, 0.6, 0, 0, -2.0, 'z', 12);
  cyl(gun, dark(), 0.13, 0.35, 0, 0, -4.55, 'z', 12);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -4.75);
  gun.add(muzzle);
  const roof = mgMount(root, -0.45, 1.75, 0.6);
  const hull = mgMount(root, 0.6, 0.45, -3.0);
  return { root, wheels: addWheels(root, 'tank'), mounts: [{ turret, gun, muzzle }, roof, hull, null] };
}

function buildSpg(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const p = paint(team);
  tracks(root, 1.4, -0.35, 6.4, p);
  box(root, p, 2.3, 0.65, 6.2, 0, 0.1, 0);
  box(root, p, 2.3, 0.8, 1.0, 0, -0.05, -2.95, 0.9);
  box(root, p, 3.1, 0.1, 5.4, 0, 0.45, 0.2);
  // A big boxy turret at the back with a long howitzer.
  const turret = new THREE.Group();
  turret.position.set(0, 0.5, 0.9);
  root.add(turret);
  box(turret, p, 2.6, 1.3, 3.0, 0, 0.65, 0.2);
  box(turret, p, 2.4, 0.9, 0.6, 0, 0.55, -1.45, -0.3);
  cyl(turret, dark(), 0.3, 0.12, -0.55, 1.35, 1.0, 'y', 14);
  for (let i = 0; i < 3; i++) box(turret, dark(), 0.05, 0.6, 0.05, 1.31, 0.6, -0.6 + i * 0.6);
  const gun = new THREE.Group();
  gun.position.set(0, 0.75, -1.6);
  turret.add(gun);
  box(gun, p, 0.7, 0.6, 0.6, 0, 0, 0);
  cyl(gun, dark(), 0.12, 5.6, 0, 0, -3.0, 'z', 12);
  cyl(gun, dark(), 0.2, 0.5, 0, 0, -5.85, 'z', 12);
  for (const s of [-1, 1]) cyl(gun, metal(), 0.07, 1.2, s * 0.25, 0.25, -0.5, 'z', 8);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -6.1);
  gun.add(muzzle);
  // Spade at the back.
  box(root, dark(), 2.0, 0.4, 0.15, 0, -0.1, 3.25, -0.4);
  const roof = mgMount(root, -0.55, 2.0, 1.6);
  return { root, wheels: addWheels(root, 'spg'), mounts: [{ turret, gun, muzzle }, roof, null, null] };
}

function buildTd(team: Team | null): VehicleModel {
  const root = new THREE.Group();
  const p = paint(team);
  tracks(root, 1.4, -0.35, 6.8, p);
  // Low hull and a sloped fixed casemate; the gun sits in a ball mantlet.
  box(root, p, 2.4, 0.6, 6.8, 0, 0.05, 0.05);
  box(root, p, 2.4, 0.8, 1.2, 0, 0.05, -3.2, 1.0);
  box(root, p, 2.6, 0.95, 3.6, 0, 0.8, 0.4);
  box(root, p, 2.6, 0.9, 1.1, 0, 0.75, -1.65, 0.75);
  for (const s of [-1, 1]) box(root, p, 0.1, 0.9, 3.6, s * 1.32, 0.78, 0.4, 0, 0, s * -0.2);
  box(root, canvas(), 1.6, 0.25, 0.6, 0, 1.4, 1.6);
  const turret = new THREE.Group();
  turret.position.set(0.3, 0.85, -2.0);
  root.add(turret);
  cyl(turret, p, 0.42, 0.5, 0, 0, 0, 'z', 14);
  const gun = new THREE.Group();
  turret.add(gun);
  cyl(gun, dark(), 0.11, 5.0, 0, 0, -2.6, 'z', 12);
  cyl(gun, dark(), 0.15, 0.45, 0, 0, -5.1, 'z', 12);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -5.35);
  gun.add(muzzle);
  const roof = mgMount(root, -0.5, 1.45, 0.6);
  const hull = mgMount(root, -0.6, 0.35, -3.2);
  return { root, wheels: addWheels(root, 'td'), mounts: [{ turret, gun, muzzle }, roof, hull, null] };
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
  return { root, wheels: addWheels(root, 'jeep'), mounts: [null, { turret, gun, muzzle }] };
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
  return { root, wheels: addWheels(root, 'apc'), mounts: [null, { turret, gun, muzzle }, null, null] };
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
  return { root, wheels: addWheels(root, 'bike'), mounts: [null] };
}
