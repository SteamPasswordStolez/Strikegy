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
  // Valley town (2026-10-11): the deep river beyond the quay, a wadeable creek in a ravine.
  const map = JSON.parse(readFileSync('public/maps/ardennes.json', 'utf8')) as MapDef;
  const [bigRiver, creek] = map.world.terrain!.rivers!;
  const creekClear = creek!.width / 2 + (creek!.bank ?? 5);

  it('is valid, winter, about 490 x 280 m, with six zones in two rows', () => {
    expect(validateMap(map)).toEqual([]);
    expect(map.world.visualProfile).toBe('winter');
    expect(map.world.groundMaterial).toBe('snow');
    expect(map.zones?.map((z) => z.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    for (const z of map.zones!) {
      expect(z.radius).toBeGreaterThanOrEqual(28);
      expect(z.radius).toBeLessThanOrEqual(36);
    }
    const xs = map.world.boundary!.map((p) => p[0]);
    const zs = map.world.boundary!.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(440);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(540);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(240);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(320);
    // Upper row (A, C, E) north of the lower row (B, D, F).
    const z = (id: string) => map.zones!.find((q) => q.id === id)!.pos[2];
    for (const [up, low] of [['A', 'B'], ['C', 'D'], ['E', 'F']]) expect(z(up!)).toBeLessThan(z(low!) - 60);
  });

  it('keeps trees inside the outline, out of the creek and the zones', () => {
    const b = new Boundary(map.world.boundary!);
    expect(map.trees!.length).toBeGreaterThan(120);
    for (const [x, z] of map.trees!) {
      expect(b.contains(x, z)).toBe(true);
      expect(polylineDistance(creek!.pts, x, z)).toBeGreaterThan(creekClear);
      for (const zone of map.zones!) expect(Math.hypot(x - zone.pos[0], z - zone.pos[2])).toBeGreaterThan(zone.radius - 4);
    }
  });

  it('puts the blue base at the west end and red at the east end', () => {
    const blue = map.spawns.filter((s) => s.team === 'blue');
    const red = map.spawns.filter((s) => s.team === 'red');
    expect(Math.max(...blue.map((s) => s.pos[0]))).toBeLessThan(-150);
    expect(Math.min(...red.map((s) => s.pos[0]))).toBeGreaterThan(150);
  });

  it('has the deep river outside the playable area and a wadeable creek with three bridges and a rail truss', () => {
    expect(bigRiver!.water!).toBeGreaterThan(5);
    for (const [x, z] of map.world.boundary!) expect(polylineDistance(bigRiver!.pts, x, z)).toBeGreaterThan(bigRiver!.width / 2);
    expect(creek!.water!).toBeLessThanOrEqual(0.8);
    expect(creek!.crossings).toHaveLength(3);
    expect(map.objects.map((o) => o.model)).toContain('trussBridge');
    for (const bd of map.buildings!) expect(polylineDistance(creek!.pts, bd.pos[0], bd.pos[1])).toBeGreaterThan(creek!.width / 2 + Math.min(...bd.size) / 2);
  });

  it('has the big hotel on the upper terrace, the church, the station, the depot and the sawmill', () => {
    const hotel = map.buildings!.filter((b) => b.style === 'hotel');
    expect(hotel).toHaveLength(1);
    expect(hotel[0]!.floors).toBe(4);
    const c = map.zones!.find((z) => z.id === 'C')!;
    expect(Math.hypot(hotel[0]!.pos[0] - c.pos[0], hotel[0]!.pos[1] - c.pos[2])).toBeLessThan(45);
    const styles = new Set(map.buildings!.map((b) => b.style));
    for (const s of ['inn', 'mill', 'depot', 'chapel', 'station', 'warehouse']) expect(styles).toContain(s);
    const models = new Set(map.objects.map((o) => o.model));
    for (const k of ['sawShed', 'logPile', 'steeple', 'waterTower', 'crane', 'boxcar', 'bunker', 'tankWreck', 'bus']) expect(models).toContain(k);
  });

  it('keeps the costly clutter in check', () => {
    expect(map.props!.length).toBeLessThanOrEqual(30);
    expect(map.objects.filter((o) => o.model === 'sandbags').length).toBeLessThanOrEqual(60);
  });

  it('reaches every zone and both bases by road', () => {
    const strips = map.objects.filter((o) => o.type === 'floor' && (o.material === 'asphalt' || o.material === 'cobble'));
    const near = (x: number, z: number, r: number) => strips.some((s) => Math.hypot(s.pos[0] - x, s.pos[2] - z) < r);
    for (const zone of map.zones!) expect(near(zone.pos[0], zone.pos[2], zone.radius + 10)).toBe(true);
    for (const team of ['blue', 'red']) {
      const sp = map.spawns.find((s) => s.team === team)!;
      expect(near(sp.pos[0], sp.pos[2], 25)).toBe(true);
    }
  });
});
