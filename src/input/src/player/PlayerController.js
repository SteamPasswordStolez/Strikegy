import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js";

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _slideDir = new THREE.Vector3();

export default class PlayerController {
  /**
   * Compatible constructor:
   *  - new PlayerController(object3d)
   *  - new PlayerController({ playerObject, speed })
   */
  constructor(arg, speed = 6) {
    if (arg && typeof arg === "object" && arg.playerObject) {
      this.object = arg.playerObject;
      this.baseSpeed = typeof arg.speed === "number" ? arg.speed : speed;
    } else {
      this.object = arg || null;
      this.baseSpeed = speed;
    }

    // vertical physics (simple)
    this.gravity = 18;        // m/s^2
    this.jumpSpeed = 6.5;     // m/s
    this.vy = 0;
    this.groundY = 0;
    this.halfHeight = 1.0;    // capsule center-to-feet approx (0.55 + 0.9/2)

    // movement states
    this.isCrouched = false;  // X toggle
    this.isSliding = false;

    // slide tuning
    this.slideDuration = 0.75;
    this.slideTimer = 0;
    this.slideCooldown = 3.0;
    this.slideCooldownTimer = 0;
    this.slideSpeedMul = 1.30;
    this.slideFriction = 10.0; // higher = stops faster

    // speed multipliers
    this.sprintMul = 1.40;
    this.crouchMul = 0.50;

    // camera heights
    this.standCamY = 1.6;
    this.crouchCamY = 1.15;
  }

  setObject(object3d){ this.object = object3d; }

  teleportTo(pos){
    if (!this.object || !this.object.position) return;
    if (Array.isArray(pos)) this.object.position.set(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0);
    else this.object.position.set(pos?.x ?? 0, pos?.y ?? 0, pos?.z ?? 0);
    this.vy = 0;
    this.slideTimer = 0;
    this.isSliding = false;
  }

  /**
   * @param {number} dt seconds
   * @param {{moveX:number, moveZ:number, sprintHeld?:boolean, jumpPressed?:boolean, crouchTogglePressed?:boolean}} input
   * @param {THREE.Camera} camera
   */
  update(dt, input, camera) {
    if (!this.object || !this.object.position || !camera) return;

    const moveX = input?.moveX ?? 0;
    const moveZ = input?.moveZ ?? 0;
    const sprintHeld = !!input?.sprintHeld;
    const jumpPressed = !!input?.jumpPressed;
    const crouchTogglePressed = !!input?.crouchTogglePressed;

    // cooldown tick
    if (this.slideCooldownTimer > 0) this.slideCooldownTimer = Math.max(0, this.slideCooldownTimer - dt);

    // grounded check (simple ground plane)
    const minCenterY = this.groundY + this.halfHeight;
    let grounded = false;
    if (this.object.position.y <= minCenterY + 1e-3) {
      grounded = true;
      this.object.position.y = minCenterY;
      if (this.vy < 0) this.vy = 0;
    }

    // crouch / slide toggle (X)
    if (crouchTogglePressed && grounded) {
      const wantsSlide = sprintHeld && moveZ > 0.2 && !this.isSliding && this.slideCooldownTimer <= 0;
      if (wantsSlide) {
        // start slide in camera forward direction (XZ)
        camera.getWorldDirection(_slideDir);
        _slideDir.y = 0;
        if (_slideDir.lengthSq() > 1e-6) _slideDir.normalize();
        this.isSliding = true;
        this.slideTimer = this.slideDuration;
        this.slideCooldownTimer = this.slideCooldown;
        // slide ends in crouched
        this.isCrouched = true;
      } else {
        this.isCrouched = !this.isCrouched;
      }
    }

    // jump (Space) — only when grounded and not sliding
    if (jumpPressed && grounded && !this.isSliding) {
      this.vy = this.jumpSpeed;
      grounded = false;
    }

    // vertical integrate
    if (!grounded) {
      this.vy -= this.gravity * dt;
      this.object.position.y += this.vy * dt;
    }

    // determine camera forward/right on XZ plane (pitch-free)
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() > 1e-6) _fwd.normalize();
    _right.copy(_fwd).cross(_up).normalize();

    // horizontal move
    let dx = 0, dz = 0;
    let speedMul = 1.0;

    const forwardOnlySprint = (moveZ > 0.2); // sprint only if pushing forward
    if (this.isSliding) {
      // slide: ignore input, use stored forward dir from camera at start (good enough)
      // We use current _fwd for simplicity; feels consistent with camera-forward movement.
      dx = _fwd.x;
      dz = _fwd.z;

      // friction slows down over time
      const t = this.slideTimer;
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) {
        this.isSliding = false;
      }

      // slide speed decays
      const decay = Math.max(0, 1 - (this.slideDuration - Math.max(0, t)) * (this.slideFriction / this.slideDuration));
      speedMul = this.sprintMul * this.slideSpeedMul * Math.max(0.15, decay);
    } else {
      // normal: input-based
      dx = _right.x * moveX + _fwd.x * moveZ;
      dz = _right.z * moveX + _fwd.z * moveZ;

      const lenSq = dx*dx + dz*dz;
      if (lenSq > 1e-6) {
        const inv = 1 / Math.sqrt(lenSq);
        dx *= inv; dz *= inv;
      }

      if (this.isCrouched) speedMul *= this.crouchMul;
      if (sprintHeld && forwardOnlySprint && !this.isCrouched) speedMul *= this.sprintMul;
    }

    this.object.position.x += dx * this.baseSpeed * speedMul * dt;
    this.object.position.z += dz * this.baseSpeed * speedMul * dt;

    // camera height (simple)
    const targetCamY = this.isCrouched ? this.crouchCamY : this.standCamY;
    camera.position.y += (targetCamY - camera.position.y) * Math.min(1, dt * 18);
  }
}