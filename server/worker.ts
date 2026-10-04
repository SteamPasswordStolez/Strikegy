/**
 * The deployed signalling server: a Cloudflare Worker with one Durable Object
 * (`SignalHub`) that holds every connection and room. Nothing runs on the
 * owner's machines; players need only a browser.
 *
 * The hub uses WebSocket hibernation: between messages it may be evicted from
 * memory (idle time isn't billed on the free plan), so the core's state is
 * saved after every change and read back when it wakes. Each socket carries
 * its client id as an attachment, which survives hibernation.
 *
 * Deploy: `npm run signal:deploy` (wrangler). TURN: `npx wrangler secret put
 * CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN`; without them, STUN only.
 */
import { DurableObject } from 'cloudflare:workers';
import { SIGNAL_VERSION } from '../src/net/signalProtocol.ts';
import { SignalCore, type Conn, type CoreState } from './core.ts';
import { TurnCredentials, turnConfigFrom } from './turn.ts';

interface Env {
  HUB: DurableObjectNamespace<SignalHub>;
  CF_TURN_KEY_ID?: string;
  CF_TURN_API_TOKEN?: string;
}

const STATE_KEY = 'state';
/** Text messages over this size are dropped (the Node server's limit too). */
const MAX_MESSAGE = 64 * 1024;

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });

export class SignalHub extends DurableObject<Env> {
  private readonly core: SignalCore;
  private readonly turn: TurnCredentials;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const log = (line: string): void => console.log(line);
    this.turn = new TurnCredentials(turnConfigFrom(env), log);
    this.core = new SignalCore({ iceServers: () => this.turn.iceServers(), log });
    // Waking up: rebuild from the saved state and the sockets still open.
    void ctx.blockConcurrencyWhile(async () => {
      const conns = new Map<string, Conn>();
      for (const ws of ctx.getWebSockets()) {
        const id = (ws.deserializeAttachment() as { id?: string } | null)?.id;
        if (id) conns.set(id, this.conn(ws));
      }
      const saved = await ctx.storage.get<CoreState>(STATE_KEY);
      if (saved) this.core.restore(saved, conns);
      else for (const [id, conn] of conns) this.core.open(conn, id);
    });
  }

  private conn(ws: WebSocket): Conn {
    return {
      send: (text) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(text);
      },
      close: () => ws.close(1000),
    };
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, this.core.snapshot());
  }

  private idOf(ws: WebSocket): string | null {
    return (ws.deserializeAttachment() as { id?: string } | null)?.id ?? null;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, v: SIGNAL_VERSION, rooms: this.core.roomCount, clients: this.core.clientCount });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    const id = this.core.open(this.conn(server));
    server.serializeAttachment({ id });
    await this.save();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const id = this.idOf(ws);
    if (!id || typeof message !== 'string' || message.length > MAX_MESSAGE) return;
    if (await this.core.message(id, message)) await this.save();
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const id = this.idOf(ws);
    if (id && this.core.close(id)) await this.save();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/signal' && url.pathname !== '/health') return new Response('Not found', { status: 404 });
    // One hub for everyone: the room list is global, and the load is small.
    return env.HUB.get(env.HUB.idFromName('global')).fetch(request);
  },
} satisfies ExportedHandler<Env>;
