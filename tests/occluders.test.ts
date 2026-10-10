import fs from 'node:fs';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCore } from '@/wasm/core';
import { Layer, PhysicsWorld, RAPIER } from '@/physics/PhysicsWorld';

// Sight lines answered by the wasm core (occluders.rs) against Rapier's own ray cast.

function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** What `blocked` asked Rapier before: a ray up to the target less 5 cm. */
function rapierBlocked(p: PhysicsWorld, a: THREE.Vector3, b: THREE.Vector3): boolean {
  const d = b.clone().sub(a);
  const len = d.length();
  if (len < 0.06) return false;
  return (
    p.world.castRay(
      new RAPIER.Ray(a, d.divideScalar(len)),
      len - 0.05,
      true,
      undefined,
      ((0xffff << 16) | Layer.WORLD) >>> 0,
    ) !== null
  );
}

describe('occluders', () => {
  beforeAll(async () => {
    await loadCore(fs.readFileSync('src/wasm/core.wasm'));
  });

  it('match Rapier on rotated boxes, removals and moving hulls', async () => {
    const p = await PhysicsWorld.create();
    const r = rng(11);
    const q = new THREE.Quaternion();
    const boxes = [];
    for (let i = 0; i < 1500; i++) {
      q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.6, r() * Math.PI * 2, (r() - 0.5) * 0.6));
      const thin = r() < 0.3;
      boxes.push(
        p.addStaticBox(
          { x: (r() - 0.5) * 300, y: r() * 8, z: (r() - 0.5) * 300 },
          { x: thin ? 0.1 : 0.2 + r() * 3, y: 0.2 + r() * 2, z: 0.2 + r() * 3 },
          { x: q.x, y: q.y, z: q.z, w: q.w },
          r() < 0.1 ? Layer.HITBOX : Layer.WORLD,
        ),
      );
    }
    // A vehicle-like dynamic hull.
    const body = p.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(5, 1, 5),
    );
    const hull = p.world.createCollider(
      RAPIER.ColliderDesc.cuboid(1.2, 0.8, 2.4).setCollisionGroups(
        ((Layer.WORLD | Layer.HITBOX) << 16) | 0xffff,
      ),
      body,
    );
    p.trackOccluder(hull);
    p.step();

    const check = (n: number, spread: number): { blocked: number; differ: number } => {
      let blocked = 0;
      let differ = 0;
      for (let i = 0; i < n; i++) {
        const a = new THREE.Vector3((r() - 0.5) * spread, r() * 9, (r() - 0.5) * spread);
        const b =
          r() < 0.2
            ? a.clone().add(new THREE.Vector3((r() - 0.5) * 4, (r() - 0.5) * 4, (r() - 0.5) * 4))
            : new THREE.Vector3((r() - 0.5) * spread, r() * 9, (r() - 0.5) * spread);
        if (r() < 0.05) b.set(a.x, a.y + 10, a.z); // straight up
        const want = rapierBlocked(p, a, b);
        if (p.blocked(a, b, Layer.WORLD) !== want) differ++;
        if (want) blocked++;
      }
      return { blocked, differ };
    };
    let res = check(6000, 320);
    expect(res.blocked).toBeGreaterThan(1500);
    expect(res.blocked).toBeLessThan(5500);
    // Float rounding at a grazing edge may flip a rare one.
    expect(res.differ).toBeLessThanOrEqual(3);

    // Remove a third of the boxes, move the hull: still the same answers.
    for (let i = 0; i < boxes.length; i += 3) p.removeStatic(boxes[i]!);
    body.setNextKinematicTranslation({ x: -20, y: 1, z: 30 });
    p.step();
    res = check(4000, 320);
    expect(res.differ).toBeLessThanOrEqual(3);

    // Short sight lines near the hull.
    let near = 0;
    for (let i = 0; i < 2000; i++) {
      const a = new THREE.Vector3(-20 + (r() - 0.5) * 12, r() * 3, 30 + (r() - 0.5) * 12);
      const b = new THREE.Vector3(-20 + (r() - 0.5) * 12, r() * 3, 30 + (r() - 0.5) * 12);
      const want = rapierBlocked(p, a, b);
      expect(p.blocked(a, b, Layer.WORLD)).toBe(want);
      if (want) near++;
    }
    expect(near).toBeGreaterThan(200);
    p.untrackOccluder(hull);
    p.dispose();
  });
});
