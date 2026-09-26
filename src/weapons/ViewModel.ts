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
  ar: { length: 0.42, barrel: 0.2, mag: 0.14, stock: true, scope: false, color: 0x5a6068 },
  smg: { length: 0.3, barrel: 0.1, mag: 0.18, stock: true, scope: false, color: 0x52575e },
  lmg: { length: 0.5, barrel: 0.26, mag: 0.1, stock: true, scope: false, color: 0x5d6152 },
  sg: { length: 0.48, barrel: 0.28, mag: 0.0, stock: true, scope: false, color: 0x7a5c40 },
  dmr: { length: 0.5, barrel: 0.26, mag: 0.1, stock: true, scope: true, color: 0x585d50 },
  sr: { length: 0.56, barrel: 0.34, mag: 0.06, stock: true, scope: true, color: 0x6e5a40 },
  pistol: { length: 0.17, barrel: 0.03, mag: 0.0, stock: false, scope: false, color: 0x4a4d52 },
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
    this.gun.clear();
    const s = SHAPES[def.class];
    // Low metalness: there is no environment map, so metallic surfaces would render black.
    const mat = new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.55, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.15 });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m = mat) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      this.gun.add(mesh);
      return mesh;
    };

    const bodyH = def.class === 'pistol' ? 0.05 : 0.07;
    box(0.05, bodyH, s.length, 0, 0, -s.length / 2 + 0.08);
    // Barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, s.barrel + 0.05, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    const barrelZ = -s.length + 0.08 - s.barrel / 2;
    barrel.position.set(0, 0.01, barrelZ);
    this.gun.add(barrel);
    // Grip
    box(0.04, 0.1, 0.05, 0, -0.07, 0.03, dark).rotation.x = -0.25;
    if (s.mag > 0) box(0.035, s.mag, 0.06, 0, -bodyH / 2 - s.mag / 2, -0.1, dark);
    if (s.stock) box(0.04, 0.07, 0.16, 0, -0.01, 0.16, mat);
    if (def.class === 'sg') box(0.045, 0.04, 0.16, 0, -0.05, -0.28, dark); // pump

    if (s.scope) {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.18, 12), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, bodyH / 2 + 0.03, -0.1);
      this.gun.add(scope);
      this.sightHeight = bodyH / 2 + 0.03;
    } else {
      // Front post sits exactly on the sight line; the rear notch frames it.
      box(0.004, 0.02, 0.006, 0, bodyH / 2 + 0.01, -s.length + 0.12, dark);
      box(0.008, 0.016, 0.008, -0.008, bodyH / 2 + 0.008, -0.02, dark);
      box(0.008, 0.016, 0.008, 0.008, bodyH / 2 + 0.008, -0.02, dark);
      this.sightHeight = bodyH / 2 + 0.02;
    }

    this.muzzle.position.set(0, 0.01, barrelZ - (s.barrel + 0.05) / 2);
    this.gun.add(this.muzzle);
    this.flash.position.copy(this.muzzle.position);
    this.gun.add(this.flash);
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
