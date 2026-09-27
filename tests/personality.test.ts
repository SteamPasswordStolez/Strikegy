import { describe, expect, it } from 'vitest';
import { BOT_WEAPONS, rollPersonality, weaponFor, type Archetype } from '@/ai/personality';
import { chooseAction, type BrainInput } from '@/ai/brain';
import { WEAPONS } from '@/weapons/weaponData';

describe('bot personalities', () => {
  it('rolls a mix of styles with weapons that suit them', () => {
    const seen = new Map<Archetype, Set<string>>();
    for (let i = 0; i < 400; i++) {
      const p = rollPersonality();
      expect(p.lane).toBeGreaterThanOrEqual(-1);
      expect(p.lane).toBeLessThanOrEqual(1);
      const cls = WEAPONS[weaponFor(p)].class;
      if (!seen.has(p.archetype)) seen.set(p.archetype, new Set());
      seen.get(p.archetype)!.add(cls);
    }
    expect([...seen.keys()].sort()).toEqual(['anchor', 'marksman', 'rifleman', 'rusher']);
    expect([...seen.get('marksman')!]).toEqual(['dmr']);
    expect(seen.get('rusher')!.has('dmr')).toBe(false);
    for (const id of BOT_WEAPONS) expect(WEAPONS[id]).toBeDefined();
  });

  it('careful bots take cover when a fight starts, aggressive ones chase', () => {
    const fight: BrainInput = {
      health: 1,
      hasTarget: true,
      lastSeenAge: 0,
      heardAge: Infinity,
      ammo: 1,
      reloading: false,
      sinceHurt: Infinity,
      coverKnown: true,
      inCover: false,
    };
    expect(chooseAction({ ...fight, caution: 0.1 }, null)).toBe('engage');
    expect(chooseAction({ ...fight, caution: 0.95 }, null)).toBe('cover');
    expect(chooseAction({ ...fight, caution: 0.95, inCover: true }, null)).toBe('engage');
    const lost: BrainInput = { ...fight, hasTarget: false, lastSeenAge: 8, heardAge: 1 };
    expect(chooseAction({ ...lost, aggression: 1 }, null)).toBe('hunt');
  });

  it('holds cover when the enemy ducks away, unless eager; backs off when hurt with no cover', () => {
    const ducked: BrainInput = {
      health: 1,
      hasTarget: false,
      lastSeenAge: 1,
      heardAge: Infinity,
      ammo: 1,
      reloading: false,
      sinceHurt: Infinity,
      coverKnown: true,
      inCover: true,
    };
    expect(chooseAction({ ...ducked, caution: 0.8, aggression: 0.2 }, null)).toBe('hold');
    expect(chooseAction({ ...ducked, caution: 0.1, aggression: 1 }, null)).toBe('hunt');
    const bleeding: BrainInput = { ...ducked, hasTarget: true, lastSeenAge: 0, inCover: false, coverKnown: false, health: 0.2, sinceHurt: 0.5 };
    expect(chooseAction({ ...bleeding, caution: 0.9 }, null)).toBe('cover');
    expect(chooseAction({ ...bleeding, health: 0.9 }, null)).toBe('engage');
  });
});
