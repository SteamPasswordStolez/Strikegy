import * as THREE from 'three';
import type { Team } from '@/world/mapTypes';
import type { DogTag } from './matchRules';

/** Most tags drawn at once (older ones beyond this aren't shown; they fade in 30 s anyway). */
const MAX_TAGS = 64;
/** Enemy tags (score them) gold, our side's (deny them) light blue. */
const ENEMY = new THREE.Color(0xf2c443);
const OURS = new THREE.Color(0x7ec8ff);

/**
 * Kill-confirmed dog tags: small spinning, bobbing plates where soldiers went
 * down, one instanced draw for all of them, glowing a little so they read in
 * the grass.
 */
export class TagVisuals {
  private readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(0.22, 0.32, 0.03);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.35, emissive: 0x332200, emissiveIntensity: 0.6 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_TAGS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'dog-tags';
    scene.add(this.mesh);
  }

  update(tags: readonly DogTag[], myTeam: Team, time: number): void {
    const n = Math.min(MAX_TAGS, tags.length);
    for (let i = 0; i < n; i++) {
      const t = tags[i]!;
      this.e.set(0.2, time * 2.4 + t.id, 0);
      this.q.setFromEuler(this.e);
      // Bob above the ground; shrink away over the last 3 s of its life.
      this.p.set(t.x, t.y + 0.75 + Math.sin(time * 3 + t.id) * 0.08, t.z);
      const k = Math.min(1, t.life / 3);
      this.s.setScalar(0.4 + 0.6 * k);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, t.team === myTeam ? OURS : ENEMY);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
