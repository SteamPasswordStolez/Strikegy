/**
 * The rooms' matches on the game server (`MatchHost` for the lobby): loads a
 * room's map when its owner starts, passes players' messages and inputs to
 * it, and tells the lobby when a match is over. All in the gateway's process
 * for now; a worker thread per room comes with several rooms at once.
 */
import type { ClientMsg, RoomSettings } from '../src/net/lobbyProtocol.ts';
import type { MatchHost, MatchLine } from './lobby.ts';
import { MatchRoom } from './matchRoom.ts';

/** A finished match keeps running this long so the last news reaches everyone (ms). */
const LINGER = 3000;

export interface MatchesOptions {
  log?: (line: string) => void;
  mapsDir?: string;
  /** A room's match has a winner (the lobby takes the room back to waiting). */
  ended?: (room: string) => void;
}

export class Matches implements MatchHost {
  private readonly rooms = new Map<string, MatchRoom>();
  /** Rooms still loading their map: joins wait for it. */
  private readonly loading = new Map<string, Promise<MatchRoom | null>>();

  constructor(private readonly opts: MatchesOptions = {}) {}

  get running(): number {
    return this.rooms.size;
  }

  /** Average step time over the running rooms' last ticks (ms). */
  get stepMs(): number {
    let sum = 0;
    let n = 0;
    for (const r of this.rooms.values()) for (const t of r.stepMs) {
      sum += t;
      n++;
    }
    return n ? sum / n : 0;
  }

  async start(room: string, settings: RoomSettings, members: { uid: string; name: string; line: MatchLine }[]): Promise<void> {
    this.stop(room);
    const made = MatchRoom.create({
      room,
      map: settings.map,
      mode: settings.mode,
      log: this.opts.log,
      mapsDir: this.opts.mapsDir,
      ended: () => setTimeout(() => this.opts.ended?.(room), 0),
    }).catch((err: unknown) => {
      this.opts.log?.(`room ${room}: ${String(err)}`);
      return null;
    });
    this.loading.set(room, made);
    const m = await made;
    if (this.loading.get(room) !== made) {
      // Called off while loading.
      m?.dispose();
      return;
    }
    this.loading.delete(room);
    if (!m) throw new Error('map failed to load');
    this.rooms.set(room, m);
    for (const p of members) m.join(p.uid, p.name, p.line);
    m.start();
  }

  join(room: string, uid: string, name: string, line: MatchLine): void {
    const m = this.rooms.get(room);
    if (m) return m.join(uid, name, line);
    void this.loading.get(room)?.then((x) => {
      if (x && this.rooms.get(room) === x) x.join(uid, name, line);
    });
  }

  detach(room: string, uid: string): void {
    this.rooms.get(room)?.detach(uid);
  }

  leave(room: string, uid: string): void {
    this.rooms.get(room)?.leave(uid);
  }

  stop(room: string): void {
    this.loading.delete(room);
    const m = this.rooms.get(room);
    if (!m) return;
    this.rooms.delete(room);
    // Over: a moment for the last news (the result) to go out first.
    if (m.ended) setTimeout(() => m.dispose(), LINGER);
    else m.dispose();
  }

  message(room: string, uid: string, msg: Extract<ClientMsg, { t: 'ready' | 'deploy' }>): void {
    const m = this.rooms.get(room);
    if (!m) return;
    if (msg.t === 'ready') m.ready(uid);
    else m.deploy(uid, msg.key, msg.kit);
  }

  binary(room: string, uid: string, data: Uint8Array): void {
    this.rooms.get(room)?.binary(uid, data);
  }

  dispose(): void {
    for (const room of [...this.rooms.keys()]) this.stop(room);
  }
}
