import * as THREE from 'three';
import { CARRIER_PLANES, DECK, PLANE_COST, type CarrierPlaneKind } from '@/vehicles/carrierPlanes';
import { shipVisible } from '@/vehicles/ship';
import type { DriveInput, Vehicle } from '@/vehicles/Vehicle';
import type { Team } from '@/world/mapTypes';

/**
 * Bot carrier pilots and flight controllers (2026-10-19, big maps plan step
 * 6). A pilot rolls off the deck, flies its kind's mission and comes back to
 * land when its ordnance is gone or it is badly hurt:
 * - fighter: enemy planes first, else it flies cover over its own fleet;
 * - dive bomber: climbs, flies over the nearest enemy ship it can see, dives
 *   on it and lets the bomb go low, pulls out;
 * - torpedo bomber: down on the water, a run at the target's track, lets go
 *   inside a kilometre, turns away;
 * - attack plane: a shallow dive, rockets, then the guns;
 * - scout: out toward the enemy fleet and round it (it marks what it sees);
 * - anti-submarine: low over the water round its fleet, depth charges on a
 *   submarine it has found.
 * Landing: to the approach point behind its carrier's stern, lined up, slow;
 * the landing aid does the rest. [제안] numbers.
 */
export const CARRIER_AI = {
  cruise: 450,
  diveFrom: 700,
  release: 380,
  torpHeight: 22,
  torpRelease: 900,
  aswHeight: 70,
  approachBack: 360,
  approachHeight: 45,
  /** Go home below this much health. */
  hurt: 0.4,
  /** A flight controller launches once in this many seconds at most. */
  launchEvery: 12,
};

export interface PilotOrders {
  fire: boolean;
  alt: boolean;
}

interface Plan {
  target: Vehicle | null;
  until: number;
  phase: 'out' | 'attack' | 'away' | 'home';
  awayUntil: number;
}

export class CarrierPilots {
  private readonly plans = new Map<number, Plan>();
  private readonly launched = new Map<number, number>();
  level: ((x: number, z: number) => number) | null = null;

  /** Which kind a bot flight controller launches next: a submarine hunter when a submarine is about, else a mix. */
  pickKind(all: readonly Vehicle[], team: Team, rand: () => number): CarrierPlaneKind {
    const subs = all.some((o) => o.kind === 'ss' && !o.wrecked && (o.team ?? o.home) !== team);
    const mine = all.filter((o) => o.spec.plane && !o.wrecked && o.home === team);
    if (subs && !mine.some((o) => o.kind === 'cvasw') && rand() < 0.5) return 'cvasw';
    if (!mine.some((o) => o.kind === 'cvscout') && rand() < 0.4) return 'cvscout';
    const enemyPlanes = all.filter((o) => o.flight && !o.wrecked && o.home !== team).length;
    if (enemyPlanes > mine.filter((o) => o.kind === 'cvfighter').length && rand() < 0.6) return 'cvfighter';
    const pool: CarrierPlaneKind[] = ['cvdive', 'cvtorp', 'cvdive', 'cvtorp', 'cvcas', 'cvfighter'];
    return pool[Math.floor(rand() * pool.length)]!;
  }

  /** Whether a bot at `carrier`'s flight control may launch now (once in a while), and the cheapest it could afford. */
  mayLaunch(carrier: Vehicle, time: number, rp: number): boolean {
    if (time < (this.launched.get(carrier.id) ?? -Infinity) + CARRIER_AI.launchEvery) return false;
    return rp >= Math.min(...CARRIER_PLANES.map((k) => PLANE_COST[k]));
  }

  launchedFrom(carrier: Vehicle, time: number): void {
    this.launched.set(carrier.id, time);
  }

  private height(v: Vehicle): number {
    const lv = this.level?.(v.pos.x, v.pos.z);
    return v.pos.y - (Number.isFinite(lv) ? lv! : 0);
  }

