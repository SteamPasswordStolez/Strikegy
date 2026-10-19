import * as THREE from 'three';

/**
 * Gives a triangle soup an index (0..n-1) so it can be merged with indexed
 * geometry; indexed geometry is returned as it is.
 */
export function withIndex(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.index) return g;
  const n = g.getAttribute('position').count;
  const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/**
 * Indexed geometry with every vertex stored once: vertices whose attributes
 * are all exactly equal (bit for bit, as triangle soups copy them) become one.
 * The triangles and what they carry are unchanged, so it draws the same; the
 * vertex shader just runs once per distinct corner instead of once per
 * triangle corner (2026-10-19: a soldier skinned 36k vertices for 9k distinct
 * ones; 10 near soldiers drew in 1.9 ms, 0.7 ms welded, Iris Xe).
 */
export function weld(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const names = Object.keys(g.attributes);
  const attrs = names.map((n) => g.getAttribute(n));
  if (attrs.some((a) => !(a instanceof THREE.BufferAttribute))) return withIndex(g);
  // Compared and hashed as integers: floats by their bits.
  const words: ArrayLike<number>[] = attrs.map((a) => {
    const arr = a.array;
    return arr instanceof Float32Array ? new Uint32Array(arr.buffer, arr.byteOffset, arr.length) : arr;
  });
  const sizes = attrs.map((a) => a.itemSize);
  const count = g.getAttribute('position').count;
  const order = g.index ? g.index.array : null;
  const n = order ? order.length : count;
  let size = 1;
  while (size < count * 2) size <<= 1;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const remap = new Int32Array(count).fill(-1);
  const keep = new Int32Array(count);
  let kept = 0;
  const index = new Uint32Array(n);
  const A = words.length;
  for (let i = 0; i < n; i++) {
    const v = order ? order[i]! : i;
    let id = remap[v]!;
    if (id < 0) {
      let h = 2166136261;
      for (let k = 0; k < A; k++) {
        const arr = words[k]!;
        const s = sizes[k]!;
        for (let c = v * s, e = c + s; c < e; c++) h = Math.imul(h ^ arr[c]!, 16777619);
      }
      let slot = (h >>> 0) & mask;
      for (;;) {
        const at = table[slot]!;
        if (at < 0) {
          id = kept;
          keep[kept++] = v;
          table[slot] = id;
          break;
        }
        const u = keep[at]!;
        let same = true;
        for (let k = 0; k < A && same; k++) {
          const arr = words[k]!;
          const s = sizes[k]!;
          for (let c = 0; c < s; c++) {
            if (arr[u * s + c] !== arr[v * s + c]) {
              same = false;
              break;
            }
          }
        }
        if (same) {
          id = at;
          break;
        }
        slot = (slot + 1) & mask;
      }
      remap[v] = id;
    }
    index[i] = id;
  }
  const out = new THREE.BufferGeometry();
  names.forEach((name, k) => {
    const a = attrs[k] as THREE.BufferAttribute;
    const s = sizes[k]!;
    const src = a.array as Float32Array;
    const dst = new (src.constructor as new (len: number) => Float32Array)(kept * s);
    for (let j = 0; j < kept; j++) for (let c = 0, from = keep[j]! * s; c < s; c++) dst[j * s + c] = src[from + c]!;
    out.setAttribute(name, new THREE.BufferAttribute(dst, s, a.normalized));
  });
  out.setIndex(new THREE.BufferAttribute(kept > 65535 ? index : Uint16Array.from(index), 1));
  for (const gr of g.groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
  return out;
}
