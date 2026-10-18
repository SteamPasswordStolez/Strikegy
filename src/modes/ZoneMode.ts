import * as THREE from 'three';
import type { GameBus } from '@/core/events';
import type { NavWorld } from '@/ai/NavWorld';
import type { MapDef, SpawnPoint, Team } from '@/world/mapTypes';
import { ZoneRules, type ZoneRulesOptions, type ZoneState } from './zoneRules';
import { ChargeRules, ConquestRules, LAST_STAND, LOOT_WEAPONS, LastStandRules, type Crate, DOMINATION, DominationRules, DeathmatchRules, ESCORT, EscortRules, FFA, FORTRESS, FREE_SPAWN_MODES, FortressRules, FreeForAllRules, FrontlineRules, GUN_GAME, GunGameRules, HardpointRules, KillConfirmRules, RUSH, RushRules, SOLO_MODES, SearchDestroyRules, halfOwners, hardpointRoute, killTarget, polyline, rushPlan, sndHalves, type Charge, type MatchRules, type ModeKind } from './matchRules';
import { MATCH, setMatchFlags, type MatchFlags } from './matchFlags';
import type { VehicleNav } from '@/ai/NavWorld';

const DEG = Math.PI / 180;
/** Spawning at an owned zone that is being captured puts you this far out from its edge. */
const CONTESTED_SPAWN_OFFSET: [number, number] = [12, 22];

/**
 * Tickets per soldier on a side [제안] (owner, 2026-10-03: "very generous", in
 * Frontline and Conquest only). 12v12 bot matches lose about 5-7 soldiers a
 * side a minute (measured on Ardennes / Iron Gate), so a Frontline side has
 * well over what 25 minutes of fighting costs; the Conquest attackers start
 * with `conquestStart` and get `conquestRefill` more for each sector taken.
 */
export const TICKETS = { frontline: 30, conquestStart: 15, conquestRefill: 10 };

export interface ZoneModeOptions extends ZoneRulesOptions {
  /** The mode asked for (the map's default when missing or not offered by the map). */
  mode?: ModeKind;
  /** Soldiers a side: tickets scale with it. */
  teamSize?: Record<Team, number>;
  /** Tickets for every side that has them, instead of the per-soldier numbers (?tickets=). */
  tickets?: number;
  rand?: () => number;
  /** A copy following a game server (multiplayer client): the server keeps the score. */
  passive?: boolean;
  /** Simplified controls (see `matchFlags`). */
  simple?: boolean;
}

/** A free spawn at a zone (hardpoint / deathmatch modes) needs no enemy this close to the zone's edge. */
const FREE_SPAWN_CLEAR = 30;

/**
 * What a match of `kind` allows (see `matchFlags`), with the simplified
 * controls on top when `simple` (`null`: no zone mode, e.g. the range).
 */
export function matchFlagsFor(kind: ModeKind | null, simple = false): Partial<MatchFlags> {
  const flags = kind ? modeFlags(kind) : {};
  return simple ? { ...flags, simple: true, revive: false, callIns: false, melee: kind === 'gungame' } : flags;
}

/** What a mode allows: the free-for-all modes have no sides, squads, vehicles or revives. */
function modeFlags(kind: ModeKind): Partial<MatchFlags> {
  if (kind === 'ffa' || kind === 'gungame') {
    return { ffa: true, revive: false, respawn: kind === 'ffa' ? FFA.respawn : GUN_GAME.respawn, squads: false, vehicles: false, callIns: false };
  }
  // One life for the whole match.
  if (kind === 'lastman') return { ffa: true, revive: false, respawn: Infinity, squads: false, vehicles: false, callIns: false };
  // One life a round: back only when the next round starts (Game / MatchSim respawn everyone then).
  if (kind === 'snd') return { revive: false, respawn: Infinity, vehicles: false, callIns: false };
  return {};
}

/** Modes `map` offers: Zone always, Frontline / Conquest when it sets them up, the zone-anywhere modes when it has zones. */
export function modesOf(map: MapDef): ModeKind[] {
  const out: ModeKind[] = ['zone'];
  if (map.modes?.frontline) out.push('frontline');
  if (map.modes?.conquest) out.push('conquest');
  const n = map.zones?.length ?? 0;
  if (n >= 2) out.push('hardpoint');
  if (n >= 1) out.push('tdm', 'killconfirm', 'ffa', 'gungame', 'lastman');
  if (n >= 2) out.push('rush', 'snd', 'escort', 'fortress');
  return out;
}

