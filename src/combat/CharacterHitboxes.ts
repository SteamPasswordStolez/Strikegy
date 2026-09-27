import { Layer, RAPIER, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { HitPart } from '@/core/events';
import type { Damageable, HitboxRegistry } from './Hitboxes';

/** Hitbox layout for a standing character (feet at 0): center height and half extents. */
const STAND = {
  legs: { y: 0.45, he: [0.18, 0.45, 0.12] as const },
  torso: { y: 1.2, he: [0.24, 0.3, 0.15] as const },
  head: { y: 1.64, r: 0.13 },
};

/**
 * Head / torso / legs hitboxes on one kinematic body that follows a character
 * (player or bot). Shots from the owner exclude this body.
 */
export class CharacterHitboxes {
  readonly body: RAPIER.RigidBody;
  private readonly legs: RAPIER.Collider;
  private readonly torso: RAPIER.Collider;
  private readonly head: RAPIER.Collider;
  private lastHeight = -1;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly registry: HitboxRegistry,
    owner: Damageable,
  ) {
    const world = physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    // Hit only by queries: a filter that matches no other collider keeps them out of broad-phase pairs.
    const g = ((Layer.HITBOX & 0xffff) << 16) | Layer.HITBOX;
    const make = (desc: RAPIER.ColliderDesc, part: HitPart) => {
      const c = world.createCollider(desc.setCollisionGroups(g).setSensor(false), this.body);
      registry.register(c.handle, owner, part);
      return c;
    };
    this.legs = make(RAPIER.ColliderDesc.cuboid(...STAND.legs.he), 'limb');
    this.torso = make(RAPIER.ColliderDesc.cuboid(...STAND.torso.he), 'body');
    this.head = make(RAPIER.ColliderDesc.ball(STAND.head.r), 'head');
    this.layout(1.8);
  }

  /** Scales the layout to the character's current height (crouching). */
  private layout(height: number): void {
    if (Math.abs(height - this.lastHeight) < 1e-3) return;
    this.lastHeight = height;
    const k = height / 1.8;
    this.legs.setTranslationWrtParent({ x: 0, y: STAND.legs.y * k, z: 0 });
    this.legs.setHalfExtents({ x: STAND.legs.he[0], y: STAND.legs.he[1] * k, z: STAND.legs.he[2] });
    this.torso.setTranslationWrtParent({ x: 0, y: STAND.torso.y * k, z: 0 });
    this.head.setTranslationWrtParent({ x: 0, y: STAND.head.y * k, z: 0 });
  }

  /** Moves the hitboxes to the character's feet, facing and height. */
  sync(feet: { x: number; y: number; z: number }, yaw: number, height: number): void {
    this.layout(height);
    this.body.setNextKinematicTranslation(feet);
    const h = yaw / 2;
    this.body.setNextKinematicRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) });
  }

  /** Teleport without interpolation (spawns). */
  place(feet: { x: number; y: number; z: number }, yaw: number): void {
    this.body.setTranslation(feet, true);
    const h = yaw / 2;
    this.body.setRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) }, true);
  }

  setEnabled(on: boolean): void {
    this.legs.setEnabled(on);
    this.torso.setEnabled(on);
    this.head.setEnabled(on);
  }

  dispose(): void {
    for (const c of [this.legs, this.torso, this.head]) this.registry.unregister(c.handle);
    this.physics.world.removeRigidBody(this.body);
  }
}
