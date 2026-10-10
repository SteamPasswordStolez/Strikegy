import type { Flora } from '@/world/mapTypes';

/**
 * Tree crowns as the bots see them, shaped like the drawn trees (conifers.ts,
 * treeSpecies.ts; heights scale with TREE_HEIGHT 18 m x the tree's scale):
 * conifers a cone from a fifth of the height to the top whose lowest branches
 * droop (their tips hang ~0.45 m lower per metre out), broadleaf trees an
 * ellipsoid round 0.62 of the height, palms a flat one of fronds at the top.
 * `density` is how much a metre of crown hides (optical depth per metre).
 *
 * It used to be a flat grid of tree counts that ignored height and the last
 * 3 m at each end, and needed ~12 m of thick crowns before it hid anyone: a
 * soldier in or behind a tree was seen and shot as if it weren't there.
 */
const SHAPE: Record<Flora, { height: number; cone: boolean; centre: number; radius: number; vertical: number; density: number }> = {
  // Cone: bottom at `centre`, radius `radius` x height there, narrowing to the top.
  conifer: { height: 18, cone: true, centre: 0.2, radius: 0.245, vertical: 0, density: 0.6 },
  broadleaf: { height: 16.5, cone: false, centre: 0.62, radius: 0.36, vertical: 0.3, density: 0.5 },
  palm: { height: 16, cone: false, centre: 0.92, radius: 0.3, vertical: 0.12, density: 0.3 },
};

/** How far a conifer's lowest branches hang below the crown base per metre out from the trunk. */
const DROOP = 0.45;
/** Footprint grid cell (m) and the step along a sight line (m). */
const CELL = 2;
const STEP = 0.8;
/** Stop adding once the line is this opaque (nothing shows through e^-4). */
const TAU_MAX = 4;

export class Crowns {
  private readonly x: Float32Array;
  private readonly z: Float32Array;
  /** Crown bottom / top (absolute heights) and widest radius. */
  private readonly y0: Float32Array;
  private readonly y1: Float32Array;
  private readonly r: Float32Array;
  private readonly cone: boolean;
  private readonly density: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly gx0: number;
  private readonly gz0: number;
  /** Trees whose crown footprint touches each cell: `list[start[c] .. start[c + 1])`. */
  private readonly start: Int32Array;
  private readonly list: Int32Array;

  constructor(
    trees: readonly (readonly [number, number, number])[],
    size: readonly [number, number],
    heightAt: (x: number, z: number) => number,
    flora: Flora = 'conifer',
  ) {
    const shape = SHAPE[flora];
    const n = trees.length;
    this.cone = shape.cone;
    this.density = shape.density;
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.y0 = new Float32Array(n);
    this.y1 = new Float32Array(n);
    this.r = new Float32Array(n);
    trees.forEach(([x, z, s], i) => {
      const h = shape.height * s;
      const base = heightAt(x, z);
      this.x[i] = x;
      this.z[i] = z;
      this.r[i] = shape.radius * h + (shape.cone ? 0.35 : 0);
      if (shape.cone) {
        this.y0[i] = base + shape.centre * h;
        this.y1[i] = base + h;
      } else {
        // Broadleaf leaves start 1 m over the fork (~0.35 of the height).
        this.y0[i] = base + Math.max((shape.centre - shape.vertical) * h, flora === 'broadleaf' ? 0.35 * h + 1 : 0);
        this.y1[i] = base + (shape.centre + shape.vertical) * h;
      }
    });
    this.cols = Math.ceil(size[0] / CELL) + 1;
    this.rows = Math.ceil(size[1] / CELL) + 1;
    this.gx0 = -size[0] / 2;
    this.gz0 = -size[1] / 2;
    const cellsOf = (i: number, fn: (c: number) => void) => {
      const r = this.r[i]!;
      const c0 = Math.max(0, Math.floor((this.x[i]! - r - this.gx0) / CELL));
      const c1 = Math.min(this.cols - 1, Math.floor((this.x[i]! + r - this.gx0) / CELL));
      const r0 = Math.max(0, Math.floor((this.z[i]! - r - this.gz0) / CELL));
      const r1 = Math.min(this.rows - 1, Math.floor((this.z[i]! + r - this.gz0) / CELL));
      for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) fn(row * this.cols + col);
    };
    const count = new Int32Array(this.cols * this.rows + 1);
    for (let i = 0; i < n; i++) cellsOf(i, (c) => count[c + 1]!++);
    for (let c = 0; c < this.cols * this.rows; c++) count[c + 1]! += count[c]!;
    this.start = count;
    this.list = new Int32Array(count[this.cols * this.rows]!);
    const fill = this.start.slice();
    for (let i = 0; i < n; i++) cellsOf(i, (c) => (this.list[fill[c]!++] = i));
  }

  /** Whether a point at height `y`, `d2` (squared, horizontal) from tree `i`'s trunk, is in its crown. */
  private inside(i: number, y: number, d2: number): boolean {
    const y0 = this.y0[i]!;
    const y1 = this.y1[i]!;
    const r0 = this.r[i]!;
    if (y > y1) return false;
    if (this.cone) {
      if (y >= y0) {
        const r = (r0 - 0.35) * ((y1 - y) / (y1 - y0)) + 0.35;
        return d2 < r * r;
      }
      // Under the crown base only the drooping skirt: a ring further out the lower it is.
      const rin = (y0 - y) / DROOP;
      return rin < r0 && d2 > rin * rin && d2 < r0 * r0;
    }
    if (y < y0) return false;
    const u = (2 * y - y0 - y1) / (y1 - y0);
    const r = r0 * Math.sqrt(1 - u * u);
    return d2 < r * r;
  }

  /**
   * Optical depth of the crowns between two points (0 = clear; the share that
   * shows through is e^-depth). The first half metre (the viewer's own face)
   * and the last 0.3 m (the target's body) don't count.
   */
  depth(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1) return 0;
    let tau = 0;
    for (let d = 0.5; d < len - 0.3; d += STEP) {
      const t = d / len;
      const x = ax + dx * t;
      const y = ay + dy * t;
      const z = az + dz * t;
      const col = Math.floor((x - this.gx0) / CELL);
      const row = Math.floor((z - this.gz0) / CELL);
      if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) continue;
      const c = row * this.cols + col;
      for (let k = this.start[c]!; k < this.start[c + 1]!; k++) {
        const i = this.list[k]!;
        const ex = x - this.x[i]!;
        const ez = z - this.z[i]!;
        if (this.inside(i, y, ex * ex + ez * ez)) {
          tau += this.density * STEP;
          if (tau >= TAU_MAX) return tau;
        }
      }
    }
    return tau;
  }
}
