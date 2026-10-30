import * as THREE from 'three';
import type { KitBuilder, KitMaterial } from './modelKits';

type V3 = [number, number, number];
type Surface = (u: number, v: number) => V3;

/**
 * A parked saloon car (2026-10-30, props rework: the old one was two extruded
 * outlines, flat sides with the wheels hidden behind them). Built from smooth
 * surfaces in kit space (y = 0 on the ground, front +z):
 * - the lower body, lofted along the car from cross-sections: a side that
 *   tucks under at the sill and leans in at the shoulder, a rounded shoulder,
 *   a crowned top; the side profile drops to the nose and the tail, the ends
 *   round off, and the sill line rises over each wheel (arches with dark
 *   liners, so the wheels show);
 * - the glasshouse on the belt line, narrowing to the roof, the windscreen and
 *   rear window sloped; the roof panel and the A / B / C pillars in body
 *   colour laid over it;
 * - wrap-round bumpers, lamp lenses, a grille, mirrors, door seams and handles.
 * Every surface has a coarse copy as its far look (kits switch past 60 m);
 * seams, handles and wheel-arch liners are left out of it.
 * The collider stays the map's box: everything stays inside w x h x d.
 */
export function buildSedan(b: KitBuilder, w: number, h: number, d: number): void {
  const hw = w / 2 - 0.06;
  const L = d - 0.12;
  const zF = L / 2;
  const r = 0.33;
  const y0 = 0.3;
  const belt = Math.min(h * 0.62, 0.95);
  const roof = h - 0.04;
  const wheelZ = [zF - 0.86, -zF + 0.92];
  const arch = 0.41;
  // Glasshouse along z: rear window base / top, windscreen top / base.
  const zr0 = -0.34 * L;
  const zr1 = -0.2 * L;
  const zw1 = 0.05 * L;
  const zw0 = 0.22 * L;

  /** Smooth 1-D curve through knots [x, y] (Catmull-Rom, clamped ends). */
  const curve = (knots: [number, number][]) => (x: number) => {
    if (x <= knots[0]![0]) return knots[0]![1];
    const n = knots.length;
    if (x >= knots[n - 1]![0]) return knots[n - 1]![1];
    let i = 0;
    while (knots[i + 1]![0] < x) i++;
    const p0 = knots[Math.max(0, i - 1)]![1];
    const p1 = knots[i]![1];
    const p2 = knots[i + 1]![1];
    const p3 = knots[Math.min(n - 1, i + 2)]![1];
    const t = (x - knots[i]![0]) / (knots[i + 1]![0] - knots[i]![0]);
    const t2 = t * t;
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t2 * t);
  };
  // Top of the lower body along the car (s = z / L): nose, bonnet, belt, boot lid, tail.
  const topAt = curve([
    [-0.5, belt - 0.12],
    [-0.47, belt - 0.02],
    [-0.42, belt + 0.02],
    [-0.3, belt + 0.01],
    [0.22, belt],
    [0.32, belt - 0.05],
    [0.45, belt - 0.15],
    [0.5, belt - 0.24],
  ]);
  /** Bottom edge of the body side: the sill, rising round each wheel. */
  const sillAt = (z: number) => {
    let y = y0;
    for (const wz of wheelZ) {
      const dz = Math.abs(z - wz);
      if (dz < arch) y = Math.max(y, y0 + Math.sqrt(arch * arch - dz * dz) * 1.02);
    }
    return y;
  };
  /** Rounded ends: the section shrinks toward its middle over the last ~16 cm. */
  const END = 0.16;
  const endScale = (z: number) => {
    const t = (Math.abs(z) - (zF - END)) / END;
    return t <= 0 ? 1 : Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, t), 2.2)), 1 / 2.2);
  };
  /** Half-width in plan, pinched a little toward the corners. */
  const halfWidth = (z: number) => hw * (1 - 0.05 * Math.pow(Math.abs(z) / zF, 6));

  /**
   * Point on one half of a body section, t from the sill (0) up the side, round
   * the shoulder, to the middle of the top (1): [x >= 0, y].
   */
  const section = (t: number, half: number, bottom: number, top: number, rc: number, lean: number, tuck: number): [number, number] => {
    const side = 0.42;
    const bend = 0.8;
    const cx = half - lean - rc;
    const cy = top - rc;
    if (t <= side) {
      const s = t / side;
      return [half - lean * s * s - tuck * Math.pow(1 - s, 6), bottom + s * (cy - bottom)];
    }
    if (t <= bend) {
      const a = ((t - side) / (bend - side)) * (Math.PI / 2);
      return [cx + rc * Math.cos(a), cy + rc * Math.sin(a)];
    }
    const s = (t - bend) / (1 - bend);
    return [cx * (1 - s), top + 0.02 * (1 - (1 - s) * (1 - s))];
  };
  /** v in 0..1 across the whole section: right sill, over the top, left sill. */
  const across = (v: number): [number, number] => (v < 0.5 ? [1, v * 2] : [-1, (1 - v) * 2]);

  /** The lower body at (z, v); off pushes the point out along the section's normal. */
  const lower = (z: number, v: number, off = 0): V3 => {
    const [sx, t] = across(v);
    const bottom = sillAt(z);
    const top = Math.max(topAt(z / L), bottom + 0.12);
    const rc = Math.min(0.13, (top - bottom) * 0.45);
    const p = section(t, halfWidth(z), bottom, top, rc, 0.03, 0.03);
    const q = section(Math.min(1, t + 0.01), halfWidth(z), bottom, top, rc, 0.03, 0.03);
    const nx = q[1] - p[1];
    const ny = -(q[0] - p[0]);
    const nl = Math.hypot(nx, ny) || 1;
    let x = p[0] + (nx / nl) * off;
    let y = p[1] + (ny / nl) * off;
    const k = endScale(z);
    const mid = (bottom + top) / 2;
    x *= k;
    y = mid + (y - mid) * k;
    return [sx * x, y, z];
  };

  // Glasshouse height along z (0 outside it).
  const Hmax = roof - belt;
  const easeUp = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 1.7);
  const glassH = (z: number) => {
    if (z <= zr0 || z >= zw0) return 0;
    if (z < zr1) return Hmax * easeUp((z - zr0) / (zr1 - zr0));
    if (z > zw1) return Hmax * easeUp((zw0 - z) / (zw0 - zw1));
    return Hmax;
  };
  const hwg = hw - 0.07;
  const SINK = 0.06;
  const glass = (z: number, v: number, off = 0): V3 => {
    const [sx, t] = across(v);
    const H = glassH(z);
    // The full-height section (from 6 cm under the belt, inside the body's shoulder), squashed to the height there.
    const p = section(t, hwg, 0, Hmax + SINK, 0.12, hwg * 0.2, 0);
    const q = section(Math.min(1, t + 0.01), hwg, 0, Hmax + SINK, 0.12, hwg * 0.2, 0);
    const f = H / Hmax;
    const nx = (q[1] - p[1]) * f;
    const ny = -(q[0] - p[0]);
    const nl = Math.hypot(nx, ny) || 1;
    return [sx * (p[0] + (nx / nl) * off), belt - SINK + p[1] * f + (ny / nl) * off, z];
  };

  const centre = new THREE.Vector3(0, belt * 0.8, 0);
  /** A smooth surface with a coarse copy as its far look (or none), wound to face out from the car's middle. */
  const part = (mat: KitMaterial, nu: number, nv: number, f: Surface, far: [number, number] | null) => {
    let farGeo: THREE.BufferGeometry | null = null;
    if (far) {
      b.grid(mat, far[0], far[1], f);
      farGeo = outward(b.pieces.pop()!.geo, centre);
    }
    b.grid(mat, nu, nv, f);
    const piece = b.pieces[b.pieces.length - 1]!;
    piece.geo = outward(piece.geo, centre);
    piece.far = farGeo;
  };
  const span = (a: number, c: number, u: number) => a + (c - a) * u;
  /** A lamp lens: the outer half of an ellipsoid (the inner half would be inside the body), facing e along z. */
  const lens = (mat: KitMaterial, at: V3, rad: V3, e: number) => {
    part(mat, 8, 4, (u, v) => {
      const a = u * Math.PI * 2;
      const c = v * (Math.PI / 2);
      return [at[0] + Math.cos(a) * Math.sin(c) * rad[0], at[1] + Math.sin(a) * Math.sin(c) * rad[1], at[2] + e * Math.cos(c) * rad[2]];
    }, [6, 2]);
  };

  // Lower body: rows along the car packed where the sill bends round the arches and the ends round off.
  const zAt = rowSpacing(-zF, zF, (z) => 1 + (wheelZ.some((wz) => Math.abs(z - wz) < arch + 0.05) ? 3 : 0) + (Math.abs(z) > zF - END ? 2.5 : 0));
  part('body', 36, 20, (u, v) => lower(zAt(u), v), [14, 8]);
  // Glasshouse.
  part('glass', 18, 12, (u, v) => glass(span(zr0, zw0, u), v), [8, 6]);
  // Roof panel and pillars over the glass, in body colour.
  const edge = 0.43; // section t where the side glass meets the roof
  const tAcross = (side: number, t: number) => (side > 0 ? t / 2 : 1 - t / 2);
  part('body', 14, 8, (u, v) => glass(span(zr1 - 0.06, zw1 + 0.04, u), span(edge / 2, 1 - edge / 2, v), 0.008), [4, 4]);
  for (const s of [1, -1]) {
    // A pillar: the windscreen's edge, cowl corner to roof corner.
    part('body', 10, 2, (u, v) => glass(span(zw0, zw1, u), tAcross(s, Math.max(0, span(0, edge, u) + (v - 0.5) * 0.09)), 0.008), null);
    // B pillar between the doors.
    const zb = span(zr1, zw1, 0.42);
    part('body', 6, 2, (u, v) => glass(zb + (v - 0.5) * 0.09, tAcross(s, span(0, edge, u)), 0.008), [2, 1]);
    // C pillar: broad, from the boot lid's corner up to the roof.
    part('body', 10, 3, (u, v) => glass(span(zr0, zr1 + 0.05, u), tAcross(s, Math.max(0, span(0, edge, u) + (v - 0.5) * 0.2)), 0.008), [3, 1]);
  }

  // Wheel-arch liners (dark, seen from both sides) with an inner wall, and the wheels.
  for (const wz of wheelZ)
    for (const s of [-1, 1]) {
      // Seen from under the arch only: wound to face the wheel's axis; the wall faces out.
      b.grid('dark', 10, 1, (u, v) => {
        const a = Math.PI * u;
        return [s * (hw + 0.01 - v * 0.42), y0 + Math.sin(a) * arch, wz + Math.cos(a) * arch];
      });
      const liner = b.pieces[b.pieces.length - 1]!;
      outward(liner.geo, new THREE.Vector3(s * (hw - 0.2), y0 - 2, wz), -1);
      liner.far = null;
      b.grid('dark', 10, 1, (u, v) => {
        const a = Math.PI * u;
        return [s * (hw - 0.41), y0 + Math.sin(a) * arch * v, wz + Math.cos(a) * arch * v];
      });
      const wall = b.pieces[b.pieces.length - 1]!;
      outward(wall.geo, new THREE.Vector3(0, y0, wz));
      wall.far = null;
      // Tyre with a rounded shoulder, a steel rim set into it, a small hub cap.
      const x = s * (hw - 0.12);
      b.lathe('rubber', [[r * 0.62, -0.1], [r - 0.02, -0.105], [r, -0.06], [r, 0.06], [r - 0.02, 0.105], [r * 0.62, 0.1]], [0, 0, 0], 16);
      b.pieces[b.pieces.length - 1]!.geo.rotateZ(Math.PI / 2).translate(x, r, wz);
      b.cyl('metal', r * 0.62, r * 0.62, 0.2, [x, r, wz], [0, 0, Math.PI / 2], 14);
      b.cyl('metal', r * 0.2, r * 0.24, 0.04, [x + s * 0.1, r, wz], [0, 0, s * Math.PI / 2], 8);
    }
  // Underside, so the gap under the sill shows no daylight.
  b.box('dark', [hw * 2 - 0.3, 0.1, L - 0.5], [0, y0 - 0.04, 0]);

  // Bumpers: bars wrapping round the corners.
  for (const e of [1, -1]) {
    const zb = e * (zF + 0.02);
    const y = e > 0 ? 0.43 : 0.46;
    const pts: V3[] = [
      [-hw + 0.03, y, zb - e * 0.42],
      [-hw + 0.1, y, zb - e * 0.1],
      [-hw + 0.42, y, zb],
      [hw - 0.42, y, zb],
      [hw - 0.1, y, zb - e * 0.1],
      [hw - 0.03, y, zb - e * 0.42],
    ];
    b.tube('dark', pts, 0.075, 4, 3);
    const far = b.pieces.pop()!.geo;
    b.tube('dark', pts, 0.075, 16, 6);
    b.pieces[b.pieces.length - 1]!.far = far;
  }

  /** Where the body's surface is at (x, y) on the front (e = 1) or back (-1) end. */
  const onEnd = (x: number, y: number, e: number): V3 => {
    let best: V3 = [x, y, e * zF];
    let bestD = Infinity;
    for (let i = 0; i <= 40; i++) {
      const z = e * (zF - END + (END * i) / 40);
      for (let j = 0; j <= 60; j++) {
        const p = lower(z, j / 120 + (x < 0 ? 0.5 : 0));
        const dd = Math.abs(Math.abs(p[0]) - Math.abs(x)) + Math.abs(p[1] - y);
        if (dd < bestD) {
          bestD = dd;
          best = [x, y, p[2]];
        }
      }
    }
    return best;
  };
  const noseTop = topAt(0.5);
  const tailTop = topAt(-0.5);
  for (const s of [-1, 1]) {
    // Headlamps and tail lamps: flattened lenses set into the rounded ends.
    lens('light', onEnd(s * (hw - 0.27), noseTop - 0.07, 1), [0.17, 0.062, 0.05], 1);
    lens('redLight', onEnd(s * (hw - 0.22), tailTop - 0.08, -1), [0.19, 0.06, 0.045], -1);
    // Mirrors on the doors at the windscreen's foot.
    b.box('body', [0.16, 0.1, 0.07], [s * (hwg + 0.12), belt + 0.08, zw0 - 0.1]);
    b.box('dark', [0.08, 0.03, 0.03], [s * (hwg + 0.04), belt + 0.06, zw0 - 0.1]);
    // Door seams and handles on the side (thin: near look only).
    const sideAt = (z: number, y: number): V3 => {
      let best = lower(z, 0);
      for (let j = 0; j <= 40; j++) {
        const p = lower(z, j / 80);
        if (Math.abs(p[1] - y) < Math.abs(best[1] - y)) best = p;
      }
      return [s * (Math.abs(best[0]) + 0.003), y, z];
    };
    const zb = span(zr1, zw1, 0.42);
    for (const z of [zw0 - 0.05, zb, zr0 + 0.12]) {
      const pts: V3[] = [];
      for (let i = 0; i <= 5; i++) pts.push(sideAt(z, span(sillAt(z) + 0.04, belt - 0.03, i / 5)));
      b.tube('dark', pts, 0.006, 4, 3);
    }
    for (const z of [zb + 0.32, zr0 + 0.42]) b.box('dark', [0.02, 0.025, 0.14], sideAt(z, belt - 0.1));
  }
  // Grille between the headlamps, number plates.
  const gr = onEnd(0, noseTop - 0.1, 1);
  b.box('dark', [hw * 0.9, 0.12, 0.05], [0, gr[1], gr[2] - 0.01]);
  b.box('light', [0.42, 0.1, 0.02], [0, 0.43, zF + 0.1]);
  const pr = onEnd(0, tailTop - 0.2, -1);
  b.box('light', [0.42, 0.1, 0.02], [0, tailTop - 0.2, pr[2] - 0.01]);
}

