import * as THREE from 'three';
import type { MapObject, SurfaceMaterial } from './mapTypes';

/**
 * Shared pieces of the building generator (world/buildings.ts) and the style
 * details (world/buildingExtras.ts): dimensions, the building-space frame of
 * each outer wall, and small geometry helpers.
 */

export const WALL = 0.3;
export const SLAB = 0.25;
export const BAY = 3.2;
export const STAIR_W = 2.0;
/** Walls start this far below the ground so slopes never show a gap. */
export const PLINTH = 1;
/** Top of the ground-floor slab. */
export const GROUND_TOP = 0.2;
/** Stand this far inside the wall at a window (clear of the wall for the navmesh). */
export const WINDOW_STANDOFF = 0.75;
/** Snow lying on roofs (a visual layer, lighter than the ground snow in shade). */
export const ROOF_SNOW = '#f1f4f7';

/** Adds a box given its building-space centre / size (x right, z south, y up from the base). */
export type BoxFn = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, type?: MapObject['type'], col?: string, mat?: SurfaceMaterial, pitch?: number, roll?: number) => void;

export type SideId = 'n' | 's' | 'e' | 'w';

/**
 * One outer wall in building space: `u` runs along it from `origin` (on the
 * wall's centre line) in `dir`; `normal` points out of the building.
 */
export interface SideFrame {
  id: SideId;
  len: number;
  origin: [number, number];
  dir: [number, number];
  normal: [number, number];
}

/** A window opening in building space: sill height above the base. */
export interface Opening {
  width: number;
  height: number;
  sill: number;
}

/** A stairwell strip along local z against the east (open -1: rail on its west) or west wall. */
export interface Stair {
  x0: number;
  x1: number;
  open: -1 | 1;
  /** Ramps climb toward -z (1) or +z (-1); `top` is the z where they reach the floor above. */
  dir: 1 | -1;
  top: number;
  /** Strip's z range, landing to entry. */
  z0: number;
  z1: number;
}

/** What style details get to work with (building space, y up from the base). */
export interface Ctx {
  W: number;
  D: number;
  /** Top of the walls (roof slab underside). */
  H: number;
  floors: number;
  storey: number;
  solid: boolean;
  color: string;
  trim: string;
  material: SurfaceMaterial;
  rng: () => number;
  /** Collidable box. */
  box: BoxFn;
  /** Visual-only box. */
  deco: BoxFn;
  /** Snow layer (visual), null outside winter. */
  snow: BoxFn | null;
  sides: SideFrame[];
  doors: Set<string>;
  /** Ground-floor door per side: centre along the side (u) and size. */
  doorAt: Partial<Record<SideId, { u: number; width: number; height: number }>>;
  /** Window columns per side: centre along the side (u) and the opening on the first floor up (the ground floor of a one-storey building). */
  columns: Partial<Record<SideId, { u: number; o: Opening }[]>>;
  stairs: Stair[];
  /** Adds a visual-only mesh given in building space (non-indexed, with normals and UVs). */
  shape: (geo: THREE.BufferGeometry, mat: SurfaceMaterial, col: string) => void;
  /** Window firing spot: feet at building-space (lx, y, lz), looking out along (dx, dz). */
  spot: (lx: number, y: number, lz: number, dx: number, dz: number, o: Opening) => void;
}

export function sideFrames(W: number, D: number): SideFrame[] {
  return [
    { id: 'n', len: W, origin: [-W / 2, -D / 2 + WALL / 2], dir: [1, 0], normal: [0, -1] },
    { id: 's', len: W, origin: [W / 2, D / 2 - WALL / 2], dir: [-1, 0], normal: [0, 1] },
    { id: 'w', len: D - 2 * WALL, origin: [-W / 2 + WALL / 2, D / 2 - WALL], dir: [0, -1], normal: [-1, 0] },
    { id: 'e', len: D - 2 * WALL, origin: [W / 2 - WALL / 2, -D / 2 + WALL], dir: [0, 1], normal: [1, 0] },
  ];
}

/** Building-space (x, z) at `u` along a side, `off` out from its centre line. */
export function sidePoint(s: SideFrame, u: number, off: number): [number, number] {
  return [s.origin[0] + s.dir[0] * u + s.normal[0] * off, s.origin[1] + s.dir[1] * u + s.normal[1] * off];
}

/** A box along a side: from u0 for len, y0 for h, its centre `off` out from the wall centre line, `t` thick. */
export function sideBox(s: SideFrame, fn: BoxFn, u0: number, len: number, y0: number, h: number, off = 0, t = WALL, type: MapObject['type'] = 'wall', col?: string, mat?: SurfaceMaterial): void {
  const [x, z] = sidePoint(s, u0 + len / 2, off);
  const alongX = s.dir[0] !== 0;
  fn(x, y0 + h / 2, z, alongX ? len : t, h, alongX ? t : len, type, col, mat);
}

/**
 * Like sideBox but `u` counts along the whole outer face, corner to corner
 * (the e / w frames start inside the n / s walls), for trim that wraps round.
 */
export function faceBox(s: SideFrame, fn: BoxFn, u0: number, len: number, y0: number, h: number, out: number, t: number, col?: string, mat?: SurfaceMaterial, type: MapObject['type'] = 'prop'): void {
  const shift = s.id === 'e' || s.id === 'w' ? WALL : 0;
  sideBox(s, fn, u0 - shift, len, y0, h, WALL / 2 + out, t, type, col, mat);
}

/** Full length of a side's outer face. */
export function faceLen(s: SideFrame): number {
  return s.id === 'e' || s.id === 'w' ? s.len + 2 * WALL : s.len;
}

/** Sorted, touching / overlapping intervals merged. */
export function mergeSpans(spans: [number, number][]): [number, number][] {
  const s = spans.filter(([a, b]) => b - a > 1e-3).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-3) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return `#${c.getHexString()}`;
}

/** A profile (x, y) extruded `depth` along z, centred on z = 0 (non-indexed, UVs in metres). */
export function prismGeo(pts: [number, number][], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g.index ? g.toNonIndexed() : g;
}

/** A W x D block rising `h`, every side leaning in by `ins` (mansard, hipped cap), flat top; base at y = 0. */
export function frustumGeo(W: number, D: number, ins: number, h: number): THREE.BufferGeometry {
  const w = W / 2;
  const d = D / 2;
  const tw = w - ins;
  const td = d - ins;
  const b: [number, number, number][] = [
    [-w, 0, -d],
    [w, 0, -d],
    [w, 0, d],
    [-w, 0, d],
  ];
  const t: [number, number, number][] = [
    [-tw, h, -td],
    [tw, h, -td],
    [tw, h, td],
    [-tw, h, td],
  ];
  // Counter-clockwise seen from outside.
  const quads = [
    [b[1]!, b[0]!, t[0]!, t[1]!],
    [b[2]!, b[1]!, t[1]!, t[2]!],
    [b[3]!, b[2]!, t[2]!, t[3]!],
    [b[0]!, b[3]!, t[3]!, t[0]!],
    [t[0]!, t[3]!, t[2]!, t[1]!],
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  const a = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (const q of quads) {
    a.set(...q[0]!);
    e1.set(...q[1]!).sub(a);
    e2.set(...q[3]!).sub(a);
    n.crossVectors(e1, e2).normalize();
    // UVs in metres along the face's own axes.
    const ux = e1.clone().normalize();
    const uy = n.clone().cross(ux);
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = q[i]!;
      pos.push(...p);
      v.set(...p).sub(a);
      uv.push(v.dot(ux), v.dot(uy));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
