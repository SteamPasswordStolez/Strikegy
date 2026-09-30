import { describe, expect, it } from 'vitest';
import { sanitizeLayout, SIZE_MAX } from '@/input/touchLayout';
import * as THREE from 'three';
import { applyAimAssist } from '@/input/aimAssist';
import { Boundary, Terrain, buildTerrain } from '@/world/terrain';
import { PhysicsWorld } from '@/physics/PhysicsWorld';

const DEG = Math.PI / 180;

describe('touch aim assist', () => {
  const opts = { ads: false, firing: false, dt: 1 / 60 };

  it('does nothing without a target or far off it', () => {
    expect(applyAimAssist(0.01, 0.005, null, opts)).toEqual([0.01, 0.005]);
    expect(applyAimAssist(0.01, 0, { yaw: 20 * DEG, pitch: 0, distance: 30 }, opts)).toEqual([0.01, 0]);
  });

  it('slows the view down on a target, more when aiming', () => {
    const on = { yaw: 0.2 * DEG, pitch: 0, distance: 30 };
    const [hip] = applyAimAssist(0.01, 0, on, opts);
    const [ads] = applyAimAssist(0.01, 0, on, { ...opts, ads: true });
    expect(hip).toBeLessThan(0.01);
    expect(ads).toBeLessThan(hip);
  });

  it('pulls gently toward the target only while aiming or firing, never overshooting', () => {
    const near = { yaw: 1.5 * DEG, pitch: -0.5 * DEG, distance: 25 };
    expect(applyAimAssist(0, 0, near, opts)).toEqual([0, 0]);
    const [y, p] = applyAimAssist(0, 0, near, { ...opts, ads: true });
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(near.yaw);
    expect(p).toBeLessThan(0);
    expect(p).toBeGreaterThan(near.pitch);
  });
});

describe('terrain render detail', () => {
  it('a coarse render mesh keeps the collider grid and matches heights at its vertices', async () => {
    const square = new Boundary([
      [-40, -30],
      [40, -30],
      [40, 30],
      [-40, 30],
    ]);
    const t = new Terrain({ hills: [{ pos: [0, 0], radius: 30, height: 5 }] }, square, [100, 80]);
    const physics = await PhysicsWorld.create();
    const fine = buildTerrain(t, new THREE.MeshBasicMaterial(), physics, 1);
    const coarse = buildTerrain(t, new THREE.MeshBasicMaterial(), physics, 2);
    const nf = fine.mesh.geometry.getAttribute('position').count;
    const nc = coarse.mesh.geometry.getAttribute('position').count;
    expect(nc).toBeLessThan(nf / 3);
    const pos = coarse.mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 37) expect(pos.getY(i)).toBeCloseTo(t.surfaceAt(pos.getX(i), pos.getZ(i)), 4);
    expect(coarse.grid.cols).toBe(fine.grid.cols);
  });
});

describe('touch layout', () => {
  it('keeps known buttons on screen with sizes in range and drops junk', () => {
    const l = sanitizeLayout({
      fire: { x: 0.9, y: 0.8, s: 1.2 },
      jump: { x: -3, y: 2, s: 9 },
      ads: { x: 'a', y: 0.5 },
      nope: { x: 0.5, y: 0.5, s: 1 },
      reload: { x: 0.5, y: 0.5 },
    });
    expect(l.fire).toEqual({ x: 0.9, y: 0.8, s: 1.2 });
    expect(l.jump).toEqual({ x: 0.02, y: 0.98, s: SIZE_MAX });
    expect(l.ads).toBeUndefined();
    expect((l as Record<string, unknown>).nope).toBeUndefined();
    expect(l.reload!.s).toBe(1);
    expect(sanitizeLayout(null)).toEqual({});
    expect(sanitizeLayout('x')).toEqual({});
  });
});
