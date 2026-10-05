/**
 * Tactical points: places on the navmesh right against something solid
 * (walls, cars, sandbags, rocks, trunks), each with the directions it covers
 * a soldier from. Found once per map from the navmesh's outer edges (where
 * the walkable area stops at an obstacle) and a few short rays, so at run
 * time a bot picks cover, a peek spot or a defensive position by looking up
 * nearby points instead of casting rays around itself.
 *
 * Directions are eight 45° sectors in the XZ plane: sector k points along
 * (cos k·45°, sin k·45°).
 */

/** A ray against the static world: true when it hits something within `len`. */
export type RayFn = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number) => boolean;

export const TACTICS = {
  /** Spacing of samples along an obstacle's edge (m). */
  sample: 2.4,
  /** How far in from the edge a soldier stands (m, about the body radius). */
  inset: 0.45,
  /** A ray this long straight at the edge must hit something: else it is a drop-off or a seam, not cover. */
  probe: 1.4,
  /** Cover rays: how close the obstacle must be in a direction (m). */
  reach: 1.6,
  /** Ray heights over the feet: a crouched soldier's chest, a standing one's eyes. */
  crouch: 0.85,
  stand: 1.55,
  /** A side step from behind a wall that may clear it (m), and how far that view must be open. */
  lean: 0.9,
  leanReach: 3,
  /** Points closer than this keep only the first (m). */
  gap: 1.3,
  /** Lookup grid cell (m). */
  cell: 8,
};

const SECTOR = Math.PI / 4;

/** The 45° sector a direction falls in (0..7). */
export function sectorOf(dx: number, dz: number): number {
  const k = Math.round(Math.atan2(dz, dx) / SECTOR);
  return ((k % 8) + 8) % 8;
}

/** Unit direction of sector `k`. */
export function sectorDir(k: number): [number, number] {
  return [Math.cos(k * SECTOR), Math.sin(k * SECTOR)];
}

export interface TacticalData {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Sectors a crouched soldier is hidden from. */
  low: Uint8Array;
  /** Sectors a standing soldier is hidden from too (a wall, not a low obstacle). */
  high: Uint8Array;
  /** High-cover sectors with a clear view a side step to the left (+perp) / right (-perp). */
  leanA: Uint8Array;
  leanB: Uint8Array;
}

/** Cover a point gives against a threat: none, low (shoot over it standing) or high (lean out to shoot). */
export type CoverKind = 0 | 1 | 2;

export class TacticalMap {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly low: Uint8Array;
  readonly high: Uint8Array;
  readonly leanA: Uint8Array;
  readonly leanB: Uint8Array;
  /** Bot id holding each point (0 = free). */
  readonly claim: Int32Array;
  private readonly cells = new Map<number, number[]>();

  constructor(d: TacticalData) {
    this.x = d.x;
    this.y = d.y;
    this.z = d.z;
    this.low = d.low;
    this.high = d.high;
    this.leanA = d.leanA;
    this.leanB = d.leanB;
    this.claim = new Int32Array(d.x.length);
    for (let i = 0; i < d.x.length; i++) {
      const key = cellKey(d.x[i]!, d.z[i]!);
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(i);
    }
  }

  get count(): number {
    return this.x.length;
  }

