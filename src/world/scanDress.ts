import * as THREE from 'three';
import type { ModelLibrary } from '@/render/models';
import { instanceModel } from './placeProps';
import type { MapDef, MapObject } from './mapTypes';
import type { Terrain } from './terrain';

/**
 * Scanned models laid over the map's plain boxes (owner, 2026-10-26;
 * props-rework.md stage 1, Poly Haven CC0): boulders along rock walls with
 * stones at their feet, manhole covers on wide asphalt. Render only: the boxes
 * keep their colliders and their own dressed look (`boxDress`) underneath, so
 * gaps show a lumpy rock core and the far look stays the box. Grouped in cells
 * and drawn near the camera only (`cullScanDressing`), like the backdrop's
 * clutter; no shadows cast (the static shadow map would have to redraw as
 * cells come and go).
 */

// boulder_01 was tried and left out: it would not simplify below ~56k triangles.
const BOULDERS = ['namaqualand_boulder_02', 'namaqualand_boulder_04'];
const STONES = ['rock_07', 'rock_09', 'stone_01'];
const MANHOLE = 'water_manhole_cover';
/** Drawn within these distances (m) of the camera: past them the rock cores and boxes stand alone (stones and manholes are a few pixels). */
const RANGE: Record<string, number> = { boulder: 65, stone: 35, manhole: 40 };
const rangeOf = (model: string) => (model === MANHOLE ? RANGE.manhole! : STONES.includes(model) ? RANGE.stone! : RANGE.boulder!);

const DEG = Math.PI / 180;

/** A map box that is a rock wall / outcrop (not a kit). */
const isRock = (o: MapObject) => !o.model && o.material === 'rock' && (o.type === 'wall' || o.type === 'cover');
/** A wide asphalt surface (roads, yards) that can take manhole covers. */
const isAsphalt = (o: MapObject) => !o.model && o.material === 'asphalt' && o.type === 'floor' && o.size[0] * o.size[2] >= 60;

/** The scanned models a map's dressing uses (load them with the map's props). */
export function scanModelsFor(map: MapDef): string[] {
  const out: string[] = [];
  if (map.objects.some(isRock)) out.push(...BOULDERS, ...STONES);
  if (map.objects.some(isAsphalt)) out.push(MANHOLE);
  return out;
}

