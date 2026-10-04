import * as THREE from 'three';
import { rayHitbox } from '@/combat/CharacterHitboxes';
import { HitboxRegistry } from '@/combat/Hitboxes';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { BLASTS, fragDamage, type BlastKind } from '@/combat/explosions';
import type { DamageSource } from '@/combat/Hitboxes';
import type { GrenadeOwner } from '@/core/events';
import { CLASSES, REVIVE_RANGE, defaultLoadout, loadoutWeapons, type Loadout } from '@/data/classes';
import { t } from '@/i18n';
import { Throwables } from '@/weapons/Throwables';
import { consumePulses, createInputState, type InputState } from '@/input/InputState';
import { ZoneMode } from '@/modes/ZoneMode';
import type { ModeKind } from '@/modes/matchRules';
import { ScoreTracker } from '@/modes/scoreTracker';
import { Layer, PhysicsWorld } from '@/physics/PhysicsWorld';
import { MOVE } from '@/player/movement';
import { SurfaceRegistry } from '@/physics/surfaces';
import type { MapDef, Team } from '@/world/mapTypes';
import { Soldier } from './Soldier';
import type { ShotCaster } from '@/weapons/WeaponController';
import { buildWorld, type SimWorld } from './world';

const DEG = Math.PI / 180;
/** The game server's fixed step (s); the browser runs the same. */
export const SIM_DT = 1 / 60;

export interface MatchOptions {
  mode?: ModeKind;
  /** Tickets for every side that has them instead of the per-soldier numbers. */
  tickets?: number;
  /** Soldiers a side (Frontline / Conquest tickets scale with it). */
  teamSize?: { blue: number; red: number };
}

/** One soldier's controls for a step: buttons and stick, and where they look (absolute). */
export interface SoldierInput {
  state: InputState;
  yaw: number;
  pitch: number;
  /** Scope sway on the aim (the browser works it out from its breath state). */
  swayYaw?: number;
  swayPitch?: number;
}

/** Where a soldier was at a tick, for judging shots fired by someone who saw it then. */
interface Pose {
  tick: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  height: number;
  /** On the field, up and not down: shots can hit it. */
  hittable: boolean;
}

/** Ticks of poses kept per soldier (a little over a second at 60 Hz). */
const HISTORY = 80;

/** A small seeded random source (mulberry32): the same seed gives the same draws at both ends. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where a deployed soldier came out and the seed of its spread for this life. */
export interface Deployed {
  pos: THREE.Vector3;
  yaw: number;
  seed: number;
}

/**
 * A match without a view, as the game server runs it: the map world, the
 * soldiers people play, the zone mode and the score table. Each step takes
 * every soldier's input, moves and fires for them, runs the zone rules and
 * the physics. Bots, vehicles, gadgets, fortifications and call-ins come in
 * later steps (they still live in `Game`).
 */
export class MatchSim {
  readonly bus = new EventBus<GameEvents>();
  readonly registry = new HitboxRegistry();
  readonly scores = new ScoreTracker();
  readonly soldiers = new Map<number, Soldier>();
  readonly zoneMode: ZoneMode | null;
  /** Grenades in the world (their meshes go into a scene nobody draws). */
  readonly throwables: Throwables;
  /** Sim clock (s). */
  time = 0;
  /** Steps run so far. */
  tick = 0;
  winner: Team | null = null;
  private readonly idle = createInputState();
  private readonly poses = new Map<number, Pose[]>();
  private readonly eyeTmp = new THREE.Vector3();

  private constructor(
    readonly physics: PhysicsWorld,
    readonly impacts: SurfaceRegistry,
    readonly world: SimWorld,
    opts: MatchOptions,
  ) {
    physics.timestep = SIM_DT;
    this.throwables = new Throwables(new THREE.Scene(), physics, this.bus);
    const map = world.map;
    this.zoneMode = (map.zones?.length ?? 0) > 0 ? new ZoneMode(map, this.bus, { mode: opts.mode, tickets: opts.tickets, teamSize: opts.teamSize }) : null;
    this.wire();
    // Colliders into the broadphase before the first query.
    physics.step();
  }

  /** Builds the world for `map` (a parsed map; it is changed: things move onto the terrain). */
  static async create(map: MapDef, opts: MatchOptions = {}): Promise<MatchSim> {
    const physics = await PhysicsWorld.create();
    const impacts = new SurfaceRegistry();
    return new MatchSim(physics, impacts, buildWorld(map, physics, impacts), opts);
  }

