import * as THREE from 'three';
import { Layer, RAPIER, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { HitPart } from '@/core/events';
import type { Damageable, HitboxRegistry } from './Hitboxes';

const MAX_HP = 100;
const RESPAWN_SEC = 2.5;
const FALL_SEC = 0.3;

let nextId = 1;

/** Humanoid-sized practice target with head/body/leg hitboxes. Respawns after death. */
export class TargetDummy implements Damageable {
  readonly id = nextId++;
  readonly name = `Target ${this.id}`;
  readonly group = new THREE.Group();
  private hp = MAX_HP;
  private deadTimer = 0;
  private flash = 0;
  private readonly colliders: RAPIER.Collider[] = [];
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly pivot = new THREE.Group();

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    registry: HitboxRegistry,
    pos: THREE.Vector3,
    yaw: number,
  ) {
    this.group.position.copy(pos);
    this.group.rotation.y = yaw;
    this.group.add(this.pivot);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd07a2c, roughness: 0.45, metalness: 0 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xe0a96b, roughness: 0.4, metalness: 0 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3f4650, roughness: 0.7, metalness: 0 });
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.6 });
    this.materials.push(bodyMat, headMat, legMat);

    // Visual mannequin; hitboxes below use matching extents (legs 0-0.9, torso 0.9-1.5, head ~1.64).
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.z = rz;
      mesh.castShadow = true;
      this.pivot.add(mesh);
      return mesh;
    };
    for (const sx of [-0.1, 0.1]) {
      part(new THREE.CapsuleGeometry(0.075, 0.62, 4, 10), legMat, sx, 0.46);
      part(new THREE.SphereGeometry(0.05, 10, 8), jointMat, sx, 0.47, 0.05);
    }
    part(new THREE.CapsuleGeometry(0.1, 0.12, 4, 10), legMat, 0, 0.9).scale.set(1.6, 1, 1);
    const torso = part(new THREE.CapsuleGeometry(0.2, 0.26, 6, 14), bodyMat, 0, 1.22);
    torso.scale.set(1.05, 1, 0.62);
    for (const sx of [-1, 1]) {
      part(new THREE.CapsuleGeometry(0.055, 0.48, 4, 8), bodyMat, sx * 0.29, 1.15, 0, sx * 0.12);
    }
    part(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), jointMat, 0, 1.5);
    part(new THREE.SphereGeometry(0.13, 20, 16), headMat, 0, 1.64);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.04, 20), jointMat);
    base.position.y = 0.02;
    base.receiveShadow = true;
    this.group.add(base);
    scene.add(this.group);

    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const add = (desc: RAPIER.ColliderDesc, y: number, part: HitPart) => {
      desc.setTranslation(pos.x, pos.y + y, pos.z).setRotation(q);
      const c = physics.addKinematicShape(desc, Layer.HITBOX);
      registry.register(c.handle, this, part);
      this.colliders.push(c);
    };
    add(RAPIER.ColliderDesc.cuboid(0.2, 0.45, 0.12), 0.45, 'limb');
    add(RAPIER.ColliderDesc.cuboid(0.25, 0.3, 0.14), 1.2, 'body');
    add(RAPIER.ColliderDesc.ball(0.13), 1.64, 'head');
  }

  /** Chest height point used for explosion checks. */
  get center(): THREE.Vector3 {
    return this.group.position.clone().setY(this.group.position.y + 1.15);
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  applyDamage(amount: number, _part: HitPart): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flash = 0.08;
    if (this.hp <= 0) {
      this.hp = 0;
      this.deadTimer = RESPAWN_SEC;
      for (const c of this.colliders) c.setEnabled(false);
      return true;
    }
    return false;
  }

  update(dt: number): void {
    this.flash = Math.max(0, this.flash - dt);
    const emissive = this.flash > 0 ? 0x661111 : 0x000000;
    for (const m of this.materials) m.emissive.setHex(emissive);

    if (this.alive) {
      this.pivot.rotation.x = 0;
      return;
    }
    this.deadTimer -= dt;
    const fallT = Math.min(1, (RESPAWN_SEC - this.deadTimer) / FALL_SEC);
    this.pivot.rotation.x = (-Math.PI / 2) * (1 - (1 - fallT) ** 2);
    if (this.deadTimer <= 0) {
      this.hp = MAX_HP;
      for (const c of this.colliders) c.setEnabled(true);
    }
  }
}
