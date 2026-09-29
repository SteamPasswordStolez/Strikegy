import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildGun } from '@/weapons/gunModels';
import { WEAPONS } from '@/weapons/weaponData';

function triangles(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      const g = c.geometry as THREE.BufferGeometry;
      n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    }
  });
  return n;
}

describe('procedural guns', () => {
  it('first-person guns carry the fine parts; bot copies stay light', () => {
    for (const def of Object.values(WEAPONS)) {
      if (def.class === 'pistol') continue;
      const full = triangles(buildGun(def).group);
      const low = triangles(buildGun(def, { detail: 'low' }).group);
      expect(full).toBeGreaterThan(low * 1.3);
      // Bots bake these into their soldier models: keep them near the old budget.
      expect(low).toBeLessThan(3200);
    }
  }, 30000);

  it('muzzle devices move the muzzle forward and every mesh has valid bounds', () => {
    const plain = buildGun(WEAPONS.smg1);
    const suppressed = buildGun(WEAPONS.smg3);
    expect(suppressed.muzzle.z).toBeLessThan(plain.muzzle.z - 0.1);
    for (const def of Object.values(WEAPONS)) {
      buildGun(def).group.traverse((c) => {
        if (c instanceof THREE.Mesh) expect(Number.isFinite(c.geometry.boundingSphere?.radius ?? 0)).toBe(true);
      });
    }
  }, 30000);
});
