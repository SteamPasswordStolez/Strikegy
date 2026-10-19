import { describe, expect, it } from 'vitest';
import { PRIO, placeVoice, type Prio, type VoiceSlot } from '@/audio/voiceLimit';

const LIM = { max: 6, lowReserve: 2, stealRatio: 2 };
const fill = (prio: Prio, loud: number, n = LIM.max): VoiceSlot[] => Array.from({ length: n }, () => ({ prio, loud }));

describe('world voice limit', () => {
  it('admits anything while voices are free', () => {
    expect(placeVoice(fill(PRIO.normal, 1, 3), 0.001, PRIO.normal, LIM)).toBe(-1);
    expect(placeVoice(fill(PRIO.normal, 1, 3), 0.001, PRIO.low, LIM)).toBe(-1);
  });

  it('never drops a near sound for further or quieter ones', () => {
    // Voices full of loud far cannon: a quiet near shot still gets in.
    const playing = fill(PRIO.normal, 5);
    expect(placeVoice(playing, 0.01, PRIO.near, LIM)).not.toBeNull();
    expect(placeVoice(fill(PRIO.low, 5), 0.01, PRIO.near, LIM)).not.toBeNull();
  });

  it('cuts the lowest priority first, then the quietest', () => {
    const playing: VoiceSlot[] = [
      { prio: PRIO.near, loud: 0.01 },
      { prio: PRIO.normal, loud: 0.5 },
      { prio: PRIO.normal, loud: 0.2 },
      { prio: PRIO.low, loud: 0.9 },
      { prio: PRIO.near, loud: 0.3 },
      { prio: PRIO.normal, loud: 0.4 },
    ];
    expect(placeVoice(playing, 0.05, PRIO.near, LIM)).toBe(3);
    expect(placeVoice(playing.filter((v) => v.prio !== PRIO.low).concat({ prio: PRIO.normal, loud: 1 }), 0.05, PRIO.near, LIM)).toBe(2);
  });

  it('near sounds give way only to louder near sounds', () => {
    const playing = fill(PRIO.near, 0.2);
    expect(placeVoice(playing, 0.1, PRIO.near, LIM)).toBeNull();
    expect(placeVoice(playing, 0.25, PRIO.near, LIM)).toBe(0);
    expect(placeVoice(playing, 9, PRIO.normal, LIM)).toBeNull();
  });

  it('normal sounds need to be clearly louder to cut their own kind', () => {
    const playing = fill(PRIO.normal, 0.1);
    expect(placeVoice(playing, 0.15, PRIO.normal, LIM)).toBeNull();
    expect(placeVoice(playing, 0.2, PRIO.normal, LIM)).toBe(0);
  });

  it('keeps the last voices away from low sounds', () => {
    const four = fill(PRIO.normal, 0.001, 4);
    expect(placeVoice(four, 9, PRIO.low, LIM)).toBeNull();
    const lows = fill(PRIO.low, 0.1, 4);
    expect(placeVoice(lows, 0.3, PRIO.low, LIM)).toBe(0);
    expect(placeVoice(lows, 0.15, PRIO.low, LIM)).toBeNull();
  });
});
