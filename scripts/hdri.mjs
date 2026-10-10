// HDRI -> the game's sky (used by optimize-assets.mjs). Writes to sky/<profile>/:
//  - sky.webp: the upper part of the equirect (elevation SKY_BOTTOM..90 degrees) at
//    the source's width, in linear light scaled so the horizon is 1, stored as
//    sqrt(v / (1 + v)) so the 8 bits cover the bright clouds and sun glow too; the
//    game's sky shader undoes it (v = t / (1 - t), t = c^2) and the frame's tone
//    mapping applies as for everything else
//  - sky.json: the sun (the game's elevation / azimuth in degrees, from the brightest
//    pixel), the horizon and zenith colours in the same linear units
// The game keeps lighting the scene from its procedural sky; the picture is only what you see.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/** Lowest elevation stored (degrees); below it the sky shader holds the bottom row. */
const SKY_BOTTOM = -6;

/** Radiance .hdr (RGBE, flat or new-style RLE scanlines) -> { w, h, rgb: Float32Array }. */
export function readHdr(buf) {
  let p = 0;
  const line = () => {
    let e = p;
    while (buf[e] !== 0x0a) e++;
    const l = buf.toString('latin1', p, e);
    p = e + 1;
    return l;
  };
  while (line().trim() !== '');
  const m = /-Y (\d+) \+X (\d+)/.exec(line());
  const h = Number(m[1]);
  const w = Number(m[2]);
  const rgb = new Float32Array(w * h * 3);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (buf[p] === 2 && buf[p + 1] === 2 && ((buf[p + 2] << 8) | buf[p + 3]) === w) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          let n = buf[p++];
          if (n > 128) {
            n -= 128;
            const v = buf[p++];
            for (let i = 0; i < n; i++) scan[(x++) * 4 + c] = v;
          } else for (let i = 0; i < n; i++) scan[(x++) * 4 + c] = buf[p++];
        }
      }
    } else {
      for (let i = 0; i < w * 4; i++) scan[i] = buf[p++];
    }
    for (let x = 0; x < w; x++) {
      const e = scan[x * 4 + 3];
      const k = e ? Math.pow(2, e - 136) : 0;
      const o = (y * w + x) * 3;
      rgb[o] = (scan[x * 4] + 0.5) * k;
      rgb[o + 1] = (scan[x * 4 + 1] + 0.5) * k;
      rgb[o + 2] = (scan[x * 4 + 2] + 0.5) * k;
    }
  }
  return { w, h, rgb };
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const enc = (v) => Math.round(255 * Math.sqrt(Math.max(0, v) / (1 + Math.max(0, v))));
const hex = (rgb) => '#' + rgb.map((v) => Math.round(255 * Math.min(1, v)).toString(16).padStart(2, '0')).join('');

/** Converts one HDRI; returns a report line. */
export async function convertHdri(srcFile, outDir) {
  const src = readHdr(fs.readFileSync(srcFile));
  fs.mkdirSync(outDir, { recursive: true });
  const rowOf = (deg) => Math.round(src.h * (0.5 - deg / 180));
  /** Mean colour of the band between two elevations (degrees). */
  const band = (a0, a1) => {
    const s = [0, 0, 0];
    let n = 0;
    for (let y = rowOf(a1); y < rowOf(a0); y++)
      for (let x = 0; x < src.w; x++) {
        for (let c = 0; c < 3; c++) s[c] += src.rgb[(y * src.w + x) * 3 + c];
        n++;
      }
    return s.map((v) => v / n);
  };
  const horizonRaw = band(1, 8);
  const scale = 1 / Math.max(1e-6, lum(...horizonRaw));
  const rows = rowOf(SKY_BOTTOM);
  const px = Buffer.alloc(src.w * rows * 3);
  for (let i = 0; i < src.w * rows * 3; i++) px[i] = enc(src.rgb[i] * scale);
  await sharp(px, { raw: { width: src.w, height: rows, channels: 3 } }).webp({ quality: 90 }).toFile(path.join(outDir, 'sky.webp'));
  // The sun: the brightest pixel above the horizon. Three's equirect lookup is
  // u = atan(dir.z, dir.x) / 2pi + 0.5, v = asin(dir.y) / pi + 0.5 (row 0 = top).
  let best = -1;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < src.h / 2; y++)
    for (let x = 0; x < src.w; x++) {
      const o = (y * src.w + x) * 3;
      const l = lum(src.rgb[o], src.rgb[o + 1], src.rgb[o + 2]);
      if (l > best) {
        best = l;
        bx = x;
        by = y;
      }
    }
  const el = (0.5 - (by + 0.5) / src.h) * Math.PI;
  const ang = ((bx + 0.5) / src.w - 0.5) * 2 * Math.PI;
  const dir = [Math.cos(ang) * Math.cos(el), Math.sin(el), Math.sin(ang) * Math.cos(el)];
  const sun = {
    elevation: +((el * 180) / Math.PI).toFixed(1),
    /** Degrees from +z toward +x (the visual profiles' convention: x = sin, z = cos). */
    azimuth: +((Math.atan2(dir[0], dir[2]) * 180) / Math.PI).toFixed(1),
    /** Brightest pixel over the horizon brightness. */
    peak: +(best * scale).toFixed(1),
  };
  const horizon = horizonRaw.map((v) => v * scale);
  const zenith = band(60, 90).map((v) => v * scale);
  // Light on flat ground from the sky with the sun's glow capped at 4, in the same
  // units (for reference: the game lights the scene from its procedural sky).
  let irradiance = 0;
  const dTheta = (2 * Math.PI) / src.w;
  const dPhi = Math.PI / src.h;
  for (let y = 0; y < src.h / 2; y++) {
    const e = (0.5 - (y + 0.5) / src.h) * Math.PI;
    const w = Math.sin(e) * Math.cos(e) * dTheta * dPhi;
    for (let x = 0; x < src.w; x++) {
      const o = (y * src.w + x) * 3;
      irradiance += lum(...[0, 1, 2].map((c) => Math.min(4, src.rgb[o + c] * scale))) * w;
    }
  }
  const json = {
    source: path.basename(srcFile, '.hdr'),
    bottom: SKY_BOTTOM,
    sun,
    irradiance: +irradiance.toFixed(3),
    horizon: horizon.map((v) => +v.toFixed(4)),
    zenith: zenith.map((v) => +v.toFixed(4)),
  };
  fs.writeFileSync(path.join(outDir, 'sky.json'), JSON.stringify(json, null, 2) + '\n');
  const size = ['sky.webp', 'sky.json'].reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
  return `sky     ${path.basename(outDir).padEnd(16)} ${Math.round(size / 1024)} KB  (${json.source}) ${src.w}x${rows}, sun ${sun.elevation} / ${sun.azimuth} (x${sun.peak}), horizon ${hex(horizon)}, zenith ${hex(zenith)}`;
}
