import * as THREE from 'three';
import { Layer, type PhysicsWorld, type RAPIER } from '@/physics/PhysicsWorld';
import type { StationKind, VehicleSpec } from './vehicleData';
import type { Vehicle } from './Vehicle';
import type { Team } from '@/world/mapTypes';

/**
 * A warship's state and rules (2026-10-18, big maps plan step 5): the engine
 * telegraph and rudder, a submarine's depth and air, fires, flooding,
 * stations knocked out and repaired, the engine room's overdrive. Pure
 * numbers: Vehicle runs the physics with them, the game and the server the
 * same way.
 */

/** Engine telegraph steps: full astern, stop, 1/3, 2/3, full ahead. */
export const TELEGRAPH = [-1, 0, 1 / 3, 2 / 3, 1] as const;
const STOP = 1;

/**
 * Damage control and the engine room (plan section 3, [제안] numbers):
 * - a fire burns `fire.dps` of the hull a second; manned damage control puts
 *   one out every `fire.out` s, a ship without the station (destroyer,
 *   submarine) lets one burn out after `fire.burnOut` s; unmanned damage
 *   control on a ship that has it: fires never go out, flooding spreads;
 * - flooding (0..1) takes buoyancy away (`flood.lift`); pumps take `flood.pump`
 *   a second out, a ship without damage control `flood.selfPump`; unmanned
 *   damage control lets it rise `flood.spread` a second;
 * - a knocked-out station is repaired after `repair` s of manned damage control;
 * - the engine room unmanned: `engine.unmanned` of top speed; manned, its
 *   trigger gives `engine.overdrive` more for `engine.overdriveTime` s, then
 *   `engine.cooldown` s before the next, with a small chance of a fire.
 */
export const SHIP = {
  fire: { dps: 0.0008, out: 8, burnOut: 30, max: 4, chance: 0.3 },
  flood: { lift: 0.55, pump: 0.025, selfPump: 0.006, spread: 0.004, torpedo: 0.22 },
  repair: 12,
  engine: { unmanned: 0.75, overdrive: 0.15, overdriveTime: 15, cooldown: 90, fireChance: 0.08 },
  /** Sinking: the buoyancy fades out over this long (s). */
  sinkTime: 25,
  /** A hit this close (m) to a station may knock it out, with this chance. */
  breakReach: 7,
  breakChance: 0.3,
};

/** A warship's state as the game server sends it (matchProtocol `encodeVehicles`). */
export interface ShipNet {
  /** Telegraph step x 4 + depth step. */
  helm: number;
  depth: number;
  flooding: number;
  fires: number;
  /** Knocked-out stations, a bit a seat. */
  broken: number;
  /** Seconds it has been going down, -1 afloat. */
  sinking: number;
  oxygen: number;
  overdrive: boolean;
}

/** Station kinds the helm works itself when nobody mans them (never AA). */
const HELM_WORKS: readonly StationKind[] = ['main', 'secondary', 'torpedo', 'asw', 'deckgun'];

export class ShipState {
  telegraph = STOP;
  /** Fires burning, each with how long it has burned (s). */
  readonly fires: number[] = [];
  flooding = 0;
  /** Knocked-out stations (seat -> repair progress, s). */
  readonly broken = new Map<number, number>();
  /** Submarine: depth step (index into the spec's depths) and the depth now (m), air left (s). */
  depthStep = 0;
  depth = 0;
  oxygen = 0;
  /** Overdrive running until / ready again at (ship time). */
  overdriveUntil = -1;
  overdriveReady = 0;
  /** Sinking: how long it has (s), -1 afloat. */
  sinking = -1;
  time = 0;
  private repairTimer = 0;
  private fireTimer = 0;
  private lastThrottle = 0;
  private lastBrake = false;

  constructor(readonly spec: VehicleSpec) {
    this.oxygen = spec.ship?.sub?.oxygen ?? 0;
  }

