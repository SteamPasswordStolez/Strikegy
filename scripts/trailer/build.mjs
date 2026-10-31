// Assembles the launch trailer (docs/design/trailer-production.md §6) from
//   scripts/trailer/data/shots.json   when every shot starts / ends (the music's hits; never edit times here by hand
//                                     without docs/design/trailer.md)
//   scripts/trailer/data/lines.json   the English lines and their Korean subtitles
//   assets-src/trailer/edit.json      which footage file and in-point each shot uses (made by the filming step)
//   assets-src/trailer/gfx/           render.mjs's opening, cards, title, end slate, promo overlay, subtitle images
//   assets-src/trailer/voice/Lnn.wav  voices.mjs's lines
//   the music: assets-src/sounds/Engaging.mp3 (the original) or public/music/engaging.mp3
// into assets-src/trailer/out/: trailer.mp4 (Korean subtitles burned in), trailer_nosubs.mp4,
// subtitles.ko.srt (for the video site's own captions).
//
//   node scripts/trailer/build.mjs [--check] [--draft]
//
// --check lists every shot with its footage (or what is missing) and stops.
// --draft renders fast (lower quality) for a timing check.
// A shot without footage plays its placeholder (render.mjs --placeholders), a line without a
// voice file is left out: the trailer always builds, so timing can be checked at any stage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = path.join(ROOT, 'assets-src', 'trailer');
const GFX = path.join(T, 'gfx');
const OUT = path.join(T, 'out');
const FPS = 30;
const LENGTH = 137.0;
const shots = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/trailer/data/shots.json'), 'utf8'),
);
const lines = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/trailer/data/lines.json'), 'utf8'),
);
const editFile = path.join(T, 'edit.json');
const edit = fs.existsSync(editFile) ? JSON.parse(fs.readFileSync(editFile, 'utf8')) : {};
const args = process.argv.slice(2);
const draft = args.includes('--draft');
/**
 * The trailer's grade on every filmed cut (not the graphics): a little more contrast, less saturation, warm
 * highlights over cool shadows, a vignette (owner, 2026-10-31: the raw game frames read crude). --nograde: off.
 */
const GRADE = args.includes('--nograde')
  ? ''
  : 'eq=contrast=1.12:saturation=0.88:gamma=0.96,colorbalance=rs=-0.04:gs=-0.01:bs=0.05:rh=0.06:gh=0.02:bh=-0.05,vignette=angle=PI/4.5,';
/** The promo overlay's time (docs/design/trailer.md, cards table). */
const PROMO = [114.8, 115.5];

const frameAt = (t) => Math.round(t * FPS);
const run = (a) =>
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: ['ignore', 'ignore', 'inherit'] });
const probe = (f) =>
  Number(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      f,
    ])
      .toString()
      .trim(),
  );
const VENC = [
  '-c:v',
  'libx264',
  '-preset',
  draft ? 'ultrafast' : 'medium',
  '-crf',
  draft ? '28' : '16',
  '-pix_fmt',
  'yuv420p',
  // One colour range tag on every piece (see `fit`).
  '-color_range',
  'tv',
  '-r',
  String(FPS),
];
const AENC = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];

/** The timeline in segments: the opening as one, then every shot; each a whole number of frames. */
function segments() {
  const open = shots.filter((s) => s.type === 'opening');
  const segs = [
    {
      id: 'OPEN',
      type: 'opening',
      start: open[0].start,
      end: open.at(-1).end,
      desc: 'GlitchedSpell',
    },
  ];
  for (const s of shots) if (s.type !== 'opening') segs.push(s);
  for (const s of segs) s.frames = frameAt(s.end) - frameAt(s.start);
  return segs;
}

/** What a segment is made from: footage (edit.json), a rendered graphic, black, or its placeholder. */
function sourceOf(s) {
  if (s.type === 'opening') return { kind: 'gfx', file: path.join(GFX, 'opening.mp4') };
  if (s.type === 'card') return { kind: 'gfx', file: path.join(GFX, `card_${s.id}.mp4`) };
  if (s.type === 'black') return { kind: 'black' };
  const e = edit[s.id];
  if (e?.file && fs.existsSync(path.join(T, e.file)))
    return {
      kind: 'footage',
      file: path.join(T, e.file),
      in: e.in ?? 0,
      gain: e.gain ?? -6,
      speed: e.speed ?? 1,
    };
  return {
    kind: 'placeholder',
    file: path.join(GFX, 'placeholders', `${s.id}.png`),
    missing: e?.file ?? '(no entry in edit.json)',
  };
}

function check(segs) {
  const rows = segs.map((s) => {
    const src = sourceOf(s);
    const need = src.kind === 'footage' ? s.frames / FPS / src.speed : s.frames / FPS;
    let note = '';
    if (src.kind === 'footage') {
      const have = probe(src.file) - src.in;
      if (have < need - 0.01)
        note = `TOO SHORT: needs ${need.toFixed(2)} s from ${src.in}, has ${have.toFixed(2)}`;
    }
    if (src.kind === 'gfx' && !fs.existsSync(src.file)) note = 'run render.mjs';
    if (src.kind === 'placeholder') note = `no footage: ${src.missing}`;
    return {
      id: s.id,
      type: s.type,
      start: s.start.toFixed(2),
      frames: s.frames,
      source: src.kind,
      note,
    };
  });
  console.table(rows);
  const v = lines
    .filter((l) => !fs.existsSync(path.join(T, 'voice', `${l.id}.wav`)))
    .map((l) => l.id);
  console.log(
    v.length ? `lines without a voice file: ${v.join(' ')}` : 'every line has a voice file',
  );
}

