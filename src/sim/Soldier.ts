import * as THREE from 'three';
import type { Combatant } from '@/ai/types';
import { CharacterHitboxes } from '@/combat/CharacterHitboxes';
import type { DamageSource, Damageable, HitboxRegistry } from '@/combat/Hitboxes';
import type { DamageCause, GameBus } from '@/core/events';
import { ASSAULT_WADE_EASE, DOWN, MEDKIT, loadoutWeapons, moveBonus, type ClassId, type Loadout } from '@/data/classes';
import type { InputState } from '@/input/InputState';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { SurfaceRegistry } from '@/physics/surfaces';
import { Player } from '@/player/Player';
import { wishDirection } from '@/player/movement';
import type { Vehicle } from '@/vehicles/Vehicle';
import { fallDamage } from '@/player/health';
import { GrenadeInventory } from '@/weapons/Throwables';
import type { GrenadeType } from '@/combat/explosions';
import { GADGETS, classGadget, type GadgetId } from '@/data/gadgets';
import { DRAW_TIME, WeaponController } from '@/weapons/WeaponController';
import type { WeaponId } from '@/weapons/weaponData';
import type { Team } from '@/world/mapTypes';
import { COMBAT_WINDOW } from '@/modes/squads';

/** Seconds from a real death to the next deploy (time spent down counts toward it). */
export const RESPAWN_SEC = 4;
/** The weapon is unusable this long after starting a throw, and the next throw waits this long. */
export const THROW_BLOCK = 0.55;
export const THROW_COOLDOWN = 0.8;
/** Under a parachute: falling speed and steering drift (m/s). */
export const CHUTE = { fall: 8, steer: 4.5 };
/** How long a shot keeps a soldier "firing" for bots spotting it (combat clock, s). */
const FIRING_GLOW = 0.6;

/**
 * Reactions only the soldier's own view has (the local player's HUD, sound,
 * camera, and its kit beyond guns: vehicles, the hammer, the gadget). The game
 * server leaves them empty.
 */
export interface SoldierHooks {
  /** Took damage. */
  hurt?(amount: number, from: THREE.Vector3 | null, cause: DamageCause): void;
  /** Health gone, before going down (get out of the vehicle, drop the chute). */
  falling?(cause: DamageCause, source: DamageSource | undefined): void;
  /** Down, waiting for a revive. */
  down?(cause: DamageCause, source: DamageSource | undefined): void;
  revived?(by: string): void;
  /** Dead for good. */
  died?(cause: DamageCause): void;
  /** Started patching up with a medkit. */
  medkit?(): void;
}

export interface SoldierOptions {
  id: number;
  team: Team;
  name: () => string;
  /** The soldier this browser plays. */
  local: boolean;
  physics: PhysicsWorld;
  bus: GameBus;
  impacts: SurfaceRegistry;
  registry: HitboxRegistry;
  spawn: THREE.Vector3;
  yaw: number;
  loadout: WeaponId[];
  /** Sim clock (s): shields, cooldowns. */
  now: () => number;
  /** The bots' clock (s): "in combat" and "just fired" for spotting and squads. */
  combatClock: () => number;
}

/**
 * A soldier played by a person: the movement capsule, hitboxes, guns,
 * grenades and medkits, health, going down, being revived and dying. The same
 * class runs the local player in the browser and every player on the game
 * server; what only the local view does goes through `hooks`.
 */
