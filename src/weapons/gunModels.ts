import * as THREE from 'three';
import type { WeaponDef } from './weaponData';
import { DISCARD, PartBuilder, block, furniture, gunMaterials, lathe, loop, rail, railUnder, roundRect, slab, tube, vcyl, xcyl, type P } from './gunKit';

/** A built first-person gun plus the anchors the view model animates and aims with. */
export interface GunBuild {
  group: THREE.Group;
  /** Height of the sight line above the bore origin (ADS centers it on screen). */
  sightHeight: number;
  muzzle: THREE.Vector3;
  /** Where the support hand holds the gun (u forward, v up). */
  support: P;
  mag: THREE.Object3D | null;
  /** Pump / forend that strokes back when cycled. */
  pump: THREE.Object3D | null;
  /** Slide or bolt that snaps back on every shot. */
  slide: THREE.Object3D | null;
}

type Optic = 'reddot' | 'holo' | 'scope' | 'irons' | 'bead';

/** Per-weapon look: furniture color, optic and accessories. Unlisted ids use their class default. */
interface Look {
  color?: number;
  optic?: Optic;
  grip?: 'vertical' | 'angled';
  /** Weapon light on the right of the handguard. */
  light?: boolean;
  muzzle?: 'flash' | 'brake' | 'suppressor';
  /** Folded bipod under the handguard (precision rifles). */
  bipod?: boolean;
  /** Rifle frame: where the handguard and barrel end (m forward of the receiver). */
  handguard?: number;
  barrel?: number;
  mag?: 'curved' | 'straight';
  /** Build on the rifle frame whatever the class (a magazine-fed LMG). */
  frame?: 'rifle';
}

const LOOKS: Record<string, Look> = {
  ar1: { color: 0x1c1d1f, optic: 'reddot', grip: 'angled', light: true },
  ar2: { color: 0x8a7658, optic: 'holo', grip: 'vertical', muzzle: 'brake', handguard: 0.37, barrel: 0.45 },
  ar3: { color: 0x3f4632, optic: 'reddot', light: true },
  ar4: { color: 0x2b2e33, optic: 'holo', grip: 'angled', handguard: 0.27, barrel: 0.32 },
  smg1: { color: 0x1c1d1f, optic: 'holo', grip: 'vertical' },
  smg2: { color: 0x7d6c52, optic: 'reddot', light: true },
  smg3: { color: 0x2b2e33, optic: 'holo', muzzle: 'suppressor' },
  smg4: { color: 0x3f4632, optic: 'reddot', grip: 'angled' },
  lmg1: { color: 0x4a4f3a },
  lmg2: { color: 0x1c1d1f },
  lmg3: { color: 0x5b5a44, optic: 'holo', frame: 'rifle', handguard: 0.42, barrel: 0.52, mag: 'straight', bipod: true, muzzle: 'brake' },
  sg2: { color: 0x1c1d1f },
  sg3: { color: 0x3f4632 },
  dmr1: { color: 0x8a7658, optic: 'holo', muzzle: 'brake' },
  dmr2: { color: 0x3f4632, muzzle: 'brake', bipod: true },
  dmr3: { color: 0x6b5a40, muzzle: 'flash', handguard: 0.42, barrel: 0.58 },
  sr1: { bipod: true },
  sr2: { muzzle: 'suppressor' },
};

// ---------------------------------------------------------------------------
// Optics. Each adds its parts and returns the sight-line height.

function addOptic(b: PartBuilder, optic: Optic, railTop: number, uc: number): number {
  const m = gunMaterials();
  switch (optic) {
    case 'reddot': {
      // Tube red dot on a riser mount.
      const vc = railTop + 0.03;
      b.add(m.alloy, block(uc - 0.022, uc + 0.022, railTop, railTop + 0.012, 0.022));
      b.add(m.alloy, slab([[uc - 0.012, railTop + 0.01], [uc + 0.012, railTop + 0.01], [uc + 0.008, vc - 0.012], [uc - 0.008, vc - 0.012]], 0.012));
      b.add(m.alloy, lathe([[0.0145, 0], [0.0175, 0.002], [0.0175, 0.06], [0.0145, 0.062]], uc - 0.03, vc, 0, 24));
      b.add(m.darkInner, tube(0.0146, uc - 0.029, uc + 0.031, vc, 0, 24, true));
      // Elevation and windage turrets.
      b.add(m.alloy, new THREE.CylinderGeometry(0.007, 0.007, 0.01, 12).translate(0, vc + 0.021, -uc));
      b.add(m.alloy, new THREE.CylinderGeometry(0.0075, 0.0075, 0.012, 12).rotateZ(Math.PI / 2).translate(0.022, vc, -uc));
      b.add(m.glass, new THREE.CircleGeometry(0.0146, 24).translate(0, vc, -(uc + 0.03)));
      b.add(m.reticle, new THREE.CircleGeometry(0.0009, 10).translate(0, vc, -(uc + 0.0305)));
      return vc;
    }
    case 'holo': {
      // Box-bodied holographic sight: base with battery housing and an open window.
      const vc = railTop + 0.026;
      const u0 = uc - 0.04;
      const u1 = uc + 0.04;
      b.add(m.polymer, block(u0, u1, railTop, railTop + 0.012, 0.03));
      b.add(m.polymer, slab(roundRect(u0 + 0.005, railTop + 0.004, uc - 0.005, railTop + 0.022, 0.004), 0.028));
      const top = vc + 0.018;
      const halfW = 0.016;
      b.add(m.alloy, block(u0 + 0.02, u1, top - 0.003, top, halfW * 2 + 0.006)); // hood
      b.add(m.alloy, block(u0 + 0.02, u1, railTop + 0.012, top, 0.003, halfW + 0.0015));
      b.add(m.alloy, block(u0 + 0.02, u1, railTop + 0.012, top, 0.003, -halfW - 0.0015));
      b.add(m.glass, new THREE.PlaneGeometry(halfW * 2, top - railTop - 0.014).translate(0, (top + railTop + 0.011) / 2, -(u1 - 0.004)));
      const ring = new THREE.RingGeometry(0.0055, 0.0063, 32).translate(0, vc, -(u1 - 0.0045));
      b.add(m.reticle, ring, new THREE.CircleGeometry(0.0008, 10).translate(0, vc, -(u1 - 0.0045)));
      return vc;
    }
    case 'scope': {
      const vc = railTop + 0.03;
      const u0 = uc - 0.1;
      // Body tube with objective bell and eyepiece, rings and turrets.
      b.add(
        m.alloy,
        lathe(
          [
            [0.0, 0],
            [0.018, 0],
            [0.019, 0.004],
            [0.018, 0.045],
            [0.0125, 0.075],
            [0.0125, 0.16],
            [0.019, 0.19],
            [0.021, 0.22],
            [0.0, 0.22],
          ],
          u0,
          vc,
          0,
          28,
        ),
      );
      for (const du of [0.08, 0.15]) {
        b.add(m.alloy, lathe([[0.0125, -0.006], [0.016, -0.006], [0.016, 0.006], [0.0125, 0.006]], u0 + du, vc, 0, 20));
        b.add(m.alloy, block(u0 + du - 0.007, u0 + du + 0.007, railTop, vc - 0.012, 0.014));
      }
      b.add(m.alloy, new THREE.CylinderGeometry(0.009, 0.009, 0.014, 16).translate(0, vc + 0.018, -(u0 + 0.115)));
      b.add(m.alloy, new THREE.CylinderGeometry(0.009, 0.009, 0.014, 16).rotateZ(Math.PI / 2).translate(0.018, vc, -(u0 + 0.115)));
      b.add(m.lens, new THREE.CircleGeometry(0.019, 24).rotateY(Math.PI).translate(0, vc, -(u0 + 0.2201)));
      b.add(m.lens, new THREE.CircleGeometry(0.016, 24).translate(0, vc, -(u0 - 0.0001)));
      return vc;
    }
    case 'irons':
    case 'bead':
      return railTop;
  }
}

