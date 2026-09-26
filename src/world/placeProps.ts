import * as THREE from 'three';
import type { ModelLibrary } from '@/render/models';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { SURFACE_FROM_MODEL, type SurfaceRegistry } from '@/physics/surfaces';
import type { MapDef, PropDef } from './mapTypes';

const DEG = Math.PI / 180;

/**
 * Places map props. Every mesh node of a model becomes one InstancedMesh with an
 * instance per placement, so a model costs (nodes) draw calls however many times
 * it appears. Each placement also gets a box collider fitted to the model bounds.
 */
export function placeProps(
  map: MapDef,
  scene: THREE.Scene,
  physics: PhysicsWorld,
  models: ModelLibrary,
  impacts: SurfaceRegistry,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'props';
  const byModel = new Map<string, PropDef[]>();
  for (const p of map.props ?? []) {
    if (!models.has(p.model)) continue;
    let list = byModel.get(p.model);
    if (!list) byModel.set(p.model, (list = []));
    list.push(p);
  }

  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const center = new THREE.Vector3();
  const half = new THREE.Vector3();
  const tmp = new THREE.Matrix4();

  for (const [model, list] of byModel) {
    const template = models.template(model)!;
    const box = models.localBounds(model)!;
    const matrices = list.map((p) => {
      euler.set((p.rot?.[0] ?? 0) * DEG, (p.rot?.[1] ?? 0) * DEG, (p.rot?.[2] ?? 0) * DEG);
      quat.setFromEuler(euler);
      return new THREE.Matrix4().compose(pos.set(...p.pos), quat.clone(), scl.setScalar(p.scale ?? 1));
    });

    template.updateMatrixWorld(true);
    template.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const inst = new THREE.InstancedMesh(node.geometry, node.material, list.length);
      matrices.forEach((m, i) => inst.setMatrixAt(i, tmp.multiplyMatrices(m, node.matrixWorld)));
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      root.add(inst);
    });

    list.forEach((p, i) => {
      if (p.collide === false) return;
      matrices[i]!.decompose(pos, quat, scl);
      box.getCenter(center).multiply(scl).applyQuaternion(quat).add(pos);
      box.getSize(half).multiply(scl).multiplyScalar(0.5);
      const collider = physics.addStaticBox(center, half, { x: quat.x, y: quat.y, z: quat.z, w: quat.w });
      impacts.set(collider.handle, SURFACE_FROM_MODEL[p.model] ?? 'wood');
    });
  }

  scene.add(root);
  return root;
}
