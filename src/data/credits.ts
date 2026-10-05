/**
 * Third-party assets the game ships, for the main menu's credits page. CC-BY
 * works must be credited (author, work, licence); the CC0 ones are listed
 * as thanks. Keep in step with sounds.manifest.json and assets.manifest.json.
 */
export interface Credit {
  work: string;
  author: string;
  license: 'CC-BY 3.0' | 'CC0';
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
  { work: 'Impact Sounds', author: 'Kenney', license: 'CC0', url: 'https://kenney.nl' },
  { work: 'Textures and models', author: 'Poly Haven', license: 'CC0', url: 'https://polyhaven.com' },
];
