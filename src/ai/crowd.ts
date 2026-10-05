import type * as THREE from 'three';
import type { CoreExports } from '@/wasm/core';
import type { Combatant } from './types';

/** Slot flags (match `wasm/core/src/crowd.rs`). */
export const CROWD_ALIVE = 1;
export const CROWD_DOWNED = 2;
export const CROWD_RED = 4;
export const CROWD_AIR = 8;
export const CROWD_HAS_GOAL = 16;
export const CROWD_BOT = 32;
/** Fired a moment ago (easier to spot). */
export const CROWD_FIRING = 64;
/** In a seat under armour. */
export const CROWD_ARMOUR = 128;

export interface CrowdTuning {
  cell: number;
  sepRadius: number;
  sepStanding: number;
  sepSpeed: number;
  moving: number;
  avoidAhead: number;
  avoidWidth: number;
  spotTaken: number;
}

/**
 * Everyone on the field as structure-of-arrays in the wasm core's memory:
 * each bot keeps a slot while it is here (`BotManager` hands them out; bots
 * come and go in multiplayer), each person has one by id. `BotManager` writes
 * each slot when a step starts and again after that bot has stepped, so the
 * queries see what the TypeScript objects hold.
 */
export class Crowd {
  readonly cap: number;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly vx: Float32Array;
  private readonly vz: Float32Array;
  private readonly flags: Uint32Array;
  private readonly ids: Int32Array;
  private readonly out: Float32Array;
  /** Slots found by the last `view` call (the first `n` entries). */
  readonly hits: Uint32Array;
  readonly hitDist: Float32Array;
  private readonly humanSlots: Uint32Array;
  /** Off-axis angle (deg) of each `perceive` pick. */
  readonly hitOff: Float32Array;
  /** How far row (a bot's slot) has noticed column (anyone's slot): 0..1.5, 1 = noticed. */
  private readonly notice: Float32Array;

  constructor(
    private readonly k: CoreExports,
    tuning: CrowdTuning,
  ) {
    this.cap = k.crowd_cap();
    const buf = k.memory.buffer;
    const f32 = (ptr: number, n = this.cap): Float32Array => new Float32Array(buf, ptr, n);
    this.x = f32(k.crowd_x());
    this.y = f32(k.crowd_y());
    this.z = f32(k.crowd_z());
    this.vx = f32(k.crowd_vx());
    this.vz = f32(k.crowd_vz());
    this.flags = new Uint32Array(buf, k.crowd_flags(), this.cap);
    this.ids = new Int32Array(buf, k.crowd_ids(), this.cap);
    this.out = f32(k.crowd_out(), 4);
    this.hits = new Uint32Array(buf, k.crowd_hits(), this.cap);
    this.hitDist = f32(k.crowd_hit_dist());
    this.humanSlots = new Uint32Array(buf, k.crowd_humans(), 256);
    this.hitOff = f32(k.crowd_hit_off());
    this.notice = f32(k.crowd_notice(), this.cap * this.cap);
    this.notice.fill(0);
    const t = tuning;
    k.crowd_config(
      t.cell,
      t.sepRadius,
      t.sepStanding,
      t.sepSpeed,
      t.moving,
      t.avoidAhead,
      t.avoidWidth,
      t.spotTaken,
    );
  }

  /** Slots in use (the highest + 1; unused ones below it must be `clear`ed). */
  setCount(count: number): void {
    if (count > this.cap) throw new Error(`crowd: ${count} combatants, room for ${this.cap}`);
    this.k.crowd_set_count(count);
  }

  /** An unused slot: nobody, never matched, and nobody's notice of it (or its of anyone) carried over to the next holder. */
  clear(slot: number): void {
    this.flags[slot] = 0;
    this.k.crowd_notice_clear(slot);
    for (let r = slot; r < this.notice.length; r += this.cap) this.notice[r] = 0;
  }

  /** The people's slots (bots keep off them, 1.2x as wide). */
  setHumans(slots: readonly number[]): void {
    const n = Math.min(slots.length, this.humanSlots.length);
    for (let i = 0; i < n; i++) this.humanSlots[i] = slots[i]!;
    this.k.crowd_set_humans(n);
  }

  put(slot: number, c: Combatant, extra: number): void {
    this.x[slot] = c.feet.x;
    this.y[slot] = c.feet.y;
    this.z[slot] = c.feet.z;
    this.vx[slot] = c.velocity.x;
    this.vz[slot] = c.velocity.z;
    this.ids[slot] = c.id;
    this.flags[slot] =
      (c.alive ? CROWD_ALIVE : 0) |
      (c.downed ? CROWD_DOWNED : 0) |
      (c.team === 'red' ? CROWD_RED : 0) |
      extra;
  }

  noticeOf(row: number, col: number): number {
    return this.notice[row * this.cap + col]!;
  }

  setNotice(row: number, col: number, v: number): void {
    this.notice[row * this.cap + col] = v;
  }

  /** Living enemies of `slot` within `range` it has noticed. */
  known(slot: number, range: number): number {
    return this.k.crowd_known(slot, range);
  }

  clearNotice(row: number): void {
    this.k.crowd_notice_clear(row);
  }

  /**
   * The first pass of perception for the bot in `slot` (see `crowd_perceive`):
   * notice bookkeeping for everyone, then the `maxLook` enemies in view that
   * matter most land in `hits` / `hitDist` / `hitOff`, best first; returns how many.
   */
  perceive(
    slot: number,
    sight: number,
    airSight: number,
    halfFovDeg: number,
    viewUpDeg: number | null,
    yaw: number,
    pitch: number,
    dt: number,
    count: number,
    target: number,
    attacker: number,
    armourOk: boolean,
    airOk: boolean,
    maxLook: number,
  ): number {
    const rad = Math.PI / 180;
    return this.k.crowd_perceive(
      slot,
      sight,
      airSight,
      Math.cos(halfFovDeg * rad),
      Math.cos((viewUpDeg ?? 0) * rad),
      viewUpDeg === null ? 1 : 0,
      yaw,
      pitch,
      dt,
      count,
      target,
      attacker,
      armourOk ? 1 : 0,
      airOk ? 1 : 0,
      maxLook,
    );
  }

  /** Living bots into the neighbour grid (after the slots are written). */
  buildGrid(): void {
    this.k.crowd_build_grid();
  }

  /** Push apart / step around for the bot in `slot` walking along (wx, wz) at `speed` (see `BotManager.separation`). */
  separation(
    slot: number,
    wx: number,
    wz: number,
    speed: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    this.k.crowd_separation(slot, wx, wz, speed);
    return out.set(this.out[0]!, 0, this.out[1]!);
  }

  /** A bot other than `slot`, standing without a goal, within the spot-taken radius of `p`. */
  spotTaken(slot: number, p: THREE.Vector3): boolean {
    return this.k.crowd_spot_taken(slot, p.x, p.y, p.z) !== 0;
  }

  /**
   * Enemies the combatant in `slot` has in view (see `crowd_view`): their
   * slots and distances land in `hits` / `hitDist`; returns how many.
   */
  view(
    slot: number,
    sight: number,
    airSight: number,
    halfFovDeg: number,
    viewUpDeg: number | null,
    yaw: number,
    pitch: number,
  ): number {
    const rad = Math.PI / 180;
    const up = viewUpDeg ?? 0;
    return this.k.crowd_view(
      slot,
      sight,
      airSight,
      Math.cos(halfFovDeg * rad),
      Math.cos(up * rad),
      viewUpDeg === null ? 1 : 0,
      yaw,
      pitch,
    );
  }
}
