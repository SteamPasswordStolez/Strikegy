/**
 * One person's progress through one match (progression plan 3-1-1, 5): XP rises
 * live as points come in (the HUD says so on every level), and the match is
 * confirmed once at its end with the completion and win bonuses. Left early:
 * solo and rooms of two people or fewer undo it all, bigger rooms keep what
 * rose and lose only the bonuses. Render-free and import-light: solo `Game`
 * runs it now, the game server's rooms will run the same per person.
 *
 * XP = score × 10 (owner, 2026-10-24), except building and refilling stations,
 * whose points would make XP free: a structure gives XP once when finished
 * and more when it is used, capped a match. Multipliers in order: sea damage
 * points × 1/20, × 10, bot matches × 0.5, bot difficulty.
 */
import { earn } from './income';
import { levelOf, rankAt, type RankId } from './levels';
import { weaponLevelOf } from './unlocks';
import { RIBBON, RIBBONS, ribbonsDue, type CountKey, type MatchCounts } from './ribbons';
import { SPECIAL, type CamoCounts } from './camo';
import { contractDef } from './contracts';
import { BOOSTERS, ECON, WEAPON_CLASSES, type BoostKind } from './economy';
import type {
  CareerStats,
  ClassRecord,
  MatchKind,
  MatchResult,
  MatchSummary,
  MultKey,
  WeaponRecord,
  XpLineKey,
} from './profile';

/** What points were for (the scoreboard's reasons). */
export type ScoreReason =
  | 'kill'
  | 'headshot'
  | 'capture'
  | 'neutralize'
  | 'revive'
  | 'resupply'
  | 'tag'
  | 'sea'
  | 'build'
  | 'refill';

export const XP = {
  /** Score to XP. */
  perPoint: 10,
  /** Sea damage is scored 1:1 (a torpedo is 20,000 points): 1/20 of it counts. */
  sea: 1 / 20,
  bots: 0.5,
  difficulty: { easy: 0.66, normal: 1, hard: 1.2 },
  /** For a full match of 10 minutes; longer matches more, up to 3x (big maps). */
  complete: 5000,
  completeMinutes: 10,
  completeMax: 15000,
  win: 5000,
  /** A finished structure (fortify.ts kinds; fixed weapons count as a nest). */
  build: {
    sandbagLow: 150,
    barricade: 150,
    sandbag: 200,
    timber: 200,
    wire: 200,
    sandbagCorner: 250,
    hedgehog: 250,
    nest: 400,
  } as Record<string, number>,
  buildPost: 400,
  /** A teammate's kill from beside one's structure (within 2 m). */
  cover: 500,
  coverPerStructure: 2000,
  buildCap: 15000,
  refill: 300,
  refillCap: 3000,
  /** Building it again within this long of losing it gives nothing for finishing it. */
  rebuildSec: 180,
  /** Handing the same person something gives XP once in this long. */
  resupplySec: 30,
  /** Idle for over this share of the match: not confirmed. */
  idleShare: 0.5,
  /** Quiet stretches shorter than this don't count as idle. */
  idleAfter: 30,
  /** The tutorial's basics finished the first time (outside matches, no multipliers). */
  tutorial: 5000,
} as const;

export type Difficulty = keyof typeof XP.difficulty;

/** Supply tickets a match pays beyond its base (progression-data.md S-1). */
export const TICKETS = { mvp: earn(200), place: [earn(150), earn(100), earn(50)], bountyTop: earn(50), bountyStreak: earn(30) } as const;

/** What the end of a match knows about one's standing (`finish`). */
export interface FinishExtra {
  /** Top score of everyone. */
  mvp?: boolean;
  /** Place on one's own side (1-3 pay). */
  place?: number;
}

export interface TrackerOptions {
  kind: MatchKind;
  map: string;
  mode: string;
  /** The room's bot difficulty, if it has bots (bot matches always do). */
  difficulty: Difficulty | null;
  /** The profile's XP when the match started (live levels count from it). */
  startXp: number;
  /** Each weapon's XP when the match started (its live level counts from it). */
  weaponXp?: Readonly<Record<string, number>>;
  /** Boosters running at the start (seconds of match time left; step 5). */
  boost?: Partial<Record<BoostKind, number>>;
  /** The server's double events on at the start (multipliers by kind; the staff turn them on). */
  event?: Partial<Record<BoostKind, number>>;
  /** The field contract picked on the deploy screen. */
  contract?: string;
}

