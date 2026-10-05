/**
 * The Rust kernels (`wasm/core`, built by `npm run wasm` into `core.wasm`).
 * Compiled with SIMD128, so a browser without WebAssembly SIMD can't run the
 * game (all current ones can: Chrome 91+, Firefox 89+, Safari 16.4+).
 *
 * Loaded once at start (`loadCore`); after that `core()` hands out the
 * instance. The module has no allocator: its buffers are fixed, so the
 * typed-array views made on its memory never go stale.
 */

export interface CoreExports {
  memory: WebAssembly.Memory;
  crowd_cap(): number;
  crowd_x(): number;
  crowd_y(): number;
  crowd_z(): number;
  crowd_vx(): number;
  crowd_vz(): number;
  crowd_flags(): number;
  crowd_ids(): number;
  crowd_out(): number;
  crowd_hits(): number;
  crowd_hit_dist(): number;
  crowd_set_count(count: number): void;
  crowd_set_humans(n: number): void;
  crowd_humans(): number;
  crowd_config(
    cell: number,
    sepRadius: number,
    sepStanding: number,
    sepSpeed: number,
    moving: number,
    avoidAhead: number,
    avoidWidth: number,
    spotTaken: number,
  ): void;
  crowd_build_grid(): void;
  crowd_separation(slot: number, wx: number, wz: number, speed: number): void;
  crowd_spot_taken(slot: number, x: number, y: number, z: number): number;
  crowd_view(
    slot: number,
    sight: number,
    airSight: number,
    cosHalf: number,
    cosUp: number,
    freeUp: number,
    yaw: number,
    pitch: number,
  ): number;
  occ_max_boxes(): number;
  occ_reset(): void;
  occ_set_box(slot: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, qx: number, qy: number, qz: number, qw: number): void;
  occ_remove_box(slot: number): void;
  occ_set_dynamic(i: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, qx: number, qy: number, qz: number, qw: number): void;
  occ_dynamic_count(count: number): void;
  occ_ready(): number;
  occ_blocked(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): number;
  hb_cap(): number;
  hb_x(): number;
  hb_y(): number;
  hb_z(): number;
  hb_s(): number;
  hb_c(): number;
  hb_k(): number;
  hb_on(): number;
  hb_out(): number;
  hb_set_count(count: number): void;
  hb_cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, exclude: number): number;
}

let instance: CoreExports | null = null;

/**
 * Loads the module: from `bytes` if given, else from the file next to this
 * code — fetched in a browser, read from disk on the game server (Node).
 */
export async function loadCore(bytes?: BufferSource): Promise<CoreExports> {
  if (instance) return instance;
  let module: WebAssembly.Module;
  if (bytes) module = await WebAssembly.compile(bytes);
  else {
    // Vite emits the file and rewrites this URL in both the site and the server bundle.
    const url = new URL('./core.wasm', import.meta.url);
    if (url.protocol === 'file:') {
      const fs = process.getBuiltinModule('node:fs');
      module = await WebAssembly.compile(fs.readFileSync(url));
    } else {
      const res = await fetch(url);
      module = WebAssembly.compileStreaming
        ? await WebAssembly.compileStreaming(res)
        : await WebAssembly.compile(await res.arrayBuffer());
    }
  }
  instance = (await WebAssembly.instantiate(module, {})).exports as unknown as CoreExports;
  return instance;
}

/** The loaded module, or null before `loadCore` has finished (tests that don't load it). */
export function coreIfLoaded(): CoreExports | null {
  return instance;
}

/** The loaded module (`loadCore` must have finished). */
export function core(): CoreExports {
  if (!instance) throw new Error('wasm core not loaded');
  return instance;
}
