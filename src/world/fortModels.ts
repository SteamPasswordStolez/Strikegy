import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceLibrary } from '@/render/textures';
import { buildKit, kitMaterials, type KitMaterial } from './modelKits';

/**
 * Procedural models for things built or used at zones during a match:
 * fortifications (sandbag wall, window barricade, anti-tank hedgehog) and the
 * supply stations (ammo, medical). Local space: y = 0 on the ground (the
 * barricade is centred on its window opening), long side along x, the front
 * (toward the enemy / out of the window) toward -z.
 */
export type FortModelKind = 'sandbag' | 'barricade' | 'hedgehog' | 'ammo' | 'medical';

type Mat = KitMaterial | 'olive' | 'white' | 'green' | 'yellow' | 'planks' | 'burlap';

interface Piece {
  geo: THREE.BufferGeometry;
  mat: Mat;
}

/** Full sizes (w, h, d) of the fixed-size models. */
export const FORT_SIZE = {
  sandbag: [2.6, 1.05, 0.75],
  hedgehog: [1.5, 1.1, 1.5],
  ammo: [1.9, 1.15, 1.2],
  medical: [2.0, 1.0, 1.3],
} as const;

const SANDBAG_COLOR = '#9c8f76';

export class FortModels {
  private readonly shared = kitMaterials();
  private readonly own: Record<'olive' | 'white' | 'green' | 'yellow' | 'planks' | 'burlap', THREE.Material>;
  /** Translucent "blueprint" look for empty build spots. */
  readonly ghostMaterial = new THREE.MeshBasicMaterial({ color: 0xbcd6ea, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false });

  constructor(private readonly surfaces: SurfaceLibrary | null) {
    const tint = (kind: 'wood' | 'metal', color: string, fallback: number) =>
      surfaces ? surfaces.tinted(kind, color) : new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.8 });
    // Painted boards: plain paint reads better than a tinted wood texture (which darkens it).
    this.own = {
      olive: new THREE.MeshStandardMaterial({ color: 0x3d4530, roughness: 0.85 }),
      burlap: new THREE.MeshStandardMaterial({ color: 0x6f6249, roughness: 1 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe4e1d6, roughness: 0.8 }),
      planks: tint('wood', '#8a6d4c', 0x8a6d4c),
      green: new THREE.MeshStandardMaterial({ color: 0x2f9a45, roughness: 0.6 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xc9a43a, roughness: 0.7 }),
    };
  }

  /** The model as merged meshes (one per material); `ghost` draws it all in the blueprint look. */
  build(kind: FortModelKind, size?: readonly [number, number, number], ghost = false): THREE.Group {
    const pieces = PIECES[kind](size);
    const group = new THREE.Group();
    const byMat = new Map<Mat, THREE.BufferGeometry[]>();
    for (const p of pieces) {
      const key: Mat = ghost ? 'body' : p.mat;
      let list = byMat.get(key);
      if (!list) byMat.set(key, (list = []));
      list.push(p.geo.index ? p.geo.toNonIndexed() : p.geo);
    }
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, ghost ? this.ghostMaterial : this.material(mat));
      mesh.castShadow = !ghost;
      mesh.receiveShadow = !ghost;
      group.add(mesh);
    }
    return group;
  }

  private material(m: Mat): THREE.Material {
    const s = this.surfaces;
    switch (m) {
      case 'olive':
      case 'white':
      case 'green':
      case 'yellow':
      case 'planks':
      case 'burlap':
        return this.own[m];
      case 'body':
        return s ? s.tinted('ground', SANDBAG_COLOR) : new THREE.MeshStandardMaterial({ color: SANDBAG_COLOR });
      case 'trim':
      case 'metal':
        return s ? s.get('metal') : new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6 });
      case 'wood':
        return s ? s.get('wood') : new THREE.MeshStandardMaterial({ color: 0x7a5a3a });
      case 'concrete':
        return s ? s.get('concrete') : new THREE.MeshStandardMaterial({ color: 0x999999 });
      case 'dirt':
        return s ? s.tinted('ground', '#9c8a64') : new THREE.MeshStandardMaterial({ color: 0x9c8a64 });
      default:
        return this.shared[m];
    }
  }
}

