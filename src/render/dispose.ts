import * as THREE from 'three';

/**
 * Frees the GPU buffers of everything under `root` once it has left the scene.
 * Geometries always; materials only when `materials` is set (models that build
 * their own, not ones taken from a shared cache).
 */
export function disposeTree(root: THREE.Object3D, materials = false): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    if (!materials || !m.material) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
  });
}
