import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

/** Collision membership bits. */
export const Layer = {
  WORLD: 0x0001,
  PLAYER: 0x0002,
  HITBOX: 0x0004,
  /** Thrown objects: collide with the world only. */
  DEBRIS: 0x0008,
  /**
   * Bot bodies. Bots walk on the navmesh and keep apart by steering; the
   * capsule only exists so the player's controller runs into them.
   */
  BOT: 0x0010,
  /** Invisible walls at the edge of the playable area: block characters only. */
  BOUNDS: 0x0020,
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
  /**
   * Heightfield ground, if any. Sight tests skip its collider and check its
   * height grid instead: Rapier walks the heightfield cell by cell, which
   * doubles the cost of long, grazing rays.
   */
  private ground: { collider: RAPIER.Collider; blocks(from: V3, to: V3): boolean } | null = null;
  private readonly sightRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });

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

  setGround(collider: RAPIER.Collider, blocks: (from: V3, to: V3) => boolean): void {
    this.ground = { collider, blocks };
  }

  /** True if something in `mask` lies between `from` and (just short of) `to`. No hit details. */
  blocked(from: V3, to: V3, mask: number): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.06) return false;
    const g = this.ground;
    if (g && mask & Layer.WORLD && g.blocks(from, to)) return true;
    const r = this.sightRay;
    r.origin.x = from.x;
    r.origin.y = from.y;
    r.origin.z = from.z;
    r.dir.x = dx / dist;
    r.dir.y = dy / dist;
    r.dir.z = dz / dist;
    return this.world.castRay(r, dist - 0.05, true, undefined, groups(0xffff, mask), g?.collider) !== null;
  }

  raycast(
    origin: V3,
    dir: V3,
    maxDist: number,
    mask: number,
    exclude?: RAPIER.Collider,
    excludeBody?: RAPIER.RigidBody,
  ): RayHit | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDist,
      true,
      undefined,
      groups(0xffff, mask),
      exclude,
      excludeBody,
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
