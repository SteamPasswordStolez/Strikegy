import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { cleanChat, cleanName, cleanSettings, PROTOCOL_VERSION, reservedText, roomLoad, type RoomSettings, type ServerMsg } from '@/net/lobbyProtocol';
import { startGateway, type Gateway } from '../server/gateway';
import { LobbyCore, tagOf, type AdminData, type Conn } from '../server/lobby';

describe('names and settings', () => {
  it('accepts Korean, latin, digits, _ and - within 2-16 characters', () => {
    expect(cleanName('  병사_01 ')).toBe('병사_01');
    expect(cleanName('a')).toBeNull();
    // Lone consonants / vowels and conjoining jamo (some IMEs) are names too (owner's report, 2026-10-12).
    expect(cleanName('ㄱㄴㄷ')).toBe('ㄱㄴㄷ');
    expect(cleanName('ㅋㅋ')).toBe('ㅋㅋ');
    expect(cleanName('각나')).toBe('각나');
    expect(cleanName('x'.repeat(17))).toBeNull();
    expect(cleanName('no spaces')).toBeNull();
    expect(cleanName('<script>')).toBeNull();
  });

  it('refuses names and room titles that pass for staff or the server', () => {
    for (const n of ['admin', 'Admin_01', '운영자', '관리자님', 'GM', 'server', '방장', 'Strikegy-dev', 's-y-s-t-e-m']) expect(cleanName(n)).toBeNull();
    for (const n of ['병사', 'modern', 'hosta', 'gmail']) expect(cleanName(n)).not.toBeNull();
    expect(reservedText('공식 서버 방')).toBe(true);
  });

  it('cleans chat lines: no invisible or direction characters, one line, at most 120', () => {
    expect(cleanChat('  안녕\n  하세요\u202e\u200b ')).toBe('안녕 하세요');
    expect(cleanChat('\u200b\u3164 ')).toBeNull();
    expect(cleanChat('ㅋ'.repeat(300))).toHaveLength(120);
    expect(cleanChat(42)).toBeNull();
  });

  it('rejects room sizes over 300 and unknown values', () => {
    const ok: RoomSettings = { name: '방', map: 'iron_gate', mode: 'zone', size: 300, lineup: 'users', difficulty: 'normal', input: 'all', botShare: true, teamPick: 'random', chat: true, simple: false };
    expect(cleanSettings(ok)).toEqual(ok);
    expect(cleanSettings({ ...ok, size: 301 })).toBeNull();
    expect(cleanSettings({ ...ok, lineup: 'x' })).toBeNull();
    expect(cleanSettings({ ...ok, map: '../x' })).toBeNull();
    // Simplified controls: a yes / no; rooms from older clients play the full controls.
    expect(cleanSettings({ ...ok, simple: true })?.simple).toBe(true);
    expect(cleanSettings({ ...ok, simple: 'yes' })).toBeNull();
    expect(cleanSettings({ ...ok, mode: 'fortress', simple: true })?.simple).toBe(false);
    const { simple: _drop, ...old } = ok;
    void _drop;
    expect(cleanSettings(old)?.simple).toBe(false);
  });

  it('a room with bots weighs its full size on the server, users only just its people', () => {
    const s: RoomSettings = { name: 'r', map: 'lyon', mode: 'zone', size: 40, lineup: 'users', difficulty: 'normal', input: 'all', botShare: true, teamPick: 'random', chat: true, simple: false };
    expect(roomLoad(s, 3)).toBe(3);
    expect(roomLoad({ ...s, lineup: 'usersBots' }, 3)).toBe(40);
    expect(roomLoad({ ...s, lineup: 'coop' }, 3)).toBe(40);
  });
});

