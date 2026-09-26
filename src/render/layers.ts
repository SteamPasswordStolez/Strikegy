/**
 * Camera layers. Transparent effects (particles, tracers) live on FX so the
 * post-processing chain can draw them after ambient occlusion; otherwise AO of
 * the geometry behind smoke would be multiplied on top of it.
 */
export const LAYER_WORLD = 0;
export const LAYER_FX = 1;
