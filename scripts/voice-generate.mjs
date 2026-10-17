// Generates the battle briefing's voice lines with ElevenLabs on OpenRouter
// (owner, 2026-10-17: the owner's key in git-ignored assets-src/openrouter.key)
// and checks each by transcribing it back (Claude can't listen): a line whose
// transcript is too far from the text is reported for a retake.
//
//   node scripts/voice-generate.mjs --test [--voices brian,adam,callum,roger] [--tag]
//        three test lines a voice into assets-src/voice/test/
//   node scripts/voice-generate.mjs [--lang en] [--hq brian] [--announcer callum] [--only zone.] [--force] [--tag]
//        every line of docs/design/briefing-lines.csv into assets-src/voice/<lang>/
//        (existing files are kept unless --force); then `npm run voice`.
// The game speaks English (owner, 2026-10-17: "full English"; the subtitles follow the
// player's language); --lang ko makes the Korean set the first try used.
// --tag puts the cue's delivery tag ([firm], [urgent]...) before the text; without it the
// text alone is sent (turbo models may read tags out loud: the transcript shows it).
import fs from 'node:fs';
import path from 'node:path';
import { CUES, PHONETIC, allVoiceFiles } from '../src/audio/briefing/cues.ts';

const API = 'https://openrouter.ai/api/v1';
const MODEL = 'elevenlabs/eleven-v4-turbo';
// The file holds `OPENROUTER_API_KEY=sk-or-...` (or the bare key).
const KEY = fs.readFileSync('assets-src/openrouter.key', 'utf8').trim().replace(/^[A-Z_]+=\s*/, '').replace(/^["']|["']$/g, '');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const has = (name) => args.includes(`--${name}`);
const LANG = opt('lang', 'en');
// English / Korean lines are the subtitles (src/i18n); the map radio languages (de, fr, fa,
// es, nl) live in scripts/data/briefing-voice.json with their own phonetic words.
const extra = JSON.parse(fs.readFileSync('scripts/data/briefing-voice.json', 'utf8'));
const lineOf = (cue, n) =>
  LANG === 'en' || LANG === 'ko' ? JSON.parse(fs.readFileSync(`src/i18n/${LANG}.json`, 'utf8'))[`brief.${cue}.${n}`] : extra[LANG]?.[`${cue}.${n}`];
const phonetic = (z) => (PHONETIC[LANG] ?? extra.phonetic[LANG])[z];

async function speak(text, voice) {
  const res = await fetch(`${API}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: text, voice, response_format: 'mp3' }),
  });
  if (!res.ok) throw new Error(`speech ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function transcribe(mp3) {
  const res = await fetch(`${API}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'elevenlabs/scribe-v2', input_audio: { data: mp3.toString('base64'), format: 'mp3' } }),
  });
  if (!res.ok) throw new Error(`transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return { text: String(j.text ?? ''), cost: Number(j.usage?.cost ?? 0) };
}

/** Similarity of two strings on their letters only (1 = same), by edit distance. */
function likeness(a, b) {
  // Zone words are written in any script by the transcriber ("Bravo" for براوو): leave them out.
  const zoneWords = [...Object.values(PHONETIC.en), ...Object.values(PHONETIC[LANG] ?? extra.phonetic[LANG] ?? {})];
  const clean = (s) =>
    zoneWords
      .reduce((t, w) => t.replace(new RegExp(w.replace(/[-\s‌]/g, '[-\\s‌]?'), 'giu'), ''), s.replace(/\[[^\]]*\]/g, ''))
      .replace(/[^\p{L}\p{N}]/gu, '')
      .toLowerCase();
  const x = clean(a);
  const y = clean(b);
  if (!x.length && !y.length) return 1;
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return 1 - d[x.length][y.length] / Math.max(x.length, y.length);
}

/** Runs `jobs` three at a time. */
async function pool(jobs, n = 3) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < jobs.length) {
        const k = i++;
        out[k] = await jobs[k]();
      }
    }),
  );
  return out;
}

async function make(file, text, voice) {
  const spoken = has('tag') ? text : text.replace(/^\[[^\]]*\]\s*/, '');
  let mp3;
  try {
    mp3 = await speak(spoken, voice);
  } catch (err) {
    return { file, voice, ok: false, note: String(err.message ?? err) };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, mp3);
  let heard;
  let cost = 0;
  try {
    ({ text: heard, cost } = await transcribe(mp3));
  } catch (err) {
    heard = `(transcription failed: ${err.message ?? err})`;
  }
  const score = likeness(text, heard);
  return { file, voice, ok: score >= 0.8, score, heard, sent: spoken, cost };
}

const report = (results) => {
  let bad = 0;
  for (const r of results) {
    const mark = r.ok ? 'ok ' : 'CHECK';
    if (!r.ok) bad++;
    console.log(`${mark} ${path.basename(r.file)} [${r.voice}] ${r.score !== undefined ? r.score.toFixed(2) : ''}  sent: ${r.sent ?? ''}  heard: ${r.heard ?? r.note}`);
  }
  console.log(`${results.length - bad} / ${results.length} close to the text${bad ? `, ${bad} to check or retake` : ''}`);
};

if (has('test')) {
  const voices = opt('voices', 'brian,adam,callum,roger').split(',');
  const lines = [
    `[firm] ${lineOf('zone.taken', 1).replace('{z}', phonetic('B'))}`,
    `[tense] ${lineOf('tickets.low', 1)}`,
    `[urgent] ${lineOf('charge.armedThem', 1)}`,
  ];
  const jobs = voices.flatMap((v) => lines.map((l, n) => () => make(path.join('assets-src', 'voice', 'test', `${LANG}_${v}${has('tag') ? '_tag' : ''}_${n + 1}.mp3`), l, v)));
  report(await pool(jobs));
} else {
  const voiceOf = { hq: opt('hq', 'brian'), announcer: opt('announcer', 'callum') };
  const only = opt('only', '');
  const jobs = [];
  for (const f of allVoiceFiles()) {
    if (only && !f.file.startsWith(only)) continue;
    const dest = path.join('assets-src', 'voice', LANG, `${f.file}.mp3`);
    if (fs.existsSync(dest) && !has('force')) continue;
    const def = CUES[f.cue];
    const line = (lineOf(f.cue, f.n) ?? '').replace('{z}', f.zone ? phonetic(f.zone) : '');
    if (!line) throw new Error(`no ${LANG} line for ${f.cue}.${f.n}`);
    jobs.push(() => make(dest, `${def.tag} ${line}`, voiceOf[def.speaker]));
  }
  console.log(`${jobs.length} lines to make`);
  report(await pool(jobs));
}
