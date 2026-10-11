import * as THREE from 'three';

/**
 * Procedural models for map objects that used to be plain boxes: vehicles,
 * containers, tanks, tents, sandbags, towers and street furniture. Each kit
 * fills the object's box (w x h x d, x = width, z = length, y up from the
 * ground at `base` above the box bottom) and says which surface each piece
 * uses. Colliders stay simple boxes: the object's own box unless a kit gives
 * its own (open structures you can shoot through).
 */
export type ModelKind =
  | 'car'
  | 'truck'
  | 'container'
  | 'boxcar'
  | 'fuelTank'
  | 'tent'
  | 'sandbags'
  | 'hesco'
  | 'watchtower'
  | 'booth'
  | 'pump'
  | 'fountain'
  | 'statue'
  | 'bench'
  | 'logPile'
  | 'hayBale'
  | 'bunker'
  | 'fence'
  | 'steeple'
  | 'sawShed'
  | 'archBridge'
  | 'trussBridge'
  | 'bus'
  | 'fuelCanopy'
  | 'waterTower'
  | 'tankWreck'
  | 'millWheel'
  | 'cart'
  | 'silo'
  | 'stall'
  | 'crane';

export const MODEL_KINDS: readonly ModelKind[] = [
  'car',
  'truck',
  'container',
  'boxcar',
  'fuelTank',
  'tent',
  'sandbags',
  'hesco',
  'watchtower',
  'booth',
  'pump',
  'fountain',
  'statue',
  'bench',
  'logPile',
  'hayBale',
  'bunker',
  'fence',
  'steeple',
  'sawShed',
  'archBridge',
  'trussBridge',
  'bus',
  'fuelCanopy',
  'waterTower',
  'tankWreck',
  'millWheel',
  'cart',
  'silo',
  'stall',
  'crane',
];

/** Surface of a piece: the object's own tinted material, or a shared one. */
export type KitMaterial = 'body' | 'trim' | 'metal' | 'dark' | 'glass' | 'rubber' | 'wood' | 'canvas' | 'concrete' | 'light' | 'redLight' | 'water' | 'dirt' | 'mesh' | 'snow' | 'paint' | 'bronze' | 'straw';

export interface KitPiece {
  geo: THREE.BufferGeometry;
  mat: KitMaterial;
  /** Own colour for surface pieces (paint, canvas...), instead of the object's. */
  tint?: string;
}

export interface KitBox {
  /** Local centre (y from the ground) and full size. */
  center: [number, number, number];
  size: [number, number, number];
  /** Radians about +Y. */
  yaw?: number;
}

export interface KitModel {
  pieces: KitPiece[];
  /** Replaces the object's box collider when given. */
  colliders?: KitBox[];
}

type V3 = [number, number, number];

/** Chamfered kit boxes: boxes with no side under `minSize` (m) get bevels of `share` of their thinnest side, at most `max`. */
const BEVEL = { minSize: 0.08, share: 0.12, max: 0.035 };

/**
 * A w x h x d box centred on the origin with its 12 edges cut at 45° (`c` deep):
 * 6 faces, 12 edge strips and 8 corner triangles (44 triangles), flat normals,
 * non-indexed. UVs in meters, projected along each face's main axis like the
 * plain boxes'.
 */
function chamferedBox(w: number, h: number, d: number, c: number): THREE.BufferGeometry {
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  const pos: number[] = [];
  // A point on the chamfered box: s = signs of the corner, i = which axes are inset.
  const p = (sx: number, sy: number, sz: number, ix: boolean, iy: boolean, iz: boolean): V3 => [sx * (hx - (ix ? c : 0)), sy * (hy - (iy ? c : 0)), sz * (hz - (iz ? c : 0))];
  const tri = (a: V3, b: V3, e: V3) => pos.push(...a, ...b, ...e);
  // Quads are given in any winding; each triangle is turned to face away from the centre.
  const quad = (a: V3, b: V3, e: V3, f: V3) => {
    tri(a, b, e);
    tri(a, e, f);
  };
  for (const s of [-1, 1]) {
    // Faces (inset on the two other axes).
    quad(p(s, -1, -1, false, true, true), p(s, 1, -1, false, true, true), p(s, 1, 1, false, true, true), p(s, -1, 1, false, true, true));
    quad(p(-1, s, -1, true, false, true), p(1, s, -1, true, false, true), p(1, s, 1, true, false, true), p(-1, s, 1, true, false, true));
    quad(p(-1, -1, s, true, true, false), p(1, -1, s, true, true, false), p(1, 1, s, true, true, false), p(-1, 1, s, true, true, false));
  }
  // Edge strips between two faces.
  for (const a of [-1, 1])
    for (const b of [-1, 1]) {
      // Along x (y = a, z = b side).
      quad(p(-1, a, b, true, false, true), p(1, a, b, true, false, true), p(1, a, b, true, true, false), p(-1, a, b, true, true, false));
      // Along y (x = a, z = b).
      quad(p(a, -1, b, false, true, true), p(a, 1, b, false, true, true), p(a, 1, b, true, true, false), p(a, -1, b, true, true, false));
      // Along z (x = a, y = b).
      quad(p(a, b, -1, false, true, true), p(a, b, 1, false, true, true), p(a, b, 1, true, false, true), p(a, b, -1, true, false, true));
    }
  // Corner triangles.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) tri(p(sx, sy, sz, false, true, true), p(sx, sy, sz, true, false, true), p(sx, sy, sz, true, true, false));
  // Outward winding: flip any triangle whose normal points toward the centre.
  const nrm: number[] = [];
  const uv: number[] = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 9) {
    e1.set(pos[i + 3]! - pos[i]!, pos[i + 4]! - pos[i + 1]!, pos[i + 5]! - pos[i + 2]!);
    e2.set(pos[i + 6]! - pos[i]!, pos[i + 7]! - pos[i + 1]!, pos[i + 8]! - pos[i + 2]!);
    n.crossVectors(e1, e2).normalize();
    const cx = (pos[i]! + pos[i + 3]! + pos[i + 6]!) / 3;
    const cy = (pos[i + 1]! + pos[i + 4]! + pos[i + 7]!) / 3;
    const cz = (pos[i + 2]! + pos[i + 5]! + pos[i + 8]!) / 3;
    if (n.x * cx + n.y * cy + n.z * cz < 0) {
      for (let k = 0; k < 3; k++) [pos[i + 3 + k], pos[i + 6 + k]] = [pos[i + 6 + k]!, pos[i + 3 + k]!];
      n.negate();
    }
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let v = 0; v < 3; v++) {
      nrm.push(n.x, n.y, n.z);
      const x = pos[i + v * 3]!;
      const y = pos[i + v * 3 + 1]!;
      const z = pos[i + v * 3 + 2]!;
      if (ax >= ay && ax >= az) uv.push(z + hz, y + hy);
      else if (ay >= az) uv.push(x + hx, z + hz);
      else uv.push(x + hx, y + hy);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

class Builder {
  readonly pieces: KitPiece[] = [];
  /** Colour given to the pieces added while set (painted / cloth parts of their own colour). */
  tint: string | undefined;

  /** Runs `fn` with pieces tinted `color`. */
  tinted(color: string, fn: () => void): void {
    const was = this.tint;
    this.tint = color;
    fn();
    this.tint = was;
  }

  /** Surface of revolution about +Y: profile points (radius, y) from the bottom up. UVs in meters. */
  lathe(mat: KitMaterial, pts: [number, number][], at: V3 = [0, 0, 0], seg = 24): void {
    const g = new THREE.LatheGeometry(
      pts.map(([r, y]) => new THREE.Vector2(r, y)),
      seg,
    );
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    const around = Math.PI * 2 * Math.max(...pts.map(([r]) => r));
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * len);
    this.add(mat, g, at);
  }

  /**
   * A surface over a grid: `f(u, v)` (u, v in 0..1) gives each point; smooth
   * normals, UVs in meters along the grid lines. One-sided (seen from the side
   * v x u points to) unless `double` (cloth seen from both sides).
   */
  grid(mat: KitMaterial, nu: number, nv: number, f: (u: number, v: number) => V3, double = false): void {
    const pos: number[] = [];
    const uv: number[] = [];
    const pts: V3[] = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pts.push(f(i / nu, j / nv));
    const at = (i: number, j: number) => pts[j * (nu + 1) + i]!;
    // Meters along u (per row) and v (per column) for the UVs.
    for (let j = 0; j <= nv; j++) {
      let su = 0;
      for (let i = 0; i <= nu; i++) {
        if (i > 0) su += dist3(at(i, j), at(i - 1, j));
        let sv = 0;
        for (let k = 1; k <= j; k++) sv += dist3(at(i, k), at(i, k - 1));
        const p = at(i, j);
        pos.push(p[0], p[1], p[2]);
        uv.push(su, sv);
      }
    }
    const index: number[] = [];
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i;
        index.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
      }
    const sides = double ? [index, index.map((_, i) => index[i - (i % 3) + 2 - (i % 3)]!)] : [index];
    for (const idx of sides) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      this.add(mat, g);
    }
  }

  /** A round bar along a smooth path through `pts` (hoses, ropes, bent pipes). */
  tube(mat: KitMaterial, pts: V3[], r: number, seg = 12, sides = 6): void {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const g = new THREE.TubeGeometry(curve, seg, r, sides, false);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const len = curve.getLength();
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * Math.PI * 2 * r);
    this.add(mat, g);
  }

  /** A straight round bar from `a` to `b`. */
  rod(mat: KitMaterial, a: V3, b: V3, r: number, sides = 6): void {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    if (len < 1e-4) return;
    const g = new THREE.CylinderGeometry(r, r, len, sides, 1, true);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r, uv.getY(i) * len);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.applyQuaternion(q);
    const mid = va.add(vb).multiplyScalar(0.5);
    g.translate(mid.x, mid.y, mid.z);
    this.add(mat, g);
  }

  /**
   * Box with world-scale UVs (texture meters match the map boxes). Boxes thick
   * enough get chamfered edges: a sharp 90° edge never catches the light, so
   * plain boxes read as flat cut-outs; a thin bevel draws the highlight line
   * real objects have along their edges.
   */
  box(mat: KitMaterial, size: V3, at: V3, rot: V3 = [0, 0, 0]): void {
    const [w, h, d] = size;
    if (w <= 0 || h <= 0 || d <= 0) return;
    const min = Math.min(w, h, d);
    if (min >= BEVEL.minSize && mat !== 'glass' && mat !== 'water') {
      this.add(mat, chamferedBox(w, h, d, Math.min(BEVEL.max, min * BEVEL.share)), at, rot);
      return;
    }
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const dims: [number, number][] = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ];
    const per = uv.count / 6;
    for (let f = 0; f < 6; f++) for (let v = 0; v < per; v++) uv.setXY(f * per + v, uv.getX(f * per + v) * dims[f]![0], uv.getY(f * per + v) * dims[f]![1]);
    this.add(mat, g, at, rot);
  }

  /** Cylinder standing on +Y (rot to lay it down). */
  cyl(mat: KitMaterial, rTop: number, rBottom: number, h: number, at: V3, rot: V3 = [0, 0, 0], seg = 16, open = false): void {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const around = Math.PI * (rTop + rBottom);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * h);
    this.add(mat, g, at, rot);
  }

  sphere(mat: KitMaterial, r: number, at: V3, scale: V3 = [1, 1, 1]): void {
    const g = new THREE.SphereGeometry(r, 12, 8);
    g.scale(...scale);
    this.add(mat, g, at);
  }

  /** A side profile (z, y) extruded across x, centred on x = 0. */
  profile(mat: KitMaterial, pts: [number, number][], width: number, at: V3 = [0, 0, 0]): void {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    // Shape x -> world z, extrude z -> world x.
    g.rotateY(-Math.PI / 2);
    g.translate(width / 2, 0, 0);
    this.add(mat, g, at);
  }

  wheel(x: number, y: number, z: number, r: number, width: number): void {
    this.cyl('rubber', r, r, width, [x, y, z], [0, 0, Math.PI / 2], 14);
    this.cyl('metal', r * 0.55, r * 0.55, width + 0.02, [x, y, z], [0, 0, Math.PI / 2], 10);
  }

  private add(mat: KitMaterial, g: THREE.BufferGeometry, at: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]): void {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    // Merged batches need the same attribute set everywhere.
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    this.pieces.push(this.tint ? { geo: ng, mat, tint: this.tint } : { geo: ng, mat });
  }
}

/**
 * A fuel dispenser standing at (x, z) on y0, w x h x d (faces +-z): cabinet,
 * a rounded head with lit displays, nozzles in holsters at both ends with
 * hoses hanging in loops, and (`sign`) a price board on a post.
 */
