// Builds game-ready sounds from CC0 sources listed in sounds.manifest.json.
// Downloads/extracts sources into git-ignored assets-src/sounds (needs 7-Zip for the
// firearm library), then uses ffmpeg to trim each sound from its first onset,
// fade the tail, peak-normalize and write mono 24 kHz 16-bit WAV to
// public/assets/sounds/. WAV avoids the encoder padding MP3/AAC add, which would
// delay gunshots. Entries with {a,b,c} in `src` produce numbered variants.
//
//   npm run sounds                       rebuild everything
//   npm run sounds -- --only gun_ar,bird only these ids (and only their sources are fetched)
//
// 7-Zip: SEVEN_ZIP env var, else the Windows default path, else `7z` on PATH (p7zip).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const manifest = JSON.parse(fs.readFileSync('sounds.manifest.json', 'utf8'));
const SRC = path.join('assets-src', 'sounds');
const OUT = path.join('public', 'assets', 'sounds');
const SEVEN_ZIP = process.env.SEVEN_ZIP ?? (process.platform === 'win32' ? 'C:/Program Files/7-Zip/7z.exe' : '7z');

const onlyArg = process.argv.indexOf('--only');
const only = onlyArg >= 0 ? new Set((process.argv[onlyArg + 1] ?? '').split(',').filter(Boolean)) : null;
if (only) {
  const unknown = [...only].filter((id) => !(id in manifest.sounds));
  if (unknown.length) throw new Error(`unknown sound ids: ${unknown.join(', ')}`);
}
const selected = Object.entries(manifest.sounds).filter(([id]) => !only || only.has(id));

/** Source a sound path comes from: its archive folder, or the file itself. */
function sourceOf(rel) {
  return Object.values(manifest.sources).find((s) => (s.extract ? rel.startsWith(`${s.extract}/`) : rel === s.file));
}
const needed = new Set(selected.map(([, spec]) => sourceOf(spec.src)));
if (needed.has(undefined)) throw new Error('a sound src matches no source in sounds.manifest.json');

fs.mkdirSync(SRC, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

for (const src of needed) {
  const file = path.join(SRC, src.file);
  if (!fs.existsSync(file)) {
    console.log(`download ${src.url}`);
    const res = await fetch(src.url);
    if (!res.ok) throw new Error(`${res.status} ${src.url}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  if (src.extract && !fs.existsSync(path.join(SRC, src.extract))) {
    const dest = path.join(SRC, src.extract);
    fs.mkdirSync(dest, { recursive: true });
    if (file.endsWith('.7z')) execFileSync(SEVEN_ZIP, ['x', '-y', `-o${dest}`, file], { stdio: 'ignore' });
    // Windows tar (bsdtar) reads zips; GNU tar on Linux does not.
    else if (file.endsWith('.zip') && process.platform !== 'win32') execFileSync('unzip', ['-q', '-o', file, '-d', dest]);
    else execFileSync('tar', ['-xf', file, '-C', dest]);
  }
}

/** "a_{0,1}.ogg" -> ["a_0.ogg", "a_1.ogg"] */
function expand(src) {
  const m = /\{([^}]+)\}/.exec(src);
  return m ? m[1].split(',').map((v) => src.replace(m[0], v)) : [src];
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  return r.stderr;
}

function channels(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr}`);
  return Number(r.stdout.trim());
}

let total = 0;
let count = 0;
for (const [id, spec] of selected) {
  const inputs = expand(spec.src);
  inputs.forEach((rel, i) => {
    const input = path.join(SRC, rel);
    const dest = path.join(OUT, inputs.length > 1 ? `${id}_${i}.wav` : `${id}.wav`);
    const chain = [
      // Start exactly at the first transient so shots line up with the muzzle flash.
      'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.004',
      // Average stereo to mono (mono sources pass through; `pan` fails on them).
      ...(channels(input) > 1 ? ['pan=mono|c0=0.5*c0+0.5*c1'] : []),
    ];
    if (spec.dur) chain.push(`atrim=0:${spec.dur}`, `afade=t=out:st=${(spec.dur * 0.55).toFixed(3)}:d=${(spec.dur * 0.45).toFixed(3)}`);
    const base = chain.join(',');
    const probe = ffmpeg(['-i', input, '-af', `${base},volumedetect`, '-f', 'null', '-']);
    const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(probe)?.[1] ?? '0');
    const gain = -1 - peak;
    ffmpeg(['-loglevel', 'error', '-y', '-i', input, '-af', `${base},volume=${gain.toFixed(2)}dB`, '-ar', '24000', '-ac', '1', '-sample_fmt', 's16', dest]);
    total += fs.statSync(dest).size;
    count++;
  });
}

// Index consumed by the game's sample bank: id -> variant count.
const index = {};
for (const [id, spec] of Object.entries(manifest.sounds)) index[id] = expand(spec.src).length;
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`wrote ${count} sounds, ${(total / 1024).toFixed(0)} KB`);
