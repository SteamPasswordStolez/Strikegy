import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Team } from '@/world/mapTypes';
import { WEAPONS, type WeaponDef } from '@/weapons/weaponData';
import { buildGun } from '@/weapons/gunModels';

/**
 * Procedural soldier: one rigidly skinned mesh (a single draw call) with a
 * small skeleton — hips, spine, head, an aim bone carrying the arms and rifle,
 * and two-segment legs. Animated procedurally: walk cycle, crouch, aim pitch,
 * hit flinch and a death fall.
 */

const enum B {
  Root,
  Hips,
  Spine,
  Head,
  Aim,
  ThighL,
  ShinL,
  ThighR,
  ShinR,
}

/** Bind-pose joint positions (model space, feet at origin, facing -Z). */
const JOINTS: Record<B, [number, number, number]> = {
  [B.Root]: [0, 0, 0],
  [B.Hips]: [0, 0.95, 0],
  [B.Spine]: [0, 1.08, 0],
  [B.Head]: [0, 1.5, 0],
  [B.Aim]: [0, 1.38, 0],
  [B.ThighL]: [-0.1, 0.92, 0],
  [B.ShinL]: [-0.1, 0.5, 0],
  [B.ThighR]: [0.1, 0.92, 0],
  [B.ShinR]: [0.1, 0.5, 0],
};
const PARENT: Record<B, B | -1> = {
  [B.Root]: -1,
  [B.Hips]: B.Root,
  [B.Spine]: B.Hips,
  [B.Head]: B.Spine,
  [B.Aim]: B.Spine,
  [B.ThighL]: B.Hips,
  [B.ShinL]: B.ThighL,
  [B.ThighR]: B.Hips,
  [B.ShinR]: B.ThighR,
};

interface Palette {
  uniform: number;
  uniformDark: number;
  gear: number;
  helmet: number;
  skin: number;
  boots: number;
  glove: number;
  /** Team marking (armband / helmet band). */
  mark: number;
}

const PALETTES: Record<Team, Palette> = {
  blue: { uniform: 0x5e5a48, uniformDark: 0x4a4636, gear: 0x403e33, helmet: 0x4a4836, skin: 0xb3876a, boots: 0x2b241d, glove: 0x2a2620, mark: 0x3f7bd9 },
  red: { uniform: 0x444a37, uniformDark: 0x33382b, gear: 0x2f3228, helmet: 0x363a29, skin: 0x9c7458, boots: 0x231f1a, glove: 0x23211d, mark: 0xc9402f },
};


/** Where the gun's grip (trigger origin) sits in model space. */
const GRIP = new THREE.Vector3(0.09, 1.4, -0.12);

type Part = { geo: THREE.BufferGeometry; bone: B; color: number };

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

/** Soft-edged box for the near model: cloth and pouches, not crates (radius scales with the smallest side). */
/** Building the far crowd's model: fewer segments, square boxes (see buildFarSoldierPose). */
let lowDetail = false;
/** Segment count: halved (at least 4) for the far crowd. */
const seg = (n: number): number => (lowDetail ? Math.max(4, Math.round(n / 2)) : n);

function rbox(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  if (lowDetail) return box(w, h, d, x, y, z);
  const r = Math.min(0.035, Math.min(w, h, d) * 0.3);
  return new RoundedBoxGeometry(w, h, d, 2, r).translate(x, y, z);
}

