/**
 * What bots do and how well (`npm run bots:audit -- <map> [seconds] [side]`,
 * e.g. `npm run bots:audit -- ardennes 300 16`): a bot-only match without a
 * view, watched every half second and through the match's events, reported
 * by area so the weak spots show:
 * - on foot: what they are doing, how often they stand stuck while meant to
 *   be going somewhere (and where), time in buildings and in zones;
 * - vehicles: per kind, time crewed, distance driven, stuck / back-up tries,
 *   wrecks (shot vs crashed), kills;
 * - jets: time in the air, crashes, kills of aircraft / ground targets;
 * - items: grenades by type, gadgets, medkits, revives, and their kills;
 * - call-ins: requests by kind, granted or not, and their kills.
 */
import { readFileSync } from 'node:fs';
import { MAPS } from '../src/data/maps.ts';
import { MatchSim, SIM_DT } from '../src/sim/MatchSim.ts';
import { parseMap } from '../src/world/validateMap.ts';

const [mapId = 'iron_gate', secondsArg = '300', sideArg = ''] = process.argv.slice(2);
const seconds = Math.max(60, Number(secondsArg) || 300);
const side = Number(sideArg) || MAPS.find((m) => m.id === mapId)?.team || 12;
const map = parseMap(JSON.parse(readFileSync(`public/maps/${mapId}.json`, 'utf8')));
const sim = await MatchSim.create(map, { bots: { blue: side, red: side, difficulty: 'normal' }, teamSize: { blue: side, red: side } });
const bots = sim.bots!;
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const bm = bots as unknown as Any;

const count = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const planeState = new Map<number, 'deck' | 'air'>();
const planes = { launched: 0, landed: 0 };
const kills = new Map<string, number>();
const grenades = new Map<string, number>();
const gadgets = new Map<string, number>();
const calls = new Map<string, number>();
let medkits = 0;
let revives = 0;

// Who killed with what: on foot by weapon, or the kind of vehicle they were riding.
const byId = new Map(bots.bots.map((b) => [b.id, b]));
sim.bus.on('combat:kill', (e) => {
  const killer = e.attackerId !== undefined ? byId.get(e.attackerId) : undefined;
  const v = killer?.riding ? sim.vehicles?.world.vehicles.find((x) => x.id === killer.riding!.vehicle) : undefined;
  const victim = e.victimId !== undefined ? byId.get(e.victimId) : undefined;
  const vv = victim?.riding ? sim.vehicles?.world.vehicles.find((x) => x.id === victim.riding!.vehicle) : undefined;
  count(kills, (v ? `vehicle:${v.kind}` : String(e.weapon)) + (vv ? ` > ${vv.kind}` : ''));
});
sim.bus.on('combatant:revived', () => revives++);
const wrap = (o: Any, name: string, after: (args: unknown[], out: unknown) => void) => {
  const f = o[name];
  if (typeof f !== 'function') return;
  o[name] = (...args: unknown[]) => {
    const out = f.apply(o, args);
    after(args, out);
    return out;
  };
};
wrap(bm, 'throwGrenade', (a, ok) => ok !== false && count(grenades, String(a[1])));
wrap(bm, 'useGadget', (a, ok) => ok && count(gadgets, String((a[0] as Any).cls)));
wrap(bm, 'usedMedkit', () => medkits++);
if (bm.support) wrap(bm.support, 'call', (a, ok) => count(calls, `${a[0]}${ok ? '' : ' (refused)'}`));

