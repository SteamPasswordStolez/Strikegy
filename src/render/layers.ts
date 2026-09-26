/**
 * Camera layers. Transparent effects (particles, tracers) live on FX so the
 * post-processing chain can draw them after ambient occlusion; otherwise AO of
 * the geometry behind smoke would be multiplied on top of it.
 */
export const LAYER_WORLD = 0;
export const LAYER_FX = 1;
/**
 * Scenery outside the playable area. Drawn with the world but skipped by the AO
 * pass, which would otherwise render hundreds of thousands of distant triangles
 * a second time for occlusion nobody can see at that range.
 */
export const LAYER_BACKDROP = 2;
