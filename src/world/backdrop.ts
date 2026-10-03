import * as THREE from 'three';
import { TileNoise, makeRng, smoothstep } from '@/render/noise';
import type { ModelLibrary } from '@/render/models';
import { buildImpostors, createConiferKit, type ConiferKit } from './conifers';
import { Forest } from './forest';
import { instanceModel } from './placeProps';
import { LAYER_BACKDROP } from '@/render/layers';
import { SCENERY_EXTENT, type Terrain } from './terrain';

/** Scenery is split into angular sectors around the map so what is behind the camera is culled. */
const SECTORS = 8;

function sectorOf(x: number, z: number): number {
  return Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * SECTORS) % SECTORS;
}

function bySector<T>(items: T[], pos: (t: T) => THREE.Vector3): T[][] {
  const out: T[][] = Array.from({ length: SECTORS }, () => []);
  for (const it of items) {
    const p = pos(it);
    out[sectorOf(p.x, p.z)]!.push(it);
  }
  return out.filter((s) => s.length > 0);
}

const EXTENT = SCENERY_EXTENT;

/**
 * Forest-floor clutter (scanned rocks, stumps, ferns, shrubs: thousands of
 * triangles each) is grouped in DETAIL_CELL squares and only drawn within
 * DETAIL_RANGE of the camera (`cullBackdropDetail`).
 */
const DETAIL_CELL = 40;
const DETAIL_RANGE = 75;

function byCell<T>(items: T[], pos: (t: T) => THREE.Vector3): T[][] {
  const cells = new Map<string, T[]>();
  for (const it of items) {
    const p = pos(it);
    const key = `${Math.floor(p.x / DETAIL_CELL)},${Math.floor(p.z / DETAIL_CELL)}`;
    const list = cells.get(key) ?? [];
    list.push(it);
    cells.set(key, list);
  }
  return [...cells.values()];
}

/** Shows backdrop clutter near the camera only (call every frame or so). */
export function cullBackdropDetail(backdrop: THREE.Object3D, camera: THREE.Vector3): void {
  (backdrop.userData.trees as Forest | undefined)?.update(camera);
  const list = backdrop.userData.detail as THREE.Mesh[] | undefined;
  if (!list) return;
  for (const m of list) {
    const s = m.geometry.boundingSphere ? (m as THREE.InstancedMesh).boundingSphere : null;
    if (!s) continue;
    m.visible = s.center.distanceTo(camera) - s.radius < DETAIL_RANGE;
  }
}

/** Forest-floor models scattered around the map (render only, no collision). */
export const BACKDROP_MODELS = ['shrub_02', 'shrub_04', 'fern_02', 'rock_moss_set_01', 'rock_moss_set_02', 'tree_stump_01', 'dead_tree_trunk'];

export interface BackdropOptions {
  lowDetail: boolean;
  gl: THREE.WebGLRenderer;
  models: ModelLibrary;
  /** Canvas MSAA is on: foliage can use alpha-to-coverage for soft edges. */
  msaa: boolean;
  /** Shared tree kit (the map's own forest uses the same one). */
  kit?: ConiferKit;
  /** Snow-covered ground and trees, no green undergrowth. */
  winter?: boolean;
  /** Sand and rock, few trees, no green undergrowth. */
  desert?: boolean;
  /** Weakest devices (low preset): fewer 3D trees along the edge. */
  phone?: boolean;
}

/**
 * Render-only scenery around the playable area: rolling hills that rise beyond
 * the map bounds, a conifer forest (3D trees near the map, baked impostors
 * further out) and scattered rocks, stumps, logs and undergrowth. No collision.
 */