/** Rear aperture on a small tower; returns the sight-line height. */
function rearAperture(b: PartBuilder, u: number, base: number): number {
  const m = gunMaterials();
  const vc = base + 0.02;
  b.add(m.dark, block(u - 0.008, u + 0.008, base, vc - 0.004, 0.014));
  b.add(m.dark, new THREE.TorusGeometry(0.0055, 0.0022, 8, 20).translate(0, vc, -u));
  return vc;
}

/** Protected front post whose tip sits on the sight line. */
function frontPost(b: PartBuilder, u: number, base: number, vc: number): void {
  const m = gunMaterials();
  b.add(m.dark, block(u - 0.006, u + 0.006, base, vc - 0.012, 0.012));
  b.add(m.dark, block(u - 0.0015, u + 0.0015, vc - 0.012, vc, 0.0025));
  for (const x of [-0.007, 0.007]) b.add(m.dark, block(u - 0.004, u + 0.004, vc - 0.012, vc + 0.002, 0.0025, x));
}

// ---------------------------------------------------------------------------
// Shared parts

const GRIP: P[] = [
  [-0.004, -0.03],
  [-0.012, -0.07],
  [-0.032, -0.132],
  [-0.06, -0.128],
  [-0.036, -0.028],
];

/** Pistol grip, trigger and guard; `f` receives the fine details (finger ridges, cap, trigger pin). */
function addTriggerGroup(b: PartBuilder, f: PartBuilder, guardFront = 0.05, gripMat?: THREE.Material): void {
  const m = gunMaterials();
  b.add(gripMat ?? m.polymer, slab(GRIP, 0.03, 0, 0.004));
  b.add(m.dark, slab([[0.012, -0.03], [0.018, -0.03], [0.017, -0.041], [0.01, -0.049], [0.008, -0.047], [0.012, -0.038]], 0.006, 0, 0.001));
  // Trigger guard: bottom bar and front post.
  b.add(m.alloy, block(-0.015, guardFront, -0.052, -0.047, 0.012));
  b.add(m.alloy, block(guardFront - 0.006, guardFront, -0.052, -0.03, 0.012));
  // Finger ridges down the front strap, a grip cap, the trigger pin.
  for (const [u, v] of [[-0.013, -0.072], [-0.02, -0.093], [-0.027, -0.114]] as const) f.add(gripMat ?? m.polymer, xcyl(0.0036, 0.027, u, v, 0, 8));
  f.add(m.dark, slab([[-0.03, -0.128], [-0.061, -0.124], [-0.063, -0.136], [-0.032, -0.14]], 0.031, 0, 0.001));
  f.add(m.steel, xcyl(0.0018, 0.027, 0.014, -0.022, 0, 8));
  // Backstrap texture: a few grooves across the rear of the grip.
  for (let v = -0.045; v > -0.12; v -= 0.012) {
    const u = -0.036 - ((-0.028 - v) / 0.1) * 0.024;
    f.add(m.dark, block(u - 0.002, u + 0.0005, v - 0.0015, v, 0.026));
  }
}

/** A cartridge at the top of a magazine (visible when the magazine is out). */
function topRound(b: PartBuilder, u0: number, len: number, v: number, r: number): void {
  const m = gunMaterials();
  b.add(m.brass, tube(r, u0, u0 + len * 0.7, v, 0, 10));
  b.add(m.copper, lathe([[r * 0.8, 0], [r * 0.7, len * 0.15], [r * 0.3, len * 0.27], [0, len * 0.3]], u0 + len * 0.7, v, 0, 10));
}

function magazine(kind: 'curved' | 'straight' | 'smg', fine: boolean): THREE.Group {
  const m = gunMaterials();
  const b = new PartBuilder();
  const f = fine ? b : DISCARD;
  if (kind === 'curved') {
    b.add(m.polymer, slab([[0.058, -0.02], [0.06, -0.08], [0.068, -0.13], [0.082, -0.178], [0.148, -0.178], [0.134, -0.13], [0.124, -0.08], [0.12, -0.02]], 0.022, 0, 0.002));
    b.add(m.dark, slab([[0.08, -0.176], [0.15, -0.176], [0.152, -0.186], [0.079, -0.186]], 0.025, 0, 0.002));
    // Ribs along the body, grip texture on the lower half, feed lips and a round.
    for (const v of [-0.06, -0.1]) b.add(m.dark, slab([[0.062, v], [0.124, v], [0.126, v - 0.004], [0.063, v - 0.004]], 0.0235, 0, 0.0005));
    for (let v = -0.125; v > -0.17; v -= 0.008) {
      const u0 = 0.068 + ((-0.13 - v) / 0.048) * 0.014;
      f.add(m.dark, block(u0 + 0.01, u0 + 0.05, v - 0.0022, v, 0.0232));
    }
    f.add(m.steel, block(0.062, 0.118, -0.016, -0.012, 0.02));
    topRound(f, 0.065, 0.05, -0.011, 0.0048);
  } else if (kind === 'straight') {
    b.add(m.steel, slab([[0.058, -0.02], [0.062, -0.12], [0.126, -0.12], [0.122, -0.02]], 0.024, 0, 0.0015));
    b.add(m.dark, block(0.06, 0.128, -0.128, -0.12, 0.027));
    // Pressed ribs and witness holes on both sides, a round on top.
    for (const x of [-0.0122, 0.0122]) {
      f.add(m.steel, block(0.07, 0.112, -0.1, -0.03, 0.0015, x));
      for (const v of [-0.045, -0.065, -0.085]) f.add(m.dark, xcyl(0.0022, 0.0016, 0.118, v, x * 1.02, 8));
    }
    topRound(f, 0.066, 0.052, -0.011, 0.0052);
  } else {
    b.add(m.steel, slab([[0.047, -0.03], [0.052, -0.1], [0.07, -0.168], [0.104, -0.168], [0.09, -0.1], [0.084, -0.03]], 0.02, 0, 0.0015));
    b.add(m.dark, slab([[0.068, -0.166], [0.106, -0.166], [0.108, -0.174], [0.067, -0.174]], 0.023, 0, 0.001));
    for (const x of [-0.0105, 0.0105]) f.add(m.dark, slab([[0.056, -0.06], [0.06, -0.09], [0.066, -0.13], [0.07, -0.13], [0.064, -0.09], [0.06, -0.06]], 0.0015, x, 0));
    topRound(f, 0.05, 0.03, -0.026, 0.0045);
  }
  return b.build('mag');
}

