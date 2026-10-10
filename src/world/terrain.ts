import * as THREE from 'three';
import { RAPIER, Layer, groups, type PhysicsWorld } from '@/physics/PhysicsWorld';
import { TileNoise, smoothstep } from '@/render/noise';
import type { MapDef, RiverDef, TerrainDef } from './mapTypes';

type P2 = readonly [number, number];

/** Playable-area outline: point-in-polygon and distance to the edge. */
export class Boundary {
  /** Flat [x0, z0, x1, z1, ...] copy for the hot loops (terrain sampling calls these ~10^5 times). */
  private readonly xz: Float64Array;

  constructor(readonly points: readonly P2[]) {
    this.xz = new Float64Array(points.length * 2);
    points.forEach(([x, z], i) => {
      this.xz[i * 2] = x;
      this.xz[i * 2 + 1] = z;
    });
  }

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
    const p = this.xz;
    const n = p.length / 2;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[i * 2]!;
      const zi = p[i * 2 + 1]!;
      const xj = p[j * 2]!;
      const zj = p[j * 2 + 1]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  /** Distance to the outline (unsigned). */
  edgeDistance(x: number, z: number): number {
    return Math.sqrt(this.edgeDistanceSq(x, z));
  }

  private edgeDistanceSq(x: number, z: number): number {
    const p = this.xz;
    const n = p.length / 2;
    let best = Infinity;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = p[j * 2]!;
      const az = p[j * 2 + 1]!;
      const dx = p[i * 2]! - ax;
      const dz = p[i * 2 + 1]! - az;
      const len = dx * dx + dz * dz;
      let t = len > 0 ? ((x - ax) * dx + (z - az) * dz) / len : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - (ax + t * dx);
      const ez = z - (az + t * dz);
      const d = ex * ex + ez * ez;
      if (d < best) best = d;
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

/**
 * Distance to a polyline, precomputed on a 1 m grid around it and read back
 * bilinearly (Infinity beyond `reach`). Terrain height samples it ~10^5 times
 * per load; the exact distance over ~90 segments each time cost seconds.
 */
class DistanceGrid {
  private static readonly CELL = 1;
  private readonly data: Float32Array;
  private readonly x0: number;
  private readonly z0: number;
  private readonly cols: number;
  private readonly rows: number;

  constructor(
    pts: readonly (readonly [number, number])[],
    private readonly reach: number,
  ) {
    const C = DistanceGrid.CELL;
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    this.x0 = Math.floor(Math.min(...xs) - reach - 1);
    this.z0 = Math.floor(Math.min(...zs) - reach - 1);
    this.cols = Math.ceil((Math.max(...xs) + reach + 1 - this.x0) / C) + 1;
    this.rows = Math.ceil((Math.max(...zs) + reach + 1 - this.z0) / C) + 1;
    // Rasterize segment by segment: each only touches the cells within `reach` of it.
    // Cells beyond reach hold a finite cap (not Infinity: interpolating Infinity * 0 gives NaN).
    const cap = (reach + 3) * (reach + 3);
    const sq = new Float32Array(this.cols * this.rows).fill(cap);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]!;
      const [bx, bz] = pts[i + 1]!;
      const dx = bx - ax;
      const dz = bz - az;
      const len = dx * dx + dz * dz;
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - 2 - this.x0) / C));
      const c1 = Math.min(this.cols - 1, Math.ceil((Math.max(ax, bx) + reach + 2 - this.x0) / C));
      const q0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - 2 - this.z0) / C));
      const q1 = Math.min(this.rows - 1, Math.ceil((Math.max(az, bz) + reach + 2 - this.z0) / C));
      for (let r = q0; r <= q1; r++) {
        const z = this.z0 + r * C;
        for (let c = c0; c <= c1; c++) {
          const x = this.x0 + c * C;
          let t = len > 0 ? ((x - ax) * dx + (z - az) * dz) / len : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = x - (ax + t * dx);
          const ez = z - (az + t * dz);
          const d = ex * ex + ez * ez;
          const k = r * this.cols + c;
          if (d < sq[k]!) sq[k] = d;
        }
      }
    }
    this.data = sq.map(Math.sqrt);
  }

  sample(x: number, z: number): number {
    const u = (x - this.x0) / DistanceGrid.CELL;
    const v = (z - this.z0) / DistanceGrid.CELL;
    if (u < 0 || v < 0 || u >= this.cols - 1 || v >= this.rows - 1) return Infinity;
    const c = Math.floor(u);
    const r = Math.floor(v);
    const fu = u - c;
    const fv = v - r;
    const k = r * this.cols + c;
    const d = this.data;
    const a = d[k]! + (d[k + 1]! - d[k]!) * fu;
    const b = d[k + this.cols]! + (d[k + this.cols + 1]! - d[k + this.cols]!) * fu;
    const out = a + (b - a) * fv;
    return out > this.reach ? Infinity : out;
  }
}

/** Beyond the banks, a river's valley keeps shaping the hills this far out (m). */
const VALLEY_REACH = 40;

