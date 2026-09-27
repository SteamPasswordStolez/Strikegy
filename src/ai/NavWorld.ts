import * as THREE from 'three';
import { init, NavMeshQuery, type NavMesh } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { Layer, RAPIER, type PhysicsWorld } from '@/physics/PhysicsWorld';
import { MOVE } from '@/player/movement';

/** Voxel size used to build the navmesh (meters). */
const CS = 0.2;
const CH = 0.1;

type V3 = { x: number; y: number; z: number };

let recastReady: Promise<void> | null = null;

/**
 * Navigation mesh for bots, built from the static world colliders (every map
 * block and prop is a box). Wraps the Detour queries the AI needs: paths,
 * nearest walkable points and random points in an area.
 */
export class NavWorld {
  private readonly query: NavMeshQuery;
  private readonly halfExtents = { x: 2, y: 4, z: 2 };

  private constructor(readonly navMesh: NavMesh) {
    this.query = new NavMeshQuery(navMesh);
  }

  /** Builds from the physics world; returns null if generation fails. */
  /** `extra` adds non-box walkable geometry (terrain triangles, counter-clockwise from above). */
  static async build(physics: PhysicsWorld, extra?: { positions: number[]; indices: number[] }): Promise<NavWorld | null> {
    recastReady ??= init();
    await recastReady;
    const { positions, indices } = collectStaticBoxes(physics);
    if (extra) {
      const base = positions.length / 3;
      for (const v of extra.positions) positions.push(v);
      for (const i of extra.indices) indices.push(base + i);
    }
    if (indices.length === 0) return null;
    const result = generateSoloNavMesh(positions, indices, {
      cs: CS,
      ch: CH,
      walkableRadius: Math.ceil(MOVE.radius / CS),
      walkableHeight: Math.ceil(MOVE.standHeight / CH),
      walkableClimb: Math.floor(0.45 / CH),
      walkableSlopeAngle: 45,
      maxEdgeLen: Math.round(12 / CS),
      minRegionArea: 8,
      mergeRegionArea: 20,
      maxSimplificationError: 1.3,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    });
    if (!result.success) {
      console.warn('[nav] navmesh generation failed:', result.error);
      return null;
    }
    return new NavWorld(result.navMesh);
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
    this.navMesh.destroy();
  }
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