function capsule(r: number, from: THREE.Vector3, to: THREE.Vector3): THREE.BufferGeometry {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), lowDetail ? 1 : 3, lowDetail ? 6 : 8);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  return g;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function bodyParts(p: Palette, gunParts: Part[], support: THREE.Vector3): Part[] {
  const parts: Part[] = [];
  const add = (geo: THREE.BufferGeometry, bone: B, color: number) => parts.push({ geo, bone, color });

  for (const [side, thigh, shin] of [
    [-1, B.ThighL, B.ShinL],
    [1, B.ThighR, B.ShinR],
  ] as const) {
    const x = side * 0.1;
    add(capsule(0.085, V(x, 0.92, 0), V(x, 0.5, 0.01)), thigh, p.uniform);
    add(rbox(0.13, 0.12, 0.1, x + side * 0.05, 0.72, 0), thigh, p.gear); // thigh pocket
    add(capsule(0.07, V(x, 0.5, 0.01), V(x, 0.12, 0.02)), shin, p.uniform);
    add(rbox(0.12, 0.12, 0.05, x, 0.5, -0.07), shin, p.gear); // knee pad
    // Boot: rounded upper, a darker sole and a toe cap.
    add(rbox(0.12, 0.13, 0.24, x, 0.075, -0.025), shin, p.boots);
    add(rbox(0.125, 0.035, 0.29, x, 0.018, -0.045), shin, 0x1a1714);
    add(new THREE.CylinderGeometry(0.075, 0.072, 0.07, seg(10)).translate(x, 0.17, 0.01), shin, p.uniformDark); // trouser cuff
  }
  add(rbox(0.36, 0.18, 0.22, 0, 0.94, 0), B.Hips, p.uniformDark);
  add(rbox(0.38, 0.05, 0.24, 0, 1.02, 0), B.Hips, p.gear); // belt
  add(rbox(0.06, 0.05, 0.03, 0, 1.02, -0.125), B.Hips, 0x6b6656); // buckle

  // Torso (a rounded chest), plate carrier with pouches, collar, small pack.
  add(new THREE.SphereGeometry(0.2, seg(14), seg(10)).scale(1, 1.18, 0.62).translate(0, 1.28, 0), B.Spine, p.uniform);
  add(rbox(0.41, 0.34, 0.29, 0, 1.26, 0), B.Spine, p.gear);
  for (const x of [-0.12, 0, 0.12]) add(rbox(0.1, 0.13, 0.07, x, 1.14, -0.17), B.Spine, p.gear);
  for (const x of [-0.12, 0.12]) add(rbox(0.07, 0.25, 0.035, x, 1.33, -0.16), B.Spine, p.uniformDark); // straps
  add(new THREE.TorusGeometry(0.075, 0.025, seg(6), seg(12)).rotateX(Math.PI / 2).translate(0, 1.5, 0), B.Spine, p.uniform); // collar
  add(rbox(0.3, 0.32, 0.14, 0, 1.28, 0.2), B.Spine, p.uniformDark);
  add(rbox(0.08, 0.14, 0.05, 0.13, 1.4, 0.26), B.Spine, p.gear); // radio
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.22, seg(4)).translate(0.15, 1.56, 0.27), B.Spine, 0x1a1a1a); // antenna

  // Head: neck, face with eyes, nose, ears and a chin strap; helmet with a brim and cover band.
  add(new THREE.CylinderGeometry(0.055, 0.06, 0.1, seg(8)).translate(0, 1.53, 0), B.Head, p.skin);
  add(new THREE.SphereGeometry(0.105, seg(14), seg(12)).scale(0.92, 1.1, 1).translate(0, 1.63, 0), B.Head, p.skin);
  add(new THREE.SphereGeometry(0.06, seg(10), seg(8)).scale(1, 0.75, 0.9).translate(0, 1.565, -0.045), B.Head, p.skin); // jaw
  add(new THREE.SphereGeometry(0.1, seg(12), seg(8), 0, Math.PI * 2, 0, Math.PI * 0.62).scale(0.97, 0.95, 0.98).rotateX(Math.PI * 0.62).translate(0, 1.62, 0.012), B.Head, 0x2c241d); // hair under the helmet, at the back
  add(new THREE.ConeGeometry(0.018, 0.045, 6).rotateX(-Math.PI / 2 - 0.25).translate(0, 1.618, -0.112), B.Head, p.skin); // nose
  for (const s of [-1, 1]) {
    add(new THREE.SphereGeometry(0.013, seg(6), seg(5)).translate(s * 0.036, 1.645, -0.092), B.Head, 0x1c1814); // eye
    add(rbox(0.035, 0.008, 0.012, s * 0.036, 1.668, -0.096), B.Head, 0x3a2c22); // brow
    add(new THREE.SphereGeometry(0.024, seg(6), seg(5)).scale(0.45, 1, 0.8).translate(s * 0.1, 1.625, 0.005), B.Head, p.skin); // ear
    add(rbox(0.012, 0.11, 0.014, s * 0.095, 1.585, -0.02), B.Head, 0x1d1b17); // chin strap
  }
  add(new THREE.SphereGeometry(0.128, seg(16), seg(8), 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.95, 1.08).translate(0, 1.65, 0), B.Head, p.helmet);
  add(new THREE.CylinderGeometry(0.138, 0.142, 0.018, seg(16), 1, true).translate(0, 1.652, 0.004), B.Head, p.helmet); // brim
  add(new THREE.CylinderGeometry(0.131, 0.131, 0.025, seg(16), 1, true).translate(0, 1.68, 0), B.Head, p.mark);
  add(rbox(0.16, 0.05, 0.05, 0, 1.72, -0.07), B.Head, 0x1a1a1a); // goggles pushed up on the helmet

  // Arms on the aim bone: right hand on the grip, left hand at the support point.
  const shoulderR = V(0.21, 1.43, 0);
  const shoulderL = V(-0.21, 1.43, 0);
  // Shouldered rifle: right elbow out to the side, left arm reaching under the handguard.
  const handR = GRIP.clone().add(V(0, -0.05, 0.03));
  const elbowR = V(0.27, 1.3, 0.02);
  const elbowL = V(-0.1, 1.27, -0.22);
  add(capsule(0.06, shoulderR, elbowR), B.Aim, p.uniform);
  add(capsule(0.052, elbowR, handR), B.Aim, p.uniform);
  add(capsule(0.06, shoulderL, elbowL), B.Aim, p.uniform);
  add(capsule(0.052, elbowL, support), B.Aim, p.uniform);
  add(new THREE.CylinderGeometry(0.063, 0.063, 0.05, seg(10)).translate(-0.21, 1.34, 0), B.Aim, p.mark); // armband
  add(new THREE.SphereGeometry(0.045, seg(8), seg(6)).translate(handR.x, handR.y, handR.z), B.Aim, p.glove);
  add(new THREE.SphereGeometry(0.045, seg(8), seg(6)).translate(support.x, support.y, support.z), B.Aim, p.glove);
  return parts.concat(gunParts);
}

