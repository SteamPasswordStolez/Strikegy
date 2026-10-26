/**
 * Accounts on the game server (progression plan step 2, docs/design/progression.md
 * 4-1 / 4-3): sign-in with Google or Discord through Better Auth, one SQLite
 * file (`.strikegy-accounts.db`, git-ignored; better-sqlite3 12.x, the laptop
 * stays on Node 20) holding Better Auth's tables and each account's progress
 * (`Profile` as JSON).
 *
 * Nothing personal is kept (owner, 2026-10-24): Google is asked for `openid`
 * only and Discord for `identify` only; the provider's user number is never
 * stored, only an HMAC of it under the server's account key (losing that key
 * loses every account: back it up with the database), and the email Better
 * Auth requires is a placeholder `<hash>@users.invalid` (its own documented
 * way for providers without email). OAuth tokens, the address and the
 * browser's name are dropped before they are written.
 *
 * Sign-in is Better Auth's popup flow (`oauth-popup`): the site opens
 * `/api/auth/oauth-popup/start` here, the provider comes back here, and the
 * page posts the session token to the site (a trusted origin), which sends it
 * as `Authorization: Bearer` (`bearer`) and in the WebSocket's hello.
 */
import { INCOME } from '../src/progression/income.ts';
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { cleanName, reservedText } from '../src/net/lobbyProtocol.ts';
import { profane } from '../src/net/wordFilter.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { bearer, oauthPopup } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
import { toNodeHandler } from 'better-auth/node';
import { levelOf, xpForLevel } from '../src/progression/levels.ts';
import { applySummary, cleanProfile, cleanSummary, newProfile, type Applied, type MatchSummary, type Profile } from '../src/progression/profile.ts';
import { econOf, parseShopOp, runShopOp, settleCalendar } from '../src/progression/economy.ts';

export interface AccountsOptions {
  /** The database file (':memory:' in tests). */
  file: string;
  /** Where the server is reached from browsers, e.g. https://game.strikegy.xyz (auth under /api/auth). */
  baseURL: string;
  /** Better Auth's secret (`BETTER_AUTH_SECRET`). */
  secret: string;
  /** Hashes the providers' user numbers (keep it with the database). */
  accountKey: string;
  /** Sites allowed to sign in and call the account API. */
  trustedOrigins: string[];
  google?: { clientId: string; clientSecret: string };
  discord?: { clientId: string; clientSecret: string };
  /** Local testing: `POST /api/dev-login` makes an account without a provider (never in production). */
  devLogin?: boolean;
  now?: () => number;
  log?: (line: string) => void;
}

/** Bot-match XP the server takes from one account in a UTC day (progression.md 4-2). */
export const SOLO_DAY_CAP = 1_000_000;
/** A bot match can't be worth more than this a second, bonuses aside (a strong player makes ~50). */
const SOLO_XP_PER_SEC = 90;
const SOLO_BONUS = 20_000;
const SOLO_SECONDS_MAX = 4 * 3600;
/** A kill's weapon XP at most (125 points x 10, hard bots x1.2). */
const SOLO_WEAPON_KILL_XP = 1500;
/** A guest's progress moved to a new account at most up to this (중사, ~17 h of bot matches). */
export const IMPORT_CAP = xpForLevel(130);

export type AccountProviders = ('google' | 'discord')[];

/** The JSON the account API answers with. */
export interface AccountView {
  id: string;
  providers: AccountProviders;
  created: number;
  profile: Profile;
  /** The account's game name (the same on every device; owner, 2026-10-25), empty until first set. */
  name: string;
  /** Marked as the server's staff (adds its own tickets in the shop). */
  staff?: true;
}

