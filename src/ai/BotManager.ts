import * as THREE from 'three';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { SurfaceRegistry } from '@/physics/surfaces';
import type { GameBus } from '@/core/events';
import { computeDamage, type DamageSource, type HitboxRegistry } from '@/combat/Hitboxes';
import type { AudioSystem } from '@/audio/AudioSystem';
import type { Effects } from '@/render/Effects';
import { LAYER_FX } from '@/render/layers';
import type { SpawnPoint, Team } from '@/world/mapTypes';
import { WEAPONS, damageAtDistance, type WeaponDef } from '@/weapons/weaponData';
import { Bot, type BotServices } from './Bot';
import type { NavWorld, VehicleNav } from './NavWorld';
import { SKILLS, type BotSkill, type Difficulty } from './difficulty';
import { SoldierModel, buildFarSoldier } from './SoldierModel';
import { HumanModel, farHuman, soldierPack } from './HumanModel';

/** The packed character when it loaded, else the procedural soldier. */
function makeModel(team: Team, def: WeaponDef): SoldierModel | HumanModel {
  return soldierPack() ? new HumanModel(team, def) : new SoldierModel(team, def);
}
import { BOT_WEAPONS, botClass, rollPersonality, weaponFor } from './personality';
import { lobVelocity } from './ballistics';
import type { Throwables } from '@/weapons/Throwables';
import { PLAYER_ID, PLAYER_TEAM, otherTeam, type Combatant } from './types';
import { CLASSES, GIVE_RANGE, MEDKIT } from '@/data/classes';
import type { WaterMap } from '@/world/water';
import { REFILL_POINTS, STATION, canRefill, type FortJob, type FortSlot, type Fortifications } from '@/modes/fortify';
import type { GadgetWorld } from '@/modes/gadgetWorld';
import { RIFLE_SMOKE, ROCKET } from '@/data/gadgets';
import { SUPPORT, type SupportId } from '@/data/support';
import type { Danger } from '@/modes/supportWorld';
import type { VehicleWorld } from '@/vehicles/VehicleWorld';
import { Vehicle as VehicleAir, type Vehicle, type DriveInput } from '@/vehicles/Vehicle';

/** Objectives farther than this send bots looking for a ride; they get out this close to it (m). */
const VEHICLE_TRIP = 110;
const VEHICLE_DROP = 30;
const STEP = 1 / 60;
const DOWN = new THREE.Vector3(0, -1, 0);

/** Call-ins as the bots see them (squad RP, team cooldowns, calling one in, shells on their way). */
export interface BotSupport {
  rp(bot: Bot): number;
  cooldown(team: Team, kind: SupportId): number;
  call(kind: SupportId, point: THREE.Vector3, bot: Bot): boolean;
  dangers(): Danger[];
}

const DEG = Math.PI / 180;
const RESPAWN_SEC = 5;
/** Bots' bullets do a bit less than the player's at lower difficulties. */
const DAMAGE_SCALE: Record<Difficulty, number> = { easy: 0.55, normal: 0.75, hard: 0.95 };
/** How far gunfire and footsteps carry for bots (meters). */
const HEAR_SHOT = 70;
/** Footsteps are heard this far (m): walking, running. Crouch-walking makes none. */
export const HEAR_STEP = 8;
export const HEAR_STEP_SPRINT = 14;
/**
 * Bots closer than this push apart (meters), at up to SEPARATION_SPEED m/s.
 * Two bots standing still only once they overlap (capsules touch at 0.7 m):
 * shoving each other off their spots made groups jostle forever.
 */
const SEPARATION_RADIUS = 0.95;
const SEPARATION_STANDING = 0.7;
const SEPARATION_SPEED = 1.9;
/** A walking bot steps around someone up to this far ahead (m) and this far off its line (m). */
const AVOID_AHEAD = 2;
const AVOID_WIDTH = 0.85;
/** Moving faster than this (m/s) counts as walking for giving way. */
const MOVING = 0.3;
/** Someone standing this close to a bot's destination has it taken (m): stop beside them. */
const SPOT_TAKEN = 0.75;
const BLOB_SIZE = 1.1;
/** Cover searches allowed per sim step across all bots (each is ~0.1-0.3 ms). */
const squadKey = (team: Team, squad: number): string => `${team}:${squad}`;
/** Neighbour grid cell (m); at least the separation radius. */
const CELL = 2;
const cellKey = (x: number, z: number): number => (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(z / CELL) + 32768);
/** How long one pair's line-of-sight result is reused by the other side. */
const SIGHT_SHARE_SEC = 0.09;
const SIGHT_SHARE_FAR_SEC = 0.25;
/** Beyond this distance from the viewer (and out of combat) bots move at half rate. */
const FAR_SQ = 60 * 60;
/**
 * Update level of detail: bots this far (m) from the viewer think and move
 * every 2nd / 3rd step (with the time they skipped), unless they are in a
 * vehicle; their capsules (only the player bumps into them) update within
 * CAPSULE_RANGE.
 */
const LOD_MID_SQ = 90 * 90;
const LOD_FAR_SQ = 160 * 160;
const CAPSULE_RANGE_SQ = 45 * 45;
/**
 * Render level of detail: beyond this distance (m) a bot is drawn as part of
 * its side's instanced far model instead of its skinned one; ally markers
 * further than MARKER_RANGE only show for squad mates and the downed.
 */
const FAR_MODEL = 70;
const MARKER_RANGE = 160;
const COVER_SEARCHES_PER_STEP = 3;
/** A round passing within this distance of a bot's head suppresses it (m). */
const NEAR_MISS = 2.5;
/** Suppression added by one rifle round passing right by (less for pellets, further away). */
const NEAR_MISS_AMOUNT = 0.22;
/** Frag blasts suppress everyone within this radius (m). */
const BLAST_SUPPRESS = 14;
/**
 * Bot drivers: aim this far down the route (m, plus 0.7 s of speed), stuck
 * after this long pushing at under 0.8 m/s, back up this long (plus 0.3 s a
 * try), give up after this many tries in a row, and getting this far from
 * the last stuck spot clears the count; wait at most `yield` s for a vehicle ahead.
 */
const DRIVE = { look: 6, stuck: 1.8, back: 1.3, giveUp: 7, clear: 15, yield: 4 };
/** Mates within this distance of a killed bot learn where the killer was. */
const KILL_INTEL_RANGE = 35;
/** Enemies noticed by a bot stay on the team's minimap this long (s). */
const SPOT_SEC = 2.5;
/** Enemies firing within this range of the player show up on the minimap (m). */
const SPOT_FIRING_RANGE = 60;
/** Wading this far (m) or more makes a bot consider a bridge instead. */
const WADE_MIN = 5;
/** A bridge is taken when it adds at most this much walking (m); rushers accept less. */
const BRIDGE_DETOUR = 90;
/** A bot on a bridge (within this many metres of its middle) makes it this much "longer" for route picking. */
const BRIDGE_CROWD_RADIUS = 25;
const BRIDGE_CROWD = 12;
/** Foliage grid cell (m) and sampling step along a sight line (m). */
const LEAF_CELL = 3;
const LEAF_STEP = 2;
/** Foliage per unit of tree scale in a cell, per sample. */
const LEAF_WEIGHT = 0.25;
const COVER_SAMPLES = 10;

const NAMES: Record<Team, string[]> = {
  blue: ['Hawk', 'Bishop', 'Rook', 'Nomad', 'Sparrow', 'Atlas', 'Echo', 'Kodiak', 'Falcon', 'Ranger', 'Bear', 'Moose', 'Otter', 'Badger', 'Heron', 'Lynx', 'Maple', 'Cedar', 'Granite', 'Harbor', 'Beacon', 'Anchor', 'Summit', 'Glacier'],
  red: ['Viper', 'Jackal', 'Cobra', 'Wraith', 'Mako', 'Talon', 'Scorpion', 'Raven', 'Hyena', 'Adder', 'Vulture', 'Shrike', 'Mamba', 'Barracuda', 'Warden', 'Specter', 'Cinder', 'Onyx', 'Havoc', 'Rogue', 'Vandal', 'Reaper', 'Ember', 'Dagger'],
};

/** The i-th bot's name on a team: unique, numbered once the list runs out. */
function botName(team: Team, i: number): string {
  const list = NAMES[team];
  const base = list[i % list.length]!;
  return i < list.length ? base : `${base} ${Math.floor(i / list.length) + 1}`;
}

export interface BotOptions {
  allies: number;
  enemies: number;
  difficulty: Difficulty;
}

/** A place for a squad to go: take it, or (defend) guard it facing `front`. */
export interface BotObjective {
  pos: THREE.Vector3;
  radius: number;
  defend?: boolean;
  /** Held by the side and quiet: worth a guard squad when there are squads to spare. */
  guard?: boolean;
  /** Unit direction attacks come from. */
  front?: THREE.Vector3;
}

/** Game-mode hooks: where squads go and where bots respawn. */
export interface BotModeHooks {
  /** Places worth going for, best first (empty = push toward the enemy base). */
  objectives(team: Team): BotObjective[];
  /** Respawn position for a bot (given the squad objective it is assigned to). */
  spawnAt(bot: Bot, objective: THREE.Vector3 | null): { pos: THREE.Vector3; yaw: number };
  /** A bot revived the downed player. */
  revivePlayer?(by: Bot, health: number): void;
}

/** A squad as the bots see it: members and, for the player's squad, the leader to follow. */
export interface BotSquad {
  index: number;
  botIds: number[];
  leader: Combatant | null;
}

/** A window to fight from, and who has claimed it. */
interface Post {
  pos: THREE.Vector3;
  facing: THREE.Vector3;
  owner: Bot | null;
}

interface Footprint {
  x: number;
  z: number;
  cos: number;
  sin: number;
  hw: number;
  hd: number;
}

/** A squad's current fight: where, since when, last seen. */
interface SquadContact {
  pos: THREE.Vector3;
  since: number;
  last: number;
}

interface TeamState {
  objective: THREE.Vector3;
  planAt: number;
  /** Squad -> the objective (zone centre) it was sent to last plan; kept while that one still wants a squad. */
  assigned: Map<number, THREE.Vector3>;
  sighting: { pos: THREE.Vector3; time: number } | null;
  base: THREE.Vector3;
  spawns: SpawnPoint[];
  kills: number;
}

interface BotEntry {
  bot: Bot;
  model: SoldierModel | HumanModel;
  marker: THREE.Sprite | null;
  /** Stable offset around the squad objective, re-rolled each plan. */
  offset: THREE.Vector3;
  /** Flankers swing around the side of a fight the squad is in. */
  role: 'assault' | 'flank';
  flankSide: number;
  wasAlive: boolean;
  /** Alive / dead for good at the end of the last sim step (for down and death events). */
  simAlive: boolean;
  simDead: boolean;
  /** Mode objective this bot is assigned to, if any. */
  objective: BotObjective | null;
  /** Flank run in progress, and the contact (its start time) it was for. */
  flankGoal: THREE.Vector3 | null;
  flankFor: number;
  /** Walking to a vehicle seat (claimed until `until`). */
  board: { vehicle: number; seat: number; until: number } | null;
  /** Driving: the path being followed and stuck handling. */
  drive: { path: THREE.Vector3[]; at: number; repathAt: number; waitUntil: number; stuckFor: number; backUntil: number; tries: number; backSteer?: number; stuckAt?: THREE.Vector3; yieldSince?: number } | null;
  /** Riding without a driver since (gunners hold on a little). */
  alone?: number;
  /** Bot pilots: what they're going after, and a pull-up after an attack run. */
  flightPlan?: { target: Vehicle | Combatant | null; kind: 'air' | 'ground' | 'none'; until: number; pullUntil: number };
  /** Direction to watch when idle at a guard post or around the leader. */
  watch: THREE.Vector3 | null;
  /** Window this bot holds (marksmen and anchors near their objective). */
  post: Post | null;
  squad: number;
  /** Squad leader to stay close to (the player's squad), else null. */
  leader: Combatant | null;
  /** Slot in the leader's formation (1..). */
  slot: number;
  /** Detour on the way to the objective (the squad's approach route), cleared once passed. */
  via: THREE.Vector3 | null;
}

/** A weapon of the bot's class that suits its fighting style (re-rolled every life). */
function loadout(bot: Bot): WeaponDef {
  return WEAPONS[weaponFor(bot.cls, bot.personality)];
}

/**
 * Owns the bots of both teams: spawning, the shared world services they use
 * (line of sight, cover search, squad objectives, shot resolution) and the
 * render-side models.
 */
