import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { levelOf, rankAt, xpForLevel, xpToNext } from '@/progression/levels';
import {
  applySummary,
  cleanProfile,
  exportProfile,
  importProfile,
  newProfile,
  promotionsBetween,
} from '@/progression/profile';
import { ProgressTracker, XP, type TrackerOptions } from '@/progression/tracker';
import { ScoreTracker } from '@/modes/scoreTracker';
import { RIBBON } from '@/progression/ribbons';

const bots = (o: Partial<TrackerOptions> = {}): ProgressTracker =>
  new ProgressTracker({
    kind: 'bots',
    map: 'iron_gate',
    mode: 'zone',
    difficulty: 'normal',
    startXp: 0,
    ...o,
  });
const multi = (o: Partial<TrackerOptions> = {}): ProgressTracker =>
  bots({ kind: 'multi', difficulty: null, ...o });

describe('levels', () => {
  it('matches the level table in docs/design (the same curve)', () => {
    const rows = readFileSync('docs/design/progression-levels.csv', 'utf8')
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\n')
      .slice(1);
    expect(rows).toHaveLength(1100);
    for (const row of rows) {
      const [level, , , next, cum] = row.split(',').map(Number) as [
        number,
        number,
        number,
        number,
        number,
      ];
      expect(xpToNext(level)).toBe(next);
      expect(xpForLevel(level)).toBe(cum);
    }
  });

  it('goes round between levels and cumulative XP', () => {
    for (const l of [1, 2, 9, 10, 99, 100, 150, 209, 210, 999, 1000, 1001, 1100, 1300]) {
      expect(levelOf(xpForLevel(l))).toEqual({ level: l, into: 0, need: xpToNext(l) });
      expect(levelOf(xpForLevel(l) - 1).level).toBe(l - 1 || 1);
    }
    expect(levelOf(0).level).toBe(1);
    expect(levelOf(-5).level).toBe(1);
  });

  it('names the ranks at their edges and goes on past 원수', () => {
    expect(rankAt(9).id).toBe('pvt');
    expect(rankAt(10).id).toBe('pfc');
    expect(rankAt(999).id).toBe('gen');
    expect(rankAt(1000).id).toBe('goa');
    expect(rankAt(5000).id).toBe('goa');
    expect(promotionsBetween(0, xpForLevel(31))).toEqual(['pfc', 'cpl']);
  });
});

