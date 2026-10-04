import * as THREE from 'three';
import type { Obstacle } from 'recast-navigation';
import { Layer, type PhysicsWorld, type RAPIER } from '@/physics/PhysicsWorld';
import type { SurfaceRegistry } from '@/physics/surfaces';
import type { NavWorld } from '@/ai/NavWorld';
import type { ClassId } from '@/data/classes';
import type { WindowSpot } from '@/world/buildings';
import type { ZoneDef } from '@/world/mapTypes';
import { FORT_SIZE, TIMBER_SLIT, type FortModels, stationIcon } from '@/world/fortModels';

/*
 * Zone fortifications and supply stations (design doc section 5).
 * Every zone gets an ammo station and a medical station (5 uses each, refilled
 * by supports / medics working at them) and some two dozen build spots: sandbag
 * walls (high, low, L-shaped corners, a U-shaped nest), timber walls with a
 * firing slit, barricades for the windows of nearby buildings, and barbed wire
 * and anti-tank hedgehogs on the approaches. Anyone can build (build mode, T);
 * built things can be blown up and built again. Spots are found when the map
 * loads (no map data needed).
 */

export type FortKind = 'sandbag' | 'sandbagLow' | 'sandbagCorner' | 'nest' | 'timber' | 'wire' | 'barricade' | 'hedgehog';
export type StationKind = 'ammo' | 'medical';

/** Seconds of work to build (supports work twice as fast) and health once built. */
export const FORT: Record<FortKind, { build: number; health: number }> = {
  sandbag: { build: 6, health: 260 },
  sandbagLow: { build: 4, health: 200 },
  sandbagCorner: { build: 8, health: 320 },
  nest: { build: 11, health: 420 },
  timber: { build: 7, health: 200 },
  wire: { build: 5, health: 120 },
  barricade: { build: 4, health: 140 },
  hedgehog: { build: 8, health: 390 },
};

/** Walking speed factor inside built barbed wire. */
export const WIRE_SLOW = 0.45;
/** How far away a build spot can be worked on in build mode (m, eye to spot). */
export const BUILD_REACH = 4.5;

/** A solid piece of a built structure: local centre (y from the ground; barricades from the window centre) and full size. */
export interface FortPart {
  c: [number, number, number];
  s: [number, number, number];
}

/**
 * What stops soldiers and bullets once a spot is built. Hedgehogs (vehicles
 * only, none yet) and wire (slows, doesn't stop) have no solid parts.
 */
export function fortParts(kind: FortKind, [w, h, d]: readonly [number, number, number]): FortPart[] {
  const t = 0.7;
  switch (kind) {
    case 'sandbag':
    case 'sandbagLow':
      return [{ c: [0, h / 2, 0], s: [w, h, d] }];
    case 'sandbagCorner':
    case 'nest': {
      const side = (sx: number): FortPart => ({ c: [sx * (w / 2 - t / 2), h / 2, t / 2], s: [t, h, d - t] });
      const front: FortPart = { c: [0, h / 2, -d / 2 + t / 2], s: [w, h, t] };
      return kind === 'nest' ? [front, side(-1), side(1)] : [front, side(-1)];
    }
    case 'timber':
      return [
        { c: [0, TIMBER_SLIT[0] / 2, 0], s: [w, TIMBER_SLIT[0], 0.2] },
        { c: [0, (TIMBER_SLIT[1] + h) / 2, 0], s: [w, h - TIMBER_SLIT[1], 0.2] },
      ];
    case 'barricade': {
      // Boards below and above the slit (d = slit centre above the sill).
      const bottom = -h / 2;
      const lo = bottom + d - 0.13;
      const hi = lo + 0.26;
      const parts: FortPart[] = [
        { c: [0, (bottom + lo) / 2, 0], s: [w + 0.2, lo - bottom, 0.08] },
        { c: [0, (hi + h / 2) / 2, 0], s: [w + 0.2, h / 2 - hi, 0.08] },
      ];
      return parts.filter((p) => p.s[1] > 0.02);
    }
    default:
      return [];
  }
}

export const STATION = {
  /** Uses when full; the zone's owners take one each time. */
  uses: 5,
  /** Seconds of work at the station per use put back. */
  refillSec: 3,
};

/** How close to a build spot or station a soldier has to stand. */
export const WORK_RANGE = 2.3;

/** Build speed multiplier: supports build twice as fast. */
export function buildSpeed(cls: ClassId): number {
  return cls === 'support' ? 2 : 1;
}

/** Points per second of building (supports earn five times as much). */
export function buildPoints(cls: ClassId): number {
  return cls === 'support' ? 50 : 10;
}

