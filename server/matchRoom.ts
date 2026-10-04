/**
 * One room's match on the game server: the sim (`MatchSim`) stepped at 60 Hz,
 * each player's inputs queued and stepped in order, snapshots out at 20 Hz,
 * the match's news (kills, spawns, captures) as JSON, and the zone / score
 * tables a few times a second.
 *
 * Players are known by their hidden browser id (`uid`), so a player who drops
 * out and comes back within the grace time gets the same soldier back.
 */
import { readFileSync } from 'node:fs';
import { sanitizeLoadout, type ClassId, type Loadout } from '../src/data/classes.ts';
import { createInputState, type InputState } from '../src/input/InputState.ts';
import type { MatchEvent, MatchSoldierInfo, MatchStart, ScoreRowMsg, ServerMsg } from '../src/net/lobbyProtocol.ts';
import {
  REWIND_MAX,
  SF,
  SNAPSHOT_EVERY,
  TICK_HZ,
  THING,
  applyInput,
  decodeInputs,
  encodeSoldiers,
  encodeThings,
  snapshotFor,
  type NetInput,
  type NetSoldier,
} from '../src/net/matchProtocol.ts';
import type { ModeKind } from '../src/modes/matchRules.ts';
import { MatchSim, SIM_DT, seeded } from '../src/sim/MatchSim.ts';
import type { Soldier } from '../src/sim/Soldier.ts';
import type { WeaponId } from '../src/weapons/weaponData.ts';
import type { MapDef, Team } from '../src/world/mapTypes.ts';
import { parseMap } from '../src/world/validateMap.ts';

/** How a match talks to one player's connection. */
export interface MatchConn {
  text(msg: ServerMsg): void;
  binary(data: Uint8Array): void;
}

/** Inputs queued past this are stepped two a tick (the browser runs a hair fast). */
const QUEUE_CATCH_UP = 4;
/** Inputs queued past this are dropped (a stalled tab sending a burst). */
const QUEUE_MAX = 30;
/** Zone and score tables every this many ticks (4 Hz). */
const STATE_EVERY = 15;
const CLASSES: readonly ClassId[] = ['assault', 'medic', 'support', 'recon'];

interface Seat {
  uid: string;
  name: string;
  soldier: Soldier;
  conn: MatchConn | null;
  /** Loaded the match: snapshots go out. */
  ready: boolean;
  queue: NetInput[];
  /** Newest input seq received, and the last one stepped (sent back in snapshots). */
  lastSeq: number;
  ack: number;
  input: InputState;
  /** News for this player alone, sent at the end of the tick. */
  events: MatchEvent[];
  /** The kit of the current life. */
  kit: Loadout | null;
}

export interface MatchRoomOptions {
  room: string;
  map: string;
  mode: string;
  log?: (line: string) => void;
  /** Called once when the match has a winner. */
  ended?: (winner: Team) => void;
  /** Where map JSON files are (default: public/maps of the checkout). */
  mapsDir?: string;
}

export class MatchRoom {
  readonly sim: MatchSim;
  private readonly seats = new Map<string, Seat>();
  private readonly byId = new Map<number, Seat>();
  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private readonly broadcastEvents: MatchEvent[] = [];
  private over = false;
  /** Step time (ms), the last few hundred ticks: the load the gateway reads. */
  readonly stepMs: number[] = [];

  private constructor(
    sim: MatchSim,
    private readonly opts: MatchRoomOptions,
  ) {
    this.sim = sim;
    this.wire();
  }

  static async create(opts: MatchRoomOptions): Promise<MatchRoom> {
    const dir = opts.mapsDir ?? 'public/maps';
    if (!/^[\w-]+$/.test(opts.map)) throw new Error(`bad map id ${opts.map}`);
    const map: MapDef = parseMap(JSON.parse(readFileSync(`${dir}/${opts.map}.json`, 'utf8')));
    const mode = (['zone', 'frontline', 'conquest'] as const).find((m) => m === opts.mode) as ModeKind | undefined;
    const sim = await MatchSim.create(map, { mode });
    return new MatchRoom(sim, opts);
  }

  get players(): number {
    return this.seats.size;
  }

  get ended(): boolean {
    return this.over;
  }

  // ---------------------------------------------------------------------------
  // Players