function makeAuth(db: Database.Database, o: AccountsOptions) {
  const hashed = (provider: string, id: string) => createHmac('sha256', o.accountKey).update(`${provider}:${id}`).digest('hex').slice(0, 32);
  const placeholder = (h: string) => ({ id: h, name: '', email: `${h}@users.invalid`, emailVerified: false });
  const social: Record<string, object> = {};
  if (o.google)
    social.google = {
      ...o.google,
      disableDefaultScope: true,
      scope: ['openid'],
      prompt: 'select_account',
      // The ID token's subject only (the token came straight from Google's token endpoint).
      getUserInfo: async (token: { idToken?: string }) => {
        const part = token.idToken?.split('.')[1];
        if (!part) return null;
        let sub: unknown;
        try {
          sub = (JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { sub?: unknown }).sub;
        } catch {
          return null;
        }
        if (typeof sub !== 'string' || !sub) return null;
        const h = hashed('google', sub);
        return { user: placeholder(h), data: { sub: h } };
      },
    };
  if (o.discord)
    social.discord = {
      ...o.discord,
      disableDefaultScope: true,
      scope: ['identify'],
      getUserInfo: async (token: { accessToken?: string }) => {
        if (!token.accessToken) return null;
        const res = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${token.accessToken}` } }).catch(() => null);
        if (!res?.ok) return null;
        const id = ((await res.json()) as { id?: unknown }).id;
        if (typeof id !== 'string' || !id) return null;
        const h = hashed('discord', id);
        return { user: placeholder(h), data: { id: h } };
      },
    };
  return betterAuth({
    database: db,
    secret: o.secret,
    baseURL: `${o.baseURL}/api/auth`,
    trustedOrigins: o.trustedOrigins,
    socialProviders: social,
    session: { expiresIn: 60 * 60 * 24 * 60, updateAge: 60 * 60 * 24 },
    account: {
      // Placeholder emails never match, so only an explicit link (signed in) joins a second provider.
      accountLinking: { enabled: true, trustedProviders: ['google', 'discord'], allowDifferentEmails: true, disableImplicitLinking: true },
      storeStateStrategy: 'database',
    },
    advanced: { ipAddress: { disableIpTracking: true } },
    databaseHooks: {
      // No provider tokens (nothing is fetched later), no address or browser name.
      account: {
        create: { before: async (a: Record<string, unknown>) => ({ data: { ...a, accessToken: null, refreshToken: null, idToken: null, scope: null } }) },
        update: { before: async (a: Record<string, unknown>) => ({ data: { ...a, accessToken: null, refreshToken: null, idToken: null } }) },
      },
      session: { create: { before: async (s: Record<string, unknown>) => ({ data: { ...s, ipAddress: null, userAgent: null } }) } },
    },
    plugins: [bearer(), oauthPopup()],
  });
}

type Auth = ReturnType<typeof makeAuth>;

export class Accounts {
  private readonly now: () => number;
  /** Better Auth's own routes (`/api/auth/*`). */
  readonly handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;

  private constructor(
    readonly db: Database.Database,
    readonly auth: Auth,
    private readonly opts: AccountsOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.handler = toNodeHandler(auth) as (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  }

  static async open(o: AccountsOptions): Promise<Accounts> {
    const db = new Database(o.file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const auth = makeAuth(db, o);
    const m = await getMigrations(auth.options);
    if (m.toBeCreated.length || m.toBeAdded.length) await m.runMigrations();
    db.exec('create table if not exists profile (userId text primary key, data text not null, name text, updatedAt integer not null)');
    // The server's staff accounts (marked on the admin page; owner, 2026-10-25).
    db.exec('create table if not exists staff (userId text primary key, at integer not null)');
    return new Accounts(db, auth, o);
  }

  get trustedOrigins(): readonly string[] {
    return this.opts.trustedOrigins;
  }

  get devLogin(): boolean {
    return !!this.opts.devLogin;
  }

  /** Signing in is possible: rooms then need it (until the owner sets up a provider, everyone plays as a guest). */
  get required(): boolean {
    return this.providers.length > 0 || this.devLogin;
  }

  /** Which providers are set up (the site offers only those). */
  get providers(): AccountProviders {
    const out: AccountProviders = [];
    if (this.opts.google) out.push('google');
    if (this.opts.discord) out.push('discord');
    return out;
  }

  close(): void {
    this.db.close();
  }

  /** The account a bearer token belongs to, or null (unknown, expired, signed out). */
  async session(token: string | undefined): Promise<string | null> {
    if (!token || token.length > 512) return null;
    try {
      const s = await this.auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
      return s?.user.id ?? null;
    } catch {
      return null;
    }
  }

  /** The account of a request's `Authorization: Bearer` header. */
  async fromRequest(req: IncomingMessage): Promise<string | null> {
    const h = req.headers.authorization;
    if (!h || !/^bearer /i.test(h)) return null;
    return this.session(h.slice(7).trim());
  }

  exists(userId: string): boolean {
    return !!this.db.prepare('select 1 from user where id = ?').get(userId);
  }

  profile(userId: string): Profile {
    const row = this.db.prepare('select data from profile where userId = ?').get(userId) as { data: string } | undefined;
    if (row) {
      try {
        const p = cleanProfile(JSON.parse(row.data));
        if (p) return p;
      } catch {
        /* a broken row: start again rather than lock the account out */
      }
    }
    const created = (this.db.prepare('select createdAt from user where id = ?').get(userId) as { createdAt?: number | string } | undefined)?.createdAt;
    return newProfile(created === undefined ? this.now() : new Date(created).getTime());
  }

  save(userId: string, p: Profile, name?: string): void {
    this.db
      .prepare('insert into profile (userId, data, name, updatedAt) values (?, ?, ?, ?) on conflict(userId) do update set data = excluded.data, name = coalesce(excluded.name, profile.name), updatedAt = excluded.updatedAt')
      .run(userId, JSON.stringify(p), name ?? null, this.now());
  }

  /** Marked as the server's staff (on the admin page, which needs its key). */
  isStaff(userId: string): boolean {
    return !!this.db.prepare('select 1 from staff where userId = ?').get(userId);
  }

  setStaff(userId: string, on: boolean): void {
    if (on) this.db.prepare('insert or ignore into staff (userId, at) values (?, ?)').run(userId, this.now());
    else this.db.prepare('delete from staff where userId = ?').run(userId);
  }

  /** Supply tickets into an account (the staff's grant; never below 0). Its tickets after, or null without the account. */
  giveTickets(userId: string, n: number): number | null {
    if (!this.exists(userId) || !Number.isInteger(n)) return null;
    const p = this.profile(userId);
    const e = econOf(p);
    e.tickets = Math.max(0, e.tickets + n);
    this.save(userId, p);
    this.opts.log?.(`account ${userId.slice(0, 8)}: ${n > 0 ? '+' : ''}${n} tickets by the staff`);
    return e.tickets;
  }

  /** The account's game name, if one is set. */
  nameOf(userId: string): string | null {
    return (this.db.prepare('select name from profile where userId = ?').get(userId) as { name?: string | null } | undefined)?.name || null;
  }

  /** A new game name for the account (checked like a hello's name): the name, or why not. */
  rename(userId: string, raw: unknown, words: readonly string[] = []): { name: string } | { error: 'name' | 'words' } {
    const name = typeof raw === 'string' ? cleanName(raw) : null;
    if (!name || reservedText(name)) return { error: 'name' };
    if (profane(name, words)) return { error: 'words' };
    this.setName(userId, name);
    return { name };
  }

  /** Who sees the account card: everyone all of it, its rank and look, or its look only. */
  setPrivacy(userId: string, raw: unknown): { privacy: 'public' | 'rank' | 'private' } | null {
    if (raw !== 'public' && raw !== 'rank' && raw !== 'private') return null;
    const p = this.profile(userId);
    if (raw === 'public') delete p.flags.privacy;
    else p.flags.privacy = raw;
    this.save(userId, p);
    return { privacy: raw };
  }

  /** The account's game name (the admin page finds people by it). */
  setName(userId: string, name: string): void {
    this.db.prepare('update profile set name = ? where userId = ?').run(name, userId);
    if (!this.db.prepare('select 1 from profile where userId = ?').get(userId)) this.save(userId, this.profile(userId), name);
  }

  providersOf(userId: string): AccountProviders {
    const rows = this.db.prepare('select providerId from account where userId = ?').all(userId) as { providerId: string }[];
    return rows.map((r) => r.providerId).filter((p): p is 'google' | 'discord' => p === 'google' || p === 'discord');
  }

  view(userId: string): AccountView {
    const created = (this.db.prepare('select createdAt from user where id = ?').get(userId) as { createdAt?: number | string } | undefined)?.createdAt;
    // The day / week turned since: new dailies, the salary in the mail, level rewards owed.
    const p = this.profile(userId);
    const before = JSON.stringify(p.econ);
    settleCalendar(p, this.now());
    if (JSON.stringify(p.econ) !== before) this.save(userId, p);
    return { id: userId, providers: this.providersOf(userId), created: created === undefined ? 0 : new Date(created).getTime(), profile: p, name: this.nameOf(userId) ?? '', ...(this.isStaff(userId) ? { staff: true } : {}) };
  }

  /**
   * A shop / armory action (step 5): buying, boxes (the server's own random
   * numbers; the result is saved before it is sent), the exchange, missions,
   * mail, boosters, what is worn. Returns the profile after it.
   */
  shop(userId: string, raw: unknown): { profile: Profile; error?: string; result?: unknown } | null {
    const op = parseShopOp(raw);
    if (!op) return null;
    const p = this.profile(userId);
    const out = runShopOp(p, op, () => randomInt(0, 2 ** 32) / 2 ** 32, this.now());
    if (!out.error) this.save(userId, p);
    return { profile: p, ...out };
  }

  /** A match the server watched (multiplayer): added as it is. */
  apply(userId: string, s: MatchSummary): Applied {
    const applied = applySummary(this.profile(userId), s, this.now());
    this.save(userId, applied.profile);
    return applied;
  }

  /**
   * A bot match a browser reports: the sanity checks of progression.md 4-2
   * (no more XP than the match's length allows, the kills it allows, 1,000,000
   * bot-match XP a day), then added.
   */
  solo(userId: string, raw: unknown, events: Partial<Record<'xp' | 'weapon' | 'tickets', number>> = {}): Applied | null {
    const s = cleanSummary(raw);
    if (!s) return null;
    s.kind = 'bots';
    s.seconds = Math.min(s.seconds, SOLO_SECONDS_MAX);
    // A double event the staff ran during the match lifts its caps the same way.
    const ev = { xp: events.xp ?? 1, weapon: events.weapon ?? 1, tickets: events.tickets ?? 1 };
    const cap = Math.floor((s.seconds * SOLO_XP_PER_SEC + SOLO_BONUS) * ev.xp);
    const p = this.profile(userId);
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const today = p.solo?.day === day ? p.solo.xp : 0;
    const xp = Math.max(0, Math.min(s.xp, cap, SOLO_DAY_CAP * ev.xp - today));
    if (xp < s.xp) {
      // Cut down: everything that came from the match shrinks with it.
      const k = s.xp > 0 ? xp / s.xp : 0;
      for (const w of Object.values(s.weapons)) w.xp = Math.floor(w.xp * k);
      for (const c of Object.values(s.classes)) c.xp = Math.floor(c.xp * k);
      this.opts.log?.(`account ${userId.slice(0, 8)}: bot match cut ${s.xp} -> ${xp} XP`);
    }
    s.xp = xp;
    const st = s.stats;
    const most = Math.ceil(s.seconds / 2);
    // Step 5: tickets within what the match's XP, ribbons, standing and bounties allow; counts within its length.
    s.tickets = Math.min(s.tickets ?? 0, Math.floor(((xp * 1.5) / 200 + 1500) * INCOME * ev.tickets) + 1);
    for (const [k, v] of Object.entries(s.counts ?? {})) (s.counts as Record<string, number>)[k] = Math.min(v ?? 0, k === 'seaDamage' ? s.seconds * 3000 : most);
    for (const [id, c] of Object.entries(s.camo ?? {})) {
      const kills = Math.min(s.weapons[id]?.kills ?? 0, most);
      c.kills = Math.min(c.kills, kills);
      c.headshots = Math.min(c.headshots, kills);
      c.triples = Math.min(c.triples, Math.floor(kills / 3));
      c.special = Math.min(c.special, kills);
    }
    for (const k of ['kills', 'headshots', 'meleeKills', 'revives', 'captures', 'neutralizes', 'builds', 'resupplies'] as const) if (st[k] !== undefined) st[k] = Math.min(st[k]!, most);
    if (st.headshots !== undefined) st.headshots = Math.min(st.headshots, st.kills ?? 0);
    // Weapon XP only comes from kills (a headshot kill on hard is the most, 1,500), and is part of the match's XP.
    let left = xp * ev.weapon;
    for (const w of Object.values(s.weapons)) {
      w.kills = Math.min(w.kills, most);
      w.headshots = Math.min(w.headshots, w.kills);
      w.xp = Math.min(w.xp, w.kills * SOLO_WEAPON_KILL_XP * ev.weapon, left);
      left -= w.xp;
    }
    const applied = applySummary(p, s, this.now());
    applied.profile.solo = { day, xp: today + xp };
    this.save(userId, applied.profile);
    return applied;
  }

  /**
   * A guest's local progress moved to the account, once: its XP up to
   * `IMPORT_CAP` (only when the account has less), its records added up.
   */
  importGuest(userId: string, raw: unknown): Profile | null {
    const p = this.profile(userId);
    const guest = cleanProfile(raw);
    if (!guest || p.flags.imported) return null;
    p.flags.imported = true;
    if (guest.xp > p.xp) p.xp = Math.max(p.xp, Math.min(guest.xp, IMPORT_CAP));
    if (guest.flags.tutorial) p.flags.tutorial = true;
    // The record (not XP): numbers added up, best ones kept, the history merged.
    for (const kind of ['bots', 'multi'] as const) {
      const a = p.stats[kind];
      const b = guest.stats[kind];
      for (const k of Object.keys(a) as (keyof typeof a)[]) a[k] = k === 'bestScore' || k === 'bestStreak' ? Math.max(a[k], b[k]) : a[k] + b[k];
    }
    for (const [table, from] of [
      [p.weapons, guest.weapons],
      [p.classes, guest.classes],
      [p.maps, guest.maps],
      [p.modes, guest.modes],
    ] as [Record<string, Record<string, number>>, Record<string, Record<string, number>>][])
      for (const [id, row] of Object.entries(from)) {
        const to = (table[id] ??= Object.fromEntries(Object.keys(row).map((k) => [k, 0])));
        for (const [k, v] of Object.entries(row)) to[k] = (to[k] ?? 0) + v;
      }
    p.history = [...p.history, ...guest.history].sort((x, y) => y.at - x.at).slice(0, 20);
    this.save(userId, p);
    return p;
  }

  /** Signs every session of the account out. */
  revoke(userId: string): void {
    this.db.prepare('delete from session where userId = ?').run(userId);
  }

  /** The account and everything of it, for good (the record's delete button, progression.md 4-1). */
  remove(userId: string): void {
    this.db.transaction(() => {
      this.db.prepare('delete from profile where userId = ?').run(userId);
      this.db.prepare('delete from session where userId = ?').run(userId);
      this.db.prepare('delete from account where userId = ?').run(userId);
      this.db.prepare('delete from user where id = ?').run(userId);
    })();
  }

  /** Progress back to nothing (the admin page: a suspected cheat). */
  reset(userId: string): void {
    const created = this.profile(userId).created;
    this.save(userId, { ...newProfile(created), flags: { imported: true } });
  }

  /** Accounts for the admin page: by game name (part of it) or id prefix, newest first. */
  find(query: string, limit = 30): { id: string; name: string; xp: number; level: number; matches: number; updated: number; providers: AccountProviders; tickets: number; staff: boolean }[] {
    const q = query.trim().slice(0, 40);
    const rows = this.db
      .prepare("select u.id as id, p.name as name, p.data as data, p.updatedAt as updatedAt from user u left join profile p on p.userId = u.id where (? = '' or p.name like ? escape '\\' or u.id like ?) order by coalesce(p.updatedAt, 0) desc limit ?")
      .all(q, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`, `${q}%`, limit) as { id: string; name: string | null; data: string | null; updatedAt: number | null }[];
    return rows.map((r) => {
      let p: Profile | null;
      try {
        p = r.data ? cleanProfile(JSON.parse(r.data)) : null;
      } catch {
        p = null;
      }
      const xp = p?.xp ?? 0;
      return { id: r.id, name: r.name ?? '', xp, level: levelOf(xp).level, matches: (p?.stats.bots.matches ?? 0) + (p?.stats.multi.matches ?? 0), updated: r.updatedAt ?? 0, providers: this.providersOf(r.id), tickets: p?.econ?.tickets ?? 0, staff: this.isStaff(r.id) };
    });
  }

  get count(): number {
    return (this.db.prepare('select count(*) as n from user').get() as { n: number }).n;
  }

  /** Local testing only: a new account and its session token, no provider. */
  async devAccount(): Promise<{ userId: string; token: string }> {
    if (!this.opts.devLogin) throw new Error('dev login is off');
    const ctx = await this.auth.$context;
    const n = Math.random().toString(36).slice(2, 12);
    const user = await ctx.internalAdapter.createUser({ email: `dev-${n}@users.invalid`, name: '', emailVerified: false }, { method: 'anonymous' });
    const session = await ctx.internalAdapter.createSession(user.id, false);
    return { userId: user.id, token: session.token };
  }

  /** Online backup into `path` (the daily copy: SQLite's own `.backup`, consistent while in use). */
  async backup(path: string): Promise<void> {
    await this.db.backup(path);
  }
}

/** The sites that may sign in (the domain, its github.io copy with /mp/ and /exp/, local development). */
export const DEFAULT_ORIGINS = ['https://strikegy.xyz', 'https://www.strikegy.xyz', 'https://steampasswordstolez.github.io', 'http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173'];

/** A key kept in a file next to the server when the environment has none (made on first start, 0600, git-ignored). */
function keyFile(path: string, env: string | undefined, log: (line: string) => void): string {
  if (env && env.length >= 32) return env;
  try {
    const saved = readFileSync(path, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {
    /* none yet */
  }
  const fresh = randomBytes(32).toString('base64url');
  writeFileSync(path, fresh, { mode: 0o600 });
  log(`accounts: a new key is in ${path} (back it up with the database)`);
  return fresh;
}

/**
 * The accounts as the environment sets them up (`npm run server`; on the
 * laptop a systemd EnvironmentFile): BETTER_AUTH_SECRET (else a key file),
 * STRIKEGY_PUBLIC_URL (default http://localhost:8787), GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET, DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET,
 * STRIKEGY_ACCOUNT_KEY (else `.strikegy-account-key`), STRIKEGY_ACCOUNTS_DB
 * (default `.strikegy-accounts.db`), STRIKEGY_ORIGINS (comma list) and
 * STRIKEGY_DEV_LOGIN=1 (local testing; refused unless the public URL is local).
 */
export async function accountsFromEnv(log: (line: string) => void): Promise<Accounts> {
  const env = process.env;
  const baseURL = (env.STRIKEGY_PUBLIC_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
  const pair = (id?: string, secret?: string) => (id && secret ? { clientId: id, clientSecret: secret } : undefined);
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseURL);
  const accounts = await Accounts.open({
    file: env.STRIKEGY_ACCOUNTS_DB ?? '.strikegy-accounts.db',
    baseURL,
    secret: keyFile('.strikegy-auth-secret', env.BETTER_AUTH_SECRET, log),
    accountKey: keyFile('.strikegy-account-key', env.STRIKEGY_ACCOUNT_KEY, log),
    trustedOrigins: env.STRIKEGY_ORIGINS ? env.STRIKEGY_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS,
    google: pair(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    discord: pair(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET),
    devLogin: env.STRIKEGY_DEV_LOGIN === '1' && local,
    log,
  });
  log(`accounts: ${accounts.count} (${accounts.providers.join(', ') || 'no providers set up'}${accounts.devLogin ? ', test logins' : ''}; ${accounts.required ? 'rooms need signing in' : 'rooms open to guests'})`);
  return accounts;
}
