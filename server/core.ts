/**
 * The signalling logic: names, the room list, passwords, picking the host PC,
 * and passing WebRTC set-up messages between members of a room. Match data
 * never comes through here (it goes peer to peer).
 *
 * Transport-free so it runs in Node (`signal.ts`, local development and tests)
 * and in a Cloudflare Durable Object (`worker.ts`, the deployed server). The
 * object may sleep between messages and lose its memory, so all state can be
 * written out (`snapshot`) and read back (`restore`). Uses only web APIs
 * (WebCrypto, fetch), no Node modules.
 */
import {
  HUMAN_CAP,
  SIGNAL_VERSION,
  cleanName,
  cleanReport,
  cleanSettings,
  parseClientMsg,
  type ClientMsg,
  type Device,
  type ErrorCode,
  type IceServer,
  type Member,
  type Report,
  type Room,
  type RoomInfo,
  type RoomSettings,
  type ServerMsg,
} from '../src/net/signalProtocol.ts';
import { pickCandidates, pickHost } from '../src/net/hostScore.ts';

/** Messages a connection may send: a bucket of this many, refilled per second. */
const RATE = { burst: 120, perSecond: 60 } as const;
/** Members who must call the host lost (share of the others) before the backup takes over. */
const HOST_LOST_SHARE = 0.5;
const HOST_LOST_WINDOW_MS = 10_000;
/**
 * PBKDF2 rounds for room passwords. Low on purpose: a Workers Free request
 * gets 10 ms of CPU, and these guard a game room, not an account.
 */
const PBKDF2_ROUNDS = 5000;

/** One end of a connection, whatever carries it. */
export interface Conn {
  send(text: string): void;
  close(): void;
}

export interface CoreOptions {
  iceServers: () => Promise<IceServer[]>;
  log?: (line: string) => void;
}

interface Client {
  conn: Conn;
  id: string;
  name: string | null;
  device: Device;
  uid: string;
  room: string | null;
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
  host: string | null;
  backup: string | null;
  candidates: string[];
  reports: Record<string, Report>;
  /** Who said the host is gone, and when (ms). */
  hostLost: Record<string, number>;
}

/** Everything the core keeps, as plain JSON. */
export interface CoreState {
  clients: Omit<Client, 'conn'>[];
  rooms: RoomRec[];
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

export class SignalCore {
  private readonly clients = new Map<string, Client>();
  private readonly rooms = new Map<string, RoomRec>();
  private readonly iceServers: () => Promise<IceServer[]>;
  private readonly log: (line: string) => void;

