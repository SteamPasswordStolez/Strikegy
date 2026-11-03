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
//
// --style card is the bright layout instead (scripts/shorts/card.html): channel, title,
// the game, and a count under it. --kills 6.55,11.05 are the clip's seconds at which the
// count goes up; --count-label 처치 and --count-unit 명 name it. Without --kills no count shows.
// --end-hold 1 holds the last frame that long, with the game's sound cut; --end-label 최종
// shows the final count under that label meanwhile.
//
// --music song.mp3 --music-end 28 lays a song under it so that the song's second 28 falls on
// the video's last frame (it starts part-way in and fades over the last 0.3 s). --music-gain 0.35.
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
/** The card's game picture starts here, under the channel and the title. */
const CARD_GAME_Y = 556;
/** How long a count stays big and red when it goes up (seconds), and the strip it is drawn in (px). */
const COUNT_POP = 0.14;
const COUNT_H = 330;

const VALUED = new Set(['title', 'sub', 'from', 'to', 'out', 'still', 'crop', 'style', 'kills', 'count-label', 'count-unit', 'end-hold', 'end-label', 'music', 'music-end', 'music-gain']);
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
const card = opts.style === 'card';
if (opts.style !== undefined && !card) throw new Error('--style is card, or left out');
const kills = opts.kills === undefined ? [] : opts.kills.split(',').map(Number).sort((a, b) => a - b);
if (kills.some((k) => !(k >= 0))) throw new Error('--kills are seconds in the clip');
if (kills.length > 0 && !card) throw new Error('--kills needs --style card');
const endHold = Number(opts['end-hold'] ?? 0);
if (!(endHold >= 0)) throw new Error('--end-hold is seconds');
if (opts.music !== undefined && !fs.existsSync(opts.music)) throw new Error(`No such music: ${opts.music}`);
const musicEnd = opts['music-end'] === undefined ? null : Number(opts['music-end']);
if (opts.music !== undefined && !(musicEnd > 0)) throw new Error('--music needs --music-end, the second of the song the video ends on');
const musicGain = Number(opts['music-gain'] ?? 0.35);

/** The clip's streams, read so a clip without sound still builds. */
function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,avg_frame_rate,width,height,duration', '-of', 'json', file], { encoding: 'utf8' });
  const { streams } = JSON.parse(out);
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video) throw new Error(`No video in ${file}`);
  const [num, den] = video.avg_frame_rate.split('/').map(Number);
  const fps = den ? num / den : 30;
  return { audio: streams.some((s) => s.codec_type === 'audio'), fps: Math.min(60, Math.max(24, Math.round(fps))), width: video.width, height: video.height, length: Number(video.duration) };
}

const { audio, fps, width, height, length } = probe(clip);
/** The clip's part in the video, and the whole video with the held end. */
const clipLength = (to ?? length) - from;
const videoLength = clipLength + endHold;
const hasMusic = opts.music !== undefined;
if (hasMusic && musicEnd < videoLength) throw new Error(`--music-end ${musicEnd} is before the video's length ${videoLength.toFixed(2)} s`);
const shownH = height - cropTop - cropBottom;
if (shownH <= 0) throw new Error('--crop leaves nothing of the clip');
/** The game's picture: full width, in the middle on the bands (even numbers for H.264). */
const GAME_H = Math.round((W * shownH) / width / 2) * 2;
const GAME_Y = card ? CARD_GAME_Y : (H - GAME_H) / 2;

