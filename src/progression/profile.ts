/**
 * The player's progress (progression plan, docs/design/progression.md 4-4):
 * total XP (level and rank come from it), the service record's numbers, the
 * last 20 matches. Step 1 keeps it in this browser only (a guest's local
 * profile; the server account comes in step 2), with export / import as a file.
 * `applySummary` adds a finished match; the game server will run the same.
 * Kept free of the game's heavy modules (the main menu reads it).
 */
import { levelOf, rankAt, type LevelInfo, type RankId } from './levels';
import { afterMatch, cleanEcon, emptyEcon, settleCalendar, type BoostKind, type Econ, type MatchEcon } from './economy';
import type { CamoCounts } from './camo';
import type { MatchCounts } from './ribbons';

/** The service record's numbers (progression-data.md N), one set per kind of match. */
export interface CareerStats {
  matches: number;
  wins: number;
  /** Left before the end (the match's progress was undone, or only its bonuses lost). */
  quits: number;
  /** Not confirmed: idle for most of the match. */
  idle: number;
  /** Ended by the room's owner, the staff or the server (no winner: not in the win rate). */
  stopped: number;
  seconds: number;
  score: number;
  xp: number;
  kills: number;
  deaths: number;
  headshots: number;
  meleeKills: number;
  shots: number;
  hits: number;
  revives: number;
  resupplies: number;
  captures: number;
  neutralizes: number;
  builds: number;
  bestScore: number;
  /** Most kills in one life. */
  bestStreak: number;
}

export type MatchKind = 'bots' | 'multi';
/** `stopped`: ended by the staff or the room's owner, or the server stopped (not one's own doing). */
export type MatchResult = 'win' | 'loss' | 'left' | 'idle' | 'stopped';

export interface MatchRecord {
  at: number;
  kind: MatchKind;
  map: string;
  mode: string;
  result: MatchResult;
  score: number;
  kills: number;
  deaths: number;
  xp: number;
  /** The rank reached in this match, if it was a promotion. */
  promoted?: RankId;
}

export interface WeaponRecord {
  xp: number;
  kills: number;
  headshots: number;
}

export interface ClassRecord {
  xp: number;
  seconds: number;
  kills: number;
}

export interface Profile {
  v: 1;
  xp: number;
  stats: Record<MatchKind, CareerStats>;
  weapons: Record<string, WeaponRecord>;
  classes: Record<string, ClassRecord>;
  maps: Record<string, { matches: number; wins: number }>;
  modes: Record<string, { matches: number; wins: number }>;
  history: MatchRecord[];
  /** One-off things already given (the tutorial's bonus). */
  flags: { tutorial?: boolean; imported?: boolean };
  /** Bot-match XP taken on the server today (its daily cap; UTC day). */
  solo?: { day: string; xp: number };
  created: number;
  /** Supply tickets, cosmetics, camo challenges, missions, mail, boosters (progression step 5). */
  econ?: Econ;
}

/** What one match adds (built by `ProgressTracker`; the server's matches will build the same). */
export interface MatchSummary {
  kind: MatchKind;
  map: string;
  mode: string;
  result: MatchResult;
  seconds: number;
  /** The scoreboard score. */
  score: number;
  /** XP, after every multiplier (whole). */
  xp: number;
  /** The result screen's lines: what each part was worth before and after the multipliers. */
  lines: { key: XpLineKey; base: number; xp: number }[];
  /** The multipliers applied, in order (the result screen shows one a line). */
  mult: { key: MultKey; x: number }[];
  stats: Partial<CareerStats>;
  weapons: Record<string, WeaponRecord>;
  classes: Record<string, ClassRecord>;
  /** Feats counted (missions; step 5). */
  counts?: MatchCounts;
  /** Ribbons earned, by id. */
  ribbons?: Record<string, number>;
  /** Each weapon's camo challenge counts. */
  camo?: Record<string, CamoCounts>;
  /** The match's supply tickets (base, ribbons, places, bounties, the contract; boosted). */
  tickets?: number;
  /** The ticket lines for the result screen. */
  ticketLines?: { key: string; n: number }[];
  /** Booster seconds used in the match. */
  boosted?: Partial<Record<BoostKind, number>>;
}
export type XpLineKey = 'score' | 'sea' | 'build' | 'refill' | 'complete' | 'win' | 'tutorial' | 'ribbon' | 'booster';
export type MultKey = 'bots' | 'easy' | 'hard';

const KEY = 'strikegy.profile.v1';
/** A match in progress (written at its start, cleared at its end): still here later = it was left. */
const LIVE_KEY = 'strikegy.match.v1';
const HISTORY = 20;

