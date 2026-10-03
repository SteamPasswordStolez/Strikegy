import type { SurfaceMaterial } from '@/world/mapTypes';
import {
  TileNoise,
  clamp01,
  fract,
  hash01,
  hexToRgb,
  lerp,
  mixRgb,
  smoothstep,
  type RGB,
} from './noise';

/** One texel of a PBR surface. Colors are sRGB in [0, 1]. */
export interface Texel {
  color: RGB;
  /** 0 (deep) .. 1 (raised); converted to a normal map. */
  height: number;
  rough: number;
  metal: number;
  ao: number;
}

export interface SurfaceRecipe {
  /** World meters covered by one texture tile. */
  tileMeters: number;
  /** Normal map strength (height delta per texel, relative to a 512px texture). */
  normalStrength: number;
  paint(u: number, v: number, out: Texel): void;
}

function distToNearestLine(x: number, step: number): number {
  const t = x / step;
  return Math.abs(t - Math.round(t)) * step;
}

function groundRecipe(n: TileNoise): SurfaceRecipe {
  const soilDark = hexToRgb(0x4e4231);
  const soilLight = hexToRgb(0x857457);
  const pebble = hexToRgb(0x57534b);
  return {
    tileMeters: 4,
    normalStrength: 5,
    paint(u, v, o) {
      const base = n.fbm(u, v, 4, 4);
      const detail = n.fbm(u, v, 32, 3);
      const peb = smoothstep(0.66, 0.74, n.fbm(u + 0.37, v + 0.11, 128, 2));
      const damp = smoothstep(0.55, 0.72, n.fbm(u + 0.5, v + 0.25, 2, 3));
      let c = mixRgb(soilDark, soilLight, clamp01(base * 1.3 - 0.15));
      const k = (0.82 + 0.34 * detail) * (1 - 0.16 * damp);
      c = [c[0] * k, c[1] * k, c[2] * k];
      c = mixRgb(c, [pebble[0] * (0.7 + 0.5 * detail), pebble[1] * (0.7 + 0.5 * detail), pebble[2] * (0.7 + 0.5 * detail)], peb * 0.6);
      o.color = c;
      o.height = 0.45 * detail + 0.45 * peb + 0.1 * base;
      o.rough = 0.97 - 0.08 * peb - 0.1 * damp;
      o.metal = 0;
      o.ao = 0.75 + 0.25 * clamp01(o.height * 1.4);
    },
  };
}

function concreteRecipe(n: TileNoise): SurfaceRecipe {
  const grey = hexToRgb(0x85837c);
  const stainCol = hexToRgb(0x5d5548);
  const holes: [number, number][] = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ];
  return {
    tileMeters: 4,
    normalStrength: 3,
    paint(u, v, o) {
      const low = n.fbm(u, v, 4, 5);
      const speck = n.sample(u, v, 256);
      const pores = smoothstep(0.78, 0.85, n.sample(u + 0.5, v, 128));
      const stain = smoothstep(0.55, 0.78, n.fbm(u + 0.3, v + 0.7, 3, 4));
      const streak = smoothstep(0.6, 0.9, n.sampleXY(u, v, 24, 2)) * 0.5;
      const seamDist = Math.min(distToNearestLine(v, 0.5), distToNearestLine(u, 1));
      const seam = 1 - smoothstep(0.0015, 0.004, seamDist);
      let hole = 0;
      for (const [hx, hy] of holes) {
        const d = Math.hypot(u - hx, v - hy);
        hole = Math.max(hole, 1 - smoothstep(0.006, 0.009, d));
      }
      const k = (0.86 + 0.22 * low + 0.07 * (speck - 0.5)) * (1 - 0.35 * seam - 0.55 * hole - 0.25 * pores);
      let c: RGB = [grey[0] * k, grey[1] * k, grey[2] * k];
      c = mixRgb(c, stainCol, clamp01(stain * 0.35 + streak * 0.25));
      o.color = c;
      o.height = 0.6 + 0.1 * low + 0.05 * speck - 0.3 * seam - 0.5 * hole - 0.15 * pores;
      o.rough = 0.9 - 0.12 * stain;
      o.metal = 0;
      o.ao = 1 - 0.45 * seam - 0.6 * hole;
    },
  };
}

