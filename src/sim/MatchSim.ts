import * as THREE from 'three';
import { Bot, setNextBotId } from '@/ai/Bot';
import { BotManager, HEAR_STEP, HEAR_STEP_SPRINT } from '@/ai/BotManager';
import type { Difficulty } from '@/ai/difficulty';
import { NavWorld, VehicleNav } from '@/ai/NavWorld';
import type { Combatant } from '@/ai/types';
import type { AudioSystem } from '@/audio/AudioSystem';
import { rayHitbox } from '@/combat/CharacterHitboxes';
import { BLASTS, GRENADES, flashDuration, flashIntensity, fragDamage, type BlastKind } from '@/combat/explosions';
import { HitboxRegistry, type DamageSource, type Damageable } from '@/combat/Hitboxes';
import { EventBus } from '@/core/EventBus';
import type { GameEvents, GrenadeOwner, HitPart } from '@/core/events';
import { CLASSES, MEDKIT, REVIVE_RANGE, defaultLoadout, loadoutWeapons, type Loadout } from '@/data/classes';
import { ROCKET } from '@/data/gadgets';
import { CALL_RANGE, SUPPORT_ORDER, squadRp, type SupportId } from '@/data/support';
import { t } from '@/i18n';
import { consumePulses, createInputState, type InputState } from '@/input/InputState';
import { ZoneMode } from '@/modes/ZoneMode';
import { Fortifications } from '@/modes/fortify';
import { GadgetWorld, type GadgetOwner, type MineWalker } from '@/modes/gadgetWorld';
import type { ModeKind } from '@/modes/matchRules';
import { ScoreTracker } from '@/modes/scoreTracker';
import { SQUAD_SIZE, Squad, WIPE_PENALTY, mateSpawnBlock, squadName, type SquadMember } from '@/modes/squads';
import { SupportWorld } from '@/modes/supportWorld';
import { Layer, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SurfaceRegistry } from '@/physics/surfaces';
import { MOVE } from '@/player/movement';
import type { Effects, SmokeVolume } from '@/render/Effects';
import type { ShotCaster } from '@/weapons/WeaponController';
import { Throwables } from '@/weapons/Throwables';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import { FortModels } from '@/world/fortModels';
import type { MapDef, Team } from '@/world/mapTypes';
import { kitToggles, needsStation, restockAmmo, stepFort, stepGadget, stepGive, type GiveClock, type KitWorld } from './kit';
import { Soldier } from './Soldier';
import { MatchVehicles } from './vehicles';
import { buildWorld, fortPlanFor, type SimWorld } from './world';

const DEG = Math.PI / 180;
/** The game server's fixed step (s); the browser runs the same. */
export const SIM_DT = 1 / 60;

export interface MatchOptions {
  mode?: ModeKind;
  /** Tickets for every side that has them instead of the per-soldier numbers. */
  tickets?: number;
  /** Soldiers a side (Frontline / Conquest tickets scale with it). */
  teamSize?: { blue: number; red: number };
  /**
   * Bots: how many soldiers each side has in all (people take bots' places
   * as they join), and how well they play. None: people only.
   */
  bots?: { blue: number; red: number; difficulty: Difficulty } | null;
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

/** Where a soldier or bot was at a tick, for judging shots fired by someone who saw it then. */
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

/** What goes off where everyone should see it. */
export type BoomKind = 'frag' | 'flash' | 'smoke' | 'rocket' | 'mine' | 'riflesmoke' | 'mortar' | 'artillery' | 'smokeShell' | 'shell' | 'howitzer' | 'atshell' | 'salvo' | 'missile' | 'cannon' | 'wreck';

/** Where a deployed soldier came out and the seed of its spread for this life. */
export interface Deployed {
  pos: THREE.Vector3;
  yaw: number;
  seed: number;
}

/** The game server has no sound. */
const SILENT = new Proxy({}, { get: () => () => undefined }) as unknown as AudioSystem;

/**
 * A match without a view, as the game server runs it: the map world, the
 * soldiers people play and the bots, the zone mode and the score table,
 * grenades, gadgets, fortifications, squads and call-ins. Each step takes
 * every soldier's input, moves and fires for them, runs the bots, the zone
 * rules and the physics. Vehicles: `MatchVehicles` (zone matches).
 */
export class MatchSim {
  readonly bus = new EventBus<GameEvents>();
  readonly registry = new HitboxRegistry();
  readonly scores = new ScoreTracker();
  readonly soldiers = new Map<number, Soldier>();
  readonly zoneMode: ZoneMode | null;
  /** Grenades in the world (their meshes go into a scene nobody draws). */
  readonly throwables: Throwables;
  /** Zone supply stations and build spots (zone matches). */
  readonly fort: Fortifications | null;
  /** Rockets, rifle grenades, beacons and mines. */
  readonly gadgets: GadgetWorld;
  /** Call-ins in the world: barrages, recon planes, supply crates. */
  readonly support: SupportWorld;
  /** The bots (rooms with bots), on the navmesh. */
  readonly bots: BotManager | null;
  /** Vehicles (zone matches). */
  readonly vehicles: MatchVehicles | null;
  /** Squads of each side (four each; people take the places of bots; the first member leads). */
  readonly squads: Squad[] = [];
  /** Something went off where everyone should see it (grenades, rockets, mines, rifle smoke, shells). */
  onBoom: (kind: BoomKind, point: THREE.Vector3) => void = () => {};
  /** A mate handed `to` a medkit or ammo (`by` null: a supply crate). */
  onGive: (by: Soldier | null, to: Soldier, kind: 'medkit' | 'ammo' | 'crate') => void = () => {};
  /** A call-in was made (browsers show it). */
  onCallIn: (kind: SupportId, point: THREE.Vector3, owner: GadgetOwner) => void = () => {};
  /** A shell is about a second out. */
  onIncoming: (point: THREE.Vector3) => void = () => {};
  /** A recon plane marked `ids` (enemies of `team`). */
  onSpotted: (team: Team, ids: number[]) => void = () => {};
  /** Squads or the bots on the field changed (the roster goes out again). */
  onRoster: () => void = () => {};
  /** Squads already given the wipe penalty for their current wipe. */
  private readonly penalized = new Set<Squad>();
  private readonly kit: KitWorld;
  private readonly giveClock: GiveClock = new Map();
  /** Smoke clouds (bots can't see through them). */
  private readonly smokes: SmokeVolume[] = [];
  /** Sim clock (s). */
  time = 0;
  /** Steps run so far. */
  tick = 0;
  winner: Team | null = null;
  private readonly idle = createInputState();
  private readonly poses = new Map<number, Pose[]>();
  private readonly eyeTmp = new THREE.Vector3();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();