  private wire(): void {
    const bus = this.bus;
    const zm = this.zoneMode;
    bus.on('combat:kill', (e) => this.scores.kill(e.attackerId, e.victimId, e.headshot));
    bus.on('combatant:died', (e) => {
      this.scores.death(e.id);
      zm?.onDeath(e.team);
    });
    bus.on('match:ended', (e) => (this.winner = e.winner));
    bus.on('grenade:detonate', (e) => {
      if (e.type === 'frag') this.blast('frag', e.point, e.owner, t('grenade.frag'));
    });
    bus.on('combatant:revived', (e) => this.scores.revive(e.byId, e.medic));
    if (!zm) return;
    // Credit for zones goes to the side's soldiers standing in the zone at that moment.
    const inZone = (zone: string, team: Team) => {
      const ids: number[] = [];
      for (const s of this.soldiers.values()) if (s.combatant.alive && s.team === team && zm.zoneAt(s.player.feet)?.id === zone) ids.push(s.id);
      return ids;
    };
    bus.on('zone:captured', (e) => this.scores.objective(inZone(e.zone, e.team), 'capture'));
    bus.on('zone:neutralized', (e) => this.scores.objective(inZone(e.zone, e.team === 'blue' ? 'red' : 'blue'), 'neutralize'));
  }

  // ---------------------------------------------------------------------------
  // Soldiers

  /** A person joins: their soldier waits off the field until it deploys. */
  addSoldier(id: number, team: Team, name: string, kit: Loadout = defaultLoadout('assault')): Soldier {
    const base = this.base(team);
    const s = new Soldier({
      id,
      team,
      name: () => name,
      local: false,
      physics: this.physics,
      bus: this.bus,
      impacts: this.impacts,
      registry: this.registry,
      spawn: base.pos,
      yaw: base.yaw,
      loadout: loadoutWeapons(kit),
      now: () => this.time,
      combatClock: () => this.time,
    });
    s.cls = kit.cls;
    s.grenades.reset(kit.grenade);
    s.player.water = this.world.water;
    s.deployFlow = true;
    s.deployed = false;
    s.boxes.setEnabled(false);
    this.soldiers.set(id, s);
    this.scores.add(id, name, team);
    return s;
  }

  /** Someone left: their soldier and its bodies go. */
  removeSoldier(id: number): void {
    const s = this.soldiers.get(id);
    if (!s) return;
    s.dispose();
    this.soldiers.delete(id);
    this.poses.delete(id);
  }

  /**
   * Deploys a soldier waiting off the field at `key` ('base' or 'zone:<id>')
   * with `kit`; null when it can't yet (still on the respawn wait, or on the field).
   */
  deploy(id: number, key = 'base', kit: Loadout = defaultLoadout('assault'), seed = (Math.random() * 2 ** 32) >>> 0): Deployed | null {
    const s = this.soldiers.get(id);
    if (!s || s.deployed || s.respawnTimer > 0 || this.winner) return null;
    const [kind, zone] = key.split(':');
    const at = this.zoneMode ? this.zoneMode.spawnPoint(s.team, kind === 'zone' ? zone! : 'base', null) : this.base(s.team);
    s.deployed = true;
    s.spawn(this.clearSpot(at.pos, s), at.yaw, kit);
    s.weapons.rand = seeded(seed);
    return { pos: s.player.feet.clone(), yaw: at.yaw, seed };
  }

  /**
   * A free spot within a few metres of `at`: ground under it, no wall in it,
   * nobody already standing there. Soldiers stacked on one spawn point push
   * each other's capsules every step (the server has no navmesh to spread them
   * yet).
   */
  private clearSpot(at: THREE.Vector3, self: Soldier): THREE.Vector3 {
    const half = { x: MOVE.radius, y: MOVE.standHeight / 2 - 0.05, z: MOVE.radius };
    const gap = MOVE.radius * 2.4;
    for (let i = 0; i < 16; i++) {
      const r = i === 0 ? 0 : 0.8 + Math.random() * 3;
      const a = Math.random() * Math.PI * 2;
      const x = at.x + Math.cos(a) * r;
      const z = at.z + Math.sin(a) * r;
      const hit = this.physics.raycast({ x, y: at.y + 1.5, z }, { x: 0, y: -1, z: 0 }, 4, Layer.WORLD);
      if (!hit) continue;
      const feet = new THREE.Vector3(x, hit.point.y + 0.02, z);
      if (this.physics.overlapsBox({ x, y: feet.y + MOVE.standHeight / 2 + 0.05, z }, half, 0, Layer.WORLD)) continue;
      let taken = false;
      for (const o of this.soldiers.values()) if (o !== self && o.deployed && o.player.feet.distanceToSquared(feet) < gap * gap) taken = true;
      if (!taken) return feet;
    }
    return at.clone();
  }