/** Middle of a side's spawn points. */
function spawnCenter(map: MapDef, team: Team): { x: number; z: number } {
  const list = map.spawns.filter((s) => s.team === team || (team === 'blue' && s.team === 'player'));
  const n = Math.max(1, list.length);
  return { x: list.reduce((a, s) => a + s.pos[0], 0) / n, z: list.reduce((a, s) => a + s.pos[2], 0) / n };
}

/** The mode a match on `map` plays: the one asked for if the map offers it, else its default. */
export function pickMode(map: MapDef, asked?: ModeKind, quiet = false): ModeKind {
  const offered = modesOf(map);
  if (asked && offered.includes(asked)) return asked;
  if (asked && !quiet) console.warn(`[strikegy] ${map.meta.id} has no ${asked} mode; playing its default`);
  const d = map.modes?.default;
  return d && offered.includes(d) ? d : 'zone';
}

function createMatch(kind: ModeKind, map: MapDef, opts: ZoneModeOptions): MatchRules {
  const size = opts.teamSize ?? { blue: 12, red: 12 };
  const per = (n: number) => ({ blue: opts.tickets ?? Math.round(n * size.blue), red: opts.tickets ?? Math.round(n * size.red) });
  const m = map.modes;
  if (kind === 'frontline' && m?.frontline) {
    return new FrontlineRules({
      sectors: m.frontline.sectors,
      tickets: per(TICKETS.frontline),
      teamSize: (size.blue + size.red) / 2,
      attackTime: m.frontline.attackTime,
      matchTime: m.frontline.matchTime,
      rand: opts.rand,
    });
  }
  if (kind === 'conquest' && m?.conquest) {
    const a = m.conquest.attacker;
    return new ConquestRules({
      attacker: a,
      sectors: m.conquest.sectors,
      tickets: per(TICKETS.conquestStart)[a],
      refill: Math.round(TICKETS.conquestRefill * size[a]),
    });
  }
  if (kind === 'hardpoint') {
    const zones = (map.zones ?? []).map((z) => ({ id: z.id, x: z.pos[0], z: z.pos[2] }));
    return new HardpointRules(hardpointRoute(zones, spawnCenter(map, 'blue'), spawnCenter(map, 'red')));
  }
  if (kind === 'tdm' || kind === 'killconfirm') {
    const target = killTarget(kind, (size.blue + size.red) / 2);
    return kind === 'tdm' ? new DeathmatchRules(target) : new KillConfirmRules(target);
  }
  if (kind === 'lastman') {
    // The first circle takes in every zone and spawn point.
    const pts = [...(map.zones ?? []).map((z) => ({ x: z.pos[0], z: z.pos[2], r: z.radius })), ...map.spawns.map((s) => ({ x: s.pos[0], z: s.pos[2], r: 0 }))];
    const zs = map.zones?.length ? map.zones : map.spawns;
    const cx = zs.reduce((a, z) => a + z.pos[0], 0) / Math.max(1, zs.length);
    const cz = zs.reduce((a, z) => a + z.pos[2], 0) / Math.max(1, zs.length);
    const r = Math.max(60, ...pts.map((p) => Math.hypot(p.x - cx, p.z - cz) + p.r + 20));
    return new LastStandRules({ x: cx, z: cz, r }, opts.rand);
  }
  if (kind === 'ffa') return new FreeForAllRules();
  if (kind === 'gungame') return new GunGameRules();
  if (kind === 'fortress') {
    const zones = (map.zones ?? []).map((z) => ({ id: z.id, x: z.pos[0], z: z.pos[2] }));
    return new FortressRules(halfOwners(zones, { blue: spawnCenter(map, 'blue'), red: spawnCenter(map, 'red') }), m?.zone?.target ? Math.round(m.zone.target * 0.75) : FORTRESS.target);
  }
  if (kind === 'rush' || kind === 'snd' || kind === 'escort') {
    const zones = (map.zones ?? []).map((z) => ({ id: z.id, x: z.pos[0], y: z.pos[1], z: z.pos[2], radius: z.radius }));
    const center = (team: Team) => {
      const c = spawnCenter(map, team);
      const list = map.spawns.filter((s) => s.team === team || (team === 'blue' && s.team === 'player'));
      return { x: c.x, y: list.reduce((a, s) => a + s.pos[1], 0) / Math.max(1, list.length), z: c.z };
    };
    // The side a map's breakthrough has attacking attacks here too (else red).
    const attacker: Team = m?.conquest?.attacker ?? 'red';
    if (kind === 'snd') return new SearchDestroyRules(sndHalves(zones, { blue: center('blue'), red: center('red') }, attacker));
    // The map's own sectors in attack order: the breakthrough's, else the frontline's (listed from the blue end).
    const front = m?.frontline?.sectors;
    const sectors = m?.conquest?.sectors ?? (front && (attacker === 'blue' ? front : [...front].reverse()));
    const plan = rushPlan(zones, center(attacker), center(attacker === 'blue' ? 'red' : 'blue'), sectors);
    if (kind === 'escort') {
      // Through every zone in attack order, starting a little before the first (straight lines until `planRoute` puts it on the roads).
      const checkpoints = plan.sectors.flat();
      const pts = checkpoints.map((id) => zones.find((z) => z.id === id)!).map((z) => [z.x, z.y, z.z] as [number, number, number]);
      const base = center(attacker);
      const first = pts[0] ?? [base.x, base.y, base.z];
      const d = Math.hypot(base.x - first[0], base.z - first[2]);
      const f = d > 0 ? Math.min(1, ESCORT.lead / d) : 0;
      const start: [number, number, number] = [first[0] + (base.x - first[0]) * f, first[1] + (base.y - first[1]) * f, first[2] + (base.z - first[2]) * f];
      const line = polyline([start, ...pts]);
      return new EscortRules({ attacker, checkpoints, route: line.route, at: line.at });
    }
    return new RushRules({
      attacker,
      sectors: plan.sectors,
      charges: plan.charges,
      tickets: opts.tickets ?? Math.round(RUSH.perSoldier * size[attacker]),
      refill: Math.round(RUSH.refillPerSoldier * size[attacker]),
    });
  }
  return new DominationRules(m?.zone?.target ?? DOMINATION.target);
}

