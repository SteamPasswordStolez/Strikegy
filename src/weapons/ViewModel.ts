import * as THREE from 'three';
import type { ModelLibrary } from '@/render/models';
import type { WeaponDef } from './weaponData';
import { gunMaterials, type P } from './gunKit';
import { buildGun } from './gunModels';
import {
  INSPECT_HAND,
  INSPECT_MAG_HELD,
  INSPECT_POS,
  INSPECT_ROT,
  MELEE_LONG,
  MELEE_PISTOL,
  pickMelee,
  RELOAD_GUN_ROT,
  RELOAD_HAND,
  RELOAD_HAND_ROT,
  RELOAD_MAG_HELD,
  RELOAD_POSE,
  SHELL_HAND,
  SHELL_IN_HAND_UNTIL,
  sampleTrack,
  type HandAnchor,
} from './viewAnims';

/** Scanned models used when available: bolt-action rifles and pistols. */
const SCANNED_RIFLE = 'bolt_action_rifle_7_62';
const SCANNED_PISTOL = 'service_pistol';
/** Parts of the scanned pistol file (it also holds a second, disassembled copy). */
const PISTOL_PARTS = {
  keep: ['service_pistol_pistol_a', 'service_pistol_slide_a', 'service_pistol_magazine_loaded', 'service_pistol_hammer_a', 'service_pistol_trigger_a'],
  slide: 'service_pistol_slide_a',
  mag: 'service_pistol_magazine_loaded',
  /** Shift along the source X axis that puts the magazine inside the grip (measured from the mesh). */
  magIntoGrip: 0.094,
};

const HIP = new THREE.Vector3(0.13, -0.14, -0.4);
const SPRINT_OFFSET = new THREE.Vector3(-0.04, -0.05, 0.03);
/** ADS x/y are derived per weapon so the sight line sits on screen center. */
/** Eye distance behind the gun origin at ADS: cheek on the stock, pistols at arm's length. */
const ADS_EYE = { rifle: 0.2, pistol: 0.42, scanned: 0.3 };

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
  /** 0..1 progress of a magazine reload, or of the current shell (per-shell). */
  reloadProgress: number;
  magReload: boolean;
  /** 0..1 through a melee swing, or -1. */
  meleeT: number;
  /** 0..1 through a weapon inspection, or -1. */
  inspectT: number;
  /** Seconds of hammering (building), or -1: the gun goes down and a hammer comes up. */
  tool?: number;
}

/** Procedural first-person gun with bob, sway, recoil kick and reload/draw poses. */
export class ViewModel {
  private root = new THREE.Group();
  private gun = new THREE.Group();
  private muzzle = new THREE.Object3D();
  private flash: THREE.Mesh;
  private sightHeight = 0.05;
  private adsZ = -ADS_EYE.rifle;
  private bobPhase = 0;
  private sway = new THREE.Vector2();
  private kick = 0;
  private kickRot = 0;
  private flashTimer = 0;
  private sprintBlend = 0;
  private reloadBlend = 0;
  private currentId = '';
  /** Magazine, pump and slide parts animated during reload / cycling / firing. */
  private mag: THREE.Object3D | null = null;
  private magBase = new THREE.Vector3();
  private pump: THREE.Object3D | null = null;
  private pumpBase = new THREE.Vector3();
  private slide: THREE.Object3D | null = null;
  private slideBase = new THREE.Vector3();
  /** Slide travel direction in the slide's parent space (toward the shooter). */
  private slideDir = new THREE.Vector3(0, 0, 1);
  private slideT = 1;
  private cycleT = 1;
  private throwT = 1;
  private landDip = 0;
  private pistol = false;
  /** Support hand: its own group (pivot at the palm) so it can let go of the gun. */
  private support = new THREE.Group();
  private supportInner = new THREE.Group();
  /** A shell / cartridge shown in the support hand while loading one by one. */
  private shell: THREE.Mesh | null = null;
  /** Hand targets in gun space, relative to the hand's rest spot. */
  private readonly anchors: Record<HandAnchor, THREE.Vector3> = {
    mag: new THREE.Vector3(),
    chamber: new THREE.Vector3(),
    port: new THREE.Vector3(),
  };
  /** Magazine rest position in gun space and gun space -> magazine parent space. */
  private magRestGun = new THREE.Vector3();
  private magToParent = new THREE.Matrix4();
  private meleeJolt = 0;
  /** Index of the current / last melee motion, and whether a swing is under way. */
  private meleeMove = 0;
  private meleeActive = false;
  private readonly tv = new THREE.Vector3();
  private readonly tr = new THREE.Vector3();
  private readonly tq = new THREE.Vector3();
  private readonly extraPos = new THREE.Vector3();
  private readonly extraRot = new THREE.Vector3();
  /** Building hammer (own group in the viewmodel scene) and how far it is raised 0..1. */
  private hammer: THREE.Group | null = null;
  private toolBlend = 0;

