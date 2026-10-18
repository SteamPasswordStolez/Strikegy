import * as THREE from 'three';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import { ballisticPitch } from '@/vehicles/ship';
import type { DriveInput, Vehicle } from '@/vehicles/Vehicle';
import type { StationKind, VehicleSpec } from '@/vehicles/vehicleData';
import type { Team } from '@/world/mapTypes';

/**
 * Bot warship crews (2026-10-18, big maps plan step 5). The helm closes on
 * the nearest enemy ship it knows of to its kind's fighting range, then turns
 * broadside (a carrier stays well back, a submarine closes to torpedo range at
 * periscope depth and goes deep when a destroyer is on top of it), keeps off
 * shallows, other hulls and the map's edge by feeling ahead, and fires the
 * stations nobody mans. Gunners lay their own gun on the target (AA on enemy
 * aircraft). [제안] numbers.
 */
export const SHIP_AI = {
  /** Enemy ships further than this aren't fought (m). */
  engage: 6000,
  /** Range each kind fights at (m). */
  keepOff: { dd: 2400, bb: 3800, cv: 6500, ss: 1300 } as Partial<Record<string, number>>,
  /** Feelers: seconds of way ahead (plus half the hull), the water under the keel wanted (m). */
  feel: 14,
  underKeel: 3,
  /** Turn back to the middle past this share of the map's radius. */
  edge: 0.85,
  /** Rethink the target every so many seconds. */
  rethink: 2,
  /** Bots' laying error: a share of the range (m per m). */
  scatter: 0.008,
  /** Shares of a side's bots crewing its warships at most (a fleet map's ships are its spawns: all). */
  crewShare: 0.6,
  /** AA: aircraft within this range (m). */
  aaRange: 2000,
  /** Depth charges: a dived submarine within this range (m). */
  aswRange: 250,
  /** Submarines: surface below this much air (s); deep when an enemy destroyer is this close (m). */
  air: 20,
  deepFrom: 900,
};

/** The order bots take a ship's stations in: the helm first, then what fights. */
const STATION_ORDER: readonly StationKind[] = ['helm', 'fire', 'main', 'engine', 'secondary', 'dc', 'torpedo', 'aa', 'deckgun', 'asw', 'periscope', 'sonar', 'flight', 'catapult'];

/** A ship's free station for a bot (by `STATION_ORDER`), or -1. */
export function botStation(spec: VehicleSpec, free: (seat: number) => boolean): number {
  for (const kind of STATION_ORDER) {
    const i = spec.seats.findIndex((s, j) => s.station?.kind === kind && free(j));
    if (i >= 0) return i;
  }
  return -1;
}

export type StationGun = (v: Vehicle, seat: number, target: THREE.Vector3, trigger: boolean, dt: number, shooter: { id: number; name: string; team: Team }) => void;

interface Plan {
  target: Vehicle | null;
  until: number;
  backUntil: number;
  stuck: number;
  /** Which side it turns its broadside to (+1 / -1). */
  side: number;
}

const DOWN = new THREE.Vector3(0, -1, 0);

