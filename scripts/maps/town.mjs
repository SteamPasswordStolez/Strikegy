// Shared kit for the generated maps (2026-10-11 redesigns): occupancy by oriented boxes,
// roads that keep buildings off them, street frontages of enterable buildings, ruins,
// clutter, copses, and a mirror of the engine's terrain height (hills + pads) for slope
// checks. `createTown(R, { inMap, terrain, zones, ... })` returns helpers bound to one map.
import { block, densify, inside, lineDist, round, smoothOpen, stripAlong, wallLine } from './lib.mjs';

export const DEG = Math.PI / 180;

/** Oriented box: centre, half sizes (plus pad) and its axes. */
export function obb(x, z, w, d, yawDeg = 0, pad = 0) {
  const c = Math.cos(yawDeg * DEG);
  const s = Math.sin(yawDeg * DEG);
  return { x, z, hw: w / 2 + pad, hd: d / 2 + pad, ax: [c, -s], az: [s, c] };
}
export function overlap(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [ux, uz] of [a.ax, a.az, b.ax, b.az]) {
    const ra = a.hw * Math.abs(a.ax[0] * ux + a.ax[1] * uz) + a.hd * Math.abs(a.az[0] * ux + a.az[1] * uz);
    const rb = b.hw * Math.abs(b.ax[0] * ux + b.ax[1] * uz) + b.hd * Math.abs(b.az[0] * ux + b.az[1] * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}
/** Points over a box: centre, corners and along the edges every `step` m. */
export function samples(r, step = 2) {
  const at = (u, w) => [r.x + u * r.ax[0] + w * r.az[0], r.z + u * r.ax[1] + w * r.az[1]];
  const pts = [[r.x, r.z]];
  const nx = Math.max(1, Math.ceil((2 * r.hw) / step));
  const nz = Math.max(1, Math.ceil((2 * r.hd) / step));
  for (let i = 0; i <= nx; i++) for (const s of [-1, 1]) pts.push(at(-r.hw + (2 * r.hw * i) / nx, s * r.hd));
  for (let i = 1; i < nz; i++) for (const s of [-1, 1]) pts.push(at(s * r.hw, -r.hd + (2 * r.hd * i) / nz));
  return pts;
}
/** A local frame at `o` turned by `deg` (map yaw): local x -> world (cos, -sin), local z -> (sin, cos). */
export function frame(o, deg) {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  const f = (lx, lz) => [round(o[0] + lx * c + lz * s), round(o[1] - lx * s + lz * c)];
  f.deg = deg;
  return f;
}
/** Euler XYZ (degrees) for a box turned by yaw, then tipped by pitch about its own x axis. */
export function yawPitch(yawDeg, pitchDeg) {
  const p = yawDeg * DEG;
  const t = pitchDeg * DEG;
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  const st = Math.sin(t);
  const ct = Math.cos(t);
  return [round(Math.atan2(st, cp * ct) / DEG, 2), round(Math.asin(sp * ct) / DEG, 2), round(Math.atan2(-sp * st, cp) / DEG, 2)];
}
/** Point and direction at distance `s` along a polyline. */
export function along(pts, s) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (s <= len || i === pts.length - 2) {
      const t = len ? Math.min(1, s / len) : 0;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx: (bx - ax) / (len || 1), tz: (bz - az) / (len || 1), yaw: (Math.atan2(bx - ax, bz - az) * 180) / Math.PI };
    }
    s -= len;
  }
  return null;
}
export const lengthOf = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
/** The distance along a polyline of the point nearest x. */
export function sAtX(pts, x) {
  let best = Infinity;
  let at = 0;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const d = Math.abs((pts[i][0] + pts[i + 1][0]) / 2 - x);
    if (d < best) {
      best = d;
      at = acc + len / 2;
    }
    acc += len;
  }
  return at;
}

