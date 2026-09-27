import type * as THREE from 'three';
import type { Team } from '@/world/mapTypes';

/**
 * Squads: small fixed groups within a team. Members can spawn on a living
 * squadmate who is not in a fight, and a squad that is wiped out entirely
 * waits longer to come back.
 */

export const SQUAD_SIZE = 4;
/** Fired, got hit or had an enemy in sight this recently = in combat. */
export const COMBAT_WINDOW = 5;
/** Extra respawn wait for everyone in a squad that was wiped out. */
export const WIPE_PENALTY = 5;

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa'];

export interface SquadMember {
  readonly id: number;
  readonly name: string;
  readonly team: Team;
  readonly alive: boolean;
  readonly feet: THREE.Vector3;
  readonly yaw: number;
  inCombat(now: number): boolean;
}

export class Squad {
  constructor(
    readonly index: number,
    readonly team: Team,
    readonly name: string,
    readonly members: SquadMember[],
  ) {}

  get wiped(): boolean {
    return this.members.every((m) => !m.alive);
  }

  has(id: number): boolean {
    return this.members.some((m) => m.id === id);
  }

  mates(id: number): SquadMember[] {
    return this.members.filter((m) => m.id !== id);
  }
}

/** Splits members into squads of `size` in order (the first member leads the first squad). */
export function formSquads(team: Team, members: readonly SquadMember[], size = SQUAD_SIZE, firstIndex = 0): Squad[] {
  const out: Squad[] = [];
  for (let i = 0; i < members.length; i += size) {
    const index = firstIndex + out.length;
    out.push(new Squad(index, team, NAMES[index % NAMES.length]!, members.slice(i, i + size)));
  }
  return out;
}

export type MateSpawnBlock = 'dead' | 'combat' | null;

/** Why a squadmate cannot be spawned on right now (null = allowed). */
export function mateSpawnBlock(m: SquadMember, now: number): MateSpawnBlock {
  if (!m.alive) return 'dead';
  if (m.inCombat(now)) return 'combat';
  return null;
}