  private constructor(
    readonly physics: PhysicsWorld,
    readonly impacts: SurfaceRegistry,
    readonly world: SimWorld,
    opts: MatchOptions,
    nav: NavWorld | null,
    vehicleNav: VehicleNav | null = null,
  ) {
    physics.timestep = SIM_DT;
    this.throwables = new Throwables(new THREE.Scene(), physics, this.bus);
    const map = world.map;
    this.zoneMode = (map.zones?.length ?? 0) > 0 ? new ZoneMode(map, this.bus, { mode: opts.mode, tickets: opts.tickets, teamSize: opts.teamSize }) : null;
    this.fort = this.zoneMode ? new Fortifications(fortPlanFor(world, physics), new FortModels(null), physics, impacts, nav) : null;
    this.gadgets = new GadgetWorld(physics, this.registry, {
      explode: (kind, point, owner) => {
        this.blast(kind, point, owner, t(kind === 'rocket' ? 'gadget.assault' : 'gadget.mine'));
        this.onBoom(kind, point);
      },
      directHit: (target, part, point, owner) => this.rocketHit(target, part, point, owner),
      smoke: (point) => {
        this.addSmoke(point, GRENADES.smoke.radius);
        this.onBoom('riflesmoke', point);
      },
      shell: (gun, point, owner, target, part) => this.vehicles?.shellHit(gun, point, owner, target, part),
    });
    this.support = new SupportWorld(physics, {
      shell: (kind, point, owner) => {
        this.blast(kind, point, owner, t(`support.${kind}`));
        this.onBoom(kind, point);
      },
      smoke: (point) => {
        this.addSmoke(point, GRENADES.smoke.radius * 1.3);
        this.onBoom('smokeShell', point);
      },
      incoming: (point) => this.onIncoming(point),
      reveal: (team, center, radius) => {
        this.bots?.reveal(team, center, radius);
        const ids: number[] = [];
        for (const c of this.fighters()) if (c.team !== team && c.alive && c.feet.distanceTo(center) < radius) ids.push(c.id);
        if (ids.length) this.onSpotted(team, ids);
      },
      resupply: (team, pos, reach) => this.crateResupply(team, pos, reach),
      vehicle: (owner, near) => this.vehicles?.callRocketTank(owner, near) ?? false,
    });
    const fort = this.fort;
    this.kit = {
      physics,
      fort,
      gadgets: this.gadgets,
      zoneOwner: (id) => this.zoneMode?.zone(id)?.owner ?? null,
      inTheWay: (slot) => {
        for (const c of this.fighters()) if ((c.alive || c.downed) && fort?.occupies(slot, c.feet)) return true;
        return false;
      },
      owner: (s) => ({ id: s.id, name: s.combatant.name, team: s.team, squad: this.squadKey(s.id) }),
      points: (id, p) => this.scores.award(id, p),
    };
    this.bots = nav && opts.bots ? this.makeBots(nav, opts.bots) : null;
    if (this.bots) this.bots.vehicleNav = vehicleNav;
    const size = (opts.teamSize?.blue ?? 12) + (opts.teamSize?.red ?? 12);
    this.vehicles = this.zoneMode ? new MatchVehicles(this, map, size) : null;
    if (this.vehicles) this.vehicles.onBoom = (kind, point) => this.onBoom(kind, point);
    this.wire();
    // Colliders into the broadphase before the first query.
    physics.step();
  }

  /** Builds the world for `map` (a parsed map; it is changed: things move onto the terrain). */
  static async create(map: MapDef, opts: MatchOptions = {}): Promise<MatchSim> {
    const physics = await PhysicsWorld.create();
    const impacts = new SurfaceRegistry();
    const world = buildWorld(map, physics, impacts);
    let nav: NavWorld | null = null;
    let vehicleNav: VehicleNav | null = null;
    if (opts.bots && opts.bots.blue + opts.bots.red > 0) {
      // Colliders into the broadphase before the navmesh reads them.
      physics.step();
      nav = await NavWorld.build(physics, world.built.navExtra ?? undefined);
      // Bot drivers route on a mesh as wide as a tank.
      if ((map.zones?.length ?? 0) > 0) vehicleNav = await VehicleNav.build(physics, world.built.navExtra ?? undefined);
    }
    return new MatchSim(physics, impacts, world, opts, nav, vehicleNav);
  }

  // ---------------------------------------------------------------------------
  // Bots

