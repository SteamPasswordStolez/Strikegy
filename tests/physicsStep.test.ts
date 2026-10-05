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