type MuzzleKind = 'flash' | 'brake' | 'suppressor';

/** Muzzle device at the barrel end; returns the u of its front face. */
function muzzleDevice(b: PartBuilder, f: PartBuilder, kind: MuzzleKind, u0: number, v: number, r = 0.0105): number {
  const m = gunMaterials();
  if (kind === 'brake') {
    // Squared-off brake with three ports a side and a crown.
    b.add(m.steel, lathe([[r * 0.85, 0], [r * 1.2, 0.004], [r * 1.25, 0.008], [r * 1.25, 0.056], [r * 1.1, 0.06], [0.004, 0.06]], u0, v, 0, 16));
    for (let i = 0; i < 3; i++) {
      for (const x of [-1, 1]) b.add(m.dark, block(u0 + 0.018 + i * 0.013, u0 + 0.026 + i * 0.013, v - r * 0.7, v + r * 0.7, 0.003, x * r * 1.22));
    }
    for (let i = 0; i < 2; i++) f.add(m.dark, xcyl(0.0018, 0.0015, u0 + 0.02 + i * 0.016, v + r * 1.24, 0, 8).rotateZ(0));
    return u0 + 0.06;
  }
  if (kind === 'suppressor') {
    // Can on a mount: knurled rear section, main body, front cap.
    const R = r * 1.65;
    b.add(m.steel, lathe([[r * 1.05, 0], [R * 0.95, 0.008], [R * 0.95, 0.03], [r * 1.05, 0.034]], u0, v, 0, 20));
    b.add(m.alloy, tube(R, u0 + 0.03, u0 + 0.17, v, 0, 22));
    b.add(m.alloy, lathe([[R, 0], [R, 0.008], [R * 0.8, 0.014], [0.005, 0.016], [0, 0.016]], u0 + 0.17, v, 0, 22));
    for (let u = u0 + 0.004; u < u0 + 0.028; u += 0.004) f.add(m.dark, lathe([[R * 0.96, 0], [R * 0.96, 0.0012]], u, v, 0, 20));
    for (const du of [0.04, 0.16]) f.add(m.steel, lathe([[R * 1.02, 0], [R * 1.02, 0.004]], u0 + du, v, 0, 22));
    return u0 + 0.186;
  }
  b.add(m.steel, lathe([[r * 0.8, 0], [r, 0.004], [r * 1.08, 0.008], [r * 1.08, 0.045], [r * 0.85, 0.05], [0.004, 0.05]], u0, v, 0, 20));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.add(m.dark, block(u0 + 0.018, u0 + 0.044, -0.0012, 0.0012, 0.002).translate(Math.cos(a) * r * 1.09, v + Math.sin(a) * r * 1.09, 0));
  }
  f.add(m.dark, lathe([[r * 1.1, 0], [r * 1.1, 0.003]], u0 + 0.006, v, 0, 20));
  return u0 + 0.05;
}

type Foregrip = 'vertical' | 'angled';

/** Foregrip hanging under a handguard whose bottom is at vBottom, centered at u. */
function foregrip(b: PartBuilder, f: PartBuilder, kind: Foregrip, u: number, vBottom: number, mat: THREE.Material): void {
  const m = gunMaterials();
  const [rails, low] = railUnder(u - 0.04, u + 0.04, vBottom);
  b.add(m.alloy, rails);
  if (kind === 'vertical') {
    b.add(mat, vcyl(0.0115, 0.0125, u, low, low - 0.085, 0, 14));
    b.add(m.rubber, vcyl(0.0128, 0.0128, u, low - 0.085, low - 0.092, 0, 14));
    for (let v = low - 0.02; v > low - 0.08; v -= 0.012) f.add(m.dark, vcyl(0.0122, 0.0122, u, v, v - 0.002, 0, 14));
    b.add(m.alloy, block(u - 0.016, u + 0.016, low - 0.008, low, 0.02));
  } else {
    // Angled grip / hand stop: a swept wedge, thumb shelf at the back.
    b.add(mat, slab([[u - 0.04, low], [u + 0.036, low], [u + 0.024, low - 0.028], [u - 0.03, low - 0.012]], 0.026, 0, 0.004));
    f.add(m.dark, slab([[u - 0.018, low - 0.008], [u + 0.018, low - 0.018], [u + 0.018, low - 0.02], [u - 0.018, low - 0.01]], 0.027, 0, 0));
  }
}

/** Weapon light clamped to the right of the handguard (axis at height v, offset x). */
function weaponLight(b: PartBuilder, f: PartBuilder, u1: number, v: number, x: number): void {
  const m = gunMaterials();
  const u0 = u1 - 0.1;
  b.add(m.alloy, block(u0 + 0.03, u0 + 0.07, v - 0.008, v + 0.008, x - 0.012, (x - 0.012) / 2 + 0.006));
  b.add(m.alloy, tube(0.0105, u0, u1 - 0.02, v, x, 16));
  b.add(m.alloy, lathe([[0.0105, 0], [0.0135, 0.006], [0.0135, 0.022], [0.012, 0.024]], u1 - 0.022, v, x, 18));
  b.add(m.lightLens, new THREE.CircleGeometry(0.0115, 18).translate(x, v, -(u1 + 0.0021)));
  f.add(m.rubber, lathe([[0.009, -0.008], [0.0105, -0.006], [0.0105, 0.0], [0, 0]], u0, v, x, 14));
  for (let u = u0 + 0.01; u < u0 + 0.03; u += 0.004) f.add(m.dark, lathe([[0.0108, 0], [0.0108, 0.0015]], u, v, x, 14));
}

/** Folding backup iron sights lying flat on the rail (rear at uRear, front at uFront). */
function foldedIrons(b: PartBuilder, uRear: number, uFront: number, railTop: number): void {
  const m = gunMaterials();
  for (const [u, len] of [[uRear, 0.03], [uFront, 0.026]] as const) {
    b.add(m.alloy, block(u, u + len, railTop, railTop + 0.006, 0.02));
    b.add(m.dark, block(u + 0.004, u + len - 0.004, railTop + 0.006, railTop + 0.01, 0.014));
    b.add(m.steel, xcyl(0.0022, 0.022, u + (u === uRear ? len - 0.004 : 0.004), railTop + 0.004, 0, 8));
  }
}

