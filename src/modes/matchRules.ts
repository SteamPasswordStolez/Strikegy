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

export type ModeKind = 'zone' | 'frontline' | 'conquest';

export const MODE_KINDS: readonly ModeKind[] = ['zone', 'frontline', 'conquest'];

/** How a match ended. */
export type EndReason = 'points' | 'tickets' | 'front' | 'time' | 'sectors';

/** Something worth announcing. */
export type ModeEvent =
  /** `team` took sector `sector` (frontline: index from the blue end; conquest: attack order). */
  | { type: 'sector'; team: Team; sector: number }
  /** A new attack begins: `attacker` attacks; why the roles are what they are now. */
  | { type: 'attack'; attacker: Team; reason: 'opening' | 'captured' | 'held' }
  /** The attack timer moved by `delta` seconds (frontline). */
  | { type: 'time'; delta: number; attacker: Team }
  /** Tickets added to `team` (conquest: a sector taken). */
  | { type: 'refill'; team: Team; tickets: number };

const SIGN: Record<Team, number> = { blue: 1, red: -1 };
const other = (t: Team): Team => (t === 'blue' ? 'red' : 'blue');

export abstract class MatchRules {
  abstract readonly kind: ModeKind;
  winner: Team | null = null;
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

  /** A member of `team` went down (frontline: part of how the attack is going). */
  onDown(team: Team): void {
    void team;
  }

  /** Zone ids from `team`'s side of the map to the far side (the HUD's left to right). */
  abstract order(team: Team): string[];

  /** Zones the fight is about now (or about to be), null for all: what bots go for. */
  focus(): readonly string[] | null {
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

export class DominationRules extends MatchRules {
  readonly kind = 'zone';
  readonly points: Record<Team, number> = { blue: 0, red: 0 };
  private clock = 0;

  constructor(
    readonly target: number = DOMINATION.target,
    readonly tick: number = DOMINATION.tick,
  ) {
    super();
  }

  /** Seconds to the next scoring tick. */
  get nextTick(): number {
    return this.tick - this.clock;
  }

  start(): void {}

  step(dt: number, zones: ZoneRules): ModeEvent[] {
    if (this.ended) return [];
    this.clock += dt;
    while (this.clock >= this.tick) {
      this.clock -= this.tick;
      for (const t of ['blue', 'red'] as const) this.points[t] = Math.min(this.target, this.points[t] + zones.owned(t).length);
    }
    const { blue, red } = this.points;
    // Both over the line in the same tick: the one further ahead (a tie plays on to the next).
    if ((blue >= this.target || red >= this.target) && blue !== red) this.end(blue > red ? 'blue' : 'red', 'points');
    return [];
  }

  order(team: Team): string[] {
    void team;
    return [];
  }
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
