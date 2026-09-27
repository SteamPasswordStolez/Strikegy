import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { worldScaleBoxUVs, type SurfaceLibrary } from '@/render/textures';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { SURFACE_FROM_MATERIAL, type SurfaceRegistry } from '@/physics/surfaces';
import type { MapDef, MapObject, SurfaceMaterial } from './mapTypes';
import { buildBoundaryWalls, buildTerrain, terrainTriangles, type Terrain } from './terrain';
import { buildBuilding } from './buildings';

const DEFAULT_MATERIAL: Record<MapObject['type'], SurfaceMaterial> = {
  wall: 'concrete',
  cover: 'metal',
  floor: 'concrete_floor',
  ramp: 'concrete',
  prop: 'wood',
};

const DEG = Math.PI / 180;

interface Batch {
  material: THREE.Material;
  geometries: THREE.BufferGeometry[];
  castShadow: boolean;
}

/** True if the map shapes its ground (terrain / irregular boundary) instead of a flat box. */
export function hasTerrain(map: MapDef): boolean {
  return !!(map.world.terrain || map.world.boundary);
}

/**
 * Moves everything that sits on the ground onto the terrain: spawns, zones,
 * targets, and objects / props flagged `snap` (their y becomes an offset).
 */
export function snapToTerrain(map: MapDef, terrain: Terrain): void {
  const lift = (p: [number, number, number]) => {
    p[1] += terrain.heightAt(p[0], p[2]);
  };
  for (const s of map.spawns) lift(s.pos);
  for (const z of map.zones ?? []) lift(z.pos);
  for (const t of map.targets ?? []) lift(t.pos);
  for (const o of map.objects) if (o.snap) lift(o.pos);
  for (const p of map.props ?? []) if (p.snap) lift(p.pos);
}

export interface BuiltMap {
  root: THREE.Group;
  /** Walkable terrain triangles for the navmesh (null on flat box maps). */
  navExtra: { positions: number[]; indices: number[] } | null;
}

/**
 * Builds render meshes and static colliders for a blockout (box-based) map:
 * the ground (flat box, or terrain with invisible boundary walls), map boxes
 * and generated buildings. Boxes sharing a material are merged into one mesh
 * (one draw call per material, per render pass) since the geometry never moves.
 */
export function buildBlockout(
  map: MapDef,
  scene: THREE.Scene,
  physics: PhysicsWorld,
  surfaces: SurfaceLibrary,
  impacts: SurfaceRegistry,
  terrain: Terrain | null,
): BuiltMap {
  const root = new THREE.Group();
  root.name = `map:${map.meta.id}`;
  const batches = new Map<string, Batch>();
  const groundKind = map.world.groundMaterial ?? 'ground';
  let navExtra: BuiltMap['navExtra'] = null;
  let groundHandle: number | null = null;

  if (terrain) {
    const built = buildTerrain(terrain, surfaces.get(groundKind), physics);
    impacts.set(built.collider.handle, SURFACE_FROM_MATERIAL[groundKind]);
    groundHandle = built.collider.handle;
    built.mesh.matrixAutoUpdate = false;
    root.add(built.mesh);
    if (map.world.boundary) buildBoundaryWalls(terrain.boundary, terrain, physics);
    navExtra = terrainTriangles(terrain, built.grid);
  } else {
    const [sx, sz] = map.world.size;
    const groundThickness = 1;
    // The ground never casts shadows (nothing is below it); keep it in its own batch.
    addBox(
      { type: 'floor', pos: [0, -groundThickness / 2, 0], size: [sx, groundThickness, sz], material: groundKind },
      batches,
      physics,
      surfaces,
      impacts,
      'ground',
    );
  }
  for (const obj of map.objects) {
    if (terrain && groundHandle !== null && isGroundPaint(obj, terrain)) {
      addDraped(obj, terrain, batches, surfaces);
      const kind = obj.material ?? DEFAULT_MATERIAL[obj.type];
      impacts.paint(groundHandle, obj.pos[0], obj.pos[2], (obj.rot?.[1] ?? 0) * DEG, obj.size[0], obj.size[2], SURFACE_FROM_MATERIAL[kind]);
    }
    else addBox(obj, batches, physics, surfaces, impacts);
  }
  for (const b of map.buildings ?? []) {
    const base = terrain ? terrain.heightAt(b.pos[0], b.pos[1]) : 0;
    for (const obj of buildBuilding(b, base).objects) addBox(obj, batches, physics, surfaces, impacts);
  }

  for (const b of batches.values()) {
    const merged = mergeGeometries(b.geometries);
    for (const g of b.geometries) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.material);
    mesh.castShadow = b.castShadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }

  scene.add(root);
  return { root, navExtra };
}

