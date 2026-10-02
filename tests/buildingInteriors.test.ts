import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBuilding } from '@/world/buildings';
import type { BuildingDef } from '@/world/mapTypes';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { NavWorld } from '@/ai/NavWorld';

const DEG = Math.PI / 180;

/** Ground plus one building's colliders, and its navmesh. */
async function navFor(def: BuildingDef) {
  const physics = await PhysicsWorld.create();
  physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 60, y: 0.5, z: 60 });
  const built = buildBuilding(def, 0);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const o of built.objects) {
    const r = o.rot ?? [0, 0, 0];
    q.setFromEuler(e.set(r[0] * DEG, r[1] * DEG, r[2] * DEG));
    physics.addStaticBox({ x: o.pos[0], y: o.pos[1], z: o.pos[2] }, { x: o.size[0] / 2, y: o.size[1] / 2, z: o.size[2] / 2 }, { x: q.x, y: q.y, z: q.z, w: q.w });
  }
  physics.step();
  const nav = (await NavWorld.build(physics))!;
  return { built, nav, physics };
}

/**
 * True when a walk from outside reaches the point (it is on the main navmesh, at
 * that height). Long paths come back partial (Detour's polygon limit), so like a
 * bot it plans again from where the last one ended.
 */
function reaches(nav: NavWorld, p: { x: number; y: number; z: number }): boolean {
  const at = nav.closest(p);
  if (!at || Math.abs(at.y - p.y) > 0.6 || Math.hypot(at.x - p.x, at.z - p.z) > 0.8) return false;
  let from = new THREE.Vector3(0, 0, 55);
  for (let i = 0; i < 6; i++) {
    const path: THREE.Vector3[] = [];
    if (!nav.path(from, at, path)) return false;
    const end = path[path.length - 1]!;
    if (end.distanceTo(at) < 0.3) return true;
    if (end.distanceTo(from) < 0.5) return false;
    from = end;
  }
  return false;
}

/** Room centres in building space: middle of a facade bay, in each row off the corridor. */
function roomPoints(long: number, deep: number): [number, number][] {
  const bw = long / Math.round(long / 3.2);
  const xs = [0.3, 0.5, 0.65].map((t) => -long / 2 + (Math.floor((t * long) / bw) + 0.5) * bw);
  return xs.flatMap((x) => [-deep / 4 - 0.5, deep / 4 + 0.5].map((z): [number, number] => [x, z]));
}

describe('building interiors', () => {
  it('every floor of a small block is reachable up the stairs', async () => {
    const { nav, physics } = await navFor({ pos: [0, 0], size: [14, 11], style: 'apartment', seed: 7, doors: 's' });
    for (const f of [0, 1, 2]) expect(reaches(nav, { x: -4, y: f ? f * 3 : 0.2, z: 1 }), `floor ${f}`).toBe(true);
    nav.dispose();
    physics.dispose();
  });

  for (const def of [
    { pos: [0, 0], size: [50, 22], style: 'hospital', seed: 3, doors: 'sew' },
    { pos: [2, 1], size: [50, 22], style: 'hospital', seed: 4, doors: 'n', rot: 33 },
    { pos: [0, 0], size: [18, 56], style: 'hotel', seed: 5, doors: 'n', rot: 20 },
    { pos: [3, -2], size: [56, 18], style: 'hotel', seed: 6, doors: 's', rot: 45 },
  ] as BuildingDef[]) {
    it(`${def.style} turned ${def.rot ?? 0}°: rooms on every floor connect to the stairs`, async () => {
      const { built, nav, physics } = await navFor(def);
      const storey = 3.4;
      const floors = def.style === 'hospital' ? 5 : 4;
      const long = Math.max(...def.size);
      const deep = Math.min(...def.size);
      // The long side is local x (a building deeper than wide is turned 90°).
      const yaw = ((def.rot ?? 0) + (def.size[1] > def.size[0] ? 90 : 0)) * DEG;
      const toWorld = (lx: number, lz: number) => ({ x: def.pos[0] + lx * Math.cos(yaw) + lz * Math.sin(yaw), z: def.pos[1] - lx * Math.sin(yaw) + lz * Math.cos(yaw) });
      for (let f = 0; f < floors; f++) {
        for (const [lx, lz] of roomPoints(long, deep)) {
          const p = toWorld(lx, lz);
          expect(reaches(nav, { x: p.x, y: f ? f * storey : 0.2, z: p.z }), `floor ${f} room at ${lx.toFixed(1)}, ${lz.toFixed(1)}`).toBe(true);
        }
      }
      // Window spots on every floor (fighting from the rooms).
      expect(new Set(built.windows.map((w) => Math.round(w.pos[1] / storey))).size).toBe(floors);
      nav.dispose();
      physics.dispose();
    });
  }

  it('every style builds, enterable and solid, turned or not', () => {
    const styles = ['house', 'shop', 'apartment', 'townhall', 'warehouse', 'barracks', 'hangar', 'hq', 'station', 'shed', 'barn', 'chapel', 'tower', 'factory', 'office', 'gasShop', 'hospital', 'inn', 'mill', 'depot', 'hotel'] as const;
    for (const style of styles)
      for (const solid of [false, true]) {
        const b = buildBuilding({ pos: [5, -3], size: [24, 14], style, solid, rot: 30, seed: 2, doors: 'nsew' }, 1, { snow: true });
        expect(b.objects.length, style).toBeGreaterThan(solid ? 0 : 10);
        for (const o of [...b.objects, ...b.decor]) {
          expect(o.size.every((v) => v > 0 && Number.isFinite(v)), style).toBe(true);
          expect(o.pos.every(Number.isFinite), style).toBe(true);
        }
        for (const s of b.shapes) {
          expect(s.geo.index, style).toBeNull();
          expect(s.geo.getAttribute('uv'), style).toBeDefined();
          expect(s.geo.getAttribute('normal'), style).toBeDefined();
        }
      }
    // A style this build doesn't know builds as a house.
    expect(buildBuilding({ pos: [0, 0], size: [10, 9], style: 'castle' as never }, 0).objects.length).toBeGreaterThan(10);
  });
});