/** Points for putting one use back into a station. */
export const REFILL_POINTS = 30;

/** Who may refill a station: supports the ammo one, medics the medical one. */
export function canRefill(kind: StationKind, cls: ClassId): boolean {
  return kind === 'ammo' ? cls === 'support' : cls === 'medic';
}

// ---------------------------------------------------------------------------
// Placement

export interface PlannedSlot {
  kind: FortKind;
  zone: string;
  /** Ground centre (barricade: centre of the boards in the window). */
  pos: [number, number, number];
  /** Radians; the model's front (-z) faces out. */
  yaw: number;
  /** Where a builder stands. */
  stand: [number, number, number];
  /** Barricade only: opening width, height and slit height above the sill. */
  size?: [number, number, number];
}

export interface PlannedStation {
  kind: StationKind;
  zone: string;
  pos: [number, number, number];
  yaw: number;
}

export interface FortPlan {
  slots: PlannedSlot[];
  stations: PlannedStation[];
}

/** What the planner needs to know about the world. */
export interface PlanProbe {
  /** Ground height at (x, z) and whether it is level; null outside the map, in water or not on the ground. */
  ground(x: number, z: number): { y: number; level: boolean } | null;
  /** True if a box standing on (x, y, z) with this full size and yaw touches nothing. */
  clear(x: number, y: number, z: number, size: readonly [number, number, number], yaw: number): boolean;
}

export interface Footprint {
  x: number;
  z: number;
  yaw: number;
  hw: number;
  hd: number;
}

/**
 * Build spots per zone: how many of each, on which rings (fractions of the
 * zone radius, tried in order), how much room each keeps round itself and how
 * far from buildings (doors) it stays.
 */
const RECIPE: { kind: Exclude<FortKind, 'barricade'>; count: number; rings: number[]; room: number; pad: number }[] = [
  { kind: 'nest', count: 1, rings: [0.6, 0.75, 0.45], room: 3.2, pad: 2.4 },
  { kind: 'sandbagCorner', count: 3, rings: [0.65, 0.8, 0.5], room: 2.8, pad: 2.2 },
  { kind: 'sandbag', count: 5, rings: [0.75, 0.6, 0.9, 0.45], room: 2.6, pad: 2.2 },
  { kind: 'timber', count: 3, rings: [0.85, 0.7, 1.0], room: 2.6, pad: 2.2 },
  { kind: 'sandbagLow', count: 4, rings: [0.5, 0.65, 0.35, 0.8], room: 2.3, pad: 2 },
  { kind: 'wire', count: 3, rings: [1.2, 1.35, 1.05], room: 3, pad: 2 },
  { kind: 'hedgehog', count: 3, rings: [1.25, 1.45, 1.1], room: 2.4, pad: 2 },
];
const BARRICADES_PER_ZONE = 6;
/**
 * Zone radius the RECIPE counts are for. Bigger zones get more of everything,
 * growing slower than the area (about 1.5x at twice the radius) so a map of
 * big zones keeps its spot count (blueprints, colliders when built) in check.
 */
const RECIPE_RADIUS = 18;
export function fortScale(radius: number): number {
  return Math.min(1.75, Math.max(1, Math.pow(radius / RECIPE_RADIUS, 0.585)));
}
/**
 * Zones by a river and zones in the contested middle are where the fighting
 * is (owner, 2026-10-02: "far more building at the river zones and the
 * important ones"): riverside zones get twice the spots, middle zones half as
 * many again, and riverside zones also get a line of positions along the
 * banks near them and at the bridge ends, facing across the water.
 */
export const FORT_WEIGHT = { river: 2, middle: 1.5, max: 2.5, riverReach: 40, middleBalance: 0.2, bankStep: 7, bankSpots: 16 };
/** What the map adds to the plan: its rivers and its two bases (blue, red). */
export interface PlanContext {
  rivers?: readonly { pts: readonly (readonly [number, number])[]; width: number; bank?: number; crossings?: readonly (readonly [number, number])[] }[];
  bases?: readonly (readonly [number, number])[];
}

/** Closest point of a polyline to (x, z), its distance and the line's unit direction there. */
function nearestOnLine(pts: readonly (readonly [number, number])[], x: number, z: number): { x: number; z: number; d: number; tx: number; tz: number } {
  let best = { x: pts[0]![0], z: pts[0]![1], d: Infinity, tx: 1, tz: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const qx = ax + dx * t;
    const qz = az + dz * t;
    const d = Math.hypot(qx - x, qz - z);
    if (d < best.d) {
      const L = Math.sqrt(L2);
      best = { x: qx, z: qz, d, tx: dx / L, tz: dz / L };
    }
  }
  return best;
}

