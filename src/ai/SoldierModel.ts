import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Team } from '@/world/mapTypes';
import { WEAPONS, type WeaponDef } from '@/weapons/weaponData';
import { buildGun } from '@/weapons/gunModels';
import { gunKey } from '@/weapons/attachments';
import { weld, withIndex } from '@/render/geometryIndex';
import { MID_FROM, loadSoldierAssets, soldierAsset, type Sex, type SoldierAsset } from './soldierAssets';

/**
 * A soldier: the AI-made model of the side and sex (soldierAssets.ts, owner
 * 2026-10-25) skinned to a small skeleton — hips, spine, head, an aim bone
 * carrying the arms (upper arm, forearm, hand, bent onto the gun by two-bone
 * IK once per weapon) and the rifle, and two-segment legs — with the gun as a
 * second mesh on the aim bone. Without the models (the game server, tests) the
 * procedural body: one rigidly skinned mesh, arms fixed on the aim bone.
 * Animated procedurally: walk cycle, crouch, aim pitch, hit flinch and a death fall.
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
  UpperArmL,
  ForeArmL,
  HandL,
  UpperArmR,
  ForeArmR,
  HandR,
}

type Joints = Record<B, [number, number, number]>;

/** Bind-pose joint positions of the procedural body (model space, feet at origin, facing -Z; it has no arm bones). */
const JOINTS: Joints = {
  [B.Root]: [0, 0, 0],
  [B.Hips]: [0, 0.95, 0],
  [B.Spine]: [0, 1.08, 0],
  [B.Head]: [0, 1.5, 0],
  [B.Aim]: [0, 1.38, 0],
  [B.ThighL]: [-0.1, 0.92, 0],
  [B.ShinL]: [-0.1, 0.5, 0],
  [B.ThighR]: [0.1, 0.92, 0],
  [B.ShinR]: [0.1, 0.5, 0],
  [B.UpperArmL]: [-0.21, 1.43, 0],
  [B.ForeArmL]: [-0.5, 1.43, 0],
  [B.HandL]: [-0.75, 1.43, 0],
  [B.UpperArmR]: [0.21, 1.43, 0],
  [B.ForeArmR]: [0.5, 1.43, 0],
  [B.HandR]: [0.75, 1.43, 0],
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
  [B.UpperArmL]: B.Aim,
  [B.ForeArmL]: B.UpperArmL,
  [B.HandL]: B.ForeArmL,
  [B.UpperArmR]: B.Aim,
  [B.ForeArmR]: B.UpperArmR,
  [B.HandR]: B.ForeArmR,
};

/** The aim joint the gun and arm targets are laid out against (the procedural body's). */
const AIM0 = new THREE.Vector3(...JOINTS[B.Aim]);

/** The model's joints in the skeleton's order. */
function assetJoints(a: SoldierAsset): Joints {
  const j = a.joints;
  const v = (x: number[]): [number, number, number] => [x[0]!, x[1]!, x[2]!];
  return {
    [B.Root]: [0, 0, 0],
    [B.Hips]: v(j.hips),
    [B.Spine]: v(j.spine),
    [B.Head]: v(j.head),
    [B.Aim]: v(j.aim),
    [B.ThighL]: v(j.thighL),
    [B.ShinL]: v(j.shinL),
    [B.ThighR]: v(j.thighR),
    [B.ShinR]: v(j.shinR),
    [B.UpperArmL]: v(j.shoulderL),
    [B.ForeArmL]: v(j.elbowL),
    [B.HandL]: v(j.wristL),
    [B.UpperArmR]: v(j.shoulderR),
    [B.ForeArmR]: v(j.elbowR),
    [B.HandR]: v(j.wristR),
  };
}

/**
 * Two-bone IK in the aim bone's frame: the upper arm and forearm (resting
 * along the T-pose arm line) turned so the wrist reaches `wrist`, the elbow
 * bent toward `pole`; the hand rolled by `roll` about the forearm.
 */
