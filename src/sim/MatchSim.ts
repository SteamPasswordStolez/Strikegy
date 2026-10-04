import * as THREE from 'three';
import { HitboxRegistry } from '@/combat/Hitboxes';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { defaultLoadout, loadoutWeapons, type Loadout } from '@/data/classes';
import { consumePulses, createInputState, type InputState } from '@/input/InputState';
import { ZoneMode } from '@/modes/ZoneMode';
import type { ModeKind } from '@/modes/matchRules';
import { ScoreTracker } from '@/modes/scoreTracker';
import { Layer, PhysicsWorld } from '@/physics/PhysicsWorld';
import { MOVE } from '@/player/movement';
import { SurfaceRegistry } from '@/physics/surfaces';
import type { MapDef, Team } from '@/world/mapTypes';
import { Soldier } from './Soldier';
import { buildWorld, type SimWorld } from './world';

const DEG = Math.PI / 180;
/** The game server's fixed step (s); the browser runs the same. */
export const SIM_DT = 1 / 60;

export interface MatchOptions {
  mode?: ModeKind;
  /** Tickets for every side that has them instead of the per-soldier numbers. */
  tickets?: number;
  /** Soldiers a side (Frontline / Conquest tickets scale with it). */
  teamSize?: { blue: number; red: number };
}

/** One soldier's controls for a step: buttons and stick, and where they look (absolute). */
export interface SoldierInput {
  state: InputState;
  yaw: number;
  pitch: number;
}

/**
 * A match without a view, as the game server runs it: the map world, the
 * soldiers people play, the zone mode and the score table. Each step takes
 * every soldier's input, moves and fires for them, runs the zone rules and
 * the physics. Bots, vehicles, gadgets, fortifications and call-ins come in
 * later steps (they still live in `Game`).
 */
export class MatchSim {
  readonly bus = new EventBus<GameEvents>();
  readonly registry = new HitboxRegistry();
  readonly scores = new ScoreTracker();
  readonly soldiers = new Map<number, Soldier>();
  readonly zoneMode: ZoneMode | null;
  /** Sim clock (s). */
  time = 0;
  winner: Team | null = null;
  private readonly idle = createInputState();

  private constructor(
    readonly physics: PhysicsWorld,
    readonly impacts: SurfaceRegistry,
    readonly world: SimWorld,
    opts: MatchOptions,
  ) {
    physics.timestep = SIM_DT;
    const map = world.map;
    this.zoneMode = (map.zones?.length ?? 0) > 0 ? new ZoneMode(map, this.bus, { mode: opts.mode, tickets: opts.tickets, teamSize: opts.teamSize }) : null;
    this.wire();
    // Colliders into the broadphase before the first query.
    physics.step();
  }

  /** Builds the world for `map` (a parsed map; it is changed: things move onto the terrain). */
  static async create(map: MapDef, opts: MatchOptions = {}): Promise<MatchSim> {
    const physics = await PhysicsWorld.create();
    const impacts = new SurfaceRegistry();
    return new MatchSim(physics, impacts, buildWorld(map, physics, impacts), opts);
  }

  private wire(): void {
    const bus = this.bus;
    const zm = this.zoneMode;
    bus.on('combat:kill', (e) => this.scores.kill(e.attackerId, e.victimId, e.headshot));
    bus.on('combatant:died', (e) => {
      this.scores.death(e.id);
      zm?.onDeath(e.team);
    });
    bus.on('match:ended', (e) => (this.winner = e.winner));
    if (!zm) return;
    // Credit for zones goes to the side's soldiers standing in the zone at that moment.
    const inZone = (zone: string, team: Team) => {
      const ids: number[] = [];
      for (const s of this.soldiers.values()) if (s.combatant.alive && s.team === team && zm.zoneAt(s.player.feet)?.id === zone) ids.push(s.id);
      return ids;
    };
    bus.on('zone:captured', (e) => this.scores.objective(inZone(e.zone, e.team), 'capture'));
    bus.on('zone:neutralized', (e) => this.scores.objective(inZone(e.zone, e.team === 'blue' ? 'red' : 'blue'), 'neutralize'));
  }

  // ---------------------------------------------------------------------------
  // Soldiers