/** The card as one picture and every state of the count as a strip; returns the strips with when each shows. */
async function renderCard(file) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto(pathToFileURL(path.join(ROOT, 'scripts/shorts/card.html')).href);
    const emblem = fs.readFileSync(path.join(ROOT, 'public/brand/glitchedspell-emblem.svg'), 'utf8');
    await page.evaluate((t) => window.setup(t), {
      title: opts.title.replaceAll('\\n', '\n'),
      label: opts['count-label'] ?? '',
      emblem,
      gameY: GAME_Y,
      gameH: GAME_H,
    });
    await page.evaluate(() => window.showCard());
    await page.screenshot({ path: file, omitBackground: true });
    if (kills.length === 0) return [];
    const unit = opts['count-unit'] ?? '';
    const clip2 = { x: 0, y: GAME_Y + GAME_H, width: W, height: COUNT_H };
    const start = from + Number(opts.still ?? 0);
    const strips = [];
    const heldFrom = endHold > 0 ? from + clipLength - start : Infinity;
    for (let n = 0; n <= kills.length; n++) {
      const at = n === 0 ? -1 : kills[n - 1] - start;
      const end = n === kills.length ? heldFrom : kills[n] - start;
      for (const pop of n === 0 ? [false] : [true, false]) {
        const strip = `${file.replace(/\.png$/, '')}.${n}${pop ? 'p' : ''}.png`;
        await page.evaluate(([c, u, p]) => window.showCount(c, u, p), [n, unit, pop]);
        await page.screenshot({ path: strip, clip: clip2, omitBackground: true });
        const a = pop || n === 0 ? at : at + COUNT_POP;
        const b = pop ? Math.min(at + COUNT_POP, end) : end;
        strips.push({ strip, enable: b === Infinity ? `gte(t,${a})` : `between(t,${a},${b - 0.0001})` });
      }
    }
    if (heldFrom !== Infinity) {
      const strip = `${file.replace(/\.png$/, '')}.end.png`;
      await page.evaluate(([c, u, l]) => window.showCount(c, u, true, l), [kills.length, unit, opts['end-label'] ?? opts['count-label'] ?? '']);
      await page.screenshot({ path: strip, clip: clip2, omitBackground: true });
      strips.push({ strip, enable: `gte(t,${heldFrom})` });
    }
    return strips;
  } finally {
    await browser.close();
  }
}

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
const strips = card ? await renderCard(framePng) : (await renderFrame(framePng), []);

const frameInput = ['-i', framePng];
const stripInputs = strips.flatMap(({ strip }) => ['-i', strip]);
const hold = endHold > 0 ? `,tpad=stop_mode=clone:stop_duration=${endHold}` : '';
const graph = card
  ? [
      `[0:v]crop=iw:${shownH}:0:${cropTop},scale=${W}:${GAME_H},setsar=1${hold},pad=${W}:${H}:0:${GAME_Y}[game]`,
      '[game][1:v]overlay=0:0[c0]',
      ...strips.map(({ enable }, i) => `[c${i}][${i + 2}:v]overlay=0:${GAME_Y + GAME_H}:enable='${enable}'[c${i + 1}]`),
      `[c${strips.length}]scale=out_range=tv,format=yuv420p[v]`,
    ].join(';')
  : [
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
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(from + Number(opts.still)), '-i', clip, ...frameInput, ...stripInputs, '-filter_complex', graph, '-map', '[v]', '-frames:v', '1', file], { stdio: 'inherit' });
  console.log(file);
} else {
  const file = path.join(OUT, `${name}.mp4`);
  const cut = ['-ss', String(from), ...(to === null ? [] : ['-t', String(to - from)])];
  const musicInput = hasMusic ? ['-ss', String(musicEnd - videoLength), '-t', String(videoLength), '-i', opts.music] : [];
  const loud = 'loudnorm=I=-14:TP=-1.0:LRA=11';
  const fade = 0.3;
  // The game's sound stops where the frame is held; the song plays on to the very end.
  const gameSound = `[0:a:0]atrim=duration=${clipLength},apad=whole_dur=${videoLength}`;
  const musicLabel = `${strips.length + 2}:a:0`;
  const song = `[${musicLabel}]volume=${musicGain},afade=t=out:st=${videoLength - fade}:d=${fade}`;
  const audioGraph = hasMusic
    ? audio
      ? `${gameSound}[g];${song}[m];[g][m]amix=inputs=2:duration=longest:normalize=0,${loud},atrim=duration=${videoLength}[a]`
      : `${song},${loud},atrim=duration=${videoLength}[a]`
    : audio
      ? `${gameSound},${loud},atrim=duration=${videoLength}[a]`
      : '';
  const filters = audioGraph ? `${graph};${audioGraph}` : graph;
  const sound = audioGraph ? ['-map', '[a]', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k'] : ['-an'];
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...cut, '-i', clip, ...frameInput, ...stripInputs, ...musicInput, '-filter_complex', filters, '-map', '[v]', ...sound, '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart', file], { stdio: 'inherit' });
  console.log(file);
}