function fuelDispenser(b: Builder, x: number, z: number, w: number, d: number, h: number, y0: number, sign: boolean): void {
  const body = h * 0.66;
  b.box('body', [w, body, d], [x, y0 + body / 2, z]);
  b.box('dark', [w + 0.02, 0.12, d + 0.02], [x, y0 + 0.06, z]);
  const hh = h - body - 0.12;
  b.profile('trim', [[-d / 2 - 0.03, 0], [d / 2 + 0.03, 0], [d / 2 + 0.03, hh * 0.7], [d / 2 - 0.08, hh], [-d / 2 + 0.08, hh], [-d / 2 - 0.03, hh * 0.7]], w + 0.04, [x, y0 + body, z]);
  for (const s of [-1, 1]) {
    b.box('light', [w * 0.7, hh * 0.45, 0.02], [x, y0 + body + hh * 0.42, z + s * (d / 2 + 0.035)]);
    b.box('dark', [w * 0.8, 0.22, 0.02], [x, y0 + body * 0.78, z + s * (d / 2 + 0.01)]);
    const ex = x + s * (w / 2 + 0.04);
    b.box('dark', [0.08, 0.2, 0.14], [ex, y0 + body * 0.62, z]);
    b.rod('dark', [ex + s * 0.03, y0 + body * 0.72, z + 0.02], [ex + s * 0.08, y0 + body * 0.55, z + 0.16], 0.025, 6);
    b.tube('rubber', [[x + s * (w / 2 - 0.05), y0 + body * 0.7, z - d / 2 + 0.1], [ex + s * 0.12, y0 + 0.25, z - 0.1], [ex + s * 0.18, y0 + 0.12, z + 0.2], [ex + s * 0.06, y0 + body * 0.6, z + 0.05]], 0.022, 16, 6);
  }
  if (!sign) return;
  b.box('metal', [0.05, 0.4, 0.05], [x, y0 + h + 0.05, z]);
  b.box('light', [w * 0.9, 0.3, 0.05], [x, y0 + h + 0.35, z]);
}

