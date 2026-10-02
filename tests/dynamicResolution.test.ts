import { describe, expect, it } from 'vitest';
import { DRS, DynamicResolution } from '@/render/dynamicResolution';

/** Feeds `sec` seconds of frames with the given interval pattern (ms). */
function run(d: DynamicResolution, sec: number, pattern: number[]): void {
  let t = 0;
  let i = 0;
  while (t < sec) {
    const ms = pattern[i++ % pattern.length]!;
    d.update(ms / 1000, ms);
    t += ms / 1000;
  }
}

describe('DynamicResolution', () => {
  it('holds scale at a steady 60 fps', () => {
    const d = new DynamicResolution();
    run(d, 30, [16.7]);
    expect(d.scale).toBe(1);
  });

  it('steps down when a quarter of frames drop, even though the average looks fine', () => {
    const d = new DynamicResolution();
    run(d, 3, [16.7, 16.7, 16.7, 33.3]);
    expect(d.scale).toBeLessThan(1);
    run(d, 30, [16.7, 16.7, 16.7, 33.3]);
    expect(d.scale).toBe(DRS.min);
  });

  it('ignores throttled frames and never exceeds the pixel-budget cap', () => {
    const d = new DynamicResolution();
    d.setMax(0.85);
    expect(d.scale).toBe(0.85);
    run(d, 10, [1000]);
    expect(d.scale).toBe(0.85);
    run(d, 60, [16.7]);
    expect(d.scale).toBe(0.85);
  });

  it('steps down on a device that is always slower than 17 fps, but not for a lone hitch', () => {
    const d = new DynamicResolution();
    run(d, 30, [...Array<number>(29).fill(16.7), 80]);
    expect(d.scale).toBe(1);
    run(d, 30, [80]);
    expect(d.scale).toBe(DRS.min);
  });

  it('climbs back after load goes away, and backs off after a failed climb', () => {
    const d = new DynamicResolution();
    run(d, 10, [33.3]);
    const low = d.scale;
    run(d, 8, [16.7]);
    expect(d.scale).toBeGreaterThan(low);
    // Load returns right after the climb: it must wait longer before retrying.
    run(d, 3, [33.3]);
    const after = d.scale;
    run(d, DRS.upWaitSec + 1, [16.7]);
    expect(d.scale).toBe(after);
  });
});
