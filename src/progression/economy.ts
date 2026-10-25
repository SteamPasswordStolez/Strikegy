/**
 * Supply tickets (보급표), the shop and everything around them (progression
 * step 5; progression.md 3-11, progression-data.md D / L / S): what a match,
 * a level, a promotion, a weapon level, a camo tier and a mission pay, the
 * mailbox (salary, attendance), boosters, the week's shop, supply boxes (odds
 * shown, pity, no duplicates first, parts), the depot and the exchange.
 *
 * Everything here works on a profile copy and is the same in the browser (a
 * guest's local profile) and on the game server (an account): the time comes
 * in as `now`, and only opening a box draws a random number (`rand`, the
 * server's own for accounts). No tickets for money, ever: they only come from
 * playing. Numbers are the data doc's [제안].
 */
import { DAILY, MISSION, WEEKLY, drawMissions, missionDef, type MissionKey, type MissionState } from './missions';
import { CRAFT_PARTS, DEPOT_MARKUP, DUP_PARTS, PRICE, RARITIES, BUNDLES, VEHICLE_CLASSES, bundlePrice, item, levelRewards, seriesItems, weeklyPool, type Item, type Rarity } from './catalog';
import { advanceCamo, type CamoCounts, type CamoState } from './camo';
import { dayKey, dayNumber, hashText, monthKey, seeded, weekKey } from './calendar';
import { levelOf, rankAt, RANKS, type RankId } from './levels';
import { weaponLevelOf } from './unlocks';
import { CONTRACT_REROLL } from './contracts';
import type { MatchSummary, Profile } from './profile';

export type BoostKind = 'xp' | 'weapon' | 'tickets';
export type BoostItem = `${BoostKind}${30 | 60 | 180}`;

export const BOOSTERS: Record<BoostKind, { mult: number; price: Partial<Record<30 | 60 | 180, number>> }> = {
  xp: { mult: 2, price: { 30: 500, 60: 900, 180: 2400 } },
  weapon: { mult: 2, price: { 30: 400, 60: 700, 180: 1800 } },
  tickets: { mult: 1.5, price: { 60: 600, 180: 1500 } },
};

export const ECON = {
  /** Match tickets: XP / 200. */
  perXp: 1 / 200,
  levelTickets: (level: number) => (level < 100 ? 20 : 100),
  promotion: { enlisted: 500, nco: 1000, officer: 2000, general: 5000, marshal: 20000 },
  weaponLevel: 10,
  camo: { tier: 50, brass: 500, obsidian: 2000, dragon: 10000 },
  firstWin: { tickets: 300, boxes: 1 },
  boxPrice: 300,
  odds: { common: 0.55, uncommon: 0.27, rare: 0.12, epic: 0.05, legendary: 0.01 } as Record<Rarity, number>,
  pity: { epic: 20, legendary: 80 },
  partsPack: { price: 300, parts: 100 },
  pass: { price: 300, perDay: 2 },
  attendance: [50, 50, 100, 100, 150, 150, 0] as const,
  attendanceBoxes: 2,
  month: { days: 20, tickets: 1000 },
  /** Weekly salary by rank (paid on Monday for a week of 3+ finished matches). */
  salaryMatches: 3,
  mailDays: 30,
} as const;

export const SALARY: Record<RankId, number> = {
  pvt: 100, pfc: 150, cpl: 200, sgt: 300, ssg: 400, sfc: 500, msg: 600, sgm: 700,
  '2lt': 800, '1lt': 900, cpt: 1000, maj: 1200, ltc: 1400, col: 1600,
  bg: 2000, mg: 2200, ltg: 2400, gen: 2600, goa: 3000,
};

export interface Mail {
  id: string;
  at: number;
  reason: 'salary' | 'attendance' | 'month' | 'weekly' | 'gift';
  tickets?: number;
  boxes?: number;
  parts?: number;
  booster?: BoostItem;
}

export interface Econ {
  tickets: number;
  parts: number;
  /** Supply boxes waiting to be opened. */
  boxes: number;
  /** Owned cosmetics (catalog ids): when and where from, seen in the armory yet. */
  items: Record<string, { at: number; from: string; seen?: boolean }>;
  /**
   * What is worn: camo / skin / charm / kill effect per weapon (kill effect '*' for every gun without one of
   * its own), a vehicle skin per family, the card, emblem and name plate.
   */
  equip: { camo: Record<string, string>; skin: Record<string, string>; charm: Record<string, string>; kfx: Record<string, string>; vskin: Record<string, string>; card?: string; emblem?: string; plate?: string };
  /** Each weapon's camo challenges. */
  camo: Record<string, CamoState>;
  /** Level rewards given up to here. */
  rewardedLevel: number;
  day: { key: string; matches: number; wins: number; passes: number; rerolls: number };
  week: { key: string; matches: number; modes: string[] };
  att: { lastDay: string; cycle: number; month: string; days: number; monthPaid: boolean };
  missions: { day: string; daily: MissionState[]; week: string; weekly: MissionState[]; weeklyBonus: boolean };
  boosters: { owned: Partial<Record<BoostItem, number>>; left: Partial<Record<BoostKind, number>> };
  box: { opened: number; sinceEpic: number; sinceLegend: number };
  mail: Mail[];
}

