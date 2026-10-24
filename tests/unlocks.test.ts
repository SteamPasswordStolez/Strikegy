import { describe, expect, it } from 'vitest';
import { sanitizeLoadout } from '@/data/classes';
import { cleanSettings, type RoomSettings } from '@/net/lobbyProtocol';
import { xpForLevel } from '@/progression/levels';
import { ProgressTracker } from '@/progression/tracker';
import { WEAPON_LEVEL_MAX, WEAPON_UNLOCKS, weaponLevelOf, weaponLocked, weaponsOpenedAt } from '@/progression/unlocks';
import { WEAPONS } from '@/weapons/weaponData';
import { MatchRoom } from '../server/matchRoom';

type SpawnEvent = { k: string; kit?: { primary: string[]; pistol: string } };

describe('weapon unlocks and levels (progression step 3)', () => {
  it('five weapons open at their levels, the rest from the start', () => {
    expect(Object.keys(WEAPON_UNLOCKS).every((id) => id in WEAPONS)).toBe(true);
    expect(weaponLocked('smg3', xpForLevel(3))).toBe(true);
    expect(weaponLocked('smg3', xpForLevel(4))).toBe(false);
    expect(weaponLocked('pistol3', xpForLevel(31))).toBe(true);
    expect(weaponLocked('pistol3', 0, true)).toBe(false);
    expect(weaponLocked('ar1', 0)).toBe(false);
    expect(weaponsOpenedAt(22)).toEqual(['sr2']);
  });

  it('weapon levels run 1-20 at 10,000 XP each', () => {
    expect(weaponLevelOf(0)).toEqual({ level: 1, into: 0, need: 10_000 });
    expect(weaponLevelOf(25_000)).toEqual({ level: 3, into: 5_000, need: 10_000 });
    expect(weaponLevelOf(10_000_000).level).toBe(WEAPON_LEVEL_MAX);
  });

  it('a locked weapon in a kit gives way to the class default', () => {
    const locked = (id: string) => weaponLocked(id, 0);
    const kit = sanitizeLoadout({ cls: 'medic', primary: ['smg3', 'ar4'], pistol: 'pistol3' }, locked);
    expect(kit.primary).toEqual(['smg2', 'ar4']);
    expect(kit.pistol).toBe('pistol1');
    // Open: kept.
    expect(sanitizeLoadout({ cls: 'medic', primary: ['smg3', 'ar4'], pistol: 'pistol3' }).primary[0]).toBe('smg3');
  });

  it('the tracker tells weapon levels as kills raise them, from the match start', () => {
    const tr = new ProgressTracker({ kind: 'multi', map: 'persia', mode: 'zone', difficulty: null, startXp: 0, weaponXp: { ar1: 9_000 } });
    const ups: [string, number][] = [];
    tr.onWeaponLevel = (l) => ups.push([l.weapon, l.level]);
    tr.kill('ar1', false, false); // +1,000 -> 10,000: level 2
    tr.kill('ar1', true, false); // +1,250
    tr.kill('smg2', false, false);
    expect(ups).toEqual([['ar1', 2]]);
    expect(tr.weaponXp('ar1')).toBe(11_250);
  });

  it('rooms keep "all unlocked" (off by default)', () => {
    const base: RoomSettings = { name: 'r', map: 'persia', mode: 'zone', size: 8, lineup: 'users', difficulty: 'normal', input: 'all', botShare: true, teamPick: 'random', chat: true, simple: false };
    expect(cleanSettings(base)?.allUnlocked).toBe(false);
    expect(cleanSettings({ ...base, allUnlocked: true })?.allUnlocked).toBe(true);
    expect(cleanSettings({ ...base, allUnlocked: 'yes' })).toBeNull();
  });

  it('the server swaps a signed-in player\'s locked guns, unless the room opens them all', async () => {
    for (const allUnlocked of [false, true]) {
      const room = await MatchRoom.create({ room: `r-unlock-${allUnlocked}`, map: 'persia', mode: 'zone', lineup: 'users', size: 4, allUnlocked });
      try {
        const conn = {
          text: () => {},
          binary: () => {},
        };
        room.join({ uid: 'a', name: 'a', xp: 0 }, conn);
        room.join({ uid: 'g', name: 'g' }, conn);
        room.tick();
        room.ready('a');
        room.ready('g');
        const seats = (room as unknown as { seats: Map<string, { events: SpawnEvent[] }> }).seats;
        const kitOf = (uid: string) => {
          room.deploy(uid, 'base', { cls: 'medic', primary: ['smg3', 'ar4'], pistol: 'pistol3' });
          return seats.get(uid)!.events.find((e) => e.k === 'spawn')?.kit;
        };
        const a = kitOf('a');
        // Guests have no level on the server: not checked.
        const g = kitOf('g');
        expect(g?.primary[0]).toBe('smg3');
        if (allUnlocked) expect(a).toMatchObject({ primary: ['smg3', 'ar4'], pistol: 'pistol3' });
        else expect(a).toMatchObject({ primary: ['smg2', 'ar4'], pistol: 'pistol1' });
      } finally {
        room.dispose();
      }
    }
  });
});
