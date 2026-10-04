import type { SurfaceRegistry } from '@/physics/surfaces';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { buildBlockout, hasTerrain, snapToTerrain, type BuiltMap } from '@/world/buildBlockout';
import { buildingPadRadius } from '@/world/buildings';
import { treeColliders } from '@/world/forest';
import type { MapDef } from '@/world/mapTypes';
import { propColliders } from '@/world/placeProps';
import { Boundary, Terrain } from '@/world/terrain';
import { WaterMap } from '@/world/water';
import type { SurfaceLibrary } from '@/render/textures';
import { planFortifications, worldProbe, type FortPlan } from '@/modes/fortify';
import type * as THREE from 'three';

/**
 * What a match needs from its map, built the same way in the browser and on
 * the game server: the ground, every static collider (map boxes, kits,
 * buildings, props, tree trunks, the boundary) with its impact surface, the
 * water, and the building data bots and fortifications use. The browser adds
 * the looks on top (`view`); the server builds no meshes at all.
 */
export interface SimWorld {
  /** The map, with spawns / zones / snapped objects moved onto the terrain. */
  map: MapDef;
  terrain: Terrain;
  /** The map shapes its ground (terrain / irregular boundary) rather than a flat box. */
  shaped: boolean;
  water: WaterMap | null;
  built: BuiltMap;
}

export interface WorldView {
  scene: THREE.Scene;
  surfaces: SurfaceLibrary;
  /** Terrain render mesh detail: 1 = every grid line, 2 = every other (weak devices). */
  terrainStep: number;
}

export function buildWorld(map: MapDef, physics: PhysicsWorld, impacts: SurfaceRegistry, view: WorldView | null = null): SimWorld {
  // Buildings get a level pad so they sit flat on sloped ground.
  const pads = (map.buildings ?? []).map((b) => ({ pos: b.pos, radius: buildingPadRadius(b) - 1, blend: 5 }));
  const terrainDef = { ...map.world.terrain, flats: [...(map.world.terrain?.flats ?? []), ...pads] };
  const terrain = new Terrain(terrainDef, Boundary.fromMap(map), map.world.size);
  const shaped = hasTerrain(map);
  if (shaped) snapToTerrain(map, terrain);
  const built = buildBlockout(map, view?.scene ?? null, physics, view?.surfaces ?? null, impacts, shaped ? terrain : null, view?.terrainStep ?? 1);
  propColliders(map, physics, impacts);
  if (map.trees?.length) treeColliders(map.trees, terrain, physics, impacts);
  const water = terrain.rivers.length ? new WaterMap(terrain) : null;
  return { map, terrain, shaped, water, built };
}

/**
 * Where a zone match's supply stations and build spots go: worked out from
 * the map and its colliders the same way on the game server and in the
 * browser (the same plan, the same ids). Run before anything moves in.
 */
export function fortPlanFor(sw: SimWorld, physics: PhysicsWorld): FortPlan {
  const { map, terrain, water, built } = sw;
  physics.step();
  const probe = worldProbe(
    physics,
    (x, z) => terrain.heightAt(x, z),
    (x, z) => terrain.boundary.contains(x, z) && terrain.boundary.edgeDistance(x, z) > 3,
    (x, y, z) => !!water && water.depthAt(x, y, z) > 0.05,
  );
  const bases = (['blue', 'red'] as const).map((team) => {
    const own = map.spawns.filter((s) => s.team === team || (team === 'blue' && s.team === 'player'));
    let x = 0;
    let z = 0;
    for (const s of own) {
      x += s.pos[0];
      z += s.pos[2];
    }
    const n = Math.max(1, own.length);
    return [x / n, z / n] as const;
  });
  return planFortifications(map.zones ?? [], built.windows, built.footprints, probe, { rivers: map.world.terrain?.rivers ?? [], bases });
}
