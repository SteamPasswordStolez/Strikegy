import * as THREE from 'three';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { SurfaceRegistry } from '@/physics/surfaces';
import type { GameBus } from '@/core/events';
import { computeDamage, type DamageSource, type HitboxRegistry } from '@/combat/Hitboxes';
import type { AudioSystem } from '@/audio/AudioSystem';
import type { Effects } from '@/render/Effects';
import { LAYER_FX } from '@/render/layers';
import type { SpawnPoint, Team } from '@/world/mapTypes';
import { WEAPONS, damageAtDistance, type WeaponDef, type WeaponId } from '@/weapons/weaponData';
import { Bot, type BotServices } from './Bot';
import type { NavWorld } from './NavWorld';
import { SKILLS, type BotSkill, type Difficulty } from './difficulty';
import { SoldierModel } from './SoldierModel';
import { PLAYER_TEAM, otherTeam, type Combatant } from './types';

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
/** Neighbour grid cell (m); at least the separation radius. */
const CELL = 2;
const cellKey = (x: number, z: number): number => (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(z / CELL) + 32768);
/** How long one pair's line-of-sight result is reused by the other side. */
const SIGHT_SHARE_SEC = 0.09;
/** Beyond this distance from the viewer (and out of combat) bots move at half rate. */
const FAR_SQ = 60 * 60;
const COVER_SEARCHES_PER_STEP = 3;
const COVER_SAMPLES = 10;

/** Loadout pool: weighted so most bots carry rifles. */
const POOL: [WeaponId, number][] = [
  ['ar1', 3],
  ['ar2', 2],
  ['ar3', 1],
  ['smg1', 2],
  ['smg2', 1],
  ['lmg1', 1],
  ['dmr1', 1],
  ['sg1', 1],
];

const NAMES: Record<Team, string[]> = {
  blue: ['Hawk', 'Bishop', 'Rook', 'Nomad', 'Sparrow', 'Atlas', 'Echo', 'Kodiak'],
  red: ['Viper', 'Jackal', 'Cobra', 'Wraith', 'Mako', 'Talon', 'Scorpion', 'Raven'],
};

export interface BotOptions {
  allies: number;
  enemies: number;
  difficulty: Difficulty;
}

/** Game-mode hooks: where squads go and where bots respawn. */
export interface BotModeHooks {
  /** Places worth going for, best first (empty = push toward the enemy base). */
  objectives(team: Team): { pos: THREE.Vector3; radius: number }[];
  /** Respawn position for a bot (given the squad objective it is assigned to). */
  spawnAt(bot: Bot, objective: THREE.Vector3 | null): { pos: THREE.Vector3; yaw: number };
}

/** A squad as the bots see it: members and, for the player's squad, the leader to follow. */
export interface BotSquad {
  index: number;
  botIds: number[];
  leader: Combatant | null;
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
  role: 'assault' | 'flank';
  flankSide: number;
  wasAlive: boolean;
  /** Alive at the end of the last sim step (for death events). */
  simAlive: boolean;
  /** Mode objective this bot is assigned to, if any. */
  objective: { pos: THREE.Vector3; radius: number } | null;
  squad: number;
  /** Squad leader to stay close to (the player's squad), else null. */
  leader: Combatant | null;
  /** Slot in the leader's formation (1..). */
  slot: number;
}

