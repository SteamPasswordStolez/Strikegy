import * as THREE from 'three';
import type { WeaponClass, WeaponDef } from './weaponData';

interface Shape {
  length: number;
  barrel: number;
  mag: number;
  stock: boolean;
  scope: boolean;
  color: number;
}

const SHAPES: Record<WeaponClass, Shape> = {
  ar: { length: 0.42, barrel: 0.2, mag: 0.14, stock: true, scope: false, color: 0x3a3935 },
  smg: { length: 0.3, barrel: 0.1, mag: 0.18, stock: true, scope: false, color: 0x2a2b2e },
  lmg: { length: 0.5, barrel: 0.26, mag: 0.1, stock: true, scope: false, color: 0x4b4e3c },
  sg: { length: 0.48, barrel: 0.28, mag: 0.0, stock: true, scope: false, color: 0x6b4a2e },
  dmr: { length: 0.5, barrel: 0.26, mag: 0.1, stock: true, scope: true, color: 0x8a7a5a },
  sr: { length: 0.56, barrel: 0.34, mag: 0.06, stock: true, scope: true, color: 0x5b4630 },
  pistol: { length: 0.17, barrel: 0.03, mag: 0.0, stock: false, scope: false, color: 0x232427 },
};

/** Shared across weapons; lit by the environment map for proper metal/polymer contrast. */
const MATERIALS = {
  metal: new THREE.MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.45, roughness: 0.5 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.4, roughness: 0.55 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x232427, metalness: 0, roughness: 0.62 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x0b1a2a, metalness: 1, roughness: 0.05, emissive: 0x06121e }),
  glove: new THREE.MeshStandardMaterial({ color: 0x2e2a25, metalness: 0, roughness: 0.78 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x3a4030, metalness: 0, roughness: 0.95 }),
};

const HIP = new THREE.Vector3(0.13, -0.14, -0.4);
const SPRINT_OFFSET = new THREE.Vector3(-0.04, -0.05, 0.03);
/** ADS x/y are derived per weapon so the sight line sits on screen center. */
const ADS_Z = -0.36;

export interface ViewModelFrame {
  dt: number;
  adsBlend: number;
  speed: number;
  grounded: boolean;
  sprinting: boolean;
  lookDYaw: number;
  lookDPitch: number;
  reloading: boolean;
  drawProgress: number;
  hideForScope: boolean;
}

/** Procedural first-person gun with bob, sway, recoil kick and reload/draw poses. */
export class ViewModel {
  private root = new THREE.Group();
  private gun = new THREE.Group();
  private muzzle = new THREE.Object3D();
  private flash: THREE.Mesh;
  private sightHeight = 0.05;
  private bobPhase = 0;
  private sway = new THREE.Vector2();
  private kick = 0;
  private kickRot = 0;
  private flashTimer = 0;
  private sprintBlend = 0;
  private reloadBlend = 0;
  private currentId = '';

