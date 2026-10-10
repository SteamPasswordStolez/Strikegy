import type * as RAPIER from '@dimforge/rapier3d-compat';
import type { CoreExports } from '@/wasm/core';

type V3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

/**
 * What blocks sight lines, mirrored in the wasm core (`occluders.rs`): every
 * static WORLD box and the hulls of ground vehicles. `PhysicsWorld.blocked`
 * asks the core instead of Rapier when this is ready.
 */
export class Occluders {
  private readonly slots = new Map<number, number>();
  private readonly free: number[] = [];
  private next = 0;
  private readonly dynamic: { collider: RAPIER.Collider; half: V3 }[] = [];
  /** Off once the core said the boxes don't fit its grid (Rapier answers then). */
  private usable = true;
  /** Changed since the core last rebuilt its grid. */
  private dirty = true;
  private ok = false;

  constructor(private readonly k: CoreExports) {
    k.occ_reset();
  }

  addBox(collider: RAPIER.Collider, c: V3, h: V3, q: Quat): void {
    const slot = this.free.pop() ?? this.next++;
    if (slot >= this.k.occ_max_boxes()) {
      this.usable = false;
      return;
    }
    this.slots.set(collider.handle, slot);
    this.dirty = true;
    this.k.occ_set_box(slot, c.x, c.y, c.z, h.x, h.y, h.z, q.x, q.y, q.z, q.w);
  }

  remove(collider: RAPIER.Collider): void {
    const slot = this.slots.get(collider.handle);
    if (slot === undefined) return;
    this.slots.delete(collider.handle);
    this.free.push(slot);
    this.dirty = true;
    this.k.occ_remove_box(slot);
  }

  /** A moving box (a cuboid collider: a vehicle hull), re-read after every physics step. */
  track(collider: RAPIER.Collider): void {
    const h = collider.halfExtents();
    // Cuboids only.
    if (!h) return;
    this.dynamic.push({ collider, half: { x: h.x, y: h.y, z: h.z } });
    this.sync();
  }

  untrack(collider: RAPIER.Collider): void {
    const i = this.dynamic.findIndex((d) => d.collider === collider);
    if (i >= 0) this.dynamic.splice(i, 1);
    this.sync();
  }

  sync(): void {
    const n = Math.min(this.dynamic.length, 64);
    for (let i = 0; i < n; i++) {
      const { collider, half } = this.dynamic[i]!;
      const t = collider.translation();
      const r = collider.rotation();
      this.k.occ_set_dynamic(i, t.x, t.y, t.z, half.x, half.y, half.z, r.x, r.y, r.z, r.w);
    }
    this.k.occ_dynamic_count(n);
    if (this.dynamic.length > 64) this.usable = false;
  }

  /** Whether `blocked` can answer (rebuilds the grid after changes). */
  ready(): boolean {
    if (this.dirty) {
      this.dirty = false;
      this.ok = this.k.occ_ready() === 1;
    }
    return this.usable && this.ok;
  }

  /** Something between `from` and (just short of) `to`; the terrain is not included. */
  blocked(from: V3, to: V3): boolean {
    return this.k.occ_blocked(from.x, from.y, from.z, to.x, to.y, to.z) === 1;
  }
}
