import * as THREE from 'three';
import { EventBus } from './EventBus';
import type { DamageCause, GameEvents, GrenadeOwner } from './events';
import { FixedStepLoop } from './FixedStepLoop';
import { QUALITY_ORDER, gpuName, isTouchDevice, loadSettings, resolveQuality, saveSettings, type Settings } from './Settings';
import { setLocale, t, type MessageKey } from '@/i18n';
import { Renderer } from '@/render/Renderer';
import { Atmosphere } from '@/render/visualProfiles';
import { SURFACE_KINDS, SurfaceLibrary } from '@/render/textures';
import { ModelLibrary } from '@/render/models';
import { Effects } from '@/render/Effects';
import { Layer, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SurfaceRegistry } from '@/physics/surfaces';
import { fetchMap } from '@/world/validateMap';
import { buildBlockout, hasTerrain, snapToTerrain } from '@/world/buildBlockout';
import { Boundary, Terrain } from '@/world/terrain';
import { buildingPadRadius } from '@/world/buildings';
import { BACKDROP_MODELS, buildBackdrop } from '@/world/backdrop';
import { createConiferKit } from '@/world/conifers';
import { Forest } from '@/world/forest';
import { buildRivers } from '@/world/river';
import { WaterMap } from '@/world/water';
import { Snowfall } from '@/render/snowfall';
import { placeProps } from '@/world/placeProps';
import type { MapDef, SpawnPoint } from '@/world/mapTypes';
import { consumePulses, createInputState, resetFrameInput, type InputSource } from '@/input/InputState';
import { KeyboardMouse } from '@/input/KeyboardMouse';
import { TouchControls } from '@/input/Touch';
import { Player } from '@/player/Player';
import { fallDamage } from '@/player/health';
import { HitboxRegistry, type DamageSource, type Damageable } from '@/combat/Hitboxes';
import { CharacterHitboxes } from '@/combat/CharacterHitboxes';
import { NavWorld } from '@/ai/NavWorld';
import { BotManager, type BotOptions } from '@/ai/BotManager';
import { PLAYER_ID, PLAYER_TEAM, otherTeam, type Combatant } from '@/ai/types';
import { TargetDummy } from '@/combat/TargetDummy';
import { GRENADES, flashDuration, flashIntensity, fragDamage, type GrenadeType } from '@/combat/explosions';
import { DRAW_TIME, WeaponController } from '@/weapons/WeaponController';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import { ViewModel } from '@/weapons/ViewModel';
import { GrenadeInventory, Throwables } from '@/weapons/Throwables';
import { AudioSystem } from '@/audio/AudioSystem';
import { ambienceFor } from '@/audio/ambienceDirector';
import { HUD } from '@/ui/HUD';
import { PerfPanel } from '@/ui/PerfPanel';
import { Overlay } from '@/ui/Overlay';
import { ZoneMode } from '@/modes/ZoneMode';
import { ZoneRules } from '@/modes/zoneRules';
import { ZoneVisuals } from '@/modes/zoneVisuals';
import type { Side, SquadHud, ZoneHud } from '@/ui/HUD';
import { DeployScreen, type DeployOption, type DeployState } from '@/ui/DeployScreen';
import { paintMap, type MapImage } from '@/ui/mapPainter';
import { Minimap, type MinimapFrame } from '@/ui/Minimap';
import { ASSIST_CONE_DEG, applyAimAssist, type AssistTarget } from '@/input/aimAssist';
import { wrapAngle, yawPitchOf } from '@/ai/aim';
import { COMBAT_WINDOW, WIPE_PENALTY, formSquads, mateSpawnBlock, type Squad, type SquadMember } from '@/modes/squads';
import type { Bot } from '@/ai/Bot';
import { ScoreTracker } from '@/modes/scoreTracker';
import { Scoreboard, type ScoreboardSide } from '@/ui/Scoreboard';
import type { Team } from '@/world/mapTypes';

const DEG = Math.PI / 180;
/** FOV that the weapon adsFov values were authored against. */
const AUTHORED_FOV = 78;
const SIM_HZ = 60;
const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;
const RESPAWN_SEC = 4;
/** Seconds of death cam before the deploy screen opens. */
const DEATH_CAM_SEC = 1.6;
/** Maps up to this size (m) get one shadow map fitted over the whole area, rendered once. */
const STATIC_SHADOW_MAX = 420;
/** Weapon is unusable this long after starting a throw. */
const THROW_BLOCK = 0.55;
const THROW_COOLDOWN = 0.8;

