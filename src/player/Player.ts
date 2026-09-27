import * as THREE from 'three';
import { Layer, RAPIER, groups, type PhysicsWorld } from '@/physics/PhysicsWorld';
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
} from './movement';
import { WADE_DEPTH, WADE_SPEED, type WaterMap } from '@/world/water';

const MAX_PITCH = (89 * Math.PI) / 180;
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
  sprinting = false;
  /** Rivers on the map (wading slows the player), set by the game. */
  water: WaterMap | null = null;
  readonly health = new Health();
  private strideLeft: number = STRIDE.walk / 2;
  private jumpBuffered = 0;
  private sinceGrounded = 0;
  /** Smoothed eye height above feet (render side). */
  eyeHeight: number = MOVE.standHeight - MOVE.eyeInset;

  readonly collider: RAPIER.Collider;
  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.KinematicCharacterController;
  private height: number = MOVE.standHeight;

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

  get alive(): boolean {
    return this.health.alive;
  }

  teleport(feet: THREE.Vector3, yaw: number): void {
    // Start a hair above the target: a capsule placed exactly on (or in) the floor
    // can slip through it; snap-to-ground settles it within a frame.
    this.feet.copy(feet).setY(feet.y + 0.05);
    this.prevFeet.copy(this.feet);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.body.setTranslation(this.centerFromFeet(), true);
  }

  /** Called every render frame with accumulated look deltas (radians). */
  applyLook(dYaw: number, dPitch: number): void {
    this.yaw = (this.yaw + dYaw) % (Math.PI * 2);
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
  }

  step(dt: number, input: InputState, ads: boolean, firing: boolean): void {
    this.prevFeet.copy(this.feet);
    this.updateCrouch(input.crouch);

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
    const top = wading ? speed * WADE_SPEED : speed;
    const [vx, vz] = approachVelocity(this.velocity.x, this.velocity.z, wx * top, wz * top, accel, dt);
    this.velocity.x = vx;
    this.velocity.z = vz;

    if (input.jump) this.jumpBuffered = MOVE.jumpBuffer;
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
