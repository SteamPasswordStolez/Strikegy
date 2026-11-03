// Puts the winter-war Short together: winter.html's overlay over the game clips (scenes.js says what plays when),
// cold-graded, every cut on its frame so that it lands on the song's hit. Work files and the result go to the git-ignored assets-src/shorts/winter/.
// The clips come from `node scripts/trailer/film.mjs winter-war`. One browser, closed at the end.
//
//   node scripts/shorts/winter/build.mjs --song <mp3> [--fps 30] [--stills 0.5,7,17.5] [--out winter]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import './scenes.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = path.join(ROOT, 'assets-src', 'shorts', 'winter');
const opt = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const fps = Number(opt('fps', 30));
const song = opt('song', null);
const stills = opt('stills', null);
const name = opt('out', 'winter');
const { SCENES, LENGTH, SONG_START, BEAT, STRONG } = globalThis.WINTER;

/** The game's picture between the captions. */
const BAND_Y = 884;
const BAND_W = 1080;
const BAND_H = 608;

const loadPage = async (browser) => {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(pathToFileURL(path.join(ROOT, 'scripts/shorts/winter/winter.html')).href);
  await page.evaluate(
    ([c, b]) => window.setData(c, b),
    [JSON.parse(fs.readFileSync(path.join(OUT, 'countries.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(OUT, 'borders.json'), 'utf8'))],
  );
  await page.evaluate(() => window.loadPhotos());
  await page.evaluate(() => Promise.all([document.fonts.load('900 100px Pretendard', '가0'), document.fonts.load('700 100px Barlow', 'STRIKEGY')]));
  return page;
};

const browser = await chromium.launch();
const overlay = path.join(OUT, 'over.mov');
try {
  const page = await loadPage(browser);
  if (stills) {
    const times = stills.split(',').map(Number);
    const files = [];
    for (const t of times) {
      await page.evaluate((x) => window.render(x), t);
      const file = path.join(OUT, `still-${t}.png`);
      await page.screenshot({ path: file });
      files.push(file);
    }
    const rows = times.length > 4 ? 2 : 1;
    const cols = Math.ceil(times.length / rows);
    const sheet = path.join(OUT, 'stills.png');
    const inputs = files.flatMap((f) => ['-i', f]);
    while (files.length < rows * cols) {
      inputs.push('-i', files[files.length - 1]);
      files.push(files[files.length - 1]);
    }
    execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', `${files.map((_, i) => `[${i}]scale=360:-1[s${i}]`).join(';')};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${files.length}:grid=${cols}x${rows}`, '-frames:v', '1', sheet]);
    console.log(sheet);
    process.exitCode = 0;
  } else {
    const frames = Math.round(LENGTH * fps);
    const started = Date.now();
    const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', '-', '-c:v', 'qtrle', '-pix_fmt', 'argb', overlay], { stdio: ['pipe', 'inherit', 'inherit'] });
    const closed = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
    for (let n = 0; n < frames; n++) {
      await page.evaluate((x) => window.render(x), n / fps);
      const shot = await page.screenshot({ type: 'png', omitBackground: true });
      if (!ff.stdin.write(shot)) await new Promise((res) => ff.stdin.once('drain', res));
      if (n % 120 === 0) console.log(`overlay ${n} / ${frames}, ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
    ff.stdin.end();
    await closed;
  }
} finally {
  await browser.close();
}
if (stills) process.exit(0);
if (!song || !fs.existsSync(song)) throw new Error('--song <mp3> is needed');

// The band: each scene's clip, exactly its frames long (rounding each length on its own let the cuts drift up to
// 0.1 s behind the song), black under what the overlay covers.
const clipLength = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }));
const frameOf = (t) => Math.round(t * fps);
const inputs = [];
const filters = [];
SCENES.forEach((s, i) => {
  const n = frameOf(s.to) - frameOf(s.from);
  const d = n / fps;
  if (s.clip) {
    const file = path.join(OUT, 'footage', `${s.clip}.mp4`);
    const left = clipLength(file) - s.at;
    if (left + 0.001 < d) throw new Error(`scene ${i} (${s.clip}): wants ${d.toFixed(2)} s from ${s.at}, the clip has ${left.toFixed(2)} s`);
    inputs.push('-ss', String(s.at), '-t', String(d + 0.1), '-i', file);
    filters.push(`[${i}:v]fps=${fps},scale=${BAND_W}:${BAND_H},setsar=1,trim=end_frame=${n},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
  } else {
    inputs.push('-f', 'lavfi', '-t', String(d + 0.1), '-i', `color=c=black:s=${BAND_W}x${BAND_H}:r=${fps}`);
    filters.push(`[${i}:v]setsar=1,trim=end_frame=${n},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
  }
});
// Every big hit punches the picture in and shakes it, on the cuts and between them.
const ringExpr = STRONG.map((h) => `if(gte(t,${h}),exp(-9*(t-${h})),0)`).join('+');
const zoom = `(1+0.07*(${ringExpr}))`;
const shake = `(13*(${ringExpr})*sin(t*70))`;
const PUNCH = `scale=w='2*trunc(${BAND_W}*${zoom}/2)':h='2*trunc(${BAND_H}*${zoom}/2)':eval=frame,crop=${BAND_W}:${BAND_H}:x='(iw-ow)/2+${shake}':y='(ih-oh)/2+${shake}*0.6'`;
const overIndex = SCENES.length;
inputs.push('-i', overlay);
const concat = SCENES.map((_, i) => `[v${i}]`).join('');
// Cold and worn: the colour mostly gone, the snow pulled down from white, grain and dark corners.
const GRADE = "eq=saturation=0.42:contrast=1.16:brightness=-0.05:gamma=0.84,colorbalance=rs=-0.05:bs=0.07:rm=-0.03:bm=0.04,vignette=PI/4.2,noise=alls=6:allf=t";
filters.push(`${concat}concat=n=${SCENES.length}:v=1:a=0,${PUNCH},${GRADE},format=yuv420p[band]`);
filters.push(`[band]pad=1080:1920:0:${BAND_Y}:color=0x0b0d0e[under]`);
filters.push(`[${overIndex}:v]format=argb[over]`);
filters.push(`[under][over]overlay=0:0:eof_action=pass,format=yuv420p[v]`);

// Sound: the song from its first hit, the game's own sounds under the cuts that show them.
const SOUNDS = path.join(ROOT, 'public/assets/sounds');
const cutOf = (clip, n = 0) => SCENES.filter((s) => s.clip === clip)[n].from;
const effects = [
  // The tank goes up 0.8 s into W07.
  ['explosion_big.wav', cutOf('W07') + (0.8 - SCENES.find((s) => s.clip === 'W07').at), 0.55],
  ['explosion.wav', cutOf('W10', 0) + 0.05, 0.4],
  ['explosion.wav', cutOf('W10', 1) + 0.05, 0.4],
  ['explosion_big.wav', SCENES.find((s) => s.ceded).ceded, 0.45],
  ...[0.05, 0.2, 0.35, 0.55, 0.7].map((o) => ['gun_ar.wav', cutOf('W06') + o, 0.3]),
  ...[0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8].map((o) => ['gun_ar.wav', cutOf('W08') + o, 0.26]),
];
const audioInputs = ['-ss', String(SONG_START), '-t', String(LENGTH), '-i', song];
effects.forEach(([f]) => audioInputs.push('-i', path.join(SOUNDS, f)));
const first = overIndex + 1;
const audio = [
  `[${first}:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=out:st=${LENGTH - 0.45}:d=0.45[song]`,
  ...effects.map(([, t, gain], i) => `[${first + 1 + i}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${gain},adelay=${Math.round(t * 1000)}:all=1[e${i}]`),
  `[song]${effects.map((_, i) => `[e${i}]`).join('')}amix=inputs=${effects.length + 1}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.0:LRA=11,atrim=duration=${LENGTH}[a]`,
];
const final = path.join(OUT, `${name}.mp4`);
execFileSync(
  'ffmpeg',
  ['-y', '-v', 'error', ...inputs, ...audioInputs, '-filter_complex', [...filters, ...audio].join(';'), '-map', '[v]', '-map', '[a]', '-t', String(LENGTH), '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', final],
  { stdio: 'inherit' },
);
console.log(`${final}: ${LENGTH.toFixed(2)} s, beat ${BEAT.toFixed(4)} s`);