/** The procedural first-person gun, baked into vertex-colored parts on the aim bone. */
function gunParts(def: WeaponDef): { parts: Part[]; support: THREE.Vector3; muzzle: THREE.Vector3 } {
  const g = buildGun(def, { detail: 'low' });
  g.group.position.copy(GRIP);
  g.group.updateMatrixWorld(true);
  const parts: Part[] = [];
  g.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
    // Textured wood has a white base color; everything else carries its color.
    const color = mat.map ? 0x6b4a2e : mat.color.getHex();
    if ((mat as THREE.MeshStandardMaterial).transparent) return; // optic glass
    parts.push({ geo: o.geometry.clone().applyMatrix4(o.matrixWorld), bone: B.Aim, color });
  });
  const support = V(GRIP.x - 0.004, GRIP.y + g.support[1] + 0.02, GRIP.z - g.support[0]);
  const muzzle = g.muzzle.clone().add(GRIP);
  g.group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  return { parts, support, muzzle };
}

function buildGeometry(parts: Part[]): THREE.BufferGeometry {
  const c = new THREE.Color();
  const prepared = parts.map(({ geo, bone, color }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    c.setHex(color, THREE.SRGBColorSpace);
    for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      skinIndex[i * 4] = bone;
      skinWeight[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    return g;
  });
  const merged = mergeGeometries(prepared, false)!;
  prepared.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
}

const geometryCache = new Map<string, { geo: THREE.BufferGeometry; muzzle: THREE.Vector3 }>();
let sharedMaterial: THREE.MeshStandardMaterial | null = null;

export interface SoldierPose {
  /** Horizontal speed, m/s. */
  speed: number;
  /** 0 standing .. 1 crouched. */
  crouch: number;
  /** Body facing (radians, 0 = -Z). */
  yaw: number;
  aimPitch: number;
  /** Seconds since death, or -1 while alive. */
  deadFor: number;
  dt: number;
  /** Sitting (in a vehicle seat): thighs forward, knees bent, hips down. */
  seated?: boolean;
}

export class SoldierModel {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  private readonly bones: THREE.Bone[] = [];
  private readonly muzzleLocal: THREE.Vector3;
  private phase = 0;
  private flinch = 0;
  private deathSide = 1;

  constructor(team: Team, def: WeaponDef) {
    const key = `${team}:${def.id}`;
    let cached = geometryCache.get(key);
    if (!cached) {
      const gun = gunParts(def);
      cached = { geo: buildGeometry(bodyParts(PALETTES[team], gun.parts, gun.support)), muzzle: gun.muzzle };
      geometryCache.set(key, cached);
    }
    this.muzzleLocal = cached.muzzle;
    sharedMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });

    for (let b = B.Root; b <= B.ShinR; b++) {
      const bone = new THREE.Bone();
      const [x, y, z] = JOINTS[b];
      const parent = PARENT[b];
      if (parent !== -1) {
        const [px, py, pz] = JOINTS[parent];
        bone.position.set(x - px, y - py, z - pz);
        this.bones[parent]!.add(bone);
      } else {
        bone.position.set(x, y, z);
      }
      this.bones.push(bone);
    }
    this.mesh = new THREE.SkinnedMesh(cached.geo, sharedMaterial);
    this.mesh.add(this.bones[B.Root]!);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    // Shadows are static (rendered once for the map), so moving soldiers would
    // leave frozen shadows behind; BotManager draws blob shadows instead.
    this.mesh.castShadow = false;
    // Bones move the vertices outside the bind-pose bounds (crouch, death).
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
  }

  /** Builds the geometry for these loadouts ahead of time (it takes ~20 ms each). */
  static prewarm(teams: readonly Team[], defs: readonly WeaponDef[]): void {
    for (const team of teams) for (const def of defs) new SoldierModel(team, def).dispose();
  }

  onHit(): void {
    this.flinch = 1;
  }

  onDeath(): void {
    this.deathSide = Math.random() < 0.5 ? -1 : 1;
  }

  /** Updates the pose; `pos` is the interpolated feet position. */
  update(pos: THREE.Vector3, p: SoldierPose): void {
    const bones = this.bones;
    this.root.position.copy(pos);
    this.root.rotation.y = p.yaw;
    this.flinch = Math.max(0, this.flinch - p.dt * 6);

    const moving = Math.min(1, p.speed / 4.5);
    this.phase += p.dt * (4 + p.speed * 1.6) * (moving > 0.05 ? 1 : 0);
    const swing = Math.sin(this.phase) * 0.55 * moving;
    const lift = Math.max(0, Math.cos(this.phase)) * 0.6 * moving;
    const liftR = Math.max(0, -Math.cos(this.phase)) * 0.6 * moving;
    const c = p.crouch;

    const hips = bones[B.Hips]!;
    hips.position.y = JOINTS[B.Hips][1] - c * 0.4 + Math.abs(Math.sin(this.phase)) * 0.03 * moving;
    // Positive x swings a limb forward (-Z). Crouch is a kneel: left shin upright
    // under a raised knee, right knee on the ground with the shin trailing back.
    bones[B.ThighL]!.rotation.x = swing + c * 1.2;
    bones[B.ThighR]!.rotation.x = -swing + c * 0.1;
    bones[B.ShinL]!.rotation.x = -lift - c * 1.2;
    bones[B.ShinR]!.rotation.x = -liftR - c * 1.5;
    // Lean forward when crouched; a hit rocks the torso back.
    bones[B.Spine]!.rotation.set(-c * 0.25 + this.flinch * 0.2, 0, Math.sin(this.phase) * 0.04 * moving);
    bones[B.Aim]!.rotation.x = p.aimPitch + c * 0.25 + this.flinch * 0.15;
    bones[B.Head]!.rotation.x = p.aimPitch * 0.6 + c * 0.2;
    if (p.seated) {
      hips.position.y = JOINTS[B.Hips][1] - 0.45;
      bones[B.ThighL]!.rotation.x = bones[B.ThighR]!.rotation.x = 1.45;
      bones[B.ShinL]!.rotation.x = bones[B.ShinR]!.rotation.x = -1.4;
    }

    const root = bones[B.Root]!;
    if (p.deadFor >= 0) {
      // Knees give, then the body topples to one side and back.
      const t = Math.min(1, p.deadFor / 0.55);
      const e = t * t;
      root.rotation.set(e * 1.35, 0, this.deathSide * e * 0.35);
      root.position.y = -e * 0.1;
      bones[B.ShinL]!.rotation.x = Math.min(bones[B.ShinL]!.rotation.x, -1.2 * Math.min(1, t * 2));
      bones[B.ShinR]!.rotation.x = Math.min(bones[B.ShinR]!.rotation.x, -0.9 * Math.min(1, t * 2));
      bones[B.Aim]!.rotation.x = -0.6 * t;
    } else {
      root.rotation.set(0, 0, 0);
      root.position.y = 0;
    }
  }

  /** Skinning matrices of the current pose (bone world x bind inverse), for baking. */
  boneMatrices(): THREE.Matrix4[] {
    this.root.updateMatrixWorld(true);
    const inv = this.mesh.skeleton.boneInverses;
    return this.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, inv[i]!));
  }

  /** Muzzle position in world space (after update). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const aim = this.bones[B.Aim]!;
    aim.updateWorldMatrix(true, false);
    // Muzzle is in model space; express it relative to the aim joint.
    const [x, y, z] = JOINTS[B.Aim];
    return out.set(this.muzzleLocal.x - x, this.muzzleLocal.y - y, this.muzzleLocal.z - z).applyMatrix4(aim.matrixWorld);
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

/** A plain rifle for the far crowd: stock, receiver, grip, magazine, handguard and barrel on the aim bone. */
function farGunParts(): { parts: Part[]; support: THREE.Vector3 } {
  const dark = 0x23262a;
  const g = GRIP;
  const parts: Part[] = [
    { geo: box(0.05, 0.08, 0.26, g.x, g.y + 0.02, g.z + 0.16), bone: B.Aim, color: dark }, // stock
    { geo: box(0.05, 0.07, 0.3, g.x, g.y + 0.04, g.z - 0.1), bone: B.Aim, color: dark }, // receiver
    { geo: box(0.03, 0.09, 0.04, g.x, g.y - 0.03, g.z), bone: B.Aim, color: dark }, // grip
    { geo: box(0.03, 0.12, 0.05, g.x, g.y - 0.03, g.z - 0.14), bone: B.Aim, color: dark }, // magazine
    { geo: box(0.05, 0.06, 0.2, g.x, g.y + 0.04, g.z - 0.34), bone: B.Aim, color: 0x34372f }, // handguard
    { geo: box(0.02, 0.02, 0.2, g.x, g.y + 0.05, g.z - 0.54), bone: B.Aim, color: dark }, // barrel
  ];
  return { parts, support: V(g.x - 0.004, g.y + 0.02, g.z - 0.32) };
}

