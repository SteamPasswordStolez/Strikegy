import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MODEL_KINDS, buildKit } from '@/world/modelKits';

describe('model kits', () => {
  it('every kit fills (roughly) its box and merges cleanly', () => {
    const size: Record<string, [number, number, number]> = {
      car: [1.9, 1.5, 4.4],
      truck: [2.5, 3, 7],
      container: [2.44, 2.6, 6.1],
      boxcar: [3, 3.6, 12],
      fuelTank: [6, 5, 6],
      tent: [5, 3, 4],
      sandbags: [3, 1.1, 0.8],
      hesco: [1.1, 2.1, 8],
      watchtower: [3, 7.5, 3],
      booth: [2.4, 2.8, 2.4],
      pump: [1, 1.6, 0.6],
      fountain: [3.4, 1, 3.4],
      statue: [0.8, 3.2, 0.8],
      bench: [2.2, 0.8, 0.6],
    };
    for (const kind of MODEL_KINDS) {
      const [w, h, d] = size[kind]!;
      const kit = buildKit(kind, w, h, d, () => 0.5);
      expect(kit.pieces.length, kind).toBeGreaterThan(0);
      const bb = new THREE.Box3();
      for (const p of kit.pieces) {
        expect(p.geo.index, kind).toBeNull();
        expect(p.geo.getAttribute('uv'), kind).toBeDefined();
        expect(p.geo.getAttribute('normal'), kind).toBeDefined();
        p.geo.computeBoundingBox();
        bb.union(p.geo.boundingBox!);
      }
      // Sits on the ground and stays near its footprint (small overhangs allowed).
      expect(bb.min.y, kind).toBeGreaterThan(-0.1); // tent stakes go into the ground
      expect(bb.max.y, kind).toBeLessThan(h + 1);
      expect(bb.max.x - bb.min.x, kind).toBeLessThan(Math.max(w, d) + 2);
      expect(bb.max.x - bb.min.x, kind).toBeGreaterThan(Math.min(w, d) * 0.5);
    }
  });
});