const box = (mat: Mat, [w, h, d]: [number, number, number], [x, y, z]: [number, number, number], rot: [number, number, number] = [0, 0, 0]): Piece => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)));
  return { geo: g, mat };
};

const cyl = (mat: Mat, r: number, len: number, at: [number, number, number], rot: [number, number, number], seg = 10): Piece => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)));
  return { geo: g, mat };
};

/** A wooden crate with corner battens and rim boards, standing on (x, y, z). */
function crate(out: Piece[], mat: Mat, [w, h, d]: [number, number, number], [x, y, z]: [number, number, number], yaw = 0): void {
  const q = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
  const add = (p: Piece) => {
    p.geo.applyMatrix4(q);
    out.push(p);
  };
  add(box(mat, [w, h, d], [0, h / 2, 0]));
  // Battens round the edges stand proud of the boards.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(box('wood', [0.06, h + 0.01, 0.06], [sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02)]));
  add(box('wood', [w + 0.02, 0.05, d + 0.02], [0, 0.03, 0]));
  add(box('wood', [w + 0.02, 0.05, d + 0.02], [0, h - 0.03, 0]));
}

/** A green cross on a face at (x, y, z) facing +z after turning by yaw. */
function cross(out: Piece[], x: number, y: number, z: number, yaw: number): void {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
  for (const p of [box('green', [0.24, 0.07, 0.01], [0, 0, 0]), box('green', [0.07, 0.24, 0.01], [0, 0, 0])]) {
    p.geo.applyMatrix4(m);
    out.push(p);
  }
}

