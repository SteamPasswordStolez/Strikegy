import * as THREE from 'three';
import type { HitPart } from '@/core/events';
import type { Damageable, DamageKind, DamageSource } from '@/combat/Hitboxes';
import { Layer, RAPIER, groups, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { Team } from '@/world/mapTypes';
import { VEHICLES, VEHICLE_GUNS, engineForce, vehicleDamage, type VehicleGunId, type VehicleGunSpec, type VehicleKind, type VehicleSpec } from './vehicleData';
import { buildVehicleModel, type VehicleModel } from './vehicleModels';

/** Driving input for one step: throttle and steering -1..1, handbrake. */
export interface DriveInput {
  throttle: number;
  steer: number;
  brake: boolean;
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
  private readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly seats: (Occupant | null)[];
  health: number;
  /** Destroyed: a burning wreck until `removeAt`. */
  wrecked = false;
  removeAt = Infinity;
  /** Last time anyone sat in it (abandoned vehicles are cleared away). */
  usedAt = 0;
  /** Guns by seat (null for seats without one). */
  readonly mounts: (Mount | null)[];
  /** Interpolation: transforms before and after the last sim step. */
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  /** Who last hurt it (credited if it blows up). */
  lastHurtBy: DamageSource | null = null;
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
    this.mounts = spec.seats.map((s, seat) => (s.gun ? { seat, id: s.gun, gun: VEHICLE_GUNS[s.gun], yaw: 0, pitch: 0, heat: 0, overheated: false, nextShot: 0 } : null));
    this.wheelSpin = spec.wheels.map(() => 0);
    const world = physics.world;
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
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
        .setCollisionGroups(groups(Layer.WORLD | Layer.HITBOX, Layer.WORLD | Layer.BOUNDS)),
      this.body,
    );
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

  /** Signed speed along the hull's forward axis (m/s). */
  forwardSpeed(): number {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
    return this.velocity.dot(fwd);
  }

  get yaw(): number {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
    return Math.atan2(-f.x, -f.z);
  }

  applyDamage(amount: number, part: HitPart, source?: DamageSource, kind: DamageKind = 'bullet'): boolean {
    void part;
    if (this.wrecked) return false;
    const dmg = vehicleDamage(this.kind, amount, kind);
    if (dmg <= 0) return false;
    this.health -= dmg;
    if (source) this.lastHurtBy = source;
    // A vehicle is never reported as a kill itself (its crew is).
    return false;
  }

  /** Before the physics step: wheels, engine, brakes, a hand keeping it upright. */
  drive(dt: number, input: DriveInput | null): void {
    const c = this.controller;
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
  }

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

  /** After the physics step. */
  afterStep(): void {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.readBody();
  }

  private readBody(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    const v = this.body.linvel();
    this.pos.set(t.x, t.y, t.z);
    this.quat.set(r.x, r.y, r.z, r.w);
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

  /** Seat eye position in the world. */
  seatEye(i: number, out: THREE.Vector3, alpha = 1): THREE.Vector3 {
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
    this.model.wheels.forEach((w, i) => {
      if (this.kind === 'bike' && i % 2 === 1) return;
      const sus = c.wheelSuspensionLength(i) ?? spec.suspension.rest;
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

  /** Where someone getting out of `seat` stands: beside it on the ground, else behind / in front, else on top. */
  exitSpot(seat: number, physics: PhysicsWorld): THREE.Vector3 {
    const [hx, , hz] = this.spec.half;
    const seatZ = this.spec.seats[seat]!.eye[2];
    const tries = [
      [-(hx + 0.9), seatZ],
      [hx + 0.9, seatZ],
      [0, hz + 1.2],
      [0, -(hz + 1.2)],
    ] as const;
    const local = new THREE.Vector3();
    const at = new THREE.Vector3();
    for (const [x, z] of tries) {
      this.toWorld(local.set(x, 0.5, z), at);
      const down = physics.raycast({ x: at.x, y: at.y + 1.5, z: at.z }, { x: 0, y: -1, z: 0 }, 5, Layer.WORLD, this.collider);
      if (!down || down.normal.y < 0.6) continue;
      const g = new THREE.Vector3(down.point.x, down.point.y, down.point.z);
      if (physics.blocked(this.pos, g.clone().setY(g.y + 0.9), Layer.WORLD)) continue;
      return g;
    }
    return this.pos.clone().setY(this.pos.y + this.spec.half[1] + 0.3);
  }

  /** Gun spec of the seat that has one. */
  /**
   * Points a seat's gun at a world direction (yaw / pitch, as the view uses
   * them), within its traverse and elevation.
   */
  aimMount(seat: number, worldYaw: number, worldPitch: number): void {
    const m = this.mounts[seat];
    if (!m) return;
    const s = this.spec.seats[seat]!;
    const rel = Math.atan2(Math.sin(worldYaw - this.yaw), Math.cos(worldYaw - this.yaw));
    const tr = s.traverse ?? Math.PI;
    m.yaw = THREE.MathUtils.clamp(rel, -tr, tr);
    const [lo, hi] = s.pitch ?? [-0.2, 0.6];
    m.pitch = THREE.MathUtils.clamp(worldPitch, lo, hi);
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
  pullTrigger(seat: number, firing: boolean, time: number, dt: number): boolean {
    const m = this.mounts[seat];
    if (!m) return false;
    const g = m.gun;
    if (m.overheated || !firing) m.heat = Math.max(0, m.heat - dt / g.cool);
    if (m.overheated && m.heat <= 0) m.overheated = false;
    if (!firing || m.overheated || time < m.nextShot) return false;
    m.nextShot = time + 60 / g.rpm;
    if (g.burst > 1) {
      m.heat += 1 / g.burst;
      if (m.heat >= 1) m.overheated = true;
    }
    return true;
  }

  /** 0..1 of a shell gun's reload left (0 = ready). */
  reloadLeft(seat: number, time: number): number {
    const m = this.mounts[seat];
    if (!m || !m.gun.shell) return 0;
    return Math.max(0, (m.nextShot - time) / (60 / m.gun.rpm));
  }

  dispose(): void {
    const world = this.physics.world;
    world.removeVehicleController(this.controller);
    world.removeRigidBody(this.body);
  }
}
