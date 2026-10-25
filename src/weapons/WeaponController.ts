import * as THREE from 'three';
import { foes } from '@/modes/matchFlags';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import { t } from '@/i18n';
import type { Team } from '@/world/mapTypes';
import type { SurfaceRegistry } from '@/physics/surfaces';
import type { GameBus } from '@/core/events';
import type { InputState } from '@/input/InputState';
import { computeDamage, type Damageable, type HitboxRegistry } from '@/combat/Hitboxes';
import type { HitPart } from '@/core/events';
import { MOVE } from '@/player/movement';
import type { Player } from '@/player/Player';
import { WeaponState } from './WeaponState';
import { gunPattern, recoilKick, recoilScale } from './recoil';
import { WEAPONS, damageAtDistance, type WeaponDef, type WeaponId } from './weaponData';
import { INSPECT_CUES, MELEE_STRIKE_T } from './viewAnims';

const DEG = Math.PI / 180;
const BLOOM_MAX = 3;
const BLOOM_DECAY = 6;
const RECOIL_RECOVERY = 6;
const MAX_RECOIL_PITCH = 12 * DEG;
/** A pause this long between shots starts a new spray (pattern restarts). */
const SPRAY_RESET = 0.28;
/** Delay after a pump/bolt shot before the cycling action is heard/seen. */
const CYCLE_DELAY = 0.22;

/** Melee: whole swing, when it lands, reach and damage (two body hits kill, head 70). */
export const MELEE_TIME = 0.6;
// The blow lands when every melee motion reaches its strike pose.
export const MELEE_HIT = MELEE_TIME * MELEE_STRIKE_T;
export const MELEE_RANGE = 2.0;
export const MELEE_DAMAGE = { head: 70, body: 55, limb: 55 } as const;
/** Weapon inspection length (s). */
export const INSPECT_TIME = 3.2;
/** Aim offsets (tangents right / up) of the melee probe rays: forgiving at close range. */
const MELEE_PROBES: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.12, 0],
  [-0.12, 0],
  [0, 0.1],
  [0, -0.14],
];

/** Reload progress points (0..1) at which magazine cues fire. */
const MAG_CUES = [
  { at: 0.2, cue: 'magOut' as const },
  { at: 0.62, cue: 'magIn' as const },
  { at: 0.86, cue: 'chamber' as const },
];

export interface ShotTrace {
  from: THREE.Vector3;
  to: THREE.Vector3;
}

/** What a shot (or a melee probe) met, when something other than the physics world judges it. */
export interface ShotHit {
  distance: number;
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  /** The world collider struck (impact surface), or null. */
  handle: number | null;
  /** A soldier struck, or null. */
  target: { owner: Damageable; part: HitPart } | null;
}

/**
 * Judges a ray instead of the physics world's hitboxes: the game server rewinds
 * soldiers to where the shooter saw them (lag compensation).
 */
