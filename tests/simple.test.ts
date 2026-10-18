import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultLoadout } from '@/data/classes';
import { createInputState } from '@/input/InputState';
import { MATCH, setMatchFlags } from '@/modes/matchFlags';
import { simplifyInput } from '@/modes/simple';
import { matchFlagsFor } from '@/modes/ZoneMode';
import { MatchSim } from '@/sim/MatchSim';
import { parseMap } from '@/world/validateMap';

const lyon = () => parseMap(JSON.parse(readFileSync('public/maps/lyon.json', 'utf8')));

describe('simplified controls (owner, 2026-10-18)', () => {
  it('turn off revives, call-ins and melee on top of any mode (the gun game keeps its butt)', () => {
    expect(matchFlagsFor('zone', true)).toMatchObject({ simple: true, revive: false, callIns: false, melee: false });
    expect(matchFlagsFor('gungame', true)).toMatchObject({ simple: true, ffa: true, melee: true });
    expect(matchFlagsFor(null, true)).toMatchObject({ simple: true });
    expect(matchFlagsFor('zone')).toEqual({});
  });

  it('drop gadgets, medkits, building, call-ins, breath, inspect and melee from the input; keep the rest', () => {
    const press = () => {
      const i = createInputState();
      Object.assign(i, { fire: true, ads: true, reload: true, jump: true, throwGrenade: true, interactPressed: true, weaponSlot: 1 });
      Object.assign(i, { gadget: true, medkit: true, buildMode: true, support: true, holdBreath: true, inspect: true, melee: true });
      return i;
    };
    setMatchFlags({});
    const full = press();
    simplifyInput(full);
    expect(full.medkit && full.melee && full.gadget).toBe(true);
    setMatchFlags(matchFlagsFor('zone', true));
    const i = press();
    simplifyInput(i);
    expect([i.gadget, i.medkit, i.buildMode, i.support, i.holdBreath, i.inspect, i.melee]).toEqual([false, false, false, false, false, false, false]);
    expect([i.fire, i.ads, i.reload, i.jump, i.throwGrenade, i.interactPressed, i.weaponSlot]).toEqual([true, true, true, true, true, true, 1]);
    setMatchFlags({});
  });

  it('a simplified match on the server: no stations or build spots, no gadget or medkits, endless reserve', async () => {
    const sim = await MatchSim.create(lyon(), { simple: true });
    expect(MATCH.simple).toBe(true);
    expect(sim.fort).toBeNull();
    const s = sim.addSoldier(1, 'blue', 'alpha', { ...defaultLoadout('assault') });
    sim.deploy(1, 'base', defaultLoadout('assault'));
    expect(s.gadget).toBeNull();
    expect(s.medkits).toBe(0);
    expect(s.weapons.state.reserve).toBe(Infinity);
    // A down is a death at once (no reviving).
    s.damage(500, null, 'bullet');
    sim.step(() => null);
    expect(s.downed).toBe(false);
    expect(s.alive).toBe(false);
  });
});
