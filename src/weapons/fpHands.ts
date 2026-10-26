import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gunMaterials } from './gunKit';

/**
 * First-person hands, remade (owner, 2026-10-25: the old ones were capsules
 * strung on the joints). The grips keep their joint points (`ViewModel.buildArms`
 * places them on each gun); this builds the shapes through them:
 *
 * - fingers: one smooth tube through the knuckle, the middle and end joints
 *   and the tip (Catmull-Rom), a little wider than deep, swelling at the
 *   joints, the tip rounded flat like a padded glove finger;
 * - palm / back of the hand: lofted rounded-rectangle sections from the
 *   wrist to the knuckle line, the back domed, the heel of the hand thicker;
 * - the glove's leather knuckle pads over the first finger bones and a padded
 *   back plate, a cuff with a strap;
 * - the sleeve: a lofted tube with soft folds round it and a turned-back hem
 *   at the wrist.
 *
 * Everything is in the caller's space (gun space), indexed with smooth
 * normals; UVs run round and along in metres x 40 so the fabric / glove
 * normal maps keep one scale.
 */

const UV = 40;
/** Segments round a section: fingers and palms, and the sleeves (whose folds need more). */
const RADIAL = 10;
const RADIAL_SLEEVE = 22;

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

interface Ring {
  c: THREE.Vector3;
  /** Across (side to side) and depth (back to front) directions, unit. */
  u: THREE.Vector3;
  v: THREE.Vector3;
  a: number;
  b: number;
  /** Superellipse exponent: 2 = ellipse, higher = squarer. */
  n?: number;
  /** Extra radius by angle (folds, bumps), as a fraction. */
  wobble?: (theta: number) => number;
}

