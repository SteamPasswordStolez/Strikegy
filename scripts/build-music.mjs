// The music the owner supplied (2026-10-24, assets-src/sounds/; made with Suno and Google Lyria on paid plans), levelled and
// encoded for the site: `npm run music` -> public/music/<slot>.mp3 + index.json
// (src/audio/music.ts reads it). Loudness-normalised (EBU R128, -16 LUFS,
// -1.5 dBTP) so a track never jumps out over another, 44.1 kHz stereo 128 kbps.
// Needs ffmpeg. A slot whose source is missing is left out (the game plays its
// fallback or nothing).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Slot -> source in assets-src/sounds (owner, 2026-10-24). */
const TRACKS = {
  menu: 'Orders_from_the_High_Ground.mp3', // the main menu and the multiplayer waiting room
  loading: 'Sneaking.mp3',
  briefing: 'Briefing.mp3', // as a match begins, then fading out
  engaging: 'Engaging.mp3', // a firefight (when: src/core/Game.ts `combatMusic`)
  victory: 'Symphony_of_Iron.mp3',
  defeat: 'Advance_at_Will.mp3',
  marshal: 'lobby.mp3', // the menu's track from level 1000 (원수) on (owner, 2026-10-24)
};

const SRC = 'assets-src/sounds';
const OUT = 'public/music';
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]?.split(',') : null;
mkdirSync(OUT, { recursive: true });
const tracks = {};
for (const [slot, file] of Object.entries(TRACKS)) {
  const src = join(SRC, file);
  const out = join(OUT, `${slot}.mp3`);
  if (!existsSync(src)) {
    console.log(`music: ${slot}: ${src} missing, left out`);
    continue;
  }
  tracks[slot] = `${slot}.mp3`;
  if (only && !only.includes(slot) && existsSync(out)) continue;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-map_metadata', '-1', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', out], { stdio: 'inherit' });
  console.log(`music: ${slot} <- ${file} (${Math.round(statSync(out).size / 1024)} KB)`);
}
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify({ tracks }, null, 2)}\n`);
console.log(`music: ${Object.keys(tracks).length} tracks in ${OUT}/index.json`);
