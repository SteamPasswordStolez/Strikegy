// Downloads the CC0 source assets listed in assets.manifest.json from Poly Haven
// (https://polyhaven.com, all assets CC0) into assets-src/. The raw downloads are
// not committed; run `npm run assets` to fetch and optimize them into public/assets.
import fs from 'node:fs';
import path from 'node:path';

const manifest = JSON.parse(fs.readFileSync('assets.manifest.json', 'utf8'));
const OUT = 'assets-src';
const API = 'https://api.polyhaven.com';

async function download(url, dest) {
  if (fs.existsSync(dest)) return 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

let total = 0;
for (const [id, spec] of Object.entries(manifest.textures)) {
  const files = await (await fetch(`${API}/files/${id}`)).json();
  for (const map of ['Diffuse', 'nor_gl', 'arm']) {
    const f = files[map]?.[spec.res]?.jpg;
    if (!f) throw new Error(`${id}: no ${map} ${spec.res} jpg`);
    total += await download(f.url, path.join(OUT, 'textures', id, `${map}.jpg`));
  }
  console.log(`texture ${id}`);
}

for (const [id, spec] of Object.entries(manifest.models)) {
  const files = await (await fetch(`${API}/files/${id}`)).json();
  const g = files.gltf?.[spec.res]?.gltf;
  if (!g) throw new Error(`${id}: no gltf ${spec.res}`);
  const dir = path.join(OUT, 'models', id);
  total += await download(g.url, path.join(dir, path.basename(new URL(g.url).pathname)));
  for (const [rel, inc] of Object.entries(g.include ?? {})) {
    total += await download(inc.url, path.join(dir, rel));
  }
  console.log(`model ${id}`);
}
console.log(`downloaded ${(total / 1048576).toFixed(1)} MB (existing files skipped)`);
