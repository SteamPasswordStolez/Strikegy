/**
 * One room's match on the game server: the sim (`MatchSim`) stepped at 60 Hz,
 * each player's inputs queued and stepped in order, snapshots out at 30 Hz,
 * the match's news (kills, spawns, captures) as JSON, and the zone / score
 * tables a few times a second.
 *
 * Players are known by their hidden browser id (`uid`), so a player who drops
 * out and comes back within the grace time gets the same soldier back.
 */
import { AIRSPACE } from '../src/vehicles/vehicleData.ts';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import type { Bot } from '../src/ai/Bot.ts';
import { setNavFiles } from '../src/ai/navCache.ts';
import { sanitizeLoadout, type AttachOk, type ClassId, type Loadout } from '../src/data/classes.ts';
import { STATION } from '../src/modes/fortify.ts';
import { createInputState, type InputState } from '../src/input/InputState.ts';
import type { AdoptBot, Badge, Lineup, MatchEvent, MatchSoldierInfo, MatchStart, ScoreRowMsg, ServerMsg } from '../src/net/lobbyProtocol.ts';
import {
  REWIND_MAX,
  SF,
  SNAPSHOT_EVERY,
  TICK_HZ,
  THING,
  VF,
  applyInput,
  decodeTail,
  decodeInputs,
  encodeSoldiers,
  xzRange,
  encodeThings,
  encodeVehicles,
  snapshotFor,
  type NetBotEvent,
  type NetBotState,
  type NetBots,
  type NetDrive,
  type NetInput,
  type NetSoldier,
  type NetVehicle,
} from '../src/net/matchProtocol.ts';
import { MODE_KINDS, type ModeKind } from '../src/modes/matchRules.ts';
import { MATCH } from '../src/modes/matchFlags.ts';
import { MatchSim, SIM_DT, seeded } from '../src/sim/MatchSim.ts';
import type { Soldier } from '../src/sim/Soldier.ts';
import type { Vehicle } from '../src/vehicles/Vehicle.ts';
import { Sight, type Viewer } from './sight.ts';
import type { WeaponId } from '../src/weapons/weaponData.ts';
import type { MapDef, Team } from '../src/world/mapTypes.ts';
import { parseMap } from '../src/world/validateMap.ts';
import { ProgressTracker } from '../src/progression/tracker.ts';
import { weaponLevelOf, weaponLocked } from '../src/progression/unlocks.ts';
import { LifeKills, MagKills, killFacts, standing } from '../src/progression/killFacts.ts';
import { cleanWorn, kfxFor, type Worn } from '../src/progression/worn.ts';
import { attachLevel } from '../src/weapons/attachments.ts';
import type { MatchSummary } from '../src/progression/profile.ts';
import { WEAPONS } from '../src/weapons/weaponData.ts';

// Navmeshes baked ahead of time (`npm run nav`) come from the checkout's disk.
setNavFiles(async (key) => {
  try {
    return new Uint8Array(gunzipSync(readFileSync(`public/nav/${key}.bin.gz`)));
  } catch {
    return null;
  }
});

/** People's soldier ids start here (bots count up from 1 in each room). */
const FIRST_PERSON_ID = 1000;

/** How a match talks to one player's connection. */
export interface MatchConn {
  text(msg: ServerMsg): void;
  binary(data: Uint8Array): void;
}

/** Inputs queued past this are stepped two a tick (the browser runs a hair fast). */
const QUEUE_CATCH_UP = 4;
/** Inputs queued past this are dropped (a stalled tab sending a burst). */
const QUEUE_MAX = 30;
/**
 * Inputs a player may be ahead of real time (ticks). Catching up two a tick
 * is only allowed within this: a client sending inputs faster than 60 a
 * second can't move or shoot faster.
 */
const INPUT_SLACK = 8;
/** Scope sway is a few hundredths of a radian at most; anything bigger is clamped. */
const SWAY_MAX = 0.03;
/** Zone and score tables every this many ticks (4 Hz). */
const STATE_EVERY = 15;
const CLASSES: readonly ClassId[] = ['assault', 'medic', 'support', 'recon'];

interface Seat {
  uid: string;
  name: string;
  /** Its tag (lobby.ts `tagOf`). */
  tag: string;
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
  /** What they wear that others see (their account's; nothing for guests). */
  cos?: Worn;
  /** Their soldier's body. */
  sex?: 'f';
  /** Their level, card, emblem and plate (from the lobby, the account's). */
  badge?: Badge;
  /** Server tick when the player was ready, and inputs stepped since (the input budget). */
  readyTick: number;
  stepped: number;
  /** Hits on others and how many were headshots from over 30 m (a crude aimbot flag, logged). */
  hits: number;
  farHeads: number;
  flagged: boolean;
  /** Where this player's browser last had the vehicle they drive (put there at the next tick). */
  drive: NetDrive | null;
  /** Vehicle moves refused (too fast): logged now and then. */
  refused: number;
  /** This player's browser can run bots (a desktop that said so when ready). */
  hostBots: boolean;
  /** What its browser last sent for the bots it runs (applied at the next tick). */
  botStates: Map<number, NetBotState>;
  botEvents: NetBotEvent[];
  botView: number;
  /** Bots whose browser copy diverged: this seat leaves them on the server for this match. */
  serverBots: Set<number>;
  /** Sim time of the last input frame (a tab in the background sends none: its bots go back to the server). */
  lastFrameAt: number;
  /** How far behind the server its inputs say this player sees others (ticks, smoothed; see `clampView`). */
  lag: number;
  /** Its aim the last few steps (yaw, pitch), newest last: how far it swung just before a hit. */
  aims: [number, number][];
  /** Headshots that came right after a big swing of the aim (an aimbot's snap). */
  snapHeads: number;
  /** Put out by the anticheat already (the lobby is on it). */
  kicked: boolean;
  /** This person's progress through the match (signed in; progression.md 3-1-1), null for guests. */
  progress: ProgressTracker | null;
  /** The aim at the last input stepped (whether they looked round: idle check). */
  lastAim: [number, number];
}

