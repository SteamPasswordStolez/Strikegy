/**
 * The browser's side of accounts (progression plan step 2): signing in with
 * Google or Discord through the game server's Better Auth (a popup; the
 * server's page posts the session token back), the token kept in this
 * browser, the account's progress cached here, and where progress goes:
 * signed in, to the server (bot matches checked there); a guest, to the local
 * profile as before. Light (the main menu uses it): no game modules.
 */
import { setServerEvents } from './events';
import type { ServerEvents } from './lobbyProtocol';
import { loadIdentity, saveName } from './identity';
import { loadJSON, saveJSON } from '@/core/storage';
import { serverUrls } from './servers';
import { applySummary, cleanProfile, loadProfile, newProfile, saveProfile, settleAbandoned, type MatchSummary, type Profile } from '@/progression/profile';
import { runShopOp, settleCalendar, type MatchEcon, type ShopOp } from '@/progression/economy';
import type { RankId } from '@/progression/levels';

export type Provider = 'google' | 'discord';

export interface AccountView {
  id: string;
  providers: Provider[];
  created: number;
  profile: Profile;
  /** The account's game name (the same on every device); empty until first set. */
  name?: string;
  /** Marked as the server's staff (adds its own supply tickets in the shop). */
  staff?: boolean;
}

export interface AccountConfig {
  providers: Provider[];
  devLogin: boolean;
}

/** What confirming a match did to the level (the result screen). */
export interface Committed {
  beforeXp: number;
  afterXp: number;
  promotions: RankId[];
  econ?: MatchEcon;
}

const TOKEN_KEY = 'strikegy.auth.v1';
const CACHE_KEY = 'strikegy.account.v1';
/** A guest's local profile after it moved into an account (kept, not used). */
const MOVED_KEY = 'strikegy.profile.moved.v1';
/** Better Auth's popup message (`oauth-popup` plugin). */
const POPUP_MESSAGE = 'better-auth:oauth-popup';

let base: string | null | undefined;
let config: AccountConfig | null = null;
const listeners = new Set<() => void>();

/** Called when signing in or out, or the cached account changes. */
export function onAccountChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => {
  for (const fn of listeners) fn();
};