  constructor(private readonly fpScene: THREE.Scene) {
    fpScene.add(this.root);
    this.root.add(this.gun);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), flashMat);
    this.flash.visible = false;
  }

  setWeapon(def: WeaponDef): void {
    if (def.id === this.currentId) return;
    this.currentId = def.id;
    this.gun.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== this.flash) o.geometry.dispose();
    });
    this.gun.clear();
    const s = SHAPES[def.class];
    const m = MATERIALS;
    const furniture = new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.6, metalness: 0.05 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      this.gun.add(mesh);
      return mesh;
    };
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, rx = 0) =>
      add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx);
    const tube = (r: number, len: number, x: number, y: number, z: number, mat: THREE.Material, seg = 12) =>
      add(new THREE.CylinderGeometry(r, r, len, seg), mat, x, y, z, Math.PI / 2);

    const pistol = def.class === 'pistol';
    const L = s.length;
    const bodyH = pistol ? 0.042 : 0.055;
    let topY = bodyH / 2;

    if (pistol) {
      box(0.03, bodyH, L, 0, 0, -L / 2 + 0.05, m.metal); // slide
      box(0.006, 0.01, 0.03, 0.016, 0.006, -0.02, m.dark); // ejection port
      box(0.028, 0.03, L * 0.9, 0, -0.035, -L / 2 + 0.06, m.polymer); // frame
      box(0.028, 0.1, 0.045, 0, -0.085, 0.03, m.polymer, -0.3); // grip
      box(0.006, 0.025, 0.03, 0, -0.058, -0.02, m.polymer); // trigger guard
    } else {
      box(0.05, bodyH, L * 0.55, 0, 0, -L * 0.2, m.metal); // upper receiver
      box(0.044, 0.035, L * 0.34, 0, -0.043, -L * 0.12, m.metal); // lower receiver
      box(0.008, 0.02, 0.05, 0.026, 0.005, -0.04, m.dark); // ejection port
      box(0.058, 0.06, L * 0.42, 0, -0.005, -L * 0.68, furniture); // handguard
      box(0.022, 0.008, L * 0.95, 0, topY + 0.004, -L * 0.45, m.dark); // top rail
      for (let i = 0; i < 12; i++) box(0.026, 0.005, 0.006, 0, topY + 0.01, -L * 0.05 - i * L * 0.075, m.dark);
      topY += 0.012;
      box(0.036, 0.1, 0.045, 0, -0.1, 0.04, m.polymer, -0.3); // grip
      box(0.006, 0.02, 0.05, 0, -0.07, -0.01, m.dark); // trigger guard
      if (s.mag > 0) box(0.03, s.mag, 0.07, 0, -0.06 - s.mag / 2, -0.09, m.polymer, 0.15);
      if (s.stock) {
        box(0.04, 0.06, 0.2, 0, -0.015, 0.2, furniture);
        box(0.045, 0.08, 0.02, 0, -0.02, 0.305, m.polymer); // butt pad
      }
      if (def.class === 'sg') {
        tube(0.013, L * 0.7, 0, -0.035, -L * 0.62, m.metal); // magazine tube
        box(0.05, 0.045, 0.14, 0, -0.04, -L * 0.72, furniture); // pump
      }
    }

    const barrelLen = s.barrel + 0.06;
    const barrelZ = (pistol ? -L + 0.05 : -L * 0.9) - barrelLen / 2 + 0.04;
    tube(pistol ? 0.008 : 0.011, barrelLen, 0, pistol ? 0.005 : 0.004, barrelZ, m.metal);
    if (!pistol) tube(0.017, 0.05, 0, 0.004, barrelZ - barrelLen / 2, m.dark); // muzzle device

    if (s.scope) {
      const sy = topY + 0.032;
      tube(0.019, 0.2, 0, sy, -0.1, m.dark, 16);
      tube(0.026, 0.05, 0, sy, -0.22, m.dark, 16); // objective bell
      tube(0.023, 0.04, 0, sy, 0.01, m.dark, 16); // eyepiece
      box(0.02, 0.03, 0.02, 0, sy - 0.024, -0.04, m.dark); // mounts
      box(0.02, 0.03, 0.02, 0, sy - 0.024, -0.16, m.dark);
      add(new THREE.CircleGeometry(0.024, 16), m.lens, 0, sy, -0.246).rotation.y = Math.PI;
      this.sightHeight = sy;
    } else {
      // Front post sits exactly on the sight line; the rear notch frames it.
      const frontZ = pistol ? -L + 0.06 : -L * 0.86;
      box(0.004, 0.018, 0.006, 0, topY + 0.009, frontZ, m.dark);
      box(0.008, 0.016, 0.01, -0.008, topY + 0.008, pistol ? 0.03 : -0.02, m.dark);
      box(0.008, 0.016, 0.01, 0.008, topY + 0.008, pistol ? 0.03 : -0.02, m.dark);
      this.sightHeight = topY + 0.018;
    }

    this.buildArms(pistol, L);

    this.muzzle.position.set(0, 0.005, barrelZ - barrelLen / 2 - 0.03);
    this.gun.add(this.muzzle);
    this.flash.position.copy(this.muzzle.position);
    this.gun.add(this.flash);
  }

  /** Gloved hands on the grip and support position, with sleeves running off-screen. */
  private buildArms(pistol: boolean, L: number): void {
    const m = MATERIALS;
    const limb = (from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, mat: THREE.Material) => {
      const dir = to.clone().sub(from);
      const len = dir.length();
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 10), mat);
      mesh.position.copy(from).addScaledVector(dir, 0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      this.gun.add(mesh);
    };
    const hand = (x: number, y: number, z: number, rx: number) => {
      const h = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.045, 4, 10), m.glove);
      h.position.set(x, y, z);
      h.rotation.set(rx, 0, Math.PI / 2);
      h.scale.set(1, 1, 0.85);
      this.gun.add(h);
    };
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    // Trigger hand
    hand(0.004, -0.095, 0.045, -0.3);
    limb(V(0.02, -0.12, 0.08), V(0.03, -0.14, 0.12), 0.03, 0.032, m.glove);
    limb(V(0.03, -0.14, 0.12), V(0.13, -0.33, 0.42), 0.042, 0.05, m.sleeve);

    if (pistol) {
      hand(-0.012, -0.1, 0.05, -0.1);
      limb(V(-0.03, -0.12, 0.08), V(-0.18, -0.32, 0.4), 0.04, 0.05, m.sleeve);
    } else {
      const hz = -L * 0.66;
      hand(-0.004, -0.055, hz, 0.1);
      limb(V(-0.02, -0.07, hz + 0.04), V(-0.03, -0.085, hz + 0.08), 0.029, 0.031, m.glove);
      limb(V(-0.03, -0.085, hz + 0.08), V(-0.2, -0.3, hz + 0.42), 0.04, 0.05, m.sleeve);
    }
  }

  onFire(ads: boolean): void {
    this.kick = Math.min(this.kick + (ads ? 0.025 : 0.04), 0.08);
    this.kickRot = Math.min(this.kickRot + (ads ? 0.03 : 0.07), 0.2);
    this.flashTimer = 0.04;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  update(f: ViewModelFrame): void {
    const dt = f.dt;
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);

    this.sprintBlend += ((f.sprinting ? 1 : 0) - this.sprintBlend) * ease(10);
    this.reloadBlend += ((f.reloading ? 1 : 0) - this.reloadBlend) * ease(10);

    // Bob scales with ground speed and fades while aiming.
    if (f.grounded) this.bobPhase += dt * (6 + f.speed * 1.4) * Math.min(1, f.speed / 2);
    const bobAmt = Math.min(1, f.speed / 5) * (1 - 0.85 * f.adsBlend) * (f.grounded ? 1 : 0.3);
    const bobX = Math.sin(this.bobPhase) * 0.012 * bobAmt;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.01 * bobAmt;

    // Sway lags behind look movement.
    const swayScale = 1 - 0.8 * f.adsBlend;
    this.sway.x += (THREE.MathUtils.clamp(f.lookDYaw * 0.6, -0.05, 0.05) - this.sway.x) * ease(12);
    this.sway.y += (THREE.MathUtils.clamp(f.lookDPitch * 0.6, -0.05, 0.05) - this.sway.y) * ease(12);

    this.kick *= Math.exp(-18 * dt);
    this.kickRot *= Math.exp(-14 * dt);

    const ads = new THREE.Vector3(0, -this.sightHeight, ADS_Z);
    const pos = HIP.clone().lerp(ads, f.adsBlend);
    pos.addScaledVector(SPRINT_OFFSET, this.sprintBlend);
    pos.x += bobX + this.sway.x * swayScale * 0.4;
    pos.y += bobY + this.sway.y * swayScale * 0.4 - this.reloadBlend * 0.06;
    pos.y -= (1 - f.drawProgress) * 0.25;
    pos.z += this.kick;
    this.root.position.copy(pos);
    this.root.rotation.set(
      this.kickRot + this.sway.y * swayScale - this.reloadBlend * 0.5 - this.sprintBlend * 0.2,
      this.sway.x * swayScale + this.sprintBlend * 0.6,
      this.reloadBlend * 0.4 + this.sprintBlend * 0.25,
    );

    this.flashTimer -= dt;
    this.flash.visible = this.flashTimer > 0;
    this.root.visible = !f.hideForScope;
  }

  /** Muzzle position mapped from viewmodel space into the world camera's space. */
  muzzleWorld(worldCamera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld();
    this.muzzle.getWorldPosition(out);
    return out.applyMatrix4(worldCamera.matrixWorld);
  }

  dispose(): void {
    this.fpScene.remove(this.root);
  }
}
