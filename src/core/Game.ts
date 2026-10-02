import * as THREE from 'three';
import { EventBus } from './EventBus';
import type { DamageCause, GameEvents, GrenadeOwner, HitPart } from './events';
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
import { buildBlockout, hasTerrain, snapToTerrain, type BuiltMap } from '@/world/buildBlockout';
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
import { consumePulses, createInputState, resetFrameInput, type InputSource, type InputState } from '@/input/InputState';
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
import { BLASTS, GRENADES, flashDuration, flashIntensity, fragDamage, type BlastKind, type GrenadeType } from '@/combat/explosions';
import { GADGETS, PANZERFAUST_TOSS, PLACE_REACH, ROCKET, classGadget, type GadgetId } from '@/data/gadgets';
import { GadgetWorld, type GadgetOwner, type MineWalker } from '@/modes/gadgetWorld';
import { DRAW_TIME, WeaponController } from '@/weapons/WeaponController';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import { ViewModel } from '@/weapons/ViewModel';
import { opticFor } from '@/weapons/optics';
import { BREATH, SWAY_AMP, createBreath, scopeSway, stepBreath } from '@/weapons/breath';
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
import {
  AMMO_GIVE_COOLDOWN,
  ASSAULT_WADE_EASE,
  CLASSES,
  DOWN,
  GIVE_RANGE,
  GRENADE_COUNT,
  MEDKIT,
  RECON_ZOOM,
  REVIVE_RANGE,
  loadoutWeapons,
  moveBonus,
  zoomedFov,
  type ClassId,
} from '@/data/classes';
import { LoadoutStore } from '@/data/loadoutStore';
import { LoadoutPanel } from '@/ui/LoadoutPanel';
import { FORT, Fortifications, REFILL_POINTS, STATION, canRefill, planFortifications, worldProbe, type FortJob, type FortSlot, type Station } from '@/modes/fortify';
import { FortModels } from '@/world/fortModels';

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
  /** Carry `loadout` (every weapon, for testing) instead of the class loadout picked on the deploy screen. */
  sandbox?: boolean;
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
  /** Holding the breath behind a scope (X), and the sway it steadies. */
  private breath = createBreath();
  private flashTotal = 0;
  private flashPeak = 0;
  /** Camera shake amplitude in radians. */
  private shake = 0;
  private deathBlend = 0;
  /** Class loadouts picked on the deploy screen (kept per class across matches). */
  private readonly loadouts = new LoadoutStore();
  private loadoutPanel: LoadoutPanel | null = null;
  /** Class of the current life (passives). */
  private cls: ClassId = 'assault';
  /** Recon: scope zoomed the extra 1.5x (wheel while aiming). */
  private reconZoom = false;
  /** Scope eye box off centre (fractions of the lens radius): lags behind turning, bobs when walking. */
  private readonly scopeShift = new THREE.Vector2();
  /** Sim clock (s) for cooldowns, shields and the down timer. */
  private simTime = 0;
  /** Down: health gone, waiting for a revive; bleeds out or gives up into a real death. */
  private playerDowned = false;
  private downTime = 0;
  private giveUpHold = 0;
  private downCause: DamageCause = 'bullet';
  private downSource: DamageSource | undefined;
  private reviveShieldUntil = -Infinity;
  /** Medkits carried (medics: endless on a cooldown until `medkitReadyAt`). */
  private medkits: number = MEDKIT.carried;
  private medkitReadyAt = 0;
  /** Seconds left of using a medkit (weapon lowered) and of the heal after it. */
  private medkitUse = 0;
  private healLeft = 0;
  /** Downed ally the player is reviving (holding E) and progress (s). */
  private reviveOf: Bot | null = null;
  private reviveProgress = 0;
  /** What E does right now (HUD prompt, touch button). */
  private interact: { kind: 'revive' | 'medkit'; bot: Bot } | { kind: 'fort'; job: FortJob | null; station: Station | null; note: string | null } | null = null;
  /** Zone supply stations and build spots. */
  private fort: Fortifications | null = null;
  /** Holding E at a build spot or station (hands busy, hammer out) and for how long. */
  private working = -1;
  /** Build mode (T): the hammer is out, build spots show clearly, the trigger builds the one aimed at. */
  private buildMode = false;
  /** Rockets, rifle grenades, beacons and mines in the world. */
  private gadgets!: GadgetWorld;
  /** The class gadget carried this life, how many are left, and whether it is in hand (key 4). */
  private gadget: GadgetId | null = null;
  private gadgetCount = 0;
  private gadgetOut = false;
  /** Seconds before the gadget can be used again (the next tube coming up, placing). */
  private gadgetBusy = 0;
  /** Sim time of the last use (view model: recoil / placing motion). */
  private gadgetUsedAt = -10;
  private buildTarget: FortSlot | null = null;
  private nextBlow = 0;
  /** Next time a giver may hand the same receiver the same thing: 'giver>receiver:kind' -> sim time. */
  private readonly giveReady = new Map<string, number>();

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
    this.gadgets = new GadgetWorld(this.physics, this.registry, {
      explode: (kind, point, owner) => this.blast(kind, point, owner, t(kind === 'rocket' ? 'gadget.assault' : 'gadget.mine')),
      directHit: (target, part, point, owner) => this.rocketHit(target, part, point, owner),
      smoke: (point) => {
        this.effects.smoke(point, GRENADES.smoke.duration ?? 20, GRENADES.smoke.radius);
        this.audio.smokePop(point, GRENADES.smoke.duration ?? 20);
      },
      destroyed: (_kind, point) => this.audio.grenadeBounce(point, 12),
    });
    r.scene.add(this.gadgets.group);
    this.spawn =map.spawns.find((s) => s.team === 'player') ?? map.spawns[0]!;
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

    const firstKit = this.loadouts.current;
    this.cls = firstKit.cls;
    this.grenades.reset(firstKit.grenade);
    this.weapons = new WeaponController(this.options.sandbox ? this.options.loadout : loadoutWeapons(firstKit), this.physics, this.registry, this.impacts, this.bus);
    this.weapons.endlessReserve = !this.options.sandbox && firstKit.cls === 'support';
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
        this.bots.gadgets = this.gadgets;
        this.bots.squadKey = (b) => this.squadKeyOf(b.team, b.id);
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
      this.setupFortifications(map, terrain, water, built);
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
    this.overlay.show(t('title'), touch ? t('start.tap') : t('start.click'), touch ? t('start.hintTouch') : t('start.hint'));
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
    for (const id of this.weapons.loadout) {
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
      const quiet = !!WEAPONS[e.weaponId as WeaponId].suppressed;
      if (this.bots) {
        this.playerFiringUntil = this.bots.time + 0.6;
        // A suppressed gun is only heard close by.
        this.bots.alert(this.player.feet, quiet ? 22 : 70, this.playerCombatant);
      }
      this.audio.gunshot(cls(e.weaponId), e.ads, quiet);
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
    this.overlay.show(t('paused'), this.touch ? t('start.tap') : t('start.click'), this.touch ? t('start.hintTouch') : t('start.hint'));
    if (this.touch) this.overlay.setExtra(this.layoutButton());
  }

  /** Pause screen (touch): opens the button layout editor instead of resuming. */
  private layoutButton(): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'overlay-layout-btn';
    b.textContent = t('layout.edit');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.overlay.setExtra(null);
      this.overlay.hide();
      this.touch?.editLayout(() => this.pause());
    });
    return b;
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
      const adsFov = this.aimFov() * (this.settings.fov / AUTHORED_FOV);
      const adsScale = this.settings.adsSensitivity * (adsFov / this.settings.fov);
      const sens = 1 + (adsScale - 1) * w.adsBlend;
      if (p.alive || this.playerDowned) {
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
      get downed() {
        return game.playerDowned && game.deployed;
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
    this.simTime += dt;
    this.throwBlock = Math.max(0, this.throwBlock - dt);
    this.throwCooldown = Math.max(0, this.throwCooldown - dt);

    // A click released before this step still counts as one trigger pull.
    if (input.firePressed) input.fire = true;
    if (p.alive && this.deployed) {
      // Recon: the wheel (touch: swap) changes scope power while aiming instead of weapons.
      const w = this.weapons;
      if (this.cls === 'recon' && w.def.scope && w.adsBlend > 0.5 && input.weaponCycle !== 0) {
        this.reconZoom = !this.reconZoom;
        input.weaponCycle = 0;
      }
      // Barbed wire slows everyone wading through it.
      p.speedBonus = moveBonus(this.cls, w.def) * (this.fort?.slowAt(p.feet) ?? 1);
      // 4 (a match has three weapon slots) or the touch button: the class gadget.
      const gadgetKey = input.gadget || (!this.options.sandbox && input.weaponSlot === 3);
      if (gadgetKey) {
        input.weaponSlot = -1;
        if (this.gadgetOut) this.gadgetOut = false;
        else if (this.gadget && this.gadgetCount > 0) {
          this.gadgetOut = true;
          this.buildMode = false;
        }
      }
      if (input.buildMode && this.fort) {
        this.buildMode = !this.buildMode;
        if (this.buildMode) this.gadgetOut = false;
      }
      // Reaching for a weapon or a grenade puts the hammer (or the gadget) away.
      const reach = input.weaponSlot >= 0 || input.weaponCycle !== 0 || input.throwGrenade || input.melee;
      if (this.buildMode && reach) this.buildMode = false;
      if (this.gadgetOut && reach) this.gadgetOut = false;
      this.stepGadget(dt, input);
      if (this.buildMode || this.gadgetOut) {
        input.ads = false;
        input.reload = false;
      }
      p.wadePenalty = this.cls === 'assault' ? ASSAULT_WADE_EASE : 1;
      if (input.medkit) this.useMedkit();
      this.stepMedkit(dt);
      this.stepInteract(dt, input);
      if (input.throwGrenade && this.throwCooldown === 0 && !p.sprinting) this.throwGrenade();
      const firing = input.fire;
      // Pulling the trigger, aiming or swinging ends a sprint immediately.
      if (input.fire || input.ads || input.melee) {
        input.sprint = false;
        p.sprinting = false;
      }
      // Hands busy (throwing, patching up, reviving): no shooting.
      const busy = this.throwBlock > 0 || this.medkitUse > 0 || this.reviveProgress > 0 || this.working >= 0 || this.buildMode || this.gadgetOut;
      this.weapons.step(dt, input, p, busy);
      p.step(dt, input, this.weapons.adsBlend > 0.5, firing && this.weapons.sinceShot < 0.2);
      this.stepSway(dt, input.holdBreath);
    } else if (this.playerDowned) {
      this.stepDowned(dt, input.jumpHeld);
    } else {
      this.respawnTimer -= dt;
      // With a deploy screen the player chooses when to go; otherwise respawn automatically.
      if (!this.deployFlow && this.respawnTimer <= 0) this.respawn();
    }
    this.playerBoxes.sync(p.feet, p.yaw, p.bodyHeight);
    this.bots?.step(dt);
    this.fort?.step();
    this.botsResupplyPlayer();
    this.zoneMode?.step(dt, this.combatants());
    this.throwables.step(dt);
    this.gadgets.step(dt, this.mineWalkers());
    this.physics.step();
    consumePulses(input);
  }

  /**
   * Scoped rifles sway (snipers most); X holds the breath to steady it for a
   * few seconds, too long and the view goes black. The shot follows the sway.
   */
  private stepSway(dt: number, hold: boolean): void {
    const w = this.weapons;
    const p = this.player;
    const scoped = !!w.def.scope && w.adsBlend > 0.9;
    const ev = stepBreath(this.breath, dt, hold, scoped);
    if (ev) this.audio.breath(ev);
    const amp = w.def.scope ? (SWAY_AMP[w.def.class] ?? 0.004) : 0;
    const moving = Math.min(1.5, p.horizontalSpeed() / 4);
    const stance = (p.crouching && p.grounded ? 0.6 : 1) * (1 + moving * 0.7) * (p.grounded ? 1 : 2);
    scopeSway(this.breath, this.simTime, amp, w.adsBlend, stance, w.sway);
  }

  /** Everyone who can set off a mine: the player (when on the field) and the bots. */
  private *mineWalkers(): Iterable<MineWalker> {
    if (this.player.alive && this.deployed) yield this.playerCombatant;
    if (this.bots) yield* this.bots.bots;
  }

  /** Squad key of a combatant ('blue:Alpha'), for spawn beacons. */
  private squadKeyOf(team: Team, id: number): string | null {
    const sq = this.squads.find((s) => s.team === team && s.has(id));
    return sq ? `${sq.team}:${sq.name}` : null;
  }

  /**
   * Gadget in hand: the trigger fires the panzerfaust / rifle grenade, or puts
   * down a beacon / mine where the player looks (within reach, on the ground).
   * Out of charges, it goes away once the last use is done.
   */
  private stepGadget(dt: number, input: InputState): void {
    this.gadgetBusy = Math.max(0, this.gadgetBusy - dt);
    if (!this.gadgetOut || !this.gadget) return;
    if (this.gadgetCount <= 0) {
      if (this.gadgetBusy <= 0) this.gadgetOut = false;
      return;
    }
    if (!input.firePressed || this.gadgetBusy > 0) return;
    const p = this.player;
    const owner: GadgetOwner = { id: PLAYER_ID, name: t('feed.you'), team: PLAYER_TEAM, squad: this.squadKeyOf(PLAYER_TEAM, PLAYER_ID) };
    const { eye, fwd, right, up } = this.weapons.aimBasis(p);
    const g = this.gadget;
    if (g === 'panzerfaust' || g === 'riflesmoke') {
      const origin = eye.clone().addScaledVector(fwd, 0.8).addScaledVector(right, g === 'panzerfaust' ? 0.1 : 0.05).addScaledVector(up, -0.06);
      this.gadgets.fire(g === 'panzerfaust' ? 'rocket' : 'riflesmoke', origin, fwd.clone(), owner);
      this.audio.gadget(g === 'panzerfaust' ? 'rocket' : 'rifle', null);
      if (g === 'panzerfaust') this.shake = Math.min(0.05, this.shake + 0.03);
    } else {
      const at = this.placeSpot(eye, fwd);
      if (!at) return;
      const yaw = p.yaw;
      if (g === 'beacon') this.gadgets.placeBeacon(at, yaw, owner);
      else this.gadgets.placeMine(at, yaw, owner);
      this.audio.gadget('place', null);
      this.renderer.requestShadowUpdate();
    }
    this.gadgetCount--;
    // The panzerfaust reloads (next tube) unless that was the last; then only the spent tube goes.
    this.gadgetBusy = g === 'panzerfaust' && this.gadgetCount === 0 ? PANZERFAUST_TOSS : GADGETS[g].cycle;
    this.gadgetUsedAt = this.simTime;
    if (g === 'panzerfaust' && this.gadgetCount > 0) this.audio.launcherReload();
  }

  /** Where a beacon or mine goes: the ground the player looks at within reach, else just ahead of their feet. */
  private placeSpot(eye: THREE.Vector3, fwd: THREE.Vector3): THREE.Vector3 | null {
    const hit = this.physics.raycast(eye, fwd, PLACE_REACH, Layer.WORLD);
    if (hit && hit.normal.y > 0.7) return new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
    const flat = new THREE.Vector3(fwd.x, 0, fwd.z);
    if (flat.lengthSq() < 1e-4) return null;
    flat.normalize();
    const probe = this.player.feet.clone().addScaledVector(flat, 1).setY(this.player.feet.y + 1);
    const down = this.physics.raycast(probe, new THREE.Vector3(0, -1, 0), 2.2, Layer.WORLD);
    return down && down.normal.y > 0.7 ? new THREE.Vector3(down.point.x, down.point.y, down.point.z) : null;
  }

  private throwGrenade(): void {
    const type = this.grenades.take();
    if (!type) return;
    const { eye, fwd, right, up } = this.weapons.aimBasis(this.player);
    const origin = eye.clone().addScaledVector(fwd, 0.45).addScaledVector(right, -0.15).addScaledVector(up, -0.05);
    this.throwables.throw(type, origin, fwd.clone(), this.player.velocity.clone(), { id: PLAYER_ID, name: t('feed.you'), team: PLAYER_TEAM });
    this.throwBlock = THROW_BLOCK;
    this.throwCooldown = THROW_COOLDOWN;
    this.bus.emit('grenade:thrown', { type, remaining: this.grenades.count });
  }

  /** True if world geometry blocks the straight line between two points. */
  private occluded(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.05) return false;
    const hit = this.physics.raycast(from, dir.normalize(), dist - 0.1, Layer.WORLD);
    return !!hit;
  }

  /**
   * A damaging blast (frag, panzerfaust rocket, AP mine): fortifications, beacons
   * and mines in it, practice targets, bots and the player. No friendly fire.
   */
  private blast(kind: BlastKind, point: THREE.Vector3, owner: GrenadeOwner, weapon: string): void {
    const spec = BLASTS[kind];
    const byPlayer = owner.id === PLAYER_ID;
    const source: DamageSource = { pos: point.clone(), name: owner.name, team: owner.team, weapon, id: owner.id };
    const listenerDist = this.renderer.camera.position.distanceTo(point);
    const probe = point.clone().setY(point.y + 0.25);
    this.effects.explosion(point);
    this.audio.explosion(point, listenerDist);
    this.shake = Math.min(0.06, this.shake + Math.max(0, 0.06 - listenerDist * 0.003));
    if (kind !== 'frag') this.bots?.explosionAt(point);
    // Fortifications in the blast take damage (colliders go at the next physics step).
    for (const s of this.fort?.blast(point, spec.radius, (d) => fragDamage(spec, d, false) * spec.fortMult) ?? []) {
      this.effects.explosion(s.kind === 'barricade' ? s.pos : s.pos.clone().setY(s.pos.y + 0.5));
    }
    if (kind === 'frag') this.gadgets.blast(point, spec.radius * 0.6);
    for (const tg of this.targets) {
      if (!tg.alive || !byPlayer) continue;
      const c = tg.center;
      const dmg = fragDamage(spec, c.distanceTo(point), this.occluded(probe, c));
      if (dmg <= 0) continue;
      const killed = tg.applyDamage(dmg, 'body');
      this.bus.emit('combat:hit', { targetId: tg.id, part: 'body', damage: dmg, killed, point: c, byPlayer: true });
      if (killed) this.bus.emit('combat:kill', { attacker: 'You', victim: tg.name, weapon, headshot: false, byPlayer: true });
    }
    for (const b of this.bots?.bots ?? []) {
      if (!b.alive || b.team === owner.team) continue;
      const c = b.feet.clone().setY(b.feet.y + b.eyeHeight * 0.65);
      const dmg = fragDamage(spec, c.distanceTo(point), this.occluded(probe, c));
      if (dmg <= 0) continue;
      const killed = b.applyDamage(dmg, 'body', source);
      this.bus.emit('combat:hit', { targetId: b.id, part: 'body', damage: dmg, killed, point: c, byPlayer });
      if (killed) this.reportKill(owner, b.id, b.name, b.team, weapon);
    }
    // Your own blast hurts you; teammates' don't.
    if (byPlayer || owner.team !== PLAYER_TEAM) {
      const chest = this.player.feet.clone().setY(this.player.feet.y + 1.1);
      const dmg = fragDamage(spec, chest.distanceTo(point), this.occluded(probe, chest));
      const killed = dmg > 0 && this.damagePlayer(dmg, point, 'explosion', byPlayer ? undefined : source);
      // An enemy's blast: report the kill like a bullet kill (feed, scoreboard).
      if (killed && !byPlayer) this.reportKill(owner, PLAYER_ID, this.playerCombatant.name, PLAYER_TEAM, weapon);
    }
  }

  /** A panzerfaust rocket striking someone: a kill (or down) for anyone but a teammate. */
  private rocketHit(target: Damageable, part: HitPart, point: THREE.Vector3, owner: GadgetOwner): void {
    if (target.team === owner.team || target.id < 0) return;
    const weapon = t('gadget.assault');
    const byPlayer = owner.id === PLAYER_ID;
    const source: DamageSource = { pos: point.clone(), name: owner.name, team: owner.team, weapon, id: owner.id };
    const killed = target.applyDamage(ROCKET.directDamage, part, source);
    this.bus.emit('combat:hit', { targetId: target.id, part, damage: ROCKET.directDamage, killed, point: point.clone(), byPlayer });
    if (killed) this.reportKill(owner, target.id, target.id === PLAYER_ID ? this.playerCombatant.name : target.name, target.team ?? null, weapon);
  }

  private reportKill(owner: GrenadeOwner, victimId: number, victim: string, victimTeam: Team | null, weapon: string): void {
    const byPlayer = owner.id === PLAYER_ID;
    this.bus.emit('combat:kill', {
      attacker: byPlayer ? 'You' : owner.name,
      victim,
      weapon,
      headshot: false,
      byPlayer,
      attackerTeam: owner.team,
      victimTeam: victimTeam ?? undefined,
      attackerId: owner.id,
      victimId,
    });
  }

  private detonate(type: GrenadeType, point: THREE.Vector3, owner: GrenadeOwner): void {
    const spec = GRENADES[type];
    const cam = this.renderer.camera;
    const probe = point.clone().setY(point.y + 0.25);
    if (type === 'frag') {
      this.blast('frag', point, owner, t('grenade.frag'));
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
    if (!p.alive || this.simTime < this.reviveShieldUntil) return false;
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
    if (killed) this.goDown(cause, source);
    return killed;
  }

  /** Health gone: down on the ground until revived, bled out or given up. */
  private goDown(cause: DamageCause, source?: DamageSource): void {
    this.buildMode = false;
    this.playerDowned = true;
    this.downTime = 0;
    this.giveUpHold = 0;
    this.downCause = cause;
    this.downSource = source;
    this.weapons.adsBlend = 0;
    this.weapons.state.cancelReload();
    this.medkitUse = this.healLeft = 0;
    this.reviveOf = null;
    this.reviveProgress = 0;
    this.interact = null;
    this.playerBoxes.setEnabled(false);
    this.killedBy = source && source.id !== PLAYER_ID ? source.name : null;
    // Kills by others are reported by whoever made them; self-inflicted ones here.
    if (!this.killedBy) {
      const weapon = cause === 'explosion' ? t('grenade.frag') : cause === 'fall' ? '↓' : '';
      this.hud.addKill({ attacker: 'You', victim: 'You', weapon, headshot: false });
    }
  }

  private stepDowned(dt: number, holdingGiveUp: boolean): void {
    this.downTime += dt;
    this.giveUpHold = holdingGiveUp ? this.giveUpHold + dt : 0;
    if (this.giveUpHold >= DOWN.giveUpHold || this.downTime >= DOWN.bleedOut) this.die(this.downCause, this.downSource);
  }

  /** A bot got the player back up. */
  private revivePlayer(by: string, health: number): void {
    if (!this.playerDowned) return;
    this.playerDowned = false;
    this.player.health.value = health;
    this.playerBoxes.setEnabled(true);
    this.reviveShieldUntil = this.simTime + DOWN.reviveShield;
    this.killedBy = null;
    this.weapons.drawTimer = DRAW_TIME;
    this.hud.notify(`${t('notify.revived')} — ${by}`, 'ally');
    this.audio.revived();
  }

  /** Dead for good (bled out or gave up): tickets, deploy screen. */
  private die(cause: DamageCause, source?: DamageSource): void {
    void source;
    this.playerDowned = false;
    // The time spent down already counts toward the respawn wait.
    this.respawnTimer = Math.max(0, RESPAWN_SEC - this.downTime);
    this.weapons.adsBlend = 0;
    if (this.deployFlow) {
      this.deployed = false;
      this.deployAt = this.elapsed + DEATH_CAM_SEC * 0.5;
    }
    this.playerBoxes.setEnabled(false);
    this.bus.emit('player:died', { cause });
    this.bus.emit('combatant:died', { team: PLAYER_TEAM, id: PLAYER_ID });
  }

  // ---------------------------------------------------------------------------
  // Medkits, reviving and handing out kits

  private get medkitReady(): boolean {
    return this.cls === 'medic' ? this.simTime >= this.medkitReadyAt : this.medkits > 0;
  }

  /** Q: patch up to full health over a second (the weapon comes down meanwhile). */
  private useMedkit(): void {
    if (!this.medkitReady || this.medkitUse > 0 || this.player.health.value >= 100) return;
    if (this.cls === 'medic') this.medkitReadyAt = this.simTime + MEDKIT.medicCooldown;
    else this.medkits--;
    this.medkitUse = MEDKIT.useTime;
    this.healLeft = MEDKIT.healTime;
    this.weapons.state.cancelReload();
    this.audio.medkit();
  }

  private stepMedkit(dt: number): void {
    if (this.medkitUse > 0) this.medkitUse = Math.max(0, this.medkitUse - dt);
    if (this.healLeft > 0) {
      const h = this.player.health;
      h.value = Math.min(100, h.value + (100 / MEDKIT.healTime) * dt);
      this.healLeft = Math.max(0, this.healLeft - dt);
    }
  }

  private giveOk(key: string): boolean {
    return (this.giveReady.get(key) ?? -Infinity) <= this.simTime;
  }

  /**
   * E near a teammate: hold to revive a downed one, tap to hand a medic's kit
   * to one who has none. Picks the nearest thing to do.
   */
  private stepInteract(dt: number, input: InputState): void {
    this.interact = null;
    const prevWork = this.working;
    this.working = -1;
    const bots = this.bots;
    if (!bots) return;
    const feet = this.player.feet;
    let revive: Bot | null = null;
    let reviveD = REVIVE_RANGE;
    let give: Bot | null = null;
    let giveD = GIVE_RANGE;
    for (const b of bots.bots) {
      if (b.team !== PLAYER_TEAM) continue;
      const d = b.feet.distanceTo(feet);
      if (b.downed && d < reviveD) {
        revive = b;
        reviveD = d;
      } else if (this.cls === 'medic' && b.alive && b.medkits === 0 && d < giveD && this.giveOk(`${PLAYER_ID}>${b.id}:kit`)) {
        give = b;
        giveD = d;
      }
    }
    if (revive) {
      this.interact = { kind: 'revive', bot: revive };
      if (!input.interact || revive !== this.reviveOf) {
        this.reviveOf = input.interact ? revive : null;
        this.reviveProgress = 0;
        if (!input.interact) return;
      }
      this.reviveProgress += dt;
      if (this.reviveProgress >= CLASSES[this.cls].reviveTime) {
        bots.revivedByPlayer(revive, CLASSES[this.cls].reviveHealth, this.playerCombatant.name, this.cls === 'medic');
        this.hud.notify(`${t('notify.revivedMate')} — ${revive.name}`, 'ally');
        this.audio.revived();
        this.reviveOf = null;
        this.reviveProgress = 0;
      }
      return;
    }
    this.reviveOf = null;
    this.reviveProgress = 0;
    if (give) {
      this.interact = { kind: 'medkit', bot: give };
      if (input.interactPressed) {
        give.medkits = MEDKIT.carried;
        this.giveReady.set(`${PLAYER_ID}>${give.id}:kit`, this.simTime + MEDKIT.giveCooldown);
        this.scores.resupply(PLAYER_ID);
        this.audio.resupply();
      }
      return;
    }
    this.stepFort(dt, input, prevWork);
  }

  /**
   * At a zone station: tap E to take ammo / a medkit (zone owners only, uses
   * run out), or hold it to refill (supports: ammo, medics: medical). Building
   * is done in build mode (T): aim at a spot and hold the trigger (hammer out,
   * progress stays when you let go).
   */
  private stepFort(dt: number, input: InputState, prevWork: number): void {
    const fort = this.fort;
    this.buildTarget = null;
    if (!fort) return;
    if (this.buildMode) {
      const { eye, fwd } = this.weapons.aimBasis(this.player);
      const target = fort.aimAt(eye, fwd);
      this.buildTarget = target;
      if (target && input.fire) {
        this.hammerAt({ type: 'build', slot: target }, dt, prevWork);
        return;
      }
    }
    const feet = this.player.feet;
    const station = fort.stationAt(feet);
    let job: FortJob | null = null;
    let note: string | null = null;
    if (station) {
      const owned = this.zoneMode?.zone(station.zone)?.owner === PLAYER_TEAM;
      const need =
        station.kind === 'ammo'
          ? this.weapons.needsAmmo || this.grenades.count < GRENADE_COUNT[this.grenades.selected] || (!!this.gadget && this.gadgetCount < GADGETS[this.gadget].count)
          : this.cls !== 'medic' && this.medkits === 0;
      if (!owned) note = t('fort.notOwned');
      else if (need && station.uses > 0) job = { type: 'use', station };
      else if (canRefill(station.kind, this.cls) && station.uses < STATION.uses) job = { type: 'refill', station };
      else if (need) note = t(station.kind === 'ammo' ? 'fort.emptyAmmo' : 'fort.emptyMedical');
    }
    if (!station) return;
    this.interact = { kind: 'fort', job, station, note };
    if (!job) return;
    if (job.type === 'use') {
      if (!input.interactPressed || !fort.use(job.station)) return;
      if (job.station.kind === 'ammo') {
        this.weapons.refillReserve();
        this.grenades.reset(this.grenades.selected);
        if (this.gadget) this.gadgetCount = GADGETS[this.gadget].count;
      } else {
        this.medkits = MEDKIT.carried;
      }
      this.audio.resupply();
      return;
    }
    if (!input.interact) return;
    this.hammerAt(job, dt, prevWork);
  }

  /** One step of hands-on work: building a spot or restocking a station. */
  private hammerAt(job: FortJob, dt: number, prevWork: number): void {
    const fort = this.fort!;
    this.working = Math.max(0, prevWork) + dt;
    this.weapons.state.cancelReload();
    if (job.type === 'use') return;
    if (job.type === 'refill') {
      if (fort.refill(job.station, dt)) {
        this.scores.award(PLAYER_ID, REFILL_POINTS);
        this.audio.resupply();
      }
    } else {
      const r = fort.work(job.slot, dt, this.cls, (s) => this.inTheWay(s));
      this.scores.award(PLAYER_ID, r.points);
      if (r.done) {
        this.hud.notify(`${t(`fort.${job.slot.kind}` as MessageKey)} ${t('fort.built')}`, 'ally');
        this.audio.resupply();
      }
    }
    // A blow about twice a second, in time with the viewmodel's strike.
    if (this.working >= this.nextBlow || prevWork < 0) {
      if (prevWork < 0) this.nextBlow = 0.32;
      else {
        this.nextBlow += 1 / 2.1;
        const k = job.type === 'build' ? job.slot.kind : null;
        const kind = k === 'hedgehog' || k === 'wire' ? 'metal' : k === 'timber' || k === 'barricade' || !k ? 'wood' : 'bag';
        this.audio.hammer(kind);
      }
    }
  }

  /** Medic and support bots next to the player hand over a medkit or ammo when it's needed. */
  private botsResupplyPlayer(): void {
    const bots = this.bots;
    if (!bots || !this.player.alive || !this.deployed) return;
    const feet = this.player.feet;
    const needKit = this.cls !== 'medic' && this.medkits === 0;
    const needAmmo = this.weapons.needsAmmo;
    if (!needKit && !needAmmo) return;
    for (const b of bots.bots) {
      if (b.team !== PLAYER_TEAM || !b.alive || b.target || b.feet.distanceTo(feet) > GIVE_RANGE) continue;
      if (needKit && b.cls === 'medic' && this.giveOk(`${b.id}>${PLAYER_ID}:kit`)) {
        this.medkits = MEDKIT.carried;
        this.giveReady.set(`${b.id}>${PLAYER_ID}:kit`, this.simTime + MEDKIT.giveCooldown);
        this.scores.resupply(b.id);
        this.hud.notify(`${t('notify.gotMedkit')} — ${b.name}`, 'ally');
        this.audio.resupply();
        return;
      }
      if (needAmmo && b.cls === 'support' && this.giveOk(`${b.id}>${PLAYER_ID}:ammo`)) {
        this.weapons.refillReserve();
        this.giveReady.set(`${b.id}>${PLAYER_ID}:ammo`, this.simTime + AMMO_GIVE_COOLDOWN);
        this.scores.resupply(b.id);
        this.hud.notify(`${t('notify.gotAmmo')} — ${b.name}`, 'ally');
        this.audio.resupply();
        return;
      }
    }
  }

  private respawn(key = 'base'): void {
    this.buildMode = false;

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
    // The loadout picked on the deploy screen takes effect now.
    const kit = this.loadouts.current;
    this.cls = kit.cls;
    this.reconZoom = false;
    if (this.options.sandbox) this.weapons.resetAmmo();
    else this.weapons.setLoadout(loadoutWeapons(kit), kit.cls === 'support');
    this.grenades.reset(kit.grenade);
    this.gadget = classGadget(kit.cls, kit.reconGadget);
    this.gadgetCount = this.gadget ? GADGETS[this.gadget].count : 0;
    this.gadgetOut = false;
    this.gadgetBusy = 0;
    this.playerDowned = false;
    this.downTime = 0;
    this.medkits = MEDKIT.carried;
    this.medkitReadyAt = 0;
    this.medkitUse = this.healLeft = 0;
    this.reviveOf = null;
    this.reviveProgress = 0;
    this.hud.clearDamage();
    this.touch?.reset();
    this.flashLeft = 0;
    this.breath = createBreath();
    this.weapons.sway.pitch = this.weapons.sway.yaw = 0;
    this.bus.emit('player:respawned', {});
  }

  private updateCamera(alpha: number, dt: number, adsFov: number): void {
    const cam = this.renderer.camera;
    const p = this.player;
    const w = this.weapons;
    p.eyePosition(alpha, dt, this.tmpEye);
    // Death cam: slump to the ground and roll; down: on the ground, head up a little.
    const gone = !p.alive && !this.playerDowned;
    this.deathBlend += ((p.alive ? 0 : gone ? 1 : 0.7) - this.deathBlend) * (1 - Math.exp(-4 * dt));
    this.tmpEye.y -= this.deathBlend * (p.eyeHeight - 0.35);
    cam.position.copy(this.tmpEye);

    this.shake *= Math.exp(-7 * dt);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    // Scope sway (breath.ts) is part of the aim, so the view follows it too.
    cam.rotation.set(p.pitch + w.recoil.pitch + w.sway.pitch + sx, p.yaw + w.recoil.yaw + w.sway.yaw + sy, this.deathBlend * (gone ? 0.7 : 0.25), 'YXZ');
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

  /** Vertical FOV while fully aimed (before the user's FOV scaling): recon scopes can zoom further. */
  private aimFov(): number {
    const def = this.weapons.def;
    return this.cls === 'recon' && def.scope && this.reconZoom ? zoomedFov(def.adsFov, RECON_ZOOM) : def.adsFov;
  }

  private updateViewModel(dt: number, lookYaw: number, lookPitch: number): void {
    const w = this.weapons;
    const p = this.player;
    const k = 1 - Math.exp(-9 * dt);
    const rate = 1 / Math.max(dt, 1e-3);
    const walk = p.horizontalSpeed() * (p.grounded ? 1 : 0.3);
    const tx = THREE.MathUtils.clamp(lookYaw * rate * 0.06, -0.28, 0.28) + Math.sin(this.elapsed * 7.5) * walk * 0.012;
    const ty = THREE.MathUtils.clamp(-lookPitch * rate * 0.06, -0.28, 0.28) + Math.abs(Math.cos(this.elapsed * 7.5)) * walk * 0.014 + Math.cos(this.elapsed * 0.7) * 0.02;
    this.scopeShift.x += (tx - this.scopeShift.x) * k;
    this.scopeShift.y += (ty - this.scopeShift.y) * k;
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
      // Scoped in, or down on the ground: no gun on screen.
      hideForScope: (!!w.def.scope && w.adsBlend > 0.95) || this.playerDowned,
      meleeT: w.meleeProgress,
      inspectT: w.inspectProgress,
      tool: this.working,
      toolIdle: this.buildMode && p.alive && this.deployed,
      gadget: this.gadgetOut && p.alive && this.deployed ? this.gadget : null,
      gadgetUsed: this.simTime - this.gadgetUsedAt,
      gadgetLeft: this.gadgetCount,
    });
    this.fort?.render(this.renderer.camera.position, this.buildMode, this.buildTarget);

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
    this.touch?.setGrenade(t(`grenade.${sel}` as MessageKey), this.grenades.count);
    this.touch?.setAmmo(s.ammo, w.def.magSize, s.reloading);
    const onField = this.player.alive && this.deployed;
    const kitText = this.cls === 'medic' ? (this.medkitReady ? '∞' : `${Math.ceil(this.medkitReadyAt - this.simTime)}s`) : String(this.medkits);
    const medkit = onField ? { text: kitText, ready: this.medkitReady } : null;
    const reviver = this.playerDowned ? (this.bots?.reviverFor(this.playerCombatant) ?? null) : null;
    const down = this.playerDowned
      ? {
          left: Math.max(0, DOWN.bleedOut - this.downTime),
          giveUp: Math.min(1, this.giveUpHold / DOWN.giveUpHold),
          reviver: reviver?.reviving ? reviver.name : null,
          revive: reviver ? Math.min(1, reviver.reviveProgress / CLASSES[reviver.cls].reviveTime) : 0,
        }
      : null;
    const act = onField ? this.interact : null;
    const key = (hold: boolean) => (this.touch ? '' : `${t(hold ? 'act.holdE' : 'act.pressE')} · `);
    let prompt: { text: string; progress: number | null } | null = null;
    let touchLabel: string | null = null;
    if (act?.kind === 'revive') {
      prompt = { text: `${key(true)}${t('act.revive')} ${act.bot.name}`, progress: this.reviveProgress > 0 ? this.reviveProgress / CLASSES[this.cls].reviveTime : null };
      touchLabel = t('act.revive');
    } else if (act?.kind === 'medkit') {
      prompt = { text: `${key(false)}${t('act.giveMedkit')} → ${act.bot.name}`, progress: null };
      touchLabel = t('act.giveMedkit');
    } else if (act?.kind === 'fort') {
      ({ prompt, touchLabel } = this.fortPrompt(act.job, act.station, act.note, key));
    }
    const nearSpot = onField && !!this.fort?.anyNear(this.player.feet, 12);
    if (onField && this.buildMode) {
      const tgt = this.buildTarget;
      const exit = t(this.touch ? 'build.exitTouch' : 'build.exit');
      prompt = tgt
        ? { text: `${t('build.mode')} · ${t(`fort.${tgt.kind}` as MessageKey)} — ${t(this.touch ? 'build.holdTouch' : 'build.hold')} · ${exit}`, progress: tgt.work > 0 ? tgt.work / FORT[tgt.kind].build : null }
        : { text: `${t('build.mode')} — ${t('build.aim')} · ${exit}`, progress: null };
    } else if (onField && this.gadgetOut && this.gadget) {
      const g = this.gadget;
      prompt =
        g === 'panzerfaust' && this.gadgetBusy > 0 && this.gadgetCount > 0
          ? { text: `${t(`gadgetName.${g}`)} — ${t('gadget.reloading')}`, progress: 1 - this.gadgetBusy / GADGETS[g].cycle }
          : {
              text: `${t(`gadgetName.${g}`)} — ${t(this.touch ? 'gadget.fireTouch' : 'gadget.fire')}: ${t(`gadgetUse.${g}`)} · ${t(this.touch ? 'gadget.exitTouch' : 'gadget.exit')}`,
              progress: null,
            };
    } else if (!prompt && nearSpot && !this.touch && this.fort!.anyNear(this.player.feet, 6)) {
      prompt = { text: t('build.enter'), progress: null };
    }
    this.touch?.setContext({
      medkit: medkit ? (medkit.ready ? `${t('touch.medkit')} ${kitText}` : kitText) : null,
      interact: touchLabel,
      downed: this.playerDowned,
      build: onField && this.buildMode ? 'on' : nearSpot ? 'near' : null,
      gadget: onField && this.gadget ? { label: `${t(`gadgetShort.${this.gadget}`)} ${this.gadgetCount}`, out: this.gadgetOut, empty: this.gadgetCount === 0 } : null,
      scoped: onField && !!w.def.scope && w.adsBlend > 0.5,

    });
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
        scope: w.def.scope
          ? (() => {
              const o = opticFor(w.def);
              return { reticle: o.reticle, color: o.color, shiftX: this.scopeShift.x, shiftY: this.scopeShift.y };
            })()
          : null,
        breath:
          w.def.scope && w.adsBlend > 0.9 && this.player.alive && !this.playerDowned
            ? { air: this.breath.air / BREATH.air, holding: this.breath.holding, locked: this.breath.locked, hint: t(this.touch ? 'breath.hintTouch' : 'breath.hint') }
            : null,
        dark: this.player.alive ? this.breath.dark : 0,
        grenadeLabel: t(`grenade.${sel}` as MessageKey),
        grenadeCount: this.grenades.count,
        gadget:
          this.gadget && this.deployed
            ? { key: this.touch ? '' : '4 · ', label: t(`gadgetName.${this.gadget}`), count: this.gadgetCount, out: this.gadgetOut }
            : null,
        flash,
        respawnIn: this.player.alive || this.playerDowned ? null : Math.max(0, this.respawnTimer),
        medkit,
        down,
        prompt,
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

  /** Someone (up or down) is standing where a build spot's structure would go. */
  private inTheWay(slot: FortSlot): boolean {
    const fort = this.fort;
    if (!fort) return false;
    if (this.player.alive && fort.occupies(slot, this.player.feet)) return true;
    for (const b of this.bots?.bots ?? []) if ((b.alive || b.downed) && fort.occupies(slot, b.feet)) return true;
    return false;
  }

  /** HUD prompt and touch button label at a station or build spot. */
  private fortPrompt(job: FortJob | null, station: Station | null, note: string | null, key: (hold: boolean) => string): { prompt: { text: string; progress: number | null }; touchLabel: string | null } {
    if (station) {
      const name = `${t(station.kind === 'ammo' ? 'fort.ammo' : 'fort.medical')} ${station.uses}/${STATION.uses}`;
      if (job?.type === 'use') return { prompt: { text: `${key(false)}${t(station.kind === 'ammo' ? 'act.takeAmmo' : 'act.takeMedkit')} · ${name}`, progress: null }, touchLabel: t('act.take') };
      if (job?.type === 'refill') return { prompt: { text: `${key(true)}${t('act.refill')} · ${name}`, progress: this.working >= 0 ? station.refill / STATION.refillSec : null }, touchLabel: t('act.refill') };
      return { prompt: { text: note ? `${name} · ${note}` : name, progress: null }, touchLabel: null };
    }
    if (job?.type === 'build') {
      const s = job.slot;
      const full = FORT[s.kind].build;
      return { prompt: { text: `${key(true)}${t('act.build')} · ${t(`fort.${s.kind}` as MessageKey)}`, progress: s.work > 0 ? s.work / full : null }, touchLabel: t('act.build') };
    }
    return { prompt: { text: note ?? '', progress: null }, touchLabel: null };
  }

  /** Supply stations and build spots at every zone, found on the loaded world. */
  private setupFortifications(map: MapDef, terrain: Terrain, water: WaterMap | null, built: BuiltMap): void {
    const t0 = performance.now();
    this.physics.step();
    const probe = worldProbe(
      this.physics,
      (x, z) => terrain.heightAt(x, z),
      (x, z) => terrain.boundary.contains(x, z) && terrain.boundary.edgeDistance(x, z) > 3,
      (x, y, z) => !!water && water.depthAt(x, y, z) > 0.05,
    );
    const plan = planFortifications(map.zones ?? [], built.windows, built.footprints, probe);
    const fort = new Fortifications(plan, new FortModels(this.surfaces), this.physics, this.impacts, this.nav);
    fort.onChange = () => this.renderer.requestShadowUpdate();
    fort.onPoints = (id, points) => this.scores.award(id, points);
    this.renderer.scene.add(fort.group);
    // Bake the stations into the navmesh now rather than over the first frames.
    this.nav?.update(4096);
    this.fort = fort;
    if (this.bots) {
      this.bots.fort = fort;
      this.bots.fortBlocked = (s) => this.inTheWay(s);
      this.bots.zoneOwner = (id) => this.zoneMode?.zone(id)?.owner ?? null;
    }
    if (import.meta.env.DEV) {
      const kinds = new Map<string, number>();
      for (const s of plan.slots) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
      const list = [...kinds].map(([k, v]) => `${k} ${v}`).join(', ');
      console.info(`[strikegy] fortifications: ${plan.stations.length} stations, ${plan.slots.length} build spots (${list}) in ${Math.round(performance.now() - t0)} ms`);

    }
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
      revivePlayer: (by, health) => this.revivePlayer(by.name, health),
    };
    this.bus.on('combatant:resupplied', (e) => this.scores.resupply(e.byId));
    // Revives: points to the reviver, a line in the feed for the player's side.
    this.bus.on('combatant:revived', (e) => {
      this.scores.revive(e.byId, e.medic);
      if (e.team === PLAYER_TEAM && e.byId !== PLAYER_ID && e.id !== PLAYER_ID) {
        this.hud.addKill({ attacker: e.byName, victim: e.name, weapon: `✚ ${t('feed.revived')}`, headshot: false, attackerTeam: e.team, victimTeam: e.team });
      }
    });
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
    if (!this.options.sandbox) this.loadoutPanel = new LoadoutPanel(this.deployScreen.sideTop, this.deployScreen.mapBox, this.loadouts, () => {});
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
    this.loadoutPanel?.close();
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
    if (kind === 'beacon') {
      const b = this.gadgets.beaconsFor(team, this.squadKeyOf(team, selfId)).find((x) => String(x.id) === id);
      if (b) {
        this.gadgets.useBeacon(b);
        const pos = this.nav?.randomAround(b.pos, 1.5) ?? b.pos.clone();
        return { pos, yaw: b.mesh.rotation.y };
      }
    }
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
    for (const b of this.gadgets.beaconsFor(bot.team, this.squadKeyOf(bot.team, bot.id))) cands.push({ key: `beacon:${b.id}`, x: b.pos.x, z: b.pos.z });
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
    // Spawn beacons the squad's recons put down.
    for (const b of this.gadgets.beaconsFor(PLAYER_TEAM, this.squadKeyOf(PLAYER_TEAM, PLAYER_ID))) {
      const who = b.owner.id === PLAYER_ID ? t('feed.you') : b.owner.name;
      out.push({ key: `beacon:${b.id}`, kind: 'beacon', label: `${t('spawn.beacon')} (${who}) ×${b.uses}`, x: b.pos.x, z: b.pos.z, blocked: null, warn: null });
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
        blocked: block === 'dead' ? t('deploy.dead') : block === 'down' ? t('deploy.down') : block === 'combat' ? t('deploy.combat') : null,
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
        state:
          m.id === PLAYER_ID
            ? this.player.alive
              ? this.deployed && m.inCombat(now)
                ? 'combat'
                : 'ok'
              : this.playerDowned
                ? 'down'
                : 'dead'
            : !m.alive
              ? m.downed
                ? 'down'
                : 'dead'
              : m.inCombat(now)
                ? 'combat'
                : 'ok',
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
      grenades: { type: this.grenades.type, count: this.grenades.count },
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