  /**
   * A player joins (or comes back: same uid, same soldier). Sends them the
   * match's start message; snapshots follow once they say they're ready.
   */
  join(uid: string, name: string, conn: MatchConn): void {
    let seat = this.seats.get(uid);
    if (!seat) {
      const team = this.smallerTeam();
      const id = this.nextId++;
      const soldier = this.sim.addSoldier(id, team, name);
      seat = { uid, name, soldier, conn, ready: false, queue: [], lastSeq: 0, ack: 0, input: createInputState(), events: [], kit: null };
      this.hook(seat);
      this.seats.set(uid, seat);
      this.byId.set(id, seat);
      this.sendRoster();
    } else {
      seat.conn = conn;
      seat.ready = false;
      seat.queue.length = 0;
    }
    const s = seat.soldier;
    let life: MatchStart['life'];
    if (s.deployed && s.alive && !s.downed && seat.kit) {
      // Back to a soldier on the field: its spread starts a new stream both ends share.
      const seed = (Math.random() * 2 ** 32) >>> 0;
      s.weapons.rand = seeded(seed);
      const f = s.player.feet;
      life = { pos: [f.x, f.y, f.z], yaw: s.player.yaw, seed, kit: seat.kit };
    }
    const start: MatchStart = {
      room: this.opts.room,
      map: this.opts.map,
      mode: this.sim.zoneMode?.kind ?? 'zone',
      me: seat.soldier.id,
      team: seat.soldier.team,
      tick: this.sim.tick,
      roster: this.roster(),
      life,
    };
    conn.text({ t: 'match', match: start });
  }

  /** The connection dropped; the soldier stays (standing still) until `leave`. */
  detach(uid: string): void {
    const seat = this.seats.get(uid);
    if (!seat) return;
    seat.conn = null;
    seat.ready = false;
    seat.queue.length = 0;
  }

  /** Gone for good: the soldier leaves the field. */
  leave(uid: string): void {
    const seat = this.seats.get(uid);
    if (!seat) return;
    this.sim.removeSoldier(seat.soldier.id);
    this.seats.delete(uid);
    this.byId.delete(seat.soldier.id);
    this.sendRoster();
  }

  ready(uid: string): void {
    const seat = this.seats.get(uid);
    if (!seat) return;
    seat.ready = true;
    seat.lastSeq = 0;
    seat.ack = 0;
    seat.queue.length = 0;
    // Who joined while this player was loading.
    seat.conn?.text({ t: 'roster', roster: this.roster() });
    this.sendState(seat);
  }

  deploy(uid: string, key: string, rawKit: unknown): void {
    const seat = this.seats.get(uid);
    if (!seat || this.over) return;
    const kit = cleanKit(rawKit);
    const s = seat.soldier;
    const at = this.sim.deploy(s.id, /^(base|zone:[\w-]{1,8})$/.test(key) ? key : 'base', kit);
    if (!at) return;
    seat.kit = kit;
    seat.events.push({ k: 'spawn', id: s.id, pos: [at.pos.x, at.pos.y, at.pos.z], yaw: at.yaw, seed: at.seed, kit });
  }

  /** A binary frame from a player (inputs). */
  binary(uid: string, data: Uint8Array): void {
    const seat = this.seats.get(uid);
    if (!seat || !seat.ready) return;
    const list = decodeInputs(data);
    if (!list) return;
    for (const inp of list) {
      // In order, no repeats (a reconnect starts the count again).
      if (inp.seq <= seat.lastSeq && seat.lastSeq - inp.seq < 1e6) continue;
      seat.lastSeq = inp.seq;
      if (seat.queue.length < QUEUE_MAX) seat.queue.push(inp);
    }
  }

  // ---------------------------------------------------------------------------
  // Running

  start(): void {
    if (this.timer) return;
    this.last = performance.now();
    this.acc = 0;
    // Node timers fire at 1 ms granularity at best: catch up on the clock.
    this.timer = setInterval(() => this.pump(), 4);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    this.sim.dispose();
  }

