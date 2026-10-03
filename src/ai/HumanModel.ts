import * as THREE from 'three';
import type { Team } from '@/world/mapTypes';
import type { WeaponDef } from '@/weapons/weaponData';
import { botGun, type SoldierPose } from './SoldierModel';

/**
 * Soldiers from the packed character (public/assets/soldier/soldier.bin, built
 * by scripts/assets/build-soldier.mjs from Mixamo assets): a skinned mesh with
 * two levels of detail and clips sampled here directly — locomotion blended by
 * direction and speed, an upper-body layer for reloading / firing / flinching,
 * a death fall, and the aim pitch bent into the spine. Same API as SoldierModel.
 */

interface PackClip {
  id: string;
  loop: boolean;
  frames: number;
  fps: number;
  duration: number;
  /** Per bone: rotation frames (int16 x4, one frame when constant) or null (rest pose). */
  rot: (Int16Array | null)[];
  hip: Int16Array | null;
}

export interface SoldierPack {
  boneNames: string[];
  parents: number[];
  restT: Float32Array;
  restQ: Float32Array;
  inverses: THREE.Matrix4[];
  scale: number;
  lods: THREE.BufferGeometry[];
  materials: Record<Team, THREE.MeshStandardMaterial>;
  clips: Map<string, PackClip>;
  /** Bones from the spine up (the upper-body layer). */
  upper: boolean[];
  /** Gun in the right hand's frame, worked out from the aiming pose (used while reloading). */
  gunInHand: THREE.Matrix4;
  hand: number;
  /** Palm points: right grip (middle finger root) and left hand on the handguard. */
  gripR: number;
  gripL: number;
  spine: number[];
  hips: number;
}

let pack: SoldierPack | null = null;
let loading: Promise<SoldierPack | null> | null = null;

/** The loaded character, or null (not loaded / failed: SoldierModel stays in use). */
export function soldierPack(): SoldierPack | null {
  return pack;
}

/** Loads the character once. Resolves null when the file is missing or broken. */
export function loadSoldierPack(url: string): Promise<SoldierPack | null> {
  loading ??= (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      pack = await parsePack(await res.arrayBuffer());
      return pack;
    } catch (err) {
      console.warn('[soldier] character pack failed, using the procedural soldier', err);
      return null;
    }
  })();
  return loading;
}

