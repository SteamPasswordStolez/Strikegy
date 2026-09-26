/**
 * Accumulator-based fixed timestep. Simulation runs at a constant rate
 * regardless of render frame rate; the returned alpha is used by the
 * renderer to interpolate between the previous and current sim states.
 */
export class FixedStepLoop {
  private accumulator = 0;

  constructor(
    readonly step = 1 / 60,
    readonly maxSubSteps = 5,
  ) {}

  /** Advances by a real frame delta and returns interpolation alpha in [0, 1). */
  advance(frameDt: number, update: (dt: number) => void): number {
    this.accumulator += Math.min(Math.max(frameDt, 0), this.step * this.maxSubSteps);
    let n = 0;
    while (this.accumulator >= this.step && n < this.maxSubSteps) {
      update(this.step);
      this.accumulator -= this.step;
      n++;
    }
    return this.accumulator / this.step;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
