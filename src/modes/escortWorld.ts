import * as THREE from 'three';
import { Layer, RAPIER, type PhysicsWorld } from '@/physics/PhysicsWorld';
import { VEHICLES } from '@/vehicles/vehicleData';
import { buildVehicleModel, type VehicleModel } from '@/vehicles/vehicleModels';
import type { Team } from '@/world/mapTypes';
import type { EscortRules } from './matchRules';

/** The payload's hull: the APC's (its chassis centre sits this high over the road). */
const HALF = VEHICLES.apc.half;
const RIDE = 1.35;

/**
 * Escort's payload in the world: an APC that follows the rules' place along
 * the route, with a solid hull (cover; it blocks sight lines like any
 * vehicle). On the game server there is no model, only the hull.
 */
export class EscortWorld {
  private readonly collider: RAPIER.Collider;
  private readonly model: VehicleModel | null;
  private readonly prev = new THREE.Vector3();
  private readonly next = new THREE.Vector3();
  private prevYaw = 0;
  private nextYaw = 0;
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly physics: PhysicsWorld,
    scene: THREE.Scene | null,
    team: Team,
  ) {
    this.collider = physics.addKinematicShape(RAPIER.ColliderDesc.cuboid(HALF[0], HALF[1], HALF[2]), Layer.WORLD);
    physics.trackOccluder(this.collider);
    this.model = scene ? buildVehicleModel('apc', team) : null;
    if (this.model) scene!.add(this.model.root);
  }

  /** After a sim step: the hull to where the rules have the payload now. */
  step(m: EscortRules): void {
    this.prev.copy(this.next);
    this.prevYaw = this.nextYaw;
    this.next.set(m.pos.x, m.pos.y + RIDE, m.pos.z);
    this.nextYaw = m.yaw;
    const body = this.collider.parent();
    this.q.setFromAxisAngle(this.up, m.yaw);
    body?.setNextKinematicTranslation(this.next);
    body?.setNextKinematicRotation(this.q);
  }

  /** Render: the model between the last two steps. */
  render(alpha: number): void {
    const root = this.model?.root;
    if (!root) return;
    if (this.prev.lengthSq() === 0) this.prev.copy(this.next);
    root.position.lerpVectors(this.prev, this.next, alpha);
    let d = this.nextYaw - this.prevYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    root.rotation.set(0, this.prevYaw + d * alpha, 0);
  }

  dispose(): void {
    this.physics.untrackOccluder(this.collider);
    const body = this.collider.parent();
    if (body) this.physics.world.removeRigidBody(body);
    this.model?.root.removeFromParent();
  }
}