function metalRecipe(n: TileNoise, paintHex: number): SurfaceRecipe {
  const paint = hexToRgb(paintHex);
  const bare = hexToRgb(0x7d8084);
  const grime = hexToRgb(0x2e2a24);
  return {
    tileMeters: 2,
    normalStrength: 4,
    paint(u, v, o) {
      const seamDist = Math.min(distToNearestLine(u, 0.5), distToNearestLine(v, 0.5));
      const seam = 1 - smoothstep(0.002, 0.005, seamDist);
      // Rivets run along both seam directions, just inside each plate edge.
      let rivet = 0;
      const rivetStep = 1 / 16;
      const du = distToNearestLine(u, 0.5);
      const dv = distToNearestLine(v, 0.5);
      if (Math.abs(du - 0.02) < 0.012) {
        const d = Math.hypot(du - 0.02, distToNearestLine(v + rivetStep / 2, rivetStep));
        rivet = Math.max(rivet, 1 - smoothstep(0.004, 0.007, d));
      }
      if (Math.abs(dv - 0.02) < 0.012) {
        const d = Math.hypot(dv - 0.02, distToNearestLine(u + rivetStep / 2, rivetStep));
        rivet = Math.max(rivet, 1 - smoothstep(0.004, 0.007, d));
      }
      const nearSeam = 1 - smoothstep(0.0, 0.05, seamDist);
      const wearNoise = n.fbm(u, v, 32, 4);
      const chip = smoothstep(0.74, 0.77, wearNoise + nearSeam * 0.12);
      const brushed = n.sampleXY(u, v, 4, 256);
      const dirt = smoothstep(0.45, 0.8, n.fbm(u + 0.2, v + 0.6, 4, 4)) * 0.5 + nearSeam * 0.35;

      const pk = 0.9 + 0.12 * n.fbm(u, v, 8, 3);
      let c: RGB = [paint[0] * pk, paint[1] * pk, paint[2] * pk];
      c = mixRgb(c, grime, clamp01(dirt) * 0.6);
      const bk = 0.85 + 0.25 * brushed;
      c = mixRgb(c, [bare[0] * bk, bare[1] * bk, bare[2] * bk], chip);
      c = mixRgb(c, grime, seam * 0.8);
      o.color = c;
      o.height = 0.6 - 0.45 * seam + 0.35 * rivet - 0.06 * chip;
      o.rough = lerp(0.6 + 0.25 * dirt, 0.42 + 0.1 * brushed, chip);
      o.metal = lerp(0.15, 1, chip);
      o.ao = 1 - 0.5 * seam - 0.2 * dirt;
    },
  };
}

function woodRecipe(n: TileNoise): SurfaceRecipe {
  const dark = hexToRgb(0x5b3f26);
  const light = hexToRgb(0xa47a4f);
  const planks = 8;
  return {
    tileMeters: 2,
    normalStrength: 3,
    paint(u, v, o) {
      const row = Math.floor(v * planks);
      const pv = fract(v * planks);
      const r = hash01(row + 17);
      const joint = fract(u - r);
      const jointDist = Math.min(joint, 1 - joint);
      const gap = Math.max(1 - smoothstep(0.02, 0.05, Math.min(pv, 1 - pv)), 1 - smoothstep(0.001, 0.003, jointDist));
      const grain = n.fbm(fract(u + r), v, 2, 3) * 0.6 + n.sampleXY(u, v, 2, 256) * 0.4;
      const rings = Math.sin((grain * 18 + pv * 2 + r * 6) * Math.PI);
      const t = clamp01(0.5 + 0.25 * rings + (r - 0.5) * 0.5);
      const fine = n.sampleXY(u, v, 8, 256);
      const k = (0.85 + 0.2 * fine) * (1 - 0.7 * gap);
      const c = mixRgb(dark, light, t);
      o.color = [c[0] * k, c[1] * k, c[2] * k];
      o.height = 0.6 + 0.06 * rings + 0.04 * fine - 0.55 * gap;
      o.rough = 0.72 + 0.1 * fine;
      o.metal = 0;
      o.ao = 1 - 0.55 * gap;
    },
  };
}

