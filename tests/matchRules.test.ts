import { describe, expect, it } from 'vitest';
import { ZoneRules } from '@/modes/zoneRules';
import { ConquestRules, DominationRules, FRONTLINE, FrontlineRules, type MatchRules, type ModeEvent } from '@/modes/matchRules';
import type { Team } from '@/world/mapTypes';

const zone = (id: string, x: number) => ({ id, pos: [x, 0, 0] as [number, number, number], radius: 10 });

/** Runs `seconds` with `who` standing in zones (zone id -> [blue, red]); returns the mode's news. */
function run(zr: ZoneRules, m: MatchRules, seconds: number, who: Record<string, [number, number]>): ModeEvent[] {
  const out: ModeEvent[] = [];
  for (let t = 0; t < seconds && !m.ended; t += 0.1) {
    const events = zr.update(0.1, (z) => {
      const [blue, red] = who[z.id] ?? [0, 0];
      return { blue, red };
    });
    out.push(...m.step(0.1, zr, events));
  }
  return out;
}

const owners = (zr: ZoneRules) => zr.zones.map((z) => `${z.id}${z.owner ? z.owner[0] : '-'}${z.locked ? 'L' : ''}`).join(' ');

describe('DominationRules', () => {
  it('scores a point per held zone every tick and ends at the target', () => {
    const zr = new ZoneRules([zone('A', 0), zone('B', 50), zone('C', 100)], { stepSec: 1 });
    const m = new DominationRules(20, 5);
    m.start();
    run(zr, m, 2, { A: [1, 0], B: [1, 0], C: [0, 1] });
    expect(m.points).toEqual({ blue: 0, red: 0 });
    run(zr, m, 4, {});
    expect(m.points).toEqual({ blue: 2, red: 1 });
    run(zr, m, 60, {});
    expect(m.winner).toBe('blue');
    expect(m.reason).toBe('points');
    expect(m.points.blue).toBe(20);
    // No tickets in Zone.
    expect(m.tickets).toEqual({ blue: null, red: null });
  });
});

describe('FrontlineRules', () => {
  const setup = (sectors: string[][], rand = () => 0.5) => {
    const ids = sectors.flat();
    const zr = new ZoneRules(
      ids.map((id, i) => zone(id, i * 60)),
      { stepSec: 1 },
    );
    const m = new FrontlineRules({ sectors, tickets: { blue: 100, red: 100 }, teamSize: 8, rand });
    m.start(zr);
    return { zr, m };
  };

  it('starts half and half with the middle open; whoever takes it defends it', () => {
    const { zr, m } = setup([['A'], ['B'], ['C']]);
    expect(owners(zr)).toBe('AbL B- CrL');
    expect(m.attacker).toBeNull();
    const ev = run(zr, m, 3, { B: [0, 2] });
    expect(ev).toContainEqual({ type: 'attack', attacker: 'blue', reason: 'opening' });
    expect(m.attacker).toBe('blue');
    expect(m.timeLeft).toBeGreaterThan(FRONTLINE.attackTime - 3);
    expect(owners(zr)).toBe('AbL Br CrL');
  });

  it('out of opening time, the side holding more of the middle gets all of it', () => {
    const { zr, m } = setup([['A', 'E'], ['B', 'D', 'F'], ['C', 'G']]);
    run(zr, m, 3, { B: [2, 0], D: [2, 0], F: [0, 2] });
    expect(m.attacker).toBeNull();
    const ev = run(zr, m, FRONTLINE.openingTime, {});
    expect(ev).toContainEqual({ type: 'attack', attacker: 'red', reason: 'opening' });
    expect(owners(zr)).toBe('AbL Bb CrL Db EbL Fb GrL');
  });

  it('a taken sector makes the side that lost it the attacker of it', () => {
    const { zr, m } = setup([['A'], ['B'], ['C']]);
    run(zr, m, 3, { B: [0, 2] });
    // Blue takes B back: now red attacks B.
    const ev = run(zr, m, 5, { B: [3, 0] });
    expect(ev).toContainEqual({ type: 'sector', team: 'blue', sector: 1 });
    expect(ev).toContainEqual({ type: 'attack', attacker: 'red', reason: 'captured' });
    expect(m.held).toEqual(['blue', 'blue', 'red']);
    expect(m.active).toBe(1);
  });

  it('an attack out of time gives the sector back whole and the defenders attack the next one', () => {
    const { zr, m } = setup([['A'], ['B'], ['C']]);
    run(zr, m, 3, { B: [0, 2] });
    // Blue half-neutralizes B, then nobody: the timer runs out (the opening tie-break aside).
    run(zr, m, 0.5, { B: [1, 0] });
    const ev = run(zr, m, FRONTLINE.maxTime + 5, {});
    expect(ev).toContainEqual({ type: 'attack', attacker: 'red', reason: 'held' });
    expect(m.attacker).toBe('red');
    expect(m.active).toBe(0);
    expect(owners(zr)).toBe('Ab BrL CrL');
    expect(zr.zones[1]!.control).toBe(-1);
  });

  it("taking the enemy's last sector wins", () => {
    const { zr, m } = setup([['A'], ['B'], ['C']]);
    run(zr, m, 3, { B: [2, 0] });
    // Red attacks B and fails (time), blue attacks C and takes it.
    run(zr, m, FRONTLINE.maxTime + 5, {});
    expect(m.attacker).toBe('blue');
    expect(m.active).toBe(2);
    run(zr, m, 5, { C: [3, 0] });
    expect(m.winner).toBe('blue');
    expect(m.reason).toBe('front');
  });

  it('a bigger sector is held only with all of its zones; a zone of it taken adds time', () => {
    const { zr, m } = setup([['A', 'E'], ['B', 'D', 'F'], ['C', 'G']]);
    expect(owners(zr)).toBe('AbL B- CrL D- EbL F- GrL');
    run(zr, m, 3, { B: [2, 0], D: [2, 0] });
    expect(m.attacker).toBeNull();
    run(zr, m, 3, { F: [2, 0] });
    expect(m.attacker).toBe('red');
    const before = m.timeLeft;
    const ev = run(zr, m, 1.2, { D: [0, 3] });
    expect(ev.some((e) => e.type === 'time' && e.delta > 0)).toBe(true);
    expect(m.timeLeft).toBeGreaterThan(before);
  });

  it('weighs the fight every window: going the attackers way adds time, the other way takes it', () => {
    const { zr, m } = setup([['A'], ['B'], ['C']]);
    run(zr, m, 3, { B: [2, 0] });
    expect(m.attacker).toBe('red');
    // Red gets B part of the way while blue goes down a lot: more time.
    for (let i = 0; i < 6; i++) m.onDown('blue');
    const first = run(zr, m, 0.3, { B: [0, 1] }).concat(run(zr, m, FRONTLINE.window[1], {}));
    expect(first.filter((e) => e.type === 'time').map((e) => e.type === 'time' && e.delta > 0)).toEqual([true]);
    // Then red goes down a lot and gets nowhere: less time.
    for (let i = 0; i < 8; i++) m.onDown('red');
    const second = run(zr, m, FRONTLINE.window[1], {});
    expect(second.filter((e) => e.type === 'time').map((e) => e.type === 'time' && e.delta < 0)).toEqual([true]);
    // A quiet window changes nothing.
    expect(run(zr, m, FRONTLINE.window[1], {}).some((e) => e.type === 'time')).toBe(false);
  });

  it('runs out of tickets or the clock', () => {
    const { m } = setup([['A'], ['B'], ['C']]);
    for (let i = 0; i < 100; i++) m.onDeath('red');
    expect(m.winner).toBe('blue');
    expect(m.reason).toBe('tickets');
    const b = setup([['A'], ['B'], ['C']]);
    run(b.zr, b.m, 3, { B: [0, 2] });
    b.m.clock = 0.05;
    run(b.zr, b.m, 0.2, {});
    // Red holds B and C against blue's A.
    expect(b.m.winner).toBe('red');
    expect(b.m.reason).toBe('time');
  });

  it('with an even number of sectors a coin picks the first attacker', () => {
    const { zr, m } = setup([['A'], ['B'], ['C'], ['D']], () => 0.2);
    expect(m.attacker).toBe('blue');
    expect(m.active).toBe(2);
    expect(owners(zr)).toBe('AbL BbL Cr DrL');
  });
});