  private nearestShip(v: Vehicle, all: readonly Vehicle[], team: Team, time: number, reach: number, subs = false): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = reach;
    for (const o of all) {
      if (!o.ship || o.wrecked || (o.team ?? o.home) === team || !shipVisible(o, team, time)) continue;
      if (subs && o.kind !== 'ss') continue;
      const d = o.pos.distanceTo(v.pos);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private home(v: Vehicle, all: readonly Vehicle[]): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = Infinity;
    for (const o of all) {
      if (o.kind !== 'cv' || o.wrecked || (o.team ?? o.home) !== v.home) continue;
      const d = o.pos.distanceTo(v.pos);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Points `out` at a world point (yaw, pitch held within what a plane may do). */
  private steer(v: Vehicle, at: THREE.Vector3, out: DriveInput, maxPitch = 0.45): { dist: number; angle: number } {
    const d = at.clone().sub(v.pos);
    const dist = d.length();
    out.aimYaw = Math.atan2(-d.x, -d.z);
    out.aimPitch = THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -1.1, maxPitch);
    const nose = v.velocity.lengthSq() > 1 ? v.velocity.clone().normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(v.quat);
    return { dist, angle: nose.angleTo(d.normalize()) };
  }

  /** A bot at a carrier plane's controls this step: `out` steers it; what to fire comes back. */
  fly(v: Vehicle, all: readonly Vehicle[], team: Team, time: number, out: DriveInput): PilotOrders {
    const orders: PilotOrders = { fire: false, alt: false };
    const f = v.flight!;
    let plan = this.plans.get(v.id);
    if (!plan) {
      plan = { target: null, until: 0, phase: 'out', awayUntil: 0 };
      this.plans.set(v.id, plan);
    }
    const kind = v.kind as CarrierPlaneKind;
    const main = v.mounts[0];
    const spent = !!main && main.ammo <= 0 && (!v.altMounts[0] || v.altMounts[0].ammo <= 0 || kind !== 'cvfighter');
    // On the deck: wait out the rearming when it needs it, then full throttle down the deck.
    if (v.deck) {
      plan.phase = 'out';
      const needs = v.health < v.spec.health || (main && main.ammo < (main.gun.ammo ?? 0));
      out.throttle = needs && v.parkedFor < DECK.rearm + 0.5 ? -1 : 1;
      out.steer = THREE.MathUtils.clamp(v.deck.yaw * 2, -1, 1);
      out.aimYaw = f.yaw;
      out.aimPitch = 0;
      return orders;
    }
    const h = this.height(v);
    if (spent || v.health < v.spec.health * CARRIER_AI.hurt) plan.phase = 'home';
    if (plan.phase === 'home') {
      const c = this.home(v, all);
      if (!c) {
        plan.phase = 'out';
      } else {
        // The approach point behind the stern, then down the carrier's line.
        const entry = c.toWorld(new THREE.Vector3(0, c.spec.half[1] + CARRIER_AI.approachHeight, c.spec.half[2] + CARRIER_AI.approachBack), new THREE.Vector3());
        const flat = Math.hypot(entry.x - v.pos.x, entry.z - v.pos.z);
        if (v.approach || flat < 160) {
          const ahead = c.toWorld(new THREE.Vector3(0, c.spec.half[1] + 4, -c.spec.half[2]), new THREE.Vector3());
          this.steer(v, ahead, out, 0.2);
          out.throttle = -1;
        } else {
          this.steer(v, entry, out, 0.3);
          out.throttle = flat < 900 ? -1 : f.throttle < 0.7 ? 1 : 0;
        }
        this.safe(v, h, out, 25);
        return orders;
      }
    }
    if (time > plan.until || plan.target?.wrecked) {
      plan.until = time + 2;
      plan.target =
        kind === 'cvfighter'
          ? this.enemyPlane(v, all, team)
          : kind === 'cvasw'
            ? this.nearestShip(v, all, team, time, 3000, true)
            : kind === 'cvscout'
              ? null
              : this.nearestShip(v, all, team, time, 6000);
    }
    const t = plan.target;
    out.throttle = f.throttle < 0.85 ? 1 : 0;
    if (!t || time < plan.awayUntil) {
      // No target (or turning away after a run): out toward the enemy, over our fleet, or a scout's circle.
      const c = this.home(v, all);
      const centre = v.airCenter;
      const enemy = all.find((o) => o.ship && !o.wrecked && (o.team ?? o.home) !== team && !o.ship.dived);
      const ref = kind === 'cvscout' && enemy ? enemy.pos : kind === 'cvfighter' || kind === 'cvasw' ? (c?.pos ?? centre) : (enemy?.pos ?? centre);
      const ang = Math.atan2(v.pos.z - ref.z, v.pos.x - ref.x) + 0.3;
      const r = kind === 'cvscout' ? 2200 : kind === 'cvasw' ? 900 : 700;
      const alt = kind === 'cvasw' ? CARRIER_AI.aswHeight : CARRIER_AI.cruise;
      this.steer(v, new THREE.Vector3(ref.x + Math.cos(ang) * r, alt, ref.z + Math.sin(ang) * r), out, 0.35);
      this.safe(v, h, out, 40);
      return orders;
    }
    if (kind === 'cvfighter') {
      const lead = t.pos.clone().addScaledVector(t.velocity, Math.min(1.5, t.pos.distanceTo(v.pos) / 700));
      const a = this.steer(v, lead, out, 0.9);
      orders.fire = a.angle < 0.06 && a.dist < 600;
      out.throttle = 1;
      this.safe(v, h, out, 40);
      return orders;
    }
    const flat = Math.hypot(t.pos.x - v.pos.x, t.pos.z - v.pos.z);
    const lv = this.level?.(t.pos.x, t.pos.z) ?? 0;
    if (kind === 'cvdive') {
      if (flat > CARRIER_AI.diveFrom) {
        this.steer(v, new THREE.Vector3(t.pos.x, CARRIER_AI.cruise + 150, t.pos.z), out, 0.35);
      } else {
        const fall = Math.sqrt((2 * Math.max(1, h)) / 9.8);
        const aim = t.pos.clone().addScaledVector(t.velocity, fall);
        aim.y = lv + 4;
        this.steer(v, aim, out, 0.2);
        out.throttle = -1;
        if (h < CARRIER_AI.release && flat < 260) {
          orders.fire = true;
          plan.awayUntil = time + 8;
        }
      }
      this.safe(v, h, out, 90);
      return orders;
    }
    if (kind === 'cvtorp') {
      if (flat > CARRIER_AI.torpRelease * 2) {
        this.steer(v, new THREE.Vector3(t.pos.x, 150, t.pos.z), out, 0.3);
      } else {
        const run = flat / 25;
        const aim = t.pos.clone().addScaledVector(t.velocity, run);
        aim.y = lv + CARRIER_AI.torpHeight;
        const a = this.steer(v, aim, out, 0.15);
        if (flat < CARRIER_AI.torpRelease && h < CARRIER_AI.torpHeight + 25 && a.angle < 0.15) {
          orders.fire = true;
          plan.awayUntil = time + 10;
        }
      }
      this.safe(v, h, out, 12);
      return orders;
    }
    if (kind === 'cvasw') {
      const aim = t.pos.clone().addScaledVector(t.velocity, 3);
      aim.y = lv + CARRIER_AI.aswHeight;
      this.steer(v, aim, out, 0.3);
      if (Math.hypot(aim.x - v.pos.x, aim.z - v.pos.z) < 40) {
        orders.fire = true;
        plan.awayUntil = time + 4;
      }
      this.safe(v, h, out, 30);
      return orders;
    }
    // Attack plane: a shallow dive, rockets inside a kilometre, then the guns.
    const aim = t.pos.clone().addScaledVector(t.velocity, flat / 300);
    aim.y = lv + 3;
    if (flat > 1600) this.steer(v, new THREE.Vector3(t.pos.x, 350, t.pos.z), out, 0.3);
    else {
      const a = this.steer(v, aim, out, 0.1);
      orders.fire = a.angle < 0.05 && flat < 1100 && flat > 250;
      orders.alt = a.angle < 0.05 && flat < 700;
      if (flat < 260) plan.awayUntil = time + 6;
    }
    this.safe(v, h, out, 70);
    return orders;
  }

  /** Never into the sea: pull up below `floor` m. */
  private safe(v: Vehicle, h: number, out: DriveInput, floor: number): void {
    if (h < floor && (out.aimPitch ?? 0) < 0.3) out.aimPitch = 0.4;
    void v;
  }

  private enemyPlane(v: Vehicle, all: readonly Vehicle[], team: Team): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = 3000;
    for (const o of all) {
      if (!o.flight || o.wrecked || o.home === team || o.deck) continue;
      const d = o.pos.distanceTo(v.pos);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  forget(v: Vehicle): void {
    this.plans.delete(v.id);
  }
}