export interface SpawnOption {
  /** 'base' or a zone id. */
  id: string;
  underAttack: boolean;
}

export interface Objective {
  pos: THREE.Vector3;
  radius: number;
  /** Held by the asking team: guard it. */
  defend?: boolean;
  /** Held and quiet (not under attack): a guard post for spare squads. */
  guard?: boolean;
  /** Unit direction (xz) from the zone toward the enemy base: where attacks come from. */
  front?: THREE.Vector3;
  /** Held by the other side. */
  enemyHeld?: boolean;
  /** A charge to stand on holding E (plant / defuse). */
  use?: boolean;
}

interface Presence {
  readonly id: number;
  readonly team: Team;
  readonly alive: boolean;
  readonly feet: THREE.Vector3;
  /** Holding E on foot. */
  readonly using?: boolean;
}

/**
 * A zone match at runtime (any of the three modes): counts who stands in each
 * zone, advances capture, runs the mode's rules (`match`), and answers where
 * a team may respawn and which zones its bots should go for.
 */
export class ZoneMode {
  readonly rules: ZoneRules;
  readonly kind: ModeKind;
  readonly match: MatchRules;
  private readonly bases: Record<Team, SpawnPoint[]>;
  private readonly baseCenter: Record<Team, THREE.Vector3>;
  private readonly counts = new Map<ZoneState, { blue: number; red: number }>();
  /** Living soldiers at the last step (free spawns keep away from enemies). */
  private alive: Presence[] = [];

  constructor(
    map: MapDef,
    private readonly bus: GameBus,
    opts: ZoneModeOptions = {},
  ) {
    this.rules = new ZoneRules(map.zones ?? [], opts);
    this.kind = pickMode(map, opts.mode);
    // Before anything reads them (the game builds its bots after this in some orders: it sets them too).
    setMatchFlags(matchFlagsFor(this.kind, opts.simple));
    this.match = createMatch(this.kind, map, opts);
    this.match.start(this.rules);
    this.syncFlags();
    if (this.match instanceof EscortRules) this.payload.set(this.match.pos.x, this.match.pos.y, this.match.pos.z);
    // Who went down: the Frontline attack timer, deathmatch scores, kill-confirmed tags.
    if (!opts.passive)
      bus.on('combat:kill', (e) => {
        if (!e.victimTeam || this.match.ended) return;
        this.match.onDown(e.victimTeam, e.victimId, e.attackerId, e.melee);
        this.announce();
      });
    const own = (team: Team) => map.spawns.filter((s) => s.team === team || (team === 'blue' && s.team === 'player'));
    this.bases = { blue: own('blue'), red: own('red') };
    const center = (list: SpawnPoint[]) =>
      list.reduce((a, s) => a.add(new THREE.Vector3(...s.pos)), new THREE.Vector3()).divideScalar(Math.max(1, list.length));
    this.baseCenter = { blue: center(this.bases.blue), red: center(this.bases.red) };
  }

  get zones(): readonly ZoneState[] {
    return this.rules.zones;
  }

  get ended(): boolean {
    return this.match.ended;
  }

  /** A member of `team` died. */
  onDeath(team: Team): void {
    if (this.match.ended) return;
    this.match.onDeath(team);
    this.announce();
  }

