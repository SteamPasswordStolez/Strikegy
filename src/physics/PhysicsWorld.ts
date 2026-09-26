import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

/** Collision membership bits. */
export const Layer = {
  WORLD: 0x0001,
  PLAYER: 0x0002,
  HITBOX: 0x0004,
} as const;

/** Packs Rapier interaction groups: upper 16 bits membership, lower 16 bits filter. */
export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export interface RayHit {
  collider: RAPIER.Collider;
  distance: number;
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

type V3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

let initPromise: Promise<void> | null = null;

export class PhysicsWorld {
  readonly world: RAPIER.World;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  static async create(): Promise<PhysicsWorld> {
    initPromise ??= RAPIER.init();
    await initPromise;
    return new PhysicsWorld();
  }

  set timestep(dt: number) {
    this.world.timestep = dt;
  }

  addStaticBox(
    center: V3,
    halfExtents: V3,
    rotation: Quat = { x: 0, y: 0, z: 0, w: 1 },
    membership: number = Layer.WORLD,
  ): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setTranslation(center.x, center.y, center.z)
      .setRotation(rotation)
      .setCollisionGroups(groups(membership, 0xffff));
    return this.world.createCollider(desc);
  }

  /** Static collider attached to a fixed body so it can be repositioned (e.g. hitboxes). */
  addKinematicShape(desc: RAPIER.ColliderDesc, membership: number): RAPIER.Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    desc.setCollisionGroups(groups(membership, 0xffff));
    return this.world.createCollider(desc, body);
  }

  raycast(
    origin: V3,
    dir: V3,
    maxDist: number,
    mask: number,
    exclude?: RAPIER.Collider,
  ): RayHit | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDist,
      true,
      undefined,
      groups(0xffff, mask),
      exclude,
    );
    if (!hit) return null;
    const p = ray.pointAt(hit.timeOfImpact);
    return {
      collider: hit.collider,
      distance: hit.timeOfImpact,
      point: { x: p.x, y: p.y, z: p.z },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
    };
  }

  step(): void {
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }
}
