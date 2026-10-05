import * as THREE from 'three';

/** An added object's meshes, already in world space with only the attributes the merge keeps. */
interface Prepared {
  material: THREE.Material;
  geo: THREE.BufferGeometry;
  cast: boolean;
  receive: boolean;
}

interface Cell {
  ids: Set<number>;
  meshes: THREE.Mesh[];
  dirty: boolean;
}

/**
 * Objects that don't move, drawn as one merged mesh per material: each
 * object added is a few meshes, and every mesh is a draw call per pass (the
 * zone stations alone were ~40 a frame). Add / remove by id; `flush` merges
 * again after a change. Objects can be put in cells (a zone, say): a change
 * merges only its cell again, from geometry prepared when the object was
 * added, so things that change often in a big fight (fortifications built or
 * knocked down) stay cheap.
 *
 * Objects are merged in their pose when added; the batch's group should sit
 * at the origin of the scene.
 */
export class StaticBatch {
  readonly group = new THREE.Group();
  private readonly objects = new Map<number, { cell: string; parts: Prepared[] }>();
  private readonly cells = new Map<string, Cell>();
  private dirty = false;

  constructor(name: string) {
    this.group.name = name;
    this.group.matrixAutoUpdate = false;
  }

  add(id: number, obj: THREE.Object3D, cell = ''): void {
    this.remove(id);
    const parts: Prepared[] = [];
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const g = (
        mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
      ).applyMatrix4(mesh.matrixWorld);
      for (const k of Object.keys(g.attributes))
        if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        else g.setAttribute(k, plain(g.getAttribute(k)));
      const n = g.getAttribute('position').count;
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (!g.getAttribute('uv'))
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      parts.push({
        material: mesh.material,
        geo: g,
        cast: mesh.castShadow,
        receive: mesh.receiveShadow,
      });
    });
    this.objects.set(id, { cell, parts });
    let c = this.cells.get(cell);
    if (!c) this.cells.set(cell, (c = { ids: new Set(), meshes: [], dirty: false }));
    c.ids.add(id);
    c.dirty = this.dirty = true;
  }

  remove(id: number): void {
    const o = this.objects.get(id);
    if (!o) return;
    this.objects.delete(id);
    for (const p of o.parts) p.geo.dispose();
    const c = this.cells.get(o.cell)!;
    c.ids.delete(id);
    c.dirty = this.dirty = true;
  }

  get size(): number {
    return this.objects.size;
  }

  /** Merges the cells that changed again. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const c of this.cells.values()) if (c.dirty) this.mergeCell(c);
  }

  private mergeCell(c: Cell): void {
    c.dirty = false;
    for (const m of c.meshes) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    c.meshes.length = 0;
    const byMat = new Map<
      THREE.Material,
      { geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean }
    >();
    for (const id of c.ids) {
      for (const p of this.objects.get(id)!.parts) {
        let e = byMat.get(p.material);
        if (!e) byMat.set(p.material, (e = { geos: [], cast: false, receive: false }));
        e.geos.push(p.geo);
        e.cast ||= p.cast;
        e.receive ||= p.receive;
      }
    }
    for (const [material, e] of byMat) {
      const merged = concat(e.geos);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = e.cast;
      mesh.receiveShadow = e.receive;
      mesh.matrixAutoUpdate = false;
      c.meshes.push(mesh);
      this.group.add(mesh);
    }
  }
}

/** Non-indexed geometries with plain position / normal / uv arrays, one after another. */
function concat(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of geos) n += g.getAttribute('position').count;
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
    ['uv', 2],
  ] as const) {
    const arr = new Float32Array(n * size);
    let at = 0;
    for (const g of geos) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      arr.set(a.array as Float32Array, at);
      at += a.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

/** The attribute as a plain float array (interleaved, integer or normalised ones from model files are converted). */
function plain(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  if (
    !(a instanceof THREE.InterleavedBufferAttribute) &&
    a.array instanceof Float32Array &&
    !a.normalized
  )
    return a;
  const size = a.itemSize;
  const out = new Float32Array(a.count * size);
  const get = [a.getX, a.getY, a.getZ, a.getW] as const;
  for (let i = 0; i < a.count; i++)
    for (let j = 0; j < size; j++) out[i * size + j] = get[j]!.call(a, i);
  return new THREE.BufferAttribute(out, size);
}
