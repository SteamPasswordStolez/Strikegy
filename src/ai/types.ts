import type * as THREE from 'three';
import type { Team } from '@/world/mapTypes';

/** The human player's team and combatant id. */
export const PLAYER_TEAM: Team = 'blue';
export const PLAYER_ID = 0;

/** Anything bots can see, hear, target and shoot: other bots and the player. */
export interface Combatant {
  readonly id: number;
  readonly name: string;
  readonly team: Team;
  readonly alive: boolean;
  /** Feet position (current sim state). */
  readonly feet: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  /** Eye height above the feet (lower when crouched). */
  readonly eyeHeight: number;
  /** Sim time until which this combatant counts as "just fired" (easier to spot). */
  readonly firingUntil: number;
}

export function otherTeam(t: Team): Team {
  return t === 'blue' ? 'red' : 'blue';
}