/** Aim swing (rad) within `SNAP_STEPS` steps before a headshot that counts as a snap. */
const SNAP = 0.5;
const SNAP_STEPS = 6;
/**
 * Out of the room, past any doubt: nearly all hits headshots from afar with
 * many of them right after a snap, or vehicle / bot moves refused over and
 * over (teleporting). Lesser signs are only logged (`suspect`).
 */
const KICK = { hits: 40, farHeadShare: 0.85, snapHeads: 12, refused: 300 };

/** No input frame for this long (s): the browser's bots go back to the server. */
const HOST_STALE = 1;

/** Bots one browser runs at most. */
const HOST_MAX = 8;
/** How often bots are handed out to browsers or taken back (ticks). */
const ASSIGN_EVERY = 60;

export interface MatchRoomOptions {
  room: string;
  map: string;
  mode: string;
  /** People only, people with bots filling the room, or people (all on blue) against bots. */
  lineup?: Lineup;
  /** Soldiers in the room, bots included (half a side). */
  size?: number;
  difficulty?: 'easy' | 'normal' | 'hard';
  log?: (line: string) => void;
  /** Called once when the match has a winner. */
  ended?: (winner: Team) => void;
  /** The anticheat puts a player out (the lobby takes them out of the room and keeps them out a while). */
  kick?: (uid: string, reason: string) => void;
  /** Where map JSON files are (default: public/maps of the checkout). */
  mapsDir?: string;
  /** Bots run in people's browsers (squads with people in them; default on). */
  botShare?: boolean;
  /** Simplified controls for everyone (the room's setting). */
  simple?: boolean;
  /** Every weapon open to everyone (the room's "전부 해금"). */
  allUnlocked?: boolean;
  /** A signed-in player's match progress to confirm into their account (the end, leaving, a stop). */
  progress?: (uid: string, summary: MatchSummary) => void;
}

export class MatchRoom {
  readonly sim: MatchSim;
  private readonly seats = new Map<string, Seat>();
  private readonly byId = new Map<number, Seat>();
  private nextId = FIRST_PERSON_ID;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private readonly broadcastEvents: MatchEvent[] = [];
  private over = false;
  /** Step time (ms), the last few hundred ticks: the load the gateway reads. */
  readonly stepMs: number[] = [];
  /** Who may know about which enemy (anti-wallhack). */
  private readonly sight: Sight;

  /** The x / z range of this map's snapshots (aircraft go `AIRSPACE.margin` past the map's edge). */
  private get xz(): number {
    const [w, d] = this.sim.world.map.world.size;
    return xzRange(Math.max(w, d) / 2 + AIRSPACE.margin + 100);
  }

  private constructor(
    sim: MatchSim,
    private readonly opts: MatchRoomOptions,
  ) {
    this.sim = sim;
    this.sight = new Sight(sim);
    this.wire();
  }