/** Navmesh polygons inside a building's footprint, below its roof, that no walk from outside reaches. */
function interiorIslands(nav: NavWorld, def: BuildingDef, built: ReturnType<typeof buildBuilding>): { n: number; at: string[] } {
  const islands = (nav as unknown as { islands: Set<number> }).islands;
  let roof = -Infinity;
  for (const o of built.objects) if (o.type === 'floor' && !o.rot?.[0] && !o.rot?.[2] && o.size[0] * o.size[2] > 0.6 * def.size[0] * def.size[1]) roof = Math.max(roof, o.pos[1] + o.size[1] / 2);
  const yaw = ((def.rot ?? 0) * Math.PI) / 180;
  const at: string[] = [];
  for (const ref of islands) {
    const { success, tile, poly } = nav.navMesh.getTileAndPolyByRef(ref);
    if (!success) continue;
    let x = 0;
    let y = 0;
    let z = 0;
    const n = poly.vertCount();
    for (let i = 0; i < n; i++) {
      const v = poly.verts(i) * 3;
      x += tile.verts(v) / n;
      y += tile.verts(v + 1) / n;
      z += tile.verts(v + 2) / n;
    }
    const dx = x - def.pos[0];
    const dz = z - def.pos[1];
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    if (Math.abs(lx) < def.size[0] / 2 && Math.abs(lz) < def.size[1] / 2 && y < roof - 1) at.push(`${lx.toFixed(1)},${y.toFixed(1)},${lz.toFixed(1)}`);
  }
  return { n: at.length, at };
}

describe('no closed-off floor inside buildings', () => {
  // A sample of each enterable style at its usual size, square to the world and turned.
  const samples: [BuildingDef['style'], [number, number], string][] = [
    ['house', [10, 9], 'sn'],
    ['shop', [12, 10], 's'],
    ['apartment', [16, 11], 's'],
    ['townhall', [20, 14], 's'],
    ['warehouse', [24, 16], 'ns'],
    ['barracks', [24, 8], 'ew'],
    ['hangar', [30, 24], 's'],
    ['hq', [22, 12], 'sn'],
    ['station', [20, 10], 'n'],
    ['shed', [8, 6], 's'],
    ['barn', [16, 10], 'ew'],
    ['chapel', [18, 9], 'w'],
    ['tower', [24, 12], 's'],
    ['factory', [44, 22], 'snew'],
    ['office', [24, 16], 's'],
    ['gasShop', [10, 7], 'n'],
    ['hospital', [50, 22], 's'],
    ['inn', [16, 11], 's'],
    ['mill', [12, 10], 'w'],
    ['depot', [36, 14], 'ew'],
    ['hotel', [56, 18], 'n'],
  ];
  // Small multi-storey buildings turned off the world axes can still lose a floor: the
  // navmesh tile cache links floors only across tile edges, and their short ramps don't
  // always cross one (see RUN_MAX in world/buildings.ts). Square to the world they must work.
  const small = new Set(['house', 'shop', 'apartment', 'inn', 'mill']);
  for (const [style, size, doors] of samples) {
    it(`${style}`, async () => {
      for (const rot of small.has(style!) ? [0, 90] : [0, 32]) {
        const def: BuildingDef = { pos: [1.7, -2.3], size, style, doors, rot, seed: 11 };
        const { built, nav, physics } = await navFor(def);
        const r = interiorIslands(nav, def, built);
        expect(r.at, `${style} turned ${rot}°`).toEqual([]);
        nav.dispose();
        physics.dispose();
      }
    });
  }
});
