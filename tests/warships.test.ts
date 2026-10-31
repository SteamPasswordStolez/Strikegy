import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createInputState } from '@/input/InputState';
import { decodeSnapshot, encodeInputFrame, encodeInputs, encodeVehicles, packInput, snapshotFor, type NetVehicle } from '@/net/matchProtocol';
import { HitboxRegistry } from '@/combat/Hitboxes';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { SHIP, SPOT, ShipState, TELEGRAPH, ballisticPitch, layGun, seaDamagePoints, seaRp, shipVisible, spotShips, stationNear } from '@/vehicles/ship';
import { Vehicle } from '@/vehicles/Vehicle';
import { VehicleWorld } from '@/vehicles/VehicleWorld';
import { VEHICLES, type StationKind, type VehicleKind } from '@/vehicles/vehicleData';
import { MatchRoom } from '../server/matchRoom';

const DT = 1 / 60;
const WARSHIPS: VehicleKind[] = ['dd', 'cv', 'bb', 'ss'];
const none = () => false;

describe('warship rules (ShipState)', () => {
  it('W / S step the telegraph once per press, between full astern and full ahead', () => {
    const s = new ShipState(VEHICLES.dd);
    expect(TELEGRAPH[s.telegraph]).toBe(0);
    s.helm(1, false);
    s.helm(1, false); // held: one step
    expect(TELEGRAPH[s.telegraph]).toBeCloseTo(1 / 3);
    for (let i = 0; i < 6; i++) {
      s.helm(1, false);
      s.helm(0, false);
    }
    expect(s.throttle).toBe(1);
    for (let i = 0; i < 9; i++) {
      s.helm(-1, false);
      s.helm(0, false);
    }
    expect(s.throttle).toBe(-1);
    // The helm byte (sent in the driver's drive frame) carries telegraph and depth.
    const t = new ShipState(VEHICLES.ss);
    t.setHelmByte(s.helmByte);
    expect(t.telegraph).toBe(s.telegraph);
  });

  it('a submarine steps its depth on the brake key, uses air dived and comes up without it', () => {
    const s = new ShipState(VEHICLES.ss);
    const sub = VEHICLES.ss.ship!.sub!;
    s.helm(0, true);
    s.helm(0, true);
    s.helm(0, false);
    s.helm(0, true);
    expect(s.depthStep).toBe(2);
    for (let i = 0; i < 30 * 60; i++) s.step(DT, none);
    expect(s.depth).toBeCloseTo(sub.depths[2]!, 1);
    expect(s.dived).toBe(true);
    expect(s.topSpeed(none)).toBe(sub.divedTop);
    // Out of air: back up to the surface.
    for (let i = 0; i < sub.oxygen * 60; i++) s.step(DT, none);
    expect(s.depthStep).toBe(0);
    for (let i = 0; i < 20 * 60; i++) s.step(DT, none);
    expect(s.dived).toBe(false);
    expect(s.oxygen).toBeGreaterThan(0);
  });

  it('fires burn the hull until damage control puts them out; unmanned damage control lets flooding spread', () => {
    const s = new ShipState(VEHICLES.cv);
    s.ignite();
    s.ignite();
    s.flooding = 0.2;
    let burnt = 0;
    for (let i = 0; i < 60 * 60; i++) burnt += s.step(DT, none);
    expect(s.fires.length).toBe(2);
    expect(burnt).toBeCloseTo(2 * SHIP.fire.dps * 60, 3);
    expect(s.flooding).toBeGreaterThan(0.2);
    const dc = (k: StationKind) => k === 'dc';
    s.broken.set(2, 0);
    for (let i = 0; i < 40 * 60; i++) s.step(DT, dc);
    expect(s.fires.length).toBe(0);
    expect(s.flooding).toBe(0);
    expect(s.broken.size).toBe(0);
    // A destroyer has no damage control station: its fires burn out by themselves.
    const d = new ShipState(VEHICLES.dd);
    d.ignite();
    for (let i = 0; i < (SHIP.fire.burnOut + 1) * 60; i++) d.step(DT, none);
    expect(d.fires.length).toBe(0);
  });

  it('the engine room: 75 % top speed unmanned, overdrive when manned, then a cooldown', () => {
    const s = new ShipState(VEHICLES.bb);
    const eng = (k: StationKind) => k === 'engine';
    expect(s.topSpeed(none)).toBeCloseTo(VEHICLES.bb.top * SHIP.engine.unmanned);
    expect(s.topSpeed(eng)).toBe(VEHICLES.bb.top);
    expect(s.overdrive(() => 1)).toBe(true);
    expect(s.topSpeed(eng)).toBeCloseTo(VEHICLES.bb.top * (1 + SHIP.engine.overdrive));
    expect(s.overdrive(() => 1)).toBe(false);
    for (let i = 0; i < (SHIP.engine.overdriveTime + 1) * 60; i++) s.step(DT, eng);
    expect(s.topSpeed(eng)).toBe(VEHICLES.bb.top);
  });

  it('the helm works unmanned guns, never the AA; battleship guns need fire control; not a broken one', () => {
    const bb = VEHICLES.bb;
    const s = new ShipState(bb);
    const main = bb.seats.findIndex((x) => x.station?.kind === 'main');
    const aa = bb.seats.findIndex((x) => x.station?.kind === 'aa');
    expect(s.helmMay(main, none, none)).toBe(false);
    const fire = (k: StationKind) => k === 'fire';
    expect(s.helmMay(main, none, fire)).toBe(true);
    expect(s.helmMay(main, (i) => i === main, fire)).toBe(false);
    expect(s.helmMay(aa, none, fire)).toBe(false);
    s.broken.set(main, 0);
    expect(s.helmMay(main, none, fire)).toBe(false);
    const dd = new ShipState(VEHICLES.dd);
    const torp = VEHICLES.dd.seats.findIndex((x) => x.station?.kind === 'torpedo');
    expect(dd.helmMay(torp, none, none)).toBe(true);
    // A dived submarine's deck gun is under water.
    const ss = new ShipState(VEHICLES.ss);
    const gun = VEHICLES.ss.seats.findIndex((x) => x.station?.kind === 'deckgun');
    expect(ss.helmMay(gun, none, none)).toBe(true);
    ss.depth = 9;
    expect(ss.helmMay(gun, none, none)).toBe(false);
  });

  it('the server word on a ship: what it sends is what a browser takes', () => {
    const s = new ShipState(VEHICLES.bb);
    s.set(4);
    s.ignite();
    s.flooding = 0.4;
    s.broken.set(3, 0);
    s.sinking = 2;
    const n = s.net();
    const c = new ShipState(VEHICLES.bb);
    c.take(n, false);
    expect(c.telegraph).toBe(4);
    expect(c.fires.length).toBe(1);
    expect(c.flooding).toBeCloseTo(0.4);
    expect([...c.broken.keys()]).toEqual([3]);
    expect(c.sinking).toBe(2);
    // The driver's own browser keeps its own telegraph.
    const own = new ShipState(VEHICLES.bb);
    own.set(2);
    own.take(n, true);
    expect(own.telegraph).toBe(2);
  });
});

