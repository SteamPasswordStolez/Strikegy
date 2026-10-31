// Renders the launch trailer's graphics (docs/design/trailer-production.md) into
// assets-src/trailer/gfx/: the GlitchedSpell opening, the cards, the title, the end
// slate (opaque video, exact frame counts from data/shots.json), the 일병 진급
// overlay (transparent PNG frames) and one transparent PNG a Korean subtitle line.
// Every frame is drawn by scripts/trailer/gfx.html in the playwright Chromium.
//
//   node scripts/trailer/render.mjs [--only opening,cards,title,endslate,promo,subs] [--placeholders]
//
// --placeholders also draws a labelled stand-in picture for every footage shot
// (build.mjs uses it where a shot has no footage yet).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'assets-src', 'trailer', 'gfx');
const FPS = 30;
const shots = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/trailer/data/shots.json'), 'utf8'),
);
const lines = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/trailer/data/lines.json'), 'utf8'),
);
const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const want = (k) => !only || only.has(k);

/** Frames between two times on the 30 fps grid (cuts land on frame boundaries). */
export const frames = (a, b) => Math.round(b * FPS) - Math.round(a * FPS);

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(path.join(ROOT, 'scripts/trailer/gfx.html')).href);
const svg = (n) => fs.readFileSync(path.join(ROOT, `public/brand/glitchedspell-${n}.svg`), 'utf8');
await page.evaluate((m) => window.setSvgs(m), {
  emblem: svg('emblem'),
  wordmark: svg('wordmark'),
  logo: svg('logo'),
});
await page.evaluate(() => document.fonts.ready);

/**
 * Empties and removes a flat folder of frames. Not fs.rmSync: on Windows it crashes Node
 * natively under this repo's Korean path (STATUS_STACK_BUFFER_OVERRUN; build-voice.mjs too).
 */
function rmFrames(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
  fs.rmdirSync(dir);
}

/** Draws `n` frames of `kind` into dir/0000.png...; transparent when `alpha`. */
async function frameSeq(dir, kind, params, n, alpha) {
  rmFrames(dir);
  fs.mkdirSync(dir, { recursive: true });
  for (let f = 0; f < n; f++) {
    await page.evaluate(([k, p, i, total]) => window.draw(k, p, i, total), [kind, params, f, n]);
    await page.screenshot({
      path: path.join(dir, `${String(f).padStart(4, '0')}.png`),
      omitBackground: alpha,
    });
  }
}

/** Opaque frames -> an H.264 clip (the same settings as build.mjs's segments). */
function encode(dir, file) {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-framerate',
    String(FPS),
    '-i',
    path.join(dir, '%04d.png'),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '16',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(FPS),
    file,
  ]);
  rmFrames(dir);
}

async function clip(name, kind, params, n) {
  const dir = path.join(OUT, `_${name}`);
  await frameSeq(dir, kind, params, n, false);
  encode(dir, path.join(OUT, `${name}.mp4`));
  console.log(`${name}.mp4  ${n} frames`);
}

const opening = shots.filter((s) => s.type === 'opening');
if (want('opening'))
  await clip('opening', 'opening', {}, frames(opening[0].start, opening.at(-1).end));

for (const s of shots.filter((x) => x.type === 'card')) {
  const n = frames(s.start, s.end);
  if (s.desc.startsWith('STRIKEGY · ')) {
    if (want('endslate')) await clip(`card_${s.id}`, 'endslate', {}, n);
  } else if (s.desc.startsWith('STRIKEGY')) {
    if (want('title')) await clip(`card_${s.id}`, 'title', {}, n);
  } else if (want('cards')) {
    // The four arms are numbered 01-04; a tagline splits into two lines ("A. B." or "small — big").
    const text = s.desc.split(' (')[0];
    const arm = ['보병', '기갑', '항공', '해군'].indexOf(text) + 1;
    const dash = text.split(' — ');
    const dots = text.split('. ');
    const params = arm
      ? { text, index: arm }
      : dash.length === 2
        ? { lines: dash, lead: true }
        : dots.length === 2
          ? { lines: [dots[0] + '.', dots[1]] }
          : { text, index: 0 };
    await clip(`card_${s.id}`, 'card', params, n);
  }
}

// 일병 진급 over S53, 114.8-115.5 s (docs/design/trailer.md, cards table).
if (want('promo')) {
  await frameSeq(path.join(OUT, 'promo'), 'promo', {}, frames(114.8, 115.5), true);
  console.log('promo/  ' + frames(114.8, 115.5) + ' frames');
}

if (want('subs')) {
  const dir = path.join(OUT, 'subs');
  fs.mkdirSync(dir, { recursive: true });
  for (const l of lines) {
    await page.evaluate(([t]) => window.draw('sub', { text: t }, 0, 1), [l.ko]);
    await page.screenshot({ path: path.join(dir, `${l.id}.png`), omitBackground: true });
  }
  console.log(`subs/  ${lines.length} lines`);
}

if (args.includes('--placeholders')) {
  const dir = path.join(OUT, 'placeholders');
  fs.mkdirSync(dir, { recursive: true });
  const bg = { fp: '#22402a', aboard: '#2a3550', staged: '#4a3a20', cine: '#4a2430' };
  for (const s of shots.filter((x) => bg[x.type])) {
    await page.evaluate(
      ([p]) => window.draw('placeholder', p, 0, 1),
      [{ id: s.id, type: s.kind, desc: s.desc, bg: bg[s.type] }],
    );
    await page.screenshot({ path: path.join(dir, `${s.id}.png`) });
  }
  console.log('placeholders/');
}

await browser.close();
