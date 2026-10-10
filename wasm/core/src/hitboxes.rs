//! Character hitboxes (bots and the player): legs and torso as boxes turned
//! to the character's facing, the head as a ball, scaled with the
//! character's height (crouching). They used to be kinematic Rapier bodies;
//! moving ~300 of them every step was most of the physics step.
//!
//! A ray first tests four characters per SIMD op against an upright bound,
//! then the parts of the few it passes, exactly. JS writes the slots straight
//! into the arrays (`src/combat/CharacterHitboxes.ts`).

use core::arch::wasm32::*;

pub const MAX_CHARS: usize = 1024;

/// Layout for a standing 1.8 m character (feet at 0), as in `CharacterHitboxes.ts`.
const LEGS_Y: f32 = 0.45;
const LEGS_HE: [f32; 3] = [0.18, 0.45, 0.12];
const TORSO_Y: f32 = 1.2;
const TORSO_HE: [f32; 3] = [0.24, 0.3, 0.15];
const HEAD_Y: f32 = 1.64;
const HEAD_R: f32 = 0.13;
/// Horizontal reach of any part from the feet (the torso's corner is at 0.283).
const BOUND_R: f32 = 0.3;

#[repr(C, align(16))]
struct Chars {
    x: [f32; MAX_CHARS],
    y: [f32; MAX_CHARS],
    z: [f32; MAX_CHARS],
    /// sin / cos of the facing (yaw about +Y).
    s: [f32; MAX_CHARS],
    c: [f32; MAX_CHARS],
    /// Height / 1.8.
    k: [f32; MAX_CHARS],
    /// Non-zero: can be hit.
    on: [u32; MAX_CHARS],
    out: [f32; 4],
}

static mut CHARS: Chars = Chars {
    x: [0.0; MAX_CHARS],
    y: [0.0; MAX_CHARS],
    z: [0.0; MAX_CHARS],
    s: [0.0; MAX_CHARS],
    c: [0.0; MAX_CHARS],
    k: [0.0; MAX_CHARS],
    on: [0; MAX_CHARS],
    out: [0.0; 4],
};
static mut COUNT: usize = 0;

#[inline(always)]
fn chars() -> &'static mut Chars {
    unsafe { &mut *(&raw mut CHARS) }
}