  private pump(): void {
    const now = performance.now();
    this.acc += Math.min(250, now - this.last) / 1000;
    this.last = now;
    let n = 0;
    while (this.acc >= SIM_DT && n < 5) {
      this.acc -= SIM_DT;
      n++;
      const t0 = performance.now();
      this.tick();
      this.stepMs.push(performance.now() - t0);
      if (this.stepMs.length > 300) this.stepMs.shift();
    }
    // Far behind (the process stalled): drop the backlog rather than run in bursts.
    if (this.acc > 0.25) this.acc = 0;
  }

  /** One server tick: everyone's queued inputs, the world, then what goes out. */
  tick(): void {
    const sim = this.sim;
    sim.beginStep(SIM_DT);
    const maxRewind = Math.round(REWIND_MAX * TICK_HZ);
    for (const seat of this.seats.values()) {
      const s = seat.soldier;
      const take = seat.queue.length > QUEUE_CATCH_UP ? 2 : seat.queue.length ? 1 : 0;
      for (let i = 0; i < take; i++) {
        const inp = seat.queue.shift()!;
        applyInput(inp, seat.input);
        s.weapons.shotCaster = sim.casterFor(s, inp.view, maxRewind);
        sim.stepSoldier(s, { state: seat.input, yaw: inp.yaw, pitch: inp.pitch, swayYaw: inp.swayYaw, swayPitch: inp.swayPitch });
        seat.ack = inp.seq;
      }
      // No input this tick: down and waiting still bleed out; on the field, nothing moves.
      if (!take && !(s.alive && s.deployed)) sim.stepSoldier(s, null);
    }
    sim.endStep(SIM_DT);
    if (sim.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();
    if (sim.tick % STATE_EVERY === 0) for (const seat of this.seats.values()) this.sendState(seat);
    this.flushEvents();
  }

  // ---------------------------------------------------------------------------
  // Out

  private sendSnapshots(): void {
    const list: NetSoldier[] = [];
    for (const seat of this.seats.values()) list.push(netSoldier(seat));
    const shared = encodeSoldiers(list);
    const things = encodeThings([...this.sim.throwables.all()].map((g) => ({ id: g.id, kind: THING[g.type], x: g.x, y: g.y, z: g.z })));
    for (const seat of this.seats.values()) {
      if (!seat.conn || !seat.ready) continue;
      const s = seat.soldier;
      const p = s.player;
      const w = s.weapons;
      const st = w.state;
      seat.conn.binary(
        snapshotFor(
          this.sim.tick,
          {
            ack: seat.ack,
            x: p.feet.x,
            y: p.feet.y,
            z: p.feet.z,
            vx: p.velocity.x,
            vy: p.velocity.y,
            vz: p.velocity.z,
            health: p.health.value,
            ammo: st.ammo,
            reserve: Number.isFinite(st.reserve) ? st.reserve : -1,
          },
          shared,
          things,
        ),
      );
    }
  }

  private sendState(seat: Seat): void {
    if (!seat.conn || !seat.ready) return;
    const zm = this.sim.zoneMode;
    seat.conn.text({
      t: 'mstate',
      zones: zm ? zm.rules.zones : [],
      rules: zm ? rulesState(zm.match) : null,
      scores: this.scoreRows(),
    });
  }

  private scoreRows(): ScoreRowMsg[] {
    const sc = this.sim.scores;
    return [...sc.table('blue'), ...sc.table('red')].map((r) => ({ id: r.id, name: r.name, team: r.team, kills: r.kills, deaths: r.deaths, captures: r.captures, score: r.score }));
  }

  private flushEvents(): void {
    const all = this.broadcastEvents.splice(0);
    for (const seat of this.seats.values()) {
      const ev = all.length ? [...all, ...seat.events] : seat.events;
      seat.events = [];
      if (ev.length && seat.conn && seat.ready) seat.conn.text({ t: 'ev', ev });
    }
  }

  private roster(): MatchSoldierInfo[] {
    return [...this.seats.values()].map((s) => ({ id: s.soldier.id, name: s.name, team: s.soldier.team }));
  }

  private sendRoster(): void {
    const roster = this.roster();
    for (const seat of this.seats.values()) if (seat.conn && seat.ready) seat.conn.text({ t: 'roster', roster });
  }

  private smallerTeam(): Team {
    let blue = 0;
    let red = 0;
    for (const s of this.seats.values()) {
      if (s.soldier.team === 'blue') blue++;
      else red++;
    }
    return red < blue ? 'red' : 'blue';
  }

  // ---------------------------------------------------------------------------
  // The sim's news

  private wire(): void {
    const bus = this.sim.bus;
    bus.on('combat:kill', (e) => {
      this.broadcastEvents.push({
        k: 'kill',
        attacker: e.attacker,
        victim: e.victim,
        weapon: e.weapon,
        headshot: e.headshot,
        attackerTeam: e.attackerTeam ?? null,
        victimTeam: e.victimTeam ?? null,
        attackerId: e.attackerId,
        victimId: e.victimId,
      });
    });
    bus.on('combat:hit', (e) => {
      const by = e.attackerId === undefined ? undefined : this.byId.get(e.attackerId);
      by?.events.push({ k: 'hit', head: e.part === 'head', killed: e.killed });
    });
    bus.on('zone:captured', (e) => this.broadcastEvents.push({ k: 'zone', type: 'captured', zone: e.zone, team: e.team }));
    bus.on('zone:neutralized', (e) => this.broadcastEvents.push({ k: 'zone', type: 'neutralized', zone: e.zone, team: e.team }));
    bus.on('mode:event', (e) => this.broadcastEvents.push({ k: 'mode', e }));
    bus.on('grenade:detonate', (e) => this.broadcastEvents.push({ k: 'boom', type: e.type, pos: [e.point.x, e.point.y, e.point.z], tick: this.sim.tick }));
    bus.on('combatant:revived', (e) => this.broadcastEvents.push({ k: 'revived', id: e.id, by: e.byName, byId: e.byId }));
    bus.on('match:ended', (e) => {
      if (this.over) return;
      this.over = true;
      this.broadcastEvents.push({ k: 'end', winner: e.winner });
      this.opts.log?.(`match in room ${this.opts.room} ended: ${e.winner}`);
      this.opts.ended?.(e.winner);
    });
    this.sim.scores.onPoints = (id, points, reason) => this.byId.get(id)?.events.push({ k: 'points', points, reason });
  }

  /** Each seat's soldier reports going down, dying and getting hurt. */
  private hook(seat: Seat): void {
    seat.soldier.hooks = this.hooksFor(seat);
  }

  private hooksFor(seat: Seat): Soldier['hooks'] {
    const s = seat.soldier;
    return {
      hurt: (amount, from, cause) => seat.events.push({ k: 'hurt', amount, from: from ? [from.x, from.y, from.z] : null, cause }),
      down: (cause) => this.broadcastEvents.push({ k: 'down', id: s.id, by: s.killedBy, cause }),
      died: () => this.broadcastEvents.push({ k: 'died', id: s.id, respawn: s.respawnTimer }),
    };
  }
}

/** A seat's soldier as everyone sees it. */
function netSoldier(seat: Seat): NetSoldier {
  const s = seat.soldier;
  const p = s.player;
  const w = s.weapons;
  let flags = 0;
  if (s.deployed) flags |= SF.deployed;
  if (p.alive) flags |= SF.alive;
  if (s.downed) flags |= SF.downed;
  if (p.crouching) flags |= SF.crouch;
  if (w.adsBlend > 0.5) flags |= SF.ads;
  if (p.sprinting) flags |= SF.sprint;
  if (p.grounded) flags |= SF.grounded;
  if (w.state.reloading) flags |= SF.reloading;
  return { id: s.id, flags, x: p.feet.x, y: p.feet.y, z: p.feet.z, yaw: p.yaw, pitch: p.pitch, weapon: w.def.id as WeaponId, health: p.health.value, shots: w.shots & 0xff };
}

/** A kit from a browser, made safe (unknown class: assault). */
function cleanKit(raw: unknown): Loadout {
  const r = (typeof raw === 'object' && raw ? raw : {}) as Partial<Loadout>;
  const cls = CLASSES.includes(r.cls as ClassId) ? (r.cls as ClassId) : 'assault';
  return sanitizeLoadout({ ...r, cls });
}

/** The rules' state as plain data (functions such as the random source left out). */
export function rulesState(rules: object): unknown {
  return JSON.parse(JSON.stringify(rules, (k, v: unknown) => (typeof v === 'function' || k === 'rand' ? undefined : v)));
}
