import * as THREE from 'three';
import { LagSpring } from './spring';

/** What the view's movement feel needs to know each frame. */
export interface MotionInput {
  dt: number;
  /** Seconds since start (idle breathing). */
  time: number;
  adsBlend: number;
  sprintBlend: number;
  grounded: boolean;
  crouching: boolean;
  /** Ground speed along the view (m/s, + forward) and across it (+ right). */
  forward: number;
  strafe: number;
  /** Vertical speed (m/s, + up). */
  vy: number;
  /** View turned this frame (rad). */
  lookDYaw: number;
  lookDPitch: number;
}

const clamp = THREE.MathUtils.clamp;

/** Walking speed the bob is scaled to (m/s). */
const WALK = 4.5;

/**
 * The gun's movement feel, between Call of Duty and Battlefield (owner,
 * 2026-10-30 CoD-like, 2026-10-31 toned down toward BF: smaller bob, a
 * heavier, slower lag with less overshoot): a figure-
 * eight bob in step with the feet (a dip at each footfall, side to side
 * across the stride), much larger and swinging while sprinting; the gun
 * lagging behind the view when it turns and swinging a little past when it
 * stops; leaning into a strafe; trailing a jump and dipping on landing; a
 * small dip and cant on crouching; slow breathing while standing still. All
 * of it shrinks down the sights. Gives an offset and a rotation for the gun
 * (gun space: x right, y up, z toward the eye; rotation as Euler x / y / z).
 */
export class ViewMotion {
  readonly pos = new THREE.Vector3();
  readonly rot = new THREE.Vector3();
  /** Stride phase (one cycle = two steps). */
  private phase = 0;
  private stride = 0;
  private readonly yawLag = new LagSpring(11, 0.62);
  private readonly pitchLag = new LagSpring(11, 0.62);
  private readonly side = new LagSpring(9, 0.55);
  private readonly lean = new LagSpring(8, 0.6);
  private readonly fore = new LagSpring(8, 0.6);
  private readonly lift = new LagSpring(10, 0.5);
  private readonly cant = new LagSpring(9, 0.55);
  private wasCrouching = false;

  /** Landing: the gun drops and springs back (impact speed m/s). */
  land(impact: number): void {
    this.lift.push(-Math.min(0.9, impact * 0.08));
    this.cant.push(Math.min(0.6, impact * 0.04) * (Math.random() < 0.5 ? -1 : 1));
  }

  update(f: MotionInput): void {
    const dt = Math.max(1e-4, f.dt);
    const ads = f.adsBlend;
    const keep = 1 - 0.85 * ads;
    const speed = Math.hypot(f.forward, f.strafe);

    // Stride: about 2.6 steps a second walking, 3.3 sprinting; only on the ground.
    const target = f.grounded ? clamp(speed / WALK, 0, 1.5) : 0;
    this.stride += (target - this.stride) * (1 - Math.exp(-8 * dt));
    if (f.grounded && speed > 0.2) this.phase += dt * Math.PI * 2 * (0.55 + 0.17 * speed);
    const s = Math.sin(this.phase);
    const dip = (1 - Math.cos(2 * this.phase)) / 2;
    const amp = this.stride * (f.crouching ? 0.6 : 1) * keep;
    const sp = f.sprintBlend;
    // Walk: small figure eight; sprint: the gun swings across the body.
    const bx = s * (0.006 + 0.016 * sp) * amp;
    const by = -dip * (0.008 + 0.012 * sp) * amp;
    const roll = s * (0.014 + 0.05 * sp) * amp;
    const yaw = -s * (0.008 + 0.032 * sp) * amp;
    const pitch = (dip - 0.5) * (0.008 + 0.024 * sp) * amp;

    // Turning: the gun lags behind the view and swings past when it stops (rad/s in, rad out).
    const yawRate = f.lookDYaw / dt;
    const pitchRate = f.lookDPitch / dt;
    const lagScale = 1 - 0.75 * ads;
    const ly = this.yawLag.step(clamp(yawRate * 0.0055, -0.04, 0.04) * lagScale, dt);
    const lp = this.pitchLag.step(clamp(pitchRate * 0.0055, -0.032, 0.032) * lagScale, dt);

    // Moving: trails a step behind sideways, leans into the strafe, pulled in a little going forward.
    const sideX = this.side.step(-f.strafe * 0.002 * keep, dt);
    const leanZ = this.lean.step(-f.strafe * 0.008 * keep, dt);
    const foreZ = this.fore.step(clamp(f.forward, -6, 7) * 0.0016 * keep, dt);

    // In the air the gun trails the body: low going up, high coming down.
    const air = f.grounded ? 0 : clamp(-f.vy * 0.0045, -0.025, 0.03);
    // Crouching: a dip and a cant as the body drops, back up on standing.
    if (f.crouching !== this.wasCrouching) {
      this.lift.push(f.crouching ? -0.35 : 0.25);
      this.cant.push(f.crouching ? 0.5 : -0.3);
      this.wasCrouching = f.crouching;
    }
    const liftY = this.lift.step(air * keep, dt);
    const cantZ = this.cant.step(0, dt);

    // Breathing while still (fades out with the stride).
    const still = (1 - Math.min(1, this.stride)) * (1 - 0.7 * ads);
    const bt = f.time;
    const breathX = Math.sin(bt * 1.1) * 0.0016 * still;
    const breathY = Math.sin(bt * 2.2 + 0.6) * 0.0012 * still;

    this.pos.set(bx + sideX + ly * 0.35 + breathX, by + liftY - lp * 0.3 + breathY, foreZ);
    this.rot.set(pitch + lp + liftY * 0.9 + breathY * 2, yaw + ly + breathX * 2, roll + leanZ + cantZ + ly * 0.4);
  }
}