async function parsePack(buf: ArrayBuffer): Promise<SoldierPack> {
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'STKS') throw new Error('not a soldier pack');
  const hlen = dv.getUint32(4, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hlen))) as {
    scale: number;
    bones: { n: string; p: number; t: number[]; r: number[] }[];
    inverses: number;
    vertexCount: number;
    position: number;
    normal: number;
    uv: number;
    skinIndex: number;
    skinWeight: number;
    lods: { count: number; off: number; wide: boolean }[];
    albedo: { off: number; len: number };
    albedoRed: { off: number; len: number };
    normalMap: { off: number; len: number };
    clips: { id: string; loop: boolean; frames: number; fps: number; tracks: { b: number; p: 'q' | 'p'; n: number; off: number }[] }[];
  };
  const base = 8 + hlen;
  const at = <T>(Ctor: new (b: ArrayBuffer, o: number, n: number) => T, off: number, n: number): T => new Ctor(buf, base + off, n);
  const nb = h.bones.length;
  const restT = new Float32Array(nb * 3);
  const restQ = new Float32Array(nb * 4);
  h.bones.forEach((b, i) => {
    restT.set(b.t, i * 3);
    restQ.set(b.r, i * 4);
  });
  const invArr = at(Float32Array, h.inverses, nb * 16);
  const inverses = Array.from({ length: nb }, (_, i) => new THREE.Matrix4().fromArray(invArr, i * 16));

  const n = h.vertexCount;
  const geoBase = new THREE.BufferGeometry();
  geoBase.setAttribute('position', new THREE.BufferAttribute(at(Float32Array, h.position, n * 3), 3));
  geoBase.setAttribute('normal', new THREE.BufferAttribute(at(Int8Array, h.normal, n * 4), 4, true));
  geoBase.setAttribute('uv', new THREE.BufferAttribute(at(Uint16Array, h.uv, n * 2), 2, true));
  geoBase.setAttribute('skinIndex', new THREE.BufferAttribute(at(Uint8Array, h.skinIndex, n * 4), 4));
  geoBase.setAttribute('skinWeight', new THREE.BufferAttribute(at(Uint8Array, h.skinWeight, n * 4), 4, true));
  const lods = h.lods.map((l) => {
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(geoBase.attributes)) g.setAttribute(k, a);
    g.setIndex(new THREE.BufferAttribute(l.wide ? at(Uint32Array, l.off, l.count) : at(Uint16Array, l.off, l.count), 1));
    g.computeBoundingSphere();
    return g;
  });

  const tex = async (t: { off: number; len: number }, srgb: boolean) => {
    const img = await createImageBitmap(new Blob([new Uint8Array(buf, base + t.off, t.len)], { type: 'image/webp' }), { imageOrientation: 'flipY' });
    const texture = new THREE.Texture(img);
    texture.flipY = false;
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  };
  const [albedo, albedoRed, normalMap] = await Promise.all([tex(h.albedo, true), tex(h.albedoRed, true), tex(h.normalMap, false)]);
  const mat = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.78, metalness: 0.04 });
  const materials: Record<Team, THREE.MeshStandardMaterial> = { blue: mat(albedo), red: mat(albedoRed) };

  const clips = new Map<string, PackClip>();
  for (const c of h.clips) {
    const rot: (Int16Array | null)[] = new Array(nb).fill(null);
    let hip: Int16Array | null = null;
    for (const t of c.tracks) {
      if (t.p === 'q') rot[t.b] = at(Int16Array, t.off, t.n * 4);
      else hip = at(Int16Array, t.off, t.n * 3);
    }
    clips.set(c.id, { id: c.id, loop: c.loop, frames: c.frames, fps: c.fps, duration: (c.frames - 1) / c.fps, rot, hip });
  }

  const names = h.bones.map((b) => b.n);
  const idx = (n: string) => names.indexOf(`mixamorig${n}`);
  const parents = h.bones.map((b) => b.p);
  const spineRoot = idx('Spine');
  const upper = names.map((_, i) => {
    for (let b = i; b >= 0; b = parents[b]!) if (b === spineRoot) return true;
    return false;
  });
  const p: SoldierPack = {
    boneNames: names,
    parents,
    restT,
    restQ,
    inverses,
    scale: h.scale,
    lods,
    materials,
    clips,
    upper,
    gunInHand: new THREE.Matrix4(),
    hand: idx('RightHand'),
    gripR: idx('RightHandMiddle1'),
    gripL: idx('LeftHandMiddle1'),
    spine: [idx('Spine'), idx('Spine1'), idx('Spine2')],
    hips: idx('Hips'),
  };
  p.gunInHand = gunGrip(p);
  return p;
}

/**
 * The gun's place in the right hand: in the aiming pose the barrel points
 * straight ahead at the hand, so express "at the hand, facing forward" in the
 * hand bone's frame once; every other pose then carries the gun with the hand.
 */
function gunGrip(p: SoldierPack): THREE.Matrix4 {
  const bones = makeBones(p);
  const q = new Float32Array(bones.length * 4);
  const hip = new Float32Array(3);
  q.set(p.restQ);
  sample(p, p.clips.get('aim')!, 0, 1, q, hip, null, true);
  applyPose(p, bones, q, hip);
  bones[0]!.updateMatrixWorld(true);
  const hand = bones[p.hand]!.matrixWorld;
  const handPos = new THREE.Vector3().setFromMatrixPosition(hand);
  // Character space: forward is +Z (Mixamo); our gun model points along -Z, so turn it half round.
  const want = new THREE.Matrix4().compose(handPos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), new THREE.Vector3(1 / p.scale, 1 / p.scale, 1 / p.scale));
  return hand.clone().invert().multiply(want);
}

function makeBones(p: SoldierPack): THREE.Bone[] {
  const bones = p.boneNames.map((n) => {
    const b = new THREE.Bone();
    b.name = n;
    return b;
  });
  bones.forEach((b, i) => {
    b.position.fromArray(p.restT, i * 3);
    b.quaternion.fromArray(p.restQ, i * 4);
    const parent = p.parents[i]!;
    if (parent >= 0) bones[parent]!.add(b);
  });
  return bones;
}

const Q = 1 / 32767;

/**
 * Adds clip `c` at time `t` with weight `w` into the pose accumulators
 * (quaternions summed with the sign of the first contribution, then
 * normalised by the caller). `mask`: only these bones (null = all).
 * `replace`: write instead of add.
 */
