import { t, type Locale, type MessageKey } from '@/i18n';
import type { AudioSystem } from '../AudioSystem';
import { playRadio, type RadioLine } from '../radio';
import { CriticalStrip, type CritTone } from '@/ui/CriticalStrip';
import { CUES, PHONETIC, voiceFile, ZONE_LETTERS, type CueId, type VoiceLang } from './cues';
import { BriefingScheduler } from './scheduler';
import { VoiceBank } from './voiceBank';

/** How far the world goes down under a radio line (dB). */
const DUCK_DB = -5;

/**
 * The battle briefing (owner, 2026-10-17; docs/design/battle-briefing.md):
 * news goes on the strip at once and is offered to the scheduler; when the
 * scheduler gives the air to a line, it is played through the radio (if its
 * voice file is there and audio is unlocked), the world ducks under it and
 * the subtitle shows. Without a file the line is text only.
 */
export class Briefing {
  private readonly sched = new BriefingScheduler();
  private readonly bank: VoiceBank;
  private readonly strip: CriticalStrip;
  private current: RadioLine | null = null;
  private paused = false;
  private last = performance.now() / 1000;

  constructor(
    hud: HTMLElement,
    private readonly audio: AudioSystem,
    /** The subtitles' language (the player's). */
    private readonly locale: Locale,
    private subtitles: boolean,
    base: string,
    /** The radio's language (the map's: `voiceLangFor`). */
    voice: VoiceLang,
  ) {
    this.strip = new CriticalStrip(hud);
    this.bank = new VoiceBank(`${base}voice/${voice}/`);
  }

  /** Loads the voice files these cues can use (all zone letters for zone cues). */
  preload(cues: readonly CueId[]): void {
    const files: string[] = [];
    for (const cue of new Set(cues)) {
      const def = CUES[cue];
      for (let n = 1; n <= def.lines; n++) {
        if ('zone' in def && def.zone) for (const z of ZONE_LETTERS) files.push(voiceFile(cue, n, z));
        else files.push(voiceFile(cue, n));
      }
    }
    void this.bank.preload(files);
  }

  /** News: on the strip now, and on the radio when the scheduler allows. */
  say(cue: CueId, tone: CritTone, opts: { zone?: string; detail?: string } = {}): void {
    const head = t(`crit.${cue}` as MessageKey).replace('{z}', opts.zone ?? '');
    this.strip.show(head, opts.detail ?? '', tone);
    this.sched.offer(cue, performance.now() / 1000, opts.zone);
  }

  /** The match is over: only the closing line is left to say. */
  closing(cue: CueId, tone: CritTone): void {
    this.sched.clear();
    this.current?.stop();
    this.current = null;
    this.paused = false;
    this.say(cue, tone);
  }

  /** A new round: what was waiting is old news. */
  reset(): void {
    this.sched.clear();
    this.strip.clear();
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  setSubtitles(on: boolean): void {
    this.subtitles = on;
  }

  /** Per frame. */
  update(): void {
    const now = performance.now() / 1000;
    const dt = Math.min(0.25, now - this.last);
    this.last = now;
    this.strip.update(dt);
    if (this.paused) return;
    const got = this.sched.next(now);
    if (!got) return;
    const { pick, cut } = got;
    const def = CUES[pick.cue];
    const buffer = this.bank.get(voiceFile(pick.cue, pick.n, pick.zone));
    const out = buffer ? this.audio.voiceOutput() : null;
    if (!buffer || !out || out.ctx.state !== 'running') {
      // No voice for it (yet): it counts as said, the strip already showed it.
      this.sched.started(pick, now, 0);
      return;
    }
    if (cut) this.current?.stop();
    const line = playRadio(out.ctx, out.dest, buffer, def.speaker === 'hq' ? 'hq' : 'clean');
    this.current = line;
    this.audio.duck(DUCK_DB, line.voiceFrom, line.voiceTo);
    this.sched.started(pick, now, line.duration);
    if (this.subtitles) {
      const phonetic = PHONETIC[this.locale] ?? PHONETIC.en;
      const text = t(`brief.${pick.cue}.${pick.n}` as MessageKey).replace('{z}', pick.zone ? (phonetic[pick.zone] ?? pick.zone) : '');
      this.strip.subtitle(t(def.speaker === 'hq' ? 'brief.hq' : 'brief.announcer'), text, line.duration);
    }
  }
}
