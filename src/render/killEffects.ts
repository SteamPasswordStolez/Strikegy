import * as THREE from 'three';
import type { KillFxLook } from '@/progression/catalog';

/**
 * Kill effects (progression step 6, progression-data.md I): a short burst of
 * small pieces round a downed soldier — ash, sparks, petals, stars, flakes,
 * scales, dog tags, leaves. Rules from the owner: at most 0.6 s, within about
 * a metre of the body, no light cast, nothing that lingers like smoke; at most
 * four at once (more play as an ordinary fall). One instanced quad mesh per
 * piece shape, facing the camera; shapes drawn once on small canvases.
 */

export const KILL_FX = { life: 0.6, maxAtOnce: 4, maxPieces: 48 } as const;

type Shape = KillFxLook['shape'];
const SHAPES: Shape[] = ['shard', 'spark', 'petal', 'star', 'flake', 'scale', 'tag', 'leaf'];

function shapeTexture(shape: Shape): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.translate(32, 32);
  switch (shape) {
    case 'shard':
      g.beginPath();
      g.moveTo(0, -28);
      g.lineTo(18, 14);
      g.lineTo(-14, 26);
      g.closePath();
      g.fill();
      break;
    case 'spark': {
      const r = g.createRadialGradient(0, 0, 0, 0, 0, 30);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.25, 'rgba(255,255,255,0.8)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(-32, -32, 64, 64);
      break;
    }
    case 'petal':
      g.beginPath();
      g.ellipse(0, 0, 14, 28, 0.3, 0, Math.PI * 2);
      g.fill();
      break;
    case 'star':
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 ? 12 : 30;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      break;
    case 'flake':
      g.lineWidth = 5;
      g.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        g.rotate(Math.PI / 3);
        g.beginPath();
        g.moveTo(0, -28);
        g.lineTo(0, 28);
        g.stroke();
      }
      break;
    case 'scale':
      g.beginPath();
      g.arc(0, -6, 26, 0, Math.PI);
      g.closePath();
      g.fill();
      break;
    case 'tag':
      g.beginPath();
      g.roundRect(-14, -24, 28, 48, 9);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(0, -15, 4, 0, Math.PI * 2);
      g.fill();
      break;
    case 'leaf':
      g.beginPath();
      g.moveTo(0, -30);
      g.quadraticCurveTo(24, 0, 0, 30);
      g.quadraticCurveTo(-24, 0, 0, -30);
      g.fill();
      break;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Piece {
  off: THREE.Vector3;
  vel: THREE.Vector3;
  spin: number;
  angle: number;
  color: THREE.Color;
  size: number;
  /** Swirl / ring: angle round the body and radius. */
  phase: number;
}

interface Effect {
  look: KillFxLook;
  at: THREE.Vector3;
  t: number;
  pieces: Piece[];
}

