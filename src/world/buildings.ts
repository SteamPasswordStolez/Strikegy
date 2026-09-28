import * as THREE from 'three';
import { makeRng } from '@/render/noise';
import type { BuildingDef, BuildingStyle, MapObject, SurfaceMaterial } from './mapTypes';

/**
 * Turns a BuildingDef into blockout boxes: outer walls split into bays with
 * door / window openings, floor slabs with a stairwell opening and a ramp
 * between floors, and a roof. All boxes are in world space.
 */

interface StyleSpec {
  floors: number;
  /** Floor-to-floor height. */
  storey: number;
  material: SurfaceMaterial;
  colors: string[];
  /** Chance a bay gets a window. */
  windows: number;
  /** Door / window openings (width, height, sill). */
  door: [number, number];
  window: [number, number, number];
  roof: 'flat' | 'parapet' | 'pitched';
}

const STYLES: Record<BuildingStyle, StyleSpec> = {
  house: { floors: 2, storey: 3, material: 'brick', colors: ['#b9a58f', '#c9b9a0', '#a8836a', '#d2c7b2'], windows: 0.55, door: [1.1, 2.2], window: [1.1, 1.2, 1], roof: 'pitched' },
  shop: { floors: 2, storey: 3.3, material: 'concrete', colors: ['#c8c0b0', '#b7b1a3', '#d6ccb8'], windows: 0.7, door: [1.4, 2.3], window: [1.6, 1.5, 0.7], roof: 'parapet' },
  apartment: { floors: 3, storey: 3, material: 'concrete', colors: ['#bdb6a8', '#a9a397', '#c7bfae'], windows: 0.65, door: [1.2, 2.2], window: [1.2, 1.2, 1], roof: 'parapet' },
  townhall: { floors: 2, storey: 4, material: 'brick', colors: ['#b58e74', '#a67f67'], windows: 0.8, door: [2.2, 2.8], window: [1.3, 2, 0.9], roof: 'parapet' },
  warehouse: { floors: 1, storey: 6.5, material: 'metal', colors: ['#8e9296', '#7f8a7a', '#9b8f7a'], windows: 0.15, door: [4, 4], window: [2, 1, 3.8], roof: 'flat' },
  barracks: { floors: 1, storey: 3.4, material: 'wood', colors: ['#7a7a60', '#6f735a'], windows: 0.75, door: [1.2, 2.2], window: [1.1, 1.1, 1], roof: 'pitched' },
  hangar: { floors: 1, storey: 9, material: 'metal', colors: ['#6d7266', '#767a70'], windows: 0.1, door: [11, 7], window: [2, 1, 5.5], roof: 'flat' },
  hq: { floors: 2, storey: 3.4, material: 'concrete', colors: ['#8d9078', '#9a9a86'], windows: 0.5, door: [1.6, 2.3], window: [1.2, 1, 1.1], roof: 'parapet' },
  station: { floors: 1, storey: 4.5, material: 'brick', colors: ['#a4735a', '#b08268'], windows: 0.6, door: [1.8, 2.8], window: [1.3, 1.8, 1], roof: 'pitched' },
  shed: { floors: 1, storey: 3, material: 'wood', colors: ['#7b6246', '#6d5a44'], windows: 0.3, door: [1.4, 2.2], window: [0.9, 0.8, 1.2], roof: 'pitched' },
  // Tall timber barn: wide cart doors, a few high windows.
  barn: { floors: 1, storey: 6.5, material: 'wood', colors: ['#7a3b2e', '#6e3328', '#5f4a38'], windows: 0.25, door: [4, 4.4], window: [1, 1, 4.4], roof: 'pitched' },
  // Stone nave: high narrow windows, a tall door (the steeple is a separate model).
  chapel: { floors: 1, storey: 6, material: 'brick', colors: ['#9a9184', '#8f887c', '#a39a8c'], windows: 0.75, door: [1.8, 3.2], window: [1.1, 2.6, 1.8], roof: 'pitched' },
};