/** The engine's height inside the map (Terrain.heightAt) without noise and rivers. */
export function heightFn(terrain) {
  const hills = terrain.hills ?? [];
  const flats = terrain.flats ?? [];
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const land = terrain.land;
  const ring = land ? [...land.outline, land.outline[0]] : null;
  const landAt = (x, z) => {
    if (!land) return 0;
    const d = lineDist(x, z, ring);
    return inside(land.outline, x, z) ? land.height * smooth(0, land.inland, d) : -land.depth * smooth(0, land.shelf, d);
  };
  const hillsAt = (x, z) => {
    let h = landAt(x, z);
    for (const hl of hills) {
      const d = Math.hypot(x - hl.pos[0], z - hl.pos[1]) / hl.radius;
      if (d < 1) h += hl.height * (0.5 + 0.5 * Math.cos(Math.PI * d));
    }
    return h;
  };
  return (x, z) => {
    let h = hillsAt(x, z);
    for (const p of flats) {
      const d = Math.hypot(x - p.pos[0], z - p.pos[1]);
      const bl = p.blend ?? 8;
      if (d >= p.radius + bl) continue;
      const t = p.height ?? hillsAt(p.pos[0], p.pos[1]);
      h += (t - h) * (1 - smooth(p.radius, p.radius + bl, d));
    }
    return h;
  };
}

/**
 * Helpers bound to one map. opts: inMap(x, z, pad), terrain (for slopes), zones { id: [x, z] },
 * radii { id: r }, blocked(x, z, pad) — extra no-build test (rivers, rails...).
 */
