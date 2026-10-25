import { describe, expect, it } from 'vitest';
import { sanitizeLoadout, kitDefs } from '@/data/classes';
import { botBuild, BOT_WEAPONS } from '@/ai/personality';
import {
  ATTACH_LIMITS,
  ATTACH_SLOTS,
  attachLevel,
  attachLevels,
  attachmentsFor,
  cleanSet,
  gunKey,
  shotHeard,
  withAttachments,
  type AttachSet,
} from '@/weapons/attachments';
import { WEAPONS, damageAtDistance, type WeaponId } from '@/weapons/weaponData';
import { WeaponState } from '@/weapons/WeaponState';
import { MatchRoom } from '../server/matchRoom';

const IDS = Object.keys(WEAPONS) as WeaponId[];

/** Every build of a weapon that takes one attachment a slot (the first few options a slot, to keep it quick). */
function builds(id: WeaponId): AttachSet[] {
  const bySlot = ATTACH_SLOTS.map((s) => [undefined, ...attachmentsFor(WEAPONS[id]).filter((a) => a.slot === s).map((a) => a.id)]);
  let out: AttachSet[] = [{}];
  ATTACH_SLOTS.forEach((slot, i) => {
    const next: AttachSet[] = [];
    for (const b of out) for (const a of bySlot[i]!) next.push(a ? { ...b, [slot]: a } : b);
    out = next;
  });
  return out;
}

