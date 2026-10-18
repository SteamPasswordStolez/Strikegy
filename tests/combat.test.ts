import { describe, expect, it } from 'vitest';
import { gunPattern, recoilKick, recoilScale } from '@/weapons/recoil';
import { Spring } from '@/weapons/spring';
import { GRENADES, flashDuration, flashIntensity, fragDamage } from '@/combat/explosions';
import { HEALTH, Health, fallDamage } from '@/player/health';
import { WEAPONS } from '@/weapons/weaponData';
import { GrenadeInventory } from '@/weapons/Throwables';
import { GRENADE_COUNT } from '@/data/classes';

describe('recoil', () => {
  const spec = { up: 0.5, side: 0.3, first: 1.4 };

  it('is deterministic for a given spray seed', () => {
    const a = [0, 1, 2, 3, 4].map((i) => recoilKick(spec, i, 0.42));
    const b = [0, 1, 2, 3, 4].map((i) => recoilKick(spec, i, 0.42));
    expect(a).toEqual(b);
  });

  it('kicks harder on the first shot and eases after the plateau', () => {
    expect(recoilKick(spec, 0, 0.1).pitch).toBeCloseTo(0.7);
    expect(recoilKick(spec, 3, 0.1).pitch).toBeCloseTo(0.5);
    expect(recoilKick(spec, 12, 0.1).pitch).toBeLessThan(0.5);
  });

  it('keeps horizontal kick bounded by the spec', () => {
    for (let i = 0; i < 40; i++) expect(Math.abs(recoilKick(spec, i, 0.77).yaw)).toBeLessThanOrEqual(spec.side * 1.2 + 1e-9);
  });

  it('pulls each gun its own way every spray (learnable: the seed only jitters)', () => {
    const akm = WEAPONS.ar2.recoil;
    const spray = (seed: number) => Array.from({ length: 25 }, (_, i) => recoilKick(akm, i, seed, gunPattern('ar2')).yaw).reduce((a, b) => a + b, 0);
    const sprays = [0.11, 0.42, 0.77, 0.93].map(spray);
    // The AKM leans right (negative yaw) whatever the seed, by about the same amount.
    for (const y of sprays) expect(y).toBeLessThan(0);
    expect(Math.max(...sprays) - Math.min(...sprays)).toBeLessThan(Math.abs(sprays[0]!) * 0.6);
    expect(gunPattern('ar1')).not.toBe(gunPattern('ar2'));
  });

  it('sights are exact: no aimed cone but the shotgun pellet cone, and every gun kicks its own way', () => {
    for (const w of Object.values(WEAPONS)) expect(w.class === 'sg' ? w.spreadAds > 0 : w.spreadAds === 0).toBe(true);
    expect(WEAPONS.sr2.kick.rise).toBeGreaterThan(WEAPONS.smg1.kick.rise * 5);
  });

  it('springs peak at the kick and settle back to rest', () => {
    const sp = new Spring(16);
    sp.kick(0.1);
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      sp.step(1 / 120);
      peak = Math.max(peak, sp.x);
    }
    expect(peak).toBeCloseTo(0.1, 2);
    expect(Math.abs(sp.x)).toBeLessThan(0.001);
    // A long frame doesn't blow it up.
    sp.kick(0.1);
    sp.step(0.5);
    expect(Math.abs(sp.x)).toBeLessThan(0.1);
  });

  it('is reduced by aiming and crouching', () => {
    expect(recoilScale({ adsBlend: 0, crouched: false })).toBe(1);
    expect(recoilScale({ adsBlend: 1, crouched: true })).toBeCloseTo(0.56);
  });
});

describe('explosions', () => {
  const frag = GRENADES.frag;

  it('frag is lethal in the core and falls off to zero at the edge', () => {
    expect(fragDamage(frag, 1, false)).toBe(frag.maxDamage);
    expect(fragDamage(frag, frag.radius, false)).toBe(0);
    const mid = fragDamage(frag, (frag.innerRadius + frag.radius) / 2, false);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(frag.maxDamage / 2);
  });

  it('cover blocks frag damage outside the core', () => {
    expect(fragDamage(frag, 4, true)).toBe(0);
    expect(fragDamage(frag, 1, true)).toBe(frag.maxDamage * 0.5);
  });

  it('flash is strongest when looking at it up close and zero when occluded', () => {
    const f = GRENADES.flash;
    const facing = flashIntensity(f, 5, 1, false);
    const away = flashIntensity(f, 5, -1, false);
    expect(facing).toBeGreaterThan(away);
    expect(flashIntensity(f, 1, -1, false)).toBeGreaterThan(0.8);
    expect(flashIntensity(f, 5, 1, true)).toBe(0);
    expect(flashDuration(0)).toBe(0);
    expect(flashDuration(1)).toBeGreaterThan(4);
  });
});

describe('health', () => {
  it('regenerates only after the delay', () => {
    const h = new Health();
    h.damage(60);
    for (let i = 0; i < 60 * (HEALTH.regenDelay - 0.5); i++) h.step(1 / 60);
    expect(h.value).toBe(40);
    for (let i = 0; i < 60 * 10; i++) h.step(1 / 60);
    expect(h.value).toBe(HEALTH.max);
  });

  it('reports the killing blow once', () => {
    const h = new Health();
    expect(h.damage(99)).toBe(false);
    expect(h.damage(5)).toBe(true);
    expect(h.damage(5)).toBe(false);
  });

  it('only long falls hurt', () => {
    expect(fallDamage(8)).toBe(0);
    expect(fallDamage(15)).toBeGreaterThan(20);
  });
});

describe('grenade inventory', () => {
  it('carries one chosen type and refills on a new life', () => {
    const inv = new GrenadeInventory();
    inv.reset('smoke');
    for (let i = 0; i < GRENADE_COUNT.smoke; i++) expect(inv.take()).toBe('smoke');
    expect(inv.take()).toBeNull();
    inv.reset('flash');
    expect(inv.selected).toBe('flash');
    expect(inv.count).toBe(GRENADE_COUNT.flash);
  });
});

describe('weapon balance', () => {
  it('assault rifle hip fire can hit a torso at 10 m', () => {
    // Torso half-width 0.25 m at 10 m ~= 1.43 degrees.
    expect(WEAPONS.ar1.spreadHip).toBeLessThanOrEqual(1.8);
  });

  it('every weapon defines bloom and first-shot recoil', () => {
    for (const w of Object.values(WEAPONS)) {
      expect(w.bloomPerShot).toBeGreaterThanOrEqual(0);
      expect(w.recoil.first).toBeGreaterThan(0);
    }
  });
});
