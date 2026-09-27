import type { MapDef } from './mapTypes';
import { MODEL_KINDS } from './modelKits';

const OBJECT_TYPES = new Set(['wall', 'cover', 'floor', 'ramp', 'prop']);
const PROFILES = new Set(['outdoor_day', 'overcast', 'indoor', 'winter']);
const MATERIALS = new Set(['ground', 'concrete', 'concrete_floor', 'metal', 'wood', 'brick', 'snow']);

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isVec3(v: unknown): boolean {
  return Array.isArray(v) && v.length === 3 && v.every(isNum);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Returns a list of human-readable problems; empty means the map is valid. */
export function validateMap(raw: unknown): string[] {
  const errs: string[] = [];
  if (!isObj(raw)) return ['map: not an object'];

  const meta = raw.meta;
  if (!isObj(meta) || typeof meta.id !== 'string' || typeof meta.name !== 'string') {
    errs.push('meta: id and name are required strings');
  } else if (meta.version !== 2) {
    errs.push(`meta.version: expected 2, got ${String(meta.version)}`);
  }

  const world = raw.world;
  if (!isObj(world)) {
    errs.push('world: required');
  } else {
    const size = world.size;
    if (!Array.isArray(size) || size.length !== 2 || !size.every((n) => isNum(n) && n > 0)) {
      errs.push('world.size: expected [x, z] with positive numbers');
    }
    if (!PROFILES.has(String(world.visualProfile))) {
      errs.push(`world.visualProfile: unknown "${String(world.visualProfile)}"`);
    }
    if (world.groundMaterial !== undefined && !MATERIALS.has(String(world.groundMaterial))) {
      errs.push(`world.groundMaterial: unknown "${String(world.groundMaterial)}"`);
    }
    const rivers = isObj(world.terrain) ? world.terrain.rivers : undefined;
    if (rivers !== undefined) {
      if (!Array.isArray(rivers)) errs.push('world.terrain.rivers: expected array');
      else
        rivers.forEach((r, i) => {
          const okPts = isObj(r) && Array.isArray(r.pts) && r.pts.length >= 2 && r.pts.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNum));
          if (!okPts || !isNum(r.width) || r.width <= 0 || !isNum(r.depth) || r.depth <= 0) {
            errs.push(`world.terrain.rivers[${i}]: expected { pts: [x,z][] (2+), width > 0, depth > 0 }`);
          } else if ((r.water !== undefined && !(isNum(r.water) && r.water >= 0 && r.water < r.depth)) || (r.bank !== undefined && !(isNum(r.bank) && r.bank >= 0))) {
            errs.push(`world.terrain.rivers[${i}]: water must be 0..depth, bank >= 0`);
          }
        });
    }
    if (world.ambience !== undefined) {
      const amb = world.ambience;
      const keys = ['wind', 'birds', 'battle'];
      if (!isObj(amb) || Object.entries(amb).some(([k, v]) => !keys.includes(k) || !isNum(v) || v < 0 || v > 1)) {
        errs.push('world.ambience: expected { wind?, birds?, battle? } with values 0..1');
      }
    }
  }

  if (!Array.isArray(raw.spawns) || raw.spawns.length === 0) {
    errs.push('spawns: at least one spawn is required');
  } else {
    raw.spawns.forEach((s, i) => {
      if (!isObj(s) || !isVec3(s.pos) || !isNum(s.yaw) || !['blue', 'red', 'player'].includes(String(s.team))) {
        errs.push(`spawns[${i}]: expected { team, pos: [x,y,z], yaw }`);
      }
    });
  }

  if (!Array.isArray(raw.objects)) {
    errs.push('objects: expected array');
  } else {
    raw.objects.forEach((o, i) => {
      if (!isObj(o)) return errs.push(`objects[${i}]: not an object`);
      if (!OBJECT_TYPES.has(String(o.type))) errs.push(`objects[${i}].type: unknown "${String(o.type)}"`);
      if (!isVec3(o.pos)) errs.push(`objects[${i}].pos: expected [x,y,z]`);
      if (!isVec3(o.size) || !(o.size as number[]).every((n) => n > 0)) {
        errs.push(`objects[${i}].size: expected positive [x,y,z]`);
      }
      if (o.rot !== undefined && !isVec3(o.rot)) errs.push(`objects[${i}].rot: expected [x,y,z] degrees`);
      if (o.material !== undefined && !MATERIALS.has(String(o.material))) {
        errs.push(`objects[${i}].material: unknown "${String(o.material)}"`);
      }
      if (o.model !== undefined && !(MODEL_KINDS as readonly string[]).includes(String(o.model))) {
        errs.push(`objects[${i}].model: unknown "${String(o.model)}"`);
      }
      if (o.base !== undefined && (!isNum(o.base) || o.base < 0)) errs.push(`objects[${i}].base: expected a number >= 0`);
    });
  }

  if (raw.zones !== undefined) {
    if (!Array.isArray(raw.zones)) errs.push('zones: expected array');
    else
      raw.zones.forEach((z, i) => {
        if (!isObj(z) || typeof z.id !== 'string' || !isVec3(z.pos) || !isNum(z.radius)) {
          errs.push(`zones[${i}]: expected { id, pos, radius }`);
        }
      });
  }

  if (raw.props !== undefined) {
    if (!Array.isArray(raw.props)) errs.push('props: expected array');
    else
      raw.props.forEach((p, i) => {
        if (!isObj(p) || typeof p.model !== 'string' || !/^[a-z0-9_]+$/.test(p.model) || !isVec3(p.pos)) {
          errs.push(`props[${i}]: expected { model: snake_case id, pos: [x,y,z] }`);
          return;
        }
        if (p.rot !== undefined && !isVec3(p.rot)) errs.push(`props[${i}].rot: expected [x,y,z] degrees`);
        if (p.scale !== undefined && !(isNum(p.scale) && p.scale > 0)) errs.push(`props[${i}].scale: expected positive number`);
      });
  }

  if (raw.trees !== undefined) {
    if (!Array.isArray(raw.trees)) errs.push('trees: expected array');
    else {
      const bad = raw.trees.findIndex((t) => !Array.isArray(t) || t.length !== 3 || !t.every(isNum) || (t[2] as number) <= 0);
      if (bad >= 0) errs.push(`trees[${bad}]: expected [x, z, scale > 0]`);
    }
  }

  if (raw.targets !== undefined) {
    if (!Array.isArray(raw.targets)) errs.push('targets: expected array');
    else
      raw.targets.forEach((t, i) => {
        if (!isObj(t) || !isVec3(t.pos)) errs.push(`targets[${i}]: expected { pos }`);
      });
  }

  return errs;
}

export function parseMap(raw: unknown): MapDef {
  const errs = validateMap(raw);
  if (errs.length) throw new Error(`Invalid map:\n- ${errs.join('\n- ')}`);
  return raw as MapDef;
}

export async function fetchMap(url: string): Promise<MapDef> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Map fetch failed (${res.status}): ${url}`);
  return parseMap(await res.json());
}