/** Deterministic 0..1 from a few numbers (the same layout every load and every browser). */
function hash(...v: number[]): number {
  let h = 2166136261;
  for (const x of v) {
    h ^= Math.round(x * 1000);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

interface Sized {
  /** Model-space extents and the offset that puts its bottom centre at the origin. */
  size: THREE.Vector3;
  offset: THREE.Vector3;
}

export function buildScanDressing(map: MapDef, terrain: Terrain | null, models: ModelLibrary): THREE.Group {
  const root = new THREE.Group();
  root.name = 'scanDressing';
  const sized = new Map<string, Sized>();
  const sizeOf = (id: string): Sized | null => {
    if (sized.has(id)) return sized.get(id)!;
    const t = models.template(id);
    if (!t) return null;
    t.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(t);
    const s = { size: box.getSize(new THREE.Vector3()), offset: new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2) };
    sized.set(id, s);
    return s;
  };
  const ground = (x: number, z: number) => (terrain ? terrain.heightAt(x, z) : 0);
  const placed: { model: string; m: THREE.Matrix4; at: THREE.Vector3; tint: THREE.Color }[] = [];
  let tint = new THREE.Color(1, 1, 1);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();

  /**
   * Puts `model` with its bottom centre at `at`, turned `yaw`, scaled to about
   * `target` (x along, y up, z across), the axes kept within x1.3 of each other.
   */
  const put = (model: string, at: THREE.Vector3, yaw: number, target: THREE.Vector3) => {
    const s = sizeOf(model);
    if (!s) return;
    // Lay the model's longer side along x.
    const turn = s.size.z > s.size.x ? Math.PI / 2 : 0;
    const mx = turn ? s.size.z : s.size.x;
    const mz = turn ? s.size.x : s.size.z;
    const sc = new THREE.Vector3(target.x / mx, target.y / s.size.y, target.z / mz);
    const mean = Math.cbrt(sc.x * sc.y * sc.z);
    sc.set(clamp(sc.x, mean / 1.45, mean * 1.45), clamp(sc.y, mean / 1.45, mean * 1.45), clamp(sc.z, mean / 1.45, mean * 1.45));
    const m = new THREE.Matrix4()
      .makeTranslation(at.x, at.y, at.z)
      .multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeScale(sc.x, sc.y, sc.z))
      .multiply(new THREE.Matrix4().makeRotationY(turn))
      .multiply(new THREE.Matrix4().makeTranslation(s.offset.x, s.offset.y, s.offset.z));
    placed.push({ model, m, at: at.clone(), tint });
  };

  for (const o of map.objects) {
    if (isRock(o)) {
      const [w, h, d] = o.size;
      // The scans are warm sandstone; the map's rock colour (lifted to a multiplier) brings them to its stone.
      const c = new THREE.Color(o.color ?? '#77726a');
      tint = new THREE.Color(Math.min(1, c.r * 1.45), Math.min(1, c.g * 1.5), Math.min(1, c.b * 1.6));
      // Box frame: the long side along local x.
      const alongX = w >= d;
      const L = alongX ? w : d;
      const D = alongX ? d : w;
      e.set(0, (o.rot?.[1] ?? 0) * DEG + (alongX ? 0 : Math.PI / 2), 0);
      q.setFromEuler(e);
      const yaw = e.y;
      const n = Math.max(1, Math.round(L / 1.3));
      const seg = L / n;
      for (let i = 0; i < n; i++) {
        const r = hash(o.pos[0], o.pos[2], i);
        const t = -L / 2 + seg * (i + 0.5) + (r - 0.5) * seg * 0.25;
        v.set(t, 0, (hash(i, o.pos[0]) - 0.5) * D * 0.15).applyQuaternion(q);
        const x = o.pos[0] + v.x;
        const z = o.pos[2] + v.z;
        const bottom = Math.min(o.pos[1] - h / 2, ground(x, z)) - h * 0.08;
        const model = BOULDERS[Math.floor(r * BOULDERS.length) % BOULDERS.length]!;
        put(model, new THREE.Vector3(x, bottom, z), yaw + (r > 0.5 ? Math.PI : 0), new THREE.Vector3(seg * 1.75, h * 1.18, D * 1.5));
      }
      // Stones at the foot on both sides.
      const stones = Math.max(1, Math.round(L / 2.2));
      for (let i = 0; i < stones; i++) {
        const r = hash(o.pos[2], o.pos[0], i, 7);
        const side = i % 2 ? 1 : -1;
        v.set((r - 0.5) * L, 0, side * (D / 2 + 0.25 + r * 0.35)).applyQuaternion(q);
        const x = o.pos[0] + v.x;
        const z = o.pos[2] + v.z;
        const k = 0.25 + hash(i, r) * 0.35;
        put(STONES[i % STONES.length]!, new THREE.Vector3(x, ground(x, z) - k * 0.15, z), r * Math.PI * 2, new THREE.Vector3(k, k * 0.7, k * 0.8));
      }
    } else if (isAsphalt(o)) {
      tint = new THREE.Color(1, 1, 1);
      const [w, , d] = o.size;
      const count = Math.min(3, Math.floor((w * d) / 250));
      e.set(0, (o.rot?.[1] ?? 0) * DEG, 0);
      q.setFromEuler(e);
      for (let i = 0; i < count; i++) {
        const lx = (hash(o.pos[0], i, 3) - 0.5) * Math.max(0, w - 2);
        const lz = (hash(o.pos[2], i, 5) - 0.5) * Math.max(0, d - 2);
        v.set(lx, 0, lz).applyQuaternion(q);
        const x = o.pos[0] + v.x;
        const z = o.pos[2] + v.z;
        // Flush with the surface: the cover's top at the road (box top or draped terrain, whichever is higher).
        const top = Math.max(o.pos[1] + o.size[1] / 2, ground(x, z)) + 0.004;
        const s = sizeOf(MANHOLE);
        if (!s) continue;
        put(MANHOLE, new THREE.Vector3(x, top - s.size.y, z), hash(i, x) * Math.PI * 2, new THREE.Vector3(s.size.x, s.size.y, s.size.z));
      }
    }
  }

  // One instanced mesh per model and material: the placements near the camera are written into it
  // (`cullScanDressing`), so the whole dressing costs a draw call per model however many cells it spans.
  const byModel = new Map<string, { m: THREE.Matrix4[]; c: THREE.Color[]; at: THREE.Vector3[] }>();
  for (const p of placed) {
    let list = byModel.get(p.model);
    if (!list) byModel.set(p.model, (list = { m: [], c: [], at: [] }));
    list.m.push(p.m);
    list.c.push(p.tint);
    list.at.push(p.at);
  }
  const sets: ScanSet[] = [];
  for (const [model, list] of byModel) {
    const g = new THREE.Group();
    instanceModel(models.template(model)!, list.m, g, false, list.c);
    for (const mesh of g.children as THREE.InstancedMesh[]) {
      // Full extent of every placement (the mesh is never culled as a whole; the instances are picked by distance).
      mesh.frustumCulled = false;
      // Drawn before the map's batches: the rock cores they cover then fail the depth test instead of being shaded too.
      mesh.renderOrder = -1;
      sets.push({ mesh, all: Float32Array.from(mesh.instanceMatrix.array), colors: mesh.instanceColor ? Float32Array.from(mesh.instanceColor.array) : null, at: list.at, range: rangeOf(model) });
      mesh.count = 0;
      root.add(mesh);
    }
  }
  root.userData.sets = sets;
  root.userData.count = placed.length;
  return root;
}

interface ScanSet {
  mesh: THREE.InstancedMesh;
  /** Every placement's matrix (and tint), and where it stands. */
  all: Float32Array;
  colors: Float32Array | null;
  at: THREE.Vector3[];
  /** Drawn within this distance (m). */
  range: number;
}

const lastAt = new WeakMap<THREE.Object3D, THREE.Vector3>();

/** Puts the placements within RANGE of the camera into the instanced meshes (when the camera has moved 4 m+). */
export function cullScanDressing(root: THREE.Object3D, camera: THREE.Vector3): void {
  const sets = root.userData.sets as ScanSet[] | undefined;
  if (!sets) return;
  const last = lastAt.get(root);
  if (last && last.distanceToSquared(camera) < 16) return;
  lastAt.set(root, camera.clone());
  for (const s of sets) {
    const r2 = (s.range + 4) ** 2;
    const dst = s.mesh.instanceMatrix.array as Float32Array;
    const col = s.mesh.instanceColor?.array as Float32Array | undefined;
    let n = 0;
    for (let i = 0; i < s.at.length; i++) {
      const a = s.at[i]!;
      const dx = a.x - camera.x;
      const dz = a.z - camera.z;
      if (dx * dx + dz * dz > r2) continue;
      dst.set(s.all.subarray(i * 16, i * 16 + 16), n * 16);
      if (col && s.colors) col.set(s.colors.subarray(i * 3, i * 3 + 3), n * 3);
      n++;
    }
    s.mesh.count = n;
    s.mesh.instanceMatrix.needsUpdate = true;
    if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
  }
}

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}
