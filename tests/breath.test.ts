import { describe, expect, it } from 'vitest';
import { BREATH, createBreath, scopeSway, stepBreath, type BreathEvent } from '@/weapons/breath';

const DT = 1 / 60;

function run(s: ReturnType<typeof createBreath>, seconds: number, want: boolean, scoped = true): BreathEvent[] {
  const evs: BreathEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const e = stepBreath(s, DT, want, scoped);
    if (e) evs.push(e);
  }
  return evs;
}

/** Largest sway offset over a stretch of time (radians). */
function peakSway(s: ReturnType<typeof createBreath>, seconds: number, want: boolean): number {
  const o = { pitch: 0, yaw: 0 };
  let peak = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepBreath(s, DT, want, true);
    scopeSway(s, i * DT, 0.01, 1, 1, o);
    peak = Math.max(peak, Math.hypot(o.pitch, o.yaw));
  }
  return peak;
}

describe('holding the breath behind a scope', () => {
  it('steadies the sway to almost nothing for the first seconds', () => {
    const free = peakSway(createBreath(), 6, false);
    const s = createBreath();
    run(s, 0.8, true);
    const held = peakSway(s, 3, true);
    expect(free).toBeGreaterThan(0.006);
    expect(held).toBeLessThan(free * 0.15);
    expect(s.dark).toBe(0);
  });

  it('only works while scoped', () => {
    const s = createBreath();
    expect(run(s, 1, true, false)).toEqual([]);
    expect(s.holding).toBe(false);
    expect(s.air).toBe(BREATH.air);
  });

  it('darkens past the steady part and blacks out, letting go by itself', () => {
    const s = createBreath();
    run(s, BREATH.steady + 2, true);
    expect(s.dark).toBeGreaterThan(0.3);
    expect(s.dark).toBeLessThan(1);
    const evs = run(s, BREATH.air - BREATH.steady, true);
    expect(evs).toContain('gasp');
    expect(s.holding).toBe(false);
    expect(s.locked).toBe(true);
    // Can't hold again until the lungs refill; the black clears.
    run(s, 1, true);
    expect(s.holding).toBe(false);
    run(s, 4, false);
    expect(s.locked).toBe(false);
    expect(s.dark).toBe(0);
  });

  it('shakes harder right after a long hold', () => {
    const rested = peakSway(createBreath(), 6, false);
    const s = createBreath();
    run(s, 8, true);
    run(s, 0.5, false);
    expect(peakSway(s, 2, false)).toBeGreaterThan(rested * 1.3);
  });
});
