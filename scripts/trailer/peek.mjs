// Helps pick a footage in-point for the launch trailer (docs/design/trailer-production.md §5):
// Claude can't watch a video, so this lists the moments where the picture suddenly brightens
// (muzzle flashes, explosions, a ramp opening: what a cut on a hit wants) and draws a contact
// sheet with timestamps to look at.
//
//   node scripts/trailer/peek.mjs <footage> [--from s] [--to s] [--every s]
//
// Writes assets-src/trailer/peek/<name>_<from>-<to>.png (a 5-wide grid, a frame every --every s,
// default 0.5) and prints the ten biggest brightness jumps with their times.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const file = args[0];
const opt = (n, d) => (args.includes(`--${n}`) ? Number(args[args.indexOf(`--${n}`) + 1]) : d);
if (!file || !fs.existsSync(file)) {
  console.error('usage: node scripts/trailer/peek.mjs <footage> [--from s] [--to s] [--every s]');
  process.exit(1);
}
const length = Number(
  execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    file,
  ]).toString(),
);
const from = opt('from', 0);
const to = Math.min(opt('to', length), length);
const every = opt('every', 0.5);

// Average brightness of every frame (signalstats YAVG), then the biggest rises frame to frame.
const stats = execFileSync(
  'ffmpeg',
  [
    '-v',
    'error',
    '-ss',
    String(from),
    '-to',
    String(to),
    '-i',
    file,
    '-vf',
    'scale=320:-2,signalstats,metadata=print:file=-',
    '-f',
    'null',
    '-',
  ],
  { maxBuffer: 64 << 20 },
).toString();
const ys = [];
let t = 0;
for (const line of stats.split('\n')) {
  const pts = /pts_time:([\d.]+)/.exec(line);
  if (pts) t = Number(pts[1]);
  const y = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
  if (y) ys.push({ t: from + t, y: Number(y[1]) });
}
const jumps = ys
  .slice(1)
  .map((s, i) => ({ t: s.t, rise: s.y - ys[i].y }))
  .sort((a, b) => b.rise - a.rise);
const picked = [];
for (const j of jumps) {
  if (picked.length >= 10) break;
  if (picked.every((p) => Math.abs(p.t - j.t) > 0.3)) picked.push(j);
}
console.log('biggest brightness jumps (time in the file, rise of the average 0-255):');
for (const p of picked.sort((a, b) => a.t - b.t))
  console.log(`  ${p.t.toFixed(2)} s  +${p.rise.toFixed(1)}`);

const dir = path.join(ROOT, 'assets-src', 'trailer', 'peek');
fs.mkdirSync(dir, { recursive: true });
const n = Math.max(1, Math.ceil((to - from) / every));
const rows = Math.ceil(n / 5);
const out = path.join(
  dir,
  `${path.basename(file, path.extname(file))}_${from}-${to.toFixed(0)}.png`,
);
// Time labels need ffmpeg's drawtext and a TTF; without either the sheet is drawn unlabelled.
const fonts = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'C\\:/Windows/Fonts/arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
];
const tile = `fps=1/${every},scale=384:-2`;
let labelled = false;
for (const font of fonts) {
  try {
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-ss',
        String(from),
        '-to',
        String(to),
        '-i',
        file,
        '-vf',
        `${tile},drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6:fontfile='${font}',tile=5x${rows}`,
        '-frames:v',
        '1',
        out,
      ],
      { stdio: 'ignore' },
    );
    labelled = true;
    break;
  } catch {
    // next font, or no labels
  }
}
if (!labelled)
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-ss',
    String(from),
    '-to',
    String(to),
    '-i',
    file,
    '-vf',
    `${tile},tile=5x${rows}`,
    '-frames:v',
    '1',
    out,
  ]);
console.log(
  `contact sheet: ${path.relative(ROOT, out)} (frame k is at ${from} + k x ${every} s; the label shows time from --from)`,
);
