/**
 * How busy a match is (`npm run bots:pace -- [maps] [seconds] [runs] [mode]`,
 * e.g. `npm run bots:pace -- iron_gate,lyon 300 2`): bot-only matches without
 * a view at each map's own team size (`MAPS`), and per soldier how often the
 * fighting comes: downs dealt a minute, the share of time alive spent in a
 * fight, seconds from a spawn to the first fight and the distance to the
 * nearest enemy. For tuning a map's pace against the shooters it should feel
 * like (CoD-style maps: a fight within ~10-15 s of spawning).
 */
import { readFileSync } from 'node:fs';
import { MAPS } from '../src/data/maps.ts';
import { MatchSim, SIM_DT } from '../src/sim/MatchSim.ts';
import type { ModeKind } from '../src/modes/matchRules.ts';
import { parseMap } from '../src/world/validateMap.ts';

const [mapsArg = MAPS.map((m) => m.id).join(','), secondsArg = '300', runsArg = '2', modeArg = 'zone', sideArg = ''] = process.argv.slice(2);
const seconds = Math.max(60, Number(secondsArg) || 300);
const runs = Math.max(1, Number(runsArg) || 2);
const mode = (['zone', 'frontline', 'conquest'] as const).find((m) => m === modeArg) as ModeKind | undefined;

const median = (v: number[]) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

for (const id of mapsArg.split(',')) {
  const side = Number(sideArg) || MAPS.find((m) => m.id === id)?.team || 12;
  let downs = 0;
  let aliveS = 0;
  let fightS = 0;
  let soldierS = 0;
  const toContact: number[] = [];
  const nearest: number[] = [];
  let size = '';
  for (let run = 0; run < runs; run++) {
    const map = parseMap(JSON.parse(readFileSync(`public/maps/${id}.json`, 'utf8')));
    size = `${map.world.size[0]}x${map.world.size[1]} m`;
    const sim = await MatchSim.create(map, { mode, bots: { blue: side, red: side, difficulty: 'normal' }, teamSize: { blue: side, red: side } });
    const bots = sim.bots!.bots;
    /** Per bot: when its current life began (-1: no life yet / waiting for the first fight already found). */
    const lifeAt = new Map<number, number>();
    const steps = Math.round(seconds / SIM_DT);
    const every = Math.round(1 / SIM_DT);
    for (let i = 0; i < steps; i++) {
      sim.step(() => null);
      if (i % every) continue;
      const now = sim.time;
      for (const b of bots) {
        if (b.benched) continue;
        soldierS++;
        if (!b.alive) {
          // A new life only after a real death (revived = the same life).
          if (b.dead) lifeAt.delete(b.id);
          continue;
        }
        aliveS++;
        if (!lifeAt.has(b.id)) lifeAt.set(b.id, now);
        const fight = b.inCombat(now);
        if (fight) fightS++;
        const born = lifeAt.get(b.id)!;
        if (fight && born >= 0) {
          toContact.push(now - born);
          lifeAt.set(b.id, -1);
        }
        if (b.riding) continue;
        let near = Infinity;
        for (const o of bots) if (o.team !== b.team && o.alive && !o.benched) near = Math.min(near, o.feet.distanceTo(b.feet));
        if (near < Infinity) nearest.push(near);
      }
      if (sim.zoneMode?.match.winner) break;
    }
    downs += [...sim.scores.table('blue'), ...sim.scores.table('red')].reduce((n, r) => n + r.kills, 0);
  }
  const soldierMin = soldierS / 60;
  console.log(
    `${id} ${side}v${side} (${size}), ${runs} x ${seconds} s: downs ${(downs / soldierMin).toFixed(2)} a soldier a minute, ` +
      `in a fight ${Math.round((fightS / Math.max(1, aliveS)) * 100)} % of the time alive, ` +
      `spawn -> first fight median ${Math.round(median(toContact))} s, nearest enemy median ${Math.round(median(nearest))} m`,
  );
}
process.exit(0);