/** How many times the RECIPE a zone gets for where it lies (see FORT_WEIGHT), and whether it is by a river. */
export function zoneWeight(zone: { pos: readonly number[]; radius: number }, ctx: PlanContext): { weight: number; river: boolean } {
  const [cx, , cz] = zone.pos as [number, number, number];
  const river = (ctx.rivers ?? []).some((r) => r.pts.length > 1 && nearestOnLine(r.pts, cx, cz).d < zone.radius + FORT_WEIGHT.riverReach);
  let middle = false;
  if (ctx.bases?.length === 2) {
    const [a, b] = ctx.bases as [readonly [number, number], readonly [number, number]];
    const da = Math.hypot(cx - a[0], cz - a[1]);
    const db = Math.hypot(cx - b[0], cz - b[1]);
    middle = Math.abs(da - db) / Math.max(1, da + db) < FORT_WEIGHT.middleBalance;
  }
  const weight = Math.min(FORT_WEIGHT.max, (river ? FORT_WEIGHT.river : 1) * (middle ? FORT_WEIGHT.middle : 1));
  return { weight, river };
}

/** 0..31 in bit-reversed order: consecutive picks land far apart round a circle. */
const SPREAD = Array.from({ length: 32 }, (_, i) => parseInt(i.toString(2).padStart(5, '0').split('').reverse().join(''), 2));
/** Standing eye height a barricade's slit is cut at, above the floor. */
const SLIT_EYE = 1.52;

function hashId(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/** Inside a building footprint grown by `pad`. */
function nearBuilding(footprints: readonly Footprint[], x: number, z: number, pad: number): boolean {
  for (const f of footprints) {
    const dx = x - f.x;
    const dz = z - f.z;
    const c = Math.cos(f.yaw);
    const s = Math.sin(f.yaw);
    // World -> local (inverse of the building's yaw about Y).
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) < f.hw + pad && Math.abs(lz) < f.hd + pad) return true;
  }
  return false;
}

/**
 * Finds station and build spots around every zone. Deterministic for a given
 * map: the same spots on every load (and in every client, for multiplayer later).
 */
