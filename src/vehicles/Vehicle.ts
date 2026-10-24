import * as THREE from 'three';
import type { HitPart } from '@/core/events';
import type { Damageable, DamageKind, DamageSource } from '@/combat/Hitboxes';
import { Layer, RAPIER, groups, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { Team } from '@/world/mapTypes';
import { AIRSPACE, VEHICLES, VEHICLE_GUNS, engineForce, vehicleDamage, type VehicleGunId, type VehicleGunSpec, type StationKind, type VehicleKind, type VehicleSpec } from './vehicleData';
import { ShipState } from './ship';
import { DECK } from './carrierPlanes';
import { buildVehicleModel, type VehicleModel } from './vehicleModels';

/** Driving input for one step: throttle and steering -1..1, handbrake. */
export interface DriveInput {
  throttle: number;
  steer: number;
  brake: boolean;
  /** Aircraft: where the pilot looks (the plane turns toward it). */
  aimYaw?: number;
  aimPitch?: number;
}

/** Aircraft state: heading, pitch, roll (rad), airspeed (m/s), throttle 0..1. */
export interface Flight {
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  throttle: number;
  /** Turned back at the edge of the air space this step. */
  turningBack: boolean;
}

/** A gun on a seat: where it points (relative to the hull), heat and the next shot. */
export interface Mount {
  readonly seat: number;
  readonly id: VehicleGunId;
  readonly gun: VehicleGunSpec;
  yaw: number;
  pitch: number;
  heat: number;
  overheated: boolean;
  nextShot: number;
  /** Rounds left (carrier planes; Infinity: no limit). */
  ammo: number;
  /** The hull's heading when the gun was last aimed (the gun holds its bearing as the hull turns under it). */
  hullYaw?: number;
}

/** Someone in a seat: a combatant id and which team they're on. */
export interface Occupant {
  id: number;
  team: Team;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * One vehicle: a dynamic chassis on Rapier's ray-cast wheels, seats, health
 * and a gun for the gunner's seat. The chassis is solid world geometry for
 * everyone (cover, the player bumps into it) and a hitbox, so bullets and
 * rockets find it through the hitbox registry like they find people.
 */
export class Vehicle implements Damageable {
  readonly spec: VehicleSpec;
  readonly model: VehicleModel;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** Aircraft: a second hitbox across the wings. */
  readonly wingCollider: RAPIER.Collider | null = null;
  /** A walkable ship's solid deck parts (deckhouse, railings, mounts), on the same body. */
  readonly parts: RAPIER.Collider[] = [];
  private readonly controller: RAPIER.DynamicRayCastVehicleController | null = null;
  /** Aircraft only. */
  readonly flight: Flight | null = null;
  /** Centre of the air space (the map centre) and the playable radius, set by the game (defaults for new vehicles). */
  static airCenter = new THREE.Vector3();
  static airRadius = 300;
  /** This vehicle's air space (a game server runs rooms on different maps side by side). */
  airCenter: THREE.Vector3 = Vehicle.airCenter;
  airRadius = Vehicle.airRadius;
  readonly seats: (Occupant | null)[];
  health: number;
  /** Destroyed: a burning wreck until `removeAt`. */
  wrecked = false;
  /** Drawn with the merged far look (VehicleWorld.render). */
  farLook = false;
  /** Small parts shown (near the viewer, see VehicleWorld.render). */
  fineLook = true;
  removeAt = Infinity;
  /** Last time anyone sat in it (abandoned vehicles are cleared away). */
  usedAt = 0;
  /** Jets: game time it came in off the edge (missiles can't lock it for a moment). */
  arrivedAt = -Infinity;
  /** Only this combatant may take the driver's seat (a called-in rocket tank: its squad leader), or null. */
  driverOnly: number | null = null;
  /** A carrier plane kept for whoever launched it until then (VehicleWorld time). */
  keptUntil = 0;
  /** Guns by seat (null for seats without one), and second weapons (missiles, rocket pods). */
  readonly mounts: (Mount | null)[];
  readonly altMounts: (Mount | null)[];
  /** Interpolation: transforms before and after the last sim step. */
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  /** Who last hurt it (credited if it blows up). */
  lastHurtBy: DamageSource | null = null;
  /** Health taken off it and by whom (set by the world on the side that owns its health: RP at sea). */
  onHurt: ((by: DamageSource, taken: number) => void) | null = null;
  /**
   * Moved from outside instead of by its own physics (`place`): a vehicle a
   * person drives in a match on the game server (that person's browser
   * drives it), and every vehicle the browser only draws there.
   */
  remote = false;
  /** Rounds fired by each seat's main gun, counting up (others draw new ones). */
  readonly seatShots: number[];
  /** Until when each side has this boat marked (a dived submarine is only seen while marked: ship.ts `spotShips`). */
  readonly spottedUntil: Record<Team, number> = { blue: -Infinity, red: -Infinity };
  /** A warship's telegraph, damage control, depth (ship.ts); null for everything else. */
  readonly ship: ShipState | null;
  private wheelSpin: number[];

  constructor(
    readonly id: number,
    readonly kind: VehicleKind,
    private readonly physics: PhysicsWorld,
    pos: THREE.Vector3,
    yaw: number,
    /** Side it belongs to (paint); anyone can take an empty one. */
    readonly home: Team | null,
  ) {
    const spec = (this.spec = VEHICLES[kind]);
    this.health = spec.health;
    this.seats = spec.seats.map(() => null);
    const mount = (seat: number, id: VehicleGunId | undefined): Mount | null => (id ? { seat, id, gun: VEHICLE_GUNS[id], yaw: 0, pitch: 0, heat: 0, overheated: false, nextShot: 0, ammo: VEHICLE_GUNS[id].ammo ?? Infinity } : null);
    this.mounts = spec.seats.map((s, seat) => mount(seat, s.gun));
    this.altMounts = spec.seats.map((s, seat) => mount(seat, s.alt));
    this.wheelSpin = spec.wheels.map(() => 0);
    this.seatShots = spec.seats.map(() => 0);
    this.ship = spec.ship ? new ShipState(spec) : null;
    const world = physics.world;
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    if (spec.flight) {
      // Aircraft: a kinematic body flown by `fly`; its box is a hitbox only.
      this.flight = { yaw, pitch: 0, roll: 0, speed: (spec.flight.minSpeed + spec.flight.maxSpeed) / 2, throttle: 0.6, turningBack: false };
      this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
      // Its filter must name HITBOX too: with 0 no ray (bullets, cannon, rockets) could ever hit it (jets took only blast damage).
      this.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(...spec.half).setCollisionGroups(groups(Layer.HITBOX, Layer.HITBOX)), this.body);
      const w = spec.flight.wings;
      this.wingCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(...w.half).setTranslation(0, 0, w.z).setCollisionGroups(groups(Layer.HITBOX, Layer.HITBOX)), this.body);
      this.model = buildVehicleModel(kind, home);
      this.readBody();
      this.prevPos.copy(this.pos);
      this.prevQuat.copy(this.quat);
      this.syncModel(1);
      return;
    }
    if (spec.fixed) {
      // A fixed weapon (emplacements.ts): a fixed body on the ground, its solid box standing on it.
      this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
      const [hx, hy, hz] = spec.half;
      this.collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz)
          .setTranslation(0, hy, 0)
          .setCollisionGroups(groups(Layer.WORLD | Layer.HITBOX, Layer.WORLD | Layer.BOUNDS | Layer.VEHICLE_BLOCK)),
        this.body,
      );
      physics.trackOccluder(this.collider);
      this.model = buildVehicleModel(kind, home);
      this.readBody();
      this.prevPos.copy(this.pos);
      this.prevQuat.copy(this.quat);
      this.syncModel(1);
      return;
    }
    if (spec.boat && !spec.wheels.length) {
      // A boat: a dynamic hull the floats hold up (`sail`); no wheels.
      this.body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          // A warship starts at its waterline (dropped from the surface, a 30,000 t hull would bob for a minute).
          .setTranslation(pos.x, pos.y + spec.half[1] - (spec.ship ? spec.boat.draft : 0), pos.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          // A warship's own water drag sets its top speed and turning (mass-proportional
          // damping would swamp the propeller on a 30,000 t hull); a little against rolling.
          .setLinearDamping(spec.ship ? 0 : 0.05)
          .setAngularDamping(spec.ship ? 0.15 : 0.8)
          .setCcdEnabled(true),
      );
      const [hx, hy, hz] = spec.half;
      const m = spec.mass;
      this.collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz)
          .setMassProperties(
            m,
            { x: 0, y: -hy * 0.6, z: 0 },
            { x: (m / 12) * (4 * hy * hy + 4 * hz * hz), y: (m / 12) * (4 * hx * hx + 4 * hz * hz), z: (m / 12) * (4 * hx * hx + 4 * hy * hy) },
            { x: 0, y: 0, z: 0, w: 1 },
          )
          .setFriction(0.4)
          .setCollisionGroups(groups(Layer.WORLD | Layer.HITBOX, Layer.WORLD | Layer.BOUNDS | Layer.VEHICLE_BLOCK)),
        this.body,
      );
      physics.trackOccluder(this.collider);
      for (const part of spec.deck?.parts ?? []) {
        const c = world.createCollider(
          RAPIER.ColliderDesc.cuboid(part.half[0], part.half[1], part.half[2])
            .setTranslation(part.pos[0], part.pos[1], part.pos[2])
            .setDensity(0)
            .setFriction(0.6)
            .setCollisionGroups(groups(Layer.WORLD | Layer.HITBOX, Layer.WORLD | Layer.BOUNDS | Layer.VEHICLE_BLOCK)),
          this.body,
        );
        physics.trackOccluder(c);
        this.parts.push(c);
      }
      this.model = buildVehicleModel(kind, home);
      this.readBody();
      this.prevPos.copy(this.pos);
      this.prevQuat.copy(this.quat);
      this.syncModel(1);
      return;
    }
    const start = pos.clone().setY(pos.y + spec.half[1] + spec.wheelRadius + spec.suspension.rest + 0.15);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(start.x, start.y, start.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinearDamping(0.15)
        .setAngularDamping(1.2)
        .setCcdEnabled(true),
    );
    const [hx, hy, hz] = spec.half;
    const m = spec.mass;
    // Centre of mass low in the hull so it doesn't roll over in turns.
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setMassProperties(
          m,
          { x: 0, y: -hy * 0.7, z: 0 },
          { x: (m / 12) * (4 * hy * hy + 4 * hz * hz), y: (m / 12) * (4 * hx * hx + 4 * hz * hz), z: (m / 12) * (4 * hx * hx + 4 * hy * hy) },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setFriction(0.5)
        .setCollisionGroups(groups(Layer.WORLD | Layer.HITBOX, Layer.WORLD | Layer.BOUNDS | Layer.VEHICLE_BLOCK)),
      this.body,
    );
    // The hull blocks sight lines (bots' line-of-sight checks don't go through Rapier).
    physics.trackOccluder(this.collider);
    const c = (this.controller = world.createVehicleController(this.body));
    c.indexUpAxis = 1;
    c.setIndexForwardAxis = 2;
    spec.wheels.forEach((w, i) => {
      c.addWheel({ x: w.pos[0], y: w.pos[1], z: w.pos[2] }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, spec.suspension.rest, spec.wheelRadius);
      c.setWheelSuspensionStiffness(i, spec.suspension.stiffness);
      c.setWheelSuspensionCompression(i, spec.suspension.damping);
      c.setWheelSuspensionRelaxation(i, spec.suspension.damping * 1.3);
      c.setWheelMaxSuspensionTravel(i, spec.suspension.travel);
      c.setWheelMaxSuspensionForce(i, spec.mass * 9.81 * 3);
      c.setWheelFrictionSlip(i, spec.friction);
      c.setWheelSideFrictionStiffness(i, spec.grip);
    });
    this.model = buildVehicleModel(kind, home);
    this.readBody();
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.syncModel(1);
  }

  get name(): string {
    return this.kind;
  }

  /** Alive while not wrecked. */
  get alive(): boolean {
    return !this.wrecked;
  }

  /** The team of whoever is aboard (so their own side can't hurt it); null when empty. */
  get team(): Team | null {
    for (const s of this.seats) if (s) return s.team;
    return null;
  }

  get empty(): boolean {
    return this.seats.every((s) => !s);
  }

  get driver(): Occupant | null {
    return this.seats[0] ?? null;
  }

  /** Whether someone mans a station of `kind` (warships). */
  manned(kind: StationKind): boolean {
    return this.spec.seats.some((s, i) => s.station?.kind === kind && !!this.seats[i]);
  }

  /**
   * How far `point` is from the hull: from its box for a ship (a shell on a
   * 250 m carrier's bow is not 120 m off it), roughly from the middle for the rest.
   */
  hullDistance(point: THREE.Vector3): number {
    if (!this.spec.ship) return Math.max(0, this.pos.distanceTo(point) - Math.min(this.spec.half[0], this.spec.half[2]));
    const l = this.toLocal(this.tmpHull.copy(point));
    const [hx, hy, hz] = this.spec.half;
    return Math.hypot(Math.max(0, Math.abs(l.x) - hx), Math.max(0, Math.abs(l.y) - hy - 4), Math.max(0, Math.abs(l.z) - hz));
  }
  private readonly tmpHull = new THREE.Vector3();

  /** A warship hit by a round of `gun` at `point` (world): fires, flooding, a station knocked out. */
  shipHit(gun: string, point: THREE.Vector3): void {
    if (!this.ship || this.wrecked) return;
    this.ship.hit(gun === 'torpedo' ? 'torpedo' : 'shell', this.toLocal(this.tmpHull.copy(point)), Math.random);
  }

  /** A warship's troubles for a step (fires burn the hull); on the side that owns its health. */
  stepShip(dt: number): void {
    const s = this.ship;
    if (!s) return;
    const burn = s.step(dt, (k) => this.manned(k));
    if (burn > 0 && !this.wrecked) this.hurt(burn * this.spec.health, this.lastHurtBy);
  }

  /** Signed speed along the hull's forward axis (m/s). */
  forwardSpeed(): number {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
    return this.velocity.dot(fwd);
  }

  get yaw(): number {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
    return Math.atan2(-f.x, -f.z);
  }

  /** Takes `dmg` off the health and tells `onHurt` how much of it was really taken (fires credit whoever last hurt it). */
  private hurt(dmg: number, by: DamageSource | null): void {
    const taken = Math.min(dmg, Math.max(0, this.health));
    this.health -= dmg;
    if (by && taken > 0) this.onHurt?.(by, taken);
  }

  applyDamage(amount: number, part: HitPart, source?: DamageSource, kind: DamageKind = 'bullet'): boolean {
    void part;
    if (this.wrecked) return false;
    const dmg = vehicleDamage(this.kind, amount, kind);
    if (dmg <= 0) return false;
    if (source) this.lastHurtBy = source;
    this.hurt(dmg, source ?? null);
    // A vehicle is never reported as a kill itself (its crew is).
    return false;
  }

  /** Before the physics step: wheels, engine, brakes, a hand keeping it upright (aircraft: `fly`). */
  drive(dt: number, input: DriveInput | null): void {
    if (this.remote || this.spec.fixed) return;
    if (this.flight) {
      this.fly(dt, input);
      return;
    }
    if (this.spec.boat && !this.controller) {
      this.sail(dt, input, true);
      return;
    }
    const c = this.controller!;
    const spec = this.spec;
    // A resting body sleeps; wheel forces alone don't wake it.
    if (input && (input.throttle !== 0 || input.steer !== 0) && this.body.isSleeping()) this.body.wakeUp();
    const fwdSpeed = this.forwardSpeed();
    const throttle = this.wrecked || !input ? 0 : input.throttle;
    // Pressing against the motion brakes first, then reverses.
    const braking = !!input?.brake || (throttle !== 0 && Math.sign(throttle) !== Math.sign(fwdSpeed) && Math.abs(fwdSpeed) > 1);
    const force = braking ? 0 : engineForce(spec, throttle, fwdSpeed);
    // Less steering at speed, so it doesn't flip at full tilt.
    const steerIn = input && !this.wrecked ? input.steer : 0;
    const steer = steerIn * spec.steer * (1 - Math.min(0.6, Math.abs(fwdSpeed) / (spec.top * 1.6)));
    const idleBrake = !input || (throttle === 0 && !braking) ? spec.brake * 0.15 : 0;
    // Tracks slip sideways while turning (or the side grip would stop the hull turning).
    const sideGrip = spec.turnRate && steerIn !== 0 ? spec.grip * 0.15 : spec.grip;
    spec.wheels.forEach((w, i) => {
      if (spec.turnRate) c.setWheelSideFrictionStiffness(i, sideGrip);
      c.setWheelSteering(i, w.steer ? -steer : 0);
      c.setWheelEngineForce(i, w.drive ? -force : 0);
      c.setWheelBrake(i, braking ? spec.brake : idleBrake);
    });
    c.updateVehicle(dt, undefined, groups(0xffff, Layer.WORLD));
    // Tracks: turn on the spot by turning the hull (reversing swaps the turn, like a car).
    if (spec.turnRate && spec.wheels.some((_, i) => c.wheelIsInContact(i))) {
      const ang = this.body.angvel();
      const want = -steerIn * spec.turnRate * (fwdSpeed < -0.5 ? -1 : 1);
      this.body.setAngvel({ x: ang.x, y: want, z: ang.z }, true);
    }
    this.stabilize(dt);
    // Amphibians float too; their water drive works once no wheel touches the bottom.
    if (this.spec.boat) {
      let touching = false;
      for (let i = 0; i < spec.wheels.length; i++) if (c.wheelIsInContact(i)) touching = true;
      this.sail(dt, input, !touching);
    }
  }

  /**
   * Boats: each float pushes up by how deep it is under the waves (stiff
   * enough to sit `draft` deep at rest) and is damped up and down; the water
   * drags the hull little along it and hard across it (the keel); the
   * propeller pushes at the stern and the rudder turns it by how fast water
   * runs past, both only while the stern is in the water. On dry ground it
   * is just a heavy box. Same numbers in the driver's browser and on the server.
   */
  private sail(dt: number, input: DriveInput | null, propel: boolean): void {
    const b = this.spec.boat!;
    const level = this.water;
    if (!level) return;
    const body = this.body;
    if (input && (input.throttle !== 0 || input.steer !== 0) && body.isSleeping()) body.wakeUp();
    const m = this.spec.mass;
    const ship = this.ship;
    // Water inside, or going down: less lift. A submarine dives by sitting deeper.
    const k = ((ship?.lift ?? 1) * m * 9.81) / (b.floats.length * b.draft);
    const dive = ship?.depth ?? 0;
    if (ship) {
      // The helm steps the telegraph (nobody at the helm: all stop).
      if (input) ship.helm(input.throttle, !!input.brake);
      else ship.set(1);
    }
    const pos = this.pos;
    const q = this.quat;
    const lin = body.linvel();
    const ang = body.angvel();
    const p = this.tmpBoatP;
    const r = this.tmpBoatR;
    const v = this.tmpBoatV;
    let wet = 0;
    for (const f of b.floats) {
      p.set(f[0], f[1], f[2]).applyQuaternion(q);
      r.copy(p);
      p.add(pos);
      const surface = level(p.x, p.z) - dive;
      if (!(surface > p.y)) continue;
      wet++;
      const depth = Math.min(surface - p.y, b.draft * 3);
      // Velocity of this point: linear + angular x r.
      v.set(lin.x + ang.y * r.z - ang.z * r.y, lin.y + ang.z * r.x - ang.x * r.z, lin.z + ang.x * r.y - ang.y * r.x);
      const up = (k * depth - b.drag[2] * v.y) * dt;
      body.applyImpulseAtPoint({ x: 0, y: up, z: 0 }, p, true);
    }
    if (!wet) return;
    const share = wet / b.floats.length;
    // Drag in the hull's frame: along, across.
    const fwd = this.tmpBoatF.set(0, 0, -1).applyQuaternion(q);
    fwd.y = 0;
    fwd.normalize();
    const side = this.tmpBoatS.set(-fwd.z, 0, fwd.x);
    const along = lin.x * fwd.x + lin.z * fwd.z;
    const across = lin.x * side.x + lin.z * side.z;
    const dragAlong = -(b.drag[0] * along + b.drag[0] * 0.25 * along * Math.abs(along)) * share * dt;
    const dragAcross = -b.drag[1] * across * share * dt;
    body.applyImpulse({ x: fwd.x * dragAlong + side.x * dragAcross, y: 0, z: fwd.z * dragAlong + side.z * dragAcross }, true);
    body.applyTorqueImpulse({ x: 0, y: -b.yawDrag * ang.y * share * dt, z: 0 }, true);
    // Propeller and rudder at the stern, under water.
    const stern = this.tmpBoatP.set(0, -this.spec.half[1], b.stern).applyQuaternion(q).add(pos);
    const sternWet = level(stern.x, stern.z) - dive > stern.y - 0.1;
    if (!propel || !sternWet || this.wrecked || !input) return;
    const throttle = ship ? ship.throttle : input.throttle;
    const top = ship ? ship.topSpeed((kind) => this.manned(kind)) : (b.waterTop ?? this.spec.top);
    const push = throttle > 0 ? (along < top ? throttle * b.thrust : 0) : -along < this.spec.reverse ? throttle * b.thrust * b.reverse : 0;
    body.applyImpulseAtPoint({ x: fwd.x * push * dt, y: 0, z: fwd.z * push * dt }, stern, true);
    // Turning: by water speed past the rudder, a little from the propeller's wash at a standstill.
    const flow = Math.abs(along) + Math.abs(throttle) * 2.5;
    const yawTorque = -input.steer * b.rudder * flow * Math.sign(along >= -0.5 ? 1 : -1) * dt;
    body.applyTorqueImpulse({ x: 0, y: yawTorque, z: 0 }, true);
  }
  /** The sea and rivers under a boat (`WaterMap.levelAt`: NaN on dry ground), set by its world. */
  water: ((x: number, z: number) => number) | null = null;
  private readonly tmpBoatP = new THREE.Vector3();
  private readonly tmpBoatR = new THREE.Vector3();
  private readonly tmpBoatV = new THREE.Vector3();
  private readonly tmpBoatF = new THREE.Vector3();
  private readonly tmpBoatS = new THREE.Vector3();

  /**
   * Keeps it from rolling over (strongly for the bike, which balances on
   * paired wheels): a torque back toward upright about the forward axis.
   */
  private stabilize(dt: number): void {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
    const right = new THREE.Vector3().crossVectors(fwd, up);
    const roll = Math.asin(THREE.MathUtils.clamp(-right.y, -1, 1));
    const ang = this.body.angvel();
    const rollRate = ang.x * fwd.x + ang.y * fwd.y + ang.z * fwd.z;
    const k = this.kind === 'bike' ? 14 : 3;
    const torque = (-roll * k - rollRate * (this.kind === 'bike' ? 3 : 1)) * this.spec.mass * dt;
    // Only when it is tipping: a vehicle on its roof stays there.
    if (up.y > 0.2) this.body.applyTorqueImpulse({ x: fwd.x * torque, y: fwd.y * torque, z: fwd.z * torque }, true);
  }

  /**
   * Aircraft: turns toward where the pilot looks (A/D add yaw), W/S set the
   * throttle; climbing costs speed, diving gains it, too slow and the nose
   * drops. Hitting anything solid wrecks it; a wreck falls. Past the edge of
   * the air space it turns back to the centre by itself.
   */
  private fly(dt: number, input: DriveInput | null): void {
    const f = this.flight!;
    const spec = this.spec.flight!;
    // A carrier plane: rolling on a carrier's deck, or brought down onto one by the landing aid.
    if (this.spec.plane && !this.crashed) {
      if (!this.deck && !this.wrecked) this.catchDeck();
      if (this.deck) {
        this.rollOnDeck(dt, input);
        if (this.deck) return;
      }
      if (!this.wrecked && this.landingAid(dt, input)) return;
    }
    const piloted = !!input && !this.wrecked;
    let wantYaw = input?.aimYaw ?? f.yaw;
    let wantPitch = THREE.MathUtils.clamp(input?.aimPitch ?? (piloted ? 0 : -0.25), -1.2, 1.2);
    if (!piloted) wantPitch = this.wrecked ? -0.9 : -0.25;
    // Air space edge: head for the centre. Outside the playable area, stay above the scenery hills.
    const c = this.airCenter;
    const out = Math.hypot(this.pos.x - c.x, this.pos.z - c.z);
    f.turningBack = out > this.airRadius + AIRSPACE.margin;
    if (f.turningBack) wantYaw = Math.atan2(-(c.x - this.pos.x), -(c.z - this.pos.z));
    // The floor rises from just inside the edge, so a plane leaving low is already climbing.
    const floorY = c.y + AIRSPACE.outsideAlt * THREE.MathUtils.clamp((out - this.airRadius + 80) / 160, 0, 1);
    if (this.pos.y < floorY && !this.wrecked) wantPitch = Math.max(wantPitch, THREE.MathUtils.clamp((floorY - this.pos.y) * 0.015, 0.15, 0.7));
    if (piloted) f.throttle = THREE.MathUtils.clamp(f.throttle + input.throttle * dt * 0.7, 0, 1);
    // Turn toward the wanted heading and pitch at the turn rate (less when slow).
    const authority = spec.turn * THREE.MathUtils.clamp(f.speed / spec.minSpeed, 0.3, 1);
    const dYaw = Math.atan2(Math.sin(wantYaw - f.yaw), Math.cos(wantYaw - f.yaw));
    const yawRate = THREE.MathUtils.clamp(dYaw * 2, -authority, authority) + (piloted ? input.steer * -0.5 * authority : 0);
    f.yaw += yawRate * dt;
    f.pitch += THREE.MathUtils.clamp((wantPitch - f.pitch) * 2, -authority, authority) * dt;
    // Too slow: the nose drops.
    if (f.speed < spec.minSpeed * 0.85) f.pitch -= dt * 0.6;
    f.pitch = THREE.MathUtils.clamp(f.pitch, -1.35, 1.35);
    f.roll += (THREE.MathUtils.clamp(-yawRate / Math.max(0.1, spec.turn), -1, 1) * 1.1 - f.roll) * Math.min(1, dt * 3);
    // Speed: throttle, plus gravity along the flight path.
    const target = spec.minSpeed + (spec.maxSpeed - spec.minSpeed) * f.throttle;
    f.speed += THREE.MathUtils.clamp(target - f.speed, -spec.accel, spec.accel) * dt * 0.6 - Math.sin(f.pitch) * 9.8 * dt * 0.7;
    f.speed = THREE.MathUtils.clamp(f.speed, spec.minSpeed * 0.5, spec.maxSpeed * 1.3);
    const dir = new THREE.Vector3(-Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), -Math.cos(f.yaw) * Math.cos(f.pitch));
    this.velocity.copy(dir).multiplyScalar(f.speed);
    if (this.wrecked) this.velocity.y -= 12;
    const step = this.velocity.clone().multiplyScalar(dt);
    const len = step.length();
    const next = this.pos.clone().add(step);
    // Crash: anything solid along the way (with a little reach for the nose).
    if (!this.crashed && len > 0) {
      const hit = this.physics.raycast(this.pos, step.clone().divideScalar(len), len + this.spec.half[2] * 0.6, Layer.WORLD, undefined, this.clearOf?.body);
      if (hit) {
        this.health = 0;
        this.crashed = true;
        next.set(hit.point.x, hit.point.y + this.spec.half[1], hit.point.z);
      }
      // Into the sea (it is no collider): down for good.
      const level = this.water?.(next.x, next.z) ?? NaN;
      if (!this.crashed && Number.isFinite(level) && next.y - this.spec.half[1] * 0.6 < level) {
        this.health = 0;
        this.crashed = true;
        next.y = level;
      }
    }
    if (this.crashed) {
      next.copy(this.pos);
      this.velocity.set(0, 0, 0);
    }
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.pitch, f.yaw, f.roll, 'YXZ'));
    this.body.setNextKinematicTranslation(next);
    this.body.setNextKinematicRotation(q);
  }
  /** Came down on something (stays put as a wreck). */
  crashed = false;

  /** A carrier plane on a carrier's deck: where on it (carrier frame), heading on it, rolling speed, the wires holding it. */
  deck: { carrier: Vehicle; x: number; z: number; yaw: number; speed: number; arrest: boolean } | null = null;
  /** The carriers a plane may land on (set by its world). */
  carriers: (() => readonly Vehicle[]) | null = null;
  /** Just off a carrier's bow: its hull doesn't count as something to crash into for a moment. */
  private clearOf: Vehicle | null = null;
  private clearUntil = 0;
  private flyTime = 0;
  /** The landing aid has it (carrier, or null); waved off until (fly time). */
  approach: Vehicle | null = null;
  private waveOffUntil = 0;
  /** Seconds a plane has stood still on a carrier's deck (it is repaired and rearmed at `DECK.rearm`). */
  parkedFor = 0;

  /** Height of a plane's centre over the deck when its wheels are on it. */
  private get gear(): number {
    return this.spec.half[1] + 0.82;
  }

  private sideOf(c: Vehicle): boolean {
    const mine = this.team ?? this.home;
    const theirs = c.team ?? c.home;
    return !mine || !theirs || mine === theirs;
  }

  /** Puts a plane on `c`'s deck at (x, z) of its frame, facing `yaw` from its bow, standing. */
  parkOn(c: Vehicle, x: number, z: number, yaw = 0): void {
    this.deck = { carrier: c, x, z, yaw, speed: 0, arrest: false };
    const at = c.toWorld(new THREE.Vector3(x, c.spec.half[1] + this.gear, z), new THREE.Vector3());
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw).premultiply(c.quat);
    this.snap(at, q);
    this.velocity.copy(c.velocity);
    if (this.flight) {
      this.flight.yaw = c.yaw + yaw;
      this.flight.pitch = 0;
      this.flight.roll = 0;
      this.flight.speed = 0;
      this.flight.throttle = 0;
    }
  }

  /** Standing or rolling slowly on a friendly carrier's deck (put there from outside, or out of a seat): onto it. */
  private catchDeck(): void {
    for (const c of this.carriers?.() ?? []) {
      if (c.wrecked || !this.sideOf(c)) continue;
      const l = c.toLocal(this.tmpDeck.copy(this.pos));
      const [hx, hy, hz] = c.spec.half;
      const above = l.y - hy - this.gear;
      if (Math.abs(l.x) > hx - 0.5 || Math.abs(l.z) > hz - 1 || above < -0.6 || above > 2.5) continue;
      const rel = this.tmpDeck2.copy(this.velocity).sub(c.velocity);
      if (rel.length() > 12) continue;
      const fwd = this.tmpDeck.set(0, 0, -1).applyQuaternion(this.quat);
      const yaw = Math.atan2(Math.sin(Math.atan2(-fwd.x, -fwd.z) - c.yaw), Math.cos(Math.atan2(-fwd.x, -fwd.z) - c.yaw));
      this.deck = { carrier: c, x: l.x, z: l.z, yaw, speed: Math.max(0, rel.dot(fwd)), arrest: false };
      return;
    }
  }

  /**
   * On the deck: W rolls it toward the bow (the throttle up), it brakes by
   * itself otherwise (and hard on the wires after a landing), A/D turn it a
   * little; past the bow it flies, at its speed plus the carrier's (too slow
   * and it drops into the sea). The deck carries it.
   */
  private rollOnDeck(dt: number, input: DriveInput | null): void {
    const d = this.deck!;
    const c = d.carrier;
    const f = this.flight!;
    const spec = this.spec.flight!;
    if (c.wrecked) {
      this.deck = null;
      return;
    }
    const piloted = !!input && !this.wrecked;
    if (piloted) f.throttle = THREE.MathUtils.clamp(f.throttle + input.throttle * dt * 0.7, 0, 1);
    if (d.arrest) {
      d.speed = Math.max(0, d.speed - DECK.arrest * dt);
      if (d.speed === 0) d.arrest = false;
    } else if (piloted && f.throttle > 0.3) d.speed += DECK.accel * f.throttle * dt;
    else d.speed = Math.max(0, d.speed - DECK.brake * dt);
    if (piloted && d.speed > 0.5) d.yaw = THREE.MathUtils.clamp(d.yaw - input.steer * 0.35 * dt, -0.5, 0.5);
    else if (d.speed > 0.5) d.yaw *= Math.exp(-dt);
    d.x += -Math.sin(d.yaw) * d.speed * dt;
    d.z += -Math.cos(d.yaw) * d.speed * dt;
    const [hx, hy, hz] = c.spec.half;
    if (d.z > hz - 1) {
      d.z = hz - 1;
      d.speed = 0;
    }
    if (d.z < -hz || Math.abs(d.x) > hx) {
      // Off the bow (or the side): flying, or falling.
      const total = d.speed + c.forwardSpeed() * Math.cos(d.yaw);
      f.yaw = c.yaw + d.yaw;
      f.roll = 0;
      f.speed = total >= spec.minSpeed * 0.7 ? Math.max(spec.minSpeed, total) : total;
      f.pitch = total >= spec.minSpeed * 0.7 ? 0.1 : -0.15;
      this.deck = null;
      this.clearOf = c;
      this.clearUntil = this.flyTime + 3;
      this.parkedFor = 0;
      return;
    }
    // Where the deck will be after this step (the carrier moves on in it).
    const local = this.tmpDeck.set(d.x, hy + this.gear, d.z);
    const at = c.toWorld(local, this.tmpDeck2).addScaledVector(c.velocity, dt);
    const q = this.tmpDeckQ.setFromAxisAngle(UP, d.yaw).premultiply(c.quat);
    this.body.setNextKinematicTranslation(at);
    this.body.setNextKinematicRotation(q);
    const fwd = this.tmpDeck.set(-Math.sin(c.yaw + d.yaw), 0, -Math.cos(c.yaw + d.yaw));
    this.velocity.copy(c.velocity).addScaledVector(fwd, d.speed);
    f.yaw = c.yaw + d.yaw;
    f.pitch = 0;
    f.roll = 0;
    f.speed = d.speed;
    f.turningBack = false;
  }

  /**
   * The landing aid (plan section 3): a plane coming up behind a friendly
   * carrier's stern, lined up with it, low and not too fast, is flown down a
   * glide slope onto the deck and caught by the wires. Pulling up hard or
   * opening the throttle wide waves it off. True while it has the plane.
   */
  private landingAid(dt: number, input: DriveInput | null): boolean {
    this.flyTime += dt;
    if (this.clearOf && this.flyTime > this.clearUntil) this.clearOf = null;
    const f = this.flight!;
    if (this.flyTime < this.waveOffUntil) return false;
    let c = this.approach;
    if (c && (c.wrecked || !this.inCorridor(c, 1.3))) c = null;
    if (!c) for (const o of this.carriers?.() ?? []) if (!o.wrecked && this.sideOf(o) && this.inCorridor(o, 1)) c = o;
    if (c && !this.approach && this.clearOf === c) c = null;
    this.approach = c;
    if (!c) return false;
    if (input && ((input.aimPitch ?? 0) > 0.45 || (input.throttle > 0 && f.throttle > 0.95))) {
      this.approach = null;
      this.waveOffUntil = this.flyTime + 6;
      return false;
    }
    if (input) f.throttle = THREE.MathUtils.clamp(f.throttle + input.throttle * dt * 0.7, 0, 1);
    const [, hy, hz] = c.spec.half;
    const l = c.toLocal(this.tmpDeck.copy(this.pos));
    const touch = hz * 0.45;
    const cSpeed = c.forwardSpeed();
    // Slowing to an approach speed over the deck's.
    const rel = Math.max(18, f.speed - cSpeed - 12 * dt);
    l.z -= rel * dt;
    l.x *= Math.exp(-1.6 * dt);
    const want = hy + this.gear + Math.max(0, (l.z - touch) * DECK.slope);
    l.y += THREE.MathUtils.clamp(want - l.y, -6 * dt, 6 * dt);
    if (l.z <= touch && l.y <= hy + this.gear + 0.6) {
      this.deck = { carrier: c, x: l.x, z: l.z, yaw: 0, speed: rel, arrest: true };
      this.approach = null;
      return true;
    }
    const at = c.toWorld(l, this.tmpDeck2).addScaledVector(c.velocity, dt);
    f.yaw = c.yaw;
    f.pitch = -Math.atan(DECK.slope) * 0.5;
    f.roll *= Math.exp(-3 * dt);
    f.speed = rel + cSpeed;
    f.turningBack = false;
    const fwd = this.tmpDeck.set(-Math.sin(f.yaw), 0, -Math.cos(f.yaw));
    this.velocity.copy(fwd).multiplyScalar(f.speed);
    this.body.setNextKinematicTranslation(at);
    this.body.setNextKinematicRotation(this.tmpDeckQ.setFromEuler(new THREE.Euler(f.pitch, f.yaw, f.roll, 'YXZ')));
    return true;
  }

  /** Behind `c`'s stern, lined up, low and slow enough for the landing aid (`slack` widens it once it has the plane). */
  private inCorridor(c: Vehicle, slack: number): boolean {
    const f = this.flight!;
    const l = c.toLocal(this.tmpDeck.copy(this.pos));
    const [, hy, hz] = c.spec.half;
    const h = l.y - hy;
    if (l.z < hz * 0.45 - 5 || l.z > hz + DECK.approach * slack || Math.abs(l.x) > DECK.halfWidth * slack) return false;
    if (h < 0 || h > DECK.height * slack) return false;
    if (Math.abs(Math.atan2(Math.sin(f.yaw - c.yaw), Math.cos(f.yaw - c.yaw))) > 0.35 * slack) return false;
    return f.speed - c.forwardSpeed() < DECK.maxRel * slack;
  }

  /** On the deck long enough: repaired and rearmed. */
  rearm(): void {
    this.health = this.spec.health;
    for (const m of [...this.mounts, ...this.altMounts]) if (m) m.ammo = m.gun.ammo ?? Infinity;
  }

  /** Standing on a carrier's deck (for a plane moved from outside: by where it is and how it moves). */
  get parked(): boolean {
    if (this.deck) return this.deck.speed < 0.5;
    for (const c of this.carriers?.() ?? []) {
      if (c.wrecked) continue;
      const l = c.toLocal(this.tmpDeck.copy(this.pos));
      const [hx, hy, hz] = c.spec.half;
      if (Math.abs(l.x) < hx && Math.abs(l.z) < hz && Math.abs(l.y - hy - this.gear) < 1 && this.tmpDeck2.copy(this.velocity).sub(c.velocity).length() < 1.5) return true;
    }
    return false;
  }
  private readonly tmpDeck = new THREE.Vector3();
  private readonly tmpDeck2 = new THREE.Vector3();
  private readonly tmpDeckQ = new THREE.Quaternion();

  /** After the physics step. */
  afterStep(): void {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.readBody();
  }

  /**
   * Moved from outside (see `remote`): on (ground vehicles become kinematic,
   * pushed where they're put) or back to its own physics, keeping `velocity`.
   */
  setRemote(on: boolean): void {
    if (this.remote === on) return;
    this.remote = on;
    // A fixed weapon stays where it was built (a copy in a browser is put there once, by `snap`).
    if (this.spec.fixed) return;
    if (this.flight) {
      // Flying on by itself from where it was put: its heading from the hull.
      if (!on) this.flightFromQuat();
      return;
    }
    this.body.setBodyType(on ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
    if (!on) this.body.setLinvel(this.velocity, true);
  }

  /** A remote vehicle to `pos` / `quat` at the next physics step, moving at `vel`. */
  place(pos: THREE.Vector3, quat: THREE.Quaternion, vel: THREE.Vector3): void {
    if (this.spec.fixed) {
      this.velocity.set(0, 0, 0);
      return;
    }
    if (this.spec.deck) {
      // A ship people walk on is put there straight away: a kinematic body moved to a
      // next pose drags a character controller standing on it along now and then by
      // itself, while the people aboard are carried by the deck already (Player.ridePlatform).
      this.body.setTranslation(pos, true);
      this.body.setRotation(quat, true);
    } else {
      this.body.setNextKinematicTranslation(pos);
      this.body.setNextKinematicRotation(quat);
    }
    this.velocity.copy(vel);
  }

  /** Straight there (a remote vehicle first seen, or one that jumped): no blend from where it was. */
  snap(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.body.setTranslation(pos, true);
    this.body.setRotation(quat, true);
    this.pos.copy(pos);
    this.quat.copy(quat);
    this.prevPos.copy(pos);
    this.prevQuat.copy(quat);
  }

  /** An aircraft's heading, pitch and roll from how its hull is turned (its speed from its velocity). */
  flightFromQuat(): void {
    const f = this.flight;
    if (!f) return;
    const e = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ');
    f.yaw = e.y;
    f.pitch = e.x;
    f.roll = e.z;
    const speed = this.velocity.length();
    if (speed > 1) f.speed = speed;
  }

  private readBody(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.pos.set(t.x, t.y, t.z);
    this.quat.set(r.x, r.y, r.z, r.w);
    // Aircraft keep the velocity they flew with (a kinematic body reports none); remote ones what they were given.
    if (this.flight || this.remote) return;
    const v = this.body.linvel();
    this.velocity.set(v.x, v.y, v.z);
  }

  /** World position of a point in the vehicle frame (interpolated with `alpha`, 1 = latest step). */
  toWorld(local: THREE.Vector3, out: THREE.Vector3, alpha = 1): THREE.Vector3 {
    const q = alpha >= 1 ? this.quat : this.tmpQ.slerpQuaternions(this.prevQuat, this.quat, alpha);
    const p = alpha >= 1 ? this.pos : this.tmpP.lerpVectors(this.prevPos, this.pos, alpha);
    return out.copy(local).applyQuaternion(q).add(p);
  }
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpP = new THREE.Vector3();

  /** A world point in the vehicle frame (latest step), in place. */
  toLocal(world: THREE.Vector3): THREE.Vector3 {
    return world.sub(this.pos).applyQuaternion(this.tmpQ.copy(this.quat).invert());
  }

  /** Seat eye position in the world. */
  seatEye(i: number, out: THREE.Vector3, alpha = 1): THREE.Vector3 {
    // A dived submarine's helm looks through the periscope (its own spot is under water).
    if (this.ship?.dived && this.spec.seats[i]!.station?.kind === 'helm') {
      const p = this.spec.seats.findIndex((s) => s.station?.kind === 'periscope');
      if (p >= 0) i = p;
    }
    const e = this.spec.seats[i]!.eye;
    return this.toWorld(this.tmpLocal.set(e[0], e[1], e[2]), out, alpha);
  }
  private readonly tmpLocal = new THREE.Vector3();

  /** Render: place the model and turn the wheels and the gun. */
  syncModel(alpha: number): void {
    const root = this.model.root;
    root.position.lerpVectors(this.prevPos, this.pos, alpha);
    root.quaternion.slerpQuaternions(this.prevQuat, this.quat, alpha);
    const c = this.controller;
    const spec = this.spec;
    // Moved from outside (see `remote`), the wheels' suspension isn't run: each wheel reaches for the ground itself.
    const reach = c && this.remote && !this.farLook ? this.wheelReach(root.position, root.quaternion) : null;
    if (c) this.model.wheels.forEach((w, i) => {
      if (this.kind === 'bike' && i % 2 === 1) return;
      const sus = reach ? reach[i]! : (c.wheelSuspensionLength(i) ?? spec.suspension.rest);
      w.position.y = spec.wheels[i]!.pos[1] - sus;
      const rot = c.wheelRotation(i) ?? 0;
      this.wheelSpin[i] = rot;
      w.rotation.set(rot, spec.wheels[i]!.steer ? -(c.wheelSteering(i) ?? 0) : 0, 0, 'YXZ');
    });
    this.mounts.forEach((m, i) => {
      const n = this.model.mounts[i];
      if (!m || !n) return;
      if (n.turret) n.turret.rotation.y = m.yaw;
      if (n.gun) n.gun.rotation.x = m.pitch;
    });
  }

  /**
   * Suspension length per wheel for a vehicle placed from outside: a ray
   * down from each wheel's mount to the ground, as the wheel would rest
   * (fully out when nothing is under it).
   */
  private wheelReach(pos: THREE.Vector3, quat: THREE.Quaternion): number[] {
    const s = this.spec;
    const max = s.suspension.rest + s.suspension.travel;
    const down = this.tmpDown.set(0, -1, 0).applyQuaternion(quat);
    return s.wheels.map((w) => {
      const from = this.tmpLocal.set(w.pos[0], w.pos[1], w.pos[2]).applyQuaternion(quat).add(pos);
      const hit = this.physics.raycast(from, down, max + s.wheelRadius, Layer.WORLD, this.collider);
      return hit ? Math.max(0, Math.min(max, hit.distance - s.wheelRadius)) : s.suspension.rest;
    });
  }
  private readonly tmpDown = new THREE.Vector3();

  /** Where someone getting out of `seat` stands: beside it on the ground, else behind / in front, else on top. */
  exitSpot(seat: number, physics: PhysicsWorld): THREE.Vector3 {
    // A ship's station: back where one stood to man it.
    const st = this.spec.seats[seat]?.station;
    if (st) return this.toWorld(new THREE.Vector3(st.at[0], st.at[1] + 0.05, st.at[2]), new THREE.Vector3());
    const [hx, , hz] = this.spec.half;
    const seatZ = this.spec.seats[seat]!.eye[2];
    const sides = [
      [-(hx + 0.9), seatZ],
      [hx + 0.9, seatZ],
      [0, hz + 1.2],
      [0, -(hz + 1.2)],
    ] as const;
    // A landing craft: out over the ramp first. A ship with a deck: onto the deck by the seat.
    const seatX = this.spec.seats[seat]!.eye[0];
    const deck = this.spec.deck
      ? ([
          [seatX + 1.1, seatZ],
          [seatX - 1.1, seatZ],
          [seatX, seatZ + 1.6],
          [seatX, seatZ - 1.6],
        ] as const)
      : [];
    const tries = this.spec.boat?.bowExit ? [[0, -(hz + 1.4)], [-0.9, -(hz + 1.4)], [0.9, -(hz + 1.4)], ...sides] : [...deck, ...sides];
    const local = new THREE.Vector3();
    const at = new THREE.Vector3();
    for (let i = 0; i < tries.length; i++) {
      const [x, z] = tries[i]!;
      // Onto our own deck: from above it, the hull counts (elsewhere the ray ignores it: it starts inside).
      const onDeck = i < deck.length;
      this.toWorld(local.set(x, onDeck ? this.spec.half[1] + 1.2 : 0.5, z), at);
      const down = physics.raycast({ x: at.x, y: at.y + 1.5, z: at.z }, { x: 0, y: -1, z: 0 }, 5, Layer.WORLD, onDeck ? undefined : this.collider);
      if (!down || down.normal.y < 0.6) continue;
      const g = new THREE.Vector3(down.point.x, down.point.y, down.point.z);
      if (onDeck) {
        // Only the deck itself (or a part on it), not the sea bed past its side.
        const c = physics.world.getCollider(down.collider.handle);
        if (c?.parent()?.handle === this.body.handle) return g;
        continue;
      }
      // Nothing between the hull and the spot (the hull itself aside: the ray starts inside it).
      const dir = g.clone().setY(g.y + 0.9).sub(this.pos);
      const dist = dir.length();
      if (physics.raycast(this.pos, dir.divideScalar(dist), dist - 0.05, Layer.WORLD, undefined, this.body)) continue;
      return g;
    }
    return this.pos.clone().setY(this.pos.y + this.spec.half[1] + 0.3);
  }

  /** Gun spec of the seat that has one. */
  /**
   * Points a seat's gun at a world direction (yaw / pitch, as the view uses
   * them), within its traverse and elevation.
   */
  /**
   * Points a seat's gun toward a world yaw / pitch, within its traverse and
   * elevation; seats with a turn rate get there at that rate over `dt` s
   * (Infinity: at once).
   */
  aimMount(seat: number, worldYaw: number, worldPitch: number, dt = Infinity): void {
    const m = this.mounts[seat];
    const am = this.altMounts[seat];
    if (!m) return;
    const s = this.spec.seats[seat]!;
    // Bearings in the gun's own frame (0 = the way it faces on the hull: a ship's aft turret faces back).
    const f = s.facing ?? 0;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const fromFacing = (local: number) => (f === 0 ? local : wrap(local + f));
    const rel = wrap(worldYaw - this.yaw - f);
    const tr = s.traverse ?? Math.PI;
    const [lo, hi] = s.pitch ?? [-0.2, 0.6];
    const wantYaw = THREE.MathUtils.clamp(rel, -tr, tr);
    const wantPitch = THREE.MathUtils.clamp(worldPitch, lo, hi);
    if (s.turn && Number.isFinite(dt)) {
      // Stabilised (owner, 2026-10-14: tanks were too hard to handle): the gun keeps its
      // bearing while the hull turns under it, within its traverse; the turn rate is for aiming.
      const hull = this.yaw;
      let local = f === 0 ? m.yaw : wrap(m.yaw - f);
      if (m.hullYaw !== undefined) {
        const dh = Math.atan2(Math.sin(hull - m.hullYaw), Math.cos(hull - m.hullYaw));
        // A big jump is a gun nobody aimed for a while: no catching up on it.
        if (Math.abs(dh) < 0.3) local = tr >= Math.PI ? Math.atan2(Math.sin(local - dh), Math.cos(local - dh)) : THREE.MathUtils.clamp(local - dh, -tr, tr);
      }
      m.hullYaw = hull;
      // The short way round (a gun with all-round traverse), at the turn rate.
      let d = wantYaw - local;
      if (tr >= Math.PI) d = Math.atan2(Math.sin(d), Math.cos(d));
      const maxY = s.turn * dt;
      local += THREE.MathUtils.clamp(d, -maxY, maxY);
      if (tr >= Math.PI) local = Math.atan2(Math.sin(local), Math.cos(local));
      else local = THREE.MathUtils.clamp(local, -tr, tr);
      m.yaw = fromFacing(local);
      const maxP = (s.elevate ?? s.turn) * dt;
      m.pitch += THREE.MathUtils.clamp(wantPitch - m.pitch, -maxP, maxP);
    } else {
      m.yaw = fromFacing(wantYaw);
      m.pitch = wantPitch;
    }
    if (am) {
      am.yaw = m.yaw;
      am.pitch = m.pitch;
    }
  }

  /** Where a seat's gun points in the world: yaw (0 = -z) and pitch, or null without one. */
  mountAim(seat: number): { yaw: number; pitch: number } | null {
    const m = this.mounts[seat];
    return m ? { yaw: this.yaw + m.yaw, pitch: m.pitch } : null;
  }

  /** World position of a seat's muzzle (after the last render), or its eye. */
  muzzleOf(seat: number, out: THREE.Vector3): THREE.Vector3 {
    const n = this.model.mounts[seat];
    return n?.muzzle ? n.muzzle.getWorldPosition(out) : this.seatEye(seat, out);
  }

  /**
   * Trigger on a seat's gun this step: true when a round goes now (rate of
   * fire, heat for the MGs, reload for the shell guns).
   */
  pullTrigger(seat: number, firing: boolean, time: number, dt: number, alt = false): boolean {
    const m = (alt ? this.altMounts : this.mounts)[seat];
    if (!m) return false;
    const g = m.gun;
    if (m.overheated || !firing) m.heat = Math.max(0, m.heat - dt / g.cool);
    if (m.overheated && m.heat <= 0) m.overheated = false;
    if (!firing || m.overheated || time < m.nextShot || m.ammo <= 0) return false;
    m.nextShot = time + 60 / g.rpm;
    m.ammo--;
    if (!alt) this.seatShots[seat] = (this.seatShots[seat]! + 1) & 0xff;
    if (g.burst > 1) {
      m.heat += 1 / g.burst;
      if (m.heat >= 1) m.overheated = true;
    }
    return true;
  }

  /** 0..1 of a shell gun's reload left (0 = ready). */
  reloadLeft(seat: number, time: number, alt = false): number {
    const m = (alt ? this.altMounts : this.mounts)[seat];
    if (!m) return 0;
    if (m.overheated && m.gun.burst > 1 && m.gun.shell) return m.heat;
    if (!m.gun.shell) return 0;
    return Math.max(0, (m.nextShot - time) / (60 / m.gun.rpm));
  }

  dispose(): void {
    const world = this.physics.world;
    if (this.controller) world.removeVehicleController(this.controller);
    this.physics.untrackOccluder(this.collider);
    for (const c of this.parts) this.physics.untrackOccluder(c);
    world.removeRigidBody(this.body);
  }
}
