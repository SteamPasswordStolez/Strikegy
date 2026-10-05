/**
 * The UDP edge on the Oracle relay (`dist-server/edge.js`, systemd
 * `server/strikegy-edge.service`): Caddy hands it the players' WebSockets
 * (`/play`); it passes each one through to the game server on the laptop
 * (down the SSH tunnel, the visitor's address in X-Forwarded-For) and runs the
 * player's WebRTC data channel itself, so match data crosses the internet as
 * UDP while the laptop's address never shows. Snapshots from the laptop go
 * down the channel when it is up (else the WebSocket); what comes up the
 * channel (inputs) goes to the laptop as binary frames like any other.
 *
 * Env: EDGE_PORT (18788), EDGE_UPSTREAM (ws://127.0.0.1:18787/play),
 * EDGE_PUBLIC_IP (the relay's public address), EDGE_UDP_PORT (50000).
 */
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { ServerRtc, edgeRtcSetup, parseRtc } from './rtc.ts';

const PORT = Number(process.env.EDGE_PORT) || 18788;
const UPSTREAM = process.env.EDGE_UPSTREAM ?? 'ws://127.0.0.1:18787/play';
const setup = edgeRtcSetup(process.env.EDGE_PUBLIC_IP ?? '', Number(process.env.EDGE_UDP_PORT) || 50000);
/** Players at once (the laptop has its own limits per address and in all). */
const MAX = 1500;
/** Messages a player may queue while the laptop's end is still connecting. */
const QUEUE_MAX = 64;

const log = (line: string): void => console.log(`[edge] ${line}`);
const http = createServer((_req, res) => {
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ server: http, path: '/play', maxPayload: 64 * 1024 });

const toBytes = (data: RawData): Uint8Array => {
  const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
};

wss.on('connection', (client, req) => {
  if (wss.clients.size > MAX) return client.close(1013, 'busy');
  const fwd = req.headers['x-forwarded-for'];
  const up = new WebSocket(UPSTREAM, { headers: fwd ? { 'x-forwarded-for': Array.isArray(fwd) ? fwd[0]! : fwd } : {} });
  const queue: { data: RawData; binary: boolean }[] = [];
  let channel: ServerRtc | null = null;
  let asks = 0;
  let rtcMsgs = 0;
  const end = (): void => {
    channel?.close();
    channel = null;
    if (client.readyState === client.OPEN || client.readyState === client.CONNECTING) client.close();
    if (up.readyState === up.OPEN || up.readyState === up.CONNECTING) up.close();
  };
  const toUp = (data: RawData | Uint8Array, binary: boolean): void => {
    if (up.readyState === up.OPEN) up.send(data, { binary });
    else if (up.readyState === up.CONNECTING && queue.length < QUEUE_MAX) queue.push({ data: data as RawData, binary });
  };

  up.on('open', () => {
    for (const q of queue.splice(0)) up.send(q.data, { binary: q.binary });
  });
  up.on('message', (data, isBinary) => {
    if (client.readyState !== client.OPEN) return;
    if (isBinary) {
      if (channel?.send(toBytes(data))) return;
      client.send(data, { binary: true });
    } else client.send(data.toString());
  });
  client.on('message', (data, isBinary) => {
    if (!isBinary) {
      const text = data.toString();
      const rtc = parseRtc(text);
      if (rtc) {
        if (++rtcMsgs > 80) return;
        if ('ask' in rtc) {
          if (++asks > 4) return;
          channel?.close();
          channel = new ServerRtc(
            setup,
            (msg) => client.readyState === client.OPEN && client.send(JSON.stringify(msg)),
            (d) => toUp(d, true),
          );
        } else channel?.remote(rtc);
        return;
      }
      return toUp(data, false);
    }
    toUp(data, true);
  });
  client.on('close', end);
  client.on('error', end);
  up.on('close', end);
  up.on('error', end);
});

http.listen(PORT, '127.0.0.1', () => log(`listening on 127.0.0.1:${PORT}, laptop at ${UPSTREAM}, udp ${setup.config.portRangeBegin}${setup.rewrite ? ` (${setup.rewrite.from} shown as ${setup.rewrite.to})` : ''}`));