  /** A person joins: their soldier waits off the field until it deploys. */
  addSoldier(id: number, team: Team, name: string, kit: Loadout = defaultLoadout('assault')): Soldier {
    const base = this.base(team);
    const s = new Soldier({
      id,
      team,
      name: () => name,
      local: false,
      physics: this.physics,
      bus: this.bus,
      impacts: this.impacts,
      registry: this.registry,
      spawn: base.pos,
      yaw: base.yaw,
      loadout: loadoutWeapons(kit),
      now: () => this.time,
      combatClock: () => this.time,
    });
    s.cls = kit.cls;
    s.grenades.reset(kit.grenade);
    s.player.water = this.world.water;
    s.deployFlow = true;
    s.deployed = false;
    s.boxes.setEnabled(false);
    this.soldiers.set(id, s);
    this.scores.add(id, name, team);
    return s;
  }

  /** Someone left: their soldier and its bodies go. */
  removeSoldier(id: number): void {
    const s = this.soldiers.get(id);
    if (!s) return;
    s.dispose();
    this.soldiers.delete(id);
  }

  /**
   * Deploys a soldier waiting off the field at `key` ('base' or 'zone:<id>')
   * with `kit`; false when it can't yet (still on the respawn wait, or on the field).
   */
  deploy(id: number, key = 'base', kit: Loadout = defaultLoadout('assault')): boolean {
    const s = this.soldiers.get(id);
    if (!s || s.deployed || s.respawnTimer > 0 || this.winner) return false;
    const [kind, zone] = key.split(':');
    const at = this.zoneMode ? this.zoneMode.spawnPoint(s.team, kind === 'zone' ? zone! : 'base', null) : this.base(s.team);
    s.deployed = true;
    s.spawn(this.clearSpot(at.pos, s), at.yaw, kit);
    return true;
  }

  /**
   * A free spot within a few metres of `at`: ground under it, no wall in it,
   * nobody already standing there. Soldiers stacked on one spawn point push
   * each other's capsules every step (the server has no navmesh to spread them
   * yet).
   */
  private clearSpot(at: THREE.Vector3, self: Soldier): THREE.Vector3 {
    const half = { x: MOVE.radius, y: MOVE.standHeight / 2 - 0.05, z: MOVE.radius };
    const gap = MOVE.radius * 2.4;
    for (let i = 0; i < 16; i++) {
      const r = i === 0 ? 0 : 0.8 + Math.random() * 3;
      const a = Math.random() * Math.PI * 2;
      const x = at.x + Math.cos(a) * r;
      const z = at.z + Math.sin(a) * r;
      const hit = this.physics.raycast({ x, y: at.y + 1.5, z }, { x: 0, y: -1, z: 0 }, 4, Layer.WORLD);
      if (!hit) continue;
      const feet = new THREE.Vector3(x, hit.point.y + 0.02, z);
      if (this.physics.overlapsBox({ x, y: feet.y + MOVE.standHeight / 2 + 0.05, z }, half, 0, Layer.WORLD)) continue;
      let taken = false;
      for (const o of this.soldiers.values()) if (o !== self && o.deployed && o.player.feet.distanceToSquared(feet) < gap * gap) taken = true;
      if (!taken) return feet;
    }
    return at.clone();
  }

  /** A spot at the side's base (spawn points of the map). */
  private base(team: Team): { pos: THREE.Vector3; yaw: number } {
    const list = this.world.map.spawns.filter((sp) => sp.team === team || (team === 'blue' && sp.team === 'player'));
    const sp = list[Math.floor(Math.random() * list.length)] ?? this.world.map.spawns[0]!;
    return { pos: new THREE.Vector3(...sp.pos), yaw: sp.yaw * DEG };
  }

  // ---------------------------------------------------------------------------

  /** One fixed step: every soldier with its input (none: standing still), the zone rules, the physics. */
  step(inputs: (id: number) => SoldierInput | null, dt = SIM_DT): void {
    this.time += dt;
    for (const s of this.soldiers.values()) {
      const given = inputs(s.id);
      const input = given?.state ?? this.idle;
      if (given) {
        s.player.yaw = given.yaw;
        s.player.pitch = given.pitch;
      }
      // A click released before this step still counts as one trigger pull.
      if (input.firePressed) input.fire = true;
      if (s.alive && s.deployed) {
        if (input.medkit) s.useMedkit();
        s.stepMedkit(dt);
        s.stepOnFoot(dt, input, s.medkitUse > 0);
      } else if (s.downed) s.stepDowned(dt, input.jumpHeld);
      else s.respawnTimer -= dt;
      consumePulses(input);
    }
    for (const s of this.soldiers.values()) s.syncBoxes();
    this.zoneMode?.step(dt, [...this.soldiers.values()].map((s) => s.combatant));
    this.physics.step();
  }

  dispose(): void {
    this.physics.dispose();
  }
}
