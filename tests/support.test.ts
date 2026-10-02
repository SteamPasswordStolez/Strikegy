import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SUPPORT, barrageOffsets, squadRp } from '@/data/support';
import { SupportWorld, type SupportHooks } from '@/modes/supportWorld';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';

const flat = { raycast: () => null } as unknown as PhysicsWorld;

function world() {
  const log: string[] = [];
  const hooks: SupportHooks = {
    shell: (kind) => log.push(kind),
    smoke: () => log.push('smoke'),
    incoming: () => log.push('whistle'),
    reveal: () => log.push('reveal'),
    resupply: () => false,
  };
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return { w: new SupportWorld(flat, hooks, rand), log };
}

const owner = { id: 3, name: 'b', team: 'red' as const, squad: 'red:Alpha' };

describe('call-ins', () => {
  it('pools RP and never goes below zero', () => {
    expect(squadRp(1234.7, 400)).toBe(834);
    expect(squadRp(100, 400)).toBe(0);
  });

  it('spreads a barrage inside its radius', () => {
    const spec = SUPPORT.artillery;
    const offs = barrageOffsets(spec, Math.random);
    expect(offs).toHaveLength(spec.shells);
    for (const o of offs) expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(spec.spread);
  });

  it('charges the squad, starts the team cooldown and lands the shells after the delay', () => {
    const { w, log } = world();
    const p = new THREE.Vector3();
    expect(w.request('mortar', p, owner, 700, false)).toBe(false); // too little RP
    expect(w.request('mortar', p, owner, 900, false)).toBe(true);
    expect(w.spent('red:Alpha')).toBe(SUPPORT.mortar.cost);
    expect(w.request('mortar', p, { ...owner, squad: 'red:Bravo' }, 5000, false)).toBe(false); // team cooldown
    expect(w.request('mortar', p, { ...owner, team: 'blue', squad: 'blue:Alpha' }, 5000, false)).toBe(true);
    for (let i = 0; i < 60 * (SUPPORT.mortar.delay - 0.2); i++) w.step(1 / 60);
    expect(log.filter((l) => l === 'mortar')).toHaveLength(0);
    expect(w.dangers().length).toBeGreaterThan(0);
    for (let i = 0; i < 60 * 6; i++) w.step(1 / 60);
    expect(log.filter((l) => l === 'mortar')).toHaveLength(SUPPORT.mortar.shells * 2);
    expect(log).toContain('whistle');
    expect(w.cooldown('red', 'mortar')).toBeGreaterThan(0);
  });

  it('recon plane sweeps for its whole duration', () => {
    const { w, log } = world();
    w.request('recon', new THREE.Vector3(), owner, 600, false);
    for (let i = 0; i < 60 * 30; i++) w.step(1 / 60);
    const sweeps = log.filter((l) => l === 'reveal').length;
    expect(sweeps).toBeGreaterThanOrEqual(19);
    expect(sweeps).toBeLessThanOrEqual(21);
  });
});
