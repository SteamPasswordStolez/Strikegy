import fs from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { Crowd } from '@/ai/crowd';
import type { Combatant } from '@/ai/types';
import { ZoneMode } from '@/modes/ZoneMode';
import { MATCH, foes, friends, setMatchFlags } from '@/modes/matchFlags';
import { GUN_GAME_STEPS, GunGameRules, type FreeForAllRules } from '@/modes/matchRules';
import { gunGameKit } from '@/modes/gunGame';
import { ScoreTracker } from '@/modes/scoreTracker';
import { loadCore } from '@/wasm/core';
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

const at = (team: 'blue' | 'red', x: number, id: number) => ({ id, team, alive: true, feet: new THREE.Vector3(x, 0, 0) });
const kill = (bus: EventBus<GameEvents>, attackerId: number, victimId: number, melee = false) =>
  bus.emit('combat:kill', { attacker: 'a', victim: 'v', weapon: 'w', headshot: false, byPlayer: false, attackerTeam: 'blue', victimTeam: 'blue', attackerId, victimId, melee });

function make(mode: 'ffa' | 'gungame' | 'tdm') {
  const bus = new EventBus<GameEvents>();
  const ended: { winner: string; winnerId?: number }[] = [];
  const levels: string[] = [];
  bus.on('match:ended', (e) => ended.push(e));
  bus.on('mode:event', (e) => {
    if (e.type === 'level') levels.push(`${e.id}:${e.level}${e.up ? '' : 'v'}`);
  });
  return { zm: new ZoneMode(map, bus, { mode, teamSize: { blue: 4, red: 4 } }), bus, ended, levels };
}

afterEach(() => setMatchFlags({}));

describe('free-for-all base', () => {
  it('a solo mode sets the match flags; a team mode puts them back', () => {
    make('ffa');
    expect(MATCH).toMatchObject({ ffa: true, revive: false, squads: false, vehicles: false, callIns: false });
    expect(MATCH.respawn).toBeGreaterThan(0);
    make('tdm');
    expect(MATCH).toMatchObject({ ffa: false, revive: true, respawn: null, squads: true });
  });

  it('foes: by side in team play, everyone but oneself in free-for-all', () => {
    const a = { id: 1, team: 'blue' as const };
    const b = { id: 2, team: 'blue' as const };
    const c = { id: 3, team: 'red' as const };
    expect(foes(a, b)).toBe(false);
    expect(foes(a, c)).toBe(true);
    setMatchFlags({ ffa: true });
    expect(foes(a, b)).toBe(true);
    expect(foes(a, a)).toBe(false);
    expect(friends(a, { id: 1, team: 'red' })).toBe(true);
    // A side with no soldier named (a whole side): nobody is its friend.
    expect(foes({ team: 'blue' }, a)).toBe(true);
  });

  it("the crowd's enemy queries count same-side soldiers in free-for-all", async () => {
    const crowd = new Crowd(await loadCore(fs.readFileSync('src/wasm/core.wasm')), { cell: 2, sepRadius: 0.95, sepStanding: 0.7, sepSpeed: 1.9, moving: 0.3, avoidAhead: 2, avoidWidth: 0.85, spotTaken: 0.75 });
    const body = (id: number, team: 'blue' | 'red', x: number): Combatant => ({
      id, name: '', team, alive: true, downed: false, feet: new THREE.Vector3(x, 0, -10), velocity: new THREE.Vector3(), eyeHeight: 1.6, firingUntil: -1, yaw: 0, inCombat: () => false,
    });
    const people = [body(1, 'blue', 0), body(2, 'blue', 1), body(3, 'red', -1)];
    const put = () => {
      people.forEach((p, i) => crowd.put(i, p, 0));
      crowd.setCount(people.length);
      crowd.buildGrid();
    };
    // Slot 0 looks down -z from z = 0 (the others stand 10 m ahead).
    people[0]!.feet.set(0, 0, 0);
    put();
    expect(crowd.view(0, 100, 100, 60, null, 0, 0)).toBe(1);
    setMatchFlags({ ffa: true });
    put();
    expect(crowd.view(0, 100, 100, 60, null, 0, 0)).toBe(2);
    // Its own slot is put back as it was.
    expect(crowd.view(1, 100, 100, 180, null, 0, 0)).toBe(2);
  });

  it('spawns away from everyone alive, with one choice on the deploy screen', () => {
    const { zm } = make('ffa');
    expect(zm.solo).toBe(true);
    expect(zm.spawnOptions('blue').map((o) => o.id)).toEqual(['base']);
    expect(zm.zones.every((z) => z.hidden)).toBe(true);
    // Everyone crowds the west: the spawn is east.
    zm.step(0.1, [at('blue', -120, 1), at('red', -60, 2), at('blue', -10, 3)]);
    for (let i = 0; i < 10; i++) expect(zm.soloSpawn(null, 9, () => 0).pos.x).toBe(120);
  });

  it('the scoreboard counts a kill of someone on the same nominal side in free-for-all', () => {
    setMatchFlags({ ffa: true });
    const sc = new ScoreTracker();
    sc.add(1, 'a', 'blue');
    sc.add(2, 'b', 'blue');
    sc.kill(1, 2, false);
    expect(sc.get(1)!.kills).toBe(1);
    sc.kill(1, 1, false);
    expect(sc.get(1)!.kills).toBe(1);
  });
});

