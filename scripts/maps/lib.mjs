// Shared helpers for map generators (meters; x east, z south, north = -z).

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Chaikin smoothing for a closed polygon. */
export function smoothClosed(pts, iters = 1) {
  for (let k = 0; k < iters; k++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      out.push([0.75 * x1 + 0.25 * x2, 0.75 * z1 + 0.25 * z2], [0.25 * x1 + 0.75 * x2, 0.25 * z1 + 0.75 * z2]);
    }
    pts = out;
  }
  return pts;
}

/** Chaikin smoothing for an open polyline (keeps the end points). */
export function smoothOpen(pts, iters = 2) {
  for (let k = 0; k < iters; k++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[i + 1];
      out.push([0.75 * x1 + 0.25 * x2, 0.75 * z1 + 0.25 * z2], [0.25 * x1 + 0.75 * x2, 0.25 * z1 + 0.75 * z2]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

export function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function segDist(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

export function lineDist(px, pz, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, segDist(px, pz, pts[i], pts[i + 1]));
  return best;
}

export function edgeDist(poly, x, z) {
  return lineDist(x, z, [...poly, poly[0]]);
}

/** Direction (degrees, map yaw convention: 0 faces -z) of the nearest segment of a polyline. */
export function lineYaw(px, pz, pts) {
  let best = Infinity;
  let yaw = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segDist(px, pz, pts[i], pts[i + 1]);
    if (d < best) {
      best = d;
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      yaw = (Math.atan2(bx - ax, bz - az) * 180) / Math.PI;
    }
  }
  return yaw;
}

/**
 * Flat boxes laid along a polyline (roads, rails). Each segment is one box,
 * slightly overlapping the next; `snap` puts it on the terrain.
 */
export function stripAlong(pts, width, { thickness = 0.3, y = 0.05, material = 'concrete_floor', color, type = 'floor', maxLen = 8 } = {}) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / maxLen));
    for (let k = 0; k < n; k++) {
      const x0 = ax + ((bx - ax) * k) / n;
      const z0 = az + ((bz - az) * k) / n;
      const x1 = ax + ((bx - ax) * (k + 1)) / n;
      const z1 = az + ((bz - az) * (k + 1)) / n;
      const yaw = (Math.atan2(x1 - x0, z1 - z0) * 180) / Math.PI;
      out.push({
        type,
        pos: [round((x0 + x1) / 2), y - thickness / 2, round((z0 + z1) / 2)],
        size: [width, thickness, round(len / n + width * 0.35)],
        rot: [0, round(yaw, 1), 0],
        material,
        ...(color ? { color } : {}),
        snap: true,
      });
    }
  }
  return out;
}

/**
 * An axis-aligned or rotated box sitting on the ground (bottom at ground + lift).
 * `model` draws a procedural model (src/world/modelKits.ts) filling the box.
 */
export function block(x, z, w, h, d, { yaw = 0, lift = 0, type = 'cover', material, color, sink = 0.3, model } = {}) {
  return {
    type,
    pos: [round(x), round(lift + (h - sink) / 2), round(z)],
    size: [round(w), round(h + sink), round(d)],
    ...(yaw ? { rot: [0, round(yaw, 1), 0] } : {}),
    ...(material ? { material } : {}),
    ...(color ? { color } : {}),
    ...(model ? { model, base: round(sink) } : {}),
    snap: true,
  };
}

/** A wall line made of boxes between points, with optional gaps (distance ranges along the line). */
export function wallLine(pts, { height = 3, thick = 0.4, material = 'concrete', color, gaps = [], type = 'wall', model } = {}) {
  const out = [];
  let dist = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    // Split this segment around any gaps that fall on it.
    let pieces = [[0, len]];
    for (const [g0, g1] of gaps) {
      const s0 = g0 - dist;
      const s1 = g1 - dist;
      pieces = pieces.flatMap(([p0, p1]) => {
        if (s1 <= p0 || s0 >= p1) return [[p0, p1]];
        const res = [];
        if (s0 > p0) res.push([p0, s0]);
        if (s1 < p1) res.push([s1, p1]);
        return res;
      });
    }
    const yaw = (Math.atan2(bx - ax, bz - az) * 180) / Math.PI;
    for (const [p0, p1] of pieces) {
      if (p1 - p0 < 0.2) continue;
      const m = (p0 + p1) / 2 / len;
      out.push(block(ax + (bx - ax) * m, az + (bz - az) * m, thick, height, p1 - p0 + thick, { yaw, type, material, color, model }));
    }
    dist += len;
  }
  return out;
}

/** Extra points along a polyline so no piece is longer than `step`. */
export function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/**
 * Local frame at (cx, cz) turned by `yaw` degrees, same convention as building
 * `rot` and object yaw: returns (u, v) -> [x, z] (u = local x, v = local z).
 */
export function localFrame(cx, cz, yaw = 0) {
  const a = (yaw * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (u, v) => [cx + u * c + v * s, cz - u * s + v * c];
}

/** Normalised radius of (x, z) in an ellipse (centre, radii, yaw in degrees): < 1 inside. */
export function ellipseIn(x, z, cx, cz, rx, rz, yaw = 0) {
  const a = (yaw * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - cx;
  const dz = z - cz;
  // Inverse of localFrame's rotation.
  const u = dx * c - dz * s;
  const v = dx * s + dz * c;
  return Math.hypot(u / rx, v / rz);
}

/** Z of a polyline running west to east at x (clamped to its ends). */
export function zAtX(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    if ((x - ax) * (x - bx) <= 0 && ax !== bx) return az + ((bz - az) * (x - ax)) / (bx - ax);
  }
  return pts[pts.length - 1][1];
}

/**
 * A point beside a polyline: `frac` of the way along it, `off` meters to its
 * left (negative: right), with the line's unit direction there.
 */
export function besideLine(pts, frac, off) {
  const lens = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    lens.push(l);
    total += l;
  }
  let d = Math.max(0, Math.min(1, frac)) * total;
  let i = 0;
  while (i < lens.length - 1 && d > lens[i]) d -= lens[i++];
  const [ax, az] = pts[i];
  const [bx, bz] = pts[i + 1];
  const L = lens[i] || 1;
  const dx = (bx - ax) / L;
  const dz = (bz - az) / L;
  const t = d / L;
  return { x: ax + (bx - ax) * t + dz * off, z: az + (bz - az) * t - dx * off, dx, dz };
}
