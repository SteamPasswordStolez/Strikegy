import type { Team } from '@/world/mapTypes';

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
}

/** What a score popup says the points were for. */
export type PointsReason = 'kill' | 'headshot' | 'capture' | 'neutralize' | 'revive' | 'resupply';

/** Per-combatant match stats, fed from game events. Render-independent. */
export class ScoreTracker {
  private readonly rows = new Map<number, ScoreRow>();
  /** Points just earned (the player's become popups on the HUD; building points don't). */
  onPoints: ((id: number, points: number, reason: PointsReason) => void) | null = null;

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
    if (v && (v === a || v.team === a.team)) return;
    a.kills++;
    a.score += POINTS.kill + (headshot ? POINTS.headshot : 0);
    this.onPoints?.(a.id, POINTS.kill, 'kill');
    if (headshot) this.onPoints?.(a.id, POINTS.headshot, 'headshot');
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
    r.score += pts;
    this.onPoints?.(id, pts, 'revive');
  }

  /** Handed a teammate a medkit or ammo. */
  resupply(id: number): void {
    const r = this.rows.get(id);
    if (!r) return;
    r.score += POINTS.resupply;
    this.onPoints?.(id, POINTS.resupply, 'resupply');
  }

  /** Points for building and refilling stations (fractions carry over). */
  award(id: number, points: number): void {
    const r = this.rows.get(id);
    if (!r) return;
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
    }
  }

  /** A team's rows, best first (score, then kills, then fewer deaths). */
  table(team: Team): ScoreRow[] {
    return [...this.rows.values()]
      .filter((r) => r.team === team)
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