function pickWeapon(): WeaponDef {
  const total = POOL.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [id, w] of POOL) {
    r -= w;
    if (r <= 0) return WEAPONS[id];
  }
  return WEAPONS.ar1;
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
  private readonly teams: Record<Team, TeamState>;
  private readonly damageScale: number;
  private readonly listener = new THREE.Vector3();
  private readonly enemies: Record<Team, Combatant[]> = { blue: [], red: [] };
  private readonly grid = new Map<number, Bot[]>();
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
    SoldierModel.prewarm(['blue', 'red'], POOL.map(([id]) => WEAPONS[id]));

    const add = (team: Team, n: number) => {
      for (let i = 0; i < n; i++) {
        const bot = new Bot(NAMES[team][i % NAMES[team].length]!, team, pickWeapon(), physics, registry);
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
        });
      }
    };
    add(PLAYER_TEAM, opts.allies);
    add(otherTeam(PLAYER_TEAM), opts.enemies);
    this.blobs = this.makeBlobs(this.entries.length);
    scene.add(this.blobs);

    bus.on('combat:kill', (e) => {
      if (e.attackerTeam && e.attackerTeam !== e.victimTeam) this.teams[e.attackerTeam].kills++;
    });
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
    for (const e of this.entries) {
      const b = e.bot;
      b.far = b.feet.distanceToSquared(this.listener) > FAR_SQ && !b.inCombat(this.time);
      b.step(dt, this);
      if (e.simAlive && !b.alive) this.bus.emit('combatant:died', { team: b.team, id: b.id });
      if (!b.alive && b.deadTime > RESPAWN_SEC + b.respawnPenalty) this.respawn(b);
      e.simAlive = b.alive;
    }
  }

  /** Groups bots into squads; bots in a squad with a leader follow it. Squad-mates of the player get green markers. */
  setSquads(squads: BotSquad[]): void {
    for (const sq of squads) {
      sq.botIds.forEach((id, k) => {
        const e = this.entries.find((x) => x.bot.id === id);
        if (!e) return;
        e.squad = sq.index;
        e.leader = sq.leader;
        e.slot = k + 1;
        if (e.marker && sq.leader) e.marker.material = this.markerMaterial('#6bdc6b');
      });
    }
  }

  /** Re-plan squad objectives now (e.g. a zone changed hands). */
  replan(team: Team): void {
    this.teams[team].planAt = Math.min(this.teams[team].planAt, this.time + 0.5 + Math.random());
  }

  private respawn(bot: Bot): void {
    if (this.hooks) {
      const e = this.entries.find((x) => x.bot === bot);
      const at = this.hooks.spawnAt(bot, e?.objective?.pos ?? null);
      bot.spawn(at.pos, at.yaw, pickWeapon());
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
    bot.spawn(pos, Math.atan2(ex, ez), pickWeapon());
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
      for (const e of this.entries) {
        if (e.bot.team !== team) continue;
        const k = Math.max(0, squads.indexOf(e.squad));
        const g = goals[k % n]!;
        e.objective = g;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * g.radius * 0.7;
        e.offset.set(Math.cos(a) * r, 0, Math.sin(a) * r);
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
    const e = this.entries.find((x) => x.bot === bot)!;
    const follow = this.followPoint(e);
    if (follow) return follow;
    if (e.objective) {
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

  /** Formation spot behind the squad leader, or null when not following. */
  private followPoint(e: BotEntry): THREE.Vector3 | null {
    const l = e.leader;
    if (!l || !l.alive) return null;
    // Staggered behind the leader, alternating sides.
    const side = e.slot % 2 ? 1 : -1;
    const ang = l.yaw + Math.PI + side * (0.45 + 0.2 * e.slot);
    const dist = 4 + e.slot * 1.8;
    const p = new THREE.Vector3(l.feet.x - Math.sin(ang) * dist, l.feet.y, l.feet.z - Math.cos(ang) * dist);
    return this.nav.closest(p) ?? l.feet.clone();
  }

  mustRegroup(bot: Bot): boolean {
    const l = this.entries.find((x) => x.bot === bot)!.leader;
    return !!l && l.alive && l.feet.distanceTo(bot.feet) > 18;
  }

  squadGoalMoved(bot: Bot, current: THREE.Vector3): boolean {
    const e = this.entries.find((x) => x.bot === bot)!;
    const l = e.leader;
    if (!l || !l.alive) return false;
    // Re-path when the leader has walked well away from where we were heading.
    return l.feet.distanceTo(current) > 10;
  }

  teamSighting(team: Team): { pos: THREE.Vector3; time: number } | null {
    return this.teams[team].sighting;
  }

  reportSighting(team: Team, pos: THREE.Vector3): void {
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
    const e = this.entries.find((x) => x.bot === bot)!;
    e.model.muzzleWorld(this.muzzle);
    for (let i = 0; i < pellets; i++) {
      const r = Math.tan(spread) * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const d = dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const max = def.range * 1.5;
      const hit = this.physics.raycast(eye, d, max, Layer.WORLD | Layer.HITBOX, undefined, bot.hitboxes.body);
      const to = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : eye.clone().addScaledVector(d, max);
      const target = hit ? this.registry.lookup(hit.collider.handle) : undefined;
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
          const hitEntry = this.entries.find((x) => x.bot === owner);
          hitEntry?.model.onHit();
        }
      } else if (hit && (pellets === 1 || Math.random() < 0.4)) {
        this.bus.emit('combat:impact', {
          point: to,
          normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
          surface: this.surfaces.get(hit.collider.handle),
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
      if (hit) this.audio.remoteFootstep(this.surfaces.get(hit.collider.handle), bot.feet, sprinting);
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
