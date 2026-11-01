import { afterEach, describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts.ts';
import { LobbyCore } from '../server/lobby.ts';
import { MatchRoom } from '../server/matchRoom.ts';
import { parseClientMsg, PROTOCOL_VERSION } from '@/net/lobbyProtocol';
import { cleanProfile, cleanSummary } from '@/progression/profile';
import { parseShopOp } from '@/progression/economy';

/** Names that reach built-ins when used as a key on a plain object. */
const HOSTILE = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__'];
const known = new Set(Object.getOwnPropertyNames(Object.prototype));

function polluted(): string[] {
  return [...Object.getOwnPropertyNames(Object.prototype).filter((k) => !known.has(k)), ...['xp', 'kills', 'matches', 'wins', 'seen', 'tier', 'prog'].filter((k) => k in Object)];
}

afterEach(() => {
  for (const k of Object.getOwnPropertyNames(Object.prototype)) if (!known.has(k)) delete (Object.prototype as Record<string, unknown>)[k];
  for (const k of ['xp', 'kills', 'headshots', 'seconds', 'matches', 'wins', 'seen', 'tier', 'prog', 'special', 'triples']) delete (Object as unknown as Record<string, unknown>)[k];
});

async function account(): Promise<{ a: Accounts; id: string }> {
  const a = await Accounts.open({ file: ':memory:', baseURL: 'http://localhost:1', secret: 'x'.repeat(40), accountKey: 'y'.repeat(40), trustedOrigins: [], devLogin: true });
  const made = await a.devAccount();
  const id = await a.session(made.token);
  return { a, id: id! };
}

describe('hostile input', () => {
  it('a match summary with built-in names as keys changes nothing outside its own profile', async () => {
    const { a, id } = await account();
    for (const k of HOSTILE) {
      const body = JSON.parse(`{"result":"win","seconds":600,"xp":100,"map":"${k}","mode":"${k}","weapons":{"${k}":{"xp":1,"kills":1}},"classes":{"${k}":{"xp":1,"seconds":1}},"camo":{"${k}":{"kills":1}},"counts":{"${k}":1},"ribbons":{"${k}":1}}`);
      a.solo(id, body);
      expect(polluted(), k).toEqual([]);
    }
    const p = a.profile(id);
    for (const k of HOSTILE) {
      expect(Object.hasOwn(p.maps, k), k).toBe(false);
      expect(Object.hasOwn(p.weapons, k), k).toBe(false);
    }
    a.close();
  });

  it('a bot match from a browser only adds weapons, classes, maps and modes that exist', async () => {
    const { a, id } = await account();
    const junk = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`junk${i}`, { xp: 1, kills: 1 }]));
    a.solo(id, { result: 'win', seconds: 600, xp: 100, map: 'nowhere', mode: 'nothing', weapons: junk, classes: junk, camo: junk });
    const p = a.profile(id);
    expect(Object.keys(p.weapons)).toEqual([]);
    expect(Object.keys(p.classes)).toEqual([]);
    expect(Object.keys(p.maps)).toEqual([]);
    expect(Object.keys(p.modes)).toEqual([]);
    a.close();
  });

  it('shop actions with built-in names are refused', async () => {
    const { a, id } = await account();
    // ('prototype' is only a built-in on functions: an ordinary missing key on a plain object.)
    for (const k of HOSTILE.filter((x) => x !== 'prototype')) {
      expect(parseShopOp({ op: 'buy', key: k }), k).toBeNull();
      expect(parseShopOp({ op: 'craft', item: k }), k).toBeNull();
      expect(parseShopOp({ op: 'claim', id: k }), k).toBeNull();
      expect(parseShopOp({ op: 'equip', slot: 'camo', value: k, weapon: 'ar1' }), k).toBeNull();
      expect(parseShopOp({ op: 'equip', slot: 'camo', weapon: k }), k).toBeNull();
      a.shop(id, { op: 'seen', items: [k] });
      expect(polluted(), k).toEqual([]);
    }
    a.close();
  });

  it('a saved or imported profile with built-in names loads clean', () => {
    for (const k of HOSTILE) {
      const raw = JSON.parse(`{"v":1,"xp":10,"maps":{"${k}":{"matches":1}},"weapons":{"${k}":{"xp":1}},"econ":{"items":{"${k}":{"at":1}},"camo":{"${k}":{"tier":1}},"equip":{"camo":{"${k}":"a"},"skin":{"${k}":"a"}}}}`);
      const p = cleanProfile(raw);
      expect(polluted(), k).toEqual([]);
      if (p) expect(Object.getPrototypeOf(p.maps), k).toBe(Object.prototype);
    }
    expect(cleanSummary({ result: 'win', map: '__proto__', mode: 'constructor' })).toMatchObject({ map: '', mode: '' });
  });

  it('the lobby takes any junk a connection sends without throwing', async () => {
    const core = new LobbyCore({ log: () => {}, tagSecret: 'k'.repeat(32), adminKey: 'a'.repeat(20) });
    const sent: string[] = [];
    const id = core.open({ send: (m) => void sent.push(m), binary: () => {}, close: () => {} }, undefined, '198.51.100.7');
    const values: unknown[] = [null, 0, -1, 1e308, true, '', 'x'.repeat(5000), [], {}, [[]], { __proto__: 1 }, ...HOSTILE];
    await core.message(id, JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'fuzzer', uid: 'aaaaaaaaaaaa', device: 'desktop' }));
    const kinds = ['hello', 'list', 'unlist', 'create', 'join', 'leave', 'settings', 'team', 'start', 'end', 'ready', 'deploy', 'redeploy', 'callin', 'kick', 'chat', 'mute', 'card', 'report', 'adminAuth', 'adm', 'host', 'away', ...HOSTILE];
    const fields = ['name', 'room', 'id', 'password', 'team', 'member', 'text', 'kind', 'point', 'key', 'kit', 'settings', 'tag', 'reason', 'note', 'on', 'op', 'uid', 'token', 'v'];
    for (const t of kinds) {
      for (const f of fields) {
        for (const v of values) {
          await expect(core.message(id, JSON.stringify({ t, [f]: v }))).resolves.not.toThrow();
        }
      }
      await expect(core.message(id, JSON.stringify({ t, settings: { map: '__proto__', mode: 'constructor', size: 1e9, lineup: 'toString', input: 'x', teamPick: 'y' }, name: 'room' }))).resolves.not.toThrow();
    }
    for (const raw of ['', '{', 'null', '[]', '1', '"x"', '{"t":null}', '{"__proto__":{"t":"list"}}']) await expect(core.message(id, raw)).resolves.not.toThrow();
    expect(parseClientMsg('{"t":"constructor"}')).toBeNull();
    expect(polluted()).toEqual([]);
  }, 60000);

  it('a match room takes junk from a player without throwing', async () => {
    const room = await MatchRoom.create({ room: 'fz', map: 'persia', mode: 'zone', lineup: 'users', size: 8 });
    try {
      room.join({ uid: 'u1', name: 'one' }, { text: () => {}, binary: () => {} });
      room.ready('u1');
      room.tick();
      const kits: unknown[] = [null, 1, 'x', [], {}, { cls: '__proto__' }, { cls: 'constructor', primary: 'toString', secondary: '__proto__', attach: { __proto__: { optic: 'x' }, constructor: { optic: 'y' }, ar1: { constructor: 'z' } }, contract: 'constructor' }, JSON.parse('{"cls":"assault","attach":{"__proto__":{"optic":"x"}}}')];
      for (const key of ['base', '__proto__', 'constructor', 'zone:__proto__', 'tank:constructor', 'jet:__proto__', 'veh:999999', 'ship:0', 'mate:1', 'beacon:1'])
        for (const kit of kits) {
          expect(() => room.deploy('u1', key, kit)).not.toThrow();
          expect(() => room.tick()).not.toThrow();
        }
      for (const kind of HOSTILE) {
        expect(() => room.callIn('u1', kind, [0, 0, 0])).not.toThrow();
        expect(() => room.callIn('u1', kind, null)).not.toThrow();
      }
      expect(() => room.callIn('u1', 'mortar', [1e308, -1e308, 1e308])).not.toThrow();
      const sizes = [0, 1, 2, 3, 7, 16, 64, 255, 1024, 60000];
      for (const n of sizes) {
        for (const fill of [0, 1, 7, 127, 255]) {
          const data = new Uint8Array(n).fill(fill);
          expect(() => room.binary('u1', data)).not.toThrow();
        }
        expect(() => room.tick()).not.toThrow();
      }
      expect(polluted()).toEqual([]);
    } finally {
      room.dispose();
    }
  }, 60000);
});