const WALL = 0.3;
const SLAB = 0.25;
const BAY = 3.2;
const STAIR_W = 1.3;
/** Stair ramp pitch; below the navmesh walkable slope (45°) and the KCC climb limit (50°). */
const STAIR_DEG = 34;
/** Walls start this far below the ground so slopes never show a gap. */
const PLINTH = 1;

/** A place to fight from inside a building: standing at a window, looking out along `facing`. */
export interface WindowSpot {
  /** Feet position (world). */
  pos: [number, number, number];
  /** Unit direction out of the window (world xz). */
  facing: [number, number];
}

export interface BuiltBuilding {
  objects: MapObject[];
  /** Height of the roof top above the base. */
  height: number;
  /** Windows low enough to shoot out of, one spot each. */
  windows: WindowSpot[];
  /** Visual-only boxes (facades of closed blocks): no colliders. */
  decor: MapObject[];
}

/** Stand this far inside the wall at a window (clear of the wall for the navmesh). */
const WINDOW_STANDOFF = 0.75;
/** A window is a firing spot when its sill is below a standing soldier's eyes. */
const MAX_SILL = 1.3;

/** Radius of the level pad the terrain should provide under a building. */
export function buildingPadRadius(b: BuildingDef): number {
  return Math.hypot(b.size[0], b.size[1]) / 2 + 1;
}

export interface BuildOptions {
  /** Winter: snow lies on the roofs (visual only). */
  snow?: boolean;
}