/** The game server's HTTP address (the first in servers.json whose account API answers), or null. */
export async function apiBase(): Promise<string | null> {
  if (base !== undefined) return base;
  for (const url of await serverUrls()) {
    const http = url.replace(/^ws/, 'http').replace(/\/play$/, '');
    try {
      const res = await fetch(`${http}/api/config`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const c = (await res.json()) as Partial<AccountConfig>;
      config = { providers: (c.providers ?? []).filter((p): p is Provider => p === 'google' || p === 'discord'), devLogin: c.devLogin === true };
      // The server's double events (the menu's banner).
      setServerEvents((c as { events?: ServerEvents }).events);
      base = http;
      return base;
    } catch {
      /* the next one */
    }
  }
  base = null;
  return null;
}

/** Which sign-ins the server offers (null: no server answered). */
export async function accountConfig(): Promise<AccountConfig | null> {
  await apiBase();
  return config;
}

export function token(): string | null {
  const t = loadJSON<{ token?: unknown }>(TOKEN_KEY)?.token;
  return typeof t === 'string' && t ? t : null;
}

export function signedIn(): boolean {
  return !!token();
}

/** The account as last fetched (null: a guest, or not fetched yet). */
export function cachedAccount(): AccountView | null {
  if (!signedIn()) return null;
  const raw = loadJSON<AccountView>(CACHE_KEY);
  const profile = raw ? cleanProfile(raw.profile) : null;
  if (!raw || !profile) return null;
  return { id: String(raw.id), providers: Array.isArray(raw.providers) ? raw.providers : [], created: Number(raw.created) || 0, profile };
}

/** The progress to show and add to: the account's when signed in, else this browser's. */
export function currentProfile(): Profile {
  return signedIn() ? (cachedAccount()?.profile ?? newProfile()) : loadProfile();
}

function forget(): void {
  saveJSON(TOKEN_KEY, null);
  saveJSON(CACHE_KEY, null);
  changed();
}

async function call<T>(path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
  const b = await apiBase();
  const t = token();
  if (!b) return { status: 0, data: null };
  try {
    const res = await fetch(`${b}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => null)) as T | null;
    // The session ended (signed out elsewhere, deleted, expired): a guest again.
    if (res.status === 401 && t) forget();
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

/** Fetches the account (signed in) and caches it. */
export async function refreshAccount(): Promise<AccountView | null> {
  if (!signedIn()) return null;
  const { data } = await call<AccountView>('/api/me');
  if (!data) return cachedAccount();
  saveJSON(CACHE_KEY, data);
  // The account's name on this device too; an account without one takes this device's.
  if (data.name) saveName(data.name);
  else if (loadIdentity().name) void setAccountName(loadIdentity().name!);
  changed();
  return cachedAccount();
}

/** The staff's own supply tickets (an account the admin page marked as staff): its tickets after, or null. */
export async function staffTickets(n: number): Promise<number | null> {
  if (!signedIn()) return null;
  const { data } = await call<{ tickets?: number; profile?: Profile }>('/api/staffTickets', { n });
  const profile = data?.profile ? cleanProfile(data.profile) : null;
  const acc = cachedAccount();
  if (profile && acc) {
    saveJSON(CACHE_KEY, { ...acc, profile });
    changed();
  }
  return typeof data?.tickets === 'number' ? data.tickets : null;
}

/** Who sees the account card in rooms (signed in): whether the server took it. */
export async function setPrivacy(privacy: 'public' | 'rank' | 'private'): Promise<boolean> {
  if (!signedIn()) return false;
  const { data } = await call<{ privacy?: string }>('/api/privacy', { privacy });
  if (data?.privacy !== privacy) return false;
  const acc = cachedAccount();
  if (acc) {
    const flags = { ...acc.profile.flags };
    if (privacy === 'public') delete flags.privacy;
    else flags.privacy = privacy;
    saveJSON(CACHE_KEY, { ...acc, profile: { ...acc.profile, flags } });
    changed();
  }
  return true;
}

/** Renames the account (signed in): the name it took, or an error code ('name' / 'words' / 'offline'). */
export async function setAccountName(name: string): Promise<{ name?: string; error?: string }> {
  if (!signedIn()) return { error: 'offline' };
  const { data } = await call<{ name?: string; error?: string }>('/api/name', { name });
  if (!data) return { error: 'offline' };
  if (data.name) {
    saveName(data.name);
    const acc = cachedAccount();
    if (acc) saveJSON(CACHE_KEY, { ...acc, name: data.name });
  }
  return data;
}

/**
 * Signs in with `provider` in a popup (call from a click: the window opens at
 * once, empty, and goes to the server once its address is known). Resolves to
 * true once signed in; a guest's local progress then moves into the account.
 */
export async function signIn(provider: Provider): Promise<boolean> {
  const popup = window.open('', 'strikegy-login', 'popup,width=480,height=680');
  const b = await apiBase();
  if (!b || !popup) {
    popup?.close();
    return false;
  }
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
  const q = new URLSearchParams({ provider, popupOrigin: location.origin, popupNonce: nonce, callbackURL: `${b}/api/config` });
  popup.location.href = `${b}/api/auth/oauth-popup/start?${q}`;
  const got = await new Promise<string | null>((resolve) => {
    const origin = new URL(b).origin;
    const onMsg = (e: MessageEvent): void => {
      const d = e.data as { type?: string; nonce?: string; token?: string } | null;
      if (e.origin !== origin || d?.type !== POPUP_MESSAGE || d.nonce !== nonce) return;
      done(typeof d.token === 'string' && d.token ? d.token : null);
    };
    const timer = window.setInterval(() => {
      if (popup.closed) done(null);
    }, 500);
    const done = (t: string | null): void => {
      window.removeEventListener('message', onMsg);
      window.clearInterval(timer);
      resolve(t);
    };
    window.addEventListener('message', onMsg);
  });
  if (!got) return false;
  return finishSignIn(got);
}

/** Local testing (`STRIKEGY_DEV_LOGIN` on the local server): an account without a provider. */
export async function devSignIn(): Promise<boolean> {
  const { data } = await call<{ token?: string }>('/api/dev-login', {});
  return data?.token ? finishSignIn(data.token) : false;
}

async function finishSignIn(t: string): Promise<boolean> {
  saveJSON(TOKEN_KEY, { token: t });
  if (!(await refreshAccount())) return false;
  await moveGuest();
  changed();
  return true;
}

/**
 * The guest's local progress into the account, once per account (the server
 * caps it); the local profile is then set aside so it can't be moved twice.
 */
async function moveGuest(): Promise<void> {
  const local = loadProfile();
  if (local.xp <= 0 && local.stats.bots.matches === 0) return;
  const { status, data } = await call<{ profile: Profile }>('/api/import', { profile: local });
  if (status !== 200 || !data) return;
  saveJSON(MOVED_KEY, local);
  saveProfile(newProfile());
  const acc = cachedAccount();
  if (acc) saveJSON(CACHE_KEY, { ...acc, profile: data.profile });
}

export async function signOut(): Promise<void> {
  await call('/api/logout', {});
  forget();
}

/** The account and its progress, for good. */
export async function deleteAccount(): Promise<boolean> {
  const { status } = await call('/api/delete', {});
  if (status !== 200) return false;
  forget();
  return true;
}

/**
 * Confirms a bot match: signed in, added to the cached account at once (the
 * result screen) and sent to the server, whose checked copy then replaces
 * it; a guest, into the local profile.
 */
export function commitMatch(s: MatchSummary): Committed {
  if (!signedIn()) {
    const before = loadProfile();
    const applied = applySummary(before, s);
    saveProfile(applied.profile);
    return { beforeXp: before.xp, afterXp: applied.profile.xp, promotions: applied.promotions, econ: applied.econ };
  }
  const acc = cachedAccount();
  const before = acc?.profile ?? newProfile();
  const applied = applySummary(before, s);
  if (acc) saveJSON(CACHE_KEY, { ...acc, profile: applied.profile });
  void call<{ profile: Profile }>('/api/solo', { summary: s }).then(({ data }) => {
    const now = cachedAccount();
    if (data?.profile && now) {
      saveJSON(CACHE_KEY, { ...now, profile: data.profile });
      changed();
    }
  });
  return { beforeXp: before.xp, afterXp: applied.profile.xp, promotions: applied.promotions, econ: applied.econ };
}

/** The account's XP moved by a multiplayer match the server confirmed (its `progress` message). */
export function noteServerProgress(after: number, summary: MatchSummary): void {
  const acc = cachedAccount();
  if (!acc) return;
  saveJSON(CACHE_KEY, { ...acc, profile: applySummary(acc.profile, summary).profile });
  // The server's numbers are the truth; fetch them when there is a moment.
  if (applySummary(acc.profile, summary).profile.xp !== after) void refreshAccount();
}

/** A bot match left unfinished earlier, recorded as left where progress goes now (the menu says so once). */
export function settleLeft(): boolean {
  return !!settleAbandoned((s) => void commitMatch(s));
}

/**
 * Joins a second provider to the signed-in account (call from a click): the
 * server's link page opens in a popup, says it is ready, gets the session token
 * by `postMessage` (to the server's origin only) and goes through the provider.
 */
export async function linkProvider(provider: Provider): Promise<boolean> {
  const popup = window.open('', 'strikegy-link', 'popup,width=480,height=680');
  const b = await apiBase();
  const t = token();
  if (!b || !t || !popup) {
    popup?.close();
    return false;
  }
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
  popup.location.href = `${b}/api/link?${new URLSearchParams({ provider, origin: location.origin, nonce })}`;
  const origin = new URL(b).origin;
  const ok = await new Promise<boolean>((resolve) => {
    const onMsg = (e: MessageEvent): void => {
      const d = e.data as { type?: string; nonce?: string; ok?: boolean } | null;
      if (e.origin !== origin || d?.nonce !== nonce) return;
      if (d.type === 'strikegy-link-ready') popup.postMessage({ type: 'strikegy-link', nonce, token: t }, origin);
      else if (d.type === 'strikegy-linked') done(d.ok === true);
    };
    const timer = window.setInterval(() => {
      if (popup.closed) done(false);
    }, 500);
    const done = (v: boolean): void => {
      window.removeEventListener('message', onMsg);
      window.clearInterval(timer);
      resolve(v);
    };
    window.addEventListener('message', onMsg);
  });
  await refreshAccount();
  return ok;
}

/**
 * The profile with the day / week turned over (new dailies, mail, level
 * rewards owed): a guest's is settled and saved here; an account's comes
 * settled from the server (`refreshAccount`).
 */
export function settledProfile(now = Date.now()): Profile {
  if (signedIn()) return currentProfile();
  const p = loadProfile();
  const before = JSON.stringify(p.econ);
  settleCalendar(p, now);
  if (JSON.stringify(p.econ) !== before) saveProfile(p);
  return p;
}

/**
 * A shop / armory action (step 5): signed in, the server does it (its own
 * random numbers for boxes) and the cache takes its answer; a guest's is done
 * here and saved before anything is shown. Returns the error code or the result.
 */
export async function shopAction(op: ShopOp): Promise<{ error?: string; result?: unknown; profile: Profile }> {
  if (!signedIn()) {
    const p = loadProfile();
    const out = runShopOp(p, op, Math.random, Date.now());
    if (!out.error) saveProfile(p);
    changed();
    return { ...out, profile: p };
  }
  const { status, data } = await call<{ profile?: Profile; error?: string; result?: unknown }>('/api/shop', op);
  const acc = cachedAccount();
  const profile = data?.profile ? cleanProfile(data.profile) : null;
  if (profile && acc) {
    saveJSON(CACHE_KEY, { ...acc, profile });
    changed();
  }
  if (!data || status === 0) return { error: 'offline', profile: acc?.profile ?? newProfile() };
  return { error: data.error, result: data.result, profile: profile ?? acc?.profile ?? newProfile() };
}
