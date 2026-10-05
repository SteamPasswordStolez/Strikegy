import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { CHAR_PARTS, charHandle, type CharacterHits } from '@/physics/characterHits';
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
 * Head / torso / legs hitboxes following a character (player or bot), kept
 * in the wasm core (`hitboxes.rs`: the same layout as `STAND`) rather than as a kinematic
 * Rapier body: HITBOX-layer rays (`PhysicsWorld.raycast`) test them there.
 * Their stand-in collider handles are in the registry like any other
 * hitbox's. Shots from the owner pass `slot` to skip them.
 */
export class CharacterHitboxes {
  /** This character's slot in the core; pass it as `excludeChar` for the owner's own shots. */
  readonly slot: number;
  private readonly hits: CharacterHits;
  private readonly handles: number[];

  constructor(
    physics: PhysicsWorld,
    private readonly registry: HitboxRegistry,
    owner: Damageable,
  ) {
    if (!physics.characters) throw new Error('character hitboxes need the wasm core');
    this.hits = physics.characters;
    this.slot = this.hits.alloc();
    this.handles = CHAR_PARTS.map((part, i) => {
      const handle = charHandle(this.slot, i);
      registry.register(handle, owner, part);
      return handle;
    });
    this.hits.set(this.slot, { x: 0, y: -1000, z: 0 }, 0, 1.8);
    this.hits.setEnabled(this.slot, true);
  }

  /** Moves the hitboxes to the character's feet, facing and height (crouching scales them). */
  sync(feet: { x: number; y: number; z: number }, yaw: number, height: number): void {
    this.hits.set(this.slot, feet, yaw, height);
  }

  /** Teleport (spawns). */
  place(feet: { x: number; y: number; z: number }, yaw: number): void {
    this.hits.set(this.slot, feet, yaw, 1.8);
  }

  setEnabled(on: boolean): void {
    this.hits.setEnabled(this.slot, on);
  }

  dispose(): void {
    for (const h of this.handles) this.registry.unregister(h);
    this.hits.release(this.slot);
  }
}
