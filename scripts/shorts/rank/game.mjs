// Puts the Short "현실에서 이병이 원수 되려면" together: real.mp4 (real.mjs), the game part
// (game.html over the clips in SHOTS), the song on its beat and a pop on each card.
// Work files go to the git-ignored assets-src/shorts/rank/. One browser, closed at the end.
//
//   node scripts/shorts/rank/game.mjs --song <mp3> [--fps 30]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = path.join(ROOT, 'assets-src', 'shorts', 'rank');
const opt = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const fps = Number(opt('fps', 30));
const song = opt('song', null);
if (!song || !fs.existsSync(song)) throw new Error('--song <mp3> is needed');

const MEDAL = 'C:/Medal/Edits';
/** One clip a card of game.html: where it starts, and pixels to cut for a window's title bar. */
const SHOTS = [
  { file: `${MEDAL}/MedalTVStrikegySTRIKEGYFPS20261102215358853-trim-1793624083738.mp4`, at: 11.2, crop: [36, 4] },
  { file: `${MEDAL}/MedalTVStrikegySTRIKEGYFPS20261101235105447-trim-1793544739479.mp4`, at: 8.3, crop: [0, 0] },
  { file: `${MEDAL}/MedalTVmsedge20261101215515422-trim-1793537753092.mp4`, at: 5.0, crop: [0, 0] },
  { file: `${MEDAL}/MedalTVmsedge20261101233916406-trim-1793544008597.mp4`, at: 18.8, crop: [36, 4] },
  { file: `${MEDAL}/MedalTVStrikegySTRIKEGYFPS20261101235105447-trim-1793544739479.mp4`, at: 14.4, crop: [0, 0] },
  { file: `${MEDAL}/MedalTVStrikegySTRIKEGYFPS20261102215358853-trim-1793624083738.mp4`, at: 15.6, crop: [36, 4] },
  { file: path.join(ROOT, 'assets-src/trailer/footage/S56.mp4'), at: 0.5, crop: [0, 0] },
];
/** Where the song starts under real.mp4's first frame (s), and how loud it is in each part. */
const SONG_START = 0;
const GAIN_REAL = 0.9;
const GAIN_GAME = 0.38;
const GAME_GAIN = 1.0;
const POP = path.join(ROOT, 'public/assets/sounds/ui_select.wav');
const POP_GAIN = 0.55;

/** The game's picture in the card (16:9, under the title, above the caption). */
const GAME_Y = 500;
const GAME_H = 608;

const realFile = path.join(OUT, 'real.mp4');
const probeLength = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }));
const hasAudio = (file) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim() !== '';
const realLength = probeLength(realFile);

const browser = await chromium.launch();
let cuts;
let length;
const overlay = path.join(OUT, 'game-over.mov');
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto(pathToFileURL(path.join(ROOT, 'scripts/shorts/rank/game.html')).href);
  await page.evaluate((s) => window.setEmblem(s), fs.readFileSync(path.join(ROOT, 'public/brand/glitchedspell-emblem.svg'), 'utf8'));
  await page.evaluate(() =>
    Promise.all([document.fonts.load('900 100px Pretendard', '가0'), document.fonts.load('700 100px Barlow', 'STRIKEGY')]),
  );
  length = await page.evaluate(() => window.LENGTH);
  cuts = await page.evaluate(() => window.CUTS);
  const frames = Math.round(length * fps);
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', '-', '-c:v', 'qtrle', '-pix_fmt', 'argb', overlay], { stdio: ['pipe', 'inherit', 'inherit'] });
  const closed = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
  for (let n = 0; n < frames; n++) {
    await page.evaluate((x) => window.render(x), n / fps);
    const shot = await page.screenshot({ type: 'png', omitBackground: true });
    if (!ff.stdin.write(shot)) await new Promise((res) => ff.stdin.once('drain', res));
    if (n % 120 === 0) console.log(`overlay ${n} / ${frames}`);
  }
  ff.stdin.end();
  await closed;
} finally {
  await browser.close();
}