export function emptyEcon(): Econ {
  return {
    tickets: 0,
    parts: 0,
    boxes: 0,
    items: {},
    equip: { camo: {}, skin: {}, charm: {}, kfx: {}, vskin: {} },
    camo: {},
    rewardedLevel: 1,
    day: { key: '', matches: 0, wins: 0, passes: 0, rerolls: 0 },
    week: { key: '', matches: 0, modes: [] },
    att: { lastDay: '', cycle: 0, month: '', days: 0, monthPaid: false },
    missions: { day: '', daily: [], week: '', weekly: [], weeklyBonus: false },
    boosters: { owned: {}, left: {} },
    box: { opened: 0, sinceEpic: 0, sinceLegend: 0 },
    mail: [],
  };
}

const n0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const o0 = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const s0 = (v: unknown, max = 40): string => (typeof v === 'string' ? v.slice(0, max) : '');
const id0 = (v: unknown): v is string => typeof v === 'string' && /^[\w.-]{1,48}$/.test(v);

/** An economy from storage or the server, anything wrong put right. */
export function cleanEcon(raw: unknown): Econ {
  const o = o0(raw);
  const e = emptyEcon();
  e.tickets = Math.floor(n0(o.tickets));
  e.parts = Math.floor(n0(o.parts));
  e.boxes = Math.floor(n0(o.boxes));
  for (const [k, v] of Object.entries(o0(o.items))) {
    // Catalog items, plus the challenge flags (obsidian for a kind, the dragon).
    if (!id0(k) || (!item(k) && !/^(obsidian\.\w+|dragon)$/.test(k))) continue;
    const r = o0(v);
    e.items[k] = { at: n0(r.at), from: s0(r.from, 16) || 'level', ...(r.seen === true ? { seen: true } : {}) };
  }
  const eq = o0(o.equip);
  for (const [w, c] of Object.entries(o0(eq.camo))) if (id0(w) && id0(c)) e.equip.camo[w] = c;
  for (const slot of ['skin', 'charm', 'kfx', 'vskin'] as const) for (const [w, c] of Object.entries(o0(eq[slot]))) if ((id0(w) || w === '*') && id0(c) && item(c)) e.equip[slot][w] = c;
  for (const k of ['card', 'emblem', 'plate'] as const) if (id0(eq[k])) e.equip[k] = eq[k] as string;
  for (const [w, c] of Object.entries(o0(o.camo))) {
    if (!id0(w)) continue;
    const r = o0(c);
    e.camo[w] = { tier: Math.min(6, Math.floor(n0(r.tier))), prog: Math.floor(n0(r.prog)) };
  }
  e.rewardedLevel = Math.max(1, Math.floor(n0(o.rewardedLevel)) || 1);
  const day = o0(o.day);
  e.day = { key: s0(day.key, 10), matches: n0(day.matches), wins: n0(day.wins), passes: n0(day.passes), rerolls: n0(day.rerolls) };
  const wk = o0(o.week);
  e.week = { key: s0(wk.key, 10), matches: n0(wk.matches), modes: (Array.isArray(wk.modes) ? wk.modes : []).filter(id0).slice(0, 20) };
  const att = o0(o.att);
  e.att = { lastDay: s0(att.lastDay, 10), cycle: Math.floor(n0(att.cycle)) % 7, month: s0(att.month, 7), days: n0(att.days), monthPaid: att.monthPaid === true };
  const mi = o0(o.missions);
  const ms = (v: unknown, daily: boolean): MissionState[] =>
    (Array.isArray(v) ? v : [])
      .map(o0)
      .filter((m) => id0(m.id) && missionDef(daily, m.id as string))
      .slice(0, daily ? MISSION.daily.count : MISSION.weekly.count)
      .map((m) => ({ id: m.id as string, prog: n0(m.prog), done: m.done === true }));
  e.missions = { day: s0(mi.day, 10), daily: ms(mi.daily, true), week: s0(mi.week, 10), weekly: ms(mi.weekly, false), weeklyBonus: mi.weeklyBonus === true };
  const bo = o0(o.boosters);
  for (const [k, v] of Object.entries(o0(bo.owned))) if (isBoostItem(k)) e.boosters.owned[k] = Math.floor(n0(v));
  for (const [k, v] of Object.entries(o0(bo.left))) if (k === 'xp' || k === 'weapon' || k === 'tickets') e.boosters.left[k] = n0(v);
  const bx = o0(o.box);
  e.box = { opened: n0(bx.opened), sinceEpic: n0(bx.sinceEpic), sinceLegend: n0(bx.sinceLegend) };
  e.mail = (Array.isArray(o.mail) ? o.mail : [])
    .map(o0)
    .filter((m) => typeof m.id === 'string' && /^[\w.:-]{1,48}$/.test(m.id))
    .slice(0, 60)
    .map((m) => {
      const mail: Mail = { id: m.id as string, at: n0(m.at), reason: (['salary', 'attendance', 'month', 'weekly', 'gift'].includes(m.reason as string) ? m.reason : 'gift') as Mail['reason'] };
      if (n0(m.tickets)) mail.tickets = Math.floor(n0(m.tickets));
      if (n0(m.boxes)) mail.boxes = Math.floor(n0(m.boxes));
      if (n0(m.parts)) mail.parts = Math.floor(n0(m.parts));
      if (isBoostItem(m.booster)) mail.booster = m.booster;
      return mail;
    });
  return e;
}

