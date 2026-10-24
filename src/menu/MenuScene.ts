/**
 * The main menu's background (owner, 2026-10-24: "a light real-time 3D scene"
 * instead of the recorded film): a small hand-set diorama, not a match. Dusk
 * over a shelled field, the enemy to the left: a squad behind a sandbag nest
 * on the right (the menu sits on the left) firing left across the field, a
 * burning tank wreck and its smoke, ruins and tree lines fading into the haze,
 * the low sun behind the far side, artillery flashing on the horizon, tracers,
 * embers and ash. A camera moves slowly along it. Nothing simulates: no
 * physics, map, navmesh or bots; the game's own models, surfaces, trees and
 * renderer (its grade and, where the preset has them, bloom and AO), drawn at
 * 30 frames a second at most and paused while the tab is hidden. Loaded as its
 * own chunk after the menu paints (`MenuScene.create`).
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Renderer } from '@/render/Renderer';
import { LAYER_FX } from '@/render/layers';
import { SurfaceLibrary } from '@/render/textures';
import { SoldierModel, type SoldierPose } from '@/ai/SoldierModel';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import { FortModels, FORT_SIZE } from '@/world/fortModels';
import { buildKit, type KitMaterial } from '@/world/modelKits';
import { createConiferKit } from '@/world/conifers';
import { buildVehicleModel } from '@/vehicles/vehicleModels';
import type { QualityPreset } from '@/core/Settings';

/** One shot of the camera: from where to where, looking at what, how long (s). */
interface Shot {
  from: [number, number, number];
  to: [number, number, number];
  look: [number, number, number];
  lookTo: [number, number, number];
  fov: number;
  sec: number;
}

/**
 * A slow loop of four shots, each easing into the next: the squad from behind
 * their left shoulder with the field beyond, low over the nest toward the
 * wreck, wide and high over the line, and their faces from the field side.
 */
const SHOTS: readonly Shot[] = [
  { from: [-0.5, 1.45, 7.8], to: [1.4, 1.55, 6.8], look: [0.2, 1.1, -1.5], lookTo: [0.6, 1.1, -2.0], fov: 44, sec: 16 },
  { from: [6.8, 1.05, 3.6], to: [6.0, 1.0, 2.6], look: [-9, 1.6, -8], lookTo: [-11, 1.8, -10], fov: 46, sec: 14 },
  { from: [-2.5, 3.4, 13], to: [1.5, 3.0, 12], look: [-6, 1.2, -9], lookTo: [-3, 1.2, -10], fov: 48, sec: 14 },
  { from: [-3.4, 2.3, -6.2], to: [-2.4, 2.1, -5.0], look: [3.0, 0.9, -0.8], lookTo: [3.2, 0.9, -0.4], fov: 38, sec: 12 },
];
const LOOP = SHOTS.reduce((a, s) => a + s.sec, 0);
/** Seconds a shot's end blends into the next one's start. */
const BLEND = 3;
const FPS = 30;
/** Facing the enemy (-X): a soldier's yaw (0 faces -Z). */
const FACE_ENEMY = Math.PI / 2;
const ASSETS = `${import.meta.env.BASE_URL}assets/`;

const smooth = (t: number) => t * t * (3 - 2 * t);
const v3 = (a: [number, number, number]) => new THREE.Vector3(...a);

/** A soft round puff, white, for smoke, glows and flashes (drawn on a canvas once). */
function puffTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  // Lumps, so a column of puffs doesn't read as balls.
  for (let i = 0; i < 40; i++) {
    const x = 24 + Math.random() * 80;
    const y = 24 + Math.random() * 80;
    const r = 8 + Math.random() * 18;
    const lump = g.createRadialGradient(x, y, 0, x, y, r);
    lump.addColorStop(0, 'rgba(255,255,255,0.18)');
    lump.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lump;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** UVs in metres, projected along each face's main axis (walls take the surfaces' world-scale tiling). */
