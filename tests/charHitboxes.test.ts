import fs from 'node:fs';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCore } from '@/wasm/core';
import { Layer, PhysicsWorld, RAPIER } from '@/physics/PhysicsWorld';
import { CharacterHitboxes } from '@/combat/CharacterHitboxes';
import { HitboxRegistry, type Damageable } from '@/combat/Hitboxes';

// Character hitboxes in the wasm core against the Rapier hitboxes they replaced
// (same layout: legs / torso boxes turned to the facing, head ball, scaled by height).

function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function rapierCharacter(
  w: RAPIER.World,
  feet: THREE.Vector3,
  yaw: number,
  height: number,
): RAPIER.Collider[] {
  const k = height / 1.8;
  const body = w.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(feet.x, feet.y, feet.z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
  );
  return [
    w.createCollider(
      RAPIER.ColliderDesc.cuboid(0.18, 0.45 * k, 0.12).setTranslation(0, 0.45 * k, 0),
      body,
    ),
    w.createCollider(
      RAPIER.ColliderDesc.cuboid(0.24, 0.3, 0.15).setTranslation(0, 1.2 * k, 0),
      body,
    ),
    w.createCollider(RAPIER.ColliderDesc.ball(0.13).setTranslation(0, 1.64 * k, 0), body),
  ];
}

describe('character hitboxes in the core', () => {
  beforeAll(async () => {
    await loadCore(fs.readFileSync('src/wasm/core.wasm'));
  });

  it('hit the same part at the same distance as Rapier did', async () => {
    const p = await PhysicsWorld.create();
    const ref = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const registry = new HitboxRegistry();
    const r = rng(5);
    const parts = new Map<number, [number, string]>();
    const boxes: CharacterHitboxes[] = [];
    for (let i = 0; i < 120; i++) {
      const owner: Damageable = { id: i, name: '', alive: true, applyDamage: () => false };
      const hb = new CharacterHitboxes(p, registry, owner);
      const feet = new THREE.Vector3((r() - 0.5) * 30, r() * 2, (r() - 0.5) * 30);
      const yaw = r() * Math.PI * 4 - Math.PI * 2;
      const height = r() < 0.3 ? 1.1 : 1.8;
      hb.sync(feet, yaw, height);
      boxes.push(hb);
      rapierCharacter(ref, feet, yaw, height).forEach((c, k) =>
        parts.set(c.handle, [i, ['limb', 'body', 'head'][k]!]),
      );
    }
    // One switched off (down): not hit.
    boxes[7]!.setEnabled(false);
    ref.step();
    let hits = 0;
    for (let n = 0; n < 4000; n++) {
      const o = new THREE.Vector3((r() - 0.5) * 40, r() * 3, (r() - 0.5) * 40);
      const d = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.5, r() - 0.5).normalize();
      const exclude = r() < 0.3 ? Math.floor(r() * 120) : undefined;
      const got = p.raycast(
        o,
        d,
        60,
        Layer.HITBOX,
        undefined,
        undefined,
        undefined,
        exclude === undefined ? undefined : boxes[exclude]!.slot,
      );
      const want = ref.castRayAndGetNormal(
        new RAPIER.Ray(o, d),
        60,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        (c) => {
          const who = parts.get(c.handle)![0];
          return who !== 7 && who !== exclude;
        },
      );
      const gotWho = got ? registry.lookup(got.collider.handle) : undefined;
      if (!want) {
        expect(gotWho).toBeUndefined();
        continue;
      }
      hits++;
      const [who, part] = parts.get(want.collider.handle)!;
      expect(gotWho?.owner.id).toBe(who);
      expect(gotWho?.part).toBe(part);
      // f32 on both sides: ~2e-5 of the distance.
      expect(Math.abs(got!.distance - want.timeOfImpact)).toBeLessThan(
        1e-4 + want.timeOfImpact * 3e-5,
      );
      if (want.timeOfImpact > 0) {
        expect(got!.normal.x).toBeCloseTo(want.normal.x, 2);
        expect(got!.normal.y).toBeCloseTo(want.normal.y, 2);
        expect(got!.normal.z).toBeCloseTo(want.normal.z, 2);
      }
    }
    expect(hits).toBeGreaterThan(250);
    for (const b of boxes) b.dispose();
    p.dispose();
  });

  it('a wall in front of a character takes the shot', async () => {
    const p = await PhysicsWorld.create();
    const registry = new HitboxRegistry();
    const owner: Damageable = { id: 1, name: '', alive: true, applyDamage: () => false };
    const hb = new CharacterHitboxes(p, registry, owner);
    hb.sync(new THREE.Vector3(0, 0, -10), 0, 1.8);
    const wall = p.addStaticBox({ x: 0, y: 1, z: -5 }, { x: 2, y: 2, z: 0.1 });
    p.step();
    const o = new THREE.Vector3(0, 1.2, 0);
    const d = new THREE.Vector3(0, 0, -1);
    expect(p.raycast(o, d, 50, Layer.WORLD | Layer.HITBOX)?.collider.handle).toBe(wall.handle);
    p.removeStatic(wall);
    p.step();
    expect(
      registry.lookup(p.raycast(o, d, 50, Layer.WORLD | Layer.HITBOX)!.collider.handle)?.part,
    ).toBe('body');
    // World-only rays ignore people.
    expect(p.raycast(o, d, 50, Layer.WORLD)).toBeNull();
    hb.dispose();
    p.dispose();
  });
});