/** Top of a thin snapped floor within this height of the terrain = paint on the ground (roads, pavements). */
const PAINT_MAX_LIFT = 0.2;
/** Grid step of draped floors (m). */
const DRAPE_STEP = 1.5;

function isGroundPaint(obj: MapObject, terrain: Terrain): boolean {
  if (!obj.snap || obj.type !== 'floor' || obj.size[1] > 0.5 || obj.rot?.[0] || obj.rot?.[2]) return false;
  const top = obj.pos[1] + obj.size[1] / 2 - terrain.heightAt(obj.pos[0], obj.pos[2]);
  return top <= PAINT_MAX_LIFT;
}

/**
 * Roads and pavements on terrain: a sheet that follows the ground instead of
 * a flat box. Overlapping flat boxes left millimeter ledges at every seam that
 * stopped the character controller dead; with no collider here you walk on
 * the smooth terrain underneath.
 */
function addDraped(obj: MapObject, terrain: Terrain, batches: Map<string, Batch>, surfaces: SurfaceLibrary): void {
  const [w, h, d] = obj.size;
  const kind = obj.material ?? DEFAULT_MATERIAL[obj.type];
  const material = obj.color ? surfaces.tinted(kind, obj.color) : surfaces.get(kind);
  // Keep the authored layering (pavement over road over pad) as the lift above the ground.
  const lift = Math.max(0.02, obj.pos[1] + h / 2 - terrain.heightAt(obj.pos[0], obj.pos[2]));
  const geo = new THREE.PlaneGeometry(w, d, Math.max(1, Math.ceil(w / DRAPE_STEP)), Math.max(1, Math.ceil(d / DRAPE_STEP)));
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const yaw = (obj.rot?.[1] ?? 0) * DEG;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    // Same rotation as the box (about +Y), then the world position.
    const x = obj.pos[0] + lx * c + lz * sn;
    const z = obj.pos[2] - lx * sn + lz * c;
    pos.setXYZ(i, x, terrain.surfaceAt(x, z) + lift, z);
    uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
  }
  geo.computeVertexNormals();
  const key = `${material.uuid}drape`;
  let batch = batches.get(key);
  if (!batch) {
    batch = { material, geometries: [], castShadow: false };
    batches.set(key, batch);
  }
  batch.geometries.push(geo);
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const one = new THREE.Vector3(1, 1, 1);

function addBox(
  obj: MapObject,
  batches: Map<string, Batch>,
  physics: PhysicsWorld,
  surfaces: SurfaceLibrary,
  impacts: SurfaceRegistry,
  batchTag = '',
): void {
  const [w, h, d] = obj.size;
  const kind = obj.material ?? DEFAULT_MATERIAL[obj.type];
  const material = obj.color ? surfaces.tinted(kind, obj.color) : surfaces.get(kind);

  const geo = new THREE.BoxGeometry(w, h, d);
  worldScaleBoxUVs(geo, w, h, d);
  if (obj.rot) tmpEuler.set(obj.rot[0] * DEG, obj.rot[1] * DEG, obj.rot[2] * DEG);
  else tmpEuler.set(0, 0, 0);
  tmpQuat.setFromEuler(tmpEuler);
  geo.applyMatrix4(tmpMatrix.compose(new THREE.Vector3(...obj.pos), tmpQuat, one));

  const key = `${material.uuid}${batchTag}`;
  let batch = batches.get(key);
  if (!batch) {
    batch = { material, geometries: [], castShadow: batchTag !== 'ground' };
    batches.set(key, batch);
  }
  batch.geometries.push(geo);

  const collider = physics.addStaticBox(
    { x: obj.pos[0], y: obj.pos[1], z: obj.pos[2] },
    { x: w / 2, y: h / 2, z: d / 2 },
    { x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w },
  );
  impacts.set(collider.handle, SURFACE_FROM_MATERIAL[kind]);
}
