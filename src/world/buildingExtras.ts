import { GROUND_TOP, ROOF_SNOW, SLAB, STAIR_W, WALL, WINDOW_STANDOFF, faceBox, faceLen, sideBox, type Ctx, type SideFrame } from './buildingParts';

/**
 * Per-style details for generated buildings (see STYLES in world/buildings.ts):
 * facade trim, signs, balconies, roof clutter, and the fittings of open halls.
 * Trim is visual only (`deco`); anything you can stand behind or bump into
 * collides (`box`). Everything is boxes in a few shared colours, so it merges
 * into the map's per-material batches and costs triangles, not draw calls.
 */

const STEEL = '#5b6166';
const DARK = '#2b3034';
const GLASS = '#26313a';
const WHITE = '#e9e7e1';
const RED = '#b3241c';
const TIMBER = '#3f2d21';
/** Light dressed stone at the corners of stone buildings (one colour for all). */
const QUOIN = '#c8c0b0';

/** A band round the building at height y (h tall), standing `out` proud of the walls. */
function band(c: Ctx, y: number, h: number, out: number, t: number, col: string, mat: Parameters<Ctx['box']>[8] = 'concrete'): void {
  const wrap = out + t / 2;
  for (const s of c.sides) {
    const ns = s.id === 'n' || s.id === 's';
    faceBox(s, c.deco, ns ? -wrap : 0, faceLen(s) + (ns ? 2 * wrap : 0), y, h, out, t, col, mat);
  }
}

/** Dark bands between the window rows (ribbon windows), from the ground-floor lintels to the parapet. */
function spandrels(c: Ctx, col: string, parapet = 0.9): void {
  const o = Object.values(c.columns).find((cols) => cols && cols.length)?.[0]?.o;
  if (!o) return;
  const sill = o.sill - (c.floors > 1 ? c.storey : 0);
  for (let f = 0; f < c.floors; f++) {
    const y0 = f * c.storey + sill + o.height;
    const y1 = f === c.floors - 1 ? c.H + parapet : (f + 1) * c.storey + sill;
    band(c, y0, y1 - y0, 0.03, 0.05, col, 'concrete');
  }
}

/** Flat canopy over the ground-floor door of a side: slab, fascia, and posts when deep. */
function canopy(c: Ctx, s: SideFrame, width: number, depth: number, y: number, posts: boolean, col: string): void {
  const d = c.doorAt[s.id];
  if (!d) return;
  const u0 = d.u - width / 2;
  const off = WALL / 2 + depth / 2;
  // Its top is an island no one reaches (left out of the navmesh), bullets stop on it.
  sideBox(s, c.box, u0, width, y, 0.25, off, depth, 'floor', col, 'concrete');
  sideBox(s, c.deco, u0 - 0.05, width + 0.1, y - 0.3, 0.32, WALL / 2 + depth + 0.03, 0.1, 'prop', STEEL, 'metal');
  if (!posts) return;
  for (const k of [0.15, width - 0.15]) sideBox(s, c.box, u0 + k - 0.15, 0.3, GROUND_TOP - 0.2, y - GROUND_TOP + 0.2, WALL / 2 + depth - 0.25, 0.3, 'cover', STEEL, 'metal');
}

/** Roof boxes: plant rooms, AC units (collide; nobody gets up there, but shots do). */
function roofBox(c: Ctx, x: number, z: number, sx: number, sy: number, sz: number, col = STEEL, mat: Parameters<Ctx['box']>[8] = 'metal'): void {
  const y = c.H + SLAB - 0.05;
  c.box(x, y + sy / 2, z, sx, sy, sz, 'wall', col, mat);
  c.snow?.(x, y + sy + 0.05, z, sx - 0.1, 0.1, sz - 0.1, 'prop', ROOF_SNOW, 'snow');
}

/** Stair / lift houses on a flat roof over each stairwell. */
function stairHouses(c: Ctx): void {
  for (const st of c.stairs) {
    const w = STAIR_W + 1.6;
    const x = st.open < 0 ? c.W / 2 - WALL - w / 2 : -c.W / 2 + WALL + w / 2;
    roofBox(c, x, st.top - st.dir * 1.6, w, 2.6, 4.4, c.trim, 'concrete');
  }
}

