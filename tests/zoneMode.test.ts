import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { ZoneMode } from '@/modes/ZoneMode';
import type { MapDef } from '@/world/mapTypes';

const map: MapDef = {
  meta: { id: 't', name: 't', version: 2 },
  world: { size: [300, 100], visualProfile: 'outdoor_day' },
  spawns: [
    { team: 'blue', pos: [-120, 0, 0], yaw: 0 },
    { team: 'red', pos: [120, 0, 0], yaw: 0 },
  ],
  zones: [
    { id: 'A', pos: [-60, 0, 0], radius: 10 },
    { id: 'B', pos: [0, 0, 0], radius: 10 },
    { id: 'C', pos: [60, 0, 0], radius: 10 },
  ],
  objects: [],
};

const at = (team: 'blue' | 'red', x: number) => ({ team, alive: true, feet: new THREE.Vector3(x, 0, 0) });

function setup() {
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('zone:captured', (e) => events.push(`cap ${e.zone} ${e.team}`));
  bus.on('match:ended', (e) => events.push(`end ${e.winner}`));
  return { zm: new ZoneMode(map, bus, { stepSec: 1 }), events, bus };
}

const fronts: MapDef = { ...map, modes: { zone: { target: 10 }, frontline: { sectors: [['A'], ['B'], ['C']] }, conquest: { attacker: 'red', sectors: [['C'], ['B'], ['A']] } } };

describe('ZoneMode', () => {
  it('captures from presence and announces it', () => {
    const { zm, events } = setup();
    for (let i = 0; i < 12; i++) zm.step(0.1, [at('blue', -60), at('red', 60), at('red', 61)]);
    expect(events).toEqual(['cap A blue', 'cap C red']);
    expect(zm.spawnOptions('blue').map((o) => o.id)).toEqual(['base', 'A']);
  });

  it('spawns at an owned zone, back from it when under attack, else at the base', () => {
    const { zm } = setup();
    for (let i = 0; i < 12; i++) zm.step(0.1, [at('blue', -60)]);
    const calm = zm.spawnPoint('blue', 'A', null);
    expect(calm.pos.distanceTo(new THREE.Vector3(-60, 0, 0))).toBeLessThan(1);
    zm.step(0.1, [at('red', -60)]);
    const hot = zm.spawnPoint('blue', 'A', null, () => 0.5);
    expect(hot.pos.x).toBeLessThan(-60 - 10 - 11); // pushed back toward the blue base
    expect(zm.spawnPoint('blue', 'C', null).pos.x).toBe(-120); // not ours: base
  });

  it('ranks objectives: defend, then neutral, then enemy, then guard what we hold', () => {
    const { zm } = setup();
    for (let i = 0; i < 12; i++) zm.step(0.1, [at('blue', -60), at('red', 60)]);
    const goals = zm.objectives('blue');
    expect(goals.map((o) => o.pos.x)).toEqual([0, 60, -60]);
    expect(goals.map((o) => !!o.defend)).toEqual([false, false, true]);
    expect(goals[2]!.front!.x).toBeGreaterThan(0.9); // attacks come from the red side
    zm.step(0.1, [at('red', -60)]);
    expect(zm.objectives('blue')[0]!.pos.x).toBe(-60);
  });

  it('Zone: no tickets; the first side to the target in points wins', () => {
    const bus = new EventBus<GameEvents>();
    const ended: string[] = [];
    bus.on('match:ended', (e) => ended.push(e.winner));
    const zm = new ZoneMode(fronts, bus, { stepSec: 1 });
    expect(zm.kind).toBe('zone');
    for (let i = 0; i < 50; i++) zm.onDeath('red');
    expect(zm.ended).toBe(false);
    // Blue takes A and B, red C: 2 a tick against 1, 5 s ticks, target 10.
    for (let i = 0; i < 300 && !zm.ended; i++) zm.step(0.1, [at('blue', -60), at('blue', 0), at('red', 60)]);
    expect(ended).toEqual(['blue']);
  });

  it('plays the asked mode when the map offers it, else its default', () => {
    const bus = new EventBus<GameEvents>();
    expect(new ZoneMode(fronts, bus, { mode: 'frontline' }).kind).toBe('frontline');
    expect(new ZoneMode(map, bus, { mode: 'frontline' }).kind).toBe('zone');
    expect(new ZoneMode({ ...fronts, modes: { ...fronts.modes, default: 'conquest' } }, bus).kind).toBe('conquest');
  });

  it('Frontline: only the middle is open at the start; bots get only open zones; tickets scale with the side', () => {
    const bus = new EventBus<GameEvents>();
    const zm = new ZoneMode(fronts, bus, { mode: 'frontline', teamSize: { blue: 10, red: 8 } });
    expect(zm.zones.map((z) => `${z.id}${z.owner ?? '-'}${z.locked ? 'L' : ''}`)).toEqual(['AblueL', 'B-', 'CredL']);
    expect(zm.objectives('blue').map((o) => o.pos.x)).toEqual([0]);
    expect(zm.match.tickets).toEqual({ blue: 300, red: 240 });
    expect(zm.order('red')).toEqual(['C', 'B', 'A']);
  });

  it('Conquest: the defenders hold everything, the attackers alone have tickets', () => {
    const bus = new EventBus<GameEvents>();
    const zm = new ZoneMode(fronts, bus, { mode: 'conquest', teamSize: { blue: 10, red: 10 } });
    expect(zm.zones.every((z) => z.owner === 'blue')).toBe(true);
    expect(zm.zones.filter((z) => !z.locked).map((z) => z.id)).toEqual([]);
    for (let i = 0; i < 205; i++) zm.step(0.1, []);
    expect(zm.zones.filter((z) => !z.locked).map((z) => z.id)).toEqual(['C']);
    expect(zm.match.tickets).toEqual({ blue: null, red: 150 });
    expect(zm.spawnOptions('red').map((o) => o.id)).toEqual(['base']);
    // Nobody spawns in the sector being fought over.
    expect(zm.spawnOptions('blue').map((o) => o.id)).toEqual(['base', 'A', 'B']);
    expect(zm.spawnPoint('blue', 'C', null).pos.x).toBe(-120);
  });
});
