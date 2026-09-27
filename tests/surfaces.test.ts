import { describe, expect, it } from 'vitest';
import { SurfaceRegistry } from '@/physics/surfaces';

describe('SurfaceRegistry', () => {
  it('returns painted patches on a collider, rotated like map boxes', () => {
    const s = new SurfaceRegistry();
    s.set(1, 'dirt');
    // A 2 m wide, 10 m long road turned 90 degrees: its length runs along x.
    s.paint(1, 0, 0, Math.PI / 2, 2, 10, 'concrete');
    expect(s.get(1)).toBe('dirt');
    expect(s.get(1, { x: 4, z: 0 })).toBe('concrete');
    expect(s.get(1, { x: 0, z: 4 })).toBe('dirt');
    expect(s.get(1, { x: 20, z: 0 })).toBe('dirt');
    expect(s.get(2, { x: 0, z: 0 })).toBe('concrete');
  });
});
