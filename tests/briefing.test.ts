import { describe, expect, it } from 'vitest';
import { BriefingScheduler } from '../src/audio/briefing/scheduler';
import { BRIEF_RULES, CUES, allVoiceFiles, voiceFile, type CueId } from '../src/audio/briefing/cues';
import ko from '../src/i18n/ko.json';
import en from '../src/i18n/en.json';

/** Runs the scheduler like the game does: offers, then asks every 0.1 s, each line lasting `len` s. */
function run(s: BriefingScheduler, until: number, len = 2.5, from = 0): { t: number; cue: CueId; zone?: string; cut: boolean }[] {
  const out: { t: number; cue: CueId; zone?: string; cut: boolean }[] = [];
  for (let t = from; t <= until + 1e-9; t = Math.round((t + 0.1) * 10) / 10) {
    const got = s.next(t);
    if (!got) continue;
    s.started(got.pick, t, len);
    out.push({ t, cue: got.pick.cue, zone: got.pick.zone, cut: got.cut });
  }
  return out;
}

describe('briefing scheduler', () => {
  it('says one line at a time, the most urgent first, with a gap between', () => {
    const s = new BriefingScheduler(() => 0);
    s.offer('zone.taken', 0, 'A');
    s.offer('zone.lost', 0, 'B');
    const said = run(s, 20);
    expect(said.map((x) => x.cue)).toEqual(['zone.lost', 'zone.taken']);
    // The second (priority 2) waits for the first to end plus the gap.
    expect(said[1]!.t).toBeGreaterThanOrEqual(2.5 + BRIEF_RULES.gap - 1e-9);
  });

  it('drops stale news and lets priority 1 cut a lower line off', () => {
    const s = new BriefingScheduler(() => 0);
    s.offer('zone.attacked', 0);
    let said = run(s, 0.5);
    expect(said.map((x) => x.cue)).toEqual(['zone.attacked']);
    s.offer('zone.lost', 0.6, 'C');
    said = run(s, 1, 2.5, 0.6);
    expect(said[0]).toMatchObject({ cue: 'zone.lost', cut: true });
    // A priority 3 offered while busy for longer than it may wait is gone.
    s.offer('hill.soon', 1);
    expect(run(s, 30, 2.5, 1.1).map((x) => x.cue)).not.toContain('hill.soon');
  });

  it('keeps cooldowns, per zone for zone cues, and skips a zone flipping back', () => {
    const s = new BriefingScheduler(() => 0);
    s.offer('zone.taken', 0, 'A');
    run(s, 1);
    s.offer('zone.taken', 5, 'A'); // cooldown 20 s
    s.offer('zone.taken', 5, 'B'); // another zone: fine
    expect(run(s, 15, 2.5, 5).map((x) => x.zone)).toEqual(['B']);
    s.offer('zone.lost', 12, 'B'); // B flipped back within 20 s
    expect(run(s, 30, 2.5, 12)).toEqual([]);
  });

  it('caps news at six lines a minute and never repeats a variant twice running', () => {
    const s = new BriefingScheduler(() => 0.99);
    const said: CueId[] = [];
    let t = 0;
    for (const z of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      s.offer('zone.taken', t, z);
      said.push(...run(s, t + 7, 1, t).map((x) => x.cue));
      t += 7.1;
    }
    for (let i = 0; i < 3; i++) {
      s.offer('zone.attacked', t);
      said.push(...run(s, t + 0.5, 1, t).map((x) => x.cue));
      t += 0.6;
    }
    // Seven zone lines in ~50 s, then the priority 3 lines hit the cap.
    expect(said.filter((c) => c === 'zone.attacked').length).toBe(0);
    const v = new BriefingScheduler(() => 0.4);
    v.offer('start.zone', 0);
    const a = v.next(0)!;
    v.started(a.pick, 0, 0);
    v.offer('start.zone', 100);
    const b = v.next(100)!;
    expect(b.pick.n).not.toBe(a.pick.n);
  });
});

describe('briefing lines', () => {
  it('has a subtitle in both languages for every variant and a headline for every cue', () => {
    const tables = { ko: ko as Record<string, string>, en: en as Record<string, string> };
    for (const cue of Object.keys(CUES) as CueId[]) {
      for (const [lang, table] of Object.entries(tables)) {
        expect(table[`crit.${cue}`], `${lang} crit.${cue}`).toBeTruthy();
        for (let n = 1; n <= CUES[cue].lines; n++) {
          const line = table[`brief.${cue}.${n}`];
          expect(line, `${lang} brief.${cue}.${n}`).toBeTruthy();
          // Zone cues name the zone; nothing else does.
          expect(line!.includes('{z}'), `${lang} brief.${cue}.${n} {z}`).toBe(!!CUES[cue].zone);
        }
      }
    }
  });

  it('names every voice file once', () => {
    const files = allVoiceFiles().map((f) => f.file);
    expect(new Set(files).size).toBe(files.length);
    expect(files).toContain(voiceFile('zone.taken', 1, 'B'));
  });
});
