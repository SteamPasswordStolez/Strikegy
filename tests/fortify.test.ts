import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { SurfaceRegistry } from '@/physics/surfaces';
import { NavWorld } from '@/ai/NavWorld';
import { FORT, Fortifications, STATION, buildSpeed, canRefill, planFortifications, worldProbe, type PlanProbe } from '@/modes/fortify';
import { FortModels } from '@/world/fortModels';
import type { WindowSpot } from '@/world/buildings';
import { ScoreTracker } from '@/modes/scoreTracker';

/** Flat open ground everywhere except inside `blocked` (x, z, r) circles. */
function flatProbe(blocked: [number, number, number][] = []): PlanProbe {
  const free = (x: number, z: number, r: number) => blocked.every(([bx, bz, br]) => Math.hypot(x - bx, z - bz) > br + r);
  return {
    ground: (x, z) => (Math.abs(x) < 200 && Math.abs(z) < 200 ? { y: 0, level: true } : null),
    clear: (x, _y, z, size) => free(x, z, Math.hypot(size[0], size[2]) / 2),
  };
}

const zones = [
  { id: 'A', pos: [0, 0, 0] as [number, number, number], radius: 16 },
  { id: 'B', pos: [80, 0, 0] as [number, number, number], radius: 18 },
];

describe('fortification planning', () => {
  it('gives every zone both stations and build spots, the same on every run', () => {
    const plan = planFortifications(zones, [], [], flatProbe());
    for (const z of ['A', 'B']) {
      expect(plan.stations.filter((s) => s.zone === z).map((s) => s.kind).sort()).toEqual(['ammo', 'medical']);
      expect(plan.slots.filter((s) => s.zone === z && s.kind === 'sandbag')).toHaveLength(3);
      expect(plan.slots.filter((s) => s.zone === z && s.kind === 'hedgehog')).toHaveLength(2);
    }
    // Stations sit inside the zone, a few metres apart.
    const a = plan.stations.filter((s) => s.zone === 'A');
    for (const s of a) expect(Math.hypot(s.pos[0], s.pos[2])).toBeLessThan(16);
    const gap = Math.hypot(a[0]!.pos[0] - a[1]!.pos[0], a[0]!.pos[2] - a[1]!.pos[2]);
    expect(gap).toBeGreaterThanOrEqual(4);
    expect(gap).toBeLessThanOrEqual(11);
    // Build spots don't crowd each other.
    const bags = plan.slots.filter((s) => s.zone === 'A');
    for (let i = 0; i < bags.length; i++) for (let j = i + 1; j < bags.length; j++) expect(Math.hypot(bags[i]!.pos[0] - bags[j]!.pos[0], bags[i]!.pos[2] - bags[j]!.pos[2])).toBeGreaterThan(4);
    expect(planFortifications(zones, [], [], flatProbe())).toEqual(plan);
  });

  it('keeps clear of obstacles and building doors, and boards up nearby windows', () => {
    const blocked: [number, number, number][] = [];
    for (let a = 0; a < 16; a++) if (a % 4) blocked.push([Math.cos((a / 16) * Math.PI * 2) * 7, Math.sin((a / 16) * Math.PI * 2) * 7, 2.5]);
    const probe = flatProbe(blocked);
    const house = { x: 0, z: 12, yaw: 0, hw: 4, hd: 3 };
    const windows: WindowSpot[] = [
      { pos: [0, 0.2, 8.6], facing: [0, -1], opening: { center: [0, 1.8, 9.15], width: 1.1, height: 1.2 } },
      // Sill too high to shoot out of: skipped.
      { pos: [2, 0.2, 8.6], facing: [0, -1], opening: { center: [2, 3.5, 9.15], width: 1.1, height: 1 } },
    ];
    const plan = planFortifications([zones[0]!], windows, [house], probe);
    for (const s of [...plan.stations, ...plan.slots.filter((x) => x.kind !== 'barricade')]) {
      expect(probe.clear(s.pos[0], 0, s.pos[2], [0.5, 1, 0.5], 0)).toBe(true);
      // Not right against the house (doors).
      expect(Math.abs(s.pos[0]) < 6 && Math.abs(s.pos[2] - 12) < 5).toBe(false);
    }
    const boards = plan.slots.filter((s) => s.kind === 'barricade');
    expect(boards).toHaveLength(1);
    // Slit at standing eye height: 1.52 above the floor (0.2), sill at 1.2.
    expect(boards[0]!.size![2]).toBeCloseTo(0.2 + 1.52 - 1.2, 5);
  });
});

