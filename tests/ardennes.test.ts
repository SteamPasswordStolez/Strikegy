import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Boundary, Terrain, polylineDistance } from '@/world/terrain';
import { resample } from '@/world/river';
import { validateMap } from '@/world/validateMap';
import type { MapDef } from '@/world/mapTypes';

const square = new Boundary([
  [-60, -60],
  [60, -60],
  [60, 60],
  [-60, 60],
]);
const river = { pts: [[0, -100], [0, 100]] as [number, number][], width: 10, depth: 2, bank: 4, water: 0.6 };

describe('rivers', () => {
  it('carve a flat bed with sloped banks', () => {
    const t = new Terrain({ rivers: [river] }, square, [200, 200]);
    expect(t.heightAt(0, 0)).toBeCloseTo(-2);
    expect(t.heightAt(4.9, 10)).toBeCloseTo(-2);
    expect(t.heightAt(7, 10)).toBeLessThan(-0.2);
    expect(t.heightAt(7, 10)).toBeGreaterThan(-1.9);
    expect(t.heightAt(9.5, 10)).toBeCloseTo(0);
  });

  it('keep a valley where they leave the map instead of running into the hills', () => {
    const t = new Terrain({ rivers: [river] }, square, [200, 200]);
    const beyond = t.surfaceAt(0, 90);
    const side = t.surfaceAt(40, 90);
    expect(beyond).toBeLessThan(side - 3);
  });

  it('resamples the course evenly and ends on the last point', () => {
    const pts = resample([[0, 0], [0, 10], [10, 10]], 3);
    expect(pts[0]).toMatchObject({ x: 0, z: 0 });
    expect(pts[pts.length - 1]).toMatchObject({ x: 10, z: 10 });
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
      expect(d).toBeLessThanOrEqual(3.01);
    }
  });
});

describe('Ardennes map', () => {
  const map = JSON.parse(readFileSync('public/maps/ardennes.json', 'utf8')) as MapDef;

  it('is valid, winter, with seven zones', () => {
    expect(validateMap(map)).toEqual([]);
    expect(map.world.visualProfile).toBe('winter');
    expect(map.world.groundMaterial).toBe('snow');
    expect(map.zones?.map((z) => z.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('keeps trees off the river, roads and zones, and inside the outline', () => {
    const b = new Boundary(map.world.boundary!);
    const r = map.world.terrain!.rivers![0]!;
    expect(map.trees!.length).toBeGreaterThan(1000);
    expect(map.trees!.length).toBeLessThan(2600);
    for (const [x, z] of map.trees!) {
      expect(b.contains(x, z)).toBe(true);
      expect(polylineDistance(r.pts, x, z)).toBeGreaterThan(r.width / 2 + (r.bank ?? 5));
      for (const zone of map.zones!) expect(Math.hypot(x - zone.pos[0], z - zone.pos[2])).toBeGreaterThan(zone.radius);
    }
  });

  it('puts the blue base west of the river and red east of it', () => {
    const blue = map.spawns.filter((s) => s.team === 'blue');
    const red = map.spawns.filter((s) => s.team === 'red');
    expect(Math.max(...blue.map((s) => s.pos[0]))).toBeLessThan(-150);
    expect(Math.min(...red.map((s) => s.pos[0]))).toBeGreaterThan(150);
  });
});
