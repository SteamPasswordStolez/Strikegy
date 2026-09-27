import { describe, expect, it } from 'vitest';
import { ZoneRules } from '@/modes/zoneRules';

const defs = [
  { id: 'B', pos: [50, 0, 0] as [number, number, number], radius: 10 },
  { id: 'A', pos: [0, 0, 0] as [number, number, number], radius: 10 },
];

function run(rules: ZoneRules, seconds: number, blue: number, red: number, zone = 'A') {
  const events = [];
  for (let t = 0; t < seconds; t += 0.1) {
    events.push(...rules.update(0.1, (z) => (z.id === zone ? { blue, red } : { blue: 0, red: 0 })));
  }
  return events;
}

describe('ZoneRules', () => {
  it('orders zones by id and starts neutral with full tickets', () => {
    const r = new ZoneRules(defs, { tickets: 50 });
    expect(r.zones.map((z) => z.id)).toEqual(['A', 'B']);
    expect(r.zones.every((z) => z.owner === null && z.control === 0)).toBe(true);
    expect(r.tickets).toEqual({ blue: 50, red: 50 });
  });

  it('captures a neutral zone in stepSec when uncontested', () => {
    const r = new ZoneRules(defs, { stepSec: 8 });
    expect(run(r, 7.5, 1, 0)).toEqual([]);
    expect(r.zones[0]!.owner).toBeNull();
    expect(run(r, 0.6, 1, 0)).toEqual([{ type: 'captured', zone: 'A', team: 'blue' }]);
    expect(r.zones[0]!.owner).toBe('blue');
  });

  it('neutralizes an enemy zone before taking it', () => {
    const r = new ZoneRules(defs, { stepSec: 8 });
    run(r, 9, 2, 0);
    const events = run(r, 17, 0, 3);
    expect(events).toEqual([
      { type: 'neutralized', zone: 'A', team: 'blue' },
      { type: 'captured', zone: 'A', team: 'red' },
    ]);
  });

  it('scales speed with the head-count advantage and stalls when tied', () => {
    const r = new ZoneRules(defs, { stepSec: 8 });
    run(r, 4, 3, 1); // ratio 0.5 -> half speed
    expect(r.zones[0]!.control).toBeCloseTo(0.25, 1);
    run(r, 5, 2, 2);
    expect(r.zones[0]!.control).toBeCloseTo(0.25, 1);
    expect(r.zones[0]!.contested).toBe(true);
  });

  it('flags an owned zone under attack and reports stage progress', () => {
    const r = new ZoneRules(defs, { stepSec: 8 });
    run(r, 9, 1, 0);
    run(r, 2, 0, 1);
    const a = r.zones[0]!;
    expect(ZoneRules.underAttack(a)).toBe(true);
    expect(ZoneRules.progress(a)).toBeCloseTo(0.25, 1);
  });

  it('ends when a team runs out of tickets (deaths only)', () => {
    const r = new ZoneRules(defs, { tickets: 2 });
    r.onDeath('red');
    expect(r.ended).toBe(false);
    r.onDeath('red');
    expect(r.winner).toBe('blue');
    r.onDeath('blue');
    expect(r.tickets.blue).toBe(2);
  });

  it('checks the capture area in 2D with a height limit', () => {
    const r = new ZoneRules(defs);
    const a = r.zones[0]!;
    expect(ZoneRules.inside(a, { x: 6, y: 1, z: 6 })).toBe(true);
    expect(ZoneRules.inside(a, { x: 9, y: 0, z: 9 })).toBe(false);
    expect(ZoneRules.inside(a, { x: 0, y: 20, z: 0 })).toBe(false);
  });
});