describe('free-for-all deathmatch', () => {
  it('kills score for the killer alone; first to the target wins by id', () => {
    const { zm, bus, ended } = make('ffa');
    const m = zm.match as FreeForAllRules;
    zm.step(0.1, [at('blue', 0, 1), at('blue', 5, 2), at('red', 9, 3)]);
    kill(bus, 2, 1);
    kill(bus, 2, 2); // oneself: nothing
    expect(m.scoreOf(2)).toBe(1);
    for (let i = 1; i < m.target; i++) kill(bus, 3, 1);
    expect(ended).toHaveLength(0);
    kill(bus, 3, 2);
    expect(ended).toEqual([{ winner: 'red', winnerId: 3 }]);
    expect(m.reason).toBe('points');
  });

  it('out of time the leader wins; level, the next kill decides', () => {
    const { zm, bus, ended } = make('ffa');
    const m = zm.match as FreeForAllRules;
    zm.step(0.1, [at('blue', 0, 1), at('red', 5, 2)]);
    kill(bus, 1, 2);
    kill(bus, 2, 1);
    for (let i = 0; i < 61; i++) zm.step(10, []);
    expect(ended).toHaveLength(0);
    kill(bus, 2, 1);
    expect(ended[0]?.winnerId).toBe(2);
    expect(m.reason).toBe('time');
  });
});

describe('gun game', () => {
  it('a kill moves on a gun; the last step is the butt alone; a butt kill knocks the victim back', () => {
    const { zm, bus, ended, levels } = make('gungame');
    const m = zm.match as GunGameRules;
    expect(m.target).toBe(GUN_GAME_STEPS.length + 1);
    expect(gunGameKit(0)).toEqual({ weapon: GUN_GAME_STEPS[0], empty: false });
    expect(gunGameKit(GUN_GAME_STEPS.length).empty).toBe(true);
    zm.step(0.1, [at('blue', 0, 1), at('red', 5, 2)]);
    kill(bus, 1, 2);
    kill(bus, 1, 2);
    zm.step(0.1, []);
    expect(levels).toEqual(['1:1', '1:2']);
    // Clubbed: 1 goes back a step.
    kill(bus, 2, 1, true);
    zm.step(0.1, []);
    expect(m.scoreOf(1)).toBe(1);
    expect(levels.slice(2)).toEqual(['2:1', '1:1v']);
    // To the last step: gun kills there count for nothing, the butt wins.
    while (m.scoreOf(1) < GUN_GAME_STEPS.length) kill(bus, 1, 2);
    kill(bus, 1, 2);
    expect(m.scoreOf(1)).toBe(GUN_GAME_STEPS.length);
    expect(ended).toHaveLength(0);
    kill(bus, 1, 2, true);
    expect(ended).toEqual([{ winner: 'blue', winnerId: 1 }]);
  });

  it('every step but the last is a real gun, the whole lineup once', () => {
    expect(new Set(GUN_GAME_STEPS).size).toBe(GUN_GAME_STEPS.length);
    expect(GunGameRules.weaponAt(GUN_GAME_STEPS.length)).toBeNull();
  });
});

