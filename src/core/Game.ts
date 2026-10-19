import { disposeTree } from '@/render/dispose';
import { MATCH, foes, friends, setMatchFlags } from '@/modes/matchFlags';
import { SIMPLE, simplifyInput } from '@/modes/simple';
import { loadCore } from '@/wasm/core';
import * as THREE from 'three';
import { EventBus } from './EventBus';
import type { DamageCause, GameEvents, GrenadeOwner, HitPart } from './events';
import { FixedStepLoop } from './FixedStepLoop';
import { QUALITY_ORDER, gpuName, isTouchDevice, loadSettings, resolveQuality, saveSettings, type Settings } from './Settings';
import { setLocale, t, type MessageKey } from '@/i18n';
import { playerName } from '@/net/identity';
import { Renderer } from '@/render/Renderer';
import { Atmosphere, loadPhotoSky } from '@/render/visualProfiles';
import { PROCEDURAL_KINDS, SURFACE_KINDS, SurfaceLibrary } from '@/render/textures';
import { setVehicleSurfaces } from '@/vehicles/vehicleLooks';
import { ModelLibrary } from '@/render/models';
import { Effects } from '@/render/Effects';
import { Layer, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SURFACE_FROM_MATERIAL, SurfaceRegistry } from '@/physics/surfaces';
import { fetchMap } from '@/world/validateMap';
import type { BuiltMap } from '@/world/buildBlockout';
import { buildWorld, fortPlanFor } from '@/sim/world';
import { kitToggles, restockAmmo, stepFort, stepGadget, type KitWorld } from '@/sim/kit';
import { Soldier, type SoldierHooks } from '@/sim/Soldier';
import { Boundary, type Terrain } from '@/world/terrain';
import { GROUND_COVER, GroundCover } from '@/world/groundCover';
import { BACKDROP_MODELS, buildBackdrop, cullBackdropDetail } from '@/world/backdrop';
import { createConiferKit } from '@/world/conifers';
import { Forest } from '@/world/forest';
import { buildRivers } from '@/world/river';
import { WaterMap } from '@/world/water';
import type { Sea } from '@/world/waves';
import { SeaView } from '@/world/seaView';
import { Snowfall } from '@/render/snowfall';
import { placeProps } from '@/world/placeProps';
import type { MapDef, SpawnPoint } from '@/world/mapTypes';
import { consumePulses, createInputState, resetFrameInput, type InputSource, type InputState } from '@/input/InputState';
import { KeyboardMouse } from '@/input/KeyboardMouse';
import { actionKey, type Action } from '@/input/bindings';
import { TouchControls } from '@/input/Touch';
import { AirMarkers, type AirMark } from '@/render/airMarkers';
import { Player } from '@/player/Player';
import { HitboxRegistry, computeDamage, type DamageSource, type Damageable } from '@/combat/Hitboxes';
import { CharacterHitboxes } from '@/combat/CharacterHitboxes';
import { NavWorld, VehicleNav } from '@/ai/NavWorld';
import type { BigNavInput } from '@/ai/navRegions';
import { BotManager, HEAR_STEP, HEAR_STEP_SPRINT, type AdoptSpec, type BotOptions } from '@/ai/BotManager';
import { PLAYER_ID, PLAYER_TEAM, otherTeam, type Combatant } from '@/ai/types';
import { TargetDummy } from '@/combat/TargetDummy';
import { EngineSounds, type EngineSource } from '@/audio/engines';
import type { BoomSize } from '@/audio/AudioSystem';
import { BLASTS, GRENADES, flashDuration, flashIntensity, fragDamage, gunBlast, type BlastKind, type GrenadeType } from '@/combat/explosions';
import { GADGETS, PANZERFAUST_TOSS, PLACE_REACH, ROCKET, classGadget, type GadgetId } from '@/data/gadgets';
import { GadgetWorld, type GadgetOwner, type MineWalker } from '@/modes/gadgetWorld';
import { SupportWorld } from '@/modes/supportWorld';
import { VehicleWorld, callInSpot, mapVehicleSpots, planVehicleSpots, type Walker } from '@/vehicles/VehicleWorld';
import { vehicleWorldFor, viewDir } from '@/sim/vehicles';
import type { DriveInput, Vehicle } from '@/vehicles/Vehicle';
import { contacts, deckSpawn, fleetShip, fleetState, layGun, lookPoint, seaDamagePoints, seaRp } from '@/vehicles/ship';
import { CARRIER_PLANES, DECK, PLANE_COST, isCarrierPlane, launchBlock, planeCap } from '@/vehicles/carrierPlanes';
import { SoldierModel } from '@/ai/SoldierModel';
import { BOT_WEAPONS } from '@/ai/personality';
import { loadTactics } from '@/ai/tacticsLoad';
import { wishDirection } from '@/player/movement';
import { AIRSPACE, JET_KINDS, TANK_KINDS, VEHICLE_GUNS, type VehicleGunId, type VehicleKind } from '@/vehicles/vehicleData';
import { Vehicle as VehicleClass } from '@/vehicles/Vehicle';
import { CALL_RANGE, SUPPORT, SUPPORT_ORDER, squadRp, type SupportId } from '@/data/support';
import { SupportMenu, type SupportMenuState } from '@/ui/SupportMenu';
import { WeaponController } from '@/weapons/WeaponController';
import { WEAPONS, type ShotKick, type WeaponId } from '@/weapons/weaponData';
import { Spring } from '@/weapons/spring';
import { ViewModel } from '@/weapons/ViewModel';
import { opticFor } from '@/weapons/optics';
import { BREATH, SWAY_AMP, createBreath, scopeSway, stepBreath } from '@/weapons/breath';
import { GrenadeInventory, Throwables } from '@/weapons/Throwables';
import { AudioSystem } from '@/audio/AudioSystem';
import { ambienceFor } from '@/audio/ambienceDirector';
import { HUD } from '@/ui/HUD';
import { ChatPanel } from '@/ui/ChatPanel';
import { chatOf } from '@/net/chat';
import { PerfPanel } from '@/ui/PerfPanel';
import { Overlay, renderHint, type OverlayAction } from '@/ui/Overlay';
import { Briefing } from '@/audio/briefing/Briefing';
import { voiceLangFor } from '@/audio/briefing/cues';
import { BriefingDirector } from '@/modes/briefingDirector';
import { SettingsPanel } from '@/ui/SettingsPanel';
import { TutorialPanel } from '@/ui/TutorialPanel';
import { STEPS, TutorialRun, loadSeen, saveSeen, stepsFor, type TutorialProbe } from '@/core/tutorial';
import { ZoneMode, matchFlagsFor, pickMode } from '@/modes/ZoneMode';
import { armForLevel, armLoot, gunGameKit } from '@/modes/gunGame';
import { FleetRules, LastStandRules, ConquestRules, ESCORT, EscortRules, FortressRules, FrontlineRules, GUN_GAME_STEPS, GunGameRules, HardpointRules, KillConfirmRules, PointsRules, RushRules, SND, SearchDestroyRules, SoloRules, type Charge, type ModeEvent, type ModeKind } from '@/modes/matchRules';
import { EscortWorld } from '@/modes/escortWorld';
import { VehicleView, type VehicleViewKind, type VehicleViewState } from '@/ui/VehicleView';
import { LastStandVisuals } from '@/modes/lastStandVisuals';
import { ChargeVisuals } from '@/modes/chargeVisuals';
import { TagVisuals } from '@/modes/tagVisuals';
import { ZoneRules } from '@/modes/zoneRules';
import { ZoneVisuals } from '@/modes/zoneVisuals';
import type { Side, SquadHud, ZoneHud } from '@/ui/HUD';
import { DeployScreen, type DeployOption, type DeployState } from '@/ui/DeployScreen';
import { paintMap, paintMapCard, type MapImage } from '@/ui/mapPainter';
import { Minimap, type MinimapFrame } from '@/ui/Minimap';
import { ASSIST_CONE_DEG, applyAimAssist, type AssistTarget } from '@/input/aimAssist';
import { ShowcaseCamera } from '@/render/showcaseCamera';
import { wrapAngle, yawPitchOf } from '@/ai/aim';
import { Squad, WIPE_PENALTY, formSquads, mateSpawnBlock, squadName, type SquadMember } from '@/modes/squads';
import type { Bot } from '@/ai/Bot';
import { ScoreTracker } from '@/modes/scoreTracker';
import { Scoreboard, type ScoreboardSide } from '@/ui/Scoreboard';
import type { Team } from '@/world/mapTypes';
import {
  AMMO_GIVE_COOLDOWN,
  CLASSES,
  DOWN,
  GIVE_RANGE,
  GRENADE_COUNT,
  MEDKIT,
  RECON_ZOOM,
  REVIVE_RANGE,
  loadoutWeapons,
  zoomedFov,
  type ClassId,
} from '@/data/classes';
import { LoadoutStore } from '@/data/loadoutStore';
import { LoadoutPanel } from '@/ui/LoadoutPanel';
import { FORT, Fortifications, REFILL_POINTS, STATION, canRefill, type FortJob, type FortSlot, type Station } from '@/modes/fortify';
import { FortModels } from '@/world/fortModels';
import { NetMatch, type NetOptions } from '@/net/NetMatch';
import { forgetPlay } from './session';
import { SIM_DT, seeded } from '@/sim/MatchSim';
import type { MatchEvent, ServerMsg } from '@/net/lobbyProtocol';
import { SF, type NetBotEvent } from '@/net/matchProtocol';
import { sanitizeLoadout, type Loadout } from '@/data/classes';

const DEG = Math.PI / 180;
/** FOV that the weapon adsFov values were authored against. */
const AUTHORED_FOV = 78;
const SIM_HZ = 60;
const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;
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
  /** Game mode; 'auto' = the map's default zone mode when it has zones and there are bots. */
  mode?: 'auto' | ModeKind | 'skirmish';
  /** Tickets for every side that has them (Frontline, Conquest attackers) instead of the per-soldier numbers. */
  tickets?: number;
  /** Carry `loadout` (every weapon, for testing) instead of the class loadout picked on the deploy screen. */
  sandbox?: boolean;
  /** A match on the game server (multiplayer): the connection and the match's start message. */
  net?: NetOptions;
  /** The menu's tutorial: the basics step by step (on the range), whether seen before or not. */
  tutorial?: boolean;
  /** Simplified controls (owner, 2026-10-18; `MATCH.simple`): the solo setup's switch, or the room's on the game server. */
  simple?: boolean;
  /** The player's side in a solo match (default blue). */
  team?: Team;
  /** Behind the main menu: the bots fight, a camera drifts over it; no player, HUD, input or sound. */
  showcase?: boolean;
}

/** How big a blast (local or from the game server) sounds. */
function boomSize(kind: string): BoomSize {
  if (kind === 'cannon') return 'small';
  if (kind === 'rocket' || kind === 'missile' || kind === 'atshell') return 'rocket';
  if (kind === 'shell' || kind === 'mortar' || kind === 'salvo') return 'shell';
  if (kind === 'naval' || kind === 'splash') return 'shell';
  if (kind === 'artillery' || kind === 'howitzer' || kind === 'wreck' || kind === 'charge' || kind === 'bigNaval' || kind === 'torpedo' || kind === 'depth') return 'heavy';
  return 'grenade';
}
/**
 * How much of a spray's recoil the view keeps once the trigger is let go
 * (`WeaponController.viewKeep`; owner, 2026-10-18: Modern Warfare style, one
 * pulls it down oneself, except on touch screens, where it eases back more).
 */
const VIEW_KEEP = { desktop: 0.9, touch: 0.4 } as const;
/** Rays for the listener's surroundings (m): up for a ceiling, round about for walls, a wall this near closes a room. */
const SPACE_PROBE = { up: 10, round: 30, room: 9 } as const;
/** Being shot knocks the aim up: rad a point of damage, at most, and the share down the sights. */
const FLINCH = { perDamage: 0.0005, max: 0.025, ads: 0.6 } as const;
/** Camera shake by blast size (big shells shake from further off). */
const BOOM_SHAKE: Record<BoomSize, number> = { small: 0.4, grenade: 1, rocket: 1.1, shell: 1.4, heavy: 1.8 };

export class Game {
  readonly bus = new EventBus<GameEvents>();
  readonly settings: Settings;
  /** The soldier this browser plays: id and side (fixed solo; the server's in a match there). */
  private readonly myId: number;
  private readonly myTeam: Team;
  /** The battle briefing (strip + HQ radio) and what feeds it; zone matches only. */
  private briefing: Briefing | null = null;
  private briefDirector: BriefingDirector | null = null;
  /** This soldier as a side (free-for-all: just them). */
  private get meSide(): { id: number; team: Team } {
    return { id: this.myId, team: this.myTeam };
  }
  /** A match on the game server, or null (solo). */
  private net: NetMatch | null = null;
  /** The room's chat in a multiplayer match. */
  private chat: ChatPanel | null = null;
  /** Asked the server to deploy; waiting for the spawn. */
  private netDeploying = false;
  /** Enemies a recon plane marked in a match on the game server: id -> until (elapsed s). */
  private readonly netSpotted = new Map<number, number>();
  /** The side's spawn beacons in a match on the game server. */
  private netBeacons: NonNullable<Extract<ServerMsg, { t: 'mstate' }>['beacons']> = [];
  private readonly renderer: Renderer;
  private readonly loop = new FixedStepLoop(1 / SIM_HZ);
  private readonly input = createInputState();
  private readonly sources: InputSource[] = [];
  private readonly kbm: KeyboardMouse;
  private readonly touch: TouchControls | null = null;
  private readonly registry = new HitboxRegistry();
  /** Friend-or-foe marks over jets and recon planes, and the list reused each frame. */
  private readonly airMarkers = new AirMarkers();
  private readonly airMarks: AirMark[] = [];
  private readonly impacts = new SurfaceRegistry();
  private readonly hud: HUD;
  private readonly perf: PerfPanel;
  private readonly overlay: Overlay;
  private readonly audio: AudioSystem;
  private readonly viewModel: ViewModel;
  private readonly models = new ModelLibrary(ASSET_BASE);
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
  /** The soldier this browser plays (movement, guns, health, down / revive). */
  private me!: Soldier;
  private spawn!: SpawnPoint;
  private playerSpawns: SpawnPoint[] = [];
  private mapSpawns: SpawnPoint[] = [];
  private mapName = '';
  private bots: BotManager | null = null;
  private nav: NavWorld | null = null;
  private navExtra: { positions: number[]; indices: number[] } | null = null;
  private navBig: BigNavInput | null = null;
  /** The map's sea (its surface follows the match clock: the server's tick in a room). */
  private sea: Sea | null = null;
  private seaView: SeaView | null = null;
  private forest: Forest | null = null;
  /** Grass tufts around the camera on open ground (grass / bare / sand maps). */
  private groundCover: GroundCover | null = null;
  private snowfall: Snowfall | null = null;
  private zoneMode: ZoneMode | null = null;
  private zoneVisuals: ZoneVisuals | null = null;
  private tagVisuals: TagVisuals | null = null;
  private chargeVisuals: ChargeVisuals | null = null;
  /** Escort: the payload in the world. */
  private escort: EscortWorld | null = null;
  /** Last soldier standing: the circle and the crates. */
  private lastStandVisuals: LastStandVisuals | null = null;
  private matchOver = false;
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
  private lastAlpha = 0;
  private elapsed = 0;
  private running = false;
  private started = false;
  private lastTime = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private rafId = 0;
  private throwBlock = 0;
  private throwCooldown = 0;
  private flashLeft = 0;
  /** Holding the breath behind a scope (X), and the sway it steadies. */
  private breath = createBreath();
  private flashTotal = 0;
  private flashPeak = 0;
  /** Camera shake amplitude in radians. */
  private shake = 0;
  /** The camera's punch from one's own shots (up, roll, sideways; the aim stays put). */
  private readonly punch = { pitch: new Spring(), roll: new Spring(), yaw: new Spring() };
  private deathBlend = 0;
  /** Class loadouts picked on the deploy screen (kept per class across matches). */
  private readonly loadouts = new LoadoutStore();
  private loadoutPanel: LoadoutPanel | null = null;
  /** Recon: scope zoomed the extra 1.5x (wheel while aiming). */
  private reconZoom = false;
  /** Scope eye box off centre (fractions of the lens radius): lags behind turning, bobs when walking. */
  private readonly scopeShift = new THREE.Vector2();
  /** Sim clock (s) for cooldowns, shields and the down timer. */
  private simTime = 0;
  /** Downed ally the player is reviving (holding E) and progress (s). */
  private reviveOf: Bot | null = null;
  private reviveProgress = 0;
  /** What E does right now (HUD prompt, touch button). */
  private interact:
    | { kind: 'revive' | 'medkit'; bot: Bot }
    | { kind: 'fort'; job: FortJob | null; station: Station | null; note: string | null }
    /** A downed mate in a match on the game server (the server does the reviving). */
    | { kind: 'reviveMate'; name: string }
    /** A mate in a match there who could use a medkit / ammo from this medic / support. */
    | { kind: 'giveMate'; name: string; what: 'medkit' | 'ammo' }
    /** A charge (Rush, S&D) to plant or defuse. */
    | { kind: 'charge'; charge: Charge; plant: boolean }
    | null = null;
  /** Zone supply stations and build spots. */
  private fort: Fortifications | null = null;
  /** Holding E at a build spot or station (hands busy, hammer out) and for how long. */
  /** Build mode (T): the hammer is out, build spots show clearly, the trigger builds the one aimed at. */
  /** Rockets, rifle grenades, beacons and mines in the world. */
  private gadgets!: GadgetWorld;
  /** Squad call-ins (B): barrages, recon planes, supply drops; the menu and the call being aimed. */
  private support!: SupportWorld;
  private supportMenu!: SupportMenu;
  /** The playable outline (vehicle spots stay inside it). */
  private boundary: Boundary | null = null;
  /** The first-play tutorial while it runs, its card, and how long the closing line stays. */
  private tutorial: TutorialRun | null = null;
  private tutorialPanel: TutorialPanel | null = null;
  private tutorialEndLeft = 0;
  private readonly tutLast = { x: 0, z: 0, ammo: -1, weapon: '', reloading: false, crouching: false };
  private supportAim: SupportId | null = null;
  private supportPoint: THREE.Vector3 | null = null;
  private supportRing: THREE.Mesh | null = null;
  /** Vehicles (bot matches with zones): pads, bikes, and the seat the player is in. */
  private vehicles: VehicleWorld | null = null;
  private ride: { v: Vehicle; seat: number } | null = null;
  private readonly driveInputs = new Map<number, DriveInput>();
  /** Vehicle third-person camera distance, eased (pulled in by walls). */
  private rideCamDist = 6;
  /**
   * Third person in a seat whose gun turns at a rate (owner, 2026-10-14: tanks
   * were too hard to handle there): the camera orbits the vehicle on its own,
   * free of the gun's reach, and the gun aims at what the screen's centre is
   * on (the look the gun follows, and the server is sent, is worked out from that).
   */
  private orbit: { yaw: number; pitch: number } | null = null;
  /** Vehicle view: first person by default, C switches to third person. */
  private rideThird = false;
  /** The first-person view from the seat (BFV-like overlays, see ui/VehicleView). */
  private vehicleView!: VehicleView;
  /** Zoom in a vehicle sight now (eased) and the vehicle whose model the first-person view hides. */
  private rideZoom = 1;
  private hiddenRide: Vehicle | null = null;
  /** First person in a vehicle: where the eye was (smoothed over bumps) and how much the view rolls (aircraft). */
  private readonly rideEye = new THREE.Vector3();
  private rideEyeSet = false;
  private camRoll = 0;
  /** A driver's sight fixed to the gun: the view is where the gun points (it follows the look with a delay). */
  private gunView: { yaw: number; pitch: number } | null = null;
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
  /** Seconds before the gadget can be used again (the next tube coming up, placing). */
  /** Sim time of the last use (view model: recoil / placing motion). */
  private gadgetUsedAt = -10;
  private buildTarget: FortSlot | null = null;
  private nextBlow = 0;
  /** Next time a giver may hand the same receiver the same thing: 'giver>receiver:kind' -> sim time. */
  private readonly giveReady = new Map<string, number>();

  // The local soldier's state, kept under its old names while the rest of the game moves to `me`.
  private get working(): number {
    return this.me.working;
  }
  private set working(v: number) {
    this.me.working = v;
  }
  private get buildMode(): boolean {
    return this.me.buildMode;
  }
  private set buildMode(v: boolean) {
    this.me.buildMode = v;
  }
  private get gadget(): GadgetId | null {
    return this.me.gadget;
  }
  private set gadget(v: GadgetId | null) {
    this.me.gadget = v;
  }
  private get gadgetCount(): number {
    return this.me.gadgetCount;
  }
  private set gadgetCount(v: number) {
    this.me.gadgetCount = v;
  }
  private get gadgetOut(): boolean {
    return this.me.gadgetOut;
  }
  private set gadgetOut(v: boolean) {
    this.me.gadgetOut = v;
  }
  private get gadgetBusy(): number {
    return this.me.gadgetBusy;
  }
  private set gadgetBusy(v: number) {
    this.me.gadgetBusy = v;
  }
  private get player(): Player {
    return this.me.player;
  }
  private get weapons(): WeaponController {
    return this.me.weapons;
  }
  private get playerBoxes(): CharacterHitboxes {
    return this.me.boxes;
  }
  private get playerCombatant(): Combatant {
    return this.me.combatant;
  }
  private get grenades(): GrenadeInventory {
    return this.me.grenades;
  }
  private get cls(): ClassId {
    return this.me.cls;
  }
  private set cls(c: ClassId) {
    this.me.cls = c;
  }
  /** Bot matches use a deploy screen: the player is off the field until deploying. */
  private get deployFlow(): boolean {
    return this.me.deployFlow;
  }
  private set deployFlow(v: boolean) {
    this.me.deployFlow = v;
  }
  private get deployed(): boolean {
    return this.me.deployed;
  }
  private set deployed(v: boolean) {
    this.me.deployed = v;
  }
  private get playerDowned(): boolean {
    return this.me.downed;
  }
  private get respawnTimer(): number {
    return this.me.respawnTimer;
  }
  private set respawnTimer(v: number) {
    this.me.respawnTimer = v;
  }
  private get medkits(): number {
    return this.me.medkits;
  }
  private set medkits(n: number) {
    this.me.medkits = n;
  }
  private get medkitUse(): number {
    return this.me.medkitUse;
  }
  private get killedBy(): string | null {
    return this.me.killedBy;
  }

