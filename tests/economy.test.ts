import { describe, expect, it } from 'vitest';
import { dayKey, weekKey } from '@/progression/calendar';
import { BUNDLES, CRAFT_PARTS, DEPOT_MARKUP, DEPOT_SIZE, DUP_PARTS, PRICE, item, levelRewards, seriesItems } from '@/progression/catalog';
import { advanceCamo, CAMO_TIERS, tierTarget } from '@/progression/camo';
import { contractOffer } from '@/progression/contracts';
import {
  BOOSTERS,
  ECON,
  SALARY,
  activateBooster,
  boostsLeft,
  buyBooster,
  buyBox,
  buyPass,
  claimMail,
  craft,
  drawRarity,
  econOf,
  equip,
  openBox,
  parseShopOp,
  rerollMission,
  runShopOp,
  settleCalendar,
  weeklyOffer,
  depotOffer,
  buy,
  dailyDeal,
  WEEK_SLOTS,
} from '@/progression/economy';
import { cleanWorn, kfxFor, vehicleClassOf, wornOf } from '@/progression/worn';
import { ITEMS, weeklyPool } from '@/progression/catalog';
import { DAILY, MISSION, drawMissions } from '@/progression/missions';
import { applySummary, cleanProfile, newProfile, type Profile } from '@/progression/profile';
import { levelOf, rankAt, xpForLevel } from '@/progression/levels';
import { RIBBON } from '@/progression/ribbons';
import { ProgressTracker } from '@/progression/tracker';

/** Monday 26 Oct 2026, 12:00 KST. */
const MON = Date.UTC(2026, 9, 26, 3);
const DAY = 86_400_000;

const fresh = (now = MON): Profile => {
  const p = newProfile(now);
  settleCalendar(p, now);
  return p;
};
const rich = (tickets: number, now = MON): Profile => {
  const p = fresh(now);
  econOf(p).tickets = tickets;
  return p;
};
/** A finished ten-minute multiplayer match. */
const played = (won = true, f?: (t: ProgressTracker) => void) => {
  const t = new ProgressTracker({ kind: 'multi', map: 'iron_gate', mode: 'zone', difficulty: null, startXp: 0 });
  f?.(t);
  for (let i = 0; i < 600; i++) t.tick(1, true);
  return t.finish(won);
};

describe('calendar', () => {
  it('turns the day at 05:00 KST and the week on Monday', () => {
    // 05:00 KST = 20:00 UTC the day before.
    expect(dayKey(Date.UTC(2026, 9, 25, 19, 59))).toBe('2026-10-25');
    expect(dayKey(Date.UTC(2026, 9, 25, 20, 0))).toBe('2026-10-26');
    expect(weekKey(MON)).not.toBe(weekKey(MON - DAY));
    expect(weekKey(MON)).toBe(weekKey(MON + 5 * DAY));
  });
});

describe('level rewards', () => {
  it('gives each level its tickets and items once, promotions their bonus, and backfills old profiles', () => {
    const p = fresh();
    p.xp = xpForLevel(10);
    settleCalendar(p, MON);
    const e = econOf(p);
    // Levels 2-10 at their level tickets each, the promotion to 일병 at 10.
    expect(e.tickets).toBe(9 * ECON.levelTickets(5) + ECON.promotion.enlisted);
    for (const it of levelRewards(10)) expect(e.items[it.id]).toBeDefined();
    settleCalendar(p, MON);
    expect(e.tickets).toBe(9 * ECON.levelTickets(5) + ECON.promotion.enlisted);
    // A profile from before step 5 (no economy): everything since level 1 is owed.
    const old = cleanProfile({ ...JSON.parse(JSON.stringify(p)), econ: undefined })!;
    settleCalendar(old, MON);
    expect(econOf(old).tickets).toBe(9 * ECON.levelTickets(5) + ECON.promotion.enlisted);
  });
});

