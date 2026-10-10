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
  concrete: 0.3,
  concrete_floor: 0.14,
  metal: 0.1,
  wood: 0.12,
  brick: 0.14,
  snow: 0.08,
  grass: 0.22,
  sand: 0.16,
  plaster: 0.2,
  brick_old: 0.12,
  roof: 0.14,
  asphalt: 0.16,
  cobble: 0.12,
  rock: 0.18,
};

interface ScannedSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** AO / roughness / metalness packed in R / G / B. */
  arm: THREE.Texture;
}

/** Real-world meters covered by one tile of each scanned texture set. */
const SCANNED_TILE_METERS: Record<SurfaceMaterial, number> = {
  ground: 2.5,
  concrete: 4,
  concrete_floor: 3,
  metal: 1.5,
  wood: 2,
  brick: 2,
  snow: 3,
  grass: 3,
  sand: 3,
  plaster: 3,
  brick_old: 2.5,
  roof: 3,
  asphalt: 4,
  cobble: 2.5,
  rock: 4,
};

/** Surfaces that reuse another surface's scanned set (with their own tiling/tint). */
const SCANNED_SOURCE: Partial<Record<SurfaceMaterial, SurfaceMaterial>> = {
  concrete: 'concrete_floor',
};

/** Albedo multiplier so scanned sets sit in the same brightness range as the rest of the scene. */
const SCANNED_TINT: Record<SurfaceMaterial, number> = {
  ground: 1,
  concrete: 0.85,
  concrete_floor: 0.9,
  metal: 0.55,
  wood: 1,
  brick: 0.95,
  snow: 0.92,
  grass: 1,
  sand: 1,
  plaster: 1,
  brick_old: 1,
  roof: 1,
  asphalt: 1,
  cobble: 1,
  rock: 1,
};

/**
 * Albedo scale under a box's own colour (vertex-tinted / tinted materials), for
 * the sets added after the maps' colours were tuned: a map colour on the new set
 * comes out about as bright as it did on the set it replaced (plaster: brick and
 * concrete walls, brick_old: brick, cobble / asphalt: concrete_floor).
 */
const COLOUR_GAIN: Partial<Record<SurfaceMaterial, number>> = {
  plaster: 0.27,
  brick_old: 0.72,
  cobble: 0.34,
  asphalt: 0.85,
};

/** Terrain blends per ground: [surface, tint, amount] for the patches, [surface, tint] on steep slopes. */
const TERRAIN_LAYERS: Partial<Record<SurfaceMaterial, { patch: [SurfaceMaterial, string, number]; steep: [SurfaceMaterial, string] }>> = {
  // Meadows: bare earth worn through the grass, rock on the slopes.
  grass: { patch: ['ground', '#b8a487', 0.6], steep: ['rock', '#c4bcb2'] },
  // Snow: thin patches where the ground shows, dark rock on steep banks.
  snow: { patch: ['ground', '#d8d4cc', 0.45], steep: ['rock', '#a8a49e'] },
  // Desert: darker gravel flats, red-brown rock on the slopes.
  sand: { patch: ['ground', '#d9c0a0', 0.6], steep: ['rock', '#d8ae88'] },
  // Bare ground: grass coming through.
  ground: { patch: ['grass', '#c8cca8', 0.55], steep: ['rock', '#bab4aa'] },
};

/** Kinds with a scanned texture set in public/assets/textures (grass and sand are procedural only: the scanned grass tried read as brown earth). */
export const SURFACE_KINDS: SurfaceMaterial[] = ['ground', 'concrete', 'concrete_floor', 'metal', 'wood', 'brick', 'snow', 'plaster', 'brick_old', 'roof', 'asphalt', 'cobble', 'rock'];

/** Provides PBR materials for blockout surfaces: scanned textures when available, procedural otherwise. */
export class SurfaceLibrary {
  private cache = new Map<SurfaceMaterial, THREE.MeshStandardMaterial>();
  private scanned = new Map<SurfaceMaterial, ScannedSet>();

  constructor(
    private readonly resolution: number,
    private readonly maxAnisotropy: number,
  ) {}

  /**
   * Loads photo-scanned texture sets from `${baseUrl}textures/<kind>/`. Kinds that
   * fail to load keep using the procedural recipe, so the game never blocks on art.
   */
  async preload(kinds: SurfaceMaterial[], baseUrl: string): Promise<void> {
    const loader = new THREE.TextureLoader();
    const aniso = Math.min(8, this.maxAnisotropy);
    await Promise.all(
      kinds.map(async (kind) => {
        const dir = `${baseUrl}textures/${SCANNED_SOURCE[kind] ?? kind}/`;
        try {
          const [map, normalMap, arm] = await Promise.all(
            ['albedo', 'normal', 'arm'].map((n) => loader.loadAsync(`${dir}${n}.webp`)),
          );
          map!.colorSpace = THREE.SRGBColorSpace;
          for (const t of [map!, normalMap!, arm!]) {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = aniso;
          }
          this.scanned.set(kind, { map: map!, normalMap: normalMap!, arm: arm! });
        } catch (err) {
          console.warn(`[surfaces] ${kind}: using procedural fallback`, err);
        }
      }),
    );
  }

