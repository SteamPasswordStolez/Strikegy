import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { aimErrorDeg, noticeTime, offAxisDeg, turnToward, wrapAngle, yawPitchOf } from '@/ai/aim';
import { chooseAction, type BrainInput } from '@/ai/brain';
import { NavWorld } from '@/ai/NavWorld';
import { PhysicsWorld } from '@/physics/PhysicsWorld';

const DEG = Math.PI / 180;

describe('aim helpers', () => {
  it('uses the player yaw convention (0 = -Z, +90° = -X)', () => {
    expect(yawPitchOf(0, 0, -1)[0]).toBeCloseTo(0);
    expect(yawPitchOf(-1, 0, 0)[0]).toBeCloseTo(Math.PI / 2);
    expect(yawPitchOf(0, 1, -1)[1]).toBeCloseTo(Math.PI / 4);
  });

  it('turns the short way around and never overshoots', () => {
    expect(Math.abs(wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI);
    const from = 170 * DEG;
    const to = -170 * DEG;
    const next = turnToward(from, to, 5 * DEG);
    expect(wrapAngle(next - from)).toBeCloseTo(5 * DEG); // through 180°, not back through 0
    expect(turnToward(0, 0.01, 1)).toBe(0.01);
  });

  it('settles aim error from the start value to the floor', () => {
    expect(aimErrorDeg(5, 1.5, 1.5, 0)).toBeCloseTo(5);
    expect(aimErrorDeg(5, 1.5, 1.5, 3)).toBeCloseTo(1.5);
    expect(aimErrorDeg(5, 1.5, 1.5, 0.75)).toBeLessThan(5);
  });

  it('notices close, centered, shooting enemies fastest', () => {
    const base = noticeTime(0.45, 5, 0, 57, false);
    expect(noticeTime(0.45, 60, 0, 57, false)).toBeGreaterThan(base);
    expect(noticeTime(0.45, 5, 50, 57, false)).toBeGreaterThan(base);
    expect(noticeTime(0.45, 5, 0, 57, true)).toBeLessThan(base);
    expect(offAxisDeg(0, 0, -10)).toBeCloseTo(0);
    expect(offAxisDeg(0, 10, 0)).toBeCloseTo(90);
  });
});

describe('utility brain', () => {
  const calm: BrainInput = {
    health: 1,
    hasTarget: false,
    lastSeenAge: Infinity,
    heardAge: Infinity,
    ammo: 1,
    reloading: false,
    sinceHurt: Infinity,
    coverKnown: false,
    inCover: false,
  };

  it('advances when nothing is happening and fights what it sees', () => {
    expect(chooseAction(calm, null)).toBe('advance');
    expect(chooseAction({ ...calm, hasTarget: true, lastSeenAge: 0 }, null)).toBe('engage');
  });

  it('breaks contact when badly hurt and cover is known', () => {
    const hurt = { ...calm, hasTarget: true, health: 0.25, sinceHurt: 0.3, coverKnown: true };
    expect(chooseAction(hurt, 'engage')).toBe('cover');
    // Without cover it keeps fighting.
    expect(chooseAction({ ...hurt, coverKnown: false }, 'engage')).toBe('engage');
  });

  it('chases recent sightings, investigates noises and reloads in quiet moments', () => {
    expect(chooseAction({ ...calm, lastSeenAge: 2 }, null)).toBe('hunt');
    expect(chooseAction({ ...calm, heardAge: 1 }, null)).toBe('investigate');
    expect(chooseAction({ ...calm, ammo: 0 }, null)).toBe('reload');
  });
});

describe('NavWorld', () => {
  it('paths around a wall through its gap', async () => {
    const physics = await PhysicsWorld.create();
    // 40 x 40 floor, a wall across z = 0 with a 4 m gap at x = 14..18.
    physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 20, y: 0.5, z: 20 });
    physics.addStaticBox({ x: -3, y: 1.5, z: 0 }, { x: 17, y: 1.5, z: 0.5 });
    physics.addStaticBox({ x: 19, y: 1.5, z: 0 }, { x: 1, y: 1.5, z: 0.5 });
    physics.step();
    const nav = await NavWorld.build(physics);
    expect(nav).not.toBeNull();
    const path: THREE.Vector3[] = [];
    expect(nav!.path({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -10 }, path)).toBe(true);
    // The route must pass through the gap (x around 14-18 near z = 0).
    const crossing = path.find((p, i) => i > 0 && Math.sign(p.z) !== Math.sign(path[i - 1]!.z)) ?? path.find((p) => Math.abs(p.z) < 1);
    expect(crossing).toBeDefined();
    const len = path.reduce((a, p, i) => (i ? a + p.distanceTo(path[i - 1]!) : 0), 0);
    expect(len).toBeGreaterThan(30);
    expect(path.some((p) => p.x > 12)).toBe(true);
    // A straight walk through the wall is not walkable, along the floor it is.
    expect(nav!.walkable({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: -5 })).toBe(false);
    expect(nav!.walkable({ x: 0, y: 0, z: 5 }, { x: 5, y: 0, z: 10 })).toBe(true);
    const r = nav!.randomAround({ x: 0, y: 0, z: 10 }, 3)!;
    expect(Math.hypot(r.x, r.z - 10)).toBeLessThanOrEqual(3.01);
    nav!.dispose();
    physics.dispose();
  });
});