function sample(p: SoldierPack, c: PackClip, t: number, w: number, q: Float32Array, hip: Float32Array, mask: boolean[] | null, replace = false): void {
  const f = Math.max(0, Math.min(c.frames - 1, t * c.fps));
  const f0 = Math.floor(f);
  const f1 = Math.min(c.frames - 1, f0 + 1);
  const k = f - f0;
  for (let b = 0; b < c.rot.length; b++) {
    if (mask && !mask[b]) continue;
    const r = c.rot[b];
    let x: number, y: number, z: number, ww: number;
    if (!r) {
      x = p.restQ[b * 4]!;
      y = p.restQ[b * 4 + 1]!;
      z = p.restQ[b * 4 + 2]!;
      ww = p.restQ[b * 4 + 3]!;
    } else if (r.length === 4) {
      x = r[0]! * Q;
      y = r[1]! * Q;
      z = r[2]! * Q;
      ww = r[3]! * Q;
    } else {
      const a = f0 * 4;
      const bb = f1 * 4;
      // Neighbouring frames are close: a straight blend is fine before normalising.
      const s = r[a]! * r[bb]! + r[a + 1]! * r[bb + 1]! + r[a + 2]! * r[bb + 2]! + r[a + 3]! * r[bb + 3]! < 0 ? -1 : 1;
      x = (r[a]! * (1 - k) + s * r[bb]! * k) * Q;
      y = (r[a + 1]! * (1 - k) + s * r[bb + 1]! * k) * Q;
      z = (r[a + 2]! * (1 - k) + s * r[bb + 2]! * k) * Q;
      ww = (r[a + 3]! * (1 - k) + s * r[bb + 3]! * k) * Q;
    }
    const o = b * 4;
    if (replace) {
      q[o] = x * w;
      q[o + 1] = y * w;
      q[o + 2] = z * w;
      q[o + 3] = ww * w;
      continue;
    }
    const sign = q[o]! * x + q[o + 1]! * y + q[o + 2]! * z + q[o + 3]! * ww < 0 ? -w : w;
    q[o]! += x * sign;
    q[o + 1]! += y * sign;
    q[o + 2]! += z * sign;
    q[o + 3]! += ww * sign;
  }
  if (c.hip && (!mask || mask[p.hips])) {
    const h = c.hip;
    const a = h.length === 3 ? 0 : f0 * 3;
    const bb = h.length === 3 ? 0 : f1 * 3;
    for (let i = 0; i < 3; i++) {
      const v = (h[a + i]! * (1 - k) + h[bb + i]! * k) * 0.1;
      if (replace) hip[i] = v * w;
      else hip[i]! += v * w;
    }
  }
}

function applyPose(p: SoldierPack, bones: THREE.Bone[], q: Float32Array, hip: Float32Array): void {
  for (let b = 0; b < bones.length; b++) {
    const o = b * 4;
    const l = Math.hypot(q[o]!, q[o + 1]!, q[o + 2]!, q[o + 3]!);
    if (l > 1e-6) bones[b]!.quaternion.set(q[o]! / l, q[o + 1]! / l, q[o + 2]! / l, q[o + 3]! / l);
  }
  bones[p.hips]!.position.set(hip[0]!, hip[1]!, hip[2]!);
}

/** Locomotion sets: clip ids by direction (f, fr, r, br, b, bl, l, fl) and the speed (m/s) they were made at. */
const DIRS = ['f', 'fl', 'l', 'bl', 'b', 'br', 'r', 'fr'] as const;
const SETS = {
  walk: { prefix: 'walk_', speed: 1.5 },
  run: { prefix: 'run_', speed: 4.2 },
  crouch: { prefix: 'cwalk_', speed: 1.4 },
} as const;
const UPPER_FADE = 8;
/** Distance (m) past which the lighter level of detail is drawn. */
const LOD1_DIST = 22;
/** Past LOD1_DIST poses update every 2nd frame, past this every 3rd. */
const POSE_HALF_DIST = 45;

export class HumanModel {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  private readonly bones: THREE.Bone[];
  private readonly gun: THREE.Mesh;
  private readonly muzzleLocal: THREE.Vector3;
  private readonly q: Float32Array;
  private readonly hip = new Float32Array(3);
  private phase = 0;
  private flinch = 0;
  private fireT = 1;
  private reloadT = -1;
  private upperW = 0;
  private death = 'death_front';
  private aimHold = 0;
  private tick = 0;
  private owed = 0;

