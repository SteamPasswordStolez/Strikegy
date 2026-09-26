import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '@/core/FixedStepLoop';
import { EventBus } from '@/core/EventBus';
import { validateMap } from '@/world/validateMap';
import { approachVelocity, targetSpeed, wishDirection, MOVE } from '@/player/movement';
import { computeDamage } from '@/combat/Hitboxes';

describe('FixedStepLoop', () => {
  it('runs a constant number of steps regardless of frame rate', () => {
    for (const fps of [30, 60, 144, 240]) {
      const loop = new FixedStepLoop(1 / 60);
      let steps = 0;
      for (let i = 0; i < fps; i++) loop.advance(1 / fps, () => steps++);
      expect(Math.abs(steps - 60)).toBeLessThanOrEqual(1);
    }
  });

  it('caps catch-up steps after a long stall', () => {
    const loop = new FixedStepLoop(1 / 60, 5);
    let steps = 0;
    loop.advance(2, () => steps++);
    expect(steps).toBe(5);
  });
});

describe('EventBus', () => {
  it('delivers to subscribers and supports unsubscribe', () => {
    const bus = new EventBus<{ ping: number }>();
    const got: number[] = [];
    const off = bus.on('ping', (n) => got.push(n));
    bus.emit('ping', 1);
    off();
    bus.emit('ping', 2);
    expect(got).toEqual([1]);
  });
});

describe('movement', () => {
  it('forward at yaw 0 is -Z and right is +X', () => {
    const [fx, fz] = wishDirection(0, 1, 0);
    expect(fx).toBeCloseTo(0);
    expect(fz).toBeCloseTo(-1);
    const [rx, rz] = wishDirection(1, 0, 0);
    expect(rx).toBeCloseTo(1);
    expect(rz).toBeCloseTo(0);
  });

  it('diagonal input is normalized', () => {
    const [x, z] = wishDirection(1, 1, 0.7);
    expect(Math.hypot(x, z)).toBeCloseTo(1);
  });

  it('approachVelocity reaches the target without overshooting', () => {
    let v: [number, number] = [0, 0];
    for (let i = 0; i < 100; i++) v = approachVelocity(v[0], v[1], 5, 0, 60, 1 / 60);
    expect(v).toEqual([5, 0]);
  });

  it('sprint only applies when moving forward', () => {
    const base = { moveX: 0, moveY: 1, sprint: true, crouching: false, ads: false };
    expect(targetSpeed(base)).toBe(MOVE.sprintSpeed);
    expect(targetSpeed({ ...base, moveY: -1 })).toBe(MOVE.walkSpeed);
    expect(targetSpeed({ ...base, crouching: true })).toBe(MOVE.crouchSpeed);
  });
});

describe('computeDamage', () => {
  it('applies headshot and limb multipliers', () => {
    expect(computeDamage(30, 'head', 1.5)).toBe(45);
    expect(computeDamage(30, 'body', 1.5)).toBe(30);
    expect(computeDamage(30, 'limb', 1.5)).toBeCloseTo(25.5);
  });
});

describe('validateMap', () => {
  it('accepts the shipped sandbox map', () => {
    const raw = JSON.parse(readFileSync('public/maps/sandbox.json', 'utf8'));
    expect(validateMap(raw)).toEqual([]);
  });

  it('validates props', () => {
    const base = JSON.parse(readFileSync('public/maps/sandbox.json', 'utf8'));
    expect(validateMap({ ...base, props: [{ model: '../evil', pos: [0, 0, 0] }] }).join()).toMatch(/props\[0\]/);
    expect(validateMap({ ...base, props: [{ model: 'barrel_03', pos: [0, 0, 0], scale: -1 }] }).join()).toMatch(/scale/);
  });

  it('reports useful errors', () => {
    const errs = validateMap({
      meta: { id: 'x', name: 'x', version: 1 },
      world: { size: [10], visualProfile: 'mars' },
      spawns: [],
      objects: [{ type: 'lava', pos: [0, 0], size: [1, -1, 1] }],
    });
    expect(errs.join('\n')).toMatch(/version/);
    expect(errs.join('\n')).toMatch(/world.size/);
    expect(errs.join('\n')).toMatch(/visualProfile/);
    expect(errs.join('\n')).toMatch(/spawns/);
    expect(errs.join('\n')).toMatch(/objects\[0\].type/);
    expect(errs.join('\n')).toMatch(/objects\[0\].size/);
  });
});
