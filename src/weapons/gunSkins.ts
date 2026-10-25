import * as THREE from 'three';
import type { CharmLook, GunSkinLook } from '@/progression/catalog';
import { camoMaterial } from './camoMaterial';
import { gunMaterials } from './gunKit';

/**
 * Gun skins and charms (progression step 6, progression.md 3-12): a skin
 * swaps the finish of a built gun by what each material is for — the
 * receiver's metal, the barrel's steel, the furniture (a colour, a pattern
 * through the camo shader, or wood) — and can lay an engraving over the metal
 * (glowing on the top skins). Same geometry, so the gun's numbers, sights and
 * outline stay the same. A charm is a small shape on a cord off the left of
 * the receiver (first person and the pictures). Materials are cached by look:
 * a new material is a shader compile.
 */

const cache = new Map<string, THREE.Material>();

const ENGRAVE_GLSL = /* glsl */ `
uniform vec3 engraveColor;
uniform float engraveGlow;
varying vec3 vEngravePos;
float engraveLines(vec3 p) {
  // Scrollwork: curling lines along the gun, finer toward the edges.
  float a = sin(p.z * 260.0 + sin(p.y * 140.0 + p.z * 40.0) * 2.4 + cos(p.x * 90.0) * 1.2);
  float b = sin(p.z * 110.0 - p.y * 180.0 + sin(p.z * 60.0) * 3.0);
  return (smoothstep(0.965, 0.995, a) + smoothstep(0.975, 0.998, b) * 0.6) * 0.85;
}
`;

function engraved(base: THREE.MeshStandardMaterial, color: number, glow: boolean): THREE.MeshStandardMaterial {
  const uniforms = { engraveColor: { value: new THREE.Color(color) }, engraveGlow: { value: glow ? 1 : 0 } };
  const prev = base.onBeforeCompile;
  base.onBeforeCompile = (shader, r) => {
    prev?.call(base, shader, r);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEngravePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEngravePos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ENGRAVE_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat engr = clamp(engraveLines(vEngravePos), 0.0, 1.0);\ndiffuseColor.rgb = mix(diffuseColor.rgb, engraveColor, engr);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += engraveColor * engr * engraveGlow * 1.4;');
  };
  const prevKey = base.customProgramCacheKey.bind(base);
  base.customProgramCacheKey = () => `${prevKey()}|engrave`;
  return base;
}

function finish(base: THREE.MeshStandardMaterial, c: [number, number, number]): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.color.set(c[0]);
  m.metalness = c[1];
  m.roughness = c[2];
  // Plain colours: no albedo map left over (wood keeps its grain map only when asked for).
  m.map = null;
  return m;
}

type Role = 'metal' | 'steel' | 'furniture' | 'wood';

function skinned(role: Role, base: THREE.MeshStandardMaterial, look: GunSkinLook, key: string): THREE.Material {
  const k = `${key}|${role}|${base.uuid}`;
  const m = cache.get(k);
  if (m) return m;
  const g = gunMaterials();
  let out: THREE.MeshStandardMaterial;
  if (role === 'metal') out = look.metal ? finish(base, look.metal) : base.clone();
  else if (role === 'steel') out = look.steel ? finish(base, look.steel) : base.clone();
  else if (role === 'wood' || (role === 'furniture' && look.wood !== undefined)) {
    out = g.wood.clone();
    if (look.wood !== undefined) out.color.set(look.wood).multiplyScalar(1.6);
  } else if (look.pattern) {
    // The camo material itself (cloning would drop its shader hook); cached there per look.
    const pm = camoMaterial(look.pattern, base);
    pm.userData.skin = true;
    cache.set(k, pm);
    return pm;
  }
  else if (look.furniture) out = finish(base, look.furniture);
  else out = base.clone();
  if (look.engrave && (role === 'metal' || (role === 'steel' && look.metal))) engraved(out, look.engrave.color, !!look.engrave.glow);
  out.userData.camo = true;
  out.userData.skin = true;
  cache.set(k, out);
  return out;
}

/** Puts a skin on a built gun (its own parts only: optics, lenses and rubber keep theirs). */
export function applySkin(group: THREE.Object3D, look: GunSkinLook, key: string): void {
  const g = gunMaterials();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.charm) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat || Array.isArray(mat) || mat.userData?.skin) return;
    const role: Role | null = mat === g.alloy ? 'metal' : mat === g.steel ? 'steel' : mat === g.wood ? 'wood' : mat === g.polymer || mat.userData?.paint ? 'furniture' : null;
    if (role) mesh.material = skinned(role, mat, look, key);
  });
}

// ---------------------------------------------------------------------------
// Charms.

