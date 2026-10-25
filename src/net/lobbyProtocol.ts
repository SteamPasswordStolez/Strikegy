/**
 * JSON messages between the browser and the game server (text frames on the
 * one WebSocket; inputs and snapshots travel as binary frames on the same
 * socket, see matchProtocol.ts): names, the room list, rooms and their
 * settings, and a match's news (start, who is in it, kills, spawns, the zone
 * and score tables). Shared by the browser and the Node server, so this file
 * imports nothing and uses erasable TypeScript only.
 */

/** Bumped whenever a message changes shape; a mismatch asks the player to reload. */
export const PROTOCOL_VERSION = 21;

export type Device = 'desktop' | 'mobile';
export type Lineup = 'users' | 'usersBots' | 'coop';
export type InputRule = 'all' | 'desktop' | 'mobile';
export type RoomState = 'lobby' | 'playing';
/** Who decides which side people play on (owner, 2026-10-14): drawn at the start, each player, or the room's owner. */
export type TeamPick = 'random' | 'self' | 'host';
export type Side = 'blue' | 'red';

/** The most soldiers in a room, bots included (owner, 2026-10-04). */
export const ROOM_MAX = 300;
/** Humans per room until the server's load is measured. */
export const HUMAN_CAP = 64;
/** The most soldiers on the whole server, bots included (owner, 2026-10-04). */
export const SERVER_MAX = 1000;

export const NAME_MIN = 2;
export const NAME_MAX = 16;
// Hangul syllables, lone consonants / vowels (ㄱ-ㅣ, U+3131-318E) and conjoining jamo (some IMEs).
const NAME_RE = /^[0-9A-Za-z_\-가-힣\u3131-\u318e\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]+$/;

/**
 * Words that would pass for the game's staff or the server itself (owner,
 * 2026-10-14: no posing as someone to do harm or leave chat in their name).
 * Names and room titles holding one are refused; compared without case, spaces, '_' and '-'.
 */
const RESERVED_PARTS = ['admin', 'moderator', 'strikegy', 'system', 'official', 'support', '운영', '관리자', '개발자', '시스템', '서버', '공식', '방장', '경고', '공지'];
const RESERVED_WHOLE = ['gm', 'dev', 'mod', 'host', 'owner', 'server', 'staff', 'root', 'notice'];

/** Whether a name or title passes for staff or the server (see `RESERVED_PARTS`). */
export function reservedText(text: string): boolean {
  const k = text.normalize('NFKC').toLowerCase().replace(/[\s_\-.]/g, '');
  return RESERVED_WHOLE.includes(k) || RESERVED_PARTS.some((w) => k.includes(w));
}

/** A player name, trimmed, or null when it can't be used. */
export function cleanName(raw: string): string | null {
  const name = raw.normalize('NFC').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX || !NAME_RE.test(name) || reservedText(name)) return null;
  return name;
}

/**
 * The tag after every name in rooms and chat (`name#K7Q2M`): the server makes
 * it from the browser's hidden id with a key only it holds, so nobody can
 * pick or copy someone else's (owner, 2026-10-14). Letters that don't look
 * alike only.
 */
export const TAG_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const TAG_LEN = 5;

/** Longest chat line (characters). */
export const CHAT_MAX = 120;

// Control characters, zero-width and text-direction marks (they scramble lines or fake other text).
// eslint-disable-next-line no-control-regex, no-misleading-character-class -- stripping them is the point
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff]/g;

/** A chat line as sent on: no invisible characters, spaces squeezed, at most `CHAT_MAX`; null when nothing is left. */
export function cleanChat(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > CHAT_MAX * 4) return null;
  const text = raw.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return [...text].slice(0, CHAT_MAX).join('');
}

/** Modes where every soldier is on their own (no sides to pick, no team chat). */
export const SOLO_MODES: readonly string[] = ['ffa', 'gungame', 'lastman'];