function dist3(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Builds a kit to fill a w x h x d box; `h` counts from the ground up. */
/** Watchtowers: the gap in the deck's half-wall over the ladder (m). */
const LADDER_GAP = 0.95;

/** A watchtower's ladder in kit space: its foot (on the +z side), its top (the deck) and the way off it (+z). */
export function watchtowerLadder(w: number, h: number, d: number): { x: number; z: number; top: number } {
  void w;
  return { x: 0, z: d / 2 + 0.35, top: h - 2.3 };
}

export function buildKit(kind: ModelKind, w: number, h: number, d: number, rand: () => number = Math.random): KitModel {
  const b = new Builder();
  const colliders = KITS[kind](b, w, h, d, rand);
  return { pieces: b.pieces, colliders: colliders ?? undefined };
}

type Kit = (b: Builder, w: number, h: number, d: number, rand: () => number) => KitBox[] | void;

const KITS: Record<ModelKind, Kit> = {
  car(b, w, h, d) {
    const r = 0.33;
    const bodyTop = h * 0.56;
    // Lower body with a lower, rounded-off nose and tail.
    b.profile(
      'body',
      [
        [-d / 2, 0.3],
        [d / 2, 0.3],
        [d / 2, bodyTop - 0.12],
        [d / 2 - 0.25, bodyTop],
        [-d / 2 + 0.2, bodyTop],
        [-d / 2, bodyTop - 0.1],
      ],
      w,
    );
    // Cabin: glass all round, roof panel on top.
    const c0 = -d * 0.28;
    const c1 = d * 0.2;
    const roof = h - 0.05;
    b.profile(
      'glass',
      [
        [c0 - 0.45, bodyTop],
        [c1 + 0.55, bodyTop],
        [c1, roof],
        [c0, roof],
      ],
      w - 0.16,
    );
    b.box('body', [w - 0.14, 0.06, c1 - c0 + 0.1], [0, roof + 0.02, (c0 + c1) / 2]);
    // Pillars between the windows.
    for (const z of [(c0 + c1) / 2]) b.box('body', [w - 0.12, roof - bodyTop, 0.12], [0, (roof + bodyTop) / 2, z]);
    // Bumpers, lights, mirrors.
    b.box('dark', [w + 0.04, 0.16, 0.14], [0, 0.42, d / 2 + 0.02]);
    b.box('dark', [w + 0.04, 0.16, 0.14], [0, 0.42, -d / 2 - 0.02]);
    for (const s of [-1, 1]) {
      b.box('light', [0.32, 0.12, 0.04], [s * (w / 2 - 0.28), bodyTop - 0.2, d / 2 + 0.01]);
      b.box('redLight', [0.3, 0.12, 0.04], [s * (w / 2 - 0.26), bodyTop - 0.18, -d / 2 - 0.01]);
      b.box('body', [0.14, 0.1, 0.18], [s * (w / 2 + 0.05), bodyTop + 0.08, c1 + 0.35]);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.wheel(sx * (w / 2 - 0.13), r, sz * (d / 2 - 0.8), r, 0.24);
    // Dark underside so the wheel wells don't show daylight.
    b.box('dark', [w - 0.3, 0.12, d - 0.4], [0, 0.26, 0]);
  },

  truck(b, w, h, d) {
    const r = 0.5;
    const frame = 1.05;
    // Chassis rails and wheels (single front axle, twin rear).
    b.box('dark', [w * 0.7, 0.25, d - 0.3], [0, frame - 0.15, 0]);
    for (const z of [d / 2 - 1.25, -d / 2 + 1.7, -d / 2 + 0.75]) for (const s of [-1, 1]) b.wheel(s * (w / 2 - 0.2), r, z, r, 0.36);
    // Cab at the front (+z).
    const cabLen = 1.9;
    const cz = d / 2 - cabLen / 2;
    b.box('body', [w, 1.2, cabLen], [0, frame + 0.6, cz]);
    b.profile(
      'body',
      [
        [d / 2 - cabLen, frame + 1.2],
        [d / 2 - 0.55, frame + 1.2],
        [d / 2 - 0.75, h - 0.05],
        [d / 2 - cabLen, h - 0.05],
      ],
      w - 0.1,
    );
    b.box('glass', [w - 0.3, 0.55, 0.05], [0, frame + 1.55, d / 2 - 0.62], [-0.25, 0, 0]);
    for (const s of [-1, 1]) b.box('glass', [0.05, 0.5, 0.7], [s * (w / 2 - 0.04), frame + 1.5, d / 2 - 1.2]);
    b.box('dark', [w - 0.2, 0.5, 0.08], [0, frame + 0.45, d / 2 + 0.01]);
    b.box('dark', [w + 0.1, 0.2, 0.2], [0, frame - 0.05, d / 2 + 0.05]);
    for (const s of [-1, 1]) b.box('light', [0.2, 0.2, 0.05], [s * (w / 2 - 0.3), frame + 0.35, d / 2 + 0.04]);
    // Cargo bed with a canvas cover on hoops.
    const bedLen = d - cabLen - 0.25;
    const bz = -d / 2 + bedLen / 2;
    b.box('body', [w, 0.15, bedLen], [0, frame + 0.08, bz]);
    for (const s of [-1, 1]) b.box('body', [0.08, 0.6, bedLen], [s * (w / 2 - 0.04), frame + 0.45, bz]);
    b.box('body', [w, 0.6, 0.08], [0, frame + 0.45, -d / 2 + 0.04]);
    const cover = h - frame - 0.75;
    b.box('canvas', [w - 0.02, cover * 0.45, bedLen], [0, frame + 0.75 + (cover * 0.45) / 2, bz]);
    b.cyl('canvas', w / 2 - 0.01, w / 2 - 0.01, bedLen, [0, frame + 0.75 + cover * 0.45, bz], [Math.PI / 2, 0, 0], 16, false);
  },

  container(b, w, h, d) {
    // ISO container along z: corrugated sides and back, a dented roof, two
    // door leaves at +z with locking bars, corner posts with castings, rails.
    // Painted steel in the object's colour (chips, rust runs).
    const post = 0.15;
    const corr = (u: number, n: number) => {
      // Trapezoid corrugation: flat crest, slopes, flat trough.
      const t = (u * n) % 1;
      return t < 0.3 ? 1 : t < 0.5 ? 1 - (t - 0.3) / 0.2 : t < 0.8 ? 0 : (t - 0.8) / 0.2;
    };
    const len = d - 2 * post;
    const hi = h - 0.32;
    const nLong = Math.round(len / 0.28);
    for (const s of [-1, 1]) {
      b.grid('paint', nLong * 5, 1, (u, v) => {
        const z = s * (-len / 2 + u * len);
        return [s * (w / 2 - 0.05 + 0.04 * corr(u, nLong)), 0.16 + v * hi, z];
      });
    }
    // Back end (-z) corrugated across x.
    const nEnd = Math.round((w - 2 * post) / 0.28);
    b.grid('paint', nEnd * 5, 1, (u, v) => [-(w / 2 - post) + u * (w - 2 * post), 0.16 + v * hi, -d / 2 + 0.05 - 0.035 * corr(u, nEnd)]);
    // Roof: shallow cross corrugation, a dent here and there.
    b.grid('paint', 8, Math.round(d / 0.5), (u, v) => {
      const x = -w / 2 + post * 0.6 + u * (w - post * 1.2);
      const z = -d / 2 + 0.1 + v * (d - 0.2);
      return [x, h - 0.06 + 0.012 * Math.sin(v * d * 12) - 0.03 * Math.exp(-((x - 0.3) ** 2 + (z - d * 0.15) ** 2) * 2), z];
    });
    b.box('dark', [w - 0.1, 0.1, d - 0.1], [0, 0.11, 0]);
    // Doors (+z): two leaves, vertical corrugation, four locking bars with handles and cams.
    const leaf = (w - 2 * post) / 2;
    for (const s of [-1, 1]) {
      const cx = s * leaf * 0.5;
      const n = Math.round(leaf / 0.2);
      b.grid('paint', n * 5, 1, (u, v) => [cx + leaf / 2 - 0.01 - u * (leaf - 0.02), 0.16 + v * hi, d / 2 - 0.04 + 0.02 * corr(u, n)]);
      for (const bx of [-0.3, 0.3]) {
        const x = cx + bx * leaf;
        b.rod('metal', [x, 0.2, d / 2 + 0.02], [x, h - 0.2, d / 2 + 0.02], 0.022, 6);
        b.box('paint', [0.08, 0.05, 0.05], [x, 0.24, d / 2 + 0.03]);
        b.box('paint', [0.08, 0.05, 0.05], [x, h - 0.24, d / 2 + 0.03]);
        b.box('metal', [0.05, 0.38, 0.05], [x + 0.05, 1.15, d / 2 + 0.06], [0, 0, 0.12]);
      }
      // Hinges on the outer edge.
      for (const y of [0.5, h / 2, h - 0.5]) b.box('metal', [0.06, 0.14, 0.06], [s * (w / 2 - post - 0.02), y, d / 2 + 0.01]);
    }
    // Frame: corner posts, top and bottom rails, door header and sill, castings.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        b.box('paint', [post, h - 0.02, post], [sx * (w / 2 - post / 2), h / 2, sz * (d / 2 - post / 2)]);
        for (const y of [0.09, h - 0.09]) {
          b.box('paint', [0.18, 0.12, 0.18], [sx * (w / 2 - 0.09), y, sz * (d / 2 - 0.09)]);
          b.box('dark', [0.07, 0.05, 0.02], [sx * (w / 2 - 0.09), y, sz * (d / 2 + 0.002)]);
        }
      }
    for (const sx of [-1, 1]) for (const y of [0.1, h - 0.08]) b.box('paint', [0.12, y < 1 ? 0.16 : 0.12, d - 0.1], [sx * (w / 2 - 0.06), y, 0]);
    for (const sz of [-1, 1]) for (const y of [0.1, h - 0.1]) b.box('paint', [w - 0.1, 0.18, 0.12], [0, y, sz * (d / 2 - 0.06)]);
  },

  boxcar(b, w, h, d) {
    const floor = 1.15;
    // Bogies: frames and four wheels each.
    for (const z of [-d / 2 + 2, d / 2 - 2]) {
      b.box('dark', [w * 0.75, 0.35, 2.4], [0, 0.55, z]);
      for (const dz of [-0.8, 0.8]) for (const s of [-1, 1]) b.cyl('dark', 0.42, 0.42, 0.12, [s * 0.72, 0.42, z + dz], [0, 0, Math.PI / 2], 14);
    }
    b.box('dark', [w * 0.9, 0.3, d], [0, floor - 0.15, 0]);
    for (const s of [-1, 1]) b.box('dark', [0.3, 0.3, 0.2], [s * 0.7, floor - 0.2, s * (d / 2 + 0.1)]);
    // Body with vertical ribs, a sliding door each side and a curved roof.
    const bh = h - floor - 0.25;
    b.box('body', [w, bh, d], [0, floor + bh / 2, 0]);
    for (let z = -d / 2 + 0.6; z < d / 2 - 0.4; z += 1.2) for (const s of [-1, 1]) b.box('trim', [0.05, bh, 0.12], [s * (w / 2 + 0.02), floor + bh / 2, z]);
    for (const s of [-1, 1]) {
      b.box('trim', [0.06, bh - 0.3, 2.4], [s * (w / 2 + 0.04), floor + bh / 2, 0.8]);
      b.box('metal', [0.05, 0.08, 5], [s * (w / 2 + 0.07), floor + bh - 0.1, 0.8]);
    }
    const roof = b.pieces.length;
    b.cyl('trim', w / 2 + 0.05, w / 2 + 0.05, d + 0.1, [0, floor + bh - 0.9, 0], [Math.PI / 2, 0, 0], 20);
    // Flatten the roof cylinder into a shallow arch.
    const g = b.pieces[roof]!.geo;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const top = floor + bh;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setY(i, Math.max(top - 0.02, top + (y - (floor + bh - 0.9)) * 0.28));
    }
    g.computeVertexNormals();
  },

  fuelTank(b, w, h, d) {
    // Steel storage tank: welded courses, a shallow cone roof with a rail round
    // its edge, a caged ladder, pipework with flanges and a valve at the foot.
    const r = Math.min(w, d) / 2 - 0.3;
    const pad = 0.3;
    b.box('concrete', [w, pad, d], [0, pad / 2, 0]);
    b.lathe('concrete', [[r + 0.25, 0], [r + 0.25, 0.15], [r + 0.05, 0.2], [0, 0.2]], [0, pad, 0], 40);
    const shell = h - pad - 0.5;
    b.lathe('paint', [[r, 0], [r, shell]], [0, pad + 0.15, 0], 48);
    // Weld seams between the courses (~1.8 m) and vertical seams staggered.
    for (let y = 1.8; y < shell - 0.2; y += 1.8) b.cyl('trim', r + 0.012, r + 0.012, 0.03, [0, pad + 0.15 + y, 0], [0, 0, 0], 48, true);
    b.lathe('trim', [[r + 0.03, 0], [r + 0.03, 0.1], [r * 0.15, 0.55], [0.3, 0.6], [0, 0.62]], [0, pad + 0.15 + shell, 0], 48);
    const top = pad + 0.15 + shell + 0.1;
    // Edge rail: posts and two rails round the roof edge.
    const posts = 16;
    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * Math.PI * 2;
      const a2 = ((i + 1) / posts) * Math.PI * 2;
      const pr = r - 0.12;
      b.rod('metal', [Math.cos(a) * pr, top - 0.02, Math.sin(a) * pr], [Math.cos(a) * pr, top + 1.0, Math.sin(a) * pr], 0.022, 5);
      for (const y of [0.5, 1.0]) b.rod('metal', [Math.cos(a) * pr, top + y, Math.sin(a) * pr], [Math.cos(a2) * pr, top + y, Math.sin(a2) * pr], 0.02, 5);
    }
    // Caged ladder up the +x side.
    const lx = r + 0.25;
    const ly0 = pad + 0.3;
    for (const s of [-1, 1]) b.rod('metal', [lx, ly0, s * 0.22], [lx, top + 0.9, s * 0.22], 0.025, 5);
    for (let y = ly0 + 0.3; y < top; y += 0.3) b.rod('metal', [lx, y, -0.22], [lx, y, 0.22], 0.015, 4);
    for (let y = 2.3; y < top + 0.6; y += 0.9) b.tube('metal', [[lx - 0.1, y, -0.36], [lx + 0.35, y, -0.3], [lx + 0.5, y, 0], [lx + 0.35, y, 0.3], [lx - 0.1, y, 0.36]], 0.018, 10, 4);
    for (const s of [-1, 0, 1]) b.rod('metal', [lx + 0.3 + 0.2 * (1 - Math.abs(s)), 2.3, s * 0.3], [lx + 0.3 + 0.2 * (1 - Math.abs(s)), top + 0.6, s * 0.3], 0.015, 4);
    // Pipe out of the foot (-z) along the ground to a valve.
    b.tinted('#5a3a2a', () => {
      b.cyl('paint', 0.13, 0.13, 1.6, [0, pad + 0.5, -r - 0.8], [Math.PI / 2, 0, 0], 12);
      for (const z of [-r - 0.05, -r - 1.55]) b.cyl('paint', 0.2, 0.2, 0.05, [0, pad + 0.5, z], [Math.PI / 2, 0, 0], 14);
      b.box('paint', [0.3, 0.4, 0.3], [0, pad + 0.5, -r - 1.75]);
      b.rod('paint', [0, pad + 0.7, -r - 1.75], [0, pad + 0.95, -r - 1.75], 0.025, 6);
    });
    b.cyl('redLight', 0.22, 0.22, 0.03, [0, pad + 0.97, -r - 1.75], [0, 0, 0], 14);
    // Round-ish collider: two squares, one turned 45 degrees.
    const side = 2 * r * 0.95;
    return [
      { center: [0, h / 2, 0], size: [side, h, side] },
      { center: [0, h / 2, 0], size: [side, h, side], yaw: Math.PI / 4 },
    ];
  },

  tent(b, w, h, d) {
    // Ridge tent: poles every ~2.4 m, the canvas sagging between them and
    // between eave and ridge, walls flaring out to the pegs, a rolled-up door
    // flap at the front end, guy ropes out to pegs. Ridge along the long side.
    const alongX = w >= d;
    const L = alongX ? w : d;
    const S = alongX ? d : w;
    const wall = 0.9;
    const ridge = h - 0.05;
    const eave = S / 2 + 0.22;
    const bays = Math.max(1, Math.round(L / 2.4));
    const t = new Builder();
    // Sag between poles along the length (0 at each pole) and across the panel.
    const sagAlong = (x: number) => Math.abs(Math.sin(((x + L / 2) / L) * bays * Math.PI));
    const wrinkle = (x: number, y: number) => 0.012 * Math.sin(x * 7.3 + y * 3.1) * Math.sin(x * 2.1 - y * 5.7);
    for (const s of [-1, 1]) {
      // Roof panel from the eave (u = 0) up to the ridge (u = 1).
      t.grid('canvas', 6, bays * 8, (u, v) => {
        const x = -L / 2 - 0.12 + v * (L + 0.24);
        const z = s * (eave - u * eave);
        const y = wall - 0.04 + u * (ridge - wall + 0.04);
        const sag = 0.07 * sagAlong(x) * Math.sin(u * Math.PI) + 0.03 * Math.sin(u * Math.PI);
        return s > 0 ? [x, y - sag + wrinkle(x, y), z] : [-x, y - sag + wrinkle(x, y), z];
      });
      // Side wall: hangs from the eave line, flares out at the foot, bellies in between poles.
      t.grid('canvas', bays * 8, 3, (u, v) => {
        const x = (s > 0 ? 1 : -1) * (-L / 2 + u * L);
        const y = wall - 0.02 - v * (wall - 0.02);
        const z = s * (S / 2 + 0.02 + v * v * 0.1 - 0.03 * sagAlong(x) * Math.sin(v * Math.PI));
        return [x, y + wrinkle(x, y) * 0.5, z];
      });
      // Eave seam strip (doubled cloth) along each side.
      t.box('canvas', [L + 0.24, 0.05, 0.08], [0, wall - 0.06, s * (eave - 0.02)], [s * 0.6, 0, 0]);
    }
    // Ends: gable panels (back closed, front with a door opening).
    for (const e of [-1, 1]) {
      const x = e * (L / 2 + 0.01);
      const pts: [number, number][] = [
        [-S / 2, 0],
        [S / 2, 0],
        [S / 2, wall],
        [0, ridge],
        [-S / 2, wall],
      ];
      const end = new Builder();
      if (e < 0) end.profile('canvas', pts, 0.02);
      else {
        // Around a doorway 1.1 m wide, 1.9 m high: two side pieces and the gable above.
        const dw = 0.55;
        const dh = Math.min(1.9, ridge - 0.5);
        end.profile('canvas', [[-S / 2, 0], [-dw, 0], [-dw, dh], [0, dh], [0, ridge], [-S / 2, wall]], 0.02);
        end.profile('canvas', [[dw, 0], [S / 2, 0], [S / 2, wall], [0, ridge], [0, dh], [dw, dh]], 0.02);
        // Dark inside, the rolled flap above the door, tie tapes.
        end.tinted('#24241e', () => end.box('canvas', [0.02, dh, 2 * dw], [-0.25, dh / 2, 0]));
        end.cyl('canvas', 0.11, 0.11, 2 * dw + 0.2, [0.12, dh + 0.08, 0], [Math.PI / 2, 0, 0], 10);
        for (const sz of [-1, 1]) end.box('canvas', [0.02, 0.35, 0.03], [0.16, dh - 0.1, sz * (dw - 0.05)]);
      }
      for (const p of end.pieces) {
        // Profiles run across z already, thin along x.
        p.geo.translate(e < 0 ? x - 0.01 : x, 0, 0);
        t.pieces.push(p);
      }
      // Pole tip through the ridge.
      t.cyl('wood', 0.025, 0.025, 0.25, [x, ridge + 0.1, 0], [0, 0, 0], 6);
    }
    // Guy ropes from the eave at each pole out to a peg, both sides.
    for (let i = 0; i <= bays; i++) {
      const x = -L / 2 + (i * L) / bays;
      for (const s of [-1, 1]) {
        const peg: V3 = [x, 0.08, s * (eave + 1.1)];
        t.tube('canvas', [[x, wall - 0.04, s * eave], [x, (wall - 0.04) * 0.45, s * (eave + 0.6)], peg], 0.008, 6, 4);
        t.box('wood', [0.04, 0.22, 0.04], [peg[0], 0.07, peg[2]], [s * 0.3, 0, 0]);
      }
    }
    for (const p of t.pieces) {
      if (!alongX) p.geo.rotateY(Math.PI / 2);
      b.pieces.push(p);
    }
    const lower: KitBox = { center: [0, wall / 2, 0], size: alongX ? [L, wall, S] : [S, wall, L] };
    const upper: KitBox = { center: [0, wall + (h - wall) / 4, 0], size: alongX ? [L, (h - wall) / 2, S * 0.55] : [S * 0.55, (h - wall) / 2, L] };
    return [lower, upper];
  },

  sandbags(b, w, h, d, rand) {
    // Staggered courses of plump bags along the long side.
    const alongX = w >= d;
    const L = alongX ? w : d;
    const T = alongX ? d : w;
    const bagL = 0.55;
    const bagH = 0.17;
    const rows = Math.max(1, Math.round(h / bagH));
    for (let r = 0; r < rows; r++) {
      const shift = r % 2 ? bagL / 2 : 0;
      const layers = T > 0.7 && r < rows - 1 ? 2 : 1;
      for (let k = 0; k < layers; k++) {
        const tz = layers === 2 ? (k - 0.5) * (T / 2) : 0;
        for (let x = -L / 2 + bagL / 2 - shift; x < L / 2 - bagL * 0.3; x += bagL) {
          const cx = Math.max(-L / 2 + bagL / 2, Math.min(L / 2 - bagL / 2, x));
          const jitter = (rand() - 0.5) * 0.04;
          const at: V3 = alongX ? [cx, bagH * (r + 0.5), tz + jitter] : [tz + jitter, bagH * (r + 0.5), cx];
          // Slightly taller than a course so the rows sit on each other with no gaps.
          const g = bagGeometry(bagL - 0.02, bagH * 1.05, layers === 2 ? T / 2 : T);
          if (!alongX) g.rotateY(Math.PI / 2);
          g.translate(...at);
          b.pieces.push({ geo: g, mat: 'body' });
        }
      }
    }
  },

  hesco(b, w, h, d) {
    // Wire-mesh baskets filled with earth, in 1 m cells.
    const alongX = w >= d;
    const L = alongX ? w : d;
    const T = alongX ? d : w;
    const cells = Math.max(1, Math.round(L / 1.05));
    const cl = L / cells;
    for (let i = 0; i < cells; i++) {
      const c = -L / 2 + cl * (i + 0.5);
      const at: V3 = alongX ? [c, h / 2, 0] : [0, h / 2, c];
      b.box('dirt', alongX ? [cl - 0.04, h - 0.02, T - 0.04] : [T - 0.04, h - 0.02, cl - 0.04], at);
      // Frame: posts at the cell corners and top rims.
      for (const s of [-1, 1]) {
        const post: V3 = alongX ? [c - cl / 2 + 0.02, h / 2, (s * T) / 2] : [(s * T) / 2, h / 2, c - cl / 2 + 0.02];
        b.box('mesh', [0.04, h, 0.04], post);
        b.box('mesh', alongX ? [cl, 0.04, 0.04] : [0.04, 0.04, cl], alongX ? [c, h, (s * T) / 2] : [(s * T) / 2, h, c]);
        b.box('mesh', alongX ? [cl, 0.03, 0.03] : [0.03, 0.03, cl], alongX ? [c, h / 2, (s * T) / 2 + s * 0.01] : [(s * T) / 2 + s * 0.01, h / 2, c]);
      }
    }
  },

  watchtower(b, w, h, d) {
    const deck = h - 2.3;
    const leg = 0.2;
    const inset = 0.15;
    const lx = w / 2 - inset;
    const lz = d / 2 - inset;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', [leg, h - 0.2, leg], [sx * lx, (h - 0.2) / 2, sz * lz]);
    // X braces on each side, below the deck.
    const braceH = deck - 0.4;
    for (const s of [-1, 1]) {
      const ang = Math.atan2(2 * lx, braceH);
      for (const t of [-1, 1]) {
        b.box('wood', [0.1, Math.hypot(2 * lx, braceH), 0.08], [0, braceH / 2 + 0.3, s * lz], [0, 0, t * ang]);
        b.box('wood', [0.08, Math.hypot(2 * lz, braceH), 0.1], [s * lx, braceH / 2 + 0.3, 0], [t * ang, 0, 0]);
      }
    }
    // Deck, plank half-walls with a firing gap, roof on the legs.
    b.box('wood', [w + 0.2, 0.16, d + 0.2], [0, deck, 0]);
    const wallH = 1.05;
    // The ladder side (+z) opens in the middle where the ladder comes up.
    const side = (w + 0.2 - LADDER_GAP) / 2;
    for (const s of [-1, 1]) {
      if (s > 0) for (const k of [-1, 1]) b.box('wood', [side, wallH, 0.08], [k * (LADDER_GAP / 2 + side / 2), deck + wallH / 2, d / 2 + 0.06]);
      else b.box('wood', [w + 0.2, wallH, 0.08], [0, deck + wallH / 2, s * (d / 2 + 0.06)]);
      b.box('wood', [0.08, wallH, d + 0.2], [s * (w / 2 + 0.06), deck + wallH / 2, 0]);
    }
    b.box('trim', [w + 0.9, 0.12, d + 0.9], [0, h - 0.1, 0]);
    b.box('trim', [w * 0.6, 0.35, d * 0.6], [0, h + 0.05, 0]);
    // Ladder.
    for (const s of [-1, 1]) b.box('wood', [0.06, deck, 0.06], [s * 0.25, deck / 2, d / 2 + 0.35]);
    for (let y = 0.35; y < deck; y += 0.35) b.box('wood', [0.5, 0.05, 0.05], [0, y, d / 2 + 0.35]);
    const cols: KitBox[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cols.push({ center: [sx * lx, h / 2, sz * lz], size: [leg, h, leg] });
    cols.push({ center: [0, deck, 0], size: [w + 0.2, 0.2, d + 0.2] });
    for (const s of [-1, 1]) {
      if (s > 0) for (const k of [-1, 1]) cols.push({ center: [k * (LADDER_GAP / 2 + side / 2), deck + wallH / 2, d / 2 + 0.06], size: [side, wallH, 0.1] });
      else cols.push({ center: [0, deck + wallH / 2, s * (d / 2 + 0.06)], size: [w + 0.2, wallH, 0.1] });
      cols.push({ center: [s * (w / 2 + 0.06), deck + wallH / 2, 0], size: [0.1, wallH, d + 0.2] });
    }
    cols.push({ center: [0, h - 0.1, 0], size: [w + 0.9, 0.15, d + 0.9] });
    return cols;
  },

  booth(b, w, h, d) {
    // Checkpoint guard booth: plinth, panelled lower walls, a framed window band
    // on all sides (two panes a side, door on +z), a dark room inside, flat roof
    // with an overhang and a lamp; striped barrier arm beside it.
    const sill = 1;
    const top = h - 0.35;
    b.box('concrete', [w + 0.2, 0.15, d + 0.2], [0, 0.075, 0]);
    b.box('body', [w, sill - 0.15, d], [0, 0.15 + (sill - 0.15) / 2, 0]);
    b.box('trim', [w + 0.04, 0.08, d + 0.04], [0, sill, 0]);
    // The room inside (seen through the glass).
    b.box('dark', [w - 0.3, top - sill, d - 0.3], [0, (sill + top) / 2, 0]);
    // Window band: frames and glass inset a little on each side.
    const band = top - sill;
    for (const side of [0, 1, 2, 3]) {
      const across = side < 2 ? w : d;
      const f = new Builder();
      const door = side === 0;
      // In local space: the face at +z, running along x.
      f.box('glass', [across - 0.14, band - 0.1, 0.02], [0, sill + band / 2, -0.05]);
      f.box('paint', [across, 0.07, 0.07], [0, top - 0.035, 0]);
      for (const x of [-across / 2 + 0.05, 0, across / 2 - 0.05]) if (!(door && x === 0)) f.box('paint', [0.07, band, 0.07], [x, sill + band / 2, 0]);
      if (door) {
        // Door leaf down to the ground on the right half: glazed top, panel below, handle.
        f.box('glass', [across / 2 - 0.12, band - 0.1, 0.02], [across / 4, sill + band / 2, 0.02]);
        f.box('paint', [across / 2 - 0.08, sill - 0.15, 0.05], [across / 4, 0.15 + (sill - 0.15) / 2, 0.03]);
        f.box('paint', [0.06, top - 0.15, 0.06], [0.03, 0.15 + (top - 0.15) / 2, 0.03]);
        f.box('metal', [0.12, 0.03, 0.04], [0.15, sill - 0.05, 0.08]);
      }
      const turn = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
      const off = side < 2 ? d / 2 : w / 2;
      for (const p of f.pieces) {
        p.geo.translate(0, 0, off);
        p.geo.rotateY(turn);
        b.pieces.push(p);
      }
    }
    // Roof: slab, overhang with a fascia, lamp and a short mast.
    b.box('body', [w + 0.1, 0.12, d + 0.1], [0, top + 0.06, 0]);
    b.box('trim', [w + 0.55, 0.14, d + 0.55], [0, h - 0.12, 0]);
    b.box('paint', [w + 0.6, 0.06, d + 0.6], [0, h - 0.02, 0]);
    b.cyl('light', 0.09, 0.12, 0.14, [w / 2 - 0.1, top + 0.08, d / 2 + 0.2], [0, 0, 0], 10);
    b.cyl('metal', 0.015, 0.015, 0.8, [-w / 2 + 0.2, h + 0.4, -d / 2 + 0.2], [0, 0, 0], 4);
    // Barrier: post with the motor box, counterweight, arm striped red / white.
    const bx = w / 2 + 0.4;
    b.tinted('#d8d4c8', () => {
      b.box('paint', [0.3, 0.9, 0.3], [bx, 0.45, 0]);
      b.box('paint', [0.36, 0.08, 0.36], [bx, 0.92, 0]);
    });
    b.box('dark', [0.22, 0.2, 0.5], [bx, 0.95, 0.35]);
    const arm = 3.2;
    const n = 8;
    for (let i = 0; i < n; i++) b.tinted(i % 2 ? '#e8e4da' : '#b02a22', () => b.box('paint', [0.09, 0.1, arm / n], [bx, 0.95, -0.1 - (i + 0.5) * (arm / n)]));
    b.cyl('rubber', 0.06, 0.06, 0.12, [bx, 0.95, -0.1 - arm], [Math.PI / 2, 0, 0], 8);
    b.box('dark', [0.06, 0.6, 0.06], [bx, 0.3, -arm + 0.2]);
  },

  pump(b, w, h, d) {
    if (w < 1.2) {
      // Fuel dispenser on a kerbed island.
      const isl = 0.15;
      b.box('concrete', [w + 0.5, isl, d + 0.9], [0, isl / 2, 0]);
      b.tinted('#d2c64a', () => b.box('paint', [w + 0.56, 0.05, d + 0.96], [0, isl + 0.01, 0]));
      fuelDispenser(b, 0, 0, w, d, h - isl, isl, true);
      return;
    }
    // Village hand pump over a stone trough on a pad: cast-iron column with a
    // cap, curved handle, spout over the trough, a bucket.
    b.box('concrete', [w, 0.15, d], [0, 0.075, 0]);
    const tr = [w * 0.85, 0.45, d * 0.45] as V3;
    const tz = d * 0.2;
    // Trough: walls round a water surface.
    b.box('trim', [tr[0], tr[1], 0.12], [0, 0.15 + tr[1] / 2, tz - tr[2] / 2 + 0.06]);
    b.box('trim', [tr[0], tr[1], 0.12], [0, 0.15 + tr[1] / 2, tz + tr[2] / 2 - 0.06]);
    for (const s of [-1, 1]) b.box('trim', [0.12, tr[1], tr[2] - 0.24], [s * (tr[0] / 2 - 0.06), 0.15 + tr[1] / 2, tz]);
    b.box('trim', [tr[0] - 0.24, 0.1, tr[2] - 0.24], [0, 0.2, tz]);
    b.box('water', [tr[0] - 0.24, 0.02, tr[2] - 0.24], [0, 0.15 + tr[1] - 0.1, tz]);
    // Column behind the trough.
    const cz = -d * 0.22;
    const ch = Math.min(1.45, h - 0.2);
    b.tinted('#2e3430', () => {
      b.lathe('paint', [[0.16, 0], [0.16, 0.08], [0.1, 0.14], [0.09, ch - 0.25], [0.12, ch - 0.2], [0.12, ch - 0.05], [0.05, ch]], [0, 0.15, cz], 14);
      b.sphere('paint', 0.06, [0, 0.15 + ch + 0.02, cz]);
      // Spout out over the trough and the handle swept back.
      b.tube('paint', [[0, 0.15 + ch * 0.62, cz + 0.08], [0, 0.15 + ch * 0.66, cz + 0.3], [0, 0.15 + ch * 0.55, cz + 0.42]], 0.035, 8, 8);
      b.tube('paint', [[0, 0.15 + ch - 0.1, cz - 0.08], [0, 0.15 + ch + 0.05, cz - 0.4], [0, 0.15 + ch - 0.15, cz - 0.75]], 0.02, 10, 6);
    });
    b.lathe('metal', [[0.11, 0], [0.13, 0.26], [0.135, 0.27]], [w * 0.3, 0.15, cz + 0.05], 12);
  },

  fountain(b, w, h, d) {
    // Town fountain: a round basin with a moulded rim, water in it, and a
    // baluster column in the middle with an upper bowl and a finial.
    const r = Math.min(w, d) / 2;
    b.lathe('concrete', [[r + 0.06, 0], [r + 0.08, 0.08], [r, 0.16], [r - 0.02, h - 0.2], [r + 0.1, h - 0.12], [r + 0.12, h - 0.04], [r + 0.06, h + 0.02], [r - 0.2, h + 0.02], [r - 0.22, h - 0.06], [r - 0.22, 0.2], [0, 0.2]], [0, 0, 0], 40);
    b.cyl('water', r - 0.22, r - 0.22, 0.04, [0, h - 0.2, 0], [0, 0, 0], 40);
    const col = Math.min(1.2, r * 0.45);
    b.lathe('trim', [[0.32, 0], [0.32, 0.12], [0.2, 0.2], [0.14, h * 0.6], [0.22, h * 0.8], [0.13, h], [0.12, h + col * 0.5], [0.18, h + col * 0.62], [0.1, h + col * 0.7], [0, h + col * 0.7]], [0, h - 0.24, 0], 20);
    const by = h - 0.24 + h + col * 0.62;
    b.lathe('trim', [[0.1, 0], [0.6, 0.12], [0.75, 0.24], [0.72, 0.28], [0.55, 0.22], [0, 0.18]], [0, by - 0.2, 0], 28);
    b.cyl('water', 0.6, 0.6, 0.02, [0, by + 0.0, 0], [0, 0, 0], 24);
    b.lathe('trim', [[0.08, 0], [0.08, 0.2], [0.14, 0.32], [0.05, 0.5], [0, 0.55]], [0, by, 0], 12);
    const side = 2 * r * 0.93;
    return [
      { center: [0, h / 2, 0], size: [side, h, side] },
      { center: [0, h / 2, 0], size: [side, h, side], yaw: Math.PI / 4 },
    ];
  },

  statue(b, w, h, d) {
    // War memorial: stepped base, a die with mouldings and a bronze plaque,
    // and a bronze soldier in a greatcoat, rifle at his side, the left arm
    // raised forward (+z).
    const ped = h * 0.45;
    b.box('trim', [w + 0.5, 0.15, d + 0.5], [0, 0.075, 0]);
    b.box('trim', [w + 0.25, 0.15, d + 0.25], [0, 0.225, 0]);
    b.box('concrete', [w + 0.08, 0.12, d + 0.08], [0, 0.36, 0]);
    b.box('concrete', [w, ped - 0.42, d], [0, 0.42 + (ped - 0.42) / 2, 0]);
    b.box('concrete', [w + 0.12, 0.1, d + 0.12], [0, ped - 0.05, 0]);
    b.box('concrete', [w + 0.04, 0.08, d + 0.04], [0, ped + 0.04, 0]);
    b.box('bronze', [w * 0.62, ped * 0.28, 0.03], [0, ped * 0.55, d / 2 + 0.015]);
    // Figure, scaled to what is left above the base (1.9 m man at s = 1).
    const s = (h - ped - 0.1) / 1.9;
    const y0 = ped + 0.08;
    b.box('bronze', [0.62 * s, 0.06, 0.48 * s], [0, y0 - 0.02, 0]);
    const B = new Builder();
    for (const x of [-1, 1]) {
      // Legs and boots, a step apart.
      const lz = x * 0.07;
      B.cyl('bronze', 0.075, 0.065, 0.5, [x * 0.11, 0.38, lz], [0, 0, 0], 10);
      B.box('bronze', [0.13, 0.12, 0.28], [x * 0.11, 0.06, lz + 0.05]);
    }
    // Greatcoat skirt, torso, belt, shoulders.
    B.lathe('bronze', [[0.26, 0.48], [0.24, 0.7], [0.2, 0.95], [0.2, 1.0]], [0, 0, 0], 16);
    B.lathe('bronze', [[0.2, 0.95], [0.22, 1.15], [0.24, 1.38], [0.2, 1.48], [0.08, 1.53]], [0, 0, 0], 16);
    B.cyl('bronze', 0.215, 0.215, 0.06, [0, 1.0, 0], [0, 0, 0], 16);
    B.sphere('bronze', 0.07, [0, 1.56, 0], [1, 1.2, 1]);
    // Head and helmet.
    B.sphere('bronze', 0.1, [0, 1.68, 0.01], [0.9, 1.1, 1]);
    B.lathe('bronze', [[0.15, 0], [0.135, 0.02], [0.12, 0.06], [0.08, 0.11], [0, 0.13]], [0, 1.71, 0], 16);
    // Right arm down holding a rifle by the barrel, butt on the ground.
    B.tube('bronze', [[-0.25, 1.4, 0], [-0.28, 1.15, 0.03], [-0.26, 0.92, 0.08]], 0.055, 8, 8);
    B.rod('bronze', [-0.32, 0.02, 0.1], [-0.28, 1.05, 0.12], 0.025, 6);
    B.box('bronze', [0.05, 0.28, 0.12], [-0.32, 0.16, 0.1]);
    // Left arm raised forward.
    B.tube('bronze', [[0.25, 1.42, 0], [0.32, 1.52, 0.25], [0.34, 1.62, 0.52]], 0.05, 8, 8);
    B.sphere('bronze', 0.05, [0.34, 1.63, 0.56]);
    for (const p of B.pieces) {
      p.geo.scale(s, s, s);
      p.geo.translate(0, y0, 0);
      b.pieces.push(p);
    }
  },

  bench(b, w, h, d) {
    // Park bench: cast-iron S-shaped ends, slatted seat and back with gaps.
    const alongX = w >= d;
    const L = alongX ? w : d;
    const T = alongX ? d : w;
    const seat = h * 0.42;
    const pieces = new Builder();
    for (let i = 0; i < 4; i++) pieces.box('wood', [L, 0.035, T * 0.15], [0, seat, -T / 2 + T * 0.18 + i * T * 0.19]);
    for (let i = 0; i < 3; i++) pieces.box('wood', [L, T * 0.14, 0.035], [0, seat + 0.16 + i * 0.13, -T / 2 + 0.06 - i * 0.03], [-0.22, 0, 0]);
    pieces.tinted('#232624', () => {
      for (const s of [-1, 1]) {
        const x = s * (L / 2 - 0.18);
        // End frame as a profile across z: front leg, seat rail, back leg up into the back.
        pieces.profile(
          'paint',
          [[T / 2 - 0.02, 0], [T / 2 - 0.1, 0], [T / 2 - 0.16, seat - 0.05], [-T / 2 + 0.12, seat - 0.05], [-T / 2 + 0.06, 0], [-T / 2 - 0.02, 0], [-T / 2 + 0.06, seat - 0.02], [-T / 2 - 0.06, h], [-T / 2 - 0.02, h + 0.02], [-T / 2 + 0.14, seat + 0.02], [T / 2 - 0.06, seat + 0.02], [T / 2 - 0.04, seat - 0.08]],
          0.05,
          [x, 0, 0],
        );
        pieces.cyl('paint', 0.035, 0.035, 0.12, [x, seat + 0.06, T / 2 - 0.04], [Math.PI / 2, 0, 0], 8);
      }
    });
    for (const p of pieces.pieces) {
      if (!alongX) p.geo.rotateY(Math.PI / 2);
      b.pieces.push(p);
    }
  },

  logPile(b, w, h, d, rand) {
    // Felled trunks stacked in a pyramid along the long side: bark in the
    // object's colour, pale cut ends with a darker heart, logs uneven in
    // length and girth, stakes holding the bottom row.
    const alongX = w >= d;
    const L = alongX ? w : d;
    const T = alongX ? d : w;
    const r = Math.min(0.32, h / 5);
    const layers = Math.max(1, Math.floor(h / (r * 1.75)));
    const logs = new Builder();
    for (let k = 0; k < layers; k++) {
      const n = Math.max(1, Math.floor(T / (2 * r)) - k);
      for (let i = 0; i < n; i++) {
        const z = -((n - 1) * r) + i * 2 * r;
        const y = r + k * r * 1.72;
        const rr = r * (0.85 + rand() * 0.2);
        const len = L - rand() * 0.4;
        const off = (rand() - 0.5) * 0.3;
        logs.cyl('body', rr, rr * 0.94, len, [off, y, z], [0, 0, Math.PI / 2], 12, true);
        for (const s of [-1, 1]) {
          const ex = off + (s * len) / 2;
          logs.tinted('#c9b18a', () => logs.cyl('wood', rr * 0.97, rr * 0.97, 0.03, [ex, y, z], [0, 0, Math.PI / 2], 12));
          logs.tinted('#8a6a45', () => logs.cyl('wood', rr * 0.35, rr * 0.35, 0.035, [ex + s * 0.003, y, z], [0, 0, Math.PI / 2], 8));
        }
      }
    }
    for (const s of [-1, 1]) for (const e of [-1, 1]) logs.box('wood', [0.1, h * 0.8, 0.1], [e * (L / 2 - 0.5), h * 0.4, s * (T / 2 + 0.05)], [s * 0.06, 0, 0]);
    for (const p of logs.pieces) {
      if (!alongX) p.geo.rotateY(Math.PI / 2);
      b.pieces.push(p);
    }
  },

  hayBale(b, w, h, d) {
    // Round bales lying on their side along the long side: rounded edges,
    // slightly domed ends, net wrap bands; snow on top in winter maps only
    // shows where the map paints it (the kit adds a thin cap).
    const alongX = w >= d;
    const L = alongX ? w : d;
    const r = Math.min(h / 2, (alongX ? d : w) / 2);
    const len = Math.min(1.3, L);
    const n = Math.max(1, Math.floor(L / len));
    const bales = new Builder();
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + (L / n) * (i + 0.5);
      const half = ((L / n) * 0.95) / 2;
      // Profile along the axis (radius, axial), turned so the axis is x.
      const prof: [number, number][] = [[0, -half - 0.03], [r * 0.7, -half], [r * 0.95, -half + 0.03], [r, -half + 0.12], [r, half - 0.12], [r * 0.95, half - 0.03], [r * 0.7, half], [0, half + 0.03]];
      const piece = new Builder();
      piece.lathe('straw', prof, [0, 0, 0], 24);
      // Net wrap edges.
      piece.tinted('#d9d6c8', () => {
        for (const s of [-0.42, 0.42]) piece.cyl('canvas', r + 0.006, r + 0.006, 0.06, [0, s * half * 2, 0], [0, 0, 0], 24, true);
      });
      for (const p of piece.pieces) {
        p.geo.rotateZ(-Math.PI / 2);
        p.geo.translate(x, r, 0);
        bales.pieces.push(p);
      }
      bales.box('snow', [(L / n) * 0.7, 0.06, r * 0.8], [x, r * 2 - 0.01, 0]);
    }
    for (const p of bales.pieces) {
      if (!alongX) p.geo.rotateY(Math.PI / 2);
      b.pieces.push(p);
    }
  },

  bunker(b, w, h, d) {
    // Concrete pillbox: firing slit across the front (-z), door at the back
    // (+z, right side), thick roof slab with snow on it. Enterable.
    const t = 0.5;
    const roof = 0.6;
    const inner = h - roof;
    const slit0 = 1.15;
    const slit1 = 1.55;
    const door = 1.3;
    const cols: KitBox[] = [];
    const wall = (size: V3, at: V3) => {
      b.box('body', size, at);
      cols.push({ center: at, size });
    };
    // Front: below and above the slit, with pillars at the ends.
    wall([w, slit0, t], [0, slit0 / 2, -d / 2 + t / 2]);
    wall([w, inner - slit1, t], [0, (slit1 + inner) / 2, -d / 2 + t / 2]);
    for (const s of [-1, 1]) wall([0.6, slit1 - slit0, t], [s * (w / 2 - 0.3), (slit0 + slit1) / 2, -d / 2 + t / 2]);
    // Sides.
    for (const s of [-1, 1]) wall([t, inner, d - 2 * t], [s * (w / 2 - t / 2), inner / 2, 0]);
    // Back with a door opening on the right.
    const doorX = w / 2 - t - 0.3 - door / 2;
    const leftLen = doorX - door / 2 + w / 2;
    wall([leftLen, inner, t], [-w / 2 + leftLen / 2, inner / 2, d / 2 - t / 2]);
    const rightLen = w / 2 - (doorX + door / 2);
    wall([rightLen, inner, t], [w / 2 - rightLen / 2, inner / 2, d / 2 - t / 2]);
    wall([door, inner - 2.2, t], [doorX, (2.2 + inner) / 2, d / 2 - t / 2]);
    // Roof slab overhanging the slit, and snow on top.
    wall([w + 0.4, roof, d + 0.6], [0, inner + roof / 2, -0.1]);
    b.box('trim', [w + 0.5, 0.15, 0.3], [0, slit1 + 0.05, -d / 2 - 0.1]);
    b.box('snow', [w + 0.2, 0.12, d + 0.4], [0, h + 0.04, -0.1]);
    // Floor inside (darker).
    b.box('trim', [w - 2 * t, 0.05, d - 2 * t], [0, 0.03, 0]);
    // Steel plate round the slit, a door leaf standing open, a vent, sandbags on the roof's front edge.
    b.box('dark', [w - 1.0, 0.08, 0.06], [0, slit0 - 0.02, -d / 2 - 0.02]);
    b.box('dark', [w - 1.0, 0.08, 0.06], [0, slit1 + 0.02, -d / 2 - 0.02]);
    b.box('dark', [door - 0.1, 2.1, 0.06], [doorX + door / 2 - 0.05, 1.05, d / 2 + 0.45], [0, 1.2, 0]);
    b.cyl('metal', 0.1, 0.1, 0.6, [-w / 4, inner + roof + 0.3, d / 4], [0, 0, 0], 10);
    b.cyl('metal', 0.14, 0.14, 0.06, [-w / 4, inner + roof + 0.62, d / 4], [0, 0, 0], 10);
    {
      const bags = new Builder();
      KITS.sandbags(bags, w - 0.8, 0.4, 0.5, () => 0.5);
      for (const p of bags.pieces) {
        p.geo.translate(0, inner + roof, -d / 2 + 0.15);
        b.pieces.push(p);
      }
    }
    return cols;
  },

  fence(b, w, h, d) {
    // Split-rail farm fence: posts every ~2.2 m and two rails.
    const alongX = w >= d;
    const L = alongX ? w : d;
    const n = Math.max(1, Math.round(L / 2.2));
    const parts = new Builder();
    for (let i = 0; i <= n; i++) parts.box('wood', [0.12, h, 0.12], [-L / 2 + (L / n) * i, h / 2, 0]);
    for (const y of [h * 0.45, h * 0.85]) parts.box('wood', [L, 0.08, 0.06], [0, y, 0.07]);
    parts.box('snow', [L, 0.04, 0.08], [0, h * 0.85 + 0.06, 0.07]);
    for (const p of parts.pieces) {
      if (!alongX) p.geo.rotateY(Math.PI / 2);
      b.pieces.push(p);
    }
    return [{ center: [0, h / 2, 0], size: alongX ? [L, h, 0.2] : [0.2, h, L] }];
  },

  steeple(b, w, h, d) {
    // Square church tower: plain shaft, open belfry with a bell, slate spire and cross.
    const shaft = h * 0.58;
    const belfry = h * 0.16;
    const spire = h - shaft - belfry - 0.9;
    b.box('body', [w, shaft, d], [0, shaft / 2, 0]);
    b.box('trim', [w + 0.3, 0.3, d + 0.3], [0, shaft, 0]);
    // A clock face on two sides and slit windows up the shaft.
    for (const s of [-1, 1]) {
      b.cyl('light', 0.7, 0.7, 0.06, [0, shaft - 1.3, s * (d / 2 + 0.03)], [Math.PI / 2, 0, 0], 24);
      b.cyl('trim', 0.78, 0.78, 0.08, [0, shaft - 1.3, s * (d / 2 + 0.02)], [Math.PI / 2, 0, 0], 24);
      // Hour marks and the hands (ten past ten).
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        b.box('dark', [0.04, i % 3 ? 0.1 : 0.16, 0.02], [Math.sin(a) * 0.58, shaft - 1.3 + Math.cos(a) * 0.58, s * (d / 2 + 0.065)], [0, 0, -a]);
      }
      b.box('dark', [0.05, 0.42, 0.02], [-0.16, shaft - 1.3 + 0.1, s * (d / 2 + 0.075)], [0, 0, 0.95]);
      b.box('dark', [0.06, 0.3, 0.02], [0.11, shaft - 1.3 + 0.07, s * (d / 2 + 0.08)], [0, 0, -1.0]);
      for (let y = 2.5; y < shaft - 2.5; y += 3) b.box('dark', [0.35, 1.3, 0.06], [0, y, s * (d / 2 + 0.02)]);
    }
    const p = Math.min(0.9, w * 0.22);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('body', [p, belfry, p], [sx * (w / 2 - p / 2), shaft + belfry / 2, sz * (d / 2 - p / 2)]);
    for (const s of [-1, 1]) {
      b.box('trim', [w, 0.5, 0.25], [0, shaft + belfry - 0.25, s * (d / 2 - 0.12)]);
      b.box('trim', [0.25, 0.5, d], [s * (w / 2 - 0.12), shaft + belfry - 0.25, 0]);
      // Louvres half way up the openings.
      b.box('wood', [w - 2 * p, 0.12, 0.08], [0, shaft + belfry * 0.3, s * (d / 2 - 0.3)]);
    }
    b.box('trim', [w - 0.2, 0.3, d - 0.2], [0, shaft + 0.15, 0]);
    b.cyl('metal', 0.18, 0.55, 0.8, [0, shaft + belfry * 0.45, 0], [0, 0, 0], 12);
    b.box('trim', [w + 0.4, 0.35, d + 0.4], [0, shaft + belfry + 0.17, 0]);
    // Four-sided spire (a 4-segment cone turned 45 degrees), snow on its lower part.
    const top = shaft + belfry + 0.35;
    b.cyl('dark', 0, (Math.max(w, d) / 2) * Math.SQRT2 * 0.92, spire, [0, top + spire / 2, 0], [0, Math.PI / 4, 0], 4);
    b.box('metal', [0.1, 0.9, 0.1], [0, top + spire + 0.4, 0]);
    b.box('metal', [0.5, 0.1, 0.1], [0, top + spire + 0.55, 0]);
    return [{ center: [0, (shaft + belfry) / 2, 0], size: [w, shaft + belfry, d] }];
  },

  sawShed(b, w, h, d, rand) {
    // Open-sided saw shed: posts under a pitched roof, a long saw bench with a
    // circular blade and a log on the carriage, sawdust on the floor.
    const alongX = w >= d;
    const L = alongX ? w : d;
    const T = alongX ? d : w;
    const parts = new Builder();
    const cols: KitBox[] = [];
    const eave = h * 0.62;
    const n = Math.max(2, Math.round(L / 4));
    for (let i = 0; i <= n; i++) {
      for (const s of [-1, 1]) {
        const x = -L / 2 + 0.2 + ((L - 0.4) * i) / n;
        parts.box('wood', [0.22, eave, 0.22], [x, eave / 2, s * (T / 2 - 0.2)]);
        cols.push({ center: [x, eave / 2, s * (T / 2 - 0.2)], size: [0.22, eave, 0.22] });
      }
    }
    const span = T / 2 + 0.5;
    const rise = h - eave;
    const pitch = Math.atan2(rise, span);
    const slant = Math.hypot(span, rise);
    for (const s of [-1, 1]) {
      parts.box('trim', [L + 0.6, 0.14, slant], [0, eave + rise / 2, (s * span) / 2], [s * pitch, 0, 0]);
      parts.box('snow', [L + 0.4, 0.1, slant * 0.95], [0, eave + rise / 2 + 0.12, (s * span) / 2], [s * pitch, 0, 0]);
    }
    parts.box('wood', [L, 0.2, 0.2], [0, eave, 0]);
    // Bench, blade and a log riding on it.
    const benchL = L * 0.7;
    parts.box('wood', [benchL, 0.9, 1.1], [0, 0.45, 0]);
    cols.push({ center: [0, 0.45, 0], size: [benchL, 0.9, 1.1] });
    parts.cyl('metal', 0.55, 0.55, 0.04, [benchL * 0.1, 1.0, 0], [Math.PI / 2, 0, 0], 24);
    const r = 0.3 + rand() * 0.1;
    parts.cyl('body', r, r, benchL * 0.6, [-benchL * 0.15, 0.9 + r, 0], [0, 0, Math.PI / 2], 10);
    parts.box('dirt', [L - 1, 0.04, T - 1.2], [0, 0.02, 0]);
    for (const p of parts.pieces) {
      if (!alongX) p.geo.rotateY(Math.PI / 2);
      b.pieces.push(p);
    }
    if (!alongX) for (const c of cols) c.center = [c.center[2], c.center[1], -c.center[0]] as [number, number, number];
    if (!alongX) for (const c of cols) c.size = [c.size[2], c.size[1], c.size[0]] as [number, number, number];
    return cols;
  },

  archBridge(b, w, hh, d) {
    // Stone arch bridge along z: a solid side profile with round arches over
    // the river (extruded across the width), parapets and a cobbled deck.
    // The deck top is 1.25 m below the box top (the parapets fill that).
    const h = hh - 1.25;
    const L = d;
    const deck = 0.9;
    const abut = Math.min(4, L * 0.14);
    const pier = 1.8;
    const spans = 3;
    const spanLen = (L - 2 * abut - (spans - 1) * pier) / spans;
    const spring = h * 0.32;
    const crown = h - deck - 0.25;
    const pts: [number, number][] = [
      [-L / 2, h],
      [L / 2, h],
      [L / 2, 0],
      [L / 2 - abut, 0],
    ];
    let z = L / 2 - abut;
    for (let i = 0; i < spans; i++) {
      const z0 = z;
      const z1 = z - spanLen;
      pts.push([z0, spring]);
      // Segmental arch from z0 down to z1 (going -z), rising to the crown.
      const rise = crown - spring;
      for (let k = 1; k < 12; k++) {
        const t = k / 12;
        pts.push([z0 - spanLen * t, spring + rise * Math.sin(Math.PI * t)]);
      }
      pts.push([z1, spring]);
      pts.push([z1, 0]);
      z = z1 - (i < spans - 1 ? pier : 0);
      if (i < spans - 1) pts.push([z, 0]);
    }
    pts.push([-L / 2, 0]);
    // The outline above runs clockwise; the extrusion wants counter-clockwise (outward normals).
    b.profile('body', pts.reverse(), w);
    // Cutwaters on the piers (upstream and downstream), parapets with copings.
    const cols: KitBox[] = [];
    z = L / 2 - abut - spanLen;
    for (let i = 0; i < spans - 1; i++) {
      const pz = z - pier / 2;
      for (const s of [-1, 1]) b.cyl('body', 0, pier * 0.72, spring * 1.6, [s * (w / 2 + 0.3), spring * 0.8, pz], [0, Math.PI / 4, 0], 4);
      cols.push({ center: [0, (h - deck) / 2, pz], size: [w, h - deck, pier] });
      z -= pier + spanLen;
    }
    const rail = 1.0;
    for (const s of [-1, 1]) {
      b.box('body', [0.45, rail, L], [s * (w / 2 - 0.22), h + rail / 2, 0]);
      b.box('trim', [0.6, 0.14, L + 0.1], [s * (w / 2 - 0.22), h + rail + 0.07, 0]);
      b.box('snow', [0.55, 0.08, L], [s * (w / 2 - 0.22), h + rail + 0.18, 0]);
      cols.push({ center: [s * (w / 2 - 0.22), h + rail / 2 + 0.07, 0], size: [0.45, rail + 0.14, L] });
    }
    b.box('trim', [w - 0.9, 0.06, L], [0, h + 0.03, 0]);
    cols.push({ center: [0, h - deck / 2, 0], size: [w, deck, L] });
    for (const s of [-1, 1]) cols.push({ center: [0, (h - deck) / 2, s * (L / 2 - abut / 2)], size: [w, h - deck, abut] });
    return cols;
  },

  trussBridge(b, w, h, d) {
    // Steel through-truss rail bridge along z on two concrete piers: deck with
    // sleepers and rails, a Warren truss on each side, cross bracing on top.
    const L = d;
    const trussH = Math.min(5, h * 0.55);
    const deckTop = h - trussH;
    const cols: KitBox[] = [];
    for (const pz of [-L / 4, L / 4]) {
      b.box('concrete', [w + 0.6, deckTop - 0.6, 2.2], [0, (deckTop - 0.6) / 2, pz]);
      cols.push({ center: [0, (deckTop - 0.6) / 2, pz], size: [w + 0.6, deckTop - 0.6, 2.2] });
    }
    b.box('dark', [w, 0.6, L], [0, deckTop - 0.3, 0]);
    cols.push({ center: [0, deckTop - 0.3, 0], size: [w, 0.6, L] });
    for (let z = -L / 2 + 0.4; z < L / 2; z += 0.65) b.box('wood', [2.6, 0.14, 0.24], [0, deckTop + 0.07, z]);
    for (const s of [-1, 1]) b.box('metal', [0.1, 0.16, L], [s * 0.72, deckTop + 0.22, 0]);
    const panels = Math.max(4, Math.round(L / 4));
    const pl = L / panels;
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - 0.15);
      b.box('trim', [0.3, 0.35, L], [x, deckTop + 0.15, 0]);
      b.box('trim', [0.3, 0.35, L - pl], [x, deckTop + trussH, 0]);
      for (let i = 0; i <= panels; i++) {
        const z = -L / 2 + i * pl;
        if (i > 0 && i < panels) b.box('trim', [0.2, trussH, 0.2], [x, deckTop + trussH / 2, z]);
        if (i < panels) {
          // Diagonal from the bottom of one panel point to the top of the next (alternating).
          const up = i % 2 === 0;
          const len = Math.hypot(pl, trussH);
          const ang = Math.atan2(pl, trussH) * (up ? 1 : -1);
          b.box('trim', [0.18, len, 0.18], [x, deckTop + trussH / 2, z + pl / 2], [ang, 0, 0]);
        }
      }
      // Low steel walls at the deck edge: keep people on the bridge.
      cols.push({ center: [x, deckTop + 0.6, 0], size: [0.3, 1.2, L] });
    }
    for (let i = 1; i < panels; i++) b.box('trim', [w - 0.3, 0.2, 0.2], [0, deckTop + trussH, -L / 2 + i * pl]);
    return cols;
  },

  bus(b, w, h, d) {
    // Single-deck bus along z (front +z): window band with pillars, doors on the right (+x), two axles.
    const r = 0.5;
    const floor = 0.75;
    const belt = 1.45;
    const roof = h - 0.25;
    b.box('body', [w, belt - 0.35, d], [0, 0.35 + (belt - 0.35) / 2, 0]);
    b.box('glass', [w - 0.06, roof - belt, d - 0.3], [0, (belt + roof) / 2, -0.05]);
    // Pillars between the side windows, solid panel at the back corners.
    for (let z = -d / 2 + 0.6; z <= d / 2 - 0.4; z += 1.45) b.box('body', [w + 0.02, roof - belt, 0.14], [0, (belt + roof) / 2, z]);
    b.box('body', [w + 0.02, roof - belt, 0.9], [0, (belt + roof) / 2, -d / 2 + 0.45]);
    b.box('body', [w, 0.28, d], [0, roof + 0.14, 0]);
    b.box('trim', [w - 0.5, 0.25, d * 0.3], [0, h - 0.1, -d * 0.1]);
    // Front: raked windscreen, destination board, bumper and lights.
    b.box('glass', [w - 0.2, roof - belt + 0.3, 0.06], [0, (belt + roof) / 2 - 0.1, d / 2 + 0.02], [-0.08, 0, 0]);
    b.box('light', [w * 0.6, 0.22, 0.05], [0, roof - 0.1, d / 2 + 0.06]);
    b.box('dark', [w + 0.04, 0.3, 0.16], [0, 0.45, d / 2 + 0.04]);
    b.box('dark', [w + 0.04, 0.3, 0.16], [0, 0.45, -d / 2 - 0.04]);
    for (const s of [-1, 1]) {
      b.box('light', [0.3, 0.16, 0.04], [s * (w / 2 - 0.3), 0.8, d / 2 + 0.03]);
      b.box('redLight', [0.22, 0.4, 0.04], [s * (w / 2 - 0.25), 1.0, -d / 2 - 0.03]);
      // Mirrors on stalks.
      b.box('dark', [0.06, 0.06, 0.5], [s * (w / 2 + 0.1), roof - 0.2, d / 2 + 0.1]);
      b.box('dark', [0.06, 0.35, 0.2], [s * (w / 2 + 0.12), roof - 0.45, d / 2 + 0.3]);
    }
    // Doors on the kerb side: front and middle, dark glazed leaves.
    for (const z of [d / 2 - 1.1, -0.4]) b.box('dark', [0.05, roof - 0.4, 1.2], [w / 2 + 0.01, (roof + 0.4) / 2, z]);
    b.box('trim', [w + 0.02, 0.12, d], [0, belt, 0]);
    // Wheels in arches; the floor hides daylight under the body.
    for (const z of [d / 2 - 2.4, -d / 2 + 3]) for (const s of [-1, 1]) b.wheel(s * (w / 2 - 0.2), r, z, r, 0.32);
    b.box('dark', [w - 0.4, 0.2, d - 0.6], [0, floor - 0.35, 0]);
  },

  fuelCanopy(b, w, h, d) {
    // Filling station canopy: a deck with a two-tone fascia, recessed lights
    // underneath, round painted columns, two islands with dispensers.
    const deck = 0.55;
    b.box('body', [w, deck - 0.2, d], [0, h - deck / 2 - 0.1, 0]);
    b.tinted('#b8322a', () => b.box('paint', [w + 0.08, 0.22, d + 0.08], [0, h - deck + 0.13, 0]));
    b.tinted('#e9e6de', () => b.box('paint', [w + 0.08, 0.2, d + 0.08], [0, h - 0.1, 0]));
    b.box('trim', [w - 0.1, 0.04, d - 0.1], [0, h - deck + 0.02, 0]);
    for (let x = -w / 2 + 1.5; x <= w / 2 - 1.4; x += 2) for (const z of [-d * 0.25, d * 0.25]) b.box('light', [1.2, 0.03, 0.5], [x, h - deck, z]);
    const cols: KitBox[] = [{ center: [0, h - deck / 2, 0], size: [w, deck, d] }];
    for (const sx of [-1, 1]) {
      const x = sx * w * 0.24;
      const len = d * 0.62;
      // Island: rounded-off ends, painted kerb.
      b.box('concrete', [1.3, 0.18, len], [x, 0.09, 0]);
      b.tinted('#d2c64a', () => b.box('paint', [1.36, 0.06, len + 0.06], [x, 0.17, 0]));
      cols.push({ center: [x, 0.09, 0], size: [1.3, 0.18, len] });
      for (const sz of [-1, 1]) {
        const z = sz * (len / 2 - 0.35);
        b.tinted('#e4e1d8', () => b.cyl('paint', 0.2, 0.2, h - deck - 0.18, [x, 0.18 + (h - deck - 0.18) / 2, z], [0, 0, 0], 16));
        b.cyl('dark', 0.24, 0.24, 0.3, [x, 0.33, z], [0, 0, 0], 16);
        cols.push({ center: [x, h / 2, z], size: [0.4, h, 0.4] });
        const pz = sz * len * 0.16;
        fuelDispenser(b, x, pz, 0.6, 0.9, 1.75, 0.18, true);
        cols.push({ center: [x, 0.18 + 1.75 / 2, pz], size: [0.6, 1.75, 0.9] });
        b.tinted('#d8b13a', () => b.cyl('paint', 0.09, 0.09, 0.9, [x, 0.18 + 0.45, sz * (len / 2 + 0.25)], [0, 0, 0], 10));
      }
    }
    return cols;
  },

  waterTower(b, w, h, d) {
    // Steel tank on four braced legs, catwalk round its foot, conical cap, ladder up one leg.
    const R = Math.min(w, d) / 2 - 0.15;
    const tankH = Math.min(5, h * 0.28);
    const capH = Math.min(1.6, h * 0.08);
    const base = h - tankH - capH;
    const lx = R * 0.72;
    const leg = 0.32;
    const cols: KitBox[] = [];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        b.box('trim', [leg, base, leg], [sx * lx, base / 2, sz * lx]);
        b.box('concrete', [0.8, 0.4, 0.8], [sx * lx, 0.2, sz * lx]);
        cols.push({ center: [sx * lx, base / 2, sz * lx], size: [leg, base, leg] });
      }
    // Horizontal ties and X braces on each face, in two stages.
    const stages = 2;
    for (let k = 0; k < stages; k++) {
      const y0 = 0.8 + (k * (base - 0.8)) / stages;
      const sh = (base - 0.8) / stages;
      const ang = Math.atan2(2 * lx, sh);
      const L = Math.hypot(2 * lx, sh);
      for (const s of [-1, 1]) {
        b.box('trim', [2 * lx, 0.12, 0.12], [0, y0 + sh, s * lx]);
        b.box('trim', [0.12, 0.12, 2 * lx], [s * lx, y0 + sh, 0]);
        for (const t of [-1, 1]) {
          b.box('mesh', [0.07, L, 0.07], [0, y0 + sh / 2, s * lx], [0, 0, t * ang]);
          b.box('mesh', [0.07, L, 0.07], [s * lx, y0 + sh / 2, 0], [t * ang, 0, 0]);
        }
      }
    }
    // Riser pipe, tank, bands, cap and finial.
    b.cyl('metal', 0.3, 0.3, base, [0, base / 2, 0], [0, 0, 0], 10);
    b.cyl('body', R * 0.9, R * 0.9, 0.3, [0, base + 0.15, 0], [0, 0, 0], 24);
    b.cyl('body', R, R, tankH - 0.3, [0, base + 0.3 + (tankH - 0.3) / 2, 0], [0, 0, 0], 28);
    for (const y of [base + 1.2, base + tankH - 0.6]) b.cyl('trim', R + 0.04, R + 0.04, 0.14, [0, y, 0], [0, 0, 0], 28, true);
    b.cyl('trim', 0.25, R + 0.12, capH, [0, base + tankH + capH / 2, 0], [0, 0, 0], 28);
    b.cyl('metal', 0.06, 0.06, 0.9, [0, h - 0.1, 0], [0, 0, 0], 6);
    // Catwalk ring (eight planks) and its rail.
    const cw = R + 0.75;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const seg = 2 * cw * Math.tan(Math.PI / 8);
      b.box('mesh', [seg + 0.05, 0.06, 0.7], [Math.sin(a) * (cw - 0.35), base + 0.05, Math.cos(a) * (cw - 0.35)], [0, a, 0]);
      b.box('metal', [seg + 0.05, 0.05, 0.05], [Math.sin(a) * cw, base + 1.05, Math.cos(a) * cw], [0, a, 0]);
      b.box('metal', [0.05, 1.0, 0.05], [Math.sin(a + Math.PI / 8) * cw * 1.08, base + 0.55, Math.cos(a + Math.PI / 8) * cw * 1.08]);
    }
    // Ladder up the south-east leg.
    const ly = base + 0.1;
    for (const s of [-1, 1]) b.box('metal', [0.05, ly, 0.05], [lx + 0.3, ly / 2, lx + 0.3 + s * 0.22]);
    for (let y = 0.4; y < ly; y += 0.4) b.box('metal', [0.04, 0.04, 0.44], [lx + 0.3, y, lx + 0.3]);
    const side = 2 * R * 0.95;
    cols.push({ center: [0, base + tankH / 2, 0], size: [side, tankH, side] }, { center: [0, base + tankH / 2, 0], size: [side, tankH, side], yaw: Math.PI / 4 });
    return cols;
  },

  tankWreck(b, w, h, d, rand) {
    // Burnt-out medium tank along z (front +z): sloped hull on its tracks, the turret
    // knocked askew with the gun drooping, scorched all over. Solid cover.
    const trackW = Math.min(0.62, w * 0.18);
    const hullTop = h * 0.62;
    const hw = w - 2 * trackW + 0.1;
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - trackW / 2);
      // Track run: upper and lower belts, sprocket and idler, road wheels in a row.
      b.profile(
        'dark',
        [
          [-d / 2 + 0.25, 0.05],
          [d / 2 - 0.35, 0.05],
          [d / 2, 0.55],
          [d / 2 - 0.15, 0.95],
          [-d / 2 + 0.05, 0.95],
          [-d / 2 - 0.05, 0.5],
        ],
        trackW,
        [x, 0, 0],
      );
      for (let i = 0; i < 6; i++) b.cyl('rubber', 0.36, 0.36, 0.08, [x + s * (trackW / 2 + 0.03), 0.42, -d / 2 + 0.9 + (i * (d - 1.8)) / 5], [0, 0, Math.PI / 2], 12);
      // A thrown section of track lying beside one side.
      if (s > 0 && rand() < 0.6) b.box('dark', [trackW * 0.9, 0.08, d * 0.35], [x + trackW + 0.2, 0.04, -d * 0.2], [0, 0.25, 0]);
      // Mudguard shelf over the track.
      b.box('body', [trackW + 0.05, 0.05, d - 0.4], [x, 1.0, 0]);
    }
    b.profile(
      'body',
      [
        [-d / 2 + 0.1, 0.45],
        [d / 2 - 0.9, 0.45],
        [d / 2 - 0.1, 0.75],
        [d / 2 - 0.6, hullTop],
        [-d / 2 + 0.25, hullTop],
        [-d / 2, hullTop - 0.35],
      ],
      hw,
    );
    // Engine deck grilles, a hatch blown open, scorch streaks.
    b.box('dark', [hw * 0.7, 0.04, d * 0.25], [0, hullTop + 0.02, -d * 0.33]);
    b.box('trim', [0.6, 0.08, 0.6], [hw * 0.25, hullTop + 0.35, d * 0.18], [1.1, 0, 0]);
    // Turret, turned and tipped, the gun drooping.
    const tr = Math.min(hw, d * 0.3) * 0.48;
    const ty = hullTop + (h - hullTop) / 2 - 0.05;
    const turn = (rand() - 0.5) * 1.6;
    const tilt = 0.08 + rand() * 0.1;
    const turret = new Builder();
    turret.cyl('body', tr * 0.82, tr, h - hullTop - 0.05, [0, 0, 0], [0, 0, 0], 10);
    turret.box('trim', [tr * 0.9, 0.35, tr * 0.9], [0, (h - hullTop) * 0.25, -tr * 0.6]);
    turret.cyl('dark', 0.1, 0.13, d * 0.42, [0, -0.08 - d * 0.04, tr + d * 0.2], [Math.PI / 2 + 0.22, 0, 0], 8);
    turret.cyl('dark', 0.2, 0.2, 0.5, [0, 0.02, tr + 0.1], [Math.PI / 2 + 0.22, 0, 0], 10);
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt, turn, tilt * 0.6, 'YXZ')).setPosition(rand() * 0.3 - 0.15, ty, -d * 0.05);
    for (const p of turret.pieces) {
      p.geo.applyMatrix4(m);
      b.pieces.push(p);
    }
    // Debris round the hull.
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.max(w, d) * (0.5 + rand() * 0.15);
      b.box(i % 2 ? 'dark' : 'body', [0.2 + rand() * 0.4, 0.06 + rand() * 0.1, 0.2 + rand() * 0.5], [Math.cos(a) * rr * (w / d), 0.05, Math.sin(a) * rr * 0.55], [0, rand() * 3, rand() * 0.3]);
    }
    return [
      { center: [0, hullTop / 2, 0], size: [w, hullTop, d - 0.2] },
      { center: [0, (hullTop + h) / 2, -d * 0.05], size: [tr * 1.7, h - hullTop, tr * 1.7], yaw: turn },
    ];
  },

  millWheel(b, w, h, d) {
    // Undershot water wheel turning about x: two rims with spokes, paddles between, iron hub and axle.
    const R = Math.min(h, d) / 2;
    const cy = h / 2;
    const W = w - 0.2;
    const n = 16;
    const seg = 2 * R * Math.sin(Math.PI / n) + 0.04;
    for (const s of [-1, 1]) {
      const x = (s * W) / 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = R - 0.12;
        // Tangent to the circle: a box's z axis turned 90° - a about x.
        b.box('wood', [0.12, 0.22, seg], [x, cy + Math.sin(a) * rr, Math.cos(a) * rr], [Math.PI / 2 - a, 0, 0]);
      }
      // Spokes: four boards through the hub, eight arms.
      for (let i = 0; i < 4; i++) b.box('wood', [0.1, 0.16, 2 * R - 0.3], [x * 0.9, cy, 0], [(i * Math.PI) / 4, 0, 0]);
    }
    // Paddles (floats) across the rims, leaning off the radius a little.
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2;
      const rr = R - 0.35;
      b.box('wood', [W, 0.5, 0.05], [0, cy + Math.sin(a) * rr, Math.cos(a) * rr], [Math.PI / 2 - a + 0.2, 0, 0]);
    }
    // Hub and axle stub out to the bearing block on the wall side.
    b.cyl('dark', 0.35, 0.35, W * 0.7, [0, cy, 0], [0, 0, Math.PI / 2], 12);
    b.cyl('metal', 0.12, 0.12, w + 0.6, [0, cy, 0], [0, 0, Math.PI / 2], 8);
    b.box('wood', [0.3, cy + 0.2, 0.5], [-w / 2 - 0.2, (cy + 0.2) / 2, 0]);
    return [{ center: [0, cy, 0], size: [W, 2 * R * 0.92, 2 * R * 0.92] }];
  },

  cart(b, w, h, d, rand) {
    // Farm wagon along z (shaft forward, +z): plank bed with side boards, spoked
    // wheels (bigger at the back), a load of sacks or hay.
    const bed = Math.min(1.05, h * 0.6);
    const rb = Math.min(0.6, bed * 0.6);
    const rf = rb * 0.82;
    const L = d - 0.9;
    const z0 = -d / 2 + 0.05;
    const zc = z0 + L / 2;
    b.box('wood', [w - 0.3, 0.1, L], [0, bed, zc]);
    for (const s of [-1, 1]) {
      b.box('body', [0.06, 0.45, L], [s * (w / 2 - 0.18), bed + 0.27, zc]);
      for (let z = z0 + 0.2; z < z0 + L; z += 0.9) b.box('wood', [0.09, 0.55, 0.09], [s * (w / 2 - 0.14), bed + 0.22, z]);
    }
    b.box('body', [w - 0.3, 0.45, 0.06], [0, bed + 0.27, z0 + 0.03]);
    b.box('body', [w - 0.3, 0.45, 0.06], [0, bed + 0.27, z0 + L - 0.03]);
    b.box('dark', [0.12, 0.12, L - 0.4], [0, bed - 0.12, zc]);
    // Wheels: rim, hub, eight spokes each; axles across.
    const wheel = (z: number, r: number) => {
      for (const s of [-1, 1]) {
        const x = s * (w / 2 - 0.05);
        b.cyl('wood', r, r, 0.08, [x, r, z], [0, 0, Math.PI / 2], 16, true);
        b.cyl('dark', r * 0.18, r * 0.18, 0.2, [x, r, z], [0, 0, Math.PI / 2], 8);
        for (let i = 0; i < 4; i++) b.box('wood', [0.04, 2 * r - 0.1, 0.05], [x, r, z], [(i * Math.PI) / 4, 0, 0]);
      }
      b.cyl('dark', 0.05, 0.05, w, [0, r, z], [0, 0, Math.PI / 2], 6);
    };
    wheel(z0 + 0.65, rb);
    wheel(z0 + L - 0.55, rf);
    // Shaft resting on the ground ahead.
    const sl = d - L + 0.3;
    const sa = Math.atan2(bed - 0.15, sl);
    for (const s of [-0.3, 0.3]) b.box('wood', [0.08, 0.08, Math.hypot(sl, bed - 0.15)], [s, (bed + 0.1) / 2, z0 + L + sl / 2 - 0.2], [sa, 0, 0]);
    // Load.
    if (rand() < 0.5) b.box('canvas', [w - 0.5, Math.max(0.2, h - bed - 0.15), L * 0.7], [0, bed + 0.05 + (h - bed - 0.15) / 2, zc - L * 0.08]);
    else for (let i = 0; i < 4; i++) b.sphere('canvas', 0.3, [((i % 2) - 0.5) * (w - 0.7), bed + 0.28, zc + (Math.floor(i / 2) - 0.5) * 1.0], [1.2, 0.75, 0.9]);
    return [
      { center: [0, bed + 0.25, zc], size: [w - 0.2, 0.75, L] },
      { center: [0, Math.min(h, bed + 0.9) / 2 + (bed - 0.2) / 2, zc - L * 0.08], size: [w - 0.5, Math.max(0.3, Math.min(h, bed + 0.9) - bed), L * 0.7] },
    ];
  },

  silo(b, w, h, d) {
    // Concrete stave silo: hoops every metre, a column of chute doors with a
    // ladder cage beside it, a ribbed metal dome with a vent.
    const r = Math.min(w, d) / 2 - 0.25;
    const body = h - r * 0.6;
    b.lathe('concrete', [[r + 0.3, 0], [r + 0.3, 0.35], [r + 0.05, 0.42], [0, 0.42]], [0, 0, 0], 32);
    b.lathe('body', [[r, 0], [r, body]], [0, 0.4, 0], 40);
    for (let y = 1; y < body - 0.2; y += 1) b.cyl('metal', r + 0.02, r + 0.02, 0.04, [0, 0.4 + y, 0], [0, 0, 0], 40, true);
    // Dome: ribbed metal, lip, vent.
    b.lathe('metal', [[r + 0.08, 0], [r + 0.08, 0.12], [r * 0.85, r * 0.3], [r * 0.5, r * 0.52], [0.3, r * 0.6], [0, r * 0.61]], [0, 0.4 + body - 0.05, 0], 40);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      b.tube('metal', [[c * (r + 0.09), 0.4 + body + 0.08, s * (r + 0.09)], [c * r * 0.86, 0.4 + body + r * 0.3, s * r * 0.86], [c * r * 0.5, 0.4 + body + r * 0.53, s * r * 0.5], [c * 0.3, 0.4 + body + r * 0.6, s * 0.3]], 0.02, 6, 4);
    }
    b.lathe('metal', [[0.35, 0], [0.3, 0.3], [0.45, 0.4], [0, 0.55]], [0, 0.4 + body + r * 0.6 - 0.05, 0], 12);
    // Chute: doors up the -x side in a channel, the ladder in a cage beside it.
    const cx = -r - 0.05;
    for (const s of [-1, 1]) b.box('concrete', [0.25, body - 0.6, 0.12], [cx, 0.4 + (body - 0.6) / 2 + 0.3, s * 0.42]);
    for (let y = 0.8; y < body - 0.6; y += 0.75) b.box('wood', [0.08, 0.6, 0.7], [cx + 0.05, 0.4 + y, 0]);
    const lx = cx - 0.35;
    for (const s of [-1, 1]) b.rod('metal', [lx, 0.4, s * 0.22], [lx, 0.4 + body, s * 0.22], 0.025, 5);
    for (let y = 0.7; y < body; y += 0.3) b.rod('metal', [lx, 0.4 + y, -0.22], [lx, 0.4 + y, 0.22], 0.015, 4);
    for (let y = 2.4; y < body; y += 1) b.tube('metal', [[lx + 0.15, 0.4 + y, -0.36], [lx - 0.25, 0.4 + y, -0.3], [lx - 0.4, 0.4 + y, 0], [lx - 0.25, 0.4 + y, 0.3], [lx + 0.15, 0.4 + y, 0.36]], 0.018, 10, 4);
    // Chute to a shed roof height, on a frame.
    b.box('wood', [0.6, 0.6, 1.6], [0, 3.2, -r - 0.6], [0.5, 0, 0]);
    const side = 2 * r * 0.95;
    return [
      { center: [0, h / 2, 0], size: [side, h, side] },
      { center: [0, h / 2, 0], size: [side, h, side], yaw: Math.PI / 4 },
    ];
  },

  stall(b, w, h, d, rand) {
    // Market stall: four poles, a striped cloth awning sagging between them
    // with a scalloped valance at the front (+z), a plank counter with crates
    // of produce and sacks.
    const ph = h - 0.25;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', [0.08, ph + (sz > 0 ? 0 : 0.25), 0.08], [sx * (w / 2 - 0.1), (ph + (sz > 0 ? 0 : 0.25)) / 2, sz * (d / 2 - 0.1)]);
    const stripes = 6;
    const other = rand() < 0.5 ? '#e7e0cf' : '#2f3a40';
    for (let i = 0; i < stripes; i++) {
      const x0 = -w / 2 - 0.15 + (i * (w + 0.3)) / stripes;
      const x1 = x0 + (w + 0.3) / stripes;
      const cloth = () => {
        // Awning slopes from the back (higher) to the front, sagging in the middle.
        b.grid('canvas', 2, 6, (u, v) => {
          const x = x0 + u * (x1 - x0);
          const z = d / 2 + 0.15 - v * (d + 0.3);
          const y = ph + 0.05 + v * 0.3 - 0.12 * Math.sin(v * Math.PI) - 0.04 * Math.sin(((x + w / 2) / w) * Math.PI * 2);
          return [x, y, z];
        }, true);
        // Valance: scallops hanging off the front edge.
        b.grid('canvas', 2, 1, (u, v) => {
          const x = x0 + u * (x1 - x0);
          return [x, ph + 0.05 - v * (0.18 + 0.06 * Math.sin(u * Math.PI)), d / 2 + 0.16];
        }, true);
      };
      // Every other stripe in the stall's own colour.
      if (i % 2) b.tinted(other, cloth);
      else cloth();
    }
    // Counter: planks on trestles, crates tipped toward the front.
    b.box('wood', [w - 0.3, 0.05, d * 0.45], [0, 0.88, d * 0.15]);
    for (const sx of [-1, 1]) b.box('wood', [0.06, 0.86, d * 0.4], [sx * (w / 2 - 0.35), 0.43, d * 0.15]);
    b.box('wood', [w - 0.4, 0.5, 0.03], [0, 0.6, d * 0.15 + d * 0.22]);
    const goods = ['#b8402c', '#d08a2a', '#7c9a3a', '#c9b04a', '#8a3a5a'];
    for (let i = 0; i < 4; i++) {
      const x = -w / 2 + 0.55 + (i * (w - 1.1)) / 3;
      const cz = d * 0.15;
      b.box('wood', [0.5, 0.18, 0.36], [x, 1.0, cz], [0.25, 0, 0]);
      const col = goods[Math.floor(rand() * goods.length)]!;
      b.tinted(col, () => {
        for (let k = 0; k < 6; k++) b.sphere('paint', 0.06, [x - 0.15 + (k % 3) * 0.15, 1.1 + (k < 3 ? 0.02 : 0.06), cz + (k < 3 ? 0.07 : -0.05)]);
      });
    }
    // Sacks at the side.
    b.tinted('#a28c66', () => {
      for (let i = 0; i < 2; i++) b.sphere('canvas', 0.28, [w / 2 - 0.3, 0.26, -d * 0.2 + i * 0.5], [0.9, 0.95, 0.8]);
    });
    return [{ center: [0, 0.45, d * 0.15], size: [w - 0.3, 0.9, d * 0.45] }];
  },

  crane(b, w, h, d) {
    // Gantry crane straddling a yard track: braced A-frame legs on bogies,
    // a box girder with a walkway and rail, the trolley with its hoist and
    // hook, a cab with windows, black-and-yellow ends.
    const legW = 0.45;
    const girder = 1.1;
    const lh = h - girder;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - legW / 2);
      for (const sz of [-1, 1]) b.box('body', [legW, lh, legW], [x, lh / 2, sz * (d / 2 - 1)], [sz * 0.08, 0, 0]);
      b.box('trim', [legW + 0.1, 0.5, d], [x, lh - 0.25, 0]);
      // Lattice between the legs: horizontals and diagonals.
      for (let k = 0; k < 3; k++) {
        const y0 = 1.2 + (k * (lh - 1.8)) / 3;
        const y1 = 1.2 + ((k + 1) * (lh - 1.8)) / 3;
        b.rod('trim', [x, y0, -(d / 2 - 1.15)], [x, y1, d / 2 - 1.15], 0.06, 6);
        b.rod('trim', [x, y0, d / 2 - 1.15], [x, y1, -(d / 2 - 1.15)], 0.06, 6);
        b.rod('trim', [x, y1, -(d / 2 - 1.1)], [x, y1, d / 2 - 1.1], 0.07, 6);
      }
      // Bogies with wheels on the rail.
      b.box('dark', [0.9, 0.55, d + 0.4], [x, 0.38, 0]);
      for (const z of [-d / 2, -d / 2 + 0.7, d / 2 - 0.7, d / 2]) b.cyl('metal', 0.25, 0.25, 0.2, [x, 0.25, z], [0, 0, Math.PI / 2], 12);
      for (const sz of [-1, 1]) for (let i = 0; i < 4; i++) b.tinted(i % 2 ? '#1d1e1c' : '#d9b42c', () => b.box('paint', [0.92, 0.12, 0.2], [x, 0.4, sz * (d / 2 + 0.1) + sz * 0.0 - 0.15 * i * sz]));
    }
    // Girder: box with stiffeners, a walkway with railing on the +z side.
    b.box('body', [w + 1, girder, 1.4], [0.5, h - girder / 2, 0]);
    for (let x = -w / 2; x <= w / 2 + 1; x += 1.2) for (const s of [-1, 1]) b.box('trim', [0.08, girder - 0.1, 0.06], [x, h - girder / 2, s * 0.72]);
    b.box('mesh', [w + 1, 0.05, 0.8], [0.5, h - girder + 0.1, 1.1]);
    for (let x = -w / 2; x <= w / 2 + 1; x += 1.5) b.rod('metal', [x, h - girder + 0.1, 1.48], [x, h - girder + 1.1, 1.48], 0.02, 4);
    b.rod('metal', [-w / 2, h - girder + 1.1, 1.48], [w / 2 + 1, h - girder + 1.1, 1.48], 0.025, 4);
    // Trolley, hoist rope and hook block.
    const tx = w * 0.15;
    b.box('dark', [1.6, 0.7, 1.8], [tx, h - girder - 0.35, 0]);
    b.tinted('#d9b42c', () => b.box('paint', [1.2, 0.3, 1.2], [tx, h - girder - 0.85, 0]));
    const hookY = h * 0.32;
    for (const s of [-0.12, 0.12]) b.rod('metal', [tx + s, h - girder - 1.0, 0], [tx + s, hookY + 0.35, 0], 0.015, 4);
    b.tinted('#d9b42c', () => b.box('paint', [0.5, 0.45, 0.3], [tx, hookY + 0.15, 0]));
    b.tube('metal', [[tx, hookY - 0.05, 0], [tx + 0.12, hookY - 0.25, 0], [tx, hookY - 0.4, 0], [tx - 0.1, hookY - 0.3, 0]], 0.04, 8, 6);
    // Cab under the girder at the -x end.
    const cxp = -w / 2 + 1.4;
    b.box('body', [1.6, 1.4, 1.5], [cxp, h - girder - 1.3, 0]);
    for (const s of [-1, 1]) b.box('glass', [1.3, 0.8, 0.03], [cxp, h - girder - 1.15, s * 0.76]);
    b.box('glass', [0.03, 0.8, 1.2], [cxp + 0.81, h - girder - 1.15, 0]);
    // Only the legs block.
    const cols: KitBox[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cols.push({ center: [sx * (w / 2 - legW / 2), lh / 2, sz * (d / 2 - 1)], size: [legW, lh, legW] });
    return cols;
  },

};

