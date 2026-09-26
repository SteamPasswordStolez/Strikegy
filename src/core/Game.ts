import * as THREE from 'three';
import { EventBus } from './EventBus';
import type { GameEvents } from './events';
import { FixedStepLoop } from './FixedStepLoop';
import { isTouchDevice, loadSettings, resolveQuality, type Settings } from './Settings';
import { setLocale, t } from '@/i18n';
import { Renderer } from '@/render/Renderer';
import { applyVisualProfile } from '@/render/visualProfiles';
import { Effects } from '@/render/Effects';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { fetchMap } from '@/world/validateMap';
import { buildBlockout } from '@/world/buildBlockout';
import type { MapDef } from '@/world/mapTypes';
import { consumePulses, createInputState, resetFrameInput, type InputSource } from '@/input/InputState';
import { KeyboardMouse } from '@/input/KeyboardMouse';
import { TouchControls } from '@/input/Touch';
import { Player } from '@/player/Player';
import { HitboxRegistry } from '@/combat/Hitboxes';
import { TargetDummy } from '@/combat/TargetDummy';
import { WeaponController } from '@/weapons/WeaponController';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import { ViewModel } from '@/weapons/ViewModel';
import { AudioSystem } from '@/audio/AudioSystem';
import { HUD } from '@/ui/HUD';
import { Overlay } from '@/ui/Overlay';

const DEG = Math.PI / 180;
/** FOV that the weapon adsFov values were authored against. */
const AUTHORED_FOV = 78;
const SIM_HZ = 60;

export interface GameOptions {
  mapUrl: string;
  loadout: WeaponId[];
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
  private readonly hud: HUD;
  private readonly overlay: Overlay;
  private readonly audio: AudioSystem;
  private readonly effects: Effects;
  private readonly viewModel: ViewModel;
  private readonly targets: TargetDummy[] = [];
  private readonly tmpEye = new THREE.Vector3();
  private readonly tmpMuzzle = new THREE.Vector3();
  private physics!: PhysicsWorld;
  private player!: Player;
  private weapons!: WeaponController;
  private running = false;
  private started = false;
  private lastTime = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private rafId = 0;

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
    this.effects = new Effects(this.renderer.scene);
    this.viewModel = new ViewModel(this.renderer.fpScene);

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
    try {
      [this.physics, map] = await Promise.all([PhysicsWorld.create(), fetchMap(this.options.mapUrl)]);
    } catch (err) {
      this.overlay.show(t('error.map'), String(err instanceof Error ? err.message : err));
      throw err;
    }
    this.physics.timestep = 1 / SIM_HZ;
    const r = this.renderer;
    applyVisualProfile(r.scene, r.gl, map.world.visualProfile, map.world.size, r.quality.shadowMapSize);
    buildBlockout(map, r.scene, this.physics, r.maxAnisotropy);

    const spawn = map.spawns.find((s) => s.team === 'player') ?? map.spawns[0]!;
    this.player = new Player(this.physics, this.bus, new THREE.Vector3(...spawn.pos), spawn.yaw * DEG);

    for (const tg of map.targets ?? []) {
      this.targets.push(
        new TargetDummy(r.scene, this.physics, this.registry, new THREE.Vector3(...tg.pos), (tg.yaw ?? 0) * DEG),
      );
    }

    this.weapons = new WeaponController(this.options.loadout, this.physics, this.registry, this.bus);
    this.wireEvents();

    // Settle the physics broadphase so the first raycasts see static geometry.
    this.physics.step();

    const touch = !!this.touch;
    this.overlay.show(t('title'), touch ? t('start.tap') : t('start.click'), touch ? '' : t('start.hint'));
    this.overlay.root.addEventListener('click', () => this.resume());
    document.addEventListener('pointerlockchange', () => {
      if (!this.kbm.locked && !this.touch) this.pause();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.settings.showFps = !this.settings.showFps;
      }
    });

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  private wireEvents(): void {
    this.bus.on('weapon:fired', (e) => {
      this.audio.gunshot(WEAPONS[e.weaponId as WeaponId].class, e.ads);
      this.viewModel.onFire(e.ads);
    });
    this.bus.on('combat:hit', (e) => {
      this.hud.showHit(e.part === 'head', e.killed);
      this.audio.hit(e.part === 'head', e.killed);
    });
    this.bus.on('weapon:dryFire', () => this.audio.click());
    this.bus.on('weapon:reloadStart', () => this.audio.reload());
    this.bus.on('player:landed', () => this.audio.land());
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
    this.countFps(dt);

    const input = this.input;
    resetFrameInput(input);
    for (const s of this.sources) s.apply(input);

    const w = this.weapons;
    const p = this.player;
    let lookYaw = 0;
    let lookPitch = 0;
    if (this.running) {
      const def = w.def;
      const adsFov = def.adsFov * (this.settings.fov / AUTHORED_FOV);
      const adsScale = this.settings.adsSensitivity * (adsFov / this.settings.fov);
      const sens = 1 + (adsScale - 1) * w.adsBlend;
      lookYaw = input.lookYaw * sens;
      lookPitch = input.lookPitch * sens;
      p.applyLook(lookYaw, lookPitch);

      const alpha = this.loop.advance(dt, (h) => this.simStep(h));
      this.updateCamera(alpha, dt, adsFov);
    }
    input.lookYaw = 0;
    input.lookPitch = 0;

    for (const tg of this.targets) tg.update(this.running ? dt : 0);
    this.updateViewModel(dt, lookYaw, lookPitch);
    this.viewModel.muzzleWorld(this.renderer.camera, this.tmpMuzzle);
    this.effects.spawnShots(w.traces, this.tmpMuzzle);
    this.effects.update(dt);
    this.updateHud(dt);
    this.renderer.render();
  };

  private simStep(dt: number): void {
    const firing = this.input.fire;
    this.weapons.step(dt, this.input, this.player);
    this.player.step(dt, this.input, this.weapons.adsBlend > 0.5, firing && this.weapons.sinceShot < 0.2);
    this.physics.step();
    consumePulses(this.input);
  }

  private updateCamera(alpha: number, dt: number, adsFov: number): void {
    const cam = this.renderer.camera;
    const p = this.player;
    const w = this.weapons;
    this.player.eyePosition(alpha, dt, this.tmpEye);
    cam.position.copy(this.tmpEye);
    cam.rotation.set(p.pitch + w.recoil.pitch, p.yaw + w.recoil.yaw, 0, 'YXZ');
    const fov = this.settings.fov + (adsFov - this.settings.fov) * w.adsBlend;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
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
      drawProgress: 1 - w.drawTimer / 0.35,
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
    this.hud.update(
      {
        weaponName: w.def.name,
        ammo: s.ammo,
        magSize: w.def.magSize,
        reserve: s.reserve,
        reloading: s.reloading,
        reloadProgress: s.reloadProgress,
        health: this.player.health,
        crosshairGap: Math.max(4, gap),
        adsBlend: w.adsBlend,
        scoped: !!w.def.scope,
        fps: this.settings.showFps ? this.fps : null,
        debug: this.settings.showFps
          ? `${pf.x.toFixed(1)}, ${pf.y.toFixed(1)}, ${pf.z.toFixed(1)} · ${this.player.horizontalSpeed().toFixed(1)} m/s`
          : null,
      },
      dt,
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
      weapon: this.weapons.def.id,
      ammo: this.weapons.state.ammo,
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