describe('camo challenges', () => {
  it('steps through the tiers in order and reaches brass', () => {
    const st = { tier: 0, prog: 0 };
    const done = advanceCamo(st, { kills: 25, headshots: 0, triples: 0, special: 0 }, 'ar');
    expect(done).toEqual([1]);
    expect(st.tier).toBe(1);
    // Kills past the tier don't spill into a headshot tier.
    expect(advanceCamo(st, { kills: 500, headshots: 0, triples: 0, special: 0 }, 'ar')).toEqual([]);
    advanceCamo(st, { kills: 0, headshots: CAMO_TIERS[1]!.n, triples: 0, special: 0 }, 'ar');
    advanceCamo(st, { kills: CAMO_TIERS[2]!.n, headshots: 0, triples: 0, special: 0 }, 'ar');
    advanceCamo(st, { kills: 0, headshots: 0, triples: 0, special: tierTarget(3, 'ar') }, 'ar');
    const last = advanceCamo(st, { kills: 0, headshots: 0, triples: CAMO_TIERS[4]!.n, special: 0 }, 'ar');
    expect(last).toEqual([5, 6]);
    expect(st.tier).toBe(6);
  });

  it('pays obsidian when every gun of a kind is brass, and lets a gun wear only what it has', () => {
    const p = fresh();
    const e = econOf(p);
    expect(equip(p, 'camo', 'brass', 'sr1')).toBe('owned');
    for (const id of ['sr1', 'sr2', 'sr3']) e.camo[id] = { tier: 6, prog: 0 };
    const a = applySummary(p, { ...played(), camo: {} }, MON);
    expect(a.econ!.items).toContain('obsidian.sr');
    expect(a.econ!.lines.find((l) => l.key === 'camoClass')?.n).toBe(ECON.camo.obsidian);
    expect(equip(a.profile, 'camo', 'obsidian', 'sr2')).toBeNull();
    expect(equip(a.profile, 'camo', 'obsidian', 'ar1')).toBe('owned');
  });
});

describe('ribbons and match tickets', () => {
  it('awards a ribbon per threshold, at most three of one kind a match', () => {
    const got: string[] = [];
    const s = played(true, (t) => {
      t.onRibbon = (r) => got.push(r.id);
      t.count('kills', 40);
    });
    expect(got.filter((id) => id === 'gunner')).toHaveLength(RIBBON.max);
    expect(s.ribbons?.gunner).toBe(RIBBON.max);
    expect(s.lines.find((l) => l.key === 'ribbon')?.base).toBe((RIBBON.max + 1) * RIBBON.xp);
    expect(s.ticketLines?.find((l) => l.key === 'ribbons')?.n).toBe((RIBBON.max + 1) * RIBBON.tickets);
  });

  it('pays a met field contract only', () => {
    const offer = contractOffer('seed');
    expect(new Set(offer.map((c) => c.id)).size).toBe(3);
    expect(contractOffer('seed').map((c) => c.id)).toEqual(offer.map((c) => c.id));
    const kills = played(true, (t) => {
      t.setContract('kills');
      t.count('kills', 12);
    });
    expect(kills.ticketLines?.some((l) => l.key === 'contract')).toBe(true);
    const missed = played(true, (t) => {
      t.setContract('caps');
      t.count('captures', 1);
    });
    expect(missed.ticketLines?.some((l) => l.key === 'contract')).toBe(false);
  });

  it("doubles the day's first match and pays the first win once", () => {
    const p = fresh();
    const a = applySummary(p, played(true), MON);
    const keys = a.econ!.lines.map((l) => l.key);
    expect(keys).toContain('firstMatch');
    expect(keys).toContain('firstWin');
    const b = applySummary(a.profile, played(true), MON + 60_000);
    expect(b.econ!.lines.map((l) => l.key)).not.toContain('firstWin');
    expect(b.econ!.lines.map((l) => l.key)).not.toContain('firstMatch');
  });
});

describe('missions', () => {
  it('draws distinct, seeded missions and new ones each day', () => {
    const a = drawMissions(DAILY, 3, 'x');
    expect(new Set(a.map((m) => m.id)).size).toBe(3);
    expect(drawMissions(DAILY, 3, 'x')).toEqual(a);
    const p = fresh();
    const today = econOf(p).missions.daily.map((m) => m.id);
    settleCalendar(p, MON + DAY);
    expect(econOf(p).missions.daily).toHaveLength(MISSION.daily.count);
    expect(econOf(p).missions.daily.every((m) => m.prog === 0)).toBe(true);
    expect(today).toHaveLength(3);
  });

  it('rerolls one free a day, then three for tickets, then no more', () => {
    const p = rich(1000);
    expect(rerollMission(p, 0, MON)).toBeNull();
    expect(econOf(p).tickets).toBe(1000);
    for (let i = 0; i < MISSION.rerollPaid; i++) expect(rerollMission(p, 1, MON)).toBeNull();
    expect(econOf(p).tickets).toBe(1000 - MISSION.rerollPaid * MISSION.rerollPrice);
    expect(rerollMission(p, 2, MON)).toBe('limit');
    expect(new Set(econOf(p).missions.daily.map((m) => m.id)).size).toBe(3);
  });

  it('finishes a mission from the match it counted in and pays its XP and tickets', () => {
    const p = fresh();
    const e = econOf(p);
    e.missions.daily = [{ id: e.missions.daily[0]!.id, prog: 0, done: false }];
    const def = DAILY.find((m) => m.id === e.missions.daily[0]!.id)!;
    const s = played(true, (t) => {
      if (def.key !== 'finished' && def.key !== 'wins' && !def.key.startsWith('class.')) t.count(def.key as never, def.n);
    });
    const a = applySummary(p, s, MON);
    if (def.key.startsWith('class.')) return;
    expect(a.econ!.missions).toEqual([{ id: def.id, daily: true }]);
    expect(a.econ!.lines.find((l) => l.key === 'missionXp')?.n).toBe(MISSION.daily.xp);
    expect(a.profile.xp).toBe(s.xp + MISSION.daily.xp);
  });
});

