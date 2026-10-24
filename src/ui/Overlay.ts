import { t, type MessageKey } from '@/i18n';
import { isTouchDevice } from '@/core/Settings';
import { uiSound } from '@/audio/uiSounds';
import './ds.css';
import './loading.css';
import './result.css';
import './pause.css';
import './dialogs.css';
import './progress.css';
import { levelOf, type RankId } from '@/progression/levels';
import type { MatchSummary } from '@/progression/profile';
import { insigniaAt, rankLabel, rankName, rankTitle } from './rankInsignia';

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

/** The result screen's XP block: what the match was worth and where it took the level. */
export interface ResultProgress {
  summary: MatchSummary;
  beforeXp: number;
  afterXp: number;
  promotions: RankId[];
}

/** What the result screen shows (Game fills it when a match ends). */
export interface ResultInfo {
  won: boolean;
  /** "Iron Gate · Zone". */
  context: string;
  title: string;
  /** Why it ended and the score. */
  line: string;
  /** The player's own numbers. */
  stats: { label: string; value: string }[];
  /** "#3 of 12 on your side". */
  place?: string;
  /** The match's top scorer. */
  mvp?: string;
  /** The final standings (the scoreboard in its final mode), if any. */
  board?: HTMLElement | null;
  /** First = Enter (the main one), second = Esc. */
  actions: OverlayAction[];
  /** The match's XP, confirmed (progression), if it counted. */
  progress?: ResultProgress;
}

/** What the pause menu shows (Game fills it on every pause). */
export interface PauseInfo {
  /** "Iron Gate · Zone". */
  context: string;
  title: string;
  /** The entries, top down; `selected` marks the one whose view is open. */
  entries: OverlayAction[];
  /** The open view on the right (the controls or the settings), if any. */
  view: HTMLElement | null;
  /** Keys for the view first (true = taken), e.g. Q / E for the settings' tabs. */
  viewKeys?: (e: KeyboardEvent) => boolean;
  /** The view wants every key for now (binding a key): the menu leaves them alone. */
  busy?: () => boolean;
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
 * How the full-screen layer is dressed: the pause menu (a column of entries
 * beside the controls or the settings), a match result (won / lost), or a
 * message (loading, errors, connection lost) in a dialog.
 */
export type OverlayKind = 'pause' | 'win' | 'loss' | 'info';

/** A button on the overlay (back to the lobby, play again, reconnect; the pause menu's entries). */
export interface OverlayAction {
  label: string;
  primary?: boolean;
  /** The pause menu's open entry (drawn inverted). */
  selected?: boolean;
  onClick: () => void;
}

/** Full-screen layer for the loading, pause, result and message (error, connection lost) screens. */
export class Overlay {
  readonly root: HTMLDivElement;
  private shown: OverlayKind = 'info';
  /** A message (kind `info`, design system, dialogs.css): context, title, line and buttons. */
  private readonly msg: HTMLDivElement;
  private readonly msgContext: HTMLDivElement;
  private readonly msgTitle: HTMLHeadingElement;
  private readonly msgLine: HTMLParagraphElement;
  private readonly msgActions: HTMLDivElement;
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
  /** The result screen (design system): shown while the root has `.result`. */
  private readonly rs: HTMLDivElement;
  /** Enter / Esc on the result screen's or a message's buttons. */
  private actionKeys: ((e: KeyboardEvent) => void) | null = null;
  private readonly ps: HTMLDivElement;
  private pauseKeys: ((e: KeyboardEvent) => void) | null = null;
  /** The pause entry the keys are on. */
  private pauseFocus = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'overlay kind-info';

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
    this.rs = div('rs ds-root', this.root);
    this.rs.dataset.dsTheme = 'bfv';
    this.ps = div('ps ds-root', this.root);
    this.ps.dataset.dsTheme = 'bfv';
    this.msg = div('ovd ds-root', this.root);
    this.msg.dataset.dsTheme = 'bfv';
    const box = div('ds-dialog ovd-box', this.msg);
    this.msgContext = div('ds-label ovd-context', box);
    this.msgTitle = document.createElement('h3');
    this.msgLine = document.createElement('p');
    this.msgActions = document.createElement('div');
    this.msgActions.className = 'ds-actions';
    box.append(this.msgTitle, this.msgLine, this.msgActions);
    parent.appendChild(this.root);
  }

