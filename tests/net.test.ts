import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { cleanName, cleanSettings, PROTOCOL_VERSION, roomLoad, type RoomSettings, type ServerMsg } from '@/net/lobbyProtocol';
import { startGateway, type Gateway } from '../server/gateway';
import { LobbyCore, type Conn } from '../server/lobby';

describe('names and settings', () => {
  it('accepts Korean, latin, digits, _ and - within 2-16 characters', () => {
    expect(cleanName('  병사_01 ')).toBe('병사_01');
    expect(cleanName('a')).toBeNull();
    expect(cleanName('x'.repeat(17))).toBeNull();
    expect(cleanName('no spaces')).toBeNull();
    expect(cleanName('<script>')).toBeNull();
  });

  it('rejects room sizes over 300 and unknown values', () => {
    const ok: RoomSettings = { name: '방', map: 'iron_gate', mode: 'zone', size: 300, lineup: 'users', difficulty: 'normal', input: 'all', botShare: true };
    expect(cleanSettings(ok)).toEqual(ok);
    expect(cleanSettings({ ...ok, size: 301 })).toBeNull();
    expect(cleanSettings({ ...ok, lineup: 'x' })).toBeNull();
    expect(cleanSettings({ ...ok, map: '../x' })).toBeNull();
  });

  it('a room with bots weighs its full size on the server, users only just its people', () => {
    const s: RoomSettings = { name: 'r', map: 'lyon', mode: 'zone', size: 40, lineup: 'users', difficulty: 'normal', input: 'all', botShare: true };
    expect(roomLoad(s, 3)).toBe(3);
    expect(roomLoad({ ...s, lineup: 'usersBots' }, 3)).toBe(40);
    expect(roomLoad({ ...s, lineup: 'coop' }, 3)).toBe(40);
  });
});

