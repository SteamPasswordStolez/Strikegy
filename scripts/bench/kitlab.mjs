// Writes public/maps/kitlab.json (git-ignored): Lyon with every map kit stood
// in two rows on cleared fields (z = -100 / -62, x from -210), for close-up
// screenshots of the models (`node scripts/bench/shots.mjs kitlab out lab`).
// The layout goes to public/maps/kitlab.layout.json.
import fs from 'node:fs';

const base = JSON.parse(fs.readFileSync('public/maps/lyon.json', 'utf8'));
const first = {};
for (const m of ['iron_gate', 'ardennes', 'bilbao', 'lyon', 'persia']) {
  for (const o of JSON.parse(fs.readFileSync(`public/maps/${m}.json`, 'utf8')).objects) if (o.model && !first[o.model]) first[o.model] = o;
}
const kinds = Object.keys(first);
const rows = [
  [-100, kinds.slice(0, Math.ceil(kinds.length / 2))],
  [-62, kinds.slice(Math.ceil(kinds.length / 2))],
];
const X0 = -210;
const objs = [];
const lay = [];
let X1 = X0;
for (const [z, ks] of rows) {
  let x = X0;
  for (const k of ks) {
    const o = structuredClone(first[k]);
    const w = Math.max(o.size[0], o.size[2]);
    x += w / 2 + 5;
    o.pos = [Math.round(x * 100) / 100, o.snap ? o.pos[1] : o.size[1] / 2, z];
    o.snap = true;
    o.rot = [0, 0, 0];
    lay.push({ k, x, z, size: o.size });
    objs.push(o);
    x += w / 2 + 5;
  }
  X1 = Math.max(X1, x);
}
const clear = (px, pz, m) => X0 - 10 < px && px < X1 + 10 && -120 - m < pz && pz < -42 + m;
base.trees = base.trees.filter((t) => !clear(t[0], t[1], 20));
base.buildings = base.buildings.filter((b) => !clear(b.pos[0], b.pos[1], 10));
base.objects = base.objects.filter((o) => !clear(o.pos[0], o.pos[2], 5)).concat(objs);
base.props = (base.props ?? []).filter((p) => !clear(p.pos[0], p.pos[2], 5));
fs.writeFileSync('public/maps/kitlab.json', JSON.stringify(base));
fs.writeFileSync('public/maps/kitlab.layout.json', JSON.stringify(lay));
console.log(`kitlab: ${lay.length} kits, x ${X0}..${Math.round(X1)}`);
