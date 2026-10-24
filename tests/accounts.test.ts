import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type RoomSettings, type ServerMsg } from '@/net/lobbyProtocol';
import { newProfile, type MatchSummary } from '@/progression/profile';
import { ProgressTracker } from '@/progression/tracker';
import { xpForLevel } from '@/progression/levels';
import { Accounts, IMPORT_CAP, SOLO_DAY_CAP } from '../server/accounts';
import { LobbyCore, type Conn } from '../server/lobby';
import { MatchRoom } from '../server/matchRoom';

const open: Accounts[] = [];
async function accounts(now = () => Date.UTC(2026, 9, 24, 12)): Promise<Accounts> {
  const a = await Accounts.open({ file: ':memory:', baseURL: 'http://localhost:8787', secret: 's'.repeat(40), accountKey: 'k'.repeat(40), trustedOrigins: ['http://localhost:5173'], devLogin: true, now });
  open.push(a);
  return a;
}
afterEach(() => {
  for (const a of open.splice(0)) a.close();
});

const bots = (xp: number, seconds: number, kills = 0): MatchSummary => ({ kind: 'bots', map: 'persia', mode: 'zone', result: 'win', seconds, score: 0, xp, lines: [], mult: [], stats: { kills, headshots: kills }, weapons: { ar1: { xp, kills, headshots: 0 } }, classes: {} });

describe('accounts on the game server', () => {
  it('a session token finds its account; nothing personal is stored', async () => {
    const a = await accounts();
    const { userId, token } = await a.devAccount();
    expect(await a.session(token)).toBe(userId);
    expect(await a.session('nonsense')).toBeNull();
    expect(await a.session(undefined)).toBeNull();
    const row = a.db.prepare('select email, name, image from user where id = ?').get(userId) as { email: string; name: string; image: string | null };
    expect(row.email.endsWith('@users.invalid')).toBe(true);
    expect(row.name).toBe('');
    expect(row.image).toBeNull();
    const s = a.db.prepare('select ipAddress, userAgent from session where userId = ?').get(userId) as { ipAddress: string | null; userAgent: string | null };
    expect(s).toEqual({ ipAddress: null, userAgent: null });
  });

  it('checks a browser bot match: no more XP than its length allows, and 1,000,000 a day', async () => {
    let now = Date.UTC(2026, 9, 24, 1);
    const a = await accounts(() => now);
    const { userId } = await a.devAccount();
    // 10 minutes can't be worth 500,000.
    const cut = a.solo(userId, bots(500_000, 600, 900))!;
    expect(cut.profile.xp).toBe(600 * 90 + 20_000);
    expect(cut.profile.weapons.ar1!.xp).toBeLessThan(500_000);
    expect(cut.profile.stats.bots.kills).toBe(300);
    expect(cut.profile.stats.bots.headshots).toBeLessThanOrEqual(300);
    // The day's cap, then a new day.
    for (let i = 0; i < 30; i++) a.solo(userId, bots(60_000, 3600));
    expect(a.profile(userId).solo).toEqual({ day: '2026-10-24', xp: SOLO_DAY_CAP });
    now += 24 * 3600_000;
    expect(a.solo(userId, bots(1000, 600))!.profile.xp).toBe(SOLO_DAY_CAP + 1000);
    expect(a.solo(userId, { nope: 1 })).toBeNull();
  });

  it("moves a guest's progress once, up to the cap, and deletes the account for good", async () => {
    const a = await accounts();
    const { userId, token } = await a.devAccount();
    const guest = { ...newProfile(0), xp: xpForLevel(400) };
    guest.stats.bots.kills = 77;
    const moved = a.importGuest(userId, guest)!;
    expect(moved.xp).toBe(IMPORT_CAP);
    expect(moved.stats.bots.kills).toBe(77);
    expect(a.importGuest(userId, guest)).toBeNull();
    a.remove(userId);
    expect(await a.session(token)).toBeNull();
    expect(a.exists(userId)).toBe(false);
    expect((a.db.prepare('select count(*) as n from profile').get() as { n: number }).n).toBe(0);
  });
});

