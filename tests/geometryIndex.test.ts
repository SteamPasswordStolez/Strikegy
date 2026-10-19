import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { weld, withIndex } from '@/render/geometryIndex';

/** Every triangle corner's attributes in draw order (what the GPU is asked to draw). */
function corners(g: THREE.BufferGeometry): number[] {
  const out: number[] = [];
  const n = g.index ? g.index.count : g.getAttribute('position').count;
  const names = Object.keys(g.attributes).sort();
  for (let i = 0; i < n; i++) {
    const v = g.index ? g.index.getX(i) : i;
    for (const name of names) {
      const a = g.getAttribute(name);
      for (let c = 0; c < a.itemSize; c++) out.push(a.array[v * a.itemSize + c]!);
    }
  }
  return out;
}

describe('geometry welding', () => {
  it('draws the same triangles with far fewer vertices', () => {
    const soup = new RoundedBoxGeometry(0.3, 0.2, 0.1, 3, 0.03);
    soup.deleteAttribute('uv');
    const w = weld(soup);
    expect(corners(w)).toEqual(corners(soup));
    expect(w.getAttribute('position').count).toBeLessThan(soup.getAttribute('position').count / 2);
  });

  it('keeps vertices apart that differ in any attribute (hard edges, colours)', () => {
    const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const w = weld(box);
    // A box's corners carry a normal per face: 24 distinct vertices.
    expect(w.getAttribute('position').count).toBe(24);
    expect(corners(w)).toEqual(corners(box));
  });

  it('merges indexed parts with soups', () => {
    const a = withIndex(new THREE.BoxGeometry(1, 1, 1));
    const b = withIndex(new THREE.SphereGeometry(0.5, 8, 6).toNonIndexed());
    for (const g of [a, b]) g.deleteAttribute('uv');
    const merged = mergeGeometries([a, b], false)!;
    const w = weld(merged);
    expect(corners(w)).toEqual(corners(merged));
  });
});
