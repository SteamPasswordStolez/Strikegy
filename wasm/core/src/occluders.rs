//! What blocks a line of sight: the world's static boxes (walls, floors, tree
//! trunks, sandbags... every `addStaticBox` on the WORLD layer) and the hulls
//! of ground vehicles. The terrain is not here (the JS side checks its height
//! grid first).
//!
//! Static boxes live in a uniform grid over the XZ plane. Each cell's boxes
//! are copied out in cell order as structure-of-arrays, so a segment walking
//! the grid (2D DDA) tests four boxes per SIMD op with an exact slab test in
//! each box's own frame. A box covering several cells is tested in each:
//! harmless for "is anything in the way". Boxes are added / removed by slot;
//! the grid is rebuilt lazily before the next query after a change.

use core::arch::wasm32::*;

pub const MAX_BOXES: usize = 16384;
/// Box copies over all cells (each box once per cell its bounds touch); +4 so
/// a group of four read past the last cell stays in bounds.
const MAX_ENTRIES: usize = 98304;
const MAX_CELLS: usize = 65536;
pub const MAX_DYNAMIC: usize = 64;
/// Grid cells are this size (m) unless the world is too big for `MAX_CELLS`.
const MIN_CELL: f32 = 4.0;

/// One set of oriented boxes as structure-of-arrays: centre, half extents and
/// the box's axes in world space (a = local x, b = local y, c = local z).
#[repr(C, align(16))]
struct Obbs<const N: usize> {
    cx: [f32; N],
    cy: [f32; N],
    cz: [f32; N],
    hx: [f32; N],
    hy: [f32; N],
    hz: [f32; N],
    ax: [f32; N],
    ay: [f32; N],
    az: [f32; N],
    bx: [f32; N],
    by: [f32; N],
    bz: [f32; N],
    gx: [f32; N],
    gy: [f32; N],
    gz: [f32; N],
}

impl<const N: usize> Obbs<N> {
    const ZERO: Self = Self {
        cx: [0.0; N],
        cy: [0.0; N],
        cz: [0.0; N],
        hx: [0.0; N],
        hy: [0.0; N],
        hz: [0.0; N],
        ax: [0.0; N],
        ay: [0.0; N],
        az: [0.0; N],
        bx: [0.0; N],
        by: [0.0; N],
        bz: [0.0; N],
        gx: [0.0; N],
        gy: [0.0; N],
        gz: [0.0; N],
    };

    #[allow(clippy::too_many_arguments)]
    fn set(&mut self, i: usize, cx: f32, cy: f32, cz: f32, hx: f32, hy: f32, hz: f32, qx: f32, qy: f32, qz: f32, qw: f32) {
        self.cx[i] = cx;
        self.cy[i] = cy;
        self.cz[i] = cz;
        self.hx[i] = hx;
        self.hy[i] = hy;
        self.hz[i] = hz;
        // Rotation matrix columns from the quaternion.
        let (xx, yy, zz) = (qx * qx, qy * qy, qz * qz);
        let (xy, xz, yz) = (qx * qy, qx * qz, qy * qz);
        let (wx, wy, wz) = (qw * qx, qw * qy, qw * qz);
        self.ax[i] = 1.0 - 2.0 * (yy + zz);
        self.ay[i] = 2.0 * (xy + wz);
        self.az[i] = 2.0 * (xz - wy);
        self.bx[i] = 2.0 * (xy - wz);
        self.by[i] = 1.0 - 2.0 * (xx + zz);
        self.bz[i] = 2.0 * (yz + wx);
        self.gx[i] = 2.0 * (xz + wy);
        self.gy[i] = 2.0 * (yz - wx);
        self.gz[i] = 1.0 - 2.0 * (xx + yy);
    }

    fn copy_from<const M: usize>(&mut self, at: usize, o: &Obbs<M>, i: usize) {
        self.cx[at] = o.cx[i];
        self.cy[at] = o.cy[i];
        self.cz[at] = o.cz[i];
        self.hx[at] = o.hx[i];
        self.hy[at] = o.hy[i];
        self.hz[at] = o.hz[i];
        self.ax[at] = o.ax[i];
        self.ay[at] = o.ay[i];
        self.az[at] = o.az[i];
        self.bx[at] = o.bx[i];
        self.by[at] = o.by[i];
        self.bz[at] = o.bz[i];
        self.gx[at] = o.gx[i];
        self.gy[at] = o.gy[i];
        self.gz[at] = o.gz[i];
    }

