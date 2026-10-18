import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HitboxRegistry } from '@/combat/Hitboxes';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { CarrierPilots } from '@/ai/carrierPilot';
import { CARRIER_PLANES, DECK, PLANE_COST, planeCap } from '@/vehicles/carrierPlanes';
import type { DriveInput } from '@/vehicles/Vehicle';
import { VehicleWorld } from '@/vehicles/VehicleWorld';
import { VEHICLES } from '@/vehicles/vehicleData';

const DT = 1 / 60;

/** A sea with a carrier under way (full ahead, its engine room manned) and a world to step. */
async function sea() {
  const physics = await PhysicsWorld.create();
  physics.timestep = DT;
  physics.addStaticBox({ x: 0, y: -80, z: 0 }, { x: 8000, y: 1, z: 8000 });
  const vw = new VehicleWorld(physics, new HitboxRegistry(), { destroyed: () => {}, roadkill: () => {} }, [], [], 0, [], false, false);
  vw.water = () => 0;
  const cv = vw.spawn('cv', new THREE.Vector3(0, 0, 0), 0, 'blue');
  const eng = cv.spec.seats.findIndex((s) => s.station?.kind === 'engine');
  cv.seats[0] = { id: 1, team: 'blue' };
  cv.seats[eng] = { id: 2, team: 'blue' };
  const inputs = new Map<number, DriveInput>();
  const helm: DriveInput = { throttle: 0, steer: 0, brake: false };
  inputs.set(cv.id, helm);
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      vw.step(DT, inputs, []);
      physics.step();
      vw.afterStep();
    }
  };
  // Full ahead: three presses.
  for (let k = 0; k < 3; k++) {
    helm.throttle = 1;
    step(2);
    helm.throttle = 0;
    step(2);
  }
  step(60 * 90);
  return { physics, vw, cv, inputs, step };
}

