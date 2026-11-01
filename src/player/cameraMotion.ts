import * as THREE from 'three';
import { LagSpring } from '@/weapons/spring';

/** What the camera's movement feel needs each frame (on foot). */
export interface CameraMotionInput {
  dt: number;
  /** Seconds since start (the slide's judder). */
  time: number;
  /** The stride from the gun's motion (viewMotion.ts), so head and gun move on the same steps. */
  phase: number;
  stride: number;
  /** 0..1 */
  sprint: number;
  ads: number;
  sliding: boolean;
  /** Ground speed (m/s) and its part across the view (+ right). */
  speed: number;
  strafe: number;
  /** The setting (화면 → 이동 화면 흔들림): 1 normal, 0.5 low, 0 off. */
  scale: number;
}

/**
 * The head moving with the body (owner, 2026-11-01: "some screen shake while
 * walking and running, not only the gun's motion; and a better slide"): a
 * small dip at each footfall and a sway across the stride, larger sprinting,
 * a little lean into a strafe, a drop on landing; a slide drops the eye at
 * once, leans into it, judders with the ground and widens the view a few
 * degrees. Everything is small: the aim follows the player's look, not the
 * camera, and down the sights it nearly stops. Eye offset in view space (x
 * right, y up, metres) and angle offsets (rad) / field of view (deg) to add.
 */
export class CameraMotion {
  readonly offset = new THREE.Vector3();
  pitch = 0;
  yaw = 0;
  roll = 0;
  fov = 0;
  /** Eye drop (m): landings, the start of a slide. */
  private readonly dip = new LagSpring(9, 0.6);
  /** Lean (rad): into a strafe, into a slide. */
  private readonly tilt = new LagSpring(11, 0.8);
  private slide = 0;
  private wasSliding = false;
  private slideSide = 1;

  /** Landing (impact m/s): the eye drops and comes back up. */
  land(impact: number, scale: number): void {
    this.dip.push(-Math.min(1.4, impact * 0.11) * scale);
  }

  reset(): void {
    this.dip.reset();
    this.tilt.reset();
    this.slide = 0;
    this.wasSliding = false;
    this.offset.set(0, 0, 0);
    this.pitch = this.yaw = this.roll = this.fov = 0;
  }

  update(f: CameraMotionInput): void {
    const dt = Math.max(1e-4, f.dt);
    const keep = (1 - 0.8 * f.ads) * f.scale;

    // Steps: the eye dips at each footfall (1.2 cm walking, 2.6 sprinting) and sways across the stride.
    const s = Math.sin(f.phase);
    const dipC = (1 - Math.cos(2 * f.phase)) / 2;
    const amp = Math.min(1.2, f.stride) * keep;
    const sp = f.sprint;
    const bx = s * (0.006 + 0.008 * sp) * amp;
    const by = -dipC * (0.012 + 0.014 * sp) * amp;
    const stepRoll = s * (0.004 + 0.008 * sp) * amp;
    const stepPitch = (dipC - 0.5) * (0.003 + 0.006 * sp) * amp;
    const stepYaw = s * 0.0015 * sp * amp;

    // Sliding: the eye drops at once (the body catches up), leans to the side it steers to (left by default).
    if (f.sliding && !this.wasSliding) {
      this.dip.push(-1.1 * f.scale);
      this.slideSide = f.strafe > 0.5 ? -1 : 1;
    }
    this.wasSliding = f.sliding;
    this.slide += ((f.sliding ? 1 : 0) - this.slide) * (1 - Math.exp(-(f.sliding ? 12 : 5) * dt));
    const lean = -f.strafe * 0.0035 * keep * (1 - this.slide) + this.slide * 0.06 * this.slideSide * f.scale * (1 - 0.5 * f.ads);
    const tilt = this.tilt.step(lean, dt);
    const dip = this.dip.step(0, dt);

    // The ground under a slide: a fine judder, stronger the faster it goes.
    const r = this.slide * Math.min(1, f.speed / 9) * f.scale * (1 - 0.6 * f.ads);
    const t = f.time;
    const jPitch = (Math.sin(t * 61) * 0.0022 + Math.sin(t * 97 + 1.3) * 0.0011) * r;
    const jYaw = Math.sin(t * 73 + 0.4) * 0.0015 * r;
    const jY = Math.sin(t * 53 + 2.1) * 0.004 * r;

    this.offset.set(bx, by + dip + jY, 0);
    this.pitch = stepPitch + jPitch;
    this.yaw = stepYaw + jYaw;
    this.roll = stepRoll + tilt;
    // A slide widens the view a little (speed), not down the sights.
    this.fov = this.slide * 5 * f.scale * (1 - f.ads);
  }
}
