import * as THREE from 'three';
import type { DamageSource, HitboxRegistry } from '@/combat/Hitboxes';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { Team } from '@/world/mapTypes';
import { BIKES, ENTER_REACH, JET_KINDS, PADS, ROADKILL, TANK_KINDS, VEHICLES, padReady, vehicleLimit, type PadState, type VehicleKind } from './vehicleData';
import { Vehicle, type DriveInput } from './Vehicle';

/** A base pad: where it is and what it brings out. */
export interface PadSpot extends PadState {
  team: Team;
  pos: THREE.Vector3;
  yaw: number;
}

/** A spot at a base where a tank can be brought out. */
export interface TankSpot {
  team: Team;
  pos: THREE.Vector3;
  yaw: number;
}

/** A zone's motorbike spot. */
export interface BikeSpot {
  zone: string;
  spots: { pos: THREE.Vector3; yaw: number }[];
  vehicle: number | null;
  lostAt: number;
}

/** Someone a vehicle can run over. */
export interface Walker {
  readonly id: number;
  readonly team: Team;
  readonly alive: boolean;
  readonly feet: THREE.Vector3;
}

export interface VehicleHooks {
  /** A vehicle blew up (`by`: who last hurt it). Its crew is killed by the caller. */
  destroyed(v: Vehicle, by: DamageSource | null): void;
  /** `v` ran `victim` over. */
  roadkill(v: Vehicle, victim: Walker): void;
}

const DOWN = new THREE.Vector3(0, -1, 0);
/** Ids for vehicles (clear of combatant ids). */
const FIRST_ID = 50000;
/** Seconds a wreck burns before it's cleared, and how long an empty vehicle may stand unused. */
const WRECK_LIFE = 12;
const ABANDON = 150;

/** How far a hull reaches from its centre on the ground (half its diagonal, m). */
function hullReach(kind: VehicleKind): number {
  const [hx, , hz] = VEHICLES[kind].half;
  return Math.hypot(hx, hz);
}

/**
 * Every vehicle on the map, the base pads that bring out jeeps and APCs, and
 * the motorbikes around the zones. Steps the driving before the physics step
 * and reads the bodies back after it.
 */
