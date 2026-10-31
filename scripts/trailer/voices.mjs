// The launch trailer's English lines (scripts/trailer/data/lines.json) as voice files
// (docs/design/trailer-production.md §4). Run in a local session on the owner's PC:
// the OpenRouter key is in git-ignored assets-src/openrouter.key (`OPENROUTER_API_KEY=...`),
// the same route as the battle briefing's voices (scripts/voice-generate.mjs).
//
//   node scripts/trailer/voices.mjs                  every line not made yet
//   node scripts/trailer/voices.mjs --only L05,L19 --force [--voice Sarge=bill]
//   node scripts/trailer/voices.mjs --fx-only        redo the effects on the raw files only (no API)
//
// Each line: speech (elevenlabs/eleven-v4) -> assets-src/trailer/voice/raw/Lnn.mp3, checked by
// transcribing it back (Claude can't listen; a transcript far from the text is reported),
// then the delivery's effect (radio / slow-motion / near) -> assets-src/trailer/voice/Lnn.wav.
// The report says which lines run longer than their slot in the music (move or shorten them).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const DIR = path.join(ROOT, 'assets-src', 'trailer', 'voice');
const API = 'https://openrouter.ai/api/v1';
const MODEL = 'elevenlabs/eleven-v4';
const lines = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/trailer/data/lines.json'), 'utf8'),
);

/**
 * A voice per speaker from OpenRouter's ElevenLabs presets (george, sarah, adam, alice, bella,
 * bill, brian, callum, charlie, chris, daniel, eric, harry, jessica, laura, liam, lily, matilda,
 * river, roger, will). Picked from ElevenLabs' own descriptions; listen and swap with --voice.
 */
export const VOICES = {
  Sarge: 'adam', // firm, rough-edged
  Private: 'liam', // young, earnest
  'Squadmate 1': 'charlie',
  'Squadmate 2': 'callum',
  Command: 'brian', // the briefing's HQ voice
  'Iron One': 'bill',
  'Hawk Two': 'eric',
  'Coral One': 'daniel',
  'Sub captain': 'george',
  Coxswain: 'roger',
  'Landing soldier': 'harry',
  'AA gunner': 'will',
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

export function applyFx(raw, out, fx) {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    raw,
    '-filter_complex',
    FX[fx],
    '-map',
    '[o]',
    '-ar',
    '48000',
    '-ac',
    '1',
    out,
  ]);
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
    applyFx(raw, out, effectOf(l.delivery));
    const dur = duration(out);
    const slot = l.end - l.start;
    const like = heard ? likeness(l.en, heard) : null;
    report.push({
      id: l.id,
      who: l.speaker,
      dur: dur.toFixed(2),
      slot: slot.toFixed(2),
      over: dur > slot + 0.3 ? 'LONG' : '',
      heard:
        like === null ? '' : `${(like * 100).toFixed(0)}%${like < 0.8 ? ' RETAKE: ' + heard : ''}`,
    });
  }
  console.table(report);
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
