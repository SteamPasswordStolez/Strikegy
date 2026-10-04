/**
 * The signalling server: names, the room list, passwords, picking the host
 * PC, and passing WebRTC set-up messages between members of a room. Match
 * data never comes through here (it goes peer to peer), so this stays light
 * enough for the owner's i3 laptop. Run: `npm run signal` (PORT, CF_TURN_KEY_ID,
 * CF_TURN_API_TOKEN from the environment).
 */
import { createServer, type Server } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
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
  type Member,
  type Report,
  type Room,
  type RoomInfo,
  type RoomSettings,
  type ServerMsg,
} from '../src/net/signalProtocol.ts';
import { pickCandidates, pickHost } from '../src/net/hostScore.ts';
import { TurnCredentials, type TurnConfig } from './turn.ts';

/** Messages a connection may send: a bucket of this many, refilled per second. */
const RATE = { burst: 120, perSecond: 60 } as const;
/** Members who must call the host lost (share of the others) before the backup takes over. */
const HOST_LOST_SHARE = 0.5;
const HOST_LOST_WINDOW_MS = 10_000;

interface Client {
  ws: WebSocket;
  id: string;
  name: string | null;
  device: Device;
  uid: string;
  room: RoomRec | null;
  tokens: number;
  lastRefill: number;
}

interface RoomRec {
  id: string;
  settings: RoomSettings;
  password: { salt: Buffer; hash: Buffer } | null;
  state: 'lobby' | 'playing';
  owner: string;
  members: Client[];
  host: string | null;
  backup: string | null;
  candidates: string[];
  reports: Map<string, Report>;
  /** Who said the host is gone, and when. */
  hostLost: Map<string, number>;
}

export interface SignalOptions {
  port?: number;
  host?: string;
  turn?: TurnConfig | null;
  log?: (line: string) => void;
}

export interface SignalServer {
  port: number;
  close(): Promise<void>;
}

const shortId = (bytes: number): string => randomBytes(bytes).toString('hex');

function hashPassword(pw: string): { salt: Buffer; hash: Buffer } {
  const salt = randomBytes(16);
  return { salt, hash: scryptSync(pw, salt, 32) };
}

function passwordOk(rec: RoomRec['password'], pw: string | undefined): boolean {
  if (!rec) return true;
  if (pw === undefined) return false;
  return timingSafeEqual(scryptSync(pw, rec.salt, 32), rec.hash);
}

const humanCap = (s: RoomSettings): number => Math.min(HUMAN_CAP, s.size);