function charmGeometry(shape: CharmLook['shape']): THREE.BufferGeometry[] {
  const s = 0.011;
  switch (shape) {
    case 'tag':
      return [new THREE.BoxGeometry(0.002, s * 1.9, s * 1.2)];
    case 'die':
    case 'cube':
      return [new THREE.BoxGeometry(s * 1.2, s * 1.2, s * 1.2)];
    case 'bullet': {
      const c = new THREE.CylinderGeometry(s * 0.35, s * 0.35, s * 1.6, 10);
      const tip = new THREE.ConeGeometry(s * 0.35, s * 0.8, 10).translate(0, -s * 1.2, 0);
      return [c, tip];
    }
    case 'coin':
    case 'ring':
      return shape === 'ring' ? [new THREE.TorusGeometry(s * 0.7, s * 0.2, 8, 16).rotateY(Math.PI / 2)] : [new THREE.CylinderGeometry(s * 0.9, s * 0.9, 0.0025, 18).rotateZ(Math.PI / 2)];
    case 'star':
    case 'bolt':
    case 'leaf':
    case 'heart':
    case 'fish': {
      const pts: [number, number][] =
        shape === 'star'
          ? Array.from({ length: 10 }, (_, i) => [Math.sin((i / 10) * Math.PI * 2) * (i % 2 ? 0.45 : 1), Math.cos((i / 10) * Math.PI * 2) * (i % 2 ? 0.45 : 1)] as [number, number])
          : shape === 'bolt'
            ? [[0.2, 1], [-0.5, 0], [0, 0], [-0.2, -1], [0.5, 0.1], [0, 0.1]]
            : shape === 'heart'
              ? [[0, -0.9], [0.9, 0.1], [0.6, 0.8], [0, 0.4], [-0.6, 0.8], [-0.9, 0.1]]
              : shape === 'fish'
                ? [[1, 0], [0.4, 0.5], [-0.4, 0.3], [-1, 0.6], [-0.8, 0], [-1, -0.6], [-0.4, -0.3], [0.4, -0.5]]
                : [[0, 1], [0.5, 0.3], [0.3, -0.6], [0, -1], [-0.3, -0.6], [-0.5, 0.3]];
      const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * s, y * s)));
      return [new THREE.ExtrudeGeometry(sh, { depth: 0.003, bevelEnabled: false }).rotateY(Math.PI / 2)];
    }
    case 'skull': {
      const head = new THREE.SphereGeometry(s * 0.75, 10, 8);
      const jaw = new THREE.BoxGeometry(s * 0.8, s * 0.5, s * 0.9).translate(0, -s * 0.7, 0);
      return [head, jaw];
    }
    case 'bear': {
      const body = new THREE.SphereGeometry(s * 0.7, 10, 8).translate(0, -s * 0.5, 0);
      const head = new THREE.SphereGeometry(s * 0.5, 10, 8).translate(0, s * 0.5, 0);
      const ear1 = new THREE.SphereGeometry(s * 0.2, 6, 5).translate(0, s * 0.95, s * 0.35);
      const ear2 = new THREE.SphereGeometry(s * 0.2, 6, 5).translate(0, s * 0.95, -s * 0.35);
      return [body, head, ear1, ear2];
    }
    case 'grenade': {
      const b = new THREE.SphereGeometry(s * 0.65, 10, 8).scale(1, 1.25, 1);
      const top = new THREE.CylinderGeometry(s * 0.25, s * 0.25, s * 0.5, 8).translate(0, s * 0.95, 0);
      return [b, top];
    }
    case 'ball':
    default:
      return [new THREE.SphereGeometry(s * 0.7, 12, 10)];
  }
}

/**
 * A charm hung off the left side of the receiver (gun space: forward -z, up y,
 * the side the player sees -x): a short cord and the shape under it.
 */
export function addCharm(group: THREE.Object3D, look: CharmLook): void {
  const root = new THREE.Group();
  root.position.set(-0.024, -0.012, 0.035);
  const cordMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.022, 5), cordMat);
  cord.position.y = -0.011;
  root.add(cord);
  const body = new THREE.MeshStandardMaterial({
    color: look.color,
    metalness: look.shape === 'tag' || look.shape === 'coin' || look.shape === 'ring' || look.shape === 'bullet' ? 0.85 : 0.1,
    roughness: look.shape === 'cube' ? 0.1 : 0.45,
    emissive: look.glow ? look.color : 0x000000,
    emissiveIntensity: look.glow ? 0.6 : 0,
  });
  const accent = new THREE.MeshStandardMaterial({ color: look.accent, metalness: 0.3, roughness: 0.5, emissive: look.glow ? look.accent : 0x000000, emissiveIntensity: look.glow ? 0.8 : 0 });
  const geos = charmGeometry(look.shape);
  geos.forEach((geo, i) => {
    const mesh = new THREE.Mesh(geo, i === 0 ? body : accent);
    mesh.position.y = -0.03;
    root.add(mesh);
  });
  // A little detail in the accent colour: pips on a die, eyes on a skull, a band on a ball.
  if (look.shape === 'die' || look.shape === 'skull') {
    for (const z of [-0.0035, 0.0035]) {
      const pip = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 6, 5), accent);
      pip.position.set(-0.0068, -0.029, z);
      root.add(pip);
    }
  } else if (look.shape === 'ball') {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.0078, 0.0009, 6, 18), accent);
    band.position.y = -0.03;
    band.rotation.y = Math.PI / 2;
    root.add(band);
  }
  root.traverse((o) => (o.userData.charm = true));
  root.name = 'charm';
  group.add(root);
}
