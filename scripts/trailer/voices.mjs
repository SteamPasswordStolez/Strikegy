// The launch trailer's English lines (scripts/trailer/data/lines.json) as voice files
// (docs/design/trailer-production.md §4). Run in a local session on the owner's PC:
// the OpenRouter key is in git-ignored assets-src/openrouter.key (`OPENROUTER_API_KEY=...`),
// the same route as the battle briefing's voices (scripts/voice-generate.mjs).
//
//   node scripts/trailer/voices.mjs                  every line not made yet
//   node scripts/trailer/voices.mjs --only L05,L19 --force [--voice Sarge=bill]
//   node scripts/trailer/voices.mjs --fx-only        redo the effects on the raw files only (no API)
//   add --fit to set each line's end in lines.json to the recording's length (subtitle timing)
//
// Each line: speech (elevenlabs/eleven-v4-turbo) -> assets-src/trailer/voice/raw/Lnn.mp3, checked by
// transcribing it back (Claude can't listen; a transcript far from the text is reported),
// then the delivery's effect (radio / slow-motion / near) -> assets-src/trailer/voice/Lnn.wav.
// The report says which lines run longer than their slot in the music (move or shorten them).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'assets-src', 'trailer', 'voice');
const API = 'https://openrouter.ai/api/v1';
// Turbo (owner, 2026-10-31). No delivery tags in the text: turbo models may read them out loud.
const MODEL = 'elevenlabs/eleven-v4-turbo';
const lines = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/trailer/data/lines.json'), 'utf8'),
);

/**
 * A voice per speaker from OpenRouter's ElevenLabs presets (george, sarah, adam, alice, bella,
 * bill, brian, callum, charlie, chris, daniel, eric, harry, jessica, laura, liam, lily, matilda,
 * river, roger, will). Picked from ElevenLabs' own descriptions; listen and swap with --voice.
 */
export const VOICES = {
  Sarge: 'adam', // firm, low
  Private: 'liam', // young, earnest
  'Squadmate 1': 'chris', // young American, casual
  'Squadmate 2': 'will', // young American
  Command: 'brian', // deep (the briefing's HQ voice)
  'Iron One': 'bill', // older, crisp
  'Hawk Two': 'eric', // smooth
  'Coral One': 'daniel', // British, commanding
  'Sub captain': 'george', // low, raspy
  Coxswain: 'roger',
  'Landing soldier': 'harry', // fierce
  'AA gunner': 'charlie', // energetic
};

/** The effect a delivery takes (the Korean delivery words in lines.json). */
export function effectOf(delivery) {
  if (delivery.startsWith('무전')) return 'radio';
  if (delivery.startsWith('슬로')) return 'slow';
  return 'near';
}

/** ffmpeg filter graphs: radio = the game's field radio (320 Hz-3.2 kHz, drive, hiss; src/audio/radio.ts). */
const FX = {
  radio:
    '[0:a]highpass=f=320,lowpass=f=3200,equalizer=f=1800:t=q:w=1:g=4,acompressor=threshold=-22dB:ratio=6:attack=4:release=80,volume=3[v];anoisesrc=c=pink:a=0.015:r=48000,highpass=f=320,lowpass=f=3200[n];[v][n]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89[o]',
  slow: '[0:a]lowpass=f=1100,aecho=0.8:0.6:70|140:0.35|0.2,volume=1.4,alimiter=limit=0.89[o]',
  near: '[0:a]highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=10:release=120,alimiter=limit=0.89[o]',
};

/**
 * The dialogue is dense (owner, 2026-10-31: no long pauses): silence before and after a line is cut,
 * pauses inside it over 0.3 s are squeezed to 0.12 s.
 */
const TIGHT =
  'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.02:stop_periods=-1:stop_duration=0.3:stop_threshold=-48dB:stop_silence=0.12';

/**
 * Raw speech -> the delivery's effect, tightened; a line still longer than `slot` (s) is sped up
 * to fit, at most 1.2x (beyond that it sounds hurried: move or shorten the line instead).
 */
