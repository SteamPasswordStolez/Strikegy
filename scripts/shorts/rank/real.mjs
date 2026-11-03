// Renders the motion graphics of the Short "현실에서 이병이 원수 되려면" (real.html) into
// the git-ignored assets-src/shorts/rank/. One browser, closed at the end.
//
//   node scripts/shorts/rank/real.mjs [--fps 30] [--stills 1,3.3,9]
//
// --stills writes one contact sheet of those moments instead of the video.
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
const stills = opt('stills', null);

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto(pathToFileURL(path.join(ROOT, 'scripts/shorts/rank/real.html')).href);
  await page.evaluate(() => document.fonts.load('900 100px Pretendard', '가0'));
  await page.evaluate(() => document.fonts.ready);
  if (stills) {
    const times = stills.split(',').map(Number);
    const files = [];
    for (const t of times) {
      await page.evaluate((x) => window.render(x), t);
      const file = path.join(OUT, `still-${t}.png`);
      await page.screenshot({ path: file });
      files.push(file);
    }
    // xstack needs a full grid: two rows when the count is even, else one.
    const rows = times.length % 2 === 0 ? 2 : 1;
    const cols = times.length / rows;
    const sheet = path.join(OUT, 'stills.png');
    execFileSync('ffmpeg', ['-y', '-v', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `${files.map((_, i) => `[${i}]scale=300:-1[s${i}]`).join(';')};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${files.length}:grid=${cols}x${rows}`, '-frames:v', '1', sheet]);
    console.log(sheet);
  } else {
    const length = await page.evaluate(() => window.LENGTH);
    const frames = Math.round(length * fps);
    // What the sound needs to know: where each step lands and where the song goes quiet.
    const sound = await page.evaluate(() => ({ pops: window.POPS, hush: window.HUSH }));
    fs.writeFileSync(path.join(OUT, 'real-sound.json'), JSON.stringify(sound));
    const file = path.join(OUT, 'real.mp4');
    const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'inherit', 'inherit'] });
    const closed = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
    const started = Date.now();
    for (let n = 0; n < frames; n++) {
      await page.evaluate((x) => window.render(x), n / fps);
      const shot = await page.screenshot({ type: 'jpeg', quality: 97 });
      if (!ff.stdin.write(shot)) await new Promise((res) => ff.stdin.once('drain', res));
      if (n % 150 === 0) console.log(`${n} / ${frames} frames, ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
    ff.stdin.end();
    await closed;
    console.log(`${file}: ${frames} frames, ${length.toFixed(2)} s, took ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
} finally {
  await browser.close();
}
