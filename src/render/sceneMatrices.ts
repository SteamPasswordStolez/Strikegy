import * as THREE from 'three';

const baseUpdate = THREE.Object3D.prototype.updateMatrixWorld;

/** Stands for "draws on every layer": lights (every pass needs them) and things not walked. */
const ALL_LAYERS = -1;

/**
 * Layer masks of the scene's direct children, from the last update: the union of
 * the layers of everything shown in each subtree (see hideOffLayers).
 */
const topMasks = new WeakMap<THREE.Object3D, number>();

/**
 * The per-frame world-matrix update, like `scene.updateMatrixWorld()` but
 * skipping hidden subtrees. Three.js recomputes every object on each render
 * call, shown or not; on a big map most of the scene is hidden (fortification
 * spots not built yet, forest chunks drawing impostors, culled bots), and on a
 * phone this was the largest single script cost of a frame. A hidden object
 * whose parent moved meanwhile is flagged, so it catches up as soon as it
 * shows again. LOD levels are walked even when hidden: the renderer switches
 * them while drawing, after this update.
 *
 * The same walk notes which layers each top-level group draws on, so a pass
 * drawing only some layers (scenery, effects) can skip whole groups it would
 * otherwise walk object by object for nothing (hideOffLayers).
 */
export function updateShownMatrices(scene: THREE.Object3D): void {
  if (scene.matrixAutoUpdate) scene.updateMatrix();
  let force = false;
  if (scene.matrixWorldNeedsUpdate) {
    scene.matrixWorld.copy(scene.matrix);
    scene.matrixWorldNeedsUpdate = false;
    force = true;
  }
  const children = scene.children;
  for (let i = 0; i < children.length; i++) {
    const o = children[i]!;
    if (!o.visible) {
      if (force) o.matrixWorldNeedsUpdate = true;
      topMasks.set(o, 0);
      continue;
    }
    topMasks.set(o, visit(scene, o, force));
  }
}

/** Updates one shown object and what is under it; returns the layers drawn there. */
function visit(parent: THREE.Object3D, o: THREE.Object3D, force: boolean): number {
  if (o.updateMatrixWorld !== baseUpdate) {
    // Cameras, skinned meshes: their own update keeps derived matrices in step.
    o.updateMatrixWorld(force);
    return layersOf(o);
  }
  if (o.matrixAutoUpdate) o.updateMatrix();
  let f = force;
  if (o.matrixWorldNeedsUpdate || force) {
    if (o.matrixWorldAutoUpdate) o.matrixWorld.multiplyMatrices(parent.matrixWorld, o.matrix);
    o.matrixWorldNeedsUpdate = false;
    f = true;
  }
  let mask = ownLayers(o);
  if (o.children.length) mask |= walk(o, f);
  return mask;
}

/**
 * Layers an object draws on itself: groups, bones and LOD nodes draw nothing
 * (their own layers only matter to three.js for render-order groups), lights
 * count for every pass.
 */
function ownLayers(o: THREE.Object3D): number {
  if ((o as THREE.Light).isLight) return ALL_LAYERS;
  const r = o as THREE.Mesh & { isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
  return r.isMesh || r.isLine || r.isPoints || r.isSprite ? o.layers.mask : 0;
}

/** Layers drawn in a subtree updated by its own code (no matrix work here). */
function layersOf(o: THREE.Object3D): number {
  let mask = ownLayers(o);
  const lod = (o as THREE.LOD).isLOD === true;
  for (const c of o.children) if (c.visible || lod) mask |= layersOf(c);
  return mask;
}

function walk(parent: THREE.Object3D, force: boolean): number {
  const children = parent.children;
  const lod = (parent as THREE.LOD).isLOD === true;
  let mask = 0;
  for (let i = 0; i < children.length; i++) {
    const o = children[i]!;
    if (!o.visible && !lod) {
      if (force) o.matrixWorldNeedsUpdate = true;
      continue;
    }
    mask |= visit(parent, o, force);
  }
  return mask;
}

/**
 * Runs `draw` with the scene's top-level groups that draw nothing on
 * `layers` hidden (as of the last updateShownMatrices), then shows them again.
 * Three.js walks the whole scene on every render call and tests each object's
 * layers; a pass drawing only effects or only the scenery outside the map
 * otherwise walks the thousand-odd objects of the map for a handful of draws.
 * What gets drawn is the same: only groups with no shown object on those
 * layers (and no light) are skipped; groups added since the update are kept.
 */
export function hideOffLayers(scene: THREE.Object3D, layers: number, draw: () => void): void {
  const children = scene.children;
  const hidden: THREE.Object3D[] = [];
  for (let i = 0; i < children.length; i++) {
    const o = children[i]!;
    if (!o.visible) continue;
    const m = topMasks.get(o);
    if (m !== undefined && (m & layers) === 0) {
      o.visible = false;
      hidden.push(o);
    }
  }
  try {
    draw();
  } finally {
    for (const o of hidden) o.visible = true;
  }
}
