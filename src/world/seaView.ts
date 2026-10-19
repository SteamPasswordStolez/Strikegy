import * as THREE from 'three';
import type { Terrain } from './terrain';
import { MAX_WAVES, seaGlsl, waveUniforms, type Sea } from './waves';

/**
 * The sea's surface as seen (2026-10-18, big maps plan step 2): one disc of
 * vertices round the camera, finest under it (0.75 m) and wider out to the
 * view distance, displaced in the vertex shader by the same Gerstner sum the
 * sim uses (`waves.ts`), so what floats looks like it sits on what is drawn.
 * Waves too short for the mesh at a distance fade there (no shimmer); the
 * per-pixel normal adds them back where the pixels can show them. The sea
 * bed under it (a height texture of the terrain) colours shallow water and
 * puts foam along the shore; crests foam too. Below the surface the fog
 * closes in, blue-green.
 */

/** Ring layout: `near` rings `nearStep` m apart, then each ring `grow` times further out. */
const RINGS = { nearStep: 0.75, near: 40, grow: 1.045, segments: 192 };
/** Ground height texture: one texel per this many metres of the terrain rectangle. */
const BED_TEXEL = 4;
/** The ripple texture: noise cells across it, pixels across, and the gradient range it stores (±). */
const RIPPLE = { cells: 16, size: 256, slope: 2 };
/** Underwater: fog colour and density. */
const UNDER = { color: new THREE.Color(0x0b3a46), density: 0.09 };

export class SeaView {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private savedFog: { color: THREE.Color; density: number } | null = null;
  /** The eye is below the surface (last `update`). */
  under = false;

  constructor(
    private readonly sea: Sea,
    terrain: Terrain,
    far: number,
    /** The scene's environment map: set on the material so `envMapIntensity` counts (with only `scene.environment` it doesn't). */
    environment: THREE.Texture | null,
    /** The sand under the shallows (a black-sand beach's colour), default a pale sand. */
    sand: string | null = null,
  ) {
    const geo = discGeometry(far * 1.02);
    const w = waveUniforms(sea);
    const bed = bedTexture(terrain, sea);
    this.uniforms = {
      seaDir: { value: toVec4s(w.dir) },
      seaShape: { value: toVec4s(w.shape) },
      seaCount: { value: w.count },
      seaTime: { value: 0 },
      seaLevel: { value: sea.level },
      seaBed: { value: bed.texture },
      seaBedBox: { value: new THREE.Vector4(bed.x0, bed.z0, bed.w, bed.d) },
      seaFloor: { value: sea.floor },
      seaSwell: { value: sea.swell },
      seaRipple: { value: rippleTexture() },
      seaSandColor: { value: new THREE.Color(sand ?? '#b6b49a').multiplyScalar(sand ? 0.55 : 0.4) },
    };
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.14, metalness: 0, envMap: environment, envMapIntensity: 0.42, side: THREE.DoubleSide });
    const u = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
