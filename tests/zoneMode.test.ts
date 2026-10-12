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

let nextId = 1;
const at = (team: 'blue' | 'red', x: number, id = nextId++) => ({ id, team, alive: true, feet: new THREE.Vector3(x, 0, 0) });

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

describe('Hardpoint, team deathmatch, kill confirmed', () => {
  const make = (mode: 'hardpoint' | 'tdm' | 'killconfirm') => {
    const bus = new EventBus<GameEvents>();
    const events: string[] = [];
    bus.on('mode:event', (e) => events.push(e.type === 'hill' ? `hill ${e.zone}` : e.type === 'tag' ? `tag ${e.team} ${e.confirmed}` : e.type));
    bus.on('match:ended', (e) => events.push(`end ${e.winner}`));
    return { zm: new ZoneMode(map, bus, { mode, teamSize: { blue: 4, red: 4 } }), bus, events };
  };

  it('hardpoint: one zone in play, scored by whoever stands in it alone, moving on', () => {
    const { zm, events } = make('hardpoint');
    expect(zm.kind).toBe('hardpoint');
    // The middle zone first, then side to side.
    expect(zm.order('blue')).toEqual(['B']);
    expect(zm.zones.filter((z) => !z.hidden).map((z) => z.id)).toEqual(['B']);
    for (let i = 0; i < 100; i++) zm.step(0.1, [at('blue', 0, 1)]);
    const m = zm.match as unknown as { points: Record<string, number>; holder: string | null };
    expect(m.points.blue).toBeGreaterThan(9.5);
    expect(m.holder).toBe('blue');
    // Contested: nobody scores, nobody captures.
    const before = m.points.blue!;
    for (let i = 0; i < 20; i++) zm.step(0.1, [at('blue', 0, 1), at('red', 1, 2)]);
    expect(m.points.blue).toBeCloseTo(before);
    expect(zm.zone('B')!.owner).toBeNull();
    // More soldiers in it than the enemy still scores (big matches are never alone in it).
    const level = m.points.blue!;
    for (let i = 0; i < 20; i++) zm.step(0.1, [at('blue', 0, 1), at('blue', 2, 3), at('red', 1, 2)]);
    expect(m.points.blue).toBeGreaterThan(level + 1.5);
    for (let i = 0; i < 500; i++) zm.step(0.1, []);
    expect(events.some((e) => e.startsWith('hill '))).toBe(true);
    expect(zm.zones.filter((z) => !z.hidden)).toHaveLength(1);
  });

  it('team deathmatch: downs score, the zones are hidden spawn points away from enemies', () => {
    const { zm, bus, events } = make('tdm');
    expect(zm.order('blue')).toEqual([]);
    for (let i = 0; i < 40; i++) bus.emit('combat:kill', { attacker: 'a', victim: 'b', weapon: 'ar1', headshot: false, byPlayer: false, attackerTeam: 'blue', victimTeam: 'red', victimId: 9 });
    zm.step(0.1, []);
    expect(events).toContain('end blue');
    const fresh = make('tdm').zm;
    fresh.step(0.1, [at('red', -55, 3)]);
    // A has a red soldier in it: not offered to blue; B and C are, C only to red (blue's far half).
    const blue = fresh.spawnOptions('blue').map((o) => o.id);
    expect(blue).not.toContain('A');
    expect(blue).toContain('B');
  });

  it('kill confirmed: a down drops a tag, the enemy scores it, the victim side denies it', () => {
    const { zm, bus, events } = make('killconfirm');
    zm.step(0.1, [at('red', 20, 7), at('blue', -50, 8)]);
    bus.emit('combat:kill', { attacker: 'a', victim: 'b', weapon: 'ar1', headshot: false, byPlayer: false, attackerTeam: 'blue', victimTeam: 'red', victimId: 7 });
    const m = zm.match as unknown as { tags: unknown[]; points: Record<string, number> };
    expect(m.tags).toHaveLength(1);
    zm.step(0.1, [at('blue', 20, 8)]);
    expect(m.tags).toHaveLength(0);
    expect(m.points.blue).toBe(1);
    expect(events).toContain('tag blue true');
    zm.step(0.1, [at('blue', -30, 8)]);
    bus.emit('combat:kill', { attacker: 'a', victim: 'b', weapon: 'ar1', headshot: false, byPlayer: false, attackerTeam: 'red', victimTeam: 'blue', victimId: 8 });
    zm.step(0.1, [at('blue', -30, 11)]);
    expect(events).toContain('tag blue false');
    expect(m.points.red).toBe(0);
  });
});
