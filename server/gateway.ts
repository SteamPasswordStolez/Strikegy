/**
 * The game server's front door on Node (`npm run server`): one WebSocket per
 * player at `/play`. Text frames are lobby and match messages (`LobbyCore`);
 * binary frames are match data (inputs up, snapshots down) for the room the
 * player is in (`Matches`). `/health` answers with the load for a quick look
 * from outside.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { PROTOCOL_VERSION, SERVER_MAX } from '../src/net/lobbyProtocol.ts';
import { LobbyCore, type AdminData, type AdminStore, type MatchHost } from './lobby.ts';
import { Matches } from './matches.ts';
import { WorkerMatches } from './workerMatches.ts';
import { ServerRtc, localRtcSetup, parseRtc } from './rtc.ts';
import { RtcLimit } from './rtcLimit.ts';

/** Open connections one address may have (a household's tabs), and the server in all. */
const PER_ADDRESS = 12;
const CONNECTIONS_MAX = 1500;

export interface GatewayOptions {
  port?: number;
  host?: string;
  log?: (line: string) => void;
  serverMax?: number;
  /** Runs the matches; null: lobby only (tests). Default: matches in this process. */
  matches?: MatchHost | null;
  /** Each room's match in its own worker thread (the built server; tests run them in-process). */
  workers?: boolean;
  mapsDir?: string;
  /** The key name tags are made with (default: `tagSecret()`). */
  tagSecret?: string;
  /** The admin page's key (default: `adminKey()`; null: no admin page). */
  adminKey?: string | null;
  /** Where the staff's bans, mutes and words are kept (default: `.strikegy-admin.json`; null: memory only). */
  adminStore?: AdminStore | null;
}

/** The admin page's key between restarts (git-ignored). */
const ADMIN_KEY_FILE = '.strikegy-admin-key';
/** The staff's bans, mutes and words (git-ignored). */
const ADMIN_FILE = '.strikegy-admin.json';

/** The admin key: `STRIKEGY_ADMIN_KEY`, else the file, else a new one written to the file (read it there: never logged). */
export function adminKey(log: (line: string) => void = () => {}): string | null {
  const env = process.env.STRIKEGY_ADMIN_KEY;
  if (env) return env.length >= 16 ? env : null;
  try {
    const saved = readFileSync(ADMIN_KEY_FILE, 'utf8').trim();
    if (saved.length >= 16) return saved;
  } catch {
    /* none yet */
  }
  const fresh = randomBytes(24).toString('base64url');
  try {
    writeFileSync(ADMIN_KEY_FILE, fresh, { mode: 0o600 });
    log(`admin: a new key is in ${ADMIN_KEY_FILE}`);
    return fresh;
  } catch {
    // Nowhere to keep it: no admin page rather than one with a key nobody can read.
    return null;
  }
}

/** The staff's data in a file next to the server. */
export function fileAdminStore(path = ADMIN_FILE): AdminStore {
  return {
    load: () => {
      try {
        return JSON.parse(readFileSync(path, 'utf8')) as AdminData;
      } catch {
        return null;
      }
    },
    save: (data) => writeFileSync(path, JSON.stringify(data), { mode: 0o600 }),
  };
}

/** Where the tag key is kept between restarts (git-ignored; a new key gives everyone new tags). */
const TAG_SECRET_FILE = '.strikegy-tag-secret';

