/**
 * Does a mode play (`npm run mode:check -- <map> <mode> [seconds] [side]`,
 * e.g. `npm run mode:check -- iron_gate snd 600 6`): a bot-only match without
 * a view on the game server's sim, printing the mode's events as they come
 * (sim seconds) and how it ended. For checking a mode's rules and its bots
 * end to end without a browser.
 */
import { readFileSync } from 'node:fs';
import { MatchSim, SIM_DT } from '../src/sim/MatchSim.ts';
import { MODE_KINDS, type ModeKind } from '../src/modes/matchRules.ts';
import { parseMap } from '../src/world/validateMap.ts';

const [mapId = 'iron_gate', modeArg = 'zone', secondsArg = '300', sideArg = '6'] = process.argv.slice(2);
const mode = MODE_KINDS.find((m) => m === modeArg) as ModeKind | undefined;
if (!mode) throw new Error(`unknown mode ${modeArg} (${MODE_KINDS.join(', ')})`);
const seconds = Math.max(10, Number(secondsArg) || 300);
const side = Math.max(1, Number(sideArg) || 6);
const map = parseMap(JSON.parse(readFileSync(`public/maps/${mapId}.json`, 'utf8')));
const sim = await MatchSim.create(map, { mode, bots: { blue: side, red: side, difficulty: 'normal' }, teamSize: { blue: side, red: side } });
const zm = sim.zoneMode!;
console.log(`${mapId} ${zm.kind} ${side}v${side}, ${seconds} s`);
// DBG=1: each zone's walkable ground and the spawn a defender would get there.
if (process.env.DBG && sim.bots) {
  const nav = sim.bots.nav;
  for (const z of zm.zones) {
    const c = { x: z.x, y: z.y, z: z.z };
    const r = nav.randomAround(c, 10);
    const cl = nav.closest(c);
    console.log(`zone ${z.id} at ${z.x.toFixed(0)},${z.y.toFixed(1)},${z.z.toFixed(0)} random ${r ? r.toArray().map((v) => v.toFixed(1)).join(',') : 'null'} closest ${cl ? cl.toArray().map((v) => v.toFixed(1)).join(',') : 'null'} spawn ${zm.spawnPoint('blue', z.id, nav).pos.toArray().map((v) => v.toFixed(1)).join(',')}`);
  }
}
const at = () => `${sim.time.toFixed(0).padStart(4)} s`;
let downs = 0;
sim.bus.on('combat:kill', () => downs++);
sim.bus.on('mode:event', (e) => {
  const { type, ...rest } = e;
  console.log(`${at()}  ${type} ${JSON.stringify(rest)}${type === 'built' ? ` (fortifications built: ${sim.fort?.slots.filter((x) => x.built).length ?? 0})` : ''}`);
});
sim.bus.on('zone:captured', (e) => console.log(`${at()}  captured ${e.zone} ${e.team}`));
let over = false;
sim.bus.on('match:ended', (e) => {
  console.log(`${at()}  ENDED winner ${e.winner}${e.winnerId !== undefined ? ` (#${e.winnerId})` : ''} by ${zm.match.reason}`);
  over = true;
});
const steps = Math.round(seconds / SIM_DT);
const every = Math.round(30 / SIM_DT);
for (let i = 0; i < steps && !over; i++) {
  sim.step(() => null);
  // Every 30 s: where the bots are relative to what the mode is about.
  if (i % every === every - 1) {
    const goal = zm.objectives('red')[0]?.pos;
    const bots = sim.bots?.bots.filter((b) => b.alive) ?? [];
    const d = (team: string) => {
      const list = bots.filter((b) => b.team === team).map((b) => (goal ? b.feet.distanceTo(goal) : 0)).sort((a, b) => a - b);
      return list.length ? `${list.length} up, nearest ${list[0]!.toFixed(0)} m, median ${list[Math.floor(list.length / 2)]!.toFixed(0)} m` : 'none up';
    };
    console.log(`${at()}  · red goal ${goal ? `${goal.x.toFixed(0)},${goal.z.toFixed(0)}` : '-'} · red ${d('red')} · blue ${d('blue')}`);
  }
}
console.log(`downs ${downs} (${((downs / sim.time) * 60).toFixed(1)} a minute), tickets ${JSON.stringify(zm.match.tickets)}`);
process.exit(0);