export function planFortifications(zones: readonly ZoneDef[], windows: readonly WindowSpot[], footprints: readonly Footprint[], probe: PlanProbe, ctx: PlanContext = {}): FortPlan {
  const plan: FortPlan = { slots: [], stations: [] };
  const used = new Set<WindowSpot>();
  // Bank positions can belong to either of two zones on the same stretch: kept apart map-wide.
  const banksTaken: { x: number; z: number; r: number }[] = [];
  for (const zone of zones) {
    const [cx, , cz] = zone.pos;
    const R = zone.radius;
    const { weight, river } = zoneWeight(zone, ctx);
    const scale = fortScale(R) * weight;
    const taken: { x: number; z: number; r: number }[] = [];
    const free = (x: number, z: number, r: number) => taken.every((t) => Math.hypot(t.x - x, t.z - z) >= t.r + r) && banksTaken.every((t) => Math.hypot(t.x - x, t.z - z) >= t.r + r);
    /** A build spot at (x, z) whose front faces along (ox, oz), if the ground and the room behind allow. */
    const trySlot = (kind: Exclude<FortKind, 'barricade'>, x: number, z: number, ox: number, oz: number, room: number, pad: number, list = taken): boolean => {
      const size = FORT_SIZE[kind];
      const g = probe.ground(x, z);
      if (!g || nearBuilding(footprints, x, z, pad) || !free(x, z, room)) return false;
      const yaw = Math.atan2(-ox, -oz);
      if (!probe.clear(x, g.y, z, [size[0] + 0.4, size[1], size[2] + 0.4], yaw)) return false;
      // Room behind it to stand and build.
      const back = size[2] / 2 + 0.75;
      const sx = x - ox * back;
      const sz = z - oz * back;
      const sg = probe.ground(sx, sz);
      if (!sg || Math.abs(sg.y - g.y) > 0.6) return false;
      plan.slots.push({ kind, zone: zone.id, pos: [x, g.y, z], yaw, stand: [sx, sg.y, sz] });
      list.push({ x, z, r: room });
      return true;
    };
    const start = (hashId(zone.id) % 32) / 32;
    /** Candidate points on rings around the zone centre, spread round the circle. */
    function* ring(radii: number[], steps = 32): Generator<{ x: number; z: number; a: number }> {
      for (const f of radii) {
        for (let i = 0; i < steps; i++) {
          const k = SPREAD[i % 32]! / 32;
          const a = ((start + k) % 1) * Math.PI * 2;
          yield { x: cx + Math.cos(a) * R * f, z: cz + Math.sin(a) * R * f, a };
        }
      }
    }

    // Stations: inside the zone, level ground, clear of doors, facing the centre.
    const stationAt = (kind: StationKind, near: { x: number; z: number } | null): boolean => {
      const size = FORT_SIZE[kind];
      for (const p of ring([0.4, 0.55, 0.28, 0.7], 16)) {
        if (near && (Math.hypot(p.x - near.x, p.z - near.z) < 4 || Math.hypot(p.x - near.x, p.z - near.z) > 11)) continue;
        const g = probe.ground(p.x, p.z);
        if (!g || !g.level || nearBuilding(footprints, p.x, p.z, 2.4) || !free(p.x, p.z, 2)) continue;
        const yaw = Math.atan2(cx - p.x, cz - p.z);
        // The station plus room in front to stand.
        if (!probe.clear(p.x, g.y, p.z, [size[0] + 0.6, size[1], size[2] + 1.6], yaw)) continue;
        plan.stations.push({ kind, zone: zone.id, pos: [p.x, g.y, p.z], yaw });
        taken.push({ x: p.x, z: p.z, r: 2 });
        return true;
      }
      return false;
    };
    stationAt('ammo', null);
    const ammo = plan.stations.at(-1);
    if (!stationAt('medical', ammo && ammo.zone === zone.id ? { x: ammo.pos[0], z: ammo.pos[2] } : null)) stationAt('medical', null);

    // Build spots round the zone: front (-z) facing out, long side across the way in.
    for (const r of RECIPE) {
      const count = Math.round(r.count * scale);
      let n = 0;
      for (const p of ring(r.rings)) {
        if (n >= count) break;
        if (trySlot(r.kind, p.x, p.z, Math.cos(p.a), Math.sin(p.a), r.room, r.pad)) n++;
      }
    }

    // By a river: a line of positions along both banks near the zone, facing
    // across the water (wire down the slope in front), and the bridge ends held.
    if (river) {
      const reach = R + FORT_WEIGHT.riverReach;
      const BANK: Exclude<FortKind, 'barricade'>[] = ['sandbag', 'sandbagCorner', 'timber', 'nest', 'sandbag', 'sandbagLow'];
      let n = 0;
      for (const rv of ctx.rivers ?? []) {
        const top = rv.width / 2 + (rv.bank ?? 5) + 1.5;
        const crossings = rv.crossings ?? [];
        // Points along the river every bankStep metres, nearest the zone first.
        const along: { x: number; z: number; tx: number; tz: number; d: number }[] = [];
        for (let i = 0; i < rv.pts.length - 1; i++) {
          const [ax, az] = rv.pts[i]!;
          const [bx, bz] = rv.pts[i + 1]!;
          const L = Math.hypot(bx - ax, bz - az);
          for (let u = 0; u < L; u += FORT_WEIGHT.bankStep) {
            const x = ax + ((bx - ax) * u) / L;
            const z = az + ((bz - az) * u) / L;
            const d = Math.hypot(x - cx, z - cz);
            if (d < reach) along.push({ x, z, tx: (bx - ax) / L, tz: (bz - az) / L, d });
          }
        }
        along.sort((a, b) => a.d - b.d);
        for (const p of along) {
          if (n >= FORT_WEIGHT.bankSpots) break;
          // Bridges keep their ends clear for the road; those get their own spots below.
          if (crossings.some((c) => Math.hypot(c[0] - p.x, c[1] - p.z) < 10)) continue;
          for (const side of [-1, 1]) {
            const nx = -p.tz * side;
            const nz = p.tx * side;
            // Front toward the river (-n), standing on the bank top.
            const kind = BANK[n % BANK.length]!;
            if (trySlot(kind, p.x + nx * top, p.z + nz * top, -nx, -nz, 2.6, 2, banksTaken)) n++;
            if (n % 3 === 0 && trySlot('wire', p.x + nx * (top - 2.2), p.z + nz * (top - 2.2), -nx, -nz, 2.4, 1.5, banksTaken)) n++;
          }
        }
        // Bridge ends: hedgehogs and wire beside the road, a nest a little off it.
        for (const [bx, bz] of crossings) {
          if (Math.hypot(bx - cx, bz - cz) > reach) continue;
          const at = nearestOnLine(rv.pts, bx, bz);
          for (const side of [-1, 1]) {
            const nx = -at.tz * side;
            const nz = at.tx * side;
            const ex = bx + nx * (top + 4);
            const ez = bz + nz * (top + 4);
            for (const lat of [-1, 1]) {
              trySlot('hedgehog', ex + at.tx * lat * 5, ez + at.tz * lat * 5, -nx, -nz, 1.8, 1.5, banksTaken);
              trySlot('nest', ex + at.tx * lat * 10 + nx * 3, ez + at.tz * lat * 10 + nz * 3, -nx, -nz, 3.2, 2.4, banksTaken);
            }
            trySlot('wire', ex + at.tx * 9, ez + at.tz * 9, -nx, -nz, 2.4, 1.5, banksTaken);
          }
        }
      }
    }

    // Barricades for the nearest windows of buildings in / at the zone.
    const near = windows
      .filter((w) => !used.has(w) && Math.hypot(w.opening.center[0] - cx, w.opening.center[2] - cz) < R + 6)

      .sort((a, b) => Math.hypot(a.pos[0] - cx, a.pos[2] - cz) - Math.hypot(b.pos[0] - cx, b.pos[2] - cz));
    let boards = 0;
    for (const w of near) {
      if (boards >= Math.round(BARRICADES_PER_ZONE * scale)) break;
      const o = w.opening;
      const sill = o.center[1] - o.height / 2;
      const slitAt = w.pos[1] + SLIT_EYE - sill;
      if (slitAt < 0.2 || slitAt > o.height - 0.18) continue;
      const [fx, fz] = w.facing;
      // Boards on the inside face of the wall.
      const inset = 0.2;
      plan.slots.push({
        kind: 'barricade',
        zone: zone.id,
        pos: [o.center[0] - fx * inset, o.center[1], o.center[2] - fz * inset],
        yaw: Math.atan2(-fx, -fz),
        stand: [...w.pos],
        size: [o.width, o.height, slitAt],
      });
      used.add(w);
      boards++;
    }
  }
  return plan;
}

