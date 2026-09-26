import * as THREE from 'three';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { ImpactSurface } from '@/physics/surfaces';
import type { WeaponClass } from '@/weapons/weaponData';
import type { ShotTrace } from '@/weapons/WeaponController';
import { ParticleLayer } from './Particles';
import { LAYER_FX } from './layers';

const TRACER_LIFE = 0.06;
const MAX_TRACERS = 32;
const MAX_DECALS = 160;
const DECAL_SIZE = 0.09;
const MAX_CASINGS = 48;
const CASING_LIFE = 4;

interface Tracer {
  line: THREE.Line;
  life: number;
}

interface Casing {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  floorY: number;
  age: number;
  scale: number;
  bounced: number;
}

interface FlashLight {
  light: THREE.PointLight;
  peak: number;
  life: number;
  age: number;
}

export interface SmokeVolume {
  pos: THREE.Vector3;
  radius: number;
  until: number;
}

interface SmokeEmitter {
  pos: THREE.Vector3;
  age: number;
  duration: number;
  nextPuff: number;
}

const SURFACE_FX: Record<ImpactSurface, { dust: number; chips: number; decal: number; sparks: boolean }> = {
  dirt: { dust: 0x8a7558, chips: 0x3f3326, decal: 0x2a2016, sparks: false },
  concrete: { dust: 0xa8a39a, chips: 0x8c8a85, decal: 0x262422, sparks: false },
  brick: { dust: 0xa0624a, chips: 0x7a3a2a, decal: 0x2a1a14, sparks: false },
  metal: { dust: 0x8a8a8a, chips: 0x4a4a4a, decal: 0x1c1c1c, sparks: true },
  wood: { dust: 0xb08d63, chips: 0x7a5a38, decal: 0x2a1c10, sparks: false },
  rubber: { dust: 0x3a3a3a, chips: 0x151515, decal: 0x0e0e0e, sparks: false },
};

