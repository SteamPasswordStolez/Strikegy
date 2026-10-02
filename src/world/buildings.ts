import * as THREE from 'three';
import { makeRng } from '@/render/noise';
import type { BuildingDef, BuildingStyle, MapObject, SurfaceMaterial } from './mapTypes';
import {
  BAY,
  GROUND_TOP,
  PLINTH,
  ROOF_SNOW,
  SLAB,
  STAIR_W,
  WALL,
  WINDOW_STANDOFF,
  mergeSpans,
  prismGeo,
  frustumGeo,
  shade,
  sideBox,
  sideFrames,
  sidePoint,
  type BoxFn,
  type Ctx,
  type Opening,
  type SideFrame,
  type Stair,
} from './buildingParts';
import { depotExtras, factoryExtras, gasShopExtras, hospitalExtras, hotelExtras, innExtras, millExtras, officeExtras, towerExtras } from './buildingExtras';

/**
 * Turns a BuildingDef into blockout boxes: outer walls split into bays with
 * door / window openings (window columns line up from floor to floor), floor
 * slabs with a stairwell opening and a ramp between floors, rooms off a
 * corridor in big buildings, and a roof. All boxes are in world space.
 */

type RoofKind = 'flat' | 'parapet' | 'pitched' | 'mansard';

interface StyleSpec {
  floors: number;
  /** Floor-to-floor height. */
  storey: number;
  material: SurfaceMaterial;
  colors: string[];
  /** Chance a bay column gets windows. */
  windows: number;
  /** Door / window openings (width, height, sill). */
  door: [number, number];
  window: [number, number, number];
  roof: RoofKind;
  /** Pitched roofs: rise over half the span (default 0.6). */
  pitch?: number;
  /** 'rooms' (default): rooms off a corridor once the building is big; 'hall': one open space. */
  interior?: 'rooms' | 'hall';
  /** Rooms whatever the size (landmarks, blocks of flats and offices). */
  rooms?: boolean;
  /** Room widths in bays, picked at random. */
  roomBays?: number[];
  /** Corridor width (m). */
  corridor?: number;
  /** Ground-floor windows when they differ (shop fronts). */
  groundWindow?: [number, number, number];
  /** Round off the tops of tall openings (stepped arch). */
  arch?: boolean;
  /** Style details: facade trim, signs, roof clutter, hall fittings. */
  extras?: (c: Ctx) => void;
}

