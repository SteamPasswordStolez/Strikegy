import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { worldScaleBoxUVs, type SurfaceLibrary } from '@/render/textures';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { SURFACE_FROM_MATERIAL, type SurfaceRegistry } from '@/physics/surfaces';
import type { MapDef, MapObject, SurfaceMaterial } from './mapTypes';
import { buildBoundaryWalls, buildTerrain, terrainTriangles, type Terrain } from './terrain';
import { buildBuilding, type BuildingDoor, type WindowSpot } from './buildings';
import { WALL } from './buildingParts';
import { buildKit, kitMaterials, MODEL_KINDS, watchtowerLadder, type KitMaterial } from './modelKits';

const DEFAULT_MATERIAL: Record<MapObject['type'], SurfaceMaterial> = {
  wall: 'concrete',
  cover: 'metal',
  floor: 'concrete_floor',
  ramp: 'concrete',
  prop: 'wood',
};

const DEG = Math.PI / 180;
const warnedKits = new Set<string>();

interface Batch {
  material: THREE.Material;
  geometries: THREE.BufferGeometry[];
  castShadow: boolean;
  /** Per geometry tint, baked into vertex colours (vertex-tinted batches only). */
  tints?: THREE.Color[];
  /** Darken tall pieces toward the ground (grime / contact shade, see GRIME). */
  grime?: boolean;
  /** Building interiors (see INSIDE_TAG). */
  inside?: boolean;
}

/**
 * Batch tag of building pieces inside the outer walls. They draw after the
 * shells (render order), so where a wall hides them the depth test rejects
 * them before shading: interiors were ~1/3 of the map's GPU time at Iron
 * Gate's square, mostly hidden (Iris Xe, 2026-10-10).
 */
const INSIDE_TAG = 'in';
/** Interiors are not drawn past this distance (m) from their cell's edge. */
const INSIDE_FAR = 110;

/** Walls darken by up to `dark` toward the ground over their lowest `height` metres (baked into vertex colours). */
const GRIME = { dark: 0.3, height: 2.6, minHeight: 1.2 };
/**
 * Map kits (cars, tents, tanks...): darker toward the ground (`contact` at the
 * foot, gone by `height` m) and on faces turned down (x `under`), baked into
 * vertex colours. Without it they looked pasted on the ground, lit the same
 * all over (no ambient occlusion reaches small objects at this scale).
 */
const KIT_SHADE = { contact: 0.38, height: 0.8, under: 0.55 };

/** The kits' shared looks, taking the shade from vertex colours. */
function kitLooks(): ReturnType<typeof kitMaterials> {
  const looks = kitMaterials();
  for (const m of Object.values(looks)) m.vertexColors = true;
  return looks;
}

/**
 * Adds `geo` to the batch of its surface kind, its colour going into vertex
 * colours: one draw call per surface instead of one per surface and colour
 * (Ardennes had ~140 map batches, mostly tints of the same few surfaces).
 */
function pushTinted(batches: Map<string, Batch>, surfaces: SurfaceLibrary, kind: SurfaceMaterial, color: string | undefined, geo: THREE.BufferGeometry, tag: string, castShadow: boolean): void {
  const key = `${kind}:${tag}:${castShadow ? 1 : 0}:v`;
  let batch = batches.get(key);
  if (!batch) {
    batch = { material: surfaces.vertexTinted(kind), geometries: [], castShadow, tints: [], grime: tag === '' || tag === INSIDE_TAG, inside: tag === INSIDE_TAG };
    batches.set(key, batch);
  }
  batch.geometries.push(geo);
  batch.tints!.push(color ? new THREE.Color(color) : surfaces.baseTint(kind));
}

/** True if the map shapes its ground (terrain / irregular boundary) instead of a flat box. */
export function hasTerrain(map: MapDef): boolean {
  return !!(map.world.terrain || map.world.boundary);
}

/**
 * Moves everything that sits on the ground onto the terrain: spawns, zones,
 * targets, and objects / props flagged `snap` (their y becomes an offset).
 */
