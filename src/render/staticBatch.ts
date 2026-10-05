import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Objects that don't move, drawn as one merged mesh per material: each
 * object added is a few meshes, and every mesh is a draw call per pass (the
 * zone stations alone were ~40 a frame). Add / remove by id; the merged
 * meshes are rebuilt by `flush` after a change (cheap: a few hundred small
 * meshes), so it suits things that change now and then (fortifications built
 * or knocked down), not every frame.
 *
 * Objects are merged in their current world pose; the batch's group should
 * sit at the origin of the scene.
 */
export class StaticBatch {
  readonly group = new THREE.Group();
  private readonly objects = new Map<number, THREE.Object3D>();
  private dirty = false;

  constructor(name: string) {
    this.group.name = name;
    this.group.matrixAutoUpdate = false;
  }

  add(id: number, obj: THREE.Object3D): void {
    this.objects.set(id, obj);
    this.dirty = true;
  }

  remove(id: number): void {
    if (this.objects.delete(id)) this.dirty = true;
  }

  get size(): number {
    return this.objects.size;
  }

  /** Rebuilds the merged meshes if anything changed. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const c of this.group.children) (c as THREE.Mesh).geometry.dispose();
    this.group.clear();
    const byMat = new Map<
      THREE.Material,
      { geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean }
    >();
    for (const obj of this.objects.values()) {
      obj.updateMatrixWorld(true);
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        const g = (
          mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
        ).applyMatrix4(mesh.matrixWorld);
        for (const k of Object.keys(g.attributes))
          if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        if (!g.getAttribute('uv'))
          g.setAttribute(
            'uv',
            new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2),
          );
        let e = byMat.get(mesh.material);
        if (!e) byMat.set(mesh.material, (e = { geos: [], cast: false, receive: false }));
        e.geos.push(g);
        e.cast ||= mesh.castShadow;
        e.receive ||= mesh.receiveShadow;
      });
    }
    for (const [material, e] of byMat) {
      const merged = mergeGeometries(e.geos);
      for (const g of e.geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = e.cast;
      mesh.receiveShadow = e.receive;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
  }
}