  private announced = false;

  /** Tells everyone the match is over, once. */
  private announce(): void {
    if (!this.match.winner || this.announced) return;
    this.announced = true;
    this.bus.emit('match:ended', { winner: this.match.winner, winnerId: this.match.winnerId ?? undefined });
  }

  /** Flags that follow the match as it goes (fortress: the build phase's truce). Clients following a server call it each frame. */
  syncFlags(): void {
    const building = this.match instanceof FortressRules && this.match.building;
    MATCH.truce = building;
    MATCH.buildBoost = building ? FORTRESS.boost : 1;
  }

  /** Last soldier standing: the rules, or null. */
  get lastStand(): LastStandRules | null {
    return this.match instanceof LastStandRules ? this.match : null;
  }

  /** Health a second the circle takes from someone standing at `p` (0 inside it, or in other modes). */
  stormDps(p: THREE.Vector3): number {
    return this.lastStand?.dpsAt(p.x, p.z) ?? 0;
  }

  /**
   * Last soldier standing: crates on walkable ground round the zones (and
   * between them), `perSoldier` a soldier, each with a random primary. The
   * game server's crates are what a browser in a match there gets.
   */
  placeLoot(nav: NavWorld | null, soldiers: number, rand = Math.random): void {
    const m = this.lastStand;
    this.nav = nav;
    if (!m || !nav || m.crates.length) return;
    const zones = this.rules.zones;
    const n = Math.max(LAST_STAND.minCrates, Math.round(soldiers * LAST_STAND.perSoldier));
    for (let i = 0; i < n * 3 && m.crates.length < n; i++) {
      const z = zones[i % zones.length];
      if (!z) break;
      const p = nav.randomAround(new THREE.Vector3(z.x, z.y, z.z), z.radius * 1.8);
      if (!p || m.crates.some((c) => (c.x - p.x) ** 2 + (c.z - p.z) ** 2 < 64)) continue;
      const crate: Crate = { id: m.crates.length + 1, x: p.x, y: p.y, z: p.z, weapon: LOOT_WEAPONS[Math.floor(rand() * LOOT_WEAPONS.length)]!, taken: false };
      m.crates.push(crate);
    }
  }

  /**
   * Last soldier standing, for a bot: with no primary yet, the nearest crate
   * nobody has opened (inside the coming circle if there is one); outside the
   * coming circle, its middle; else null (roam the zones inside it).
   */
  lastStandGoal(id: number, feet: THREE.Vector3): Objective | null {
    const m = this.lastStand;
    if (!m) return null;
    const inNext = (x: number, z: number) => Math.hypot(x - m.next.x, z - m.next.z) < m.next.r;
    if (!m.armed[id]) {
      let best: Crate | null = null;
      let bestD = Infinity;
      for (const c of m.crates) {
        if (c.taken) continue;
        const d = Math.hypot(c.x - feet.x, c.z - feet.z) * (inNext(c.x, c.z) ? 1 : 2.5);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best && bestD < 260) return { pos: new THREE.Vector3(best.x, best.y, best.z), radius: 1 };
    }
    if (!inNext(feet.x, feet.z)) {
      const c = new THREE.Vector3(m.next.x, feet.y, m.next.z);
      return { pos: this.nav?.closest(c) ?? c, radius: Math.max(4, m.next.r * 0.4) };
    }
    return null;
  }

  /** The navmesh the last-stand goals snap to (set by `placeLoot`). */
  private nav: NavWorld | null = null;

  /** Escort: where the payload is (one vector, kept up to date: bots' objectives follow it). */
  readonly payload = new THREE.Vector3();

  /**
   * Escort: the payload's route on the roads (the vehicle navmesh, else the
   * soldiers', else straight lines) through each checkpoint, once there is a
   * navmesh. The game server's route is what a browser in a match there gets.
   */
  planRoute(vehicles: VehicleNav | null, nav: NavWorld | null): void {
    const m = this.match;
    if (!(m instanceof EscortRules) || (!vehicles && !nav) || m.route.length < 2) return;
    const out: [number, number, number][] = [m.route[0]!];
    const at: number[] = [];
    const leg: THREE.Vector3[] = [];
    let d = 0;
    for (let i = 1; i < m.route.length; i++) {
      const a = out[out.length - 1]!;
      const b = m.route[i]!;
      const from = new THREE.Vector3(...a);
      const to = new THREE.Vector3(...b);
      const ok = (vehicles?.path(from, to, leg) || nav?.path(from, to, leg)) && leg.length > 0;
      const pts = ok ? leg.slice(1) : [to];
      // The leg may end short of the checkpoint (no hull fits there): close the gap straight.
      if (ok && pts.length && pts[pts.length - 1]!.distanceTo(to) > 3) pts.push(to);
      for (const p of pts) {
        const q = out[out.length - 1]!;
        d += Math.hypot(p.x - q[0], p.z - q[2]);
        out.push([p.x, p.y, p.z]);
      }
      at.push(d);
    }
    m.setRoute(out, at);
  }