export function snapToTerrain(map: MapDef, terrain: Terrain): void {
  const lift = (p: [number, number, number]) => {
    p[1] += terrain.heightAt(p[0], p[2]);
  };
  for (const s of map.spawns) lift(s.pos);
  for (const z of map.zones ?? []) lift(z.pos);
  for (const t of map.targets ?? []) lift(t.pos);
  for (const o of map.objects) if (o.snap) lift(o.pos);
  for (const p of map.props ?? []) if (p.snap) lift(p.pos);
}

export interface BuiltMap {
  /** Render meshes (empty when built without a view, on the game server). */
  root: THREE.Group;
  /** Walkable terrain triangles for the navmesh (null on flat box maps). */
  navExtra: { positions: number[]; indices: number[] } | null;
  /** Window firing spots of all buildings. */
  windows: WindowSpot[];
  /** Building footprints: centre, yaw (radians), half extents. */
  footprints: { x: number; z: number; yaw: number; hw: number; hd: number }[];
  /** The terrain collider's handle (null on flat box maps). */
  groundHandle: number | null;
}

/**
 * Builds render meshes and static colliders for a blockout (box-based) map:
 * the ground (flat box, or terrain with invisible boundary walls), map boxes
 * and generated buildings. Boxes sharing a material are merged into one mesh
 * (one draw call per material, per render pass) since the geometry never moves.
 * Without `surfaces` (the game server) only the colliders and the map data
 * are built, no meshes.
 */
