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

/** Per-combatant match stats, fed from game events. Render-independent. */
export class ScoreTracker {
  private readonly rows = new Map<number, ScoreRow>();

  add(id: number, name: string, team: Team): void {
    if (!this.rows.has(id)) this.rows.set(id, { id, name, team, kills: 0, deaths: 0, captures: 0, score: 0 });
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
  }

  death(id: number): void {
    const r = this.rows.get(id);
    if (r) r.deaths++;
  }

  /** Got a downed teammate back up (medics earn more for it). */
  revive(id: number, medic: boolean): void {
    const r = this.rows.get(id);
    if (r) r.score += medic ? POINTS.reviveMedic : POINTS.revive;
  }

  /** Handed a teammate a medkit or ammo. */
  resupply(id: number): void {
    const r = this.rows.get(id);
    if (r) r.score += POINTS.resupply;
  }

  /** Everyone who was in the zone when it was captured / neutralized. */
  objective(ids: Iterable<number>, kind: 'capture' | 'neutralize'): void {
    for (const id of ids) {
      const r = this.rows.get(id);
      if (!r) continue;
      if (kind === 'capture') r.captures++;
      r.score += kind === 'capture' ? POINTS.capture : POINTS.neutralize;
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