describe('attendance, salary and mail', () => {
  it('mails attendance for the first finished match of a day and the salary for a week of three', () => {
    let p = fresh();
    for (let d = 0; d < 3; d++) p = applySummary(p, played(false), MON + d * DAY).profile;
    const e = econOf(p);
    expect(e.mail.filter((m) => m.reason === 'attendance').map((m) => m.tickets)).toEqual(ECON.attendance.slice(0, 3));
    settleCalendar(p, MON + 7 * DAY);
    const sal = econOf(p).mail.find((m) => m.reason === 'salary');
    expect(sal?.tickets).toBe(SALARY[rankAt(levelOf(p.xp).level).id]);
    const before = econOf(p).tickets;
    const taken = claimMail(p);
    expect(econOf(p).mail).toHaveLength(0);
    expect(econOf(p).tickets - before).toBe(taken.reduce((a, m) => a + (m.tickets ?? 0), 0));
  });

  it('drops mail after 30 days', () => {
    const p = fresh();
    econOf(p).mail.push({ id: 'gift:1', at: MON, reason: 'gift', tickets: 5 });
    settleCalendar(p, MON + 31 * DAY);
    expect(econOf(p).mail).toHaveLength(0);
  });
});

describe('boosters', () => {
  it('are bought into stock, run on match time once turned on', () => {
    const p = rich(BOOSTERS.xp.price[30]!);
    expect(buyBooster(p, 'xp30')).toBeNull();
    expect(econOf(p).tickets).toBe(0);
    expect(boostsLeft(p)).toEqual({});
    expect(activateBooster(p, 'xp30')).toBe(true);
    expect(boostsLeft(p).xp).toBe(1800);
    const t = new ProgressTracker({ kind: 'multi', map: 'iron_gate', mode: 'zone', difficulty: null, startXp: 0, boost: boostsLeft(p) });
    t.points('kill', 100, 0);
    for (let i = 0; i < 600; i++) t.tick(1, true);
    const s = t.finish(false);
    expect(s.lines.find((l) => l.key === 'score')?.base).toBe(100 * 10);
    // Everything earned while it ran (the kill, completion, the survivor ribbon) is doubled.
    const others = s.lines.filter((l) => l.key !== 'booster').reduce((a, l) => a + l.base, 0);
    expect(s.lines.find((l) => l.key === 'booster')?.base).toBe(others * (BOOSTERS.xp.mult - 1));
    expect(s.xp).toBe(others * BOOSTERS.xp.mult);
    const a = applySummary(p, s, MON);
    expect(boostsLeft(a.profile).xp).toBe(1200);
  });
});

describe('supply boxes', () => {
  it('forces epic or better by the 20th box and legendary by the 80th', () => {
    const p = fresh();
    const e = econOf(p);
    const low = () => 0.99;
    e.box.sinceEpic = ECON.pity.epic - 1;
    expect(['epic', 'legendary']).toContain(drawRarity(e, low));
    e.box.sinceLegend = ECON.pity.legendary - 1;
    expect(drawRarity(e, low)).toBe('legendary');
  });

  it('gives what is not owned first, then parts for a finished rarity', () => {
    const p = rich(ECON.boxPrice * 10);
    expect(buyBox(p, 10)).toBeNull();
    const e = econOf(p);
    const commons = seriesItems().filter((i) => i.rarity === 'common');
    const seen = new Set<string>();
    // rand 0.99: common every time (no pity here), first item of what's left.
    for (let i = 0; i < commons.length; i++) {
      e.box.sinceEpic = 0;
      e.boxes = Math.max(e.boxes, 1);
      const r = openBox(p, () => 0.99, MON);
      expect(typeof r).toBe('object');
      if (typeof r === 'object' && r.item) seen.add(r.item);
    }
    expect(seen.size).toBe(commons.length);
    e.boxes = 1;
    e.box.sinceEpic = 0;
    const dup = openBox(p, () => 0.99, MON);
    expect(dup).toEqual({ item: null, rarity: 'common', parts: DUP_PARTS.common });
    expect(e.parts).toBe(DUP_PARTS.common);
  });

  it('crafts a series item from parts and refuses one owned', () => {
    const p = fresh();
    const e = econOf(p);
    const rare = seriesItems().find((i) => i.rarity === 'rare')!;
    e.parts = CRAFT_PARTS.rare;
    expect(craft(p, rare.id, MON)).toBeNull();
    expect(e.parts).toBe(0);
    expect(craft(p, rare.id, MON)).toBe('owned');
    expect(craft(p, 'camo.lv10', MON)).toBe('bad');
  });
});