export function buildBackdrop(scene: THREE.Scene, terrain: Terrain, opts: BackdropOptions & { mapHasTerrain: boolean }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'backdrop';
  const n = new TileNoise(99);
  const [minX, minZ, maxX, maxZ] = terrain.bounds();
  const halfX = Math.max(-minX, maxX);
  const halfZ = Math.max(-minZ, maxZ);
  const [tx, tz] = [terrain.size[0] / 2, terrain.size[1] / 2];
  const rng = makeRng(7);

  // Distance outside the playable area, 0 inside.
  const outside = (x: number, z: number) => terrain.boundary.outside(x, z);
  const uvOf = (x: number, z: number): [number, number] => [x / EXTENT + 0.5, z / EXTENT + 0.5];
  // Where the map has its own terrain mesh the scenery ground tucks under it,
  // meeting it at the edge of the terrain rectangle.
  const underMap = (x: number, z: number) => {
    const edge = Math.min(tx - Math.abs(x), tz - Math.abs(z));
    return edge > 0 ? 0.3 + smoothstep(0, 12, edge) * 2.5 : 0;
  };
  const heightAt = (x: number, z: number) => terrain.surfaceAt(x, z) - (opts.mapHasTerrain ? underMap(x, z) : outside(x, z) > 0 ? 0 : 0.3);
  /** Height for things standing on the scenery (trees, rocks). */
  const groundAt = (x: number, z: number) => terrain.surfaceAt(x, z);
  /** 0..1 forest cover: clustered woods with clearings, thinning on high rocky ground. */
  const forest = (x: number, z: number) => {
    const [u, v] = uvOf(x, z);
    // Desert: only the odd palm grove.
    const f = opts.desert ? 0.12 * smoothstep(0.55, 0.62, n.fbm(u, v, 6, 3)) : smoothstep(0.34, 0.5, n.fbm(u, v, 6, 3));
    return f * (1 - smoothstep(70, 110, heightAt(x, z)));
  };

  // --- Terrain -------------------------------------------------------------
  const seg = opts.lowDetail ? 72 : 120;
  const geo = new THREE.PlaneGeometry(EXTENT, EXTENT, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const winter = !!opts.winter;
  const desert = !!opts.desert;
  const grass = new THREE.Color(winter ? 0xe6ebf0 : desert ? 0xcdb48a : 0x5f6e40);
  const dryGrass = new THREE.Color(winter ? 0xd2dae3 : desert ? 0xb8996c : 0x958a5d);
  const floor = new THREE.Color(winter ? 0xb4bcc2 : desert ? 0x9c8a62 : 0x3a3a26);
  const rock = new THREE.Color(winter ? 0x8e9194 : desert ? 0xa08466 : 0x807b70);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const [u, v] = uvOf(x, z);
    c.copy(grass).lerp(dryGrass, n.fbm(u + 0.7, v + 0.1, 8, 3));
    // Needle litter and shade under the trees.
    c.lerp(floor, forest(x, z) * 0.75);
    c.lerp(rock, smoothstep(45, 90, h) * 0.8);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTexture(EXTENT / 7) }),
  );
  ground.receiveShadow = false;
  group.add(ground);

  // --- Trees ---------------------------------------------------------------
  const kit = opts.kit ?? createConiferKit(opts.msaa, winter);
  type TreeSpot = { pos: THREE.Vector3; scale: number; yaw: number; variant: number; tint: number };
  const scatter = (count: number, minD: number, maxD: number, accept: (x: number, z: number, d: number) => boolean): TreeSpot[] => {
    const out: TreeSpot[] = [];
    const reach = Math.min(EXTENT * 0.48, Math.max(halfX, halfZ) + maxD);
    for (let tries = 0; out.length < count && tries < count * 40; tries++) {
      const x = (rng() - 0.5) * 2 * reach;
      const z = (rng() - 0.5) * 2 * reach;
      const d = outside(x, z);
      if (d < minD || d > maxD || !accept(x, z, d)) continue;
      out.push({
        pos: new THREE.Vector3(x, groundAt(x, z) - 0.3, z),
        scale: 0.75 + rng() * 0.55,
        yaw: rng() * Math.PI * 2,
        variant: Math.floor(rng() * kit.variants.length),
        tint: 0.8 + rng() * 0.3,
      });
    }
    // Nearest first: with alpha-tested foliage, early depth rejection only helps
    // when occluders are drawn before what they hide (the player is always inside).
    return out.sort((a, b) => a.pos.x * a.pos.x + a.pos.z * a.pos.z - (b.pos.x * b.pos.x + b.pos.z * b.pos.z));
  };
  // A dense tree line right behind the walls, then woods and clearings. On the
  // lighter presets only the first row is real 3D trees (~5k triangles each);
  // impostors take over from there.
  const nearOut = opts.lowDetail ? 18 : 48;
  const sparse = desert ? 0.06 : 1;
  const near = scatter(Math.round((opts.lowDetail ? (opts.phone ? 60 : 90) : 300) * sparse), 4, nearOut, (x, z, d) => rng() < forest(x, z) + (desert ? 0.3 : d < 20 ? 0.6 : 0.1));
  const far = scatter(Math.round((opts.lowDetail ? 3700 : 7000) * sparse), opts.lowDetail ? 15 : 42, 520, (x, z) => rng() < forest(x, z) * 1.2);
  if (near.length) {
    // The tree line just outside the map: 3D close to the camera, impostors further off
    // (they were all 3D, ~300 trees x 5k triangles, mostly far across the map).
    const trees = new Forest(near, kit, opts.gl, scene, opts.lowDetail ? 70 : 110);
    group.add(trees.group);
    group.userData.trees = trees;
  }
  for (const chunk of bySector(far, (p) => p.pos)) group.add(buildImpostors(opts.gl, kit, scene.environment, scene.environmentIntensity, chunk));

  // --- Forest floor --------------------------------------------------------
  const DEG = Math.PI / 180;
  const place = (id: string, count: number, minD: number, maxD: number, scale: [number, number], sink = 0) => {
    const tpl = opts.models.template(id);
    if (!tpl) return;
    const matrices: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let tries = 0; matrices.length < count && tries < count * 30; tries++) {
      const x = (rng() - 0.5) * 2 * (Math.max(halfX, halfZ) + maxD);
      const z = (rng() - 0.5) * 2 * (Math.max(halfX, halfZ) + maxD);
      const d = outside(x, z);
      if (d < minD || d > maxD || rng() > 0.35 + forest(x, z)) continue;
      const s = scale[0] + rng() * (scale[1] - scale[0]);
      e.set((rng() - 0.5) * 6 * DEG, rng() * Math.PI * 2, (rng() - 0.5) * 6 * DEG);
      matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, groundAt(x, z) - sink * s, z), q.setFromEuler(e), new THREE.Vector3(s, s, s)));
    }
    const p = new THREE.Vector3();
    for (const chunk of byCell(matrices, (m) => p.setFromMatrixPosition(m).clone())) instanceModel(tpl, chunk, detail, false);
  };
  const detail = new THREE.Group();
  detail.name = 'detail';
  group.add(detail);
  const k = opts.lowDetail ? 0.5 : 1;
  place('rock_moss_set_01', Math.round(6 * k), 4, 60, [1, 1.8], 0.1);
  place('rock_moss_set_02', Math.round(6 * k), 4, 60, [1, 1.8], 0.1);
  place('tree_stump_01', Math.round(10 * k), 4, 45, [0.9, 1.4]);
  place('dead_tree_trunk', Math.round(8 * k), 4, 45, [1.5, 2.5], 0.02);
  if (!winter && !desert) {
    place('shrub_02', Math.round(14 * k), 3, 40, [0.8, 1.3]);
    // Undergrowth along the inside of the edge softens it.
    placeAlongEdge(opts.models, detail, terrain, rng, k);
  }
  group.userData.detail = detail.children.filter((c) => (c as THREE.Mesh).isMesh);

  group.traverse((o) => o.layers.set(LAYER_BACKDROP));
  scene.add(group);
  return group;
}