/** Corner stones on every corner, alternating long and short (stone buildings). */
function quoins(c: Ctx, top: number, col: string): void {
  const step = 0.55;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      for (let y = 0, i = 0; y + step <= top; y += step, i++) {
        const long = i % 2 === 0;
        const a = long ? 0.9 : 0.5;
        const b = long ? 0.5 : 0.9;
        c.deco(sx * (c.W / 2 - a / 2 + 0.04), y + step / 2, sz * (c.D / 2 + 0.04), a, step - 0.06, 0.1, 'prop', col, 'concrete');
        c.deco(sx * (c.W / 2 + 0.04), y + step / 2, sz * (c.D / 2 - b / 2 + 0.04), 0.1, step - 0.06, b, 'prop', col, 'concrete');
      }
}

/** Panel with a red cross standing on the roof edge of a side, facing out. */
function crossSign(c: Ctx, s: SideFrame, u: number, size: number): void {
  const y = c.H + 1.2;
  const off = -0.2;
  faceBox(s, c.deco, u - size / 2, size, y, size, off, 0.12, WHITE, 'metal');
  faceBox(s, c.deco, u - size * 0.12, size * 0.24, y + size * 0.15, size * 0.7, off + 0.08, 0.06, RED, 'metal');
  faceBox(s, c.deco, u - size * 0.35, size * 0.7, y + size * 0.38, size * 0.24, off + 0.08, 0.06, RED, 'metal');
  for (const k of [0.2, size - 0.2]) faceBox(s, c.deco, u - size / 2 + k - 0.05, 0.1, c.H + 0.2, 1.05, off - 0.15, 0.1, STEEL, 'metal');
}

export function towerExtras(c: Ctx): void {
  for (let f = 1; f < c.floors; f++) band(c, f * c.storey - 0.12, 0.22, 0.05, 0.12, c.trim);
  if (c.solid) return;
  // Balconies off about half the window columns on the long sides, every floor up.
  for (const s of c.sides) {
    if (s.id !== 'n' && s.id !== 's') continue;
    for (const col of c.columns[s.id] ?? []) {
      if (c.rng() < 0.5) continue;
      const len = col.o.width + 1.1;
      const u0 = col.u - len / 2;
      for (let f = 1; f < c.floors; f++) {
        const y = f * c.storey;
        sideBox(s, c.box, u0, len, y - 0.18, 0.18, WALL / 2 + 0.55, 1.1, 'floor', c.trim, 'concrete');
        sideBox(s, c.box, u0, len, y, 1.0, WALL / 2 + 1.06, 0.08, 'cover', STEEL, 'metal');
        sideBox(s, c.deco, u0, 0.06, y, 1.0, WALL / 2 + 0.55, 1.05, 'prop', STEEL, 'metal');
        sideBox(s, c.deco, u0 + len - 0.06, 0.06, y, 1.0, WALL / 2 + 0.55, 1.05, 'prop', STEEL, 'metal');
      }
    }
  }
  const front = c.sides.find((s) => c.doorAt[s.id]);
  if (front) canopy(c, front, (c.doorAt[front.id]?.width ?? 1.4) + 1.8, 1.4, 2.7, false, c.trim);
  stairHouses(c);
  roofBox(c, -c.W / 4, c.D / 6, 2.2, 1.2, 1.4);
  // Aerials.
  for (const x of [-c.W / 3, c.W / 6]) c.deco(x, c.H + 1.6, -c.D / 5, 0.05, 2.8, 0.05, 'prop', DARK, 'metal');
}

export function officeExtras(c: Ctx): void {
  spandrels(c, '#3d4850');
  band(c, -0.2, 0.5, 0.04, 0.08, c.trim);
  if (c.solid) return;
  // A mullion in every window.
  for (const s of c.sides)
    for (const col of c.columns[s.id] ?? [])
      for (let f = 0; f < c.floors; f++) {
        const sill = col.o.sill - (c.floors > 1 ? c.storey : 0) + f * c.storey;
        sideBox(s, c.deco, col.u - 0.03, 0.06, sill, col.o.height, 0.06, 0.06, 'prop', DARK, 'metal');
      }
  const front = c.sides.find((s) => c.doorAt[s.id]);
  if (front) canopy(c, front, (c.doorAt[front.id]?.width ?? 1.8) + 3, 2.4, 2.9, true, '#5f666b');
  stairHouses(c);
  for (let i = 0; i < 3; i++) roofBox(c, -c.W / 3 + i * (c.W / 4), c.D / 5, 1.8, 1.3, 1.2);
}

