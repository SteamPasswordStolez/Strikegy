// The Korean-military Short's map data, all in the git-ignored assets-src/shorts/rok/:
// countries.json (Natural Earth 1:10m rings of the countries the map shows, cut to East and South-East Asia),
// and two pieces of NASA's Blue Marble tile D1 (0-90 N, 90-180 E, 240 pixels a degree):
// asia.jpg (95-150 E, 5-55 N at 60 px a degree), korea.jpg (122-134 E, 32.5-44 N at 240 px a degree).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const sharp = createRequire(import.meta.url)('sharp');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, 'assets-src/shorts/rok');
const WANT = ['South Korea', 'North Korea', 'China', 'Japan', 'Russia', 'Mongolia', 'Taiwan', 'Vietnam', 'Laos', 'Cambodia', 'Thailand', 'Myanmar', 'Philippines', 'Malaysia', 'Indonesia', 'Hong Kong', 'Macao S.A.R', 'Bangladesh', 'India', 'Bhutan', 'Nepal'];
const BOX = { w: 90, e: 165, s: -5, n: 62 };

const shp = fs.readFileSync(path.join(DIR, 'ne/ne_10m_admin_0_countries.shp'));
const dbf = fs.readFileSync(path.join(DIR, 'ne/ne_10m_admin_0_countries.dbf'));
const headerLen = dbf.readUInt16LE(8);
const recordLen = dbf.readUInt16LE(10);
const records = dbf.readUInt32LE(4);
let fieldAt = 1;
let nameField = null;
for (let o = 32; dbf[o] !== 0x0d; o += 32) {
  const name = dbf.toString('latin1', o, o + 11).split('\0')[0];
  const len = dbf[o + 16];
  if (name === 'ADMIN') nameField = { at: fieldAt, len };
  fieldAt += len;
}
const out = {};
let at = 100;
for (let r = 0; r < records; r++) {
  const start = headerLen + r * recordLen + nameField.at;
  const name = dbf.toString('utf8', start, start + nameField.len).replace(/\0+/g, '').trim();
  const words = shp.readInt32BE(at + 4);
  const body = at + 8;
  if (shp.readInt32LE(body) === 5 && WANT.includes(name)) {
    const parts = shp.readInt32LE(body + 36);
    const points = shp.readInt32LE(body + 40);
    const first = body + 44;
    const coords = first + parts * 4;
    const rings = [];
    for (let p = 0; p < parts; p++) {
      const a = shp.readInt32LE(first + p * 4);
      const b = p + 1 < parts ? shp.readInt32LE(first + (p + 1) * 4) : points;
      const ring = [];
      for (let i = a; i < b; i++) ring.push([+shp.readDoubleLE(coords + i * 16).toFixed(4), +shp.readDoubleLE(coords + i * 16 + 8).toFixed(4)]);
      const near = ring.some(([x, y]) => x >= BOX.w && x <= BOX.e && y >= BOX.s && y <= BOX.n);
      if (near && ring.length > 3) rings.push(ring);
    }
    if (rings.length) out[name] = rings;
  }
  at = body + words * 2;
}
fs.writeFileSync(path.join(DIR, 'countries.json'), JSON.stringify(out));
for (const [n, rings] of Object.entries(out)) console.log(n, rings.length, 'rings', rings.reduce((s, x) => s + x.length, 0), 'points');

const tile = path.join(DIR, 'nasa/world.topo.bathy.200412.3x21600x21600.D1.jpg');
const PPD = 240;
// ffmpeg refuses a JPEG this size; sharp reads it.
const crop = async (w, e, s, n, out_, ppd) => {
  const left = Math.round((w - 90) * PPD);
  const top = Math.round((90 - n) * PPD);
  const width = Math.round((e - w) * PPD);
  const height = Math.round((n - s) * PPD);
  const file = path.join(DIR, out_);
  await sharp(tile, { limitInputPixels: false })
    .extract({ left, top, width, height })
    .resize(Math.round((e - w) * ppd), Math.round((n - s) * ppd))
    .jpeg({ quality: 88 })
    .toFile(file);
  console.log(out_, `${Math.round((e - w) * ppd)}x${Math.round((n - s) * ppd)}`, (fs.statSync(file).size / 1e6).toFixed(1), 'MB');
};
await crop(95, 150, 5, 55, 'asia.jpg', 60);
await crop(122, 134, 32.5, 44, 'korea.jpg', 240);