  /**
   * The pause menu on the design system (pause.css): the entries in a column
   * on the left (↑ ↓ Enter), the open view (controls or settings) on the
   * right. Call after `show(..., 'pause')`; every pause redraws it.
   */
  setPause(p: PauseInfo): void {
    this.stopPauseKeys();
    const ps = this.ps;
    ps.replaceChildren();
    const div = (cls: string, parent: HTMLElement, text?: string): HTMLDivElement => {
      const e = document.createElement('div');
      e.className = cls;
      if (text !== undefined) e.textContent = text;
      parent.appendChild(e);
      return e;
    };
    const touch = isTouchDevice();
    const side = div('ps-side', ps);
    div('ds-label ps-context', side, p.context);
    div('ps-title', side, p.title);
    const list = div('ds-menu ps-menu', side);
    const items: HTMLButtonElement[] = [];
    const sel = p.entries.findIndex((a) => a.selected);
    this.pauseFocus = Math.max(0, sel);
    const focus = (i: number) => {
      this.pauseFocus = i;
      items.forEach((b, k) => b.classList.toggle('focus', k === i));
    };
    p.entries.forEach((a, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ds-menu-item ps-item${a.selected ? ' sel' : ''}${a.primary ? ' danger' : ''}`;
      b.textContent = a.label;
      b.addEventListener('pointerenter', () => {
        if (this.pauseFocus !== i) uiSound('hover');
        focus(i);
      });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        uiSound(a.selected ? 'back' : 'select');
        a.onClick();
      });
      list.appendChild(b);
      items.push(b);
    });
    focus(this.pauseFocus);
    if (!touch) {
      const foot = div('ps-foot', side);
      const hint = (keys: string[], what: string) => {
        const h = div('ds-hint', foot);
        for (const k of keys) {
          const cap = document.createElement('span');
          cap.className = 'ds-kbd';
          cap.textContent = k;
          h.appendChild(cap);
        }
        const w = document.createElement('span');
        w.textContent = what;
        h.appendChild(w);
      };
      hint(['↑', '↓'], t('lobby.hint.move'));
      hint(['ENTER'], t('lobby.hint.select'));
      hint(['ESC'], t('pause.resume'));
    }
    const view = div('ps-view', ps);
    if (p.view) view.appendChild(p.view);
    else view.classList.add('empty');

    this.pauseKeys = (e: KeyboardEvent) => {
      if (!this.visible || this.shown !== 'pause' || p.busy?.()) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable]')) return;
      if (p.viewKeys?.(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const n = items.length;
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        const next = Math.max(0, Math.min(n - 1, this.pauseFocus + (e.code === 'ArrowUp' ? -1 : 1)));
        if (next !== this.pauseFocus) uiSound('move');
        focus(next);
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') items[this.pauseFocus]?.click();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', this.pauseKeys, { capture: true });
  }

  private stopPauseKeys(): void {
    if (!this.pauseKeys) return;
    window.removeEventListener('keydown', this.pauseKeys, { capture: true });
    this.pauseKeys = null;
  }

  /**
   * The match result on the design system (owner, 2026-10-17; result.css):
   * won or lost in big type with the side's colour, why and the score, the
   * player's own numbers and place, the final standings, and the buttons
   * (Enter the first, Esc the second). Call after `show(..., 'win' | 'loss')`.
   */
  setResult(r: ResultInfo): void {
    const rs = this.rs;
    rs.replaceChildren();
    rs.classList.toggle('won', r.won);
    rs.classList.toggle('lost', !r.won);
    const div = (cls: string, parent: HTMLElement, text?: string): HTMLDivElement => {
      const e = document.createElement('div');
      e.className = cls;
      if (text !== undefined) e.textContent = text;
      parent.appendChild(e);
      return e;
    };
    // The map from the loading screen, faint behind it all.
    const pic = div('rs-pic', rs);
    const canvas = this.ldPic.querySelector('canvas');
    if (canvas) pic.appendChild(canvas);
    div('rs-shade', rs);

    const head = div('rs-head', rs);
    div('ds-label', head, r.context);
    div('rs-title', head, r.title);
    div('rs-line', head, r.line);

    const mine = div('rs-mine', rs);
    div('ds-label rs-mine-label', mine, t('result.yours'));
    const tiles = div('rs-tiles', mine);
    for (const s of r.stats) {
      const tile = div('rs-tile', tiles);
      div('ds-label', tile, s.label);
      div('ds-num rs-tile-num', tile, s.value);
    }
    if (r.place || r.mvp) {
      const facts = div('rs-facts', mine);
      if (r.place) div('rs-place', facts, r.place);
      if (r.mvp) {
        const m = div('rs-mvp', facts);
        div('ds-label', m, t('result.mvp'));
        div('rs-mvp-name', m, r.mvp);
      }
    }

    const board = div('rs-board', rs);
    // The match's XP over the standings (the wide column has the room).
    if (r.progress) this.resultXp(board, r.progress);
    if (r.board) {
      div('ds-label rs-board-label', board, t('result.board'));
      board.appendChild(r.board);
    }

    this.buttons(div('rs-foot', rs), r.actions, 'start');
    this.root.classList.add('result');
  }

  /**
   * The match's XP: each part and the multipliers, the sum, then the level bar
   * filling from where the match started to where it ended (levels popping on
   * the way; a click skips to the end) and the promotion, if there was one.
   */
  private resultXp(parent: HTMLElement, p: ResultProgress): void {
    this.stopXpAnim();
    const div = (cls: string, at: HTMLElement, text?: string): HTMLDivElement => {
      const e = document.createElement('div');
      e.className = cls;
      if (text !== undefined) e.textContent = text;
      at.appendChild(e);
      return e;
    };
    const s = p.summary;
    const box = div('rs-xp', parent);
    div('ds-label', box, t('result.xp'));
    if (s.result === 'idle') {
      div('rs-xp-note warn', box, t('result.idle'));
      return;
    }
    const lines = div('rs-xp-lines', box);
    const n = (v: number) => Math.round(v).toLocaleString();
    for (const l of s.lines) {
      div('', lines, t(`xpLine.${l.key}` as MessageKey));
      div('ds-num', lines, n(l.base));
    }
    for (const m of s.mult) {
      div('x', lines, t(`mult.${m.key}` as MessageKey));
      div('ds-num x', lines, `×${m.x}`);
    }
    div('sum', lines, t('result.xpTotal'));
    div('sum ds-num', lines, `+${n(s.xp)}`);

    const side = div('rs-xp-side', box);
    const lv = div('rs-lv', side);
    const pic = div('rs-lv-pic', lv);
    const name = div('rs-lv-name', lv);
    const next = div('rs-lv-next', lv);
    const bar = div('rs-lv-bar', lv);
    const fill = document.createElement('i');
    bar.appendChild(fill);
    let shown = -1;
    const draw = (xp: number) => {
      const at = levelOf(xp);
      if (at.level !== shown) {
        if (shown > 0) {
          lv.classList.remove('up');
          void lv.offsetWidth;
          lv.classList.add('up');
        }
        shown = at.level;
        pic.innerHTML = insigniaAt(at.level);
        name.textContent = rankLabel(at.level);
      }
      fill.style.setProperty('--p', (at.into / at.need).toFixed(4));
      next.textContent = t('result.toNext').replace('{n}', n(at.need - at.into));
    };
    draw(p.beforeXp);
    const promo = p.promotions[p.promotions.length - 1];
    const finish = () => {
      this.stopXpAnim();
      draw(p.afterXp);
      if (promo && !box.querySelector('.rs-promo')) {
        const pr = div('rs-promo', side);
        pr.innerHTML = insigniaAt(levelOf(p.afterXp).level);
        const txt = div('', pr);
        div('rs-promo-title', txt, `${t('prog.promoted')} · ${rankName(levelOf(p.afterXp).level)}`);
        div('rs-promo-text', txt, rankTitle(promo));
      }
      if (!box.querySelector('.rs-xp-note')) div('rs-xp-note', side, t(s.result === 'left' ? 'result.savedLeft' : 'result.saved'));
    };
    // After the rest has come in: about 1.6 s of filling, eased out.
    const t0 = performance.now() + 900;
    const len = 1600;
    const step = (now: number) => {
      const u = Math.min(1, Math.max(0, (now - t0) / len));
      draw(p.beforeXp + (p.afterXp - p.beforeXp) * (1 - (1 - u) ** 3));
      if (u >= 1) finish();
      else this.xpAnim = requestAnimationFrame(step);
    };
    this.xpAnim = requestAnimationFrame(step);
    box.addEventListener('click', finish);
  }
  private xpAnim = 0;

  private stopXpAnim(): void {
    cancelAnimationFrame(this.xpAnim);
    this.xpAnim = 0;
  }

  /**
   * Design-system buttons for `actions`: the first the call to action (Enter),
   * the second quiet (Esc), and those keys work them; nothing else in the
   * game sees Enter / Esc meanwhile.
   */
  private buttons(parent: HTMLElement, actions: readonly OverlayAction[], firstSound: 'start' | 'select'): void {
    this.stopActionKeys();
    parent.replaceChildren();
    const keys = ['ENTER', 'ESC'];
    const sound = (i: number) => uiSound(i === 0 ? firstSound : 'back');
    actions.forEach((a, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ds-btn${i === 0 ? ' primary' : ' ghost'}`;
      const label = document.createElement('span');
      label.textContent = a.label;
      b.appendChild(label);
      if (keys[i] && !isTouchDevice()) {
        const k = document.createElement('span');
        k.className = 'ds-kbd';
        k.textContent = keys[i]!;
        b.appendChild(k);
      }
      b.addEventListener('pointerenter', () => uiSound('hover'));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        sound(i);
        a.onClick();
      });
      parent.appendChild(b);
    });
    if (!actions.length) return;
    this.actionKeys = (e: KeyboardEvent) => {
      const i = e.code === 'Enter' || e.code === 'NumpadEnter' ? 0 : e.code === 'Escape' ? 1 : -1;
      const a = actions[i];
      if (!a) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      sound(i);
      a.onClick();
    };
    window.addEventListener('keydown', this.actionKeys, { capture: true });
  }

  private stopActionKeys(): void {
    if (!this.actionKeys) return;
    window.removeEventListener('keydown', this.actionKeys, { capture: true });
    this.actionKeys = null;
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

  /** The small line over a message's title: map and mode. */
  setContext(text: string): void {
    this.msgContext.textContent = text;
  }

  /**
   * A message's buttons (cleared by every `show`): the first is the call to
   * action on Enter, the second on Esc. A click on one doesn't reach the overlay.
   */
  setActions(actions: readonly OverlayAction[]): void {
    this.buttons(this.msgActions, actions, 'select');
  }

  /** Loading: how far along (0..1) and what it is doing now, under the title (cleared by `show`). */
  setProgress(fraction: number, step: string): void {
    this.root.classList.add('loading');
    const p = Math.max(0, Math.min(1, fraction));
    this.ldBar.style.setProperty('--p', p.toFixed(3));
    this.ldStep.textContent = step;
    this.ldPct.textContent = `${Math.round(p * 100)}%`;
    if (!this.tipTimer) {
      this.nextTip();
      this.tipTimer = window.setInterval(() => this.nextTip(), TIP_EVERY_MS);
    }
  }

  /** Puts the layer up as `kind`; for a message, `title` and `line` are what it says. */
  show(title: string, line = '', kind: OverlayKind = 'info'): void {
    this.stopTips();
    this.stopPauseKeys();
    this.setActions([]);
    this.shown = kind;
    this.root.className = `overlay kind-${kind}`;
    this.msgTitle.textContent = title;
    this.msgLine.textContent = line;
    this.msgLine.hidden = !line;
    document.body.classList.add('overlay-up');
  }

  hide(): void {
    this.stopTips();
    this.stopXpAnim();
    this.stopActionKeys();
    this.stopPauseKeys();
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

/**
 * "Shift sprint" → Shift / sprint; "E(hold) revive" → E / revive (hold): the
 * cap holds the key alone; "Left drag: move" splits at the colon.
 */
function splitKey(item: string, gestures: boolean): { key: string; what: string } {
  const s = item.trim();
  const colon = s.indexOf(': ');
  if (gestures)
    return colon > 0 ? { key: s.slice(0, colon), what: s.slice(colon + 2) } : { key: '', what: s };
  const m = /^([^\s(]+)(?:\s?\(([^)]*)\))?\s+(.+)$/.exec(s);
  if (m && m[1]!.length <= 16) return { key: m[1]!, what: m[2] ? `${m[3]!} (${m[2]})` : m[3]! };
  return { key: '', what: s };
}