export function emptyStats(): CareerStats {
  return {
    matches: 0,
    wins: 0,
    quits: 0,
    idle: 0,
    stopped: 0,
    seconds: 0,
    score: 0,
    xp: 0,
    kills: 0,
    deaths: 0,
    headshots: 0,
    meleeKills: 0,
    shots: 0,
    hits: 0,
    revives: 0,
    resupplies: 0,
    captures: 0,
    neutralizes: 0,
    builds: 0,
    bestScore: 0,
    bestStreak: 0,
  };
}

export function newProfile(now = Date.now()): Profile {
  return {
    v: 1,
    xp: 0,
    stats: { bots: emptyStats(), multi: emptyStats() },
    weapons: {},
    classes: {},
    maps: {},
    modes: {},
    history: [],
    flags: {},
    created: now,
    econ: emptyEcon(),
  };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function cleanStats(v: unknown): CareerStats {
  const o = obj(v);
  const s = emptyStats();
  for (const k of Object.keys(s) as (keyof CareerStats)[]) s[k] = num(o[k]);
  return s;
}

function cleanTable<T extends Record<string, number>>(
  v: unknown,
  keys: readonly (keyof T)[],
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, row] of Object.entries(obj(v))) {
    if (!/^[\w-]{1,32}$/.test(id)) continue;
    const r = obj(row);
    const t = {} as Record<keyof T, number>;
    for (const k of keys) t[k] = num(r[k as string]);
    out[id] = t as T;
  }
  return out;
}

/** A profile from storage or a file, with anything missing or wrong put right (never throws). */
export function cleanProfile(raw: unknown): Profile | null {
  const o = obj(raw);
  if (o.v !== 1) return null;
  const p = newProfile(num(o.created) || Date.now());
  p.xp = Math.floor(num(o.xp));
  const st = obj(o.stats);
  p.stats = { bots: cleanStats(st.bots), multi: cleanStats(st.multi) };
  p.weapons = cleanTable<{ xp: number; kills: number; headshots: number }>(o.weapons, [
    'xp',
    'kills',
    'headshots',
  ]);
  p.classes = cleanTable<{ xp: number; seconds: number; kills: number }>(o.classes, [
    'xp',
    'seconds',
    'kills',
  ]);
  p.maps = cleanTable<{ matches: number; wins: number }>(o.maps, ['matches', 'wins']);
  p.modes = cleanTable<{ matches: number; wins: number }>(o.modes, ['matches', 'wins']);
  const results: readonly MatchResult[] = ['win', 'loss', 'left', 'idle', 'stopped'];
  p.history = (Array.isArray(o.history) ? o.history : [])
    .map(obj)
    .filter((h) => results.includes(h.result as MatchResult))
    .slice(0, HISTORY)
    .map((h) => {
      const rec: MatchRecord = {
        at: num(h.at),
        kind: h.kind === 'multi' ? 'multi' : 'bots',
        map: String(h.map ?? '').slice(0, 32),
        mode: String(h.mode ?? '').slice(0, 32),
        result: h.result as MatchResult,
        score: num(h.score),
        kills: num(h.kills),
        deaths: num(h.deaths),
        xp: num(h.xp),
      };
      if (typeof h.promoted === 'string') rec.promoted = h.promoted as RankId;
      return rec;
    });
  if (obj(o.flags).tutorial === true) p.flags.tutorial = true;
  if (obj(o.flags).imported === true) p.flags.imported = true;
  const solo = obj(o.solo);
  if (typeof solo.day === 'string') p.solo = { day: solo.day.slice(0, 10), xp: num(solo.xp) };
  p.econ = cleanEcon(o.econ);
  // A profile from before step 5: its levels so far give their rewards on the next settle.
  if (o.econ === undefined) p.econ.rewardedLevel = 1;
  return p;
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    return (raw && cleanProfile(JSON.parse(raw))) || newProfile();
  } catch {
    return newProfile();
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: progress lasts this page only */
  }
}

/** The profile as a file's text (the service record's export button). */
export function exportProfile(p: Profile): string {
  return JSON.stringify({ game: 'strikegy', ...p }, null, 1);
}

