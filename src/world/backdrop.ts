import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TileNoise, makeRng, smoothstep } from '@/render/noise';

const EXTENT = 1400;

/**
 * Render-only scenery around the playable area: rolling hills that rise
 * beyond the map bounds plus instanced low-poly trees. No collision.
 */
export function buildBackdrop(scene: THREE.Scene, mapSize: [number, number], lowDetail: boolean): THREE.Group {
  // Everything here is distant scenery: no shadow casting, modest tessellation, one draw for all trees.
  const group = new THREE.Group();
  group.name = 'backdrop';
  const n = new TileNoise(99);
  const halfX = mapSize[0] / 2;
  const halfZ = mapSize[1] / 2;

  // Distance outside the playable rectangle, 0 inside.
  const outside = (x: number, z: number) => {
    const dx = Math.max(0, Math.abs(x) - halfX);
    const dz = Math.max(0, Math.abs(z) - halfZ);
    return Math.hypot(dx, dz);
  };
  const heightAt = (x: number, z: number) => {
    const d = outside(x, z);
    if (d <= 0) return -0.3;
    const u = x / EXTENT + 0.5;
    const v = z / EXTENT + 0.5;
    const hills = n.fbm(u, v, 3, 5);
    const rise = smoothstep(8, 160, d);
    return -0.3 + rise * (8 + hills * 70) + smoothstep(300, 700, d) * 60 * n.fbm(u + 0.3, v, 2, 3);
  };

  const seg = lowDetail ? 72 : 120;
  const geo = new THREE.PlaneGeometry(EXTENT, EXTENT, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x56643a);
  const dryGrass = new THREE.Color(0x8a7f55);
  const rock = new THREE.Color(0x77736a);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const u = x / EXTENT + 0.5;
    const v = z / EXTENT + 0.5;
    c.copy(grass).lerp(dryGrass, n.fbm(u + 0.7, v + 0.1, 8, 3));
    c.lerp(rock, smoothstep(45, 90, h) * 0.8);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
  );
  terrain.receiveShadow = false;
  group.add(terrain);

  // Trees: trunk + cone canopy merged into one geometry (vertex colors), drawn as a single instanced mesh.
  const count = lowDetail ? 200 : 380;
  const colorize = (geo: THREE.BufferGeometry, hex: number) => {
    const col = new THREE.Color(hex);
    const n = geo.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  };
  const trunkGeo = colorize(new THREE.CylinderGeometry(0.25, 0.35, 3, 5).translate(0, 1.5, 0), 0x4a3828);
  const canopyGeo = colorize(new THREE.ConeGeometry(2.2, 7, 6).translate(0, 6, 0), 0xffffff);
  const treeGeo = mergeGeometries([trunkGeo.toNonIndexed(), canopyGeo.toNonIndexed()])!;
  const trees = new THREE.InstancedMesh(
    treeGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    count,
  );
  const rng = makeRng(7);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tint = new THREE.Color();
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 20; tries++) {
    const x = (rng() - 0.5) * EXTENT * 0.8;
    const z = (rng() - 0.5) * EXTENT * 0.8;
    const d = outside(x, z);
    if (d < 14 || d > 500) continue;
    // Clustered forests: accept more where a noise field is high.
    if (n.fbm(x / EXTENT + 0.5, z / EXTENT + 0.5, 6, 3) < 0.45 + rng() * 0.2) continue;
    const scale = 0.8 + rng() * 0.9;
    p.set(x, heightAt(x, z) - 0.2, z);
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng() * Math.PI * 2);
    s.set(scale, scale * (0.85 + rng() * 0.4), scale);
    m.compose(p, q, s);
    trees.setMatrixAt(placed, m);
    // Instance color tints the (white) canopy; the trunk color is dark enough to survive it.
    trees.setColorAt(placed, tint.setHSL(0.3 + rng() * 0.05, 0.32, 0.13 + rng() * 0.06, THREE.SRGBColorSpace));
    placed++;
  }
  trees.count = placed;
  group.add(trees);

  scene.add(group);
  return group;
}
