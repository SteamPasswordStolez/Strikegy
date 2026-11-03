// OpenHistoricalMap's two Finlands (CC0; git-ignored in assets-src/shorts/winter/ohm/) joined into rings:
// assets-src/shorts/winter/borders.json { pre: rings, post: rings }, [lon, lat]. It also checks known towns
// against them and says how much land the treaty took.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, 'assets-src/shorts/winter');

function rings(id) {
  const rel = JSON.parse(fs.readFileSync(path.join(DIR, `ohm/${id}.json`), 'utf8')).elements[0];
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const ways = rel.members.filter((m) => m.type === 'way' && m.geometry).map((m) => m.geometry.map((g) => [g.lon, g.lat]));
  const out = [];
  const open = [...ways];
  while (open.length) {
    const ring = open.shift();
    for (;;) {
      const head = key(ring[0]);
      const tail = key(ring[ring.length - 1]);
      if (head === tail) break;
      const i = open.findIndex((w) => key(w[0]) === tail || key(w[w.length - 1]) === tail);
      if (i < 0) {
        console.log(`${id}: an open ring of ${ring.length} points`);
        break;
      }
      const w = open.splice(i, 1)[0];
      if (key(w[0]) !== tail) w.reverse();
      ring.push(...w.slice(1));
    }
    out.push(ring);
  }
  return out;
}

const inRing = (r, x, y) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
};
const inside = (rs, x, y) => rs.filter((r) => inRing(r, x, y)).length % 2 === 1;
/** Area in km², on a sphere (each edge's share by latitude). */
const area = (r) => {
  const R = 6371;
  let s = 0;
  for (let i = 0; i < r.length - 1; i++) {
    const [a, b] = [r[i], r[i + 1]];
    s += (((b[0] - a[0]) * Math.PI) / 180) * (2 + Math.sin((a[1] * Math.PI) / 180) + Math.sin((b[1] * Math.PI) / 180));
  }
  return Math.abs((s * R * R) / 2);
};

const pre = rings(2959045);
const post = rings(2692833);
for (const [name, rs] of [['pre', pre], ['post', post]]) {
  const areas = rs.map(area).sort((a, b) => b - a);
  console.log(name, rs.length, 'rings', rs.reduce((n, r) => n + r.length, 0), 'points, largest', areas.slice(0, 4).map((a) => Math.round(a)).join(', '));
}
const total = (rs) => rs.map(area).sort((a, b) => b - a)[0];
const a0 = total(pre);
const a1 = total(post);
console.log(`land lost ${Math.round(a0 - a1)} km2 = ${(((a0 - a1) / a0) * 100).toFixed(1)} % of the largest ring`);

const TOWNS = [
  // name, lat, lon, in the pre-war Finland?, in the post-treaty Finland?
  ['Viipuri', 60.71, 28.75, 1, 0],
  ['Kakisalmi', 61.03, 30.12, 1, 0],
  ['Sortavala', 61.7, 30.69, 1, 0],
  ['Suojarvi', 62.08, 32.35, 1, 0],
  ['Salmi', 61.37, 31.86, 1, 0],
  ['Terijoki', 60.19, 29.7, 1, 0],
  ['Rautu', 60.55, 30.24, 1, 0],
  ['Kuolajarvi', 66.98, 29.2, 1, 0],
  ['Petsamo', 69.53, 31.17, 1, 1],
  ['Helsinki', 60.17, 24.94, 1, 1],
  ['Lappeenranta', 61.06, 28.19, 1, 1],
  ['Joensuu', 62.6, 29.76, 1, 1],
  ['Leningrad', 59.94, 30.31, 0, 0],
  ['Petrozavodsk', 61.78, 34.35, 0, 0],
  ['Olonets', 60.98, 32.97, 0, 0],
  ['Murmansk', 68.97, 33.08, 0, 0],
];
let bad = 0;
for (const [name, lat, lon, a, b] of TOWNS) {
  const ia = inside(pre, lon, lat);
  const ib = inside(post, lon, lat);
  const ok = ia === !!a && ib === !!b;
  if (!ok) bad++;
  console.log(ok ? 'ok ' : 'BAD', name.padEnd(13), 'pre', ia, 'post', ib);
}
console.log(bad ? `${bad} wrong` : 'all towns right');
fs.writeFileSync(path.join(DIR, 'borders.json'), JSON.stringify({ pre, post }));