export function gasShopExtras(c: Ctx): void {
  // Deep fascia round the top in one of a few plain colours, with a light stripe.
  const fascia = ['#2f6e4a', '#2a5d8a', '#a8322a'][Math.floor(c.rng() * 3)]!;
  band(c, c.H - 0.5, 1.45, 0.12, 0.16, fascia, 'metal');
  band(c, c.H - 0.42, 0.14, 0.21, 0.04, WHITE, 'metal');
  if (c.solid) return;
  const front = c.sides.find((s) => c.doorAt[s.id]);
  if (front) canopy(c, front, (c.doorAt[front.id]?.width ?? 1.6) + 1.2, 1.1, 2.55, false, fascia);
  // Shop inside: a counter by the back wall, a shelf unit, a drinks fridge.
  const { W, D, box } = c;
  const y = GROUND_TOP;
  box(-W / 4, y + 0.5, -D / 2 + WALL + 1.3, Math.min(3.2, W * 0.35), 1.0, 0.7, 'cover', '#6a5a48', 'wood');
  box(W * 0.18, y + 0.8, 0.2, Math.min(3, W * 0.3), 1.6, 0.6, 'cover', '#7d8286', 'metal');
  box(W / 2 - WALL - 0.45, y + 1.0, -D / 2 + WALL + 1.8, 0.8, 2.0, Math.min(2.4, D * 0.3), 'cover', '#c9ccce', 'metal');
  roofBox(c, W / 4, 0, 1.4, 0.9, 1.0);
}

export function hospitalExtras(c: Ctx): void {
  // Pale blue bands along each floor line on the white walls.
  for (let f = 1; f <= c.floors; f++) band(c, f * c.storey - 0.35, 0.55, 0.04, 0.08, '#9db4c0');
  band(c, -0.2, 1.1, 0.04, 0.08, c.trim);
  // Main entrance: a deep canopy on columns, cars drive under it.
  const front = (['s', 'n', 'e', 'w'] as const).map((id) => c.sides.find((s) => s.id === id)!).find((s) => c.doorAt[s.id]);
  if (front && !c.solid) canopy(c, front, 9, 5.5, 3.4, true, '#d9d7d0');
  // Red crosses on the roof edge over the entrance and at both ends.
  const fr = front ?? c.sides[1]!;
  crossSign(c, fr, c.doorAt[fr.id]?.u ?? faceLen(fr) / 2, 3);
  for (const s of c.sides) if (s.id === 'e' || s.id === 'w') crossSign(c, s, faceLen(s) / 2, 2.4);
  if (c.solid) return;
  stairHouses(c);
  // Helipad on the roof: dark square, white edge and H.
  const pad = Math.min(14, c.D - 3, c.W / 2);
  const px = -c.W / 2 + pad / 2 + (c.stairs.some((s) => s.open > 0) ? STAIR_W + 3 : 2);
  const y = c.H + SLAB - 0.03;
  c.deco(px, y, 0, pad, 0.04, pad, 'prop', '#4d5155', 'concrete');
  for (const s of [-1, 1]) {
    c.deco(px, y + 0.02, (s * (pad - 0.6)) / 2, pad - 0.6, 0.04, 0.25, 'prop', WHITE, 'concrete');
    c.deco(px + (s * (pad - 0.6)) / 2, y + 0.02, 0, 0.25, 0.04, pad - 0.6, 'prop', WHITE, 'concrete');
    c.deco(px + s * pad * 0.16, y + 0.02, 0, 0.6, 0.04, pad * 0.45, 'prop', WHITE, 'concrete');
  }
  c.deco(px, y + 0.02, 0, pad * 0.32, 0.04, 0.6, 'prop', WHITE, 'concrete');
  for (let i = 0; i < 4; i++) roofBox(c, c.W * 0.1 + i * 3.4, c.D / 4, 2.4, 1.6, 1.8);
}

