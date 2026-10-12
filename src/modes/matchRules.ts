import type { Team } from '@/world/mapTypes';
import { ZoneRules, type ZoneEvent, type ZoneState } from './zoneRules';

/**
 * Match rules for the three modes (pure logic, no rendering), on top of the
 * capture engine in `zoneRules.ts` (owner, 2026-10-03):
 *
 * - **Zone**: every `tick` seconds each side scores a point per zone it holds;
 *   the first to the map's target wins. No tickets.
 * - **Frontline**: zones in a line of sectors from one base to the other, each
 *   side starting with its half (an odd middle sector starts neutral and goes
 *   to whoever takes all of it first, or holds more of it when the opening
 *   timer runs out). Only one sector is fought over: the
 *   attackers have an attack timer that grows or shrinks with how the fight is
 *   going (random amounts); taking the sector makes the side that lost it the
 *   attackers, running out of time makes the defenders the attackers of the
 *   next sector toward the other side. Taking the enemy's last sector wins;
 *   tickets (generous) or the match clock (more zones) end it otherwise.
 * - **Conquest** (breakthrough): the defenders hold everything; the attackers
 *   take the sectors one at a time, and a taken sector stays theirs. Only the
 *   attackers have tickets, topped up with every sector; the defenders win
 *   when those run out.
 */

export type ModeKind = 'zone' | 'frontline' | 'conquest' | 'hardpoint' | 'tdm' | 'killconfirm' | 'ffa' | 'gungame' | 'rush' | 'snd' | 'escort' | 'fortress' | 'lastman';

export const MODE_KINDS: readonly ModeKind[] = ['zone', 'frontline', 'conquest', 'hardpoint', 'tdm', 'killconfirm', 'ffa', 'gungame', 'rush', 'snd', 'escort', 'fortress', 'lastman'];

/** Modes where the zones are no front: soldiers spawn at any zone with no enemy near it (owner, 2026-10-12). */
export const FREE_SPAWN_MODES: readonly ModeKind[] = ['hardpoint', 'tdm', 'killconfirm'];

/** Every soldier for themselves: no sides, no squads, no vehicles or call-ins, a down is a death (see `matchFlags`). */
export const SOLO_MODES: readonly ModeKind[] = ['ffa', 'gungame', 'lastman'];

/** How a match ended. */
export type EndReason = 'points' | 'tickets' | 'front' | 'time' | 'sectors' | 'rounds' | 'delivered' | 'survived';

/** Something worth announcing. */
export type ModeEvent =
  /** `team` took sector `sector` (frontline: index from the blue end; conquest: attack order). */
  | { type: 'sector'; team: Team; sector: number }
  /** A new attack begins: `attacker` attacks; why the roles are what they are now. */
  | { type: 'attack'; attacker: Team; reason: 'opening' | 'captured' | 'held' }
  /** The attack timer moved by `delta` seconds (frontline). */
  | { type: 'time'; delta: number; attacker: Team }
  /** Tickets added to `team` (conquest: a sector taken). */
  | { type: 'refill'; team: Team; tickets: number }
  /** The hardpoint moved to `zone`. */
  | { type: 'hill'; zone: string }
  /** A dog tag was picked up: `by` (combatant id, team `team`) confirmed a kill or denied one. */
  | { type: 'tag'; team: Team; confirmed: boolean; by: number }
  /** Gun game: soldier `id` moved to step `level` of the lineup (`up`: by a kill; else knocked back by a melee kill). */
  | { type: 'level'; id: number; level: number; up: boolean }
  /** A charge (Rush, S&D) was armed, defused or went off; `team` did it, `by` who (-1: the fuse). */
  | { type: 'charge'; id: string; zone: string; state: 'armed' | 'defused' | 'blown'; team: Team; by: number }
  /** S&D: round `n` begins (`attacker` attacks it), or ended (`winner`, why). */
  | { type: 'round'; n: number; attacker: Team }
  | { type: 'roundEnd'; n: number; winner: Team; why: 'eliminated' | 'blown' | 'defused' | 'time' }
  /** Escort: the payload reached checkpoint `zone` (`n` from 1); `bonus` s added to the clock. */
  | { type: 'checkpoint'; zone: string; n: number; bonus: number }
  /** Fortress: the build phase is over, the fight begins. */
  | { type: 'built' }
  /** Last soldier standing: soldier `by` opened crate `id` and now carries `weapon`. */
  | { type: 'loot'; id: number; by: number; weapon: string }
  /** Last soldier standing: the circle starts closing in on `r` m round (x, z). */
  | { type: 'shrink'; stage: number; x: number; z: number; r: number };

const SIGN: Record<Team, number> = { blue: 1, red: -1 };

/** A soldier as the rules see them. */
export interface Presence {
  readonly id: number;
  readonly team: Team;
  readonly alive: boolean;
  readonly feet: { readonly x: number; readonly y: number; readonly z: number };
  /** Holding E on foot (planting / defusing a charge). */
  readonly using?: boolean;
}
const other = (t: Team): Team => (t === 'blue' ? 'red' : 'blue');

export abstract class MatchRules {
  abstract readonly kind: ModeKind;
  winner: Team | null = null;
  /** Free-for-all: the soldier who won (`winner` is then only their nominal side). */
  winnerId: number | null = null;
  reason: EndReason | null = null;
  /** Tickets per side; null for a side that has none. */
  readonly tickets: Record<Team, number | null> = { blue: null, red: null };

  get ended(): boolean {
    return this.winner !== null;
  }

  /** Called once before the first step: starting owners and locks. */
  abstract start(zones: ZoneRules): void;

  /** After every capture update, with the ownership changes it made. */
  abstract step(dt: number, zones: ZoneRules, events: readonly ZoneEvent[]): ModeEvent[];

  /** A member of `team` died for good. */
  onDeath(team: Team): void {
    const t = this.tickets[team];
    if (this.ended || t === null) return;
    this.tickets[team] = Math.max(0, t - 1);
    if (this.tickets[team] === 0) this.end(other(team), 'tickets');
  }

  /**
   * A member of `team` went down (frontline: part of how the attack is going);
   * `victimId` / `attackerId` when known, `melee` for a blow with the butt.
   */
  onDown(team: Team, victimId?: number, attackerId?: number, melee?: boolean): void {
    void team;
    void victimId;
    void attackerId;
    void melee;
  }

  /** Everyone's place before each step (modes that care where people are, beyond the zones). */
  observe(list: readonly Presence[]): ModeEvent[] {
    void list;
    return [];
  }

  /** Zone ids from `team`'s side of the map to the far side (the HUD's left to right). */
  abstract order(team: Team): string[];

  /** Zones the fight is about now (or about to be), null for all: what bots go for. */
  focus(): readonly string[] | null {
    return null;
  }

  /** Zones a side may spawn at besides its base (null: the usual rule, its own zones). */
  spawnZones(team: Team): string[] | null {
    void team;
    return null;
  }

