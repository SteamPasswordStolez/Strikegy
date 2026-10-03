// Builds public/assets/soldier/soldier.bin from the Mixamo character and
// animations in assets-src/mixamo (git-ignored; the raw files are never
// published). The output is the game's own packed format: one skinned mesh
// (head + body merged, textures in one atlas), two levels of detail, the
// skeleton, and the animation clips resampled and quantised. Mixamo's terms
// allow the assets inside a game; they must not be redistributed as files.
//
//   node scripts/assets/build-soldier.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as THREE from 'three';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';
import { readFbx, textureBytes } from './fbx.mjs';

const SRC = 'assets-src/mixamo';
const OUT = 'public/assets/soldier/soldier.bin';
const CHARACTER = 'Swat.fbx';
const FPS = 30;
/** Triangle budgets per level of detail (the source has ~19.5k). */
const LOD_TRIS = [9000, 2600];
const ATLAS = 1024; // each material's texture is scaled to ATLAS x ATLAS, side by side

// --- Character -------------------------------------------------------------
const char = readFbx(path.join(SRC, CHARACTER));
char.updateMatrixWorld(true);
const meshes = [];
char.traverse((o) => o.isSkinnedMesh && meshes.push(o));
const bones = [];
char.traverse((o) => o.isBone && bones.push(o));
const boneIndex = new Map(bones.map((b, i) => [b, i]));
const inverses = new Float32Array(bones.length * 16);
const haveInverse = new Array(bones.length).fill(false);
for (const m of meshes) {
  m.skeleton.bones.forEach((b, i) => {
    const gi = boneIndex.get(b);
    if (haveInverse[gi]) return;
    inverses.set(m.skeleton.boneInverses[i].elements, gi * 16);
    haveInverse[gi] = true;
  });
}
// Bones no mesh is bound to: inverse of their bind world matrix.
bones.forEach((b, i) => {
  if (!haveInverse[i]) inverses.set(b.matrixWorld.clone().invert().elements, i * 16);
});

// Materials -> atlas slots (left / right half).
const materials = [];
const slotOf = (mat) => {
  let i = materials.indexOf(mat.name);
  if (i < 0) {
    materials.push(mat.name);
    i = materials.length - 1;
  }
  return i;
};
const matObjs = new Map();

// Merge both meshes into one vertex list (positions in model space, cm).
const verts = []; // [px,py,pz,nx,ny,nz,u,v,i0..i3,w0..w3]
for (const m of meshes) {
  const g = m.geometry;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const mats = [].concat(m.material);
  const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
  const toModel = m.bindMatrix.clone();
  const nm = new THREE.Matrix3().getNormalMatrix(toModel);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const grp of groups) {
    const mat = mats[grp.materialIndex];
    const slot = slotOf(mat);
    matObjs.set(mat.name, mat);
    // Triangles at a time so wrapped UV islands can be shifted back into 0..1 together.
    for (let t = grp.start; t < grp.start + grp.count; t += 3) {
      const cu = (uv.getX(t) + uv.getX(t + 1) + uv.getX(t + 2)) / 3;
      const cv = (uv.getY(t) + uv.getY(t + 1) + uv.getY(t + 2)) / 3;
      const du = Math.floor(cu);
      const dv = Math.floor(cv);
      for (let k = t; k < t + 3; k++) {
        p.fromBufferAttribute(pos, k).applyMatrix4(toModel);
        n.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize();
        const u = Math.min(1, Math.max(0, uv.getX(k) - du));
        const v = Math.min(1, Math.max(0, uv.getY(k) - dv));
        const idx = [0, 1, 2, 3].map((j) => boneIndex.get(m.skeleton.bones[si.getComponent(k, j)]) ?? 0);
        const w = [0, 1, 2, 3].map((j) => sw.getComponent(k, j));
        verts.push([p.x, p.y, p.z, n.x, n.y, n.z, (slot + u) / 2, v, ...idx, ...w]);
      }
    }
  }
}

// Weld identical vertices.
const key = (v) => v.map((x, i) => (i < 3 ? Math.round(x * 100) : i < 6 ? Math.round(x * 500) : i < 8 ? Math.round(x * 8192) : i < 12 ? x : Math.round(x * 255))).join(',');
const unique = new Map();
const vlist = [];
const index = new Uint32Array(verts.length);
verts.forEach((v, i) => {
  const k = key(v);
  let id = unique.get(k);
  if (id === undefined) {
    id = vlist.length;
    vlist.push(v);
    unique.set(k, id);
  }
  index[i] = id;
});
const vcount = vlist.length;