const STYLES: Record<BuildingStyle, StyleSpec> = {
  house: { floors: 2, storey: 3, material: 'brick', colors: ['#b9a58f', '#c9b9a0', '#a8836a', '#d2c7b2'], windows: 0.55, door: [1.1, 2.2], window: [1.1, 1.2, 1], roof: 'pitched' },
  shop: { floors: 2, storey: 3.3, material: 'concrete', colors: ['#c8c0b0', '#b7b1a3', '#d6ccb8'], windows: 0.7, door: [1.4, 2.3], window: [1.6, 1.5, 0.7], roof: 'parapet' },
  apartment: { floors: 3, storey: 3, material: 'concrete', colors: ['#bdb6a8', '#a9a397', '#c7bfae'], windows: 0.65, door: [1.2, 2.2], window: [1.2, 1.2, 1], roof: 'parapet' },
  townhall: { floors: 2, storey: 4, material: 'brick', colors: ['#b58e74', '#a67f67'], windows: 0.8, door: [2.2, 2.8], window: [1.3, 2, 0.9], roof: 'parapet', roomBays: [2, 3] },
  warehouse: { floors: 1, storey: 6.5, material: 'metal', colors: ['#8e9296', '#7f8a7a', '#9b8f7a'], windows: 0.15, door: [4, 4], window: [2, 1, 3.8], roof: 'flat', interior: 'hall' },
  barracks: { floors: 1, storey: 3.4, material: 'wood', colors: ['#7a7a60', '#6f735a'], windows: 0.75, door: [1.2, 2.2], window: [1.1, 1.1, 1], roof: 'pitched', roomBays: [2, 3] },
  hangar: { floors: 1, storey: 9, material: 'metal', colors: ['#6d7266', '#767a70'], windows: 0.1, door: [11, 7], window: [2, 1, 5.5], roof: 'flat', interior: 'hall' },
  hq: { floors: 2, storey: 3.4, material: 'concrete', colors: ['#8d9078', '#9a9a86'], windows: 0.5, door: [1.6, 2.3], window: [1.2, 1, 1.1], roof: 'parapet' },
  station: { floors: 1, storey: 4.5, material: 'brick', colors: ['#a4735a', '#b08268'], windows: 0.6, door: [1.8, 2.8], window: [1.3, 1.8, 1], roof: 'pitched', interior: 'hall' },
  shed: { floors: 1, storey: 3, material: 'wood', colors: ['#7b6246', '#6d5a44'], windows: 0.3, door: [1.4, 2.2], window: [0.9, 0.8, 1.2], roof: 'pitched', interior: 'hall' },
  // Tall timber barn: wide cart doors, a few high windows.
  barn: { floors: 1, storey: 6.5, material: 'wood', colors: ['#7a3b2e', '#6e3328', '#5f4a38'], windows: 0.25, door: [4, 4.4], window: [1, 1, 4.4], roof: 'pitched', interior: 'hall' },
  // Stone nave: high narrow round-topped windows, a tall door (the steeple is a separate model).
  chapel: { floors: 1, storey: 6, material: 'brick', colors: ['#9a9184', '#8f887c', '#a39a8c'], windows: 0.75, door: [1.8, 3.2], window: [1.1, 2.6, 1.8], roof: 'pitched', interior: 'hall', arch: true },
  // Five-storey block of flats: a window in nearly every bay, balconies, a lift house on the roof.
  tower: { floors: 5, storey: 3, material: 'concrete', colors: ['#b8b2a6', '#a7a59c', '#c4bcae', '#9fa3a0'], windows: 0.85, door: [1.4, 2.3], window: [1.3, 1.3, 0.95], roof: 'parapet', rooms: true, roomBays: [2, 2, 3], extras: towerExtras },
  // Industrial hall: one tall floor, wide doors, high round-topped windows, columns and an office mezzanine.
  factory: { floors: 1, storey: 9, material: 'brick', colors: ['#9a6450', '#8b5a48', '#7f6f62'], windows: 0.7, door: [5, 5], window: [2.2, 2.4, 5.2], roof: 'flat', interior: 'hall', arch: true, extras: factoryExtras },
  // Office block: ribbon windows between dark spandrel bands.
  office: { floors: 3, storey: 3.4, material: 'concrete', colors: ['#c3c0b8', '#aeb2b0', '#cfc8ba'], windows: 0.95, door: [1.8, 2.4], window: [2.2, 1.6, 0.9], roof: 'parapet', rooms: true, roomBays: [2, 3], extras: officeExtras },
  // Gas-station kiosk: shop windows nearly all round, a deep fascia.
  gasShop: { floors: 1, storey: 3.4, material: 'concrete', colors: ['#d8d4cc', '#c9c6be'], windows: 0.9, door: [1.6, 2.3], window: [2.2, 1.7, 0.6], roof: 'parapet', extras: gasShopExtras },
  // Iron Gate landmark: five floors of wards off a long corridor, an entrance canopy, a helipad.
  hospital: { floors: 5, storey: 3.4, material: 'concrete', colors: ['#d6d2c6', '#cdc9bf', '#c8cbc6'], windows: 0.9, door: [2.4, 2.6], window: [1.7, 1.4, 0.9], roof: 'parapet', rooms: true, roomBays: [2, 2, 3], corridor: 2.6, extras: hospitalExtras },
  // Village inn: brick ground floor, timber-framed upper floor under a steep roof.
  inn: { floors: 2, storey: 3.1, material: 'brick', colors: ['#b49a7c', '#a88a6c', '#c2ab8c'], windows: 0.65, door: [1.4, 2.3], window: [1.1, 1.3, 0.95], roof: 'pitched', pitch: 1.05, extras: innExtras },
  // Stone watermill house (the wheel is the millWheel kit beside it).
  mill: { floors: 2, storey: 3.3, material: 'brick', colors: ['#9b9286', '#8d877d', '#a69d90'], windows: 0.5, door: [1.6, 2.4], window: [1, 1.1, 1.1], roof: 'pitched', pitch: 0.85, arch: true, extras: millExtras },
  // Engine shed: one tall brick hall, big arched doors on the short ends for the tracks.
  depot: { floors: 1, storey: 7.5, material: 'brick', colors: ['#94604c', '#a06a52', '#87594a'], windows: 0.75, door: [5, 6], window: [1.6, 2.6, 3.4], roof: 'pitched', pitch: 0.5, interior: 'hall', arch: true, extras: depotExtras },
  // Ardennes landmark: four stone floors of rooms under a mansard roof with dormers.
  hotel: { floors: 4, storey: 3.4, material: 'brick', colors: ['#b3ab9c', '#a8a091', '#bdb3a2'], windows: 0.9, door: [2.4, 2.8], window: [1.3, 1.8, 0.9], roof: 'mansard', rooms: true, roomBays: [1, 2, 2], extras: hotelExtras },
};

/** A map naming a style this build doesn't know (newer map JSON): warn once, build a house. */
const warnedStyles = new Set<string>();
function styleSpec(style: string | undefined): StyleSpec {
  const spec = STYLES[(style ?? 'house') as BuildingStyle];
  if (spec) return spec;
  if (!warnedStyles.has(style!)) {
    warnedStyles.add(style!);
    console.warn(`buildings: unknown style "${style}", using "house"`);
  }
  return STYLES.house;
}

/** Steepest stair ramp; below the navmesh walkable slope (45°) and the KCC climb limit (50°). */
const STAIR_DEG = 34;
/**
 * Ramps run this long when the building is deep enough. The navmesh is a tile
 * cache, whose layers inside one 6.4 m tile never link up: floor, ramp and the
 * floor above can only join if a tile edge cuts the ramp between its ends, which
 * a ramp longer than a tile always has. Shorter ramps (small houses) join only
 * when an edge happens to fall on them; players can always use them.
 */
const RUN_MAX = 7.6;
/** A ramp this long already crosses a tile edge whenever the building is square to the world. */
const RUN_GOOD = 7.2;
/**
 * Floor beyond each end of a ramp (the landing at its top, the entry at its foot):
 * you walk on and off head-on and turn past the rail's end. 1.8 m leaves a clear
 * lane on the navmesh at any angle to the world; small houses trade some of it
 * for a longer ramp.
 */
const LANDING = 1.8;
const LANDING_MIN = 1.4;
/** Tip of the block under the first ramp (rad): past the navmesh's 'upright box' test (~11.5°). */
const FILLER_TIP = 0.24;
/** Clear height kept over the ramps under the slab above (the navmesh needs 1.8 m). */
const HEADROOM = 2.1;
/** Buildings longer than this (m) get rooms off a corridor (styles with rooms). */
const PARTITION_MIN = 14;
/** Buildings at least this long (m) get a second stairwell at the west end. */
const TWO_STAIRS = 20;
/** Interior walls: thickness, door gap (the navmesh needs ~1.1 m with the agent radius), door height. */
const PART = 0.2;
const ROOM_DOOR = 1.6;
const ROOM_DOOR_H = 2.2;
/**
 * Outside doors are at least this wide: in a building turned off the world axes
 * the navmesh voxels eat into a narrow doorway until bots can't get through.
 */