    /// Never hit: a point-sized box far away (padding). Its axes must be
    /// real ones; with zero axes every ray would start inside it.
    fn clear(&mut self, at: usize) {
        self.set(at, 1e30, 1e30, 1e30, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0);
    }

    /// World-space half size of the box's axis-aligned bounds.
    fn reach(&self, i: usize) -> (f32, f32) {
        let (hx, hy, hz) = (self.hx[i], self.hy[i], self.hz[i]);
        let rx = self.ax[i].abs() * hx + self.bx[i].abs() * hy + self.gx[i].abs() * hz;
        let rz = self.az[i].abs() * hx + self.bz[i].abs() * hy + self.gz[i].abs() * hz;
        (rx, rz)
    }
}

struct Occluders {
    boxes: Obbs<MAX_BOXES>,
    live: [u8; MAX_BOXES],
    entries: Obbs<{ MAX_ENTRIES + 4 }>,
    start: [u32; MAX_CELLS + 1],
    cursor: [u32; MAX_CELLS],
    dynamic: Obbs<MAX_DYNAMIC>,
}

static mut OCC: Occluders = Occluders {
    boxes: Obbs::ZERO,
    live: [0; MAX_BOXES],
    entries: Obbs::ZERO,
    start: [0; MAX_CELLS + 1],
    cursor: [0; MAX_CELLS],
    dynamic: Obbs::ZERO,
};

/// Grid placement and state (apart from the arrays, which stay all zero).
struct Grid {
    slots: usize,
    dynamic: usize,
    dirty: bool,
    /// The grid couldn't hold the boxes: queries must go elsewhere.
    overflow: bool,
    x0: f32,
    z0: f32,
    cell: f32,
    cols: i32,
    rows: i32,
}

static mut GRID: Grid = Grid { slots: 0, dynamic: 0, dirty: false, overflow: false, x0: 0.0, z0: 0.0, cell: MIN_CELL, cols: 0, rows: 0 };

#[inline(always)]
fn occ() -> &'static mut Occluders {
    unsafe { &mut *(&raw mut OCC) }
}

#[inline(always)]
fn grid() -> &'static mut Grid {
    unsafe { &mut *(&raw mut GRID) }
}

#[unsafe(no_mangle)]
pub extern "C" fn occ_max_boxes() -> u32 {
    MAX_BOXES as u32
}

/// Forget every box (a new world).
#[unsafe(no_mangle)]
pub extern "C" fn occ_reset() {
    let o = occ();
    o.live.fill(0);
    let g = grid();
    g.slots = 0;
    g.dynamic = 0;
    g.dirty = true;
    g.overflow = false;
}

/// Static box in `slot` (centre, half extents, rotation quaternion).
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn occ_set_box(slot: u32, cx: f32, cy: f32, cz: f32, hx: f32, hy: f32, hz: f32, qx: f32, qy: f32, qz: f32, qw: f32) {
    let i = slot as usize;
    if i >= MAX_BOXES {
        return;
    }
    let o = occ();
    o.boxes.set(i, cx, cy, cz, hx, hy, hz, qx, qy, qz, qw);
    o.live[i] = 1;
    let g = grid();
    g.slots = g.slots.max(i + 1);
    g.dirty = true;
}

#[unsafe(no_mangle)]
pub extern "C" fn occ_remove_box(slot: u32) {
    let i = slot as usize;
    if i < MAX_BOXES {
        occ().live[i] = 0;
        grid().dirty = true;
    }
}