export function buildBlockout(
  map: MapDef,
  scene: THREE.Scene | null,
  physics: PhysicsWorld,
  surfaces: SurfaceLibrary | null,
  impacts: SurfaceRegistry,
  terrain: Terrain | null,
  /** Terrain render mesh detail: 1 = every grid line, 2 = every other (weak devices). */
  terrainStep = 1,
): BuiltMap {
  const root = new THREE.Group();
  root.name = `map:${map.meta.id}`;
  const batches = new Map<string, Batch>();
  const groundKind = map.world.groundMaterial ?? 'ground';
  const snowy = map.world.visualProfile === 'winter';
  let navExtra: BuiltMap['navExtra'] = null;
  let groundHandle: number | null = null;
  const windows: WindowSpot[] = [];
  const footprints: BuiltMap['footprints'] = [];

  if (terrain) {
    const built = buildTerrain(terrain, surfaces?.terrain(groundKind) ?? null, physics, terrainStep);
    impacts.set(built.collider.handle, SURFACE_FROM_MATERIAL[groundKind]);
    groundHandle = built.collider.handle;
    if (built.mesh) {
      built.mesh.matrixAutoUpdate = false;
      root.add(built.mesh);
    }
    if (map.world.boundary) buildBoundaryWalls(terrain.boundary, terrain, physics);
    navExtra = terrainTriangles(terrain, built.grid);
  } else {
    const [sx, sz] = map.world.size;
    const groundThickness = 1;
    // The ground never casts shadows (nothing is below it); keep it in its own batch.
    addBox(
      { type: 'floor', pos: [0, -groundThickness / 2, 0], size: [sx, groundThickness, sz], material: groundKind },
      batches,
      physics,
      surfaces,
      impacts,
      'ground',
    );
  }
  let kitMats: ReturnType<typeof kitMaterials> | null = null;
  for (const obj of map.objects) {
    if (obj.model && !MODEL_KINDS.includes(obj.model)) {
      // A kit this build doesn't have (newer map JSON): draw and collide as the plain box.
      if (!warnedKits.has(obj.model)) {
        warnedKits.add(obj.model);
        console.warn(`map: unknown model kit "${obj.model}", drawing its box`);
      }
      addBox({ ...obj, model: undefined }, batches, physics, surfaces, impacts);
      continue;
    }
    if (obj.model) {
      addModel(obj, batches, physics, surfaces, impacts, surfaces ? (kitMats ??= kitLooks()) : null);
      continue;
    }
    if (terrain && groundHandle !== null && isGroundPaint(obj, terrain)) {
      // A coarse terrain mesh cuts corners between grid lines: lift paint clear of it.
      // In snow, tracks fade out at their sides instead of ending in a hard line.
      if (surfaces) addDraped(obj, terrain, batches, surfaces, terrainStep > 1 ? 0.12 : 0, snowy && obj.size[0] >= SNOW_FADE_MIN_WIDTH);
      const kind = obj.material ?? DEFAULT_MATERIAL[obj.type];
      impacts.paint(groundHandle, obj.pos[0], obj.pos[2], (obj.rot?.[1] ?? 0) * DEG, obj.size[0], obj.size[2], SURFACE_FROM_MATERIAL[kind]);
    }
    else addBox(obj, batches, physics, surfaces, impacts);
  }
  for (const b of map.buildings ?? []) {
    const base = terrain ? terrain.heightAt(b.pos[0], b.pos[1]) : 0;
    const built = buildBuilding(b, base, { snow: map.world.visualProfile === 'winter' });
    for (const obj of built.objects) addBox(obj, batches, physics, surfaces, impacts, obj.inside ? INSIDE_TAG : '');
    if (surfaces) for (const obj of built.decor) addBox(obj, batches, physics, surfaces, impacts, '', false);
    if (surfaces) for (const sh of built.shapes) {
      // A plain 0..n-1 index lets gables and roofs merge into the boxes of their
      // wall colour (box geometry is indexed) instead of costing a batch of their own.
      sh.geo.setIndex(Array.from({ length: sh.geo.getAttribute('position').count }, (_, i) => i));
      pushTinted(batches, surfaces, sh.material, sh.color, sh.geo, '', true);
    }
    windows.push(...built.windows);
    // A doorstep ramp where the ground outside a door lies lower than the floor (neighbouring pads
    // and slopes left steps of up to ~0.45 m: people had to jump to get in).
    if (terrain) for (const d of built.doors) {
      for (const obj of doorstep(d, terrain)) addBox(obj, batches, physics, surfaces, impacts);
    }
    footprints.push({ x: b.pos[0], z: b.pos[1], yaw: ((b.rot ?? 0) * Math.PI) / 180, hw: b.size[0] / 2, hd: b.size[1] / 2 });
  }

  for (const b of batches.values()) {
    if (b.tints) {
      b.geometries.forEach((g, i) => {
        const pos = g.getAttribute('position');
        const n = pos.count;
        const col = new Float32Array(n * 3);
        const { r, g: gr, b: bl } = b.tints![i]!;
        const shade = g.getAttribute('shade');
        let grime = false;
        if (b.grime) {
          g.computeBoundingBox();
          grime = g.boundingBox!.max.y - g.boundingBox!.min.y > GRIME.minHeight;
        }
        for (let k = 0; k < n; k++) {
          let f = shade ? shade.getX(k) : 1;
          if (grime) {
            const above = pos.getY(k) - (terrain ? terrain.heightAt(pos.getX(k), pos.getZ(k)) : 0);
            f *= 1 - GRIME.dark * (1 - Math.min(1, Math.max(0, above / GRIME.height)));
          }
          col[k * 3] = r * f;
          col[k * 3 + 1] = gr * f;
          col[k * 3 + 2] = bl * f;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        if (shade) g.deleteAttribute('shade');
      });
    }
    for (const part of splitByCell(b.geometries, b.inside ? 0 : CELL.minVertices)) {
      const merged = mergeGeometries(part);
      for (const g of part) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      if (!b.inside) {
        root.add(mesh);
        continue;
      }
      // Before the terrain (1), after everything else; nothing beyond INSIDE_FAR
      // (past it a window is a few pixels): a LOD at the cell's centre.
      mesh.renderOrder = 0.5;
      const centre = merged.boundingSphere!.center.clone();
      merged.translate(-centre.x, -centre.y, -centre.z);
      const lod = new THREE.LOD();
      lod.position.copy(centre);
      lod.updateMatrix();
      lod.addLevel(mesh, 0);
      lod.addLevel(new THREE.Object3D(), INSIDE_FAR + merged.boundingSphere!.radius);
      root.add(lod);
    }
  }

  scene?.add(root);
  return { root, navExtra, windows, footprints, groundHandle };
}

/**
 * Big batches are cut into square cells of the map, merged per cell: a batch
 * spanning the whole map was never culled (all its vertices every frame, in
 * every pass) and couldn't be drawn front to back. Small ones stay whole to
 * keep the draw calls down. Iron Gate (2026-10-10): ~2.4 ms of vertex work a
 * frame on an Iris Xe went to batches mostly out of view.
 */
const CELL = { size: 96, minVertices: 20000 };

function splitByCell(geos: THREE.BufferGeometry[], minVertices: number): THREE.BufferGeometry[][] {
  const total = geos.reduce((n, g) => n + g.getAttribute('position').count, 0);
  if (total < minVertices) return [geos];
  const cells = new Map<string, THREE.BufferGeometry[]>();
  const c = new THREE.Vector3();
  for (const g of geos) {
    if (!g.boundingBox) g.computeBoundingBox();
    g.boundingBox!.getCenter(c);
    const key = `${Math.floor(c.x / CELL.size)},${Math.floor(c.z / CELL.size)}`;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(g);
  }
  return [...cells.values()];
}

/** Top of a thin snapped floor within this height of the terrain = paint on the ground (roads, pavements). */
const PAINT_MAX_LIFT = 0.2;
/** Grid step of draped floors (m). */
const DRAPE_STEP = 1.5;

/**
 * A short ramp from the ground up to a door's sill when the ground outside is
 * more than a few cm lower (at most 1 in 2.5, at least 1 m long); nothing
 * when it is level enough to step over.
 */
function doorstep(d: BuildingDoor, terrain: Terrain): MapObject[] {
  const [x, top, z] = d.pos;
  const [ox, oz] = d.out;
  // Ground just outside the wall (the door point is at its inner face).
  const ground = Math.min(terrain.heightAt(x + ox * (WALL + 0.5), z + oz * (WALL + 0.5)), terrain.heightAt(x + ox * (WALL + 1.3), z + oz * (WALL + 1.3)));
  const rise = top - ground;
  if (rise < DOORSTEP_MIN) return [];
  const len = WALL + Math.max(1, Math.min(4, rise * 2.5));
  const pitch = Math.atan2(rise, len);
  const slope = Math.hypot(len, rise);
  // Centre half way down the slope; the box is tipped about its own x axis (rising toward the door).
  const yaw = Math.atan2(ox, oz);
  return [{
    type: 'floor',
    pos: [x + (ox * len) / 2, ground + rise / 2 - 0.12, z + (oz * len) / 2],
    size: [d.width + 0.4, 0.25, slope + 0.1],
    rot: eulerYawPitch(yaw, pitch),
    material: 'concrete',
    color: '#8f8b82',
  }];
}
/** Steps lower than this are left to the character's autostep (m). */
const DOORSTEP_MIN = 0.12;
/** Euler XYZ (degrees) for a box turned by `yaw` (rad), then tipped by `pitch` (rad) about its own x axis. */
function eulerYawPitch(yaw: number, pitch: number): [number, number, number] {
  const sp = Math.sin(yaw);
  const cp = Math.cos(yaw);
  const st = Math.sin(pitch);
  const ct = Math.cos(pitch);
  return [Math.atan2(st, cp * ct) / DEG, Math.asin(sp * ct) / DEG, Math.atan2(-sp * st, cp) / DEG];
}

function isGroundPaint(obj: MapObject, terrain: Terrain): boolean {
  if (!obj.snap || obj.type !== 'floor' || obj.size[1] > 0.5 || obj.rot?.[0] || obj.rot?.[2]) return false;
  const top = obj.pos[1] + obj.size[1] / 2 - terrain.heightAt(obj.pos[0], obj.pos[2]);
  return top <= PAINT_MAX_LIFT;
}

/**
 * Roads and pavements on terrain: a sheet that follows the ground instead of
 * a flat box. Overlapping flat boxes left millimeter ledges at every seam that
 * stopped the character controller dead; with no collider here you walk on
 * the smooth terrain underneath.
 */
/** Width over which draped paint fades into the snow at its sides (m). */
const SNOW_FADE = 0.8;
/** Only tracks at least this wide fade (rail ballast and kerbs keep their edges). */
const SNOW_FADE_MIN_WIDTH = 4;
const fadedMaterials = new WeakMap<THREE.Material, THREE.Material>();

/** Same look with dithered alpha from vertex colours (alpha hash: no sorting, no blending). */
function faded(material: THREE.Material): THREE.Material {
  let m = fadedMaterials.get(material);
  if (!m) {
    m = material.clone();
    (m as THREE.MeshStandardMaterial).vertexColors = true;
    m.alphaHash = true;
    fadedMaterials.set(material, m);
  }
  return m;
}

function addDraped(obj: MapObject, terrain: Terrain, batches: Map<string, Batch>, surfaces: SurfaceLibrary, extraLift = 0, fade = false): void {
  const [w, h, d] = obj.size;
  const kind = obj.material ?? DEFAULT_MATERIAL[obj.type];

  // Keep the authored layering (pavement over road over pad) as the lift above the ground.
  const lift = Math.max(0.02, obj.pos[1] + h / 2 - terrain.heightAt(obj.pos[0], obj.pos[2])) + extraLift;
  const geo = new THREE.PlaneGeometry(w, d, Math.max(1, Math.ceil(w / DRAPE_STEP)), Math.max(1, Math.ceil(d / DRAPE_STEP)));
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const yaw = (obj.rot?.[1] ?? 0) * DEG;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    // Same rotation as the box (about +Y), then the world position.
    const x = obj.pos[0] + lx * c + lz * sn;
    const z = obj.pos[2] - lx * sn + lz * c;
    pos.setXYZ(i, x, terrain.surfaceAt(x, z) + lift, z);
    uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
  }
  if (fade) {
    // Alpha from the distance to the long sides (local x), white colour.
    const col = new Float32Array(pos.count * 4).fill(1);
    const cols = Math.max(1, Math.ceil(w / DRAPE_STEP));
    for (let i = 0; i < pos.count; i++) {
      const lx = (((i % (cols + 1)) / cols) - 0.5) * w;
      col[i * 4 + 3] = Math.min(1, Math.max(0, (w / 2 - Math.abs(lx)) / Math.min(SNOW_FADE, w / 3)));
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  }
  geo.computeVertexNormals();
  if (!fade) {
    pushTinted(batches, surfaces, kind, obj.color, geo, 'drape', false);
    return;
  }
  // Only the edges need the dithered alpha: the solid middle goes with the plain
  // paint (alpha hash discards, so the GPU can't reject hidden pixels early;
  // whole tracks cost ~0.9 ms on Ardennes, Iris Xe 2026-10-10).
  const index = geo.getIndex()!;
  const solid: number[] = [];
  const edge: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    const opaque = [a, b, c].every((v) => (geo.getAttribute('color') as THREE.BufferAttribute).getW(v) >= 1);
    (opaque ? solid : edge).push(a, b, c);
  }
  if (solid.length) {
    const mid = geo.clone();
    mid.deleteAttribute('color');
    mid.setIndex(solid);
    pushTinted(batches, surfaces, kind, obj.color, mid, 'drape', false);
  }
  if (!edge.length) {
    geo.dispose();
    return;
  }
  geo.setIndex(edge);
  const material = faded(obj.color ? surfaces.tinted(kind, obj.color) : surfaces.get(kind));
  const key = `${material.uuid}drape`;
  let batch = batches.get(key);
  if (!batch) {
    batch = { material, geometries: [], castShadow: false };
    batches.set(key, batch);
  }
  batch.geometries.push(geo);
}

