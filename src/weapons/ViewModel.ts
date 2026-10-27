import * as THREE from 'three';
import { HandKit, gloveGeometry, handMaterials } from './fpHands';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ModelLibrary } from '@/render/models';
import type { ShotKick, WeaponDef } from './weaponData';
import { Spring } from './spring';
import { gunMaterials, type P } from './gunKit';
import { buildGun, buildOptic, fittedExtras } from './gunModels';
import { gunKey } from './attachments';
import { camoMaterial } from './camoMaterial';
import { scannedSkin } from './gunSkins';
import { item } from '@/progression/catalog';
import { camoLookOf } from '@/progression/camo';
import type { GadgetId } from '@/data/gadgets';
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
const SCANNED_SCOPE = 'bolt_action_rifle_7_62_scope';
const SCANNED_PISTOL = 'service_pistol';
/** Parts of the scanned pistol file (it also holds a second, disassembled copy). */
const PISTOL_PARTS = {
  keep: ['service_pistol_pistol_a', 'service_pistol_slide_a', 'service_pistol_magazine_loaded', 'service_pistol_hammer_a', 'service_pistol_trigger_a'],
  slide: 'service_pistol_slide_a',
  mag: 'service_pistol_magazine_loaded',
  /** Shift along the source X axis that puts the magazine inside the grip (measured from the mesh). */
  magIntoGrip: 0.094,
};

/** The scanned model a weapon's first-person body comes from (null: a procedural gun). */
export function scannedModelFor(def: WeaponDef): string | null {
  return def.class === 'sr' ? SCANNED_RIFLE : def.class === 'pistol' ? SCANNED_PISTOL : null;
}

/**
 * The scanned body as the player sees it (no arms, no attachments), wearing
 * `def`'s skin or camo, muzzle toward -Z: the shop's 3D view shows the gun
 * the game shows (ui/ItemViewer). Null without the model.
 */