/** Whether people are split into sides in a room (not every-soldier-for-themselves, not all against the bots). */
export function hasSides(s: Pick<RoomSettings, 'mode' | 'lineup'>): boolean {
  return s.lineup !== 'coop' && !SOLO_MODES.includes(s.mode);
}

/** A line in a room's chat. `from` null: the server's own note (`sys`) about `who`. */
export interface ChatLine {
  at: number;
  from: { id: string; name: string; tag: string; team: Side | null } | null;
  text?: string;
  /** To the sender's side only. */
  team?: boolean;
  /**
   * `muted` / `unmuted`: the owner took `who`'s chat away or gave it back;
   * to the sender only: `slow` (flooding), `chatOff` (the room has no chat),
   * `youMuted` (muted here or by the server's staff), `muteFail` (only the
   * owner mutes, someone in the room); `notice`: the server's staff to everyone (`text`).
   */
  sys?: 'join' | 'leave' | 'kicked' | 'host' | 'team' | 'slow' | 'start' | 'muted' | 'unmuted' | 'chatOff' | 'youMuted' | 'muteFail' | 'notice';
  who?: { name: string; tag: string };
  side?: Side;
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
  /** Who picks the sides. */
  teamPick: TeamPick;
  /** People may chat in the room (owner, 2026-10-14: set when made, changeable while waiting). */
  chat: boolean;
  /** Simplified controls for everyone in the room (owner, 2026-10-18; `MATCH.simple`). */
  simple: boolean;
  /** Every weapon open to everyone, whatever their level ("전부 해금", progression step 3; off by default). */
  allUnlocked?: boolean;
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
  /** The server's tag for this browser (see `TAG_ALPHABET`). */
  tag: string;
  /** The side they play on (null: drawn at the start, or no sides in this mode). */
  team: Side | null;
  device: Device;
  /** Lost the connection mid-match; the seat is kept for a minute. */
  away?: boolean;
  /** The owner took their chat away (in this room). */
  muted?: boolean;
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
  /** Its owner, as everyone sees them. */
  host: { name: string; tag: string };
  /** People on each side (for joining one under way). */
  sides: { blue: number; red: number };
}

export interface Room extends RoomInfo {
  owner: string;
  members: Member[];
}