export function hotelExtras(c: Ctx): void {
  band(c, c.storey - 0.12, 0.24, 0.08, 0.16, c.trim);
  band(c, -0.2, 0.9, 0.05, 0.1, c.trim);
  quoins(c, c.H, QUOIN);
  // Dormers on the mansard over the window columns of the long sides.
  const r = Math.min(3.2, Math.min(c.W, c.D) * 0.22);
  const top = c.H + SLAB - 0.05;
  for (const s of c.sides) {
    if (s.id !== 'n' && s.id !== 's') continue;
    for (const col of c.columns[s.id] ?? []) {
      const w = 1.5;
      const h = r * 0.62;
      const u0 = col.u - w / 2;
      const off = WALL / 2 - 0.35 - 0.6;
      sideBox(s, c.deco, u0, w, top + 0.2, h, off, 1.2, 'prop', c.trim, 'concrete');
      sideBox(s, c.deco, u0 + 0.25, w - 0.5, top + 0.4, h - 0.55, off + 0.61, 0.04, 'prop', GLASS, 'metal');
      sideBox(s, c.deco, u0 - 0.1, w + 0.2, top + 0.2 + h, 0.3, off, 1.35, 'prop', '#4a4f55', 'metal');
    }
  }
  if (c.solid) return;
  const front = (['s', 'n', 'e', 'w'] as const).map((id) => c.sides.find((s) => s.id === id)!).find((s) => c.doorAt[s.id]);
  if (front) {
    canopy(c, front, 5, 2.8, 3.1, true, '#3b3530');
    // Name board over the canopy: dark panel with a gilt edge.
    const u = c.doorAt[front.id]!.u;
    sideBox(front, c.deco, u - 2.6, 5.2, 3.5, 0.9, WALL / 2 + 0.08, 0.08, 'prop', '#b08d48', 'metal');
    sideBox(front, c.deco, u - 2.45, 4.9, 3.58, 0.74, WALL / 2 + 0.13, 0.04, 'prop', '#2a2522', 'wood');
  }
  // Chimney stacks through the roof.
  for (const x of [-c.W * 0.35, -c.W * 0.05, c.W * 0.25]) {
    c.box(x, top + (r + 1.4) / 2, -c.D * 0.12, 0.9, r + 1.4, 1.6, 'wall', c.color, c.material);
    c.snow?.(x, top + r + 1.45, -c.D * 0.12, 0.85, 0.1, 1.55, 'prop', ROOF_SNOW, 'snow');
  }
}