export class Terrain {
  private readonly noise = new TileNoise(41);
  private readonly hillNoise = new TileNoise(99);
  private readonly def: TerrainDef;
  private readonly riverDist: DistanceGrid[];

  constructor(
    def: TerrainDef | undefined,
    readonly boundary: Boundary,
    /** Ground rectangle covered by the mesh/collider, [x, z] centered on the origin. */
    readonly size: readonly [number, number],
  ) {
    this.def = def ?? {};
    this.riverDist = (this.def.rivers ?? []).map((r) => new DistanceGrid(r.pts, r.width / 2 + (r.bank ?? 5) + VALLEY_REACH + 2));
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
    const rivers = this.def.rivers;
    if (rivers) for (let i = 0; i < rivers.length; i++) h -= rivers[i]!.depth * this.riverShape(i, x, z);
    return h;
  }

  /** 1 on the river bed, easing to 0 at the top of the banks. */
  private riverShape(i: number, x: number, z: number): number {
    const r: RiverDef = this.def.rivers![i]!;
    const d = this.riverDist[i]!.sample(x, z);
    return d === Infinity ? 0 : 1 - smoothstep(r.width / 2, r.width / 2 + (r.bank ?? 5), d);
  }

  /** 1 near a river's course, fading out over `reach` meters beyond its banks (valleys continue past the edge). */
  private riverValley(x: number, z: number, reach: number): number {
    let v = 0;
    (this.def.rivers ?? []).forEach((r, i) => {
      const d = this.riverDist[i]!.sample(x, z);
      if (d !== Infinity) v = Math.max(v, 1 - smoothstep(r.width / 2, r.width / 2 + (r.bank ?? 5) + reach, d));
    });
    return v;
  }

