import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld, Layer } from '@/physics/PhysicsWorld';
import { HitboxRegistry, type Damageable } from '@/combat/Hitboxes';
import { GadgetWorld, type GadgetOwner, type MineWalker } from '@/modes/gadgetWorld';
import { BEACON, MINE, classGadget } from '@/data/gadgets';
import { BLASTS, fragDamage } from '@/combat/explosions';

const blue: GadgetOwner = { id: 1, name: 'A', team: 'blue', squad: 'blue:0' };

async function setup() {
  const physics = await PhysicsWorld.create();
  physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 60, y: 0.5, z: 60 });
  physics.addStaticBox({ x: 0, y: 2, z: -20 }, { x: 5, y: 2, z: 0.5 });
  const registry = new HitboxRegistry();
  const log: string[] = [];
  const points: THREE.Vector3[] = [];
  const world = new GadgetWorld(physics, registry, {
    explode: (kind, p) => {
      log.push(`explode:${kind}`);
      points.push(p.clone());
    },
    directHit: (t) => log.push(`hit:${t.name}`),
    smoke: (p) => {
      log.push('smoke');
      points.push(p.clone());
    },
    destroyed: (kind) => log.push(`destroyed:${kind}`),
  });
  physics.step();
  return { physics, registry, world, log, points };
}

const walker = (team: 'blue' | 'red', x: number, z: number, crouched = false, speed = 3): MineWalker => ({
  id: 9,
  team,
  alive: true,
  downed: false,
  feet: new THREE.Vector3(x, 0, z),
  velocity: new THREE.Vector3(speed, 0, 0),
  eyeHeight: crouched ? 1.0 : 1.6,
});

describe('class gadgets', () => {
  it('gives each class its gadget', () => {
    expect(classGadget('assault', 'beacon')).toBe('panzerfaust');
    expect(classGadget('medic', 'beacon')).toBe('riflesmoke');
    expect(classGadget('recon', 'mine')).toBe('mine');
    expect(classGadget('support', 'mine')).toBeNull();
  });

  it('rockets burst on walls and hit people directly; rockets knock sandbags down in one shot', async () => {
    const { physics, registry, world, log, points } = await setup();
    world.fire('rocket', new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 0, -1), blue);
    for (let i = 0; i < 60 && !log.length; i++) world.step(1 / 60, []);
    expect(log).toEqual(['explode:rocket']);
    expect(points[0]!.z).toBeGreaterThan(-19.6);
    expect(points[0]!.z).toBeLessThan(-19);
    // A target's hitbox in the way.
    const box = physics.addStaticBox({ x: 10, y: 1.2, z: 0 }, { x: 0.3, y: 0.8, z: 0.3 }, undefined, Layer.HITBOX);
    const target: Damageable = { id: 5, name: 'dummy', alive: true, team: 'red', applyDamage: () => false };
    registry.register(box.handle, target, 'body');
    physics.step();
    log.length = 0;
    world.fire('rocket', new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(1, 0, 0), blue);
    for (let i = 0; i < 60 && !log.length; i++) world.step(1 / 60, []);
    expect(log).toEqual(['hit:dummy', 'explode:rocket']);
    // Sandbag wall has 260 health.
    expect(fragDamage(BLASTS.rocket, 1, false) * BLASTS.rocket.fortMult).toBeGreaterThan(260);
  });

  it('rifle smoke lobs out to about 40 m', async () => {
    const { world, log, points } = await setup();
    world.fire('riflesmoke', new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(1, 0, 0), blue);
    for (let i = 0; i < 600 && !log.length; i++) world.step(1 / 60, []);
    expect(log).toEqual(['smoke']);
    expect(points[0]!.x).toBeGreaterThan(30);
    expect(points[0]!.x).toBeLessThan(55);
  });

  it('mines go off under walking enemies, not under creeping ones or friends', async () => {
    const { world, log } = await setup();
    world.placeMine(new THREE.Vector3(5, 0, 5), 0, blue);
    const steps = (w: MineWalker[], n = 30) => {
      for (let i = 0; i < n; i++) world.step(1 / 60, w);
    };
    steps([walker('blue', 5, 5)]);
    steps([walker('red', 5.5, 5, true, 1.5)]);
    expect(log).toEqual([]);
    steps([walker('red', 5 + MINE.radius * 0.8, 5)], 1);
    expect(log).toEqual([]); // the delay
    steps([], 30);
    expect(log).toEqual(['explode:mine']);
    expect(world.mines.length).toBe(0);
    // Two per owner: a third replaces the oldest.
    world.placeMine(new THREE.Vector3(1, 0, 1), 0, blue);
    world.placeMine(new THREE.Vector3(2, 0, 1), 0, blue);
    world.placeMine(new THREE.Vector3(3, 0, 1), 0, blue);
    expect(world.mines.map((m) => m.pos.x)).toEqual([2, 3]);
  });

  it('beacons serve their squad a few times and break when shot', async () => {
    const { registry, world, log } = await setup();
    const b = world.placeBeacon(new THREE.Vector3(0, 0, 3), 0, blue);
    expect(world.beaconsFor('blue', 'blue:0')).toEqual([b]);
    expect(world.beaconsFor('blue', 'blue:1')).toEqual([]);
    expect(world.beaconsFor('red', null)).toEqual([]);
    for (let i = 0; i < BEACON.uses - 1; i++) world.useBeacon(b);
    expect(world.beacons.length).toBe(1);
    world.useBeacon(b);
    expect(world.beacons.length).toBe(0);
    const b2 = world.placeBeacon(new THREE.Vector3(0, 0, 3), 0, blue);
    const hit = registry.lookup(b2.collider.handle)!;
    expect(hit.owner.applyDamage(BEACON.health / 2, 'body')).toBe(false);
    expect(hit.owner.applyDamage(BEACON.health, 'body')).toBe(true);
    expect(log).toEqual(['destroyed:beacon']);
    expect(world.beacons.length).toBe(0);
  });
});