describe('free-for-all on the game server', () => {
  it('two people on the same nominal side: one shoots the other dead at once (no down), no squads, the kill scores', async () => {
    const { readFileSync } = await import('node:fs');
    const { MatchSim } = await import('@/sim/MatchSim');
    const { parseMap } = await import('@/world/validateMap');
    const { createInputState } = await import('@/input/InputState');
    const { yawPitchOf } = await import('@/ai/aim');
    const { Layer } = await import('@/physics/PhysicsWorld');
    const sim = await MatchSim.create(parseMap(JSON.parse(readFileSync('public/maps/lyon.json', 'utf8'))), { mode: 'ffa' });
    expect(sim.zoneMode?.kind).toBe('ffa');
    expect(sim.vehicles).toBeNull();
    const a = sim.addSoldier(1, 'blue', 'alpha');
    const b = sim.addSoldier(2, 'blue', 'bravo');
    expect(sim.squadOf(1)).toBeUndefined();
    sim.deploy(1);
    sim.deploy(2);
    const ground = (x: number, z: number) => new THREE.Vector3(x, sim.world.terrain.heightAt(x, z) + 0.05, z);
    let from = ground(60, -90);
    let to = ground(60, -99);
    for (let tries = 0; tries < 12; tries++) {
      const eye = from.clone().setY(from.y + 1.5);
      const d = to.clone().setY(to.y + 1.2).sub(eye);
      if (!sim.physics.raycast(eye, d.clone().normalize(), d.length(), Layer.WORLD)) break;
      from = ground(from.x + 17, from.z + 11);
      to = ground(from.x, from.z - 9);
    }
    a.player.teleport(from, 0);
    b.player.teleport(to, Math.PI);
    for (let i = 0; i < 30; i++) sim.step(() => null);
    const eye = a.player.feet.clone().setY(a.player.feet.y + a.player.eyeHeight);
    const chest = b.player.feet.clone().setY(b.player.feet.y + 1.2);
    const [yaw, pitch] = yawPitchOf(chest.x - eye.x, chest.y - eye.y, chest.z - eye.z);
    const fire = createInputState();
    fire.fire = true;
    const aim = () => ({ state: fire, yaw: yaw - a.weapons.recoil.yaw, pitch: pitch - a.weapons.recoil.pitch });
    for (let i = 0; i < 600 && b.deployed; i++) sim.step((id) => (id === 1 ? aim() : null));
    for (let i = 0; i < 3; i++) sim.step(() => null);
    expect(b.deployed).toBe(false);
    expect(b.downed).toBe(false);
    expect((sim.zoneMode!.match as FreeForAllRules).scoreOf(1)).toBe(1);
    expect(sim.scores.get(1)?.kills).toBe(1);
    // Back after the short free-for-all wait.
    expect(b.respawnTimer).toBeLessThanOrEqual(MATCH.respawn!);
  }, 60000);
});

describe('last soldier standing', () => {
  it('one life; the circle hurts outside after the grace and closes in by stages; crates arm whoever walks up; the last one up wins', async () => {
    const { LAST_STAND } = await import('@/modes/matchRules');
    const bus = new EventBus<GameEvents>();
    const ended: { winner: string; winnerId?: number }[] = [];
    const loot: string[] = [];
    bus.on('match:ended', (e) => ended.push(e));
    bus.on('mode:event', (e) => {
      if (e.type === 'loot') loot.push(`${e.by}:${e.weapon}`);
    });
    const zm = new ZoneMode(map, bus, { mode: 'lastman', teamSize: { blue: 2, red: 2 } });
    const m = zm.match as import('@/modes/matchRules').LastStandRules;
    expect(MATCH).toMatchObject({ ffa: true, revive: false, respawn: Infinity });
    // The first circle takes in every zone and spawn point.
    expect(m.circle.r).toBeGreaterThan(120);
    expect(zm.stormDps(new THREE.Vector3(500, 0, 0))).toBe(0);
    m.crates.push({ id: 1, x: 10, y: 0, z: 0, weapon: 'ar1', taken: false });
    const list = [at('blue', 10, 1), at('red', 50, 2), at('blue', -50, 3)];
    zm.step(0.1, list);
    expect(loot).toEqual(['1:ar1']);
    expect(m.armed[1]).toBe('ar1');
    for (let i = 0; i < (LAST_STAND.grace + 1) * 10; i++) zm.step(0.1, list);
    expect(zm.stormDps(new THREE.Vector3(500, 0, 0))).toBe(LAST_STAND.dps[0]);
    expect(zm.stormDps(new THREE.Vector3(m.circle.x, 0, m.circle.z))).toBe(0);
    const r0 = m.circle.r;
    for (let i = 0; i < (LAST_STAND.wait[0]! + LAST_STAND.shrink[0]!) * 10; i++) zm.step(0.1, list);
    expect(m.circle.r).toBeCloseTo(Math.max(LAST_STAND.minR, r0 * LAST_STAND.factor), 0);
    expect(m.stage).toBe(1);
    // Two down: the one left wins.
    kill(bus, 2, 1);
    zm.step(0.1, [at('red', 50, 2), at('blue', -50, 3)]);
    expect(ended).toHaveLength(0);
    zm.step(0.1, [at('red', 50, 2)]);
    expect(ended).toEqual([{ winner: 'red', winnerId: 2 }]);
    expect(m.reason).toBe('survived');
  });
});
