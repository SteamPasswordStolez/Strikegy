/**
 * The lobby on the game server: names, the room list, passwords, room owners
 * and settings, the server-wide soldier cap, and handing rooms to their
 * matches (`MatchHost`): starting one, people joining one under way, and
 * keeping a seat for a minute when a connection drops mid-match so the same
 * browser (its hidden id) comes back to the same soldier.
 *
 * Chat is filtered for swearing and abuse (`wordFilter.ts` plus the staff's
 * own words), rooms may have no chat, and their owner may take someone's
 * chat away. The admin page (strikegy.xyz/admin) logs in with the server's
 * admin key and sees every room, person and chat, closes rooms, kicks, bans
 * and mutes server-wide (kept on disk through `AdminStore`), and posts notices.
 *
 * People are shown as `name#TAG`: the tag comes from the browser's hidden id
 * and a key only the server holds (`tagOf`), so nobody can take on someone
 * else's (owner, 2026-10-14: no posing as others). Rooms have a chat (the
 * waiting room and the match, all or one side) with its own rate limit, and
 * sides picked at random at the start, by each player or by the owner.
 *
 * Transport-free (the gateway hands it text and binary messages and a way to
 * answer), so tests drive it directly. Started by Yoro on exp as the
 * signalling core for P2P; host picking, WebRTC set-up and TURN went when the
 * owner chose a server-authoritative design (2026-10-04).
 */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { filterText, profane } from '../src/net/wordFilter.ts';
import {
  CHAT_MAX,
  HUMAN_CAP,
  PROTOCOL_VERSION,
  REPORT_NOTE,
  SERVER_MAX,
  TAG_ALPHABET,
  TAG_LEN,
  cleanChat,
  cleanName,
  cleanSettings,
  hasSides,
  parseClientMsg,
  reservedText,
  roomLoad,
  type AdminMark,
  type AdminOp,
  type AdminPerson,
  type AdminState,
  type ChatLine,
  type ClientMsg,
  type Device,
  type ErrorCode,
  type Member,
  type Room,
  type RoomInfo,
  type RoomSettings,
  type ServerMsg,
  type Side,
} from '../src/net/lobbyProtocol.ts';
import { EVENT_MULT, liveEvents, type AdminAccount, type AdminReport, type Badge, type EventKind, type PublicCard, type ServerEvents } from '../src/net/lobbyProtocol.ts';
import type { Applied, MatchSummary, Profile } from '../src/progression/profile.ts';
import { boostsLeft, econOf } from '../src/progression/economy.ts';
import { wornOf, type Worn } from '../src/progression/worn.ts';
import { levelOf, xpForLevel } from '../src/progression/levels.ts';

/** Messages a connection may send: a bucket of this many, refilled per second. */
const RATE = { burst: 120, perSecond: 60 } as const;
/** Binary frames (inputs: one a frame, ~60 a second) get their own bucket. */
const BIN_RATE = { burst: 240, perSecond: 150 } as const;
/** PBKDF2 rounds for room passwords (they guard a game room, not an account). */
const PBKDF2_ROUNDS = 50_000;
/** A seat is kept this long after a connection drops (ms). */
export const SEAT_GRACE = 60_000;

/** One end of a connection, whatever carries it. */
export interface Conn {
  send(text: string): void;
  binary?(data: Uint8Array): void;
  close(): void;
}

/** A player's line to a match: JSON news and binary snapshots. */
export interface MatchLine {
  text(msg: ServerMsg): void;
  binary(data: Uint8Array): void;
}

/** A person as a match takes them: hidden id, name, tag and the side the lobby gave them (none: the match picks). */
export interface MatchPlayer {
  uid: string;
  name: string;
  tag: string;
  team?: Side;
  /** Signed in: the account's XP (the match keeps this person's progress); none for guests. */
  xp?: number;
  /** Signed in: each weapon's XP (its level in the match). */
  weapons?: Record<string, number>;
  /** Signed in: boosters running (seconds of match time left). */
  boost?: Partial<Record<'xp' | 'weapon' | 'tickets', number>>;
  /** Signed in: what they wear that others see (skins, charms, kill effects, vehicle skins). */
  cos?: Worn;
  /** Their soldier's body. */
  sex?: 'f';
  /** Their level, card, emblem and plate (the account's). */
  badge?: Badge;
  /** The double events on when they started (multipliers by kind). */
  event?: Partial<Record<EventKind, number>>;
}

/** Runs the rooms' matches (the gateway's `Matches`; tests may leave it out). */
export interface MatchHost {
  /** Loads and starts a room's match with its members; rejects if it can't. */
  start(room: string, settings: RoomSettings, members: (MatchPlayer & { line: MatchLine })[]): Promise<void>;
  /** Someone joins a match under way, or comes back to their seat. */
  join(room: string, player: MatchPlayer, line: MatchLine): void;
  /** Their connection dropped: the seat stays. */
  detach(room: string, uid: string): void;
  /** Gone for good. */
  leave(room: string, uid: string): void;
  /** The match is over or called off. */
  stop(room: string): void;
  message(room: string, uid: string, msg: Extract<ClientMsg, { t: 'ready' | 'deploy' | 'callin' }>): void;
  binary(room: string, uid: string, data: Uint8Array): void;
}

export interface LobbyOptions {
  log?: (line: string) => void;
  /** Rooms one address may hold at once (default `ROOMS_PER_ADDRESS`). */
  roomsPerAddress?: number;
  /** Soldiers the whole server takes, bots included (tests lower it). */
  serverMax?: number;
  matches?: MatchHost | null;
  now?: () => number;
  /** The key people's tags are made with (keep it: a new one gives everyone new tags). Default: a fresh one. */
  tagSecret?: string;
  /** The admin page's key (none: no admin page). */
  adminKey?: string | null;
  /** Where the staff's bans, mutes and words are kept between restarts (default: memory only). */
  store?: AdminStore;
  /** The server's numbers for the admin page (load, matches, step time...). */
  stats?: () => Record<string, number | string | undefined>;
  /** Accounts (server/accounts.ts); none: everyone is a guest and rooms are open to all. */
  accounts?: AccountHost | null;
}

/** What the lobby needs of the accounts (server/accounts.ts `Accounts`; tests use a stand-in). */
export interface AccountHost {
  session(token: string | undefined): Promise<string | null>;
  profile(userId: string): Profile;
  apply(userId: string, summary: MatchSummary): Applied;
  setName(userId: string, name: string): void;
  /** The account's game name, if one is set. */
  nameOf(userId: string): string | null;
  /** The server's staff (the admin page marks them). */
  isStaff(userId: string): boolean;
  setStaff(userId: string, on: boolean): void;
  /** Supply tickets into an account; its tickets after, or null. */
  giveTickets(userId: string, n: number): number | null;
  find(query: string): AdminAccount[];
  reset(userId: string): void;
  revoke(userId: string): void;
  readonly count: number;
  /** Signing in is possible (a provider is set up, or local test logins): rooms then need it. */
  readonly required: boolean;
}

/** A ban or mute the staff set: by the browser's hidden id and its address. */
export interface StaffMark {
  id: string;
  /** The browser's hidden id (before the tab's part). */
  uid: string;
  /** The address it came from (kept on the server only; the admin page sees a hash). */
  addr: string;
  /** The account (signed in): the mark follows it to any browser. */
  account?: string;
  name: string;
  tag: string;
  reason: string;
  at: number;
  /** Until when (ms); 0: for good. */
  until: number;
}