export function isBoostItem(v: unknown): v is BoostItem {
  if (typeof v !== 'string') return false;
  const m = /^(xp|weapon|tickets)(30|60|180)$/.exec(v);
  return !!m && BOOSTERS[m[1] as BoostKind].price[Number(m[2]) as 30 | 60 | 180] !== undefined;
}

function boostParts(b: BoostItem): [BoostKind, 30 | 60 | 180] {
  const m = /^(xp|weapon|tickets)(30|60|180)$/.exec(b)!;
  return [m[1] as BoostKind, Number(m[2]) as 30 | 60 | 180];
}

/** A profile's economy (old profiles get an empty one). */
export function econOf(p: Profile): Econ {
  return (p.econ ??= emptyEcon());
}

// ---------------------------------------------------------------------------
// Calendar: days, weeks, months turning (call before anything reads the dailies).

function missionSeed(p: Profile): string {
  return `m${p.created}`;
}

/**
 * Turns the day, week and month over as `now` needs: new dailies / weeklies,
 * the salary for a week of three finished matches, the attendance month,
 * expired mail gone, and level rewards not given yet. Changes `p`.
 */
export function settleCalendar(p: Profile, now: number): void {
  const e = econOf(p);
  const today = dayKey(now);
  if (e.day.key !== today) {
    e.day = { key: today, matches: 0, wins: 0, passes: 0, rerolls: 0 };
  }
  if (e.missions.day !== today) {
    e.missions.day = today;
    e.missions.daily = drawMissions(DAILY, MISSION.daily.count, `${missionSeed(p)}:d:${today}`);
  }
  const week = weekKey(now);
  if (e.week.key !== week) {
    // Last week's salary: three finished matches earn the rank's pay.
    if (e.week.key && e.week.matches >= ECON.salaryMatches) {
      const rank = rankAt(levelOf(p.xp).level).id;
      mail(e, now, 'salary', { tickets: SALARY[rank] ?? 100 }, `sal:${e.week.key}`);
    }
    e.week = { key: week, matches: 0, modes: [] };
  }
  if (e.missions.week !== week) {
    e.missions.week = week;
    e.missions.weekly = drawMissions(WEEKLY, MISSION.weekly.count, `${missionSeed(p)}:w:${week}`);
    e.missions.weeklyBonus = false;
  }
  const month = monthKey(now);
  if (e.att.month !== month) e.att = { ...e.att, month, days: 0, monthPaid: false };
  e.mail = e.mail.filter((m) => now - m.at < ECON.mailDays * 86_400_000);
  grantLevels(p, now);
}

function mail(e: Econ, now: number, reason: Mail['reason'], what: Omit<Mail, 'id' | 'at' | 'reason'>, id: string): void {
  if (e.mail.some((m) => m.id === id)) return;
  e.mail.push({ id, at: now, reason, ...what });
}

/** Takes the mail with `id` (all of it with none): its tickets, boxes, parts and boosters into the profile. */
export function claimMail(p: Profile, id?: string): Mail[] {
  const e = econOf(p);
  const taken = e.mail.filter((m) => !id || m.id === id);
  for (const m of taken) {
    e.tickets += m.tickets ?? 0;
    e.boxes += m.boxes ?? 0;
    e.parts += m.parts ?? 0;
    if (m.booster) e.boosters.owned[m.booster] = (e.boosters.owned[m.booster] ?? 0) + 1;
  }
  e.mail = e.mail.filter((m) => !taken.includes(m));
  return taken;
}

// ---------------------------------------------------------------------------
// Levels and promotions.

function promotionTickets(rank: RankId): number {
  const i = RANKS.findIndex((r) => r.id === rank);
  if (rank === 'goa') return ECON.promotion.marshal;
  if (i >= RANKS.findIndex((r) => r.id === 'bg')) return ECON.promotion.general;
  if (i >= RANKS.findIndex((r) => r.id === '2lt')) return ECON.promotion.officer;
  if (i >= RANKS.findIndex((r) => r.id === 'ssg')) return ECON.promotion.nco;
  return ECON.promotion.enlisted;
}

/** What the levels gained since `rewardedLevel` give: their items, tickets, promotion tickets and boosters. Returns the new items. */
export function grantLevels(p: Profile, now: number): string[] {
  const e = econOf(p);
  const level = levelOf(p.xp).level;
  const got: string[] = [];
  for (let l = e.rewardedLevel + 1; l <= level; l++) {
    e.tickets += ECON.levelTickets(l);
    for (const it of levelRewards(l)) if (giveItem(e, it.id, now, 'level')) got.push(it.id);
    const r = rankAt(l);
    if (r.from === l && l > 1) {
      e.tickets += promotionTickets(r.id);
      // From 하사 on a promotion also brings half an hour of the XP booster.
      if (RANKS.findIndex((x) => x.id === r.id) >= RANKS.findIndex((x) => x.id === 'ssg')) e.boosters.owned.xp30 = (e.boosters.owned.xp30 ?? 0) + 1;
    }
  }
  e.rewardedLevel = Math.max(e.rewardedLevel, level);
  return got;
}

