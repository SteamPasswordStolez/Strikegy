import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectTouch, isTouchDevice } from '@/core/Settings';

/** A device: which media queries match, how many touch points, what the settings say. */
function device(matches: string[], touchPoints: number, inputMode?: string): void {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: matches.includes(q) }));
  vi.stubGlobal('navigator', { maxTouchPoints: touchPoints, languages: ['ko'] });
  const store = new Map<string, string>();
  if (inputMode) store.set('strikegy.settings.v1', JSON.stringify({ inputMode }));
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: () => {} });
}

afterEach(() => vi.unstubAllGlobals());

describe('touch or keyboard and mouse', () => {
  it('a phone or tablet is touch', () => {
    device(['(pointer: coarse)'], 5);
    expect(detectTouch()).toBe(true);
  });

  it('a touch-screen laptop with a touchpad is keyboard and mouse (it used to get the phone controls)', () => {
    device(['(pointer: fine)', '(any-pointer: fine)', '(any-hover: hover)'], 10);
    expect(detectTouch()).toBe(false);
  });

  it('a desktop is keyboard and mouse', () => {
    device(['(pointer: fine)', '(any-pointer: fine)', '(any-hover: hover)'], 0);
    expect(detectTouch()).toBe(false);
  });

  it('touch points and no mouse at all is touch', () => {
    device([], 5);
    expect(detectTouch()).toBe(true);
  });

  it('the setting wins over the guess', () => {
    device(['(pointer: coarse)'], 5, 'desktop');
    expect(isTouchDevice()).toBe(false);
    device(['(any-pointer: fine)'], 0, 'touch');
    expect(isTouchDevice()).toBe(true);
    device(['(any-pointer: fine)'], 10, 'auto');
    expect(isTouchDevice()).toBe(false);
  });
});
