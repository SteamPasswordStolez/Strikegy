import * as THREE from 'three';

interface Entry {
  mesh: THREE.InstancedMesh;
  /** The placement matrices (16 floats each); the mesh's buffer holds only those in view. */
  matrices: Float32Array;
  /** Bounding spheres: x, y, z, radius each. */
  spheres: Float32Array;
  /** Which instances the buffer holds now. */
  shown: Uint8Array;
  all: boolean;
}

const frustum = new THREE.Frustum();
const viewProj = new THREE.Matrix4();
const sphere = new THREE.Sphere();
const placed = new THREE.Matrix4();

/**
 * Per-instance view culling for instanced models scattered over the map. An
 * InstancedMesh is drawn whole if any of it is in view (2026-11-01, Iron Gate:
 * a dozen scanned crates, 283k of a view's 1,017k triangles, for a handful on
 * screen). Each frame only the instances in the view frustum go into its
 * buffer; the buffer is written only when that set changes.
 *
 * A frame redrawing the static shadow map keeps every instance: things out of
 * view still cast into it (`all`).
 */
export class InstanceCuller {
  private readonly entries: Entry[] = [];

  /** Every instanced mesh under `root` (not those with a colour per instance: nothing here keeps colours in step). */
  add(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || mesh.instanceColor) return;
      const geo = mesh.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const n = mesh.count;
      const matrices = new Float32Array(mesh.instanceMatrix.array.subarray(0, n * 16));
      const spheres = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        placed.fromArray(matrices, i * 16);
        sphere.copy(geo.boundingSphere!).applyMatrix4(placed);
        spheres.set([sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius], i * 4);
      }
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.entries.push({ mesh, matrices, spheres, shown: new Uint8Array(n).fill(1), all: true });
    });
  }

  update(camera: THREE.Camera, all: boolean): void {
    if (!this.entries.length) return;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const e of this.entries) this.cull(e, all);
  }

  private cull(e: Entry, all: boolean): void {
    const { shown, spheres } = e;
    let changed = false;
    if (all) {
      if (e.all) return;
      shown.fill(1);
      changed = true;
    } else {
      for (let i = 0; i < shown.length; i++) {
        const j = i * 4;
        sphere.center.set(spheres[j]!, spheres[j + 1]!, spheres[j + 2]!);
        sphere.radius = spheres[j + 3]!;
        const on = frustum.intersectsSphere(sphere) ? 1 : 0;
        if (on !== shown[i]) {
          shown[i] = on;
          changed = true;
        }
      }
    }
    e.all = all;
    if (!changed) return;
    const out = e.mesh.instanceMatrix.array as Float32Array;
    let n = 0;
    for (let i = 0; i < shown.length; i++) {
      if (!shown[i]) continue;
      out.set(e.matrices.subarray(i * 16, i * 16 + 16), n * 16);
      n++;
    }
    e.mesh.count = n;
    e.mesh.visible = n > 0;
    e.mesh.instanceMatrix.needsUpdate = true;
  }
}
