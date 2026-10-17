/**
 * Third-party assets the game ships, for the main menu's credits page. CC-BY
 * works must be credited (author, work, licence) and the OFL fonts ship with
 * their licence texts (public/assets/fonts/OFL-*.txt); the CC0 ones are listed
 * as thanks. Keep in step with sounds.manifest.json and assets.manifest.json.
 */
export interface Credit {
  work: string;
  author: string;
  license: 'CC-BY 3.0' | 'CC0' | 'OFL 1.1' | 'ElevenLabs';
  url: string;
}

export const CREDITS: readonly Credit[] = [
  { work: 'Engine-loop heavy vehicle/tank', author: 'Nayckron (with qubodup)', license: 'CC-BY 3.0', url: 'https://opengameart.org/content/engine-loop-heavy-vehicletank' },
  { work: 'Jet Engine Takeoff', author: 'dklon', license: 'CC-BY 3.0', url: 'https://opengameart.org/content/jet-engine-takeoff' },
  { work: 'Airplane Prop Loop', author: 'jakobthiesen', license: 'CC-BY 3.0', url: 'https://opengameart.org/content/airplane-prop-loop' },
  { work: 'Tiny Naval Battle Sounds Set', author: 'Iwan Gabovitch (qubodup)', license: 'CC0', url: 'https://opengameart.org/content/tiny-naval-battle-sounds-set' },
  { work: 'Muffled Distant Explosion', author: 'NenadSimic', license: 'CC0', url: 'https://opengameart.org/content/muffled-distant-explosion' },
  { work: 'The Free Firearm Sound Library', author: 'Jaszczak, Nelson, Heras, Nanney', license: 'CC0', url: 'https://opengameart.org' },
  { work: 'Basic Sound Effects, gun reload sounds, equipment clicks, forest birds', author: 'OpenGameArt contributors', license: 'CC0', url: 'https://opengameart.org' },
  { work: 'Pretendard (font)', author: 'Kil Hyung-jin', license: 'OFL 1.1', url: 'https://github.com/orioncactus/pretendard' },
  { work: 'Barlow Condensed (font)', author: 'Jeremy Tribby', license: 'OFL 1.1', url: 'https://github.com/jpt/barlow' },
  { work: 'Impact Sounds, Interface Sounds, UI Audio', author: 'Kenney', license: 'CC0', url: 'https://kenney.nl' },
  // Battle briefing radio voices, generated (eleven-v4-turbo via OpenRouter; check the commercial terms before release).
  { work: 'Battle briefing voices (brian, callum)', author: 'ElevenLabs', license: 'ElevenLabs', url: 'https://elevenlabs.io' },
  { work: 'Textures, skies (HDRIs) and models', author: 'Poly Haven', license: 'CC0', url: 'https://polyhaven.com' },
];