/** One segment as video + its footage sound (or silence), exactly `frames` long. */
function renderSegment(s, file) {
  const src = sourceOf(s);
  const dur = (s.frames / FPS).toFixed(4);
  // Every segment limited-range yuv420p: footage from JPEG frames comes as full-range yuvj420p, and a
  // format change mid-stream rebuilds the final pass's filters (their clocks restart: ~150 frames lost).
  const fit = 'scale=1920:1080:force_original_aspect_ratio=increase:out_range=tv,crop=1920:1080,setsar=1,fps=30,format=yuv420p';
  const silence = ['-f', 'lavfi', '-t', dur, '-i', 'anullsrc=r=48000:cl=stereo'];
  if (src.kind === 'black') {
    run([
      '-f',
      'lavfi',
      '-t',
      dur,
      '-i',
      `color=c=black:s=1920x1080:r=${FPS}`,
      ...silence,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-frames:v',
      String(s.frames),
      ...VENC,
      ...AENC,
      '-t',
      dur,
      file,
    ]);
  } else if (src.kind === 'gfx' || src.kind === 'placeholder') {
    const input = src.kind === 'gfx' ? ['-i', src.file] : ['-loop', '1', '-t', dur, '-i', src.file];
    run([
      ...input,
      ...silence,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-vf',
      fit,
      '-frames:v',
      String(s.frames),
      ...VENC,
      ...AENC,
      '-t',
      dur,
      file,
    ]);
  } else {
    // Footage: from its in-point, slowed down when speed < 1 (slow-motion shots), its own sound at `gain` dB.
    const sp = src.speed;
    const vf = `${sp !== 1 ? `setpts=PTS/${sp},` : ''}${GRADE}${fit}`;
    const af = `${sp !== 1 ? `atempo=${Math.max(0.5, sp)},` : ''}volume=${src.gain}dB,aresample=48000,apad`;
    const hasAudio =
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=index',
        '-of',
        'csv=p=0',
        src.file,
      ])
        .toString()
        .trim() !== '';
    if (hasAudio)
      run([
        '-ss',
        String(src.in),
        '-i',
        src.file,
        '-map',
        '0:v',
        '-map',
        '0:a',
        '-vf',
        vf,
        '-af',
        af,
        '-frames:v',
        String(s.frames),
        ...VENC,
        ...AENC,
        '-t',
        dur,
        file,
      ]);
    else
      run([
        '-ss',
        String(src.in),
        '-i',
        src.file,
        ...silence,
        '-map',
        '0:v',
        '-map',
        '1:a',
        '-vf',
        vf,
        '-frames:v',
        String(s.frames),
        ...VENC,
        ...AENC,
        '-t',
        dur,
        file,
      ]);
  }
}

/** When each subtitle shows: the line's time + 0.2 s (at least 0.8 s), cut off where the next one starts. */
function subTimes() {
  return lines.map((l, i) => {
    const next = lines[i + 1]?.start ?? LENGTH;
    return { line: l, a: l.start, b: Math.min(Math.max(l.end, l.start + 0.8) + 0.2, next) };
  });
}

/** The subtitles as one transparent video (png in mov): one overlay instead of sixty. */
function subsTrack() {
  const dir = path.join(OUT, 'subs');
  fs.mkdirSync(dir, { recursive: true });
  const blank = path.join(dir, 'blank.png');
  run(['-f', 'lavfi', '-i', 'color=c=black@0.0:s=1920x1080,format=rgba', '-frames:v', '1', blank]);
  const list = ['ffconcat version 1.0'];
  let t = 0;
  for (const { line, a, b } of subTimes()) {
    const png = path.join(GFX, 'subs', `${line.id}.png`);
    if (!fs.existsSync(png)) continue;
    if (a > t) list.push(`file '${blank}'`, `duration ${(a - t).toFixed(3)}`);
    list.push(`file '${png}'`, `duration ${(b - a).toFixed(3)}`);
    t = b;
  }
  list.push(`file '${blank}'`, `duration ${(LENGTH - t).toFixed(3)}`, `file '${blank}'`);
  fs.writeFileSync(path.join(dir, 'list.txt'), list.join('\n') + '\n');
  const track = path.join(OUT, 'subs.mov');
  run([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    path.join(dir, 'list.txt'),
    '-vf',
    `fps=${FPS},format=rgba`,
    '-c:v',
    'png',
    '-t',
    String(LENGTH),
    track,
  ]);
  return track;
}

