import * as THREE from 'three';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { SurfaceRegistry } from '@/physics/surfaces';
import { LAYER_BACKDROP } from '@/render/layers';
import { makeRng } from '@/render/noise';
import { buildImpostors, buildTreeBatch, type ConiferKit, type TreeBatch } from './conifers';
import type { Terrain } from './terrain';

/** Side of a forest chunk (m); each chunk switches between 3D trees and impostors as a whole. */
const CHUNK = 48;
/** Chunks whose nearest tree is closer than this draw full trees (with hysteresis). */
const NEAR = 95;
const HYSTERESIS = 12;
/** Trunk collider height as a fraction of the tree (bullets and bodies; the crown is open). */
const TRUNK_HEIGHT = 0.55;

export interface TreeSpot {
  pos: THREE.Vector3;
  scale: number;
  yaw: number;
  variant: number;
  tint: number;
}

interface Chunk {
  box: THREE.Box3;
  /** This chunk's trees in the shared impostor mesh and tree batch: first instance and count. */
  start: number;
  count: number;
  isNear: boolean;
}

/**
 * Trunk colliders of the map's own trees: a slim box from just below the
 * ground up into the crown (bullets, bodies, bots' paths; crowns are open).
 * Separate from the render side so the game server builds them too.
 */
export function treeColliders(trees: readonly (readonly [number, number, number])[], terrain: Terrain, physics: PhysicsWorld, impacts: SurfaceRegistry): void {
  for (const [x, z, s] of trees) {
    const y = terrain.heightAt(x, z);
    const h = 18 * s * TRUNK_HEIGHT;
    const r = 0.26 * s + 0.06;
    const c = physics.addStaticBox({ x, y: y + h / 2 - 0.5, z }, { x: r, y: h / 2 + 0.5, z: r }, undefined, Layer.WORLD);
    impacts.set(c.handle, 'wood');
  }
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
  /**
   * Impostors of every tree in one instanced mesh (one draw call instead of one
   * per chunk); a chunk drawing 3D trees has its impostors scaled to nothing.
   */
  private readonly far: THREE.InstancedMesh | null = null;
  private readonly farMatrices: Float32Array | null = null;
  /** 3D trees of every chunk in one batch per part; a chunk shows its own while near. */
  private readonly nearTrees: TreeBatch | null = null;

  /** The map's own trees (render only; their trunks collide through `treeColliders`); they cast shadows. */
  static ofMap(
    trees: readonly (readonly [number, number, number])[],
    terrain: Terrain,
    kit: ConiferKit,
    gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    near = NEAR,
  ): Forest {
    const rng = makeRng(31);
    const spots: TreeSpot[] = [];
    for (const [x, z, s] of trees) {
      const y = terrain.heightAt(x, z);
      spots.push({ pos: new THREE.Vector3(x, y - 0.2, z), scale: s, yaw: rng() * Math.PI * 2, variant: Math.floor(rng() * kit.variants.length), tint: 0.8 + rng() * 0.3 });
    }
    const f = new Forest(spots, kit, gl, scene, near, true);
    f.group.name = 'forest';
    return f;
  }

  /**
   * Trees in chunks that draw 3D close by and impostors further off. `shadows`:
   * the 3D trees cast shadows (the map's own; the scenery forest outside doesn't).
   */
  constructor(
    spots: readonly TreeSpot[],
    kit: ConiferKit,
    gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    /** Distance (m) within which chunks draw full 3D trees (lower on weak devices). */
    private readonly near = NEAR,
    shadows = false,
  ) {
    this.group.name = 'trees';
    type Spot = TreeSpot;
    const cells = new Map<string, Spot[]>();
    for (const spot of spots) {
      const key = `${Math.floor(spot.pos.x / CHUNK)},${Math.floor(spot.pos.z / CHUNK)}`;
      let list = cells.get(key);
      if (!list) cells.set(key, (list = []));
      list.push(spot);
    }
    const all: Spot[] = [];
    for (const list of cells.values()) {
      const start = all.length;
      all.push(...list);
      const box = new THREE.Box3();
      for (const t of list) box.expandByPoint(t.pos);
      this.chunks.push({ box, start, count: list.length, isNear: false });
    }
    if (all.length) {
      const batch = buildTreeBatch(kit, all, false);
      for (const o of [batch.foliage, batch.trunk]) {
        o.castShadow = shadows;
        o.receiveShadow = true;
      }
      // Foliage skips the AO pass like the scenery forest; trunks keep contact shading.
      batch.foliage.layers.set(LAYER_BACKDROP);
      this.group.add(batch.foliage, batch.trunk);
      this.nearTrees = batch;
      const far = buildImpostors(gl, kit, scene.environment, scene.environmentIntensity, all);
      far.layers.set(LAYER_BACKDROP);
      this.group.add(far);
      this.far = far;
      this.farMatrices = new Float32Array(far.instanceMatrix.array);
    }
  }

  /** Swaps chunks between 3D trees and impostors by their distance to the camera; true if any switched (shadow casters changed). */
  update(camera: THREE.Vector3): boolean {
    let changed = false;
    for (const c of this.chunks) {
      const d = c.box.distanceToPoint(camera);
      const near = c.isNear ? d < this.near + HYSTERESIS : d < this.near - HYSTERESIS;
      if (near === c.isNear) continue;
      c.isNear = near;
      changed = true;
      for (let i = c.start; i < c.start + c.count; i++) this.nearTrees?.setVisible(i, near);
      const far = this.far;
      if (!far) continue;
      const arr = far.instanceMatrix.array as Float32Array;
      const a = c.start * 16;
      const b = (c.start + c.count) * 16;
      if (near) arr.fill(0, a, b);
      else arr.set(this.farMatrices!.subarray(a, b), a);
      far.instanceMatrix.addUpdateRange(a, b - a);
      far.instanceMatrix.needsUpdate = true;
    }
    return changed;
  }

  /** Number of chunks currently drawing full trees (perf panel / tests). */
  get nearChunks(): number {
    return this.chunks.filter((c) => c.isNear).length;
  }
}
