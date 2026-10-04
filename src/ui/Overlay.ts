/**
 * How the full-screen layer is dressed: the title menu (start), the pause
 * menu (a column of entries beside the controls or the settings), a match
 * result (won / lost), or a plain message (loading, errors).
 */
export type OverlayKind = 'menu' | 'pause' | 'win' | 'loss' | 'info';

/** A button on the overlay (back to the lobby, play again; the pause menu's entries). */
export interface OverlayAction {
  label: string;
  primary?: boolean;
  /** The pause menu's open entry (drawn inverted). */
  selected?: boolean;
  onClick: () => void;
}

/** Full-screen message layer used for start / pause / result / error states. */
export class Overlay {
  readonly root: HTMLDivElement;
  private panel: HTMLDivElement;
  private contextEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private actionsEl: HTMLDivElement;
  private fillEl: HTMLDivElement;
  private shown: OverlayKind = 'info';

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
    this.fillEl = document.createElement('div');
    this.fillEl.className = 'ov-fill';
    rule.appendChild(this.fillEl);
    this.subEl = document.createElement('div');
    this.subEl.className = 'overlay-sub';
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'overlay-hint';
    this.actionsEl = document.createElement('div');
    this.actionsEl.className = 'ov-actions';
    this.panel.append(this.contextEl, this.titleEl, rule, this.subEl, this.hintEl, this.actionsEl);
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

  /** Buttons under everything else (cleared by every `show`). A click on one doesn't reach the overlay. */
  setActions(actions: readonly OverlayAction[]): void {
    this.actionsEl.replaceChildren();
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ov-action${a.primary ? ' primary' : ''}${a.selected ? ' sel' : ''}`;
      b.textContent = a.label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        a.onClick();
      });
      this.actionsEl.appendChild(b);
    }
  }

  /** Loading: how far along (0..1) and what it is doing now, under the title (cleared by `show`). */
  setProgress(fraction: number, step: string): void {
    this.root.classList.add('loading');
    this.fillEl.style.setProperty('--p', Math.max(0, Math.min(1, fraction)).toFixed(3));
    this.subEl.textContent = step;
    this.subEl.style.display = '';
  }

  show(title: string, sub = '', hint = '', kind: OverlayKind = 'info'): void {
    this.setActions([]);
    this.shown = kind;
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

  /** What the last `show` put up. */
  get kind(): OverlayKind {
    return this.shown;
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