/** Probe over the real world: ground from terrain + physics, clearance from colliders. */
export function worldProbe(physics: PhysicsWorld, groundAt: (x: number, z: number) => number, inside: (x: number, z: number) => boolean, wet: (x: number, y: number, z: number) => boolean): PlanProbe {
  const down = { x: 0, y: -1, z: 0 };
  return {
    ground(x, z) {
      if (!inside(x, z)) return null;
      const terrain = groundAt(x, z);
      const hit = physics.raycast({ x, y: terrain + 30, z }, down, 60, Layer.WORLD);
      if (!hit) return null;
      // On the ground, not on a roof, bridge deck or crate.
      if (Math.abs(hit.point.y - terrain) > 0.35) return null;
      if (wet(x, hit.point.y, z)) return null;
      return { y: hit.point.y, level: hit.normal.y > 0.94 };
    },
    clear(x, y, z, size, yaw) {
      // Lifted a little so gentle slopes under the corners don't count.
      return !physics.overlapsBox({ x, y: y + 0.25 + size[1] / 2, z }, { x: size[0] / 2, y: size[1] / 2, z: size[2] / 2 }, yaw, Layer.WORLD | Layer.BOUNDS);
    },
  };
}

// ---------------------------------------------------------------------------
// Runtime

export interface FortSlot {
  id: number;
  kind: FortKind;
  zone: string;
  pos: THREE.Vector3;
  yaw: number;
  stand: THREE.Vector3;
  size: [number, number, number];
  /** Seconds of work put in (built at FORT[kind].build). */
  work: number;
  built: boolean;
  health: number;
  colliders: RAPIER.Collider[];
  /** Navmesh holes cut while built (one per solid part). */
  obstacles: Obstacle[];
  /** Solid parts once built (local). */
  parts: FortPart[];
  model: THREE.Group;
  ghost: THREE.Group;
  /** Box outline shown in build mode. */
  outline: THREE.LineSegments;
  /** Centre of the structure (for aiming at it and blasts). */
  center: THREE.Vector3;
}

export interface Station {
  id: number;
  kind: StationKind;
  zone: string;
  pos: THREE.Vector3;
  yaw: number;
  uses: number;
  /** Seconds of refill work toward the next use. */
  refill: number;
  icon: THREE.Sprite;
}

/** Something a soldier can do at a spot. */
export type FortJob = { type: 'build'; slot: FortSlot } | { type: 'refill'; station: Station } | { type: 'use'; station: Station };

export class Fortifications {
  readonly slots: FortSlot[] = [];
  readonly stations: Station[] = [];
  readonly group = new THREE.Group();
  /** Fired when something that casts shadows appears or goes. */
  onChange: (() => void) | null = null;
  /** Score for building / refilling (combatant id, points; fractions are fine). */
  onPoints: ((id: number, points: number) => void) | null = null;
  private readonly icons: Record<StationKind, THREE.SpriteMaterial>;

