import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

  for (const [model, list] of byModel) {
    const template = models.template(model)!;
    const box = models.localBounds(model)!;
    const matrices = list.map((p) => {
      euler.set((p.rot?.[0] ?? 0) * DEG, (p.rot?.[1] ?? 0) * DEG, (p.rot?.[2] ?? 0) * DEG);
      quat.setFromEuler(euler);
      return new THREE.Matrix4().compose(pos.set(...p.pos), quat.clone(), scl.setScalar(p.scale ?? 1));
    });

    instanceModel(template, matrices, root, true);

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

interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Transform still to apply per instance (identity once node transforms are baked in). */
  matrix: THREE.Matrix4;
}

const partsCache = new WeakMap<THREE.Object3D, ModelPart[]>();

/**
 * A model's meshes merged into one geometry per material, with node transforms
 * baked in. A rock set of 7 nodes becomes 1 draw call instead of 7. Parts whose
 * attributes do not match stay separate.
 */
function modelParts(template: THREE.Object3D): ModelPart[] {
  const cached = partsCache.get(template);
  if (cached) return cached;
  template.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.Mesh[]>();
  template.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || Array.isArray(node.material)) return;
    let list = byMat.get(node.material);
    if (!list) byMat.set(node.material, (list = []));
    list.push(node);
  });
  const parts: ModelPart[] = [];
  for (const [material, meshes] of byMat) {
    const merged = meshes.length > 1 ? mergeGeometries(meshes.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld))) : null;
    if (merged) parts.push({ geometry: merged, material, matrix: new THREE.Matrix4() });
    else for (const m of meshes) parts.push({ geometry: m.geometry, material, matrix: m.matrixWorld.clone() });
  }
  partsCache.set(template, parts);
  return parts;
}

/** One InstancedMesh per material of `template`, with an instance per placement matrix. */
export function instanceModel(template: THREE.Object3D, matrices: THREE.Matrix4[], parent: THREE.Object3D, shadows: boolean): void {
  const tmp = new THREE.Matrix4();
  for (const part of modelParts(template)) {
    const inst = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
    matrices.forEach((m, i) => inst.setMatrixAt(i, tmp.multiplyMatrices(m, part.matrix)));
    inst.castShadow = shadows;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    parent.add(inst);
  }
}