  get(kind: SurfaceMaterial): THREE.MeshStandardMaterial {
    const hit = this.cache.get(kind);
    if (hit) return hit;
    let map: THREE.Texture;
    let normalMap: THREE.Texture;
    let orm: THREE.Texture;
    let tileMeters: number;
    let tint = 1;
    const scanned = this.scanned.get(kind);
    if (scanned) {
      ({ map, normalMap, arm: orm } = scanned);
      tileMeters = SCANNED_TILE_METERS[kind];
      tint = SCANNED_TINT[kind];
    } else {
      const recipe = createRecipe(kind);
      const img = rasterize(recipe, this.resolution);
      const aniso = Math.min(8, this.maxAnisotropy);
      map = dataTexture(img.albedo, img.size, true, aniso);
      normalMap = dataTexture(img.normal, img.size, false, aniso);
      orm = dataTexture(img.orm, img.size, false, aniso);
      tileMeters = recipe.tileMeters;
    }
    // UVs are authored in meters; scale so one tile covers `tileMeters`.
    const repeat = 1 / tileMeters;
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
    mat.color.setScalar(tint);
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
      mat.color = new THREE.Color(color).multiplyScalar(COLOUR_GAIN[kind] ?? 1);
      addMacroVariation(mat, MACRO_STRENGTH[kind]);
      this.tints.set(key, mat);
    }
    return mat;
  }

  /**
   * The surface with its tint taken from vertex colours, so boxes of many
   * colours share one merged mesh (one draw call) instead of one per colour.
   */
  vertexTinted(kind: SurfaceMaterial): THREE.MeshStandardMaterial {
    const key = `${kind}:vertex`;
    let mat = this.tints.get(key);
    if (!mat) {
      mat = this.get(kind).clone();
      mat.vertexColors = true;
      mat.color.setScalar(COLOUR_GAIN[kind] ?? 1);
      addMacroVariation(mat, MACRO_STRENGTH[kind]);
      this.tints.set(key, mat);
    }
    return mat;
  }

  /**
   * Ground material for the terrain: the map's ground with a second surface
   * in large world-space patches and a third on steep slopes (see
   * TERRAIN_LAYERS), blended in the shader. Breaks the one-texture-everywhere
   * look without new assets or geometry.
   */
  terrain(kind: SurfaceMaterial): THREE.MeshStandardMaterial {
    const key = `${kind}:terrain`;
    const hit = this.tints.get(key);
    if (hit) return hit;
    const layers = TERRAIN_LAYERS[kind];
    const mat = this.get(kind).clone();
    if (!layers) {
      addMacroVariation(mat, MACRO_STRENGTH[kind]);
      this.tints.set(key, mat);
      return mat;
    }
    macroTex ??= macroNoiseTexture();
    const tex = macroTex;
    const patch = this.get(layers.patch[0]);
    const steep = this.get(layers.steep[0]);
    const strength = MACRO_STRENGTH[kind];
    const uniforms = {
      uMacro: { value: tex },
      uMacroStrength: { value: strength },
      uPatch: { value: patch.map },
      uPatchRepeat: { value: patch.map!.repeat.x },
      uPatchTint: { value: new THREE.Color(layers.patch[1]) },
      uPatchAmount: { value: layers.patch[2] },
      uSteep: { value: steep.map },
      uSteepRepeat: { value: steep.map!.repeat.x },
      uSteepTint: { value: new THREE.Color(layers.steep[1]) },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vMacroWorld;\nvarying vec3 vGroundNormal;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvMacroWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGroundNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vMacroWorld;
          varying vec3 vGroundNormal;
          uniform sampler2D uMacro, uPatch, uSteep;
          uniform float uMacroStrength, uPatchRepeat, uSteepRepeat, uPatchAmount;
          uniform vec3 uPatchTint, uSteepTint;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec2 wuv = vec2(vMacroWorld.x, -vMacroWorld.z);
          float m1 = texture2D(uMacro, wuv * 0.011).r;
          float m2 = texture2D(uMacro, wuv * 0.047).g;
          diffuseColor.rgb *= 1.0 + (mix(m1, m2, 0.4) - 0.5) * 2.0 * uMacroStrength;
          // Patches: soft-edged blobs from two noise octaves, a ragged rim from a third.
          float pn = texture2D(uMacro, wuv * 0.009 + 0.37).g + (texture2D(uMacro, wuv * 0.07).r - 0.5) * 0.3;
          float pw = smoothstep(0.6, 0.7, pn) * uPatchAmount;
          // Only where there is some (the branch is coherent over whole patches: no fetch elsewhere).
          if (pw > 0.003) diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uPatch, wuv * uPatchRepeat).rgb * uPatchTint, pw);
          // Steep ground shows its rock.
          float sw = smoothstep(0.2, 0.34, 1.0 - vGroundNormal.y + (m2 - 0.5) * 0.12);
          if (sw > 0.003) diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uSteep, wuv * uSteepRepeat).rgb * uSteepTint, sw);`,
        );
    };
    mat.customProgramCacheKey = () => `terrain-${kind}`;
    this.tints.set(key, mat);
    return mat;
  }

  /** Albedo multiplier of the untinted surface (the vertex colour of boxes without a colour of their own). */
  baseTint(kind: SurfaceMaterial): THREE.Color {
    return this.get(kind).color.clone().multiplyScalar(1 / (COLOUR_GAIN[kind] ?? 1));
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
