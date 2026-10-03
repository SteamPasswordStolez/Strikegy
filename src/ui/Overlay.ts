/**
 * How the full-screen layer is dressed: the title menu (start / pause), a
 * match result (won / lost), or a plain message (loading, errors).
 */
export type OverlayKind = 'menu' | 'win' | 'loss' | 'info';

/** Full-screen message layer used for start / pause / result / error states. */
export class Overlay {
  readonly root: HTMLDivElement;
  private panel: HTMLDivElement;
  private contextEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private hintEl: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'overlay kind-info';
    this.panel = document.createElement('div');
    this.panel.className = 'ov-panel';
    this.contextEl = document.createElement('div');
    this.contextEl.className = 'ov-context';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'overlay-title';
    const rule = document.createElement('div');
    rule.className = 'ov-rule';
    this.subEl = document.createElement('div');
    this.subEl.className = 'overlay-sub';
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'overlay-hint';
    this.panel.append(this.contextEl, this.titleEl, rule, this.subEl, this.hintEl);
    this.root.appendChild(this.panel);
    parent.appendChild(this.root);
  }

  /** The small line over the title: map and mode. */
  setContext(text: string): void {
    this.contextEl.textContent = text;
  }

  /** Extra content between the subtitle and the hint (e.g. the final scoreboard); null removes it. */
  setExtra(el: HTMLElement | null): void {
    this.panel.querySelector('.overlay-extra')?.remove();
    if (!el) return;
    const box = document.createElement('div');
    box.className = 'overlay-extra';
    box.appendChild(el);
    this.panel.insertBefore(box, this.hintEl);
  }

  show(title: string, sub = '', hint = '', kind: OverlayKind = 'info'): void {
    this.root.className = `overlay kind-${kind}`;
    this.titleEl.textContent = title;
    this.subEl.textContent = sub;
    this.subEl.style.display = sub ? '' : 'none';
    renderHint(this.hintEl, hint);
    document.body.classList.add('overlay-up');
  }

  hide(): void {
    this.root.classList.add('hidden');
    document.body.classList.remove('overlay-up');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}

/**
 * The controls line ("WASD move · Shift sprint · ...") as a grid of keycaps;
 * touch hints ("Left drag: move · ...") put the part before the colon in the
 * cap. A short line stays plain text.
 */
export function renderHint(el: HTMLElement, hint: string): void {
  el.replaceChildren();
  el.classList.remove('keys', 'gestures');
  if (!hint) return;
  const items = hint.split(' · ');
  if (items.length < 4) {
    el.textContent = hint;
    return;
  }
  el.classList.add('keys');
  // Touch hints describe gestures ("Left drag: move"): only the colon splits them.
  const gestures = items.some((i) => i.includes(': '));
  el.classList.toggle('gestures', gestures);
  for (const item of items) {
    const { key, what } = splitKey(item, gestures);
    const row = document.createElement('div');
    row.className = 'ov-key';
    if (key) {
      const cap = document.createElement('span');
      cap.className = 'keycap';
      cap.textContent = key;
      row.appendChild(cap);
    }
    const w = document.createElement('span');
    w.className = 'ov-key-what';
    w.textContent = what;
    row.appendChild(w);
    el.appendChild(row);
  }
}

/** "Shift sprint" → Shift / sprint; "E(hold) revive" keeps the note with the key; "Left drag: move" splits at the colon. */
function splitKey(item: string, gestures: boolean): { key: string; what: string } {
  const s = item.trim();
  const colon = s.indexOf(': ');
  if (gestures)
    return colon > 0 ? { key: s.slice(0, colon), what: s.slice(colon + 2) } : { key: '', what: s };
  const m = /^([^\s(]+(?:\s?\([^)]*\))?)\s+(.+)$/.exec(s);
  if (m && m[1]!.length <= 16) return { key: m[1]!, what: m[2]! };
  return { key: '', what: s };
}
