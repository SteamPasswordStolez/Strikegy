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

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9772f, roughness: 0.7 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.6 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x4d5560, roughness: 0.8 });
    this.materials.push(bodyMat, headMat, legMat);

    // Geometry and hitboxes share dimensions: legs 0-0.9, torso 0.9-1.5, head ~1.62.
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 0.24), legMat);
    legs.position.y = 0.45;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.28), bodyMat);
    torso.position.y = 1.2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), headMat);
    head.position.y = 1.64;
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x333333 }),
    );
    post.position.y = 0.15;
    for (const m of [legs, torso, head]) {
      m.castShadow = true;
      this.pivot.add(m);
    }
    this.group.add(post);
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