function giveItem(e: Econ, id: string, now: number, from: string): boolean {
  const it = item(id);
  if (e.items[id] || !it) return false;
  e.items[id] = { at: now, from };
  // A legendary skin's own kill effect comes with it.
  for (const g of it.grants ?? []) if (!e.items[g] && item(g)) e.items[g] = { at: now, from };
  return true;
}

// ---------------------------------------------------------------------------
// After a match.

/** What a match's economy came to (the result screen). */
export interface MatchEcon {
  tickets: number;
  /** Lines: match, ribbons, first match of the day, first win, missions, levels... */
  lines: { key: string; n: number }[];
  items: string[];
  missions: { id: string; daily: boolean }[];
  camo: { weapon: string; tier: number }[];
  boxes: number;
}

/**
 * The economy side of a confirmed match (called by `applySummary` after XP
 * and stats): the match's tickets (doubled for the day's first), weapon levels
 * and camo tiers, attendance, the day's first win, missions, boosters used,
 * then level rewards. `prevWeaponXp`: each weapon's XP before.
 */
export function afterMatch(p: Profile, s: MatchSummary, prevWeaponXp: Record<string, number>, now: number): MatchEcon {
  settleCalendar(p, now);
  const e = econOf(p);
  const out: MatchEcon = { tickets: 0, lines: [], items: [], missions: [], camo: [], boxes: 0 };
  const pay = (key: string, n: number) => {
    if (n <= 0) return;
    e.tickets += n;
    out.tickets += n;
    out.lines.push({ key, n });
  };
  const finished = s.result === 'win' || s.result === 'loss' || s.result === 'stopped';
  const counted = finished || s.xp > 0;
  if (counted) {
    // The match's own tickets (worked out by the tracker: base, ribbons, places, bounties, the contract);
    // the day's first finished match pays them twice.
    const match = Math.floor(s.tickets ?? 0);
    pay('match', match);
    if (finished && e.day.matches === 0) pay('firstMatch', match);
  }
  // Weapon levels: 10 tickets each.
  let weaponLevels = 0;
  for (const [id, w] of Object.entries(s.weapons)) {
    const a = weaponLevelOf(prevWeaponXp[id] ?? 0).level;
    const b = weaponLevelOf((prevWeaponXp[id] ?? 0) + Math.floor(w.xp)).level;
    weaponLevels += Math.max(0, b - a);
  }
  pay('weaponLevels', weaponLevels * ECON.weaponLevel);
  // Camo challenges.
  let camoTiers = 0;
  for (const [id, c] of Object.entries(s.camo ?? {})) {
    const cls = weaponClassOf(id);
    if (!cls) continue;
    const st = (e.camo[id] ??= { tier: 0, prog: 0 });
    for (const t of advanceCamo(st, c as CamoCounts, cls)) {
      camoTiers++;
      out.camo.push({ weapon: id, tier: t });
      pay('camo', t >= 6 ? ECON.camo.brass : ECON.camo.tier);
    }
  }
  pay('camoClass', camoClassRewards(e, out, now));
  if (finished) {
    e.day.matches++;
    e.week.matches++;
    if (!e.week.modes.includes(s.mode)) e.week.modes.push(s.mode);
    // Attendance: the day's first finished match.
    const today = dayKey(now);
    if (e.att.lastDay !== today) {
      e.att.lastDay = today;
      const step = e.att.cycle % 7;
      if (step === 6) mail(e, now, 'attendance', { boxes: ECON.attendanceBoxes }, `att:${today}`);
      else mail(e, now, 'attendance', { tickets: ECON.attendance[step] }, `att:${today}`);
      e.att.cycle = (e.att.cycle + 1) % 7;
      e.att.days++;
      if (e.att.days >= ECON.month.days && !e.att.monthPaid) {
        e.att.monthPaid = true;
        mail(e, now, 'month', { tickets: ECON.month.tickets, booster: 'xp60' }, `month:${e.att.month}`);
      }
    }
    if (s.result === 'win') {
      if (e.day.wins === 0) {
        pay('firstWin', ECON.firstWin.tickets);
        e.boxes += ECON.firstWin.boxes;
        out.boxes += ECON.firstWin.boxes;
      }
      e.day.wins++;
    }
  }
  // Missions.
  const derived: Partial<Record<MissionKey, number>> = {
    ...(counted ? (s.counts as Partial<Record<MissionKey, number>> | undefined) : {}),
    finished: finished ? 1 : 0,
    wins: s.result === 'win' ? 1 : 0,
    weaponLevels,
    camoTiers,
    modes: e.week.modes.length,
  };
  if (finished) for (const [cls, c] of Object.entries(s.classes)) if (c.seconds >= 60) derived[`class.${cls}`] = 1;
  let missionXp = 0;
  for (const daily of [true, false]) {
    const list = daily ? e.missions.daily : e.missions.weekly;
    for (const m of list) {
      if (m.done) continue;
      const def = missionDef(daily, m.id);
      if (!def) continue;
      const add = derived[def.key] ?? 0;
      m.prog = def.key === 'modes' ? add : m.prog + add;
      if (m.prog >= def.n) {
        m.prog = def.n;
        m.done = true;
        out.missions.push({ id: m.id, daily });
        const r = daily ? MISSION.daily : MISSION.weekly;
        missionXp += r.xp;
        pay('mission', r.tickets);
      }
    }
  }
  if (!e.missions.weeklyBonus && e.missions.weekly.length && e.missions.weekly.every((m) => m.done)) {
    e.missions.weeklyBonus = true;
    e.boxes += MISSION.weekly.allBoxes;
    out.boxes += MISSION.weekly.allBoxes;
  }
  if (missionXp) {
    p.xp += missionXp;
    out.lines.push({ key: 'missionXp', n: missionXp });
  }
  // Boosters used in the match.
  for (const [k, sec] of Object.entries(s.boosted ?? {}) as [BoostKind, number][]) {
    const left = e.boosters.left[k] ?? 0;
    e.boosters.left[k] = Math.max(0, left - sec);
  }
  const before = e.tickets;
  out.items.push(...grantLevels(p, now));
  if (e.tickets > before) out.lines.push({ key: 'levels', n: e.tickets - before });
  out.tickets += e.tickets - before;
  return out;
}

