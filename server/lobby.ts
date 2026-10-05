/**
 * The lobby on the game server: names, the room list, passwords, room owners
 * and settings, the server-wide soldier cap, and handing rooms to their
 * matches (`MatchHost`): starting one, people joining one under way, and
 * keeping a seat for a minute when a connection drops mid-match so the same
 * browser (its hidden id) comes back to the same soldier.
 *
 * Transport-free (the gateway hands it text and binary messages and a way to
 * answer), so tests drive it directly. Started by Yoro on exp as the
 * signalling core for P2P; host picking, WebRTC set-up and TURN went when the
 * owner chose a server-authoritative design (2026-10-04).
 */
import {
  HUMAN_CAP,
  PROTOCOL_VERSION,
  SERVER_MAX,
  cleanName,
  cleanSettings,
  parseClientMsg,
  roomLoad,
  type ClientMsg,
  type Device,
  type ErrorCode,
  type Member,
  type Room,
  type RoomInfo,
  type RoomSettings,
  type ServerMsg,
} from '../src/net/lobbyProtocol.ts';

/** Messages a connection may send: a bucket of this many, refilled per second. */
const RATE = { burst: 120, perSecond: 60 } as const;
/** Binary frames (inputs: one a frame, ~60 a second) get their own bucket. */
const BIN_RATE = { burst: 240, perSecond: 150 } as const;
/** PBKDF2 rounds for room passwords (they guard a game room, not an account). */
const PBKDF2_ROUNDS = 50_000;
/** A seat is kept this long after a connection drops (ms). */
export const SEAT_GRACE = 60_000;

/** One end of a connection, whatever carries it. */
export interface Conn {
  send(text: string): void;
  binary?(data: Uint8Array): void;
  close(): void;
}

/** A player's line to a match: JSON news and binary snapshots. */
export interface MatchLine {
  text(msg: ServerMsg): void;
  binary(data: Uint8Array): void;
}

/** Runs the rooms' matches (the gateway's `Matches`; tests may leave it out). */
export interface MatchHost {
  /** Loads and starts a room's match with its members; rejects if it can't. */
  start(room: string, settings: RoomSettings, members: { uid: string; name: string; line: MatchLine }[]): Promise<void>;
  /** Someone joins a match under way, or comes back to their seat. */
  join(room: string, uid: string, name: string, line: MatchLine): void;
  /** Their connection dropped: the seat stays. */
  detach(room: string, uid: string): void;
  /** Gone for good. */
  leave(room: string, uid: string): void;
  /** The match is over or called off. */
  stop(room: string): void;
  message(room: string, uid: string, msg: Extract<ClientMsg, { t: 'ready' | 'deploy' | 'callin' }>): void;
  binary(room: string, uid: string, data: Uint8Array): void;
}

export interface LobbyOptions {
  log?: (line: string) => void;
  /** Rooms one address may hold at once (default `ROOMS_PER_ADDRESS`). */
  roomsPerAddress?: number;
  /** Soldiers the whole server takes, bots included (tests lower it). */
  serverMax?: number;
  matches?: MatchHost | null;
  now?: () => number;
}

interface Client {
  conn: Conn;
  id: string;
  name: string | null;
  device: Device;
  uid: string;
  room: string | null;
  /** On the room list page: gets the list pushed when it changes (no polling). */
  watching: boolean;
  tokens: number;
  lastRefill: number;
  binTokens: number;
  lastBinRefill: number;
  /** Connection gone mid-match: the seat waits until then (ms) for the same uid. */
  awayUntil: number | null;
  /** Messages refused (flooding, malformed): too many and the connection is dropped. */
  strikes: number;
  /** The visitor's address (per-address limits, bans). */
  addr: string;
  /** Wrong room passwords lately (ms timestamps). */
  passwordTries: number[];
}

/** Rooms one address may have open at once (each started one builds a whole map on the server). */
const ROOMS_PER_ADDRESS = 2;
/** Password tries a connection gets a minute, and a room gets a minute from everyone (no guessing). */
const PASSWORD_TRIES = { client: 5, room: 20, windowMs: 60_000 } as const;
/** A room may start its match again only this long after the last start (each start builds the map). */
const START_COOLDOWN_MS = 20_000;
/** Kicked by the anticheat: kept out of that room this long. */
const BAN_MS = 30 * 60_000;

/** Refused messages before a connection is dropped. */
const STRIKES_MAX = 40;