/// Moving box `i` of the `count` tested on every query (vehicle hulls).
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn occ_set_dynamic(i: u32, cx: f32, cy: f32, cz: f32, hx: f32, hy: f32, hz: f32, qx: f32, qy: f32, qz: f32, qw: f32) {
    if (i as usize) < MAX_DYNAMIC {
        occ().dynamic.set(i as usize, cx, cy, cz, hx, hy, hz, qx, qy, qz, qw);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn occ_dynamic_count(count: u32) {
    let g = grid();
    g.dynamic = (count as usize).min(MAX_DYNAMIC);
    // Pad the last group of four.
    let o = occ();
    for i in g.dynamic..(g.dynamic + 3).min(MAX_DYNAMIC) {
        o.dynamic.clear(i);
    }
}

#[inline(always)]
fn floor_i(v: f32) -> i32 {
    let t = v as i32;
    if (t as f32) > v { t - 1 } else { t }
}

/// The grid from the live boxes. False if they don't fit (queries then report it).
fn build() -> bool {
    let o = occ();
    let g = grid();
    g.dirty = false;
    let n = g.slots;
    let (mut x0, mut z0, mut x1, mut z1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for i in 0..n {
        if o.live[i] == 0 {
            continue;
        }
        let (rx, rz) = o.boxes.reach(i);
        x0 = x0.min(o.boxes.cx[i] - rx);
        x1 = x1.max(o.boxes.cx[i] + rx);
        z0 = z0.min(o.boxes.cz[i] - rz);
        z1 = z1.max(o.boxes.cz[i] + rz);
    }
    if x0 > x1 {
        // No boxes.
        g.cols = 0;
        g.rows = 0;
        g.overflow = false;
        return true;
    }
    // Cells of MIN_CELL, coarser if the world needs more than MAX_CELLS of them.
    // sqrt(MAX_CELLS) - 1 per side.
    let side = 255.0;
    let cell = MIN_CELL.max((x1 - x0) / side).max((z1 - z0) / side);
    g.x0 = x0;
    g.z0 = z0;
    g.cell = cell;
    g.cols = floor_i((x1 - x0) / cell) + 1;
    g.rows = floor_i((z1 - z0) / cell) + 1;
    let cols = g.cols;
    let cells = (g.cols * g.rows) as usize;
    let span = |o: &Occluders, i: usize| {
        let (rx, rz) = o.boxes.reach(i);
        let c0 = floor_i((o.boxes.cx[i] - rx - x0) / cell).max(0);
        let c1 = floor_i((o.boxes.cx[i] + rx - x0) / cell).min(cols - 1);
        let r0 = floor_i((o.boxes.cz[i] - rz - z0) / cell).max(0);
        let r1 = floor_i((o.boxes.cz[i] + rz - z0) / cell).min(g.rows - 1);
        (c0, c1, r0, r1)
    };
    o.start[..=cells].fill(0);
    let mut total = 0usize;
    for i in 0..n {
        if o.live[i] == 0 {
            continue;
        }
        let (c0, c1, r0, r1) = span(o, i);
        for r in r0..=r1 {
            for c in c0..=c1 {
                o.start[(r * cols + c) as usize + 1] += 1;
                total += 1;
            }
        }
    }
    if total > MAX_ENTRIES {
        g.overflow = true;
        return false;
    }
    for c in 0..cells {
        o.start[c + 1] += o.start[c];
    }
    o.cursor[..cells].copy_from_slice(&o.start[..cells]);
    for i in 0..n {
        if o.live[i] == 0 {
            continue;
        }
        let (c0, c1, r0, r1) = span(o, i);
        for r in r0..=r1 {
            for c in c0..=c1 {
                let cell = (r * cols + c) as usize;
                let at = o.cursor[cell] as usize;
                o.cursor[cell] += 1;
                let boxes = unsafe { &*(&raw const o.boxes) };
                o.entries.copy_from(at, boxes, i);
            }
        }
    }
    for at in total..total + 4 {
        o.entries.clear(at);
    }
    g.overflow = false;
    true
}

/// Rebuilds after changes; 1 if queries can be answered here, 0 if the boxes overflowed the grid.
#[unsafe(no_mangle)]
pub extern "C" fn occ_ready() -> u32 {
    let g = grid();
    if g.dirty {
        build();
    }
    (!g.overflow) as u32
}

/// Four boxes from `at` against the segment o + t·d, t in [0, max_t]: any hit.
#[inline(always)]
unsafe fn hit4<const N: usize>(b: &Obbs<N>, at: usize, o: [v128; 3], d: [v128; 3], max_t: v128) -> bool {
    unsafe {
        let ld = |a: &[f32; N]| v128_load(a.as_ptr().add(at) as *const v128);
        let rx = f32x4_sub(o[0], ld(&b.cx));
        let ry = f32x4_sub(o[1], ld(&b.cy));
        let rz = f32x4_sub(o[2], ld(&b.cz));
        let zero = f32x4_splat(0.0);
        let tiny = f32x4_splat(1e-20);
        let mut t0 = zero;
        let mut t1 = max_t;
        // One slab per box axis: origin and direction in the box's frame.
        for (axx, axy, axz, h) in [(&b.ax, &b.ay, &b.az, &b.hx), (&b.bx, &b.by, &b.bz, &b.hy), (&b.gx, &b.gy, &b.gz, &b.hz)] {
            let (ux, uy, uz) = (ld(axx), ld(axy), ld(axz));
            let lo = f32x4_add(f32x4_add(f32x4_mul(rx, ux), f32x4_mul(ry, uy)), f32x4_mul(rz, uz));
            let ld_ = f32x4_add(f32x4_add(f32x4_mul(d[0], ux), f32x4_mul(d[1], uy)), f32x4_mul(d[2], uz));
            // Parallel to the slab: keep the sign, avoid 0 * inf.
            let small = f32x4_lt(f32x4_abs(ld_), tiny);
            let ld_ = v128_bitselect(v128_or(v128_and(ld_, u32x4_splat(0x8000_0000)), tiny), ld_, small);
            let inv = f32x4_div(f32x4_splat(1.0), ld_);
            let he = ld(h);
            let a = f32x4_mul(f32x4_sub(f32x4_neg(he), lo), inv);
            let c = f32x4_mul(f32x4_sub(he, lo), inv);
            t0 = f32x4_max(t0, f32x4_min(a, c));
            t1 = f32x4_min(t1, f32x4_max(a, c));
        }
        v128_any_true(f32x4_le(t0, t1))
    }
}

/// Is the segment from (ox, oy, oz) toward (tx, ty, tz), up to `len - 0.05`,
/// blocked by a box? Same question as Rapier's `castRay(.., dist - 0.05, solid)`.
/// Call `occ_ready` first after changes.
#[unsafe(no_mangle)]
pub extern "C" fn occ_blocked(ox: f32, oy: f32, oz: f32, tx: f32, ty: f32, tz: f32) -> u32 {
    let o = occ();
    let g = grid();
    let (dx, dy, dz) = (tx - ox, ty - oy, tz - oz);
    let len = f32x4_extract_lane::<0>(f32x4_sqrt(f32x4_splat(dx * dx + dy * dy + dz * dz)));
    if len < 0.06 {
        return 0;
    }
    let max_t = len - 0.05;
    let (dx, dy, dz) = (dx / len, dy / len, dz / len);
    let vo = [f32x4_splat(ox), f32x4_splat(oy), f32x4_splat(oz)];
    let vd = [f32x4_splat(dx), f32x4_splat(dy), f32x4_splat(dz)];
    let vt = f32x4_splat(max_t);

    for at in (0..g.dynamic).step_by(4) {
        if unsafe { hit4(&o.dynamic, at, vo, vd, vt) } {
            return 1;
        }
    }
    if g.cols == 0 {
        return 0;
    }
    // Walk the cells under the segment (2D DDA over XZ).
    let cell = g.cell;
    let fx = (ox - g.x0) / cell;
    let fz = (oz - g.z0) / cell;
    let ex = fx + dx * max_t / cell;
    let ez = fz + dz * max_t / cell;
    let mut c = floor_i(fx);
    let mut r = floor_i(fz);
    let c_end = floor_i(ex);
    let r_end = floor_i(ez);
    let step_c = if dx > 0.0 { 1 } else { -1 };
    let step_r = if dz > 0.0 { 1 } else { -1 };
    // Parameter (in cells along the segment's XZ path) to the next column / row line.
    let inf = f32::MAX;
    let (dtc, mut tc) = if dx != 0.0 {
        let next = if dx > 0.0 { (c + 1) as f32 } else { c as f32 };
        let inv = (1.0 / dx).abs();
        (inv, (next - fx) / dx)
    } else {
        (inf, inf)
    };
    let (dtr, mut tr) = if dz != 0.0 {
        let next = if dz > 0.0 { (r + 1) as f32 } else { r as f32 };
        let inv = (1.0 / dz).abs();
        (inv, (next - fz) / dz)
    } else {
        (inf, inf)
    };
    let steps = (c_end - c).abs() + (r_end - r).abs();
    for _ in 0..=steps {
        if c >= 0 && r >= 0 && c < g.cols && r < g.rows {
            let k = (r * g.cols + c) as usize;
            let (s, e) = (o.start[k] as usize, o.start[k + 1] as usize);
            let mut at = s;
            while at < e {
                // A group reaching past the cell tests the next cell's boxes too: still a real hit.
                if unsafe { hit4(&o.entries, at, vo, vd, vt) } {
                    return 1;
                }
                at += 4;
            }
        }
        if c == c_end && r == r_end {
            break;
        }
        if tc < tr {
            c += step_c;
            tc += dtc;
        } else {
            r += step_r;
            tr += dtr;
        }
    }
    0
}