  private constructor(
    private readonly container: HTMLElement,
    private readonly options: GameOptions,
  ) {
    this.myId = options.net?.start.me ?? PLAYER_ID;
    this.myTeam = options.net?.start.team ?? options.team ?? PLAYER_TEAM;
    this.settings = loadSettings();
    setLocale(this.settings.locale);
    const quality = resolveQuality(this.settings.quality);
    this.renderer = new Renderer(container, quality, this.settings.fov);
    this.renderer.setRenderScale(this.settings.renderScale);
    this.hud = new HUD(container);
    this.vehicleView = new VehicleView(this.hud.root);
    this.perf = new PerfPanel(container, this.renderer.gl, gpuName() || 'GPU: unknown');
    this.renderer.instrument(this.perf.section);
    this.overlay = new Overlay(container);
    this.scoreboard = new Scoreboard(container);
    this.audio = new AudioSystem(this.settings.masterVolume);
    this.audio.setVoiceVolume(this.settings.voiceVolume);
    this.viewModel = new ViewModel(this.renderer.fpScene, this.models);

    this.kbm = new KeyboardMouse(
      this.renderer.canvas,
      () => this.settings.sensitivity,
      () => this.settings.invertY,
      () => this.settings.crouchHold,
    );
    if (!options.showcase) this.sources.push(this.kbm);
    if (isTouchDevice() && !options.showcase) {
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
    game.overlay.show(t('title'), t('loading'), 'info');
    game.overlay.setProgress(0.04, t('load.map'));
    await game.init();
    return game;
  }

  private async init(): Promise<void> {
    let map: MapDef;
    const r = this.renderer;
    const q = r.quality;
    this.surfaces = new SurfaceLibrary(q.textureSize, Math.min(r.maxAnisotropy, q.anisotropy));
    // Art loads in parallel with physics/map; any asset that fails falls back gracefully.
    const art = Promise.all([
      this.surfaces.preload(SURFACE_KINDS, ASSET_BASE),
      this.surfaces.rasterizeAhead(PROCEDURAL_KINDS),
      this.audio.preload(`${ASSET_BASE}sounds/`),
      this.models.load(this.options.viewModels ?? []),
    ]);
    try {
      await loadCore();
    } catch (err) {
      this.overlay.show(t('error.wasm'), String(err instanceof Error ? err.message : err));
      throw err;
    }
    try {
      [this.physics, map] = await Promise.all([PhysicsWorld.create(), fetchMap(this.options.mapUrl)]);
    } catch (err) {
      this.overlay.show(t('error.map'), String(err instanceof Error ? err.message : err));
      throw err;
    }
    this.showLoadingInfo(map);
    const outdoor = map.world.visualProfile !== 'indoor';
    // `?procsky` (dev): the procedural sky instead of the photographed one, for comparing.
    const procSky = import.meta.env.DEV && new URLSearchParams(location.search).has('procsky');
    const [photoSky] = await Promise.all([
      procSky ? null : loadPhotoSky(map.world.visualProfile, ASSET_BASE),
      art,
      this.models.load([...(map.props ?? []).map((p) => p.model), ...(outdoor ? BACKDROP_MODELS : [])]),
    ]);
    // Vehicle models take the map's surfaces (paint, rubber, canvas) from here on.
    setVehicleSurfaces(this.surfaces);
    await this.loadStep(0.3, 'load.terrain');
    this.physics.timestep = 1 / SIM_HZ;
    this.audio.setAmbience(ambienceFor(map.world.visualProfile, (map.zones?.length ?? 0) > 0, map.world.ambience));
    this.atmosphere = new Atmosphere(r.scene, r.fpScene, r.gl, map.world.visualProfile, {
      shadows: q.shadows,
      shadowMapSize: q.shadowMapSize,
      shadowExtent: q.shadowExtent,
    }, photoSky);
    this.atmosphere.setViewRange(r.scene, r.camera, map.world.view?.far ?? 0);
    const t0 = performance.now();
    // Load-time breakdown (dev console): where the seconds go on big maps.
    const steps: string[] = [];
    let tStep = t0;
    const lap = (name: string) => {
      const now = performance.now();
      steps.push(`${name} ${Math.round(now - tStep)}`);
      tStep = now;
    };
    await this.loadStep(0.36, 'load.buildings');
    // Ground, colliders and map data as the game server builds them, plus the looks.
    const { terrain, shaped, water, sea, built } = buildWorld(map, this.physics, this.impacts, { scene: r.scene, surfaces: this.surfaces, terrainStep: r.preset === 'low' ? 2 : 1 });
    this.navExtra = built.navExtra;
    this.navBig = built.navBig;
    this.landingTeam = map.world.landing ?? null;
    this.sea = sea;
    lap('world');
    const props = placeProps(map, r.scene, this.models);
    lap('props');
    await this.loadStep(0.48, 'load.nature');
    if (water && terrain.rivers.length) r.scene.add(buildRivers(terrain, r.scene.environment));
    if (sea) {
      this.seaView = new SeaView(sea, terrain, r.camera.far, r.scene.environment, map.world.shore?.color ?? null);
      r.scene.add(this.seaView.mesh);
    }
    const winter = map.world.visualProfile === 'winter';
    const shore = map.world.shore ?? null;
    if (winter) {
      this.snowfall = new Snowfall(r.preset === 'low' ? 1200 : r.preset === 'medium' ? 2500 : 4000);
      r.scene.add(this.snowfall.points);
    }
    const kit = outdoor ? createConiferKit(q.msaa, winter, map.world.flora) : null;
    if (kit && map.trees?.length) {
      // Low quality (phones): 3D trees only close by, impostors beyond.
      this.forest = Forest.ofMap(map.trees, terrain, kit, r.gl, r.scene, r.preset === 'low' ? 55 : undefined);
      r.scene.add(this.forest.group);
    }
    const coverStyle = GROUND_COVER[map.world.groundMaterial ?? 'ground'];
    if (coverStyle && shaped && built.groundHandle !== null && r.preset !== 'low') {
      const kind = map.world.groundMaterial ?? 'ground';
      this.groundCover = new GroundCover(coverStyle, terrain.bounds(), this.physics, this.impacts, built.groundHandle, SURFACE_FROM_MATERIAL[kind], (x, y, z) => (!!water && (water.depthAt(x, y + 0.3, z) > 0 || (!!sea && water.seaAt(x, z) && y < sea.level + sea.swell / 2 + 0.3))) || (!!shore && y < shore.top + 0.4), q.msaa);
      r.scene.add(this.groundCover.mesh);
    }
    lap('water+forest');
    await this.loadStep(0.56, 'load.scenery');
    this.fitShadows(map, terrain, built.root, props);
    if (kit) this.backdrop = buildBackdrop(r.scene, terrain, { lowDetail: q.backdropDetail === 'low', gl: r.gl, models: this.models, msaa: q.msaa, mapHasTerrain: shaped, kit, winter, desert: map.world.visualProfile === 'desert', phone: r.preset === 'low', ash: map.world.shore?.ash });
    lap('backdrop');
    if (import.meta.env.DEV) console.info(`[strikegy] world built in ${Math.round(performance.now() - t0)} ms (${steps.join(', ')})`);

    this.effects = new Effects(r.scene, this.physics, q.dynamicLights);
    // Someone else's rounds cracking past one's head.
    this.effects.onPass = (at, miss) => {
      if (this.player.alive) this.audio.crack(at, miss);
    };
    this.throwables = new Throwables(r.scene, this.physics, this.bus);
    this.gadgets = new GadgetWorld(this.physics, this.registry, {
      explode: (kind, point, owner) => this.blast(kind, point, owner, t(kind === 'rocket' ? 'gadget.assault' : 'gadget.mine')),
      directHit: (target, part, point, owner) => this.rocketHit(target, part, point, owner),
      smoke: (point) => {
        this.effects.smoke(point, GRENADES.smoke.duration ?? 20, GRENADES.smoke.radius);
        this.audio.smokePop(point, GRENADES.smoke.duration ?? 20);
      },
      destroyed: (_kind, point) => this.audio.grenadeBounce(point, 12),
      shell: (gun, point, owner, target, part, wet) => this.shellHit(gun, point, owner, target, part, wet),
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
      // On the game server the crates hand things out there.
      resupply: (team, pos, reach) => !this.options.net && this.crateResupply(team, pos, reach),
      landed: (pos) => this.audio.gadget('place', pos),
      vehicle: (owner, near) => this.callRocketTank(owner, near),
      planeDown: (pos, team, by) => {
        this.effects.explosion(pos);
        this.audio.explosion(pos, this.renderer.camera.position.distanceTo(pos), 'heavy');
        if (by) this.hud.addKill({ attacker: by.id === this.myId ? playerName(t('feed.you')) : by.name, victim: t('support.recon'), weapon: by.weapon, headshot: false, attackerTeam: by.team ?? otherTeam(team), victimTeam: team });
      },
    }, Math.random, this.registry);
    r.scene.add(this.support.group);
    r.scene.add(this.airMarkers.group);
    this.supportMenu = new SupportMenu(this.hud.root, (id) => this.pickSupport(id));
    // What this match allows (free-for-all: no sides, squads or vehicles), before the soldiers and bots are made.
    const asked = this.options.mode ?? 'auto';
    const zoned = asked !== 'skirmish' && (asked !== 'auto' || !!this.options.bots) && (map.zones?.length ?? 0) > 0;
    setMatchFlags(matchFlagsFor(zoned ? pickMode(map, asked === 'auto' ? undefined : (asked as ModeKind), true) : null, !!this.options.simple));
    const ownSpawn = (s: SpawnPoint) => s.team === this.myTeam || (this.myTeam === 'blue' && s.team === 'player');
    this.spawn = (this.myTeam === 'blue' ? map.spawns.find((s) => s.team === 'player') : undefined) ?? map.spawns.find(ownSpawn) ?? map.spawns[0]!;
    const firstKit = this.loadouts.current;
    this.me = new Soldier({
      id: this.myId,
      team: this.myTeam,
      name: () => playerName(t('feed.you')),
      local: true,
      physics: this.physics,
      bus: this.bus,
      impacts: this.impacts,
      registry: this.registry,
      spawn: new THREE.Vector3(...this.spawn.pos),
      yaw: this.spawn.yaw * DEG,
      loadout: this.options.sandbox ? this.options.loadout : loadoutWeapons(firstKit),
      now: () => this.simTime,
      combatClock: () => this.bots?.time ?? this.simTime,
    });
    this.me.hooks = this.soldierHooks();
    this.me.weapons.viewKeep = this.touch ? VIEW_KEEP.touch : VIEW_KEEP.desktop;
    if (this.options.net) this.me.authority = false;
    this.player.water = water;
    this.playerSpawns = map.spawns.filter(ownSpawn);
    this.mapSpawns = map.spawns;
    this.mapName = map.meta.name;

    const botOpts = this.options.bots ?? null;
    if (!botOpts) {
      for (const tg of map.targets ?? []) {
        this.targets.push(
          new TargetDummy(r.scene, this.physics, this.registry, new THREE.Vector3(...tg.pos), (tg.yaw ?? 0) * DEG),
        );
      }
    }

    this.cls = firstKit.cls;
    this.grenades.reset(firstKit.grenade);
    this.weapons.endlessReserve = !this.options.sandbox && (firstKit.cls === 'support' || MATCH.simple);

    const net = this.options.net;
    if (net && !this.touch && net.start.roster.some((r) => r.bot) && (map.zones?.length ?? 0) > 0) {
      // A desktop in a room with bots runs some of them (setupNetBots): they need the navmesh (before the fortifications, which cut it).
      await this.loadStep(0.62, 'load.nav');
      this.physics.step();
      this.nav = await NavWorld.build(this.physics, this.navExtra ?? undefined, this.navBig);
    } else if (botOpts && botOpts.allies + botOpts.enemies > 0) {
      await this.loadStep(0.62, 'load.nav');
      // Colliders must be in the broadphase before the navmesh reads them.
      this.physics.step();
      const tNav = performance.now();
      this.nav = await NavWorld.build(this.physics, this.navExtra ?? undefined, this.navBig);
      if (import.meta.env.DEV) console.info(`[strikegy] navmesh built in ${Math.round(performance.now() - tNav)} ms`);
      if (this.nav) {
        // Every soldier + weapon model, built in pieces so the loading screen keeps drawing.
        await this.loadStep(0.72, 'load.soldiers');
        await SoldierModel.prewarmSteps(['blue', 'red'], BOT_WEAPONS.map((id) => WEAPONS[id]), () => this.loadStep(0.72, 'load.soldiers'));
        this.bots = new BotManager(r.scene, this.physics, this.nav, this.registry, this.impacts, this.bus, this.audio, this.effects, this.playerCombatant, map.spawns, { ...botOpts, side: this.myTeam });
        this.bots.grenades = this.throwables;
        this.bots.landing = map.world.landing ?? null;
        this.bots.gadgets = this.gadgets;
        this.bots.squadKey = (b) => this.squadKeyOf(b.team, b.id);
        this.bots.setTactical(built.windows, built.footprints);
        // Cover, peek spots and zone positions for the bots (cached like the navmesh).
        await this.loadStep(0.76, 'load.tactics');
        const tTac = performance.now();
        const tactics = await loadTactics(this.nav, this.physics, () => this.loadStep(0.76, 'load.tactics'));
        this.bots.setTactics(tactics, map.world.size);
        if (import.meta.env.DEV) console.info(`[strikegy] tactical points: ${tactics.count} in ${Math.round(performance.now() - tTac)} ms`);
        if (map.trees) this.bots.setForest(map.trees, map.world.size, (x, z) => terrain.heightAt(x, z), map.world.flora);
        if (water) this.bots.setWater(water);
        const bots = this.bots;
        this.weapons.onRound = (from, to, hitId, pellet) => bots.nearMiss(from, to, { id: this.myId, team: this.myTeam }, hitId, pellet ? 0.35 : 1);
        // Vehicles come with zone matches: their drivers route on a mesh as wide as a tank.
        if ((map.zones?.length ?? 0) > 0 && !this.options.sandbox) {
          await this.loadStep(0.8, 'load.vehicleNav');
          const tVeh = performance.now();
          bots.vehicleNav = await VehicleNav.build(this.physics, this.navBig?.coarseExtra ?? this.navExtra ?? undefined);
          if (import.meta.env.DEV) console.info(`[strikegy] vehicle navmesh built in ${Math.round(performance.now() - tVeh)} ms`);
        }
      }
    }
    await this.loadStep(0.88, 'load.battle');
    this.mapImage = paintMap(map, terrain.boundary, 2048);
    this.minimap = new Minimap(this.hud.root, this.mapImage);
    const mode = this.options.mode ?? 'auto';
    if (mode !== 'skirmish' && (mode !== 'auto' || this.bots) && (map.zones?.length ?? 0) > 0) {
      this.setupZoneMode(map, terrain, mode === 'auto' ? undefined : mode);
      if (!MATCH.simple) this.setupFortifications(map, terrain, water, built);
      if (this.bots && !this.options.sandbox && MATCH.vehicles) this.setupVehicles(map, water);
    }
    // The range and other maps with vehicles at fixed spots (a boat at the pier) but no zone match.
    if (!this.vehicles && !this.options.net && map.vehicles?.length) this.setupVehicles(map, water, true);
    if (this.options.net) await this.setupNet(map, terrain, built, water);
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
          return support.request(kind, point, owner, this.squadRpOf(sq), bot.team === this.myTeam);
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
    await this.loadStep(0.93, 'load.shaders');
    await this.warmup();
    this.overlay.setProgress(1, t('load.shaders'));

    // Settle the physics broadphase so the first raycasts see static geometry.
    this.physics.step();

    this.overlay.setContext(this.zoneMode ? `${this.mapName} · ${t(`mode.${this.zoneMode.kind}`)}` : this.mapName);
    if (this.options.showcase) return this.startShowcase();
    document.addEventListener('pointerlockchange', () => {
      if (!this.kbm.locked && !this.touch && !this.deployScreen?.visible) this.pause();
    });
    // A page opened straight from a link had no click yet: sound starts on the first one.
    const wake = () => this.audio.wake();
    document.addEventListener('pointerdown', wake, { capture: true });
    document.addEventListener('keydown', wake, { capture: true });
    // The range on a desktop: a click on the game takes the mouse (also when taking it at the start failed).
    r.canvas.addEventListener('mousedown', () => {
      if (this.running && !this.touch && !this.kbm.locked && !this.overlay.visible && !this.deployScreen?.visible) this.kbm.requestLock();
    });
    // Esc on a pause opened from the deploy screen goes back to it (no mouse to take there).
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || e.defaultPrevented || !this.overlay.visible || this.overlay.kind !== 'pause') return;
      if (this.deployFlow && !this.deployed) this.resume();
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
    this.begin();
    this.net?.ready(!!this.netBots);
  }

  /** The loading screen's match line: mode, the map's name and facts, the map from above. */
  private showLoadingInfo(map: MapDef): void {
    const asked = this.options.mode ?? 'auto';
    // The same test as the match's own set-up below: no zones (or none in play) is the range / a skirmish.
    const zones = map.zones?.length ?? 0;
    const zoned = asked !== 'skirmish' && (asked !== 'auto' || !!this.options.bots) && zones > 0;
    const kind = zoned ? pickMode(map, asked === 'auto' ? undefined : (asked as ModeKind), true) : null;
    const nameKey = `map.${map.meta.id}` as MessageKey;
    const name = t(nameKey) === nameKey ? map.meta.name : t(nameKey);
    const facts: string[] = [];
    if (zones) facts.push(t('lobby.zones').replace('{n}', String(zones)));
    const b = this.options.bots;
    if (b && b.allies + b.enemies > 0) facts.push(`${b.allies + 1} vs ${b.enemies}`);
    this.overlay.setLoadingInfo({
      mode: kind ? t(`mode.${kind}` as MessageKey) : this.options.bots ? t('lobby.skirmish') : t('menu.range'),
      name,
      facts: facts.join(' · '),
      picture: paintMapCard(map, 1400),
    });
  }

  /** Loading: moves the bar and lets the page draw it before the next long step. */
  private async loadStep(fraction: number, step: MessageKey): Promise<void> {
    this.overlay.setProgress(fraction, t(step));
    // A frame to draw it; a hidden tab gets no frames, so a timer stands in.
    await new Promise<void>((done) => {
      let fired = false;
      const go = () => {
        if (fired) return;
        fired = true;
        setTimeout(done, 0);
      };
      requestAnimationFrame(go);
      setTimeout(go, 60);
    });
  }

  /**
   * Straight in once loaded (the main menu was the start screen): the deploy
   * screen, or the range itself. Taking the mouse needs a click; when the menu's
   * click is too long ago, the first click on the game takes it.
   */
  private begin(): void {
    this.startTutorial();
    this.audio.unlock();
    this.running = true;
    this.started = true;
    this.loop.reset();
    this.overlay.hide();
    if (this.deployFlow && !this.deployed) this.openDeploy();
    else if (this.touch) this.touch.setVisible(true);
    else this.kbm.requestLock();
  }