function weaponClassOf(id: string): import('@/weapons/weaponData').WeaponClass | null {
  return WEAPON_CLASSES[id] ?? null;
}

/** Weapon id -> kind (kept here as plain data: the economy doesn't import the game's weapons). */
export const WEAPON_CLASSES: Record<string, import('@/weapons/weaponData').WeaponClass> = {
  ar1: 'ar', ar2: 'ar', ar3: 'ar', ar4: 'ar',
  smg1: 'smg', smg2: 'smg', smg3: 'smg', smg4: 'smg',
  lmg1: 'lmg', lmg2: 'lmg', lmg3: 'lmg',
  sg1: 'sg', sg2: 'sg', sg3: 'sg',
  dmr1: 'dmr', dmr2: 'dmr', dmr3: 'dmr',
  sr1: 'sr', sr2: 'sr', sr3: 'sr',
  pistol1: 'pistol', pistol2: 'pistol', pistol3: 'pistol',
};

/** Kinds with every gun in brass (obsidian open for them). */
export function obsidianClasses(e: Econ): string[] {
  const kinds = [...new Set(Object.values(WEAPON_CLASSES))];
  return kinds.filter((k) => Object.entries(WEAPON_CLASSES).every(([id, c]) => c !== k || (e.camo[id]?.tier ?? 0) >= 6));
}

/** Every kind in obsidian: the blue dragon for every gun. */
export function dragonOpen(e: Econ): boolean {
  return obsidianClasses(e).length === new Set(Object.values(WEAPON_CLASSES)).size;
}

/** Obsidian for a kind and the dragon pay once, when first reached (flags as items). */
function camoClassRewards(e: Econ, out: MatchEcon, now: number): number {
  let n = 0;
  for (const k of obsidianClasses(e)) {
    const flag = `obsidian.${k}`;
    if (!e.items[flag]) {
      e.items[flag] = { at: now, from: 'challenge' };
      n += ECON.camo.obsidian;
      out.items.push(flag);
    }
  }
  if (dragonOpen(e) && !e.items['dragon']) {
    e.items['dragon'] = { at: now, from: 'challenge' };
    giveItem(e, 'kfx.dragonscale', now, 'challenge');
    n += ECON.camo.dragon;
    out.items.push('dragon');
  }
  return n;
}

/** The camo ids one weapon may wear: its finished tiers, brass, obsidian / dragon when open, and every shared camo owned. */
export function camoChoices(e: Econ, weapon: string): string[] {
  const out: string[] = [];
  const tier = e.camo[weapon]?.tier ?? 0;
  for (let t = 1; t <= Math.min(5, tier); t++) out.push(`wc${t}`);
  if (tier >= 6) out.push('brass');
  const cls = WEAPON_CLASSES[weapon];
  if (cls && e.items[`obsidian.${cls}`]) out.push('obsidian');
  if (e.items['dragon']) out.push('dragon');
  for (const id of Object.keys(e.items)) if (item(id)?.kind === 'camo') out.push(id);
  return out;
}

// ---------------------------------------------------------------------------
// Boosters.

/** Starts (or extends) a booster the player owns. */
export function activateBooster(p: Profile, b: BoostItem): boolean {
  const e = econOf(p);
  if (!e.boosters.owned[b]) return false;
  const [kind, min] = boostParts(b);
  e.boosters.owned[b]!--;
  if (!e.boosters.owned[b]) delete e.boosters.owned[b];
  e.boosters.left[kind] = (e.boosters.left[kind] ?? 0) + min * 60;
  return true;
}

/** What boosters are running (seconds of match time left each). */
export function boostsLeft(p: Profile): Partial<Record<BoostKind, number>> {
  const e = econOf(p);
  const out: Partial<Record<BoostKind, number>> = {};
  for (const [k, v] of Object.entries(e.boosters.left) as [BoostKind, number][]) if (v > 0) out[k] = v;
  return out;
}

// ---------------------------------------------------------------------------
// The shop.

export type ShopError = 'funds' | 'owned' | 'gone' | 'limit' | 'bad';

export interface Offer {
  key: string;
  /** Items in it (a bundle has three). */
  items: string[];
  price: number;
  bundle?: string;
  /** Shown large at the top of the week's shop. */
  featured?: boolean;
  /** Today's deal. */
  deal?: boolean;
}

