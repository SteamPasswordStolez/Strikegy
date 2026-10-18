import { disposeTree } from '@/render/dispose';
import * as THREE from 'three';
import type { DamageSource, HitboxRegistry } from '@/combat/Hitboxes';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { MapDef, Team } from '@/world/mapTypes';
import type { Boundary } from '@/world/terrain';
import { BIKES, ENTER_REACH, JET_KINDS, PADS, ROADKILL, TANK_KINDS, VEHICLES, padReady, vehicleLimit, type PadState, type VehicleKind } from './vehicleData';
import { Vehicle, type DriveInput } from './Vehicle';
import { SHIP, spotShips, stationNear } from './ship';
import { DECK, type CarrierPlaneKind } from './carrierPlanes';

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
  /** What stands there (default: a motorbike); maps place boats at their piers this way. */
  kind?: VehicleKind;
  /** The side it belongs to (a landing force's craft), or nobody's. */
  team?: Team;
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
  /** Points for someone manning a warship's station or flying a carrier plane (`SHIP.duty` a second): a fleet's RP. */
  duty?(id: number, points: number): void;
}

const DOWN = new THREE.Vector3(0, -1, 0);
/** How long a person's newly launched carrier plane waits for them (s). */
const PLANE_KEEP = 40;
/** Ids for vehicles (clear of combatant ids). */
const FIRST_ID = 50000;
/** Seconds a wreck burns before it's cleared, and how long an empty vehicle may stand unused. */
const WRECK_LIFE = 12;
/** Vehicles further than this from the camera (m) draw their merged far look. */
const FAR_LOOK = 45;
/** Within this distance (m) vehicles show their small parts too (a pixel or two beyond). */
const FINE_LOOK = 25;
const ABANDON = 150;
/** Landing craft: seconds before a lost one is back at its spot, and before an empty one left on the beach is cleared. */
const LANDING = { respawn: 12, abandon: 25 };

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
  /** The map's air space for new vehicles (null: Vehicle's defaults). */
  air: { center: THREE.Vector3; radius: number } | null = null;
  /** Water under boats (the sea and rivers), or null on dry maps. */
  water: ((x: number, z: number) => number) | null = null;
  /** Fleet battle: warships lost are not brought back. */
  fleet = false;
  /** This world keeps the vehicles' health (false in a browser playing on the game server: its snapshots do). */
  authority = true;
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
    /** Armour and aircraft allowed (off on small maps: jeeps and motorbikes only). */
    readonly heavy = true,
    /** Aircraft allowed (off on maps too small or too built-up for them). */
    readonly jetsAllowed = true,
  ) {}

  /** Tanks (all kinds) one side has out, and how many it may. */
  tanks(team: Team): number {
    return this.vehicles.filter((v) => TANK_KINDS.includes(v.kind) && v.home === team && !v.wrecked).length;
  }

  tankLimit(): number {
    if (!this.heavy) return 0;
    return vehicleLimit('tank', this.botCount);
  }

  /** Jets (all kinds) one side has up, and how many it may. */
  jets(team: Team): number {
    return this.vehicles.filter((v) => JET_KINDS.includes(v.kind) && v.home === team && !v.wrecked).length;
  }

  jetLimit(): number {
    if (!this.heavy || !this.jetsAllowed) return 0;
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

  spawn(kind: VehicleKind, pos: THREE.Vector3, yaw: number, home: Team | null, id = this.nextId++): Vehicle {
    const v = new Vehicle(id, kind, this.physics, pos, yaw, home);
    if (this.air) {
      v.airCenter = this.air.center;
      v.airRadius = this.air.radius;
    }
    v.water = this.water;
    if (v.spec.plane) v.carriers = () => this.vehicles.filter((c) => c.kind === 'cv');
    v.usedAt = this.time;
    this.vehicles.push(v);
    for (const c of [v.collider, v.wingCollider, ...v.parts]) {
      if (!c) continue;
      this.byHandle.set(c.handle, v);
      this.registry.register(c.handle, v, 'body');
    }
    this.group.add(v.model.root);
    return v;
  }

  byCollider(handle: number): Vehicle | undefined {
    return this.byHandle.get(handle);
  }

  get(id: number): Vehicle | undefined {
    return this.vehicles.find((v) => v.id === id);
  }

  /**
   * What E by `p` gets one into: on or by a warship, only the station one
   * stands at (walk up to it); else the nearest vehicle's first free seat
   * that `ok` allows. Null when there is none.
   */
  enterAt(p: THREE.Vector3, ok: (v: Vehicle, seat: number) => boolean): { v: Vehicle; seat: number } | null {
    // Something standing on a ship's deck (a carrier's planes) comes before the ship's stations.
    const v = this.nearest(p, ENTER_REACH, (o) => !o.spec.ship) ?? this.nearest(p);
    if (!v) return null;
    if (v.spec.ship) {
      const seat = stationNear(v.spec, (q) => v.toLocal(q), p, (i) => !v.seats[i] && ok(v, i));
      return seat >= 0 ? { v, seat } : null;
    }
    const seat = v.seats.findIndex((s, i) => !s && ok(v, i));
    return seat >= 0 ? { v, seat } : null;
  }

  /** The closest vehicle with a free seat whose hull is within reach of `p`. */
  nearest(p: THREE.Vector3, reach = ENTER_REACH, only?: (v: Vehicle) => boolean): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = Infinity;
    const local = new THREE.Vector3();
    for (const v of this.vehicles) {
      if (v.wrecked || v.seats.every((s) => s) || (only && !only(v))) continue;
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

  /** Carrier planes `team` has out (not wrecked). */
  planesUp(team: Team): number {
    return this.vehicles.filter((v) => v.spec.plane && !v.wrecked && v.home === team).length;
  }

  /**
   * A carrier plane of `kind` for `team` on carrier `c`'s deck, at the first
   * clear spot aft (planes are launched from the stern end so they have the
   * whole deck to roll down); null when the deck is full there.
   */
  launchPlane(c: Vehicle, kind: CarrierPlaneKind, team: Team, keepFor: number | null = null): Vehicle | null {
    const hz = c.spec.half[2];
    const spots: [number, number][] = [];
    for (let k = 0; k < 4; k++) for (const x of [-8, 5]) spots.push([x, hz - 20 - k * 22]);
    for (const [x, z] of spots) {
      const at = c.toWorld(new THREE.Vector3(x, c.spec.half[1] + 2, z), new THREE.Vector3());
      if (this.vehicles.some((o) => o.spec.plane && !o.wrecked && o.pos.distanceTo(at) < 11)) continue;
      const v = this.spawn(kind, at, c.yaw, team);
      v.parkOn(c, x, z);
      // Launched by a person: theirs to fly for a while (bots keep out of its cockpit).
      if (keepFor !== null) {
        v.driverOnly = keepFor;
        v.keptUntil = this.time + PLANE_KEEP;
      }
      return v;
    }
    return null;
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
      // A warship's fires and flooding, where its health is kept (the game server's world, solo play; not a browser in a match there).
      if (this.authority) v.stepShip(dt);
      // On duty aboard a warship or in a carrier plane: points (squad RP for the planes, call-ins).
      if (this.authority && (v.ship || v.spec.plane) && !v.wrecked && this.hooks.duty) for (const o of v.seats) if (o) this.hooks.duty(o.id, SHIP.duty * dt);
      // A carrier plane standing on the deck: repaired and rearmed after a while.
      if (v.spec.plane && !v.wrecked) {
        if (v.driverOnly !== null && (this.time > v.keptUntil || v.seats[0])) v.driverOnly = null;
        v.parkedFor = v.parked ? v.parkedFor + dt : 0;
        if (v.parkedFor >= DECK.rearm && v.parkedFor - dt < DECK.rearm) v.rearm();
      }
      if (!v.wrecked && v.health <= 0) this.wreck(v);
    }
    // Warships look and listen for each other once a second (dived submarines are only seen when found).
    if (Math.floor(this.time) !== Math.floor(this.time - dt) && this.vehicles.some((v) => v.ship)) spotShips(this.vehicles, this.time);
    this.runOver(walkers);
    this.stockPads();
    this.stockBikes();
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i]!;
      // Warships stay out empty (they are the fleet, not something one leaves lying about).
      const unused = v.empty && this.time - v.usedAt > ABANDON && !this.onPad(v) && !v.spec.ship && !(v.spec.plane && v.parked);
      // Aircraft nobody flies: they come down; wrecks in the air fall and are cleared on landing.
      if (this.time > v.removeAt || unused || v.pos.y < -50) this.remove(v);
      else if (v.flight && v.crashed && !v.wrecked) v.health = 0;
    }
  }

  afterStep(): void {
    for (const v of this.vehicles) v.afterStep();
  }

  render(alpha: number, eye?: THREE.Vector3): void {
    for (const v of this.vehicles) {
      v.syncModel(alpha);
      if (!eye || !v.model.setFar) continue;
      // Merged far look past FAR_LOOK (with a little hysteresis so it doesn't flicker).
      // A warship by its hull (one stands on a carrier's deck 120 m from its middle).
      const d2 = v.spec.ship ? v.hullDistance(eye) ** 2 : v.pos.distanceToSquared(eye);
      v.farLook = v.farLook ? d2 > (FAR_LOOK - 5) ** 2 : d2 > (FAR_LOOK + 5) ** 2;
      // Small parts (bolts, vision blocks, track guides) only up close.
      v.fineLook = v.fineLook ? d2 < (FINE_LOOK + 3) ** 2 : d2 < (FINE_LOOK - 3) ** 2;
      v.model.setFar(v.farLook, v.fineLook);
    }
  }

  private wreck(v: Vehicle): void {
    this.burnOut(v);
    // A warship goes down slowly (its buoyancy fades: ship.ts `sinkTime`), then it goes.
    v.removeAt = this.time + (v.ship ? SHIP.sinkTime + 15 : WRECK_LIFE);
    this.hooks.destroyed(v, v.lastHurtBy);
  }

  /** A wreck: dark all over (a browser in a match on the game server shows what the server wrecked). */
  burnOut(v: Vehicle): void {
    v.wrecked = true;
    v.health = 0;
    if (v.ship && v.ship.sinking < 0) v.ship.sinking = 0;
    v.model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = WRECK_MAT;
    });
  }

  /** Off the map and out of the physics. */
  remove(v: Vehicle): void {
    this.vehicles.splice(this.vehicles.indexOf(v), 1);
    for (const c of [v.collider, v.wingCollider, ...v.parts]) {
      if (!c) continue;
      this.byHandle.delete(c.handle);
      this.registry.unregister(c.handle);
    }
    this.group.remove(v.model.root);
    // Each vehicle merges its own geometry; the materials are shared (vehicleModels cache).
    disposeTree(v.model.root);
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
        const abandon = b.kind === 'lcvp' ? LANDING.abandon : BIKES.abandon;
        if (v && v.empty && !v.wrecked && !v.ship && v.pos.distanceTo(home) > BIKES.abandonDistance && this.time - v.usedAt > abandon) this.remove(v);
        continue;
      }
      // Fleet battle: a sunk warship is gone for good.
      if (this.fleet && b.kind && VEHICLES[b.kind].ship && b.lostAt > -Infinity) continue;
      // Landing craft come back quickly: the landing force rides nothing else.
      if (this.time < b.lostAt + (b.kind === 'lcvp' ? LANDING.respawn : BIKES.respawn)) continue;
      const kind = b.kind ?? 'bike';
      const free = b.spots.filter((s) => this.clearFor(s.pos, kind));
      if (!free.length) continue;
      const s = free[Math.floor(Math.random() * free.length)]!;
      b.vehicle = this.spawn(kind, s.pos, s.yaw, b.team ?? null).id;
    }
  }

  /** Anyone in front of / under a vehicle moving fast enough with a driver aboard. */
  private runOver(walkers: Iterable<Walker>): void {
    const moving = this.vehicles.filter((v) => !v.wrecked && v.driver && v.velocity.length() > ROADKILL.speed);
    if (!moving.length) return;
    const local = new THREE.Vector3();
    const pad = ROADKILL.pad;
    // Each one's turn undone once, and a circle round it for a quick miss.
    const inv = moving.map((v) => v.quat.clone().invert());
    const reach = moving.map((v) => {
      const [hx, , hz] = v.spec.half;
      return (hx + pad) ** 2 + (hz + pad) ** 2;
    });
    for (const w of walkers) {
      if (!w.alive) continue;
      for (let i = 0; i < moving.length; i++) {
        const v = moving[i]!;
        const dx = w.feet.x - v.pos.x;
        const dz = w.feet.z - v.pos.z;
        if (dx * dx + dz * dz > reach[i]!) continue;
        if (v.seats.some((s) => s?.id === w.id)) continue;
        if (v.driver!.team === w.team) continue;
        local.copy(w.feet).setY(w.feet.y + 0.9).sub(v.pos).applyQuaternion(inv[i]!);
        const [hx, hy, hz] = v.spec.half;
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
 * Inside the playable outline with the whole footprint (half sizes `hx`, `hz`,
 * any turn) and 2 m to spare. Outside it the ground keeps going (the rise into
 * the scenery hills), so a flat spot there is easy to find and out of play.
 */
export function inPlay(boundary: Boundary | null, x: number, z: number, hx: number, hz: number): boolean {
  return !boundary || (boundary.contains(x, z) && boundary.edgeDistance(x, z) >= Math.hypot(hx, hz) + 2);
}

/**
 * Where a called-in vehicle (half sizes `hx`, `hz`) comes out: a flat, clear
 * spot just outside one of the two zones nearest `near`, in play, 8 m from
 * other vehicles. Null when there is none.
 */
export function callInSpot(
  physics: PhysicsWorld,
  boundary: Boundary | null,
  zones: { id: string; pos: THREE.Vector3; radius: number }[],
  near: THREE.Vector3,
  vehicles: readonly { pos: THREE.Vector3 }[],
  hx: number,
  hz: number,
): { zone: string; pos: THREE.Vector3; yaw: number } | null {
  const order = [...zones].sort((a, b) => a.pos.distanceTo(near) - b.pos.distanceTo(near));
  for (const z of order.slice(0, 2)) {
    for (let i = 0; i < 36; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = z.radius + 4 + Math.floor(i / 12) * 6;
      const yaw = a + Math.PI / 2;
      const x = z.pos.x + Math.cos(a) * r;
      const zz = z.pos.z + Math.sin(a) * r;
      if (!inPlay(boundary, x, zz, hx, hz)) continue;
      const p = flatSpot(physics, x, zz, z.pos.y, hx, hz, yaw);
      if (!p || vehicles.some((v) => v.pos.distanceTo(p) < 8)) continue;
      return { zone: z.id, pos: p, yaw };
    }
  }
  return null;
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
  boundary: Boundary | null = null,
): { pads: PadSpot[]; bikes: BikeSpot[]; tankSpots: TankSpot[] } {
  const pads: PadSpot[] = [];
  const taken: THREE.Vector3[] = [];
  const flat = (x: number, z: number, y0: number, hx: number, hz: number, yaw: number) => (inPlay(boundary, x, z, hx, hz) ? flatSpot(physics, x, z, y0, hx, hz, yaw) : null);
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

/**
 * The map's fixed vehicle spots (`MapDef.vehicles`) as spots kept stocked like
 * the motorbikes': a boat floats where it is put (on the water there), the
 * rest stand on the ground.
 */
export function mapVehicleSpots(map: MapDef, physics: PhysicsWorld, water: ((x: number, z: number) => number) | null): BikeSpot[] {
  return (map.vehicles ?? []).map((m, i) => {
    const [x, z] = m.pos;
    const level = water ? water(x, z) : NaN;
    const hit = physics.raycast({ x, y: 300, z }, { x: 0, y: -1, z: 0 }, 600, Layer.WORLD);
    // Anything that floats goes on the water (a hull put on the sea bed comes up like a cork).
    const y = VEHICLES[m.kind].boat && !Number.isNaN(level) ? level : (hit?.point.y ?? 0);
    return { zone: `map${i}`, kind: m.kind, team: m.team, spots: [{ pos: new THREE.Vector3(x, y + 0.1, z), yaw: ((m.yaw ?? 0) * Math.PI) / 180 }], vehicle: null, lostAt: -Infinity };
  });
}
