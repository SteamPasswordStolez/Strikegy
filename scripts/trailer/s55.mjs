// S55, the mode montage (116.86-123.23 s, one cut on each kick of the finale): the owner's 11 first-person
// clips, recorded in shot order (Medal, C:\Medal\Edits, ~2 s each), cut into one file for build.mjs, which
// takes one footage file a shot: assets-src/trailer/footage/S55.mp4 + its entry in edit.json.
//
//   node scripts/trailer/s55.mjs [clip folder]
//
// `in` puts the clip's action just after the kick (flash moments found with peek.mjs); `bar` crops the
// app's title bar and the black bands out of the two clips recorded in a window (no interface on screen).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = path.join(ROOT, 'assets-src', 'trailer');
const SRC = process.argv[2] ?? 'C:/Medal/Edits';
const FPS = 30;
/** The kicks the cuts land on (docs/design/trailer.md §2), the shot's end last. */
const TIMES = [116.86, 117.54, 118.1, 118.59, 119.23, 119.85, 120.43, 121.14, 121.71, 122.14, 122.55, 123.23];
/** The clips in the order they were recorded (the shot list's order). */
const CLIPS = [
  { what: 'hardpoint: a blast at the door', in: 1.15 },
  { what: 'rush: the charge goes off', in: 0.7 },
  { what: 'search and destroy: at the charge', in: 1.45 },
  { what: 'escort: beside the APC', in: 0.3 },
  { what: 'fortress: the barricade goes up', in: 0.9 },
  { what: 'gun game: the flash', in: 1.4, bar: true },
  { what: 'last soldier: the storm wall', in: 1.0, bar: true },
  { what: 'kill confirmed: the kill and the tag', in: 0.05 },
  { what: 'carrier: a plane on the deck', in: 0.8 },
  { what: 'submarine: going down', in: 1.0 },
  { what: 'tank: the turret', in: 0 },
];
/** The clips' own sound under the music, dB. */
const GAIN = -8;

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.mp4')).sort();
if (files.length !== CLIPS.length) throw new Error(`${files.length} clips in ${SRC}, the montage has ${CLIPS.length}`);
const frameAt = (t) => Math.round(t * FPS);
const inputs = [];
const graph = [];
const pairs = [];
CLIPS.forEach((c, i) => {
  const a = frameAt(c.in);
  const n = frameAt(TIMES[i + 1]) - frameAt(TIMES[i]);
  const dur = n / FPS;
  inputs.push('-i', path.join(SRC, files[i]));
  // The recording's frames come unevenly: to 30 fps first, then counted.
  const crop = c.bar ? 'crop=1920:1000:0:56,' : '';
  graph.push(
    `[${i}:v]setpts=PTS-STARTPTS,fps=${FPS},${crop}scale=1920:1080:force_original_aspect_ratio=increase:out_range=tv,crop=1920:1080,setsar=1,trim=start_frame=${a}:end_frame=${a + n},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`,
  );
  graph.push(
    `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=start=${(a / FPS).toFixed(4)},asetpts=PTS-STARTPTS,apad,atrim=end=${dur.toFixed(4)},volume=${GAIN}dB,afade=t=in:d=0.006,afade=t=out:st=${(dur - 0.012).toFixed(4)}:d=0.012[a${i}]`,
  );
  pairs.push(`[v${i}][a${i}]`);
  console.log(`${String(i + 1).padStart(2)} ${TIMES[i].toFixed(2)} ${n} frames from ${c.in} s: ${c.what}`);
});
graph.push(`${pairs.join('')}concat=n=${CLIPS.length}:v=1:a=1[v][a]`);
const out = path.join(T, 'footage', 'S55.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', graph.join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', out]);

const editFile = path.join(T, 'edit.json');
const edit = JSON.parse(fs.readFileSync(editFile, 'utf8'));
// The gain is in the file already.
edit.S55 = { file: 'footage/S55.mp4', in: 0, gain: 0 };
fs.writeFileSync(editFile, JSON.stringify(edit, null, 2) + '\n');
console.log(`footage/S55.mp4, ${frameAt(TIMES.at(-1)) - frameAt(TIMES[0])} frames, in edit.json`);