export class Soldier {
  readonly id: number;
  readonly team: Team;
  readonly local: boolean;
  readonly player: Player;
  readonly boxes: CharacterHitboxes;
  readonly weapons: WeaponController;
  readonly grenades = new GrenadeInventory();
  /** As bots see it (spotting, squads, zones). */
  readonly combatant: Combatant;
  /** As guns and blasts see it. */
  readonly target: Damageable;
  hooks: SoldierHooks = {};
  /**
   * This sim decides health, going down and dying. False for the browser's
   * soldier in a match on the game server: the server's news (`netDown`,
   * `die`, `revive`) does it instead, and local hits and falls change nothing.
   */
  authority = true;
  /** Class of the current life (passives). */
  cls: ClassId = 'assault';
  /** On the field. Matches with a deploy screen take the dead off it until they deploy again. */
  deployed = true;
  deployFlow = false;
  /** Down: health gone, waiting for a revive; bleeds out or gives up into a real death. */
  downed = false;
  downTime = 0;
  /** Seconds the give-up key has been held while down. */
  giveUpHold = 0;
  private downCause: DamageCause = 'bullet';
  private downSource: DamageSource | undefined;
  private reviveShieldUntil = -Infinity;
  /** Seconds until this soldier may deploy (or respawn) again. */
  respawnTimer = 0;
  /** Combat clock of the last hit taken and until when it counts as firing. */
  hurtAt = -Infinity;
  firingUntil = -1;
  /** Who downed this soldier (another soldier's name; null for self-inflicted or none). */
  killedBy: string | null = null;
  /** Medkits carried (medics: endless on a cooldown until `medkitReadyAt`). */
  medkits: number = MEDKIT.carried;
  medkitReadyAt = 0;
  /** Seconds left of using a medkit (weapon lowered) and of the heal after it. */
  medkitUse = 0;
  healLeft = 0;
  /** Throwing: hands busy, then the wait before the next throw (s). */
  throwBlock = 0;
  throwCooldown = 0;
  /** The downed mate being revived (holding E) and for how long (s). */
  reviveOf: number | null = null;
  reviveProgress = 0;
  /** The class gadget of this life, how many are left, whether it's in hand (4) and the wait before the next use. */
  gadget: GadgetId | null = null;
  gadgetCount = 0;
  gadgetOut = false;
  gadgetBusy = 0;
  /** Build mode (T): the hammer out. */
  buildMode = false;
  /** Seconds of hands-on work (building, restocking) going on now, or -1. */
  working = -1;
  /** In a vehicle (match on the game server): which one and the seat. */
  ride: { v: Vehicle; seat: number } | null = null;
  /** Under a parachute after bailing out of a plane high up: the drift (null: not). */
  chute: THREE.Vector3 | null = null;
  private readonly now: () => number;
  private readonly combatClock: () => number;
  private readonly bus: GameBus;

  constructor(o: SoldierOptions) {
    this.id = o.id;
    this.team = o.team;
    this.local = o.local;
    this.now = o.now;
    this.combatClock = o.combatClock;
    this.bus = o.bus;
    this.player = new Player(o.physics, o.bus, o.impacts, o.spawn, o.yaw);
    this.weapons = new WeaponController(o.loadout, o.physics, o.registry, o.impacts, o.bus, { id: o.id, team: o.team, name: o.name, local: o.local });
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const s = this;
    this.combatant = {
      id: o.id,
      team: o.team,
      get name() {
        return o.name();
      },
      get alive() {
        return s.player.alive && s.deployed;
      },
      get downed() {
        return s.downed && s.deployed;
      },
      get feet() {
        return s.player.feet;
      },
      get yaw() {
        return s.player.yaw;
      },
      inCombat(now: number) {
        return s.firingUntil > now - COMBAT_WINDOW || now - s.hurtAt < COMBAT_WINDOW;
      },
      get velocity() {
        return s.player.velocity;
      },
      get eyeHeight() {
        return s.player.eyeHeight;
      },
      get firingUntil() {
        return s.firingUntil;
      },
    };
    this.target = {
      id: o.id,
      // The kill feed marks the local player's own lines by this name.
      get name() {
        return o.local ? 'You' : o.name();
      },
      team: o.team,
      get alive() {
        return s.player.alive && s.deployed;
      },
      applyDamage: (amount, _part, source) => {
        this.damage(amount, source?.pos ?? null, 'bullet', source);
        return !this.player.alive;
      },
    };
    this.boxes = new CharacterHitboxes(o.physics, o.registry, this.target);
    this.boxes.place(this.player.feet, this.player.yaw);
    this.weapons.ignoreBody = this.boxes.body;
    this.player.onLanded = (speed) => {
      const dmg = fallDamage(speed);
      if (dmg > 0) this.damage(dmg, null, 'fall');
    };
  }

  get alive(): boolean {
    return this.player.alive;
  }

  /** Out of the world for good (the person left): capsule and hitboxes go. */
  dispose(): void {
    this.player.dispose();
    this.boxes.dispose();
  }

  // ---------------------------------------------------------------------------
  // Steps

  /**
   * On foot: guns and movement for one sim step. `busy`: hands taken
   * (throwing, patching up, reviving, building); `slow`: what slows walking
   * here (barbed wire).
   */
  stepOnFoot(dt: number, input: InputState, busy: boolean, slow = 1): void {
    const p = this.player;
    const w = this.weapons;
    p.speedBonus = moveBonus(this.cls, w.def) * slow;
    p.wadePenalty = this.cls === 'assault' ? ASSAULT_WADE_EASE : 1;
    const firing = input.fire;
    // Pulling the trigger, aiming or swinging ends a sprint immediately.
    if (input.fire || input.ads || input.melee) {
      input.sprint = false;
      p.sprinting = false;
    }
    const shots = w.shots;
    w.step(dt, input, p, busy);
    if (w.shots !== shots) this.firingUntil = this.combatClock() + FIRING_GLOW;
    p.step(dt, input, w.adsBlend > 0.5, firing && w.sinceShot < 0.2);
  }

