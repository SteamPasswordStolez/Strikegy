import type { SurfaceMaterial } from '@/world/mapTypes';

/** Acoustic / visual response of a surface to bullets, footsteps and debris. */
export type ImpactSurface = 'dirt' | 'concrete' | 'metal' | 'wood' | 'brick' | 'rubber' | 'grass' | 'snow';

export const SURFACE_FROM_MATERIAL: Record<SurfaceMaterial, ImpactSurface> = {
  ground: 'dirt',
  concrete: 'concrete',
  concrete_floor: 'concrete',
  metal: 'metal',
  wood: 'wood',
  brick: 'brick',
  snow: 'snow',
  grass: 'grass',
  sand: 'dirt',
  plaster: 'concrete',
  brick_old: 'brick',
  roof: 'brick',
  asphalt: 'concrete',
  cobble: 'concrete',
  rock: 'concrete',
};

/** Impact surface for each prop model; unknown models default to wood. */
export const SURFACE_FROM_MODEL: Record<string, ImpactSurface> = {
  wooden_military_crate: 'wood',
  old_military_crate: 'wood',
  ammo_box: 'metal',
  barrel_03: 'metal',
  metal_jerrycan_green: 'metal',
  old_tyre: 'rubber',
  concrete_road_barrier: 'concrete',
};

/** A rotated rectangle painted on a collider (e.g. a road on the terrain). */
interface Patch {
  x: number;
  z: number;
  cos: number;
  sin: number;
  hw: number;
  hd: number;
  surface: ImpactSurface;
}

/** Collider handle -> surface lookup, filled in as the world is built. */
export class SurfaceRegistry {
  private map = new Map<number, ImpactSurface>();
  private patches = new Map<number, Patch[]>();

  set(handle: number, surface: ImpactSurface): void {
    this.map.set(handle, surface);
  }

  /** Marks a w x d rectangle (yaw in radians) on collider `handle` as `surface`; later patches win. */
  paint(handle: number, x: number, z: number, yaw: number, w: number, d: number, surface: ImpactSurface): void {
    let list = this.patches.get(handle);
    if (!list) this.patches.set(handle, (list = []));
    list.push({ x, z, cos: Math.cos(yaw), sin: Math.sin(yaw), hw: w / 2, hd: d / 2, surface });
  }

  /** Painted patches on collider `handle` (roads and the like on the terrain), in painting order. */
  patchesOf(handle: number): readonly Readonly<Patch>[] {
    return this.patches.get(handle) ?? [];
  }

  /** Surface of collider `handle`, at `at` when it has painted patches. */
  get(handle: number, at?: { x: number; z: number }): ImpactSurface {
    const list = at && this.patches.get(handle);
    if (list) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]!;
        const dx = at.x - p.x;
        const dz = at.z - p.z;
        // Into the patch's frame (inverse of its yaw about +Y).
        if (Math.abs(dx * p.cos - dz * p.sin) <= p.hw && Math.abs(dx * p.sin + dz * p.cos) <= p.hd) return p.surface;
      }
    }
    return this.map.get(handle) ?? 'concrete';
  }
}
