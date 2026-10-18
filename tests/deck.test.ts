import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { createInputState } from '@/input/InputState';
import { Layer, PhysicsWorld, RAPIER, groups } from '@/physics/PhysicsWorld';
import { SurfaceRegistry } from '@/physics/surfaces';
import { Player } from '@/player/Player';
import { Vehicle } from '@/vehicles/Vehicle';

const DT = 1 / 60;

describe('walking on a moving deck', () => {
  it('carries someone standing on a platform that moves and turns, and lets them walk on it', async () => {
    const physics = await PhysicsWorld.create();
    physics.timestep = DT;
    physics.addStaticBox({ x: 0, y: -60, z: 0 }, { x: 400, y: 1, z: 400 });
    // A 20 x 1 x 40 m raft, kinematic, sailing along z and turning slowly.
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0));
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5, 20).setCollisionGroups(groups(Layer.WORLD, 0xffff)), body);
    physics.step();
    const player = new Player(physics, new EventBus<GameEvents>(), new SurfaceRegistry(), new THREE.Vector3(2, 1.6, 5), 0);
    const input = createInputState();
    let t = 0;
    const pose = (time: number) => ({ pos: new THREE.Vector3(Math.sin(time * 0.2) * 3, 1, -time * 8), yaw: time * 0.15 });
    const local = () => {
      const p = pose(t);
      return player.feet.clone().sub(p.pos).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.yaw));
    };
    const step = () => {
      player.step(DT, input, false, false);
      t += DT;
      const p = pose(t);
      // Put there at once, as a remote ship with a deck is (Vehicle.place).
      body.setTranslation(p.pos, true);
      body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), true);
      physics.step();
    };
    // Settle onto the deck.
    for (let i = 0; i < 30; i++) step();
    expect(player.platform).not.toBeNull();
    const start = local();
    const yaw0 = player.yaw;
    // Five seconds standing still: 40 m sailed, 0.75 rad turned; still on the same spot of the deck.
    for (let i = 0; i < 300; i++) step();
    const after = local();
    expect(after.distanceTo(start)).toBeLessThan(0.15);
    expect(player.yaw - yaw0).toBeCloseTo(0.75, 1);
    // Walk forward for a second: about a walking pace along the deck's frame.
    input.moveY = 1;
    for (let i = 0; i < 60; i++) step();
    input.moveY = 0;
    const walked = local().sub(after);
    expect(Math.hypot(walked.x, walked.z)).toBeGreaterThan(3);
    expect(Math.hypot(walked.x, walked.z)).toBeLessThan(5.5);
    expect(player.platform).not.toBeNull();
    player.dispose();
    physics.dispose();
  });

  it('someone on a patrol boat under way (its own physics) stays where they stand on deck', async () => {
    const physics = await PhysicsWorld.create();
    physics.timestep = DT;
    physics.addStaticBox({ x: 0, y: -40, z: 0 }, { x: 800, y: 1, z: 800 });
    const v = new Vehicle(1, 'patrol', physics, new THREE.Vector3(0, 0.5, 0), 0, null);
    v.water = () => 0;
    const settle = (input: Parameters<Vehicle['drive']>[1], n: number, player?: Player) => {
      for (let i = 0; i < n; i++) {
        player?.step(DT, createInputState(), false, false);
        v.drive(DT, input);
        physics.step();
        v.afterStep();
      }
    };
    settle(null, 60 * 4);
    // On the afterdeck, between the wheelhouse and the MG.
    const spot = v.toWorld(new THREE.Vector3(1.2, v.spec.half[1] + 0.3, 7), new THREE.Vector3());
    const player = new Player(physics, new EventBus<GameEvents>(), new SurfaceRegistry(), spot, 0);
    settle(null, 30, player);
    const local = () => player.feet.clone().sub(v.pos).applyQuaternion(v.quat.clone().invert());
    const start = local();
    settle({ throttle: 1, steer: 0.6, brake: false }, 60 * 8, player);
    expect(v.forwardSpeed()).toBeGreaterThan(5);
    expect(local().distanceTo(start)).toBeLessThan(0.4);
    expect(player.platform?.body.handle).toBe(v.body.handle);
    player.dispose();
    v.dispose();
    physics.dispose();
  });

  it('a patrol boat floats with its deck dry and its deck parts solid', async () => {
    const physics = await PhysicsWorld.create();
    physics.timestep = DT;
    physics.addStaticBox({ x: 0, y: -40, z: 0 }, { x: 500, y: 1, z: 500 });
    const v = new Vehicle(1, 'patrol', physics, new THREE.Vector3(0, 0.5, 0), 0, null);
    v.water = () => 0;
    for (let i = 0; i < 60 * 8; i++) {
      v.drive(DT, null);
      physics.step();
      v.afterStep();
    }
    // The deck (hull top) stands above the water; the wheelhouse is a collider on the body.
    expect(v.pos.y + v.spec.half[1]).toBeGreaterThan(0.6);
    expect(v.parts.length).toBe(v.spec.deck!.parts.length);
    const hit = physics.raycast({ x: 0, y: 20, z: 1.6 }, { x: 0, y: -1, z: 0 }, 30, Layer.WORLD);
    expect(hit && physics.world.getCollider(hit.collider.handle)?.parent()?.handle).toBe(v.body.handle);
    expect(hit!.point.y).toBeGreaterThan(v.pos.y + 3);
    v.dispose();
    physics.dispose();
  });
});