/** A file's text back to a profile, or null when it isn't one. */
export function importProfile(text: string): Profile | null {
  try {
    return cleanProfile(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Both kinds of match added up (the service record's "all" view). */
export function totalStats(p: Profile): CareerStats {
  const out = emptyStats();
  for (const s of [p.stats.bots, p.stats.multi])
    for (const k of Object.keys(out) as (keyof CareerStats)[]) {
      out[k] = k === 'bestScore' || k === 'bestStreak' ? Math.max(out[k], s[k]) : out[k] + s[k];
    }
  return out;
}

export interface Applied {
  profile: Profile;
  before: LevelInfo;
  after: LevelInfo;
  /** Ranks reached on the way, lowest first. */
  promotions: RankId[];
  /** Tickets, items, missions, camo tiers the match brought (step 5). */
  econ?: MatchEcon;
}

/** Ranks first reached going from `fromXp` to `toXp`. */
export function promotionsBetween(fromXp: number, toXp: number): RankId[] {
  const a = levelOf(fromXp).level;
  const b = levelOf(toXp).level;
  const out: RankId[] = [];
  let last = rankAt(a).id;
  for (let l = a + 1; l <= b; l++) {
    const r = rankAt(l).id;
    if (r !== last) out.push(r);
    last = r;
  }
  return out;
}

/** Adds a match to the profile (a new profile; the old one is left as it was). */
export function applySummary(prev: Profile, s: MatchSummary, now = Date.now()): Applied {
  const p: Profile = structuredClone(prev);
  // The day / week turn before anything counts toward them (and level rewards owed are given).
  settleCalendar(p, now);
  const prevWeaponXp = Object.fromEntries(Object.entries(p.weapons).map(([id, w]) => [id, w.xp]));
  const before = levelOf(p.xp);
  p.xp += Math.max(0, Math.floor(s.xp));
  const st = p.stats[s.kind];
  const finished = s.result === 'win' || s.result === 'loss' || s.result === 'stopped';
  st.matches++;
  if (s.result === 'win') st.wins++;
  if (s.result === 'left') st.quits++;
  if (s.result === 'idle') st.idle++;
  if (s.result === 'stopped') st.stopped++;
  // A match left in a small room (or idled through) was undone: only the quit is kept.
  const counts = finished || s.xp > 0;
  if (counts) {
    for (const [k, v] of Object.entries(s.stats) as [keyof CareerStats, number][]) {
      if (k === 'bestStreak' || k === 'bestScore') st[k] = Math.max(st[k], v);
      else if (k !== 'matches' && k !== 'wins' && k !== 'quits' && k !== 'idle' && k !== 'stopped') st[k] += v;
    }
    st.score += s.score;
    st.xp += Math.floor(s.xp);
    st.seconds += s.seconds;
    st.bestScore = Math.max(st.bestScore, s.score);
    for (const [id, w] of Object.entries(s.weapons)) {
      const r = (p.weapons[id] ??= { xp: 0, kills: 0, headshots: 0 });
      r.xp += Math.floor(w.xp);
      r.kills += w.kills;
      r.headshots += w.headshots;
    }
    for (const [id, c] of Object.entries(s.classes)) {
      const r = (p.classes[id] ??= { xp: 0, seconds: 0, kills: 0 });
      r.xp += Math.floor(c.xp);
      r.seconds += c.seconds;
      r.kills += c.kills;
    }
  }
  if (finished) {
    for (const [table, id] of [
      [p.maps, s.map],
      [p.modes, s.mode],
    ] as const) {
      const r = (table[id] ??= { matches: 0, wins: 0 });
      r.matches++;
      if (s.result === 'win') r.wins++;
    }
  }
  const rec: MatchRecord = {
    at: now,
    kind: s.kind,
    map: s.map,
    mode: s.mode,
    result: s.result,
    score: s.score,
    kills: s.stats.kills ?? 0,
    deaths: s.stats.deaths ?? 0,
    xp: Math.floor(s.xp),
  };
  // Tickets, camo, missions (their XP too), level rewards.
  const econ = afterMatch(p, s, prevWeaponXp, now);
  const after = levelOf(p.xp);
  const promotions = promotionsBetween(prev.xp, p.xp);
  if (promotions.length) rec.promoted = promotions[promotions.length - 1];
  rec.xp = p.xp - prev.xp;
  p.history = [rec, ...p.history].slice(0, HISTORY);
  return { profile: p, before, after, promotions, econ };
}

/** XP given outside a match (the tutorial's one-off bonus). */
export function grantXp(prev: Profile, xp: number): Applied {
  const p: Profile = structuredClone(prev);
  const before = levelOf(p.xp);
  p.xp += Math.floor(xp);
  return { profile: p, before, after: levelOf(p.xp), promotions: promotionsBetween(prev.xp, p.xp) };
}

// ---------------------------------------------------------------------------
// A match in progress: written when it starts and cleared when it is settled,
// so one closed with the tab (or left from the menu) is found later and counted
// as left (progression.md 3-1-1: its progress is gone, the record says "left").

export interface LiveMatch {
  kind: MatchKind;
  map: string;
  mode: string;
  at: number;
}

export function beginLiveMatch(m: LiveMatch): void {
  try {
    localStorage.setItem(LIVE_KEY, JSON.stringify(m));
  } catch {
    /* nothing to find later */
  }
}

export function endLiveMatch(): void {
  try {
    localStorage.removeItem(LIVE_KEY);
  } catch {
    /* ignore */
  }
}

/** A match summary from outside (a browser's bot match sent to the server): anything wrong put right, null if it isn't one. */
export function cleanSummary(raw: unknown): MatchSummary | null {
  const o = obj(raw);
  const results: readonly MatchResult[] = ['win', 'loss', 'left', 'idle', 'stopped'];
  if (!results.includes(o.result as MatchResult)) return null;
  const lineKeys: readonly XpLineKey[] = ['score', 'sea', 'build', 'refill', 'complete', 'win', 'tutorial', 'ribbon', 'booster'];
  const multKeys: readonly MultKey[] = ['bots', 'easy', 'hard'];
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 16).map(obj) : []);
  const stats: Partial<CareerStats> = {};
  const st = obj(o.stats);
  for (const k of Object.keys(emptyStats()) as (keyof CareerStats)[]) if (k in st) stats[k] = num(st[k]);
  return {
    kind: o.kind === 'multi' ? 'multi' : 'bots',
    map: String(o.map ?? '').slice(0, 32),
    mode: String(o.mode ?? '').slice(0, 32),
    result: o.result as MatchResult,
    seconds: num(o.seconds),
    score: num(o.score),
    xp: Math.floor(num(o.xp)),
    lines: list(o.lines)
      .filter((l) => lineKeys.includes(l.key as XpLineKey))
      .map((l) => ({ key: l.key as XpLineKey, base: num(l.base), xp: num(l.xp) })),
    mult: list(o.mult)
      .filter((m) => multKeys.includes(m.key as MultKey))
      .map((m) => ({ key: m.key as MultKey, x: Math.min(2, num(m.x)) })),
    stats,
    weapons: cleanTable<{ xp: number; kills: number; headshots: number }>(o.weapons, ['xp', 'kills', 'headshots']),
    classes: cleanTable<{ xp: number; seconds: number; kills: number }>(o.classes, ['xp', 'seconds', 'kills']),
    counts: Object.fromEntries(Object.entries(obj(o.counts)).filter(([k]) => /^[\w.]{1,24}$/.test(k)).slice(0, 40).map(([k, v]) => [k, Math.floor(num(v))])) as MatchCounts,
    ribbons: Object.fromEntries(Object.entries(obj(o.ribbons)).filter(([k]) => /^\w{1,16}$/.test(k)).slice(0, 20).map(([k, v]) => [k, Math.min(3, Math.floor(num(v)))])),
    camo: cleanTable<CamoCounts & Record<string, number>>(o.camo, ['kills', 'headshots', 'triples', 'special']),
    tickets: Math.floor(num(o.tickets)),
    ticketLines: list(o.ticketLines).map((l) => ({ key: String(l.key ?? '').slice(0, 16), n: Math.floor(num(l.n)) })),
    boosted: Object.fromEntries(Object.entries(obj(o.boosted)).filter(([k]) => k === 'xp' || k === 'weapon' || k === 'tickets').map(([k, v]) => [k, num(v)])),
  };
}

/** The empty summary of a match that was left (its progress undone). */
export function leftSummary(
  m: Pick<LiveMatch, 'kind' | 'map' | 'mode'>,
  result: MatchResult = 'left',
): MatchSummary {
  return {
    kind: m.kind,
    map: m.map,
    mode: m.mode,
    result,
    seconds: 0,
    score: 0,
    xp: 0,
    lines: [],
    mult: [],
    stats: {},
    weapons: {},
    classes: {},
  };
}

/**
 * A match left unfinished earlier (menu, closed tab, a crash): recorded as left
 * and the marker cleared. Returns it, or null when there was none.
 */
export function settleAbandoned(
  record: (s: MatchSummary) => void = (s) => saveProfile(applySummary(loadProfile(), s).profile),
): LiveMatch | null {
  let m: LiveMatch | null = null;
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    if (raw) {
      const o = obj(JSON.parse(raw));
      m = {
        kind: o.kind === 'multi' ? 'multi' : 'bots',
        map: String(o.map ?? ''),
        mode: String(o.mode ?? ''),
        at: num(o.at),
      };
    }
  } catch {
    m = null;
  }
  if (!m) return null;
  endLiveMatch();
  record(leftSummary(m));
  return m;
}
