import * as THREE from 'three';
import type { ModelLibrary } from '@/render/models';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { SURFACE_FROM_MODEL, type SurfaceRegistry } from '@/physics/surfaces';
import type { MapDef } from './mapTypes';

const DEG = Math.PI / 180;

/** Instantiates map props and gives each a box collider fitted to its bounds. */
export function placeProps(
  map: MapDef,
  scene: THREE.Scene,
  physics: PhysicsWorld,
  models: ModelLibrary,
  impacts: SurfaceRegistry,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'props';
  const center = new THREE.Vector3();
  const half = new THREE.Vector3();

  for (const p of map.props ?? []) {
    const obj = models.instantiate(p.model);
    const box = models.localBounds(p.model);
    if (!obj || !box) continue;
    const scale = p.scale ?? 1;
    obj.position.set(...p.pos);
    if (p.rot) obj.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG);
    obj.scale.setScalar(scale);
    obj.updateMatrixWorld(true);
    root.add(obj);

    if (p.collide === false) continue;
    box.getCenter(center).multiplyScalar(scale).applyQuaternion(obj.quaternion).add(obj.position);
    box.getSize(half).multiplyScalar(scale / 2);
    const q = obj.quaternion;
    const collider = physics.addStaticBox(center, half, { x: q.x, y: q.y, z: q.z, w: q.w });
    impacts.set(collider.handle, SURFACE_FROM_MODEL[p.model] ?? 'wood');
  }

  scene.add(root);
  return root;
}