const DOOR_MIN = 1.6;
/** Rooms are at least this deep. */
const ROOM_MIN = 3;
/** Free floor beside a stair inside its hall. */
const HALL_AISLE = 1.6;
/** Plaster colour of all interior walls (one shared batch). */
const INTERIOR = '#d4cec2';
/** Door letters after turning the building frame by +90° (local x becomes the old -z). */
const TURN: Record<string, string> = { n: 'e', s: 'w', w: 'n', e: 's' };
/** A window is a firing spot when its sill is below a standing soldier's eyes. */
const MAX_SILL = 1.3;

/** A place to fight from inside a building: standing at a window, looking out along `facing`. */
export interface WindowSpot {
  /** Feet position (world). */
  pos: [number, number, number];
  /** Unit direction out of the window (world xz). */
  facing: [number, number];
  /** The opening itself: centre (in the middle of the wall), width and height. */
  opening: { center: [number, number, number]; width: number; height: number };
}

/** Visual-only geometry that isn't a box (gables, mansard roofs), in world space. */
export interface BuildingShape {
  geo: THREE.BufferGeometry;
  material: SurfaceMaterial;
  color: string;
}

export interface BuiltBuilding {
  objects: MapObject[];
  /** Height of the roof top above the base. */
  height: number;
  /** Windows low enough to shoot out of, one spot each. */
  windows: WindowSpot[];
  /** Visual-only boxes (facades of closed blocks, trim, snow): no colliders. */
  decor: MapObject[];
  /** Visual-only non-indexed meshes (no colliders). */
  shapes: BuildingShape[];
}

/** Radius of the level pad the terrain should provide under a building. */
export function buildingPadRadius(b: BuildingDef): number {
  return Math.hypot(b.size[0], b.size[1]) / 2 + 1;
}

export interface BuildOptions {
  /** Winter: snow lies on the roofs (visual only). */
  snow?: boolean;
}

/** Ramp length for a building `d` deep inside its walls: as long as fits, up to RUN_MAX, landings shrinking first. */
function rampFor(d: number): number {
  const inner = d - 2 * WALL;
  const land = Math.min(LANDING, Math.max(LANDING_MIN, (inner - RUN_MAX) / 2));
  return Math.min(RUN_MAX, inner - 2 * land);
}