export class BotManager implements BotServices {
  time = 0;
  readonly skill: BotSkill;
  private readonly entries: BotEntry[] = [];
  private readonly byBot = new Map<Combatant, BotEntry>();
  private readonly teams: Record<Team, TeamState>;
  private readonly damageScale: number;
  private readonly listener = new THREE.Vector3();
  private readonly enemies: Record<Team, Combatant[]> = { blue: [], red: [] };
  private readonly grid = new Map<number, Bot[]>();
  private readonly contacts = new Map<string, SquadContact>();
  private leaves: { data: Float32Array; cols: number; rows: number; x0: number; z0: number } | null = null;
  private water: WaterMap | null = null;
  private posts: Post[] = [];
  private footprints: Footprint[] = [];
  private readonly sightCache = new Map<number, { time: number; visible: boolean }>();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private markerMaterials = new Map<string, THREE.SpriteMaterial>();
  /** Soft contact shadows under every bot, one draw call. */
  private readonly blobs: THREE.InstancedMesh;
  private readonly blobMatrix = new THREE.Matrix4();
  private coverBudget = 0;
  /** Downed soldier id -> the bot going to revive them. */
  private readonly revivers = new Map<number, { bot: Bot; target: Combatant }>();
  private downMaterial: THREE.SpriteMaterial | null = null;
  /** Medic id * 4096 + receiver id -> time the medic may hand that soldier another kit. */
  private readonly kitGiven = new Map<number, number>();
  /** Set by the game mode (Zone): squad objectives and respawn points. */
  hooks: BotModeHooks | null = null;
  /** Set by the game (zone mode): stations and build spots, who holds a zone, and whether someone stands where a build goes. */
  fort: Fortifications | null = null;
  zoneOwner: ((zone: string) => Team | null) | null = null;
  fortBlocked: ((slot: FortSlot) => boolean) | null = null;
  /** Class gadgets in the world, and each bot's squad key (for beacons); set by the game. */
  gadgets: GadgetWorld | null = null;
  squadKey: ((bot: Bot) => string | null) | null = null;
  /** Squad call-ins (bot squad leaders use them), or null. */
  support: BotSupport | null = null;
  private supportAt: Record<Team, number> = { blue: 5, red: 5 };
  /** Squad key -> sim time its leader may call again. */
  private readonly squadCallAt = new Map<string, number>();
  /** Vehicles, the drive inputs the game hands to them this step, and helpers from the game. */
  vehicles: VehicleWorld | null = null;
  /** Where hulls fit (see VehicleNav); drivers fall back to the people's mesh without it. */
  vehicleNav: VehicleNav | null = null;
  driveInputs = new Map<number, DriveInput>();
  playerRiding: (() => boolean) | null = null;
  /** Fires one round from a vehicle's seat gun at a point (the game's shared vehicle gun code). */
  fireMount: ((v: Vehicle, seat: number, shooter: { id: number; name: string; team: Team }, aim: THREE.Vector3 | null, alt?: boolean) => void) | null = null;
  private vehicleCheckAt = 0;
  /** Job key -> the bot doing it. */
  private readonly workers = new Map<string, Bot>();
  /** Set by the game: where bot grenades go. */
  grenades: Throwables | null = null;
  /** A team throws at most one grenade per this many seconds. */
  private readonly grenadeAt: Record<Team, number> = { blue: 0, red: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    readonly physics: PhysicsWorld,
    readonly nav: NavWorld,
    private readonly registry: HitboxRegistry,
    private readonly surfaces: SurfaceRegistry,
    private readonly bus: GameBus,
    private readonly audio: AudioSystem,
    private readonly effects: Effects,
    private readonly player: Combatant,
    spawns: SpawnPoint[],
    opts: BotOptions,
  ) {
    this.skill = SKILLS[opts.difficulty];
    this.damageScale = DAMAGE_SCALE[opts.difficulty];
    const teamState = (team: Team): TeamState => {
      const own = spawns.filter((s) => s.team === team || (team === PLAYER_TEAM && s.team === 'player'));
      const base = own.length
        ? own.reduce((a, s) => a.add(new THREE.Vector3(...s.pos)), new THREE.Vector3()).divideScalar(own.length)
        : new THREE.Vector3(0, 0, team === 'blue' ? 40 : -40);
      return { objective: base.clone(), planAt: 0, assigned: new Map(), sighting: null, base, spawns: own, kills: 0 };
    };
    this.teams = { blue: teamState('blue'), red: teamState('red') };
    // Build every soldier + weapon mesh now rather than hitching on first respawn.
    if (!soldierPack()) SoldierModel.prewarm(['blue', 'red'], BOT_WEAPONS.map((id) => WEAPONS[id]));

    const add = (team: Team, n: number) => {
      for (let i = 0; i < n; i++) {
        // The player's own squad has them in the first slot: allies are counted from 1.
        const cls = botClass(team === PLAYER_TEAM ? i + 1 : i);
        const style = rollPersonality(Math.random, cls);
        const bot = new Bot(botName(team, i), team, WEAPONS[weaponFor(cls, style)], physics, registry, cls, style);
        this.respawn(bot);
        const model = makeModel(team, bot.def);
        scene.add(model.root);
        const marker = team === PLAYER_TEAM ? this.makeMarker('#4d8cff') : null;
        if (marker) scene.add(marker);
        this.entries.push({
          bot,
          model,
          marker,
          offset: new THREE.Vector3(),
          role: i % 3 === 2 ? 'flank' : 'assault',
          flankSide: i % 2 ? 1 : -1,
          wasAlive: true,
          simAlive: true,
          simDead: false,
          objective: null,
          squad: -1,
          leader: null,
          slot: 0,
          board: null,
          drive: null,
          via: null,
          flankGoal: null,
          flankFor: -1,
          watch: null,
          post: null,
        });
        this.byBot.set(bot, this.entries[this.entries.length - 1]!);
      }
    };
    add(PLAYER_TEAM, opts.allies);
    add(otherTeam(PLAYER_TEAM), opts.enemies);
    this.blobs = this.makeBlobs(this.entries.length);
    scene.add(this.blobs);
    this.markers = this.makeMarkerPoints(this.entries.length, false);
    this.crosses = this.makeMarkerPoints(this.entries.length, true);
    scene.add(this.markers, this.crosses);
    const human = soldierPack();
    const farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    for (const team of ['blue', 'red'] as const) {
      // The packed character frozen standing (aiming) and mid-stride; else the box soldier.
      const poses: [THREE.BufferGeometry, THREE.Material][] = human
        ? [
            [farHuman(human, 'aim', WEAPONS.ar1), human.materials[team]],
            [farHuman(human, 'run_f', WEAPONS.ar1), human.materials[team]],
          ]
        : [[buildFarSoldier(team), farMat]];
      this.far[team] = poses.map(([geo, mat]) => {
        const m = new THREE.InstancedMesh(geo, mat, Math.max(1, this.entries.length));
        m.count = 0;
        m.frustumCulled = false;
        scene.add(m);
        return m;
      });
    }

    bus.on('combat:kill', (e) => {
      if (e.attackerTeam && e.attackerTeam !== e.victimTeam) this.teams[e.attackerTeam].kills++;
    });
    // Explosions nearby rattle everyone (either side), frags more than the rest.
    bus.on('grenade:detonate', (e) => {
      if (e.type === 'frag') this.explosionAt(e.point);
    });
  }

  /** A blast (frag, rocket, mine): everyone nearby is rattled. */
  explosionAt(point: THREE.Vector3): void {
    for (const en of this.entries) {
      const b = en.bot;
      const d = b.feet.distanceTo(point);
      if (b.alive && d < BLAST_SUPPRESS) b.suppress(0.9 * (1 - d / BLAST_SUPPRESS), point, this.time);
    }
  }

  private entryOf(bot: Bot): BotEntry {
    return this.byBot.get(bot)!;
  }

  get bots(): readonly Bot[] {
    return this.entries.map((e) => e.bot);
  }

  score(team: Team): number {
    return this.teams[team].kills;
  }

  // ---------------------------------------------------------------------------
  // Simulation

  step(dt: number): void {
    this.time += dt;
    this.coverBudget = COVER_SEARCHES_PER_STEP;
    for (const team of ['blue', 'red'] as const) this.plan(team);
    this.index();
    this.indexSeats();
    this.dodgeGrenades();
    this.dodgeShells();
    for (const team of ['blue', 'red'] as const) this.considerSupport(team);
    this.considerVehicles();
    this.stepCount++;
    for (const e of this.entries) {
      const b = e.bot;
      const d2 = b.feet.distanceToSquared(this.listener);
      b.far = d2 > FAR_SQ && !b.inCombat(this.time);
      const near = d2 < CAPSULE_RANGE_SQ;
      if (near && !b.nearViewer) b.syncCapsule();
      b.nearViewer = near;
      const every = b.riding ? 1 : d2 > LOD_FAR_SQ ? 3 : d2 > LOD_MID_SQ ? 2 : 1;
      b.lodDt += dt;
      if (every === 1 || (this.stepCount + b.id) % every === 0) {
        b.step(b.lodDt, this);
        b.lodDt = 0;
      }
      if (e.simAlive && !b.alive) {
        // Down: out of the fight (the kill was reported when the shot landed), and out of any vehicle.
        this.alightBot(e);
        this.release(e);
        this.shareKill(b);
        this.releaseRevive(b);
        this.releaseWork(b);
      }
      if (!e.simDead && b.dead) this.bus.emit('combatant:died', { team: b.team, id: b.id });
      if (b.dead && b.deadTime > RESPAWN_SEC + b.respawnPenalty) this.respawn(b);
      e.simAlive = b.alive;
      e.simDead = b.dead;
    }
    for (const [id, r] of this.revivers) if (!r.target.downed || !r.bot.alive || r.bot.reviveOf !== r.target) this.revivers.delete(id);
    this.shareMedkits();
  }

