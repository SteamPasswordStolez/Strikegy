/**
 * The briefing's voice files (`npm run voice` puts them in
 * public/assets/voice/<lang>/ with an index.json of what is there). Fetched
 * per match for the cues the mode can use, decoded off the page's own audio
 * context (an offline one), so they are ready before the first click. A line
 * whose file isn't there simply isn't spoken: the strip still shows it.
 */
export class VoiceBank {
  private index: Set<string> | null = null;
  private indexLoad: Promise<void> | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Set<string>();
  private decoder: OfflineAudioContext | null = null;

  constructor(private readonly base: string) {}

  private loadIndex(): Promise<void> {
    this.indexLoad ??= (async () => {
      try {
        const res = await fetch(`${this.base}index.json`);
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as { files?: Record<string, number> };
        this.index = new Set(Object.keys(j.files ?? {}));
      } catch {
        // No voice files for this language yet: text only.
        this.index = new Set();
      }
    })();
    return this.indexLoad;
  }

  /** Fetches and decodes these files (the ones that exist), a few at a time. */
  async preload(files: readonly string[]): Promise<void> {
    await this.loadIndex();
    const want = files.filter((f) => this.index!.has(f) && !this.buffers.has(f) && !this.loading.has(f));
    for (const f of want) this.loading.add(f);
    const next = async (): Promise<void> => {
      const f = want.shift();
      if (!f) return;
      try {
        const res = await fetch(`${this.base}${encodeURIComponent(f)}.mp3`);
        if (res.ok) {
          this.decoder ??= new OfflineAudioContext(1, 1, 48000);
          this.buffers.set(f, await this.decoder.decodeAudioData(await res.arrayBuffer()));
        }
      } catch {
        // Missing or broken: that line stays text only.
      }
      this.loading.delete(f);
      return next();
    };
    await Promise.all([next(), next(), next()]);
  }

  /** A decoded line, or null (not there, or not loaded yet). */
  get(file: string): AudioBuffer | null {
    return this.buffers.get(file) ?? null;
  }
}