/**
 * A procedural model in place of the object's box: pieces go into per-material
 * batches (their own, since kit geometry is non-indexed), colliders are the
 * kit's boxes or the object's box.
 */
function addModel(
  obj: MapObject,
  batches: Map<string, Batch>,
  physics: PhysicsWorld,
  surfaces: SurfaceLibrary | null,
  impacts: SurfaceRegistry,
  shared: ReturnType<typeof kitMaterials> | null,
): void {
  const [w, h, d] = obj.size;
  const base = obj.base ?? 0;
  const kind = obj.material ?? DEFAULT_MATERIAL[obj.type];
  const seed = Math.abs(Math.round(obj.pos[0] * 91 + obj.pos[2] * 37)) + 1;
  let state = seed;
  const rand = () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646;
  const kit = buildKit(obj.model!, w, h - base, d, rand);

  if (obj.rot) tmpEuler.set(obj.rot[0] * DEG, obj.rot[1] * DEG, obj.rot[2] * DEG);
  else tmpEuler.set(0, 0, 0);
  tmpQuat.setFromEuler(tmpEuler);
  // Kit space: y = 0 on the ground, which is `base` above the box bottom.
  const toWorld = new THREE.Matrix4()
    .compose(new THREE.Vector3(...obj.pos), tmpQuat, one)
    .multiply(new THREE.Matrix4().makeTranslation(0, -h / 2 + base, 0));

  if (surfaces && shared) addKitPieces(kit.pieces, toWorld, kind, obj.color, batches, surfaces, shared);
  if (obj.model === 'watchtower') {
    const l = watchtowerLadder(w, h - base, d);
    const foot = new THREE.Vector3(l.x, 0, l.z).applyMatrix4(toWorld);
    const out = new THREE.Vector3(0, 0, 1).applyQuaternion(tmpQuat);
    physics.ladders.push({ x: foot.x, z: foot.z, bottom: foot.y, top: foot.y + l.top, nx: out.x, nz: out.z });
  }

  const surface = SURFACE_FROM_MATERIAL[kind];
  if (!kit.colliders) {
    const c = physics.addStaticBox(
      { x: obj.pos[0], y: obj.pos[1], z: obj.pos[2] },
      { x: w / 2, y: h / 2, z: d / 2 },
      { x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w },
    );
    impacts.set(c.handle, surface);
    return;
  }
  const at = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  for (const box of kit.colliders) {
    at.set(...box.center).applyMatrix4(toWorld);
    q.copy(tmpQuat).multiply(turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), box.yaw ?? 0));
    const c = physics.addStaticBox({ x: at.x, y: at.y, z: at.z }, { x: box.size[0] / 2, y: box.size[1] / 2, z: box.size[2] / 2 }, { x: q.x, y: q.y, z: q.z, w: q.w });
    impacts.set(c.handle, surface);
  }
}

