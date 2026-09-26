import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** Loads and caches glTF models from `${baseUrl}models/<id>.glb`; hands out shared-material clones. */
export class ModelLibrary {
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly cache = new Map<string, THREE.Object3D>();
  private readonly bounds = new Map<string, THREE.Box3>();

  constructor(private readonly baseUrl: string) {}

  /** Loads every id; failures are logged and skipped so a missing asset never blocks the game. */
  async load(ids: Iterable<string>): Promise<void> {
    const pending = [...new Set(ids)].filter((id) => !this.cache.has(id));
    await Promise.all(
      pending.map(async (id) => {
        try {
          const gltf = await this.loader.loadAsync(`${this.baseUrl}models/${id}.glb`);
          const root = gltf.scene;
          root.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
          root.updateMatrixWorld(true);
          this.cache.set(id, root);
          this.bounds.set(id, new THREE.Box3().setFromObject(root));
        } catch (err) {
          console.warn(`[models] failed to load ${id}`, err);
        }
      }),
    );
  }

  has(id: string): boolean {
    return this.cache.has(id);
  }

  /** New instance sharing geometry and materials with the cached original. */
  instantiate(id: string): THREE.Object3D | null {
    return this.cache.get(id)?.clone(true) ?? null;
  }

  /** Bounds of the untransformed model. */
  localBounds(id: string): THREE.Box3 | null {
    return this.bounds.get(id)?.clone() ?? null;
  }
}
