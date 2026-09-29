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
import { aimErrorDeg, noticeTime, offAxisDeg, turnToward, wrapAngle, yawPitchOf } from './aim';
import type { Combatant } from './types';
import { rollPersonality, type Personality } from './personality';
import { COMBAT_WINDOW } from '@/modes/squads';
import { CLASSES, DOWN as DOWN_RULES, MEDKIT, REVIVE_RANGE, type ClassId } from '@/data/classes';

const DEG = Math.PI / 180;
const DOWN = { x: 0, y: -1, z: 0 };
const PERCEIVE_EVERY = 0.1;
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
  /** Push away from nearby bots (m/s, horizontal) so they don't stack up. */
  separation(bot: Bot, out: THREE.Vector3): THREE.Vector3;
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
}

let nextBotId = 1;

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
  /** Extra respawn wait (squad wiped out); cleared on spawn. */
  respawnPenalty = 0;
  action: BotAction = 'advance';
  /** Current enemy being fought (visible and noticed). */
  target: Combatant | null = null;
  readonly hitboxes: CharacterHitboxes;

  private readonly body: RAPIER.RigidBody;
  private readonly capsule: RAPIER.Collider;
  private height: number = MOVE.standHeight;

  // Perception / memory
  private perceiveTimer: number;
  private perceiveCount = 0;
  private thinkTimer: number;
  private readonly notice = new Map<number, number>();
  private readonly lastSeen = { pos: new THREE.Vector3(), time: -Infinity };
  private readonly heard = { pos: new THREE.Vector3(), time: -Infinity };
  private lastHurt = -Infinity;
  /** Who shot us last (combatant id) and from where. */
  private lastAttacker = -1;
  private readonly lastAttackerPos = new THREE.Vector3();
  /** 0..1: rounds cracking past recently (near misses and hits); decays over a few seconds. */
  suppression = 0;
  /** Flashbanged: blind until this sim time. */
  private blindUntil = -Infinity;
  private tracked = 0;

  // Movement
  private readonly path: THREE.Vector3[] = [];
  private pathIndex = 0;
  private readonly goal = new THREE.Vector3();
  private hasGoal = false;
  private repathAt = 0;
  private cover: THREE.Vector3 | null = null;
  private coverUntil = 0;
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
  private moveDt = 0;
  private lodTick = Math.random() < 0.5 ? 0 : 1;

  // Aim / trigger
  private readonly jitter = new THREE.Vector2();
  private readonly jitterGoal = new THREE.Vector2();
  private jitterAt = 0;
  private burstLeft = 0;
  private pauseUntil = 0;
  private triggerHeld = false;

  private readonly tmp = new THREE.Vector3();
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
    this.notice.clear();
    this.lastSeen.time = this.heard.time = this.lastHurt = -Infinity;
    this.action = 'advance';
    this.path.length = 0;
    this.hasGoal = false;
    this.cover = null;
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
    void part;
    // Getting shot reveals roughly where it came from.
    if (source) {
      this.lastSeen.pos.copy(source.pos);
      this.lastSeen.time = this.nowRef;
      this.lastAttacker = source.id;
      this.lastAttackerPos.copy(source.pos);
      this.suppression = Math.min(1, this.suppression + 0.35);
      if (!this.target) this.faceToward(source.pos, 0.6);
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
    this.path.length = 0;
    this.hasGoal = false;
    this.setCrouch(false);
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

  /** Heard gunfire or footsteps at `pos`. */
  hear(pos: THREE.Vector3, time: number): void {
    if (!this.alive) return;
    this.heard.pos.copy(pos);
    this.heard.time = time;
  }

  /**
   * A round cracked past (or a burst landed close). Pins the bot down: worse
   * aim, keener to get into cover, less peeking; also gives away roughly
   * where the shooter is. Rushers shrug more of it off.
   */
  suppress(amount: number, from: THREE.Vector3, time: number): void {
    if (!this.alive) return;
    this.suppression = Math.min(1, this.suppression + amount * (1.25 - this.personality.aggression * 0.7));
    this.heard.pos.copy(from);
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
    return this.lastAttacker >= 0 ? this.lastAttackerPos : null;
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
    this.updatePeek(s);
    this.updateAim(dt, s);
    this.updateMovement(dt, s);
    this.updateWeapon(dt, s);
    this.hitboxes.sync(this.feet, this.yaw, this.height);
  }

  private perceive(s: BotServices, dt: number): void {
    const skill = s.skill;
    if (s.time < this.blindUntil) {
      this.target = null;
      this.notice.clear();
      return;
    }
    const eye = this.eyePos(this.eye);
    this.perceiveCount++;
    let best: Combatant | null = null;
    let bestDist = Infinity;
    for (const e of s.enemiesOf(this.team)) {
      if (!e.alive) {
        this.notice.delete(e.id);
        continue;
      }
      const dx = e.feet.x - this.feet.x;
      const dz = e.feet.z - this.feet.z;
      const dist = Math.hypot(dx, dz);
      let progress = this.notice.get(e.id) ?? 0;
      const off = offAxisDeg(this.aimYaw, dx, dz);
      const inView = dist < skill.sight && (off < skill.fov / 2 || dist < 4);
      const firing = e.firingUntil > s.time;
      // Distant, quiet enemies not yet noticed at all are looked for every other time (halves the rays).
      if (progress === 0 && !firing && dist > 25 && (this.perceiveCount + e.id) % 2 === 1) continue;
      let visible = false;
      if (inView) {
        const head = this.tmp.copy(e.feet).setY(e.feet.y + e.eyeHeight);
        const chest = this.tmp2.copy(e.feet).setY(e.feet.y + e.eyeHeight * 0.7);
        visible = s.canSee(this, e, eye, head, chest);
      }
      // Tree crowns in between hide people at range (thick woods completely).
      let leaves = 0;
      if (visible && dist > 12) {
        leaves = s.foliage(eye, this.tmp2.copy(e.feet).setY(e.feet.y + e.eyeHeight * 0.7));
        if (leaves > (firing ? 2.4 : 1.4) && progress < 1) visible = false;
      }
      if (visible) {
        const hidden = 1 + leaves * (firing ? 0.8 : 2);
        progress = Math.min(1.5, progress + dt / (noticeTime(skill.reaction * this.personality.reaction, dist, off, skill.fov / 2, firing) * hidden));
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
      this.notice.set(e.id, progress);
    }
    if (best !== this.target) this.tracked = 0;
    this.target = best;
  }

  private think(s: BotServices): void {
    const w = this.weapon;
    // Running from a grenade: nothing else matters for a moment.
    if (s.time < this.dodgeUntil) return;
    this.considerMedkit(s);
    if (this.planRevive(s)) return;
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
        : this.suppression > 0.3 && s.time - this.heard.time < 2
          ? this.heard.pos
          : null;
    if (threat && (!this.cover || s.time > this.coverUntil)) {
      // Keep a cover spot while it still hides us; only look for a new one when it doesn't.
      if (this.cover && this.coverHolds(this.cover, threat, s)) {
        this.coverUntil = s.time + 3;
      } else {
        const found = s.findCover(this, threat);
        if (found !== undefined) {
          this.cover = found;
          this.coverUntil = s.time + 3;
        }
      }
    } else if (!threat) {
      this.cover = null;
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
        heardAge: s.time - this.heard.time,
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
        this.setGoal(ownAge <= teamAge + 2 ? this.lastSeen.pos : team!.pos, s);
        // Steadier types keep firing at the spot while they close in.
        if (this.personality.caution > 0.4) this.planSuppress(s);
        break;
      case 'investigate':
        this.setGoal(this.heard.pos, s);
        break;
      case 'advance':
        if (!this.hasGoal || this.feet.distanceTo(this.goal) < 3 || s.time > this.repathAt + 8 || s.squadGoalMoved(this, this.goal)) {
          this.setGoal(s.squadGoal(this), s);
        }
        break;
    }
    // Someone just vanished into smoke: keep firing into it.
    if (!this.target && s.time - this.lastSeen.time < 3.5 && s.inSmoke(this.lastSeen.pos)) this.planSuppress(s, true);
    // Reload opportunistically when nothing is visible.
    if (!this.target && w.ammo < this.def.magSize * 0.4 && w.canReload()) w.startReload();
    this.considerGrenade(s, inCover);
  }

  /** Hurt and out of the line of fire: patch up with a medkit. */
  private considerMedkit(s: BotServices): void {
    if (this.health.value > 45 || s.time < this.medkitReadyAt || this.medkits <= 0) return;
    if (s.time - this.lastHurt < 0.8 || (this.target && !this.inCover)) return;
    this.health.value = 100;
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

  /** At a downed mate's side and working on them. */
  get reviving(): boolean {
    return !!this.reviveOf && this.reviveProgress > 0;
  }

  /** Enemies within `range` this bot has noticed. */
  private knownEnemies(s: BotServices, range: number): number {
    let n = 0;
    const r2 = range * range;
    for (const e of s.enemiesOf(this.team)) {
      if (!e.alive || (this.notice.get(e.id) ?? 0) < 1) continue;
      if (e.feet.distanceToSquared(this.feet) < r2) n++;
    }
    return n;
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
    const threat = age < 6 ? this.lastSeen.pos : s.time - this.heard.time < 4 ? this.heard.pos : null;
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
      let at: THREE.Vector3 | null = null;
      const age = s.time - this.lastSeen.time;
      if (!this.target && age > 0.8 && age < 5) {
        const d = this.feet.distanceTo(this.lastSeen.pos);
        const spot = this.tmp.copy(this.lastSeen.pos).setY(this.lastSeen.pos.y + 1);
        if (d > 9 && d < 32 && !s.lineOfSight(eye, spot)) at = this.lastSeen.pos;
      } else if (this.target) {
        const d = this.feet.distanceTo(this.target.feet);
        if (d > 12 && d < 30 && s.enemiesNear(this.team, this.target.feet, 5) >= 2) at = this.target.feet;
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
    return !!this.cover && this.cover.distanceTo(this.feet) < 0.8;
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
  }

  private setGoal(p: THREE.Vector3, s: BotServices): void {
    if (this.hasGoal && this.goal.distanceTo(p) < 1.5 && s.time < this.repathAt && this.path.length > 0) return;
    this.goal.copy(p);
    this.hasGoal = s.route(this, p, this.path);
    this.pathIndex = this.path.length > 1 ? 1 : 0;
    this.repathAt = s.time + 1.2;
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
      const aimAt = this.tmp.copy(t.feet).setY(t.feet.y + t.eyeHeight * 0.78);
      // Lead moving targets a little.
      aimAt.addScaledVector(t.velocity, 0.08);
      const eye = this.eyePos(this.eye);
      [yaw, pitch] = yawPitchOf(aimAt.x - eye.x, aimAt.y - eye.y, aimAt.z - eye.z);
      yaw += this.jitter.x;
      pitch += this.jitter.y;
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
    } else if (this.hasGoal && this.path.length > 0) {
      // Look where we are going, or toward the last threat when hunting.
      const look = this.action === 'hunt' || this.action === 'investigate' ? this.goal : this.path[Math.min(this.pathIndex, this.path.length - 1)]!;
      [yaw] = yawPitchOf(look.x - this.feet.x, 0, look.z - this.feet.z);
    }
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
      while (Math.hypot(corner.x - this.feet.x, corner.z - this.feet.z) < 0.45 && this.pathIndex < this.path.length - 1) {
        corner = this.path[++this.pathIndex]!;
      }
      let dx = corner.x - this.feet.x;
      let dz = corner.z - this.feet.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3 || this.pathIndex < this.path.length - 1) {
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
      } else {
        this.hasGoal = false;
      }
    }

    // In cover: crouched unless peeking. In the open: crouch to shoot at range (careful types sooner).
    const inCover = this.inCover;
    const crouchRange = 22 - this.personality.caution * 12;
    const wantCrouch =
      this.reviving ||
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

    const push = s.separation(this, this.tmp);
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
    // Navmesh heights are approximate on terrain: take the exact ground below.
    const ground = s.physics.raycast(this.tmp3.set(next.x, next.y + 0.9, next.z), DOWN, 2, Layer.WORLD);
    if (ground && Math.abs(ground.point.y - next.y) < 0.8) next.y = ground.point.y;
    const moved = next.sub(this.feet);
    this.velocity.set(moved.x / dt, 0, moved.z / dt);
    this.grounded = true;
    this.feet.add(moved);
    this.body.setNextKinematicTranslation(this.center());

    // Footsteps.
    const horiz = Math.hypot(moved.x, moved.z);
    this.stride -= horiz;
    if (this.stride <= 0 && this.grounded && horiz > 0) {
      const sprinting = speed >= MOVE.sprintSpeed - 0.1;
      this.stride = sprinting ? 2.5 : 1.9;
      if (!this.crouching) s.footstep(this, sprinting);
    }

    // Stuck: wanted to move but barely did for a while -> repath or hop sideways.
    if (speed > 0) {
      if (this.feet.distanceTo(this.progressPos) > 0.6) {
        this.progressPos.copy(this.feet);
        this.progressAt = s.time;
      } else if (s.time - this.progressAt > 1.5) {
        this.progressAt = s.time;
        const escape = s.nav.randomAround(this.feet, 3);
        if (escape) this.setGoalForce(escape, s);
      }
    } else {
      this.progressPos.copy(this.feet);
      this.progressAt = s.time;
    }
  }

  private setGoalForce(p: THREE.Vector3, s: BotServices): void {
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
    if ((t || suppress) && !w.reloading && w.ammo > 0) {
      const eye = this.eyePos(this.eye);
      const aimAt = t ? this.tmp.copy(t.feet).setY(t.feet.y + t.eyeHeight * 0.78) : this.tmp.copy(this.suppressPos);
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
