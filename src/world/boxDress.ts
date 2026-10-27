import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapObject, SurfaceMaterial } from './mapTypes';

/**
 * Plain map boxes, dressed (owner, 2026-10-26: the sharp boxes made the maps
 * look like a cheap blocky game; docs/design/props-rework.md stage 1). Every
 * map object without a kit used to be drawn as a sharp `BoxGeometry`; now its
 * look is picked from its material, size and type — chamfered concrete with
 * chipped edges, brick walls with a broken top line, round lumpy hedges,
 * eroded adobe, lumpy rock cores (scanned rocks cover them, `rockDressing`),
 * pipes as cylinders, rails with a rail's section — and the plain box stays as
 * the far look (`buildBlockout`'s cells switch past KIT_FAR). Colliders, the
 * navmesh and the server never see any of this: the box is still the box.
 */

export interface SoftBoxOptions {
  /** Edge radius (m), clamped to fit the box. */
  r: number;
  /** Extra rows across each bevel: 0 = one chamfer facet, more = rounder. */
  bevelRows?: number;
  /** Spacing (m) of rows across the faces (for displacement); 0 = only the bevel rows. */
  grid?: number;
  /** Which axes get the `grid` rows (x, y, z; default all). */
  gridAxes?: [boolean, boolean, boolean];
  /** Push along the surface normal (m) at a local point; `edge` 0..1 = how close to an edge. */
  displace?: (x: number, y: number, z: number, edge: number, top: boolean) => number;
  /** Leave the bottom face out (it sits in the ground). */
  skipBottom?: boolean;
  /** Extra rows (local coordinates) per axis x, y, z, where the shape bends. */
  extraRows?: [number[], number[], number[]];
}

/** Rows along one axis: the bevel rows at each end, then interior rows `grid` apart. */
function rows(half: number, r: number, bevel: number, grid: number): number[] {
  const out = [-half];
  for (let k = 1; k <= bevel; k++) out.push(-half + r * (1 - Math.cos(((k / (bevel + 1)) * Math.PI) / 2)));
  const a = -half + r;
  const b = half - r;
  if (b > a + 1e-4) {
    out.push(a);
    if (grid > 0) {
      const n = Math.floor((b - a) / grid);
      for (let k = 1; k < n; k++) out.push(a + ((b - a) * k) / n);
    }
    out.push(b);
  } else out.push(0);
  for (let k = bevel; k >= 1; k--) out.push(half - r * (1 - Math.cos(((k / (bevel + 1)) * Math.PI) / 2)));
  out.push(half);
  return out;
}

/**
 * A box with rounded / chamfered edges, optionally subdivided and displaced,
 * centred on the origin; UVs in metres across each face (like
 * `worldScaleBoxUVs`), so the surfaces keep their scale.
 */