  constructor(
    plan: FortPlan,
    private readonly models: FortModels,
    private readonly physics: PhysicsWorld,
    private readonly impacts: SurfaceRegistry,
    private readonly nav: NavWorld | null,
  ) {
    this.group.name = 'fortifications';
    this.icons = { ammo: stationIcon('ammo'), medical: stationIcon('medical') };
    let id = 1;
    for (const p of plan.slots) {
      const size: [number, number, number] = p.size ?? [...FORT_SIZE[p.kind === 'barricade' ? 'sandbag' : p.kind]];
      const model = models.build(p.kind, size);
      const ghost = models.build(p.kind, size, true);
      for (const g of [model, ghost]) {
        g.position.set(...p.pos);
        g.rotation.y = p.yaw;
        g.matrixAutoUpdate = g === model;
        g.updateMatrix();
        this.group.add(g);
      }
      model.visible = false;
      // Barricades sit centred on their window; everything else stands on the ground.
      const [w, h, d] = size;
      const center = new THREE.Vector3(p.pos[0], p.pos[1] + (p.kind === 'barricade' ? 0 : h / 2), p.pos[2]);
      const outline = new THREE.LineSegments(models.outlineGeometry, models.outlineBuild);
      outline.position.copy(center);
      outline.rotation.y = p.yaw;
      outline.scale.set(w + 0.12, h + 0.12, p.kind === 'barricade' ? 0.3 : d + 0.12);
      outline.renderOrder = 6;
      outline.visible = false;
      outline.matrixAutoUpdate = false;
      outline.updateMatrix();
      this.group.add(outline);
      this.slots.push({
        id: id++,
        kind: p.kind,
        zone: p.zone,
        pos: new THREE.Vector3(...p.pos),
        yaw: p.yaw,
        stand: new THREE.Vector3(...p.stand),
        size,
        work: 0,
        built: false,
        health: 0,
        colliders: [],
        obstacles: [],
        parts: fortParts(p.kind, size),
        model,
        ghost,
        outline,
        center,
      });
    }
    for (const p of plan.stations) {
      const model = models.build(p.kind);
      model.position.set(...p.pos);
      model.rotation.y = p.yaw;
      model.matrixAutoUpdate = false;
      model.updateMatrix();
      this.group.add(model);
      const pos = new THREE.Vector3(...p.pos);
      // Stations block like the crates they are.
      const [w, h, d] = FORT_SIZE[p.kind];
      const c = physics.addStaticBox({ x: pos.x, y: pos.y + h / 2, z: pos.z }, { x: w / 2 - 0.1, y: h / 2, z: d / 2 - 0.1 }, yawQuat(p.yaw));
      impacts.set(c.handle, 'wood');
      nav?.addBox({ x: pos.x, y: pos.y + h / 2, z: pos.z }, { x: w / 2, y: h / 2 + 0.3, z: d / 2 }, p.yaw);
      const icon = new THREE.Sprite(this.icons[p.kind]);
      icon.scale.setScalar(0.028);
      icon.position.set(pos.x, pos.y + h + 0.7, pos.z);
      icon.renderOrder = 5;
      this.group.add(icon);
      this.stations.push({ id: id++, kind: p.kind, zone: p.zone, pos, yaw: p.yaw, uses: STATION.uses, refill: 0, icon });
    }
  }

  /** Per sim step: bakes navmesh changes. */
  step(): void {
    this.nav?.update();
  }

  /**
   * Per frame: station icons and empty build spots show up close by. In build
   * mode the spots show from further off, brighter and outlined, and the one
   * aimed at stands out (green, outline through walls).
   */
  render(camera: THREE.Vector3, building = false, target: FortSlot | null = null): void {
    for (const s of this.stations) s.icon.visible = s.pos.distanceToSquared(camera) < 45 * 45;
    const m = this.models;
    const far = (building ? 60 : 28) ** 2;
    for (const s of this.slots) {
      const show = !s.built && s.pos.distanceToSquared(camera) < far;
      s.ghost.visible = show;
      s.outline.visible = show && building;
      if (!show) continue;
      const mat = s === target ? m.ghostTarget : building ? m.ghostBuild : m.ghostMaterial;
      const first = s.ghost.children[0] as THREE.Mesh | undefined;
      if (first && first.material !== mat) for (const c of s.ghost.children) (c as THREE.Mesh).material = mat;
      s.outline.material = s === target ? m.outlineTarget : m.outlineBuild;
    }
  }