  private makeBots(nav: NavWorld, opts: NonNullable<MatchOptions['bots']>): BotManager {
    const map = this.world.map;
    // Bot ids from 1 in each room (people's are 1000 up).
    setNextBotId(1);
    const effects = { activeSmokes: () => this.smokes, spawnShots: () => {}, muzzleFlash: () => {} } as unknown as Effects;
    const bots = new BotManager(new THREE.Scene(), this.physics, nav, this.registry, this.impacts, this.bus, SILENT, effects, () => this.humans(), map.spawns, {
      allies: opts.blue,
      enemies: opts.red,
      difficulty: opts.difficulty,
    });
    bots.grenades = this.throwables;
    bots.gadgets = this.gadgets;
    bots.squadKey = (b) => this.squadKey(b.id);
    bots.setTactical(this.world.built.windows, this.world.built.footprints);
    if (map.trees) bots.setForest(map.trees, map.world.size);
    if (this.world.water) bots.setWater(this.world.water);
    bots.fort = this.fort;
    bots.fortBlocked = (slot) => this.kit.inTheWay(slot);
    bots.zoneOwner = (id) => this.zoneMode?.zone(id)?.owner ?? null;
    bots.viewers = () => this.humanFeet();
    const zm = this.zoneMode;
    bots.hooks = {
      objectives: (team) => zm?.objectives(team) ?? [],
      spawnAt: (bot, objective) => this.botSpawn(bot, objective),
      revivePlayer: (by, health, who) => this.soldiers.get(who.id)?.revive(by.name, health),
    };
    bots.support = {
      rp: (bot) => {
        const sq = this.squadOf(bot.id);
        return sq ? this.squadRp(sq) : 0;
      },
      cooldown: (team, kind) => this.support.cooldown(team, kind),
      call: (kind, point, bot) => {
        const sq = this.squadOf(bot.id);
        if (!sq) return false;
        const owner: GadgetOwner = { id: bot.id, name: bot.name, team: bot.team, squad: `${sq.team}:${sq.name}` };
        if (!this.support.request(kind, point, owner, this.squadRp(sq), false)) return false;
        this.onCallIn(kind, point, owner);
        return true;
      },
      dangers: () => this.support.dangers(),
    };
    for (const b of bots.bots) this.scores.add(b.id, b.name, b.team);
    // Squads of four from the bots, in order; people take bots' places as they join.
    for (const team of ['blue', 'red'] as const) {
      const list = bots.bots.filter((b) => b.team === team);
      for (let i = 0; i < list.length; i += SQUAD_SIZE) {
        const index = i / SQUAD_SIZE;
        this.squads.push(new Squad(index, team, squadName(index), list.slice(i, i + SQUAD_SIZE)));
      }
    }
    // One sector open: start on what each side holds nearest the fight.
    if (zm && zm.kind !== 'zone') queueMicrotask(() => bots.redeployAll());
    return bots;
  }

  /** The soldiers people play, as bots see them. */
  private *humans(): Iterable<Combatant> {
    for (const s of this.soldiers.values()) yield s.combatant;
  }

  private *humanFeet(): Iterable<THREE.Vector3> {
    for (const s of this.soldiers.values()) if (s.deployed) yield s.player.feet;
  }

  /** Everyone on the field: people's soldiers and bots (benched bots aside). */
  private *fighters(): Iterable<Combatant> {
    for (const s of this.soldiers.values()) if (s.deployed) yield s.combatant;
    for (const b of this.bots?.bots ?? []) if (!b.benched) yield b;
  }

  /**
   * The bots in each squad. They pick their own objectives: a person leading
   * the squad (its first member) spends its call-ins, but people come and go
   * and wait on the deploy screen, so bots don't plan around them.
   */
  private syncBotSquads(): void {
    if (!this.bots) return;
    this.bots.setSquads(this.squads.map((q) => ({ index: q.index, botIds: q.members.filter((m) => m instanceof Bot).map((m) => m.id), leader: null })));
  }