${seaGlsl}
varying vec3 vSeaP0;
varying float vSeaLift;`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 seaWorld0 = (modelMatrix * vec4(position, 1.0)).xyz;
float seaDist = length(seaWorld0.xz - cameraPosition.xz);
vec2 seaSlope;
vec3 seaD = seaDisplace(seaWorld0.xz, max(0.0, seaDist * 0.14), seaSlope);
vec3 objectNormal = normalize(vec3(-seaSlope.x, 1.0, -seaSlope.y));
#ifdef USE_TANGENT
vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = position + vec3(seaD.x, seaD.y - seaWorld0.y, seaD.z);
vSeaP0 = seaWorld0;
vSeaLift = seaD.y - seaLevel;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
${seaGlsl}
uniform sampler2D seaBed;
uniform vec4 seaBedBox;
uniform float seaFloor;
uniform float seaSwell;
uniform vec3 seaSandColor;
varying vec3 vSeaP0;
varying float vSeaLift;
// Value noise and its gradient, baked into a tiling texture (one fetch instead of four hashes).
uniform sampler2D seaRipple;
vec3 seaNoiseD(vec2 p) {
  vec4 t = texture2D(seaRipple, p * (1.0 / ${RIPPLE.cells}.0));
  return vec3(t.b, (t.rg * 2.0 - 1.0) * ${RIPPLE.slope.toFixed(1)});
}
float seaNoise(vec2 p) { return texture2D(seaRipple, p * (1.0 / ${RIPPLE.cells}.0)).b; }
float seaGround(vec2 xz) {
  vec2 uv = (xz - seaBedBox.xy) / seaBedBox.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return seaFloor;
  return texture2D(seaBed, uv).r;
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float seaDepth = seaLevel + vSeaLift - seaGround(vSeaP0.xz);
// Little light comes back out of deep water: dark there, a lighter green-blue over sand in the shallows.
vec3 seaDeep = vec3(0.006, 0.03, 0.05);
vec3 seaShallow = vec3(0.03, 0.13, 0.12);
vec3 seaSand = seaSandColor;
vec3 seaCol = mix(seaShallow, seaDeep, smoothstep(0.4, 7.0, seaDepth));
seaCol = mix(seaSand, seaCol, smoothstep(0.0, 0.45, seaDepth));
// Foam: a thin broken line where the water meets the sand (washing up and back), and on the highest crests.
float seaN = seaNoise(vSeaP0.xz * 0.9 + seaTime * vec2(0.13, 0.07)) * 0.6 + seaNoise(vSeaP0.xz * 2.7 - seaTime * 0.2) * 0.4;
float seaWash = 0.12 + 0.1 * sin(seaTime * 0.9 + seaN * 3.0);
float seaShore = (1.0 - smoothstep(seaWash, seaWash + 0.25, seaDepth)) * smoothstep(0.42, 0.62, seaN);
float seaCrest = smoothstep(0.55, 0.95, vSeaLift / max(0.05, seaSwell * 0.5)) * smoothstep(0.4, 0.7, seaN);
float seaFoam = clamp(max(seaShore, seaCrest * 0.8), 0.0, 1.0);
diffuseColor.rgb = mix(seaCol, vec3(0.92, 0.94, 0.95), seaFoam);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.7, seaFoam);`,
        )
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
{
  // The surface's normal per pixel (all waves the pixel can show), in view space.
  vec2 seaSlope2;
  float seaPx = length(fwidth(vSeaP0.xz));
  seaDisplace(vSeaP0.xz, seaPx * 4.0, seaSlope2);
  // Ripples smaller than the shortest wave (wind on the water), drifting; gone where a pixel covers them.
  for (int o = 0; o < 3; o++) {
    float sc = 0.45 * pow(2.3, float(o));
    float fade = 1.0 - smoothstep(0.15 / sc, 1.2 / sc, seaPx);
    if (fade <= 0.0) break;
    vec2 q = vSeaP0.xz * sc + seaTime * vec2(0.31, 0.17) * (1.0 + float(o) * 0.6);
    seaSlope2 += seaNoiseD(q).yz * (0.22 / (1.0 + float(o))) * fade;
  }
  vec3 seaNrm = normalize(vec3(-seaSlope2.x, 1.0, -seaSlope2.y));
  normal = normalize((viewMatrix * vec4(seaNrm, 0.0)).xyz);
  if (!gl_FrontFacing) normal = -normal;
}`,
        );
    };
    material.customProgramCacheKey = () => `sea${MAX_WAVES}`;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = 'sea';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    // After the other opaque things, just before the ground: the sea is opaque,
    // so the bed under it is then rejected by the depth test before its
    // layered shading (Coral Reach: sea + terrain 1.66 -> 0.79 ms looking over
    // the fleet, 2.95 -> 2.0 at the island; Iris Xe 1152x648, 2026-10-19).
    this.mesh.renderOrder = 0.95;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Keeps the disc under the eye (snapped to 1 m so its vertices don't slide over the waves) and the waves at `time`. */
  update(eye: THREE.Vector3, time: number, scene: THREE.Scene): void {
    this.mesh.position.set(Math.round(eye.x), this.sea.level, Math.round(eye.z));
    this.mesh.updateMatrix();
    this.mesh.matrixWorld.copy(this.mesh.matrix);
    this.uniforms.seaTime!.value = time;
    const under = eye.y < this.sea.heightAt(eye.x, eye.z, time);
    if (under === this.under) return;
    this.under = under;
    const fog = scene.fog as THREE.FogExp2 | null;
    if (!fog) return;
    if (under) {
      this.savedFog = { color: fog.color.clone(), density: fog.density };
      fog.color.copy(UNDER.color);
      fog.density = UNDER.density;
    } else if (this.savedFog) {
      fog.color.copy(this.savedFog.color);
      fog.density = this.savedFog.density;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    (this.uniforms.seaBed!.value as THREE.Texture).dispose();
    (this.uniforms.seaRipple!.value as THREE.Texture).dispose();
  }
}

/** Rings round the centre: `near` evenly spaced, then growing to `radius`. */
function discGeometry(radius: number): THREE.BufferGeometry {
  const radii = [0];
  for (let i = 1; i <= RINGS.near; i++) radii.push(i * RINGS.nearStep);
  while (radii[radii.length - 1]! < radius) radii.push(radii[radii.length - 1]! * RINGS.grow);
  const n = RINGS.segments;
  const pos: number[] = [0, 0, 0];
  for (let r = 1; r < radii.length; r++) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      pos.push(Math.cos(a) * radii[r]!, 0, Math.sin(a) * radii[r]!);
    }
  }
  const idx: number[] = [];
  // Centre fan, then quads between rings (counter-clockwise from above: facing up).
  for (let k = 0; k < n; k++) idx.push(0, 1 + ((k + 1) % n), 1 + k);
  for (let r = 1; r < radii.length - 1; r++) {
    const a0 = 1 + (r - 1) * n;
    const b0 = 1 + r * n;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      idx.push(a0 + k, a0 + k1, b0 + k, a0 + k1, b0 + k1, b0 + k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  return geo;
}

/** The ground under the water (terrain surface) as a height texture over the terrain rectangle. */
function bedTexture(terrain: Terrain, sea: Sea): { texture: THREE.DataTexture; x0: number; z0: number; w: number; d: number } {
  const [sx, sz] = terrain.size;
  const cols = Math.ceil(sx / BED_TEXEL) + 1;
  const rows = Math.ceil(sz / BED_TEXEL) + 1;
  // Half floats: filterable on every WebGL2 device (full floats need an extension phones lack).
  const data = new Uint16Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = terrain.surfaceAt(-sx / 2 + (c / (cols - 1)) * sx, -sz / 2 + (r / (rows - 1)) * sz);
      data[r * cols + c] = THREE.DataUtils.toHalfFloat(Math.max(h, sea.floor));
    }
  }
  const texture = new THREE.DataTexture(data, cols, rows, THREE.RedFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { texture, x0: -sx / 2, z0: -sz / 2, w: sx, d: sz };
}

function toVec4s(a: Float32Array): THREE.Vector4[] {
  const out: THREE.Vector4[] = [];
  for (let i = 0; i < a.length; i += 4) out.push(new THREE.Vector4(a[i], a[i + 1], a[i + 2], a[i + 3]));
  return out;
}

/**
 * Tiling value noise (smoothstep-interpolated, period `RIPPLE.cells`) with its
 * gradient: r, g = d/dx, d/dz (scaled into 0..1 by `RIPPLE.slope`), b = value.
 * The same noise the shader used to hash per pixel, looked up instead.
 */
function rippleTexture(): THREE.DataTexture {
  const { cells, size, slope } = RIPPLE;
  const hash = (x: number, y: number) => {
    let h = ((x % cells) + cells) % cells;
    h = Math.imul(h * 374761393 + (((y % cells) + cells) % cells) * 668265263, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px / size) * cells;
      const y = (py / size) * cells;
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      const dux = 6 * fx * (1 - fx);
      const duy = 6 * fy * (1 - fy);
      const a = hash(ix, iy);
      const b = hash(ix + 1, iy);
      const c = hash(ix, iy + 1);
      const d = hash(ix + 1, iy + 1);
      const k = a - b - c + d;
      const v = a + (b - a) * ux + (c - a) * uy + k * ux * uy;
      const gx = dux * (b - a + k * uy);
      const gy = duy * (c - a + k * ux);
      const i = (py * size + px) * 4;
      data[i] = Math.round(THREE.MathUtils.clamp(gx / slope * 0.5 + 0.5, 0, 1) * 255);
      data[i + 1] = Math.round(THREE.MathUtils.clamp(gy / slope * 0.5 + 0.5, 0, 1) * 255);
      data[i + 2] = Math.round(v * 255);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
