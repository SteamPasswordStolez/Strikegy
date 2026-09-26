import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { worldScaleBoxUVs, type SurfaceLibrary } from '@/render/textures';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { SURFACE_FROM_MATERIAL, type SurfaceRegistry } from '@/physics/surfaces';
import type { MapDef, MapObject, SurfaceMaterial } from './mapTypes';

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

/**
 * Builds render meshes and static colliders for a blockout (box-based) map.
 * Boxes sharing a material are merged into one mesh (one draw call per material,
 * per render pass) since blockout geometry never moves.
 */
export function buildBlockout(
  map: MapDef,
  scene: THREE.Scene,
  physics: PhysicsWorld,
  surfaces: SurfaceLibrary,
  impacts: SurfaceRegistry,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `map:${map.meta.id}`;
  const batches = new Map<string, Batch>();

  const [sx, sz] = map.world.size;
  const groundThickness = 1;
  // The ground never casts shadows (nothing is below it); keep it in its own batch.
  addBox(
    {
      type: 'floor',
      pos: [0, -groundThickness / 2, 0],
      size: [sx, groundThickness, sz],
      material: map.world.groundMaterial ?? 'ground',
    },
    batches,
    physics,
    surfaces,
    impacts,
    'ground',
  );
  for (const obj of map.objects) addBox(obj, batches, physics, surfaces, impacts);

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
  return root;
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
