import type { SurfaceMaterial } from '@/world/mapTypes';

/** Acoustic / visual response of a surface to bullets, footsteps and debris. */
export type ImpactSurface = 'dirt' | 'concrete' | 'metal' | 'wood' | 'brick' | 'rubber';

export const SURFACE_FROM_MATERIAL: Record<SurfaceMaterial, ImpactSurface> = {
  ground: 'dirt',
  concrete: 'concrete',
  concrete_floor: 'concrete',
  metal: 'metal',
  wood: 'wood',
  brick: 'brick',
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

/** Collider handle -> surface lookup, filled in as the world is built. */
export class SurfaceRegistry {
  private map = new Map<number, ImpactSurface>();

  set(handle: number, surface: ImpactSurface): void {
    this.map.set(handle, surface);
  }

  get(handle: number): ImpactSurface {
    return this.map.get(handle) ?? 'concrete';
  }
}