const PIECES: Record<FortModelKind, (size?: readonly [number, number, number]) => Piece[]> = {
  sandbag() {
    const [w, h, d] = FORT_SIZE.sandbag;
    let state = 7;
    const rand = () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646;
    // The kit's own surface ('body') becomes plain burlap here.
    return buildKit('sandbags', w, h, d, rand).pieces.map((p) => ({ geo: p.geo, mat: p.mat === 'body' ? 'burlap' : p.mat }));
  },

  barricade(size) {
    // Planks nailed across a window, leaving a slit to shoot through (size = [w, h, slit centre above the sill]).
    const [w, h, slitAt] = size ?? [1.2, 1.2, 0.5];
    const out: Piece[] = [];
    const pw = w + 0.24;
    const slit = 0.26;
    const plank = 0.16;
    const slitLo = -h / 2 + slitAt - slit / 2;
    const slitHi = slitLo + slit;
    let y = -h / 2 - 0.04;
    let i = 0;
    while (y < h / 2) {
      const top = Math.min(h / 2 + 0.06, y + plank);
      if (!(top > slitLo && y < slitHi)) {
        const tilt = ((i * 37) % 7) * 0.012 - 0.036;
        out.push(box('planks', [pw, top - y - 0.02, 0.05], [((i * 13) % 5) * 0.02 - 0.04, (y + top) / 2, 0], [0, 0, tilt]));
        y = top;
      } else {
        y = slitHi;
      }
      i++;
    }
    // Two uprights holding the boards, on the inside.
    for (const sx of [-1, 1]) out.push(box('wood', [0.09, h + 0.1, 0.07], [sx * (w / 2 - 0.12), 0, 0.06]));
    return out;
  },

  hedgehog() {
    // Three steel beams crossed through the middle (a Czech hedgehog).
    // Three mutually square beams, turned so it stands on three ends (the body diagonal points up).
    const h = FORT_SIZE.hedgehog[1];
    const out: Piece[] = [];
    const len = h * Math.sqrt(3);
    const c = new THREE.Vector3(0, h / 2, 0);
    const up = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(0, 1, 0));
    const Y = new THREE.Vector3(0, 1, 0);
    for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
      const q = up.clone().multiply(new THREE.Quaternion().setFromUnitVectors(Y, axis));
      const m = new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1));
      // An angle iron: two flanges.
      for (const p of [box('dark', [0.1, len, 0.014], [0, 0, 0]), box('dark', [0.014, len, 0.1], [0.043, 0, 0.043])]) {
        p.geo.applyMatrix4(m);
        out.push(p);
      }
    }
    out.push(box('dark', [0.2, 0.2, 0.2], [c.x, c.y, c.z], [0.4, 0.5, 0.3]));
    return out;
  },

  ammo() {
    // Pallet with stacked olive ammo crates and an open crate of ammo cans.
    const out: Piece[] = [];
    const [w, , d] = FORT_SIZE.ammo;
    for (const z of [-d / 2 + 0.08, 0, d / 2 - 0.08]) out.push(box('wood', [w, 0.1, 0.1], [0, 0.05, z]));
    out.push(box('wood', [w, 0.03, d], [0, 0.115, 0]));
    const top = 0.13;
    crate(out, 'olive', [0.9, 0.42, 0.55], [-0.45, top, -0.27]);
    crate(out, 'olive', [0.9, 0.42, 0.55], [-0.45, top, 0.3]);
    crate(out, 'olive', [0.85, 0.4, 0.52], [-0.42, top + 0.42, 0.02], 0.08);
    out.push(box('yellow', [0.87, 0.06, 0.54], [-0.42, top + 0.62, 0.02], [0, 0.08, 0]));
    crate(out, 'olive', [0.85, 0.3, 0.9], [0.5, top, 0]);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        const x = 0.26 + i * 0.24;
        const z = -0.2 + j * 0.4;
        out.push(box('dark', [0.1, 0.24, 0.26], [x, top + 0.38, z]));
        out.push(box('metal', [0.03, 0.02, 0.14], [x, top + 0.51, z]));
      }
    }
    return out;
  },

  medical() {
    // White medical chests with green crosses and a stretcher in front.
    const out: Piece[] = [];
    crate(out, 'white', [0.8, 0.5, 0.5], [-0.5, 0, -0.3]);
    crate(out, 'white', [0.8, 0.5, 0.5], [-0.45, 0.5, -0.28], 0.1);
    crate(out, 'white', [0.7, 0.4, 0.55], [0.35, 0, -0.32], -0.15);
    // Crosses on the front faces (+z), just proud of the boards.
    cross(out, -0.5, 0.25, -0.3 + 0.256, 0);
    cross(out, -0.45 + Math.sin(0.1) * 0.256, 0.75, -0.28 + Math.cos(0.1) * 0.256, 0.1);
    cross(out, 0.35 + Math.sin(-0.15) * 0.281, 0.2, -0.32 + Math.cos(-0.15) * 0.281, -0.15);
    // Stretcher: two poles and canvas, with a kit bag on it.
    for (const z of [0.12, 0.58]) out.push(cyl('wood', 0.025, 2.0, [0.1, 0.06, z], [0, 0, Math.PI / 2]));
    out.push(box('canvas', [1.7, 0.02, 0.46], [0.1, 0.07, 0.35]));
    out.push(box('canvas', [0.45, 0.22, 0.28], [0.55, 0.19, 0.36], [0, 0.3, 0]));
    cross(out, 0.55 + Math.sin(0.3) * 0.141, 0.19, 0.36 + Math.cos(0.3) * 0.141, 0.3);
    return out;
  },
};

/** Icon drawn over a station (cartridges or a cross). */
export function stationIcon(kind: 'ammo' | 'medical'): THREE.SpriteMaterial {
  // No DOM (tests): a plain marker.
  if (typeof document === 'undefined') return new THREE.SpriteMaterial({ color: kind === 'ammo' ? 0xe0c060 : 0x6bdc6b });
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(12,16,20,0.72)';
  g.beginPath();
  g.arc(32, 32, 29, 0, Math.PI * 2);
  g.fill();
  const color = kind === 'ammo' ? '#e0c060' : '#6bdc6b';
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 3;
  g.stroke();
  if (kind === 'medical') {
    g.fillRect(26, 14, 12, 36);
    g.fillRect(14, 26, 36, 12);
  } else {
    for (const x of [17, 29, 41]) {
      g.beginPath();
      g.moveTo(x - 3, 46);
      g.lineTo(x - 3, 27);
      g.quadraticCurveTo(x, 14, x + 3, 27);
      g.lineTo(x + 3, 46);
      g.closePath();
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: tex, depthWrite: false, sizeAttenuation: false, toneMapped: false, transparent: true });
}