describe('lobby core', () => {
  const settings: RoomSettings = { name: 'r', map: 'lyon', mode: 'zone', size: 8, lineup: 'users', difficulty: 'normal', input: 'all', botShare: true, teamPick: 'random', chat: true, simple: false };
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
    await core.message(ido, hello('maker'));
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
    await core.message(ido, hello('maker'));
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

  it('tags people by their browser with the server key: same browser same tag, nobody picks one', async () => {
    const core = new LobbyCore({ tagSecret: 'k1' });
    const a = fake();
    await core.message(core.open(a.conn), JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'alpha', uid: 'abc123-0001', device: 'desktop' }));
    const tag = a.last('welcome')!.tag;
    expect(tag).toMatch(/^[2-9A-HJ-NP-Z]{5}$/);
    // Another tab of the same browser: same tag; another key (server) or browser: another.
    expect(tagOf('k1', 'abc123-0002')).toBe(tag);
    expect(tagOf('k2', 'abc123-0001')).not.toBe(tag);
    expect(tagOf('k1', 'abc124-0001')).not.toBe(tag);
  });

  it('chat: the room hears it with the tag, sides hear their own, floods and repeats are held back', async () => {
    let now = 0;
    const core = new LobbyCore({ now: () => now, tagSecret: 'k' });
    const [a, b, c] = [fake(), fake(), fake()];
    const [ida, idb, idc] = [core.open(a.conn), core.open(b.conn), core.open(c.conn)];
    for (const [id, n] of [[ida, 'aa'], [idb, 'bb'], [idc, 'cc']] as const) await core.message(id, hello(n));
    await core.message(ida, JSON.stringify({ t: 'create', settings: { ...settings, teamPick: 'self' } }));
    const room = a.last('room')!.room.id;
    // The first one in lands on a side at random; players pick here.
    await core.message(ida, JSON.stringify({ t: 'team', team: 'blue' }));
    await core.message(idb, JSON.stringify({ t: 'join', room, team: 'red' }));
    await core.message(idc, JSON.stringify({ t: 'join', room, team: 'red' }));
    // Joining gets the room's recent lines.
    expect(c.got.some((m) => m.t === 'chatLog')).toBe(true);
    const teams = Object.fromEntries(a.last('room')!.room.members.map((m) => [m.name, m.team]));
    expect(teams).toEqual({ aa: 'blue', bb: 'red', cc: 'red' });
    await core.message(ida, JSON.stringify({ t: 'chat', text: 'hi <b>all</b>' }));
    const line = b.last('chat')!.line;
    expect(line.from).toMatchObject({ name: 'aa', tag: a.last('welcome')!.tag, team: 'blue' });
    expect(line.text).toBe('hi <b>all</b>');
    // Red's side chat: red hears it, blue doesn't.
    const aChats = a.got.filter((m) => m.t === 'chat').length;
    await core.message(idb, JSON.stringify({ t: 'chat', text: 'flank left', team: true }));
    expect(c.last('chat')!.line).toMatchObject({ text: 'flank left', team: true, side: 'red' });
    expect(a.got.filter((m) => m.t === 'chat').length).toBe(aChats);
    // Nobody can send a line as someone else or the server: the sender is stamped by the server.
    await core.message(idc, JSON.stringify({ t: 'chat', text: 'x', from: { name: 'aa', tag: 'AAAAA' }, sys: 'host' }));
    expect(a.last('chat')!.line.from).toMatchObject({ name: 'cc' });
    expect(a.last('chat')!.line.sys).toBeUndefined();
    // Floods: a burst of 5, then held back until the bucket refills; the same line 3 times in a row at most.
    for (let i = 0; i < 5; i++) await core.message(idc, JSON.stringify({ t: 'chat', text: `m${i}` }));
    expect(c.last('chat')!.line.sys).toBe('slow');
    now += 10_000;
    for (let i = 0; i < 4; i++) await core.message(ida, JSON.stringify({ t: 'chat', text: 'same' }));
    expect(a.last('chat')!.line.sys).toBe('slow');
    expect(b.got.filter((m) => m.t === 'chat' && m.line.text === 'same')).toHaveLength(3);
  });

  it('sides: drawn at the start, picked by each player, or set by the owner', async () => {
    const core = new LobbyCore({ tagSecret: 'k' });
    const people = ['p1', 'p2', 'p3', 'p4'].map((n) => ({ n, f: fake() }));
    const ids = people.map((p) => core.open(p.f.conn));
    for (const [i, p] of people.entries()) await core.message(ids[i]!, hello(p.n));
    const send = (i: number, m: object) => core.message(ids[i]!, JSON.stringify(m));
    const members = () => people[0]!.f.last('room')!.room.members;
    const counts = () => ({ blue: members().filter((m) => m.team === 'blue').length, red: members().filter((m) => m.team === 'red').length });
    // Players pick: a side takes half the people at most (2 in a room of 4).
    await send(0, { t: 'create', settings: { ...settings, size: 4, teamPick: 'self' } });
    const room = people[0]!.f.last('room')!.room.id;
    for (const i of [1, 2, 3]) await send(i, { t: 'join', room, team: 'red' });
    expect(counts()).toEqual({ blue: 2, red: 2 });
    // Only the owner moves others, and only where the owner picks.
    await send(0, { t: 'team', team: 'blue', member: ids[1] });
    expect(people[0]!.f.last('error')!.code).toBe('notOwner');
    // Owner picks: the owner moves people (not onto a full side), players can't move themselves.
    await send(0, { t: 'settings', settings: { ...settings, size: 4, teamPick: 'host' } });
    const p2 = () => members().find((m) => m.name === 'p2')!.team;
    const before = p2();
    await send(0, { t: 'team', team: before === 'red' ? 'blue' : 'red', member: ids[1] });
    expect(people[0]!.f.last('error')).toMatchObject({ code: 'full', detail: 'side' });
    expect(p2()).toBe(before);
    await send(2, { t: 'team', team: 'blue' });
    expect(people[2]!.f.last('error')!.code).toBe('notOwner');
    // Random: sides dealt out at the start, two and two.
    await send(0, { t: 'settings', settings: { ...settings, size: 4, teamPick: 'random', chat: true, simple: false } });
    await send(0, { t: 'start' });
    expect(counts()).toEqual({ blue: 2, red: 2 });
    // Against the bots everyone is blue; every soldier for themselves: no sides.
    const solo = new LobbyCore({ tagSecret: 'k' });
    const s1 = fake();
    const sid = solo.open(s1.conn);
    await solo.message(sid, hello('solo'));
    await solo.message(sid, JSON.stringify({ t: 'create', settings: { ...settings, lineup: 'coop' } }));
    expect(s1.last('room')!.room.members[0]!.team).toBe('blue');
    await solo.message(sid, JSON.stringify({ t: 'settings', settings: { ...settings, mode: 'ffa' } }));
    expect(s1.last('room')!.room.members[0]!.team).toBeNull();
  });

  it('chat: swearing masked, rooms without chat, the owner mutes by id or by name', async () => {
    const core = new LobbyCore({ tagSecret: 'k' });
    const [a, b] = [fake(), fake()];
    const [ida, idb] = [core.open(a.conn), core.open(b.conn)];
    await core.message(ida, hello('aa'));
    await core.message(idb, hello('bb'));
    // Swearing in names and room titles is refused.
    const c = fake();
    await core.message(core.open(c.conn), JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: '씨1발놈', uid: 'cc', device: 'desktop' }));
    expect(c.last('error')!.code).toBe('words');
    await core.message(ida, JSON.stringify({ t: 'create', settings: { ...settings, name: '병신들 방' } }));
    expect(a.last('error')!.code).toBe('words');
    await core.message(ida, JSON.stringify({ t: 'create', settings }));
    const room = a.last('room')!.room.id;
    await core.message(idb, JSON.stringify({ t: 'join', room }));
    await core.message(idb, JSON.stringify({ t: 'chat', text: '야 씨1발 뭐함' }));
    expect(a.last('chat')!.line.text).toBe('야 *** 뭐함');
    // The owner mutes bb (by id): bb's lines stop, everyone hears why.
    await core.message(ida, JSON.stringify({ t: 'mute', member: idb, on: true }));
    expect(a.last('chat')!.line).toMatchObject({ sys: 'muted', who: { name: 'bb' } });
    expect(a.last('room')!.room.members.find((m) => m.name === 'bb')!.muted).toBe(true);
    await core.message(idb, JSON.stringify({ t: 'chat', text: 'hello' }));
    expect(b.last('chat')!.line.sys).toBe('youMuted');
    expect(a.last('chat')!.line.sys).toBe('muted');
    // bb can't mute the owner; by name (a match's "/채금 aa") from a non-owner fails.
    await core.message(idb, JSON.stringify({ t: 'mute', name: 'aa', on: true }));
    expect(b.last('chat')!.line.sys).toBe('muteFail');
    await core.message(ida, JSON.stringify({ t: 'mute', name: 'bb', on: false }));
    await core.message(idb, JSON.stringify({ t: 'chat', text: 'back' }));
    expect(a.last('chat')!.line.text).toBe('back');
    // Chat off in the room's settings: nobody chats.
    await core.message(ida, JSON.stringify({ t: 'settings', settings: { ...settings, chat: false } }));
    await core.message(ida, JSON.stringify({ t: 'chat', text: 'hi' }));
    expect(a.last('chat')!.line.sys).toBe('chatOff');
  });

  it('admin: the key (with few tries), then bans, mutes, notices, closing rooms and words kept on disk', async () => {
    let saved: AdminData | null = null;
    const store = { load: () => saved, save: (d: AdminData) => void (saved = structuredClone(d)) };
    const core = new LobbyCore({ tagSecret: 'k', adminKey: 'the-admin-key-123', store });
    const adm = fake();
    const idm = core.open(adm.conn, undefined, '9.9.9.9');
    // Nothing without the key; a wrong key a few times, then the door stays shut.
    await core.message(idm, JSON.stringify({ t: 'adm', op: { op: 'refresh' } }));
    expect(adm.last('admState')).toBeUndefined();
    for (let i = 0; i < 5; i++) await core.message(idm, JSON.stringify({ t: 'adminAuth', key: `nope${i}` }));
    expect(adm.got.filter((m) => m.t === 'error' && m.code === 'password')).toHaveLength(5);
    await core.message(idm, JSON.stringify({ t: 'adminAuth', key: 'the-admin-key-123' }));
    expect(adm.last('error')!.code).toBe('rate');
    expect(adm.last('adminOk')).toBeUndefined();
    // From another address with the right key: in.
    const ad2 = fake();
    const id2 = core.open(ad2.conn, undefined, '8.8.8.8');
    await core.message(id2, JSON.stringify({ t: 'adminAuth', key: 'the-admin-key-123' }));
    expect(ad2.last('adminOk')).toBeDefined();
    // A player in a room: seen with a hashed address, never the address.
    const p = fake();
    let closed = false;
    p.conn.close = () => void (closed = true);
    const idp = core.open(p.conn, undefined, '1.2.3.4');
    await core.message(idp, JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'troll', uid: 'abcdef-01', device: 'desktop' }));
    await core.message(idp, JSON.stringify({ t: 'create', settings }));
    await core.message(idp, JSON.stringify({ t: 'chat', text: 'spam' }));
    await core.message(id2, JSON.stringify({ t: 'adm', op: { op: 'refresh' } }));
    const st = ad2.last('admState')!.state;
    expect(st.rooms[0]!.members[0]).toMatchObject({ name: 'troll' });
    expect(JSON.stringify(st)).not.toContain('1.2.3.4');
    expect(st.rooms[0]!.chat.some((l) => l.text === 'spam')).toBe(true);
    // A notice reaches everyone.
    await core.message(id2, JSON.stringify({ t: 'adm', op: { op: 'notice', text: '점검 10분 전' } }));
    expect(p.last('chat')!.line).toMatchObject({ sys: 'notice', text: '점검 10분 전', from: null });
    // A staff mute: no more chat anywhere.
    await core.message(id2, JSON.stringify({ t: 'adm', op: { op: 'mute', client: idp, minutes: 10 } }));
    await core.message(idp, JSON.stringify({ t: 'chat', text: 'more spam' }));
    expect(p.last('chat')!.line.sys).toBe('youMuted');
    // Words: masked in chat, kept on disk.
    await core.message(id2, JSON.stringify({ t: 'adm', op: { op: 'word', word: '바보', on: true } }));
    expect(saved!.words).toEqual(['바보']);
    // Close the room: out with a reason.
    await core.message(id2, JSON.stringify({ t: 'adm', op: { op: 'close', room: st.rooms[0]!.id } }));
    expect(p.last('left')!.reason).toBe('admin');
    expect(core.roomCount).toBe(0);
    // A ban: out now, and back neither from the same browser nor the same address (also after a restart).
    await core.message(id2, JSON.stringify({ t: 'adm', op: { op: 'ban', client: idp, minutes: 0, reason: '도배' } }));
    expect(closed).toBe(true);
    expect(p.last('error')).toMatchObject({ code: 'banned', detail: '도배' });
    const again = new LobbyCore({ tagSecret: 'k', adminKey: 'x'.repeat(20), store });
    for (const [uid, addr] of [['abcdef-02', '5.5.5.5'], ['zzzzzz-01', '1.2.3.4']] as const) {
      const q = fake();
      await again.message(again.open(q.conn, undefined, addr), JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'troll2', uid, device: 'desktop' }));
      expect(q.last('error')!.code).toBe('banned');
    }
    // Unbanned: back in.
    await core.message(id2, JSON.stringify({ t: 'adm', op: { op: 'unban', id: saved!.bans[0]!.id } }));
    const q = fake();
    await core.message(core.open(q.conn, undefined, '1.2.3.4'), JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'troll3', uid: 'abcdef-03', device: 'desktop' }));
    expect(q.last('welcome')).toBeDefined();
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
    server = await startGateway({ port: 0, host: '127.0.0.1', log: () => {}, tagSecret: 'test-key', adminKey: null, adminStore: null });
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

  const settings: RoomSettings = { name: '테스트', map: 'iron_gate', mode: 'zone', size: 24, lineup: 'users', difficulty: 'normal', input: 'all', botShare: true, teamPick: 'random', chat: true, simple: false };

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