  static async create(opts: MatchRoomOptions): Promise<MatchRoom> {
    const dir = opts.mapsDir ?? 'public/maps';
    if (!/^[\w-]+$/.test(opts.map)) throw new Error(`bad map id ${opts.map}`);
    const map: MapDef = parseMap(JSON.parse(readFileSync(`${dir}/${opts.map}.json`, 'utf8')));
    const mode = MODE_KINDS.find((m) => m === opts.mode) as ModeKind | undefined;
    const lineup = opts.lineup ?? 'users';
    const side = Math.max(1, Math.floor((opts.size ?? 24) / 2));
    const bots = lineup === 'users' ? null : { blue: side, red: side, difficulty: opts.difficulty ?? 'normal' };
    const sim = await MatchSim.create(map, { mode, bots, teamSize: { blue: side, red: side }, simple: !!opts.simple });
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
  join(player: { uid: string; name: string; tag?: string; team?: Team; xp?: number; weapons?: Record<string, number>; boost?: Partial<Record<'xp' | 'weapon' | 'tickets', number>>; cos?: unknown; sex?: unknown; badge?: Badge }, conn: MatchConn): void {
    const { uid, name } = player;
    let seat = this.seats.get(uid);
    if (!seat) {
      // The lobby's side (random at the start, or picked); all on blue against the bots.
      const team = this.opts.lineup === 'coop' ? 'blue' : (player.team ?? this.smallerTeam());
      const id = this.nextId++;
      const soldier = this.sim.addSoldier(id, team, name);
      seat = { uid, name, tag: player.tag ?? '', soldier, conn, ready: false, queue: [], lastSeq: 0, ack: 0, input: createInputState(), events: [], kit: null, readyTick: 0, stepped: 0, hits: 0, farHeads: 0, flagged: false, drive: null, refused: 0, hostBots: false, botStates: new Map(), botEvents: [], botView: 0, serverBots: new Set(), lastFrameAt: -Infinity, lag: -1, aims: [], snapHeads: 0, kicked: false, progress: null, lastAim: [0, 0] };
      if (player.xp !== undefined) seat.progress = this.tracker(seat, player.xp, player.weapons, player.boost);
      seat.cos = cleanWorn(player.cos);
      seat.badge = player.badge ? { ...player.badge } : undefined;
      if (player.sex === 'f') seat.sex = 'f';
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
      size: Math.max(1, Math.floor((this.opts.size ?? 24) / 2)) * 2,
      difficulty: this.opts.difficulty ?? 'normal',
      simple: !!this.opts.simple,
      allUnlocked: !!this.opts.allUnlocked,
    };
    conn.text({ t: 'match', match: start });
  }

  /** The connection dropped; the soldier stays (standing still) until `leave`. */
  detach(uid: string): void {
    const seat = this.seats.get(uid);
    if (!seat) return;
    this.releaseAll(seat);
    seat.conn = null;
    seat.ready = false;
    seat.queue.length = 0;
    seat.drive = null;
    seat.input = createInputState();
  }

  /** Gone for good: the soldier leaves the field. */
  leave(uid: string): void {
    const seat = this.seats.get(uid);
    if (!seat) return;
    // Left before the end: undone with two people or fewer, kept without the bonuses with more (the anticheat's kick: undone).
    const tr = seat.progress;
    if (tr && !tr.done) this.opts.progress?.(uid, tr.leave(this.seats.size, seat.kicked));
    this.releaseAll(seat);
    this.sim.removeSoldier(seat.soldier.id);
    this.seats.delete(uid);
    this.byId.delete(seat.soldier.id);
    this.sendRoster();
  }

  ready(uid: string, hostBots = false): void {
    const seat = this.seats.get(uid);
    if (!seat) return;
    // A reload: whatever this browser ran before is gone.
    this.releaseAll(seat, false);
    seat.hostBots = hostBots;
    seat.ready = true;
    seat.lastSeq = 0;
    seat.ack = 0;
    seat.queue.length = 0;
    seat.drive = null;
    seat.input = createInputState();
    seat.readyTick = this.sim.tick;
    seat.stepped = 0;
    // The browser may spend seconds loading after `match`: restore what the
    // soldier is doing NOW, including news it missed while not ready.
    const s = seat.soldier;
    seat.events.length = 0;
    if (s.deployed && (s.alive || s.downed) && seat.kit) {
      const seed = (Math.random() * 2 ** 32) >>> 0;
      s.weapons.rand = seeded(seed);
      const f = s.player.feet;
      seat.events.push({
        k: 'spawn',
        id: s.id,
        pos: [f.x, f.y, f.z],
        yaw: s.player.yaw,
        seed,
        kit: seat.kit,
      });
      if (s.downed) seat.events.push({ k: 'down', id: s.id, by: s.killedBy, cause: 'bullet' });
      else if (s.ride) seat.events.push({ k: 'seat', v: s.ride.v.id, seat: s.ride.seat });
      else if (s.chute)
        seat.events.push({
          k: 'seat',
          v: null,
          seat: -1,
          chute: [f.x, f.y, f.z, s.chute.x, s.chute.y, s.chute.z],
        });
    } else if (seat.kit) {
      seat.events.push({
        k: 'died',
        id: s.id,
        respawn: Number.isFinite(s.respawnTimer) ? Math.max(0, s.respawnTimer) : -1,
      });
    }
    // Who joined while this player was loading.
    seat.conn?.text({ t: 'roster', roster: this.roster() });
    this.sendState(seat);
  }

  deploy(uid: string, key: string, rawKit: unknown): void {
    const seat = this.seats.get(uid);
    if (!seat || this.over) return;
    // Signed in: weapons their level hasn't opened give way to the class's defaults, attachments their
    // weapon's level hasn't opened come off (guests have no level here).
    const tr = seat.progress;
    const check = tr && !this.opts.allUnlocked;
    const kit = cleanKit(
      rawKit,
      check ? (id) => weaponLocked(id, tr.liveXp) : undefined,
      check ? (w, a) => weaponLevelOf(tr.weaponXp(w)).level >= attachLevel(WEAPONS[w], a) : undefined,
    );
    const s = seat.soldier;
    const ok = /^(base|zone:[\w-]{1,8}|beacon:\d{1,6}|mate:\d{1,6}|tank:[a-z]{2,12}|jet:[a-z]{2,12}|veh:\d{1,6}|ship:\d{1,6})$/.test(key);
    const at = this.sim.deploy(s.id, ok ? key : 'base', kit);
    if (!at) return;
    // Others draw and hear the attachments: a new build goes out with the roster.
    const newBuild = JSON.stringify(kit.attach ?? {}) !== JSON.stringify(seat.kit?.attach ?? {});
    seat.kit = kit;
    if (newBuild) this.sendRoster();
    // The field contract picked on the deploy screen (step 5), fixed once set.
    const contract = (rawKit as { contract?: unknown } | null)?.contract;
    if (typeof contract === 'string') seat.progress?.setContract(contract);
    seat.progress?.setClass(kit.cls);
    seat.events.push({ k: 'spawn', id: s.id, pos: [at.pos.x, at.pos.y, at.pos.z], yaw: at.yaw, seed: at.seed, kit });
    // Into a vehicle after the spawn (its browser takes the seat after the new life).
    if (ok && /^(tank|jet|veh):/.test(key)) this.sim.vehicles?.board(s, key);
  }

  /** A binary frame from a player (inputs). */
  binary(uid: string, data: Uint8Array): void {
    const seat = this.seats.get(uid);
    if (!seat || !seat.ready) return;
    const list = decodeInputs(data);
    if (!list) return;
    seat.lastFrameAt = this.sim.time;
    for (const inp of list) this.clampView(seat, inp);
    const tail = decodeTail(data);
    let fresh = false;
    for (const inp of list) {
      // In order, no repeats (a reconnect starts the count again).
      if (inp.seq <= seat.lastSeq && seat.lastSeq - inp.seq < 1e6) continue;
      seat.lastSeq = inp.seq;
      fresh = true;
      if (seat.queue.length < QUEUE_MAX) seat.queue.push(inp);
    }
    // The driven vehicle's place only from a frame with something new (not a late or second copy putting it back).
    if (tail?.drive && fresh) seat.drive = tail.drive;
    // Bot actions may arrive late over TCP while newer poses came over UDP.
    // Keep those reliable actions, but never rewind bots to the older pose.
    if (tail?.bots) this.takeBots(seat, tail.bots, fresh);
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

  /**
   * The match is being taken down without a winner (the owner ended it, the
   * staff closed the room, the server stops): everyone signed in keeps what
   * rose and the completion bonus for the time played (not their doing).
   */
  settle(): void {
    for (const seat of this.seats.values()) {
      const tr = seat.progress;
      if (tr && !tr.done) this.opts.progress?.(seat.uid, tr.stop());
    }
  }

  /** A signed-in player's tracker: levels reached are told to them as they happen. */
  private tracker(seat: Seat, xp: number, weaponXp?: Record<string, number>, boost?: Partial<Record<'xp' | 'weapon' | 'tickets', number>>): ProgressTracker {
    const lineup = this.opts.lineup ?? 'users';
    const tr = new ProgressTracker({ kind: 'multi', map: this.opts.map, mode: this.sim.zoneMode?.kind ?? this.opts.mode, difficulty: lineup === 'users' ? null : (this.opts.difficulty ?? 'normal'), startXp: xp, weaponXp, boost });
    tr.onLevel = (l) => seat.events.push({ k: 'prog', level: l.level, promoted: l.promoted, xp: tr.liveXp });
    tr.onWeaponLevel = (l) => seat.events.push({ k: 'wprog', weapon: l.weapon, level: l.level });
    tr.onRibbon = (r) => seat.events.push({ k: 'ribbon', id: r.id, n: r.count, xp: tr.liveXp });
    return tr;
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
      // Never more inputs than ticks since ready (plus a little slack): no speed hack by flooding.
      const budget = this.sim.tick - seat.readyTick + INPUT_SLACK - seat.stepped;
      const take = Math.min(budget, seat.queue.length > QUEUE_CATCH_UP ? 2 : seat.queue.length ? 1 : 0);
      let moved = false;
      for (let i = 0; i < take; i++) {
        const inp = seat.queue.shift()!;
        seat.stepped++;
        inp.swayYaw = Math.max(-SWAY_MAX, Math.min(SWAY_MAX, inp.swayYaw));
        inp.swayPitch = Math.max(-SWAY_MAX, Math.min(SWAY_MAX, inp.swayPitch));
        applyInput(inp, seat.input);
        if (seat.progress) {
          const looked = inp.yaw !== seat.lastAim[0] || inp.pitch !== seat.lastAim[1];
          seat.lastAim = [inp.yaw, inp.pitch];
          moved ||= looked || seat.input.moveX !== 0 || seat.input.moveY !== 0 || seat.input.fire || seat.input.jump;
        }
        seat.aims.push([inp.yaw, inp.pitch]);
        if (seat.aims.length > SNAP_STEPS + 1) seat.aims.shift();
        s.weapons.shotCaster = sim.casterFor(s.id, inp.view, maxRewind);
        sim.stepSoldier(s, { state: seat.input, yaw: inp.yaw, pitch: inp.pitch, swayYaw: inp.swayYaw, swayPitch: inp.swayPitch });
        seat.ack = inp.seq;
      }
      // No input this tick: down and waiting still bleed out; on the field, nothing moves.
      // Down, the keys stay as last sent: browsers' frames come unevenly, and a tick without
      // one used to let go of the give-up key, so holding it often never got there (2026-10-18).
      if (!take && !(s.alive && s.deployed)) sim.stepSoldier(s, s.downed ? { state: seat.input, yaw: s.player.yaw, pitch: s.player.pitch } : null);
      if (seat.progress && !this.over) seat.progress.tick(SIM_DT, moved);
      this.applyBots(seat, maxRewind);
      // The vehicle this player drives: where their browser has it.
      if (seat.drive && sim.vehicles) {
        if (!sim.vehicles.applyDrive(s, seat.drive)) {
          if (++seat.refused % 120 === 1) this.opts.log?.(`suspect: ${seat.name} (${seat.uid.slice(0, 8)}) in room ${this.opts.room}: vehicle moved too fast or through a wall (${seat.refused})`);
          if (seat.refused >= KICK.refused) this.kick(seat, 'vehicle teleport');
        }
        seat.drive = null;
      }
    }
    sim.endStep(SIM_DT);
    this.checkBots();
    if (sim.tick % ASSIGN_EVERY === 0) this.assignBots();
    if (sim.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();
    if (sim.tick % STATE_EVERY === 0) for (const seat of this.seats.values()) this.sendState(seat);
    this.flushEvents();
  }

  /**
   * How far back a shot may be judged is the player's real lag, not what the
   * input says: honest browsers stay close to a steady value (round trip +
   * the drawing delay), so a view tick much older than that (picking, shot
   * by shot, where someone was a moment ago) is moved up to it.
   */
  private clampView(seat: Seat, inp: NetInput): void {
    const behind = this.sim.tick - inp.view;
    if (seat.lag < 0) seat.lag = Math.min(behind, REWIND_MAX * TICK_HZ);
    // Follows a growing lag slowly, a shrinking one at once.
    seat.lag = behind < seat.lag ? behind : seat.lag + Math.min(0.05, behind - seat.lag);
    seat.lag = Math.max(0, Math.min(REWIND_MAX * TICK_HZ, seat.lag));
    if (behind > seat.lag + 4) inp.view = this.sim.tick - (seat.lag + 4);
  }

  /** The anticheat: someone past any doubt goes (the lobby keeps them out of the room a while). */
  private kick(seat: Seat, reason: string): void {
    if (seat.kicked) return;
    seat.kicked = true;
    this.opts.log?.(`kick: ${seat.name} (${seat.uid.slice(0, 8)}) in room ${this.opts.room}: ${reason}`);
    this.opts.kick?.(seat.uid, reason);
  }

  // ---------------------------------------------------------------------------
  // Bots run in people's browsers (room setting `botShare`)

  /** Bot id -> the seat whose browser runs it. */
  private readonly owners = new Map<number, Seat>();

  /** What a browser sent for the bots it runs: kept for the next tick. */
  private takeBots(seat: Seat, frame: NetBots, fresh: boolean): void {
    if (fresh) {
      seat.botView = frame.view;
      for (const st of frame.states) if (this.owners.get(st.id) === seat) seat.botStates.set(st.id, st);
    }
    for (const e of frame.events) if (seat.botEvents.length < 64 && this.owners.get(e.id) === seat) seat.botEvents.push(e);
  }

  private applyBots(seat: Seat, maxRewind: number): void {
    const bots = this.sim.bots;
    if (!bots || (!seat.botStates.size && !seat.botEvents.length)) return;
    const byId = (id: number) => (this.owners.get(id) === seat ? bots.bots.find((b) => b.id === id) : undefined);
    for (const st of seat.botStates.values()) {
      const b = byId(st.id);
      if (b && !this.sim.puppetMove(b, new THREE.Vector3(st.x, st.y, st.z), st.yaw, st.aimYaw, st.aimPitch, st.crouch)) {
        // A rejected path can leave the two copies on opposite sides of a
        // wall. Keeping it delegated repeats that rejection every frame and
        // used to kick a normal player for their AI. Reject the move AND its
        // actions, then keep this bot authoritative here for the match.
        this.owners.delete(b.id);
        seat.serverBots.add(b.id);
        this.sim.unpuppet(b);
        seat.events.push({ k: 'release', ids: [b.id] });
        this.opts.log?.(`room ${this.opts.room}: bot ${b.id} returned to server after rejected move from ${seat.name}`);
      }
    }
    seat.botStates.clear();
    for (const e of seat.botEvents) {
      const b = byId(e.id);
      if (!b) continue;
      if (e.k === 'shot') this.sim.puppetShot(b, new THREE.Vector3(...e.dir), seat.botView, maxRewind);
      else if (e.k === 'throw') this.sim.puppetThrow(b, e.type, new THREE.Vector3(...e.origin), new THREE.Vector3(...e.vel));
      else if (e.k === 'revive') this.sim.puppetRevive(b, e.target);
      else this.sim.puppetMedkit(b);
    }
    seat.botEvents.length = 0;
  }

  /** Bots down, dead, benched or in a vehicle go back to the server at once. */
  private checkBots(): void {
    if (!this.owners.size) return;
    const back = new Map<Seat, number[]>();
    for (const [id, seat] of this.owners) {
      const b = this.sim.bots?.bots.find((x) => x.id === id);
      if (b && b.alive && !b.benched && !b.riding && this.sim.time - seat.lastFrameAt < HOST_STALE) continue;
      if (b) this.sim.unpuppet(b);
      this.owners.delete(id);
      const list = back.get(seat) ?? [];
      list.push(id);
      back.set(seat, list);
    }
    for (const [seat, ids] of back) seat.events.push({ k: 'release', ids });
  }

  /**
   * Hands the bots of each squad with people in it to one of those people's
   * browsers (desktops that can run them, up to `HOST_MAX` each), and takes
   * back what no longer fits.
   */
  private assignBots(): void {
    const bots = this.sim.bots;
    if (!bots || this.opts.botShare === false || this.over) return;
    const host = (id: number): Seat | undefined => {
      const seat = this.byId.get(id);
      return seat && seat.ready && seat.conn && seat.hostBots && this.sim.time - seat.lastFrameAt < HOST_STALE / 2 ? seat : undefined;
    };
    const want = new Map<number, Seat>();
    const load = new Map<Seat, number>();
    for (const sq of this.sim.squads) {
      const owner = sq.members.map((m) => host(m.id)).find((s) => s);
      if (!owner) continue;
      for (const m of sq.members) {
        const b = bots.bots.find((x) => x.id === m.id);
        if (!b || !b.alive || b.benched || b.riding || owner.serverBots.has(b.id)) continue;
        const n = load.get(owner) ?? 0;
        if (n >= HOST_MAX) break;
        load.set(owner, n + 1);
        want.set(b.id, owner);
      }
    }
    const released = new Map<Seat, number[]>();
    for (const [id, seat] of this.owners) {
      if (want.get(id) === seat) continue;
      this.owners.delete(id);
      const b = bots.bots.find((x) => x.id === id);
      if (b) this.sim.unpuppet(b);
      released.set(seat, [...(released.get(seat) ?? []), id]);
    }
    for (const [seat, ids] of released) seat.events.push({ k: 'release', ids });
    const adopted = new Map<Seat, AdoptBot[]>();
    for (const [id, seat] of want) {
      if (this.owners.has(id)) continue;
      const b = bots.bots.find((x) => x.id === id)!;
      this.owners.set(id, seat);
      b.puppet = true;
      const f = b.feet;
      const spec: AdoptBot = {
        id,
        name: b.name,
        team: b.team,
        cls: b.cls,
        weapon: b.def.id,
        personality: b.personality,
        pos: [f.x, f.y, f.z],
        yaw: b.yaw,
        health: b.health.value,
        medkits: Number.isFinite(b.medkits) ? b.medkits : 99,
        grenades: b.grenadeCounts,
      };
      adopted.set(seat, [...(adopted.get(seat) ?? []), spec]);
    }
    for (const [seat, list] of adopted) seat.events.push({ k: 'adopt', bots: list });
  }

  /** Every bot this seat's browser runs goes back to the server (`tell`: say so). */
  private releaseAll(seat: Seat, tell = true): void {
    const ids: number[] = [];
    for (const [id, s] of this.owners) {
      if (s !== seat) continue;
      this.owners.delete(id);
      const b = this.sim.bots?.bots.find((x) => x.id === id);
      if (b) this.sim.unpuppet(b);
      ids.push(id);
    }
    seat.botStates.clear();
    seat.botEvents.length = 0;
    if (tell && ids.length) seat.events.push({ k: 'release', ids });
  }

  // ---------------------------------------------------------------------------
  // Out

  private sendSnapshots(): void {
    const all: { n: NetSoldier; team: Team }[] = [];
    for (const seat of this.seats.values()) all.push({ n: netSoldier(seat), team: seat.soldier.team });
    for (const b of this.sim.bots?.bots ?? []) if (!b.benched) all.push({ n: netBot(b), team: b.team });
    // What everyone may know of the enemy (anti-wallhack): see `Sight`.
    const viewers: Viewer[] = [];
    for (const seat of this.seats.values()) {
      if (!seat.conn || !seat.ready) continue;
      const s = seat.soldier;
      const p = s.player;
      const eye = s.deployed && p.alive ? p.feet.clone().setY(p.feet.y + p.eyeHeight) : null;
      const bots: THREE.Vector3[] = [];
      for (const [id, owner] of this.owners) if (owner === seat) {
        const b = this.sim.bots?.bots.find((x) => x.id === id);
        if (b) bots.push(b.feet);
      }
      viewers.push({ id: s.id, team: s.team, eye, yaw: p.yaw, bots });
    }
    this.sight.step(viewers);
    const flying = [...this.sim.throwables.all()].map((g) => ({ id: g.id & 0x7fff, kind: THING[g.type] as number, x: g.x, y: g.y, z: g.z }));
    for (const g of this.sim.gadgets.shotsInFlight()) flying.push({ id: 0x8000 | (g.id & 0x3fff), kind: THING[g.kind], x: g.pos.x, y: g.pos.y, z: g.pos.z });
    const range = this.xz;
    const vehicles = encodeVehicles((this.sim.vehicles?.world.vehicles ?? []).map(netVehicle), range);
    const ENEMY_HIDDEN = SF.needMedkit | SF.needAmmo;
    for (const seat of this.seats.values()) {
      if (!seat.conn || !seat.ready) continue;
      const s = seat.soldier;
      const team = s.team;
      const mine: NetSoldier[] = [];
      for (const x of all) {
        // Free-for-all: only oneself is a friend.
        if (x.n.id === s.id || (!MATCH.ffa && x.team === team)) mine.push(x.n);
        // An enemy: only when known, and without its health or what it is short of.
        else if (this.sight.knows(s.id, x.n.id)) mine.push({ ...x.n, health: 0, flags: x.n.flags & ~ENEMY_HIDDEN });
      }
      const shared = encodeSoldiers(mine, range);
      // Placed gadgets: the side's own, and the enemy's only up close (a mine is small, a beacon not much bigger).
      const eye = s.player.feet;
      const placed = [...flying];
      for (const b of this.sim.gadgets.beacons) if (b.owner.team === team || (s.deployed && b.pos.distanceTo(eye) < 60)) placed.push({ id: 0x8000 | (b.id & 0x3fff), kind: THING.beacon, x: b.pos.x, y: b.pos.y, z: b.pos.z });
      for (const m of this.sim.gadgets.mines) if (m.owner.team === team || (s.deployed && m.pos.distanceTo(eye) < 20)) placed.push({ id: 0x8000 | (m.id & 0x3fff), kind: THING.mine, x: m.pos.x, y: m.pos.y, z: m.pos.z });
      const things = encodeThings(placed, range);
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
          vehicles,
          range,
        ),
      );
    }
  }

