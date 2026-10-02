import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Boundary, polylineDistance } from '@/world/terrain';
import { validateMap } from '@/world/validateMap';
import type { MapDef } from '@/world/mapTypes';

const load = (id: string) => JSON.parse(readFileSync(`public/maps/${id}.json`, 'utf8')) as MapDef;

describe('Lyon meadow map', () => {
  const map = load('lyon');

  it('is valid: summer meadow, broadleaf trees, three zones', () => {
    expect(validateMap(map)).toEqual([]);
    expect(map.world.groundMaterial).toBe('grass');
    expect(map.world.flora).toBe('broadleaf');
    expect(map.zones?.map((z) => z.id)).toEqual(['A', 'B', 'C']);
  });

  it('has blue in the north, red in the south of the creek', () => {
    const blue = map.spawns.filter((s) => s.team === 'blue');
    const red = map.spawns.filter((s) => s.team === 'red');
    expect(Math.max(...blue.map((s) => s.pos[2]))).toBeLessThan(-100);
    expect(Math.min(...red.map((s) => s.pos[2]))).toBeGreaterThan(100);
    expect(map.world.terrain!.rivers![0]!.crossings).toHaveLength(3);
  });

  it('keeps trees inside the outline and out of the creek', () => {
    const b = new Boundary(map.world.boundary!);
    const r = map.world.terrain!.rivers![0]!;
    for (const [x, z] of map.trees!) {
      expect(b.contains(x, z)).toBe(true);
      expect(polylineDistance(r.pts, x, z)).toBeGreaterThan(r.width / 2 + (r.bank ?? 5));
    }
  });
});

describe('Persia desert map', () => {
  const map = load('persia');

  it('is valid: desert, palms, light vehicles only, three zones', () => {
    expect(validateMap(map)).toEqual([]);
    expect(map.world.visualProfile).toBe('desert');
    expect(map.world.groundMaterial).toBe('sand');
    expect(map.world.flora).toBe('palm');
    expect(map.world.vehicles).toBe('light');
    expect(map.zones?.map((z) => z.id)).toEqual(['A', 'B', 'C']);
  });

  it('is small (about 180 x 140 m) with blue north-west and red south-east', () => {
    const xs = map.world.boundary!.map((p) => p[0]);
    const zs = map.world.boundary!.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(220);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(170);
    const blue = map.spawns.find((s) => s.team === 'blue')!;
    const red = map.spawns.find((s) => s.team === 'red')!;
    expect(blue.pos[0]).toBeLessThan(0);
    expect(blue.pos[2]).toBeLessThan(0);
    expect(red.pos[0]).toBeGreaterThan(0);
    expect(red.pos[2]).toBeGreaterThan(0);
  });
});