export type ShotCaster = (eye: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => ShotHit | null;

/** Who holds the gun: names and sides in the kill feed and damage, friendly fire, hit markers. */
export interface WeaponOwner {
  readonly id: number;
  readonly team: Team;
  name(): string;
  /** The soldier this browser plays: hit markers and "You" in the kill feed. */
  readonly local: boolean;
}

/**
 * Player-side weapon handling: loadout switching, ADS, spread/bloom, recoil
 * patterns and hitscan resolution. Runs on the fixed simulation step.
 */
export class WeaponController {
  loadout: WeaponId[];
  /** Support passive: reserve ammo never runs down. */
  endlessReserve = false;
  private states = new Map<WeaponId, WeaponState>();
  private index = 0;
  /** 0 = hip, 1 = fully aimed. */
  adsBlend = 0;
  /** Extra spread in degrees from sustained fire. */
  bloom = 0;
  /** View offset from recoil in radians; added to the camera look. */
  readonly recoil = { pitch: 0, yaw: 0 };
  /** Scope sway in radians (set by the game each step, see `breath.ts`); the shot follows it. */
  readonly sway = { pitch: 0, yaw: 0 };
  drawTimer = 0.35;
  /** Coming up out of a sprint (s left of `WeaponDef.sprintOut`): no firing or aiming yet. */
  sprintOut = 0;
  private wasSprinting = false;
  sinceShot = 10;
  /** Shots resolved since the render side last drained them (tracers). */
  readonly traces: ShotTrace[] = [];
  private shotIndex = 0;
  private spraySeed = 0;
  private cycleTimer = -1;
  private cueIndex = 0;
  private lastAmmo = 0;
  /** Seconds into a melee swing, or -1. */
  meleeTime = -1;
  /** Seconds into an inspection, or -1. */
  inspectTime = -1;
  /** Shots fired so far (rounds, not pellets). */
  shots = 0;

  private readonly eye = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  /** The shooter's own hitboxes, excluded from its rays. */
  ignoreChar: number | undefined;
  /** Called for every round fired (pellets flagged): where it went and whom it hit (-1: nobody). */
  onRound: ((from: THREE.Vector3, to: THREE.Vector3, hitId: number, pellet: boolean) => void) | null = null;
  /**
   * Spread and spray patterns draw from this. A match on the game server seeds
   * it the same at both ends for each life, so the browser's shots go where
   * the server's do.
   */
  rand: () => number = Math.random;
  /** Judges shots instead of the physics hitboxes (see `ShotCaster`). */
  shotCaster: ShotCaster | null = null;
  /**
   * How much of the recoil the owner's view keeps once a spray stops (gunplay
   * audit, owner 2026-10-18: Modern Warfare style, one pulls the gun down
   * oneself). The rest slides back. 0 everywhere but the browser playing the
   * soldier: there the kept part moves the look itself (`Player.applyLook`),
   * which the game server gets with the next input, so its aim agrees.
   */
  viewKeep = 0;

  /** The carried weapons as fitted with attachments (`withAttachments`); missing ones are as in the lineup. */
  private fitted = new Map<WeaponId, WeaponDef>();

  constructor(
    loadout: WeaponId[],
    private readonly physics: PhysicsWorld,
    private readonly registry: HitboxRegistry,
    private readonly surfaces: SurfaceRegistry,
    private readonly bus: GameBus,
    private readonly owner: WeaponOwner,
  ) {
    this.loadout = loadout;
  }

  get def(): WeaponDef {
    return this.defOf(this.loadout[this.index]!);
  }

  /** A carried weapon as fitted. */
  defOf(id: WeaponId): WeaponDef {
    return this.fitted.get(id) ?? WEAPONS[id];
  }

  get state(): WeaponState {
    const id = this.loadout[this.index]!;
    let s = this.states.get(id);
    if (!s) {
      s = new WeaponState(this.defOf(id));
      if (this.endlessReserve) s.reserve = Infinity;
      this.states.set(id, s);
    }
    return s;
  }

  /** New weapons (respawn with another loadout): first slot in hand, everything full. `defs`: as fitted, in the same order. */
  setLoadout(ids: WeaponId[], endlessReserve: boolean, defs?: readonly WeaponDef[]): void {
    this.loadout = ids;
    this.fitted = new Map(defs ? ids.map((id, i) => [id, defs[i] ?? WEAPONS[id]]) : []);
    this.endlessReserve = endlessReserve;
    this.index = 0;
    this.resetAmmo();
  }

  /** Reserve ammo is below full on any carried weapon (an ammo box would help). */
  get needsAmmo(): boolean {
    return this.loadout.some((id) => {
      const s = this.states.get(id);
      return !!s && s.reserve < this.defOf(id).reserve;
    });
  }

  /** Ammo box / station: every carried gun's reserve back to full (magazines stay as they are). */
  refillReserve(): void {
    for (const [id, s] of this.states) s.reserve = this.endlessReserve ? Infinity : Math.max(s.reserve, this.defOf(id).reserve);
  }

  /** Refills every weapon (respawn). */
  resetAmmo(): void {
    this.states.clear();
    this.recoil.pitch = this.recoil.yaw = 0;
    this.bloom = 0;
    this.adsBlend = 0;
    this.redraw();
    this.meleeTime = this.inspectTime = -1;
    this.sprintOut = 0;
    this.wasSprinting = false;
  }

  /** The gun in hand is (re)drawn: out of a vehicle, off a parachute, a switch. */
  redraw(): void {
    this.drawTimer = this.def.drawTime;
  }

  /** 0..1 through taking the gun out. */
  get drawProgress(): number {
    return 1 - this.drawTimer / this.def.drawTime;
  }

  /** 0..1 of the sprint-out still to go (the view model lifts the gun with it). */
  get sprintOutLeft(): number {
    return this.sprintOut / this.def.sprintOut;
  }

  /** 0..1 through the melee swing, or -1. */
  get meleeProgress(): number {
    return this.meleeTime < 0 ? -1 : this.meleeTime / MELEE_TIME;
  }

  /** 0..1 through the inspection, or -1. */
  get inspectProgress(): number {
    return this.inspectTime < 0 ? -1 : this.inspectTime / INSPECT_TIME;
  }

  /** Current total spread half-angle in degrees. */
  spread(player: Player): number {
    const d = this.def;
    const base = d.spreadHip + (d.spreadAds - d.spreadHip) * this.adsBlend;
    // Down the sights rounds go where the sight is: moving and sustained fire
    // only open up hip fire (the recoil one sees does the rest).
    const hip = 1 - this.adsBlend;
    const move = Math.min(1, player.horizontalSpeed() / MOVE.walkSpeed) * 1.2 * hip;
    const air = player.grounded ? 0 : 3;
    const stance = player.crouching && player.grounded ? 0.8 : 1;
    return (base + this.bloom * hip) * stance + move + air;
  }

  /** Blocks firing/aiming (e.g. while throwing a grenade or dead). */
  step(dt: number, input: InputState, player: Player, blocked: boolean): void {
    this.handleSwitch(input);

    const s = this.state;
    const d = this.def;
    this.drawTimer = Math.max(0, this.drawTimer - dt);
    // Out of a sprint (stopped, or ended by the trigger / sights) the gun comes up first.
    // Swimming holds the gun out of the water like a sprint holds it low (and it comes up the same way after).
    const lowered = player.sprinting || player.swimming;
    if (this.wasSprinting && !lowered) this.sprintOut = d.sprintOut;
    this.wasSprinting = lowered;
    this.sprintOut = Math.max(0, this.sprintOut - dt);
    this.stepMelee(dt, input, player, blocked || player.swimming);
    const meleeing = this.meleeTime >= 0;
    const ready = this.drawTimer === 0 && this.sprintOut === 0 && !lowered && !blocked && !meleeing;
    const wantAds = input.ads && ready && !(s.reloading && d.reloadStyle === 'mag');
    const adsRate = dt / d.adsTime;
    this.adsBlend = THREE.MathUtils.clamp(this.adsBlend + (wantAds ? adsRate : -adsRate), 0, 1);

    const wasReloading = s.reloading;
    const res = s.step(dt, { trigger: input.fire && ready, reload: input.reload && !blocked && !meleeing });
    this.stepInspect(dt, input, player, ready && !s.reloading && !input.fire && !input.ads);
    if (res.reloadStarted) {
      this.cueIndex = 0;
      this.lastAmmo = s.ammo;
      this.bus.emit('weapon:reloadStart', { weaponId: d.id });
    }
    if (s.reloading || wasReloading) this.emitReloadCues(s, d);
    if (res.reloadFinished) this.bus.emit('weapon:reloadEnd', { weaponId: d.id });
    if (res.dryFire) this.bus.emit('weapon:dryFire', { weaponId: d.id });

    for (let i = 0; i < res.shots; i++) this.fire(player);

    if (this.cycleTimer >= 0) {
      this.cycleTimer -= dt;
      if (this.cycleTimer < 0 && s.ammo > 0) this.bus.emit('weapon:cycle', { weaponId: d.id });
    }

    this.sinceShot += dt;
    this.bloom = Math.max(0, this.bloom - BLOOM_DECAY * dt * (this.sinceShot > 0.08 ? 1 : 0.2));
    if (this.sinceShot > 0.12) {
      const k = 1 - Math.exp(-RECOIL_RECOVERY * dt);
      const dPitch = this.recoil.pitch * k;
      const dYaw = this.recoil.yaw * k;
      this.recoil.pitch -= dPitch;
      this.recoil.yaw -= dYaw;
      if (this.viewKeep > 0) player.applyLook(dYaw * this.viewKeep, dPitch * this.viewKeep);
    }
  }

  /** Starts, advances and resolves a melee swing. */
  private stepMelee(dt: number, input: InputState, player: Player, blocked: boolean): void {
    if (input.melee && this.meleeTime < 0 && this.drawTimer === 0 && !blocked) {
      const s = this.state;
      // The swing interrupts a reload (the magazine stays out) and an inspection.
      if (s.reloading) {
        s.cancelReload();
        this.bus.emit('weapon:reloadEnd', { weaponId: this.def.id });
      }
      this.inspectTime = -1;
      this.meleeTime = 0;
      this.bus.emit('weapon:meleeSwing', { weaponId: this.def.id });
      return;
    }
    if (this.meleeTime < 0) return;
    const before = this.meleeTime;
    this.meleeTime += dt;
    if (before < MELEE_HIT && this.meleeTime >= MELEE_HIT) this.strike(player);
    if (this.meleeTime >= MELEE_TIME) this.meleeTime = -1;
  }

  private stepInspect(dt: number, input: InputState, player: Player, idle: boolean): void {
    if (this.inspectTime < 0) {
      if (input.inspect && idle && this.adsBlend === 0) this.inspectTime = 0;
      return;
    }
    // Anything else you do (shoot, aim, reload, sprint, throw, swing) ends it.
    if (!idle || player.sprinting || player.swimming) {
      this.inspectTime = -1;
      return;
    }
    const d = this.def;
    const before = this.inspectTime / INSPECT_TIME;
    this.inspectTime += dt;
    const now = this.inspectTime / INSPECT_TIME;
    if (d.reloadStyle === 'mag') {
      if (before < INSPECT_CUES.magOut && now >= INSPECT_CUES.magOut) this.bus.emit('weapon:inspectCue', { weaponId: d.id, cue: 'magOut' });
      if (before < INSPECT_CUES.magIn && now >= INSPECT_CUES.magIn) this.bus.emit('weapon:inspectCue', { weaponId: d.id, cue: 'magIn' });
    }
    if (this.inspectTime >= INSPECT_TIME) this.inspectTime = -1;
  }

  /**
   * The melee blow: a few short rays in a narrow cone from the eye. The first
   * enemy hitbox any of them reaches takes the hit; otherwise a wall is struck.
   */
  private strike(player: Player): void {
    const d = this.def;
    const { eye, fwd, right, up } = this.aimBasis(player);
    const dir = new THREE.Vector3();
    let wall: { point: THREE.Vector3; normal: THREE.Vector3; handle: number | null; raw: { x: number; y: number; z: number } } | null = null;
    for (const [a, b] of MELEE_PROBES) {
      dir.copy(fwd).addScaledVector(right, a).addScaledVector(up, b).normalize();
      const hit = this.cast(eye, dir, MELEE_RANGE);
      if (!hit) continue;
      const point = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
      const target = hit.target;
      if (target) {
        if (!target.owner.alive || !foes(target.owner, this.owner)) continue;
        this.hurt(target.owner, target.part, MELEE_DAMAGE[target.part], point, t('weapon.melee'), eye, false, true);
        this.bus.emit('weapon:melee', { weaponId: d.id, hit: 'body' });
        return;
      }
      if (!wall) wall = { point, normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), handle: hit.handle, raw: hit.point };
    }
    if (wall) {
      this.bus.emit('combat:impact', { point: wall.point, normal: wall.normal, surface: wall.handle === null ? 'concrete' : this.surfaces.get(wall.handle, wall.raw) });
      this.bus.emit('weapon:melee', { weaponId: d.id, hit: 'world' });
    } else this.bus.emit('weapon:melee', { weaponId: d.id, hit: 'none' });
  }

  /** Damage from this gun (or the swing): hit and kill events in the owner's name. */
  private hurt(victim: Damageable, part: HitPart, dmg: number, point: THREE.Vector3, weapon: string, from: THREE.Vector3, headshot: boolean, melee = false): void {
    const o = this.owner;
    const source = { pos: from.clone(), name: o.name(), team: o.team, weapon, id: o.id };
    const killed = victim.applyDamage(dmg, part, source);
    this.bus.emit('combat:hit', { targetId: victim.id, part, damage: dmg, killed, point, byPlayer: o.local, attackerId: o.id });
    if (!killed) return;
    this.bus.emit('combat:kill', {
      attacker: o.local ? 'You' : o.name(),
      victim: victim.name,
      weapon,
      headshot,
      byPlayer: o.local,
      attackerTeam: o.team,
      victimTeam: victim.team ?? null,
      attackerId: o.id,
      victimId: victim.id,
      melee,
    });
  }

  private emitReloadCues(s: WeaponState, d: WeaponDef): void {
    if (d.reloadStyle === 'perShell') {
      if (s.ammo > this.lastAmmo) this.bus.emit('weapon:reloadCue', { weaponId: d.id, cue: 'shell' });
      this.lastAmmo = s.ammo;
      return;
    }
    const progress = s.reloading ? s.reloadProgress : 1;
    while (this.cueIndex < MAG_CUES.length && progress >= MAG_CUES[this.cueIndex]!.at) {
      this.bus.emit('weapon:reloadCue', { weaponId: d.id, cue: MAG_CUES[this.cueIndex]!.cue });
      this.cueIndex++;
    }
  }

  private handleSwitch(input: InputState): void {
    let next = this.index;
    if (input.weaponSlot >= 0 && input.weaponSlot < this.loadout.length) next = input.weaponSlot;
    else if (input.weaponCycle !== 0) {
      const n = this.loadout.length;
      next = (((this.index + input.weaponCycle) % n) + n) % n;
    }
    if (next === this.index || this.meleeTime >= 0) return;
    this.state.cancelReload();
    this.inspectTime = -1;
    this.index = next;
    this.redraw();
    this.adsBlend = 0;
    this.bloom = 0;
    this.cycleTimer = -1;
    this.bus.emit('weapon:switched', { weaponId: this.def.id });
  }

  /** Eye position and aim basis (including recoil) for the current frame. */
  aimBasis(player: Player): { eye: THREE.Vector3; fwd: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 } {
    this.eye.copy(player.feet);
    this.eye.y += player.eyeHeight;
    this.euler.set(player.pitch + this.recoil.pitch + this.sway.pitch, player.yaw + this.recoil.yaw + this.sway.yaw, 0);
    this.fwd.set(0, 0, -1).applyEuler(this.euler);
    this.right.set(1, 0, 0).applyEuler(this.euler);
    this.up.set(0, 1, 0).applyEuler(this.euler);
    return { eye: this.eye, fwd: this.fwd, right: this.right, up: this.up };
  }

  private fire(player: Player): void {
    const d = this.def;
    if (this.sinceShot > SPRAY_RESET) {
      this.shotIndex = 0;
      this.spraySeed = this.rand();
    }
    this.sinceShot = 0;
    this.shots++;
    this.aimBasis(player);

    const spreadRad = this.spread(player) * DEG;
    const pellets = d.pellets ?? 1;
    for (let p = 0; p < pellets; p++) {
      // Uniform sample inside the spread cone.
      const r = Math.tan(spreadRad) * Math.sqrt(this.rand());
      const theta = this.rand() * Math.PI * 2;
      const dir = this.fwd
        .clone()
        .addScaledVector(this.right, Math.cos(theta) * r)
        .addScaledVector(this.up, Math.sin(theta) * r)
        .normalize();
      this.resolveRay(dir, pellets > 1);
    }

    this.bloom = Math.min(BLOOM_MAX, this.bloom + d.bloomPerShot);
    const kick = recoilKick(d.recoil, this.shotIndex, this.spraySeed, gunPattern(d.id));
    const crouched = player.crouching && player.grounded;
    const still = player.velocity.x ** 2 + player.velocity.z ** 2 < 0.25;
    const scale = recoilScale({ adsBlend: this.adsBlend, crouched, braced: !!d.bipod && crouched && still });
    this.recoil.pitch = Math.min(MAX_RECOIL_PITCH, this.recoil.pitch + kick.pitch * DEG * scale);
    this.recoil.yaw += kick.yaw * DEG * scale;
    this.shotIndex++;
    if (d.fireMode === 'pump' || d.fireMode === 'bolt') this.cycleTimer = CYCLE_DELAY;
    this.bus.emit('weapon:fired', { weaponId: d.id, ads: this.adsBlend > 0.5 });
  }

  /** A ray from the eye: the shot caster's judgement, or the physics world's (walls and hitboxes). */
  private cast(eye: THREE.Vector3, dir: THREE.Vector3, maxDist: number): ShotHit | null {
    if (this.shotCaster) return this.shotCaster(eye, dir, maxDist);
    const hit = this.physics.raycast(eye, dir, maxDist, Layer.WORLD | Layer.HITBOX, undefined, undefined, undefined, this.ignoreChar);
    if (!hit) return null;
    const target = this.registry.lookup(hit.collider.handle) ?? null;
    return { distance: hit.distance, point: hit.point, normal: hit.normal, handle: hit.collider.handle, target };
  }

  private resolveRay(dir: THREE.Vector3, isPellet: boolean): void {
    const d = this.def;
    const maxDist = d.range * 1.5;
    const hit = this.cast(this.eye, dir, maxDist);
    const to = hit
      ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z)
      : this.eye.clone().addScaledVector(dir, maxDist);
    const target = hit?.target;
    this.onRound?.(this.eye, to, target?.owner.id ?? -1, isPellet);

    if (hit && target) {
      // Friendly fire is off: teammates simply stop the round.
      if (target.owner.alive && foes(target.owner, this.owner)) {
        const dmg = computeDamage(damageAtDistance(d, hit.distance), target.part, d.headshotMult);
        this.hurt(target.owner, target.part, dmg, to, d.name, this.eye, target.part === 'head');
      }
    } else if (hit && !target && (!isPellet || Math.random() < 0.5)) {
      this.bus.emit('combat:impact', {
        point: to,
        normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
        surface: hit.handle === null ? 'concrete' : this.surfaces.get(hit.handle, hit.point),
      });
    }
    this.traces.push({ from: this.eye.clone(), to });
  }
}
