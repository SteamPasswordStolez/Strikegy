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
});
