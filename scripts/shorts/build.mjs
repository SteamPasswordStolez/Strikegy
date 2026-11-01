// Puts a 16:9 game clip into a vertical Short: 1080x1920, the game sharp in the
// middle, its blurred copy behind the top and bottom bands (scripts/shorts/frame.html).
// Work files and results go to the git-ignored assets-src/shorts/.
//
//   node scripts/shorts/build.mjs <clip> --title 반자이 [--sub "작은 줄"]
//        [--from 12.5] [--to 31] [--out banzai] [--still 3] [--crop 36,4]
//
// --still <s> writes one PNG of that moment instead of the video, to check the look.
// --crop <top,bottom> cuts pixels off the clip first (a browser window's title bar).
// In a title, "\n" starts a new line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'assets-src', 'shorts');
const W = 1080;
const H = 1920;

const VALUED = new Set(['title', 'sub', 'from', 'to', 'out', 'still', 'crop']);
const opts = {};
const inputs = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const key = args[i].startsWith('--') ? args[i].slice(2) : null;
  if (key === null) inputs.push(args[i]);
  else if (VALUED.has(key) && i + 1 < args.length) opts[key] = args[++i];
  else throw new Error(`Unknown or empty option: ${args[i]}`);
}
const [clip] = inputs;
if (!clip || !opts.title) {
  console.error('Usage: node scripts/shorts/build.mjs <clip> --title <text> [--sub <text>] [--from s] [--to s] [--out name] [--still s]');
  process.exit(1);
}
if (!fs.existsSync(clip)) throw new Error(`No such clip: ${clip}`);
const name = opts.out ?? path.parse(clip).name;
const from = Number(opts.from ?? 0);
const to = opts.to === undefined ? null : Number(opts.to);
if (!(from >= 0) || (to !== null && !(to > from))) throw new Error('--from / --to are seconds, with --to after --from');
const [cropTop, cropBottom] = (opts.crop ?? '0,0').split(',').map(Number);
if (!(cropTop >= 0) || !(cropBottom >= 0)) throw new Error('--crop is top,bottom in pixels');

/** The clip's streams, read so a clip without sound still builds. */
function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,avg_frame_rate,width,height', '-of', 'json', file], { encoding: 'utf8' });
  const { streams } = JSON.parse(out);
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video) throw new Error(`No video in ${file}`);
  const [num, den] = video.avg_frame_rate.split('/').map(Number);
  const fps = den ? num / den : 30;
  return { audio: streams.some((s) => s.codec_type === 'audio'), fps: Math.min(60, Math.max(24, Math.round(fps))), width: video.width, height: video.height };
}

const { audio, fps, width, height } = probe(clip);
const shownH = height - cropTop - cropBottom;
if (shownH <= 0) throw new Error('--crop leaves nothing of the clip');
/** The game's picture: full width, in the middle (even numbers for H.264). */
const GAME_H = Math.round((W * shownH) / width / 2) * 2;
const GAME_Y = (H - GAME_H) / 2;

/** The bands as a transparent picture. */
async function renderFrame(file) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto(pathToFileURL(path.join(ROOT, 'scripts/shorts/frame.html')).href);
    await page.evaluate((t) => window.setup(t), { title: opts.title.replaceAll('\\n', '\n'), sub: opts.sub ?? '', gameY: GAME_Y, gameH: GAME_H });
    await page.screenshot({ path: file, omitBackground: true });
  } finally {
    await browser.close();
  }
}

fs.mkdirSync(OUT, { recursive: true });
const framePng = path.join(OUT, `${name}.frame.png`);
await renderFrame(framePng);

const graph = [
  `[0:v]crop=iw:${shownH}:0:${cropTop},split[a][b]`,
  // The blurred copy fills the screen; a blur this wide costs far less at quarter size.
  `[a]scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${H / 4},gblur=sigma=14,scale=${W}:${H},setsar=1[bg]`,
  `[b]scale=${W}:${GAME_H},setsar=1[game]`,
  '[bg][1:v]overlay=0:0[banded]',
  // Trailer footage is full range; players expect the usual video range.
  `[banded][game]overlay=0:${GAME_Y},scale=out_range=tv,format=yuv420p[v]`,
].join(';');

if (opts.still !== undefined) {
  const file = path.join(OUT, `${name}.still.png`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(from + Number(opts.still)), '-i', clip, '-i', framePng, '-filter_complex', graph, '-map', '[v]', '-frames:v', '1', file], { stdio: 'inherit' });
  console.log(file);
} else {
  const file = path.join(OUT, `${name}.mp4`);
  const cut = ['-ss', String(from), ...(to === null ? [] : ['-t', String(to - from)])];
  const sound = audio
    ? ['-map', '0:a:0', '-af', 'loudnorm=I=-14:TP=-1.0:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k']
    : ['-an'];
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...cut, '-i', clip, '-i', framePng, '-filter_complex', graph, '-map', '[v]', ...sound, '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart', file], { stdio: 'inherit' });
  console.log(file);
}
