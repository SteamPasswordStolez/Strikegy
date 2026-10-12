import * as THREE from 'three';
import type { LastStandRules } from './matchRules';

/**
 * Last soldier standing in the world: the circle as a tall see-through red
 * wall (an open cylinder, faded toward the top), a low white fence where it
 * closes in to next, and the crates not opened yet (olive boxes).
 */
export class LastStandVisuals {
  private readonly wall: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly crates: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();

  constructor(
    scene: THREE.Scene,
    private readonly groundY: number,
    max = 256,
  ) {
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true).translate(0, 0.5, 0);
    const wallMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform float time; varying vec2 vUv; void main() { float band = 0.5 + 0.5 * sin(vUv.y * 40.0 - time * 2.0); float a = (1.0 - vUv.y) * (0.22 + 0.1 * band); gl_FragColor = vec4(1.0, 0.25, 0.15, a); }',
    });
    this.wall = new THREE.Mesh(wallGeo, wallMat);
    this.wall.frustumCulled = false;
    this.wall.renderOrder = 5;
    // A low white fence, so it reads over hills and hollows alike.
    const ringGeo = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true).translate(0, 0.5, 0);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.ring.frustumCulled = false;
    const box = new THREE.BoxGeometry(1, 0.6, 0.7).translate(0, 0.3, 0);
    this.crates = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 0.8 }), max);
    this.crates.count = 0;
    this.crates.frustumCulled = false;
    scene.add(this.wall, this.ring, this.crates);
  }

  update(m: LastStandRules, time: number): void {
    const c = m.circle;
    this.wall.position.set(c.x, this.groundY - 20, c.z);
    this.wall.scale.set(c.r, 120, c.r);
    (this.wall.material as THREE.ShaderMaterial).uniforms.time!.value = time;
    const shrinking = m.phase === 'shrink' || Math.abs(m.next.r - c.r) > 0.5;
    this.ring.visible = shrinking;
    this.ring.position.set(m.next.x, this.groundY - 4, m.next.z);
    this.ring.scale.set(m.next.r, 12, m.next.r);
    let n = 0;
    for (const k of m.crates) {
      if (k.taken || n >= this.crates.instanceMatrix.count) continue;
      this.m.makeTranslation(k.x, k.y, k.z);
      this.crates.setMatrixAt(n++, this.m);
    }
    this.crates.count = n;
    this.crates.instanceMatrix.needsUpdate = true;
  }
}