export class ShipCrews {
  /** The water (sea and rivers; NaN on dry ground). */
  level: ((x: number, z: number) => number) | null = null;
  /** Lays and fires a ship's station gun (the game's / the server's `shipGun`). */
  stationGun: StationGun | null = null;
  private readonly plans = new Map<number, Plan>();
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly physics: PhysicsWorld) {}

  /** Water under the keel at (x, z): 0 on land, a hull (another ship) counts as land. */
  private depthAt(x: number, z: number, self: Vehicle): number {
    const lv = this.level?.(x, z) ?? NaN;
    if (!Number.isFinite(lv)) return 0;
    const hit = this.physics.raycast(this.tmp.set(x, lv + 30, z), DOWN, 500, Layer.WORLD, undefined, self.body);
    return hit ? Math.max(0, hit.distance - 30) : 500;
  }

  /** The nearest enemy warship or boat (not a dived submarine unless `dived`), within `reach`. */
  private enemyShip(all: readonly Vehicle[], v: Vehicle, team: Team, reach: number, dived = false): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = reach;
    for (const o of all) {
      if (o === v || o.wrecked || !o.spec.boat || (o.team ?? o.home) === team || (o.team ?? o.home) === null) continue;
      if (!dived && o.ship?.dived) continue;
      const d = o.pos.distanceTo(v.pos);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Where to lay a gun of speed `speed` / drop `g` on `t` (its waterline, led by its way), with a bot's error. */
  private aimOn(from: THREE.Vector3, t: Vehicle, speed: number, g: number): THREE.Vector3 {
    const d = from.distanceTo(t.pos);
    const pitch = g > 0 ? ballisticPitch(from, t.pos, speed, g) : 0;
    const time = d / Math.max(1, speed * Math.cos(pitch));
    const lv = this.level?.(t.pos.x, t.pos.z);
    const aim = t.pos.clone().addScaledVector(t.velocity, time);
    aim.y = Number.isFinite(lv) ? lv! + 1.5 : t.pos.y;
    const err = d * SHIP_AI.scatter;
    aim.x += (Math.random() - 0.5) * 2 * err;
    aim.z += (Math.random() - 0.5) * 2 * err;
    return aim;
  }

  /**
   * A bot at a warship's helm this step: steer (through `out`), set the
   * telegraph and the depth, fire the unmanned stations at the target.
   */
  helm(v: Vehicle, all: readonly Vehicle[], team: Team, shooter: { id: number; name: string; team: Team }, goal: THREE.Vector3 | null, time: number, dt: number, out: DriveInput): void {
    const ship = v.ship!;
    let plan = this.plans.get(v.id);
    if (!plan) {
      plan = { target: null, until: 0, backUntil: 0, stuck: 0, side: v.id % 2 ? 1 : -1 };
      this.plans.set(v.id, plan);
    }
    if (time > plan.until || plan.target?.wrecked) {
      plan.until = time + SHIP_AI.rethink;
      plan.target = this.enemyShip(all, v, team, SHIP_AI.engage);
    }
    const t = plan.target;
    const keep = SHIP_AI.keepOff[v.kind] ?? 2500;
    let want: number;
    if (t) {
      const dx = t.pos.x - v.pos.x;
      const dz = t.pos.z - v.pos.z;
      const d = Math.hypot(dx, dz);
      const bearing = Math.atan2(-dx, -dz);
      // A submarine points its bow tubes at the target; the rest close, open or turn broadside.
      if (v.kind === 'ss' && d < keep * 2) want = bearing;
      else if (d > keep * 1.25) want = bearing;
      else if (d < keep * 0.7) want = bearing + Math.PI;
      else want = bearing + (plan.side * Math.PI) / 2;
    } else {
      const g = goal ?? v.airCenter;
      const dx = g.x - v.pos.x;
      const dz = g.z - v.pos.z;
      want = Math.atan2(-dx, -dz);
      // There: steam round it.
      if (Math.hypot(dx, dz) < 400) want += (plan.side * Math.PI) / 2;
    }
    // Back toward the middle near the map's edge.
    const cx = v.airCenter.x - v.pos.x;
    const cz = v.airCenter.z - v.pos.z;
    if (Math.hypot(cx, cz) > v.airRadius * SHIP_AI.edge) want = Math.atan2(-cx, -cz);
    // Feel ahead: shallows, land, another hull. Turn to whichever side is clear.
    const speed = v.forwardSpeed();
    const look = Math.max(80, Math.abs(speed) * SHIP_AI.feel) + v.spec.half[2];
    const need = (v.spec.boat?.draft ?? 3) + SHIP_AI.underKeel;
    const clear = (off: number): boolean => {
      const a = v.yaw + off;
      return this.depthAt(v.pos.x - Math.sin(a) * look, v.pos.z - Math.cos(a) * look, v) > need;
    };
    const ahead = clear(0);
    if (!ahead) {
      const left = clear(0.6);
      const right = clear(-0.6);
      want = v.yaw + (left && !right ? 1.2 : right && !left ? -1.2 : plan.side * 1.2);
    }
    const diff = Math.atan2(Math.sin(want - v.yaw), Math.cos(want - v.yaw));
    out.steer = THREE.MathUtils.clamp(-diff * 1.5, -1, 1);
    // Stuck on something: astern a while, rudder the other way.
    plan.stuck = !ahead && Math.abs(speed) < 1 ? plan.stuck + dt : 0;
    if (plan.stuck > 4) {
      plan.backUntil = time + 10;
      plan.stuck = 0;
      plan.side = -plan.side;
    }
    let tel = Math.abs(diff) > 1.2 || !ahead ? 3 : 4;
    if (time < plan.backUntil) {
      tel = 0;
      out.steer = -out.steer;
    }
    // A submarine: periscope depth near a target, deep when a destroyer is on top of it, up for air.
    let depth = 0;
    const sub = v.spec.ship?.sub;
    if (sub) {
      if (t && t.pos.distanceTo(v.pos) < keep * 3) depth = 1;
      const hunter = this.enemyShip(all, v, team, SHIP_AI.deepFrom);
      if (hunter?.kind === 'dd') depth = 2;
      if (ship.oxygen < SHIP_AI.air) depth = 0;
      depth = Math.min(depth, sub.depths.length - 1);
    }
    ship.set(tel, depth);
    // The stations nobody mans: on the target.
    if (!t || !this.stationGun) return;
    for (let i = 0; i < v.seats.length; i++) {
      if (!ship.helmMay(i, (j) => !!v.seats[j], (k) => v.manned(k))) continue;
      this.fireAt(v, i, t, shooter, dt);
    }
  }

  /** A bot manning a gun station: AA at aircraft, depth charges at a dived submarine, the rest at the nearest enemy ship. */
  gunner(v: Vehicle, seat: number, all: readonly Vehicle[], team: Team, shooter: { id: number; name: string; team: Team }, dt: number): void {
    const kind = v.spec.seats[seat]!.station?.kind;
    const m = v.mounts[seat];
    if (!m || !this.stationGun) return;
    if (kind === 'aa') {
      let best: Vehicle | null = null;
      let bestD = SHIP_AI.aaRange;
      for (const o of all) {
        if (!o.flight || o.wrecked || (o.team ?? o.home) === team) continue;
        const d = o.pos.distanceTo(v.pos);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (!best) {
        this.stationGun(v, seat, v.seatEye(seat, new THREE.Vector3()).addScaledVector(new THREE.Vector3(0, 1, 0), 100), false, dt, shooter);
        return;
      }
      const time = bestD / (m.gun.shell?.speed ?? 800);
      this.stationGun(v, seat, best.pos.clone().addScaledVector(best.velocity, time), true, dt, shooter);
      return;
    }
    const t = kind === 'asw' ? this.enemyShip(all, v, team, SHIP_AI.aswRange, true) : this.enemyShip(all, v, team, m.gun.range);
    if (!t || (kind === 'asw' && !t.ship?.dived)) {
      this.stationGun(v, seat, v.pos.clone().addScaledVector(new THREE.Vector3(-Math.sin(v.yaw), 0, -Math.cos(v.yaw)), 1000), false, dt, shooter);
      return;
    }
    this.fireAt(v, seat, t, shooter, dt);
  }

  private fireAt(v: Vehicle, seat: number, t: Vehicle, shooter: { id: number; name: string; team: Team }, dt: number): void {
    const m = v.mounts[seat]!;
    const sh = m.gun.shell;
    const from = v.seatEye(seat, new THREE.Vector3());
    const aim = this.aimOn(from, t, sh?.speed ?? 800, m.gun.torpedo ? 0 : (sh?.gravity ?? 0));
    const inRange = from.distanceTo(t.pos) < m.gun.range;
    this.stationGun!(v, seat, aim, inRange, dt, shooter);
  }

  forget(v: Vehicle): void {
    this.plans.delete(v.id);
  }
}
