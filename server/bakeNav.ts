/**
 * Bakes every map's navmeshes ahead of time (`npm run nav`, also run by
 * `npm run maps`): builds each map's world without a view, the way the game
 * builds it, generates the soldier and vehicle navmeshes (and the bots'
 * tactical points) and writes them to
 * public/nav/<key>.bin.gz under the same key the game's cache uses, gzipped
 * (about half the size). The site and the game server then load them instead
 * of spending seconds generating. Files no map uses any more are removed. The
 * folder is not in git: the deploy workflow bakes before building the site,
 * the server laptop after pulling.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { NavWorld, VehicleNav } from '../src/ai/NavWorld.ts';
import { onNavBuilt } from '../src/ai/navCache.ts';
import { loadTactics } from '../src/ai/tacticsLoad.ts';
import { MAPS } from '../src/data/maps.ts';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.ts';
import { SurfaceRegistry } from '../src/physics/surfaces.ts';
import { buildWorld } from '../src/sim/world.ts';
import { parseMap } from '../src/world/validateMap.ts';

const DIR = 'public/nav';
mkdirSync(DIR, { recursive: true });
const written = new Map<string, number>();
onNavBuilt((key, data) => {
  const gz = gzipSync(data, { level: 9 });
  writeFileSync(`${DIR}/${key}.bin.gz`, gz);
  written.set(key, gz.byteLength);
});

for (const id of [...MAPS.map((m) => m.id), 'sandbox']) {
  const map = parseMap(JSON.parse(readFileSync(`public/maps/${id}.json`, 'utf8')));
  const physics = await PhysicsWorld.create();
  const world = buildWorld(map, physics, new SurfaceRegistry());
  // Colliders into the broadphase before the navmesh reads them (as the game does).
  physics.step();
  const extra = world.built.navExtra ?? undefined;
  const t0 = performance.now();
  const before = new Set(written.keys());
  const nav = await NavWorld.build(physics, extra);
  const t1 = performance.now();
  // Vehicles come with zone matches (bot drivers route on their own mesh).
  const veh = (map.zones?.length ?? 0) > 0 ? await VehicleNav.build(physics, extra) : null;
  const t2 = performance.now();
  // The bots' tactical points (cover, peek spots), from the soldier navmesh.
  if (nav) await loadTactics(nav, physics);
  const keys = [...written.keys()].filter((k) => !before.has(k));
  const kb = keys.map((k) => `${k} ${Math.round(written.get(k)! / 1024)} KB`).join(', ');
  console.log(`${id}: navmesh ${nav ? Math.round(t1 - t0) : 'failed'} ms, vehicles ${veh ? `${Math.round(t2 - t1)} ms` : '-'} (${kb})`);
  physics.dispose();
}

for (const f of readdirSync(DIR)) {
  if (!written.has(f.replace(/\.bin(\.gz)?$/, ''))) {
    rmSync(`${DIR}/${f}`);
    console.log(`removed ${f} (no map uses it)`);
  }
}