  /** Where a bot respawns: on a person leading its squad when allowed, else the spawn nearest its objective. */
  private botSpawn(bot: Bot, objective: THREE.Vector3 | null): { pos: THREE.Vector3; yaw: number } {
    const sq = this.squadOf(bot.id);
    const mates = sq ? sq.mates(bot.id).filter((m) => !mateSpawnBlock(m, this.time, this.riding(m.id))) : [];
    const lead = sq?.members[0];
    if (lead && !(lead instanceof Bot) && mates.includes(lead)) return this.spawnAt(bot.team, `mate:${lead.id}`, bot.id);
    const enemy = this.baseCenter(bot.team === 'blue' ? 'red' : 'blue');
    const target = objective ?? enemy;
    const cands: { key: string; x: number; z: number }[] = [];
    const base = this.baseCenter(bot.team);
    cands.push({ key: 'base', x: base.x, z: base.z });
    for (const o of this.zoneMode?.spawnOptions(bot.team) ?? []) {
      if (o.id === 'base') continue;
      const z = this.zoneMode!.zone(o.id)!;
      cands.push({ key: `zone:${o.id}`, x: z.x, z: z.z });
    }
    for (const m of mates) cands.push({ key: `mate:${m.id}`, x: m.feet.x, z: m.feet.z });
    for (const b of this.gadgets.beaconsFor(bot.team, this.squadKey(bot.id))) cands.push({ key: `beacon:${b.id}`, x: b.pos.x, z: b.pos.z });
    let best = cands[0]!;
    let bestD = Infinity;
    for (const c of cands) {
      const d = Math.hypot(c.x - target.x, c.z - target.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return this.spawnAt(bot.team, best.key, bot.id);
  }

  /** Someone (a person or a bot) sits in a vehicle (nobody spawns beside them). */
  riding(id: number): boolean {
    return !!this.soldiers.get(id)?.ride || !!this.bots?.bots.find((b) => b.id === id)?.riding;
  }

  baseCenter(team: Team): THREE.Vector3 {
    return this.zoneMode?.base(team).clone() ?? this.base(team).pos;
  }

  // ---------------------------------------------------------------------------

  private addSmoke(point: THREE.Vector3, radius: number): void {
    this.smokes.push({ pos: point.clone(), radius, until: this.time + (GRENADES.smoke.duration ?? 20) });
  }

  private wire(): void {
    const bus = this.bus;
    const zm = this.zoneMode;
    bus.on('combat:kill', (e) => this.scores.kill(e.attackerId, e.victimId, e.headshot));
    bus.on('combatant:died', (e) => {
      this.scores.death(e.id);
      zm?.onDeath(e.team);
      // A squad wiped out entirely waits longer to come back.
      for (const s of this.penalized) if (!s.wiped) this.penalized.delete(s);
      const sq = this.squadOf(e.id);
      if (sq && sq.wiped && !this.penalized.has(sq)) {
        this.penalized.add(sq);
        for (const m of sq.members) {
          const s = this.soldiers.get(m.id);
          if (s) s.respawnTimer += WIPE_PENALTY;
          else if (m instanceof Bot) m.respawnPenalty = WIPE_PENALTY;
        }
      }
    });
    bus.on('match:ended', (e) => (this.winner = e.winner));
    bus.on('grenade:detonate', (e) => {
      if (e.type === 'frag') this.blast('frag', e.point, e.owner, t('grenade.frag'));
      else if (e.type === 'flash') this.flashBots(e.point);
      else this.addSmoke(e.point, GRENADES.smoke.radius);
      this.onBoom(e.type, e.point);
    });
    bus.on('combatant:revived', (e) => this.scores.revive(e.byId, e.medic));
    bus.on('combatant:resupplied', (e) => this.scores.resupply(e.byId));
    // People's footsteps carry to the bots.
    bus.on('player:footstep', (e) => {
      const who = this.soldierAt(e.point);
      if (who) this.bots?.alert(e.point, e.sprinting ? HEAR_STEP_SPRINT : HEAR_STEP, who.combatant, 'step');
    });
    if (!zm) return;
    // Credit for zones goes to the side's soldiers standing in the zone at that moment.
    const inZone = (zone: string, team: Team) => {
      const ids: number[] = [];
      for (const c of this.fighters()) if (c.alive && c.team === team && zm.zoneAt(c.feet)?.id === zone) ids.push(c.id);
      return ids;
    };
    bus.on('zone:captured', (e) => {
      this.scores.objective(inZone(e.zone, e.team), 'capture');
      this.bots?.replan('blue');
      this.bots?.replan('red');
    });
    bus.on('zone:neutralized', (e) => {
      this.scores.objective(inZone(e.zone, e.team === 'blue' ? 'red' : 'blue'), 'neutralize');
      this.bots?.replan('blue');
      this.bots?.replan('red');
    });
  }

  /** The person whose feet are at `p` (a footstep's spot). */
  private soldierAt(p: THREE.Vector3): Soldier | null {
    for (const s of this.soldiers.values()) if (s.deployed && s.player.feet.distanceToSquared(p) < 0.25) return s;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Soldiers

  /** A person joins: their soldier waits off the field until it deploys (in a room with bots, a bot makes way). */
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
    // Rounds flying past bots suppress them; shots are heard (a suppressed gun only close by).
    const bots = this.bots;
    if (bots) s.weapons.onRound = (from, to, hitId, pellet) => bots.nearMiss(from, to, team, hitId, pellet ? 0.35 : 1);
    this.soldiers.set(id, s);
    this.scores.add(id, name, team);
    this.joinSquad(s);
    return s;
  }

  /** Into a squad: in the place of a bot (the squad with the fewest people first), else the first with room, else a new one. */
  private joinSquad(s: Soldier): void {
    const team = s.team;
    const human = (m: SquadMember) => !(m instanceof Bot);
    let swap: { q: Squad; i: number } | null = null;
    for (const q of this.squads) {
      if (q.team !== team) continue;
      let i = q.members.length - 1;
      while (i >= 0 && !(q.members[i] instanceof Bot && !(q.members[i] as Bot).benched)) i--;
      if (i < 0) continue;
      if (!swap || q.members.filter(human).length < swap.q.members.filter(human).length) swap = { q, i };
    }
    if (swap && this.bots) {
      const bot = swap.q.members[swap.i] as Bot;
      this.bots.bench(bot);
      swap.q.members[swap.i] = s.combatant;
      this.syncBotSquads();
      this.onRoster();
      return;
    }
    let sq = this.squads.find((q) => q.team === team && q.members.length < SQUAD_SIZE);
    if (!sq) {
      let index = 0;
      while (this.squads.some((q) => q.team === team && q.index === index)) index++;
      sq = new Squad(index, team, squadName(index), []);
      this.squads.push(sq);
    }
    sq.members.push(s.combatant);
    this.syncBotSquads();
  }

  squadOf(id: number): Squad | undefined {
    return this.squads.find((q) => q.has(id));
  }

  /** 'blue:Alpha' (beacons, call-ins), or null. */
  squadKey(id: number): string | null {
    const q = this.squadOf(id);
    return q ? `${q.team}:${q.name}` : null;
  }

  /** A squad's RP: what its members earned, less what its leader spent. */
  squadRp(q: Squad): number {
    let earned = 0;
    for (const m of q.members) earned += this.scores.get(m.id)?.score ?? 0;
    return squadRp(earned, this.support.spent(`${q.team}:${q.name}`));
  }

  /**
   * A squad leader calls `kind` in onto `point` (aimed within reach). False
   * when not allowed: not the leader, not on the field, too far, too little
   * RP, the side's cooldown (the rocket tank comes to the zone nearest `point`).
   */
  callIn(id: number, kind: string, point: THREE.Vector3 | null): boolean {
    const s = this.soldiers.get(id);
    const q = this.squadOf(id);
    if (!s || !q || q.members[0]?.id !== id || !s.deployed || !s.alive || s.downed) return false;
    if (!(SUPPORT_ORDER as readonly string[]).includes(kind) || !point) return false;
    if (point.distanceTo(s.player.feet) > CALL_RANGE + 5) return false;
    const owner: GadgetOwner = { id, name: s.combatant.name, team: s.team, squad: `${q.team}:${q.name}` };
    if (!this.support.request(kind as SupportId, point, owner, this.squadRp(q), false)) return false;
    this.onCallIn(kind as SupportId, point, owner);
    return true;
  }

  /** A supply crate on the ground hands one of its side a refill when they need it. */
  private crateResupply(team: Team, pos: THREE.Vector3, reach: number): boolean {
    for (const s of this.soldiers.values()) {
      if (s.team !== team || !s.deployed || !s.alive || s.downed || s.player.feet.distanceTo(pos) > reach) continue;
      if (!needsStation(s, 'ammo') && (s.cls === 'medic' || s.medkits >= MEDKIT.carried)) continue;
      restockAmmo(s);
      if (s.cls !== 'medic') s.medkits = MEDKIT.carried;
      this.onGive(null, s, 'crate');
      return true;
    }
    for (const b of this.bots?.bots ?? []) {
      if (!b.alive || b.team !== team || b.feet.distanceTo(pos) > reach) continue;
      if (!b.needsGrenades && b.medkits >= MEDKIT.carried) continue;
      b.restockGrenades();
      if (b.cls !== 'medic') b.medkits = MEDKIT.carried;
      return true;
    }
    return false;
  }

  /** Someone left: their soldier and its bodies go (a benched bot takes the place back). */
  removeSoldier(id: number): void {
    const s = this.soldiers.get(id);
    if (!s) return;
    this.vehicles?.leave(s, false);
    s.dispose();
    this.soldiers.delete(id);
    this.poses.delete(id);
    const sq = this.squadOf(id);
    if (!sq) return;
    const i = sq.members.findIndex((m) => m.id === id);
    const back = this.bots?.bots.find((b) => b.benched && b.team === s.team);
    if (back && this.bots) {
      sq.members[i] = back;
      this.bots.unbench(back);
    } else {
      sq.members.splice(i, 1);
      if (!sq.members.length) this.squads.splice(this.squads.indexOf(sq), 1);
    }
    this.syncBotSquads();
    this.onRoster();
  }

  /**
   * Where to come out for a deploy key: 'base', 'zone:<id>', 'beacon:<id>'
   * (the squad's) or 'mate:<id>' (a squadmate who is up and not fighting).
   */
  spawnAt(team: Team, key: string, selfId: number): { pos: THREE.Vector3; yaw: number } {
    const [kind, ref] = key.split(':');
    const nav = this.bots?.nav ?? null;
    let at = this.zoneMode ? this.zoneMode.spawnPoint(team, kind === 'zone' ? ref! : 'base', nav) : this.base(team);
    const beacon = kind === 'beacon' ? this.gadgets.beaconsFor(team, this.squadKey(selfId)).find((b) => String(b.id) === ref) : undefined;
    if (beacon) {
      this.gadgets.useBeacon(beacon);
      at = { pos: nav?.randomAround(beacon.pos, 1.5) ?? beacon.pos.clone(), yaw: beacon.mesh.rotation.y };
    }
    const mate = kind === 'mate' ? this.squadOf(selfId)?.members.find((m) => String(m.id) === ref && m.id !== selfId) : undefined;
    if (mate && !mateSpawnBlock(mate, this.time, this.riding(mate.id))) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const back = new THREE.Vector3(Math.sin(mate.yaw), 0, Math.cos(mate.yaw)).multiplyScalar(2.2);
      const lateral = new THREE.Vector3(Math.cos(mate.yaw), 0, -Math.sin(mate.yaw)).multiplyScalar(side * 1.2);
      const want = mate.feet.clone().add(back).add(lateral);
      at = { pos: (nav && (nav.randomAround(want, 1.2) ?? nav.closest(want))) || want, yaw: mate.yaw };
    }
    return at;
  }

  /**
   * Deploys a soldier waiting off the field at `key` (see `spawnAt`) with
   * `kit`; null when it can't yet (still on the respawn wait, or on the field).
   */
  deploy(id: number, key = 'base', kit: Loadout = defaultLoadout('assault'), seed = (Math.random() * 2 ** 32) >>> 0): Deployed | null {
    const s = this.soldiers.get(id);
    if (!s || s.deployed || s.respawnTimer > 0 || this.winner) return null;
    const at = this.spawnAt(s.team, key, id);
    s.deployed = true;
    s.spawn(this.clearSpot(at.pos, s), at.yaw, kit);
    s.weapons.rand = seeded(seed);
    return { pos: s.player.feet.clone(), yaw: at.yaw, seed };
  }

  /**
   * A free spot within a few metres of `at`: ground under it, no wall in it,
   * nobody already standing there (soldiers stacked on one spawn point push
   * each other's capsules every step).
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
      for (const o of this.fighters()) if (o !== self.combatant && o.alive && o.feet.distanceToSquared(feet) < gap * gap) taken = true;
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

  /** One fixed step: every soldier with its input (none: standing still), the bots, the zone rules, the physics. */
  step(inputs: (id: number) => SoldierInput | null, dt = SIM_DT): void {
    this.beginStep(dt);
    for (const s of this.soldiers.values()) this.stepSoldier(s, inputs(s.id), dt);
    this.endStep(dt);
  }

  /** Starts a step: the clock moves. Then `stepSoldier` for each input, then `endStep`. */
  beginStep(dt = SIM_DT): void {
    this.time += dt;
    this.tick++;
    this.vehicles?.beginStep();
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
    // Down or dead in a vehicle: out of it.
    if (s.ride && (!s.alive || s.downed)) this.vehicles?.leave(s, false);
    if (s.alive && s.deployed && s.ride) this.vehicles!.stepRide(s, input, dt);
    else if (s.alive && s.deployed && s.chute) {
      if (s.stepChute(dt, input, this.physics)) s.weapons.drawTimer = 0.35;
      else s.weapons.step(dt, input, s.player, false);
    } else if (s.alive && s.deployed) {
      // In the order the browser predicts it (Game.netStep).
      s.stepTimers(dt);
      kitToggles(s, input, !!this.fort);
      stepGadget(s, input, dt, this.kit);
      if (s.buildMode || s.gadgetOut) {
        input.ads = false;
        input.reload = false;
      }
      if (input.medkit) s.useMedkit();
      s.stepMedkit(dt);
      const reviving = this.stepRevive(s, input.interact, dt);
      const gave = reviving ? null : stepGive(s, input, this.soldiers.values(), this.time, this.giveClock);
      if (gave) {
        this.scores.resupply(s.id);
        this.onGive(s, gave.mate, gave.kind);
      }
      // E by a vehicle (nobody to revive or hand something to): in.
      if (!reviving && !gave && input.interactPressed && this.vehicles?.tryEnter(s)) {
        consumePulses(input);
        return;
      }
      if (reviving || gave) s.working = -1;
      else stepFort(s, input, dt, this.kit);
      if (input.throwGrenade) {
        const owner: GrenadeOwner = { id: s.id, name: s.combatant.name, team: s.team };
        s.throwGrenade((type, origin, dir, carry) => this.throwables.throw(type, origin, dir, carry, owner));
      }
      const busy = s.throwBlock > 0 || s.medkitUse > 0 || reviving || s.working >= 0 || s.buildMode || s.gadgetOut;
      const shots = s.weapons.shots;
      s.stepOnFoot(dt, input, busy, this.fort?.slowAt(s.player.feet) ?? 1);
      if (s.weapons.shots !== shots) this.bots?.alert(s.player.feet, WEAPONS[s.weapons.def.id as WeaponId].suppressed ? 22 : 70, s.combatant);
      // The eye follows crouching as the browser's view does (shots start there).
      s.player.eyePosition(1, dt, this.eyeTmp);
    } else if (s.downed) s.stepDowned(dt, input.jumpHeld);
    else s.respawnTimer -= dt;
    consumePulses(input);
  }

  /** Ends a step: the bots, hitboxes, the zone rules, grenades and gadgets, the physics; poses are kept. */
  endStep(dt = SIM_DT): void {
    for (const s of this.soldiers.values()) s.syncBoxes();
    this.bots?.step(dt);
    this.fort?.step();
    this.zoneMode?.step(dt, [...this.fighters()]);
    this.throwables.step(dt);
    this.gadgets.step(dt, this.mineWalkers());
    this.support.step(dt);
    this.vehicles?.step(dt);
    this.physics.step();
    this.vehicles?.afterStep();
    for (const s of this.soldiers.values()) {
      const p = s.player;
      this.recordPose(s.id, p.feet, p.yaw, p.bodyHeight, s.deployed && p.alive && !s.downed && this.exposed(s));
    }
    for (const b of this.bots?.bots ?? []) if (!b.benched) this.recordPose(b.id, b.feet, b.yaw, b.bodyHeight, b.alive && !b.riding);
    for (let i = this.smokes.length - 1; i >= 0; i--) if (this.smokes[i]!.until < this.time) this.smokes.splice(i, 1);
  }

  /** Out in the open (on foot, under a canopy or in an open seat): bullets can find them. */
  private exposed(s: Soldier): boolean {
    const r = s.ride;
    return !r || r.v.spec.seats[r.seat]!.exposed;
  }

  private *mineWalkers(): Iterable<MineWalker> {
    for (const s of this.soldiers.values()) {
      if (!s.deployed || s.ride || s.chute) continue;
      const p = s.player;
      yield { id: s.id, team: s.team, alive: p.alive, downed: s.downed, feet: p.feet, velocity: p.velocity, eyeHeight: p.eyeHeight };
    }
    for (const b of this.bots?.bots ?? []) if (!b.benched) yield b;
  }

  /** A rocket striking someone: a kill (or down) for anyone but a teammate. */
  private rocketHit(target: Damageable, part: HitPart, point: THREE.Vector3, owner: GadgetOwner): void {
    if (target.team === owner.team || target.id < 0) return;
    const weapon = t('gadget.assault');
    const source: DamageSource = { pos: point.clone(), name: owner.name, team: owner.team, weapon, id: owner.id };
    const killed = target.applyDamage(ROCKET.directDamage, part, source, 'at');
    this.bus.emit('combat:hit', { targetId: target.id, part, damage: ROCKET.directDamage, killed, point: point.clone(), byPlayer: false, attackerId: owner.id });
    if (killed) this.reportKill(owner, target.id, target.name, target.team ?? null, weapon);
  }

  reportKill(owner: GrenadeOwner, victimId: number, victim: string, victimTeam: Team | null, weapon: string): void {
    this.bus.emit('combat:kill', { attacker: owner.name, victim, weapon, headshot: false, byPlayer: false, attackerTeam: owner.team, victimTeam, attackerId: owner.id, victimId });
  }

  // ---------------------------------------------------------------------------
  // Reviving and blasts

  /** The downed mate (person or bot) nearest `s` within reach, if any. */
  downedMateNear(s: Soldier): Soldier | Bot | null {
    let best: Soldier | Bot | null = null;
    let bestD = REVIVE_RANGE;
    for (const o of this.soldiers.values()) {
      if (o === s || o.team !== s.team || !o.downed || !o.deployed) continue;
      const d = o.player.feet.distanceTo(s.player.feet);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    for (const b of this.bots?.bots ?? []) {
      if (b.team !== s.team || !b.downed) continue;
      const d = b.feet.distanceTo(s.player.feet);
      if (d < bestD) {
        best = b;
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
      if (mate instanceof Bot) this.bots?.revivedByPlayer(mate, spec.reviveHealth, s.combatant.name, s.cls === 'medic', s.id);
      else {
        mate.revive(s.combatant.name, spec.reviveHealth);
        this.bus.emit('combatant:revived', { team: mate.team, id: mate.id, name: mate.combatant.name, byId: s.id, byName: s.combatant.name, medic: s.cls === 'medic' });
      }
      s.reviveOf = null;
      s.reviveProgress = 0;
    }
    return true;
  }

  /**
   * An explosion: soldiers and bots within reach take damage (less behind
   * cover), the thrower too, teammates not. Kills count like bullet kills.
   */
  blast(kind: BlastKind, point: THREE.Vector3, owner: GrenadeOwner, weapon: string): void {
    const spec = BLASTS[kind];
    // Fortifications in the blast take damage; a frag sets off mines and breaks beacons near it.
    this.fort?.blast(point, spec.radius, (d) => fragDamage(spec, d, false) * spec.fortMult);
    if (kind === 'frag') this.gadgets.blast(point, spec.radius * 0.6);
    else this.bots?.explosionAt(point);
    const source: DamageSource = { pos: point.clone(), name: owner.name, team: owner.team, weapon, id: owner.id };
    this.vehicles?.blast(kind, point, owner, (d) => fragDamage(spec, d, false), source);
    const probe = { x: point.x, y: point.y + 0.25, z: point.z };
    const hurt = (target: Damageable, chest: THREE.Vector3, self: boolean): boolean => {
      const dmg = fragDamage(spec, chest.distanceTo(point), this.physics.blocked(probe, chest, Layer.WORLD));
      if (dmg <= 0) return false;
      const killed = target.applyDamage(dmg, 'body', self ? undefined : source);
      if (self) return killed;
      this.bus.emit('combat:hit', { targetId: target.id, part: 'body', damage: dmg, killed, point: chest.clone(), byPlayer: false, attackerId: owner.id });
      if (killed) this.reportKill(owner, target.id, target.name, target.team ?? null, weapon);
      return killed;
    };
    for (const s of this.soldiers.values()) {
      if (!s.deployed || !s.alive || s.downed || !this.exposed(s)) continue;
      const self = s.id === owner.id;
      if (!self && s.team === owner.team) continue;
      const chest = this.v1.set(s.player.feet.x, s.player.feet.y + 1.1, s.player.feet.z);
      if (self) {
        const dmg = fragDamage(spec, chest.distanceTo(point), this.physics.blocked(probe, chest, Layer.WORLD));
        if (dmg > 0) s.damage(dmg, point, 'explosion');
      } else {
        // The damage indicator points at the blast.
        const dmg = fragDamage(spec, chest.distanceTo(point), this.physics.blocked(probe, chest, Layer.WORLD));
        if (dmg <= 0) continue;
        const killed = s.damage(dmg, point, 'explosion', source);
        this.bus.emit('combat:hit', { targetId: s.id, part: 'body', damage: dmg, killed, point: chest.clone(), byPlayer: false, attackerId: owner.id });
        if (killed) this.reportKill(owner, s.id, s.combatant.name, s.team, weapon);
      }
    }
    for (const b of this.bots?.bots ?? []) {
      if (!b.alive || b.team === owner.team) continue;
      hurt(b, this.v1.set(b.feet.x, b.feet.y + b.eyeHeight * 0.65, b.feet.z), false);
    }
  }

  /** A flashbang: bots looking at it are blinded a while (people's own browsers work out their flash). */
  private flashBots(point: THREE.Vector3): void {
    const spec = GRENADES.flash;
    const probe = { x: point.x, y: point.y + 0.25, z: point.z };
    for (const b of this.bots?.bots ?? []) {
      if (!b.alive) continue;
      const eye = b.eyePos(this.v1);
      const to = this.v2.copy(point).sub(eye);
      const dist = to.length();
      const facing = b.aimDir(new THREE.Vector3()).dot(to.normalize());
      const bi = flashIntensity(spec, dist, facing, this.physics.blocked(probe, eye, Layer.WORLD));
      if (bi > 0) b.blind(flashDuration(bi) * 0.8, this.bots!.time);
    }
  }

  // ---------------------------------------------------------------------------
  // Lag compensation

  private recordPose(id: number, feet: THREE.Vector3, yaw: number, height: number, hittable: boolean): void {
    let ring = this.poses.get(id);
    if (!ring) this.poses.set(id, (ring = []));
    const slot = this.tick % HISTORY;
    const pose = ring[slot] ?? (ring[slot] = { tick: -1, x: 0, y: 0, z: 0, yaw: 0, height: 0, hittable: false });
    pose.tick = this.tick;
    pose.x = feet.x;
    pose.y = feet.y;
    pose.z = feet.z;
    pose.yaw = yaw;
    pose.height = height;
    pose.hittable = hittable;
  }

  /** A soldier's or bot's pose at a (fractional) tick from the kept ones; null if not kept or not hittable then. */
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
  casterFor(shooter: number, viewTick: number, maxRewind: number): ShotCaster {
    const now = this.tick;
    const at = Math.max(now - maxRewind, Math.min(now, viewTick));
    return (eye, dir, maxDist) => {
      const wall = this.physics.raycast(eye, dir, maxDist, Layer.WORLD);
      let best = wall ? wall.distance : maxDist;
      let hit: { target: Damageable; part: HitPart } | null = null;
      const test = (id: number, target: Damageable) => {
        const pose = this.poseAt(id, at) ?? this.poseAt(id, now);
        if (!pose) return;
        const r = rayHitbox(pose, pose.yaw, pose.height, eye, dir, best);
        if (r && r.distance < best) {
          best = r.distance;
          hit = { target, part: r.part };
        }
      };
      // Vehicles as they are now: a hull is world geometry, an aircraft a hitbox only.
      const vw = this.vehicles?.world;
      if (vw) {
        const own = wall ? vw.byCollider(wall.collider.handle) : undefined;
        if (own) hit = { target: own, part: 'body' };
        const air = this.physics.raycast(eye, dir, best, Layer.HITBOX, undefined, undefined, (c) => !!vw.byCollider(c.handle)?.flight);
        if (air && air.distance < best) {
          best = air.distance;
          hit = { target: vw.byCollider(air.collider.handle)!, part: 'body' };
        }
      }
      // Only who is still up now can be hurt (going down or dying in between ends it).
      for (const o of this.soldiers.values()) if (o.id !== shooter && o.deployed && o.alive && !o.downed && this.exposed(o)) test(o.id, o.target);
      for (const b of this.bots?.bots ?? []) if (b.id !== shooter && b.alive && !b.benched && !b.riding) test(b.id, b);
      const h = hit as { target: Damageable; part: HitPart } | null;
      if (h) {
        const point = { x: eye.x + dir.x * best, y: eye.y + dir.y * best, z: eye.z + dir.z * best };
        return { distance: best, point, normal: { x: -dir.x, y: -dir.y, z: -dir.z }, handle: null, target: { owner: h.target, part: h.part } };
      }
      if (!wall) return null;
      return { distance: wall.distance, point: wall.point, normal: wall.normal, handle: wall.collider.handle, target: null };
    };
  }

  // ---------------------------------------------------------------------------
  // Bots run in people's browsers (`Bot.puppet`)

  /** When each such bot was last moved, fired (and the rounds it may still fire), threw or patched up (sim time). */
  private readonly puppetClock = new Map<number, { moved: number; shot: number; rounds: number; threw: number; healed: number }>();

  private clockOf(id: number) {
    let c = this.puppetClock.get(id);
    if (!c) this.puppetClock.set(id, (c = { moved: this.time, shot: this.time, rounds: 2, threw: -Infinity, healed: -Infinity }));
    return c;
  }

  /**
   * Where the browser running `bot` has it: the server's copy goes there
   * unless that is further than a sprint (and a fall) could take it since
   * the last time (false: refused, it stays).
   */
  puppetMove(bot: Bot, to: THREE.Vector3, yaw: number, aimYaw: number, aimPitch: number, crouch: boolean): boolean {
    if (!bot.puppet || !bot.alive || bot.riding) return true;
    const c = this.clockOf(bot.id);
    const dt = Math.max(SIM_DT, this.time - c.moved);
    const flat = Math.hypot(to.x - bot.feet.x, to.z - bot.feet.z);
    const rise = to.y - bot.feet.y;
    if (flat > MOVE.sprintSpeed * 1.6 * dt + 1.5 || rise > 3 * dt + 1.5 || rise < -(30 * dt + 3)) return false;
    bot.puppetTo(to, yaw, aimYaw, aimPitch, crouch, dt);
    c.moved = this.time;
    return true;
  }

  /**
   * A trigger pull by a bot a browser runs: judged where that browser saw
   * everyone (`viewTick`), with the bot's spread added here, no faster than
   * its gun fires.
   */
  puppetShot(bot: Bot, dir: THREE.Vector3, viewTick: number, maxRewind: number): void {
    if (!bot.puppet || !bot.alive || !this.bots || dir.lengthSq() < 0.5) return;
    // Rounds come a frame's worth at a time: a small allowance that refills at the gun's rate.
    const c = this.clockOf(bot.id);
    const rpm = bot.def.rpm ?? 600;
    c.rounds = Math.min(3, c.rounds + ((this.time - c.shot) * rpm) / 60 / 0.9);
    c.shot = this.time;
    if (c.rounds < 1) return;
    c.rounds -= 1;
    this.bots.fire(bot, dir.clone().normalize(), this.casterFor(bot.id, viewTick, maxRewind));
  }

  /** A grenade thrown by a bot a browser runs (from about its eye, not too hard, not too often). */
  puppetThrow(bot: Bot, type: 'frag' | 'flash' | 'smoke', origin: THREE.Vector3, vel: THREE.Vector3): void {
    if (!bot.puppet || !bot.alive) return;
    const c = this.clockOf(bot.id);
    if (this.time - c.threw < 2 || origin.distanceTo(bot.eyePos(this.v1)) > 2.5 || vel.length() > 45) return;
    c.threw = this.time;
    this.throwables.launch(type, origin, vel, { id: bot.id, name: bot.name, team: bot.team });
  }

  /** A bot a browser runs revived `target` (a person or a bot down within reach). */
  puppetRevive(bot: Bot, target: number): void {
    if (!bot.puppet || !bot.alive || !this.bots) return;
    const person = this.soldiers.get(target);
    const who = person?.deployed ? person.combatant : this.bots.bots.find((b) => b.id === target);
    if (!who || who.team !== bot.team || !who.downed || who.feet.distanceTo(bot.feet) > REVIVE_RANGE + 1.5) return;
    this.bots.revive(bot, who);
  }

  /** A bot a browser runs patched itself up. */
  puppetMedkit(bot: Bot): void {
    if (!bot.puppet || !bot.alive) return;
    const c = this.clockOf(bot.id);
    if (this.time - c.healed < 4 || (bot.cls !== 'medic' && bot.medkits <= 0)) return;
    c.healed = this.time;
    bot.health.value = 100;
    if (bot.cls !== 'medic') bot.medkits--;
  }

  /** Back to the server's own running (the browser let it go, or it went down, died or got in a vehicle). */
  unpuppet(bot: Bot): void {
    bot.puppet = false;
    this.puppetClock.delete(bot.id);
  }

  dispose(): void {
    this.physics.dispose();
  }
}