/** What one kill was (the camo challenges, missions, ribbons and bounties read it). */
export interface KillInfo {
  /** The gun's id (none for blasts, call-ins, vehicle guns). */
  weapon: string | null;
  headshot: boolean;
  melee: boolean;
  /** Metres to the victim. */
  dist?: number;
  /** Fired from the hip. */
  hip?: boolean;
  /** Kills with this magazine so far, this one included. */
  magKills?: number;
  grenade?: boolean;
  callin?: boolean;
  /** The killer was in a vehicle. */
  vehicle?: boolean;
  /** Inside a zone the killer's side holds. */
  defend?: boolean;
  /** A squad mate within 30 m. */
  squad?: boolean;
  /** The victim led the other side's scoreboard. */
  victimTop?: boolean;
  /** The victim's kills this life. */
  victimStreak?: number;
}

/** A ribbon earned (the HUD's notice). */
export interface RibbonEarned {
  id: string;
  /** How many of it this match now. */
  count: number;
}

/** A weapon's level reached during the match. */
export interface WeaponLevelUp {
  weapon: string;
  level: number;
}

/** A level reached during the match (the HUD's notice). */
export interface LevelUp {
  level: number;
  /** The rank, when this level is a promotion. */
  promoted: RankId | null;
}

interface Built {
  kind: string;
  cover: number;
}

/** What leaving now would cost (the pause menu's confirmation). */
export interface LeaveCost {
  /** Everything is undone (solo, rooms of two or fewer). */
  undone: boolean;
  xp: number;
  levels: number;
}

export class ProgressTracker {
  /** Live XP this match, after multipliers (fractional). */
  private earned = 0;
  private readonly base: Record<XpLineKey, number> = {
    score: 0,
    sea: 0,
    build: 0,
    refill: 0,
    complete: 0,
    win: 0,
    tutorial: 0,
    ribbon: 0,
    booster: 0,
    event: 0,
  };
  private readonly counts: MatchCounts = {};
  private readonly ribbons: Record<string, number> = {};
  private readonly camo: Record<string, CamoCounts> = {};
  private lifeKills = 0;
  private bestLifeKills = 0;
  private deaths = 0;
  private bounty = { top: 0, streak: 0 };
  /** Booster seconds left / used this match. */
  private readonly boostLeft: Partial<Record<BoostKind, number>>;
  private readonly boostUsed: Partial<Record<BoostKind, number>> = {};
  private readonly stats: Partial<CareerStats> = {};
  private readonly weapons: Record<string, WeaponRecord> = {};
  private readonly classes: Record<string, ClassRecord> = {};
  private readonly built = new Map<number, Built>();
  /** Slot id -> when one's own structure there was lost. */
  private readonly lost = new Map<number, number>();
  private readonly gave = new Map<number, number>();
  private cls = '';
  private streak = 0;
  private seconds = 0;
  private idle = 0;
  private quiet = 0;
  private level: number;
  private ended = false;
  /** Score as the scoreboard has it (for the record). */
  score = 0;
  /** Levels reached as they happen. */
  onLevel: ((l: LevelUp) => void) | null = null;
  /** Weapon levels reached as they happen. */
  onWeaponLevel: ((l: WeaponLevelUp) => void) | null = null;
  /** Ribbons as they are earned. */
  onRibbon: ((r: RibbonEarned) => void) | null = null;

  constructor(readonly opts: TrackerOptions) {
    this.level = levelOf(opts.startXp).level;
    this.boostLeft = { ...(opts.boost ?? {}) };
    this.contract = opts.contract;
  }

  /** The field contract for this match (picked on the deploy screen; fixed once set). */
  private contract: string | undefined;
  setContract(id: string | undefined): void {
    if (!this.contract && id && contractDef(id)) this.contract = id;
  }
  get contractId(): string | undefined {
    return this.contract;
  }

