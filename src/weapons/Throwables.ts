import * as THREE from 'three';
import { Layer, RAPIER, groups, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { GameBus } from '@/core/events';
import { GRENADES, type GrenadeType } from '@/combat/explosions';

const RADIUS = 0.045;
const BODY_COLOR: Record<GrenadeType, number> = { frag: 0x3f4a33, flash: 0x5b5f66, smoke: 0x6b6f5a };

interface LiveGrenade {
  type: GrenadeType;
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  fuse: number;
  lastVel: THREE.Vector3;
  bounceCooldown: number;
}

export const GRENADE_ORDER: GrenadeType[] = ['frag', 'flash', 'smoke'];

/** Starting grenade counts per life. */
export const GRENADE_LOADOUT: Record<GrenadeType, number> = { frag: 2, flash: 2, smoke: 1 };

/** Selected grenade type and remaining counts (pure; reset on respawn). */
export class GrenadeInventory {
  counts: Record<GrenadeType, number> = { ...GRENADE_LOADOUT };
  selected: GrenadeType = 'frag';

  cycle(): void {
    // Skip types with nothing left, unless every type is empty.
    for (let i = 1; i <= GRENADE_ORDER.length; i++) {
      const next = GRENADE_ORDER[(GRENADE_ORDER.indexOf(this.selected) + i) % GRENADE_ORDER.length]!;
      if (this.counts[next] > 0) {
        this.selected = next;
        return;
      }
    }
  }

  take(): GrenadeType | null {
    if (this.counts[this.selected] <= 0) this.cycle();
    if (this.counts[this.selected] <= 0) return null;
    this.counts[this.selected]--;
    return this.selected;
  }

  reset(): void {
    this.counts = { ...GRENADE_LOADOUT };
    this.selected = 'frag';
  }
}

/**
 * Thrown grenades as small dynamic Rapier bodies (CCD on, bouncy). Detonation
 * is reported through the bus; gameplay consequences live in the Game.
 */
export class Throwables {
  private readonly live: LiveGrenade[] = [];
  private readonly geometry = new THREE.CapsuleGeometry(RADIUS * 0.8, RADIUS, 4, 10);
  private readonly materials = new Map<GrenadeType, THREE.Material>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly bus: GameBus,
  ) {
    for (const [type, color] of Object.entries(BODY_COLOR) as [GrenadeType, number][]) {
      this.materials.set(type, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 }));
    }
  }

  throw(type: GrenadeType, origin: THREE.Vector3, dir: THREE.Vector3, carry: THREE.Vector3): void {
    const spec = GRENADES[type];
    const world = this.physics.world;
    const vel = dir.clone().multiplyScalar(spec.throwSpeed).add(new THREE.Vector3(0, 2.5, 0)).add(carry);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setLinvel(vel.x, vel.y, vel.z)
        .setAngvel({ x: Math.random() * 10, y: Math.random() * 10, z: Math.random() * 10 })
        // Damping stands in for rolling resistance so grenades settle instead of rolling away.
        .setLinearDamping(0.4)
        .setAngularDamping(4)
        .setCcdEnabled(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(RADIUS)
        .setDensity(1800)
        .setRestitution(0.3)
        .setFriction(0.8)
        .setCollisionGroups(groups(Layer.DEBRIS, Layer.WORLD)),
      body,
    );
    const mesh = new THREE.Mesh(this.geometry, this.materials.get(type)!);
    mesh.castShadow = true;
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.live.push({ type, body, mesh, fuse: spec.fuse, lastVel: vel.clone(), bounceCooldown: 0 });
  }

  /** Sim step: fuses and bounce detection (sudden velocity change). */
  step(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i]!;
      g.fuse -= dt;
      g.bounceCooldown -= dt;
      const v = g.body.linvel();
      const now = new THREE.Vector3(v.x, v.y, v.z);
      const change = now.distanceTo(g.lastVel);
      if (change > 2.5 && g.bounceCooldown <= 0) {
        const t = g.body.translation();
        this.bus.emit('grenade:bounce', { type: g.type, point: new THREE.Vector3(t.x, t.y, t.z), speed: change });
        g.bounceCooldown = 0.08;
      }
      g.lastVel.copy(now);
      if (g.fuse <= 0) {
        const t = g.body.translation();
        this.remove(i);
        this.bus.emit('grenade:detonate', { type: g.type, point: new THREE.Vector3(t.x, t.y + RADIUS, t.z) });
      }
    }
  }

  /** Render step: copy physics transforms to meshes. */
  sync(): void {
    for (const g of this.live) {
      const t = g.body.translation();
      const r = g.body.rotation();
      g.mesh.position.set(t.x, t.y, t.z);
      g.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** One mesh per grenade material, for shader warm-up. */
  warmupMeshes(): THREE.Mesh[] {
    return [...this.materials.values()].map((m) => {
      const mesh = new THREE.Mesh(this.geometry, m);
      mesh.castShadow = true;
      return mesh;
    });
  }

  clear(): void {
    while (this.live.length) this.remove(this.live.length - 1);
  }

  private remove(i: number): void {
    const g = this.live[i]!;
    this.physics.world.removeRigidBody(g.body);
    this.scene.remove(g.mesh);
    this.live.splice(i, 1);
  }
}
