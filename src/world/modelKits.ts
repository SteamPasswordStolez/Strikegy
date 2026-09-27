import * as THREE from 'three';

/**
 * Procedural models for map objects that used to be plain boxes: vehicles,
 * containers, tanks, tents, sandbags, towers and street furniture. Each kit
 * fills the object's box (w x h x d, x = width, z = length, y up from the
 * ground at `base` above the box bottom) and says which surface each piece
 * uses. Colliders stay simple boxes: the object's own box unless a kit gives
 * its own (open structures you can shoot through).
 */
export type ModelKind =
  | 'car'
  | 'truck'
  | 'container'
  | 'boxcar'
  | 'fuelTank'
  | 'tent'
  | 'sandbags'
  | 'hesco'
  | 'watchtower'
  | 'booth'
  | 'pump'
  | 'fountain'
  | 'statue'
  | 'bench'
  | 'logPile'
  | 'hayBale'
  | 'bunker'
  | 'fence';

export const MODEL_KINDS: readonly ModelKind[] = [
  'car',
  'truck',
  'container',
  'boxcar',
  'fuelTank',
  'tent',
  'sandbags',
  'hesco',
  'watchtower',
  'booth',
  'pump',
  'fountain',
  'statue',
  'bench',
  'logPile',
  'hayBale',
  'bunker',
  'fence',
];

/** Surface of a piece: the object's own tinted material, or a shared one. */
export type KitMaterial = 'body' | 'trim' | 'metal' | 'dark' | 'glass' | 'rubber' | 'wood' | 'canvas' | 'concrete' | 'light' | 'redLight' | 'water' | 'dirt' | 'mesh' | 'snow';

export interface KitPiece {
  geo: THREE.BufferGeometry;
  mat: KitMaterial;
}

export interface KitBox {
  /** Local centre (y from the ground) and full size. */
  center: [number, number, number];
  size: [number, number, number];
  /** Radians about +Y. */
  yaw?: number;
}

export interface KitModel {
  pieces: KitPiece[];
  /** Replaces the object's box collider when given. */
  colliders?: KitBox[];
}

type V3 = [number, number, number];

class Builder {
  readonly pieces: KitPiece[] = [];

  /** Box with world-scale UVs (texture meters match the map boxes). */
  box(mat: KitMaterial, size: V3, at: V3, rot: V3 = [0, 0, 0]): void {
    const [w, h, d] = size;
    if (w <= 0 || h <= 0 || d <= 0) return;
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const dims: [number, number][] = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ];
    const per = uv.count / 6;
    for (let f = 0; f < 6; f++) for (let v = 0; v < per; v++) uv.setXY(f * per + v, uv.getX(f * per + v) * dims[f]![0], uv.getY(f * per + v) * dims[f]![1]);
    this.add(mat, g, at, rot);
  }

  /** Cylinder standing on +Y (rot to lay it down). */
  cyl(mat: KitMaterial, rTop: number, rBottom: number, h: number, at: V3, rot: V3 = [0, 0, 0], seg = 16, open = false): void {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const around = Math.PI * (rTop + rBottom);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * h);
    this.add(mat, g, at, rot);
  }

  sphere(mat: KitMaterial, r: number, at: V3, scale: V3 = [1, 1, 1]): void {
    const g = new THREE.SphereGeometry(r, 12, 8);
    g.scale(...scale);
    this.add(mat, g, at);
  }

  /** A side profile (z, y) extruded across x, centred on x = 0. */
  profile(mat: KitMaterial, pts: [number, number][], width: number, at: V3 = [0, 0, 0]): void {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    // Shape x -> world z, extrude z -> world x.
    g.rotateY(-Math.PI / 2);
    g.translate(width / 2, 0, 0);
    this.add(mat, g, at);
  }

  wheel(x: number, y: number, z: number, r: number, width: number): void {
    this.cyl('rubber', r, r, width, [x, y, z], [0, 0, Math.PI / 2], 14);
    this.cyl('metal', r * 0.55, r * 0.55, width + 0.02, [x, y, z], [0, 0, Math.PI / 2], 10);
  }

  private add(mat: KitMaterial, g: THREE.BufferGeometry, at: V3, rot: V3 = [0, 0, 0]): void {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    // Merged batches need the same attribute set everywhere.
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    this.pieces.push({ geo: ng, mat });
  }
}

