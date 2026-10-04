import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Layer, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SurfaceRegistry } from '@/physics/surfaces';
import { SurfaceLibrary } from '@/render/textures';
import { buildWorld } from '@/sim/world';
import { parseMap } from '@/world/validateMap';
import { MAPS } from '@/data/maps';

const loadMap = (id: string) => parseMap(JSON.parse(readFileSync(`public/maps/${id}.json`, 'utf8')));

/** Rays down on a grid over the map and across it at chest height: distance and surface of each hit. */
function probe(physics: PhysicsWorld, impacts: SurfaceRegistry, size: readonly [number, number]): string[] {
  const out: string[] = [];
  const [sx, sz] = size;
  const n = 24;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = ((i + 0.5) / n - 0.5) * sx;
      const z = ((j + 0.5) / n - 0.5) * sz;
      const down = physics.raycast({ x, y: 300, z }, { x: 0, y: -1, z: 0 }, 600, Layer.WORLD);
      out.push(down ? `${down.distance.toFixed(3)}:${impacts.get(down.collider.handle, down.point)}` : '-');
      if (!down) continue;
      const across = physics.raycast({ x, y: down.point.y + 1.3, z }, { x: 0.6, y: 0, z: 0.8 }, 60, Layer.WORLD);
      out.push(across ? `${across.distance.toFixed(3)}` : '-');
    }
  }
  return out;
}

describe('map world on the game server', () => {
  for (const id of [...MAPS.map((m) => m.id), 'sandbox']) {
    it(`${id}: built without a view, it has the same colliders as in the browser`, async () => {
      const server = await PhysicsWorld.create();
      const serverImpacts = new SurfaceRegistry();
      const t0 = performance.now();
      const sw = buildWorld(loadMap(id), server, serverImpacts);
      const ms = performance.now() - t0;
      expect(sw.built.root.children).toHaveLength(0);

      const browser = await PhysicsWorld.create();
      const browserImpacts = new SurfaceRegistry();
      const scene = new THREE.Scene();
      const bw = buildWorld(loadMap(id), browser, browserImpacts, { scene, surfaces: new SurfaceLibrary(4, 1), terrainStep: 2 });
      expect(bw.built.root.children.length).toBeGreaterThan(0);

      expect(server.world.colliders.len()).toBe(browser.world.colliders.len());
      expect(server.world.colliders.len()).toBeGreaterThan(50);
      expect(sw.built.windows.length).toBe(bw.built.windows.length);
      expect(sw.built.footprints).toEqual(bw.built.footprints);
      expect(!!sw.water).toBe(!!bw.water);
      expect(sw.map.spawns).toEqual(bw.map.spawns);
      server.step();
      browser.step();
      expect(probe(server, serverImpacts, sw.map.world.size)).toEqual(probe(browser, browserImpacts, bw.map.world.size));
      console.info(`[sim world] ${id}: ${server.world.colliders.len()} colliders, built in ${Math.round(ms)} ms without a view`);
      server.dispose();
      browser.dispose();
      // Two whole map builds: the big maps take over 30 s when the suite runs in parallel.
    }, 120_000);
  }
});
