/**
 * The main menu's background (owner, 2026-10-24: "a light real-time 3D scene"
 * instead of the recorded film): a small hand-set diorama, not a match. Dusk
 * over a shelled field: a squad behind a sandbag nest on the right (the menu
 * sits on the left), a burning tank wreck and its smoke in the middle, ruins
 * and tree lines fading into the haze, artillery flashing on the horizon,
 * tracers crossing far off, embers and ash drifting through. A camera moves
 * slowly along it. Nothing simulates: no physics, map, navmesh or bots; the
 * game's own procedural models and renderer (its grade and, where the preset
 * has them, bloom and AO), drawn at 30 frames a second at most and paused
 * while the tab is hidden. Loaded as its own chunk after the menu paints.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Renderer } from '@/render/Renderer';
import { LAYER_FX } from '@/render/layers';
import { SoldierModel, type SoldierPose } from '@/ai/SoldierModel';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import { FortModels, FORT_SIZE } from '@/world/fortModels';
import { buildKit, kitMaterials, type KitMaterial } from '@/world/modelKits';
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

/** A slow loop of four shots, each easing into the next (the squad, the wreck, the line, the nest again). */
const SHOTS: readonly Shot[] = [
  { from: [-3.6, 1.35, 6.8], to: [-2.2, 1.45, 5.6], look: [2.4, 0.9, -1.5], lookTo: [2.8, 0.9, -2.4], fov: 46, sec: 16 },
  { from: [-1.5, 1.9, 4.2], to: [0.6, 2.1, 3.9], look: [-6, 1.6, -22], lookTo: [-3, 1.8, -24], fov: 40, sec: 14 },
  { from: [6.5, 0.75, 3.6], to: [5.2, 0.8, 2.4], look: [-1.5, 1.0, -6], lookTo: [-3.5, 1.2, -9], fov: 50, sec: 14 },
  { from: [-4.4, 2.6, 9.5], to: [-3.6, 1.6, 7.4], look: [1.6, 0.8, -1.0], lookTo: [2.4, 0.9, -1.5], fov: 44, sec: 12 },
];
const LOOP = SHOTS.reduce((a, s) => a + s.sec, 0);
/** Seconds a shot's end blends into the next one's start. */
const BLEND = 3;
const FPS = 30;

const smooth = (t: number) => t * t * (3 - 2 * t);
const v3 = (a: [number, number, number]) => new THREE.Vector3(...a);

/** A soft round puff, white, for smoke and dust (drawn on a canvas once). */
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

/** Plain looks for kit pieces (the map's textured surfaces aren't loaded here). */
function kitLooks(): (m: KitMaterial) => THREE.Material {
  const shared = kitMaterials() as Record<string, THREE.Material>;
  const plain: Record<string, THREE.Material> = {
    body: new THREE.MeshStandardMaterial({ color: 0x2b2a24, roughness: 0.92, metalness: 0.2, vertexColors: true }),
    trim: new THREE.MeshStandardMaterial({ color: 0x1f1d19, roughness: 0.9, metalness: 0.25, vertexColors: true }),
    metal: new THREE.MeshStandardMaterial({ color: 0x3a3631, roughness: 0.75, metalness: 0.5, vertexColors: true }),
    wood: new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9, vertexColors: true }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 0.95, vertexColors: true }),
    dirt: new THREE.MeshStandardMaterial({ color: 0x4d4234, roughness: 1, vertexColors: true }),
  };
  return (m) => plain[m] ?? shared[m] ?? plain.metal!;
}