const CASING_SCALE: Record<WeaponClass, number> = {
  ar: 0.85,
  smg: 0.7,
  lmg: 0.85,
  sg: 1.5,
  dmr: 1.05,
  sr: 1.15,
  pistol: 0.65,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function randomDir(out: THREE.Vector3): THREE.Vector3 {
  return out.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
}

/** Tracers, decals, particles, casings, flash lights and smoke volumes. */
export class Effects {
  readonly smokes: SmokeVolume[] = [];
  private tracers: Tracer[] = [];
  private tracerCursor = 0;
  private decals: THREE.InstancedMesh;
  private decalCursor = 0;
  private readonly soft: ParticleLayer;
  private readonly glow: ParticleLayer;
  private readonly casings: Casing[] = [];
  private readonly casingMesh: THREE.InstancedMesh;
  private casingCursor = 0;
  private readonly lights: FlashLight[] = [];
  private readonly emitters: SmokeEmitter[] = [];
  private time = 0;
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpVec2 = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly color = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    dynamicLights: number,
  ) {
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe3a0, transparent: true, opacity: 0.8, depthWrite: false });
    for (let i = 0; i < MAX_TRACERS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, tracerMat.clone());
      line.frustumCulled = false;
      line.visible = false;
      line.layers.set(LAYER_FX);
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }

    const decalMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.decals = new THREE.InstancedMesh(new THREE.CircleGeometry(DECAL_SIZE / 2, 10), decalMat, MAX_DECALS);
    for (let i = 0; i < MAX_DECALS; i++) this.decals.setColorAt(i, this.color.set(0x000000));
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    scene.add(this.decals);

    this.soft = new ParticleLayer(scene, 1200, false);
    this.glow = new ParticleLayer(scene, 600, true);

    const casingGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.032, 8);
    casingGeo.rotateZ(Math.PI / 2);
    this.casingMesh = new THREE.InstancedMesh(
      casingGeo,
      new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.32 }),
      MAX_CASINGS,
    );
    this.casingMesh.count = 0;
    this.casingMesh.frustumCulled = false;
    scene.add(this.casingMesh);
    for (let i = 0; i < MAX_CASINGS; i++) {
      this.casings.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
        floorY: 0,
        age: 0,
        scale: 1,
        bounced: 0,
      });
    }

    // Lights stay in the scene permanently (intensity 0 when idle) so toggling
    // them never changes the light count and forces shader recompiles.
    {
      for (let i = 0; i < dynamicLights; i++) {
        const light = new THREE.PointLight(0xffc27a, 0, 12, 2);
        scene.add(light);
        this.lights.push({ light, peak: 0, life: 1, age: 1 });
      }
    }
  }

  /** Height of the first surface below `p`, or `fallback`. */
  private floorBelow(p: THREE.Vector3, fallback = 0): number {
    const hit = this.physics.raycast(p, { x: 0, y: -1, z: 0 }, 20, Layer.WORLD);
    return hit ? hit.point.y : fallback;
  }

  private flashLight(pos: THREE.Vector3, peak: number, life: number, color: number, distance: number): void {
    if (this.lights.length === 0) return;
    const l = this.lights.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    l.light.position.copy(pos);
    l.light.color.set(color);
    l.light.distance = distance;
    l.peak = peak;
    l.life = life;
    l.age = 0;
  }

  /**
   * Puts one of every effect type in front of `eye` so a warm-up render compiles
   * their shaders during loading instead of hitching on first use.
   */
  warmup(eye: THREE.Vector3, fwd: THREE.Vector3): void {
    const p = eye.clone().addScaledVector(fwd, 3);
    this.soft.spawn({ pos: p, life: 0.05, size: 0.1, color: 0x808080, alpha: 0.01 });
    this.glow.spawn({ pos: p, life: 0.05, size: 0.1, color: 0x808080, alpha: 0.01 });
    this.addTracer(p, p.clone().addScaledVector(fwd, 1));
    const c = this.casings[0]!;
    c.alive = true;
    c.age = CASING_LIFE - 0.05;
    c.pos.copy(p);
    c.floorY = -1000;
    this.soft.update(0);
    this.glow.update(0);
    this.updateCasings(0);
  }

  /** Consumes shot traces; `muzzle` is where tracers visually start. */
  spawnShots(traces: ShotTrace[], muzzle: THREE.Vector3): void {
    for (const t of traces) {
      if (traces.length <= 2 || Math.random() < 0.3) this.addTracer(muzzle, t.to);
    }
    traces.length = 0;
  }

  muzzleFlash(muzzle: THREE.Vector3, forward: THREE.Vector3): void {
    this.flashLight(muzzle, 5, 0.05, 0xffc27a, 9);
    // A faint wisp of gun smoke drifting off the muzzle.
    this.soft.spawn({
      pos: muzzle.clone().addScaledVector(forward, 0.15),
      vel: forward.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 0.25, 0)),
      life: 0.7,
      size: 0.12,
      endSize: 0.5,
      color: 0xc8c4bc,
      alpha: 0.18,
      drag: 2,
    });
  }

  ejectCasing(origin: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, carry: THREE.Vector3, cls: WeaponClass): void {
    const c = this.casings[this.casingCursor]!;
    this.casingCursor = (this.casingCursor + 1) % MAX_CASINGS;
    c.alive = true;
    c.age = 0;
    c.bounced = 0;
    c.scale = CASING_SCALE[cls];
    c.pos.copy(origin);
    c.vel
      .copy(carry)
      .addScaledVector(right, rand(2.6, 3.4))
      .addScaledVector(up, rand(1.2, 1.8))
      .addScaledVector(right.clone().cross(up), rand(0.4, 0.8));
    c.rot.set(rand(0, 6), rand(0, 6), rand(0, 6));
    c.spin.set(rand(-20, 20), rand(-30, 30), rand(-20, 20));
    c.floorY = this.floorBelow(origin, origin.y - 1.6);
  }

  impact(point: THREE.Vector3, normal: THREE.Vector3, surface: ImpactSurface): void {
    const fx = SURFACE_FX[surface];
    this.addDecal(point, normal, fx.decal, 0.7 + Math.random() * 0.6);
    const floorY = point.y - 3;
    for (let i = 0; i < 3; i++) {
      this.soft.spawn({
        pos: point.clone().addScaledVector(normal, 0.05),
        vel: normal.clone().multiplyScalar(rand(0.6, 1.6)).add(randomDir(this.tmpVec).multiplyScalar(0.35)),
        life: rand(0.6, 1.1),
        size: rand(0.12, 0.22),
        endSize: rand(0.6, 1.1),
        color: fx.dust,
        alpha: 0.55,
        drag: 3,
        gravity: -0.3,
      });
    }
    for (let i = 0; i < 5; i++) {
      this.soft.spawn({
        pos: point.clone().addScaledVector(normal, 0.03),
        vel: normal.clone().multiplyScalar(rand(1.5, 4)).add(randomDir(this.tmpVec).multiplyScalar(1.8)),
        life: rand(0.5, 0.9),
        size: rand(0.015, 0.035),
        color: fx.chips,
        alpha: 1,
        gravity: 9.8,
        floorY,
      });
    }
    if (fx.sparks) {
      for (let i = 0; i < 8; i++) {
        this.glow.spawn({
          pos: point.clone(),
          vel: normal.clone().multiplyScalar(rand(2, 5)).add(randomDir(this.tmpVec).multiplyScalar(3.5)),
          life: rand(0.15, 0.35),
          size: 0.05,
          endSize: 0.02,
          color: 0xffc060,
          gravity: 9.8,
        });
      }
    }
  }

  /** Bullet striking a practice target (plastic chips). */
  targetHit(point: THREE.Vector3): void {
    for (let i = 0; i < 6; i++) {
      this.soft.spawn({
        pos: point.clone(),
        vel: randomDir(this.tmpVec).multiplyScalar(rand(1, 2.5)),
        life: rand(0.4, 0.7),
        size: rand(0.02, 0.04),
        color: 0xd98a3a,
        gravity: 9.8,
      });
    }
    this.soft.spawn({ pos: point.clone(), life: 0.4, size: 0.1, endSize: 0.35, color: 0xd9a066, alpha: 0.35, drag: 3 });
  }

  explosion(point: THREE.Vector3): void {
    const floorY = this.floorBelow(point.clone().setY(point.y + 0.3), point.y - 0.5);
    const up = new THREE.Vector3(0, 1, 0);
    this.flashLight(point.clone().setY(point.y + 0.8), 900, 0.35, 0xffa050, 30);
    this.glow.spawn({ pos: point.clone().setY(point.y + 0.4), life: 0.12, size: 7, endSize: 9, color: 0xfff2d0 });
    for (let i = 0; i < 16; i++) {
      this.glow.spawn({
        pos: point.clone().setY(point.y + 0.3),
        vel: randomDir(this.tmpVec).multiplyScalar(rand(2, 6)).addScaledVector(up, 2),
        life: rand(0.3, 0.6),
        size: rand(1.2, 2),
        endSize: rand(3, 4.5),
        color: i % 3 === 0 ? 0xffd080 : 0xff7a30,
        alpha: 0.9,
        drag: 4,
      });
    }
    for (let i = 0; i < 24; i++) {
      this.glow.spawn({
        pos: point.clone().setY(point.y + 0.2),
        vel: randomDir(this.tmpVec).multiplyScalar(rand(6, 14)).addScaledVector(up, 3),
        life: rand(0.4, 0.9),
        size: 0.07,
        endSize: 0.03,
        color: 0xffd080,
        gravity: 9.8,
        floorY,
      });
    }
    for (let i = 0; i < 20; i++) {
      this.soft.spawn({
        pos: point.clone().add(randomDir(this.tmpVec).multiplyScalar(0.6)).setY(point.y + rand(0.3, 1.5)),
        vel: randomDir(this.tmpVec2).multiplyScalar(rand(1, 3)).addScaledVector(up, rand(1, 2.5)),
        life: rand(3, 6),
        size: rand(1.5, 2.5),
        endSize: rand(5, 7),
        color: i % 2 ? 0x3d3934 : 0x5a554e,
        alpha: 0.75,
        fadeIn: 0.15,
        drag: 1.1,
        rotSpeed: rand(-0.4, 0.4),
      });
    }
    for (let i = 0; i < 36; i++) {
      this.soft.spawn({
        pos: point.clone().setY(point.y + 0.1),
        vel: randomDir(this.tmpVec).setY(0).normalize().multiplyScalar(rand(2, 6)).addScaledVector(up, rand(4, 10)),
        life: rand(1.2, 2),
        size: rand(0.05, 0.14),
        color: 0x2e261c,
        gravity: 12,
        floorY,
      });
    }
    this.addDecal(new THREE.Vector3(point.x, floorY + 0.01, point.z), up, 0x14110e, 30);
  }

  flashbang(point: THREE.Vector3): void {
    this.flashLight(point.clone().setY(point.y + 0.5), 2500, 0.25, 0xf2f6ff, 40);
    this.glow.spawn({ pos: point.clone().setY(point.y + 0.3), life: 0.18, size: 5, endSize: 8, color: 0xffffff });
    for (let i = 0; i < 16; i++) {
      this.glow.spawn({
        pos: point.clone(),
        vel: randomDir(this.tmpVec).multiplyScalar(rand(4, 9)),
        life: rand(0.2, 0.5),
        size: 0.06,
        color: 0xfff4d0,
        gravity: 9.8,
      });
    }
    this.soft.spawn({ pos: point.clone().setY(point.y + 0.4), life: 3, size: 0.8, endSize: 3, color: 0xcfcfcf, alpha: 0.5, drag: 1 });
  }

  smoke(point: THREE.Vector3, duration: number, radius: number): void {
    this.emitters.push({ pos: point.clone(), age: 0, duration, nextPuff: 0 });
    this.smokes.push({ pos: point.clone(), radius, until: this.time + duration });
  }

  private addTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const tr = this.tracers[this.tracerCursor]!;
    this.tracerCursor = (this.tracerCursor + 1) % MAX_TRACERS;
    const pos = tr.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    // Start a little ahead of the muzzle so the line doesn't cover the gun.
    const start = from.clone().lerp(to, Math.min(0.5, 1.5 / Math.max(1, from.distanceTo(to))));
    pos.setXYZ(0, start.x, start.y, start.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    tr.life = TRACER_LIFE;
    tr.line.visible = true;
  }

  private addDecal(point: THREE.Vector3, normal: THREE.Vector3, color: number, size: number): void {
    this.tmpQuat.setFromUnitVectors(this.zAxis, normal);
    this.scale.set(size, size, size);
    this.tmpMat.compose(point.clone().addScaledVector(normal, 0.005), this.tmpQuat, this.scale);
    this.decals.setMatrixAt(this.decalCursor, this.tmpMat);
    this.decals.setColorAt(this.decalCursor, this.color.set(color));
    this.decalCursor = (this.decalCursor + 1) % MAX_DECALS;
    this.decals.count = Math.min(MAX_DECALS, this.decals.count + 1);
    this.decals.instanceMatrix.needsUpdate = true;
    if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;
  }

  /** Current smoke volumes (for line-of-sight checks). */
  activeSmokes(): SmokeVolume[] {
    return this.smokes.filter((s) => s.until > this.time);
  }

  update(dt: number): void {
    this.time += dt;
    for (const tr of this.tracers) {
      if (tr.life <= 0) continue;
      tr.life -= dt;
      (tr.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, tr.life / TRACER_LIFE) * 0.8;
      if (tr.life <= 0) tr.line.visible = false;
    }

    for (const l of this.lights) {
      if (l.age >= l.life) {
        l.light.intensity = 0;
        continue;
      }
      l.age += dt;
      const k = Math.max(0, 1 - l.age / l.life);
      l.light.intensity = l.peak * k * k;
    }

    this.updateSmoke(dt);
    this.updateCasings(dt);
    this.soft.update(dt);
    this.glow.update(dt);
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      if (this.smokes[i]!.until < this.time) this.smokes.splice(i, 1);
    }
  }

  private updateSmoke(dt: number): void {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i]!;
      e.age += dt;
      e.nextPuff -= dt;
      // Heavy output for the first seconds, then just enough to keep the cloud alive.
      const rate = e.age < 3 ? 0.05 : 0.3;
      while (e.nextPuff <= 0 && e.age < e.duration - 4) {
        e.nextPuff += rate;
        const remaining = e.duration - e.age;
        this.soft.spawn({
          pos: e.pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(0.3, 1.2), rand(-0.3, 0.3))),
          vel: new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize().multiplyScalar(rand(0.6, 1.6)).setY(rand(0.35, 0.9)),
          life: Math.min(remaining, rand(9, 13)),
          size: rand(2.2, 3),
          endSize: rand(6, 8),
          color: this.color.setHSL(0, 0, rand(0.62, 0.75)).getHex(),
          alpha: 1,
          fadeIn: 0.6,
          drag: 0.5,
          rotSpeed: rand(-0.15, 0.15),
        });
      }
      if (e.age >= e.duration) this.emitters.splice(i, 1);
    }
  }

  private updateCasings(dt: number): void {
    let n = 0;
    for (const c of this.casings) {
      if (!c.alive) continue;
      c.age += dt;
      if (c.age > CASING_LIFE) {
        c.alive = false;
        continue;
      }
      c.vel.y -= 9.8 * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.rot.x += c.spin.x * dt;
      c.rot.y += c.spin.y * dt;
      c.rot.z += c.spin.z * dt;
      if (c.pos.y < c.floorY + 0.006) {
        c.pos.y = c.floorY + 0.006;
        if (c.bounced < 3 && c.vel.y < -0.5) {
          c.vel.set(c.vel.x * 0.45, -c.vel.y * 0.35, c.vel.z * 0.45);
          c.spin.multiplyScalar(0.5);
          c.bounced++;
        } else {
          c.vel.set(0, 0, 0);
          c.spin.set(0, 0, 0);
          c.rot.x = Math.PI / 2 * Math.round(c.rot.x / (Math.PI / 2));
        }
      }
      const fade = c.age > CASING_LIFE - 0.5 ? (CASING_LIFE - c.age) / 0.5 : 1;
      this.scale.setScalar(c.scale * fade);
      this.tmpQuat.setFromEuler(c.rot);
      this.tmpMat.compose(c.pos, this.tmpQuat, this.scale);
      this.casingMesh.setMatrixAt(n++, this.tmpMat);
    }
    this.casingMesh.count = n;
    this.casingMesh.instanceMatrix.needsUpdate = true;
  }
}
