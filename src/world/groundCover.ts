import * as THREE from 'three';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { ImpactSurface, SurfaceRegistry } from '@/physics/surfaces';
import { makeRng } from '@/render/noise';

/**
 * Grass tufts on open ground near the camera: crossed alpha cards with a
 * painted blade texture that sway in the wind. Spots are found once at load
 * (on the bare terrain only: not on roads, floors or in water) and kept in
 * cells; each frame only the cells around the camera go into one instanced
 * mesh, so a whole meadow costs one draw call and a few hundred instances.
 */

export interface GroundCoverStyle {
  /** Tufts per square metre of open ground. */
  density: number;
  /** Blade colours, base to tip (sRGB hex). */
  base: number;
  tip: number;
  /** Tuft height range (m). */
  height: [number, number];
}

/** Per ground kind; kinds without an entry get no cover. */
export const GROUND_COVER: Partial<Record<string, GroundCoverStyle>> = {
  grass: { density: 0.55, base: 0x34461d, tip: 0x7d8a44, height: [0.35, 0.65] },
  ground: { density: 0.12, base: 0x4a5428, tip: 0x9c9a5c, height: [0.25, 0.5] },
  sand: { density: 0.05, base: 0x7d6a42, tip: 0xcdb27a, height: [0.25, 0.45] },
};

/** Cell side (m) and how far around the camera tufts are drawn (m). */
const CELL = 12;
const RANGE = 38;
/** Time per frame spent finding tuft spots until the map is covered (ms). */
const FILL_BUDGET_MS = 2.5;

function bladeTexture(base: THREE.Color, tip: THREE.Color): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const rng = makeRng(23);
  for (let i = 0; i < 46; i++) {
    const x0 = 10 + rng() * 108;
    const lean = (rng() - 0.5) * 50;
    const h = 60 + rng() * 66;
    const w = 2.5 + rng() * 3;
    const g = ctx.createLinearGradient(0, 128, 0, 128 - h);
    const shade = 0.75 + rng() * 0.35;
    g.addColorStop(0, `#${base.clone().multiplyScalar(shade).getHexString()}`);
    g.addColorStop(1, `#${tip.clone().multiplyScalar(shade).getHexString()}`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 - w, 128);
    ctx.quadraticCurveTo(x0 + lean * 0.3, 128 - h * 0.6, x0 + lean, 128 - h);
    ctx.quadraticCurveTo(x0 + lean * 0.3 + w * 0.5, 128 - h * 0.6, x0 + w, 128);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Three cards crossed at 60°, 1 m wide and tall, standing on y = 0. */
function tuftGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0);
    g.rotateY((i * Math.PI) / 3);
    parts.push(g);
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3;
    const p = g.getAttribute('position');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      uv.push(u.getX(i), u.getY(i));
      // Upward normals: lit like the ground they stand on, never dark on one side.
      nor.push(0, 1, 0);
    }
    for (const i of g.index!.array) idx.push(base + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}

export class GroundCover {
  readonly mesh: THREE.InstancedMesh;
  /** Tuft transforms (16 floats each) by cell key. */
  private readonly cells = new Map<number, Float32Array>();
  private readonly time = { value: 0 };
  private lastCell = Number.NaN;
  private readonly capacity: number;
  /** Cells still to fill, nearest the camera first once known; filled a few at a time (see update). */
  private todo: { x: number; z: number }[] | null = null;
  private readonly fill: (cx: number, cz: number) => void;

  constructor(
    style: GroundCoverStyle,
    bounds: [number, number, number, number],
    physics: PhysicsWorld,
    impacts: SurfaceRegistry,
    groundHandle: number,
    groundSurface: ImpactSurface,
    skip: (x: number, y: number, z: number) => boolean,
    alphaToCoverage: boolean,
  ) {
    const [minX, minZ, maxX, maxZ] = bounds;
    this.todo = [];
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++)
        this.todo.push({ x: cx, z: cz });
    this.fill = (cx, cz) =>
      this.fillCell(
        cx,
        cz,
        style,
        physics,
        impacts.patchesOf(groundHandle),
        groundHandle,
        impacts,
        groundSurface,
        skip,
      );
    // Enough for the busiest neighbourhood of cells.
    const reach = Math.ceil(RANGE / CELL);
    this.capacity = Math.ceil((2 * reach + 1) ** 2 * CELL * CELL * style.density * 1.3);
    this.mesh = new THREE.InstancedMesh(
      tuftGeometry(),
      coverMaterial(style, alphaToCoverage, this.time),
      Math.max(1, this.capacity),
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'ground-cover';
    this.mesh.receiveShadow = true;
  }

