/**
 * One room's match in its own thread (`WorkerMatches` starts one per room):
 * building the map (15-28 s on the server laptop) and every tick run here,
 * so the gateway, the lobby and the other rooms never wait on it. Messages
 * in and out are `ToRoom` / `FromRoom`.
 */
import { parentPort, workerData } from 'node:worker_threads';
import type { ClientMsg, ServerMsg } from '../src/net/lobbyProtocol.ts';
import { MatchRoom, type MatchConn, type MatchRoomOptions } from './matchRoom.ts';

/** What the gateway tells a room's thread. */
export type ToRoom =
  | { t: 'join'; uid: string; name: string }
  | { t: 'detach'; uid: string }
  | { t: 'leave'; uid: string }
  | { t: 'msg'; uid: string; msg: Extract<ClientMsg, { t: 'ready' | 'deploy' | 'callin' }> }
  | { t: 'bin'; uid: string; data: Uint8Array };

/** What a room's thread tells the gateway. */
export type FromRoom =
  | { t: 'loaded' }
  | { t: 'failed'; error: string }
  | { t: 'text'; uid: string; msg: ServerMsg }
  | { t: 'bin'; uid: string; data: Uint8Array }
  | { t: 'log'; line: string }
  | { t: 'ended' }
  /** Average step time over the last second (ms) and people in the room. */
  | { t: 'stats'; stepMs: number; players: number };

export type RoomWorkerData = Omit<MatchRoomOptions, 'log' | 'ended'>;

const port = parentPort!;
const send = (m: FromRoom, transfer?: ArrayBuffer[]): void => port.postMessage(m, transfer ?? []);

/** A player's line, as the room sees it: out through the gateway. */
function connFor(uid: string): MatchConn {
  return {
    text: (msg) => send({ t: 'text', uid, msg }),
    binary: (data) => {
      // A snapshot owns its buffer: hand it over rather than copy it.
      const own = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
      send({ t: 'bin', uid, data }, own ? [data.buffer as ArrayBuffer] : undefined);
    },
  };
}

const opts = workerData as RoomWorkerData;
let room: MatchRoom | null = null;
/** What came before the map was built: played back once it is. */
const early: ToRoom[] = [];

function handle(m: ToRoom): void {
  const r = room;
  if (!r) {
    early.push(m);
    return;
  }
  switch (m.t) {
    case 'join':
      return r.join(m.uid, m.name, connFor(m.uid));
    case 'detach':
      return r.detach(m.uid);
    case 'leave':
      return r.leave(m.uid);
    case 'msg':
      if (m.msg.t === 'ready') return r.ready(m.uid, m.msg.hostBots === true);
      if (m.msg.t === 'deploy') return r.deploy(m.uid, m.msg.key, m.msg.kit);
      return r.callIn(m.uid, m.msg.kind, m.msg.point);
    case 'bin':
      return r.binary(m.uid, m.data);
  }
}

port.on('message', (m: ToRoom) => handle(m));

try {
  room = await MatchRoom.create({ ...opts, log: (line) => send({ t: 'log', line }), ended: () => send({ t: 'ended' }) });
  room.start();
  send({ t: 'loaded' });
  for (const m of early.splice(0)) handle(m);
  setInterval(() => {
    const list = room!.stepMs;
    send({ t: 'stats', stepMs: list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0, players: room!.players });
  }, 1000);
} catch (err) {
  send({ t: 'failed', error: String(err) });
}
