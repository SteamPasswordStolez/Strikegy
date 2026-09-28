import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Boundary, Terrain, buildBoundaryWalls, buildTerrain, terrainTriangles } from '@/world/terrain';
import { Layer, PhysicsWorld } from '@/physics/PhysicsWorld';
import { NavWorld } from '@/ai/NavWorld';

const square = new Boundary([
  [-40, -30],
  [40, -30],
  [40, 30],
  [-40, 30],
]);

describe('Boundary', () => {
  it('tests containment and distance for an irregular outline', () => {
    const b = new Boundary([
      [0, 0],
      [10, 0],
      [10, 10],
      [5, 4],
      [0, 10],
    ]);
    expect(b.contains(2, 2)).toBe(true);
    expect(b.contains(5, 8)).toBe(false); // in the notch
    expect(b.outside(15, 5)).toBeCloseTo(5);
    expect(b.outside(2, 2)).toBe(0);
  });
});

describe('Terrain', () => {
  it('builds hills, flattens pads and rises outside the boundary', () => {
    const t = new Terrain({ hills: [{ pos: [10, 0], radius: 20, height: 6 }], flats: [{ pos: [10, 0], radius: 3, height: 2 }] }, square, [100, 80]);
    expect(t.heightAt(10, 0)).toBeCloseTo(2);
    expect(t.heightAt(22, 0)).toBeGreaterThan(0.5);
    expect(t.heightAt(-35, 0)).toBe(0);
    expect(t.surfaceAt(-75, 0)).toBeGreaterThan(2);
  });

  it('collider matches the height function (grid orientation)', async () => {
    const physics = await PhysicsWorld.create();
    // Asymmetric bumps so a transposed grid would miss.
    const t = new Terrain({ hills: [{ pos: [20, -10], radius: 12, height: 5 }, { pos: [-25, 15], radius: 10, height: -3 }], cell: 1 }, square, [80, 60]);
    buildTerrain(t, new THREE.MeshBasicMaterial(), physics);
    physics.step();
    for (const [x, z] of [[20, -10], [-25, 15], [10, -5], [-5, 20], [0, 0], [-30, -20], [12.3, 7.7]] as const) {
      const hit = physics.raycast({ x, y: 50, z }, { x: 0, y: -1, z: 0 }, 100, Layer.WORLD);
      expect(hit).not.toBeNull();
      expect(hit!.point.y).toBeCloseTo(t.surfaceAt(x, z), 0);
    }
    physics.dispose();
  });

  it('sight tests see the ground through its height grid', async () => {
    const physics = await PhysicsWorld.create();
    const t = new Terrain({ hills: [{ pos: [0, 0], radius: 12, height: 5 }], cell: 2 }, square, [80, 60]);
    buildTerrain(t, new THREE.MeshBasicMaterial(), physics);
    physics.step();
    // Over the hill top vs through it, both ways; and across the flat side.
    expect(physics.blocked({ x: -20, y: 1.6, z: 0 }, { x: 20, y: 1.6, z: 0 }, Layer.WORLD)).toBe(true);
    expect(physics.blocked({ x: 20, y: 1.6, z: 0 }, { x: -20, y: 1.6, z: 0 }, Layer.WORLD)).toBe(true);
    expect(physics.blocked({ x: -20, y: 7, z: 0 }, { x: 20, y: 7, z: 0 }, Layer.WORLD)).toBe(false);
    expect(physics.blocked({ x: -30, y: 1.6, z: 20 }, { x: 30, y: 1.6, z: 20 }, Layer.WORLD)).toBe(false);
    // Agrees with a full ray against the collider.
    for (const [ax, az, bx, bz, y] of [[-20, -5, 20, 5, 3], [-15, 10, 15, -10, 4.5], [0, -25, 3, 25, 2]] as const) {
      const from = { x: ax, y, z: az };
      const d = new THREE.Vector3(bx - ax, 0, bz - az);
      const len = d.length();
      const ray = physics.raycast(from, d.normalize(), len - 0.05, Layer.WORLD);
      expect(physics.blocked(from, { x: bx, y, z: bz }, Layer.WORLD)).toBe(ray !== null);
    }
    physics.dispose();
  });

  it('feeds the navmesh and keeps bots inside boundary walls', async () => {
    const physics = await PhysicsWorld.create();
    const t = new Terrain({ hills: [{ pos: [0, 0], radius: 15, height: 3 }] }, square, [100, 80]);
    const { grid } = buildTerrain(t, new THREE.MeshBasicMaterial(), physics);
    buildBoundaryWalls(square, t, physics);
    physics.step();
    const nav = await NavWorld.build(physics, terrainTriangles(t, grid));
    expect(nav).not.toBeNull();
    const top = nav!.closest({ x: 0, y: 4, z: 0 })!;
    expect(top.y).toBeCloseTo(3, 0);
    // Nothing walkable beyond the walls is reachable from inside.
    const path: THREE.Vector3[] = [];
    nav!.path({ x: 30, y: 0, z: 0 }, { x: 47, y: 0, z: 0 }, path);
    expect(path.every((p) => p.x < 40)).toBe(true);
    nav!.dispose();
    physics.dispose();
  });
});

describe('river distance grid', () => {
  it('gives finite heights everywhere around a river, also on grid lines at the edge of its reach', () => {
    const b = new Boundary([
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ]);
    const t = new Terrain({ rivers: [{ pts: [[0, -150], [3, 0], [0, 150]], width: 10, depth: 2, bank: 5 }] }, b, [260, 260]);
    for (let x = -80; x <= 80; x += 0.5) {
      for (const z of [-50, 0, 37.5]) {
        expect(Number.isFinite(t.heightAt(x, z))).toBe(true);
        expect(Number.isFinite(t.surfaceAt(x * 1.6, z))).toBe(true);
      }
    }
    expect(t.heightAt(3, 0)).toBeCloseTo(-2, 1);
  });
});