/**
 * What the week's shop holds, in order: a bundle, two featured pieces (an epic or legendary gun skin,
 * an epic or better kill effect / vehicle skin / charm), then three gun skins, a charm, a vehicle skin,
 * a kill effect and three of the rest (camo, card, emblem, plate). Seeded by the week (owner,
 * 2026-10-25: a random rotation through a big pool).
 */
export const WEEK_SLOTS: { kinds: Item['kind'][]; rarities?: Rarity[]; featured?: boolean }[] = [
  { kinds: ['skin'], rarities: ['epic', 'legendary'], featured: true },
  { kinds: ['kfx', 'vskin', 'charm'], rarities: ['epic', 'legendary'], featured: true },
  { kinds: ['skin'], rarities: ['rare', 'epic'] },
  { kinds: ['skin'], rarities: ['rare', 'epic'] },
  { kinds: ['skin'] },
  { kinds: ['charm'] },
  { kinds: ['vskin'] },
  { kinds: ['kfx'] },
  { kinds: ['camo'] },
  { kinds: ['card', 'emblem'] },
  { kinds: ['camo', 'plate', 'emblem', 'card'] },
];

export function weeklyOffer(now: number): Offer[] {
  const week = weekKey(now);
  const rand = seeded(hashText(`shop:${week}`));
  const b = BUNDLES[hashText(week) % BUNDLES.length]!;
  const out: Offer[] = [{ key: `bundle.${b.id}`, items: b.items, price: bundlePrice(b), bundle: b.id }];
  const taken = new Set(b.items);
  const pool = weeklyPool();
  for (const slot of WEEK_SLOTS) {
    const fits = pool.filter((i) => !taken.has(i.id) && slot.kinds.includes(i.kind) && (!slot.rarities || slot.rarities.includes(i.rarity)));
    // Skins: one per gun a week, so the slots don't all land on one rifle.
    const skinGuns = new Set(out.flatMap((o) => o.items.map((id) => item(id)?.weapon).filter(Boolean)));
    const list = fits.filter((i) => i.kind !== 'skin' || !skinGuns.has(i.weapon)).length ? fits.filter((i) => i.kind !== 'skin' || !skinGuns.has(i.weapon)) : fits;
    if (!list.length) continue;
    const it = list[Math.floor(rand() * list.length)]!;
    taken.add(it.id);
    out.push({ key: it.id, items: [it.id], price: PRICE[it.rarity], ...(slot.featured ? { featured: true } : {}) });
  }
  return out;
}

/** Today's deal: one piece from the pool, not in this week's shop, at 70 % (the day turns at 05:00 KST). */
export const DEAL_SHARE = 0.7;
export function dailyDeal(now: number): Offer {
  const week = new Set(weeklyOffer(now).flatMap((o) => o.items));
  const pool = weeklyPool().filter((i) => !week.has(i.id) && i.rarity !== 'common');
  const it = pool[hashText(`deal:${dayKey(now)}`) % pool.length]!;
  return { key: `deal.${it.id}`, items: [it.id], price: Math.round(PRICE[it.rarity] * DEAL_SHARE), deal: true };
}

/** The depot: the week pool's other items, any time, at 120 %. */
export function depotOffer(now: number): Offer[] {
  const week = new Set(weeklyOffer(now).flatMap((o) => o.items));
  return weeklyPool()
    .filter((i) => !week.has(i.id))
    .map((i) => ({ key: i.id, items: [i.id], price: Math.round(PRICE[i.rarity] * DEPOT_MARKUP) }));
}

/** Buys an offer from the week's shop or the depot. */
export function buy(p: Profile, key: string, now: number): ShopError | null {
  const e = econOf(p);
  const offer = [...weeklyOffer(now), dailyDeal(now), ...depotOffer(now)].find((o) => o.key === key);
  if (!offer) return 'gone';
  const missing = offer.items.filter((id) => !e.items[id]);
  if (!missing.length) return 'owned';
  // A bundle with some items owned costs what's left of it (still 75 %).
  const price = offer.bundle ? Math.round(offer.price * (missing.length / offer.items.length)) : offer.price;
  if (e.tickets < price) return 'funds';
  e.tickets -= price;
  for (const id of missing) giveItem(e, id, now, offer.bundle ? 'bundle' : offer.deal ? 'weekly' : weeklyOffer(now).some((o) => o.key === key) ? 'weekly' : 'depot');
  return null;
}

/** Buys a booster into the player's stock. */
export function buyBooster(p: Profile, b: BoostItem): ShopError | null {
  if (!isBoostItem(b)) return 'bad';
  const e = econOf(p);
  const [kind, min] = boostParts(b);
  const price = BOOSTERS[kind].price[min]!;
  if (e.tickets < price) return 'funds';
  e.tickets -= price;
  e.boosters.owned[b] = (e.boosters.owned[b] ?? 0) + 1;
  return null;
}

/** Buys a supply box (300). */
export function buyBox(p: Profile, count = 1): ShopError | null {
  const e = econOf(p);
  const price = ECON.boxPrice * count;
  if (count < 1 || count > 10) return 'bad';
  if (e.tickets < price) return 'funds';
  e.tickets -= price;
  e.boxes += count;
  return null;
}