function bendArm(J: Joints, upper: THREE.Bone, fore: THREE.Bone, hand: THREE.Bone, side: B.UpperArmL | B.UpperArmR, wrist: THREE.Vector3, pole: THREE.Vector3, roll: number): void {
  const aim = new THREE.Vector3(...J[B.Aim]);
  const S = new THREE.Vector3(...J[side]).sub(aim);
  const E0 = new THREE.Vector3(...J[(side + 1) as B]).sub(aim);
  const W0 = new THREE.Vector3(...J[(side + 2) as B]).sub(aim);
  const l1 = E0.distanceTo(S);
  const l2 = W0.distanceTo(E0);
  const to = wrist.clone().sub(S);
  const d = Math.min(Math.max(to.length(), 0.05), l1 + l2 - 1e-3);
  to.normalize();
  // The elbow: in the plane of the target and the pole, at the angle the lengths give.
  const a = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const toPole = pole.clone().sub(S);
  const n = new THREE.Vector3().crossVectors(to, toPole).normalize();
  const dirSE = to.clone().applyAxisAngle(n, a);
  const E = S.clone().addScaledVector(dirSE, l1);
  const W = S.clone().addScaledVector(to, d);
  const restU = E0.clone().sub(S).normalize();
  const restF = W0.clone().sub(E0).normalize();
  upper.quaternion.setFromUnitVectors(restU, dirSE);
  const dirEW = W.sub(E).normalize().applyQuaternion(upper.quaternion.clone().invert());
  fore.quaternion.setFromUnitVectors(restF, dirEW);
  hand.quaternion.setFromAxisAngle(restF, roll);
}

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

/**
 * Each side's kit, told apart by colour and brightness and matching its
 * vehicles' camouflage: blue in woodland green, red in desert tan (owner,
 * 2026-10-19: friend and foe were hard to tell apart; both sides wore near
 * the same olive and only the arm / helmet bands differed).
 */
const PALETTES: Record<Team, Palette> = {
  blue: { uniform: 0x343d29, uniformDark: 0x2a3121, gear: 0x252a1f, helmet: 0x2f3626, skin: 0xb3876a, boots: 0x2b241d, glove: 0x2a2620, mark: 0x3f7bd9 },
  red: { uniform: 0x8c7752, uniformDark: 0x72603f, gear: 0x5c4e36, helmet: 0x7b6845, skin: 0x9c7458, boots: 0x3a2e22, glove: 0x4a3d2c, mark: 0xc9402f },
};


/** Where the gun's grip (trigger origin) sits in model space. */
const GRIP = new THREE.Vector3(0.09, 1.4, -0.12);

/** The hands' roll about the forearm on the model (T-pose palms face down): right palm onto the grip, left under the handguard. */
const ARM_ROLL = { right: -1.2, left: 1.4 };

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
    const g = withIndex(geo);
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
  const soup = mergeGeometries(prepared, false)!;
  prepared.forEach((g) => g.dispose());
  // Each corner once (rounded boxes and the gun come as triangle soups): a third of the vertices to skin.
  const merged = weld(soup);
  soup.dispose();
  merged.computeBoundingSphere();
  return merged;
}

const geometryCache = new Map<string, { geo: THREE.BufferGeometry; muzzle: THREE.Vector3 }>();
let sharedMaterial: THREE.MeshStandardMaterial | null = null;

