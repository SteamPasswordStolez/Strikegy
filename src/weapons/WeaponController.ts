import * as THREE from 'three';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { SurfaceRegistry } from '@/physics/surfaces';
import type { GameBus } from '@/core/events';
import type { InputState } from '@/input/InputState';
import { computeDamage, type HitboxRegistry } from '@/combat/Hitboxes';
import { MOVE } from '@/player/movement';
import type { Player } from '@/player/Player';
import { WeaponState } from './WeaponState';
import { recoilKick, recoilScale } from './recoil';
import { WEAPONS, damageAtDistance, type WeaponDef, type WeaponId } from './weaponData';

const DEG = Math.PI / 180;
export const DRAW_TIME = 0.35;
const BLOOM_MAX = 3;
const BLOOM_DECAY = 6;
const RECOIL_RECOVERY = 6;
const MAX_RECOIL_PITCH = 12 * DEG;
/** A pause this long between shots starts a new spray (pattern restarts). */
const SPRAY_RESET = 0.28;
/** Delay after a pump/bolt shot before the cycling action is heard/seen. */
const CYCLE_DELAY = 0.22;

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

/**
 * Player-side weapon handling: loadout switching, ADS, spread/bloom, recoil
 * patterns and hitscan resolution. Runs on the fixed simulation step.
 */
export class WeaponController {
  readonly loadout: WeaponId[];
  private states = new Map<WeaponId, WeaponState>();
  private index = 0;
  /** 0 = hip, 1 = fully aimed. */
  adsBlend = 0;
  /** Extra spread in degrees from sustained fire. */
  bloom = 0;
  /** View offset from recoil in radians; added to the camera look. */
  readonly recoil = { pitch: 0, yaw: 0 };
  drawTimer = DRAW_TIME;
  sinceShot = 10;
  /** Shots resolved since the render side last drained them (tracers). */
  readonly traces: ShotTrace[] = [];
  private shotIndex = 0;
  private spraySeed = 0;
  private cycleTimer = -1;
  private cueIndex = 0;
  private lastAmmo = 0;