export interface GameOptions {
  mapUrl: string;
  loadout: WeaponId[];
  /** glTF models the viewmodel may use (loaded up front). */
  viewModels?: string[];
  /** Bot match settings; null = practice range (targets only). */
  bots?: BotOptions | null;
  /** Game mode; 'auto' = Zone when the map has zones and there are bots. */
  mode?: 'auto' | 'zone' | 'skirmish';
  /** Zone mode ticket count per team. */
  tickets?: number;
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
  private readonly perf: PerfPanel;
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
  private playerSpawns: SpawnPoint[] = [];
  private mapSpawns: SpawnPoint[] = [];
  private mapName = '';
  private playerBoxes!: CharacterHitboxes;
  private bots: BotManager | null = null;
  private nav: NavWorld | null = null;
  private navExtra: { positions: number[]; indices: number[] } | null = null;
  private forest: Forest | null = null;
  private snowfall: Snowfall | null = null;
  /** The player as seen by bots. */
  private playerCombatant!: Combatant;
  private playerFiringUntil = -1;
  private killedBy: string | null = null;
  private zoneMode: ZoneMode | null = null;
  private zoneVisuals: ZoneVisuals | null = null;
  private matchOver = false;
  /** Bot matches use a deploy screen: the player is off the field until deploying. */
  private deployFlow = false;
  private deployed = true;
  private deployScreen: DeployScreen | null = null;
  /** Top-down picture of the map (deploy screen and minimap). */
  private mapImage: MapImage | null = null;
  private minimap: Minimap | null = null;
  private readonly minimapFrame: MinimapFrame = { x: 0, z: 0, yaw: 0, zones: [], allies: [], enemies: [] };
  private deployAt = 0;
  private deployRefresh = 0;
  /** Deploy choice: 'base', 'zone:<id>' or 'mate:<id>'. */
  private spawnKey = 'base';
  private squads: Squad[] = [];
  private readonly scores = new ScoreTracker();
  private readonly scoreboard: Scoreboard;
  private scoreboardTimer = 0;
  private playerSquad: Squad | null = null;
  private squadWiped = false;
  private playerHurtAt = -Infinity;
  private lastAlpha = 0;
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
    this.perf = new PerfPanel(container, this.renderer.gl, gpuName() || 'GPU: unknown');
    this.renderer.instrument(this.perf.section);
    this.overlay = new Overlay(container);
    this.scoreboard = new Scoreboard(container);
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
      this.touch = new TouchControls(
        container,
        () => this.settings.sensitivity,
        () => this.pause(),
      );
      this.touch.setVisible(false);
      this.sources.push(this.touch);
      const hint = document.createElement('div');
      hint.className = 'rotate-hint';
      hint.textContent = t('rotate.hint');
      container.appendChild(hint);
      // Phones: spatial audio without HRTF (it costs a convolver per voice on a weak CPU).
      this.audio.maxHrtf = 0;
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
    this.audio.setAmbience(ambienceFor(map.world.visualProfile, (map.zones?.length ?? 0) > 0, map.world.ambience));
    this.atmosphere = new Atmosphere(r.scene, r.fpScene, r.gl, map.world.visualProfile, {
      shadows: q.shadows,
      shadowMapSize: q.shadowMapSize,
      shadowExtent: q.shadowExtent,
    });
    const t0 = performance.now();
    // Load-time breakdown (dev console): where the seconds go on big maps.
    const steps: string[] = [];
    let tStep = t0;
    const lap = (name: string) => {
      const now = performance.now();
      steps.push(`${name} ${Math.round(now - tStep)}`);
      tStep = now;
    };
    // Buildings get a level pad so they sit flat on sloped ground.
    const pads = (map.buildings ?? []).map((b) => ({ pos: b.pos, radius: buildingPadRadius(b) - 1, blend: 5 }));
    const terrainDef = { ...map.world.terrain, flats: [...(map.world.terrain?.flats ?? []), ...pads] };
    const terrain = new Terrain(terrainDef, Boundary.fromMap(map), map.world.size);
    const shaped = hasTerrain(map);
    if (shaped) snapToTerrain(map, terrain);
    lap('terrain');
    const built = buildBlockout(map, r.scene, this.physics, this.surfaces, this.impacts, shaped ? terrain : null, r.preset === 'low' ? 2 : 1);
    this.navExtra = built.navExtra;
    lap('blockout');
    const props = placeProps(map, r.scene, this.physics, this.models, this.impacts);
    lap('props');
    const water = terrain.rivers.length ? new WaterMap(terrain) : null;
    if (water) r.scene.add(buildRivers(terrain, r.scene.environment));
    const winter = map.world.visualProfile === 'winter';
    if (winter) {
      this.snowfall = new Snowfall(r.preset === 'low' ? 1200 : r.preset === 'medium' ? 2500 : 4000);
      r.scene.add(this.snowfall.points);
    }
    const kit = outdoor ? createConiferKit(q.msaa, winter) : null;
    if (kit && map.trees?.length) {
      // Low quality (phones): 3D trees only close by, impostors beyond.
      this.forest = new Forest(map.trees, terrain, this.physics, this.impacts, kit, r.gl, r.scene, r.preset === 'low' ? 55 : undefined);
      r.scene.add(this.forest.group);
    }
    lap('water+forest');
    this.fitShadows(map, terrain, built.root, props);
    if (kit) buildBackdrop(r.scene, terrain, { lowDetail: q.backdropDetail === 'low', gl: r.gl, models: this.models, msaa: q.msaa, mapHasTerrain: shaped, kit, winter, phone: r.preset === 'low' });
    lap('backdrop');
    if (import.meta.env.DEV) console.info(`[strikegy] world built in ${Math.round(performance.now() - t0)} ms (${steps.join(', ')})`);

    this.effects = new Effects(r.scene, this.physics, q.dynamicLights);
    this.throwables = new Throwables(r.scene, this.physics, this.bus);
    this.spawn = map.spawns.find((s) => s.team === 'player') ?? map.spawns[0]!;
    this.player = new Player(this.physics, this.bus, this.impacts, new THREE.Vector3(...this.spawn.pos), this.spawn.yaw * DEG);
    this.player.water = water;
    this.playerSpawns = map.spawns.filter((s) => s.team === 'player' || s.team === PLAYER_TEAM);
    this.mapSpawns = map.spawns;
    this.mapName = map.meta.name;
    this.createPlayerCombatant();

    const botOpts = this.options.bots ?? null;
    if (!botOpts) {
      for (const tg of map.targets ?? []) {
        this.targets.push(
          new TargetDummy(r.scene, this.physics, this.registry, new THREE.Vector3(...tg.pos), (tg.yaw ?? 0) * DEG),
        );
      }
    }

    this.weapons = new WeaponController(this.options.loadout, this.physics, this.registry, this.impacts, this.bus);
    this.weapons.ignoreBody = this.playerBoxes.body;

    if (botOpts && botOpts.allies + botOpts.enemies > 0) {
      // Colliders must be in the broadphase before the navmesh reads them.
      this.physics.step();
      const tNav = performance.now();
      this.nav = await NavWorld.build(this.physics, this.navExtra ?? undefined);
      if (import.meta.env.DEV) console.info(`[strikegy] navmesh built in ${Math.round(performance.now() - tNav)} ms`);
      if (this.nav) {
        this.bots = new BotManager(r.scene, this.physics, this.nav, this.registry, this.impacts, this.bus, this.audio, this.effects, this.playerCombatant, map.spawns, botOpts);
        this.bots.grenades = this.throwables;
        this.bots.setTactical(built.windows, built.footprints);
        if (map.trees) this.bots.setForest(map.trees, map.world.size);
        if (water) this.bots.setWater(water);
        const bots = this.bots;
        this.weapons.onRound = (from, to, hitId, pellet) => bots.nearMiss(from, to, PLAYER_TEAM, hitId, pellet ? 0.35 : 1);
      }
    }
    this.mapImage = paintMap(map, terrain.boundary, 2048);
    this.minimap = new Minimap(this.hud.root, this.mapImage);
    const mode = this.options.mode ?? 'auto';
    if ((mode === 'zone' || (mode === 'auto' && this.bots)) && (map.zones?.length ?? 0) > 0) {
      this.setupZoneMode(map, terrain);
    }
    if (this.bots) this.setupSquads(map, terrain);
    this.wireEvents();

