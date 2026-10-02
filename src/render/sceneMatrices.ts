import * as THREE from 'three';

const baseUpdate = THREE.Object3D.prototype.updateMatrixWorld;

/**
 * The per-frame world-matrix update, like `scene.updateMatrixWorld()` but
 * skipping hidden subtrees. Three.js recomputes every object on each render
 * call, shown or not; on a big map most of the scene is hidden (fortification
 * spots not built yet, forest chunks drawing impostors, culled bots), and on a
 * phone this was the largest single script cost of a frame. A hidden object
 * whose parent moved meanwhile is flagged, so it catches up as soon as it
 * shows again. LOD levels are walked even when hidden: the renderer switches
 * them while drawing, after this update.
 */
export function updateShownMatrices(scene: THREE.Object3D): void {
  if (scene.matrixAutoUpdate) scene.updateMatrix();
  let force = false;
  if (scene.matrixWorldNeedsUpdate) {
    scene.matrixWorld.copy(scene.matrix);
    scene.matrixWorldNeedsUpdate = false;
    force = true;
  }
  walk(scene, force);
}

function walk(parent: THREE.Object3D, force: boolean): void {
  const children = parent.children;
  const lod = (parent as THREE.LOD).isLOD === true;
  for (let i = 0; i < children.length; i++) {
    const o = children[i]!;
    if (!o.visible && !lod) {
      if (force) o.matrixWorldNeedsUpdate = true;
      continue;
    }
    if (o.updateMatrixWorld !== baseUpdate) {
      // Cameras, skinned meshes: their own update keeps derived matrices in step.
      o.updateMatrixWorld(force);
      continue;
    }
    if (o.matrixAutoUpdate) o.updateMatrix();
    let f = force;
    if (o.matrixWorldNeedsUpdate || force) {
      if (o.matrixWorldAutoUpdate) o.matrixWorld.multiplyMatrices(parent.matrixWorld, o.matrix);
      o.matrixWorldNeedsUpdate = false;
      f = true;
    }
    if (o.children.length) walk(o, f);
  }
}