interface RoomRec {
  id: string;
  settings: RoomSettings;
  /** PBKDF2-SHA256, hex. */
  password: { salt: string; hash: string } | null;
  state: 'lobby' | 'playing';
  owner: string;
  /** Member ids in join order. */
  members: string[];
  /** Wrong passwords lately from anyone (ms timestamps). */
  passwordTries: number[];
  /** When its match last started (ms). */
  startedAt: number;
  /** Uids and addresses the anticheat put out of this room, until when (ms). */
  banned: Map<string, number>;
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return hex(b);
}

async function pbkdf2(pw: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ROUNDS }, key, 256);
  return hex(new Uint8Array(bits));
}

/** Compares in time independent of where the strings differ. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const humanCap = (s: RoomSettings): number => Math.min(HUMAN_CAP, s.size);

export class LobbyCore {
  private readonly clients = new Map<string, Client>();
  private readonly rooms = new Map<string, RoomRec>();
  /** The room list as last pushed to watchers (JSON), to push only changes. */
  private lastList = '';
  private readonly log: (line: string) => void;
  private readonly serverMax: number;
  private readonly matches: MatchHost | null;
  private readonly now: () => number;

  constructor(private readonly opts: LobbyOptions = {}) {
    this.log = opts.log ?? (() => {});
    this.serverMax = opts.serverMax ?? SERVER_MAX;
    this.matches = opts.matches ?? null;
    this.now = opts.now ?? Date.now;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get clientCount(): number {
    let n = 0;
    for (const c of this.clients.values()) if (c.awayUntil === null) n++;
    return n;
  }

  /** Soldiers on the server now (people and the bots their rooms fill up with). */
  get load(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += roomLoad(r.settings, r.members.length);
    return n;
  }

  // ---------------------------------------------------------------------------
  // Connections

  /** A new connection; returns its client id. */
  open(conn: Conn, id = randomHex(4), addr = ''): string {
    const now = this.now();
    this.clients.set(id, { conn, id, name: null, device: 'desktop', uid: '', room: null, watching: false, tokens: RATE.burst, lastRefill: now, binTokens: BIN_RATE.burst, lastBinRefill: now, awayUntil: null, strikes: 0, addr, passwordTries: [] });
    return id;
  }

  /**
   * The anticheat put a player out of a room's match: out of the room, and
   * kept out of it (by uid and address) for a while.
   */
  kick(roomId: string, uid: string, reason: string): void {
    const r = this.rooms.get(roomId);
    if (!r) return;
    const c = r.members.map((id) => this.clients.get(id)).find((x) => x?.uid === uid);
    const until = this.now() + BAN_MS;
    r.banned.set(`uid:${uid}`, until);
    if (c?.addr) r.banned.set(`addr:${c.addr}`, until);
    this.log(`anticheat: ${c?.name ?? '?'} (${uid.slice(0, 8)}) out of room ${roomId}: ${reason}`);
    if (!c) return;
    this.send(c, { t: 'error', code: 'banned', detail: reason });
    this.leaveRoom(c, 'kicked');
    this.pushList();
  }

  private isBanned(r: RoomRec, c: Client): boolean {
    const now = this.now();
    for (const [k, until] of r.banned) if (until <= now) r.banned.delete(k);
    return r.banned.has(`uid:${c.uid}`) || (!!c.addr && r.banned.has(`addr:${c.addr}`));
  }

  /** A wrong password: counted for the connection and the room; true while either may still try. */
  private passwordTry(c: Client, r: RoomRec): boolean {
    const now = this.now();
    const fresh = (list: number[]) => list.filter((t) => now - t < PASSWORD_TRIES.windowMs);
    c.passwordTries = fresh(c.passwordTries);
    r.passwordTries = fresh(r.passwordTries);
    return c.passwordTries.length < PASSWORD_TRIES.client && r.passwordTries.length < PASSWORD_TRIES.room;
  }

  /**
   * The connection closed. In a room the seat stays for `SEAT_GRACE` (mid-match
   * the soldier too), so a reload or a dropped line comes back to it.
   */
  close(id: string): void {
    const c = this.clients.get(id);
    if (!c || c.awayUntil !== null) return;
    const r = c.room ? this.rooms.get(c.room) : undefined;
    if (r && c.uid) {
      c.awayUntil = this.now() + SEAT_GRACE;
      c.watching = false;
      if (r.state === 'playing') this.matches?.detach(r.id, c.uid);
      if (r.owner === c.id) r.owner = this.firstHere(r) ?? r.owner;
      this.broadcast(r);
      this.pushList();
      return;
    }
    this.leaveRoom(c, 'closed');
    this.clients.delete(id);
    this.pushList();
  }

  /** Drops seats nobody came back to (call every few seconds). */
  sweep(): void {
    const now = this.now();
    for (const c of [...this.clients.values()]) {
      if (c.awayUntil === null || c.awayUntil > now) continue;
      this.leaveRoom(c, 'closed');
      this.clients.delete(c.id);
    }
    this.pushList();
  }

  /** A text message from a client. */
  async message(id: string, text: string): Promise<void> {
    const c = this.clients.get(id);
    if (!c || c.awayUntil !== null) return;
    if (!this.allowed(c)) return this.strike(c, 'rate');
    const msg = parseClientMsg(text);
    if (!msg) return this.strike(c, 'bad');
    try {
      await this.handle(c, msg);
      this.pushList();
    } catch (err) {
      this.log(`error: ${String(err)}`);
    }
  }

  /** A binary frame from a client: match data for the room it plays in. */
  binary(id: string, data: Uint8Array): void {
    const c = this.clients.get(id);
    if (!c || c.awayUntil !== null || !c.room || !this.matches) return;
    const r = this.rooms.get(c.room);
    if (!r || r.state !== 'playing') return;
    const now = this.now();
    c.binTokens = Math.min(BIN_RATE.burst, c.binTokens + ((now - c.lastBinRefill) / 1000) * BIN_RATE.perSecond);
    c.lastBinRefill = now;
    if (c.binTokens < 1) return this.strike(c, null);
    c.binTokens -= 1;
    this.matches.binary(r.id, c.uid, data);
  }

  /** A room's match is over: back to the waiting room. */
  matchOver(roomId: string): void {
    const r = this.rooms.get(roomId);
    if (!r || r.state !== 'playing') return;
    r.state = 'lobby';
    this.matches?.stop(r.id);
    this.broadcast(r);
    this.pushList();
  }

  // ---------------------------------------------------------------------------

  private send(c: Client, msg: ServerMsg): void {
    if (c.awayUntil !== null) return;
    try {
      c.conn.send(JSON.stringify(msg));
    } catch {
      /* closed meanwhile: its close event cleans up */
    }
  }

  private lineOf(c: Client): MatchLine {
    return {
      text: (msg) => this.send(c, msg),
      binary: (data) => {
        if (c.awayUntil !== null) return;
        try {
          c.conn.binary?.(data);
        } catch {
          /* closed meanwhile */
        }
      },
    };
  }

  /** A refused message; past `STRIKES_MAX` the connection is dropped (its seat waits as for any drop). */
  private strike(c: Client, code: ErrorCode | null): void {
    c.strikes++;
    if (code) this.fail(c, code);
    if (c.strikes === STRIKES_MAX) {
      this.log(`dropping ${c.id} (${c.name ?? '?'}): too many refused messages`);
      c.conn.close();
    }
  }

  private fail(c: Client, code: ErrorCode, detail?: string): void {
    this.send(c, { t: 'error', code, detail });
  }

  private allowed(c: Client): boolean {
    const now = this.now();
    c.tokens = Math.min(RATE.burst, c.tokens + ((now - c.lastRefill) / 1000) * RATE.perSecond);
    c.lastRefill = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  }

  private member(id: string): Member {
    const c = this.clients.get(id);
    const m: Member = { id, name: c?.name ?? '?', device: c?.device ?? 'desktop' };
    if (c?.awayUntil != null) m.away = true;
    return m;
  }

  private info(r: RoomRec): RoomInfo {
    return { id: r.id, settings: r.settings, locked: r.password !== null, state: r.state, humans: r.members.length, humanCap: humanCap(r.settings) };
  }

  private view(r: RoomRec): Room {
    return { ...this.info(r), owner: r.owner, members: r.members.map((id) => this.member(id)) };
  }

  private broadcast(r: RoomRec): void {
    const msg: ServerMsg = { t: 'room', room: this.view(r) };
    for (const id of r.members) {
      const c = this.clients.get(id);
      if (c) this.send(c, msg);
    }
  }

  /** The first member still connected. */
  private firstHere(r: RoomRec): string | null {
    return r.members.find((m) => this.clients.get(m)?.awayUntil === null) ?? null;
  }

  /** Whether the server can take `extra` more soldiers. */
  private fits(extra: number): boolean {
    return extra <= 0 || this.load + extra <= this.serverMax;
  }

  /** Takes a member out of a room (no messages); closes the room when nobody connected is left. */
  private removeMember(r: RoomRec, id: string): void {
    r.members = r.members.filter((m) => m !== id);
    const here = this.firstHere(r);
    if (!here) {
      for (const m of r.members) this.clients.delete(m);
      this.rooms.delete(r.id);
      if (r.state === 'playing') this.matches?.stop(r.id);
      this.log(`room ${r.id} closed`);
      return;
    }
    if (r.owner === id || this.clients.get(r.owner)?.awayUntil != null) r.owner = here;
  }

  private leaveRoom(c: Client, reason: 'leave' | 'kicked' | 'closed'): void {
    const r = c.room ? this.rooms.get(c.room) : undefined;
    c.room = null;
    if (!r) return;
    if (reason !== 'closed') this.send(c, { t: 'left', reason });
    if (r.state === 'playing') this.matches?.leave(r.id, c.uid);
    this.removeMember(r, c.id);
    if (this.rooms.has(r.id)) this.broadcast(r);
  }

  private uniqueName(r: RoomRec, name: string): string {
    const taken = new Set(r.members.map((id) => this.clients.get(id)?.name));
    if (!taken.has(name)) return name;
    for (let i = 2; ; i++) {
      const tail = String(i);
      const n = name.slice(0, 16 - tail.length) + tail;
      if (!taken.has(n)) return n;
    }
  }

  private joinRoom(c: Client, r: RoomRec): void {
    c.name = this.uniqueName(r, c.name!);
    c.room = r.id;
    c.watching = false;
    r.members.push(c.id);
    this.broadcast(r);
    if (r.state === 'playing') this.matches?.join(r.id, c.uid, c.name!, this.lineOf(c));
  }

  /**
   * Right after hello: back to a seat this browser tab held a moment ago (same
   * uid), no password asked; mid-match to the same soldier.
   */
  private rejoin(c: Client): void {
    const now = this.now();
    for (const old of this.clients.values()) {
      if (old === c || old.uid !== c.uid || old.awayUntil === null || old.awayUntil <= now) continue;
      const r = old.room ? this.rooms.get(old.room) : undefined;
      if (!r) break;
      c.name = old.name;
      c.room = r.id;
      r.members = r.members.map((m) => (m === old.id ? c.id : m));
      if (r.owner === old.id || this.clients.get(r.owner)?.awayUntil != null) r.owner = c.id;
      this.clients.delete(old.id);
      this.broadcast(r);
      if (r.state === 'playing') this.matches?.join(r.id, c.uid, c.name!, this.lineOf(c));
      return;
    }
  }

  private async handle(c: Client, msg: ClientMsg): Promise<void> {
    if (msg.t === 'hello') {
      if (msg.v !== PROTOCOL_VERSION) return this.fail(c, 'version', String(PROTOCOL_VERSION));
      const name = cleanName(msg.name);
      if (!name) return this.fail(c, 'name');
      if (c.name) return this.fail(c, 'bad', 'hello again');
      c.name = name;
      c.uid = msg.uid;
      c.device = msg.device;
      this.send(c, { t: 'welcome', id: c.id, name });
      if (c.uid) this.rejoin(c);
      return;
    }
    if (msg.t === 'ping') return this.send(c, { t: 'pong', at: msg.at });
    if (!c.name) return this.fail(c, 'bad', 'hello first');
    const r = c.room ? this.rooms.get(c.room) : undefined;
    switch (msg.t) {
      case 'list':
        c.watching = !r;
        return this.send(c, { t: 'rooms', rooms: this.roomList() });
      case 'create': {
        if (r) return this.fail(c, 'busy');
        const settings = cleanSettings(msg.settings);
        if (!settings) return this.fail(c, 'bad', 'settings');
        // A few rooms per address: each one started builds a whole map on the server.
        let mine = 0;
        for (const x of this.rooms.values()) if (c.addr && this.clients.get(x.owner)?.addr === c.addr) mine++;
        if (mine >= (this.opts.roomsPerAddress ?? ROOMS_PER_ADDRESS)) return this.fail(c, 'busy', 'rooms');
        if (!this.fits(roomLoad(settings, 1))) return this.fail(c, 'serverFull');
        let password: RoomRec['password'] = null;
        if (msg.password) {
          const salt = randomHex(16);
          password = { salt, hash: await pbkdf2(msg.password, salt) };
          if (!this.still(c)) return;
        }
        const rec: RoomRec = { id: randomHex(3), settings, password, state: 'lobby', owner: c.id, members: [], passwordTries: [], startedAt: -Infinity, banned: new Map() };
        this.rooms.set(rec.id, rec);
        this.log(`room ${rec.id} "${settings.name}" by ${c.name}`);
        return this.joinRoom(c, rec);
      }
      case 'join': {
        if (r) return this.fail(c, 'busy');
        const rec = this.rooms.get(msg.room);
        if (!rec) return this.fail(c, 'noRoom');
        if (this.isBanned(rec, c)) return this.fail(c, 'banned');
        if (rec.password) {
          // A handful of tries a minute (each costs a hash): no guessing passwords.
          if (!this.passwordTry(c, rec)) return this.strike(c, 'rate');
          if (msg.password === undefined || !sameHex(await pbkdf2(msg.password, rec.password.salt), rec.password.hash)) {
            const now = this.now();
            c.passwordTries.push(now);
            rec.passwordTries.push(now);
            return this.fail(c, 'password');
          }
        }
        if (!this.still(c)) return;
        if (!this.rooms.has(rec.id)) return this.fail(c, 'noRoom');
        if (rec.members.length >= humanCap(rec.settings)) return this.fail(c, 'full');
        if (rec.settings.input !== 'all' && rec.settings.input !== c.device) return this.fail(c, 'full', 'input');
        const n = rec.members.length;
        if (!this.fits(roomLoad(rec.settings, n + 1) - roomLoad(rec.settings, n))) return this.fail(c, 'serverFull');
        return this.joinRoom(c, rec);
      }
      case 'leave':
        if (!r) return this.fail(c, 'notInRoom');
        return this.leaveRoom(c, 'leave');
      case 'settings': {
        if (!r) return this.fail(c, 'notInRoom');
        if (r.owner !== c.id) return this.fail(c, 'notOwner');
        if (r.state !== 'lobby') return this.fail(c, 'busy');
        const settings = cleanSettings(msg.settings);
        if (!settings || settings.size < r.members.length) return this.fail(c, 'bad', 'settings');
        const n = r.members.length;
        if (!this.fits(roomLoad(settings, n) - roomLoad(r.settings, n))) return this.fail(c, 'serverFull');
        r.settings = settings;
        return this.broadcast(r);
      }
      case 'start': {
        if (!r) return this.fail(c, 'notInRoom');
        if (r.owner !== c.id) return this.fail(c, 'notOwner');
        if (r.state !== 'lobby') return this.fail(c, 'busy');
        if (this.now() - r.startedAt < START_COOLDOWN_MS) return this.fail(c, 'rate');
        r.startedAt = this.now();
        r.state = 'playing';
        this.log(`room ${r.id} starts`);
        this.broadcast(r);
        if (!this.matches) return;
        const members = r.members.map((id) => this.clients.get(id)!).filter((m) => m && m.awayUntil === null);
        try {
          await this.matches.start(
            r.id,
            r.settings,
            members.map((m) => ({ uid: m.uid, name: m.name!, line: this.lineOf(m) })),
          );
        } catch (err) {
          this.log(`room ${r.id} could not start: ${String(err)}`);
          if (this.rooms.get(r.id) === r) {
            r.state = 'lobby';
            this.broadcast(r);
          }
          // The machine is busy with the matches already running: like a full server.
          return this.fail(c, err instanceof Error && err.message === 'busy' ? 'serverFull' : 'bad', 'start');
        }
        // Someone may have left while it loaded, or everyone did.
        if (this.rooms.get(r.id) !== r) this.matches.stop(r.id);
        return;
      }
      case 'end':
        if (!r) return this.fail(c, 'notInRoom');
        if (r.owner !== c.id) return this.fail(c, 'notOwner');
        return this.matchOver(r.id);
      case 'kick': {
        if (!r) return this.fail(c, 'notInRoom');
        if (r.owner !== c.id) return this.fail(c, 'notOwner');
        const target = msg.member !== c.id && r.members.includes(msg.member) ? this.clients.get(msg.member) : undefined;
        if (!target) return;
        if (target.awayUntil !== null) {
          this.leaveRoom(target, 'closed');
          this.clients.delete(target.id);
        } else this.leaveRoom(target, 'kicked');
        return;
      }
      case 'ready':
      case 'deploy':
      case 'callin':
        if (!r || r.state !== 'playing') return;
        return this.matches?.message(r.id, c.uid, msg);
    }
  }

  /**
   * After waiting on a password hash: whether the client is still connected
   * and still outside a room (a second message may have got in meanwhile).
   */
  private still(c: Client): boolean {
    if (this.clients.get(c.id) !== c || c.awayUntil !== null) return false;
    if (!c.room) return true;
    this.fail(c, 'busy');
    return false;
  }

  private roomList(): RoomInfo[] {
    return [...this.rooms.values()].map((x) => this.info(x));
  }

  /** Sends the room list to everyone on the list page when it changed. */
  private pushList(): void {
    const rooms = this.roomList();
    const text = JSON.stringify(rooms);
    if (text === this.lastList) return;
    this.lastList = text;
    for (const c of this.clients.values()) if (c.watching && !c.room) this.send(c, { t: 'rooms', rooms });
  }
}