// ---------------------------------------------------------------------------
// Designs

export type GunDetail = 'full' | 'low';

interface RifleOpts {
  handguardEnd: number;
  barrelEnd: number;
  mag: 'curved' | 'straight';
  optic: Optic;
  color: number;
  precision: boolean;
  look: Look;
  fine: boolean;
}

/** AR-pattern rifle: carbine or precision (DMR) configuration. */
function rifle(o: RifleOpts): GunBuild {
  const m = gunMaterials();
  const furn = furniture(o.color);
  const b = new PartBuilder();
  const f = o.fine ? b : DISCARD;

  // Upper receiver with ejection port, forward assist and charging handle.
  b.add(m.alloy, slab([[-0.08, 0.016], [-0.075, -0.004], [0.135, -0.004], [0.135, 0.026], [-0.075, 0.026]], 0.026, 0, 0.002));
  b.add(m.dark, block(0.0, 0.05, 0.004, 0.018, 0.002, 0.0135));
  b.add(m.alloy, tube(0.006, -0.055, -0.02, 0.014, 0.017, 12));
  b.add(m.alloy, block(-0.092, -0.074, 0.017, 0.025, 0.03));
  // Open dust cover hanging under the port on its hinge rod, brass deflector,
  // forward assist plunger, charging handle latch.
  f.add(m.alloy, block(0.002, 0.052, -0.014, 0.002, 0.0012, 0.0152));
  f.add(m.steel, tube(0.0012, -0.002, 0.056, 0.002, 0.0145, 6));
  f.add(m.alloy, slab([[-0.014, 0.004], [0.0, 0.004], [0.0, 0.022], [-0.01, 0.022]], 0.006, 0.0145, 0.001));
  f.add(m.alloy, lathe([[0.0, 0], [0.0075, 0], [0.0075, 0.006], [0.006, 0.008]], -0.064, 0.014, 0.017, 12));
  f.add(m.dark, block(-0.09, -0.078, 0.019, 0.024, 0.008, -0.018));
  // Receiver seam and takedown pins.
  f.add(m.dark, block(-0.07, 0.132, -0.0045, -0.0035, 0.0245));
  for (const u of [0.125, -0.062]) {
    f.add(m.steel, xcyl(0.0026, 0.0262, u, -0.009, 0, 10));
    f.add(m.steel, xcyl(0.0034, 0.0012, u, -0.009, 0.0128, 10));
  }

  // Lower receiver with magwell (flared at the bottom).
  b.add(m.alloy, slab([[-0.07, -0.004], [0.132, -0.004], [0.132, -0.02], [0.124, -0.06], [0.054, -0.06], [0.05, -0.03], [-0.03, -0.03], [-0.07, -0.02]], 0.024, 0, 0.002));
  f.add(m.alloy, slab([[0.051, -0.054], [0.128, -0.054], [0.126, -0.064], [0.05, -0.064]], 0.028, 0, 0.0015));
  addTriggerGroup(b, f);
  // Controls: magazine release (right), bolt catch (left), safety selector (left).
  f.add(m.steel, xcyl(0.0045, 0.004, 0.044, -0.02, 0.0135, 12));
  f.add(m.alloy, xcyl(0.0065, 0.002, 0.044, -0.02, 0.0122, 14));
  f.add(m.steel, slab([[0.046, -0.028], [0.06, -0.024], [0.06, -0.011], [0.05, -0.013]], 0.003, -0.0135, 0.0008));
  f.add(m.steel, xcyl(0.0042, 0.003, -0.014, -0.016, -0.0132, 12));
  f.add(m.steel, slab([[-0.014, -0.0185], [-0.034, -0.017], [-0.034, -0.0125], [-0.014, -0.0135]], 0.0025, -0.0152, 0.0006));

  // Buffer tube, castle nut, end plate with a sling loop, and stock.
  b.add(m.alloy, tube(0.0145, -0.27, -0.07, 0.008, 0, 20));
  b.add(m.steel, lathe([[0.016, 0], [0.018, 0.002], [0.018, 0.008], [0.016, 0.01]], -0.082, 0.008, 0, 16));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    f.add(m.dark, block(-0.08, -0.074, -0.0015, 0.0015, 0.003).translate(Math.cos(a) * 0.0178, 0.008 + Math.sin(a) * 0.0178, 0));
  }
  f.add(m.steel, slab(roundRect(-0.0735, -0.018, -0.0705, 0.028, 0.002), 0.03, 0, 0));
  f.add(m.steel, loop(0.0055, 0.0013, -0.076, -0.024, -0.016));
  const stock: P[] = o.precision
    ? [[-0.15, 0.03], [-0.3, 0.034], [-0.312, -0.06], [-0.29, -0.066], [-0.22, -0.035], [-0.2, -0.05], [-0.17, -0.05], [-0.15, -0.012]]
    : [[-0.16, 0.026], [-0.305, 0.03], [-0.31, -0.05], [-0.29, -0.058], [-0.2, -0.02], [-0.16, -0.012]];
  const holes: P[][] = o.fine && !o.precision ? [roundRect(-0.296, -0.042, -0.272, -0.03, 0.005)] : [];
  b.add(furn, slab(stock, 0.036, 0, 0.004, holes));
  if (o.precision) {
    b.add(furn, slab(roundRect(-0.28, 0.026, -0.19, 0.036, 0.004), 0.03, 0, 0.003)); // cheek riser
    for (const u of [-0.27, -0.2]) f.add(m.steel, xcyl(0.003, 0.034, u, 0.031, 0, 10)); // riser clamps
    for (const u of [-0.306, -0.3]) f.add(m.dark, block(u, u + 0.002, -0.058, 0.03, 0.037)); // butt spacers
    f.add(m.steel, loop(0.006, 0.0014, -0.21, -0.052, 0)); // sling swivel
  } else {
    f.add(m.dark, block(-0.2, -0.168, -0.022, -0.016, 0.01)); // adjustment lever
    f.add(m.steel, xcyl(0.0052, 0.04, -0.285, 0.012, 0, 12)); // QD sockets
  }
  b.add(m.rubber, block(-0.32, -0.305, o.precision ? -0.066 : -0.058, o.precision ? 0.036 : 0.032, 0.04));
  for (let v = -0.05; v < 0.03; v += 0.008) f.add(m.dark, block(-0.3205, -0.3185, v, v + 0.0025, 0.041));

  // Free-float octagonal handguard with M-LOK slots, rail on top, end cap.
  const hg = new THREE.CylinderGeometry(0.021, 0.021, o.handguardEnd - 0.135, 8, 1);
  hg.rotateY(Math.PI / 8);
  hg.rotateX(-Math.PI / 2);
  hg.translate(0, 0.006, -(0.135 + o.handguardEnd) / 2);
  b.add(furn, hg);
  for (let u = 0.155; u < o.handguardEnd - 0.03; u += 0.045) {
    for (const x of [-0.0198, 0.0198]) b.add(m.dark, block(u, u + 0.03, 0.0, 0.007, 0.002, x));
    b.add(m.dark, block(u, u + 0.03, -0.0138, -0.0132, 0.007));
  }
  f.add(m.alloy, lathe([[0.0195, 0], [0.0225, 0.001], [0.0225, 0.006], [0.0195, 0.007]], 0.13, 0.006, 0, 8).rotateZ(0));
  f.add(m.alloy, lathe([[0.022, 0], [0.022, 0.004], [0.012, 0.006]], o.handguardEnd - 0.004, 0.006, 0, 8));
  f.add(m.steel, xcyl(0.0048, 0.046, o.handguardEnd - 0.025, 0.004, 0, 12)); // front QD sockets
  const [railGeos, railTop] = rail(-0.075, o.handguardEnd - 0.005, 0.026);
  b.add(m.alloy, railGeos);
  if (o.optic === 'reddot' || o.optic === 'holo') foldedIrons(f, -0.074, o.handguardEnd - 0.04, railTop);

  // Accessories: foregrip, light, bipod (precision).
  if (o.look.grip) foregrip(b, f, o.look.grip, o.handguardEnd - 0.075, -0.015, o.look.grip === 'vertical' ? m.polymer : furn);
  if (o.look.light && o.fine) weaponLight(b, f, o.handguardEnd - 0.012, 0.006, 0.034);
  if (o.look.bipod) {
    for (const x of [-0.009, 0.009]) b.add(m.steel, tube(0.0038, o.handguardEnd - 0.2, o.handguardEnd - 0.03, -0.026, x, 8));
    b.add(m.alloy, block(o.handguardEnd - 0.035, o.handguardEnd - 0.01, -0.03, -0.014, 0.03));
    for (const x of [-0.009, 0.009]) f.add(m.rubber, block(o.handguardEnd - 0.215, o.handguardEnd - 0.2, -0.031, -0.021, 0.009, x));
    f.add(m.steel, xcyl(0.003, 0.034, o.handguardEnd - 0.022, -0.022, 0, 10));
  }

  // Barrel, gas block (set screws, gas tube stub) and muzzle device.
  b.add(m.steel, tube(0.0085, o.handguardEnd - 0.01, o.barrelEnd, 0.006, 0, 16));
  b.add(m.steel, block(o.handguardEnd + 0.004, o.handguardEnd + 0.022, -0.006, 0.017, 0.02));
  for (const u of [o.handguardEnd + 0.009, o.handguardEnd + 0.017]) f.add(m.dark, vcyl(0.0018, 0.0018, u, -0.0065, -0.0055, 0, 8));
  f.add(m.steel, tube(0.0028, o.handguardEnd - 0.006, o.handguardEnd + 0.004, 0.012, 0, 8));
  const muzzleU = muzzleDevice(b, f, o.look.muzzle ?? 'flash', o.barrelEnd, 0.006);

  const sightHeight = addOptic(b, o.optic, railTop, 0.02);
  const group = b.build('rifle');
  const mag = magazine(o.mag, o.fine);
  group.add(mag);
  return {
    group,
    sightHeight,
    muzzle: new THREE.Vector3(0, 0.006, -muzzleU - 0.01),
    support: [o.handguardEnd - 0.1, -0.045],
    mag,
    pump: null,
    slide: null,
  };
}

