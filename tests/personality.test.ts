import { describe, expect, it } from 'vitest';
import { BOT_WEAPONS, botClass, rollPersonality, weaponFor } from '@/ai/personality';
import { CLASSES, CLASS_IDS } from '@/data/classes';
import { chooseAction, type BrainInput } from '@/ai/brain';
import { WEAPONS } from '@/weapons/weaponData';

describe('bot personalities', () => {
  it('gives each class weapons it may carry, and every squad of four one of each role', () => {
    for (const cls of CLASS_IDS) {
      for (let i = 0; i < 100; i++) {
        const p = rollPersonality(Math.random, cls);
        expect(p.lane).toBeGreaterThanOrEqual(-1);
        expect(p.lane).toBeLessThanOrEqual(1);
        expect(CLASSES[cls].primaries).toContain(WEAPONS[weaponFor(cls, p)].class);
      }
    }
    expect(rollPersonality(Math.random, 'recon').archetype).toBe('marksman');
    for (let start = 0; start < 16; start += 4) {
      const squad = [0, 1, 2, 3].map((k) => botClass(start + k));
      expect(squad).toContain('medic');
      expect(squad).toContain('support');
    }
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
