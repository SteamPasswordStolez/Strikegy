/**
 * Ribbons (progression step 5; progression-data.md C, Battlefield V style):
 * a repeated feat in one match earns a ribbon, +2,500 XP and 10 supply tickets
 * each, the same ribbon at most three times a match. `ProgressTracker` counts
 * the feats (`MatchCounts`) and calls `ribbonsDue` as they come in.
 */
import { earn } from './income';

/** Feats counted through a match (missions and ribbons read them). */
export type CountKey =
  | 'kills'
  | 'headshots'
  | 'captures'
  | 'revives'
  | 'resupplies'
  | 'builds'
  | 'squadKills'
  | 'defendKills'
  | 'meleeKills'
  | 'grenadeKills'
  | 'vehicleKills'
  | 'armorKills'
  | 'airKills'
  | 'callinKills'
  | 'callins'
  | 'seaDamage'
  | 'objectives'
  | 'ribbons'
  | 'kills.ar'
  | 'kills.smg'
  | 'kills.lmg'
  | 'kills.sg'
  | 'kills.dmr'
  | 'kills.sr'
  | 'kills.pistol';

export type MatchCounts = Partial<Record<CountKey, number>>;

export interface Ribbon {
  id: string;
  key: CountKey | 'survive';
  n: number;
  name: [string, string];
}

export const RIBBON = { xp: 2500, tickets: earn(10), max: 3 } as const;

export const RIBBONS: readonly Ribbon[] = [
  { id: 'gunner', key: 'kills', n: 4, name: ['사격', 'Gunner'] },
  { id: 'marksman', key: 'headshots', n: 3, name: ['명사수', 'Marksman'] },
  { id: 'medic', key: 'revives', n: 4, name: ['위생', 'Medic'] },
  { id: 'supply', key: 'resupplies', n: 4, name: ['보급', 'Supply'] },
  { id: 'capture', key: 'captures', n: 2, name: ['점령', 'Capture'] },
  { id: 'defend', key: 'defendKills', n: 4, name: ['거점 방어', 'Defender'] },
  { id: 'squad', key: 'squadKills', n: 4, name: ['분대', 'Squad'] },
  { id: 'engineer', key: 'builds', n: 3, name: ['공병', 'Engineer'] },
  { id: 'antitank', key: 'armorKills', n: 1, name: ['대전차', 'Anti-tank'] },
  { id: 'antiair', key: 'airKills', n: 1, name: ['방공', 'Anti-air'] },
  { id: 'artillery', key: 'callinKills', n: 2, name: ['포병', 'Artillery'] },
  { id: 'naval', key: 'seaDamage', n: 10000, name: ['함포', 'Naval gunner'] },
  { id: 'objective', key: 'objectives', n: 3, name: ['목표', 'Objective'] },
  { id: 'survivor', key: 'survive', n: 1, name: ['생존', 'Survivor'] },
];

/**
 * The ribbons a count now earns: how many of `r` are due for `count` (capped),
 * less those already given.
 */
export function ribbonsDue(r: Ribbon, count: number, given: number): number {
  if (r.key === 'survive') return 0;
  return Math.max(0, Math.min(RIBBON.max, Math.floor(count / r.n)) - given);
}
