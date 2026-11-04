// Puts the Korean-military Short together: rok.html's overlay over the game clips, every cut on its frame, on the song.
// Work files and the result go to the git-ignored assets-src/shorts/rok/; the clips are the winter-war Short's
// (`node scripts/trailer/film.mjs winter-war`), the map data comes from data.mjs. One browser, closed at the end.
//
//   node scripts/shorts/rok/build.mjs --song <mp3> [--fps 60] [--out rok]
//   node scripts/shorts/rok/build.mjs --stills 0.6,7,16
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import './scenes.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = path.join(ROOT, 'assets-src/shorts/rok');
const FOOTAGE = path.join(ROOT, 'assets-src/shorts/winter/footage');
const opt = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const fps = Number(opt('fps', 60));
const song = opt('song', null);
const stills = opt('stills', null);
const name = opt('out', 'rok');
const { SCENES, END, STRONG } = globalThis.ROK;
/** The clips' picture, full width (rok.html has the same numbers). */
const BAND = { y: 120, w: 1080, h: 1380 };

const browser = await chromium.launch();
const overlay = path.join(OUT, 'over.mov');
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(pathToFileURL(path.join(ROOT, 'scripts/shorts/rok/rok.html')).href);
  await page.evaluate((c) => window.setData(c), JSON.parse(fs.readFileSync(path.join(OUT, 'countries.json'), 'utf8')));
  await page.evaluate(() => Promise.all([document.fonts.load('900 60px Pretendard', '가0'), document.fonts.load('700 60px Barlow', 'STRIKEGY')]));
  if (stills) {
    const times = stills.split(',').map(Number);
    const files = [];
    for (const t of times) {
      await page.evaluate((x) => window.render(x), t);
      const f = path.join(OUT, `still-${t}.png`);
      await page.screenshot({ path: f });
      files.push(f);
    }
    const rows = times.length > 8 ? 2 : 1;
    const cols = Math.ceil(times.length / rows);
    while (files.length < rows * cols) files.push(files[files.length - 1]);
    execFileSync('ffmpeg', ['-y', '-v', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `${files.map((_, i) => `[${i}]scale=270:-1[s${i}]`).join(';')};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${files.length}:grid=${cols}x${rows}`, '-frames:v', '1', path.join(OUT, 'stills.png')]);
    console.log('stills.png');
  } else {
    const frames = Math.round(END * fps);
    const started = Date.now();
    const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', '-', '-c:v', 'qtrle', '-pix_fmt', 'argb', overlay], { stdio: ['pipe', 'inherit', 'inherit'] });
    const closed = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
    for (let n = 0; n < frames; n++) {
      await page.evaluate((x) => window.render(x), n / fps);
      const shot = await page.screenshot({ type: 'png', omitBackground: true });
      if (!ff.stdin.write(shot)) await new Promise((res) => ff.stdin.once('drain', res));
      if (n % 300 === 0) console.log(`overlay ${n} / ${frames}, ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
    ff.stdin.end();
    await closed;
  }
} finally {
  await browser.close();
}
if (stills) process.exit(0);
if (!song || !fs.existsSync(song)) throw new Error('--song <mp3> is needed');

// The band: each scene's clip exactly its frames long, black under the map scenes.
const frameOf = (t) => Math.round(t * fps);
const length = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }));
const inputs = [];
const filters = [];
SCENES.forEach((s, i) => {
  const n = frameOf(s.to) - frameOf(s.from);
  const d = n / fps;
  if (s.clip) {
    const file = path.join(FOOTAGE, `${s.clip}.mp4`);
    const slow = s.slow ?? 1;
    if (length(file) - s.at + 0.001 < d / slow) throw new Error(`scene ${i} (${s.clip}): wants ${(d / slow).toFixed(2)} s from ${s.at}`);
    inputs.push('-ss', String(s.at), '-t', String(d / slow + 0.15), '-i', file);
    filters.push(`[${i}:v]setpts=${slow}*(PTS-STARTPTS),fps=${fps},scale=-2:${BAND.h},crop=${BAND.w}:${BAND.h},setsar=1,trim=end_frame=${n},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
  } else {
    inputs.push('-f', 'lavfi', '-t', String(d + 0.1), '-i', `color=c=black:s=${BAND.w}x${BAND.h}:r=${fps}`);
    filters.push(`[${i}:v]setsar=1,trim=end_frame=${n},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
  }
});
const overIndex = SCENES.length;
inputs.push('-i', overlay);
// Old film: nearly black and white, grain, dark corners; every big hit punches the picture in.
const ring = STRONG.map((h) => `if(gte(t,${h}),exp(-9*(t-${h})),0)`).join('+');
const zoom = `(1+0.06*(${ring}))`;
const PUNCH = `scale=w='2*trunc(${BAND.w}*${zoom}/2)':h='2*trunc(${BAND.h}*${zoom}/2)':eval=frame,crop=${BAND.w}:${BAND.h}`;
const GRADE = 'eq=saturation=0.08:contrast=1.2:brightness=-0.06:gamma=0.82,vignette=PI/4,noise=alls=7:allf=t';
filters.push(`${SCENES.map((_, i) => `[v${i}]`).join('')}concat=n=${SCENES.length}:v=1:a=0,${PUNCH},${GRADE},format=yuv420p[band]`);
filters.push(`[band]pad=1080:1920:0:${BAND.y}:color=black[under]`);
filters.push(`[${overIndex}:v]format=argb[over]`);
filters.push(`[under][over]overlay=0:0:eof_action=pass,format=yuv420p[v]`);

// Sound: the song as it is, a blast under what burns.
const SOUNDS = path.join(ROOT, 'public/assets/sounds');
const effects = [
  ['explosion.wav', 15.78, 0.35],
  ['explosion_big.wav', 23.18, 0.45],
  ['explosion.wav', 30.54, 0.35],
  ['explosion.wav', 32.44, 0.4],
  ['explosion.wav', 39.23, 0.35],
  ['explosion_big.wav', 44.08, 0.3],
  ['explosion_big.wav', 50.43, 0.4],
  ['explosion_big.wav', 52.41, 0.45],
];
const audioInputs = ['-t', String(END), '-i', song];
effects.forEach(([f]) => audioInputs.push('-i', path.join(SOUNDS, f)));
const first = overIndex + 1;
const audio = [
  `[${first}:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=out:st=${END - 0.4}:d=0.4[song]`,
  ...effects.map(([, t, gain], i) => `[${first + 1 + i}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${gain},adelay=${Math.round(t * 1000)}:all=1[e${i}]`),
  `[song]${effects.map((_, i) => `[e${i}]`).join('')}amix=inputs=${effects.length + 1}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.0:LRA=11,atrim=duration=${END}[a]`,
];
const final = path.join(OUT, `${name}.mp4`);
execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, ...audioInputs, '-filter_complex', [...filters, ...audio].join(';'), '-map', '[v]', '-map', '[a]', '-t', String(END), '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', final], { stdio: 'inherit' });
console.log(`${final}: ${END} s`);
