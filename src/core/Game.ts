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
import { BACKDROP_MODELS, buildBackdrop, cullBackdropDetail } from '@/world/backdrop';
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
import { HitboxRegistry, computeDamage, type DamageSource, type Damageable } from '@/combat/Hitboxes';
import { CharacterHitboxes } from '@/combat/CharacterHitboxes';
import { NavWorld } from '@/ai/NavWorld';
import { BotManager, HEAR_STEP, HEAR_STEP_SPRINT, type BotOptions } from '@/ai/BotManager';
import { PLAYER_ID, PLAYER_TEAM, otherTeam, type Combatant } from '@/ai/types';
import { TargetDummy } from '@/combat/TargetDummy';
import { BLASTS, GRENADES, flashDuration, flashIntensity, fragDamage, type BlastKind, type GrenadeType } from '@/combat/explosions';
import { GADGETS, PANZERFAUST_TOSS, PLACE_REACH, ROCKET, classGadget, type GadgetId } from '@/data/gadgets';
import { GadgetWorld, type GadgetOwner, type MineWalker } from '@/modes/gadgetWorld';
import { SupportWorld } from '@/modes/supportWorld';
import { VehicleWorld, flatSpot, planVehicleSpots, type Walker } from '@/vehicles/VehicleWorld';
import type { DriveInput, Vehicle } from '@/vehicles/Vehicle';
import { SoldierModel } from '@/ai/SoldierModel';
import { wishDirection } from '@/player/movement';
import { AIRSPACE, JET_KINDS, TANK_KINDS, VEHICLE_GUNS, type VehicleGunId, type VehicleKind } from '@/vehicles/vehicleData';
import { Vehicle as VehicleClass } from '@/vehicles/Vehicle';
import { CALL_RANGE, SUPPORT, SUPPORT_ORDER, squadRp, type SupportId } from '@/data/support';
import { SupportMenu, type SupportMenuState } from '@/ui/SupportMenu';
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
  /** Squad call-ins (B): barrages, recon planes, supply drops; the menu and the call being aimed. */
  private support!: SupportWorld;
  private supportMenu!: SupportMenu;
  private supportAim: SupportId | null = null;
  private supportPoint: THREE.Vector3 | null = null;
  private supportRing: THREE.Mesh | null = null;
  /** Vehicles (bot matches with zones): pads, bikes, and the seat the player is in. */
  private vehicles: VehicleWorld | null = null;
  private ride: { v: Vehicle; seat: number } | null = null;
  private readonly driveInputs = new Map<number, DriveInput>();
  /** Vehicle third-person camera distance, eased (pulled in by walls). */
  private rideCamDist = 6;
  /** Vehicle view: first person by default, C switches to third person. */
  private rideThird = false;
  /** When fullscreen was last asked for (phones; see `enterFullscreen`). */
  private fullscreenAskedAt = -Infinity;
  /** Scenery outside the map (its clutter is culled by distance each frame). */
  private backdrop: THREE.Group | null = null;
  /** Under a parachute after bailing out of a plane (the canopy model), or null. */
  private chute: THREE.Group | null = null;
  private readonly chuteVel = new THREE.Vector3();
  /** The player's own body, seen from the driver's third-person view. */
  private rider: SoldierModel | null = null;
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
      // Dropped out of fullscreen mid-match: the next lift of a finger asks again
      // (touchend counts as a tap for that; capture, since buttons stop it there).
      this.touch.root.addEventListener(
        'touchend',
        () => {
          if (this.deployed && this.running && !this.matchOver && performance.now() - this.fullscreenAskedAt > 4000) this.enterFullscreen();
        },
        { capture: true, passive: true },
      );
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
    if (kit) this.backdrop = buildBackdrop(r.scene, terrain, { lowDetail: q.backdropDetail === 'low', gl: r.gl, models: this.models, msaa: q.msaa, mapHasTerrain: shaped, kit, winter, phone: r.preset === 'low' });
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
      shell: (gun, point, owner, target, part) => this.shellHit(gun, point, owner, target, part),
    });
    r.scene.add(this.gadgets.group);
    this.support = new SupportWorld(this.physics, {
      shell: (kind, point, owner) => this.blast(kind, point, owner, t(`support.${kind}`)),
      smoke: (point) => {
        this.effects.smoke(point, GRENADES.smoke.duration ?? 20, GRENADES.smoke.radius * 1.3);
        this.audio.smokePop(point, GRENADES.smoke.duration ?? 20);
      },
      incoming: (point) => this.audio.incoming(point),
      reveal: (team, center, radius) => this.bots?.reveal(team, center, radius),
      resupply: (team, pos, reach) => this.crateResupply(team, pos, reach),
      landed: (pos) => this.audio.gadget('place', pos),
      vehicle: (owner, near) => this.callRocketTank(owner, near),
    });
    r.scene.add(this.support.group);
    this.supportMenu = new SupportMenu(this.hud.root, (id) => this.pickSupport(id));
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
      if (this.bots && !this.options.sandbox) this.setupVehicles(map);
    }
    if (this.bots) {
      this.setupSquads(map, terrain);
      const support = this.support;
      this.bots.support = {
        rp: (bot) => {
          const sq = this.squads.find((s) => s.has(bot.id));
          return sq ? this.squadRpOf(sq) : 0;
        },
        cooldown: (team, kind) => support.cooldown(team, kind),
        call: (kind, point, bot) => {
          const sq = this.squads.find((s) => s.has(bot.id));
          if (!sq) return false;
          const owner: GadgetOwner = { id: bot.id, name: bot.name, team: bot.team, squad: `${sq.team}:${sq.name}` };
          // The player's side sees the marker on its own team's calls.
          return support.request(kind, point, owner, this.squadRpOf(sq), bot.team === PLAYER_TEAM);
        },
        dangers: () => support.dangers(),
      };
    }
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
    if (this.backdrop) cullBackdropDetail(this.backdrop, cam.position);

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
      this.bots?.alert(e.point, e.sprinting ? HEAR_STEP_SPRINT : HEAR_STEP, this.playerCombatant, 'step');
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
      this.enterFullscreen();
      this.openDeploy();
      return;
    }
    if (this.touch) {
      this.touch.setVisible(true);
      this.enterFullscreen();
    } else {
      this.kbm.requestLock();
    }
    this.running = true;
    this.started = true;
    this.loop.reset();
    this.overlay.hide();
  }

  /**
   * Phones: fullscreen, locked to landscape. Only works from a tap (user
   * activation), so it is asked on the start / deploy taps and again on a
   * touch when the browser has dropped out of it (back gesture, app switch).
   * iPhone Safari has no requestFullscreen for pages: then it does nothing.
   */
  private enterFullscreen(): void {
    if (!this.touch || document.fullscreenElement) return;
    this.fullscreenAskedAt = performance.now();
    try {
      document.documentElement
        .requestFullscreen?.()
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => {});
    } catch {
      // Some browsers throw instead of rejecting outside a tap.
    }
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
      this.vehicles?.render(alpha);
      this.renderRider(alpha, dt);
      if (this.chute) {
        const p = this.player;
        this.chute.position.lerpVectors(p.prevFeet, p.feet, alpha);
        this.chute.rotation.y = p.yaw;
      }
      this.updateCamera(alpha, dt, adsFov);
    }
    input.lookYaw = 0;
    input.lookPitch = 0;

    for (const tg of this.targets) tg.update(simDt);
    this.bots?.render(this.lastAlpha, dt, this.renderer.camera);
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
    this.driveInputs.clear();
    if (p.alive && this.deployed && this.ride) {
      this.stepRide(dt, input);
    } else if (p.alive && this.deployed && this.chute) {
      this.stepChute(dt, input);
    } else if (p.alive && this.deployed) {
      // Recon: the wheel (touch: swap) changes scope power while aiming instead of weapons.
      const w = this.weapons;
      if (this.cls === 'recon' && w.def.scope && w.adsBlend > 0.5 && input.weaponCycle !== 0) {
        this.reconZoom = !this.reconZoom;
        input.weaponCycle = 0;
      }
      // Barbed wire slows everyone wading through it.
      p.speedBonus = moveBonus(this.cls, w.def) * (this.fort?.slowAt(p.feet) ?? 1);
      // Call-in menu first: while it is open, 1..5 pick a call-in (not weapons or the gadget).
      this.stepSupport(input);
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
      if (!this.interact && input.interactPressed && this.tryEnterVehicle()) return this.finishStep(dt, input);
      if (input.throwGrenade && this.throwCooldown === 0 && !p.sprinting) this.throwGrenade();
      const firing = input.fire;
      // Pulling the trigger, aiming or swinging ends a sprint immediately.
      if (input.fire || input.ads || input.melee) {
        input.sprint = false;
        p.sprinting = false;
      }
      // Hands busy (throwing, patching up, reviving): no shooting.
      const busy = this.throwBlock > 0 || this.medkitUse > 0 || this.reviveProgress > 0 || this.working >= 0 || this.buildMode || this.gadgetOut || this.supportAim !== null;
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
    this.finishStep(dt, input);
  }

  /** The rest of a sim step, after the player's own part: everyone else, then physics. */
  private finishStep(dt: number, input: InputState): void {
    const p = this.player;
    this.playerBoxes.sync(p.feet, p.yaw, p.bodyHeight);
    this.bots?.step(dt);
    this.fort?.step();
    this.botsResupplyPlayer();
    this.zoneMode?.step(dt, this.combatants());
    this.throwables.step(dt);
    this.gadgets.step(dt, this.mineWalkers());
    this.support.step(dt);
    this.botTanks();
    this.botJets();
    this.seatPending();
    this.vehicles?.step(dt, this.driveInputs, this.vehicleWalkers());
    this.physics.step();
    this.vehicles?.afterStep();
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

  // ---------------------------------------------------------------------------
  // Vehicles

  /** Pads at both bases and motorbikes around the zones (bot matches with zones). */
  private setupVehicles(map: MapDef): void {
    const bases: { team: Team; pos: THREE.Vector3; facing: number }[] = [];
    for (const team of ['blue', 'red'] as const) {
      const sp = map.spawns.filter((s) => s.team === team || (team === PLAYER_TEAM && s.team === 'player'));
      if (!sp.length) continue;
      const pos = sp.reduce((a, s) => a.add(new THREE.Vector3(...s.pos)), new THREE.Vector3()).divideScalar(sp.length);
      bases.push({ team, pos, facing: sp[0]!.yaw * DEG });
    }
    const zones = (map.zones ?? []).map((z) => ({ id: z.id, pos: new THREE.Vector3(...z.pos), radius: z.radius }));
    const { pads, bikes, tankSpots } = planVehicleSpots(this.physics, bases, zones);
    if (zones.length) VehicleClass.airCenter.copy(zones.reduce((a, z) => a.add(z.pos), new THREE.Vector3()).divideScalar(zones.length));
    VehicleClass.airRadius = Math.max(map.world.size[0], map.world.size[1]) / 2;
    this.vehicles = new VehicleWorld(
      this.physics,
      this.registry,
      {
        destroyed: (v, by) => this.vehicleDestroyed(v, by),
        roadkill: (v, victim) => this.roadkill(v, victim),
      },
      pads,
      bikes,
      this.bots?.bots.length ?? 0,
      tankSpots,
    );
    this.renderer.scene.add(this.vehicles.group);
    if (this.bots) {
      const bots = this.bots;
      bots.vehicles = this.vehicles;
      bots.driveInputs = this.driveInputs;
      bots.playerRiding = () => !!this.ride;
      bots.fireMount = (v, seat, shooter, aim, alt) => this.fireMount(v, seat, shooter, aim, alt);
    }
    if (import.meta.env.DEV) console.info(`[strikegy] vehicles: ${pads.length} pads, ${bikes.length} bike spots`);
  }

  /**
   * Bots take tanks as well: every few seconds, a side under its tank limit
   * gets one for a bot that has just come back at its base (driver; mates
   * board it like any vehicle).
   */
  private botTanks(): void {
    const vw = this.vehicles;
    const bots = this.bots;
    if (!vw || !bots || this.simTime < this.botTankAt) return;
    this.botTankAt = this.simTime + 6;
    for (const team of ['blue', 'red'] as const) {
      if (vw.tanks(team) >= vw.tankLimit() || Math.random() < 0.5) continue;
      const spot = vw.freeTankSpot(team);
      if (!spot) continue;
      const bot = bots.bots.find((b) => b.team === team && b.alive && !b.riding && b.feet.distanceTo(spot.pos) < 40 && !b.inCombat(bots.time));
      if (!bot) continue;
      const kind = TANK_KINDS[Math.floor(Math.random() * TANK_KINDS.length)]!;
      const v = vw.spawnTank(kind, team);
      if (v) bots.seatBot(bot, v, 0);
    }
  }
  private botTankAt = 20;

  /**
   * Rocket tank call-in: a launcher truck at the zone nearest the caller (on
   * a clear spot around it), only the caller may drive it; their side is
   * told where it is.
   */
  private callRocketTank(owner: GadgetOwner, near: THREE.Vector3): boolean {
    const vw = this.vehicles;
    const zm = this.zoneMode;
    if (!vw || !zm) return false;
    const zones = zm.zones.map((z) => ({ id: z.id, pos: new THREE.Vector3(z.x, z.y, z.z), radius: z.radius })).sort((a, b) => a.pos.distanceTo(near) - b.pos.distanceTo(near));
    for (const z of zones.slice(0, 2)) {
      for (let i = 0; i < 36; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = z.radius + 4 + Math.floor(i / 12) * 6;
        const yaw = a + Math.PI / 2;
        const p = flatSpot(this.physics, z.pos.x + Math.cos(a) * r, z.pos.z + Math.sin(a) * r, z.pos.y, 1.9, 4.2, yaw);
        if (!p || vw.vehicles.some((v) => v.pos.distanceTo(p) < 8)) continue;
        const v = vw.spawn('rocket', p, yaw, owner.team);
        v.driverOnly = owner.id;
        if (owner.team === PLAYER_TEAM) {
          const who = owner.id === PLAYER_ID ? t('feed.you') : owner.name;
          this.hud.notify(t('support.rocketArrived').replace('{zone}', z.id).replace('{who}', who), 'ally');
        }
        this.bots?.rocketTankFor(owner.id, v);
        return true;
      }
    }
    return false;
  }

  /**
   * A seat someone of `team` could deploy into: tanks and jets of that side
   * (crewed by it, or empty and its own), not wrecked, the driver's seat
   * first unless it is kept for someone else. -1 when there's none.
   */
  private freeSeatFor(v: Vehicle, team: Team, id: number): number {
    if (v.wrecked || !(TANK_KINDS.includes(v.kind) || JET_KINDS.includes(v.kind) || v.kind === 'rocket')) return -1;
    if ((v.team ?? v.home) !== team) return -1;
    return v.seats.findIndex((s, i) => !s && (i > 0 || v.driverOnly === null || v.driverOnly === id) && !this.bots?.claimedSeat(v.id, i));
  }

  /** How many seats `freeSeatFor` could hand out in `v`. */
  private freeSeatCount(v: Vehicle, team: Team, id: number): number {
    if (this.freeSeatFor(v, team, id) < 0) return 0;
    return v.seats.filter((s, i) => !s && (i > 0 || v.driverOnly === null || v.driverOnly === id) && !this.bots?.claimedSeat(v.id, i)).length;
  }

  /** Missile lock: the nearest enemy aircraft within 25° of the nose and in range. */
  private lockTarget(v: Vehicle, team: Team): Vehicle | null {
    const nose = v.velocity.lengthSq() > 1 ? v.velocity.clone().normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(v.quat);
    let best: Vehicle | null = null;
    let bestD = 1500;
    for (const o of this.vehicles?.vehicles ?? []) {
      if (o === v || !o.flight || o.wrecked || o.home === team) continue;
      const to = o.pos.clone().sub(v.pos);
      const d = to.length();
      if (d < bestD && to.normalize().dot(nose) > Math.cos(0.44)) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  /** A jet for `team` in the air off its side of the map, heading in. */
  private spawnJet(kind: VehicleKind, team: Team): Vehicle | null {
    const vw = this.vehicles;
    if (!vw) return null;
    const c = VehicleClass.airCenter;
    const base = this.baseCenter(team);
    const out = base.clone().sub(c).setY(0);
    if (out.lengthSq() < 1) out.set(0, 0, 1);
    out.normalize();
    const at = c.clone().addScaledVector(out, VehicleClass.airRadius + 200).setY(c.y + AIRSPACE.startAlt + Math.random() * 40);
    at.addScaledVector(new THREE.Vector3(-out.z, 0, out.x), (Math.random() - 0.5) * 200);
    const yaw = Math.atan2(out.x, out.z);
    return vw.spawnJet(kind, team, at, yaw);
  }

  /** Bots fly jets as well: a side under its jet limit now and then sends a bot from its base up. */
  private botJets(): void {
    const vw = this.vehicles;
    const bots = this.bots;
    if (!vw || !bots || this.simTime < this.botJetAt) return;
    this.botJetAt = this.simTime + 8;
    for (const team of ['blue', 'red'] as const) {
      if (vw.jets(team) >= vw.jetLimit() || Math.random() < 0.5) continue;
      const base = this.baseCenter(team);
      const bot = bots.bots.find((b) => b.team === team && b.alive && !b.riding && b.feet.distanceTo(base) < 50 && !b.inCombat(bots.time));
      if (!bot) continue;
      const v = this.spawnJet(JET_KINDS[Math.floor(Math.random() * JET_KINDS.length)]!, team);
      if (v) bots.seatBot(bot, v, 0);
    }
  }
  private botJetAt = 30;

  /** Bots that deployed into a vehicle seat this step (bot id -> vehicle id). */
  private readonly pendingSeats = new Map<number, number>();

  private seatPending(): void {
    for (const [botId, vid] of this.pendingSeats) {
      const bot = this.bots?.bots.find((b) => b.id === botId);
      const v = this.vehicles?.get(vid);
      const seat = v && bot ? this.freeSeatFor(v, bot.team, bot.id) : -1;
      if (bot && v && seat >= 0 && bot.alive) this.bots!.seatBot(bot, v, seat);
    }
    this.pendingSeats.clear();
  }

  /** People vehicles can run over: the player on foot and the bots. */
  private *vehicleWalkers(): Iterable<Walker> {
    if (this.player.alive && this.deployed && !this.ride) yield this.playerCombatant;
    for (const b of this.bots?.bots ?? []) if (!b.riding) yield b;
  }

  /** E next to a vehicle with a free seat: in, driver's seat first. */
  private tryEnterVehicle(): boolean {
    const v = this.vehicles?.nearest(this.player.feet);
    if (!v) return false;
    const seat = v.seats.findIndex((s, i) => !s && (i > 0 || v.driverOnly === null || v.driverOnly === PLAYER_ID));
    if (seat < 0) return false;
    this.enterSeat(v, seat);
    return true;
  }

  private enterSeat(v: Vehicle, seat: number): void {
    if (this.ride) this.ride.v.seats[this.ride.seat] = null;
    v.seats[seat] = { id: PLAYER_ID, team: PLAYER_TEAM };
    this.ride = { v, seat };
    this.gadgetOut = false;
    this.buildMode = false;
    this.supportAim = null;
    this.weapons.adsBlend = 0;
    this.playerBoxes.setEnabled(v.spec.seats[seat]!.exposed);
    // In a plane the view starts along the nose (the plane turns toward the view).
    if (v.flight && seat === 0) {
      this.player.yaw = v.flight.yaw;
      this.player.pitch = v.flight.pitch;
    }
    this.audio.gadget('place', null);
  }

  /** Out of the vehicle, on the ground beside it (or on top when boxed in). */
  private leaveVehicle(): void {
    const r = this.ride;
    if (!r) return;
    this.ride = null;
    r.v.seats[r.seat] = null;
    let spot = r.v.exitSpot(r.seat, this.physics);
    if (r.v.flight) {
      // Bailing out of a plane: high up, out under a parachute; on the ground, beside it.
      const down = this.physics.raycast(r.v.pos, new THREE.Vector3(0, -1, 0), 2000, Layer.WORLD);
      if (!down || down.distance > 12) {
        this.openChute(r.v.pos.clone().setY(r.v.pos.y - r.v.spec.half[1] - 2), r.v.velocity);
        this.playerBoxes.setEnabled(this.player.alive);
        return;
      }
      spot = new THREE.Vector3(down.point.x, down.point.y, down.point.z);
    }
    this.player.dismount(spot);
    this.playerBoxes.setEnabled(this.player.alive);
    this.weapons.drawTimer = DRAW_TIME;
  }

  /**
   * In a vehicle: E gets out, 1..n change seats, the driver drives (WASD,
   * Space brakes), the gunner aims the mounted gun with the view and fires.
   */
  private stepRide(dt: number, input: InputState): void {
    this.interact = null;
    const r = this.ride!;
    const v = r.v;
    if (v.wrecked) {
      this.leaveVehicle();
      return;
    }
    if (input.interactPressed) {
      this.leaveVehicle();
      return;
    }
    if (input.viewToggle) this.rideThird = !this.rideThird;
    const free = (i: number): boolean => !v.seats[i] && (i > 0 || v.driverOnly === null || v.driverOnly === PLAYER_ID);
    const want = input.weaponSlot;
    if (want >= 0 && want < v.seats.length && free(want)) this.enterSeat(v, want);
    else if (input.weaponCycle !== 0) {
      // The wheel (touch: the seat button): the next free seat that way round.
      const n = v.seats.length;
      const dir = Math.sign(input.weaponCycle);
      for (let k = 1; k < n; k++) {
        const i = (((r.seat + dir * k) % n) + n) % n;
        if (free(i)) {
          this.enterSeat(v, i);
          break;
        }
      }
    }
    // A seat change above replaced `this.ride`; the rest of the step is in the new seat.
    const at = this.ride!.seat;
    const seat = v.spec.seats[at]!;
    const p = this.player;
    if (seat.role === 'driver') this.driveInputs.set(v.id, { throttle: input.moveY, steer: input.moveX, brake: input.jumpHeld, aimYaw: p.yaw, aimPitch: p.pitch });
    if (seat.gun) this.stepVehicleGun(v, at, input.fire, dt);
    if (v.altMounts[at] && v.pullTrigger(at, input.ads, this.simTime, dt, true)) this.fireMount(v, at, { id: PLAYER_ID, name: t('feed.you'), team: PLAYER_TEAM }, null, true);
    const eye = v.seatEye(at, this.tmpEye);
    this.player.ride(eye, v.velocity);
  }

  /** Out of a plane at `at`: a canopy opens, drifting down from there (keeping some of the plane's speed at first). */
  private openChute(at: THREE.Vector3, carry: THREE.Vector3): void {
    if (!this.chute) {
      this.chute = buildParachute();
      this.renderer.scene.add(this.chute);
    }
    this.chute.visible = true;
    this.chuteVel.copy(carry).multiplyScalar(0.25).setY(-CHUTE.fall);
    this.player.ride(at.clone().setY(at.y + this.player.eyeHeight), this.chuteVel);
    this.audio.gadget('place', null);
  }

  /** Shot down under the canopy (or respawning): straight onto the ground below, canopy gone. */
  private dropChute(): void {
    if (!this.chute) return;
    this.chute.visible = false;
    this.chute = null;
    const p = this.player;
    const down = this.physics.raycast(p.feet, new THREE.Vector3(0, -1, 0), 2000, Layer.WORLD);
    p.dismount(down ? new THREE.Vector3(down.point.x, down.point.y, down.point.z) : p.feet.clone());
  }

  /**
   * Under the canopy: WASD steers (drifting at CHUTE.steer m/s), it comes
   * down at CHUTE.fall m/s and lands on whatever is below; the gun still
   * works on the way down.
   */
  private stepChute(dt: number, input: InputState): void {
    const p = this.player;
    const [wx, wz] = input.moveX || input.moveY ? wishDirection(input.moveX, input.moveY, p.yaw) : [0, 0];
    const k = Math.min(1, dt * 1.5);
    this.chuteVel.x += (wx * CHUTE.steer - this.chuteVel.x) * k;
    this.chuteVel.z += (wz * CHUTE.steer - this.chuteVel.z) * k;
    this.chuteVel.y = -CHUTE.fall;
    const step = this.chuteVel.clone().multiplyScalar(dt);
    const hit = this.physics.raycast(p.feet.clone().setY(p.feet.y + 0.5), step.clone().normalize(), step.length() + 0.5, Layer.WORLD);
    if (hit) {
      // Down: canopy away, on foot.
      this.chute!.visible = false;
      this.chute = null;
      p.dismount(new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z));
      this.weapons.drawTimer = DRAW_TIME;
      return;
    }
    const eye = p.feet.clone().add(step).setY(p.feet.y + step.y + p.eyeHeight);
    p.ride(eye, this.chuteVel);
    this.weapons.step(dt, input, p, false);
  }

  /** The player's seat gun: follows the view; the trigger fires it (MGs overheat, shell guns reload). */
  private stepVehicleGun(v: Vehicle, seat: number, trigger: boolean, dt: number): void {
    const p = this.player;
    v.aimMount(seat, p.yaw, p.pitch);
    if (!v.pullTrigger(seat, trigger, this.simTime, dt)) return;
    // Aircraft guns point along the plane (the pilot's seat).
    if (v.flight && v.spec.seats[seat]!.role === 'driver') {
      this.fireMount(v, seat, { id: PLAYER_ID, name: t('feed.you'), team: PLAYER_TEAM }, null);
      return;
    }
    // Aim: what the view centre points at.
    const cam = this.renderer.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const range = v.mounts[seat]!.gun.range;
    const look = this.physics.raycast(cam.position, fwd, range, Layer.WORLD | Layer.HITBOX, v.collider);
    const aim = look ? new THREE.Vector3(look.point.x, look.point.y, look.point.z) : cam.position.clone().addScaledVector(fwd, range);
    this.fireMount(v, seat, { id: PLAYER_ID, name: t('feed.you'), team: PLAYER_TEAM }, aim);
  }

  /**
   * One round from a vehicle gun at `aim`: hitscan for the MGs and the
   * autocannon, a flying shell for tank guns (lobbed for the howitzer).
   * Shared by the player and the bots.
   */
  private fireMount(v: Vehicle, seat: number, shooter: GrenadeOwner, aimAt: THREE.Vector3 | null, alt = false): void {
    const m = (alt ? v.altMounts : v.mounts)[seat];
    if (!m) return;
    const gun = m.gun;
    const byPlayer = shooter.id === PLAYER_ID;
    const muzzle = v.muzzleOf(seat, new THREE.Vector3());
    // No aim point: straight ahead along the plane's flight path.
    const nose = v.velocity.lengthSq() > 1 ? v.velocity.clone().normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(v.quat);
    const aim = aimAt ?? muzzle.clone().addScaledVector(nose, gun.range);
    if (gun.homing) {
      const lock = this.lockTarget(v, shooter.team);
      const vel = nose.clone().multiplyScalar(gun.shell!.speed).add(v.velocity);
      this.gadgets.fireShell(muzzle.clone().addScaledVector(nose, 4), vel, 0, { ...shooter, squad: null }, m.id, lock ? () => (lock.wrecked ? null : lock.pos) : undefined);
      this.audio.gadget('rocket', byPlayer ? null : muzzle);
      return;
    }
    const dir = aim.clone().sub(muzzle).normalize();
    const s = gun.spread * DEG * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir);
    dir.addScaledVector(right, Math.cos(a) * Math.tan(s)).addScaledVector(up, Math.sin(a) * Math.tan(s)).normalize();
    const name = t(`vehicleGun.${m.id}`);
    const listenerDist = muzzle.distanceTo(this.renderer.camera.position);
    this.effects.muzzleFlash(muzzle, dir);
    if (gun.shell) {
      const sh = gun.shell;
      let vel: THREE.Vector3;
      if (sh.lob) {
        // Lobbed onto the aim point: flight time grows with range.
        const d = aim.clone().sub(muzzle);
        const flat = Math.hypot(d.x, d.z);
        const time = THREE.MathUtils.clamp(2 + flat / 120, 2.5, 7);
        vel = new THREE.Vector3(d.x / time, d.y / time + 0.5 * sh.gravity * time, d.z / time);
        vel.addScaledVector(right, (Math.random() - 0.5) * flat * gun.spread * DEG);
      } else vel = dir.clone().multiplyScalar(sh.speed).add(v.flight ? v.velocity : new THREE.Vector3());
      this.gadgets.fireShell(muzzle.clone().addScaledVector(dir, 0.4), vel, sh.gravity, { ...shooter, squad: null }, m.id);
      if (m.id === 'rockets') this.audio.gadget('rocket', byPlayer ? null : muzzle);
      else this.audio.explosion(muzzle, Math.max(30, listenerDist));
      if (byPlayer) this.shake = Math.min(0.06, this.shake + 0.035);
      return;
    }
    const hit = this.physics.raycast(muzzle, dir, gun.range, Layer.WORLD | Layer.HITBOX, v.collider);
    const to = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : muzzle.clone().addScaledVector(dir, gun.range);
    const target = hit ? this.registry.lookup(hit.collider.handle) : undefined;
    if (target && target.owner.alive && target.owner.team !== shooter.team) {
      const isVehicle = !!this.vehicles?.get(target.owner.id);
      const dmg = isVehicle ? gun.vsVehicle : computeDamage(gun.damage, target.part, 1.5);
      const source: DamageSource = { pos: muzzle.clone(), name: shooter.name, team: shooter.team, weapon: name, id: shooter.id };
      const killed = target.owner.id === PLAYER_ID ? this.damagePlayer(dmg, muzzle, 'bullet', source) : target.owner.applyDamage(dmg, target.part, source, gun.blast > 0 ? 'at' : 'heavy');
      this.bus.emit('combat:hit', { targetId: target.owner.id, part: target.part, damage: dmg, killed, point: to, byPlayer });
      if (killed) this.reportKill(shooter, target.owner.id, target.owner.id === PLAYER_ID ? this.playerCombatant.name : target.owner.name, target.owner.team ?? null, name);
    } else if (hit && !target) {
      this.bus.emit('combat:impact', { point: to, normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), surface: this.impacts.get(hit.collider.handle, hit.point) });
    }
    if (hit && gun.blast > 0) this.blast('cannon', to, shooter, name);
    this.effects.spawnShots([{ from: muzzle, to }], muzzle);
    this.audio.remoteGunshot(gun.blast > 0 ? 'sr' : 'lmg', muzzle, byPlayer ? 0 : listenerDist);
    this.bots?.nearMiss(muzzle, to, shooter.team, target?.owner.id ?? -1, 1);
    if (byPlayer) this.shake = Math.min(0.03, this.shake + (gun.blast > 0 ? 0.012 : 0.004));
  }

  /**
   * A shell came down: a direct hit kills people outright (no going down)
   * and hurts vehicles a lot; then the blast.
   */
  private shellHit(gun: string, point: THREE.Vector3, owner: GadgetOwner, target: Damageable | null, part: HitPart): void {
    const spec = VEHICLE_GUNS[gun as VehicleGunId];
    if (!spec) return;
    const name = t(`vehicleGun.${gun as VehicleGunId}`);
    const source: DamageSource = { pos: point.clone(), name: owner.name, team: owner.team, weapon: name, id: owner.id };
    if (target && target.team !== owner.team && target.id >= 0) {
      if (this.vehicles?.get(target.id)) target.applyDamage(spec.vsVehicle, part, source, 'at');
      else if (target.id === PLAYER_ID) {
        if (this.damagePlayer(999, point, 'explosion', source)) {
          this.reportKill(owner, PLAYER_ID, this.playerCombatant.name, PLAYER_TEAM, name);
          this.die('explosion', source);
        }
      } else {
        const bot = this.bots?.bots.find((b) => b.id === target.id);
        if (bot?.alive) {
          bot.killOutright(source);
          this.bus.emit('combat:hit', { targetId: bot.id, part, damage: 999, killed: true, point: point.clone(), byPlayer: owner.id === PLAYER_ID });
          this.reportKill(owner, bot.id, bot.name, bot.team, name);
        }
      }
    }
    const kind = gun === 'howitzer' ? 'howitzer' : gun === 'atgun' ? 'atshell' : gun === 'rockets' ? 'salvo' : gun === 'aam' ? 'missile' : 'shell';
    this.blast(kind, point, owner, name);
  }

  /** A vehicle blew up: everyone aboard dies outright (no going down). */
  private vehicleDestroyed(v: Vehicle, by: DamageSource | null): void {
    const at = v.pos.clone();
    this.effects.explosion(at);
    this.effects.explosion(at.clone().setY(at.y + 1));
    this.audio.explosion(at, this.renderer.camera.position.distanceTo(at));
    this.renderer.requestShadowUpdate();
    const owner: GrenadeOwner = { id: by?.id ?? -1, name: by?.name ?? '', team: by?.team ?? otherTeam(PLAYER_TEAM) };
    const weapon = by?.weapon ?? t(`vehicle.${v.kind}`);
    if (this.ride?.v === v) {
      this.leaveVehicle();
      if (this.damagePlayer(999, at, 'explosion', by ?? undefined)) {
        if (by && by.id !== PLAYER_ID) this.reportKill(owner, PLAYER_ID, this.playerCombatant.name, PLAYER_TEAM, weapon);
        this.die('explosion', by ?? undefined);
      }
    }
    for (const b of this.bots?.vehicleLost(v, by) ?? []) {
      if (by) this.reportKill(owner, b.id, b.name, b.team, weapon);
    }
    v.seats.fill(null);
  }

  /** Someone run over: down (or dead) and credited to the driver. */
  private roadkill(v: Vehicle, victim: Walker): void {
    const d = v.driver!;
    const isPlayer = d.id === PLAYER_ID;
    const name = isPlayer ? t('feed.you') : (this.bots?.bots.find((b) => b.id === d.id)?.name ?? '');
    const weapon = t(`vehicle.${v.kind}`);
    const source: DamageSource = { pos: v.pos.clone(), name, team: d.team, weapon, id: d.id };
    if (victim.id === PLAYER_ID) {
      if (this.damagePlayer(999, v.pos, 'explosion', source)) this.reportKill({ id: d.id, name, team: d.team }, PLAYER_ID, this.playerCombatant.name, PLAYER_TEAM, weapon);
      return;
    }
    const bot = this.bots?.bots.find((b) => b.id === victim.id);
    if (!bot || !bot.alive) return;
    const killed = bot.applyDamage(999, 'body', source);
    this.bus.emit('combat:hit', { targetId: bot.id, part: 'body', damage: 999, killed, point: bot.feet.clone(), byPlayer: isPlayer });
    if (killed) this.reportKill({ id: d.id, name, team: d.team }, bot.id, bot.name, bot.team, weapon);
  }

  /** RP of a squad: its members' points (the scoreboard score) less what was spent on call-ins. */
  private squadRpOf(sq: Squad): number {
    let earned = 0;
    for (const m of sq.members) earned += this.scores.get(m.id)?.score ?? 0;
    return squadRp(earned, this.support.spent(`${sq.team}:${sq.name}`));
  }

  /** Menu state for the HUD, or null when the player can't call anything in. */
  private supportState(): SupportMenuState | null {
    const sq = this.playerSquad;
    if (!sq || !this.player.alive || !this.deployed) return null;
    const cooldown = {} as Record<SupportId, number>;
    for (const id of SUPPORT_ORDER) cooldown[id] = this.support.cooldown(PLAYER_TEAM, id);
    return { rp: this.squadRpOf(sq), cooldown, aiming: this.supportAim };
  }

  /** Picked a call-in from the menu (key or tap): aim it next, if it can be called. */
  private pickSupport(id: SupportId): void {
    const s = this.supportState();
    if (!s || !SupportMenu.ready(s, id)) return;
    this.supportMenu.open = false;
    // The rocket tank isn't aimed: it comes to the zone nearest the leader.
    if (id === 'rocketTank') {
      const sq = this.playerSquad!;
      const owner: GadgetOwner = { id: PLAYER_ID, name: t('feed.you'), team: PLAYER_TEAM, squad: `${sq.team}:${sq.name}` };
      if (this.support.request(id, this.player.feet, owner, s.rp, false)) this.audio.click();
      return;
    }
    this.supportAim = id;
    this.gadgetOut = false;
    this.buildMode = false;
  }

  /**
   * B opens the call-in menu (squad leaders, bot matches); 1..5 pick one, then
   * the trigger calls it onto the point aimed at (up to CALL_RANGE). B again,
   * or reaching for a weapon, cancels.
   */
  private stepSupport(input: InputState): void {
    const state = this.supportState();
    if (!state) {
      this.supportMenu.open = false;
      this.supportAim = null;
      this.supportPoint = null;
      return;
    }
    if (input.support) {
      if (this.supportAim) this.supportAim = null;
      else this.supportMenu.open = !this.supportMenu.open;
    }
    if (this.supportMenu.open && input.weaponSlot >= 0 && input.weaponSlot < SUPPORT_ORDER.length) {
      this.pickSupport(SUPPORT_ORDER[input.weaponSlot]!);
      input.weaponSlot = -1;
    }
    if (!this.supportAim) {
      this.supportPoint = null;
      return;
    }
    if (input.weaponSlot >= 0 || input.weaponCycle !== 0 || input.throwGrenade || input.melee || input.gadget || input.buildMode) {
      this.supportAim = null;
      return;
    }
    const { eye, fwd } = this.weapons.aimBasis(this.player);
    const hit = this.physics.raycast(eye, fwd, CALL_RANGE, Layer.WORLD);
    this.supportPoint = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : null;
    if (input.firePressed && this.supportPoint) {
      const sq = this.playerSquad!;
      const owner: GadgetOwner = { id: PLAYER_ID, name: t('feed.you'), team: PLAYER_TEAM, squad: `${sq.team}:${sq.name}` };
      if (this.support.request(this.supportAim, this.supportPoint, owner, state.rp, true)) {
        this.hud.notify(t('support.called').replace('{name}', t(`support.${this.supportAim}`)), 'ally');
        this.audio.click();
      }
      this.supportAim = null;
      this.supportPoint = null;
    }
    input.fire = false;
    input.firePressed = false;
  }

  /** Ring on the ground where the call-in being aimed would land. */
  private renderSupportAim(): void {
    const p = this.supportPoint;
    const id = this.supportAim;
    if (!p || !id) {
      if (this.supportRing) this.supportRing.visible = false;
      return;
    }
    if (!this.supportRing) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.7, depthTest: false, side: THREE.DoubleSide, toneMapped: false });
      this.supportRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2), mat);
      this.supportRing.renderOrder = 10;
      this.renderer.scene.add(this.supportRing);
    }
    const r = Math.max(3, SUPPORT[id].spread);
    this.supportRing.visible = true;
    this.supportRing.position.set(p.x, p.y + 0.15, p.z);
    this.supportRing.scale.setScalar(r);
  }

  /**
   * A supply crate on the ground hands one of its side a refill (ammo,
   * grenades, gadget, medkits): the player or a bot within reach who needs it.
   */
  private crateResupply(team: Team, pos: THREE.Vector3, reach: number): boolean {
    const p = this.player;
    if (team === PLAYER_TEAM && p.alive && this.deployed && p.feet.distanceTo(pos) < reach) {
      const need =
        this.weapons.needsAmmo ||
        this.grenades.count < GRENADE_COUNT[this.grenades.selected] ||
        (!!this.gadget && this.gadgetCount < GADGETS[this.gadget].count) ||
        (this.cls !== 'medic' && this.medkits < MEDKIT.carried);
      if (need) {
        this.weapons.refillReserve();
        this.grenades.reset(this.grenades.selected);
        if (this.gadget) this.gadgetCount = GADGETS[this.gadget].count;
        if (this.cls !== 'medic') this.medkits = MEDKIT.carried;
        this.audio.resupply();
        return true;
      }
    }
    for (const b of this.bots?.bots ?? []) {
      if (!b.alive || b.team !== team || b.feet.distanceTo(pos) > reach) continue;
      if (!b.needsGrenades && b.medkits >= MEDKIT.carried) continue;
      b.restockGrenades();
      if (b.cls !== 'medic') b.medkits = MEDKIT.carried;
      return true;
    }
    return false;
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
    for (const v of this.vehicles?.vehicles ?? []) {
      if (v.wrecked || (v.team && v.team === owner.team && owner.id !== PLAYER_ID)) continue;
      // Distance to the hull, roughly.
      const d = Math.max(0, v.pos.distanceTo(point) - Math.min(v.spec.half[0], v.spec.half[2]));
      const dmg = fragDamage(spec, d, false);
      if (dmg > 0) v.applyDamage(dmg, 'body', source, kind === 'rocket' || kind === 'cannon' ? 'at' : 'explosive');
    }
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
    const killed = target.applyDamage(ROCKET.directDamage, part, source, 'at');
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
    if (killed) {
      if (this.ride) this.leaveVehicle();
      if (this.chute) this.dropChute();
      this.goDown(cause, source);
    }
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
    if (this.chute) this.dropChute();

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
    // Deployed in a tank: it comes out at the base with the player at the controls.
    if (key.startsWith('tank:') && this.vehicles) {
      const v = this.vehicles.spawnTank(key.slice(5) as VehicleKind, PLAYER_TEAM);
      if (v) this.enterSeat(v, 0);
    }
    if (key.startsWith('veh:') && this.vehicles) {
      const v = this.vehicles.get(Number(key.slice(4)));
      const seat = v ? this.freeSeatFor(v, PLAYER_TEAM, PLAYER_ID) : -1;
      if (v && seat >= 0) this.enterSeat(v, seat);
    }
    if (key.startsWith('jet:') && this.vehicles) {
      const v = this.spawnJet(key.slice(4) as VehicleKind, PLAYER_TEAM);
      if (v) this.enterSeat(v, 0);
    }
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
    if (this.ride && p.alive) this.rideCamera(alpha, dt);

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

  /**
   * In a vehicle: first person from the seat by default (the gunner a little
   * behind the gun); C switches to a third-person view orbiting the vehicle
   * with the view, pulled in by walls.
   */
  private rideCamera(alpha: number, dt: number): void {
    const { v, seat } = this.ride!;
    const cam = this.renderer.camera;
    const p = this.player;
    const role = v.spec.seats[seat]!.role;
    const fwd = this.tmpFwd.set(0, 0, -1).applyEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'));
    if (this.rideThird) {
      const target = v.toWorld(new THREE.Vector3(0, v.spec.half[1] + 1.1, 0), new THREE.Vector3(), alpha);
      const want = v.flight ? 20 : v.kind === 'apc' || v.kind === 'rocket' ? 10 : v.kind === 'bike' ? 4.5 : TANK_KINDS.includes(v.kind) ? 11 : 6.5;
      const hit = this.physics.raycast(target, fwd.clone().negate(), want, Layer.WORLD, v.collider);
      const dist = hit ? Math.max(1.2, hit.distance - 0.3) : want;
      // Pull in at once, ease back out.
      this.rideCamDist = dist < this.rideCamDist ? dist : this.rideCamDist + (dist - this.rideCamDist) * (1 - Math.exp(-3 * dt));
      cam.position.copy(target).addScaledVector(fwd, -this.rideCamDist);
    } else {
      v.seatEye(seat, cam.position, alpha);
      // Gunner: a little behind and above the gun.
      if (role === 'gunner') cam.position.addScaledVector(fwd, -0.35).y += 0.15;
    }
  }

  /** The player's body in the seat, for the third-person driving view (seen ones only). */
  private renderRider(alpha: number, dt: number): void {
    const r = this.ride;
    const seat = r?.v.spec.seats[r.seat];
    const show = !!r && !!seat && seat.exposed && this.rideThird && this.player.alive;
    if (!show) {
      if (this.rider) this.rider.root.visible = false;
      return;
    }
    if (!this.rider) {
      this.rider = new SoldierModel(PLAYER_TEAM, this.weapons.def);
      this.renderer.scene.add(this.rider.root);
    }
    const eye = r.v.seatEye(r.seat, new THREE.Vector3(), alpha);
    this.rider.root.visible = true;
    const standing = seat.role === 'gunner';
    this.rider.update(eye.setY(eye.y - (standing ? 1.6 : 1.2)), { speed: 0, crouch: 0, yaw: standing ? this.player.yaw : r.v.yaw, aimPitch: standing ? this.player.pitch : 0, deadFor: -1, dt, seated: !standing });
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
      hideForScope: (!!w.def.scope && w.adsBlend > 0.95) || this.playerDowned || !!this.ride,
      meleeT: w.meleeProgress,
      inspectT: w.inspectProgress,
      tool: this.working,
      toolIdle: this.buildMode && p.alive && this.deployed,
      gadget: this.gadgetOut && p.alive && this.deployed ? this.gadget : null,
      gadgetUsed: this.simTime - this.gadgetUsedAt,
      gadgetLeft: this.gadgetCount,
    });
    this.fort?.render(this.renderer.camera.position, this.buildMode, this.buildTarget);
    this.renderSupportAim();

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
    if (onField && this.ride) {
      const { v, seat } = this.ride;
      const role = v.spec.seats[seat]!.role;
      const n = v.seats.length;
      const parts = [`${t(`vehicle.${v.kind}`)} · ${t(`seat.${role}`)}`];
      const mount = v.mounts[seat];
      if (mount?.overheated) parts.push(t('vehicle.overheat'));
      if (v.reloadLeft(seat, this.simTime) > 0) parts.push(t('vehicle.reloading'));
      parts.push(this.touch ? t('vehicle.exitTouch') : t('vehicle.exit'));
      if (n > 1 && !this.touch) parts.push(t('vehicle.seats').replace('{n}', String(n)));
      if (!this.touch) parts.push(t('vehicle.view'));
      const f = v.flight;
      if (f) {
        const below = this.physics.raycast(v.pos, new THREE.Vector3(0, -1, 0), 2000, Layer.WORLD);
        parts.splice(1, 0, t('jet.hud').replace('{alt}', String(Math.round(below ? below.distance : v.pos.y))).replace('{spd}', String(Math.round(f.speed * 3.6))).replace('{thr}', String(Math.round(f.throttle * 100))));
        if (v.altMounts[seat]?.gun.homing && this.lockTarget(v, PLAYER_TEAM)) parts.splice(2, 0, t('jet.locked'));
        if (f.turningBack) parts.splice(2, 0, t('jet.airspace'));
        if (!this.touch) parts.push(t('jet.controls'));
      }
      prompt = { text: parts.join(' — '), progress: Math.max(0, v.health / v.spec.health) };
      touchLabel = t('touch.exitVehicle');
    } else if (onField && !prompt && !this.buildMode) {
      const near = this.vehicles?.nearest(this.player.feet);
      if (near) {
        prompt = { text: `${key(false)}${t('vehicle.enter')}: ${t(`vehicle.${near.kind}`)}`, progress: null };
        touchLabel = t('vehicle.enter');
      }
    }
    const nearSpot = onField && !this.ride && !!this.fort?.anyNear(this.player.feet, 12);
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
    } else if (onField && this.supportAim) {
      const ok = !!this.supportPoint;
      prompt = { text: `${t(`support.${this.supportAim}`)} — ${ok ? t(this.touch ? 'support.aimTouch' : 'support.aim') : t('support.noTarget')}`, progress: null };
    } else if (!prompt && nearSpot && !this.touch && this.fort!.anyNear(this.player.feet, 6)) {
      prompt = { text: t('build.enter'), progress: null };
    }
    const supportState = this.supportState();
    this.supportMenu.update(supportState);
    this.touch?.setContext({
      medkit: medkit ? (medkit.ready ? `${t('touch.medkit')} ${kitText}` : kitText) : null,
      interact: touchLabel,
      downed: this.playerDowned,
      build: onField && this.buildMode ? 'on' : nearSpot ? 'near' : null,
      gadget: onField && this.gadget ? { label: `${t(`gadgetShort.${this.gadget}`)} ${this.gadgetCount}`, out: this.gadgetOut, empty: this.gadgetCount === 0 } : null,
      scoped: onField && !!w.def.scope && w.adsBlend > 0.5,
      // Call-ins are picked on foot only (see simStep), so the button goes while aboard.
      support: supportState && !this.ride ? this.supportMenu.open || !!this.supportAim : null,
      ride: this.ride ? (this.ride.v.spec.seats[this.ride.seat]!.role === 'driver' ? (this.ride.v.flight ? 'fly' : 'drive') : 'seat') : null,
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
        rp: supportState ? `${t('support.hud')} ${supportState.rp}${this.touch ? '' : ' · B'}` : null,
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
    if (this.touch) {
      // Called from the deploy button's click, so the tap still counts for fullscreen.
      this.enterFullscreen();
      this.touch.setVisible(true);
    } else this.kbm.requestLock();
  }

  private baseCenter(team: Team): THREE.Vector3 {
    const list = this.mapSpawns.filter((s) => s.team === team || (team === PLAYER_TEAM && s.team === 'player'));
    return list.reduce((a, s) => a.add(new THREE.Vector3(...s.pos)), new THREE.Vector3()).divideScalar(Math.max(1, list.length));
  }

  /** Spawn position for a deploy key ('base' | 'zone:<id>' | 'mate:<id>'); invalid keys fall back to the base. */
  private spawnFor(team: Team, key: string, selfId: number): { pos: THREE.Vector3; yaw: number } {
    const [kind, id] = key.split(':');
    // A bot deploying into a vehicle seat: seated right after the respawn (see
    // `seatPending`), and meanwhile at its base, so if the seat has gone by
    // then (taken, wrecked) it is on the ground there, not where a plane was.
    if (kind === 'veh' && selfId !== PLAYER_ID) {
      const v = this.vehicles?.get(Number(id));
      let pending = 0;
      for (const vid of this.pendingSeats.values()) if (vid === v?.id) pending++;
      if (v && this.freeSeatFor(v, team, selfId) >= 0 && this.freeSeatCount(v, team, selfId) > pending) {
        this.pendingSeats.set(selfId, v.id);
        return this.spawnFor(team, 'base', selfId);
      }
    }
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
      if (mate && !mateSpawnBlock(mate, this.bots!.time, this.riding(mate.id))) return this.besideMate(mate);
    }
    const zm = this.zoneMode;
    if (zm) return zm.spawnPoint(team, kind === 'zone' ? id! : 'base', this.nav);
    const list = this.mapSpawns.filter((s) => s.team === team || (team === PLAYER_TEAM && s.team === 'player'));
    const sp = list[Math.floor(Math.random() * list.length)];
    const pos = sp ? new THREE.Vector3(...sp.pos) : this.baseCenter(team);
    return { pos: this.nav?.randomAround(pos, 3) ?? pos, yaw: (sp?.yaw ?? 0) * DEG };
  }

  /** Combatant `id` (the player or a bot) sits in a vehicle. */
  private riding(id: number): boolean {
    if (id === PLAYER_ID) return !!this.ride;
    return !!this.bots?.bots.find((b) => b.id === id)?.riding;
  }

  /** A step behind a squadmate, facing where they face. */
  private besideMate(m: SquadMember): { pos: THREE.Vector3; yaw: number } {
    const side = Math.random() < 0.5 ? -1 : 1;
    const back = new THREE.Vector3(Math.sin(m.yaw), 0, Math.cos(m.yaw)).multiplyScalar(2.2);
    const lateral = new THREE.Vector3(Math.cos(m.yaw), 0, -Math.sin(m.yaw)).multiplyScalar(side * 1.2);
    const want = m.feet.clone().add(back).add(lateral);
    // Behind them may be a wall: then right where they stand.
    const pos = (this.nav && (this.nav.randomAround(want, 1.2) ?? this.nav.closest(want) ?? this.nav.closest(m.feet))) || m.feet.clone();
    return { pos, yaw: m.yaw };
  }

  /**
   * Where a bot respawns: on its leader (the player) when allowed, else the
   * option nearest its objective among base, owned zones and free squadmates.
   */
  private botSpawnKey(bot: Bot, objective: THREE.Vector3 | null): string {
    const now = this.bots!.time;
    const sq = this.squads.find((s) => s.team === bot.team && s.has(bot.id));
    const mates = sq ? sq.mates(bot.id).filter((m) => !mateSpawnBlock(m, now, this.riding(m.id))) : [];
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
    // Now and then straight into a free seat in one of the side's tanks or jets.
    if (Math.random() < 0.3) {
      for (const v of this.vehicles?.vehicles ?? []) {
        if (v.seats.some((s) => s) && this.freeSeatFor(v, bot.team, bot.id) >= 0) return `veh:${v.id}`;
      }
    }
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
    // Tanks: start in one at the base, while the side is under its limit.
    const vw = this.vehicles;
    if (vw && vw.tankSpots.some((s) => s.team === PLAYER_TEAM)) {
      const full = vw.tanks(PLAYER_TEAM) >= vw.tankLimit();
      const spot = vw.freeTankSpot(PLAYER_TEAM);
      for (const kind of TANK_KINDS) {
        out.push({
          key: `tank:${kind}`,
          kind: 'vehicle',
          label: `${t('spawn.tank')}: ${t(`vehicle.${kind}`)} (${vw.tanks(PLAYER_TEAM)}/${vw.tankLimit()})`,
          x: spot?.pos.x ?? base.x,
          z: spot?.pos.z ?? base.z,
          blocked: full ? t('deploy.tankLimit').replace('{n}', String(vw.tankLimit())) : !spot ? t('deploy.noRoom') : null,
          warn: null,
        });
      }
    }
    if (vw) {
      const full = vw.jets(PLAYER_TEAM) >= vw.jetLimit();
      for (const kind of JET_KINDS) {
        out.push({
          key: `jet:${kind}`,
          kind: 'vehicle',
          label: `${t('spawn.jet')}: ${t(`vehicle.${kind}`)} (${vw.jets(PLAYER_TEAM)}/${vw.jetLimit()})`,
          x: base.x,
          z: base.z,
          blocked: full ? t('deploy.tankLimit').replace('{n}', String(vw.jetLimit())) : null,
          warn: null,
        });
      }
    }
    // A free seat in one of the side's tanks or jets: deploy aboard.
    for (const v of vw?.vehicles ?? []) {
      const seat = this.freeSeatFor(v, PLAYER_TEAM, PLAYER_ID);
      if (seat < 0) continue;
      const aboard = v.seats.filter((s) => s).length;
      out.push({
        key: `veh:${v.id}`,
        kind: 'ride',
        label: `${t(`vehicle.${v.kind}`)} — ${t(`seat.${v.spec.seats[seat]!.role}`)} (${aboard}/${v.seats.length})`,
        x: v.pos.x,
        z: v.pos.z,
        blocked: null,
        warn: v.health < v.spec.health * 0.35 ? t('deploy.damaged') : null,
      });
    }
    const now = this.bots?.time ?? 0;
    for (const m of this.playerSquad?.mates(PLAYER_ID) ?? []) {
      const block = mateSpawnBlock(m, now, this.riding(m.id));
      out.push({
        key: `mate:${m.id}`,
        kind: 'mate',
        label: m.name,
        x: m.feet.x,
        z: m.feet.z,
        blocked: block === 'dead' ? t('deploy.dead') : block === 'down' ? t('deploy.down') : block === 'combat' ? t('deploy.combat') : block === 'vehicle' ? t('deploy.riding') : null,
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

/** Parachute: falling speed and how fast it can be steered sideways (m/s). */
const CHUTE = { fall: 8, steer: 4.5 };

/** A round canopy on lines, its harness at the player's shoulders (origin at the feet). */
function buildParachute(): THREE.Group {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x7a7b5c, roughness: 0.9, side: THREE.DoubleSide });
  const line = new THREE.MeshBasicMaterial({ color: 0x2a2a26 });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(3.2, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), cloth);
  canopy.scale.y = 0.6;
  canopy.position.y = 6.2;
  g.add(canopy);
  const rim = 3.2 * Math.sin(Math.PI / 2.6);
  const rimY = 6.2 + 3.2 * Math.cos(Math.PI / 2.6) * 0.6;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const top = new THREE.Vector3(Math.cos(a) * rim, rimY, Math.sin(a) * rim);
    const bottom = new THREE.Vector3(0, 1.5, 0);
    const len = top.distanceTo(bottom);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, len, 3), line);
    m.position.copy(top).add(bottom).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bottom).normalize());
    g.add(m);
  }
  return g;
}