  /** Points within `r` of (x, z) (any height). */
  near(x: number, z: number, r: number, out: number[] = []): number[] {
    out.length = 0;
    const c = TACTICS.cell;
    const r2 = r * r;
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) {
      for (let cz = Math.floor((z - r) / c); cz <= Math.floor((z + r) / c); cz++) {
        const list = this.cells.get(cx * 73856093 + cz);
        if (!list) continue;
        for (const i of list) if ((this.x[i]! - x) ** 2 + (this.z[i]! - z) ** 2 <= r2) out.push(i);
      }
    }
    return out;
  }

  /** How many points share the lookup cell of (x, z): a rough measure of how much cover is around. */
  density(x: number, z: number): number {
    return this.cells.get(cellKey(x, z))?.length ?? 0;
  }

  /** Cover point `i` gives against a threat at (tx, tz). */
  cover(i: number, tx: number, tz: number): CoverKind {
    const bit = 1 << sectorOf(tx - this.x[i]!, tz - this.z[i]!);
    if (!(this.low[i]! & bit)) return 0;
    return this.high[i]! & bit ? 2 : 1;
  }

  /** Behind high cover: the side step that clears it toward (tx, tz): +1 / -1 along the sector's left, 0 = none. */
  leanSide(i: number, tx: number, tz: number): number {
    const bit = 1 << sectorOf(tx - this.x[i]!, tz - this.z[i]!);
    if (this.leanA[i]! & bit) return 1;
    if (this.leanB[i]! & bit) return -1;
    return 0;
  }

  /** Where a side step from point `i` toward (tx, tz) puts the soldier (`side` from `leanSide`). */
  leanSpot(i: number, tx: number, tz: number, side: number, out: { x: number; y: number; z: number }): void {
    const [dx, dz] = sectorDir(sectorOf(tx - this.x[i]!, tz - this.z[i]!));
    out.x = this.x[i]! - dz * side * TACTICS.lean;
    out.y = this.y[i]!;
    out.z = this.z[i]! + dx * side * TACTICS.lean;
  }

  /** Compact bytes for the cache. */
  toBytes(): Uint8Array {
    const n = this.count;
    const out = new Uint8Array(8 + n * 16);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x54414331); // "TAC1"
    view.setUint32(4, n);
    new Float32Array(out.buffer, 8, n * 3).set(interleave(this.x, this.y, this.z));
    const flags = out.subarray(8 + n * 12);
    for (let i = 0; i < n; i++) {
      flags[i * 4] = this.low[i]!;
      flags[i * 4 + 1] = this.high[i]!;
      flags[i * 4 + 2] = this.leanA[i]!;
      flags[i * 4 + 3] = this.leanB[i]!;
    }
    return out;
  }

  static fromBytes(bytes: Uint8Array): TacticalMap | null {
    if (bytes.length < 8) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0) !== 0x54414331) return null;
    const n = view.getUint32(4);
    if (bytes.length !== 8 + n * 16) return null;
    // Copy so the floats are aligned whatever offset the bytes came at.
    const pos = new Float32Array(bytes.slice(8, 8 + n * 12).buffer);
    const flags = bytes.subarray(8 + n * 12);
    const d = blank(n);
    for (let i = 0; i < n; i++) {
      d.x[i] = pos[i * 3]!;
      d.y[i] = pos[i * 3 + 1]!;
      d.z[i] = pos[i * 3 + 2]!;
      d.low[i] = flags[i * 4]!;
      d.high[i] = flags[i * 4 + 1]!;
      d.leanA[i] = flags[i * 4 + 2]!;
      d.leanB[i] = flags[i * 4 + 3]!;
    }
    return new TacticalMap(d);
  }
}

function cellKey(x: number, z: number): number {
  return Math.floor(x / TACTICS.cell) * 73856093 + Math.floor(z / TACTICS.cell);
}

function interleave(a: Float32Array, b: Float32Array, c: Float32Array): Float32Array {
  const out = new Float32Array(a.length * 3);
  for (let i = 0; i < a.length; i++) {
    out[i * 3] = a[i]!;
    out[i * 3 + 1] = b[i]!;
    out[i * 3 + 2] = c[i]!;
  }
  return out;
}

function blank(n: number): TacticalData {
  return { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), low: new Uint8Array(n), high: new Uint8Array(n), leanA: new Uint8Array(n), leanB: new Uint8Array(n) };
}

/**
 * Finds the tactical points of a navmesh given as triangles (`positions`
 * xyz, `indices` triples) and a ray test against the static world. Edges
 * used by one triangle only are where the walkable area ends; samples along
 * them, a body's width inside, become points when something solid stands
 * right there. `pause` (if given) is awaited every ~40 ms of work so a
 * loading screen keeps drawing.
 */