/** Ferns and small shrubs hugging the inside of the boundary (visual only). */
function placeAlongEdge(models: ModelLibrary, parent: THREE.Object3D, terrain: Terrain, rng: () => number, k: number): void {
  const pts = terrain.boundary.points;
  const lengths = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const total = lengths.reduce((a, b) => a + b, 0);
  // Denser on bigger maps, same density as the sandbox walls (~480 m of edge).
  const density = total / 480;
  const spots = (count: number, inset: [number, number], scale: [number, number]) => {
    const out: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    for (let i = 0; i < Math.round(count * density); i++) {
      let t = rng() * total;
      let e = 0;
      while (t > lengths[e]! && e < lengths.length - 1) t -= lengths[e++]!;
      const a = pts[e]!;
      const b = pts[(e + 1) % pts.length]!;
      const f = t / Math.max(1e-3, lengths[e]!);
      const x0 = a[0] + (b[0] - a[0]) * f;
      const z0 = a[1] + (b[1] - a[1]) * f;
      // Inward normal: whichever side of the edge is inside.
      let nx = -(b[1] - a[1]) / Math.max(1e-3, lengths[e]!);
      let nz = (b[0] - a[0]) / Math.max(1e-3, lengths[e]!);
      if (!terrain.boundary.contains(x0 + nx * 0.5, z0 + nz * 0.5)) {
        nx = -nx;
        nz = -nz;
      }
      const inward = inset[0] + rng() * (inset[1] - inset[0]);
      const x = x0 + nx * inward;
      const z = z0 + nz * inward;
      const s = scale[0] + rng() * (scale[1] - scale[0]);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng() * Math.PI * 2);
      out.push(new THREE.Matrix4().compose(new THREE.Vector3(x, terrain.heightAt(x, z) - 0.02, z), q.clone(), new THREE.Vector3(s, s, s)));
    }
    return out;
  };
  const fern = models.template('fern_02');
  const p = new THREE.Vector3();
  const sectors = (list: THREE.Matrix4[]) => byCell(list, (m) => p.setFromMatrixPosition(m).clone());
  if (fern) for (const chunk of sectors(spots(Math.round(45 * k), [0.9, 1.8], [0.8, 1.3]))) instanceModel(fern, chunk, parent, false);
  const shrub = models.template('shrub_04');
  if (shrub) for (const chunk of sectors(spots(Math.round(35 * k), [0.7, 1.4], [3, 5]))) instanceModel(shrub, chunk, parent, false);
}

/** Tiling grayscale detail (0.72..1) that breaks up the terrain's vertex colors up close. */
function detailTexture(repeat: number): THREE.DataTexture {
  const S = 128;
  const n = new TileNoise(3);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = 0.72 + 0.28 * (n.sample(x / S, y / S, 8) * 0.5 + n.sample(x / S, y / S, 32) * 0.3 + n.sample(x / S, y / S, 64) * 0.2);
      const g = Math.round(v * 255);
      const i = (y * S + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
