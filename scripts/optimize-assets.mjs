// Converts downloaded source assets (assets-src/) into web-ready files in public/assets/:
//  - texture sets -> WebP (albedo / normal / ARM = AO, roughness, metalness)
//  - glTF models  -> single GLB with WebP textures and meshopt-compressed geometry
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const manifest = JSON.parse(fs.readFileSync('assets.manifest.json', 'utf8'));
const SRC = 'assets-src';
const OUT = path.join('public', 'assets');
const kb = (b) => `${Math.round(b / 1024)} KB`;
const report = [];

const TEX_MAPS = [
  ['Diffuse', 'albedo', 82],
  ['nor_gl', 'normal', 90],
  ['arm', 'arm', 85],
];

for (const [id, spec] of Object.entries(manifest.textures)) {
  const outDir = path.join(OUT, 'textures', spec.surface);
  fs.mkdirSync(outDir, { recursive: true });
  let size = 0;
  for (const [src, name, quality] of TEX_MAPS) {
    const dest = path.join(outDir, `${name}.webp`);
    await sharp(path.join(SRC, 'textures', id, `${src}.jpg`)).webp({ quality }).toFile(dest);
    size += fs.statSync(dest).size;
  }
  report.push(`texture ${spec.surface.padEnd(16)} ${kb(size)}  (${id})`);
}

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

fs.mkdirSync(path.join(OUT, 'models'), { recursive: true });
for (const [id, spec] of Object.entries(manifest.models)) {
  const dir = path.join(SRC, 'models', id);
  const gltf = fs.readdirSync(dir).find((f) => f.endsWith('.gltf'));
  const doc = await io.read(path.join(dir, gltf));
  const transforms = [dedup(), prune(), weld()];
  if (spec.simplify) {
    transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio: spec.simplify, error: 0.002 }));
  }
  transforms.push(
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [1024, 1024] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await doc.transform(...transforms);
  const dest = path.join(OUT, 'models', `${id}.glb`);
  await io.write(dest, doc);
  report.push(`model   ${id.padEnd(24)} ${kb(fs.statSync(dest).size)}`);
}

console.log(report.join('\n'));