export function buildBuilding(b: BuildingDef, baseY: number, opts: BuildOptions = {}): BuiltBuilding {
  const spec = styleSpec(b.style);
  const rng = makeRng(b.seed ?? Math.round(b.pos[0] * 73 + b.pos[1] * 131));
  const material = b.material ?? spec.material;
  const color = b.color ?? spec.colors[Math.floor(rng() * spec.colors.length)]!;
  const trim = shade(color, 0.78);
  // Stairs need room; small or solid buildings stay single-storey / closed.
  const runMin = spec.storey / Math.tan((STAIR_DEG * Math.PI) / 180);
  const fits = (w: number, d: number) => d - 2 * WALL >= 2 * LANDING_MIN + runMin && w - 2 * WALL >= STAIR_W + 2;
  const want = Math.max(1, Math.round(b.floors ?? spec.floors));
  let [W, D] = b.size;
  let rotDeg = b.rot ?? 0;
  let doorIds = b.doors ?? 's';
  const roomy = !b.solid && (spec.interior ?? 'rooms') === 'rooms' && (!!spec.rooms || Math.max(W, D) > PARTITION_MIN);
  // Stairs run along local z, so a longer z means a longer ramp (see RUN_MAX); the
  // corridor runs along local x. Turn the frame by 90° (the same building in the world)
  // when that suits: rooms want x along the long side unless the stairs would get much
  // shorter for it, small buildings want their stairs along their long side.
  const turn = !b.solid && (roomy ? D > W && (want === 1 || (fits(D, W) && rampFor(W) >= Math.min(rampFor(D), RUN_GOOD))) : want > 1 && W > D && fits(D, W) && rampFor(W) > rampFor(D));
  if (turn) {
    [W, D] = [D, W];
    rotDeg += 90;
    doorIds = doorIds.replace(/[nsew]/g, (c) => TURN[c]!);
  }
  const floors = b.solid || fits(W, D) ? want : 1;
  const H = floors * spec.storey;
  const yaw = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const out: MapObject[] = [];
  const windows: WindowSpot[] = [];
  const shapes: BuildingShape[] = [];
  const toWorld = new THREE.Matrix4().makeRotationY(yaw).setPosition(b.pos[0], baseY, b.pos[1]);
  const shape = (geo: THREE.BufferGeometry, mat: SurfaceMaterial, col: string) => {
    geo.applyMatrix4(toWorld);
    shapes.push({ geo, material: mat, color: col });
  };
  const box: BoxFn = (lx, ly, lz, sx, sy, sz, type = 'wall', col = color, mat = material, pitch = 0, roll = 0) => {
    if (sx <= 0.01 || sy <= 0.01 || sz <= 0.01) return;
    // Local -> world: rotate about Y by yaw (same convention as Object3D.rotation.y).
    const x = b.pos[0] + lx * cos + lz * sin;
    const z = b.pos[1] - lx * sin + lz * cos;
    const rot: [number, number, number] = [0, rotDeg, 0];
    if (pitch !== 0 || roll !== 0) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
      const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
      rot[0] = THREE.MathUtils.radToDeg(e.x);
      rot[1] = THREE.MathUtils.radToDeg(e.y);
      rot[2] = THREE.MathUtils.radToDeg(e.z);
    }
    out.push({ type, pos: [x, baseY + ly, z], size: [sx, sy, sz], rot, material: mat, color: col });
  };
  // Visual-only boxes (no colliders): facades of closed blocks, trim, snow on roofs.
  const decor: MapObject[] = [];
  const deco: BoxFn = (lx, ly, lz, sx, sy, sz, type = 'prop', col = color, mat = material, pitch = 0, roll = 0) => {
    const n = out.length;
    box(lx, ly, lz, sx, sy, sz, type, col, mat, pitch, roll);
    if (out.length > n) decor.push(out.pop()!);
  };
  const snow = opts.snow ? deco : null;
  const doors = new Set(doorIds.split(''));
  const sides = sideFrames(W, D);
  const Z0 = -D / 2 + WALL;
  const runLen = rampFor(D);
  const land = (D - 2 * WALL - runLen) / 2;

  const stairs: Stair[] = [];
  if (!b.solid && floors > 1) {
    // East stair climbs north; a west one (long buildings) climbs south, so the two meet
    // the navmesh tile edges differently and seldom both miss (see RUN_MAX).
    const Z1 = D / 2 - WALL;
    const zone = 2 * land + runLen;
    stairs.push({ x0: W / 2 - WALL - STAIR_W, x1: W / 2 - WALL, open: -1, dir: 1, top: Z0 + land, z0: Z0, z1: Z0 + zone });
    if (roomy && W >= TWO_STAIRS) stairs.push({ x0: -W / 2 + WALL, x1: -W / 2 + WALL + STAIR_W, open: 1, dir: -1, top: Z1 - land, z0: Z1 - zone, z1: Z1 });
  }
  /** Building-space feet + direction -> world spot. */
  const spot = (lx: number, y: number, lz: number, dx: number, dz: number, o: Opening) => {
    // Nobody stands in a stairwell.
    if (stairs.some((s) => lx > s.x0 - 0.4 && lx < s.x1 + 0.4 && lz > s.z0 - 0.4 && lz < s.z1 + 0.4)) return;
    // The wall's middle is out along the facing from the standing spot.
    const k = WINDOW_STANDOFF + WALL / 2;
    const ox = lx + dx * k;
    const oz = lz + dz * k;
    windows.push({
      pos: [b.pos[0] + lx * cos + lz * sin, baseY + y, b.pos[1] - lx * sin + lz * cos],
      facing: [dx * cos + dz * sin, -dx * sin + dz * cos],
      opening: { center: [b.pos[0] + ox * cos + oz * sin, baseY + o.sill + o.height / 2, b.pos[1] - ox * sin + oz * cos], width: o.width, height: o.height },
    });
  };
  const ctx: Ctx = { W, D, H, floors, storey: spec.storey, solid: !!b.solid, color, trim, material, rng, box, deco, snow, sides, doors, doorAt: {}, columns: {}, stairs, shape, spot };

  if (b.solid) {
    box(0, (H - PLINTH) / 2, 0, W, H + PLINTH, D);
    solidFacades(ctx, spec);
    spec.extras?.(ctx);
    roof(spec, ctx);
    return { objects: out, height: roofHeight(spec, W, D, H), windows, decor, shapes };
  }

  // Rooms: corridor along local x (double-loaded when deep enough, else along the south wall).
  const layout = roomy ? roomLayout(spec, W, D) : null;
  for (const side of sides) outerWall(ctx, spec, side, stairs, layout);

  // Floors: the ground slab is whole; upper slabs leave a hole over each ramp.
  const X0 = -W / 2 + WALL;
  const X1 = W / 2 - WALL;
  const Z1 = D / 2 - WALL;
  box(0, GROUND_TOP - 0.15, 0, X1 - X0, 0.3, Z1 - Z0, 'floor', trim, 'concrete_floor');
  const rise = spec.storey;
  const slope = Math.hypot(rise, runLen);
  const pitch = Math.atan2(rise, runLen);
  // Each upper slab has a hole from the top of the ramp coming up only as far as heads
  // on that ramp need it; the foot of the next ramp up stands on solid floor.
  const holeLen = Math.min(runLen, ((HEADROOM + SLAB) / spec.storey) * runLen);
  const holes = stairs.map((s) => ({ x0: s.x0, x1: s.x1, z0: Math.min(s.top, s.top + s.dir * holeLen), z1: Math.max(s.top, s.top + s.dir * holeLen) }));
  for (let f = 1; f < floors; f++) {
    const y = f * spec.storey - SLAB / 2;
    for (const r of rectMinus({ x0: X0, x1: X1, z0: Z0, z1: Z1 }, holes)) box((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2, r.x1 - r.x0, SLAB, r.z1 - r.z0, 'floor', trim, 'concrete_floor');
  }
  for (let f = 0; f < floors; f++) {
    const fy = f === 0 ? GROUND_TOP : f * spec.storey;
    const up = f < floors - 1;
    for (const s of stairs) {
      const sx = (s.x0 + s.x1) / 2;
      if (up) {
        // Ramp from this floor (foot, `dir` from the top) up to the next, its top face flush with both.
        const cy = f * spec.storey + rise / 2 - 0.1 / Math.cos(pitch);
        box(sx, cy, s.top + (s.dir * runLen) / 2, STAIR_W, 0.2, slope, 'ramp', trim, 'concrete', s.dir * pitch);
        // Fill the space under the high end of the first ramp: open, it is floor overlapping the
        // ramp, which splits the navmesh layers; walled off, it is an island. The filler is
        // tipped a little so its top stays in the navmesh input (see collectStaticBoxes) and
        // leaves less than standing height under the ramp. (Higher ramps have the stairwell under them.)
        if (f === 0) {
          const top = 1.65;
          const under = rise - 0.22 / Math.cos(pitch);
          const len = Math.max(0, (under - top - 0.15) / Math.tan(pitch));
          if (len > 0.3) box(sx, (GROUND_TOP + top) / 2 - 0.05, s.top + s.dir * (0.05 + len / 2), STAIR_W - 0.04, top - GROUND_TOP + 0.1, len, 'wall', INTERIOR, 'concrete', 0, FILLER_TIP * s.open);
        }
      }
      if (f === 0 && !up) continue;
      // Rail along the open side of the strip, the ramps' whole length: they join the floors
      // head-on only, at the landing (top) and the entry (foot).
      const far = s.top + s.dir * (up ? runLen : holeLen);
      const rz = (s.top + far) / 2;
      const rl = Math.abs(far - s.top);
      const railX = s.open < 0 ? s.x0 - 0.05 : s.x1 + 0.05;
      box(railX, fy + 0.5, rz, 0.08, 1, rl, 'cover', trim, 'metal');
      deco(railX, fy + 1.02, rz, 0.12, 0.05, rl, 'prop', '#3b3f42', 'metal');
    }
  }
  if (layout) layRooms(ctx, layout, spec);
  spec.extras?.(ctx);
  roof(spec, ctx);
  return { objects: out, height: roofHeight(spec, W, D, H), windows, decor, shapes };
}

