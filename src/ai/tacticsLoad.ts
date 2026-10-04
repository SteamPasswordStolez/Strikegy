import { getNavMeshPositionsAndIndices } from 'recast-navigation';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import { hashNavInput, loadNav, saveNav } from './navCache';
import { skipCache, type NavWorld } from './NavWorld';
import { TACTICS, TacticalMap, buildTactical } from './tactics';

/**
 * The map's tactical points (see `tactics.ts`): from the navmesh and the
 * static world, cached in IndexedDB under a hash of the navmesh and the
 * settings like the navmesh itself (a repeat load reads them back).
 */
export async function loadTactics(nav: NavWorld, physics: PhysicsWorld, pause?: () => Promise<void>): Promise<TacticalMap> {
  const [positions, indices] = getNavMeshPositionsAndIndices(nav.navMesh);
  const key = `tac1:${hashNavInput(positions, indices, JSON.stringify(TACTICS))}`;
  const cached = skipCache() ? null : await loadNav(key);
  const fromCache = cached ? TacticalMap.fromBytes(cached) : null;
  if (fromCache) return fromCache;
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number): boolean => {
    a.x = ox;
    a.y = oy;
    a.z = oz;
    b.x = ox + dx * len;
    b.y = oy + dy * len;
    b.z = oz + dz * len;
    return physics.blocked(a, b, Layer.WORLD);
  };
  const map = await buildTactical(positions, indices, ray, pause);
  void saveNav(key, map.toBytes());
  return map;
}
