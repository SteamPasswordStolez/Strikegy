import * as THREE from 'three';
import { EventBus } from './EventBus';
import type { DamageCause, GameEvents } from './events';
import { FixedStepLoop } from './FixedStepLoop';
import { QUALITY_ORDER, isTouchDevice, loadSettings, resolveQuality, saveSettings, type Settings } from './Settings';
import { setLocale, t, type MessageKey } from '@/i18n';
import { Renderer } from '@/render/Renderer';
import { Atmosphere } from '@/render/visualProfiles';
import { SURFACE_KINDS, SurfaceLibrary } from '@/render/textures';
import { ModelLibrary } from '@/render/models';
import { Effects } from '@/render/Effects';
import { Layer, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SurfaceRegistry } from '@/physics/surfaces';
import { fetchMap } from '@/world/validateMap';
import { buildBlockout } from '@/world/buildBlockout';
import { BACKDROP_MODELS, buildBackdrop } from '@/world/backdrop';
import { placeProps } from '@/world/placeProps';
import type { MapDef, SpawnPoint } from '@/world/mapTypes';
import { consumePulses, createInputState, resetFrameInput, type InputSource } from '@/input/InputState';
import { KeyboardMouse } from '@/input/KeyboardMouse';
import { TouchControls } from '@/input/Touch';
import { Player } from '@/player/Player';
import { fallDamage } from '@/player/health';
import { HitboxRegistry } from '@/combat/Hitboxes';
import { TargetDummy } from '@/combat/TargetDummy';
import { GRENADES, flashDuration, flashIntensity, fragDamage, type GrenadeType } from '@/combat/explosions';
import { DRAW_TIME, WeaponController } from '@/weapons/WeaponController';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import { ViewModel } from '@/weapons/ViewModel';
import { GrenadeInventory, Throwables } from '@/weapons/Throwables';
import { AudioSystem } from '@/audio/AudioSystem';
import { HUD } from '@/ui/HUD';
import { Overlay } from '@/ui/Overlay';

const DEG = Math.PI / 180;
/** FOV that the weapon adsFov values were authored against. */
const AUTHORED_FOV = 78;
const SIM_HZ = 60;
const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;
const RESPAWN_SEC = 4;
/** Weapon is unusable this long after starting a throw. */
const THROW_BLOCK = 0.55;
const THROW_COOLDOWN = 0.8;

export interface GameOptions {
  mapUrl: string;
  loadout: WeaponId[];
  /** glTF models the viewmodel may use (loaded up front). */
  viewModels?: string[];
}

export class Game {
  readonly bus = new EventBus<GameEvents>();
  readonly settings: Settings;
  private readonly renderer: Renderer;
  private readonly loop = new FixedStepLoop(1 / SIM_HZ);
  private readonly input = createInputState();
  private readonly sources: InputSource[] = [];
  private readonly kbm: KeyboardMouse;
  private readonly touch: TouchControls | null = null;
  private readonly registry = new HitboxRegistry();
  private readonly impacts = new SurfaceRegistry();
  private readonly hud: HUD;
  private readonly overlay: Overlay;
  private readonly audio: AudioSystem;
  private readonly viewModel: ViewModel;
  private readonly models = new ModelLibrary(ASSET_BASE);
  private readonly grenades = new GrenadeInventory();
  private readonly targets: TargetDummy[] = [];
  private readonly tmpEye = new THREE.Vector3();
  private readonly tmpMuzzle = new THREE.Vector3();
  private readonly tmpFwd = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private surfaces!: SurfaceLibrary;
  private effects!: Effects;
  private throwables!: Throwables;
  private physics!: PhysicsWorld;
  private atmosphere!: Atmosphere;
  private player!: Player;
  private weapons!: WeaponController;
  private spawn!: SpawnPoint;
  private elapsed = 0;
  private running = false;
  private started = false;
  private lastTime = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private rafId = 0;
  private respawnTimer = 0;
  private throwBlock = 0;
  private throwCooldown = 0;
  private flashLeft = 0;
  private flashTotal = 0;
  private flashPeak = 0;
  /** Camera shake amplitude in radians. */
  private shake = 0;
  private deathBlend = 0;

