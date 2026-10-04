/**
 * The game server's front door on Node (`npm run server`): one WebSocket per
 * player at `/play`. Text frames are lobby messages (`LobbyCore`); binary
 * frames are kept for match data, which the room workers will take. `/health`
 * answers with the load for a quick look from outside.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { PROTOCOL_VERSION, SERVER_MAX } from '../src/net/lobbyProtocol.ts';
import { LobbyCore } from './lobby.ts';

export interface GatewayOptions {
  port?: number;
  host?: string;
  log?: (line: string) => void;
  serverMax?: number;
}

export interface Gateway {
  port: number;
  lobby: LobbyCore;
  close(): Promise<void>;
}

export async function startGateway(opts: GatewayOptions = {}): Promise<Gateway> {
  const log = opts.log ?? ((line: string) => console.log(`[server] ${line}`));
  const lobby = new LobbyCore({ log, serverMax: opts.serverMax });

  const http: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, v: PROTOCOL_VERSION, rooms: lobby.roomCount, clients: lobby.clientCount, load: lobby.load, max: opts.serverMax ?? SERVER_MAX }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: http, path: '/play', maxPayload: 64 * 1024 });

  wss.on('connection', (ws) => {
    const id = lobby.open({
      send: (text) => {
        if (ws.readyState === ws.OPEN) ws.send(text);
      },
      close: () => ws.close(),
    });
    ws.on('message', (data, isBinary) => {
      // Binary frames: match data, once rooms run matches.
      if (isBinary) return;
      void lobby.message(id, data.toString());
    });
    ws.on('close', () => lobby.close(id));
    ws.on('error', () => ws.close());
  });

  await new Promise<void>((resolve) => http.listen(opts.port ?? 8787, opts.host ?? '0.0.0.0', resolve));
  const port = (http.address() as AddressInfo).port;
  log(`listening on :${port}`);
  return {
    port,
    lobby,
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        http.close(() => resolve());
      }),
  };
}