/**
 * One sandbag lying along x: a prism with an octagonal cross-section (chamfered
 * long edges), no faces underneath. 24 triangles, non-indexed with flat normals;
 * a wall has hundreds of them (the capsules they replaced had 72 each and made
 * Iron Gate's sandbag walls 540k vertices, 2026-10-10).
 */
function bagGeometry(length: number, height: number, thick: number): THREE.BufferGeometry {
  const a = height / 2;
  const t = thick / 2;
  const c = Math.min(a, t) * 0.55;
  // Octagon in (y, z), counter-clockwise seen from +x.
  const ring: [number, number][] = [
    [-a, -t + c],
    [-a, t - c],
    [-a + c, t],
    [a - c, t],
    [a, t - c],
    [a, -t + c],
    [a - c, -t],
    [-a + c, -t],
  ];
  const x0 = -length / 2;
  const x1 = length / 2;
  const pos: number[] = [];
  const tri = (p: number[], q: number[], r: number[]) => pos.push(...p, ...q, ...r);
  for (let i = 0; i < 8; i++) {
    if (i === 0) continue; // the bottom side
    const [ya, za] = ring[i]!;
    const [yb, zb] = ring[(i + 1) % 8]!;
    tri([x0, ya, za], [x1, ya, za], [x1, yb, zb]);
    tri([x0, ya, za], [x1, yb, zb], [x0, yb, zb]);
  }
  // End caps: a fan from the first corner.
  for (let i = 1; i < 7; i++) {
    const [y0, z0] = ring[0]!;
    const [ya, za] = ring[i]!;
    const [yb, zb] = ring[i + 1]!;
    tri([x1, y0, z0], [x1, yb, zb], [x1, ya, za]);
    tri([x0, y0, z0], [x0, ya, za], [x0, yb, zb]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // World-meter UVs like the other kit pieces' boxes: u along the bag, v round it.
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i]!, pos[i + 1]! + pos[i + 2]!);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Shared looks for kit pieces that don't use the object's own surface. */
export function kitMaterials(): Record<Exclude<KitMaterial, 'body' | 'trim' | 'metal' | 'wood' | 'concrete' | 'dirt'>, THREE.Material> {
  return {
    paint: new THREE.MeshStandardMaterial({ color: 0x5d6152, roughness: 0.6, metalness: 0.3 }),
    straw: new THREE.MeshStandardMaterial({ color: 0xb89a5a, roughness: 0.95 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1d1f1f, roughness: 0.7, metalness: 0.3 }),
    // Real glass: a dark dielectric that mirrors only at grazing angles (it was a
    // half-metal that showed the sky as a bright blue panel from every side).
    glass: new THREE.MeshStandardMaterial({ color: 0x0c1114, roughness: 0.1, metalness: 0.1, envMapIntensity: 0.3 }),
    // Weathered bronze: dark brown with a little green, a dull sheen.
    bronze: new THREE.MeshStandardMaterial({ color: 0x3b3626, roughness: 0.55, metalness: 0.6, envMapIntensity: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }),
    canvas: new THREE.MeshStandardMaterial({ color: 0x5f6146, roughness: 0.95 }),
    light: new THREE.MeshStandardMaterial({ color: 0xe8e4d0, emissive: 0x3a382c, roughness: 0.3 }),
    redLight: new THREE.MeshStandardMaterial({ color: 0x9a1c16, emissive: 0x2a0503, roughness: 0.4 }),
    water: new THREE.MeshStandardMaterial({ color: 0x2c4550, roughness: 0.05, metalness: 0.2 }),
    mesh: new THREE.MeshStandardMaterial({ color: 0x6b6c63, roughness: 0.6, metalness: 0.6 }),
    snow: new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.85 }),
  };
}