/** A kit model (`modelKits.ts`) as meshes with plain looks, standing on y = 0. */
function kit(kind: Parameters<typeof buildKit>[0], w: number, h: number, d: number, looks: (m: KitMaterial) => THREE.Material, seed = 7): THREE.Group {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const g = new THREE.Group();
  for (const p of buildKit(kind, w, h, d, rand).pieces) {
    const geo = p.geo;
    if (!geo.getAttribute('color')) {
      const n = geo.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      const tint = new THREE.Color(p.tint ?? '#ffffff');
      for (let i = 0; i < n; i++) tint.toArray(col, i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const mesh = new THREE.Mesh(geo, looks(p.mat));
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

/** Ground: a gently rolling field with shell holes and mud, darker toward the line (vertex colours, no textures). */
function ground(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(260, 260, 220, 220);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const craters: [number, number, number][] = [
    [-5, -9, 3.2],
    [3, -14, 2.4],
    [-11, -4, 2.6],
    [9, -26, 4],
    [-16, -30, 3.5],
    [1, 6, 1.8],
  ];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let y = Math.sin(x * 0.07) * 0.5 + Math.cos(z * 0.05 + 1.3) * 0.6 + Math.sin((x + z) * 0.21) * 0.12 + Math.sin(x * 1.3) * Math.cos(z * 1.1) * 0.04;
    // The far field rises a little into the haze (a horizon, not a cliff).
    if (z < -40) y += (-40 - z) * 0.03;
    let mud = 0;
    for (const [cx, cz, r] of craters) {
      const d = Math.hypot(x - cx, z - cz) / r;
      if (d < 1.4) {
        y += d < 1 ? -0.9 * (1 - d * d) : 0.25 * (1.4 - d) * 2.5;
        mud = Math.max(mud, 1 - d / 1.4);
      }
    }
    pos.setY(i, y);
    const n = Math.sin(x * 0.9 + Math.cos(z * 0.7) * 2) * 0.5 + 0.5;
    // Trampled grass and earth, burnt to mud round the holes.
    c.setRGB(0.2 + n * 0.06, 0.19 + n * 0.07, 0.12 + n * 0.03);
    c.lerp(new THREE.Color(0.11, 0.09, 0.07), Math.min(1, mud * 1.4));
    c.toArray(col, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  mesh.receiveShadow = true;
  return mesh;
}

/** The ground's height under (x, z) (the same sum as `ground`, craters aside: props sit a hair into it). */
const groundY = (x: number, z: number) => Math.sin(x * 0.07) * 0.5 + Math.cos(z * 0.05 + 1.3) * 0.6 + Math.sin((x + z) * 0.21) * 0.12;

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
  private readonly fire: THREE.PointLight;
  private embers!: THREE.Points;
  private ash!: THREE.Points;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private time = Math.random() * LOOP;
  private disposed = false;
  private readonly mouse = new THREE.Vector2();
  private readonly look = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly puff = puffTexture();
  /** Called once the first frame is up (the menu fades it in). */
  onReady: (() => void) | null = null;

  constructor(
    readonly host: HTMLElement,
    preset: QualityPreset,
  ) {
    this.renderer = new Renderer(host, preset, 45);
    this.renderer.setRenderScale(preset === 'low' ? 0.7 : 0.8);
    this.camera = this.renderer.camera;
    this.camera.far = 900;
    const scene = this.renderer.scene;
    this.dusk(scene);
    scene.add(ground());
    this.fire = new THREE.PointLight(0xff7a2e, 0, 22, 1.6);
    this.set(scene);
    this.squad(scene);
    this.particles(scene);
    this.renderer.requestShadowUpdate();
    window.addEventListener('pointermove', this.onPointer);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Low sun through haze: warm key, cool fill, brown-grey fog, a sky that fades to the horizon glow. */
  private dusk(scene: THREE.Scene): void {
    const gl = this.renderer.gl;
    gl.toneMappingExposure = 0.55;
    scene.fog = new THREE.FogExp2(0x6c5b4c, 0.018);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 5), THREE.MathUtils.degToRad(-115));
    const sky = new Sky();
    sky.scale.setScalar(800);
    const u = sky.material.uniforms;
    u.turbidity!.value = 12;
    u.rayleigh!.value = 2.4;
    u.mieCoefficient!.value = 0.012;
    u.mieDirectionalG!.value = 0.86;
    if (u.cloudCoverage) u.cloudCoverage.value = 0.55;
    if (u.cloudDensity) u.cloudDensity.value = 0.6;
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
    scene.environmentIntensity = 0.55;
    envSky.material.dispose();
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0x8a90a8, 0x2d241a, 0.35));
    const sun = new THREE.DirectionalLight(0xffb27a, 2.6);
    sun.position.copy(sunDir).multiplyScalar(60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -22;
    sc.right = 22;
    sc.top = 22;
    sc.bottom = -22;
    sc.near = 1;
    sc.far = 140;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.target.position.set(0, 0, -6);
    scene.add(sun, sun.target);
  }

  /** The nest, the wreck, the line of ruins and trees behind. */
  private set(scene: THREE.Scene): void {
    const fort = new FortModels(null);
    const place = (o: THREE.Object3D, x: number, z: number, yaw = 0) => {
      o.position.set(x, groundY(x, z) - 0.05, z);
      o.rotation.y = yaw;
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) m.castShadow = m.receiveShadow = true;
      });
      scene.add(o);
      return o;
    };
    // The nest the squad fights from (front right), facing the enemy (-Z).
    place(fort.build('nest', FORT_SIZE.nest), 2.6, -1.6, 0.15);
    place(fort.build('sandbag', FORT_SIZE.sandbag), 5.4, -1.2, -0.3);
    place(fort.build('sandbagLow', FORT_SIZE.sandbagLow), -0.4, -1.9, 0.35);
    place(fort.build('ammo', FORT_SIZE.ammo), 4.6, 1.2, 0.9);
    place(fort.build('wire', FORT_SIZE.wire), 1.5, -6.5, 0.1);
    place(fort.build('wire', FORT_SIZE.wire), -2.4, -7.2, -0.2);
    place(fort.build('hedgehog', FORT_SIZE.hedgehog), 6.8, -8.5, 0.4);
    place(fort.build('hedgehog', FORT_SIZE.hedgehog), -6.5, -10, 1.1);

    const looks = kitLooks();
    // The burning wreck mid-field, its fire lighting the mud round it.
    const wreck = place(kit('tankWreck', 3.6, 2.6, 7.4, looks, 3), -4.5, -14, 0.7);
    wreck.rotation.z = 0.06;
    this.fire.position.set(-4.3, 2.4, -13.6);
    scene.add(this.fire);
    // A friendly tank holding back on the left, dark against the glow.
    try {
      const tank = buildVehicleModel('tank', 'blue');
      place(tank.root, -9.5, -4.5, 2.6);
    } catch {
      /* the model needs something not loaded here: the scene goes without it */
    }
    // The ruined edge of a village along the far side.
    const ruins: [number, number, number, number, number, number][] = [
      [-18, -38, 9, 6, 7, 0.2],
      [-7, -42, 7, 8, 6, -0.1],
      [6, -40, 10, 5, 8, 0.15],
      [19, -36, 8, 7, 6, -0.3],
      [31, -44, 9, 9, 7, 0.4],
      [-30, -46, 11, 7, 8, 0.1],
    ];
    const wall = new THREE.MeshStandardMaterial({ color: 0x5d5850, roughness: 0.95 });
    for (const [x, z, w, h, d, yaw] of ruins) {
      const g = new THREE.Group();
      // Walls with a broken top: boxes of uneven heights, a gap for the shelled side.
      const n = 5;
      for (let i = 0; i < n; i++) {
        if (i === 2) continue;
        const hh = h * (0.45 + 0.55 * Math.abs(Math.sin(i * 2.7 + x)));
        const b = new THREE.Mesh(new THREE.BoxGeometry(w / n, hh, 0.5), wall);
        b.position.set(-w / 2 + (i + 0.5) * (w / n), hh / 2, -d / 2);
        g.add(b);
      }
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.5, h * 0.7, d), wall);
      side.position.set(-w / 2, h * 0.35, 0);
      g.add(side);
      place(g, x, z, yaw);
    }
    // Tree lines in the haze: dark broken trunks and a few crowns.
    const bark = new THREE.MeshStandardMaterial({ color: 0x241d16, roughness: 1 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x252b1c, roughness: 1 });
    for (let i = 0; i < 46; i++) {
      const x = -60 + i * 2.7 + Math.sin(i * 7.1) * 1.5;
      const z = -52 - Math.abs(Math.sin(i * 3.3)) * 14;
      const h = 4 + Math.abs(Math.sin(i * 1.9)) * 6;
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, h, 6), bark);
      trunk.position.y = h / 2;
      trunk.rotation.z = Math.sin(i * 5.3) * 0.12;
      g.add(trunk);
      if (i % 3 !== 0) {
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6 + Math.abs(Math.sin(i)) * 1.2, 0), leaf);
        crown.position.y = h;
        crown.scale.y = 1.3;
        g.add(crown);
      }
      place(g, x, z);
    }
    // Shell-blasted stumps nearer in.
    for (const [x, z, h] of [
      [-12, -18, 3.2],
      [9, -16, 2.4],
      [14, -24, 4.1],
      [-2, -27, 2.8],
    ] as const) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, h, 6), bark);
      s.position.y = h / 2;
      s.rotation.z = 0.2;
      const g = new THREE.Group();
      g.add(s);
      place(g, x, z);
    }
  }

  /** Five soldiers: two firing over the nest, one kneeling behind it, one by the ammo, one walking up the line. */
  private squad(scene: THREE.Scene): void {
    const add = (gun: WeaponId, x: number, z: number, yaw: number, crouch: number, aimPitch: number, fires: boolean, path: Actor['path'] = null) => {
      const model = new SoldierModel('blue', WEAPONS[gun]);
      scene.add(model.root);
      this.actors.push({ model, pos: new THREE.Vector3(x, groundY(x, z) - 0.03, z), pose: { speed: 0, crouch, yaw, aimPitch, deadFor: -1, dt: 0 }, path, fires, nextShot: 0.5 + Math.random() * 2 });
    };
    add('lmg1', 2.0, -0.6, 0.05, 1, 0.02, true);
    add('ar1', 3.4, -0.4, -0.2, 0.75, 0.04, true);
    add('dmr1', 5.6, -0.2, -0.35, 1, 0.06, true);
    add('smg1', 4.2, 1.9, 2.4, 0.6, -0.15, false);
    add('ar2', -1, 2, Math.PI - 0.2, 0, -0.05, false, [-1.5, 3.5, -2.5, -4.5]);
  }

  /** Smoke from the wreck and the field, embers rising, ash falling. */
  private particles(scene: THREE.Scene): void {
    for (let i = 0; i < 26; i++) {
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
        pos[i * 3 + 2] = -Math.random() * 30 + 6;
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
    // The horizon: artillery and fires flashing behind the tree line.
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffa860, 0, 90, 1.2);
      light.position.set(-40 + i * 26, 6, -70 - (i % 2) * 15);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puff, color: 0xff9a50, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, fog: false }));
      glow.scale.set(38, 16, 1);
      glow.position.copy(light.position).setY(4);
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

  private step(dt: number): void {
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
        a.pos.y = groundY(a.pos.x, a.pos.z) - 0.03;
        p.speed = 1.2;
        p.yaw = Math.atan2(-(x1 - x0) * (t < 1 ? 1 : -1), -(z1 - z0) * (t < 1 ? 1 : -1));
      } else p.aimPitch += Math.sin(this.time * 0.7 + a.pos.x) * 0.0004;
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
    this.fire.intensity = 9 + Math.sin(this.time * 13) * 2 + Math.sin(this.time * 31) * 1.5 + Math.random() * 1.5;
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
    // A tracer now and then from the nest out across the field.
    if (Math.random() < 0.35) {
      const dir = new THREE.Vector3(Math.sin(-a.pose.yaw) * -1, 0.01 + Math.random() * 0.02, -Math.cos(a.pose.yaw)).normalize();
      dir.x += (Math.random() - 0.5) * 0.05;
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
    // Far-off fire crossing the line now and then (red one way, green the other).
    if (Math.random() < dt * 1.6) {
      const left = Math.random() < 0.5;
      const from = new THREE.Vector3(left ? -40 : 40, 1.5 + Math.random() * 4, -30 - Math.random() * 25);
      const dir = new THREE.Vector3(left ? 1 : -1, 0.02 + Math.random() * 0.05, (Math.random() - 0.5) * 0.3).normalize();
      for (let i = 0; i < 3; i++) this.tracer(from.clone().addScaledVector(dir, -i * 5), dir.clone(), scene, left ? 0xff5040 : 0x9dff7a);
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
    for (const s of this.smoke) {
      const seed = s.userData.seed as number;
      const col = s.userData.column as number;
      // Each puff rises over 9 s, growing, drifting with the wind, then starts again at the base.
      const life = ((t / 9 + seed) % 1 + 1) % 1;
      const base = col === 0 ? new THREE.Vector3(-4.3, 2.2, -13.8) : new THREE.Vector3(14, 0.5, -30);
      const rise = life * (col === 0 ? 14 : 9);
      s.position.set(base.x + rise * 0.55 + Math.sin(seed * 20 + t * 0.4) * 0.6, base.y + rise, base.z - rise * 0.15);
      const size = (col === 0 ? 2.4 : 3.2) + life * (col === 0 ? 9 : 10);
      s.scale.set(size, size, 1);
      const m = s.material as THREE.SpriteMaterial;
      m.opacity = Math.min(1, life * 6) * (1 - life) * (col === 0 ? 0.85 : 0.5);
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
      h.light.intensity = k * 60;
      (h.glow.material as THREE.SpriteMaterial).opacity = k * 0.55;
    }
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