  /** Booster seconds still to run (the deploy screen's line). */
  get boosts(): Partial<Record<BoostKind, number>> {
    return { ...this.boostLeft };
  }

  private boosting(k: BoostKind): boolean {
    return (this.boostLeft[k] ?? 0) > 0;
  }

  /** Bot matches × 0.5, then the bot difficulty. */
  get multipliers(): { key: MultKey; x: number }[] {
    const out: { key: MultKey; x: number }[] = [];
    if (this.opts.kind === 'bots') out.push({ key: 'bots', x: XP.bots });
    const d = this.opts.difficulty;
    if (d === 'easy' || d === 'hard') out.push({ key: d, x: XP.difficulty[d] });
    return out;
  }

  private get mult(): number {
    return this.multipliers.reduce((a, m) => a * m.x, 1);
  }

  /** XP so far this match (whole). */
  get xp(): number {
    return Math.floor(this.earned);
  }

  /** The profile's XP as it stands live. */
  get liveXp(): number {
    return this.opts.startXp + this.xp;
  }

  /** A weapon's XP as it stands live. */
  weaponXp(id: string): number {
    return (this.opts.weaponXp?.[id] ?? 0) + (this.weapons[id]?.xp ?? 0);
  }

  private add<K extends keyof CareerStats>(k: K, n = 1): void {
    this.stats[k] = (this.stats[k] ?? 0) + n;
  }

  private classRow(): ClassRecord | null {
    if (!this.cls) return null;
    return (this.classes[this.cls] ??= { xp: 0, seconds: 0, kills: 0 });
  }

  /** XP before multipliers into `line` (an XP booster doubles what the match earns). */
  private gain(line: XpLineKey, baseXp: number): number {
    if (this.ended || baseXp <= 0) return 0;
    this.base[line] += baseXp;
    // The XP booster's share as a line of its own, so the result's parts add up.
    const boost = line !== 'tutorial' && this.boosting('xp') ? BOOSTERS.xp.mult : 1;
    if (boost > 1) this.base.booster += baseXp * (boost - 1);
    // A double event on top (its own line too).
    const ev = line !== 'tutorial' ? (this.opts.event?.xp ?? 1) : 1;
    if (ev > 1) this.base.event += baseXp * boost * (ev - 1);
    const xp = baseXp * this.mult * boost * ev;
    this.earned += xp;
    const c = this.classRow();
    if (c) c.xp += xp;
    this.checkLevel();
    return xp;
  }

  private checkLevel(): void {
    const l = levelOf(this.liveXp).level;
    while (this.level < l) {
      this.level++;
      const r = rankAt(this.level);
      this.onLevel?.({ level: this.level, promoted: r.from === this.level ? r.id : null });
    }
  }

  /** The class being played (deploying with another kit changes it). */
  setClass(cls: string): void {
    this.cls = cls;
  }

  /**
   * Points on the scoreboard for one's own actions. Building and refilling are
   * left out (see `built` / `refilled`); a resupply counts once in 30 s a person.
   */
  points(reason: ScoreReason, pts: number, now: number, other?: number): number {
    if (reason === 'build' || reason === 'refill' || pts <= 0) return 0;
    if (reason === 'resupply') {
      this.add('resupplies');
      if (other !== undefined) {
        if (now < (this.gave.get(other) ?? -Infinity)) return 0;
        this.gave.set(other, now + XP.resupplySec);
      }
    }
    if (reason === 'revive') {
      this.add('revives');
      this.count('revives');
    }
    if (reason === 'capture') {
      this.add('captures');
      this.count('captures');
    }
    if (reason === 'neutralize') {
      this.add('neutralizes');
      this.count('captures');
    }
    if (reason === 'resupply') this.count('resupplies');
    if (reason === 'tag') this.count('objectives');
    if (reason === 'sea') {
      this.count('seaDamage', pts);
      return this.gain('sea', pts * XP.sea * XP.perPoint);
    }
    return this.gain('score', pts * XP.perPoint);
  }

