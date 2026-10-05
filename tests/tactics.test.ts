import { describe, expect, it } from 'vitest';
import { TacticalMap, buildTactical, sectorDir, sectorOf, type RayFn } from '@/ai/tactics';
import { DANGER, DangerMap } from '@/ai/danger';

/**
 * A 10 x 10 m floor (two triangles) with a full-height wall along x = 5 and
 * a waist-high wall (1.2 m) along z = 5; the other two sides are open.
 */
const floor = {
  positions: [-5, 0, -5, 5, 0, -5, 5, 0, 5, -5, 0, 5],
  indices: [0, 1, 2, 0, 2, 3],
};
const walls: RayFn = (ox, oy, oz, dx, _dy, dz, len) => {
  if (dx > 1e-6) {
    const t = (5 - ox) / dx;
    if (t >= 0 && t <= len) return true;
  }
  if (dz > 1e-6) {
    const t = (5 - oz) / dz;
    if (t >= 0 && t <= len && oy < 1.2) return true;
  }
  return false;
};

describe('tactical points', () => {
  it('sectors: eight 45° slices, sector k points along its direction', () => {
    expect(sectorOf(1, 0)).toBe(0);
    expect(sectorOf(0, 1)).toBe(2);
    expect(sectorOf(-1, 0)).toBe(4);
    expect(sectorOf(0, -1)).toBe(6);
    expect(sectorOf(1, 1)).toBe(1);
    for (let k = 0; k < 8; k++) {
      const [x, z] = sectorDir(k);
      expect(sectorOf(x, z)).toBe(k);
    }
  });

  it('finds cover along walls only: full cover by the wall, low cover by the low wall, none on the open sides', async () => {
    const tm = await buildTactical(floor.positions, floor.indices, walls);
    expect(tm.count).toBeGreaterThan(4);
    let byWall = 0;
    let byLow = 0;
    for (let i = 0; i < tm.count; i++) {
      // Nothing by the open sides.
      expect(tm.x[i]! > 4 || tm.z[i]! > 4).toBe(true);
      if (tm.x[i]! > 4 && tm.z[i]! < 3) {
        byWall++;
        // A threat far out past the wall: hidden crouched and standing.
        expect(tm.cover(i, 60, tm.z[i]!)).toBe(2);
        // A threat inside the room: no cover from it.
        expect(tm.cover(i, -40, tm.z[i]!)).toBe(0);
      }
      if (tm.z[i]! > 4 && tm.x[i]! < 3) {
        byLow++;
        expect(tm.cover(i, tm.x[i]!, 60)).toBe(1);
      }
    }
    expect(byWall).toBeGreaterThan(1);
    expect(byLow).toBeGreaterThan(1);
  });

  it('finds nearby points and survives a round trip through bytes', async () => {
    const tm = await buildTactical(floor.positions, floor.indices, walls);
    const near = tm.near(4.5, 0, 3);
    expect(near.length).toBeGreaterThan(0);
    for (const i of near) expect(Math.hypot(tm.x[i]! - 4.5, tm.z[i]! - 0)).toBeLessThanOrEqual(3);
    const back = TacticalMap.fromBytes(tm.toBytes())!;
    expect(back.count).toBe(tm.count);
    for (let i = 0; i < tm.count; i++) {
      expect(back.x[i]).toBeCloseTo(tm.x[i]!, 5);
      expect(back.low[i]).toBe(tm.low[i]);
      expect(back.high[i]).toBe(tm.high[i]);
    }
    expect(TacticalMap.fromBytes(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('a wall with an end: the point by the end peeks out with a side step', async () => {
    // Wall along x = 5 only for z < -0.6: from the sample by its end (z = -1.25), a step toward +z clears it.
    const shortWall: RayFn = (ox, _oy, oz, dx, _dy, dz, len) => {
      if (dx <= 1e-6) return false;
      const t = (5 - ox) / dx;
      return t >= 0 && t <= len && oz + dz * t < -0.6;
    };
    const tm = await buildTactical(floor.positions, floor.indices, shortWall);
    const end = tm.near(4.5, -0.8, 1.5).find((i) => tm.cover(i, 60, tm.z[i]!) === 2);
    expect(end).toBeDefined();
    expect(tm.leanSide(end!, 60, tm.z[end!]!)).not.toBe(0);
  });
});

describe('danger map', () => {
  it('stamps fall off with distance and fade with time', () => {
    const d = new DangerMap(-100, -100, 100, 100);
    d.stamp(0, 0, 40, 1);
    expect(d.at(0, 0)).toBeGreaterThan(0.8);
    expect(d.at(30, 0)).toBeLessThan(d.at(10, 0));
    expect(d.at(80, 80)).toBe(0);
    const before = d.at(0, 0);
    d.decay(DANGER.halfLife);
    expect(d.at(0, 0)).toBeCloseTo(before / 2, 3);
  });

  it('a way through the danger costs more than one round it, and the watch turns toward it', () => {
    const d = new DangerMap(-200, -200, 200, 200);
    d.stamp(0, 0, 30, 2);
    const through = d.pathCost([{ x: -100, z: 0 }, { x: 100, z: 0 }]);
    const round = d.pathCost([{ x: -100, z: 0 }, { x: -100, z: 80 }, { x: 100, z: 80 }, { x: 100, z: 0 }]);
    expect(through).toBeGreaterThan(0);
    expect(round).toBe(0);
    // Standing west of it heading north (yaw 0 = -Z): the danger is to the east (yaw -90°).
    const yaw = d.watchYaw(-20, 0, 0, Math.PI / 2);
    expect(yaw).not.toBeNull();
    expect(yaw!).toBeCloseTo(-Math.PI / 2, 5);
    expect(d.watchYaw(-150, -150, 0, Math.PI / 2)).toBeNull();
  });
});
