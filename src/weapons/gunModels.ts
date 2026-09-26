import * as THREE from 'three';
import type { WeaponDef } from './weaponData';
import { PartBuilder, block, furniture, gunMaterials, lathe, rail, roundRect, slab, tube, type P } from './gunKit';

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

/** Per-weapon look: furniture color and optic. Unlisted ids use their class default. */
const LOOKS: Record<string, { color?: number; optic?: Optic }> = {
  ar1: { color: 0x1c1d1f, optic: 'reddot' },
  ar2: { color: 0x8a7658, optic: 'holo' },
  ar3: { color: 0x3f4632, optic: 'reddot' },
  smg1: { color: 0x1c1d1f, optic: 'holo' },
  smg2: { color: 0x7d6c52, optic: 'reddot' },
  smg3: { color: 0x2b2e33, optic: 'holo' },
  smg4: { color: 0x3f4632, optic: 'reddot' },
  lmg1: { color: 0x4a4f3a },
  lmg2: { color: 0x1c1d1f },
  dmr1: { color: 0x8a7658, optic: 'holo' },
  dmr2: { color: 0x3f4632 },
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
// Shared lower parts

const GRIP: P[] = [
  [-0.004, -0.03],
  [-0.012, -0.07],
  [-0.032, -0.132],
  [-0.06, -0.128],
  [-0.036, -0.028],
];

function addTriggerGroup(b: PartBuilder, guardFront = 0.05): void {
  const m = gunMaterials();
  b.add(m.polymer, slab(GRIP, 0.03, 0, 0.004));
  b.add(m.dark, slab([[0.012, -0.03], [0.018, -0.03], [0.017, -0.041], [0.01, -0.049], [0.008, -0.047], [0.012, -0.038]], 0.006, 0, 0.001));
  // Trigger guard: bottom bar and front post.
  b.add(m.alloy, block(-0.015, guardFront, -0.052, -0.047, 0.012));
  b.add(m.alloy, block(guardFront - 0.006, guardFront, -0.052, -0.03, 0.012));
}

function magazine(kind: 'curved' | 'straight' | 'smg'): THREE.Group {
  const m = gunMaterials();
  const b = new PartBuilder();
  if (kind === 'curved') {
    b.add(m.polymer, slab([[0.058, -0.02], [0.06, -0.08], [0.068, -0.13], [0.082, -0.178], [0.148, -0.178], [0.134, -0.13], [0.124, -0.08], [0.12, -0.02]], 0.022, 0, 0.002));
    b.add(m.dark, slab([[0.08, -0.176], [0.15, -0.176], [0.152, -0.186], [0.079, -0.186]], 0.025, 0, 0.002));
    // Ribs along the body.
    for (const v of [-0.06, -0.1]) b.add(m.dark, slab([[0.062, v], [0.124, v], [0.126, v - 0.004], [0.063, v - 0.004]], 0.0235, 0, 0.0005));
  } else if (kind === 'straight') {
    b.add(m.steel, slab([[0.058, -0.02], [0.062, -0.12], [0.126, -0.12], [0.122, -0.02]], 0.024, 0, 0.0015));
    b.add(m.dark, block(0.06, 0.128, -0.128, -0.12, 0.027));
  } else {
    b.add(m.steel, slab([[0.047, -0.03], [0.052, -0.1], [0.07, -0.168], [0.104, -0.168], [0.09, -0.1], [0.084, -0.03]], 0.02, 0, 0.0015));
    b.add(m.dark, slab([[0.068, -0.166], [0.106, -0.166], [0.108, -0.174], [0.067, -0.174]], 0.023, 0, 0.001));
  }
  return b.build('mag');
}

function flashHider(b: PartBuilder, u0: number, v: number, r = 0.0105): number {
  const m = gunMaterials();
  b.add(m.steel, lathe([[r * 0.8, 0], [r, 0.004], [r * 1.08, 0.008], [r * 1.08, 0.045], [r * 0.85, 0.05], [0.004, 0.05]], u0, v, 0, 20));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.add(m.dark, block(u0 + 0.018, u0 + 0.044, -0.0012, 0.0012, 0.002).translate(Math.cos(a) * r * 1.09, v + Math.sin(a) * r * 1.09, 0));
  }
  return u0 + 0.05;
}

// ---------------------------------------------------------------------------
// Designs

interface RifleOpts {
  handguardEnd: number;
  barrelEnd: number;
  mag: 'curved' | 'straight';
  optic: Optic;
  color: number;
  precision: boolean;
}