describe('progress in a match', () => {
  it('turns score into XP x10, halved in bot matches, with the difficulty on top', () => {
    const normal = bots();
    normal.points('kill', 100, 0);
    expect(normal.xp).toBe(500);
    const hard = bots({ difficulty: 'hard' });
    hard.points('kill', 100, 0);
    expect(hard.xp).toBe(600);
    const easy = bots({ difficulty: 'easy' });
    easy.points('kill', 100, 0);
    expect(easy.xp).toBe(330);
    const room = multi();
    room.points('kill', 100, 0);
    expect(room.xp).toBe(1000);
  });

  it('counts sea damage at 1/20 before the x10', () => {
    const t = multi();
    t.points('sea', 20000, 0);
    // Plus two naval ribbons (10,000 damage each).
    expect(t.xp).toBe(10000 + 2 * RIBBON.xp);
  });

  it('gives no XP for building points; a finished structure, its use and a cap instead', () => {
    const t = multi();
    expect(t.points('build', 150, 0)).toBe(0);
    expect(t.points('refill', 30, 0)).toBe(0);
    t.builtAt(1, 'sandbagLow', 0);
    t.builtAt(2, 'nest', 0);
    expect(t.xp).toBe(150 + 400);
    // A teammate's kill beside it: 500 a time, at most 2,000 a structure.
    for (let i = 0; i < 6; i++) t.coverAssist(2);
    expect(t.xp).toBe(550 + 2000);
    // The match cap.
    for (let i = 3; i < 200; i++) t.builtAt(i, 'nest', 0);
    // The match cap (and three engineer ribbons, outside it).
    expect(t.xp).toBe(XP.buildCap + 3 * RIBBON.xp);
    for (let i = 0; i < 20; i++) t.refilled();
    expect(t.xp).toBe(XP.buildCap + XP.refillCap + 3 * RIBBON.xp);
  });

  it('gives nothing for building one again within 3 minutes of losing it, and half in the build phase', () => {
    const t = multi();
    t.builtAt(1, 'sandbag', 0);
    t.lostAt(1, 10);
    t.builtAt(1, 'sandbag', 100);
    expect(t.xp).toBe(200);
    t.lostAt(1, 120);
    t.builtAt(1, 'sandbag', 400);
    // The third structure is an engineer ribbon.
    expect(t.xp).toBe(400 + RIBBON.xp);
    t.builtAt(9, 'sandbag', 0, true);
    expect(t.xp).toBe(500 + RIBBON.xp);
  });

  it('pays a resupply to the same person once in 30 s', () => {
    const t = multi();
    t.points('resupply', 20, 0, 7);
    t.points('resupply', 20, 10, 7);
    t.points('resupply', 20, 10, 8);
    t.points('resupply', 20, 31, 7);
    expect(t.xp).toBe(600);
  });

  it('says every level reached as it happens, promotions named', () => {
    const t = multi();
    const ups: { level: number; promoted: string | null }[] = [];
    t.onLevel = (l) => ups.push(l);
    t.points('capture', xpForLevel(11) / 10, 0);
    expect(ups.map((u) => u.level)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(ups.find((u) => u.level === 10)?.promoted).toBe('pfc');
    expect(ups.filter((u) => u.promoted)).toHaveLength(1);
  });

  it('adds the completion bonus for the time played and the win bonus at the end', () => {
    const t = multi();
    for (let i = 0; i < 600; i++) t.tick(1, true);
    const s = t.finish(true);
    expect(s.result).toBe('win');
    // Never down the whole match: the survivor ribbon too.
    expect(s.xp).toBe(XP.complete + XP.win + RIBBON.xp);
    expect(s.lines.map((l) => l.key)).toEqual(['complete', 'win', 'ribbon']);
    const long = multi();
    for (let i = 0; i < 3600; i++) long.tick(1, true);
    expect(long.finish(false).xp).toBe(XP.completeMax + RIBBON.xp);
  });

  it('confirms nothing for a match spent idle', () => {
    const t = multi();
    t.points('kill', 100, 0);
    for (let i = 0; i < 100; i++) t.tick(1, true);
    for (let i = 0; i < 300; i++) t.tick(1, false);
    const s = t.finish(true);
    expect(s.result).toBe('idle');
    expect(s.xp).toBe(0);
  });

  it('undoes a match left solo or in a room of two, keeps it without bonuses with three or more', () => {
    const solo = bots();
    solo.points('kill', 100, 0);
    expect(solo.leaveCost(1)).toMatchObject({ undone: true, xp: 500 });
    expect(solo.leave(1).xp).toBe(0);
    const pair = multi();
    pair.points('kill', 100, 0);
    expect(pair.leave(2).xp).toBe(0);
    const room = multi();
    room.points('kill', 100, 0);
    for (let i = 0; i < 600; i++) room.tick(1, true);
    expect(room.leaveCost(3).undone).toBe(false);
    const s = room.leave(3);
    expect(s).toMatchObject({ result: 'left', xp: 1000 });
    expect(s.lines.map((l) => l.key)).toEqual(['score']);
    // The anticheat's kick: always undone.
    const cheat = multi();
    cheat.points('kill', 100, 0);
    expect(cheat.leave(10, true).xp).toBe(0);
  });

  it('follows the scoreboard through its reasons', () => {
    const scores = new ScoreTracker();
    scores.add(1, 'me', 'blue');
    scores.add(2, 'them', 'red');
    const t = multi();
    scores.onScore = (id, pts, reason, other) => {
      if (id === 1) t.points(reason, pts, 0, other);
    };
    scores.kill(1, 2, true);
    scores.award(1, 150, 'build');
    scores.award(1, 50, 'tag');
    expect(t.xp).toBe((100 + 25 + 50) * 10);
  });
});

describe('profile', () => {
  it('adds a finished match and keeps the last 20', () => {
    let p = newProfile(0);
    const t = bots();
    t.kill('ar1', true, false);
    t.points('kill', 100, 0);
    t.points('headshot', 25, 0);
    t.score = 125;
    for (let i = 0; i < 600; i++) t.tick(1, true);
    const a = applySummary(p, t.finish(true));
    p = a.profile;
    // Score, completion, win and the survivor ribbon (bot match: half).
    expect(p.xp).toBe(625 + 2500 + 2500 + RIBBON.xp / 2);
    expect(a.promotions).toEqual([]);
    expect(p.stats.bots).toMatchObject({ matches: 1, wins: 1, kills: 1, headshots: 1, score: 125 });
    expect(p.weapons.ar1).toEqual({ xp: 625, kills: 1, headshots: 1 });
    expect(p.maps.iron_gate).toEqual({ matches: 1, wins: 1 });
    for (let i = 0; i < 25; i++) p = applySummary(p, bots().leave(1)).profile;
    expect(p.history).toHaveLength(20);
    expect(p.stats.bots.quits).toBe(25);
    expect(p.stats.bots.kills).toBe(1);
  });

  it('goes out to a file and back, and refuses what is not one', () => {
    const p = applySummary(newProfile(5), multi().finish(false)).profile;
    expect(importProfile(exportProfile(p))).toEqual(p);
    expect(importProfile('nope')).toBeNull();
    expect(importProfile('{"v":2}')).toBeNull();
    // Bad numbers are put right.
    expect(cleanProfile({ v: 1, xp: -50, stats: { bots: { kills: 'x' } } })?.xp).toBe(0);
  });
});