  step(dt: number, everyone: Iterable<Presence>): void {
    if (this.match.ended) return;
    const list = [...everyone].filter((p) => p.alive);
    this.alive = list;
    for (const e of this.match.observe(list)) this.bus.emit('mode:event', e);
    const events = this.rules.update(dt, (z) => {
      let c = this.counts.get(z);
      if (!c) this.counts.set(z, (c = { blue: 0, red: 0 }));
      c.blue = c.red = 0;
      for (const p of list) if (ZoneRules.inside(z, p.feet)) c[p.team]++;
      return c;
    });
    for (const e of events) {
      if (e.type === 'captured') this.bus.emit('zone:captured', { zone: e.zone, team: e.team });
      else this.bus.emit('zone:neutralized', { zone: e.zone, team: e.team });
    }
    for (const e of this.match.step(dt, this.rules, events)) this.bus.emit('mode:event', e);
    this.syncFlags();
    if (this.match instanceof EscortRules) this.payload.set(this.match.pos.x, this.match.pos.y, this.match.pos.z);
    this.announce();
  }

  /** Zone ids as the HUD lists them for `team`: its side of the map first (Zone mode: by id); hidden ones left out. */
  order(team: Team): string[] {
    const o = this.match.order(team);
    return o.length ? o : this.rules.zones.filter((z) => !z.hidden).map((z) => z.id);
  }

  /** Who may use a zone's supply stations and build there when `team` asks: the owner; in the free-spawn and solo modes anyone. */
  stationOwner(id: string, team: Team): Team | null {
    if (this.freeSpawns || this.solo) return team;
    return this.zone(id)?.owner ?? null;
  }

  /** Charges (Rush, S&D): the rules, or null. */
  get charges(): ChargeRules | null {
    return this.match instanceof ChargeRules ? this.match : null;
  }

  /** The charge soldier `id` is planting / defusing now, if any. */
  charging(id: number): Charge | null {
    return this.charges?.workOf(id) ?? null;
  }

  /** A charge within reach of `p` (the prompt): live, not gone. */
  chargeNear(p: THREE.Vector3): Charge | null {
    const m = this.charges;
    if (!m) return null;
    const r = m.times.reach;
    return m.charges.find((c) => c.state !== 'gone' && (c.x - p.x) ** 2 + (c.z - p.z) ** 2 < r * r && Math.abs(c.y - p.y) < 2.5) ?? null;
  }

  /**
   * Puts the charges on walkable ground (once there is a navmesh): the zone's
   * middle can be a fountain or a wall. The game server's copy is what a
   * browser in a match there shows (the rules' state goes to it).
   */
  snapCharges(nav: NavWorld | null): void {
    const m = this.charges;
    if (!m || !nav) return;
    const all = m instanceof SearchDestroyRules ? m.halves.flatMap((h) => h.sites) : [];
    for (const c of [...m.charges, ...all]) {
      const at = new THREE.Vector3(c.x, c.y, c.z);
      const p = nav.closest(at);
      const q = p && Math.abs(p.y - c.y) < 2.5 ? p : groundAround(nav, at, 4);
      if (q) {
        c.x = q.x;
        c.y = q.y;
        c.z = q.z;
      }
    }
    // S&D: the half in play has copies of its sites.
    if (m instanceof SearchDestroyRules) {
      for (const c of m.charges) {
        const s = m.half.sites.find((x) => x.id === c.id);
        if (s) Object.assign(c, { x: s.x, y: s.y, z: s.z });
      }
    }
  }

  /** Soldiers spawn at any zone with no enemy near it, not only at zones they hold. */
  get freeSpawns(): boolean {
    return FREE_SPAWN_MODES.includes(this.kind);
  }

  /** Every soldier for themselves: one spawn choice, anywhere away from everyone (`soloSpawn`). */
  get solo(): boolean {
    return SOLO_MODES.includes(this.kind);
  }

