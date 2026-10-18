import type { Terrain } from './terrain';
import type { Sea } from './waves';

/** Grid spacing of the water map (m). */
const CELL = 2;
/** Water deeper than this slows people down (m). */
export const WADE_DEPTH = 0.25;
/** Speed multiplier while wading. */
export const WADE_SPEED = 0.6;
/** Water this deep over the feet or more is swum (m): about chest high. */
export const SWIM_DEPTH = 1.25;
/** Water within this distance of a bridge centre counts as crossed by the bridge (m). */
const BRIDGE_REACH = 18;

/** Nearest point on a polyline to (x, z). */
function nearestOn(pts: readonly (readonly [number, number])[], x: number, z: number): [number, number, number] {
  let best = Infinity;
  let bx = pts[0]![0];
  let bz = pts[0]![1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]!;
    const [cx, cz] = pts[i + 1]!;
    const dx = cx - ax;
    const dz = cz - az;
    const len = dx * dx + dz * dz;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
    const px = ax + t * dx;
    const pz = az + t * dz;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      bx = px;
      bz = pz;
    }
  }
  return [bx, bz, best];
}

/**
 * Water surface heights on a grid over the map (NaN where dry), precomputed
 * from the terrain's rivers so the per-step lookup is one array read.
 */
export class WaterMap {
  private readonly level: Float32Array;
  private readonly cols: number;
  private readonly rows: number;
  private readonly x0: number;
  private readonly z0: number;
  /** True when the map has any water at all. */
  readonly any: boolean;
  /** Bridge centres over the rivers [x, z]. */
  readonly crossings: readonly (readonly [number, number])[];

  /** Ground height where the sea can reach (under its highest crest), NaN elsewhere; null without a sea. */
  private readonly seaCells: Float32Array | null;

  constructor(
    terrain: Terrain,
    /** The map's sea (its surface moves: looked up each time). */
    readonly sea: Sea | null = null,
  ) {
    const [sx, sz] = terrain.size;
    this.cols = Math.ceil(sx / CELL) + 1;
    this.rows = Math.ceil(sz / CELL) + 1;
    this.x0 = -sx / 2;
    this.z0 = -sz / 2;
    this.level = new Float32Array(this.cols * this.rows).fill(NaN);
    this.crossings = terrain.rivers.flatMap((r) => r.crossings ?? []);
    let any = !!sea;
    this.seaCells = null;
    if (sea) {
      const cells = new Float32Array(this.cols * this.rows).fill(NaN);
      const top = sea.level + sea.swell / 2 + 0.2;
      for (let row = 0; row < this.rows; row++) {
        for (let col = 0; col < this.cols; col++) {
          const ground = terrain.surfaceAt(this.x0 + col * CELL, this.z0 + row * CELL);
          if (ground < top) cells[row * this.cols + col] = ground;
        }
      }
      this.seaCells = cells;
    }
    for (const r of terrain.rivers) {
      const reach = r.width / 2 + (r.bank ?? 5);
      const xs = r.pts.map((p) => p[0]);
      const zs = r.pts.map((p) => p[1]);
      const c0 = Math.max(0, Math.floor((Math.min(...xs) - reach - this.x0) / CELL));
      const c1 = Math.min(this.cols - 1, Math.ceil((Math.max(...xs) + reach - this.x0) / CELL));
      const r0 = Math.max(0, Math.floor((Math.min(...zs) - reach - this.z0) / CELL));
      const r1 = Math.min(this.rows - 1, Math.ceil((Math.max(...zs) + reach - this.z0) / CELL));
      for (let row = r0; row <= r1; row++) {
        const z = this.z0 + row * CELL;
        for (let col = c0; col <= c1; col++) {
          const x = this.x0 + col * CELL;
          const [nx, nz, d] = nearestOn(r.pts, x, z);
          if (d > reach) continue;
          const surface = terrain.heightAt(nx, nz) + (r.water ?? 0.6);
          if (terrain.heightAt(x, z) >= surface) continue;
          const i = row * this.cols + col;
          const prev = this.level[i]!;
          this.level[i] = Number.isNaN(prev) ? surface : Math.max(prev, surface);
          any = true;
        }
      }
    }
    this.any = any;
  }

  /** Water surface height at (x, z), or NaN on dry ground (the sea's moving surface where it reaches). */
  levelAt(x: number, z: number): number {
    const col = Math.round((x - this.x0) / CELL);
    const row = Math.round((z - this.z0) / CELL);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return this.sea ? this.sea.heightAt(x, z) : NaN;
    const i = row * this.cols + col;
    const river = this.level[i]!;
    const ground = this.seaCells ? this.seaCells[i]! : NaN;
    if (Number.isNaN(ground)) return river;
    // The sea here now: dry while a trough leaves the sand bare.
    const sea = this.sea!.heightAt(x, z);
    if (sea <= ground) return river;
    return Number.isNaN(river) ? sea : Math.max(river, sea);
  }

  /** Whether the sea reaches (x, z) (not rivers). */
  seaAt(x: number, z: number): boolean {
    if (!this.seaCells) return false;
    const col = Math.round((x - this.x0) / CELL);
    const row = Math.round((z - this.z0) / CELL);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return true;
    return !Number.isNaN(this.seaCells[row * this.cols + col]!);
  }

  /** Depth of water over a point at height y (0 when dry or above the surface). */
  depthAt(x: number, y: number, z: number): number {
    const l = this.levelAt(x, z);
    return l > y ? l - y : 0;
  }

  /**
   * Meters of a path (corner points) over water, not counting the stretch at
   * a bridge. (Corner heights can't tell wading from crossing a deck: a
   * straight path runs bank to bank either way.)
   */
  wetLength(path: readonly { x: number; z: number }[]): number {
    let wet = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.ceil(len / CELL));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        if (Number.isNaN(this.levelAt(x, z))) continue;
        if (this.crossings.some((c) => Math.hypot(x - c[0], z - c[1]) < BRIDGE_REACH)) continue;
        wet += len / n;
      }
    }
    return wet;
  }
}
