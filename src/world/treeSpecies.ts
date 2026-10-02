import * as THREE from 'three';
import { makeRng } from '@/render/noise';
import type { ConiferVariant } from './conifers';

/**
 * Broadleaf trees (meadow woods, orchards) and date palms, built the same way
 * as the conifers: a trunk plus foliage "cards" with a painted alpha texture,
 * scaled to the shared TREE_HEIGHT so impostors and colliders work unchanged.
 */

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A clump of leaves on twigs: dense in the middle, ragged at the rim. */
export function leafTexture(): THREE.CanvasTexture {
  const rng = makeRng(13);
  return canvasTexture(256, (ctx) => {
    ctx.strokeStyle = '#4a3a2a';
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2;
      ctx.lineWidth = 2 + rng() * 2;
      ctx.beginPath();
      ctx.moveTo(128, 128);
      ctx.lineTo(128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100);
      ctx.stroke();
    }
    const leaf = (x: number, y: number, r: number, light: number) => {
      ctx.fillStyle = `hsl(${88 + rng() * 22} ${32 + rng() * 22}% ${light}%)`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.55, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    };
    // Darker leaves underneath, lit ones on top; all within a lumpy disc.
    for (const [count, light] of [[420, 16], [380, 24], [220, 33]] as const) {
      for (let i = 0; i < count; i++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * (92 + 18 * Math.sin(a * 5));
        leaf(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 6 + rng() * 6, light * (0.8 + rng() * 0.45));
      }
    }
  });
}

/** One palm frond seen from above: a rib along +u, leaflets swept toward the tip. */
export function frondTexture(): THREE.CanvasTexture {
  const rng = makeRng(17);
  return canvasTexture(256, (ctx) => {
    const y = 128;
    ctx.lineCap = 'round';
    for (let i = 0; i < 60; i++) {
      const t = 0.04 + (i / 60) * 0.94;
      const x = t * 250;
      const len = (1 - Math.abs(t - 0.4) * 1.2) * 110 + 12;
      for (const side of [-1, 1]) {
        ctx.strokeStyle = `hsl(${78 + rng() * 25} ${30 + rng() * 15}% ${20 + rng() * 14}%)`;
        ctx.lineWidth = 2.5 + rng() * 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + len * 0.35, y + side * len * 0.5, x + len * 0.5, y + side * len * (0.85 + rng() * 0.15));
        ctx.stroke();
      }
    }
    ctx.strokeStyle = '#7a6a45';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(252, y);
    ctx.stroke();
  });
}

class Cards {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  private readonly corner = new THREE.Vector3();
  private readonly n = new THREE.Vector3();

  /** A quad centred on `c` spanning `a` and `b` (half extents), normals blended toward `out`. */
  quad(c: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3, shade: number, uv: [number, number, number, number] = [0, 0, 1, 1]): void {
    const [u0, v0, u1, v1] = uv;
    const corners: [number, number, number, number][] = [
      [-1, -1, u0, v0],
      [1, -1, u1, v0],
      [1, 1, u1, v1],
      [-1, -1, u0, v0],
      [1, 1, u1, v1],
      [-1, 1, u0, v1],
    ];
    for (const [i, j, u, v] of corners) {
      this.corner.copy(c).addScaledVector(a, i).addScaledVector(b, j);
      this.pos.push(this.corner.x, this.corner.y, this.corner.z);
      this.n.copy(out);
      this.nor.push(this.n.x, this.n.y, this.n.z);
      this.uv.push(u, v);
      this.col.push(shade, shade, shade);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Bark UVs: wrap once around, repeat every ~2 m up. */
function barkUv(g: THREE.BufferGeometry, h: number): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * h * 0.5);
}

/** A round deciduous crown on a short, forking trunk. */
export function broadleafVariant(seed: number, height: number): ConiferVariant {
  const rng = makeRng(seed);
  const H = height * (0.85 + rng() * 0.15);
  const fork = H * (0.3 + rng() * 0.1);
  const parts: THREE.BufferGeometry[] = [];
  const stem = new THREE.CylinderGeometry(0.3, 0.55, fork + 0.4, 8, 1, true);
  stem.translate(0, (fork + 0.4) / 2, 0);
  barkUv(stem, fork);
  parts.push(stem);
  // Main limbs fanning up into the crown.
  const limbs = 3 + Math.floor(rng() * 2);
  const crownY = H * 0.62;
  const R = H * (0.3 + rng() * 0.06);
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < limbs; k++) {
    const a = (k / limbs) * Math.PI * 2 + rng() * 0.6;
    const tip = new THREE.Vector3(Math.cos(a) * R * 0.55, crownY + (rng() - 0.3) * H * 0.12, Math.sin(a) * R * 0.55);
    const base = new THREE.Vector3(0, fork, 0);
    const len = tip.distanceTo(base);
    const limb = new THREE.CylinderGeometry(0.1, 0.26, len, 6, 1, true);
    barkUv(limb, len);
    limb.translate(0, len / 2, 0);
    limb.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, tip.clone().sub(base).normalize()));
    limb.translate(base.x, base.y, base.z);
    parts.push(limb);
  }
  const trunk = mergeAll(parts);

  // Crown: a few overlapping lobes, leaf clumps on and just inside their surface.
  const cards = new Cards();
  const lobes = Array.from({ length: 4 + Math.floor(rng() * 3) }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 + rng();
    const off = i === 0 ? 0 : R * (0.35 + rng() * 0.25);
    return { c: new THREE.Vector3(Math.cos(a) * off, crownY + (rng() - 0.4) * R * 0.5, Math.sin(a) * off), r: R * (0.55 + rng() * 0.3) };
  });
  const centre = new THREE.Vector3(0, crownY, 0);
  const d = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const out = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (const lobe of lobes) {
    const count = Math.round(70 * (lobe.r / R) ** 2);
    for (let i = 0; i < count; i++) {
      d.set(rng() * 2 - 1, rng() * 1.6 - 0.6, rng() * 2 - 1).normalize();
      p.copy(lobe.c).addScaledVector(d, lobe.r * (0.7 + rng() * 0.3));
      if (p.y < fork + 1) continue;
      out.copy(p).sub(centre).normalize();
      // Card roughly facing outward, turned at random about that direction.
      a.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).cross(out).normalize();
      b.crossVectors(out, a).normalize();
      const s = H * (0.075 + rng() * 0.035);
      a.multiplyScalar(s);
      b.multiplyScalar(s);
      // Shade: darker underneath and toward the inside.
      const shade = 0.5 + 0.5 * THREE.MathUtils.clamp(0.55 + out.y * 0.5, 0, 1);
      cards.quad(p, a, b, out.clone().multiplyScalar(0.7).addScaledVector(up, 0.4).normalize(), shade);
    }
  }
  return { foliage: cards.geometry(), trunk, radius: R * 1.5 };
}

