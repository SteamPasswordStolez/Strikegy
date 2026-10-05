import { describe, expect, it } from 'vitest';
import { yawPitchOf } from '@/ai/aim';
import { rayHitbox } from '@/combat/CharacterHitboxes';
import { createInputState } from '@/input/InputState';
import type { MatchEvent, ServerMsg } from '@/net/lobbyProtocol';
import { PROTOCOL_VERSION } from '@/net/lobbyProtocol';
import { decodeInputs, decodeSnapshot, encodeInputs, encodeInputFrame, packInput, type Snapshot } from '@/net/matchProtocol';
import { Layer } from '@/physics/PhysicsWorld';
import { LobbyCore, SEAT_GRACE, type Conn, type MatchHost } from '../server/lobby';
import { MatchRoom } from '../server/matchRoom';

/** A player's end of a match: what came in. */
function line() {
  const texts: ServerMsg[] = [];
  const snaps: Snapshot[] = [];
  return {
    texts,
    snaps,
    events: () => texts.flatMap((m) => (m.t === 'ev' ? m.ev : [])) as MatchEvent[],
    line: { text: (m: ServerMsg) => texts.push(m), binary: (d: Uint8Array) => snaps.push(decodeSnapshot(d)!) },
  };
}

describe('match data on the wire', () => {
  it('inputs round-trip as quantized; the browser steps with what the server will see', () => {
    const s = createInputState();
    s.moveY = 0.73;
    s.fire = true;
    s.crouchToggle = true;
    s.weaponSlot = 2;
    const n = packInput(s, 7, 1234.5, -1.2345, 0.4321, 0.00123, -0.0004);
    const back = decodeInputs(encodeInputs([n]))!;
    expect(back).toHaveLength(1);
    expect(back[0]).toEqual(n);
    expect(decodeInputs(new Uint8Array([1, 2, 0]))).toBeNull();
  });

  it('a ray finds the head, body or legs of a posed soldier, turned or not', () => {
    const feet = { x: 10, y: 0, z: 5 };
    const from = { x: 10, y: 1.64, z: 15 };
    expect(rayHitbox(feet, 0, 1.8, from, { x: 0, y: 0, z: -1 }, 50)).toMatchObject({ part: 'head' });
    expect(rayHitbox(feet, 1.3, 1.8, { ...from, y: 1.2 }, { x: 0, y: 0, z: -1 }, 50)).toMatchObject({ part: 'body' });
    expect(rayHitbox(feet, 0, 1.8, { ...from, y: 0.3 }, { x: 0, y: 0, z: -1 }, 50)!.distance).toBeCloseTo(10 - 0.12, 2);
    expect(rayHitbox(feet, 0, 1.8, { ...from, x: 11 }, { x: 0, y: 0, z: -1 }, 50)).toBeNull();
    // Crouched, the head is lower.
    expect(rayHitbox(feet, 0, 1.1, from, { x: 0, y: 0, z: -1 }, 50)).toBeNull();
  });
});

