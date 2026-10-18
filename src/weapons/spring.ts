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
