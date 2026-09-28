import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TileNoise, clamp01 } from '@/render/noise';

/**
 * Building blocks for procedural first-person guns.
 *
 * Coordinates are in meters in a side-view frame: `u` runs forward along the
 * bore (gun -Z), `v` is up (+Y) and `x` is to the right. The trigger sits near
 * u = 0 and the top of the receiver near v = 0.03.
 */
export type P = [u: number, v: number];

// ---------------------------------------------------------------------------
// Surface textures (small, tiling, generated once)

const TEX = 128;

function dataTexture(data: Uint8Array, srgb: boolean, repeat: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Tangent-space normal map from a tiling height function on [0, 1)^2. */
function normalMap(height: (u: number, v: number) => number, strength: number, repeat: number): THREE.DataTexture {
  const h = new Float32Array(TEX * TEX);
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) h[y * TEX + x] = height(x / TEX, y / TEX);
  const data = new Uint8Array(TEX * TEX * 4);
  const at = (x: number, y: number) => h[((y + TEX) % TEX) * TEX + ((x + TEX) % TEX)]!;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * TEX + x) * 4;
      data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, false, repeat);
}

/** Grayscale roughness variation (stored in G, which three reads for roughness). */
function roughnessMap(value: (u: number, v: number) => number, repeat: number): THREE.DataTexture {
  const data = new Uint8Array(TEX * TEX * 4);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const g = clamp01(value(x / TEX, y / TEX)) * 255;
      const i = (y * TEX + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, false, repeat);
}

function woodAlbedo(repeat: number): THREE.DataTexture {
  const n = new TileNoise(41);
  const data = new Uint8Array(TEX * TEX * 4);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const u = x / TEX;
      const v = y / TEX;
      // Long grain along u with slow waviness, plus darker late-wood lines.
      const warp = n.sample(u, v, 4) * 0.15;
      const lines = Math.sin((v + warp) * Math.PI * 2 * 18) * 0.5 + 0.5;
      const streak = n.sampleXY(u, v, 2, 64);
      const t = 0.55 + 0.25 * streak - 0.3 * Math.pow(lines, 6);
      const i = (y * TEX + x) * 4;
      data[i] = 120 * t + 20;
      data[i + 1] = 72 * t + 12;
      data[i + 2] = 40 * t + 6;
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, true, repeat);
}

function makeMaterials() {
  const n = new TileNoise(17);
  // Fine speckle (bead-blasted / parkerized finish) and a few faint wear streaks.
  const metalRough = roughnessMap((u, v) => 0.42 + (n.sample(u, v, 64) - 0.5) * 0.18 + (n.sampleXY(u, v, 2, 48) - 0.5) * 0.1, 8);
  const metalNormal = normalMap((u, v) => n.sample(u, v, 64), 0.6, 8);
  // Polymer: stippled texture on grips and furniture.
  const stipple = normalMap((u, v) => n.sample(u, v, 32) * 0.6 + n.sample(u + 0.5, v, 64) * 0.4, 1.4, 10);
  const polyRough = roughnessMap((u, v) => 0.68 + (n.sample(u, v, 16) - 0.5) * 0.12, 6);

  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  return {
    /** Blued / parkerized steel: barrels, bolts, small parts. */
    steel: std({ color: 0x323437, metalness: 0.75, roughness: 1, roughnessMap: metalRough, normalMap: metalNormal, normalScale: new THREE.Vector2(0.12, 0.12) }),
    /** Anodized aluminium receivers. */
    alloy: std({ color: 0x26282b, metalness: 0.55, roughness: 1, roughnessMap: metalRough, normalMap: metalNormal, normalScale: new THREE.Vector2(0.08, 0.08) }),
    /** Near-black details: slots, ports, rail teeth, sights. */
    dark: std({ color: 0x0e0f10, metalness: 0.4, roughness: 0.6 }),
    /** Inside of open tubes (optic bodies), seen from within. */
    darkInner: std({ color: 0x0a0a0b, metalness: 0.2, roughness: 0.8, side: THREE.BackSide }),
    polymer: std({ color: 0x1b1c1e, metalness: 0, roughness: 1, roughnessMap: polyRough, normalMap: stipple, normalScale: new THREE.Vector2(0.2, 0.2) }),
    rubber: std({ color: 0x151515, metalness: 0, roughness: 0.9, normalMap: stipple, normalScale: new THREE.Vector2(0.3, 0.3) }),
    wood: std({ map: woodAlbedo(4), metalness: 0, roughness: 0.55, normalMap: metalNormal, normalScale: new THREE.Vector2(0.1, 0.1) }),
    brass: std({ color: 0xb08a3e, metalness: 1, roughness: 0.3 }),
    /** Bullet tips. */
    copper: std({ color: 0xb4643c, metalness: 1, roughness: 0.35 }),
    /** Shotgun shell hulls. */
    shellHull: std({ color: 0x9c2a22, metalness: 0, roughness: 0.55 }),
    /** Weapon light lens (faintly lit). */
    lightLens: std({ color: 0xdfe6f0, metalness: 0.2, roughness: 0.1, emissive: 0x2a3038 }),
    glass: std({ color: 0x8fb5d0, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false }),
    /** Lens seen from the outside (scope front/back). */
    lens: std({ color: 0x0b1a2a, metalness: 1, roughness: 0.05, emissive: 0x06121e }),
    reticle: new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }),
    glove: std({ color: 0x2e2a25, metalness: 0, roughness: 0.78, normalMap: stipple, normalScale: new THREE.Vector2(0.15, 0.15) }),
    sleeve: std({ color: 0x3a4030, metalness: 0, roughness: 0.95, normalMap: stipple, normalScale: new THREE.Vector2(0.2, 0.2) }),
    polymerTex: { roughnessMap: polyRough, normalMap: stipple },
  };
}