  protected end(winner: Team, reason: EndReason): void {
    if (this.ended) return;
    this.winner = winner;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Zone: domination points

/** A point per held zone every `tick` seconds; `target` when the map gives none. */
export const DOMINATION = { tick: 5, target: 400 };

/**
 * Modes scored in points to a target, with an optional match clock: when the
 * clock runs out the side ahead wins (level: the next point decides).
 */
export abstract class PointsRules extends MatchRules {
  readonly points: Record<Team, number> = { blue: 0, red: 0 };
  /** Seconds played. */
  clock = 0;

  constructor(
    readonly target: number,
    /** Match length in seconds (Infinity: none). */
    readonly timeLimit: number = Infinity,
  ) {
    super();
  }

  get timeLeft(): number {
    return Math.max(0, this.timeLimit - this.clock);
  }

  /** Adds points and ends the match when someone is over the line (or the clock is out and someone leads). */
  protected score(team: Team, n: number): void {
    if (this.ended || n <= 0) return;
    this.points[team] = Math.min(this.target, this.points[team] + n);
    this.judge();
  }

  protected tickClock(dt: number): void {
    this.clock += dt;
    this.judge();
  }

  protected judge(): void {
    if (this.ended) return;
    const { blue, red } = this.points;
    if ((blue >= this.target || red >= this.target) && blue !== red) this.end(blue > red ? 'blue' : 'red', 'points');
    else if (this.clock >= this.timeLimit && Math.floor(blue) !== Math.floor(red)) this.end(blue > red ? 'blue' : 'red', 'time');
  }
}

export class DominationRules extends PointsRules {
  readonly kind = 'zone';
  private tickTime = 0;

  constructor(
    target: number = DOMINATION.target,
    readonly tick: number = DOMINATION.tick,
  ) {
    super(target);
  }

  /** Seconds to the next scoring tick. */
  get nextTick(): number {
    return this.tick - this.tickTime;
  }

  start(): void {}

  step(dt: number, zones: ZoneRules): ModeEvent[] {
    if (this.ended) return [];
    this.tickTime += dt;
    while (this.tickTime >= this.tick) {
      this.tickTime -= this.tick;
      // Both sides score in the same tick; a tie over the line plays on to the next.
      for (const t of ['blue', 'red'] as const) this.points[t] = Math.min(this.target, this.points[t] + zones.owned(t).length);
      this.judge();
    }
    return [];
  }

  order(team: Team): string[] {
    void team;
    return [];
  }
}

// ---------------------------------------------------------------------------
// Hardpoint, team deathmatch, kill confirmed (owner, 2026-10-12: "all of them")

/**
 * Numbers (owner accepted TDM / kill confirmed, 2026-10-12). Hardpoint [제안]: one
 * zone in play at a time, moving every `rotate` s round the map; the side with
 * more soldiers in it scores a point a second (level: nobody; owner: with many
 * players a side is never alone in it, so "alone" would stall big matches);
 * first to `target` or ahead after `time` s. Team deathmatch: a point for every
 * enemy downed, first to `perSoldier` x the team size (about 10 minutes at
 * a 6v6 bot match on Iron Gate: ~11 downs a minute in all) or ahead after `time` s. Kill
 * confirmed: a downed enemy drops a tag that lasts `tagLife` s; the side that
 * downed them scores by picking it up (`reach` m), the victim's side denies it.
 */
export const HARDPOINT = { target: 200, rotate: 60, time: 600 };
export const TDM = { perSoldier: 7, min: 10, max: 150, time: 600 };
export const KILL_CONFIRMED = { perSoldier: 5, min: 8, max: 120, time: 600, tagLife: 30, reach: 1.6 };

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

export class HardpointRules extends PointsRules {
  readonly kind = 'hardpoint';
  /** Zone ids in the order the point visits them. */
  readonly route: string[];
  /** Index into `route` of the zone in play. */
  active = 0;
  /** Seconds until the point moves. */
  moveIn: number;
  /** The side with more soldiers in the point (scoring), or null when level / empty. */
  holder: Team | null = null;
  contested = false;
  readonly rotate: number;

  constructor(route: readonly string[], opts: { target?: number; rotate?: number; time?: number } = {}) {
    super(opts.target ?? HARDPOINT.target, opts.time ?? HARDPOINT.time);
    this.route = [...route];
    this.rotate = opts.rotate ?? HARDPOINT.rotate;
    this.moveIn = this.rotate;
  }

  get zoneId(): string {
    return this.route[this.active % Math.max(1, this.route.length)] ?? '';
  }

  start(zr: ZoneRules): void {
    this.show(zr);
  }

  private show(zr: ZoneRules): void {
    for (const z of zr.zones) {
      const live = z.id === this.zoneId;
      z.locked = !live;
      z.noCapture = live;
      z.hidden = !live;
      ZoneRules.force(z, null);
    }
  }

  step(dt: number, zr: ZoneRules): ModeEvent[] {
    if (this.ended || !this.route.length) return [];
    const out: ModeEvent[] = [];
    this.moveIn -= dt;
    if (this.moveIn <= 0) {
      this.active = (this.active + 1) % this.route.length;
      this.moveIn += this.rotate;
      this.show(zr);
      out.push({ type: 'hill', zone: this.zoneId });
    }
    const z = zr.zones.find((q) => q.id === this.zoneId);
    if (z) {
      this.contested = z.blue > 0 && z.red > 0;
      this.holder = z.blue > z.red ? 'blue' : z.red > z.blue ? 'red' : null;
      // Shown as owned by whoever is scoring, pulsing while they are.
      ZoneRules.force(z, this.holder);
      z.pushing = this.holder;
      z.contested = this.contested;
      if (this.holder) this.score(this.holder, dt);
    }
    this.tickClock(dt);
    return out;
  }

  override focus(): readonly string[] {
    return [this.zoneId];
  }

  order(): string[] {
    return [this.zoneId];
  }
}

/** Team deathmatch: the zones are only spawn points and places to go; downs score. */
export class DeathmatchRules extends PointsRules {
  readonly kind: ModeKind = 'tdm';
  private ids: string[] = [];

  constructor(target: number, time: number = TDM.time) {
    super(target, time);
  }

  start(zr: ZoneRules): void {
    for (const z of zr.zones) {
      z.locked = true;
      z.hidden = true;
      ZoneRules.force(z, null);
    }
    this.ids = zr.zones.map((z) => z.id);
  }

  step(dt: number): ModeEvent[] {
    if (this.ended) return [];
    this.tickClock(dt);
    return [];
  }

  override onDown(team: Team): void {
    this.score(other(team), 1);
  }

  /** Bots roam the zones (they are where the map's fights are). */
  override focus(): readonly string[] {
    return this.ids;
  }

  order(): string[] {
    return [];
  }
}

export interface DogTag {
  id: number;
  /** The side of the soldier who dropped it. */
  team: Team;
  x: number;
  y: number;
  z: number;
  /** Seconds left before it fades. */
  life: number;
}

/** Kill confirmed: downs drop tags; picking up the enemy's scores, picking up your side's denies. */
export class KillConfirmRules extends DeathmatchRules {
  override readonly kind: ModeKind = 'killconfirm';
  readonly tags: DogTag[] = [];
  private nextTag = 1;
  /** Where each soldier was at the last step (a down drops the tag there). */
  private readonly where = new Map<number, { x: number; y: number; z: number }>();

  override onDown(team: Team, victimId?: number): void {
    if (this.ended || victimId === undefined) return;
    const p = this.where.get(victimId);
    if (!p) return;
    this.tags.push({ id: this.nextTag++, team, x: p.x, y: p.y, z: p.z, life: KILL_CONFIRMED.tagLife });
  }

  override observe(list: readonly Presence[]): ModeEvent[] {
    const out: ModeEvent[] = [];
    for (const s of list) if (s.alive) this.where.set(s.id, { x: s.feet.x, y: s.feet.y, z: s.feet.z });
    if (this.ended) return out;
    const r2 = KILL_CONFIRMED.reach * KILL_CONFIRMED.reach;
    for (let i = this.tags.length - 1; i >= 0; i--) {
      const tag = this.tags[i]!;
      const by = list.find((s) => s.alive && (s.feet.x - tag.x) ** 2 + (s.feet.z - tag.z) ** 2 < r2 && Math.abs(s.feet.y - tag.y) < 2.5);
      if (!by) continue;
      this.tags.splice(i, 1);
      const confirmed = by.team !== tag.team;
      if (confirmed) this.score(by.team, 1);
      out.push({ type: 'tag', team: by.team, confirmed, by: by.id });
    }
    return out;
  }

  override step(dt: number): ModeEvent[] {
    for (let i = this.tags.length - 1; i >= 0; i--) {
      this.tags[i]!.life -= dt;
      if (this.tags[i]!.life <= 0) this.tags.splice(i, 1);
    }
    return super.step(dt);
  }
}

/** Kill target for a team deathmatch / kill confirmed match of `teamSize` a side. */
export function killTarget(kind: 'tdm' | 'killconfirm', teamSize: number): number {
  const c = kind === 'tdm' ? TDM : KILL_CONFIRMED;
  return Math.min(c.max, Math.max(c.min, round5(teamSize * c.perSoldier)));
}

/**
 * The hardpoint's route: starts at the zone in the middle (as far from one base
 * as from the other), then swings from side to side, nearest first.
 */
export function hardpointRoute(zones: readonly { id: string; x: number; z: number }[], blue: { x: number; z: number }, red: { x: number; z: number }): string[] {
  const lean = (z: { x: number; z: number }) => Math.hypot(z.x - blue.x, z.z - blue.z) - Math.hypot(z.x - red.x, z.z - red.z);
  const sorted = [...zones].sort((a, b) => Math.abs(lean(a)) - Math.abs(lean(b)));
  const route: string[] = [];
  const left = sorted.slice(1).filter((z) => lean(z) < 0);
  const right = sorted.slice(1).filter((z) => lean(z) >= 0);
  if (sorted[0]) route.push(sorted[0].id);
  while (left.length || right.length) {
    const a = right.shift();
    if (a) route.push(a.id);
    const b = left.shift();
    if (b) route.push(b.id);
  }
  return route;
}

// ---------------------------------------------------------------------------
// Free-for-all (owner, 2026-10-12): every soldier their own side

/**
 * Numbers [제안]. Free-for-all deathmatch: first to `target` kills, or the
 * leader after `time` s; respawn after `respawn` s anywhere away from
 * everyone. Gun game: a kill moves you to the next weapon of `GUN_GAME_STEPS`
 * (all 23, the hardest to win with last), then the rifle butt (the last
 * pistol with no rounds); a kill with that wins; being killed with a melee
 * blow sends you back a step. `time` s, then the furthest along wins.
 */
export const FFA = { target: 20, time: 600, respawn: 2 };
export const GUN_GAME = { time: 900, respawn: 2 };

/** Gun game's lineup: rifles and SMGs first, then heavier and slower guns, pistols last (one step more is the butt). */
export const GUN_GAME_STEPS = [
  'ar4', 'ar1', 'smg2', 'smg1', 'ar2', 'smg4', 'lmg3', 'lmg1', 'ar3', 'smg3', 'lmg2',
  'sg3', 'sg1', 'sg2', 'dmr1', 'dmr2', 'dmr3', 'sr3', 'sr1', 'sr2', 'pistol3', 'pistol1', 'pistol2',
] as const;

/**
 * Modes where each soldier scores for themselves (`score` by combatant id).
 * Zones are hidden: spawns are anywhere away from everyone, bots roam them.
 */
export abstract class SoloRules extends MatchRules {
  /** Points per combatant id (kills; gun game: the step reached). */
  readonly score: Record<string, number> = {};
  /** Each soldier's nominal side (the match end names one). */
  readonly sides: Record<string, Team> = {};
  /** Seconds played. */
  clock = 0;
  private ids: string[] = [];

  constructor(
    readonly target: number,
    readonly timeLimit: number,
  ) {
    super();
  }

  get timeLeft(): number {
    return Math.max(0, this.timeLimit - this.clock);
  }

  scoreOf(id: number): number {
    return this.score[id] ?? 0;
  }

  /** Everyone with a score, best first. */
  standings(): { id: number; n: number }[] {
    return Object.entries(this.score)
      .map(([id, n]) => ({ id: Number(id), n }))
      .sort((a, b) => b.n - a.n || a.id - b.id);
  }

  start(zr: ZoneRules): void {
    for (const z of zr.zones) {
      z.locked = true;
      z.hidden = true;
      ZoneRules.force(z, null);
    }
    this.ids = zr.zones.map((z) => z.id);
  }

  step(dt: number): ModeEvent[] {
    if (this.ended) return [];
    this.clock += dt;
    this.judge();
    return [];
  }

  override observe(list: readonly Presence[]): ModeEvent[] {
    for (const s of list) {
      this.sides[s.id] = s.team;
      this.score[s.id] ??= 0;
    }
    return [];
  }

  protected award(id: number, n: number): void {
    if (this.ended) return;
    this.score[id] = Math.max(0, (this.score[id] ?? 0) + n);
    this.judge();
  }

  /** Over the line, or out of time with one soldier ahead (level: the next point decides). */
  protected judge(): void {
    if (this.ended) return;
    const [a, b] = this.standings();
    if (!a) return;
    if (a.n >= this.target) this.endSolo(a.id, 'points');
    else if (this.clock >= this.timeLimit && (!b || a.n > b.n)) this.endSolo(a.id, 'time');
  }

  protected endSolo(id: number, reason: EndReason): void {
    if (this.ended) return;
    this.winnerId = id;
    this.end(this.sides[id] ?? 'blue', reason);
  }

  /** Bots roam the zones (where the map's fights are). */
  override focus(): readonly string[] {
    return this.ids;
  }

  order(): string[] {
    return [];
  }
}

export class FreeForAllRules extends SoloRules {
  readonly kind = 'ffa';

  constructor(target: number = FFA.target, time: number = FFA.time) {
    super(target, time);
  }

  override onDown(_team: Team, victimId?: number, attackerId?: number): void {
    if (attackerId === undefined || attackerId === victimId || attackerId < 0) return;
    this.award(attackerId, 1);
  }
}

/** Gun game: `score` is the step each soldier is on (0 = the first gun); `target` = the steps, the butt last. */
export class GunGameRules extends SoloRules {
  readonly kind = 'gungame';
  private pending: ModeEvent[] = [];

  constructor(time: number = GUN_GAME.time) {
    super(GUN_GAME_STEPS.length + 1, time);
  }

  /** The weapon for step `level`, or null on the last step (the butt: the last pistol, empty). */
  static weaponAt(level: number): (typeof GUN_GAME_STEPS)[number] | null {
    return level < GUN_GAME_STEPS.length ? GUN_GAME_STEPS[Math.max(0, level)]! : null;
  }

  override onDown(_team: Team, victimId?: number, attackerId?: number, melee?: boolean): void {
    if (this.ended || attackerId === undefined || attackerId === victimId || attackerId < 0) return;
    const before = this.scoreOf(attackerId);
    // On the last step only the butt counts.
    if (before >= GUN_GAME_STEPS.length && !melee) return;
    this.award(attackerId, 1);
    if (!this.ended) this.pending.push({ type: 'level', id: attackerId, level: this.scoreOf(attackerId), up: true });
    if (melee && victimId !== undefined && this.scoreOf(victimId) > 0) {
      this.score[victimId] = this.scoreOf(victimId) - 1;
      this.pending.push({ type: 'level', id: victimId, level: this.scoreOf(victimId), up: false });
    }
  }

  override step(dt: number): ModeEvent[] {
    const out = this.pending;
    this.pending = [];
    return [...out, ...super.step(dt)];
  }
}

// ---------------------------------------------------------------------------
// Last soldier standing (owner, 2026-10-12)

/**
 * Last soldier standing [제안]: free-for-all with one life. Everyone starts
 * with a pistol; crates on the ground (`perSoldier` a soldier, at least
 * `minCrates`) hold a primary, ammo and a medkit, opened by walking up to
 * them (`reach` m). A circle that starts round the whole map closes in by
 * stages: it holds `wait[i]` s, then shrinks over `shrink[i]` s to `factor`
 * of its radius (not under `minR`) round a new middle inside it; outside it
 * a soldier loses `dps[i]` health a second (nothing in the first `grace` s).
 * The last one alive wins (all gone at once: the most kills).
 */
export const LAST_STAND = {
  grace: 20,
  wait: [60, 45, 40, 30, 25, 20],
  shrink: [40, 35, 30, 25, 20, 20],
  factor: 0.6,
  minR: 12,
  dps: [2, 3, 5, 8, 12, 16, 20],
  perSoldier: 1.5,
  minCrates: 8,
  reach: 1.6,
};

/** Primaries a crate can hold (any gun but the pistols). */
export const LOOT_WEAPONS = [
  'ar1', 'ar2', 'ar3', 'ar4', 'smg1', 'smg2', 'smg3', 'smg4', 'lmg1', 'lmg2', 'lmg3',
  'sg1', 'sg2', 'sg3', 'dmr1', 'dmr2', 'dmr3', 'sr1', 'sr2', 'sr3',
] as const;

export interface Crate {
  id: number;
  x: number;
  y: number;
  z: number;
  weapon: string;
  taken: boolean;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export class LastStandRules extends SoloRules {
  readonly kind = 'lastman';
  /** The circle now, where it closes in to, and where it was when this shrink began. */
  readonly circle: Circle;
  readonly next: Circle;
  private readonly from: Circle;
  stage = 0;
  phase: 'wait' | 'shrink' = 'wait';
  phaseLeft: number = LAST_STAND.wait[0]!;
  readonly crates: Crate[] = [];
  /** The primary each soldier carries (from a crate). */
  readonly armed: Record<string, string> = {};
  /** Soldiers alive at the last step, and everyone who has been. */
  aliveCount = 0;
  readonly seen: Record<string, boolean> = {};
  private alive: number[] = [];
  private pending: ModeEvent[] = [];

  constructor(
    start: Circle,
    private readonly rand: () => number = Math.random,
  ) {
    super(Infinity, Infinity);
    this.circle = { ...start };
    this.next = { ...start };
    this.from = { ...start };
  }

  /** Health a second lost at (x, z) now (0 inside the circle or during the grace). */
  dpsAt(x: number, z: number): number {
    if (this.ended || this.clock < LAST_STAND.grace) return 0;
    const out = Math.hypot(x - this.circle.x, z - this.circle.z) > this.circle.r;
    return out ? LAST_STAND.dps[Math.min(this.stage, LAST_STAND.dps.length - 1)]! : 0;
  }

  override observe(list: readonly Presence[]): ModeEvent[] {
    super.observe(list);
    const out: ModeEvent[] = [];
    this.alive = [];
    for (const s of list) {
      if (!s.alive) continue;
      this.alive.push(s.id);
      this.seen[s.id] = true;
      for (const c of this.crates) {
        if (c.taken || (s.feet.x - c.x) ** 2 + (s.feet.z - c.z) ** 2 > LAST_STAND.reach ** 2 || Math.abs(s.feet.y - c.y) > 2) continue;
        c.taken = true;
        this.armed[s.id] = c.weapon;
        out.push({ type: 'loot', id: c.id, by: s.id, weapon: c.weapon });
      }
    }
    this.aliveCount = this.alive.length;
    return out;
  }

  override onDown(_team: Team, victimId?: number, attackerId?: number): void {
    if (attackerId === undefined || attackerId === victimId || attackerId < 0) return;
    this.award(attackerId, 1);
  }

  /** Nobody wins by points: the last one alive does. */
  protected override judge(): void {
    if (this.ended || this.clock < 5) return;
    const everyone = Object.keys(this.seen).length;
    if (everyone < 2) return;
    if (this.alive.length === 1) this.endSolo(this.alive[0]!, 'survived');
    else if (this.alive.length === 0) {
      const best = this.standings().find((s) => this.seen[s.id]);
      if (best) this.endSolo(best.id, 'survived');
    }
  }

  override step(dt: number): ModeEvent[] {
    if (this.ended) return [];
    const out = this.pending;
    this.pending = [];
    this.clock += dt;
    this.phaseLeft -= dt;
    const L = LAST_STAND;
    if (this.phase === 'wait' && this.phaseLeft <= 0 && this.circle.r > L.minR + 0.5) {
      // A new, smaller circle somewhere inside this one.
      const r = Math.max(L.minR, this.circle.r * L.factor);
      const a = this.rand() * Math.PI * 2;
      const d = Math.sqrt(this.rand()) * Math.max(0, this.circle.r - r);
      Object.assign(this.from, this.circle);
      Object.assign(this.next, { x: this.circle.x + Math.cos(a) * d, z: this.circle.z + Math.sin(a) * d, r });
      this.phase = 'shrink';
      this.phaseLeft = L.shrink[Math.min(this.stage, L.shrink.length - 1)]!;
      out.push({ type: 'shrink', stage: this.stage + 1, x: this.next.x, z: this.next.z, r });
    } else if (this.phase === 'shrink') {
      const total = L.shrink[Math.min(this.stage, L.shrink.length - 1)]!;
      const f = Math.min(1, 1 - this.phaseLeft / total);
      this.circle.x = this.from.x + (this.next.x - this.from.x) * f;
      this.circle.z = this.from.z + (this.next.z - this.from.z) * f;
      this.circle.r = this.from.r + (this.next.r - this.from.r) * f;
      if (this.phaseLeft <= 0) {
        this.stage++;
        this.phase = 'wait';
        this.phaseLeft = L.wait[Math.min(this.stage, L.wait.length - 1)]!;
      }
    }
    this.judge();
    return out;
  }
}

// ---------------------------------------------------------------------------
// Charges: Rush and Search & Destroy (owner, 2026-10-12)

/** A charge spot: attackers plant at it (hold E), defenders defuse it once armed. */
export interface Charge {
  /** 'A1', 'A2' (Rush: two per zone) or the site's zone id (S&D). */
  id: string;
  /** The zone it stands in. */
  zone: string;
  x: number;
  y: number;
  z: number;
  state: 'idle' | 'armed' | 'gone';
  /** Seconds of planting (idle) or defusing (armed) done by `by`. */
  work: number;
  /** Combatant working it, -1 for nobody. */
  by: number;
  /** Armed: seconds until it goes off. */
  fuse: number;
  /** Open to work now. */
  live: boolean;
}

export interface ChargeTimes {
  plant: number;
  defuse: number;
  fuse: number;
  /** How close (m, flat) and how far up or down (2.5 m) a soldier works it from. */
  reach: number;
}

export function newCharge(id: string, zone: string, x: number, y: number, z: number): Charge {
  return { id, zone, x, y, z, state: 'idle', work: 0, by: -1, fuse: 0, live: false };
}

/**
 * Planting and defusing for one step: at each live charge the nearest soldier
 * holding E who may work it (attackers an idle charge, defenders an armed one)
 * works it; someone else taking over starts from nothing, letting go loses it.
 * `defused` / `blown`: what to do then (Rush: a defused charge can be planted
 * again, a blown one is gone).
 */
export function workCharges(charges: Charge[], list: readonly Presence[], attacker: Team, dt: number, c: ChargeTimes, out: ModeEvent[]): void {
  const r2 = c.reach * c.reach;
  for (const ch of charges) {
    if (ch.state === 'gone' || !ch.live) {
      ch.work = 0;
      ch.by = -1;
      continue;
    }
    if (ch.state === 'armed') {
      ch.fuse -= dt;
      if (ch.fuse <= 0) {
        ch.state = 'gone';
        ch.work = 0;
        ch.by = -1;
        out.push({ type: 'charge', id: ch.id, zone: ch.zone, state: 'blown', team: attacker, by: -1 });
        continue;
      }
    }
    const want = ch.state === 'idle' ? attacker : other(attacker);
    let worker: Presence | null = null;
    let best = r2;
    for (const s of list) {
      if (!s.alive || !s.using || s.team !== want || Math.abs(s.feet.y - ch.y) > 2.5) continue;
      const d = (s.feet.x - ch.x) ** 2 + (s.feet.z - ch.z) ** 2;
      if (d < best) {
        best = d;
        worker = s;
      }
    }
    if (!worker) {
      ch.work = 0;
      ch.by = -1;
      continue;
    }
    if (worker.id !== ch.by) {
      ch.by = worker.id;
      ch.work = 0;
    }
    ch.work += dt;
    if (ch.state === 'idle' && ch.work >= c.plant) {
      ch.state = 'armed';
      ch.fuse = c.fuse;
      ch.work = 0;
      ch.by = -1;
      out.push({ type: 'charge', id: ch.id, zone: ch.zone, state: 'armed', team: attacker, by: worker.id });
    } else if (ch.state === 'armed' && ch.work >= c.defuse) {
      ch.state = 'idle';
      ch.work = 0;
      ch.by = -1;
      out.push({ type: 'charge', id: ch.id, zone: ch.zone, state: 'defused', team: other(attacker), by: worker.id });
    }
  }
}

/** Modes played over charges (bots plant and defuse; the HUD and the charge models read them). */
export abstract class ChargeRules extends MatchRules {
  readonly charges: Charge[] = [];
  abstract readonly attacker: Team;
  abstract readonly times: ChargeTimes;

  get defender(): Team {
    return other(this.attacker);
  }

  /** The charge `id` is working on now, if any (hands busy, the prompt's progress). */
  workOf(id: number): Charge | null {
    return this.charges.find((c) => c.by === id) ?? null;
  }

  /** Charges in play (live and not gone). */
  liveCharges(): Charge[] {
    return this.charges.filter((c) => c.live && c.state !== 'gone');
  }
}

/**
 * Rush [제안]: one sector at a time, each a zone with two charges about a
 * third of its radius out to either side of the line of attack. The attackers
 * have tickets (`perSoldier` x their side, `refillPerSoldier` more each
 * sector); a charge armed (`plant` s) goes off after `fuse` s unless the
 * defenders defuse it (`defuse` s); both gone, the next sector opens. Out
 * of tickets with no charge armed, the defenders win; every sector taken,
 * the attackers do. The first sector opens after `setup` s.
 */
export const RUSH = { perSoldier: 3, refillPerSoldier: 2, plant: 4, defuse: 6, fuse: 30, reach: 2.2, setup: 15 };

export interface RushOptions {
  attacker: Team;
  /** Zone ids per sector, in attack order. */
  sectors: readonly (readonly string[])[];
  charges: Charge[];
  tickets: number;
  refill: number;
  setup?: number;
}

export class RushRules extends ChargeRules {
  readonly kind = 'rush';
  readonly attacker: Team;
  readonly sectors: string[][];
  readonly times: ChargeTimes = { plant: RUSH.plant, defuse: RUSH.defuse, fuse: RUSH.fuse, reach: RUSH.reach };
  /** The sector under attack (= sectors taken so far). */
  active = 0;
  setupLeft: number;
  private readonly refill: number;

  constructor(opts: RushOptions) {
    super();
    this.attacker = opts.attacker;
    this.sectors = opts.sectors.map((s) => [...s]);
    this.charges.push(...opts.charges);
    this.tickets[this.attacker] = opts.tickets;
    this.refill = opts.refill;
    this.setupLeft = opts.setup ?? RUSH.setup;
  }

  private sectorOf(zone: string): number {
    return this.sectors.findIndex((s) => s.includes(zone));
  }

  start(zr: ZoneRules): void {
    this.show(zr);
  }

  /** Taken sectors the attackers', the rest the defenders'; the active one's charges live once the setup is over. */
  private show(zr: ZoneRules): void {
    for (const z of zr.zones) {
      const i = this.sectorOf(z.id);
      z.locked = true;
      z.noCapture = true;
      z.hidden = i < 0;
      const left = this.charges.some((c) => c.zone === z.id && c.state !== 'gone');
      ZoneRules.force(z, i < this.active || (i === this.active && !left) ? this.attacker : this.defender);
      z.pushing = this.charges.some((c) => c.zone === z.id && c.state === 'armed') ? this.attacker : null;
    }
    for (const c of this.charges) c.live = !this.ended && this.setupLeft <= 0 && this.sectorOf(c.zone) === this.active;
  }

  step(dt: number, zr: ZoneRules): ModeEvent[] {
    if (this.ended) return [];
    const out: ModeEvent[] = [];
    if (this.setupLeft > 0) {
      this.setupLeft = Math.max(0, this.setupLeft - dt);
      if (this.setupLeft === 0) out.push({ type: 'attack', attacker: this.attacker, reason: 'opening' });
    }
    this.show(zr);
    workCharges(this.charges, this.present, this.attacker, dt, this.times, out);
    const ids = this.sectors[this.active] ?? [];
    if (this.setupLeft <= 0 && this.charges.filter((c) => ids.includes(c.zone)).every((c) => c.state === 'gone')) {
      out.push({ type: 'sector', team: this.attacker, sector: this.active });
      this.active++;
      if (this.active >= this.sectors.length) this.end(this.attacker, 'sectors');
      else {
        this.tickets[this.attacker] = (this.tickets[this.attacker] ?? 0) + this.refill;
        out.push({ type: 'refill', team: this.attacker, tickets: this.refill });
        out.push({ type: 'attack', attacker: this.attacker, reason: 'captured' });
      }
    }
    // Out of tickets: lost, unless a charge is still ticking.
    if (!this.ended && (this.tickets[this.attacker] ?? 0) <= 0 && !this.charges.some((c) => c.state === 'armed')) this.end(this.defender, 'tickets');
    this.show(zr);
    return out;
  }

  private present: readonly Presence[] = [];

  override observe(list: readonly Presence[]): ModeEvent[] {
    this.present = list;
    return [];
  }

  /** Tickets run down without ending the match here (a charge may still be ticking: `step` decides). */
  override onDeath(team: Team): void {
    const t = this.tickets[team];
    if (this.ended || t === null) return;
    this.tickets[team] = Math.max(0, t - 1);
  }

  override focus(): readonly string[] {
    return this.sectors[this.active] ?? [];
  }

  override spawnZones(team: Team): string[] {
    return this.sectors.filter((_, i) => (team === this.attacker ? i < this.active : i > this.active)).flat();
  }

  order(team: Team): string[] {
    const ids = this.sectors.flat();
    return team === this.attacker ? ids : ids.reverse();
  }
}

/**
 * Search & destroy [제안]: rounds with one life each, no reviving. The
 * attackers plant at either of two sites (`plant` s); armed, the bomb goes
 * off after `fuse` s unless defused (`defuse` s). A round is won by the
 * attackers when it goes off or every defender is down; by the defenders
 * when it is defused, every attacker is down with nothing armed, or the
 * round clock (`roundTime` s, stopped once armed) runs out. `pre` s to get
 * ready (nothing can be planted), `post` s to see who won. Sides swap roles
 * after `half` rounds; first to `win` rounds wins. Sites: the two zones
 * deepest in the defenders' half (they change with the swap).
 */
export const SND = { win: 4, half: 3, roundTime: 150, pre: 8, post: 6, plant: 4, defuse: 7, fuse: 40, reach: 2.2 };

/** Where each half is played: the sites (charges to copy) and where each side starts a round. */
export interface SndHalf {
  attacker: Team;
  sites: Charge[];
  attackerStart: { x: number; y: number; z: number };
  defenderStart: { x: number; y: number; z: number };
}

export class SearchDestroyRules extends ChargeRules {
  readonly kind = 'snd';
  readonly times: ChargeTimes = { plant: SND.plant, defuse: SND.defuse, fuse: SND.fuse, reach: SND.reach };
  readonly halves: SndHalf[];
  attacker: Team;
  round = 1;
  phase: 'pre' | 'live' | 'post' = 'pre';
  /** Seconds left in this phase (live: the round clock, stopped while a charge is armed). */
  phaseLeft: number = SND.pre;
  readonly wins: Record<Team, number> = { blue: 0, red: 0 };
  /** The last round's result. */
  last: { winner: Team; why: 'eliminated' | 'blown' | 'defused' | 'time' } | null = null;
  /** Living soldiers a side at the last step. */
  readonly alive: Record<Team, number> = { blue: 0, red: 0 };

  constructor(halves: SndHalf[]) {
    super();
    this.halves = halves;
    this.attacker = halves[0]!.attacker;
    this.setHalf();
  }

  /** The half being played now. */
  get half(): SndHalf {
    return this.halves[this.round > SND.half ? 1 : 0] ?? this.halves[0]!;
  }

  private setHalf(): void {
    const h = this.half;
    this.attacker = h.attacker;
    this.charges.length = 0;
    for (const s of h.sites) this.charges.push({ ...s, state: 'idle', work: 0, by: -1, fuse: 0, live: false });
  }

  start(zr: ZoneRules): void {
    this.show(zr);
  }

  private show(zr: ZoneRules): void {
    const sites = this.charges.map((c) => c.zone);
    for (const z of zr.zones) {
      z.locked = true;
      z.noCapture = true;
      z.hidden = !sites.includes(z.id);
      const c = this.charges.find((x) => x.zone === z.id);
      ZoneRules.force(z, c && c.state === 'gone' ? this.attacker : this.defender);
      z.pushing = c?.state === 'armed' ? this.attacker : null;
    }
    for (const c of this.charges) c.live = this.phase === 'live' && !this.ended;
  }

  override observe(list: readonly Presence[]): ModeEvent[] {
    this.present = list;
    this.alive.blue = this.alive.red = 0;
    for (const s of list) if (s.alive) this.alive[s.team]++;
    return [];
  }

  private present: readonly Presence[] = [];

  step(dt: number, zr: ZoneRules): ModeEvent[] {
    if (this.ended) return [];
    const out: ModeEvent[] = [];
    if (this.phase === 'pre') {
      this.phaseLeft -= dt;
      if (this.phaseLeft <= 0) {
        this.phase = 'live';
        this.phaseLeft = SND.roundTime;
      }
    } else if (this.phase === 'live') {
      workCharges(this.charges, this.present, this.attacker, dt, this.times, out);
      const armed = this.charges.some((c) => c.state === 'armed');
      if (!armed) this.phaseLeft -= dt;
      const def = this.defender;
      let won: { winner: Team; why: 'eliminated' | 'blown' | 'defused' | 'time' } | null = null;
      for (const e of out) {
        if (e.type !== 'charge') continue;
        if (e.state === 'blown') won = { winner: this.attacker, why: 'blown' };
        else if (e.state === 'defused') won = { winner: def, why: 'defused' };
      }
      if (!won && this.alive[def] === 0) won = { winner: this.attacker, why: 'eliminated' };
      else if (!won && this.alive[this.attacker] === 0 && !armed) won = { winner: def, why: 'eliminated' };
      else if (!won && this.phaseLeft <= 0) won = { winner: def, why: 'time' };
      if (won) {
        this.wins[won.winner]++;
        this.last = won;
        out.push({ type: 'roundEnd', n: this.round, winner: won.winner, why: won.why });
        if (this.wins[won.winner] >= SND.win) this.end(won.winner, 'rounds');
        this.phase = 'post';
        this.phaseLeft = SND.post;
        for (const c of this.charges) if (c.state === 'armed') c.state = 'idle';
      }
    } else {
      this.phaseLeft -= dt;
      if (this.phaseLeft <= 0) {
        this.round++;
        this.setHalf();
        this.phase = 'pre';
        this.phaseLeft = SND.pre;
        out.push({ type: 'round', n: this.round, attacker: this.attacker });
      }
    }
    this.show(zr);
    return out;
  }

  /** No tickets: deaths only matter for who is left this round. */
  override onDeath(): void {}

  override focus(): readonly string[] {
    return this.charges.map((c) => c.zone);
  }

  override spawnZones(): string[] {
    return [];
  }

  order(team: Team): string[] {
    void team;
    return this.charges.map((c) => c.zone);
  }
}

/** The line of attack: the attackers' base toward the defenders' (unit, xz). */
function axis(att: { x: number; z: number }, def: { x: number; z: number }): { ux: number; uz: number } {
  const dx = def.x - att.x;
  const dz = def.z - att.z;
  const l = Math.hypot(dx, dz) || 1;
  return { ux: dx / l, uz: dz / l };
}

/**
 * Rush's sectors and charges for a map: the map's own sectors in attack order
 * when it has them (`sectors`), else a zone a sector along the line of attack.
 * Two charges in a one-zone sector (a third of its radius out to either side
 * of the line), one in the middle of each zone of a bigger one.
 */
export function rushPlan(
  zones: readonly { id: string; x: number; y: number; z: number; radius: number }[],
  att: { x: number; z: number },
  def: { x: number; z: number },
  sectors?: readonly (readonly string[])[],
): { sectors: string[][]; charges: Charge[] } {
  const { ux, uz } = axis(att, def);
  const known = (id: string) => zones.some((z) => z.id === id);
  const list = sectors?.length
    ? sectors.map((s) => s.filter(known)).filter((s) => s.length > 0)
    : [...zones].sort((a, b) => (a.x - att.x) * ux + (a.z - att.z) * uz - ((b.x - att.x) * ux + (b.z - att.z) * uz)).map((z) => [z.id]);
  const charges: Charge[] = [];
  for (const sector of list) {
    for (const id of sector) {
      const z = zones.find((q) => q.id === id)!;
      if (sector.length > 1) {
        charges.push(newCharge(id, id, z.x, z.y, z.z));
        continue;
      }
      const off = Math.min(18, Math.max(6, z.radius * 0.45));
      charges.push(newCharge(`${id}1`, id, z.x - uz * off, z.y, z.z + ux * off), newCharge(`${id}2`, id, z.x + uz * off, z.y, z.z - ux * off));
    }
  }
  return { sectors: list.map((s) => [...s]), charges };
}

/**
 * S&D's halves for a map: the two zones deepest in the defenders' half are
 * the sites; the defenders start between them, the attackers at the zone (or
 * their base) nearest `SND_START` m from the sites.
 */
export const SND_START = 90;

export function sndHalves(zones: readonly { id: string; x: number; y: number; z: number }[], bases: Record<Team, { x: number; y: number; z: number }>, first: Team): SndHalf[] {
  const half = (attacker: Team): SndHalf => {
    const def = other(attacker);
    const lean = (z: { x: number; z: number }) => Math.hypot(z.x - bases[def].x, z.z - bases[def].z) - Math.hypot(z.x - bases[attacker].x, z.z - bases[attacker].z);
    const sites = [...zones].sort((a, b) => lean(a) - lean(b)).slice(0, Math.min(2, zones.length));
    const mid = { x: sites.reduce((a, s) => a + s.x, 0) / sites.length, y: sites.reduce((a, s) => a + s.y, 0) / sites.length, z: sites.reduce((a, s) => a + s.z, 0) / sites.length };
    const near = (p: { x: number; z: number }) => Math.min(...sites.map((s) => Math.hypot(s.x - p.x, s.z - p.z)));
    const cands = [...zones.filter((z) => !sites.includes(z)), bases[attacker]];
    let start = bases[attacker];
    let best = Infinity;
    for (const c of cands) {
      const d = near(c);
      // Not right on a site, and on the attackers' side of them.
      if (d < 45 || lean(c) < lean(mid)) continue;
      const score = Math.abs(d - SND_START);
      if (score < best) {
        best = score;
        start = c;
      }
    }
    return { attacker, sites: sites.map((s) => newCharge(s.id, s.id, s.x, s.y, s.z)), attackerStart: { x: start.x, y: start.y, z: start.z }, defenderStart: mid };
  };
  return [half(first), half(other(first))];
}

// ---------------------------------------------------------------------------
// Escort and fortress (owner, 2026-10-12)

/**
 * Escort [제안]: the attackers move a payload (an APC) along a route from
 * near their base through the zones in attack order (checkpoints) to the
 * last one. It rolls at `speed` m/s (+ `extra` for each attacker more than
 * the defenders within `reach` m, up to `maxSpeed`) while the attackers there
 * outnumber the defenders, and stands still otherwise. The attackers have
 * `start` s to the first checkpoint, each adds `perCheckpoint` s; the last
 * one wins, out of time loses. It starts `lead` m of road before the first
 * checkpoint, after `setup` s.
 */
export const ESCORT = { speed: 1.6, extra: 0.25, maxSpeed: 2.6, reach: 10, start: 300, perCheckpoint: 180, setup: 15, lead: 90 };

export interface EscortOptions {
  attacker: Team;
  /** Zone ids in the order the payload passes them; the last is the goal. */
  checkpoints: string[];
  /** The route as corner points (x, y, z), from the start to the last checkpoint. */
  route: [number, number, number][];
  /** Distance along the route of each checkpoint. */
  at: number[];
}

export class EscortRules extends MatchRules {
  readonly kind = 'escort';
  readonly attacker: Team;
  checkpoints: string[];
  route: [number, number, number][];
  at: number[];
  /** Metres along the route. */
  progress = 0;
  /** Checkpoints passed. */
  passed = 0;
  timeLeft: number = ESCORT.start;
  setupLeft: number = ESCORT.setup;
  /** Moving this step / both sides at it with the attackers not ahead. */
  moving = false;
  contested = false;
  /** Where the payload is (and which way it faces, yaw 0 = -z). */
  readonly pos = { x: 0, y: 0, z: 0 };
  yaw = 0;
  private present: readonly Presence[] = [];

  constructor(opts: EscortOptions) {
    super();
    this.attacker = opts.attacker;
    this.checkpoints = [...opts.checkpoints];
    this.route = opts.route.map((p) => [...p] as [number, number, number]);
    this.at = [...opts.at];
    this.place();
  }

  get defender(): Team {
    return other(this.attacker);
  }

  get length(): number {
    return this.at[this.at.length - 1] ?? 0;
  }

  /** A new route (on the navmesh): checkpoints keep their order, progress starts over. */
  setRoute(route: [number, number, number][], at: number[]): void {
    this.route = route;
    this.at = at;
    this.progress = 0;
    this.place();
  }

  /** The payload's place and heading at `progress` along the route. */
  private place(): void {
    const r = this.route;
    let left = this.progress;
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1]!;
      const b = r[i]!;
      const seg = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (left <= seg || i === r.length - 1) {
        const f = seg > 0 ? Math.min(1, left / seg) : 0;
        this.pos.x = a[0] + (b[0] - a[0]) * f;
        this.pos.y = a[1] + (b[1] - a[1]) * f;
        this.pos.z = a[2] + (b[2] - a[2]) * f;
        if (seg > 0.01) this.yaw = Math.atan2(-(b[0] - a[0]), -(b[2] - a[2]));
        return;
      }
      left -= seg;
    }
    if (r[0]) [this.pos.x, this.pos.y, this.pos.z] = r[0];
  }

  start(zr: ZoneRules): void {
    this.show(zr);
  }

  private show(zr: ZoneRules): void {
    for (const z of zr.zones) {
      const i = this.checkpoints.indexOf(z.id);
      z.locked = true;
      z.noCapture = true;
      z.hidden = i < 0;
      ZoneRules.force(z, i >= 0 && i < this.passed ? this.attacker : this.defender);
      z.pushing = i === this.passed && this.moving ? this.attacker : null;
      z.contested = i === this.passed && this.contested;
    }
  }

  override observe(list: readonly Presence[]): ModeEvent[] {
    this.present = list;
    return [];
  }

  /** Living soldiers of each side within reach of the payload. */
  near(): Record<Team, number> {
    const out = { blue: 0, red: 0 };
    const r2 = ESCORT.reach * ESCORT.reach;
    for (const s of this.present) if (s.alive && (s.feet.x - this.pos.x) ** 2 + (s.feet.z - this.pos.z) ** 2 < r2 && Math.abs(s.feet.y - this.pos.y) < 5) out[s.team]++;
    return out;
  }

  step(dt: number, zr: ZoneRules): ModeEvent[] {
    if (this.ended) return [];
    const out: ModeEvent[] = [];
    if (this.setupLeft > 0) {
      this.setupLeft = Math.max(0, this.setupLeft - dt);
      if (this.setupLeft === 0) out.push({ type: 'attack', attacker: this.attacker, reason: 'opening' });
      this.show(zr);
      return out;
    }
    const n = this.near();
    const a = n[this.attacker];
    const d = n[this.defender];
    this.moving = a > d;
    this.contested = a > 0 && d > 0 && !this.moving;
    if (this.moving) {
      const speed = Math.min(ESCORT.maxSpeed, ESCORT.speed + ESCORT.extra * (a - d - 1));
      this.progress = Math.min(this.length, this.progress + speed * dt);
      this.place();
    }
    while (this.passed < this.at.length && this.progress >= this.at[this.passed]! - 0.01) {
      const last = this.passed === this.at.length - 1;
      this.passed++;
      const bonus = last ? 0 : ESCORT.perCheckpoint;
      this.timeLeft += bonus;
      out.push({ type: 'checkpoint', zone: this.checkpoints[this.passed - 1]!, n: this.passed, bonus });
      if (last) this.end(this.attacker, 'delivered');
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (!this.ended && this.timeLeft <= 0) this.end(this.defender, 'time');
    this.show(zr);
    return out;
  }

  override focus(): readonly string[] {
    const z = this.checkpoints[this.passed];
    return z ? [z] : [];
  }

  /** Attackers spawn at checkpoints passed, defenders at the ones still ahead (not the next). */
  override spawnZones(team: Team): string[] {
    return this.checkpoints.filter((_, i) => (team === this.attacker ? i < this.passed : i > this.passed));
  }

  order(team: Team): string[] {
    return team === this.attacker ? [...this.checkpoints] : [...this.checkpoints].reverse();
  }
}

/** Corner points through `points` (straight lines), with the distance along it of each point after the first. */
export function polyline(points: readonly [number, number, number][]): { route: [number, number, number][]; at: number[] } {
  const route = points.map((p) => [...p] as [number, number, number]);
  const at: number[] = [];
  let d = 0;
  for (let i = 1; i < route.length; i++) {
    d += Math.hypot(route[i]![0] - route[i - 1]![0], route[i]![2] - route[i - 1]![2]);
    at.push(d);
  }
  return { route, at };
}

/**
 * Fortress [제안]: `build` s of building first (a truce: nobody can hurt
 * anybody, building goes `boost` x as fast, each side's half of the zones is
 * already its own, the middle neutral), then zone domination: a point per
 * held zone every `tick` s, first to `target` or ahead after `time` s.
 */
export const FORTRESS = { build: 90, boost: 3, target: 300, time: 720, tick: 5 };

export class FortressRules extends PointsRules {
  readonly kind = 'fortress';
  buildLeft: number = FORTRESS.build;
  private tickTime = 0;

  constructor(
    /** Each zone's first owner (null: neutral). */
    private readonly firstOwner: Record<string, Team | null>,
    target: number = FORTRESS.target,
    time: number = FORTRESS.time,
  ) {
    super(target, time);
  }

  get building(): boolean {
    return this.buildLeft > 0;
  }

  start(zr: ZoneRules): void {
    for (const z of zr.zones) {
      ZoneRules.force(z, this.firstOwner[z.id] ?? null);
      z.locked = true;
    }
  }

  step(dt: number, zr: ZoneRules): ModeEvent[] {
    if (this.ended) return [];
    if (this.buildLeft > 0) {
      this.buildLeft = Math.max(0, this.buildLeft - dt);
      if (this.buildLeft > 0) return [];
      for (const z of zr.zones) z.locked = false;
      return [{ type: 'built' }];
    }
    this.tickTime += dt;
    while (this.tickTime >= FORTRESS.tick) {
      this.tickTime -= FORTRESS.tick;
      for (const t of ['blue', 'red'] as const) this.points[t] = Math.min(this.target, this.points[t] + zr.owned(t).length);
      this.judge();
    }
    this.tickClock(dt);
    return [];
  }

  order(): string[] {
    return [];
  }
}

/** Each side's half of the zones (nearer its base by more than `margin` m); the rest neutral. */
export function halfOwners(zones: readonly { id: string; x: number; z: number }[], bases: Record<Team, { x: number; z: number }>, margin = 15): Record<string, Team | null> {
  const out: Record<string, Team | null> = {};
  for (const z of zones) {
    const lean = Math.hypot(z.x - bases.blue.x, z.z - bases.blue.z) - Math.hypot(z.x - bases.red.x, z.z - bases.red.z);
    out[z.id] = lean < -margin ? 'blue' : lean > margin ? 'red' : null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sectors (frontline, conquest)

abstract class SectorRules extends MatchRules {
  constructor(readonly sectors: readonly (readonly string[])[]) {
    super();
  }

  override focus(): readonly string[] | null {
    return this.sectors[this.activeSector()] ?? [];
  }

  protected abstract activeSector(): number;

  protected zonesOf(i: number, zr: ZoneRules): ZoneState[] {
    const ids = this.sectors[i] ?? [];
    return zr.zones.filter((z) => ids.includes(z.id));
  }

  /** The team holding every zone of sector `i`, or null. */
  protected holder(i: number, zr: ZoneRules): Team | null {
    const list = this.zonesOf(i, zr);
    const first = list[0]?.owner ?? null;
    return first && list.every((z) => z.owner === first) ? first : null;
  }

  /** Only `active` can be taken; every other zone keeps the owner `ownerOf` gives it. */
  protected lock(zr: ZoneRules, active: number | null, ownerOf: (sector: number) => Team | null): void {
    for (const z of zr.zones) {
      const i = this.sectors.findIndex((s) => s.includes(z.id));
      z.locked = i !== active;
      if (z.locked) ZoneRules.force(z, i >= 0 ? ownerOf(i) : null);
    }
  }
}

/**
 * Frontline numbers [제안]: attack timer `attackTime` s (most `maxTime`, cuts
 * never below `floor`), match clock `matchTime` s; a neutral middle goes to
 * the side holding more of it after `openingTime` s (on Ardennes nobody held
 * all three river zones in 7 minutes of bot play). Every `window` s the fight
 * is weighed (capture progress and who went down more): going the attackers'
 * way adds `gain` s, the defenders' way takes `cut` s, both random in the
 * range; a zone the attackers take inside a bigger sector adds `zoneBonus` s.
 */
export const FRONTLINE = {
  openingTime: 180,
  attackTime: 240,
  maxTime: 420,
  floor: 15,
  matchTime: 1500,
  window: [20, 35] as const,
  gain: [15, 40] as const,
  cut: [10, 30] as const,
  zoneBonus: [30, 60] as const,
  /** Flow beyond ± this changes the timer. */
  threshold: 0.3,
};

export interface FrontlineOptions {
  /** Sectors of zone ids, the blue end first. */
  sectors: readonly (readonly string[])[];
  tickets: Record<Team, number>;
  /** Soldiers a side (the down count is weighed against it). */
  teamSize: number;
  attackTime?: number;
  matchTime?: number;
  rand?: () => number;
}

export class FrontlineRules extends SectorRules {
  readonly kind = 'frontline';
  /** Who holds each sector (null: the neutral middle at the start). */
  readonly held: (Team | null)[];
  /** The attacking side, or null during the opening (both go for the middle). */
  attacker: Team | null = null;
  /** The sector being fought over. */
  active: number;
  /** Attack timer (s); during the opening, the opening's. */
  timeLeft: number = FRONTLINE.openingTime;
  /** Match clock (s). */
  clock: number;
  readonly attackTime: number;
  private readonly teamSize: number;
  private readonly rand: () => number;
  private windowLeft = 0;
  private progress = 0;
  private readonly downs: Record<Team, number> = { blue: 0, red: 0 };
  private readonly lastControl = new Map<string, number>();

  constructor(opts: FrontlineOptions) {
    super(opts.sectors);
    this.tickets.blue = opts.tickets.blue;
    this.tickets.red = opts.tickets.red;
    this.teamSize = Math.max(1, opts.teamSize);
    this.attackTime = opts.attackTime ?? FRONTLINE.attackTime;
    this.clock = opts.matchTime ?? FRONTLINE.matchTime;
    this.rand = opts.rand ?? Math.random;
    const n = this.sectors.length;
    const mid = (n - 1) / 2;
    this.held = this.sectors.map((_, i) => (i < mid ? 'blue' : i > mid ? 'red' : null));
    if (n % 2 === 1) this.active = mid;
    else {
      // No middle sector: a coin decides who attacks first.
      this.attacker = this.rand() < 0.5 ? 'blue' : 'red';
      this.active = this.frontOf(other(this.attacker));
      this.timeLeft = this.attackTime;
    }
  }

  get defender(): Team | null {
    return this.attacker && other(this.attacker);
  }

  protected activeSector(): number {
    return this.active;
  }

  start(zr: ZoneRules): void {
    this.lock(zr, this.active, (i) => this.held[i] ?? null);
    for (const z of this.zonesOf(this.active, zr)) ZoneRules.force(z, this.held[this.active] ?? null);
    this.resetFlow(zr);
  }

  step(dt: number, zr: ZoneRules, events: readonly ZoneEvent[]): ModeEvent[] {
    if (this.ended) return [];
    const out: ModeEvent[] = [];
    this.clock = Math.max(0, this.clock - dt);
    const att = this.attacker;
    if (att === null) {
      // The opening: whoever holds the whole middle sector first defends it;
      // out of time, whoever holds more of it (a tie plays on).
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      let h = this.holder(this.active, zr);
      if (!h && this.timeLeft <= 0) h = this.majority(this.active, zr);
      if (h) {
        for (const z of this.zonesOf(this.active, zr)) ZoneRules.force(z, h);
        this.held[this.active] = h;
        this.beginAttack(other(h), zr);
        out.push({ type: 'attack', attacker: other(h), reason: 'opening' });
      }
    } else if (this.holder(this.active, zr) === att) {
      // Taken: the side that lost it attacks it now (or loses, with nothing left).
      const def = other(att);
      this.held[this.active] = att;
      out.push({ type: 'sector', team: att, sector: this.active });
      if (!this.held.includes(def)) this.end(att, 'front');
      else {
        this.beginAttack(def, zr);
        out.push({ type: 'attack', attacker: def, reason: 'captured' });
      }
    } else {
      this.weigh(dt, zr, events, att, out);
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        // Held: the sector goes back to the defenders whole, and they attack the next one.
        const def = other(att);
        for (const z of this.zonesOf(this.active, zr)) ZoneRules.force(z, def);
        this.active = this.frontOf(att);
        this.beginAttack(def, zr);
        out.push({ type: 'attack', attacker: def, reason: 'held' });
      }
    }
    if (!this.ended && this.clock <= 0) this.end(this.judge(zr), 'time');
    this.lock(zr, this.active, (i) => this.held[i] ?? null);
    return out;
  }

  override onDown(team: Team): void {
    this.downs[team]++;
  }

  order(team: Team): string[] {
    const ids = this.sectors.flat();
    return team === 'blue' ? ids : ids.reverse();
  }

  /** The side holding more of sector `i`'s zones, or null on a tie. */
  private majority(i: number, zr: ZoneRules): Team | null {
    const zones = this.zonesOf(i, zr);
    const b = zones.filter((z) => z.owner === 'blue').length;
    const r = zones.filter((z) => z.owner === 'red').length;
    return b === r ? null : b > r ? 'blue' : 'red';
  }

  /** The sector of `team`'s nearest the other side. */
  private frontOf(team: Team): number {
    if (team === 'blue') return this.held.lastIndexOf('blue');
    return this.held.indexOf('red');
  }

  private beginAttack(attacker: Team, zr: ZoneRules): void {
    this.attacker = attacker;
    this.timeLeft = this.attackTime;
    this.resetFlow(zr);
  }

  private resetFlow(zr: ZoneRules): void {
    this.windowLeft = this.between(FRONTLINE.window);
    this.progress = 0;
    this.downs.blue = this.downs.red = 0;
    this.lastControl.clear();
    for (const z of this.zonesOf(this.active, zr)) this.lastControl.set(z.id, z.control);
  }

  /**
   * How the attack is going: capture progress (toward the attackers, a full
   * neutralize = 1 per zone) and the down count. Every window it moves the
   * timer by a random amount one way or the other.
   */
  private weigh(dt: number, zr: ZoneRules, events: readonly ZoneEvent[], att: Team, out: ModeEvent[]): void {
    const zones = this.zonesOf(this.active, zr);
    for (const z of zones) {
      const before = this.lastControl.get(z.id) ?? z.control;
      this.progress += (z.control - before) * SIGN[att];
      this.lastControl.set(z.id, z.control);
    }
    // A zone of a bigger sector neutralized or taken by the attackers: more time at once.
    for (const e of events) {
      if (!zones.some((z) => z.id === e.zone)) continue;
      const theirs = e.type === 'captured' ? e.team === att : e.team !== att;
      if (theirs) this.shift(this.between(FRONTLINE.zoneBonus) * (e.type === 'captured' ? 0.5 : 1), att, out);
    }
    this.windowLeft -= dt;
    if (this.windowLeft > 0) return;
    const def = other(att);
    const flow = (this.progress / Math.max(1, zones.length)) * 1.5 + (this.downs[def] - this.downs[att]) / Math.max(3, this.teamSize * 0.5);
    if (flow > FRONTLINE.threshold) this.shift(this.between(FRONTLINE.gain), att, out);
    else if (flow < -FRONTLINE.threshold) this.shift(-this.between(FRONTLINE.cut), att, out);
    this.windowLeft = this.between(FRONTLINE.window);
    this.progress = 0;
    this.downs.blue = this.downs.red = 0;
  }

  private shift(delta: number, att: Team, out: ModeEvent[]): void {
    const before = this.timeLeft;
    const after = delta > 0 ? Math.min(FRONTLINE.maxTime, before + delta) : Math.max(Math.min(before, FRONTLINE.floor), before + delta);
    const d = Math.round(after - before);
    if (d === 0) return;
    this.timeLeft = before + d;
    out.push({ type: 'time', delta: d, attacker: att });
  }

  /** Out of time: more zones, then more tickets, then the defenders. */
  private judge(zr: ZoneRules): Team {
    const b = zr.owned('blue').length;
    const r = zr.owned('red').length;
    if (b !== r) return b > r ? 'blue' : 'red';
    const tb = this.tickets.blue ?? 0;
    const tr = this.tickets.red ?? 0;
    if (tb !== tr) return tb > tr ? 'blue' : 'red';
    return this.defender ?? 'blue';
  }

  private between([lo, hi]: readonly [number, number]): number {
    return lo + this.rand() * (hi - lo);
  }
}

// ---------------------------------------------------------------------------
// Conquest (breakthrough)

/**
 * Conquest [제안]: the first sector opens `setup` s into the match, so the
 * defenders (who come from the sectors behind) get there (on Bilbao the first
 * zone fell in 22 s, the attackers' base being a third as far from it).
 */
export const CONQUEST = { setup: 20 };

export interface ConquestOptions {
  attacker: Team;
  /** Sectors in the order they are attacked. */
  sectors: readonly (readonly string[])[];
  tickets: number;
  /** Tickets added for each sector taken. */
  refill: number;
  /** Seconds before the first sector opens. */
  setup?: number;
}

export class ConquestRules extends SectorRules {
  readonly kind = 'conquest';
  readonly attacker: Team;
  readonly defender: Team;
  /** The sector under attack (= sectors taken so far). */
  active = 0;
  /** Seconds until the first sector opens. */
  setupLeft: number;
  private readonly refill: number;

  constructor(opts: ConquestOptions) {
    super(opts.sectors);
    this.attacker = opts.attacker;
    this.defender = other(opts.attacker);
    this.tickets[this.attacker] = opts.tickets;
    this.refill = opts.refill;
    this.setupLeft = opts.setup ?? CONQUEST.setup;
  }

  protected activeSector(): number {
    return this.active;
  }

  start(zr: ZoneRules): void {
    this.lock(zr, this.setupLeft > 0 ? null : this.active, (i) => (i < this.active ? this.attacker : this.defender));
  }

  step(dt: number, zr: ZoneRules): ModeEvent[] {
    if (this.ended) return [];
    const out: ModeEvent[] = [];
    if (this.setupLeft > 0) {
      this.setupLeft = Math.max(0, this.setupLeft - dt);
      if (this.setupLeft > 0) return out;
      out.push({ type: 'attack', attacker: this.attacker, reason: 'opening' });
    }
    if (this.holder(this.active, zr) === this.attacker) {
      out.push({ type: 'sector', team: this.attacker, sector: this.active });
      this.active++;
      if (this.active >= this.sectors.length) this.end(this.attacker, 'sectors');
      else {
        this.tickets[this.attacker] = (this.tickets[this.attacker] ?? 0) + this.refill;
        out.push({ type: 'refill', team: this.attacker, tickets: this.refill });
        out.push({ type: 'attack', attacker: this.attacker, reason: 'captured' });
      }
    }
    this.lock(zr, this.ended ? null : this.active, (i) => (i < this.active ? this.attacker : this.defender));
    return out;
  }

  order(team: Team): string[] {
    const ids = this.sectors.flat();
    // Attack order runs from the attackers' side.
    return team === this.attacker ? ids : ids.reverse();
  }
}
