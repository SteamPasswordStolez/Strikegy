import { BRIEF_RULES, CUES, type CueDef, type CueId } from './cues';

/** A line picked to be said: the cue, its zone (zone cues) and which variant. */
export interface Pick {
  cue: CueId;
  zone?: string;
  /** Variant, from 1. */
  n: number;
}

interface Waiting {
  cue: CueId;
  zone?: string;
  at: number;
}

/**
 * Decides what the radio says and when (docs/design/battle-briefing.md §4):
 * one line at a time; priority 1 is said at once and may cut a lower one
 * off, 2 and 3 wait their turn and are dropped once stale; a gap after each
 * line, a cap a minute, a cooldown per cue (per cue and zone for zone cues),
 * no repeat of a zone that flipped back moments ago, and never the same
 * variant twice running. Times are seconds on any steady clock.
 */
export class BriefingScheduler {
  private queue: Waiting[] = [];
  /** When each cue (cue|zone) was last said. */
  private readonly said = new Map<string, number>();
  /** When each zone was last named in a taken / lost line. */
  private readonly zoneSaid = new Map<string, number>();
  private readonly lastVariant = new Map<CueId, number>();
  /** Times of lines said in the last minute. */
  private recent: number[] = [];
  /** Until when the current line runs. */
  private busyUntil = -Infinity;
  private busyPriority: CueDef['priority'] = 3;

  constructor(private readonly rng: () => number = Math.random) {}

  /** Something happened worth saying. */
  offer(cue: CueId, now: number, zone?: string): void {
    const def: CueDef = CUES[cue];
    const key = keyOf(cue, zone);
    const last = this.said.get(key);
    if (last !== undefined && now - last < def.cooldown) return;
    // A zone that flipped back moments ago: the strip shows it, the radio doesn't say it again.
    if (zone && (cue === 'zone.taken' || cue === 'zone.lost')) {
      const z = this.zoneSaid.get(zone);
      if (z !== undefined && now - z < BRIEF_RULES.flip) return;
    }
    // The same news already waiting: keep the older one.
    if (this.queue.some((w) => w.cue === cue && w.zone === zone)) return;
    this.queue.push({ cue, zone, at: now });
  }

  /** Forget everything waiting (a new round, the match over). */
  clear(): void {
    this.queue = [];
  }

  /** Whether a line is running now. */
  busy(now: number): boolean {
    return now < this.busyUntil;
  }

  /**
   * The next line to say now, or null. `cut` is true when it should cut the
   * running line off (a priority 1 over a lower one). Call `started` once it plays.
   */
  next(now: number): { pick: Pick; cut: boolean } | null {
    this.queue = this.queue.filter((w) => now - w.at <= expireOf(w.cue));
    this.recent = this.recent.filter((t) => now - t < 60);
    if (!this.queue.length) return null;
    // Most urgent first, then oldest.
    this.queue.sort((a, b) => CUES[a.cue].priority - CUES[b.cue].priority || a.at - b.at);
    const w = this.queue[0]!;
    const p = CUES[w.cue].priority;
    const running = now < this.busyUntil;
    if (running && !(p === 1 && this.busyPriority > 1)) return null;
    if (!running && p > 1 && now < this.busyUntil + BRIEF_RULES.gap) return null;
    if (p === 3 && this.recent.length >= BRIEF_RULES.perMinute) {
      this.queue.shift();
      return null;
    }
    this.queue.shift();
    return { pick: { cue: w.cue, zone: w.zone, n: this.variant(w.cue) }, cut: running };
  }

  /** The picked line started; it runs `seconds` (0 when there was nothing to play: text only). */
  started(pick: Pick, now: number, seconds: number): void {
    this.said.set(keyOf(pick.cue, pick.zone), now);
    if (pick.zone && (pick.cue === 'zone.taken' || pick.cue === 'zone.lost')) this.zoneSaid.set(pick.zone, now);
    this.lastVariant.set(pick.cue, pick.n);
    if (seconds <= 0) return;
    this.recent.push(now);
    this.busyUntil = now + seconds;
    this.busyPriority = CUES[pick.cue].priority;
  }

  private variant(cue: CueId): number {
    const lines = CUES[cue].lines;
    if (lines <= 1) return 1;
    const last = this.lastVariant.get(cue);
    let n = 1 + Math.floor(this.rng() * lines);
    if (n === last) n = (n % lines) + 1;
    return n;
  }
}

const keyOf = (cue: CueId, zone?: string) => (zone ? `${cue}|${zone}` : cue);
const expireOf = (cue: CueId): number => {
  const def: CueDef = CUES[cue];
  return def.expire ?? BRIEF_RULES.expire[def.priority];
};