  get rivers(): readonly RiverDef[] {
    return this.def.rivers ?? [];
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
    const rise = smoothstep(8, 160, d) * (8 + hills * 70) + smoothstep(300, 700, d) * 60 * this.hillNoise.fbm(u + 0.3, v, 2, 3);
    // Rivers leave through a valley instead of running into the hills.
    return h + rise * (1 - 0.85 * this.riverValley(x, z, VALLEY_REACH));
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

/** Distance from (x, z) to a polyline. */
export function polylineDistance(pts: readonly (readonly [number, number])[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len = dx * dx + dz * dz;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

/**
 * Terrain render chunks: cells per side, and the distances (m, camera to chunk
 * centre) at which a chunk drops to 1/2 and 1/4 detail. 256 m chunks (was 128)
 * cut ~46 terrain draw calls to ~12; the distances grew with them so the
 * ground around the player stays at full detail.
 */
const CHUNK_CELLS = 128;
const LOD_DISTANCES = [0, 290, 460];
/** Skirts hang this far below chunk edges to hide cracks between detail levels (m). */
const SKIRT = 1.5;

/**
 * Render mesh for the sampled ground: square chunks (culled on their own),
 * each a `THREE.LOD` with full, half and quarter detail by distance. Normals
 * come from the full grid so the levels light the same; skirts cover the
 * cracks where a finer chunk meets a coarser one.
 */
export function buildTerrainMesh(grid: ReturnType<Terrain['sample']>, size: readonly [number, number], material: THREE.Material, renderStep = 1): THREE.Group {
  const { cols, rows, heights } = grid;
  const [sx, sz] = size;
  const at = (c: number, r: number): number => heights[r * (cols + 1) + c]!;
  const px = (c: number): number => -sx / 2 + (c / cols) * sx;
  const pz = (r: number): number => -sz / 2 + (r / rows) * sz;
  const dx = sx / cols;
  const dz = sz / rows;
  const n = new THREE.Vector3();
  const normal = (c: number, r: number): THREE.Vector3 => {
    const hx = at(Math.min(cols, c + 1), r) - at(Math.max(0, c - 1), r);
    const hz = at(c, Math.min(rows, r + 1)) - at(c, Math.max(0, r - 1));
    const wx = (Math.min(cols, c + 1) - Math.max(0, c - 1)) * dx;
    const wz = (Math.min(rows, r + 1) - Math.max(0, r - 1)) * dz;
    return n.set(-hx / wx, 1, -hz / wz).normalize();
  };

  const chunk = (c0: number, c1: number, r0: number, r1: number, step: number): THREE.BufferGeometry => {
    const cs: number[] = [];
    for (let c = c0; c < c1; c += step) cs.push(c);
    cs.push(c1);
    const rs: number[] = [];
    for (let r = r0; r < r1; r += step) rs.push(r);
    rs.push(r1);
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const vert = (c: number, r: number, drop = 0): number => {
      const x = px(c);
      const z = pz(r);
      pos.push(x, at(c, r) - drop, z);
      const v = normal(c, r);
      nor.push(v.x, v.y, v.z);
      // World-scale UVs (meters), like the blockout boxes.
      uv.push(x, -z);
      return pos.length / 3 - 1;
    };
    const w = cs.length;
    for (const r of rs) for (const c of cs) vert(c, r);
    for (let j = 0; j < rs.length - 1; j++) {
      for (let i = 0; i < w - 1; i++) {
        const a = j * w + i;
        const b = a + w;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    // Skirts along the four edges, both windings (the ground material is single-sided).
    const edge = (list: [number, number][]): void => {
      for (let k = 0; k < list.length - 1; k++) {
        const [ca, ra] = list[k]!;
        const [cb, rb] = list[k + 1]!;
        const p0 = vert(ca, ra);
        const p1 = vert(cb, rb);
        const q0 = vert(ca, ra, SKIRT);
        const q1 = vert(cb, rb, SKIRT);
        idx.push(p0, q0, p1, p1, q0, q1, p0, p1, q0, p1, q1, q0);
      }
    };
    edge(cs.map((c) => [c, r0]));
    edge(cs.map((c) => [c, r1]));
    edge(rs.map((r) => [c0, r]));
    edge(rs.map((r) => [c1, r]));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  };

  const group = new THREE.Group();
  group.name = 'terrain';
  const base = Math.max(1, Math.floor(renderStep));
  for (let r0 = 0; r0 < rows; r0 += CHUNK_CELLS) {
    for (let c0 = 0; c0 < cols; c0 += CHUNK_CELLS) {
      const c1 = Math.min(cols, c0 + CHUNK_CELLS);
      const r1 = Math.min(rows, r0 + CHUNK_CELLS);
      const lod = new THREE.LOD();
      lod.position.set(px((c0 + c1) / 2), 0, pz((r0 + r1) / 2));
      lod.updateMatrix();
      LOD_DISTANCES.forEach((d, level) => {
        const step = Math.min(CHUNK_CELLS / 2, base << level);
        const geo = chunk(c0, c1, r0, r1, step);
        geo.translate(-lod.position.x, 0, -lod.position.z);
        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        // After the other opaque things: the ground behind walls, cars and props is then
        // rejected by the depth test before its (costly, layered) shading. -2.2 ms of 13
        // on Iron Gate at the square (Iris Xe, 2026-10-10).
        mesh.renderOrder = 1;
        lod.addLevel(mesh, d);
      });
      group.add(lod);
    }
  }
  return group;
}

/**
 * Terrain mesh + Rapier heightfield collider. Returns the collider so its
 * handle can be registered as a ground surface. Without a material (the game
 * server) there is no mesh.
 */
export function buildTerrain(
  terrain: Terrain,
  material: THREE.Material | null,
  physics: PhysicsWorld,
  /** Render mesh uses every `renderStep`-th grid line at full detail (the collider always uses all). */
  renderStep = 1,
): { mesh: THREE.Group | null; collider: RAPIER.Collider; grid: ReturnType<Terrain['sample']> } {
  const grid = terrain.sample();
  const { cols, rows, heights } = grid;
  const [sx, sz] = terrain.size;
  const mesh = material ? buildTerrainMesh(grid, terrain.size, material, renderStep) : null;

  // Rapier wants column-major (rows + 1) x (cols + 1) with rows along local z... its
  // "rows" index the x axis in the JS API, so transpose: index = c * (rows + 1) + r.
  const hf = new Float32Array((cols + 1) * (rows + 1));
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) hf[c * (rows + 1) + r] = heights[r * (cols + 1) + c]!;
  }
  // Rays that land exactly on a grid vertex of a flat area can slip through the
  // heightfield; a sub-millimeter offset keeps round coordinates off the vertices.
  const desc = RAPIER.ColliderDesc.heightfield(rows, cols, hf, { x: sx, y: 1, z: sz }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES)
    .setTranslation(0.00137, 0, 0.00171)
    .setCollisionGroups(groups(Layer.WORLD, 0xffff));
  const collider = physics.world.createCollider(desc);
  physics.setGround(collider, (a, b) => groundBlocks(grid, terrain.size, a, b));
  return { mesh, collider, grid };
}

/**
 * Whether the sampled ground rises above the segment a-b (bilinear heights,
 * checked once per grid cell, endpoints excluded).
 */
export function groundBlocks(
  grid: { cols: number; rows: number; heights: Float32Array },
  size: readonly [number, number],
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): boolean {
  const { cols, rows, heights } = grid;
  const cw = size[0] / cols;
  const ch = size[1] / rows;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const n = Math.floor(Math.hypot(dx, dz) / Math.min(cw, ch));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const u = (a.x + dx * t + size[0] / 2) / cw;
    const v = (a.z + dz * t + size[1] / 2) / ch;
    if (u < 0 || v < 0 || u >= cols || v >= rows) continue;
    const c = Math.floor(u);
    const r = Math.floor(v);
    const fu = u - c;
    const fv = v - r;
    const k = r * (cols + 1) + c;
    const h0 = heights[k]! + (heights[k + 1]! - heights[k]!) * fu;
    const h1 = heights[k + cols + 1]! + (heights[k + cols + 2]! - heights[k + cols + 1]!) * fu;
    if (h0 + (h1 - h0) * fv > a.y + (b.y - a.y) * t) return true;
  }
  return false;
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
