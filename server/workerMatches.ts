/**
 * The rooms' matches, each in its own worker thread (`roomWorker.ts`): the
 * same `MatchHost` as `Matches`, but a room building its map or running a
 * heavy tick never holds up the gateway, the lobby or the other rooms, and
 * the rooms spread over the machine's cores. New matches are refused while
 * the running ones already use most of the cores (`CPU_SHARE`).
 */
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { ClientMsg, RoomSettings } from '../src/net/lobbyProtocol.ts';
import type { MatchHost, MatchLine } from './lobby.ts';
import type { FromRoom, RoomWorkerData, ToRoom } from './roomWorker.ts';

/** A finished match keeps running this long so the last news reaches everyone (ms). */
const LINGER = 3000;
/** New matches wait while the running ones' ticks add up to this share of all cores. */
const CPU_SHARE = 0.7;
/**
 * Matches at once, and how many may be building their map at the same time:
 * each takes ~0.5 GB and its build eats a core for 8-28 s on the server
 * laptop (shared with other services), so a few people starting rooms can't
 * starve it.
 */
const MATCHES_MAX = Number(process.env.STRIKEGY_MATCHES_MAX) || 6;
const LOADING_MAX = 1;
/** A room just starting counts as this busy (ms a tick) until it reports. */
const STARTING_MS = 4;
/** A server tick (ms). */
const TICK_MS = 1000 / 60;

export interface WorkerMatchesOptions {
  log?: (line: string) => void;
  mapsDir?: string;
  ended?: (room: string) => void;
  /** The anticheat put a player out of a room's match. */
  kick?: (room: string, uid: string, reason: string) => void;
}

interface RoomThread {
  worker: Worker;
  /** Each player's line out (their WebSocket through the lobby). */
  lines: Map<string, MatchLine>;
  loaded: Promise<void>;
  ready: boolean;
  ended: boolean;
  stepMs: number;
}

export class WorkerMatches implements MatchHost {
  private readonly rooms = new Map<string, RoomThread>();
  private readonly cores = Math.max(1, availableParallelism());

  constructor(private readonly opts: WorkerMatchesOptions = {}) {}

  get running(): number {
    return this.rooms.size;
  }

  /** Average step time over the running rooms (ms). */
  get stepMs(): number {
    let sum = 0;
    for (const r of this.rooms.values()) sum += r.stepMs;
    return this.rooms.size ? sum / this.rooms.size : 0;
  }

  /** Share of the machine's cores the running rooms' ticks take (1 = all of them). */
  get cpu(): number {
    let sum = 0;
    for (const r of this.rooms.values()) sum += (r.ready ? r.stepMs : STARTING_MS) / TICK_MS;
    return sum / this.cores;
  }

  async start(room: string, settings: RoomSettings, members: { uid: string; name: string; line: MatchLine }[]): Promise<void> {
    this.stop(room);
    let loading = 0;
    for (const r of this.rooms.values()) if (!r.ready) loading++;
    if (this.cpu > CPU_SHARE || this.rooms.size >= MATCHES_MAX || loading >= LOADING_MAX) throw new Error('busy');
    const data: RoomWorkerData = {
      room,
      map: settings.map,
      mode: settings.mode,
      lineup: settings.lineup,
      size: settings.size,
      difficulty: settings.difficulty,
      botShare: settings.botShare,
      mapsDir: this.opts.mapsDir,
    };
    const worker = new Worker(new URL('./roomWorker.js', import.meta.url), { workerData: data });
    let done: () => void = () => {};
    let fail: (e: Error) => void = () => {};
    const loaded = new Promise<void>((res, rej) => {
      done = res;
      fail = rej;
    });
    const t: RoomThread = { worker, lines: new Map(), loaded, ready: false, ended: false, stepMs: 0 };
    this.rooms.set(room, t);
    worker.on('message', (m: FromRoom) => {
      switch (m.t) {
        case 'loaded':
          t.ready = true;
          return done();
        case 'failed':
          return fail(new Error(m.error));
        case 'text':
          return t.lines.get(m.uid)?.text(m.msg);
        case 'bin':
          return t.lines.get(m.uid)?.binary(m.data);
        case 'log':
          return this.opts.log?.(m.line);
        case 'ended':
          t.ended = true;
          setTimeout(() => this.opts.ended?.(room), 0);
          return;
        case 'stats':
          t.stepMs = m.stepMs;
          return;
        case 'kick':
          return this.opts.kick?.(room, m.uid, m.reason);
      }
    });
    worker.on('error', (err: unknown) => {
      this.opts.log?.(`room ${room}: thread failed: ${String(err)}`);
      fail(err instanceof Error ? err : new Error(String(err)));
    });
    worker.on('exit', (code) => {
      if (this.rooms.get(room) === t) {
        this.rooms.delete(room);
        if (code !== 0) this.opts.log?.(`room ${room}: thread stopped (${code})`);
        fail(new Error(`thread stopped (${code})`));
      }
    });
    try {
      await loaded;
    } catch (err) {
      if (this.rooms.get(room) === t) this.rooms.delete(room);
      void worker.terminate();
      throw err;
    }
    // Called off while loading.
    if (this.rooms.get(room) !== t) return;
    for (const p of members) this.join(room, p.uid, p.name, p.line);
  }

  private post(room: string, m: ToRoom, transfer?: ArrayBuffer[]): void {
    this.rooms.get(room)?.worker.postMessage(m, transfer ?? []);
  }

  join(room: string, uid: string, name: string, line: MatchLine): void {
    const t = this.rooms.get(room);
    if (!t) return;
    t.lines.set(uid, line);
    if (t.ready) this.post(room, { t: 'join', uid, name });
    else void t.loaded.then(() => this.rooms.get(room) === t && this.post(room, { t: 'join', uid, name })).catch(() => {});
  }

  detach(room: string, uid: string): void {
    this.rooms.get(room)?.lines.delete(uid);
    this.post(room, { t: 'detach', uid });
  }

  leave(room: string, uid: string): void {
    this.rooms.get(room)?.lines.delete(uid);
    this.post(room, { t: 'leave', uid });
  }

  stop(room: string): void {
    const t = this.rooms.get(room);
    if (!t) return;
    this.rooms.delete(room);
    // Over: a moment for the last news (the result) to go out first.
    if (t.ended) setTimeout(() => void t.worker.terminate(), LINGER);
    else void t.worker.terminate();
  }

  message(room: string, uid: string, msg: Extract<ClientMsg, { t: 'ready' | 'deploy' | 'callin' }>): void {
    this.post(room, { t: 'msg', uid, msg });
  }

  binary(room: string, uid: string, data: Uint8Array): void {
    // A copy of its own (the socket's buffer may be shared), handed over.
    const copy = data.slice();
    this.post(room, { t: 'bin', uid, data: copy }, [copy.buffer]);
  }

  dispose(): void {
    for (const room of [...this.rooms.keys()]) this.stop(room);
  }
}