  /**
   * A spawn away from everyone alive: zones, both sides' spawn points and a
   * few walkable points round the zones, the one furthest from the nearest
   * soldier (a little at random among the best three, so two soldiers dying
   * together don't come back on the same spot).
   */
  soloSpawn(nav: NavWorld | null, selfId: number, rand = Math.random): { pos: THREE.Vector3; yaw: number } {
    const cands: THREE.Vector3[] = [];
    for (const z of this.rules.zones) {
      const c = new THREE.Vector3(z.x, z.y, z.z);
      cands.push((nav && groundAround(nav, c, z.radius * 0.8)) || c);
      if (nav) {
        const far = nav.randomAround(c, z.radius * 2.5);
        if (far && Math.abs(far.y - c.y) < 4) cands.push(far);
      }
    }
    for (const list of [this.bases.blue, this.bases.red]) {
      for (const sp of list) {
        const p = new THREE.Vector3(...sp.pos);
        cands.push((nav && nav.randomAround(p, 3)) || p);
      }
    }
    const others = this.alive.filter((p) => p.id !== selfId);
    const scored = cands.map((p) => {
      let near = Infinity;
      for (const o of others) near = Math.min(near, (o.feet.x - p.x) ** 2 + (o.feet.z - p.z) ** 2);
      return { p, near };
    });
    scored.sort((a, b) => b.near - a.near);
    const pick = scored[Math.floor(rand() * Math.min(3, scored.length))]?.p ?? this.baseCenter.blue.clone();
    // Face the nearest soldier's way (or the map's middle).
    let face: THREE.Vector3 | null = null;
    let best = Infinity;
    for (const o of others) {
      const d = (o.feet.x - pick.x) ** 2 + (o.feet.z - pick.z) ** 2;
      if (d < best) {
        best = d;
        face = o.feet;
      }
    }
    face ??= this.baseCenter.blue.clone().lerp(this.baseCenter.red, 0.5);
    return { pos: pick, yaw: Math.atan2(-(face.x - pick.x), -(face.z - pick.z)) };
  }

  /** A zone `team` may spawn at in the free-spawn modes: not the hardpoint itself, no enemy near, not deep in the enemy's half. */
  private freeSpawnOk(team: Team, z: ZoneState): boolean {
    if (this.match instanceof HardpointRules && z.id === this.match.zoneId) return false;
    const r = z.radius + FREE_SPAWN_CLEAR;
    if (this.alive.some((p) => p.team !== team && (p.feet.x - z.x) ** 2 + (p.feet.z - z.z) ** 2 < r * r)) return false;
    const own = this.baseCenter[team];
    const enemy = this.baseCenter[team === 'blue' ? 'red' : 'blue'];
    return Math.hypot(z.x - own.x, z.z - own.z) < Math.hypot(z.x - enemy.x, z.z - enemy.z) + 40;
  }

  /** Base centre of `team` (spawn points' middle). */
  base(team: Team): THREE.Vector3 {
    return this.baseCenter[team];
  }

  zone(id: string): ZoneState | undefined {
    return this.rules.zones.find((z) => z.id === id);
  }

  /** The zone `p` stands in, if any. */
  zoneAt(p: THREE.Vector3): ZoneState | null {
    return this.rules.zones.find((z) => ZoneRules.inside(z, p)) ?? null;
  }

  /**
   * Base first, then owned zones in id order. With one sector open
   * (frontline / conquest) nobody spawns in it: the defenders come from the
   * sectors behind, the attackers from what they hold.
   */
  spawnOptions(team: Team): SpawnOption[] {
    if (this.solo) return [{ id: 'base', underAttack: false }];
    const allowed = this.match.spawnZones(team);
    if (allowed) return [{ id: 'base', underAttack: false }, ...allowed.map((id) => ({ id, underAttack: false }))];
    if (this.freeSpawns) return [{ id: 'base', underAttack: false }, ...this.rules.zones.filter((z) => this.freeSpawnOk(team, z)).map((z) => ({ id: z.id, underAttack: false }))];
    const zones = this.rules.owned(team).filter((z) => this.domination || z.locked);
    return [{ id: 'base', underAttack: false }, ...zones.map((z) => ({ id: z.id, underAttack: ZoneRules.underAttack(z) }))];
  }