  /**
   * One's own kill (the points come through `points`): the weapon's row, its
   * camo challenges, the match's counts, ribbons and bounties.
   */
  kill(k: KillInfo): void;
  kill(weaponId: string | null, headshot: boolean, melee: boolean): void;
  kill(a: KillInfo | string | null, headshot = false, melee = false): void {
    const k: KillInfo = a !== null && typeof a === 'object' ? a : { weapon: a, headshot, melee };
    if (this.ended) return;
    this.add('kills');
    if (k.headshot) this.add('headshots');
    if (k.melee) this.add('meleeKills');
    this.streak++;
    this.lifeKills++;
    this.bestLifeKills = Math.max(this.bestLifeKills, this.lifeKills);
    this.stats.bestStreak = Math.max(this.stats.bestStreak ?? 0, this.streak);
    const c = this.classRow();
    if (c) c.kills++;
    this.count('kills');
    if (k.headshot) this.count('headshots');
    if (k.melee) this.count('meleeKills');
    if (k.grenade) this.count('grenadeKills');
    if (k.callin) this.count('callinKills');
    if (k.vehicle) this.count('vehicleKills');
    if (k.defend) this.count('defendKills');
    if (k.squad) this.count('squadKills');
    if (k.victimTop && this.bounty.top < 3) this.bounty.top++;
    if ((k.victimStreak ?? 0) >= 5) this.bounty.streak++;
    const weaponId = k.weapon;
    const cls = weaponId ? WEAPON_CLASSES[weaponId] : undefined;
    if (weaponId && cls) {
      this.count(`kills.${cls}` as CountKey);
      const w = (this.weapons[weaponId] ??= { xp: 0, kills: 0, headshots: 0 });
      w.kills++;
      if (k.headshot) w.headshots++;
      const start = this.opts.weaponXp?.[weaponId] ?? 0;
      const before = weaponLevelOf(start + w.xp).level;
      w.xp += (100 + (k.headshot ? 25 : 0)) * XP.perPoint * this.mult * (this.boosting('weapon') ? BOOSTERS.weapon.mult : 1) * (this.opts.event?.weapon ?? 1);
      const after = weaponLevelOf(start + w.xp).level;
      for (let l = before + 1; l <= after; l++) this.onWeaponLevel?.({ weapon: weaponId, level: l });
      // Camo challenges: kills, headshots, three in a life, the kind's feat.
      const cc = (this.camo[weaponId] ??= { kills: 0, headshots: 0, triples: 0, special: 0 });
      cc.kills++;
      if (k.headshot) cc.headshots++;
      if (this.lifeKills === 3) cc.triples++;
      const what = SPECIAL[cls].what;
      const dist = k.dist ?? 0;
      if (
        (what === 'far50' && dist > 50) ||
        (what === 'far150' && dist > 150) ||
        (what === 'close8' && dist > 0 && dist < 8) ||
        (what === 'hip' && k.hip) ||
        (what === 'headshots' && k.headshot) ||
        (what === 'double' && k.magKills === 2)
      )
        cc.special++;
    }
  }

  death(): void {
    this.add('deaths');
    this.streak = 0;
    this.lifeKills = 0;
    this.deaths++;
  }

  /** A feat counted toward missions and ribbons (vehicles destroyed, aircraft down, objectives, call-ins...). */
  count(key: CountKey, n = 1): void {
    if (this.ended || n <= 0) return;
    this.counts[key] = (this.counts[key] ?? 0) + n;
    if (key === 'ribbons') return;
    for (const r of RIBBONS) {
      if (r.key !== key) continue;
      const due = ribbonsDue(r, this.counts[key]!, this.ribbons[r.id] ?? 0);
      for (let i = 0; i < due; i++) this.ribbon(r.id);
    }
  }

  private ribbon(id: string): void {
    this.ribbons[id] = (this.ribbons[id] ?? 0) + 1;
    this.counts.ribbons = (this.counts.ribbons ?? 0) + 1;
    this.gain('ribbon', RIBBON.xp);
    this.onRibbon?.({ id, count: this.ribbons[id]! });
  }

  shot(): void {
    this.add('shots');
  }

  hit(): void {
    this.add('hits');
  }