/**
 * The textured surface a kit piece is drawn with (tint in vertex colours), or
 * null for the shared looks (glass, lights, water...). Pieces with their own
 * tint keep it on any surface.
 */
function kitSurface(mat: KitMaterial, tint: string | undefined, kind: SurfaceMaterial, color: string | undefined, trim: string | undefined): [SurfaceMaterial, string | undefined] | null {
  switch (mat) {
    case 'body':
      return [kind, tint ?? color];
    case 'trim':
      return [kind, tint ?? trim];
    case 'metal':
    case 'wood':
    case 'concrete':
      return [mat, tint];
    case 'dirt':
      return ['ground', tint ?? color ?? '#9c8a64'];
    case 'paint':
      return ['paint', tint ?? color ?? '#5d6152'];
    // Dark fittings (bumpers, frames, undersides): dark paint, worn.
    case 'dark':
      return ['paint', tint ?? '#2b2d2c'];
    case 'canvas':
      return ['canvas', tint ?? color ?? '#6f6c50'];
    case 'rubber':
      return ['rubber', tint];
    default:
      return null;
  }
}

/** A kit's render pieces into the map's batches. */
function addKitPieces(
  pieces: ReturnType<typeof buildKit>['pieces'],
  toWorld: THREE.Matrix4,
  kind: SurfaceMaterial,
  color: string | undefined,
  batches: Map<string, Batch>,
  surfaces: SurfaceLibrary,
  shared: ReturnType<typeof kitMaterials>,
): void {
  const trim = color ? `#${new THREE.Color(color).multiplyScalar(0.72).getHexString()}` : undefined;
  const materialFor = (m: KitMaterial): THREE.Material => {
    switch (m) {
      case 'body':
        return color ? surfaces.tinted(kind, color) : surfaces.get(kind);
      case 'trim':
        return trim ? surfaces.tinted(kind, trim) : surfaces.get(kind);
      case 'metal':
        return surfaces.get('metal');
      case 'wood':
        return surfaces.get('wood');
      case 'concrete':
        return surfaces.get('concrete');
      case 'dirt':
        return surfaces.tinted('ground', color ?? '#9c8a64');
      default:
        return shared[m];
    }
  };
  for (const p of pieces) {
    // Contact shade and darker undersides, in kit space (y = 0 on the ground).
    const pos = p.geo.getAttribute('position');
    const nrm = p.geo.getAttribute('normal');
    const shade = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) {
      const up = Math.min(1, Math.max(0, pos.getY(k) / KIT_SHADE.height));
      shade[k] = (1 - KIT_SHADE.contact * (1 - up * up * (3 - 2 * up))) * (nrm && nrm.getY(k) < -0.3 ? KIT_SHADE.under : 1);
    }
    p.geo.applyMatrix4(toWorld);
    // Surface pieces share per-surface batches (tint in vertex colours); the kit's own looks keep theirs.
    const surface = kitSurface(p.mat, p.tint, kind, color, trim);
    if (surface) {
      p.geo.setAttribute('shade', new THREE.BufferAttribute(shade, 1));
      pushTinted(batches, surfaces, surface[0], surface[1], p.geo, 'kit', true);
      continue;
    }
    const col = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = shade[k]!;
    p.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const material = materialFor(p.mat);
    const key = `${material.uuid}kit`;
    let batch = batches.get(key);
    if (!batch) {
      batch = { material, geometries: [], castShadow: true };
      batches.set(key, batch);
    }
    batch.geometries.push(p.geo);
  }
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const one = new THREE.Vector3(1, 1, 1);

