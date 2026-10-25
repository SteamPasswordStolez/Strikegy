// Bakes the AI-made soldier models (Meshy, T-pose FBX + PNG maps in assets-src/) into the
// game's soldier assets (owner, 2026-10-25): public/assets/soldiers/<id>.bin + textures.
//
// For each model: stand it up at 1.80 m facing -Z with the feet at 0; measure the joints
// from its T-pose (shoulders, elbows, wrists along the arm line; hips, knees, ankles);
// weight every vertex to the game's skeleton by distance to the bones (with rules that
// keep arms off the torso and legs apart); simplify to a near look (~14k triangles) and a
// far look (~1.8k); quantize (positions 16 bit, normals 8 bit, UVs 16 bit, 4 bones a
// vertex at 8 bit weights); write one binary with a JSON head. Textures are scaled with
// ffmpeg: colour and normal 1024², roughness and metalness 512².
//
// Usage: node scripts/soldier-bake.mjs   (needs ffmpeg on the PATH)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, set src(v) {} }) };
const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
const { mergeVertices } = await import('three/addons/utils/BufferGeometryUtils.js');
const { MeshoptSimplifier } = await import('meshoptimizer');
await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public/assets/soldiers');
fs.mkdirSync(OUT, { recursive: true });

const MODELS = [
  { id: 'blue_m', file: 'Meshy_AI_Blue_Team_Sentinel_1025085224_texture' },
  { id: 'blue_f', file: 'Meshy_AI_Blue_Sentinel_1025113745_texture' },
  { id: 'red_m', file: 'Meshy_AI_Crimson_Sentinel_1025090240_texture' },
  { id: 'red_f', file: 'Meshy_AI_Crimson_Sentinel_1025114030_texture' },
];
const HEIGHT = 1.8;
const NEAR_TRIS = 14000;
const FAR_TRIS = 1800;
const MID_TRIS = 4500;

// The game's skeleton (src/ai/SoldierModel.ts `B`): order matters.
const BONES = ['Root', 'Hips', 'Spine', 'Head', 'Aim', 'ThighL', 'ShinL', 'ThighR', 'ShinR', 'UpperArmL', 'ForeArmL', 'HandL', 'UpperArmR', 'ForeArmR', 'HandR'];
const B = Object.fromEntries(BONES.map((b, i) => [b, i]));

function load(file) {
  const buf = fs.readFileSync(path.join(SRC, `${file}.fbx`));
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  root.updateMatrixWorld(true);
  const mesh = root.getObjectByProperty('isMesh', true);
  const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g;
}

/** Stood up: 1.80 m, feet at 0, facing -Z (the models face +Z), centred on the legs. */
function normalize(g) {
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const s = HEIGHT / (bb.max.y - bb.min.y);
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, 0);
  g.scale(s, s, s);
  g.rotateY(Math.PI);
  // Centre z on the legs (the band between the knees and the hips).
  const p = g.attributes.position;
  let z = 0;
  let n = 0;
  for (let i = 0; i < p.count; i += 3) {
    const y = p.getY(i);
    if (y > 0.45 && y < 0.85) {
      z += p.getZ(i);
      n++;
    }
  }
  g.translate(0, 0, -(z / Math.max(1, n)));
  return g;
}

/** Joints measured from the T-pose. */
function measure(g) {
  const p = g.attributes.position;
  let tip = 0;
  let armY = 0;
  let armN = 0;
  let chestW = 0;
  const legL = [];
  const legR = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const ax = Math.abs(x);
    if (y > 1.1 && y < 1.7) tip = Math.max(tip, ax);
    if (ax > 0.4 && ax < 0.6 && y > 1.1 && y < 1.7) {
      armY += y;
      armN++;
    }
    if (y > 1.15 && y < 1.3 && ax < 0.3) chestW = Math.max(chestW, ax);
    if (y > 0.45 && y < 0.55) (x < 0 ? legL : legR).push(x);
  }
  armY /= Math.max(1, armN);
  const mid = (a) => (a.length ? (Math.min(...a) + Math.max(...a)) / 2 : 0);
  const lx = mid(legL);
  const rx = mid(legR);
  const sx = Math.max(tip * 0.2, chestW * 0.78);
  return {
    hips: [0, 0.94, 0],
    spine: [0, 1.08, 0],
    head: [0, 1.56, 0],
    aim: [0, armY - 0.04, 0],
    thighL: [lx, 0.92, 0],
    shinL: [lx, 0.5, 0],
    thighR: [rx, 0.92, 0],
    shinR: [rx, 0.5, 0],
    shoulderL: [-sx, armY, 0],
    elbowL: [-tip * 0.52, armY, 0],
    wristL: [-tip * 0.79, armY, 0],
    shoulderR: [sx, armY, 0],
    elbowR: [tip * 0.52, armY, 0],
    wristR: [tip * 0.79, armY, 0],
    tip,
  };
}