  /**
   * Throws a grenade of the carried type, if any is left and the last throw
   * is long enough ago. `launch` puts it in the world (the game server, solo
   * play); a browser in a match there leaves it out and draws the server's.
   */
  throwGrenade(launch: ((type: GrenadeType, origin: THREE.Vector3, dir: THREE.Vector3, carry: THREE.Vector3) => void) | null): boolean {
    if (this.throwCooldown > 0 || this.player.sprinting) return false;
    const type = this.grenades.take();
    if (!type) return false;
    const { eye, fwd, right, up } = this.weapons.aimBasis(this.player);
    const origin = eye.clone().addScaledVector(fwd, 0.45).addScaledVector(right, -0.15).addScaledVector(up, -0.05);
    launch?.(type, origin, fwd.clone(), this.player.velocity.clone());
    this.throwBlock = THROW_BLOCK;
    this.throwCooldown = THROW_COOLDOWN;
    this.bus.emit('grenade:thrown', { type, remaining: this.grenades.count });
    return true;
  }

  /** Out of a plane at `at`: a canopy opens, drifting down from there (keeping some of the plane's speed at first). */
  openChute(at: THREE.Vector3, carry: THREE.Vector3): void {
    this.chute = carry.clone().multiplyScalar(0.25).setY(-CHUTE.fall);
    this.player.ride(at.clone().setY(at.y + this.player.eyeHeight), this.chute);
  }