    // Lights are filtered by camera layers like meshes; they must light every layer
    // (world, scenery, effects) since those are drawn in separate passes.
    r.scene.traverse((o) => {
      if (o instanceof THREE.Light) o.layers.enableAll();
    });
    this.warmup();

    // Settle the physics broadphase so the first raycasts see static geometry.
    this.physics.step();

    const touch = !!this.touch;
    this.overlay.show(t('title'), touch ? t('start.tap') : t('start.click'), touch ? '' : t('start.hint'));
    this.overlay.root.addEventListener('click', () => this.resume());
    document.addEventListener('pointerlockchange', () => {
      if (!this.kbm.locked && !this.touch && !this.deployScreen?.visible) this.pause();
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
    this.forest?.update(cam.position);

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
        meleeT: -1,
        inspectT: -1,
      });
      r.render();
    }
    r.render();
    for (const m of temp) r.scene.remove(m);
    r.requestShadowUpdate();
    this.effects.update(0.1);
  }

  private wireEvents(): void {
    const bus = this.bus;
    const cls = (id: string) => WEAPONS[id as WeaponId].class;
    bus.on('weapon:fired', (e) => {
      if (this.bots) {
        this.playerFiringUntil = this.bots.time + 0.6;
        this.bots.alert(this.player.feet, 70, this.playerCombatant);
      }
      this.audio.gunshot(cls(e.weaponId), e.ads);
      this.viewModel.onFire(e.ads);
      this.muzzleEffects(e.weaponId, true);
    });
    bus.on('weapon:cycle', (e) => {
      this.audio.cycle(cls(e.weaponId));
      this.viewModel.onCycle();
      this.muzzleEffects(e.weaponId, false);
    });
    bus.on('weapon:reloadCue', (e) => this.audio.reloadCue(e.cue, cls(e.weaponId)));
    bus.on('weapon:switched', () => this.audio.switchWeapon());
    bus.on('weapon:dryFire', () => this.audio.click());
    bus.on('weapon:meleeSwing', () => this.audio.meleeSwing());
    bus.on('weapon:melee', (e) => {
      if (e.hit === 'none') return;
      this.audio.meleeHit(e.hit === 'body');
      this.viewModel.onMeleeHit();
      this.shake = Math.min(0.03, this.shake + 0.012);
      if (this.bots) this.bots.alert(this.player.feet, 20, this.playerCombatant);
    });
    bus.on('weapon:inspectCue', (e) => this.audio.inspectCue(e.cue, cls(e.weaponId)));
    bus.on('combat:impact', (e) => {
      this.effects.impact(e.point, e.normal, e.surface);
      this.audio.impact(e.point, e.surface);
    });
    bus.on('combat:hit', (e) => {
      if (e.byPlayer) {
        this.hud.showHit(e.part === 'head', e.killed);
        this.audio.hit(e.part === 'head', e.killed);
      }
      if (e.targetId !== PLAYER_ID) {
        if (this.bots) this.effects.bodyHit(e.point);
        else this.effects.targetHit(e.point);
      }
    });
    bus.on('combat:kill', (e) => this.hud.addKill(e));
    bus.on('grenade:thrown', () => {
      this.audio.pinAndThrow();
      this.viewModel.onThrow();
    });
    bus.on('grenade:bounce', (e) => this.audio.grenadeBounce(e.point, e.speed));
    bus.on('grenade:detonate', (e) => this.detonate(e.type, e.point, e.owner));
    bus.on('player:footstep', (e) => {
      this.audio.footstep(e.surface, e.sprinting);
      this.bots?.alert(e.point, e.sprinting ? 18 : 13, this.playerCombatant);
    });
    bus.on('player:landed', (e) => {
      this.audio.land(e.impactSpeed, e.surface);
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
    if (this.matchOver) return;
    this.audio.unlock();
    if (this.deployFlow && !this.deployed) {
      // Not on the field yet: the world runs behind the deploy screen.
      this.running = true;
      this.started = true;
      this.loop.reset();
      this.overlay.hide();
      this.openDeploy();
      return;
    }
    if (this.touch) {
      this.touch.setVisible(true);
      document.documentElement
        .requestFullscreen?.()
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => {});
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
    this.touch?.setVisible(false);
    this.overlay.show(t('paused'), this.touch ? t('start.tap') : t('start.click'), this.touch ? '' : t('start.hint'));
  }

  private frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const frameMs = now - this.lastTime;
    const tStart = performance.now();
    let simMs = 0;
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
        if (this.touch && this.deployed) {
          [lookYaw, lookPitch] = applyAimAssist(lookYaw, lookPitch, this.assistTarget(), { ads: w.adsBlend > 0.5, firing: input.fire, dt });
        }
        p.applyLook(lookYaw, lookPitch);
      }
      const tSim = performance.now();
      const alpha = this.loop.advance(dt, (h) => this.simStep(h));
      this.lastAlpha = alpha;
      simMs = performance.now() - tSim;
      this.renderer.adaptResolution(dt * 1000, dt);
      this.updateCamera(alpha, dt, adsFov);
    }
    input.lookYaw = 0;
    input.lookPitch = 0;

    for (const tg of this.targets) tg.update(simDt);
    this.bots?.render(this.lastAlpha, dt, this.renderer.camera.position);
    this.zoneVisuals?.update(this.elapsed, this.renderer.camera.position);
    if (this.deployScreen && this.running) {
      if (!this.deployed && !this.deployScreen.visible && this.elapsed >= this.deployAt && !this.matchOver) this.openDeploy();
      this.deployRefresh -= dt;
      if (this.deployScreen.visible && this.deployRefresh <= 0) {
        this.deployRefresh = 0.2;
        this.deployScreen.update(this.deployState());
      }
    }
    if (this.throwables.castersChanged || this.targets.some((tg) => tg.moved)) this.renderer.requestShadowUpdate();
    this.throwables.sync();
    this.updateViewModel(dt, lookYaw, lookPitch);
    this.viewModel.muzzleWorld(this.renderer.camera, this.tmpMuzzle);
    this.effects.viewer.copy(this.renderer.camera.position);
    this.effects.spawnShots(w.traces, this.tmpMuzzle);
    this.effects.update(simDt);
    this.flashLeft = Math.max(0, this.flashLeft - simDt);
    this.audio.updateVitals(p.health.value, p.alive);
    this.audio.updateAmbience(dt);
    this.updateHud(dt);
    this.updateScoreboard(dt, input.scoreboard);
    const perf = this.perf;
    perf.setVisible(this.settings.showFps);
    const tDraw = performance.now();
    if (this.renderer.render()) perf.onShadowUpdate();
    const tEnd = performance.now();
    perf.record(
      { frameMs, simMs, updateMs: tDraw - tStart - simMs, renderMs: tEnd - tDraw },
      `${this.renderer.preset.toUpperCase()} ×${this.renderer.renderScale.toFixed(2)} (F4) · ${this.renderer.canvas.width}×${this.renderer.canvas.height}`,
    );
  };

  /** The player as a bot target (Combatant) and as a damageable with hitboxes. */
  private createPlayerCombatant(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const game = this;
    this.playerCombatant = {
      id: PLAYER_ID,
      team: PLAYER_TEAM,
      get name() {
        return t('feed.you');
      },
      get alive() {
        return game.player.alive && game.deployed;
      },
      get feet() {
        return game.player.feet;
      },
      get yaw() {
        return game.player.yaw;
      },
      inCombat(now: number) {
        return game.playerFiringUntil > now - COMBAT_WINDOW || now - game.playerHurtAt < COMBAT_WINDOW;
      },
      get velocity() {
        return game.player.velocity;
      },
      get eyeHeight() {
        return game.player.eyeHeight;
      },
      get firingUntil() {
        return game.playerFiringUntil;
      },
    };
    const target: Damageable = {
      id: PLAYER_ID,
      name: 'You',
      team: PLAYER_TEAM,
      get alive() {
        return game.player.alive && game.deployed;
      },
      applyDamage: (amount, _part, source) => {
        this.damagePlayer(amount, source?.pos ?? null, 'bullet', source);
        return !this.player.alive;
      },
    };
    this.playerBoxes = new CharacterHitboxes(this.physics, this.registry, target);
    this.playerBoxes.place(this.player.feet, this.player.yaw);
  }

  /**
   * Small maps get one shadow map fitted over the whole playable area, rendered
   * only when a shadow caster moves. Larger maps keep a frustum that follows the
   * camera and re-renders periodically.
   */
  private fitShadows(map: MapDef, terrain: Terrain, ...roots: THREE.Object3D[]): void {
    const q = this.renderer.quality;
    if (!q.shadows) return;
    const [minX, minZ, maxX, maxZ] = terrain.bounds();
    if (Math.max(maxX - minX, maxZ - minZ) > STATIC_SHADOW_MAX) return;
    void map;
    const box = new THREE.Box3();
    for (const root of roots) box.expandByObject(root);
    // Only what can shadow the playable area matters: clamp to the map plus a margin.
    const limit = new THREE.Box3(new THREE.Vector3(minX - 4, -30, minZ - 4), new THREE.Vector3(maxX + 4, 60, maxZ + 4));
    box.intersect(limit);
    if (box.isEmpty()) box.copy(limit);
    this.atmosphere.fitShadowsTo(box, q.shadowMapSize);
    this.renderer.staticShadows = true;
  }

  private simStep(dt: number): void {
    const input = this.input;
    const p = this.player;
    this.throwBlock = Math.max(0, this.throwBlock - dt);
    this.throwCooldown = Math.max(0, this.throwCooldown - dt);

    // A click released before this step still counts as one trigger pull.
    if (input.firePressed) input.fire = true;
    if (p.alive && this.deployed) {
      if (input.cycleGrenade) this.grenades.cycle();
      if (input.throwGrenade && this.throwCooldown === 0 && !p.sprinting) this.throwGrenade();
      const firing = input.fire;
      // Pulling the trigger, aiming or swinging ends a sprint immediately.
      if (input.fire || input.ads || input.melee) {
        input.sprint = false;
        p.sprinting = false;
      }
      this.weapons.step(dt, input, p, this.throwBlock > 0);
      p.step(dt, input, this.weapons.adsBlend > 0.5, firing && this.weapons.sinceShot < 0.2);
    } else {
      this.respawnTimer -= dt;
      // With a deploy screen the player chooses when to go; otherwise respawn automatically.
      if (!this.deployFlow && this.respawnTimer <= 0) this.respawn();
    }
    this.playerBoxes.sync(p.feet, p.yaw, p.bodyHeight);
    this.bots?.step(dt);
    this.zoneMode?.step(dt, this.combatants());
    this.throwables.step(dt);
    this.physics.step();
    consumePulses(input);
  }

  private throwGrenade(): void {
    const type = this.grenades.take();
    if (!type) return;
    const { eye, fwd, right, up } = this.weapons.aimBasis(this.player);
    const origin = eye.clone().addScaledVector(fwd, 0.45).addScaledVector(right, -0.15).addScaledVector(up, -0.05);
    this.throwables.throw(type, origin, fwd.clone(), this.player.velocity.clone(), { id: PLAYER_ID, name: t('feed.you'), team: PLAYER_TEAM });
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

  private detonate(type: GrenadeType, point: THREE.Vector3, owner: GrenadeOwner): void {
    const spec = GRENADES[type];
    const byPlayer = owner.id === PLAYER_ID;
    const source: DamageSource = { pos: point.clone(), name: owner.name, team: owner.team, weapon: t('grenade.frag'), id: owner.id };
    const cam = this.renderer.camera;
    const listenerDist = cam.position.distanceTo(point);
    const probe = point.clone().setY(point.y + 0.25);
    if (type === 'frag') {
      this.effects.explosion(point);
      this.audio.explosion(point, listenerDist);
      this.shake = Math.min(0.06, this.shake + Math.max(0, 0.06 - listenerDist * 0.003));
      for (const tg of this.targets) {
        if (!tg.alive || !byPlayer) continue;
        const c = tg.center;
        const dmg = fragDamage(spec, c.distanceTo(point), this.occluded(probe, c));
        if (dmg <= 0) continue;
        const killed = tg.applyDamage(dmg, 'body');
        this.bus.emit('combat:hit', { targetId: tg.id, part: 'body', damage: dmg, killed, point: c, byPlayer: true });
        if (killed) this.bus.emit('combat:kill', { attacker: 'You', victim: tg.name, weapon: t('grenade.frag'), headshot: false, byPlayer: true });
      }
      for (const b of this.bots?.bots ?? []) {
        if (!b.alive) continue;
        const c = b.feet.clone().setY(b.feet.y + b.eyeHeight * 0.65);
        const dmg = fragDamage(spec, c.distanceTo(point), this.occluded(probe, c));
        if (dmg <= 0) continue;
        // No friendly fire from grenades either.
        if (b.team === owner.team) continue;
        const killed = b.applyDamage(dmg, 'body', source);
        this.bus.emit('combat:hit', { targetId: b.id, part: 'body', damage: dmg, killed, point: c, byPlayer });
        if (killed) {
          this.bus.emit('combat:kill', {
            attacker: byPlayer ? 'You' : owner.name,
            victim: b.name,
            weapon: t('grenade.frag'),
            headshot: false,
            byPlayer,
            attackerTeam: owner.team,
            victimTeam: b.team,
            attackerId: owner.id,
            victimId: b.id,
          });
        }
      }
      // Your own grenade hurts you; teammates' don't.
      if (byPlayer || owner.team !== PLAYER_TEAM) {
        const chest = this.player.feet.clone().setY(this.player.feet.y + 1.1);
        const dmg = fragDamage(spec, chest.distanceTo(point), this.occluded(probe, chest));
        const killed = dmg > 0 && this.damagePlayer(dmg, point, 'explosion', byPlayer ? undefined : source);
        // An enemy's grenade: report the kill like a bullet kill (feed, scoreboard).
        if (killed && !byPlayer) {
          this.bus.emit('combat:kill', {
            attacker: owner.name,
            victim: this.playerCombatant.name,
            weapon: t('grenade.frag'),
            headshot: false,
            byPlayer: false,
            attackerTeam: owner.team,
            victimTeam: PLAYER_TEAM,
            attackerId: owner.id,
            victimId: PLAYER_ID,
          });
        }
      }
    } else if (type === 'flash') {
      this.effects.flashbang(point);
      this.audio.flashbang(point);
      const toFlash = point.clone().sub(cam.position);
      const dist = toFlash.length();
      const facing = this.tmpFwd.set(0, 0, -1).applyQuaternion(cam.quaternion).dot(toFlash.normalize());
      const intensity = flashIntensity(spec, dist, facing, this.occluded(probe, cam.position));
      for (const b of this.bots?.bots ?? []) {
        if (!b.alive) continue;
        const eye = b.eyePos(new THREE.Vector3());
        const to = point.clone().sub(eye);
        const bi = flashIntensity(spec, to.length(), b.aimDir(new THREE.Vector3()).dot(to.normalize()), this.occluded(probe, eye));
        if (bi > 0) b.blind(flashDuration(bi) * 0.8, this.bots!.time);
      }
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

  /** Returns true if this damage killed the player. */
  private damagePlayer(amount: number, from: THREE.Vector3 | null, cause: DamageCause, source?: DamageSource): boolean {
    const p = this.player;
    if (!p.alive) return false;
    const killed = p.health.damage(amount);
    this.playerHurtAt = this.bots?.time ?? 0;
    this.bus.emit('player:damaged', { amount, from, cause });
    if (this.touch) navigator.vibrate?.(Math.min(60, 15 + amount));
    let yaw: number | null = null;
    if (from) {
      const d = from.clone().sub(p.feet);
      yaw = Math.atan2(-d.x, -d.z);
    }
    this.hud.showDamage(yaw, amount);
    this.audio.hurt(amount);
    this.shake = Math.min(0.05, this.shake + amount * 0.0004);
    if (killed) this.die(cause, source);
    return killed;
  }

  private die(cause: DamageCause, source?: DamageSource): void {
    this.respawnTimer = RESPAWN_SEC;
    this.weapons.adsBlend = 0;
    if (this.deployFlow) {
      this.deployed = false;
      this.deployAt = this.elapsed + DEATH_CAM_SEC;
    }
    this.playerBoxes.setEnabled(false);
    this.bus.emit('player:died', { cause });
    this.bus.emit('combatant:died', { team: PLAYER_TEAM, id: PLAYER_ID });
    this.killedBy = source && source.id !== PLAYER_ID ? source.name : null;
    // Kills by others are reported by whoever made them; self-inflicted ones here.
    if (!this.killedBy) {
      const weapon = cause === 'explosion' ? t('grenade.frag') : cause === 'fall' ? '↓' : '';
      this.hud.addKill({ attacker: 'You', victim: 'You', weapon, headshot: false });
    }
  }

  private respawn(key = 'base'): void {
    const p = this.player;
    p.health.reset();
    if (this.bots) {
      const at = this.spawnFor(PLAYER_TEAM, key, PLAYER_ID);
      p.teleport(at.pos, at.yaw);
    } else {
      const sp = this.playerSpawns.length ? this.playerSpawns[Math.floor(Math.random() * this.playerSpawns.length)]! : this.spawn;
      p.teleport(new THREE.Vector3(...sp.pos), sp.yaw * DEG);
    }
    this.playerBoxes.setEnabled(true);
    this.killedBy = null;
    this.weapons.resetAmmo();
    this.grenades.reset();
    this.hud.clearDamage();
    this.touch?.reset();
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
    this.forest?.update(cam.position);
    this.snowfall?.update(cam.position, this.elapsed, this.renderer.canvas.height);
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
      drawProgress: p.alive && this.deployed ? 1 - w.drawTimer / DRAW_TIME : 0,
      hideForScope: !!w.def.scope && w.adsBlend > 0.95,
      meleeT: w.meleeProgress,
      inspectT: w.inspectProgress,
    });
  }

  private readonly assistEye = new THREE.Vector3();
  private readonly assistAt = new THREE.Vector3();

  /**
   * Touch aim assist: the visible enemy closest to the crosshair within a
   * small cone (one line-of-sight ray for the best candidate only).
   */
  private assistTarget(): AssistTarget | null {
    if (!this.bots) return null;
    const p = this.player;
    const eye = this.assistEye.set(p.feet.x, p.feet.y + p.eyeHeight, p.feet.z);
    const cone = (ASSIST_CONE_DEG * Math.PI) / 180;
    let best: AssistTarget | null = null;
    let bestOff = cone;
    let bestPos: THREE.Vector3 | null = null;
    for (const e of this.bots.enemiesOf(PLAYER_TEAM)) {
      if (!e.alive) continue;
      const dx = e.feet.x - eye.x;
      const dz = e.feet.z - eye.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 90 || dist < 1) continue;
      const [ty, tp] = yawPitchOf(dx, e.feet.y + e.eyeHeight * 0.7 - eye.y, dz);
      const yaw = wrapAngle(ty - p.yaw);
      const pitch = tp - p.pitch;
      const off = Math.hypot(yaw, pitch);
      if (off >= bestOff) continue;
      bestOff = off;
      best = { yaw, pitch, distance: dist };
      bestPos = e.feet;
    }
    if (!best || !bestPos) return null;
    this.assistAt.set(bestPos.x, bestPos.y + 1.2, bestPos.z);
    return this.bots.lineOfSight(eye, this.assistAt) ? best : null;
  }

  /** Feeds the minimap: zones, teammates, spotted enemies around the player. */
  private updateMinimap(dt: number): void {
    const mm = this.minimap;
    if (!mm) return;
    const w = this.weapons;
    const show = this.player.alive && (this.deployed || !this.deployFlow) && !(w.def.scope && w.adsBlend > 0.9);
    mm.setVisible(show);
    if (!show) return;
    const f = this.minimapFrame;
    const p = this.player;
    f.x = p.feet.x;
    f.z = p.feet.z;
    f.yaw = p.yaw;
    const zm = this.zoneMode;
    f.zones = zm
      ? zm.zones.map((z) => ({ id: z.id, x: z.x, z: z.z, r: z.radius, owner: z.owner === null ? null : z.owner === PLAYER_TEAM ? 'ally' : 'enemy', contested: z.contested }))
      : [];
    f.allies.length = 0;
    f.enemies.length = 0;
    if (this.bots) {
      const squad = this.playerSquad;
      for (const b of this.bots.bots) {
        if (b.alive && b.team === PLAYER_TEAM) f.allies.push({ x: b.feet.x, z: b.feet.z, squad: !!squad?.has(b.id) });
      }
      for (const e of this.bots.spottedEnemies(PLAYER_TEAM, p.feet)) f.enemies.push({ x: e.feet.x, z: e.feet.z });
    }
    mm.draw(f, dt);
  }

  private updateHud(dt: number): void {
    this.updateMinimap(dt);
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
    this.touch?.setGrenade(t(`grenade.${sel}` as MessageKey), this.grenades.counts[sel]);
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
        killedBy: this.killedBy,
        score: this.bots ? { allies: this.bots.score(PLAYER_TEAM), enemies: this.bots.score(otherTeam(PLAYER_TEAM)) } : null,
        zone: this.zoneHud(),
        squad: this.squadHud(),
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

  // ---------------------------------------------------------------------------
  // Zone mode

  private setupZoneMode(map: MapDef, terrain: Terrain): void {
    const zm = new ZoneMode(map, this.bus, { tickets: this.options.tickets });
    this.zoneMode = zm;
    this.zoneVisuals = new ZoneVisuals(this.renderer.scene, zm.zones, (x, z) => terrain.heightAt(x, z));
    const side = (team: Team): Side => (team === PLAYER_TEAM ? 'ally' : 'enemy');
    this.bus.on('combatant:died', (e) => zm.onDeath(e.team));
    this.bus.on('zone:captured', (e) => {
      const ours = e.team === PLAYER_TEAM;
      this.hud.notify(`${e.zone} ${t(ours ? 'zone.captured' : 'zone.enemyCaptured')}`, side(e.team));
      this.audio.zoneCue(ours);
      this.bots?.replan('blue');
      this.bots?.replan('red');
    });
    this.bus.on('zone:neutralized', (e) => {
      const ours = e.team === PLAYER_TEAM;
      this.hud.notify(`${e.zone} ${t(ours ? 'zone.lost' : 'zone.enemyLost')}`, ours ? 'enemy' : 'ally');
      this.audio.zoneCue(!ours);
      if (ours && this.spawnKey === `zone:${e.zone}`) this.spawnKey = 'base';
      this.bots?.replan('blue');
      this.bots?.replan('red');
    });
    this.bus.on('match:ended', (e) => this.endMatch(e.winner));

    // Scoreboard stats.
    this.bus.on('combat:kill', (e) => this.scores.kill(e.attackerId, e.victimId, e.headshot));
    this.bus.on('combatant:died', (e) => this.scores.death(e.id));
    // Credit for zones goes to the side's soldiers standing in the zone at that moment.
    const inZone = (zone: string, team: Team) => {
      const ids: number[] = [];
      for (const c of this.combatants()) if (c.alive && c.team === team && this.zoneMode?.zoneAt(c.feet)?.id === zone) ids.push(c.id);
      return ids;
    };
    this.bus.on('zone:captured', (e) => this.scores.objective(inZone(e.zone, e.team), 'capture'));
    this.bus.on('zone:neutralized', (e) => this.scores.objective(inZone(e.zone, otherTeam(e.team)), 'neutralize'));
  }

  /** Scoreboard: while Z is held (touch: toggled), refreshed a few times a second. */
  private updateScoreboard(dt: number, held: boolean): void {
    const sb = this.scoreboard;
    if (this.matchOver) return;
    const show = held && !!this.bots && !this.overlay.visible;
    sb.setVisible(show);
    if (!show) {
      this.scoreboardTimer = 0;
      return;
    }
    this.scoreboardTimer -= dt;
    if (this.scoreboardTimer > 0) return;
    this.scoreboardTimer = 0.25;
    this.fillScoreboard();
  }

  private fillScoreboard(): void {
    const tickets = this.zoneMode?.rules.tickets;
    const alive = new Map<number, boolean>();
    for (const c of this.combatants()) alive.set(c.id, c.alive);
    const side = (team: Team): ScoreboardSide => ({
      label: t(team === PLAYER_TEAM ? 'hud.allies' : 'hud.enemies'),
      tickets: tickets ? tickets[team] : null,
      kills: this.scores.totals(team).kills,
      rows: this.scores.table(team).map((r) => ({
        name: r.name,
        squad: this.squads.find((s) => s.team === team && s.has(r.id))?.name ?? null,
        kills: r.kills,
        deaths: r.deaths,
        captures: r.captures,
        score: r.score,
        alive: alive.get(r.id) ?? false,
        you: r.id === PLAYER_ID,
        mate: r.id !== PLAYER_ID && !!this.playerSquad?.has(r.id),
      })),
    });
    this.scoreboard.update(side(PLAYER_TEAM), side(otherTeam(PLAYER_TEAM)));
  }

  // ---------------------------------------------------------------------------
  // Squads & deploying

  private setupSquads(map: MapDef, terrain: Terrain): void {
    const bots = this.bots!;
    const blue = bots.bots.filter((b) => b.team === 'blue');
    const red = bots.bots.filter((b) => b.team === 'red');
    this.squads = [...formSquads('blue', [this.playerCombatant, ...blue]), ...formSquads('red', red)];
    for (const c of [this.playerCombatant, ...blue, ...red]) this.scores.add(c.id, c.id === PLAYER_ID ? t('feed.you') : c.name, c.team);
    this.playerSquad = this.squads.find((s) => s.has(PLAYER_ID)) ?? null;
    bots.setSquads(
      this.squads.map((sq) => ({
        index: sq.index,
        botIds: sq.members.filter((m) => m.id !== PLAYER_ID).map((m) => m.id),
        leader: sq.has(PLAYER_ID) ? this.playerCombatant : null,
      })),
    );
    // The player's fights are the squad's fights: whoever they hit or get shot by.
    this.bus.on('combat:hit', (e) => {
      const victim = e.byPlayer ? bots.bots.find((b) => b.id === e.targetId) : undefined;
      if (victim) bots.playerContact(victim.feet);
    });
    this.bus.on('player:damaged', (e) => {
      if (e.from) bots.playerContact(e.from);
    });
    const zm = this.zoneMode;
    bots.hooks = {
      objectives: (team) => zm?.objectives(team) ?? [],
      spawnAt: (bot, objective) => this.spawnFor(bot.team, this.botSpawnKey(bot, objective), bot.id),
    };
    // Squads already penalized for their current wipe (cleared once someone is back).
    const penalized = new Set<Squad>();
    this.bus.on('combatant:died', (e) => {
      for (const s of penalized) if (!s.wiped) penalized.delete(s);
      const sq = this.squads.find((s) => s.team === e.team && s.has(e.id));
      if (!sq || !sq.wiped || penalized.has(sq)) return;
      penalized.add(sq);
      // Everyone in a wiped squad waits longer.
      for (const m of sq.members) {
        if (m.id === PLAYER_ID) this.respawnTimer += WIPE_PENALTY;
        else (m as Bot).respawnPenalty = WIPE_PENALTY;
      }
      if (sq === this.playerSquad) {
        this.squadWiped = true;
        this.hud.notify(t('squad.wiped'), 'enemy');
      }
    });
    this.bus.on('player:respawned', () => (this.squadWiped = false));

    this.deployFlow = true;
    this.deployed = false;
    this.playerBoxes.setEnabled(false);
    this.deployScreen = new DeployScreen(
      this.container,
      this.mapImage ?? paintMap(map, terrain.boundary),
      (key) => (this.spawnKey = key),
      () => this.deploy(),
    );
  }

  private openDeploy(): void {
    const ds = this.deployScreen!;
    ds.update(this.deployState());
    ds.show();
    this.touch?.setVisible(false);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private deploy(): void {
    if (this.matchOver || this.deployed || this.respawnTimer > 0) return;
    const opts = this.deployOptions();
    const choice = opts.find((o) => o.key === this.spawnKey && !o.blocked) ?? opts[0]!;
    this.deployed = true;
    this.respawn(choice.key);
    this.deployScreen!.hide();
    if (this.touch) this.touch.setVisible(true);
    else this.kbm.requestLock();
  }

  private baseCenter(team: Team): THREE.Vector3 {
    const list = this.mapSpawns.filter((s) => s.team === team || (team === PLAYER_TEAM && s.team === 'player'));
    return list.reduce((a, s) => a.add(new THREE.Vector3(...s.pos)), new THREE.Vector3()).divideScalar(Math.max(1, list.length));
  }

  /** Spawn position for a deploy key ('base' | 'zone:<id>' | 'mate:<id>'); invalid keys fall back to the base. */
  private spawnFor(team: Team, key: string, selfId: number): { pos: THREE.Vector3; yaw: number } {
    const [kind, id] = key.split(':');
    if (kind === 'mate') {
      const sq = this.squads.find((s) => s.team === team && s.has(selfId));
      const mate = sq?.members.find((m) => String(m.id) === id);
      if (mate && !mateSpawnBlock(mate, this.bots!.time)) return this.besideMate(mate);
    }
    const zm = this.zoneMode;
    if (zm) return zm.spawnPoint(team, kind === 'zone' ? id! : 'base', this.nav);
    const list = this.mapSpawns.filter((s) => s.team === team || (team === PLAYER_TEAM && s.team === 'player'));
    const sp = list[Math.floor(Math.random() * list.length)];
    const pos = sp ? new THREE.Vector3(...sp.pos) : this.baseCenter(team);
    return { pos: this.nav?.randomAround(pos, 3) ?? pos, yaw: (sp?.yaw ?? 0) * DEG };
  }

  /** A step behind a squadmate, facing where they face. */
  private besideMate(m: SquadMember): { pos: THREE.Vector3; yaw: number } {
    const side = Math.random() < 0.5 ? -1 : 1;
    const back = new THREE.Vector3(Math.sin(m.yaw), 0, Math.cos(m.yaw)).multiplyScalar(2.2);
    const lateral = new THREE.Vector3(Math.cos(m.yaw), 0, -Math.sin(m.yaw)).multiplyScalar(side * 1.2);
    const want = m.feet.clone().add(back).add(lateral);
    const pos = (this.nav && (this.nav.randomAround(want, 1.2) ?? this.nav.closest(want))) || want;
    return { pos, yaw: m.yaw };
  }

  /**
   * Where a bot respawns: on its leader (the player) when allowed, else the
   * option nearest its objective among base, owned zones and free squadmates.
   */
  private botSpawnKey(bot: Bot, objective: THREE.Vector3 | null): string {
    const now = this.bots!.time;
    const sq = this.squads.find((s) => s.team === bot.team && s.has(bot.id));
    const mates = sq ? sq.mates(bot.id).filter((m) => !mateSpawnBlock(m, now)) : [];
    if (sq === this.playerSquad && mates.some((m) => m.id === PLAYER_ID)) return `mate:${PLAYER_ID}`;
    const target = objective ?? this.baseCenter(otherTeam(bot.team));
    const cands: { key: string; x: number; z: number }[] = [];
    const base = this.baseCenter(bot.team);
    cands.push({ key: 'base', x: base.x, z: base.z });
    for (const o of this.zoneMode?.spawnOptions(bot.team) ?? []) {
      if (o.id === 'base') continue;
      const z = this.zoneMode!.zone(o.id)!;
      cands.push({ key: `zone:${o.id}`, x: z.x, z: z.z });
    }
    for (const m of mates) cands.push({ key: `mate:${m.id}`, x: m.feet.x, z: m.feet.z });
    let best = cands[0]!;
    let bestD = Infinity;
    for (const c of cands) {
      const d = Math.hypot(c.x - target.x, c.z - target.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best.key;
  }

  private deployOptions(): DeployOption[] {
    const out: DeployOption[] = [];
    const base = this.baseCenter(PLAYER_TEAM);
    out.push({ key: 'base', kind: 'base', label: t('spawn.base'), x: base.x, z: base.z, blocked: null, warn: null });
    const zm = this.zoneMode;
    for (const o of zm?.spawnOptions(PLAYER_TEAM) ?? []) {
      if (o.id === 'base') continue;
      const z = zm!.zone(o.id)!;
      out.push({ key: `zone:${o.id}`, kind: 'zone', label: `${t('spawn.zone')} ${o.id}`, x: z.x, z: z.z, blocked: null, warn: o.underAttack ? t('deploy.underAttack') : null });
    }
    const now = this.bots?.time ?? 0;
    for (const m of this.playerSquad?.mates(PLAYER_ID) ?? []) {
      const block = mateSpawnBlock(m, now);
      out.push({
        key: `mate:${m.id}`,
        kind: 'mate',
        label: m.name,
        x: m.feet.x,
        z: m.feet.z,
        blocked: block === 'dead' ? t('deploy.dead') : block === 'combat' ? t('deploy.combat') : null,
        warn: null,
      });
    }
    return out;
  }

  private squadHud(): SquadHud | null {
    const sq = this.playerSquad;
    if (!sq) return null;
    const now = this.bots?.time ?? 0;
    return {
      name: sq.name,
      members: sq.members.map((m) => ({
        name: m.id === PLAYER_ID ? t('feed.you') : m.name,
        // Before the first deploy the player is waiting, not dead.
        state: m.id === PLAYER_ID ? (this.player.alive ? (this.deployed && m.inCombat(now) ? 'combat' : 'ok') : 'dead') : !m.alive ? 'dead' : m.inCombat(now) ? 'combat' : 'ok',
        you: m.id === PLAYER_ID,
      })),
    };
  }

  private deployState(): DeployState {
    const options = this.deployOptions();
    const sel = options.find((o) => o.key === this.spawnKey && !o.blocked) ? this.spawnKey : 'base';
    const zm = this.zoneMode;
    const tone = (team: Team | null) => (team === null ? 'neutral' : team === PLAYER_TEAM ? 'ally' : 'enemy') as 'ally' | 'enemy' | 'neutral';
    const squad = this.squadHud();
    return {
      options,
      selected: sel,
      wait: Math.max(0, this.respawnTimer),
      note: this.squadWiped ? t('squad.wiped') : null,
      title: `${t('deploy.title')} · ${this.mapName}`,
      tickets: zm ? { allies: zm.rules.tickets[PLAYER_TEAM], enemies: zm.rules.tickets[otherTeam(PLAYER_TEAM)] } : null,
      zones: zm ? zm.zones.map((z) => ({ id: z.id, x: z.x, z: z.z, r: z.radius, owner: tone(z.owner), pushing: z.pushing !== null })) : [],
      enemyBase: (() => {
        const b = this.baseCenter(otherTeam(PLAYER_TEAM));
        return { x: b.x, z: b.z };
      })(),
      squad: squad && { name: squad.name, members: squad.members.map((m) => ({ ...m, name: m.you ? this.playerCombatant.name : m.name })) },
    };
  }

  private *combatants(): Iterable<{ id: number; team: Team; alive: boolean; feet: THREE.Vector3 }> {
    yield this.playerCombatant;
    if (this.bots) yield* this.bots.bots;
  }

  private zoneHud(): ZoneHud | null {
    const zm = this.zoneMode;
    if (!zm) return null;
    const side = (team: Team | null): Side | null => (team === null ? null : team === PLAYER_TEAM ? 'ally' : 'enemy');
    const zones = zm.zones.map((z) => ({ id: z.id, owner: side(z.owner), progress: ZoneRules.progress(z), pushing: side(z.pushing), contested: z.contested }));
    let here: ZoneHud['here'] = null;
    const inZone = this.player.alive ? zm.zoneAt(this.player.feet) : null;
    if (inZone) {
      const ours = inZone.owner === PLAYER_TEAM;
      let text: string;
      let tone: Side | 'neutral' = inZone.owner === null ? 'neutral' : ours ? 'ally' : 'enemy';
      if (inZone.contested) text = t('zone.contested');
      else if (inZone.pushing === PLAYER_TEAM) {
        text = inZone.owner === null ? t('zone.capturing') : t('zone.neutralizing');
        tone = 'ally';
      } else if (inZone.pushing) {
        text = ours ? t('zone.losing') : t('zone.capturing');
        tone = 'enemy';
      } else text = inZone.owner === null ? t('zone.neutral') : ours ? t('zone.held') : t('zone.enemyHeld');
      // Bar: how much the zone leans toward us (full = ours).
      const lean = PLAYER_TEAM === 'blue' ? inZone.control : -inZone.control;
      here = { id: inZone.id, text, progress: (lean + 1) / 2, tone };
    }
    return { tickets: { allies: zm.rules.tickets[PLAYER_TEAM], enemies: zm.rules.tickets[otherTeam(PLAYER_TEAM)] }, zones, here };
  }

  private endMatch(winner: Team): void {
    if (this.matchOver) return;
    this.matchOver = true;
    const zm = this.zoneMode!;
    const won = winner === PLAYER_TEAM;
    // Let the moment land, then stop and show the result.
    window.setTimeout(() => {
      this.running = false;
      if (document.pointerLockElement) document.exitPointerLock();
      const tk = zm.rules.tickets;
      this.overlay.show(t(won ? 'match.victory' : 'match.defeat'), `${t('match.tickets')} ${tk[PLAYER_TEAM]} : ${tk[otherTeam(PLAYER_TEAM)]}`, t('match.again'));
      // Final standings under the result.
      if (this.bots) {
        this.fillScoreboard();
        this.scoreboard.setFinal(true);
        this.scoreboard.setVisible(true);
        this.overlay.setExtra(this.scoreboard.root);
      }
      this.overlay.root.addEventListener('click', () => location.reload(), { once: true });
    }, 2500);
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
