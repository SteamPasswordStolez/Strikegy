import type { Team } from '@/world/mapTypes';
import { friends } from './matchFlags';
import type { ScoreReason } from '@/progression/tracker';

/** Points per action (BF-style score column). */
export const POINTS = { kill: 100, headshot: 25, capture: 150, neutralize: 75, revive: 100, reviveMedic: 150, resupply: 20 } as const;

export interface ScoreRow {
  id: number;
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  /** Zones captured while standing in them. */
  captures: number;
  score: number;
  /** For the result screen (counted where the match is played; may be missing in a server's table). */
  headshots?: number;
  revives?: number;
}

/** What a score popup says the points were for. */
export type PointsReason = 'kill' | 'headshot' | 'capture' | 'neutralize' | 'revive' | 'resupply';

/** Per-combatant match stats, fed from game events. Render-independent. */
export class ScoreTracker {
  private readonly rows = new Map<number, ScoreRow>();
  /** Points just earned (the player's become popups on the HUD; building points don't). */
  onPoints: ((id: number, points: number, reason: PointsReason) => void) | null = null;
  /** Every point anyone scores and what for (progress: XP; `other` = who was handed something). */
  onScore: ((id: number, points: number, reason: ScoreReason, other?: number) => void) | null = null;

  add(id: number, name: string, team: Team): void {
    if (!this.rows.has(id)) this.rows.set(id, { id, name, team, kills: 0, deaths: 0, captures: 0, score: 0 });
  }

  /** The whole table as the game server has it (matches played there). */
  load(rows: readonly ScoreRow[]): void {
    this.rows.clear();
    for (const r of rows) this.rows.set(r.id, { ...r });
  }

  get(id: number): ScoreRow | undefined {
    return this.rows.get(id);
  }

  /** A kill; ignored for unknown attackers, self-kills and teammates. */
  kill(attackerId: number | undefined, victimId: number | undefined, headshot: boolean): void {
    const a = attackerId === undefined ? undefined : this.rows.get(attackerId);
    if (!a) return;
    const v = victimId === undefined ? undefined : this.rows.get(victimId);
    if (v && (v === a || friends(v, a))) return;
    a.kills++;
    if (headshot) a.headshots = (a.headshots ?? 0) + 1;
    a.score += POINTS.kill + (headshot ? POINTS.headshot : 0);
    this.onPoints?.(a.id, POINTS.kill, 'kill');
    this.onScore?.(a.id, POINTS.kill, 'kill');
    if (headshot) {
      this.onPoints?.(a.id, POINTS.headshot, 'headshot');
      this.onScore?.(a.id, POINTS.headshot, 'headshot');
    }
  }

  death(id: number): void {
    const r = this.rows.get(id);
    if (r) r.deaths++;
  }

  /** Got a downed teammate back up (medics earn more for it). */
  revive(id: number, medic: boolean): void {
    const r = this.rows.get(id);
    if (!r) return;
    const pts = medic ? POINTS.reviveMedic : POINTS.revive;
    r.revives = (r.revives ?? 0) + 1;
    r.score += pts;
    this.onPoints?.(id, pts, 'revive');
    this.onScore?.(id, pts, 'revive');
  }

  /** Handed a teammate (`to`) a medkit or ammo. */
  resupply(id: number, to?: number): void {
    const r = this.rows.get(id);
    if (!r) return;
    r.score += POINTS.resupply;
    this.onPoints?.(id, POINTS.resupply, 'resupply');
    this.onScore?.(id, POINTS.resupply, 'resupply', to);
  }

  /** Points for building, refilling stations, sea damage and dog tags (fractions carry over). */
  award(id: number, points: number, reason: Extract<ScoreReason, 'build' | 'refill' | 'sea' | 'tag'>): void {
    const r = this.rows.get(id);
    if (!r) return;
    this.onScore?.(id, points, reason);
    const carry = (this.carry.get(id) ?? 0) + points;
    // A hair of slack so sums like 60 x 1/6 don't land just under a whole point.
    const whole = Math.floor(carry + 1e-9);
    this.carry.set(id, carry - whole);
    r.score += whole;
  }
  private readonly carry = new Map<number, number>();

  /** Everyone who was in the zone when it was captured / neutralized. */
  objective(ids: Iterable<number>, kind: 'capture' | 'neutralize'): void {
    for (const id of ids) {
      const r = this.rows.get(id);
      if (!r) continue;
      if (kind === 'capture') r.captures++;
      const pts = kind === 'capture' ? POINTS.capture : POINTS.neutralize;
      r.score += pts;
      this.onPoints?.(id, pts, kind);
      this.onScore?.(id, pts, kind);
    }
  }

  /** A team's rows (everyone's when null: free-for-all), best first (score, then kills, then fewer deaths). */
  table(team: Team | null): ScoreRow[] {
    return [...this.rows.values()]
      .filter((r) => team === null || r.team === team)
      .sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
  }

  totals(team: Team): { kills: number; deaths: number } {
    let kills = 0;
    let deaths = 0;
    for (const r of this.rows.values()) {
      if (r.team !== team) continue;
      kills += r.kills;
      deaths += r.deaths;
    }
    return { kills, deaths };
  }
}