  /**
   * Where to spawn for a choice ('base' or an owned zone id). Falls back to the
   * base if the zone is no longer owned. Faces the nearest zone not yet owned.
   */
  spawnPoint(team: Team, choice: string, nav: NavWorld | null, rand = Math.random, selfId = -1): { pos: THREE.Vector3; yaw: number } {
    if (this.solo) return this.soloSpawn(nav, selfId, rand);
    // S&D: each side starts a round at its spot of the half (attackers off the sites, defenders between them).
    if (this.match instanceof SearchDestroyRules) {
      const h = this.match.half;
      const s = team === h.attacker ? h.attackerStart : h.defenderStart;
      const c = new THREE.Vector3(s.x, s.y, s.z);
      const pos = (nav && groundAround(nav, c, 9)) || c;
      return { pos, yaw: this.faceYaw(team, pos) };
    }
    const allowed = this.match.spawnZones(team);
    if (allowed && choice !== 'base' && !allowed.includes(choice)) choice = 'base';
    const z = choice === 'base' ? undefined : this.zone(choice);
    let pos: THREE.Vector3;
    const usable = z && (allowed ? true : this.freeSpawns ? this.freeSpawnOk(team, z) : z.owner === team && (this.domination || z.locked));
    if (!z || !usable) {
      const list = this.bases[team];
      const sp = list[Math.floor(rand() * list.length)];
      pos = sp ? new THREE.Vector3(...sp.pos) : this.baseCenter[team].clone();
      if (nav) pos = nav.randomAround(pos, 3) ?? pos;
    } else if (!this.freeSpawns && !allowed && ZoneRules.underAttack(z)) {
      // Back from the fight, toward our own base. The spot can land inside a
      // building (no floor there at the zone's height): then another angle, and
      // failing that the zone itself, never the spot as it is.
      const center = new THREE.Vector3(z.x, z.y, z.z);
      const toBase = this.baseCenter[team].clone().sub(center).setY(0).normalize();
      const d = z.radius + CONTESTED_SPAWN_OFFSET[0] + rand() * (CONTESTED_SPAWN_OFFSET[1] - CONTESTED_SPAWN_OFFSET[0]);
      let found: THREE.Vector3 | null = null;
      for (let i = 0; i < 6 && !found; i++) {
        const away = toBase.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (rand() - 0.5) * (70 + i * 20) * DEG);
        const at = center.clone().addScaledVector(away, d);
        found = nav ? (nav.randomAround(at, 4) ?? nav.closest(at)) : at;
      }
      pos = found ?? (nav && groundAround(nav, center, z.radius * 0.6)) ?? center;
    } else {
      const center = new THREE.Vector3(z.x, z.y, z.z);
      pos = (nav && groundAround(nav, center, z.radius * 0.6)) || center;
    }
    return { pos, yaw: this.faceYaw(team, pos) };
  }

  /** Yaw (player convention, 0 = -Z) toward the nearest zone this team does not own, else the enemy base. */
  private faceYaw(team: Team, from: THREE.Vector3): number {
    let target: THREE.Vector3 | null = null;
    let best = Infinity;
    const open = this.rules.zones.some((z) => !z.locked && z.owner !== team);
    for (const z of this.rules.zones) {
      if (z.owner === team || (open && z.locked)) continue;
      const d = Math.hypot(z.x - from.x, z.z - from.z);
      if (d > 3 && d < best) {
        best = d;
        target = new THREE.Vector3(z.x, z.y, z.z);
      }
    }
    target ??= this.baseCenter[team === 'blue' ? 'red' : 'blue'];
    return Math.atan2(-(target.x - from.x), -(target.z - from.z));
  }

  /**
   * Zones worth going for, best first: owned zones under attack, then neutral,
   * then enemy zones; nearer to this team's base ranks higher. Locked zones
   * (frontline / conquest: everything but the sector fought over) are not.
   */
  /** Held zones score (zone, fortress): every zone is open and one's own are spawn points. */
  get domination(): boolean {
    return this.kind === 'zone' || this.kind === 'fortress';
  }

  objectives(team: Team): Objective[] {
    if (this.charges) return this.chargeObjectives(team, this.charges);
    const m = this.match;
    if (m instanceof EscortRules) {
      // Everyone at the payload: the attackers to push it, the defenders to stop it.
      const att = team === m.attacker;
      const enemy = this.baseCenter[team === 'blue' ? 'red' : 'blue'];
      const front = new THREE.Vector3(enemy.x - this.payload.x, 0, enemy.z - this.payload.z).normalize();
      return [att ? { pos: this.payload, radius: 7, enemyHeld: true } : { pos: this.payload, radius: 12, defend: true, front }];
    }
    // Last soldier standing: the zones inside the coming circle (bots go for crates and the middle first, `lastStandGoal`).
    if (m instanceof LastStandRules) {
      const inside = this.rules.zones.filter((z) => Math.hypot(z.x - m.next.x, z.z - m.next.z) < m.next.r + z.radius * 0.5);
      const list = inside.map((z) => ({ pos: new THREE.Vector3(z.x, z.y, z.z), radius: Math.min(z.radius, m.next.r) }));
      if (!list.length) {
        const c = new THREE.Vector3(m.next.x, this.rules.zones[0]?.y ?? 0, m.next.z);
        list.push({ pos: this.nav?.closest(c) ?? c, radius: Math.max(4, m.next.r * 0.5) });
      }
      return list;
    }
    // Fortress, building: each side at its own zones (the middle waits for the fight).
    if (m instanceof FortressRules && m.building) {
      const enemy = this.baseCenter[team === 'blue' ? 'red' : 'blue'];
      return this.rules.owned(team).map((z) => ({ pos: new THREE.Vector3(z.x, z.y, z.z), radius: z.radius, defend: true, guard: false, front: new THREE.Vector3(enemy.x - z.x, 0, enemy.z - z.z).normalize() }));
    }
    const base = this.baseCenter[team];
    const enemyBase = this.baseCenter[team === 'blue' ? 'red' : 'blue'];
    // With one sector in play, its zones (also while it waits to open).
    const focus = this.match.focus();
    const scored = this.rules.zones
      .filter((z) => (focus ? focus.includes(z.id) : !z.locked))
      .map((z) => {
        const d = Math.hypot(z.x - base.x, z.z - base.z);
        // Free-for-all: no side to rank by; every bot picks its own (BotManager).
        if (this.solo) return { z, s: 1 };
        // Deathmatch modes: the middle of the map first (both sides meet there), not the nearest zones.
        if (this.kind === 'tdm' || this.kind === 'killconfirm') {
          const de = Math.hypot(z.x - enemyBase.x, z.z - enemyBase.z);
          return { z, s: 2 - Math.abs(d - de) / 300 };
        }
        let s: number;
        // Owned and quiet: a low-priority guard post (squads left over after the other goals).
        if (z.owner === team) s = ZoneRules.underAttack(z) ? 3 : z.pushing === null && z.control !== (team === 'blue' ? 1 : -1) ? 1 : 0.2;
        else if (z.owner === null) s = 2;
        else s = 1.6;
        return { z, s: s - d / 400 };
      })
      // Zone mode drops far-off quiet held zones; with one sector open, every open zone counts.
      .filter((e) => e.s > -0.5 || !this.domination)
      .sort((a, b) => b.s - a.s);
    const enemy = this.baseCenter[team === 'blue' ? 'red' : 'blue'];
    return scored.map(({ z }) => ({
      pos: new THREE.Vector3(z.x, z.y, z.z),
      radius: z.radius,
      defend: z.owner === team,
      guard: z.owner === team && !ZoneRules.underAttack(z),
      enemyHeld: z.owner !== null && z.owner !== team,
      front: new THREE.Vector3(enemy.x - z.x, 0, enemy.z - z.z).normalize(),
    }));
  }

  /**
   * Rush / S&D for the bots: attackers go for idle charges to plant (the
   * nearest bots stand on them holding E) and guard armed ones; defenders go
   * for armed charges to defuse and guard the idle ones, facing the attack.
   */
  private chargeObjectives(team: Team, m: ChargeRules): Objective[] {
    const att = team === m.attacker;
    const focus = m.focus() ?? [];
    const list = m.charges.filter((c) => c.state !== 'gone' && focus.includes(c.zone));
    const enemyBase = this.baseCenter[team === 'blue' ? 'red' : 'blue'];
    const scored = list.map((c) => {
      const pos = new THREE.Vector3(c.x, c.y, c.z);
      const front = new THREE.Vector3(enemyBase.x - c.x, 0, enemyBase.z - c.z).normalize();
      const armed = c.state === 'armed';
      const work = c.live && (att ? !armed : armed);
      const o: Objective = work ? { pos, radius: 6, use: true, enemyHeld: att } : { pos, radius: 14, defend: true, guard: !armed && !att, front };
      return { o, s: (work ? 2 : 1) - pos.distanceTo(this.baseCenter[team]) / 1000 };
    });
    return scored.sort((a, b) => b.s - a.s).map((x) => x.o);
  }
}

/**
 * A random walkable point within `r` of `at` at about its height: the navmesh
 * reaches the upper floors of buildings in a zone, and nobody should spawn on
 * the fourth floor of the hospital. Falls back to any point if none is low.
 */
function groundAround(nav: NavWorld, at: THREE.Vector3, r: number): THREE.Vector3 | null {
  let any: THREE.Vector3 | null = null;
  for (let i = 0; i < 6; i++) {
    const p = nav.randomAround(at, r);
    if (!p) break;
    if (Math.abs(p.y - at.y) < 2.5) return p;
    any ??= p;
  }
  if (any) return any;
  // Nothing walkable at the very middle (a monument, a fountain: Iron Gate's B): round it.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const d = Math.max(3, r * (i < 6 ? 0.4 : 0.8));
    const p = nav.closest(new THREE.Vector3(at.x + Math.cos(a) * d, at.y, at.z + Math.sin(a) * d));
    if (p && Math.abs(p.y - at.y) < 4) return p;
  }
  return null;
}
