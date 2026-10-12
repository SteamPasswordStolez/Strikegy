import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { ZoneMode } from '@/modes/ZoneMode';
import { MATCH, setMatchFlags } from '@/modes/matchFlags';
import { RUSH, RushRules, SND, SearchDestroyRules } from '@/modes/matchRules';
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

const who = (team: 'blue' | 'red', x: number, z: number, id: number, using = false) => ({ id, team, alive: true, feet: new THREE.Vector3(x, 0, z), using });

function make(mode: 'rush' | 'snd') {
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('mode:event', (e) => {
    if (e.type === 'charge') events.push(`${e.state} ${e.id}`);
    else if (e.type === 'sector') events.push(`sector ${e.sector}`);
    else if (e.type === 'roundEnd') events.push(`roundEnd ${e.winner} ${e.why}`);
    else if (e.type === 'round') events.push(`round ${e.n} ${e.attacker}`);
  });
  bus.on('match:ended', (e) => events.push(`end ${e.winner}`));
  return { zm: new ZoneMode(map, bus, { mode, teamSize: { blue: 4, red: 4 } }), events };
}

/** Steps `sec` seconds with `list` present. */
const run = (zm: ZoneMode, sec: number, list: ReturnType<typeof who>[] = []) => {
  for (let i = 0; i < Math.round(sec * 10); i++) zm.step(0.1, list);
};

afterEach(() => setMatchFlags({}));

describe('Rush', () => {
  it('two charges a zone, in attack order from the attackers (red) side; nothing to plant during the setup', () => {
    const { zm } = make('rush');
    const m = zm.match as RushRules;
    expect(m.attacker).toBe('red');
    expect(m.sectors).toEqual([['C'], ['B'], ['A']]);
    expect(m.charges.map((c) => c.id)).toEqual(['C1', 'C2', 'B1', 'B2', 'A1', 'A2']);
    expect(m.tickets.red).toBe(RUSH.perSoldier * 4);
    expect(m.tickets.blue).toBeNull();
    const c1 = m.charges[0]!;
    run(zm, 5, [who('red', c1.x, c1.z, 1, true)]);
    expect(c1.state).toBe('idle');
    expect(zm.spawnOptions('red').map((o) => o.id)).toEqual(['base']);
    expect(zm.spawnOptions('blue').map((o) => o.id)).toEqual(['base', 'B', 'A']);
  });

  it('planting arms a charge, the fuse sets it off; both gone opens the next sector and tops the tickets up', () => {
    const { zm, events } = make('rush');
    const m = zm.match as RushRules;
    run(zm, RUSH.setup + 0.1);
    const [c1, c2] = m.charges;
    run(zm, RUSH.plant + 0.2, [who('red', c1!.x, c1!.z, 1, true)]);
    expect(c1!.state).toBe('armed');
    expect(zm.zone('C')!.pushing).toBe('red');
    // Standing there without holding E does nothing; a blue defender holding E would defuse it.
    run(zm, RUSH.fuse + 0.2);
    expect(c1!.state).toBe('gone');
    run(zm, RUSH.plant + 0.2, [who('red', c2!.x, c2!.z, 2, true)]);
    run(zm, RUSH.fuse + 0.2);
    expect(events).toEqual(['armed C1', 'blown C1', 'armed C2', 'blown C2', 'sector 0']);
    expect(m.active).toBe(1);
    expect(m.tickets.red).toBe(RUSH.perSoldier * 4 + RUSH.refillPerSoldier * 4);
    expect(zm.zone('C')!.owner).toBe('red');
    expect(zm.spawnOptions('red').map((o) => o.id)).toEqual(['base', 'C']);
  });

  it('defenders defuse an armed charge; out of tickets with nothing armed the defenders win, armed they wait for it', () => {
    const { zm, events } = make('rush');
    const m = zm.match as RushRules;
    run(zm, RUSH.setup + 0.1);
    const c1 = m.charges[0]!;
    run(zm, RUSH.plant + 0.2, [who('red', c1.x, c1.z, 1, true)]);
    // Someone else taking over starts from nothing; a full defuse puts it back to idle.
    run(zm, RUSH.defuse + 0.2, [who('blue', c1.x + 0.5, c1.z, 7, true)]);
    expect(c1.state).toBe('idle');
    expect(events).toContain('defused C1');
    run(zm, RUSH.plant + 0.2, [who('red', c1.x, c1.z, 1, true)]);
    for (let i = 0; i < RUSH.perSoldier * 4; i++) zm.onDeath('red');
    run(zm, 1);
    expect(m.ended).toBe(false);
    run(zm, RUSH.fuse);
    expect(c1.state).toBe('gone');
    run(zm, 0.2);
    expect(events).toContain('end blue');
  });
});

