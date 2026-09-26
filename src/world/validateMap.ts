import type { MapDef } from './mapTypes';

const OBJECT_TYPES = new Set(['wall', 'cover', 'floor', 'ramp', 'prop']);
const PROFILES = new Set(['outdoor_day', 'overcast', 'indoor']);
const MATERIALS = new Set(['ground', 'concrete', 'metal', 'wood', 'brick']);

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
