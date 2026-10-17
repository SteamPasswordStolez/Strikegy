// The battle briefing's line sheet (docs/design/battle-briefing.md §8): one row per
// voice file the game can play, with what to generate and the file name to save it as.
// The owner generates the lines with ElevenLabs (OpenRouter, `elevenlabs/eleven-v4`) from
// this sheet, drops them into assets-src/voice/<lang>/ and runs `npm run voice`.
//
//   npm run voice:lines            -> docs/design/briefing-lines.csv (UTF-8 with BOM, opens in Excel)
import fs from 'node:fs';
import { CUES, PHONETIC, allVoiceFiles } from '../src/audio/briefing/cues.ts';

const ko = JSON.parse(fs.readFileSync('src/i18n/ko.json', 'utf8'));
const en = JSON.parse(fs.readFileSync('src/i18n/en.json', 'utf8'));
/** Suggested voices (owner, 2026-10-17: HQ + the solo-mode announcer; picks from OpenRouter's presets). */
const VOICE = { hq: 'brian', announcer: 'callum' };

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const fill = (text, zone, lang) => text.replace('{z}', zone ? PHONETIC[lang][zone] : '');

const rows = [['file', 'cue', 'variant', 'zone', 'speaker', 'voice', 'tag', 'tts_ko', 'subtitle_ko', 'subtitle_en']];
for (const f of allVoiceFiles()) {
  const def = CUES[f.cue];
  const key = `brief.${f.cue}.${f.n}`;
  const lineKo = fill(ko[key] ?? '', f.zone, 'ko');
  rows.push([`${f.file}.mp3`, f.cue, f.n, f.zone ?? '', def.speaker, VOICE[def.speaker], def.tag, `${def.tag} ${lineKo}`, lineKo, fill(en[key] ?? '', f.zone, 'en')]);
}
const out = 'docs/design/briefing-lines.csv';
fs.writeFileSync(out, '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n');
console.log(`wrote ${out}: ${rows.length - 1} lines`);