function smg(color: number, optic: Optic, look: Look, fine: boolean): GunBuild {
  const m = gunMaterials();
  const furn = furniture(color);
  const b = new PartBuilder();
  const f = fine ? b : DISCARD;
  // Stamped round-top receiver, cocking tube and handguard.
  b.add(m.steel, slab(roundRect(-0.11, -0.012, 0.17, 0.028, 0.012), 0.032, 0, 0.002));
  b.add(m.dark, block(0.0, 0.045, 0.002, 0.016, 0.002, 0.0162));
  b.add(m.steel, tube(0.0095, 0.16, 0.245, 0.016, 0, 16));
  f.add(m.steel, lathe([[0.0095, 0], [0.0108, 0.002], [0.0108, 0.008], [0.009, 0.01], [0, 0.01]], 0.245, 0.016, 0, 14));
  // Stamping seams, weld spots, receiver pins, rear cap with a sling loop.
  for (const x of [-0.0162, 0.0162]) {
    f.add(m.dark, block(-0.1, 0.16, -0.0035, -0.0025, 0.0012, x));
    for (let u = -0.09; u < 0.15; u += 0.03) f.add(m.steel, xcyl(0.0014, 0.0008, u, 0.022, x * 1.02, 6));
  }
  for (const u of [-0.05, 0.035]) f.add(m.steel, xcyl(0.0024, 0.034, u, -0.018, 0, 8));
  b.add(m.steel, lathe([[0.0, 0], [0.018, 0], [0.019, 0.004], [0.019, 0.012], [0.0, 0.012]], -0.122, 0.008, 0, 16));
  f.add(m.steel, loop(0.0055, 0.0013, -0.118, -0.018, 0));
  b.add(furn, slab(roundRect(0.12, -0.045, 0.25, 0.012, 0.014), 0.044, 0, 0.004));
  for (let u = 0.135; u < 0.24; u += 0.018) for (const x of [-0.0225, 0.0225]) b.add(m.dark, block(u, u + 0.008, -0.03, 0.0, 0.0015, x));
  // Short side rails at the front of the handguard.
  for (const x of [-1, 1]) {
    const g = rail(0.2, 0.245, 0.0)[0];
    for (const p of g) f.add(m.alloy, p.rotateZ(-x * Math.PI / 2).translate(x * 0.022, -0.016, 0));
  }
  // Lower: trigger housing, magwell with paddle release, selector.
  b.add(furn, slab([[-0.07, -0.012], [0.04, -0.012], [0.04, -0.03], [-0.035, -0.03], [-0.07, -0.02]], 0.03, 0, 0.003));
  addTriggerGroup(b, f, 0.04, furn);
  b.add(m.steel, block(0.042, 0.092, -0.042, -0.012, 0.026));
  f.add(m.steel, slab([[0.034, -0.042], [0.041, -0.042], [0.041, -0.03], [0.036, -0.03]], 0.018, 0, 0.001));
  f.add(m.steel, xcyl(0.005, 0.003, -0.02, -0.02, -0.016, 12));
  f.add(m.steel, slab([[-0.02, -0.022], [-0.038, -0.028], [-0.038, -0.024], [-0.02, -0.018]], 0.0025, -0.0175, 0.0005));
  // Barrel, three-lug muzzle and front sight hood (or a suppressor).
  b.add(m.steel, tube(0.0075, 0.24, 0.3, 0.004, 0, 14));
  let muzzleU = 0.3;
  if (look.muzzle === 'suppressor') {
    muzzleU = muzzleDevice(b, f, 'suppressor', 0.27, 0.004, 0.0085);
  } else {
    b.add(m.steel, lathe([[0.0085, 0], [0.0095, 0.002], [0.0095, 0.02], [0.007, 0.022]], 0.28, 0.004, 0, 14));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      f.add(m.steel, block(0.282, 0.29, -0.002, 0.002, 0.004).translate(Math.cos(a) * 0.0105, 0.004 + Math.sin(a) * 0.0105, 0));
    }
    // Hooded front post.
    f.add(m.steel, block(0.25, 0.262, 0.012, 0.03, 0.004, -0.007));
    f.add(m.steel, block(0.25, 0.262, 0.012, 0.03, 0.004, 0.007));
    f.add(m.dark, block(0.253, 0.259, 0.012, 0.026, 0.0025));
  }
  // Retractable stock: two rods with end caps and a butt plate.
  for (const x of [-0.012, 0.012]) {
    b.add(m.steel, tube(0.0045, -0.29, -0.1, 0.012, x, 10));
    f.add(m.steel, lathe([[0.0045, 0], [0.006, 0.002], [0.006, 0.008], [0.0045, 0.01]], -0.115, 0.012, x, 10));
  }
  b.add(m.rubber, slab(roundRect(-0.305, -0.05, -0.288, 0.035, 0.008), 0.045, 0, 0.003));
  f.add(m.steel, slab(roundRect(-0.292, -0.01, -0.286, 0.03, 0.002), 0.035, 0, 0.001));
  // Short rail on the claw mount for the optic.
  b.add(m.steel, block(-0.06, 0.09, 0.026, 0.032, 0.02));
  for (const u of [-0.05, 0.075]) f.add(m.steel, xcyl(0.0035, 0.028, u, 0.029, 0, 10));
  const [railGeos, railTop] = rail(-0.06, 0.09, 0.032);
  b.add(m.alloy, railGeos);
  const sightHeight = addOptic(b, optic, railTop, 0.01);
  if (look.grip) foregrip(b, f, look.grip, 0.195, -0.045, look.grip === 'vertical' ? m.polymer : furn);
  if (look.light && fine) weaponLight(b, f, 0.25, -0.016, 0.04);

  const group = b.build('smg');
  // Cocking handle on the left rides with the bolt.
  const slideB = new PartBuilder();
  slideB.add(m.dark, block(0.205, 0.215, 0.012, 0.02, 0.028, -0.018));
  (fine ? slideB : DISCARD).add(m.dark, lathe([[0.004, 0], [0.005, 0.002], [0.005, 0.006], [0, 0.008]], 0.206, 0.016, -0.033, 8).rotateZ(0));
  const slide = slideB.build('slide');
  group.add(slide);
  const mag = magazine('smg', fine);
  group.add(mag);
  return { group, sightHeight, muzzle: new THREE.Vector3(0, 0.004, -muzzleU - 0.01), support: [0.19, -0.05], mag, pump: null, slide };
}

