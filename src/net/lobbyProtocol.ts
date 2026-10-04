/**
 * Lobby messages between the browser and the game server (JSON text frames on
 * the one WebSocket; match data will travel as binary frames on the same
 * socket): names, the room list, rooms and their settings. Shared by the
 * browser and the Node server, so this file imports nothing and uses erasable
 * TypeScript only.
 */

/** Bumped whenever a message changes shape; a mismatch asks the player to reload. */
export const PROTOCOL_VERSION = 2;

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
  | { t: 'ping'; at: number };

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
  | { t: 'error'; code: ErrorCode; detail?: string };

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
  const title = name.trim();
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
    case 'list':
    case 'leave':
    case 'start':
    case 'end':
      return { t: raw.t };
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
