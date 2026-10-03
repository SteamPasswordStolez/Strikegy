/**
 * Maps the lobby offers, in its order, with the team size each plays best at
 * (players a side; the player counts on their side). Names and blurbs are in
 * the string tables (`map.<id>`, `mapDesc.<id>`); modes and the picture come
 * from the map's JSON when it is picked.
 */
export interface MapEntry {
  id: string;
  /** Players a side the map is laid out for. */
  team: number;
}

export const MAPS: readonly MapEntry[] = [
  { id: 'iron_gate', team: 12 },
  { id: 'ardennes', team: 16 },
  { id: 'lyon', team: 10 },
  { id: 'bilbao', team: 12 },
  { id: 'persia', team: 2 },
];

/** The practice range: no bots, every weapon. */
export const RANGE_ID = 'sandbox';

/** Players a side the lobby steps through (the owner wants up to 150v150). */
export const TEAM_SIZES = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 100, 150] as const;

/** From this many a side the lobby warns that it needs a strong PC. */
export const BIG_TEAM = 48;

export type LobbyMode = 'zone' | 'frontline' | 'conquest' | 'skirmish';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface LobbyPick {
  map: string;
  mode: LobbyMode;
  team: number;
  difficulty: Difficulty;
}

/**
 * The game's address for a pick (main.ts reads it): the player plus team-1
 * bots against team bots; the practice range takes no bots.
 */
export function matchQuery(p: LobbyPick): string {
  if (p.map === RANGE_ID) return `?map=${RANGE_ID}&bots=0`;
  const q = new URLSearchParams({ map: p.map, bots: `${Math.max(0, p.team - 1)}v${p.team}`, mode: p.mode, difficulty: p.difficulty });
  return `?${q.toString()}`;
}

/** The nearest offered team size (a stored or typed number snaps to the list). */
export function snapTeam(n: number): number {
  let best: number = TEAM_SIZES[0];
  for (const s of TEAM_SIZES) if (Math.abs(s - n) < Math.abs(best - n)) best = s;
  return best;
}
