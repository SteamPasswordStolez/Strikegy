import { describe, expect, it } from 'vitest';
import { Layer, PhysicsWorld, RAPIER } from '@/physics/PhysicsWorld';

// PhysicsWorld.step calls Rapier's pipeline directly (skipping World.step's per-step handle re-map).
describe('physics step', () => {
  it('uses the pipeline directly and still simulates', async () => {
    const p = await PhysicsWorld.create();
    expect(
      typeof (p.world as unknown as { physicsPipeline?: { step?: unknown } }).physicsPipeline?.step,
    ).toBe('function');
    p.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 10, y: 0.5, z: 10 });
    const body = p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0));
    p.world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
    for (let i = 0; i < 120; i++) p.step();
    expect(body.translation().y).toBeGreaterThan(0.4);
    expect(body.translation().y).toBeLessThan(0.6);
  });

  it('keeps colliders made and removed between steps queryable', async () => {
    const p = await PhysicsWorld.create();
    const a = p.addStaticBox({ x: 0, y: 0, z: -5 }, { x: 1, y: 1, z: 0.2 });
    p.step();
    const hit = p.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 20, Layer.WORLD);
    expect(hit?.collider.handle).toBe(a.handle);
    p.world.removeCollider(a, false);
    const b = p.addStaticBox({ x: 0, y: 0, z: -8 }, { x: 1, y: 1, z: 0.2 });
    p.step();
    const hit2 = p.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 20, Layer.WORLD);
    expect(hit2?.collider).toBe(b);
    // A removed body takes its colliders with it.
    const body = p.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, -3),
    );
    const c = p.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 0.2), body);
    p.step();
    expect(p.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 20, Layer.WORLD)?.collider).toBe(
      c,
    );
    p.world.removeRigidBody(body);
    p.step();
    expect(p.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 20, Layer.WORLD)?.collider).toBe(
      b,
    );
    p.dispose();
  });
});

describe('raw ray casts', () => {
  it('match the public Rapier queries', async () => {
    const p = await PhysicsWorld.create();
    let seed = 7;
    const r = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const boxes = [];
    for (let i = 0; i < 300; i++) {
      boxes.push(
        p.addStaticBox(
          { x: (r() - 0.5) * 60, y: r() * 6, z: (r() - 0.5) * 60 },
          { x: 0.3 + r(), y: 0.3 + r(), z: 0.3 + r() },
          undefined,
          r() < 0.3 ? Layer.HITBOX : Layer.WORLD,
        ),
      );
    }
    p.step();
    let hits = 0;
    for (let i = 0; i < 2000; i++) {
      const o = { x: (r() - 0.5) * 70, y: r() * 8, z: (r() - 0.5) * 70 };
      const d = { x: r() - 0.5, y: (r() - 0.5) * 0.4, z: r() - 0.5 };
      const len = Math.hypot(d.x, d.y, d.z);
      d.x /= len;
      d.y /= len;
      d.z /= len;
      const mask = r() < 0.5 ? Layer.WORLD : Layer.WORLD | Layer.HITBOX;
      const exclude = r() < 0.2 ? boxes[Math.floor(r() * boxes.length)] : undefined;
      const want = p.world.castRayAndGetNormal(
        new RAPIER.Ray(o, d),
        50,
        true,
        undefined,
        ((0xffff << 16) | mask) >>> 0,
        exclude,
      );
      const got = p.raycast(o, d, 50, mask, exclude);
      expect(got?.collider.handle).toBe(want?.collider.handle);
      if (!want || !got) continue;
      hits++;
      expect(got.distance).toBeCloseTo(want.timeOfImpact, 5);
      expect(got.normal.x).toBeCloseTo(want.normal.x, 5);
      expect(got.normal.y).toBeCloseTo(want.normal.y, 5);
      expect(got.normal.z).toBeCloseTo(want.normal.z, 5);
      expect(p.rayDistance(o, d, 50, mask)).toBeLessThanOrEqual(got.distance + 1e-6);
      const to = {
        x: o.x + d.x * (got.distance + 0.2),
        y: o.y + d.y * (got.distance + 0.2),
        z: o.z + d.z * (got.distance + 0.2),
      };
      if (!exclude) expect(p.blocked(o, to, mask)).toBe(true);
    }
    expect(hits).toBeGreaterThan(300);
    p.dispose();
  });
});
