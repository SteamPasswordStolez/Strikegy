import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NavWorld } from '@/ai/NavWorld';
import { navFineMask, patchAt } from '@/ai/navRegions';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { SurfaceRegistry } from '@/physics/surfaces';
import { buildWorld } from '@/sim/world';
import type { MapDef } from '@/world/mapTypes';

/** A map past the fine-only size: two hamlets 500 m apart on open, rolling ground. */
function bigMap(): MapDef {
  const town = (cx: number) =>
    [-14, 14].flatMap((dx) => [-14, 14].map((dz) => ({ pos: [cx + dx, dz] as [number, number], size: [9, 9] as [number, number], style: 'house' as const, floors: 1, doors: 'nsew' })));
  return {
    meta: { id: 'big_nav_test', name: 'big nav test', version: 2 },
    world: {
      size: [900, 800],
      boundary: [
        [-400, -350],
        [400, -350],
        [400, 350],
        [-400, 350],
      ],
      terrain: { cell: 4, hills: [{ pos: [0, 120], radius: 160, height: 9 }] },
      visualProfile: 'outdoor_day',
    },
    spawns: [
      { team: 'blue', pos: [-330, 0.1, 0], yaw: 0 },
      { team: 'red', pos: [330, 0.1, 0], yaw: 0 },
    ],
    zones: [
      { id: 'A', pos: [-250, 0, 0], radius: 20 },
      { id: 'B', pos: [250, 0, 0], radius: 20 },
    ],
    objects: [],
    buildings: [...town(-250), ...town(250)],
  };
}

describe('big-map navmesh (fine patches + coarse ground)', () => {
  it('routes between towns across the coarse ground and walks it', async () => {
    const map = bigMap();
    const physics = await PhysicsWorld.create();
    const world = buildWorld(map, physics, new SurfaceRegistry());
    physics.step();
    const big = world.built.navBig;
    expect(big).not.toBeNull();
    const mask = navFineMask(map)!;
    // The towns are fine, the middle of the field is not.
    expect(patchAt(mask, -250, 0)).toBeGreaterThan(0);
    expect(patchAt(mask, 250, 0)).toBeGreaterThan(0);
    expect(patchAt(mask, -250, 0)).not.toBe(patchAt(mask, 250, 0));
    expect(patchAt(mask, 0, 0)).toBe(0);
    const nav = (await NavWorld.build(physics, world.built.navExtra ?? undefined, big))!;
    expect(nav).not.toBeNull();
    expect(nav.parts().length).toBe(2);
    // Neither town is cut off as an island: both answer on the fine mesh.
    for (const x of [-250, 250]) {
      expect(nav.closest({ x, y: 0, z: 0 })).not.toBeNull();
      expect(nav.randomAround({ x, y: 0, z: 0 }, 12)).not.toBeNull();
    }

    const from = new THREE.Vector3(-250, 0, 0);
    const to = new THREE.Vector3(250, 0, 0);
    const path: THREE.Vector3[] = [];
    expect(nav.path(from, to, path)).toBe(true);
    expect(path[0]!.distanceTo(from)).toBeLessThan(3);
    expect(path[path.length - 1]!.distanceTo(new THREE.Vector3(250, path[path.length - 1]!.y, 0))).toBeLessThan(3);
    // No jumps: corners are joined by walkable stretches, never a leap across the field.
    let length = 0;
    for (let i = 1; i < path.length; i++) length += path[i]!.distanceTo(path[i - 1]!);
    expect(length).toBeLessThan(560);

    // Walk it like a bot: step along the corners with `move`, switching meshes on the way.
    // (Off round numbers: a step landing exactly on a tile border stalls Detour's walk.)
    const feet = from.clone().add(new THREE.Vector3(0.013, 0, 0.37));
    const out = new THREE.Vector3();
    let ref = 0;
    let coarseSteps = 0;
    let corner = 1;
    for (let i = 0; i < 4000 && corner < path.length; i++) {
      const goal = path[corner]!;
      const d = Math.hypot(goal.x - feet.x, goal.z - feet.z);
      if (d < 0.6) {
        corner++;
        continue;
      }
      const s = Math.min(0.5, d) / d;
      const next = new THREE.Vector3(feet.x + (goal.x - feet.x) * s, feet.y, feet.z + (goal.z - feet.z) * s);
      ref = nav.move(ref, feet, next, out);
      expect(ref).not.toBe(0);
      if (ref >= 2 ** 32) coarseSteps++;
      feet.copy(out);
    }
    expect(corner).toBe(path.length);
    expect(Math.hypot(feet.x - 250, feet.z)).toBeLessThan(3);
    expect(coarseSteps).toBeGreaterThan(500);
    nav.dispose();
    physics.dispose();
  }, 120_000);

  it('leaves maps up to Ardennes size on one fine mesh', () => {
    const map = bigMap();
    map.world.boundary = [
      [-300, -200],
      [300, -200],
      [300, 200],
      [-300, 200],
    ];
    expect(navFineMask(map)).toBeNull();
  });
});