// The clips one after the other, each exactly as long as its card; black under the reveal.
const gameCuts = cuts.filter((c) => !c.end);
const inputs = [];
const filters = [];
gameCuts.forEach((c, i) => {
  const s = SHOTS[i];
  const d = c.to - c.from;
  inputs.push('-ss', String(s.at), '-t', String(d), '-i', s.file);
  const [top, bottom] = s.crop;
  filters.push(
    `[${i}:v]crop=iw:ih-${top + bottom}:0:${top},scale=1080:${GAME_H}:force_original_aspect_ratio=increase,crop=1080:${GAME_H},setsar=1,fps=${fps},format=yuv420p[v${i}]`,
  );
  if (hasAudio(s.file)) filters.push(`[${i}:a:0]aresample=48000,atrim=duration=${d},apad=whole_dur=${d},aformat=channel_layouts=stereo[a${i}]`);
  else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d}[a${i}]`);
});
const endLength = length - gameCuts.at(-1).to;
const concat = gameCuts.map((_, i) => `[v${i}][a${i}]`).join('');
filters.push(`${concat}concat=n=${gameCuts.length}:v=1:a=1[band][gamea]`);
filters.push(`[band]tpad=stop_mode=add:stop_duration=${endLength}:color=black,pad=1080:1920:0:${GAME_Y}:color=black[under]`);
const overIndex = gameCuts.length;
filters.push(`[${overIndex}:v]format=argb[over]`);
filters.push(`[under][over]overlay=0:0:eof_action=pass,format=yuv420p[gamev]`);
inputs.push('-i', overlay);
const gamePart = path.join(OUT, 'game.mp4');
const gameSound = path.join(OUT, 'game-sound.wav');
execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[gamev]', '-t', String(length), '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-an', gamePart, '-map', '[gamea]', '-c:a', 'pcm_s16le', gameSound], { stdio: 'inherit' });

// The two parts, the song from its beat, the game's sound under the second part, a pop per card.
const total = realLength + length;
const final = path.join(OUT, 'rank.mp4');
// A pop on each step of real.html (it says where they land and where the song goes quiet), then on each cut.
const realSound = JSON.parse(fs.readFileSync(path.join(OUT, 'real-sound.json'), 'utf8'));
const pops = [...realSound.pops, ...cuts.map((c) => realLength + c.from)];
const [hushFrom, hushTo] = realSound.hush;
const audio = [
  `[0:v][1:v]concat=n=2:v=1:a=0,fps=${fps},format=yuv420p[v]`,
  `[2:a]aresample=48000,aformat=channel_layouts=stereo,volume='if(between(t,${hushFrom},${hushTo}),0,if(lt(t,${realLength}),${GAIN_REAL},${GAIN_GAME}))':eval=frame,afade=t=out:st=${total - 0.3}:d=0.3[song]`,
  `[3:a]aresample=48000,aformat=channel_layouts=stereo,volume=${GAME_GAIN},adelay=${Math.round(realLength * 1000)}:all=1[game]`,
  `[4:a]asplit=${pops.length}${pops.map((_, i) => `[ps${i}]`).join('')}`,
  ...pops.map((t, i) => `[ps${i}]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(t * 1000)}:all=1,volume=${POP_GAIN}[p${i}]`),
  `[song][game]${pops.map((_, i) => `[p${i}]`).join('')}amix=inputs=${pops.length + 2}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.0:LRA=11,atrim=duration=${total}[a]`,
].join(';');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', realFile, '-i', gamePart, '-ss', String(SONG_START), '-t', String(total), '-i', song, '-i', gameSound, '-i', POP, '-filter_complex', audio, '-map', '[v]', '-map', '[a]', '-ar', '48000', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', final], { stdio: 'inherit' });
console.log(`${final}: ${total.toFixed(2)} s`);