/**
 * One outer wall. Each bay is a window column (the same on every floor) or
 * blank; full-height piers between the openings and the spandrels above and
 * below them are merged into as few boxes as possible.
 */
function outerWall(c: Ctx, spec: StyleSpec, side: SideFrame, stairs: Stair[], layout: RoomLayout | null): void {
  const { D, H, floors, rng, box, deco, doors, trim } = c;
  const bays = Math.max(1, Math.round(side.len / BAY));
  const bw = side.len / bays;
  const hasStair = (side.id === 'e' && stairs.some((s) => s.open === -1)) || (side.id === 'w' && stairs.some((s) => s.open === 1));
  let doorBay = Math.floor(bays / 2);
  // Keep the door off the ramps: at the foot end of the stair wall (the e stair's foot is
  // south, the w stair's north; e runs north to south, w south to north).
  if (hasStair) doorBay = bays - 1;
  const hasDoor = doors.has(side.id);
  const segs: { a: number; len: number; door: boolean; blank?: boolean }[] = [];
  /** Window bays between a0 and a1 (a sliver too short for a bay stays blank wall). */
  const bayRun = (a0: number, a1: number) => {
    const n = Math.round((a1 - a0) / BAY);
    if (n < 1) {
      if (a1 - a0 > 1e-3) segs.push({ a: a0, len: a1 - a0, door: false, blank: true });
      return;
    }
    for (let i = 0; i < n; i++) segs.push({ a: a0 + ((a1 - a0) * i) / n, len: (a1 - a0) / n, door: false });
  };
  if (hasDoor && !hasStair && layout && (side.id === 'e' || side.id === 'w')) {
    // An end door opens square into the corridor: centred on it, whatever the bays, so
    // the corridor walls meeting this wall never stand in the doorway.
    const cz = (layout.c0 + layout.c1) / 2;
    const u = side.id === 'e' ? cz - (-D / 2 + WALL) : D / 2 - WALL - cz;
    const dw = Math.min(Math.max(spec.door[0], DOOR_MIN), layout.c1 - layout.c0 - 0.3);
    const a1 = Math.min(side.len, u + dw / 2 + 0.4);
    const a0 = Math.max(0, a1 - dw - 0.8);
    bayRun(0, a0);
    segs.push({ a: a0, len: a1 - a0, door: true });
    bayRun(a1, side.len);
  } else {
    // A door wider than a bay takes several bays together (cart, hangar and engine-shed doors).
    const span = hasDoor && !hasStair && spec.door[0] > bw - 0.4 ? Math.min(bays, Math.ceil((spec.door[0] + 0.8) / bw)) : 1;
    const first = Math.min(bays - span, Math.max(0, doorBay - Math.floor((span - 1) / 2)));
    for (let i = 0; i < bays; i++) {
      if (hasDoor && i === first) {
        segs.push({ a: i * bw, len: span * bw, door: true });
        i += span - 1;
      } else segs.push({ a: i * bw, len: bw, door: false });
    }
  }
  // The stairwell runs along this wall: no standing at its windows.
  const spots = !hasStair;
  const piers: [number, number][] = [];
  const cols: { u: number; o: Opening }[] = [];
  for (const seg of segs) {
    const col = !seg.blank && rng() < spec.windows;
    const opens: (Opening | null)[] = [];
    for (let f = 0; f < floors; f++) {
      const y0 = f * c.storey;
      if (f === 0 && seg.door) opens.push({ width: Math.min(Math.max(spec.door[0], DOOR_MIN), seg.len - 0.4), height: spec.door[1], sill: 0 });
      else if (col) {
        const [ww, wh, sill] = f === 0 ? (spec.groundWindow ?? spec.window) : spec.window;
        opens.push({ width: Math.min(ww, seg.len - 0.6), height: wh, sill: y0 + sill });
      } else opens.push(null);
    }
    const owMax = Math.max(0, ...opens.map((o) => o?.width ?? 0));
    if (owMax === 0) {
      piers.push([seg.a, seg.a + seg.len]);
      continue;
    }
    const pier = (seg.len - owMax) / 2;
    piers.push([seg.a, seg.a + pier], [seg.a + seg.len - pier, seg.a + seg.len]);
    const s0 = seg.a + pier;
    const mid = s0 + owMax / 2;
    const solid: [number, number][] = [];
    for (let f = 0; f < floors; f++) {
      const y0 = f * c.storey;
      const bottom = f === 0 ? -PLINTH : y0;
      const top = y0 + c.storey;
      const o = opens[f];
      if (!o) {
        solid.push([bottom, top]);
        continue;
      }
      solid.push([bottom, o.sill]);
      const lintel = o.sill + o.height;
      if (lintel < top) solid.push([lintel, top]);
      // Narrower than the column (a door under wider windows): fill its sides on this floor.
      const fill = (owMax - o.width) / 2;
      if (fill > 0.01) {
        sideBox(side, box, s0, fill, bottom, top - bottom);
        sideBox(side, box, s0 + owMax - fill, fill, bottom, top - bottom);
      }
      if (spec.arch && o.height > 1.6) archCorners(side, box, mid - o.width / 2, o.width, Math.min(lintel, top), Math.min(o.width / 2, o.height * 0.3));
      if (o.sill > 0) {
        // Sill outside, a firing spot inside when it is low enough.
        sideBox(side, deco, mid - o.width / 2 - 0.1, o.width + 0.2, o.sill - 0.08, 0.08, WALL / 2 + 0.06, 0.18, 'prop', trim, 'concrete');
        if (f === 1 || floors === 1) cols.push({ u: mid, o });
        const y = f === 0 ? GROUND_TOP : y0;
        if (spots && o.sill - y <= MAX_SILL) {
          const [lx, lz] = sidePoint(side, mid, -(WALL / 2 + WINDOW_STANDOFF));
          c.spot(lx, y, lz, side.normal[0], side.normal[1], o);
        }
      } else if (f === 0) c.doorAt[side.id] = { u: mid, width: o.width, height: o.height };
    }
    for (const [y0, y1] of mergeSpans(solid)) sideBox(side, box, s0, owMax, y0, y1 - y0);
  }
  for (const [a0, a1] of mergeSpans(piers)) sideBox(side, box, a0, a1 - a0, -PLINTH, H + PLINTH);
  c.columns[side.id] = cols;
}

