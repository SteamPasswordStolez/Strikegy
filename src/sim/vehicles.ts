/**
 * Vehicles in a match on the game server (and what the browser shares with
 * it): pads, bikes and tanks as in solo play, people getting in and out,
 * seat guns, bots bringing out tanks and jets, the rocket tank call-in.
 *
 * A vehicle a person drives is driven in that person's browser (no waiting
 * on the round trip to steer); the browser sends where it has it with every
 * input frame and the server puts its copy there after checking the move
 * isn't faster than the vehicle can go (`applyDrive`). Everything else (empty
 * vehicles, bot drivers, every gun) runs here.
 */
import * as THREE from 'three';
import type { Bot } from '@/ai/Bot';
import { computeDamage, type DamageSource, type Damageable, type HitboxRegistry } from '@/combat/Hitboxes';
import type { BlastKind } from '@/combat/explosions';
import type { HitPart } from '@/core/events';
import { t } from '@/i18n';
import type { InputState } from '@/input/InputState';
import type { GadgetOwner } from '@/modes/gadgetWorld';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import { DRAW_TIME } from '@/weapons/WeaponController';
import type { DriveInput, Vehicle } from '@/vehicles/Vehicle';
import { VehicleWorld, flatSpot, planVehicleSpots, type VehicleHooks, type Walker } from '@/vehicles/VehicleWorld';
import { AIRSPACE, JET_KINDS, TANK_KINDS, VEHICLE_GUNS, type VehicleGunId, type VehicleKind } from '@/vehicles/vehicleData';
import type { MapDef, Team } from '@/world/mapTypes';
import type { NetDrive } from '@/net/matchProtocol';
import type { MatchSim } from './MatchSim';
import type { Soldier } from './Soldier';

const DEG = Math.PI / 180;
const DOWN = new THREE.Vector3(0, -1, 0);
/** Bots and jets (see Game): first try, how often, how near the base the bot must be, the people's head start on a free slot. */
const BOT_JETS = { first: 12, every: 4, nearBase: 90, peopleFirst: 15 };
/** Missiles can't lock a jet this long after it came in off the edge (s). */
export const JET_LOCK_GRACE = 10;
/** Jet cannon: fires at the crosshair within `cone` of the nose, onto an enemy aircraft within `assist` of it (rad). */
export const JET_GUN = { cone: 0.21, assist: 0.031 };
/** Out of a plane higher than this over the ground (m): a parachute. */
const CHUTE_HEIGHT = 12;
/** A driver's browser may move its vehicle this much faster than it can go, plus this many metres, before the move is refused. */
const DRIVE_SLACK = { speed: 1.6, metres: 3 };