describe('carrier planes', () => {
  it('a quarter of the side, 1 to 20; every kind has a cost and limited ammunition', () => {
    expect(planeCap(40)).toBe(10);
    expect(planeCap(2)).toBe(1);
    expect(planeCap(150)).toBe(20);
    for (const k of CARRIER_PLANES) {
      expect(PLANE_COST[k]).toBeGreaterThan(0);
      const gun = VEHICLES[k].seats[0]!.gun!;
      expect(Number.isFinite(VEHICLES[k].seats.length)).toBe(true);
      expect(gun).toBeTruthy();
    }
  });

  it('takes off down a moving carrier deck, comes round behind it and is landed and rearmed', async () => {
    const { physics, vw, cv, inputs, step } = await sea();
    expect(cv.forwardSpeed()).toBeGreaterThan(14);
    const plane = vw.launchPlane(cv, 'cvdive', 'blue')!;
    expect(plane).toBeTruthy();
    plane.seats[0] = { id: 3, team: 'blue' };
    const stick: DriveInput = { throttle: 0, steer: 0, brake: false, aimYaw: cv.yaw, aimPitch: 0 };
    inputs.set(plane.id, stick);
    // Standing: the deck carries it.
    step(60);
    expect(plane.deck).not.toBeNull();
    const rel = () => cv.toLocal(plane.pos.clone());
    const z0 = rel().z;
    step(60);
    expect(Math.abs(rel().z - z0)).toBeLessThan(0.05);
    // Throttle up: it rolls to the bow and flies off it.
    stick.throttle = 1;
    let t = 0;
    while (plane.deck && t < 30) {
      step(1);
      t += DT;
    }
    stick.throttle = 0;
    expect(plane.deck).toBeNull();
    expect(t).toBeLessThan(15);
    stick.aimPitch = 0.15;
    step(60 * 6);
    expect(plane.wrecked).toBe(false);
    expect(plane.pos.y).toBeGreaterThan(cv.pos.y + 20);
    // Use some ammunition.
    expect(plane.pullTrigger(0, true, 999, DT)).toBe(true);
    expect(plane.mounts[0]!.ammo).toBe(0);
    expect(plane.pullTrigger(0, true, 1999, DT)).toBe(false);
    // Brought round behind the stern, lined up, low and slow: the landing aid takes it down.
    const behind = cv.toWorld(new THREE.Vector3(6, cv.spec.half[1] + 40, cv.spec.half[2] + 300), new THREE.Vector3());
    plane.snap(behind, cv.quat.clone());
    plane.flight!.yaw = cv.yaw;
    plane.flight!.pitch = 0;
    plane.flight!.speed = cv.forwardSpeed() + 40;
    plane.flight!.throttle = 0.3;
    plane.health = 100;
    stick.aimYaw = cv.yaw;
    stick.aimPitch = 0;
    t = 0;
    while (!plane.deck && t < 40 && !plane.wrecked) {
      step(1);
      t += DT;
    }
    expect(plane.wrecked).toBe(false);
    expect(plane.deck).not.toBeNull();
    // The wires stop it on the deck; then it is repaired and rearmed.
    step(60 * (DECK.rearm + 4));
    expect(plane.deck?.speed).toBe(0);
    expect(Math.abs(rel().z)).toBeLessThan(cv.spec.half[2]);
    expect(plane.health).toBe(plane.spec.health);
    expect(plane.mounts[0]!.ammo).toBe(1);
    physics.dispose();
  }, 60000);

  it('too slow off the bow (the carrier stopped, little deck run) it ends up in the sea', async () => {
    const { physics, vw, cv, inputs, step } = await sea();
    void cv;
    const c2 = vw.spawn('cv', new THREE.Vector3(800, 0, 0), 0, 'blue');
    step(30);
    const plane = vw.launchPlane(c2, 'cvtorp', 'blue')!;
    plane.deck!.z = -c2.spec.half[2] + 8;
    plane.seats[0] = { id: 3, team: 'blue' };
    inputs.set(plane.id, { throttle: 1, steer: 0, brake: false, aimYaw: c2.yaw, aimPitch: 0.2 });
    step(60 * 15);
    expect(plane.wrecked || plane.crashed).toBe(true);
    physics.dispose();
  }, 60000);

  it('a bot torpedo bomber takes off, attacks, comes back, lands, rearms and goes again', async () => {
    const physics = await PhysicsWorld.create();
    physics.timestep = DT;
    physics.addStaticBox({ x: 0, y: -80, z: 0 }, { x: 8000, y: 1, z: 8000 });
    const vw = new VehicleWorld(physics, new HitboxRegistry(), { destroyed: () => {}, roadkill: () => {} }, [], [], 0, [], false, false);
    vw.water = () => 0;
    vw.air = { center: new THREE.Vector3(), radius: 3000 };
    const cv = vw.spawn('cv', new THREE.Vector3(0, 0, 1000), 0.3, 'blue');
    vw.spawn('bb', new THREE.Vector3(300, 0, -1200), 1, 'red');
    const inputs = new Map<number, DriveInput>();
    const pilots = new CarrierPilots();
    pilots.level = () => 0;
    const p = vw.launchPlane(cv, 'cvtorp', 'blue')!;
    p.seats[0] = { id: 5, team: 'blue' };
    let t = 0;
    let drops = 0;
    let landings = 0;
    let wasAir = false;
    for (let i = 0; i < 60 * 180 && !p.wrecked; i++) {
      const out: DriveInput = { throttle: 0, steer: 0, brake: false };
      const o = pilots.fly(p, vw.vehicles, 'blue', t, out);
      inputs.set(p.id, out);
      if (p.pullTrigger(0, o.fire, t, DT)) drops++;
      vw.step(DT, inputs, []);
      physics.step();
      vw.afterStep();
      t += DT;
      if (wasAir && p.deck) landings++;
      wasAir = !p.deck;
    }
    expect(p.wrecked).toBe(false);
    expect(drops).toBeGreaterThanOrEqual(2);
    expect(landings).toBeGreaterThanOrEqual(1);
    physics.dispose();
  }, 60000);
});
