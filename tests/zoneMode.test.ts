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
  return { zm: new ZoneMode(map, bus, { tickets: 3, stepSec: 1 }), events };
}

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

  it('ends the match when a team runs out of tickets', () => {
    const { zm, events } = setup();
    for (let i = 0; i < 3; i++) zm.onDeath('red');
    expect(events).toContain('end blue');
    expect(zm.ended).toBe(true);
  });
});
