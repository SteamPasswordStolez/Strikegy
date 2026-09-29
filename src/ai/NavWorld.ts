import * as THREE from 'three';
import { exportTileCache, importTileCache, init, NavMeshQuery, type NavMesh, type Obstacle, type TileCache } from 'recast-navigation';
import { hashNavInput, loadNav, saveNav } from './navCache';
import { createDefaultTileCacheMeshProcess, generateTileCache } from 'recast-navigation/generators';
import { Layer, RAPIER, type PhysicsWorld } from '@/physics/PhysicsWorld';
import { MOVE } from '@/player/movement';

/** Voxel size used to build the navmesh (meters). */
const CS = 0.2;
const CH = 0.1;

type V3 = { x: number; y: number; z: number };

let recastReady: Promise<void> | null = null;

/**
 * Navmesh tile edge in voxels (32 x 0.2 m = 6.4 m): obstacle changes rebuild only
 * the tiles they touch. Tile-cache tiles carry no height detail, so smaller tiles
 * also keep path heights closer to the ground on hills.
 */
const TILE = 32;
/** Obstacles are not grown by the agent radius inside the tile cache: add it here. */
const OBSTACLE_PAD = MOVE.radius;

/**
 * Navigation mesh for bots, built from the static world colliders (every map
 * block and prop is a box). Wraps the Detour queries the AI needs: paths,
 * nearest walkable points and random points in an area. It is a tile cache,
 * so things built during a match (sandbags) can cut holes in it.
 */
export class NavWorld {
  private readonly query: NavMeshQuery;
  private readonly halfExtents = { x: 2, y: 4, z: 2 };
  /** Obstacle changes not yet baked into the mesh. */
  private pending = false;
  /** Bumped whenever tiles are rebuilt (paths planned before may cross new obstacles). */
  version = 0;

  private constructor(
    readonly navMesh: NavMesh,
    private readonly tileCache: TileCache,
  ) {
    this.query = new NavMeshQuery(navMesh);
  }

  /** Blocks a box on the ground (centre, half extents, yaw in radians); returns a handle, or null. */
  addBox(center: V3, half: V3, yaw: number): Obstacle | null {
    const res = this.tileCache.addBoxObstacle(center, { x: half.x + OBSTACLE_PAD, y: half.y, z: half.z + OBSTACLE_PAD }, yaw);
    if (!res.success || !res.obstacle) return null;
    this.pending = true;
    return res.obstacle;
  }

  /** Pass the obstacle itself: the wrapper can't remove by a bare ref (it reads `.ref` off any object). */
  remove(obstacle: Obstacle): void {
    this.tileCache.removeObstacle(obstacle);
    this.pending = true;
  }

  /**
   * Rebuilds tiles touched by obstacle changes. Detour rebuilds one tile per
   * update call (well under a millisecond each); up to `maxTiles` go per call,
   * the rest on the next.
   */
  update(maxTiles = 48): void {
    if (!this.pending) return;
    for (let i = 0; i < maxTiles; i++) {
      const r = this.tileCache.update(this.navMesh);
      if (!r.success || r.upToDate) {
        this.pending = false;
        break;
      }
    }
    this.version++;
  }

  /** Builds from the physics world; returns null if generation fails. */
  /** `extra` adds non-box walkable geometry (terrain triangles, counter-clockwise from above). */
  static async build(physics: PhysicsWorld, extra?: { positions: number[]; indices: number[] }): Promise<NavWorld | null> {
    recastReady ??= init();
    await recastReady;
    const { positions, indices } = collectNavInput(physics, extra);
    if (indices.length === 0) return null;
    const config = {
      cs: CS,
      ch: CH,
      walkableRadius: Math.ceil(MOVE.radius / CS),
      walkableHeight: Math.ceil(MOVE.standHeight / CH),
      walkableClimb: Math.floor(0.45 / CH),
      walkableSlopeAngle: 45,
      mergeRegionArea: 20,
      maxSimplificationError: 1.3,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
      tileSize: TILE,
      // Buildings stack up to three floors plus roofs and bridges over the river.
      expectedLayersPerTile: 6,
      maxObstacles: 256,
    };
    // Same input and settings as a previous load: reuse that navmesh (seconds saved on big maps).
    const key = hashNavInput(positions, indices, `tc1${JSON.stringify(config)}`);
    const cached = skipCache() ? null : await loadNav(key);
    if (cached) {
      try {
        const imp = importTileCache(cached, createDefaultTileCacheMeshProcess());
        return new NavWorld(imp.navMesh, imp.tileCache);
      } catch (err) {
        console.warn('[nav] cached navmesh unusable, rebuilding', err);
      }
    }
    const result = generateTileCache(positions, indices, config);
    if (!result.success) {
      console.warn('[nav] navmesh generation failed:', result.error);
      return null;
    }
    void saveNav(key, exportTileCache(result.navMesh, result.tileCache));
    return new NavWorld(result.navMesh, result.tileCache);
  }

