import * as THREE from 'three';
import type { Obstacle } from 'recast-navigation';
import { Layer, type PhysicsWorld, type RAPIER } from '@/physics/PhysicsWorld';
import type { SurfaceRegistry } from '@/physics/surfaces';
import type { NavWorld } from '@/ai/NavWorld';
import type { ClassId } from '@/data/classes';
import type { WindowSpot } from '@/world/buildings';
import type { ZoneDef } from '@/world/mapTypes';
import { FORT_SIZE, type FortModels, stationIcon } from '@/world/fortModels';

/*
 * Zone fortifications and supply stations (design doc section 5).
 * Every zone gets an ammo station and a medical station (5 uses each, refilled
 * by supports / medics working at them) and a few build spots: sandbag walls
 * around it, barricades for the windows of nearby buildings and anti-tank
 * hedgehogs on the approaches. Anyone can build; built things can be blown up
 * and built again. Spots are found when the map loads (no map data needed).
 */

export type FortKind = 'sandbag' | 'barricade' | 'hedgehog';
export type StationKind = 'ammo' | 'medical';

/** Seconds of work to build (supports work twice as fast) and health once built. */
export const FORT: Record<FortKind, { build: number; health: number }> = {
  sandbag: { build: 6, health: 260 },
  barricade: { build: 4, health: 140 },
  hedgehog: { build: 8, health: 390 },
};

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

