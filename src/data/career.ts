import { loadJSON, saveJSON } from '@/core/storage';

/**
 * The player's career, shown on the lobby's calling card [제안]: every
 * finished match adds the player's score as experience; levels get a little
 * longer each time (level n -> n+1 takes 2,000 + 250 (n-1) XP), up to 55,
 * then prestige-style it just keeps counting. Cosmetic only.
 */
export const CAREER = { first: 2000, growth: 250, maxLevel: 55 };

const KEY = 'strikegy.career.v1';

export interface Career {
  xp: number;
  matches: number;
  wins: number;
  /** The last match, until the lobby has shown what it earned. */
  last?: { xp: number; won: boolean; before: number };
}

export function loadCareer(): Career {
  return { xp: 0, matches: 0, wins: 0, ...(loadJSON<Partial<Career>>(KEY) ?? {}) };
}

/** A match ended: its score goes on the career. */
export function addMatch(score: number, won: boolean): Career {
  const c = loadCareer();
  const xp = Math.max(0, Math.round(score));
  c.last = { xp, won, before: c.xp };
  c.xp += xp;
  c.matches++;
  if (won) c.wins++;
  saveJSON(KEY, c);
  return c;
}

/** What the last match earned, once (the lobby's calling card shows it). */
export function takeLast(): Career['last'] {
  const c = loadCareer();
  const last = c.last;
  if (last) {
    delete c.last;
    saveJSON(KEY, c);
  }
  return last;
}

/** Level for an XP total, and how far into it (0..1). */
export function levelOf(xp: number): { level: number; progress: number; need: number } {
  let level = 1;
  let left = Math.max(0, xp);
  for (;;) {
    const need = CAREER.first + CAREER.growth * (level - 1);
    if (level >= CAREER.maxLevel || left < need) return { level, progress: level >= CAREER.maxLevel ? 1 : left / need, need };
    left -= need;
    level++;
  }
}

/** A bot's level in the lobby: the same every time for the same name. */
export function botLevel(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return 1 + ((h >>> 0) % CAREER.maxLevel);
}