function srt() {
  const ts = (t) => {
    const ms = Math.round(t * 1000);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return subTimes()
    .map(({ line, a, b }, i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${line.ko}\n`)
    .join('\n');
}

function main() {
  const segs = segments();
  if (args.includes('--check')) return check(segs);
  fs.mkdirSync(path.join(OUT, 'seg'), { recursive: true });

  // 1. The picture with the game's own sound, cut on the frames of the hits.
  const list = [];
  for (const s of segs) {
    const file = path.join(OUT, 'seg', `${s.id}.mp4`);
    // A segment whose inputs haven't changed (source, in-point, gain, speed, frames, file times) is kept.
    const src = sourceOf(s);
    const key = JSON.stringify({
      // Bumped when renderSegment's output changes (3: every segment limited-range yuv420p, tagged tv).
      v: 3,
      grade: GRADE,
      src,
      frames: s.frames,
      draft,
      mtime: src.file && fs.existsSync(src.file) ? fs.statSync(src.file).mtimeMs : 0,
    });
    const keyFile = `${file}.key`;
    if (!(
      fs.existsSync(file) &&
      fs.existsSync(keyFile) &&
      fs.readFileSync(keyFile, 'utf8') === key
    )) {
      renderSegment(s, file);
      fs.writeFileSync(keyFile, key);
    }
    list.push(`file '${file}'`);
  }
  fs.writeFileSync(path.join(OUT, 'seg', 'list.txt'), list.join('\n') + '\n');
  const picture = path.join(OUT, 'picture.mp4');
  run([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    path.join(OUT, 'seg', 'list.txt'),
    '-c',
    'copy',
    picture,
  ]);
  fs.writeFileSync(path.join(OUT, 'subtitles.ko.srt'), srt());

  // 2. Music + voices + game sound, the music ducked under the voices; overlays; loudness for video sites (-14 LUFS).
  const music = [
    path.join(ROOT, 'assets-src/sounds/Engaging.mp3'),
    path.join(ROOT, 'public/music/engaging.mp3'),
  ].find((f) => fs.existsSync(f));
  const voiced = lines.filter((l) => fs.existsSync(path.join(T, 'voice', `${l.id}.wav`)));
  const subsMov = subsTrack();
  for (const subs of [true, false]) {
    // -reinit_filter 0: a frame property changing between cuts must not rebuild (and restart the clocks of) the graph.
    const inputs = ['-reinit_filter', '0', '-i', picture, '-i', music];
    for (const l of voiced) inputs.push('-i', path.join(T, 'voice', `${l.id}.wav`));
    let n = 2 + voiced.length;
    const g = [];
    // Voices on the timeline.
    voiced.forEach((l, i) =>
      g.push(
        `[${2 + i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(l.start * 1000)}:all=1[v${i}]`,
      ),
    );
    if (voiced.length) {
      g.push(
        `${voiced.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voiced.length}:normalize=0:duration=longest,apad=whole_dur=${LENGTH}[vo]`,
      );
      g.push('[vo]asplit=2[vomix][vokey]');
      g.push(`[1:a]aresample=48000,atrim=0:${LENGTH}[mus]`);
      g.push(
        '[mus][vokey]sidechaincompress=threshold=0.03:ratio=4:attack=20:release=350:makeup=1[duck]',
      );
    } else g.push(`[1:a]aresample=48000,atrim=0:${LENGTH}[duck]`);
    g.push('[0:a]volume=1[fx]');
    g.push(
      `[duck][fx]${voiced.length ? '[vomix]' : ''}amix=inputs=${voiced.length ? 3 : 2}:normalize=0:duration=first,loudnorm=I=-14:TP=-1:LRA=11[aout]`,
    );
    // Picture: the 일병 진급 overlay, then the subtitles. The concatenated picture starts at
    // ~0.021 s (the segments' AAC priming), which made -r 30 repeat the first frame and land
    // every cut one frame late; it is put back to 0 first.
    g.push('[0:v]setpts=PTS-STARTPTS[v0]');
    let v = '[v0]';
    const promoDir = path.join(GFX, 'promo');
    if (fs.existsSync(promoDir)) {
      inputs.push('-framerate', String(FPS), '-i', path.join(promoDir, '%04d.png'));
      g.push(`[${n}:v]setpts=PTS-STARTPTS+${PROMO[0]}/TB[promo]`);
      g.push(`${v}[promo]overlay=eof_action=pass[vp]`);
      v = '[vp]';
      n++;
    }
    if (subs) {
      inputs.push('-i', subsMov);
      g.push(`${v}[${n}:v]overlay=eof_action=pass[vs]`);
      v = '[vs]';
    }
    g.push(`${v}null[vout]`);
    const out = path.join(OUT, subs ? 'trailer.mp4' : 'trailer_nosubs.mp4');
    run([
      ...inputs,
      '-filter_complex',
      g.join(';'),
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      ...VENC,
      ...AENC,
      '-t',
      String(LENGTH),
      '-movflags',
      '+faststart',
      out,
    ]);
    console.log(`${path.relative(ROOT, out)}  ${probe(out).toFixed(2)} s`);
  }
  console.log(`${path.relative(ROOT, path.join(OUT, 'subtitles.ko.srt'))}`);
}

main();
