import * as THREE from 'three';
import { RAPIER, Layer, groups, type PhysicsWorld } from '@/physics/PhysicsWorld';
import { TileNoise, smoothstep } from '@/render/noise';
import type { MapDef, TerrainDef } from './mapTypes';

type P2 = readonly [number, number];

/** Playable-area outline: point-in-polygon and distance to the edge. */
export class Boundary {
  constructor(readonly points: readonly P2[]) {}

  static fromMap(map: MapDef): Boundary {
    if (map.world.boundary && map.world.boundary.length >= 3) return new Boundary(map.world.boundary);
    const [sx, sz] = map.world.size;
    return new Boundary([
      [-sx / 2, -sz / 2],
      [sx / 2, -sz / 2],
      [sx / 2, sz / 2],
      [-sx / 2, sz / 2],
    ]);
  }

  contains(x: number, z: number): boolean {
    const p = this.points;
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, zi] = p[i]!;
      const [xj, zj] = p[j]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  /** Distance to the outline (unsigned). */
  edgeDistance(x: number, z: number): number {
    const p = this.points;
    let best = Infinity;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [ax, az] = p[j]!;
      const [bx, bz] = p[i]!;
      const dx = bx - ax;
      const dz = bz - az;
      const len = dx * dx + dz * dz;
      const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
      best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
    }
    return best;
  }

  /** How far outside the playable area a point is (0 inside). */
  outside(x: number, z: number): number {
    return this.contains(x, z) ? 0 : this.edgeDistance(x, z);
  }
}

/**
 * Ground height for a map: smooth hills and dips, pads that flatten ground for
 * buildings and zones, optional noise, and a rise outside the playable area so
 * the edge blends into the surrounding hills. Deterministic, so the render
 * mesh, collider and object placement all agree.
 */
/** Extent of the surrounding scenery (backdrop) in meters. */
export const SCENERY_EXTENT = 1400;

export class Terrain {
  private readonly noise = new TileNoise(41);
  private readonly hillNoise = new TileNoise(99);
  private readonly def: TerrainDef;

  constructor(
    def: TerrainDef | undefined,
    readonly boundary: Boundary,
    /** Ground rectangle covered by the mesh/collider, [x, z] centered on the origin. */
    readonly size: readonly [number, number],
  ) {
    this.def = def ?? {};
  }

  /** Height inside the map before the outside rise (what objects sit on). */
  heightAt(x: number, z: number): number {
    let h = 0;
    for (const hill of this.def.hills ?? []) {
      const d = Math.hypot(x - hill.pos[0], z - hill.pos[1]) / hill.radius;
      if (d < 1) h += hill.height * (0.5 + 0.5 * Math.cos(Math.PI * d));
    }
    const amp = this.def.noise ?? 0;
    if (amp > 0) h += amp * (this.noise.fbm(x / 400 + 0.5, z / 400 + 0.5, 6, 4) - 0.5) * 2;
    for (const pad of this.def.flats ?? []) {
      const d = Math.hypot(x - pad.pos[0], z - pad.pos[1]);
      const blend = pad.blend ?? 8;
      if (d >= pad.radius + blend) continue;
      const target = pad.height ?? this.padBase(pad.pos[0], pad.pos[1]);
      const w = 1 - smoothstep(pad.radius, pad.radius + blend, d);
      h += (target - h) * w;
    }
    return h;
  }

  /** Height of the unflattened ground at a pad center (pads keep the local level). */
  private padBase(x: number, z: number): number {
    let h = 0;
    for (const hill of this.def.hills ?? []) {
      const d = Math.hypot(x - hill.pos[0], z - hill.pos[1]) / hill.radius;
      if (d < 1) h += hill.height * (0.5 + 0.5 * Math.cos(Math.PI * d));
    }
    return h;
  }

  /**
   * Ground including the hills that rise beyond the boundary. Used by the map's
   * terrain mesh and by the surrounding scenery, so the two meet seamlessly.
   */
  surfaceAt(x: number, z: number): number {
    const d = this.boundary.outside(x, z);
    const h = this.heightAt(x, z);
    if (d <= 0) return h;
    const u = x / SCENERY_EXTENT + 0.5;
    const v = z / SCENERY_EXTENT + 0.5;
    const hills = this.hillNoise.fbm(u, v, 3, 5);
    return h + smoothstep(8, 160, d) * (8 + hills * 70) + smoothstep(300, 700, d) * 60 * this.hillNoise.fbm(u + 0.3, v, 2, 3);
  }