export interface BoxResult {
  item: string | null;
  rarity: Rarity;
  /** A rarity already complete gives parts instead. */
  parts: number;
}

/** The rarity a box draws: the odds, with the pity counters forcing epic (20) / legendary (80). */
export function drawRarity(e: Econ, rand: () => number): Rarity {
  if (e.box.sinceLegend + 1 >= ECON.pity.legendary) return 'legendary';
  if (e.box.sinceEpic + 1 >= ECON.pity.epic) return rand() < ECON.odds.legendary / (ECON.odds.legendary + ECON.odds.epic) ? 'legendary' : 'epic';
  let r = rand();
  for (const rar of [...RARITIES].reverse()) {
    r -= ECON.odds[rar];
    if (r < 0) return rar;
  }
  return 'common';
}

/**
 * Opens one owned box: a rarity by the odds and pity, then something of that
 * rarity from the series not owned yet; a rarity already complete turns into
 * parts. The result is in the profile before anyone sees it.
 */
export function openBox(p: Profile, rand: () => number, now: number): BoxResult | ShopError {
  const e = econOf(p);
  if (e.boxes < 1) return 'gone';
  e.boxes--;
  const rarity = drawRarity(e, rand);
  e.box.opened++;
  e.box.sinceEpic = rarity === 'epic' || rarity === 'legendary' ? 0 : e.box.sinceEpic + 1;
  e.box.sinceLegend = rarity === 'legendary' ? 0 : e.box.sinceLegend + 1;
  const left = seriesItems().filter((i) => i.rarity === rarity && !e.items[i.id]);
  if (!left.length) {
    e.parts += DUP_PARTS[rarity];
    return { item: null, rarity, parts: DUP_PARTS[rarity] };
  }
  const pick = left[Math.floor(rand() * left.length)]!;
  giveItem(e, pick.id, now, 'box');
  return { item: pick.id, rarity, parts: 0 };
}

/** The exchange: makes a series item from parts. */
export function craft(p: Profile, id: string, now: number): ShopError | null {
  const e = econOf(p);
  const it: Item | undefined = item(id);
  if (!it || it.source !== 'box') return 'bad';
  if (e.items[id]) return 'owned';
  const price = CRAFT_PARTS[it.rarity];
  if (e.parts < price) return 'funds';
  e.parts -= price;
  giveItem(e, id, now, 'craft');
  return null;
}

/** Parts for tickets (300 -> 100), to top up the exchange. */
export function buyParts(p: Profile): ShopError | null {
  const e = econOf(p);
  if (e.tickets < ECON.partsPack.price) return 'funds';
  e.tickets -= ECON.partsPack.price;
  e.parts += ECON.partsPack.parts;
  return null;
}

/** Swaps a daily mission for another (one free a day, then three at 100). */
export function rerollMission(p: Profile, index: number, now: number): ShopError | null {
  settleCalendar(p, now);
  const e = econOf(p);
  const m = e.missions.daily[index];
  if (!m || m.done) return 'bad';
  const used = e.day.rerolls;
  if (used >= MISSION.rerollFree + MISSION.rerollPaid) return 'limit';
  const price = used < MISSION.rerollFree ? 0 : MISSION.rerollPrice;
  if (e.tickets < price) return 'funds';
  e.tickets -= price;
  e.day.rerolls++;
  const skip = e.missions.daily.map((x) => x.id);
  const next = drawMissions(DAILY, 1, `${missionSeed(p)}:d:${e.day.key}:r${used}:${index}`, skip)[0];
  if (!next) return 'gone';
  e.missions.daily[index] = next;
  return null;
}

/** A leave pass (외출증, 300, two a day): leaving a solo match or a small room keeps what rose. */
export function buyPass(p: Profile, now: number): ShopError | null {
  settleCalendar(p, now);
  const e = econOf(p);
  if (e.day.passes >= ECON.pass.perDay) return 'limit';
  if (e.tickets < ECON.pass.price) return 'funds';
  e.tickets -= ECON.pass.price;
  e.day.passes++;
  return null;
}

export type EquipSlot = 'camo' | 'card' | 'emblem' | 'plate' | 'skin' | 'charm' | 'kfx' | 'vskin';

/**
 * Wears something (only what is owned; undefined: back to the default): a camo, skin, charm or kill effect
 * on a weapon (`weapon`; kill effect '*' for every gun), a vehicle skin on a family (`weapon` = the family),
 * or a card / emblem / plate.
 */
export function equip(p: Profile, slot: EquipSlot, value: string | undefined, weapon?: string): ShopError | null {
  const e = econOf(p);
  if (slot === 'skin' || slot === 'charm' || slot === 'kfx' || slot === 'vskin') {
    const ok = slot === 'vskin' ? (VEHICLE_CLASSES as readonly string[]).includes(weapon ?? '') : weapon === '*' ? slot === 'kfx' : !!weapon && !!WEAPON_CLASSES[weapon];
    if (!ok) return 'bad';
    if (!value) {
      delete e.equip[slot][weapon!];
      return null;
    }
    const it = item(value);
    if (!e.items[value] || it?.kind !== slot) return 'owned';
    if (slot === 'skin' && it.weapon !== weapon) return 'bad';
    if (slot === 'vskin' && it.vclass !== weapon) return 'bad';
    e.equip[slot][weapon!] = value;
    return null;
  }
  if (slot === 'camo') {
    if (!weapon || !WEAPON_CLASSES[weapon]) return 'bad';
    if (!value) delete e.equip.camo[weapon];
    else if (camoChoices(e, weapon).includes(value)) e.equip.camo[weapon] = value;
    else return 'owned';
    return null;
  }
  if (!value) delete e.equip[slot];
  else if (e.items[value] && item(value)?.kind === slot) e.equip[slot] = value;
  else return 'owned';
  return null;
}