export class VehicleWorld {
  readonly group = new THREE.Group();
  readonly vehicles: Vehicle[] = [];
  private nextId = FIRST_ID;
  private time = 0;
  private readonly byHandle = new Map<number, Vehicle>();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly registry: HitboxRegistry,
    private readonly hooks: VehicleHooks,
    readonly pads: PadSpot[],
    readonly bikes: BikeSpot[],
    /** Bots in the match (vehicle limits scale with it). */
    readonly botCount: number,
    readonly tankSpots: TankSpot[] = [],
  ) {}

  /** Tanks (all kinds) one side has out, and how many it may. */
  tanks(team: Team): number {
    return this.vehicles.filter((v) => TANK_KINDS.includes(v.kind) && v.home === team && !v.wrecked).length;
  }

  tankLimit(): number {
    return vehicleLimit('tank', this.botCount);
  }

  /** Jets (all kinds) one side has up, and how many it may. */
  jets(team: Team): number {
    return this.vehicles.filter((v) => JET_KINDS.includes(v.kind) && v.home === team && !v.wrecked).length;
  }

  jetLimit(): number {
    return vehicleLimit('fighter', this.botCount);
  }

  /** A jet in the air off `team`'s side of the map (under the limit); null if it can't. */
  spawnJet(kind: VehicleKind, team: Team, at: THREE.Vector3, yaw: number): Vehicle | null {
    if (this.jets(team) >= this.jetLimit()) return null;
    return this.spawn(kind, at, yaw, team);
  }

  /** A clear tank spot at `team`'s base, or null. */
  freeTankSpot(team: Team): TankSpot | null {
    return this.tankSpots.find((s) => s.team === team && this.clearFor(s.pos, 'td')) ?? null;
  }

  /**
   * Room for a `kind` at `pos`: no other hull within reach of its own. A new
   * body put inside another gets shoved out hard by the physics, which can
   * throw both (and whoever rides them) high into the air.
   */
  clearFor(pos: THREE.Vector3, kind: VehicleKind): boolean {
    const reach = hullReach(kind);
    return !this.vehicles.some((v) => !v.flight && v.pos.distanceTo(pos) < reach + hullReach(v.kind) + 0.5);
  }

  /** Brings a tank out at the base (under the side's limit, on a clear spot); null if it can't. */
  spawnTank(kind: VehicleKind, team: Team): Vehicle | null {
    if (this.tanks(team) >= this.tankLimit()) return null;
    const spot = this.freeTankSpot(team);
    return spot ? this.spawn(kind, spot.pos, spot.yaw, team) : null;
  }

  spawn(kind: VehicleKind, pos: THREE.Vector3, yaw: number, home: Team | null): Vehicle {
    const v = new Vehicle(this.nextId++, kind, this.physics, pos, yaw, home);
    v.usedAt = this.time;
    this.vehicles.push(v);
    this.byHandle.set(v.collider.handle, v);
    this.registry.register(v.collider.handle, v, 'body');
    this.group.add(v.model.root);
    return v;
  }

  byCollider(handle: number): Vehicle | undefined {
    return this.byHandle.get(handle);
  }

  get(id: number): Vehicle | undefined {
    return this.vehicles.find((v) => v.id === id);
  }

  /** The closest vehicle with a free seat whose hull is within reach of `p`. */
  nearest(p: THREE.Vector3, reach = ENTER_REACH): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = Infinity;
    const local = new THREE.Vector3();
    for (const v of this.vehicles) {
      if (v.wrecked || v.seats.every((s) => s)) continue;
      // Distance to the hull box.
      local.copy(p).sub(v.pos).applyQuaternion(v.quat.clone().invert());
      const [hx, hy, hz] = v.spec.half;
      const dx = Math.max(0, Math.abs(local.x) - hx);
      const dy = Math.max(0, Math.abs(local.y) - hy - 1);
      const dz = Math.max(0, Math.abs(local.z) - hz);
      const d = Math.hypot(dx, dy, dz);
      if (d < reach && d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  /** How many of `kind` belonging to `team` are out (not wrecked). */
  count(kind: VehicleKind, team: Team): number {
    return this.vehicles.filter((v) => v.kind === kind && v.home === team && !v.wrecked).length;
  }

  /**
   * Before the physics step: drive every vehicle (`input` for the one the
   * player drives), run people over, keep pads and bike spots stocked, clear
   * wrecks and abandoned vehicles.
   */
  step(dt: number, inputs: Map<number, DriveInput>, walkers: Iterable<Walker>): void {
    this.time += dt;
    for (const v of this.vehicles) {
      if (!v.empty) v.usedAt = this.time;
      v.drive(dt, inputs.get(v.id) ?? null);
      if (!v.wrecked && v.health <= 0) this.wreck(v);
    }
    this.runOver(walkers);
    this.stockPads();
    this.stockBikes();
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i]!;
      const unused = v.empty && this.time - v.usedAt > ABANDON && !this.onPad(v);
      // Aircraft nobody flies: they come down; wrecks in the air fall and are cleared on landing.
      if (this.time > v.removeAt || unused || v.pos.y < -50) this.remove(v);
      else if (v.flight && v.crashed && !v.wrecked) v.health = 0;
    }
  }

  afterStep(): void {
    for (const v of this.vehicles) v.afterStep();
  }

  render(alpha: number): void {
    for (const v of this.vehicles) v.syncModel(alpha);
  }

  private wreck(v: Vehicle): void {
    v.wrecked = true;
    v.health = 0;
    v.removeAt = this.time + WRECK_LIFE;
    // Burnt out: dark all over.
    v.model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = WRECK_MAT;
    });
    this.hooks.destroyed(v, v.lastHurtBy);
  }

  private remove(v: Vehicle): void {
    this.vehicles.splice(this.vehicles.indexOf(v), 1);
    this.byHandle.delete(v.collider.handle);
    this.registry.unregister(v.collider.handle);
    this.group.remove(v.model.root);
    v.dispose();
    for (const p of this.pads) if (p.vehicle === v.id) this.leftPad(p);
    for (const b of this.bikes) if (b.vehicle === v.id) {
      b.vehicle = null;
      b.lostAt = this.time;
    }
  }

  private onPad(v: Vehicle): boolean {
    return this.pads.some((p) => p.vehicle === v.id);
  }

  private leftPad(p: PadSpot): void {
    p.vehicle = null;
    p.leftAt = this.time;
  }

  private stockPads(): void {
    for (const p of this.pads) {
      if (p.vehicle !== null) {
        const v = this.get(p.vehicle);
        if (!v || v.wrecked || v.pos.distanceTo(p.pos) > PADS.leaveDistance) this.leftPad(p);
        continue;
      }
      if (!padReady(p, this.time, this.count(p.kind, p.team), vehicleLimit(p.kind, this.botCount))) continue;
      // Wait until the pad is clear.
      if (!this.clearFor(p.pos, p.kind)) continue;
      const v = this.spawn(p.kind, p.pos, p.yaw, p.team);
      p.vehicle = v.id;
      p.spawnedAt = this.time;
    }
  }

  private stockBikes(): void {
    for (const b of this.bikes) {
      if (b.vehicle !== null) {
        const v = this.get(b.vehicle);
        // Left lying about away from its zone: taken back (another comes later).
        const home = b.spots[0]!.pos;
        if (v && v.empty && !v.wrecked && v.pos.distanceTo(home) > BIKES.abandonDistance && this.time - v.usedAt > BIKES.abandon) this.remove(v);
        continue;
      }
      if (this.time < b.lostAt + BIKES.respawn) continue;
      const free = b.spots.filter((s) => this.clearFor(s.pos, 'bike'));
      if (!free.length) continue;
      const s = free[Math.floor(Math.random() * free.length)]!;
      b.vehicle = this.spawn('bike', s.pos, s.yaw, null).id;
    }
  }

  /** Anyone in front of / under a vehicle moving fast enough with a driver aboard. */
  private runOver(walkers: Iterable<Walker>): void {
    const moving = this.vehicles.filter((v) => !v.wrecked && v.driver && v.velocity.length() > ROADKILL.speed);
    if (!moving.length) return;
    const local = new THREE.Vector3();
    for (const w of walkers) {
      if (!w.alive) continue;
      for (const v of moving) {
        if (v.seats.some((s) => s?.id === w.id)) continue;
        if (v.driver!.team === w.team) continue;
        local.copy(w.feet).setY(w.feet.y + 0.9).sub(v.pos).applyQuaternion(v.quat.clone().invert());
        const [hx, hy, hz] = v.spec.half;
        const pad = ROADKILL.pad;
        if (Math.abs(local.x) < hx + pad && Math.abs(local.z) < hz + pad && local.y > -hy - 1.2 && local.y < hy + 1) {
          this.hooks.roadkill(v, w);
          break;
        }
      }
    }
  }

  clear(): void {
    for (const v of [...this.vehicles]) this.remove(v);
  }
}

