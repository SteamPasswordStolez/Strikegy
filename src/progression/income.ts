/**
 * How much supply-ticket income the game pays (owner, 2026-10-26, launch
 * preparation 1: every source cut to a quarter). Every table that pays tickets
 * (matches, ribbons, standings, bounties, contracts, missions, attendance,
 * salary, level and promotion rewards, weapon levels, camo tiers, the day's
 * first win) is written as its old number through `earn`, so this one knob
 * moves them all and the screens show what is paid. Import-free.
 */
export const INCOME = 1 / 4;

/** An income figure at the current rate (whole tickets; anything paid stays at least 1). */
export function earn(n: number): number {
  return n > 0 ? Math.max(1, Math.round(n * INCOME)) : 0;
}