  /** Medics hand a medkit to teammates next to them who have used theirs (twice a second, per pair on a cooldown). */
  private shareMedkits(): void {
    if (Math.floor(this.time * 2) === Math.floor((this.time - 1 / 60) * 2)) return;
    for (const m of this.entries) {
      const medic = m.bot;
      if (medic.cls !== 'medic' || !medic.alive || medic.target) continue;
      for (const o of this.entries) {
        const b = o.bot;
        if (b === medic || b.team !== medic.team || !b.alive || b.medkits > 0 || b.feet.distanceTo(medic.feet) > GIVE_RANGE) continue;
        const key = medic.id * 4096 + b.id;
        if ((this.kitGiven.get(key) ?? -Infinity) > this.time) continue;
        b.medkits = MEDKIT.carried;
        this.kitGiven.set(key, this.time + MEDKIT.giveCooldown);
        this.bus.emit('combatant:resupplied', { byId: medic.id, id: b.id });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Reviving

  claimRevive(bot: Bot, radius: number): Combatant | null {
    let best: Combatant | null = null;
    let bestD = radius;
    const consider = (c: Combatant) => {
      if (c === bot || c.team !== bot.team || !c.downed) return;
      const taken = this.revivers.get(c.id);
      if (taken && taken.bot !== bot) return;
      const d = c.feet.distanceTo(bot.feet);
      // Don't walk into a crossfire for it.
      if (d >= bestD || this.enemiesNear(bot.team, c.feet, 12) > 0) return;
      best = c;
      bestD = d;
    };
    for (const e of this.entries) consider(e.bot);
    consider(this.player);
    if (best) this.revivers.set((best as Combatant).id, { bot, target: best });
    return best;
  }

  releaseRevive(bot: Bot): void {
    for (const [id, r] of this.revivers) if (r.bot === bot) this.revivers.delete(id);
  }

  reviverFor(c: Combatant): Bot | null {
    return this.revivers.get(c.id)?.bot ?? null;
  }

  revive(bot: Bot, c: Combatant): void {
    if (!c.downed) return;
    const health = CLASSES[bot.cls].reviveHealth;
    if (c.id === PLAYER_ID) this.hooks?.revivePlayer?.(bot, health);
    else (c as Bot).revive(health, this.time);
    this.bus.emit('combatant:revived', { team: c.team, id: c.id, name: c.name, byId: bot.id, byName: bot.name, medic: bot.cls === 'medic' });
  }

  // ---------------------------------------------------------------------------
  // Zone jobs

  claimWork(bot: Bot, radius: number): { job: FortJob; stand: THREE.Vector3; look: THREE.Vector3 } | null {
    const fort = this.fort;
    const owner = this.zoneOwner;
    if (!fort || !owner) return null;
    const goal = this.entryOf(bot).objective;
    // Only a few per side at a time: the rest keep fighting.
    let busy = 0;
    for (const b of this.workers.values()) if (b.team === bot.team && b !== bot) busy++;
    if (busy >= 4) return null;
    let best: { key: string; job: FortJob; stand: THREE.Vector3; look: THREE.Vector3 } | null = null;
    let bestScore = Infinity;
    const consider = (key: string, job: FortJob, stand: THREE.Vector3, look: THREE.Vector3, weight: number) => {
      const taken = this.workers.get(key);
      if (taken && taken !== bot) return;
      const d = stand.distanceTo(bot.feet);
      if (d > radius || d * weight >= bestScore) return;
      if (this.enemiesNear(bot.team, stand, 22) > 0) return;
      best = { key, job, stand, look };
      bestScore = d * weight;
    };
    for (const st of fort.stations) {
      if (owner(st.zone) !== bot.team) continue;
      const stand = fort.stationStand(st);
      const look = st.pos.clone().setY(st.pos.y + 0.5);
      const need = st.kind === 'ammo' ? bot.needsGrenades : bot.cls !== 'medic' && bot.medkits === 0;
      if (need && st.uses > 0) consider(`use:${st.id}:${bot.id}`, { type: 'use', station: st }, stand, look, 0.6);
      // Restocking is worth a detour only for a guard at that zone or someone passing close by.
      const near = goal?.defend ? goal.pos.distanceTo(st.pos) < goal.radius + 12 : stand.distanceTo(bot.feet) < 15;
      if (near && canRefill(st.kind, bot.cls) && st.uses < STATION.uses) consider(`refill:${st.id}`, { type: 'refill', station: st }, stand, look, 0.7);
    }
    // Building at zones their side holds: guards anywhere around their zone,
    // anyone else only right by it (a bot that just helped take it, passing through).
    for (const sl of fort.slots) {
      if (sl.built || owner(sl.zone) !== bot.team) continue;
      if (goal?.defend ? goal.pos.distanceTo(sl.pos) > goal.radius + 14 : sl.stand.distanceTo(bot.feet) > 18) continue;
      const look = sl.kind === 'barricade' ? sl.pos : sl.pos.clone().setY(sl.pos.y + 0.3);
      // Anti-tank hedgehogs matter little until there are vehicles.
      consider(`build:${sl.id}`, { type: 'build', slot: sl }, sl.stand, look, sl.kind === 'hedgehog' ? 2.5 : sl.kind === 'wire' ? 1.8 : bot.cls === 'support' ? 0.8 : 1);
    }
    const found = best as { key: string; job: FortJob; stand: THREE.Vector3; look: THREE.Vector3 } | null;
    if (!found) return null;
    this.releaseWork(bot);
    this.workers.set(found.key, bot);
    return { job: found.job, stand: found.stand, look: found.look };
  }

  slowAt(p: THREE.Vector3): number {
    return this.fort?.slowAt(p) ?? 1;
  }

  releaseWork(bot: Bot): void {
    for (const [key, b] of this.workers) if (b === bot) this.workers.delete(key);
  }

  doWork(bot: Bot, job: FortJob, dt: number): boolean {
    const fort = this.fort;
    if (!fort) return false;
    if (job.type === 'build') {
      if (job.slot.built) return false;
      const r = fort.work(job.slot, dt, bot.cls, this.fortBlocked ?? (() => false));
      fort.onPoints?.(bot.id, r.points);
      return !r.done;
    }
    const st = job.station;
    if (this.zoneOwner?.(st.zone) !== bot.team) return false;
    if (job.type === 'use') {
      if (fort.use(st)) {
        if (st.kind === 'ammo') bot.restockGrenades();
        else bot.medkits = MEDKIT.carried;
      }
      return false;
    }
    if (st.uses >= STATION.uses) return false;
    if (fort.refill(st, dt)) fort.onPoints?.(bot.id, REFILL_POINTS);
    return st.uses < STATION.uses;
  }

  /** The player revived a bot. */
  revivedByPlayer(b: Bot, health: number, byName: string, medic: boolean): void {
    if (!b.downed) return;
    this.releaseRevive(b);
    b.revive(health, this.time);
    this.bus.emit('combatant:revived', { team: b.team, id: b.id, name: b.name, byId: PLAYER_ID, byName, medic });
  }

  /** Mates near a fallen bot learn where the fatal shot came from. */
  private shareKill(victim: Bot): void {
    const killer = victim.killerPos;
    if (!killer) return;
    const r2 = KILL_INTEL_RANGE * KILL_INTEL_RANGE;
    for (const e of this.entries) {
      const b = e.bot;
      if (b !== victim && b.team === victim.team && b.alive && b.feet.distanceToSquared(victim.feet) < r2) b.mateKilled(killer, this.time);
    }
  }

  /**
   * A round flew from `from` to `to` (the shooter's team is `team`): bots of
   * the other side it passed close to are suppressed. `hitId` is who it hit
   * (already hurt, not counted twice). `weight` scales pellets down.
   */
  nearMiss(from: THREE.Vector3, to: THREE.Vector3, team: Team, hitId: number, weight = 1): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1) return;
    for (const e of this.entries) {
      const b = e.bot;
      if (!b.alive || b.team === team || b.id === hitId) continue;
      const hx = b.feet.x - from.x;
      const hy = b.feet.y + 1.4 - from.y;
      const hz = b.feet.z - from.z;
      const t = (hx * dx + hy * dy + hz * dz) / len2;
      // Behind the muzzle, or the round stopped well short of the bot.
      if (t < 0.02 || t > 1.05) continue;
      const d = Math.hypot(hx - dx * t, hy - dy * t, hz - dz * t);
      if (d < NEAR_MISS) b.suppress(NEAR_MISS_AMOUNT * weight * (1 - d / NEAR_MISS), from, this.time);
    }
  }

  /** Trees in the playable area ([x, z, scale]): tree crowns hide people at range. */
  setForest(trees: readonly (readonly [number, number, number])[], size: readonly [number, number]): void {
    if (!trees.length) return;
    const cols = Math.ceil(size[0] / LEAF_CELL);
    const rows = Math.ceil(size[1] / LEAF_CELL);
    const x0 = -size[0] / 2;
    const z0 = -size[1] / 2;
    const data = new Float32Array(cols * rows);
    for (const [x, z, s] of trees) {
      const c = Math.floor((x - x0) / LEAF_CELL);
      const r = Math.floor((z - z0) / LEAF_CELL);
      if (c >= 0 && r >= 0 && c < cols && r < rows) data[r * cols + c]! += s;
    }
    this.leaves = { data, cols, rows, x0, z0 };
  }

  setWater(water: WaterMap): void {
    this.water = water.any ? water : null;
  }

  foliage(from: THREE.Vector3, to: THREE.Vector3): number {
    const g = this.leaves;
    if (!g) return 0;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    // The trees right next to either end don't hide anything (you look past them).
    const n = Math.floor((len - 6) / LEAF_STEP);
    let sum = 0;
    for (let i = 0; i <= n; i++) {
      const t = (3 + i * LEAF_STEP) / len;
      const c = Math.floor((from.x + dx * t - g.x0) / LEAF_CELL);
      const r = Math.floor((from.z + dz * t - g.z0) / LEAF_CELL);
      if (c >= 0 && r >= 0 && c < g.cols && r < g.rows) sum += g.data[r * g.cols + c]!;
    }
    return sum * LEAF_WEIGHT;
  }

  waterDepth(p: THREE.Vector3): number {
    return this.water ? this.water.depthAt(p.x, p.y, p.z) : 0;
  }

  private readonly legA: THREE.Vector3[] = [];
  private readonly legB: THREE.Vector3[] = [];
  private readonly via = new THREE.Vector3();

  route(bot: Bot, to: THREE.Vector3, out: THREE.Vector3[]): boolean {
    if (!this.nav.path(bot.feet, to, out)) return false;
    const w = this.water;
    // Already in the river, or fighting: just go.
    if (!w || !w.crossings.length || bot.target || this.waterDepth(bot.feet) > 0.1) return true;
    if (w.wetLength(out) < WADE_MIN) return true;
    let direct = 0;
    for (let i = 1; i < out.length; i++) direct += out[i]!.distanceTo(out[i - 1]!);
    // The bridge with the shortest straight-line detour, counting a crowd on
    // it as extra distance: a jammed bridge sends people to the next one (or
    // through the ford) instead of everyone queueing on one.
    const crowd = this.bridgeCrowds(w.crossings);
    let best: readonly [number, number] | null = null;
    let bestLen = Infinity;
    let bestCost = Infinity;
    w.crossings.forEach((c, i) => {
      const len = Math.hypot(c[0] - bot.feet.x, c[1] - bot.feet.z) + Math.hypot(to.x - c[0], to.z - c[1]);
      const cost = len + crowd[i]! * BRIDGE_CROWD;
      if (cost < bestCost) {
        bestCost = cost;
        bestLen = len;
        best = c;
      }
    });
    const allowed = BRIDGE_DETOUR * (1.2 - bot.personality.aggression * 0.7);
    if (!best || bestLen > direct + allowed || bestCost > direct + allowed * 1.5) return true;
    // Bridge decks sit at about the banks' height: snap the centre onto the deck, not the bed below.
    const at = this.via.set(best[0], w.levelAt(best[0], best[1]) + 2, best[1]);
    if (Number.isNaN(at.y)) at.y = 1;
    if (!this.nav.path(bot.feet, at, this.legA) || !this.nav.path(at, to, this.legB)) return true;
    const alt = [...this.legA, ...this.legB.slice(1)];
    if (w.wetLength(alt) >= w.wetLength(out)) return true;
    out.length = 0;
    for (const p of alt) out.push(p);
    return true;
  }

  /** Bots (either side) on or by each river crossing, counted once a step. */
  private bridgeCrowds(crossings: readonly (readonly [number, number])[]): number[] {
    if (this.crowdStep === this.stepCount) return this.crowd;
    this.crowdStep = this.stepCount;
    this.crowd.length = 0;
    const r2 = BRIDGE_CROWD_RADIUS * BRIDGE_CROWD_RADIUS;
    for (const c of crossings) {
      let n = 0;
      for (const e of this.entries) {
        const f = e.bot.feet;
        if (e.bot.alive && !e.bot.riding && (f.x - c[0]) ** 2 + (f.z - c[1]) ** 2 < r2) n++;
      }
      this.crowd.push(n);
    }
    return this.crowd;
  }
  private crowd: number[] = [];
  private crowdStep = -1;

  /** Buildings: window firing spots (kept if they are on the navmesh) and footprints. */
  setTactical(windows: { pos: [number, number, number]; facing: [number, number] }[], footprints: { x: number; z: number; yaw: number; hw: number; hd: number }[]): void {
    this.posts = [];
    for (const w of windows) {
      const p = new THREE.Vector3(...w.pos);
      const on = this.nav.closest(p);
      if (!on || on.distanceTo(p) > 0.6) continue;
      this.posts.push({ pos: on, facing: new THREE.Vector3(w.facing[0], 0, w.facing[1]), owner: null });
    }
    this.footprints = footprints.map((f) => ({ x: f.x, z: f.z, cos: Math.cos(f.yaw), sin: Math.sin(f.yaw), hw: f.hw, hd: f.hd }));
  }

  insideBuilding(p: THREE.Vector3): boolean {
    for (const f of this.footprints) {
      const dx = p.x - f.x;
      const dz = p.z - f.z;
      if (Math.abs(dx * f.cos - dz * f.sin) < f.hw && Math.abs(dx * f.sin + dz * f.cos) < f.hd) return true;
    }
    return false;
  }

  private release(e: BotEntry): void {
    if (e.post) e.post.owner = null;
    e.post = null;
  }

  /**
   * Marksmen and anchors take a free window near their objective that looks
   * the right way: toward the zone when attacking it, out toward the enemy
   * when guarding it.
   */
  private assignPost(e: BotEntry): void {
    const g = e.objective;
    const p = e.bot.personality;
    const suited = (p.archetype === 'marksman' || p.archetype === 'anchor') && e.role !== 'flank' && !e.leader;
    if (!g || !suited || !e.bot.alive) {
      this.release(e);
      return;
    }
    const reach = g.radius + (p.archetype === 'marksman' ? 55 : 35);
    const fits = (post: Post) => {
      const d = post.pos.distanceTo(g.pos);
      if (d > reach) return false;
      if (g.defend) return post.facing.dot(g.front ?? post.facing) > 0.3;
      const to = this.tmp.subVectors(g.pos, post.pos).setY(0);
      return d > g.radius * 0.5 && post.facing.dot(to.normalize()) > 0.45;
    };
    if (e.post && fits(e.post)) return;
    this.release(e);
    if (Math.random() > 0.75) return;
    const free = this.posts.filter((post) => !post.owner && fits(post));
    if (!free.length) return;
    free.sort((a, b) => a.pos.distanceTo(e.bot.feet) - b.pos.distanceTo(e.bot.feet));
    const pick = free[Math.floor(Math.random() * Math.min(3, free.length))]!;
    pick.owner = e.bot;
    e.post = pick;
  }

  hasPost(bot: Bot): boolean {
    return !!this.entryOf(bot).post;
  }

  /** The bot's window, if it is standing at it. */
  postHere(bot: Bot): THREE.Vector3 | null {
    const post = this.entryOf(bot).post;
    return post && post.pos.distanceTo(bot.feet) < 1.2 ? post.pos : null;
  }

  /** Groups bots into squads; bots in a squad with a leader follow it. Squad-mates of the player get green markers. */
  setSquads(squads: BotSquad[]): void {
    for (const sq of squads) {
      const members: BotEntry[] = [];
      sq.botIds.forEach((id, k) => {
        const e = this.entries.find((x) => x.bot.id === id);
        if (!e) return;
        e.squad = sq.index;
        e.leader = sq.leader;
        e.slot = k + 1;
        e.role = 'assault';
        members.push(e);
        if (e.marker && sq.leader) e.marker.material = this.markerMaterial('#6bdc6b');
      });
      // The keenest member of a bot squad of three or more is its flanker.
      if (!sq.leader && members.length >= 3) {
        const f = members.reduce((a, b) => (b.bot.personality.aggression > a.bot.personality.aggression ? b : a));
        f.role = 'flank';
        f.flankSide = Math.random() < 0.5 ? -1 : 1;
      }
    }
  }

  /** Re-plan squad objectives now (e.g. a zone changed hands). */
  replan(team: Team): void {
    this.teams[team].planAt = Math.min(this.teams[team].planAt, this.time + 0.5 + Math.random());
  }

  private respawn(bot: Bot): void {
    if (this.hooks) {
      const e = this.entryOf(bot);
      const at = this.hooks.spawnAt(bot, e.objective?.pos ?? null);
      bot.spawn(at.pos, at.yaw, loadout(bot));
      e.via = e.objective ? this.approach(bot.feet, e.objective.pos, Math.floor(Math.random() * 3) - 1) : null;
      return;
    }
    const t = this.teams[bot.team];
    const sp = t.spawns.length ? t.spawns[Math.floor(Math.random() * t.spawns.length)]! : null;
    const base = sp ? new THREE.Vector3(...sp.pos) : t.base;
    // Don't spawn on top of another bot.
    let pos = base.clone();
    for (let i = 0; i < 8; i++) {
      const p = this.nav.randomAround(base, 4 + i) ?? this.nav.closest(base);
      if (!p) continue;
      pos = p;
      if (!this.entries.some((e) => e.bot !== bot && e.bot.alive && e.bot.feet.distanceTo(p) < 1.2)) break;
    }
    const [ex, , ez] = [t.base.x - this.teams[otherTeam(bot.team)].base.x, 0, t.base.z - this.teams[otherTeam(bot.team)].base.z];
    // Face the enemy base.
    bot.spawn(pos, Math.atan2(ex, ez), loadout(bot));
  }

  /** Everyone alive back onto a spawn the mode picks (once at the start, when the mode's hooks are in). */
  redeployAll(): void {
    for (const e of this.entries) if (e.bot.alive && !e.bot.riding) this.respawn(e.bot);
  }

  /** New model on respawn (the bot may carry a different weapon). */
  private refreshModel(e: BotEntry): void {
    e.model.dispose();
    e.model = makeModel(e.bot.team, e.bot.def);
    this.scene.add(e.model.root);
  }

  /** Squad planning: pick an objective every few seconds, re-roll member offsets. */
  private plan(team: Team): void {
    const t = this.teams[team];
    if (this.time < t.planAt) return;
    t.planAt = this.time + 7 + Math.random() * 4;
    const goals = this.hooks?.objectives(team) ?? [];
    if (goals.length > 0) {
      // Whole squads go for an objective together, spread over the map (see `assignSquads`).
      const squads = [...new Set(this.entries.filter((e) => e.bot.team === team).map((e) => e.squad))].sort((a, b) => a - b);
      const byPlayer = new Set(this.entries.filter((e) => e.bot.team === team && e.leader).map((e) => e.squad));
      const pick = this.assignSquads(t, goals, squads.filter((q) => !byPlayer.has(q)), team);
      // Each squad picks a way in (left, straight or right) so they don't all funnel down one street.
      const sides = squads.map(() => Math.floor(Math.random() * 3) - 1);
      const guards = new Map<BotObjective, BotEntry[]>();
      for (const e of this.entries) {
        if (e.bot.team !== team) continue;
        const k = Math.max(0, squads.indexOf(e.squad));
        // The player's squad goes for whichever objective the player is closest to.
        const l = e.leader;
        const g = l && l.alive ? goals.reduce((a, b) => (b.pos.distanceToSquared(l.feet) < a.pos.distanceToSquared(l.feet) ? b : a)) : (pick.get(e.squad) ?? goals[0]!);
        const changed = !e.objective || e.objective.pos.distanceToSquared(g.pos) > 1;
        e.objective = g;
        if (g.defend) {
          const list = guards.get(g) ?? [];
          list.push(e);
          guards.set(g, list);
        } else {
          e.watch = null;
          if (changed) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * g.radius * 0.7;
            e.offset.set(Math.cos(a) * r, 0, Math.sin(a) * r);
          }
        }
        if (changed) e.via = e.bot.alive ? this.approach(e.bot.feet, g.pos, sides[k]!) : null;
        this.assignPost(e);
      }
      // Guard posts: spread along the side of the zone facing the enemy, each watching outward.
      for (const [g, list] of guards) {
        const front = g.front ?? new THREE.Vector3(0, 0, -1);
        const base = Math.atan2(front.z, front.x);
        list.forEach((e, j) => {
          const a = base + (list.length > 1 ? (j / (list.length - 1) - 0.5) * 2.4 : 0);
          const r = g.radius * (0.55 + 0.15 * (j % 3));
          e.offset.set(Math.cos(a) * r, 0, Math.sin(a) * r);
          e.watch = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).lerp(front, 0.4).normalize();
        });
      }
      t.objective.copy(goals[0]!.pos);
      return;
    }
    for (const e of this.entries) if (e.bot.team === team) e.objective = null;
    const enemyBase = this.teams[otherTeam(team)].base;
    if (t.sighting && this.time - t.sighting.time < 12) {
      t.objective.copy(t.sighting.pos);
    } else {
      // Push somewhere between midfield and the enemy base, off to a random side.
      const f = 0.35 + Math.random() * 0.5;
      const p = this.tmp.lerpVectors(t.base, enemyBase, f);
      const dir = this.tmp2.subVectors(enemyBase, t.base).setY(0).normalize();
      p.x += -dir.z * (Math.random() - 0.5) * 50;
      p.z += dir.x * (Math.random() - 0.5) * 50;
      t.objective.copy(this.nav.closest(p) ?? p);
    }
    for (const e of this.entries) {
      if (e.bot.team !== team) continue;
      e.offset.set((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10);
    }
  }

