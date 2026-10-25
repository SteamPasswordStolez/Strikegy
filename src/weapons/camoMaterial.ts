import * as THREE from 'three';
import type { CamoLook } from '@/progression/catalog';
import { gunMaterials } from './gunKit';

/**
 * Camouflage on the guns (progression step 5): the painted parts of a gun
 * (receiver, handguard, stock, furniture) drawn with a pattern worked out in
 * the shader from the part's own position, so it wraps every procedural gun
 * without UVs. One pattern family: blotches, bands, stripes, digital squares,
 * tiger stripes, a net, metal grain (brass and the ceremonial / general
 * camos), obsidian with flowing veins, dragon scales, waves, a flowing mix;
 * colours, size, metalness and flow come from `CamoLook`. The first-person
 * gun and the gun pictures wear it; soldiers' guns seen in the world keep
 * their plain colours (far, small, baked into one model).
 */

const PATTERN: Record<CamoLook['pattern'], number> = {
  solid: 0,
  blotch: 1,
  bands: 2,
  stripes: 3,
  digital: 4,
  tiger: 5,
  net: 6,
  metal: 7,
  obsidian: 8,
  scales: 9,
  waves: 10,
  flow: 11,
  wrap: 12,
  carbon: 13,
  hex: 14,
  splinter: 15,
};

/** Flowing camos run on one clock (`tickCamo`). */
const clock = { value: 0 };

