import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildGun } from '@/weapons/gunModels';
import { tickCamo } from '@/weapons/camoMaterial';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import { buildVehicleModel } from '@/vehicles/vehicleModels';
import { applyVehicleSkin, setVehicleSurfaces } from '@/vehicles/vehicleLooks';
import type { VehicleKind } from '@/vehicles/vehicleData';
import { KillEffects } from '@/render/killEffects';
import { SurfaceLibrary } from '@/render/textures';
import { SoldierModel, type SoldierPose } from '@/ai/SoldierModel';
import { loadSoldierAssets } from '@/ai/soldierAssets';
import type { Item, Rarity, VehicleClass } from '@/progression/catalog';

/**
 * The shop's and armory's 3D look at an item (2026-10-27, BM quality: "the
 * skins look cheap"): the gun wearing the skin, camo or charm on a turntable
 * under studio light (a warm key, a cool rim, a soft floor shadow, the
 * backdrop lit in the rarity's colour); a vehicle skin on a vehicle of its
 * family; a kill effect playing over and over on a stand-in. Drag turns it,
 * the wheel zooms, it turns slowly by itself when left alone. Its own
 * renderer, made when the dialog opens and let go when it closes.
 */

const RARITY_LIGHT: Record<Rarity, number> = { common: 0x8a8f96, uncommon: 0x4caf6a, rare: 0x3f8fe0, epic: 0xa060e8, legendary: 0xf0a030 };
const VEHICLE_OF: Record<VehicleClass, VehicleKind> = { armor: 'tank', car: 'jeep', air: 'fighter', ship: 'patrol' };
const ASSETS = `${import.meta.env.BASE_URL}assets/`;
/** Kill effect preview: the soldier goes down this far into each loop. */
const FX_DOWN = 0.9;
const FX_LOOP = 2.6;

let vehicleSurfaces: Promise<SurfaceLibrary> | null = null;

/** Whether `it` has a 3D look (cards, emblems and plates stay pictures). */
export function hasViewer(it: Item): boolean {
  return it.kind === 'skin' || it.kind === 'camo' || it.kind === 'charm' || it.kind === 'vskin' || it.kind === 'kfx';
}