/** Distance from p to the segment a-b. */
function segDist(px, py, pz, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / (abx * abx + aby * aby + abz * abz || 1)));
  const dx = px - (a[0] + abx * t);
  const dy = py - (a[1] + aby * t);
  const dz = pz - (a[2] + abz * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Up to four bones a vertex, by distance to each bone's segments, with region rules. */
function weights(g, J) {
  const p = g.attributes.position;
  const n = p.count;
  const idx = new Uint8Array(n * 4);
  const wt = new Uint8Array(n * 4);
  const tipL = [-J.tip, J.wristL[1], 0];
  const tipR = [J.tip, J.wristR[1], 0];
  const segs = [
    [B.Hips, [0, J.hips[1] - 0.06, 0], J.spine],
    [B.Spine, J.spine, [0, J.head[1] - 0.04, 0]],
    [B.Head, J.head, [0, HEIGHT, 0]],
    [B.ThighL, J.thighL, J.shinL],
    [B.ShinL, J.shinL, [J.shinL[0], 0.06, 0]],
    [B.ShinL, [J.shinL[0], 0.06, 0], [J.shinL[0], 0.04, -0.14]],
    [B.ThighR, J.thighR, J.shinR],
    [B.ShinR, J.shinR, [J.shinR[0], 0.06, 0]],
    [B.ShinR, [J.shinR[0], 0.06, 0], [J.shinR[0], 0.04, -0.14]],
    [B.UpperArmL, J.shoulderL, J.elbowL],
    [B.ForeArmL, J.elbowL, J.wristL],
    [B.HandL, J.wristL, tipL],
    [B.UpperArmR, J.shoulderR, J.elbowR],
    [B.ForeArmR, J.elbowR, J.wristR],
    [B.HandR, J.wristR, tipR],
  ];
  const sx = Math.abs(J.shoulderR[0]);
  const wx = Math.abs(J.wristR[0]);
  const best = new Float32Array(BONES.length);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const ax = Math.abs(x);
    best.fill(Infinity);
    for (const [bone, a, b] of segs) {
      const name = BONES[bone];
      // Arms only out past the shoulder (and above the chest), hands past the wrist,
      // legs below the hips on their own side, the head above the neck.
      if (name.includes('Arm') || name.includes('Hand')) {
        if ((name.endsWith('L') ? x > 0 : x < 0) || ax < sx - 0.06 || y < J.shoulderR[1] - 0.25) continue;
        if (name.startsWith('Hand') && ax < wx - 0.05) continue;
      }
      if (name.startsWith('Thigh') || name.startsWith('Shin')) {
        if (y > J.hips[1] + 0.06) continue;
        if (Math.abs(x) > 0.02 && (name.endsWith('L') ? x > 0 : x < 0)) continue;
      }
      if (name === 'Head' && y < J.head[1] - 0.07) continue;
      const d = segDist(x, y, z, a, b);
      if (d < best[bone]) best[bone] = d;
    }
    const cand = [];
    for (let b = 0; b < BONES.length; b++) if (best[b] < Infinity) cand.push([b, 1 / Math.pow(Math.max(best[b], 0.012), 6)]);
    if (!cand.length) cand.push([B.Spine, 1]);
    cand.sort((a, c) => c[1] - a[1]);
    const top = cand.slice(0, 4);
    const sum = top.reduce((s, c) => s + c[1], 0);
    let left = 255;
    top.forEach(([b, w], k) => {
      const q = k === top.length - 1 ? left : Math.round((w / sum) * 255);
      idx[i * 4 + k] = b;
      wt[i * 4 + k] = Math.max(0, Math.min(left, q));
      left -= wt[i * 4 + k];
    });
  }
  return { idx, wt };
}

/** Simplified to about `tris` triangles, keeping UV seams and normals; returns the kept vertices compacted. */
function simplify(g, skin, tris, error) {
  const pos = g.attributes.position.array;
  const index = new Uint32Array(g.index.array);
  const nrm = g.attributes.normal.array;
  const uv = g.attributes.uv.array;
  const attr = new Float32Array(g.attributes.position.count * 5);
  for (let i = 0; i < g.attributes.position.count; i++) {
    attr[i * 5] = nrm[i * 3] * 0.5;
    attr[i * 5 + 1] = nrm[i * 3 + 1] * 0.5;
    attr[i * 5 + 2] = nrm[i * 3 + 2] * 0.5;
    attr[i * 5 + 3] = uv[i * 2];
    attr[i * 5 + 4] = uv[i * 2 + 1];
  }
  const [out] = MeshoptSimplifier.simplifyWithAttributes(index, pos, 3, attr, 5, [1, 1, 1, 1.5, 1.5], null, tris * 3, error, []);
  // Compact the vertices the simplified triangles use.
  const map = new Int32Array(g.attributes.position.count).fill(-1);
  const keep = [];
  const ni = new Uint32Array(out.length);
  for (let k = 0; k < out.length; k++) {
    const v = out[k];
    if (map[v] < 0) {
      map[v] = keep.length;
      keep.push(v);
    }
    ni[k] = map[v];
  }
  const take = (src, w) => {
    const a = new (src.constructor)(keep.length * w);
    keep.forEach((v, k) => {
      for (let c = 0; c < w; c++) a[k * w + c] = src[v * w + c];
    });
    return a;
  };
  return { pos: take(pos, 3), nrm: take(nrm, 3), uv: take(uv, 2), idx: take(skin.idx, 4), wt: take(skin.wt, 4), index: ni, count: keep.length };
}

