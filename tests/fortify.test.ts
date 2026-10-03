import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { SurfaceRegistry } from '@/physics/surfaces';
import { NavWorld } from '@/ai/NavWorld';
import { FORT, FORT_WEIGHT, Fortifications, STATION, buildSpeed, canRefill, planFortifications, worldProbe, zoneWeight, type PlanProbe } from '@/modes/fortify';
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
      const count = (k: string) => plan.slots.filter((s) => s.zone === z && s.kind === k).length;
      expect([count('nest'), count('sandbagCorner'), count('sandbag'), count('timber'), count('sandbagLow'), count('wire'), count('hedgehog')]).toEqual([1, 3, 5, 3, 4, 3, 3]);
    }
    // Stations sit inside the zone, a few metres apart.
    const a = plan.stations.filter((s) => s.zone === 'A');
    for (const s of a) expect(Math.hypot(s.pos[0], s.pos[2])).toBeLessThan(16);
    const gap = Math.hypot(a[0]!.pos[0] - a[1]!.pos[0], a[0]!.pos[2] - a[1]!.pos[2]);
    expect(gap).toBeGreaterThanOrEqual(4);
    expect(gap).toBeLessThanOrEqual(11);
    // Build spots don't crowd each other.
    const bags = plan.slots.filter((s) => s.zone === 'A');
    for (let i = 0; i < bags.length; i++) for (let j = i + 1; j < bags.length; j++) expect(Math.hypot(bags[i]!.pos[0] - bags[j]!.pos[0], bags[i]!.pos[2] - bags[j]!.pos[2])).toBeGreaterThan(4.5);
    expect(planFortifications(zones, [], [], flatProbe())).toEqual(plan);
  });

  it('builds far more at riverside and middle zones: double spots, a line along the banks, the bridge ends', () => {
    // A north-south river through x = 0 (6 m bed, 4 m banks) with a bridge at z = 40; bases west and far east.
    const rivers = [{ pts: [[0, -150], [0, 150]] as [number, number][], width: 6, bank: 4, crossings: [[0, 40]] as [number, number][] }];
    const bases = [[-150, 0], [300, 0]] as [number, number][];
    const riverZone = { id: 'R', pos: [-20, 0, 60] as [number, number, number], radius: 18 };
    const dryZone = { id: 'D', pos: [200, 0, -60] as [number, number, number], radius: 18 };
    expect(zoneWeight(riverZone, { rivers, bases })).toEqual({ weight: FORT_WEIGHT.river, river: true });
    expect(zoneWeight(dryZone, { rivers, bases })).toEqual({ weight: 1, river: false });
    // Halfway between the bases (and clear of the river): the middle bonus only.
    expect(zoneWeight({ pos: [70, 0, 0], radius: 18 }, { rivers, bases }).weight).toBe(FORT_WEIGHT.middle);
    // Water is not ground.
    const probe: PlanProbe = { ground: (x, z) => (Math.abs(x) < 3 || Math.abs(x) > 400 || Math.abs(z) > 400 ? null : { y: 0, level: true }), clear: () => true };
    const plan = planFortifications([riverZone, dryZone], [], [], probe, { rivers, bases });
    const of = (id: string) => plan.slots.filter((s) => s.zone === id);
    expect(of('R').length).toBeGreaterThan(of('D').length * 2);
    // Bank positions on both banks just past the slope, facing the water; none in it.
    const bank = of('R').filter((s) => Math.abs(s.pos[0]) < 9);
    expect(bank.some((s) => s.pos[0] < 0) && bank.some((s) => s.pos[0] > 0)).toBe(true);
    for (const s of bank) expect(Math.abs(s.pos[0])).toBeGreaterThan(3);
    // Hedgehogs at the bridge ends.
    expect(of('R').some((s) => s.kind === 'hedgehog' && Math.abs(s.pos[2] - 40) < 8)).toBe(true);
    expect(planFortifications([riverZone, dryZone], [], [], probe, { rivers, bases })).toEqual(plan);
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

  it('nests block on three sides, wire only slows, and build mode aims at the spot in view', async () => {
    const { physics, nav, fort } = await world();
    const nest = fort.slots.find((s) => s.kind === 'nest')!;
    const wire = fort.slots.find((s) => s.kind === 'wire')!;
    // Looking straight at the nest from its open back picks it; looking away picks nothing near.
    const eye = nest.stand.clone().setY(nest.stand.y + 1.6);
    const dir = nest.center.clone().sub(eye).normalize();
    expect(fort.aimAt(eye, dir)).toBe(nest);
    expect(fort.aimAt(eye, dir.clone().negate())?.id ?? -1).not.toBe(nest.id);
    fort.complete(nest);
    fort.complete(wire);
    nav.update(4096);
    physics.step();
    expect(nest.colliders).toHaveLength(3);
    expect(nest.obstacles).toHaveLength(3);
    // Inside the U (the open back) is still free; the front wall is not.
    expect(fort.occupies(nest, nest.pos)).toBe(false);
    const front = new THREE.Vector3(-Math.sin(nest.yaw), 0, -Math.cos(nest.yaw));
    expect(fort.occupies(nest, nest.pos.clone().addScaledVector(front, nest.size[2] / 2 - 0.3))).toBe(true);
    expect(wire.colliders).toHaveLength(0);
    expect(fort.slowAt(wire.pos)).toBeLessThan(1);
    expect(fort.slowAt(wire.stand)).toBe(1);
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