  /** A spot at the side's base (spawn points of the map). */
  private base(team: Team): { pos: THREE.Vector3; yaw: number } {
    const list = this.world.map.spawns.filter((sp) => sp.team === team || (team === 'blue' && sp.team === 'player'));
    const sp = list[Math.floor(Math.random() * list.length)] ?? this.world.map.spawns[0]!;
    return { pos: new THREE.Vector3(...sp.pos), yaw: sp.yaw * DEG };
  }

  // ---------------------------------------------------------------------------

  /** One fixed step: every soldier with its input (none: standing still), the zone rules, the physics. */
  step(inputs: (id: number) => SoldierInput | null, dt = SIM_DT): void {
    this.beginStep(dt);
    for (const s of this.soldiers.values()) this.stepSoldier(s, inputs(s.id), dt);
    this.endStep(dt);
  }

  /** Starts a step: the clock moves. Then `stepSoldier` for each input, then `endStep`. */
  beginStep(dt = SIM_DT): void {
    this.time += dt;
    this.tick++;
  }

  /**
   * One input's worth of a soldier (the game server may step a soldier twice
   * in a tick to catch up with a browser running a little ahead, or not at all
   * while its inputs are late). `given` null: standing still.
   */
  stepSoldier(s: Soldier, given: SoldierInput | null, dt = SIM_DT): void {
    const input = given?.state ?? this.idle;
    if (given) {
      s.player.yaw = given.yaw;
      s.player.pitch = given.pitch;
      s.weapons.sway.yaw = given.swayYaw ?? 0;
      s.weapons.sway.pitch = given.swayPitch ?? 0;
    }
    // A click released before this step still counts as one trigger pull.
    if (input.firePressed) input.fire = true;
    if (s.alive && s.deployed) {
      s.stepTimers(dt);
      if (input.medkit) s.useMedkit();
      s.stepMedkit(dt);
      const reviving = this.stepRevive(s, input.interact, dt);
      if (input.throwGrenade) {
        const owner: GrenadeOwner = { id: s.id, name: s.combatant.name, team: s.team };
        s.throwGrenade((type, origin, dir, carry) => this.throwables.throw(type, origin, dir, carry, owner));
      }
      s.stepOnFoot(dt, input, s.throwBlock > 0 || s.medkitUse > 0 || reviving);
      // The eye follows crouching as the browser's view does (shots start there).
      s.player.eyePosition(1, dt, this.eyeTmp);
    } else if (s.downed) s.stepDowned(dt, input.jumpHeld);
    else s.respawnTimer -= dt;
    consumePulses(input);
  }

  /** Ends a step: hitboxes follow the bodies, poses are kept, the zone rules and the physics run. */
  endStep(dt = SIM_DT): void {
    for (const s of this.soldiers.values()) {
      s.syncBoxes();
      this.recordPose(s);
    }
    this.zoneMode?.step(dt, [...this.soldiers.values()].map((s) => s.combatant));
    this.throwables.step(dt);
    this.physics.step();
  }

  // ---------------------------------------------------------------------------
  // Reviving and blasts