function addBox(
  obj: MapObject,
  batches: Map<string, Batch>,
  physics: PhysicsWorld,
  surfaces: SurfaceLibrary | null,
  impacts: SurfaceRegistry,
  batchTag = '',
  collide = true,
): void {
  const [w, h, d] = obj.size;
  const kind = obj.material ?? DEFAULT_MATERIAL[obj.type];

  if (obj.rot) tmpEuler.set(obj.rot[0] * DEG, obj.rot[1] * DEG, obj.rot[2] * DEG);
  else tmpEuler.set(0, 0, 0);
  tmpQuat.setFromEuler(tmpEuler);
  if (surfaces) {
    const geo = new THREE.BoxGeometry(w, h, d);
    worldScaleBoxUVs(geo, w, h, d);
    geo.applyMatrix4(tmpMatrix.compose(new THREE.Vector3(...obj.pos), tmpQuat, one));
    pushTinted(batches, surfaces, kind, obj.color, geo, batchTag, batchTag !== 'ground');
  }
  if (!collide) return;

  const collider = physics.addStaticBox(
    { x: obj.pos[0], y: obj.pos[1], z: obj.pos[2] },
    { x: w / 2, y: h / 2, z: d / 2 },
    { x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w },
  );
  impacts.set(collider.handle, SURFACE_FROM_MATERIAL[kind]);
}
