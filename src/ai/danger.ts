/**
 * A side's danger map: the battlefield in coarse cells, each holding how
 * dangerous it is to be there for this side, from what the side knows
 * (enemies seen, its soldiers going down, shots). It fades over time. One per
 * team, updated about once a second, so it costs the same however many bots
 * read it: they use it to pick a safer way in, to watch the dangerous side
 * while moving and to choose where to hold.
 */
export const DANGER = {
  /** Cell size (m). */
  cell: 8,
  /** Seconds for danger to halve. */
  halfLife: 12,
  /** Below this a cell counts as safe (route costs and watch directions ignore it). */
  floor: 0.15,
};

export class DangerMap {
  readonly v: Float32Array;
  readonly cols: number;
  readonly rows: number;
  readonly x0: number;
  readonly z0: number;

  constructor(minX: number, minZ: number, maxX: number, maxZ: number) {
    const c = DANGER.cell;
    this.x0 = minX;
    this.z0 = minZ;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / c));
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / c));
    this.v = new Float32Array(this.cols * this.rows);
  }

  /** Fades every cell by `dt` seconds' worth. */
  decay(dt: number): void {
    const f = Math.pow(0.5, dt / DANGER.halfLife);
    const v = this.v;
    for (let i = 0; i < v.length; i++) v[i] = v[i]! < 0.01 ? 0 : v[i]! * f;
  }

  /** Adds `amount` at (x, z), falling off linearly to nothing at `radius`; cells are capped at 4. */
  stamp(x: number, z: number, radius: number, amount: number): void {
    const c = DANGER.cell;
    const c0 = Math.max(0, Math.floor((x - radius - this.x0) / c));
    const c1 = Math.min(this.cols - 1, Math.floor((x + radius - this.x0) / c));
    const r0 = Math.max(0, Math.floor((z - radius - this.z0) / c));
    const r1 = Math.min(this.rows - 1, Math.floor((z + radius - this.z0) / c));
    for (let r = r0; r <= r1; r++) {
      for (let col = c0; col <= c1; col++) {
        const cx = this.x0 + (col + 0.5) * c;
        const cz = this.z0 + (r + 0.5) * c;
        const d = Math.hypot(cx - x, cz - z);
        if (d >= radius) continue;
        const i = r * this.cols + col;
        this.v[i] = Math.min(4, this.v[i]! + amount * (1 - d / radius));
      }
    }
  }

  at(x: number, z: number): number {
    const col = Math.floor((x - this.x0) / DANGER.cell);
    const row = Math.floor((z - this.z0) / DANGER.cell);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return 0;
    return this.v[row * this.cols + col]!;
  }

  /**
   * Danger met walking a path (points with x / z), sampled every `step` m;
   * `open` scales each sample (1 in the open, less where there is cover).
   */
  pathCost(path: readonly { x: number; z: number }[], open: (x: number, z: number) => number = () => 1, step = 4): number {
    let cost = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        const x = a.x + (b.x - a.x) * f;
        const z = a.z + (b.z - a.z) * f;
        const d = this.at(x, z);
        if (d > DANGER.floor) cost += d * open(x, z) * (len / n);
      }
    }
    return cost;
  }

  /**
   * The most dangerous way to look from (x, z) within `spread` radians of
   * `yaw` (yaw 0 = -Z, as everywhere else), checked at 12 and 28 m out; null
   * when nothing there is above the floor.
   */
  watchYaw(x: number, z: number, yaw: number, spread: number): number | null {
    let best = DANGER.floor;
    let bestYaw: number | null = null;
    for (let k = -2; k <= 2; k++) {
      const a = yaw + (k / 2) * spread;
      const dx = -Math.sin(a);
      const dz = -Math.cos(a);
      const d = this.at(x + dx * 12, z + dz * 12) + this.at(x + dx * 28, z + dz * 28) * 0.7;
      if (d > best) {
        best = d;
        bestYaw = a;
      }
    }
    return bestYaw;
  }
}
