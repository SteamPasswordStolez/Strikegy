/**
 * A short fixed CPU workload for picking the host PC: vector maths, typed
 * arrays and small allocations, roughly what a sim step does. Runs a few
 * times and keeps the fastest (the first run warms the JIT). Plain JS on
 * purpose: the menu doesn't load the physics engine. Milliseconds; lower is better.
 */
let cached: number | null = null;

function workload(): number {
  const n = 4096;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  for (let i = 0; i < pos.length; i++) {
    pos[i] = Math.sin(i * 12.9898) * 100;
    vel[i] = Math.cos(i * 78.233);
  }
  let acc = 0;
  for (let step = 0; step < 40; step++) {
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const x = pos[k]! + vel[k]! * 0.016;
      const y = pos[k + 1]! + vel[k + 1]! * 0.016;
      const z = pos[k + 2]! + vel[k + 2]! * 0.016;
      const d = Math.sqrt(x * x + y * y + z * z) || 1;
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
      vel[k] = vel[k]! - (x / d) * 0.01;
      acc += d;
    }
    // Neighbour-ish work: a sort of small objects, like picking the nearest targets.
    const near = Array.from({ length: 256 }, (_, i) => ({ i, d: pos[(i * 7 + step) % pos.length]! }));
    near.sort((a, b) => a.d - b.d);
    acc += near[0]!.d;
  }
  return acc;
}

export function runBench(): number {
  if (cached !== null) return cached;
  let best = Infinity;
  let sink = 0;
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    sink += workload();
    best = Math.min(best, performance.now() - t0);
  }
  if (Number.isNaN(sink)) best += 0; // keep `sink` alive so the work isn't optimised away
  cached = Math.round(best * 10) / 10;
  return cached;
}

/** True when the device says it runs on battery (browsers without the API: false). */
export async function onBattery(): Promise<boolean> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean }> };
    const b = await nav.getBattery?.();
    return b ? !b.charging : false;
  } catch {
    return false;
  }
}
