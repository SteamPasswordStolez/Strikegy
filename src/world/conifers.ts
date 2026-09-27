import * as THREE from 'three';
import { makeRng } from '@/render/noise';

/**
 * Procedural conifers: a tapered trunk with whorls of branch "cards" (quads
 * textured with a painted needle spray), plus camera-facing impostors baked
 * from the same trees for the far forest.
 */

/** Tree height in meters before per-instance scaling. */
export const TREE_HEIGHT = 18;
const VARIANTS = 3;

// ---------------------------------------------------------------------------
// Textures (painted once on a canvas)

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A fir branch seen from above: stem along +u, side twigs, dense needles. */
function needleTexture(snow: boolean): THREE.CanvasTexture {
  const rng = makeRng(5);
  return canvasTexture(256, 256, (ctx) => {
    ctx.lineCap = 'round';
    const green = (l: number) => {
      const h = 105 + rng() * 35;
      const s = 18 + rng() * 18;
      return `hsl(${h} ${s}% ${l}%)`;
    };
    const needles = (x0: number, y0: number, x1: number, y1: number, len: number, count: number, light: number) => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const L = Math.hypot(dx, dy);
      const nx = -dy / L;
      const ny = dx / L;
      for (let i = 0; i < count; i++) {
        const t = rng();
        const px = x0 + dx * t;
        const py = y0 + dy * t;
        const side = rng() < 0.5 ? -1 : 1;
        // Needles shorten toward the tip and sweep slightly forward.
        const l = len * (1 - t * 0.5) * (0.6 + rng() * 0.5);
        const fx = (dx / L) * 0.45 + nx * side;
        const fy = (dy / L) * 0.45 + ny * side;
        const fl = Math.hypot(fx, fy);
        ctx.strokeStyle = green(light * (0.7 + rng() * 0.6));
        ctx.lineWidth = 2 + rng() * 1.8;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + (fx / fl) * l, py + (fy / fl) * l);
        ctx.stroke();
      }
    };
    // Main stem from the trunk side (u = 0) to the tip, twigs alternating.
    const y = 128;
    ctx.strokeStyle = '#4a3a2a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(250, y);
    ctx.stroke();
    const twigs: [number, number, number, number][] = [];
    for (let i = 0; i < 11; i++) {
      const t = 0.08 + i * 0.08;
      const x = t * 250;
      const side = i % 2 ? -1 : 1;
      const len = (1 - t) * 105 + 30;
      twigs.push([x, y, x + len * 0.75, y + side * len * 0.65]);
    }
    ctx.lineWidth = 2;
    for (const [x0, y0, x1, y1] of twigs) {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    // Darker inner needles first, lighter outer ones on top.
    for (const [x0, y0, x1, y1] of twigs) needles(x0, y0, x1, y1, 19, 120, 15);
    needles(0, y, 250, y, 24, 260, 14);
    for (const [x0, y0, x1, y1] of twigs) needles(x0, y0, x1, y1, 15, 90, 24);
    needles(100, y, 250, y, 16, 100, 29);
    if (snow) {
      // Clumps of snow resting on the branch, thickest along the stem and twigs
      // (drawn only over needles, so the card outline stays the same).
      ctx.globalCompositeOperation = 'source-atop';
      const clump = (x: number, yy: number, r: number) => {
        ctx.fillStyle = `rgba(${236 + rng() * 14}, ${240 + rng() * 12}, 250, ${0.75 + rng() * 0.2})`;
        ctx.beginPath();
        ctx.ellipse(x, yy, r * (1.2 + rng() * 0.6), r, rng() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      };
      for (let i = 0; i < 70; i++) clump(10 + rng() * 235, y + (rng() - 0.5) * 34, 4 + rng() * 9);
      for (const [x0, y0, x1, y1] of twigs) {
        for (let i = 0; i < 7; i++) {
          const t = rng();
          clump(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 3 + rng() * 6);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  });
}

function barkTexture(): THREE.CanvasTexture {
  const rng = makeRng(9);
  const t = canvasTexture(64, 256, (ctx) => {
    ctx.fillStyle = '#4b3c30';
    ctx.fillRect(0, 0, 64, 256);
    // Vertical plates and cracks.
    for (let i = 0; i < 90; i++) {
      const x = rng() * 64;
      const y = rng() * 256;
      const l = 20 + rng() * 60;
      const light = 18 + rng() * 22;
      ctx.strokeStyle = `hsl(25 ${15 + rng() * 15}% ${light}%)`;
      ctx.lineWidth = 2 + rng() * 5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 6, y + l);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(15,10,8,0.8)';
    for (let i = 0; i < 25; i++) {
      const x = rng() * 64;
      ctx.lineWidth = 1 + rng() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y <= 256; y += 32) ctx.lineTo(x + (rng() - 0.5) * 6, y);
      ctx.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Tree geometry

export interface ConiferVariant {
  foliage: THREE.BufferGeometry;
  trunk: THREE.BufferGeometry;
  /** Crown radius at the base, for impostor framing. */
  radius: number;
}

function buildVariant(seed: number): ConiferVariant {
  const rng = makeRng(seed);
  const H = TREE_HEIGHT * (0.9 + rng() * 0.2);
  const crownBase = H * (0.16 + rng() * 0.08);
  const Rmax = H * (0.22 + rng() * 0.05);

  const trunk = new THREE.CylinderGeometry(0.08, 0.36, H * 0.96, 7, 6, true);
  trunk.translate(0, (H * 0.96) / 2, 0);
  // Bark UVs: wrap once around, repeat every ~2 m vertically.
  const tuv = trunk.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < tuv.count; i++) tuv.setY(i, tuv.getY(i) * H * 0.5);

  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const lift = new THREE.Vector3();
  const n = new THREE.Vector3();
  const corner = new THREE.Vector3();

  const card = (base: THREE.Vector3, along: THREE.Vector3, across: THREE.Vector3, len: number, width: number, shade: number) => {
    // Quad from the trunk outward; normals bend outward + up for soft, volumetric shading.
    const quad: [number, number][] = [
      [0, -0.5],
      [1, -0.5],
      [1, 0.5],
      [0, -0.5],
      [1, 0.5],
      [0, 0.5],
    ];
    for (const [a, b] of quad) {
      corner.copy(base).addScaledVector(along, a * len).addScaledVector(across, b * width);
      pos.push(corner.x, corner.y, corner.z);
      n.set(corner.x, 0, corner.z).normalize().multiplyScalar(0.8).addScaledVector(up, 0.55).normalize();
      nor.push(n.x, n.y, n.z);
      uv.push(a, b + 0.5);
      // Ambient occlusion: darker toward the trunk.
      const ao = shade * (0.45 + 0.55 * a);
      col.push(ao, ao, ao);
    }
  };

  for (let y = crownBase; y < H * 0.97; y += 0.42 + rng() * 0.25) {
    const t = (y - crownBase) / (H - crownBase);
    const R = Rmax * Math.pow(1 - t, 0.95) + 0.35;
    const branches = t > 0.85 ? 4 : 6 + Math.floor(rng() * 3);
    const phase = rng() * Math.PI * 2;
    // Lower whorls sit in the shade of the crown above.
    const shade = 0.55 + 0.45 * Math.min(1, t * 1.4 + 0.2);
    for (let k = 0; k < branches; k++) {
      const a = phase + (k / branches) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      const droop = -0.15 - (1 - t) * 0.35 + (rng() - 0.5) * 0.15;
      dir.set(Math.cos(a), droop, Math.sin(a)).normalize();
      side.crossVectors(up, dir).normalize();
      lift.crossVectors(dir, side).normalize();
      const len = R * (0.85 + rng() * 0.3);
      const base = new THREE.Vector3(Math.cos(a) * 0.15, y, Math.sin(a) * 0.15);
      card(base, dir, side, len, len * 0.8, shade);
      card(base, dir, lift, len * 0.9, len * 0.5, shade * 0.9);
    }
  }
  // Leader at the top.
  for (let k = 0; k < 2; k++) {
    const a = (k / 2) * Math.PI;
    const base = new THREE.Vector3(0, H * 0.9, 0);
    card(base, up, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), H * 0.12, 0.9, 1);
  }

  const foliage = new THREE.BufferGeometry();
  foliage.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  foliage.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  foliage.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  foliage.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  foliage.computeBoundingSphere();
  return { foliage, trunk, radius: Rmax + 0.6 };
}

export interface ConiferKit {
  variants: ConiferVariant[];
  foliageMaterial: THREE.MeshStandardMaterial;
  trunkMaterial: THREE.MeshStandardMaterial;
  /** Impostor material (atlas baked on first use, shared by all chunks). */
  impostorMaterial?: THREE.MeshBasicMaterial;
}

export function createConiferKit(alphaToCoverage: boolean, snow = false): ConiferKit {
  const variants = Array.from({ length: VARIANTS }, (_, i) => buildVariant(101 + i * 17));
  const foliageMaterial = new THREE.MeshStandardMaterial({
    map: needleTexture(snow),
    color: 0xa3ad9c,
    vertexColors: true,
    alphaTest: 0.45,
    alphaToCoverage,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  const trunkMaterial = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.95, metalness: 0 });
  return { variants, foliageMaterial, trunkMaterial };
}

// ---------------------------------------------------------------------------
// Impostors

const IMPOSTOR_W = 256;
const IMPOSTOR_H = 512;

/**
 * Renders each variant once, from the side, into an atlas (one column per
 * variant). Lit with the scene's environment and a sun from above/front, so the
 * baked result reads the same from any direction the billboard faces.
 */
function bakeImpostors(gl: THREE.WebGLRenderer, kit: ConiferKit, environment: THREE.Texture | null, envIntensity: number): THREE.Texture {
  const rt = new THREE.WebGLRenderTarget(IMPOSTOR_W * VARIANTS, IMPOSTOR_H, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.environment = environment;
  scene.environmentIntensity = envIntensity;
  const sun = new THREE.DirectionalLight(0xfff1de, 2.2);
  sun.position.set(0.3, 1, 0.8);
  scene.add(sun, new THREE.HemisphereLight(0xcfe0f0, 0x3a3a2a, 0.4));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

  const prevTarget = gl.getRenderTarget();
  const prevColor = gl.getClearColor(new THREE.Color());
  const prevAlpha = gl.getClearAlpha();
  const prevShadows = gl.shadowMap.enabled;
  gl.shadowMap.enabled = false;
  rt.scissorTest = false;
  gl.setRenderTarget(rt);
  gl.setClearColor(0x000000, 0);
  gl.clear();
  // Viewport and scissor come from the render target itself.
  rt.scissorTest = true;
  kit.variants.forEach((v, i) => {
    const meshes = [new THREE.Mesh(v.foliage, kit.foliageMaterial), new THREE.Mesh(v.trunk, kit.trunkMaterial)];
    scene.add(...meshes);
    const r = v.radius;
    cam.left = -r;
    cam.right = r;
    cam.bottom = 0;
    cam.top = TREE_HEIGHT * 1.15;
    cam.position.set(0, 0, 60);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    rt.viewport.set(i * IMPOSTOR_W, 0, IMPOSTOR_W, IMPOSTOR_H);
    rt.scissor.set(i * IMPOSTOR_W, 0, IMPOSTOR_W, IMPOSTOR_H);
    gl.setRenderTarget(rt);
    gl.render(scene, cam);
    scene.remove(...meshes);
  });
  gl.setRenderTarget(prevTarget);
  gl.setClearColor(prevColor, prevAlpha);
  gl.shadowMap.enabled = prevShadows;
  return rt.texture;
}

/** Aspect (width / height) of each variant's impostor frame. */
function impostorAspect(kit: ConiferKit, i: number): number {
  return (kit.variants[i]!.radius * 2) / (TREE_HEIGHT * 1.15);
}

/**
 * Instanced, Y-axis billboards for far trees. Each instance matrix only carries
 * position and (uniform) scale; the vertex shader turns the quad toward the camera.
 */
export function buildImpostors(
  gl: THREE.WebGLRenderer,
  kit: ConiferKit,
  environment: THREE.Texture | null,
  envIntensity: number,
  placements: { pos: THREE.Vector3; scale: number; variant: number; tint: number }[],
): THREE.InstancedMesh {
  kit.impostorMaterial ??= impostorMaterial(bakeImpostors(gl, kit, environment, envIntensity));
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  const variantAttr = new Float32Array(placements.length);
  const aspectAttr = new Float32Array(placements.length);
  placements.forEach((p, i) => {
    variantAttr[i] = p.variant;
    aspectAttr[i] = impostorAspect(kit, p.variant);
  });
  geo.setAttribute('aVariant', new THREE.InstancedBufferAttribute(variantAttr, 1));
  geo.setAttribute('aAspect', new THREE.InstancedBufferAttribute(aspectAttr, 1));

  const mesh = new THREE.InstancedMesh(geo, kit.impostorMaterial, placements.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const bounds = new THREE.Box3();
  const top = new THREE.Vector3();
  placements.forEach((p, i) => {
    const h = TREE_HEIGHT * 1.15 * p.scale;
    m.makeScale(h, h, h).setPosition(p.pos);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setScalar(p.tint));
    bounds.expandByPoint(p.pos).expandByPoint(top.copy(p.pos).setY(p.pos.y + h));
  });
  // The shader turns quads toward the camera, so bound the chunk by its trees
  // (padded by a crown radius) rather than by the untransformed quads.
  mesh.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
  mesh.boundingSphere.radius += TREE_HEIGHT * 0.4;
  mesh.name = 'tree-impostors';
  return mesh;
}

function impostorMaterial(atlas: THREE.Texture): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aVariant;
        attribute float aAspect;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vMapUv.x = (vMapUv.x + aVariant) / ${VARIANTS}.0;`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float height = length(instanceMatrix[1].xyz);
        vec3 toCam = cameraPosition - origin.xyz;
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
        vec3 wp = origin.xyz + right * position.x * height * aAspect + vec3(0.0, position.y * height, 0.0);
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  return mat;
}

/** Full 3D trees: one InstancedMesh per variant and material. */
export function buildNearTrees(kit: ConiferKit, placements: { pos: THREE.Vector3; scale: number; yaw: number; variant: number; tint: number }[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trees';
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  kit.variants.forEach((v, vi) => {
    const list = placements.filter((p) => p.variant === vi);
    if (list.length === 0) return;
    for (const [geo, mat] of [
      [v.foliage, kit.foliageMaterial],
      [v.trunk, kit.trunkMaterial],
    ] as const) {
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
        s.set(p.scale, p.scale * (0.9 + (i % 5) * 0.05), p.scale);
        inst.setMatrixAt(i, m.compose(p.pos, q, s));
        if (mat === kit.foliageMaterial) inst.setColorAt(i, c.setScalar(p.tint));
      });
      inst.computeBoundingSphere();
      group.add(inst);
    }
  });
  return group;
}