export function applyFx(raw, out, fx, slot = Infinity) {
  const tight = out.replace(/\.wav$/, '.tight.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af', TIGHT, '-ar', '48000', '-ac', '1', tight]);
  const tempo = Math.min(1.2, Math.max(1, duration(tight) / slot));
  const chain = FX[fx].replace('[0:a]', tempo > 1.001 ? `[0:a]atempo=${tempo.toFixed(3)},` : '[0:a]');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    tight,
    '-filter_complex',
    chain,
    '-map',
    '[o]',
    '-ar',
    '48000',
    '-ac',
    '1',
    out,
  ]);
  fs.unlinkSync(tight);
  return tempo;
}

export function duration(file) {
  return Number(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file,
    ])
      .toString()
      .trim(),
  );
}

/** Similarity of two strings on their letters only (1 = same), by edit distance. */
function likeness(a, b) {
  const clean = (s) => s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const x = clean(a);
  const y = clean(b);
  if (!x.length && !y.length) return 1;
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
  return 1 - d[x.length][y.length] / Math.max(x.length, y.length);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : null);
  const only = opt('only') ? new Set(opt('only').split(',')) : null;
  const force = args.includes('--force');
  const fxOnly = args.includes('--fx-only');
  for (const pair of (opt('voice') ?? '').split(',').filter(Boolean)) {
    const [who, v] = pair.split('=');
    VOICES[who] = v;
  }
  fs.mkdirSync(path.join(DIR, 'raw'), { recursive: true });
  const KEY = fxOnly
    ? ''
    : fs
        .readFileSync(path.join(ROOT, 'assets-src/openrouter.key'), 'utf8')
        .trim()
        .replace(/^[A-Z_]+=\s*/, '')
        .replace(/^["']|["']$/g, '');
  const post = async (url, body) => {
    const res = await fetch(`${API}${url}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${url} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  };
  const report = [];
  for (const l of lines) {
    if (only && !only.has(l.id)) continue;
    const raw = path.join(DIR, 'raw', `${l.id}.mp3`);
    const out = path.join(DIR, `${l.id}.wav`);
    let heard = '';
    if (!fxOnly && (force || !fs.existsSync(raw))) {
      const speech = await post('/audio/speech', {
        model: MODEL,
        input: l.en,
        voice: VOICES[l.speaker],
        response_format: 'mp3',
      });
      const mp3 = Buffer.from(await speech.arrayBuffer());
      fs.writeFileSync(raw, mp3);
      const tr = await (
        await post('/audio/transcriptions', {
          model: 'elevenlabs/scribe-v2',
          input_audio: { data: mp3.toString('base64'), format: 'mp3' },
        })
      ).json();
      heard = String(tr.text ?? '');
    }
    if (!fs.existsSync(raw)) continue;
    // Room until the next line starts (0.1 s apart); the last line has the end slate.
    const next = lines.find((x) => x.start > l.start + 0.01);
    // …and before the next heaviest hit or silence (a line meant for the silence excepted).
    const clear = l.delivery.startsWith('정적') ? Infinity : Math.min(...[38.6, 66.42, 69.9, 70.89, 89.75, 128.15].filter((t) => t > l.start + 0.3));
    const slot = Math.min(next ? next.start : l.start + 2.5, clear) - l.start - 0.1;
    const tempo = applyFx(raw, out, effectOf(l.delivery), slot);
    const dur = duration(out);
    const like = heard ? likeness(l.en, heard) : null;
    report.push({
      id: l.id,
      who: l.speaker,
      dur: dur.toFixed(2),
      slot: slot.toFixed(2),
      tempo: tempo > 1.001 ? tempo.toFixed(2) : '',
      over: dur > slot + 0.3 ? 'LONG' : '',
      heard:
        like === null ? '' : `${(like * 100).toFixed(0)}%${like < 0.8 ? ' RETAKE: ' + heard : ''}`,
    });
  }
  console.table(report);
  // --fit: subtitles follow the recordings (each line's end = its start + its length).
  if (args.includes('--fit')) {
    for (const l of lines) {
      const f = path.join(DIR, `${l.id}.wav`);
      if (fs.existsSync(f)) l.end = Math.round((l.start + duration(f)) * 100) / 100;
    }
    fs.writeFileSync(path.join(ROOT, 'scripts/trailer/data/lines.json'), JSON.stringify(lines, null, 2) + '\n');
    console.log('lines.json: ends set from the recordings');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
