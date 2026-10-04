/**
 * The signalling server on Node, for local development and tests
 * (`npm run signal`). The deployed one is the Cloudflare Worker in
 * `worker.ts`; both run the same `SignalCore`.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { SIGNAL_VERSION } from '../src/net/signalProtocol.ts';
import { SignalCore } from './core.ts';
import { TurnCredentials, type TurnConfig } from './turn.ts';

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

export async function startSignalServer(opts: SignalOptions = {}): Promise<SignalServer> {
  const log = opts.log ?? ((line: string) => console.log(`[signal] ${line}`));
  const turn = new TurnCredentials(opts.turn ?? null, log);
  const core = new SignalCore({ iceServers: () => turn.iceServers(), log });

  const http: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, v: SIGNAL_VERSION, rooms: core.roomCount, clients: core.clientCount }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: http, path: '/signal', maxPayload: 64 * 1024 });

  wss.on('connection', (ws) => {
    const id = core.open({
      send: (text) => {
        if (ws.readyState === ws.OPEN) ws.send(text);
      },
      close: () => ws.close(),
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      void core.message(id, data.toString());
    });
    ws.on('close', () => core.close(id));
    ws.on('error', () => ws.close());
  });

  await new Promise<void>((resolve) => http.listen(opts.port ?? 8787, opts.host ?? '0.0.0.0', resolve));
  const port = (http.address() as AddressInfo).port;
  log(`listening on :${port} (TURN ${turn.enabled ? 'on' : 'off: STUN only'})`);
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        http.close(() => resolve());
      }),
  };
}