/** A closed tube through rings (in order), with optional rounded caps. */
function loft(rings: Ring[], capStart: number, capEnd: number, radial = RADIAL, startRings = 3): THREE.BufferGeometry {
  const RADIAL = radial;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let along = 0;
  const point = (r: Ring, th: number, scale: number, out: THREE.Vector3) => {
    const n = r.n ?? 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const k = 2 / n;
    const x = Math.sign(c) * Math.abs(c) ** k;
    const y = Math.sign(s) * Math.abs(s) ** k;
    const w = 1 + (r.wobble?.(th) ?? 0);
    return out
      .copy(r.c)
      .addScaledVector(r.u, x * r.a * w * scale)
      .addScaledVector(r.v, y * r.b * w * scale);
  };
  const addRing = (r: Ring, scale: number, push: THREE.Vector3 | null) => {
    const base = pos.length / 3;
    const circ = Math.PI * (r.a + r.b);
    for (let i = 0; i <= RADIAL; i++) {
      const th = (i / RADIAL) * Math.PI * 2;
      point(r, th, scale, tmpA);
      if (push) tmpA.add(push);
      pos.push(tmpA.x, tmpA.y, tmpA.z);
      uv.push((i / RADIAL) * circ * UV, along * UV);
    }
    return base;
  };
  // Faces out whichever way round the section's axes turn (u x v along the tube or against it).
  const along0 = tmpB.copy(rings[1]!.c).sub(rings[0]!.c);
  const out = tmpA.crossVectors(rings[0]!.u, rings[0]!.v).dot(along0) > 0;
  const strip = (b0: number, b1: number) => {
    for (let i = 0; i < RADIAL; i++) {
      if (out) idx.push(b0 + i, b0 + i + 1, b1 + i, b0 + i + 1, b1 + i + 1, b1 + i);
      else idx.push(b0 + i, b1 + i, b0 + i + 1, b0 + i + 1, b1 + i, b1 + i + 1);
    }
  };
  // Start cap: shrinking rings pushed back along the tube.
  let prev = -1;
  const first = rings[0]!;
  const last = rings[rings.length - 1]!;
  const dirStart = tmpB.copy(rings[1]!.c).sub(first.c).normalize().clone();
  const dirEnd = tmpB.copy(last.c).sub(rings[rings.length - 2]!.c).normalize().clone();
  const CAP = 3;
  if (capStart > 0) {
    for (let k = startRings; k >= 1; k--) {
      const t = k / startRings;
      const at = addRing(first, Math.cos((t * Math.PI) / 2) || 0.001, dirStart.clone().multiplyScalar(-Math.sin((t * Math.PI) / 2) * capStart));
      if (prev >= 0) strip(prev, at);
      prev = at;
    }
  }
  for (let i = 0; i < rings.length; i++) {
    if (i > 0) along += rings[i]!.c.distanceTo(rings[i - 1]!.c);
    const at = addRing(rings[i]!, 1, null);
    if (prev >= 0) strip(prev, at);
    prev = at;
  }
  if (capEnd > 0) {
    for (let k = 1; k <= CAP; k++) {
      const t = k / CAP;
      along += capEnd / CAP;
      const at = addRing(last, Math.cos((t * Math.PI) / 2) || 0.001, dirEnd.clone().multiplyScalar(Math.sin((t * Math.PI) / 2) * capEnd));
      strip(prev, at);
      prev = at;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Frames along a path: tangent, and `u` / `v` kept turning as little as possible from a hint. */
function frames(pts: THREE.Vector3[], upHint: THREE.Vector3): { t: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 }[] {
  const out: { t: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 }[] = [];
  let v = upHint.clone();
  for (let i = 0; i < pts.length; i++) {
    const t = (i < pts.length - 1 ? pts[i + 1]!.clone().sub(pts[i]!) : pts[i]!.clone().sub(pts[i - 1]!)).normalize();
    // Parallel transport: take the last depth axis, drop its part along the new tangent.
    v = v.clone().addScaledVector(t, -v.dot(t));
    if (v.lengthSq() < 1e-8) v = Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    v.normalize();
    const u = new THREE.Vector3().crossVectors(v, t).normalize();
    out.push({ t, u, v });
  }
  return out;
}

export interface HandShapes {
  /** Glove fabric. */
  glove: THREE.BufferGeometry[];
  /** Leather pads, cuff strap. */
  leather: THREE.BufferGeometry[];
  sleeve: THREE.BufferGeometry[];
}

/**
 * Collects one hand's (or both hands') shapes. `back` is the hand's dorsal
 * direction hint in the caller's space (for a finger's flat side and where
 * its knuckle pad goes).
 */
export class HandKit {
  readonly out: HandShapes = { glove: [], leather: [], sleeve: [] };

  /** A finger (or thumb) through its joints, knuckle first; `r` its radius at the knuckle. */
  finger(pts: THREE.Vector3[], r: number, back: THREE.Vector3, thumb = false): void {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const len = curve.getLength();
    const n = Math.max(7, Math.round(len / 0.0075));
    const path: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) path.push(curve.getPointAt(i / n));
    // Where the joints fall along the length (for the swelling).
    const joints: number[] = [];
    let acc = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      acc += pts[i]!.distanceTo(pts[i - 1]!);
      joints.push(acc / len);
    }
    const fr = frames(path, back);
    const rings: Ring[] = path.map((c, i) => {
      const s = i / n;
      // Taper to the tip, a swell at each joint, a fuller base where it meets the palm.
      let k = 1 - 0.22 * s;
      for (const j of joints) k += 0.075 * Math.exp(-(((s - j) / 0.06) ** 2));
      if (thumb) k += 0.12 * Math.exp(-((s / 0.18) ** 2));
      const rr = r * k;
      return { c, u: fr[i]!.u, v: fr[i]!.v, a: rr * 1.1, b: rr * 0.9, n: 2.2 };
    });
    this.out.glove.push(loft(rings, r * 0.3, r * 0.95, RADIAL, 1));
    // A leather pad over the first bone's back (not on the thumb).
    if (!thumb && joints.length) {
      const end = Math.max(1, Math.round(joints[0]! * n * 0.92));
      const start = Math.round(end * 0.18);
      const pad: Ring[] = [];
      for (let i = start; i <= end; i++) {
        const f = fr[i]!;
        const rr = rings[i]!.a;
        pad.push({ c: path[i]!.clone().addScaledVector(f.v, rr * 0.5), u: f.u, v: f.v, a: rr * 0.72, b: rr * 0.5, n: 2.6 });
      }
      if (pad.length > 2) this.out.leather.push(loft(pad, 0.002, 0.002));
    }
  }

  /**
   * The palm and back of the hand from the wrist to the knuckle line: `width`
   * across the knuckles, `thick` deep, `roll` turns the flat of the hand round
   * the wrist-knuckle line (as the old capsule's roll did).
   */
  palm(wrist: THREE.Vector3, knuckles: THREE.Vector3, width: number, thick: number, roll: number): THREE.Vector3 {
    const t = knuckles.clone().sub(wrist).normalize();
    // The old capsule's frame: its width along the rolled X, its depth along the rolled Z.
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), t);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll));
    const u = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const len = wrist.distanceTo(knuckles);
    const rings: Ring[] = [];
    const N = 7;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      // Narrower at the wrist, full at the knuckles; the heel of the hand thick, thinner toward the fingers.
      const a = (width / 2) * (0.74 + 0.26 * Math.sin((s * Math.PI) / 2));
      const b = (thick / 2) * (1.12 - 0.3 * s);
      const c = wrist.clone().addScaledVector(t, s * len);
      // The back domes up (+v), the palm stays flatter: shift the middle a touch.
      rings.push({ c: c.addScaledVector(v, b * 0.08), u, v, a, b, n: 2.8, wobble: (th) => 0.05 * Math.max(0, Math.sin(th)) * Math.sin(s * Math.PI) });
    }
    this.out.glove.push(loft(rings, thick * 0.3, thick * 0.45));
    // A padded plate on the back of the hand.
    const plate: Ring[] = [];
    for (let i = 2; i <= N - 2; i++) {
      const r = rings[i]!;
      plate.push({ c: r.c.clone().addScaledVector(v, r.b * 0.62), u, v, a: r.a * 0.66, b: r.b * 0.46, n: 2.8 });
    }
    this.out.leather.push(loft(plate, 0.003, 0.003));
    return v;
  }

  /** The glove's cuff over the wrist, with a strap round it. */
  cuff(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number): void {
    const t = to.clone().sub(from).normalize();
    const fr = frames([from, to], Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
    const N = 5;
    const rings: Ring[] = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const r = r0 + (r1 - r0) * s;
      rings.push({ c: from.clone().lerp(to, s), u: fr[0]!.u, v: fr[0]!.v, a: r * 1.08, b: r * 0.94, n: 2.2 });
    }
    this.out.glove.push(loft(rings, 0, 0));
    const strap: Ring[] = [0.35, 0.5, 0.65].map((s) => {
      const r = (r0 + (r1 - r0) * s) * 1.07;
      return { c: from.clone().lerp(to, s), u: fr[0]!.u, v: fr[0]!.v, a: r * 1.08, b: r * 0.94, n: 2.2 };
    });
    this.out.leather.push(loft(strap, 0, 0));
  }

  /** The sleeve from the wrist on off screen: soft folds, a turned-back hem at the wrist. */
  sleeve(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number): void {
    const t = to.clone().sub(from).normalize();
    const fr = frames([from, to], Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
    const len = from.distanceTo(to);
    const rings: Ring[] = [];
    const N = 11;
    for (let i = 0; i <= N; i++) {
      // Rings closer together at the wrist, where the hem and the deepest folds are.
      const s = (i / N) ** 1.4;
      // The hem: a fuller band over the first few centimetres.
      const hem = 0.1 * Math.exp(-(((s * len) / 0.025) ** 2)) + 0.06 * Math.exp(-(((s * len - 0.035) / 0.012) ** 2));
      const r = (r0 + (r1 - r0) * s) * (1 + hem);
      rings.push({
        c: from.clone().lerp(to, s),
        u: fr[0]!.u,
        v: fr[0]!.v,
        a: r * 1.06,
        b: r * 0.96,
        n: 2.1,
        // Folds: a few soft lengthwise ridges that drift round as the sleeve goes back, deeper near the wrist.
        wobble: (th) => (0.06 + 0.05 * (1 - s)) * Math.sin(th * 5 + s * 4.2) * Math.sin(th * 2 + 1.3) + 0.03 * Math.sin(th * 9 - s * 7) + 0.025 * Math.sin(th * 3 + s * 11),
      });
    }
    this.out.sleeve.push(loft(rings, 0, 0, RADIAL_SLEEVE));
  }
}

