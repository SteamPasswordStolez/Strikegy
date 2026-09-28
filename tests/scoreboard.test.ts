import { describe, expect, it } from 'vitest';
import { POINTS, ScoreTracker } from '@/modes/scoreTracker';

function tracker() {
  const s = new ScoreTracker();
  s.add(0, 'You', 'blue');
  s.add(1, 'Mate', 'blue');
  s.add(10, 'Foe', 'red');
  s.add(11, 'Foe2', 'red');
  return s;
}

describe('score tracker', () => {
  it('scores kills (headshots extra) and counts deaths', () => {
    const s = tracker();
    s.kill(0, 10, false);
    s.kill(0, 11, true);
    s.death(10);
    s.death(11);
    expect(s.get(0)).toMatchObject({ kills: 2, deaths: 0, score: 2 * POINTS.kill + POINTS.headshot });
    expect(s.get(10)!.deaths).toBe(1);
    expect(s.totals('blue').kills).toBe(2);
    expect(s.totals('red').deaths).toBe(2);
  });

  it('ignores self-kills, teamkills and unknown attackers', () => {
    const s = tracker();
    s.kill(0, 0, false);
    s.kill(0, 1, false);
    s.kill(undefined, 10, false);
    s.kill(99, 10, false);
    expect(s.get(0)!.kills).toBe(0);
    expect(s.totals('blue').kills + s.totals('red').kills).toBe(0);
  });

  it('credits zone captures and neutralizations and sorts by score', () => {
    const s = tracker();
    s.objective([1], 'capture');
    s.objective([0, 1], 'neutralize');
    s.kill(0, 10, false);
    expect(s.get(1)).toMatchObject({ captures: 1, score: POINTS.capture + POINTS.neutralize });
    expect(s.get(0)).toMatchObject({ captures: 0, score: POINTS.kill + POINTS.neutralize });
    expect(s.table('blue').map((r) => r.id)).toEqual([1, 0]);
    expect(s.table('red').map((r) => r.team)).toEqual(['red', 'red']);
  });
});