const SANDBAGS_PER_ZONE = 3;
const HEDGEHOGS_PER_ZONE = 2;
const BARRICADES_PER_ZONE = 3;
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
export function planFortifications(zones: readonly ZoneDef[], windows: readonly WindowSpot[], footprints: readonly Footprint[], probe: PlanProbe): FortPlan {
  const plan: FortPlan = { slots: [], stations: [] };
  const used = new Set<WindowSpot>();
  for (const zone of zones) {
    const [cx, , cz] = zone.pos;
    const R = zone.radius;
    const taken: { x: number; z: number; r: number }[] = [];
    const free = (x: number, z: number, r: number) => taken.every((t) => Math.hypot(t.x - x, t.z - z) >= t.r + r);
    const start = (hashId(zone.id) % 16) / 16;
    /** Candidate points on rings around the zone centre, spread round the circle. */
    function* ring(radii: number[], steps = 16): Generator<{ x: number; z: number; a: number }> {
      for (const f of radii) {
        for (let i = 0; i < steps; i++) {
          // Interleave (0, 8, 4, 12, ...) so early picks spread out.
          const k = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15][i % 16]!;
          const a = ((start + k / 16) % 1) * Math.PI * 2;
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

    // Sandbag walls near the edge, long side across the way in, front facing out.
    let bags = 0;
    for (const p of ring([0.72, 0.6, 0.85], 16)) {
      if (bags >= SANDBAGS_PER_ZONE) break;
      const g = probe.ground(p.x, p.z);
      if (!g || nearBuilding(footprints, p.x, p.z, 2.2) || !free(p.x, p.z, 3)) continue;
      const ox = Math.cos(p.a);
      const oz = Math.sin(p.a);
      const yaw = Math.atan2(-ox, -oz);
      if (!probe.clear(p.x, g.y, p.z, [FORT_SIZE.sandbag[0] + 0.4, FORT_SIZE.sandbag[1], FORT_SIZE.sandbag[2] + 0.4], yaw)) continue;
      // Room behind it to stand and build.
      const sx = p.x - ox * 1.1;
      const sz = p.z - oz * 1.1;
      const sg = probe.ground(sx, sz);
      if (!sg || Math.abs(sg.y - g.y) > 0.6) continue;
      plan.slots.push({ kind: 'sandbag', zone: zone.id, pos: [p.x, g.y, p.z], yaw, stand: [sx, sg.y, sz] });
      taken.push({ x: p.x, z: p.z, r: 3 });
      bags++;
    }

    // Hedgehogs out on the approaches.
    let hogs = 0;
    for (const p of ring([1.1, 1.25, 0.95], 16)) {
      if (hogs >= HEDGEHOGS_PER_ZONE) break;
      const g = probe.ground(p.x, p.z);
      if (!g || nearBuilding(footprints, p.x, p.z, 2) || !free(p.x, p.z, 4)) continue;
      if (!probe.clear(p.x, g.y, p.z, FORT_SIZE.hedgehog, 0)) continue;
      const sx = p.x - Math.cos(p.a) * 1.4;
      const sz = p.z - Math.sin(p.a) * 1.4;
      const sg = probe.ground(sx, sz);
      if (!sg) continue;
      plan.slots.push({ kind: 'hedgehog', zone: zone.id, pos: [p.x, g.y, p.z], yaw: p.a, stand: [sx, sg.y, sz] });
      taken.push({ x: p.x, z: p.z, r: 4 });
      hogs++;
    }

    // Barricades for the nearest windows of buildings in / at the zone.
    const near = windows
      .filter((w) => !used.has(w) && Math.hypot(w.opening.center[0] - cx, w.opening.center[2] - cz) < R + 4)
      .sort((a, b) => Math.hypot(a.pos[0] - cx, a.pos[2] - cz) - Math.hypot(b.pos[0] - cx, b.pos[2] - cz));
    let boards = 0;
    for (const w of near) {
      if (boards >= BARRICADES_PER_ZONE) break;
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
  obstacle: Obstacle | null;
  model: THREE.Group;
  ghost: THREE.Group;
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
    models: FortModels,
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
        obstacle: null,
        model,
        ghost,
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

  /** Per frame: station icons and empty build spots show up close by. */
  render(camera: THREE.Vector3): void {
    for (const s of this.stations) s.icon.visible = s.pos.distanceToSquared(camera) < 45 * 45;
    for (const s of this.slots) s.ghost.visible = !s.built && s.pos.distanceToSquared(camera) < 28 * 28;
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

  /** Ground rectangle a slot takes up once built (for "someone is in the way"). */
  occupies(slot: FortSlot, p: THREE.Vector3, pad = 0.35): boolean {
    if (slot.kind !== 'sandbag') return false;
    const dx = p.x - slot.pos.x;
    const dz = p.z - slot.pos.z;
    const c = Math.cos(slot.yaw);
    const s = Math.sin(slot.yaw);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const [w, h, d] = slot.size;
    return Math.abs(lx) < w / 2 + pad && Math.abs(lz) < d / 2 + pad && p.y > slot.pos.y - 1 && p.y < slot.pos.y + h;
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
    const [w, h, d] = slot.size;
    if (slot.kind === 'sandbag') {
      const center = { x: slot.pos.x, y: slot.pos.y + h / 2 - 0.05, z: slot.pos.z };
      const c = this.physics.addStaticBox(center, { x: w / 2, y: h / 2 - 0.05, z: d / 2 - 0.05 }, q);
      this.impacts.set(c.handle, 'dirt');
      slot.colliders.push(c);
      slot.obstacle = this.nav?.addBox(center, { x: w / 2, y: h / 2 + 0.4, z: d / 2 }, slot.yaw) ?? null;
    } else if (slot.kind === 'barricade') {
      // Boards below and above the slit; the slit stays open to shoot through.
      const slit = 0.26;
      const bottom = slot.pos.y - h / 2;
      const slitLo = bottom + d - slit / 2;
      const slitHi = slitLo + slit;
      const top = slot.pos.y + h / 2;
      const half = { x: w / 2 + 0.1, z: 0.04 };
      for (const [lo, hi] of [
        [bottom, slitLo],
        [slitHi, top],
      ] as const) {
        if (hi - lo < 0.02) continue;
        const c = this.physics.addStaticBox({ x: slot.pos.x, y: (lo + hi) / 2, z: slot.pos.z }, { x: half.x, y: (hi - lo) / 2, z: half.z }, q);
        this.impacts.set(c.handle, 'wood');
        slot.colliders.push(c);
      }
    }
    // Hedgehogs only stop vehicles (none yet): soldiers walk and shoot through the gaps.
    this.onChange?.();
  }

  /** Blast damage on built things near `point`: `dmg(distance)` per piece. */
  blast(point: THREE.Vector3, radius: number, dmg: (distance: number) => number): FortSlot[] {
    const broken: FortSlot[] = [];
    for (const s of this.slots) {
      if (!s.built) continue;
      const center = s.kind === 'barricade' ? s.pos : this.tmp.copy(s.pos).setY(s.pos.y + s.size[1] / 2);
      const d = Math.max(0, center.distanceTo(point) - 0.4);
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
    if (slot.obstacle !== null) this.nav?.remove(slot.obstacle);
    slot.obstacle = null;
    slot.ghost.visible = true;
    this.showProgress(slot);
    this.onChange?.();
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