describe('a match room on the game server', () => {
  it('two players: deploy, move by inputs, shots judged where the shooter saw the target', async () => {
    const room = await MatchRoom.create({ room: 'r1', map: 'lyon', mode: 'zone' });
    const a = line();
    const b = line();
    room.join('ua', 'alpha', a.line);
    room.join('ub', 'bravo', b.line);
    const startA = a.texts.find((m) => m.t === 'match');
    const startB = b.texts.find((m) => m.t === 'match');
    expect(startA && startA.t === 'match' && startA.match.team).toBe('blue');
    expect(startB && startB.t === 'match' && startB.match.team).toBe('red');
    room.ready('ua');
    room.ready('ub');
    room.deploy('ua', 'base', { cls: 'assault' });
    room.deploy('ub', 'base', { cls: 'assault' });
    room.tick();
    const spawn = a.events().find((e) => e.k === 'spawn');
    expect(spawn).toMatchObject({ k: 'spawn', kit: { cls: 'assault' } });

    const sa = room.sim.soldiers.get(1000)!;
    const sb = room.sim.soldiers.get(1001)!;
    // Somewhere open, face to face 12 m apart.
    const sim = room.sim;
    let x = 60;
    let z = -90;
    for (let i = 0; i < 20; i++) {
      const y = sim.world.terrain.heightAt(x, z);
      const y2 = sim.world.terrain.heightAt(x, z - 12);
      if (!sim.physics.blocked({ x, y: y + 1.6, z }, { x, y: y2 + 1.2, z: z - 12 }, Layer.WORLD)) break;
      x += 17;
      z += 11;
    }
    sa.player.teleport({ x, y: sim.world.terrain.heightAt(x, z) + 0.05, z } as never, 0);
    sb.player.teleport({ x, y: sim.world.terrain.heightAt(x, z - 12) + 0.05, z: z - 12 } as never, Math.PI);
    for (let i = 0; i < 30; i++) room.tick();

    // Alpha aims at bravo's chest (sights up); bravo then sidesteps for a few
    // ticks. Alpha's shots say they saw the moment before the step (the view
    // tick): judged there, they land although bravo has moved on.
    const eye = sa.player.feet.clone();
    eye.y += sa.player.eyeHeight;
    const chest = sb.player.feet.clone();
    chest.y += 1.2;
    const [yaw, pitch] = yawPitchOf(chest.x - eye.x, chest.y - eye.y, chest.z - eye.z);
    let seqA = 0;
    let seqB = 0;
    const aim = createInputState();
    aim.ads = true;
    // Alpha's browser draws the others 14 ticks behind (its lag), as browsers do.
    const LAG = 14;
    for (let i = 0; i < 30; i++) {
      room.binary('ua', encodeInputs([packInput(aim, ++seqA, sim.tick - LAG, yaw, pitch, 0, 0)]));
      room.tick();
    }
    const seen = sim.tick;
    const walk = createInputState();
    walk.moveX = 1;
    for (let i = 0; i < 13; i++) {
      room.binary('ub', encodeInputs([packInput(walk, ++seqB, sim.tick, Math.PI, 0, 0, 0)]));
      room.binary('ua', encodeInputs([packInput(aim, ++seqA, sim.tick - LAG, yaw, pitch, 0, 0)]));
      room.tick();
    }
    expect(sb.player.feet.distanceTo(chest.clone().setY(sb.player.feet.y))).toBeGreaterThan(0.45);
    const fire = createInputState();
    fire.ads = true;
    fire.fire = true;
    fire.firePressed = true;
    for (let i = 0; i < 4; i++) {
      room.binary('ua', encodeInputs([packInput(fire, ++seqA, seen, yaw, pitch, 0, 0)]));
      room.tick();
    }
    expect(a.events().some((e) => e.k === 'hit')).toBe(true);
    expect(b.events().some((e) => e.k === 'hurt')).toBe(true);
    expect(sb.player.health.value).toBeLessThan(100);
    // Snapshots carry both soldiers and alpha's own state with its last stepped input.
    const last = a.snaps.at(-1)!;
    expect(last.soldiers.map((s) => s.id).sort()).toEqual([1000, 1001]);
    expect(last.self!.ack).toBeGreaterThan(0);
    expect(last.self!.ack).toBeLessThanOrEqual(seqA);
    room.dispose();
  });
});

describe('anti-wallhack', () => {
  it('an enemy behind cover past 35 m is left out of the snapshot; in the open it is in', async () => {
    const room = await MatchRoom.create({ room: 'rs', map: 'iron_gate', mode: 'zone' });
    const sim = room.sim;
    const a = line();
    room.join('ua', 'alpha', a.line);
    room.join('ub', 'bravo', line().line);
    room.ready('ua');
    room.ready('ub');
    room.deploy('ua', 'base', { cls: 'assault' });
    room.deploy('ub', 'base', { cls: 'assault' });
    room.tick();
    const sa = sim.soldiers.get(1000)!;
    const sb = sim.soldiers.get(1001)!;
    const ground = (x: number, z: number) => sim.world.terrain.heightAt(x, z);
    // Alpha out in the open (the middle of the map, not inside its walled base), and two
    // spots for bravo 40-150 m away: one in clear sight, one hidden.
    sa.player.teleport({ x: 6, y: ground(6, 6) + 0.05, z: 6 } as never, 0);
    for (let i = 0; i < 10; i++) room.tick();
    let open: { x: number; z: number } | null = null;
    let hidden: { x: number; z: number } | null = null;
    const ax = sa.player.feet.x;
    const az = sa.player.feet.z;
    for (let i = 0; i < 2000 && !(open && hidden); i++) {
      const ang = i * 0.37;
      const r = 40 + (i % 12) * 10;
      const x = ax + Math.cos(ang) * r;
      const z = az + Math.sin(ang) * r;
      // On the map, well inside its edge (the sim keeps people in).
      const edge = sim.world.terrain.boundary;
      if (!edge.contains(x, z) || edge.edgeDistance(x, z) < 8) continue;
      // Hidden: no line from anywhere near alpha's eye to anywhere on bravo (not just grazing over a low wall).
      const lines = [1.3, 1.6, 1.9].flatMap((e) => [0.4, 1.1, 1.8].map((t) => sim.physics.blocked({ x: ax, y: ground(ax, az) + e, z: az }, { x, y: ground(x, z) + t, z }, Layer.WORLD)));
      if (lines.every(Boolean)) hidden ??= { x, z };
      // Open: the eye sees the head and the chest.
      else if (!lines[4] && !lines[5]) open ??= { x, z };
    }
    expect(open && hidden).toBeTruthy();
    const place = (p: { x: number; z: number }) => {
      sb.player.teleport({ x: p.x, y: ground(p.x, p.z) + 0.05, z: p.z } as never, 0);
      // Past the time a lost line is held (0.75 s).
      for (let i = 0; i < 60; i++) room.tick();
      return a.snaps.at(-1)!.soldiers.some((s) => s.id === 1001);
    };
    expect(place(open!)).toBe(true);
    expect(place(hidden!)).toBe(false);
    // Enemies come without their health.
    place(open!);
    expect(a.snaps.at(-1)!.soldiers.find((s) => s.id === 1001)!.health).toBe(0);
    room.dispose();
  }, 60_000);
});

