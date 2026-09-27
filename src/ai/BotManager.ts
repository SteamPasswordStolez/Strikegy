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
import type { NavWorld } from './NavWorld';
import { SKILLS, type BotSkill, type Difficulty } from './difficulty';
import { SoldierModel } from './SoldierModel';
import { BOT_WEAPONS, rollPersonality, weaponFor } from './personality';
import { lobVelocity } from './ballistics';
import type { Throwables } from '@/weapons/Throwables';
import { PLAYER_TEAM, otherTeam, type Combatant } from './types';
import type { WaterMap } from '@/world/water';

const DEG = Math.PI / 180;
const RESPAWN_SEC = 5;
/** Bots' bullets do a bit less than the player's at lower difficulties. */
const DAMAGE_SCALE: Record<Difficulty, number> = { easy: 0.55, normal: 0.75, hard: 0.95 };
/** How far gunfire and footsteps carry for bots (meters). */
const HEAR_SHOT = 70;
const HEAR_STEP = 13;
/** Bots closer than this push apart (meters), at up to SEPARATION_SPEED m/s. */
const SEPARATION_RADIUS = 1.1;
const SEPARATION_SPEED = 2.2;
const BLOB_SIZE = 1.1;
/** Cover searches allowed per sim step across all bots (each is ~0.1-0.3 ms). */
const squadKey = (team: Team, squad: number): string => `${team}:${squad}`;
/** Neighbour grid cell (m); at least the separation radius. */
const CELL = 2;
const cellKey = (x: number, z: number): number => (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(z / CELL) + 32768);
/** How long one pair's line-of-sight result is reused by the other side. */
const SIGHT_SHARE_SEC = 0.09;
/** Beyond this distance from the viewer (and out of combat) bots move at half rate. */
const FAR_SQ = 60 * 60;
const COVER_SEARCHES_PER_STEP = 3;
/** A round passing within this distance of a bot's head suppresses it (m). */
const NEAR_MISS = 2.5;
/** Suppression added by one rifle round passing right by (less for pellets, further away). */
const NEAR_MISS_AMOUNT = 0.22;
/** Frag blasts suppress everyone within this radius (m). */
const BLAST_SUPPRESS = 14;
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
/** Foliage grid cell (m) and sampling step along a sight line (m). */
const LEAF_CELL = 3;
const LEAF_STEP = 2;
/** Foliage per unit of tree scale in a cell, per sample. */
const LEAF_WEIGHT = 0.25;
const COVER_SAMPLES = 10;

const NAMES: Record<Team, string[]> = {
  blue: ['Hawk', 'Bishop', 'Rook', 'Nomad', 'Sparrow', 'Atlas', 'Echo', 'Kodiak'],
  red: ['Viper', 'Jackal', 'Cobra', 'Wraith', 'Mako', 'Talon', 'Scorpion', 'Raven'],
};

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
  /** Unit direction attacks come from. */
  front?: THREE.Vector3;
}

/** Game-mode hooks: where squads go and where bots respawn. */
export interface BotModeHooks {
  /** Places worth going for, best first (empty = push toward the enemy base). */
  objectives(team: Team): BotObjective[];
  /** Respawn position for a bot (given the squad objective it is assigned to). */
  spawnAt(bot: Bot, objective: THREE.Vector3 | null): { pos: THREE.Vector3; yaw: number };
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
  sighting: { pos: THREE.Vector3; time: number } | null;
  base: THREE.Vector3;
  spawns: SpawnPoint[];
  kills: number;
}

interface BotEntry {
  bot: Bot;
  model: SoldierModel;
  marker: THREE.Sprite | null;
  /** Stable offset around the squad objective, re-rolled each plan. */
  offset: THREE.Vector3;
  /** Flankers swing around the side of a fight the squad is in. */
  role: 'assault' | 'flank';
  flankSide: number;
  wasAlive: boolean;
  /** Alive at the end of the last sim step (for death events). */
  simAlive: boolean;
  /** Mode objective this bot is assigned to, if any. */
  objective: BotObjective | null;
  /** Flank run in progress, and the contact (its start time) it was for. */
  flankGoal: THREE.Vector3 | null;
  flankFor: number;
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

/** A weapon that suits the bot's fighting style (re-rolled every life). */
function loadout(bot: Bot): WeaponDef {
  return WEAPONS[weaponFor(bot.personality)];
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
  /** Set by the game mode (Zone): squad objectives and respawn points. */
  hooks: BotModeHooks | null = null;
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
      return { objective: base.clone(), planAt: 0, sighting: null, base, spawns: own, kills: 0 };
    };
    this.teams = { blue: teamState('blue'), red: teamState('red') };
    // Build every soldier + weapon mesh now rather than hitching on first respawn.
    SoldierModel.prewarm(['blue', 'red'], BOT_WEAPONS.map((id) => WEAPONS[id]));