/** The gun as its own vertex-coloured mesh in the aim bone's frame (the model path), and the hand targets. */
const gunCache = new Map<string, { geo: THREE.BufferGeometry; muzzle: THREE.Vector3; grip: THREE.Vector3; support: THREE.Vector3 }>();
let gunMaterial: THREE.MeshStandardMaterial | null = null;
function gunMeshFor(def: WeaponDef): { geo: THREE.BufferGeometry; muzzle: THREE.Vector3; grip: THREE.Vector3; support: THREE.Vector3 } {
  const key = gunKey(def);
  let g = gunCache.get(key);
  if (g) return g;
  const gun = gunParts(def);
  const c = new THREE.Color();
  const geos = gun.parts.map(({ geo, color }) => {
    const q = withIndex(geo);
    for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k);
    const n = q.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    c.setHex(color, THREE.SRGBColorSpace);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    q.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return q.translate(-AIM0.x, -AIM0.y, -AIM0.z);
  });
  const soup = mergeGeometries(geos, false)!;
  geos.forEach((q) => q.dispose());
  const geo = weld(soup);
  soup.dispose();
  geo.computeBoundingSphere();
  g = {
    geo,
    muzzle: gun.muzzle.clone().sub(AIM0),
    grip: GRIP.clone().add(V(0, -0.04, 0.05)).sub(AIM0),
    support: gun.support.clone().add(V(0, -0.02, 0.03)).sub(AIM0),
  };
  gunCache.set(key, g);
  return g;
}

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
  /** The muzzle in the aim bone's frame. */
  private readonly muzzleAim: THREE.Vector3;
  /** Near / mid looks of the model (null on the procedural body). */
  private lod: THREE.LOD | null = null;
  /** This body's joints (the model's, or the procedural body's). */
  readonly joints: Joints;
  private phase = 0;
  private flinch = 0;
  /** Which way a hit twists the torso (-1 / 1). */
  private flinchSide = 1;
  private deathSide = 1;
  /** How the body falls: 0 back, 1 forward (running), 2 crumpling onto a side. */
  private deathKind = 0;

  constructor(team: Team, def: WeaponDef, sex: Sex = 'm') {
    const asset = soldierAsset(team, sex);
    this.joints = asset ? assetJoints(asset) : JOINTS;
    const last = asset ? B.HandR : B.ShinR;
    for (let b = B.Root; b <= last; b++) {
      const bone = new THREE.Bone();
      const [x, y, z] = this.joints[b];
      const parent = PARENT[b];
      if (parent !== -1) {
        const [px, py, pz] = this.joints[parent];
        bone.position.set(x - px, y - py, z - pz);
        this.bones[parent]!.add(bone);
      } else {
        bone.position.set(x, y, z);
      }
      this.bones.push(bone);
    }
    if (asset) {
      // The model, bound in its T-pose, then the arms bent onto this gun (once: the gun is fixed on the aim bone).
      this.mesh = new THREE.SkinnedMesh(asset.near, asset.material);
      // The bones hang off the soldier's root, not a look: whichever look is shown, they stay updated
      // (the game updates the matrices of shown objects only).
      this.root.add(this.bones[B.Root]!);
      this.root.updateMatrixWorld(true);
      const skeleton = new THREE.Skeleton(this.bones);
      this.mesh.bind(skeleton);
      // Near and mid looks on one skeleton, switched by distance.
      const mid = new THREE.SkinnedMesh(asset.mid, asset.midMaterial);
      mid.bind(skeleton, this.mesh.bindMatrix);
      mid.frustumCulled = false;
      mid.castShadow = false;
      this.lod = new THREE.LOD();
      this.lod.addLevel(this.mesh, 0);
      this.lod.addLevel(mid, MID_FROM);
      gunMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 });
      const gun = gunMeshFor(def);
      const gunMesh = new THREE.Mesh(gun.geo, gunMaterial);
      gunMesh.castShadow = false;
      this.bones[B.Aim]!.add(gunMesh);
      this.muzzleAim = gun.muzzle;
      const J = this.joints;
      const aim = new THREE.Vector3(...J[B.Aim]);
      const sR = new THREE.Vector3(...J[B.UpperArmR]).sub(aim);
      const sL = new THREE.Vector3(...J[B.UpperArmL]).sub(aim);
      // Wrists a hand's length short of where the hands hold; right elbow out and down, left under the gun.
      const wristR = gun.grip.clone().addScaledVector(gun.grip.clone().sub(sR).normalize(), -0.06);
      const wristL = gun.support.clone().addScaledVector(gun.support.clone().sub(sL).normalize(), -0.06);
      bendArm(J, this.bones[B.UpperArmR]!, this.bones[B.ForeArmR]!, this.bones[B.HandR]!, B.UpperArmR, wristR, sR.clone().add(V(0.35, -0.3, 0.1)), ARM_ROLL.right);
      bendArm(J, this.bones[B.UpperArmL]!, this.bones[B.ForeArmL]!, this.bones[B.HandL]!, B.UpperArmL, wristL, sL.clone().add(V(-0.1, -0.4, -0.15)), ARM_ROLL.left);
    } else {
      const key = `${team}:${gunKey(def)}`;
      let cached = geometryCache.get(key);
      if (!cached) {
        const gun = gunParts(def);
        cached = { geo: buildGeometry(bodyParts(PALETTES[team], gun.parts, gun.support)), muzzle: gun.muzzle };
        geometryCache.set(key, cached);
      }
      this.muzzleAim = cached.muzzle.clone().sub(AIM0);
      sharedMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
      this.mesh = new THREE.SkinnedMesh(cached.geo, sharedMaterial);
      this.mesh.add(this.bones[B.Root]!);
      this.mesh.bind(new THREE.Skeleton(this.bones));
    }
    // Shadows are static (rendered once for the map), so moving soldiers would
    // leave frozen shadows behind; BotManager draws blob shadows instead.
    this.mesh.castShadow = false;
    // Bones move the vertices outside the bind-pose bounds (crouch, death).
    this.mesh.frustumCulled = false;
    this.root.add(this.lod ?? this.mesh);
  }

  private static readonly warmed = new Set<string>();

  /** Builds the geometry for these loadouts ahead of time (it takes ~20 ms each); ones already built are skipped. */
  static prewarm(teams: readonly Team[], defs: readonly WeaponDef[]): void {
    for (const team of teams)
      for (const def of defs) {
        const key = `${team}:${gunKey(def)}`;
        if (SoldierModel.warmed.has(key)) continue;
        new SoldierModel(team, def).dispose();
        SoldierModel.warmed.add(key);
      }
  }

  /** `prewarm` in pieces of about 80 ms, with `pause` between them (the loading screen draws meanwhile). */
  static async prewarmSteps(teams: readonly Team[], defs: readonly WeaponDef[], pause: () => Promise<void>): Promise<void> {
    // The models first (once a page): the soldiers made from here on wear them.
    await loadSoldierAssets();
    let since = performance.now();
    for (const team of teams)
      for (const def of defs) {
        SoldierModel.prewarm([team], [def]);
        if (performance.now() - since > 80) {
          await pause();
          since = performance.now();
        }
      }
  }

  /** A round struck: the torso rocks back and twists, harder for heavier hits (gunplay audit, 2026-10-18). */
  onHit(damage = 25, head = false): void {
    this.flinch = Math.min(1.6, this.flinch + 0.5 + damage / 50 + (head ? 0.4 : 0));
    this.flinchSide = Math.random() < 0.5 ? -1 : 1;
  }

  /** Death (or going down): one of a few falls; running carries the body forward. */
  onDeath(speed = 0): void {
    this.deathSide = Math.random() < 0.5 ? -1 : 1;
    const r = Math.random();
    this.deathKind = speed > 4 ? (r < 0.75 ? 1 : 2) : r < 0.4 ? 0 : r < 0.7 ? 2 : 1;
  }

  /** Updates the pose; `pos` is the interpolated feet position. */
  update(pos: THREE.Vector3, p: SoldierPose): void {
    const bones = this.bones;
    this.root.position.copy(pos);
    this.root.rotation.y = p.yaw;
    this.flinch = Math.max(0, this.flinch - p.dt * 7);

    const moving = Math.min(1, p.speed / 4.5);
    this.phase += p.dt * (4 + p.speed * 1.6) * (moving > 0.05 ? 1 : 0);
    const swing = Math.sin(this.phase) * 0.55 * moving;
    const lift = Math.max(0, Math.cos(this.phase)) * 0.6 * moving;
    const liftR = Math.max(0, -Math.cos(this.phase)) * 0.6 * moving;
    const c = p.crouch;

    const hips = bones[B.Hips]!;
    hips.position.y = this.joints[B.Hips][1] - c * 0.4 + Math.abs(Math.sin(this.phase)) * 0.03 * moving;
    // Positive x swings a limb forward (-Z). Crouch is a kneel: left shin upright
    // under a raised knee, right knee on the ground with the shin trailing back.
    bones[B.ThighL]!.rotation.x = swing + c * 1.2;
    bones[B.ThighR]!.rotation.x = -swing + c * 0.1;
    bones[B.ShinL]!.rotation.x = -lift - c * 1.2;
    bones[B.ShinR]!.rotation.x = -liftR - c * 1.5;
    // Lean forward when crouched; a hit rocks the torso back.
    const fl = this.flinch;
    bones[B.Spine]!.rotation.set(-c * 0.25 + fl * 0.22, fl * this.flinchSide * 0.18, Math.sin(this.phase) * 0.04 * moving + fl * this.flinchSide * 0.08);
    bones[B.Aim]!.rotation.x = p.aimPitch + c * 0.25 + fl * 0.2;
    bones[B.Head]!.rotation.x = p.aimPitch * 0.6 + c * 0.2 + fl * 0.15;
    if (p.seated) {
      hips.position.y = this.joints[B.Hips][1] - 0.45;
      bones[B.ThighL]!.rotation.x = bones[B.ThighR]!.rotation.x = 1.45;
      bones[B.ShinL]!.rotation.x = bones[B.ShinR]!.rotation.x = -1.4;
    }

    const root = bones[B.Root]!;
    if (p.deadFor >= 0) {
      // Knees give, then the body topples: back, forward onto the face, or
      // crumpling round onto a side.
      const t = Math.min(1, p.deadFor / (this.deathKind === 1 ? 0.5 : 0.6));
      const e = t * t;
      const s = this.deathSide;
      if (this.deathKind === 1) root.rotation.set(-e * 1.45, 0, s * e * 0.2);
      else if (this.deathKind === 2) root.rotation.set(e * 0.35, s * e * 0.6, s * e * 1.4);
      else root.rotation.set(e * 1.35, 0, s * e * 0.35);
      root.position.y = -e * (this.deathKind === 2 ? 0.2 : 0.1);
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
    return out.copy(this.muzzleAim).applyMatrix4(aim.matrixWorld);
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
  const asset = soldierAsset(team, 'm');
  // Posed by a normal soldier (same skeleton and animation code).
  const poser = new SoldierModel(team, WEAPONS.ar1);
  const p: SoldierPose = { speed: pose === 'run' ? 6 : 0, crouch: pose === 'crouch' ? 1 : 0, yaw: 0, aimPitch: 0, deadFor: -1, dt: 0 };
  // Mid-stride: the walk phase advances by dt * (4 + speed * 1.6).
  if (pose === 'run') poser.update(new THREE.Vector3(), { ...p, dt: Math.PI / 2 / (4 + 6 * 1.6) });
  poser.update(new THREE.Vector3(), p);
  const skin = poser.boneMatrices();
  const aimJoint = new THREE.Vector3(...poser.joints[B.Aim]);
  poser.dispose();
  if (asset) return farFromModel(asset, skin, aimJoint);

  lowDetail = true;
  const gun = farGunParts();
  const parts = bodyParts(PALETTES[team], gun.parts, gun.support).filter((q) => !tiny(q.geo));
  lowDetail = false;
  const c = new THREE.Color();
  const geos = parts.map(({ geo, bone, color }) => {
    const g = withIndex(geo).applyMatrix4(skin[bone]!);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    c.setHex(color, THREE.SRGBColorSpace);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const soup = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  const merged = weld(soup);
  soup.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** The far crowd's soldier from the model's far look: skinned on the CPU into the pose, with a plain rifle painted the texture's darkest texel. */
function farFromModel(asset: SoldierAsset, skin: THREE.Matrix4[], aimJoint: THREE.Vector3): THREE.BufferGeometry {
  const src = asset.far;
  const pos = src.getAttribute('position');
  const nrm = src.getAttribute('normal');
  const si = src.getAttribute('skinIndex');
  const sw = src.getAttribute('skinWeight');
  const n = pos.count;
  const p = new Float32Array(n * 3);
  const nr = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  const vn = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const accN = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (let i = 0; i < n; i++) {
    acc.set(0, 0, 0);
    accN.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w <= 0) continue;
      const m = skin[si.getComponent(i, k)]!;
      acc.addScaledVector(v.fromBufferAttribute(pos, i).applyMatrix4(m), w);
      accN.addScaledVector(vn.fromBufferAttribute(nrm, i).applyMatrix3(nm.getNormalMatrix(m)), w);
    }
    acc.toArray(p, i * 3);
    accN.normalize().toArray(nr, i * 3);
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.BufferAttribute(p, 3));
  body.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  body.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(Array.from({ length: n * 2 }, (_, i) => (src.getAttribute('uv') as THREE.BufferAttribute).getComponent(Math.floor(i / 2), i % 2))), 2));
  body.setIndex(src.getIndex()!.clone());
  // The plain rifle, laid out against the procedural aim joint, moved onto the model's and posed with the aim bone.
  const gunGeos = farGunParts().parts.map(({ geo }) => {
    const g = withIndex(geo).translate(aimJoint.x - AIM0.x, aimJoint.y - AIM0.y, aimJoint.z - AIM0.z).applyMatrix4(skin[B.Aim]!);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const uv = new Float32Array(g.getAttribute('position').count * 2);
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] = asset.dark[0];
      uv[i + 1] = asset.dark[1];
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  });
  const merged = mergeGeometries([body, ...gunGeos], false)!;
  body.dispose();
  gunGeos.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
}

/** The far crowd's material for a side: the model's texture, or the procedural body's vertex colours. */
export function farSoldierMaterial(team: Team): THREE.Material | null {
  return soldierAsset(team, 'm')?.farMaterial ?? null;
}
