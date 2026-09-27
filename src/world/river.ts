import * as THREE from 'three';
import { TileNoise } from '@/render/noise';
import type { RiverDef } from './mapTypes';
import type { Terrain } from './terrain';

/** Spacing of the water ribbon's rows along the river (m). */
const STEP = 3;
/** Water colour in the channel and shelf ice along the banks. */
const WATER = new THREE.Color(0x1a2429);
const ICE = new THREE.Color(0xdfe7ee);

/** Points every `step` meters along a polyline, with the unit direction at each. */
export function resample(pts: readonly (readonly [number, number])[], step: number): { x: number; z: number; dx: number; dz: number }[] {
  const out: { x: number; z: number; dx: number; dz: number }[] = [];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    for (let s = carry; s < len; s += step) out.push({ x: ax + dx * s, z: az + dz * s, dx, dz });
    carry = (step - ((len - carry) % step)) % step;
  }
  const [lx, lz] = pts[pts.length - 1]!;
  const last = out[out.length - 1];
  out.push({ x: lx, z: lz, dx: last?.dx ?? 0, dz: last?.dz ?? 1 });
  return out;
}

/** Height of the water surface at a point of the river's centre line. */
export function waterLevel(terrain: Terrain, r: RiverDef, x: number, z: number): number {
  return terrain.heightAt(x, z) + (r.water ?? 0.6);
}

/**
 * Water ribbons for the terrain's rivers: a strip wider than the bed so its
 * edges disappear into the banks, with shelf ice along both sides (vertex
 * colours). Render only: characters wade on the bed below.
 */
export function buildRivers(terrain: Terrain, environment: THREE.Texture | null): THREE.Group {
  const group = new THREE.Group();
  group.name = 'rivers';
  const noise = new TileNoise(77);
  // Its own (dimmed) environment map: with the scene's full-strength sky the
  // grazing-angle reflection turns a small river into a pale sheet that reads as snow.
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.2,
    metalness: 0,
    specularIntensity: 0.6,
    envMap: environment,
    envMapIntensity: 0.25,
    transparent: true,
    opacity: 0.94,
  });
  // Across the strip: shelf ice under the banks, a ragged ice edge, open water.
  const across = [-1, -0.86, -0.7, 0, 0.7, 0.86, 1];
  for (const r of terrain.rivers) {
    const rows = resample(r.pts, STEP);
    const half = r.width / 2 + (r.bank ?? 5) * 0.8;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    rows.forEach((p, i) => {
      const y = waterLevel(terrain, r, p.x, p.z);
      const ice = noise.fbm(i / rows.length, 0.5, 12, 3);
      for (const a of across) {
        const s = a * half;
        pos.push(p.x - p.dz * s, y, p.z + p.dx * s);
        const k = Math.abs(a);
        const edge = k === 1 ? 1 : k > 0.8 ? 0.35 + 0.6 * ice : k > 0.6 ? 0.25 * ice : 0;
        c.copy(WATER).lerp(ICE, edge);
        col.push(c.r, c.g, c.b);
      }
      if (i === 0) return;
      const a0 = (i - 1) * across.length;
      const b0 = i * across.length;
      for (let k = 0; k < across.length - 1; k++) idx.push(a0 + k, a0 + k + 1, b0 + k, a0 + k + 1, b0 + k + 1, b0 + k);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // Face up whatever the winding of the centre line.
    const n = geo.getAttribute('normal') as THREE.BufferAttribute;
    if (n.count && n.getY(0) < 0) {
      geo.setIndex(idx.map((_, i) => idx[i - (i % 3) + (2 - (i % 3))]!));
      geo.computeVertexNormals();
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.name = 'river';
    group.add(mesh);
  }
  return group;
}