    const add = (team: Team, n: number) => {
      for (let i = 0; i < n; i++) {
        const style = rollPersonality();
        const bot = new Bot(NAMES[team][i % NAMES[team].length]!, team, WEAPONS[weaponFor(style)], physics, registry, style);
        this.respawn(bot);
        const model = new SoldierModel(team, bot.def);
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
          objective: null,
          squad: -1,
          leader: null,
          slot: 0,
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

    bus.on('combat:kill', (e) => {
      if (e.attackerTeam && e.attackerTeam !== e.victimTeam) this.teams[e.attackerTeam].kills++;
    });
    // Explosions nearby rattle everyone (either side), frags more than the rest.
    bus.on('grenade:detonate', (e) => {
      if (e.type !== 'frag') return;
      for (const en of this.entries) {
        const b = en.bot;
        const d = b.feet.distanceTo(e.point);
        if (b.alive && d < BLAST_SUPPRESS) b.suppress(0.9 * (1 - d / BLAST_SUPPRESS), e.point, this.time);
      }
    });
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
    this.dodgeGrenades();
    for (const e of this.entries) {
      const b = e.bot;
      b.far = b.feet.distanceToSquared(this.listener) > FAR_SQ && !b.inCombat(this.time);
      b.step(dt, this);
      if (e.simAlive && !b.alive) {
        this.bus.emit('combatant:died', { team: b.team, id: b.id });
        this.release(e);
        this.shareKill(b);
      }
      if (!b.alive && b.deadTime > RESPAWN_SEC + b.respawnPenalty) this.respawn(b);
      e.simAlive = b.alive;
    }
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
    // The bridge with the shortest straight-line detour.
    let best: readonly [number, number] | null = null;
    let bestLen = Infinity;
    for (const c of w.crossings) {
      const len = Math.hypot(c[0] - bot.feet.x, c[1] - bot.feet.z) + Math.hypot(to.x - c[0], to.z - c[1]);
      if (len < bestLen) {
        bestLen = len;
        best = c;
      }
    }
    const allowed = BRIDGE_DETOUR * (1.2 - bot.personality.aggression * 0.7);
    if (!best || bestLen > direct + allowed) return true;
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

  /** New model on respawn (the bot may carry a different weapon). */
  private refreshModel(e: BotEntry): void {
    e.model.dispose();
    e.model = new SoldierModel(e.bot.team, e.bot.def);
    this.scene.add(e.model.root);
  }

  /** Squad planning: pick an objective every few seconds, re-roll member offsets. */
  private plan(team: Team): void {
    const t = this.teams[team];
    if (this.time < t.planAt) return;
    t.planAt = this.time + 7 + Math.random() * 4;
    const goals = this.hooks?.objectives(team) ?? [];
    if (goals.length > 0) {
      // Whole squads go for an objective together; about half the squads per objective.
      const squads = [...new Set(this.entries.filter((e) => e.bot.team === team).map((e) => e.squad))].sort((a, b) => a - b);
      const n = Math.min(goals.length, Math.max(1, Math.ceil(squads.length / 2)));
      // Each squad picks a way in (left, straight or right) so they don't all funnel down one street.
      const sides = squads.map(() => Math.floor(Math.random() * 3) - 1);
      const guards = new Map<BotObjective, BotEntry[]>();
      for (const e of this.entries) {
        if (e.bot.team !== team) continue;
        const k = Math.max(0, squads.indexOf(e.squad));
        const g = goals[k % n]!;
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
    for (const cell of this.grid.values()) cell.length = 0;
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
    if (hit && this.time - hit.time < SIGHT_SHARE_SEC) return hit.visible;
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
    const follow = this.followPoint(e);
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

  /** Formation spot behind the squad leader, or null when not following. */
  private followPoint(e: BotEntry): THREE.Vector3 | null {
    const l = e.leader;
    if (!l || !l.alive) return null;
    const side = e.slot % 2 ? 1 : -1;
    const speed = Math.hypot(l.velocity.x, l.velocity.z);
    let ang: number;
    let dist: number;
    if (speed > 1) {
      // On the move: staggered behind, along the way the leader is actually going.
      const heading = Math.atan2(-l.velocity.x, -l.velocity.z);
      ang = heading + Math.PI + side * (0.45 + 0.2 * e.slot);
      dist = 4 + e.slot * 1.8;
      e.watch = null;
    } else {
      // Stopped: fan out around the leader and cover the other directions.
      const posts = [2.4, -2.4, 1.3, -1.3, Math.PI];
      ang = l.yaw + posts[(e.slot - 1) % posts.length]!;
      dist = 4.5 + (e.slot > 2 ? 1.5 : 0);
      e.watch = new THREE.Vector3(-Math.sin(ang), 0, -Math.cos(ang));
    }
    const p = new THREE.Vector3(l.feet.x - Math.sin(ang) * dist, l.feet.y, l.feet.z - Math.cos(ang) * dist);
    return this.nav.closest(p) ?? l.feet.clone();
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

  /** Walking with a leader who is walking or crouching: don't sprint ahead. */
  keepPace(bot: Bot): boolean {
    const l = this.entryOf(bot).leader;
    return !!l && l.alive && Math.hypot(l.velocity.x, l.velocity.z) < 3.3 && l.feet.distanceTo(bot.feet) < 14;
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

  /** The player spotted / was shot by an enemy at `pos`: tell the player's team and squad. */
  playerContact(pos: THREE.Vector3): void {
    this.noteSighting(this.player.team, pos);
    const e = this.entries.find((x) => x.leader === this.player);
    if (e) this.noteContact(this.player.team, e.squad, pos);
  }

  mustRegroup(bot: Bot): boolean {
    const l = this.entryOf(bot).leader;
    return !!l && l.alive && l.feet.distanceTo(bot.feet) > 18;
  }

  squadGoalMoved(bot: Bot, current: THREE.Vector3): boolean {
    const e = this.entryOf(bot);
    if (e.flankGoal && e.flankGoal.distanceTo(current) > 4 && this.isFlanking(bot)) return true;
    const l = e.leader;
    if (!l || !l.alive) return false;
    // Re-path when the leader has walked well away from where we were heading.
    return l.feet.distanceTo(current) > 10;
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
    e.model.muzzleWorld(this.muzzle);
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
    this.alert(bot.feet, sprinting ? HEAR_STEP * 1.4 : HEAR_STEP, bot);
  }

  separation(bot: Bot, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    const cx = Math.floor(bot.feet.x / CELL);
    const cz = Math.floor(bot.feet.z / CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const cell = this.grid.get((cx + i + 32768) * 65536 + (cz + j + 32768));
        if (!cell) continue;
        for (const o of cell) if (o !== bot) this.repel(bot, o, SEPARATION_RADIUS, out);
      }
    }
    // Bots walk on the navmesh without colliding: keep them off the player too.
    this.repel(bot, this.player, SEPARATION_RADIUS * 1.2, out);
    return out;
  }

  private repel(bot: Bot, o: Combatant, radius: number, out: THREE.Vector3): void {
    {
      if (!o.alive || Math.abs(o.feet.y - bot.feet.y) > 1.5) return;
      const dx = bot.feet.x - o.feet.x;
      const dz = bot.feet.z - o.feet.z;
      const d = Math.hypot(dx, dz);
      if (d >= radius) return;
      const k = (1 - d / radius) * SEPARATION_SPEED;
      if (d < 1e-3) {
        // Exactly on top of each other: split by id.
        out.x += (bot.id > o.id ? 1 : -1) * k;
      } else {
        out.x += (dx / d) * k;
        out.z += (dz / d) * k;
      }
    }
  }

  /** Something audible happened at `pos`; enemies of `source` within `radius` hear it. */
  alert(pos: THREE.Vector3, radius: number, source: Combatant | null): void {
    for (const e of this.entries) {
      const b = e.bot;
      if (source && b.team === source.team) continue;
      if (b.feet.distanceTo(pos) < radius) b.hear(pos, this.time);
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering

  /** Updates models from interpolated sim state. */
  render(alpha: number, dt: number, listener: THREE.Vector3): void {
    this.listener.copy(listener);
    const pos = this.tmp;
    let blobs = 0;
    for (const e of this.entries) {
      const b = e.bot;
      if (b.alive && !e.wasAlive) this.refreshModel(e);
      if (!b.alive && e.wasAlive) e.model.onDeath();
      e.wasAlive = b.alive;
      pos.lerpVectors(b.prevFeet, b.feet, alpha);
      e.model.update(pos, {
        speed: b.horizontalSpeed,
        crouch: b.crouchAmount(dt),
        yaw: b.yaw,
        aimPitch: b.aimPitch,
        deadFor: b.alive ? -1 : b.deadTime,
        dt,
      });
      e.model.root.visible = b.alive || b.deadTime < RESPAWN_SEC - 0.2;
      if (e.model.root.visible) {
        // Wider under a body lying on the ground.
        const s = BLOB_SIZE * (b.alive ? 1 : 1.5);
        this.blobMatrix.makeScale(s, 1, s).setPosition(pos.x, pos.y + 0.02, pos.z);
        this.blobs.setMatrixAt(blobs++, this.blobMatrix);
      }
      if (e.marker) {
        e.marker.visible = b.alive;
        e.marker.position.set(pos.x, pos.y + b.eyeHeight + 0.55, pos.z);
      }
    }
    this.blobs.count = blobs;
    this.blobs.instanceMatrix.needsUpdate = true;
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