let mats: { glove: THREE.MeshStandardMaterial; sleeve: THREE.MeshStandardMaterial } | null = null;

/** The leather parts against the glove's fabric: darker, and shinier (roughness x this). */
const LEATHER = { tint: 0.62, rough: 0.67 };

/**
 * The hands' materials (shared; `setHandColors` tints them to the player's
 * soldier). The glove's fabric and its leather pads are one draw: the leather
 * carries its tone in the vertex colour and its shine in a `rough` attribute
 * that scales the material's roughness.
 */
export function handMaterials(): NonNullable<typeof mats> {
  if (mats) return mats;
  const stipple = gunMaterials().polymerTex.normalMap;
  const glove = new THREE.MeshStandardMaterial({ color: 0x2e2a25, metalness: 0, roughness: 0.82, normalMap: stipple, normalScale: new THREE.Vector2(0.2, 0.2), vertexColors: true });
  glove.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float rough;\nvarying float vRough;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = rough;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRough;')
      .replace('float roughnessFactor = roughness;', 'float roughnessFactor = roughness * vRough;');
  };
  glove.customProgramCacheKey = () => 'fpGlove';
  mats = {
    glove,
    sleeve: new THREE.MeshStandardMaterial({ color: 0x3a4030, metalness: 0, roughness: 0.95, normalMap: stipple, normalScale: new THREE.Vector2(0.35, 0.35) }),
  };
  return mats;
}

/** The glove's fabric and leather shapes as one geometry (tone and shine per vertex). */
export function gloveGeometry(fabric: THREE.BufferGeometry[], leather: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  // Leather first: it sits on the fabric, so the fabric behind it fails the depth test instead of being shaded twice.
  const parts = [...leather.map((g) => [g, LEATHER.tint, LEATHER.rough] as const), ...fabric.map((g) => [g, 1, 1] as const)];
  for (const [g, tint, rough] of parts) {
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(tint), 3));
    g.setAttribute('rough', new THREE.Float32BufferAttribute(new Float32Array(n).fill(rough), 1));
  }
  return parts.length ? mergeGeometries(parts.map((p) => p[0])) : null;
}

/**
 * Tints the sleeves and gloves to the player's soldier (its colour texture's
 * forearm and hand colours). The glove keeps to dark tones: a model with bare
 * hands would otherwise get skin-coloured gloves.
 */
export function setHandColors(sleeve: THREE.Color, glove: THREE.Color): void {
  const m = handMaterials();
  m.sleeve.color.copy(sleeve);
  const hsl = { h: 0, s: 0, l: 0 };
  glove.getHSL(hsl);
  m.glove.color.setHSL(hsl.h, Math.min(hsl.s, 0.35), Math.min(hsl.l, 0.16));
}
