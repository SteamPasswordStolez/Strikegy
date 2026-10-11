import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceLibrary } from '@/render/textures';
import type { KitBuilder, KitMaterial } from '@/world/modelKits';
import type { Team } from '@/world/mapTypes';

/**
 * Looks for the vehicle models: painted steel with a camouflage pattern per
 * side (blue woodland, red desert: they also tell friend from foe at a
 * distance), dust low on the hull, and the textured surfaces of the map kits
 * (chips, rust, rubber, canvas). Without a surface library (game server,
 * tests) plain colours.
 */

let lib: SurfaceLibrary | null = null;

/** The game's surfaces, for the vehicles built from now on. */
export function setVehicleSurfaces(surfaces: SurfaceLibrary | null): void {
  lib = surfaces;
  cache.clear();
}

const cache = new Map<string, THREE.Material>();
function cached(key: string, make: () => THREE.Material): THREE.Material {
  let m = cache.get(key);
  if (!m) cache.set(key, (m = make()));
  return m;
}

/** Camouflage colours (base, second, third) per side: ground vehicles, and aircraft (greys). */
export type Livery = 'ground' | 'air';
const CAMO: Record<Livery, Record<'blue' | 'red' | 'none', [number, number, number]>> = {
  ground: {
    blue: [0x3c4a2e, 0x4c3d2a, 0x1e201a],
    red: [0x8a7650, 0x67503a, 0x726c4c],
    none: [0x4e5040, 0x4a4a38, 0x36372d],
  },
  air: {
    blue: [0x4f5861, 0x434b53, 0x3a4148],
    red: [0x6e6656, 0x5d5648, 0x4f4b42],
    none: [0x585b5e, 0x4c4f52, 0x424548],
  },
};

const CAMO_GLSL = /* glsl */ `
varying vec3 vCamoPos;
uniform vec3 uCamoA, uCamoB, uCamoC;
uniform float uCamoScale, uDust;
float camoHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float camoNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(camoHash(i), camoHash(i + vec3(1, 0, 0)), f.x), mix(camoHash(i + vec3(0, 1, 0)), camoHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(camoHash(i + vec3(0, 0, 1)), camoHash(i + vec3(1, 0, 1)), f.x), mix(camoHash(i + vec3(0, 1, 1)), camoHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float camoFbm(vec3 p) { return 0.65 * camoNoise(p) + 0.35 * camoNoise(p * 2.3 + 11.0); }
`;

/** Painted steel in the side's camouflage: blotches in object space (they stay put on the hull), dust toward the bottom. */
function camoPaint(team: Team | null, livery: Livery): THREE.Material {
  return cached(`camo-${livery}-${team}`, () => {
    const [a, b, c] = CAMO[livery][team ?? 'none'];
    const base = lib ? lib.get('paint').clone() : new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.2 });
    // The paint texture's colour (chips, rust) reads as measles at a vehicle's
    // scale; its roughness / normal maps keep the worn finish.
    base.map = null;
    base.color.set(0xffffff);
    if (!lib) base.color.set(a);
    const uniforms = {
      uCamoA: { value: new THREE.Color(a) },
      uCamoB: { value: new THREE.Color(b) },
      uCamoC: { value: new THREE.Color(c) },
      uCamoScale: { value: team ? (livery === 'air' ? 0.22 : 0.55) : 0 },
      uDust: { value: livery === 'air' ? 0 : 0.35 },
    };
    base.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCamoPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamoPos = position;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${CAMO_GLSL}`).replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 camo = uCamoA;
        if (uCamoScale > 0.0) {
          float n1 = camoFbm(vCamoPos * uCamoScale);
          float n2 = camoFbm(vCamoPos * uCamoScale * 1.3 + 37.0);
          camo = mix(camo, uCamoB, smoothstep(0.54, 0.57, n1));
          camo = mix(camo, uCamoC, smoothstep(0.6, 0.63, n2));
        }
        // Dust and dried mud up the lower hull and running gear.
        float dust = (1.0 - smoothstep(-1.0, 0.3, vCamoPos.y)) * uDust * (0.7 + 0.3 * camoNoise(vCamoPos * 4.0));
        diffuseColor.rgb *= mix(camo, vec3(0.42, 0.37, 0.29), dust);`,
      );
    };
    base.customProgramCacheKey = () => `camo-${livery}-${team}`;
    return base;
  });
}