  /**
   * The unbuilt spot the view ray (eye, unit dir) points at within reach, or
   * null: the nearest one whose rough bounding sphere the ray passes through.
   */
  aimAt(eye: THREE.Vector3, dir: THREE.Vector3, reach = BUILD_REACH): FortSlot | null {
    let best: FortSlot | null = null;
    let bestT = Infinity;
    const v = this.tmp;
    for (const s of this.slots) {
      if (s.built) continue;
      const [w, h, d] = s.size;
      const radius = 0.5 * (s.kind === 'barricade' ? Math.hypot(w, h) : Math.hypot(w, Math.min(h, 1.2), d)) + 0.15;
      v.copy(s.center).sub(eye);
      const t = v.dot(dir);
      if (t < 0.2 || t - radius > reach || t >= bestT) continue;
      if (v.addScaledVector(dir, -t).length() > radius) continue;
      best = s;
      bestT = t;
    }
    return best;
  }

  /** Any unbuilt spot within `range` (horizontal) of `p`, on about the same level. */
  anyNear(p: THREE.Vector3, range: number): boolean {
    for (const s of this.slots) if (!s.built && Math.abs(s.stand.y - p.y) < 2 && Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < range) return true;
    return false;
  }

  /** Speed factor at `p`: slow inside built barbed wire. */
  slowAt(p: THREE.Vector3): number {
    for (const s of this.slots) {
      if (s.kind !== 'wire' || !s.built) continue;
      const [lx, lz] = this.toLocal(s, p);
      if (Math.abs(lx) < s.size[0] / 2 + 0.1 && Math.abs(lz) < s.size[2] / 2 + 0.15 && Math.abs(p.y - s.pos.y) < 1.2) return WIRE_SLOW;
    }
    return 1;
  }

  private toLocal(s: FortSlot, p: THREE.Vector3): [number, number] {
    const dx = p.x - s.pos.x;
    const dz = p.z - s.pos.z;
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    // Inverse of the slot's turn about Y.
    return [dx * c - dz * sn, dx * sn + dz * c];
  }

  /**
   * Puts `dt` seconds of a `cls` soldier's work into a slot. Returns the points
   * earned and whether it got finished. It won't finish while `blocked` (someone
   * is standing where it goes).
   */
  work(slot: FortSlot, dt: number, cls: ClassId, blocked: (slot: FortSlot) => boolean): { points: number; done: boolean } {
    if (slot.built) return { points: 0, done: false };
    const full = FORT[slot.kind].build;
    const before = slot.work;
    slot.work = Math.min(full, slot.work + dt * buildSpeed(cls));
    const points = ((slot.work - before) / buildSpeed(cls)) * buildPoints(cls);
    this.showProgress(slot);
    if (slot.work >= full && !blocked(slot)) {
      this.complete(slot);
      return { points, done: true };
    }
    return { points, done: false };
  }

  /** True if `p` (someone's feet) is inside where a ground structure's solid parts go once built. */
  occupies(slot: FortSlot, p: THREE.Vector3, pad = 0.35): boolean {
    if (slot.kind === 'barricade' || p.y < slot.pos.y - 1 || p.y > slot.pos.y + slot.size[1]) return false;
    const [lx, lz] = this.toLocal(slot, p);
    return slot.parts.some((q) => Math.abs(lx - q.c[0]) < q.s[0] / 2 + pad && Math.abs(lz - q.c[2]) < q.s[2] / 2 + pad);
  }

  private showProgress(slot: FortSlot): void {
    const t = slot.work / FORT[slot.kind].build;
    slot.model.visible = t > 0;
    // Rises from the ground as it goes up (barricades: boards fill in from the sill).
    slot.model.scale.set(1, slot.built ? 1 : Math.max(0.06, t * 0.92), 1);
    if (slot.kind === 'barricade') slot.model.position.y = slot.pos.y - (slot.size[1] / 2) * (1 - slot.model.scale.y);
    else slot.model.position.y = slot.pos.y;
  }