  /** Whether a station of `kind` exists on this ship. */
  has(kind: StationKind): boolean {
    return this.spec.seats.some((s) => s.station?.kind === kind);
  }

  /** The helm's controls this step: W / S step the telegraph, the brake key steps a submarine's depth. */
  helm(throttle: number, brake: boolean): void {
    const t = Math.sign(throttle);
    const last = Math.sign(this.lastThrottle);
    if (t !== 0 && t !== last) this.telegraph = THREE.MathUtils.clamp(this.telegraph + t, 0, TELEGRAPH.length - 1);
    this.lastThrottle = throttle;
    const sub = this.spec.ship?.sub;
    if (sub && brake && !this.lastBrake) this.depthStep = (this.depthStep + 1) % sub.depths.length;
    this.lastBrake = brake;
  }

  /** Set straight (a bot's helm). */
  set(telegraph: number, depthStep?: number): void {
    this.telegraph = THREE.MathUtils.clamp(telegraph, 0, TELEGRAPH.length - 1);
    if (depthStep !== undefined && this.spec.ship?.sub) this.depthStep = THREE.MathUtils.clamp(depthStep, 0, this.spec.ship.sub.depths.length - 1);
  }

  /** The helm in one byte (the driver's browser sends it with the ship's place). */
  get helmByte(): number {
    return this.telegraph * 4 + this.depthStep;
  }

  setHelmByte(b: number): void {
    this.set(b >> 2, b & 3);
  }

  net(): ShipNet {
    let broken = 0;
    for (const i of this.broken.keys()) if (i < 16) broken |= 1 << i;
    return { helm: this.helmByte, depth: this.depth, flooding: this.flooding, fires: this.fires.length, broken, sinking: this.sinking, oxygen: this.oxygen, overdrive: this.time < this.overdriveUntil };
  }

  /** The server's word on it; `own`: this browser steers it (its helm and depth stay as they are here). */
  take(n: ShipNet, own: boolean): void {
    if (!own) {
      this.setHelmByte(n.helm);
      this.depth = n.depth;
    }
    this.flooding = n.flooding;
    while (this.fires.length > n.fires) this.fires.pop();
    while (this.fires.length < n.fires) this.fires.push(0);
    for (const i of [...this.broken.keys()]) if (!(n.broken & (1 << i))) this.broken.delete(i);
    for (let i = 0; i < 16; i++) if (n.broken & (1 << i) && !this.broken.has(i)) this.broken.set(i, 0);
    this.sinking = n.sinking;
    this.oxygen = n.oxygen;
    if (n.overdrive) this.overdriveUntil = this.time + 0.5;
  }

  get throttle(): number {
    return TELEGRAPH[this.telegraph]!;
  }

  get dived(): boolean {
    return this.depth > 2;
  }

  /** Top speed now: dived or not, the engine room manned or not, overdrive. */
  topSpeed(manned: (kind: StationKind) => boolean): number {
    const sub = this.spec.ship?.sub;
    let top = sub && this.dived ? sub.divedTop : this.spec.top;
    if (this.has('engine')) top *= manned('engine') ? (this.time < this.overdriveUntil ? 1 + SHIP.engine.overdrive : 1) : SHIP.engine.unmanned;
    return top;
  }

  /** The engine room's trigger: overdrive when it is ready; true when it started. */
  overdrive(rand: () => number): boolean {
    if (this.time < this.overdriveReady) return false;
    this.overdriveUntil = this.time + SHIP.engine.overdriveTime;
    this.overdriveReady = this.overdriveUntil + SHIP.engine.cooldown;
    if (rand() < SHIP.engine.fireChance) this.ignite();
    return true;
  }

  ignite(): void {
    if (this.fires.length < SHIP.fire.max) this.fires.push(0);
  }