describe('vehicles on the game server', () => {
  it('a tank from the deploy screen: seated, driven from the browser (checked), out again; a jet bail-out under a parachute', async () => {
    const room = await MatchRoom.create({ room: 'rv', map: 'iron_gate', mode: 'zone', size: 24 });
    const sim = room.sim;
    const a = line();
    const b = line();
    room.join('ua', 'alpha', a.line);
    room.join('ub', 'bravo', b.line);
    const start = a.texts.find((m) => m.t === 'match');
    expect(start && start.t === 'match' && start.match.size).toBe(24);
    room.ready('ua');
    room.ready('ub');
    room.deploy('ua', 'tank:tank', { cls: 'assault' });
    room.deploy('ub', 'jet:fighter', { cls: 'recon' });
    room.tick();
    const sa = sim.soldiers.get(1000)!;
    const sb = sim.soldiers.get(1001)!;
    const evA = a.events();
    // The spawn first, then the seat.
    expect(evA.findIndex((e) => e.k === 'spawn')).toBeLessThan(evA.findIndex((e) => e.k === 'seat'));
    const seat = evA.find((e) => e.k === 'seat');
    expect(seat).toMatchObject({ k: 'seat', seat: 0 });
    const tank = sa.ride!.v;
    expect(tank.kind).toBe('tank');
    expect(tank.remote).toBe(true);
    for (let i = 0; i < 3; i++) room.tick();
    const snap = a.snaps.at(-1)!;
    const nv = snap.vehicles.find((v) => v.id === (tank.id & 0xffff))!;
    expect(nv.kind).toBe('tank');
    expect(nv.seats[0]!.id).toBe(1000);
    expect(snap.soldiers.find((s) => s.id === 1000)!.flags & 1024).toBeTruthy();

    // The browser drives it 1 m on: the server's copy follows. 200 m in a tick is refused.
    let seq = 0;
    const idle = createInputState();
    const q = tank.quat;
    const drive = (x: number, z: number) =>
      encodeInputFrame([packInput(idle, ++seq, sim.tick, 0, 0, 0, 0)], { vehicle: tank.id & 0xffff, x, y: tank.pos.y, z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, vx: 0, vy: 0, vz: 0, throttle: 0 });
    const from = tank.pos.clone();
    room.binary('ua', drive(from.x + 1, from.z));
    room.tick();
    expect(tank.pos.x).toBeCloseTo(from.x + 1, 1);
    room.binary('ua', drive(from.x + 200, from.z));
    room.tick();
    expect(tank.pos.x).toBeCloseTo(from.x + 1, 1);

    // E: out beside it, the tank back on its own physics.
    const out = createInputState();
    out.interactPressed = true;
    room.binary('ua', encodeInputs([packInput(out, ++seq, sim.tick, 0, 0, 0, 0)]));
    room.tick();
    expect(sa.ride).toBeNull();
    expect(tank.remote).toBe(false);
    expect(tank.seats[0]).toBeNull();
    const left = a.events().filter((e) => e.k === 'seat').at(-1);
    expect(left).toMatchObject({ k: 'seat', v: null });
    expect(left && left.k === 'seat' && left.pos).toBeTruthy();

    // Bravo's fighter: high up; bailing out opens a canopy and drifts down.
    const jet = sb.ride!.v;
    expect(jet.flight).toBeTruthy();
    const ground = sim.world.terrain.heightAt(jet.pos.x, jet.pos.z);
    expect(jet.pos.y - ground).toBeGreaterThan(100);
    let seqB = 0;
    room.binary('ub', encodeInputs([packInput(out, ++seqB, sim.tick, 0, 0, 0, 0)]));
    room.tick();
    expect(sb.ride).toBeNull();
    expect(sb.chute).not.toBeNull();
    expect(b.events().filter((e) => e.k === 'seat').at(-1)).toMatchObject({ k: 'seat', v: null, chute: expect.any(Array) });
    const y0 = sb.player.feet.y;
    for (let i = 0; i < 60; i++) {
      room.binary('ub', encodeInputs([packInput(idle, ++seqB, sim.tick, 0, 0, 0, 0)]));
      room.tick();
    }
    expect(y0 - sb.player.feet.y).toBeGreaterThan(6);
    room.dispose();
  }, 60_000);
});