/** Stepped corners rounding off the top of an opening (u0..u0+w along the side, top at `lintel`). */
function archCorners(s: SideFrame, fn: BoxFn, u0: number, w: number, lintel: number, rise: number): void {
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const y0 = lintel - rise + (i * rise) / steps;
    const t = (i + 0.5) / steps;
    // Half width of an elliptic arch at this height.
    const fill = w / 2 - (w / 2) * Math.sqrt(Math.max(0, 1 - t * t));
    if (fill < 0.03) continue;
    sideBox(s, fn, u0, fill, y0, rise / steps);
    sideBox(s, fn, u0 + w - fill, fill, y0, rise / steps);
  }
}

/** Closed blocks still look lived in: windows, sills and a door painted on their walls. */
function solidFacades(c: Ctx, spec: StyleSpec): void {
  for (const f of c.sides) {
    const len = f.id === 'n' || f.id === 's' ? c.W : c.D;
    // Facade decor runs over the whole face (the e / w frames start inside the n / s walls).
    const shift = f.id === 'n' || f.id === 's' ? 0 : WALL;
    const at = (u: number, y: number, o: number, sx: number, sy: number, sz: number, col: string, mat: SurfaceMaterial) =>
      sideBox(f, c.deco, u - shift - sx / 2, sx, y - sy / 2, sy, WALL / 2 + o, sz, 'prop', col, mat);
    const bays = Math.max(1, Math.round(len / BAY));
    const bw = len / bays;
    const doorBay = Math.floor(bays / 2);
    const cols = Array.from({ length: bays }, () => c.rng() < spec.windows);
    for (let fl = 0; fl < c.floors; fl++) {
      const y0 = fl * c.storey;
      for (let i = 0; i < bays; i++) {
        const u = (i + 0.5) * bw;
        if (fl === 0 && i === doorBay && c.doors.has(f.id)) {
          const [dw, dh] = spec.door;
          at(u, dh / 2, 0.04, Math.min(dw, bw - 0.4), dh, 0.08, '#4a3a2c', 'wood');
          at(u, dh + 0.08, 0.08, Math.min(dw, bw - 0.4) + 0.3, 0.16, 0.16, c.trim, 'concrete');
        } else if (cols[i]) {
          const [ww, wh, sill] = spec.window;
          const w = Math.min(ww, bw - 0.6);
          at(u, y0 + sill + wh / 2, 0.03, w, wh, 0.06, '#1f2529', 'metal');
          at(u, y0 + sill - 0.04, 0.08, w + 0.2, 0.08, 0.16, c.trim, 'concrete');
          if (fl === 1) (c.columns[f.id] ??= []).push({ u: u - shift, o: { width: w, height: wh, sill: y0 + sill } });
        }
      }
    }
  }
}

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** A rectangle less some holes, as a few rectangles (strips between the holes' x edges). */
function rectMinus(r: Rect, holes: Rect[]): Rect[] {
  const xs = [r.x0, r.x1, ...holes.flatMap((h) => [h.x0, h.x1])].filter((x) => x >= r.x0 && x <= r.x1).sort((a, b) => a - b);
  const strips: Rect[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    if (x1 - x0 < 1e-3) continue;
    const mid = (x0 + x1) / 2;
    let z = r.z0;
    for (const [a, b] of mergeSpans(holes.filter((h) => mid > h.x0 && mid < h.x1).map((h): [number, number] => [h.z0, h.z1]))) {
      if (a > z) strips.push({ x0, x1, z0: z, z1: a });
      z = Math.max(z, b);
    }
    if (r.z1 > z) strips.push({ x0, x1, z0: z, z1: r.z1 });
  }
  // Rejoin neighbouring strips with the same z range (fewer boxes).
  const joined: Rect[] = [];
  for (const q of strips) {
    const prev = joined.find((p) => Math.abs(p.x1 - q.x0) < 1e-3 && Math.abs(p.z0 - q.z0) < 1e-3 && Math.abs(p.z1 - q.z1) < 1e-3);
    if (prev) prev.x1 = q.x1;
    else joined.push({ ...q });
  }
  return joined;
}

interface RoomLayout {
  /** Corridor z range. */
  c0: number;
  c1: number;
  /** Rooms on both sides of the corridor (else along the north wall only). */
  double: boolean;
  /** Bay width along x (the n / s facade grid). */
  bw: number;
}

function roomLayout(spec: StyleSpec, W: number, D: number): RoomLayout | null {
  const corr = spec.corridor ?? 2.2;
  const Z0 = -D / 2 + WALL;
  const Z1 = D / 2 - WALL;
  const double = Z1 - Z0 >= 2 * (ROOM_MIN + PART) + corr;
  if (!double && Z1 - Z0 < ROOM_MIN + PART + corr) return null;
  return { c0: double ? -corr / 2 : Z1 - corr, c1: double ? corr / 2 : Z1, double, bw: W / Math.max(1, Math.round(W / BAY)) };
}

/**
 * Rooms off the corridor on every floor, their walls on the facade's bay lines
 * (never across a window). Stair halls take the end bays; ground-floor rooms
 * behind an outside door stay open to the corridor as a lobby.
 */
function layRooms(c: Ctx, L: RoomLayout, spec: StyleSpec): void {
  const { W, D, H, floors, storey, box, rng, stairs } = c;
  const bays = Math.round(W / L.bw);
  const hallBays = L.bw - WALL - PART / 2 - STAIR_W - 0.1 >= HALL_AISLE ? 1 : 2;
  const i0 = stairs.some((s) => s.open === 1) ? hallBays : 0;
  const i1 = stairs.some((s) => s.open === -1) ? bays - hallBays : bays;
  if (i1 - i0 < 1) return;
  const xAt = (i: number) => -W / 2 + i * L.bw;
  const choices = spec.roomBays ?? [1, 2];
  // Outside doors as building-space x (n runs +x from the west corner, s runs -x from the east).
  const doorX = (id: 'n' | 's') => {
    const d = c.doorAt[id];
    return d ? (id === 'n' ? -W / 2 + d.u : W / 2 - d.u) : null;
  };
  const rows = [{ far: -D / 2 + WALL, near: L.c0 - PART, wall: L.c0 - PART / 2, door: doorX('n') }];
  if (L.double) rows.push({ far: D / 2 - WALL, near: L.c1 + PART, wall: L.c1 + PART / 2, door: doorX('s') });
  const wall = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => box(x, y, z, sx, sy, sz, 'wall', INTERIOR, 'concrete');
  for (let f = 0; f < floors; f++) {
    const y0 = f === 0 ? GROUND_TOP - 0.05 : f * storey - 0.02;
    const top = f === floors - 1 ? H - 0.05 : (f + 1) * storey - SLAB + 0.02;
    const h = top - y0;
    for (const row of rows) {
      const bounds = [i0];
      for (let i = i0; i < i1; ) {
        i = Math.min(i1, i + choices[Math.floor(rng() * choices.length)]!);
        bounds.push(i);
      }
      const zc = (row.near + row.far) / 2;
      for (const i of bounds) if (i > 0 && i < bays) wall(xAt(i), y0 + h / 2, zc, PART, h, Math.abs(row.near - row.far));
      // Corridor wall with a door into each room (no wall at all in front of a lobby).
      const gaps: [number, number][] = [];
      for (let k = 0; k + 1 < bounds.length; k++) {
        const xa = xAt(bounds[k]!);
        const xb = xAt(bounds[k + 1]!);
        if (f === 0 && row.door !== null && row.door > xa && row.door < xb) {
          gaps.push([xa, xb]);
          continue;
        }
        // The door sits in a bay centre, to one side in wide rooms.
        const nb = bounds[k + 1]! - bounds[k]!;
        const dx = xa + (Math.floor(rng() * nb) + 0.5) * L.bw;
        gaps.push([dx - ROOM_DOOR / 2, dx + ROOM_DOOR / 2]);
        if (h > ROOM_DOOR_H) wall(dx, y0 + ROOM_DOOR_H + (h - ROOM_DOOR_H) / 2, row.wall, ROOM_DOOR, h - ROOM_DOOR_H, PART);
      }
      let x = xAt(i0);
      for (const [a, b] of gaps) {
        if (a > x) wall((x + a) / 2, y0 + h / 2, row.wall, a - x, h, PART);
        x = Math.max(x, b);
      }
      if (xAt(i1) > x) wall((x + xAt(i1)) / 2, y0 + h / 2, row.wall, xAt(i1) - x, h, PART);
    }
  }
}

const ROOF_TILES = '#6b4a3a';
const SLATE = '#4a4f55';

function mansardRise(W: number, D: number): number {
  return Math.min(3.2, Math.min(W, D) * 0.22);
}

function roofHeight(spec: StyleSpec, W: number, D: number, H: number): number {
  if (spec.roof === 'pitched') return H + (Math.min(W, D) / 2 + 0.3) * (spec.pitch ?? 0.6);
  if (spec.roof === 'mansard') return H + mansardRise(W, D) + 0.3;
  return H + 1;
}

function roof(spec: StyleSpec, c: Ctx): void {
  const { W, D, H, box, deco, trim, snow } = c;
  box(0, H + SLAB / 2 - 0.05, 0, W, SLAB, D, 'floor', trim, 'concrete');
  if (snow && (spec.roof === 'flat' || spec.roof === 'parapet')) snow(0, H + SLAB + 0.02, 0, W - (spec.roof === 'parapet' ? 0.7 : 0.1), 0.12, D - (spec.roof === 'parapet' ? 0.7 : 0.1), 'prop', ROOF_SNOW, 'snow');
  if (spec.roof === 'parapet') {
    const p = 0.9;
    box(0, H + p / 2, -D / 2 + 0.15, W, p, 0.3, 'wall', trim);
    box(0, H + p / 2, D / 2 - 0.15, W, p, 0.3, 'wall', trim);
    box(-W / 2 + 0.15, H + p / 2, 0, 0.3, p, D - 0.6, 'wall', trim);
    box(W / 2 - 0.15, H + p / 2, 0, 0.3, p, D - 0.6, 'wall', trim);
    // Coping along the top (the trim colour: no extra material per building).
    const cope = trim;
    deco(0, H + p + 0.04, -D / 2 + 0.15, W + 0.1, 0.08, 0.42, 'prop', cope, 'concrete');
    deco(0, H + p + 0.04, D / 2 - 0.15, W + 0.1, 0.08, 0.42, 'prop', cope, 'concrete');
    deco(-W / 2 + 0.15, H + p + 0.04, 0, 0.42, 0.08, D - 0.2, 'prop', cope, 'concrete');
    deco(W / 2 - 0.15, H + p + 0.04, 0, 0.42, 0.08, D - 0.2, 'prop', cope, 'concrete');
  } else if (spec.roof === 'pitched') {
    // Two slabs meeting at a ridge along the long axis (local x if wider), gables filled in.
    const alongX = W >= D;
    const span = (alongX ? D : W) / 2 + 0.3;
    const k = spec.pitch ?? 0.6;
    const rise = span * k;
    const slant = Math.hypot(span, rise);
    const pitch = Math.atan2(rise, span);
    const len = (alongX ? W : D) + 0.4;
    // Each half slopes down toward its eave.
    if (alongX) {
      box(0, H + rise / 2, -span / 2, len, 0.2, slant, 'floor', ROOF_TILES, 'wood', -pitch);
      box(0, H + rise / 2, span / 2, len, 0.2, slant, 'floor', ROOF_TILES, 'wood', pitch);
    } else {
      box(-span / 2, H + rise / 2, 0, slant, 0.2, len, 'floor', ROOF_TILES, 'wood', 0, pitch);
      box(span / 2, H + rise / 2, 0, slant, 0.2, len, 'floor', ROOF_TILES, 'wood', 0, -pitch);
    }
    // Gable triangles in the wall's own surface under the roof ends, a ridge board on top.
    const g = span - 0.3;
    for (const s of [-1, 1]) {
      const geo = prismGeo(
        [
          [-g, 0],
          [g, 0],
          [0, g * k],
        ],
        WALL,
      );
      // The profile spans local x; turn it to span z when the ridge runs along x.
      if (alongX) geo.rotateY(Math.PI / 2);
      geo.translate(alongX ? s * (W / 2 - WALL / 2) : 0, H + SLAB - 0.06, alongX ? 0 : s * (D / 2 - WALL / 2));
      c.shape(geo, c.material, c.color);
    }
    deco(0, H + rise + 0.02, 0, alongX ? len : 0.22, 0.14, alongX ? 0.22 : len, 'prop', shade(ROOF_TILES, 0.7), 'wood');
    if (snow) {
      // A blanket on each half, just above the tiles, stopping short of the eaves.
      const up = 0.15 / Math.cos(pitch);
      if (alongX) {
        snow(0, H + rise / 2 + up, -span / 2 + 0.05, len - 0.1, 0.12, slant * 0.94, 'prop', ROOF_SNOW, 'snow', -pitch);
        snow(0, H + rise / 2 + up, span / 2 - 0.05, len - 0.1, 0.12, slant * 0.94, 'prop', ROOF_SNOW, 'snow', pitch);
      } else {
        snow(-span / 2 + 0.05, H + rise / 2 + up, 0, slant * 0.94, 0.12, len - 0.1, 'prop', ROOF_SNOW, 'snow', 0, pitch);
        snow(span / 2 - 0.05, H + rise / 2 + up, 0, slant * 0.94, 0.12, len - 0.1, 'prop', ROOF_SNOW, 'snow', 0, -pitch);
      }
    }
  } else if (spec.roof === 'mansard') {
    // Steep slate sides set back from a cornice, a flat top; the collider is a box inside it.
    const r = mansardRise(W, D);
    const ins = r * 0.32;
    const top = H + SLAB - 0.05;
    c.shape(frustumGeo(W - 0.1, D - 0.1, ins, r).translate(0, top, 0), 'metal', SLATE);
    box(0, top + r / 2, 0, W - 2 * ins, r, D - 2 * ins, 'wall', SLATE, 'metal');
    deco(0, top + 0.1, 0, W + 0.5, 0.2, D + 0.5, 'prop', trim, 'concrete');
    if (snow) snow(0, top + r + 0.07, 0, W - 2 * ins - 0.2, 0.12, D - 2 * ins - 0.2, 'prop', ROOF_SNOW, 'snow');
  }
}
