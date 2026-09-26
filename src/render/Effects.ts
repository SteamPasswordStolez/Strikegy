import * as THREE from 'three';
import type { ShotTrace } from '@/weapons/WeaponController';

const TRACER_LIFE = 0.06;
const MAX_TRACERS = 32;
const MAX_DECALS = 128;
const DECAL_SIZE = 0.09;

interface Tracer {
  line: THREE.Line;
  life: number;
}

/** Pooled bullet tracers and impact marks. */
export class Effects {
  private tracers: Tracer[] = [];
  private tracerCursor = 0;
  private decals: THREE.InstancedMesh;
  private decalCursor = 0;
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly scale = new THREE.Vector3(1, 1, 1);

  constructor(scene: THREE.Scene) {
    const tracerMat = new THREE.LineBasicMaterial({
      color: 0xffe3a0,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    for (let i = 0; i < MAX_TRACERS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, tracerMat.clone());
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }

    const decalGeo = new THREE.CircleGeometry(DECAL_SIZE / 2, 8);
    const decalMat = new THREE.MeshBasicMaterial({
      color: 0x1b1712,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.decals = new THREE.InstancedMesh(decalGeo, decalMat, MAX_DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    scene.add(this.decals);
  }

  /** Consumes shot traces; `muzzle` is where tracers visually start. */
  spawnShots(traces: ShotTrace[], muzzle: THREE.Vector3): void {
    for (const t of traces) {
      // Only draw every tracer for single shots; pellets would be noise.
      if (traces.length <= 2 || Math.random() < 0.3) this.addTracer(muzzle, t.to);
      if (t.hitWorld && t.normal) this.addDecal(t.to, t.normal);
    }
    traces.length = 0;
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

  private addDecal(point: THREE.Vector3, normal: THREE.Vector3): void {
    this.tmpQuat.setFromUnitVectors(this.zAxis, normal);
    const s = 0.7 + Math.random() * 0.6;
    this.scale.set(s, s, s);
    this.tmpMat.compose(point.clone().addScaledVector(normal, 0.005), this.tmpQuat, this.scale);
    this.decals.setMatrixAt(this.decalCursor, this.tmpMat);
    this.decalCursor = (this.decalCursor + 1) % MAX_DECALS;
    this.decals.count = Math.min(MAX_DECALS, this.decals.count + 1);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    for (const tr of this.tracers) {
      if (tr.life <= 0) continue;
      tr.life -= dt;
      const mat = tr.line.material as THREE.LineBasicMaterial;
      mat.opacity = Math.max(0, tr.life / TRACER_LIFE) * 0.8;
      if (tr.life <= 0) tr.line.visible = false;
    }
  }
}
