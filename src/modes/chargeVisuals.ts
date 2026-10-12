import * as THREE from 'three';
import type { Charge } from './matchRules';

const CRATE = new THREE.Color(0x5a5f48);
const IDLE = new THREE.Color(0xffb020);
const ARMED = new THREE.Color(0xff2a1a);

/**
 * The charges of Rush / S&D: a squat olive box on the spot with a lamp on
 * top (amber while it waits, blinking red once armed); gone once blown. One
 * instanced mesh each for boxes and lamps.
 */
export class ChargeVisuals {
  private readonly boxes: THREE.InstancedMesh;
  private readonly lamps: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();

  constructor(
    private readonly scene: THREE.Scene,
    max = 32,
  ) {
    const box = new THREE.BoxGeometry(0.9, 0.55, 0.6).translate(0, 0.275, 0);
    this.boxes = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: CRATE, roughness: 0.8, metalness: 0.2 }), max);
    const lamp = new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10).translate(0, 0.61, 0);
    this.lamps = new THREE.InstancedMesh(lamp, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), max);
    for (const m of [this.boxes, this.lamps]) {
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
    }
  }

  update(charges: readonly Charge[], time: number): void {
    let n = 0;
    for (const c of charges) {
      if (c.state === 'gone' || n >= this.boxes.instanceMatrix.count) continue;
      this.m.makeTranslation(c.x, c.y, c.z);
      this.boxes.setMatrixAt(n, this.m);
      this.lamps.setMatrixAt(n, this.m);
      // Armed: blinks faster as the fuse runs down.
      const blink = c.state === 'armed' ? Math.sin(time * (c.fuse < 10 ? 18 : 8)) > 0 : true;
      this.lamps.setColorAt(n, c.state === 'armed' ? (blink ? ARMED : CRATE) : IDLE);
      n++;
    }
    this.boxes.count = this.lamps.count = n;
    this.boxes.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.boxes, this.lamps]) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    void this.scene;
  }
}