describe('naval gunnery', () => {
  it('ballisticPitch puts a shell on the target (low arc), 45 degrees out of reach', () => {
    const from = new THREE.Vector3(0, 12, 0);
    for (const [d, h, v] of [
      [800, -12, 520],
      [3000, -12, 600],
      [5500, -10, 600],
      [400, 30, 480],
    ] as const) {
      const to = new THREE.Vector3(d * 0.6, from.y + h, -d * 0.8);
      const pitch = ballisticPitch(from, to, v, 9.8);
      // Fly it.
      const p = from.clone();
      const horiz = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
      const vel = horiz.multiplyScalar(v * Math.cos(pitch)).setY(v * Math.sin(pitch));
      let best = Infinity;
      for (let i = 0; i < 60 * 60; i++) {
        vel.y -= 9.8 * DT;
        p.addScaledVector(vel, DT);
        best = Math.min(best, p.distanceTo(to));
        if (p.y < to.y - 50) break;
      }
      expect(best).toBeLessThan(v * DT * 1.5);
    }
    expect(ballisticPitch(from, new THREE.Vector3(0, 0, -50000), 600, 9.8)).toBeCloseTo(Math.PI / 4);
  });

  it('layGun turns a destroyer gun onto a point on the sea at its turn rate and says when it is laid', async () => {
    const physics = await PhysicsWorld.create();
    const v = new Vehicle(1, 'dd', physics, new THREE.Vector3(0, 0, 0), 0, null);
    const seat = 1;
    const target = new THREE.Vector3(600, 0, -1500);
    let laid = false;
    let n = 0;
    while (!laid && n++ < 60 * 20) laid = layGun(v, seat, target, DT).laid;
    expect(laid).toBe(true);
    // At 0.4 rad/s the gun needed most of a second per 0.4 rad of bearing.
    const bearing = Math.abs(Math.atan2(-target.x, -target.z));
    expect(n * DT).toBeGreaterThan(bearing / 0.4 - 0.1);
    const aim = v.mountAim(seat)!;
    expect(aim.yaw).toBeCloseTo(Math.atan2(-target.x, -target.z), 1);
    expect(aim.pitch).toBeGreaterThan(0);
    physics.dispose();
  });
});

