/**
 * The game server's front door on Node (`npm run server`): one WebSocket per
 * player at `/play`. Text frames are lobby and match messages (`LobbyCore`);
 * binary frames are match data (inputs up, snapshots down) for the room the
 * player is in (`Matches`). `/health` answers with the load for a quick look
 * from outside.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { PROTOCOL_VERSION, SERVER_MAX } from '../src/net/lobbyProtocol.ts';
import { LobbyCore, type MatchHost } from './lobby.ts';
import { Matches } from './matches.ts';

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
  mapsDir?: string;
}

export interface Gateway {
  port: number;
  lobby: LobbyCore;
  close(): Promise<void>;
}

export async function startGateway(opts: GatewayOptions = {}): Promise<Gateway> {
  const log = opts.log ?? ((line: string) => console.log(`[server] ${line}`));
  let lobby: LobbyCore | null = null;
  const own = opts.matches === undefined ? new Matches({ log, mapsDir: opts.mapsDir, ended: (room) => lobby?.matchOver(room) }) : null;
  const matches = opts.matches === undefined ? own : opts.matches;
  lobby = new LobbyCore({ log, serverMax: opts.serverMax, matches });
  const core = lobby;
  const sweep = setInterval(() => core.sweep(), 5000);

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
    const id = core.open({
      send: (text) => {
        if (ws.readyState === ws.OPEN) ws.send(text);
      },
      binary: (data) => {
        if (ws.readyState === ws.OPEN) ws.send(data, { binary: true });
      },
      close: () => ws.close(),
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        core.binary(id, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        return;
      }
      void core.message(id, data.toString());
    });
    ws.on('close', () => core.close(id));
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
