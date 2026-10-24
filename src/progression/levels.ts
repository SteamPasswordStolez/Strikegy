/**
 * Levels and ranks (progression plan, docs/design/progression.md 3-1). The one
 * XP curve: the game and `scripts/progression-table.mjs` (which writes the
 * level table in docs/design) both use `xpToNext` from here, so edit the
 * numbers here, never the table. Import-free and erasable-only: Node runs this
 * file as it is (the table script).
 *
 * XP to the next level = ⌊ 1000 · e^(0.27 · (ln min(level, 99))^1.5)
 *                          × 1.0003^(level − 100)  (from 하사 on)
 *                          × the promotion walls so far × the booms so far ⌋
 * (owner, 2026-10-24: MapleStory-like, uneven numbers; 하사 in ~10 h of bot
 * matches, 원수 in ~1,920 h; XP = match score × 10).
 */

/** Promotion walls: from this level on the XP to the next is multiplied by this. */
export const WALLS: Readonly<Record<number, number>> = {
  10: 1.05,
  30: 1.05,
  60: 1.05,
  100: 1.2,
  210: 1.1,
  500: 1.1,
  1000: 1.12,
};
/** Maple-style booms: bigger and rarer up the ranks (×1.5 every 50 for NCOs … ×2 every 20 past 원수). */
export const BOOMS: readonly { from: number; to: number; every: number; x: number }[] = [
  { from: 100, to: 209, every: 50, x: 1.5 }, // 부사관: 150, 200
  { from: 200, to: 499, every: 100, x: 1.6 }, // 장교: 300, 400
  { from: 500, to: 999, every: 200, x: 1.7 }, // 장성: 700, 900
  { from: 1000, to: Infinity, every: 20, x: 2 }, // 원수 뒤: 1020, 1040 …
];
export const CLIMB = { base: 1000, k: 0.27, p: 1.5, creep: 1.0003 } as const;

/** XP from `level` to the next one. */
export function xpToNext(level: number): number {
  let walls = 1;
  for (const [at, x] of Object.entries(WALLS)) if (Number(at) <= level) walls *= x;
  let booms = 1;
  for (const b of BOOMS)
    booms *= b.x ** Math.max(0, Math.floor((Math.min(level, b.to) - b.from) / b.every));
  const climb = CLIMB.base * Math.exp(CLIMB.k * Math.log(Math.min(level, 99)) ** CLIMB.p);
  const creep = CLIMB.creep ** Math.max(0, level - 100);
  return Math.floor(climb * creep * walls * booms);
}

/** The ranks by first level (owner, 2026-10-19); names and titles in i18n (`rank.<id>`, `rankTitle.<id>`). */
export const RANKS = [
  { id: 'pvt', from: 1, kind: 'bar', n: 1 },
  { id: 'pfc', from: 10, kind: 'bar', n: 2 },
  { id: 'cpl', from: 30, kind: 'bar', n: 3 },
  { id: 'sgt', from: 60, kind: 'bar', n: 4 },
  { id: 'ssg', from: 100, kind: 'chevron', n: 1 },
  { id: 'sfc', from: 130, kind: 'chevron', n: 2 },
  { id: 'msg', from: 160, kind: 'chevron', n: 3 },
  { id: 'sgm', from: 200, kind: 'chevron', n: 4 },
  { id: '2lt', from: 210, kind: 'diamond', n: 1 },
  { id: '1lt', from: 230, kind: 'diamond', n: 2 },
  { id: 'cpt', from: 250, kind: 'diamond', n: 3 },
  { id: 'maj', from: 300, kind: 'blossom', n: 1 },
  { id: 'ltc', from: 350, kind: 'blossom', n: 2 },
  { id: 'col', from: 400, kind: 'blossom', n: 3 },
  { id: 'bg', from: 500, kind: 'star', n: 1 },
  { id: 'mg', from: 600, kind: 'star', n: 2 },
  { id: 'ltg', from: 700, kind: 'star', n: 3 },
  { id: 'gen', from: 800, kind: 'star', n: 4 },
  { id: 'goa', from: 1000, kind: 'star', n: 5 },
] as const;
export type Rank = (typeof RANKS)[number];
export type RankId = Rank['id'];

/** The rank at `level` (the boundary level is the higher rank: 10 is 일병). */
export function rankAt(level: number): Rank {
  let r: Rank = RANKS[0];
  for (const k of RANKS) if (k.from <= level) r = k;
  return r;
}

/** The next rank after `level`'s, or null at 원수. */
export function nextRank(level: number): Rank | null {
  for (const k of RANKS) if (k.from > level) return k;
  return null;
}

/** Cumulative XP at the start of each level (index = level − 1), grown on demand. */
const starts: number[] = [0];

/** Total XP needed to first reach `level`. */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  while (starts.length < l) starts.push(starts[starts.length - 1]! + xpToNext(starts.length));
  return starts[l - 1]!;
}

export interface LevelInfo {
  level: number;
  /** XP into this level. */
  into: number;
  /** XP from this level to the next. */
  need: number;
}

/** Where a total of `xp` stands: the level, XP into it and the size of the level. */
export function levelOf(xp: number): LevelInfo {
  const x = Math.max(0, Math.floor(xp));
  // Gallop out, then a binary search over the cumulative table.
  let hi = 2;
  while (xpForLevel(hi) <= x) hi *= 2;
  let lo = Math.max(1, hi >> 1);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xpForLevel(mid) <= x) lo = mid;
    else hi = mid - 1;
  }
  return { level: lo, into: x - xpForLevel(lo), need: xpToNext(lo) };
}
