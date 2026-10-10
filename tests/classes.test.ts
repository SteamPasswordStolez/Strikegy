import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { loadCore } from '@/wasm/core';
import { HitboxRegistry } from '@/combat/Hitboxes';
import { Bot, type BotServices } from '@/ai/Bot';
import {
  CLASSES,
  DOWN,
  RECON_ZOOM,
  defaultLoadout,
  loadoutWeapons,
  moveBonus,
  primariesFor,
  sanitizeLoadout,
  weaponStats,
  zoomedFov,
  zoomedLabel,
} from '@/data/classes';
import { LoadoutStore } from '@/data/loadoutStore';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import { POINTS, ScoreTracker } from '@/modes/scoreTracker';

// Bots keep their hitboxes in the wasm core.
beforeAll(async () => {
  await loadCore(fs.readFileSync('src/wasm/core.wasm'));
});

describe('classes and loadouts', () => {
  it('limits primaries to the class and keeps the two slots different', () => {
    expect(new Set(primariesFor('support').map((id) => WEAPONS[id].class))).toEqual(new Set(['ar', 'lmg']));
    expect(new Set(primariesFor('recon').map((id) => WEAPONS[id].class))).toEqual(new Set(['dmr', 'sr']));
    expect(primariesFor('medic').some((id) => WEAPONS[id].class === 'lmg')).toBe(false);
    // A support can't carry a shotgun; two copies of one gun become two guns.
    const fixed = sanitizeLoadout({ cls: 'support', primary: ['sg1', 'sg1'] as [WeaponId, WeaponId], pistol: 'ar1', grenade: 'frag', reconGadget: 'beacon' });
    expect(CLASSES.support.primaries).toContain(WEAPONS[fixed.primary[0]].class);
    expect(fixed.primary[0]).not.toBe(fixed.primary[1]);
    expect(WEAPONS[fixed.pistol].class).toBe('pistol');
    const same = sanitizeLoadout({ cls: 'assault', primary: ['ar1', 'ar1'] });
    expect(same.primary[0]).toBe('ar1');
    expect(same.primary[1]).not.toBe('ar1');
    expect(loadoutWeapons(defaultLoadout('recon'))).toHaveLength(3);
  });

  it('works without browser storage', () => {
    const store = new LoadoutStore();
    store.setClass('medic');
    store.update({ ...store.current, grenade: 'smoke' });
    expect(store.current.cls).toBe('medic');
    expect(store.current.grenade).toBe('smoke');
  });

  it('passives: assault always faster, support only with a machine gun, recon scopes 1.5x', () => {
    expect(moveBonus('assault', WEAPONS.sr1)).toBeGreaterThan(1);
    expect(moveBonus('support', WEAPONS.lmg1)).toBeGreaterThan(1);
    expect(moveBonus('support', WEAPONS.ar1)).toBe(1);
    expect(moveBonus('medic', WEAPONS.smg1)).toBe(1);
    // Magnification is the ratio of tan(fov/2): exactly 1.5x more.
    const k = Math.tan((WEAPONS.sr1.adsFov * Math.PI) / 360) / Math.tan((zoomedFov(WEAPONS.sr1.adsFov, RECON_ZOOM) * Math.PI) / 360);
    expect(k).toBeCloseTo(1.5, 5);
    expect(zoomedLabel('6x', RECON_ZOOM)).toBe('9x');
    expect(zoomedLabel('3x', RECON_ZOOM)).toBe('4.5x');
  });

  it('rates every weapon on 0..1 bars', () => {
    for (const w of Object.values(WEAPONS)) {
      for (const v of Object.values(weaponStats(w))) {
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(weaponStats(WEAPONS.smg1).rate).toBeGreaterThan(weaponStats(WEAPONS.lmg2).rate);
    expect(weaponStats(WEAPONS.sr2).damage).toBeGreaterThan(weaponStats(WEAPONS.ar1).damage);
  });

  it('scores revives (medics more) and resupplies', () => {
    const s = new ScoreTracker();
    s.add(1, 'A', 'blue');
    s.add(2, 'B', 'blue');
    s.revive(1, false);
    s.revive(2, true);
    s.resupply(2);
    expect(s.get(1)!.score).toBe(POINTS.revive);
    expect(s.get(2)!.score).toBe(POINTS.reviveMedic + POINTS.resupply);
  });
});

describe('down and revive', () => {
  const services = (time: { t: number }, allies: number, reviver: Bot | null = null) =>
    ({
      get time() {
        return time.t;
      },
      reviverFor: () => reviver,
      alliesNear: () => allies,
    }) as unknown as BotServices;

  async function makeBot(cls: 'assault' | 'medic' = 'assault') {
    const physics = await PhysicsWorld.create();
    const bot = new Bot('B', 'blue', WEAPONS.ar1, physics, new HitboxRegistry(), cls);
    bot.spawn(new THREE.Vector3(), 0, WEAPONS.ar1);
    return bot;
  }

  it('goes down instead of dying, ignores further hits, then bleeds out', async () => {
    const bot = await makeBot();
    expect(bot.applyDamage(150, 'body')).toBe(true);
    expect(bot.downed).toBe(true);
    expect(bot.alive).toBe(false);
    expect(bot.dead).toBe(false);
    // No finishing off.
    expect(bot.applyDamage(500, 'head')).toBe(false);
    const time = { t: 0 };
    const s = services(time, 2);
    for (let i = 0; i < 60 * (DOWN.bleedOut - 0.5); i++) {
      time.t += 1 / 60;
      bot.step(1 / 60, s);
    }
    expect(bot.downed).toBe(true);
    for (let i = 0; i < 60; i++) bot.step(1 / 60, s);
    expect(bot.dead).toBe(true);
    expect(bot.downed).toBe(false);
  });

  it('gives up early when nobody is around to help', async () => {
    const bot = await makeBot();
    bot.applyDamage(150, 'body');
    const time = { t: 0 };
    const s = services(time, 0);
    for (let i = 0; i < 60 * 5; i++) bot.step(1 / 60, s);
    expect(bot.dead).toBe(true);
  });

  it('comes back with the reviver class health and a short shield', async () => {
    const bot = await makeBot('medic');
    expect(bot.medkits).toBe(Infinity);
    bot.applyDamage(150, 'body');
    bot.revive(CLASSES.assault.reviveHealth, 0);
    expect(bot.alive).toBe(true);
    expect(bot.health.value).toBe(CLASSES.assault.reviveHealth);
    expect(bot.applyDamage(50, 'body')).toBe(false);
    expect(bot.health.value).toBe(CLASSES.assault.reviveHealth);
  });
});