/** Where someone looking at `yaw` / `pitch` looks (unit vector). */
export function viewDir(yaw: number, pitch: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

/** An aircraft's nose: along its flight path, else along the hull. */
function noseOf(v: Vehicle): THREE.Vector3 {
  return v.velocity.lengthSq() > 1 ? v.velocity.clone().normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(v.quat);
}

/**
 * Where a pilot's cannon fires when looking along `view`: there while it is
 * within `JET_GUN.cone` of the nose (else along the nose: null), onto an
 * enemy aircraft within `JET_GUN.assist` of it.
 */
export function jetGunAim(v: Vehicle, seat: number, view: THREE.Vector3, team: Team, vehicles: Iterable<Vehicle>, planes: Iterable<{ pos: THREE.Vector3; team: Team }>): THREE.Vector3 | null {
  if (view.angleTo(noseOf(v)) > JET_GUN.cone) return null;
  const muzzle = v.muzzleOf(seat, new THREE.Vector3());
  const range = v.mounts[seat]!.gun.range;
  let best: THREE.Vector3 | null = null;
  let bestA = JET_GUN.assist;
  const consider = (p: THREE.Vector3, side: Team | null): void => {
    if (side === team) return;
    const to = p.clone().sub(muzzle);
    const d = to.length();
    if (d < 5 || d > range) return;
    const a = to.angleTo(view);
    if (a < bestA) {
      bestA = a;
      best = p;
    }
  };
  for (const o of vehicles) if (o.flight && !o.wrecked && o !== v) consider(o.pos, o.team ?? o.home);
  for (const p of planes) consider(p.pos, p.team);
  return best ? (best as THREE.Vector3).clone() : muzzle.addScaledVector(view, range);
}

/** Missile lock: the nearest enemy aircraft within 25° of the nose and in range. */
export function lockTarget(v: Vehicle, team: Team, vehicles: Iterable<Vehicle>, now: number): Vehicle | null {
  const nose = noseOf(v);
  let best: Vehicle | null = null;
  let bestD = 1500;
  for (const o of vehicles) {
    if (o === v || !o.flight || o.wrecked || o.home === team) continue;
    if (now - o.arrivedAt < JET_LOCK_GRACE) continue;
    const to = o.pos.clone().sub(v.pos);
    const d = to.length();
    if (d < bestD && to.normalize().dot(nose) > Math.cos(0.44)) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

/**
 * The vehicle world for a map (pads at both bases, motorbikes round the
 * zones, tank spots, the air space), the same on the server and in the
 * browser so ids, limits and spots agree. `size`: soldiers the room holds.
 */
export function vehicleWorldFor(physics: PhysicsWorld, registry: HitboxRegistry, hooks: VehicleHooks, map: MapDef, size: number): VehicleWorld {
  const bases: { team: Team; pos: THREE.Vector3; facing: number }[] = [];
  for (const team of ['blue', 'red'] as const) {
    const sp = map.spawns.filter((s) => s.team === team || (team === 'blue' && s.team === 'player'));
    if (!sp.length) continue;
    const pos = sp.reduce((a, s) => a.add(new THREE.Vector3(...s.pos)), new THREE.Vector3()).divideScalar(sp.length);
    bases.push({ team, pos, facing: sp[0]!.yaw * DEG });
  }
  const zones = (map.zones ?? []).map((z) => ({ id: z.id, pos: new THREE.Vector3(...z.pos), radius: z.radius }));
  const plan = planVehicleSpots(physics, bases, zones);
  const heavy = map.world.vehicles !== 'light';
  const pads = heavy ? plan.pads : plan.pads.filter((p) => p.kind === 'jeep');
  const vw = new VehicleWorld(physics, registry, hooks, pads, plan.bikes, size, heavy ? plan.tankSpots : [], heavy, map.world.vehicles !== 'noJets');
  const center = zones.length ? zones.reduce((a, z) => a.add(z.pos), new THREE.Vector3()).divideScalar(zones.length) : new THREE.Vector3();
  vw.air = { center, radius: Math.max(map.world.size[0], map.world.size[1]) / 2 };
  return vw;
}

/** Someone who fires a vehicle gun. */
interface Shooter {
  id: number;
  name: string;
  team: Team;
}

export class MatchVehicles {
  readonly world: VehicleWorld;
  /** Bot drivers' controls this step. */
  readonly driveInputs = new Map<number, DriveInput>();
  /** A person got in (`v`, `seat`) or out (`v` null; `chute`: under a parachute, else standing at their feet). */
  onSeat: (s: Soldier, v: Vehicle | null, seat: number, chute: boolean) => void = () => {};
  /** A rocket tank came for `who` (its side is told where). */
  onRocketTank: (team: Team, zone: string, who: string, id: number) => void = () => {};
  /** A vehicle gun fired a blast round or a shell went off (browsers show it). */
  onBoom: (kind: BlastKind | 'wreck', point: THREE.Vector3) => void = () => {};
  private botTankAt = 20;
  private botJetAt = BOT_JETS.first;
  private readonly jetFreeSince: Record<Team, number> = { blue: -1, red: -1 };
  /** When each person-driven vehicle was last put where its driver had it. */
  private readonly driveAt = new Map<number, number>();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(
    private readonly sim: MatchSim,
    map: MapDef,
    size: number,
  ) {
    this.world = vehicleWorldFor(sim.physics, sim.registry, { destroyed: (v, by) => this.destroyed(v, by), roadkill: (v, w) => this.roadkill(v, w) }, map, size);
    const bots = sim.bots;
    if (bots) {
      bots.vehicles = this.world;
      bots.driveInputs = this.driveInputs;
      bots.playerRiding = (id) => !!sim.soldiers.get(id)?.ride;
      bots.fireMount = (v, seat, shooter, aim, alt) => this.fireMount(v, seat, shooter, aim, alt);
    }
  }

  private get physics(): PhysicsWorld {
    return this.sim.physics;
  }

  // ---------------------------------------------------------------------------
  // Steps

  /** Start of a step: bot drivers set their controls again. */
  beginStep(): void {
    this.driveInputs.clear();
  }

  /** Before the physics step (after the bots): bots' tanks and jets, driving, pads and bikes, people run over. */
  step(dt: number): void {
    this.botTanks();
    this.botJets();
    this.world.step(dt, this.driveInputs, this.walkers());
  }

  /** After the physics step: bodies read back, riders carried along. */
  afterStep(): void {
    this.world.afterStep();
    for (const s of this.sim.soldiers.values()) {
      const r = s.ride;
      if (!r) continue;
      if (r.v.flight && r.seat === 0 && r.v.remote) r.v.flightFromQuat();
      s.player.ride(r.v.seatEye(r.seat, this.tmp), r.v.velocity);
    }
  }

  /** People on foot and bots (who vehicles can run over). */
  private *walkers(): Iterable<Walker> {
    for (const s of this.sim.soldiers.values()) if (s.deployed && s.alive && !s.ride && !s.chute) yield s.combatant;
    for (const b of this.sim.bots?.bots ?? []) if (!b.riding && !b.benched) yield b;
  }

  // ---------------------------------------------------------------------------
  // People

  /** E by a vehicle with a free seat (not one the other side crews): in, the driver's seat first. */
  tryEnter(s: Soldier): boolean {
    const v = this.world.nearest(s.player.feet);
    if (!v || (v.team && v.team !== s.team)) return false;
    const seat = v.seats.findIndex((o, i) => !o && (i > 0 || v.driverOnly === null || v.driverOnly === s.id));
    if (seat < 0) return false;
    this.seat(s, v, seat);
    return true;
  }

  /**
   * A seat someone of `team` could deploy into: tanks, jets and rocket tanks
   * of that side, not wrecked, the driver's seat first unless kept for
   * someone else. -1 when there's none.
   */
  deploySeat(v: Vehicle, team: Team, id: number): number {
    if (v.wrecked || !(TANK_KINDS.includes(v.kind) || JET_KINDS.includes(v.kind) || v.kind === 'rocket')) return -1;
    if ((v.team ?? v.home) !== team) return -1;
    return v.seats.findIndex((s, i) => !s && (i > 0 || v.driverOnly === null || v.driverOnly === id) && !this.sim.bots?.claimedSeat(v.id, i));
  }

  /** Just deployed with a vehicle key: a new tank or jet, or a free seat in one of the side's ('tank:<kind>', 'jet:<kind>', 'veh:<id>'). */
  board(s: Soldier, key: string): void {
    const [kind, ref = ''] = key.split(':');
    if (kind === 'tank' && (TANK_KINDS as readonly string[]).includes(ref)) {
      const v = this.world.spawnTank(ref as VehicleKind, s.team);
      if (v) this.seat(s, v, 0);
    } else if (kind === 'jet' && (JET_KINDS as readonly string[]).includes(ref)) {
      const v = this.spawnJet(ref as VehicleKind, s.team);
      if (v) this.seat(s, v, 0);
    } else if (kind === 'veh') {
      const v = this.world.get(Number(ref));
      const seat = v ? this.deploySeat(v, s.team, s.id) : -1;
      if (v && seat >= 0) this.seat(s, v, seat);
    }
  }

  private seat(s: Soldier, v: Vehicle, seat: number): void {
    const was = s.ride;
    if (was) {
      was.v.seats[was.seat] = null;
      if (was.seat === 0) this.letGo(was.v);
    }
    v.seats[seat] = { id: s.id, team: s.team };
    s.ride = { v, seat };
    if (seat === 0) {
      // Driven from the person's browser from now on.
      v.setRemote(true);
      this.driveAt.set(v.id, this.sim.time);
    }
    s.gadgetOut = false;
    s.buildMode = false;
    s.working = -1;
    s.reviveOf = null;
    s.reviveProgress = 0;
    s.weapons.adsBlend = 0;
    s.boxes.setEnabled(v.spec.seats[seat]!.exposed);
    s.player.ride(v.seatEye(seat, this.tmp), v.velocity);
    this.onSeat(s, v, seat, false);
  }

  /** A person-driven vehicle goes back to its own physics (or flies on by itself). */
  private letGo(v: Vehicle): void {
    v.setRemote(false);
    this.driveAt.delete(v.id);
  }

  /** Out of the vehicle: beside it, or out of a plane high up under a parachute (`bail`; not when it blew up). */
  leave(s: Soldier, bail = true): void {
    const r = s.ride;
    if (!r) return;
    const v = r.v;
    s.ride = null;
    v.seats[r.seat] = null;
    if (r.seat === 0) this.letGo(v);
    let spot = v.exitSpot(r.seat, this.physics);
    if (v.flight) {
      const down = this.physics.raycast(v.pos, DOWN, 2000, Layer.WORLD);
      if (bail && (!down || down.distance > CHUTE_HEIGHT) && s.alive && !s.downed) {
        s.openChute(v.pos.clone().setY(v.pos.y - v.spec.half[1] - 2), v.velocity);
        s.boxes.setEnabled(true);
        this.onSeat(s, null, -1, true);
        return;
      }
      spot = down ? new THREE.Vector3(down.point.x, down.point.y, down.point.z) : (this.sim.bots?.nav.closestFar(v.pos) ?? this.sim.baseCenter(s.team));
    }
    s.player.dismount(spot);
    s.boxes.setEnabled(s.alive && !s.downed);
    s.weapons.drawTimer = DRAW_TIME;
    this.onSeat(s, null, -1, false);
  }

  /**
   * A person's step in a vehicle: E gets out, 1..n / the wheel change seats,
   * the gunner's gun follows the view and fires (the driver's browser drives:
   * `applyDrive`).
   */
  stepRide(s: Soldier, input: InputState, dt: number): void {
    const r = s.ride!;
    const v = r.v;
    if (v.wrecked || input.interactPressed) {
      this.leave(s);
      return;
    }
    const free = (i: number): boolean => !v.seats[i] && (i > 0 || v.driverOnly === null || v.driverOnly === s.id);
    const want = input.weaponSlot;
    if (want >= 0 && want < v.seats.length && free(want)) this.seat(s, v, want);
    else if (input.weaponCycle !== 0) {
      const n = v.seats.length;
      const dir = Math.sign(input.weaponCycle);
      for (let k = 1; k < n; k++) {
        const i = (((r.seat + dir * k) % n) + n) % n;
        if (free(i)) {
          this.seat(s, v, i);
          break;
        }
      }
    }
    const at = s.ride!.seat;
    const spec = v.spec.seats[at]!;
    const p = s.player;
    const shooter: Shooter = { id: s.id, name: s.combatant.name, team: s.team };
    if (spec.gun) {
      v.aimMount(at, p.yaw, p.pitch);
      if (v.pullTrigger(at, input.fire, this.sim.time, dt)) {
        const view = viewDir(p.yaw, p.pitch, this.tmp2);
        if (v.flight && spec.role === 'driver') {
          v.syncModel(1);
          this.fireMount(v, at, shooter, jetGunAim(v, at, view, s.team, this.world.vehicles, this.sim.support.planes()));
        } else {
          const eye = v.seatEye(at, new THREE.Vector3());
          const range = v.mounts[at]!.gun.range;
          const look = this.physics.raycast(eye, view, range, Layer.WORLD | Layer.HITBOX, undefined, v.body);
          this.fireMount(v, at, shooter, look ? new THREE.Vector3(look.point.x, look.point.y, look.point.z) : eye.addScaledVector(view, range));
        }
      }
    }
    if (v.altMounts[at] && v.pullTrigger(at, input.ads, this.sim.time, dt, true)) this.fireMount(v, at, shooter, null, true);
    p.ride(v.seatEye(at, this.tmp), v.velocity);
  }

  /**
   * Where a person's browser has the vehicle they drive: the server's copy
   * goes there unless that is further than the vehicle could have gone
   * since the last time (false: refused). An aircraft flying into anything
   * solid on the way crashes.
   */
  applyDrive(s: Soldier, d: NetDrive): boolean {
    const r = s.ride;
    if (!r || r.seat !== 0 || (r.v.id & 0xffff) !== d.vehicle || r.v.wrecked || !r.v.remote) return true;
    const v = r.v;
    const now = this.sim.time;
    const since = Math.max(1 / 60, now - (this.driveAt.get(v.id) ?? now));
    const top = v.flight ? v.spec.flight!.maxSpeed * 1.3 : v.spec.top;
    const to = this.tmp.set(d.x, d.y, d.z);
    const dist = to.distanceTo(v.pos);
    if (dist > top * DRIVE_SLACK.speed * since + DRIVE_SLACK.metres) return false;
    // An aircraft can't hang still: one that stopped (its browser had it hit something) has crashed.
    if (v.flight && Math.hypot(d.vx, d.vy, d.vz) < v.spec.flight!.minSpeed * 0.3) {
      v.health = 0;
      v.crashed = true;
      return true;
    }
    if (dist > 0.01) {
      const dir = this.tmp2.copy(to).sub(v.pos).divideScalar(dist);
      // Aircraft: the nose reaches ahead of the middle (as `Vehicle.fly` checks).
      const reach = v.flight ? dist + v.spec.half[2] * 0.6 : dist;
      const hit = this.physics.raycast(v.pos, dir, reach, Layer.WORLD, undefined, v.body);
      // An aircraft flying into something crashes; a ground vehicle doesn't go through walls.
      if (hit && v.flight) {
        v.health = 0;
        v.crashed = true;
        return true;
      }
      if (hit) return false;
    }
    v.place(to, new THREE.Quaternion(d.qx, d.qy, d.qz, d.qw), new THREE.Vector3(d.vx, d.vy, d.vz));
    if (v.flight) v.flight.throttle = d.throttle;
    this.driveAt.set(v.id, now);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Guns

  /**
   * One round from a vehicle gun at `aimAt`: hitscan for the MGs and the
   * autocannon, a flying shell for tank guns (lobbed for the howitzer),
   * a homing missile for the fighter.
   */
  fireMount(v: Vehicle, seat: number, shooter: Shooter, aimAt: THREE.Vector3 | null, alt = false): void {
    const m = (alt ? v.altMounts : v.mounts)[seat];
    if (!m) return;
    const gun = m.gun;
    // The muzzle where the model has it now (the server draws nothing, so place it first).
    v.syncModel(1);
    const muzzle = v.muzzleOf(seat, new THREE.Vector3());
    const nose = noseOf(v);
    const aim = aimAt ?? muzzle.clone().addScaledVector(nose, gun.range);
    const owner: GadgetOwner = { ...shooter, squad: null };
    const gadgets = this.sim.gadgets;
    if (gun.homing) {
      const lock = lockTarget(v, shooter.team, this.world.vehicles, this.sim.time);
      const vel = nose.clone().multiplyScalar(gun.shell!.speed).add(v.velocity);
      gadgets.fireShell(muzzle.clone().addScaledVector(nose, 4), vel, 0, owner, m.id, lock ? () => (lock.wrecked ? null : lock.pos) : undefined, v.body);
      return;
    }
    const dir = aim.clone().sub(muzzle).normalize();
    const s = gun.spread * DEG * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir);
    dir.addScaledVector(right, Math.cos(a) * Math.tan(s)).addScaledVector(up, Math.sin(a) * Math.tan(s)).normalize();
    if (gun.shell) {
      const sh = gun.shell;
      let vel: THREE.Vector3;
      if (sh.lob) {
        // Lobbed onto the aim point: flight time grows with range.
        const d = aim.clone().sub(muzzle);
        const flat = Math.hypot(d.x, d.z);
        const time = THREE.MathUtils.clamp(2 + flat / 120, 2.5, 7);
        vel = new THREE.Vector3(d.x / time, d.y / time + 0.5 * sh.gravity * time, d.z / time);
        vel.addScaledVector(right, (Math.random() - 0.5) * flat * gun.spread * DEG);
      } else vel = dir.clone().multiplyScalar(sh.speed).add(v.flight ? v.velocity : new THREE.Vector3());
      gadgets.fireShell(muzzle.clone().addScaledVector(dir, 0.4), vel, sh.gravity, owner, m.id, undefined, v.body);
      return;
    }
    const name = t(`vehicleGun.${m.id}`);
    const hit = this.physics.raycast(muzzle, dir, gun.range, Layer.WORLD | Layer.HITBOX, undefined, v.body);
    const to = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : muzzle.clone().addScaledVector(dir, gun.range);
    const target = hit ? this.sim.registry.lookup(hit.collider.handle) : undefined;
    if (target && target.owner.alive && target.owner.team !== shooter.team) {
      const isVehicle = !!this.world.get(target.owner.id);
      const dmg = isVehicle ? gun.vsVehicle : computeDamage(gun.damage, target.part, 1.5);
      const source: DamageSource = { pos: muzzle.clone(), name: shooter.name, team: shooter.team, weapon: name, id: shooter.id };
      const killed = target.owner.applyDamage(dmg, target.part, source, gun.blast > 0 ? 'at' : 'heavy');
      this.sim.bus.emit('combat:hit', { targetId: target.owner.id, part: target.part, damage: dmg, killed, point: to, byPlayer: false, attackerId: shooter.id });
      if (killed) this.sim.reportKill(shooter, target.owner.id, target.owner.name, target.owner.team ?? null, name);
    }
    if (hit && gun.blast > 0) {
      this.sim.blast('cannon', to, shooter, name);
      this.onBoom('cannon', to);
    }
    this.sim.bots?.nearMiss(muzzle, to, shooter.team, target?.owner.id ?? -1, 1);
  }

  /** A shell came down: a direct hit kills people outright (no going down) and hurts vehicles a lot; then the blast. */
  shellHit(gun: string, point: THREE.Vector3, owner: GadgetOwner, target: Damageable | null, part: HitPart): void {
    const spec = VEHICLE_GUNS[gun as VehicleGunId];
    if (!spec) return;
    const name = t(`vehicleGun.${gun as VehicleGunId}`);
    const source: DamageSource = { pos: point.clone(), name: owner.name, team: owner.team, weapon: name, id: owner.id };
    if (target && target.team !== owner.team && target.id >= 0) {
      const person = this.sim.soldiers.get(target.id);
      const bot = person ? undefined : this.sim.bots?.bots.find((b) => b.id === target.id);
      if (this.world.get(target.id)) target.applyDamage(spec.vsVehicle, part, source, 'at');
      else if (person) {
        if (person.alive && person.damage(999, point, 'explosion', source)) {
          this.sim.reportKill(owner, person.id, person.combatant.name, person.team, name);
          person.die('explosion', source);
        }
      } else if (bot) {
        if (bot.alive) {
          bot.killOutright(source);
          this.sim.bus.emit('combat:hit', { targetId: bot.id, part, damage: 999, killed: true, point: point.clone(), byPlayer: false, attackerId: owner.id });
          this.sim.reportKill(owner, bot.id, bot.name, bot.team, name);
        }
      } else target.applyDamage(spec.vsVehicle, part, source, 'at'); // a recon plane
    }
    const kind: BlastKind = gun === 'howitzer' ? 'howitzer' : gun === 'atgun' ? 'atshell' : gun === 'rockets' ? 'salvo' : gun === 'aam' ? 'missile' : 'shell';
    this.sim.blast(kind, point, owner, name);
    this.onBoom(kind, point);
  }

  /** Blast damage to vehicles (roughly by the distance to the hull); a side's own crewed ones are spared. */
  blast(kind: BlastKind, point: THREE.Vector3, owner: Shooter, damage: (d: number) => number, source: DamageSource): void {
    for (const v of this.world.vehicles) {
      if (v.wrecked || (v.team && v.team === owner.team)) continue;
      const d = Math.max(0, v.pos.distanceTo(point) - Math.min(v.spec.half[0], v.spec.half[2]));
      const dmg = damage(d);
      if (dmg > 0) v.applyDamage(dmg, 'body', source, kind === 'rocket' || kind === 'cannon' ? 'at' : 'explosive');
    }
  }

  // ---------------------------------------------------------------------------
  // The world's news

  /** A vehicle blew up: everyone aboard dies outright (no going down). */
  private destroyed(v: Vehicle, by: DamageSource | null): void {
    this.onBoom('wreck', v.pos.clone());
    const owner: Shooter = { id: by?.id ?? -1, name: by?.name ?? '', team: by?.team ?? (v.home === 'blue' ? 'red' : 'blue') };
    const weapon = by?.weapon ?? t(`vehicle.${v.kind}`);
    for (const s of this.sim.soldiers.values()) {
      if (s.ride?.v !== v) continue;
      this.leave(s, false);
      if (s.alive && s.damage(999, v.pos, 'explosion', by ?? undefined)) {
        if (by && by.id !== s.id) this.sim.reportKill(owner, s.id, s.combatant.name, s.team, weapon);
        s.die('explosion', by ?? undefined);
      }
    }
    for (const b of this.sim.bots?.vehicleLost(v, by) ?? []) if (by) this.sim.reportKill(owner, b.id, b.name, b.team, weapon);
    v.seats.fill(null);
  }

  /** Someone run over: down (or dead), credited to the driver. */
  private roadkill(v: Vehicle, victim: Walker): void {
    const d = v.driver!;
    const name = this.sim.soldiers.get(d.id)?.combatant.name ?? this.sim.bots?.bots.find((b) => b.id === d.id)?.name ?? '';
    const weapon = t(`vehicle.${v.kind}`);
    const source: DamageSource = { pos: v.pos.clone(), name, team: d.team, weapon, id: d.id };
    const shooter: Shooter = { id: d.id, name, team: d.team };
    const person = this.sim.soldiers.get(victim.id);
    if (person) {
      if (person.damage(999, v.pos, 'explosion', source)) this.sim.reportKill(shooter, person.id, person.combatant.name, person.team, weapon);
      return;
    }
    const bot = this.sim.bots?.bots.find((b) => b.id === victim.id);
    if (!bot || !bot.alive) return;
    const killed = bot.applyDamage(999, 'body', source);
    this.sim.bus.emit('combat:hit', { targetId: bot.id, part: 'body', damage: 999, killed, point: bot.feet.clone(), byPlayer: false, attackerId: d.id });
    if (killed) this.sim.reportKill(shooter, bot.id, bot.name, bot.team, weapon);
  }

  // ---------------------------------------------------------------------------
  // Tanks, jets, the rocket tank

  /** A jet for `team` in the air off its side of the map, heading in. */
  spawnJet(kind: VehicleKind, team: Team): Vehicle | null {
    const air = this.world.air!;
    const c = air.center;
    const out = this.sim.baseCenter(team).sub(c).setY(0);
    if (out.lengthSq() < 1) out.set(0, 0, 1);
    out.normalize();
    const at = c.clone().addScaledVector(out, air.radius + 200).setY(c.y + AIRSPACE.startAlt + Math.random() * 40);
    at.addScaledVector(new THREE.Vector3(-out.z, 0, out.x), (Math.random() - 0.5) * 200);
    const v = this.world.spawnJet(kind, team, at, Math.atan2(out.x, out.z));
    if (v) v.arrivedAt = this.sim.time;
    return v;
  }

  /** Every few seconds a side under its tank limit puts a bot just back at its base into a new tank. */
  private botTanks(): void {
    const bots = this.sim.bots;
    if (!bots || this.sim.time < this.botTankAt) return;
    this.botTankAt = this.sim.time + 6;
    for (const team of ['blue', 'red'] as const) {
      if (this.world.tanks(team) >= this.world.tankLimit() || Math.random() < 0.5) continue;
      const spot = this.world.freeTankSpot(team);
      if (!spot) continue;
      const bot = bots.bots.find((b) => b.team === team && b.alive && !b.riding && !b.benched && !b.puppet && b.feet.distanceTo(spot.pos) < 40 && !b.inCombat(bots.time));
      if (!bot) continue;
      const v = this.world.spawnTank(TANK_KINDS[Math.floor(Math.random() * TANK_KINDS.length)]!, team);
      if (v) bots.seatBot(bot, v, 0);
    }
  }

  /** Bots fly jets too: a side with a free jet slot sends a bot from near its base up (people get a head start on it). */
  private botJets(): void {
    const bots = this.sim.bots;
    if (!bots) return;
    for (const team of ['blue', 'red'] as const) {
      if (this.world.jets(team) >= this.world.jetLimit()) this.jetFreeSince[team] = -1;
      else if (this.jetFreeSince[team] < 0) this.jetFreeSince[team] = this.sim.time;
    }
    if (this.sim.time < this.botJetAt) return;
    this.botJetAt = this.sim.time + BOT_JETS.every;
    for (const team of ['blue', 'red'] as const) {
      const free = this.jetFreeSince[team];
      if (free < 0) continue;
      const people = [...this.sim.soldiers.values()].some((s) => s.team === team);
      if (people && this.sim.time - free < BOT_JETS.peopleFirst) continue;
      const base = this.sim.baseCenter(team);
      const bot = bots.bots.find((b) => b.team === team && b.alive && !b.riding && !b.benched && !b.puppet && b.feet.distanceTo(base) < BOT_JETS.nearBase && !b.inCombat(bots.time));
      if (!bot) continue;
      const v = this.spawnJet(JET_KINDS[Math.floor(Math.random() * JET_KINDS.length)]!, team);
      if (v) bots.seatBot(bot as Bot, v, 0);
    }
  }

  /** Rocket tank call-in: a launcher truck by the zone nearest the caller, only the caller may drive it. */
  callRocketTank(owner: GadgetOwner, near: THREE.Vector3): boolean {
    const zm = this.sim.zoneMode;
    if (!this.world.heavy || !zm) return false;
    const zones = zm.zones.map((z) => ({ id: z.id, pos: new THREE.Vector3(z.x, z.y, z.z), radius: z.radius })).sort((a, b) => a.pos.distanceTo(near) - b.pos.distanceTo(near));
    for (const z of zones.slice(0, 2)) {
      for (let i = 0; i < 36; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = z.radius + 4 + Math.floor(i / 12) * 6;
        const yaw = a + Math.PI / 2;
        const p = flatSpot(this.physics, z.pos.x + Math.cos(a) * r, z.pos.z + Math.sin(a) * r, z.pos.y, 1.9, 4.2, yaw);
        if (!p || this.world.vehicles.some((v) => v.pos.distanceTo(p) < 8)) continue;
        const v = this.world.spawn('rocket', p, yaw, owner.team);
        v.driverOnly = owner.id;
        this.onRocketTank(owner.team, z.id, owner.name, owner.id);
        this.sim.bots?.rocketTankFor(owner.id, v);
        return true;
      }
    }
    return false;
  }
}
