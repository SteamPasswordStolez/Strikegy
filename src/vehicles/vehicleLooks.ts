import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceLibrary } from '@/render/textures';
import type { KitBuilder, KitMaterial } from '@/world/modelKits';
import type { Team } from '@/world/mapTypes';
import type { VehicleSkinLook } from '@/progression/catalog';

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
uniform float uCamoScale, uDust, uPattern, uBand;
float camoHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float camoNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(camoHash(i), camoHash(i + vec3(1, 0, 0)), f.x), mix(camoHash(i + vec3(0, 1, 0)), camoHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(camoHash(i + vec3(0, 0, 1)), camoHash(i + vec3(1, 0, 1)), f.x), mix(camoHash(i + vec3(0, 1, 1)), camoHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float camoFbm(vec3 p) { return 0.65 * camoNoise(p) + 0.35 * camoNoise(p * 2.3 + 11.0); }
`;

/** Vehicle skin patterns (progression step 6) as the shader's numbers; 0 is the default blotches. */
const VPATTERN: Record<VehicleSkinLook['pattern'], number> = { blotch: 0, bands: 1, stripes: 2, digital: 3, clouds: 4, tiger: 5, dazzle: 6, splinter: 7 };

/**
 * Painted steel in the side's camouflage: blotches in object space (they stay
 * put on the hull), dust toward the bottom. A vehicle skin changes the
 * pattern and the tones of the side's own three colours (never the colours'
 * family: friend or foe still reads at a distance), and can add a dark band.
 */
function camoPaint(team: Team | null, livery: Livery, skin?: VehicleSkinLook): THREE.Material {
  const skey = skin ? `${skin.pattern}:${skin.scale}:${skin.tones.join(',')}:${skin.band ? 1 : 0}` : '';
  return cached(`camo-${livery}-${team}-${skey}`, () => {
    const pal = CAMO[livery][team ?? 'none'];
    const tone = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
    const [a, b, c] = skin && team ? [tone(pal[0], skin.tones[0]), tone(pal[1], skin.tones[1]), tone(pal[2], skin.tones[2])] : pal;
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
      uCamoScale: { value: team ? (livery === 'air' ? 0.22 : 0.55) * (skin?.scale ?? 1) : 0 },
      uDust: { value: livery === 'air' ? 0 : 0.35 },
      uPattern: { value: skin ? VPATTERN[skin.pattern] : 0 },
      uBand: { value: skin?.band ? 1 : 0 },
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
          vec3 q = vCamoPos * uCamoScale;
          int pat = int(uPattern + 0.5);
          if (pat == 1) {
            float n = camoFbm(vec3(q.x * 0.5, q.y * 2.0, q.z * 0.5));
            camo = n < 0.42 ? uCamoB : n > 0.6 ? uCamoC : uCamoA;
          } else if (pat == 2) {
            float s = sin(q.z * 3.0 + q.y * 1.5 + camoFbm(q) * 3.0);
            camo = s > 0.4 ? uCamoB : s < -0.55 ? uCamoC : uCamoA;
          } else if (pat == 3) {
            vec3 g = floor(q * 4.0) / 4.0;
            float n1 = camoFbm(g), n2 = camoFbm(g * 1.3 + 37.0);
            camo = mix(mix(uCamoA, uCamoB, step(0.55, n1)), uCamoC, step(0.62, n2));
          } else if (pat == 4) {
            float n = camoFbm(q * 0.6);
            camo = mix(mix(uCamoA, uCamoB, smoothstep(0.45, 0.6, n)), uCamoC, smoothstep(0.62, 0.72, camoFbm(q * 0.9 + 11.0)));
          } else if (pat == 5) {
            float s = sin(q.z * 2.4 + camoFbm(q * 1.2) * 6.0) + (camoNoise(q * 2.5) - 0.5);
            camo = s > 0.75 ? uCamoC : s < -0.85 ? uCamoB : uCamoA;
          } else if (pat == 6) {
            // Dazzle: big hard-edged angular blocks.
            float d = sin(q.z * 0.9 + q.y * 1.7) * sin(q.z * -1.3 + q.y * 0.6 + 2.0) + (camoNoise(floor(q * 0.8)) - 0.5) * 0.6;
            camo = d > 0.15 ? uCamoA : d < -0.2 ? uCamoC : uCamoB;
          } else if (pat == 7) {
            float a = sin(q.z * 1.6 + q.y * 2.1) + sin(q.z * -2.7 + q.y * 1.3 + 1.7) + (camoNoise(floor(q * 1.6)) - 0.5) * 1.3;
            camo = a > 0.55 ? uCamoB : a < -0.7 ? uCamoC : uCamoA;
          } else {
            float n1 = camoFbm(q);
            float n2 = camoFbm(q * 1.3 + 37.0);
            camo = mix(camo, uCamoB, smoothstep(0.54, 0.57, n1));
            camo = mix(camo, uCamoC, smoothstep(0.6, 0.63, n2));
          }
          // A band round the middle of the hull.
          if (uBand > 0.5) camo = mix(camo, uCamoC * 0.55, step(abs(vCamoPos.z - 0.4), 0.22));
        }
        // Dust and dried mud up the lower hull and running gear.
        float dust = (1.0 - smoothstep(-1.0, 0.3, vCamoPos.y)) * uDust * (0.7 + 0.3 * camoNoise(vCamoPos * 4.0));
        diffuseColor.rgb *= mix(camo, vec3(0.42, 0.37, 0.29), dust);`,
      );
    };
    // One program for every look (pattern and colours are uniforms).
    base.customProgramCacheKey = () => 'vcamo';
    base.userData.vcamo = { team, livery };
    return base;
  });
}

/**
 * A vehicle skin on a built vehicle (its painted camouflage parts, near and
 * far looks), or back to the side's default with null.
 */
export function applyVehicleSkin(root: THREE.Object3D, skin: VehicleSkinLook | null): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.Material;
    const tag = m && !Array.isArray(m) ? (m.userData.vcamo as { team: Team | null; livery: Livery } | undefined) : undefined;
    if (!tag) return;
    mesh.material = camoPaint(tag.team, tag.livery, skin ?? undefined);
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
  // meshes of their own, shown up close only and left out of the far look;
  // pieces marked near-only (track links) are left out of it too, and
  // far-only stand-ins (a track belt) are only in it.
  const groups = new Map<string, { m: THREE.Material; tag: 'fine' | 'near' | 'far' | ''; geos: THREE.BufferGeometry[] }>();
  for (const p of b.pieces) {
    const m = vehicleMaterial(p.mat, p.tint, team, livery);
    for (const k of Object.keys(p.geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') p.geo.deleteAttribute(k);
    p.geo.computeBoundingSphere();
    const tag = p.lod === 'far' ? 'far' : p.geo.boundingSphere!.radius < FINE ? 'fine' : p.lod === 'near' ? 'near' : '';
    const key = `${m.uuid}${tag}`;
    const g = groups.get(key) ?? { m, tag, geos: [] };
    g.geos.push(p.geo);
    groups.set(key, g);
  }
  for (const { m, tag, geos } of groups.values()) {
    const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0]!;
    if (!merged) continue;
    if (merged !== geos[0]) for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(merged, m);
    if (tag === 'fine') mesh.userData.fine = true;
    if (tag === 'near') mesh.userData.nearOnly = true;
    if (tag === 'far') {
      mesh.userData.farOnly = true;
      mesh.visible = false;
    }
    node.add(mesh);
  }
}

/** Parts smaller than this (bounding radius, m) are left out of the far look. */
const FINE = 0.12;
