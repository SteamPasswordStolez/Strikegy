import { describe, expect, it } from 'vitest';
import { JET_KINDS, PADS, VEHICLES, VEHICLE_GUNS, engineForce, padReady, vehicleDamage, vehicleLimit, type PadState } from '@/vehicles/vehicleData';

const pad = (o: Partial<PadState> = {}): PadState => ({ kind: 'jeep', vehicle: null, leftAt: -Infinity, spawnedAt: -Infinity, ...o });

describe('vehicle pads', () => {
  it('brings one out at the start', () => {
    expect(padReady(pad(), 0, 0, 4)).toBe(true);
  });

  it('waits 10 s after the last one left, and a minute after the last appeared', () => {
    // Left at 5 s, appeared at 0 s: 10 s after leaving is 15 s, but a minute since appearing wins.
    const p = pad({ leftAt: 5, spawnedAt: 0 });
    expect(padReady(p, 14, 0, 4)).toBe(false);
    expect(padReady(p, 59, 0, 4)).toBe(false);
    expect(padReady(p, PADS.cooldown, 0, 4)).toBe(true);
    // Sat on the pad for two minutes, then left: 10 s later.
    const q = pad({ leftAt: 120, spawnedAt: 0 });
    expect(padReady(q, 125, 0, 4)).toBe(false);
    expect(padReady(q, 130, 0, 4)).toBe(true);
  });

  it('keeps to the per-side limit and never stacks on a taken pad', () => {
    expect(padReady(pad({ kind: 'apc' }), 100, 6, 6)).toBe(false);
    expect(padReady(pad({ kind: 'apc' }), 100, 5, 6)).toBe(true);
    expect(padReady(pad({ vehicle: 50001 }), 100, 0, 4)).toBe(false);
  });

  it('scales the limits with the bots: APCs per 8, tanks and jets per 16, rounded up', () => {
    expect(vehicleLimit('apc', 24)).toBe(3);
    expect(vehicleLimit('apc', 10)).toBe(2);
    expect(vehicleLimit('tank', 24)).toBe(2);
    expect(vehicleLimit('fighter', 16)).toBe(1);
    expect(vehicleLimit('cas', 150)).toBe(10);
  });
});

describe('vehicle handling and armour', () => {
  it('cuts the engine past the top speed both ways', () => {
    const s = VEHICLES.jeep;
    expect(engineForce(s, 1, 0)).toBeGreaterThan(0);
    expect(engineForce(s, 1, s.top)).toBe(0);
    expect(engineForce(s, -1, 0)).toBeLessThan(0);
    expect(engineForce(s, -1, -s.reverse)).toBe(0);
  });

  it('shrugs off bullets in the APC but not panzerfausts', () => {
    expect(vehicleDamage('apc', 30, 'bullet')).toBe(0);
    expect(vehicleDamage('jeep', 30, 'bullet')).toBeGreaterThan(0);
    // One panzerfaust direct hit (250) wrecks a jeep, takes a few for an APC.
    expect(vehicleDamage('jeep', 250, 'at')).toBeGreaterThanOrEqual(VEHICLES.jeep.health);
    const apcHits = Math.ceil(VEHICLES.apc.health / vehicleDamage('apc', 250, 'at'));
    expect(apcHits).toBeGreaterThanOrEqual(2);
    expect(apcHits).toBeLessThanOrEqual(4);
  });

  it('brings jets down fast with aircraft cannon, slowly with rifles', () => {
    expect(JET_KINDS).toEqual(['fighter', 'cas']);
    const cannon = VEHICLE_GUNS.jetcannon.vsVehicle;
    const fighterHits = Math.ceil(VEHICLES.fighter.health / vehicleDamage('fighter', cannon, 'heavy'));
    expect(fighterHits).toBeLessThanOrEqual(10);
    expect(Math.ceil(VEHICLES.cas.health / vehicleDamage('cas', cannon, 'heavy'))).toBeLessThanOrEqual(14);
    // A missile is enough for either.
    for (const k of JET_KINDS) expect(vehicleDamage(k, VEHICLE_GUNS.aam.vsVehicle, 'at')).toBeGreaterThanOrEqual(VEHICLES[k].health);
    // A rifle round (30) does far less than a cannon round.
    expect(vehicleDamage('fighter', 30, 'bullet')).toBeLessThan(vehicleDamage('fighter', cannon, 'heavy') / 2);
  });

  it('has a seat per rider: jeep 2, APC 4, bike 1', () => {
    expect(VEHICLES.jeep.seats).toHaveLength(2);
    expect(VEHICLES.apc.seats).toHaveLength(4);
    expect(VEHICLES.bike.seats).toHaveLength(1);
    for (const v of Object.values(VEHICLES)) expect(v.seats[0]!.role).toBe('driver');
  });
});