/** The tag key: `STRIKEGY_TAG_SECRET`, else the file, else a new one written to the file. */
export function tagSecret(): string {
  const env = process.env.STRIKEGY_TAG_SECRET;
  if (env) return env;
  try {
    const saved = readFileSync(TAG_SECRET_FILE, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {
    /* none yet */
  }
  const fresh = randomBytes(32).toString('hex');
  try {
    writeFileSync(TAG_SECRET_FILE, fresh, { mode: 0o600 });
  } catch {
    /* read-only: tags change on the next restart */
  }
  return fresh;
}

export interface Gateway {
  port: number;
  lobby: LobbyCore;
  close(): Promise<void>;
}

export async function startGateway(opts: GatewayOptions = {}): Promise<Gateway> {
  const log = opts.log ?? ((line: string) => console.log(`[server] ${line}`));
  let lobby: LobbyCore | null = null;
  const hostOpts = { log, mapsDir: opts.mapsDir, ended: (room: string) => lobby?.matchOver(room), kick: (room: string, uid: string, reason: string) => lobby?.kick(room, uid, reason) };
  const own = opts.matches === undefined ? (opts.workers ? new WorkerMatches(hostOpts) : new Matches(hostOpts)) : null;
  const matches = opts.matches === undefined ? own : opts.matches;
  const stats = () => ({
    matches: own?.running ?? 0,
    stepMs: own ? Math.round(own.stepMs * 100) / 100 : 0,
    cpu: own instanceof WorkerMatches ? Math.round(own.cpu * 100) / 100 : undefined,
    uptime: Math.round(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
  });
  lobby = new LobbyCore({
    log,
    serverMax: opts.serverMax,
    matches,
    tagSecret: opts.tagSecret ?? tagSecret(),
    adminKey: opts.adminKey === undefined ? adminKey(log) : opts.adminKey,
    store: opts.adminStore === undefined ? fileAdminStore() : (opts.adminStore ?? undefined),
    stats,
  });
  const core = lobby;
  const sweep = setInterval(() => core.sweep(), 5000);
  // UDP data channels end here only for local testing; in production on the Oracle relay (edge.ts).
  const rtc = opts.matches === null ? null : localRtcSetup();
  if (rtc) log('udp: direct (local testing)');

  const http: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(
        JSON.stringify({
          ok: true,
          v: PROTOCOL_VERSION,
          rooms: core.roomCount,
          clients: core.clientCount,
          load: core.load,
          max: opts.serverMax ?? SERVER_MAX,
          matches: own?.running ?? 0,
          stepMs: own ? Math.round(own.stepMs * 100) / 100 : 0,
          cpu: own instanceof WorkerMatches ? Math.round(own.cpu * 100) / 100 : undefined,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: http, path: '/play', maxPayload: 64 * 1024 });
  /** Open connections by address (behind the Cloudflare tunnel: the visitor's, from its header). */
  const perAddress = new Map<string, number>();

  wss.on('connection', (ws, req) => {
    // Through the relay (Caddy on Oracle, down an SSH tunnel) the socket is local and the
    // visitor is in X-Forwarded-For; through the Cloudflare tunnel, in CF-Connecting-IP.
    const local = /^(::ffff:)?127\.|^::1$/.test(req.socket.remoteAddress ?? '');
    const header = (name: string) => {
      const v = req.headers[name];
      return (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
    };
    const addr = (local ? (header('cf-connecting-ip') ?? header('x-forwarded-for')) : undefined) ?? req.socket.remoteAddress ?? '?';
    const open = perAddress.get(addr) ?? 0;
    if (open >= PER_ADDRESS || wss.clients.size > CONNECTIONS_MAX) {
      ws.close(1013, 'too many connections');
      return;
    }
    perAddress.set(addr, open + 1);
    ws.on('close', () => {
      const n = (perAddress.get(addr) ?? 1) - 1;
      if (n <= 0) perAddress.delete(addr);
      else perAddress.set(addr, n);
    });
    /** This player's UDP data channel, once asked for (snapshots go there while it is up). */
    let channel: ServerRtc | null = null;
    let channelAsks = 0;
    const rtcLimit = new RtcLimit();
    const id = core.open({
      send: (text) => {
        if (ws.readyState === ws.OPEN) ws.send(text);
      },
      binary: (data) => {
        if (channel?.send(data)) return;
        if (ws.readyState === ws.OPEN) ws.send(data, { binary: true });
      },
      close: () => ws.close(),
    }, undefined, addr);
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        core.binary(id, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        return;
      }
      const text = data.toString();
      // Channel set-up and ongoing health reports are handled by the gateway.
      const set = parseRtc(text);
      if (set || text.startsWith('{"t":"rtc"')) {
        if (!rtc || !set || !rtcLimit.take()) return;
        if ('ask' in set) {
          if (++channelAsks > 4) return;
          channel?.close();
          channel = new ServerRtc(
            rtc,
            (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg)),
            (d) => core.binary(id, d),
          );
          return;
        }
        channel?.remote(set);
        return;
      }
      void core.message(id, text);
    });
    ws.on('close', () => {
      channel?.close();
      channel = null;
      core.close(id);
    });
    ws.on('error', () => ws.close());
  });

  await new Promise<void>((resolve) => http.listen(opts.port ?? 8787, opts.host ?? '0.0.0.0', resolve));
  const port = (http.address() as AddressInfo).port;
  log(`listening on :${port}`);
  return {
    port,
    lobby: core,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweep);
        own?.dispose();
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        http.close(() => resolve());
      }),
  };
}