  constructor(
    private readonly fpScene: THREE.Scene,
    private readonly models: ModelLibrary | null = null,
  ) {
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
    // Procedural geometry is per weapon; scanned models share geometry with the library.
    this.gun.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== this.flash && o.userData.owned) o.geometry.dispose();
    });
    this.gun.clear();
    this.mag = this.pump = this.slide = null;
    this.shell = null;
    this.support = new THREE.Group();
    this.supportInner = new THREE.Group();
    this.support.add(this.supportInner);
    this.gun.add(this.support);
    this.pistol = def.class === 'pistol';
    if (def.class === 'sr' && this.models?.has(SCANNED_RIFLE)) {
      this.buildScannedRifle();
    } else if (def.class === 'pistol' && this.models?.has(SCANNED_PISTOL)) {
      this.buildScannedPistol();
    } else {
      const g = buildGun(def);
      g.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.userData.owned = true;
      });
      this.gun.add(g.group);
      this.sightHeight = g.sightHeight;
      this.adsZ = -(def.class === 'pistol' ? ADS_EYE.pistol : ADS_EYE.rifle);
      this.setParts(g.mag, g.pump, g.slide);
      this.buildArms(def.class === 'pistol', g.support);
      this.placeMuzzle(g.muzzle);
    }
    this.buildShell(def);
    this.measureAnchors(def);
  }

  /** A shotgun shell or rifle cartridge held in the support hand's fingers. */
  private buildShell(def: WeaponDef): void {
    if (def.reloadStyle !== 'perShell') return;
    const sg = def.class === 'sg';
    const mat = sg ? gunMaterials().shellHull : gunMaterials().brass;
    const r = sg ? 0.0095 : 0.0055;
    const len = sg ? 0.066 : 0.075;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
    mesh.userData.owned = true;
    // Across the fingertips, pointing forward along the gun.
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(0.012, 0.012, -0.03);
    mesh.visible = false;
    this.support.add(mesh);
    this.shell = mesh;
  }

  /**
   * Finds where the support hand goes during reloads: the magazine (from its
   * bounds), the charging handle or slide, and the loading port, all relative
   * to where the hand rests.
   */
  private measureAnchors(def: WeaponDef): void {
    const root = this.root;
    const saved = { p: root.position.clone(), r: root.rotation.clone() };
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const rest = this.support.position;
    const pistol = def.class === 'pistol';
    const grip = new THREE.Vector3();
    if (this.mag) {
      this.mag.position.copy(this.magBase);
      this.mag.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.mag);
      // Palm on the left of the magazine, over its lower part.
      grip.set(box.min.x - 0.012, box.min.y + (box.max.y - box.min.y) * (pistol ? 0.2 : 0.4), (box.min.z + box.max.z) / 2 + 0.01);
      this.magRestGun.copy(this.magBase).applyMatrix4(this.mag.parent!.matrixWorld);
      this.magToParent.copy(this.mag.parent!.matrixWorld).invert();
    } else {
      grip.set(pistol ? -0.035 : -0.04, pistol ? -0.16 : -0.1, pistol ? 0.075 : -0.02);
    }
    this.anchors.mag.copy(grip).sub(rest);
    this.anchors.chamber.set(pistol ? -0.035 : -0.045, pistol ? 0.02 : 0.03, pistol ? 0.06 : 0.12).sub(rest);
    if (def.class === 'sg') this.anchors.port.set(-0.035, -0.05, -0.04).sub(rest);
    else if (def.class === 'sr') this.anchors.port.set(-0.045, 0.02, 0.0).sub(rest);
    else this.anchors.port.copy(this.anchors.mag);
    root.position.copy(saved.p);
    root.rotation.copy(saved.r);
    root.updateMatrixWorld(true);
  }

  private setParts(mag: THREE.Object3D | null, pump: THREE.Object3D | null, slide: THREE.Object3D | null): void {
    this.mag = mag;
    this.pump = pump;
    this.slide = slide;
    if (mag) this.magBase.copy(mag.position);
    if (pump) this.pumpBase.copy(pump.position);
    if (slide) this.slideBase.copy(slide.position);
    this.slideDir.set(0, 0, 1);
  }

  private placeMuzzle(p: THREE.Vector3): void {
    this.muzzle.position.copy(p);
    this.gun.add(this.muzzle);
    this.flash.position.copy(p);
    this.gun.add(this.flash);
  }

  /**
   * Places the scanned bolt-action rifle in viewmodel space. The source model points
   * its muzzle along +X with the trigger near x = -0.29; it is turned to face -Z and
   * shifted so the trigger sits where the procedural guns keep their grip.
   */
  private buildScannedRifle(): void {
    const rifle = this.models!.instantiate(SCANNED_RIFLE)!;
    rifle.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = false;
    });
    rifle.rotation.y = Math.PI / 2;
    rifle.position.set(0.007, -0.06, -0.29);
    this.gun.add(rifle);
    // Scope axis is at model y ~0.071 -> 0.011 after the offset above.
    this.sightHeight = 0.011;
    this.adsZ = -ADS_EYE.scanned;
    this.buildArms(false, [0.4, -0.07]);
    this.placeMuzzle(new THREE.Vector3(0, -0.025, -0.9));
  }

  /**
   * Scanned pistol: muzzle along +X in the source. Placed from its own bounds so the
   * top of the slide (sights) sits at the same height as the procedural pistol and
   * the magazine (grip) under the trigger hand.
   */
  private buildScannedPistol(): void {
    const src = this.models!.instantiate(SCANNED_PISTOL)!;
    const keep = new Set(PISTOL_PARTS.keep);
    const pistol = new THREE.Group();
    for (const child of [...src.children]) if (keep.has(child.name)) pistol.add(child);
    pistol.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = false;
    });
    pistol.rotation.y = Math.PI / 2;
    pistol.updateMatrixWorld(true);
    const slide = pistol.getObjectByName(PISTOL_PARTS.slide) ?? null;
    const mag = pistol.getObjectByName(PISTOL_PARTS.mag) ?? null;
    // The source file lays the loaded magazine out behind the pistol; seat it in the grip.
    if (mag) {
      mag.position.x += PISTOL_PARTS.magIntoGrip;
      pistol.updateMatrixWorld(true);
    }
    const slideBox = slide ? new THREE.Box3().setFromObject(slide) : new THREE.Box3().setFromObject(pistol);
    const gripZ = mag ? new THREE.Box3().setFromObject(mag).getCenter(new THREE.Vector3()).z : slideBox.max.z;
    // Grip center 3 cm behind the trigger origin, slide top at 3 cm.
    pistol.position.set(0, 0.03 - slideBox.max.y, 0.035 - gripZ);
    this.gun.add(pistol);
    this.sightHeight = 0.03;
    this.adsZ = -ADS_EYE.pistol;
    this.setParts(mag, null, slide);
    // Slide moves toward the shooter: +Z in gun space is -X in the source model.
    this.slideDir.set(-1, 0, 0);
    this.buildArms(true, [0, -0.1]);
    const muzzleY = 0.03 - (slideBox.max.y - slideBox.min.y) * 0.45;
    this.placeMuzzle(new THREE.Vector3(0, muzzleY, pistol.position.z + slideBox.min.z - 0.01));
  }

  /**
   * Gloved hands with jointed fingers: the trigger hand wraps the grip with the
   * index finger on the trigger, the support hand cups the handguard (or the
   * trigger hand, on pistols); sleeves run off-screen.
   */
  private buildArms(pistol: boolean, support: P): void {
    const m = gunMaterials();
    // The trigger hand is fixed to the gun; the support hand's parts go into its own group.
    let into: THREE.Object3D = this.gun;
    const own = (mesh: THREE.Mesh) => {
      mesh.userData.owned = true;
      into.add(mesh);
    };
    /** A rounded segment (finger bone) between two points. */
    const bone = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const dir = b.clone().sub(a);
      const len = dir.length();
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, 8), m.glove);
      mesh.position.copy(a).addScaledVector(dir, 0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      own(mesh);
    };
    /** A finger through the given joints (knuckle first). */
    const finger = (pts: THREE.Vector3[], r: number) => {
      for (let i = 0; i < pts.length - 1; i++) bone(pts[i]!, pts[i + 1]!, r * (1 - i * 0.08));
    };
    /** Palm / back of the hand: a flattened capsule from wrist to knuckles. */
    const palm = (wrist: THREE.Vector3, knuckles: THREE.Vector3, width: number, thick: number, roll: number) => {
      const dir = knuckles.clone().sub(wrist);
      const len = dir.length();
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(width / 2, Math.max(0.001, len - width), 4, 10), m.glove);
      mesh.scale.set(1, 1, thick / width);
      mesh.position.copy(wrist).addScaledVector(dir, 0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      mesh.rotateY(roll);
      own(mesh);
    };
    const limb = (from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, mat: THREE.Material) => {
      const dir = to.clone().sub(from);
      const len = dir.length();
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 10), mat);
      mesh.position.copy(from).addScaledVector(dir, 0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      own(mesh);
    };
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    // Trigger hand (right) around the pistol grip. The grip rakes back: lower
    // points sit further toward the shooter.
    const top = -0.07;
    const rake = (y: number) => (top - y) * 0.35;
    /** Point on a ring of radius r around the grip at height y; a = 0 on the right, pi/2 in front, pi on the left. */
    const around = (y: number, a: number, r: number) => V(Math.cos(a) * r, y, 0.045 + rake(y) - Math.sin(a) * r);
    palm(V(0.03, -0.12, 0.085), V(0.03, -0.085, 0.05), 0.05, 0.024, 0.35);
    // Middle, ring and little fingers curl round the front of the grip.
    [-0.085, -0.105, -0.124].forEach((y, i) => {
      const r = 0.027 - i * 0.001;
      finger([around(y, 0.25, r), around(y, 1.05, r), around(y, 1.9, r), around(y, 2.55, r - 0.004)], 0.0085 - i * 0.0006);
    });
    // Index finger along the frame and into the trigger guard.
    finger([V(0.024, -0.068, 0.04), V(0.018, -0.064, 0.012), V(0.008, -0.07, -0.006), V(0.001, -0.08, -0.012)], 0.0082);
    // Thumb over the top of the grip on the far side.
    finger([V(0.018, -0.07, 0.07), V(-0.006, -0.062, 0.058), V(-0.024, -0.066, 0.036), V(-0.028, -0.072, 0.018)], 0.0095);
    // Wrist cuff and sleeve.
    limb(V(0.03, -0.125, 0.09), V(0.035, -0.145, 0.125), 0.031, 0.034, m.glove);
    limb(V(0.035, -0.145, 0.125), V(0.13, -0.33, 0.42), 0.042, 0.05, m.sleeve);

    // Support hand pivot (palm center); its parts are built in gun space and offset back.
    const rest = pistol ? V(-0.04, -0.108, 0.065) : V(-0.035, support[1] + 0.01, -support[0] + 0.02);
    this.support.position.copy(rest);
    this.supportInner.position.copy(rest).negate();
    into = this.supportInner;
    if (pistol) {
      // Support hand cups the trigger hand from the left, fingers over its fingers.
      palm(V(-0.04, -0.125, 0.08), V(-0.038, -0.09, 0.05), 0.05, 0.024, -0.35);
      [-0.088, -0.107, -0.126, -0.143].forEach((y, i) => {
        const r = 0.043;
        finger([around(y, Math.PI - 0.25, r), around(y, Math.PI - 0.95, r), around(y, 1.5, r - 0.002), around(y, 1.0, r - 0.006)], 0.0088 - i * 0.0005);
      });
      // Thumb forward along the left side of the frame.
      finger([V(-0.03, -0.075, 0.06), V(-0.03, -0.062, 0.03), V(-0.026, -0.058, 0.004)], 0.0095);
      limb(V(-0.042, -0.13, 0.09), V(-0.18, -0.32, 0.4), 0.034, 0.05, m.sleeve);
    } else {
      // Support hand (left) under the handguard: palm on the lower left, fingers
      // wrapping underneath and up the right side, thumb along the left.
      const hz = -support[0];
      const cy = support[1] + 0.04;
      const r = 0.032;
      /** Ring around the handguard axis at depth z; a = 0 on the left, pi/2 below, pi on the right. */
      const ring = (z: number, a: number, rr: number) => V(-Math.cos(a) * rr, cy - Math.sin(a) * rr, z);
      palm(V(-0.03, cy - 0.05, hz + 0.045), ring(hz, 0.75, r + 0.012), 0.052, 0.024, 0.9);
      [-0.028, -0.009, 0.01, 0.028].forEach((dz, i) => {
        const z = hz + dz;
        finger([ring(z, 0.95, r), ring(z, 1.6, r), ring(z, 2.25, r - 0.001), ring(z, 2.75, r - 0.005)], 0.0088 - i * 0.0005);
      });
      finger([V(-0.036, cy - 0.022, hz + 0.03), V(-0.034, cy - 0.006, hz), V(-0.03, cy + 0.004, hz - 0.028)], 0.0095);
      limb(V(-0.03, cy - 0.06, hz + 0.05), V(-0.04, cy - 0.075, hz + 0.09), 0.029, 0.031, m.glove);
      limb(V(-0.04, cy - 0.075, hz + 0.09), V(-0.2, -0.3, hz + 0.42), 0.04, 0.05, m.sleeve);
    }
  }

  /** Bolt or pump worked after a shot. */
  onCycle(): void {
    this.cycleT = 0;
  }

  /** Weapon dips out of the way while the off hand throws. */
  onThrow(): void {
    this.throwT = 0;
  }

  /** The melee swing connected with something (the view jolts). */
  onMeleeHit(): void {
    this.meleeJolt = 1;
  }

  onLand(impactSpeed: number): void {
    this.landDip = Math.min(0.06, impactSpeed * 0.006);
  }

  onFire(ads: boolean): void {
    this.kick = Math.min(this.kick + (ads ? 0.025 : 0.04), 0.08);
    this.kickRot = Math.min(this.kickRot + (ads ? 0.03 : 0.07), 0.2);
    this.flashTimer = 0.04;
    this.slideT = 0;
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
    this.sway.x += (THREE.MathUtils.clamp(f.lookDYaw * 0.35, -0.03, 0.03) - this.sway.x) * ease(22);
    this.sway.y += (THREE.MathUtils.clamp(f.lookDPitch * 0.35, -0.03, 0.03) - this.sway.y) * ease(22);

    this.kick *= Math.exp(-18 * dt);
    this.kickRot *= Math.exp(-14 * dt);
    this.landDip *= Math.exp(-8 * dt);

    // Support hand: works the magazine / handle, loads shells, checks the mag on inspect.
    const hand = this.tv.set(0, 0, 0);
    const handRot = this.tr.set(0, 0, 0);
    const anchor = (a: HandAnchor) => this.anchors[a];
    let magHeld = false;
    if (f.reloading && f.magReload) {
      const p = f.reloadProgress;
      sampleTrack(RELOAD_HAND, p, hand, anchor);
      sampleTrack(RELOAD_HAND_ROT, p, handRot);
      magHeld = p >= RELOAD_MAG_HELD[0] && p < RELOAD_MAG_HELD[1];
    } else if (f.inspectT >= 0 && this.mag) {
      sampleTrack(INSPECT_HAND, f.inspectT, hand, anchor);
      magHeld = f.inspectT >= INSPECT_MAG_HELD[0] && f.inspectT < INSPECT_MAG_HELD[1];
    } else if (this.reloadBlend > 0.01 && !f.magReload) {
      // Shell by shell: fetch, push in; blends in and out with the reload pose.
      sampleTrack(SHELL_HAND, f.reloading ? f.reloadProgress : 1, hand, anchor).multiplyScalar(this.reloadBlend);
      handRot.set(0.3 * this.reloadBlend, 0, 0.6 * this.reloadBlend);
    }
    if (this.shell) this.shell.visible = f.reloading && !f.magReload && f.reloadProgress < SHELL_IN_HAND_UNTIL;
    this.support.position.copy(this.supportInner.position).negate().add(hand);
    this.support.rotation.set(handRot.x, handRot.y, handRot.z);
    if (this.mag) {
      // A held magazine moves with the hand (offset from where the hand grips it).
      const at = this.tq.copy(this.magRestGun);
      if (magHeld) at.add(hand).sub(this.anchors.mag);
      this.mag.position.copy(at.applyMatrix4(this.magToParent));
    }
    // Pump/bolt stroke: back then forward over ~0.35 s.
    this.cycleT = Math.min(1, this.cycleT + dt / 0.35);
    const stroke = Math.sin(this.cycleT * Math.PI);
    if (this.pump) this.pump.position.set(this.pumpBase.x, this.pumpBase.y, this.pumpBase.z + stroke * 0.08);
    // Slide / bolt snaps back and returns within ~70 ms of each shot.
    this.slideT = Math.min(1, this.slideT + dt / 0.07);
    if (this.slide) {
      const back = Math.sin(this.slideT * Math.PI) * (this.slideT < 1 ? 0.022 : 0);
      this.slide.position.copy(this.slideBase).addScaledVector(this.slideDir, back);
    }
    this.throwT = Math.min(1, this.throwT + dt / 0.65);
    const throwDip = Math.sin(this.throwT * Math.PI);
    this.toolBlend += ((f.tool !== undefined && f.tool >= 0 ? 1 : 0) - this.toolBlend) * ease(9);
    this.updateHammer(f.tool ?? -1, bobX, bobY);

    // Whole-gun motions: seating jolts, inspection, melee.
    const extraPos = this.extraPos.set(0, 0, 0);
    const extraRot = this.extraRot.set(0, 0, 0);
    if (f.reloading && f.magReload) sampleTrack(RELOAD_GUN_ROT, f.reloadProgress, extraRot);
    if (f.inspectT >= 0) {
      sampleTrack(INSPECT_POS, f.inspectT, extraPos);
      extraRot.add(sampleTrack(INSPECT_ROT, f.inspectT, this.tq));
    }
    if (f.meleeT >= 0) {
      // A new swing picks a different motion from the last one.
      const set = this.pistol ? MELEE_PISTOL : MELEE_LONG;
      if (!this.meleeActive) this.meleeMove = pickMelee(set, this.meleeMove);
      const mv = set[this.meleeMove % set.length]!;
      extraPos.add(sampleTrack(mv.pos, f.meleeT, this.tq));
      extraRot.add(sampleTrack(mv.rot, f.meleeT, this.tq));
    }
    this.meleeActive = f.meleeT >= 0;
    this.meleeJolt *= Math.exp(-14 * dt);
    extraPos.z += this.meleeJolt * 0.04;
    extraRot.x += this.meleeJolt * 0.08;

    const ads = new THREE.Vector3(0, -this.sightHeight, this.adsZ);
    const pos = HIP.clone().lerp(ads, f.adsBlend);
    pos.addScaledVector(SPRINT_OFFSET, this.sprintBlend);
    pos.x += bobX + this.sway.x * swayScale * 0.4;
    pos.y += bobY + this.sway.y * swayScale * 0.4;
    // Reload pose: the gun comes in toward the middle and turns its left side
    // (magazine well / loading port) to the working hand.
    const rp = f.magReload ? RELOAD_POSE.mag : RELOAD_POSE.shell;
    pos.x += rp.pos[0] * this.reloadBlend;
    pos.y += rp.pos[1] * this.reloadBlend;
    pos.z += rp.pos[2] * this.reloadBlend;
    pos.y -= (1 - f.drawProgress) * 0.25 + throwDip * 0.28 + this.landDip + this.toolBlend * 0.5;
    pos.z += stroke * (this.pump ? 0.01 : 0.025);
    pos.z += this.kick;
    pos.add(extraPos);
    this.root.position.copy(pos);
    this.root.rotation.set(
      this.kickRot + this.sway.y * swayScale + rp.rot[0] * this.reloadBlend - this.sprintBlend * 0.2 - throwDip * 0.5 - this.toolBlend * 0.9 + extraRot.x,
      this.sway.x * swayScale + rp.rot[1] * this.reloadBlend + this.sprintBlend * 0.6 - throwDip * 0.3 + extraRot.y,
      rp.rot[2] * this.reloadBlend + this.sprintBlend * 0.25 + stroke * (this.pump ? 0.05 : 0.22) + extraRot.z,
    );

    this.flashTimer -= dt;
    this.flash.visible = this.flashTimer > 0;
    this.root.visible = !f.hideForScope && this.toolBlend < 0.97;
  }

  /**
   * Hammering: raise, strike, a short rest; about two blows a second. Rises
   * into view from below as the gun goes down.
   */
  private updateHammer(t: number, bobX: number, bobY: number): void {
    if (this.toolBlend < 0.02) {
      if (this.hammer) this.hammer.visible = false;
      return;
    }
    const h = (this.hammer ??= this.buildHammer());
    h.visible = true;
    const u = t >= 0 ? (t * 2.1) % 1 : 0.8;
    // Head angle about x: raised back at 0.55, struck forward by 0.68.
    let a: number;
    if (u < 0.55) a = -1.05 + 1.65 * Math.sin(((u / 0.55) * Math.PI) / 2);
    else if (u < 0.68) a = 0.6 - 1.75 * ((u - 0.55) / 0.13) ** 2;
    else a = -1.15 + 0.1 * Math.sin(((u - 0.68) / 0.32) * Math.PI);
    const lift = (1 - this.toolBlend) * 0.45;
    h.position.set(0.17 + bobX, -0.2 - lift + bobY, -0.44);
    h.rotation.set(a, -0.25, -0.2);
  }

  /** A claw hammer in a gloved fist, with the sleeve running off screen. */
  private buildHammer(): THREE.Group {
    const m = gunMaterials();
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x8b6a45, roughness: 0.7 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x5c6066, roughness: 0.35, metalness: 0.85 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      g.add(mesh);
    };
    // Handle up from the fist, head across the top (face forward, claw back).
    add(new THREE.CylinderGeometry(0.013, 0.016, 0.34, 10), wood, 0, 0.1, 0);
    add(new THREE.BoxGeometry(0.034, 0.034, 0.075), steel, 0, 0.265, -0.03);
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 12), steel, 0, 0.265, -0.075, Math.PI / 2);
    add(new THREE.BoxGeometry(0.026, 0.02, 0.08), steel, 0, 0.275, 0.04, -0.35);
    // Fist round the handle.
    add(new THREE.CapsuleGeometry(0.03, 0.035, 4, 10), m.glove, 0.012, 0.0, 0.012);
    for (let i = 0; i < 4; i++) add(new THREE.CapsuleGeometry(0.0095, 0.03, 3, 8), m.glove, -0.004, 0.028 - i * 0.019, -0.022, 0, 0, Math.PI / 2);
    add(new THREE.CapsuleGeometry(0.01, 0.03, 3, 8), m.glove, -0.02, 0.035, 0.01, 0.4, 0, 0.3);
    add(new THREE.CylinderGeometry(0.036, 0.034, 0.07, 10), m.glove, 0.03, -0.05, 0.04, 0.9, 0, -0.3);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.45, 10), m.sleeve);
    sleeve.position.set(0.08, -0.18, 0.2);
    sleeve.rotation.set(1.0, 0, -0.35);
    g.add(sleeve);
    g.visible = false;
    this.fpScene.add(g);
    return g;
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