function metreUv(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    const az = Math.abs(nrm.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [pos.getX(i), pos.getZ(i)] : ax >= az ? [pos.getZ(i), pos.getY(i)] : [pos.getX(i), pos.getY(i)];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** The ground's height under (x, z): gentle rolls, the far field rising into the haze. */
function heightAt(x: number, z: number): number {
  let y = Math.sin(x * 0.07) * 0.5 + Math.cos(z * 0.05 + 1.3) * 0.6 + Math.sin((x + z) * 0.21) * 0.12;
  if (z < -40) y += (-40 - z) * 0.03;
  if (x < -45) y += (-45 - x) * 0.02;
  return y;
}

/** Shell holes (x, z, radius). */
const CRATERS: readonly [number, number, number][] = [
  [-4, -2, 2.2],
  [-9, -6, 3.2],
  [-14, 2, 2.6],
  [-6, 5, 1.8],
  [-20, -14, 4],
  [-26, 4, 3.5],
  [-3, -11, 2.4],
];

/** Ground: rolling field with shell holes and churned mud, on the game's terrain surface. */
function ground(surfaces: SurfaceLibrary): THREE.Mesh {
  const size = 320;
  const geo = new THREE.PlaneGeometry(size, size, 240, 240);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let y = heightAt(x, z) + Math.sin(x * 1.3) * Math.cos(z * 1.1) * 0.04;
    let mud = 0;
    for (const [cx, cz, r] of CRATERS) {
      const d = Math.hypot(x - cx, z - cz) / r;
      if (d < 1.5) {
        y += d < 1 ? -0.8 * (1 - d * d) : 0.3 * (1.5 - d) * 2;
        mud = Math.max(mud, 1 - d / 1.5);
      }
    }
    // No-man's land (left of the nest) is torn up; our side less so.
    const torn = THREE.MathUtils.clamp((-x - 1) / 10, 0, 1) * 0.35;
    pos.setY(i, y);
    uv[i * 2] = x;
    uv[i * 2 + 1] = -z;
    // Trampled, dusk-dark grass going to churned mud: a warm brown over the grass surface.
    const k = 0.62 * (1 - Math.min(0.7, mud * 0.9 + torn));
    const brown = Math.min(1, mud * 1.2 + torn * 1.5);
    col[i * 3] = k * (0.85 + brown * 0.25);
    col[i * 3 + 1] = k * (0.8 - brown * 0.1);
    col[i * 3 + 2] = k * (0.62 - brown * 0.05);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = surfaces.terrain('grass').clone();
  mat.vertexColors = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** A kit model (`modelKits.ts`) as meshes, standing on y = 0. */
function kit(kind: Parameters<typeof buildKit>[0], w: number, h: number, d: number, looks: (m: KitMaterial) => THREE.Material, seed = 7): THREE.Group {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const g = new THREE.Group();
  for (const p of buildKit(kind, w, h, d, rand).pieces) {
    const geo = p.geo;
    if (!geo.getAttribute('uv')) metreUv(geo);
    if (!geo.getAttribute('color')) {
      const n = geo.getAttribute('position').count;
      const c = new Float32Array(n * 3);
      const tint = new THREE.Color(p.tint ?? '#ffffff');
      for (let i = 0; i < n; i++) tint.toArray(c, i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    const mat = looks(p.mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

interface Actor {
  model: SoldierModel;
  pos: THREE.Vector3;
  pose: SoldierPose;
  /** Walks back and forth between these (x, z), or null: stays. */
  path: [number, number, number, number] | null;
  /** Fires now and then (the muzzle flashes). */
  fires: boolean;
  nextShot: number;
}

export class MenuScene {
  private readonly renderer: Renderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly actors: Actor[] = [];
  private readonly flashes: { light: THREE.PointLight; sprite: THREE.Sprite; life: number }[] = [];
  private readonly horizon: { light: THREE.PointLight; glow: THREE.Sprite; next: number; life: number }[] = [];
  private readonly tracers: { mesh: THREE.Mesh; from: THREE.Vector3; dir: THREE.Vector3; t: number; len: number }[] = [];
  private readonly smoke: THREE.Sprite[] = [];
  private readonly fire = new THREE.PointLight(0xff7a2e, 0, 26, 1.6);
  private embers!: THREE.Points;
  private ash!: THREE.Points;
  private raf = 0;
  private last = 0;
  private acc = 0;
  time = Math.random() * LOOP;
  private disposed = false;
  private readonly mouse = new THREE.Vector2();
  private readonly look = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly puff = puffTexture();
  /** Called once the first frame is up (the menu fades it in). */
  onReady: (() => void) | null = null;

  /** The scene once its surfaces are in (a second or two). */
  static async create(host: HTMLElement, preset: QualityPreset): Promise<MenuScene> {
    const size = preset === 'low' ? 256 : 512;
    const surfaces = new SurfaceLibrary(size, 8);
    await Promise.all([surfaces.preload(['ground', 'rock', 'concrete', 'wood', 'metal', 'brick_old', 'plaster'], ASSETS), surfaces.rasterizeAhead(['grass', 'paint', 'canvas'])]);
    return new MenuScene(host, preset, surfaces);
  }

  private constructor(
    readonly host: HTMLElement,
    preset: QualityPreset,
    private readonly surfaces: SurfaceLibrary,
  ) {
    this.renderer = new Renderer(host, preset, 45);
    this.renderer.setRenderScale(preset === 'low' ? 0.7 : 0.8);
    this.camera = this.renderer.camera;
    this.camera.far = 900;
    const scene = this.renderer.scene;
    this.dusk(scene);
    scene.add(ground(surfaces));
    this.set(scene);
    this.squad(scene);
    this.particles(scene);
    this.renderer.requestShadowUpdate();
    window.addEventListener('pointermove', this.onPointer);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The sun low behind the far side: warm rim light, a hazy orange horizon, cool shadows. */
  private dusk(scene: THREE.Scene): void {
    const gl = this.renderer.gl;
    gl.toneMappingExposure = 0.5;
    scene.fog = new THREE.FogExp2(0x6b5444, 0.026);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 6), THREE.MathUtils.degToRad(-125));
    const sky = new Sky();
    sky.scale.setScalar(800);
    const u = sky.material.uniforms;
    u.turbidity!.value = 9;
    u.rayleigh!.value = 2.2;
    u.mieCoefficient!.value = 0.01;
    u.mieDirectionalG!.value = 0.88;
    if (u.cloudCoverage) u.cloudCoverage.value = 0.6;
    if (u.cloudDensity) u.cloudDensity.value = 0.55;
    u.sunPosition!.value.copy(sunDir);
    sky.material.fog = false;
    scene.add(sky);
    // Image-based light from that sky (no sun disc), so metal and gear pick up the warm horizon.
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.material = sky.material.clone();
    envSky.material.uniforms.showSunDisc!.value = 0;
    envSky.scale.setScalar(50);
    envScene.add(envSky);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.6;
    envSky.material.dispose();
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0x8890ac, 0x30261c, 0.35));
    const sun = new THREE.DirectionalLight(0xff9a5a, 3.0);
    sun.position.copy(sunDir).multiplyScalar(70);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -26;
    sc.right = 26;
    sc.top = 26;
    sc.bottom = -26;
    sc.near = 1;
    sc.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.target.position.set(-2, 0, -3);
    scene.add(sun, sun.target);
  }

  /** The nest, the wreck, the field's clutter, ruins and tree lines behind. */
  private set(scene: THREE.Scene): void {
    const fort = new FortModels(this.surfaces);
    const place = (o: THREE.Object3D, x: number, z: number, yaw = 0, sink = 0.05) => {
      o.position.set(x, heightAt(x, z) - sink, z);
      o.rotation.y = yaw;
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) m.castShadow = m.receiveShadow = true;
      });
      scene.add(o);
      return o;
    };
    // The nest the squad fights from, facing the enemy (-X): bag walls along the line.
    scene.add(
      this.sandbags([
        [1.7, -1.3, 0, 3.2, 5],
        [2.5, -3.0, -0.9, 1.3, 4],
        [2.5, 0.4, 0.9, 1.3, 4],
        [1.9, -4.5, 0.12, 2.4, 4],
        [1.6, 2.3, -0.22, 2.6, 4],
        [2.5, 4.8, -0.6, 2.0, 3],
      ]),
    );
    place(fort.build('ammo', FORT_SIZE.ammo), 6.6, 1.2, 0.4);
    place(fort.build('medical', FORT_SIZE.medical), 7.4, -2.6, -0.3);
    place(fort.build('wire', FORT_SIZE.wire), -3.4, -1.5, FACE_ENEMY);
    place(fort.build('wire', FORT_SIZE.wire), -4.2, 2.6, FACE_ENEMY + 0.2);
    place(fort.build('wire', FORT_SIZE.wire), -2.8, -5.4, FACE_ENEMY - 0.1);
    place(fort.build('hedgehog', FORT_SIZE.hedgehog), -8.5, -2.8, 0.4);
    place(fort.build('hedgehog', FORT_SIZE.hedgehog), -7.6, 3.6, 1.1);
    place(fort.build('hedgehog', FORT_SIZE.hedgehog), -11, 0.4, 0.2);

    // Burnt out: the wreck's paint and metal gone dark.
    const burnt = new THREE.MeshStandardMaterial({ color: 0x24211d, roughness: 0.92, metalness: 0.35, vertexColors: true });
    const looks = (_m: KitMaterial) => burnt;
    // The burning wreck out in the field, its fire lighting the mud round it.
    const wreck = place(kit('tankWreck', 3.6, 2.6, 7.4, looks, 3), -13, -9, 0.9, 0.25);
    wreck.rotation.z = 0.07;
    this.fire.position.set(-12.6, 2.6, -8.6);
    scene.add(this.fire);
    // A friendly tank holding back behind the line on the right.
    try {
      const tank = buildVehicleModel('tank', 'blue');
      place(tank.root, 11, -9, Math.PI * 0.62);
    } catch {
      /* the model needs something not set up here: the scene goes without it */
    }
    // Ruined houses: the enemy's village on the left, a farm behind our line.
    const brick = this.surfaces.get('brick_old');
    const plaster = this.surfaces.tinted('plaster', '#b9ad98');
    const ruins: [number, number, number, number, number, number, THREE.Material][] = [
      [-46, -18, 9, 6, 8, 0.2, brick],
      [-50, -4, 8, 7, 7, -0.15, plaster],
      [-44, 9, 10, 5, 8, 0.3, brick],
      [-30, -36, 7, 8, 6, -0.1, plaster],
      [-14, -44, 10, 6, 8, 0.15, brick],
      [6, -46, 9, 7, 7, -0.3, plaster],
      [24, -40, 8, 6, 9, 0.4, brick],
    ];
    for (const [x, z, w, h, d, yaw, mat] of ruins) {
      const g = new THREE.Group();
      // Walls with a broken top: blocks of uneven heights, a gap where a shell came through.
      const n = 5;
      for (let i = 0; i < n; i++) {
        if (i === 2) continue;
        const hh = h * (0.4 + 0.6 * Math.abs(Math.sin(i * 2.7 + x)));
        const b = new THREE.Mesh(metreUv(new THREE.BoxGeometry(w / n, hh, 0.55)), mat);
        b.position.set(-w / 2 + (i + 0.5) * (w / n), hh / 2, -d / 2);
        g.add(b);
      }
      for (const sx of [-1, 1]) {
        const hh = h * (sx < 0 ? 0.75 : 0.5);
        const side = new THREE.Mesh(metreUv(new THREE.BoxGeometry(0.55, hh, d)), mat);
        side.position.set((sx * w) / 2, hh / 2, 0);
        g.add(side);
      }
      // Rubble at the foot.
      const rubble = new THREE.Mesh(metreUv(new THREE.DodecahedronGeometry(1.4, 0)), mat);
      rubble.scale.set(2.2, 0.5, 1.4);
      rubble.position.set(0, 0.2, -d / 2 + 0.8);
      g.add(rubble);
      place(g, x, z, yaw, 0.1);
    }
    // Tree lines in the haze (the game's broadleaf trees), and shell-stripped trunks nearer in.
    const trees = createConiferKit(false, false, 'broadleaf');
    for (let i = 0; i < 70; i++) {
      const far = i < 50;
      const x = far ? -70 + i * 2.9 + Math.sin(i * 7.1) * 1.8 : -60 + Math.sin(i * 3.1) * 6;
      const z = far ? -54 - Math.abs(Math.sin(i * 3.3)) * 16 : -30 + (i - 50) * 3.2;
      const v = trees.variants[i % trees.variants.length]!;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(v.foliage, trees.foliageMaterial), new THREE.Mesh(v.trunk, trees.trunkMaterial));
      g.scale.setScalar(0.75 + Math.abs(Math.sin(i * 1.9)) * 0.5);
      place(g, x, z, i * 1.7, 0.2);
    }
    const bark = trees.trunkMaterial;
    for (const [x, z, h, lean] of [
      [-16, -16, 4.2, 0.18],
      [-6, -18, 3.0, -0.12],
      [-22, -6, 5.0, 0.25],
      [9, -19, 3.6, 0.1],
      [-18, 9, 2.6, -0.2],
    ] as const) {
      const g = new THREE.Group();
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.24, h, 7), bark);
      s.position.y = h / 2;
      s.rotation.z = lean;
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.07, h * 0.4, 5), bark);
      branch.position.set(0.25, h * 0.75, 0);
      branch.rotation.z = -0.9;
      g.add(s, branch);
      place(g, x, z);
    }
  }

  /**
   * Sandbag walls as one instanced mesh of rounded bags in staggered courses
   * (x, z of the wall's middle, turn from facing -X, length, courses).
   */
  private sandbags(walls: [number, number, number, number, number][]): THREE.InstancedMesh {
    const bag = new RoundedBoxGeometry(0.56, 0.17, 0.32, 2, 0.07);
    // A sack sags: the top pressed in a little, the ends rounder.
    const p = bag.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      if (y > 0) p.setY(i, y * (1 - 0.35 * (1 - Math.abs(x) / 0.28) ** 2 * 0.4));
    }
    bag.computeVertexNormals();
    const mat = this.surfaces.tinted('canvas', '#7d725d');
    const list: THREE.Matrix4[] = [];
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const [cx, cz, turn, len, rows] of walls) {
      const yaw = FACE_ENEMY + turn;
      // The wall runs across the facing (its local x along the line).
      const ax = Math.cos(yaw);
      const az = -Math.sin(yaw);
      const n = Math.max(2, Math.round(len / 0.55));
      for (let r = 0; r < rows; r++)
        for (let i = 0; i < n - (r % 2); i++) {
          const along = (i - (n - 1) / 2 + (r % 2) * 0.5) * 0.55 + (rnd() - 0.5) * 0.04;
          const x = cx + ax * along + (rnd() - 0.5) * 0.04;
          const z = cz + az * along + (rnd() - 0.5) * 0.04;
          const y = heightAt(x, z) + 0.07 + r * 0.155;
          e.set((rnd() - 0.5) * 0.08, yaw + (rnd() - 0.5) * 0.14, (rnd() - 0.5) * 0.08);
          q.setFromEuler(e);
          m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1 + (rnd() - 0.5) * 0.1, 1, 1));
          list.push(m.clone());
        }
    }
    const mesh = new THREE.InstancedMesh(bag, mat, list.length);
    list.forEach((x, i) => mesh.setMatrixAt(i, x));
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  /** Five soldiers: three firing over the nest, one kneeling by the ammo, one walking up the line. */
  private squad(scene: THREE.Scene): void {
    const add = (gun: WeaponId, x: number, z: number, yaw: number, crouch: number, aimPitch: number, fires: boolean, path: Actor['path'] = null) => {
      const model = new SoldierModel('blue', WEAPONS[gun]);
      scene.add(model.root);
      this.actors.push({ model, pos: new THREE.Vector3(x, heightAt(x, z) - 0.03, z), pose: { speed: 0, crouch, yaw, aimPitch, deadFor: -1, dt: 0 }, path, fires, nextShot: 0.5 + Math.random() * 2 });
    };
    add('lmg1', 2.8, -1.4, FACE_ENEMY + 0.05, 1, 0.02, true);
    add('ar1', 3.0, -3.9, FACE_ENEMY - 0.15, 0.7, 0.04, true);
    add('dmr1', 2.7, 1.8, FACE_ENEMY + 0.2, 1, 0.05, true);
    add('smg1', 6.1, 0.2, FACE_ENEMY + 0.9, 0.6, -0.12, false);
    add('ar2', 7.5, 4.5, Math.PI, 0, -0.05, false, [7.5, 4.5, 5.5, -5.5]);
  }

  /** Smoke from the wreck and the far side, embers rising, ash falling, the horizon flashing. */
  private particles(scene: THREE.Scene): void {
    for (let i = 0; i < 28; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.puff, color: 0x2a2622, transparent: true, depthWrite: false, opacity: 0, fog: true });
      const s = new THREE.Sprite(mat);
      s.layers.set(LAYER_FX);
      s.userData.seed = Math.random();
      s.userData.column = i < 18 ? 0 : 1;
      scene.add(s);
      this.smoke.push(s);
    }
    const points = (n: number, size: number, color: number, additive: boolean) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 40;
        pos[i * 3 + 1] = Math.random() * 12;
        pos[i * 3 + 2] = -Math.random() * 30 + 8;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const p = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, depthWrite: false, opacity: additive ? 0.95 : 0.55, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: !additive, toneMapped: !additive }),
      );
      p.layers.set(LAYER_FX);
      p.frustumCulled = false;
      scene.add(p);
      return p;
    };
    this.embers = points(160, 0.07, 0xffa24a, true);
    this.ash = points(260, 0.05, 0x9b9188, false);
    // The horizon: artillery and fires flashing beyond the enemy's village and the far tree line.
    for (const [x, z] of [
      [-90, -30],
      [-80, 20],
      [-50, -80],
      [-10, -85],
      [30, -80],
    ] as const) {
      const light = new THREE.PointLight(0xffa860, 0, 110, 1.2);
      light.position.set(x, 7, z);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puff, color: 0xff9a50, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, fog: false }));
      glow.scale.set(40, 16, 1);
      glow.position.copy(light.position).setY(5);
      glow.layers.set(LAYER_FX);
      scene.add(light, glow);
      this.horizon.push({ light, glow, next: 1 + Math.random() * 5, life: 0 });
    }
  }

  private onPointer = (e: PointerEvent): void => {
    this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  };

  private onVisibility = (): void => {
    this.last = performance.now();
  };

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) return;
    this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    // 30 a second is plenty for a slow camera, and half the work of 60.
    if (this.acc < 1 / FPS) return;
    const dt = this.acc;
    this.acc = 0;
    this.step(dt);
    this.renderer.render();
    if (this.onReady) {
      this.onReady();
      this.onReady = null;
    }
  };

  /** One step of everything that moves (public for dev checks: stepping it by hand). */
  step(dt: number): void {
    this.time = (this.time + dt) % LOOP;
    this.moveCamera();
    const scene = this.renderer.scene;
    // Soldiers: idle sway, a walker pacing, the gunners firing bursts.
    for (const a of this.actors) {
      const p = a.pose;
      p.dt = dt;
      if (a.path) {
        const [x0, z0, x1, z1] = a.path;
        const len = Math.hypot(x1 - x0, z1 - z0);
        const t = ((this.time * 1.2) / len) % 2;
        const k = t < 1 ? t : 2 - t;
        a.pos.set(x0 + (x1 - x0) * k, 0, z0 + (z1 - z0) * k);
        a.pos.y = heightAt(a.pos.x, a.pos.z) - 0.03;
        p.speed = 1.2;
        const dir = t < 1 ? 1 : -1;
        p.yaw = Math.atan2(-(x1 - x0) * dir, -(z1 - z0) * dir);
      } else p.aimPitch += Math.sin(this.time * 0.7 + a.pos.z) * 0.0004;
      a.model.update(a.pos, p);
      if (!a.fires) continue;
      a.nextShot -= dt;
      if (a.nextShot <= 0) {
        this.muzzleFlash(a, scene);
        // Short bursts with pauses (a lone flash every few seconds reads as a misfire).
        a.nextShot = Math.random() < 0.7 ? 0.09 + Math.random() * 0.05 : 1.2 + Math.random() * 3;
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.life -= dt;
      f.light.intensity = Math.max(0, f.life / 0.06) * 6;
      (f.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, f.life / 0.06);
      if (f.life <= 0) {
        scene.remove(f.light, f.sprite);
        f.sprite.material.dispose();
        this.flashes.splice(i, 1);
      }
    }
    // The wreck's fire flickers.
    this.fire.intensity = 10 + Math.sin(this.time * 13) * 2 + Math.sin(this.time * 31) * 1.5 + Math.random() * 1.5;
    this.stepSmoke(dt);
    this.stepPoints(this.embers, dt, 1.1, 0.35, true);
    this.stepPoints(this.ash, dt, -0.25, 0.2, false);
    this.stepHorizon(dt);
    this.stepTracers(dt, scene);
  }

  private moveCamera(): void {
    let t = this.time;
    let i = 0;
    while (t > SHOTS[i]!.sec) t -= SHOTS[i++]!.sec;
    const s = SHOTS[i]!;
    const n = SHOTS[(i + 1) % SHOTS.length]!;
    const k = t / s.sec;
    const pos = v3(s.from).lerp(v3(s.to), smooth(k));
    const look = v3(s.look).lerp(v3(s.lookTo), smooth(k));
    let fov = s.fov;
    // The end of a shot eases into the next one's start (no cuts in a menu).
    const into = (t - (s.sec - BLEND)) / BLEND;
    if (into > 0) {
      const b = smooth(Math.min(1, into));
      pos.lerp(v3(n.from), b);
      look.lerp(v3(n.look), b);
      fov += (n.fov - fov) * b;
    }
    // Held by hand, a little; and the pointer leans the view.
    const sway = this.time;
    pos.x += Math.sin(sway * 0.53) * 0.04 + this.mouse.x * 0.25;
    pos.y += Math.sin(sway * 0.71) * 0.03 - this.mouse.y * 0.12;
    this.look.lerp(look, this.look.lengthSq() === 0 ? 1 : 0.08);
    this.camera.position.copy(pos);
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private muzzleFlash(a: Actor, scene: THREE.Scene): void {
    const at = a.model.muzzleWorld(this.tmp);
    const light = new THREE.PointLight(0xffc27a, 6, 6, 2);
    light.position.copy(at);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puff, color: 0xffd08a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sprite.scale.setScalar(0.45 + Math.random() * 0.25);
    sprite.position.copy(at);
    sprite.layers.set(LAYER_FX);
    scene.add(light, sprite);
    this.flashes.push({ light, sprite, life: 0.06 });
    // A tracer now and then out across the field, along the gun.
    if (Math.random() < 0.35) {
      const yaw = a.pose.yaw;
      const dir = new THREE.Vector3(-Math.sin(yaw), 0.01 + Math.random() * 0.02, -Math.cos(yaw));
      dir.z += (Math.random() - 0.5) * 0.06;
      this.tracer(at.clone(), dir.normalize(), scene, 0xffc070);
    }
  }

  private tracer(from: THREE.Vector3, dir: THREE.Vector3, scene: THREE.Scene, color: number): void {
    const len = 2.4;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 4), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    mesh.layers.set(LAYER_FX);
    scene.add(mesh);
    this.tracers.push({ mesh, from, dir, t: 0, len });
  }

  private stepTracers(dt: number, scene: THREE.Scene): void {
    // The enemy firing back now and then from the left (red), our other positions far right (green).
    if (Math.random() < dt * 1.6) {
      const enemy = Math.random() < 0.6;
      const from = enemy ? new THREE.Vector3(-55, 1.5 + Math.random() * 3, -20 + Math.random() * 30) : new THREE.Vector3(40, 1.5 + Math.random() * 3, -40 + Math.random() * 20);
      const to = enemy ? new THREE.Vector3(30, 1 + Math.random() * 4, -30 + Math.random() * 20) : new THREE.Vector3(-55, 2 + Math.random() * 4, -35 + Math.random() * 20);
      const dir = to.sub(from).normalize();
      for (let i = 0; i < 3; i++) this.tracer(from.clone().addScaledVector(dir, -i * 5), dir.clone(), scene, enemy ? 0xff5040 : 0x9dff7a);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]!;
      tr.t += dt;
      tr.mesh.position.copy(tr.from).addScaledVector(tr.dir, tr.t * 320 + tr.len / 2);
      if (tr.t > 0.45) {
        scene.remove(tr.mesh);
        tr.mesh.geometry.dispose();
        (tr.mesh.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  private stepSmoke(dt: number): void {
    const t = this.time;
    const bases = [new THREE.Vector3(-12.6, 2.4, -9), new THREE.Vector3(-44, 2, -12)];
    for (const s of this.smoke) {
      const seed = s.userData.seed as number;
      const col = s.userData.column as number;
      // Each puff rises over 9 s, growing, drifting with the wind, then starts again at the base.
      const life = (((t / 9 + seed) % 1) + 1) % 1;
      const base = bases[col]!;
      const rise = life * (col === 0 ? 14 : 12);
      s.position.set(base.x + rise * 0.55 + Math.sin(seed * 20 + t * 0.4) * 0.6, base.y + rise, base.z - rise * 0.15);
      const size = (col === 0 ? 2.4 : 4) + life * (col === 0 ? 9 : 12);
      s.scale.set(size, size, 1);
      const m = s.material as THREE.SpriteMaterial;
      m.opacity = Math.min(1, life * 6) * (1 - life) * (col === 0 ? 0.85 : 0.55);
      // Lit from below by the fire near the base.
      m.color.setHex(col === 0 && life < 0.2 ? 0x5a3a26 : 0x2a2622);
      m.rotation += dt * 0.05 * (seed - 0.5);
    }
  }

  private stepPoints(p: THREE.Points, dt: number, rise: number, drift: number, flicker: boolean): void {
    const pos = p.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      let x = a[i * 3]! + (drift + Math.sin(this.time + i) * 0.3) * dt;
      let y = a[i * 3 + 1]! + rise * dt * (0.6 + ((i * 37) % 10) / 10);
      // Wrapped round the view box.
      if (x > 20) x -= 40;
      if (y > 12) y = 0;
      if (y < 0) y = 12;
      a[i * 3] = x;
      a[i * 3 + 1] = y;
      a[i * 3 + 2] = a[i * 3 + 2]! + Math.cos(this.time * 0.5 + i) * 0.2 * dt;
    }
    pos.needsUpdate = true;
    if (flicker) (p.material as THREE.PointsMaterial).opacity = 0.75 + Math.sin(this.time * 9) * 0.2;
  }

  private stepHorizon(dt: number): void {
    for (const h of this.horizon) {
      h.next -= dt;
      if (h.next <= 0) {
        h.life = 0.35 + Math.random() * 0.3;
        h.next = 1.5 + Math.random() * 6;
      }
      h.life = Math.max(0, h.life - dt);
      const k = h.life > 0 ? Math.min(1, h.life / 0.25) : 0;
      h.light.intensity = k * 70;
      (h.glow.material as THREE.SpriteMaterial).opacity = k * 0.55;
    }
  }

  /** Draws a frame now (dev checks with the page in the background). */
  render(): void {
    this.renderer.render();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.canvas;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointermove', this.onPointer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const a of this.actors) a.model.dispose();
    this.renderer.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.puff.dispose();
    this.renderer.scene.environment?.dispose();
    this.renderer.dispose();
  }
}
