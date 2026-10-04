/**
 * Navmesh cache in IndexedDB. Generating the navmesh for a big map takes
 * seconds (much longer on phones); the result only depends on the input
 * geometry and the build settings, so it is stored under a hash of exactly
 * those and reused on later loads. Any change to the map changes the hash.
 * Every call fails soft: no IndexedDB (private mode, old browser) = no cache.
 *
 * Before building, a navmesh baked ahead of time is looked up by the same key
 * (`npm run nav` writes them to public/nav/<key>.bin.gz): the site serves them,
 * the game server reads them from disk (`setNavFiles`). A map changed since
 * the bake hashes differently, misses the file and is built as before.
 */

/** Where baked navmeshes come from: the site's nav/ folder, or the server's disk. */
let navFiles: (key: string) => Promise<Uint8Array | null> = async (key) => {
  if (typeof fetch === 'undefined' || typeof location === 'undefined') return null;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}nav/${key}.bin.gz`);
    // A dev server answers unknown paths with the page itself: only a binary body counts.
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Still gzipped unless the server already unpacked it on the way.
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
    if (typeof DecompressionStream === 'undefined') return null;
    const out = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(out).arrayBuffer());
  } catch {
    return null;
  }
};

/** Replaces the baked-navmesh lookup (the game server reads files). */
export function setNavFiles(fn: (key: string) => Promise<Uint8Array | null>): void {
  navFiles = fn;
}

/** Told about every navmesh built here (the bake script writes them out). */
let navBuilt: ((key: string, data: Uint8Array) => void) | null = null;

export function onNavBuilt(fn: ((key: string, data: Uint8Array) => void) | null): void {
  navBuilt = fn;
}

/** A baked navmesh for `key`, or null. */
export function bakedNav(key: string): Promise<Uint8Array | null> {
  return navFiles(key);
}

const DB = 'strikegy-nav';
const STORE = 'navmesh';
/** Keep only this many cached meshes (oldest dropped). */
const MAX_ENTRIES = 6;

/** FNV-1a over the input triangles and a settings string (32-bit, hex). */
export function hashNavInput(positions: ArrayLike<number>, indices: ArrayLike<number>, settings: string): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (let i = 0; i < settings.length; i++) mix(settings.charCodeAt(i));
  // Positions rounded to millimeters so float noise between runs can't miss the cache.
  for (let i = 0; i < positions.length; i++) mix(Math.round(positions[i]! * 1000) | 0);
  for (let i = 0; i < indices.length; i++) mix(indices[i]! | 0);
  mix(positions.length);
  mix(indices.length);
  return h.toString(16).padStart(8, '0');
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadNav(key: string): Promise<Uint8Array | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result as { data?: Uint8Array } | undefined;
        resolve(v?.data instanceof Uint8Array ? v.data : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    } finally {
      db.close();
    }
  });
}

export async function saveNav(key: string, data: Uint8Array): Promise<void> {
  navBuilt?.(key, data);
  if (typeof indexedDB === 'undefined') return;
  const db = await open();
  if (!db) return;
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    store.put({ data, at: Date.now() }, key);
    // Drop the oldest entries beyond the limit (maps get regenerated during development).
    const all = store.getAllKeys();
    all.onsuccess = () => {
      const keys = all.result;
      if (keys.length <= MAX_ENTRIES) return;
      const times = store.getAll();
      times.onsuccess = () => {
        const rows = (times.result as { at: number }[]).map((r, i) => ({ key: keys[i]!, at: r.at }));
        rows.sort((a, b) => a.at - b.at);
        for (const r of rows.slice(0, rows.length - MAX_ENTRIES)) store.delete(r.key);
      };
    };
  } catch {
    /* quota or blocked storage: just no cache */
  } finally {
    db.close();
  }
}