describe('the lobby with accounts', () => {
  const settings: RoomSettings = { name: 'r', map: 'lyon', mode: 'zone', size: 8, lineup: 'users', difficulty: 'normal', input: 'all', botShare: true, teamPick: 'random', chat: true, simple: false };
  const fake = () => {
    const got: ServerMsg[] = [];
    const conn: Conn = { send: (t) => got.push(JSON.parse(t) as ServerMsg), close: () => {} };
    return { conn, got, last: <T extends ServerMsg['t']>(t: T) => got.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined };
  };

  it('rooms need a signed-in player; the tag follows the account; a match is confirmed into it', async () => {
    const acc = await accounts();
    const core = new LobbyCore({ tagSecret: 'k', accounts: acc });
    const { userId, token } = await acc.devAccount();
    const guest = fake();
    const gid = core.open(guest.conn);
    await core.message(gid, JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'guest', uid: 'g1', device: 'desktop' }));
    expect(guest.last('welcome')!.account).toBe(false);
    await core.message(gid, JSON.stringify({ t: 'create', settings }));
    expect(guest.last('error')!.code).toBe('login');

    const tags: string[] = [];
    for (const uid of ['b1', 'b2']) {
      const f = fake();
      const id = core.open(f.conn);
      await core.message(id, JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'me', uid, device: 'desktop', token }));
      expect(f.last('welcome')!.account).toBe(true);
      tags.push(f.last('welcome')!.tag);
      if (uid === 'b2') {
        await core.message(id, JSON.stringify({ t: 'create', settings }));
        expect(f.last('room')).toBeTruthy();
        // The match's progress comes back for this browser's id: into the account, and told.
        const t = new ProgressTracker({ kind: 'multi', map: 'lyon', mode: 'zone', difficulty: null, startXp: 0 });
        t.points('kill', 100, 0);
        core.matchProgress('r', 'b2', t.leave(5));
        expect(acc.profile(userId).xp).toBe(1000);
        expect(f.last('progress')).toMatchObject({ before: 0, after: 1000 });
      }
    }
    // Two browsers, one account: the same tag.
    expect(tags[0]).toBe(tags[1]);
  });
});

describe('progress in a room on the server', () => {
  it('signed-in players get a tracker; leaving with two people undoes it, with three keeps it; a stop keeps it', async () => {
    const room = await MatchRoom.create({ room: 'r-prog', map: 'persia', mode: 'zone', lineup: 'users', size: 8 });
    const got: { uid: string; s: MatchSummary }[] = [];
    (room as unknown as { opts: { progress: (uid: string, s: MatchSummary) => void } }).opts.progress = (uid, s) => got.push({ uid, s });
    try {
      const conn = { text: () => {}, binary: () => {} };
      room.join({ uid: 'a', name: 'a', xp: 0 }, conn);
      room.join({ uid: 'b', name: 'b', xp: 0 }, conn);
      room.join({ uid: 'guest', name: 'g' }, conn);
      const ids = room.sim.scores.table(null).map((r) => r.id);
      // Points for everyone; guests have no tracker.
      for (const id of ids) room.sim.scores.objective([id], 'capture');
      room.leave('guest');
      expect(got).toHaveLength(0);
      // The guest went first: two people remain, so 'a' leaving undoes everything.
      room.leave('a');
      expect(got[0]).toMatchObject({ uid: 'a', s: { result: 'left', xp: 0 } });
      room.join({ uid: 'c', name: 'c', xp: 0 }, conn);
      room.join({ uid: 'd', name: 'd', xp: 0 }, conn);
      room.leave('b');
      expect(got[1]).toMatchObject({ uid: 'b', s: { result: 'left', xp: 1500 } });
      room.settle();
      expect(got.slice(2).map((g) => [g.uid, g.s.result])).toEqual([
        ['c', 'stopped'],
        ['d', 'stopped'],
      ]);
    } finally {
      room.dispose();
    }
  });
});