describe('ConquestRules', () => {
  it('takes the sectors one by one, tops the attackers up, and locks what they took', () => {
    const zr = new ZoneRules([zone('A', 0), zone('B', 60), zone('C', 120)], { stepSec: 1 });
    const m = new ConquestRules({ attacker: 'red', sectors: [['C'], ['B'], ['A']], tickets: 50, refill: 20 });
    m.start(zr);
    // Nothing opens during the setup.
    expect(owners(zr)).toBe('AbL BbL CbL');
    expect(run(zr, m, 19.5, { C: [0, 3] })).toEqual([]);
    expect(zr.zones[2]!.owner).toBe('blue');
    expect(run(zr, m, 0.6, {})).toContainEqual({ type: 'attack', attacker: 'red', reason: 'opening' });
    expect(owners(zr)).toBe('AbL BbL Cb');
    const ev = run(zr, m, 5, { C: [0, 3] });
    expect(ev).toContainEqual({ type: 'sector', team: 'red', sector: 0 });
    expect(ev).toContainEqual({ type: 'refill', team: 'red', tickets: 20 });
    expect(m.tickets.red).toBe(70);
    expect(owners(zr)).toBe('AbL Bb CrL');
    // Blue can't take C back.
    run(zr, m, 10, { C: [5, 0] });
    expect(zr.zones[2]!.owner).toBe('red');
    run(zr, m, 5, { B: [0, 3] });
    run(zr, m, 5, { A: [0, 3] });
    expect(m.winner).toBe('red');
    expect(m.reason).toBe('sectors');
  });

  it('the defenders win when the attackers run out; their own deaths cost nothing', () => {
    const m = new ConquestRules({ attacker: 'red', sectors: [['A']], tickets: 3, refill: 0 });
    for (let i = 0; i < 10; i++) m.onDeath('blue' as Team);
    expect(m.ended).toBe(false);
    for (let i = 0; i < 3; i++) m.onDeath('red');
    expect(m.winner).toBe('blue');
    expect(m.reason).toBe('tickets');
  });
});
