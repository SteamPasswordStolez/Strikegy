import type { EventBus } from './EventBus';

export type HitPart = 'head' | 'body' | 'limb';

export interface GameEvents {
  'weapon:fired': { weaponId: string; ads: boolean };
  'weapon:reloadStart': { weaponId: string };
  'weapon:reloadEnd': { weaponId: string };
  'weapon:dryFire': { weaponId: string };
  'combat:hit': { targetId: number; part: HitPart; damage: number; killed: boolean };
  'player:landed': { impactSpeed: number };
}

export type GameBus = EventBus<GameEvents>;
