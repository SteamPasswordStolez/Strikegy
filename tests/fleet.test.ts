import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FleetRules } from '@/modes/matchRules';
import { ZoneRules } from '@/modes/zoneRules';
import { modesOf } from '@/modes/ZoneMode';
import { decodeSnapshot, encodeSoldiers, encodeVehicles, snapshotFor, xzRange, type NetSoldier } from '@/net/matchProtocol';
import { VEHICLES } from '@/vehicles/vehicleData';
import { parseMap } from '@/world/validateMap';

const ship = (team: 'blue' | 'red', health: number, max: number, afloat = true) => ({ team, health, max, afloat });

describe('fleet battle rules', () => {
  it('hides and locks the zones, counts fleet health as points', () => {
    const zones = new ZoneRules([{ id: 'A', pos: [0, 0, 0], radius: 40 }]);
    const r = new FleetRules(600);
    r.start(zones);
    expect(zones.zones[0]!.hidden).toBe(true);
    expect(zones.zones[0]!.locked).toBe(true);
    r.observeFleet([ship('blue', 100, 100), ship('blue', 50, 100), ship('red', 100, 100), ship('red', 100, 100)]);
    expect(r.points.blue).toBeCloseTo(75);
    expect(r.points.red).toBe(100);
    expect(r.ended).toBe(false);
  });

  it('a fleet gone loses at once; a ship that has sunk and been cleared away still counts as lost health', () => {
    const r = new FleetRules(600);
    r.start(new ZoneRules([]));
    r.observeFleet([ship('blue', 100, 100), ship('red', 100, 100), ship('red', 100, 100)]);
    // One red ship sinks and is cleared away: the fleet started at 200.
    r.observeFleet([ship('blue', 100, 100), ship('red', 100, 100)]);
    expect(r.points.red).toBeCloseTo(50);
    expect(r.ended).toBe(false);
    r.observeFleet([ship('blue', 80, 100), ship('red', 0, 100, false)]);
    expect(r.winner).toBe('blue');
    expect(r.reason).toBe('fleet');
  });

  it('on the clock the larger fleet health left wins; nothing is decided before it', () => {
    const r = new FleetRules(60);
    r.start(new ZoneRules([]));
    r.observeFleet([ship('blue', 60, 100), ship('red', 90, 100)]);
    for (let i = 0; i < 59; i++) r.step(1);
    expect(r.ended).toBe(false);
    r.step(1.5);
    expect(r.winner).toBe('red');
    expect(r.reason).toBe('time');
  });

  it('Coral Reach plays the fleet battle only, with every warship kind a side', () => {
    const map = parseMap(JSON.parse(readFileSync('public/maps/coral_reach.json', 'utf8')));
    expect(modesOf(map)).toEqual(['fleet']);
    for (const team of ['blue', 'red'] as const) {
      const kinds = (map.vehicles ?? []).filter((v) => v.team === team).map((v) => v.kind).sort();
      expect(kinds).toEqual(['bb', 'cv', 'dd', 'ss']);
    }
  });
});

describe('snapshot positions on a big map', () => {
  it('the range grows with the map (1 km maps unchanged), and positions round-trip within its step', () => {
    expect(xzRange(800)).toBe(1024);
    expect(xzRange(1300)).toBe(2048);
    expect(xzRange(3500)).toBe(4096);
    const range = xzRange(3500);
    const s: NetSoldier = { id: 7, flags: 0, x: 2911.37, y: 9.5, z: -2440.8, yaw: 1, pitch: 0, weapon: 'ar1', health: 100, shots: 0 };
    const veh = encodeVehicles(
      [{ id: 3, kind: 'cv', flags: 0, x: -2300.4, y: 1, z: 350.2, qx: 0, qy: 0, qz: 0, qw: 1, health: 1, driverOnly: -1, seats: VEHICLES.cv.seats.map(() => ({ id: -1, yaw: 0, pitch: 0, shots: 0 })) }],
      range,
    );
    const snap = decodeSnapshot(snapshotFor(5, null, encodeSoldiers([s], range), undefined, veh, range))!;
    const step = (2 * range) / 65535;
    expect(Math.abs(snap.soldiers[0]!.x - s.x)).toBeLessThan(step);
    expect(Math.abs(snap.soldiers[0]!.z - s.z)).toBeLessThan(step);
    expect(Math.abs(snap.vehicles[0]!.x + 2300.4)).toBeLessThan(step);
    // The usual maps keep their 3 cm steps.
    const small = decodeSnapshot(snapshotFor(5, null, encodeSoldiers([{ ...s, x: 500.01, z: -300.02 }])))!;
    expect(Math.abs(small.soldiers[0]!.x - 500.01)).toBeLessThan(0.032);
  });
});
