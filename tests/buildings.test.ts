import { describe, expect, it } from 'vitest';
import { buildBuilding } from '@/world/buildings';

describe('building window spots', () => {
  it('stand just inside low windows, facing out, on every floor', () => {
    const b = buildBuilding({ pos: [10, -5], size: [14, 10], rot: 30, style: 'apartment', seed: 7 }, 2);
    expect(b.windows.length).toBeGreaterThan(4);
    const yaw = (30 * Math.PI) / 180;
    const floors = new Set<number>();
    for (const w of b.windows) {
      // Back into the building's local frame.
      const dx = w.pos[0] - 10;
      const dz = w.pos[2] + 5;
      const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      expect(Math.abs(lx)).toBeLessThan(7 - 0.3);
      expect(Math.abs(lz)).toBeLessThan(5 - 0.3);
      // Facing points away from the centre.
      expect(w.facing[0] * dx + w.facing[1] * dz).toBeGreaterThan(0);
      expect(Math.hypot(...w.facing)).toBeCloseTo(1);
      floors.add(Math.round(w.pos[1] - 2));
    }
    expect(floors.size).toBeGreaterThan(1);
  });

  it('solid blocks have no windows to stand at', () => {
    expect(buildBuilding({ pos: [0, 0], size: [10, 10], style: 'shop', solid: true }, 0).windows).toEqual([]);
  });
});