  /** A hit: maybe a fire (explosive rounds), maybe a station near it out; torpedoes flood. */
  hit(kind: 'shell' | 'torpedo' | 'bomb', localPoint: THREE.Vector3 | null, rand: () => number): void {
    if (kind === 'torpedo') this.flooding = Math.min(1, this.flooding + SHIP.flood.torpedo);
    if (rand() < SHIP.fire.chance) this.ignite();
    if (!localPoint) return;
    let best = -1;
    let bestD = SHIP.breakReach;
    this.spec.seats.forEach((s, i) => {
      if (!s.station || s.station.kind === 'helm') return;
      const d = Math.hypot(localPoint.x - s.eye[0], localPoint.y - s.eye[1], localPoint.z - s.eye[2]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && rand() < SHIP.breakChance) this.broken.set(best, 0);
  }

  /**
   * One step of the ship's troubles: fires burn the hull (returned as damage,
   * a share of its health), damage control (if manned) puts them out, pumps
   * and repairs; a submarine's air. `manned` says whether a station kind has
   * someone on it.
   */
  step(dt: number, manned: (kind: StationKind) => boolean): number {
    this.time += dt;
    const dc = this.has('dc');
    const crew = dc && manned('dc');
    let damage = 0;
    for (let i = 0; i < this.fires.length; i++) {
      this.fires[i]! += dt;
      damage += SHIP.fire.dps * dt;
    }
    if (crew) {
      if (this.fires.length) {
        this.fireTimer += dt;
        if (this.fireTimer >= SHIP.fire.out) {
          this.fires.shift();
          this.fireTimer = 0;
        }
      }
      this.flooding = Math.max(0, this.flooding - SHIP.flood.pump * dt);
      const next = this.broken.keys().next();
      if (!next.done) {
        this.repairTimer += dt;
        if (this.repairTimer >= SHIP.repair) {
          this.broken.delete(next.value);
          this.repairTimer = 0;
        }
      }
    } else if (dc) {
      // Nobody at damage control: the fires keep burning, the water keeps coming in.
      if (this.flooding > 0) this.flooding = Math.min(1, this.flooding + SHIP.flood.spread * dt);
    } else {
      // No such station (a destroyer, a submarine): fires burn out, the crew pumps a little.
      for (let i = this.fires.length - 1; i >= 0; i--) if (this.fires[i]! > SHIP.fire.burnOut) this.fires.splice(i, 1);
      this.flooding = Math.max(0, this.flooding - SHIP.flood.selfPump * dt);
      // And repairs, slower.
      const next = this.broken.keys().next();
      if (!next.done) {
        this.repairTimer += dt;
        if (this.repairTimer >= SHIP.repair * 2) {
          this.broken.delete(next.value);
          this.repairTimer = 0;
        }
      }
    }
    const sub = this.spec.ship?.sub;
    if (sub) {
      const want = sub.depths[this.depthStep]!;
      this.depth += THREE.MathUtils.clamp(want - this.depth, -2 * dt, 2 * dt);
      // Air: used up dived, back on the surface (out of air: up it comes).
      if (this.dived) this.oxygen = Math.max(0, this.oxygen - dt);
      else this.oxygen = Math.min(sub.oxygen, this.oxygen + dt * 4);
      if (this.oxygen <= 0) this.depthStep = 0;
    }
    if (this.sinking >= 0) this.sinking += dt;
    return damage;
  }

  /** How much of its buoyancy the hull keeps: less with water inside, fading away as it sinks. */
  get lift(): number {
    const sinking = this.sinking >= 0 ? Math.max(0, 1 - this.sinking / SHIP.sinkTime) : 1;
    return (1 - SHIP.flood.lift * this.flooding) * sinking;
  }

  /** Whether the helm may fire seat `i` itself: an unmanned gun station of a kind it works, intact, its needs met. */
  helmMay(i: number, occupied: (seat: number) => boolean, manned: (kind: StationKind) => boolean): boolean {
    const s = this.spec.seats[i];
    const kind = s?.station?.kind;
    if (!s?.gun || !kind || !HELM_WORKS.includes(kind) || occupied(i) || this.broken.has(i)) return false;
    if (kind === 'deckgun' && this.dived) return false;
    for (const rule of this.spec.ship?.stationsNeeded ?? []) if (rule.kinds.includes(kind) && !manned(rule.needs)) return false;
    return true;
  }
}

/**
 * The barrel's elevation to put a shell (speed `v`, drop `g`) from `from`
 * onto `to`: the low arc, or the highest-reaching 45 degrees when out of reach.
 */
export function ballisticPitch(from: THREE.Vector3, to: THREE.Vector3, v: number, g: number): number {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const h = to.y - from.y;
  if (g <= 0 || d < 1) return Math.atan2(h, Math.max(1, d));
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
  if (disc < 0) return Math.PI / 4;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * d));
}