  /** Tufts of one cell: open terrain only (a ray down must hit the ground first, not a road, floor or rock, and no water). */
  private fillCell(
    cx: number,
    cz: number,
    style: GroundCoverStyle,
    physics: PhysicsWorld,
    patches: readonly Readonly<{ x: number; z: number; hw: number; hd: number }>[],
    groundHandle: number,
    impacts: SurfaceRegistry,
    groundSurface: ImpactSurface,
    skip: (x: number, y: number, z: number) => boolean,
  ): void {
    const rng = makeRng((cx * 73856093) ^ (cz * 19349663));
    const x0 = cx * CELL;
    const z0 = cz * CELL;
    // Only painted patches that reach this cell need the exact surface test.
    const near = patches.some(
      (p) =>
        Math.abs(p.x - (x0 + CELL / 2)) < CELL / 2 + p.hw + p.hd &&
        Math.abs(p.z - (z0 + CELL / 2)) < CELL / 2 + p.hw + p.hd,
    );
    const step = 1 / Math.sqrt(style.density);
    const out: number[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const down = { x: 0, y: -1, z: 0 };
    for (let x = x0; x < x0 + CELL; x += step) {
      for (let z = z0; z < z0 + CELL; z += step) {
        const px = x + rng() * step;
        const pz = z + rng() * step;
        const hit = physics.raycast({ x: px, y: 400, z: pz }, down, 800, Layer.WORLD);
        if (!hit || hit.collider.handle !== groundHandle) continue;
        if (near && impacts.get(groundHandle, { x: px, z: pz }) !== groundSurface) continue;
        const y = hit.point.y;
        if (skip(px, y, pz)) continue;
        const h = style.height[0] + rng() * (style.height[1] - style.height[0]);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng() * Math.PI * 2);
        s.set(h * (1.1 + rng() * 0.6), h, h * (1.1 + rng() * 0.6));
        m.compose(p.set(px, y - 0.04, pz), q, s);
        for (const e of m.elements) out.push(e);
      }
    }
    if (out.length) this.cells.set((cx + 32768) * 65536 + (cz + 32768), new Float32Array(out));
  }

  /** Total tufts placed (tests / perf panel). */
  get placed(): number {
    let n = 0;
    for (const c of this.cells.values()) n += c.length / 16;
    return n;
  }

  /** Refills the instances from the cells around the camera when it moves to another cell. */
  update(camera: THREE.Vector3, time: number): void {
    this.time.value = time;
    if (this.todo) {
      // Fill cells nearest the camera first, a few milliseconds' worth a frame.
      if (!this.todo.length) this.todo = null;
      else {
        const cx = camera.x / CELL - 0.5;
        const cz = camera.z / CELL - 0.5;
        this.todo.sort(
          (a, b) => (b.x - cx) ** 2 + (b.z - cz) ** 2 - ((a.x - cx) ** 2 + (a.z - cz) ** 2),
        );
        const t0 = performance.now();
        while (this.todo.length && performance.now() - t0 < FILL_BUDGET_MS) {
          const c = this.todo.pop()!;
          this.fill(c.x, c.z);
        }
        this.lastCell = Number.NaN;
      }
    }
    const key = cellKey(camera.x, camera.z);
    if (key === this.lastCell) return;
    this.lastCell = key;
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    const reach = Math.ceil(RANGE / CELL);
    const cx = Math.floor(camera.x / CELL);
    const cz = Math.floor(camera.z / CELL);
    let n = 0;
    for (let i = -reach; i <= reach; i++) {
      for (let j = -reach; j <= reach; j++) {
        const cell = this.cells.get((cx + i + 32768) * 65536 + (cz + j + 32768));
        if (!cell) continue;
        const room = Math.min(cell.length / 16, this.capacity - n);
        if (room <= 0) break;
        arr.set(room * 16 === cell.length ? cell : cell.subarray(0, room * 16), n * 16);
        n += room;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function coverMaterial(
  style: GroundCoverStyle,
  alphaToCoverage: boolean,
  time: { value: number },
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: bladeTexture(new THREE.Color(style.base), new THREE.Color(style.tip)),
    // Darker than the painted blades: lit from straight above they otherwise read paler than the ground.
    color: new THREE.Color(0.8, 0.8, 0.8),
    envMapIntensity: 0.5,
    alphaTest: 0.45,
    alphaToCoverage,
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uRange = { value: RANGE };
    // Both sides of a card light like its front (straight-up normals): no pale backs.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uRange;',
      )
      .replace(
        '#include <project_vertex>',
        `vec4 tuftOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          // Shrink toward the edge of the drawn range so tufts grow in rather than pop.
          float fade = 1.0 - smoothstep(uRange * 0.7, uRange, distance(tuftOrigin.xz, cameraPosition.xz));
          transformed *= fade;
          // Wind: tips sway, roots stay put.
          float sway = sin(uTime * 1.7 + tuftOrigin.x * 0.31 + tuftOrigin.z * 0.23) * 0.08 + sin(uTime * 3.1 + tuftOrigin.z * 0.7) * 0.03;
          transformed.x += sway * position.y;
          transformed.z += sway * 0.6 * position.y;
          #include <project_vertex>`,
      );
  };
  mat.customProgramCacheKey = () => 'groundcover';
  return mat;
}

function cellKey(x: number, z: number): number {
  return (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(z / CELL) + 32768);
}