  constructor(
    team: Team,
    def: WeaponDef,
    private readonly p: SoldierPack = pack!,
  ) {
    this.bones = makeBones(p);
    this.q = new Float32Array(this.bones.length * 4);
    this.mesh = new THREE.SkinnedMesh(p.lods[0]!, p.materials[team]);
    this.mesh.add(this.bones[0]!);
    this.mesh.bind(new THREE.Skeleton(this.bones, p.inverses), new THREE.Matrix4());
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.scale.setScalar(p.scale);
    // Mixamo faces +Z; ours face -Z.
    this.mesh.rotation.y = Math.PI;
    this.root.add(this.mesh);
    const g = botGun(def);
    this.gun = new THREE.Mesh(g.geo, gunMaterial());
    this.gun.matrixAutoUpdate = false;
    this.gun.matrix.copy(p.gunInHand);
    this.muzzleLocal = g.muzzle;
    this.bones[p.hand]!.add(this.gun);
  }

  onHit(): void {
    this.flinch = 1;
  }

  onDeath(): void {
    const all = ['death_front', 'death_back', 'death_right', 'death_head_front', 'death_head_back'];
    this.death = all[Math.floor(Math.random() * all.length)]!;
  }

  /** Shot fired (upper-body kick). */
  onFire(): void {
    this.fireT = 0;
  }

  /** Updates the pose; `pos` is the interpolated feet position. */
  update(pos: THREE.Vector3, s: SoldierPose & { moveYaw?: number; reloading?: boolean; firing?: boolean; distance?: number }): void {
    const p = this.p;
    const q = this.q;
    const hip = this.hip;
    this.root.position.copy(pos);
    this.root.rotation.y = s.yaw;
    const dist = s.distance ?? 0;
    const lod = dist > LOD1_DIST ? 1 : 0;
    if (this.mesh.geometry !== p.lods[lod]) this.mesh.geometry = p.lods[lod]!;
    // Further off, the pose is worked out every 2nd / 3rd frame with the time in between.
    this.owed += s.dt;
    const every = s.deadFor >= 0 || dist < LOD1_DIST ? 1 : dist < POSE_HALF_DIST ? 2 : 3;
    if (++this.tick % every !== 0) return;
    s = { ...s, dt: this.owed };
    this.owed = 0;
    q.fill(0);
    hip.fill(0);

    if (s.deadFor >= 0) {
      const c = p.clips.get(s.crouch > 0.5 ? 'death_crouch' : this.death)!;
      sample(p, c, Math.min(c.duration, s.deadFor), 1, q, hip, null, true);
      applyPose(p, this.bones, q, hip);
      return;
    }

    // Locomotion: the two direction clips either side of the way we move, blended
    // between walking and running by speed; one shared phase keeps the feet in step.
    const speed = s.seated ? 0 : s.speed;
    const crouch = s.seated ? 1 : s.crouch;
    this.aimHold = s.firing ? 2 : Math.max(0, this.aimHold - s.dt);
    const idleId = crouch > 0.5 ? (this.aimHold > 0 ? 'crouch_aim' : 'crouch') : this.aimHold > 0 ? 'aim' : 'idle';
    const idle = p.clips.get(idleId)!;
    const moving = Math.min(1, speed / 0.6);
    if (moving < 1) sample(p, idle, (performance.now() / 1000) % idle.duration, 1 - moving, q, hip, null);
    if (moving > 0) {
      const rel = THREE.MathUtils.euclideanModulo((s.moveYaw ?? s.yaw) - s.yaw, Math.PI * 2);
      const sector = rel / (Math.PI / 4);
      const d0 = Math.floor(sector) % 8;
      const d1 = (d0 + 1) % 8;
      const kd = sector - Math.floor(sector);
      const sets = crouch > 0.5 ? [[SETS.crouch, 1]] : speed < SETS.walk.speed ? [[SETS.walk, 1]] : speed > SETS.run.speed ? [[SETS.run, 1]] : [[SETS.walk, 1 - (speed - SETS.walk.speed) / (SETS.run.speed - SETS.walk.speed)], [SETS.run, (speed - SETS.walk.speed) / (SETS.run.speed - SETS.walk.speed)]];
      // Advance the phase at the rate of the dominant set's clip at this speed.
      const lead = sets.reduce((a, b) => ((b[1] as number) > (a[1] as number) ? b : a));
      const leadSet = lead[0] as (typeof SETS)[keyof typeof SETS];
      const leadClip = p.clips.get(`${leadSet.prefix}${DIRS[d0]}`)!;
      this.phase = (this.phase + (s.dt * Math.max(0.6, speed / leadSet.speed)) / leadClip.duration) % 1;
      for (const [set, ws] of sets as [(typeof SETS)[keyof typeof SETS], number][]) {
        for (const [dir, wd] of [[d0, 1 - kd], [d1, kd]] as const) {
          const w = moving * ws * wd;
          if (w < 0.01) continue;
          const c = p.clips.get(`${set.prefix}${DIRS[dir]}`)!;
          sample(p, c, this.phase * c.duration, w, q, hip, null);
        }
      }
    }

    // Upper body: reload, the kick of a shot, a flinch when hit.
    if (s.reloading) this.reloadT = this.reloadT < 0 ? 0 : this.reloadT + s.dt;
    else this.reloadT = -1;
    this.fireT += s.dt;
    this.flinch = Math.max(0, this.flinch - s.dt * 2.5);
    const upper = this.reloadT >= 0 ? 'reload' : this.flinch > 0 ? 'hit' : this.fireT < 0.3 ? 'fire' : null;
    this.upperW += ((upper ? 1 : 0) - this.upperW) * Math.min(1, s.dt * UPPER_FADE);
    if (upper && this.upperW > 0.01) {
      const c = p.clips.get(upper)!;
      const t = upper === 'reload' ? this.reloadT : upper === 'hit' ? (1 - this.flinch) * 0.6 : this.fireT;
      const w = upper === 'hit' ? this.upperW * 0.6 : this.upperW;
      // Normalise what's there first so the layer's weight means the same at any blend.
      this.normaliseUpper();
      for (let b = 0; b < this.bones.length; b++) if (p.upper[b]) for (let i = 0; i < 4; i++) q[b * 4 + i]! *= 1 - w;
      sample(p, c, Math.min(c.duration, t), w, q, hip, p.upper);
    }
    applyPose(p, this.bones, q, hip);

    // Aim up / down: bend the three spine bones about the body's side axis.
    const pitch = -s.aimPitch / 3;
    if (Math.abs(pitch) > 1e-3) {
      for (const b of p.spine) {
        const bone = this.bones[b]!;
        bone.quaternion.premultiply(tmpQ.setFromAxisAngle(AXIS_X, pitch));
      }
    }
    this.placeGun(this.reloadT >= 0);
  }

