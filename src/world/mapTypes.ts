import type { ModelKind } from './modelKits';
export type Vec3 = [number, number, number];
export type Team = 'blue' | 'red';
export type VisualProfileId = 'outdoor_day' | 'overcast' | 'indoor' | 'winter' | 'desert';
export type SurfaceMaterial =
  | 'ground'
  | 'concrete'
  | 'concrete_floor'
  | 'metal'
  | 'wood'
  | 'brick'
  | 'snow'
  | 'grass'
  | 'sand'
  /** Painted render on old walls. */
  | 'plaster'
  /** Worn red brick with plaster patches (old industrial). */
  | 'brick_old'
  /** Clay roof tiles (pitched roofs). */
  | 'roof'
  | 'asphalt'
  /** Cobbles: old-town streets, pavements and squares. */
  | 'cobble'
  /** Bare rock (steep terrain). */
  | 'rock';
/** Kind of trees on a map and in its scenery (default conifer). */
export type Flora = 'conifer' | 'broadleaf' | 'palm';
export type ObjectType = 'wall' | 'cover' | 'floor' | 'ramp' | 'prop';

export interface MapObject {
  type: ObjectType;
  /** Box center in meters. */
  pos: Vec3;
  /** Full box extents in meters. */
  size: Vec3;
  /** Euler rotation in degrees (XYZ order). */
  rot?: Vec3;
  material?: SurfaceMaterial;
  color?: string;
  /** pos[1] is relative to the ground at (x, z) instead of absolute. */
  snap?: boolean;
  /** Draw a procedural model filling the box instead of the box itself (see world/modelKits). */
  model?: ModelKind;
  /** Height of the model's ground above the box bottom (boxes sink a little into the terrain). */
  base?: number;
}

export interface SpawnPoint {
  team: Team | 'player';
  pos: Vec3;
  /** Degrees; 0 faces -Z. */
  yaw: number;
}

export interface ZoneDef {
  id: string;
  pos: Vec3;
  radius: number;
}

/** A glTF model instance from public/assets/models/<model>.glb. */
export interface PropDef {
  model: string;
  /** Position of the model origin (usually its base) in meters. */
  pos: Vec3;
  /** Euler rotation in degrees (XYZ order). */
  rot?: Vec3;
  scale?: number;
  /** Adds a box collider fitted to the model bounds. Default true. */
  collide?: boolean;
  /** pos[1] is relative to the ground at (x, z). */
  snap?: boolean;
}

/** Smooth ground shape (see world/terrain.ts). Heights in meters. */
export interface TerrainDef {
  /** Grid cell size in meters (default 2). */
  cell?: number;
  /** Amplitude of gentle noise over the whole map (default 0). */
  noise?: number;
  /** Cosine bumps (negative height = dip). */
  hills?: { pos: [number, number]; radius: number; height: number }[];
  /** Level pads (buildings get one automatically). `height` defaults to the local ground. */
  flats?: { pos: [number, number]; radius: number; height?: number; blend?: number }[];
  /** River channels carved into the ground, with a water surface (see world/river.ts). */
  rivers?: RiverDef[];
}

export interface RiverDef {
  /** Centre line [x, z][], upstream first. */
  pts: [number, number][];
  /** Width of the flat river bed (m). */
  width: number;
  /** Depth of the bed below the surrounding ground (m). */
  depth: number;
  /** Width of the sloped bank on each side (m, default 5). */
  bank?: number;
  /** Water depth above the bed (m, default 0.6: wadeable). */
  water?: number;
  /** Bridge centres [x, z]: bots walk round to these rather than wade when it isn't far. */
  crossings?: [number, number][];
}

export type BuildingStyle =
  | 'house'
  | 'shop'
  | 'apartment'
  | 'townhall'
  | 'warehouse'
  | 'barracks'
  | 'hangar'
  | 'hq'
  | 'station'
  | 'shed'
  | 'barn'
  | 'chapel'
  | 'tower'
  | 'factory'
  | 'office'
  | 'gasShop'
  | 'hospital'
  | 'inn'
  | 'mill'
  | 'depot'
  | 'hotel';

/**
 * A generated building (world/buildings.ts): outer walls with door and window
 * openings, floors with a stair ramp between them, and a roof. Sits on the ground.
 */
export interface BuildingDef {
  /** Footprint center [x, z]. */
  pos: [number, number];
  /** Footprint [width (local x), depth (local z)]. */
  size: [number, number];
  style?: BuildingStyle;
  floors?: number;
  /** Yaw in degrees. */
  rot?: number;
  /** Sides with a ground-floor door, local before rotation: any of "nsew" (n = -z). */
  doors?: string;
  /** Not enterable: one closed block (background buildings). */
  solid?: boolean;
  material?: SurfaceMaterial;
  color?: string;
  seed?: number;
}

export interface TargetDef {
  pos: Vec3;
  yaw?: number;
}

/** Sectors are lists of zone ids; a sector is held when one side holds all of its zones. */
export interface MapModes {
  /** The mode a bot match starts in when none is asked for (default zone). */
  default?: 'zone' | 'frontline' | 'conquest';
  zone?: { target?: number };
  /** Sectors from the blue base to the red one; attack timer and match clock in seconds. */
  frontline?: { sectors: string[][]; attackTime?: number; matchTime?: number };
  /** Sectors in attack order. */
  conquest?: { attacker: Team; sectors: string[][] };
}

export interface MapDef {
  meta: { id: string; name: string; version: 2 };
  world: {
    /** Ground plane size [x, z] centered at origin (covers the boundary plus a margin). */
    size: [number, number];
    /** Playable-area outline [x, z][] (default: the size rectangle). */
    boundary?: [number, number][];
    terrain?: TerrainDef;
    visualProfile: VisualProfileId;
    groundMaterial?: SurfaceMaterial;
    /** Tree kind for `trees` and the scenery around the map (default conifer). */
    flora?: Flora;
    /** Vehicles in bot matches: all (default), noJets (no aircraft), or light — jeeps and motorbikes only (small maps). */
    vehicles?: 'all' | 'noJets' | 'light';
    /** Background sound levels 0..1 (defaults come from the visual profile). */
    ambience?: { wind?: number; birds?: number; battle?: number };
  };
  spawns: SpawnPoint[];
  zones?: ZoneDef[];
  /** Which modes the map plays and their numbers (see modes/matchRules.ts); without it: Zone only. */
  modes?: MapModes;
  objects: MapObject[];
  buildings?: BuildingDef[];
  props?: PropDef[];
  /** Conifers standing in the playable area: [x, z, scale] (trunks collide; see world/forest.ts). */
  trees?: [number, number, number][];
  /** Practice dummies (sandbox/training maps). */
  targets?: TargetDef[];
}