describe('warships afloat', () => {
  it('a destroyer and a submarine reach their top speeds and turn in about the plan circles', async () => {
    for (const [kind, circle] of [
      ['dd', 600],
      ['ss', 500],
    ] as const) {
      const physics = await PhysicsWorld.create();
      physics.timestep = DT;
      physics.addStaticBox({ x: 0, y: -80, z: 0 }, { x: 8000, y: 1, z: 8000 });
      const v = new Vehicle(1, kind, physics, new THREE.Vector3(0, 0, 0), 0, null);
      v.water = () => 0;
      const input = { throttle: 0, steer: 0, brake: false };
      const run = (n: number) => {
        for (let i = 0; i < n; i++) {
          v.drive(DT, input);
          v.stepShip(DT);
          physics.step();
          v.afterStep();
        }
      };
      // Floating at its draft.
      run(120);
      expect(v.pos.y - v.spec.half[1]).toBeCloseTo(-v.spec.boat!.draft, 0);
      for (let k = 0; k < 3; k++) {
        input.throttle = 1;
        run(2);
        input.throttle = 0;
        run(2);
      }
      run(60 * 80);
      expect(v.forwardSpeed()).toBeGreaterThan(v.spec.top * 0.95);
      expect(v.forwardSpeed()).toBeLessThan(v.spec.top * 1.05);
      input.steer = 1;
      run(60 * 30);
      const y0 = v.yaw;
      run(60 * 10);
      const rate = Math.abs(Math.atan2(Math.sin(v.yaw - y0), Math.cos(v.yaw - y0))) / 10;
      const diameter = (2 * v.velocity.length()) / rate;
      expect(diameter).toBeGreaterThan(circle * 0.85);
      expect(diameter).toBeLessThan(circle * 1.15);
      physics.dispose();
    }
  }, 60000);
});

describe('stations', () => {
  it('every station stands on open deck: on the hull, clear of the deckhouses and gun mounts', () => {
    for (const k of WARSHIPS) {
      const s = VEHICLES[k];
      for (const seat of s.seats) {
        const [x, y, z] = seat.station!.at;
        expect(y).toBeCloseTo(s.half[1]);
        expect(Math.abs(x)).toBeLessThan(s.half[0] - 0.5);
        expect(Math.abs(z)).toBeLessThan(s.half[2] - 0.5);
        for (const p of s.deck!.parts) {
          const inside = Math.abs(x - p.pos[0]) < p.half[0] + 0.45 && Math.abs(z - p.pos[2]) < p.half[2] + 0.45 && p.pos[1] - p.half[1] < y + 1.8;
          expect(inside, `${k} ${seat.station!.kind} at ${seat.station!.at} inside a part at ${p.pos}`).toBe(false);
        }
      }
    }
  });

  it('E on deck mans the station one stands at (only that one), free ones only', async () => {
    const physics = await PhysicsWorld.create();
    const vw = new VehicleWorld(physics, new HitboxRegistry(), { destroyed: () => {}, roadkill: () => {} }, [], [], 0, [], false, false);
    const v = vw.spawn('bb', new THREE.Vector3(0, 0, 0), 0.4, 'blue');
    const at = (kind: StationKind) => {
      const i = v.spec.seats.findIndex((s) => s.station?.kind === kind);
      const a = v.spec.seats[i]!.station!.at;
      return { i, p: v.toWorld(new THREE.Vector3(a[0] + 0.6, a[1], a[2] + 0.4), new THREE.Vector3()) };
    };
    const fire = at('fire');
    expect(vw.enterAt(fire.p, () => true)).toEqual({ v, seat: fire.i, bump: null });
    expect(stationNear(v.spec, (q) => v.toLocal(q), fire.p, () => true)).toBe(fire.i);
    // Taken: nothing for E there (not the next free seat elsewhere on the ship).
    v.seats[fire.i] = { id: 7, team: 'blue' };
    expect(vw.enterAt(fire.p, () => true)).toBeNull();
    // Unless it is a bot's and people come first: then it is that one, with the bot to get out.
    expect(vw.enterAt(fire.p, () => true, (id) => id === 7)).toEqual({ v, seat: fire.i, bump: 7 });
    // Mid-deck, away from every station: nothing.
    const mid = v.toWorld(new THREE.Vector3(0, v.spec.half[1], 0), new THREE.Vector3());
    expect(vw.enterAt(mid, () => true)).toBeNull();
    // Getting out puts one back on the station's spot on deck.
    const exit = v.exitSpot(fire.i, physics);
    expect(v.toLocal(exit.clone()).distanceTo(new THREE.Vector3(...v.spec.seats[fire.i]!.station!.at))).toBeLessThan(0.2);
    physics.dispose();
  });
});