export interface AdminData {
  bans: StaffMark[];
  mutes: StaffMark[];
  words: string[];
  /** Players' reports, newest first (owner, 2026-10-25). */
  reports?: AdminReport[];
  /** The double events (see `ServerEvents`). */
  events?: ServerEvents;
}

/** Reports kept, and how many one person may send (and per person reported). */
const REPORTS = { keep: 500, perWindow: 5, windowMs: 10 * 60_000, chat: 20 } as const;
/** Account cards one person may ask for in a burst (each reads the database). */
const CARDS = { perWindow: 20, windowMs: 10_000 } as const;
/** A badge is read from the account again after this long (equipping happens on the account's web side). */
const BADGE_MS = 10_000;

/** What a profile shows beside its owner's name (`private`: no level). */
export function badgeOf(prof: Profile, staff = false): Badge | undefined {
  const eq = econOf(prof).equip;
  const b: Badge = {};
  if (staff) b.staff = true;
  if (prof.flags.privacy !== 'private') b.lv = levelOf(prof.xp).level;
  if (eq.card) b.card = eq.card;
  if (eq.emblem) b.emblem = eq.emblem;
  if (eq.plate) b.plate = eq.plate;
  return Object.keys(b).length ? b : undefined;
}

export interface AdminStore {
  load(): AdminData | null;
  save(data: AdminData): void;
}

/** Wrong admin keys: a few an address and some from everyone in ten minutes, then the door stays shut. */
const ADMIN_TRIES = { addr: 5, all: 30, windowMs: 10 * 60_000 } as const;
/** Staff words at most. */
const WORDS_MAX = 300;

/**
 * A browser's tag from its hidden id (the part before the tab's) and the
 * server's key: 5 letters of 32, so ~33 million to try through the server
 * to land on someone's, one connection at a time.
 */
export function tagOf(secret: string, uid: string): string {
  const mac = createHmac('sha256', secret).update(uid.split('-')[0] ?? uid).digest();
  let out = '';
  for (let i = 0; i < TAG_LEN; i++) out += TAG_ALPHABET[mac[i]! & 31];
  return out;
}

interface Client {
  conn: Conn;
  id: string;
  name: string | null;
  device: Device;
  /** Their soldier's body (from the hello). */
  sex?: 'f';
  uid: string;
  room: string | null;
  /** On the room list page: gets the list pushed when it changes (no polling). */
  watching: boolean;
  tokens: number;
  lastRefill: number;
  binTokens: number;
  lastBinRefill: number;
  /** Connection gone mid-match: the seat waits until then (ms) for the same uid. */
  awayUntil: number | null;
  /** Messages refused (flooding, malformed): too many and the connection is dropped. */
  strikes: number;
  /** The visitor's address (per-address limits, bans). */
  addr: string;
  /** Wrong room passwords lately (ms timestamps). */
  passwordTries: number[];
  /** Its tag (see `tagOf`). */
  tag: string;
  /** Its side in the room (null: drawn at the start, or no sides). */
  team: Side | null;
  /** Chat lines it may send: a small bucket of its own. */
  chatTokens: number;
  lastChat: number;
  /** Its last line and how often in a row (no flooding one line). */
  chatText: string;
  chatRepeats: number;
  /** Logged in on the admin page. */
  admin: boolean;
  /** Signed in: the account's id (null: a guest). */
  account: string | null;
  /** The admin page's account search. */
  adminQuery: string;
  /** Its badge as last read from the account, and when. */
  badge?: Badge;
  badgeAt?: number;
  /** Recent account cards asked for and reports sent (ms), for their limits. */
  cardTimes?: number[];
  reportTimes?: number[];
}

/** Chat: lines in a burst, refilled per second; the same line in a row at most this often. */
const CHAT_RATE = { burst: 5, perSecond: 0.6, repeats: 2 } as const;
/** Chat lines a room keeps for people joining it. */
const CHAT_KEEP = 40;

/** Rooms one address may have open at once (each started one builds a whole map on the server). */
const ROOMS_PER_ADDRESS = 2;
/** Password tries a connection gets a minute, and a room gets a minute from everyone (no guessing). */
const PASSWORD_TRIES = { client: 5, room: 20, windowMs: 60_000 } as const;
/** A room may start its match again only this long after the last start (each start builds the map). */
const START_COOLDOWN_MS = 20_000;
/** Kicked by the anticheat: kept out of that room this long. */
const BAN_MS = 30 * 60_000;

/** Refused messages before a connection is dropped. */
const STRIKES_MAX = 40;

interface RoomRec {
  id: string;
  settings: RoomSettings;
  /** PBKDF2-SHA256, hex. */
  password: { salt: string; hash: string } | null;
  state: 'lobby' | 'playing';
  owner: string;
  /** Member ids in join order. */
  members: string[];
  /** Wrong passwords lately from anyone (ms timestamps). */
  passwordTries: number[];
  /** When its match last started (ms). */
  startedAt: number;
  /** Uids and addresses the anticheat put out of this room, until when (ms). */
  banned: Map<string, number>;
  /** Recent chat (for people joining). */
  chat: ChatLine[];
  /** Browsers (hidden ids) whose chat the owner took away. */
  muted: Set<string>;
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return hex(b);
}

async function pbkdf2(pw: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ROUNDS }, key, 256);
  return hex(new Uint8Array(bits));
}

/** Compares in time independent of where the strings differ. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const humanCap = (s: RoomSettings): number => Math.min(HUMAN_CAP, s.size);
/** A browser's hidden id without the tab's part (the same person in every tab). */
const uidBase = (uid: string): string => uid.split('-')[0] ?? uid;

export class LobbyCore {
  private readonly clients = new Map<string, Client>();
  private readonly rooms = new Map<string, RoomRec>();
  /** The room list as last pushed to watchers (JSON), to push only changes. */
  private lastList = '';
  private readonly log: (line: string) => void;
  private readonly serverMax: number;
  private readonly matches: MatchHost | null;
  private readonly now: () => number;
  private readonly tagSecret: string;
  private readonly staff: AdminData;
  /** Wrong admin keys lately: by address, and from everyone (ms timestamps). */
  private readonly adminTries = new Map<string, number[]>();
  private adminTriesAll: number[] = [];
  /** A player's hidden id -> their account (a match's progress is confirmed there, also after they left). */
  private readonly accountOf = new Map<string, string>();
  private readonly accounts: AccountHost | null;

  constructor(private readonly opts: LobbyOptions = {}) {
    this.log = opts.log ?? (() => {});
    this.tagSecret = opts.tagSecret ?? randomBytes(32).toString('hex');
    const saved = opts.store?.load();
    this.staff = { bans: saved?.bans ?? [], mutes: saved?.mutes ?? [], words: saved?.words ?? [], reports: saved?.reports ?? [], events: saved?.events ?? {} };
    this.serverMax = opts.serverMax ?? SERVER_MAX;
    this.matches = opts.matches ?? null;
    this.now = opts.now ?? Date.now;
    this.accounts = opts.accounts ?? null;
  }

