export const HEALTH = {
  max: 100,
  /** Seconds without taking damage before regeneration starts. */
  regenDelay: 5,
  regenPerSec: 14,
  /** Landing speed (m/s) above which falls hurt; ~3.4 m drop with our gravity. */
  fallSafeSpeed: 11,
  fallDamagePerMps: 9,
} as const;

/** Pure health model with delayed regeneration. */
export class Health {
  value: number = HEALTH.max;
  private sinceDamage = Infinity;

  get alive(): boolean {
    return this.value > 0;
  }

  /** Applies damage; returns true if this killed. */
  damage(amount: number): boolean {
    if (!this.alive || amount <= 0) return false;
    this.value = Math.max(0, this.value - amount);
    this.sinceDamage = 0;
    return this.value === 0;
  }

  step(dt: number): void {
    if (!this.alive) return;
    this.sinceDamage += dt;
    if (this.sinceDamage >= HEALTH.regenDelay && this.value < HEALTH.max) {
      this.value = Math.min(HEALTH.max, this.value + HEALTH.regenPerSec * dt);
    }
  }

  reset(): void {
    this.value = HEALTH.max;
    this.sinceDamage = Infinity;
  }
}

export function fallDamage(impactSpeed: number): number {
  return impactSpeed <= HEALTH.fallSafeSpeed ? 0 : (impactSpeed - HEALTH.fallSafeSpeed) * HEALTH.fallDamagePerMps;
}
