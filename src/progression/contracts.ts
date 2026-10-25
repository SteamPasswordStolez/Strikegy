/**
 * Field contracts (작전 계약; progression step 5, progression-data.md S-1): on
 * the deploy screen one of three short goals is picked for the match; met by
 * the end, it pays its supply tickets (bot-match multipliers apply). Offers
 * are seeded by the profile and the match, so a reload shows the same three.
 */
import { hashText, seeded } from './calendar';
import type { CountKey } from './ribbons';

export interface ContractDef {
  id: string;
  /** A match count, or kills in one life without dying (`lifeKills`). */
  key: CountKey | 'lifeKills';
  n: number;
  tickets: number;
  name: [string, string];
}

export const CONTRACTS: readonly ContractDef[] = [
  { id: 'caps', key: 'captures', n: 2, tickets: 200, name: ['거점 2회 점령', 'Capture 2 zones'] },
  { id: 'heads', key: 'headshots', n: 5, tickets: 150, name: ['헤드샷 5', '5 headshots'] },
  { id: 'revives', key: 'revives', n: 4, tickets: 150, name: ['소생 4', 'Revive 4'] },
  { id: 'armor', key: 'armorKills', n: 1, tickets: 250, name: ['적 차량 1대 파괴', 'Destroy an enemy vehicle'] },
  { id: 'builds', key: 'builds', n: 4, tickets: 150, name: ['방어물 4개 건설', 'Build 4 fortifications'] },
  { id: 'streak', key: 'lifeKills', n: 5, tickets: 300, name: ['죽지 않고 처치 5', '5 kills in one life'] },
  { id: 'kills', key: 'kills', n: 12, tickets: 150, name: ['처치 12', '12 kills'] },
  { id: 'supply', key: 'resupplies', n: 5, tickets: 150, name: ['보급 5', 'Resupply 5'] },
  { id: 'squad', key: 'squadKills', n: 5, tickets: 200, name: ['분대원 근처 처치 5', '5 kills near squad mates'] },
];

/** The rerolls a match allows (50 tickets each). */
export const CONTRACT_REROLL = { price: 50, max: 3 } as const;

/** Three contracts for a match; `roll`: the rerolls taken. */
export function contractOffer(seed: string, roll = 0): ContractDef[] {
  const rand = seeded(hashText(`${seed}:c${roll}`));
  const pool = [...CONTRACTS];
  const out: ContractDef[] = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  return out;
}

export function contractDef(id: string): ContractDef | undefined {
  return CONTRACTS.find((c) => c.id === id);
}