/** A date palm: a leaning, slightly curved trunk and a crown of arching fronds. */
export function palmVariant(seed: number, height: number): ConiferVariant {
  const rng = makeRng(seed);
  const H = height * (0.8 + rng() * 0.2);
  const lean = (rng() - 0.3) * H * 0.18;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.3, 0),
    new THREE.Vector3(lean * 0.15, H * 0.35, 0),
    new THREE.Vector3(lean * 0.55, H * 0.7, 0),
    new THREE.Vector3(lean, H * 0.9, 0),
  ]);
  const tube = new THREE.TubeGeometry(curve, 10, 0.3, 7, false);
  // Taper toward the top and ring the bark (old leaf bases).
  const tp = tube.getAttribute('position') as THREE.BufferAttribute;
  const uvs = tube.getAttribute('uv') as THREE.BufferAttribute;
  const axis = new THREE.Vector3();
  for (let i = 0; i < tp.count; i++) {
    const t = uvs.getX(i);
    curve.getPoint(t, axis);
    const k = 1.25 - 0.45 * t;
    tp.setXYZ(i, axis.x + (tp.getX(i) - axis.x) * k, tp.getY(i), axis.z + (tp.getZ(i) - axis.z) * k);
    uvs.setXY(i, uvs.getY(i), t * H * 0.5);
  }
  tube.computeVertexNormals();
  const top = curve.getPoint(1);

  const cards = new Cards();
  const fronds = 13 + Math.floor(rng() * 5);
  const seg = 4;
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const along = new THREE.Vector3();
  const side = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let R = 0;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rng() * 0.3;
    const dead = f % 6 === 5;
    const len = H * (0.32 + rng() * 0.08);
    // Starts rising, arches over and droops; dead fronds hang down.
    const rise = dead ? -0.9 : 0.55 + rng() * 0.35;
    const droop = dead ? 0.4 : 1.6 + rng() * 0.6;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    side.crossVectors(up, dir).normalize();
    const width = len * 0.22;
    const shade = dead ? 0.55 : 0.8 + rng() * 0.2;
    for (let s = 0; s < seg; s++) {
      const t0 = s / seg;
      const t1 = (s + 1) / seg;
      const at = (t: number, o: THREE.Vector3) => o.copy(top).addScaledVector(dir, len * t).setY(top.y + len * (rise * t - droop * t * t * 0.5));
      at(t0, p0);
      at(t1, p1);
      along.subVectors(p1, p0).multiplyScalar(0.5);
      const c = p0.clone().add(p1).multiplyScalar(0.5);
      nrm.crossVectors(along, side).normalize();
      if (nrm.y < 0) nrm.negate();
      nrm.addScaledVector(dir, 0.4).normalize();
      cards.quad(c, along, side.clone().multiplyScalar(width * (1 - t0 * 0.5)), nrm, dead ? shade * 0.8 : shade, [t0, 0, t1, 1]);
      R = Math.max(R, Math.hypot(p1.x, p1.z));
    }
  }
  return { foliage: cards.geometry(), trunk: tube, radius: R + 0.6 };
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Small local merge (avoids pulling in BufferGeometryUtils for a handful of cylinders).
  let vertices = 0;
  let indices = 0;
  const ps = parts;
  for (const p of ps) {
    vertices += p.getAttribute('position').count;
    indices += p.index ? p.index.count : p.getAttribute('position').count;
  }
  const pos = new Float32Array(vertices * 3);
  const nor = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  const idx = new Uint32Array(indices);
  let vo = 0;
  let io = 0;
  for (const p of ps) {
    const n = p.getAttribute('position').count;
    pos.set(p.getAttribute('position').array as Float32Array, vo * 3);
    nor.set(p.getAttribute('normal').array as Float32Array, vo * 3);
    uv.set(p.getAttribute('uv').array as Float32Array, vo * 2);
    if (p.index) for (let i = 0; i < p.index.count; i++) idx[io++] = p.index.getX(i) + vo;
    else for (let i = 0; i < n; i++) idx[io++] = i + vo;
    vo += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
