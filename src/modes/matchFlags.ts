import type { Team } from '@/world/mapTypes';

/**
 * What the match being played allows, set once per match by `ZoneMode` from
 * its mode (owner, 2026-10-12: free-for-all modes). One match runs per page
 * and per game-server worker, so this is module state; whoever builds a match
 * sets it before anything reads it.
 *
 * - `ffa`: every soldier is their own side. Soldiers still carry a nominal
 *   `team` (blue / red halves, for code that needs one: spawn lists, models),
 *   but who may hurt whom, who bots fight and who counts as a friend go
 *   through `foes` / `friends`, which compare ids instead.
 * - `revive`: a soldier whose health runs out goes down and waits for a
 *   revive; without it a down is a death at once.
 * - `respawn`: seconds before the next life (null: the usual wait).
 * - `squads`, `vehicles`, `callIns`: whether those exist at all.
 */
export interface MatchFlags {
  ffa: boolean;
  revive: boolean;
  respawn: number | null;
  squads: boolean;
  vehicles: boolean;
  callIns: boolean;
  /** Nobody may hurt anybody and bots see no enemies (fortress: the build phase). Set by `ZoneMode` as the match goes. */
  truce: boolean;
  /** Building goes this many times as fast (fortress: the build phase), and bots don't hold back from it. */
  buildBoost: number;
}

const TEAM_PLAY: MatchFlags = { ffa: false, revive: true, respawn: null, squads: true, vehicles: true, callIns: true, truce: false, buildBoost: 1 };

export const MATCH: MatchFlags = { ...TEAM_PLAY };

export function setMatchFlags(flags: Partial<MatchFlags>): void {
  Object.assign(MATCH, TEAM_PLAY, flags);
}

/** Anything on a side: a soldier, a shooter, a gadget's owner. */
export interface Sided {
  readonly id?: number;
  readonly team?: Team | null;
}

/** May `a` and `b` hurt each other / do bots fight them? In free-for-all everyone but oneself. */
export function foes(a: Sided, b: Sided): boolean {
  if (MATCH.truce) return false;
  if (MATCH.ffa) return a.id === undefined || b.id === undefined || a.id !== b.id;
  return a.team !== b.team;
}

/** The uniform a soldier of `team` wears: in free-for-all everyone looks like an enemy. */
export function lookTeam(team: Team): Team {
  return MATCH.ffa ? 'red' : team;
}

/** Same side (oneself included). */
export function friends(a: Sided, b: Sided): boolean {
  return !foes(a, b);
}