/** Parts too small to see from the far crowd's distance (eyes, buckles, straps...). */
function tiny(geo: THREE.BufferGeometry): boolean {
  geo.computeBoundingSphere();
  return geo.boundingSphere!.radius < 0.035;
}

/**
 * The far crowd's soldier: the near model with fewer segments, no small
 * details and a plain rifle, frozen in one pose and baked into a static,
 * vertex-coloured geometry (feet at 0, facing -Z) drawn instanced.
 */
export function buildFarSoldierPose(team: Team, pose: 'stand' | 'run' | 'crouch'): THREE.BufferGeometry {
  // Posed by a normal soldier (same skeleton and animation code).
  const poser = new SoldierModel(team, WEAPONS.ar1);
  const p: SoldierPose = { speed: pose === 'run' ? 6 : 0, crouch: pose === 'crouch' ? 1 : 0, yaw: 0, aimPitch: 0, deadFor: -1, dt: 0 };
  // Mid-stride: the walk phase advances by dt * (4 + speed * 1.6).
  if (pose === 'run') poser.update(new THREE.Vector3(), { ...p, dt: Math.PI / 2 / (4 + 6 * 1.6) });
  poser.update(new THREE.Vector3(), p);
  const skin = poser.boneMatrices();
  poser.dispose();

  lowDetail = true;
  const gun = farGunParts();
  const parts = bodyParts(PALETTES[team], gun.parts, gun.support).filter((q) => !tiny(q.geo));
  lowDetail = false;
  const c = new THREE.Color();
  const geos = parts.map(({ geo, bone, color }) => {
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(skin[bone]!);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    c.setHex(color, THREE.SRGBColorSpace);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const merged = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
}
