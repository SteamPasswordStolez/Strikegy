import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { cleanName, cleanReport, cleanSettings, SIGNAL_VERSION, type Member, type Report, type RoomSettings, type ServerMsg } from '@/net/signalProtocol';
import { hostScore, pickCandidates, pickHost } from '@/net/hostScore';
import { startSignalServer, type SignalServer } from '../server/signal';
import { withoutPort53 } from '../server/turn';
import { SignalCore, type Conn } from '../server/core';

const desk = (id: string): Member => ({ id, name: id, device: 'desktop' });
const phone = (id: string): Member => ({ id, name: id, device: 'mobile' });
const report = (links: Report['links'], benchMs: number | null = 20, onBattery = false, device: Report['device'] = 'desktop'): Report => ({ device, benchMs, onBattery, links });

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

  it('rejects malformed reports', () => {
    expect(cleanReport(report({ b: { rtt: 30, relayed: false } }))).not.toBeNull();
    expect(cleanReport({ ...report({}), benchMs: -1 })).toBeNull();
    expect(cleanReport(report({ b: { rtt: Number.NaN, relayed: false } }))).toBeNull();
  });
});

describe('host pick', () => {
  it('prefers the PC closest to everyone, judged by the slowest member', () => {
    const members = [desk('a'), desk('b'), desk('c')];
    const reports = new Map<string, Report>([
      ['a', report({ b: { rtt: 20, relayed: false }, c: { rtt: 120, relayed: false } })],
      ['b', report({ a: { rtt: 20, relayed: false }, c: { rtt: 40, relayed: false } })],
      ['c', report({ a: { rtt: 120, relayed: false }, b: { rtt: 40, relayed: false } })],
    ]);
    expect(pickHost(members, reports, 'a')).toEqual({ host: 'b', backup: 'a' });
  });

  it('never picks a phone or a PC that reaches most members only through TURN', () => {
    const members = [phone('p'), desk('t'), desk('d')];
    const reports = new Map<string, Report>([
      ['p', report({}, 1, false, 'mobile')],
      ['t', report({ p: { rtt: 10, relayed: true }, d: { rtt: 10, relayed: true } }, 1)],
      ['d', report({ p: { rtt: 60, relayed: false }, t: { rtt: 10, relayed: true } }, 30)],
    ]);
    expect(hostScore('p', members, reports)).toBeNull();
    expect(hostScore('t', members, reports)).toBeNull();
    expect(pickHost(members, reports, 'p').host).toBe('d');
  });

  it('weighs a slow PC and a laptop on battery', () => {
    const members = [desk('fast'), desk('slow'), desk('batt')];
    const links = (rtt: number): Report['links'] => ({ x: { rtt, relayed: false } });
    const reports = new Map<string, Report>([
      ['fast', report(links(30), 10)],
      ['slow', report(links(30), 60)],
      ['batt', report(links(30), 10, true)],
    ]);
    expect(pickHost(members, reports, 'slow').host).toBe('fast');
    expect(pickCandidates(members, reports, 'slow')).toEqual(['fast', 'batt', 'slow']);
  });

  it('still names a host when only phones are in the room', () => {
    expect(pickHost([phone('a'), phone('b')], new Map(), 'b').host).toBe('b');
  });
});

describe('ICE servers', () => {
  it('drops the port-53 fallbacks, keeps the rest', () => {
    const got = withoutPort53([
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
      { urls: 'stun:x:53' },
    ]);
    expect(got).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
    ]);
  });
});

describe('signalling core across a Durable Object sleep', () => {
  const settings: RoomSettings = { name: 'r', map: 'lyon', mode: 'zone', size: 8, lineup: 'users', difficulty: 'normal', input: 'all', botShare: true };
  const fake = () => {
    const got: ServerMsg[] = [];
    const conn: Conn = { send: (t) => got.push(JSON.parse(t) as ServerMsg), close: () => {} };
    return { conn, got, last: <T extends ServerMsg['t']>(t: T) => got.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined };
  };
  const ice = async () => [{ urls: 'stun:x:3478' }];
  const hello = (name: string) => JSON.stringify({ t: 'hello', v: SIGNAL_VERSION, name, uid: name, device: 'desktop' });

  it('keeps rooms, passwords and members through save / restore, and drops members whose socket closed meanwhile', async () => {
    const a = fake();
    const b = fake();
    const core = new SignalCore({ iceServers: ice });
    const ida = core.open(a.conn);
    const idb = core.open(b.conn);
    await core.message(ida, hello('aa'));
    await core.message(idb, hello('bb'));
    expect(await core.message(ida, JSON.stringify({ t: 'create', settings, password: 'pw' }))).toBe(true);
    const roomId = a.last('room')!.room.id;
    await core.message(idb, JSON.stringify({ t: 'join', room: roomId, password: 'pw' }));
    expect(b.last('room')!.room.members).toHaveLength(2);

    // The object sleeps: only JSON survives.
    const saved = JSON.parse(JSON.stringify(core.snapshot()));
    const woke = new SignalCore({ iceServers: ice });
    woke.restore(saved, new Map([[ida, a.conn], [idb, b.conn]]));
    const c = fake();
    const idc = woke.open(c.conn);
    await woke.message(idc, hello('cc'));
    await woke.message(idc, JSON.stringify({ t: 'join', room: roomId, password: 'wrong' }));
    expect(c.last('error')).toMatchObject({ code: 'password' });
    await woke.message(idc, JSON.stringify({ t: 'join', room: roomId, password: 'pw' }));
    expect(c.last('room')!.room.members.map((m) => m.name)).toEqual(['aa', 'bb', 'cc']);

    // a's socket closed while the object slept: on waking, a is out and b owns the room.
    const again = new SignalCore({ iceServers: ice });
    again.restore(JSON.parse(JSON.stringify(woke.snapshot())), new Map([[idb, b.conn], [idc, c.conn]]));
    await again.message(idb, JSON.stringify({ t: 'list' }));
    expect(b.last('rooms')!.rooms[0]).toMatchObject({ id: roomId, humans: 2 });
    await again.message(idb, JSON.stringify({ t: 'kick', member: idc }));
    expect(c.last('left')).toEqual({ t: 'left', reason: 'kicked' });
  });
});

