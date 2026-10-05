import RAPIER from '@dimforge/rapier3d-compat';
import { coreIfLoaded } from '@/wasm/core';
import { Occluders } from './occluders';
import { CharacterHits, charHandle } from './characterHits';

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
  /** What was hit: a Rapier collider, or a character hitbox part (`charHandle`, negative). */
  collider: { readonly handle: number };
  distance: number;
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

type V3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

let initPromise: Promise<void> | null = null;

/** Rapier's wasm-side ray queries (`World.broadPhase.raw`), called without the JS wrapper. */
interface RawRayHit {
  colliderHandle(): number;
  timeOfImpact(): number;
  free(): void;
}
interface RawRayIntersection {
  colliderHandle(): number;
  time_of_impact(): number;
  normal(out: Float32Array): void;
  free(): void;
}
type RawCast<T> = (
  narrowPhase: unknown,
  bodies: unknown,
  colliders: unknown,
  origin: unknown,
  dir: unknown,
  maxToi: number,
  solid: boolean,
  flags: number,
  groups: number,
  excludeCollider: number | undefined,
  excludeBody: number | undefined,
  predicate: undefined,
) => T | undefined;
interface RawRays {
  broadPhase: { castRay: RawCast<RawRayHit>; castRayAndGetNormal: RawCast<RawRayIntersection> };
  narrowPhase: unknown;
  bodies: unknown;
  colliders: unknown;
  origin: V3;
  dir: V3;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  /**
   * Heightfield ground, if any. Sight tests skip its collider and check its
   * height grid instead: Rapier walks the heightfield cell by cell, which
   * doubles the cost of long, grazing rays.
   */
  private ground: { collider: RAPIER.Collider; blocks(from: V3, to: V3): boolean } | null = null;
  private readonly sightRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  /**
   * Ray casts straight into Rapier's wasm side. The public `castRay` wraps
   * every query in a JS filter closure that the wasm calls back for each
   * candidate collider (even with no filter set), and allocates and frees two
   * vectors per ray: ~3x the cost of the cast itself. Null if this Rapier
   * build doesn't look as expected (then the public API is used).
   */
  private readonly rays: RawRays | null;
  /**
   * Sight-line blockers mirrored in the wasm core (static WORLD boxes, vehicle
   * hulls): `blocked` asks it rather than Rapier. Null without the core (tests).
   */
  private readonly occluders: Occluders | null;
  /** Bot and player hitboxes in the wasm core (HITBOX-layer rays test them too). Null without the core. */
  readonly characters: CharacterHits | null;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const w = this.world as unknown as Record<
      'broadPhase' | 'narrowPhase' | 'bodies' | 'colliders',
      { raw?: unknown } | undefined
    >;
    const bp = w.broadPhase?.raw as RawRays['broadPhase'] | undefined;
    this.rays =
      typeof bp?.castRay === 'function' && typeof bp.castRayAndGetNormal === 'function'
        ? {
            broadPhase: bp,
            narrowPhase: w.narrowPhase!.raw,
            bodies: w.bodies!.raw,
            colliders: w.colliders!.raw,
            origin: RAPIER.VectorOps.intoRaw({ x: 0, y: 0, z: 0 }) as unknown as V3,
            dir: RAPIER.VectorOps.intoRaw({ x: 0, y: 1, z: 0 }) as unknown as V3,
          }
        : null;
    const k = coreIfLoaded();
    this.occluders = k ? new Occluders(k) : null;
    this.characters = k ? new CharacterHits(k) : null;
  }

  /** Loads origin and direction into the reused raw vectors. */
  private aim(
    r: RawRays,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
  ): void {
    r.origin.x = ox;
    r.origin.y = oy;
    r.origin.z = oz;
    r.dir.x = dx;
    r.dir.y = dy;
    r.dir.z = dz;
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
    const collider = this.world.createCollider(desc);
    if (membership & Layer.WORLD) this.occluders?.addBox(collider, center, halfExtents, rotation);
    return collider;
  }

  /** Removes a box made by `addStaticBox`. */
  removeStatic(collider: RAPIER.Collider): void {
    this.occluders?.remove(collider);
    this.world.removeCollider(collider, false);
  }

  /** A moving WORLD cuboid (vehicle hull) that blocks sight lines. */
  trackOccluder(collider: RAPIER.Collider): void {
    this.occluders?.track(collider);
  }

  untrackOccluder(collider: RAPIER.Collider): void {
    this.occluders?.untrack(collider);
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

  /** True if a box (centre, half extents, yaw about Y) overlaps a collider in `mask`, not counting the heightfield ground. */
  overlapsBox(center: V3, half: V3, yaw: number, mask: number): boolean {
    const shape = new RAPIER.Cuboid(half.x, half.y, half.z);
    const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    let hit = false;
    this.world.intersectionsWithShape(
      center,
      rot,
      shape,
      () => {
        hit = true;
        return false;
      },
      undefined,
      groups(0xffff, mask),
      this.ground?.collider,
    );
    return hit;
  }

  /** Distance along `dir` (unit) to the first collider in `mask` within `maxDist`, or Infinity: no hit details. */
  rayDistance(origin: V3, dir: V3, maxDist: number, mask: number): number {
    const raw = this.rays;
    if (!raw) return this.raycast(origin, dir, maxDist, mask)?.distance ?? Infinity;
    this.aim(raw, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z);
    const hit = raw.broadPhase.castRay(
      raw.narrowPhase,
      raw.bodies,
      raw.colliders,
      raw.origin,
      raw.dir,
      maxDist,
      true,
      0,
      groups(0xffff, mask),
      undefined,
      undefined,
      undefined,
    );
    if (!hit) return Infinity;
    const t = hit.timeOfImpact();
    hit.free();
    return t;
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
    const occ = this.occluders;
    if (mask === Layer.WORLD && occ?.ready()) return occ.blocked(from, to);
    const raw = this.rays;
    if (raw) {
      this.aim(raw, from.x, from.y, from.z, dx / dist, dy / dist, dz / dist);
      const hit = raw.broadPhase.castRay(
        raw.narrowPhase,
        raw.bodies,
        raw.colliders,
        raw.origin,
        raw.dir,
        dist - 0.05,
        true,
        0,
        groups(0xffff, mask),
        g?.collider.handle,
        undefined,
        undefined,
      );
      if (!hit) return false;
      hit.free();
      return true;
    }
    const r = this.sightRay;
    r.origin.x = from.x;
    r.origin.y = from.y;
    r.origin.z = from.z;
    r.dir.x = dx / dist;
    r.dir.y = dy / dist;
    r.dir.z = dz / dist;
    return (
      this.world.castRay(r, dist - 0.05, true, undefined, groups(0xffff, mask), g?.collider) !==
      null
    );
  }

  /**
   * Nearest hit along `dir` (unit). With `Layer.HITBOX` in `mask`, character
   * hitboxes in the core count too (`excludeChar`: the shooter's own slot).
   */
  raycast(
    origin: V3,
    dir: V3,
    maxDist: number,
    mask: number,
    exclude?: RAPIER.Collider,
    excludeBody?: RAPIER.RigidBody,
    /** Only colliders this passes count (character hitboxes then don't). */
    only?: (c: RAPIER.Collider) => boolean,
    /** A character hitbox slot to skip (the shooter's own). */
    excludeChar?: number,
  ): RayHit | null {
    // Character hitboxes live in the wasm core (a filter only knows Rapier's colliders).
    const ch = mask & Layer.HITBOX && !only ? this.characters?.cast(origin, dir, maxDist, excludeChar) : null;
    // Anything Rapier has must be nearer than the character to count.
    const world = this.rapierRay(origin, dir, ch ? ch.distance : maxDist, mask, exclude, excludeBody, only);
    if (world || !ch) return world;
    const t = ch.distance;
    return {
      collider: { handle: charHandle(ch.slot, ch.part) },
      distance: t,
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
      normal: ch.normal,
    };
  }

  private rapierRay(
    origin: V3,
    dir: V3,
    maxDist: number,
    mask: number,
    exclude?: RAPIER.Collider,
    excludeBody?: RAPIER.RigidBody,
    only?: (c: RAPIER.Collider) => boolean,
  ): RayHit | null {
    const raw = this.rays;
    // A filter needs Rapier's callback per candidate: the public API then.
    if (raw && !only) {
      this.aim(raw, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z);
      const hit = raw.broadPhase.castRayAndGetNormal(
        raw.narrowPhase,
        raw.bodies,
        raw.colliders,
        raw.origin,
        raw.dir,
        maxDist,
        true,
        0,
        groups(0xffff, mask),
        exclude?.handle,
        excludeBody?.handle,
        undefined,
      );
      if (!hit) return null;
      const n = RAPIER.scratchBuffer;
      hit.normal(n);
      const handle = hit.colliderHandle();
      const t = hit.time_of_impact();
      hit.free();
      return {
        collider: this.world.getCollider(handle),
        distance: t,
        point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
        normal: { x: n[0]!, y: n[1]!, z: n[2]! },
      };
    }
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDist,
      true,
      undefined,
      groups(0xffff, mask),
      exclude,
      excludeBody,
      only,
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
    // world.step() runs the pipeline and then re-walks every body and collider
    // handle to wrap ones created inside the engine (soft bodies and the like).
    // Ours are all created and removed from JS, which keeps those maps itself,
    // and the walk cost ~1.1 ms a step with Ardennes' ~7,000 static colliders
    // (the pipeline itself ~0.25 ms). Same call, without the walk.
    const w = this.world;
    w.physicsPipeline.step(w.gravity, w.integrationParameters, w.islands, w.broadPhase, w.narrowPhase, w.bodies, w.colliders, w.softBodies, w.impulseJoints, w.multibodyJoints, w.ccdSolver);
    // Vehicle hulls moved: the sight-line copy follows.
    this.occluders?.sync();
  }

  dispose(): void {
    this.world.free();
  }
}
