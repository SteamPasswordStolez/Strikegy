import * as THREE from 'three';
import type { SurfaceMaterial } from '@/world/mapTypes';
import { TileNoise } from './noise';
import { createRecipe, rasterize } from './surfaces';

function dataTexture(data: Uint8Array, size: number, srgb: boolean, maxAniso: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = maxAniso;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Low-frequency tileable noise used to break up texture repetition in world space. */
function macroNoiseTexture(): THREE.DataTexture {
  const size = 128;
  const n = new TileNoise(4242);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const p = (y * size + x) * 4;
      data[p] = n.fbm(u, v, 4, 4) * 255;
      data[p + 1] = n.fbm(u + 0.5, v + 0.5, 8, 3) * 255;
      data[p + 2] = 0;
      data[p + 3] = 255;
    }
  }
  const tex = dataTexture(data, size, false, 1);
  return tex;
}

let macroTex: THREE.DataTexture | null = null;

/**
 * Injects world-space macro variation: multiplies albedo by two octaves of
 * large-scale noise so the same tile never looks identical twice.
 */
function addMacroVariation(mat: THREE.MeshStandardMaterial, strength: number): void {
  macroTex ??= macroNoiseTexture();
  const tex = macroTex;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMacro = { value: tex };
    shader.uniforms.uMacroStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvMacroWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vMacroWorld;\nuniform sampler2D uMacro;\nuniform float uMacroStrength;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 macroUv = vec2(vMacroWorld.x + vMacroWorld.y * 0.61, vMacroWorld.z - vMacroWorld.y * 0.37);
        float m1 = texture2D(uMacro, macroUv * 0.011).r;
        float m2 = texture2D(uMacro, macroUv * 0.047).g;
        float macro = mix(m1, m2, 0.4);
        diffuseColor.rgb *= 1.0 + (macro - 0.5) * 2.0 * uMacroStrength;`,
      );
  };
  mat.customProgramCacheKey = () => `macro${strength}`;
}

const MACRO_STRENGTH: Record<SurfaceMaterial, number> = {
  ground: 0.2,
  concrete: 0.16,
  metal: 0.1,
  wood: 0.12,
  brick: 0.14,
};

/** Generates and caches PBR materials for blockout surfaces. */
export class SurfaceLibrary {
  private cache = new Map<SurfaceMaterial, THREE.MeshStandardMaterial>();

  constructor(
    private readonly resolution: number,
    private readonly maxAnisotropy: number,
  ) {}

  get(kind: SurfaceMaterial): THREE.MeshStandardMaterial {
    const hit = this.cache.get(kind);
    if (hit) return hit;
    const recipe = createRecipe(kind);
    const img = rasterize(recipe, this.resolution);
    const aniso = Math.min(8, this.maxAnisotropy);
    const map = dataTexture(img.albedo, img.size, true, aniso);
    const normalMap = dataTexture(img.normal, img.size, false, aniso);
    const orm = dataTexture(img.orm, img.size, false, aniso);
    // UVs are authored in meters; scale so one tile covers `tileMeters`.
    const repeat = 1 / recipe.tileMeters;
    for (const t of [map, normalMap, orm]) t.repeat.set(repeat, repeat);

    const mat = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      roughnessMap: orm,
      metalnessMap: orm,
      aoMap: orm,
      roughness: 1,
      metalness: 1,
      aoMapIntensity: 1,
    });
    addMacroVariation(mat, MACRO_STRENGTH[kind]);
    this.cache.set(kind, mat);
    return mat;
  }

  /** Same surface with an albedo tint (e.g. painted walls). Textures are shared. */
  tinted(kind: SurfaceMaterial, color: string): THREE.MeshStandardMaterial {
    const key = `${kind}:${color}`;
    let mat = this.tints.get(key);
    if (!mat) {
      mat = this.get(kind).clone();
      mat.color = new THREE.Color(color);
      addMacroVariation(mat, MACRO_STRENGTH[kind]);
      this.tints.set(key, mat);
    }
    return mat;
  }

  private tints = new Map<string, THREE.MeshStandardMaterial>();
}

/**
 * Sets a BoxGeometry's UVs to world meters so textures keep a constant scale
 * on every face. Face order in three.js: +x, -x, +y, -y, +z, -z.
 */
export function worldScaleBoxUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  const vertsPerFace = uv.count / 6;
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f]!;
    for (let v = 0; v < vertsPerFace; v++) {
      const i = f * vertsPerFace + v;
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
  }
  uv.needsUpdate = true;
}