  /**
   * A match's progress for a player (the end, leaving, a stop), confirmed into
   * their account and told to them if they are still connected.
   */
  matchProgress(room: string, uid: string, summary: MatchSummary): void {
    const id = this.accountOf.get(uid);
    if (!this.accounts || !id) return;
    let applied: Applied;
    try {
      applied = this.accounts.apply(id, summary);
    } catch (err) {
      this.log(`account ${id.slice(0, 8)}: could not save the match in room ${room}: ${String(err)}`);
      return;
    }
    const after = applied.profile.xp;
    const before = xpForLevel(applied.before.level) + applied.before.into;
    const msg: ServerMsg = { t: 'progress', summary, before, after, promotions: applied.promotions, econ: applied.econ };
    for (const c of this.clients.values()) if (c.uid === uid && c.awayUntil === null) this.send(c, msg);
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get clientCount(): number {
    let n = 0;
    for (const c of this.clients.values()) if (c.awayUntil === null && !c.admin) n++;
    return n;
  }

  /** Soldiers on the server now (people and the bots their rooms fill up with). */
  get load(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += roomLoad(r.settings, r.members.length);
    return n;
  }

  // ---------------------------------------------------------------------------
  // Connections

  /** A new connection; returns its client id. */
  open(conn: Conn, id = randomHex(4), addr = ''): string {
    const now = this.now();
    this.clients.set(id, { conn, id, name: null, device: 'desktop', uid: '', room: null, watching: false, tokens: RATE.burst, lastRefill: now, binTokens: BIN_RATE.burst, lastBinRefill: now, awayUntil: null, strikes: 0, addr, passwordTries: [], tag: '', team: null, chatTokens: CHAT_RATE.burst, lastChat: now, chatText: '', chatRepeats: 0, admin: false, account: null, adminQuery: '' });
    return id;
  }

  /**
   * The anticheat put a player out of a room's match: out of the room, and
   * kept out of it (by uid and address) for a while.
   */
  kick(roomId: string, uid: string, reason: string): void {
    const r = this.rooms.get(roomId);
    if (!r) return;
    const c = r.members.map((id) => this.clients.get(id)).find((x) => x?.uid === uid);
    const until = this.now() + BAN_MS;
    r.banned.set(`uid:${uid}`, until);
    if (c?.addr) r.banned.set(`addr:${c.addr}`, until);
    this.log(`anticheat: ${c?.name ?? '?'} (${uid.slice(0, 8)}) out of room ${roomId}: ${reason}`);
    if (!c) return;
    this.send(c, { t: 'error', code: 'banned', detail: reason });
    this.leaveRoom(c, 'kicked');
    this.pushList();
  }

  private isBanned(r: RoomRec, c: Client): boolean {
    const now = this.now();
    for (const [k, until] of r.banned) if (until <= now) r.banned.delete(k);
    return r.banned.has(`uid:${c.uid}`) || (!!c.addr && r.banned.has(`addr:${c.addr}`));
  }

  /** A wrong password: counted for the connection and the room; true while either may still try. */
  private passwordTry(c: Client, r: RoomRec): boolean {
    const now = this.now();
    const fresh = (list: number[]) => list.filter((t) => now - t < PASSWORD_TRIES.windowMs);
    c.passwordTries = fresh(c.passwordTries);
    r.passwordTries = fresh(r.passwordTries);
    return c.passwordTries.length < PASSWORD_TRIES.client && r.passwordTries.length < PASSWORD_TRIES.room;
  }

  /**
   * The connection closed. In a room the seat stays for `SEAT_GRACE` (mid-match
   * the soldier too), so a reload or a dropped line comes back to it.
   */
  close(id: string): void {
    const c = this.clients.get(id);
    if (!c || c.awayUntil !== null) return;
    const r = c.room ? this.rooms.get(c.room) : undefined;
    if (r && c.uid) {
      c.awayUntil = this.now() + SEAT_GRACE;
      c.watching = false;
      if (r.state === 'playing') this.matches?.detach(r.id, c.uid);
      if (r.owner === c.id) r.owner = this.firstHere(r) ?? r.owner;
      this.broadcast(r);
      this.pushList();
      return;
    }
    this.leaveRoom(c, 'closed');
    this.clients.delete(id);
    this.pushList();
  }

  /** Drops seats nobody came back to (call every few seconds). */
  sweep(): void {
    const now = this.now();
    for (const c of [...this.clients.values()]) {
      if (c.awayUntil === null || c.awayUntil > now) continue;
      this.leaveRoom(c, 'closed');
      this.clients.delete(c.id);
    }
    this.pushList();
  }

  /** A text message from a client. */
  async message(id: string, text: string): Promise<void> {
    const c = this.clients.get(id);
    if (!c || c.awayUntil !== null) return;
    if (!this.allowed(c)) return this.strike(c, 'rate');
    const msg = parseClientMsg(text);
    if (!msg) return this.strike(c, 'bad');
    try {
      await this.handle(c, msg);
      this.pushList();
    } catch (err) {
      this.log(`error: ${String(err)}`);
    }
  }

  /** A binary frame from a client: match data for the room it plays in. */
  binary(id: string, data: Uint8Array): void {
    const c = this.clients.get(id);
    if (!c || c.awayUntil !== null || !c.room || !this.matches) return;
    const r = this.rooms.get(c.room);
    if (!r || r.state !== 'playing') return;
    const now = this.now();
    c.binTokens = Math.min(BIN_RATE.burst, c.binTokens + ((now - c.lastBinRefill) / 1000) * BIN_RATE.perSecond);
    c.lastBinRefill = now;
    if (c.binTokens < 1) return this.strike(c, null);
    c.binTokens -= 1;
    this.matches.binary(r.id, c.uid, data);
  }

  /** A room's match is over: back to the waiting room. */
  matchOver(roomId: string): void {
    const r = this.rooms.get(roomId);
    if (!r || r.state !== 'playing') return;
    r.state = 'lobby';
    this.matches?.stop(r.id);
    this.broadcast(r);
    this.pushList();
  }

  // ---------------------------------------------------------------------------

  private send(c: Client, msg: ServerMsg): void {
    if (c.awayUntil !== null) return;
    try {
      c.conn.send(JSON.stringify(msg));
    } catch {
      /* closed meanwhile: its close event cleans up */
    }
  }

  private lineOf(c: Client): MatchLine {
    return {
      text: (msg) => this.send(c, msg),
      binary: (data) => {
        if (c.awayUntil !== null) return;
        try {
          c.conn.binary?.(data);
        } catch {
          /* closed meanwhile */
        }
      },
    };
  }

  /** A refused message; past `STRIKES_MAX` the connection is dropped (its seat waits as for any drop). */
  private strike(c: Client, code: ErrorCode | null): void {
    c.strikes++;
    if (code) this.fail(c, code);
    if (c.strikes === STRIKES_MAX) {
      this.log(`dropping ${c.id} (${c.name ?? '?'}): too many refused messages`);
      c.conn.close();
    }
  }

  private fail(c: Client, code: ErrorCode, detail?: string): void {
    this.send(c, { t: 'error', code, detail });
  }

  private allowed(c: Client): boolean {
    const now = this.now();
    c.tokens = Math.min(RATE.burst, c.tokens + ((now - c.lastRefill) / 1000) * RATE.perSecond);
    c.lastRefill = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  }

  private member(id: string): Member {
    const c = this.clients.get(id);
    const m: Member = { id, name: c?.name ?? '?', tag: c?.tag ?? '', team: c?.team ?? null, device: c?.device ?? 'desktop' };
    if (c?.awayUntil != null) m.away = true;
    const r = c?.room ? this.rooms.get(c.room) : undefined;
    if (c && r?.muted.has(uidBase(c.uid))) m.muted = true;
    const badge = c && this.badge(c);
    if (badge) m.badge = badge;
    return m;
  }

  /** The double events as set (on and recently ended alike; `liveEvents` says which are on). */
  get events(): ServerEvents {
    return { ...this.staff.events };
  }

  /** A signed-in client's badge (read again from the account every few seconds). */
  private badge(c: Client): Badge | undefined {
    if (!c.account || !this.accounts) return undefined;
    const now = this.now();
    if (c.badgeAt === undefined || now - c.badgeAt > BADGE_MS) {
      c.badge = badgeOf(this.accounts.profile(c.account), this.accounts.isStaff(c.account));
      c.badgeAt = now;
    }
    return c.badge;
  }

  /** Whether one more of something limited to `n` in `windowMs` fits in `list` (and counts it). */
  private spend(list: number[], n: number, windowMs: number): boolean {
    const now = this.now();
    while (list.length && now - list[0]! > windowMs) list.shift();
    if (list.length >= n) return false;
    list.push(now);
    return true;
  }

  /** Someone in room `r` by their tag. */
  private byTag(r: RoomRec, tag: string): Client | undefined {
    for (const id of r.members) {
      const m = this.clients.get(id);
      if (m?.tag === tag) return m;
    }
    return undefined;
  }

  /** `target`'s account card, as their privacy lets others see it. */
  private cardOf(target: Client): PublicCard {
    const card: PublicCard = { name: target.name ?? '?', tag: target.tag, account: !!target.account, privacy: 'public' };
    if (!target.account || !this.accounts) return card;
    const prof = this.accounts.profile(target.account);
    card.privacy = prof.flags.privacy ?? 'public';
    const badge = badgeOf(prof, this.accounts.isStaff(target.account));
    if (badge) card.badge = badge;
    target.badge = badge;
    target.badgeAt = this.now();
    if (card.privacy !== 'public') return card;
    const a = prof.stats.multi;
    const b = prof.stats.bots;
    let best: string | undefined;
    let most = 0;
    for (const [id, w] of Object.entries(prof.weapons)) if (w.kills > most) [best, most] = [id, w.kills];
    card.stats = {
      matches: a.matches + b.matches,
      wins: a.wins + b.wins,
      kills: a.kills + b.kills,
      deaths: a.deaths + b.deaths,
      headshots: a.headshots + b.headshots,
      hours: Math.round(((a.seconds + b.seconds) / 3600) * 10) / 10,
      since: prof.created,
      ...(best ? { best } : {}),
    };
    return card;
  }

  private info(r: RoomRec): RoomInfo {
    const host = this.clients.get(r.owner);
    const sides = { blue: 0, red: 0 };
    for (const id of r.members) {
      const team = this.clients.get(id)?.team;
      if (team) sides[team]++;
    }
    return { id: r.id, settings: r.settings, locked: r.password !== null, state: r.state, humans: r.members.length, humanCap: humanCap(r.settings), host: { name: host?.name ?? '?', tag: host?.tag ?? '' }, sides };
  }

  private view(r: RoomRec): Room {
    return { ...this.info(r), owner: r.owner, members: r.members.map((id) => this.member(id)) };
  }

  private broadcast(r: RoomRec): void {
    const msg: ServerMsg = { t: 'room', room: this.view(r) };
    for (const id of r.members) {
      const c = this.clients.get(id);
      if (c) this.send(c, msg);
    }
  }

  /** The first member still connected. */
  private firstHere(r: RoomRec): string | null {
    return r.members.find((m) => this.clients.get(m)?.awayUntil === null) ?? null;
  }

  /** Whether the server can take `extra` more soldiers. */
  private fits(extra: number): boolean {
    return extra <= 0 || this.load + extra <= this.serverMax;
  }

  /** Takes a member out of a room (no messages); closes the room when nobody connected is left. */
  private removeMember(r: RoomRec, id: string): void {
    r.members = r.members.filter((m) => m !== id);
    const here = this.firstHere(r);
    if (!here) {
      for (const m of r.members) this.clients.delete(m);
      this.rooms.delete(r.id);
      if (r.state === 'playing') this.matches?.stop(r.id);
      this.log(`room ${r.id} closed`);
      return;
    }
    if (r.owner === id || this.clients.get(r.owner)?.awayUntil != null) r.owner = here;
  }

  private leaveRoom(c: Client, reason: 'leave' | 'kicked' | 'closed'): void {
    const r = c.room ? this.rooms.get(c.room) : undefined;
    c.room = null;
    c.team = null;
    if (!r) return;
    if (reason !== 'closed') this.send(c, { t: 'left', reason });
    if (r.state === 'playing') this.matches?.leave(r.id, c.uid);
    const owner = r.owner;
    this.removeMember(r, c.id);
    if (!this.rooms.has(r.id)) return;
    this.note(r, reason === 'kicked' ? 'kicked' : 'leave', c);
    const host = this.clients.get(r.owner);
    if (r.owner !== owner && host) this.note(r, 'host', host);
    this.broadcast(r);
  }

  // ---------------------------------------------------------------------------
  // Sides

  /** People on each side of a room (leaving out `skip`). */
  private sideCounts(r: RoomRec, skip?: Client): Record<Side, number> {
    const n = { blue: 0, red: 0 };
    for (const id of r.members) {
      const m = this.clients.get(id);
      if (m && m !== skip && m.team) n[m.team]++;
    }
    return n;
  }

  /** People one side may have: half the room's people, rounded up. */
  private sideCap(r: RoomRec): number {
    return Math.ceil(humanCap(r.settings) / 2);
  }

  /**
   * The side someone joining gets: all on blue against the bots, none in
   * every-soldier-for-themselves modes, the one wanted where players pick
   * (if it has room), else the smaller one.
   */
  private sideFor(r: RoomRec, c: Client, wanted?: Side): Side | null {
    if (r.settings.lineup === 'coop') return 'blue';
    if (!hasSides(r.settings)) return null;
    const n = this.sideCounts(r, c);
    if (wanted && r.settings.teamPick === 'self' && n[wanted] < this.sideCap(r)) return wanted;
    if (n.blue !== n.red) return n.blue < n.red ? 'blue' : 'red';
    return Math.random() < 0.5 ? 'blue' : 'red';
  }

  /** After a settings change: everyone on a side the new settings allow, none over a side's cap. */
  private fixSides(r: RoomRec): void {
    const cap = this.sideCap(r);
    const n = { blue: 0, red: 0 };
    for (const id of r.members) {
      const m = this.clients.get(id);
      if (!m) continue;
      if (r.settings.lineup === 'coop') m.team = 'blue';
      else if (!hasSides(r.settings)) m.team = null;
      else {
        if (!m.team) m.team = n.blue <= n.red ? 'blue' : 'red';
        if (n[m.team] >= cap) m.team = m.team === 'blue' ? 'red' : 'blue';
        n[m.team]++;
      }
    }
  }

  /** Random sides at the start (rooms that draw them): shuffled, then dealt out in turn. */
  private drawSides(r: RoomRec): void {
    if (r.settings.teamPick !== 'random' || !hasSides(r.settings)) return;
    const list = r.members.map((id) => this.clients.get(id)).filter((m): m is Client => !!m);
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    const first: Side = Math.random() < 0.5 ? 'blue' : 'red';
    list.forEach((m, i) => (m.team = i % 2 === 0 ? first : first === 'blue' ? 'red' : 'blue'));
  }

  // ---------------------------------------------------------------------------
  // Chat

  /** Hands a line to the room (a side's line to that side only) and keeps it for people joining. */
  private post(r: RoomRec, line: ChatLine): void {
    r.chat.push(line);
    if (r.chat.length > CHAT_KEEP) r.chat.shift();
    const msg: ServerMsg = { t: 'chat', line };
    for (const id of r.members) {
      const m = this.clients.get(id);
      if (m && this.sees(m, line)) this.send(m, msg);
    }
  }

  private sees(m: Client, line: ChatLine): boolean {
    return !line.team || line.side === m.team;
  }

  /** The server's own line about someone (joined, left, now the owner...). */
  private note(r: RoomRec, sys: NonNullable<ChatLine['sys']>, who: Client, side?: Side): void {
    this.post(r, { at: this.now(), from: null, sys, who: { name: who.name ?? '?', tag: who.tag }, side });
  }

  private chat(c: Client, r: RoomRec, raw: string, team: boolean): void {
    const now = this.now();
    c.chatTokens = Math.min(CHAT_RATE.burst, c.chatTokens + ((now - c.lastChat) / 1000) * CHAT_RATE.perSecond);
    c.lastChat = now;
    const clean = cleanChat(raw);
    if (!clean) return;
    if (!r.settings.chat) return this.send(c, { t: 'chat', line: { at: now, from: null, sys: 'chatOff' } });
    if (r.muted.has(uidBase(c.uid)) || this.marked(this.staff.mutes, c)) return this.send(c, { t: 'chat', line: { at: now, from: null, sys: 'youMuted' } });
    // Swearing and abuse masked (the built-in list and the staff's words).
    const text = filterText(clean, this.staff.words).text;
    const repeat = text === c.chatText;
    if (c.chatTokens < 1 || (repeat && c.chatRepeats >= CHAT_RATE.repeats)) {
      this.send(c, { t: 'chat', line: { at: now, from: null, sys: 'slow' } });
      return;
    }
    c.chatTokens -= 1;
    c.chatRepeats = repeat ? c.chatRepeats + 1 : 0;
    c.chatText = text;
    // Side chat only where there are sides; elsewhere it goes to everyone.
    const side = team && hasSides(r.settings) && c.team ? c.team : undefined;
    this.post(r, { at: now, from: { id: c.id, name: c.name ?? '?', tag: c.tag, team: c.team }, text: text.slice(0, CHAT_MAX * 2), team: !!side || undefined, side });
  }

  private sendChatLog(c: Client, r: RoomRec): void {
    this.send(c, { t: 'chatLog', lines: r.chat.filter((l) => this.sees(c, l)) });
  }

  private uniqueName(r: RoomRec, name: string): string {
    const taken = new Set(r.members.map((id) => this.clients.get(id)?.name));
    if (!taken.has(name)) return name;
    for (let i = 2; ; i++) {
      const tail = String(i);
      const n = name.slice(0, 16 - tail.length) + tail;
      if (!taken.has(n)) return n;
    }
  }

  private joinRoom(c: Client, r: RoomRec, wanted?: Side): void {
    c.name = this.uniqueName(r, c.name!);
    c.room = r.id;
    c.watching = false;
    c.team = this.sideFor(r, c, wanted);
    r.members.push(c.id);
    this.sendChatLog(c, r);
    this.note(r, 'join', c, c.team ?? undefined);
    this.broadcast(r);
    if (r.state === 'playing') this.matches?.join(r.id, this.player(c), this.lineOf(c));
  }

  private player(c: Client): MatchPlayer {
    const p: MatchPlayer = { uid: c.uid, name: c.name!, tag: c.tag, team: c.team ?? undefined, ...(c.sex ? { sex: c.sex } : {}) };
    c.badgeAt = undefined;
    const badge = this.badge(c);
    if (badge) p.badge = badge;
    // The double events on as the match starts (or as they join it).
    const ev = liveEvents(this.events, this.now());
    if (ev.length) p.event = Object.fromEntries(ev.map((k) => [k, EVENT_MULT]));
    if (c.account && this.accounts) {
      const prof = this.accounts.profile(c.account);
      p.xp = prof.xp;
      p.weapons = Object.fromEntries(Object.entries(prof.weapons).map(([id, w]) => [id, w.xp]));
      p.boost = boostsLeft(prof);
      p.cos = wornOf(econOf(prof).equip);
    }
    return p;
  }

  /**
   * Right after hello: back to a seat this browser tab held a moment ago (same
   * uid), no password asked; mid-match to the same soldier.
   */
  private rejoin(c: Client): void {
    const now = this.now();
    for (const old of this.clients.values()) {
      if (old === c || old.uid !== c.uid || old.awayUntil === null || old.awayUntil <= now) continue;
      const r = old.room ? this.rooms.get(old.room) : undefined;
      if (!r) break;
      c.name = old.name;
      c.room = r.id;
      c.team = old.team;
      c.chatTokens = old.chatTokens;
      c.lastChat = old.lastChat;
      r.members = r.members.map((m) => (m === old.id ? c.id : m));
      if (r.owner === old.id || this.clients.get(r.owner)?.awayUntil != null) r.owner = c.id;
      this.clients.delete(old.id);
      this.sendChatLog(c, r);
      this.broadcast(r);
      if (r.state === 'playing') this.matches?.join(r.id, this.player(c), this.lineOf(c));
      return;
    }
  }

  private async handle(c: Client, msg: ClientMsg): Promise<void> {
    if (msg.t === 'hello') {
      if (msg.v !== PROTOCOL_VERSION) return this.fail(c, 'version', String(PROTOCOL_VERSION));
      const name = cleanName(msg.name);
      if (!name) return this.fail(c, 'name');
      if (profane(name, this.staff.words)) return this.fail(c, 'words', 'name');
      if (c.name) return this.fail(c, 'bad', 'hello again');
      // Signed in: the token says which account (a bad or old one: a guest, and the welcome says so).
      const account = msg.token && this.accounts ? await this.accounts.session(msg.token) : null;
      if (this.clients.get(c.id) !== c || c.name) return;
      const ban = this.marked(this.staff.bans, { uid: msg.uid, addr: c.addr, account: account ?? undefined });
      if (ban) {
        this.fail(c, 'banned', ban.reason);
        c.conn.close();
        return;
      }
      c.name = name;
      c.uid = msg.uid;
      c.account = account;
      // The tag comes from the account when signed in (the same on every device), else from the browser.
      c.tag = tagOf(this.tagSecret, account ? `acct${account.replace(/-/g, '')}` : msg.uid);
      c.device = msg.device;
      c.sex = (msg as { sex?: unknown }).sex === 'f' ? 'f' : undefined;
      if (account) {
        this.accountOf.set(c.uid, account);
        // Signed in: the account's name wins (the same on every device); a first sign-in keeps this one.
        const stored = this.accounts?.nameOf(account) ?? null;
        if (stored && !profane(stored, this.staff.words)) c.name = stored;
        else this.accounts?.setName(account, name);
      }
      this.send(c, { t: 'welcome', id: c.id, name: c.name ?? name, tag: c.tag, account: !!account });
      this.send(c, { t: 'events', events: this.events });
      if (c.uid) this.rejoin(c);
      return;
    }
    if (msg.t === 'ping') return this.send(c, { t: 'pong', at: msg.at });
    if (msg.t === 'adminAuth') return this.adminAuth(c, msg.key);
    if (msg.t === 'adm') {
      if (!c.admin) return this.strike(c, 'notOwner');
      return this.adminOp(c, msg.op);
    }
    if (!c.name) return this.fail(c, 'bad', 'hello first');
    const r = c.room ? this.rooms.get(c.room) : undefined;
    switch (msg.t) {
      case 'list':
        c.watching = !r;
        return this.send(c, { t: 'rooms', rooms: this.roomList() });
      case 'create': {
        if (r) return this.fail(c, 'busy');
        if (this.accounts?.required && !c.account) return this.fail(c, 'login');
        // A title passing for staff or the server: said as such (cleanSettings refuses it).
        if (typeof msg.settings.name === 'string' && reservedText(msg.settings.name)) return this.fail(c, 'words', 'title');
        const settings = cleanSettings(msg.settings);
        if (!settings) return this.fail(c, 'bad', 'settings');
        if (profane(settings.name, this.staff.words)) return this.fail(c, 'words', 'title');
        // A few rooms per address: each one started builds a whole map on the server.
        let mine = 0;
        for (const x of this.rooms.values()) if (c.addr && this.clients.get(x.owner)?.addr === c.addr) mine++;
        if (mine >= (this.opts.roomsPerAddress ?? ROOMS_PER_ADDRESS)) return this.fail(c, 'busy', 'rooms');
        if (!this.fits(roomLoad(settings, 1))) return this.fail(c, 'serverFull');
        let password: RoomRec['password'] = null;
        if (msg.password) {
          const salt = randomHex(16);
          password = { salt, hash: await pbkdf2(msg.password, salt) };
          if (!this.still(c)) return;
        }
        const rec: RoomRec = { id: randomHex(3), settings, password, state: 'lobby', owner: c.id, members: [], passwordTries: [], startedAt: -Infinity, banned: new Map(), chat: [], muted: new Set() };
        this.rooms.set(rec.id, rec);
        this.log(`room ${rec.id} "${settings.name}" by ${c.name}`);
        return this.joinRoom(c, rec);
      }
      case 'join': {
        if (r) return this.fail(c, 'busy');
        if (this.accounts?.required && !c.account) return this.fail(c, 'login');
        const rec = this.rooms.get(msg.room);
        if (!rec) return this.fail(c, 'noRoom');
        if (this.isBanned(rec, c)) return this.fail(c, 'banned');
        if (rec.password) {
          // A handful of tries a minute (each costs a hash): no guessing passwords.
          if (!this.passwordTry(c, rec)) return this.strike(c, 'rate');
          if (msg.password === undefined || !sameHex(await pbkdf2(msg.password, rec.password.salt), rec.password.hash)) {
            const now = this.now();
            c.passwordTries.push(now);
            rec.passwordTries.push(now);
            return this.fail(c, 'password');
          }
        }
        if (!this.still(c)) return;
        if (!this.rooms.has(rec.id)) return this.fail(c, 'noRoom');
        if (rec.members.length >= humanCap(rec.settings)) return this.fail(c, 'full');
        if (rec.settings.input !== 'all' && rec.settings.input !== c.device) return this.fail(c, 'full', 'input');
        const n = rec.members.length;
        if (!this.fits(roomLoad(rec.settings, n + 1) - roomLoad(rec.settings, n))) return this.fail(c, 'serverFull');
        return this.joinRoom(c, rec, msg.team);
      }
      case 'leave':
        if (!r) return this.fail(c, 'notInRoom');
        return this.leaveRoom(c, 'leave');
      case 'settings': {
        if (!r) return this.fail(c, 'notInRoom');
        if (r.owner !== c.id) return this.fail(c, 'notOwner');
        if (r.state !== 'lobby') return this.fail(c, 'busy');
        // A title passing for staff or the server: said as such (cleanSettings refuses it).
        if (typeof msg.settings.name === 'string' && reservedText(msg.settings.name)) return this.fail(c, 'words', 'title');
        const settings = cleanSettings(msg.settings);
        if (!settings || settings.size < r.members.length) return this.fail(c, 'bad', 'settings');
        if (profane(settings.name, this.staff.words)) return this.fail(c, 'words', 'title');
        const n = r.members.length;
        if (!this.fits(roomLoad(settings, n) - roomLoad(r.settings, n))) return this.fail(c, 'serverFull');
        r.settings = settings;
        this.fixSides(r);
        return this.broadcast(r);
      }
      case 'team': {
        if (!r) return this.fail(c, 'notInRoom');
        if (r.state !== 'lobby' || !hasSides(r.settings)) return this.fail(c, 'busy');
        const pick = r.settings.teamPick;
        const target = msg.member ? this.clients.get(msg.member) : c;
        if (!target || target.room !== r.id) return;
        // Your own side where players pick; anyone's (yours too) by the owner where the owner does.
        if (pick === 'random' || (pick === 'self' && target !== c) || (pick === 'host' && r.owner !== c.id)) return this.fail(c, 'notOwner');
        if (target.team === msg.team) return;
        if (this.sideCounts(r, target)[msg.team] >= this.sideCap(r)) return this.fail(c, 'full', 'side');
        target.team = msg.team;
        this.note(r, 'team', target, msg.team);
        return this.broadcast(r);
      }
      case 'chat':
        if (!r) return this.fail(c, 'notInRoom');
        return this.chat(c, r, msg.text, msg.team === true);
      case 'mute': {
        if (!r) return this.fail(c, 'notInRoom');
        // By id (the waiting room) or by name (`/채금 name` in a match); the owner only, never oneself.
        const target = msg.member ? this.clients.get(msg.member) : r.members.map((id) => this.clients.get(id)).find((m) => m?.name === msg.name?.trim());
        if (r.owner !== c.id || !target || target.room !== r.id || target === c) return this.send(c, { t: 'chat', line: { at: this.now(), from: null, sys: 'muteFail' } });
        const key = uidBase(target.uid);
        if (msg.on === r.muted.has(key)) return;
        if (msg.on) r.muted.add(key);
        else r.muted.delete(key);
        this.note(r, msg.on ? 'muted' : 'unmuted', target);
        return this.broadcast(r);
      }
      case 'card': {
        if (!r) return this.fail(c, 'notInRoom');
        const target = this.byTag(r, msg.tag);
        if (!target) return this.fail(c, 'bad', 'card');
        if (!this.spend((c.cardTimes ??= []), CARDS.perWindow, CARDS.windowMs)) return this.fail(c, 'rate');
        return this.send(c, { t: 'card', card: this.cardOf(target) });
      }
      case 'report': {
        if (!r) return this.fail(c, 'notInRoom');
        const target = this.byTag(r, msg.tag);
        if (!target || target === c) return this.fail(c, 'bad', 'report');
        const reports = this.staff.reports!;
        // The same person reported again for the same thing within the window: taken as the one already sent.
        const now = this.now();
        const again = reports.find((x) => !x.done && now - x.at < REPORTS.windowMs && x.from.tag === c.tag && x.who.tag === target.tag && x.reason === msg.reason);
        if (again) return this.send(c, { t: 'reported' });
        if (!this.spend((c.reportTimes ??= []), REPORTS.perWindow, REPORTS.windowMs)) return this.fail(c, 'rate');
        const note = (msg.note !== undefined ? (cleanChat(msg.note) ?? '') : '').slice(0, REPORT_NOTE);
        reports.unshift({
          id: randomHex(4),
          at: now,
          reason: msg.reason,
          note,
          room: r.settings.name,
          from: { name: c.name ?? '?', tag: c.tag, account: c.account },
          who: { name: target.name ?? '?', tag: target.tag, account: target.account, addr: this.addrHash(target.addr) },
          chat: r.chat.slice(-REPORTS.chat),
        });
        if (reports.length > REPORTS.keep) reports.length = REPORTS.keep;
        this.saveStaff();
        this.log(`report: ${c.tag} -> ${target.tag} (${msg.reason})`);
        return this.send(c, { t: 'reported' });
      }
      case 'start': {
        if (!r) return this.fail(c, 'notInRoom');
        if (r.owner !== c.id) return this.fail(c, 'notOwner');
        if (r.state !== 'lobby') return this.fail(c, 'busy');
        if (this.now() - r.startedAt < START_COOLDOWN_MS) return this.fail(c, 'rate');
        r.startedAt = this.now();
        r.state = 'playing';
        this.drawSides(r);
        this.log(`room ${r.id} starts`);
        this.broadcast(r);
        this.post(r, { at: this.now(), from: null, sys: 'start' });
        if (!this.matches) return;
        const members = r.members.map((id) => this.clients.get(id)!).filter((m) => m && m.awayUntil === null);
        try {
          await this.matches.start(
            r.id,
            r.settings,
            members.map((m) => ({ ...this.player(m), line: this.lineOf(m) })),
          );
        } catch (err) {
          this.log(`room ${r.id} could not start: ${String(err)}`);
          if (this.rooms.get(r.id) === r) {
            r.state = 'lobby';
            this.broadcast(r);
          }
          // The machine is busy with the matches already running: like a full server.
          return this.fail(c, err instanceof Error && err.message === 'busy' ? 'serverFull' : 'bad', 'start');
        }
        // Someone may have left while it loaded, or everyone did.
        if (this.rooms.get(r.id) !== r) this.matches.stop(r.id);
        return;
      }
      case 'end':
        if (!r) return this.fail(c, 'notInRoom');
        if (r.owner !== c.id) return this.fail(c, 'notOwner');
        return this.matchOver(r.id);
      case 'kick': {
        if (!r) return this.fail(c, 'notInRoom');
        if (r.owner !== c.id) return this.fail(c, 'notOwner');
        const target = msg.member !== c.id && r.members.includes(msg.member) ? this.clients.get(msg.member) : undefined;
        if (!target) return;
        if (target.awayUntil !== null) {
          this.leaveRoom(target, 'closed');
          this.clients.delete(target.id);
        } else this.leaveRoom(target, 'kicked');
        return;
      }
      case 'ready':
      case 'deploy':
      case 'callin':
        if (!r || r.state !== 'playing') return;
        return this.matches?.message(r.id, c.uid, msg);
    }
  }

  /**
   * After waiting on a password hash: whether the client is still connected
   * and still outside a room (a second message may have got in meanwhile).
   */
  private still(c: Client): boolean {
    if (this.clients.get(c.id) !== c || c.awayUntil !== null) return false;
    if (!c.room) return true;
    this.fail(c, 'busy');
    return false;
  }

  // ---------------------------------------------------------------------------
  // The staff: bans, mutes, words, the admin page

  /** A live ban / mute matching this browser or address (expired ones are dropped). */
  private marked(list: StaffMark[], who: { uid: string; addr: string; account?: string | null }): StaffMark | null {
    const now = this.now();
    const live = list.filter((m) => m.until === 0 || m.until > now);
    if (live.length !== list.length) {
      list.splice(0, list.length, ...live);
      this.saveStaff();
    }
    const uid = uidBase(who.uid);
    return list.find((m) => (uid && m.uid === uid) || (!!who.addr && m.addr === who.addr) || (!!who.account && m.account === who.account)) ?? null;
  }

  private saveStaff(): void {
    try {
      this.opts.store?.save(this.staff);
    } catch (err) {
      this.log(`admin: could not save: ${String(err)}`);
    }
  }

  /** An address as the admin page sees it: a short keyed hash (the same address, the same hash). */
  private addrHash(addr: string): string {
    return addr ? createHmac('sha256', this.tagSecret).update(`addr:${addr}`).digest('hex').slice(0, 8) : '-';
  }

  private adminAuth(c: Client, key: string): void {
    const now = this.now();
    const fresh = (l: number[]) => l.filter((t) => now - t < ADMIN_TRIES.windowMs);
    const mine = fresh(this.adminTries.get(c.addr) ?? []);
    this.adminTriesAll = fresh(this.adminTriesAll);
    const real = this.opts.adminKey;
    if (!real || mine.length >= ADMIN_TRIES.addr || this.adminTriesAll.length >= ADMIN_TRIES.all) {
      this.adminTries.set(c.addr, mine);
      return this.strike(c, 'rate');
    }
    if (!adminKeyMatches(key, real)) {
      mine.push(now);
      this.adminTriesAll.push(now);
      this.adminTries.set(c.addr, mine);
      this.log(`admin: wrong key from ${this.addrHash(c.addr)}`);
      return this.fail(c, 'password');
    }
    c.admin = true;
    this.log(`admin: logged in from ${this.addrHash(c.addr)}`);
    this.send(c, { t: 'adminOk' });
    this.send(c, { t: 'admState', state: this.adminState(c) });
  }

  private person(c: Client): AdminPerson {
    const r = c.room ? this.rooms.get(c.room) : undefined;
    return {
      id: c.id,
      name: c.name ?? '?',
      tag: c.tag,
      device: c.device,
      addr: this.addrHash(c.addr),
      room: c.room,
      team: c.team,
      away: c.awayUntil !== null,
      muted: !!this.marked(this.staff.mutes, c) || !!r?.muted.has(uidBase(c.uid)),
    };
  }

  private mark(m: StaffMark): AdminMark {
    return { id: m.id, name: m.name, tag: m.tag, addr: this.addrHash(m.addr), reason: m.reason, at: m.at, until: m.until };
  }

  private adminState(admin: Client): AdminState {
    // (Dropping expired marks on the way.)
    this.marked(this.staff.bans, { uid: '', addr: '' });
    this.marked(this.staff.mutes, { uid: '', addr: '' });
    return {
      now: this.now(),
      server: { rooms: this.rooms.size, clients: this.clientCount, load: this.load, max: this.serverMax, protocol: PROTOCOL_VERSION, ...(this.opts.stats?.() ?? {}) },
      rooms: [...this.rooms.values()].map((r) => ({
        id: r.id,
        settings: r.settings,
        state: r.state,
        locked: r.password !== null,
        owner: r.owner,
        members: r.members.map((id) => this.clients.get(id)).filter((m): m is Client => !!m).map((m) => this.person(m)),
        chat: r.chat,
      })),
      lobby: [...this.clients.values()].filter((m) => !m.admin && !m.room && m.name).map((m) => this.person(m)),
      bans: this.staff.bans.map((m) => this.mark(m)),
      mutes: this.staff.mutes.map((m) => this.mark(m)),
      words: this.staff.words,
      reports: this.staff.reports!.slice(0, 150),
      events: this.events,
      ...(this.accounts ? { accountCount: this.accounts.count, accounts: this.accounts.find(admin.adminQuery) } : {}),
    };
  }

  /** Every connection of a browser, an address or an account. */
  private connsOf(uid: string, addr: string, account?: string | null): Client[] {
    const base = uidBase(uid);
    return [...this.clients.values()].filter((m) => !m.admin && ((base && uidBase(m.uid) === base) || (!!addr && m.addr === addr) || (!!account && m.account === account)));
  }

  private closeRoom(r: RoomRec): void {
    for (const id of r.members) {
      const m = this.clients.get(id);
      if (!m) continue;
      m.room = null;
      m.team = null;
      if (m.awayUntil !== null) this.clients.delete(id);
      else this.send(m, { t: 'left', reason: 'admin' });
    }
    r.members = [];
    this.rooms.delete(r.id);
    if (r.state === 'playing') this.matches?.stop(r.id);
    this.log(`admin: room ${r.id} closed`);
  }

  private adminOp(c: Client, op: AdminOp): void {
    const now = this.now();
    const target = 'client' in op ? this.clients.get(op.client) : undefined;
    const until = 'minutes' in op && op.minutes > 0 ? now + op.minutes * 60_000 : 0;
    switch (op.op) {
      case 'refresh':
        break;
      case 'close': {
        const r = this.rooms.get(op.room);
        if (r) this.closeRoom(r);
        break;
      }
      case 'end':
        this.matchOver(op.room);
        break;
      case 'kick':
        if (target?.room) this.leaveRoom(target, 'kicked');
        break;
      case 'ban': {
        if (!target || target.admin) break;
        this.staff.bans.push({ id: randomHex(4), uid: uidBase(target.uid), addr: target.addr, account: target.account ?? undefined, name: target.name ?? '?', tag: target.tag, reason: op.reason.trim().slice(0, 120), at: now, until });
        this.saveStaff();
        this.log(`admin: banned ${target.name ?? '?'}#${target.tag} (${op.minutes || 'for good'} min)`);
        for (const m of this.connsOf(target.uid, target.addr, target.account)) {
          this.send(m, { t: 'error', code: 'banned', detail: op.reason });
          if (m.room) this.leaveRoom(m, 'kicked');
          if (m.awayUntil !== null) this.clients.delete(m.id);
          else m.conn.close();
        }
        break;
      }
      case 'mute':
        if (!target || target.admin) break;
        this.staff.mutes.push({ id: randomHex(4), uid: uidBase(target.uid), addr: '', account: target.account ?? undefined, name: target.name ?? '?', tag: target.tag, reason: '', at: now, until });
        this.saveStaff();
        break;
      case 'unban':
      case 'unmute': {
        const list = op.op === 'unban' ? this.staff.bans : this.staff.mutes;
        const i = list.findIndex((m) => m.id === op.id);
        if (i >= 0) list.splice(i, 1);
        this.saveStaff();
        break;
      }
      case 'notice': {
        const text = cleanChat(op.text);
        if (!text) break;
        const line: ChatLine = { at: now, from: null, sys: 'notice', text };
        for (const r of this.rooms.values()) {
          r.chat.push(line);
          if (r.chat.length > CHAT_KEEP) r.chat.shift();
        }
        for (const m of this.clients.values()) if (m.name && !m.admin) this.send(m, { t: 'chat', line });
        this.log(`admin: notice "${text}"`);
        break;
      }
      case 'word': {
        const w = op.word.normalize('NFC').toLowerCase().replace(/\s+/g, '');
        const i = this.staff.words.indexOf(w);
        if (op.on && w && i < 0 && this.staff.words.length < WORDS_MAX) this.staff.words.push(w);
        if (!op.on && i >= 0) this.staff.words.splice(i, 1);
        this.saveStaff();
        break;
      }
      case 'accounts':
        c.adminQuery = op.q;
        break;
      case 'reportDone': {
        const rep = this.staff.reports!.find((x) => x.id === op.id);
        if (!rep) break;
        if (op.done) rep.done = true;
        else delete rep.done;
        this.saveStaff();
        break;
      }
      case 'acctReset':
        if (!this.accounts) break;
        this.accounts.reset(op.id);
        this.log(`admin: account ${op.id.slice(0, 8)} progress reset`);
        break;
      case 'acctRevoke':
        if (!this.accounts) break;
        this.accounts.revoke(op.id);
        // Signed out everywhere: connections of that account go too (they come back as guests).
        for (const m of this.clients.values()) if (m.account === op.id && !m.admin) m.conn.close();
        this.log(`admin: account ${op.id.slice(0, 8)} signed out everywhere`);
        break;
      case 'acctTickets':
        if (!this.accounts) break;
        this.accounts.giveTickets(op.id, op.n);
        this.log(`admin: account ${op.id.slice(0, 8)} ${op.n > 0 ? '+' : ''}${op.n} tickets`);
        break;
      case 'acctStaff':
        if (!this.accounts) break;
        this.accounts.setStaff(op.id, op.on);
        for (const m of this.clients.values()) if (m.account === op.id) m.badgeAt = undefined;
        this.log(`admin: account ${op.id.slice(0, 8)} staff ${op.on ? 'on' : 'off'}`);
        break;
      case 'event': {
        const now = this.now();
        // On: until then (0 for as long as it is on); off: ended now (a bot match under way still counts it a while).
        this.staff.events![op.kind] = op.on ? (op.minutes ? now + op.minutes * 60_000 : 0) : now;
        this.saveStaff();
        for (const m of this.clients.values()) if (m.name && !m.admin) this.send(m, { t: 'events', events: this.events });
        this.log(`admin: ${op.kind} x${EVENT_MULT} ${op.on ? `on${op.minutes ? ` for ${op.minutes} min` : ''}` : 'off'}`);
        break;
      }
    }
    this.pushList();
    this.send(c, { t: 'admState', state: this.adminState(c) });
  }

  private roomList(): RoomInfo[] {
    return [...this.rooms.values()].map((x) => this.info(x));
  }

  /** Sends the room list to everyone on the list page when it changed. */
  private pushList(): void {
    const rooms = this.roomList();
    const text = JSON.stringify(rooms);
    if (text === this.lastList) return;
    this.lastList = text;
    for (const c of this.clients.values()) if (c.watching && !c.room) this.send(c, { t: 'rooms', rooms });
  }
}

/**
 * Whether `key` is the admin key `real`: a passphrase kept as a scrypt hash
 * (`scrypt$<salt>$<hash>`, base64url, written by `npm run admin:key`), or a
 * plain key (`STRIKEGY_ADMIN_KEY`, tests). Constant-time either way.
 */
export function adminKeyMatches(key: string, real: string): boolean {
  const parts = real.split('$');
  if (parts.length === 4 && parts[0] === 'scrypt') {
    const [, n, salt, hash] = parts as [string, string, string, string];
    const want = Buffer.from(hash, 'base64url');
    const N = Number(n);
    if (!(N >= 1024 && N <= 1 << 20) || want.length < 16) return false;
    const got = scryptSync(key.normalize('NFC'), Buffer.from(salt, 'base64url'), want.length, { N, r: 8, p: 1, maxmem: 256 * N * 8 });
    return timingSafeEqual(got, want);
  }
  const a = createHash('sha256').update(key).digest();
  const b = createHash('sha256').update(real).digest();
  return timingSafeEqual(a, b);
}
