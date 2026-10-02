/**
 * Squad call-ins (M4-C step 6): what they cost and how they land. Pure data.
 *
 * Points earned by a squad's members (the scoreboard score) pool into the
 * squad's RP; only the squad leader spends them (the player leads their own
 * squad, a bot squad's first living member leads it). Each kind has a team
 * wide cooldown so call-ins don't rain down back to back.
 */

export type SupportId = 'smoke' | 'recon' | 'supply' | 'mortar' | 'artillery' | 'rocketTank';

export interface SupportSpec {
  id: SupportId;
  /** RP it costs. */
  cost: number;
  /** Team-wide seconds before the same kind can be called again. */
  cooldown: number;
  /** Seconds from the call to the first shell landing (the plane arriving, the crate touching down). */
  delay: number;
  /** Shells fired (barrages). */
  shells: number;
  /** Shells land within this radius of the point (m). */
  spread: number;
  /** Seconds between shells. */
  interval: number;
}

export const SUPPORT: Record<SupportId, SupportSpec> = {
  smoke: { id: 'smoke', cost: 400, cooldown: 30, delay: 3, shells: 3, spread: 9, interval: 0.6 },
  recon: { id: 'recon', cost: 600, cooldown: 45, delay: 2, shells: 0, spread: 60, interval: 0 },
  supply: { id: 'supply', cost: 500, cooldown: 45, delay: 0, shells: 0, spread: 0, interval: 0 },
  mortar: { id: 'mortar', cost: 800, cooldown: 60, delay: 3.5, shells: 3, spread: 7, interval: 1.3 },
  artillery: { id: 'artillery', cost: 1500, cooldown: 120, delay: 5, shells: 8, spread: 22, interval: 0.75 },
  // A rocket launcher truck the squad leader drives (appears at the zone nearest the leader).
  rocketTank: { id: 'rocketTank', cost: 2500, cooldown: 180, delay: 0, shells: 0, spread: 0, interval: 0 },
};

/** Menu order (keys 1..6). */
export const SUPPORT_ORDER: readonly SupportId[] = ['smoke', 'recon', 'supply', 'mortar', 'artillery', 'rocketTank'];

/** Recon plane: seconds it marks enemies for, and how often it sweeps. */
export const RECON = { duration: 20, sweep: 1 };
/** Supply drop: falls from this height at this speed; then refills this many people, and stays this long. */
export const SUPPLY = { height: 55, fallSpeed: 9, uses: 3, life: 90, reach: 3.2 };
/** Farthest a call-in can be aimed from the caller (m). */
export const CALL_RANGE = 400;

/** A squad's RP: everything its members earned, less what its leader spent. */
export function squadRp(earned: number, spent: number): number {
  return Math.max(0, Math.floor(earned - spent));
}

/**
 * Shell landing offsets for a barrage: spread over the disc, the first one
 * closest to the middle (deterministic for a given `rand`).
 */
export function barrageOffsets(spec: SupportSpec, rand: () => number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < spec.shells; i++) {
    const r = spec.spread * Math.sqrt(rand()) * (i === 0 ? 0.35 : 1);
    const a = rand() * Math.PI * 2;
    out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  return out;
}