export function tickCamo(t: number): void {
  clock.value = t;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

function key(look: CamoLook, base: THREE.Material): string {
  return `${base.uuid}|${look.pattern}|${look.colors.join(',')}|${look.scale}|${look.metal ?? 0}|${look.flow ?? 0}`;
}

const GLSL = /* glsl */ `
uniform vec3 camoA;
uniform vec3 camoB;
uniform vec3 camoC;
uniform float camoScale;
uniform float camoKind;
uniform float camoFlow;
uniform float camoTime;
uniform float camoMetal;
varying vec3 vCamoPos;
float cHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cHash(i), cHash(i + vec3(1,0,0)), f.x), mix(cHash(i + vec3(0,1,0)), cHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(cHash(i + vec3(0,0,1)), cHash(i + vec3(1,0,1)), f.x), mix(cHash(i + vec3(0,1,1)), cHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float cFbm(vec3 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 4; k++) { s += a * cNoise(p); p *= 2.03; a *= 0.5; } return s; }
// Returns the colour and (in w) how metallic the spot is.
vec4 camoColor() {
  vec3 p = vCamoPos * camoScale;
  float t = camoTime * camoFlow;
  int kind = int(camoKind + 0.5);
  if (kind == 0) return vec4(mix(camoA, camoB, cNoise(p * 2.0) * 0.25), 0.0);
  if (kind == 1) { float n = cFbm(p); return vec4(n < 0.42 ? camoB : n < 0.58 ? camoA : camoC, 0.0); }
  if (kind == 2) { float n = cFbm(vec3(p.x * 0.6, p.y * 1.8, p.z * 0.6)); return vec4(n < 0.4 ? camoB : n < 0.6 ? camoA : camoC, 0.0); }
  if (kind == 3) { float s = sin(p.y * 6.0 + cFbm(p) * 5.0); return vec4(s > 0.45 ? camoB : s < -0.6 ? camoC : camoA, 0.0); }
  if (kind == 4) { vec3 q = floor(p * 1.5) / 1.5; float n = cFbm(q); return vec4(n < 0.42 ? camoB : n < 0.58 ? camoA : camoC, 0.0); }
  if (kind == 5) { float s = sin(p.z * 3.0 + cFbm(p * 1.3) * 7.0) + (cNoise(p * 3.0) - 0.5); return vec4(s > 0.7 ? camoB : s < -0.9 ? camoC : camoA, 0.0); }
  if (kind == 6) { vec3 g = abs(fract(p * 1.2 + cNoise(p) * 0.2) - 0.5); float line = step(min(min(g.x, g.y), g.z), 0.06); return vec4(mix(mix(camoA, camoC, cFbm(p) * 0.6), camoB, line), 0.0); }
  if (kind == 7) {
    float grain = cNoise(vec3(p.x * 0.3, p.y * 0.3, p.z * 24.0)) * 0.6 + cNoise(p * 4.0) * 0.4;
    vec3 c = mix(camoB, camoA, grain);
    c = mix(c, camoC, smoothstep(0.82, 1.0, grain) * 0.6);
    return vec4(c, 1.0);
  }
  if (kind == 8) {
    float v = abs(cFbm(p + vec3(0.0, t, 0.0)) - 0.5);
    float vein = smoothstep(0.035, 0.0, v);
    return vec4(mix(mix(camoB, camoA, cNoise(p * 2.0)), camoC * 1.6, vein), 0.9 - vein * 0.6);
  }
  if (kind == 9) {
    vec2 q = vec2(p.z * 1.2, p.y * 1.2 + mod(floor(p.z * 1.2), 2.0) * 0.5);
    vec2 f = fract(q) - 0.5;
    float edge = smoothstep(0.38, 0.5, length(f));
    float shine = 0.5 + 0.5 * sin(floor(q.x) * 1.7 + floor(q.y) * 2.3 + t * 3.0);
    return vec4(mix(mix(camoB, camoA, shine), camoC, edge * 0.7), 0.85);
  }
  if (kind == 10) { float s = sin(p.z * 2.0 + sin(p.y * 3.0 + t * 2.0) * 1.5 + cFbm(p) * 3.0); return vec4(mix(camoB, s > 0.0 ? camoA : camoC, abs(s)), 0.2); }
  if (kind == 12) {
    // Cloth / tape wrapped round the gun: diagonal turns with gaps, the cloth mottled.
    float turn = fract((p.z + p.y * 0.55) * 1.6);
    float gap = smoothstep(0.0, 0.06, turn) * smoothstep(1.0, 0.92, turn);
    vec3 cloth = mix(camoA, camoC, cFbm(p * 2.5));
    return vec4(mix(camoB, cloth, gap), 0.0);
  }
  if (kind == 13) {
    // Carbon fibre: a twill weave catching the light.
    vec2 q = vec2(p.z + p.x, p.y) * 1.0;
    float w = step(0.5, fract(q.x + floor(q.y) * 0.5)) ;
    float sheen = 0.5 + 0.5 * sin((q.x + q.y) * 6.2832);
    return vec4(mix(camoB, mix(camoA, camoC, sheen * w), 0.8), 0.15);
  }
  if (kind == 14) {
    // Hexagon cells.
    vec2 q = vec2(p.z, p.y * 1.1547);
    vec2 r = vec2(1.0, 1.732);
    vec2 a = mod(q, r) - r * 0.5; vec2 b = mod(q - r * 0.5, r) - r * 0.5;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    float edge = smoothstep(0.38, 0.45, max(abs(g.x) * 0.866 + abs(g.y) * 0.5, abs(g.y)));
    return vec4(mix(mix(camoB, camoA, cNoise(floor(q * 1.3) + 3.0)), camoC, edge), 0.0);
  }
  if (kind == 15) {
    // Splinter: hard-edged angular shards.
    float a = sin(p.z * 1.7 + p.y * 2.3) + sin(p.z * -2.9 + p.y * 1.1 + 1.7) + (cNoise(floor(p * 2.0)) - 0.5) * 1.4;
    return vec4(a > 0.6 ? camoB : a < -0.7 ? camoC : camoA, 0.0);
  }
  float n = cFbm(p + vec3(t * 0.6, -t * 0.4, t * 0.3));
  return vec4(mix(mix(camoB, camoA, smoothstep(0.3, 0.6, n)), camoC, smoothstep(0.62, 0.8, n)), 0.6);
}
`;

/** A painted gun material wearing `look` (cached: a new material is a shader compile). */
export function camoMaterial(look: CamoLook, base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const k = key(look, base);
  let m = cache.get(k);
  if (m) return m;
  m = base.clone();
  m.color.set(0xffffff);
  const metal = look.metal ?? 0;
  m.metalness = metal > 0 ? 0.35 + metal * 0.6 : base.metalness;
  if (metal > 0) m.roughness = 1;
  const colors = look.colors.map((c) => new THREE.Color(c));
  const uniforms = {
    camoA: { value: colors[0] },
    camoB: { value: colors[1] },
    camoC: { value: colors[2] },
    camoScale: { value: look.scale },
    camoKind: { value: PATTERN[look.pattern] },
    camoFlow: { value: look.flow ?? 0 },
    camoMetal: { value: metal > 0 ? 0.35 + metal * 0.6 : 0 },
    camoTime: clock,
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCamoPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamoPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\nvec4 camoC4 = camoColor();\ndiffuseColor.rgb *= camoC4.rgb;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, camoMetal, camoC4.w * step(0.001, camoMetal));');
  };
  // One program for every camo (the pattern is a uniform).
  m.customProgramCacheKey = () => 'camo';
  m.userData.camo = true;
  cache.set(k, m);
  return m;
}

/** Puts `look` on a built gun's painted parts (receiver alloy, polymer, wood, coloured furniture). */
export function applyCamo(group: THREE.Object3D, look: CamoLook): void {
  const g = gunMaterials();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat || Array.isArray(mat) || mat.userData?.camo) return;
    if (mat === g.alloy || mat === g.polymer || mat === g.wood || mat.userData?.paint) mesh.material = camoMaterial(look, mat);
  });
}