describe('lobby core', () => {
  const settings: RoomSettings = { name: 'r', map: 'lyon', mode: 'zone', size: 8, lineup: 'users', difficulty: 'normal', input: 'all', botShare: true };
  const hello = (name: string) => JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name, uid: name, device: 'desktop' });
  const fake = () => {
    const got: ServerMsg[] = [];
    const conn: Conn = { send: (t) => got.push(JSON.parse(t) as ServerMsg), close: () => {} };
    return { conn, got, last: <T extends ServerMsg['t']>(t: T) => got.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined };
  };

  it('pushes the room list to people on the list page, only when it changes', async () => {
    let now = 0;
    const core = new LobbyCore({ now: () => now });
    const w = fake();
    const o = fake();
    const idw = core.open(w.conn);
    const ido = core.open(o.conn);
    await core.message(idw, hello('watcher'));
    await core.message(ido, hello('owner'));
    await core.message(idw, JSON.stringify({ t: 'list' }));
    const lists = () => w.got.filter((m) => m.t === 'rooms').length;
    const before = lists();
    await core.message(ido, JSON.stringify({ t: 'create', settings }));
    expect(lists()).toBe(before + 1);
    // A ping changes nothing on the list.
    await core.message(ido, JSON.stringify({ t: 'ping', at: 5 }));
    expect(o.last('pong')).toEqual({ t: 'pong', at: 5 });
    expect(lists()).toBe(before + 1);
    // The owner isn't watching (in a room). Its connection drops: the seat (and
    // the room) wait a minute for it, then the room closes and the list empties.
    core.close(ido);
    expect(w.last('rooms')!.rooms).toHaveLength(1);
    now += 61_000;
    core.sweep();
    expect(w.last('rooms')!.rooms).toEqual([]);
    expect(o.got.filter((m) => m.t === 'rooms')).toHaveLength(0);
  });

  it('a few password tries a minute, a few rooms an address, and a kicked player stays out', async () => {
    let now = 0;
    const core = new LobbyCore({ now: () => now });
    const o = fake();
    const g = fake();
    const ido = core.open(o.conn, undefined, '1.2.3.4');
    const idg = core.open(g.conn, undefined, '5.6.7.8');
    await core.message(ido, hello('owner'));
    await core.message(idg, hello('guesser'));
    await core.message(ido, JSON.stringify({ t: 'create', settings, password: 'right' }));
    const room = o.last('room')!.room.id;
    for (let i = 0; i < 5; i++) await core.message(idg, JSON.stringify({ t: 'join', room, password: `wrong${i}` }));
    expect(g.got.filter((m) => m.t === 'error' && m.code === 'password')).toHaveLength(5);
    // Out of tries: even the right one waits a minute.
    await core.message(idg, JSON.stringify({ t: 'join', room, password: 'right' }));
    expect(g.last('error')!.code).toBe('rate');
    now += 61_000;
    await core.message(idg, JSON.stringify({ t: 'join', room, password: 'right' }));
    expect(g.last('room')!.room.id).toBe(room);
    // The anticheat puts the guesser out: back in is refused.
    core.kick(room, 'guesser', 'aim');
    expect(g.last('error')!.code).toBe('banned');
    await core.message(idg, JSON.stringify({ t: 'join', room, password: 'right' }));
    expect(g.last('error')!.code).toBe('banned');
    // Two rooms an address at most.
    const more = [fake(), fake()];
    for (const [i, f] of more.entries()) {
      const id = core.open(f.conn, undefined, '1.2.3.4');
      await core.message(id, hello(`same${i}`));
      await core.message(id, JSON.stringify({ t: 'create', settings }));
    }
    expect(more[0]!.last('room')).toBeTruthy();
    expect(more[1]!.last('error')).toMatchObject({ code: 'busy', detail: 'rooms' });
  });

  it('caps the soldiers on the whole server: rooms with bots count at full size', async () => {
    const core = new LobbyCore({ serverMax: 50 });
    const a = fake();
    const b = fake();
    const c = fake();
    const ida = core.open(a.conn);
    const idb = core.open(b.conn);
    const idc = core.open(c.conn);
    for (const [id, n] of [[ida, 'aa'], [idb, 'bb'], [idc, 'cc']] as const) await core.message(id, hello(n));
    await core.message(ida, JSON.stringify({ t: 'create', settings: { ...settings, size: 40, lineup: 'usersBots' } }));
    expect(core.load).toBe(40);
    // 40 + 20 would pass 50.
    await core.message(idb, JSON.stringify({ t: 'create', settings: { ...settings, size: 20, lineup: 'coop' } }));
    expect(b.last('error')).toMatchObject({ code: 'serverFull' });
    // A users-only room weighs its people only.
    await core.message(idb, JSON.stringify({ t: 'create', settings: { ...settings, size: 20 } }));
    expect(b.last('room')).toBeDefined();
    expect(core.load).toBe(41);
    // Joining a room with bots takes a bot's place: no extra load.
    await core.message(idc, JSON.stringify({ t: 'join', room: a.last('room')!.room.id }));
    expect(c.last('room')!.room.members).toHaveLength(2);
    expect(core.load).toBe(41);
    // Growing the bot room past the cap is refused.
    await core.message(ida, JSON.stringify({ t: 'settings', settings: { ...settings, size: 60, lineup: 'usersBots' } }));
    expect(a.last('error')).toMatchObject({ code: 'serverFull' });
  });
});

