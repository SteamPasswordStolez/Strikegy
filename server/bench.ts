/**
 * How long a room's sim step takes on this machine (`npm run server:bench --
 * <map> <players> [seconds]`, e.g. `npm run server:bench -- ardennes 64`):
 * builds the map without a view, puts that many people on it (half a side),
 * and has them run about, turn and shoot for the given sim time. Prints the
 * build time, step times and memory, for sizing rooms on the server laptop.
 */
import { readFileSync } from 'node:fs';
import { createInputState } from '../src/input/InputState.ts';
import { MatchSim, SIM_DT, type SoldierInput } from '../src/sim/MatchSim.ts';
import { parseMap } from '../src/world/validateMap.ts';

const [mapId = 'iron_gate', playersArg = '32', secondsArg = '60'] = process.argv.slice(2);
const players = Math.max(2, Number(playersArg) || 32);
const seconds = Math.max(5, Number(secondsArg) || 60);

const t0 = performance.now();
const sim = await MatchSim.create(parseMap(JSON.parse(readFileSync(`public/maps/${mapId}.json`, 'utf8'))));
const buildMs = performance.now() - t0;

// A seeded walk so runs compare.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const inputs = new Map<number, SoldierInput>();
for (let id = 1; id <= players; id++) {
  sim.addSoldier(id, id % 2 ? 'blue' : 'red', `p${id}`);
  sim.deploy(id);
  inputs.set(id, { state: createInputState(), yaw: rand() * Math.PI * 2, pitch: 0 });
}

const steps = Math.round(seconds / SIM_DT);
const times: number[] = [];
for (let i = 0; i < steps; i++) {
  for (const [id, inp] of inputs) {
    const s = inp.state;
    s.moveY = 1;
    s.sprint = (i + id) % 600 < 300;
    s.fire = (i + id * 37) % 240 < 40;
    const soldier = sim.soldiers.get(id)!;
    // People turn away from what stops them rather than pushing into it.
    const blocked = i > 30 && soldier.player.horizontalSpeed() < 1;
    if (blocked || rand() < 0.01) inp.yaw += blocked ? 1.5 + rand() : (rand() - 0.5) * 2;
    if (!soldier.deployed) sim.deploy(id);
  }
  const a = performance.now();
  sim.step((id) => inputs.get(id) ?? null);
  times.push(performance.now() - a);
}
times.sort((x, y) => x - y);
const avg = times.reduce((x, y) => x + y, 0) / times.length;
const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(times.length * p))]!.toFixed(2);
const mem = process.memoryUsage();
const kills = [...sim.scores.table('blue'), ...sim.scores.table('red')].reduce((n, r) => n + r.kills, 0);
console.log(`${mapId}: ${players} players, ${seconds} s of sim (${steps} steps at ${Math.round(1 / SIM_DT)} Hz)`);
console.log(`  world built in ${Math.round(buildMs)} ms, ${sim.physics.world.colliders.len()} colliders`);
console.log(`  step: avg ${avg.toFixed(2)} ms, median ${pct(0.5)}, p95 ${pct(0.95)}, p99 ${pct(0.99)}, max ${pct(1)} (budget ${(SIM_DT * 1000).toFixed(1)} ms)`);
console.log(`  memory: heap ${(mem.heapUsed / 1e6).toFixed(0)} MB, rss ${(mem.rss / 1e6).toFixed(0)} MB; ${kills} kills happened`);
sim.dispose();