export class KillEffects {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<Shape, THREE.InstancedMesh>();
  private readonly effects: Effect[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qz = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly z = new THREE.Vector3(0, 0, 1);

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const cap = KILL_FX.maxAtOnce * KILL_FX.maxPieces;
    for (const shape of SHAPES) {
      const mat = new THREE.MeshBasicMaterial({ map: shapeTexture(shape), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      mesh.renderOrder = 5;
      this.meshes.set(shape, mesh);
      this.group.add(mesh);
    }
  }

  /** A kill effect at a body (`at`: where the soldier stood). False when four are already playing. */
  play(look: KillFxLook, at: THREE.Vector3): boolean {
    if (this.effects.length >= KILL_FX.maxAtOnce) return false;
    const n = Math.min(KILL_FX.maxPieces, look.count);
    const a = new THREE.Color(look.colors[0]);
    const b = new THREE.Color(look.colors[1]);
    const pieces: Piece[] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const off = new THREE.Vector3();
      const vel = new THREE.Vector3();
      const phase = Math.random() * Math.PI * 2;
      const h = 0.2 + Math.random() * 1.4;
      switch (look.motion) {
        case 'burst': {
          off.set(0, 1, 0);
          vel.randomDirection().multiplyScalar(1 + Math.random() * 1.1);
          vel.y = Math.abs(vel.y) * 0.8 + 0.3;
          break;
        }
        case 'rise':
          off.set(Math.cos(phase) * 0.3 * r, h * 0.8, Math.sin(phase) * 0.3 * r);
          vel.set((Math.random() - 0.5) * 0.3, 1 + Math.random() * 1.2, (Math.random() - 0.5) * 0.3);
          break;
        case 'fall':
          off.set(Math.cos(phase) * 0.35 * r, h, Math.sin(phase) * 0.35 * r);
          vel.set((Math.random() - 0.5) * 0.4, -0.6 - Math.random() * 0.8, (Math.random() - 0.5) * 0.4);
          break;
        case 'swirl':
        case 'ring':
        case 'wrap':
          off.set(0, look.motion === 'ring' ? 0.95 + (Math.random() - 0.5) * 0.15 : h, 0);
          vel.set(0, look.motion === 'swirl' ? 0.6 + Math.random() * 0.5 : 0, 0);
          break;
      }
      pieces.push({ off, vel, spin: (Math.random() - 0.5) * 9, angle: Math.random() * Math.PI * 2, color: a.clone().lerp(b, Math.random()), size: look.size * (0.6 + Math.random() * 0.8), phase });
    }
    this.effects.push({ look, at: at.clone(), t: 0, pieces });
    return true;
  }

  update(dt: number, camera: THREE.Camera): void {
    const counts = new Map<Shape, number>();
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]!;
      e.t += dt;
      if (e.t >= KILL_FX.life) this.effects.splice(i, 1);
    }
    for (const mesh of this.meshes.values()) mesh.count = 0;
    camera.getWorldQuaternion(this.q);
    for (const e of this.effects) {
      const u = e.t / KILL_FX.life;
      const mesh = this.meshes.get(e.look.shape)!;
      let n = counts.get(e.look.shape) ?? 0;
      for (const pc of e.pieces) {
        if (n >= mesh.instanceMatrix.count) break;
        const t = e.t;
        const m = e.look.motion;
        if (m === 'burst' || m === 'rise' || m === 'fall') {
          // Drag eases the pieces to a stop inside the metre round the body.
          const k = (1 - Math.exp(-2.5 * t)) / 2.5;
          this.p.set(pc.off.x + pc.vel.x * k, pc.off.y + pc.vel.y * k - (m === 'burst' ? 1.2 * t * t : 0), pc.off.z + pc.vel.z * k);
          if (m === 'fall') this.p.x += Math.sin(t * 7 + pc.phase) * 0.06;
        } else {
          const r = m === 'ring' ? 0.2 + u * 0.8 : m === 'wrap' ? 0.32 + Math.sin(t * 20 + pc.phase) * 0.03 : 0.25 + u * 0.35;
          const a = pc.phase + t * (m === 'ring' ? 2.5 : 7);
          this.p.set(Math.cos(a) * r, pc.off.y + pc.vel.y * t, Math.sin(a) * r);
        }
        this.p.add(e.at);
        // In quickly, out over the last half.
        const fade = Math.min(1, u * 8) * (u < 0.5 ? 1 : 1 - (u - 0.5) * 2);
        const size = pc.size * (0.4 + 0.6 * fade);
        this.qz.setFromAxisAngle(this.z, pc.angle + pc.spin * t);
        this.s.set(size, size, size);
        this.m.compose(this.p, this.q.clone().multiply(this.qz), this.s);
        mesh.setMatrixAt(n, this.m);
        mesh.setColorAt(n, pc.color);
        n++;
      }
      counts.set(e.look.shape, n);
    }
    for (const [shape, mesh] of this.meshes) {
      mesh.count = counts.get(shape) ?? 0;
      mesh.visible = mesh.count > 0;
      if (mesh.count) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  get playing(): number {
    return this.effects.length;
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.meshes.values().next().value?.geometry.dispose();
  }
}