  complete(slot: FortSlot): void {
    if (slot.built) return;
    slot.built = true;
    slot.work = FORT[slot.kind].build;
    slot.health = FORT[slot.kind].health;
    slot.ghost.visible = false;
    this.showProgress(slot);
    const q = yawQuat(slot.yaw);
    const c = Math.cos(slot.yaw);
    const sn = Math.sin(slot.yaw);
    const surface = slot.kind === 'barricade' || slot.kind === 'timber' ? 'wood' : 'dirt';
    // Window boards are up in a wall: the navmesh never ran through windows anyway.
    const blocksNav = slot.kind !== 'barricade';
    for (const part of slot.parts) {
      const [lx, ly, lz] = part.c;
      const center = { x: slot.pos.x + lx * c + lz * sn, y: slot.pos.y + ly, z: slot.pos.z - lx * sn + lz * c };
      const [sx, sy, sz] = part.s;
      const col = this.physics.addStaticBox(center, { x: sx / 2, y: sy / 2, z: sz / 2 }, q);
      this.impacts.set(col.handle, surface);
      slot.colliders.push(col);
      if (!blocksNav || !this.nav) continue;
      // Tall enough to cover the ground under it, whatever the part's own height (timber's upper boards).
      const ground = slot.pos.y;
      const top = Math.max(center.y + sy / 2, ground + 0.6);
      const ob = this.nav.addBox({ x: center.x, y: (ground - 0.4 + top) / 2, z: center.z }, { x: sx / 2, y: (top - ground + 0.4) / 2, z: sz / 2 }, slot.yaw);
      if (ob) slot.obstacles.push(ob);
    }
    // Hedgehogs only stop vehicles (none yet) and wire only slows: nothing solid.
    this.onChange?.();
  }

  /** Blast damage on built things near `point`: `dmg(distance)` per piece. */
  blast(point: THREE.Vector3, radius: number, dmg: (distance: number) => number): FortSlot[] {
    const broken: FortSlot[] = [];
    for (const s of this.slots) {
      if (!s.built) continue;
      const d = Math.max(0, s.center.distanceTo(point) - 0.4);
      if (d > radius) continue;
      s.health -= dmg(d);
      if (s.health <= 0) {
        this.destroy(s);
        broken.push(s);
      }
    }
    return broken;
  }
  private readonly tmp = new THREE.Vector3();

  /** Knocked down: back to an empty spot. */
  destroy(slot: FortSlot): void {
    if (!slot.built) return;
    slot.built = false;
    slot.work = 0;
    slot.health = 0;
    for (const c of slot.colliders) this.physics.world.removeCollider(c, false);
    slot.colliders.length = 0;
    for (const ob of slot.obstacles) this.nav?.remove(ob);
    slot.obstacles.length = 0;

    slot.ghost.visible = true;
    this.showProgress(slot);
    this.onChange?.();
  }

  /**
   * A spot's state as the game server has it (a browser in a match there):
   * built or knocked down, or how far the building has got.
   */
  apply(slot: FortSlot, work: number, built: boolean): void {
    if (built) {
      this.complete(slot);
      return;
    }
    if (slot.built) this.destroy(slot);
    if (slot.work === work) return;
    slot.work = work;
    this.showProgress(slot);
  }

  /** A station use: true if there was one left. */
  use(station: Station): boolean {
    if (station.uses <= 0) return false;
    station.uses--;
    return true;
  }

  /** Refill work at a station; true when a use was put back. */
  refill(station: Station, dt: number): boolean {
    if (station.uses >= STATION.uses) {
      station.refill = 0;
      return false;
    }
    station.refill += dt;
    if (station.refill < STATION.refillSec) return false;
    station.refill = 0;
    station.uses++;
    return true;
  }

  /** Nearest unfinished build spot a soldier at `p` can work on. */
  slotAt(p: THREE.Vector3, range = WORK_RANGE): FortSlot | null {
    let best: FortSlot | null = null;
    let bestD = range;
    for (const s of this.slots) {
      if (s.built) continue;
      const d = s.stand.distanceTo(p);
      const d2 = s.kind === 'barricade' ? d : Math.min(d, Math.hypot(s.pos.x - p.x, s.pos.z - p.z) - 0.8);
      if (d2 < bestD && Math.abs(s.stand.y - p.y) < 1.5) {
        best = s;
        bestD = d2;
      }
    }
    return best;
  }

  stationAt(p: THREE.Vector3, range = WORK_RANGE): Station | null {
    let best: Station | null = null;
    let bestD = range + 0.9;
    for (const s of this.stations) {
      const d = Math.hypot(s.pos.x - p.x, s.pos.z - p.z);
      if (d < bestD && Math.abs(s.pos.y - p.y) < 1.5) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  /** Where to stand to work at a station (in front of it). */
  stationStand(s: Station, out = new THREE.Vector3()): THREE.Vector3 {
    const depth = FORT_SIZE[s.kind][2] / 2 + 0.8;
    return out.set(s.pos.x + Math.sin(s.yaw) * depth, s.pos.y, s.pos.z + Math.cos(s.yaw) * depth);
  }
}

function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
