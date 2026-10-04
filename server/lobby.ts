/**
 * The lobby on the game server: names, the room list, passwords, room owners
 * and settings, and the server-wide soldier cap. Matches will run beside it in
 * the same process (a worker per room), which is why the room list lives on
 * the owner's server rather than somewhere else.
 *
 * Transport-free (the gateway hands it text messages and a way to answer), so
 * tests drive it directly. Started by Yoro on exp as the signalling core for
 * P2P; host picking, WebRTC set-up and TURN went when the owner chose a
 * server-authoritative design (2026-10-04).
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
/** PBKDF2 rounds for room passwords (they guard a game room, not an account). */
const PBKDF2_ROUNDS = 50_000;

/** One end of a connection, whatever carries it. */
export interface Conn {
  send(text: string): void;
  close(): void;
}

export interface LobbyOptions {
  log?: (line: string) => void;
  /** Soldiers the whole server takes, bots included (tests lower it). */
  serverMax?: number;
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
}

interface RoomRec {
  id: string;
  settings: RoomSettings;
  /** PBKDF2-SHA256, hex. */
  password: { salt: string; hash: string } | null;
  state: 'lobby' | 'playing';
  owner: string;
  /** Member ids in join order. */
  members: string[];
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

  constructor(opts: LobbyOptions = {}) {
    this.log = opts.log ?? (() => {});
    this.serverMax = opts.serverMax ?? SERVER_MAX;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get clientCount(): number {
    return this.clients.size;
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
  open(conn: Conn, id = randomHex(4)): string {
    this.clients.set(id, { conn, id, name: null, device: 'desktop', uid: '', room: null, watching: false, tokens: RATE.burst, lastRefill: Date.now() });
    return id;
  }

  /** The connection closed. */
  close(id: string): void {
    const c = this.clients.get(id);
    if (!c) return;
    this.leaveRoom(c, 'closed');
    this.clients.delete(id);
    this.pushList();
  }

  /** A text message from a client. */
  async message(id: string, text: string): Promise<void> {
    const c = this.clients.get(id);
    if (!c) return;
    if (!this.allowed(c)) return this.fail(c, 'rate');
    const msg = parseClientMsg(text);
    if (!msg) return this.fail(c, 'bad');
    try {
      await this.handle(c, msg);
      this.pushList();
    } catch (err) {
      this.log(`error: ${String(err)}`);
    }
  }

  // ---------------------------------------------------------------------------

  private send(c: Client, msg: ServerMsg): void {
    try {
      c.conn.send(JSON.stringify(msg));
    } catch {
      /* closed meanwhile: its close event cleans up */
    }
  }

  private fail(c: Client, code: ErrorCode, detail?: string): void {
    this.send(c, { t: 'error', code, detail });
  }

  private allowed(c: Client): boolean {
    const now = Date.now();
    c.tokens = Math.min(RATE.burst, c.tokens + ((now - c.lastRefill) / 1000) * RATE.perSecond);
    c.lastRefill = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  }

  private member(id: string): Member {
    const c = this.clients.get(id);
    return { id, name: c?.name ?? '?', device: c?.device ?? 'desktop' };
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

  /** Whether the server can take `extra` more soldiers. */
  private fits(extra: number): boolean {
    return extra <= 0 || this.load + extra <= this.serverMax;
  }

  /** Takes a member out of a room (no messages); closes the room when empty. */
  private removeMember(r: RoomRec, id: string): void {
    r.members = r.members.filter((m) => m !== id);
    if (!r.members.length) {
      this.rooms.delete(r.id);
      this.log(`room ${r.id} closed`);
      return;
    }
    if (r.owner === id) r.owner = r.members[0]!;
  }

  private leaveRoom(c: Client, reason: 'leave' | 'kicked' | 'closed'): void {
    const r = c.room ? this.rooms.get(c.room) : undefined;
    c.room = null;
    if (!r) return;
    if (reason !== 'closed') this.send(c, { t: 'left', reason });
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
  }

  private async handle(c: Client, msg: ClientMsg): Promise<void> {
    if (msg.t === 'hello') {
      if (msg.v !== PROTOCOL_VERSION) return this.fail(c, 'version', String(PROTOCOL_VERSION));
      const name = cleanName(msg.name);
      if (!name) return this.fail(c, 'name');
      c.name = name;
      c.uid = msg.uid;
      c.device = msg.device;
      return this.send(c, { t: 'welcome', id: c.id, name });
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
        if (!this.fits(roomLoad(settings, 1))) return this.fail(c, 'serverFull');
        let password: RoomRec['password'] = null;
        if (msg.password) {
          const salt = randomHex(16);
          password = { salt, hash: await pbkdf2(msg.password, salt) };
          if (!this.still(c)) return;
        }
        const rec: RoomRec = { id: randomHex(3), settings, password, state: 'lobby', owner: c.id, members: [] };
        this.rooms.set(rec.id, rec);
        this.log(`room ${rec.id} "${settings.name}" by ${c.name}`);
        return this.joinRoom(c, rec);
      }
      case 'join': {
        if (r) return this.fail(c, 'busy');
        const rec = this.rooms.get(msg.room);
        if (!rec) return this.fail(c, 'noRoom');
        if (rec.password && (msg.password === undefined || !sameHex(await pbkdf2(msg.password, rec.password.salt), rec.password.hash))) return this.fail(c, 'password');
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
      case 'start':
        if (!r) return this.fail(c, 'notInRoom');
        if (r.owner !== c.id) return this.fail(c, 'notOwner');
        if (r.state !== 'lobby') return this.fail(c, 'busy');
        r.state = 'playing';
        this.log(`room ${r.id} starts`);
        return this.broadcast(r);
      case 'end':
        if (!r) return this.fail(c, 'notInRoom');
        if (r.owner !== c.id) return this.fail(c, 'notOwner');
        r.state = 'lobby';
        return this.broadcast(r);
      case 'kick': {
        if (!r) return this.fail(c, 'notInRoom');
        if (r.owner !== c.id) return this.fail(c, 'notOwner');
        const target = msg.member !== c.id && r.members.includes(msg.member) ? this.clients.get(msg.member) : undefined;
        if (target) this.leaveRoom(target, 'kicked');
        return;
      }
    }
  }

  /**
   * After waiting on a password hash: whether the client is still connected
   * and still outside a room (a second message may have got in meanwhile).
   */
  private still(c: Client): boolean {
    if (this.clients.get(c.id) !== c) return false;
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