describe('signalling server', () => {
  let server: SignalServer;
  const url = (): string => `ws://127.0.0.1:${server.port}/signal`;

  beforeAll(async () => {
    server = await startSignalServer({ port: 0, host: '127.0.0.1', log: () => {} });
  });
  afterAll(async () => {
    await server.close();
  });

  /** A test client: sends messages, waits for the next one of a kind. */
  async function connect(name: string, device: 'desktop' | 'mobile' = 'desktop') {
    const ws = new WebSocket(url());
    const inbox: ServerMsg[] = [];
    const waiters: { t: string; resolve: (m: ServerMsg) => void }[] = [];
    ws.on('message', (d) => {
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
    send({ t: 'hello', v: SIGNAL_VERSION, name, uid: `uid-${name}`, device });
    const welcome = await next('welcome');
    return { ws, id: welcome.id, welcome, send, next, drain: () => inbox.splice(0) };
  }

  const settings: RoomSettings = { name: '테스트', map: 'iron_gate', mode: 'zone', size: 24, lineup: 'users', difficulty: 'normal', input: 'all', botShare: true };

  it('rejects an old client and bad names', async () => {
    const ws = new WebSocket(url());
    await new Promise((r) => ws.once('open', r));
    const got = new Promise<ServerMsg>((r) => ws.once('message', (d) => r(JSON.parse(String(d)) as ServerMsg)));
    ws.send(JSON.stringify({ t: 'hello', v: SIGNAL_VERSION + 1, name: 'abc', uid: 'u', device: 'desktop' }));
    expect(await got).toMatchObject({ t: 'error', code: 'version' });
    ws.close();
  });

  it('lists, joins with a password, dedupes names, relays signals, hands over the owner', async () => {
    const a = await connect('alpha');
    expect(a.welcome.ice.length).toBeGreaterThan(0);
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

    b.send({ t: 'signal', to: a.id, data: { sdp: 'offer' } });
    expect(await a.next('signal')).toEqual({ t: 'signal', from: b.id, data: { sdp: 'offer' } });

    b.send({ t: 'start' });
    expect(await b.next('error')).toMatchObject({ code: 'notOwner' });

    a.ws.close();
    const after = (await b.next('room')).room;
    expect(after.owner).toBe(b.id);
    expect(after.members).toHaveLength(1);
    b.ws.close();
  });

  it('picks the host from reports and promotes the backup when the host drops mid-match', async () => {
    const a = await connect('a1');
    a.send({ t: 'create', settings });
    const room = (await a.next('room')).room;
    const b = await connect('b1');
    b.send({ t: 'join', room: room.id });
    await b.next('room');
    const c = await connect('c1', 'mobile');
    c.send({ t: 'join', room: room.id });
    await c.next('room');

    // b is closest to everyone: b hosts, a backs up; the phone never hosts.
    a.send({ t: 'report', report: report({ [b.id]: { rtt: 20, relayed: false }, [c.id]: { rtt: 150, relayed: false } }, 30) });
    b.send({ t: 'report', report: report({ [a.id]: { rtt: 20, relayed: false }, [c.id]: { rtt: 40, relayed: false } }, 20) });
    c.send({ t: 'report', report: report({}, null, false, 'mobile') });
    await new Promise((r) => setTimeout(r, 50));
    a.drain();
    a.send({ t: 'start' });
    const started = (await a.next('room')).room;
    expect(started.state).toBe('playing');
    expect(started.host).toBe(b.id);
    expect(started.backup).toBe(a.id);

    b.ws.close();
    const moved = (await a.next('room')).room;
    expect(moved.host).toBe(a.id);
    // Only the phone is left: a phone backup beats none.
    expect(moved.backup).toBe(c.id);
    a.ws.close();
    c.ws.close();
  });

  it('kicks on the owner\'s word and refuses a full room', async () => {
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
});