describe('fortifications at runtime', () => {
  async function world() {
    const physics = await PhysicsWorld.create();
    physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 30, y: 0.5, z: 30 });
    physics.step();
    const nav = await NavWorld.build(physics);
    const probe = worldProbe(physics, () => 0, (x, z) => Math.abs(x) < 28 && Math.abs(z) < 28, () => false);
    const plan = planFortifications([{ id: 'A', pos: [0, 0, 0], radius: 14 }], [], [], probe);
    const fort = new Fortifications(plan, new FortModels(null), physics, new SurfaceRegistry(), nav);
    nav!.update(4096);
    physics.step();
    return { physics, nav: nav!, fort };
  }

  it('builds at the support pace, blocks the navmesh and bullets, and blows apart', async () => {
    const { physics, nav, fort } = await world();
    const bag = fort.slots.find((s) => s.kind === 'sandbag')!;
    const out = new THREE.Vector3(-Math.sin(bag.yaw), 0, -Math.cos(bag.yaw));
    const a = bag.pos.clone().addScaledVector(out, 3);
    const b = bag.pos.clone().addScaledVector(out, -3);
    expect(nav.walkable(a, b)).toBe(true);
    // Support: half the time, five times the points per second.
    let points = 0;
    let done = false;
    for (let t = 0; t < FORT.sandbag.build / buildSpeed('support') + 0.1 && !done; t += 0.1) {
      const r = fort.work(bag, 0.1, 'support', () => false);
      points += r.points;
      done = r.done;
    }
    expect(done).toBe(true);
    expect(points).toBeCloseTo(150, 0);
    nav.update();
    physics.step();
    expect(nav.walkable(a, b)).toBe(false);
    const eye = a.clone().setY(0.6);
    expect(physics.blocked(eye, b.clone().setY(0.6), 1)).toBe(true);
    // Two close frags knock it down; the spot opens up again.
    fort.blast(bag.pos.clone().addScaledVector(out, 1), 7, () => 130);
    expect(bag.built).toBe(true);
    fort.blast(bag.pos.clone().addScaledVector(out, 1), 7, () => 130);
    expect(bag.built).toBe(false);
    nav.update();
    physics.step();
    expect(nav.walkable(a, b)).toBe(true);
    expect(physics.blocked(eye, b.clone().setY(0.6), 1)).toBe(false);
    nav.dispose();
    physics.dispose();
  });

  it("waits while someone stands where it goes", async () => {
    const { physics, nav, fort } = await world();
    const bag = fort.slots.find((s) => s.kind === 'sandbag')!;
    const r = fort.work(bag, 99, 'assault', () => true);
    expect(r.done).toBe(false);
    expect(bag.built).toBe(false);
    expect(fort.work(bag, 0.1, 'assault', () => false).done).toBe(true);
    expect(fort.occupies(bag, bag.pos)).toBe(true);
    expect(fort.occupies(bag, bag.stand)).toBe(false);
    nav.dispose();
    physics.dispose();
  });

  it('stations run out and are restocked by the right class', async () => {
    const { physics, nav, fort } = await world();
    const ammo = fort.stations.find((s) => s.kind === 'ammo')!;
    for (let i = 0; i < STATION.uses; i++) expect(fort.use(ammo)).toBe(true);
    expect(fort.use(ammo)).toBe(false);
    expect(canRefill('ammo', 'support')).toBe(true);
    expect(canRefill('ammo', 'medic')).toBe(false);
    expect(canRefill('medical', 'medic')).toBe(true);
    let back = 0;
    for (let t = 0; t < STATION.refillSec * 2 + 0.05; t += 0.05) if (fort.refill(ammo, 0.05)) back++;
    expect(back).toBe(2);
    expect(ammo.uses).toBe(2);
    // Stations stand in the way of bots too.
    expect(nav.closest(ammo.pos.clone().setY(0.3))!.distanceTo(ammo.pos.clone().setY(0))).toBeGreaterThan(0.5);
    nav.dispose();
    physics.dispose();
  });

  it('scores fractions of points without losing them', () => {
    const s = new ScoreTracker();
    s.add(1, 'A', 'blue');
    for (let i = 0; i < 60; i++) s.award(1, 10 / 60);
    expect(s.get(1)!.score).toBe(10);
  });
});