  /** One's own structure finished at build spot `slot` (`now`: match seconds; `half`: the fortress build phase). */
  builtAt(slot: number, kind: string, now: number, half = false): number {
    this.add('builds');
    this.count('builds');
    const lostAt = this.lost.get(slot);
    this.lost.delete(slot);
    this.built.set(slot, { kind, cover: 0 });
    if (lostAt !== undefined && now - lostAt < XP.rebuildSec) return 0;
    const xp = (XP.build[kind] ?? XP.buildPost) * (half ? 0.5 : 1);
    return this.gain('build', Math.min(xp, this.buildRoom()));
  }

  private buildRoom(): number {
    return Math.max(0, XP.buildCap - this.base.build);
  }

  /** A build spot's structure went down (anyone's: only one's own matter). */
  lostAt(slot: number, now: number): void {
    if (!this.built.delete(slot)) return;
    this.lost.set(slot, now);
  }

  /** Is the structure at this spot one's own, still standing? */
  owns(slot: number): boolean {
    return this.built.has(slot);
  }

  /** A teammate's kill from beside one's structure at `slot`. */
  coverAssist(slot: number): number {
    const b = this.built.get(slot);
    if (!b) return 0;
    const xp = Math.min(XP.cover, XP.coverPerStructure - b.cover, this.buildRoom());
    if (xp <= 0) return 0;
    b.cover += xp;
    return this.gain('build', xp);
  }

  /** A station refilled by one use. */
  refilled(): number {
    return this.gain('refill', Math.min(XP.refill, Math.max(0, XP.refillCap - this.base.refill)));
  }

  /**
   * Time in the match: `active` = moved, looked round or fired this step.
   * Stretches with nothing for over 30 s count as idle.
   */
  tick(dt: number, active: boolean): void {
    if (this.ended) return;
    this.seconds += dt;
    // Boosters run on match time only.
    for (const k of Object.keys(this.boostLeft) as BoostKind[]) {
      const left = this.boostLeft[k] ?? 0;
      if (left <= 0) continue;
      const use = Math.min(left, dt);
      this.boostLeft[k] = left - use;
      this.boostUsed[k] = (this.boostUsed[k] ?? 0) + use;
    }
    const c = this.classRow();
    if (c) c.seconds += dt;
    if (active) {
      if (this.quiet > XP.idleAfter) this.idle += this.quiet;
      this.quiet = 0;
    } else this.quiet += dt;
  }

  private get idleSeconds(): number {
    return this.idle + (this.quiet > XP.idleAfter ? this.quiet : 0);
  }

  /** People in the match (bots aside, oneself included) at which leaving keeps what rose. */
  static readonly KEEP_AT = 3;

  /** What leaving now would cost. */
  leaveCost(humans: number): LeaveCost {
    const undone = this.opts.kind === 'bots' || humans < ProgressTracker.KEEP_AT;
    return { undone, xp: this.xp, levels: this.level - levelOf(this.opts.startXp).level };
  }

  /** The match's supply tickets (base, ribbons, places, bounties, the contract), boosted. */
  private tickets(extra?: FinishExtra): { total: number; lines: { key: string; n: number }[] } {
    const lines: { key: string; n: number }[] = [];
    const put = (key: string, n: number) => {
      if (n > 0) lines.push({ key, n: Math.floor(n) });
    };
    put('base', this.xp * ECON.perXp);
    put('ribbons', (this.counts.ribbons ?? 0) * RIBBON.tickets);
    if (extra?.mvp) put('mvp', TICKETS.mvp);
    if (extra?.place) put('place', TICKETS.place[extra.place - 1] ?? 0);
    put('bounty', this.bounty.top * TICKETS.bountyTop + this.bounty.streak * TICKETS.bountyStreak);
    const c = this.contract ? contractDef(this.contract) : undefined;
    if (c && (c.key === 'lifeKills' ? this.bestLifeKills : (this.counts[c.key] ?? 0)) >= c.n) put('contract', c.tickets * this.mult);
    let total = lines.reduce((a, l) => a + l.n, 0);
    // The tickets booster: x1.5 on the share of the match it ran.
    const share = this.seconds > 0 ? Math.min(1, (this.boostUsed.tickets ?? 0) / this.seconds) : 0;
    if (share > 0) {
      const more = Math.floor(total * (BOOSTERS.tickets.mult - 1) * share);
      put('booster', more);
      total += more;
    }
    // A tickets double event on top.
    const ev = this.opts.event?.tickets ?? 1;
    if (ev > 1) {
      const more = Math.floor(total * (ev - 1));
      put('event', more);
      total += more;
    }
    return { total, lines };
  }

