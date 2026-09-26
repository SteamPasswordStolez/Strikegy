import type * as THREE from 'three';
import type { EventBus } from './EventBus';
import type { GrenadeType } from '@/combat/explosions';
import type { ImpactSurface } from '@/physics/surfaces';

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
  /** A bullet struck world geometry. */
  'combat:impact': { point: THREE.Vector3; normal: THREE.Vector3; surface: ImpactSurface };
  'combat:hit': {
    targetId: number;
    part: HitPart;
    damage: number;
    killed: boolean;
    point: THREE.Vector3;
  };
  'combat:kill': { attacker: string; victim: string; weapon: string; headshot: boolean };
  'grenade:thrown': { type: GrenadeType; remaining: number };
  'grenade:bounce': { type: GrenadeType; point: THREE.Vector3; speed: number };
  'grenade:detonate': { type: GrenadeType; point: THREE.Vector3 };
  'player:landed': { impactSpeed: number };
  'player:footstep': { surface: ImpactSurface; sprinting: boolean; point: THREE.Vector3 };
  'player:damaged': { amount: number; from: THREE.Vector3 | null; cause: DamageCause };
  'player:flashed': { intensity: number; duration: number };
  'player:died': { cause: DamageCause };
  'player:respawned': Record<string, never>;
}

export type GameBus = EventBus<GameEvents>;
