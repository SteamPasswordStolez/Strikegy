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
 * A ray against a character's hitboxes posed at `feet` / `yaw` / `height`
 * without the physics world (the game server tests shots against where
 * soldiers were a moment ago). Same layout as `CharacterHitboxes`. Returns the
 * nearest part hit within `maxDist`, or null.
 */
export function rayHitbox(
  feet: { x: number; y: number; z: number },
  yaw: number,
  height: number,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxDist: number,
): { distance: number; part: HitPart } | null {
  const k = height / 1.8;
  // Into the body's frame: feet at the origin, unturned.
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const px = origin.x - feet.x;
  const pz = origin.z - feet.z;
  const ox = px * c - pz * s;
  const oz = px * s + pz * c;
  const oy = origin.y - feet.y;
  const dx = dir.x * c - dir.z * s;
  const dz = dir.x * s + dir.z * c;
  const dy = dir.y;
  let best: { distance: number; part: HitPart } | null = null;
  const box = (cy: number, hx: number, hy: number, hz: number, part: HitPart) => {
    const t = slab(ox, oy - cy, oz, dx, dy, dz, hx, hy, hz);
    if (t !== null && t <= maxDist && (!best || t < best.distance)) best = { distance: t, part };
  };
  box(STAND.legs.y * k, STAND.legs.he[0], STAND.legs.he[1] * k, STAND.legs.he[2], 'limb');
  box(STAND.torso.y * k, STAND.torso.he[0], STAND.torso.he[1] * k, STAND.torso.he[2], 'body');
  // Head: a ball.
  const hy = oy - STAND.head.y * k;
  const b = ox * dx + hy * dy + oz * dz;
  const cc = ox * ox + hy * hy + oz * oz - STAND.head.r * STAND.head.r;
  const disc = b * b - cc;
  if (disc >= 0) {
    const t = cc <= 0 ? 0 : -b - Math.sqrt(disc);
    if (t >= 0 && t <= maxDist && (!best || t < (best as { distance: number }).distance)) best = { distance: t, part: 'head' };
  }
  return best;
}

/** Entry distance of a ray (origin relative to the box centre) into a box of half extents h, or null. */
function slab(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, hx: number, hy: number, hz: number): number | null {
  let t0 = 0;
  let t1 = Infinity;
  for (const [o, d, h] of [
    [ox, dx, hx],
    [oy, dy, hy],
    [oz, dz, hz],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (o < -h || o > h) return null;
      continue;
    }
    let a = (-h - o) / d;
    let b = (h - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

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
  /** Where it was last put (skips moving a body that hasn't moved). */
  private readonly last = { x: NaN, y: NaN, z: NaN, yaw: NaN };

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
    const l = this.last;
    if (l.x === feet.x && l.y === feet.y && l.z === feet.z && l.yaw === yaw) return;
    l.x = feet.x;
    l.y = feet.y;
    l.z = feet.z;
    l.yaw = yaw;
    this.body.setNextKinematicTranslation(feet);
    const h = yaw / 2;
    this.body.setNextKinematicRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) });
  }

  /** Teleport without interpolation (spawns). */
  place(feet: { x: number; y: number; z: number }, yaw: number): void {
    this.last.x = NaN;
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
