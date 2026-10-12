import fs from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Layer, PhysicsWorld } from '@/physics/PhysicsWorld';
import { Vehicle } from '@/vehicles/Vehicle';
import { vehicleParts } from '@/modes/fortify';
import { loadCore } from '@/wasm/core';

/** Drives `v` flat out for `sec` seconds. */
function drive(physics: PhysicsWorld, v: Vehicle, sec: number): void {
  for (let i = 0; i < sec * 60; i++) {
    v.drive(1 / 60, { throttle: 1, steer: 0, brake: false, aimYaw: 0, aimPitch: 0 });
    physics.step();
    v.afterStep();
  }
}

describe('things that stop vehicles only (owner, 2026-10-12: tanks drove through hedgehogs and wire)', () => {
  it('a tank stops at a hedgehog-sized block that soldiers, rounds and sight lines pass', async () => {
    await loadCore(fs.readFileSync('src/wasm/core.wasm'));
    const physics = await PhysicsWorld.create();
    physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 200, y: 0.5, z: 200 });
    const [part] = vehicleParts('hedgehog', [3, 1.4, 3]);
    expect(part).toBeTruthy();
    // A row of them across the road 20 m ahead (the tank faces -z).
    physics.addStaticBox({ x: 0, y: 0.7, z: -20 }, { x: 10, y: 0.7, z: 1.5 }, undefined, Layer.VEHICLE_BLOCK);
    physics.step();
    const v = new Vehicle(1, 'tank', physics, new THREE.Vector3(0, 1.5, 0), 0, 'blue');
    drive(physics, v, 8);
    expect(v.pos.z).toBeLessThan(-8); // it got going
    expect(v.pos.z).toBeGreaterThan(-20 + 1.5);
    // Rounds and walkers' queries don't see it.
    expect(physics.raycast({ x: 8, y: 0.7, z: -10 }, { x: 0, y: 0, z: -1 }, 20, Layer.WORLD | Layer.HITBOX)).toBeNull();
  });
});