export function softBox(w: number, h: number, d: number, o: SoftBoxOptions): THREE.BufferGeometry {
  const half = [w / 2, h / 2, d / 2];
  const r = Math.max(0.002, Math.min(o.r, half[0]! * 0.48, half[1]! * 0.48, half[2]! * 0.48));
  const bevel = o.bevelRows ?? 0;
  const grid = o.grid ?? 0;
  const axisRows = half.map((hh, i) => {
    const rs = rows(hh, r, bevel, o.gridAxes && !o.gridAxes[i] ? 0 : grid);
    for (const x of o.extraRows?.[i] ?? []) if (x > -hh + r && x < hh - r && !rs.some((y) => Math.abs(y - x) < 1e-3)) rs.push(x);
    return rs.sort((a, b) => a - b);
  });
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const n = new THREE.Vector3();
  // Faces: normal axis, sign; tangent axes (u, v) with v up on the sides.
  const faces: [number, number, number, number][] = [
    [0, 1, 2, 1],
    [0, -1, 2, 1],
    [1, 1, 0, 2],
    [1, -1, 0, 2],
    [2, 1, 0, 1],
    [2, -1, 0, 1],
  ];
  for (const [ax, sign, ua, va] of faces) {
    if (o.skipBottom && ax === 1 && sign < 0) continue;
    const ur = axisRows[ua]!;
    const vr = axisRows[va]!;
    const base = pos.length / 3;
    for (let j = 0; j < vr.length; j++) {
      for (let i = 0; i < ur.length; i++) {
        p.set(0, 0, 0);
        p.setComponent(ax, sign * half[ax]!);
        p.setComponent(ua, ur[i]!);
        p.setComponent(va, vr[j]!);
        // Round: the point on the inner box, pushed out r along the way to p.
        q.set(
          Math.max(-half[0]! + r, Math.min(half[0]! - r, p.x)),
          Math.max(-half[1]! + r, Math.min(half[1]! - r, p.y)),
          Math.max(-half[2]! + r, Math.min(half[2]! - r, p.z)),
        );
        n.subVectors(p, q);
        const len = n.length();
        if (len > 1e-6) n.divideScalar(len);
        else n.set(0, 0, 0).setComponent(ax, sign);
        const at = q.clone().addScaledVector(n, r);
        if (o.displace) {
          const eu = 1 - Math.min(1, (half[ua]! - Math.abs(ur[i]!)) / Math.max(r * 3, 0.05));
          const ev = 1 - Math.min(1, (half[va]! - Math.abs(vr[j]!)) / Math.max(r * 3, 0.05));
          const top = ax === 1 ? sign > 0 : va === 1 && vr[j]! > half[1]! - r - 1e-4;
          at.addScaledVector(n, o.displace(at.x, at.y, at.z, Math.max(eu, ev), top));
        }
        pos.push(at.x, at.y, at.z);
        uv.push(ur[i]! + half[ua]!, vr[j]! + half[va]!);
      }
    }
    // Outward winding: (u x v) along the face normal or flipped.
    const flip = (ua === (ax + 1) % 3 ? 1 : -1) * sign < 0;
    const W = ur.length;
    for (let j = 0; j < vr.length - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const a = base + j * W + i;
        const b = a + 1;
        const c = a + W;
        const e = c + 1;
        if (flip) idx.push(a, c, b, b, c, e);
        else idx.push(a, b, c, b, e, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Smooth 3D value noise in [-1, 1]. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(xf);
  const v = s(yf);
  const w = s(zf);
  const h = (a: number, b: number, c: number) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const x0 = l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v);
  const x1 = l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v);
  return l(x0, x1, w) * 2 - 1;
}

/** What a plain box is drawn as. */
export type DressKind = 'slab' | 'lowwall' | 'concrete' | 'masonry' | 'adobe' | 'hedge' | 'rock' | 'wood' | 'pipe' | 'rail' | 'metal';

/** Picks a box's look from its type, material and shape (null: kept a plain box). */
export function dressKind(obj: MapObject, kind: SurfaceMaterial): DressKind | null {
  const [w, h, d] = obj.size;
  const long = Math.max(w, d);
  const thin = Math.min(w, d);
  if (obj.type === 'ramp') return null;
  // Floors: roads and plazas sunk into the ground, their edges hardly show; raised pads (0.5 m+) get soft edges.
  if (obj.type === 'floor') return h >= 0.5 && h <= 1.2 ? 'slab' : null;
  switch (kind) {
    case 'metal':
      // Long and about square across: pipes; thin flat strips along the ground: rails.
      if (h <= 0.3 && thin <= 0.2 && long > 1) return 'rail';
      if (long > 2.5 * Math.max(thin, h) && Math.abs(thin - h) < 0.35 * Math.max(thin, h) && Math.max(thin, h) <= 1.2) return 'pipe';
      return 'metal';
    case 'concrete':
      // Low walls (cover along streets and fields): precast blocks in a row.
      if ((obj.type === 'cover' || obj.type === 'wall') && thin >= 0.3 && thin <= 0.9 && h >= 0.8 && h <= 1.8 && long >= 1.2) return 'lowwall';
      return 'concrete';
    case 'brick':
    case 'plaster':
      return 'masonry';
    case 'sand':
      return 'adobe';
    case 'grass':
      return 'hedge';
    case 'rock':
      return 'rock';
    case 'wood':
      return 'wood';
    default:
      return null;
  }
}

/**
 * The dressed look of a box (local, centred; the caller places it): see
 * `dressKind`. `seed` varies the noise between boxes (their position).
 */
export function dressGeometry(kind: DressKind, size: [number, number, number], seed: number): THREE.BufferGeometry {
  const [w, h, d] = size;
  const o = seed * 13.37;
  const along = w >= d ? 0 : 2;
  switch (kind) {
    case 'slab':
      // Roads, pavements, plazas: soft top edges instead of a cut slab edge.
      return softBox(w, h, d, { r: Math.min(0.06, h * 0.45), skipBottom: true });
    case 'lowwall':
      return lowWall(w, h, d, seed);
    case 'concrete':
      // Chamfered edges.
      return softBox(w, h, d, { r: 0.035, skipBottom: true });
    case 'masonry':
      // A slight chamfer, the top line broken in places (long garden / yard walls).
      return softBox(w, h, d, {
        r: 0.02,
        grid: 0.7,
        gridAxes: [along === 0, false, along === 2],
        skipBottom: true,
        displace: (x, y, z, edge, top) => {
          let k = edge > 0.6 ? -0.01 * Math.max(0, noise3(x * 4 + o, y * 4, z * 4)) : 0;
          if (top && h < 4 && h > 0.8) k -= 0.09 * Math.max(0, noise3((along ? z : x) * 0.7 + o, 0, 0) - 0.15);
          return k;
        },
      });
    case 'adobe':
      // Mud walls: round edges, the face waving, the top worn down unevenly.
      return softBox(w, h, d, {
        r: Math.min(0.1, Math.min(w, d) * 0.3),
        grid: 1.2,
        gridAxes: [along === 0, false, along === 2],
        skipBottom: true,
        displace: (x, y, z, edge, top) => 0.018 * noise3(x * 1.3 + o, y * 1.3, z * 1.3) - (top ? 0.07 * Math.max(0, noise3(x * 0.8 + o, 7, z * 0.8)) : 0) - 0.012 * edge,
      });
    case 'hedge':
      // Hedges: round lumpy masses.
      return softBox(w, h, d, {
        r: Math.min(0.32, Math.min(w, h, d) * 0.42),
        bevelRows: 1,
        grid: 0.7,
        gridAxes: [along === 0, false, along === 2],
        skipBottom: true,
        displace: (x, y, z, _edge, top) => 0.1 * noise3(x * 1.3 + o, y * 1.3, z * 1.3) + 0.045 * noise3(x * 3.7 + o, y * 3.7, z * 3.7) + (top ? 0.06 * noise3(x * 0.9 + o, 3, z * 0.9) : 0),
      });
    case 'rock':
      // A lumpy rock core (scanned rocks are set over it; this shows in their gaps).
      return softBox(w, h, d, {
        r: Math.min(0.25, Math.min(w, h, d) * 0.35),
        bevelRows: 1,
        grid: 0.6,
        skipBottom: true,
        displace: (x, y, z) => 0.1 * noise3(x * 0.9 + o, y * 0.9, z * 0.9) + 0.035 * noise3(x * 3 + o, y * 3, z * 3),
      });
    case 'wood':
      return softBox(w, h, d, { r: 0.012, skipBottom: false });
    case 'metal':
      return softBox(w, h, d, { r: 0.012 });
    case 'pipe': {
      const len = Math.max(w, d);
      const rad = Math.min(along ? w : d, h) / 2;
      const g = new THREE.CylinderGeometry(rad, rad, len, 14, 1, false);
      g.rotateZ(Math.PI / 2);
      if (along) g.rotateY(Math.PI / 2);
      return uvMetres(g, len, rad * Math.PI * 2);
    }
    case 'rail': {
      // A rail's section (foot, web, head) along the strip.
      const len = Math.max(w, d);
      const H = h;
      const W = Math.min(w, d);
      const shape = new THREE.Shape();
      const hw = W / 2;
      const pts: [number, number][] = [
        [-hw, -H / 2], [hw, -H / 2], [hw, -H / 2 + H * 0.12], [hw * 0.22, -H / 2 + H * 0.22],
        [hw * 0.22, H / 2 - H * 0.32], [hw * 0.55, H / 2 - H * 0.26], [hw * 0.55, H / 2], [-hw * 0.55, H / 2],
        [-hw * 0.55, H / 2 - H * 0.26], [-hw * 0.22, H / 2 - H * 0.32], [-hw * 0.22, -H / 2 + H * 0.22], [-hw, -H / 2 + H * 0.12],
      ];
      shape.moveTo(...pts[0]!);
      for (const pt of pts.slice(1)) shape.lineTo(...pt);
      const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
      g.translate(0, 0, -len / 2);
      if (!along) g.rotateY(Math.PI / 2);
      g.deleteAttribute('uv');
      // Indexed like every other dressed shape (geometries merge per batch).
      const flat = uvMetres(g, len, H);
      flat.setIndex(Array.from({ length: flat.getAttribute('position').count }, (_, i) => i));
      return flat;
    }
  }
}

/**
 * A low concrete wall as a row of precast blocks about 2 m long: a foot as
 * wide as the box, faces leaning in a little above it (2.5 cm at the top),
 * chamfered edges, chipped corners, each block set a touch off its
 * neighbours and cast with its own texture offset; thin seams between them.
 * Everything stays inside the box (it is the collider).
 */
function lowWall(w: number, h: number, d: number, seed: number): THREE.BufferGeometry {
  const alongX = w >= d;
  const L = alongX ? w : d;
  const T = alongX ? d : w;
  const n = Math.max(1, Math.round(L / 2));
  const gap = n > 1 ? 0.014 : 0;
  const seg = (L - gap * (n - 1)) / n;
  const foot = -h / 2 + Math.min(0.16, h * 0.13);
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const r = (k: number) => (noise3(seed * 31 + i * 1.7, k * 3.1, 0.5) + 1) / 2;
    // Blocks lean in from the foot; the leaning faces stay inside the box after the jitter below.
    const g = softBox(seg, h, T, { r: 0.028, skipBottom: true, extraRows: [[], [foot, foot + 0.025], []] });
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const du = r(1) * 4;
    const dv = r(2) * 4;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const y = pos.getY(k);
      let z = pos.getZ(k);
      const inset = y <= foot ? 0 : y <= foot + 0.025 ? 0.008 * ((y - foot) / 0.025) : 0.008 + 0.017 * ((y - foot - 0.025) / (h / 2 - foot - 0.025));
      z *= Math.max(0.5, (T / 2 - 0.006 - inset) / (T / 2));
      // Chipped corners: the block's vertical and top edges knocked in a little at its ends.
      const end = Math.abs(x) > seg / 2 - 0.05;
      const edge = Math.abs(z) > T / 2 - 0.06;
      let y2 = y;
      if (end && edge) {
        const c = Math.max(0, noise3(x * 6 + seed * 9 + i, y * 6, z * 6)) * 0.025;
        z -= Math.sign(z) * c;
        if (y > h / 2 - 0.05) y2 -= c;
      }
      pos.setXYZ(k, x, y2, z);
      uv.setXY(k, uv.getX(k) + du, uv.getY(k) + dv);
    }
    g.computeVertexNormals();
    // Each block a touch off line: turned up to 0.4 deg, shifted up to 6 mm across, sunk up to 8 mm.
    const yaw = (r(3) - 0.5) * 0.014;
    const shift = (r(4) - 0.5) * 0.012;
    m.makeRotationY(yaw).setPosition(-L / 2 + seg / 2 + i * (seg + gap), -r(5) * 0.008, shift);
    g.applyMatrix4(m);
    if (!alongX) g.rotateY(Math.PI / 2);
    parts.push(g);
  }
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return merged ?? softBox(w, h, d, { r: 0.035, skipBottom: true });
}

/** UVs from positions (box projection in metres) for shapes that don't carry fitting ones. */
function uvMetres(g: THREE.BufferGeometry, _a: number, _b: number): THREE.BufferGeometry {
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    const az = Math.abs(nrm.getZ(i));
    const [u, v] = ax >= ay && ax >= az ? [pos.getZ(i), pos.getY(i)] : ay >= az ? [pos.getX(i), pos.getZ(i)] : [pos.getX(i), pos.getY(i)];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
