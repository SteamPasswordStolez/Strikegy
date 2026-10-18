import { getNavMeshPositionsAndIndices } from 'recast-navigation';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import { bakedNav, hashNavInput, loadNav, saveNav } from './navCache';
import { skipCache, type NavWorld } from './NavWorld';
import { TACTICS, TacticalMap, buildTactical } from './tactics';

/**
 * The map's tactical points (see `tactics.ts`): from the navmesh and the
 * static world, cached in IndexedDB under a hash of the navmesh and the
 * settings like the navmesh itself (a repeat load reads them back), or baked
 * ahead with the navmeshes (`npm run nav`).
 */
export async function loadTactics(nav: NavWorld, physics: PhysicsWorld, pause?: () => Promise<void>): Promise<TacticalMap> {
  const [positions, indices] = navTriangles(nav);
  const key = `tac1:${hashNavInput(positions, indices, JSON.stringify(TACTICS))}`;
  const cached = skipCache() ? null : ((await loadNav(key)) ?? (await bakedNav(key)));
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

/** Every navmesh part's triangles; a big map's coarse mesh only outside the fine patches (no points twice). */
function navTriangles(nav: NavWorld): [number[], number[]] {
  const parts = nav.parts();
  if (parts.length === 1) return getNavMeshPositionsAndIndices(parts[0]!.navMesh);
  const positions: number[] = [];
  const indices: number[] = [];
  for (const { navMesh, keep } of parts) {
    const [pos, idx] = getNavMeshPositionsAndIndices(navMesh);
    const base = positions.length / 3;
    for (const v of pos) positions.push(v);
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i]! * 3;
      const b = idx[i + 1]! * 3;
      const c = idx[i + 2]! * 3;
      if (keep && !keep((pos[a]! + pos[b]! + pos[c]!) / 3, (pos[a + 2]! + pos[b + 2]! + pos[c + 2]!) / 3)) continue;
      indices.push(base + idx[i]!, base + idx[i + 1]!, base + idx[i + 2]!);
    }
  }
  return [positions, indices];
}
