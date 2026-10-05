import type { CoreExports } from '@/wasm/core';

type V3 = { x: number; y: number; z: number };

/** Parts in the order the core numbers them. */
export const CHAR_PARTS = ['limb', 'body', 'head'] as const;

/**
 * Collider handle standing in for a character hitbox part in ray hits and the
 * hitbox registry: negative, so it never matches one of Rapier's.
 */
export function charHandle(slot: number, part: number): number {
  return -(1 + slot * 4 + part);
}

export interface CharHit {
  slot: number;
  part: number;
  distance: number;
  normal: V3;
}

/**
 * Character hitboxes in the wasm core (`hitboxes.rs`): one slot per bot /
 * player, written straight into the core's arrays; `cast` finds the nearest
 * part along a ray.
 */
export class CharacterHits {
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly s: Float32Array;
  private readonly c: Float32Array;
  private readonly k: Float32Array;
  private readonly on: Uint32Array;
  private readonly out: Float32Array;
  private readonly free: number[] = [];
  private count = 0;

  constructor(private readonly core: CoreExports) {
    const cap = core.hb_cap();
    const buf = core.memory.buffer;
    const f = (ptr: number, n = cap) => new Float32Array(buf, ptr, n);
    this.x = f(core.hb_x());
    this.y = f(core.hb_y());
    this.z = f(core.hb_z());
    this.s = f(core.hb_s());
    this.c = f(core.hb_c());
    this.k = f(core.hb_k());
    this.on = new Uint32Array(buf, core.hb_on(), cap);
    this.out = f(core.hb_out(), 4);
    core.hb_set_count(0);
  }

  alloc(): number {
    const slot = this.free.pop() ?? this.count++;
    if (slot >= this.x.length) throw new Error('character hitboxes: no free slot');
    this.on[slot] = 0;
    this.core.hb_set_count(this.count);
    return slot;
  }

  release(slot: number): void {
    this.on[slot] = 0;
    this.free.push(slot);
  }

  /** Feet position, facing (yaw about +Y) and height (m). */
  set(slot: number, feet: V3, yaw: number, height: number): void {
    this.x[slot] = feet.x;
    this.y[slot] = feet.y;
    this.z[slot] = feet.z;
    this.s[slot] = Math.sin(yaw);
    this.c[slot] = Math.cos(yaw);
    this.k[slot] = height / 1.8;
  }

  setEnabled(slot: number, on: boolean): void {
    this.on[slot] = on ? 1 : 0;
  }

  /** Nearest part along `dir` (unit) within `maxDist`, not counting slot `exclude`. */
  cast(origin: V3, dir: V3, maxDist: number, exclude = -1): CharHit | null {
    const id = this.core.hb_cast(
      origin.x,
      origin.y,
      origin.z,
      dir.x,
      dir.y,
      dir.z,
      maxDist,
      exclude,
    );
    if (id < 0) return null;
    const o = this.out;
    return {
      slot: id >> 2,
      part: id & 3,
      distance: o[0]!,
      normal: { x: o[1]!, y: o[2]!, z: o[3]! },
    };
  }
}
