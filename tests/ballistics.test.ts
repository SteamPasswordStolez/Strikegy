import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { landing, lobVelocity } from '@/ai/ballistics';

describe('grenade lobs', () => {
  it('lands on the target at various ranges and heights', () => {
    const from = new THREE.Vector3(0, 1.5, 0);
    for (const [x, y, z] of [
      [10, 0, 0],
      [0, 0, -25],
      [18, 3, 12],
      [-8, -2, 20],
    ] as const) {
      const to = new THREE.Vector3(x, y, z);
      const v = lobVelocity(from, to)!;
      expect(v).not.toBeNull();
      const p = landing(from, v, to.y);
      expect(Math.hypot(p.x - x, p.z - z)).toBeLessThan(0.3);
    }
  });

  it('refuses throws out of reach', () => {
    expect(lobVelocity(new THREE.Vector3(), new THREE.Vector3(200, 0, 0))).toBeNull();
  });
});