/** A soldier in a match as everyone knows it. */
export interface MatchSoldierInfo {
  id: number;
  name: string;
  team: Side;
  /** Squad index on the side (members in join order; the first one leads). */
  squad: number;
  /** A bot (people get a name tag over their heads). */
  bot?: boolean;
  /** A person's tag (see `TAG_ALPHABET`). */
  tag?: string;
  /** A person's attachments on the guns they carry (weapon id -> slot -> attachment id): others draw and hear them. */
  att?: Record<string, Partial<Record<'optic' | 'muzzle' | 'under' | 'mag' | 'laser', string>>>;
  /** What a signed-in person wears that others see (from their account): gun skins / charms / kill effects by weapon, vehicle skins by family. */
  cos?: { skin?: Record<string, string>; charm?: Record<string, string>; kfx?: Record<string, string>; vskin?: Record<string, string> };
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
  /** The room plays with the simplified controls (`RoomSettings.simple`). */
  simple?: boolean;
  /** Every weapon open (`RoomSettings.allUnlocked`). */
  allUnlocked?: boolean;
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
      /** The killer's kill effect (a catalog id; from their account on the server). */
      fx?: string;
    }
  /** To the shooter: a hit marker. */
  | { k: 'hit'; head: boolean; killed: boolean; dmg?: number }
  /** To whoever was hurt: the damage indicator. */
  | { k: 'hurt'; amount: number; from: [number, number, number] | null; cause: 'bullet' | 'explosion' | 'fall' | 'storm' }
  /** To the soldier's player: on the field at `pos`, spread drawn from `seed`. */
  | { k: 'spawn'; id: number; pos: [number, number, number]; yaw: number; seed: number; kit: unknown }
  | { k: 'down'; id: number; by: string | null; cause: 'bullet' | 'explosion' | 'fall' | 'storm' }
  /** `respawn`: seconds before deploying again; -1: not before the next round (S&D). */
  | { k: 'died'; id: number; respawn: number }
  | { k: 'revived'; id: number; by: string; byId?: number }
  | { k: 'zone'; type: 'captured' | 'neutralized'; zone: string; team: Side }
  | { k: 'mode'; e: unknown }
  /** A grenade went off at tick `tick` (browsers show it when they draw that moment). */
  | {
      k: 'boom';
      type: 'frag' | 'flash' | 'smoke' | 'rocket' | 'mine' | 'riflesmoke' | 'mortar' | 'artillery' | 'smokeShell' | 'shell' | 'howitzer' | 'atshell' | 'salvo' | 'missile' | 'cannon' | 'wreck' | 'charge' | 'naval' | 'bigNaval' | 'torpedo' | 'depth' | 'splash';
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
  | { k: 'end'; winner: Side; winnerId?: number }
  /** This player reached a level during the match (progression: the HUD's notice); `xp` is the live total. */
  | { k: 'prog'; level: number; promoted: string | null; xp: number }
  /** This player's weapon reached a level during the match. */
  | { k: 'wprog'; weapon: string; level: number }
  /** This player earned a ribbon (its count this match); `xp` is the live total. */
  | { k: 'ribbon'; id: string; n: number; xp: number };

export type ClientMsg =
  /** `token`: the account's session (signed in with Google / Discord); rooms need one. */
  | { t: 'hello'; v: number; name: string; uid: string; device: Device; token?: string }
  | { t: 'list' }
  | { t: 'create'; settings: RoomSettings; password?: string }
  /** `team`: the side wanted (rooms where players pick their own). */
  | { t: 'join'; room: string; password?: string; team?: Side }
  /** A line to the room (`team`: to one's own side only). */
  | { t: 'chat'; text: string; team?: boolean }
  /** Onto a side: one's own (rooms where players pick), or `member`'s (the owner, where the owner picks). */
  | { t: 'team'; team: Side; member?: string }
  /** The owner takes someone's chat away or gives it back (by member id, or by name: `/채금 name` in a match). */
  | { t: 'mute'; member?: string; name?: string; on: boolean }
  /** The admin page: the server's admin key, then its operations. */
  | { t: 'adminAuth'; key: string }
  | { t: 'adm'; op: AdminOp }
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
  | { t: 'rtc'; sdp?: string; type?: 'answer'; cand?: string; mid?: string; rx?: boolean };

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
  | 'banned'
  | 'words'
  /** Rooms are for signed-in players only (owner, 2026-10-19). */
  | 'login'
  | 'bad';

export type ServerMsg =
  /** `account`: the hello's token was good (the tag is the account's). */
  | { t: 'welcome'; id: string; name: string; tag: string; account?: boolean }
  /**
   * A match's progress confirmed into the account (its end, or leaving it):
   * the summary (progression `MatchSummary`), the account's XP before and
   * after, the ranks reached.
   */
  | { t: 'progress'; summary: unknown; before: number; after: number; promotions: string[]; econ?: unknown }
  | { t: 'chat'; line: ChatLine }
  /** The room's recent chat, on joining it. */
  | { t: 'chatLog'; lines: ChatLine[] }
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'room'; room: Room }
  | { t: 'left'; reason: 'leave' | 'kicked' | 'closed' | 'admin' }
  | { t: 'adminOk' }
  | { t: 'admState'; state: AdminState }
  | { t: 'pong'; at: number }
  | { t: 'error'; code: ErrorCode; detail?: string }
  | { t: 'match'; match: MatchStart }
  | { t: 'roster'; roster: MatchSoldierInfo[] }
  | { t: 'ev'; ev: MatchEvent[] }
  /** The server's side of a UDP data channel: its offer (`stun`: where the browser finds its own address) and candidates. */
  | { t: 'rtc'; sdp?: string; type?: 'offer'; stun?: string; cand?: string; mid?: string; rx?: boolean }
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

// ---------------------------------------------------------------------------
// The admin page (strikegy.xyz/admin): the server's state and the staff's tools.

