/**
 * The battle briefing's cues (owner, 2026-10-17; docs/design/battle-briefing.md):
 * every line our side's HQ (or, in modes without sides, the announcer) can
 * say, how urgent it is and how often it may come. Import-free and
 * erasable-only, so scripts (`npm run voice`, the line sheet) read it too.
 *
 * Texts: subtitles are `brief.<cue>.<n>` (n from 1), the strip's headline
 * `crit.<cue>`, in src/i18n. A `{z}` in a line is the zone, read out as a
 * phonetic word (`PHONETIC`) in subtitles and voice; the strip shows the
 * letter. Lines never put a particle right after `{z}` (알파를 / 폭스트롯을).
 * Voice files: `<cue>[.<zone>]_<n>` (`voiceFile`), one per zone for zone cues.
 */

export type Speaker = 'hq' | 'announcer';
/** 1 = always said (cuts lower ones off), 2 = important (waits a little), 3 = news (only when quiet). */
export type Priority = 1 | 2 | 3;

export interface CueDef {
  speaker: Speaker;
  priority: Priority;
  /** Seconds before the same cue (for zone cues: the same cue and zone) may come again. */
  cooldown: number;
  /** How many spoken variants there are. */
  lines: number;
  /** Said per zone (one voice file per zone letter). */
  zone?: boolean;
  /** Seconds it may wait in the queue before it is dropped (default by priority). */
  expire?: number;
  /** ElevenLabs delivery tag put before the line when it is generated. */
  tag: string;
}

const hq = (priority: Priority, lines: number, tag: string, more: Partial<CueDef> = {}): CueDef => ({ speaker: 'hq', priority, cooldown: 20, lines, tag, ...more });
const ann = (priority: Priority, lines: number, tag: string, more: Partial<CueDef> = {}): CueDef => ({ speaker: 'announcer', priority, cooldown: 20, lines, tag, ...more });

export const CUES = {
  // Start and end.
  'start.zone': hq(1, 2, '[firm]', { expire: 30 }),
  'start.attack': hq(1, 2, '[firm]', { expire: 30 }),
  'start.defend': hq(1, 2, '[urgent]', { expire: 30 }),
  'start.tdm': hq(1, 1, '[firm]', { expire: 30 }),
  'start.killconfirm': hq(1, 1, '[firm]', { expire: 30 }),
  'start.fortress': hq(1, 1, '[calm]', { expire: 30 }),
  'start.escortAttack': hq(1, 1, '[firm]', { expire: 30 }),
  'start.escortDefend': hq(1, 1, '[urgent]', { expire: 30 }),
  'fortress.built': hq(1, 1, '[firm]'),
  'end.win': hq(1, 2, '[relieved]', { expire: 6 }),
  'end.lose': hq(1, 2, '[tense]', { expire: 6 }),
  // Zones.
  'zone.taken': hq(2, 1, '[firm]', { zone: true }),
  'zone.lost': hq(1, 1, '[urgent]', { zone: true }),
  'zone.attacked': hq(3, 2, '[urgent]', { cooldown: 30 }),
  'zones.allOurs': hq(2, 1, '[firm]', { cooldown: 60 }),
  'zones.allTheirs': hq(1, 1, '[urgent]', { cooldown: 60 }),
  // The score.
  'lead.gained': hq(2, 2, '[firm]', { cooldown: 45 }),
  'lead.lost': hq(2, 2, '[urgent]', { cooldown: 45 }),
  'win.near': hq(1, 1, '[firm]', { cooldown: 600 }),
  'lose.near': hq(1, 1, '[urgent]', { cooldown: 600 }),
  // Tickets.
  'tickets.low': hq(1, 1, '[tense]', { cooldown: 600 }),
  'tickets.last': hq(1, 1, '[urgent]', { cooldown: 600 }),
  'tickets.enemyLow': hq(2, 1, '[firm]', { cooldown: 600 }),
  // Frontline.
  'sector.won': hq(1, 2, '[firm]', { cooldown: 10 }),
  'sector.lost': hq(1, 1, '[urgent]', { cooldown: 10 }),
  'attack.heldUs': hq(1, 1, '[firm]', { cooldown: 10 }),
  'attack.heldThem': hq(1, 1, '[tense]', { cooldown: 10 }),
  'timer.lowAttack': hq(2, 1, '[urgent]', { cooldown: 60 }),
  'timer.lowDefend': hq(2, 1, '[firm]', { cooldown: 60 }),
  'final.attack': hq(1, 1, '[firm]', { cooldown: 60 }),
  'final.defend': hq(1, 1, '[urgent]', { cooldown: 60 }),
  // Conquest, Rush.
  breakthrough: hq(1, 2, '[firm]', { cooldown: 10 }),
  breached: hq(1, 2, '[urgent]', { cooldown: 10 }),
  'charge.armedUs': hq(1, 1, '[firm]', { cooldown: 8 }),
  'charge.armedThem': hq(1, 1, '[urgent]', { cooldown: 8 }),
  'charge.defusedUs': hq(2, 1, '[firm]', { cooldown: 8 }),
  'charge.defusedThem': hq(2, 1, '[urgent]', { cooldown: 8 }),
  'charge.blownUs': hq(1, 1, '[firm]', { cooldown: 8 }),
  'charge.blownThem': hq(1, 1, '[tense]', { cooldown: 8 }),
  // Search and destroy.
  'round.attack': hq(1, 1, '[firm]', { cooldown: 5, expire: 12 }),
  'round.defend': hq(1, 1, '[firm]', { cooldown: 5, expire: 12 }),
  'round.won': hq(1, 1, '[relieved]', { cooldown: 5 }),
  'round.lost': hq(1, 1, '[tense]', { cooldown: 5 }),
  'round.match': hq(1, 1, '[tense]', { cooldown: 5, expire: 12 }),
  lastAlive: hq(1, 1, '[calm]', { cooldown: 5 }),
  // Hardpoint, escort.
  hill: hq(1, 1, '[firm]', { zone: true, cooldown: 10 }),
  'hill.soon': hq(3, 1, '[calm]', { cooldown: 30 }),
  'payload.moving': hq(2, 1, '[firm]', { cooldown: 40 }),
  'payload.stopped': hq(2, 1, '[urgent]', { cooldown: 40 }),
  'payload.held': hq(2, 1, '[firm]', { cooldown: 40 }),
  'checkpoint.us': hq(1, 1, '[firm]', { cooldown: 10 }),
  'checkpoint.them': hq(1, 1, '[urgent]', { cooldown: 10 }),
  // Every soldier for themselves: the announcer.
  'ffa.start': ann(1, 1, '[firm]', { expire: 30 }),
  'ffa.lead': ann(2, 1, '[firm]', { cooldown: 40 }),
  'ffa.leadLost': ann(2, 1, '[firm]', { cooldown: 40 }),
  'ffa.near': ann(1, 1, '[firm]', { cooldown: 600 }),
  'ffa.win': ann(1, 1, '[firm]', { expire: 6 }),
  'ffa.lose': ann(1, 1, '[calm]', { expire: 6 }),
  'gungame.last': ann(1, 1, '[firm]', { cooldown: 30 }),
  'gungame.demoted': ann(2, 1, '[firm]', { cooldown: 15 }),
  'lastman.shrink': ann(2, 2, '[firm]', { cooldown: 20 }),
  'lastman.storm': ann(1, 1, '[urgent]', { cooldown: 15 }),
  'lastman.few': ann(2, 1, '[tense]', { cooldown: 600 }),
} as const satisfies Record<string, CueDef>;

