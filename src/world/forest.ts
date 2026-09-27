import * as THREE from 'three';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { SurfaceRegistry } from '@/physics/surfaces';
import { LAYER_BACKDROP } from '@/render/layers';
import { makeRng } from '@/render/noise';
import { buildImpostors, buildNearTrees, type ConiferKit } from './conifers';
import type { Terrain } from './terrain';

/** Side of a forest chunk (m); each chunk switches between 3D trees and impostors as a whole. */
const CHUNK = 48;
/** Chunks whose nearest tree is closer than this draw full trees (with hysteresis). */
const NEAR = 95;
const HYSTERESIS = 12;
/** Trunk collider height as a fraction of the tree (bullets and bodies; the crown is open). */
const TRUNK_HEIGHT = 0.55;

interface Chunk {
  box: THREE.Box3;
  near: THREE.Group;
  far: THREE.InstancedMesh;
  isNear: boolean;
}

/**
 * Conifers inside the playable area. Trunks are static colliders (they stop
 * bullets, bodies and bots' paths); crowns are render only. Trees are grouped
 * into chunks that draw full 3D trees near the camera and baked impostors
 * beyond, so a dense forest costs about as much as the trees around you.
 */
export class Forest {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];

  constructor(
    trees: readonly (readonly [number, number, number])[],
    terrain: Terrain,
    physics: PhysicsWorld,
    impacts: SurfaceRegistry,
    kit: ConiferKit,
    gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
  ) {
    this.group.name = 'forest';
    const rng = makeRng(31);
    type Spot = { pos: THREE.Vector3; scale: number; yaw: number; variant: number; tint: number };
    const cells = new Map<string, Spot[]>();
    for (const [x, z, s] of trees) {
      const y = terrain.heightAt(x, z);
      const spot: Spot = { pos: new THREE.Vector3(x, y - 0.2, z), scale: s, yaw: rng() * Math.PI * 2, variant: Math.floor(rng() * kit.variants.length), tint: 0.8 + rng() * 0.3 };
      const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let list = cells.get(key);
      if (!list) cells.set(key, (list = []));
      list.push(spot);
      // Trunk: a slim box from just below the ground up into the crown.
      const h = 18 * s * TRUNK_HEIGHT;
      const r = 0.26 * s + 0.06;
      const c = physics.addStaticBox({ x, y: y + h / 2 - 0.5, z }, { x: r, y: h / 2 + 0.5, z: r }, undefined, Layer.WORLD);
      impacts.set(c.handle, 'wood');
    }
    for (const list of cells.values()) {
      const near = buildNearTrees(kit, list);
      near.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          // Foliage skips the AO pass like the scenery forest; trunks keep contact shading.
          if (o.material === kit.foliageMaterial) o.layers.set(LAYER_BACKDROP);
        }
      });
      const far = buildImpostors(gl, kit, scene.environment, scene.environmentIntensity, list);
      far.layers.set(LAYER_BACKDROP);
      const box = new THREE.Box3();
      for (const t of list) box.expandByPoint(t.pos);
      near.visible = false;
      this.group.add(near, far);
      this.chunks.push({ box, near, far, isNear: false });
    }
  }

  /** Swaps chunks between 3D trees and impostors by their distance to the camera. */
  update(camera: THREE.Vector3): void {
    for (const c of this.chunks) {
      const d = c.box.distanceToPoint(camera);
      const near = c.isNear ? d < NEAR + HYSTERESIS : d < NEAR - HYSTERESIS;
      if (near === c.isNear) continue;
      c.isNear = near;
      c.near.visible = near;
      c.far.visible = !near;
    }
  }

  /** Number of chunks currently drawing full trees (perf panel / tests). */
  get nearChunks(): number {
    return this.chunks.filter((c) => c.isNear).length;
  }
}
