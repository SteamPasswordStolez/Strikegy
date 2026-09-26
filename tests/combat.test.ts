import { describe, expect, it } from 'vitest';
import { recoilKick, recoilScale } from '@/weapons/recoil';
import { GRENADES, flashDuration, flashIntensity, fragDamage } from '@/combat/explosions';
import { HEALTH, Health, fallDamage } from '@/player/health';
import { WEAPONS } from '@/weapons/weaponData';
import { GRENADE_LOADOUT, GrenadeInventory } from '@/weapons/Throwables';

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
  it('takes from the selected type and skips empty types when cycling', () => {
    const inv = new GrenadeInventory();
    for (let i = 0; i < GRENADE_LOADOUT.frag; i++) expect(inv.take()).toBe('frag');
    // Frags exhausted: next take falls through to the next type with stock.
    expect(inv.take()).toBe('flash');
    inv.counts.flash = 0;
    inv.cycle();
    expect(inv.selected).toBe('smoke');
    expect(inv.take()).toBe('smoke');
    expect(inv.take()).toBeNull();
    inv.reset();
    expect(inv.counts).toEqual(GRENADE_LOADOUT);
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