export async function startSignalServer(opts: SignalOptions = {}): Promise<SignalServer> {
  const log = opts.log ?? ((line: string) => console.log(`[signal] ${line}`));
  const turn = new TurnCredentials(opts.turn ?? null, log);
  const rooms = new Map<string, RoomRec>();
  const clients = new Set<Client>();

  const http: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, v: SIGNAL_VERSION, rooms: rooms.size, clients: clients.size }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: http, path: '/signal', maxPayload: 64 * 1024 });

  const send = (c: Client, msg: ServerMsg): void => {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const fail = (c: Client, code: ErrorCode, detail?: string): void => send(c, { t: 'error', code, detail });

  const member = (c: Client): Member => ({ id: c.id, name: c.name ?? '?', device: c.device });
  const info = (r: RoomRec): RoomInfo => ({
    id: r.id,
    settings: r.settings,
    locked: r.password !== null,
    state: r.state,
    humans: r.members.length,
    humanCap: humanCap(r.settings),
  });
  const view = (r: RoomRec): Room => ({
    ...info(r),
    owner: r.owner,
    members: r.members.map(member),
    host: r.host,
    backup: r.backup,
    candidates: r.candidates,
  });
  const broadcast = (r: RoomRec): void => {
    const msg: ServerMsg = { t: 'room', room: view(r) };
    for (const m of r.members) send(m, msg);
  };

  /** Re-picks candidates, and the host while waiting (in a match the host stays until it's lost). */
  const repick = (r: RoomRec): void => {
    const members = r.members.map(member);
    r.candidates = pickCandidates(members, r.reports, r.owner);
    if (r.state === 'lobby') {
      const pick = pickHost(members, r.reports, r.owner);
      r.host = pick.host;
      r.backup = pick.backup;
    } else {
      if (!r.host || !r.members.some((m) => m.id === r.host)) r.host = r.backup;
      if (!r.host || !r.members.some((m) => m.id === r.host)) r.host = pickHost(members, r.reports, r.owner).host;
      if (!r.backup || r.backup === r.host || !r.members.some((m) => m.id === r.backup)) {
        const rest = members.filter((m) => m.id !== r.host);
        const next = pickHost(rest, r.reports, r.owner).host;
        r.backup = next;
      }
    }
  };

  /** Promotes the backup in a running match. */
  const promoteBackup = (r: RoomRec, why: string): void => {
    log(`room ${r.id}: host ${r.host} lost (${why}), backup ${r.backup} takes over`);
    r.host = r.backup;
    r.backup = null;
    r.hostLost.clear();
    repick(r);
  };

  const leaveRoom = (c: Client, reason: 'leave' | 'kicked' | 'closed'): void => {
    const r = c.room;
    if (!r) return;
    c.room = null;
    r.members = r.members.filter((m) => m !== c);
    r.reports.delete(c.id);
    r.hostLost.delete(c.id);
    for (const m of r.members) {
      const rep = r.reports.get(m.id);
      if (rep) delete rep.links[c.id];
    }
    send(c, { t: 'left', reason });
    if (!r.members.length) {
      rooms.delete(r.id);
      log(`room ${r.id} closed`);
      return;
    }
    if (r.owner === c.id) r.owner = r.members[0]!.id;
    if (r.state === 'playing' && r.host === c.id) promoteBackup(r, 'left');
    else repick(r);
    broadcast(r);
  };

  const uniqueName = (r: RoomRec, name: string): string => {
    const taken = new Set(r.members.map((m) => m.name));
    if (!taken.has(name)) return name;
    for (let i = 2; ; i++) {
      const tail = String(i);
      const n = name.slice(0, 16 - tail.length) + tail;
      if (!taken.has(n)) return n;
    }
  };

  const joinRoom = (c: Client, r: RoomRec): void => {
    c.name = uniqueName(r, c.name!);
    c.room = r;
    r.members.push(c);
    repick(r);
    broadcast(r);
  };

  const allowed = (c: Client): boolean => {
    const now = Date.now();
    c.tokens = Math.min(RATE.burst, c.tokens + ((now - c.lastRefill) / 1000) * RATE.perSecond);
    c.lastRefill = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  };

  const handle = async (c: Client, msg: ClientMsg): Promise<void> => {
    if (msg.t === 'hello') {
      if (msg.v !== SIGNAL_VERSION) return fail(c, 'version', String(SIGNAL_VERSION));
      const name = cleanName(msg.name);
      if (!name) return fail(c, 'name');
      c.name = name;
      c.uid = msg.uid;
      c.device = msg.device;
      send(c, { t: 'welcome', id: c.id, name, ice: await turn.iceServers() });
      return;
    }
    if (!c.name) return fail(c, 'bad', 'hello first');
    const r = c.room;
    switch (msg.t) {
      case 'list':
        send(c, { t: 'rooms', rooms: [...rooms.values()].map(info) });
        return;
      case 'create': {
        if (r) return fail(c, 'busy');
        const settings = cleanSettings(msg.settings);
        if (!settings) return fail(c, 'bad', 'settings');
        const rec: RoomRec = {
          id: shortId(3),
          settings,
          password: msg.password ? hashPassword(msg.password) : null,
          state: 'lobby',
          owner: c.id,
          members: [],
          host: null,
          backup: null,
          candidates: [],
          reports: new Map(),
          hostLost: new Map(),
        };
        rooms.set(rec.id, rec);
        log(`room ${rec.id} "${settings.name}" by ${c.name}`);
        joinRoom(c, rec);
        return;
      }
      case 'join': {
        if (r) return fail(c, 'busy');
        const rec = rooms.get(msg.room);
        if (!rec) return fail(c, 'noRoom');
        if (!passwordOk(rec.password, msg.password)) return fail(c, 'password');
        if (rec.members.length >= humanCap(rec.settings)) return fail(c, 'full');
        if (rec.settings.input !== 'all' && rec.settings.input !== c.device) return fail(c, 'full', 'input');
        joinRoom(c, rec);
        return;
      }
      case 'leave':
        if (!r) return fail(c, 'notInRoom');
        leaveRoom(c, 'leave');
        return;
      case 'settings': {
        if (!r) return fail(c, 'notInRoom');
        if (r.owner !== c.id) return fail(c, 'notOwner');
        if (r.state !== 'lobby') return fail(c, 'busy');
        const settings = cleanSettings(msg.settings);
        if (!settings || settings.size < r.members.length) return fail(c, 'bad', 'settings');
        r.settings = settings;
        broadcast(r);
        return;
      }
      case 'start':
        if (!r) return fail(c, 'notInRoom');
        if (r.owner !== c.id) return fail(c, 'notOwner');
        if (r.state !== 'lobby') return fail(c, 'busy');
        repick(r);
        r.state = 'playing';
        log(`room ${r.id} starts, host ${r.host}, backup ${r.backup}`);
        broadcast(r);
        return;
      case 'end':
        if (!r) return fail(c, 'notInRoom');
        if (r.owner !== c.id && r.host !== c.id) return fail(c, 'notOwner');
        r.state = 'lobby';
        r.hostLost.clear();
        repick(r);
        broadcast(r);
        return;
      case 'kick': {
        if (!r) return fail(c, 'notInRoom');
        if (r.owner !== c.id) return fail(c, 'notOwner');
        const target = r.members.find((m) => m.id === msg.member && m !== c);
        if (target) leaveRoom(target, 'kicked');
        return;
      }
      case 'report': {
        if (!r) return fail(c, 'notInRoom');
        const report = cleanReport(msg.report);
        if (!report) return fail(c, 'bad', 'report');
        // Only links to members of this room count.
        for (const peer of Object.keys(report.links)) if (!r.members.some((m) => m.id === peer)) delete report.links[peer];
        r.reports.set(c.id, report);
        const before = `${r.host}/${r.backup}/${r.candidates.join()}`;
        repick(r);
        if (`${r.host}/${r.backup}/${r.candidates.join()}` !== before) broadcast(r);
        return;
      }
      case 'hostLost': {
        if (!r || r.state !== 'playing' || !r.host || r.host === c.id) return;
        const now = Date.now();
        r.hostLost.set(c.id, now);
        for (const [id, at] of r.hostLost) if (now - at > HOST_LOST_WINDOW_MS) r.hostLost.delete(id);
        const others = r.members.length - 1;
        if (r.hostLost.size >= Math.max(1, Math.ceil(others * HOST_LOST_SHARE))) {
          promoteBackup(r, `${r.hostLost.size} of ${others} lost it`);
          broadcast(r);
        }
        return;
      }
      case 'signal': {
        if (!r) return fail(c, 'notInRoom');
        const to = r.members.find((m) => m.id === msg.to);
        if (!to) return fail(c, 'noRoom', 'peer');
        send(to, { t: 'signal', from: c.id, data: msg.data });
        return;
      }
    }
  };

  wss.on('connection', (ws) => {
    const c: Client = { ws, id: shortId(4), name: null, device: 'desktop', uid: '', room: null, tokens: RATE.burst, lastRefill: Date.now() };
    clients.add(c);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return fail(c, 'bad');
      if (!allowed(c)) return fail(c, 'rate');
      const msg = parseClientMsg(data.toString());
      if (!msg) return fail(c, 'bad');
      handle(c, msg).catch((err: unknown) => log(`error: ${String(err)}`));
    });
    ws.on('close', () => {
      clients.delete(c);
      leaveRoom(c, 'closed');
    });
    ws.on('error', () => ws.close());
  });

  await new Promise<void>((resolve) => http.listen(opts.port ?? 8787, opts.host ?? '0.0.0.0', resolve));
  const port = (http.address() as AddressInfo).port;
  log(`listening on :${port} (TURN ${turn.enabled ? 'on' : 'off: STUN only'})`);
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of clients) c.ws.terminate();
        wss.close();
        http.close(() => resolve());
      }),
  };
}