  private sendState(seat: Seat): void {
    if (!seat.conn || !seat.ready) return;
    const zm = this.sim.zoneMode;
    const fort = this.sim.fort;
    seat.conn.text({
      t: 'mstate',
      zones: zm ? zm.rules.zones : [],
      rules: zm ? rulesState(zm.match) : null,
      scores: this.scoreRows(),
      fort: fort
        ? {
            slots: fort.slots.filter((s) => s.built || s.work > 0).map((s) => [s.id, Math.round(s.work * 100) / 100, s.built ? 1 : 0]),
            stations: fort.stations.filter((s) => s.uses < STATION.uses).map((s) => [s.id, s.uses]),
          }
        : undefined,
      // The side's own beacons only (where the enemy spawns isn't news to give out).
      beacons: this.sim.gadgets.beacons.filter((b) => b.owner.team === seat.soldier.team).map((b) => ({ id: b.id, team: b.owner.team, owner: b.owner.name, uses: b.uses, pos: [b.pos.x, b.pos.y, b.pos.z] })),
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
    const out: MatchSoldierInfo[] = [...this.seats.values()].map((s) => ({ id: s.soldier.id, name: s.name, tag: s.tag || undefined, team: s.soldier.team, squad: this.sim.squadOf(s.soldier.id)?.index ?? 0, ...(s.kit?.attach ? { att: s.kit.attach } : {}), ...(s.cos ? { cos: s.cos } : {}), ...(s.sex ? { sex: s.sex } : {}), ...(s.badge ? { badge: s.badge } : {}) }));
    for (const b of this.sim.bots?.bots ?? []) if (!b.benched) out.push({ id: b.id, name: b.name, team: b.team, squad: this.sim.squadOf(b.id)?.index ?? 0, bot: true });
    return out;
  }

  /** A squad leader's call-in. */
  callIn(uid: string, kind: string, point: [number, number, number] | null): void {
    const seat = this.seats.get(uid);
    if (!seat || this.over) return;
    this.sim.callIn(seat.soldier.id, kind, point ? new THREE.Vector3(...point) : null);
  }

  private sendRoster(): void {
    const roster = this.roster();
    for (const seat of this.seats.values()) if (seat.conn && seat.ready) seat.conn.text({ t: 'roster', roster });
  }

  private smallerTeam(): Team {
    // People together against the bots.
    if (this.opts.lineup === 'coop') return 'blue';
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
    this.sim.onRoster = () => this.sendRoster();
    this.sim.onBoom = (kind, p) => this.broadcastEvents.push({ k: 'boom', type: kind, pos: [p.x, p.y, p.z], tick: this.sim.tick });
    this.sim.onGive = (by, to, kind) => {
      const ev: MatchEvent = { k: 'given', kind, by: by?.id ?? -1, to: to.id };
      if (by) this.byId.get(by.id)?.events.push(ev);
      this.byId.get(to.id)?.events.push(ev);
    };
    this.sim.onCallIn = (kind, p, owner) => this.broadcastEvents.push({ k: 'callin', kind, pos: [p.x, p.y, p.z], owner: { id: owner.id, name: owner.name, team: owner.team, squad: owner.squad } });
    this.sim.onIncoming = (p) => this.broadcastEvents.push({ k: 'incoming', pos: [p.x, p.y, p.z] });
    this.sim.onSpotted = (team, ids) => {
      this.sight.spot(team, ids, 2);
      for (const seat of this.seats.values()) if (seat.soldier.team === team) seat.events.push({ k: 'spotted', ids, sec: 2 });
    };
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
        ...(() => {
          const fx = e.attackerId === undefined ? undefined : kfxFor(this.byId.get(e.attackerId)?.cos, e.weapon);
          return fx ? { fx } : {};
        })(),
      });
    });
    bus.on('combat:hit', (e) => {
      const by = e.attackerId === undefined ? undefined : this.byId.get(e.attackerId);
      if (!by) return;
      by.events.push({ k: 'hit', head: e.part === 'head', killed: e.killed, dmg: Math.round(e.damage) });
      // Aimbot signs: nearly every hit a headshot from afar, many right after a snap of the aim.
      by.hits++;
      if (e.part === 'head' && e.point.distanceTo(by.soldier.player.feet) > 30) by.farHeads++;
      if (e.part === 'head' && by.aims.length > 1) {
        const [y0, p0] = by.aims[0]!;
        const [y1, p1] = by.aims[by.aims.length - 1]!;
        const swing = Math.hypot(Math.atan2(Math.sin(y1 - y0), Math.cos(y1 - y0)), p1 - p0);
        if (swing > SNAP) by.snapHeads++;
      }
      if (by.hits >= 25 && by.farHeads / by.hits > 0.7 && by.hits % 25 === 0) {
        this.opts.log?.(`suspect: ${by.name} (${by.uid.slice(0, 8)}) in room ${this.opts.room}: ${by.farHeads}/${by.hits} hits were headshots past 30 m, ${by.snapHeads} right after a snap`);
      }
      if (by.hits >= KICK.hits && by.farHeads / by.hits >= KICK.farHeadShare && by.snapHeads >= KICK.snapHeads) this.kick(by, 'aim');
    });
    bus.on('combat:kill', (e) => {
      if (e.attackerId !== undefined && this.byId.has(e.attackerId)) this.opts.log?.(`kill ${this.opts.room}: ${e.attacker} > ${e.victim} (${e.weapon}${e.headshot ? ', head' : ''})`);
    });
    bus.on('zone:captured', (e) => this.broadcastEvents.push({ k: 'zone', type: 'captured', zone: e.zone, team: e.team }));
    bus.on('zone:neutralized', (e) => this.broadcastEvents.push({ k: 'zone', type: 'neutralized', zone: e.zone, team: e.team }));
    bus.on('mode:event', (e) => {
      this.broadcastEvents.push({ k: 'mode', e });
      // S&D: a new round. Soldiers still up are put back at their side's start (and told so); the rest may deploy.
      if (e.type !== 'round') return;
      for (const seat of this.seats.values()) {
        const at = this.sim.roundRespawn(seat.soldier.id, seat.kit ?? undefined);
        if (at) seat.events.push({ k: 'spawn', id: seat.soldier.id, pos: [at.pos.x, at.pos.y, at.pos.z], yaw: at.yaw, seed: at.seed, kit: seat.kit });
      }
    });
    bus.on('combatant:revived', (e) => this.broadcastEvents.push({ k: 'revived', id: e.id, by: e.byName, byId: e.byId }));
    bus.on('match:ended', (e) => {
      if (this.over) return;
      this.over = true;
      // Everyone signed in still here: the completion and win bonuses, then into their accounts.
      for (const seat of this.seats.values()) {
        const tr = seat.progress;
        if (!tr || tr.done) continue;
        const s = seat.soldier;
        const won = e.winnerId !== undefined ? e.winnerId === s.id : e.winner === s.team;
        tr.score = this.sim.scores.get(s.id)?.score ?? 0;
        this.opts.progress?.(seat.uid, tr.finish(won, standing(this.sim.scores.table(null), s.id, s.team)));
      }
      this.broadcastEvents.push({ k: 'end', winner: e.winner, winnerId: e.winnerId });
      this.opts.log?.(`match in room ${this.opts.room} ended: ${e.winner}`);
      this.opts.ended?.(e.winner);
    });
    this.sim.scores.onPoints = (id, points, reason) => this.byId.get(id)?.events.push({ k: 'points', points, reason });
    // Progress (signed-in players): score into XP, kills to the weapon, building once a structure.
    const now = () => this.sim.tick * SIM_DT;
    this.sim.scores.onScore = (id, points, reason, other) => this.byId.get(id)?.progress?.points(reason, points, now(), other);
    const weaponIds = new Map(Object.values(WEAPONS).map((w) => [w.name, w.id]));
    const lifeKills = new LifeKills();
    const magKills = new MagKills();
    const feetOf = (id: number | undefined) => {
      if (id === undefined) return null;
      const s = this.byId.get(id)?.soldier;
      if (s) return s.player.feet;
      return this.sim.bots?.bots.find((b) => b.id === id)?.feet ?? null;
    };
    bus.on('combat:kill', (e) => {
      const victimStreak = e.victimId !== undefined ? lifeKills.of(e.victimId) : 0;
      if (e.attackerId !== undefined) lifeKills.kill(e.attackerId);
      if (e.victimId !== undefined) lifeKills.died(e.victimId);
      const seat = e.attackerId === undefined ? undefined : this.byId.get(e.attackerId);
      const tr = seat?.progress;
      if (!seat || !tr || e.victimId === e.attackerId) return;
      if (!MATCH.ffa && e.victimTeam && e.victimTeam === e.attackerTeam) return;
      // What the kill was (camo challenges, ribbons, missions, bounties): the same facts solo games count.
      const s = seat.soldier;
      const weaponId = weaponIds.get(e.weapon) ?? null;
      const top = this.sim.scores
        .table(null)
        .filter((r) => r.id !== s.id && (MATCH.ffa || r.team !== s.team))
        .sort((a, b) => b.score - a.score)[0];
      tr.kill(
        killFacts({
          weaponId,
          weaponName: e.weapon,
          headshot: e.headshot,
          melee: !!e.melee,
          killer: s.player.feet,
          victim: feetOf(e.victimId),
          ads: s.weapons.adsBlend,
          riding: !!s.ride,
          magKills: weaponId ? magKills.kill(s.id, weaponId, s.weapons.state.reloads) : 0,
          held: MATCH.ffa ? [] : (this.sim.zoneMode?.zones ?? []).filter((z) => z.owner === s.team).map((z) => ({ x: z.x, z: z.z, r: z.radius })),
          mates: (this.sim.squadOf(s.id)?.mates(s.id) ?? []).filter((m) => m.alive).map((m) => m.feet),
          victimTop: !!top && top.id === e.victimId && top.score > 0,
          victimStreak,
        }),
      );
    });
    bus.on('combatant:died', (e) => this.byId.get(e.id)?.progress?.death());
    bus.on('vehicle:destroyed', (e) => {
      const seat = e.byId === undefined ? undefined : this.byId.get(e.byId);
      if (!seat?.progress || (e.home && e.home === seat.soldier.team && !MATCH.ffa)) return;
      if (e.air) seat.progress.count('airKills');
      else if (e.armor) seat.progress.count('armorKills');
    });
    bus.on('support:called', (e) => this.byId.get(e.ownerId)?.progress?.count('callins'));
    bus.on('mode:event', (e) => {
      if (e.type === 'charge' && (e.state === 'armed' || e.state === 'defused')) this.byId.get(e.by)?.progress?.count('objectives');
    });
    this.sim.onBuilt = (id, slot) => this.byId.get(id)?.progress?.builtAt(slot.id, slot.kind, now(), MATCH.truce);
    this.sim.onRefilled = (id) => this.byId.get(id)?.progress?.refilled();
    if (this.sim.fort) {
      this.sim.fort.onLost = (slot) => {
        for (const seat of this.seats.values()) seat.progress?.lostAt(slot.id, now());
      };
    }
    const vehicles = this.sim.vehicles;
    if (vehicles) {
      vehicles.onSeat = (s, v, seat, chute) => {
        const to = this.byId.get(s.id);
        if (!to) return;
        const f = s.player.feet;
        if (v) to.events.push({ k: 'seat', v: v.id, seat });
        else if (chute && s.chute) to.events.push({ k: 'seat', v: null, seat: -1, chute: [f.x, f.y, f.z, s.chute.x, s.chute.y, s.chute.z] });
        else to.events.push({ k: 'seat', v: null, seat: -1, pos: [f.x, f.y, f.z] });
      };
      vehicles.onRocketTank = (team, zone, who, id) => {
        for (const seat of this.seats.values()) if (seat.soldier.team === team) seat.events.push({ k: 'rocketTank', zone, who, id });
      };
    }
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
      died: () => this.broadcastEvents.push({ k: 'died', id: s.id, respawn: Number.isFinite(s.respawnTimer) ? s.respawnTimer : -1 }),
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
  if (s.cls !== 'medic' && s.medkits === 0) flags |= SF.needMedkit;
  if (w.needsAmmo) flags |= SF.needAmmo;
  if (s.ride) flags |= SF.riding;
  if (s.chute) flags |= SF.chute;
  return { id: s.id, flags, x: p.feet.x, y: p.feet.y, z: p.feet.z, yaw: p.yaw, pitch: p.pitch, weapon: w.def.id as WeaponId, health: p.health.value, shots: w.shots & 0xff };
}

