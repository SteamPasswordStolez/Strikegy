import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildGun } from '@/weapons/gunModels';
import { WEAPONS, type WeaponDef, type WeaponId } from '@/weapons/weaponData';
import { ATTACH_SLOTS, withAttachments, type AttachSet } from '@/weapons/attachments';

/**
 * Pictures of the guns for the deploy screen's kit (design system,
 * 2026-10-17: "show the gun, not its name"): each weapon's own full-detail
 * model (weapons/gunModels `buildGun`) drawn once from the side, muzzle to the
 * right, on a transparent background, kept as an image address for the page.
 *
 * A small renderer of its own (not the game's: no tone mapping, render target
 * or state of the game's to disturb), made on the first request and let go a
 * few seconds after the last one. One gun every 16 ms, so opening the list never
 * stalls the page.
 */
const W = 480;
const H = 168;
const IDLE_MS = 4000;

const done = new Map<string, string>();
const waiting = new Map<string, ((url: string | null) => void)[]>();
const queue: { key: string; def: WeaponDef }[] = [];

/** One picture a weapon and set of attachments. */
function keyOf(id: WeaponId, set?: AttachSet, camo?: string): string {
  const parts = ATTACH_SLOTS.map((s) => set?.[s] ?? '').join(',');
  return (parts.replace(/,/g, '') ? `${id}|${parts}` : id) + (camo ? `#${camo}` : '');
}
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let envTarget: THREE.WebGLRenderTarget | null = null;
let pumping = false;
let idleTimer = 0;
let failed = false;

/** The picture of a weapon, with `set` fitted (null where WebGL can't draw it). */
export function weaponPortrait(id: WeaponId, set?: AttachSet, camo?: string): Promise<string | null> {
  const key = keyOf(id, set, camo);
  const have = done.get(key);
  if (have) return Promise.resolve(have);
  if (failed) return Promise.resolve(null);
  return new Promise((resolve) => {
    const list = waiting.get(key);
    if (list) list.push(resolve);
    else {
      waiting.set(key, [resolve]);
      queue.push({ key, def: { ...withAttachments(WEAPONS[id], set), ...(camo ? { camo } : {}) } });
    }
    pump();
  });
}

/** A picture already made, if any (no waiting). */
export function weaponPortraitNow(id: WeaponId, set?: AttachSet, camo?: string): string | null {
  return done.get(keyOf(id, set, camo)) ?? null;
}

function setup(): boolean {
  if (renderer) return true;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    failed = true;
    return false;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  pmrem.dispose();
  scene.environment = envTarget.texture;
  // A warm key from above front, a cool rim from behind: the shape reads on a dark page.
  const key = new THREE.DirectionalLight(0xfff2e0, 2.2);
  key.position.set(0.4, 1, 1.2);
  const rim = new THREE.DirectionalLight(0xbcd4ff, 1.4);
  rim.position.set(-0.6, 0.5, -1);
  scene.add(key, rim, new THREE.HemisphereLight(0xffffff, 0x2a2622, 0.5));
  return true;
}

function teardown(): void {
  envTarget?.dispose();
  envTarget = null;
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = null;
  scene = null;
}

function pump(): void {
  if (pumping) return;
  pumping = true;
  window.clearTimeout(idleTimer);
  window.setTimeout(step, 0);
}

function step(): void {
  const job = queue.shift();
  if (!job) {
    pumping = false;
    idleTimer = window.setTimeout(teardown, IDLE_MS);
    return;
  }
  let url: string | null = null;
  if (setup()) {
    try {
      url = draw(job.def);
      done.set(job.key, url);
    } catch (err) {
      console.warn('weapon picture failed', job.key, err);
    }
  }
  for (const resolve of waiting.get(job.key) ?? []) resolve(url);
  waiting.delete(job.key);
  window.setTimeout(step, 16);
}

/** Draws one gun side-on, fitted to the picture with a little margin. */
function draw(def: WeaponDef): string {
  const r = renderer!;
  const s = scene!;
  const gun = buildGun(def);
  const g = gun.group;
  s.add(g);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  // The gun's length runs along x or z; look at it from the side across that axis.
  const alongX = size.x >= size.z;
  const length = alongX ? size.x : size.z;
  const muzzle = g.localToWorld(gun.muzzle.clone());
  // Side the camera stands on so the muzzle ends up on the right of the picture.
  let side: THREE.Vector3;
  if (alongX) side = new THREE.Vector3(0, 0, muzzle.x > centre.x ? 1 : -1);
  else side = new THREE.Vector3(muzzle.z > centre.z ? -1 : 1, 0, 0);
  const aspect = W / H;
  const halfW = (Math.max(length, size.y * aspect) / 2) * 1.08;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfW / aspect, -halfW / aspect, 0.01, 20);
  cam.position.copy(centre).addScaledVector(side, 5);
  cam.lookAt(centre);
  r.render(s, cam);
  const url = r.domElement.toDataURL('image/png');
  // No dispose: the parts may share cached geometry with the game's own gun models;
  // this renderer's copies go with its context (`teardown`).
  s.remove(g);
  return url;
}