/** Builds a kit to fill a w x h x d box; `h` counts from the ground up. */
export function buildKit(kind: ModelKind, w: number, h: number, d: number, rand: () => number = Math.random): KitModel {
  const b = new Builder();
  const colliders = KITS[kind](b, w, h, d, rand);
  return { pieces: b.pieces, colliders: colliders ?? undefined };
}

type Kit = (b: Builder, w: number, h: number, d: number, rand: () => number) => KitBox[] | void;

const KITS: Record<ModelKind, Kit> = {
  car(b, w, h, d) {
    const r = 0.33;
    const bodyTop = h * 0.56;
    // Lower body with a lower, rounded-off nose and tail.
    b.profile(
      'body',
      [
        [-d / 2, 0.3],
        [d / 2, 0.3],
        [d / 2, bodyTop - 0.12],
        [d / 2 - 0.25, bodyTop],
        [-d / 2 + 0.2, bodyTop],
        [-d / 2, bodyTop - 0.1],
      ],
      w,
    );
    // Cabin: glass all round, roof panel on top.
    const c0 = -d * 0.28;
    const c1 = d * 0.2;
    const roof = h - 0.05;
    b.profile(
      'glass',
      [
        [c0 - 0.45, bodyTop],
        [c1 + 0.55, bodyTop],
        [c1, roof],
        [c0, roof],
      ],
      w - 0.16,
    );
    b.box('body', [w - 0.14, 0.06, c1 - c0 + 0.1], [0, roof + 0.02, (c0 + c1) / 2]);
    // Pillars between the windows.
    for (const z of [(c0 + c1) / 2]) b.box('body', [w - 0.12, roof - bodyTop, 0.12], [0, (roof + bodyTop) / 2, z]);
    // Bumpers, lights, mirrors.
    b.box('dark', [w + 0.04, 0.16, 0.14], [0, 0.42, d / 2 + 0.02]);
    b.box('dark', [w + 0.04, 0.16, 0.14], [0, 0.42, -d / 2 - 0.02]);
    for (const s of [-1, 1]) {
      b.box('light', [0.32, 0.12, 0.04], [s * (w / 2 - 0.28), bodyTop - 0.2, d / 2 + 0.01]);
      b.box('redLight', [0.3, 0.12, 0.04], [s * (w / 2 - 0.26), bodyTop - 0.18, -d / 2 - 0.01]);
      b.box('body', [0.14, 0.1, 0.18], [s * (w / 2 + 0.05), bodyTop + 0.08, c1 + 0.35]);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.wheel(sx * (w / 2 - 0.13), r, sz * (d / 2 - 0.8), r, 0.24);
    // Dark underside so the wheel wells don't show daylight.
    b.box('dark', [w - 0.3, 0.12, d - 0.4], [0, 0.26, 0]);
  },

  truck(b, w, h, d) {
    const r = 0.5;
    const frame = 1.05;
    // Chassis rails and wheels (single front axle, twin rear).
    b.box('dark', [w * 0.7, 0.25, d - 0.3], [0, frame - 0.15, 0]);
    for (const z of [d / 2 - 1.25, -d / 2 + 1.7, -d / 2 + 0.75]) for (const s of [-1, 1]) b.wheel(s * (w / 2 - 0.2), r, z, r, 0.36);
    // Cab at the front (+z).
    const cabLen = 1.9;
    const cz = d / 2 - cabLen / 2;
    b.box('body', [w, 1.2, cabLen], [0, frame + 0.6, cz]);
    b.profile(
      'body',
      [
        [d / 2 - cabLen, frame + 1.2],
        [d / 2 - 0.55, frame + 1.2],
        [d / 2 - 0.75, h - 0.05],
        [d / 2 - cabLen, h - 0.05],
      ],
      w - 0.1,
    );
    b.box('glass', [w - 0.3, 0.55, 0.05], [0, frame + 1.55, d / 2 - 0.62], [-0.25, 0, 0]);
    for (const s of [-1, 1]) b.box('glass', [0.05, 0.5, 0.7], [s * (w / 2 - 0.04), frame + 1.5, d / 2 - 1.2]);
    b.box('dark', [w - 0.2, 0.5, 0.08], [0, frame + 0.45, d / 2 + 0.01]);
    b.box('dark', [w + 0.1, 0.2, 0.2], [0, frame - 0.05, d / 2 + 0.05]);
    for (const s of [-1, 1]) b.box('light', [0.2, 0.2, 0.05], [s * (w / 2 - 0.3), frame + 0.35, d / 2 + 0.04]);
    // Cargo bed with a canvas cover on hoops.
    const bedLen = d - cabLen - 0.25;
    const bz = -d / 2 + bedLen / 2;
    b.box('body', [w, 0.15, bedLen], [0, frame + 0.08, bz]);
    for (const s of [-1, 1]) b.box('body', [0.08, 0.6, bedLen], [s * (w / 2 - 0.04), frame + 0.45, bz]);
    b.box('body', [w, 0.6, 0.08], [0, frame + 0.45, -d / 2 + 0.04]);
    const cover = h - frame - 0.75;
    b.box('canvas', [w - 0.02, cover * 0.45, bedLen], [0, frame + 0.75 + (cover * 0.45) / 2, bz]);
    b.cyl('canvas', w / 2 - 0.01, w / 2 - 0.01, bedLen, [0, frame + 0.75 + cover * 0.45, bz], [Math.PI / 2, 0, 0], 16, false);
  },

  container(b, w, h, d) {
    b.box('body', [w - 0.08, h - 0.02, d - 0.08], [0, h / 2, 0]);
    // Corrugated long sides and roof ribs.
    for (let z = -d / 2 + 0.3; z < d / 2 - 0.2; z += 0.3) {
      for (const s of [-1, 1]) b.box('body', [0.06, h - 0.3, 0.1], [s * (w / 2 - 0.02), h / 2, z]);
    }
    // Corner posts and rails.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.box('trim', [0.16, h, 0.16], [sx * (w / 2 - 0.06), h / 2, sz * (d / 2 - 0.06)]);
      b.box('trim', [0.14, 0.14, d], [sx * (w / 2 - 0.05), h - 0.07, 0]);
      b.box('trim', [0.14, 0.14, d], [sx * (w / 2 - 0.05), 0.07, 0]);
    }
    // Door end: two leaves and locking bars.
    b.box('trim', [w - 0.1, h - 0.2, 0.04], [0, h / 2, d / 2 - 0.02]);
    b.box('dark', [0.03, h - 0.3, 0.05], [0, h / 2, d / 2]);
    for (const x of [-0.8, -0.35, 0.35, 0.8]) b.box('metal', [0.04, h - 0.35, 0.05], [x * (w / 2.44), h / 2, d / 2 + 0.03]);
  },

  boxcar(b, w, h, d) {
    const floor = 1.15;
    // Bogies: frames and four wheels each.
    for (const z of [-d / 2 + 2, d / 2 - 2]) {
      b.box('dark', [w * 0.75, 0.35, 2.4], [0, 0.55, z]);
      for (const dz of [-0.8, 0.8]) for (const s of [-1, 1]) b.cyl('dark', 0.42, 0.42, 0.12, [s * 0.72, 0.42, z + dz], [0, 0, Math.PI / 2], 14);
    }
    b.box('dark', [w * 0.9, 0.3, d], [0, floor - 0.15, 0]);
    for (const s of [-1, 1]) b.box('dark', [0.3, 0.3, 0.2], [s * 0.7, floor - 0.2, s * (d / 2 + 0.1)]);
    // Body with vertical ribs, a sliding door each side and a curved roof.
    const bh = h - floor - 0.25;
    b.box('body', [w, bh, d], [0, floor + bh / 2, 0]);
    for (let z = -d / 2 + 0.6; z < d / 2 - 0.4; z += 1.2) for (const s of [-1, 1]) b.box('trim', [0.05, bh, 0.12], [s * (w / 2 + 0.02), floor + bh / 2, z]);
    for (const s of [-1, 1]) {
      b.box('trim', [0.06, bh - 0.3, 2.4], [s * (w / 2 + 0.04), floor + bh / 2, 0.8]);
      b.box('metal', [0.05, 0.08, 5], [s * (w / 2 + 0.07), floor + bh - 0.1, 0.8]);
    }
    const roof = b.pieces.length;
    b.cyl('trim', w / 2 + 0.05, w / 2 + 0.05, d + 0.1, [0, floor + bh - 0.9, 0], [Math.PI / 2, 0, 0], 20);
    // Flatten the roof cylinder into a shallow arch.
    const g = b.pieces[roof]!.geo;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const top = floor + bh;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setY(i, Math.max(top - 0.02, top + (y - (floor + bh - 0.9)) * 0.28));
    }
    g.computeVertexNormals();
  },

  fuelTank(b, w, h, d) {
    const r = Math.min(w, d) / 2 - 0.3;
    const pad = 0.3;
    b.box('concrete', [w, pad, d], [0, pad / 2, 0]);
    b.cyl('body', r, r, h - pad - 0.5, [0, pad + (h - pad - 0.5) / 2, 0], [0, 0, 0], 28);
    b.cyl('body', r * 0.25, r, 0.5, [0, h - 0.25, 0], [0, 0, 0], 28);
    for (const y of [pad + 0.8, pad + (h - pad) * 0.5, h - 0.8]) b.cyl('trim', r + 0.04, r + 0.04, 0.12, [0, y, 0], [0, 0, 0], 28, true);
    // Ladder up the side, a hand rail at the top, pipework at the foot.
    const lx = r + 0.2;
    for (const s of [-1, 1]) b.box('metal', [0.05, h - pad, 0.05], [lx, pad + (h - pad) / 2, s * 0.22]);
    for (let y = pad + 0.3; y < h - 0.2; y += 0.35) b.box('metal', [0.04, 0.04, 0.44], [lx, y, 0]);
    b.cyl('metal', r * 0.5, r * 0.5, 0.9, [0, h + 0.4, 0], [0, 0, 0], 16, true);
    b.cyl('dark', 0.12, 0.12, w / 2, [0, pad + 0.35, -w / 4 - r * 0.3], [Math.PI / 2, 0, 0], 8);
    b.box('dark', [0.4, 0.4, 0.4], [0, pad + 0.35, -d / 2 + 0.4]);
    // Round-ish collider: two squares, one turned 45 degrees.
    const side = 2 * r * 0.95;
    return [
      { center: [0, h / 2, 0], size: [side, h, side] },
      { center: [0, h / 2, 0], size: [side, h, side], yaw: Math.PI / 4 },
    ];
  },

  tent(b, w, h, d) {
    // Ridge tent: ridge along the long side, low walls, sloping roof.
    const alongX = w >= d;
    const L = alongX ? w : d;
    const S = alongX ? d : w;
    const wall = 0.9;
    const pts: [number, number][] = [
      [-S / 2, 0],
      [S / 2, 0],
      [S / 2, wall],
      [0, h - 0.05],
      [-S / 2, wall],
    ];
    const tent = new Builder();
    tent.profile('canvas', pts, L);
    // Door flap (darker) and guy ropes' stakes.
    tent.box('dark', [0.04, h * 0.6, S * 0.35], [L / 2 + 0.01, h * 0.3, 0]);
    for (const s of [-1, 1]) for (const e of [-1, 1]) tent.box('wood', [0.05, 0.3, 0.05], [e * (L / 2 - 0.3), 0.1, s * (S / 2 + 0.6)]);
    tent.box('wood', [L + 0.2, 0.08, 0.08], [0, h - 0.02, 0]);
    for (const p of tent.pieces) {
      // The profile runs across local z; turn it when the tent is longer along z.
      if (!alongX) p.geo.rotateY(Math.PI / 2);
      b.pieces.push(p);
    }
    const lower: KitBox = { center: [0, wall / 2, 0], size: alongX ? [L, wall, S] : [S, wall, L] };
    const upper: KitBox = { center: [0, wall + (h - wall) / 4, 0], size: alongX ? [L, (h - wall) / 2, S * 0.55] : [S * 0.55, (h - wall) / 2, L] };
    return [lower, upper];
  },

  sandbags(b, w, h, d, rand) {
    // Staggered courses of plump bags along the long side.
    const alongX = w >= d;
    const L = alongX ? w : d;
    const T = alongX ? d : w;
    const bagL = 0.55;
    const bagH = 0.17;
    const rows = Math.max(1, Math.round(h / bagH));
    for (let r = 0; r < rows; r++) {
      const shift = r % 2 ? bagL / 2 : 0;
      const layers = T > 0.7 && r < rows - 1 ? 2 : 1;
      for (let k = 0; k < layers; k++) {
        const tz = layers === 2 ? (k - 0.5) * (T / 2) : 0;
        for (let x = -L / 2 + bagL / 2 - shift; x < L / 2 - bagL * 0.3; x += bagL) {
          const cx = Math.max(-L / 2 + bagL / 2, Math.min(L / 2 - bagL / 2, x));
          const jitter = (rand() - 0.5) * 0.04;
          const at: V3 = alongX ? [cx, bagH * (r + 0.5), tz + jitter] : [tz + jitter, bagH * (r + 0.5), cx];
          const g = new THREE.CapsuleGeometry(bagH * 0.55, bagL - bagH * 1.1, 2, 6);
          g.rotateZ(Math.PI / 2);
          // Slightly taller than a course so the rows sit on each other with no gaps.
          g.scale(1, 0.95, (layers === 2 ? T / 2 : T) / (bagH * 1.1));
          if (!alongX) g.rotateY(Math.PI / 2);
          g.translate(...at);
          b.pieces.push({ geo: g.toNonIndexed(), mat: 'body' });
          g.dispose();
        }
      }
    }
  },

  hesco(b, w, h, d) {
    // Wire-mesh baskets filled with earth, in 1 m cells.
    const alongX = w >= d;
    const L = alongX ? w : d;
    const T = alongX ? d : w;
    const cells = Math.max(1, Math.round(L / 1.05));
    const cl = L / cells;
    for (let i = 0; i < cells; i++) {
      const c = -L / 2 + cl * (i + 0.5);
      const at: V3 = alongX ? [c, h / 2, 0] : [0, h / 2, c];
      b.box('dirt', alongX ? [cl - 0.04, h - 0.02, T - 0.04] : [T - 0.04, h - 0.02, cl - 0.04], at);
      // Frame: posts at the cell corners and top rims.
      for (const s of [-1, 1]) {
        const post: V3 = alongX ? [c - cl / 2 + 0.02, h / 2, (s * T) / 2] : [(s * T) / 2, h / 2, c - cl / 2 + 0.02];
        b.box('mesh', [0.04, h, 0.04], post);
        b.box('mesh', alongX ? [cl, 0.04, 0.04] : [0.04, 0.04, cl], alongX ? [c, h, (s * T) / 2] : [(s * T) / 2, h, c]);
        b.box('mesh', alongX ? [cl, 0.03, 0.03] : [0.03, 0.03, cl], alongX ? [c, h / 2, (s * T) / 2 + s * 0.01] : [(s * T) / 2 + s * 0.01, h / 2, c]);
      }
    }
  },

  watchtower(b, w, h, d) {
    const deck = h - 2.3;
    const leg = 0.2;
    const inset = 0.15;
    const lx = w / 2 - inset;
    const lz = d / 2 - inset;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', [leg, h - 0.2, leg], [sx * lx, (h - 0.2) / 2, sz * lz]);
    // X braces on each side, below the deck.
    const braceH = deck - 0.4;
    for (const s of [-1, 1]) {
      const ang = Math.atan2(2 * lx, braceH);
      for (const t of [-1, 1]) {
        b.box('wood', [0.1, Math.hypot(2 * lx, braceH), 0.08], [0, braceH / 2 + 0.3, s * lz], [0, 0, t * ang]);
        b.box('wood', [0.08, Math.hypot(2 * lz, braceH), 0.1], [s * lx, braceH / 2 + 0.3, 0], [t * ang, 0, 0]);
      }
    }
    // Deck, plank half-walls with a firing gap, roof on the legs.
    b.box('wood', [w + 0.2, 0.16, d + 0.2], [0, deck, 0]);
    const wallH = 1.05;
    for (const s of [-1, 1]) {
      b.box('wood', [w + 0.2, wallH, 0.08], [0, deck + wallH / 2, s * (d / 2 + 0.06)]);
      b.box('wood', [0.08, wallH, d + 0.2], [s * (w / 2 + 0.06), deck + wallH / 2, 0]);
    }
    b.box('trim', [w + 0.9, 0.12, d + 0.9], [0, h - 0.1, 0]);
    b.box('trim', [w * 0.6, 0.35, d * 0.6], [0, h + 0.05, 0]);
    // Ladder.
    for (const s of [-1, 1]) b.box('wood', [0.06, deck, 0.06], [s * 0.25, deck / 2, d / 2 + 0.35]);
    for (let y = 0.35; y < deck; y += 0.35) b.box('wood', [0.5, 0.05, 0.05], [0, y, d / 2 + 0.35]);
    const cols: KitBox[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cols.push({ center: [sx * lx, h / 2, sz * lz], size: [leg, h, leg] });
    cols.push({ center: [0, deck, 0], size: [w + 0.2, 0.2, d + 0.2] });
    for (const s of [-1, 1]) {
      cols.push({ center: [0, deck + wallH / 2, s * (d / 2 + 0.06)], size: [w + 0.2, wallH, 0.1] });
      cols.push({ center: [s * (w / 2 + 0.06), deck + wallH / 2, 0], size: [0.1, wallH, d + 0.2] });
    }
    cols.push({ center: [0, h - 0.1, 0], size: [w + 0.9, 0.15, d + 0.9] });
    return cols;
  },

  booth(b, w, h, d) {
    const sill = 1;
    const top = h - 0.35;
    b.box('body', [w, sill, d], [0, sill / 2, 0]);
    // Window band on all sides, corner posts, door on one side.
    b.box('glass', [w - 0.1, top - sill, d - 0.1], [0, (sill + top) / 2, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('body', [0.14, top - sill, 0.14], [sx * (w / 2 - 0.07), (sill + top) / 2, sz * (d / 2 - 0.07)]);
    b.box('trim', [0.9, top - 0.05, 0.06], [0.3, top / 2, d / 2 + 0.01]);
    b.box('body', [w, 0.12, d], [0, top + 0.06, 0]);
    b.box('trim', [w + 0.5, 0.12, d + 0.5], [0, h - 0.1, 0]);
    // Barrier arm beside it.
    b.box('dark', [0.25, 1, 0.25], [w / 2 + 0.4, 0.5, 0]);
    b.box('redLight', [0.1, 0.1, 3.2], [w / 2 + 0.4, 0.95, -1.6]);
  },

  pump(b, w, h, d) {
    b.box('concrete', [w + 0.3, 0.15, d + 0.5], [0, 0.075, 0]);
    b.box('body', [w, h * 0.6, d], [0, 0.15 + (h * 0.6) / 2, 0]);
    b.box('trim', [w * 0.9, h * 0.25, d * 0.8], [0, 0.15 + h * 0.6 + (h * 0.25) / 2, 0]);
    for (const s of [-1, 1]) {
      b.box('dark', [w * 0.6, h * 0.14, 0.02], [0, 0.15 + h * 0.72, s * (d / 2 + 0.01)]);
      b.box('dark', [0.1, 0.25, 0.12], [s * (w / 2 + 0.05), 0.15 + h * 0.45, 0]);
      b.cyl('rubber', 0.025, 0.025, h * 0.5, [s * (w / 2 + 0.1), 0.15 + h * 0.25, 0.1], [0.3, 0, 0], 6);
    }
    b.box('light', [w * 0.95, 0.12, d * 0.85], [0, h - 0.06, 0]);
  },

  fountain(b, w, h, d) {
    const r = Math.min(w, d) / 2;
    b.cyl('concrete', r, r + 0.05, h, [0, h / 2, 0], [0, 0, 0], 8);
    b.cyl('water', r - 0.22, r - 0.22, 0.05, [0, h - 0.12, 0], [0, 0, 0], 8);
    b.cyl('trim', r + 0.08, r + 0.08, 0.12, [0, h + 0.02, 0], [0, 0, 0], 8, true);
    const side = 2 * r * 0.93;
    return [
      { center: [0, h / 2, 0], size: [side, h, side] },
      { center: [0, h / 2, 0], size: [side, h, side], yaw: Math.PI / 4 },
    ];
  },

  statue(b, w, h, d) {
    // Pedestal and a soldier with a raised arm.
    const ped = h * 0.45;
    b.box('trim', [w + 0.2, 0.2, d + 0.2], [0, 0.1, 0]);
    b.box('concrete', [w, ped, d], [0, ped / 2 + 0.1, 0]);
    const s = (h - ped) / 1.9;
    const y0 = ped + 0.2;
    for (const x of [-0.11, 0.11]) b.cyl('dark', 0.07 * s, 0.08 * s, 0.85 * s, [x * s, y0 + 0.42 * s, 0], [0, 0, 0], 8);
    b.cyl('dark', 0.16 * s, 0.13 * s, 0.65 * s, [0, y0 + 1.15 * s, 0], [0, 0, 0], 10);
    b.sphere('dark', 0.11 * s, [0, y0 + 1.6 * s, 0]);
    b.cyl('dark', 0.05 * s, 0.05 * s, 0.6 * s, [0.2 * s, y0 + 1.1 * s, 0], [0, 0, 0.15], 6);
    b.cyl('dark', 0.05 * s, 0.05 * s, 0.65 * s, [-0.28 * s, y0 + 1.62 * s, 0], [0, 0, 0.55], 6);
  },

  bench(b, w, h, d) {
    const alongX = w >= d;
    const L = alongX ? w : d;
    const T = alongX ? d : w;
    const seat = h * 0.55;
    const pieces = new Builder();
    for (let i = 0; i < 3; i++) pieces.box('wood', [L, 0.04, T * 0.26], [0, seat, -T / 2 + T * 0.16 + i * T * 0.3]);
    for (let i = 0; i < 2; i++) pieces.box('wood', [L, T * 0.2, 0.04], [0, seat + 0.18 + i * 0.16, -T / 2 + 0.02], [-0.2, 0, 0]);
    for (const s of [-1, 1]) {
      pieces.box('dark', [0.06, seat, T * 0.8], [s * (L / 2 - 0.15), seat / 2, 0]);
      pieces.box('dark', [0.06, h - seat, 0.06], [s * (L / 2 - 0.15), seat + (h - seat) / 2, -T / 2 + 0.03]);
    }
    for (const p of pieces.pieces) {
      if (!alongX) p.geo.rotateY(Math.PI / 2);
      b.pieces.push(p);
    }
  },

  logPile(b, w, h, d, rand) {
    // Felled trunks stacked in a pyramid along the long side, cut ends showing.
    const alongX = w >= d;
    const L = alongX ? w : d;
    const T = alongX ? d : w;
    const r = Math.min(0.32, h / 5);
    const layers = Math.max(1, Math.floor(h / (r * 1.75)));
    const logs = new Builder();
    for (let k = 0; k < layers; k++) {
      const n = Math.max(1, Math.floor(T / (2 * r)) - k);
      for (let i = 0; i < n; i++) {
        const z = -((n - 1) * r) + i * 2 * r;
        const y = r + k * r * 1.72;
        const rr = r * (0.85 + rand() * 0.2);
        const len = L - rand() * 0.4;
        const off = (rand() - 0.5) * 0.3;
        logs.cyl('body', rr, rr, len, [off, y, z], [0, 0, Math.PI / 2], 9);
        for (const s of [-1, 1]) logs.cyl('trim', rr * 0.92, rr * 0.92, 0.02, [off + (s * len) / 2, y, z], [0, 0, Math.PI / 2], 9);
      }
    }
    // Stakes holding the bottom row.
    for (const s of [-1, 1]) for (const e of [-1, 1]) logs.box('wood', [0.1, h * 0.8, 0.1], [e * (L / 2 - 0.5), h * 0.4, s * (T / 2 + 0.05)]);
    for (const p of logs.pieces) {
      if (!alongX) p.geo.rotateY(Math.PI / 2);
      b.pieces.push(p);
    }
  },

  hayBale(b, w, h, d) {
    // Round bales lying on their side, rolled along the long side.
    const alongX = w >= d;
    const L = alongX ? w : d;
    const r = Math.min(h / 2, (alongX ? d : w) / 2);
    const len = Math.min(1.3, L);
    const n = Math.max(1, Math.floor(L / len));
    const bales = new Builder();
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + (L / n) * (i + 0.5);
      bales.cyl('body', r, r, (L / n) * 0.95, [x, r, 0], [0, 0, Math.PI / 2], 16);
      // Wrap bands.
      for (const s of [-0.25, 0.25]) bales.cyl('trim', r + 0.01, r + 0.01, 0.06, [x + (s * L) / n, r, 0], [0, 0, Math.PI / 2], 16, true);
      bales.box('snow', [(L / n) * 0.8, 0.08, r * 0.9], [x, r * 2 - 0.02, 0]);
    }
    for (const p of bales.pieces) {
      if (!alongX) p.geo.rotateY(Math.PI / 2);
      b.pieces.push(p);
    }
  },

  bunker(b, w, h, d) {
    // Concrete pillbox: firing slit across the front (-z), door at the back
    // (+z, right side), thick roof slab with snow on it. Enterable.
    const t = 0.5;
    const roof = 0.6;
    const inner = h - roof;
    const slit0 = 1.15;
    const slit1 = 1.55;
    const door = 1.3;
    const cols: KitBox[] = [];
    const wall = (size: V3, at: V3) => {
      b.box('body', size, at);
      cols.push({ center: at, size });
    };
    // Front: below and above the slit, with pillars at the ends.
    wall([w, slit0, t], [0, slit0 / 2, -d / 2 + t / 2]);
    wall([w, inner - slit1, t], [0, (slit1 + inner) / 2, -d / 2 + t / 2]);
    for (const s of [-1, 1]) wall([0.6, slit1 - slit0, t], [s * (w / 2 - 0.3), (slit0 + slit1) / 2, -d / 2 + t / 2]);
    // Sides.
    for (const s of [-1, 1]) wall([t, inner, d - 2 * t], [s * (w / 2 - t / 2), inner / 2, 0]);
    // Back with a door opening on the right.
    const doorX = w / 2 - t - 0.3 - door / 2;
    const leftLen = doorX - door / 2 + w / 2;
    wall([leftLen, inner, t], [-w / 2 + leftLen / 2, inner / 2, d / 2 - t / 2]);
    const rightLen = w / 2 - (doorX + door / 2);
    wall([rightLen, inner, t], [w / 2 - rightLen / 2, inner / 2, d / 2 - t / 2]);
    wall([door, inner - 2.2, t], [doorX, (2.2 + inner) / 2, d / 2 - t / 2]);
    // Roof slab overhanging the slit, and snow on top.
    wall([w + 0.4, roof, d + 0.6], [0, inner + roof / 2, -0.1]);
    b.box('trim', [w + 0.5, 0.15, 0.3], [0, slit1 + 0.05, -d / 2 - 0.1]);
    b.box('snow', [w + 0.2, 0.12, d + 0.4], [0, h + 0.04, -0.1]);
    // Floor inside (darker).
    b.box('trim', [w - 2 * t, 0.05, d - 2 * t], [0, 0.03, 0]);
    return cols;
  },

  fence(b, w, h, d) {
    // Split-rail farm fence: posts every ~2.2 m and two rails.
    const alongX = w >= d;
    const L = alongX ? w : d;
    const n = Math.max(1, Math.round(L / 2.2));
    const parts = new Builder();
    for (let i = 0; i <= n; i++) parts.box('wood', [0.12, h, 0.12], [-L / 2 + (L / n) * i, h / 2, 0]);
    for (const y of [h * 0.45, h * 0.85]) parts.box('wood', [L, 0.08, 0.06], [0, y, 0.07]);
    parts.box('snow', [L, 0.04, 0.08], [0, h * 0.85 + 0.06, 0.07]);
    for (const p of parts.pieces) {
      if (!alongX) p.geo.rotateY(Math.PI / 2);
      b.pieces.push(p);
    }
    return [{ center: [0, h / 2, 0], size: alongX ? [L, h, 0.2] : [0.2, h, L] }];
  },
};

/** Shared looks for kit pieces that don't use the object's own surface. */
export function kitMaterials(): Record<Exclude<KitMaterial, 'body' | 'trim' | 'metal' | 'wood' | 'concrete' | 'dirt'>, THREE.Material> {
  return {
    dark: new THREE.MeshStandardMaterial({ color: 0x1d1f1f, roughness: 0.7, metalness: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1b2429, roughness: 0.12, metalness: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }),
    canvas: new THREE.MeshStandardMaterial({ color: 0x5f6146, roughness: 0.95 }),
    light: new THREE.MeshStandardMaterial({ color: 0xe8e4d0, emissive: 0x3a382c, roughness: 0.3 }),
    redLight: new THREE.MeshStandardMaterial({ color: 0x9a1c16, emissive: 0x2a0503, roughness: 0.4 }),
    water: new THREE.MeshStandardMaterial({ color: 0x2c4550, roughness: 0.05, metalness: 0.2 }),
    mesh: new THREE.MeshStandardMaterial({ color: 0x6b6c63, roughness: 0.6, metalness: 0.6 }),
    snow: new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.85 }),
  };
}