export function innExtras(c: Ctx): void {
  // Timber framing over the upper floor: sole and head beams, posts on the bay lines, braces in blank bays.
  if (c.floors > 1) {
    const y0 = c.storey;
    const y1 = c.H;
    band(c, y0 - 0.1, 0.24, 0.05, 0.1, TIMBER, 'wood');
    band(c, y1 - 0.24, 0.24, 0.05, 0.1, TIMBER, 'wood');
    for (const s of c.sides) {
      const len = faceLen(s);
      const bays = Math.max(1, Math.round(len / 3.2));
      const bw = len / bays;
      const shift = s.id === 'e' || s.id === 'w' ? WALL : 0;
      const wins = (c.columns[s.id] ?? []).map((w) => w.u + shift);
      for (let i = 0; i <= bays; i++) faceBox(s, c.deco, i * bw - 0.1 - (i === bays ? 0.05 : 0) + (i === 0 ? 0.05 : 0), 0.2, y0, y1 - y0, 0.05, 0.1, TIMBER, 'wood');
      for (let i = 0; i < bays; i++) {
        const mid = (i + 0.5) * bw;
        if (wins.some((u) => Math.abs(u - mid) < bw / 2)) continue;
        // A brace across the bay (a box turned in the wall plane).
        const hgt = y1 - y0 - 0.4;
        const ang = Math.atan2(hgt, bw - 0.3) * (i % 2 ? 1 : -1);
        const [x, z] = [s.origin[0] + s.dir[0] * (mid - shift) + s.normal[0] * (WALL / 2 + 0.05), s.origin[1] + s.dir[1] * (mid - shift) + s.normal[1] * (WALL / 2 + 0.05)];
        const L = Math.hypot(hgt, bw - 0.3);
        if (s.dir[0] !== 0) c.deco(x, (y0 + y1) / 2, z, L, 0.18, 0.1, 'prop', TIMBER, 'wood', 0, ang);
        else c.deco(x, (y0 + y1) / 2, z, 0.1, 0.18, L, 'prop', TIMBER, 'wood', ang, 0);
      }
    }
  }
  // Shutters beside the windows.
  for (const s of c.sides)
    for (const col of c.columns[s.id] ?? [])
      for (let f = 1; f < c.floors; f++) {
        const sill = col.o.sill + (f - 1) * c.storey;
        for (const k of [-1, 1]) sideBox(s, c.deco, col.u + k * (col.o.width / 2 + 0.3) - 0.27, 0.54, sill, col.o.height, WALL / 2 + 0.05, 0.05, 'prop', '#3d5a45', 'wood');
      }
  // Chimney at one gable end, a sign hanging by the door.
  const alongX = c.W >= c.D;
  const ridge = c.H + (Math.min(c.W, c.D) / 2 + 0.3) * 1.05;
  const cx = alongX ? c.W / 2 - 1.3 : 0;
  const cz = alongX ? 0 : c.D / 2 - 1.3;
  c.box(cx, (c.H + ridge + 1.4) / 2, cz, 0.9, ridge + 1.4 - c.H, 0.9, 'wall', c.color, c.material);
  c.snow?.(cx, ridge + 1.45, cz, 0.85, 0.1, 0.85, 'prop', ROOF_SNOW, 'snow');
  const front = c.sides.find((s) => c.doorAt[s.id]);
  if (front && !c.solid) {
    const u = c.doorAt[front.id]!.u + (c.doorAt[front.id]!.width / 2 + 0.9);
    sideBox(front, c.deco, u - 0.05, 0.1, 2.75, 0.08, WALL / 2 + 0.5, 0.9, 'prop', DARK, 'metal');
    sideBox(front, c.deco, u - 0.03, 0.06, 2.0, 0.7, WALL / 2 + 0.7, 0.75, 'prop', '#6b4a2e', 'wood');
  }
}

export function millExtras(c: Ctx): void {
  quoins(c, c.H, QUOIN);
  band(c, c.storey - 0.1, 0.2, 0.05, 0.1, c.trim);
  // Loading door high in a gable end with a hoist beam over it.
  const alongX = c.W >= c.D;
  const end = c.sides.find((s) => s.id === (alongX ? 'e' : 's'))!;
  const u = faceLen(end) / 2;
  const y = (c.floors - 1) * c.storey + 0.4;
  faceBox(end, c.deco, u - 0.7, 1.4, y, 2.0, 0.03, 0.06, '#4f3a28', 'wood');
  faceBox(end, c.deco, u - 0.12, 0.24, c.H + 0.3, 0.24, 0.7, 1.4, TIMBER, 'wood');
  faceBox(end, c.deco, u - 0.02, 0.04, c.H - 0.6, 0.9, 1.25, 0.04, DARK, 'metal');
  const ridge = c.H + (Math.min(c.W, c.D) / 2 + 0.3) * 0.85;
  const cx = alongX ? -c.W / 2 + 1.2 : 0;
  const cz = alongX ? 0 : -c.D / 2 + 1.2;
  c.box(cx, (c.H + ridge + 1.2) / 2, cz, 0.8, ridge + 1.2 - c.H, 0.8, 'wall', c.color, c.material);
}

