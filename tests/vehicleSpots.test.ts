import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { SurfaceRegistry } from '@/physics/surfaces';
import { buildWorld } from '@/sim/world';
import { parseMap } from '@/world/validateMap';
import { MAPS } from '@/data/maps';
import { callInSpot, planVehicleSpots } from '@/vehicles/VehicleWorld';

const DEG = Math.PI / 180;

describe('vehicle spots stay in play', () => {
  // Bilbao's tank spots (deploying in a tank) were up to 9 m outside the outline (2026-10-12).
  for (const { id } of MAPS) {
    it(`${id}: pads, tank spots, motorbikes and call-ins are inside the playable outline`, async () => {
      const map = parseMap(JSON.parse(readFileSync(`public/maps/${id}.json`, 'utf8')));
      const physics = await PhysicsWorld.create();
      const w = buildWorld(map, physics, new SurfaceRegistry());
      physics.step();
      const boundary = w.terrain.boundary;
      const bases: { team: 'blue' | 'red'; pos: THREE.Vector3; facing: number }[] = [];
      for (const team of ['blue', 'red'] as const) {
        const sp = map.spawns.filter((s) => s.team === team || (team === 'blue' && s.team === 'player'));
        const pos = sp.reduce((a, s) => a.add(new THREE.Vector3(...s.pos)), new THREE.Vector3()).divideScalar(sp.length);
        bases.push({ team, pos, facing: sp[0]!.yaw * DEG });
      }
      const zones = (map.zones ?? []).map((z) => ({ id: z.id, pos: new THREE.Vector3(...z.pos), radius: z.radius }));
      const plan = planVehicleSpots(physics, bases, zones, boundary);
      const inside = (p: THREE.Vector3, margin: number) => boundary.contains(p.x, p.z) && boundary.edgeDistance(p.x, p.z) >= margin;
      for (const p of plan.pads) expect(inside(p.pos, 3), `${p.team} ${p.kind} pad`).toBe(true);
      for (const p of plan.tankSpots) expect(inside(p.pos, 5), `${p.team} tank spot`).toBe(true);
      for (const b of plan.bikes) for (const s of b.spots) expect(inside(s.pos, 2), `bike at ${b.zone}`).toBe(true);
      // Every side still has its base vehicles.
      for (const team of ['blue', 'red'] as const) {
        expect(plan.pads.filter((p) => p.team === team).length).toBe(2);
        if (map.world.vehicles !== 'light') expect(plan.tankSpots.filter((p) => p.team === team).length).toBeGreaterThanOrEqual(2);
      }
      let found = 0;
      for (const z of zones) {
        const spot = callInSpot(physics, boundary, zones, z.pos, [], 1.9, 4.2);
        if (!spot) continue;
        found++;
        expect(inside(spot.pos, 6), `call-in near ${z.id}`).toBe(true);
      }
      expect(found).toBeGreaterThan(0);
    }, 60000);
  }
});