export async function buildTactical(positions: ArrayLike<number>, indices: ArrayLike<number>, ray: RayFn, pause?: () => Promise<void>): Promise<TacticalMap> {
  // Vertices welded by position (tiles repeat the ones on their borders).
  const weld = new Map<string, number>();
  const vid = new Int32Array(positions.length / 3);
  for (let i = 0; i < vid.length; i++) {
    const key = `${Math.round(positions[i * 3]! * 20)},${Math.round(positions[i * 3 + 1]! * 5)},${Math.round(positions[i * 3 + 2]! * 20)}`;
    let id = weld.get(key);
    if (id === undefined) weld.set(key, (id = i));
    vid[i] = id;
  }
  // Each edge: how many triangles use it and the corner opposite it (in the first one).
  const edges = new Map<number, { a: number; b: number; c: number; n: number }>();
  for (let t = 0; t + 2 < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = vid[indices[t + e]!]!;
      const b = vid[indices[t + ((e + 1) % 3)]!]!;
      const c = vid[indices[t + ((e + 2) % 3)]!]!;
      if (a === b) continue;
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      const hit = edges.get(key);
      if (hit) hit.n++;
      else edges.set(key, { a, b, c, n: 1 });
    }
  }
  const T = TACTICS;
  const px: number[] = [];
  const py: number[] = [];
  const pz: number[] = [];
  const low: number[] = [];
  const high: number[] = [];
  const leanA: number[] = [];
  const leanB: number[] = [];
  const taken = new Set<string>();
  let since = performance.now();
  const P = (i: number, k: number) => positions[i * 3 + k]!;
  for (const e of edges.values()) {
    if (e.n !== 1) continue;
    const ax = P(e.a, 0);
    const ay = P(e.a, 1);
    const az = P(e.a, 2);
    const ex = P(e.b, 0) - ax;
    const ey = P(e.b, 1) - ay;
    const ez = P(e.b, 2) - az;
    const len = Math.hypot(ex, ez);
    if (len < 0.3) continue;
    // Inward: across the edge toward the triangle's third corner.
    let nx = -ez / len;
    let nz = ex / len;
    if ((P(e.c, 0) - ax) * nx + (P(e.c, 2) - az) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const samples = Math.max(1, Math.round(len / T.sample));
    for (let s = 0; s < samples; s++) {
      const f = (s + 0.5) / samples;
      const x = ax + ex * f + nx * T.inset;
      const y = ay + ey * f;
      const z = az + ez * f + nz * T.inset;
      const cellKey = `${Math.floor(x / T.gap)},${Math.floor(y / 2)},${Math.floor(z / T.gap)}`;
      if (taken.has(cellKey)) continue;
      // Something solid right past the edge (else it's a ledge or a seam between tiles).
      if (!ray(x, y + T.crouch, z, -nx, 0, -nz, T.probe)) continue;
      let lo = 0;
      let hi = 0;
      let la = 0;
      let lb = 0;
      for (let k = 0; k < 8; k++) {
        const [dx, dz] = sectorDir(k);
        if (!ray(x, y + T.crouch, z, dx, 0, dz, T.reach)) continue;
        lo |= 1 << k;
        if (!ray(x, y + T.stand, z, dx, 0, dz, T.reach)) continue;
        hi |= 1 << k;
        // A wall: does a step to either side clear it?
        for (const side of [1, -1]) {
          const sx = -dz * side;
          const sz = dx * side;
          if (ray(x, y + T.crouch, z, sx, 0, sz, T.lean + 0.3)) continue;
          if (!ray(x + sx * T.lean, y + T.stand, z + sz * T.lean, dx, 0, dz, T.leanReach)) {
            if (side > 0) la |= 1 << k;
            else lb |= 1 << k;
          }
        }
      }
      if (!lo) continue;
      taken.add(cellKey);
      px.push(x);
      py.push(y);
      pz.push(z);
      low.push(lo);
      high.push(hi);
      leanA.push(la);
      leanB.push(lb);
    }
    if (pause && performance.now() - since > 40) {
      await pause();
      since = performance.now();
    }
  }
  return new TacticalMap({
    x: Float32Array.from(px),
    y: Float32Array.from(py),
    z: Float32Array.from(pz),
    low: Uint8Array.from(low),
    high: Uint8Array.from(high),
    leanA: Uint8Array.from(leanA),
    leanB: Uint8Array.from(leanB),
  });
}