  private readonly eye = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    loadout: WeaponId[],
    private readonly physics: PhysicsWorld,
    private readonly registry: HitboxRegistry,
    private readonly surfaces: SurfaceRegistry,
    private readonly bus: GameBus,
  ) {
    this.loadout = loadout;
  }

  get def(): WeaponDef {
    return WEAPONS[this.loadout[this.index]!];
  }

  get state(): WeaponState {
    const id = this.loadout[this.index]!;
    let s = this.states.get(id);
    if (!s) {
      s = new WeaponState(WEAPONS[id]);
      this.states.set(id, s);
    }
    return s;
  }

  /** Refills every weapon (respawn). */
  resetAmmo(): void {
    this.states.clear();
    this.recoil.pitch = this.recoil.yaw = 0;
    this.bloom = 0;
    this.adsBlend = 0;
    this.drawTimer = DRAW_TIME;
  }

  /** Current total spread half-angle in degrees. */
  spread(player: Player): number {
    const d = this.def;
    const base = d.spreadHip + (d.spreadAds - d.spreadHip) * this.adsBlend;
    const move = Math.min(1, player.horizontalSpeed() / MOVE.walkSpeed) * 1.2 * (1 - 0.75 * this.adsBlend);
    const air = player.grounded ? 0 : 3;
    const stance = player.crouching && player.grounded ? 0.8 : 1;
    return (base + this.bloom * (1 - 0.5 * this.adsBlend)) * stance + move + air;
  }

  /** Blocks firing/aiming (e.g. while throwing a grenade or dead). */
  step(dt: number, input: InputState, player: Player, blocked: boolean): void {
    this.handleSwitch(input);

    const s = this.state;
    const d = this.def;
    this.drawTimer = Math.max(0, this.drawTimer - dt);
    const ready = this.drawTimer === 0 && !player.sprinting && !blocked;
    const wantAds = input.ads && ready && !(s.reloading && d.reloadStyle === 'mag');
    const adsRate = dt / d.adsTime;
    this.adsBlend = THREE.MathUtils.clamp(this.adsBlend + (wantAds ? adsRate : -adsRate), 0, 1);

    const wasReloading = s.reloading;
    const res = s.step(dt, { trigger: input.fire && ready, reload: input.reload && !blocked });
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
      const k = Math.exp(-RECOIL_RECOVERY * dt);
      this.recoil.pitch *= k;
      this.recoil.yaw *= k;
    }
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
    if (next === this.index) return;
    this.state.cancelReload();
    this.index = next;
    this.drawTimer = DRAW_TIME;
    this.adsBlend = 0;
    this.bloom = 0;
    this.cycleTimer = -1;
    this.bus.emit('weapon:switched', { weaponId: this.def.id });
  }

  /** Eye position and aim basis (including recoil) for the current frame. */
  aimBasis(player: Player): { eye: THREE.Vector3; fwd: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 } {
    this.eye.copy(player.feet);
    this.eye.y += player.eyeHeight;
    this.euler.set(player.pitch + this.recoil.pitch, player.yaw + this.recoil.yaw, 0);
    this.fwd.set(0, 0, -1).applyEuler(this.euler);
    this.right.set(1, 0, 0).applyEuler(this.euler);
    this.up.set(0, 1, 0).applyEuler(this.euler);
    return { eye: this.eye, fwd: this.fwd, right: this.right, up: this.up };
  }

  private fire(player: Player): void {
    const d = this.def;
    if (this.sinceShot > SPRAY_RESET) {
      this.shotIndex = 0;
      this.spraySeed = Math.random();
    }
    this.sinceShot = 0;
    this.aimBasis(player);

    const spreadRad = this.spread(player) * DEG;
    const pellets = d.pellets ?? 1;
    for (let p = 0; p < pellets; p++) {
      // Uniform sample inside the spread cone.
      const r = Math.tan(spreadRad) * Math.sqrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const dir = this.fwd
        .clone()
        .addScaledVector(this.right, Math.cos(theta) * r)
        .addScaledVector(this.up, Math.sin(theta) * r)
        .normalize();
      this.resolveRay(dir, pellets > 1);
    }

    this.bloom = Math.min(BLOOM_MAX, this.bloom + d.bloomPerShot);
    const kick = recoilKick(d.recoil, this.shotIndex, this.spraySeed);
    const scale = recoilScale({ adsBlend: this.adsBlend, crouched: player.crouching && player.grounded });
    this.recoil.pitch = Math.min(MAX_RECOIL_PITCH, this.recoil.pitch + kick.pitch * DEG * scale);
    this.recoil.yaw += kick.yaw * DEG * scale;
    this.shotIndex++;
    if (d.fireMode === 'pump' || d.fireMode === 'bolt') this.cycleTimer = CYCLE_DELAY;
    this.bus.emit('weapon:fired', { weaponId: d.id, ads: this.adsBlend > 0.5 });
  }

  private resolveRay(dir: THREE.Vector3, isPellet: boolean): void {
    const d = this.def;
    const maxDist = d.range * 1.5;
    const hit = this.physics.raycast(this.eye, dir, maxDist, Layer.WORLD | Layer.HITBOX);
    const to = hit
      ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z)
      : this.eye.clone().addScaledVector(dir, maxDist);
    const target = hit ? this.registry.lookup(hit.collider.handle) : undefined;

    if (hit && target) {
      if (target.owner.alive) {
        const dmg = computeDamage(damageAtDistance(d, hit.distance), target.part, d.headshotMult);
        const killed = target.owner.applyDamage(dmg, target.part);
        this.bus.emit('combat:hit', { targetId: target.owner.id, part: target.part, damage: dmg, killed, point: to });
        if (killed) {
          this.bus.emit('combat:kill', {
            attacker: 'You',
            victim: target.owner.name,
            weapon: d.name,
            headshot: target.part === 'head',
          });
        }
      }
    } else if (hit && (!isPellet || Math.random() < 0.5)) {
      this.bus.emit('combat:impact', {
        point: to,
        normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
        surface: this.surfaces.get(hit.collider.handle),
      });
    }
    this.traces.push({ from: this.eye.clone(), to });
  }
}
