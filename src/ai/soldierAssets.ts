import * as THREE from 'three';
import type { Team } from '@/world/mapTypes';

/**
 * The AI-made soldier models (owner, 2026-10-25; baked by
 * `scripts/soldier-bake.mjs` into public/assets/soldiers): one a side and sex,
 * each a near look (~14k triangles, skinned to the soldier skeleton) and a far
 * look (~2k, posed and frozen for the far crowd), with colour / normal /
 * roughness / metalness maps. Loaded once a page before soldiers are made;
 * without them (the game server, tests, a failed load) `SoldierModel` falls
 * back to its procedural body.
 */

export type Sex = 'm' | 'f';

/** Distance (m) from which a soldier draws its mid look (the far crowd takes over at BotManager's FAR_MODEL). */
export const MID_FROM = 25;

export interface SoldierJoints {
  hips: number[];
  spine: number[];
  head: number[];
  aim: number[];
  thighL: number[];
  shinL: number[];
  thighR: number[];
  shinR: number[];
  shoulderL: number[];
  elbowL: number[];
  wristL: number[];
  shoulderR: number[];
  elbowR: number[];
  wristR: number[];
  tip: number;
}

export interface SoldierAsset {
  id: string;
  joints: SoldierJoints;
  near: THREE.BufferGeometry;
  /** ~4.5k triangles, from MID_FROM on. */
  mid: THREE.BufferGeometry;
  far: THREE.BufferGeometry;
  /** A dark texel (far guns are painted with it). */
  dark: [number, number];
  material: THREE.MeshStandardMaterial;
  midMaterial: THREE.MeshStandardMaterial;
  farMaterial: THREE.MeshStandardMaterial;
}

const assets = new Map<string, SoldierAsset>();
let loading: Promise<void> | null = null;

const BASE = `${import.meta.env.BASE_URL}assets/soldiers/`;

interface Head {
  joints: SoldierJoints;
  min: number[];
  size: number[];
  dark: [number, number];
  looks: { near: { n: number }; far: { n: number }; mid?: { n: number } };
  buffers: { type: string; length: number }[];
}

const TYPES: Record<string, new (b: ArrayBuffer, o: number, n: number) => ArrayBufferView & ArrayLike<number>> = {
  Uint16Array,
  Int8Array,
  Uint8Array,
  Uint32Array,
};

function decode(buf: ArrayBuffer): { head: Head; near: THREE.BufferGeometry; far: THREE.BufferGeometry; mid: THREE.BufferGeometry | null } {
  const dv = new DataView(buf);
  const jsonLen = dv.getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, jsonLen)).trim().replace(/\0+$/, '')) as Head;
  let off = 4 + jsonLen;
  const arrays = head.buffers.map((b) => {
    const T = TYPES[b.type]!;
    const a = new T(buf, off, b.length);
    off += a.byteLength + ((4 - (a.byteLength % 4)) % 4);
    return a;
  });
  const look = (k: number, n: number): THREE.BufferGeometry => {
    const [pos, nrm, uv, idx, wt, index] = arrays.slice(k * 6, k * 6 + 6) as [Uint16Array, Int8Array, Uint16Array, Uint8Array, Uint8Array, Uint16Array | Uint32Array];
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) p[i] = head.min[i % 3]! + (pos[i]! / 65535) * head.size[i % 3]!;
    const nr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) nr[i * 3 + c] = nrm[i * 4 + c]! / 127;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
    const fuv = new Float32Array(n * 2);
    for (let i = 0; i < n * 2; i++) fuv[i] = uv[i]! / 65535;
    g.setAttribute('uv', new THREE.BufferAttribute(fuv, 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(idx), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(new Uint8Array(wt), 4, true));
    g.setIndex(new THREE.BufferAttribute(index.slice(), 1));
    g.computeBoundingSphere();
    return g;
  };
  const near = look(0, head.looks.near.n);
  // Tangents per vertex: the normal map then needs no screen-space derivatives per pixel (the same look, ~a third cheaper).
  near.computeTangents();
  return { head, near, far: look(1, head.looks.far.n), mid: head.looks.mid ? look(2, head.looks.mid.n) : null };
}

async function loadOne(id: string, tl: THREE.TextureLoader): Promise<void> {
  const res = await fetch(`${BASE}${id}.bin`);
  if (!res.ok) throw new Error(`${id}.bin ${res.status}`);
  const { head, near, far, mid } = decode(await res.arrayBuffer());
  const tex = (s: string, srgb = false): Promise<THREE.Texture> =>
    tl.loadAsync(`${BASE}${id}_${s}.jpg`).then((t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    });
  const [map, normalMap, roughnessMap, metalnessMap] = await Promise.all([tex('color', true), tex('normal'), tex('rough'), tex('metal')]);
  const material = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, metalnessMap, roughness: 1, metalness: 1 });
  const farMaterial = new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0.05 });
  // Past MID_FROM the normal map's detail is under a pixel: the mid look goes without it.
  const midMaterial = new THREE.MeshStandardMaterial({ map, roughnessMap, metalnessMap, roughness: 1, metalness: 1 });
  assets.set(id, { id, joints: head.joints, near, mid: mid ?? near, far, dark: head.dark, material, midMaterial, farMaterial });
}

/** Loads the four models (once a page; resolves even if they can't load: the procedural body stands in). */
export function loadSoldierAssets(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  // Dev: `?procsoldier` keeps the procedural bodies (A/B frame measurements).
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('procsoldier')) return Promise.resolve();
  loading ??= (async () => {
    const tl = new THREE.TextureLoader();
    try {
      await Promise.all(['blue_m', 'blue_f', 'red_m', 'red_f'].map((id) => loadOne(id, tl)));
    } catch (err) {
      console.warn('[strikegy] soldier models could not load; the procedural soldiers stand in', err);
      assets.clear();
    }
  })();
  return loading;
}

/** A side's model of a sex, once loaded. */
export function soldierAsset(team: Team, sex: Sex): SoldierAsset | null {
  return assets.get(`${team === 'red' ? 'red' : 'blue'}_${sex}`) ?? null;
}

/** A bot's sex (the same in every browser: from its id; about a third are women). */
export function sexOf(id: number): Sex {
  return Math.imul(id + 7, 2654435761) >>> 0 < 0xffffffff / 3 ? 'f' : 'm';
}