const WRECK_MAT = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.95 });

/**
 * A level, clear patch of ground (half sizes `hx`, `hz`, turned by `yaw`) at x, z
 * near height `y0`: its ground point, or null (sloped, roofed over, blocked).
 */
export function flatSpot(physics: PhysicsWorld, x: number, z: number, y0: number, hx: number, hz: number, yaw: number): THREE.Vector3 | null {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let lo = Infinity;
  let hi = -Infinity;
  for (const [u, w] of [[0, 0], [-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz], [0, -hz], [0, hz], [-hx, 0], [hx, 0]] as const) {
    const px = x + u * c + w * s;
    const pz = z - u * s + w * c;
    const hit = physics.raycast({ x: px, y: y0 + 30, z: pz }, DOWN, 60, Layer.WORLD);
    if (!hit || hit.normal.y < 0.94) return null;
    lo = Math.min(lo, hit.point.y);
    hi = Math.max(hi, hit.point.y);
  }
  // Level, and on the ground near the base / zone (not up on a roof).
  if (hi - lo > 0.45 || Math.abs(lo - y0) > 4) return null;
  // Nothing overhead or in the box (a hit from above lands on the roof, not the ground).
  const mid = physics.raycast({ x, y: lo + 0.6, z }, { x: 0, y: 1, z: 0 }, 4, Layer.WORLD);
  if (mid) return null;
  // Low and high, across the box and out ahead of it (kerbs, low walls in the way out).
  for (const h of [0.35, 0.8]) {
    for (const [u, w, reach] of [[-hx, 0, 2], [0, -hz, 3]] as const) {
      const from = { x: x - u * c - w * s, y: lo + h, z: z + u * s - w * c };
      const dir = new THREE.Vector3(u * c + w * s, 0, -u * s + w * c).normalize();
      if (physics.raycast(from, dir, Math.hypot(u, w) * reach, Layer.WORLD)) return null;
    }
  }
  return new THREE.Vector3(x, hi, z);
}