  private constructor(
    private readonly container: HTMLElement,
    private readonly options: GameOptions,
  ) {
    this.settings = loadSettings();
    setLocale(this.settings.locale);
    const quality = resolveQuality(this.settings.quality);
    this.renderer = new Renderer(container, quality, this.settings.fov);
    this.hud = new HUD(container);
    this.overlay = new Overlay(container);
    this.audio = new AudioSystem(this.settings.masterVolume);
    this.viewModel = new ViewModel(this.renderer.fpScene, this.models);

    this.kbm = new KeyboardMouse(
      this.renderer.canvas,
      () => this.settings.sensitivity,
      () => this.settings.invertY,
    );
    this.sources.push(this.kbm);
    if (isTouchDevice()) {
      container.classList.add('is-touch');
      this.touch = new TouchControls(container, () => this.settings.sensitivity);
      this.touch.setVisible(false);
      this.sources.push(this.touch);
    }
  }

  static async create(container: HTMLElement, options: GameOptions): Promise<Game> {
    const game = new Game(container, options);
    game.overlay.show(t('title'), t('loading'));
    await game.init();
    return game;
  }

  private async init(): Promise<void> {
    let map: MapDef;
    const r = this.renderer;
    const q = r.quality;
    this.surfaces = new SurfaceLibrary(q.textureSize, r.maxAnisotropy);
    // Art loads in parallel with physics/map; any asset that fails falls back gracefully.
    const art = Promise.all([
      this.surfaces.preload(SURFACE_KINDS, ASSET_BASE),
      this.audio.preload(`${ASSET_BASE}sounds/`),
      this.models.load(this.options.viewModels ?? []),
    ]);
    try {
      [this.physics, map] = await Promise.all([PhysicsWorld.create(), fetchMap(this.options.mapUrl)]);
    } catch (err) {
      this.overlay.show(t('error.map'), String(err instanceof Error ? err.message : err));
      throw err;
    }
    const outdoor = map.world.visualProfile !== 'indoor';
    await Promise.all([art, this.models.load([...(map.props ?? []).map((p) => p.model), ...(outdoor ? BACKDROP_MODELS : [])])]);
    this.physics.timestep = 1 / SIM_HZ;
    this.atmosphere = new Atmosphere(r.scene, r.fpScene, r.gl, map.world.visualProfile, {
      shadows: q.shadows,
      shadowMapSize: q.shadowMapSize,
      shadowExtent: q.shadowExtent,
    });
    const t0 = performance.now();
    buildBlockout(map, r.scene, this.physics, this.surfaces, this.impacts);
    placeProps(map, r.scene, this.physics, this.models, this.impacts);
    if (outdoor) buildBackdrop(r.scene, map.world.size, { lowDetail: q.backdropDetail === 'low', gl: r.gl, models: this.models, msaa: q.msaa });
    if (import.meta.env.DEV) console.info(`[strikegy] world built in ${Math.round(performance.now() - t0)} ms`);

    this.effects = new Effects(r.scene, this.physics, q.dynamicLights);
    this.throwables = new Throwables(r.scene, this.physics, this.bus);
    this.spawn = map.spawns.find((s) => s.team === 'player') ?? map.spawns[0]!;
    this.player = new Player(this.physics, this.bus, this.impacts, new THREE.Vector3(...this.spawn.pos), this.spawn.yaw * DEG);

    for (const tg of map.targets ?? []) {
      this.targets.push(
        new TargetDummy(r.scene, this.physics, this.registry, new THREE.Vector3(...tg.pos), (tg.yaw ?? 0) * DEG),
      );
    }

    this.weapons = new WeaponController(this.options.loadout, this.physics, this.registry, this.impacts, this.bus);
    this.wireEvents();

    this.warmup();

    // Settle the physics broadphase so the first raycasts see static geometry.
    this.physics.step();

    const touch = !!this.touch;
    this.overlay.show(t('title'), touch ? t('start.tap') : t('start.click'), touch ? '' : t('start.hint'));
    this.overlay.root.addEventListener('click', () => this.resume());
    document.addEventListener('pointerlockchange', () => {
      if (!this.kbm.locked && !this.touch) this.pause();
    });
    // GPU resets (driver timeout, device removed) lose the WebGL context; recover by reloading.
    r.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.running = false;
      this.overlay.show(t('error.gpu'), t('error.gpuReload'));
      this.overlay.root.addEventListener('click', () => location.reload(), { once: true });
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.settings.showFps = !this.settings.showFps;
      }
      // F4: cycle quality preset (applied by reloading, since it rebuilds the renderer).
      if (e.code === 'F4') {
        e.preventDefault();
        const i = QUALITY_ORDER.indexOf(this.renderer.preset);
        this.settings.quality = QUALITY_ORDER[(i + 1) % QUALITY_ORDER.length]!;
        saveSettings(this.settings);
        location.reload();
      }
    });

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  /**
   * Renders every weapon, grenade and effect once behind the loading overlay so
   * all shader programs (including shadow depth variants) are compiled up front.
   * Otherwise the first shot, throw or weapon switch stalls the frame.
   */
  private warmup(): void {
    const r = this.renderer;
    const cam = r.camera;
    this.player.eyePosition(1, 0, this.tmpEye);
    cam.position.copy(this.tmpEye);
    cam.rotation.set(0, this.player.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.atmosphere.update(cam.position, 0);

    const temp = this.throwables.warmupMeshes();
    temp.forEach((m, i) => {
      m.position.copy(cam.position).addScaledVector(fwd, 2).setX(m.position.x + i * 0.2);
      r.scene.add(m);
    });
    this.effects.warmup(cam.position, fwd);
    for (const id of this.options.loadout) {
      this.viewModel.setWeapon(WEAPONS[id]);
      this.viewModel.onFire(false);
      this.viewModel.update({
        dt: 0.016,
        adsBlend: 0,
        speed: 0,
        grounded: true,
        sprinting: false,
        lookDYaw: 0,
        lookDPitch: 0,
        reloading: false,
        reloadProgress: 0,
        magReload: true,
        drawProgress: 1,
        hideForScope: false,
      });
      r.render();
    }
    r.render();
    for (const m of temp) r.scene.remove(m);
    this.effects.update(0.1);
  }

  private wireEvents(): void {
    const bus = this.bus;
    const cls = (id: string) => WEAPONS[id as WeaponId].class;
    bus.on('weapon:fired', (e) => {
      this.audio.gunshot(cls(e.weaponId), e.ads);
      this.viewModel.onFire(e.ads);
      this.muzzleEffects(e.weaponId, true);
    });
    bus.on('weapon:cycle', (e) => {
      this.audio.cycle(cls(e.weaponId));
      this.viewModel.onCycle();
      this.muzzleEffects(e.weaponId, false);
    });
    bus.on('weapon:reloadCue', (e) => this.audio.reloadCue(e.cue));
    bus.on('weapon:switched', () => this.audio.switchWeapon());
    bus.on('weapon:dryFire', () => this.audio.click());
    bus.on('combat:impact', (e) => {
      this.effects.impact(e.point, e.normal, e.surface);
      this.audio.impact(e.point, e.surface);
    });
    bus.on('combat:hit', (e) => {
      this.hud.showHit(e.part === 'head', e.killed);
      this.audio.hit(e.part === 'head', e.killed);
      this.effects.targetHit(e.point);
    });
    bus.on('combat:kill', (e) => this.hud.addKill(e));
    bus.on('grenade:thrown', () => {
      this.audio.pinAndThrow();
      this.viewModel.onThrow();
    });
    bus.on('grenade:bounce', (e) => this.audio.grenadeBounce(e.point, e.speed));
    bus.on('grenade:detonate', (e) => this.detonate(e.type, e.point));
    bus.on('player:footstep', (e) => this.audio.footstep(e.surface, e.sprinting));
    bus.on('player:landed', (e) => {
      this.audio.land();
      this.viewModel.onLand(e.impactSpeed);
      this.shake = Math.min(0.03, this.shake + e.impactSpeed * 0.0008);
      const dmg = fallDamage(e.impactSpeed);
      if (dmg > 0) this.damagePlayer(dmg, null, 'fall');
    });
  }

  /** Muzzle flash on a shot; casing ejection on shot (or on cycle for pump/bolt guns). */
  private muzzleEffects(weaponId: string, shot: boolean): void {
    const def = WEAPONS[weaponId as WeaponId];
    const manual = def.fireMode === 'pump' || def.fireMode === 'bolt';
    const cam = this.renderer.camera;
    this.tmpFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    if (shot) {
      this.viewModel.muzzleWorld(cam, this.tmpMuzzle);
      this.effects.muzzleFlash(this.tmpMuzzle, this.tmpFwd);
    }
    if (shot === manual) return;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    this.tmpUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const port = cam.position.clone().addScaledVector(this.tmpFwd, 0.35).addScaledVector(right, 0.12).addScaledVector(this.tmpUp, -0.1);
    this.effects.ejectCasing(port, right, this.tmpUp, this.player.velocity, def.class);
  }

  private resume(): void {
    this.audio.unlock();
    if (this.touch) {
      this.touch.setVisible(true);
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      this.kbm.requestLock();
    }
    this.running = true;
    this.started = true;
    this.loop.reset();
    this.overlay.hide();
  }

  private pause(): void {
    if (!this.started) return;
    this.running = false;
    this.overlay.show(t('paused'), t('start.click'), t('start.hint'));
  }

  private frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.elapsed += dt;
    this.countFps(dt);

    const input = this.input;
    resetFrameInput(input);
    for (const s of this.sources) s.apply(input);

    const w = this.weapons;
    const p = this.player;
    let lookYaw = 0;
    let lookPitch = 0;
    const simDt = this.running ? dt : 0;
    if (this.running) {
      const def = w.def;
      const adsFov = def.adsFov * (this.settings.fov / AUTHORED_FOV);
      const adsScale = this.settings.adsSensitivity * (adsFov / this.settings.fov);
      const sens = 1 + (adsScale - 1) * w.adsBlend;
      if (p.alive) {
        lookYaw = input.lookYaw * sens;
        lookPitch = input.lookPitch * sens;
        p.applyLook(lookYaw, lookPitch);
      }
      const alpha = this.loop.advance(dt, (h) => this.simStep(h));
      this.renderer.adaptResolution(dt * 1000, dt);
      this.updateCamera(alpha, dt, adsFov);
    }
    input.lookYaw = 0;
    input.lookPitch = 0;

    for (const tg of this.targets) tg.update(simDt);
    this.throwables.sync();
    this.updateViewModel(dt, lookYaw, lookPitch);
    this.viewModel.muzzleWorld(this.renderer.camera, this.tmpMuzzle);
    this.effects.spawnShots(w.traces, this.tmpMuzzle);
    this.effects.update(simDt);
    this.flashLeft = Math.max(0, this.flashLeft - simDt);
    this.audio.updateVitals(p.health.value, p.alive);
    this.updateHud(dt);
    this.renderer.render();
  };

  private simStep(dt: number): void {
    const input = this.input;
    const p = this.player;
    this.throwBlock = Math.max(0, this.throwBlock - dt);
    this.throwCooldown = Math.max(0, this.throwCooldown - dt);

    // A click released before this step still counts as one trigger pull.
    if (input.firePressed) input.fire = true;
    if (p.alive) {
      if (input.cycleGrenade) this.grenades.cycle();
      if (input.throwGrenade && this.throwCooldown === 0 && !p.sprinting) this.throwGrenade();
      const firing = input.fire;
      // Pulling the trigger or aiming ends a sprint immediately.
      if (input.fire || input.ads) {
        input.sprint = false;
        p.sprinting = false;
      }
      this.weapons.step(dt, input, p, this.throwBlock > 0);
      p.step(dt, input, this.weapons.adsBlend > 0.5, firing && this.weapons.sinceShot < 0.2);
    } else {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn();
    }
    this.throwables.step(dt);
    this.physics.step();
    consumePulses(input);
  }

  private throwGrenade(): void {
    const type = this.grenades.take();
    if (!type) return;
    const { eye, fwd, right, up } = this.weapons.aimBasis(this.player);
    const origin = eye.clone().addScaledVector(fwd, 0.45).addScaledVector(right, -0.15).addScaledVector(up, -0.05);
    this.throwables.throw(type, origin, fwd.clone(), this.player.velocity.clone());
    this.throwBlock = THROW_BLOCK;
    this.throwCooldown = THROW_COOLDOWN;
    this.bus.emit('grenade:thrown', { type, remaining: this.grenades.counts[type] });
  }

  /** True if world geometry blocks the straight line between two points. */
  private occluded(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.05) return false;
    const hit = this.physics.raycast(from, dir.normalize(), dist - 0.1, Layer.WORLD);
    return !!hit;
  }

  private detonate(type: GrenadeType, point: THREE.Vector3): void {
    const spec = GRENADES[type];
    const cam = this.renderer.camera;
    const listenerDist = cam.position.distanceTo(point);
    const probe = point.clone().setY(point.y + 0.25);
    if (type === 'frag') {
      this.effects.explosion(point);
      this.audio.explosion(point, listenerDist);
      this.shake = Math.min(0.06, this.shake + Math.max(0, 0.06 - listenerDist * 0.003));
      for (const tg of this.targets) {
        if (!tg.alive) continue;
        const c = tg.center;
        const dmg = fragDamage(spec, c.distanceTo(point), this.occluded(probe, c));
        if (dmg <= 0) continue;
        const killed = tg.applyDamage(dmg, 'body');
        this.bus.emit('combat:hit', { targetId: tg.id, part: 'body', damage: dmg, killed, point: c });
        if (killed) this.bus.emit('combat:kill', { attacker: 'You', victim: tg.name, weapon: t('grenade.frag'), headshot: false });
      }
      const chest = this.player.feet.clone().setY(this.player.feet.y + 1.1);
      const dmg = fragDamage(spec, chest.distanceTo(point), this.occluded(probe, chest));
      if (dmg > 0) this.damagePlayer(dmg, point, 'explosion');
    } else if (type === 'flash') {
      this.effects.flashbang(point);
      this.audio.flashbang(point);
      const toFlash = point.clone().sub(cam.position);
      const dist = toFlash.length();
      const facing = this.tmpFwd.set(0, 0, -1).applyQuaternion(cam.quaternion).dot(toFlash.normalize());
      const intensity = flashIntensity(spec, dist, facing, this.occluded(probe, cam.position));
      if (intensity > 0 && this.player.alive) {
        const duration = flashDuration(intensity);
        this.flashLeft = this.flashTotal = duration;
        this.flashPeak = intensity;
        this.audio.deafen(intensity, duration);
        this.bus.emit('player:flashed', { intensity, duration });
      }
    } else {
      this.effects.smoke(point, spec.duration ?? 20, spec.radius);
      this.audio.smokePop(point, spec.duration ?? 20);
    }
  }

  private damagePlayer(amount: number, from: THREE.Vector3 | null, cause: DamageCause): void {
    const p = this.player;
    if (!p.alive) return;
    const killed = p.health.damage(amount);
    this.bus.emit('player:damaged', { amount, from, cause });
    let yaw: number | null = null;
    if (from) {
      const d = from.clone().sub(p.feet);
      yaw = Math.atan2(-d.x, -d.z);
    }
    this.hud.showDamage(yaw, amount);
    this.audio.hurt(amount);
    this.shake = Math.min(0.05, this.shake + amount * 0.0004);
    if (killed) this.die(cause);
  }

  private die(cause: DamageCause): void {
    this.respawnTimer = RESPAWN_SEC;
    this.weapons.adsBlend = 0;
    this.bus.emit('player:died', { cause });
    const weapon = cause === 'explosion' ? t('grenade.frag') : cause === 'fall' ? '↓' : '';
    this.hud.addKill({ attacker: 'You', victim: 'You', weapon, headshot: false });
  }

  private respawn(): void {
    const p = this.player;
    p.health.reset();
    p.teleport(new THREE.Vector3(...this.spawn.pos), this.spawn.yaw * DEG);
    this.weapons.resetAmmo();
    this.grenades.reset();
    this.hud.clearDamage();
    this.flashLeft = 0;
    this.bus.emit('player:respawned', {});
  }

  private updateCamera(alpha: number, dt: number, adsFov: number): void {
    const cam = this.renderer.camera;
    const p = this.player;
    const w = this.weapons;
    p.eyePosition(alpha, dt, this.tmpEye);
    // Death cam: slump to the ground and roll.
    this.deathBlend += ((p.alive ? 0 : 1) - this.deathBlend) * (1 - Math.exp(-4 * dt));
    this.tmpEye.y -= this.deathBlend * (p.eyeHeight - 0.35);
    cam.position.copy(this.tmpEye);

    this.shake *= Math.exp(-7 * dt);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    // Scoped rifles sway slightly with breathing.
    const breathe = w.def.scope ? w.adsBlend : 0;
    const bx = Math.sin(this.elapsed * 1.1) * 0.0022 * breathe;
    const by = Math.cos(this.elapsed * 0.7) * 0.0016 * breathe;
    cam.rotation.set(p.pitch + w.recoil.pitch + sx + bx, p.yaw + w.recoil.yaw + sy + by, this.deathBlend * 0.7, 'YXZ');
    const fov = this.settings.fov + (adsFov - this.settings.fov) * w.adsBlend;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    this.atmosphere.update(cam.position, this.elapsed);
    this.tmpFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.tmpUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.audio.setListener(cam.position, this.tmpFwd, this.tmpUp);
  }

  private updateViewModel(dt: number, lookYaw: number, lookPitch: number): void {
    const w = this.weapons;
    const p = this.player;
    this.viewModel.setWeapon(w.def);
    this.viewModel.update({
      dt,
      adsBlend: w.adsBlend,
      speed: p.horizontalSpeed(),
      grounded: p.grounded,
      sprinting: p.sprinting,
      lookDYaw: lookYaw,
      lookDPitch: lookPitch,
      reloading: w.state.reloading,
      reloadProgress: w.state.reloadProgress,
      magReload: w.def.reloadStyle === 'mag',
      drawProgress: p.alive ? 1 - w.drawTimer / DRAW_TIME : 0,
      hideForScope: !!w.def.scope && w.adsBlend > 0.95,
    });
  }

  private updateHud(dt: number): void {
    const w = this.weapons;
    const s = w.state;
    const cam = this.renderer.camera;
    const spreadRad = w.spread(this.player) * DEG;
    const halfH = window.innerHeight / 2;
    const gap = (Math.tan(spreadRad) / Math.tan((cam.fov * DEG) / 2)) * halfH;
    const pf = this.player.feet;
    // Flash: full white-out for the first half, then fade.
    const flash = this.flashTotal > 0 ? Math.min(1, this.flashLeft / (this.flashTotal * 0.5)) * this.flashPeak : 0;
    const sel = this.grenades.selected;
    this.hud.update(
      {
        weaponName: w.def.name,
        ammo: s.ammo,
        magSize: w.def.magSize,
        reserve: s.reserve,
        reloading: s.reloading,
        reloadProgress: s.reloadProgress,
        health: this.player.health.value,
        crosshairGap: Math.max(4, gap),
        adsBlend: w.adsBlend,
        scoped: !!w.def.scope,
        grenadeLabel: t(`grenade.${sel}` as MessageKey),
        grenadeCount: this.grenades.counts[sel],
        flash,
        respawnIn: this.player.alive ? null : Math.max(0, this.respawnTimer),
        fps: this.settings.showFps ? this.fps : null,
        debug: this.settings.showFps
          ? `${this.renderer.preset.toUpperCase()} ×${this.renderer.renderScale.toFixed(1)} (F4) · ${pf.x.toFixed(1)}, ${pf.y.toFixed(1)}, ${pf.z.toFixed(1)}`
          : null,
      },
      dt,
      this.player.yaw,
    );
  }

  private countFps(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  /** Dev-only inspection handle (see main.ts). */
  get debugState() {
    return {
      running: this.running,
      feet: this.player.feet.toArray(),
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      grounded: this.player.grounded,
      health: this.player.health.value,
      weapon: this.weapons.def.id,
      ammo: this.weapons.state.ammo,
      grenades: { ...this.grenades.counts },
      fps: this.fps,
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    for (const s of this.sources) s.dispose();
    this.bus.clear();
    this.renderer.dispose();
    this.physics.dispose();
    this.container.replaceChildren();
  }
}