function lmg(color: number, fine: boolean): GunBuild {
  const m = gunMaterials();
  const furn = furniture(color);
  const b = new PartBuilder();
  const f = fine ? b : DISCARD;
  // Receiver, feed cover and top rail.
  b.add(m.steel, slab(roundRect(-0.13, -0.035, 0.15, 0.03, 0.006), 0.05, 0, 0.003));
  b.add(m.steel, slab([[-0.06, 0.028], [0.1, 0.028], [0.125, 0.036], [0.12, 0.046], [-0.06, 0.046]], 0.046, 0, 0.002));
  b.add(m.dark, block(-0.03, 0.06, -0.01, 0.018, 0.002, 0.0251));
  b.add(m.steel, block(-0.03, 0.06, -0.01, 0.018, 0.002, -0.0251));
  // Feed cover latch, hinge, stiffening ribs; receiver rivets; charging handle (right).
  f.add(m.dark, block(-0.075, -0.058, 0.03, 0.048, 0.034));
  f.add(m.steel, xcyl(0.004, 0.05, 0.118, 0.04, 0, 10));
  for (const u of [-0.02, 0.03, 0.08]) f.add(m.steel, block(u, u + 0.006, 0.046, 0.049, 0.04));
  for (const x of [-0.0252, 0.0252]) for (let u = -0.11; u < 0.14; u += 0.035) for (const v of [-0.026, 0.021]) f.add(m.steel, xcyl(0.0017, 0.001, u, v, x, 6));
  f.add(m.steel, block(0.06, 0.1, -0.006, 0.004, 0.012, 0.03));
  f.add(m.dark, xcyl(0.005, 0.014, 0.068, -0.001, 0.04, 10));
  addTriggerGroup(b, f, 0.045);
  f.add(m.steel, xcyl(0.0045, 0.056, -0.008, -0.018, 0, 12)); // push-through safety
  // Skeleton stock with a buffer and sling loop.
  b.add(
    furn,
    slab(
      [[-0.13, 0.025], [-0.33, 0.03], [-0.335, -0.075], [-0.3, -0.08], [-0.2, -0.04], [-0.13, -0.03]],
      0.032,
      0,
      0.004,
      [[[-0.3, 0.012], [-0.3, -0.055], [-0.22, -0.028], [-0.17, -0.02], [-0.17, 0.012]]],
    ),
  );
  b.add(m.rubber, block(-0.345, -0.332, -0.08, 0.032, 0.036));
  f.add(m.steel, tube(0.006, -0.3, -0.17, 0.004, 0, 10));
  f.add(m.steel, loop(0.007, 0.0016, -0.31, -0.07, 0));
  // Handguard, gas tube with regulator, perforated heat shield, barrel.
  b.add(furn, slab(roundRect(0.15, -0.06, 0.3, -0.004, 0.012), 0.05, 0, 0.004));
  for (let u = 0.165; u < 0.29; u += 0.02) for (const x of [-0.0252, 0.0252]) f.add(m.dark, block(u, u + 0.01, -0.045, -0.02, 0.0015, x));
  b.add(m.steel, tube(0.007, 0.15, 0.37, -0.018, 0, 12));
  f.add(m.steel, lathe([[0.007, 0], [0.011, 0.002], [0.011, 0.014], [0.007, 0.016]], 0.35, -0.018, 0, 10));
  b.add(m.steel, tube(0.011, 0.15, 0.53, 0.008, 0, 18));
  const shield = new THREE.CylinderGeometry(0.018, 0.018, 0.17, 18, 1, true, -Math.PI / 2, Math.PI);
  shield.rotateX(-Math.PI / 2);
  shield.translate(0, 0.008, -0.235);
  b.add(fine ? m.steel : m.dark, shield);
  for (let u = 0.16; u < 0.31; u += 0.016) {
    for (const a of [-0.6, 0, 0.6]) f.add(m.dark, block(u, u + 0.007, -0.002, 0.002, 0.006).translate(Math.sin(a) * 0.0182, 0.008 + Math.cos(a) * 0.0182, 0).rotateZ(0));
  }
  // Barrel-change handle folded along the left side.
  f.add(m.steel, slab([[0.32, 0.004], [0.336, 0.004], [0.3, -0.06], [0.286, -0.06]], 0.008, -0.022, 0.002));
  f.add(m.polymer, slab(roundRect(0.26, -0.078, 0.302, -0.055, 0.008), 0.018, -0.022, 0.003));
  // Carry handle.
  b.add(m.steel, slab([[0.19, 0.02], [0.2, 0.05], [0.28, 0.05], [0.29, 0.02], [0.275, 0.02], [0.268, 0.04], [0.212, 0.04], [0.205, 0.02]], 0.012, 0, 0.002));
  f.add(m.polymer, slab(roundRect(0.212, 0.04, 0.268, 0.05, 0.004), 0.018, 0, 0.002));
  // Folded bipod: legs, feet, hub, adjuster buttons.
  for (const x of [-0.009, 0.009]) {
    b.add(m.steel, tube(0.004, 0.3, 0.5, -0.032, x, 8));
    f.add(m.steel, tube(0.0048, 0.34, 0.38, -0.032, x, 8));
    f.add(m.rubber, block(0.292, 0.306, -0.04, -0.026, 0.01, x));
  }
  b.add(m.steel, block(0.49, 0.51, -0.042, -0.024, 0.03));
  f.add(m.steel, xcyl(0.004, 0.038, 0.5, -0.033, 0, 10));
  const muzzleU = muzzleDevice(b, f, 'flash', 0.53, 0.008, 0.013);
  // Iron sights on the feed cover and at the gas block.
  const vc = rearAperture(b, -0.03, 0.046);
  frontPost(b, 0.36, 0.02, vc);

  const group = b.build('lmg');
  // Ammo box under the left side, with a belt of rounds feeding in (drops on reload).
  const box = new PartBuilder();
  const fb = fine ? box : DISCARD;
  box.add(furn, slab(roundRect(-0.01, -0.15, 0.11, -0.03, 0.008), 0.07, -0.035, 0.004));
  box.add(m.dark, block(0.0, 0.1, -0.03, -0.026, 0.066, -0.035));
  for (const v of [-0.06, -0.1]) fb.add(m.dark, block(-0.008, 0.108, v, v + 0.003, 0.0715, -0.035));
  fb.add(m.steel, block(0.1, 0.114, -0.11, -0.07, 0.02, -0.035)); // latch
  fb.add(m.steel, slab([[0.02, -0.03], [0.03, -0.02], [0.07, -0.02], [0.08, -0.03], [0.072, -0.03], [0.066, -0.024], [0.034, -0.024], [0.028, -0.03]], 0.008, -0.072, 0.001));
  for (let i = 0; i < 5; i++) {
    const g = new THREE.CylinderGeometry(0.0045, 0.0045, 0.05, 8).rotateZ(Math.PI / 2);
    g.translate(-0.036 + i * 0.0022, -0.024 + i * 0.01, -(0.043 + i * 0.004));
    box.add(m.brass, g);
    fb.add(m.copper, new THREE.ConeGeometry(0.0042, 0.012, 8).rotateZ(-Math.PI / 2).translate(-0.036 + i * 0.0022 + 0.031, -0.024 + i * 0.01, -(0.043 + i * 0.004)));
    fb.add(m.dark, block(0.038 + i * 0.004, 0.05 + i * 0.004, -0.028 + i * 0.01, -0.02 + i * 0.01, 0.036, -0.036 + i * 0.0022));
  }
  const mag = box.build('mag');
  group.add(mag);
  return { group, sightHeight: vc, muzzle: new THREE.Vector3(0, 0.008, -muzzleU - 0.01), support: [0.22, -0.06], mag, pump: null, slide: null };
}

