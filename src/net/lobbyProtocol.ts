/**
 * JSON messages between the browser and the game server (text frames on the
 * one WebSocket; inputs and snapshots travel as binary frames on the same
 * socket, see matchProtocol.ts): names, the room list, rooms and their
 * settings, and a match's news (start, who is in it, kills, spawns, the zone
 * and score tables). Shared by the browser and the Node server, so this file
 * imports nothing and uses erasable TypeScript only.
 */

/** Bumped whenever a message changes shape; a mismatch asks the player to reload. */
export const PROTOCOL_VERSION = 10;

export type Device = 'desktop' | 'mobile';
export type Lineup = 'users' | 'usersBots' | 'coop';
export type InputRule = 'all' | 'desktop' | 'mobile';
export type RoomState = 'lobby' | 'playing';

/** The most soldiers in a room, bots included (owner, 2026-10-04). */
export const ROOM_MAX = 300;
/** Humans per room until the server's load is measured. */
export const HUMAN_CAP = 64;
/** The most soldiers on the whole server, bots included (owner, 2026-10-04). */
export const SERVER_MAX = 1000;

export const NAME_MIN = 2;
export const NAME_MAX = 16;
const NAME_RE = /^[0-9A-Za-z_\-가-힣]+$/;

/** A player name, trimmed, or null when it can't be used. */
export function cleanName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX || !NAME_RE.test(name)) return null;
  return name;
}

/** Settings the room's creator picks (and may change while waiting). */
export interface RoomSettings {
  name: string;
  map: string;
  mode: string;
  /** Soldiers in the room, bots included (2..ROOM_MAX). */
  size: number;
  lineup: Lineup;
  difficulty: 'easy' | 'normal' | 'hard';
  input: InputRule;
  /** Bots computed on same-team desktop PCs (on by default). */
  botShare: boolean;
}

/**
 * Soldiers a room puts on the server: with bots it is filled to its size,
 * users only it is just the people in it.
 */
export function roomLoad(settings: RoomSettings, humans: number): number {
  return settings.lineup === 'users' ? humans : Math.max(settings.size, humans);
}

export interface Member {
  id: string;
  name: string;
  device: Device;
  /** Lost the connection mid-match; the seat is kept for a minute. */
  away?: boolean;
}

/** One row of the room list. */
export interface RoomInfo {
  id: string;
  settings: RoomSettings;
  locked: boolean;
  state: RoomState;
  humans: number;
  /** Most humans this room takes (HUMAN_CAP, or fewer when the room is small). */
  humanCap: number;
}

export interface Room extends RoomInfo {
  owner: string;
  members: Member[];
}

type Side = 'blue' | 'red';

/** A soldier in a match as everyone knows it. */
export interface MatchSoldierInfo {
  id: number;
  name: string;
  team: Side;
  /** Squad index on the side (members in join order; the first one leads). */
  squad: number;
  /** A bot (people get a name tag over their heads). */
  bot?: boolean;
}

/** Sent when a match starts, or when joining (or coming back to) one under way. */
export interface MatchStart {
  room: string;
  map: string;
  mode: string;
  /** The receiver's own soldier. */
  me: number;
  team: Side;
  /** Server tick now. */
  tick: number;
  roster: MatchSoldierInfo[];
  /** Back to a soldier still on the field (a reload mid-match): carry on from here. */
  life?: { pos: [number, number, number]; yaw: number; seed: number; kit: unknown };
  /** Soldiers the room holds in all (vehicle limits scale with it). */
  size?: number;
  /** How well the bots play (a browser running some of them plays them so). */
  difficulty?: 'easy' | 'normal' | 'hard';
}

/** A bot handed to a browser to run (see `BotManager.adopt`). */
export interface AdoptBot {
  id: number;
  name: string;
  team: Side;
  cls: 'assault' | 'medic' | 'support' | 'recon';
  weapon: string;
  /** Its personality, as the server rolled it. */
  personality: unknown;
  pos: [number, number, number];
  yaw: number;
  health: number;
  medkits: number;
  grenades: [number, number, number];
}

/** A score table row as sent. */
export interface ScoreRowMsg {
  id: number;
  name: string;
  team: Side;
  kills: number;
  deaths: number;
  captures: number;
  score: number;
}