let materials: ReturnType<typeof makeMaterials> | null = null;
/** Shared gun materials (created on first use so textures are generated once). */
export function gunMaterials(): ReturnType<typeof makeMaterials> {
  materials ??= makeMaterials();
  return materials;
}

const coloredPolymer = new Map<number, THREE.MeshStandardMaterial>();
/** Polymer furniture in a given color (cached: new materials would force shader compiles). */
export function furniture(color: number): THREE.MeshStandardMaterial {
  let m = coloredPolymer.get(color);
  if (!m) {
    const tex = gunMaterials().polymerTex;
    m = new THREE.MeshStandardMaterial({
      color,
      metalness: 0,
      roughness: 1,
      roughnessMap: tex.roughnessMap,
      normalMap: tex.normalMap,
      normalScale: new THREE.Vector2(0.2, 0.2),
    });
    coloredPolymer.set(color, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Geometry primitives (all return geometry already placed in gun space)

const TO_GUN = new THREE.Matrix4().makeRotationY(Math.PI / 2); // shape (x, y, z) -> gun (z, y, -x)

/**
 * Side profile extruded across the gun's width, with beveled edges.
 * `pts` is the outline in (u, v); `holes` are cut-outs (trigger guards, thumbholes).
 */
export function slab(pts: P[], width: number, x = 0, bevel = 0.0015, holes: P[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
  const b = Math.min(bevel, width * 0.3);
  const depth = Math.max(0.0005, width - 2 * b);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.translate(0, 0, -depth / 2);
  geo.applyMatrix4(TO_GUN);
  geo.translate(x, 0, 0);
  return geo;
}

/** Axis-aligned block from u0..u1, v0..v1, centered on x. */
export function block(u0: number, u1: number, v0: number, v1: number, width: number, x = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(width, v1 - v0, u1 - u0);
  g.translate(x, (v0 + v1) / 2, -(u0 + u1) / 2);
  return g;
}

/** Rounded rectangle outline for `slab`. */
export function roundRect(u0: number, v0: number, u1: number, v1: number, r: number, seg = 3): P[] {
  const pts: P[] = [];
  const corner = (cu: number, cv: number, a0: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r]);
    }
  };
  corner(u1 - r, v0 + r, -Math.PI / 2);
  corner(u1 - r, v1 - r, 0);
  corner(u0 + r, v1 - r, Math.PI / 2);
  corner(u0 + r, v0 + r, Math.PI);
  return pts;
}

/** Cylinder along the bore from u0 to u1 at height v. */
export function tube(r: number, u0: number, u1: number, v: number, x = 0, seg = 16, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, u1 - u0, seg, 1, open);
  g.rotateX(-Math.PI / 2); // +Y -> -Z (forward)
  g.translate(x, v, -(u0 + u1) / 2);
  return g;
}

/** Cylinder across the gun (along x), e.g. pins and buttons: centered at (u, v, x). */
export function xcyl(r: number, len: number, u: number, v: number, x = 0, seg = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  g.translate(x, v, -u);
  return g;
}