  /** Did the contract's goal get met (the deploy screen's line)? */
  contractMet(): boolean {
    const c = this.contract ? contractDef(this.contract) : undefined;
    return !!c && (c.key === 'lifeKills' ? this.bestLifeKills : (this.counts[c.key] ?? 0)) >= c.n;
  }

  private summary(result: MatchResult, extra?: FinishExtra): MatchSummary {
    const t = this.tickets(extra);
    const lines = (Object.keys(this.base) as XpLineKey[])
      .filter((k) => this.base[k] > 0)
      .map((key) => ({
        key,
        base: Math.round(this.base[key]),
        xp: Math.floor(this.base[key] * this.mult),
      }));
    return {
      kind: this.opts.kind,
      map: this.opts.map,
      mode: this.opts.mode,
      result,
      seconds: Math.round(this.seconds),
      score: this.score,
      xp: this.xp,
      lines,
      mult: this.multipliers,
      stats: { ...this.stats },
      weapons: structuredClone(this.weapons),
      classes: structuredClone(this.classes),
      counts: { ...this.counts },
      ribbons: { ...this.ribbons },
      camo: structuredClone(this.camo),
      tickets: t.total,
      ticketLines: t.lines,
      boosted: { ...this.boostUsed },
    };
  }

  /**
   * The match ended with oneself still in it: the completion bonus (for the
   * time played, longer matches more) and the win bonus, then the summary to
   * confirm. Idle for most of it: nothing is confirmed (result 'idle').
   */
  finish(won: boolean, extra?: FinishExtra): MatchSummary {
    if (this.seconds > 0 && this.idleSeconds > this.seconds * XP.idleShare) {
      this.ended = true;
      const s = this.summary('idle');
      return { ...s, xp: 0, lines: [], stats: {}, weapons: {}, classes: {}, seconds: 0, counts: {}, ribbons: {}, camo: {}, tickets: 0, ticketLines: [] };
    }
    // Survived the whole match: the survivor ribbon.
    if (this.deaths === 0 && this.seconds >= 60) this.ribbon('survivor');
    this.gain(
      'complete',
      Math.min(XP.completeMax, (XP.complete * this.seconds) / (XP.completeMinutes * 60)),
    );
    if (won) this.gain('win', XP.win);
    this.ended = true;
    return this.summary(won ? 'win' : 'loss', extra);
  }

  /**
   * Ended without a winner by someone else (the room's owner, the staff, the
   * server stopping): what rose so far and the completion bonus for the time
   * played, no win bonus (not one's own doing; progression.md 3-1-1).
   */
  stop(): MatchSummary {
    if (this.ended) return this.summary('stopped');
    this.gain('complete', Math.min(XP.completeMax, (XP.complete * this.seconds) / (XP.completeMinutes * 60)));
    this.ended = true;
    return this.summary('stopped');
  }

  /** Done already (finished, left or stopped). */
  get done(): boolean {
    return this.ended;
  }

  /**
   * Left before the end with `humans` people in the match: in bot matches and
   * rooms of two or fewer everything is undone (an empty summary: the record
   * keeps the quit), otherwise what rose so far is kept without the bonuses.
   * Kicked by the anticheat: always undone. `pass`: a leave pass (외출증,
   * progression step 5) was spent, so what rose is kept anyway.
   */
  leave(humans: number, kicked = false, pass = false): MatchSummary {
    this.ended = true;
    const s = this.summary('left');
    if (kicked || (!pass && this.leaveCost(humans).undone))
      return { ...s, xp: 0, score: 0, lines: [], stats: {}, weapons: {}, classes: {}, seconds: 0, counts: {}, ribbons: {}, camo: {}, tickets: 0, ticketLines: [], boosted: { ...this.boostUsed } };
    return s;
  }
}
