/**
 * Music outside the battle (owner, 2026-10-24): the main menu, the loading
 * screen, the multiplayer waiting room and the result screen (a win and a
 * loss). The owner supplies the tracks; `npm run music` levels them into
 * `public/music/<slot>.mp3` and lists them in `public/music/index.json`. A slot
 * without a file plays its fallback (loading and the waiting room: the menu's
 * track, which then just goes on) or nothing. One player for the whole page
 * (the menu, then the match in the same page): tracks cross-fade, the
 * matching track keeps playing when a screen asks for it again, and nothing
 * starts before the browser allows sound (the first click or key).
 */
export type MusicSlot = 'menu' | 'loading' | 'lobby' | 'victory' | 'defeat';

const FALLBACK: Partial<Record<MusicSlot, MusicSlot>> = { loading: 'menu', lobby: 'menu' };
/** Tracks that play once (the result's sting), the rest loop. */
const ONCE: readonly MusicSlot[] = ['victory', 'defeat'];
const FADE_IN = 1.6;
const FADE_OUT = 1.2;

interface Playing {
  file: string;
  el: HTMLAudioElement;
  gain: GainNode;
}

class MusicPlayer {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private index: Promise<Partial<Record<MusicSlot, string>>> | null = null;
  private current: Playing | null = null;
  /** What was asked for last (played once sound is allowed). */
  private wanted: MusicSlot | null = null;
  private volume = 0.5;
  private master = 0.8;
  private unlocked = false;

  constructor() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this.unlocked = true;
      void this.ctx?.resume();
      if (this.wanted && !this.current) void this.play(this.wanted);
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) window.addEventListener(ev, unlock, { once: true, capture: true });
  }

  private tracks(): Promise<Partial<Record<MusicSlot, string>>> {
    this.index ??= fetch(`${import.meta.env.BASE_URL}music/index.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<{ tracks?: Partial<Record<MusicSlot, string>> }>) : {}))
      .then((j) => ('tracks' in j && j.tracks ? j.tracks : {}))
      .catch(() => ({}));
    return this.index;
  }

  /** Music volume (0..1, settings) under the master volume. */
  setVolume(music: number, master = this.master): void {
    this.volume = music;
    this.master = master;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(music * master, this.ctx.currentTime, 0.1);
  }

  /** Plays `slot` (its fallback if it has no file); the same file already playing goes on. */
  async play(slot: MusicSlot): Promise<void> {
    this.wanted = slot;
    const list = await this.tracks();
    if (this.wanted !== slot) return;
    const name = list[slot] ?? (FALLBACK[slot] ? list[FALLBACK[slot]!] : undefined);
    if (!name) return this.stop();
    const file = `${import.meta.env.BASE_URL}music/${name}`;
    if (this.current?.file === file) return;
    if (!this.unlocked) return;
    const ctx = this.audio();
    if (!ctx || !this.out) return;
    this.fadeOut(FADE_OUT);
    const el = new Audio(file);
    el.crossOrigin = 'anonymous';
    el.loop = !ONCE.includes(slot);
    el.preload = 'auto';
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain).connect(this.out);
    const playing: Playing = { file, el, gain };
    this.current = playing;
    try {
      await el.play();
    } catch {
      if (this.current === playing) this.current = null;
      return;
    }
    gain.gain.setTargetAtTime(1, ctx.currentTime, FADE_IN / 3);
  }

  /** Fades the music out (`sec`). */
  stop(sec = FADE_OUT): void {
    this.wanted = null;
    this.fadeOut(sec);
  }

  private fadeOut(sec: number): void {
    const p = this.current;
    this.current = null;
    if (!p || !this.ctx) return;
    p.gain.gain.setTargetAtTime(0, this.ctx.currentTime, Math.max(0.05, sec / 3));
    setTimeout(() => {
      p.el.pause();
      p.el.removeAttribute('src');
      p.el.load();
      p.gain.disconnect();
    }, sec * 1000 + 200);
  }

  private audio(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      return null;
    }
    this.out = this.ctx.createGain();
    this.out.gain.value = this.volume * this.master;
    this.out.connect(this.ctx.destination);
    return this.ctx;
  }
}

/** The page's one music player. */
export const music = new MusicPlayer();