/**
 * Maps 0..1 to a..b with steps shorter where `density` is higher (rows of a
 * lofted surface packed where its shape changes fast).
 */
function rowSpacing(a: number, b: number, density: (x: number) => number): (u: number) => number {
  const N = 200;
  const cum = [0];
  for (let i = 0; i < N; i++) cum.push(cum[i]! + density(a + ((b - a) * (i + 0.5)) / N));
  const total = cum[N]!;
  return (u: number) => {
    const target = u * total;
    let i = 0;
    while (i < N - 1 && cum[i + 1]! < target) i++;
    const f = (target - cum[i]!) / Math.max(1e-9, cum[i + 1]! - cum[i]!);
    return a + ((b - a) * (i + Math.min(1, Math.max(0, f)))) / N;
  };
}

/** Winds a surface's triangles to face away from `c` (toward it with sign -1): flips them, normals too, when most face the other way. */
function outward(g: THREE.BufferGeometry, c: THREE.Vector3, sign = 1): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  let score = 0;
  for (let i = 0; i < pos.count; i++) score += (pos.getX(i) - c.x) * nrm.getX(i) + (pos.getY(i) - c.y) * nrm.getY(i) + (pos.getZ(i) - c.z) * nrm.getZ(i);
  if (score * sign >= 0) return g;
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    const n = a.itemSize;
    const arr = a.array as Float32Array;
    for (let t = 0; t < a.count; t += 3)
      for (let k = 0; k < n; k++) {
        const x = arr[(t + 1) * n + k]!;
        arr[(t + 1) * n + k] = arr[(t + 2) * n + k]!;
        arr[(t + 2) * n + k] = x;
      }
  }
  const na = nrm.array as Float32Array;
  for (let i = 0; i < na.length; i++) na[i] = -na[i]!;
  return g;
}
