// Brings the battle briefing's generated voice lines into the game
// (docs/design/battle-briefing.md §8). Reads assets-src/voice/<lang>/ (git-ignored:
// the files as generated, named as in docs/design/briefing-lines.csv, any of
// mp3 / wav / ogg / m4a / flac), and for every line the cues know:
//   trims the silence at both ends, evens the loudness (EBU R128, -18 LUFS, peaks
//   under -1.5 dB), fades the last 30 ms, and writes mono 24 kHz 48 kbps mp3 to
//   public/assets/voice/<lang>/<file>.mp3, plus index.json (file -> seconds).
// The radio sound is added in the game, so the files stay clean.
//
//   npm run voice                 every language folder there is
//   npm run voice -- de           just German
// Needs ffmpeg / ffprobe on PATH.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { VOICE_LANGS, allVoiceFiles } from '../src/audio/briefing/cues.ts';

const SRC = path.join('assets-src', 'voice');
const OUT = path.join('public', 'assets', 'voice');
const EXTS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`);
  return r;
}

// The radio's languages only (assets-src/voice/test holds voice auditions; ko was the first
// try, before the owner chose English and the maps' own languages).
const LANGS = VOICE_LANGS;
const langs = process.argv[2] ? [process.argv[2]] : fs.existsSync(SRC) ? LANGS.filter((d) => fs.existsSync(path.join(SRC, d))) : [];
if (!langs.length) {
  console.log(`nothing to do: put the generated lines in ${SRC}/<lang>/ (e.g. ${SRC}/ko/zone.taken.B_1.mp3)`);
  process.exit(0);
}

const known = allVoiceFiles().map((f) => f.file);
for (const lang of langs) {
  const dir = path.join(SRC, lang);
  if (!fs.existsSync(dir)) {
    console.log(`${lang}: no ${dir}`);
    continue;
  }
  const have = new Map();
  for (const name of fs.readdirSync(dir)) {
    const ext = path.extname(name).toLowerCase();
    if (EXTS.includes(ext)) have.set(name.slice(0, -ext.length), path.join(dir, name));
  }
  const out = path.join(OUT, lang);
  fs.mkdirSync(out, { recursive: true });
  const index = {};
  let bytes = 0;
  for (const file of known) {
    const input = have.get(file);
    if (!input) continue;
    const dest = path.join(out, `${file}.mp3`);
    const chain = [
      // Silence off the front, then (reversed) off the back.
      'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02',
      'areverse',
      'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05',
      'areverse',
      'loudnorm=I=-18:TP=-1.5:LRA=7',
    ].join(',');
    // loudnorm resamples to 192 kHz internally; the output rate below brings it back down.
    const tmp = `${dest}.tmp.wav`;
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-af', chain, '-ac', '1', '-ar', '24000', tmp]);
    const dur = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp]).stdout.trim());
    const fade = Math.max(0, dur - 0.03).toFixed(3);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-af', `afade=t=out:st=${fade}:d=0.03`, '-ac', '1', '-ar', '24000', '-b:a', '48k', dest]);
    fs.unlinkSync(tmp);
    index[file] = Math.round(dur * 100) / 100;
    bytes += fs.statSync(dest).size;
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ files: index }, null, 2) + '\n');
  const done = Object.keys(index).length;
  const missing = known.filter((f) => !index[f]);
  const extra = [...have.keys()].filter((f) => !known.includes(f));
  console.log(`${lang}: ${done} / ${known.length} lines, ${(bytes / 1024).toFixed(0)} KB`);
  if (missing.length) console.log(`  missing ${missing.length} (text only in the game): ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', ...' : ''}`);
  if (extra.length) console.log(`  not a line the game knows (check the name): ${extra.join(', ')}`);
}