/** Things that happen in a match (to everyone unless noted). */
export type MatchEvent =
  | {
      k: 'kill';
      attacker: string;
      victim: string;
      weapon: string;
      headshot: boolean;
      attackerTeam: Side | null;
      victimTeam: Side | null;
      attackerId?: number;
      victimId?: number;
    }
  /** To the shooter: a hit marker. */
  | { k: 'hit'; head: boolean; killed: boolean }
  /** To whoever was hurt: the damage indicator. */
  | { k: 'hurt'; amount: number; from: [number, number, number] | null; cause: 'bullet' | 'explosion' | 'fall' }
  /** To the soldier's player: on the field at `pos`, spread drawn from `seed`. */
  | { k: 'spawn'; id: number; pos: [number, number, number]; yaw: number; seed: number; kit: unknown }
  | { k: 'down'; id: number; by: string | null; cause: 'bullet' | 'explosion' | 'fall' }
  | { k: 'died'; id: number; respawn: number }
  | { k: 'revived'; id: number; by: string; byId?: number }
  | { k: 'zone'; type: 'captured' | 'neutralized'; zone: string; team: Side }
  | { k: 'mode'; e: unknown }
  /** A grenade went off at tick `tick` (browsers show it when they draw that moment). */
  | {
      k: 'boom';
      type: 'frag' | 'flash' | 'smoke' | 'rocket' | 'mine' | 'riflesmoke' | 'mortar' | 'artillery' | 'smokeShell' | 'shell' | 'howitzer' | 'atshell' | 'salvo' | 'missile' | 'cannon' | 'wreck';
      pos: [number, number, number];
      tick: number;
    }
  /**
   * To the soldier's player: now in seat `seat` of vehicle `v` (null: out of
   * it; `chute`: bailed out under a parachute at x, y, z moving vx, vy, vz).
   */
  | { k: 'seat'; v: number | null; seat: number; chute?: [number, number, number, number, number, number]; pos?: [number, number, number] }
  /** To a side: a rocket tank came for `who` at zone `zone`. */
  | { k: 'rocketTank'; zone: string; who: string; id: number }
  /** To a browser that runs bots: run these from now on (as they are on the server). */
  | { k: 'adopt'; bots: AdoptBot[] }
  /** To a browser that runs bots: the server runs these again. */
  | { k: 'release'; ids: number[] }
  /** A mate handed `to` a medkit or ammo (to both of them); a supply crate gave `to` a refill (`by` -1). */
  | { k: 'given'; kind: 'medkit' | 'ammo' | 'crate'; by: number; to: number }
  /** A squad leader called something in (browsers show the planes, crates and markers). */
  | { k: 'callin'; kind: string; pos: [number, number, number]; owner: { id: number; name: string; team: Side; squad: string | null } }
  /** A shell is about a second out (the whistle). */
  | { k: 'incoming'; pos: [number, number, number] }
  /** To a side: enemies a recon plane marked, for `sec` seconds. */
  | { k: 'spotted'; ids: number[]; sec: number }
  /** To the earner: points popping up under the crosshair. */
  | { k: 'points'; points: number; reason: string }
  | { k: 'end'; winner: Side };

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; uid: string; device: Device }
  | { t: 'list' }
  | { t: 'create'; settings: RoomSettings; password?: string }
  | { t: 'join'; room: string; password?: string }
  | { t: 'leave' }
  | { t: 'settings'; settings: RoomSettings }
  | { t: 'start' }
  | { t: 'end' }
  | { t: 'kick'; member: string }
  /** Round trip to the server: answered with `pong` carrying the same `at`. */
  | { t: 'ping'; at: number }
  /** The match is loaded here: snapshots may come (`hostBots`: this browser can run some of the bots). */
  | { t: 'ready'; hostBots?: boolean }
  /** On the field at `key` ('base', 'zone:<id>', 'beacon:<id>', 'mate:<id>') with the kit picked on the deploy screen. */
  | { t: 'deploy'; key: string; kit: unknown }
  /** A squad leader calls `kind` in onto `point` (the rocket tank: no point). */
  | { t: 'callin'; kind: string; point: [number, number, number] | null }
  /**
   * Match data over UDP (a WebRTC data channel; handled by the gateway): no
   * fields asks for one, then the answer and candidates.
   */
  | { t: 'rtc'; sdp?: string; type?: 'answer'; cand?: string; mid?: string };

