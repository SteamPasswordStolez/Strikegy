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
      logPile: [6, 1.6, 2.4],
      hayBale: [2.6, 1.5, 1.5],
      bunker: [7, 3, 5],
      fence: [8, 1.1, 0.3],
      steeple: [5, 22, 5],
      sawShed: [12, 5, 7],
      archBridge: [8, 4.6, 34],
      trussBridge: [5, 8.5, 36],
      bus: [2.55, 3.1, 12],
      fuelCanopy: [14, 5.4, 9],
      waterTower: [6, 18, 6],
      tankWreck: [3.6, 2.6, 7.4],
      millWheel: [1.4, 6, 6],
      cart: [1.8, 1.7, 4.2],
      silo: [6, 15, 6],
      stall: [3, 2.6, 2.4],
      crane: [10, 12, 6],
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
      // The fountain's centre column rises over its basin (the box).
      expect(bb.max.y, kind).toBeLessThan(h + (kind === 'fountain' ? 2 : 1));
      expect(bb.max.x - bb.min.x, kind).toBeLessThan(Math.max(w, d) + 2);
      expect(bb.max.x - bb.min.x, kind).toBeGreaterThan(Math.min(w, d) * 0.5);
    }
  });
});