describe('RP at sea', () => {
  it('points for the health taken off an enemy vessel (fires credit the one who started them), none off one\'s own', async () => {
    const physics = await PhysicsWorld.create();
    const got = new Map<number, number>();
    const vw = new VehicleWorld(
      physics,
      new HitboxRegistry(),
      { destroyed: () => {}, roadkill: () => {}, damage: (v, by, taken) => got.set(by.id, (got.get(by.id) ?? 0) + seaDamagePoints(v, by, taken)) },
      [],
      [],
      0,
      [],
      false,
      false,
    );
    const dd = vw.spawn('dd', new THREE.Vector3(0, 0, 0), 0, 'blue');
    const red = { pos: new THREE.Vector3(), name: 'r', team: 'red' as const, weapon: 'naval5in', id: 9 };
    const blue = { ...red, team: 'blue' as const, id: 4 };
    dd.applyDamage(1400, 'body', red, 'explosive');
    const first = got.get(9)!;
    expect(first).toBeCloseTo(VEHICLES.dd.health - dd.health);
    dd.applyDamage(1400, 'body', blue, 'explosive');
    expect(got.get(4)).toBe(0);
    // A fire burning on: whoever last hurt it (blue here, so nothing); then red again.
    dd.lastHurtBy = red;
    dd.ship!.fires.push(0);
    const before = dd.health;
    dd.stepShip(1);
    expect(got.get(9)! - first).toBeCloseTo(before - dd.health);
    // Only what was really left counts.
    const sofar = got.get(9)!;
    dd.health = 500;
    dd.applyDamage(20000, 'body', red, 'explosive');
    expect(got.get(9)! - sofar).toBeCloseTo(500);
    // Only maps with warships play it this way.
    expect(seaRp(['dd', 'jeep'])).toBe(true);
    expect(seaRp(['lcvp', 'boat', 'jeep'])).toBe(false);
    physics.dispose();
  });
});

describe('finding submarines', () => {
  it('a dived submarine is hidden until a sonar or a destroyer close by finds it', async () => {
    const physics = await PhysicsWorld.create();
    const dd = new Vehicle(1, 'dd', physics, new THREE.Vector3(0, 0, 0), 0, 'blue');
    const ss = new Vehicle(2, 'ss', physics, new THREE.Vector3(0, 0, -1000), 0, 'red');
    const all = [dd, ss];
    expect(shipVisible(ss, 'blue', 0)).toBe(true);
    ss.ship!.depth = 9;
    expect(shipVisible(ss, 'blue', 0)).toBe(false);
    spotShips(all, 0);
    expect(shipVisible(ss, 'blue', 0)).toBe(false);
    // Someone at the destroyer's depth charges (and its sonar): found, for a while.
    dd.seats[dd.spec.seats.findIndex((s) => s.station?.kind === 'asw')] = { id: 3, team: 'blue' };
    spotShips(all, 1);
    expect(shipVisible(ss, 'blue', 1)).toBe(true);
    expect(shipVisible(ss, 'blue', 1 + SPOT.hold + 0.1)).toBe(false);
    physics.dispose();
  });
});

