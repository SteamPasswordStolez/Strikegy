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
  const river = map.world.terrain!.rivers![0]!;
  const riverClear = river.width / 2 + (river.bank ?? 5);

  it('is valid, winter, about 800 x 650 m, with seven big zones', () => {
    expect(validateMap(map)).toEqual([]);
    expect(map.world.visualProfile).toBe('winter');
    expect(map.world.groundMaterial).toBe('snow');
    expect(map.zones?.map((z) => z.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    for (const z of map.zones!) {
      expect(z.radius).toBeGreaterThanOrEqual(32);
      expect(z.radius).toBeLessThanOrEqual(40);
    }
    const xs = map.world.boundary!.map((p) => p[0]);
    const zs = map.world.boundary!.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(760);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(840);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(620);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(690);
  });

  it('keeps trees off the river, roads and zones, and inside the outline', () => {
    const b = new Boundary(map.world.boundary!);
    expect(map.trees!.length).toBeGreaterThan(2000);
    expect(map.trees!.length).toBeLessThanOrEqual(3000);
    for (const [x, z] of map.trees!) {
      expect(b.contains(x, z)).toBe(true);
      expect(polylineDistance(river.pts, x, z)).toBeGreaterThan(riverClear);
      for (const zone of map.zones!) expect(Math.hypot(x - zone.pos[0], z - zone.pos[2])).toBeGreaterThan(zone.radius);
    }
  });

  it('puts the blue base west of the river and red east of it', () => {
    const blue = map.spawns.filter((s) => s.team === 'blue');
    const red = map.spawns.filter((s) => s.team === 'red');
    expect(Math.max(...blue.map((s) => s.pos[0]))).toBeLessThan(-250);
    expect(Math.min(...red.map((s) => s.pos[0]))).toBeGreaterThan(250);
  });

  it('has a meandering, wadeable river with three bridges', () => {
    expect(river.water!).toBeLessThanOrEqual(0.8);
    expect(river.crossings).toHaveLength(3);
    const b = new Boundary(map.world.boundary!);
    const xs = river.pts.filter(([x, z]) => b.contains(x, z)).map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(60);
    const models = map.objects.map((o) => o.model);
    for (const kit of ['archBridge', 'trussBridge']) expect(models).toContain(kit);
    // No building stands in the river channel.
    for (const bd of map.buildings!) expect(polylineDistance(river.pts, bd.pos[0], bd.pos[1])).toBeGreaterThan(river.width / 2 + Math.min(...bd.size) / 2);
  });

  it('has the big hotel, the watermill, the engine shed and the inns', () => {
    const hotel = map.buildings!.filter((b) => b.style === 'hotel');
    expect(hotel).toHaveLength(1);
    expect(hotel[0]!.floors).toBe(4);
    expect(Math.max(...hotel[0]!.size)).toBeLessThanOrEqual(56);
    // In the middle of the map, by the central village.
    expect(Math.hypot(hotel[0]!.pos[0], hotel[0]!.pos[1])).toBeLessThan(90);
    const styles = new Set(map.buildings!.map((b) => b.style));
    for (const s of ['inn', 'mill', 'depot', 'chapel', 'barn', 'station']) expect(styles).toContain(s);
    const models = new Set(map.objects.map((o) => o.model));
    for (const k of ['millWheel', 'waterTower', 'tankWreck', 'cart', 'bus', 'logPile', 'hayBale', 'bunker']) expect(models).toContain(k);
  });

  it('keeps the costly clutter in check', () => {
    // Scanned props are drawn every frame wherever they stand; sandbag kits are heavy.
    expect(map.props!.length).toBeLessThanOrEqual(30);
    expect(map.objects.filter((o) => o.model === 'sandbags').length).toBeLessThanOrEqual(24);
  });

  it('reaches every zone and both bases by road', () => {
    const strips = map.objects.filter((o) => o.type === 'floor' && o.material === 'ground' && o.color === '#8c8378');
    const near = (x: number, z: number, r: number) => strips.some((s) => Math.hypot(s.pos[0] - x, s.pos[2] - z) < r);
    for (const zone of map.zones!) expect(near(zone.pos[0], zone.pos[2], zone.radius + 10)).toBe(true);
    for (const team of ['blue', 'red']) {
      const sp = map.spawns.find((s) => s.team === team)!;
      expect(near(sp.pos[0], sp.pos[2], 25)).toBe(true);
    }
  });
});
