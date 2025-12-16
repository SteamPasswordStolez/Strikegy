import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js";

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export default class PlayerController {
  constructor(arg, speed = 6) {
    if (arg && typeof arg === "object" && arg.playerObject) {
      this.object = arg.playerObject;
      this.baseSpeed = typeof arg.speed === "number" ? arg.speed : speed;
    } else {
      this.object = arg || null;
      this.baseSpeed = speed;
    }

    // ---- vertical physics (simple ground plane) ----
    this.gravity = 18;     // m/s^2
    this.jumpSpeed = 6.5;  // m/s
    this.vy = 0;
    this.groundY = 0;

    // capsule-ish dimensions (collision)
    this.radius = 0.38;
    this.halfHeightStand = 1.0;
    this.halfHeightCrouch = 0.75;

    // ---- states ----
    this.isCrouched = false; // X toggle
    this.isSliding = false;

    // ---- speed multipliers ----
    this.sprintMul = 1.40;
    this.crouchMul = 0.50;

    // Patch 7-2A: external movement multiplier from WeaponSystem (hold/ADS slow)
    // Default 1.0, assigned in game.html each frame.
    this.weaponSpeedMul = 1.0;

    // ---- slide tuning (confirmed) ----
    this.slideDuration = 0.75;
    this.slideTimer = 0;
    this.slideCooldown = 3.0;
    this.slideCooldownTimer = 0;

    this.slideDir = new THREE.Vector3(0, 0, -1);
    this.slideSpeed = 0;       // m/s
    this.slideFriction = 14.0; // m/s^2 (deceleration)

    // ---- camera heights ----
    this.standCamY = 1.6;
    this.crouchCamY = 1.15;
  }

  setObject(object3d) {
    this.object = object3d;
  }

  teleportTo(pos) {
    if (!this.object || !this.object.position) return;
    if (Array.isArray(pos)) this.object.position.set(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0);
    else this.object.position.set(pos?.x ?? 0, pos?.y ?? 0, pos?.z ?? 0);

    this.vy = 0;
    this.isSliding = false;
    this.slideTimer = 0;
    this.slideCooldownTimer = 0;
    this.slideSpeed = 0;
  }

  _startSlide(forwardXZ) {
    this.isSliding = true;
    this.slideTimer = this.slideDuration;
    this.slideCooldownTimer = this.slideCooldown;
    this.isCrouched = true;

    this.slideDir.copy(forwardXZ).normalize();
    this.slideSpeed = this.baseSpeed * this.sprintMul * 1.35;
  }

  /**
   * @param {number} dt
   * @param {{moveX:number, moveZ:number, sprintHeld?:boolean, jumpPressed?:boolean, crouchTogglePressed?:boolean}} input
   * @param {THREE.Camera} camera
   * @param {any} collisionWorld must have resolveCapsuleXZ(pos, radius, halfHeight)
   */
  update(dt, input, camera, collisionWorld) {
    if (!this.object || !this.object.position || !camera) return;

    const moveX = input?.moveX ?? 0;
    const moveZ = input?.moveZ ?? 0;
    const sprintHeld = !!input?.sprintHeld;
    const jumpPressed = !!input?.jumpPressed;
    const crouchTogglePressed = !!input?.crouchTogglePressed;

    const halfH = this.isCrouched ? this.halfHeightCrouch : this.halfHeightStand;

    // cooldown tick
    if (this.slideCooldownTimer > 0) {
      this.slideCooldownTimer = Math.max(0, this.slideCooldownTimer - dt);
    }

    // grounded check (plane)
    const minCenterY = this.groundY + halfH;
    let grounded = false;
    if (this.object.position.y <= minCenterY + 1e-3) {
      grounded = true;
      this.object.position.y = minCenterY;
      if (this.vy < 0) this.vy = 0;
    }

    // camera forward/right on XZ (pitch-free)
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() > 1e-6) _fwd.normalize();
    _right.copy(_fwd).cross(_up).normalize();

    // crouch toggle / slide trigger
    if (crouchTogglePressed && grounded) {
      const wantsSlide = sprintHeld && moveZ > 0.2 && !this.isSliding && this.slideCooldownTimer <= 0;
      if (wantsSlide && _fwd.lengthSq() > 1e-6) {
        this._startSlide(_fwd);
      } else {
        this.isCrouched = !this.isCrouched;
      }
    }

    // jump
    if (jumpPressed && grounded && !this.isSliding) {
      this.vy = this.jumpSpeed;
      grounded = false;
    }

    // vertical integrate
    if (!grounded) {
      this.vy -= this.gravity * dt;
      this.object.position.y += this.vy * dt;
    }

    // horizontal velocity (m/s)
    let vx = 0, vz = 0;

    if (this.isSliding) {
      vx = this.slideDir.x * this.slideSpeed;
      vz = this.slideDir.z * this.slideSpeed;

      this.slideSpeed = Math.max(0, this.slideSpeed - this.slideFriction * dt);
      this.slideTimer -= dt;

      if (this.slideTimer <= 0 || this.slideSpeed <= this.baseSpeed * 0.35) {
        this.isSliding = false;
        this.slideSpeed = 0;
      }
    } else {
      // normal input movement
      let dx = _right.x * moveX + _fwd.x * moveZ;
      let dz = _right.z * moveX + _fwd.z * moveZ;

      const lenSq = dx*dx + dz*dz;
      if (lenSq > 1e-6) {
        const inv = 1 / Math.sqrt(lenSq);
        dx *= inv;
        dz *= inv;
      }

      let speedMul = 1.0;
      if (sprintHeld && moveZ > 0.2 && !this.isCrouched) speedMul *= this.sprintMul;
      if (this.isCrouched) speedMul *= this.crouchMul;

      // Patch 7-2A: weapon hold/ADS movement slow (1.0 when not holding a gun)
      if (typeof this.weaponSpeedMul === "number") speedMul *= this.weaponSpeedMul;

      vx = dx * this.baseSpeed * speedMul;
      vz = dz * this.baseSpeed * speedMul;
    }

    // ---- collision-aware movement (sub-stepping to prevent tunneling) ----
    const horizSpeed = Math.hypot(vx, vz);
    const maxStepDist = this.radius * 0.75;
    const steps = Math.max(1, Math.min(8, Math.ceil((horizSpeed * dt) / maxStepDist)));
    const stepDt = dt / steps;

    for (let i = 0; i < steps; i++) {
      this.object.position.x += vx * stepDt;
      this.object.position.z += vz * stepDt;

      if (collisionWorld && typeof collisionWorld.resolveCapsuleXZ === "function") {
        const hit = collisionWorld.resolveCapsuleXZ(this.object.position, this.radius, halfH);
        if (hit && this.isSliding) {
          // bonk slows slide quickly
          this.slideSpeed = Math.max(0, this.slideSpeed - this.slideFriction * stepDt * 2.5);
          if (this.slideSpeed <= this.baseSpeed * 0.4) {
            this.isSliding = false;
            this.slideSpeed = 0;
          }
        }
      }
    }

    // camera height (simple smooth)
    const targetCamY = this.isCrouched ? this.crouchCamY : this.standCamY;
    camera.position.y += (targetCamY - camera.position.y) * Math.min(1, dt * 18);
  }
}
