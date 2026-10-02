import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Boundary } from '@/world/terrain';
import { validateMap } from '@/world/validateMap';
import { MODEL_KINDS } from '@/world/modelKits';
import type { BuildingDef, MapDef } from '@/world/mapTypes';

const map = JSON.parse(readFileSync('public/maps/iron_gate.json', 'utf8')) as MapDef;

/** Footprint corners and axes of a building (map yaw: local x -> (cos, -sin), local z -> (sin, cos)). */
function box(b: BuildingDef) {
  const yaw = ((b.rot ?? 0) * Math.PI) / 180;
  const ax: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
  const az: [number, number] = [Math.sin(yaw), Math.cos(yaw)];
  const [hw, hd] = [b.size[0] / 2, b.size[1] / 2];
  const corners = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([u, v]) => [b.pos[0] + u! * ax[0] + v! * az[0], b.pos[1] + u! * ax[1] + v! * az[1]] as const);
  return { x: b.pos[0], z: b.pos[1], hw, hd, ax, az, corners };
}

/** Separating-axis test with a small tolerance (walls may touch). */
function overlaps(a: ReturnType<typeof box>, b: ReturnType<typeof box>, tol = 0.05): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [ux, uz] of [a.ax, a.az, b.ax, b.az]) {
    const ra = a.hw * Math.abs(a.ax[0] * ux + a.ax[1] * uz) + a.hd * Math.abs(a.az[0] * ux + a.az[1] * uz);
    const rb = b.hw * Math.abs(b.ax[0] * ux + b.ax[1] * uz) + b.hd * Math.abs(b.az[0] * ux + b.az[1] * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb - tol) return false;
  }
  return true;
}

describe('Iron Gate map', () => {
  it('is valid, with five zones A-E of radius 32-40 m at least 120 m apart', () => {
    expect(validateMap(map)).toEqual([]);
    expect(map.meta.id).toBe('iron_gate');
    const zones = map.zones!;
    expect(zones.map((z) => z.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    for (const z of zones) {
      expect(z.radius).toBeGreaterThanOrEqual(32);
      expect(z.radius).toBeLessThanOrEqual(40);
    }
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const d = Math.hypot(zones[i]!.pos[0] - zones[j]!.pos[0], zones[i]!.pos[2] - zones[j]!.pos[2]);
        expect(d, `${zones[i]!.id}-${zones[j]!.id}`).toBeGreaterThanOrEqual(120);
      }
    }
  });

  it('has a playable outline of about 500 x 360 m', () => {
    const xs = map.world.boundary!.map((p) => p[0]);
    const zs = map.world.boundary!.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(470);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(530);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(330);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(390);
  });

  it('puts the blue FOB in the south-west and the red garrison in the north-east', () => {
    const blue = map.spawns.filter((s) => s.team === 'blue');
    const red = map.spawns.filter((s) => s.team === 'red');
    expect(blue.length).toBeGreaterThan(0);
    expect(red.length).toBeGreaterThan(0);
    for (const s of blue) expect(s.pos[0] < -100 && s.pos[2] > 50).toBe(true);
    for (const s of red) expect(s.pos[0] > 100 && s.pos[2] < -50).toBe(true);
  });

  it('has one big enterable five-storey hospital between the zones', () => {
    const hospitals = map.buildings!.filter((b) => b.style === 'hospital');
    expect(hospitals).toHaveLength(1);
    const h = hospitals[0]!;
    expect(h.floors).toBe(5);
    expect(h.solid).toBeFalsy();
    expect(Math.max(...h.size)).toBeGreaterThanOrEqual(40);
    expect(Math.min(...h.size)).toBeGreaterThanOrEqual(18);
    for (const z of map.zones!) expect(Math.hypot(z.pos[0] - h.pos[0], z.pos[2] - h.pos[1])).toBeGreaterThan(z.radius + 15);
  });

  it('keeps buildings apart and inside the outline', () => {
    const outline = new Boundary(map.world.boundary!);
    const boxes = map.buildings!.map(box);
    for (const b of boxes) for (const [x, z] of b.corners) expect(outline.contains(x, z)).toBe(true);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i]!, boxes[j]!), `${JSON.stringify(map.buildings![i]!.pos)} / ${JSON.stringify(map.buildings![j]!.pos)}`).toBe(false);
      }
    }
  });

  it('only uses model kits this build knows', () => {
    const kits = new Set<string>(MODEL_KINDS);
    const unknown = [...new Set(map.objects.filter((o) => o.model && !kits.has(o.model)).map((o) => o.model))];
    expect(unknown).toEqual([]);
  });

  it('gives every zone cover: buildings or solid objects inside it', () => {
    for (const z of map.zones!) {
      const near = (x: number, zz: number) => Math.hypot(x - z.pos[0], zz - z.pos[2]) < z.radius;
      const solid = map.objects.filter((o) => o.type !== 'floor' && near(o.pos[0], o.pos[2])).length;
      const blds = map.buildings!.filter((b) => near(b.pos[0], b.pos[1])).length;
      expect(solid + blds * 4, z.id).toBeGreaterThanOrEqual(25);
    }
  });

  it('keeps trees inside the outline and out of the zones', () => {
    const outline = new Boundary(map.world.boundary!);
    expect(map.trees!.length).toBeGreaterThan(100);
    for (const [x, z] of map.trees!) {
      expect(outline.contains(x, z)).toBe(true);
      for (const zone of map.zones!) expect(Math.hypot(x - zone.pos[0], z - zone.pos[2])).toBeGreaterThan(zone.radius);
    }
  });
});