  /**
   * Which objective each squad goes for. Every objective gets a squad of its
   * own while there are enough squads (the most urgent first; quiet zones the
   * side already holds last, as guard posts), the squads left over double up
   * on the most urgent ones. A squad keeps the objective it has while that
   * one is still on the list; the free ones take the open objectives nearest
   * to where they are, so nobody is sent back and forth across the map (and
   * through the middle of it) every time a zone changes hands.
   */
  private assignSquads(t: TeamState, goals: BotObjective[], squads: number[], team: Team): Map<number, BotObjective> {
    const out = new Map<number, BotObjective>();
    if (!squads.length) return out;
    // Squads per objective: the ones to take (or hold under attack) first, a
    // squad each and the rest doubling up from the top; quiet zones already
    // held get a guard squad only from what's left, at most a quarter of them.
    const open = goals.map(() => 0);
    const attack = goals.map((_, i) => i).filter((i) => !goals[i]!.guard);
    const guard = goals.map((_, i) => i).filter((i) => goals[i]!.guard);
    const guards = attack.length ? Math.min(guard.length, Math.max(0, squads.length - attack.length), Math.max(1, Math.floor(squads.length / 4))) : squads.length;
    for (let i = 0; i < guards && guard.length; i++) open[guard[i % guard.length]!]!++;
    const rest = squads.length - (guard.length ? guards : 0);
    for (let i = 0; i < rest && attack.length; i++) open[attack[i % attack.length]!]!++;
    const goalAt = (p: THREE.Vector3): number => goals.findIndex((g) => g.pos.distanceToSquared(p) < 1);
    const free: number[] = [];
    for (const q of squads) {
      const prev = t.assigned.get(q);
      const i = prev ? goalAt(prev) : -1;
      if (i >= 0 && open[i]! > 0) {
        open[i]!--;
        out.set(q, goals[i]!);
      } else free.push(q);
    }
    // Where each free squad is now (its living members, else its base).
    const where = new Map<number, THREE.Vector3>();
    for (const q of free) {
      const c = new THREE.Vector3();
      let n = 0;
      for (const e of this.entries) {
        if (e.squad !== q || e.bot.team !== team || !e.bot.alive) continue;
        c.add(e.bot.feet);
        n++;
      }
      where.set(q, n ? c.divideScalar(n) : t.base);
    }
    // Most urgent open objective first, each to the nearest free squad.
    for (let i = 0; i < goals.length && free.length; i++) {
      while (open[i]! > 0 && free.length) {
        let best = 0;
        for (let j = 1; j < free.length; j++) {
          if (where.get(free[j]!)!.distanceToSquared(goals[i]!.pos) < where.get(free[best]!)!.distanceToSquared(goals[i]!.pos)) best = j;
        }
        out.set(free.splice(best, 1)[0]!, goals[i]!);
        open[i]!--;
      }
    }
    t.assigned.clear();
    for (const [q, g] of out) t.assigned.set(q, g.pos.clone());
    return out;
  }

  // ---------------------------------------------------------------------------
  // BotServices

  /** Per-step lookups: each team's enemies and a grid of bots for neighbour queries. */
  private index(): void {
    for (const team of ['blue', 'red'] as const) {
      const out = this.enemies[team];
      out.length = 0;
      for (const e of this.entries) if (e.bot.team !== team) out.push(e.bot);
      if (this.player.team !== team) out.push(this.player);
    }
    // Drop cells nobody stood in last step: every cell ever visited used to stay,
    // and clearing them all grew to ~29k cells (4 ms a step) over a long match.
    for (const [key, cell] of this.grid) {
      if (cell.length === 0) this.grid.delete(key);
      else cell.length = 0;
    }
    for (const e of this.entries) {
      if (!e.bot.alive) continue;
      const key = cellKey(e.bot.feet.x, e.bot.feet.z);
      let cell = this.grid.get(key);
      if (!cell) this.grid.set(key, (cell = []));
      cell.push(e.bot);
    }
  }

  enemiesOf(team: Team): readonly Combatant[] {
    return this.enemies[team];
  }

  canSee(self: Combatant, other: Combatant, eye: THREE.Vector3, head: THREE.Vector3, chest: THREE.Vector3): boolean {
    // Sight is (nearly) symmetric: whoever checks a pair first answers for both.
    const key = self.id < other.id ? self.id * 4096 + other.id : other.id * 4096 + self.id;
    const hit = this.sightCache.get(key);
    // Far apart, a sight line is trusted a little longer (people move little relative to the range).
    const share = eye.distanceToSquared(head) > 40 * 40 ? SIGHT_SHARE_FAR_SEC : SIGHT_SHARE_SEC;
    if (hit && this.time - hit.time < share) return hit.visible;
    const visible = this.lineOfSight(eye, head) || this.lineOfSight(eye, chest);
    if (hit) {
      hit.time = this.time;
      hit.visible = visible;
    } else {
      this.sightCache.set(key, { time: this.time, visible });
    }
    return visible;
  }

  wallsBlock(from: THREE.Vector3, to: THREE.Vector3): boolean {
    return this.physics.blocked(from, to, Layer.WORLD);
  }

  inSmoke(p: THREE.Vector3): boolean {
    for (const s of this.effects.activeSmokes()) if (s.pos.distanceToSquared(p) < s.radius * s.radius) return true;
    return false;
  }

  /** When each enemy was last noticed by any bot of the other team (combatant id -> sim time). */
  private readonly spottedAt = new Map<number, number>();

  spot(_bot: Bot, e: Combatant): void {
    this.spottedAt.set(e.id, this.time);
  }

  /** Recon plane sweep: `team` learns where every enemy within `radius` of `center` is. */
  reveal(team: Team, center: THREE.Vector3, radius: number): void {
    const r2 = radius * radius;
    for (const e of this.enemies[team]) {
      if (!e.alive || e.feet.distanceToSquared(center) > r2) continue;
      this.spottedAt.set(e.id, this.time);
      this.noteSighting(team, e.feet);
    }
  }

  /**
   * Enemies of `team` its side currently knows about: noticed by one of its
   * bots in the last couple of seconds, or firing within earshot of `near`.
   */
  spottedEnemies(team: Team, near: THREE.Vector3, out: Combatant[] = []): Combatant[] {
    out.length = 0;
    for (const e of this.enemies[team]) {
      if (!e.alive) continue;
      const seen = this.time - (this.spottedAt.get(e.id) ?? -Infinity) < SPOT_SEC;
      const loud = e.firingUntil > this.time && e.feet.distanceToSquared(near) < SPOT_FIRING_RANGE * SPOT_FIRING_RANGE;
      if (seen || loud) out.push(e);
    }
    return out;
  }

  lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = this.tmp.subVectors(to, from);
    const dist = dir.length();
    if (dist < 1e-3) return true;
    dir.divideScalar(dist);
    if (this.physics.blocked(from, to, Layer.WORLD)) return false;
    for (const s of this.effects.activeSmokes()) {
      // Segment vs sphere (smoke is at full size a moment after popping).
      const r = s.radius * 0.85;
      const oc = this.tmp2.subVectors(s.pos, from);
      const along = THREE.MathUtils.clamp(oc.dot(dir), 0, dist);
      if (oc.addScaledVector(dir, -along).lengthSq() < r * r) return false;
    }
    return true;
  }

  findCover(bot: Bot, threat: THREE.Vector3): THREE.Vector3 | null | undefined {
    if (this.coverBudget <= 0) return undefined;
    this.coverBudget--;
    const threatEye = new THREE.Vector3(threat.x, threat.y + 1.6, threat.z);
    let best: THREE.Vector3 | null = null;
    let bestScore = Infinity;
    const p = new THREE.Vector3();
    const probe = new THREE.Vector3();
    const start = Math.random() * Math.PI * 2;
    for (let i = 0; i < COVER_SAMPLES; i++) {
      // Spread candidates around the bot (one cheap nearest-point query each).
      const a = start + (i / COVER_SAMPLES) * Math.PI * 2;
      const r = 3 + Math.random() * 8;
      probe.set(bot.feet.x + Math.cos(a) * r, bot.feet.y, bot.feet.z + Math.sin(a) * r);
      if (!this.nav.closest(probe, p) || Math.abs(p.y - bot.feet.y) > 3) continue;
      const toThreat = p.distanceTo(threat);
      if (toThreat < 6) continue;
      // Hidden when crouched...
      if (this.lineOfSight(threatEye, this.tmp2.set(p.x, p.y + 0.85, p.z).clone())) continue;
      // ...ideally able to see over it when standing (a peek spot).
      const peek = this.lineOfSight(threatEye, new THREE.Vector3(p.x, p.y + 1.6, p.z));
      const score = p.distanceTo(bot.feet) + (peek ? 0 : 5) - Math.min(toThreat, 25) * 0.1;
      if (score < bestScore) {
        bestScore = score;
        best = p.clone();
      }
    }
    return best;
  }

  squadGoal(bot: Bot): THREE.Vector3 {
    const t = this.teams[bot.team];
    const e = this.entryOf(bot);
    const follow = this.followPoint(e) ?? this.boardGoal(e);
    if (follow) return follow;
    if (this.isFlanking(bot)) return e.flankGoal!.clone();
    if (e.post) return e.post.pos.clone();
    if (e.objective) {
      if (e.via) {
        const toGoal = bot.feet.distanceTo(e.objective.pos);
        if (bot.feet.distanceTo(e.via) < 8 || toGoal < e.via.distanceTo(e.objective.pos) + 5) e.via = null;
        else return e.via.clone();
      }
      const goal = e.objective.pos.clone().add(e.offset);
      return this.nav.closest(goal) ?? e.objective.pos.clone();
    }
    const goal = t.objective.clone().add(e.offset);
    if (e.role === 'flank') {
      const dir = this.tmp.subVectors(t.objective, t.base).setY(0).normalize();
      goal.x += -dir.z * 16 * e.flankSide;
      goal.z += dir.x * 16 * e.flankSide;
    }
    return this.nav.closest(goal) ?? t.objective.clone();
  }

  /**
   * A detour point for approaching `goal` from `from` along side `side`
   * (-1 left, 0 straight, 1 right), or null when it is close anyway.
   */
  private approach(from: THREE.Vector3, goal: THREE.Vector3, side: number): THREE.Vector3 | null {
    const dist = from.distanceTo(goal);
    if (side === 0 || dist < 50) return null;
    const dir = this.tmp.subVectors(goal, from).setY(0).normalize();
    // Halfway there, swung out to the side by up to 35 m.
    const swing = Math.min(35, dist * 0.35) * side;
    const p = new THREE.Vector3().lerpVectors(from, goal, 0.5);
    p.x += -dir.z * swing;
    p.z += dir.x * swing;
    return this.nav.closest(p);
  }

  /**
   * The player's squad mates no longer trail the player (owner, 2026-10-02:
   * "they keep following me"): they fight for the zone the player is nearest
   * to, on their own (see `plan`). Kept as a hook for squad orders later.
   */
  private followPoint(e: BotEntry): THREE.Vector3 | null {
    void e;
    return null;
  }

  /** Squad member heading for (or on) a flank of the squad's current fight. */
  isFlanking(bot: Bot): boolean {
    const e = this.entryOf(bot);
    if (e.role !== 'flank' || e.leader) return false;
    const c = this.contacts.get(squadKey(bot.team, e.squad));
    if (!c || this.time - c.last > 6 || this.time - c.since < 4 || e.flankFor === c.since) {
      e.flankGoal = null;
      return false;
    }
    if (!e.flankGoal) {
      // Out to the side of the enemy, level with them, from where the squad is.
      const mates = this.entries.filter((x) => x.squad === e.squad && x.bot.team === bot.team && x.bot.alive);
      const centre = mates.reduce((a, x) => a.add(x.bot.feet), new THREE.Vector3()).divideScalar(Math.max(1, mates.length));
      const back = this.tmp.subVectors(centre, c.pos).setY(0);
      if (back.lengthSq() < 1) back.set(1, 0, 0);
      back.normalize();
      const p = c.pos.clone().addScaledVector(back, 5);
      p.x += -back.z * 22 * e.flankSide;
      p.z += back.x * 22 * e.flankSide;
      e.flankGoal = this.nav.closest(p);
      if (!e.flankGoal) {
        e.flankFor = c.since;
        return false;
      }
    }
    if (bot.feet.distanceTo(e.flankGoal) < 5) {
      // Arrived: done with this flank (hunt / engage takes over from here).
      e.flankFor = c.since;
      e.flankGoal = null;
      return false;
    }
    return true;
  }

  /** The squad's current fight, if recent. */
  squadContact(bot: Bot): { pos: THREE.Vector3; time: number } | null {
    const e = this.entryOf(bot);
    const c = e.squad >= 0 ? this.contacts.get(squadKey(bot.team, e.squad)) : undefined;
    return c && this.time - c.last < 8 ? { pos: c.pos, time: c.last } : null;
  }

  /** Where to look when idle (guard post / around the leader), or null. */
  watchDir(bot: Bot): THREE.Vector3 | null {
    const e = this.entryOf(bot);
    if (e.post && this.postHere(bot)) return e.post.facing;
    return e.watch;
  }

  /** Squad mates don't trail the player any more, so nobody has to keep pace. */
  keepPace(bot: Bot): boolean {
    void bot;
    return false;
  }

  throwGrenade(bot: Bot, type: 'frag' | 'smoke' | 'flash', at: THREE.Vector3): boolean {
    if (!this.grenades || this.time < this.grenadeAt[bot.team]) return false;
    const origin = bot.eyePos(new THREE.Vector3());
    origin.y += 0.1;
    // Frags roll on for a couple of meters after landing: aim a bit short.
    const aim = at.clone();
    if (type === 'frag') {
      const back = new THREE.Vector3(origin.x - at.x, 0, origin.z - at.z);
      if (back.lengthSq() > 9) aim.addScaledVector(back.normalize(), 1.6);
    }
    // A flat-ish arc first; a steep lob over cover when that falls short.
    const vel = lobVelocity(origin, aim, 38, 22) ?? lobVelocity(origin, aim, 58, 22);
    if (!vel) return false;
    this.grenadeAt[bot.team] = this.time + 1.5;
    this.grenades.launch(type, origin, vel, { id: bot.id, name: bot.name, team: bot.team });
    return true;
  }

  alliesNear(team: Team, pos: THREE.Vector3, radius: number): number {
    let n = 0;
    for (const e of this.entries) if (e.bot.team === team && e.bot.alive && e.bot.feet.distanceTo(pos) < radius) n++;
    if (this.player.team === team && this.player.alive && this.player.feet.distanceTo(pos) < radius) n++;
    return n;
  }

  enemiesNear(team: Team, pos: THREE.Vector3, radius: number): number {
    let n = 0;
    for (const c of this.enemies[team]) if (c.alive && c.feet.distanceTo(pos) < radius) n++;
    return n;
  }

  /** Bots who see (or are right next to) a live enemy frag about to go off run from it. */
  private dodgeGrenades(): void {
    if (!this.grenades) return;
    for (const g of this.grenades.frags()) {
      if (g.fuse > 2.8) continue;
      for (const e of this.entries) {
        const b = e.bot;
        if (!b.alive || b.team === g.team) continue;
        const d = b.feet.distanceTo(g.pos);
        if (d > 7) continue;
        if (d < 3 || this.lineOfSight(b.eyePos(new THREE.Vector3()), g.pos.clone().setY(g.pos.y + 0.2))) b.dodge(g.pos, this);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Vehicles

  /**
   * Bots take vehicles when their objective is far: a free seat in an empty
   * or friendly vehicle close by (driver's seat first). Drivers wait a few
   * seconds for squad mates, then drive along the navmesh path to the
   * objective, back up and try again when stuck, and everyone gets out near
   * the objective (or when the driver gives up). Gunners fire the mounted
   * gun at what they see.
   */
  private considerVehicles(): void {
    const vw = this.vehicles;
    if (!vw || this.time < this.vehicleCheckAt) return;
    this.vehicleCheckAt = this.time + 1;
    for (const e of this.entries) {
      const b = e.bot;
      if (!b.alive || b.riding) continue;
      if (e.board) {
        const v = vw.get(e.board.vehicle);
        const taken = !v || v.wrecked || !!v.seats[e.board.seat] || (v.team && v.team !== b.team);
        if (taken || this.time > e.board.until) {
          e.board = null;
          continue;
        }
        if (vw.nearest(b.feet, 2.6) === v) this.boardBot(e, v, e.board.seat);
        continue;
      }
      if (b.inCombat(this.time) || b.downed || !e.objective) continue;
      if (e.objective.pos.distanceTo(b.feet) < VEHICLE_TRIP) continue;
      // A vehicle close by with a seat nobody has claimed.
      let best: { v: Vehicle; seat: number; d: number } | null = null;
      for (const v of vw.vehicles) {
        // Aircraft are only boarded on the deploy screen (one flying low past isn't a ride).
        if (v.flight || v.wrecked || (v.team && v.team !== b.team) || (v.home && v.home !== b.team)) continue;
        const d = v.pos.distanceTo(b.feet);
        if (d > 30 || (best && d >= best.d)) continue;
        const seat = v.seats.findIndex((s, i) => !s && !this.claimed(v.id, i) && (i > 0 || v.driverOnly === null || v.driverOnly === b.id));
        // Without a driver aboard or coming, only take the driver's seat.
        if (seat < 0 || (seat > 0 && !v.seats[0] && !this.claimed(v.id, 0))) continue;
        best = { v, seat, d };
      }
      if (best) e.board = { vehicle: best.v.id, seat: best.seat, until: this.time + 25 };
    }
  }

  /** A rocket tank was called in for `leaderId`: that bot heads for its driver's seat. */
  rocketTankFor(leaderId: number, v: Vehicle): void {
    const e = this.entries.find((x) => x.bot.id === leaderId);
    if (e && e.bot.alive && !e.bot.riding) e.board = { vehicle: v.id, seat: 0, until: this.time + 90 };
  }

  /** A bot is on its way to this seat. */
  claimedSeat(vehicle: number, seat: number): boolean {
    return this.claimed(vehicle, seat);
  }

  private claimed(vehicle: number, seat: number): boolean {
    return this.entries.some((x) => x.board?.vehicle === vehicle && x.board.seat === seat);
  }

  /** Puts a bot straight into a seat (a tank brought out for it, a deploy aboard): there at once, no slide across the map. */
  seatBot(bot: Bot, v: Vehicle, seat: number): void {
    this.boardBot(this.entryOf(bot), v, seat);
    bot.carry(v.seatEye(seat, this.tmp), v.velocity);
    bot.prevFeet.copy(bot.feet);
  }

  private boardBot(e: BotEntry, v: Vehicle, seat: number): void {
    e.board = null;
    v.seats[seat] = { id: e.bot.id, team: e.bot.team };
    const spec = v.spec.seats[seat]!;
    e.bot.board(v.id, seat, spec.exposed);
    e.drive = seat === 0 ? { path: [], at: 0, repathAt: 0, waitUntil: this.time + 6, stuckFor: 0, backUntil: 0, tries: 0 } : null;
  }

  /** Out of the vehicle on the ground beside the seat (or on top when boxed in). */
  private alightBot(e: BotEntry): void {
    const b = e.bot;
    const r = b.riding;
    if (!r) return;
    const v = this.vehicles?.get(r.vehicle);
    e.drive = null;
    if (!v) {
      b.alight(b.feet);
      return;
    }
    v.seats[r.seat] = null;
    if (v.flight) {
      // Out of a plane: down on the ground below (outside the map, where the
      // scenery has no collision, the nearest walkable ground instead of the sky).
      const down = this.physics.raycast(v.pos, DOWN, 2000, Layer.WORLD);
      const ground = down ? new THREE.Vector3(down.point.x, down.point.y, down.point.z) : this.nav.closestFar(v.pos);
      b.alight(ground ?? this.teams[b.team].base.clone());
      return;
    }
    b.alight(v.exitSpot(r.seat, this.physics));
  }

  /** Bot squad goal while boarding: the vehicle. */
  private boardGoal(e: BotEntry): THREE.Vector3 | null {
    const v = e.board ? this.vehicles?.get(e.board.vehicle) : null;
    return v ? (this.nav.closest(v.pos) ?? v.pos.clone()) : null;
  }

  inVehicle(c: Combatant): boolean {
    if (c.id === PLAYER_ID) return this.playerRiding?.() ?? false;
    return !!this.entries.find((x) => x.bot.id === c.id)?.bot.riding;
  }

  /** Who sits under armour or in an aircraft this step (combatant id; everyone else is out in the open). */
  private readonly seatCover = new Map<number, 'armour' | 'air'>();

  private indexSeats(): void {
    this.seatCover.clear();
    for (const v of this.vehicles?.vehicles ?? []) {
      v.seats.forEach((o, i) => {
        if (!o) return;
        if (v.flight) this.seatCover.set(o.id, 'air');
        else if (!v.spec.seats[i]!.exposed) this.seatCover.set(o.id, 'armour');
      });
    }
  }

  coverOf(c: Combatant): 'open' | 'armour' | 'air' {
    return this.seatCover.get(c.id) ?? 'open';
  }

  canEngage(bot: Bot, e: Combatant): boolean {
    const cover = this.seatCover.get(e.id);
    if (!cover) return true;
    const r = bot.riding;
    if (!r) return cover === 'armour' && bot.hasRocket;
    const gun = this.vehicles?.get(r.vehicle)?.mounts[r.seat]?.gun;
    if (!gun) return false;
    return cover === 'air' ? !gun.shell : gun.blast > 0;
  }

  rideStep(bot: Bot, dt: number): void {
    const e = this.entryOf(bot);
    const r = bot.riding!;
    const v = this.vehicles?.get(r.vehicle);
    if (!v || v.wrecked) {
      this.alightBot(e);
      return;
    }
    v.seatEye(r.seat, this.tmp);
    bot.carry(this.tmp, v.velocity);
    const role = v.spec.seats[r.seat]!.role;
    if (role === 'driver' && v.flight) this.pilot(e, v);
    else if (role === 'driver') this.autopilot(e, v, dt);
    if (v.mounts[r.seat] && !(v.flight && role === 'driver')) this.botGunner(bot, v, r.seat);
    // Getting out: near the objective with the vehicle stopped, or left without a driver.
    const goal = e.objective?.pos;
    const near = !!goal && goal.distanceTo(bot.feet) < VEHICLE_DROP;
    const stopped = v.velocity.length() < 1.5;
    const noDriver = !v.seats[0];
    if (stopped && (near || (noDriver && role !== 'gunner') || (noDriver && !bot.target && this.time > (e.alone ??= this.time + 6)))) {
      e.alone = undefined;
      this.alightBot(e);
    } else if (!noDriver) e.alone = undefined;
  }

  /**
   * Bot pilots. Fighters chase the nearest enemy aircraft (cannon when lined
   * up, missiles when locked); close air support dives on enemy vehicles or
   * groups the side knows about (cannon and rockets, pulling up low). With
   * nothing to hit they circle the battlefield. They never fly into the
   * ground on purpose: too low, they climb.
   */
  private pilot(e: BotEntry, v: Vehicle): void {
    const bot = e.bot;
    const f = v.flight!;
    const out: DriveInput = { throttle: 0, steer: 0, brake: false, aimYaw: f.yaw, aimPitch: 0 };
    this.driveInputs.set(v.id, out);
    const below = this.physics.raycast(v.pos, DOWN, 2000, Layer.WORLD);
    // Off the edge of the terrain: the battlefield's height.
    const ground = below ? v.pos.y - below.distance : VehicleAir.airCenter.y;
    const height = v.pos.y - ground;
    const cruise = ground + 170;
    const p = (e.flightPlan ??= { target: null, kind: 'none', until: 0, pullUntil: 0 });
    if (this.time > p.until) {
      p.until = this.time + 1;
      p.target = null;
      p.kind = 'none';
      if (v.kind === 'fighter') {
        let best = 1500;
        for (const o of this.vehicles?.vehicles ?? []) {
          if (!o.flight || o.wrecked || o.home === bot.team) continue;
          const d = o.pos.distanceTo(v.pos);
          if (d < best) {
            best = d;
            p.target = o;
            p.kind = 'air';
          }
        }
      } else {
        // Ground: enemy vehicles first, else enemies the side knows about.
        let best = 1300;
        for (const o of this.vehicles?.vehicles ?? []) {
          if (o.flight || o.wrecked || !o.team || o.team === bot.team) continue;
          const d = o.pos.distanceTo(v.pos);
          if (d < best) {
            best = d;
            p.target = o;
            p.kind = 'ground';
          }
        }
        if (!p.target) {
          const seen = this.spottedEnemies(bot.team, v.pos);
          let bestN = 0;
          for (const c of seen) {
            const n = this.enemiesNear(bot.team, c.feet, 15);
            if (n > bestN && c.feet.distanceTo(v.pos) < 1500) {
              bestN = n;
              p.target = c;
              p.kind = 'ground';
            }
          }
        }
      }
    }
    const t = p.target;
    const tpos = t ? (t as { pos?: THREE.Vector3 }).pos ?? (t as Combatant).feet : null;
    let fire = false;
    let alt = false;
    let wantThrottle = 0.75;
    const lookAt = (at: THREE.Vector3): { yaw: number; pitch: number; angle: number; dist: number } => {
      const d = at.clone().sub(v.pos);
      const dist = d.length();
      const yaw = Math.atan2(-d.x, -d.z);
      const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      const nose = v.velocity.clone().normalize();
      return { yaw, pitch, angle: nose.angleTo(d.normalize()), dist };
    };
    if (t && tpos && p.kind === 'air') {
      // The cannon is hitscan (and missiles home): point the nose at the plane itself, not ahead of it.
      const a = lookAt(tpos);
      out.aimYaw = a.yaw;
      out.aimPitch = a.pitch;
      fire = a.angle < 0.07 && a.dist < 800;
      alt = a.angle < 0.4 && a.dist < 1300;
      wantThrottle = 1;
    } else if (t && tpos && p.kind === 'ground') {
      const flat = Math.hypot(tpos.x - v.pos.x, tpos.z - v.pos.z);
      const a = lookAt(tpos.clone().setY(tpos.y + 1));
      if (this.time < p.pullUntil || height < 70) {
        out.aimPitch = 0.55;
        if (height > 140) p.pullUntil = 0;
      } else if (flat > 950) {
        out.aimYaw = a.yaw;
        out.aimPitch = THREE.MathUtils.clamp((cruise - v.pos.y) * 0.01, -0.3, 0.3);
      } else {
        // Attack run: dive at it, guns and rockets when lined up, pull up close or low.
        out.aimYaw = a.yaw;
        out.aimPitch = a.pitch;
        fire = a.angle < 0.06 && a.dist < 750;
        alt = a.angle < 0.05 && a.dist < 850 && a.dist > 250;
        if (a.dist < 180 || height < 90) p.pullUntil = this.time + 3;
        wantThrottle = 0.55;
      }
    } else {
      // Nothing to hit: circle the battlefield at cruise height.
      const c = VehicleAir.airCenter;
      const ang = Math.atan2(v.pos.z - c.z, v.pos.x - c.x) + 0.35;
      const r = VehicleAir.airRadius * 0.75;
      const want = new THREE.Vector3(c.x + Math.cos(ang) * r, cruise, c.z + Math.sin(ang) * r);
      const a = lookAt(want);
      out.aimYaw = a.yaw;
      out.aimPitch = THREE.MathUtils.clamp(a.pitch, -0.3, 0.3);
      wantThrottle = 0.65;
    }
    // Never into the ground.
    if (height < 55 && (out.aimPitch ?? 0) < 0.35) out.aimPitch = 0.45;
    out.throttle = Math.sign(wantThrottle - f.throttle);
    if (v.pullTrigger(0, fire, this.time, STEP)) this.fireMount?.(v, 0, { id: bot.id, name: bot.name, team: bot.team }, null);
    if (v.altMounts[0] && v.pullTrigger(0, alt, this.time, STEP, true)) this.fireMount?.(v, 0, { id: bot.id, name: bot.name, team: bot.team }, null, true);
    if (fire || alt) bot.firingUntil = this.time + 0.5;
  }

  /**
   * Driving to the squad objective (owner, 2026-10-02: "bots can't drive
   * tanks, a wall and they're stuck for good"): the route comes from the
   * vehicle navmesh (wide enough for a hull), followed by aiming at a point
   * a speed-dependent distance ahead; three feelers at bumper height steer
   * off walls and slow for what's in front; tracked hulls turn on the spot
   * for sharp corners. Stuck: back up, the wheels turned toward the way on,
   * then plan again; it only gives up after many tries without getting
   * anywhere (getting 15 m clear wipes the count). At the end of the route
   * (the goal itself may stand where no hull fits) everyone gets out.
   */
  private autopilot(e: BotEntry, v: Vehicle, dt: number): void {
    const d = e.drive!;
    const out = { throttle: 0, steer: 0, brake: false };
    this.driveInputs.set(v.id, out);
    // Give squad mates (and the player) a moment to climb in.
    if (this.time < d.waitUntil && v.seats.some((s) => !s) && this.entries.some((x) => x.board?.vehicle === v.id)) {
      out.brake = true;
      return;
    }
    const goal = e.objective?.pos;
    if (!goal || goal.distanceTo(v.pos) < VEHICLE_DROP) {
      out.brake = true;
      return;
    }
    const speed = v.forwardSpeed();
    const getOut = (): void => {
      out.throttle = 0;
      out.brake = true;
      if (Math.abs(speed) < 1.5) for (const x of this.entries) if (x.bot.riding?.vehicle === v.id) this.alightBot(x);
    };
    if (d.tries > DRIVE.giveUp) return getOut();
    if (this.time > d.repathAt || d.at >= d.path.length) {
      d.repathAt = this.time + 8;
      d.path.length = 0;
      d.at = 0;
      const routed = this.vehicleNav ? this.vehicleNav.path(v.pos, goal, d.path) : this.nav.path(v.pos, goal, d.path);
      if (!routed) d.path.push(goal.clone());
    }
    // Aim at the route a little ahead (further when fast) rather than at its next corner.
    const look = DRIVE.look + Math.abs(speed) * 0.7;
    while (d.at < d.path.length - 1 && Math.hypot(d.path[d.at]!.x - v.pos.x, d.path[d.at]!.z - v.pos.z) < look) d.at++;
    const to = d.path[d.at]!;
    const toDist = Math.hypot(to.x - v.pos.x, to.z - v.pos.z);
    if (d.at === d.path.length - 1 && toDist < 8) return getOut();
    const want = Math.atan2(-(to.x - v.pos.x), -(to.z - v.pos.z));
    const diff = Math.atan2(Math.sin(want - v.yaw), Math.cos(want - v.yaw));
    if (this.time < d.backUntil) {
      out.throttle = -1;
      out.steer = d.backSteer ?? (diff > 0 ? 1 : -1);
      return;
    }
    // Feelers: straight ahead and either corner of the bumper.
    const yaw = v.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const half = v.spec.half;
    // Another vehicle just ahead that is moving (or goes first, lower id): wait
    // for it a few seconds rather than shove into it (columns leaving a base jammed).
    let ahead2: Vehicle | null = null;
    for (const o of this.vehicles?.vehicles ?? []) {
      if (o === v || o.flight || o.wrecked) continue;
      const dx = o.pos.x - v.pos.x;
      const dz = o.pos.z - v.pos.z;
      const along = dx * fx + dz * fz;
      if (along <= 0 || along > half[2] + o.spec.half[2] + 6) continue;
      if (Math.abs(dx * -fz + dz * fx) < half[0] + o.spec.half[0] + 0.8) {
        ahead2 = o;
        break;
      }
    }
    if (ahead2 && (ahead2.velocity.length() > 1 || ahead2.id < v.id) && this.time - (d.yieldSince ??= this.time) < DRIVE.yield) {
      out.brake = true;
      d.stuckFor = 0;
      return;
    }
    if (!ahead2) d.yieldSince = undefined;
    const reach = half[2] + 2.5 + Math.max(0, speed) * 0.6;
    const feel = (side: number): number => {
      const ox = v.pos.x + fz * -side * half[0] * 0.9;
      const oz = v.pos.z + fx * side * half[0] * 0.9;
      // Low on the hull, where kerbs, sandbags and low walls catch it.
      const hit = this.physics.raycast({ x: ox, y: v.pos.y - half[1] + 0.45, z: oz }, { x: fx, y: 0, z: fz }, reach, Layer.WORLD, v.collider);
      // Rising ground ahead is a slope to climb, not a wall.
      return hit && hit.normal.y < 0.6 ? hit.distance / reach : 1;
    };
    const left = feel(-1);
    const right = feel(1);
    const ahead = feel(0);
    const sharp = Math.abs(diff);
    // Positive diff = target to the left (yaw grows turning left); steer +1 is right.
    // A wall near one corner pushes the steering toward the other side.
    out.steer = THREE.MathUtils.clamp(-diff * 1.8 + (1 - left) * 1.4 - (1 - right) * 1.4, -1, 1);
    const pivot = !!v.spec.turnRate && sharp > 0.7;
    if (pivot) {
      // Tracks: turn on the spot toward the route.
      out.throttle = 0;
      out.steer = diff > 0 ? -1 : 1;
    } else {
      out.throttle = sharp > 1.2 ? 0.35 : sharp > 0.6 ? 0.6 : 1;
      if (ahead < 0.5) out.throttle = Math.min(out.throttle, 0.3);
      if ((sharp > 1.2 || ahead < 0.35) && speed > 6) out.brake = true;
    }
    // Stuck: pushing without getting anywhere (turning on the spot counts as getting somewhere while the hull turns).
    const blocked = pivot ? Math.abs(v.body.angvel().y) < 0.12 : Math.abs(speed) < 0.8 && out.throttle > 0.1;
    if (blocked) d.stuckFor += dt;
    else d.stuckFor = Math.max(0, d.stuckFor - dt * 2);
    if (d.stuckAt && d.stuckAt.distanceTo(v.pos) > DRIVE.clear) d.tries = 0;
    if (d.stuckFor > DRIVE.stuck) {
      d.stuckFor = 0;
      d.tries++;
      d.stuckAt = v.pos.clone();
      const back = DRIVE.back + d.tries * 0.3;
      d.backUntil = this.time + back;
      // Backing with the wheels turned toward the way on swings the nose round to it; every other try the other way.
      d.backSteer = (diff > 0 ? 1 : -1) * (d.tries % 3 === 2 ? -1 : 1);
      d.repathAt = this.time + back + 0.1;
    }
  }

  /**
   * A bot on a gun seat (a gunner, or a tank driver on the main gun) swings
   * it onto whoever it sees and fires: MGs in bursts, shell guns when loaded
   * (enemy vehicles and groups first for those; the howitzer only at range).
   */
  private botGunner(bot: Bot, v: Vehicle, seat: number): void {
    const m = v.mounts[seat];
    const t = bot.target;
    if (!m) return;
    const firing = !!t && t.alive;
    if (!firing) {
      v.pullTrigger(seat, false, this.time, STEP);
      return;
    }
    const muzzle = v.muzzleOf(seat, this.tmp2);
    const aim = t.feet.clone().setY(t.feet.y + (m.gun.shell ? 0.6 : 1.1));
    const dir = aim.clone().sub(muzzle);
    const dist = dir.length();
    const yaw = Math.atan2(-dir.x, -dir.z);
    const pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    v.aimMount(seat, yaw, pitch);
    bot.aimYaw = bot.yaw = yaw;
    // Out of its traverse (casemate guns): not this time.
    const rel = Math.atan2(Math.sin(yaw - v.yaw), Math.cos(yaw - v.yaw));
    if (Math.abs(rel - m.yaw) > 0.05) {
      v.pullTrigger(seat, false, this.time, STEP);
      return;
    }
    const shellOk = !m.gun.shell || (m.gun.shell.lob ? dist > 60 : dist > 8);
    if (dist > m.gun.range || !shellOk || !v.pullTrigger(seat, true, this.time, STEP)) return;
    // Bots' aim error, a bit wider than with a rifle.
    const err = this.skill.aimErrorMin * 0.04 * dist;
    aim.x += (Math.random() - 0.5) * err;
    aim.y += (Math.random() - 0.5) * err * 0.5;
    aim.z += (Math.random() - 0.5) * err;
    this.fireMount?.(v, seat, { id: bot.id, name: bot.name, team: bot.team }, aim);
    bot.firingUntil = this.time + 0.4;
  }

  /** A vehicle blew up: bots aboard die outright (no going down). */
  vehicleLost(v: Vehicle, source: DamageSource | null): Bot[] {
    const dead: Bot[] = [];
    for (const e of this.entries) {
      if (e.bot.riding?.vehicle !== v.id) continue;
      this.alightBot(e);
      e.bot.killOutright(source ?? undefined);
      dead.push(e.bot);
    }
    return dead;
  }

  /** Bots in the way of a mortar / artillery shell about to land run from it (they hear the whistle). */
  private dodgeShells(): void {
    if (!this.support) return;
    for (const d of this.support.dangers()) {
      if (d.in > 1.6) continue;
      for (const e of this.entries) {
        const b = e.bot;
        if (b.alive && b.feet.distanceTo(d.point) < d.radius) b.dodge(d.point, this);
      }
    }
  }

  /**
   * Bot squad leaders (the first living member of a squad without the
   * player) spend their squad's RP every so often: mortar or artillery on a
   * group of enemies their squad is fighting (never with friends close to
   * it), smoke to cover pushing toward them, a recon plane over a zone they
   * attack, a supply drop when the squad is out of grenades and medkits.
   */
  private considerSupport(team: Team): void {
    const sup = this.support;
    if (!sup || this.time < this.supportAt[team]) return;
    this.supportAt[team] = this.time + 3 + Math.random() * 2;
    const squads = new Map<number, BotEntry[]>();
    for (const e of this.entries) {
      if (e.bot.team !== team || e.squad < 0 || e.leader) continue;
      const list = squads.get(e.squad) ?? [];
      list.push(e);
      squads.set(e.squad, list);
    }
    for (const [idx, members] of squads) {
      const key = squadKey(team, idx);
      if (this.time < (this.squadCallAt.get(key) ?? 0)) continue;
      const lead = members.filter((m) => m.bot.alive).sort((a, b) => a.slot - b.slot)[0];
      if (!lead) continue;
      const bot = lead.bot;
      const rp = sup.rp(bot);
      const can = (k: SupportId): boolean => rp >= SUPPORT[k].cost && sup.cooldown(team, k) <= 0;
      const call = (k: SupportId, p: THREE.Vector3): boolean => {
        if (!sup.call(k, p, bot)) return false;
        this.squadCallAt.set(key, this.time + 20);
        return true;
      };
      const c = this.contacts.get(key);
      if (c && this.time - c.last < 6) {
        const d = c.pos.distanceTo(bot.feet);
        const enemies = this.enemiesNear(team, c.pos, 18);
        if (d > 30 && d < 300) {
          if (enemies >= 3 && can('artillery') && this.alliesNear(team, c.pos, 26) === 0 && call('artillery', c.pos)) return;
          if (enemies >= 2 && can('mortar') && this.alliesNear(team, c.pos, 16) === 0 && call('mortar', c.pos)) return;
        }
        if (d > 20 && can('smoke') && Math.random() < 0.25) {
          const p = bot.feet.clone().lerp(c.pos, 0.45);
          if (call('smoke', this.nav.closest(p) ?? p)) return;
        }
      }
      // A rocket tank now and then, when the squad isn't in a fight.
      if (can('rocketTank') && !(c && this.time - c.last < 8) && Math.random() < 0.12 && call('rocketTank', bot.feet)) return;
      const obj = lead.objective;
      if (obj && !obj.defend && can('recon') && obj.pos.distanceTo(bot.feet) < 160 && Math.random() < 0.35 && call('recon', obj.pos)) return;
      const needy = members.filter((m) => m.bot.alive && (m.bot.needsGrenades || (m.bot.cls !== 'medic' && m.bot.medkits < MEDKIT.carried))).length;
      if (needy >= 2 && can('supply') && !(c && this.time - c.last < 4)) {
        const p = bot.feet.clone().add(new THREE.Vector3(Math.sin(bot.yaw) * -2, 0, Math.cos(bot.yaw) * -2));
        if (call('supply', this.nav.closest(p) ?? bot.feet)) return;
      }
    }
  }

  /** The player spotted / was shot by an enemy at `pos`: tell the player's team and squad. */
  playerContact(pos: THREE.Vector3): void {
    this.noteSighting(this.player.team, pos);
    const e = this.entries.find((x) => x.leader === this.player);
    if (e) this.noteContact(this.player.team, e.squad, pos);
  }

  /** No regrouping on the player either (see `followPoint`). */
  mustRegroup(bot: Bot): boolean {
    void bot;
    return false;
  }

  squadGoalMoved(bot: Bot, current: THREE.Vector3): boolean {
    const e = this.entryOf(bot);
    if (e.flankGoal && e.flankGoal.distanceTo(current) > 4 && this.isFlanking(bot)) return true;
    const l = e.leader;
    if (!l || !l.alive) return false;
    // Re-path only when the spot near the leader was given up for a new one.
    const spot = this.followPoint(e);
    return !!spot && spot.distanceTo(current) > 3;
  }

  teamSighting(team: Team): { pos: THREE.Vector3; time: number } | null {
    return this.teams[team].sighting;
  }

  reportSighting(bot: Bot, pos: THREE.Vector3): void {
    this.noteSighting(bot.team, pos);
    const e = this.entryOf(bot);
    if (e.squad >= 0) this.noteContact(bot.team, e.squad, pos);
  }

  private noteContact(team: Team, squad: number, pos: THREE.Vector3): void {
    const key = squadKey(team, squad);
    const c = this.contacts.get(key);
    if (!c || this.time - c.last > 6) this.contacts.set(key, { pos: pos.clone(), since: this.time, last: this.time });
    else {
      c.pos.copy(pos);
      c.last = this.time;
    }
  }

  private noteSighting(team: Team, pos: THREE.Vector3): void {
    const t = this.teams[team];
    if (!t.sighting) t.sighting = { pos: pos.clone(), time: this.time };
    else {
      t.sighting.pos.copy(pos);
      t.sighting.time = this.time;
    }
  }

  fire(bot: Bot, dir: THREE.Vector3): void {
    const def = bot.def;
    const eye = bot.eyePos(new THREE.Vector3());
    const moving = Math.min(1, bot.horizontalSpeed / 4.6);
    const spread = (def.spreadAds + (def.spreadHip - def.spreadAds) * (bot.crouching ? 0.1 : 0.35) + moving * 1.2) * DEG;
    const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const pellets = def.pellets ?? 1;
    const source: DamageSource = { pos: eye.clone(), name: bot.name, team: bot.team, weapon: def.name, id: bot.id };
    const e = this.entryOf(bot);
    // Hidden (off screen or drawn as the far model): the skinned model isn't posed, fire from the eye.
    if (e.model.root.visible) {
      e.model.muzzleWorld(this.muzzle);
      if (e.model instanceof HumanModel) e.model.onFire();
    }
    else this.muzzle.copy(eye);
    for (let i = 0; i < pellets; i++) {
      const r = Math.tan(spread) * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const d = dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const max = def.range * 1.5;
      const hit = this.physics.raycast(eye, d, max, Layer.WORLD | Layer.HITBOX, undefined, bot.hitboxes.body);
      const to = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : eye.clone().addScaledVector(d, max);
      const target = hit ? this.registry.lookup(hit.collider.handle) : undefined;
      this.nearMiss(eye, to, bot.team, target?.owner.id ?? -1, pellets > 1 ? 0.35 : 1);
      if (hit && target) {
        const owner = target.owner;
        // No friendly fire: the round is simply stopped.
        if (owner.alive && owner.team !== bot.team) {
          const dmg = computeDamage(damageAtDistance(def, hit.distance), target.part, def.headshotMult) * this.damageScale;
          const killed = owner.applyDamage(dmg, target.part, source);
          this.bus.emit('combat:hit', { targetId: owner.id, part: target.part, damage: dmg, killed, point: to, byPlayer: false });
          if (killed) {
            this.bus.emit('combat:kill', {
              attacker: bot.name,
              victim: owner.name,
              weapon: def.name,
              headshot: target.part === 'head',
              byPlayer: false,
              attackerTeam: bot.team,
              victimTeam: owner.team ?? null,
              attackerId: bot.id,
              victimId: owner.id,
            });
          }
          const hitEntry = this.byBot.get(owner as Bot);
          hitEntry?.model.onHit();
        }
      } else if (hit && (pellets === 1 || Math.random() < 0.4)) {
        this.bus.emit('combat:impact', {
          point: to,
          normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
          surface: this.surfaces.get(hit.collider.handle, hit.point),
        });
      }
      if (pellets === 1 || i < 3) this.effects.spawnShots([{ from: eye, to }], this.muzzle);
    }
    this.effects.muzzleFlash(this.muzzle, dir);
    this.audio.remoteGunshot(def.class, this.muzzle, this.muzzle.distanceTo(this.listener));
    // Gunfire alerts everyone in earshot (both teams).
    this.alert(eye, HEAR_SHOT, bot);
  }

  footstep(bot: Bot, sprinting: boolean): void {
    const d = bot.feet.distanceTo(this.listener);
    if (d < 30) {
      const hit = this.physics.raycast({ x: bot.feet.x, y: bot.feet.y + 0.2, z: bot.feet.z }, { x: 0, y: -1, z: 0 }, 0.6, Layer.WORLD);
      if (hit) this.audio.remoteFootstep(this.surfaces.get(hit.collider.handle, hit.point), bot.feet, sprinting);
    }
    this.alert(bot.feet, sprinting ? HEAR_STEP_SPRINT : HEAR_STEP, bot, 'step');
  }

  separation(bot: Bot, out: THREE.Vector3, wx = 0, wz = 0, speed = 0): THREE.Vector3 {
    out.set(0, 0, 0);
    this.steer = 0;
    const cx = Math.floor(bot.feet.x / CELL);
    const cz = Math.floor(bot.feet.z / CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const cell = this.grid.get((cx + i + 32768) * 65536 + (cz + j + 32768));
        if (!cell) continue;
        for (const o of cell) if (o !== bot) this.repel(bot, o, 1, out, wx, wz, speed);
      }
    }
    // Bots walk on the navmesh without colliding: keep them off the player too.
    this.repel(bot, this.player, 1.2, out, wx, wz, speed);
    if (this.steer !== 0) {
      // Step around whoever is in the way (to the right of the walking direction is (-wz, wx)).
      const k = THREE.MathUtils.clamp(this.steer, -1, 1) * speed * 0.9;
      out.x += -wz * k;
      out.z += wx * k;
    }
    return out;
  }

  /** Sideways steer summed over neighbours by `repel` (-1 left .. +1 right). */
  private steer = 0;

  private repel(bot: Bot, o: Combatant, scale: number, out: THREE.Vector3, wx: number, wz: number, speed: number): void {
    if (!o.alive || Math.abs(o.feet.y - bot.feet.y) > 1.5) return;
    const dx = bot.feet.x - o.feet.x;
    const dz = bot.feet.z - o.feet.z;
    const d = Math.hypot(dx, dz);
    const moving = speed > 0.1;
    const oSpeed = Math.hypot(o.velocity.x, o.velocity.z);
    const oMoving = !o.downed && oSpeed > MOVING;
    const radius = (moving || oMoving ? SEPARATION_RADIUS : SEPARATION_STANDING) * scale;
    if (d < radius) {
      // Whoever walks gives way: someone standing (on a post, in cover, down) is
      // only nudged by a walker, who goes around instead of shoving.
      const share = moving ? (oMoving ? 1 : 1.4) : oMoving ? 0.35 : 1;
      const k = (1 - d / radius) * SEPARATION_SPEED * share;
      if (d < 1e-3) {
        // Exactly on top of each other: split by id.
        out.x += (bot.id > o.id ? 1 : -1) * k;
      } else {
        out.x += (dx / d) * k;
        out.z += (dz / d) * k;
      }
    }
    if (!moving) return;
    // Someone ahead on this bot's line: veer before bumping into them.
    const ahead = -dx * wx - dz * wz;
    if (ahead < 0.05 || ahead > AVOID_AHEAD) return;
    const lat = dx * wz - dz * wx; // their offset to this bot's right
    if (Math.abs(lat) > AVOID_WIDTH * scale) return;
    // Walking toward each other: both keep right. Otherwise pass on the side away from them.
    const headOn = oMoving && (o.velocity.x * wx + o.velocity.z * wz) < -0.3 * oSpeed;
    const side = headOn || Math.abs(lat) < 0.05 ? 1 : -Math.sign(lat);
    this.steer += side * (1 - ahead / AVOID_AHEAD) * (1 - Math.abs(lat) / (AVOID_WIDTH * scale) * 0.5);
  }

  useGadget(bot: Bot, kind: 'rocket' | 'riflesmoke' | 'beacon' | 'mine', at: THREE.Vector3): boolean {
    const g = this.gadgets;
    if (!g) return false;
    const owner = { id: bot.id, name: bot.name, team: bot.team, squad: this.squadKey?.(bot) ?? null };
    const eye = bot.eyePos(new THREE.Vector3());
    if (kind === 'rocket') {
      // Aim a little high for the drop, with the bot's shakiness.
      const dist = eye.distanceTo(at);
      const t = dist / ROCKET.speed;
      const dir = at.clone().setY(at.y + 0.5 * ROCKET.gravity * t * t).sub(eye).normalize();
      const err = (this.skill.aimErrorMin * 1.5 * Math.PI) / 180;
      dir.x += (Math.random() - 0.5) * err;
      dir.y += (Math.random() - 0.5) * err;
      dir.z += (Math.random() - 0.5) * err;
      dir.normalize();
      g.fire('rocket', eye.clone().addScaledVector(dir, 0.8), dir, owner);
      this.audio.gadget('rocket', eye);
      return true;
    }
    if (kind === 'riflesmoke') {
      // Low arc onto the spot (flat-ground range formula; the loft is ~20-40°).
      const flat = new THREE.Vector3(at.x - eye.x, 0, at.z - eye.z);
      const range = flat.length();
      const v = RIFLE_SMOKE.speed;
      const s2 = (range * RIFLE_SMOKE.gravity) / (v * v);
      if (range < 5 || s2 >= 1) return false;
      const phi = 0.5 * Math.asin(s2);
      flat.normalize().multiplyScalar(Math.cos(phi)).setY(Math.sin(phi));
      g.fire('riflesmoke', eye.clone().addScaledVector(flat, 0.8), flat, owner, true);
      this.audio.gadget('rifle', eye);
      return true;
    }
    const spot = this.nav.closest(at) ?? at.clone();
    if (spot.distanceTo(bot.feet) > 3) return false;
    if (kind === 'beacon') g.placeBeacon(spot, bot.yaw, owner);
    else g.placeMine(spot, bot.yaw, owner);
    this.audio.gadget('place', spot);
    return true;
  }

  mineAhead(bot: Bot): boolean {
    const g = this.gadgets;
    if (!g || !g.mines.length) return false;
    const eye = bot.eyePos(new THREE.Vector3());
    for (const m of g.minesNear(bot.feet, 8, bot.team)) {
      if (m.seenBy.has(bot.team)) continue;
      // Close by it's hard to miss; farther it needs a look and some luck.
      const d = m.pos.distanceTo(bot.feet);
      if (d < 3.5 || (Math.random() < 0.3 && this.lineOfSight(eye, m.pos.clone().setY(m.pos.y + 0.1)))) m.seenBy.add(bot.team);
    }
    return g.knownMinesNear(bot.feet, 3, bot.team).length > 0;
  }

  ownMinesNear(bot: Bot, p: THREE.Vector3, r: number): number {
    return this.gadgets?.mines.filter((m) => m.owner.id === bot.id && m.pos.distanceTo(p) < r).length ?? 0;
  }

  nearOwnedZone(bot: Bot, r: number): boolean {
    // Stations stand at the zones: close to one of a zone we hold.
    for (const st of this.fort?.stations ?? []) {
      if (this.zoneOwner?.(st.zone) === bot.team && st.pos.distanceTo(bot.feet) < r) return true;
    }
    return false;
  }

  fortifiedAt(p: THREE.Vector3): boolean {
    for (const s of this.fort?.slots ?? []) {
      if (s.built && s.kind !== 'wire' && s.kind !== 'hedgehog' && s.pos.distanceToSquared(p) < 9) return true;
    }
    return false;
  }

  spotTaken(bot: Bot, p: THREE.Vector3): boolean {
    const cell = this.grid.get(cellKey(p.x, p.z));
    const check = (o: Bot): boolean =>
      o !== bot && o.alive && !o.hasGoal && Math.abs(o.feet.y - p.y) < 1.5 && Math.hypot(o.feet.x - p.x, o.feet.z - p.z) < SPOT_TAKEN;
    if (cell?.some(check)) return true;
    // The spot may sit on a cell edge: look around it too.
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        if (i === 0 && j === 0) continue;
        const c = this.grid.get(cellKey(p.x + i * SPOT_TAKEN, p.z + j * SPOT_TAKEN));
        if (c && c !== cell && c.some(check)) return true;
      }
    }
    return false;
  }

  /** Something audible happened at `pos`; enemies of `source` within `radius` hear it. */
  alert(pos: THREE.Vector3, radius: number, source: Combatant | null, kind: 'shot' | 'step' = 'shot'): void {
    for (const e of this.entries) {
      const b = e.bot;
      if (source && b.team === source.team) continue;
      if (b.feet.distanceTo(pos) < radius) b.hear(pos, this.time, kind);
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering

  private stepCount = 0;
  /** Ally chevrons and revive crosses: one point cloud each (a sprite per ally was a draw call each). */
  private markers!: THREE.Points;
  private crosses!: THREE.Points;
  private markerCount = 0;
  private crossCount = 0;
  /** Instanced far models, one per side. */
  /** Far crowd per side: [standing, running] (or one box model without the packed character). */
  private readonly far: Partial<Record<Team, THREE.InstancedMesh[]>> = {};
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly cullSphere = new THREE.Sphere();
  private readonly farMatrix = new THREE.Matrix4();
  private readonly farQuat = new THREE.Quaternion();
  private readonly farEuler = new THREE.Euler();
  private readonly farScale = new THREE.Vector3();

  /**
   * Updates models from interpolated sim state. Bots off screen are skipped
   * (no draw, no bone update); far ones are drawn as their side's instanced
   * far model; only near, on-screen bots get the skinned, animated one.
   */
  render(alpha: number, dt: number, camera: THREE.Camera): void {
    this.listener.copy(camera.position);
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const pos = this.tmp;
    let blobs = 0;
    const farCount: Record<Team, [number, number]> = { blue: [0, 0], red: [0, 0] };
    this.markerCount = this.crossCount = 0;
    // Marker size: a fixed share of the screen height, as the sprites had.
    (this.markers.material as THREE.PointsMaterial).size = 0.022 * window.innerHeight;
    (this.crosses.material as THREE.PointsMaterial).size = 0.03 * window.innerHeight;
    for (const e of this.entries) {
      const b = e.bot;
      if (b.alive && !e.wasAlive) this.refreshModel(e);
      if (!b.alive && e.wasAlive) e.model.onDeath();
      e.wasAlive = b.alive;
      pos.lerpVectors(b.prevFeet, b.feet, alpha);
      // Aboard: sitting (a jeep gunner stands), hidden inside armour.
      const v = b.riding ? this.vehicles?.get(b.riding.vehicle) : undefined;
      const seat = v && b.riding ? v.spec.seats[b.riding.seat] : undefined;
      const standing = seat?.role === 'gunner';
      if (seat && !standing) pos.y += b.eyeHeight - 1.2;
      const shown = seat ? seat.exposed : b.alive || b.downed || b.deadTime < RESPAWN_SEC - 0.2;
      const dist = pos.distanceTo(this.listener);
      this.cullSphere.center.set(pos.x, pos.y + 0.9, pos.z);
      this.cullSphere.radius = 1.4;
      const onScreen = shown && this.frustum.intersectsSphere(this.cullSphere);
      this.marker(e, pos, dist);
      if (!onScreen || (dist > FAR_MODEL && !seat)) {
        e.model.root.visible = false;
        if (onScreen) {
          // Far away: one instance of the side's simple model (lying down when down or dead).
          const lying = !b.alive;
          this.farEuler.set(lying ? -Math.PI / 2 : 0, b.yaw, 0, 'YXZ');
          this.farQuat.setFromEuler(this.farEuler);
          this.farScale.set(1, lying ? 1 : b.crouching ? 0.72 : 1, 1);
          this.farMatrix.compose(lying ? pos.clone().setY(pos.y + 0.2) : pos, this.farQuat, this.farScale);
          const set = this.far[b.team]!;
          const running = set.length > 1 && b.alive && b.horizontalSpeed > 1.2 && !b.crouching;
          set[running ? 1 : 0]!.setMatrixAt(farCount[b.team][running ? 1 : 0]++, this.farMatrix);
        }
        continue;
      }
      e.model.update(pos, {
        speed: seat ? 0 : b.horizontalSpeed,
        crouch: seat ? 0 : b.crouchAmount(dt),
        yaw: seat && !standing ? v!.yaw : b.yaw,
        aimPitch: b.aimPitch,
        deadFor: b.alive ? -1 : b.downed ? b.downTime : 10,
        dt,
        seated: !!seat && !standing,
        moveYaw: Math.atan2(-(b.feet.x - b.prevFeet.x), -(b.feet.z - b.prevFeet.z)),
        reloading: b.weapon.reloading,
        firing: b.firingUntil > this.time,
        distance: dist,
      });
      e.model.root.visible = true;
      if (!seat) {
        // Wider under a body lying on the ground.
        const s = BLOB_SIZE * (b.alive ? 1 : 1.5);
        this.blobMatrix.makeScale(s, 1, s).setPosition(pos.x, pos.y + 0.02, pos.z);
        this.blobs.setMatrixAt(blobs++, this.blobMatrix);
      }
    }
    this.blobs.count = blobs;
    this.blobs.instanceMatrix.needsUpdate = true;
    for (const team of ['blue', 'red'] as const) {
      this.far[team]!.forEach((m, i) => {
        m.count = farCount[team][i]!;
        m.instanceMatrix.needsUpdate = true;
      });
    }
    for (const [pts, n] of [[this.markers, this.markerCount], [this.crosses, this.crossCount]] as const) {
      pts.geometry.setDrawRange(0, n);
      pts.geometry.getAttribute('position').needsUpdate = true;
      const col = pts.geometry.getAttribute('color');
      if (col) col.needsUpdate = true;
    }
  }

  /** A point cloud of markers: chevrons coloured per point, or green revive crosses. */
  private makeMarkerPoints(n: number, cross: boolean): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, n) * 3), 3));
    if (!cross) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(Math.max(1, n) * 3), 3));
    geo.setDrawRange(0, 0);
    const sprite = cross ? this.reviveMarker() : this.markerMaterial('#ffffff');
    const mat = new THREE.PointsMaterial({
      map: sprite.map,
      vertexColors: !cross,
      sizeAttenuation: false,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      alphaTest: 0.05,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 10;
    pts.layers.set(LAYER_FX);
    return pts;
  }

  /** Ally chevron (revive cross when down): squad mates and the downed always, others within MARKER_RANGE. */
  private marker(e: BotEntry, pos: THREE.Vector3, dist: number): void {
    if (!e.marker) return;
    e.marker.visible = false;
    const b = e.bot;
    if (!(b.alive || b.downed) || !(dist < MARKER_RANGE || !!e.leader || b.downed)) return;
    if (b.downed) {
      (this.crosses.geometry.getAttribute('position') as THREE.BufferAttribute).setXYZ(this.crossCount++, pos.x, pos.y + 0.9, pos.z);
      return;
    }
    const i = this.markerCount++;
    (this.markers.geometry.getAttribute('position') as THREE.BufferAttribute).setXYZ(i, pos.x, pos.y + b.eyeHeight + 0.55, pos.z);
    // Squad mates green, other allies blue.
    const col = this.markers.geometry.getAttribute('color') as THREE.BufferAttribute;
    if (e.leader) col.setXYZ(i, 0.42, 0.86, 0.42);
    else col.setXYZ(i, 0.3, 0.55, 1);
  }

  private makeBlobs(n: number): THREE.InstancedMesh {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return mesh;
  }

  /** Chevron over allies (seen through walls, constant screen size). */
  private makeMarker(color: string): THREE.Sprite {
    const s = new THREE.Sprite(this.markerMaterial(color));
    s.scale.set(0.022, 0.022, 1);
    s.renderOrder = 10;
    s.layers.set(LAYER_FX);
    return s;
  }

  /** Green cross over downed allies (seen through walls). */
  private reviveMarker(): THREE.SpriteMaterial {
    if (!this.downMaterial) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      g.fillStyle = '#6bdc6b';
      g.strokeStyle = 'rgba(0,0,0,0.65)';
      g.lineWidth = 4;
      g.beginPath();
      for (const [x, y] of [[24, 8], [40, 8], [40, 24], [56, 24], [56, 40], [40, 40], [40, 56], [24, 56], [24, 40], [8, 40], [8, 24], [24, 24]]) g.lineTo(x!, y!);
      g.closePath();
      g.stroke();
      g.fill();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.downMaterial = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false });
    }
    return this.downMaterial;
  }

  private markerMaterial(color: string): THREE.SpriteMaterial {
    let mat = this.markerMaterials.get(color);
    if (!mat) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      g.fillStyle = color;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(12, 18);
      g.lineTo(32, 46);
      g.lineTo(52, 18);
      g.lineTo(32, 30);
      g.closePath();
      g.stroke();
      g.fill();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false });
      this.markerMaterials.set(color, mat);
    }
    return mat;
  }

  dispose(): void {
    for (const e of this.entries) {
      e.bot.dispose(this.physics);
      e.model.dispose();
      e.marker?.removeFromParent();
    }
    this.entries.length = 0;
    this.blobs.removeFromParent();
    this.blobs.geometry.dispose();
    (this.blobs.material as THREE.MeshBasicMaterial).map?.dispose();
  }
}