function surface(kind: 'paint' | 'rubber' | 'canvas' | 'metal', color: number, fallback: THREE.MeshStandardMaterialParameters): THREE.Material {
  return cached(`${kind}-${color}`, () => {
    if (!lib) return new THREE.MeshStandardMaterial({ color, ...fallback });
    const m = lib.get(kind).clone();
    m.color.set(color);
    return m;
  });
}

/** The material a vehicle piece is drawn with. */
export function vehicleMaterial(mat: KitMaterial, tint: string | undefined, team: Team | null, livery: Livery = 'ground'): THREE.Material {
  switch (mat) {
    case 'body':
    case 'trim':
    case 'paint':
      return tint ? surface('paint', new THREE.Color(tint).getHex(), { roughness: 0.6, metalness: 0.2 }) : camoPaint(team, livery);
    case 'dark':
      return surface('paint', tint ? new THREE.Color(tint).getHex() : 0x2b2d2c, { roughness: 0.6, metalness: 0.3 });
    case 'metal':
      return surface('paint', tint ? new THREE.Color(tint).getHex() : 0x6a6d70, { roughness: 0.45, metalness: 0.6 });
    case 'mesh':
      return surface('paint', 0x232523, { roughness: 0.6, metalness: 0.4 });
    case 'rubber':
      return surface('rubber', 0xffffff, { roughness: 0.92 });
    case 'canvas':
      return surface('canvas', tint ? new THREE.Color(tint).getHex() : 0x6c6a4c, { roughness: 0.95 });
    case 'wood':
      return cached('wood', () => (lib ? lib.get('wood') : new THREE.MeshStandardMaterial({ color: 0x6e5a44, roughness: 0.85 })));
    case 'glass':
      return cached('glass', () => new THREE.MeshStandardMaterial({ color: 0x0f1518, roughness: 0.08, metalness: 0.1, envMapIntensity: 0.5 }));
    case 'light':
      return cached('lamp', () => new THREE.MeshStandardMaterial({ color: 0xdedcc8, emissive: 0x333022, roughness: 0.3 }));
    case 'redLight':
      return cached('redLamp', () => new THREE.MeshStandardMaterial({ color: 0x8a1a14, emissive: 0x2a0503, roughness: 0.4 }));
    default:
      return camoPaint(team, livery);
  }
}

/**
 * Adds a builder's pieces to `node` as one mesh per material (all pieces of
 * a moving part merged: a handful of draw calls per part).
 */
export function bakeInto(node: THREE.Object3D, b: KitBuilder, team: Team | null, livery: Livery = 'ground'): void {
  // Small parts (bolts, vision blocks, handles: under FINE m across) go in
  // meshes of their own, left out of the far look (a few pixels past 45 m).
  const groups = new Map<string, { m: THREE.Material; fine: boolean; geos: THREE.BufferGeometry[] }>();
  for (const p of b.pieces) {
    const m = vehicleMaterial(p.mat, p.tint, team, livery);
    for (const k of Object.keys(p.geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') p.geo.deleteAttribute(k);
    p.geo.computeBoundingSphere();
    const fine = p.geo.boundingSphere!.radius < FINE;
    const key = `${m.uuid}${fine ? 'f' : ''}`;
    const g = groups.get(key) ?? { m, fine, geos: [] };
    g.geos.push(p.geo);
    groups.set(key, g);
  }
  for (const { m, fine, geos } of groups.values()) {
    const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0]!;
    if (!merged) continue;
    if (merged !== geos[0]) for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(merged, m);
    if (fine) mesh.userData.fine = true;
    node.add(mesh);
  }
}

/** Parts smaller than this (bounding radius, m) are left out of the far look. */
const FINE = 0.12;