// Attributes.
const positions = new Float32Array(vcount * 3);
const normals = new Int8Array(vcount * 4);
const uvs = new Uint16Array(vcount * 2);
const skinIdx = new Uint8Array(vcount * 4);
const skinW = new Uint8Array(vcount * 4);
vlist.forEach((v, i) => {
  positions.set(v.slice(0, 3), i * 3);
  for (let k = 0; k < 3; k++) normals[i * 4 + k] = Math.round(v[3 + k] * 127);
  uvs[i * 2] = Math.round(v[6] * 65535);
  uvs[i * 2 + 1] = Math.round(v[7] * 65535);
  const w = v.slice(12, 16);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  let rest = 255;
  for (let k = 0; k < 4; k++) {
    skinIdx[i * 4 + k] = v[8 + k];
    const q = k === 3 ? rest : Math.round((w[k] / sum) * 255);
    skinW[i * 4 + k] = Math.max(0, q);
    rest -= q;
  }
});

// Levels of detail.
await MeshoptSimplifier.ready;
const lods = LOD_TRIS.map((tris) => {
  const target = Math.min(index.length, tris * 3);
  const [out] = MeshoptSimplifier.simplify(index, positions, 3, target, 0.05, ['LockBorder']);
  return out;
});

// --- Textures (atlas: one slot per material) ---------------------------------
/** `recolor`: the uniform's blue turned to khaki for the other side (body slot only; skin stays). */
async function atlas(kind, recolor = false) {
  const tiles = [];
  for (let i = 0; i < materials.length; i++) {
    const mat = matObjs.get(materials[i]);
    const bytes = await textureBytes(mat[kind]);
    const body = !/head/i.test(materials[i]);
    const img = bytes ? await (recolor && body ? sharp(bytes).resize(ATLAS, ATLAS).modulate({ hue: 175, saturation: 0.75, brightness: 1.08 }) : sharp(bytes).resize(ATLAS, ATLAS)).toBuffer() : await sharp({ create: { width: ATLAS, height: ATLAS, channels: 3, background: kind === 'normalMap' ? { r: 128, g: 128, b: 255 } : { r: 128, g: 128, b: 128 } } }).png().toBuffer();
    tiles.push({ input: img, left: i * ATLAS, top: 0 });
  }
  return sharp({ create: { width: ATLAS * 2, height: ATLAS, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite(tiles)
    .webp({ quality: kind === 'normalMap' ? 90 : 82 })
    .toBuffer();
}
const albedo = await atlas('map');
const albedoRed = await atlas('map', true);
const normalTex = await atlas('normalMap');

// --- Animations ------------------------------------------------------------
const boneByName = new Map(bones.map((b, i) => [b.name, i]));
const restHipY = bones[boneByName.get('mixamorigHips')].position.y;
const unzip = (file) => {
  // Minimal zip reader (stored / deflate entries) for the Mixamo pack.
  const buf = fs.readFileSync(file);
  const out = new Map();
  let p = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entries = buf.readUInt16LE(p + 10);
  let c = buf.readUInt32LE(p + 16);
  for (let e = 0; e < entries; e++) {
    const method = buf.readUInt16LE(c + 10);
    const csize = buf.readUInt32LE(c + 20);
    const nlen = buf.readUInt16LE(c + 28);
    const xlen = buf.readUInt16LE(c + 30);
    const clen = buf.readUInt16LE(c + 32);
    const local = buf.readUInt32LE(c + 42);
    const name = buf.toString('utf8', c + 46, c + 46 + nlen);
    const lnlen = buf.readUInt16LE(local + 26);
    const lxlen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    out.set(name, method === 8 ? zlib.inflateRawSync(data) : data);
    c += 46 + nlen + xlen + clen;
  }
  return out;
};
/** Clip sources by lower-case name: file paths, or bytes from the pack. */
const sources = new Map();
const pack = path.join(SRC, 'Pro Rifle Pack.zip');
if (fs.existsSync(pack)) {
  for (const [name, data] of unzip(pack)) {
    if (!name.endsWith('.fbx') || /x bot/i.test(name)) continue;
    sources.set(path.basename(name, '.fbx').toLowerCase(), Buffer.from(data));
  }
}
for (const f of fs.readdirSync(SRC)) if (f.endsWith('.fbx') && f !== CHARACTER) sources.set(path.basename(f, '.fbx').toLowerCase(), path.join(SRC, f));

/** Clips the game uses: id -> [source name, loops]. */
const CLIPS = {
  idle: ['idle', true],
  aim: ['idle aiming', true],
  crouch: ['idle crouching', true],
  crouch_aim: ['idle crouching aiming', true],
  walk_f: ['walk forward', true],
  walk_b: ['walk backward', true],
  walk_l: ['walk left', true],
  walk_r: ['walk right', true],
  walk_fl: ['walk forward left', true],
  walk_fr: ['walk forward right', true],
  walk_bl: ['walk backward left', true],
  walk_br: ['walk backward right', true],
  run_f: ['run forward', true],
  run_b: ['run backward', true],
  run_l: ['run left', true],
  run_r: ['run right', true],
  run_fl: ['run forward left', true],
  run_fr: ['run forward right', true],
  run_bl: ['run backward left', true],
  run_br: ['run backward right', true],
  sprint_f: ['sprint forward', true],
  sprint_fl: ['sprint forward left', true],
  sprint_fr: ['sprint forward right', true],
  cwalk_f: ['walk crouching forward', true],
  cwalk_b: ['walk crouching backward', true],
  cwalk_l: ['walk crouching left', true],
  cwalk_r: ['walk crouching right', true],
  cwalk_fl: ['walk crouching forward left', true],
  cwalk_fr: ['walk crouching forward right', true],
  cwalk_bl: ['walk crouching backward left', true],
  cwalk_br: ['walk crouching backward right', true],
  jump_up: ['jump up', false],
  jump_loop: ['jump loop', true],
  jump_down: ['jump down', false],
  death_front: ['death from the front', false],
  death_back: ['death from the back', false],
  death_right: ['death from right', false],
  death_head_front: ['death from front headshot', false],
  death_head_back: ['death from back headshot', false],
  death_crouch: ['death crouching headshot front', false],
  reload: ['reloading', false],
  fire: ['firing rifle', false],
  hit: ['hit reaction', false],
};

const clips = [];
const blobs = [];
let blobLen = 0;
const addBlob = (buf) => {
  const pad = (4 - (blobLen % 4)) % 4;
  if (pad) {
    blobs.push(Buffer.alloc(pad));
    blobLen += pad;
  }
  const off = blobLen;
  blobs.push(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
  blobLen += buf.byteLength;
  return off;
};

for (const [id, [src, loop]] of Object.entries(CLIPS)) {
  const file = sources.get(src);
  if (!file) {
    console.warn(`missing clip ${id} (${src})`);
    continue;
  }
  const scene = readFbx(file);
  const clip = scene.animations.find((a) => a.tracks.length) ?? scene.animations[0];
  // Hip height of the rig the clip was exported with, to fit our character's legs.
  let srcHipY = restHipY;
  scene.traverse((o) => {
    if (o.isBone && o.name === 'mixamorigHips') srcHipY = o.position.y;
  });
  const frames = Math.max(1, Math.round(clip.duration * FPS) + 1);
  const tracks = [];
  for (const tr of clip.tracks) {
    const [bone, prop] = tr.name.split('.');
    const bi = boneByName.get(bone);
    if (bi === undefined || (prop !== 'quaternion' && !(prop === 'position' && bone === 'mixamorigHips'))) continue;
    const interp = tr.createInterpolant();
    const width = prop === 'quaternion' ? 4 : 3;
    const values = new Float32Array(frames * width);
    for (let f = 0; f < frames; f++) values.set(interp.evaluate(Math.min(clip.duration, f / FPS)), f * width);
    if (prop === 'position') {
      const k = restHipY / srcHipY;
      for (let i = 0; i < values.length; i++) values[i] *= k;
    }
    // Constant tracks keep one frame.
    let constant = true;
    for (let f = 1; f < frames && constant; f++) for (let c = 0; c < width; c++) if (Math.abs(values[f * width + c] - values[c]) > 1e-4) constant = false;
    const n = constant ? 1 : frames;
    const q = new Int16Array(n * width);
    for (let i = 0; i < n * width; i++) q[i] = Math.round(prop === 'quaternion' ? values[i] * 32767 : values[i] * 10); // positions in mm
    tracks.push({ b: bi, p: prop === 'quaternion' ? 'q' : 'p', n, off: addBlob(q) });
  }
  clips.push({ id, loop, frames, fps: FPS, tracks });
}

// --- Pack --------------------------------------------------------------------
const header = {
  version: 1,
  /** Model units are centimetres. */
  scale: 0.01,
  bones: bones.map((b) => ({ n: b.name, p: b.parent && boneIndex.has(b.parent) ? boneIndex.get(b.parent) : -1, t: b.position.toArray(), r: b.quaternion.toArray() })),
  inverses: addBlob(inverses),
  vertexCount: vcount,
  position: addBlob(positions),
  normal: addBlob(normals),
  uv: addBlob(uvs),
  skinIndex: addBlob(skinIdx),
  skinWeight: addBlob(skinW),
  lods: lods.map((ix) => ({ count: ix.length, off: addBlob(vcount < 65536 ? Uint16Array.from(ix) : ix), wide: vcount >= 65536 })),
  albedo: { off: addBlob(albedo), len: albedo.length },
  albedoRed: { off: addBlob(albedoRed), len: albedoRed.length },
  normalMap: { off: addBlob(normalTex), len: normalTex.length },
  clips,
};
const json = Buffer.from(JSON.stringify(header));
const jsonPad = Buffer.alloc((4 - ((8 + json.length) % 4)) % 4, 0x20);
const head = Buffer.alloc(8);
head.write('STKS', 0, 'latin1');
head.writeUInt32LE(json.length + jsonPad.length, 4);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([head, json, jsonPad, ...blobs]));
const size = fs.statSync(OUT).size;
console.log(`soldier: ${bones.length} bones, ${vcount} verts, LOD tris ${lods.map((l) => l.length / 3).join(' / ')} (source ${index.length / 3}), ${clips.length} clips, textures ${Math.round(albedo.length / 1024)} + ${Math.round(albedoRed.length / 1024)} + ${Math.round(normalTex.length / 1024)} KB, total ${Math.round(size / 1024)} KB`);
