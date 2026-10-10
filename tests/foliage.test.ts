import { describe, expect, it } from 'vitest';
import { Crowns } from '@/ai/foliage';

const flat = () => 0;

describe('tree crowns as bots see them', () => {
  it('a conifer hides what is behind its crown, not what is under it', () => {
    // H = 18 m: the crown runs from 3.6 m to the top, ~4.8 m wide at the bottom.
    const c = new Crowns([[0, 0, 1]], [100, 100], flat, 'conifer');
    // Near the ground only the drooping tips at the crown's edge: a line past the
    // trunk at 2 m crosses them on both sides, but sees the trunk area between.
    const low = c.depth(-10, 2, 0, 10, 2, 0);
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(c.depth(-10, 6, 0, 10, 6, 0));
    expect(c.depth(-10, 0.5, 0, 10, 0.5, 0)).toBe(0);
    const through = c.depth(-10, 6, 0, 10, 6, 0);
    expect(1 - Math.exp(-through)).toBeGreaterThan(0.9);
    // Past the crown's edge: clear.
    expect(c.depth(-10, 6, 8, 10, 6, 8)).toBe(0);
  });

  it('someone in a broadleaf crown is hidden at the end of the line', () => {
    // Orchard tree (scale 0.35): leaves ~3-5.4 m up (over the fork), ~2 m round.
    const c = new Crowns([[0, 0, 0.35]], [100, 100], flat, 'broadleaf');
    // Looking from 30 m at a chest 4 m up inside the crown (from a slope above).
    const tau = c.depth(-30, 4, 0, 0, 4, 0);
    expect(1 - Math.exp(-tau)).toBeGreaterThan(0.5);
    // At head height on flat ground the crown is above the line.
    expect(c.depth(-30, 1.6, 0, 10, 1.6, 0)).toBe(0);
  });

  it('crowns follow the ground they stand on', () => {
    // A tree on a 10 m rise: its crown starts 13.6 m up, so a line at 6 m only meets the hill.
    const hill = (x: number) => (Math.abs(x) < 5 ? 10 : 0);
    const c = new Crowns([[0, 0, 1]], [100, 100], (x) => hill(x), 'conifer');
    expect(c.depth(-10, 6, 0, 10, 6, 0)).toBe(0);
    expect(c.depth(-10, 16, 0, 10, 16, 0)).toBeGreaterThan(2);
  });

  it('thick woods stop adding past full cover (bounded work)', () => {
    const trees: [number, number, number][] = [];
    for (let i = -40; i <= 40; i += 4) trees.push([i, 0, 1]);
    const c = new Crowns(trees, [200, 200], flat, 'conifer');
    expect(c.depth(-45, 6, 0, 45, 6, 0)).toBeGreaterThanOrEqual(4);
  });
});