export type ErrorCode =
  | 'version'
  | 'name'
  | 'noRoom'
  | 'password'
  | 'full'
  | 'serverFull'
  | 'notOwner'
  | 'notInRoom'
  | 'busy'
  | 'rate'
  | 'bad';

export type ServerMsg =
  | { t: 'welcome'; id: string; name: string }
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'room'; room: Room }
  | { t: 'left'; reason: 'leave' | 'kicked' | 'closed' }
  | { t: 'pong'; at: number }
  | { t: 'error'; code: ErrorCode; detail?: string }
  | { t: 'match'; match: MatchStart }
  | { t: 'roster'; roster: MatchSoldierInfo[] }
  | { t: 'ev'; ev: MatchEvent[] }
  /** The server's side of a UDP data channel: its offer (`stun`: where the browser finds its own address) and candidates. */
  | { t: 'rtc'; sdp?: string; type?: 'offer'; stun?: string; cand?: string; mid?: string }
  /**
   * The zones and the mode's rules as the server has them, the score table,
   * build spots begun or built (`[id, work, built]`), stations not full
   * (`[id, uses]`) and the spawn beacons (a few times a second).
   */
  | {
      t: 'mstate';
      zones: unknown;
      rules: unknown;
      scores: ScoreRowMsg[];
      fort?: { slots: [number, number, number][]; stations: [number, number][] };
      beacons?: { id: number; team: Side; owner: string; uses: number; pos: [number, number, number] }[];
    };

const LINEUPS: readonly Lineup[] = ['users', 'usersBots', 'coop'];
const INPUTS: readonly InputRule[] = ['all', 'desktop', 'mobile'];
const DIFFS = ['easy', 'normal', 'hard'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** Checks settings from a client; returns a clean copy or null. */
export function cleanSettings(raw: unknown): RoomSettings | null {
  if (!isObj(raw)) return null;
  const { name, map, mode, size, lineup, difficulty, input, botShare } = raw;
  if (!str(name, 32) || !str(map, 32) || !str(mode, 16)) return null;
  // No control characters or text-direction overrides (they scramble the room list).
  // eslint-disable-next-line no-control-regex -- stripping them is the point
  const title = name.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  if (!title || !/^[\w-]+$/.test(map) || !/^\w+$/.test(mode)) return null;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 2 || size > ROOM_MAX) return null;
  if (!LINEUPS.includes(lineup as Lineup) || !INPUTS.includes(input as InputRule)) return null;
  if (!DIFFS.includes(difficulty as (typeof DIFFS)[number]) || typeof botShare !== 'boolean') return null;
  return {
    name: title,
    map,
    mode,
    size,
    lineup: lineup as Lineup,
    difficulty: difficulty as RoomSettings['difficulty'],
    input: input as InputRule,
    botShare,
  };
}

/** Parses a client message; null when it isn't one. Field checks beyond shape are the server's. */
export function parseClientMsg(text: string): ClientMsg | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'hello':
      return typeof raw.v === 'number' && str(raw.name, 64) && str(raw.uid, 64) && (raw.device === 'desktop' || raw.device === 'mobile')
        ? (raw as ClientMsg)
        : null;
    case 'ready':
      return { t: 'ready', hostBots: raw.hostBots === true };
    case 'list':
    case 'leave':
    case 'start':
    case 'end':
      return { t: raw.t };
    case 'deploy':
      return str(raw.key, 32) && isObj(raw.kit) ? { t: 'deploy', key: raw.key, kit: raw.kit } : null;
    case 'callin': {
      const p = raw.point;
      const point = Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && Number.isFinite(v)) ? (p as [number, number, number]) : null;
      return str(raw.kind, 16) && (point || p === null) ? { t: 'callin', kind: raw.kind, point } : null;
    }
    case 'create':
      return isObj(raw.settings) && (raw.password === undefined || str(raw.password, 64)) ? (raw as ClientMsg) : null;
    case 'join':
      return str(raw.room, 32) && (raw.password === undefined || str(raw.password, 64)) ? (raw as ClientMsg) : null;
    case 'settings':
      return isObj(raw.settings) ? (raw as ClientMsg) : null;
    case 'kick':
      return str(raw.member, 32) ? (raw as ClientMsg) : null;
    case 'ping':
      return typeof raw.at === 'number' && Number.isFinite(raw.at) ? { t: 'ping', at: raw.at } : null;
    default:
      return null;
  }
}
