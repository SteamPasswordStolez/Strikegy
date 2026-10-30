import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hideOffLayers, updateShownMatrices } from '@/render/sceneMatrices';

describe('updateShownMatrices', () => {
  it('matches three.js for shown objects, skips hidden ones and catches them up when shown', () => {
    const scene = new THREE.Scene();
    const parent = new THREE.Group();
    const shown = new THREE.Object3D();
    const hidden = new THREE.Object3D();
    shown.position.set(1, 0, 0);
    hidden.position.set(0, 0, 2);
    hidden.visible = false;
    parent.add(shown, hidden);
    scene.add(parent);
    updateShownMatrices(scene);
    parent.position.set(10, 0, 0);
    updateShownMatrices(scene);
    const at = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    expect(at(shown).toArray()).toEqual([11, 0, 0]);
    // Skipped while hidden even though its parent moved...
    expect(at(hidden).toArray()).toEqual([0, 0, 0]);
    hidden.visible = true;
    updateShownMatrices(scene);
    // ...and right once it shows.
    expect(at(hidden).toArray()).toEqual([10, 0, 2]);
  });

  it('walks hidden LOD levels (the renderer switches them after the update)', () => {
    const scene = new THREE.Scene();
    const lod = new THREE.LOD();
    const far = new THREE.Object3D();
    far.visible = false;
    lod.add(far);
    lod.position.set(0, 5, 0);
    scene.add(lod);
    updateShownMatrices(scene);
    expect(new THREE.Vector3().setFromMatrixPosition(far.matrixWorld).y).toBe(5);
  });

  it('skips top-level groups with nothing on the drawn layers, keeping lights and restoring them after', () => {
    const scene = new THREE.Scene();
    const world = new THREE.Group();
    world.add(new THREE.Mesh());
    const fx = new THREE.Group();
    const spark = new THREE.Mesh();
    spark.layers.set(1);
    fx.add(spark);
    const mixed = new THREE.Group();
    const smoke = new THREE.Mesh();
    smoke.layers.set(1);
    mixed.add(new THREE.Mesh(), smoke);
    const sun = new THREE.DirectionalLight();
    scene.add(world, fx, mixed, sun);
    updateShownMatrices(scene);
    const shownDuring = (layers: number) => {
      let shown: THREE.Object3D[] = [];
      hideOffLayers(scene, layers, () => (shown = scene.children.filter((o) => o.visible)));
      return shown;
    };
    expect(shownDuring(1 << 1)).toEqual([fx, mixed, sun]);
    expect(shownDuring(1 << 0)).toEqual([world, mixed, sun]);
    expect(shownDuring(1 << 2)).toEqual([sun]);
    expect(scene.children.every((o) => o.visible)).toBe(true);
    // A group added after the update is kept whatever it holds.
    const late = new THREE.Group();
    scene.add(late);
    expect(shownDuring(1 << 2)).toEqual([sun, late]);
  });
});