export function buildBuilding(b: BuildingDef, baseY: number, opts: BuildOptions = {}): BuiltBuilding {
  const spec = STYLES[b.style ?? 'house'];
  const rng = makeRng(b.seed ?? Math.round(b.pos[0] * 73 + b.pos[1] * 131));
  const [W, D] = b.size;
  const material = b.material ?? spec.material;
  const color = b.color ?? spec.colors[Math.floor(rng() * spec.colors.length)]!;
  const trim = shade(color, 0.78);
  // Stairs need room; small or solid buildings stay single-storey / closed.
  const runLen = spec.storey / Math.tan((STAIR_DEG * Math.PI) / 180);
  const canStack = D - 2 * WALL >= runLen + 2.2 && W - 2 * WALL >= STAIR_W + 2;
  const floors = b.solid ? (b.floors ?? spec.floors) : canStack ? (b.floors ?? spec.floors) : 1;
  const H = floors * spec.storey;
  const yaw = ((b.rot ?? 0) * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const out: MapObject[] = [];
  const windows: WindowSpot[] = [];
  /** Local (x, z) + direction -> world spot at local floor height y. */
  const spot = (lx: number, y: number, lz: number, dx: number, dz: number) => {
    windows.push({
      pos: [b.pos[0] + lx * cos + lz * sin, baseY + y, b.pos[1] - lx * sin + lz * cos],
      facing: [dx * cos + dz * sin, -dx * sin + dz * cos],
    });
  };
  /** Adds a box given its local center/size (x right, z toward the viewer = south). */
  const box = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, type: MapObject['type'] = 'wall', col = color, mat = material, pitch = 0, roll = 0) => {
    if (sx <= 0.01 || sy <= 0.01 || sz <= 0.01) return;
    // Local -> world: rotate about Y by yaw (same convention as Object3D.rotation.y).
    const x = b.pos[0] + lx * cos + lz * sin;
    const z = b.pos[1] - lx * sin + lz * cos;
    const rot: [number, number, number] = [0, (b.rot ?? 0), 0];
    if (pitch !== 0 || roll !== 0) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
      const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
      rot[0] = THREE.MathUtils.radToDeg(e.x);
      rot[1] = THREE.MathUtils.radToDeg(e.y);
      rot[2] = THREE.MathUtils.radToDeg(e.z);
    }
    out.push({ type, pos: [x, baseY + ly, z], size: [sx, sy, sz], rot, material: mat, color: col });
  };
  // Visual-only boxes (no colliders): facades of closed blocks, snow on roofs.
  const decor: MapObject[] = [];
  const decoBox: BoxFn = (lx, ly, lz, sx, sy, sz, type = 'prop', col = color, mat = material, pitch = 0, roll = 0) => {
    const n = out.length;
    box(lx, ly, lz, sx, sy, sz, type, col, mat, pitch, roll);
    if (out.length > n) decor.push(out.pop()!);
  };
  const snow = opts.snow ? decoBox : null;

  if (b.solid) {
    box(0, (H - PLINTH) / 2, 0, W, H + PLINTH, D);
    roof(spec, W, D, H, box, trim, snow);
    // A closed block still looks lived in: windows, sills and a door on its walls.
    const deco = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, col: string, mat: SurfaceMaterial) =>
      decoBox(lx, ly, lz, sx, sy, sz, 'prop', col, mat);
    const doorSides = new Set((b.doors ?? 's').split(''));
    const faces = [
      { id: 'n', len: W, at: (u: number, y: number, out_: number, sx: number, sy: number, sz: number, col: string, mat: SurfaceMaterial) => deco(-W / 2 + u, y, -D / 2 - out_, sx, sy, sz, col, mat) },
      { id: 's', len: W, at: (u: number, y: number, out_: number, sx: number, sy: number, sz: number, col: string, mat: SurfaceMaterial) => deco(W / 2 - u, y, D / 2 + out_, sx, sy, sz, col, mat) },
      { id: 'w', len: D, at: (u: number, y: number, out_: number, sx: number, sy: number, sz: number, col: string, mat: SurfaceMaterial) => deco(-W / 2 - out_, y, D / 2 - u, sz, sy, sx, col, mat) },
      { id: 'e', len: D, at: (u: number, y: number, out_: number, sx: number, sy: number, sz: number, col: string, mat: SurfaceMaterial) => deco(W / 2 + out_, y, -D / 2 + u, sz, sy, sx, col, mat) },
    ];
    for (const f of faces) {
      const bays = Math.max(1, Math.round(f.len / BAY));
      const bw = f.len / bays;
      const doorBay = Math.floor(bays / 2);
      for (let fl = 0; fl < floors; fl++) {
        const y0 = fl * spec.storey;
        for (let i = 0; i < bays; i++) {
          const u = (i + 0.5) * bw;
          if (fl === 0 && i === doorBay && doorSides.has(f.id)) {
            const [dw, dh] = spec.door;
            f.at(u, dh / 2, 0.04, Math.min(dw, bw - 0.4), dh, 0.08, '#4a3a2c', 'wood');
            f.at(u, dh + 0.08, 0.08, Math.min(dw, bw - 0.4) + 0.3, 0.16, 0.16, trim, 'concrete');
          } else if (rng() < spec.windows) {
            const [ww, wh, sill] = spec.window;
            const w = Math.min(ww, bw - 0.6);
            f.at(u, y0 + sill + wh / 2, 0.03, w, wh, 0.06, '#1f2529', 'metal');
            f.at(u, y0 + sill - 0.04, 0.08, w + 0.2, 0.08, 0.16, trim, 'concrete');
          }
        }
      }
    }
    return { objects: out, height: H + 1.5, windows, decor };
  }

  const doors = new Set((b.doors ?? 's').split(''));
  // Walls: n/s run the full width, e/w fit between them.
  const s = WINDOW_STANDOFF;
  const sides: {
    id: string;
    len: number;
    place: (a: number, len: number, y: number, h: number) => void;
    /** Firing spot for an opening centred at `a` along the wall, on the floor at y. */
    window: ((a: number, y: number) => void) | null;
  }[] = [
    {
      id: 'n',
      len: W,
      place: (a, len, y, h) => box(-W / 2 + a + len / 2, y + h / 2, -D / 2 + WALL / 2, len, h, WALL),
      window: (a, y) => spot(-W / 2 + a, y, -D / 2 + WALL + s, 0, -1),
    },
    {
      id: 's',
      len: W,
      place: (a, len, y, h) => box(W / 2 - a - len / 2, y + h / 2, D / 2 - WALL / 2, len, h, WALL),
      window: (a, y) => spot(W / 2 - a, y, D / 2 - WALL - s, 0, 1),
    },
    {
      id: 'w',
      len: D - 2 * WALL,
      place: (a, len, y, h) => box(-W / 2 + WALL / 2, y + h / 2, D / 2 - WALL - a - len / 2, WALL, h, len),
      window: (a, y) => spot(-W / 2 + WALL + s, y, D / 2 - WALL - a, -1, 0),
    },
    // The stairwell runs along the east wall: no standing at its windows.
    { id: 'e', len: D - 2 * WALL, place: (a, len, y, h) => box(W / 2 - WALL / 2, y + h / 2, -D / 2 + WALL + a + len / 2, WALL, h, len), window: null },
  ];
  for (const side of sides) {
    const bays = Math.max(1, Math.round(side.len / BAY));
    const bw = side.len / bays;
    const doorBay = Math.floor(bays / 2);
    for (let f = 0; f < floors; f++) {
      const y0 = f * spec.storey;
      // Ground floor walls reach down into the ground.
      const bottom = f === 0 ? -PLINTH : y0;
      const top = y0 + spec.storey;
      for (let i = 0; i < bays; i++) {
        const a = i * bw;
        let open: [number, number, number] | null = null; // width, height, sill
        if (f === 0 && i === doorBay && doors.has(side.id)) open = [Math.min(spec.door[0], bw - 0.4), spec.door[1], 0];
        else if (rng() < spec.windows) open = [Math.min(spec.window[0], bw - 0.6), spec.window[1], spec.window[2]];
        if (!open) {
          side.place(a, bw, bottom, top - bottom);
          continue;
        }
        const [ow, oh, sill] = open;
        const pier = (bw - ow) / 2;
        if (sill > 0 && sill <= MAX_SILL && side.window) side.window(a + pier + ow / 2, y0 + (f === 0 ? 0.2 : 0));
        side.place(a, pier, bottom, top - bottom);
        side.place(a + pier + ow, pier, bottom, top - bottom);
        if (sill > 0) side.place(a + pier, ow, bottom, y0 + sill - bottom);
        const lintel = y0 + sill + oh;
        if (lintel < top) side.place(a + pier, ow, lintel, top - lintel);
      }
    }
  }

  // Floors. The stairwell runs along the east wall toward -z on every floor.
  const ix = W - 2 * WALL;
  const iz = D - 2 * WALL;
  box(0, 0.05, 0, ix, 0.3, iz, 'floor', trim, 'concrete_floor');
  const stairX = W / 2 - WALL - STAIR_W / 2;
  const holeZ0 = -D / 2 + WALL + 0.4; // top of the ramp (north)
  const holeZ1 = holeZ0 + runLen + 0.6;
  for (let f = 1; f < floors; f++) {
    const y = f * spec.storey - SLAB / 2;
    // Slab around the stair hole: west part full depth, east strip split around the hole.
    const westW = ix - STAIR_W;
    box(-W / 2 + WALL + westW / 2, y, 0, westW, SLAB, iz, 'floor', trim, 'concrete_floor');
    box(stairX, y, (holeZ1 + D / 2 - WALL) / 2, STAIR_W, SLAB, D / 2 - WALL - holeZ1, 'floor', trim, 'concrete_floor');
    box(stairX, y, (-D / 2 + WALL + holeZ0) / 2, STAIR_W, SLAB, holeZ0 + D / 2 - WALL, 'floor', trim, 'concrete_floor');
    // Ramp from floor f-1 (south end) up to floor f (north end).
    const rise = spec.storey;
    const slope = Math.hypot(rise, runLen);
    const cy = (f - 1) * spec.storey + rise / 2;
    const cz = holeZ0 + runLen / 2;
    box(stairX, cy, cz, STAIR_W, 0.2, slope, 'ramp', trim, 'concrete', Math.atan2(rise, runLen));
    // Rail on the open side of the stairwell.
    box(stairX - STAIR_W / 2 - 0.05, f * spec.storey + 0.5, (holeZ0 + holeZ1) / 2, 0.08, 1, holeZ1 - holeZ0, 'cover', trim, 'metal');
  }
  roof(spec, W, D, H, box, trim, snow);
  return { objects: out, height: H + (spec.roof === 'pitched' ? Math.min(W, D) * 0.3 : 1), windows, decor };
}

