//! Everyone on the field (bots and people) as structure-of-arrays, a
//! spatial hash over the bots, and the per-bot queries that run over it:
//! separation (stepping around and pushing apart), "spot taken", and the
//! first pass of perception (who is in view at all), the last with SIMD128.
//!
//! Slots are filled by `src/ai/crowd.ts`: one per bot in roster order, then
//! the people (`crowd_set_humans`). Flags say alive / downed / side / riding in an aircraft / has
//! a goal / is a bot (in the grid).

use core::arch::wasm32::*;

/// Most combatants (a multiple of 4 for the SIMD loop).
pub const CAP: usize = 1024;
/// Most people (players) in a match.
pub const MAX_HUMANS: usize = 256;
static mut HUMAN_SLOTS: Lanes<u32, MAX_HUMANS> = Lanes([0; MAX_HUMANS]);

/// Hash buckets for the neighbour grid (a power of two).
const BUCKETS: usize = 4096;

pub const ALIVE: u32 = 1;
pub const DOWNED: u32 = 2;
pub const RED: u32 = 4;
pub const AIR: u32 = 8;
pub const HAS_GOAL: u32 = 16;
pub const BOT: u32 = 32;
pub const FIRING: u32 = 64;
pub const ARMOUR: u32 = 128;

#[repr(C, align(16))]
struct Lanes<T: Copy, const N: usize>([T; N]);

#[repr(C)]
struct Crowd {
    x: Lanes<f32, CAP>,
    y: Lanes<f32, CAP>,
    z: Lanes<f32, CAP>,
    vx: Lanes<f32, CAP>,
    vz: Lanes<f32, CAP>,
    flags: Lanes<u32, CAP>,
    ids: Lanes<i32, CAP>,
    // Neighbour grid: each member's cell, members sorted by bucket (`start`
    // has each bucket's first index, `cursor` is scratch for the sort).
    cell_x: Lanes<i32, CAP>,
    cell_z: Lanes<i32, CAP>,
    start: Lanes<u32, { BUCKETS + 1 }>,
    cursor: Lanes<u32, BUCKETS>,
    sorted: Lanes<u32, CAP>,
    // Outputs.
    out: Lanes<f32, 4>,
    hits: Lanes<u32, CAP>,
    hit_dist: Lanes<f32, CAP>,
}

/// Counts and tuning, apart from the arrays so those stay all zero (no data segment).
struct Params {
    count: usize,
    /// Slots of the people (repelled 1.2x as wide), `humans` of them in `human_slots`.
    humans: usize,
    // Tuning (from `BotManager`).
    cell: f32,
    sep_radius: f32,
    sep_standing: f32,
    sep_speed: f32,
    moving: f32,
    avoid_ahead: f32,
    avoid_width: f32,
    spot_taken: f32,
}

static mut CROWD: Crowd = Crowd {
    x: Lanes([0.0; CAP]),
    y: Lanes([0.0; CAP]),
    z: Lanes([0.0; CAP]),
    vx: Lanes([0.0; CAP]),
    vz: Lanes([0.0; CAP]),
    flags: Lanes([0; CAP]),
    ids: Lanes([0; CAP]),
    cell_x: Lanes([0; CAP]),
    cell_z: Lanes([0; CAP]),
    start: Lanes([0; BUCKETS + 1]),
    cursor: Lanes([0; BUCKETS]),
    sorted: Lanes([0; CAP]),
    out: Lanes([0.0; 4]),
    hits: Lanes([0; CAP]),
    hit_dist: Lanes([0.0; CAP]),
};

static mut PARAMS: Params = Params {
    count: 0,
    humans: 0,
    cell: 2.0,
    sep_radius: 0.95,
    sep_standing: 0.7,
    sep_speed: 1.9,
    moving: 0.3,
    avoid_ahead: 2.0,
    avoid_width: 0.85,
    spot_taken: 0.75,
};

