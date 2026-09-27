import { describe, expect, it } from 'vitest';
import { AmbienceDirector, BIRD_CALM_S, ambienceFor, type AmbienceEvent } from '@/audio/ambienceDirector';
import { validateMap } from '@/world/validateMap';

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(d: AmbienceDirector, seconds: number, dt = 1 / 60): AmbienceEvent[] {
  const out: AmbienceEvent[] = [];
  for (let t = 0; t < seconds; t += dt) out.push(...d.update(dt));
  return out;
}

describe('AmbienceDirector', () => {
  it('plays birds and far-off fighting at a sparse rate when calm', () => {
    const d = new AmbienceDirector({ wind: 0.4, birds: 0.6, battle: 0.5 }, seeded(1));
    const events = run(d, 120);
    const birds = events.filter((e) => e.kind === 'bird').length;
    const battle = events.length - birds;
    // Roughly one bird every few seconds and a far-off skirmish every ~7 s.
    expect(birds).toBeGreaterThan(10);
    expect(birds).toBeLessThan(80);
    expect(battle).toBeGreaterThan(6);
    expect(battle).toBeLessThan(40);
  });

  it('keeps far-off fighting around one front direction', () => {
    const d = new AmbienceDirector({ wind: 0, birds: 0, battle: 1 }, seeded(2));
    for (const e of run(d, 200)) {
      const off = Math.atan2(Math.sin(e.azimuth - d.front), Math.cos(e.azimuth - d.front));
      expect(Math.abs(off)).toBeLessThanOrEqual(1.1 + 1e-9);
    }
  });

  it('silences birds during a fight and brings them back after a calm spell', () => {
    const d = new AmbienceDirector({ wind: 0, birds: 1, battle: 0 }, seeded(3));
    run(d, 10);
    d.excite(1);
    // Tension decays below the bird threshold after ~9 s, then birds wait for the calm period.
    expect(run(d, 8).filter((e) => e.kind === 'bird')).toHaveLength(0);
    expect(run(d, BIRD_CALM_S + 10).filter((e) => e.kind === 'bird').length).toBeGreaterThan(0);
  });

  it('gusts vary the wind around the map level', () => {
    const d = new AmbienceDirector({ wind: 0.5, birds: 0, battle: 0 }, seeded(4));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 60 * 60; i++) {
      d.update(1 / 60);
      lo = Math.min(lo, d.wind);
      hi = Math.max(hi, d.wind);
    }
    expect(lo).toBeGreaterThanOrEqual(0.5 * 0.55 - 1e-9);
    expect(hi).toBeLessThanOrEqual(0.5 * 1.3 + 1e-9);
    expect(hi - lo).toBeGreaterThan(0.1);
  });

  it('plays nothing when every level is zero', () => {
    const d = new AmbienceDirector({ wind: 0, birds: 0, battle: 0 }, seeded(5));
    expect(run(d, 60)).toHaveLength(0);
    expect(d.wind).toBe(0);
  });
});

describe('ambienceFor', () => {
  it('uses profile defaults, drops the far battle on zone-less maps and applies overrides', () => {
    expect(ambienceFor('indoor', true)).toEqual({ wind: 0, birds: 0, battle: 0 });
    expect(ambienceFor('outdoor_day', false).battle).toBe(0);
    expect(ambienceFor('outdoor_day', true).battle).toBeGreaterThan(0);
    expect(ambienceFor('overcast', true, { birds: 0.1 }).birds).toBe(0.1);
  });

  it('is validated in map files', () => {
    const map = (ambience: unknown) => ({
      meta: { id: 'm', name: 'm', version: 2 },
      world: { size: [10, 10], visualProfile: 'outdoor_day', ambience },
      spawns: [{ team: 'player', pos: [0, 0, 0], yaw: 0 }],
      objects: [],
    });
    expect(validateMap(map({ wind: 0.8, birds: 0 }))).toEqual([]);
    expect(validateMap(map({ wind: 2 }))).not.toEqual([]);
    expect(validateMap(map({ rain: 0.5 }))).not.toEqual([]);
  });
});
