/**
 * Who each player may know about (anti-wallhack): snapshots only carry the
 * enemies a player could see or hear, so a hacked browser has nothing to
 * draw through walls. An enemy goes in when it is
 * - close by (`NEAR`: footsteps, and where a late pop-in would show),
 * - near one of the bots the player's browser runs (`BOT_NEAR`: they need
 *   their foes to fight),
 * - firing lately within earshot (`HEARD`: the shots are drawn and heard),
 * - spotted by the side's recon plane,
 * - or in line of sight from the player's eye to its head, chest or where it
 *   is about to be (re-checked every few ticks, nearer pairs more often;
 *   kept for `HOLD` after the line is lost so nobody flickers at edges).
 * Allies are always sent. The cost is capped per tick (`RAYS_PER_TICK`).
 */
import * as THREE from 'three';
import { Layer } from '../src/physics/PhysicsWorld.ts';
import type { MatchSim } from '../src/sim/MatchSim.ts';
import type { Team } from '../src/world/mapTypes.ts';

const NEAR = 35;
const BOT_NEAR = 60;
const HEARD = 250;
const VIEW_MAX = 700;
/** Seconds an enemy stays known after the last clear line. */
const HOLD = 0.75;
/** Ticks between line checks (`step` runs with every snapshot, every 2nd tick), near pairs (under `CLOSE` m) and far. */
const CLOSE = 100;
const EVERY_CLOSE = 4;
const EVERY_FAR = 15;
/** Rays a pass for all players together (beyond it, the rest wait for the next pass). */
const RAYS_PER_PASS = 600;
/** Enemies further round than this from where a player faces (cos of the angle) aren't on screen: no line checks for them (past `NEAR`). */
const BEHIND = -0.5;
/** How far ahead an enemy's place is guessed for the third point (s). */
const LEAD = 0.25;

/** A player looking: their side, eye (null: not on the field) and the bots their browser runs. */
export interface Viewer {
  id: number;
  team: Team;
  eye: THREE.Vector3 | null;
  /** Which way the player faces (yaw, rad). */
  yaw: number;
  bots: readonly THREE.Vector3[];
}

/** Someone who may be seen. */
interface Body {
  id: number;
  team: Team;
  feet: THREE.Vector3;
  velocity: THREE.Vector3;
  eyeHeight: number;
  firingUntil: number;
  on: boolean;
}

export class Sight {
  /** Viewer id -> enemy id -> sim time it counts as seen until. */
  private readonly seenUntil = new Map<number, Map<number, number>>();
  /** Viewer id -> enemy id -> tick of the last line check. */
  private readonly checkedAt = new Map<number, Map<number, number>>();
  /** Team -> enemy id -> sim time a recon plane's mark lasts until. */
  private readonly spotted: Record<Team, Map<number, number>> = { blue: new Map(), red: new Map() };
  private readonly known = new Map<number, Set<number>>();
  private readonly a = new THREE.Vector3();
  /** Rays cast last tick (for measuring). */
  rays = 0;

  constructor(private readonly sim: MatchSim) {}

  spot(team: Team, ids: readonly number[], seconds: number): void {
    for (const id of ids) this.spotted[team].set(id, this.sim.time + seconds);
  }

  private *bodies(): Iterable<Body> {
    for (const s of this.sim.soldiers.values()) {
      const p = s.player;
      yield { id: s.id, team: s.team, feet: p.feet, velocity: p.velocity, eyeHeight: p.eyeHeight, firingUntil: s.firingUntil, on: s.deployed && (p.alive || s.downed) };
    }
    for (const b of this.sim.bots?.bots ?? []) if (!b.benched) yield { id: b.id, team: b.team, feet: b.feet, velocity: b.velocity, eyeHeight: b.eyeHeight, firingUntil: b.firingUntil, on: b.alive || b.downed };
  }

  /** One pass of checks (with each snapshot); then `knows` answers for everyone. */
  step(viewers: readonly Viewer[]): void {
    const time = this.sim.time;
    const tick = this.sim.tick;
    const bodies = [...this.bodies()];
    let rays = 0;
    this.known.clear();
    for (const v of viewers) {
      const set = new Set<number>();
      this.known.set(v.id, set);
      let seen = this.seenUntil.get(v.id);
      if (!seen) this.seenUntil.set(v.id, (seen = new Map()));
      let checked = this.checkedAt.get(v.id);
      if (!checked) this.checkedAt.set(v.id, (checked = new Map()));
      const spotted = this.spotted[v.team];
      const eye = v.eye;
      const fx = -Math.sin(v.yaw);
      const fz = -Math.cos(v.yaw);
      for (const e of bodies) {
        if (e.team === v.team || !e.on) continue;
        const f = e.feet;
        const d2 = eye ? eye.distanceToSquared(f) : Infinity;
        let ok = d2 < NEAR * NEAR;
        for (const p of v.bots) if (!ok && p.distanceToSquared(f) < BOT_NEAR * BOT_NEAR) ok = true;
        if (!ok && e.firingUntil > time - 1.5 && d2 < HEARD * HEARD) ok = true;
        if (!ok && (spotted.get(e.id) ?? -1) > time) ok = true;
        if (!ok && eye && d2 < VIEW_MAX * VIEW_MAX) {
          if ((seen.get(e.id) ?? -1) > time) ok = true;
          const d = Math.sqrt(d2);
          const facing = ((f.x - eye.x) * fx + (f.z - eye.z) * fz) / Math.max(d, 1e-3);
          const every = d < CLOSE ? EVERY_CLOSE : EVERY_FAR;
          if (facing > BEHIND && tick - (checked.get(e.id) ?? -Infinity) >= every && rays < RAYS_PER_PASS) {
            checked.set(e.id, tick);
            // Head, chest, and (moving) the head where it is about to be: a peek shows at once.
            const moving = e.velocity.x * e.velocity.x + e.velocity.z * e.velocity.z > 2;
            for (let k = 0; k < (moving ? 3 : 2); k++) {
              const p = k === 0 ? this.a.set(f.x, f.y + e.eyeHeight, f.z) : k === 1 ? this.a.set(f.x, f.y + 1.1, f.z) : this.a.set(f.x + e.velocity.x * LEAD, f.y + e.eyeHeight, f.z + e.velocity.z * LEAD);
              rays++;
              if (!this.sim.physics.blocked(eye, p, Layer.WORLD)) {
                seen.set(e.id, time + HOLD);
                ok = true;
                break;
              }
            }
          }
        }
        if (ok) set.add(e.id);
      }
    }
    this.rays = rays;
    // Forget those who left.
    if (tick % 600 === 0) {
      const ids = new Set(bodies.map((b) => b.id));
      for (const m of [...this.seenUntil.values(), ...this.checkedAt.values()]) for (const id of m.keys()) if (!ids.has(id)) m.delete(id);
      for (const team of ['blue', 'red'] as const) for (const [id, until] of this.spotted[team]) if (until < time) this.spotted[team].delete(id);
    }
  }

  /** Whether `viewer` may know where enemy `id` is this tick (call after `step`). */
  knows(viewer: number, id: number): boolean {
    return this.known.get(viewer)?.has(id) ?? false;
  }

  drop(viewer: number): void {
    this.seenUntil.delete(viewer);
    this.checkedAt.delete(viewer);
    this.known.delete(viewer);
  }
}