  /** Bounding box of the playable area [minX, minZ, maxX, maxZ]. */
  bounds(): [number, number, number, number] {
    const xs = this.boundary.points.map((p) => p[0]);
    const zs = this.boundary.points.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
  }

  get cell(): number {
    return this.def.cell ?? 2;
  }

  /** Samples the surface on the grid: (cols + 1) x (rows + 1) heights, row-major (z rows, x columns). */
  sample(): { cols: number; rows: number; heights: Float32Array } {
    const cols = Math.ceil(this.size[0] / this.cell);
    const rows = Math.ceil(this.size[1] / this.cell);
    const heights = new Float32Array((cols + 1) * (rows + 1));
    for (let r = 0; r <= rows; r++) {
      const z = -this.size[1] / 2 + (r / rows) * this.size[1];
      for (let c = 0; c <= cols; c++) {
        const x = -this.size[0] / 2 + (c / cols) * this.size[0];
        heights[r * (cols + 1) + c] = this.surfaceAt(x, z);
      }
    }
    return { cols, rows, heights };
  }
}

/**
 * Terrain mesh + Rapier heightfield collider. Returns the collider so its
 * handle can be registered as a ground surface.
 */
export function buildTerrain(
  terrain: Terrain,
  material: THREE.Material,
  physics: PhysicsWorld,
): { mesh: THREE.Mesh; collider: RAPIER.Collider; grid: ReturnType<Terrain['sample']> } {
  const grid = terrain.sample();
  const { cols, rows, heights } = grid;
  const [sx, sz] = terrain.size;

  const geo = new THREE.PlaneGeometry(sx, sz, cols, rows);
  geo.rotateX(-Math.PI / 2);
  // PlaneGeometry rows run from -z to +z after the rotation, matching the grid order.
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heights[i]!);
    // World-scale UVs (meters), like the blockout boxes.
    uv.setXY(i, pos.getX(i), -pos.getZ(i));
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  // Rapier wants column-major (rows + 1) x (cols + 1) with rows along local z... its
  // "rows" index the x axis in the JS API, so transpose: index = c * (rows + 1) + r.
  const hf = new Float32Array((cols + 1) * (rows + 1));
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) hf[c * (rows + 1) + r] = heights[r * (cols + 1) + c]!;
  }
  // Rays that land exactly on a grid vertex of a flat area can slip through the
  // heightfield; a sub-millimeter offset keeps round coordinates off the vertices.
  const desc = RAPIER.ColliderDesc.heightfield(rows, cols, hf, { x: sx, y: 1, z: sz })
    .setTranslation(0.00137, 0, 0.00171)
    .setCollisionGroups(groups(Layer.WORLD, 0xffff));
  const collider = physics.world.createCollider(desc);
  return { mesh, collider, grid };
}

/** Terrain triangles for the navmesh (same grid as the collider). */
export function terrainTriangles(terrain: Terrain, grid: ReturnType<Terrain['sample']>): { positions: number[]; indices: number[] } {
  const { cols, rows, heights } = grid;
  const [sx, sz] = terrain.size;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const z = -sz / 2 + (r / rows) * sz;
    for (let c = 0; c <= cols; c++) positions.push(-sx / 2 + (c / cols) * sx, heights[r * (cols + 1) + c]!, z);
  }
  const cell = Math.max(sx / cols, sz / rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Only cells in (or right next to) the playable area; the rest is unreachable.
      const cx = -sx / 2 + ((c + 0.5) / cols) * sx;
      const cz = -sz / 2 + ((r + 0.5) / rows) * sz;
      if (terrain.boundary.outside(cx, cz) > cell * 2) continue;
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      // Counter-clockwise seen from above (+y) so Recast treats them as floor.
      indices.push(a, d, b, b, d, e);
    }
  }
  return { positions, indices };
}

/**
 * Invisible walls along the boundary: they stop characters (BOUNDS layer) but
 * not bullets or grenades' line of sight checks.
 */
export function buildBoundaryWalls(boundary: Boundary, terrain: Terrain, physics: PhysicsWorld): void {
  const p = boundary.points;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [ax, az] = p[j]!;
    const [bx, bz] = p[i]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const base = Math.min(terrain.heightAt(ax, az), terrain.heightAt(bx, bz), terrain.heightAt(mx, mz));
    const yaw = Math.atan2(bz - az, bx - ax);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    // Overlap neighbours a little so there are no gaps at corners.
    physics.addStaticBox({ x: mx, y: base + 20, z: mz }, { x: len / 2 + 0.6, y: 30, z: 0.5 }, q, Layer.BOUNDS);
  }
}