/** Opens the viewer in `host` (sized by it); returns the function that closes it. */
export function openViewer(host: HTMLElement, it: Item): () => void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return () => {};
  }
  const canvas = renderer.domElement;
  canvas.className = 'iv-canvas';
  host.appendChild(canvas);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.03);
  pmrem.dispose();
  scene.environment = env.texture;
  scene.environmentIntensity = 0.55;

  // Studio: warm key above front-left, cool rim behind, the rarity's colour washing the backdrop.
  const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
  key.position.set(-1.2, 2.2, 1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  const rim = new THREE.DirectionalLight(0xb8d0ff, 2.2);
  rim.position.set(1.4, 1.2, -2);
  const glow = new THREE.PointLight(RARITY_LIGHT[it.rarity], 3, 0, 1.4);
  scene.add(key, rim, glow, new THREE.HemisphereLight(0xdfe6ee, 0x221f1c, 0.35));

  const stage = new THREE.Group();
  scene.add(stage);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
  /** The framed object's bounding sphere radius and how tight to frame it (1 = the sphere just fits). */
  let fitR = 1;
  let fitK = 1;
  let target = new THREE.Vector3();
  let fx: KillEffects | null = null;
  let soldier: { model: SoldierModel; pose: SoldierPose; t: number } | null = null;
  const disposers: (() => void)[] = [];

  /** Frames `obj` (its size sets the camera distance, floor, lights and shadow box). */
  const frame = (obj: THREE.Object3D) => {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    // Stand it on the floor at the origin.
    obj.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
    const span = Math.max(size.x, size.y, size.z);
    target = new THREE.Vector3(0, size.y / 2, 0);
    fitR = size.length() / 2;
    floor.scale.setScalar(span * 6);
    key.position.set(-1.2, 2.2, 1.6).multiplyScalar(span);
    rim.position.set(1.4, 1.2, -2).multiplyScalar(span);
    glow.position.set(0, size.y * 0.6, -span * 1.3);
    glow.distance = span * 6;
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -span;
    sc.right = sc.top = span;
    sc.near = span * 0.1;
    sc.far = span * 8;
    sc.updateProjectionMatrix();
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
  };

  if (it.kind === 'skin' || it.kind === 'camo' || it.kind === 'charm') {
    const weapon = (it.kind === 'skin' && it.weapon && it.weapon in WEAPONS ? it.weapon : 'ar1') as WeaponId;
    const def = { ...WEAPONS[weapon], ...(it.kind === 'skin' ? { skin: it.id } : it.kind === 'camo' ? { camo: it.id } : { charm: it.id }) };
    const gun = buildGun(def).group;
    // Muzzle toward the right of the first view, the gun's left side (where the charm hangs) to the camera.
    gun.rotation.y = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(gun);
    stage.add(holder);
    frame(holder);
    // Mostly length: its sphere is far taller than the gun, so frame tighter.
    fitK = 0.62;
  } else if (it.kind === 'vskin' && it.vclass) {
    const kind = VEHICLE_OF[it.vclass];
    vehicleSurfaces ??= (async () => {
      const lib = new SurfaceLibrary(512, 8);
      await Promise.all([lib.preload(['metal'], ASSETS), lib.rasterizeAhead(['paint', 'canvas', 'rubber'])]);
      return lib;
    })();
    void vehicleSurfaces.then((lib) => {
      if (disposed) return;
      setVehicleSurfaces(lib);
      const model = buildVehicleModel(kind, 'blue');
      applyVehicleSkin(model.root, it.vskin ?? null);
      stage.add(model.root);
      frame(model.root);
      fitK = 0.7;
    });
  } else if (it.kind === 'kfx' && it.kfx) {
    // An enemy soldier standing, then going down as the effect plays; again every 2.6 s.
    void loadSoldierAssets().then(() => {
      if (disposed) return;
      const model = new SoldierModel('red', WEAPONS.ar1, 'm');
      const pose: SoldierPose = { speed: 0, crouch: 0, yaw: Math.PI, aimPitch: -0.1, deadFor: -1, dt: 0 };
      model.update(new THREE.Vector3(), pose);
      stage.add(model.root);
      frame(model.root);
      fitK = 1.05;
      fx = new KillEffects();
      scene.add(fx.group);
      soldier = { model, pose, t: 0 };
    });
    disposers.push(() => fx?.dispose());
  }

  // Turntable: drag to turn / tilt, wheel to zoom, idle spin.
  let yaw = it.kind === 'kfx' ? 0.2 : 0.55;
  let pitch = 0.18;
  let zoom = 1;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let idle = 0;
  const down = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.01;
    pitch = Math.max(-0.2, Math.min(1.1, pitch + (e.clientY - lastY) * 0.006));
    lastX = e.clientX;
    lastY = e.clientY;
    idle = 0;
  };
  const up = () => {
    dragging = false;
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    zoom = Math.max(0.45, Math.min(1.6, zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
    idle = 0;
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });

  let disposed = false;
  let raf = 0;
  let last = performance.now();
  let clock = 0;
  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  const tick = (now: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    idle += dt;
    if (!dragging && idle > 2.5) yaw += dt * 0.35;
    tickCamo(clock);
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const r = (fitR / Math.sin(Math.min(vfov, hfov) / 2)) * fitK * zoom;
    camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * r, target.y + Math.sin(pitch) * r, target.z + Math.cos(yaw) * Math.cos(pitch) * r);
    camera.lookAt(target);
    if (fx && soldier && it.kfx) {
      const was = soldier.t;
      soldier.t = (soldier.t + dt) % FX_LOOP;
      if (was < FX_DOWN && soldier.t >= FX_DOWN) {
        soldier.model.onDeath(0);
        fx.play(it.kfx, new THREE.Vector3(0, 0, 0));
      }
      soldier.pose.deadFor = soldier.t >= FX_DOWN ? soldier.t - FX_DOWN : -1;
      soldier.pose.dt = dt;
      soldier.model.update(new THREE.Vector3(), soldier.pose);
      fx.update(dt, camera);
    }
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);
  // Dev: a full-size picture of the view (look development without the pane's scaled screenshots).
  if (import.meta.env.DEV)
    (canvas as unknown as { snap: (yawTo?: number, zoomTo?: number, advance?: number) => Promise<Blob | null> }).snap = (yawTo, zoomTo, advance = 0) => {
      if (yawTo !== undefined) yaw = yawTo;
      if (zoomTo !== undefined) zoom = zoomTo;
      idle = -1e9;
      // Steps time by hand (a hidden page gets no animation frames).
      for (let k = Math.round(advance / 0.0167); k >= 0; k--) {
        cancelAnimationFrame(raf);
        tick(last + 16.7);
      }
      return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    };

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    for (const d of disposers) d();
    env.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
}