function brickRecipe(n: TileNoise): SurfaceRecipe {
  const brickA = hexToRgb(0x7c3727);
  const brickB = hexToRgb(0xa4583c);
  const mortar = hexToRgb(0xb3ab9c);
  const rows = 16;
  const perRow = 8;
  return {
    tileMeters: 2,
    normalStrength: 6,
    paint(u, v, o) {
      const row = Math.floor(v * rows);
      const pv = fract(v * rows);
      const off = row % 2 === 1 ? 0.5 : 0;
      const bu = u * perRow + off;
      const col = ((Math.floor(bu) % perRow) + perRow) % perRow;
      const pu = fract(bu);
      // Distance to the brick edge in meters (tile = 2 m -> brick 0.25 x 0.125 m).
      const dist = Math.min(Math.min(pu, 1 - pu) * 0.25, Math.min(pv, 1 - pv) * 0.125);
      const chip = n.fbm(u, v, 32, 3) * 0.008;
      const brick = smoothstep(0.004, 0.008, dist - chip + 0.002);
      const rnd = hash01(row * 131 + col);
      const surf = n.fbm(u, v, 64, 2);
      const soot = smoothstep(0.55, 0.85, n.fbm(u + 0.4, v, 1, 5)) * 0.18;
      const bk = (0.82 + 0.3 * surf) * (1 - soot);
      const bc = mixRgb(brickA, brickB, rnd);
      const mk = 0.85 + 0.25 * n.sample(u, v, 128);
      o.color = mixRgb([mortar[0] * mk, mortar[1] * mk, mortar[2] * mk], [bc[0] * bk, bc[1] * bk, bc[2] * bk], brick);
      o.height = 0.25 + 0.55 * brick + 0.08 * surf;
      o.rough = 0.88 + 0.08 * (1 - brick);
      o.metal = 0;
      o.ao = 0.65 + 0.35 * brick;
    },
  };
}

export function createRecipe(kind: SurfaceMaterial, seed = 1): SurfaceRecipe {
  const n = new TileNoise(seed * 7919 + kind.length * 104729);
  switch (kind) {
    case 'ground':
      return groundRecipe(n);
    case 'concrete':
    case 'concrete_floor':
      return concreteRecipe(n);
    case 'metal':
      return metalRecipe(n, 0x4b5240);
    case 'wood':
      return woodRecipe(n);
    case 'brick':
      return brickRecipe(n);
    case 'snow':
      return snowRecipe(n);
    case 'grass':
      return grassRecipe(n);
    case 'sand':
      return sandRecipe(n);
  }
}

/** Summer meadow: blades in two greens, dry straw patches and bare soil showing through. */
function grassRecipe(n: TileNoise): SurfaceRecipe {
  const deep = hexToRgb(0x3f5326);
  const fresh = hexToRgb(0x6d8238);
  const straw = hexToRgb(0x9a8c55);
  const soil = hexToRgb(0x5a4a33);
  return {
    tileMeters: 3,
    normalStrength: 4,
    paint(u, v, o) {
      const base = n.fbm(u, v, 3, 4);
      // Blades: fine streaks, stretched along v.
      const blades = n.fbm(u * 3, v, 96, 2);
      const dry = smoothstep(0.55, 0.75, n.fbm(u + 0.31, v + 0.77, 5, 3));
      const bare = smoothstep(0.7, 0.8, n.fbm(u + 0.9, v + 0.4, 12, 2));
      let c = mixRgb(deep, fresh, clamp01(base * 1.2 + (blades - 0.5) * 0.9));
      c = mixRgb(c, straw, dry * 0.45);
      c = mixRgb(c, soil, bare * 0.25);
      o.color = c;
      o.height = 0.6 * blades + 0.3 * base - 0.3 * bare;
      o.rough = 0.95;
      o.metal = 0;
      o.ao = 0.7 + 0.3 * clamp01(blades * 1.3);
    },
  };
}