// Sampling.
const action = new Map<string, number>();
let onFoot = 0;
let stuck = 0;
let idle = 0;
let indoors = 0;
let inZone = 0;
const stuckFor = new Map<number, number>();
let stuckEpisodes = 0;
const hotspots = new Map<string, number>();
interface VStat { crewed: number; moving: number; km: number; tries: number; wrecks: number; crashed: number; air: number }
const vstat = new Map<string, VStat>();
const lastPos = new Map<number, { x: number; z: number }>();
const lastTries = new Map<object, number>();
const vstuck = new Map<string, number>();
const wrecked = new Set<number>();
const zones = map.zones ?? [];
const every = Math.round(0.5 / SIM_DT);
const steps = Math.round(seconds / SIM_DT);
const t0 = performance.now();
// PATHCHECK=<zone>: from spots round that zone (where its spawns land), is there a path to every other zone?
if (process.env.PATHCHECK) {
  const THREE = await import('three');
  const nav = (bots as unknown as Any).nav;
  const z0 = zones.find((z) => z.id === process.env.PATHCHECK)!;
  console.log(`pathcheck ${z0.id} nav ${!!nav} at ${z0.pos}`);
  for (const r of [0, 10, 20, 40, 60]) for (const a of [0, 1.57, 3.14, 4.71]) {
    const q = new THREE.Vector3(z0.pos[0] + Math.cos(a) * r, z0.pos[1], z0.pos[2] + Math.sin(a) * r);
    const cl = nav.closest(q);
    const cf = nav.closestFar(q);
    console.log(`  r ${r} a ${a}: closest ${cl ? `${Math.round(cl.x)},${cl.y.toFixed(1)},${Math.round(cl.z)}` : '-'} far ${cf ? `${Math.round(cf.x)},${cf.y.toFixed(1)},${Math.round(cf.z)}` : '-'}`);
    if (r === 0) break;
  }
  const c = new THREE.Vector3(z0.pos[0], z0.pos[1], z0.pos[2]);
  const out: InstanceType<typeof THREE.Vector3>[] = [];
  for (let k = 0; k < 12; k++) {
    const p = k === 0 ? nav.closestFar(c) : nav.randomAround(c, z0.radius * 0.6);
    if (!p) continue;
    const res = zones.filter((z) => z.id !== z0.id).map((z) => {
      const ok = nav.path(p, new THREE.Vector3(z.pos[0], z.pos[1], z.pos[2]), out);
      const end = out[out.length - 1];
      const miss = end ? Math.hypot(end.x - z.pos[0], end.z - z.pos[2]) : -1;
      return `${z.id}:${ok ? Math.round(miss) : 'x'}`;
    });
    console.log(`from (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}): ${res.join(' ')}`);
  }
}
const clusterEvery = Math.round(30 / SIM_DT);
for (let i = 0; i < steps; i++) {
  sim.step(() => null);
  // CLUSTER=1: every 30 s each side's densest 20 m cell (where crowds pile up instead of fighting).
  if (process.env.CLUSTER && i % clusterEvery === 0 && i > 0) {
    const line: string[] = [`t=${Math.round(sim.time)}s`];
    for (const team of ['blue', 'red'] as const) {
      const cells = new Map<string, { n: number; x: number; y: number; z: number; acts: Map<string, number>; riding: number }>();
      let alive = 0;
      for (const b of bots.bots) {
        if (b.team !== team || !b.alive || b.benched) continue;
        alive++;
        const k = `${Math.floor(b.feet.x / 20)},${Math.floor(b.feet.z / 20)}`;
        const c = cells.get(k) ?? { n: 0, x: 0, y: 0, z: 0, acts: new Map(), riding: 0 };
        c.n++;
        c.x += b.feet.x;
        c.y += b.feet.y;
        c.z += b.feet.z;
        if (b.riding) c.riding++;
        count(c.acts, String((b as unknown as Any).action));
        cells.set(k, c);
      }
      const top = [...cells.values()].sort((a, b) => b.n - a.n)[0];
      if (top) line.push(`${team}: ${top.n}/${alive} at (${Math.round(top.x / top.n)}, ${Math.round(top.y / top.n)}, ${Math.round(top.z / top.n)}) riding ${top.riding} [${[...top.acts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, n]) => `${a} ${n}`).join(', ')}]`);
    }
    const zs = sim.zoneMode?.zones?.map((z: Any) => `${z.id}:${(z.owner ?? '-')[0]}${z.locked ? '!' : ''}`).join(' ');
    console.log(line.join(' | '), '|', zs);
  }
  if (i % every) continue;
  const now = sim.time;
  for (const b of bots.bots) {
    if (b.benched || !b.alive || b.riding) {
      stuckFor.delete(b.id);
      continue;
    }
    onFoot++;
    const bb = b as unknown as Any;
    count(action, bb.action);
    const speed = Math.hypot(b.velocity.x, b.velocity.z);
    const moving = bb.action === 'advance' || bb.action === 'hunt' || bb.action === 'investigate';
    if (bots.insideBuilding(b.feet)) indoors++;
    if (zones.some((z) => Math.hypot(b.feet.x - z.pos[0], b.feet.z - z.pos[2]) < z.radius)) inZone++;
    if (moving && !b.inCombat(now) && speed < 0.3) {
      if (bb.hasGoal) {
        stuck++;
        const s = (stuckFor.get(b.id) ?? 0) + 0.5;
        stuckFor.set(b.id, s);
        if (s === 4) {
          stuckEpisodes++;
          count(hotspots, `${Math.round(b.feet.x / 10) * 10},${Math.round(b.feet.z / 10) * 10}`);
          // STUCKLOG=1: each 4 s stand-still with what the bot was after.
          if (process.env.STUCKLOG) {
            const f = (v: { x: number; y: number; z: number }) => `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`;
            const path = (bb.path as { x: number; y: number; z: number }[]) ?? [];
            const next = path[Math.min(bb.pathIndex ?? 0, path.length - 1)];
            console.log(`stuck t=${Math.round(now)} ${b.team} ${bb.action} at ${f(b.feet)} goal ${f(bb.goal)} next ${next ? f(next) : '-'} path ${path.length} indoors ${bots.insideBuilding(b.feet)}`);
          }
        }
      } else idle++;
    } else stuckFor.delete(b.id);
  }
  for (const v of sim.vehicles?.world.vehicles ?? []) {
    const st = vstat.get(v.kind) ?? { crewed: 0, moving: 0, km: 0, tries: 0, wrecks: 0, crashed: 0, air: 0 };
    vstat.set(v.kind, st);
    if (v.wrecked) {
      if (!wrecked.has(v.id)) {
        wrecked.add(v.id);
        st.wrecks++;
        if (!v.lastHurtBy) st.crashed++;
      }
      continue;
    }
    // Carrier planes: launched, landed back on a deck.
    if (v.spec.plane) {
      const was = planeState.get(v.id);
      if (was === undefined) planes.launched++;
      if (was === 'air' && v.deck) planes.landed++;
      planeState.set(v.id, v.deck ? 'deck' : 'air');
    }
    const driver = v.seats[0];
    const p = lastPos.get(v.id);
    lastPos.set(v.id, { x: v.pos.x, z: v.pos.z });
    if (!driver) continue;
    st.crewed += 0.5;
    if (v.velocity.length() > 1) st.moving += 0.5;
    if (v.flight) {
      const ground = sim.world.terrain.heightAt(v.pos.x, v.pos.z);
      if (v.pos.y - ground > 10) st.air += 0.5;
    }
    if (p) st.km += Math.hypot(v.pos.x - p.x, v.pos.z - p.z) / 1000;
  }
  for (const e of bm.entries as Any[]) {
    const d = e.drive;
    if (!d) continue;
    const prev = lastTries.get(d) ?? 0;
    if (d.tries > prev) {
      const v = sim.vehicles?.world.vehicles.find((x) => x.id === e.bot.riding?.vehicle);
      if (v) {
        vstat.get(v.kind)!.tries += d.tries - prev;
        count(vstuck, `${v.kind} ${Math.round(v.pos.x / 10) * 10},${Math.round(v.pos.z / 10) * 10}`);
      }
    }
    lastTries.set(d, d.tries);
  }
  if (sim.zoneMode?.match.winner) break;
}
const simS = (performance.now() - t0) / 1000;
const pct = (n: number, of: number) => `${Math.round((n / Math.max(1, of)) * 100)} %`;
const list = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '-';
console.log(`${mapId} ${side}v${side}, ${Math.round(sim.time)} s of sim in ${simS.toFixed(0)} s`);
console.log(`on foot: ${list(new Map([...action].map(([k, n]) => [k, Math.round((n / onFoot) * 100)])))} (% of time alive on foot)`);
console.log(`  stuck while going somewhere ${pct(stuck, onFoot)}, no goal and standing ${pct(idle, onFoot)}, ${stuckEpisodes} stuck 4 s+; in buildings ${pct(indoors, onFoot)}, in zones ${pct(inZone, onFoot)}`);
console.log(`  stuck spots (10 m cells): ${[...hotspots].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} x${n}`).join(', ') || '-'}`);
for (const [kind, s] of [...vstat].sort()) {
  console.log(`${kind}: crewed ${Math.round(s.crewed)} s, moving ${pct(s.moving, s.crewed)}, ${s.km.toFixed(2)} km, stuck tries ${s.tries}, wrecks ${s.wrecks} (crashed ${s.crashed})${s.air ? `, in the air ${pct(s.air, s.crewed)}` : ''}`);
}
if (planes.launched) console.log(`carrier planes: ${planes.launched} launched, ${planes.landed} landings`);
console.log(`vehicle stuck spots: ${[...vstuck].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => `${k} x${n}`).join(', ') || '-'}`);
console.log(`kills: ${list(kills)}`);
console.log(`grenades: ${list(grenades)}; gadgets by class: ${list(gadgets)}; medkits ${medkits}; revives ${revives}`);
console.log(`call-ins: ${list(calls)}`);
const rps = new Map<string, number>();
for (const e of bm.entries as Any[]) if (e.squad >= 0 && !rps.has(`${e.bot.team}${e.squad}`)) rps.set(`${e.bot.team}${e.squad}`, Math.round(bm.support?.rp(e.bot) ?? -1));
console.log(`squad RP at the end: ${[...rps].map(([k, n]) => `${k} ${n}`).join(', ')}`);
process.exit(0);