describe('game server gateway', () => {
  let server: Gateway;
  const url = (): string => `ws://127.0.0.1:${server.port}/play`;

  beforeAll(async () => {
    server = await startGateway({ port: 0, host: '127.0.0.1', log: () => {} });
  });
  afterAll(async () => {
    await server.close();
  });

  /** A test client: sends messages, waits for the next one of a kind. */
  async function connect(name: string, device: 'desktop' | 'mobile' = 'desktop') {
    const ws = new WebSocket(url());
    const inbox: ServerMsg[] = [];
    const waiters: { t: string; resolve: (m: ServerMsg) => void }[] = [];
    ws.on('message', (d: Buffer) => {
      const msg = JSON.parse(d.toString()) as ServerMsg;
      const w = waiters.findIndex((x) => x.t === msg.t);
      if (w >= 0) waiters.splice(w, 1)[0]!.resolve(msg);
      else inbox.push(msg);
    });
    await new Promise((r) => ws.once('open', r));
    const next = <T extends ServerMsg['t']>(t: T): Promise<Extract<ServerMsg, { t: T }>> => {
      const i = inbox.findIndex((m) => m.t === t);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0] as Extract<ServerMsg, { t: T }>);
      return new Promise((resolve) => waiters.push({ t, resolve: resolve as (m: ServerMsg) => void }));
    };
    const send = (m: unknown): void => ws.send(JSON.stringify(m));
    send({ t: 'hello', v: PROTOCOL_VERSION, name, uid: `uid-${name}`, device });
    const welcome = await next('welcome');
    return { ws, id: welcome.id, welcome, send, next };
  }

  const settings: RoomSettings = { name: '테스트', map: 'iron_gate', mode: 'zone', size: 24, lineup: 'users', difficulty: 'normal', input: 'all', botShare: true };

  it('rejects an old client and bad names', async () => {
    const ws = new WebSocket(url());
    await new Promise((r) => ws.once('open', r));
    const got = new Promise<ServerMsg>((r) => ws.once('message', (d: Buffer) => r(JSON.parse(String(d)) as ServerMsg)));
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION + 1, name: 'abc', uid: 'u', device: 'desktop' }));
    expect(await got).toMatchObject({ t: 'error', code: 'version' });
    ws.close();
  });

  it('lists, joins with a password, dedupes names, only the owner starts, hands over the owner', async () => {
    const a = await connect('alpha');
    a.send({ t: 'create', settings, password: 'pw' });
    const made = (await a.next('room')).room;
    expect(made.owner).toBe(a.id);
    expect(made.locked).toBe(true);

    const b = await connect('alpha');
    b.send({ t: 'list' });
    const list = (await b.next('rooms')).rooms;
    expect(list.find((r) => r.id === made.id)).toMatchObject({ humans: 1, locked: true });

    b.send({ t: 'join', room: made.id, password: 'nope' });
    expect(await b.next('error')).toMatchObject({ code: 'password' });
    b.send({ t: 'join', room: made.id, password: 'pw' });
    const joined = (await b.next('room')).room;
    expect(joined.members.map((m) => m.name)).toEqual(['alpha', 'alpha2']);
    await a.next('room');

    b.send({ t: 'start' });
    expect(await b.next('error')).toMatchObject({ code: 'notOwner' });
    a.send({ t: 'start' });
    expect((await b.next('room')).room.state).toBe('playing');

    // Mid-match a dropped player keeps the seat for a while; someone connected leads.
    a.ws.close();
    const after = (await b.next('room')).room;
    expect(after.owner).toBe(b.id);
    expect(after.members.map((m) => !!m.away)).toEqual([true, false]);
    b.ws.close();
  });

  it("kicks on the owner's word and refuses a full room", async () => {
    const a = await connect('own');
    a.send({ t: 'create', settings: { ...settings, size: 2 } });
    const room = (await a.next('room')).room;
    const b = await connect('two');
    b.send({ t: 'join', room: room.id });
    await b.next('room');
    const c = await connect('three');
    c.send({ t: 'join', room: room.id });
    expect(await c.next('error')).toMatchObject({ code: 'full' });
    a.send({ t: 'kick', member: b.id });
    expect(await b.next('left')).toEqual({ t: 'left', reason: 'kicked' });
    for (const x of [a, b, c]) x.ws.close();
  });

  it('answers pings and reports its load', async () => {
    const a = await connect('pinger');
    a.send({ t: 'ping', at: 42 });
    expect(await a.next('pong')).toEqual({ t: 'pong', at: 42 });
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(await res.json()).toMatchObject({ ok: true, v: PROTOCOL_VERSION, max: 1000 });
    a.ws.close();
  });
});