function shotgun(color: number | null, tactical: boolean, fine: boolean): GunBuild {
  const m = gunMaterials();
  const stockMat = color === null ? m.wood : furniture(color);
  const b = new PartBuilder();
  const f = fine ? b : DISCARD;
  // Receiver with ejection port, pins, loading port, safety and action release.
  b.add(m.steel, slab([[-0.065, -0.03], [0.1, -0.03], [0.1, 0.02], [0.09, 0.026], [-0.03, 0.026], [-0.065, 0.004]], 0.03, 0, 0.004));
  b.add(m.dark, block(0.0, 0.065, 0.0, 0.018, 0.002, 0.0151));
  for (const u of [-0.04, 0.075]) {
    f.add(m.steel, xcyl(0.0026, 0.0312, u, -0.022, 0, 10));
  }
  f.add(m.dark, block(0.0, 0.075, -0.032, -0.029, 0.02));
  f.add(m.steel, xcyl(0.0035, 0.036, -0.02, 0.014, 0, 12)); // cross-bolt safety
  f.add(m.shellHull, xcyl(0.0036, 0.0015, -0.02, 0.014, -0.0175, 12));
  f.add(m.steel, slab([[0.028, -0.034], [0.042, -0.034], [0.042, -0.046], [0.032, -0.042]], 0.003, -0.0078, 0.0006));
  // Barrel with vent rib and bead, magazine tube, clamp.
  b.add(m.steel, tube(0.0105, 0.1, 0.52, 0.013, 0, 18));
  b.add(m.steel, block(0.1, 0.52, 0.024, 0.027, 0.008));
  for (let u = 0.12; u < 0.51; u += 0.035) b.add(m.steel, block(u, u + 0.006, 0.02, 0.024, 0.005));
  b.add(m.brass, new THREE.SphereGeometry(0.0022, 10, 8).translate(0, 0.03, -0.515));
  b.add(m.steel, tube(0.0115, 0.1, 0.46, -0.012, 0, 16));
  b.add(m.steel, lathe([[0.0115, 0], [0.0125, 0.003], [0.0125, 0.02], [0.009, 0.024], [0.0, 0.025]], 0.46, -0.012, 0, 16));
  b.add(m.steel, slab(roundRect(0.44, -0.024, 0.456, 0.024, 0.004), 0.02, 0, 0.001));
  f.add(m.steel, loop(0.006, 0.0014, 0.475, -0.028, 0));
  let sightHeight = 0.03;
  if (tactical) {
    // Perforated heat shield over the barrel and ghost-ring sights.
    const shield = new THREE.CylinderGeometry(0.0145, 0.0145, 0.26, 16, 1, true, -Math.PI / 2, Math.PI);
    shield.rotateX(-Math.PI / 2);
    shield.translate(0, 0.013, -0.25);
    b.add(m.steel, shield);
    for (let u = 0.13; u < 0.37; u += 0.022) for (const a of [-0.7, 0, 0.7]) f.add(m.dark, block(u, u + 0.012, -0.0025, 0.0025, 0.005).translate(Math.sin(a) * 0.0147, 0.013 + Math.cos(a) * 0.0147, 0));
    sightHeight = rearAperture(b, -0.02, 0.026);
    frontPost(b, 0.5, 0.024, sightHeight);
    // Side saddle on the left of the receiver with four shells.
    b.add(m.alloy, slab(roundRect(-0.045, -0.026, 0.062, 0.018, 0.004), 0.004, -0.017, 0.001));
    for (let i = 0; i < 4; i++) {
      const u = -0.032 + i * 0.024;
      b.add(m.shellHull, vcyl(0.0095, 0.0095, u, -0.02, 0.034, -0.029, 12));
      f.add(m.brass, vcyl(0.0098, 0.0098, u, -0.03, -0.018, -0.029, 12));
    }
    b.add(m.polymer, block(-0.046, 0.064, -0.006, 0.006, 0.006, -0.022));
  }
  // Stock and pistol grip in one piece, sling swivel, checkering on the wrist.
  b.add(
    stockMat,
    slab(
      [[-0.065, 0.002], [-0.2, -0.014], [-0.33, -0.02], [-0.336, -0.125], [-0.3, -0.128], [-0.14, -0.06], [-0.075, -0.066], [-0.068, -0.128], [-0.04, -0.132], [-0.012, -0.062], [-0.008, -0.03], [-0.065, -0.03]],
      0.034,
      0,
      0.005,
    ),
  );
  f.add(m.steel, loop(0.007, 0.0015, -0.27, -0.112, 0));
  for (let i = 0; i < 5; i++) {
    const v = -0.05 - i * 0.012;
    f.add(m.dark, slab([[-0.02 - i * 0.004, v], [-0.058 - i * 0.002, v - 0.004], [-0.058 - i * 0.002, v - 0.006], [-0.02 - i * 0.004, v - 0.002]], 0.0345, 0, 0));
  }
  b.add(m.rubber, block(-0.35, -0.334, -0.128, -0.018, 0.04));
  b.add(m.dark, slab([[0.012, -0.03], [0.018, -0.03], [0.017, -0.041], [0.01, -0.049], [0.008, -0.047], [0.012, -0.038]], 0.006, 0, 0.001));
  b.add(m.steel, block(-0.012, 0.05, -0.052, -0.047, 0.012));
  b.add(m.steel, block(0.044, 0.05, -0.052, -0.03, 0.012));

  const group = b.build('shotgun');
  // Grooved forend on the magazine tube (strokes back when pumped).
  const fb = new PartBuilder();
  fb.add(stockMat, slab(roundRect(0.17, -0.033, 0.32, 0.005, 0.013), 0.046, 0, 0.005));
  for (let u = 0.185; u < 0.31; u += 0.014) for (const x of [-0.0232, 0.0232]) fb.add(m.dark, block(u, u + 0.005, -0.026, -0.002, 0.0015, x));
  for (const x of [-0.011, 0.011]) fb.add(m.steel, block(0.08, 0.17, -0.02, -0.014, 0.003, x)); // action bars
  (fine ? fb : DISCARD).add(m.steel, lathe([[0.0125, 0], [0.0135, 0.002], [0.0135, 0.008], [0.0125, 0.01]], 0.16, -0.012, 0, 14));
  const pump = fb.build('pump');
  group.add(pump);
  return { group, sightHeight, muzzle: new THREE.Vector3(0, 0.013, -0.53), support: [0.245, -0.045], mag: null, pump, slide: null };
}

