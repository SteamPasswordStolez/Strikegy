import * as THREE from 'three';
import {
  POST_VEHICLE,
  isPost,
  type FortSlot,
  type Fortifications,
  type PlannedSlot,
  type PostKind,
} from '@/modes/fortify';
import type { Vehicle } from './Vehicle';
import type { VehicleWorld } from './VehicleWorld';

/** Without building (simplified controls: no fortifications), a wrecked fixed weapon is back after this long (s). */
export const POST_RESPAWN = 60;

/** Where a plan's fixed weapons stand (pads and tank spots keep clear of them). */
export function postPlaces(plan: { slots: readonly PlannedSlot[] } | null): THREE.Vector3[] {
  return (plan?.slots ?? []).filter((s) => isPost(s.kind)).map((s) => new THREE.Vector3(...s.pos));
}

/** One fixed weapon's place: the weapon standing there now (a vehicle id), and its build spot when there is building. */
export interface PostSpot {
  kind: PostKind;
  zone: string;
  pos: THREE.Vector3;
  yaw: number;
  slot: FortSlot | null;
  vehicle: number | null;
  /** When the last one there was cleared away (game time). */
  downAt: number;
}

/**
 * Keeps the fixed weapons (emplacements.ts) at their planned places, on the
 * side that runs the vehicles (solo play, the game server): all up when the
 * match starts; a wrecked one's spot is a blueprint once the wreck is cleared,
 * built back in build mode (the spot's `complete` brings the weapon out
 * again); with no building, it comes back on its own after `POST_RESPAWN`.
 */
export class PostKeeper {
  readonly spots: PostSpot[];
  private time = 0;

  constructor(
    private readonly vehicles: VehicleWorld,
    planned: readonly PlannedSlot[],
    private readonly fort: Fortifications | null,
  ) {
    if (fort) {
      this.spots = fort.slots
        .filter((s) => isPost(s.kind))
        .map((s) => ({
          kind: s.kind as PostKind,
          zone: s.zone,
          pos: s.pos.clone(),
          yaw: s.yaw,
          slot: s,
          vehicle: null,
          downAt: -Infinity,
        }));
      fort.onPost = (slot) => {
        const spot = this.spots.find((p) => p.slot === slot);
        if (spot) this.raise(spot);
      };
    } else {
      this.spots = planned
        .filter((p) => isPost(p.kind))
        .map((p) => ({
          kind: p.kind as PostKind,
          zone: p.zone,
          pos: new THREE.Vector3(...p.pos),
          yaw: p.yaw,
          slot: null,
          vehicle: null,
          downAt: -Infinity,
        }));
    }
  }

  /** Every fixed weapon up (the start of the match). */
  start(): void {
    for (const s of this.spots) {
      if (s.slot) this.fort!.complete(s.slot);
      else this.raise(s);
    }
  }

  private raise(s: PostSpot): void {
    if (s.vehicle !== null && this.vehicles.get(s.vehicle)) return;
    // Nobody's: whoever gets to it first works it.
    s.vehicle = this.vehicles.spawn(POST_VEHICLE[s.kind], s.pos, s.yaw, null).id;
  }

  /** A vehicle went (the world cleared it away): if it was a fixed weapon, its spot is a blueprint again. */
  removed(v: Vehicle): void {
    const s = this.spots.find((p) => p.vehicle === v.id);
    if (!s) return;
    s.vehicle = null;
    s.downAt = this.time;
    if (s.slot) this.fort!.destroy(s.slot);
  }

  /** Per sim step: without building, wrecked weapons come back after a while. */
  step(dt: number): void {
    this.time += dt;
    for (const s of this.spots)
      if (!s.slot && s.vehicle === null && this.time > s.downAt + POST_RESPAWN) this.raise(s);
  }
}