/** A bot as everyone sees it. */
function netBot(b: Bot): NetSoldier {
  let flags = 0;
  if (b.alive || b.downed) flags |= SF.deployed;
  if (b.alive) flags |= SF.alive;
  if (b.downed) flags |= SF.downed;
  if (b.crouching) flags |= SF.crouch;
  if (b.horizontalSpeed > 5) flags |= SF.sprint;
  if (b.grounded) flags |= SF.grounded;
  if (b.medkits === 0 && b.cls !== 'medic') flags |= SF.needMedkit;
  if (b.riding) flags |= SF.riding;
  return { id: b.id, flags, x: b.feet.x, y: b.feet.y, z: b.feet.z, yaw: b.aimYaw, pitch: b.aimPitch, weapon: b.def.id as WeaponId, health: b.health.value, shots: b.shots & 0xff };
}

/** A vehicle as everyone sees it. */
function netVehicle(v: Vehicle): NetVehicle {
  let flags = 0;
  if (v.wrecked) flags |= VF.wrecked;
  if (v.home === 'blue') flags |= VF.homeBlue;
  if (v.home === 'red') flags |= VF.homeRed;
  return {
    id: v.id,
    kind: v.kind,
    flags,
    x: v.pos.x,
    y: v.pos.y,
    z: v.pos.z,
    qx: v.quat.x,
    qy: v.quat.y,
    qz: v.quat.z,
    qw: v.quat.w,
    health: Math.max(0, v.health) / v.spec.health,
    driverOnly: v.driverOnly ?? -1,
    seats: v.seats.map((o, i) => ({ id: o?.id ?? -1, yaw: v.mounts[i]?.yaw ?? 0, pitch: v.mounts[i]?.pitch ?? 0, shots: v.seatShots[i] ?? 0 })),
    ship: v.ship?.net(),
  };
}

/** A kit from a browser, made safe (unknown class: assault; `locked`: weapons not open to this player, `attachOk`: attachments). */
function cleanKit(raw: unknown, locked?: (id: string) => boolean, attachOk?: AttachOk): Loadout {
  const r = (typeof raw === 'object' && raw ? raw : {}) as Partial<Loadout>;
  const cls = CLASSES.includes(r.cls as ClassId) ? (r.cls as ClassId) : 'assault';
  return sanitizeLoadout({ ...r, cls }, locked, attachOk);
}

/**
 * The rules' state as plain data. `present` in Rush / S&D / Escort holds
 * live combatants, whose physics links back to the world: it is server-only
 * input, not match state. Traversing it used to crash the room on `ready`
 * (or the next state update) once any bot or player was on the field.
 */
export function rulesState(rules: object): unknown {
  return JSON.parse(JSON.stringify(rules, (k, v: unknown) => (typeof v === 'function' || k === 'rand' || k === 'present' ? undefined : v)));
}
