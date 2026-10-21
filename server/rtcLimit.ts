/** Bound signalling bursts without exhausting a long match's UDP health reports. */
export class RtcLimit {
  private tokens = 80;
  private at = Date.now();

  take(now = Date.now()): boolean {
    this.tokens = Math.min(80, this.tokens + Math.max(0, now - this.at) * 0.008);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}