/** What the admin page may do. Minutes 0: for good. */
export type AdminOp =
  | { op: 'refresh' }
  | { op: 'close'; room: string }
  | { op: 'end'; room: string }
  | { op: 'kick'; client: string }
  | { op: 'ban'; client: string; minutes: number; reason: string }
  | { op: 'unban'; id: string }
  | { op: 'mute'; client: string; minutes: number }
  | { op: 'unmute'; id: string }
  | { op: 'notice'; text: string }
  | { op: 'word'; word: string; on: boolean }
  /** Accounts: find by game name or id, reset one's progress, sign it out everywhere. */
  | { op: 'accounts'; q: string }
  | { op: 'acctReset'; id: string }
  | { op: 'acctRevoke'; id: string };

/** A connected person as the admin page sees them (`addr`: a short hash of the address, never the address). */
export interface AdminPerson {
  id: string;
  name: string;
  tag: string;
  device: Device;
  addr: string;
  room: string | null;
  team: Side | null;
  away: boolean;
  /** Muted by the staff (until, ms; 0 for good), or in their room by its owner. */
  muted: boolean;
}

export interface AdminRoom {
  id: string;
  settings: RoomSettings;
  state: RoomState;
  locked: boolean;
  owner: string;
  members: AdminPerson[];
  chat: ChatLine[];
}

/** A ban or a mute the staff set (`until` ms; 0 for good). */
export interface AdminMark {
  id: string;
  name: string;
  tag: string;
  addr: string;
  reason: string;
  at: number;
  until: number;
}

export interface AdminState {
  now: number;
  server: Record<string, number | string | undefined>;
  rooms: AdminRoom[];
  /** Connected and in no room. */
  lobby: AdminPerson[];
  bans: AdminMark[];
  mutes: AdminMark[];
  /** Words the server masks besides the built-in list. */
  words: string[];
  /** Accounts on the server, and the last search's results. */
  accountCount?: number;
  accounts?: AdminAccount[];
}

/** An account as the admin page sees it (no provider numbers: only which providers). */
export interface AdminAccount {
  id: string;
  name: string;
  xp: number;
  level: number;
  matches: number;
  updated: number;
  providers: string[];
}

const okId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,40}$/.test(v);
const okMin = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 60 * 24 * 365;

/** Checks an admin operation; null when it isn't one. */
export function parseAdminOp(raw: unknown): AdminOp | null {
  if (!isObj(raw)) return null;
  switch (raw.op) {
    case 'refresh':
      return { op: 'refresh' };
    case 'close':
    case 'end':
      return okId(raw.room) ? { op: raw.op, room: raw.room } : null;
    case 'kick':
      return okId(raw.client) ? { op: 'kick', client: raw.client } : null;
    case 'ban':
      return okId(raw.client) && okMin(raw.minutes) && str(raw.reason, 120) ? { op: 'ban', client: raw.client, minutes: raw.minutes, reason: raw.reason } : null;
    case 'mute':
      return okId(raw.client) && okMin(raw.minutes) ? { op: 'mute', client: raw.client, minutes: raw.minutes } : null;
    case 'unban':
    case 'unmute':
      return okId(raw.id) ? { op: raw.op, id: raw.id } : null;
    case 'notice':
      return str(raw.text, CHAT_MAX * 2) ? { op: 'notice', text: raw.text } : null;
    case 'word':
      return str(raw.word, 32) && typeof raw.on === 'boolean' ? { op: 'word', word: raw.word, on: raw.on } : null;
    case 'accounts':
      return str(raw.q, 40) ? { op: 'accounts', q: raw.q } : null;
    case 'acctReset':
    case 'acctRevoke':
      return okId(raw.id) ? { op: raw.op, id: raw.id } : null;
    default:
      return null;
  }
}

