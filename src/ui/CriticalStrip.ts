import './ds.css';
import './criticalStrip.css';

export type CritTone = 'good' | 'bad' | 'neutral';

/**
 * The battle briefing's on-screen side (docs/design/battle-briefing.md §5),
 * on the design system: the critical-message strip high in the middle (a
 * headline, an optional detail, a bar in the news's colour — ours good, ours
 * bad, neutral), one at a time with a short queue; and the subtitle of the
 * spoken line near the bottom ("HQ: Objective Bravo is ours.").
 */
export class CriticalStrip {
  private readonly strip: HTMLDivElement;
  private readonly head: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly subs: HTMLDivElement;
  private readonly subWho: HTMLSpanElement;
  private readonly subText: HTMLSpanElement;
  private readonly queue: { head: string; detail: string; tone: CritTone }[] = [];
  private showing = 0;
  private subLeft = 0;
  private static readonly SHOW = 3;

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'crit-layer ds-root';
    root.dataset.dsTheme = 'bfv';
    parent.appendChild(root);
    this.strip = document.createElement('div');
    this.strip.className = 'crit';
    this.head = document.createElement('div');
    this.head.className = 'crit-head';
    this.detail = document.createElement('div');
    this.detail.className = 'crit-detail';
    this.strip.append(this.head, this.detail);
    this.subs = document.createElement('div');
    this.subs.className = 'crit-subs';
    this.subWho = document.createElement('span');
    this.subWho.className = 'crit-sub-who';
    this.subText = document.createElement('span');
    this.subs.append(this.subWho, this.subText);
    root.append(this.strip, this.subs);
  }

  /** News for the strip (shown at once, or after the one on screen; at most two wait). */
  show(head: string, detail: string, tone: CritTone): void {
    const item = { head, detail, tone };
    if (this.showing <= 0) this.display(item);
    else {
      this.queue.push(item);
      while (this.queue.length > 2) this.queue.shift();
    }
  }

  /** The spoken line, for `seconds`. */
  subtitle(who: string, text: string, seconds: number): void {
    this.subWho.textContent = who;
    this.subText.textContent = text;
    this.subLeft = seconds + 0.6;
    this.subs.classList.add('on');
  }

  /** Per frame (real seconds). */
  update(dt: number): void {
    if (this.showing > 0) {
      this.showing -= dt;
      if (this.showing <= 0) {
        this.strip.classList.remove('on');
        const next = this.queue.shift();
        // A beat between two strips so each reads as its own news.
        if (next) window.setTimeout(() => this.display(next), 250);
      }
    }
    if (this.subLeft > 0) {
      this.subLeft -= dt;
      if (this.subLeft <= 0) this.subs.classList.remove('on');
    }
  }

  /** Clears everything (a new round, leaving). */
  clear(): void {
    this.queue.length = 0;
    this.showing = 0;
    this.subLeft = 0;
    this.strip.classList.remove('on');
    this.subs.classList.remove('on');
  }

  private display(item: { head: string; detail: string; tone: CritTone }): void {
    this.head.textContent = item.head;
    this.detail.textContent = item.detail;
    this.strip.className = `crit t-${item.tone}`;
    // Restart the entrance even when one strip follows another.
    void this.strip.offsetWidth;
    this.strip.classList.add('on');
    this.showing = CriticalStrip.SHOW;
  }
}