export function createTown(R, opts) {
  const { inMap, terrain = {}, zones = {}, radii = {}, blocked = () => false } = opts;
  const objects = [];
  const buildings = [];
  const props = [];
  const trees = [];
  const occ = [];
  const roads = [];
  const H = heightFn(terrain);
  const pick = (list) => list[Math.floor(R() * list.length)];
  const between = (a, b) => a + R() * (b - a);
  const occupy = (x, z, w, d, yaw = 0, pad = 0) => occ.push(obb(x, z, w, d, yaw, pad));
  const isFree = (r) => occ.every((o) => !overlap(o, r));
  function put(o) {
    objects.push(o);
    if (o.type !== 'floor' || o.size[1] > 0.6) occupy(o.pos[0], o.pos[2], o.size[0], o.size[2], o.rot?.[1] ?? 0);
    return o;
  }
  const putAll = (list) => list.forEach(put);
  const paint = ([x, z], w, d, yaw, y, color, material = 'concrete_floor') =>
    objects.push({ type: 'floor', pos: [round(x), round(y - 0.15), round(z)], size: [round(w, 2), 0.3, round(d, 2)], ...(yaw ? { rot: [0, round(yaw, 1), 0] } : {}), material, color, snap: true });
  function addBuilding(b) {
    buildings.push({ ...b, pos: [round(b.pos[0]), round(b.pos[1])], size: [round(b.size[0], 1), round(b.size[1], 1)], ...(b.rot !== undefined ? { rot: round(b.rot, 1) } : {}) });
    occupy(b.pos[0], b.pos[1], b.size[0], b.size[1], b.rot ?? 0, 0.3);
    return b;
  }
  const building = (f, lx, lz, w, d, o = {}) => addBuilding({ pos: f(lx, lz), size: [w, d], ...o, rot: round(f.deg + (o.rot ?? 0), 1) });
  const thing = (f, lx, lz, w, h, d, o = {}) => put(block(...f(lx, lz), w, h, d, { ...o, yaw: f.deg + (o.yaw ?? 0) }));
  const slopeUnder = (r) => {
    const hs = samples(r, 3).map(([x, z]) => H(x, z));
    return Math.max(...hs) - Math.min(...hs);
  };

  /** A road: painted strips (and a pavement for town streets), remembered for keeping things off it. */
  function road(pts, w, { y = 0.05, color = '#4f4e4b', smooth = 2, town = false, material = 'asphalt', pave = '#a29d92', paveMaterial = 'cobble', keep = () => true } = {}) {
    const line = smooth ? smoothOpen(pts, smooth) : pts;
    const xs = line.map((p) => p[0]);
    const zs = line.map((p) => p[1]);
    const r = { pts: line, w, town, bb: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
    roads.push(r);
    const ok = (s) => inMap(s.pos[0], s.pos[2], -3) && keep(s.pos[0], s.pos[2]);
    objects.push(...stripAlong(line, w, { color, y, material }).filter(ok));
    if (town) objects.push(...stripAlong(line, w + 3.4, { color: pave, material: paveMaterial, y: 0.03 }).filter(ok));
    return r;
  }
  const offRoad = (x, z, pad) =>
    roads.every((r) => {
      const m = r.w / 2 + pad;
      if (x < r.bb[0] - m || x > r.bb[2] + m || z < r.bb[1] - m || z > r.bb[3] + m) return true;
      return lineDist(x, z, r.pts) >= m;
    });

  // --- Kits ---
  const SAND = opts.sand ?? '#9c8f76';
  const WOOD = '#6e5a44';
  const STONE = opts.stone ?? '#8d887e';
  const CAR_COLORS = opts.carColors ?? ['#5a2a24', '#2e3f55', '#8f8a7c', '#4c5a3a', '#3c3c3a', '#6b5a3c'];
  const WRECK = ['#2b2724', '#3a302a', '#4a3d33'];
  const kit = {
    car: (x, z, yaw, color = pick(CAR_COLORS)) => put(block(x, z, 1.9, 1.5, 4.4, { yaw, material: 'metal', color, model: 'car' })),
    wreckCar: (x, z, yaw) => put(block(x, z, 1.9, 1.5, 4.4, { yaw, material: 'metal', color: pick(WRECK), model: 'car' })),
    truck: (x, z, yaw, color = '#4d5a3c') => put(block(x, z, 2.5, 3, 7, { yaw, material: 'metal', color, model: 'truck' })),
    sandbags: (x, z, len, yaw, h = 1.1) => put(block(x, z, len, h, 0.9, { yaw, material: 'ground', color: SAND, model: 'sandbags' })),
    nest(x, z, yaw) {
      const f = frame([x, z], yaw);
      thing(f, 0, -1.6, 3.6, 1.1, 0.9, { material: 'ground', color: SAND, model: 'sandbags' });
      thing(f, -1.6, 0, 0.9, 1.1, 2.6, { material: 'ground', color: SAND, model: 'sandbags' });
      thing(f, 1.6, 0, 0.9, 1.1, 2.6, { material: 'ground', color: SAND, model: 'sandbags' });
    },
    logs: (x, z, len, yaw, h = 1.6) => put(block(x, z, len, h, 2.4, { yaw, material: 'wood', color: '#86684a', model: 'logPile' })),
    hay: (x, z, yaw) => put(block(x, z, 2.6, 1.5, 1.5, { yaw, material: 'straw', color: '#c2a35e', model: 'hayBale' })),
    cart: (x, z, yaw) => put(block(x, z, 1.7, 1.6, 3.6, { yaw, material: 'wood', color: WOOD, model: 'cart' })),
    wreck: (x, z, yaw) => put(block(x, z, 3.6, 2.6, 7.2, { yaw, type: 'wall', material: 'metal', color: '#4a4d42', model: 'tankWreck' })),
    bunker: (x, z, face) => put(block(x, z, 7, 3, 5, { yaw: face, type: 'wall', material: 'concrete', color: '#8f8c84', model: 'bunker', sink: 0.2 })),
    tower: (x, z, yaw = 0) => put(block(x, z, 3.4, 8, 3.4, { yaw, type: 'wall', material: 'wood', color: '#6d6450', model: 'watchtower' })),
    tent: (x, z, yaw = 0, color = '#c9c3a6') => put(block(x, z, 5, 3, 4, { yaw, type: 'wall', material: 'canvas', color, model: 'tent' })),
    stall: (x, z, yaw) => put(block(x, z, 3, 2.6, 2.4, { yaw, material: 'wood', color: pick(['#a8433a', '#c9b48a', '#6f4f7a', '#3f6a6a', '#b58a3a']), model: 'stall', sink: 0.1 })),
    fence: (pts, gaps = []) => putAll(wallLine(densify(pts, 6), { height: 1.1, thick: 0.3, material: 'wood', color: WOOD, type: 'cover', model: 'fence', gaps })),
    stoneWall: (pts, gaps = [], height = 1.0, color = STONE) => putAll(wallLine(densify(pts, 3), { height, thick: 0.55, material: 'concrete', color, type: 'cover', gaps })),
    /** A clipped hedge row (cover; blocks sight). */
    hedge: (pts, gaps = [], height = 1.5) => putAll(wallLine(densify(pts, 4), { height, thick: 1.1, material: 'grass', color: '#4c5f36', type: 'cover', gaps })),
    container(f, lx, lz, yaw = 0, stack = 1) {
      const colors = ['#8a4a3a', '#3b5a80', '#56704a', '#9a7a3c', '#6d6d6d'];
      for (let s = 0; s < stack; s++) thing(f, lx, lz, 2.44, 2.6, 6.1, { yaw: yaw + (s ? (R() - 0.5) * 4 : 0), lift: s * 2.6, sink: s ? 0 : 0.3, type: 'cover', material: 'metal', color: pick(colors), model: 'container' });
    },
    /** Rock outcrop: a few tipped boulders. */
    outcrop(x, z, size = 1, colors = ['#6d6a66', '#5f5d5a', '#77736d']) {
      for (let k = 0; k < 3; k++) {
        const w = between(2, 4.5) * size;
        const h = between(1.2, 2.6) * size;
        put({ type: 'wall', pos: [round(x + (R() - 0.5) * 3 * size), round(h / 2 - 0.4), round(z + (R() - 0.5) * 3 * size)], size: [round(w, 1), round(h + 0.8, 1), round(between(1.8, 3.6) * size, 1)], rot: yawPitch(R() * 360, between(-14, 14)), material: 'rock', color: pick(colors), snap: true });
      }
    },
  };

  // Scanned props cost 1.5-7k triangles each wherever they are: a few per zone, plain crates elsewhere.
  const CRATES = ['barrel_03', 'ammo_box', 'old_military_crate'];
  const propsIn = {};
  const zoneAt = (x, z) => Object.keys(zones).find((id) => Math.hypot(x - zones[id][0], z - zones[id][1]) < (radii[id] ?? 30) + 8);
  function crate(x, z) {
    const id = zoneAt(x, z);
    if (id && (propsIn[id] = (propsIn[id] ?? 0) + 1) <= 3) props.push({ model: pick(CRATES), pos: [round(x), 0, round(z)], rot: [0, round(R() * 360), 0], snap: true });
    else {
      const s = 0.8 + R() * 0.5;
      const yaw = R() * 90;
      const color = pick(['#6f5a3e', '#5d6346']);
      objects.push(block(x, z, s * 1.3, s * 0.8, s, { yaw, material: 'wood', color }));
      if (R() < 0.4) objects.push(block(x, z, s * 0.9, s * 0.7, s * 0.8, { yaw: yaw + 20, lift: s * 0.8, sink: 0, material: 'wood', color }));
    }
    occupy(x, z, 1.4, 1.4);
  }
  function scatter(cx, cz, rMin, rMax, n) {
    for (let i = 0, placed = 0; placed < n && i < n * 12; i++) {
      const a = R() * Math.PI * 2;
      const r = between(rMin, rMax);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (!inMap(x, z, 4) || !offRoad(x, z, 0.8) || blocked(x, z, 1.5) || !isFree(obb(x, z, 1.6, 1.6, 0, 0.4))) continue;
      crate(x, z);
      placed++;
    }
  }
  /** Trees round a point, off roads, zones' middles and solid things. */
  function copse(cx, cz, radius, n, { minGap = 3.4, scale = [0.75, 1.35], inZones = false } = {}) {
    for (let i = 0, placed = 0; placed < n && i < n * 12; i++) {
      const a = R() * Math.PI * 2;
      const r = Math.sqrt(R()) * radius;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (!inMap(x, z, 2) || !offRoad(x, z, 3) || blocked(x, z, 2)) continue;
      if (!inZones && Object.entries(zones).some(([id, c]) => Math.hypot(x - c[0], z - c[1]) < (radii[id] ?? 30) - 4)) continue;
      if (!isFree(obb(x, z, 1, 1, 0, 2.2)) || trees.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < minGap)) continue;
      trees.push([round(x, 1), round(z, 1), round(between(scale[0], scale[1]), 2)]);
      placed++;
    }
  }
  /** A ruined house: broken walls with blown-out gaps, rubble inside. */
  function ruin(x, z, w, d, yaw, colors = ['#8b6a55', '#7d5e4c', '#94765f'], material = 'brick') {
    const f = frame([x, z], yaw);
    const corners = [f(-w / 2, -d / 2), f(w / 2, -d / 2), f(w / 2, d / 2), f(-w / 2, d / 2), f(-w / 2, -d / 2)];
    for (let i = 0; i < 4; i++) {
      const len = i % 2 ? d : w;
      const a = between(0.15, 0.55) * len;
      const gaps = [[a, a + between(1.4, 2.6)]];
      if (R() < 0.5) gaps.push([len * 0.75, len * 0.75 + between(1, 2)]);
      putAll(wallLine([corners[i], corners[i + 1]], { height: round(between(1.2, 3.6), 1), thick: 0.45, type: 'wall', material, color: pick(colors), gaps }));
    }
    for (let k = 0; k < 4; k++) {
      const [rx, rz] = f(between(-w / 2 + 1.5, w / 2 - 1.5), between(-d / 2 + 1.5, d / 2 - 1.5));
      put({ type: 'cover', pos: [round(rx), round(between(0.2, 0.5)), round(rz)], size: [round(between(1.4, 2.6), 1), round(between(0.6, 1.2), 1), round(between(1.2, 2.2), 1)], rot: yawPitch(R() * 360, between(-12, 12)), material: 'concrete', color: pick(['#8a8178', '#7b6a5e', '#968b80']), snap: true });
    }
    occupy(x, z, w, d, yaw);
  }
  /**
   * Buildings shoulder to shoulder along one side of a street, door side (local south) to the
   * street. lotOK(r) decides where; lotStyle(x, z) what. Upper floors need a short side of
   * ~8.6 m or the stairs don't link them for bots (navmesh tiles).
   */
  function frontage(pts, halfW, side, { lotOK, lotStyle, ruins = 0.14, gap = 0.25, setback = 1.9, maxSlope = 1.1 }) {
    const total = lengthOf(pts);
    let s = 1;
    let n = 0;
    while (s < total - 3) {
      const p0 = along(pts, s);
      let done = false;
      for (let tries = 0; tries < 4 && !done; tries++) {
        const lot = tries < 3 ? lotStyle(p0.x, p0.z) : { style: 'house', w: 8.6, d: 8.6, floors: 2 };
        if ((lot.floors ?? 1) > 1) {
          lot.w = Math.max(lot.w, 8.6);
          lot.d = Math.max(lot.d, 8.6);
        }
        if (s + lot.w > total + 1) continue;
        const mid = along(pts, s + lot.w / 2);
        const nx = -mid.tz * side;
        const nz = mid.tx * side;
        const off = halfW + setback + lot.d / 2;
        const x = mid.x + nx * off;
        const z = mid.z + nz * off;
        const yaw = (Math.atan2(-nx, -nz) * 180) / Math.PI;
        const r = obb(x, z, lot.w, lot.d, yaw);
        if (!lotOK(r) || slopeUnder(r) > maxSlope || !isFree(r)) continue;
        if (lot.style !== 'shed' && R() < ruins) {
          ruin(x, z, lot.w, lot.d, yaw, lot.ruinColors, lot.ruinMaterial);
          n++;
          s += lot.w + 0.5;
          done = true;
          continue;
        }
        const doors = 's' + (R() < 0.85 ? 'n' : '') + (R() < 0.45 ? pick(['e', 'w']) : '');
        addBuilding({ pos: [x, z], size: [lot.w, lot.d], style: lot.style, ...(lot.floors ? { floors: lot.floors } : {}), ...(lot.material ? { material: lot.material } : {}), ...(lot.color ? { color: lot.color } : {}), rot: yaw + (R() - 0.5) * 2, doors });
        n++;
        s += lot.w + (R() < gap ? between(2.6, 3.6) : 0.5);
        done = true;
      }
      if (!done) s += 1;
    }
    return n;
  }
  /** A flight of steps between two ground points (absolute heights), with low parapets. */
  function stairs(a, b, width, { color = '#8f8b82', parapet = STONE } = {}) {
    const ya = H(...a);
    const yb = H(...b);
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz) / DEG;
    const rise = yb - ya;
    const rot = yawPitch(yaw + 180, Math.atan2(rise, len) / DEG);
    put({ type: 'ramp', pos: [round((a[0] + b[0]) / 2), round((ya + yb) / 2 - 0.12), round((a[1] + b[1]) / 2)], size: [width, 0.3, round(Math.hypot(len, rise) + 0.4)], rot, material: 'concrete', color });
    if (parapet) for (const s of [-1, 1]) {
      const ox = (-dz / len) * s * (width / 2 + 0.2);
      const oz = (dx / len) * s * (width / 2 + 0.2);
      put({ type: 'cover', pos: [round((a[0] + b[0]) / 2 + ox), round((ya + yb) / 2 + 0.35), round((a[1] + b[1]) / 2 + oz)], size: [0.4, 1.0, round(Math.hypot(len, rise) + 0.4)], rot, material: 'concrete', color: parapet });
    }
  }
  /** Cars along a road's kerbs, now and then; skip(x, z) rules spots out. */
  function kerbCars(r, { every = [6, 10], chance = 0.38, skip = () => false, wrecks = 0.3 } = {}) {
    let n = 0;
    const total = lengthOf(r.pts);
    for (const side of [-1, 1]) {
      for (let s = 6; s < total - 6; s += between(every[0], every[1])) {
        if (R() > chance) continue;
        const p = along(r.pts, s);
        const off = r.w / 2 - 1.1;
        const x = p.x - p.tz * side * off;
        const z = p.z + p.tx * side * off;
        if (!inMap(x, z, 5) || skip(x, z) || Object.values(zones).some(([zx, zz]) => Math.hypot(x - zx, z - zz) < 14)) continue;
        if (roads.some((o) => o !== r && lineDist(x, z, o.pts) < o.w / 2 + 3)) continue;
        if (!isFree(obb(x, z, 1.9, 4.4, p.yaw, 0.3))) continue;
        kit.car(x, z, p.yaw + (side < 0 ? 180 : 0) + (R() - 0.5) * 4, R() < wrecks ? pick(WRECK) : undefined);
        n++;
      }
    }
    return n;
  }
  /** Self-check: buildings off roads, inside the map and on level ground; solid things inside. */
  function check() {
    const problems = [];
    for (const b of buildings) {
      const r = obb(b.pos[0], b.pos[1], b.size[0], b.size[1], b.rot ?? 0);
      if (samples(r, 2).some(([x, z]) => !offRoad(x, z, 0))) problems.push(`building ${b.style} at ${b.pos} is on a road`);
      if (samples(r, 4).some(([x, z]) => !inMap(x, z, 1))) problems.push(`building ${b.style} at ${b.pos} leaves the map`);
      const sl = slopeUnder(r);
      if (sl > 1.6) problems.push(`building ${b.style} at ${b.pos} stands on a ${round(sl, 1)} m slope`);
    }
    for (const o of objects) {
      if (o.type === 'floor' && o.size[1] < 0.6) continue;
      if (!inMap(o.pos[0], o.pos[2], -1)) problems.push(`object ${o.model ?? o.type} at ${o.pos} is outside the map`);
    }
    if (problems.length) console.warn(problems.join('\n'));
  }

  return {
    objects, buildings, props, trees, roads, H, pick, between,
    occupy, isFree, put, putAll, paint, addBuilding, building, thing, slopeUnder,
    road, offRoad, kit, crate, scatter, copse, ruin, frontage, stairs, kerbCars, check,
  };
}