const LINEUPS: readonly Lineup[] = ['users', 'usersBots', 'coop'];
const INPUTS: readonly InputRule[] = ['all', 'desktop', 'mobile'];
const DIFFS = ['easy', 'normal', 'hard'] as const;
const PICKS: readonly TeamPick[] = ['random', 'self', 'host'];
const isSide = (v: unknown): v is Side => v === 'blue' || v === 'red';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/**
 * Modes that can't be played with the simplified controls (owner, 2026-10-18:
 * fortress is about building, which the simplified controls take away).
 */
export const NO_SIMPLE_MODES: readonly string[] = ['fortress'];

/** Whether a mode offers the simplified controls. */
export function simpleAllowed(mode: string): boolean {
  return !NO_SIMPLE_MODES.includes(mode);
}

/** Checks settings from a client; returns a clean copy or null. */
export function cleanSettings(raw: unknown): RoomSettings | null {
  if (!isObj(raw)) return null;
  const { name, map, mode, size, lineup, difficulty, input, botShare, teamPick, chat, simple, allUnlocked } = raw;
  if (!str(name, 32) || !str(map, 32) || !str(mode, 16)) return null;
  // No control characters or text-direction overrides (they scramble the room list).
  // eslint-disable-next-line no-control-regex -- stripping them is the point
  const title = name.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  if (!title || reservedText(title) || !/^[\w-]+$/.test(map) || !/^\w+$/.test(mode)) return null;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 2 || size > ROOM_MAX) return null;
  if (!LINEUPS.includes(lineup as Lineup) || !INPUTS.includes(input as InputRule)) return null;
  if (!DIFFS.includes(difficulty as (typeof DIFFS)[number]) || typeof botShare !== 'boolean') return null;
  // Rooms from before team picking: drawn at random.
  if (teamPick !== undefined && !PICKS.includes(teamPick as TeamPick)) return null;
  if (chat !== undefined && typeof chat !== 'boolean') return null;
  if (simple !== undefined && typeof simple !== 'boolean') return null;
  if (allUnlocked !== undefined && typeof allUnlocked !== 'boolean') return null;
  return {
    name: title,
    map,
    mode,
    size,
    lineup: lineup as Lineup,
    difficulty: difficulty as RoomSettings['difficulty'],
    input: input as InputRule,
    botShare,
    teamPick: (teamPick as TeamPick | undefined) ?? 'random',
    chat: chat !== false,
    simple: simple === true && simpleAllowed(mode),
    allUnlocked: allUnlocked === true,
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
      // The uid ends up in logs and as a key: letters, digits, '_' and '-' only (no forged log lines).
      return typeof raw.v === 'number' && str(raw.name, 64) && str(raw.uid, 64) && /^[\w-]{1,64}$/.test(raw.uid) && (raw.device === 'desktop' || raw.device === 'mobile') && (raw.token === undefined || str(raw.token, 512))
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
      return str(raw.room, 32) && (raw.password === undefined || str(raw.password, 64)) && (raw.team === undefined || isSide(raw.team))
        ? { t: 'join', room: raw.room, password: raw.password as string | undefined, team: raw.team as Side | undefined }
        : null;
    case 'chat':
      return typeof raw.text === 'string' && raw.text.length <= CHAT_MAX * 4 && (raw.team === undefined || typeof raw.team === 'boolean') ? { t: 'chat', text: raw.text, team: raw.team === true } : null;
    case 'mute':
      return typeof raw.on === 'boolean' && (raw.member === undefined || str(raw.member, 32)) && (raw.name === undefined || str(raw.name, 32)) && (raw.member !== undefined || raw.name !== undefined)
        ? { t: 'mute', member: raw.member as string | undefined, name: raw.name as string | undefined, on: raw.on }
        : null;
    case 'adminAuth':
      return str(raw.key, 200) ? { t: 'adminAuth', key: raw.key } : null;
    case 'adm': {
      const op = parseAdminOp(raw.op);
      return op ? { t: 'adm', op } : null;
    }
    case 'team':
      return isSide(raw.team) && (raw.member === undefined || str(raw.member, 32)) ? { t: 'team', team: raw.team, member: raw.member as string | undefined } : null;
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