  /**
   * The rifle lies along the line from the right palm to the left: that keeps
   * it in both hands in every clip (they hold it low when running, shouldered
   * when aiming). While reloading the left hand is off the gun, so it rides in
   * the right hand at the aiming grip instead.
   */
  private placeGun(inRightHand: boolean): void {
    const p = this.p;
    if (inRightHand) {
      this.gun.matrix.copy(p.gunInHand);
      return;
    }
    // Only the two arm chains (each call updates a bone's ancestors), not the whole skeleton.
    this.bones[p.gripR]!.updateWorldMatrix(true, false);
    this.bones[p.gripL]!.updateWorldMatrix(true, false);
    const r = tmpA.setFromMatrixPosition(this.bones[p.gripR]!.matrixWorld);
    const l = tmpB.setFromMatrixPosition(this.bones[p.gripL]!.matrixWorld);
    const fwd = tmpC.subVectors(l, r);
    const len = fwd.length();
    if (len < 0.12 || len > 0.8) {
      this.gun.matrix.copy(p.gunInHand);
      return;
    }
    fwd.divideScalar(len);
    // Gun model looks along -Z with +Y up: build its frame from the barrel line and world up.
    const back = tmpD.copy(fwd).negate();
    const side = tmpE.crossVectors(UP, back).normalize();
    const up = tmpF.crossVectors(back, side);
    tmpM.makeBasis(side, up, back).setPosition(r);
    this.gun.matrix.copy(tmpN.copy(this.bones[p.hand]!.matrixWorld).invert().multiply(tmpM));
  }

  private normaliseUpper(): void {
    const q = this.q;
    for (let b = 0; b < this.bones.length; b++) {
      if (!this.p.upper[b]) continue;
      const o = b * 4;
      const l = Math.hypot(q[o]!, q[o + 1]!, q[o + 2]!, q[o + 3]!) || 1;
      for (let i = 0; i < 4; i++) q[o + i]! /= l;
    }
  }

