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
import { levelOf, rankAt, type RankId } from './levels';
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

export interface TrackerOptions {
  kind: MatchKind;
  map: string;
  mode: string;
  /** The room's bot difficulty, if it has bots (bot matches always do). */
  difficulty: Difficulty | null;
  /** The profile's XP when the match started (live levels count from it). */
  startXp: number;
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
  };
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

  constructor(readonly opts: TrackerOptions) {
    this.level = levelOf(opts.startXp).level;
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

  private add<K extends keyof CareerStats>(k: K, n = 1): void {
    this.stats[k] = (this.stats[k] ?? 0) + n;
  }

  private classRow(): ClassRecord | null {
    if (!this.cls) return null;
    return (this.classes[this.cls] ??= { xp: 0, seconds: 0, kills: 0 });
  }

  /** XP before multipliers into `line`. */
  private gain(line: XpLineKey, baseXp: number): number {
    if (this.ended || baseXp <= 0) return 0;
    this.base[line] += baseXp;
    const xp = baseXp * this.mult;
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
    if (reason === 'revive') this.add('revives');
    if (reason === 'capture') this.add('captures');
    if (reason === 'neutralize') this.add('neutralizes');
    if (reason === 'sea') return this.gain('sea', pts * XP.sea * XP.perPoint);
    return this.gain('score', pts * XP.perPoint);
  }

  /** One's own kill (the points come through `points`); the weapon's row gets them too. */
  kill(weaponId: string | null, headshot: boolean, melee: boolean): void {
    this.add('kills');
    if (headshot) this.add('headshots');
    if (melee) this.add('meleeKills');
    this.streak++;
    this.stats.bestStreak = Math.max(this.stats.bestStreak ?? 0, this.streak);
    const c = this.classRow();
    if (c) c.kills++;
    if (weaponId && !this.ended) {
      const w = (this.weapons[weaponId] ??= { xp: 0, kills: 0, headshots: 0 });
      w.kills++;
      if (headshot) w.headshots++;
      w.xp += (100 + (headshot ? 25 : 0)) * XP.perPoint * this.mult;
    }
  }

  death(): void {
    this.add('deaths');
    this.streak = 0;
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

  private summary(result: MatchResult): MatchSummary {
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
    };
  }

  /**
   * The match ended with oneself still in it: the completion bonus (for the
   * time played, longer matches more) and the win bonus, then the summary to
   * confirm. Idle for most of it: nothing is confirmed (result 'idle').
   */
  finish(won: boolean): MatchSummary {
    if (this.seconds > 0 && this.idleSeconds > this.seconds * XP.idleShare) {
      this.ended = true;
      const s = this.summary('idle');
      return { ...s, xp: 0, lines: [], stats: {}, weapons: {}, classes: {}, seconds: 0 };
    }
    this.gain(
      'complete',
      Math.min(XP.completeMax, (XP.complete * this.seconds) / (XP.completeMinutes * 60)),
    );
    if (won) this.gain('win', XP.win);
    this.ended = true;
    return this.summary(won ? 'win' : 'loss');
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
   * Kicked by the anticheat: always undone.
   */
  leave(humans: number, kicked = false): MatchSummary {
    this.ended = true;
    const s = this.summary('left');
    if (kicked || this.leaveCost(humans).undone)
      return { ...s, xp: 0, score: 0, lines: [], stats: {}, weapons: {}, classes: {}, seconds: 0 };
    return s;
  }
}
