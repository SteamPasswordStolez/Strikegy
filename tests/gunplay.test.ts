import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultLoadout } from '@/data/classes';
import { createInputState, type InputState } from '@/input/InputState';
import { setMatchFlags } from '@/modes/matchFlags';
import { MatchSim, SIM_DT } from '@/sim/MatchSim';
import { WEAPONS } from '@/weapons/weaponData';
import { parseMap } from '@/world/validateMap';

const lyon = () => parseMap(JSON.parse(readFileSync('public/maps/lyon.json', 'utf8')));

describe('gunplay feel (audit, 2026-10-18)', () => {
  it('out of a sprint the gun comes up before it fires (sprint-out), on the server too', async () => {
    setMatchFlags({});
    const sim = await MatchSim.create(lyon(), {});
    const kit = defaultLoadout('assault');
    const s = sim.addSoldier(1, 'blue', 'alpha', { ...kit });
    sim.deploy(1, 'base', kit);
    let input: InputState = createInputState();
    const given = () => ({ state: input, yaw: s.player.yaw, pitch: 0 });
    // Let the draw finish, then sprint for a second.
    for (let i = 0; i < 40; i++) sim.step(given);
    input = Object.assign(createInputState(), { sprint: true, moveY: 1 });
    for (let i = 0; i < 60; i++) sim.step(given);
    expect(s.player.sprinting).toBe(true);
    // Pull the trigger and hold it.
    input = Object.assign(createInputState(), { fire: true, firePressed: true, moveY: 1 });
    const shots = s.weapons.shots;
    let steps = 0;
    while (s.weapons.shots === shots && steps < 120) {
      sim.step(given);
      steps++;
    }
    const delay = steps * SIM_DT;
    const want = s.weapons.def.sprintOut;
    expect(delay).toBeGreaterThanOrEqual(want - SIM_DT);
    expect(delay).toBeLessThan(want + 3 * SIM_DT);
  });

  it('heavier guns are slower to aim, draw and come out of a sprint', () => {
    const order = ['pistol1', 'smg1', 'ar1', 'lmg1'] as const;
    for (const key of ['adsTime', 'drawTime', 'sprintOut'] as const) {
      const v = order.map((id) => WEAPONS[id][key]);
      for (let i = 1; i < v.length; i++) expect(v[i]!).toBeGreaterThan(v[i - 1]!);
    }
    expect(WEAPONS.sr2.adsTime).toBeGreaterThan(WEAPONS.lmg1.adsTime);
  });
});

describe('near misses crack (Effects.onPass)', () => {
  it('a round passing the viewer reports how far it passed; one stopping short or fired from beside them does not', async () => {
    const THREE = await import('three');
    const { Effects } = await import('@/render/Effects');
    const fx = new Effects(new THREE.Scene(), null as never, 0);
    const passes: number[] = [];
    fx.onPass = (_at, miss) => passes.push(miss);
    fx.viewer.set(0, 1.6, 0);
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    fx.spawnShots([{ from: v(0, 1.6, -60), to: v(1.5, 1.6, 30) }], v(0, 1.6, -60));
    expect(passes.length).toBe(1);
    expect(passes[0]!).toBeGreaterThan(0.5);
    expect(passes[0]!).toBeLessThan(1.5);
    // Stopped by a wall before it reached the viewer.
    fx.spawnShots([{ from: v(0, 1.6, -60), to: v(0.5, 1.6, -20) }], v(0, 1.6, -60));
    // Fired from right beside them.
    fx.spawnShots([{ from: v(1, 1.6, 1), to: v(1, 1.6, 40) }], v(1, 1.6, 1));
    // One's own rounds never crack.
    fx.spawnShots([{ from: v(0, 1.6, -60), to: v(0.5, 1.6, 30) }], v(0, 1.6, -60), true);
    expect(passes.length).toBe(1);
  });
});