describe('attachments (progression step 4)', () => {
  it('never change damage, the headshot multiplier or the rate of fire, at any distance', () => {
    for (const id of IDS) {
      const base = WEAPONS[id];
      for (const set of builds(id)) {
        const d = withAttachments(base, set);
        expect(d.damage).toBe(base.damage);
        expect(d.headshotMult).toBe(base.headshotMult);
        expect(d.rpm).toBe(base.rpm);
        expect(d.pellets).toBe(base.pellets);
        expect(d.id).toBe(base.id);
        // Close range (the time to kill) is the same however the gun is built.
        expect(damageAtDistance(d, 5)).toBe(damageAtDistance(base, 5));
      }
    }
  });

  it('hold everything fitted together to the limits', () => {
    for (const id of IDS) {
      const base = WEAPONS[id];
      for (const set of builds(id)) {
        const d = withAttachments(base, set);
        const r = (a: number, b: number) => a / b;
        expect(r(d.adsTime, base.adsTime)).toBeGreaterThanOrEqual(ATTACH_LIMITS.ads[0] - 1e-9);
        expect(r(d.adsTime, base.adsTime)).toBeLessThanOrEqual(ATTACH_LIMITS.ads[1] + 1e-9);
        expect(r(d.sprintOut, base.sprintOut)).toBeGreaterThanOrEqual(ATTACH_LIMITS.sprintOut[0] - 1e-9);
        expect(r(d.sprintOut, base.sprintOut)).toBeLessThanOrEqual(ATTACH_LIMITS.sprintOut[1] + 1e-9);
        expect(r(d.recoil.up, base.recoil.up)).toBeGreaterThanOrEqual(ATTACH_LIMITS.recoil[0] - 1e-9);
        expect(r(d.recoil.side, base.recoil.side)).toBeGreaterThanOrEqual(ATTACH_LIMITS.recoil[0] - 1e-9);
        expect(r(d.spreadHip, base.spreadHip)).toBeGreaterThanOrEqual(ATTACH_LIMITS.hip[0] - 1e-9);
      }
    }
  });

  it('do what they say', () => {
    const m4 = WEAPONS.ar1;
    expect(withAttachments(m4, { mag: 'extmag' }).magSize).toBe(45);
    expect(withAttachments(WEAPONS.ar2, { mag: 'extmag' }).magSize).toBe(37);
    const sup = withAttachments(m4, { muzzle: 'suppressor' });
    expect(sup.suppressed).toBe(true);
    expect(sup.flash).toBe('none');
    expect(shotHeard(sup)).toBe(22);
    expect(shotHeard(withAttachments(m4, { muzzle: 'brake' }))).toBeCloseTo(91);
    // Suppressed: damage steps come 10 % closer, the damage itself is the same.
    expect(damageAtDistance(sup, 39)).toBeLessThan(damageAtDistance(m4, 39));
    expect(withAttachments(m4, { under: 'vgrip' }).recoil.up).toBeCloseTo(m4.recoil.up * 0.92);
    expect(withAttachments(m4, { laser: 'laser' }).spreadHip).toBeCloseTo(m4.spreadHip * 0.8);
    expect(withAttachments(m4, { laser: 'laser' }).laser).toBe('hip');
    expect(withAttachments(WEAPONS.lmg1, { under: 'bipod' }).bipod).toBe(true);
    // A 4x on a rifle makes it a scope; a red dot on a scoped rifle takes the scope off.
    const four = withAttachments(m4, { optic: 'scope4' });
    expect(four.scope).toBe('4x');
    expect(four.adsFov).toBeCloseTo(38);
    const dot = withAttachments(WEAPONS.dmr2, { optic: 'reddot' });
    expect(dot.scope).toBeUndefined();
    expect(dot.adsFov).toBe(58);
    expect(withAttachments(WEAPONS.sr1, { optic: 'scope12' }).scope).toBe('12x');
    // A fitted magazine holds more in the weapon's own state too.
    expect(new WeaponState(withAttachments(m4, { mag: 'extmag' })).ammo).toBe(45);
  });

  it('only fit where they belong', () => {
    expect(cleanSet(WEAPONS.ar1, { optic: 'scope12', muzzle: 'choke', under: 'vgrip', mag: 'brake' })).toEqual({ under: 'vgrip' });
    // The MP5SD is suppressed already: no muzzle slot.
    expect(attachmentsFor(WEAPONS.smg3).some((a) => a.slot === 'muzzle')).toBe(false);
    // A 1x sight the gun carries already isn't offered (the M4A1 has a red dot).
    expect(attachmentsFor(WEAPONS.ar1).some((a) => a.id === 'reddot')).toBe(false);
    expect(cleanSet(WEAPONS.ar1, { optic: 'reddot' })).toEqual({});
    expect(cleanSet(WEAPONS.ar1, { optic: 'holo' }, () => false)).toEqual({});
  });

  it('open at weapon levels 2-20, the suppressor late', () => {
    for (const id of IDS) {
      const levels = attachLevels(WEAPONS[id]);
      const fit = attachmentsFor(WEAPONS[id]);
      expect(levels.size).toBe(fit.length);
      for (const [, l] of levels) {
        expect(l).toBeGreaterThanOrEqual(2);
        expect(l).toBeLessThanOrEqual(20);
      }
    }
    expect(attachLevel(WEAPONS.ar1, 'suppressor')).toBe(19);
    expect(attachLevel(WEAPONS.ar1, 'vgrip')).toBe(3);
    expect(attachLevel(WEAPONS.ar1, 'scope4')).toBe(17);
    expect(attachLevel(WEAPONS.sr1, 'scope12')).toBe(20);
    expect(attachLevel(WEAPONS.ar1, 'choke')).toBe(Infinity);
  });

  it('ride in the loadout for the carried guns only, checked against what is open', () => {
    const l = sanitizeLoadout(
      { cls: 'assault', primary: ['ar1', 'smg2'], pistol: 'pistol1', attach: { ar1: { under: 'vgrip', muzzle: 'suppressor' }, sr1: { optic: 'scope12' } } as never },
      undefined,
      (w, a) => !(w === 'ar1' && a === 'suppressor'),
    );
    expect(l.attach).toEqual({ ar1: { under: 'vgrip' } });
    expect(kitDefs(l)[0]!.attach).toEqual({ under: 'vgrip' });
    expect(kitDefs(l)[1]!.attach).toBeUndefined();
  });

  it('bots fit each gun one way, from what it takes', () => {
    for (const id of BOT_WEAPONS) {
      const set = botBuild(id);
      expect(cleanSet(WEAPONS[id], set)).toEqual(set);
    }
    expect(botBuild('sr1').optic).toBe('scope12');
    expect(gunKey(withAttachments(WEAPONS.ar1, {}))).toBe('ar1');
  });

  it('the server takes off what a signed-in player has not opened, unless the room opens all', async () => {
    for (const allUnlocked of [false, true]) {
      const room = await MatchRoom.create({ room: `r-att-${allUnlocked}`, map: 'persia', mode: 'zone', lineup: 'users', size: 4, allUnlocked });
      try {
        const conn = { text: () => {}, binary: () => {} };
        // ar1 at weapon level 4 (30,000 XP): vertical grip (3) and fast magazine (4) open, the suppressor (19) not.
        room.join({ uid: 'a', name: 'a', xp: 0, weapons: { ar1: 30_000 } }, conn);
        room.tick();
        room.ready('a');
        room.deploy('a', 'base', { cls: 'assault', primary: ['ar1', 'smg2'], pistol: 'pistol1', attach: { ar1: { under: 'vgrip', mag: 'fastmag', muzzle: 'suppressor' } } });
        const seats = (room as unknown as { seats: Map<string, { events: { k: string; kit?: { attach?: unknown } }[] }> }).seats;
        const kit = seats.get('a')!.events.find((e) => e.k === 'spawn')?.kit;
        expect(kit?.attach).toEqual({ ar1: allUnlocked ? { under: 'vgrip', mag: 'fastmag', muzzle: 'suppressor' } : { under: 'vgrip', mag: 'fastmag' } });
        // The server's soldier carries the gun as fitted.
        const s = [...room.sim.soldiers.values()][0]!;
        expect(s.weapons.defOf('ar1').attach?.under).toBe('vgrip');
        expect(s.weapons.defOf('ar1').reloadTime).toBeCloseTo(WEAPONS.ar1.reloadTime * 0.85);
      } finally {
        room.dispose();
      }
    }
  });
});