/** Area (m²) and size of a closed outline, and the world size with a margin round it. */
export function outlineStats(boundary, margin = 70) {
  const xs = boundary.map((p) => p[0]);
  const zs = boundary.map((p) => p[1]);
  let area = 0;
  for (let i = 0; i < boundary.length; i++) {
    const [ax, az] = boundary[i];
    const [bx, bz] = boundary[(i + 1) % boundary.length];
    area += ax * bz - bx * az;
  }
  const halfX = Math.max(-Math.min(...xs), Math.max(...xs)) + margin;
  const halfZ = Math.max(-Math.min(...zs), Math.max(...zs)) + margin;
  return { area: Math.abs(area) / 2, w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs), size: [Math.ceil(halfX * 2), Math.ceil(halfZ * 2)] };
}

/** Spawn rings for both sides. */
export function spawnRings(blue, red, blueYaw, redYaw) {
  const spawns = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    spawns.push({ team: 'blue', pos: [round(blue[0] + Math.cos(a) * 6), 0.1, round(blue[1] + Math.sin(a) * 5)], yaw: blueYaw });
    spawns.push({ team: 'red', pos: [round(red[0] + Math.cos(a) * 6), 0.1, round(red[1] + Math.sin(a) * 5)], yaw: redYaw });
  }
  return spawns;
}
