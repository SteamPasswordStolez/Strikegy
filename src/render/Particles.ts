import * as THREE from 'three';
import { TileNoise } from './noise';
import { LAYER_FX } from './layers';

export interface ParticleSpawn {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life: number;
  size: number;
  /** Size at end of life (defaults to `size`). */
  endSize?: number;
  color: THREE.ColorRepresentation;
  alpha?: number;
  /** Seconds to fade in (smoke); default 0. */
  fadeIn?: number;
  gravity?: number;
  /** Velocity damping per second (0 = none). */
  drag?: number;
  rotSpeed?: number;
  /** Stop at this height instead of falling through the ground. */
  floorY?: number;
}

interface Slot {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size0: number;
  size1: number;
  color: THREE.Color;
  alpha: number;
  fadeIn: number;
  gravity: number;
  drag: number;
  rot: number;
  rotSpeed: number;
  floorY: number;
}

const VERTEX = /* glsl */ `
  attribute vec3 iOffset;
  attribute float iSize;
  attribute vec4 iColor;
  attribute float iRot;
  varying vec2 vUv;
  varying vec4 vColor;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vColor = iColor;
    vec4 mvPosition = modelViewMatrix * vec4(iOffset, 1.0);
    float c = cos(iRot);
    float s = sin(iRot);
    mvPosition.xy += mat2(c, -s, s, c) * position.xy * iSize;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec4 vColor;
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(uMap, vUv);
    gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
    if (gl_FragColor.a < 0.004) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

function puffTexture(): THREE.Texture {
  const size = 128;
  const n = new TileNoise(314);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const falloff = Math.max(0, 1 - d);
      const billow = 0.55 + 0.45 * n.fbm(u, v, 4, 4);
      const a = Math.min(1, Math.pow(falloff, 1.5) * 2.2 * billow);
      const p = (y * size + x) * 4;
      const shade = 200 + 55 * billow;
      data[p] = data[p + 1] = data[p + 2] = shade;
      data[p + 3] = a * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function glowTexture(): THREE.Texture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const a = Math.pow(Math.max(0, 1 - d), 2.2);
      const p = (y * size + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = 255;
      data[p + 3] = a * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/**
 * CPU-simulated, GPU-instanced camera-facing quads. One layer per blend mode.
 * Unlike THREE.Points there is no size cap, so smoke still works up close.
 */
export class ParticleLayer {
  private readonly slots: Slot[] = [];
  private readonly mesh: THREE.Mesh;
  private readonly offsets: Float32Array;
  private readonly sizes: Float32Array;
  private readonly colors: Float32Array;
  private readonly rots: Float32Array;
  private readonly geo: THREE.InstancedBufferGeometry;
  private cursor = 0;
  private liveCount = 0;

  constructor(
    scene: THREE.Scene,
    private readonly capacity: number,
    additive: boolean,
  ) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.offsets = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.colors = new Float32Array(capacity * 4);
    this.rots = new Float32Array(capacity);
    const attr = (arr: Float32Array, n: number) => {
      const a = new THREE.InstancedBufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.geo.setAttribute('iOffset', attr(this.offsets, 3));
    this.geo.setAttribute('iSize', attr(this.sizes, 1));
    this.geo.setAttribute('iColor', attr(this.colors, 4));
    this.geo.setAttribute('iRot', attr(this.rots, 1));
    this.geo.instanceCount = 0;

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null } }]),
      transparent: true,
      depthWrite: false,
      fog: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    mat.uniforms.uMap!.value = additive ? glowTexture() : puffTexture();
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
    this.mesh.layers.set(LAYER_FX);
    scene.add(this.mesh);

    for (let i = 0; i < capacity; i++) {
      this.slots.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        life: 1,
        size0: 1,
        size1: 1,
        color: new THREE.Color(),
        alpha: 1,
        fadeIn: 0,
        gravity: 0,
        drag: 0,
        rot: 0,
        rotSpeed: 0,
        floorY: -Infinity,
      });
    }
  }

  spawn(p: ParticleSpawn): void {
    const s = this.slots[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.capacity;
    s.alive = true;
    s.pos.copy(p.pos);
    if (p.vel) s.vel.copy(p.vel);
    else s.vel.set(0, 0, 0);
    s.age = 0;
    s.life = p.life;
    s.size0 = p.size;
    s.size1 = p.endSize ?? p.size;
    s.color.set(p.color);
    s.alpha = p.alpha ?? 1;
    s.fadeIn = p.fadeIn ?? 0;
    s.gravity = p.gravity ?? 0;
    s.drag = p.drag ?? 0;
    s.rot = Math.random() * Math.PI * 2;
    s.rotSpeed = p.rotSpeed ?? 0;
    s.floorY = p.floorY ?? -Infinity;
  }

  update(dt: number): void {
    let n = 0;
    for (const s of this.slots) {
      if (!s.alive) continue;
      s.age += dt;
      if (s.age >= s.life) {
        s.alive = false;
        continue;
      }
      s.vel.y -= s.gravity * dt;
      if (s.drag > 0) s.vel.multiplyScalar(Math.exp(-s.drag * dt));
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y < s.floorY) {
        s.pos.y = s.floorY;
        s.vel.set(s.vel.x * 0.3, Math.abs(s.vel.y) * 0.2, s.vel.z * 0.3);
      }
      s.rot += s.rotSpeed * dt;
      const t = s.age / s.life;
      const fadeIn = s.fadeIn > 0 ? Math.min(1, s.age / s.fadeIn) : 1;
      const fadeOut = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      this.offsets[n * 3] = s.pos.x;
      this.offsets[n * 3 + 1] = s.pos.y;
      this.offsets[n * 3 + 2] = s.pos.z;
      this.sizes[n] = s.size0 + (s.size1 - s.size0) * t;
      this.colors[n * 4] = s.color.r;
      this.colors[n * 4 + 1] = s.color.g;
      this.colors[n * 4 + 2] = s.color.b;
      this.colors[n * 4 + 3] = s.alpha * fadeIn * fadeOut;
      this.rots[n] = s.rot;
      n++;
    }
    this.liveCount = n;
    this.geo.instanceCount = n;
    for (const name of ['iOffset', 'iSize', 'iColor', 'iRot']) {
      (this.geo.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

  get count(): number {
    return this.liveCount;
  }
}