export function depotExtras(c: Ctx): void {
  // Pilasters on the bay lines of the long walls, a cornice, and a smoke vent along the ridge.
  for (const s of c.sides) {
    if (s.id !== 'n' && s.id !== 's') continue;
    const bays = Math.max(1, Math.round(s.len / 3.2));
    const bw = s.len / bays;
    for (let i = 0; i <= bays; i++) faceBox(s, c.deco, Math.min(s.len - 0.55, Math.max(0, i * bw - 0.275)), 0.55, -0.2, c.H + 0.2, 0.08, 0.16, c.color, c.material);
  }
  band(c, c.H - 0.35, 0.35, 0.12, 0.24, c.trim);
  const alongX = c.W >= c.D;
  const L = (alongX ? c.W : c.D) * 0.8;
  const rise = ((alongX ? c.D : c.W) / 2 + 0.3) * 0.5;
  const ridge = c.H + rise;
  const sx = alongX ? L : 2.6;
  const sz = alongX ? 2.6 : L;
  c.deco(0, ridge + 0.4, 0, alongX ? L : 1.6, 0.8, alongX ? 1.6 : L, 'prop', DARK, 'wood');
  c.deco(0, ridge + 0.9, 0, sx, 0.16, sz, 'prop', '#4a3a30', 'wood');
  c.snow?.(0, ridge + 1.03, 0, sx - 0.1, 0.1, sz - 0.1, 'prop', ROOF_SNOW, 'snow');
}