  /**
   * Under the canopy: WASD steers, it comes down at `CHUTE.fall` and lands on
   * whatever is below (then on foot). True on landing.
   */
  stepChute(dt: number, input: InputState, physics: PhysicsWorld): boolean {
    const p = this.player;
    const vel = this.chute!;
    const [wx, wz] = input.moveX || input.moveY ? wishDirection(input.moveX, input.moveY, p.yaw) : [0, 0];
    const k = Math.min(1, dt * 1.5);
    vel.x += (wx * CHUTE.steer - vel.x) * k;
    vel.z += (wz * CHUTE.steer - vel.z) * k;
    vel.y = -CHUTE.fall;
    const step = vel.clone().multiplyScalar(dt);
    const hit = physics.raycast(p.feet.clone().setY(p.feet.y + 0.5), step.clone().normalize(), step.length() + 0.5, Layer.WORLD);
    if (hit) {
      this.chute = null;
      p.dismount(new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z));
      return true;
    }
    p.ride(p.feet.clone().add(step).setY(p.feet.y + step.y + p.eyeHeight), vel);
    return false;
  }

  /** Throw timers run down. */
  stepTimers(dt: number): void {
    this.throwBlock = Math.max(0, this.throwBlock - dt);
    this.throwCooldown = Math.max(0, this.throwCooldown - dt);
  }

  /** Hitboxes to where the body is now (after everyone moved). */
  syncBoxes(): void {
    const p = this.player;
    this.boxes.sync(p.feet, p.yaw, p.bodyHeight);
  }

  /** Down: the bleed-out clock, and giving up while `holdingGiveUp`. */
  stepDowned(dt: number, holdingGiveUp: boolean): void {
    this.downTime += dt;
    this.giveUpHold = holdingGiveUp ? this.giveUpHold + dt : 0;
    if (!this.authority) return;
    if (this.giveUpHold >= DOWN.giveUpHold || this.downTime >= DOWN.bleedOut) this.die(this.downCause, this.downSource);
  }

  // ---------------------------------------------------------------------------
  // Health

  /** Damage from anything; true if it took the last health (the soldier goes down). */
  damage(amount: number, from: THREE.Vector3 | null, cause: DamageCause, source?: DamageSource): boolean {
    const p = this.player;
    if (!this.authority || !p.alive || this.now() < this.reviveShieldUntil) return false;
    const killed = p.health.damage(amount);
    this.hurtAt = this.combatClock();
    this.bus.emit('player:damaged', { amount, from, cause });
    this.hooks.hurt?.(amount, from, cause);
    if (killed) {
      this.hooks.falling?.(cause, source);
      this.goDown(cause, source);
    }
    return killed;
  }

  /** The server says this soldier went down (`killedBy`: another soldier's name, or null). */
  netDown(cause: DamageCause, killedBy: string | null): void {
    if (this.downed) return;
    this.player.health.value = 0;
    this.goDown(cause, undefined, killedBy);
  }

  /** Health gone: down on the ground until revived, bled out or given up. */
  private goDown(cause: DamageCause, source?: DamageSource, killer?: string | null): void {
    this.downed = true;
    this.downTime = 0;
    this.giveUpHold = 0;
    this.downCause = cause;
    this.downSource = source;
    this.weapons.adsBlend = 0;
    this.weapons.state.cancelReload();
    this.medkitUse = this.healLeft = 0;
    this.reviveOf = null;
    this.reviveProgress = 0;
    this.boxes.setEnabled(false);
    this.killedBy = killer !== undefined ? killer : source && source.id !== this.id ? source.name : null;
    this.hooks.down?.(cause, source);
  }

  /** Back up (a mate revived this soldier) with `health`. */
  revive(by: string, health: number): void {
    if (!this.downed) return;
    this.downed = false;
    this.player.health.value = health;
    this.boxes.setEnabled(true);
    this.reviveShieldUntil = this.now() + DOWN.reviveShield;
    this.killedBy = null;
    this.weapons.drawTimer = DRAW_TIME;
    this.hooks.revived?.(by);
  }

  /** Dead for good (bled out or gave up): off the field until the next deploy. */
  die(cause: DamageCause, source?: DamageSource): void {
    void source;
    this.downed = false;
    // The time spent down already counts toward the respawn wait.
    this.respawnTimer = Math.max(0, RESPAWN_SEC - this.downTime);
    this.weapons.adsBlend = 0;
    if (this.deployFlow) this.deployed = false;
    this.boxes.setEnabled(false);
    this.hooks.died?.(cause);
    this.bus.emit('player:died', { cause });
    this.bus.emit('combatant:died', { team: this.team, id: this.id });
  }

  // ---------------------------------------------------------------------------
  // Medkits

  get medkitReady(): boolean {
    return this.cls === 'medic' ? this.now() >= this.medkitReadyAt : this.medkits > 0;
  }

  /** Patch up to full health over a second (the weapon comes down meanwhile). */
  useMedkit(): void {
    if (!this.medkitReady || this.medkitUse > 0 || this.player.health.value >= 100) return;
    if (this.cls === 'medic') this.medkitReadyAt = this.now() + MEDKIT.medicCooldown;
    else this.medkits--;
    this.medkitUse = MEDKIT.useTime;
    this.healLeft = MEDKIT.healTime;
    this.weapons.state.cancelReload();
    this.hooks.medkit?.();
  }

  stepMedkit(dt: number): void {
    if (this.medkitUse > 0) this.medkitUse = Math.max(0, this.medkitUse - dt);
    if (this.healLeft > 0) {
      const h = this.player.health;
      h.value = Math.min(100, h.value + (100 / MEDKIT.healTime) * dt);
      this.healLeft = Math.max(0, this.healLeft - dt);
    }
  }

  // ---------------------------------------------------------------------------
  // Lives

  /**
   * A new life at `at`: full health and kit. `kit`: the loadout picked on the
   * deploy screen; `weapons`: carry these instead of the class loadout (the
   * range's sandbox, everything for testing).
   */
  spawn(at: THREE.Vector3, yaw: number, kit: Loadout, weapons: WeaponId[] | null = null): void {
    const p = this.player;
    p.health.reset();
    this.ride = null;
    this.chute = null;
    p.dismount(at);
    p.teleport(at, yaw);
    this.boxes.setEnabled(true);
    this.killedBy = null;
    this.cls = kit.cls;
    if (weapons) this.weapons.resetAmmo();
    else this.weapons.setLoadout(loadoutWeapons(kit), kit.cls === 'support');
    this.grenades.reset(kit.grenade);
    this.downed = false;
    this.downTime = 0;
    this.medkits = MEDKIT.carried;
    this.medkitReadyAt = 0;
    this.medkitUse = this.healLeft = 0;
    this.throwBlock = this.throwCooldown = 0;
    this.reviveOf = null;
    this.reviveProgress = 0;
    this.gadget = classGadget(kit.cls, kit.reconGadget);
    this.gadgetCount = this.gadget ? GADGETS[this.gadget].count : 0;
    this.gadgetOut = false;
    this.gadgetBusy = 0;
    this.buildMode = false;
    this.working = -1;
    this.weapons.sway.pitch = this.weapons.sway.yaw = 0;
    this.bus.emit('player:respawned', {});
  }
}

