import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { StaticBatch } from '@/render/staticBatch';

describe('StaticBatch', () => {
  it('draws everything added as one mesh per material, in place, and follows removals', () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    const make = (x: number): THREE.Group => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), a));
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), b);
      m.position.y = 3;
      m.castShadow = true;
      g.add(m);
      g.position.set(x, 0, 0);
      g.rotation.y = 0.5;
      return g;
    };
    const batch = new StaticBatch('t');
    for (let i = 0; i < 10; i++) batch.add(i, make(i * 5));
    batch.flush();
    expect(batch.group.children.length).toBe(2);
    const tris = (): number =>
      batch.group.children.reduce(
        (n, c) => n + (c as THREE.Mesh).geometry.getAttribute('position').count / 3,
        0,
      );
    expect(tris()).toBe(10 * 2 * 12);
    // In world space where the objects stood (the last one's box reaches past x = 45).
    const bMesh = batch.group.children.find((c) => (c as THREE.Mesh).material === b) as THREE.Mesh;
    expect(bMesh.castShadow).toBe(true);
    bMesh.geometry.computeBoundingBox();
    expect(bMesh.geometry.boundingBox!.max.x).toBeGreaterThan(45);
    expect(bMesh.geometry.boundingBox!.min.y).toBeCloseTo(2, 5);
    batch.remove(3);
    batch.remove(99);
    batch.flush();
    expect(tris()).toBe(9 * 2 * 12);
  });
});