describe('Search & destroy', () => {
  it('one life a round; the sites are the two zones deepest in the defenders half; each side starts at its spot', () => {
    const { zm } = make('snd');
    const m = zm.match as SearchDestroyRules;
    expect(MATCH.revive).toBe(false);
    expect(MATCH.respawn).toBe(Infinity);
    expect(m.attacker).toBe('red');
    expect(m.charges.map((c) => c.id).sort()).toEqual(['A', 'B']);
    expect(zm.zones.filter((z) => !z.hidden).map((z) => z.id).sort()).toEqual(['A', 'B']);
    expect(m.half.defenderStart.x).toBeCloseTo(-45);
    // The zone nearest 90 m off the sites on the attackers' side: C.
    expect(zm.spawnPoint('red', 'base', null).pos.x).toBe(90);
    expect(zm.spawnPoint('blue', 'base', null).pos.x).toBeCloseTo(-45);
    expect(zm.spawnOptions('blue').map((o) => o.id)).toEqual(['base']);
  });

  it('a plant that goes off wins the round, a defuse or the clock loses it, a side wiped out loses; sides swap at the half; first to four', () => {
    const { zm, events } = make('snd');
    const m = zm.match as SearchDestroyRules;
    const site = () => m.charges.find((c) => c.id === 'A')!;
    const live = [who('blue', -45, 0, 1), who('red', 90, 0, 2)];
    run(zm, SND.pre + 0.1, live);
    expect(m.phase).toBe('live');
    // Round 1: red plants at A and it goes off.
    run(zm, SND.plant + 0.2, [...live, who('red', site().x, site().z, 3, true)]);
    expect(site().state).toBe('armed');
    run(zm, SND.fuse + 0.2, live);
    expect(events).toContain('roundEnd red blown');
    expect(m.wins.red).toBe(1);
    run(zm, SND.post + 0.1, live);
    expect(events).toContain('round 2 red');
    expect(site().state).toBe('idle');
    // Round 2: red plants, blue defuses.
    run(zm, SND.pre + 0.1, live);
    run(zm, SND.plant + 0.2, [...live, who('red', site().x, site().z, 3, true)]);
    run(zm, SND.defuse + 0.2, [...live, who('blue', site().x, site().z, 4, true)]);
    expect(events).toContain('roundEnd blue defused');
    run(zm, SND.post + 0.1, live);
    // Round 3: every blue soldier is down.
    run(zm, SND.pre + 0.1, live);
    run(zm, 0.2, [who('red', 90, 0, 2)]);
    expect(events).toContain('roundEnd red eliminated');
    run(zm, SND.post + 0.1, live);
    // The half: blue attacks now, at the sites deepest in red's half.
    expect(events).toContain('round 4 blue');
    expect(m.attacker).toBe('blue');
    expect(m.charges.map((c) => c.id).sort()).toEqual(['B', 'C']);
    // Round 4: out of time without a plant: the defenders (red) win it, and the match (4 rounds).
    m.wins.red = 3;
    run(zm, SND.pre + 0.1, live);
    run(zm, SND.roundTime + 0.2, live);
    expect(events).toContain('roundEnd red time');
    expect(events).toContain('end red');
  });
});