/** AR-pattern rifle: carbine or precision (DMR) configuration. */
function rifle(o: RifleOpts): GunBuild {
  const m = gunMaterials();
  const furn = furniture(o.color);
  const b = new PartBuilder();

  // Upper receiver with ejection port, forward assist and charging handle.
  b.add(m.alloy, slab([[-0.08, 0.016], [-0.075, -0.004], [0.135, -0.004], [0.135, 0.026], [-0.075, 0.026]], 0.026, 0, 0.002));
  b.add(m.dark, block(0.0, 0.05, 0.004, 0.018, 0.002, 0.0135));
  b.add(m.alloy, tube(0.006, -0.055, -0.02, 0.014, 0.017, 12));
  b.add(m.alloy, block(-0.092, -0.074, 0.017, 0.025, 0.03));
  // Lower receiver with magwell.
  b.add(m.alloy, slab([[-0.07, -0.004], [0.132, -0.004], [0.132, -0.02], [0.124, -0.06], [0.054, -0.06], [0.05, -0.03], [-0.03, -0.03], [-0.07, -0.02]], 0.024, 0, 0.002));
  addTriggerGroup(b);

  // Buffer tube, castle nut and stock.
  b.add(m.alloy, tube(0.0145, -0.27, -0.07, 0.008, 0, 20));
  b.add(m.steel, lathe([[0.016, 0], [0.018, 0.002], [0.018, 0.008], [0.016, 0.01]], -0.082, 0.008, 0, 16));
  const stock: P[] = o.precision
    ? [[-0.15, 0.03], [-0.3, 0.034], [-0.312, -0.06], [-0.29, -0.066], [-0.22, -0.035], [-0.2, -0.05], [-0.17, -0.05], [-0.15, -0.012]]
    : [[-0.16, 0.026], [-0.305, 0.03], [-0.31, -0.05], [-0.29, -0.058], [-0.2, -0.02], [-0.16, -0.012]];
  b.add(furn, slab(stock, 0.036, 0, 0.004));
  if (o.precision) b.add(furn, slab(roundRect(-0.28, 0.026, -0.19, 0.036, 0.004), 0.03, 0, 0.003)); // cheek riser
  b.add(m.rubber, block(-0.32, -0.305, o.precision ? -0.066 : -0.058, o.precision ? 0.036 : 0.032, 0.04));

  // Free-float octagonal handguard with M-LOK slots, rail on top.
  const hg = new THREE.CylinderGeometry(0.021, 0.021, o.handguardEnd - 0.135, 8, 1);
  hg.rotateY(Math.PI / 8);
  hg.rotateX(-Math.PI / 2);
  hg.translate(0, 0.006, -(0.135 + o.handguardEnd) / 2);
  b.add(furn, hg);
  for (let u = 0.155; u < o.handguardEnd - 0.03; u += 0.045) {
    for (const x of [-0.0198, 0.0198]) b.add(m.dark, block(u, u + 0.03, 0.0, 0.007, 0.002, x));
    b.add(m.dark, block(u, u + 0.03, -0.0138, -0.0132, 0.007));
  }
  const [railGeos, railTop] = rail(-0.075, o.handguardEnd - 0.005, 0.026);
  b.add(m.alloy, railGeos);

  // Barrel, gas block and flash hider.
  b.add(m.steel, tube(0.0085, o.handguardEnd - 0.01, o.barrelEnd, 0.006, 0, 16));
  b.add(m.steel, block(o.handguardEnd + 0.004, o.handguardEnd + 0.022, -0.006, 0.017, 0.02));
  const muzzleU = flashHider(b, o.barrelEnd, 0.006);

  const sightHeight = addOptic(b, o.optic, railTop, 0.02);
  const group = b.build('rifle');
  const mag = magazine(o.mag);
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

function smg(color: number, optic: Optic): GunBuild {
  const m = gunMaterials();
  const furn = furniture(color);
  const b = new PartBuilder();
  // Stamped round-top receiver, cocking tube and handguard.
  b.add(m.steel, slab(roundRect(-0.11, -0.012, 0.17, 0.028, 0.012), 0.032, 0, 0.002));
  b.add(m.dark, block(0.0, 0.045, 0.002, 0.016, 0.002, 0.0162));
  b.add(m.steel, tube(0.0095, 0.16, 0.245, 0.016, 0, 16));
  b.add(furn, slab(roundRect(0.12, -0.045, 0.25, 0.012, 0.014), 0.044, 0, 0.004));
  for (let u = 0.135; u < 0.24; u += 0.018) for (const x of [-0.0225, 0.0225]) b.add(m.dark, block(u, u + 0.008, -0.03, 0.0, 0.0015, x));
  // Lower: trigger housing, magwell.
  b.add(furn, slab([[-0.07, -0.012], [0.04, -0.012], [0.04, -0.03], [-0.035, -0.03], [-0.07, -0.02]], 0.03, 0, 0.003));
  addTriggerGroup(b, 0.04);
  b.add(m.steel, block(0.042, 0.092, -0.042, -0.012, 0.026));
  // Barrel, three-lug muzzle and front sight hood.
  b.add(m.steel, tube(0.0075, 0.24, 0.3, 0.004, 0, 14));
  b.add(m.steel, lathe([[0.0085, 0], [0.0095, 0.002], [0.0095, 0.02], [0.007, 0.022]], 0.28, 0.004, 0, 14));
  // Retractable stock: two rods and a butt plate.
  for (const x of [-0.012, 0.012]) b.add(m.steel, tube(0.0045, -0.29, -0.1, 0.012, x, 10));
  b.add(m.rubber, slab(roundRect(-0.305, -0.05, -0.288, 0.035, 0.008), 0.045, 0, 0.003));
  // Short rail on the claw mount for the optic.
  b.add(m.steel, block(-0.06, 0.09, 0.026, 0.032, 0.02));
  const [railGeos, railTop] = rail(-0.06, 0.09, 0.032);
  b.add(m.alloy, railGeos);
  const sightHeight = addOptic(b, optic, railTop, 0.01);

  const group = b.build('smg');
  // Cocking handle on the left rides with the bolt.
  const slideB = new PartBuilder();
  slideB.add(m.dark, block(0.205, 0.215, 0.012, 0.02, 0.028, -0.018));
  const slide = slideB.build('slide');
  group.add(slide);
  const mag = magazine('smg');
  group.add(mag);
  return { group, sightHeight, muzzle: new THREE.Vector3(0, 0.004, -0.31), support: [0.19, -0.05], mag, pump: null, slide };
}

function lmg(color: number): GunBuild {
  const m = gunMaterials();
  const furn = furniture(color);
  const b = new PartBuilder();
  // Receiver, feed cover and top rail.
  b.add(m.steel, slab(roundRect(-0.13, -0.035, 0.15, 0.03, 0.006), 0.05, 0, 0.003));
  b.add(m.steel, slab([[-0.06, 0.028], [0.1, 0.028], [0.125, 0.036], [0.12, 0.046], [-0.06, 0.046]], 0.046, 0, 0.002));
  b.add(m.dark, block(-0.03, 0.06, -0.01, 0.018, 0.002, 0.0251));
  b.add(m.steel, block(-0.03, 0.06, -0.01, 0.018, 0.002, -0.0251));
  addTriggerGroup(b, 0.045);
  // Skeleton stock.
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
  // Handguard, gas tube, heat shield, barrel.
  b.add(furn, slab(roundRect(0.15, -0.06, 0.3, -0.004, 0.012), 0.05, 0, 0.004));
  b.add(m.steel, tube(0.007, 0.15, 0.37, -0.018, 0, 12));
  b.add(m.steel, tube(0.011, 0.15, 0.53, 0.008, 0, 18));
  const shield = new THREE.CylinderGeometry(0.018, 0.018, 0.17, 18, 1, true, -Math.PI / 2, Math.PI);
  shield.rotateX(-Math.PI / 2);
  shield.translate(0, 0.008, -0.235);
  b.add(m.dark, shield);
  // Carry handle.
  b.add(m.steel, slab([[0.19, 0.02], [0.2, 0.05], [0.28, 0.05], [0.29, 0.02], [0.275, 0.02], [0.268, 0.04], [0.212, 0.04], [0.205, 0.02]], 0.012, 0, 0.002));
  // Folded bipod.
  for (const x of [-0.009, 0.009]) b.add(m.steel, tube(0.004, 0.3, 0.5, -0.032, x, 8));
  b.add(m.steel, block(0.49, 0.51, -0.042, -0.024, 0.03));
  const muzzleU = flashHider(b, 0.53, 0.008, 0.013);
  // Iron sights on the feed cover and at the gas block.
  const vc = rearAperture(b, -0.03, 0.046);
  frontPost(b, 0.36, 0.02, vc);

  const group = b.build('lmg');
  // Ammo box under the left side, with a belt of rounds feeding in (drops on reload).
  const box = new PartBuilder();
  box.add(furn, slab(roundRect(-0.01, -0.15, 0.11, -0.03, 0.008), 0.07, -0.035, 0.004));
  box.add(m.dark, block(0.0, 0.1, -0.03, -0.026, 0.066, -0.035));
  for (let i = 0; i < 4; i++) {
    const g = new THREE.CylinderGeometry(0.0045, 0.0045, 0.05, 8).rotateZ(Math.PI / 2);
    g.translate(-0.034 + i * 0.002, -0.02 + i * 0.012, -(0.045 + i * 0.004));
    box.add(m.brass, g);
  }
  const mag = box.build('mag');
  group.add(mag);
  return { group, sightHeight: vc, muzzle: new THREE.Vector3(0, 0.008, -muzzleU - 0.01), support: [0.22, -0.06], mag, pump: null, slide: null };
}

function shotgun(color: number | null): GunBuild {
  const m = gunMaterials();
  const stockMat = color === null ? m.wood : furniture(color);
  const b = new PartBuilder();
  // Receiver with ejection port.
  b.add(m.steel, slab([[-0.065, -0.03], [0.1, -0.03], [0.1, 0.02], [0.09, 0.026], [-0.03, 0.026], [-0.065, 0.004]], 0.03, 0, 0.004));
  b.add(m.dark, block(0.0, 0.065, 0.0, 0.018, 0.002, 0.0151));
  // Barrel with vent rib and bead, magazine tube, clamp.
  b.add(m.steel, tube(0.0105, 0.1, 0.52, 0.013, 0, 18));
  b.add(m.steel, block(0.1, 0.52, 0.024, 0.027, 0.008));
  for (let u = 0.12; u < 0.51; u += 0.035) b.add(m.steel, block(u, u + 0.006, 0.02, 0.024, 0.005));
  b.add(m.brass, new THREE.SphereGeometry(0.0022, 10, 8).translate(0, 0.03, -0.515));
  b.add(m.steel, tube(0.0115, 0.1, 0.46, -0.012, 0, 16));
  b.add(m.steel, lathe([[0.0115, 0], [0.0125, 0.003], [0.0125, 0.02], [0.009, 0.024], [0.0, 0.025]], 0.46, -0.012, 0, 16));
  b.add(m.steel, slab(roundRect(0.44, -0.024, 0.456, 0.024, 0.004), 0.02, 0, 0.001));
  // Stock and pistol grip in one piece.
  b.add(
    stockMat,
    slab(
      [[-0.065, 0.002], [-0.2, -0.014], [-0.33, -0.02], [-0.336, -0.125], [-0.3, -0.128], [-0.14, -0.06], [-0.075, -0.066], [-0.068, -0.128], [-0.04, -0.132], [-0.012, -0.062], [-0.008, -0.03], [-0.065, -0.03]],
      0.034,
      0,
      0.005,
    ),
  );
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
  const pump = fb.build('pump');
  group.add(pump);
  return { group, sightHeight: 0.03, muzzle: new THREE.Vector3(0, 0.013, -0.53), support: [0.245, -0.045], mag: null, pump, slide: null };
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

/** Builds the procedural gun for a weapon (every class except the scanned ones). */
export function buildGun(def: WeaponDef): GunBuild {
  const look = LOOKS[def.id] ?? {};
  switch (def.class) {
    case 'ar':
      return rifle({ handguardEnd: 0.33, barrelEnd: 0.4, mag: 'curved', optic: look.optic ?? 'reddot', color: look.color ?? 0x1c1d1f, precision: false });
    case 'dmr':
    case 'sr':
      return rifle({
        handguardEnd: 0.38,
        barrelEnd: 0.52,
        mag: 'straight',
        optic: def.scope ? 'scope' : (look.optic ?? 'reddot'),
        color: look.color ?? 0x8a7658,
        precision: true,
      });
    case 'smg':
      return smg(look.color ?? 0x1c1d1f, look.optic ?? 'holo');
    case 'lmg':
      return lmg(look.color ?? 0x4a4f3a);
    case 'sg':
      return shotgun(def.id === 'sg2' ? 0x1c1d1f : null);
    case 'pistol':
      return pistol();
  }
}
