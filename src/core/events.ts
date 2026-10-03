import type * as THREE from 'three';
import type { EventBus } from './EventBus';
import type { GrenadeType } from '@/combat/explosions';
import type { ImpactSurface } from '@/physics/surfaces';
import type { Team } from '@/world/mapTypes';
import type { ModeEvent } from '@/modes/matchRules';

/** Who threw a grenade (damage attribution, friendly fire). */
export interface GrenadeOwner {
  id: number;
  name: string;
  team: Team;
}

export type HitPart = 'head' | 'body' | 'limb';
export type ReloadCue = 'magOut' | 'magIn' | 'chamber' | 'shell';
export type DamageCause = 'bullet' | 'explosion' | 'fall';

export interface GameEvents {
  'weapon:fired': { weaponId: string; ads: boolean };
  'weapon:reloadStart': { weaponId: string };
  'weapon:reloadEnd': { weaponId: string };
  'weapon:reloadCue': { weaponId: string; cue: ReloadCue };
  /** Bolt or pump worked after a shot. */
  'weapon:cycle': { weaponId: string };
  'weapon:dryFire': { weaponId: string };
  'weapon:switched': { weaponId: string };
  /** Melee swing started. */
  'weapon:meleeSwing': { weaponId: string };
  /** Melee swing reached its strike point: what it met. */
  'weapon:melee': { weaponId: string; hit: 'body' | 'world' | 'none' };
  /** Inspection magazine check (sound cue). */
  'weapon:inspectCue': { weaponId: string; cue: 'magOut' | 'magIn' };
  /** A bullet struck world geometry. */
  'combat:impact': { point: THREE.Vector3; normal: THREE.Vector3; surface: ImpactSurface };
  'combat:hit': {
    targetId: number;
    part: HitPart;
    damage: number;
    killed: boolean;
    point: THREE.Vector3;
    /** Hit dealt by the local player (hitmarker, hit sound). */
    byPlayer: boolean;
  };
  'combat:kill': {
    attacker: string;
    victim: string;
    weapon: string;
    headshot: boolean;
    byPlayer: boolean;
    attackerTeam?: Team | null;
    victimTeam?: Team | null;
    /** Combatant ids (scoreboard); absent for practice targets. */
    attackerId?: number;
    victimId?: number;
  };
  'grenade:thrown': { type: GrenadeType; remaining: number };
  'grenade:bounce': { type: GrenadeType; point: THREE.Vector3; speed: number };
  'grenade:detonate': { type: GrenadeType; point: THREE.Vector3; owner: GrenadeOwner };
  'player:landed': { impactSpeed: number; surface?: ImpactSurface };
  'player:footstep': { surface: ImpactSurface; sprinting: boolean; point: THREE.Vector3 };
  'player:damaged': { amount: number; from: THREE.Vector3 | null; cause: DamageCause };
  'player:flashed': { intensity: number; duration: number };
  'player:died': { cause: DamageCause };
  'player:respawned': Record<string, never>;
  /** Anyone (player or bot) died for good (bled out or gave up); modes count tickets from this. */
  'combatant:died': { team: Team; id: number };
  /** A downed soldier was revived by `byId` (tickets and the death are spared). */
  /** `byId` handed `id` a medkit or ammo (score). */
  'combatant:resupplied': { byId: number; id: number };
  'combatant:revived': { team: Team; id: number; name: string; byId: number; byName: string; medic: boolean };
  'zone:captured': { zone: string; team: Team };
  /** `team` lost the zone (it is neutral now). */
  'zone:neutralized': { zone: string; team: Team };
  /** Mode news: a sector taken, a new attack, the attack timer moved, tickets added. */
  'mode:event': ModeEvent;
  'match:ended': { winner: Team };
}

export type GameBus = EventBus<GameEvents>;