/** Simple procedural pistol, used when the scanned one is not available. */
function pistol(): GunBuild {
  const m = gunMaterials();
  const b = new PartBuilder();
  b.add(m.polymer, slab([[-0.045, -0.012], [0.12, -0.012], [0.12, -0.022], [0.05, -0.03], [-0.01, -0.03], [-0.045, -0.02]], 0.026, 0, 0.002));
  b.add(m.polymer, slab([[-0.005, -0.028], [-0.012, -0.07], [-0.028, -0.125], [-0.058, -0.12], [-0.045, -0.028]], 0.028, 0, 0.004));
  b.add(m.polymer, block(-0.012, 0.045, -0.05, -0.045, 0.01));
  b.add(m.dark, slab([[0.012, -0.03], [0.017, -0.03], [0.016, -0.04], [0.01, -0.046]], 0.005, 0, 0.001));
  const group = b.build('pistol');
  const sb = new PartBuilder();
  sb.add(m.steel, slab(roundRect(-0.05, -0.012, 0.125, 0.022, 0.004), 0.028, 0, 0.002));
  for (let u = -0.045; u < -0.02; u += 0.005) for (const x of [-0.0142, 0.0142]) sb.add(m.dark, block(u, u + 0.002, -0.004, 0.018, 0.001, x));
  sb.add(m.dark, block(0.113, 0.119, 0.022, 0.03, 0.003));
  for (const x of [-0.0045, 0.0045]) sb.add(m.dark, block(-0.045, -0.038, 0.022, 0.03, 0.004, x));
  const slide = sb.build('slide');
  group.add(slide);
  return { group, sightHeight: 0.029, muzzle: new THREE.Vector3(0, 0.006, -0.135), support: [0, -0.1], mag: null, pump: null, slide };
}

/**
 * Builds the procedural gun for a weapon (every class except the scanned ones).
 * `detail: 'low'` leaves out the small parts (pins, screws, textures cut as
 * geometry): bots carry these baked into their soldier models.
 */
export function buildGun(def: WeaponDef, opts: { detail?: GunDetail } = {}): GunBuild {
  const look = LOOKS[def.id] ?? {};
  const fine = opts.detail !== 'low';
  if (look.frame === 'rifle' || def.class === 'ar') {
    return rifle({
      handguardEnd: look.handguard ?? 0.33,
      barrelEnd: look.barrel ?? 0.4,
      mag: look.mag ?? 'curved',
      optic: look.optic ?? 'reddot',
      color: look.color ?? 0x1c1d1f,
      precision: false,
      look,
      fine,
    });
  }
  switch (def.class) {
    case 'dmr':
    case 'sr':
      return rifle({
        handguardEnd: look.handguard ?? 0.38,
        barrelEnd: look.barrel ?? 0.52,
        mag: look.mag ?? 'straight',
        optic: def.scope ? 'scope' : (look.optic ?? 'reddot'),
        color: look.color ?? 0x8a7658,
        precision: true,
        look,
        fine,
      });
    case 'smg':
      return smg(look.color ?? 0x1c1d1f, look.optic ?? 'holo', look, fine);
    case 'lmg':
      return lmg(look.color ?? 0x4a4f3a, fine);
    case 'sg':
      // SG-2 / SG-3: the tactical build (heat shield, ghost ring, side saddle).
      return shotgun(look.color ?? null, def.id !== 'sg1', fine);
    case 'pistol':
      return pistol();
  }
  throw new Error(`no gun model for ${def.id}`);
}
