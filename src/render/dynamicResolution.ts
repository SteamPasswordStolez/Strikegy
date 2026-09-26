/** Dynamic resolution tuning. */
export const DRS = {
  min: 0.6,
  step: 0.1,
  /** Decisions are made once per window of this many seconds. */
  windowSec: 1,
  /** A frame interval above this missed the 60 fps budget (vsync then shows it twice). */
  missMs: 20,
  /** Step down when more than this share of a window's frames missed. */
  missFrac: 0.2,
  /** Minimum time between two resizes (each one reallocates buffers). */
  cooldownSec: 1.5,
  /** Time without misses before trying a higher scale; doubles after a failed try. */
  upWaitSec: 6,
  upWaitMaxSec: 60,
} as const;

/**
 * Picks the render scale from frame pacing. Reacts to the share of frames that
 * miss the 60 fps budget per second (a few dropped frames already read as
 * stutter), rather than to an averaged frame time that hides them.
 */
export class DynamicResolution {
  private _scale = 1;
  private max = 1;
  private frames = 0;
  private misses = 0;
  private windowLeft: number = DRS.windowSec;
  private cooldown: number = DRS.cooldownSec;
  private calm = 0;
  private upWait: number = DRS.upWaitSec;
  private sinceUp = Infinity;

  get scale(): number {
    return this._scale;
  }

  /** Upper bound on the scale (from the quality preset's pixel budget). */
  setMax(max: number): void {
    this.max = Math.max(DRS.min, Math.min(1, max));
    this._scale = Math.min(this._scale, this.max);
  }

  /** Starts at the top of the range, e.g. after a window resize. */
  resetToMax(): void {
    this._scale = this.max;
  }

  /** @returns the new scale when it changed, otherwise null. */
  update(dt: number, frameMs: number): number | null {
    // Hitches and throttled frames (alt-tab, background tab) are not load.
    if (frameMs > 60) return null;
    this.frames++;
    if (frameMs > DRS.missMs) this.misses++;
    this.cooldown -= dt;
    this.sinceUp += dt;
    this.windowLeft -= dt;
    if (this.windowLeft > 0) return null;

    const overloaded = this.misses / this.frames > DRS.missFrac;
    this.calm = this.misses === 0 ? this.calm + DRS.windowSec : 0;
    this.frames = this.misses = 0;
    this.windowLeft = DRS.windowSec;
    if (this.cooldown > 0) return null;

    let next = this._scale;
    if (overloaded && this._scale > DRS.min) {
      next = Math.max(DRS.min, this._scale - DRS.step);
      // Going up did not stick: wait longer before the next attempt.
      if (this.sinceUp < DRS.upWaitSec) this.upWait = Math.min(DRS.upWaitMaxSec, this.upWait * 2);
    } else if (this.calm >= this.upWait && this._scale < this.max) {
      next = Math.min(this.max, this._scale + DRS.step);
      this.sinceUp = 0;
    }
    if (next === this._scale) return null;
    this._scale = +next.toFixed(2);
    this.cooldown = DRS.cooldownSec;
    this.calm = 0;
    return this._scale;
  }
}
