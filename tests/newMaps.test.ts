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
