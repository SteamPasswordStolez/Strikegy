import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createInputState } from '@/input/InputState';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { MatchSim, SIM_DT } from '@/sim/MatchSim';
import { Vehicle } from '@/vehicles/Vehicle';
import { parseMap } from '@/world/validateMap';
import { SWIM } from '@/player/Player';
import { Sea, SEA_STATES, waveUniforms } from '@/world/waves';

describe('sea waves', () => {
  it('finds the height under a point the way the surface was displaced to it', () => {
    const sea = new Sea({ level: -0.6, waves: 'rough' });
    let seed = 5;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const p = [0, 0, 0];
    for (let i = 0; i < 300; i++) {
      const x0 = (rand() - 0.5) * 2000;
      const z0 = (rand() - 0.5) * 2000;
      const t = rand() * 600;
      sea.displaced(x0, z0, t, p);
      expect(sea.heightAt(p[0]!, p[2]!, t)).toBeCloseTo(p[1]!, 2);
    }
  });

  it('stays within the sea state and hands the shader the same waves', () => {
    for (const state of ['calm', 'moderate', 'rough'] as const) {
      const sea = new Sea({ level: 2, waves: state });
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 2000; i++) {
        const h = sea.heightAt(i * 3.7, i * 1.3, i * 0.11);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      expect(hi - 2).toBeLessThanOrEqual(sea.swell / 2 + 1e-6);
      expect(2 - lo).toBeLessThanOrEqual(sea.swell / 2 + 1e-6);
      const u = waveUniforms(sea);
      expect(u.count).toBe(SEA_STATES[state].length);
      expect(u.shape[0]).toBeCloseTo(SEA_STATES[state][0]!.amp, 5);
    }
  });
});

describe('the range by the sea', () => {
  it('swims in deep water and walks out onto the beach', async () => {
    const map = parseMap(JSON.parse(readFileSync('public/maps/sandbox.json', 'utf8')));
    const sim = await MatchSim.create(map, {});
    const water = sim.world.water!;
    // Deep in the bay the sea answers, on the yard's floor nothing does.
    expect(Number.isNaN(water.levelAt(200, 0))).toBe(false);
    expect(Number.isNaN(water.levelAt(0, 0))).toBe(true);
    sim.addSoldier(1, 'blue', 'swimmer');
    sim.deploy(1);
    const s = sim.soldiers.get(1)!;
    s.player.teleport(new THREE.Vector3(150, -3, 0), Math.PI / 2);
    const input = { state: createInputState(), yaw: Math.PI / 2, pitch: 0 };
    input.state.moveY = 1;
    let swam = 0;
    let fastest = 0;
    for (let i = 0; i < 60 * 40 && s.player.feet.x > 72; i++) {
      sim.step((id) => (id === 1 ? input : null));
      if (s.player.swimming) {
        swam++;
        // Out in the deep part (near the beach a wave can lift one onto their feet and back).
        if (s.player.feet.x > 125) fastest = Math.max(fastest, s.player.horizontalSpeed());
        // Floating: the feet hang under the surface, the head above it.
        const surface = sim.world.sea!.heightAt(s.player.feet.x, s.player.feet.z);
        if (swam > 60) expect(Math.abs(surface - s.player.feet.y - SWIM.float)).toBeLessThan(0.5);
      }
    }
    expect(swam).toBeGreaterThan(60);
    expect(fastest).toBeLessThanOrEqual(SWIM.speed + 0.01);
    expect(s.player.swimming).toBe(false);
    expect(s.player.feet.x).toBeLessThanOrEqual(72);
    sim.dispose();
  }, 60_000);
});

describe('boats', () => {
  it('floats at its draft, drives and turns', async () => {
    const physics = await PhysicsWorld.create();
    physics.timestep = SIM_DT;
    // Flat water at 0 over a deep bed.
    physics.addStaticBox({ x: 0, y: -40, z: 0 }, { x: 500, y: 1, z: 500 });
    const v = new Vehicle(1, 'boat', physics, new THREE.Vector3(0, 0.5, 0), 0, null);
    v.water = () => 0;
    const step = (input: Parameters<Vehicle['drive']>[1]) => {
      v.drive(SIM_DT, input);
      physics.step();
      v.afterStep();
    };
    for (let i = 0; i < 60 * 8; i++) step(null);
    // Floats sit `draft` under the water (their height in the hull is -0.45).
    expect(v.pos.y).toBeCloseTo(0.45 - v.spec.boat!.draft, 1);
    expect(v.velocity.length()).toBeLessThan(0.2);
    for (let i = 0; i < 60 * 8; i++) step({ throttle: 1, steer: 0, brake: false });
    expect(v.forwardSpeed()).toBeGreaterThan(11);
    expect(v.forwardSpeed()).toBeLessThanOrEqual(v.spec.top + 0.5);
    const yaw0 = v.yaw;
    for (let i = 0; i < 60 * 3; i++) step({ throttle: 1, steer: 1, brake: false });
    // Turned right a fair way, still moving.
    const turned = Math.atan2(Math.sin(v.yaw - yaw0), Math.cos(v.yaw - yaw0));
    expect(turned).toBeLessThan(-0.6);
    expect(v.forwardSpeed()).toBeGreaterThan(7);
    // Still upright.
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(v.quat).y).toBeGreaterThan(0.9);
    v.dispose();
    physics.dispose();
  });
});