type BoxFn = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, type?: MapObject['type'], col?: string, mat?: SurfaceMaterial, pitch?: number, roll?: number) => void;

/** Snow lying on roofs (a visual layer, lighter than the ground snow in shade). */
const ROOF_SNOW = '#f1f4f7';

function roof(spec: StyleSpec, W: number, D: number, H: number, box: BoxFn, trim: string, snow: BoxFn | null): void {
  box(0, H + SLAB / 2 - 0.05, 0, W, SLAB, D, 'floor', trim, 'concrete');
  if (snow && spec.roof !== 'pitched') snow(0, H + SLAB + 0.02, 0, W - (spec.roof === 'parapet' ? 0.7 : 0.1), 0.12, D - (spec.roof === 'parapet' ? 0.7 : 0.1), 'prop', ROOF_SNOW, 'snow');
  if (spec.roof === 'parapet') {
    const p = 0.9;
    box(0, H + p / 2, -D / 2 + 0.15, W, p, 0.3, 'wall', trim);
    box(0, H + p / 2, D / 2 - 0.15, W, p, 0.3, 'wall', trim);
    box(-W / 2 + 0.15, H + p / 2, 0, 0.3, p, D - 0.6, 'wall', trim);
    box(W / 2 - 0.15, H + p / 2, 0, 0.3, p, D - 0.6, 'wall', trim);
  } else if (spec.roof === 'pitched') {
    // Two slabs meeting at a ridge along the long axis (local x if wider).
    const alongX = W >= D;
    const span = (alongX ? D : W) / 2 + 0.3;
    const rise = span * 0.6;
    const slant = Math.hypot(span, rise);
    const pitch = Math.atan2(rise, span);
    const len = (alongX ? W : D) + 0.4;
    const roofCol = '#6b4a3a';
    // Each half slopes down toward its eave.
    if (alongX) {
      box(0, H + rise / 2, -span / 2, len, 0.2, slant, 'floor', roofCol, 'wood', -pitch);
      box(0, H + rise / 2, span / 2, len, 0.2, slant, 'floor', roofCol, 'wood', pitch);
    } else {
      box(-span / 2, H + rise / 2, 0, slant, 0.2, len, 'floor', roofCol, 'wood', 0, pitch);
      box(span / 2, H + rise / 2, 0, slant, 0.2, len, 'floor', roofCol, 'wood', 0, -pitch);
    }
    if (snow) {
      // A blanket on each half, just above the tiles, stopping short of the eaves.
      const up = 0.15 / Math.cos(pitch);
      if (alongX) {
        snow(0, H + rise / 2 + up, -span / 2 + 0.05, len - 0.1, 0.12, slant * 0.94, 'prop', ROOF_SNOW, 'snow', -pitch);
        snow(0, H + rise / 2 + up, span / 2 - 0.05, len - 0.1, 0.12, slant * 0.94, 'prop', ROOF_SNOW, 'snow', pitch);
      } else {
        snow(-span / 2 + 0.05, H + rise / 2 + up, 0, slant * 0.94, 0.12, len - 0.1, 'prop', ROOF_SNOW, 'snow', 0, pitch);
        snow(span / 2 - 0.05, H + rise / 2 + up, 0, slant * 0.94, 0.12, len - 0.1, 'prop', ROOF_SNOW, 'snow', 0, -pitch);
      }
    }
  }
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return `#${c.getHexString()}`;
}
