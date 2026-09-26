import * as THREE from 'three';
import { TileNoise, makeRng, smoothstep } from '@/render/noise';
import type { ModelLibrary } from '@/render/models';
import { buildImpostors, buildNearTrees, createConiferKit } from './conifers';
import { instanceModel } from './placeProps';
import { LAYER_BACKDROP } from '@/render/layers';

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

const EXTENT = 1400;

/** Forest-floor models scattered around the map (render only, no collision). */
export const BACKDROP_MODELS = ['shrub_02', 'shrub_04', 'fern_02', 'rock_moss_set_01', 'rock_moss_set_02', 'tree_stump_01', 'dead_tree_trunk'];

export interface BackdropOptions {
  lowDetail: boolean;
  gl: THREE.WebGLRenderer;
  models: ModelLibrary;
  /** Canvas MSAA is on: foliage can use alpha-to-coverage for soft edges. */
  msaa: boolean;
}

/**
 * Render-only scenery around the playable area: rolling hills that rise beyond
 * the map bounds, a conifer forest (3D trees near the map, baked impostors
 * further out) and scattered rocks, stumps, logs and undergrowth. No collision.
 */
export function buildBackdrop(scene: THREE.Scene, mapSize: [number, number], opts: BackdropOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'backdrop';
  const n = new TileNoise(99);
  const halfX = mapSize[0] / 2;
  const halfZ = mapSize[1] / 2;
  const rng = makeRng(7);

  // Distance outside the playable rectangle, 0 inside.
  const outside = (x: number, z: number) => {
    const dx = Math.max(0, Math.abs(x) - halfX);
    const dz = Math.max(0, Math.abs(z) - halfZ);
    return Math.hypot(dx, dz);
  };
  const uvOf = (x: number, z: number): [number, number] => [x / EXTENT + 0.5, z / EXTENT + 0.5];
  const heightAt = (x: number, z: number) => {
    const d = outside(x, z);
    if (d <= 0) return -0.3;
    const [u, v] = uvOf(x, z);
    const hills = n.fbm(u, v, 3, 5);
    const rise = smoothstep(8, 160, d);
    return -0.3 + rise * (8 + hills * 70) + smoothstep(300, 700, d) * 60 * n.fbm(u + 0.3, v, 2, 3);
  };
  /** 0..1 forest cover: clustered woods with clearings, thinning on high rocky ground. */
  const forest = (x: number, z: number) => {
    const [u, v] = uvOf(x, z);
    const f = smoothstep(0.34, 0.5, n.fbm(u, v, 6, 3));
    return f * (1 - smoothstep(70, 110, heightAt(x, z)));
  };

  // --- Terrain -------------------------------------------------------------
  const seg = opts.lowDetail ? 72 : 120;
  const geo = new THREE.PlaneGeometry(EXTENT, EXTENT, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x5f6e40);
  const dryGrass = new THREE.Color(0x958a5d);
  const floor = new THREE.Color(0x3a3a26);
  const rock = new THREE.Color(0x807b70);
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
  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTexture(EXTENT / 7) }),
  );
  terrain.receiveShadow = false;
  group.add(terrain);

  // --- Trees ---------------------------------------------------------------
  const kit = createConiferKit(opts.msaa);
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
        pos: new THREE.Vector3(x, heightAt(x, z) - 0.3, z),
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
  // A dense tree line right behind the walls, then woods and clearings.
  const near = scatter(opts.lowDetail ? 160 : 300, 4, 48, (x, z, d) => rng() < forest(x, z) + (d < 20 ? 0.6 : 0.1));
  const far = scatter(opts.lowDetail ? 3500 : 7000, 42, 520, (x, z) => rng() < forest(x, z) * 1.2);
  for (const chunk of bySector(near, (p) => p.pos)) group.add(buildNearTrees(kit, chunk));
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
      matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z) - sink * s, z), q.setFromEuler(e), new THREE.Vector3(s, s, s)));
    }
    const p = new THREE.Vector3();
    for (const chunk of bySector(matrices, (m) => p.setFromMatrixPosition(m).clone())) instanceModel(tpl, chunk, group, false);
  };
  const k = opts.lowDetail ? 0.5 : 1;
  place('rock_moss_set_01', Math.round(6 * k), 4, 60, [1, 1.8], 0.1);
  place('rock_moss_set_02', Math.round(6 * k), 4, 60, [1, 1.8], 0.1);
  place('tree_stump_01', Math.round(10 * k), 4, 45, [0.9, 1.4]);
  place('dead_tree_trunk', Math.round(8 * k), 4, 45, [1.5, 2.5], 0.02);
  place('shrub_02', Math.round(14 * k), 3, 40, [0.8, 1.3]);
  // Undergrowth along the inside of the walls softens the map edge.
  placeAlongWalls(opts.models, group, halfX, halfZ, rng, k);

  group.traverse((o) => o.layers.set(LAYER_BACKDROP));
  scene.add(group);
  return group;
}

/** Ferns and small shrubs hugging the inside of the boundary walls (visual only). */
function placeAlongWalls(models: ModelLibrary, parent: THREE.Object3D, halfX: number, halfZ: number, rng: () => number, k: number): void {
  const spots = (count: number, inset: [number, number], scale: [number, number]) => {
    const out: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const edge = Math.floor(rng() * 4);
      const along = (rng() - 0.5) * 2;
      const inward = inset[0] + rng() * (inset[1] - inset[0]);
      const x = edge < 2 ? along * (halfX - 2) : (edge === 2 ? -1 : 1) * (halfX - inward);
      const z = edge < 2 ? (edge === 0 ? -1 : 1) * (halfZ - inward) : along * (halfZ - 2);
      const s = scale[0] + rng() * (scale[1] - scale[0]);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng() * Math.PI * 2);
      out.push(new THREE.Matrix4().compose(new THREE.Vector3(x, -0.02, z), q.clone(), new THREE.Vector3(s, s, s)));
    }
    return out;
  };
  const fern = models.template('fern_02');
  const p = new THREE.Vector3();
  const sectors = (list: THREE.Matrix4[]) => bySector(list, (m) => p.setFromMatrixPosition(m).clone());
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