  /**
   * Renders every weapon, grenade and effect once behind the loading overlay so
   * all shader programs (including shadow depth variants) are compiled up front.
   * Otherwise the first shot, throw or weapon switch stalls the frame.
   */
  private async warmup(): Promise<void> {
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
    // Compile first (off the page where the browser can), then draw: the draws find the shaders ready.
    await r.precompile();
    for (const id of this.weapons.loadout) {
      this.viewModel.setWeapon(WEAPONS[id]);
      this.viewModel.onFire(false, WEAPONS[id].kick);
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
      // One weapon a step: the loading screen keeps drawing between them.
      await this.loadStep(0.96, 'load.shaders');
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
      // A suppressed gun is only heard close by.
      this.bots?.alert(this.player.feet, quiet ? 22 : 70, this.playerCombatant);
      this.audio.gunshot(cls(e.weaponId), e.ads, quiet, e.weaponId);
      // The last rounds sound different (Modern Warfare's low-ammo rattle).
      const ws = this.weapons.state;
      const def = WEAPONS[e.weaponId as WeaponId];
      if (def.magSize >= 8 && ws.ammo > 0 && ws.ammo <= Math.max(2, Math.round(def.magSize * 0.17))) this.audio.lowAmmo(def.class);
      const kick = WEAPONS[e.weaponId as WeaponId].kick;
      this.viewModel.onFire(e.ads, kick);
      this.punchCamera(kick, e.ads);
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
      // On the game server the hit marker waits for its word (`onNetEvents`).
      if (e.byPlayer && !this.net) {
        this.hud.showHit(e.part === 'head', e.killed, e.damage);
        this.audio.hit(e.part === 'head', e.killed);
      }
      if (e.targetId !== this.myId) {
        if (this.bots || this.net) this.effects.bodyHit(e.point);
        else this.effects.targetHit(e.point);
      }
    });
    // Free-for-all: everyone else is an enemy in the feed.
    bus.on('combat:kill', (e) => this.hud.addKill(MATCH.ffa ? { ...e, attackerTeam: 'red', victimTeam: 'red' } : e));
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
    bus.on('player:slide', (e) => {
      this.audio.bodySlide(e.surface);
      this.bots?.alert(e.point, HEAR_STEP_SPRINT, this.playerCombatant, 'step');
    });
    bus.on('player:landed', (e) => {
      this.audio.land(e.impactSpeed, e.surface);
      this.viewModel.onLand(e.impactSpeed);
      this.shake = Math.min(0.03, this.shake + e.impactSpeed * 0.0008);
    });
  }

  /** Muzzle flash on a shot; casing ejection on shot (or on cycle for pump/bolt guns). */
  /** One's own shot jolts the camera (only the look: the aim is `WeaponController.recoil`). */
  private punchCamera(k: ShotKick, ads: boolean): void {
    const p = this.punch;
    p.pitch.rate = p.roll.rate = p.yaw.rate = k.settle;
    p.pitch.kick(k.punch * (ads ? 0.75 : 1));
    p.roll.kick((Math.random() < 0.5 ? -1 : 1) * k.punch * (0.6 + Math.random() * 0.5));
    p.yaw.kick((Math.random() - 0.5) * k.punch * 0.6);
  }

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
    this.briefing?.setPaused(false);
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

  /**
   * The pause menu, Modern Warfare style: resume / settings / (touch) button
   * layout / back to the lobby in a column, the controls or the settings
   * beside it. Settings apply at once (volume, sensitivity, FOV, FPS display);
   * quality and language on the next load.
   */
  private pause(view: 'controls' | 'settings' = 'controls'): void {
    // Not over the result screen: ending the match lets go of the mouse, which used to pause.
    if (!this.started || this.matchOver) return;
    this.running = false;
    this.briefing?.setPaused(true);
    this.touch?.setVisible(false);
    // From the deploy screen: it steps aside; resuming opens it again.
    this.deployScreen?.hide();
    const touch = !!this.touch;
    this.overlay.show(t('paused'), '', 'pause');
    let viewEl: HTMLElement;
    let panel: SettingsPanel | null = null;
    if (view === 'settings') {
      panel = this.settingsPanel();
      viewEl = panel.root;
    } else {
      viewEl = document.createElement('div');
      viewEl.className = 'ds-keys';
      // Simplified matches list only the controls they keep.
      renderHint(viewEl, t(MATCH.simple ? (touch ? 'start.hintTouchSimple' : 'start.hintSimple') : touch ? 'start.hintTouch' : 'start.hint'));
    }
    this.overlay.setPause({
      context: this.zoneMode ? `${this.mapName} · ${t(`mode.${this.zoneMode.kind}`)}` : this.mapName,
      title: t('paused'),
      view: viewEl,
      busy: () => !!panel?.capturing,
      viewKeys: (e) => {
        if (!panel || (e.code !== 'KeyQ' && e.code !== 'KeyE')) return false;
        panel.stepCategory(e.code === 'KeyQ' ? -1 : 1);
        return true;
      },
      entries: this.pauseEntries(view),
    });
  }

  /** The pause menu's entries: resume, the two views, the touch layout, the tutorial, quit. */
  private pauseEntries(view: 'controls' | 'settings'): OverlayAction[] {
    const touch = !!this.touch;
    return [
      { label: t('pause.resume'), onClick: () => this.resume() },
      { label: t('menu.controls'), selected: view === 'controls', onClick: () => this.pause('controls') },
      { label: t('pause.settings'), selected: view === 'settings', onClick: () => this.pause('settings') },
      ...(touch
        ? [
            {
              label: t('layout.edit'),
              onClick: () => {
                this.overlay.hide();
                this.touch?.editLayout(() => this.pause());
              },
            },
          ]
        : []),
      ...(this.tutorial
        ? [
            {
              label: t('tut.skip'),
              onClick: () => {
                this.endTutorial(true);
                this.pause(view);
              },
            },
          ]
        : []),
      { label: t('pause.quit'), primary: true, onClick: () => this.quit() },
    ];
  }

  // ---------------------------------------------------------------------------
  // First-play tutorial (core/tutorial.ts): the basics on the first match or
  // range visit and from the menu, the match steps on the first match.

  private startTutorial(): void {
    if (this.tutorial || this.tutorialPanel) return;
    const guided = !!this.options.tutorial;
    const seen = loadSeen();
    // The menu's tutorial shows the match tips again on the next match.
    if (guided && seen.match) saveSeen({ ...seen, match: false });
    const steps = stepsFor(guided, guided ? {} : seen, {
      deployFlow: this.deployFlow,
      zones: !!this.zoneMode,
      fort: !!this.fort,
      support: !!this.playerSquad && MATCH.callIns,
      simple: MATCH.simple,
    });
    if (!steps.length) return;
    this.tutorial = new TutorialRun(steps);
    this.tutorialPanel = new TutorialPanel(this.container, !!this.touch, () => this.endTutorial(true));
    const p = this.player.feet;
    Object.assign(this.tutLast, { x: p.x, z: p.z, ammo: -1, weapon: '', reloading: false, crouching: this.player.crouching });
  }

  /** Done or skipped: remembered so it doesn't come back (the menu's tutorial replays it). */
  private endTutorial(skipped: boolean): void {
    const run = this.tutorial;
    if (!run) return;
    run.skip();
    const seen = loadSeen();
    if (run.steps.some((id) => STEPS.find((s) => s.id === id)!.basic)) seen.basics = true;
    if (run.steps.some((id) => !STEPS.find((s) => s.id === id)!.basic) || (!this.options.tutorial && this.deployFlow)) seen.match = true;
    saveSeen(seen);
    this.tutorial = null;
    this.tutorialEndLeft = skipped ? 0 : 5;
  }

  /** Feeds the tutorial what the player did this frame (input still holds its presses). */
  private stepTutorial(dt: number, input: InputState): void {
    const panel = this.tutorialPanel;
    if (!panel) return;
    const run = this.tutorial;
    const p = this.player;
    const w = this.weapons;
    const last = this.tutLast;
    const deploying = !!this.deployScreen?.visible;
    const onField = this.running && p.alive && this.deployed && !this.overlay.visible;
    if (run) {
      const moved = Math.min(1, Math.hypot(p.feet.x - last.x, p.feet.z - last.z));
      const ammo = w.state.ammo;
      const fired = w.def.id === last.weapon && last.ammo >= 0 && ammo < last.ammo;
      const probe: TutorialProbe = {
        dt,
        onField,
        deploying,
        moved: onField && !this.ride ? moved : 0,
        turned: Math.abs(input.lookYaw) + Math.abs(input.lookPitch),
        sprinting: p.sprinting,
        crouched: input.crouchToggle || p.sliding || p.crouching !== last.crouching,
        jumped: input.jump,
        fired,
        ads: input.ads && w.adsBlend > 0.5,
        reloaded: w.state.reloading && !last.reloading,
        grenade: input.throwGrenade,
        medkit: input.medkit,
        interact: input.interactPressed,
        building: this.buildMode,
        supportOpen: this.supportMenu.open,
        inZone: !!this.zoneMode?.zoneAt(p.feet),
      };
      run.update(probe);
      if (run.finished) this.endTutorial(false);
    }
    Object.assign(last, { x: p.feet.x, z: p.feet.z, ammo: w.state.ammo, weapon: w.def.id, reloading: w.state.reloading, crouching: p.crouching });
    if (!this.tutorial && this.tutorialEndLeft > 0) this.tutorialEndLeft -= dt;
    const ended = !this.tutorial && this.tutorialEndLeft > 0;
    panel.update(this.tutorial, (onField || (deploying && this.tutorial?.current?.id === 'deploy')) && !this.matchOver, deploying, ended);
    if (!this.tutorial && !ended) {
      panel.root.remove();
      this.tutorialPanel = null;
    }
  }

  private settingsPanelCache: SettingsPanel | null = null;

  /** The lobby's settings, live: what can change mid-match does at once. */
  private settingsPanel(): SettingsPanel {
    this.settingsPanelCache ??= new SettingsPanel(this.settings, {
      live: true,
      onChange: (key) => {
        if (key === 'masterVolume') this.audio.setVolume(this.settings.masterVolume);
        if (key === 'voiceVolume') this.audio.setVoiceVolume(this.settings.voiceVolume);
        if (key === 'subtitles') this.briefing?.setSubtitles(this.settings.subtitles);
        if (key === 'renderScale') this.renderer.setRenderScale(this.settings.renderScale);
        // Toggled down when crouching becomes held: stand up (the key isn't held).
        if (key === 'crouchHold' && this.settings.crouchHold && this.player.crouchToggled) this.kbm.flipCrouchOnce();
      },
    });
    this.settingsPanelCache.render();
    return this.settingsPanelCache;
  }

  private frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    // Behind the menu, every other frame is plenty.
    if (this.showcaseCam) {
      if (now - this.showcaseAt < 30) return;
      this.showcaseAt = now;
    }
    const frameMs = now - this.lastTime;
    const tStart = performance.now();
    let simMs = 0;
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.elapsed += dt;
    this.countFps(dt);
    this.briefing?.update();
    this.briefDirector?.update(dt);

    const input = this.input;
    resetFrameInput(input);
    for (const s of this.sources) s.apply(input);
    this.stepTutorial(dt, input);

    const w = this.weapons;
    const p = this.player;
    let lookYaw = 0;
    let lookPitch = 0;
    const simDt = this.running ? dt : 0;
    if (this.running) {
      const adsFov = this.aimFov() * (this.settings.fov / AUTHORED_FOV);
      const adsScale = this.settings.adsSensitivity * (adsFov / this.settings.fov);
      // In a zoomed vehicle sight the look slows with the zoom.
      const sens = (1 + (adsScale - 1) * w.adsBlend) / (this.ride ? this.rideZoom : 1);
      if (p.alive || this.playerDowned) {
        lookYaw = input.lookYaw * sens;
        lookPitch = input.lookPitch * sens;
        if (this.touch && this.deployed) {
          [lookYaw, lookPitch] = applyAimAssist(lookYaw, lookPitch, this.assistTarget(), { ads: w.adsBlend > 0.5, firing: input.fire, dt });
        }
        if (this.orbiting()) {
          const o = (this.orbit ??= { yaw: p.yaw, pitch: THREE.MathUtils.clamp(p.pitch - 0.12, ORBIT.min, ORBIT.max) });
          o.yaw = (o.yaw + lookYaw) % (Math.PI * 2);
          o.pitch = THREE.MathUtils.clamp(o.pitch + lookPitch, ORBIT.min, ORBIT.max);
          this.orbitAim(o);
        } else {
          this.orbit = null;
          p.applyLook(lookYaw, lookPitch);
        }
      }
      const tSim = performance.now();
      const alpha = this.loop.advance(dt, (h) => this.simStep(h));
      this.lastAlpha = alpha;
      simMs = performance.now() - tSim;
      this.net?.placeVehicles();
      this.vehicles?.render(alpha, this.renderer.camera.position);
      this.escort?.render(alpha);
      this.updateAirMarkers();
      if (this.net) this.syncNetChute();
      this.renderRider(alpha, dt);
      if (this.chute) {
        const p = this.player;
        this.chute.position.lerpVectors(p.prevFeet, p.feet, alpha);
        this.chute.rotation.y = p.yaw;
      }
      if (this.showcaseCam) {
        this.showcaseCam.update(dt, this.renderer.camera);
        this.sceneFollowsCamera(this.renderer.camera.position);
      } else this.updateCamera(alpha, dt, adsFov);
    }
    input.lookYaw = 0;
    input.lookPitch = 0;

    for (const tg of this.targets) tg.update(simDt);
    this.bots?.render(this.lastAlpha, dt, this.renderer.camera);
    this.netBots?.render(this.lastAlpha, dt, this.renderer.camera);
    if (this.net) {
      this.net.flush();
      this.net.render(dt);
    }
    this.zoneVisuals?.update(this.elapsed, this.renderer.camera.position);
    if (this.tagVisuals && this.zoneMode?.match instanceof KillConfirmRules) this.tagVisuals.update(this.zoneMode.match.tags, this.myTeam, this.elapsed);
    if (this.chargeVisuals && this.zoneMode?.charges) this.chargeVisuals.update(this.zoneMode.charges.charges, this.elapsed);
    if (this.lastStandVisuals && this.zoneMode?.lastStand) this.lastStandVisuals.update(this.zoneMode.lastStand, this.elapsed);
    if (this.deployScreen && this.running && !this.showcaseCam) {
      if (!this.deployed && !this.deployScreen.visible && this.elapsed >= this.deployAt && !this.matchOver && !this.netDeploying) this.openDeploy();
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
    this.effects.spawnShots(w.traces, this.tmpMuzzle, true);
    this.effects.update(simDt);
    this.flashLeft = Math.max(0, this.flashLeft - simDt);
    this.audio.updateVitals(p.health.value, p.alive);
    this.audio.updateAmbience(dt);
    if (!this.showcaseCam) {
      this.updateHud(dt);
      this.updateScoreboard(dt, input.scoreboard);
    }
    const perf = this.perf;
    perf.setVisible(this.settings.showFps);
    const tDraw = performance.now();
    if (this.renderer.render()) perf.onShadowUpdate();
    const tEnd = performance.now();
    perf.record(
      { frameMs, simMs, updateMs: tDraw - tStart - simMs, renderMs: tEnd - tDraw },
      `${this.renderer.preset.toUpperCase()} ×${this.renderer.renderScale.toFixed(2)} (F4) · ${this.renderer.canvas.width}×${this.renderer.canvas.height}${this.netLabel()} · ${this.audio.stats()}`,
    );
  };

  /** In a match on the game server: how match data travels (UDP or TCP) and snapshots a second, for the F3 panel. */
  private netRate = { at: 0, count: 0, perSecond: 0 };
  private netLabel(): string {
    const net = this.net;
    if (!net) return '';
    const now = performance.now();
    const r = this.netRate;
    if (now - r.at >= 1000) {
      r.perSecond = r.at ? Math.round(((net.snapshots - r.count) * 1000) / (now - r.at)) : 0;
      r.at = now;
      r.count = net.snapshots;
    }
    // Out and in separately: either way may fall back to the WebSocket on its own.
    return ` · ↑${net.link.udp ? 'UDP' : 'TCP'} ↓${net.link.udpIn ? 'UDP' : 'TCP'} ${r.perSecond}/s`;
  }

  /** What the local view does when its soldier is hurt, goes down, gets up or dies. */
  private soldierHooks(): SoldierHooks {
    return {
      hurt: (amount, from, cause) => {
        const p = this.player;
        // Flinch (gunplay audit, 2026-10-18, Modern Warfare style): a round
        // knocks the aim up a little, less down the sights; the look moves,
        // so the game server gets it with the next input.
        if (cause === 'bullet' && !this.ride) {
          const f = Math.min(FLINCH.max, amount * FLINCH.perDamage) * (this.weapons.adsBlend > 0.5 ? FLINCH.ads : 1);
          p.applyLook((Math.random() - 0.5) * f * 0.8, f);
        }
        if (this.touch) navigator.vibrate?.(Math.min(60, 15 + amount));
        let yaw: number | null = null;
        if (from) {
          const d = from.clone().sub(p.feet);
          yaw = Math.atan2(-d.x, -d.z);
        }
        this.hud.showDamage(yaw, amount);
        this.audio.hurt(amount);
        this.shake = Math.min(0.05, this.shake + amount * 0.0004);
      },
      falling: () => {
        if (this.ride) this.leaveVehicle();
        if (this.chute) this.dropChute();
      },
      down: (cause) => {
        this.buildMode = false;
        this.reviveOf = null;
        this.reviveProgress = 0;
        this.interact = null;
        // Kills by others are reported by whoever made them; self-inflicted ones here.
        if (!this.killedBy) {
          const weapon = cause === 'explosion' ? t('grenade.frag') : cause === 'fall' ? '↓' : '';
          this.hud.addKill({ attacker: 'You', victim: 'You', weapon, headshot: false });
        }
      },
      revived: (by) => {
        this.hud.notify(`${t('notify.revived')} — ${by}`, 'ally');
        this.audio.revived();
      },
      died: () => {
        if (this.deployFlow) this.deployAt = this.elapsed + DEATH_CAM_SEC * 0.5;
      },
      medkit: () => this.audio.medkit(),
    };
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
    // What a simplified match doesn't have goes before anything (solo or sent to the server) sees it.
    simplifyInput(this.input);
    if (this.net) return this.netStep(dt, this.net);
    const input = this.input;
    const p = this.player;
    this.simTime += dt;
    if (this.sea) this.sea.time = this.simTime;
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
      if (input.medkit) this.me.useMedkit();
      this.me.stepMedkit(dt);
      this.stepInteract(dt, input);
      if (!this.interact && input.interactPressed && this.tryEnterVehicle()) return this.finishStep(dt, input);
      if (input.throwGrenade && this.throwCooldown === 0 && !p.sprinting && !p.swimming) this.throwGrenade();
      // Hands busy (throwing, patching up, reviving, at a charge): no shooting.
      const busy = this.throwBlock > 0 || this.medkitUse > 0 || this.reviveProgress > 0 || this.working >= 0 || this.buildMode || this.gadgetOut || this.supportAim !== null || this.me.using;
      // Barbed wire slows everyone wading through it.
      this.me.stepOnFoot(dt, input, busy, this.fort?.slowAt(p.feet) ?? 1);
      this.stepSway(dt, input.holdBreath);
    } else if (this.playerDowned) {
      this.me.stepDowned(dt, input.jumpHeld);
    } else {
      this.respawnTimer -= dt;
      // With a deploy screen the player chooses when to go; otherwise respawn automatically.
      if (!this.deployFlow && this.respawnTimer <= 0) this.respawn();
    }
    this.finishStep(dt, input);
  }

  /**
   * A step in a match on the game server: the same as the server steps this
   * soldier with the input sent for it (rounded the way the wire rounds it),
   * so prediction and the server agree. On foot only for now: gadgets,
   * building, vehicles and call-ins aren't run by the server yet.
   */
  private netStep(dt: number, net: NetMatch): void {
    const input = this.input;
    const p = this.player;
    const w = this.weapons;
    const me0 = this.me;
    this.simTime += dt;
    if (this.sea) this.sea.time = net.serverTick() * SIM_DT;
    if (input.firePressed) input.fire = true;
    // Recon: the wheel changes scope power while aiming (before packing: the server mustn't switch weapons).
    if (this.cls === 'recon' && w.def.scope && w.adsBlend > 0.5 && input.weaponCycle !== 0) {
      this.reconZoom = !this.reconZoom;
      input.weaponCycle = 0;
    }
    // The call-in menu takes 1..5 and the trigger while it is up (also before packing).
    if (p.alive && this.deployed) {
      this.stepSupport(input);
      if (this.supportAim) {
        me0.gadgetOut = false;
        me0.buildMode = false;
      }
    }
    const n = net.pack(input, p.yaw, p.pitch, w.sway.yaw, w.sway.pitch);
    p.yaw = n.yaw;
    p.pitch = n.pitch;
    w.sway.yaw = n.swayYaw;
    w.sway.pitch = n.swayPitch;
    const me = this.me;
    if (p.alive && this.deployed && this.ride) this.netRide(dt, input, net);
    else if (p.alive && this.deployed && me.chute) {
      // Under the canopy: the same drift the server runs; the gun still works.
      if (me.stepChute(dt, input, this.physics)) w.redraw();
      else w.step(dt, input, p, false);
      net.stepped(n.seq, p.feet);
    } else if (p.alive && this.deployed) {
      // In the order the server steps a soldier (MatchSim.stepSoldier).
      const kit = this.netKit();
      me.stepTimers(dt);
      kitToggles(me, input, !!this.fort);
      stepGadget(me, input, dt, kit);
      if (me.buildMode || me.gadgetOut) {
        input.ads = false;
        input.reload = false;
      }
      if (input.medkit) me.useMedkit();
      me.stepMedkit(dt);
      const atCharge = this.stepCharge(input);
      const reviving = !atCharge && this.netRevive(net, input.interact, dt);
      this.buildTarget = null;
      if (atCharge || reviving || this.interact) me.working = -1;
      else {
        const view = stepFort(me, input, dt, kit);
        this.buildTarget = view.target;
        if (view.station) this.interact = { kind: 'fort', job: view.job, station: view.station, note: view.note ? t(view.note as MessageKey) : null };
      }
      // The server throws it; here only the hands move.
      if (input.throwGrenade) me.throwGrenade(null);
      const busy = me.throwBlock > 0 || this.medkitUse > 0 || reviving || me.working >= 0 || me.buildMode || me.gadgetOut || this.supportAim !== null || me.using;
      me.stepOnFoot(dt, input, busy, this.fort?.slowAt(p.feet) ?? 1);
      this.stepSway(dt, input.holdBreath);
      net.stepped(n.seq, p.feet, p.platform);
    } else if (this.playerDowned) this.me.stepDowned(dt, input.jumpHeld);
    else this.respawnTimer -= dt;
    this.me.syncBoxes();
    this.netBots?.step(dt);
    this.throwables.step(dt);
    this.support.step(dt);
    // Following the server: the fortress truce comes and goes with its copy of the rules.
    this.zoneMode?.syncFlags();
    this.stepEscort();
    this.physics.step();
    this.vehicles?.afterStep();
    consumePulses(input);
  }

  /**
   * In a vehicle in a match on the game server: the driver drives it here
   * (and the server is sent where it is), a gunner's gun follows the view
   * and fires here for the look and sound (the server fires the real
   * rounds). Getting in, out and changing seats is the server's word
   * (`netSeat`).
   */
  private netRide(dt: number, input: InputState, net: NetMatch): void {
    const { v, seat } = this.ride!;
    const p = this.player;
    this.interact = null;
    if (input.viewToggle) this.rideThird = !this.rideThird;
    const spec = v.spec.seats[seat]!;
    if (spec.station?.kind === 'flight') this.flightStation(v, input);
    if (spec.role === 'driver' && net.drive === v) v.drive(dt, { throttle: input.moveY, steer: input.moveX, brake: input.jumpHeld, aimYaw: p.yaw, aimPitch: p.pitch });
    if (v.ship && spec.gun) {
      // Laid here for the look; the server lays and fires its own (from the seat's look).
      const eye = v.seatEye(seat, new THREE.Vector3());
      const target = lookPoint(this.physics, eye, viewDir(p.yaw, p.pitch), v.mounts[seat]!.gun.range, this.gadgets.water?.(eye.x, eye.z) ?? NaN, v.body);
      const { laid } = layGun(v, seat, target, dt);
      if (!v.ship.broken.has(seat) && v.pullTrigger(seat, input.fire && laid, this.simTime, dt)) net.mountFired(v, seat, 1);
    } else if (spec.gun) {
      v.aimMount(seat, p.yaw, p.pitch, dt);
      this.keepLookInReach(v, seat);
      if (v.pullTrigger(seat, input.fire, this.simTime, dt)) {
        net.mountFired(v, seat, 1);
        this.shake = Math.min(0.03, this.shake + (v.mounts[seat]!.gun.blast > 0 ? 0.012 : 0.004));
      }
    }
    if (v.altMounts[seat] && v.pullTrigger(seat, input.ads, this.simTime, dt, true)) this.audio.gadget('rocket', null);
    p.ride(v.seatEye(seat, this.tmpEye), v.velocity);
  }

  /** A seat the server put this player in, waiting for its vehicle to show up in the snapshots. */
  private pendingSeat: { v: number; seat: number } | null = null;

  /** In or out of a vehicle, as the server says. */
  private netSeat(e: Extract<MatchEvent, { k: 'seat' }>): void {
    const net = this.net!;
    this.pendingSeat = null;
    const was = this.ride;
    if (was && net.drive === was.v) {
      was.v.setRemote(true);
      net.drive = null;
    }
    if (e.v === null) {
      this.ride = null;
      const p = this.player;
      if (e.chute) {
        const [x, y, z, vx, vy, vz] = e.chute;
        this.me.chute = new THREE.Vector3(vx, vy, vz);
        p.ride(new THREE.Vector3(x, y + p.eyeHeight, z), this.me.chute);
        this.audio.gadget('place', null);
      } else p.dismount(e.pos ? new THREE.Vector3(...e.pos) : p.feet.clone());
      this.weapons.redraw();
      net.respawned();
      return;
    }
    const v = this.vehicles?.get(e.v);
    if (v) this.netBoard(v, e.seat);
    else this.pendingSeat = { v: e.v, seat: e.seat };
  }

  private netBoard(v: Vehicle, seat: number): void {
    this.ride = { v, seat };
    this.me.chute = null;
    this.gadgetOut = false;
    this.buildMode = false;
    this.supportAim = null;
    this.weapons.adsBlend = 0;
    if (seat === 0) {
      // This browser drives it from here on.
      v.setRemote(false);
      this.net!.drive = v;
    }
    // In a plane the view starts along the nose (the plane turns toward the view).
    if (v.flight && seat === 0) {
      this.player.yaw = v.flight.yaw;
      this.player.pitch = v.flight.pitch;
    }
    this.audio.gadget('place', null);
  }

  /** The canopy over this player's soldier while it hangs under one (match on the game server). */
  private syncNetChute(): void {
    if (this.me.chute && !this.chute) {
      this.chute = buildParachute();
      this.renderer.scene.add(this.chute);
    } else if (!this.me.chute && this.chute) {
      this.renderer.scene.remove(this.chute);
      disposeTree(this.chute, true);
      this.chute = null;
    }
  }

  /**
   * Holding E by a downed mate in a match on the game server: the same count
   * the server keeps (MatchSim.stepRevive) for the prompt and the hands; the
   * server does the reviving and says so.
   */
  private netRevive(net: NetMatch, holding: boolean, dt: number): boolean {
    const me = this.me;
    const feet = this.player.feet;
    let mate: { id: number; name: string } | null = null;
    let best = REVIVE_RANGE;
    for (const o of net.others()) {
      if (!friends(o, this.meSide) || !o.downed) continue;
      const d = o.feet.distanceTo(feet);
      if (d < best) {
        best = d;
        mate = o;
      }
    }
    this.interact = mate ? { kind: 'reviveMate', name: mate.name } : null;
    // Nobody down here: a mate a medic or support could hand something to (the server does the handing).
    if (!mate && !MATCH.simple && (this.cls === 'medic' || this.cls === 'support')) {
      const need = this.cls === 'medic' ? SF.needMedkit : SF.needAmmo;
      for (const o of net.others()) {
        if (friends(o, this.meSide) && o.alive && o.flags & need && o.feet.distanceTo(feet) < GIVE_RANGE) {
          this.interact = { kind: 'giveMate', name: o.name, what: this.cls === 'medic' ? 'medkit' : 'ammo' };
          break;
        }
      }
    }
    if (!mate || !holding) {
      me.reviveOf = null;
      me.reviveProgress = 0;
      return false;
    }
    if (me.reviveOf !== mate.id) {
      me.reviveOf = mate.id;
      me.reviveProgress = 0;
    }
    me.reviveProgress += dt;
    if (me.reviveProgress >= CLASSES[me.cls].reviveTime) {
      me.reviveOf = null;
      me.reviveProgress = 0;
    }
    return true;
  }

  /** What the kit acts on when this browser predicts its soldier in a match on the game server. */
  private netKitWorld: KitWorld | null = null;
  private netKit(): KitWorld {
    return (this.netKitWorld ??= {
      physics: this.physics,
      fort: this.fort,
      // The server fires and places gadgets, judges who is in the way and keeps the score.
      gadgets: null,
      zoneOwner: (id, team) => this.zoneMode?.stationOwner(id, team) ?? null,
      inTheWay: () => false,
      owner: (s) => ({ id: s.id, name: s.combatant.name, team: s.team, squad: null }),
      points: () => {},
      feedback: {
        gadgetUsed: (g, left) => {
          if (g === 'panzerfaust' || g === 'riflesmoke') this.audio.gadget(g === 'panzerfaust' ? 'rocket' : 'rifle', null);
          else this.audio.gadget('place', null);
          if (g === 'panzerfaust') {
            this.shake = Math.min(0.05, this.shake + 0.03);
            if (left > 0) this.audio.launcherReload();
          }
          this.gadgetUsedAt = this.simTime;
        },
        stocked: () => this.audio.resupply(),
        refilled: () => this.audio.resupply(),
        built: (slot) => {
          this.hud.notify(`${t(`fort.${slot.kind}` as MessageKey)} ${t('fort.built')}`, 'ally');
          this.audio.resupply();
        },
      },
    });
  }

  /** Into the sea: spray at the surface over it, sized by the blast. */
  private splash(kind: string, point: THREE.Vector3): void {
    const level = this.gadgets.water?.(point.x, point.z);
    const at = Number.isFinite(level) ? point.clone().setY(level!) : point;
    this.effects.splash(at, kind === 'bigNaval' ? 2.2 : kind === 'torpedo' || kind === 'depth' ? 1.8 : kind === 'naval' || kind === 'splash' ? 1.2 : 0.6);
  }

  /** Something going off in a match on the game server: what it looks and sounds like here (the server did the damage). */
  private netBoom(type: Extract<MatchEvent, { k: 'boom' }>['type'], point: THREE.Vector3): void {
    if (type === 'riflesmoke' || type === 'smokeShell') {
      this.effects.smoke(point, GRENADES.smoke.duration ?? 20, GRENADES.smoke.radius * (type === 'smokeShell' ? 1.3 : 1));
      this.audio.smokePop(point, GRENADES.smoke.duration ?? 20);
      return;
    }
    if (type !== 'flash' && type !== 'smoke') {
      const dist = this.renderer.camera.position.distanceTo(point);
      if (type === 'splash') this.splash(type, point);
      else this.effects.explosion(point);
      this.audio.explosion(point, dist, boomSize(type));
      this.shake = Math.min(0.06, this.shake + Math.max(0, 0.06 - dist * 0.003) * BOOM_SHAKE[boomSize(type)]);
      return;
    }
    // Flash and smoke work here as in solo play (the flash blinds by where this view looks).
    this.detonate(type, point, { id: -1, name: '', team: this.myTeam });
  }

  /** The rest of a sim step, after the player's own part: everyone else, then physics. */
  private finishStep(dt: number, input: InputState): void {
    this.me.syncBoxes();
    this.bots?.step(dt);
    this.fort?.step();
    this.botsResupplyPlayer();
    // Fleet battle: the rules count the ships; a sunk one stays gone, bots crew what is left.
    if (this.zoneMode?.match instanceof FleetRules && this.vehicles) {
      this.vehicles.fleet = true;
      if (this.bots) this.bots.fleet = true;
      if (!this.net) this.zoneMode.observeFleet(fleetState(this.vehicles.vehicles));
    }
    if (!this.net) this.zoneMode?.step(dt, this.combatants());
    this.stepEscort();
    if (!this.net) this.stepStorm(dt);
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
    // Simplified: no holding the breath, so the scopes sway far less instead.
    const amp = w.def.scope ? (SWAY_AMP[w.def.class] ?? 0.004) * (MATCH.simple ? SIMPLE.sway : 1) : 0;
    const moving = Math.min(1.5, p.horizontalSpeed() / 4);
    const stance = (p.crouching && p.grounded ? 0.6 : 1) * (1 + moving * 0.7) * (p.grounded ? 1 : 2);
    scopeSway(this.breath, this.simTime, amp, w.adsBlend, stance, w.sway);
  }

  // ---------------------------------------------------------------------------
  // Vehicles

  /** Pads at both bases and motorbikes around the zones (bot matches with zones). */
  private setupVehicles(map: MapDef, water: WaterMap | null, fixedOnly = false): void {
    const bases: { team: Team; pos: THREE.Vector3; facing: number }[] = [];
    for (const team of ['blue', 'red'] as const) {
      const sp = map.spawns.filter((s) => s.team === team || (team === 'blue' && s.team === 'player'));
      if (!sp.length) continue;
      const pos = sp.reduce((a, s) => a.add(new THREE.Vector3(...s.pos)), new THREE.Vector3()).divideScalar(sp.length);
      // A landing force's base is a ship: no motor pool on its deck (it brings landing craft instead).
      if (team === map.world.landing) continue;
      bases.push({ team, pos, facing: sp[0]!.yaw * DEG });
    }
    const zones = (map.zones ?? []).map((z) => ({ id: z.id, pos: new THREE.Vector3(...z.pos), radius: z.radius }));
    this.boundary = Boundary.fromMap(map);
    const plan = fixedOnly || map.world.vehicles === 'fixed' ? { pads: [], bikes: [], tankSpots: [] } : planVehicleSpots(this.physics, bases, zones, this.boundary);
    // Small maps: jeeps and motorbikes only.
    const heavy = map.world.vehicles !== 'light';
    // At sea RP comes from damage dealt (owner, 2026-10-18).
    const sea = seaRp((map.vehicles ?? []).map((m) => m.kind));
    const pads = heavy ? plan.pads : plan.pads.filter((p) => p.kind === 'jeep');
    const level = water ? (x: number, z: number) => water.levelAt(x, z) : null;
    const bikes = [...plan.bikes, ...mapVehicleSpots(map, this.physics, level)];
    const tankSpots = heavy ? plan.tankSpots : [];
    if (zones.length) VehicleClass.airCenter.copy(zones.reduce((a, z) => a.add(z.pos), new THREE.Vector3()).divideScalar(zones.length));
    VehicleClass.airRadius = Math.max(map.world.size[0], map.world.size[1]) / 2;
    this.vehicles = new VehicleWorld(
      this.physics,
      this.registry,
      {
        destroyed: (v, by) => this.vehicleDestroyed(v, by),
        roadkill: (v, victim) => this.roadkill(v, victim),
        damage: (v, by, taken) => {
          if (sea) this.scores.award(by.id, seaDamagePoints(v, by, taken));
        },
      },
      pads,
      bikes,
      this.bots?.bots.length ?? 0,
      tankSpots,
      heavy,
      map.world.vehicles !== 'noJets' && map.world.vehicles !== 'fixed',
    );
    this.vehicles.water = level;
    this.gadgets.water = level;
    this.renderer.scene.add(this.vehicles.group);
    if (this.bots) {
      const bots = this.bots;
      bots.vehicles = this.vehicles;
      bots.driveInputs = this.driveInputs;
      bots.playerRiding = () => !!this.ride;
      bots.fireMount = (v, seat, shooter, aim, alt) => this.fireMount(v, seat, shooter, aim, alt);
      bots.ships.stationGun = (v, seat, target, trigger, dt, shooter) => this.shipGun(v, seat, target, trigger, dt, shooter);
      bots.ships.bounds = this.boundary;
      bots.launchPlane = (v, kind, bot) => {
        const sq = this.squads.find((q) => q.team === bot.team && q.has(bot.id));
        const vw = this.vehicles!;
        const block = launchBlock(kind, sq ? this.squadRpOf(sq) : 0, vw.planesUp(bot.team), planeCap(this.sideCount(bot.team)), !!sq);
        if (block) return block;
        if (!vw.launchPlane(v, kind, bot.team)) return 'noRoom';
        this.support.pay(`${sq!.team}:${sq!.name}`, PLANE_COST[kind]);
        return null;
      };
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
    // On the game server the server brings it out (it shows up in the snapshots).
    if (this.net) return true;
    const vw = this.vehicles;
    const zm = this.zoneMode;
    if (!vw?.heavy || !zm) return false;
    const zones = zm.zones.map((z) => ({ id: z.id, pos: new THREE.Vector3(z.x, z.y, z.z), radius: z.radius }));
    const spot = callInSpot(this.physics, this.boundary, zones, near, vw.vehicles, 1.9, 4.2);
    if (!spot) return false;
    const v = vw.spawn('rocket', spot.pos, spot.yaw, owner.team);
    v.driverOnly = owner.id;
    if (owner.team === this.myTeam) {
      const who = owner.id === this.myId ? playerName(t('feed.you')) : owner.name;
      this.hud.notify(t('support.rocketArrived').replace('{zone}', spot.zone).replace('{who}', who), 'ally');
    }
    this.bots?.rocketTankFor(owner.id, v);
    return true;
  }

  /**
   * A seat someone of `team` could deploy into: tanks and jets of that side
   * (crewed by it, or empty and its own), not wrecked, the driver's seat
   * first unless it is kept for someone else. -1 when there's none.
   */
  private freeSeatFor(v: Vehicle, team: Team, id: number): number {
    if (v.wrecked || !(TANK_KINDS.includes(v.kind) || JET_KINDS.includes(v.kind) || isCarrierPlane(v.kind) || v.kind === 'rocket' || v.kind === 'lcvp')) return -1;
    if ((v.team ?? v.home) !== team) return -1;
    return v.seats.findIndex((s, i) => !s && (i > 0 || v.driverOnly === null || v.driverOnly === id) && !this.bots?.claimedSeat(v.id, i));
  }

  /** How many seats `freeSeatFor` could hand out in `v`. */
  private freeSeatCount(v: Vehicle, team: Team, id: number): number {
    if (this.freeSeatFor(v, team, id) < 0) return 0;
    return v.seats.filter((s, i) => !s && (i > 0 || v.driverOnly === null || v.driverOnly === id) && !this.bots?.claimedSeat(v.id, i)).length;
  }

  /**
   * Where the player's jet cannon fires (owner, 2026-10-02: "you can empty it
   * into them and nothing dies"): it used to fire along the nose while the
   * crosshair (the view, which the plane turns toward a moment later) led it,
   * so the rounds went wide. Now: at the crosshair while that is within
   * `JET_GUN.cone` of the nose (else along the nose: null), and onto an enemy
   * aircraft (jet or recon plane) within `JET_GUN.assist` of the crosshair.
   */
  private jetGunAim(v: Vehicle, seat: number): THREE.Vector3 | null {
    const view = new THREE.Vector3(0, 0, -1).applyQuaternion(this.renderer.camera.quaternion);
    const nose = v.velocity.lengthSq() > 1 ? v.velocity.clone().normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(v.quat);
    if (view.angleTo(nose) > JET_GUN.cone) return null;
    const muzzle = v.muzzleOf(seat, new THREE.Vector3());
    const range = v.mounts[seat]!.gun.range;
    let best: THREE.Vector3 | null = null;
    let bestA = JET_GUN.assist;
    const consider = (p: THREE.Vector3, team: Team | null): void => {
      if (team === this.myTeam) return;
      const to = p.clone().sub(muzzle);
      const d = to.length();
      if (d < 5 || d > range) return;
      const a = to.angleTo(view);
      if (a < bestA) {
        bestA = a;
        best = p;
      }
    };
    for (const o of this.vehicles?.vehicles ?? []) if (o.flight && !o.wrecked && o !== v) consider(o.pos, o.team ?? o.home);
    for (const p of this.support.planes()) consider(p.pos, p.team);
    return best ? (best as THREE.Vector3).clone() : muzzle.addScaledVector(view, range);
  }

  /** Missile lock: the nearest enemy aircraft within 25° of the nose and in range. */
  private lockTarget(v: Vehicle, team: Team): Vehicle | null {
    const nose = v.velocity.lengthSq() > 1 ? v.velocity.clone().normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(v.quat);
    let best: Vehicle | null = null;
    let bestD = 1500;
    for (const o of this.vehicles?.vehicles ?? []) {
      if (o === v || !o.flight || o.wrecked || o.home === team) continue;
      // Just in off the edge: not yet (they were shot down seconds after arriving).
      if (this.simTime - o.arrivedAt < JET_LOCK_GRACE) continue;
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
    const v = vw.spawnJet(kind, team, at, yaw);
    if (v) v.arrivedAt = this.simTime;
    return v;
  }

  /**
   * Bots fly jets as well (owner, 2026-10-03: "bots hardly fly"): a side with
   * a free jet slot sends a bot from near its base up, or the next bot to
   * respawn takes it (`botSpawnKey`).
   */
  private botJets(): void {
    const vw = this.vehicles;
    const bots = this.bots;
    if (!vw || !bots) return;
    for (const team of ['blue', 'red'] as const) this.trackJetSlot(team);
    if (this.simTime < this.botJetAt) return;
    this.botJetAt = this.simTime + BOT_JETS.every;
    for (const team of ['blue', 'red'] as const) {
      if (!this.botJetSlot(team)) continue;
      const base = this.baseCenter(team);
      const bot = bots.bots.find((b) => b.team === team && b.alive && !b.riding && b.feet.distanceTo(base) < BOT_JETS.nearBase && !b.inCombat(bots.time));
      if (!bot) continue;
      const v = this.spawnJet(JET_KINDS[Math.floor(Math.random() * JET_KINDS.length)]!, team);
      if (v) bots.seatBot(bot, v, 0);
    }
  }
  private botJetAt = BOT_JETS.first;
  /** Since when each side has had a free jet slot (-1: none free). */
  private readonly jetFreeSince: Record<Team, number> = { blue: -1, red: -1 };

  private trackJetSlot(team: Team): void {
    const vw = this.vehicles!;
    if (vw.jets(team) >= vw.jetLimit()) this.jetFreeSince[team] = -1;
    else if (this.jetFreeSince[team] < 0) this.jetFreeSince[team] = this.simTime;
  }

  /** A free jet slot bots may take: on the player's side only after the player had a while to pick it on the deploy screen. */
  private botJetSlot(team: Team): boolean {
    const free = this.jetFreeSince[team];
    if (free < 0) return false;
    const wait = this.simTime > BOT_JETS.first + 1 ? BOT_JETS.cooldown : 0;
    return this.simTime - free > (team === this.myTeam ? Math.max(BOT_JETS.playerFirst, wait) : wait);
  }

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
    const pick = this.vehicles?.enterAt(this.player.feet, (v, i) => i > 0 || v.driverOnly === null || v.driverOnly === this.myId, this.botYields);
    if (!pick) return false;
    // A bot at that station gives it up (people first at sea).
    if (pick.bump !== null && !this.bots?.yieldSeat(pick.bump)) return false;
    this.enterSeat(pick.v, pick.seat);
    return true;
  }

  /** Whether combatant `id` is a bot (solo: anyone but the player; in a match people's ids are 1000 up). */
  private isBotId(id: number): boolean {
    return this.net ? id < 1000 : id !== this.myId;
  }

  /** Bots that would give their seat to the player (people first at sea; in a match the server decides, this is for the prompt). */
  private readonly botYields = (id: number): boolean => (this.net ? this.isBotId(id) : !!this.bots?.yields(id));

  private enterSeat(v: Vehicle, seat: number): void {
    if (this.ride) this.ride.v.seats[this.ride.seat] = null;
    v.seats[seat] = { id: this.myId, team: this.myTeam };
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
    this.weapons.redraw();
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
    const free = (i: number): boolean => !v.seats[i] && (i > 0 || v.driverOnly === null || v.driverOnly === this.myId);
    const want = input.weaponSlot;
    // A warship's stations are walked up to (the number keys pick a plane at flight control instead).
    if (v.ship) {
      if (v.spec.seats[r.seat]!.station?.kind === 'flight') this.flightStation(v, input);
    } else if (want >= 0 && want < v.seats.length && free(want)) this.enterSeat(v, want);
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
    else if (v.ship && seat.station) this.stepStation(v, at, input.fire, dt);
    if (v.altMounts[at] && v.pullTrigger(at, input.ads, this.simTime, dt, true)) this.fireMount(v, at, { id: this.myId, name: playerName(t('feed.you')), team: this.myTeam }, null, true);
    const eye = v.seatEye(at, this.tmpEye);
    this.player.ride(eye, v.velocity);
  }

  /** Diamonds over jets, rings over recon planes: blue ours, red theirs (not the one the player is in). */
  private updateAirMarkers(): void {
    const marks = this.airMarks;
    let n = 0;
    const mark = (pos: THREE.Vector3, team: Team | null, recon: boolean): void => {
      const m = (marks[n++] ??= { pos: new THREE.Vector3(), friendly: false, recon: false });
      m.pos.copy(pos);
      m.friendly = team === this.myTeam;
      m.recon = recon;
    };
    for (const v of this.vehicles?.vehicles ?? []) if (v.flight && !v.wrecked && v !== this.ride?.v) mark(v.model.root.position, v.team ?? v.home, false);
    for (const p of this.support.planes()) mark(p.pos, p.team, true);
    marks.length = n;
    this.airMarkers.update(marks, this.renderer.camera.position, !!this.ride?.v.flight);
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
    // A new canopy is built for every jump: free this one rather than leave it hidden in the scene.
    this.renderer.scene.remove(this.chute);
    disposeTree(this.chute, true);
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
      this.weapons.redraw();
      return;
    }
    const eye = p.feet.clone().add(step).setY(p.feet.y + step.y + p.eyeHeight);
    p.ride(eye, this.chuteVel);
    this.weapons.step(dt, input, p, false);
  }

  /** The player's seat gun: follows the view; the trigger fires it (MGs overheat, shell guns reload). */
  private stepVehicleGun(v: Vehicle, seat: number, trigger: boolean, dt: number): void {
    const p = this.player;
    if (v.ship) {
      // A ship's gun lays itself onto what the view is on (sea surface included), elevation for the range.
      const cam = this.renderer.camera;
      const range = v.mounts[seat]!.gun.range;
      const target = lookPoint(this.physics, cam.position, new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), range, this.gadgets.water?.(cam.position.x, cam.position.z) ?? NaN, v.body);
      this.shipGun(v, seat, target, trigger, dt, { id: this.myId, name: playerName(t('feed.you')), team: this.myTeam });
      return;
    }
    v.aimMount(seat, p.yaw, p.pitch, dt);
    this.keepLookInReach(v, seat);
    if (!v.pullTrigger(seat, trigger, this.simTime, dt)) return;
    // Aircraft guns (the pilot's seat): where the crosshair points, near the nose.
    if (v.flight && v.spec.seats[seat]!.role === 'driver') {
      this.fireMount(v, seat, { id: this.myId, name: playerName(t('feed.you')), team: this.myTeam }, this.jetGunAim(v, seat));
      return;
    }
    // Aim: what the view centre points at; a gun with a turn rate fires where it points (as on the server).
    const cam = this.renderer.camera;
    const gunAim = v.spec.seats[seat]!.turn ? v.mountAim(seat) : null;
    const fwd = gunAim ? viewDir(gunAim.yaw, gunAim.pitch) : new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const origin = gunAim ? v.seatEye(seat, new THREE.Vector3()) : cam.position;
    const range = v.mounts[seat]!.gun.range;
    const look = this.physics.raycast(origin, fwd, range, Layer.WORLD | Layer.HITBOX, undefined, v.body);
    const aim = look ? new THREE.Vector3(look.point.x, look.point.y, look.point.z) : origin.clone().addScaledVector(fwd, range);
    this.fireMount(v, seat, { id: this.myId, name: playerName(t('feed.you')), team: this.myTeam }, aim);
  }

  /** A warship's gun laid on `target`, fired by `trigger` once it is laid (not a knocked-out station). */
  private shipGun(v: Vehicle, seat: number, target: THREE.Vector3, trigger: boolean, dt: number, shooter: GrenadeOwner): void {
    const { aim, laid } = layGun(v, seat, target, dt);
    if (v.ship?.broken.has(seat)) return;
    if (v.pullTrigger(seat, trigger && laid, this.simTime, dt)) this.fireMount(v, seat, shooter, aim);
  }

  /**
   * The helm (and the engine room) of a warship: the helm's trigger fires
   * every station nobody mans that it may work (ship.ts `helmMay`), all laid
   * on what the helm looks at; the engine room's trigger runs overdrive.
   */
  private stepStation(v: Vehicle, seat: number, trigger: boolean, dt: number): void {
    const ship = v.ship!;
    const kind = v.spec.seats[seat]!.station?.kind;
    if (kind === 'engine') {
      if (trigger && !this.net && ship.overdrive(Math.random)) this.hud.notify(t('ship.overdrive'), 'ally');
      return;
    }
    if (kind !== 'helm') return;
    const cam = this.renderer.camera;
    const target = lookPoint(this.physics, cam.position, new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), 6500, this.gadgets.water?.(cam.position.x, cam.position.z) ?? NaN, v.body);
    const shooter = { id: this.myId, name: playerName(t('feed.you')), team: this.myTeam };
    for (let i = 0; i < v.seats.length; i++) {
      if (!ship.helmMay(i, (j) => !!v.seats[j], (k) => v.manned(k))) continue;
      this.shipGun(v, i, target, trigger, dt, shooter);
    }
  }

  /** The plane kind the flight control station has picked (index into CARRIER_PLANES). */
  private flightPick = 0;

  /** People and bots on `team` now (carrier planes: a quarter of them may fly). */
  private sideCount(team: Team): number {
    return (this.bots?.bots.filter((b) => b.team === team).length ?? 0) + (this.myTeam === team ? 1 : 0);
  }

  /** Flight control: 1-6 / the wheel pick a plane, the trigger launches it onto the deck (the squad's RP). */
  private flightStation(v: Vehicle, input: InputState): void {
    const n = CARRIER_PLANES.length;
    if (input.weaponSlot >= 0 && input.weaponSlot < n) this.flightPick = input.weaponSlot;
    else if (input.weaponCycle !== 0) this.flightPick = (this.flightPick + Math.sign(input.weaponCycle) + n) % n;
    if (!input.firePressed || this.net || !this.vehicles) return;
    const kind = CARRIER_PLANES[this.flightPick]!;
    const sq = this.playerSquad;
    const up = this.vehicles.planesUp(this.myTeam);
    const cap = planeCap(this.sideCount(this.myTeam));
    const block = launchBlock(kind, sq ? this.squadRpOf(sq) : 0, up, cap, !!sq);
    if (block) {
      this.hud.notify(t(`flight.${block}` as MessageKey).replace('{n}', String(up)).replace('{cap}', String(cap)), 'enemy');
      return;
    }
    const plane = this.vehicles.launchPlane(v, kind, this.myTeam, this.myId);
    if (!plane) {
      this.hud.notify(t('flight.noRoom'), 'enemy');
      return;
    }
    this.support.pay(`${sq!.team}:${sq!.name}`, PLANE_COST[kind]);
    this.hud.notify(t('flight.launched').replace('{plane}', t(`vehicle.${kind}` as MessageKey)), 'ally');
  }

  /** The ride line's carrier plane part: on the deck / the landing aid / rearming, the rounds left. */
  private planeLine(v: Vehicle, seat: number): string[] {
    const out: string[] = [];
    if (v.parked && v.parkedFor < DECK.rearm && (v.health < v.spec.health || v.mounts.some((m) => m && m.ammo < (m.gun.ammo ?? Infinity)))) out.push(t('plane.landed').replace('{s}', String(Math.ceil(DECK.rearm - v.parkedFor))));
    else if (v.deck && seat === 0) out.push(t('plane.deck'));
    else if (v.approach) out.push(t('plane.approach'));
    const ammo = [v.mounts[seat], v.altMounts[seat]].filter((m) => m && Number.isFinite(m.ammo)).map((m) => `${t(`vehicleGun.${m!.id}` as MessageKey)} ${m!.ammo}`);
    if (ammo.length) out.push(t('plane.ammo').replace('{list}', ammo.join(' · ')));
    if (seat === 0 && v.mounts[0] && v.mounts[0].ammo <= 0 && !v.deck) out.push(t('plane.noAmmo'));
    return out;
  }

  /** The ride line's warship part: telegraph and speed, depth and air, fires, flooding, stations out. */
  private shipLine(v: Vehicle, seat: number): string[] {
    const s = v.ship!;
    const kind = v.spec.seats[seat]!.station?.kind;
    const out: string[] = [];
    if (kind === 'helm') out.push(`${t(`ship.tel${s.telegraph}` as MessageKey)} · ${Math.round(v.forwardSpeed() * 1.944)} kn`);
    if (v.spec.ship?.sub && (kind === 'helm' || kind === 'periscope' || kind === 'sonar')) out.push(t('ship.depth').replace('{d}', String(Math.round(s.depth))).replace('{o}', String(Math.round(s.oxygen))));
    if (s.fires.length) out.push(t('ship.fires').replace('{n}', String(s.fires.length)));
    if (s.flooding > 0.01) out.push(t('ship.flood').replace('{p}', String(Math.round(s.flooding * 100))));
    if (s.broken.size) out.push(t('ship.broken').replace('{n}', String(s.broken.size)));
    if (s.broken.has(seat)) out.push(t('ship.out'));
    if (s.sinking >= 0) out.push(t('ship.sinking'));
    if (kind === 'sonar' || kind === 'periscope' || kind === 'asw') {
      const list = contacts(v, kind, this.vehicles?.vehicles ?? []).slice(0, 3);
      out.push(list.length ? t('ship.contacts').replace('{list}', list.map((c) => `${t(`vehicle.${c.kind}` as MessageKey)} ${Math.round(c.bearing)}° ${(c.range / 1000).toFixed(1)} km`).join(', ')) : t('ship.noContacts'));
    }
    if (s.dived && kind === 'helm') out.push(t('ship.dived'));
    if (!this.touch && kind === 'helm') out.push(t(v.spec.ship?.sub ? 'ship.controlsSub' : 'ship.controls'));
    if (kind === 'flight' && this.vehicles) {
      const k = CARRIER_PLANES[this.flightPick]!;
      const sq = this.playerSquad;
      const rp = sq ? this.squadRpOf(sq) : 0;
      const line = t('flight.pick').replace('{plane}', t(`vehicle.${k}` as MessageKey)).replace('{cost}', String(PLANE_COST[k])).replace('{rp}', String(Math.floor(rp)));
      out.push(line.replace('{n}', String(this.vehicles.planesUp(this.myTeam))).replace('{cap}', String(planeCap(this.sideCount(this.myTeam)))));
    }
    if (kind === 'engine') out.push(s.time < s.overdriveUntil ? t('ship.overdriveOn') : s.time < s.overdriveReady ? t('ship.overdriveWait') : t('ship.overdriveReady'));
    return out;
  }

  /**
   * A gun with a turn rate only reaches so far (the tank destroyer's few
   * degrees either way, every gun's elevation): the look stays inside that,
   * so the sight and what it can fire at are the same.
   */
  private keepLookInReach(v: Vehicle, seat: number): void {
    const s = v.spec.seats[seat]!;
    if (!s.turn) return;
    const p = this.player;
    const [lo, hi] = s.pitch ?? [-0.2, 0.6];
    p.pitch = THREE.MathUtils.clamp(p.pitch, lo, hi);
    if (s.traverse !== undefined && s.traverse < Math.PI) {
      const rel = Math.atan2(Math.sin(p.yaw - v.yaw), Math.cos(p.yaw - v.yaw));
      p.yaw = v.yaw + THREE.MathUtils.clamp(rel, -s.traverse, s.traverse);
    }
    // In the sight the look runs only a little ahead of the gun (2026-10-14): a flick
    // doesn't leave the gun turning on for seconds after the mouse stopped.
    const gun = this.orbit ? null : v.mountAim(seat);
    if (gun) {
      const rel = Math.atan2(Math.sin(p.yaw - gun.yaw), Math.cos(p.yaw - gun.yaw));
      p.yaw = gun.yaw + THREE.MathUtils.clamp(rel, -LOOK_LEAD.yaw, LOOK_LEAD.yaw);
      p.pitch = THREE.MathUtils.clamp(p.pitch, gun.pitch - LOOK_LEAD.pitch, gun.pitch + LOOK_LEAD.pitch);
    }
  }

  /** In third person aboard, the camera orbits on its own (see `orbit`). */
  private orbiting(): boolean {
    const r = this.ride;
    return !!r && this.rideThird && this.player.alive && !r.v.flight && (!!r.v.spec.seats[r.seat]!.turn || !!r.v.ship);
  }

  /** What the third-person camera aboard looks at (world): over the hull's middle; over a warship, high enough to see the whole ship. */
  private rideCamTarget(v: Vehicle, alpha: number, out: THREE.Vector3): THREE.Vector3 {
    const h = v.ship ? v.spec.half[1] + SHIP_CAM.height + SHIP_CAM.heightPerLength * v.spec.half[2] * 2 : v.spec.half[1] + (this.orbit ? ORBIT.height : 1.1);
    return v.toWorld(out.set(0, h, 0), out, alpha);
  }

  /**
   * The look the gun follows, from the orbit camera: what the screen's
   * centre is on, seen from the gun.
   */
  private orbitAim(o: { yaw: number; pitch: number }): void {
    const { v, seat } = this.ride!;
    const p = this.player;
    const dir = viewDir(o.yaw, o.pitch, this.tmpOrbitDir);
    const target = this.rideCamTarget(v, this.lastAlpha, this.tmpOrbitAt);
    const range = v.ship ? 6500 : Math.max(400, v.mounts[seat]?.gun.range ?? 600);
    // From just past the vehicle (the camera ray would cross its own crew otherwise).
    const from = target.addScaledVector(dir, 3);
    let aim: THREE.Vector3;
    // At sea the look lands on the sea too (a ship's guns lay onto it).
    if (v.ship) aim = this.tmpOrbitAim.copy(lookPoint(this.physics, from, dir, range, this.gadgets.water?.(from.x, from.z) ?? NaN, v.body));
    else {
      const hit = this.physics.raycast(from, dir, range, Layer.WORLD | Layer.HITBOX, undefined, v.body);
      aim = this.tmpOrbitAim.copy(from).addScaledVector(dir, hit ? hit.distance : range);
    }
    const gun = v.model.mounts[seat]?.gun;
    const pivot = gun ? gun.getWorldPosition(this.tmpOrbitAt) : v.seatEye(seat, this.tmpOrbitAt);
    const dx = aim.x - pivot.x;
    const dy = aim.y - pivot.y;
    const dz = aim.z - pivot.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
  private readonly tmpOrbitDir = new THREE.Vector3();
  private readonly tmpOrbitAt = new THREE.Vector3();
  private readonly tmpOrbitAim = new THREE.Vector3();

  /**
   * One round from a vehicle gun at `aim`: hitscan for the MGs and the
   * autocannon, a flying shell for tank guns (lobbed for the howitzer).
   * Shared by the player and the bots.
   */
  private fireMount(v: Vehicle, seat: number, shooter: GrenadeOwner, aimAt: THREE.Vector3 | null, alt = false): void {
    const m = (alt ? v.altMounts : v.mounts)[seat];
    if (!m) return;
    const gun = m.gun;
    const byPlayer = shooter.id === this.myId;
    const muzzle = v.muzzleOf(seat, new THREE.Vector3());
    // No aim point: straight ahead along the plane's flight path.
    const nose = v.velocity.lengthSq() > 1 ? v.velocity.clone().normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(v.quat);
    const aim = aimAt ?? muzzle.clone().addScaledVector(nose, gun.range);
    if (gun.homing) {
      const lock = this.lockTarget(v, shooter.team);
      const vel = nose.clone().multiplyScalar(gun.shell!.speed).add(v.velocity);
      this.gadgets.fireShell(muzzle.clone().addScaledVector(nose, 4), vel, 0, { ...shooter, squad: null }, m.id, lock ? () => (lock.wrecked ? null : lock.pos) : undefined, v.body);
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
      } else if (sh.drop) {
        // Let go under the belly: it falls away with the plane's own way on.
        const belly = v.pos.clone().addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(v.quat), -1.4);
        this.gadgets.fireShell(belly, v.velocity.clone().setY(v.velocity.y - 2), sh.gravity, { ...shooter, squad: null }, m.id, undefined, v.body);
        return;
      } else vel = dir.clone().multiplyScalar(sh.speed).add(v.flight ? v.velocity : new THREE.Vector3());
      this.gadgets.fireShell(muzzle.clone().addScaledVector(dir, 0.4), vel, sh.gravity, { ...shooter, squad: null }, m.id, undefined, v.body);
      if (m.id === 'rockets') this.audio.gadget('rocket', byPlayer ? null : muzzle);
      else this.audio.bigGun(muzzle, listenerDist, `v${v.id}.${seat}`);
      if (byPlayer) this.shake = Math.min(0.06, this.shake + 0.035);
      return;
    }
    // Not its own hull or wings.
    const hit = this.physics.raycast(muzzle, dir, gun.range, Layer.WORLD | Layer.HITBOX, undefined, v.body);
    const to = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : muzzle.clone().addScaledVector(dir, gun.range);
    const target = hit ? this.registry.lookup(hit.collider.handle) : undefined;
    if (target && target.owner.alive && foes(target.owner, shooter)) {
      const isVehicle = !!this.vehicles?.get(target.owner.id);
      const dmg = isVehicle ? gun.vsVehicle : computeDamage(gun.damage, target.part, 1.5);
      const source: DamageSource = { pos: muzzle.clone(), name: shooter.name, team: shooter.team, weapon: name, id: shooter.id };
      const killed = target.owner.id === this.myId ? this.damagePlayer(dmg, muzzle, 'bullet', source) : target.owner.applyDamage(dmg, target.part, source, gun.blast > 0 ? 'at' : 'heavy');
      this.bus.emit('combat:hit', { targetId: target.owner.id, part: target.part, damage: dmg, killed, point: to, byPlayer });
      if (killed) this.reportKill(shooter, target.owner.id, target.owner.id === this.myId ? this.playerCombatant.name : target.owner.name, target.owner.team ?? null, name);
    } else if (hit && !target) {
      this.bus.emit('combat:impact', { point: to, normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), surface: this.impacts.get(hit.collider.handle, hit.point) });
    }
    if (hit && gun.blast > 0) this.blast('cannon', to, shooter, name);
    this.effects.spawnShots([{ from: muzzle, to }], muzzle);
    this.audio.remoteGunshot(gun.blast > 0 ? 'sr' : 'lmg', muzzle, byPlayer ? 0 : listenerDist, `v${v.id}.${seat}`);
    this.bots?.nearMiss(muzzle, to, shooter, target?.owner.id ?? -1, 1);
    if (byPlayer) this.shake = Math.min(0.03, this.shake + (gun.blast > 0 ? 0.012 : 0.004));
  }

  /**
   * A shell came down: a direct hit kills people outright (no going down)
   * and hurts vehicles a lot; then the blast.
   */
  private shellHit(gun: string, point: THREE.Vector3, owner: GadgetOwner, target: Damageable | null, part: HitPart, wet = false): void {
    const spec = VEHICLE_GUNS[gun as VehicleGunId];
    if (!spec) return;
    const name = t(`vehicleGun.${gun as VehicleGunId}`);
    const source: DamageSource = { pos: point.clone(), name: owner.name, team: owner.team, weapon: name, id: owner.id };
    if (target && foes(target, owner) && target.id >= 0) {
      const hitVehicle = this.vehicles?.get(target.id);
      if (hitVehicle) {
        target.applyDamage(spec.vsVehicle, part, source, 'at');
        hitVehicle.shipHit(gun, point);
      } else if (target.id === this.myId) {
        if (this.damagePlayer(999, point, 'explosion', source)) {
          this.reportKill(owner, this.myId, this.playerCombatant.name, this.myTeam, name);
          this.me.die('explosion', source);
        }
      } else {
        const bot = this.bots?.bots.find((b) => b.id === target.id);
        if (bot?.alive) {
          bot.killOutright(source);
          this.bus.emit('combat:hit', { targetId: bot.id, part, damage: 999, killed: true, point: point.clone(), byPlayer: owner.id === this.myId });
          this.reportKill(owner, bot.id, bot.name, bot.team, name);
        } else if (!bot) target.applyDamage(spec.vsVehicle, part, source, 'at'); // a recon plane

      }
    }
    this.blast(gunBlast(gun), point, owner, name, wet);
  }

  /** A vehicle blew up: everyone aboard dies outright (no going down). */
  private vehicleDestroyed(v: Vehicle, by: DamageSource | null): void {
    const at = v.pos.clone();
    this.effects.explosion(at);
    this.effects.explosion(at.clone().setY(at.y + 1));
    this.audio.explosion(at, this.renderer.camera.position.distanceTo(at), 'heavy');
    this.renderer.requestShadowUpdate();
    const owner: GrenadeOwner = { id: by?.id ?? -1, name: by?.name ?? '', team: by?.team ?? otherTeam(this.myTeam) };
    const weapon = by?.weapon ?? t(`vehicle.${v.kind}`);
    if (this.ride?.v === v) {
      this.leaveVehicle();
      // A warship going down leaves its crew on deck (they swim for it); everything else kills them.
      if (!v.spec.ship && this.damagePlayer(999, at, 'explosion', by ?? undefined)) {
        if (by && by.id !== this.myId) this.reportKill(owner, this.myId, this.playerCombatant.name, this.myTeam, weapon);
        this.me.die('explosion', by ?? undefined);
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
    const isPlayer = d.id === this.myId;
    const name = isPlayer ? playerName(t('feed.you')) : (this.bots?.bots.find((b) => b.id === d.id)?.name ?? '');
    const weapon = t(`vehicle.${v.kind}`);
    const source: DamageSource = { pos: v.pos.clone(), name, team: d.team, weapon, id: d.id };
    if (victim.id === this.myId) {
      if (this.damagePlayer(999, v.pos, 'explosion', source)) this.reportKill({ id: d.id, name, team: d.team }, this.myId, this.playerCombatant.name, this.myTeam, weapon);
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
    if (!sq || !MATCH.callIns || !this.player.alive || !this.deployed) return null;
    // On the game server only a squad's first member (its leader) calls things in.
    if (this.net && sq.members[0]?.id !== this.myId) return null;
    const cooldown = {} as Record<SupportId, number>;
    for (const id of SUPPORT_ORDER) cooldown[id] = this.support.cooldown(this.myTeam, id);
    return { rp: this.squadRpOf(sq), cooldown, aiming: this.supportAim };
  }

  /** Picked a call-in from the menu (key or tap): aim it next, if it can be called. */
  private pickSupport(id: SupportId): void {
    const s = this.supportState();
    if (!s || !SupportMenu.ready(s, id)) return;
    this.supportMenu.open = false;
    // The rocket tank isn't aimed: it comes to the zone nearest the leader (not on the game server yet).
    if (id === 'rocketTank') {
      if (this.net) {
        const f = this.player.feet;
        this.net.link.send({ t: 'callin', kind: id, point: [f.x, f.y, f.z] });
        this.audio.click();
        return;
      }
      const sq = this.playerSquad!;
      const owner: GadgetOwner = { id: this.myId, name: playerName(t('feed.you')), team: this.myTeam, squad: `${sq.team}:${sq.name}` };
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
    if (input.firePressed && this.supportPoint && this.net) {
      // The server decides (RP, cooldown) and tells everyone.
      const p = this.supportPoint;
      this.net.link.send({ t: 'callin', kind: this.supportAim, point: [p.x, p.y, p.z] });
      this.audio.click();
      this.supportAim = null;
      this.supportPoint = null;
    } else if (input.firePressed && this.supportPoint) {
      const sq = this.playerSquad!;
      const owner: GadgetOwner = { id: this.myId, name: playerName(t('feed.you')), team: this.myTeam, squad: `${sq.team}:${sq.name}` };
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
    if (team === this.myTeam && p.alive && this.deployed && p.feet.distanceTo(pos) < reach) {
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
    const owner: GadgetOwner = { id: this.myId, name: playerName(t('feed.you')), team: this.myTeam, squad: this.squadKeyOf(this.myTeam, this.myId) };
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
    this.throwables.throw(type, origin, fwd.clone(), this.player.velocity.clone(), { id: this.myId, name: playerName(t('feed.you')), team: this.myTeam });
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
  private blast(kind: BlastKind, point: THREE.Vector3, owner: GrenadeOwner, weapon: string, wet = false): void {
    const spec = BLASTS[kind];
    const byPlayer = owner.id === this.myId;
    const source: DamageSource = { pos: point.clone(), name: owner.name, team: owner.team, weapon, id: owner.id };
    const listenerDist = this.renderer.camera.position.distanceTo(point);
    const probe = point.clone().setY(point.y + 0.25);
    if (wet) this.splash(kind, point);
    else this.effects.explosion(point);
    this.audio.explosion(point, listenerDist, boomSize(kind));
    this.shake = Math.min(0.06, this.shake + Math.max(0, 0.06 - listenerDist * 0.003) * BOOM_SHAKE[boomSize(kind)]);
    if (kind !== 'frag') this.bots?.explosionAt(point);
    // Fortifications in the blast take damage (colliders go at the next physics step).
    for (const s of this.fort?.blast(point, spec.radius, (d) => fragDamage(spec, d, false) * spec.fortMult) ?? []) {
      this.effects.explosion(s.kind === 'barricade' ? s.pos : s.pos.clone().setY(s.pos.y + 0.5));
    }
    if (kind === 'frag') this.gadgets.blast(point, spec.radius * 0.6);
    for (const v of this.vehicles?.vehicles ?? []) {
      if (v.wrecked || (v.team && v.team === owner.team && owner.id !== this.myId)) continue;
      const d = v.hullDistance(point);
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
      if (!b.alive || !foes(b, owner)) continue;
      const c = b.feet.clone().setY(b.feet.y + b.eyeHeight * 0.65);
      const dmg = fragDamage(spec, c.distanceTo(point), this.occluded(probe, c));
      if (dmg <= 0) continue;
      const killed = b.applyDamage(dmg, 'body', source);
      this.bus.emit('combat:hit', { targetId: b.id, part: 'body', damage: dmg, killed, point: c, byPlayer });
      if (killed) this.reportKill(owner, b.id, b.name, b.team, weapon);
    }
    // Your own blast hurts you; teammates' don't.
    if (byPlayer || foes(owner, this.meSide)) {
      const chest = this.player.feet.clone().setY(this.player.feet.y + 1.1);
      const dmg = fragDamage(spec, chest.distanceTo(point), this.occluded(probe, chest));
      const killed = dmg > 0 && this.damagePlayer(dmg, point, 'explosion', byPlayer ? undefined : source);
      // An enemy's blast: report the kill like a bullet kill (feed, scoreboard).
      if (killed && !byPlayer) this.reportKill(owner, this.myId, this.playerCombatant.name, this.myTeam, weapon);
    }
  }

  /** A panzerfaust rocket striking someone: a kill (or down) for anyone but a teammate. */
  private rocketHit(target: Damageable, part: HitPart, point: THREE.Vector3, owner: GadgetOwner): void {
    if (!foes(target, owner) || target.id < 0) return;
    const weapon = t('gadget.assault');
    const byPlayer = owner.id === this.myId;
    const source: DamageSource = { pos: point.clone(), name: owner.name, team: owner.team, weapon, id: owner.id };
    const killed = target.applyDamage(ROCKET.directDamage, part, source, 'at');
    this.bus.emit('combat:hit', { targetId: target.id, part, damage: ROCKET.directDamage, killed, point: point.clone(), byPlayer });
    if (killed) this.reportKill(owner, target.id, target.id === this.myId ? this.playerCombatant.name : target.name, target.team ?? null, weapon);
  }

  private reportKill(owner: GrenadeOwner, victimId: number, victim: string, victimTeam: Team | null, weapon: string): void {
    const byPlayer = owner.id === this.myId;
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
    return this.me.damage(amount, from, cause, source);
  }

  /** A bot got the player back up. */
  private revivePlayer(by: string, health: number): void {
    this.me.revive(by, health);
  }

  // ---------------------------------------------------------------------------
  // Medkits, reviving and handing out kits

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
    if (this.stepCharge(input)) return;
    const bots = this.bots;
    if (!bots) return;
    const feet = this.player.feet;
    let revive: Bot | null = null;
    let reviveD = REVIVE_RANGE;
    let give: Bot | null = null;
    let giveD = GIVE_RANGE;
    for (const b of bots.bots) {
      if (!friends(b, this.meSide)) continue;
      const d = b.feet.distanceTo(feet);
      if (b.downed && d < reviveD) {
        revive = b;
        reviveD = d;
      } else if (this.cls === 'medic' && !MATCH.simple && b.alive && b.medkits === 0 && d < giveD && this.giveOk(`${this.myId}>${b.id}:kit`)) {
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
        this.giveReady.set(`${this.myId}>${give.id}:kit`, this.simTime + MEDKIT.giveCooldown);
        this.scores.resupply(this.myId);
        this.audio.resupply();
      }
      return;
    }
    this.stepFort(dt, input, prevWork);
  }

  /**
   * At a charge (Rush, S&D) this soldier may work: hold E to plant (attackers)
   * or defuse (defenders); the rules count it up from `using`. True while at one.
   */
  private stepCharge(input: InputState): boolean {
    this.me.using = false;
    const zm = this.zoneMode;
    const m = zm?.charges;
    if (!zm || !m || !this.player.alive || !this.deployed) return false;
    const c = zm.chargeNear(this.player.feet);
    if (!c || !c.live) return false;
    const plant = c.state === 'idle';
    if ((plant && this.myTeam !== m.attacker) || (!plant && this.myTeam !== m.defender)) return false;
    this.interact = { kind: 'charge', charge: c, plant };
    this.me.using = input.interact;
    return true;
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
      const owned = this.zoneMode?.zone(station.zone)?.owner === this.myTeam;
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
        this.scores.award(this.myId, REFILL_POINTS);
        this.audio.resupply();
      }
    } else {
      const r = fort.work(job.slot, dt, this.cls, (s) => this.inTheWay(s));
      this.scores.award(this.myId, r.points);
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
    if (!bots || MATCH.simple || !this.player.alive || !this.deployed) return;
    const feet = this.player.feet;
    const needKit = this.cls !== 'medic' && this.medkits === 0;
    const needAmmo = this.weapons.needsAmmo;
    if (!needKit && !needAmmo) return;
    for (const b of bots.bots) {
      if (!friends(b, this.meSide) || !b.alive || b.target || b.feet.distanceTo(feet) > GIVE_RANGE) continue;
      if (needKit && b.cls === 'medic' && this.giveOk(`${b.id}>${this.myId}:kit`)) {
        this.medkits = MEDKIT.carried;
        this.giveReady.set(`${b.id}>${this.myId}:kit`, this.simTime + MEDKIT.giveCooldown);
        this.scores.resupply(b.id);
        this.hud.notify(`${t('notify.gotMedkit')} — ${b.name}`, 'ally');
        this.audio.resupply();
        return;
      }
      if (needAmmo && b.cls === 'support' && this.giveOk(`${b.id}>${this.myId}:ammo`)) {
        this.weapons.refillReserve();
        this.giveReady.set(`${b.id}>${this.myId}:ammo`, this.simTime + AMMO_GIVE_COOLDOWN);
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

    let at: { pos: THREE.Vector3; yaw: number };
    if (this.bots) at = this.spawnFor(this.myTeam, key, this.myId);
    else {
      const sp = this.playerSpawns.length ? this.playerSpawns[Math.floor(Math.random() * this.playerSpawns.length)]! : this.spawn;
      at = { pos: new THREE.Vector3(...sp.pos), yaw: sp.yaw * DEG };
    }
    this.startLife(at, this.loadouts.current, key);
  }

  /** A new life at `at` with `kit` (the loadout picked on the deploy screen); `key`: what was picked to deploy at. */
  private startLife(at: { pos: THREE.Vector3; yaw: number }, kit: Loadout, key: string): void {
    this.reconZoom = false;
    this.gadget = classGadget(kit.cls, kit.reconGadget);
    this.gadgetCount = this.gadget ? GADGETS[this.gadget].count : 0;
    this.gadgetOut = false;
    this.gadgetBusy = 0;
    this.reviveOf = null;
    this.reviveProgress = 0;
    this.hud.clearDamage();
    this.touch?.reset();
    this.flashLeft = 0;
    this.breath = createBreath();
    this.me.spawn(at.pos, at.yaw, kit, this.options.sandbox ? this.options.loadout : null);
    // Gun game: the step's gun, nothing else.
    const gg = this.zoneMode?.match;
    if (gg instanceof GunGameRules) armForLevel(this.weapons, gg.scoreOf(this.myId));
    // Last soldier standing: a pistol, and whatever a crate gave.
    if (gg instanceof LastStandRules) armLoot(this.weapons, gg.armed[this.myId] ?? null);
    // Deployed in a tank: it comes out at the base with the player at the controls.
    if (key.startsWith('tank:') && this.vehicles) {
      const v = this.vehicles.spawnTank(key.slice(5) as VehicleKind, this.myTeam);
      if (v) this.enterSeat(v, 0);
    }
    if (key.startsWith('veh:') && this.vehicles) {
      const v = this.vehicles.get(Number(key.slice(4)));
      const seat = v ? this.freeSeatFor(v, this.myTeam, this.myId) : -1;
      if (v && seat >= 0) this.enterSeat(v, seat);
    }
    if (key.startsWith('jet:') && this.vehicles) {
      const v = this.spawnJet(key.slice(4) as VehicleKind, this.myTeam);
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
    this.camRoll = 0;
    this.gunView = null;
    if (this.ride && p.alive) this.rideCamera(alpha, dt);
    else this.showRideModel(null);

    this.shake *= Math.exp(-7 * dt);
    const pu = this.punch;
    pu.pitch.step(dt);
    pu.roll.step(dt);
    pu.yaw.step(dt);
    const sx = (Math.random() - 0.5) * this.shake + pu.pitch.x;
    const sy = (Math.random() - 0.5) * this.shake + pu.yaw.x;
    // Scope sway (breath.ts) is part of the aim, so the view follows it too.
    // (set by rideCamera above)
    const gv = this.gunView as { yaw: number; pitch: number } | null;
    cam.rotation.set((gv ? gv.pitch : p.pitch + w.recoil.pitch + w.sway.pitch) + sx, (gv ? gv.yaw : p.yaw + w.recoil.yaw + w.sway.yaw) + sy, this.deathBlend * (gone ? 0.7 : 0.25) + this.camRoll + pu.roll.x, 'YXZ');
    let fov = this.settings.fov + (adsFov - this.settings.fov) * w.adsBlend;
    if (this.ride && p.alive && !this.rideThird) fov = this.rideFov(this.ride.v, dt);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    this.sceneFollowsCamera(cam.position);
    this.tmpFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.tmpUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.audio.setListener(cam.position, this.tmpFwd, this.tmpUp);
    this.probeSpace(cam.position, dt);
    this.updateEngines(cam.position);
  }

  private spaceIn = 0;
  private readonly spaceDir = new THREE.Vector3();

  /**
   * What is round the listener, for the echo of their own gun (gunplay audit,
   * 2026-10-18): a ray up for a ceiling and eight round about for walls, four
   * times a second.
   */
  private probeSpace(at: THREE.Vector3, dt: number): void {
    this.spaceIn -= dt;
    if (this.spaceIn > 0) return;
    this.spaceIn = 0.25;
    const d = this.spaceDir;
    const roof = this.physics.raycast(at, d.set(0, 1, 0), SPACE_PROBE.up, Layer.WORLD);
    let hits = 0;
    let sum = 0;
    let near = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = this.physics.raycast(at, d.set(Math.cos(a), 0, Math.sin(a)), SPACE_PROBE.round, Layer.WORLD);
      if (!h) continue;
      hits++;
      sum += h.distance;
      if (h.distance < SPACE_PROBE.room) near++;
    }
    const walls = near / 8;
    this.audio.setSpace({
      enclosed: roof ? 0.35 + 0.65 * walls : 0.25 * walls,
      wall: hits >= 2 ? sum / hits : Infinity,
    });
  }

  /** Sky, shadows, trees, clutter, grass and snow around wherever the camera is. */
  private sceneFollowsCamera(at: THREE.Vector3): void {
    if (this.atmosphere.update(at, this.elapsed)) this.renderer.requestShadowUpdate();
    if (this.forest?.update(at)) this.renderer.requestShadowUpdate();
    // Scenery clutter near the camera only, and the outer tree line's 3D / impostor switch.
    if (this.backdrop) cullBackdropDetail(this.backdrop, at);
    if (this.seaView) this.seaView.update(at, this.net ? this.net.serverTick() * SIM_DT : this.simTime, this.renderer.scene);
    // After the first physics step: scene queries only see the map colliders from then on.
    if (this.simTime > 0) this.groundCover?.update(at, this.elapsed);
    this.snowfall?.update(at, this.elapsed, this.renderer.canvas.height);
  }

  // ---------------------------------------------------------------------------
  // Main menu background (options.showcase)

  private showcaseCam: ShowcaseCamera | null = null;
  /** When the last showcase frame ran (it runs at ~30 fps). */
  private showcaseAt = 0;

  /** The match runs on its own: nobody deploys, nothing is heard, the camera does its rounds. */
  private startShowcase(): void {
    this.audio.setVolume(0);
    this.renderer.fpScene.visible = false;
    this.renderer.setRenderScale(Math.min(this.settings.renderScale, 0.75));
    const zm = this.zoneMode;
    const down = new THREE.Vector3(0, -1, 0);
    const from = new THREE.Vector3();
    this.showcaseCam = new ShowcaseCamera({
      zones: zm ? zm.zones.map((z) => ({ x: z.x, y: z.y, z: z.z, radius: z.radius })) : [],
      actors: () => {
        const bots = this.bots;
        if (!bots) return [];
        return bots.bots.filter((b) => b.alive && !b.riding).map((b) => ({ id: b.id, pos: b.feet, yaw: b.yaw, fighting: b.inCombat(bots.time) }));
      },
      ground: (x, z) => {
        const hit = this.physics.raycast(from.set(x, 400, z), down, 800, Layer.WORLD);
        return hit ? hit.point.y : null;
      },
      clear: (a, b) => {
        const d = b.clone().sub(a);
        const len = d.length();
        return len < 0.01 || !this.physics.raycast(a, d.divideScalar(len), len, Layer.WORLD);
      },
    });
    this.running = true;
    this.started = true;
    this.loop.reset();
    this.overlay.hide();
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  /** Engine sounds: every vehicle and recon plane near enough, retuned each frame (see audio/engines.ts). */
  private updateEngines(ear: THREE.Vector3): void {
    if (!this.engines) {
      const host = this.audio.engineHost();
      if (!host) return;
      this.engines = new EngineSounds(host);
    }
    const list = this.engineList;
    list.length = 0;
    for (const v of this.vehicles?.vehicles ?? []) {
      list.push({ id: v.id, kind: v.kind, pos: v.model.root.position, velocity: v.velocity, crewed: v.seats.some(Boolean), wrecked: v.wrecked, throttle: v.flight?.throttle ?? null });
    }
    let i = 0;
    for (const p of this.support.planes()) list.push({ id: 90000 + i++, kind: 'recon', pos: p.pos, velocity: this.reconVel, crewed: true, wrecked: false, throttle: null });
    // The listener's own motion (for the Doppler shift).
    const dt = Math.max(1e-3, this.elapsed - this.earAt);
    this.earVel.subVectors(ear, this.earPrev).divideScalar(dt);
    if (this.earVel.lengthSq() > 200 * 200) this.earVel.set(0, 0, 0);
    this.earPrev.copy(ear);
    this.earAt = this.elapsed;
    // On foot aircraft are heard only close by (see AIR_ON_FOOT).
    this.engines.update(list, ear, this.earVel, !this.ride && !this.chute);
  }
  private engines: EngineSounds | null = null;
  private readonly engineList: EngineSource[] = [];
  private readonly earVel = new THREE.Vector3();
  private readonly earPrev = new THREE.Vector3();
  private earAt = 0;
  private readonly reconVel = new THREE.Vector3(0, 0, 0);

  /**
   * In a vehicle: first person from the seat by default (the gunner a little
   * behind the gun); C switches to a third-person view orbiting the vehicle
   * with the view, pulled in by walls.
   */
  /**
   * What the first-person view from a seat is (owner, 2026-10-12: every
   * vehicle's, after BFV): a pilot's cockpit; an open seat as it is (the
   * vehicle in sight); inside the hull a cannon's sight, a machine gun's
   * ring sight, or a vision block for seats without a gun.
   */
  private rideViewKind(v: Vehicle, seat: number): VehicleViewKind {
    const s = v.spec.seats[seat]!;
    if (v.flight && s.role === 'driver') return 'cockpit';
    if (s.exposed) return 'open';
    const gun = v.mounts[seat]?.gun;
    if (!gun) return 'port';
    return gun.shell || gun.blast > 0 ? 'sight' : 'mg';
  }

  /** Shows the ridden vehicle's model again, or hides `v`'s (from inside it the hull would fill the view). */
  private showRideModel(hide: Vehicle | null): void {
    if (this.hiddenRide && this.hiddenRide !== hide) this.hiddenRide.model.root.visible = true;
    this.hiddenRide = hide;
    if (hide) hide.model.root.visible = false;
  }

  /** The first-person field of view in a vehicle: zoomed sights, a little wider with speed in open ones. */
  private rideFov(v: Vehicle, dt: number): number {
    const kind = this.rideViewKind(v, this.ride!.seat);
    const base = this.settings.fov;
    // The aim button zooms the sights (seats with a second weapon on it don't: jets fire missiles with it).
    const zoomable = (kind === 'sight' || kind === 'mg') && !v.altMounts[this.ride!.seat];
    const want = zoomable && this.input.ads ? (kind === 'sight' ? RIDE_ZOOM.sight : RIDE_ZOOM.mg) : 1;
    this.rideZoom += (want - this.rideZoom) * (1 - Math.exp(-12 * dt));
    if (Math.abs(this.rideZoom - want) < 0.01) this.rideZoom = want;
    let fov = zoomedFov(base, this.rideZoom);
    if (kind === 'open' || kind === 'cockpit') fov += Math.min(1, v.velocity.length() / (v.flight ? 160 : 25)) * RIDE_ZOOM.speedFov;
    return fov;
  }

  private rideCamera(alpha: number, dt: number): void {
    const { v, seat } = this.ride!;
    const cam = this.renderer.camera;
    const p = this.player;
    const role = v.spec.seats[seat]!.role;
    const fwd = this.tmpFwd.set(0, 0, -1).applyEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'));
    this.showRideModel(this.rideThird || this.rideViewKind(v, seat) === 'open' ? null : v);
    if (!this.rideThird) {
      const kind = this.rideViewKind(v, seat);
      const eye = this.tmpRideEye;
      if (kind === 'sight') {
        // At the sight beside the gun's trunnion (the turret is posed for this frame already).
        const gun = v.model.mounts[seat]?.gun;
        if (gun) gun.getWorldPosition(eye).y += 0.3;
        else v.seatEye(seat, eye, alpha);
      } else {
        v.seatEye(seat, eye, alpha);
        if (role === 'gunner') eye.addScaledVector(fwd, -0.35).y += 0.15;
      }
      // Open seats ride the bumps a little softer than the hull does (the head isn't bolted to it).
      if (kind === 'open' && this.rideEyeSet && this.rideEye.distanceTo(eye) < 3) {
        this.rideEye.x = eye.x;
        this.rideEye.z = eye.z;
        this.rideEye.y += (eye.y - this.rideEye.y) * (1 - Math.exp(-14 * dt));
      } else this.rideEye.copy(eye);
      this.rideEyeSet = true;
      cam.position.copy(this.rideEye);
      // A pilot's view banks with the plane.
      if (kind === 'cockpit' && v.flight) this.camRoll = v.flight.roll;
      // A driver working the main gun sees through its sight: where the gun points, which follows the look at its turn rate.
      if (v.spec.seats[seat]!.turn) this.gunView = v.mountAim(seat);
      return;
    }
    this.rideEyeSet = false;
    if (this.rideThird) {
      const o = this.orbit;
      if (o) {
        viewDir(o.yaw, o.pitch, fwd);
        this.gunView = { yaw: o.yaw, pitch: o.pitch };
      }
      const target = this.rideCamTarget(v, alpha, new THREE.Vector3());
      const want = v.ship
        ? SHIP_CAM.dist + SHIP_CAM.distPerLength * v.spec.half[2] * 2
        : v.flight
          ? 20
          : v.kind === 'apc' || v.kind === 'rocket'
            ? 10
            : v.kind === 'bike'
              ? 4.5
              : TANK_KINDS.includes(v.kind)
                ? 11
                : 6.5;
      // Its own hull never pulls the camera in (a deck's houses and guns are parts of its body).
      const hit = this.physics.raycast(target, fwd.clone().negate(), want, Layer.WORLD, v.spec.deck ? undefined : v.collider, v.spec.deck ? v.body : undefined);
      const dist = hit ? Math.max(1.2, hit.distance - 0.3) : want;
      // Pull in at once, ease back out.
      this.rideCamDist = dist < this.rideCamDist ? dist : this.rideCamDist + (dist - this.rideCamDist) * (1 - Math.exp(-3 * dt));
      cam.position.copy(target).addScaledVector(fwd, -this.rideCamDist);
      // Over a warship the camera stays above the waves.
      const sea = v.ship ? this.gadgets.water?.(cam.position.x, cam.position.z) : undefined;
      if (sea !== undefined && Number.isFinite(sea)) cam.position.y = Math.max(cam.position.y, sea + SHIP_CAM.overSea);
    }
  }
  private readonly tmpRideEye = new THREE.Vector3();

  /** The seat's first-person overlay (sights, cockpit), or none. */
  private rideViewState(): VehicleViewState | null {
    const r = this.ride;
    if (!r || !this.player.alive) return null;
    if (this.rideThird && !this.orbit) return null;
    const { v, seat } = r;
    const kind: VehicleViewKind = this.rideThird ? 'third' : this.rideViewKind(v, seat);
    if (kind === 'open') return null;
    const m = v.mounts[seat];
    const cam = this.renderer.camera;
    // Hull heading against the view, for the turret compass (+ = the hull points to the right of the view).
    let hull = v.yaw - (this.gunView?.yaw ?? this.player.yaw);
    hull = Math.atan2(Math.sin(hull), Math.cos(hull));
    let range: number | null = null;
    if (kind === 'sight') {
      const fwd = this.tmpFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const hit = this.physics.raycast(cam.position, fwd, 1500, Layer.WORLD | Layer.HITBOX, undefined, v.body);
      range = hit ? hit.distance : null;
    }
    const f = v.flight;
    let alt = 0;
    if (f) {
      const below = this.physics.raycast(v.pos, new THREE.Vector3(0, -1, 0), 2000, Layer.WORLD);
      alt = below ? below.distance : v.pos.y;
    }
    return {
      kind,
      zoom: this.rideZoom,
      reload: m ? v.reloadLeft(seat, this.simTime) : 0,
      heat: m?.heat ?? 0,
      overheated: m?.overheated ?? false,
      health: v.health / v.spec.health,
      hullYaw: -hull,
      aimYaw: this.gunView ? Math.atan2(Math.sin(this.player.yaw - this.gunView.yaw), Math.cos(this.player.yaw - this.gunView.yaw)) : 0,
      aimPitch: this.gunView ? this.player.pitch - this.gunView.pitch : 0,
      range,
      lobbed: !!m?.gun.shell?.lob,
      pitch: f ? f.pitch : this.player.pitch,
      roll: f ? f.roll : 0,
      heading: f ? f.yaw : v.yaw,
      speed: f ? f.speed * 3.6 : v.velocity.length() * 3.6,
      alt,
      throttle: f?.throttle ?? 0,
      locked: !!(f && v.altMounts[seat]?.gun.homing && this.lockTarget(v, this.myTeam)),
      warning: f?.turningBack ? t('jet.airspace') : null,
      fovY: cam.fov,
      gun: kind === 'third' ? this.gunOnScreen(v, seat) : null,
      gunName: m ? t(`vehicleGun.${m.id}`) : '',
      vehicleName: t(`vehicle.${v.kind}`),
    };
  }

  /** Where the seat's gun points now, on the screen (px), or null when that is behind the camera. */
  private gunOnScreen(v: Vehicle, seat: number): { x: number; y: number } | null {
    const gun = v.mountAim(seat);
    if (!gun) return null;
    const spec = v.mounts[seat]!.gun;
    const from = v.muzzleOf(seat, this.tmpOrbitAim);
    let at: THREE.Vector3;
    const shell = spec.shell;
    if (v.ship && shell && shell.gravity > 0 && spec.blast >= 5 && !spec.depth && gun.pitch > 0.002) {
      // A warship's big gun (not the AA): where its shell comes down on the sea now (the gun is elevated for the range).
      const dist = Math.min(spec.range, (shell.speed * shell.speed * Math.sin(2 * gun.pitch)) / shell.gravity);
      at = from.addScaledVector(viewDir(gun.yaw, 0, this.tmpOrbitDir), dist);
      const sea = this.gadgets.water?.(at.x, at.z);
      if (sea !== undefined && Number.isFinite(sea)) at.y = sea;
    } else {
      const dir = viewDir(gun.yaw, gun.pitch, this.tmpOrbitDir);
      const range = Math.max(400, spec.range);
      const hit = this.physics.raycast(from, dir, range, Layer.WORLD | Layer.HITBOX, undefined, v.body);
      at = from.addScaledVector(dir, hit ? hit.distance : range);
    }
    at.project(this.renderer.camera);
    if (at.z > 1) return null;
    return { x: ((at.x + 1) / 2) * window.innerWidth, y: ((1 - at.y) / 2) * window.innerHeight };
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
      this.rider = new SoldierModel(this.myTeam, this.weapons.def);
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
      sprinting: p.sprinting || p.swimming,
      sprintOut: w.sprintOutLeft,
      lookDYaw: lookYaw,
      lookDPitch: lookPitch,
      reloading: w.state.reloading,
      reloadProgress: w.state.reloadProgress,
      magReload: w.def.reloadStyle === 'mag',
      drawProgress: p.alive && this.deployed ? w.drawProgress : 0,
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
  private aimCheckIn = 0;
  private aimSeen: { side: 'ally' | 'enemy'; name: string } | null = null;
  private readonly aimDir = new THREE.Vector3();

  /**
   * Who the crosshair is on, for the HUD (owner, 2026-10-19: friend and foe
   * were hard to tell apart): one ray from the view ten times a second, the
   * first wall or soldier within `AIM_ID_RANGE` m.
   */
  private aimAtFor(dt: number): { side: 'ally' | 'enemy'; name: string } | null {
    if (!this.player.alive || this.playerDowned || this.ride) return (this.aimSeen = null);
    this.aimCheckIn -= dt;
    if (this.aimCheckIn > 0) return this.aimSeen;
    this.aimCheckIn = 0.1;
    const cam = this.renderer.camera;
    const dir = this.aimDir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = this.physics.raycast(cam.position, dir, AIM_ID_RANGE, Layer.WORLD | Layer.HITBOX, undefined, undefined, undefined, this.me.boxes.slot);
    const owner = hit ? this.registry.lookup(hit.collider.handle)?.owner : undefined;
    if (!owner || !owner.alive || owner.id === this.myId || owner.team === undefined || owner.team === null) return (this.aimSeen = null);
    const ally = !foes(owner as { id: number; team: Team }, this.playerCombatant);
    return (this.aimSeen = { side: ally ? 'ally' : 'enemy', name: owner.name });
  }

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
    for (const e of this.bots.enemiesOf(this.myTeam)) {
      if (!e.alive || e.id === this.myId) continue;
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
      ? zm.zones.filter((z) => !z.hidden).map((z) => ({ id: z.id, x: z.x, z: z.z, r: z.radius, owner: z.owner === null ? null : z.owner === this.myTeam ? 'ally' : 'enemy', contested: z.contested }))
      : [];
    f.allies.length = 0;
    f.enemies.length = 0;
    if (this.bots) {
      const squad = this.playerSquad;
      for (const b of this.bots.bots) {
        if (b.alive && friends(b, this.meSide)) f.allies.push({ x: b.feet.x, z: b.feet.z, squad: !!squad?.has(b.id) });
      }
      for (const e of this.bots.spottedEnemies({ id: this.myId, team: this.myTeam }, p.feet)) f.enemies.push({ x: e.feet.x, z: e.feet.z });
    }
    if (this.net) {
      const squad = this.playerSquad;
      for (const o of this.net.others()) {
        if (!o.alive) continue;
        if (friends(o, this.meSide)) f.allies.push({ x: o.feet.x, z: o.feet.z, squad: !!squad?.has(o.id) });
        else if ((this.netSpotted.get(o.id) ?? 0) > this.elapsed) f.enemies.push({ x: o.feet.x, z: o.feet.z });
      }
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
    const me = this.me;
    const kitText = this.cls === 'medic' ? (me.medkitReady ? '∞' : `${Math.ceil(me.medkitReadyAt - this.simTime)}s`) : String(this.medkits);
    // Simplified matches have no medkits (the chip and the touch button go).
    const medkit = onField && !MATCH.simple ? { text: kitText, ready: me.medkitReady } : null;
    const reviver = this.playerDowned ? (this.bots?.reviverFor(this.playerCombatant) ?? null) : null;
    const down = this.playerDowned
      ? {
          left: Math.max(0, DOWN.bleedOut - me.downTime),
          giveUp: Math.min(1, me.giveUpHold / DOWN.giveUpHold),
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
    } else if (act?.kind === 'reviveMate') {
      prompt = { text: `${key(true)}${t('act.revive')} ${act.name}`, progress: me.reviveProgress > 0 ? me.reviveProgress / CLASSES[this.cls].reviveTime : null };
      touchLabel = t('act.revive');
    } else if (act?.kind === 'giveMate') {
      const label = t(act.what === 'medkit' ? 'act.giveMedkit' : 'act.giveAmmo');
      prompt = { text: `${key(false)}${label} → ${act.name}`, progress: null };
      touchLabel = label;
    } else if (act?.kind === 'medkit') {
      prompt = { text: `${key(false)}${t('act.giveMedkit')} → ${act.bot.name}`, progress: null };
      touchLabel = t('act.giveMedkit');
    } else if (act?.kind === 'fort') {
      ({ prompt, touchLabel } = this.fortPrompt(act.job, act.station, act.note, key));
    } else if (act?.kind === 'charge') {
      const c = act.charge;
      const times = this.zoneMode!.charges!.times;
      const label = t(act.plant ? 'charge.plant' : 'charge.defuse');
      const mine = c.by === this.myId;
      prompt = { text: `${key(true)}${label} ${c.id}`, progress: mine && c.work > 0 ? c.work / (act.plant ? times.plant : times.defuse) : null };
      touchLabel = label;
    }
    if (onField && this.ride) {
      const { v, seat } = this.ride;
      const role = v.spec.seats[seat]!.role;
      const n = v.seats.length;
      const station = v.spec.seats[seat]!.station;
      const parts = [`${t(`vehicle.${v.kind}`)} · ${station ? t(`station.${station.kind}`) : t(`seat.${role}`)}`];
      if (v.ship) parts.push(...this.shipLine(v, seat));
      if (v.spec.plane) parts.push(...this.planeLine(v, seat));
      const mount = v.mounts[seat];
      if (mount?.overheated) parts.push(t('vehicle.overheat'));
      if (v.reloadLeft(seat, this.simTime) > 0) parts.push(t('vehicle.reloading'));
      parts.push(this.touch ? t('vehicle.exitTouch') : t('vehicle.exit'));
      if (n > 1 && !this.touch && !v.ship) parts.push(t('vehicle.seats').replace('{keys}', `${actionKey('slot1')}–${actionKey(`slot${Math.min(9, n)}` as Action)}`));
      if (!this.touch) parts.push(t('vehicle.view'));
      const f = v.flight;
      // In the cockpit the instruments say it; from outside the line does.
      if (f && this.rideThird) {
        const below = this.physics.raycast(v.pos, new THREE.Vector3(0, -1, 0), 2000, Layer.WORLD);
        parts.splice(1, 0, t('jet.hud').replace('{alt}', String(Math.round(below ? below.distance : v.pos.y))).replace('{spd}', String(Math.round(f.speed * 3.6))).replace('{thr}', String(Math.round(f.throttle * 100))));
        if (v.altMounts[seat]?.gun.homing && this.lockTarget(v, this.myTeam)) parts.splice(2, 0, t('jet.locked'));
        if (f.turningBack) parts.splice(2, 0, t('jet.airspace'));
      }
      if (f && !this.touch) parts.push(t('jet.controls'));
      prompt = { text: parts.join(' — '), progress: Math.max(0, v.health / v.spec.health) };
      touchLabel = t('touch.exitVehicle');
    } else if (onField && !prompt && !this.buildMode) {
      const near = this.vehicles?.enterAt(this.player.feet, (v, i) => i > 0 || v.driverOnly === null || v.driverOnly === this.myId, this.botYields);
      const station = near?.v.spec.seats[near.seat]!.station;
      if (near && station) {
        const out = (near.v.ship?.broken.has(near.seat) ? ` (${t('ship.out')})` : '') + (near.bump !== null ? ` (${t('ship.relieve')})` : '');
        prompt = { text: `${key(false)}${t('ship.man')}: ${t(`station.${station.kind}`)}${out} · ${t(`vehicle.${near.v.kind}`)}`, progress: null };
        touchLabel = t('ship.man');
      } else if (near) {
        prompt = { text: `${key(false)}${t('vehicle.enter')}: ${t(`vehicle.${near.v.kind}`)}${near.bump !== null ? ` (${t('ship.relieve')})` : ''}`, progress: null };
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
      scoped: onField && !MATCH.simple && !!w.def.scope && w.adsBlend > 0.5,
      // Call-ins are picked on foot only (see simStep), so the button goes while aboard.
      support: supportState && !this.ride ? this.supportMenu.open || !!this.supportAim : null,
      ride: this.ride ? (this.ride.v.spec.seats[this.ride.seat]!.role === 'driver' ? (this.ride.v.flight ? 'fly' : 'drive') : 'seat') : null,
      simple: MATCH.simple,
      melee: MATCH.melee,
    });
    // First person in a vehicle: its sight or cockpit over the view, and no infantry crosshair under it.
    const rideView = this.rideViewState();
    this.vehicleView.update(rideView);
    this.hud.root.classList.toggle('in-sight', !!rideView);
    this.hud.root.classList.toggle('in-vehicle', !!this.ride && this.player.alive);
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
          w.def.scope && w.adsBlend > 0.9 && this.player.alive && !this.playerDowned && !MATCH.simple
            ? { air: this.breath.air / BREATH.air, holding: this.breath.holding, locked: this.breath.locked, hint: t(this.touch ? 'breath.hintTouch' : 'breath.hint') }
            : null,
        dark: this.player.alive ? this.breath.dark : 0,
        rp: supportState ? `${t('support.hud')} ${supportState.rp}${this.touch || !actionKey('support') ? '' : ` · ${actionKey('support')}`}` : null,
        grenadeLabel: t(`grenade.${sel}` as MessageKey),
        grenadeType: sel,
        grenadeCount: this.grenades.count,
        gadget:
          this.gadget && this.deployed
            ? { id: this.gadget, key: this.touch || !actionKey('slot4') ? '' : `${actionKey('slot4')} · `, label: t(`gadgetName.${this.gadget}`), count: this.gadgetCount, out: this.gadgetOut }
            : null,
        flash,
        respawnIn: this.player.alive || this.playerDowned ? null : Math.max(0, this.respawnTimer),
        medkit,
        down,
        prompt,
        killedBy: this.killedBy,
        score: this.bots ? { allies: this.bots.score(this.myTeam), enemies: this.bots.score(otherTeam(this.myTeam)) } : null,
        zone: this.zoneHud(),
        squad: this.squadHud(),
        aimAt: this.aimAtFor(dt),
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

  private setupZoneMode(map: MapDef, terrain: Terrain, mode: ModeKind | undefined): void {
    const b = this.options.bots;
    const teamSize = { blue: 0, red: 0 };
    teamSize[this.myTeam] = (b?.allies ?? 0) + 1;
    teamSize[otherTeam(this.myTeam)] = b?.enemies ?? 1;
    const zm = new ZoneMode(map, this.bus, { tickets: this.options.tickets, mode, teamSize, passive: !!this.options.net, simple: !!this.options.simple });
    if (zm.match instanceof KillConfirmRules) this.tagVisuals = new TagVisuals(this.renderer.scene);
    if (zm.charges) {
      // On walkable ground (a browser in a match on the game server gets the server's spots with the rules).
      zm.snapCharges(this.nav);
      this.chargeVisuals = new ChargeVisuals(this.renderer.scene);
    }
    if (zm.lastStand) {
      // Crates on walkable ground (a browser in a match on the game server gets the server's).
      const b = this.options.bots;
      zm.placeLoot(this.nav, (b?.allies ?? 0) + (b?.enemies ?? 0) + 1);
      const zs = zm.zones;
      this.lastStandVisuals = new LastStandVisuals(this.renderer.scene, zs.reduce((a, z) => a + z.y, 0) / Math.max(1, zs.length));
    }
    if (zm.match instanceof EscortRules) {
      // On the roads (a browser in a match on the game server gets the server's route with the rules).
      zm.planRoute(this.bots?.vehicleNav ?? null, this.nav);
      this.escort = new EscortWorld(this.physics, this.renderer.scene, zm.match.attacker);
    }
    this.zoneMode = zm;
    if (import.meta.env.DEV) console.info(`[strikegy] mode ${zm.kind}`);
    this.zoneVisuals = new ZoneVisuals(this.renderer.scene, zm.zones, (x, z) => terrain.heightAt(x, z));
    if (!this.options.net) this.bus.on('combatant:died', (e) => zm.onDeath(e.team));
    // The battle briefing (owner, 2026-10-17): the strip and HQ's radio take the news below.
    this.briefing = new Briefing(this.hud.root, this.audio, this.settings.locale, this.settings.subtitles, ASSET_BASE, voiceLangFor(map.meta.id));
    this.briefDirector = new BriefingDirector(this.briefing, zm, {
      myTeam: this.myTeam,
      myId: this.myId,
      onField: () => this.deployed && this.player.alive,
      outsideCircle: () => this.deployed && this.player.alive && zm.stormDps(this.player.feet) > 0,
    }, this.bus);
    this.briefDirector.start();
    this.bus.on('zone:captured', (e) => {
      const ours = e.team === this.myTeam;
      this.audio.zoneCue(ours);
      this.bots?.replan('blue');
      this.bots?.replan('red');
    });
    this.bus.on('zone:neutralized', (e) => {
      const ours = e.team === this.myTeam;
      this.audio.zoneCue(!ours);
      if (ours && this.spawnKey === `zone:${e.zone}`) this.spawnKey = 'base';
      this.bots?.replan('blue');
      this.bots?.replan('red');
    });
    this.bus.on('mode:event', (e) => this.onModeEvent(e));
    this.bus.on('match:ended', (e) => this.endMatch(e.winner, e.winnerId));

    // Scoreboard stats; the player's own points pop up under the crosshair.
    this.scores.onPoints = (id, points, reason) => {
      if (id === this.myId) this.hud.scorePopup(points, t(`points.${reason}`));
    };
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
    const plan = fortPlanFor({ map, terrain, water, sea: water?.sea ?? null, built, shaped: true }, this.physics);
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
      this.bots.zoneOwner = (id, team) => this.zoneMode?.stationOwner(id, team) ?? null;
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
    // Bot matches and matches on the game server have a table (the range doesn't).
    const show = held && (!!this.bots || !!this.net) && !this.overlay.visible;
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
    const zm = this.zoneMode;
    const alive = new Map<number, boolean>();
    for (const c of this.combatants()) alive.set(c.id, c.alive);
    // On the game server: everyone drawn here (enemies out of sight count as up; the table doesn't tell).
    if (this.net) {
      alive.set(this.myId, this.player.alive && this.deployed);
      for (const info of this.net.roster.values()) {
        if (info.id === this.myId) continue;
        const r = this.net.remote(info.id);
        alive.set(info.id, info.team !== this.myTeam || (r?.alive ?? false));
      }
    }
    const m = zm?.match;
    if (m instanceof SoloRules) {
      // Free-for-all: everyone in one ranking, the top half on the left.
      const all = this.scores.table(null).sort((a, b) => m.scoreOf(b.id) - m.scoreOf(a.id) || b.score - a.score || a.id - b.id);
      const half = Math.ceil(all.length / 2);
      const rows = (list: typeof all) =>
        list.map((r) => ({ name: r.name, tag: this.net?.roster.get(r.id)?.tag, squad: null, kills: r.kills, deaths: r.deaths, captures: m.scoreOf(r.id), score: r.score, alive: alive.get(r.id) ?? false, you: r.id === this.myId, mate: false }));
      const label = (from: number, to: number) => t('score.ranks').replace('{a}', String(from)).replace('{b}', String(Math.max(from, to)));
      this.scoreboard.update(
        { label: label(1, half), stat: null, kills: all.slice(0, half).reduce((a, r) => a + r.kills, 0), rows: rows(all.slice(0, half)) },
        { label: label(half + 1, all.length), stat: null, kills: all.slice(half).reduce((a, r) => a + r.kills, 0), rows: rows(all.slice(half)) },
      );
      return;
    }
    const side = (team: Team): ScoreboardSide => ({
      label: t(team === this.myTeam ? 'hud.allies' : 'hud.enemies'),
      stat: zm ? this.modeScoreLine(team) : null,
      kills: this.scores.totals(team).kills,
      rows: this.scores.table(team).map((r) => ({
        name: r.name,
        tag: this.net?.roster.get(r.id)?.tag,
        squad: this.squads.find((s) => s.team === team && s.has(r.id))?.name ?? null,
        kills: r.kills,
        deaths: r.deaths,
        captures: r.captures,
        score: r.score,
        alive: alive.get(r.id) ?? false,
        you: r.id === this.myId,
        mate: r.id !== this.myId && !!this.playerSquad?.has(r.id),
      })),
    });
    this.scoreboard.update(side(this.myTeam), side(otherTeam(this.myTeam)));
  }

  // ---------------------------------------------------------------------------
  // Squads & deploying

  private setupSquads(map: MapDef, terrain: Terrain): void {
    const bots = this.bots!;
    const us = this.myTeam;
    const them = otherTeam(us);
    const ours = bots.bots.filter((b) => b.team === us);
    const theirs = bots.bots.filter((b) => b.team === them);
    // Free-for-all: nobody has a squad.
    this.squads = MATCH.squads ? [...formSquads(us, [this.playerCombatant, ...ours]), ...formSquads(them, theirs)] : [];
    for (const c of [this.playerCombatant, ...ours, ...theirs]) this.scores.add(c.id, c.id === this.myId ? playerName(t('feed.you')) : c.name, c.team);
    this.playerSquad = this.squads.find((s) => s.has(this.myId)) ?? null;
    bots.setSquads(
      this.squads.map((sq) => ({
        index: sq.index,
        botIds: sq.members.filter((m) => m.id !== this.myId).map((m) => m.id),
        leader: sq.has(this.myId) ? this.playerCombatant : null,
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
    // Last soldier standing: a pistol until a crate; bots go for crates and into the circle.
    const ls = zm?.lastStand;
    if (ls) {
      bots.weaponOverride = (bot) => ({ id: (ls.armed[bot.id] ?? 'pistol1') as WeaponId, empty: false });
      bots.hooks.goalFor = (bot) => zm!.lastStandGoal(bot.id, bot.feet);
      for (const b of bots.bots) bots.rearm(b);
    }
    // Gun game: every bot carries its step's gun.
    const gg = zm?.match;
    if (gg instanceof GunGameRules) {
      bots.weaponOverride = (bot) => {
        const k = gunGameKit(gg.scoreOf(bot.id));
        return { id: k.weapon, empty: k.empty };
      };
      for (const b of bots.bots) bots.rearm(b);
    }
    // One sector open: start on what each side holds nearest the fight (the base can be far from it).
    if (zm && zm.kind !== 'zone') bots.redeployAll();
    this.bus.on('combatant:resupplied', (e) => this.scores.resupply(e.byId));
    // Revives: points to the reviver, a line in the feed for the player's side.
    this.bus.on('combatant:revived', (e) => {
      this.scores.revive(e.byId, e.medic);
      if (e.team === this.myTeam && e.byId !== this.myId && e.id !== this.myId) {
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
        if (m.id === this.myId) this.respawnTimer += WIPE_PENALTY;
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
      () => this.pause(),
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

  /** Last soldier standing: outside the circle it hurts, the player and the bots alike. */
  private stepStorm(dt: number): void {
    const zm = this.zoneMode;
    if (!zm?.lastStand) return;
    const p = this.player;
    if (p.alive && this.deployed && !this.playerDowned) {
      const d = zm.stormDps(p.feet);
      if (d > 0) this.damagePlayer(d * dt, null, 'storm');
    }
    for (const b of this.bots?.bots ?? []) {
      if (!b.alive) continue;
      const d = zm.stormDps(b.feet);
      if (d > 0) b.applyDamage(d * dt, 'body');
    }
  }

  /** Escort: the payload's hull and model to where the rules have it (after the rules stepped). */
  private stepEscort(): void {
    const m = this.zoneMode?.match;
    if (this.escort && m instanceof EscortRules) this.escort.step(m);
  }

  /**
   * S&D: a new round. Every bot is back at its side's start; the player too
   * (alive: moved there with a fresh life; dead or not deployed: may deploy now).
   */
  private newRound(): void {
    this.bots?.respawnAll();
    if (this.ride) this.leaveVehicle();
    if (this.deployed && this.player.alive && !this.playerDowned) this.respawn('base');
    else this.respawnTimer = 0;
  }

  private deploy(): void {
    if (this.matchOver || this.deployed || this.respawnTimer > 0) return;
    const opts = this.deployOptions();
    const choice = opts.find((o) => o.key === this.spawnKey && !o.blocked) ?? opts[0]!;
    this.audio.unlock();
    if (this.net) {
      if (this.netDeploying) return;
      this.netDeploying = true;
      this.loadoutPanel?.close();
      this.net.deploy(choice.key, this.loadouts.current);
      this.deployScreen!.hide();
      // No answer (the server said no: still waiting to respawn): the deploy screen again.
      window.setTimeout(() => (this.netDeploying = false), 3000);
      if (this.touch) {
        this.enterFullscreen();
        this.touch.setVisible(true);
      } else this.kbm.requestLock();
      return;
    }
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
    const list = this.mapSpawns.filter((s) => s.team === team || (team === 'blue' && s.team === 'player'));
    return list.reduce((a, s) => a.add(new THREE.Vector3(...s.pos)), new THREE.Vector3()).divideScalar(Math.max(1, list.length));
  }

  /** Spawn position for a deploy key ('base' | 'zone:<id>' | 'mate:<id>'); invalid keys fall back to the base. */
  private spawnFor(team: Team, key: string, selfId: number): { pos: THREE.Vector3; yaw: number } {
    const [kind, id] = key.split(':');
    // A bot deploying into a vehicle seat: seated right after the respawn (see
    // `seatPending`), and meanwhile at its base, so if the seat has gone by
    // then (taken, wrecked) it is on the ground there, not where a plane was.
    if (kind === 'veh' && selfId !== this.myId) {
      const v = this.vehicles?.get(Number(id));
      let pending = 0;
      for (const vid of this.pendingSeats.values()) if (vid === v?.id) pending++;
      if (v && this.freeSeatFor(v, team, selfId) >= 0 && this.freeSeatCount(v, team, selfId) > pending) {
        this.pendingSeats.set(selfId, v.id);
        return this.spawnFor(team, 'base', selfId);
      }
    }
    // A bot respawning into a new jet: seated right after (see `seatPending`), at its base meanwhile.
    if (kind === 'jet' && selfId !== this.myId) {
      const v = this.spawnJet(JET_KINDS[Math.floor(Math.random() * JET_KINDS.length)]!, team);
      if (v) {
        this.pendingSeats.set(selfId, v.id);
        return this.spawnFor(team, 'base', selfId);
      }
    }
    // Fleet battle: people come out on one of the side's ships, whatever they picked.
    if (selfId === this.myId && this.zoneMode?.match instanceof FleetRules && kind !== 'ship' && kind !== 'veh') {
      const v = this.vehicles ? fleetShip(this.vehicles.vehicles, team, Math.random) : null;
      if (v) return deckSpawn(v, Math.random, (id) => this.isBotId(id));
    }
    if (kind === 'ship') {
      const v = this.vehicles?.get(Number(id));
      if (v?.ship && !v.wrecked && (v.team ?? v.home) === team) return deckSpawn(v, Math.random, (id) => this.isBotId(id));
    }
    if (kind === 'beacon') {
      const b = this.gadgets.beaconsFor({ id: selfId, team }, this.squadKeyOf(team, selfId)).find((x) => String(x.id) === id);
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
    if (zm) return zm.spawnPoint(team, kind === 'zone' ? id! : 'base', this.nav, Math.random, selfId);
    const list = this.mapSpawns.filter((s) => s.team === team || (team === 'blue' && s.team === 'player'));
    const sp = list[Math.floor(Math.random() * list.length)];
    const pos = sp ? new THREE.Vector3(...sp.pos) : this.baseCenter(team);
    return { pos: this.nav?.randomAround(pos, 3) ?? pos, yaw: (sp?.yaw ?? 0) * DEG };
  }

  /** Combatant `id` (the player or a bot) sits in a vehicle. */
  private riding(id: number): boolean {
    if (id === this.myId) return !!this.ride;
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
    if (sq === this.playerSquad && mates.some((m) => m.id === this.myId)) return `mate:${this.myId}`;
    // Now and then straight into a new jet while the side is short of its limit
    // (owner, 2026-10-02: bots hardly flew; jets went only to bots back at their base).
    const vw = this.vehicles;
    if (vw && this.botJetSlot(bot.team) && Math.random() < BOT_JETS.respawn) return 'jet';
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
    for (const b of this.gadgets.beaconsFor(bot, this.squadKeyOf(bot.team, bot.id))) cands.push({ key: `beacon:${b.id}`, x: b.pos.x, z: b.pos.z });
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
    // A landing force's base is a ship: from there into a landing craft waiting by it.
    if (best.key === 'base' && this.landingTeam === bot.team) return this.landingSeat(bot.team, bot.id) ?? 'base';
    return best.key;
  }

  /** The side that lands from the sea on this map (null: none). */
  private landingTeam: Team | null = null;

  /**
   * A seat in a landing craft still by the ship (not under way), the one with
   * most aboard first so craft fill up and go; null when none has room.
   */
  private landingSeat(team: Team, id: number): string | null {
    const base = this.baseCenter(team);
    let best: Vehicle | null = null;
    let bestAboard = -1;
    for (const v of this.vehicles?.vehicles ?? []) {
      if (v.kind !== 'lcvp' || v.home !== team || v.wrecked || v.pos.distanceTo(base) > 260 || v.velocity.length() > 2.5) continue;
      if (this.freeSeatFor(v, team, id) < 0) continue;
      let pending = 0;
      for (const vid of this.pendingSeats.values()) if (vid === v.id) pending++;
      if (this.freeSeatCount(v, team, id) <= pending) continue;
      const aboard = v.seats.filter(Boolean).length + pending;
      if (aboard > bestAboard) {
        best = v;
        bestAboard = aboard;
      }
    }
    return best ? `veh:${best.id}` : null;
  }

  private deployOptions(): DeployOption[] {
    const out: DeployOption[] = [];
    const base = this.baseCenter(this.myTeam);
    const zm = this.zoneMode;
    // Fleet battle: aboard the side's ships only (the base islet is where spare bots wait).
    const fleetShips = zm?.match instanceof FleetRules && this.vehicles ? this.vehicles.vehicles.some((v) => v.ship && !v.wrecked && (v.team ?? v.home) === this.myTeam) : false;
    if (!fleetShips) out.push({ key: 'base', kind: 'base', label: t(zm?.solo ? 'spawn.anywhere' : 'spawn.base'), x: base.x, z: base.z, blocked: null, warn: null });
    for (const o of zm?.spawnOptions(this.myTeam) ?? []) {
      if (o.id === 'base') continue;
      const z = zm!.zone(o.id)!;
      out.push({ key: `zone:${o.id}`, kind: 'zone', label: `${t('spawn.zone')} ${o.id}`, x: z.x, z: z.z, blocked: null, warn: o.underAttack ? t('deploy.underAttack') : null });
    }
    // In a match on the game server: the side's beacons as the server has them.
    const mates = new Set(this.playerSquad?.members.map((m) => m.name));
    for (const b of this.net ? this.netBeacons : []) {
      if (b.team !== this.myTeam || !mates.has(b.owner)) continue;
      out.push({ key: `beacon:${b.id}`, kind: 'beacon', label: `${t('spawn.beacon')} (${b.owner}) ×${b.uses}`, x: b.pos[0], z: b.pos[2], blocked: null, warn: null });
    }
    // Spawn beacons the squad's recons put down.
    for (const b of this.gadgets.beaconsFor(this.meSide, this.squadKeyOf(this.myTeam, this.myId))) {
      const who = b.owner.id === this.myId ? playerName(t('feed.you')) : b.owner.name;
      out.push({ key: `beacon:${b.id}`, kind: 'beacon', label: `${t('spawn.beacon')} (${who}) ×${b.uses}`, x: b.pos.x, z: b.pos.z, blocked: null, warn: null });
    }
    // Tanks: start in one at the base, while the side is under its limit.
    const vw = this.vehicles;
    if (vw && vw.tankSpots.some((s) => s.team === this.myTeam)) {
      const full = vw.tanks(this.myTeam) >= vw.tankLimit();
      const spot = vw.freeTankSpot(this.myTeam);
      for (const kind of TANK_KINDS) {
        out.push({
          key: `tank:${kind}`,
          kind: 'vehicle',
          label: `${t('spawn.tank')}: ${t(`vehicle.${kind}`)} (${vw.tanks(this.myTeam)}/${vw.tankLimit()})`,
          x: spot?.pos.x ?? base.x,
          z: spot?.pos.z ?? base.z,
          blocked: full ? t('deploy.tankLimit').replace('{n}', String(vw.tankLimit())) : !spot ? t('deploy.noRoom') : null,
          warn: null,
        });
      }
    }
    if (vw && vw.jetLimit() > 0) {
      const full = vw.jets(this.myTeam) >= vw.jetLimit();
      for (const kind of JET_KINDS) {
        out.push({
          key: `jet:${kind}`,
          kind: 'vehicle',
          air: true,
          label: `${t('spawn.jet')}: ${t(`vehicle.${kind}`)} (${vw.jets(this.myTeam)}/${vw.jetLimit()})`,
          x: base.x,
          z: base.z,
          blocked: full ? t('deploy.tankLimit').replace('{n}', String(vw.jetLimit())) : null,
          warn: null,
        });
      }
    }
    // A free seat in one of the side's tanks or jets: deploy aboard.
    for (const v of vw?.vehicles ?? []) {
      const seat = this.freeSeatFor(v, this.myTeam, this.myId);
      if (seat < 0) continue;
      const aboard = v.seats.filter((s) => s).length;
      out.push({
        key: `veh:${v.id}`,
        kind: 'ride',
        air: !!v.spec.flight,
        label: `${t(`vehicle.${v.kind}`)} — ${t(`seat.${v.spec.seats[seat]!.role}`)} (${aboard}/${v.seats.length})`,
        x: v.pos.x,
        z: v.pos.z,
        blocked: null,
        warn: v.health < v.spec.health * 0.35 ? t('deploy.damaged') : null,
      });
    }
    // The side's warships: on deck, to walk up to a station (a ship is a spawn point).
    for (const v of vw?.vehicles ?? []) {
      if (!v.ship || v.wrecked || (v.team ?? v.home) !== this.myTeam) continue;
      // People aboard of all stations (bots give theirs up to people).
      const people = v.seats.filter((s) => s && !this.isBotId(s.id)).length;
      out.push({
        key: `ship:${v.id}`,
        kind: 'ride',
        label: `${t('spawn.ship')}: ${t(`vehicle.${v.kind}`)} (${t('spawn.shipPeople')} ${people}/${v.seats.length})`,
        x: v.pos.x,
        z: v.pos.z,
        blocked: v.ship.sinking >= 0 ? t('ship.sinking') : null,
        warn: v.health < v.spec.health * 0.35 ? t('deploy.damaged') : null,
      });
    }
    const now = this.bots?.time ?? this.simTime;
    for (const m of this.playerSquad?.mates(this.myId) ?? []) {
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
    const now = this.bots?.time ?? this.simTime;
    return {
      name: sq.name,
      members: sq.members.map((m) => ({
        name: m.id === this.myId ? playerName(t('feed.you')) : m.name,
        // Before the first deploy the player is waiting, not dead.
        state:
          m.id === this.myId
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
        you: m.id === this.myId,
      })),
    };
  }

  private deployState(): DeployState {
    const options = this.deployOptions();
    const sel = options.find((o) => o.key === this.spawnKey && !o.blocked) ? this.spawnKey : 'base';
    const zm = this.zoneMode;
    const tone = (team: Team | null) => (team === null ? 'neutral' : team === this.myTeam ? 'ally' : 'enemy') as 'ally' | 'enemy' | 'neutral';
    const squad = this.squadHud();
    // One life a round (S&D): no countdown, the next round lets you back in.
    const roundWait = !Number.isFinite(this.respawnTimer);
    return {
      options,
      selected: sel,
      wait: roundWait ? 999 : Math.max(0, this.respawnTimer),
      waitText: roundWait ? t(this.zoneMode?.lastStand ? 'lms.out' : 'snd.waitRound') : undefined,
      note: this.squadWiped ? t('squad.wiped') : null,
      title: this.mapName,
      matchLine: zm ? this.deployMatchLine() : null,
      zones: zm ? zm.zones.filter((z) => !z.hidden || (zm.freeSpawns && options.some((o) => o.key === `zone:${z.id}`))).map((z) => ({ id: z.id, x: z.x, z: z.z, r: z.radius, owner: tone(z.owner), pushing: z.pushing !== null })) : [],
      enemyBase: (() => {
        const b = this.baseCenter(otherTeam(this.myTeam));
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
    const side = (team: Team | null): Side | null => (team === null ? null : team === this.myTeam ? 'ally' : 'enemy');
    const zones = zm.order(this.myTeam).map((id) => {
      const z = zm.zone(id)!;
      return { id: z.id, owner: side(z.owner), progress: ZoneRules.progress(z), pushing: side(z.pushing), contested: z.contested, locked: z.locked };
    });
    let here: ZoneHud['here'] = null;
    const inZone = this.player.alive ? zm.zoneAt(this.player.feet) : null;
    if (inZone) {
      const ours = inZone.owner === this.myTeam;
      let text: string;
      let tone: Side | 'neutral' = inZone.owner === null ? 'neutral' : ours ? 'ally' : 'enemy';
      if (inZone.contested) text = t('zone.contested');
      else if (inZone.pushing === this.myTeam) {
        text = inZone.owner === null ? t('zone.capturing') : t('zone.neutralizing');
        tone = 'ally';
      } else if (inZone.pushing) {
        text = ours ? t('zone.losing') : t('zone.capturing');
        tone = 'enemy';
      } else text = inZone.owner === null ? t('zone.neutral') : ours ? t('zone.held') : t('zone.enemyHeld');
      // Bar: how much the zone leans toward us (full = ours).
      const lean = this.myTeam === 'blue' ? inZone.control : -inZone.control;
      here = { id: inZone.id, text, progress: (lean + 1) / 2, tone };
    }
    const us = this.myTeam;
    const them = otherTeam(us);
    return {
      score: { allies: this.modeScore(us), enemies: this.modeScore(them), fill: { allies: this.modeFill(us), enemies: this.modeFill(them) } },
      zones,
      status: this.modeStatus(),
      here,
    };
  }

  /** Most tickets each side has had (the gauge's full mark; Conquest refills can raise it). */
  private readonly ticketPeak: Record<Team, number> = { blue: 1, red: 1 };

  /** Free-for-all: this soldier's score and the best of everyone else's. */
  private soloScores(m: SoloRules): { mine: number; best: number; place: number; total: number } {
    const list = m.standings();
    const mine = m.scoreOf(this.myId);
    const best = list.find((s) => s.id !== this.myId)?.n ?? 0;
    return { mine, best, place: 1 + list.filter((s) => s.id !== this.myId && s.n > mine).length, total: Math.max(1, list.length) };
  }

  /** How full a side's score gauge is: points toward the target, or tickets left (free-for-all: me vs the best other). */
  private modeFill(team: Team): number {
    const m = this.zoneMode!.match;
    if (m instanceof SearchDestroyRules) return m.wins[team] / SND.win;
    // Escort: how far the payload has come, against the clock (the defenders' side).
    if (m instanceof EscortRules) return team === m.attacker ? m.progress / Math.max(1, m.length) : Math.min(1, m.timeLeft / ESCORT.start);
    // Last soldier standing: my kills (no target), and how many are still up.
    if (m instanceof LastStandRules) return team === this.myTeam ? 0 : m.aliveCount / Math.max(1, Object.keys(m.seen).length);
    if (m instanceof SoloRules) {
      const s = this.soloScores(m);
      return (team === this.myTeam ? s.mine : s.best) / m.target;
    }
    if (m instanceof PointsRules) return m.points[team] / m.target;
    const tk = m.tickets[team];
    if (tk === null) return 1;
    this.ticketPeak[team] = Math.max(this.ticketPeak[team], tk);
    return tk / this.ticketPeak[team];
  }

  /** The number beside the zone bar: domination points, tickets, or ∞ for a side without tickets. */
  private modeScore(team: Team): string {
    const m = this.zoneMode!.match;
    if (m instanceof SearchDestroyRules) return String(m.wins[team]);
    if (m instanceof EscortRules) return team === m.attacker ? `${Math.round((100 * m.progress) / Math.max(1, m.length))}%` : clockText(m.timeLeft);
    if (m instanceof LastStandRules) return String(team === this.myTeam ? m.scoreOf(this.myId) : m.aliveCount);
    if (m instanceof SoloRules) {
      const s = this.soloScores(m);
      return String(team === this.myTeam ? s.mine : s.best);
    }
    if (m instanceof PointsRules) return String(Math.floor(m.points[team]));
    const tk = m.tickets[team];
    return tk === null ? '∞' : String(tk);
  }

  /** "Tickets 312" / "Points 240" for the scoreboard. */
  private modeScoreLine(team: Team): string | null {
    const m = this.zoneMode!.match;
    if (m instanceof SoloRules) return null;
    if (m instanceof SearchDestroyRules) return `${t('snd.rounds')} ${m.wins[team]}`;
    if (m instanceof FleetRules) return `${t('fleet.points')} ${Math.floor(m.points[team])}%`;
    if (m instanceof PointsRules) return `${t('hud.points')} ${Math.floor(m.points[team])}`;
    const tk = m.tickets[team];
    return tk === null ? null : `${t('hud.tickets')} ${tk}`;
  }

  /** The mode line under the zone bar: target, attack timer, sector. */
  private modeStatus(): ZoneHud['status'] {
    const m = this.zoneMode!.match;
    const mode = t(`mode.${m.kind}`);
    const target = t('mode.target').replace('{n}', String(m instanceof PointsRules ? m.target : 0));
    if (m instanceof LastStandRules) {
      const out = this.player.alive && this.zoneMode!.stormDps(this.player.feet) > 0;
      const phase = m.phase === 'shrink' ? t('lms.shrinking') : m.next.r < m.circle.r - 0.5 || m.circle.r > 13 ? t('lms.nextShrink').replace('{t}', clockText(m.phaseLeft)) : t('lms.final');
      const text = `${mode} · ${t('lms.alive').replace('{n}', String(m.aliveCount))} · ${phase} · ${t('lms.kills').replace('{n}', String(m.scoreOf(this.myId)))}${out ? ` · ${t('lms.outside')}` : ''}`;
      return { text, tone: out ? 'enemy' : 'neutral', urgent: out || m.phase === 'shrink' };
    }
    if (m instanceof SoloRules) {
      const s = this.soloScores(m);
      const clock = t('mode.clock').replace('{t}', clockText(m.timeLeft));
      const place = t('mode.place').replace('{n}', String(s.place)).replace('{total}', String(s.total));
      const tone = s.place === 1 ? 'ally' : 'enemy';
      if (m instanceof GunGameRules) {
        const w = GunGameRules.weaponAt(s.mine);
        const gun = w ? WEAPONS[w].name : t('weapon.melee');
        const step = t('mode.step').replace('{n}', String(s.mine + 1)).replace('{total}', String(GUN_GAME_STEPS.length + 1));
        return { text: `${mode} · ${step} ${gun} · ${place} · ${clock}`, tone, urgent: !w };
      }
      const target = t('mode.killTarget').replace('{n}', String(m.target));
      return { text: `${mode} · ${place} · ${target} · ${clock}`, tone, urgent: m.timeLeft < 60 };
    }
    if (m instanceof EscortRules) {
      const ours = m.attacker === this.myTeam;
      const cp = t('escort.cp').replace('{n}', String(Math.min(m.passed + 1, m.checkpoints.length))).replace('{total}', String(m.checkpoints.length));
      if (m.setupLeft > 0) return { text: `${mode} · ${t('mode.setup')} ${clockText(m.setupLeft)} · ${cp}`, tone: 'neutral', urgent: false };
      const left = Math.max(0, (m.at[m.passed] ?? m.length) - m.progress);
      const state = t(m.moving ? 'escort.moving' : m.contested ? 'escort.contested' : 'escort.stopped');
      return {
        text: `${t(ours ? 'mode.attack' : 'mode.defend')} · ${cp} ${Math.round(left)} m · ${state} · ${t('mode.clock').replace('{t}', clockText(m.timeLeft))}`,
        tone: ours ? 'ally' : 'enemy',
        urgent: m.timeLeft < 60,
      };
    }
    if (m instanceof FortressRules && m.building) {
      return { text: `${mode} · ${t('fortress.build')} ${clockText(m.buildLeft)} · ${t('mode.target').replace('{n}', String(m.target))}`, tone: 'neutral', urgent: m.buildLeft < 15 };
    }
    if (m instanceof RushRules) {
      const ours = m.attacker === this.myTeam;
      const sector = t('mode.sector').replace('{n}', String(Math.min(m.active + 1, m.sectors.length))).replace('{total}', String(m.sectors.length));
      if (m.setupLeft > 0) return { text: `${mode} · ${t('mode.setup')} ${clockText(m.setupLeft)} · ${sector}`, tone: 'neutral', urgent: false };
      const armed = m.charges.filter((c) => c.state === 'armed');
      const fuse = armed.length ? ` · ${t('charge.armedLine').replace('{t}', clockText(Math.min(...armed.map((c) => c.fuse))))}` : '';
      return { text: `${mode} · ${t(ours ? 'mode.attack' : 'mode.defend')} · ${sector}${fuse}`, tone: ours ? 'ally' : 'enemy', urgent: armed.length > 0 };
    }
    if (m instanceof SearchDestroyRules) {
      const ours = m.attacker === this.myTeam;
      const round = t('snd.round').replace('{n}', String(m.round));
      const armed = m.charges.find((c) => c.state === 'armed');
      const clock =
        m.phase === 'pre' ? `${t('snd.pre')} ${clockText(m.phaseLeft)}`
        : m.phase === 'post' ? t('snd.next').replace('{t}', clockText(m.phaseLeft))
        : armed ? t('charge.armedLine').replace('{t}', clockText(armed.fuse))
        : t('mode.clock').replace('{t}', clockText(m.phaseLeft));
      return { text: `${mode} · ${round} · ${t(ours ? 'mode.attack' : 'mode.defend')} · ${clock}`, tone: ours ? 'ally' : 'enemy', urgent: !!armed || (m.phase === 'live' && m.phaseLeft < 30) };
    }
    if (m instanceof HardpointRules) {
      const moves = t('mode.hillMoves').replace('{z}', m.zoneId).replace('{t}', clockText(m.moveIn));
      const tone = m.holder ? (m.holder === this.myTeam ? 'ally' : 'enemy') : 'neutral';
      return { text: `${mode} · ${moves} · ${target} · ${t('mode.clock').replace('{t}', clockText(m.timeLeft))}`, tone, urgent: m.moveIn < 10 };
    }
    if (m instanceof FleetRules) {
      const us = this.myTeam;
      const text = t('fleet.status').replace('{us}', String(m.afloat[us])).replace('{them}', String(m.afloat[otherTeam(us)])).replace('{t}', clockText(m.timeLeft));
      return { text: `${mode} · ${text}`, tone: m.afloat[us] < m.afloat[otherTeam(us)] ? 'enemy' : 'neutral', urgent: m.timeLeft < 60 || m.afloat[us] <= 1 };
    }
    if (m instanceof PointsRules && Number.isFinite(m.timeLimit)) {
      return { text: `${mode} · ${target} · ${t('mode.clock').replace('{t}', clockText(m.timeLeft))}`, tone: 'neutral', urgent: m.timeLeft < 60 };
    }
    if (m instanceof PointsRules) return { text: `${mode} · ${target}`, tone: 'neutral', urgent: false };
    if (m instanceof FrontlineRules) {
      const clock = t('mode.clock').replace('{t}', clockText(m.clock));
      if (!m.attacker) return { text: `${mode} · ${t('mode.opening')} ${clockText(m.timeLeft)} · ${clock}`, tone: 'neutral', urgent: false };
      const ours = m.attacker === this.myTeam;
      return {
        text: `${t(ours ? 'mode.attack' : 'mode.defend')} ${clockText(m.timeLeft)} · ${clock}`,
        tone: ours ? 'ally' : 'enemy',
        urgent: m.timeLeft < 30,
      };
    }
    if (m instanceof ConquestRules) {
      const ours = m.attacker === this.myTeam;
      const sector = t('mode.sector').replace('{n}', String(Math.min(m.active + 1, m.sectors.length))).replace('{total}', String(m.sectors.length));
      if (m.setupLeft > 0) return { text: `${mode} · ${t('mode.setup')} ${clockText(m.setupLeft)} · ${sector}`, tone: 'neutral', urgent: false };
      return { text: `${mode} · ${t(ours ? 'mode.attack' : 'mode.defend')} · ${sector}`, tone: ours ? 'ally' : 'enemy', urgent: false };
    }
    return null;
  }

  /** The deploy screen's line: mode and score both sides. */
  private deployMatchLine(): string {
    const s = this.modeStatus();
    if (this.zoneMode?.match instanceof SoloRules) return s?.text ?? '';
    const score = `${t('hud.allies')} ${this.modeScore(this.myTeam)}  ·  ${this.modeScore(otherTeam(this.myTeam))} ${t('hud.enemies')}`;
    return s ? `${s.text}  ·  ${score}` : score;
  }

  /** Mode news on screen, and bots re-plan when the fight moves. */
  private onModeEvent(e: ModeEvent): void {
    const zm = this.zoneMode!;
    const ours = (team: Team) => team === this.myTeam;
    const m = zm.match;
    if (e.type === 'time') {
      const up = e.delta > 0;
      const text = t(up ? 'mode.timeUp' : 'mode.timeDown').replace('{n}', String(Math.abs(e.delta)));
      // Good news for whoever it helps.
      this.hud.notify(text, up === ours(e.attacker) ? 'ally' : 'enemy');
      return;
    }
    if (e.type === 'refill') {
      this.hud.notify(t('mode.refill').replace('{n}', String(e.tickets)), ours(e.team) ? 'ally' : 'enemy');
      return;
    }
    if (e.type === 'loot') {
      const name = WEAPONS[e.weapon as keyof typeof WEAPONS]?.name ?? e.weapon;
      if (e.by === this.myId) {
        if (this.player.alive && this.deployed) {
          armLoot(this.weapons, e.weapon);
          this.me.medkits = Math.max(this.me.medkits, MEDKIT.carried);
        }
        this.hud.notify(t('lms.loot').replace('{w}', name), 'ally');
        this.audio.resupply();
      } else {
        const bot = this.bots?.bots.find((b) => b.id === e.by);
        if (bot) this.bots!.rearm(bot);
      }
      return;
    }
    if (e.type === 'shrink') {
      this.audio.zoneCue(false);
      this.bots?.replan('blue');
      this.bots?.replan('red');
      return;
    }
    if (e.type === 'level') {
      if (!(m instanceof GunGameRules)) return;
      const kit = gunGameKit(e.level);
      const name = kit.empty ? t('weapon.melee') : WEAPONS[kit.weapon].name;
      if (e.id === this.myId) {
        if (this.player.alive && this.deployed) armForLevel(this.weapons, e.level);
        this.hud.notify(kit.empty ? t('mode.lastStep') : t(e.up ? 'mode.nextGun' : 'mode.demoted').replace('{w}', name), e.up ? 'ally' : 'enemy');
        if (e.up) this.audio.zoneCue(true);
      } else {
        const bot = this.bots?.bots.find((b) => b.id === e.id);
        if (bot) this.bots!.rearm(bot);
      }
      return;
    }
    if (e.type === 'charge') {
      const c = zm.charges?.charges.find((x) => x.id === e.id);
      this.audio.zoneCue(ours(e.team));
      // Solo: the charge goes off here (on the game server the server's blast and its boom come instead).
      if (e.state === 'blown' && c && !this.net) this.blast('charge', new THREE.Vector3(c.x, c.y + 0.4, c.z), { id: -1, name: t('charge.name'), team: e.team }, t('charge.name'));
      this.bots?.replan('blue');
      this.bots?.replan('red');
      return;
    }
    if (e.type === 'roundEnd') {
      this.audio.zoneCue(ours(e.winner));
      return;
    }
    if (e.type === 'round') {
      // Everyone back for the new round (on the game server the server moves people's soldiers and says so).
      if (!this.net) this.newRound();
      else if (!this.deployed || !this.player.alive) this.respawnTimer = 0;
      return;
    }
    if (e.type === 'tag') {
      // Points on the scoreboard for whoever picked it up; the popup is the player's own.
      this.scores.award(e.by, e.confirmed ? 50 : 30);
      if (e.by === this.myId) this.hud.scorePopup(e.confirmed ? 50 : 30, t(e.confirmed ? 'points.confirm' : 'points.deny'));
      return;
    }
    if (e.type === 'hill') {
      this.audio.zoneCue(true);
      if (this.spawnKey === `zone:${e.zone}`) this.spawnKey = 'base';
      this.bots?.replan('blue');
      this.bots?.replan('red');
      return;
    }
    if (e.type === 'checkpoint') {
      const att = m instanceof EscortRules && ours(m.attacker);
      this.audio.zoneCue(att);
      if (this.spawnKey.startsWith('zone:') && !zm.match.spawnZones(this.myTeam)?.includes(this.spawnKey.slice(5))) this.spawnKey = 'base';
      this.bots?.replan('blue');
      this.bots?.replan('red');
      return;
    }
    if (e.type === 'built') {
      this.audio.zoneCue(true);
      this.bots?.replan('blue');
      this.bots?.replan('red');
      return;
    }
    if (e.type === 'attack' && (m instanceof ConquestRules || m instanceof RushRules || m instanceof EscortRules) && e.reason === 'opening') {
      this.audio.zoneCue(ours(e.attacker));
    } else if (e.type === 'sector') {
      if (m instanceof ConquestRules || m instanceof RushRules) {
        this.audio.zoneCue(ours(e.team));
      }
    } else if (m instanceof FrontlineRules && e.type === 'attack') {
      // A new attack: say who attacks and why.
      const weAttack = ours(e.attacker);
      this.audio.zoneCue(weAttack === (e.reason === 'held'));
    }
    if (this.spawnKey.startsWith('zone:') && !zm.freeSpawns && zm.zone(this.spawnKey.slice(5))?.owner !== this.myTeam) this.spawnKey = 'base';
    this.bots?.replan('blue');
    this.bots?.replan('red');
  }

  /** The result screen's second line. */
  private resultLine(): string {
    const m = this.zoneMode!.match;
    const us = this.myTeam;
    const them = otherTeam(us);
    const reason = t(`match.reason.${m.reason ?? 'tickets'}`);
    if (m instanceof SearchDestroyRules) return `${reason} · ${t('snd.rounds')} ${m.wins[us]} : ${m.wins[them]}`;
    if (m instanceof EscortRules) return `${reason} · ${t('escort.cp').replace('{n}', String(m.passed)).replace('{total}', String(m.checkpoints.length))} · ${Math.round((100 * m.progress) / Math.max(1, m.length))}%`;
    if (m instanceof SoloRules) {
      const s = this.soloScores(m);
      const who = m.winnerId === this.myId ? playerName(t('feed.you')) : (this.scores.get(m.winnerId ?? -1)?.name ?? '?');
      return `${reason} · ${t('match.winnerIs').replace('{name}', who)} · ${t('mode.place').replace('{n}', String(s.place)).replace('{total}', String(s.total))}`;
    }
    if (m instanceof FleetRules) return `${reason} · ${t('fleet.points')} ${Math.floor(m.points[us])}% : ${Math.floor(m.points[them])}%`;
    if (m instanceof PointsRules) return `${reason} · ${t('hud.points')} ${Math.floor(m.points[us])} : ${Math.floor(m.points[them])}`;
    const tk = (team: Team) => (m.tickets[team] === null ? '∞' : String(m.tickets[team]));
    return `${reason} · ${t('match.tickets')} ${tk(us)} : ${tk(them)}`;
  }

  private endMatch(winner: Team, winnerId?: number): void {
    if (this.matchOver) return;
    this.matchOver = true;
    this.touch?.setVisible(false);
    // Free-for-all: whoever came first (the server's copy of the rules says who on a client).
    const solo = this.zoneMode?.match instanceof SoloRules;
    const won = solo ? (winnerId ?? this.zoneMode?.match.winnerId) === this.myId : winner === this.myTeam;
    this.briefDirector?.end(won);
    // Let the moment land, then stop and show the result.
    window.setTimeout(() => {
      this.running = false;
      if (document.pointerLockElement) document.exitPointerLock();
      const title = t(won ? 'match.victory' : 'match.defeat');
      const line = this.resultLine();
      this.overlay.show(title, line, won ? 'win' : 'loss');
      // Final standings under the result.
      let board: HTMLElement | null = null;
      if (this.bots || this.net) {
        this.fillScoreboard();
        this.scoreboard.setFinal(true);
        this.scoreboard.setVisible(true);
        board = this.scoreboard.root;
      }
      this.overlay.setResult({
        won,
        context: this.zoneMode ? `${this.mapName} · ${t(`mode.${this.zoneMode.kind}`)}` : this.mapName,
        title,
        line,
        ...this.resultStats(),
        board,
        actions: this.net
          ? [
              { label: t('mp.backToRoom'), onClick: () => location.reload() },
              { label: t('lobby.back'), onClick: () => this.quit() },
            ]
          : [
              { label: t('lobby.again'), onClick: () => location.reload() },
              { label: t('lobby.back'), onClick: toLobby },
            ],
      });
    }, 2500);
  }

  /** The result screen's own numbers: the player's stats, place and the top scorer. */
  private resultStats(): { stats: { label: string; value: string }[]; place?: string; mvp?: string } {
    const me = this.scores.get(this.myId);
    if (!me) return { stats: [] };
    const m = this.zoneMode?.match;
    const solo = m instanceof SoloRules;
    const stats = [
      { label: t('result.score'), value: me.score.toLocaleString() },
      { label: t('result.kills'), value: String(me.kills) },
      { label: t('result.deaths'), value: String(me.deaths) },
    ];
    // Counted only where the match is played (a server's table doesn't carry them).
    if (!this.net) {
      stats.push({ label: t('result.headshots'), value: String(me.headshots ?? 0) });
      if (!solo) stats.push({ label: t('result.revives'), value: String(me.revives ?? 0) });
    }
    const zones = !!this.zoneMode?.zones.some((z) => !z.hidden) && !solo;
    if (zones) stats.push({ label: t('result.captures'), value: String(me.captures) });
    const all = this.scores.table(null);
    let place: string | undefined;
    if (solo) {
      const s = this.soloScores(m);
      place = t('mode.place').replace('{n}', String(s.place)).replace('{total}', String(s.total));
    } else {
      const side = this.scores.table(this.myTeam);
      const at = side.findIndex((r) => r.id === this.myId);
      if (at >= 0 && side.length > 1) place = t('result.place').replace('{n}', String(at + 1)).replace('{total}', String(side.length));
    }
    const top = all[0];
    const mvp = top && all.length > 1 ? (top.id === this.myId ? playerName(t('feed.you')) : top.name) : undefined;
    return { stats, place, mvp };
  }

  // ---------------------------------------------------------------------------
  // A match on the game server

  /** Out of the match to the main menu (the room is left first, so the seat isn't kept). */
  private quit(): void {
    if (this.net) {
      this.net.link.send({ t: 'leave' });
      this.net.link.close();
    }
    toLobby();
  }

  /** Others' models, the match connection, the deploy screen and the server's news. */
  private async setupNet(map: MapDef, terrain: Terrain, built: { windows: Parameters<BotManager['setTactical']>[0]; footprints: Parameters<BotManager['setTactical']>[1] }, water: WaterMap | null): Promise<void> {
    const opts = this.options.net!;
    await this.loadStep(0.72, 'load.soldiers');
    await SoldierModel.prewarmSteps(['blue', 'red'], BOT_WEAPONS.map((id) => WEAPONS[id]), () => this.loadStep(0.72, 'load.soldiers'));
    const r = this.renderer;
    const net = new NetMatch(opts.link, opts.start, this.me, { scene: r.scene, physics: this.physics, registry: this.registry, audio: this.audio, effects: this.effects, camera: r.camera });
    this.net = net;
    net.onEvents = (ev) => this.onNetEvents(ev);
    net.onRoster = () => this.netSquads(net);
    this.netSquads(net);
    // The room's chat (owner, 2026-10-14): Enter for everyone, Y for one's side (bindable).
    const link = opts.link;
    this.chat = new ChatPanel({
      store: chatOf(link),
      kind: 'hud',
      send: (text, team) => {
        // The room's owner: "/채금 name" takes someone's chat away, "/채금해제 name" gives it back.
        const cmd = /^\/(채금해제|채금|unmute|mute)\s+(.+)$/i.exec(text.trim());
        if (cmd) link.send({ t: 'mute', name: cmd[2]!.trim(), on: !/해제|unmute/i.test(cmd[1]!) });
        else link.send({ t: 'chat', text, team });
      },
      teamOk: () => !MATCH.ffa,
      myTeam: () => (MATCH.ffa ? null : this.myTeam),
      canOpen: () => this.running && !this.overlay.visible && !this.matchOver,
      touch: !!this.touch,
    });
    this.hud.root.parentElement?.appendChild(this.chat.root);
    net.onBoom = (e) => this.netBoom(e.type, new THREE.Vector3(...e.pos));
    net.onState = (m) => this.onNetState(m);
    // Vehicles (zone matches): copies of the server's, in a world laid out the same way (pads, tank spots, limits).
    if ((map.zones?.length ?? 0) > 0) {
      this.vehicles = vehicleWorldFor(this.physics, this.registry, { destroyed: () => {}, roadkill: () => {} }, map, opts.start.size ?? 24, water);
      this.vehicles.authority = false;
      r.scene.add(this.vehicles.group);
      net.vehicles = this.vehicles;
      net.onVehicle = (v) => {
        const p = this.pendingSeat;
        if (p && p.v === v.id) {
          this.pendingSeat = null;
          this.netBoard(v, p.seat);
        }
      };
    }
    net.onClosed = () => {
      if (this.matchOver) return;
      this.running = false;
      if (document.pointerLockElement) document.exitPointerLock();
      this.overlay.show(t('mp.lost'), t('mp.lostSub'), 'info');
      this.overlay.setActions([
        { label: t('mp.reconnect'), primary: true, onClick: () => location.reload() },
        { label: t('lobby.back'), onClick: toLobby },
      ]);
    };
    net.onRoomBack = () => {
      // Over with a winner: the result screen is already up. Ended by the room's owner: say so.
      if (this.matchOver) return;
      this.matchOver = true;
      this.running = false;
      this.touch?.setVisible(false);
      this.deployScreen?.hide();
      if (document.pointerLockElement) document.exitPointerLock();
      this.overlay.show(t('mp.ended'), t('mp.endedSub'), 'info');
      this.overlay.setActions([
        { label: t('mp.backToRoom'), primary: true, onClick: () => location.reload() },
        { label: t('lobby.back'), onClick: () => this.quit() },
      ]);
    };
    await this.setupNetBots(net, map, terrain, built, water);
    for (const s of opts.start.roster) this.scores.add(s.id, s.name, s.team);
    this.deployFlow = true;
    this.deployed = false;
    this.playerBoxes.setEnabled(false);
    this.deployScreen = new DeployScreen(
      this.container,
      this.mapImage ?? paintMap(map, terrain.boundary),
      (key) => (this.spawnKey = key),
      () => this.deploy(),
      () => this.pause(),
    );
    this.loadoutPanel = new LoadoutPanel(this.deployScreen.sideTop, this.deployScreen.mapBox, this.loadouts, () => {});
    // Reloaded mid-match: the soldier is still out there.
    const life = opts.start.life;
    if (life) this.netSpawned({ k: 'spawn', id: this.myId, ...life });
  }

  /** Bots this browser runs for the game server (desktops, rooms with bots): see `BotManager.adopt`. */
  private netBots: BotManager | null = null;
  /** What those bots did since the last input frame (the server does it for real). */
  private readonly netBotEvents: NetBotEvent[] = [];

  /**
   * A desktop in a room with bots runs some of them (its squad's) for the
   * server: they think and move here as in solo play against everyone this
   * browser draws, and their place, rounds, throws, revives and medkits go to
   * the server, which judges them (`MatchRoom.applyBots`).
   */
  private async setupNetBots(net: NetMatch, map: MapDef, terrain: Terrain, built: Parameters<Game['setupNet']>[2], water: WaterMap | null): Promise<void> {
    const start = net.start;
    if (!this.nav) return;
    const bots = new BotManager(this.renderer.scene, this.physics, this.nav, this.registry, this.impacts, this.bus, this.audio, this.effects, () => this.netHumans(net), map.spawns, {
      allies: 0,
      enemies: 0,
      difficulty: start.difficulty ?? 'normal',
      capacity: 12,
    });
    bots.setTactical(built.windows, built.footprints);
    bots.setTactics(await loadTactics(this.nav, this.physics), map.world.size);
    if (map.trees) bots.setForest(map.trees, map.world.size, (x, z) => terrain.heightAt(x, z), map.world.flora);
    if (water) bots.setWater(water);
    bots.viewers = () => [this.player.feet];
    bots.zoneOwner = (id, team) => this.zoneMode?.stationOwner(id, team) ?? null;
    bots.hooks = {
      objectives: (team) => this.zoneMode?.objectives(team) ?? [],
      // Down or dead they go back to the server, which respawns them.
      spawnAt: (bot) => ({ pos: bot.feet.clone(), yaw: bot.yaw }),
    };
    const ev = this.netBotEvents;
    const v3 = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];
    bots.grenades = {
      launch: (type, origin, vel, owner) => ev.push({ k: 'throw', id: owner.id, type, origin: v3(origin), vel: v3(vel) }),
      *frags() {},
    };
    bots.remote = {
      shot: (bot, dir) => ev.push({ k: 'shot', id: bot.id, dir: v3(dir) }),
      revive: (bot, target) => ev.push({ k: 'revive', id: bot.id, target: target.id }),
      medkit: (bot) => ev.push({ k: 'medkit', id: bot.id }),
    };
    this.netBots = bots;
    net.botFrame = () => {
      const list = bots.bots;
      if (!list.length && !ev.length) return null;
      const states = list.filter((b) => b.alive).map((b) => ({ id: b.id, x: b.feet.x, y: b.feet.y, z: b.feet.z, yaw: b.yaw, aimYaw: b.aimYaw, aimPitch: b.aimPitch, crouch: b.crouching }));
      return { view: net.viewTick(), states, events: ev.splice(0) };
    };
    net.onOwned = (id, flags, health) => {
      const b = bots.bots.find((x) => x.id === id);
      if (!b) return;
      // Down or dead on the server: it runs the bot again (it says so too).
      if (!(flags & SF.alive) || flags & SF.downed) this.dropNetBot(id);
      else b.health.value = health;
    };
  }

  /** Everyone the bots this browser runs can see or help: this player and everyone drawn here. */
  private *netHumans(net: NetMatch): Iterable<Combatant> {
    if (this.deployed) yield this.playerCombatant;
    yield* net.combatants();
  }

  private dropNetBot(id: number): void {
    this.netBots?.drop(id);
    this.net?.owned.delete(id);
    this.netBotSquads();
  }

  /** The bots this browser runs, in their squads as the server has them (they pick their own objectives). */
  private netBotSquads(): void {
    const bots = this.netBots;
    const net = this.net;
    if (!bots || !net) return;
    const bySquad = new Map<number, number[]>();
    for (const b of bots.bots) {
      const sq = net.roster.get(b.id)?.squad ?? 0;
      bySquad.set(sq, [...(bySquad.get(sq) ?? []), b.id]);
    }
    bots.setSquads([...bySquad.entries()].map(([index, botIds]) => ({ index, botIds, leader: null })));
  }

  /** The match's news from the server. */
  private onNetEvents(list: MatchEvent[]): void {
    const me = this.me;
    const you = (id: number | undefined, name: string) => (id === this.myId ? 'You' : name);
    for (const e of list) {
      switch (e.k) {
        case 'kill':
          this.hud.addKill({
            attacker: you(e.attackerId, e.attacker),
            victim: you(e.victimId, e.victim),
            weapon: e.weapon,
            headshot: e.headshot,
            attackerTeam: e.attackerTeam,
            victimTeam: e.victimTeam,
          });
          break;
        case 'hit':
          this.hud.showHit(e.head, e.killed, e.dmg);
          this.audio.hit(e.head, e.killed);
          break;
        case 'hurt':
          me.hooks.hurt?.(e.amount, e.from ? new THREE.Vector3(...e.from) : null, e.cause);
          break;
        case 'spawn':
          if (e.id === this.myId) this.netSpawned(e);
          break;
        case 'down':
          if (e.id === this.myId) me.netDown(e.cause, e.by);
          break;
        case 'died':
          if (e.id === this.myId && (me.downed || me.alive)) {
            me.die('bullet');
            this.respawnTimer = e.respawn < 0 ? Infinity : e.respawn;
          }
          break;
        case 'revived':
          if (e.id === this.myId) me.revive(e.by, me.player.health.value || 50);
          else if (e.byId === this.myId) {
            this.hud.notify(`${t('notify.revivedMate')} — ${this.net?.nameOf(e.id) ?? ''}`, 'ally');
            this.audio.revived();
          }
          break;
        case 'zone':
          this.bus.emit(e.type === 'captured' ? 'zone:captured' : 'zone:neutralized', { zone: e.zone, team: e.team });
          break;
        case 'mode':
          this.bus.emit('mode:event', e.e as ModeEvent);
          break;
        case 'points':
          this.hud.scorePopup(e.points, t(`points.${e.reason}` as MessageKey));
          break;
        case 'callin': {
          const kind = e.kind as SupportId;
          const at = new THREE.Vector3(...e.pos);
          const ours = e.owner.team === this.myTeam;
          // Planes and crates are drawn here as the server's go; barrages are its booms, here only the beam.
          if (kind === 'recon' || kind === 'supply') this.support.request(kind, at, e.owner, Infinity, ours, true);
          else {
            this.support.account(kind, e.owner);
            if (ours && kind !== 'rocketTank') this.support.marker(kind, at);
          }
          if (ours) this.hud.notify(`${t('support.called').replace('{name}', t(`support.${kind}` as MessageKey))} — ${e.owner.id === this.myId ? playerName(t('feed.you')) : e.owner.name}`, 'ally');
          break;
        }
        case 'incoming':
          this.audio.incoming(new THREE.Vector3(...e.pos));
          break;
        case 'spotted':
          for (const id of e.ids) this.netSpotted.set(id, this.elapsed + e.sec);
          break;
        case 'given':
          if (e.to === this.myId) {
            // The server already did it; this browser's copy follows.
            if (e.kind === 'medkit') me.medkits = MEDKIT.carried;
            else if (e.kind === 'crate') {
              restockAmmo(me);
              if (me.cls !== 'medic') me.medkits = MEDKIT.carried;
            } else me.weapons.refillReserve();
            if (e.kind !== 'crate') this.hud.notify(`${t(e.kind === 'medkit' ? 'notify.gotMedkit' : 'notify.gotAmmo')} — ${this.net?.nameOf(e.by) ?? ''}`, 'ally');
          } else if (e.kind !== 'crate') this.hud.notify(`${t(e.kind === 'medkit' ? 'act.giveMedkit' : 'act.giveAmmo')} → ${this.net?.nameOf(e.to) ?? ''}`, 'ally');
          this.audio.resupply();
          break;
        case 'seat':
          this.netSeat(e);
          break;
        case 'adopt':
          for (const spec of e.bots) {
            if (!this.netBots || !this.net) break;
            this.netBots.drop(spec.id);
            this.netBots.adopt(spec as AdoptSpec);
            this.net.owned.add(spec.id);
          }
          this.netBotSquads();
          break;
        case 'release':
          for (const id of e.ids) this.dropNetBot(id);
          break;
        case 'rocketTank':
          this.hud.notify(t('support.rocketArrived').replace('{zone}', e.zone).replace('{who}', e.id === this.myId ? playerName(t('feed.you')) : e.who), 'ally');
          break;
        case 'end':
          this.bus.emit('match:ended', { winner: e.winner, winnerId: e.winnerId });
          break;
      }
    }
  }

  /**
   * Squads as the server formed them (fours in join order, the first leads):
   * this browser's soldier and everyone else as it draws them.
   */
  private netSquads(net: NetMatch): void {
    const bySquad = new Map<string, SquadMember[]>();
    for (const info of net.roster.values()) {
      const key = `${info.team}:${info.squad}`;
      let list = bySquad.get(key);
      if (!list) bySquad.set(key, (list = []));
      if (info.id === this.myId) {
        list.push(this.playerCombatant);
        continue;
      }
      const remote = () => net.remote(info.id);
      const far = new THREE.Vector3(0, -1000, 0);
      list.push({
        id: info.id,
        name: info.name,
        team: info.team,
        get alive() {
          return remote()?.alive ?? false;
        },
        get downed() {
          return remote()?.downed ?? false;
        },
        get feet() {
          return remote()?.feet ?? far;
        },
        get yaw() {
          return remote()?.yaw ?? 0;
        },
        // The server knows who is fighting; it turns a spawn on them down.
        inCombat: () => false,
      });
    }
    this.squads = [...bySquad.entries()].map(([key, members]) => {
      const [team, index] = key.split(':');
      return new Squad(Number(index), team as Team, squadName(Number(index)), members);
    });
    this.playerSquad = this.squads.find((s) => s.has(this.myId)) ?? null;
  }

  /** On the field where the server put this browser's soldier. */
  private netSpawned(e: Extract<MatchEvent, { k: 'spawn' }>): void {
    this.netDeploying = false;
    // A new life starts on foot (a vehicle key's seat comes right after).
    if (this.ride && this.net?.drive === this.ride.v) {
      this.ride.v.setRemote(true);
      this.net.drive = null;
    }
    this.ride = null;
    this.pendingSeat = null;
    const raw = (typeof e.kit === 'object' && e.kit ? e.kit : {}) as Partial<Loadout>;
    const kit = sanitizeLoadout({ ...raw, cls: raw.cls ?? this.loadouts.current.cls });
    this.deployed = true;
    this.deployScreen?.hide();
    this.startLife({ pos: new THREE.Vector3(...e.pos), yaw: e.yaw }, kit, 'base');
    this.me.weapons.rand = seeded(e.seed);
    this.net?.respawned();
  }

  /** The zones, the mode's rules and the score table as the server has them. */
  private onNetState(m: Extract<ServerMsg, { t: 'mstate' }>): void {
    const zm = this.zoneMode;
    if (zm && Array.isArray(m.zones)) {
      for (const z of m.zones as { id?: string }[]) {
        const mine = z.id ? zm.zone(z.id) : undefined;
        if (mine) Object.assign(mine, z);
      }
    }
    if (zm && m.rules && typeof m.rules === 'object') assignDeep(zm.match as unknown as Record<string, unknown>, m.rules as Record<string, unknown>);
    this.scores.load(m.scores);
    const fort = this.fort;
    if (fort && m.fort) {
      const slots = new Map(m.fort.slots.map(([id, work, built]) => [id, { work, built: built === 1 }]));
      for (const s of fort.slots) {
        const st = slots.get(s.id);
        fort.apply(s, st?.work ?? 0, st?.built ?? false);
      }
      const uses = new Map(m.fort.stations);
      for (const s of fort.stations) s.uses = uses.get(s.id) ?? STATION.uses;
    }
    this.netBeacons = m.beacons ?? [];
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
    this.engines?.dispose();
    cancelAnimationFrame(this.rafId);
    for (const s of this.sources) s.dispose();
    this.bus.clear();
    this.renderer.dispose();
    this.physics.dispose();
    this.container.replaceChildren();
  }
}

/**
 * Bots and jets: a side with a free jet slot checks every `every` s for a bot
 * near its base (`nearBase` m) to send up, from `first` s into the match; a
 * respawning bot takes the slot with chance `respawn`. On the player's side
 * bots leave a freed slot alone for `playerFirst` s.
 */
/** `cooldown`: a lost jet's slot waits this long before a bot takes it (two jets duelling were shot down and back up every few seconds). */
const BOT_JETS = { first: 12, every: 4, nearBase: 90, respawn: 0.6, playerFirst: 15, cooldown: 40 };
/** Copies plain data into an object of the same shape (the mode's rules as the server sent them). */
function assignDeep(into: Record<string, unknown>, from: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(from)) {
    const cur = into[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) assignDeep(cur as Record<string, unknown>, v as Record<string, unknown>);
    else into[k] = v;
  }
}

/** Back to the lobby: the page without a map in its address. */
function toLobby(): void {
  forgetPlay();
  location.href = location.pathname;
}

/** m:ss for the mode timers. */
function clockText(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Seconds a jet that just came in can't be locked by missiles. */
const JET_LOCK_GRACE = 10;
/**
 * First-person vehicle views: the aim button zooms a cannon sight `sight`x
 * and a machine gun's `mg`x; open seats and cockpits widen the view up to
 * `speedFov` degrees at speed.
 */
const RIDE_ZOOM = { sight: 3, mg: 1.6, speedFov: 6 };
/** How far the look may run ahead of a slow gun in its sight (rad). */
const LOOK_LEAD = { yaw: 0.5, pitch: 0.2 };
/** The third-person orbit camera aboard: its pitch range (rad) and how high over the hull it looks from (m). */
const ORBIT = { min: -0.85, max: 0.45, height: 1.6 };
/**
 * Third person aboard a warship (2026-10-18, owner asked how C looks there):
 * the camera orbits the whole ship, not the station, from this far (m, plus
 * a share of the hull's length) and over the hull's middle this high, never
 * closer than `overSea` m over the waves.
 */
const SHIP_CAM = { dist: 30, distPerLength: 0.55, height: 6, heightPerLength: 0.035, overSea: 2.5 };

/** The crosshair names who it is on within this distance (m). */
const AIM_ID_RANGE = 150;
/** Player jet cannon: fires at the crosshair within this angle of the nose (rad), onto an enemy aircraft this close to the crosshair. */
const JET_GUN = { cone: 0.21, assist: 0.031 };
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