/** One look as quantized buffers. */
function pack(look, bb) {
  const n = look.count;
  const pos = new Uint16Array(n * 3);
  const size = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
  const min = [bb.min.x, bb.min.y, bb.min.z];
  for (let i = 0; i < n * 3; i++) pos[i] = Math.round(((look.pos[i] - min[i % 3]) / size[i % 3]) * 65535);
  const nrm = new Int8Array(n * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) nrm[i * 4 + c] = Math.round(Math.max(-1, Math.min(1, look.nrm[i * 3 + c])) * 127);
  const uv = new Uint16Array(n * 2);
  for (let i = 0; i < n * 2; i++) uv[i] = Math.round(Math.max(0, Math.min(1, look.uv[i])) * 65535);
  const index = n < 65536 ? new Uint16Array(look.index) : look.index;
  return { n, tris: look.index.length / 3, buffers: [pos, nrm, uv, look.idx, look.wt, index] };
}

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
}

/** The darkest texel's UV (far guns are painted with it). */
function darkUv(file) {
  const tmp = path.join(OUT, '_dark.raw');
  ffmpeg(['-i', path.join(SRC, `${file}.png`), '-vf', 'scale=64:64', '-f', 'rawvideo', '-pix_fmt', 'rgb24', tmp]);
  const px = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < 64 * 64; i++) {
    const l = px[i * 3] + px[i * 3 + 1] + px[i * 3 + 2];
    if (l < best) {
      best = l;
      at = i;
    }
  }
  return [((at % 64) + 0.5) / 64, 1 - (Math.floor(at / 64) + 0.5) / 64];
}

for (const m of MODELS) {
  const t0 = Date.now();
  const raw = normalize(load(m.file));
  const g = mergeVertices(raw, 1e-5);
  const J = measure(g);
  const skin = weights(g, J);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const near = pack(simplify(g, skin, NEAR_TRIS, 0.02), bb);
  const far = pack(simplify(g, skin, FAR_TRIS, 0.2), bb);
  const mid = pack(simplify(g, skin, MID_TRIS, 0.08), bb);
  const head = {
    v: 1,
    bones: BONES,
    joints: J,
    min: bb.min.toArray(),
    size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z],
    dark: darkUv(m.file),
    looks: { near: { n: near.n, tris: near.tris }, far: { n: far.n, tris: far.tris }, mid: { n: mid.n, tris: mid.tris } },
  };
  const parts = [...near.buffers, ...far.buffers, ...mid.buffers];
  head.buffers = parts.map((a) => ({ type: a.constructor.name, length: a.length }));
  const json = Buffer.from(JSON.stringify(head));
  const pad = (n) => (4 - (n % 4)) % 4;
  const chunks = [Buffer.alloc(4), json, Buffer.alloc(pad(json.length))];
  chunks[0].writeUInt32LE(json.length + pad(json.length));
  for (const a of parts) {
    const b = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
    chunks.push(b, Buffer.alloc(pad(b.length)));
  }
  fs.writeFileSync(path.join(OUT, `${m.id}.bin`), Buffer.concat(chunks));
  // Textures.
  const src = (s) => path.join(SRC, `${m.file}${s}.png`);
  ffmpeg(['-i', src(''), '-vf', 'scale=1024:1024', '-q:v', '3', path.join(OUT, `${m.id}_color.jpg`)]);
  ffmpeg(['-i', src('_normal'), '-vf', 'scale=1024:1024', '-q:v', '2', path.join(OUT, `${m.id}_normal.jpg`)]);
  ffmpeg(['-i', src('_roughness'), '-vf', 'scale=512:512,format=gray', '-q:v', '4', path.join(OUT, `${m.id}_rough.jpg`)]);
  ffmpeg(['-i', src('_metallic'), '-vf', 'scale=512:512,format=gray', '-q:v', '4', path.join(OUT, `${m.id}_metal.jpg`)]);
  const size = fs.statSync(path.join(OUT, `${m.id}.bin`)).size;
  console.log(`${m.id}: near ${near.tris} tris / ${near.n} verts, mid ${mid.tris}, far ${far.tris} / ${far.n}, ${(size / 1024).toFixed(0)} KB, joints arm y ${J.aim[1].toFixed(2)}, tip ${J.tip.toFixed(2)} (${Date.now() - t0} ms)`);
}