  /**
   * Corner points of the shortest walkable path from `from` to `to` (both are
   * snapped to the mesh first). Returns false when no path exists.
   */
  path(from: V3, to: V3, out: THREE.Vector3[]): boolean {
    out.length = 0;
    const res = this.query.computePath(from, to, { halfExtents: this.halfExtents });
    if (!res.success || res.path.length === 0) return false;
    for (const p of res.path) out.push(new THREE.Vector3(p.x, p.y, p.z));
    return true;
  }

  /** Nearest point on the mesh, or null if nothing walkable is close. */
  closest(p: V3, out = new THREE.Vector3()): THREE.Vector3 | null {
    const res = this.query.findClosestPoint(p, { halfExtents: this.halfExtents });
    if (!res.success || !res.polyRef) return null;
    return out.set(res.point.x, res.point.y, res.point.z);
  }

  /**
   * Random walkable point within `radius` of `center` (connected to it).
   * Detour picks a random polygon touching the circle and then a random point
   * inside that polygon, which on large open polygons can land far outside the
   * circle, so results are checked and retried.
   */
  randomAround(center: V3, radius: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    for (let i = 0; i < 8; i++) {
      const res = this.query.findRandomPointAroundCircle(center, radius, { halfExtents: this.halfExtents });
      if (!res.success) return null;
      const p = res.randomPoint;
      if (Math.hypot(p.x - center.x, p.z - center.z) <= radius) return out.set(p.x, p.y, p.z);
    }
    return this.closest(center, out);
  }

  /**
   * Walks from `from` toward `to` along the mesh surface (sliding along its
   * edges) and writes the reached point, with the mesh height there, to `out`.
   * `ref` is the polygon `from` is on (0 = unknown, looked up). Returns the
   * polygon reached, or 0 if `from` is not near the mesh.
   */
  move(ref: number, from: V3, to: V3, out: THREE.Vector3): number {
    let start: V3 = from;
    if (!ref) {
      const c = this.query.findClosestPoint(from, { halfExtents: this.halfExtents });
      if (!c.success || !c.polyRef) return 0;
      ref = c.polyRef;
      start = c.point;
    }
    const res = this.query.moveAlongSurface(ref, start, to, { maxVisitedSize: 16 });
    if (!res.success) return 0;
    const last = res.visited[res.visited.length - 1] ?? ref;
    const p = res.resultPosition;
    out.set(p.x, p.y, p.z);
    const h = this.query.getPolyHeight(last, out);
    if (h.success) out.y = h.height;
    return last;
  }

  /**
   * True if a straight walk from `from` to `to` stays on the mesh (no wall or
   * ledge in between). Used to pick strafe directions and shortcut paths.
   */
  walkable(from: V3, to: V3): boolean {
    const start = this.query.findClosestPoint(from, { halfExtents: this.halfExtents });
    if (!start.success || !start.polyRef) return false;
    const hit = this.query.raycast(start.polyRef, start.point, to);
    return hit.success && hit.t >= 1;
  }

  dispose(): void {
    this.query.destroy();
    this.tileCache.destroy();
    this.navMesh.destroy();
  }
}

/** Everything the navmesh is built from: static boxes plus `extra` (terrain). */
export function collectNavInput(physics: PhysicsWorld, extra?: { positions: number[]; indices: number[] }): { positions: number[]; indices: number[] } {
  const { positions, indices } = collectStaticBoxes(physics);
  if (extra) {
    const base = positions.length / 3;
    for (const v of extra.positions) positions.push(v);
    for (const i of extra.indices) indices.push(base + i);
  }
  return { positions, indices };
}

/** Triangles of every static box collider (map blocks, props and boundary walls). */
function collectStaticBoxes(physics: PhysicsWorld): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  const pos = box.getAttribute('position');
  const idx = box.getIndex()!;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const t = new THREE.Vector3();
  physics.world.forEachCollider((c) => {
    const parent = c.parent();
    if (parent && !parent.isFixed()) return;
    if (!((c.collisionGroups() >>> 16) & (Layer.WORLD | Layer.BOUNDS))) return;
    if (c.shape.type !== RAPIER.ShapeType.Cuboid) return;
    const he = (c.shape as RAPIER.Cuboid).halfExtents;
    const tr = c.translation();
    const rot = c.rotation();
    m.compose(t.set(tr.x, tr.y, tr.z), q.set(rot.x, rot.y, rot.z, rot.w), s.set(he.x * 2, he.y * 2, he.z * 2));
    const base = positions.length / 3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      positions.push(v.x, v.y, v.z);
    }
    for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i));
  });
  box.dispose();
  return { positions, indices };
}

/** Dev: `?nocache` rebuilds the navmesh every load (for timing the build). */
function skipCache(): boolean {
  return import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('nocache');
}
