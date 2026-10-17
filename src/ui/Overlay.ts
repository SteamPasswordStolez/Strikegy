import { t, type MessageKey } from '@/i18n';
import { isTouchDevice } from '@/core/Settings';
import './ds.css';
import './loading.css';

/** What the loading screen says about the match (Game sets it once the map is in). */
export interface LoadingInfo {
  /** Mode name (or what kind of place it is, e.g. the range). */
  mode: string;
  name: string;
  /** "5 zones · 12 vs 12". */
  facts: string;
  /** The map from above (ui/mapPainter `paintMapCard`). */
  picture?: HTMLCanvasElement;
}

/** Loading tips: the ones naming keys are for keyboards only. */
const TIPS: readonly { key: MessageKey; keys: boolean }[] = [
  { key: 'tip.revive', keys: true },
  { key: 'tip.build', keys: true },
  { key: 'tip.support', keys: true },
  { key: 'tip.slide', keys: true },
  { key: 'tip.breath', keys: true },
  { key: 'tip.downed', keys: true },
  { key: 'tip.station', keys: false },
  { key: 'tip.rocket', keys: false },
  { key: 'tip.squad', keys: false },
  { key: 'tip.mines', keys: false },
];
const TIP_EVERY_MS = 7000;

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
  /** The loading screen (design system, BFV theme): shown while the root has `.loading`. */
  private readonly ld: HTMLDivElement;
  private readonly ldPic: HTMLDivElement;
  private readonly ldMode: HTMLDivElement;
  private readonly ldName: HTMLDivElement;
  private readonly ldFacts: HTMLDivElement;
  private readonly ldTip: HTMLSpanElement;
  private readonly ldStep: HTMLDivElement;
  private readonly ldPct: HTMLDivElement;
  private readonly ldBar: HTMLDivElement;
  private tipTimer = 0;
  private tipAt = Math.floor(Math.random() * 1000);

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

    const div = (cls: string, parent: HTMLElement): HTMLDivElement => {
      const e = document.createElement('div');
      e.className = cls;
      parent.appendChild(e);
      return e;
    };
    this.ld = div('ld ds-root', this.root);
    this.ld.dataset.dsTheme = 'bfv';
    this.ldPic = div('ld-pic', this.ld);
    div('ld-shade', this.ld);
    div('ld-wordmark', this.ld).textContent = t('title');
    const main = div('ld-main', this.ld);
    this.ldMode = div('ds-label ld-mode', main);
    this.ldName = div('ld-name', main);
    this.ldFacts = div('ld-facts', main);
    const tip = div('ld-tip', main);
    div('ds-label', tip).textContent = t('load.tip');
    this.ldTip = document.createElement('span');
    this.ldTip.className = 'ld-tip-text';
    tip.appendChild(this.ldTip);
    const bottom = div('ld-bottom', this.ld);
    this.ldStep = div('ld-step', bottom);
    this.ldPct = div('ld-pct ds-num', bottom);
    this.ldBar = div('ds-progress ld-bar', bottom);
    parent.appendChild(this.root);
  }

  /** The match on the loading screen: mode, map name, facts and the map from above. */
  setLoadingInfo(info: LoadingInfo): void {
    this.ldMode.textContent = info.mode;
    this.ldName.textContent = info.name;
    this.ldFacts.textContent = info.facts;
    this.ldPic.replaceChildren();
    if (info.picture) this.ldPic.appendChild(info.picture);
    this.ld.classList.add('has-info');
  }

  /** The next tip (they rotate while loading; the timer simply waits out the long steps). */
  private nextTip(): void {
    const touch = isTouchDevice();
    const list = TIPS.filter((tp) => !tp.keys || !touch);
    this.ldTip.textContent = t(list[this.tipAt++ % list.length]!.key);
  }

  private stopTips(): void {
    window.clearInterval(this.tipTimer);
    this.tipTimer = 0;
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
    const p = Math.max(0, Math.min(1, fraction));
    this.fillEl.style.setProperty('--p', p.toFixed(3));
    this.subEl.textContent = step;
    this.subEl.style.display = '';
    this.ldBar.style.setProperty('--p', p.toFixed(3));
    this.ldStep.textContent = step;
    this.ldPct.textContent = `${Math.round(p * 100)}%`;
    if (!this.tipTimer) {
      this.nextTip();
      this.tipTimer = window.setInterval(() => this.nextTip(), TIP_EVERY_MS);
    }
  }

  show(title: string, sub = '', hint = '', kind: OverlayKind = 'info'): void {
    this.stopTips();
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
    this.stopTips();
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
