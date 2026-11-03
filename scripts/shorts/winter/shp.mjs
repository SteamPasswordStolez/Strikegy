// Natural Earth's countries (a shapefile in the git-ignored assets-src/shorts/winter/ne/) to the rings of
// the countries the map shows, as assets-src/shorts/winter/countries.json: { "Finland": [[[lon, lat], ...], ...] }.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, 'assets-src/shorts/winter');
const WANT = ['Finland', 'Russia', 'Sweden', 'Norway', 'Estonia', 'Latvia', 'Lithuania', 'Belarus', 'Poland', 'Germany', 'Denmark', 'Ukraine'];

const shp = fs.readFileSync(path.join(DIR, 'ne/ne_50m_admin_0_countries.shp'));
const dbf = fs.readFileSync(path.join(DIR, 'ne/ne_50m_admin_0_countries.dbf'));

// The attribute table: one name a record.
const headerLen = dbf.readUInt16LE(8);
const recordLen = dbf.readUInt16LE(10);
const records = dbf.readUInt32LE(4);
let fieldAt = 1;
let nameField = null;
for (let o = 32; dbf[o] !== 0x0d; o += 32) {
  const name = dbf.toString('latin1', o, o + 11).replace(/\0.*$/, '');
  const len = dbf[o + 16];
  if (name === 'ADMIN') nameField = { at: fieldAt, len };
  fieldAt += len;
}
const names = [];
for (let r = 0; r < records; r++) {
  const start = headerLen + r * recordLen + nameField.at;
  names.push(dbf.toString('utf8', start, start + nameField.len).replace(/\0+/g, '').trim());
}

// The shapes: polygons as rings of [lon, lat].
const out = {};
let at = 100;
for (let r = 0; r < records; r++) {
  const words = shp.readInt32BE(at + 4);
  const body = at + 8;
  const type = shp.readInt32LE(body);
  if (type === 5 && WANT.includes(names[r])) {
    const parts = shp.readInt32LE(body + 36);
    const points = shp.readInt32LE(body + 40);
    const first = body + 44;
    const coords = first + parts * 4;
    const rings = [];
    for (let p = 0; p < parts; p++) {
      const a = shp.readInt32LE(first + p * 4);
      const b = p + 1 < parts ? shp.readInt32LE(first + (p + 1) * 4) : points;
      const ring = [];
      for (let i = a; i < b; i++) ring.push([shp.readDoubleLE(coords + i * 16), shp.readDoubleLE(coords + i * 16 + 8)]);
      rings.push(ring);
    }
    out[names[r]] = rings;
  }
  at = body + words * 2;
}
fs.writeFileSync(path.join(DIR, 'countries.json'), JSON.stringify(out));
for (const [n, rings] of Object.entries(out)) console.log(n, rings.length, 'rings', rings.reduce((s, x) => s + x.length, 0), 'points');
