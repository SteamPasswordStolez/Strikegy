import type { MapDef } from '@/world/mapTypes';

/**
 * Where a big map's navmesh is fine and where it is coarse (2026-10-18, big
 * maps plan step 1). The soldiers' navmesh is 0.2 m voxels in 6.4 m tiles: on
 * an island 1.8 x 1.4 km that is ~51,000 tiles, past what Detour addresses
 * (16,384 with 32-bit refs) and minutes to bake. Open ground needs no such
 * detail, so a big map gets the fine mesh only round its towns, positions and
 * zones (this mask) and a coarse one everywhere; `NavWorld` stitches them.
 * Maps up to `FINE_ONLY_AREA` stay fine all over, exactly as before.
 */
export interface FineMask {
  /** Cell edge (m). */
  cell: number;
  x0: number;
  z0: number;
  cols: number;
  rows: number;
  /** 1 = fine (the core), row-major (z rows, x columns). */
  bits: Uint8Array;
  /** Connected patch of each fine cell (0 = none), for "both ends in one town". */
  patch: Int32Array;
}

/** What a big map's navmeshes are built from besides the colliders: the mask and the coarse mesh's terrain. */
export interface BigNavInput {
  fine: FineMask;
  coarseExtra: { positions: number[]; indices: number[] };
}

/** Playable bounding boxes up to this many m² keep one fine navmesh (Ardennes is ~140,000). */
export const FINE_ONLY_AREA = 400_000;

const CELL = 8;
/** How far round things the fine mesh reaches (m). */
const AROUND = { building: 18, solid: 10, zone: 30, spawn: 36 };

/** Cells are fine within these distances of the map's buildings, solid objects, zones and spawns; null on maps small enough to stay all fine. */
export function navFineMask(map: MapDef): FineMask | null {
  const pts = map.world.boundary ?? [
    [-map.world.size[0] / 2, -map.world.size[1] / 2],
    [map.world.size[0] / 2, map.world.size[1] / 2],
  ];
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  if ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs)) <= FINE_ONLY_AREA) return null;
  const [sx, sz] = map.world.size;
  const cols = Math.ceil(sx / CELL);
  const rows = Math.ceil(sz / CELL);
  const mask: FineMask = { cell: CELL, x0: -sx / 2, z0: -sz / 2, cols, rows, bits: new Uint8Array(cols * rows), patch: new Int32Array(cols * rows) };
  const disc = (x: number, z: number, r: number): void => {
    const c0 = Math.max(0, Math.floor((x - r - mask.x0) / CELL));
    const c1 = Math.min(cols - 1, Math.floor((x + r - mask.x0) / CELL));
    const r0 = Math.max(0, Math.floor((z - r - mask.z0) / CELL));
    const r1 = Math.min(rows - 1, Math.floor((z + r - mask.z0) / CELL));
    for (let rr = r0; rr <= r1; rr++) {
      for (let c = c0; c <= c1; c++) {
        // Nearest point of the cell to the centre within r: the cell is touched.
        const nx = Math.max(mask.x0 + c * CELL, Math.min(x, mask.x0 + (c + 1) * CELL));
        const nz = Math.max(mask.z0 + rr * CELL, Math.min(z, mask.z0 + (rr + 1) * CELL));
        if ((nx - x) ** 2 + (nz - z) ** 2 <= r * r) mask.bits[rr * cols + c] = 1;
      }
    }
  };
  for (const b of map.buildings ?? []) disc(b.pos[0], b.pos[1], Math.hypot(b.size[0], b.size[1]) / 2 + AROUND.building);
  for (const o of map.objects) {
    // Roads and painted ground are floor slabs: no detail needed over them.
    if (o.type === 'floor' && o.size[1] < 0.6) continue;
    disc(o.pos[0], o.pos[2], Math.hypot(o.size[0], o.size[2]) / 2 + AROUND.solid);
  }
  for (const p of map.props ?? []) disc(p.pos[0], p.pos[2], AROUND.solid);
  for (const z of map.zones ?? []) disc(z.pos[0], z.pos[2], z.radius + AROUND.zone);
  for (const s of map.spawns) disc(s.pos[0], s.pos[2], AROUND.spawn);
  // Patches: 4-connected groups of fine cells.
  let next = 0;
  const stack: number[] = [];
  for (let i = 0; i < mask.bits.length; i++) {
    if (!mask.bits[i] || mask.patch[i]) continue;
    mask.patch[i] = ++next;
    stack.push(i);
    while (stack.length) {
      const k = stack.pop()!;
      const c = k % cols;
      const r = (k - c) / cols;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (mask.bits[j] && !mask.patch[j]) {
          mask.patch[j] = next;
          stack.push(j);
        }
      }
    }
  }
  return mask;
}

/** Fine patch at (x, z): 0 = coarse ground. */
export function patchAt(mask: FineMask, x: number, z: number): number {
  const c = Math.floor((x - mask.x0) / mask.cell);
  const r = Math.floor((z - mask.z0) / mask.cell);
  if (c < 0 || r < 0 || c >= mask.cols || r >= mask.rows) return 0;
  return mask.patch[r * mask.cols + c]!;
}

/** Whether a point is within `pad` m of a fine cell (the fine mesh is built that far past the mask). */
export function nearFine(mask: FineMask, x: number, z: number, pad: number): boolean {
  const n = Math.ceil(pad / mask.cell);
  const c = Math.floor((x - mask.x0) / mask.cell);
  const r = Math.floor((z - mask.z0) / mask.cell);
  for (let rr = Math.max(0, r - n); rr <= Math.min(mask.rows - 1, r + n); rr++) {
    for (let cc = Math.max(0, c - n); cc <= Math.min(mask.cols - 1, c + n); cc++) if (mask.bits[rr * mask.cols + cc]) return true;
  }
  return false;
}

/** Share of the playable box that is fine (for the bake log). */
export function fineShare(mask: FineMask): number {
  let n = 0;
  for (const b of mask.bits) n += b;
  return n / mask.bits.length;
}

/** The mask grown by `pad` m (what the fine mesh is built over). */
export function dilated(mask: FineMask, pad: number): Uint8Array {
  const n = Math.ceil(pad / mask.cell);
  const { cols, rows, bits } = mask;
  // Separable max filter: along rows, then along columns.
  const tmp = new Uint8Array(bits.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!bits[r * cols + c]) continue;
      for (let k = Math.max(0, c - n); k <= Math.min(cols - 1, c + n); k++) tmp[r * cols + k] = 1;
    }
  }
  const out = new Uint8Array(bits.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!tmp[r * cols + c]) continue;
      for (let k = Math.max(0, r - n); k <= Math.min(rows - 1, r + n); k++) out[k * cols + c] = 1;
    }
  }
  return out;
}