  /** Muzzle position in world space (after update). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    this.gun.updateWorldMatrix(true, false);
    return out.copy(this.muzzleLocal).applyMatrix4(this.gun.matrixWorld);
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

const tmpQ = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpE = new THREE.Vector3();
const tmpF = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpN = new THREE.Matrix4();
let gunMat: THREE.MeshStandardMaterial | null = null;
function gunMaterial(): THREE.MeshStandardMaterial {
  return (gunMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }));
}

/**
 * A soldier frozen in one pose for the far crowd: the light level of detail
 * skinned on the CPU once (in metres, facing -Z, feet at 0), with a rifle
 * between the hands. Drawn instanced, one draw call per side and pose.
 */
export function farHuman(p: SoldierPack, clip: 'aim' | 'run_f', def: WeaponDef): THREE.BufferGeometry {
  const bones = makeBones(p);
  const q = new Float32Array(bones.length * 4);
  const hip = new Float32Array(3);
  const c = p.clips.get(clip)!;
  sample(p, c, c.duration * 0.25, 1, q, hip, null, true);
  applyPose(p, bones, q, hip);
  bones[0]!.updateMatrixWorld(true);
  const skin = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, p.inverses[i]!));
  // Character space (cm, facing +Z) -> ours (m, facing -Z).
  const toOurs = new THREE.Matrix4().makeRotationY(Math.PI).multiply(new THREE.Matrix4().makeScale(p.scale, p.scale, p.scale));

  const src = p.lods[1]!;
  const index = src.getIndex()!;
  const pos = src.getAttribute('position');
  const nor = src.getAttribute('normal');
  const uv = src.getAttribute('uv');
  const si = src.getAttribute('skinIndex');
  const sw = src.getAttribute('skinWeight');
  const remap = new Map<number, number>();
  const outPos: number[] = [];
  const outNor: number[] = [];
  const outUv: number[] = [];
  const outIdx: number[] = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const accN = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (let i = 0; i < index.count; i++) {
    const vi = index.getX(i);
    let o = remap.get(vi);
    if (o === undefined) {
      v.fromBufferAttribute(pos, vi);
      n.set(nor.getX(vi), nor.getY(vi), nor.getZ(vi));
      acc.set(0, 0, 0);
      accN.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(vi, k);
        if (w <= 0) continue;
        const m = skin[si.getComponent(vi, k)]!;
        acc.addScaledVector(tmp.copy(v).applyMatrix4(m), w);
        accN.addScaledVector(tmp.copy(n).applyMatrix3(nm.getNormalMatrix(m)), w);
      }
      acc.applyMatrix4(toOurs);
      accN.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI)).normalize();
      o = outPos.length / 3;
      outPos.push(acc.x, acc.y, acc.z);
      outNor.push(accN.x, accN.y, accN.z);
      outUv.push(uv.getX(vi), uv.getY(vi));
      remap.set(vi, o);
    }
    outIdx.push(o);
  }

  // Rifle along the line between the palms, sampled from a dark corner of the atlas.
  const r = new THREE.Vector3().setFromMatrixPosition(bones[p.gripR]!.matrixWorld).applyMatrix4(toOurs);
  const l = new THREE.Vector3().setFromMatrixPosition(bones[p.gripL]!.matrixWorld).applyMatrix4(toOurs);
  const gun = botGun(def).geo;
  const fwd = l.clone().sub(r).normalize();
  const back = fwd.clone().negate();
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
  const up = new THREE.Vector3().crossVectors(back, side);
  const gm = new THREE.Matrix4().makeBasis(side, up, back).setPosition(r);
  const gp = gun.getAttribute('position');
  const gn = gun.getAttribute('normal');
  const base = outPos.length / 3;
  for (let i = 0; i < gp.count; i++) {
    v.fromBufferAttribute(gp, i).applyMatrix4(gm);
    n.fromBufferAttribute(gn, i).transformDirection(gm);
    outPos.push(v.x, v.y, v.z);
    outNor.push(n.x, n.y, n.z);
    outUv.push(0.012, 0.985);
    outIdx.push(base + i);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(outNor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2));
  geo.setIndex(outIdx);
  geo.computeBoundingSphere();
  return geo;
}