/** Marks items seen (the armory's new-item dots). */
export function markSeen(p: Profile, ids: readonly string[]): void {
  const e = econOf(p);
  for (const id of ids) if (e.items[id]) e.items[id]!.seen = true;
}

/** Days until a gap breaks nothing: attendance never resets (no streak rewards), this is only for the UI. */
export function attendanceStep(e: Econ): number {
  return e.att.cycle % 7;
}

/** A new set of field contracts on the deploy screen (the browser keeps count of a match's rerolls). */
export function payContractRoll(p: Profile): ShopError | null {
  const e = econOf(p);
  if (e.tickets < CONTRACT_REROLL.price) return 'funds';
  e.tickets -= CONTRACT_REROLL.price;
  return null;
}

/** Game days since the epoch (tests). */
export { dayNumber };

// ---------------------------------------------------------------------------
// One entry point for the shop and the armory, the same in a guest's browser and on the server.

export type ShopOp =
  | { op: 'buy'; key: string }
  | { op: 'booster'; item: BoostItem }
  | { op: 'activate'; item: BoostItem }
  | { op: 'box'; count: number }
  | { op: 'open' }
  | { op: 'craft'; item: string }
  | { op: 'parts' }
  | { op: 'reroll'; index: number }
  | { op: 'pass' }
  | { op: 'contract' }
  | { op: 'claim'; id?: string }
  | { op: 'equip'; slot: EquipSlot; value?: string; weapon?: string }
  | { op: 'seen'; items: string[] };

/** A shop action from outside, checked; null when it isn't one. */
export function parseShopOp(raw: unknown): ShopOp | null {
  const o = o0(raw);
  const str = (v: unknown, max = 48) => typeof v === 'string' && v.length > 0 && v.length <= max && /^[\w.:-]+$/.test(v);
  switch (o.op) {
    case 'buy':
      return str(o.key) ? { op: 'buy', key: o.key as string } : null;
    case 'booster':
    case 'activate':
      return isBoostItem(o.item) ? { op: o.op, item: o.item } : null;
    case 'box':
      return Number.isInteger(o.count) && (o.count as number) >= 1 && (o.count as number) <= 10 ? { op: 'box', count: o.count as number } : null;
    case 'open':
    case 'parts':
    case 'pass':
    case 'contract':
      return { op: o.op };
    case 'craft':
      return str(o.item) ? { op: 'craft', item: o.item as string } : null;
    case 'reroll':
      return Number.isInteger(o.index) && (o.index as number) >= 0 && (o.index as number) < 3 ? { op: 'reroll', index: o.index as number } : null;
    case 'claim':
      return o.id === undefined || str(o.id) ? { op: 'claim', id: o.id as string | undefined } : null;
    case 'equip':
      if (!['camo', 'card', 'emblem', 'plate', 'skin', 'charm', 'kfx', 'vskin'].includes(o.slot as string)) return null;
      if (o.value !== undefined && !str(o.value)) return null;
      if (o.weapon !== undefined && o.weapon !== '*' && !str(o.weapon, 16)) return null;
      return { op: 'equip', slot: o.slot as EquipSlot, value: o.value as string | undefined, weapon: o.weapon as string | undefined };
    case 'seen':
      return Array.isArray(o.items) ? { op: 'seen', items: (o.items as unknown[]).filter((v): v is string => str(v)).slice(0, 200) } : null;
  }
  return null;
}

/** Runs a shop action on `p` (changed in place): an error code, or what came out (a box's result, the mail taken). */
export function runShopOp(p: Profile, op: ShopOp, rand: () => number, now: number): { error?: ShopError; result?: unknown } {
  settleCalendar(p, now);
  switch (op.op) {
    case 'buy':
      return wrap(buy(p, op.key, now));
    case 'booster':
      return wrap(buyBooster(p, op.item));
    case 'activate':
      return wrap(activateBooster(p, op.item) ? null : 'gone');
    case 'box':
      return wrap(buyBox(p, op.count));
    case 'open': {
      const r = openBox(p, rand, now);
      return typeof r === 'string' ? { error: r } : { result: r };
    }
    case 'craft':
      return wrap(craft(p, op.item, now));
    case 'parts':
      return wrap(buyParts(p));
    case 'reroll':
      return wrap(rerollMission(p, op.index, now));
    case 'pass':
      return wrap(buyPass(p, now));
    case 'contract':
      return wrap(payContractRoll(p));
    case 'claim':
      return { result: claimMail(p, op.id) };
    case 'equip':
      return wrap(equip(p, op.slot, op.value, op.weapon));
    case 'seen':
      markSeen(p, op.items);
      return {};
  }
}

function wrap(e: ShopError | null): { error?: ShopError } {
  return e ? { error: e } : {};
}
