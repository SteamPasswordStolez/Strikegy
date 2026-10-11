import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAPS, RANGE_ID, TEAM_SIZES, matchQuery, snapTeam } from '@/data/maps';
import { browserLocale } from '@/core/Settings';
import ko from '@/i18n/ko.json';
import en from '@/i18n/en.json';

describe('lobby', () => {
  it('starts a match at the address main.ts reads: the player plus team-1 bots against team bots', () => {
    const q = new URLSearchParams(matchQuery({ map: 'iron_gate', mode: 'frontline', team: 12, difficulty: 'hard', side: 'red' }));
    expect(q.get('map')).toBe('iron_gate');
    expect(q.get('bots')).toBe('11v12');
    expect(q.get('mode')).toBe('frontline');
    expect(q.get('difficulty')).toBe('hard');
    expect(q.get('side')).toBe('red');
    expect(matchQuery({ map: RANGE_ID, mode: 'zone', team: 12, difficulty: 'normal', side: 'random' })).toBe('?map=sandbox&bots=0');
    expect(new URLSearchParams(matchQuery({ map: 'persia', mode: 'zone', team: 1, difficulty: 'easy', side: 'blue' })).get('bots')).toBe('0v1');
  });

  it('settles a random side when the match starts', () => {
    const pick = { map: 'lyon', mode: 'zone', team: 16, difficulty: 'normal', side: 'random' } as const;
    expect(new URLSearchParams(matchQuery(pick, () => 0.2)).get('side')).toBe('blue');
    expect(new URLSearchParams(matchQuery(pick, () => 0.7)).get('side')).toBe('red');
  });

  it('starts in English unless the browser asks for Korean first', () => {
    expect(browserLocale(['ko-KR', 'en-US'])).toBe('ko');
    expect(browserLocale(['ko'])).toBe('ko');
    expect(browserLocale(['en-US', 'ko'])).toBe('en');
    expect(browserLocale(['ja-JP'])).toBe('en');
    expect(browserLocale([])).toBe('ko');
  });

  it('snaps team sizes to the list and offers up to 150 a side', () => {
    expect(snapTeam(13)).toBe(12);
    expect(snapTeam(1000)).toBe(150);
    expect(snapTeam(0)).toBe(1);
    expect(TEAM_SIZES.at(-1)).toBe(150);
    for (const m of MAPS) expect(TEAM_SIZES).toContain(m.team);
  });

  it('every map in the list exists and has a name and blurb in both languages', () => {
    for (const id of [...MAPS.map((m) => m.id), RANGE_ID]) {
      const file = `public/maps/${id}.json`;
      expect(existsSync(file)).toBe(true);
      expect(JSON.parse(readFileSync(file, 'utf8')).meta.id).toBe(id);
      for (const table of [ko, en] as Record<string, string>[]) {
        expect(table[`map.${id}`]).toBeTruthy();
        expect(table[`mapDesc.${id}`]).toBeTruthy();
      }
    }
  });
});