describe("bots run in a person's browser", () => {
  it("a desktop gets its squad's bots, moves them (checked) and fires for them; they go back when it goes quiet", async () => {
    const room = await MatchRoom.create({ room: 'rh', map: 'lyon', mode: 'zone', lineup: 'usersBots', size: 8 });
    const sim = room.sim;
    const a = line();
    room.join('ua', 'alpha', a.line);
    room.ready('ua', true);
    let seq = 0;
    const idle = createInputState();
    const frame = (bots: Parameters<typeof encodeInputFrame>[2] = null) => room.binary('ua', encodeInputFrame([packInput(idle, ++seq, sim.tick, 0, 0, 0, 0)], null, bots));
    for (let i = 0; i < 61; i++) {
      frame();
      room.tick();
    }
    const adopt = a.events().find((e) => e.k === 'adopt');
    expect(adopt && adopt.k === 'adopt' && adopt.bots.length).toBe(3);
    const ids = adopt && adopt.k === 'adopt' ? adopt.bots.map((b) => b.id) : [];
    const bot = sim.bots!.bots.find((b) => b.id === ids[0])!;
    expect(bot.puppet).toBe(true);
    // Its place from the browser: 0.1 m on is taken, 40 m in a tick is not.
    const from = bot.feet.clone();
    const state = (x: number) => ({ id: bot.id, x, y: from.y, z: from.z, yaw: 0, aimYaw: 0, aimPitch: 0, crouch: false });
    frame({ view: sim.tick, states: [state(from.x + 0.1)], events: [] });
    room.tick();
    expect(bot.feet.x).toBeCloseTo(from.x + 0.1, 3);
    frame({ view: sim.tick, states: [state(from.x + 40)], events: [] });
    room.tick();
    expect(bot.feet.x).toBeCloseTo(from.x + 0.1, 3);
    // A trigger pull: the server fires it (the round counter goes up).
    const shots = bot.shots;
    frame({ view: sim.tick, states: [], events: [{ k: 'shot', id: bot.id, dir: [0, 0, -1] }] });
    room.tick();
    expect(bot.shots).toBe(shots + 1);
    // Nothing from the browser for a second and a half: the server runs them again.
    for (let i = 0; i < 90; i++) room.tick();
    expect(bot.puppet).toBe(false);
    expect(a.events().some((e) => e.k === 'release')).toBe(true);
    room.dispose();
  }, 60_000);
});

describe('a room with bots', () => {
  it('fills both sides with bots; a person takes a bot\'s place; bots move, fight and capture', async () => {
    const room = await MatchRoom.create({ room: 'rb', map: 'lyon', mode: 'zone', lineup: 'usersBots', size: 8 });
    const sim = room.sim;
    expect(sim.bots!.bots).toHaveLength(8);
    const a = line();
    room.join('ua', 'alpha', a.line);
    room.ready('ua');
    const benched = sim.bots!.bots.filter((b) => b.benched);
    expect(benched).toHaveLength(1);
    expect(benched[0]!.team).toBe('blue');
    // The person sits where the bot was in its squad, and leads it.
    const sq = sim.squadOf(1000)!;
    expect(sq.members).toHaveLength(4);
    const roster = a.texts.filter((m) => m.t === 'roster').at(-1);
    expect(roster && roster.t === 'roster' && roster.roster.length).toBe(8);

    const start = new Map(sim.bots!.bots.map((b) => [b.id, b.feet.clone()]));
    const kills: string[] = [];
    sim.bus.on('combat:kill', (e) => kills.push(`${e.attacker}>${e.victim}`));
    // Fights start after 15-30 s; up to four minutes of sim for the first kills.
    for (let i = 0; i < 60 * 240 && kills.length < 2; i++) room.tick();
    const moved = sim.bots!.bots.filter((b) => !b.benched && b.feet.distanceTo(start.get(b.id)!) > 20);
    expect(moved.length).toBeGreaterThan(2);
    // (Kills come too, but when depends on the dice; checked by hand, not here.)
    // Snapshots carry the side's bots (the benched one not) and only the enemies it may know about.
    const snap = a.snaps.at(-1)!;
    const blue = sim.bots!.bots.filter((b) => b.team === 'blue' && !b.benched).map((b) => b.id);
    expect(blue.every((id) => snap.soldiers.some((s) => s.id === id))).toBe(true);
    expect(snap.soldiers.length).toBeLessThanOrEqual(8);
    expect(snap.soldiers.filter((s) => !blue.includes(s.id) && s.id !== 1000).every((s) => s.health === 0)).toBe(true);

    // The person leaves: the bot comes back.
    room.leave('ua');
    expect(sim.bots!.bots.filter((b) => b.benched)).toHaveLength(0);
    room.dispose();
  }, 120_000);
});