  /** The downed mate nearest `s` within reach, if any. */
  downedMateNear(s: Soldier): Soldier | null {
    let best: Soldier | null = null;
    let bestD = REVIVE_RANGE;
    for (const o of this.soldiers.values()) {
      if (o === s || o.team !== s.team || !o.downed || !o.deployed) continue;
      const d = o.player.feet.distanceTo(s.player.feet);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  /** Holding E by a downed mate: the revive runs; true while hands are busy with it. */
  private stepRevive(s: Soldier, holding: boolean, dt: number): boolean {
    const mate = holding ? this.downedMateNear(s) : null;
    if (!mate) {
      s.reviveOf = null;
      s.reviveProgress = 0;
      return false;
    }
    if (s.reviveOf !== mate.id) {
      s.reviveOf = mate.id;
      s.reviveProgress = 0;
    }
    s.reviveProgress += dt;
    const spec = CLASSES[s.cls];
    if (s.reviveProgress >= spec.reviveTime) {
      mate.revive(s.combatant.name, spec.reviveHealth);
      this.bus.emit('combatant:revived', { team: mate.team, id: mate.id, name: mate.combatant.name, byId: s.id, byName: s.combatant.name, medic: s.cls === 'medic' });
      s.reviveOf = null;
      s.reviveProgress = 0;
    }
    return true;
  }

  /**
   * An explosion: soldiers within reach take damage (less behind cover), the
   * thrower too, teammates not. Kills count like bullet kills.
   */
  blast(kind: BlastKind, point: THREE.Vector3, owner: GrenadeOwner, weapon: string): void {
    const spec = BLASTS[kind];
    const source: DamageSource = { pos: point.clone(), name: owner.name, team: owner.team, weapon, id: owner.id };
    const probe = { x: point.x, y: point.y + 0.25, z: point.z };
    for (const s of this.soldiers.values()) {
      if (!s.deployed || !s.alive || s.downed) continue;
      const self = s.id === owner.id;
      if (!self && s.team === owner.team) continue;
      const chest = { x: s.player.feet.x, y: s.player.feet.y + 1.1, z: s.player.feet.z };
      const d = Math.hypot(chest.x - point.x, chest.y - point.y, chest.z - point.z);
      const dmg = fragDamage(spec, d, this.physics.blocked(probe, chest, Layer.WORLD));
      if (dmg <= 0) continue;
      const killed = s.damage(dmg, point, 'explosion', self ? undefined : source);
      if (self) continue;
      this.bus.emit('combat:hit', { targetId: s.id, part: 'body', damage: dmg, killed, point: new THREE.Vector3(chest.x, chest.y, chest.z), byPlayer: false, attackerId: owner.id });
      if (killed) {
        this.bus.emit('combat:kill', {
          attacker: owner.name,
          victim: s.combatant.name,
          weapon,
          headshot: false,
          byPlayer: false,
          attackerTeam: owner.team,
          victimTeam: s.team,
          attackerId: owner.id,
          victimId: s.id,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lag compensation

  private recordPose(s: Soldier): void {
    let ring = this.poses.get(s.id);
    if (!ring) this.poses.set(s.id, (ring = []));
    const p = s.player;
    const slot = this.tick % HISTORY;
    const pose = ring[slot] ?? (ring[slot] = { tick: -1, x: 0, y: 0, z: 0, yaw: 0, height: 0, hittable: false });
    pose.tick = this.tick;
    pose.x = p.feet.x;
    pose.y = p.feet.y;
    pose.z = p.feet.z;
    pose.yaw = p.yaw;
    pose.height = p.bodyHeight;
    pose.hittable = s.deployed && p.alive && !s.downed;
  }

  /** A soldier's pose at a (fractional) tick from the kept ones; null if not kept or not hittable then. */
  poseAt(id: number, tick: number): Pose | null {
    const ring = this.poses.get(id);
    if (!ring) return null;
    const t0 = Math.floor(tick);
    const a = ring[t0 % HISTORY];
    if (!a || a.tick !== t0) return null;
    const b = ring[(t0 + 1) % HISTORY];
    const f = tick - t0;
    if (!b || b.tick !== t0 + 1 || f <= 0) return a.hittable ? a : null;
    // Spawned or went down between the two: whichever side was hittable.
    if (!a.hittable || !b.hittable) return a.hittable ? a : b.hittable ? b : null;
    const dy = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
    return {
      tick,
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      z: a.z + (b.z - a.z) * f,
      yaw: a.yaw + dy * f,
      height: a.height + (b.height - a.height) * f,
      hittable: true,
    };
  }

  /**
   * Shots by `shooter` judged against everyone else where the shooter saw them:
   * at `viewTick` (the browser draws others a little in the past), at most
   * `maxRewind` ticks back. Walls are the world as it is now.
   */
  casterFor(shooter: Soldier, viewTick: number, maxRewind: number): ShotCaster {
    const now = this.tick;
    const at = Math.max(now - maxRewind, Math.min(now, viewTick));
    return (eye, dir, maxDist) => {
      const wall = this.physics.raycast(eye, dir, maxDist, Layer.WORLD);
      let best = wall ? wall.distance : maxDist;
      let hit: { s: Soldier; part: 'head' | 'body' | 'limb' } | null = null;
      for (const o of this.soldiers.values()) {
        if (o === shooter) continue;
        // Only who is still up now can be hurt (going down or dying in between ends it).
        if (!o.deployed || !o.alive || o.downed) continue;
        const pose = this.poseAt(o.id, at) ?? this.poseAt(o.id, now);
        if (!pose) continue;
        const r = rayHitbox(pose, pose.yaw, pose.height, eye, dir, best);
        if (r && r.distance < best) {
          best = r.distance;
          hit = { s: o, part: r.part };
        }
      }
      if (hit) {
        const point = { x: eye.x + dir.x * best, y: eye.y + dir.y * best, z: eye.z + dir.z * best };
        return { distance: best, point, normal: { x: -dir.x, y: -dir.y, z: -dir.z }, handle: null, target: { owner: hit.s.target, part: hit.part } };
      }
      if (!wall) return null;
      return { distance: wall.distance, point: wall.point, normal: wall.normal, handle: wall.collider.handle, target: null };
    };
  }

  dispose(): void {
    this.physics.dispose();
  }
}
