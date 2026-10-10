import * as THREE from 'three';
import { Layer, RAPIER, groups, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { HitPart } from '@/core/events';
import type { DamageSource, Damageable, HitboxRegistry } from '@/combat/Hitboxes';
import { CharacterHitboxes } from '@/combat/CharacterHitboxes';
import { Health } from '@/player/health';
import { MOVE, approachVelocity, capsuleHalfHeight } from '@/player/movement';
import type { Team } from '@/world/mapTypes';
import { WADE_DEPTH, WADE_SPEED } from '@/world/water';
import { WeaponState } from '@/weapons/WeaponState';
import type { WeaponDef } from '@/weapons/weaponData';
import type { NavWorld } from './NavWorld';
import type { BotSkill } from './difficulty';
import { chooseAction, type BotAction } from './brain';
import { aimErrorDeg, noticeTime, turnToward, wrapAngle, yawPitchOf } from './aim';
import type { Combatant } from './types';
import { rollPersonality, type Personality } from './personality';
import { COMBAT_WINDOW } from '@/modes/squads';
import { CLASSES, DOWN as DOWN_RULES, MEDKIT, REVIVE_RANGE, type ClassId } from '@/data/classes';
import type { FortJob } from '@/modes/fortify';
import { GADGETS, classGadget, type GadgetId } from '@/data/gadgets';

const DEG = Math.PI / 180;
const DOWN = { x: 0, y: -1, z: 0 };
const PERCEIVE_EVERY = 0.1;
/** Enemies in view a bot checks line of sight to per look (the ones that matter most). */
const PERCEIVE_LOOKS = 8;
const THINK_EVERY = 0.25;
const CROUCH_HEIGHT = MOVE.crouchHeight;
/** Teammates' enemy sightings farther than this (m) don't send a bot hunting. */
const TEAM_INTEL_RANGE = 45;
/** How far off the path centre a bot keeps (m, at lane = +-1). */
const LANE_WIDTH = 1.8;
/** Suppression lost per second. */
const SUPPRESSION_DECAY = 0.3;
/** Radius for weighing local odds (known enemies vs friends around). */
const ODDS_RANGE = 40;
/** Melee: in this reach (m) with an empty or reloading gun, or this close anyway; a swing every `every` s. */
const MELEE_BOT = { reach: 2, close: 1.3, every: 0.9 };
/** Hit this many times at one cover spot: find another (not within 3 m of it). */
const COVER_HITS = 2;
/** Overwatch: cover farther than this (m) isn't worth going to; the bot keeps moving instead. */
const OVERWATCH_COVER = 8;

/** Preferred fighting distance per weapon class (meters). */
const PREFERRED_RANGE: Record<WeaponDef['class'], number> = { ar: 20, smg: 10, lmg: 24, sg: 6, dmr: 32, sr: 40, pistol: 10 };

/** Services the bot needs from the world (implemented by BotManager). */
export interface BotServices {
  readonly time: number;
  readonly physics: PhysicsWorld;
  readonly nav: NavWorld;
  readonly skill: BotSkill;
  enemiesOf(team: Team): readonly Combatant[];
  /** Clear line of sight between two points (world geometry and smoke). */
  lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean;
  /** Line of sight from `eye` to the head or chest of `other` (shared with `other` for a moment). */
  canSee(self: Combatant, other: Combatant, eye: THREE.Vector3, head: THREE.Vector3, chest: THREE.Vector3): boolean;
  /** Cover spot against `threat`; undefined when the search budget for this step is spent (ask again later). */
  findCover(bot: Bot, threat: THREE.Vector3): THREE.Vector3 | null | undefined;
  /** Where this bot should head when nothing is going on (squad objective / flank). */
  squadGoal(bot: Bot): THREE.Vector3;
  /** The team's most recent sighting of any enemy. */
  teamSighting(team: Team): { pos: THREE.Vector3; time: number } | null;
  reportSighting(bot: Bot, pos: THREE.Vector3): void;
  /** The bot's squad's current fight (shared over any distance), if recent. */
  squadContact(bot: Bot): { pos: THREE.Vector3; time: number } | null;
  /** On a flank run around the squad's fight (squadGoal returns the flank point). */
  isFlanking(bot: Bot): boolean;
  /** Where to look when idle at a post, or null. */
  watchDir(bot: Bot): THREE.Vector3 | null;
  /** Following a leader who is walking: don't sprint. */
  keepPace(bot: Bot): boolean;
  /** Takes on a job at a zone (build, restock or resupply at a station) within `radius`: the job and where to stand. */
  claimWork(bot: Bot, radius: number): { job: FortJob; stand: THREE.Vector3; look: THREE.Vector3 } | null;
  releaseWork(bot: Bot): void;
  /** Speed factor where a soldier stands (barbed wire slows, 1 elsewhere). */
  slowAt(p: THREE.Vector3): number;
  /** One step of work at the job; false when it is over. */
  doWork(bot: Bot, job: FortJob, dt: number): boolean;
  /** Lobs a grenade onto `at`; false if it can't (out of reach, team just threw one). */
  throwGrenade(bot: Bot, type: 'frag' | 'smoke' | 'flash', at: THREE.Vector3): boolean;
  /** Walls or terrain between two points (smoke does not count: bullets go through it). */
  wallsBlock(from: THREE.Vector3, to: THREE.Vector3): boolean;
  /** Inside an active smoke cloud. */
  inSmoke(p: THREE.Vector3): boolean;
  /** This bot has noticed enemy `e` (shown on its team's minimap). */
  spot(bot: Bot, e: Combatant): void;
  /** Living members of `team` within `radius` of `pos` (the player included). */
  alliesNear(team: Team, pos: THREE.Vector3, radius: number): number;
  /** Living enemies of `team` within `radius` of `pos`. */
  enemiesNear(team: Team, pos: THREE.Vector3, radius: number): number;
  /** The window this bot holds, when standing at it. */
  postHere(bot: Bot): THREE.Vector3 | null;
  /** Has a window assigned (standing at it or not). */
  hasPost(bot: Bot): boolean;
  /** Inside a building's footprint. */
  insideBuilding(p: THREE.Vector3): boolean;
  /** Resolves one trigger pull (all pellets) along `dir` from the bot's eye. */
  fire(bot: Bot, dir: THREE.Vector3): void;
  footstep(bot: Bot, sprinting: boolean): void;
  /** The squad goal moved enough that a bot heading to the old one should re-path (following a leader). */
  squadGoalMoved(bot: Bot, current: THREE.Vector3): boolean;
  /** Far from the squad leader: prefer catching up. */
  mustRegroup(bot: Bot): boolean;
  /**
   * Push away from nearby bots (m/s, horizontal) so they don't stack up; a bot
   * walking along (wx, wz) at `speed` also steps around whoever is ahead.
   */
  separation(bot: Bot, out: THREE.Vector3, wx?: number, wz?: number, speed?: number): THREE.Vector3;
  /** Someone else already stands at `p` (a bot heading there stops beside them). */
  spotTaken(bot: Bot, p: THREE.Vector3): boolean;
  /**
   * The first pass of perception (the wasm core, `crowd_perceive`): enemies in
   * view looking along (yaw, pitch) — within sight (`airSight` for anyone in an
   * aircraft), inside the half angle of the view cone and, unless `viewUpDeg`
   * is null, within that much of `pitch`, or within 1.5 m — scored (target,
   * last attacker, being noticed, firing), with the notice of everyone else
   * fading. Returns how many of the best (up to `maxLook`) to look at;
   * `viewHit(i)` / `viewDist(i)` / `viewOff(i)` give each, best first.
   */
  perceiveFirst(
    bot: Bot,
    sight: number,
    airSight: number,
    halfFovDeg: number,
    viewUpDeg: number | null,
    yaw: number,
    pitch: number,
    dt: number,
    count: number,
    target: Combatant | null,
    attackerId: number,
    maxLook: number,
  ): number;
  viewHit(i: number): Combatant;
  viewDist(i: number): number;
  viewOff(i: number): number;
  /** How far `bot` has noticed `e` (0..1.5; 1 = noticed). */
  noticeOf(bot: Bot, e: Combatant): number;
  setNotice(bot: Bot, e: Combatant, v: number): void;
  clearNotice(bot: Bot): void;
  /** Living enemies within `range` of `bot` it has noticed. */
  knownEnemies(bot: Bot, range: number): number;
  /** Class gadget: fire a rocket / rifle grenade at `at`, or put a beacon / mine down there. False if it can't. */
  useGadget(bot: Bot, kind: 'rocket' | 'riflesmoke' | 'beacon' | 'mine', at: THREE.Vector3): boolean;
  /** Spots enemy mines in view nearby; true if one the team knows of is within a few steps. */
  mineAhead(bot: Bot): boolean;
  /** This bot's own mines within `r` of `p`. */
  ownMinesNear(bot: Bot, p: THREE.Vector3, r: number): number;
  /** Within `r` of a zone the bot's side holds. */
  nearOwnedZone(bot: Bot, r: number): boolean;
  /** A built fortification (sandbags, timber wall, barricade) right by `p`. */
  fortifiedAt(p: THREE.Vector3): boolean;
  /** `c` is riding a vehicle (assault bots rocket it). */
  inVehicle(c: Combatant): boolean;
  /** Where `c` sits: on foot or in an open seat, under armour, or in an aircraft. */
  coverOf(c: Combatant): 'open' | 'armour' | 'air';
  /**
   * Whether `bot` can usefully fight `e` from where both are: nobody on foot
   * takes on a pilot overhead, crews under armour only with a rocket; vehicle
   * guns: hitscan ones at aircraft, cannon at armour.
   */
  canEngage(bot: Bot, e: Combatant): boolean;
  /** One step in a vehicle seat: carried along, driving / firing the mounted gun; false once out. */
  rideStep(bot: Bot, dt: number): void;
  /** A bot patched itself up (a browser running bots for the game server tells it). */
  usedMedkit?(bot: Bot): void;
  /** How much foliage (tree crowns) lies between two points: 0 = none, ~1 = a few thick trees. */
  foliage(from: THREE.Vector3, to: THREE.Vector3): number;
  /** Depth of water over a point (0 when dry). */
  waterDepth(p: THREE.Vector3): number;
  /** Navmesh path for this bot to `to` (round by a bridge rather than wading when it isn't far). */
  route(bot: Bot, to: THREE.Vector3, out: THREE.Vector3[]): boolean;
  /** Takes on the nearest downed teammate within `radius` nobody else is reviving, or null. */
  claimRevive(bot: Bot, radius: number): Combatant | null;
  releaseRevive(bot: Bot): void;
  /** Who is reviving `c` (a bot on its way or at work), if anyone. */
  reviverFor(c: Combatant): Bot | null;
  /** Finished reviving `c`. */
  revive(bot: Bot, c: Combatant): void;
  /** Sides playing the smarter way (see BotSkill.smart). */
  readonly smart: Readonly<Record<Team, boolean>>;
  /** Where to look while walking: the most dangerous side within 90° of `moveYaw`, or null. */
  scanYaw(bot: Bot, moveYaw: number): number | null;
  /** The squad moves in halves under fire: where this bot covers from (it holds), or null when it may move. */
  overwatch(bot: Bot): THREE.Vector3 | null;
  /** A melee blow at `target` in reach; false when it can't land. */
  melee(bot: Bot, target: Combatant): boolean;
}

let nextBotId = 1;

/** Where the next bots' ids start (the game server keeps them clear of people's ids, per room). */
export function setNextBotId(id: number): void {
  nextBotId = id;
}

/** Half the view's height (deg) above / below where a bot looks: what it can notice without looking up. */
const VIEW_UP = 50;

/** How far along its route (m) a bot re-plans when it re-plans only the stretch ahead, and how many times in a row before a whole re-plan. */
const RESPLICE_AHEAD = 30;
const RESPLICE_MAX = 2;

/** Height above a bot (m) past which a shot or a sound comes from an aircraft: no place to chase or shoot at. */
const OVERHEAD = 25;

function overhead(from: THREE.Vector3, feet: THREE.Vector3): boolean {
  return from.y - feet.y > OVERHEAD;
}

/** `out` = `p` give or take `share` of its distance from `self` (sideways, not up or down). */
function roughly(out: THREE.Vector3, p: THREE.Vector3, self: THREE.Vector3, share: number): THREE.Vector3 {
  const r = Math.hypot(p.x - self.x, p.z - self.z) * share * Math.sqrt(Math.random());
  const a = Math.random() * Math.PI * 2;
  return out.set(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r);
}

export class Bot implements Damageable, Combatant {
  readonly id = nextBotId++;
  readonly feet = new THREE.Vector3();
  readonly prevFeet = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly health = new Health();
  weapon: WeaponState;
  /** Body facing and aim (radians; yaw 0 = -Z like the player). */
  yaw = 0;
  aimYaw = 0;
  aimPitch = 0;
  crouching = false;
  crouchBlend = 0;
  grounded = false;
  firingUntil = -1;
  /** Seconds since dying for good (respawn timer). */
  deadTime = 0;
  /** Down: health gone, lying there until revived or bled out. */
  downed = false;
  /** Out of the fight for good (bled out or gave up): waiting to respawn. */
  dead = false;
  /** Seconds spent down. */
  downTime = 0;
  /** Medkits left (medics: endless, on a cooldown). */
  medkits = 0;
  private medkitReadyAt = 0;
  /** Just revived: can't be hurt until this time. */
  private shieldUntil = -Infinity;
  /** Downed teammate this bot is going to revive, and how far along it is (s). */
  reviveOf: Combatant | null = null;
  reviveProgress = 0;
  /** Zone job (building, restocking a station, taking supplies), where to stand and what to face. */
  job: FortJob | null = null;
  private readonly jobStand = new THREE.Vector3();
  private readonly jobLook = new THREE.Vector3();
  /** At the job's spot and working on it. */
  atWork = false;
  private nextJobLook = 0;
  private jobDeadline = 0;
  /** Grenades this life started with (frags, smokes, flashes): what an ammo station tops up to. */
  private kit: [number, number, number] = [0, 0, 0];
  /** Extra respawn wait (squad wiped out); cleared on spawn. */
  respawnPenalty = 0;
  /** Rounds fired, counting up (the game server sends it: shots heard and seen). */
  shots = 0;
  /** Off the field for a person who took this bot's place (game server rooms with bots). */
  benched = false;
  /**
   * Run by a person's browser (game server rooms that share the bots out):
   * the server doesn't think or move for it, it is put where that browser
   * has it (`puppetTo`); down, dead or in a vehicle the server runs it again.
   */
  puppet = false;
  action: BotAction = 'advance';
  /** Current enemy being fought (visible and noticed). */
  target: Combatant | null = null;
  /** In a vehicle seat (the manager carries, drives and fires for it), or null. */
  riding: { vehicle: number; seat: number } | null = null;
  readonly hitboxes: CharacterHitboxes;

  private readonly body: RAPIER.RigidBody;
  private readonly capsule: RAPIER.Collider;
  private height: number = MOVE.standHeight;

  /** Body height now (lower crouched): where its hitboxes stand. */
  get bodyHeight(): number {
    return this.height;
  }

  // Perception / memory
  private perceiveTimer: number;
  private perceiveCount = 0;
  private thinkTimer: number;
  /** Respawned: what it had noticed is forgotten at the next perceive (kept in the core, `noticeOf`). */
  private noticeStale = true;
  private readonly lastSeen = { pos: new THREE.Vector3(), time: -Infinity };
  /** Last sound worth checking: where (roughly) and the time the bot acts on it (a moment after hearing it). */
  private readonly heard = { pos: new THREE.Vector3(), time: -Infinity };
  private lastHurt = -Infinity;
  /** Shot by someone unseen: turns toward where it came from at this time (a reaction, not a snap). */
  private hurtTurnAt = Infinity;
  /** Who shot us last (combatant id) and from where (unknown when it came from an aircraft overhead). */
  private lastAttacker = -1;
  private readonly lastAttackerPos = new THREE.Vector3();
  private attackerKnown = false;
  /** 0..1: rounds cracking past recently (near misses and hits); decays over a few seconds. */
  suppression = 0;
  /** Flashbanged: blind until this sim time. */
  private blindUntil = -Infinity;
  private tracked = 0;

  // Movement
  private readonly path: THREE.Vector3[] = [];
  private pathIndex = 0;
  private readonly goal = new THREE.Vector3();
  /** Stuck recoveries tried since the bot last made progress (0: re-plan first). */
  private stuckTries = 0;
  /** Walking somewhere (false: standing at its spot). */
  hasGoal = false;
  private repathAt = 0;
  /** Re-plans of only the stretch ahead since the last whole one (`resplice`), and its scratch. */
  private splices = 0;
  private readonly leg: THREE.Vector3[] = [];
  private cover: THREE.Vector3 | null = null;
  private coverUntil = 0;
  /** How the cover spot is used: low (stand up over it to shoot) or with a side step out from a wall. */
  private coverLow = true;
  private coverLean: THREE.Vector3 | null = null;
  /** Leaving a spot that got this bot hit: cover searches skip points near it (until `avoidUntil`). */
  coverAvoid: THREE.Vector3 | null = null;
  private avoidUntil = 0;
  private coverHits = 0;
  /** Smarter bots: the side to watch while walking (yaw), or null. */
  private scan: number | null = null;
  /** Only the target's head shows (over cover): aim there. */
  private aimHead = false;
  private headCheckAt = 0;
  /** The target's velocity when it was lost from view (where to look for it). */
  private readonly lostVel = new THREE.Vector3();
  private meleeAt = 0;
  /** Panzerfaust at infantry: next time the bot weighs it. */
  private rocketCheckAt = 0;
  private strafe = 0;
  private strafeUntil = 0;
  /** Fighting from cover: standing up to shoot (peek) or crouched behind it, until the given time. */
  private peeking = false;
  private peekSwitchAt = 0;
  /** Firing at where an enemy was last seen, to keep their head down. */
  private readonly suppressPos = new THREE.Vector3();
  private suppressUntil = -Infinity;
  // Grenades
  private frags = 0;
  /** Class gadget this life and how many are left (see `considerGadget`). */
  gadget: GadgetId | null = null;
  gadgetCount = 0;
  private gadgetReadyAt = 0;
  /** Sim time this life started (-1 until the first think). */
  private spawnedAt = -1;
  private readonly spawnPos = new THREE.Vector3();
  /** An enemy mine the team knows about is close: creep (crouched) until then. */
  private creepUntil = -Infinity;
  private nextMineLook = 0;
  private smokes = 0;
  private flashes = 0;
  /** After throwing a flashbang: face away from where it will pop until this time. */
  private lookAwayUntil = -Infinity;
  private readonly lookAwayFrom = new THREE.Vector3();
  private grenadeReadyAt = 0;
  /** Running from a live grenade until this time. */
  private dodgeUntil = -Infinity;
  private readonly progressPos = new THREE.Vector3();
  private progressAt = 0;
  private stride = 0;
  /** Navmesh polygon the bot stands on (0 = look it up). */
  private navRef = 0;
  /** Far from the viewer and out of combat: movement runs every other step (set by the manager). */
  far = false;
  /** Close to the viewer: its capsule (which only the player bumps into) is kept up to date. */
  nearViewer = true;
  /** Simulation time owed while skipped by the update level of detail (see BotManager.step). */
  lodDt = 0;
  private moveDt = 0;
  private lodTick = Math.random() < 0.5 ? 0 : 1;

  // Aim / trigger
  private readonly jitter = new THREE.Vector2();
  private readonly jitterGoal = new THREE.Vector2();
  private jitterAt = 0;
  private burstLeft = 0;
  private pauseUntil = 0;
  /** Holding in cover while the other half of the squad moves (overwatch). */
  private holdUntil = 0;
  private triggerHeld = false;

  private readonly tmp = new THREE.Vector3();
  /** Crowd push, smoothed so neighbours nudging each other don't jitter. */
  private readonly push = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();

  constructor(
    readonly name: string,
    readonly team: Team,
    public def: WeaponDef,
    physics: PhysicsWorld,
    registry: HitboxRegistry,
    readonly cls: ClassId = 'assault',
    readonly personality: Personality = rollPersonality(Math.random, cls),
  ) {
    this.weapon = new WeaponState(def);
    const world = physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    // Only the player's controller runs into bots; they move on the navmesh themselves.
    this.capsule = world.createCollider(
      RAPIER.ColliderDesc.capsule(capsuleHalfHeight(this.height), MOVE.radius).setCollisionGroups(groups(Layer.BOT, Layer.PLAYER)),
      this.body,
    );
    this.hitboxes = new CharacterHitboxes(physics, registry, this);
    this.perceiveTimer = Math.random() * PERCEIVE_EVERY;
    this.thinkTimer = Math.random() * THINK_EVERY;
  }

  get alive(): boolean {
    return this.health.alive;
  }

  get eyeHeight(): number {
    return this.height - MOVE.eyeInset;
  }

  eyePos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.feet).setY(this.feet.y + this.eyeHeight);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle

  spawn(pos: THREE.Vector3, yaw: number, def: WeaponDef): void {
    this.def = def;
    this.riding = null;
    this.weapon = new WeaponState(def);
    this.weapon.reserve = Infinity;
    this.health.reset();
    this.feet.copy(pos).setY(pos.y + 0.05);
    this.prevFeet.copy(this.feet);
    this.navRef = 0;
    this.velocity.set(0, 0, 0);
    this.yaw = this.aimYaw = yaw;
    this.aimPitch = 0;
    this.setCrouch(false);
    this.body.setTranslation(this.center(), true);
    this.capsule.setEnabled(true);
    this.hitboxes.setEnabled(true);
    this.hitboxes.place(this.feet, yaw);
    this.target = null;
    this.noticeStale = true;
    this.lastSeen.time = this.heard.time = this.lastHurt = -Infinity;
    this.hurtTurnAt = Infinity;
    this.lastAttacker = -1;
    this.attackerKnown = false;
    this.action = 'advance';
    this.path.length = 0;
    this.hasGoal = false;
    this.cover = null;
    this.coverLean = null;
    this.coverLow = true;
    this.coverAvoid = null;
    this.coverHits = 0;
    this.scan = null;
    this.aimHead = false;
    this.peeking = false;
    this.suppressUntil = -Infinity;
    // One grenade type per life, like the player: rushers favour flashes,
    // careful types and medics smoke, the rest frags.
    const p = this.personality;
    const r = Math.random();
    const type = p.archetype === 'rusher' && r < 0.5 ? 'flash' : (p.caution > 0.6 || this.cls === 'medic') && r < 0.45 ? 'smoke' : 'frag';
    this.frags = type === 'frag' && p.grenades > 0.25 ? (p.grenades > 0.7 ? 2 : 1) : 0;
    this.smokes = type === 'smoke' ? 2 : 0;
    this.flashes = type === 'flash' ? 2 : 0;
    this.kit = [this.frags, this.smokes, this.flashes];
    // Class gadget: half the recons carry a beacon, half mines.
    this.gadget = classGadget(this.cls, this.id % 2 === 0 ? 'beacon' : 'mine');
    this.gadgetCount = this.gadget ? GADGETS[this.gadget].count : 0;
    this.gadgetReadyAt = 0;
    this.push.set(0, 0, 0);
    this.spawnedAt = -1;
    this.job = null;
    this.atWork = false;
    this.lookAwayUntil = -Infinity;
    this.blindUntil = -Infinity;
    this.grenadeReadyAt = 0;
    this.dodgeUntil = -Infinity;
    this.deadTime = 0;
    this.respawnPenalty = 0;
    this.downed = this.dead = false;
    this.downTime = 0;
    this.shieldUntil = -Infinity;
    this.medkits = this.cls === 'medic' ? Infinity : MEDKIT.carried;
    this.medkitReadyAt = 0;
    this.reviveOf = null;
    this.reviveProgress = 0;
  }

  inCombat(now: number): boolean {
    return !!this.target || now - this.lastHurt < COMBAT_WINDOW || this.firingUntil > now - COMBAT_WINDOW;
  }

  /** Returns true when this hit took the bot down (the kill is credited then). */
  applyDamage(amount: number, part: HitPart, source?: DamageSource): boolean {
    if (!this.alive || this.nowRef < this.shieldUntil) return false;
    const killed = this.health.damage(amount);
    this.lastHurt = this.nowRef;
    if (this.inCover) this.coverHits++;
    void part;
    // Getting shot reveals roughly where it came from (not a plane's position:
    // chasing or shooting at a spot in the sky gets nowhere).
    if (source) {
      this.lastAttacker = source.id;
      this.suppression = Math.min(1, this.suppression + 0.35);
      this.attackerKnown = !overhead(source.pos, this.feet);
      if (this.attackerKnown) {
        roughly(this.lastSeen.pos, source.pos, this.feet, 0.1);
        this.lastSeen.time = this.nowRef;
        this.lastAttackerPos.copy(this.lastSeen.pos);
        // Turn toward it after a moment (reacting, not snapping round).
        if (!this.target && this.hurtTurnAt === Infinity) this.hurtTurnAt = this.nowRef + (0.25 + Math.random() * 0.3) * this.personality.reaction;
      }
    }
    if (killed) this.goDown();
    return killed;
  }

  /** Health gone: down on the ground, out of the fight, waiting for a revive. */
  private goDown(): void {
    this.capsule.setEnabled(false);
    this.hitboxes.setEnabled(false);
    this.target = null;
    this.velocity.set(0, 0, 0);
    this.downed = true;
    this.downTime = 0;
    this.reviveOf = null;
    this.reviveProgress = 0;
    this.job = null;
    this.atWork = false;
    this.path.length = 0;
    this.hasGoal = false;
    this.setCrouch(false);
  }

  /** Into a vehicle seat: no capsule, no walking; hitboxes only where the seat is out in the open. */
  board(vehicle: number, seat: number, exposed: boolean): void {
    this.riding = { vehicle, seat };
    this.capsule.setEnabled(false);
    this.hitboxes.setEnabled(exposed);
    this.path.length = 0;
    this.hasGoal = false;
    this.job = null;
    this.atWork = false;
    this.setCrouch(false);
  }

  /** Out of the vehicle, standing at `feet`. */
  alight(feet: THREE.Vector3): void {
    this.riding = null;
    this.feet.copy(feet).setY(feet.y + 0.05);
    this.prevFeet.copy(this.feet);
    this.navRef = 0;
    this.velocity.set(0, 0, 0);
    if (this.alive) {
      this.capsule.setEnabled(true);
      this.hitboxes.setEnabled(true);
      this.body.setTranslation(this.center(), true);
    }
  }

  /** Where a browser running this bot has it (see `puppet`), `dt` after the last time. */
  puppetTo(feet: THREE.Vector3, yaw: number, aimYaw: number, aimPitch: number, crouch: boolean, dt: number): void {
    this.prevFeet.copy(this.feet);
    this.velocity.subVectors(feet, this.feet).divideScalar(Math.max(dt, 1 / 60));
    this.feet.copy(feet);
    this.yaw = yaw;
    this.aimYaw = aimYaw;
    this.aimPitch = aimPitch;
    this.setCrouch(crouch);
    this.grounded = true;
    this.body.setNextKinematicTranslation(this.center());
    this.hitboxes.sync(this.feet, this.yaw, this.height);
  }

  /** Grenades carried (frags, smokes, flashes), to hand a bot over to another sim as it is. */
  get grenadeCounts(): [number, number, number] {
    return [this.frags, this.smokes, this.flashes];
  }

  set grenadeCounts(n: [number, number, number]) {
    [this.frags, this.smokes, this.flashes] = n;
  }

  /** Carried in a seat: eye at `eye`, moving with the vehicle. */
  carry(eye: THREE.Vector3, velocity: THREE.Vector3): void {
    this.prevFeet.copy(this.feet);
    this.feet.copy(eye).setY(eye.y - this.eyeHeight);
    this.velocity.copy(velocity);
    this.hitboxes.sync(this.feet, this.yaw, this.height);
  }

  /** Puts the capsule back where the bot is (it isn't moved while far from the viewer). */
  syncCapsule(): void {
    if (this.alive) this.body.setNextKinematicTranslation(this.center());
  }

  /** Killed outright (a vehicle blowing up under them): no going down first. */
  killOutright(source?: DamageSource): void {
    void source;
    if (this.alive) {
      this.health.value = 0;
      this.goDown();
    }
    this.finish();
  }

  /** Off the field without a death (a person takes the place): no events, no respawn until `unbench`. */
  bench(): void {
    this.benched = true;
    this.health.value = 0;
    this.downed = false;
    this.dead = true;
    this.deadTime = 0;
    this.riding = null;
    this.target = null;
    this.reviveOf = null;
    this.job = null;
    this.capsule.setEnabled(false);
    this.hitboxes.setEnabled(false);
  }

  /** Back in (the person left): respawns at the next chance. */
  unbench(): void {
    this.benched = false;
    this.deadTime = Infinity;
  }

  /** Bled out or gave up: dead for good until the respawn. */
  finish(): void {
    if (!this.downed) return;
    this.downed = false;
    this.dead = true;
    this.deadTime = 0;
  }

  /** Back on their feet with `health`, briefly protected. */
  revive(health: number, now: number): void {
    if (!this.downed) return;
    this.downed = false;
    this.health.value = health;
    this.capsule.setEnabled(true);
    this.hitboxes.setEnabled(true);
    this.hitboxes.place(this.feet, this.yaw);
    this.body.setTranslation(this.center(), true);
    this.shieldUntil = now + DOWN_RULES.reviveShield;
    this.suppression = 0;
  }

  /** Last sim time seen by step() (damage callbacks arrive between steps). */
  private nowRef = 0;

  blind(seconds: number, time: number): void {
    this.blindUntil = Math.max(this.blindUntil, time + seconds);
  }

  /**
   * Heard gunfire or footsteps at `pos`: where it came from only roughly
   * (footsteps more roughly), acted on after a moment. Sounds keep coming
   * while someone walks or fires: the first one sets the reaction time, the
   * rest only refresh where it is.
   */
  hear(pos: THREE.Vector3, time: number, kind: 'shot' | 'step' = 'shot'): void {
    if (!this.alive || overhead(pos, this.feet)) return;
    roughly(this.heard.pos, pos, this.feet, kind === 'step' ? 0.3 : 0.12);
    const waiting = this.heard.time > time;
    if (waiting) return;
    const delay = (kind === 'step' ? 0.55 + Math.random() * 0.6 : 0.2 + Math.random() * 0.3) * this.personality.reaction;
    this.heard.time = time - this.heard.time < 3 ? time : time + delay;
  }

  /** Seconds since the bot reacted to the last sound (Infinity while it hasn't yet, or never heard one). */
  private heardAge(now: number): number {
    return now < this.heard.time ? Infinity : now - this.heard.time;
  }

  /**
   * A round cracked past (or a burst landed close). Pins the bot down: worse
   * aim, keener to get into cover, less peeking; also gives away roughly
   * where the shooter is. Rushers shrug more of it off.
   */
  suppress(amount: number, from: THREE.Vector3, time: number): void {
    if (!this.alive) return;
    this.suppression = Math.min(1, this.suppression + amount * (1.25 - this.personality.aggression * 0.7));
    if (overhead(from, this.feet)) return;
    roughly(this.heard.pos, from, this.feet, 0.12);
    // Rounds cracking past need no working out: acted on at once.
    this.heard.time = time;
  }

  /** A mate next to us was killed from `killerPos`: look for the killer (unless already fighting). */
  mateKilled(killerPos: THREE.Vector3, time: number): void {
    if (!this.alive || this.target) return;
    this.lastSeen.pos.copy(killerPos);
    this.lastSeen.time = time;
    this.suppression = Math.min(1, this.suppression + 0.15);
  }

  /** Last attacker's position, for the manager's intel when this bot dies. */
  get killerPos(): THREE.Vector3 | null {
    return this.lastAttacker >= 0 && this.attackerKnown ? this.lastAttackerPos : null;
  }

  /** Has a panzerfaust round left (worth taking on a vehicle crew). */
  get hasRocket(): boolean {
    return this.gadget === 'panzerfaust' && this.gadgetCount > 0;
  }

  // ---------------------------------------------------------------------------
  // Simulation

  step(dt: number, s: BotServices): void {
    this.nowRef = s.time;
    this.prevFeet.copy(this.feet);
    if (this.downed) {
      this.downTime += dt;
      // Bleed out, or give up early when nobody is around to help.
      const alone = this.downTime > 4 && !s.reviverFor(this) && s.alliesNear(this.team, this.feet, 25) === 0;
      if (this.downTime >= DOWN_RULES.bleedOut || alone) this.finish();
      return;
    }
    if (!this.alive) {
      this.deadTime += dt;
      return;
    }
    this.health.step(dt);
    this.suppression = Math.max(0, this.suppression - dt * SUPPRESSION_DECAY);
    if (this.riding) {
      // Aboard: still looking out (the gunner fires at what it sees), carried by the vehicle.
      this.perceiveTimer -= dt;
      if (this.perceiveTimer <= 0) {
        this.perceiveTimer += PERCEIVE_EVERY;
        this.perceive(s, PERCEIVE_EVERY);
      }
      s.rideStep(this, dt);
      return;
    }

    this.perceiveTimer -= dt;
    if (this.perceiveTimer <= 0) {
      // Far from the viewer and out of combat: look around half as often.
      const every = this.far ? PERCEIVE_EVERY * 2 : PERCEIVE_EVERY;
      this.perceiveTimer += every;
      this.perceive(s, every);
    }
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer += THINK_EVERY;
      this.think(s);
    }
    this.updateRevive(dt, s);
    this.updateWork(dt, s);
    this.updatePeek(s);
    this.updateAim(dt, s);
    this.watchForMines(s);
    this.updateMovement(dt, s);
    this.updateWeapon(dt, s);
    this.hitboxes.sync(this.feet, this.yaw, this.height);
  }

  private perceive(s: BotServices, dt: number): void {
    const skill = s.skill;
    if (s.time < this.blindUntil || this.noticeStale) {
      s.clearNotice(this);
      this.noticeStale = false;
    }
    if (s.time < this.blindUntil) {
      this.target = null;
      return;
    }
    const eye = this.eyePos(this.eye);
    this.perceiveCount++;
    let best: Combatant | null = null;
    let bestDist = Infinity;
    // First pass (the wasm core): who is in view, notice fading for the rest,
    // and the few in view that matter most — a crowd in view can't all be
    // tracked at once. Vehicle gunners watch the sky for aircraft further out.
    const look = s.perceiveFirst(
      this,
      skill.sight,
      this.riding ? skill.sight * 3 : skill.sight,
      skill.fov / 2,
      this.riding ? null : VIEW_UP,
      this.aimYaw,
      this.aimPitch,
      dt,
      this.perceiveCount,
      this.target,
      this.lastAttacker,
      PERCEIVE_LOOKS,
    );
    // Second pass: line of sight for those; the rest keep where they were.
    for (let i = 0; i < look; i++) {
      const e = s.viewHit(i);
      // Went down earlier this step (the core's copy is from its last step).
      if (!e.alive) {
        s.setNotice(this, e, 0);
        continue;
      }
      const dist = s.viewDist(i);
      const off = s.viewOff(i);
      const firing = e.firingUntil > s.time;
      let progress = s.noticeOf(this, e);
      const head = this.tmp.copy(e.feet).setY(e.feet.y + e.eyeHeight);
      const chest = this.tmp2.copy(e.feet).setY(e.feet.y + e.eyeHeight * 0.7);
      let visible = s.canSee(this, e, eye, head, chest);
      // Tree crowns in between hide people at range (thick woods completely).
      let leaves = 0;
      if (visible && dist > 12) {
        leaves = s.foliage(eye, this.tmp2.copy(e.feet).setY(e.feet.y + e.eyeHeight * 0.7));
        if (leaves > (firing ? 2.4 : 1.4) && progress < 1) visible = false;
      }
      if (visible) {
        const hidden = 1 + leaves * (firing ? 0.8 : 2);
        // Someone crouched and still is harder to pick out; running draws the eye.
        const moving = Math.hypot(e.velocity.x, e.velocity.z);
        const posture = firing ? 1 : (e.eyeHeight < 1.3 ? 1.35 : 1) * (moving > 4.5 ? 0.85 : moving < 0.5 ? 1.15 : 1);
        progress = Math.min(1.5, progress + dt / (noticeTime(skill.reaction * this.personality.reaction, dist, off, skill.fov / 2, firing) * hidden * posture));
        if (progress >= 1) {
          this.lastSeen.pos.copy(e.feet);
          this.lastSeen.time = s.time;
          s.reportSighting(this, e.feet);
          s.spot(this, e);
          // Prefer whoever is shooting at us, then the current target, then the closest.
          let d = e === this.target ? dist * 0.6 : dist;
          if (e.id === this.lastAttacker && s.time - this.lastHurt < 3) d *= 0.4;
          else if (firing) d *= 0.8;
          if (d < bestDist) {
            best = e;
            bestDist = d;
          }
        }
      } else {
        progress = Math.max(0, progress - dt * 0.5);
      }
      s.setNotice(this, e, progress);
    }
    if (best !== this.target) {
      // Lost from view: remember which way they were going.
      if (this.target && !best) {
        this.lostVel.copy(this.target.velocity).setY(0);
        if (this.lostVel.lengthSq() > 49) this.lostVel.setLength(7);
      }
      this.tracked = 0;
      this.headCheckAt = 0;
      this.aimHead = false;
    }
    this.target = best;
    // Over cover often only the head shows: aim at what can be seen.
    if (best && s.time >= this.headCheckAt) {
      this.headCheckAt = s.time + 0.3;
      this.aimHead = !s.lineOfSight(eye, this.tmp2.copy(best.feet).setY(best.feet.y + best.eyeHeight * 0.7));
    }
  }

  /** Height on the target to aim at (the chest, or the head when that is all that shows). */
  private aimHeight(t: Combatant): number {
    return t.eyeHeight * (this.aimHead ? 0.95 : 0.78);
  }

  /** The cover spot taken from the map's tactical points: low cover, or a side step to peek from a wall. */
  setCoverStyle(low: boolean, lean: THREE.Vector3 | null): void {
    this.coverLow = low;
    this.coverLean = lean;
  }

  /** Throws a smoke grenade onto `at` if it has one (a squad going in screens its way). */
  throwSmoke(at: THREE.Vector3, s: BotServices): boolean {
    if (this.smokes <= 0 || this.weapon.reloading || !s.throwGrenade(this, 'smoke', at)) return false;
    this.smokes--;
    this.afterThrow(at, s);
    return true;
  }

  private think(s: BotServices): void {
    const w = this.weapon;
    // Running from a grenade: nothing else matters for a moment.
    if (s.time < this.dodgeUntil) return;
    this.considerMedkit(s);
    if (this.planRevive(s)) return;
    if (this.planWork(s)) return;
    if (this.blinded) {
      this.reactBlind(s);
      return;
    }
    // At our window: it is our cover (duck below the sill, stand up to shoot).
    const post = s.postHere(this);
    if (post && (!this.cover || this.cover.distanceTo(post) > 0.5)) {
      this.cover = post.clone();
      this.coverUntil = s.time + 4;
    }
    // Pinned down by fire we can't see: the shooter's rough position is the threat.
    const threat = this.target
      ? this.target.feet
      : this.lastSeen.time > s.time - 4
        ? this.lastSeen.pos
        : this.suppression > 0.3 && this.heardAge(s.time) < 2
          ? this.heard.pos
          : null;
    // Hit again and again at one spot: they have it zeroed, move to another.
    const smart = s.smart[this.team];
    if (smart && this.coverHits >= COVER_HITS && this.cover) {
      this.coverAvoid = this.cover.clone();
      this.avoidUntil = s.time + 8;
      this.coverHits = 0;
      this.coverUntil = 0;
    }
    if (this.coverAvoid && s.time > this.avoidUntil) this.coverAvoid = null;
    if (threat && (!this.cover || s.time > this.coverUntil)) {
      // Keep a cover spot while it still hides us; only look for a new one when it doesn't.
      if (this.cover && !this.coverAvoid && this.coverHolds(this.cover, threat, s)) {
        this.coverUntil = s.time + 3;
      } else {
        // Without a tactical point the spot is plain cover (crouch behind it, stand to shoot).
        this.coverLow = true;
        this.coverLean = null;
        const found = s.findCover(this, threat);
        if (found !== undefined) {
          this.cover = found;
          this.coverUntil = s.time + 3;
          this.coverHits = 0;
        }
      }
    } else if (!threat) {
      this.cover = null;
      this.coverLean = null;
    }
    const inCover = !!this.cover && this.cover.distanceTo(this.feet) < 0.8;
    // Teammates' sightings only matter nearby; otherwise the whole team converges on one fight.
    // Squadmates share their fight over any distance.
    const sighting = s.teamSighting(this.team);
    const squad = s.squadContact(this);
    const team = squad ?? (sighting && sighting.pos.distanceTo(this.feet) < TEAM_INTEL_RANGE ? sighting : null);
    const ownAge = s.time - this.lastSeen.time;
    const teamAge = team ? s.time - team.time : Infinity;
    // Local odds: friends around us vs the enemies we know are near.
    const known = this.knownEnemies(s, ODDS_RANGE);
    const odds = known > 0 ? s.alliesNear(this.team, this.feet, ODDS_RANGE * 0.6) / known : 1;
    this.action = chooseAction(
      {
        health: this.health.value / 100,
        hasTarget: !!this.target,
        lastSeenAge: Math.min(ownAge, teamAge + 2),
        heardAge: this.heardAge(s.time),
        ammo: w.ammo / this.def.magSize,
        reloading: w.reloading,
        sinceHurt: s.time - this.lastHurt,
        coverKnown: !!this.cover,
        inCover,
        regroup: s.mustRegroup(this),
        flanking: s.isFlanking(this),
        posted: s.hasPost(this),
        aggression: this.personality.aggression,
        caution: this.personality.caution,
        suppression: this.suppression,
        odds,
      },
      this.action,
    );

    switch (this.action) {
      case 'engage':
        if (inCover) this.hasGoal = false; // fight from here, peeking
        else this.planEngage(s);
        break;
      case 'cover':
        if (this.cover) this.setGoal(this.cover, s);
        else if (threat) this.backOff(threat, s);
        break;
      case 'hold':
        if (this.cover) this.setGoal(this.cover, s);
        this.planSuppress(s);
        break;
      case 'reload':
        if (w.canReload()) w.startReload();
        if (this.cover) this.setGoal(this.cover, s);
        else this.hasGoal = false;
        break;
      case 'hunt':
        // Smarter: where they were heading, not just where they were seen.
        this.setGoal(ownAge <= teamAge + 2 ? (smart ? this.predicted(s, ownAge) : this.lastSeen.pos) : team!.pos, s);
        // Steadier types keep firing at the spot while they close in.
        if (this.personality.caution > 0.4) this.planSuppress(s);
        break;
      case 'investigate':
        this.setGoal(this.heard.pos, s);
        break;
      case 'advance':
        // Holding for the squad (see coverMove): no new way in meanwhile.
        if (s.time < this.holdUntil) break;
        if (!this.hasGoal || this.feet.distanceTo(this.goal) < 3 || s.time > this.repathAt + 8 || s.squadGoalMoved(this, this.goal)) {
          this.setGoal(s.squadGoal(this), s);
        }
        break;
    }
    // A squad fighting moves in halves: this half holds (in cover) and covers the other.
    if (smart && !this.target && (this.action === 'advance' || this.action === 'hunt')) {
      const over = s.overwatch(this);
      if (over) this.coverMove(over, inCover, s);
    }
    // Where to look while walking: the dangerous side, not just the path.
    this.scan = smart && !this.target && this.hasGoal && this.path.length > 0 ? s.scanYaw(this, this.pathYaw()) : null;
    // Up close with an empty (or reloading) gun, or right on top of them: the rifle butt.
    const t = this.target;
    if (t && s.time >= this.meleeAt) {
      const d = this.feet.distanceTo(t.feet);
      if (d < MELEE_BOT.close || (d < MELEE_BOT.reach && (w.ammo === 0 || w.reloading))) {
        this.meleeAt = s.time + MELEE_BOT.every;
        this.faceToward(t.feet, 1);
        if (s.melee(this, t)) this.pauseUntil = s.time + 0.5;
      }
    }
    // Someone just vanished into smoke: keep firing into it.
    if (!this.target && s.time - this.lastSeen.time < 3.5 && s.inSmoke(this.lastSeen.pos)) this.planSuppress(s, true);
    // Reload opportunistically when nothing is visible.
    if (!this.target && w.ammo < this.def.magSize * 0.4 && w.canReload()) w.startReload();
    this.considerGrenade(s, inCover);
    this.considerGadget(s, inCover);
  }

  /** Where an enemy lost from view `age` s ago is likely now: along their way, on the mesh. */
  private predicted(s: BotServices, age: number): THREE.Vector3 {
    const p = this.tmp3.copy(this.lastSeen.pos).addScaledVector(this.lostVel, Math.min(age, 1.5));
    return s.nav.closest(p, this.tmp3) ?? this.lastSeen.pos;
  }

  /** Heading of the next stretch of the path (yaw, 0 = -Z). */
  private pathYaw(): number {
    const c = this.path[Math.min(this.pathIndex, this.path.length - 1)]!;
    return Math.atan2(-(c.x - this.feet.x), -(c.z - this.feet.z));
  }

  /**
   * Covering the squad's move: stay in cover (or get to some, close by) and
   * keep the enemy's heads down at `at`, rather than walking up.
   */
  private coverMove(at: THREE.Vector3, inCover: boolean, s: BotServices): void {
    if (inCover) {
      this.hasGoal = false;
      this.holdUntil = s.time + 0.5;
    } else {
      // Cover close by and not back the way it came; none: keep going (the other half covers).
      const ahead = this.hasGoal ? this.goal.clone() : null;
      const near = (c: THREE.Vector3) => c.distanceTo(this.feet) < OVERWATCH_COVER && (!ahead || c.distanceTo(ahead) < this.feet.distanceTo(ahead) + 2);
      let c = this.cover && near(this.cover) ? this.cover : null;
      if (!c) {
        this.coverLow = true;
        this.coverLean = null;
        const f = s.findCover(this, at);
        if (f && near(f)) {
          c = f;
          this.cover = f;
          this.coverUntil = s.time + 3;
        }
      }
      if (!c) return;
      if (!this.hasGoal || this.goal.distanceToSquared(c) > 0.25) this.setGoal(c, s);
      this.holdUntil = s.time + 0.5;
    }
    // A few bursts at the fight (not a constant stream).
    const auto = this.def.fireMode === 'auto' || this.def.fireMode === 'burst';
    if (!auto || s.time < this.suppressUntil || Math.random() > 0.35 || this.weapon.ammo < this.def.magSize * 0.3) return;
    const spot = this.tmp.copy(at).setY(at.y + 1.1);
    if (s.wallsBlock(this.eyePos(this.eye), spot)) return;
    this.suppressPos.copy(spot);
    this.suppressUntil = s.time + 1 + Math.random();
  }

  /** Hurt and out of the line of fire: patch up with a medkit. */
  private considerMedkit(s: BotServices): void {
    if (this.health.value > 45 || s.time < this.medkitReadyAt || this.medkits <= 0) return;
    if (s.time - this.lastHurt < 0.8 || (this.target && !this.inCover)) return;
    this.health.value = 100;
    s.usedMedkit?.(this);
    this.pauseUntil = s.time + MEDKIT.useTime;
    if (this.cls === 'medic') this.medkitReadyAt = s.time + MEDKIT.medicCooldown;
    else this.medkits--;
  }

  /**
   * Go and revive a downed teammate when it's quiet enough (medics reach
   * farther and don't wait as long). Returns true while busy with it.
   */
  private planRevive(s: BotServices): boolean {
    const m = this.reviveOf;
    if (m && (!m.downed || this.target || s.time - this.lastHurt < 1)) {
      s.releaseRevive(this);
      this.reviveOf = null;
      this.reviveProgress = 0;
      return false;
    }
    if (!m) {
      const calm = this.cls === 'medic' ? 1.2 : 2.5;
      if (this.target || this.suppression > 0.35 || s.time - this.lastHurt < calm) return false;
      const found = s.claimRevive(this, this.cls === 'medic' ? 32 : 16);
      if (!found) return false;
      this.reviveOf = found;
      this.reviveProgress = 0;
    }
    const to = this.reviveOf!;
    if (this.feet.distanceTo(to.feet) > REVIVE_RANGE * 0.8) {
      this.action = 'cover'; // sprint over, no strafing
      this.setGoal(to.feet, s);
    } else {
      this.hasGoal = false;
    }
    return true;
  }

  /** Kneeling next to the downed mate: count up, then get them up. */
  private updateRevive(dt: number, s: BotServices): void {
    const m = this.reviveOf;
    if (!m) return;
    if (this.feet.distanceTo(m.feet) > REVIVE_RANGE) {
      this.reviveProgress = 0;
      return;
    }
    this.reviveProgress += dt;
    if (this.reviveProgress >= CLASSES[this.cls].reviveTime) {
      s.revive(this, m);
      s.releaseRevive(this);
      this.reviveOf = null;
      this.reviveProgress = 0;
    }
  }

  /**
   * Zone chores when nothing is going on: supports restock the ammo station,
   * medics the medical one, anyone builds at a zone their side holds, and bots
   * short of grenades or a medkit take one from a station. Returns true while
   * busy with one.
   */
  private planWork(s: BotServices): boolean {
    if (this.job && (this.target || this.suppression > 0.3 || s.time - this.lastHurt < 1.5)) {
      this.dropJob(s);
      return false;
    }
    if (!this.job) {
      if (s.time < this.nextJobLook || this.target || this.suppression > 0.15 || s.time - this.lastHurt < 4 || s.time - this.lastSeen.time < 6) return false;
      this.nextJobLook = s.time + 2 + Math.random() * 2;
      const found = s.claimWork(this, 30);
      if (!found) return false;
      this.job = found.job;
      this.jobStand.copy(found.stand);
      this.jobLook.copy(found.look);
      this.jobDeadline = s.time + 25;
    }
    if (!this.atWork && s.time > this.jobDeadline) {
      // Can't get there: leave it for a while.
      this.dropJob(s);
      this.nextJobLook = s.time + 15;
      return false;
    }
    if (Math.hypot(this.feet.x - this.jobStand.x, this.feet.z - this.jobStand.z) > 0.9) {
      this.atWork = false;
      this.action = 'cover'; // straight there, no strafing
      this.setGoal(this.jobStand, s);
    } else {
      this.atWork = true;
      this.hasGoal = false;
    }
    return true;
  }

  private updateWork(dt: number, s: BotServices): void {
    if (!this.job || !this.atWork) return;
    if (!s.doWork(this, this.job, dt)) this.dropJob(s);
  }

  private dropJob(s: BotServices): void {
    s.releaseWork(this);
    this.job = null;
    this.atWork = false;
  }

  /** Threw some of this life's grenades. */
  get needsGrenades(): boolean {
    return this.frags < this.kit[0] || this.smokes < this.kit[1] || this.flashes < this.kit[2] || (!!this.gadget && this.gadgetCount < GADGETS[this.gadget].count);
  }

  /** Ammo station: grenades and the class gadget back to what this life started with. */
  restockGrenades(): void {
    [this.frags, this.smokes, this.flashes] = this.kit;
    if (this.gadget) this.gadgetCount = GADGETS[this.gadget].count;
  }

  /**
   * Class gadgets. Assault: a panzerfaust at an enemy dug in behind
   * sandbags or in a building (now and then at anyone out in the open).
   * Medic: rifle smoke over a mate it's going to revive, or as a screen when
   * shot at in the open. Recon: a beacon on the way to the squad's objective,
   * mines at a zone its side holds.
   */
  private considerGadget(s: BotServices, inCover: boolean): void {
    if (this.spawnedAt < 0) {
      this.spawnedAt = s.time;
      this.spawnPos.copy(this.feet);
    }
    if (!this.gadget || this.gadgetCount <= 0 || s.time < this.gadgetReadyAt || this.weapon.reloading) return;
    const p = this.personality;
    const calm = !this.target && s.time - this.lastSeen.time > 8 && s.time - this.lastHurt > 6;
    const use = (kind: 'rocket' | 'riflesmoke' | 'beacon' | 'mine', at: THREE.Vector3, cooldown: number): void => {
      if (!s.useGadget(this, kind, at)) {
        this.gadgetReadyAt = s.time + 2;
        return;
      }
      this.gadgetCount--;
      this.gadgetReadyAt = s.time + cooldown;
      this.pauseUntil = s.time + 0.9;
      if (kind === 'rocket' || kind === 'riflesmoke') this.faceToward(at, 1);
    };
    switch (this.gadget) {
      case 'panzerfaust': {
        const t = this.target;
        if (!t) return;
        const d = this.feet.distanceTo(t.feet);
        if (d < 10 || d > 70 || s.alliesNear(this.team, t.feet, 5) > 0) return;
        // Vehicles and fortifications: that is what it is for. Someone in a building: now and
        // then, from 15 m on, checked about once a second (with every building enterable it had
        // become the bots' main anti-infantry weapon); anyone else very rarely.
        const hard = s.fortifiedAt(t.feet) || s.inVehicle(t);
        const indoors = !hard && s.insideBuilding(t.feet);
        if (!hard) {
          if (s.time < this.rocketCheckAt) return;
          this.rocketCheckAt = s.time + 1.2;
          if (indoors ? d < 15 || Math.random() > 0.25 * (0.6 + p.aggression) : Math.random() > 0.06 * (0.5 + p.aggression)) return;
        }
        const dug = hard || indoors;
        use('rocket', this.tmp2.copy(t.feet).setY(t.feet.y + (dug ? 0.9 : 0.6)), 7 + Math.random() * 5);
        return;
      }
      case 'riflesmoke': {
        const threat = this.target?.feet ?? (s.time - this.lastSeen.time < 5 ? this.lastSeen.pos : null);
        if (!threat) return;
        const mate = this.reviveOf;
        let at: THREE.Vector3 | null = null;
        if (mate?.downed) {
          // A screen just past the downed mate, toward whoever shot them.
          at = this.tmp2.copy(mate.feet).lerp(threat, Math.min(0.5, 5 / Math.max(1, mate.feet.distanceTo(threat))));
        } else if (!inCover && s.time - this.lastHurt < 1.5 && Math.random() < 0.3 + p.caution * 0.4) {
          const d = this.feet.distanceTo(threat);
          if (d > 22) at = this.tmp2.lerpVectors(this.feet, threat, 16 / d);
        }
        const d = at ? this.feet.distanceTo(at) : 0;
        if (at && d > 10 && d < 44) use('riflesmoke', at, 14 + Math.random() * 6);
        return;
      }
      case 'beacon': {
        // On the way to the objective, well clear of where this life started.
        if (!calm || this.feet.distanceTo(this.spawnPos) < 50) return;
        const d = this.feet.distanceTo(s.squadGoal(this));
        if (d > 20 && d < 90 && s.enemiesNear(this.team, this.feet, 30) === 0) use('beacon', this.feet, 60);
        return;
      }
      case 'mine': {
        if (!calm || !s.nearOwnedZone(this, 22)) return;
        if (s.ownMinesNear(this, this.feet, 10) > 0) return;
        use('mine', this.feet, 20 + Math.random() * 20);
        return;
      }
    }
  }

  /** Looks for enemy mines around (a few times a second) and creeps past known ones. */
  private watchForMines(s: BotServices): void {
    if (s.time < this.nextMineLook) return;
    this.nextMineLook = s.time + 0.3;
    if (s.mineAhead(this)) this.creepUntil = s.time + 0.6;
  }

  /** At a downed mate's side and working on them. */
  get reviving(): boolean {
    return !!this.reviveOf && this.reviveProgress > 0;
  }

  /** Enemies within `range` this bot has noticed. */
  private knownEnemies(s: BotServices, range: number): number {
    return this.noticeStale ? 0 : s.knownEnemies(this, range);
  }

  private get blinded(): boolean {
    return this.nowRef < this.blindUntil;
  }

  /**
   * Flashbanged: steadier types stumble back from where the threat was,
   * bolder ones crouch and hold the trigger down toward it; nobody advances.
   */
  private reactBlind(s: BotServices): void {
    const p = this.personality;
    this.peeking = false;
    const age = s.time - this.lastSeen.time;
    const auto = this.def.fireMode === 'auto' || this.def.fireMode === 'burst';
    if (age < 5 && p.aggression > 0.45 && auto && this.weapon.ammo > 0) {
      this.suppressPos.copy(this.lastSeen.pos).setY(this.lastSeen.pos.y + 1.1);
      this.suppressUntil = this.blindUntil;
    }
    const threat = age < 6 ? this.lastSeen.pos : this.heardAge(s.time) < 4 ? this.heard.pos : null;
    if (threat && p.caution > 0.5) {
      if (this.action !== 'cover' || !this.hasGoal) this.backOff(threat, s);
      this.action = 'cover';
    } else {
      this.hasGoal = false;
      this.action = 'hold';
    }
  }

  /** A live enemy frag landed nearby: sprint away from it. */
  dodge(from: THREE.Vector3, s: BotServices): void {
    if (s.time < this.dodgeUntil) return;
    const away = this.tmp.subVectors(this.feet, from).setY(0);
    if (away.lengthSq() < 1e-3) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    away.normalize().multiplyScalar(9).add(this.feet);
    const p = s.nav.closest(away, this.tmp2);
    if (!p) return;
    this.dodgeUntil = s.time + 2.2;
    this.action = 'cover'; // sprints, no strafing
    this.cover = null;
    this.setGoalForce(p, s);
  }

  /**
   * Frag an enemy who ducked behind cover (or a group of them); pop smoke
   * when caught in the open under fire with nowhere to hide.
   */
  private considerGrenade(s: BotServices, inCover: boolean): void {
    if (s.time < this.grenadeReadyAt || this.weapon.reloading) return;
    const p = this.personality;
    const eye = this.eyePos(this.eye);
    // Flash an enemy who ducked out of sight around a corner or into a
    // building, then go in after them.
    if (this.flashes > 0 && !this.target && (this.action === 'hunt' || p.aggression > 0.6) && Math.random() < 0.5) {
      const age = s.time - this.lastSeen.time;
      const d = this.feet.distanceTo(this.lastSeen.pos);
      const spot = this.tmp.copy(this.lastSeen.pos).setY(this.lastSeen.pos.y + 1);
      if (age > 0.5 && age < 6 && d > 6 && d < 24 && !s.lineOfSight(eye, spot) && s.alliesNear(this.team, this.lastSeen.pos, 10) === 0) {
        const at = this.tmp2.copy(this.lastSeen.pos);
        if (s.throwGrenade(this, 'flash', at)) {
          this.flashes--;
          this.afterThrow(at, s);
          this.lookAwayFrom.copy(at);
          this.lookAwayUntil = s.time + 1.9;
          // Keep the chase going through the flash.
          this.lastSeen.time = s.time;
          return;
        }
      }
    }
    if (this.frags > 0 && Math.random() < p.grenades * 0.4) {
      // Frags (cooked, see BotManager.throwGrenade) go where someone is holding, not where they
      // ran past: a group; one dug in behind sandbags / in a building / standing still; or, before
      // going in after them, the building an enemy ducked into (clearing the room).
      let at: THREE.Vector3 | null = null;
      const age = s.time - this.lastSeen.time;
      const t = this.target;
      if (t) {
        const d = this.feet.distanceTo(t.feet);
        const holding = s.fortifiedAt(t.feet) || s.insideBuilding(t.feet) || Math.hypot(t.velocity.x, t.velocity.z) < 0.4;
        if (d > 10 && d < 32 && (s.enemiesNear(this.team, t.feet, 5) >= 2 || (holding && Math.random() < 0.5))) at = t.feet;
      } else if (age > 0.8 && age < 6) {
        const d = this.feet.distanceTo(this.lastSeen.pos);
        const spot = this.tmp.copy(this.lastSeen.pos).setY(this.lastSeen.pos.y + 1);
        const dug = s.insideBuilding(this.lastSeen.pos) || s.fortifiedAt(this.lastSeen.pos);
        if (dug && d > 7 && d < 28 && !s.lineOfSight(eye, spot)) at = this.lastSeen.pos;
      }
      if (at && s.alliesNear(this.team, at, 8) === 0 && s.throwGrenade(this, 'frag', at)) {
        this.frags--;
        this.afterThrow(at, s);
        return;
      }
    }
    // Smoke when shot at in the open with no cover close by (screens the dash to it).
    const farFromCover = !this.cover || this.cover.distanceTo(this.feet) > 6;
    if (this.smokes > 0 && !inCover && farFromCover && s.time - this.lastHurt < 1.5) {
      const threat = this.target?.feet ?? (s.time - this.lastSeen.time < 3 ? this.lastSeen.pos : null);
      const d = threat ? this.feet.distanceTo(threat) : 0;
      if (threat && d > 15 && Math.random() < 0.4 + p.caution * 0.4) {
        // A screen a few meters out toward them.
        const at = this.tmp2.lerpVectors(this.feet, threat, 7 / d);
        if (s.throwGrenade(this, 'smoke', at)) {
          this.smokes--;
          this.afterThrow(at, s);
        }
      }
    }
  }

  private afterThrow(at: THREE.Vector3, s: BotServices): void {
    this.grenadeReadyAt = s.time + 9 + Math.random() * 6;
    this.pauseUntil = s.time + 0.8;
    this.faceToward(at, 1);
  }

  /** Engage movement: close in, back off or strafe to hold the preferred range. */
  private planEngage(s: BotServices): void {
    const t = this.target!;
    const dist = this.feet.distanceTo(t.feet);
    const pref = PREFERRED_RANGE[this.def.class] * this.personality.range;
    if (dist > pref * 1.4) {
      this.setGoal(t.feet, s);
      return;
    }
    if (s.time > this.strafeUntil) {
      this.strafe = Math.random() < 0.2 ? 0 : Math.random() < 0.5 ? -1 : 1;
      this.strafeUntil = s.time + 0.7 + Math.random() * 1.1;
    }
    // Sideways relative to the target, plus backing off when too close.
    const to = this.tmp.subVectors(t.feet, this.feet).setY(0).normalize();
    const side = this.tmp2.set(-to.z, 0, to.x).multiplyScalar(this.strafe * 2.5);
    if (dist < pref * 0.5) side.addScaledVector(to, -2);
    const dest = side.add(this.feet);
    if (this.strafe !== 0 && !s.nav.walkable(this.feet, dest)) {
      this.strafe = -this.strafe;
      this.strafeUntil = s.time + 0.8;
      this.hasGoal = false;
      return;
    }
    this.goal.copy(dest);
    this.path.length = 0;
    this.path.push(dest.clone());
    this.pathIndex = 0;
    this.hasGoal = this.strafe !== 0 || dist < pref * 0.5;
  }

  /** Whether a crouched bot at `spot` is still hidden from `threat` (and not on top of it). */
  private coverHolds(spot: THREE.Vector3, threat: THREE.Vector3, s: BotServices): boolean {
    if (spot.distanceTo(threat) < 6) return false;
    const eye = this.tmp.copy(threat).setY(threat.y + 1.6);
    return !s.lineOfSight(eye, this.tmp2.copy(spot).setY(spot.y + 0.85));
  }

  /** Hurt with nowhere to hide: back away from the threat. */
  private backOff(threat: THREE.Vector3, s: BotServices): void {
    const away = this.tmp.subVectors(this.feet, threat).setY(0);
    if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
    away.normalize().multiplyScalar(9).add(this.feet);
    const p = s.nav.closest(away, this.tmp2);
    if (p) this.setGoal(p, s);
  }

  /**
   * Keep an enemy who just ducked out of sight pinned: a few bursts at where
   * they were (automatic weapons, steadier characters, clear line to the spot).
   */
  private planSuppress(s: BotServices, intoSmoke = false): void {
    const age = s.time - this.lastSeen.time;
    const auto = this.def.fireMode === 'auto' || this.def.fireMode === 'burst';
    if (!auto || age > (intoSmoke ? 3.5 : 2.5) || this.weapon.ammo < this.def.magSize * 0.3) return;
    if (this.personality.archetype === 'rusher' && !intoSmoke) return;
    if (s.time < this.suppressUntil) return;
    const spot = this.tmp.copy(this.lastSeen.pos).setY(this.lastSeen.pos.y + 1.1);
    // Smoke hides the target but not the spot from bullets.
    if (s.wallsBlock(this.eyePos(this.eye), spot)) return;
    this.suppressPos.copy(spot);
    this.suppressUntil = s.time + 1.2 + Math.random() * 1.3;
  }

  private get suppressing(): boolean {
    return !this.target && this.nowRef < this.suppressUntil && (!this.inCover || this.peeking);
  }

  private get inCover(): boolean {
    if (!this.cover) return false;
    return this.cover.distanceTo(this.feet) < 0.8 || (!!this.coverLean && this.coverLean.distanceTo(this.feet) < 0.6);
  }

  /** Behind cover in a fight: alternate standing up to shoot and ducking back down. */
  private updatePeek(s: BotServices): void {
    const fighting = this.inCover && (this.action === 'engage' || this.action === 'hold');
    if (!fighting) {
      this.peeking = false;
      return;
    }
    const p = this.personality;
    const hit = s.time - this.lastHurt < 0.25;
    // Heavy fire keeps heads down: shorter looks, longer waits.
    const pinned = 1 + this.suppression * 1.5;
    if (this.peeking && (s.time > this.peekSwitchAt || hit || this.weapon.reloading)) {
      this.peeking = false;
      this.peekSwitchAt = s.time + (0.6 + p.caution * 1.1) * (0.7 + Math.random() * 0.6) * pinned;
    } else if (!this.peeking && s.time > this.peekSwitchAt && !this.weapon.reloading) {
      this.peeking = true;
      this.peekSwitchAt = s.time + ((1 + p.aggression * 1.6) * (0.7 + Math.random() * 0.6)) / pinned;
    }
    // Behind a wall: peeking is a side step out from it, ducking back is the step in.
    const lean = this.coverLean;
    if (lean && this.cover && !this.coverLow) {
      const want = this.peeking ? lean : this.cover;
      if (want.distanceTo(this.feet) > 0.25) {
        this.goal.copy(want);
        this.path.length = 0;
        this.path.push(want.clone());
        this.pathIndex = 0;
        this.hasGoal = true;
      }
    }
  }

  private setGoal(p: THREE.Vector3, s: BotServices): void {
    if (this.hasGoal && this.goal.distanceTo(p) < 1.5 && s.time < this.repathAt && this.path.length > 0) return;
    if (this.hasGoal && this.goal.distanceTo(p) < 1.5 && this.splices < RESPLICE_MAX && this.resplice(p, s)) {
      this.splices++;
      this.repathAt = s.time + 1.2;
      return;
    }
    this.splices = 0;
    this.goal.copy(p);
    this.hasGoal = s.route(this, p, this.path);
    this.pathIndex = this.path.length > 1 ? 1 : 0;
    this.repathAt = s.time + 1.2;
  }

  /**
   * Same goal, partway along a whole route to it: plans only the next stretch
   * (to a corner `RESPLICE_AHEAD` m on) and keeps the rest. A long search runs
   * out of Detour's nodes and costs ~0.7 ms; the stretch ahead is where things
   * change (sandbags built, people in the way). False: plan it all again.
   */
  private resplice(p: THREE.Vector3, s: BotServices): boolean {
    const path = this.path;
    const n = path.length;
    // Only a route that reaches the goal (a partial one is re-planned from its end).
    if (n < 3 || path[n - 1]!.distanceTo(p) > 2) return false;
    let j = this.pathIndex;
    let along = j < n ? this.feet.distanceTo(path[j]!) : 0;
    while (j < n - 1 && along < RESPLICE_AHEAD) {
      along += path[j]!.distanceTo(path[j + 1]!);
      j++;
    }
    if (j >= n - 1) return false;
    const leg = this.leg;
    if (!s.route(this, path[j]!, leg) || leg.length === 0 || leg[leg.length - 1]!.distanceTo(path[j]!) > 0.5) return false;
    const rest = path.slice(j + 1);
    path.length = 0;
    for (const q of leg) path.push(q);
    for (const q of rest) path.push(q);
    this.pathIndex = path.length > 1 ? 1 : 0;
    return true;
  }

  private faceToward(p: THREE.Vector3, share: number): void {
    const [yaw] = yawPitchOf(p.x - this.feet.x, 0, p.z - this.feet.z);
    this.aimYaw += wrapAngle(yaw - this.aimYaw) * share;
  }

  // ---------------------------------------------------------------------------

  private updateAim(dt: number, s: BotServices): void {
    const skill = s.skill;
    let yaw = this.aimYaw;
    let pitch = 0;
    const t = this.target;
    if (this.reviveOf && this.feet.distanceTo(this.reviveOf.feet) < REVIVE_RANGE * 2) {
      // Looking down at the mate being revived.
      [yaw, pitch] = yawPitchOf(this.reviveOf.feet.x - this.feet.x, -1.2, this.reviveOf.feet.z - this.feet.z);
    } else if (this.atWork) {
      // Looking at what they are working on.
      [yaw, pitch] = yawPitchOf(this.jobLook.x - this.feet.x, this.jobLook.y - this.feet.y - this.eyeHeight, this.jobLook.z - this.feet.z);
    } else if (s.time < this.lookAwayUntil) {
      // Our own flash is about to pop: turn our back to it.
      [yaw] = yawPitchOf(this.feet.x - this.lookAwayFrom.x, 0, this.feet.z - this.lookAwayFrom.z);
    } else if (t) {
      this.tracked += dt;
      // Error drifts smoothly between re-sampled offsets, shrinking as the bot settles.
      if (s.time > this.jitterAt) {
        const p = this.personality;
        const shaken = 1 + this.suppression * 1.2;
        const err = aimErrorDeg(skill.aimError * p.aim, skill.aimErrorMin * p.aim, skill.settleTime, this.tracked) * DEG * shaken;
        const a = Math.random() * Math.PI * 2;
        const r = err * Math.sqrt(Math.random());
        this.jitterGoal.set(Math.cos(a) * r, Math.sin(a) * r);
        this.jitterAt = s.time + 0.3 + Math.random() * 0.35;
      }
      this.jitter.lerp(this.jitterGoal, 1 - Math.exp(-6 * dt));
      const aimAt = this.tmp.copy(t.feet).setY(t.feet.y + this.aimHeight(t));
      // Lead moving targets a little.
      aimAt.addScaledVector(t.velocity, 0.08);
      const eye = this.eyePos(this.eye);
      [yaw, pitch] = yawPitchOf(aimAt.x - eye.x, aimAt.y - eye.y, aimAt.z - eye.z);
      yaw += this.jitter.x;
      pitch += this.jitter.y;
    } else if (s.time >= this.hurtTurnAt && s.time - this.lastHurt < 2.5) {
      // Shot by someone unseen: turn toward where it came from (a moment after the hit, at the turn rate).
      [yaw] = yawPitchOf(this.lastAttackerPos.x - this.feet.x, 0, this.lastAttackerPos.z - this.feet.z);
    } else if (this.suppressing || (this.action === 'hold' && s.time - this.lastSeen.time < 10)) {
      // Watch (or shoot at) where the enemy was.
      const eye = this.eyePos(this.eye);
      const p = this.suppressing ? this.suppressPos : this.tmp.copy(this.lastSeen.pos).setY(this.lastSeen.pos.y + 1.4);
      [yaw, pitch] = yawPitchOf(p.x - eye.x, p.y - eye.y, p.z - eye.z);
      if (this.suppressing) {
        // Suppression is loose: sweep around the spot.
        // Firing blind after a flash: much wilder.
        const wild = this.blinded ? 4 : 1;
        yaw += Math.sin(s.time * 2.3 + this.id) * 2.5 * DEG * wild;
        pitch += Math.sin(s.time * 3.1 + this.id * 2) * 1.2 * DEG * wild;
      }
    } else if (!this.hasGoal && this.action === 'advance' && s.watchDir(this)) {
      // At a post: watch the assigned direction.
      const w = s.watchDir(this)!;
      yaw = Math.atan2(-w.x, -w.z);
    } else if (this.hasGoal && this.path.length > 0 && this.scan !== null && this.action !== 'hunt') {
      // Smarter: walking, watch the side the danger is on (checking corners and windows).
      yaw = this.scan;
    } else if (this.hasGoal && this.path.length > 0) {
      // Look where we are going, or toward the last threat when hunting.
      const look = this.action === 'hunt' || this.action === 'investigate' ? this.goal : this.path[Math.min(this.pathIndex, this.path.length - 1)]!;
      [yaw] = yawPitchOf(look.x - this.feet.x, 0, look.z - this.feet.z);
    }
    if (t || s.time - this.lastHurt >= 2.5) this.hurtTurnAt = Infinity;
    const step = skill.turnRate * DEG * dt;
    this.aimYaw = turnToward(this.aimYaw, yaw, step);
    this.aimPitch = turnToward(this.aimPitch, pitch, step);
    this.yaw = this.aimYaw;
  }

  private updateMovement(stepDt: number, s: BotServices): void {
    // Level of detail: far bots move at half rate (two steps at once).
    this.moveDt += stepDt;
    if (this.far && ++this.lodTick % 2 === 1) return;
    const dt = this.moveDt;
    this.moveDt = 0;
    let wx = 0;
    let wz = 0;
    let speed = 0;
    if (this.hasGoal && this.path.length > 0) {
      let corner = this.path[this.pathIndex]!;
      // Close to a corner: on to the next one, unless (right by it, past a
      // fence end or a door jamb) the straight line there would cut the edge.
      while (this.pathIndex < this.path.length - 1) {
        const dc = Math.hypot(corner.x - this.feet.x, corner.z - this.feet.z);
        if (dc >= 0.45 || (dc > 0.12 && !s.nav.walkable(this.feet, this.path[this.pathIndex + 1]!))) break;
        corner = this.path[++this.pathIndex]!;
      }
      let dx = corner.x - this.feet.x;
      let dz = corner.z - this.feet.z;
      const d = Math.hypot(dx, dz);
      const last = this.pathIndex >= this.path.length - 1;
      // Someone already stands on the spot: stop here beside them instead of pushing in.
      if (last && d < 1.6 && s.spotTaken(this, corner)) this.hasGoal = false;
      else if (d > 0.3 || !last) {
        // Keep to this bot's side of the path on long legs (fading out near
        // corners, where the path hugs walls) so groups don't walk single file.
        const lane = this.personality.lane * LANE_WIDTH * THREE.MathUtils.clamp((d - 2) / 5, 0, 1);
        if (lane !== 0 && this.action !== 'cover') {
          const px = -dz / d;
          const pz = dx / d;
          dx += px * lane;
          dz += pz * lane;
        }
        const dl = Math.hypot(dx, dz);
        wx = dx / Math.max(dl, 1e-4);
        wz = dz / Math.max(dl, 1e-4);
        const engaged = !!this.target;
        const wary = this.personality.caution > 0.55 && s.time - this.lastSeen.time < 6;
        // Going into a building after someone: walk and look (clearing it), don't charge in.
        const clearing = this.action === 'hunt' && s.insideBuilding(this.goal);
        const sprint =
          !engaged &&
          !wary &&
          !this.blinded &&
          !clearing &&
          !s.keepPace(this) &&
          (this.action === 'advance' || this.action === 'cover' || this.action === 'hunt') &&
          d > 4;
        speed = (engaged ? MOVE.adsSpeed : sprint ? MOVE.sprintSpeed : MOVE.walkSpeed) * this.personality.pace;
        if (s.waterDepth(this.feet) > WADE_DEPTH) speed *= WADE_SPEED;
        if (this.blinded) speed *= 0.6;
        speed *= s.slowAt(this.feet);
      } else {
        this.hasGoal = false;
      }
    }

    // In cover: crouched unless peeking. In the open: crouch to shoot at range (careful types sooner).
    const inCover = this.inCover;
    const crouchRange = 22 - this.personality.caution * 12;
    const wantCrouch =
      this.reviving ||
      s.time < this.creepUntil ||
      (this.atWork && this.job?.type === 'build' && this.job.slot.kind !== 'barricade') ||
      speed === 0 &&
      (inCover && (this.action === 'engage' || this.action === 'hold' || this.weapon.reloading)
        ? !this.peeking
        : this.target
          ? this.feet.distanceTo(this.target.feet) > crouchRange || this.suppression > 0.55
          : this.suppression > 0.45 ||
            this.blinded ||
            this.action === 'advance' && !this.hasGoal && this.personality.caution > 0.5 && !!s.watchDir(this) && !s.postHere(this));
    this.setCrouch(wantCrouch);
    if (this.crouching) speed = Math.min(speed, MOVE.crouchSpeed);

    const raw = s.separation(this, this.tmp, wx, wz, speed);
    const push = this.push.lerp(raw, 1 - Math.exp(-8 * dt));
    if (push.lengthSq() < 0.0025 && raw.lengthSq() === 0) push.set(0, 0, 0);
    const tx = wx * speed + push.x;
    const tz = wz * speed + push.z;
    const accel = speed > 0 || push.lengthSq() > 0 ? MOVE.groundAccel : MOVE.groundDecel;
    [this.velocity.x, this.velocity.z] = approachVelocity(this.velocity.x, this.velocity.z, tx, tz, accel, dt);

    // Standing still: nothing to move.
    if (tx === 0 && tz === 0 && Math.abs(this.velocity.x) + Math.abs(this.velocity.z) < 0.02) {
      this.velocity.set(0, 0, 0);
      this.progressPos.copy(this.feet);
      this.progressAt = s.time;
      return;
    }

    // Bots walk on the navmesh (it already keeps them off walls and ledges);
    // a character controller per bot cost ~70 us a step on terrain.
    const next = this.tmp2.set(this.feet.x + this.velocity.x * dt, this.feet.y, this.feet.z + this.velocity.z * dt);
    this.navRef = s.nav.move(this.navRef, this.feet, next, next);
    // Navmesh heights are approximate (the tile cache has no height detail, up to
    // ~0.5 m off on hills): take the exact ground below, looking from above
    // whichever is higher so a low mesh can't put the ray under the ground.
    const from = Math.max(this.feet.y, next.y) + 1.1;
    const ground = from - s.physics.rayDistance(this.tmp3.set(next.x, from, next.z), DOWN, 2.6, Layer.WORLD);
    if (Math.abs(ground - next.y) < 1.4) next.y = ground;
    const moved = next.sub(this.feet);
    this.velocity.set(moved.x / dt, 0, moved.z / dt);
    this.grounded = true;
    this.feet.add(moved);
    // Only the player bumps into the capsule: far away it can wait.
    if (this.nearViewer) this.body.setNextKinematicTranslation(this.center());

    // Footsteps.
    const horiz = Math.hypot(moved.x, moved.z);
    this.stride -= horiz;
    if (this.stride <= 0 && this.grounded && horiz > 0) {
      const sprinting = speed >= MOVE.sprintSpeed - 0.1;
      this.stride = sprinting ? 2.5 : 1.9;
      if (!this.crouching) s.footstep(this, sprinting);
    }

    // Stuck: wanted to move but barely did for a while. Pushed off the path's
    // line (lanes, stepping around mates) it can end up against a wall short of
    // the next corner: plan again from here first, then hop sideways.
    if (speed > 0) {
      if (this.feet.distanceTo(this.progressPos) > 0.6) {
        this.progressPos.copy(this.feet);
        this.progressAt = s.time;
        this.stuckTries = 0;
      } else if (s.time - this.progressAt > (this.stuckTries === 0 ? 0.7 : 1.5)) {
        this.progressAt = s.time;
        if (this.stuckTries++ === 0) this.setGoalForce(this.tmp3.copy(this.goal), s);
        else {
          const escape = s.nav.randomAround(this.feet, 3);
          if (escape) this.setGoalForce(escape, s);
        }
      }
    } else {
      this.progressPos.copy(this.feet);
      this.progressAt = s.time;
    }
  }

  private setGoalForce(p: THREE.Vector3, s: BotServices): void {
    this.splices = 0;
    this.goal.copy(p);
    this.hasGoal = s.route(this, p, this.path);
    this.pathIndex = this.path.length > 1 ? 1 : 0;
    this.repathAt = s.time + 1.2;
  }

  private updateWeapon(dt: number, s: BotServices): void {
    const w = this.weapon;
    let trigger = false;
    const t = this.target;
    const suppress = !t && this.suppressing;
    // A crew under armour is a rocket's job: no point emptying a rifle at the hull.
    const armour = !!t && s.coverOf(t) === 'armour';
    if ((t || suppress) && !armour && !w.reloading && w.ammo > 0) {
      const eye = this.eyePos(this.eye);
      const aimAt = t ? this.tmp.copy(t.feet).setY(t.feet.y + this.aimHeight(t)) : this.tmp.copy(this.suppressPos);
      const [ty, tp] = yawPitchOf(aimAt.x - eye.x, aimAt.y - eye.y, aimAt.z - eye.z);
      const off = Math.hypot(wrapAngle(ty - this.aimYaw), tp - this.aimPitch) / DEG;
      const dist = eye.distanceTo(aimAt);
      // Only fire once roughly on target (allowance grows at close range).
      const onTarget = off < 3 + 60 / Math.max(4, dist);
      if (onTarget && s.time >= this.pauseUntil) {
        const auto = this.def.fireMode === 'auto' || this.def.fireMode === 'burst';
        if (auto) {
          if (this.burstLeft <= 0) {
            const [lo, hi] = s.skill.burst;
            // Close range: longer sprays.
            const scale = dist < 10 ? 2 : 1;
            this.burstLeft = Math.round((lo + Math.random() * (hi - lo)) * scale);
          }
          trigger = true;
        } else {
          // Semi / pump / bolt: pull and release.
          trigger = !this.triggerHeld;
        }
      }
    }
    if (w.ammo === 0 && !w.reloading && w.canReload()) w.startReload();
    this.triggerHeld = trigger;
    const res = w.step(dt, { trigger, reload: false });
    for (let i = 0; i < res.shots; i++) {
      this.firingUntil = s.time + 0.6;
      s.fire(this, this.aimDir(this.tmp2));
      if (--this.burstLeft <= 0 && (this.def.fireMode === 'auto' || this.def.fireMode === 'burst')) {
        const [lo, hi] = s.skill.burstPause;
        const dist = t ? this.feet.distanceTo(t.feet) : 20;
        this.pauseUntil = s.time + (dist < 10 ? 0.1 : lo + Math.random() * (hi - lo));
      }
      if (this.def.fireMode === 'semi') this.pauseUntil = s.time + 0.12 + Math.random() * 0.2;
    }
  }

  aimDir(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.aimPitch);
    return out.set(-Math.sin(this.aimYaw) * cp, Math.sin(this.aimPitch), -Math.cos(this.aimYaw) * cp);
  }

  private setCrouch(on: boolean): void {
    if (on === this.crouching) return;
    this.crouching = on;
    this.height = on ? CROUCH_HEIGHT : MOVE.standHeight;
    this.capsule.setHalfHeight(capsuleHalfHeight(this.height));
    this.body.setTranslation(this.center(), true);
  }

  private center(): { x: number; y: number; z: number } {
    return { x: this.feet.x, y: this.feet.y + this.height / 2, z: this.feet.z };
  }

  /** Render-side smoothing of crouch for the model. */
  crouchAmount(dt: number): number {
    this.crouchBlend += ((this.crouching ? 1 : 0) - this.crouchBlend) * (1 - Math.exp(-10 * dt));
    return this.crouchBlend;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  dispose(physics: PhysicsWorld): void {
    this.hitboxes.dispose();
    physics.world.removeRigidBody(this.body);
  }
}
