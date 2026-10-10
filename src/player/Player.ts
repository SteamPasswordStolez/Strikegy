import * as THREE from 'three';
import { Layer, RAPIER, groups, type Ladder, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { GameBus } from '@/core/events';
import type { InputState } from '@/input/InputState';
import type { ImpactSurface, SurfaceRegistry } from '@/physics/surfaces';
import { Health } from './health';
import {
  MOVE,
  approachVelocity,
  capsuleHalfHeight,
  targetSpeed,
  wishDirection,
  SLIDE,
} from './movement';
import { WADE_DEPTH, WADE_SPEED, type WaterMap } from '@/world/water';

const MAX_PITCH = (89 * Math.PI) / 180;
/**
 * Ladders: climbed at `speed` m/s, standing `off` m out from the rungs; taken
 * from `reach` m away (horizontally) by walking at them, facing them within
 * `face` (cosine); at the top the climber steps `onto` m onto the deck.
 */
const CLIMB = { speed: 2.6, off: 0.55, reach: 0.85, face: 0.35, onto: 0.95 };
/** Meters travelled per footstep sound. */
const STRIDE = { walk: 1.9, sprint: 2.5, crouch: 1.5 };

/**
 * First-person player: kinematic capsule driven by Rapier's character
 * controller. Position is the feet point; look angles are applied per render
 * frame for responsiveness while movement runs on the fixed sim step.
 */
export class Player {
  yaw = 0;
  pitch = 0;
  readonly feet = new THREE.Vector3();
  readonly prevFeet = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  grounded = false;
  crouching = false;
  /** Crouch toggled on from the keyboard (Ctrl / C); touch sends its own toggle state. */
  private crouchLatched = false;
  /** Time left in a slide (s); 0 = not sliding. */
  private slideLeft = 0;
  /** Sprint key held last step (a fresh press stands up from a crouch; holding it through a slide doesn't). */
  private sprintHeld = false;
  sprinting = false;
  /** Rivers on the map (wading slows the player), set by the game. */
  water: WaterMap | null = null;
  /** Class passives (set by the game each step): speed multiplier and how much of the wading slowdown applies. */
  speedBonus = 1;
  wadePenalty = 1;
  readonly health = new Health();
  private strideLeft: number = STRIDE.walk / 2;
  private jumpBuffered = 0;
  private sinceGrounded = 0;
  /** Called on a hard landing with the impact speed (m/s); the soldier takes fall damage from it. */
  onLanded: ((impactSpeed: number) => void) | null = null;
  /** Smoothed eye height above feet (render side). */
  eyeHeight: number = MOVE.standHeight - MOVE.eyeInset;

  readonly collider: RAPIER.Collider;
  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.KinematicCharacterController;
  private height: number = MOVE.standHeight;
  /** The ladder being climbed (null: on foot). */
  private ladder: Ladder | null = null;
  /** -1 while forward is still held from stepping onto the ladder at its top (it climbs down until let go). */
  private climbSign = 1;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly bus: GameBus,
    private readonly surfaces: SurfaceRegistry,
    spawn: THREE.Vector3,
    yaw: number,
  ) {
    const world = physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(capsuleHalfHeight(this.height), MOVE.radius).setCollisionGroups(
        groups(Layer.PLAYER, Layer.WORLD),
      ),
      this.body,
    );
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.45, 0.2, false);
    this.controller.enableSnapToGround(0.35);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.teleport(spawn, yaw);
  }

  /** Takes the capsule out of the world (a player left). */
  dispose(): void {
    const world = this.physics.world;
    world.removeCharacterController(this.controller);
    world.removeRigidBody(this.body);
  }

  get alive(): boolean {
    return this.health.alive;
  }

  teleport(feet: THREE.Vector3, yaw: number): void {
    // Start a hair above the target: a capsule placed exactly on (or in) the floor
    // can slip through it; snap-to-ground settles it within a frame.
    this.feet.copy(feet).setY(feet.y + 0.05);
    this.prevFeet.copy(this.feet);
    this.velocity.set(0, 0, 0);
    this.crouchLatched = false;
    this.slideLeft = 0;
    this.ladder = null;
    this.yaw = yaw;
    this.pitch = 0;
    this.body.setTranslation(this.centerFromFeet(), true);
  }

  /** Shifts the body by an offset, keeping its motion (the game server corrected where it is). */
  nudge(dx: number, dy: number, dz: number): void {
    this.feet.x += dx;
    this.feet.y += dy;
    this.feet.z += dz;
    this.prevFeet.x += dx;
    this.prevFeet.y += dy;
    this.prevFeet.z += dz;
    this.body.setTranslation(this.centerFromFeet(), true);
  }

  /**
   * Riding a vehicle: no capsule (the vehicle carries the player), feet put
   * under the seat each step, moving with it.
   */
  ride(eye: THREE.Vector3, velocity: THREE.Vector3): void {
    if (this.collider.isEnabled()) this.collider.setEnabled(false);
    this.prevFeet.copy(this.feet);
    this.feet.copy(eye).setY(eye.y - this.eyeHeight);
    this.velocity.copy(velocity);
    this.grounded = true;
    this.sprinting = false;
  }

  /** Off the vehicle: capsule back, standing at `feet`. */
  dismount(feet: THREE.Vector3): void {
    this.collider.setEnabled(true);
    const yaw = this.yaw;
    const pitch = this.pitch;
    this.teleport(feet, yaw);
    this.pitch = pitch;
  }

  /** Called every render frame with accumulated look deltas (radians). */
  applyLook(dYaw: number, dPitch: number): void {
    this.yaw = (this.yaw + dYaw) % (Math.PI * 2);
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
  }

  /** On a ladder. */
  get climbing(): boolean {
    return this.ladder !== null;
  }

  step(dt: number, input: InputState, ads: boolean, firing: boolean): void {
    this.prevFeet.copy(this.feet);
    if (this.ladder || this.takeLadder(input)) {
      this.stepLadder(dt, input);
      this.body.setNextKinematicTranslation(this.centerFromFeet());
      this.health.step(dt);
      return;
    }
    const wasSprinting = this.sprinting;
    if (input.crouchToggle) this.crouchLatched = !this.crouchLatched;
    let jump = input.jump;
    if (this.crouchLatched && !this.sliding) {
      // Sprinting or jumping from a crouch stands up first (the jump press only stands).
      if (input.sprint && !this.sprintHeld && input.moveY > 0.5 && !input.crouchToggle) this.crouchLatched = false;
      if (jump) {
        this.crouchLatched = false;
        jump = false;
      }
    }
    this.sprintHeld = input.sprint;
    const wantCrouch = this.crouchLatched || input.crouch;
    // Crouching out of a sprint slides.
    if (wantCrouch && !this.crouching && wasSprinting && this.grounded && this.horizontalSpeed() > SLIDE.minSpeed) this.startSlide();
    this.updateCrouch(wantCrouch);
    if (this.sliding && (!this.crouching || !wantCrouch)) this.slideLeft = 0;

    const moving = input.moveX !== 0 || input.moveY !== 0;
    this.sprinting = input.sprint && input.moveY > 0.5 && !ads && !firing && !this.crouching;
    const speed = targetSpeed({
      moveX: input.moveX,
      moveY: input.moveY,
      sprint: this.sprinting,
      crouching: this.crouching,
      ads,
    });
    // Wading: knee-deep water slows everyone down.
    const wading = !!this.water && this.water.depthAt(this.feet.x, this.feet.y, this.feet.z) > WADE_DEPTH;
    const [wx, wz] = moving ? wishDirection(input.moveX, input.moveY, this.yaw) : [0, 0];
    // Brake harder than we accelerate: releasing or reversing input stops crisply.
    const braking = !moving || wx * this.velocity.x + wz * this.velocity.z < 0;
    const accel = this.grounded ? (braking ? MOVE.groundDecel : MOVE.groundAccel) : MOVE.airAccel;
    const top = speed * this.speedBonus * (wading ? 1 - (1 - WADE_SPEED) * this.wadePenalty : 1);
    if (this.sliding) this.stepSlide(dt, wx, wz);
    else {
      const [vx, vz] = approachVelocity(this.velocity.x, this.velocity.z, wx * top, wz * top, accel, dt);
      this.velocity.x = vx;
      this.velocity.z = vz;
    }

    if (jump) this.jumpBuffered = MOVE.jumpBuffer;
    this.jumpBuffered = Math.max(0, this.jumpBuffered - dt);
    this.sinceGrounded = this.grounded ? 0 : this.sinceGrounded + dt;
    const canJump = this.sinceGrounded <= MOVE.coyoteTime && this.velocity.y <= 0.1;
    if (this.jumpBuffered > 0 && canJump && !this.crouching) {
      this.velocity.y = MOVE.jumpVelocity;
      this.grounded = false;
      this.jumpBuffered = 0;
      this.sinceGrounded = MOVE.coyoteTime + 1;
    } else {
      this.velocity.y = Math.max(this.velocity.y - MOVE.gravity * dt, -MOVE.maxFallSpeed);
    }

    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    const filter = groups(0xffff, Layer.WORLD | Layer.PLAYER | Layer.BOT | Layer.BOUNDS);
    this.controller.computeColliderMovement(this.collider, desired, undefined, filter);
    let moved = this.controller.computedMovement();
    if (this.grounded && desired.y <= 0 && this.snaggedOnFloor(desired, moved)) {
      // Rapier occasionally stops a grounded capsule dead on flat ground (a
      // contact at time 0 with an upward normal). Moving level gets through.
      this.controller.computeColliderMovement(this.collider, { x: desired.x, y: 0, z: desired.z }, undefined, filter);
      moved = this.controller.computedMovement();
    }
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();

    // Use the collision-corrected displacement so walls kill velocity naturally.
    this.velocity.x = moved.x / dt;
    this.velocity.z = moved.z / dt;
    if (this.grounded && this.velocity.y < 0) {
      if (!wasGrounded && this.velocity.y < -7) {
        this.bus.emit('player:landed', { impactSpeed: -this.velocity.y, surface: this.groundSurface() });
        this.onLanded?.(-this.velocity.y);
      }
      this.velocity.y = 0;
    } else if (desired.y > 0 && moved.y < desired.y * 0.5) {
      this.velocity.y = 0; // bonked a ceiling
    }

    this.feet.x += moved.x;
    this.feet.y += moved.y;
    this.feet.z += moved.z;
    this.body.setNextKinematicTranslation(this.centerFromFeet());
    this.health.step(dt);
    this.stepFootsteps(Math.hypot(moved.x, moved.z));
  }

  /**
   * Walking at a ladder takes it: from below (facing it, at its foot or part
   * way up), or from the deck at its top (facing out over the gap).
   */
  private takeLadder(input: InputState): boolean {
    if (input.moveY <= 0.2 || !this.collider.isEnabled()) return false;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    for (const l of this.physics.ladders) {
      const cx = l.x + l.nx * CLIMB.off;
      const cz = l.z + l.nz * CLIMB.off;
      const facing = -(fx * l.nx + fz * l.nz);
      // From below / on the way up: at the climbing spot, facing the rungs.
      if (this.feet.y > l.bottom - 0.4 && this.feet.y < l.top - 0.3 && Math.hypot(this.feet.x - cx, this.feet.z - cz) < CLIMB.reach && facing > CLIMB.face) {
        this.ladder = l;
        this.climbSign = 1;
        return true;
      }
      // From the top: on the deck by the gap, walking out over it.
      const tx = l.x - l.nx * 0.5;
      const tz = l.z - l.nz * 0.5;
      if (Math.abs(this.feet.y - l.top) < 0.5 && Math.hypot(this.feet.x - tx, this.feet.z - tz) < 0.9 && facing < -CLIMB.face) {
        this.ladder = l;
        this.feet.set(cx, l.top - 0.9, cz);
        // Turn round to face the rungs; forward, still held, climbs down until let go.
        this.yaw = Math.atan2(l.nx, l.nz);
        this.climbSign = -1;
        return true;
      }
    }
    return false;
  }

  /** On a ladder: forward climbs, back climbs down, jump lets go; off at the top onto the deck, at the foot onto the ground. */
  private stepLadder(dt: number, input: InputState): void {
    const l = this.ladder!;
    this.updateCrouch(false);
    this.sprinting = false;
    this.slideLeft = 0;
    if (input.jump) {
      // Push off backwards.
      this.ladder = null;
      this.velocity.set(l.nx * 2.5, 2, l.nz * 2.5);
      this.grounded = false;
      return;
    }
    if (input.moveY <= 0.2) this.climbSign = 1;
    const vy = input.moveY * CLIMB.speed * this.climbSign;
    // Held to the climbing line.
    const cx = l.x + l.nx * CLIMB.off;
    const cz = l.z + l.nz * CLIMB.off;
    this.feet.x += (cx - this.feet.x) * Math.min(1, dt * 12);
    this.feet.z += (cz - this.feet.z) * Math.min(1, dt * 12);
    this.feet.y = Math.min(l.top, this.feet.y + vy * dt);
    this.velocity.set(0, vy, 0);
    this.grounded = false;
    if (vy > 0 && this.feet.y >= l.top - 0.3) {
      // Over the top: step onto the deck through the gap.
      this.feet.set(l.x - l.nx * CLIMB.onto, l.top + 0.12, l.z - l.nz * CLIMB.onto);
      this.prevFeet.copy(this.feet);
      this.velocity.set(0, 0, 0);
      this.ladder = null;
      this.grounded = true;
    } else if (vy < 0 && this.feet.y <= l.bottom + 0.02) {
      this.feet.y = l.bottom + 0.02;
      this.ladder = null;
      this.grounded = true;
    }
  }

  /** In a slide (sprint, then crouch). */
  get sliding(): boolean {
    return this.slideLeft > 0;
  }

  private startSlide(): void {
    const v = this.horizontalSpeed();
    const k = Math.max(v, SLIDE.speed) / v;
    this.velocity.x *= k;
    this.velocity.z *= k;
    this.slideLeft = SLIDE.time;
    this.bus.emit('player:slide', { surface: this.groundSurface(), point: this.feet.clone() });
  }

  /** Glides on, slowing down, steering a little toward the stick. */
  private stepSlide(dt: number, wx: number, wz: number): void {
    this.slideLeft = Math.max(0, this.slideLeft - dt);
    const v = this.horizontalSpeed();
    const slower = Math.max(0, v - (this.grounded ? SLIDE.friction : SLIDE.friction * 0.3) * dt);
    if (slower < SLIDE.endSpeed) this.slideLeft = 0;
    const k = v > 1e-3 ? slower / v : 0;
    this.velocity.x = this.velocity.x * k + wx * SLIDE.steer * dt;
    this.velocity.z = this.velocity.z * k + wz * SLIDE.steer * dt;
    // Steering turns the slide; it doesn't speed it up.
    const after = this.horizontalSpeed();
    if (after > slower && after > 1e-3) {
      this.velocity.x *= slower / after;
      this.velocity.z *= slower / after;
    }
  }

  /** Lost most of the horizontal move while only touching floor-like surfaces. */
  private snaggedOnFloor(desired: { x: number; z: number }, moved: { x: number; z: number }): boolean {
    const want = desired.x * desired.x + desired.z * desired.z;
    if (want < 1e-6 || moved.x * moved.x + moved.z * moved.z > want * 0.5) return false;
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const c = this.controller.computedCollision(i);
      if (!c || c.normal1.y < 0.7) return false;
    }
    return true;
  }

  /** Surface under the feet, or undefined when nothing is close below. */
  private groundSurface(): ImpactSurface | undefined {
    const from = { x: this.feet.x, y: this.feet.y + 0.2, z: this.feet.z };
    const hit = this.physics.raycast(from, { x: 0, y: -1, z: 0 }, 0.6, Layer.WORLD);
    return hit ? this.surfaces.get(hit.collider.handle, hit.point) : undefined;
  }

  private stepFootsteps(dist: number): void {
    if (!this.grounded || dist < 1e-4) return;
    this.strideLeft -= dist;
    if (this.strideLeft > 0) return;
    this.strideLeft += this.crouching ? STRIDE.crouch : this.sprinting ? STRIDE.sprint : STRIDE.walk;
    // Crouch-walking is silent.
    if (this.crouching) return;
    const surface = this.groundSurface();
    if (!surface) return;
    this.bus.emit('player:footstep', {
      surface,
      sprinting: this.sprinting,
      point: this.feet.clone(),
    });
  }

  private updateCrouch(wantCrouch: boolean): void {
    if (wantCrouch === this.crouching) return;
    if (!wantCrouch && !this.hasHeadroom()) return;
    this.crouching = wantCrouch;
    this.height = wantCrouch ? MOVE.crouchHeight : MOVE.standHeight;
    this.collider.setHalfHeight(capsuleHalfHeight(this.height));
    this.body.setTranslation(this.centerFromFeet(), true);
  }

  private hasHeadroom(): boolean {
    const clearance = MOVE.standHeight - MOVE.crouchHeight + 0.05;
    const from = { x: this.feet.x, y: this.feet.y + MOVE.crouchHeight - 0.05, z: this.feet.z };
    return !this.physics.raycast(from, { x: 0, y: 1, z: 0 }, clearance, Layer.WORLD);
  }

  private centerFromFeet(): { x: number; y: number; z: number } {
    return { x: this.feet.x, y: this.feet.y + this.height / 2, z: this.feet.z };
  }

  /** Render-side update: smooth eye height and write interpolated eye position. */
  eyePosition(alpha: number, frameDt: number, out: THREE.Vector3): THREE.Vector3 {
    const targetEye = this.height - MOVE.eyeInset;
    const k = 1 - Math.exp(-MOVE.crouchTransitionSpeed * frameDt);
    this.eyeHeight += (targetEye - this.eyeHeight) * k;
    out.lerpVectors(this.prevFeet, this.feet, alpha);
    out.y += this.eyeHeight;
    return out;
  }

  /** Current capsule height (standing or crouched). */
  get bodyHeight(): number {
    return this.height;
  }

  horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
}