export function factoryExtras(c: Ctx): void {
  const { W, D, H, box, deco } = c;
  band(c, H - 0.6, 0.6, 0.1, 0.2, c.trim);
  // North-light sawtooth roof: teeth along x, glazing facing north (visual; the slab under it collides).
  const tooth = 4.5;
  const n = Math.max(1, Math.floor((D - 1) / tooth));
  const z0 = -(n * tooth) / 2;
  const th = 1.7;
  const ang = Math.atan2(th, tooth);
  const slant = Math.hypot(th, tooth);
  const y = H + SLAB - 0.05;
  for (let i = 0; i < n; i++) {
    const za = z0 + i * tooth;
    deco(0, y + th / 2, za + tooth / 2, W - 0.6, 0.14, slant, 'prop', '#55595c', 'metal', -ang);
    deco(0, y + th / 2, za + 0.05, W - 0.6, th, 0.08, 'prop', GLASS, 'metal');
    c.snow?.(0, y + th / 2 + 0.12, za + tooth / 2, W - 0.7, 0.1, slant * 0.95, 'prop', ROOF_SNOW, 'snow', -ang);
  }
  // Chimney stack in the north-east corner, standing on the roof: a hollow box down to the
  // floor would leave a closed-off patch of navmesh floor inside it.
  box(W / 2 - WALL - 1.0, H + 5.5, -D / 2 + WALL + 1.0, 1.7, 11, 1.7, 'wall', c.color, c.material);
  deco(W / 2 - WALL - 1.0, H + 11.1, -D / 2 + WALL + 1.0, 1.95, 0.3, 1.95, 'prop', DARK, 'concrete');
  if (c.solid) return;
  const X0 = -W / 2 + WALL;
  const X1 = W / 2 - WALL;
  const Z0 = -D / 2 + WALL;
  const Z1 = D / 2 - WALL;
  // Office mezzanine along the north wall (west end), a ramp up beside it, offices underneath.
  const run = 4.2 / Math.tan((34 * Math.PI) / 180);
  const ML = Math.min(W * 0.45, 26, X1 - X0 - run - 3.5);
  const MZ = Math.min(6, (Z1 - Z0) * 0.32);
  const top = 4.2;
  const hasMezz = ML >= 6 && MZ >= 3.5;
  if (hasMezz) {
    const xm = X0 + ML;
    box(X0 + ML / 2, top - 0.15, Z0 + MZ / 2, ML, 0.3, MZ, 'floor', '#8a8a86', 'concrete_floor');
    // Low wall along the open edge (cover for whoever holds it) and the east end past the ramp.
    box(X0 + ML / 2, top + 0.52, Z0 + MZ - 0.1, ML, 1.05, 0.2, 'cover', STEEL, 'metal');
    box(xm - 0.1, top + 0.52, Z0 + STAIR_W + (MZ - STAIR_W) / 2, 0.2, 1.05, MZ - STAIR_W - 0.1, 'cover', STEEL, 'metal');
    const a = Math.atan2(top, run);
    box(xm + run / 2, top / 2 - 0.1 / Math.cos(a), Z0 + STAIR_W / 2, Math.hypot(top, run), 0.2, STAIR_W, 'ramp', '#8a8a86', 'concrete', 0, -a);
    // Under it: an office wall with two doors and windows into the hall.
    const wz = Z0 + MZ - 0.1;
    const h = top - 0.3 - GROUND_TOP;
    const doors = [X0 + ML * 0.25, X0 + ML * 0.75];
    let x = X0;
    // Doors 1.7 m wide: narrower ones close up on the navmesh in a hall turned off the world axes.
    for (const dx of doors) {
      wallRun(c, x, dx - 0.85, wz, h);
      box(dx, GROUND_TOP + 2.2 + (h - 2.2) / 2, wz, 1.7, h - 2.2, 0.2, 'wall', '#d4cec2', 'concrete');
      x = dx + 0.85;
    }
    wallRun(c, x, xm, wz, h);
    box(X0 + ML / 2, GROUND_TOP + h / 2, Z0 + (MZ - 0.2) / 2, 0.2, h, MZ - 0.2, 'wall', '#d4cec2', 'concrete');
    // Firing spots at the high north windows, from the mezzanine floor.
    const north = c.sides.find((s) => s.id === 'n')!;
    for (const col of c.columns.n ?? []) {
      const lx = -W / 2 + col.u;
      if (lx < X0 + 0.8 || lx > xm - 0.8 || col.o.sill - top > 1.3) continue;
      c.spot(lx, top, Z0 + WINDOW_STANDOFF, north.normal[0], north.normal[1], col.o);
    }
    // Columns under the mezzanine edge.
    for (let px = X0 + 4; px < xm - 1; px += 4.5) box(px, top / 2, Z0 + MZ - 0.35, 0.3, top - 0.3, 0.3, 'cover', STEEL, 'metal');
  }
  // Steel columns across the hall (clear of door lanes), roof trusses on them.
  const lanes = Object.entries(c.doorAt).map(([id, d]) => {
    const s = c.sides.find((q) => q.id === id)!;
    return { id, x: s.origin[0] + s.dir[0] * d!.u, z: s.origin[1] + s.dir[1] * d!.u, half: d!.width / 2 + 1.5 };
  });
  const rowsZ = Z1 - Z0 >= 18 ? [Z0 + (Z1 - Z0) / 3, Z0 + (2 * (Z1 - Z0)) / 3] : [(Z0 + Z1) / 2];
  for (let px = X0 + 6.5; px < X1 - 4; px += 7) {
    deco(px, H - 0.45, 0, 0.3, 0.7, D - 2 * WALL, 'prop', STEEL, 'metal');
    for (const pz of rowsZ) {
      if (hasMezz && px < X0 + ML + run + 1 && pz < Z0 + MZ + 1.5) continue;
      const blocked = lanes.some((l) => ((l.id === 'n' || l.id === 's') && Math.abs(px - l.x) < l.half) || ((l.id === 'e' || l.id === 'w') && Math.abs(pz - l.z) < l.half));
      if (!blocked) box(px, H / 2, pz, 0.45, H, 0.45, 'cover', STEEL, 'metal');
    }
  }
}

/** A plain interior wall along x from x0 to x1 at z, with a window band in it (the factory offices). */
function wallRun(c: Ctx, x0: number, x1: number, z: number, h: number): void {
  const len = x1 - x0;
  if (len < 0.05) return;
  const col = '#d4cec2';
  if (len < 2.4) {
    c.box((x0 + x1) / 2, GROUND_TOP + h / 2, z, len, h, 0.2, 'wall', col, 'concrete');
    return;
  }
  // Window from 1 m to 2.1 m, 0.5 m piers at the ends.
  c.box((x0 + x1) / 2, GROUND_TOP + 0.5, z, len, 1.0, 0.2, 'wall', col, 'concrete');
  c.box((x0 + x1) / 2, GROUND_TOP + 2.1 + (h - 2.1) / 2, z, len, h - 2.1, 0.2, 'wall', col, 'concrete');
  for (const x of [x0 + 0.25, x1 - 0.25]) c.box(x, GROUND_TOP + 1.55, z, 0.5, 1.1, 0.2, 'wall', col, 'concrete');
}