/**
 * Pad and motorbike spots for a map: a clear, flat patch near each side's
 * base spawns (a jeep pad and an APC pad), and a few flat spots around each
 * zone for its motorbike. Found by ray casts at load, no map data needed.
 */
export function planVehicleSpots(
  physics: PhysicsWorld,
  bases: { team: Team; pos: THREE.Vector3; facing: number }[],
  zones: { id: string; pos: THREE.Vector3; radius: number }[],
): { pads: PadSpot[]; bikes: BikeSpot[]; tankSpots: TankSpot[] } {
  const pads: PadSpot[] = [];
  const taken: THREE.Vector3[] = [];
  const flat = (x: number, z: number, y0: number, hx: number, hz: number, yaw: number) => flatSpot(physics, x, z, y0, hx, hz, yaw);
  const clear = (p: THREE.Vector3, r: number) => taken.every((t) => t.distanceTo(p) > r);
  for (const b of bases) {
    for (const kind of ['jeep', 'apc'] as VehicleKind[]) {
      const [hx, hz] = kind === 'apc' ? [2.2, 4.2] : [1.6, 3];
      let found: PadSpot | null = null;
      for (let r = 8; r <= 60 && !found; r += 4) {
        for (let k = 0; k < 16 && !found; k++) {
          const a = b.facing + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8) + Math.PI;
          const x = b.pos.x - Math.sin(a) * r;
          const z = b.pos.z - Math.cos(a) * r;
          const p = flat(x, z, b.pos.y, hx, hz, b.facing);
          if (p && clear(p, 9)) found = { kind, team: b.team, pos: p, yaw: b.facing, vehicle: null, leftAt: -Infinity, spawnedAt: -Infinity };
        }
      }
      if (found) {
        pads.push(found);
        taken.push(found.pos);
      }
    }
  }
  // Tank spots: a few big clear patches near each base.
  const tankSpots: TankSpot[] = [];
  for (const b of bases) {
    let n = 0;
    for (let r = 10; r <= 70 && n < 4; r += 5) {
      for (let k = 0; k < 16 && n < 4; k++) {
        const a = b.facing + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8) + Math.PI;
        const p = flat(b.pos.x - Math.sin(a) * r, b.pos.z - Math.cos(a) * r, b.pos.y, 2.3, 4.4, b.facing);
        if (p && clear(p, 9)) {
          tankSpots.push({ team: b.team, pos: p, yaw: b.facing });
          taken.push(p);
          n++;
        }
      }
    }
  }
  const bikes: BikeSpot[] = [];
  for (const z of zones) {
    const spots: { pos: THREE.Vector3; yaw: number }[] = [];
    for (let i = 0; i < 24 && spots.length < 4; i++) {
      const a = (i / 24) * Math.PI * 2 * 3.1;
      const r = z.radius + 3 + (i % 3) * 3;
      const yaw = a + Math.PI / 2;
      const p = flat(z.pos.x + Math.cos(a) * r, z.pos.z + Math.sin(a) * r, z.pos.y, 0.6, 1.3, yaw);
      if (p && clear(p, 5)) {
        spots.push({ pos: p, yaw });
        taken.push(p);
      }
    }
    if (spots.length) for (let n = 0; n < BIKES.perZone; n++) bikes.push({ zone: z.id, spots, vehicle: null, lostAt: -Infinity });
  }
  return { pads, bikes, tankSpots };
}
