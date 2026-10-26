/**
 * Daily and weekly missions (progression step 5; progression-data.md D): three
 * a day (turning at 05:00 KST, one free swap a day, then up to three more for
 * 100 supply tickets each) and six a week (Monday), drawn from the lists below
 * without two of a kind. Picks are seeded by the profile and the day / week,
 * so the browser and the game server draw the same ones. Progress comes from
 * a match's counts (`MatchCounts`) plus a few things the profile works out
 * (finished matches, wins, weapon levels, camo tiers, modes).
 */
import { earn } from './income';
import { hashText, seeded } from './calendar';
import type { CountKey } from './ribbons';

/** What a mission counts: a match count, or one the profile works out after the match. */
export type MissionKey = CountKey | 'finished' | 'wins' | 'weaponLevels' | 'camoTiers' | 'modes' | `class.${string}` | 'seaDamage';

export interface MissionDef {
  id: string;
  key: MissionKey;
  n: number;
  name: [string, string];
}

export const MISSION = {
  daily: { count: 3, xp: 30_000, tickets: earn(100) },
  weekly: { count: 6, xp: 100_000, tickets: earn(500), allBoxes: 2 },
  /** Swaps a day: one free, then this many more at a price. */
  rerollFree: 1,
  rerollPaid: 3,
  rerollPrice: 100,
} as const;

const d = (id: string, key: MissionKey, n: number, ko: string, en: string): MissionDef => ({ id, key, n, name: [ko, en] });

export const DAILY: readonly MissionDef[] = [
  d('kills', 'kills', 25, '처치 25', '25 kills'),
  d('heads', 'headshots', 8, '헤드샷 8', '8 headshots'),
  d('caps', 'captures', 4, '거점 점령 4', 'Capture 4 zones'),
  d('revives', 'revives', 5, '소생 5', 'Revive 5'),
  d('supply', 'resupplies', 6, '보급 6', 'Resupply 6'),
  d('builds', 'builds', 3, '방어물 3 건설', 'Build 3 fortifications'),
  d('squad', 'squadKills', 10, '분대원 근처 처치 10', '10 kills near squad mates'),
  d('ar', 'kills.ar', 15, '돌격소총으로 처치 15', '15 kills with assault rifles'),
  d('smg', 'kills.smg', 15, '기관단총으로 처치 15', '15 kills with SMGs'),
  d('lmg', 'kills.lmg', 15, '경기관총으로 처치 15', '15 kills with LMGs'),
  d('sg', 'kills.sg', 10, '산탄총으로 처치 10', '10 kills with shotguns'),
  d('dmr', 'kills.dmr', 10, '지정사수 소총·저격총으로 처치 10', '10 kills with marksman or sniper rifles'),
  d('pistol', 'kills.pistol', 5, '권총으로 처치 5', '5 kills with pistols'),
  d('grenade', 'grenadeKills', 3, '수류탄으로 처치 3', '3 grenade kills'),
  d('ride', 'vehicleKills', 10, '차량에 타서 처치 10', '10 kills from vehicles'),
  d('armor', 'armorKills', 2, '적 차량 파괴 2', 'Destroy 2 enemy vehicles'),
  d('finish', 'finished', 3, '경기 3번 끝까지', 'Finish 3 matches'),
  d('wins', 'wins', 2, '승리 2', 'Win 2'),
  d('ribbons', 'ribbons', 5, '리본 5', 'Earn 5 ribbons'),
  d('medic', 'class.medic', 1, '의무병으로 경기 1번', 'Play a match as medic'),
  d('support', 'class.support', 1, '지원병으로 경기 1번', 'Play a match as support'),
  d('recon', 'class.recon', 1, '정찰병으로 경기 1번', 'Play a match as recon'),
  d('assault', 'class.assault', 1, '돌격병으로 경기 1번', 'Play a match as assault'),
  d('melee', 'meleeKills', 1, '근접 공격 처치 1', '1 melee kill'),
  d('callin', 'callins', 1, '지원 요청 1번', 'Call in support once'),
];

export const WEEKLY: readonly MissionDef[] = [
  d('kills', 'kills', 150, '처치 150', '150 kills'),
  d('heads', 'headshots', 50, '헤드샷 50', '50 headshots'),
  d('caps', 'captures', 25, '점령 25', '25 captures'),
  d('revives', 'revives', 30, '소생 30', '30 revives'),
  d('wins', 'wins', 10, '승리 10', '10 wins'),
  d('finish', 'finished', 15, '경기 15번 끝까지', 'Finish 15 matches'),
  d('weapons', 'weaponLevels', 3, '무기 레벨 3번 올리기', 'Gain 3 weapon levels'),
  d('camo', 'camoTiers', 3, '위장 단계 3개', 'Finish 3 camo tiers'),
  d('ribbons', 'ribbons', 30, '리본 30', '30 ribbons'),
  d('ride', 'vehicleKills', 40, '차량 처치 40', '40 kills from vehicles'),
  d('air', 'airKills', 5, '항공기 격추 5', 'Shoot down 5 aircraft'),
  d('sea', 'seaDamage', 200_000, '함선에 피해 20만', 'Deal 200,000 damage to ships'),
  d('modes', 'modes', 5, '모드 5가지에서 경기 끝까지', 'Finish matches in 5 modes'),
  d('callins', 'callins', 10, '분대 지원 요청 10번', 'Call in support 10 times'),
];

export interface MissionState {
  id: string;
  prog: number;
  done: boolean;
}

/** `count` missions from `list`, seeded (no two alike); `skip`: ids already shown. */
export function drawMissions(list: readonly MissionDef[], count: number, seed: string, skip: readonly string[] = []): MissionState[] {
  const rand = seeded(hashText(seed));
  const pool = list.filter((m) => !skip.includes(m.id));
  const out: MissionState[] = [];
  while (out.length < count && pool.length) {
    const i = Math.floor(rand() * pool.length);
    out.push({ id: pool[i]!.id, prog: 0, done: false });
    pool.splice(i, 1);
  }
  return out;
}

export function missionDef(daily: boolean, id: string): MissionDef | undefined {
  return (daily ? DAILY : WEEKLY).find((m) => m.id === id);
}