export type CueId = keyof typeof CUES;

/** The zone letters there are voice files for. */
export const ZONE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

/** Zone letters read out (the military phonetic alphabet; owner, 2026-10-17: "알파 / 브라보"). */
export const PHONETIC: Record<'ko' | 'en', Record<string, string>> = {
  ko: { A: '알파', B: '브라보', C: '찰리', D: '델타', E: '에코', F: '폭스트롯', G: '골프' },
  en: { A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf' },
};

/** Languages the radio speaks (voice files in public/assets/voice/<lang>/). */
export const VOICE_LANGS = ['en', 'de', 'fr', 'fa', 'es', 'nl'] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number];

/**
 * The radio's language by map (owner, 2026-10-17: Iron Gate German, Lyon French,
 * Persia Persian, Ardennes Dutch / Flemish, Bilbao Spanish; English elsewhere).
 * Subtitles stay in the player's own language.
 */
export const VOICE_BY_MAP: Record<string, VoiceLang> = { iron_gate: 'de', lyon: 'fr', persia: 'fa', ardennes: 'nl', bilbao: 'es' };

export function voiceLangFor(mapId: string): VoiceLang {
  return VOICE_BY_MAP[mapId] ?? 'en';
}

/** The rules that keep the radio from chattering (owner, 2026-10-17: "BFV 정도"). */
export const BRIEF_RULES = {
  /** Quiet seconds after a line before the next (priority 1 doesn't wait). */
  gap: 3,
  /** Lines a minute at most; past it, priority 3 is skipped. */
  perMinute: 6,
  /** Default seconds a cue may wait, by priority. */
  expire: { 1: 12, 2: 10, 3: 4 } as Record<Priority, number>,
  /** A zone flipping back within this many seconds isn't said again (the strip still shows it). */
  flip: 20,
};

/** The voice file of a line: `zone.taken.B_1`. */
export function voiceFile(cue: CueId, n: number, zone?: string): string {
  return `${cue}${zone ? `.${zone}` : ''}_${n}`;
}

/** Every voice file the cues can ask for. */
export function allVoiceFiles(): { file: string; cue: CueId; n: number; zone?: string }[] {
  const out: { file: string; cue: CueId; n: number; zone?: string }[] = [];
  for (const cue of Object.keys(CUES) as CueId[]) {
    const def: CueDef = CUES[cue];
    for (let n = 1; n <= def.lines; n++) {
      if (def.zone) for (const z of ZONE_LETTERS) out.push({ file: voiceFile(cue, n, z), cue, n, zone: z });
      else out.push({ file: voiceFile(cue, n), cue, n });
    }
  }
  return out;
}
