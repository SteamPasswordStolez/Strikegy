import * as THREE from 'three';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { GameBus } from '@/core/events';
import type { InputState } from '@/input/InputState';
import { computeDamage, type HitboxRegistry } from '@/combat/Hitboxes';
import { MOVE } from '@/player/movement';
import type { Player } from '@/player/Player';
import { WeaponState } from './WeaponState';
import { WEAPONS, damageAtDistance, type WeaponDef, type WeaponId } from './weaponData';

const DEG = Math.PI / 180;
const DRAW_TIME = 0.35;
const BLOOM_PER_SHOT = 0.35;
const BLOOM_MAX = 4;
const BLOOM_DECAY = 7;
const RECOIL_RECOVERY = 7;
const MAX_RECOIL_PITCH = 12 * DEG;

export interface ShotTrace {
  from: THREE.Vector3;
  to: THREE.Vector3;
  normal: THREE.Vector3 | null;
  hitWorld: boolean;
}

/**
 * Player-side weapon handling: loadout switching, ADS, spread/bloom, recoil
 * and hitscan resolution. Runs on the fixed simulation step.
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
  /** Shots resolved since the render side last drained them (tracers/decals). */
  readonly traces: ShotTrace[] = [];

  private readonly eye = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    loadout: WeaponId[],
    private readonly physics: PhysicsWorld,
    private readonly registry: HitboxRegistry,
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

  /** Current total spread half-angle in degrees. */
  spread(player: Player): number {
    const d = this.def;
    const base = d.spreadHip + (d.spreadAds - d.spreadHip) * this.adsBlend;
    const move = Math.min(1, player.horizontalSpeed() / MOVE.walkSpeed) * 1.6 * (1 - 0.75 * this.adsBlend);
    const air = player.grounded ? 0 : 3;
    return base + this.bloom * (1 - 0.5 * this.adsBlend) + move + air;
  }

  step(dt: number, input: InputState, player: Player): void {
    this.handleSwitch(input);

    const s = this.state;
    const d = this.def;
    this.drawTimer = Math.max(0, this.drawTimer - dt);
    const canAim = !player.sprinting && this.drawTimer === 0;
    const wantAds = input.ads && canAim && !(s.reloading && d.reloadStyle === 'mag');
    const adsRate = dt / d.adsTime;
    this.adsBlend = THREE.MathUtils.clamp(this.adsBlend + (wantAds ? adsRate : -adsRate), 0, 1);

    const canFire = this.drawTimer === 0 && !player.sprinting;
    const res = s.step(dt, { trigger: input.fire && canFire, reload: input.reload });
    if (res.reloadStarted) this.bus.emit('weapon:reloadStart', { weaponId: d.id });
    if (res.reloadFinished) this.bus.emit('weapon:reloadEnd', { weaponId: d.id });
    if (res.dryFire) this.bus.emit('weapon:dryFire', { weaponId: d.id });

    for (let i = 0; i < res.shots; i++) this.fire(player);

    this.sinceShot += dt;
    this.bloom = Math.max(0, this.bloom - BLOOM_DECAY * dt * (this.sinceShot > 0.08 ? 1 : 0.2));
    if (this.sinceShot > 0.12) {
      const k = Math.exp(-RECOIL_RECOVERY * dt);
      this.recoil.pitch *= k;
      this.recoil.yaw *= k;
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
  }

  private fire(player: Player): void {
    const d = this.def;
    this.sinceShot = 0;

    this.eye.copy(player.feet);
    this.eye.y += player.eyeHeight;
    this.euler.set(player.pitch + this.recoil.pitch, player.yaw + this.recoil.yaw, 0);
    this.fwd.set(0, 0, -1).applyEuler(this.euler);
    this.right.set(1, 0, 0).applyEuler(this.euler);
    this.up.set(0, 1, 0).applyEuler(this.euler);

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
      this.resolveRay(dir);
    }

    this.bloom = Math.min(BLOOM_MAX, this.bloom + BLOOM_PER_SHOT);
    const adsDamp = 1 - 0.35 * this.adsBlend;
    this.recoil.pitch = Math.min(MAX_RECOIL_PITCH, this.recoil.pitch + d.recoil.up * DEG * adsDamp);
    this.recoil.yaw += (Math.random() - 0.5) * 2 * d.recoil.side * DEG * adsDamp;
    this.bus.emit('weapon:fired', { weaponId: d.id, ads: this.adsBlend > 0.5 });
  }

  private resolveRay(dir: THREE.Vector3): void {
    const d = this.def;
    const maxDist = d.range * 1.5;
    const hit = this.physics.raycast(this.eye, dir, maxDist, Layer.WORLD | Layer.HITBOX);
    const to = hit
      ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z)
      : this.eye.clone().addScaledVector(dir, maxDist);
    const target = hit ? this.registry.lookup(hit.collider.handle) : undefined;

    if (hit && target && target.owner.alive) {
      const dmg = computeDamage(damageAtDistance(d, hit.distance), target.part, d.headshotMult);
      const killed = target.owner.applyDamage(dmg, target.part);
      this.bus.emit('combat:hit', { targetId: target.owner.id, part: target.part, damage: dmg, killed });
    }

    this.traces.push({
      from: this.eye.clone(),
      to,
      normal: hit && !target ? new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) : null,
      hitWorld: !!hit && !target,
    });
  }
}
