import * as THREE from 'three';
import type { SurfaceMaterial } from '@/world/mapTypes';

interface SurfaceStyle {
  base: string;
  line: string;
  /** Grid cells per texture tile. */
  cells: number;
  noise: number;
  roughness: number;
  metalness: number;
}

const STYLES: Record<SurfaceMaterial, SurfaceStyle> = {
  ground: { base: '#6f6a5c', line: '#5d584b', cells: 4, noise: 0.18, roughness: 0.95, metalness: 0 },
  concrete: { base: '#9a9a96', line: '#83837f', cells: 2, noise: 0.1, roughness: 0.9, metalness: 0 },
  metal: { base: '#5c6670', line: '#4a525a', cells: 4, noise: 0.06, roughness: 0.55, metalness: 0.6 },
  wood: { base: '#8a6a47', line: '#6e5236', cells: 8, noise: 0.12, roughness: 0.8, metalness: 0 },
  brick: { base: '#8c4b3c', line: '#c9bca8', cells: 8, noise: 0.1, roughness: 0.9, metalness: 0 },
};

/** Meters covered by one texture tile. */
export const TILE_METERS = 4;

function drawSurface(style: SurfaceStyle, size = 256): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = style.base;
  g.fillRect(0, 0, size, size);

  // Speckle noise to avoid a flat, plastic look.
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 255 * style.noise;
    img.data[i] = img.data[i]! + n;
    img.data[i + 1] = img.data[i + 1]! + n;
    img.data[i + 2] = img.data[i + 2]! + n;
  }
  g.putImageData(img, 0, 0);

  g.strokeStyle = style.line;
  g.lineWidth = 2;
  const step = size / style.cells;
  for (let i = 0; i <= style.cells; i++) {
    g.beginPath();
    g.moveTo(i * step, 0);
    g.lineTo(i * step, size);
    g.moveTo(0, i * step);
    g.lineTo(size, i * step);
    g.stroke();
  }
  return c;
}

const cache = new Map<SurfaceMaterial, THREE.MeshStandardMaterial>();

export function surfaceMaterial(kind: SurfaceMaterial, maxAnisotropy: number): THREE.MeshStandardMaterial {
  const hit = cache.get(kind);
  if (hit) return hit;
  const style = STYLES[kind];
  const tex = new THREE.CanvasTexture(drawSurface(style));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: style.roughness,
    metalness: style.metalness,
  });
  cache.set(kind, mat);
  return mat;
}

/**
 * Rescales a BoxGeometry's UVs so textures tile in world meters instead of
 * stretching per face. Face order in three.js: +x, -x, +y, -y, +z, -z.
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
      uv.setXY(i, (uv.getX(i) * su) / TILE_METERS, (uv.getY(i) * sv) / TILE_METERS);
    }
  }
  uv.needsUpdate = true;
}
