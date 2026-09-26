import { describe, expect, it } from 'vitest';
import { WeaponState } from '@/weapons/WeaponState';
import { WEAPONS, damageAtDistance } from '@/weapons/weaponData';

const DT = 1 / 60;

function run(w: WeaponState, seconds: number, trigger = true, reload = false): number {
  let shots = 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) shots += w.step(DT, { trigger, reload: reload && i === 0 }).shots;
  return shots;
}

describe('WeaponState', () => {
  it('auto fire keeps exact RPM even when the interval is not a multiple of the step', () => {
    // 780 rpm = 13 rounds/sec; 1 s at 60 Hz should give 13 shots (first one at t=0).
    const w = new WeaponState(WEAPONS.ar1);
    expect(run(w, 1)).toBe(13);
  });

  it('auto fire stops when the magazine is empty', () => {
    const w = new WeaponState(WEAPONS.ar1);
    expect(run(w, 5)).toBe(30);
    expect(w.ammo).toBe(0);
  });

  it('semi auto fires once per trigger press', () => {
    const w = new WeaponState(WEAPONS.dmr1);
    expect(run(w, 1)).toBe(1);
    w.step(DT, { trigger: false, reload: false });
    expect(run(w, 0.5)).toBe(1);
  });

  it('semi auto cannot exceed its RPM by spamming', () => {
    const w = new WeaponState(WEAPONS.dmr1); // 360 rpm -> 166 ms
    let shots = 0;
    for (let i = 0; i < 60; i++) shots += w.step(DT, { trigger: i % 2 === 0, reload: false }).shots;
    expect(shots).toBe(6);
  });

  it('burst fires the full burst from a single tap', () => {
    const w = new WeaponState(WEAPONS.ar3);
    let shots = w.step(DT, { trigger: true, reload: false }).shots;
    for (let i = 0; i < 30; i++) shots += w.step(DT, { trigger: false, reload: false }).shots;
    expect(shots).toBe(3);
    expect(w.ammo).toBe(27);
  });

  it('bolt action uses the slower of RPM and cycle time', () => {
    const w = new WeaponState(WEAPONS.sr2); // 50 rpm (1.2 s) vs 1100 ms cycle
    expect(w.shotInterval).toBeCloseTo(1.2);
    let shots = 0;
    // Spam the trigger for 1.3 s: shots at t=0 and t=1.2 only.
    for (let i = 0; i < 78; i++) shots += w.step(DT, { trigger: i % 2 === 0, reload: false }).shots;
    expect(shots).toBe(2);
  });

  it('magazine reload completes after reloadTime and moves ammo from reserve', () => {
    const w = new WeaponState(WEAPONS.ar1);
    run(w, 0.5); // fire some
    const fired = 30 - w.ammo;
    expect(w.step(DT, { trigger: false, reload: true }).reloadStarted).toBe(true);
    run(w, WEAPONS.ar1.reloadTime - 0.1, false);
    expect(w.reloading).toBe(true);
    run(w, 0.2, false);
    expect(w.reloading).toBe(false);
    expect(w.ammo).toBe(30);
    expect(w.reserve).toBe(90 - fired);
  });

  it('per-shell reload inserts one round at a time and can be interrupted', () => {
    const w = new WeaponState(WEAPONS.sg1);
    w.ammo = 5;
    w.step(DT, { trigger: false, reload: true });
    run(w, 0.46, false); // one insert (450 ms)
    expect(w.ammo).toBe(6);
    // Pressing the trigger interrupts the reload and fires.
    const res = w.step(DT, { trigger: true, reload: false });
    expect(w.reloading).toBe(false);
    expect(res.reloadFinished).toBe(true);
  });

  it('pulling the trigger on an empty mag auto-reloads', () => {
    const w = new WeaponState(WEAPONS.pistol1);
    w.ammo = 0;
    const res = w.step(DT, { trigger: true, reload: false });
    expect(res.reloadStarted).toBe(true);
  });

  it('dry fires when empty with no reserve', () => {
    const w = new WeaponState(WEAPONS.pistol1);
    w.ammo = 0;
    w.reserve = 0;
    expect(w.step(DT, { trigger: true, reload: false }).dryFire).toBe(true);
  });
});

describe('damageAtDistance', () => {
  it('is full damage up close and 60% at max range', () => {
    const w = WEAPONS.ar1;
    expect(damageAtDistance(w, 10)).toBe(w.damage);
    expect(damageAtDistance(w, w.range)).toBeCloseTo(w.damage * 0.6);
    expect(damageAtDistance(w, w.range * 3)).toBeCloseTo(w.damage * 0.6);
  });
});