/** Desert sand: wind ripples, darker gravel patches. */
function sandRecipe(n: TileNoise): SurfaceRecipe {
  const light = hexToRgb(0xb99a6a);
  const warm = hexToRgb(0x9a784e);
  const gravel = hexToRgb(0x8f7b62);
  return {
    tileMeters: 4,
    normalStrength: 3,
    paint(u, v, o) {
      const base = n.fbm(u, v, 3, 4);
      const warp = n.fbm(u + 0.2, v + 0.6, 6, 2);
      // Ripples: bands across u, bent by the noise.
      const ripple = 0.5 + 0.5 * Math.sin((u * 26 + warp * 3.5) * Math.PI * 2);
      const grit = n.fbm(u, v, 128, 2);
      const stones = smoothstep(0.64, 0.74, n.fbm(u + 0.45, v + 0.13, 20, 3));
      let c = mixRgb(warm, light, clamp01(base * 1.2 - 0.1 + ripple * 0.12));
      const k = 0.9 + 0.2 * grit;
      c = [c[0] * k, c[1] * k, c[2] * k];
      c = mixRgb(c, gravel, stones * 0.55);
      o.color = c;
      o.height = 0.35 * ripple + 0.2 * base + 0.35 * stones + 0.1 * grit;
      o.rough = 0.93;
      o.metal = 0;
      o.ao = 0.85 + 0.15 * clamp01(o.height * 1.4);
    },
  };
}

/** Wind-packed snow: soft drifts, footprint dimples and a faint blue in the hollows. */
function snowRecipe(n: TileNoise): SurfaceRecipe {
  const white = hexToRgb(0xf2f4f6);
  const shade = hexToRgb(0xc9d3de);
  return {
    tileMeters: 4,
    normalStrength: 2.5,
    paint(u, v, o) {
      const drift = n.fbm(u, v, 3, 4);
      const detail = n.fbm(u, v, 48, 3);
      const dimple = smoothstep(0.62, 0.72, n.fbm(u + 0.21, v + 0.63, 24, 2));
      const h = 0.6 * drift + 0.3 * detail - 0.25 * dimple;
      o.color = mixRgb(shade, white, clamp01(0.35 + h));
      o.height = clamp01(h);
      o.rough = 0.82 + 0.1 * detail;
      o.metal = 0;
      o.ao = 0.88 + 0.12 * clamp01(h * 1.5);
    },
  };
}

export interface SurfaceImages {
  size: number;
  /** RGBA8 sRGB albedo. */
  albedo: Uint8Array;
  /** RGBA8 tangent-space normal (OpenGL convention, +Y = +V). */
  normal: Uint8Array;
  /** RGBA8: R = ambient occlusion, G = roughness, B = metalness. */
  orm: Uint8Array;
}

/** Rasterizes a recipe into tileable texture data. Row 0 is v = 0 (no flipY). */
export function rasterize(recipe: SurfaceRecipe, size: number): SurfaceImages {
  const albedo = new Uint8Array(size * size * 4);
  const orm = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const t: Texel = { color: [0, 0, 0], height: 0, rough: 1, metal: 0, ao: 1 };

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      recipe.paint(u, v, t);
      const i = y * size + x;
      const p = i * 4;
      albedo[p] = clamp01(t.color[0]) * 255;
      albedo[p + 1] = clamp01(t.color[1]) * 255;
      albedo[p + 2] = clamp01(t.color[2]) * 255;
      albedo[p + 3] = 255;
      orm[p] = clamp01(t.ao) * 255;
      orm[p + 1] = clamp01(t.rough) * 255;
      orm[p + 2] = clamp01(t.metal) * 255;
      orm[p + 3] = 255;
      height[i] = t.height;
    }
  }

  // Central differences with wrap-around so the normal map tiles too.
  const k = recipe.normalStrength * (size / 512);
  for (let y = 0; y < size; y++) {
    const yu = ((y + 1) % size) * size;
    const yd = ((y - 1 + size) % size) * size;
    for (let x = 0; x < size; x++) {
      const xr = (x + 1) % size;
      const xl = (x - 1 + size) % size;
      const dhdu = (height[y * size + xr]! - height[y * size + xl]!) * 0.5 * k;
      const dhdv = (height[yu + x]! - height[yd + x]!) * 0.5 * k;
      const len = Math.hypot(dhdu, dhdv, 1);
      const p = (y * size + x) * 4;
      normal[p] = ((-dhdu / len) * 0.5 + 0.5) * 255;
      normal[p + 1] = ((-dhdv / len) * 0.5 + 0.5) * 255;
      normal[p + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      normal[p + 3] = 255;
    }
  }
  return { size, albedo, normal, orm };
}
