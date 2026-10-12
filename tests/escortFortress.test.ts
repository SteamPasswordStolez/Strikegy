import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { ZoneMode } from '@/modes/ZoneMode';
import { MATCH, foes, setMatchFlags } from '@/modes/matchFlags';
import { buildSpeed } from '@/modes/fortify';
import { ESCORT, EscortRules, FORTRESS, FortressRules } from '@/modes/matchRules';
import type { MapDef } from '@/world/mapTypes';

const map: MapDef = {
  meta: { id: 't', name: 't', version: 2 },
  world: { size: [400, 100], visualProfile: 'outdoor_day' },
  spawns: [
    { team: 'blue', pos: [-180, 0, 0], yaw: 0 },
    { team: 'red', pos: [180, 0, 0], yaw: 0 },
  ],
  zones: [
    { id: 'A', pos: [-90, 0, 0], radius: 20 },
    { id: 'B', pos: [0, 0, 0], radius: 20 },
    { id: 'C', pos: [90, 0, 0], radius: 20 },
  ],
  objects: [],
};

const who = (team: 'blue' | 'red', x: number, id: number) => ({ id, team, alive: true, feet: new THREE.Vector3(x, 0, 0) });

function make(mode: 'escort' | 'fortress') {
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('mode:event', (e) => events.push(e.type === 'checkpoint' ? `cp ${e.zone} +${e.bonus}` : e.type));
  bus.on('match:ended', (e) => events.push(`end ${e.winner}`));
  return { zm: new ZoneMode(map, bus, { mode, teamSize: { blue: 4, red: 4 } }), events };
}

afterEach(() => setMatchFlags({}));

describe('Escort', () => {
  it('the payload starts short of the first checkpoint and rolls only while the attackers outnumber the defenders at it', () => {
    const { zm, events } = make('escort');
    const m = zm.match as EscortRules;
    expect(m.attacker).toBe('red');
    expect(m.checkpoints).toEqual(['C', 'B', 'A']);
    expect(m.pos.x).toBeCloseTo(90 + ESCORT.lead);
    expect(zm.payload.x).toBeCloseTo(m.pos.x);
    const step = (sec: number, list: ReturnType<typeof who>[]) => {
      for (let i = 0; i < sec * 10; i++) {
        const at = m.pos.x;
        zm.step(0.1, list.map((s) => ({ ...s, feet: new THREE.Vector3(at + s.feet.x, 0, 0) })));
      }
    };
    step(ESCORT.setup + 0.2, []);
    // One attacker alone: it rolls; one each: it stops (contested).
    const x0 = m.pos.x;
    step(10, [who('red', 2, 1)]);
    expect(x0 - m.pos.x).toBeCloseTo(ESCORT.speed * 10, 0);
    const x1 = m.pos.x;
    step(5, [who('red', 2, 1), who('blue', -2, 2)]);
    expect(m.pos.x).toBeCloseTo(x1);
    expect(m.contested).toBe(true);
    // Through C: time added, C the attackers', a spawn point for them now.
    step(60, [who('red', 2, 1), who('red', 3, 3)]);
    expect(events).toContain(`cp C +${ESCORT.perCheckpoint}`);
    expect(zm.zone('C')!.owner).toBe('red');
    expect(zm.spawnOptions('red').map((o) => o.id)).toEqual(['base', 'C']);
    // Bots: both sides go to the payload itself.
    expect(zm.objectives('blue')[0]!.pos).toBe(zm.payload);
    // Out of time: the defenders win.
    step(m.timeLeft + 1, []);
    expect(events).toContain('end blue');
  });

  it('reaching the last checkpoint wins it for the attackers', () => {
    const { zm, events } = make('escort');
    const m = zm.match as EscortRules;
    for (let i = 0; i < 4000 && !m.ended; i++) zm.step(0.1, [{ id: 1, team: 'red', alive: true, feet: new THREE.Vector3(m.pos.x, 0, m.pos.z) }]);
    expect(events).toContain('cp A +0');
    expect(events).toContain('end red');
    expect(m.reason).toBe('delivered');
  });
});

describe('Fortress', () => {
  it('a build phase first: a truce, faster building, each side its own half; then zone points', () => {
    const { zm, events } = make('fortress');
    const m = zm.match as FortressRules;
    expect(zm.zone('A')!.owner).toBe('blue');
    expect(zm.zone('B')!.owner).toBeNull();
    expect(zm.zone('C')!.owner).toBe('red');
    expect(MATCH.truce).toBe(true);
    expect(foes({ id: 1, team: 'blue' }, { id: 2, team: 'red' })).toBe(false);
    expect(buildSpeed('assault')).toBe(FORTRESS.boost);
    // Nothing can be taken while building.
    for (let i = 0; i < 300; i++) zm.step(0.1, [who('red', -90, 1)]);
    expect(zm.zone('A')!.owner).toBe('blue');
    expect(m.points.blue + m.points.red).toBe(0);
    for (let i = 0; i < (FORTRESS.build - 30) * 10 + 1; i++) zm.step(0.1, []);
    expect(events).toContain('built');
    expect(MATCH.truce).toBe(false);
    expect(buildSpeed('assault')).toBe(1);
    expect(foes({ id: 1, team: 'blue' }, { id: 2, team: 'red' })).toBe(true);
    for (let i = 0; i < 102; i++) zm.step(0.1, []);
    expect(m.points.blue).toBe(2);
    expect(m.points.red).toBe(2);
  });
});
