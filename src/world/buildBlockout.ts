import * as THREE from 'three';
import { surfaceMaterial, worldScaleBoxUVs } from '@/render/textures';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import type { MapDef, MapObject, SurfaceMaterial } from './mapTypes';

const DEFAULT_MATERIAL: Record<MapObject['type'], SurfaceMaterial> = {
  wall: 'concrete',
  cover: 'metal',
  floor: 'concrete',
  ramp: 'concrete',
  prop: 'wood',
};

const DEG = Math.PI / 180;

/** Builds render meshes and static colliders for a blockout (box-based) map. */
export function buildBlockout(
  map: MapDef,
  scene: THREE.Scene,
  physics: PhysicsWorld,
  maxAnisotropy: number,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `map:${map.meta.id}`;

  const [sx, sz] = map.world.size;
  const groundThickness = 1;
  addBox(
    {
      type: 'floor',
      pos: [0, -groundThickness / 2, 0],
      size: [sx, groundThickness, sz],
      material: map.world.groundMaterial ?? 'ground',
    },
    root,
    physics,
    maxAnisotropy,
  );

  for (const obj of map.objects) addBox(obj, root, physics, maxAnisotropy);

  scene.add(root);
  return root;
}

function addBox(obj: MapObject, root: THREE.Group, physics: PhysicsWorld, maxAniso: number): void {
  const [w, h, d] = obj.size;
  const geo = new THREE.BoxGeometry(w, h, d);
  worldScaleBoxUVs(geo, w, h, d);

  let mat = surfaceMaterial(obj.material ?? DEFAULT_MATERIAL[obj.type], maxAniso);
  if (obj.color) {
    mat = mat.clone();
    mat.color = new THREE.Color(obj.color);
  }

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...obj.pos);
  if (obj.rot) mesh.rotation.set(obj.rot[0] * DEG, obj.rot[1] * DEG, obj.rot[2] * DEG);
  mesh.castShadow = obj.type !== 'floor';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  root.add(mesh);

  const q = mesh.quaternion;
  physics.addStaticBox(
    { x: obj.pos[0], y: obj.pos[1], z: obj.pos[2] },
    { x: w / 2, y: h / 2, z: d / 2 },
    { x: q.x, y: q.y, z: q.z, w: q.w },
  );
}
