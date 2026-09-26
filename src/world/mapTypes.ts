export type Vec3 = [number, number, number];
export type Team = 'blue' | 'red';
export type VisualProfileId = 'outdoor_day' | 'overcast' | 'indoor';
export type SurfaceMaterial = 'ground' | 'concrete' | 'concrete_floor' | 'metal' | 'wood' | 'brick';
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
}

export interface TargetDef {
  pos: Vec3;
  yaw?: number;
}

export interface MapDef {
  meta: { id: string; name: string; version: 2 };
  world: {
    /** Ground plane size [x, z] centered at origin. */
    size: [number, number];
    visualProfile: VisualProfileId;
    groundMaterial?: SurfaceMaterial;
  };
  spawns: SpawnPoint[];
  zones?: ZoneDef[];
  objects: MapObject[];
  props?: PropDef[];
  /** Practice dummies (sandbox/training maps). */
  targets?: TargetDef[];
}
