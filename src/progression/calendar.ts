/**
 * Days and weeks for the progression's dailies (progression-data.md D, S):
 * a day turns at 05:00 Korean time (UTC+9), a week on Monday 05:00. Keys are
 * plain strings ("2026-10-25", "2026-W43") so the browser and the game server
 * agree without time zones. Plus a small seeded random for anything that must
 * come out the same at both ends (missions, the week's shop).
 */

const DAY_MS = 86_400_000;
/** UTC+9, then back 5 hours: the day starts at 05:00 in Korea. */
const SHIFT_MS = (9 - 5) * 3_600_000;

/** The day `now` falls on (05:00 KST to 05:00 KST). */
export function dayKey(now: number): string {
  return new Date(now + SHIFT_MS).toISOString().slice(0, 10);
}

/** Days since the epoch in game days (for counting gaps). */
export function dayNumber(now: number): number {
  return Math.floor((now + SHIFT_MS) / DAY_MS);
}

/** The ISO week `now` falls on (weeks start Monday 05:00 KST). */
export function weekKey(now: number): string {
  const d = new Date(now + SHIFT_MS);
  d.setUTCHours(0, 0, 0, 0);
  // Thursday of this week decides the year (ISO 8601).
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / DAY_MS - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The month `now` falls on ("2026-10"). */
export function monthKey(now: number): string {
  return dayKey(now).slice(0, 7);
}

/** When the next day starts (ms). */
export function nextDayAt(now: number): number {
  return (dayNumber(now) + 1) * DAY_MS - SHIFT_MS;
}

/** When the next week starts (ms). */
export function nextWeekAt(now: number): number {
  let t = nextDayAt(now);
  const wk = weekKey(now);
  while (weekKey(t) === wk) t += DAY_MS;
  return t;
}

/** A number from text (FNV-1a). */
export function hashText(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A seeded random 0..1 (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