  constructor(opts: CoreOptions) {
    this.iceServers = opts.iceServers;
    this.log = opts.log ?? (() => {});
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  // ---------------------------------------------------------------------------
  // State in and out

  snapshot(): CoreState {
    return {
      clients: [...this.clients.values()].map(({ conn: _conn, ...rest }) => rest),
      rooms: [...this.rooms.values()],
    };
  }

  /**
   * Reads saved state back after the host process slept. `conns` maps the
   * client ids whose connections are still open; anyone else is treated as
   * gone (left their room).
   */
  restore(state: CoreState, conns: ReadonlyMap<string, Conn>): void {
    this.clients.clear();
    this.rooms.clear();
    for (const c of state.clients) {
      const conn = conns.get(c.id);
      if (conn) this.clients.set(c.id, { ...c, conn });
    }
    for (const r of state.rooms) this.rooms.set(r.id, r);
    for (const r of [...this.rooms.values()]) {
      for (const id of [...r.members]) if (!this.clients.has(id)) this.removeMember(r, id);
    }
    // Connections the saved state doesn't know (opened just before a save was lost): fresh clients.
    for (const [id, conn] of conns) if (!this.clients.has(id)) this.clients.set(id, this.newClient(id, conn));
  }

  // ---------------------------------------------------------------------------
  // Connections

  private newClient(id: string, conn: Conn): Client {
    return { conn, id, name: null, device: 'desktop', uid: '', room: null, tokens: RATE.burst, lastRefill: Date.now() };
  }

  /** A new connection; returns its client id. */
  open(conn: Conn, id = randomHex(4)): string {
    this.clients.set(id, this.newClient(id, conn));
    return id;
  }

  /** The connection closed. Returns true when the state changed. */
  close(id: string): boolean {
    const c = this.clients.get(id);
    if (!c) return false;
    this.leaveRoom(c, 'closed');
    this.clients.delete(id);
    return true;
  }

  /** A text message from a client. Resolves true when the state changed (worth saving). */
  async message(id: string, text: string): Promise<boolean> {
    const c = this.clients.get(id);
    if (!c) return false;
    if (!this.allowed(c)) {
      this.fail(c, 'rate');
      return false;
    }
    const msg = parseClientMsg(text);
    if (!msg) {
      this.fail(c, 'bad');
      return false;
    }
    try {
      return await this.handle(c, msg);
    } catch (err) {
      this.log(`error: ${String(err)}`);
      return false;
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
    return { ...this.info(r), owner: r.owner, members: r.members.map((id) => this.member(id)), host: r.host, backup: r.backup, candidates: r.candidates };
  }

  private broadcast(r: RoomRec): void {
    const msg: ServerMsg = { t: 'room', room: this.view(r) };
    for (const id of r.members) {
      const c = this.clients.get(id);
      if (c) this.send(c, msg);
    }
  }

  private reportMap(r: RoomRec): Map<string, Report> {
    return new Map(Object.entries(r.reports));
  }

  /** Re-picks candidates, and the host while waiting (in a match the host stays until it's lost). */
  private repick(r: RoomRec): void {
    const members = r.members.map((id) => this.member(id));
    const reports = this.reportMap(r);
    const present = (id: string | null): boolean => !!id && r.members.includes(id);
    r.candidates = pickCandidates(members, reports, r.owner);
    if (r.state === 'lobby') {
      const pick = pickHost(members, reports, r.owner);
      r.host = pick.host;
      r.backup = pick.backup;
      return;
    }
    if (!present(r.host)) r.host = r.backup;
    if (!present(r.host)) r.host = pickHost(members, reports, r.owner).host;
    if (!present(r.backup) || r.backup === r.host) {
      r.backup = pickHost(
        members.filter((m) => m.id !== r.host),
        reports,
        r.owner,
      ).host;
    }
  }

  /** Promotes the backup in a running match. */
  private promoteBackup(r: RoomRec, why: string): void {
    this.log(`room ${r.id}: host ${r.host} lost (${why}), backup ${r.backup} takes over`);
    r.host = r.backup;
    r.backup = null;
    r.hostLost = {};
    this.repick(r);
  }

  /** Takes a member out of a room's lists (no messages); closes the room when empty. */
  private removeMember(r: RoomRec, id: string): void {
    r.members = r.members.filter((m) => m !== id);
    delete r.reports[id];
    delete r.hostLost[id];
    for (const rep of Object.values(r.reports)) delete rep.links[id];
    if (!r.members.length) {
      this.rooms.delete(r.id);
      this.log(`room ${r.id} closed`);
      return;
    }
    if (r.owner === id) r.owner = r.members[0]!;
    if (r.state === 'playing' && r.host === id) this.promoteBackup(r, 'left');
    else this.repick(r);
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
    r.members.push(c.id);
    this.repick(r);
    this.broadcast(r);
  }

  private async handle(c: Client, msg: ClientMsg): Promise<boolean> {
    if (msg.t === 'hello') {
      if (msg.v !== SIGNAL_VERSION) {
        this.fail(c, 'version', String(SIGNAL_VERSION));
        return false;
      }
      const name = cleanName(msg.name);
      if (!name) {
        this.fail(c, 'name');
        return false;
      }
      c.name = name;
      c.uid = msg.uid;
      c.device = msg.device;
      this.send(c, { t: 'welcome', id: c.id, name, ice: await this.iceServers() });
      return true;
    }
    if (!c.name) {
      this.fail(c, 'bad', 'hello first');
      return false;
    }
    const r = c.room ? this.rooms.get(c.room) : undefined;
    switch (msg.t) {
      case 'list':
        this.send(c, { t: 'rooms', rooms: [...this.rooms.values()].map((x) => this.info(x)) });
        return false;
      case 'create': {
        if (r) return this.no(c, 'busy');
        const settings = cleanSettings(msg.settings);
        if (!settings) return this.no(c, 'bad', 'settings');
        let password: RoomRec['password'] = null;
        if (msg.password) {
          const salt = randomHex(16);
          password = { salt, hash: await pbkdf2(msg.password, salt) };
        }
        const rec: RoomRec = { id: randomHex(3), settings, password, state: 'lobby', owner: c.id, members: [], host: null, backup: null, candidates: [], reports: {}, hostLost: {} };
        this.rooms.set(rec.id, rec);
        this.log(`room ${rec.id} "${settings.name}" by ${c.name}`);
        this.joinRoom(c, rec);
        return true;
      }
      case 'join': {
        if (r) return this.no(c, 'busy');
        const rec = this.rooms.get(msg.room);
        if (!rec) return this.no(c, 'noRoom');
        if (rec.password && (msg.password === undefined || !sameHex(await pbkdf2(msg.password, rec.password.salt), rec.password.hash))) return this.no(c, 'password');
        if (rec.members.length >= humanCap(rec.settings)) return this.no(c, 'full');
        if (rec.settings.input !== 'all' && rec.settings.input !== c.device) return this.no(c, 'full', 'input');
        this.joinRoom(c, rec);
        return true;
      }
      case 'leave':
        if (!r) return this.no(c, 'notInRoom');
        this.leaveRoom(c, 'leave');
        return true;
      case 'settings': {
        if (!r) return this.no(c, 'notInRoom');
        if (r.owner !== c.id) return this.no(c, 'notOwner');
        if (r.state !== 'lobby') return this.no(c, 'busy');
        const settings = cleanSettings(msg.settings);
        if (!settings || settings.size < r.members.length) return this.no(c, 'bad', 'settings');
        r.settings = settings;
        this.broadcast(r);
        return true;
      }
      case 'start':
        if (!r) return this.no(c, 'notInRoom');
        if (r.owner !== c.id) return this.no(c, 'notOwner');
        if (r.state !== 'lobby') return this.no(c, 'busy');
        this.repick(r);
        r.state = 'playing';
        this.log(`room ${r.id} starts, host ${r.host}, backup ${r.backup}`);
        this.broadcast(r);
        return true;
      case 'end':
        if (!r) return this.no(c, 'notInRoom');
        if (r.owner !== c.id && r.host !== c.id) return this.no(c, 'notOwner');
        r.state = 'lobby';
        r.hostLost = {};
        this.repick(r);
        this.broadcast(r);
        return true;
      case 'kick': {
        if (!r) return this.no(c, 'notInRoom');
        if (r.owner !== c.id) return this.no(c, 'notOwner');
        const target = msg.member !== c.id && r.members.includes(msg.member) ? this.clients.get(msg.member) : undefined;
        if (!target) return false;
        this.leaveRoom(target, 'kicked');
        return true;
      }
      case 'report': {
        if (!r) return this.no(c, 'notInRoom');
        const report = cleanReport(msg.report);
        if (!report) return this.no(c, 'bad', 'report');
        // Only links to members of this room count.
        for (const peer of Object.keys(report.links)) if (!r.members.includes(peer)) delete report.links[peer];
        r.reports[c.id] = report;
        const before = `${r.host}/${r.backup}/${r.candidates.join()}`;
        this.repick(r);
        if (`${r.host}/${r.backup}/${r.candidates.join()}` !== before) this.broadcast(r);
        return true;
      }
      case 'hostLost': {
        if (!r || r.state !== 'playing' || !r.host || r.host === c.id) return false;
        const now = Date.now();
        r.hostLost[c.id] = now;
        for (const [id, at] of Object.entries(r.hostLost)) if (now - at > HOST_LOST_WINDOW_MS) delete r.hostLost[id];
        const others = r.members.length - 1;
        const lost = Object.keys(r.hostLost).length;
        if (lost >= Math.max(1, Math.ceil(others * HOST_LOST_SHARE))) {
          this.promoteBackup(r, `${lost} of ${others} lost it`);
          this.broadcast(r);
        }
        return true;
      }
      case 'signal': {
        if (!r) return this.no(c, 'notInRoom');
        const to = r.members.includes(msg.to) ? this.clients.get(msg.to) : undefined;
        if (!to) return this.no(c, 'noRoom', 'peer');
        this.send(to, { t: 'signal', from: c.id, data: msg.data });
        return false;
      }
    }
  }

  /** Sends an error; nothing changed. */
  private no(c: Client, code: ErrorCode, detail?: string): false {
    this.fail(c, code, detail);
    return false;
  }
}