export function scannedBody(def: WeaponDef, models: ModelLibrary): THREE.Object3D | null {
  const id = scannedModelFor(def);
  const src = id ? models.instantiate(id) : null;
  if (!src) return null;
  const body = new THREE.Group();
  if (id === SCANNED_RIFLE) {
    src.rotation.y = Math.PI / 2;
    body.add(src);
    const own = src.getObjectByName(SCANNED_SCOPE);
    if (own) own.visible = false;
    const optic = buildOptic(def, 0.008 + 0.06, 0.085 - 0.29);
    body.add(optic.group);
  } else {
    const keep = new Set(PISTOL_PARTS.keep);
    for (const child of [...src.children]) if (keep.has(child.name)) body.add(child);
    const mag = body.getObjectByName(PISTOL_PARTS.mag);
    if (mag) mag.position.x += PISTOL_PARTS.magIntoGrip;
    body.rotation.y = Math.PI / 2;
  }
  const skin = def.skin ? item(def.skin) : undefined;
  const look = skin?.skin && skin.weapon === def.id ? skin.skin : undefined;
  const camo = !look && def.camo ? camoLookOf(def.camo) : undefined;
  if (look || camo)
    src.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mesh.isMesh || !(mat instanceof THREE.MeshStandardMaterial) || mat.transparent) return;
      mesh.material = look ? scannedSkin(mat, look, skin!.id) : camoMaterial(camo!, mat);
    });
  // The pistol's parts were taken out of `src`: skin them where they are now.
  if (id === SCANNED_PISTOL && (look || camo))
    body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mesh.isMesh || !(mat instanceof THREE.MeshStandardMaterial) || mat.transparent || mat.userData.skin || mat.userData.camo) return;
      mesh.material = look ? scannedSkin(mat, look, skin!.id) : camoMaterial(camo!, mat);
    });
  return body;
}

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
  /** 0..1 of the sprint-out still to go (`WeaponController.sprintOutLeft`). */
  sprintOut?: number;
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
  /** Build mode: the hammer stays in hand between blows. */
  toolIdle?: boolean;
  /** Class gadget in hand (key 4), and seconds since it was last used. */
  gadget?: GadgetId | null;
  gadgetUsed?: number;
  /** Gadget uses left (the panzerfaust brings up no new tube after the last). */
  gadgetLeft?: number;
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
  /** The gun shoved back by the last shots (m), and how fast it comes forward again. */
  private kick = 0;
  private kickSettle = 16;
  /** Muzzle rise, twist and sideways jump of each shot (`WeaponDef.kick`). */
  private readonly rise = new Spring();
  private readonly roll = new Spring();
  private readonly turn = new Spring();
  private readonly adsSettle = new Spring(11);
  private lastAds = 0;
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

  /** Drawn this frame (not behind a scope, not swapped for a tool). */
  get visible(): boolean {
    return this.root.visible;
  }

  setWeapon(def: WeaponDef): void {
    // The same gun with other attachments is another model.
    const key = gunKey(def);
    if (key === this.currentId) return;
    this.currentId = key;
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
      this.buildScannedRifle(def);
    } else if (def.class === 'pistol' && this.models?.has(SCANNED_PISTOL)) {
      this.buildScannedPistol(def);
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
    // The scanned bodies wear the skin, else the camo, over their own textures (the procedural guns got it in `buildGun`).
    const scanned = (def.class === 'sr' && this.models?.has(SCANNED_RIFLE)) || (def.class === 'pistol' && this.models?.has(SCANNED_PISTOL));
    const skin = def.skin ? item(def.skin) : undefined;
    const skinLook = skin?.skin && skin.weapon === def.id ? skin.skin : undefined;
    const camo = !skinLook && def.camo ? camoLookOf(def.camo) : undefined;
    if (scanned && (skinLook || camo)) {
      this.gun.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (!mesh.isMesh || mesh.userData.owned || mesh === this.flash || !(mat instanceof THREE.MeshStandardMaterial) || mat.transparent) return;
        mesh.material = skinLook ? scannedSkin(mat, skinLook, skin!.id) : camoMaterial(camo!, mat);
      });
    }
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
  private buildScannedRifle(def: WeaponDef): void {
    const rifle = this.models!.instantiate(SCANNED_RIFLE)!;
    rifle.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = false;
    });
    rifle.rotation.y = Math.PI / 2;
    rifle.position.set(0.007, -0.06, -0.29);
    this.gun.add(rifle);
    // Each rifle carries its own scope: the file's scope comes off and a
    // procedural one goes on a rail over the receiver (top at y ~0.008 here).
    const own = rifle.getObjectByName(SCANNED_SCOPE);
    if (own) own.visible = false;
    const optic = buildOptic(def, 0.008, 0.085);
    optic.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.userData.owned = true;
    });
    this.gun.add(optic.group);
    this.sightHeight = optic.sightHeight;
    this.adsZ = -ADS_EYE.scanned;
    this.buildArms(false, [0.4, -0.07]);
    // Fitted attachments (muzzle device, bipod, shell holder) on the scanned body.
    const extras = fittedExtras(def, { muzzleU: 0.912, muzzleV: -0.009, underU: 0.62, underV: -0.044, gripBottom: 0, frameBottom: 0 });
    this.own(extras.group);
    this.placeMuzzle(new THREE.Vector3(0, -0.025, def.attach?.muzzle ? -extras.muzzleU - 0.01 : -0.9));
  }

  /** Geometry built for this gun only (disposed when the gun changes). */
  private own(group: THREE.Object3D, into: THREE.Object3D = this.gun): void {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.userData.owned = true;
    });
    // Built in gun space: into the gun first, then (keeping where it is) onto the moving part.
    this.gun.add(group);
    if (into !== this.gun) {
      this.gun.updateMatrixWorld(true);
      into.attach(group);
    }
  }

  /**
   * Scanned pistol: muzzle along +X in the source. Placed from its own bounds so the
   * top of the slide (sights) sits at the same height as the procedural pistol and
   * the magazine (grip) under the trigger hand.
   */
  private buildScannedPistol(def: WeaponDef): void {
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
    const magBox = mag ? new THREE.Box3().setFromObject(mag) : null;
    const gripZ = magBox ? magBox.getCenter(new THREE.Vector3()).z : slideBox.max.z;
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
    // Fitted attachments: muzzle device, laser, longer magazine; a red dot rides on the slide.
    const frontU = -(pistol.position.z + slideBox.min.z);
    const gripBottom = magBox ? magBox.min.y + pistol.position.y : -0.12;
    const extras = fittedExtras(def, { muzzleU: frontU - 0.004, muzzleV: muzzleY, underU: frontU, underV: muzzleY, gripBottom, frameBottom: muzzleY - 0.012 });
    this.own(extras.group);
    if (def.attach?.optic) {
      const dot = buildOptic(def, 0.03, 0.06, false);
      this.own(dot.group, slide ?? this.gun);
      this.sightHeight = dot.sightHeight;
    }
    this.placeMuzzle(new THREE.Vector3(0, muzzleY, -extras.muzzleU - 0.01));
  }

  /**
   * Gloved hands (remade 2026-10-25, `fpHands.ts`): the trigger hand wraps the
   * grip with the index finger on the trigger, the support hand cups the
   * handguard (or the trigger hand, on pistols); sleeves run off-screen. The
   * joint points below place each finger; the kit shapes smooth fingers, palms,
   * leather pads, cuffs and folded sleeves through them.
   */
  private buildArms(pistol: boolean, support: P): void {
    const m = handMaterials();
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    let kit = new HandKit();
    /** Puts the kit's shapes into `parent`, one mesh per material. */
    const flush = (parent: THREE.Object3D) => {
      const glove = gloveGeometry(kit.out.glove, kit.out.leather);
      const sleeve = kit.out.sleeve.length ? mergeGeometries(kit.out.sleeve) : null;
      for (const g of [...kit.out.glove, ...kit.out.leather, ...kit.out.sleeve]) g.dispose();
      for (const [merged, mat] of [
        [glove, m.glove],
        [sleeve, m.sleeve],
      ] as const) {
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, mat);
        mesh.userData.owned = true;
        mesh.castShadow = mesh.receiveShadow = false;
        parent.add(mesh);
      }
      kit = new HandKit();
    };
    /** A finger round an axis: its back faces away from `axis` at the knuckle. */
    const curled = (pts: THREE.Vector3[], r: number, axis: THREE.Vector3) => kit.finger(pts, r, pts[0]!.clone().sub(axis).normalize());

    // Trigger hand (right) around the pistol grip. The grip rakes back: lower
    // points sit further toward the shooter.
    const top = -0.07;
    const rake = (y: number) => (top - y) * 0.35;
    const gripAxis = (y: number) => V(0, y, 0.045 + rake(y));
    /** Point on a ring of radius r around the grip at height y; a = 0 on the right, pi/2 in front, pi on the left. */
    const around = (y: number, a: number, r: number) => V(Math.cos(a) * r, y, 0.045 + rake(y) - Math.sin(a) * r);
    kit.palm(V(0.03, -0.12, 0.085), V(0.03, -0.085, 0.05), 0.05, 0.024, 0.35);
    // Middle, ring and little fingers curl round the front of the grip.
    [-0.085, -0.105, -0.124].forEach((y, i) => {
      const r = 0.027 - i * 0.001;
      curled([around(y, 0.25, r), around(y, 1.05, r), around(y, 1.9, r), around(y, 2.55, r - 0.004)], 0.0088 - i * 0.0006, gripAxis(y));
    });
    // Index finger along the frame and into the trigger guard (its back to the right).
    kit.finger([V(0.024, -0.068, 0.04), V(0.018, -0.064, 0.012), V(0.008, -0.07, -0.006), V(0.001, -0.08, -0.012)], 0.0085, V(1, 0.5, 0).normalize());
    // Thumb over the top of the grip on the far side (its nail up).
    kit.finger([V(0.024, -0.082, 0.076), V(0.016, -0.072, 0.068), V(-0.006, -0.064, 0.058), V(-0.024, -0.067, 0.036), V(-0.028, -0.072, 0.018)], 0.0102, V(0, 1, 0), true);
    // Cuff and sleeve.
    kit.cuff(V(0.03, -0.125, 0.09), V(0.035, -0.148, 0.13), 0.03, 0.034);
    kit.sleeve(V(0.035, -0.146, 0.128), V(0.13, -0.33, 0.42), 0.04, 0.05);
    flush(this.gun);

    // Support hand pivot (palm center); its parts are built in gun space and offset back.
    const rest = pistol ? V(-0.04, -0.108, 0.065) : V(-0.035, support[1] + 0.01, -support[0] + 0.02);
    this.support.position.copy(rest);
    this.supportInner.position.copy(rest).negate();
    if (pistol) {
      // Support hand cups the trigger hand from the left, fingers over its fingers.
      kit.palm(V(-0.04, -0.125, 0.08), V(-0.038, -0.09, 0.05), 0.05, 0.024, -0.35);
      [-0.088, -0.107, -0.126, -0.143].forEach((y, i) => {
        const r = 0.043;
        curled([around(y, Math.PI - 0.25, r), around(y, Math.PI - 0.95, r), around(y, 1.5, r - 0.002), around(y, 1.0, r - 0.006)], 0.009 - i * 0.0005, gripAxis(y));
      });
      // Thumb forward along the left side of the frame.
      kit.finger([V(-0.036, -0.088, 0.075), V(-0.03, -0.075, 0.06), V(-0.03, -0.062, 0.03), V(-0.026, -0.058, 0.004)], 0.0102, V(-1, 0.4, 0).normalize(), true);
      kit.cuff(V(-0.042, -0.13, 0.09), V(-0.06, -0.155, 0.125), 0.029, 0.033);
      kit.sleeve(V(-0.058, -0.152, 0.122), V(-0.18, -0.32, 0.4), 0.036, 0.05);
    } else {
      // Support hand (left) under the handguard: palm on the lower left, fingers
      // wrapping underneath and up the right side, thumb along the left.
      const hz = -support[0];
      const cy = support[1] + 0.04;
      const r = 0.032;
      /** Ring around the handguard axis at depth z; a = 0 on the left, pi/2 below, pi on the right. */
      const ring = (z: number, a: number, rr: number) => V(-Math.cos(a) * rr, cy - Math.sin(a) * rr, z);
      kit.palm(V(-0.03, cy - 0.05, hz + 0.045), ring(hz, 0.75, r + 0.012), 0.052, 0.024, 0.9);
      [-0.028, -0.009, 0.01, 0.028].forEach((dz, i) => {
        const z = hz + dz;
        curled([ring(z, 0.95, r), ring(z, 1.6, r), ring(z, 2.25, r - 0.001), ring(z, 2.75, r - 0.005)], 0.0091 - i * 0.0005, V(0, cy, z));
      });
      kit.finger([V(-0.04, cy - 0.04, hz + 0.045), V(-0.036, cy - 0.022, hz + 0.03), V(-0.034, cy - 0.006, hz), V(-0.03, cy + 0.004, hz - 0.028)], 0.0102, V(-1, 0.3, 0).normalize(), true);
      kit.cuff(V(-0.03, cy - 0.06, hz + 0.05), V(-0.042, cy - 0.078, hz + 0.095), 0.028, 0.032);
      kit.sleeve(V(-0.041, cy - 0.076, hz + 0.092), V(-0.2, -0.3, hz + 0.42), 0.037, 0.05);
    }
    flush(this.supportInner);
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

  /**
   * A shot: each gun kicks its own way (gunplay audit, 2026-10-18). Down the
   * sights the gun stays nearer the eye, so less of it shows.
   */
  onFire(ads: boolean, k: ShotKick, flash?: 'none' | 'small'): void {
    const back = k.back * (ads ? 0.6 : 1);
    this.kick = Math.min(this.kick + back, back * 2.4);
    this.kickSettle = k.settle * 1.15;
    for (const sp of [this.rise, this.roll, this.turn]) sp.rate = k.settle;
    this.rise.kick(k.rise * (ads ? 0.4 : 1));
    const side = Math.random() < 0.5 ? -1 : 1;
    this.roll.kick(side * k.roll * (0.6 + Math.random() * 0.4) * (ads ? 0.5 : 1));
    this.turn.kick((Math.random() - 0.5) * k.roll * 0.5 * (ads ? 0.4 : 1));
    this.flashTimer = flash === 'none' ? 0 : 0.04;
    this.flash.scale.setScalar(flash === 'small' ? 0.45 : 1);
    this.slideT = 0;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  update(f: ViewModelFrame): void {
    const dt = f.dt;
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);

    this.sprintBlend += ((f.sprinting ? 1 : 0) - this.sprintBlend) * ease(10);
    // Coming out of a sprint the gun is up exactly when it may fire.
    if (f.sprintOut && f.sprintOut > 0) this.sprintBlend = f.sprintOut * f.sprintOut * (3 - 2 * f.sprintOut);
    // Reaching the sights the gun settles with a small dip.
    if (f.adsBlend >= 0.97 && this.lastAds < 0.97) this.adsSettle.kick(1);
    this.lastAds = f.adsBlend;
    this.adsSettle.step(dt);
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

    this.kick *= Math.exp(-this.kickSettle * dt);
    this.rise.step(dt);
    this.roll.step(dt);
    this.turn.step(dt);
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
    // Hammer or a held gadget: the gun goes down (the rifle grenade rides on the gun instead).
    const held = !!f.gadget && f.gadget !== 'riflesmoke';
    this.toolBlend += ((f.toolIdle || (f.tool !== undefined && f.tool >= 0) || held ? 1 : 0) - this.toolBlend) * ease(9);

    this.updateHammer(held ? -2 : (f.tool ?? -1), bobX, bobY);
    this.updateGadget(f.gadget ?? null, f.gadgetUsed ?? 10, f.gadgetLeft ?? 1, bobX, bobY);

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
    // Rifle smoke loaded: the muzzle comes up for the lob, so the grenade on it shows.
    this.lobBlend += ((f.gadget === 'riflesmoke' ? 1 : 0) - this.lobBlend) * ease(8);
    extraRot.x += this.lobBlend * 0.32;
    extraPos.y += this.lobBlend * 0.035;
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
    pos.y -= this.adsSettle.x * 0.004;
    pos.add(extraPos);
    this.root.position.copy(pos);
    this.root.rotation.set(
      this.rise.x - this.adsSettle.x * 0.01 + this.sway.y * swayScale + rp.rot[0] * this.reloadBlend - this.sprintBlend * 0.2 - throwDip * 0.5 - this.toolBlend * 0.9 + extraRot.x,
      this.turn.x + this.sway.x * swayScale + rp.rot[1] * this.reloadBlend + this.sprintBlend * 0.6 - throwDip * 0.3 + extraRot.y,
      this.roll.x + rp.rot[2] * this.reloadBlend + this.sprintBlend * 0.25 + stroke * (this.pump ? 0.05 : 0.22) + extraRot.z,
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
    // -2: a gadget is in hand instead.
    if (this.toolBlend < 0.02 || t === -2) {
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

  /** Held gadget models (built on first use) and the rifle grenade that sits on the muzzle. */
  private readonly gadgetModels = new Map<GadgetId, THREE.Group>();
  private rifleNade: THREE.Group | null = null;
  private lobBlend = 0;

  /**
   * Gadget in hand. Panzerfaust: on the shoulder; firing kicks it back, then
   * the reload (see `posePanzerfaust`). Beacon / mine: held low, set
   * down forward on use. Rifle smoke: a grenade on the gun's muzzle until fired.
   */
  private updateGadget(id: GadgetId | null, used: number, left: number, bobX: number, bobY: number): void {
    for (const [gid, g] of this.gadgetModels) if (gid !== id || this.toolBlend < 0.02) g.visible = false;
    // Rifle grenade on the muzzle (re-attached when the gun model is rebuilt).
    if (id === 'riflesmoke') {
      const nade = (this.rifleNade ??= this.buildRifleNade());
      if (nade.parent !== this.gun) this.gun.add(nade);
      nade.position.copy(this.muzzle.position).add(new THREE.Vector3(0, 0, -0.05));
      nade.visible = used > 0.7;
    } else if (this.rifleNade) this.rifleNade.visible = false;
    if (!id || id === 'riflesmoke' || this.toolBlend < 0.02) return;
    let g = this.gadgetModels.get(id);
    if (!g) {
      g = this.buildGadget(id);
      this.gadgetModels.set(id, g);
    }
    g.visible = true;
    const lift = (1 - this.toolBlend) * 0.45;
    if (id === 'panzerfaust') {
      this.posePanzerfaust(g, used, left, lift, bobX, bobY);
    } else {
      const down = used < 0.7 ? Math.sin((used / 0.7) * Math.PI) : 0;
      g.position.set(0.2 + bobX, -0.22 - lift - down * 0.12 + bobY, -0.42 - down * 0.15);
      g.rotation.set(-0.3 - down * 0.6, -0.4, 0);
      const item = g.getObjectByName('item');
      if (item) item.visible = used > 0.5;
    }
  }

  /**
   * Panzerfaust firing and reloading (`used` = seconds since the shot, 3 s in
   * all, see `PANZERFAUST_TOSS`): kick, the spent tube lowered and tossed down
   * to the left, the next one pulled up from the lower right onto the right
   * shoulder (the warhead right of the aim point; the sight is the aim), the
   * leaf sight flipped up and the lever cocked. With none left, only the toss.
   */
  private posePanzerfaust(g: THREE.Group, used: number, left: number, lift: number, bobX: number, bobY: number): void {
    const warhead = g.getObjectByName('warhead');
    const sight = g.getObjectByName('sight');
    const lever = g.getObjectByName('lever');
    const seg = (a: number, b: number): number => THREE.MathUtils.smoothstep(used, a, b);
    const kick = used < 0.15 ? Math.sin((used / 0.15) * Math.PI) : 0;
    // Spent tube: lowered (0.2..0.55), then thrown down and away (0.55..0.9).
    const lower = seg(0.2, 0.55);
    const toss = seg(0.55, 0.9);
    // Next tube: up from the lower right (0.9..1.6), onto the shoulder (1.5..1.95).
    const off = 1 - seg(0.9, 1.6);
    const unsettled = 1 - seg(1.5, 1.95);
    const spent = used < 0.9;
    const x = 0.2 + bobX;
    const y = -0.17 - lift + bobY;
    const z = -0.16;
    if (spent) {
      // Off the shoulder towards the middle, then flung out to the lower left, rolling.
      g.position.set(x - lower * 0.1 - toss * 0.45, y - lower * 0.02 - toss * toss * 0.4, z + kick * 0.09 - lower * 0.05);
      g.rotation.set(kick * 0.12 + 0.03 - lower * 0.05 - toss * 0.4, -0.05 + lower * 0.35 + toss * 0.4, lower * 0.3 + toss * 1.3);
    } else if (left <= 0) {
      g.visible = false;
    } else {
      g.position.set(x + off * 0.25 - unsettled * 0.03, y - off * 0.5 - unsettled * 0.07, z + unsettled * 0.08);
      g.rotation.set(0.03 - off * 0.9 - unsettled * 0.25, -0.05 - off * 0.4, -off * 0.5 - unsettled * 0.15);
    }
    // The fired tube has no warhead; the new tube's sight lies flat until flipped
    // up (1.8..2.15), its lever comes back and snaps home (2.4..2.7).
    if (warhead) warhead.visible = !spent || used < 0.02;
    if (sight) sight.rotation.x = spent ? 0 : (-Math.PI / 2) * (1 - seg(1.8, 2.15));
    if (lever) lever.position.z = -0.18 + (spent ? 0 : Math.sin(seg(2.4, 2.7) * Math.PI) * 0.035);
  }

  private buildRifleNade(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x8c9186, roughness: 0.6, metalness: 0.2 });
    const tail = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.5, metalness: 0.6 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, z: number): void => {
      const m = new THREE.Mesh(geo.rotateX(Math.PI / 2), mat);
      m.position.z = z;
      g.add(m);
    };
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 14), body, -0.1);
    add(new THREE.SphereGeometry(0.022, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI), body, -0.15);
    add(new THREE.CylinderGeometry(0.0105, 0.0105, 0.1, 10), tail, -0.01);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.026, 0.035), tail);
      fin.position.set(Math.cos((i * Math.PI) / 2) * 0.014, Math.sin((i * Math.PI) / 2) * 0.014, 0.01);
      fin.rotation.z = (i * Math.PI) / 2;
      g.add(fin);
    }
    g.visible = false;
    return g;
  }

  /** Held gadget with the gloved hands holding it. */
  private buildGadget(id: GadgetId): THREE.Group {
    const m = gunMaterials();
    const g = new THREE.Group();
    const olive = new THREE.MeshStandardMaterial({ color: 0x4d5538, roughness: 0.8, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1f2022, roughness: 0.55, metalness: 0.5 });
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      parent.add(mesh);
      return mesh;
    };
    const fist = (x: number, y: number, z: number, rx: number): void => {
      add(g, new THREE.CapsuleGeometry(0.03, 0.035, 4, 10), m.glove, x, y, z, rx);
      const sleeve = add(g, new THREE.CylinderGeometry(0.05, 0.042, 0.45, 10), m.sleeve, x + 0.05, y - 0.16, z + 0.22);
      sleeve.rotation.set(1.0, 0, -0.3);
    };
    if (id === 'panzerfaust') {
      // Launch tube along the view, warhead in front, folding sight and trigger lever on top.
      const tube = new THREE.Group();
      tube.name = 'item';
      add(tube, new THREE.CylinderGeometry(0.024, 0.024, 0.85, 14).rotateX(Math.PI / 2), olive, 0, 0, -0.1);
      // Warhead (gone once fired, so the spent tube is dropped empty).
      const warhead = new THREE.Group();
      warhead.name = 'warhead';
      add(warhead, new THREE.SphereGeometry(0.075, 16, 12).scale(1, 1, 1.9), olive, 0, 0, -0.64);
      add(warhead, new THREE.ConeGeometry(0.03, 0.07, 12).rotateX(-Math.PI / 2), dark, 0, 0, -0.81);
      tube.add(warhead);
      // Folding leaf sight, hinged at its foot (flat while stowed).
      const sight = new THREE.Group();
      sight.name = 'sight';
      sight.position.set(0, 0.022, -0.3);
      add(sight, new THREE.BoxGeometry(0.004, 0.05, 0.03), dark, 0, 0.025, 0);
      tube.add(sight);
      // Firing lever: cocked by pulling it back.
      const lever = add(tube, new THREE.BoxGeometry(0.02, 0.012, 0.09), dark, 0, 0.028, -0.18);
      lever.name = 'lever';
      g.add(tube);
      fist(-0.02, -0.035, -0.42, 0.4);
      fist(0.01, -0.04, 0.05, 0.2);
    } else {
      const item = new THREE.Group();
      item.name = 'item';
      if (id === 'beacon') {
        add(item, new THREE.BoxGeometry(0.11, 0.14, 0.08), olive, 0, 0.05, 0);
        add(item, new THREE.CylinderGeometry(0.003, 0.003, 0.26, 6), dark, 0.03, 0.25, 0);
        add(item, new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0x5aff7a, toneMapped: false }), -0.03, 0.13, 0.041);
      } else {
        add(item, new THREE.CylinderGeometry(0.075, 0.08, 0.045, 18), olive, 0, 0.05, 0);
        add(item, new THREE.CylinderGeometry(0.035, 0.035, 0.015, 12), dark, 0, 0.078, 0);
      }
      g.add(item);
      fist(0, 0, 0.02, 0.9);
    }
    g.visible = false;
    this.fpScene.add(g);
    return g;
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