/** Upright cylinder (along v) from v0 down/up to v1 at (u, x). */
export function vcyl(r0: number, r1: number, u: number, v0: number, v1: number, x = 0, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, Math.abs(v1 - v0), seg);
  g.translate(x, (v0 + v1) / 2, -u);
  return g;
}

/** Ring in the u-v plane (sling loops, swivels) centered at (u, v, x). */
export function loop(r: number, tube: number, u: number, v: number, x = 0): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, tube, 6, 14);
  g.rotateY(Math.PI / 2);
  g.translate(x, v, -u);
  return g;
}

/** Turned part: `profile` is (radius, u offset) pairs, revolved around the bore axis starting at u0. */
export function lathe(profile: [r: number, du: number][], u0: number, v: number, x = 0, seg = 20): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    profile.map(([r, du]) => new THREE.Vector2(r, du)),
    seg,
  );
  g.rotateX(-Math.PI / 2);
  g.translate(x, v, -u0);
  return g;
}

/** Picatinny rail with its cross slots, sitting on vBase. Returns [geometries, top height]. */
export function rail(u0: number, u1: number, vBase: number, x = 0): [THREE.BufferGeometry[], number] {
  const out = [block(u0, u1, vBase, vBase + 0.004, 0.016, x), block(u0, u1, vBase + 0.004, vBase + 0.0065, 0.021, x)];
  for (let u = u0 + 0.004; u < u1 - 0.004; u += 0.01) out.push(block(u, u + 0.0052, vBase + 0.0065, vBase + 0.0095, 0.021, x));
  return [out, vBase + 0.0095];
}

// ---------------------------------------------------------------------------

/**
 * Replaces UVs with a per-face box projection in meters, so every part shares
 * the same texel density no matter which primitive produced it.
 */
function boxProjectUVs(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 3) {
    // Project a whole triangle with its face's dominant axis to avoid seams inside it.
    const nx = Math.abs(nor.getX(i) + nor.getX(i + 1) + nor.getX(i + 2));
    const ny = Math.abs(nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2));
    const nz = Math.abs(nor.getZ(i) + nor.getZ(i + 1) + nor.getZ(i + 2));
    for (let k = i; k < i + 3; k++) {
      const x = pos.getX(k);
      const y = pos.getY(k);
      const z = pos.getZ(k);
      const [a, b] = nx >= ny && nx >= nz ? [z, y] : ny >= nz ? [x, z] : [x, y];
      uv[k * 2] = a;
      uv[k * 2 + 1] = b;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Picatinny rail hanging under a surface at vTop (teeth pointing down). */
export function railUnder(u0: number, u1: number, vTop: number, x = 0): [THREE.BufferGeometry[], number] {
  const out = [block(u0, u1, vTop - 0.004, vTop, 0.016, x), block(u0, u1, vTop - 0.0065, vTop - 0.004, 0.021, x)];
  for (let u = u0 + 0.004; u < u1 - 0.004; u += 0.01) out.push(block(u, u + 0.0052, vTop - 0.0095, vTop - 0.0065, 0.021, x));
  return [out, vTop - 0.0095];
}

/** A builder that drops everything: fine details on low-detail guns go here. */
export const DISCARD = {
  add(): typeof DISCARD {
    return DISCARD;
  },
} as unknown as PartBuilder;

/** Collects parts per material and merges them into one mesh per material. */
export class PartBuilder {
  private readonly byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(mat: THREE.Material, ...geos: (THREE.BufferGeometry | THREE.BufferGeometry[])[]): this {
    let list = this.byMat.get(mat);
    if (!list) this.byMat.set(mat, (list = []));
    for (const g of geos.flat()) list.push(g);
    return this;
  }

  build(name = 'part'): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, geos] of this.byMat) {
      const prepared = geos.map((g) => {
        const ng = g.index ? g.toNonIndexed() : g;
        ng.clearGroups();
        for (const key of Object.keys(ng.attributes)) {
          if (key !== 'position' && key !== 'normal' && key !== 'uv') ng.deleteAttribute(key);
        }
        if (ng !== g) g.dispose();
        boxProjectUVs(ng);
        return ng;
      });
      const merged = mergeGeometries(prepared, false);
      prepared.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      group.add(new THREE.Mesh(merged, mat));
    }
    return group;
  }
}
