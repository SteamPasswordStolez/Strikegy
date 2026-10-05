/**
 * Bot behaviour A/B (`npm run bots:ab -- <map> <a side> [seconds] [runs]`,
 * e.g. `npm run bots:ab -- iron_gate 12 300 4`): bot-only matches without a
 * view, one side playing the smarter behaviour and the other the plainer one
 * (`BotManager.smart`), the sides swapped every other run so a map's lean
 * toward one side cancels out. Prints per run and in total what the smart
 * side got against the plain one: zone points, kills, deaths and how long it
 * held how many zones. A sixth argument turns parts of the smarter
 * behaviour off for the run (`staging,overwatch`; see `SmartPart`).
 */
import { readFileSync } from 'node:fs';
import type { SmartPart } from '../src/ai/BotManager.ts';
import { MatchSim, SIM_DT } from '../src/sim/MatchSim.ts';
import type { Team } from '../src/world/mapTypes.ts';
import { parseMap } from '../src/world/validateMap.ts';

const [mapId = 'iron_gate', sideArg = '12', secondsArg = '300', runsArg = '4', difficultyArg = 'normal', offArg = ''] = process.argv.slice(2);
const off = offArg.split(',').filter(Boolean) as SmartPart[];
const side = Math.max(2, Number(sideArg) || 12);
const seconds = Math.max(30, Number(secondsArg) || 300);
const runs = Math.max(1, Number(runsArg) || 4);
const difficulty = (['easy', 'normal', 'hard'] as const).find((d) => d === difficultyArg) ?? 'normal';
const mapText = readFileSync(`public/maps/${mapId}.json`, 'utf8');

interface Tally {
  points: number;
  kills: number;
  deaths: number;
  /** Zone-seconds held. */
  held: number;
}
const total = { smart: { points: 0, kills: 0, deaths: 0, held: 0 } as Tally, plain: { points: 0, kills: 0, deaths: 0, held: 0 } as Tally, wins: { smart: 0, plain: 0, none: 0 } };

for (let run = 0; run < runs; run++) {
  const smartSide: Team = run % 2 ? 'red' : 'blue';
  const plainSide: Team = smartSide === 'blue' ? 'red' : 'blue';
  const t0 = performance.now();
  // A fresh copy each run (a match changes its map data as it goes).
  const map = parseMap(JSON.parse(mapText));
  const sim = await MatchSim.create(map, { bots: { blue: side, red: side, difficulty }, teamSize: { blue: side, red: side } });
  const bots = sim.bots!;
  bots.smart[plainSide] = false;
  for (const p of off) bots.tactic[p] = false;
  const buildMs = performance.now() - t0;

  const held: Record<Team, number> = { blue: 0, red: 0 };
  const zones = map.zones ?? [];
  const steps = Math.round(seconds / SIM_DT);
  const s0 = performance.now();
  for (let i = 0; i < steps; i++) {
    sim.step(() => null);
    if (i % 60 === 0) for (const z of zones) {
      const owner = sim.zoneMode?.zone(z.id)?.owner;
      if (owner) held[owner] += 1;
    }
    if (sim.zoneMode?.match.winner) break;
  }
  const points = (sim.zoneMode?.match as unknown as { points?: Record<Team, number> } | undefined)?.points ?? { blue: 0, red: 0 };
  const tally = (t: Team): Tally => ({ points: points[t], ...sim.scores.totals(t), held: held[t] });
  const sm = tally(smartSide);
  const pl = tally(plainSide);
  for (const k of ['points', 'kills', 'deaths', 'held'] as const) {
    total.smart[k] += sm[k];
    total.plain[k] += pl[k];
  }
  const w = sim.zoneMode?.match.winner;
  total.wins[w === smartSide ? 'smart' : w === plainSide ? 'plain' : 'none']++;
  const fmt = (t: Tally) => `points ${t.points}, kills ${t.kills}, deaths ${t.deaths}, zone-s ${t.held}`;
  console.log(`run ${run + 1} (smart ${smartSide}${w ? `, ${w} won` : ''}; built ${Math.round(buildMs / 1000)} s, sim ${Math.round((performance.now() - s0) / 1000)} s, ${bots.tactics?.count ?? 0} tactical points)`);
  console.log(`  smart: ${fmt(sm)}`);
  console.log(`  plain: ${fmt(pl)}`);
}
const ratio = (x: number, y: number) => (y ? (x / y).toFixed(2) : '-');
console.log(`${mapId} ${side}v${side} ${difficulty}${off.length ? ` (smart without ${off.join(', ')})` : ''}, ${runs} runs of ${seconds} s: wins smart ${total.wins.smart} / plain ${total.wins.plain} / none ${total.wins.none}`);
console.log(`  smart / plain: points ${ratio(total.smart.points, total.plain.points)}, kills ${ratio(total.smart.kills, total.plain.kills)}, zone-s ${ratio(total.smart.held, total.plain.held)}; K/D smart ${ratio(total.smart.kills, total.smart.deaths)}, plain ${ratio(total.plain.kills, total.plain.deaths)}`);
process.exit(0);