describe('shop', () => {
  it('offers the week shop (a bundle first)', () => {
    const w = weeklyOffer(MON);
    expect(w).toHaveLength(1 + WEEK_SLOTS.length);
    expect(w[0]!.bundle).toBeDefined();
    expect(weeklyOffer(MON + 3 * DAY)).toEqual(w);
    const d = depotOffer(MON);
    const it = item(d[0]!.items[0]!)!;
    expect(d[0]!.price).toBeGreaterThan(0);
    expect(it.source).not.toBe('box');
    const p = rich(100_000);
    expect(buy(p, w[1]!.key, MON)).toBeNull();
    expect(buy(p, w[1]!.key, MON)).toBe('owned');
    expect(buy(p, 'nothing', MON)).toBe('gone');
  });

  it('stocks the depot with 50 pieces a week at 150 % (owner, 2026-10-27)', () => {
    expect(DEPOT_MARKUP).toBe(1.5);
    const d = depotOffer(MON);
    expect(d).toHaveLength(DEPOT_SIZE);
    expect(new Set(d.map((o) => o.key)).size).toBe(DEPOT_SIZE);
    // The same all week, none of them in the week's shop, a new draw the next week.
    expect(depotOffer(MON + 5 * DAY)).toEqual(d);
    const shop = new Set(weeklyOffer(MON).flatMap((o) => o.items));
    for (const o of d) {
      expect(shop.has(o.items[0]!)).toBe(false);
      expect(o.price).toBe(Math.round(PRICE[item(o.items[0]!)!.rarity] * 1.5));
    }
    const next = depotOffer(MON + 7 * DAY).map((o) => o.key);
    expect(next.filter((k) => d.some((o) => o.key === k)).length).toBeLessThan(25);
  });

  it('sells a curated set of gun skins; the rest are kept but vaulted (owner, 2026-10-27)', () => {
    const pool = weeklyPool().filter((i) => i.kind === 'skin');
    expect(pool.filter((i) => i.rarity === 'legendary')).toHaveLength(6);
    expect(pool.filter((i) => i.rarity === 'epic')).toHaveLength(30);
    // A vaulted skin is still an item (owners keep wearing it), just not in the shop.
    expect(item('skin.reddragon.ar1')?.source).toBe('vault');
    expect(item('skin.reddragon.ar2')?.source).toBe('weekly');
    for (const b of BUNDLES) for (const id of b.items) expect(item(id)?.source).toBe('weekly');
  });

  it('sells two leave passes a day', () => {
    const p = rich(10_000);
    expect(buyPass(p, MON)).toBeNull();
    expect(buyPass(p, MON)).toBeNull();
    expect(buyPass(p, MON)).toBe('limit');
    expect(buyPass(p, MON + DAY)).toBeNull();
    expect(econOf(p).tickets).toBe(10_000 - 3 * ECON.pass.price);
  });

  it('checks requests from outside', () => {
    expect(parseShopOp({ op: 'box', count: 11 })).toBeNull();
    expect(parseShopOp({ op: 'buy', key: '<script>' })).toBeNull();
    expect(parseShopOp({ op: 'equip', slot: 'hat' })).toBeNull();
    expect(parseShopOp({ op: 'contract' })).toEqual({ op: 'contract' });
    const p = rich(40);
    expect(runShopOp(p, { op: 'contract' }, Math.random, MON).error).toBe('funds');
    expect(runShopOp(p, { op: 'open' }, Math.random, MON).error).toBe('gone');
  });
});