#[inline(always)]
fn crowd() -> &'static mut Crowd {
    // Single-threaded wasm: the only way in is one export call at a time.
    unsafe { &mut *(&raw mut CROWD) }
}

#[inline(always)]
fn params() -> &'static mut Params {
    unsafe { &mut *(&raw mut PARAMS) }
}

// ---------------------------------------------------------------------------
// Layout (pointers for the JS views)

#[unsafe(no_mangle)]
pub extern "C" fn crowd_cap() -> u32 {
    CAP as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn crowd_x() -> *mut f32 {
    crowd().x.0.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn crowd_y() -> *mut f32 {
    crowd().y.0.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn crowd_z() -> *mut f32 {
    crowd().z.0.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn crowd_vx() -> *mut f32 {
    crowd().vx.0.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn crowd_vz() -> *mut f32 {
    crowd().vz.0.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn crowd_flags() -> *mut u32 {
    crowd().flags.0.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn crowd_ids() -> *mut i32 {
    crowd().ids.0.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn crowd_out() -> *mut f32 {
    crowd().out.0.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn crowd_hits() -> *mut u32 {
    crowd().hits.0.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn crowd_hit_dist() -> *mut f32 {
    crowd().hit_dist.0.as_mut_ptr()
}

/// Number of slots in use (unused ones below it have flags 0). Slots past `count`
/// are cleared so the SIMD loop's last group of four never matches them.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_set_count(count: u32) {
    let c = crowd();
    let q = params();
    let n = (count as usize).min(CAP);
    c.flags.0[n..].fill(0);
    q.count = n;
}

/// Where the people are: `crowd_humans()` holds their slots; this says how many.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_set_humans(n: u32) {
    params().humans = (n as usize).min(MAX_HUMANS);
}

#[unsafe(no_mangle)]
pub extern "C" fn crowd_humans() -> *mut u32 {
    unsafe { (*(&raw mut HUMAN_SLOTS)).0.as_mut_ptr() }
}

#[unsafe(no_mangle)]
pub extern "C" fn crowd_config(cell: f32, sep_radius: f32, sep_standing: f32, sep_speed: f32, moving: f32, avoid_ahead: f32, avoid_width: f32, spot_taken: f32) {
    let q = params();
    q.cell = cell;
    q.sep_radius = sep_radius;
    q.sep_standing = sep_standing;
    q.sep_speed = sep_speed;
    q.moving = moving;
    q.avoid_ahead = avoid_ahead;
    q.avoid_width = avoid_width;
    q.spot_taken = spot_taken;
}

// ---------------------------------------------------------------------------
// Neighbour grid

#[inline(always)]
fn bucket(cx: i32, cz: i32) -> usize {
    let h = (cx as u32).wrapping_mul(0x9E37_79B1) ^ (cz as u32).wrapping_mul(0x85EB_CA6B);
    (h >> 16) as usize & (BUCKETS - 1)
}

#[inline(always)]
fn cell_of(v: f32, cell: f32) -> i32 {
    // floor() without libm: truncate, then step down for negative fractions.
    let q = v / cell;
    let t = q as i32;
    if (t as f32) > q { t - 1 } else { t }
}

#[inline(always)]
fn in_grid(flags: u32) -> bool {
    flags & (BOT | ALIVE) == BOT | ALIVE
}

/// Living bots into the hash grid (a counting sort by bucket; roster order is kept within a bucket).
#[unsafe(no_mangle)]
pub extern "C" fn crowd_build_grid() {
    let c = crowd();
    let q = params();
    let n = q.count;
    c.start.0.fill(0);
    for i in 0..n {
        if !in_grid(c.flags.0[i]) {
            continue;
        }
        let cx = cell_of(c.x.0[i], q.cell);
        let cz = cell_of(c.z.0[i], q.cell);
        c.cell_x.0[i] = cx;
        c.cell_z.0[i] = cz;
        c.start.0[bucket(cx, cz) + 1] += 1;
    }
    for b in 0..BUCKETS {
        c.start.0[b + 1] += c.start.0[b];
    }
    c.cursor.0.copy_from_slice(&c.start.0[..BUCKETS]);
    for i in 0..n {
        if !in_grid(c.flags.0[i]) {
            continue;
        }
        let b = bucket(c.cell_x.0[i], c.cell_z.0[i]);
        let at = c.cursor.0[b] as usize;
        c.sorted.0[at] = i as u32;
        c.cursor.0[b] += 1;
    }
}

/// Calls `f` with every grid member in cell (cx, cz), in roster order.
#[inline(always)]
fn each_in_cell(c: &Crowd, cx: i32, cz: i32, mut f: impl FnMut(usize)) {
    let b = bucket(cx, cz);
    for k in c.start.0[b] as usize..c.start.0[b + 1] as usize {
        let o = c.sorted.0[k] as usize;
        // Other cells can share the bucket.
        if c.cell_x.0[o] == cx && c.cell_z.0[o] == cz {
            f(o);
        }
    }
}

// ---------------------------------------------------------------------------
// Separation

fn hypot(a: f32, b: f32) -> f32 {
    sqrt(a * a + b * b)
}

struct Push {
    x: f32,
    z: f32,
    steer: f32,
}

/// One neighbour's share of the push apart and the sideways steer (see `BotManager.repel`).
#[inline(always)]
fn repel(c: &Crowd, q: &Params, b: usize, o: usize, scale: f32, wx: f32, wz: f32, speed: f32, p: &mut Push) {
    let of = c.flags.0[o];
    if of & ALIVE == 0 || (c.y.0[o] - c.y.0[b]).abs() > 1.5 {
        return;
    }
    let dx = c.x.0[b] - c.x.0[o];
    let dz = c.z.0[b] - c.z.0[o];
    let d = hypot(dx, dz);
    let moving = speed > 0.1;
    let (ovx, ovz) = (c.vx.0[o], c.vz.0[o]);
    let o_speed = hypot(ovx, ovz);
    let o_moving = of & DOWNED == 0 && o_speed > q.moving;
    let radius = if moving || o_moving { q.sep_radius } else { q.sep_standing } * scale;
    if d < radius {
        // Whoever walks gives way: someone standing is only nudged by a walker.
        let share = if moving {
            if o_moving { 1.0 } else { 1.4 }
        } else if o_moving {
            0.35
        } else {
            1.0
        };
        let k = (1.0 - d / radius) * q.sep_speed * share;
        if d < 1e-3 {
            // Exactly on top of each other: split by id.
            p.x += if c.ids.0[b] > c.ids.0[o] { k } else { -k };
        } else {
            p.x += dx / d * k;
            p.z += dz / d * k;
        }
    }
    if !moving {
        return;
    }
    // Someone ahead on this bot's line: veer before bumping into them.
    let ahead = -dx * wx - dz * wz;
    if ahead < 0.05 || ahead > q.avoid_ahead {
        return;
    }
    let lat = dx * wz - dz * wx;
    let width = q.avoid_width * scale;
    if lat.abs() > width {
        return;
    }
    // Walking toward each other: both keep right. Otherwise pass on the side away from them.
    let head_on = o_moving && ovx * wx + ovz * wz < -0.3 * o_speed;
    let side = if head_on || lat.abs() < 0.05 { 1.0 } else if lat > 0.0 { -1.0 } else { 1.0 };
    p.steer += side * (1.0 - ahead / q.avoid_ahead) * (1.0 - lat.abs() / width * 0.5);
}

/// Push for bot `slot` walking along (wx, wz) at `speed`: out[0], out[1] = x, z (m/s).
#[unsafe(no_mangle)]
pub extern "C" fn crowd_separation(slot: u32, wx: f32, wz: f32, speed: f32) {
    let c = crowd();
    let q = params();
    let b = slot as usize;
    let mut p = Push { x: 0.0, z: 0.0, steer: 0.0 };
    let cx = cell_of(c.x.0[b], q.cell);
    let cz = cell_of(c.z.0[b], q.cell);
    for i in -1..=1 {
        for j in -1..=1 {
            each_in_cell(c, cx + i, cz + j, |o| {
                if o != b {
                    repel(c, q, b, o, 1.0, wx, wz, speed, &mut p);
                }
            });
        }
    }
    // Bots walk on the navmesh without colliding: keep them off people too.
    for h in 0..q.humans {
        let o = unsafe { (*(&raw const HUMAN_SLOTS)).0[h] } as usize;
        if o < q.count {
            repel(c, q, b, o, 1.2, wx, wz, speed, &mut p);
        }
    }
    if p.steer != 0.0 {
        // Step around whoever is in the way (to the right of the walking direction is (-wz, wx)).
        let k = p.steer.clamp(-1.0, 1.0) * speed * 0.9;
        p.x += -wz * k;
        p.z += wx * k;
    }
    c.out.0[0] = p.x;
    c.out.0[1] = p.z;
}

/// Someone (a bot other than `slot`, standing without a goal) already within
/// `spot_taken` of (x, y, z): 1, else 0.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_spot_taken(slot: i32, x: f32, y: f32, z: f32) -> u32 {
    let c = crowd();
    let q = params();
    let cx = cell_of(x, q.cell);
    let cz = cell_of(z, q.cell);
    let r = q.spot_taken;
    let mut taken = false;
    for i in -1..=1 {
        for j in -1..=1 {
            if taken {
                return 1;
            }
            each_in_cell(c, cx + i, cz + j, |o| {
                if o as i32 != slot
                    && c.flags.0[o] & (ALIVE | HAS_GOAL) == ALIVE
                    && (c.y.0[o] - y).abs() < 1.5
                    && hypot(c.x.0[o] - x, c.z.0[o] - z) < r
                {
                    taken = true;
                }
            });
        }
    }
    taken as u32
}

// ---------------------------------------------------------------------------
// Perception, first pass (SIMD)

/// The view test of one combatant, set up once per query (see `crowd_view`).
struct View {
    sx: v128,
    sy: v128,
    sz: v128,
    fx: v128,
    fz: v128,
    cp: v128,
    sp: v128,
    half: v128,
    up: v128,
    sight2: v128,
    air2: v128,
    near2: v128,
    side: v128,
    want: v128,
    air: v128,
    free: v128,
    /// RED for a blue viewer, 0 for a red one.
    enemy: u32,
}

impl View {
    #[allow(clippy::too_many_arguments)]
    fn new(c: &Crowd, s: usize, sight: f32, air_sight: f32, cos_half: f32, cos_up: f32, free_up: u32, yaw: f32, pitch: f32) -> View {
        // Facing (yaw 0 looks down -z): forward = (-sin yaw, -cos yaw).
        let (sin_y, cos_y) = sincos(yaw);
        let (sin_p, cos_p) = sincos(pitch);
        let enemy = if c.flags.0[s] & RED != 0 { 0 } else { RED };
        View {
            sx: f32x4_splat(c.x.0[s]),
            sy: f32x4_splat(c.y.0[s]),
            sz: f32x4_splat(c.z.0[s]),
            fx: f32x4_splat(-sin_y),
            fz: f32x4_splat(-cos_y),
            cp: f32x4_splat(cos_p),
            sp: f32x4_splat(sin_p),
            half: f32x4_splat(cos_half),
            up: f32x4_splat(cos_up),
            sight2: f32x4_splat(sight * sight),
            air2: f32x4_splat(air_sight * air_sight),
            near2: f32x4_splat(1.5 * 1.5),
            side: u32x4_splat(RED | ALIVE),
            want: u32x4_splat(enemy | ALIVE),
            air: u32x4_splat(AIR),
            free: if free_up != 0 { u32x4_splat(!0) } else { u32x4_splat(0) },
            enemy,
        }
    }

    /// Slots `i..i + 4`: which are living enemies in view, and their distances.
    #[inline(always)]
    fn group(&self, c: &Crowd, i: usize) -> (v128, v128) {
        unsafe {
            let flags = v128_load(c.flags.0.as_ptr().add(i) as *const v128);
            let side = u32x4_eq(v128_and(flags, self.side), self.want);
            if !v128_any_true(side) {
                return (side, f32x4_splat(0.0));
            }
            let dx = f32x4_sub(v128_load(c.x.0.as_ptr().add(i) as *const v128), self.sx);
            let dy = f32x4_sub(v128_load(c.y.0.as_ptr().add(i) as *const v128), self.sy);
            let dz = f32x4_sub(v128_load(c.z.0.as_ptr().add(i) as *const v128), self.sz);
            let flat2 = f32x4_add(f32x4_mul(dx, dx), f32x4_mul(dz, dz));
            let d2 = f32x4_add(flat2, f32x4_mul(dy, dy));
            let in_air = v128_and(flags, self.air);
            let sight2 = if v128_any_true(in_air) { v128_bitselect(self.air2, self.sight2, u32x4_eq(in_air, self.air)) } else { self.sight2 };
            let within = v128_and(side, f32x4_lt(d2, sight2));
            if !v128_any_true(within) {
                return (within, f32x4_splat(0.0));
            }
            let flat = f32x4_sqrt(flat2);
            let dist = f32x4_sqrt(d2);
            // In the cone: cos(off-axis) = (d · forward) / flat > cos(half).
            let fdot = f32x4_add(f32x4_mul(dx, self.fx), f32x4_mul(dz, self.fz));
            let cone = f32x4_gt(fdot, f32x4_mul(flat, self.half));
            // Within the view's height: cos(elevation - pitch) · dist > cos(up) · dist.
            let edot = f32x4_add(f32x4_mul(flat, self.cp), f32x4_mul(dy, self.sp));
            let tall = v128_or(self.free, f32x4_gt(edot, f32x4_mul(dist, self.up)));
            let near = f32x4_lt(d2, self.near2);
            (v128_and(within, v128_or(v128_and(cone, tall), near)), dist)
        }
    }
}

/// Enemies of the bot in `slot` it has in view: alive, within sight
/// (`air_sight` for anyone in an aircraft), inside the view cone (half angle
/// with cosine `cos_half`) and, unless `free_up`, within the view's height
/// (half angle with cosine `cos_up` around `pitch`) — or within 1.5 m, felt
/// rather than seen. Writes their slots (roster order) to `hits` and their
/// distances to `hit_dist`; returns how many.
///
/// The angle tests are dot products against the view direction, so there is
/// no atan2 per pair: off-axis < half ⇔ cos(off-axis) > cos(half).
#[unsafe(no_mangle)]
pub extern "C" fn crowd_view(slot: u32, sight: f32, air_sight: f32, cos_half: f32, cos_up: f32, free_up: u32, yaw: f32, pitch: f32) -> u32 {
    let c = crowd();
    let q = params();
    let v = View::new(c, slot as usize, sight, air_sight, cos_half, cos_up, free_up, yaw, pitch);
    let mut n = 0usize;
    for g in 0..q.count.div_ceil(4) {
        let i = g * 4;
        let (seen, dist) = v.group(c, i);
        let mut mask = i32x4_bitmask(seen) as u32;
        while mask != 0 {
            let lane = mask.trailing_zeros() as usize;
            mask &= mask - 1;
            c.hits.0[n] = (i + lane) as u32;
            c.hit_dist.0[n] = dist_lane(dist, lane);
            n += 1;
        }
    }
    n as u32
}

// ---------------------------------------------------------------------------
// Perception: the whole first pass (who is in view, notice bookkeeping, who
// matters most), leaving only the line-of-sight checks to JS.

/// How far each combatant (row) has noticed each other one (column): 0..1.5,
/// 1 = noticed. Bots' rows; `src/ai/crowd.ts` reads and writes it directly.
static mut NOTICE: Lanes<f32, { CAP * CAP }> = Lanes([0.0; CAP * CAP]);
/// Off-axis angle (deg) of each pick, and scratch scores.
static mut HIT_OFF: Lanes<f32, CAP> = Lanes([0.0; CAP]);
static mut SCORE: Lanes<f32, CAP> = Lanes([0.0; CAP]);

#[inline(always)]
fn notice() -> &'static mut [f32; CAP * CAP] {
    unsafe { &mut (*(&raw mut NOTICE)).0 }
}

#[inline(always)]
fn hit_off() -> &'static mut [f32; CAP] {
    unsafe { &mut (*(&raw mut HIT_OFF)).0 }
}

#[unsafe(no_mangle)]
pub extern "C" fn crowd_notice() -> *mut f32 {
    notice().as_mut_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn crowd_hit_off() -> *mut f32 {
    hit_off().as_mut_ptr()
}

/// Forgets everything `row` had noticed (blinded, respawned).
#[unsafe(no_mangle)]
pub extern "C" fn crowd_notice_clear(row: u32) {
    let r = row as usize;
    if r < CAP {
        notice()[r * CAP..(r + 1) * CAP].fill(0.0);
    }
}

/// The first pass of `Bot.perceive` for the bot in `slot` (see `crowd_view`
/// for the view arguments), as the TypeScript did it:
/// - enemies gone (dead / down) drop out of its notice;
/// - in view but not someone it can fight from here (`armour_ok` / `air_ok`
///   say whether crews under armour / in aircraft are; everyone else is):
///   notice back to 0;
/// - in view: a candidate, scored by distance, × 0.3 for its `target` slot,
///   × 0.3 for its last `attacker` slot, × 0.6 if being noticed, × 0.7 if
///   firing; distant (> 25 m), quiet ones not yet noticed only every other
///   time (`count` + id odd: skipped);
/// - out of view: notice fades by `dt` / 2 (to 0 if it can't fight them).
///
/// The `max_look` lowest-scored candidates go to `hits` / `hit_dist` /
/// `hit_off`, in score order; returns how many.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn crowd_perceive(
    slot: u32,
    sight: f32,
    air_sight: f32,
    cos_half: f32,
    cos_up: f32,
    free_up: u32,
    yaw: f32,
    pitch: f32,
    dt: f32,
    count: u32,
    target: i32,
    attacker: i32,
    armour_ok: u32,
    air_ok: u32,
    max_look: u32,
) -> u32 {
    let c = crowd();
    let q = params();
    let s = slot as usize;
    let v = View::new(c, s, sight, air_sight, cos_half, cos_up, free_up, yaw, pitch);
    let row = &mut notice()[s * CAP..(s + 1) * CAP];
    let scores = unsafe { &mut (*(&raw mut SCORE)).0 };
    let fade = dt * 0.5;
    let zero = f32x4_splat(0.0);
    let mut n = 0usize;
    for g in 0..q.count.div_ceil(4) {
        let i = g * 4;
        let noticed = unsafe { f32x4_gt(v128_load(row.as_ptr().add(i) as *const v128), zero) };
        let (seen, dist) = v.group(c, i);
        let seen_mask = i32x4_bitmask(seen) as u32;
        let mut mask = seen_mask | i32x4_bitmask(noticed) as u32;
        while mask != 0 {
            let lane = mask.trailing_zeros() as usize;
            mask &= mask - 1;
            let o = i + lane;
            if o >= q.count {
                continue;
            }
            let f = c.flags.0[o];
            if f & RED != v.enemy {
                continue;
            }
            let p = row[o];
            if f & ALIVE == 0 {
                row[o] = 0.0;
                continue;
            }
            let engage = if f & AIR != 0 {
                air_ok != 0
            } else if f & ARMOUR != 0 {
                armour_ok != 0
            } else {
                true
            };
            if seen_mask & (1 << lane) == 0 {
                // Noticed, out of view: fades.
                if p > 0.0 {
                    row[o] = if engage { (p - fade).max(0.0) } else { 0.0 };
                }
                continue;
            }
            if !engage {
                if p > 0.0 {
                    row[o] = 0.0;
                }
                continue;
            }
            let d = dist_lane(dist, lane);
            let firing = f & FIRING != 0;
            if p == 0.0 && !firing && d > 25.0 && (count.wrapping_add(c.ids.0[o] as u32)) & 1 == 1 {
                continue;
            }
            let mut score = d;
            if o as i32 == target {
                score *= 0.3;
            }
            if o as i32 == attacker {
                score *= 0.3;
            }
            if p > 0.0 {
                score *= 0.6;
            }
            if firing {
                score *= 0.7;
            }
            c.hits.0[n] = o as u32;
            c.hit_dist.0[n] = d;
            scores[n] = score;
            n += 1;
        }
    }
    // The few that matter most, in score order (selection sort, ties keep roster order).
    let look = n.min(max_look as usize);
    for a in 0..look {
        let mut k = a;
        for b in a + 1..n {
            if scores[b] < scores[k] {
                k = b;
            }
        }
        if k != a {
            c.hits.0.swap(a, k);
            c.hit_dist.0.swap(a, k);
            scores.swap(a, k);
        }
    }
    let offs = hit_off();
    let (sx, sz) = (c.x.0[s], c.z.0[s]);
    for a in 0..look {
        let o = c.hits.0[a] as usize;
        offs[a] = off_axis_deg(yaw, c.x.0[o] - sx, c.z.0[o] - sz);
    }
    look as u32
}

/// |angle from facing `yaw` to the direction (dx, dz)| in degrees (`offAxisDeg` in aim.ts).
fn off_axis_deg(yaw: f32, dx: f32, dz: f32) -> f32 {
    const PI: f32 = core::f32::consts::PI;
    const TAU: f32 = core::f32::consts::TAU;
    let d = atan2(-dx, -dz) - yaw;
    // Wrap to [-pi, pi].
    let k = d / TAU + 0.5;
    let k = { let t = k as i32; if (t as f32) > k { t - 1 } else { t } };
    let w = d - k as f32 * TAU;
    w.abs() * (180.0 / PI)
}

/// atan2 without libm (Abramowitz & Stegun 4.4.49 on [0, 1], error < 2e-8 rad).
fn atan2(y: f32, x: f32) -> f32 {
    const PI: f32 = core::f32::consts::PI;
    const HALF_PI: f32 = core::f32::consts::FRAC_PI_2;
    const C: [f32; 8] = [-0.333_331_45, 0.199_935_5, -0.142_088_99, 0.106_562_64, -0.075_289_64, 0.042_909_614, -0.016_165_737, 0.002_866_225_7];
    let (ax, ay) = (x.abs(), y.abs());
    let (hi, lo) = if ax > ay { (ax, ay) } else { (ay, ax) };
    if hi == 0.0 {
        return 0.0;
    }
    let a = lo / hi;
    let s = a * a;
    let mut p = 0.0f32;
    for c in C.iter().rev() {
        p = (p + c) * s;
    }
    let mut r = a * (1.0 + p);
    if ay > ax {
        r = HALF_PI - r;
    }
    if x < 0.0 {
        r = PI - r;
    }
    if y < 0.0 {
        r = -r;
    }
    r
}

#[inline(always)]
fn dist_lane(v: v128, lane: usize) -> f32 {
    match lane {
        0 => f32x4_extract_lane::<0>(v),
        1 => f32x4_extract_lane::<1>(v),
        2 => f32x4_extract_lane::<2>(v),
        _ => f32x4_extract_lane::<3>(v),
    }
}

/// sin and cos without libm (range-reduced Taylor series, error < 1e-6 rad):
/// once per query, not per pair.
fn sincos(a: f32) -> (f32, f32) {
    const TAU: f32 = core::f32::consts::TAU;
    const PI: f32 = core::f32::consts::PI;
    const HALF_PI: f32 = core::f32::consts::FRAC_PI_2;
    // To [-pi, pi].
    let k = a / TAU;
    let k = k as i32 as f32 + if k < 0.0 { -0.5 } else { 0.5 };
    let mut x = a - (k as i32) as f32 * TAU;
    if x > PI {
        x -= TAU;
    } else if x < -PI {
        x += TAU;
    }
    // To [-pi/2, pi/2], flipping cos.
    let mut sign_c = 1.0;
    if x > HALF_PI {
        x = PI - x;
        sign_c = -1.0;
    } else if x < -HALF_PI {
        x = -PI - x;
        sign_c = -1.0;
    }
    let x2 = x * x;
    let s = x * (1.0 - x2 / 6.0 * (1.0 - x2 / 20.0 * (1.0 - x2 / 42.0 * (1.0 - x2 / 72.0 * (1.0 - x2 / 110.0)))));
    let co = 1.0 - x2 / 2.0 * (1.0 - x2 / 12.0 * (1.0 - x2 / 30.0 * (1.0 - x2 / 56.0 * (1.0 - x2 / 90.0 * (1.0 - x2 / 132.0)))));
    (s, sign_c * co)
}

/// Scalar square root through the SIMD instruction (no libm in no_std).
#[inline(always)]
fn sqrt(v: f32) -> f32 {
    f32x4_extract_lane::<0>(f32x4_sqrt(f32x4_splat(v)))
}

/// Living enemies of the bot in `slot` within `range` (m) it has noticed (notice ≥ 1).
#[unsafe(no_mangle)]
pub extern "C" fn crowd_known(slot: u32, range: f32) -> u32 {
    let c = crowd();
    let q = params();
    let s = slot as usize;
    let row = &notice()[s * CAP..(s + 1) * CAP];
    let want = u32x4_splat((if c.flags.0[s] & RED != 0 { 0 } else { RED }) | ALIVE);
    let side = u32x4_splat(RED | ALIVE);
    let (sx, sy, sz) = (f32x4_splat(c.x.0[s]), f32x4_splat(c.y.0[s]), f32x4_splat(c.z.0[s]));
    let r2 = f32x4_splat(range * range);
    let one = f32x4_splat(1.0);
    let mut n = 0u32;
    for g in 0..q.count.div_ceil(4) {
        let i = g * 4;
        unsafe {
            let known = f32x4_ge(v128_load(row.as_ptr().add(i) as *const v128), one);
            if !v128_any_true(known) {
                continue;
            }
            let flags = v128_load(c.flags.0.as_ptr().add(i) as *const v128);
            let enemy = u32x4_eq(v128_and(flags, side), want);
            let dx = f32x4_sub(v128_load(c.x.0.as_ptr().add(i) as *const v128), sx);
            let dy = f32x4_sub(v128_load(c.y.0.as_ptr().add(i) as *const v128), sy);
            let dz = f32x4_sub(v128_load(c.z.0.as_ptr().add(i) as *const v128), sz);
            let d2 = f32x4_add(f32x4_add(f32x4_mul(dx, dx), f32x4_mul(dy, dy)), f32x4_mul(dz, dz));
            let hit = v128_and(v128_and(known, enemy), f32x4_lt(d2, r2));
            n += (i32x4_bitmask(hit) as u32).count_ones();
        }
    }
    n
}
