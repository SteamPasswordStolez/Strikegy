import * as THREE from 'three';
import { Layer, RAPIER, groups, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { HitPart } from '@/core/events';
import type { DamageSource, Damageable, HitboxRegistry } from '@/combat/Hitboxes';
import { CharacterHitboxes } from '@/combat/CharacterHitboxes';
import { Health } from '@/player/health';
import { MOVE, approachVelocity, capsuleHalfHeight } from '@/player/movement';
import type { Team } from '@/world/mapTypes';
import { WeaponState } from '@/weapons/WeaponState';
import type { WeaponDef } from '@/weapons/weaponData';
import type { NavWorld } from './NavWorld';
import type { BotSkill } from './difficulty';
import { chooseAction, type BotAction } from './brain';
import { aimErrorDeg, noticeTime, offAxisDeg, turnToward, wrapAngle, yawPitchOf } from './aim';
import type { Combatant } from './types';
import { COMBAT_WINDOW } from '@/modes/squads';

const DEG = Math.PI / 180;
const PERCEIVE_EVERY = 0.1;
const THINK_EVERY = 0.25;
const CROUCH_HEIGHT = MOVE.crouchHeight;

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
  /** Cover spot against `threat`; undefined when the search budget for this step is spent (ask again later). */
  findCover(bot: Bot, threat: THREE.Vector3): THREE.Vector3 | null | undefined;
  /** Where this bot should head when nothing is going on (squad objective / flank). */
  squadGoal(bot: Bot): THREE.Vector3;
  /** The team's most recent sighting of any enemy. */
  teamSighting(team: Team): { pos: THREE.Vector3; time: number } | null;
  reportSighting(team: Team, pos: THREE.Vector3): void;
  /** Resolves one trigger pull (all pellets) along `dir` from the bot's eye. */
  fire(bot: Bot, dir: THREE.Vector3): void;
  footstep(bot: Bot, sprinting: boolean): void;
  /** The squad goal moved enough that a bot heading to the old one should re-path (following a leader). */
  squadGoalMoved(bot: Bot, current: THREE.Vector3): boolean;
  /** Far from the squad leader: prefer catching up. */
  mustRegroup(bot: Bot): boolean;
  /** Push away from nearby bots (m/s, horizontal) so they don't stack up. */
  separation(bot: Bot, out: THREE.Vector3): THREE.Vector3;
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
  deadTime = 0;
  /** Extra respawn wait (squad wiped out); cleared on spawn. */
  respawnPenalty = 0;
  action: BotAction = 'advance';
  /** Current enemy being fought (visible and noticed). */
  target: Combatant | null = null;
  readonly hitboxes: CharacterHitboxes;

  private readonly body: RAPIER.RigidBody;
  private readonly capsule: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private height: number = MOVE.standHeight;

  // Perception / memory
  private perceiveTimer: number;
  private thinkTimer: number;
  private readonly notice = new Map<number, number>();
  private readonly lastSeen = { pos: new THREE.Vector3(), time: -Infinity };
  private readonly heard = { pos: new THREE.Vector3(), time: -Infinity };
  private lastHurt = -Infinity;
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
  private readonly progressPos = new THREE.Vector3();
  private progressAt = 0;
  private stride = 0;

  // Aim / trigger
  private readonly jitter = new THREE.Vector2();
  private readonly jitterGoal = new THREE.Vector2();
  private jitterAt = 0;
  private burstLeft = 0;
  private pauseUntil = 0;
  private triggerHeld = false;

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();

  constructor(
    readonly name: string,
    readonly team: Team,
    public def: WeaponDef,
    physics: PhysicsWorld,
    registry: HitboxRegistry,
  ) {
    this.weapon = new WeaponState(def);
    const world = physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.capsule = world.createCollider(
      RAPIER.ColliderDesc.capsule(capsuleHalfHeight(this.height), MOVE.radius).setCollisionGroups(groups(Layer.BOT, Layer.WORLD)),
      this.body,
    );
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.45, 0.2, false);
    this.controller.enableSnapToGround(0.35);
    this.controller.setMaxSlopeClimbAngle(50 * DEG);
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
    this.deadTime = 0;
    this.respawnPenalty = 0;
  }

  inCombat(now: number): boolean {
    return !!this.target || now - this.lastHurt < COMBAT_WINDOW || this.firingUntil > now - COMBAT_WINDOW;
  }

  applyDamage(amount: number, part: HitPart, source?: DamageSource): boolean {
    if (!this.alive) return false;
    const killed = this.health.damage(amount);
    this.lastHurt = this.nowRef;
    void part;
    // Getting shot reveals roughly where it came from.
    if (source) {
      this.lastSeen.pos.copy(source.pos);
      this.lastSeen.time = this.nowRef;
      if (!this.target) this.faceToward(source.pos, 0.6);
    }
    if (killed) this.die();
    return killed;
  }

  private die(): void {
    this.capsule.setEnabled(false);
    this.hitboxes.setEnabled(false);
    this.target = null;
    this.deadTime = 0;
    this.velocity.set(0, 0, 0);
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

  // ---------------------------------------------------------------------------
  // Simulation

  step(dt: number, s: BotServices): void {
    this.nowRef = s.time;
    this.prevFeet.copy(this.feet);
    if (!this.alive) {
      this.deadTime += dt;
      return;
    }
    this.health.step(dt);

    this.perceiveTimer -= dt;
    if (this.perceiveTimer <= 0) {
      this.perceiveTimer += PERCEIVE_EVERY;
      this.perceive(s, PERCEIVE_EVERY);
    }
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer += THINK_EVERY;
      this.think(s);
    }
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
      let visible = false;
      if (inView) {
        const head = this.tmp.copy(e.feet).setY(e.feet.y + e.eyeHeight);
        const chest = this.tmp2.copy(e.feet).setY(e.feet.y + e.eyeHeight * 0.7);
        visible = s.lineOfSight(eye, head) || s.lineOfSight(eye, chest);
      }
      if (visible) {
        progress = Math.min(1.5, progress + dt / noticeTime(skill.reaction, dist, off, skill.fov / 2, firing));
        if (progress >= 1) {
          this.lastSeen.pos.copy(e.feet);
          this.lastSeen.time = s.time;
          s.reportSighting(this.team, e.feet);
          // Prefer the current target, then the closest.
          const d = e === this.target ? dist * 0.6 : dist;
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
    const threat = this.target ? this.target.feet : this.lastSeen.time > s.time - 4 ? this.lastSeen.pos : null;
    if (threat && (!this.cover || s.time > this.coverUntil)) {
      const found = s.findCover(this, threat);
      if (found !== undefined) {
        this.cover = found;
        this.coverUntil = s.time + 3;
      }
    } else if (!threat) {
      this.cover = null;
    }
    const inCover = !!this.cover && this.cover.distanceTo(this.feet) < 0.8;
    const team = s.teamSighting(this.team);
    const ownAge = s.time - this.lastSeen.time;
    const teamAge = team ? s.time - team.time : Infinity;
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
      },
      this.action,
    );

    switch (this.action) {
      case 'engage':
        this.planEngage(s);
        break;
      case 'cover':
        if (this.cover) this.setGoal(this.cover, s);
        break;
      case 'reload':
        if (w.canReload()) w.startReload();
        if (this.cover) this.setGoal(this.cover, s);
        else this.hasGoal = false;
        break;
      case 'hunt':
        this.setGoal(ownAge <= teamAge + 2 ? this.lastSeen.pos : team!.pos, s);
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
    // Reload opportunistically when nothing is visible.
    if (!this.target && w.ammo < this.def.magSize * 0.4 && w.canReload()) w.startReload();
  }

  /** Engage movement: close in, back off or strafe to hold the preferred range. */
  private planEngage(s: BotServices): void {
    const t = this.target!;
    const dist = this.feet.distanceTo(t.feet);
    const pref = PREFERRED_RANGE[this.def.class];
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

  private setGoal(p: THREE.Vector3, s: BotServices): void {
    if (this.hasGoal && this.goal.distanceTo(p) < 1.5 && s.time < this.repathAt && this.path.length > 0) return;
    this.goal.copy(p);
    this.hasGoal = s.nav.path(this.feet, p, this.path);
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
    if (t) {
      this.tracked += dt;
      // Error drifts smoothly between re-sampled offsets, shrinking as the bot settles.
      if (s.time > this.jitterAt) {
        const err = aimErrorDeg(skill.aimError, skill.aimErrorMin, skill.settleTime, this.tracked) * DEG;
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

  private updateMovement(dt: number, s: BotServices): void {
    let wx = 0;
    let wz = 0;
    let speed = 0;
    if (this.hasGoal && this.path.length > 0) {
      let corner = this.path[this.pathIndex]!;
      while (Math.hypot(corner.x - this.feet.x, corner.z - this.feet.z) < 0.45 && this.pathIndex < this.path.length - 1) {
        corner = this.path[++this.pathIndex]!;
      }
      const dx = corner.x - this.feet.x;
      const dz = corner.z - this.feet.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3 || this.pathIndex < this.path.length - 1) {
        wx = dx / Math.max(d, 1e-4);
        wz = dz / Math.max(d, 1e-4);
        const engaged = !!this.target;
        const sprint = !engaged && (this.action === 'advance' || this.action === 'cover' || this.action === 'hunt') && d > 4;
        speed = engaged ? MOVE.adsSpeed : sprint ? MOVE.sprintSpeed : MOVE.walkSpeed;
      } else {
        this.hasGoal = false;
      }
    }

    // Crouch when holding still in a fight at range, or while reloading in cover.
    const inCover = !!this.cover && this.cover.distanceTo(this.feet) < 0.8;
    const wantCrouch = speed === 0 && ((!!this.target && this.feet.distanceTo(this.target.feet) > 15) || (inCover && this.weapon.reloading));
    this.setCrouch(wantCrouch);
    if (this.crouching) speed = Math.min(speed, MOVE.crouchSpeed);

    const push = s.separation(this, this.tmp);
    const tx = wx * speed + push.x;
    const tz = wz * speed + push.z;
    const accel = speed > 0 || push.lengthSq() > 0 ? MOVE.groundAccel : MOVE.groundDecel;
    [this.velocity.x, this.velocity.z] = approachVelocity(this.velocity.x, this.velocity.z, tx, tz, accel, dt);
    this.velocity.y = this.grounded ? -1 : Math.max(this.velocity.y - MOVE.gravity * dt, -MOVE.maxFallSpeed);

    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.controller.computeColliderMovement(this.capsule, desired, undefined, groups(0xffff, Layer.WORLD | Layer.PLAYER | Layer.BOUNDS));
    const moved = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    this.velocity.x = moved.x / dt;
    this.velocity.z = moved.z / dt;
    if (this.grounded) this.velocity.y = 0;
    this.feet.x += moved.x;
    this.feet.y += moved.y;
    this.feet.z += moved.z;
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
    this.hasGoal = s.nav.path(this.feet, p, this.path);
    this.pathIndex = this.path.length > 1 ? 1 : 0;
    this.repathAt = s.time + 1.2;
  }

  private updateWeapon(dt: number, s: BotServices): void {
    const w = this.weapon;
    let trigger = false;
    const t = this.target;
    if (t && !w.reloading && w.ammo > 0) {
      const eye = this.eyePos(this.eye);
      const aimAt = this.tmp.copy(t.feet).setY(t.feet.y + t.eyeHeight * 0.78);
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
    physics.world.removeCharacterController(this.controller);
    physics.world.removeRigidBody(this.body);
  }
}
