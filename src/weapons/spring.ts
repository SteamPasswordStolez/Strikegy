/**
 * A critically damped spring resting at 0, for kicks that rise and settle
 * (the gun's muzzle, the camera punch). Stepped by its exact solution, so a
 * long frame can't make it blow up.
 */
export class Spring {
  x = 0;
  private v = 0;

  constructor(public rate = 16) {}

  /** A blow that, from rest, peaks at `peak` after 1 / rate seconds. */
  kick(peak: number): void {
    this.v += peak * this.rate * Math.E;
  }

  step(dt: number): void {
    const w = this.rate;
    const e = Math.exp(-w * dt);
    const x = this.x;
    const v = this.v;
    this.x = (x + (v + w * x) * dt) * e;
    this.v = (v - w * (v + w * x) * dt) * e;
  }

  reset(): void {
    this.x = this.v = 0;
  }
}


/**
 * An underdamped spring toward a moving target (weapon inertia): it lags
 * behind the target, swings a little past it and settles. Stepped in small
 * sub-steps so a long frame stays stable.
 */
export class LagSpring {
  x = 0;
  v = 0;

  /** `freq` in rad/s, `damping` 0..1 (1 = no overshoot). */
  constructor(
    public freq = 14,
    public damping = 0.5,
  ) {}

  step(target: number, dt: number): number {
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    const w = this.freq;
    for (let i = 0; i < n; i++) {
      this.v += (w * w * (target - this.x) - 2 * this.damping * w * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }

  /** A sudden push (m/s or rad/s). */
  push(v: number): void {
    this.v += v;
  }

  reset(): void {
    this.x = this.v = 0;
  }
}