/** The station seat whose spot on deck is within `reach` of `feet` (world), free, nearest first; -1 if none. */
export function stationNear(spec: VehicleSpec, toLocal: (p: THREE.Vector3) => THREE.Vector3, feet: THREE.Vector3, free: (seat: number) => boolean, reach = 2.4): number {
  const local = toLocal(feet.clone());
  let best = -1;
  let bestD = reach;
  spec.seats.forEach((s, i) => {
    if (!s.station || !free(i)) return;
    const [x, y, z] = s.station.at;
    const d = Math.hypot(local.x - x, (local.y - y) * 0.5, local.z - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * What a view ray from `origin` along `dir` lands on: the first solid thing
 * (not `ignore`, the ship one stands on), or the sea surface at `level` (NaN:
 * no sea there), or the end of `range`.
 */
export function lookPoint(physics: PhysicsWorld, origin: THREE.Vector3, dir: THREE.Vector3, range: number, level: number, ignore?: RAPIER.RigidBody): THREE.Vector3 {
  const hit = physics.raycast(origin, dir, range, Layer.WORLD | Layer.HITBOX, undefined, ignore);
  let dist = hit ? hit.distance : range;
  if (Number.isFinite(level) && dir.y < -1e-4) dist = Math.min(dist, (origin.y - level) / -dir.y);
  return origin.clone().addScaledVector(dir, Math.max(0, dist));
}

/**
 * Lays seat `seat`'s gun so its shell comes down on `target` (the bearing to
 * it, the elevation for its range), at the gun's turn rate. Returns where the
 * gun points now as a far point along it, for `fireMount`, and whether it is
 * laid on (within 1 degree).
 */
export function layGun(v: Vehicle, seat: number, target: THREE.Vector3, dt: number): { aim: THREE.Vector3; laid: boolean } {
  const gun = v.mounts[seat]!.gun;
  const pivot = v.seatEye(seat, new THREE.Vector3());
  const dx = target.x - pivot.x;
  const dz = target.z - pivot.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = gun.shell ? ballisticPitch(pivot, target, gun.shell.speed, gun.shell.gravity) : Math.atan2(target.y - pivot.y, Math.hypot(dx, dz));
  v.aimMount(seat, yaw, pitch, dt);
  const now = v.mountAim(seat) ?? { yaw, pitch };
  const off = Math.abs(Math.atan2(Math.sin(now.yaw - yaw), Math.cos(now.yaw - yaw))) + Math.abs(now.pitch - pitch);
  const cp = Math.cos(now.pitch);
  const aim = pivot.addScaledVector(new THREE.Vector3(-Math.sin(now.yaw) * cp, Math.sin(now.pitch), -Math.cos(now.yaw) * cp), 1000);
  return { aim, laid: off < 0.0175 };
}

/**
 * Where someone deploying aboard a warship comes out (a ship is a spawn
 * point): on deck at one of its free stations' spots, a little off it, the
 * helm's last (it is the one bots take first); facing the bow.
 */
export function deckSpawn(v: Vehicle, rand: () => number): { pos: THREE.Vector3; yaw: number } {
  const spots = v.spec.seats.map((s, i) => (s.station && !v.seats[i] && s.station.kind !== 'helm' ? s.station.at : null)).filter((a) => !!a);
  const at = spots.length ? spots[Math.floor(rand() * spots.length)]! : v.spec.seats[0]!.station?.at ?? [0, v.spec.half[1], 0];
  const local = new THREE.Vector3(at[0] + (rand() - 0.5) * 1.2, at[1] + 0.15, at[2] + 1.2 + rand() * 0.8);
  return { pos: v.toWorld(local, new THREE.Vector3()), yaw: v.yaw };
}

/**
 * Finding ships (2026-10-19, plan section 3): a dived submarine can't be
 * seen, only heard. Each manned station looks or listens once a second and
 * marks what it finds for its side for `hold` s:
 * - a destroyer's depth-charge station (with its sonar): dived submarines within `asw` m;
 * - a submarine's sonar: ships within `sonarShips` m, dived submarines within `sonarSubs` m;
 * - a submarine's periscope, at periscope depth or up: ships within `periscope` m;
 * - and any ship has a dived submarine within `close` m of it.
 * Surfaced ships are always in plain sight (they need no marking).
 */
export const SPOT = { asw: 1200, sonarShips: 3000, sonarSubs: 1500, periscope: 5000, periscopeDepth: 12, close: 200, hold: 12 };

/** Whether `v` can be targeted by `team` at `time`: anything afloat, a dived submarine only while marked. */
export function shipVisible(v: Vehicle, team: Team, time: number): boolean {
  return !v.ship?.dived || v.spottedUntil[team] > time;
}

/** One round of looking and listening for every warship's manned stations (see `SPOT`); returns nothing, marks `spottedUntil`. */
export function spotShips(all: readonly Vehicle[], time: number): void {
  for (const v of all) {
    if (!v.ship || v.wrecked) continue;
    const team = v.team ?? v.home;
    if (!team) continue;
    const stations = new Set<StationKind>();
    v.spec.seats.forEach((st, i) => {
      if (st.station && v.seats[i] && !v.ship!.broken.has(i)) stations.add(st.station.kind);
    });
    const periscope = stations.has('periscope') && v.ship.depth <= SPOT.periscopeDepth;
    for (const o of all) {
      if (o === v || o.wrecked || !o.spec.boat || (o.team ?? o.home) === team) continue;
      const d = o.pos.distanceTo(v.pos);
      const sub = !!o.ship?.dived;
      const found = sub
        ? d < SPOT.close || (stations.has('asw') && d < SPOT.asw) || (stations.has('sonar') && d < SPOT.sonarSubs)
        : (stations.has('sonar') && d < SPOT.sonarShips) || (periscope && d < SPOT.periscope);
      if (found) o.spottedUntil[team] = Math.max(o.spottedUntil[team], time + SPOT.hold);
    }
  }
}

/** What a listening or looking station has in its range now: kind, bearing (deg, 0 = north / -z) and range, nearest first. */
export function contacts(v: Vehicle, kind: StationKind, all: readonly Vehicle[]): { kind: string; bearing: number; range: number }[] {
  const team = v.team ?? v.home;
  const out: { kind: string; bearing: number; range: number }[] = [];
  for (const o of all) {
    if (o === v || o.wrecked || !o.spec.boat || (o.team ?? o.home) === team) continue;
    const d = o.pos.distanceTo(v.pos);
    const sub = !!o.ship?.dived;
    const ok = kind === 'sonar' ? d < (sub ? SPOT.sonarSubs : SPOT.sonarShips) : kind === 'asw' ? sub && d < SPOT.asw : kind === 'periscope' ? !sub && d < SPOT.periscope && (v.ship?.depth ?? 0) <= SPOT.periscopeDepth : false;
    if (!ok) continue;
    const b = (Math.atan2(o.pos.x - v.pos.x, -(o.pos.z - v.pos.z)) * 180) / Math.PI;
    out.push({ kind: o.kind, bearing: (b + 360) % 360, range: d });
  }
  return out.sort((a, b) => a.range - b.range);
}