describe('warships on the wire', () => {
  it('ship bytes round-trip in the vehicles of a snapshot', () => {
    const list: NetVehicle[] = [
      {
        id: 7,
        kind: 'bb',
        flags: 0,
        x: 120.5,
        y: -1.2,
        z: -340.25,
        qx: 0,
        qy: 0.38,
        qz: 0,
        qw: 0.925,
        health: 0.62,
        driverOnly: -1,
        seats: VEHICLES.bb.seats.map((_, i) => ({ id: i === 0 ? 1000 : -1, yaw: 0.5, pitch: 0.1, shots: 3 })),
        ship: { helm: 4 * 4 + 0, depth: 0, flooding: 0.5, fires: 3, broken: 0b1010, sinking: 4.25, oxygen: 0, overdrive: true },
      },
      {
        id: 8,
        kind: 'ss',
        flags: 0,
        x: -10,
        y: -9,
        z: 10,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        health: 1,
        driverOnly: -1,
        seats: VEHICLES.ss.seats.map(() => ({ id: -1, yaw: 0, pitch: 0, shots: 0 })),
        ship: { helm: 2 * 4 + 1, depth: 9.25, flooding: 0, fires: 0, broken: 0, sinking: -1, oxygen: 87, overdrive: false },
      },
    ];
    const snap = decodeSnapshot(snapshotFor(99, null, new Uint8Array([0, 0]), undefined, encodeVehicles(list)))!;
    expect(snap.vehicles).toHaveLength(2);
    const [b, s] = snap.vehicles;
    expect(b!.ship).toMatchObject({ helm: 16, fires: 3, broken: 0b1010, sinking: 4.25, overdrive: true });
    expect(b!.ship!.flooding).toBeCloseTo(0.5, 2);
    expect(b!.seats[0]!.id).toBe(1000);
    expect(s!.ship).toMatchObject({ helm: 9, depth: 9.25, sinking: -1, oxygen: 87, overdrive: false });
  });

  it('people first: E at a station a bot holds takes it over, the bot finds another', async () => {
    const room = await MatchRoom.create({ room: 'n2', map: 'naval_test', mode: 'zone', lineup: 'usersBots', size: 16, botShare: false });
    const sim = room.sim;
    room.join({ uid: 'ua', name: 'alpha' }, { text: () => {}, binary: () => {} });
    room.ready('ua');
    room.tick();
    const dd = sim.vehicles!.world.vehicles.find((v) => v.kind === 'dd' && v.home === 'blue')!;
    // A blue bot at the helm.
    const bot = sim.bots!.bots.find((b) => b.team === 'blue' && !b.benched && !b.riding)!;
    if (dd.seats[0]) sim.bots!.yieldSeat(dd.seats[0].id);
    sim.bots!.seatBot(bot, dd, 0);
    expect(dd.seats[0]?.id).toBe(bot.id);
    room.deploy('ua', `ship:${dd.id}`, { cls: 'assault' });
    room.tick();
    const s = sim.soldiers.get(1000)!;
    const at = dd.spec.seats[0]!.station!.at;
    s.player.teleport(dd.toWorld(new THREE.Vector3(at[0] + 0.5, at[1] + 0.05, at[2]), new THREE.Vector3()), 0);
    for (let i = 0; i < 5; i++) room.tick();
    expect(dd.seats[0]?.id).toBe(bot.id);
    const e = createInputState();
    e.interactPressed = true;
    room.binary('ua', encodeInputs([packInput(e, 1, sim.tick, 0, 0, 0, 0)]));
    room.tick();
    expect(s.ride?.v).toBe(dd);
    expect(s.ride?.seat).toBe(0);
    expect(dd.seats[0]?.id).toBe(1000);
    expect(bot.riding?.seat ?? -1).not.toBe(0);
    room.dispose();
  }, 60000);

  it('a person deploys aboard, walks up to the helm, mans it and steers from their browser', async () => {
    const room = await MatchRoom.create({ room: 'n1', map: 'naval_test', mode: 'zone' });
    const sim = room.sim;
    const texts: unknown[] = [];
    const snaps: ReturnType<typeof decodeSnapshot>[] = [];
    room.join({ uid: 'ua', name: 'alpha' }, { text: (m) => texts.push(m), binary: (d) => snaps.push(decodeSnapshot(d)) });
    room.ready('ua');
    room.tick();
    const dd = sim.vehicles!.world.vehicles.find((v) => v.kind === 'dd' && v.home === 'blue')!;
    expect(dd).toBeTruthy();
    room.deploy('ua', `ship:${dd.id}`, { cls: 'assault' });
    room.tick();
    const s = sim.soldiers.get(1000)!;
    expect(s.alive).toBe(true);
    // On its deck.
    const local = dd.toLocal(s.player.feet.clone());
    expect(Math.abs(local.y - dd.spec.half[1])).toBeLessThan(0.6);
    // To the helm, E.
    const at = dd.spec.seats[0]!.station!.at;
    s.player.teleport(dd.toWorld(new THREE.Vector3(at[0] + 0.5, at[1] + 0.05, at[2]), new THREE.Vector3()), 0);
    for (let i = 0; i < 10; i++) room.tick();
    let seq = 0;
    const e = createInputState();
    e.interactPressed = true;
    room.binary('ua', encodeInputs([packInput(e, ++seq, sim.tick, 0, 0, 0, 0)]));
    room.tick();
    expect(s.ride?.v).toBe(dd);
    expect(s.ride?.seat).toBe(0);
    expect(dd.remote).toBe(true);
    // The browser drives: its helm byte (full ahead) comes with the ship's place.
    const idle = createInputState();
    const q = dd.quat;
    room.binary('ua', encodeInputFrame([packInput(idle, seq + 1, sim.tick, 0, 0, 0, 0)], { vehicle: dd.id & 0xffff, x: dd.pos.x, y: dd.pos.y, z: dd.pos.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, vx: 0, vy: 0, vz: 0, throttle: (4 * 4) / 255 }));
    room.tick();
    expect(dd.ship!.telegraph).toBe(4);
    room.tick();
    const nv = snaps.at(-1)!.vehicles.find((v) => v.id === (dd.id & 0xffff))!;
    expect(nv.ship!.helm >> 2).toBe(4);
    expect(nv.seats[0]!.id).toBe(1000);
  }, 60000);

  it('deploying aboard a submarine seats one at a station (a bot gives its up), and the seat key moves between them', async () => {
    const room = await MatchRoom.create({ room: 'n3', map: 'naval_test', mode: 'zone', lineup: 'usersBots', size: 16, botShare: false });
    const sim = room.sim;
    room.join({ uid: 'ua', name: 'alpha' }, { text: () => {}, binary: () => {} });
    room.ready('ua');
    room.tick();
    const ss = sim.vehicles!.world.vehicles.find((v) => v.kind === 'ss' && v.home === 'blue')!;
    expect(ss).toBeTruthy();
    // Every station held by bots: one gives way.
    for (let i = 0; i < ss.seats.length; i++) {
      if (ss.seats[i]) continue;
      const bot = sim.bots!.bots.find((b) => b.team === 'blue' && !b.benched && !b.riding);
      if (bot) sim.bots!.seatBot(bot, ss, i);
    }
    room.deploy('ua', `ship:${ss.id}`, { cls: 'assault' });
    room.tick();
    const s = sim.soldiers.get(1000)!;
    expect(s.ride?.v).toBe(ss);
    const first = s.ride!.seat;
    expect(ss.seats[first]?.id).toBe(1000);
    // A free station, then the seat key (the wheel / touch seat button) moves there.
    const other = ss.seats.findIndex((o, i) => i !== first && !!o);
    expect(sim.bots!.yieldSeat(ss.seats[other]!.id)).toBe(true);
    const e = createInputState();
    e.weaponCycle = 1;
    room.binary('ua', encodeInputs([packInput(e, 1, sim.tick, 0, 0, 0, 0)]));
    room.tick();
    expect(s.ride?.v).toBe(ss);
    expect(s.ride?.seat).not.toBe(first);
    room.dispose();
  }, 60000);
});