#[unsafe(no_mangle)]
pub extern "C" fn hb_cap() -> u32 {
    MAX_CHARS as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn hb_x() -> *mut f32 {
    chars().x.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn hb_y() -> *mut f32 {
    chars().y.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn hb_z() -> *mut f32 {
    chars().z.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn hb_s() -> *mut f32 {
    chars().s.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn hb_c() -> *mut f32 {
    chars().c.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn hb_k() -> *mut f32 {
    chars().k.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn hb_on() -> *mut u32 {
    chars().on.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn hb_out() -> *mut f32 {
    chars().out.as_mut_ptr()
}

/// Slots in use (the highest slot + 1); the rest are switched off.
#[unsafe(no_mangle)]
pub extern "C" fn hb_set_count(count: u32) {
    let n = (count as usize).min(MAX_CHARS);
    chars().on[n..].fill(0);
    unsafe { COUNT = n };
}

#[inline(always)]
fn sqrt(v: f32) -> f32 {
    f32x4_extract_lane::<0>(f32x4_sqrt(f32x4_splat(v)))
}

/// Ray (o + t·d, unit d) against an upright box turned by (s, c) about Y,
/// centred at `p`: entry t and the face normal (world), if within [0, max_t].
#[inline(always)]
fn ray_box(o: [f32; 3], d: [f32; 3], p: [f32; 3], he: [f32; 3], s: f32, c: f32, max_t: f32) -> Option<(f32, [f32; 3])> {
    // World -> local is the inverse turn: lx = c·x - s·z, lz = s·x + c·z.
    let (rx, ry, rz) = (o[0] - p[0], o[1] - p[1], o[2] - p[2]);
    let lo = [c * rx - s * rz, ry, s * rx + c * rz];
    let ld = [c * d[0] - s * d[2], d[1], s * d[0] + c * d[2]];
    let mut t0 = 0.0f32;
    let mut t1 = max_t;
    let mut axis = 0usize;
    let mut sign = 0.0f32;
    for i in 0..3 {
        if ld[i].abs() < 1e-12 {
            if lo[i] < -he[i] || lo[i] > he[i] {
                return None;
            }
            continue;
        }
        let inv = 1.0 / ld[i];
        let mut a = (-he[i] - lo[i]) * inv;
        let mut b = (he[i] - lo[i]) * inv;
        // Entering through the -face when the ray runs toward +.
        let mut face = -1.0;
        if a > b {
            core::mem::swap(&mut a, &mut b);
            face = 1.0;
        }
        if a > t0 {
            t0 = a;
            axis = i;
            sign = face;
        }
        if b < t1 {
            t1 = b;
        }
        if t0 > t1 {
            return None;
        }
    }
    // Started inside: Rapier reports t = 0 with no normal.
    let mut n = [0.0f32; 3];
    if sign != 0.0 {
        n[axis] = sign;
    }
    // Local -> world: x = c·lx + s·lz, z = -s·lx + c·lz.
    Some((t0, [c * n[0] + s * n[2], n[1], -s * n[0] + c * n[2]]))
}

/// Ray against a ball: entry t and the normal, if within [0, max_t].
#[inline(always)]
fn ray_ball(o: [f32; 3], d: [f32; 3], p: [f32; 3], r: f32, max_t: f32) -> Option<(f32, [f32; 3])> {
    let m = [o[0] - p[0], o[1] - p[1], o[2] - p[2]];
    let b = m[0] * d[0] + m[1] * d[1] + m[2] * d[2];
    let c = m[0] * m[0] + m[1] * m[1] + m[2] * m[2] - r * r;
    if c <= 0.0 {
        return Some((0.0, [0.0; 3]));
    }
    if b > 0.0 {
        return None;
    }
    let disc = b * b - c;
    if disc < 0.0 {
        return None;
    }
    let t = -b - sqrt(disc);
    if t > max_t {
        return None;
    }
    let h = [o[0] + d[0] * t - p[0], o[1] + d[1] * t - p[1], o[2] + d[2] * t - p[2]];
    Some((t, [h[0] / r, h[1] / r, h[2] / r]))
}

/// Nearest character hitbox along the ray (unit direction) within `max_t`,
/// skipping slot `exclude` (the shooter): returns slot·4 + part (0 legs,
/// 1 torso, 2 head) or -1; out[0] = t, out[1..4] = normal.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn hb_cast(ox: f32, oy: f32, oz: f32, dx: f32, dy: f32, dz: f32, max_t: f32, exclude: i32) -> i32 {
    let h = chars();
    let n = unsafe { COUNT };
    let o = [ox, oy, oz];
    let d = [dx, dy, dz];
    let mut best_t = max_t;
    let mut best = -1i32;
    let mut best_n = [0.0f32; 3];

    let vo = [f32x4_splat(ox), f32x4_splat(oy), f32x4_splat(oz)];
    let tiny = 1e-20f32;
    let inv = |v: f32| if v.abs() < tiny { if v < 0.0 { -1e20 } else { 1e20 } } else { 1.0 / v };
    let vinv = [f32x4_splat(inv(dx)), f32x4_splat(inv(dy)), f32x4_splat(inv(dz))];
    let zero = f32x4_splat(0.0);
    let r = f32x4_splat(BOUND_R);
    // Top of the head: its centre scales with k, its radius doesn't.
    let head_y = f32x4_splat(HEAD_Y);
    let head_top = f32x4_splat(HEAD_R + 0.01);

    let groups = n.div_ceil(4);
    for g in 0..groups {
        let i = g * 4;
        let (lo, hi, on) = unsafe {
            let ld = |a: &[f32; MAX_CHARS]| v128_load(a.as_ptr().add(i) as *const v128);
            let on = v128_load(h.on.as_ptr().add(i) as *const v128);
            let (x, y, z, k) = (ld(&h.x), ld(&h.y), ld(&h.z), ld(&h.k));
            (
                [f32x4_sub(x, r), y, f32x4_sub(z, r)],
                [f32x4_add(x, r), f32x4_add(f32x4_add(y, f32x4_mul(k, head_y)), head_top), f32x4_add(z, r)],
                on,
            )
        };
        if !v128_any_true(on) {
            continue;
        }
        // Upright bound, slab test: t range where the ray is inside it.
        let mut t0 = zero;
        let mut t1 = f32x4_splat(best_t);
        for a in 0..3 {
            let p = f32x4_mul(f32x4_sub(lo[a], vo[a]), vinv[a]);
            let q = f32x4_mul(f32x4_sub(hi[a], vo[a]), vinv[a]);
            t0 = f32x4_max(t0, f32x4_min(p, q));
            t1 = f32x4_min(t1, f32x4_max(p, q));
        }
        let pass = v128_and(f32x4_le(t0, t1), u32x4_gt(on, u32x4_splat(0)));
        let mut mask = i32x4_bitmask(pass) as u32;
        while mask != 0 {
            let lane = mask.trailing_zeros() as usize;
            mask &= mask - 1;
            let ch = i + lane;
            if ch as i32 == exclude {
                continue;
            }
            let (px, py, pz, s, c, k) = (h.x[ch], h.y[ch], h.z[ch], h.s[ch], h.c[ch], h.k[ch]);
            // Each part only counts if nearer than the best so far (`best_t` caps the test).
            let parts = [
                ray_box(o, d, [px, py + LEGS_Y * k, pz], [LEGS_HE[0], LEGS_HE[1] * k, LEGS_HE[2]], s, c, best_t),
                ray_box(o, d, [px, py + TORSO_Y * k, pz], TORSO_HE, s, c, best_t),
                ray_ball(o, d, [px, py + HEAD_Y * k, pz], HEAD_R, best_t),
            ];
            for (part, hit) in parts.into_iter().enumerate() {
                if let Some((t, nrm)) = hit {
                    if t <= best_t {
                        best_t = t;
                        best = (ch * 4 + part) as i32;
                        best_n = nrm;
                    }
                }
            }
        }
    }
    h.out[0] = best_t;
    h.out[1] = best_n[0];
    h.out[2] = best_n[1];
    h.out[3] = best_n[2];
    best
}