describe('step 6: skins, charms, vehicle skins, kill effects', () => {
  it('has a week pool and rotates a mix every week', () => {
    // Curated on 2026-10-27 (883 -> ~460); still enough for a different mix every week.
    expect(weeklyPool().length).toBeGreaterThan(400);
    const ids = new Set(ITEMS.map((i) => i.id));
    expect(ids.size).toBe(ITEMS.length);
    const kinds = new Set(weeklyOffer(MON).flatMap((o) => o.items.map((id) => item(id)!.kind)));
    for (const k of ['skin', 'charm', 'vskin', 'kfx']) expect(kinds.has(k as never)).toBe(true);
    // Several weeks in a row share few pieces.
    const a = new Set(weeklyOffer(MON).flatMap((o) => o.items));
    const b = weeklyOffer(MON + 7 * DAY).flatMap((o) => o.items);
    expect(b.filter((id) => a.has(id)).length).toBeLessThan(4);
  });

  it('sells today\'s deal at 70 %, a new one each day', () => {
    const d = dailyDeal(MON);
    expect(d.price).toBe(Math.round(PRICE_OF(d.items[0]!) * 0.7));
    expect(dailyDeal(MON + DAY).items[0]).not.toBe(d.items[0]);
    const p = rich(100_000);
    expect(buy(p, d.key, MON)).toBeNull();
    expect(econOf(p).items[d.items[0]!]).toBeDefined();
  });

  it('wears a skin only on its own gun, a vehicle skin only on its family, a kill effect on one gun or all', () => {
    const p = fresh();
    const e = econOf(p);
    e.items['skin.night.ar1'] = { at: MON, from: 'weekly' };
    e.items['vskin.dazzle.ship'] = { at: MON, from: 'weekly' };
    e.items['kfx.sparks'] = { at: MON, from: 'weekly' };
    expect(equip(p, 'skin', 'skin.night.ar1', 'ar2')).toBe('bad');
    expect(equip(p, 'skin', 'skin.night.ar2', 'ar2')).toBe('owned');
    expect(equip(p, 'skin', 'skin.night.ar1', 'ar1')).toBeNull();
    expect(equip(p, 'vskin', 'vskin.dazzle.ship', 'armor')).toBe('bad');
    expect(equip(p, 'vskin', 'vskin.dazzle.ship', 'ship')).toBeNull();
    expect(equip(p, 'kfx', 'kfx.sparks', '*')).toBeNull();
    const w = wornOf(e.equip)!;
    expect(kfxFor(w, 'ar3')).toBe('kfx.sparks');
    expect(kfxFor(w, 'M4A1')).toBe('kfx.sparks');
    // A set from outside keeps only real items of the right kind on the right thing.
    expect(cleanWorn({ skin: { ar2: 'skin.night.ar1', ar1: 'skin.night.ar1' }, kfx: { '*': 'camo.lv10' } })).toEqual({ skin: { ar1: 'skin.night.ar1' } });
    expect(vehicleClassOf('tank')).toBe('armor');
    expect(vehicleClassOf('cvfighter')).toBe('air');
    expect(vehicleClassOf('cv')).toBe('ship');
    expect(vehicleClassOf('hmg')).toBeNull();
  });

  it('gives a legendary skin\'s own kill effect with it', () => {
    const p = fresh();
    econOf(p).parts = 100_000;
    expect(craft(p, 'skin.pac.coral', MON)).toBeNull();
    expect(econOf(p).items['kfx.pac.splash']).toBeDefined();
  });

  it('keeps worn step-6 items through a save', () => {
    const p = fresh();
    const e = econOf(p);
    e.items['charm.skull'] = { at: MON, from: 'weekly' };
    expect(equip(p, 'charm', 'charm.skull', 'smg1')).toBeNull();
    const back = cleanProfile(JSON.parse(JSON.stringify(p)))!;
    expect(econOf(back).equip.charm.smg1).toBe('charm.skull');
  });
});

function PRICE_OF(id: string): number {
  return PRICE[item(id)!.rarity];
}

describe('launch preparation 1 (owner, 2026-10-26)', () => {
  it('pays a quarter of the old income and asks the new prices', async () => {
    const { INCOME, earn } = await import('@/progression/income');
    expect(INCOME).toBe(1 / 4);
    expect(ECON.levelTickets(5)).toBe(earn(20));
    expect(ECON.promotion.enlisted).toBe(125);
    expect(ECON.boxPrice).toBe(400);
    expect(PRICE).toEqual({ common: 440, uncommon: 1000, rare: 2100, epic: 4650, legendary: 10500 });
    expect(RIBBON.tickets).toBe(3);
    expect(MISSION.daily.tickets).toBe(25);
  });
});
