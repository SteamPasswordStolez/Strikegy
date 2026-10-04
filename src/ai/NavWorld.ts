import * as THREE from 'three';
import { exportNavMesh, exportTileCache, importNavMesh, importTileCache, init, NavMeshQuery, type NavMesh, type Obstacle, type TileCache } from 'recast-navigation';
import { bakedNav, hashNavInput, loadNav, saveNav } from './navCache';
import { createDefaultTileCacheMeshProcess, generateTileCache, generateTiledNavMesh } from 'recast-navigation/generators';
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
 * Upright boxes at least this tall (m) with a top smaller than this (m²) get no
 * walkable top in the navmesh (see `collectStaticBoxes`). Floors and ramps are
 * thin slabs, roofs and platforms are bigger.
 */
const ISLAND_MIN_HEIGHT = 0.6;
const ISLAND_MAX_AREA = 30;
/** Index range of the +Y face in a `BoxGeometry` (faces go +x, -x, +y, -y, +z, -z). */
const TOP_FACE = [12, 18] as const;

/** Detour's "no more links" value. */
const NULL_LINK = 0xffffffff;

/** Longest path a route search may return (polygons). */
const PATH_POLYS = 1024;
/** Search box (half extents, m) for putting a bot back on the mesh right where it stands. */
const SNAP_NEAR = { x: 0.6, y: 1.2, z: 0.6 };

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
  /** Polygons cut off from the main walkable area (see `markIslands`). */
  private readonly islands = new Set<number>();

  private constructor(
    readonly navMesh: NavMesh,
    private readonly tileCache: TileCache,
  ) {
    this.query = new NavMeshQuery(navMesh);
    this.markIslands();
  }

  /**
   * Flags off every polygon not linked to the biggest connected area: roofs,
   * the top of a wall, a yard closed in by buildings, ground outside the map.
   * The default query filter then skips them, so no spawn, cover spot, zone
   * goal or path snaps onto a patch no one can walk to (bots sent there all
   * stopped at the same nearest point and piled up). ~15 ms on Iron Gate;
   * redone after obstacle changes, whose rebuilt tiles come back unflagged.
   */
  private markIslands(): void {
    const nm = this.navMesh;
    const refs: number[] = [];
    for (let i = 0, n = nm.getMaxTiles(); i < n; i++) {
      const tile = nm.getTile(i);
      const count = tile.header()?.polyCount() ?? 0;
      if (count === 0) continue;
      const base = nm.getPolyRefBase(tile);
      for (let p = 0; p < count; p++) refs.push(base + p);
    }
    // Connected components over the polygon links (whatever their flags).
    const comp = new Map<number, number>();
    const sizes: number[] = [];
    const stack: number[] = [];
    for (const start of refs) {
      if (comp.has(start)) continue;
      const id = sizes.length;
      let size = 0;
      comp.set(start, id);
      stack.push(start);
      while (stack.length) {
        const ref = stack.pop()!;
        size++;
        this.forLinks(ref, (next) => {
          if (comp.has(next)) return;
          comp.set(next, id);
          stack.push(next);
        });
      }
      sizes.push(size);
    }
    let main = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i]! > sizes[main]!) main = i;
    const was = [...this.islands];
    this.islands.clear();
    for (const ref of refs) {
      if (comp.get(ref) === main) continue;
      this.islands.add(ref);
      nm.setPolyFlags(ref, 0);
    }
    // Joined up again (an obstacle removed): walkable once more.
    for (const ref of was) if (!this.islands.has(ref) && nm.isValidPolyRef(ref) && comp.get(ref) === main) nm.setPolyFlags(ref, 1);
  }

  /**
   * `markIslands` for just the rebuilt tiles (a full pass is ~30 ms on
   * Ardennes, a hitch whenever something is built): a group of their polygons
   * linked to a walkable polygon outside them is walkable, otherwise an island.
   * (A new wall that closes off a bigger area is not caught; bots re-plan there.)
   */
  private markRebuiltIslands(): void {
    const nm = this.navMesh;
    const refs: number[] = [];
    const rebuilt = new Set<number>();
    for (const key of this.dirty) {
      const at = nm.getTilesAt(Math.floor(key / 65536), key % 65536, 16);
      for (let i = 0, n = at.tileCount(); i < n; i++) {
        const tile = at.tiles(i);
        const count = tile.header()?.polyCount() ?? 0;
        const base = nm.getPolyRefBase(tile);
        for (let p = 0; p < count; p++) {
          refs.push(base + p);
          rebuilt.add(base + p);
        }
      }
    }
    // Polygons of rebuilt tiles got new refs; drop the old ones.
    for (const ref of this.islands) if (!nm.isValidPolyRef(ref)) this.islands.delete(ref);
    const seen = new Set<number>();
    const group: number[] = [];
    for (const start of refs) {
      if (seen.has(start)) continue;
      let walkable = false;
      group.length = 0;
      seen.add(start);
      group.push(start);
      for (let i = 0; i < group.length; i++) {
        this.forLinks(group[i]!, (next) => {
          if (!rebuilt.has(next)) {
            if (!this.islands.has(next)) walkable = true;
          } else if (!seen.has(next)) {
            seen.add(next);
            group.push(next);
          }
        });
      }
      for (const ref of group) {
        if (walkable) {
          if (this.islands.delete(ref)) nm.setPolyFlags(ref, 1);
        } else if (!this.islands.has(ref)) {
          this.islands.add(ref);
          nm.setPolyFlags(ref, 0);
        }
      }
    }
  }

  /** Calls `fn` with each polygon linked to `ref`. */
  private forLinks(ref: number, fn: (next: number) => void): void {
    const { success, tile, poly } = this.navMesh.getTileAndPolyByRef(ref);
    if (!success) return;
    // The binding hands DT_NULL_LINK back as -1.
    for (let l = poly.firstLink(), guard = 0; l >= 0 && l !== NULL_LINK && guard < 64; guard++) {
      const link = tile.links(l);
      const next = link.ref();
      if (next) fn(next);
      l = link.next();
    }
  }

  /** Polygons flagged off as islands (tests / debugging). */
  get islandCount(): number {
    return this.islands.size;
  }

  /** Blocks a box on the ground (centre, half extents, yaw in radians); returns a handle, or null. */
  addBox(center: V3, half: V3, yaw: number): Obstacle | null {
    const res = this.tileCache.addBoxObstacle(center, { x: half.x + OBSTACLE_PAD, y: half.y, z: half.z + OBSTACLE_PAD }, yaw);
    if (!res.success || !res.obstacle) return null;
    this.pending = true;
    this.touch(center, Math.hypot(half.x, half.z) + OBSTACLE_PAD);
    return res.obstacle;
  }

  /** Pass the obstacle itself: the wrapper can't remove by a bare ref (it reads `.ref` off any object). */
  remove(obstacle: Obstacle): void {
    this.tileCache.removeObstacle(obstacle);
    this.pending = true;
    const reach = obstacle.type === 'box' ? Math.hypot(obstacle.halfExtents.x, obstacle.halfExtents.z) : obstacle.radius;
    this.touch(obstacle.position, reach);
  }

  /** Tiles (grid x, y) an obstacle change will rebuild: their islands are checked again afterwards. */
  private readonly dirty = new Set<number>();

  private touch(center: V3, reach: number): void {
    // Detour rebuilds every tile whose border (walkable radius + 3 cells) the obstacle touches.
    const radius = reach + (Math.ceil(MOVE.radius / CS) + 3) * CS + 0.2;
    // Read each result right away: the binding reuses the result object.
    const a = this.navMesh.calcTileLoc({ x: center.x - radius, y: center.y, z: center.z - radius });
    const x0 = a.tileX();
    const y0 = a.tileY();
    const b = this.navMesh.calcTileLoc({ x: center.x + radius, y: center.y, z: center.z + radius });
    const x1 = b.tileX();
    const y1 = b.tileY();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) this.dirty.add(x * 65536 + y);
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
    if (this.pending) return;
    if (this.dirty.size) this.markRebuiltIslands();
    this.dirty.clear();
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
    const cached = skipCache() ? null : ((await loadNav(key)) ?? (await bakedNav(key)));
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
    // Detour's default 256 polygons cut long routes short now that buildings have
    // rooms on every floor (each room and corridor is several polygons).
    const res = this.query.computePath(from, to, { halfExtents: this.halfExtents, maxPathPolys: PATH_POLYS });
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

  /** Nearest point on the mesh to `p` searching wide (a point high above or off the map); null if none. */
  closestFar(p: V3, out = new THREE.Vector3()): THREE.Vector3 | null {
    const res = this.query.findClosestPoint(p, { halfExtents: { x: 400, y: 1000, z: 400 } });
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
   * `ref` is the polygon `from` is on (0 = unknown, looked up; a polygon of a
   * rebuilt tile is looked up again). Returns the polygon reached, or 0 if
   * `from` is not near the mesh (then `out` is `from`: never step off the mesh,
   * or a bot walks through walls and onto islands it can't leave).
   */
  move(ref: number, from: V3, to: V3, out: THREE.Vector3): number {
    let start: V3 = from;
    if (!ref || this.islands.has(ref) || !this.navMesh.isValidPolyRef(ref)) {
      // Look close around the feet first so a crate top or the floor above isn't picked.
      let c = this.query.findClosestPoint(from, { halfExtents: SNAP_NEAR });
      if (!c.success || !c.polyRef) c = this.query.findClosestPoint(from, { halfExtents: this.halfExtents });
      if (!c.success || !c.polyRef) {
        out.set(from.x, from.y, from.z);
        return 0;
      }
      ref = c.polyRef;
      start = c.point;
    }
    const res = this.query.moveAlongSurface(ref, start, to, { maxVisitedSize: 16 });
    if (!res.success) {
      out.set(from.x, from.y, from.z);
      return 0;
    }
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

/**
 * Where vehicles can drive (owner, 2026-10-02: bots kept wedging tanks and
 * APCs into walls): a second, coarse navmesh for an agent as wide as a tank,
 * so paths keep to roads, fields and gaps a hull fits through, never alleys,
 * doorways or fence gaps. A plain tiled navmesh (no obstacles; sandbags built
 * later are just bumped into), which unlike the tile cache links bridge decks
 * and ramps within a tile. Cached like the people's mesh.
 */
const VEHICLE_NAV = {
  cs: 0.5,
  ch: 0.25,
  /** Half a tank's width plus a margin (m), its height, the kerb it climbs. */
  radius: 2.0,
  height: 2.75,
  climb: 0.75,
  slope: 32,
};

export class VehicleNav {
  private readonly query: NavMeshQuery;

  private constructor(readonly navMesh: NavMesh) {
    this.query = new NavMeshQuery(navMesh);
  }

  static async build(physics: PhysicsWorld, extra?: { positions: number[]; indices: number[] }): Promise<VehicleNav | null> {
    recastReady ??= init();
    await recastReady;
    const { positions, indices } = collectNavInput(physics, extra);
    if (indices.length === 0) return null;
    const c = VEHICLE_NAV;
    const config = {
      cs: c.cs,
      ch: c.ch,
      walkableRadius: Math.ceil(c.radius / c.cs),
      walkableHeight: Math.ceil(c.height / c.ch),
      walkableClimb: Math.floor(c.climb / c.ch),
      walkableSlopeAngle: c.slope,
      minRegionArea: 64,
      mergeRegionArea: 400,
      maxSimplificationError: 1.5,
      maxEdgeLen: 24,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
      tileSize: 64,
    };
    const key = hashNavInput(positions, indices, `veh1${JSON.stringify(config)}`);
    const cached = skipCache() ? null : ((await loadNav(key)) ?? (await bakedNav(key)));
    if (cached) {
      try {
        return new VehicleNav(importNavMesh(cached).navMesh);
      } catch (err) {
        console.warn('[nav] cached vehicle navmesh unusable, rebuilding', err);
      }
    }
    const result = generateTiledNavMesh(positions, indices, config);
    if (!result.success) {
      console.warn('[nav] vehicle navmesh generation failed:', result.error);
      return null;
    }
    void saveNav(key, exportNavMesh(result.navMesh));
    return new VehicleNav(result.navMesh);
  }

  /**
   * Corner points of a drivable route from `from` (a vehicle) toward `to`
   * (the goal may stand where no hull fits, e.g. a zone in a dense town: the
   * route then ends at the nearest drivable point). False when there's none.
   */
  path(from: V3, to: V3, out: THREE.Vector3[]): boolean {
    out.length = 0;
    const a = this.query.findClosestPoint(from, { halfExtents: { x: 4, y: 6, z: 4 } });
    if (!a.success || !a.polyRef) return false;
    let b = this.query.findClosestPoint(to, { halfExtents: { x: 12, y: 8, z: 12 } });
    if (!b.success || !b.polyRef) b = this.query.findClosestPoint(to, { halfExtents: { x: 45, y: 15, z: 45 } });
    if (!b.success || !b.polyRef) return false;
    const res = this.query.computePath(a.point, b.point, { halfExtents: { x: 1, y: 2, z: 1 }, maxPathPolys: PATH_POLYS });
    if (!res.success || res.path.length === 0) return false;
    for (const p of res.path) out.push(new THREE.Vector3(p.x, p.y, p.z));
    return true;
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
    // The top of a small upright block (fountain, crate, car) is an island no
    // one can climb onto: leave it out so nothing (spawns, cover, paths) snaps there.
    const upright = v.set(0, 1, 0).applyQuaternion(q).y > 0.98;
    const island = upright && he.y * 2 > ISLAND_MIN_HEIGHT && 4 * he.x * he.z < ISLAND_MAX_AREA;
    for (let i = 0; i < idx.count; i++) {
      if (island && i >= TOP_FACE[0] && i < TOP_FACE[1]) continue;
      indices.push(base + idx.getX(i));
    }
  });
  box.dispose();
  return { positions, indices };
}

/** Dev: `?nocache` rebuilds the navmesh every load (for timing the build). */
function skipCache(): boolean {
  return import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('nocache');
}
