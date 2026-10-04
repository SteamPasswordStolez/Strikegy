/**
 * Writes src/world/propBounds.json: the bounds of every model in
 * public/assets/models, as three.js measures them in the browser
 * (Box3.setFromObject on the loaded scene). Map props get their box colliders
 * from this table, so the game server (no glTF loading, no textures) builds
 * the same colliders as the browser. Run after adding or changing a model:
 * `npm run props:bounds`.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const dir = 'public/assets/models';
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
// Node has no image decoding; bounds need geometry only.
loader.register((parser) => {
  parser.loadTextureImage = () => Promise.resolve(null);
  return { name: 'noTextures' };
});

const out = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()) {
  const buf = readFileSync(`${dir}/${file}`);
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(gltf.scene);
  out[file.slice(0, -4)] = { min: b.min.toArray(), max: b.max.toArray() };
}
const lines = Object.entries(out).map(([id, b]) => `  ${JSON.stringify(id)}: ${JSON.stringify(b)}`);
writeFileSync('src/world/propBounds.json', `{\n${lines.join(',\n')}\n}\n`);
console.log(`propBounds.json: ${Object.keys(out).length} models`);