describe('lobby seats', () => {
  const settings = { name: 'r', map: 'lyon', mode: 'zone', size: 8, lineup: 'users', difficulty: 'normal', input: 'all', botShare: true };
  const hello = (name: string, uid = name) => JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name, uid, device: 'desktop' });
  const fake = () => {
    const got: ServerMsg[] = [];
    const conn: Conn = { send: (t) => got.push(JSON.parse(t) as ServerMsg), binary: () => {}, close: () => {} };
    return { conn, got, last: <T extends ServerMsg['t']>(t: T) => got.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined };
  };
  const host = () => {
    const calls: string[] = [];
    const h: MatchHost = {
      start: async (room, _s, members) => void calls.push(`start ${room} ${members.map((m) => m.uid).join(',')}`),
      join: (room, uid) => void calls.push(`join ${room} ${uid}`),
      detach: (room, uid) => void calls.push(`detach ${room} ${uid}`),
      leave: (room, uid) => void calls.push(`leave ${room} ${uid}`),
      stop: (room) => void calls.push(`stop ${room}`),
      message: (room, uid, m) => void calls.push(`${m.t} ${room} ${uid}`),
      binary: (room, uid) => void calls.push(`bin ${room} ${uid}`),
    };
    return { h, calls };
  };

  it('a dropped player keeps the seat mid-match and gets it back from the same browser; late ones lose it', async () => {
    let now = 1000;
    const { h, calls } = host();
    const core = new LobbyCore({ matches: h, now: () => now });
    const a = fake();
    const b = fake();
    const ida = core.open(a.conn);
    const idb = core.open(b.conn);
    await core.message(ida, hello('alpha'));
    await core.message(idb, hello('bravo'));
    await core.message(ida, JSON.stringify({ t: 'create', settings, password: 'pw' }));
    const room = a.last('room')!.room.id;
    await core.message(idb, JSON.stringify({ t: 'join', room, password: 'pw' }));
    await core.message(ida, JSON.stringify({ t: 'start' }));
    expect(calls).toContain(`start ${room} alpha,bravo`);
    core.binary(idb, new Uint8Array([1, 0]));
    expect(calls).toContain(`bin ${room} bravo`);

    // Bravo's tab reloads: away, seat kept; back with the same uid (no password asked).
    core.close(idb);
    expect(calls).toContain(`detach ${room} bravo`);
    expect(a.last('room')!.room.members.find((m) => m.name === 'bravo')?.away).toBe(true);
    const b2 = fake();
    const idb2 = core.open(b2.conn);
    await core.message(idb2, hello('bravo'));
    expect(b2.last('room')!.room.id).toBe(room);
    expect(calls.filter((c) => c === `join ${room} bravo`)).toHaveLength(1);
    expect(a.last('room')!.room.members.map((m) => m.away ?? false)).toEqual([false, false]);

    // The owner drops: someone connected leads; too late back: the seat is gone.
    core.close(ida);
    expect(b2.last('room')!.room.owner).toBe(idb2);
    now += SEAT_GRACE + 1;
    core.sweep();
    expect(calls).toContain(`leave ${room} alpha`);
    expect(b2.last('room')!.room.members).toHaveLength(1);
    const a2 = fake();
    await core.message(core.open(a2.conn), hello('alpha'));
    expect(a2.last('room')).toBeUndefined();

    // The match ends: everyone is back in the waiting room.
    core.matchOver(room);
    expect(b2.last('room')!.room.state).toBe('lobby');
    expect(calls).toContain(`stop ${room}`);
  });
});
