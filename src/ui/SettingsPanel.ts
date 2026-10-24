import { setLocale, t, type MessageKey } from '@/i18n';
import { resolveQuality, saveSettings, type Settings, detectTouch } from '@/core/Settings';
import { RESERVED, bind, bindings, commitBindings, conflicts, keyName, resetBindings, type Action } from '@/input/bindings';
import { uiSound } from '@/audio/uiSounds';
import './settingsPanel.css';

type Category = 'controls' | 'keys' | 'video' | 'audio';

/** The key rows, in groups. */
const KEY_GROUPS: [MessageKey, Action[]][] = [
  ['keys.g.move', ['forward', 'back', 'left', 'right', 'sprint', 'jump', 'crouch']],
  ['keys.g.combat', ['fire', 'ads', 'reload', 'melee', 'grenade', 'breath', 'inspect']],
  ['keys.g.kit', ['interact', 'medkit', 'build', 'support', 'view', 'scoreboard', 'chat', 'teamChat']],
  ['keys.g.slots', ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8', 'slot9']],
];

export interface SettingsPanelOptions {
  /** In a match: quality and language only take effect on the next load (said under them). */
  live: boolean;
  /** After a change (already saved). */
  onChange?: (key: keyof Settings) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

let autoQuality: string | null = null;

const CATEGORIES: readonly Category[] = ['controls', 'keys', 'video', 'audio'];
const catName = (c: Category): MessageKey => (c === 'audio' ? 'lobby.audioLang' : (`lobby.${c}` as MessageKey));

/**
 * The settings on the design system (settingsPanel.css; needs a `ds-root`
 * around it): categories as tabs, the picked one's rows on the left, the row
 * under the pointer named and explained on the right. Edits the given settings
 * object in place and saves on every change; the lobby and the pause screen
 * both use it.
 */
export class SettingsPanel {
  readonly root: HTMLDivElement;
  private cat: Category = 'controls';
  private desc!: HTMLDivElement;
  private descTitle!: HTMLDivElement;
  private descText!: HTMLDivElement;
  /** The key slot waiting for a key press. */
  private capture: { action: Action; slot: number } | null = null;
  /** Said at the bottom after the last key change (a refused key). */
  private keyNote = '';

  constructor(
    private readonly s: Settings,
    private readonly opts: SettingsPanelOptions,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'sp';
    // Clicks in here never reach a pause screen behind (which would resume).
    this.root.addEventListener('click', (e) => e.stopPropagation());
    this.render();
  }

  render(): void {
    this.root.replaceChildren();
    const cats = el('div', 'ds-tabs sp-cats', this.root);
    for (const c of CATEGORIES) {
      const b = el('button', `ds-tab${c === this.cat ? ' sel' : ''}`, cats);
      b.type = 'button';
      b.textContent = t(catName(c));
      b.addEventListener('pointerenter', () => uiSound('hover'));
      b.addEventListener('click', () => this.pickCategory(c));
    }
    const main = el('div', 'sp-main', this.root);
    const rows = el('div', 'sp-rows', main);
    this.desc = el('div', 'sp-desc', main);
    this.descTitle = el('div', 'sp-desc-title', this.desc);
    this.descText = el('div', 'sp-desc-text', this.desc);
    this.describe(t(catName(this.cat)), t('settings.hint'));
    if (this.cat === 'controls') {
      this.slider(rows, 'lobby.sensitivity', 'sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2));
      this.slider(rows, 'lobby.adsSensitivity', 'adsSensitivity', 0.3, 1.5, 0.05, (v) => v.toFixed(2));
      this.toggle(rows, 'lobby.invertY', 'invertY');
      this.toggle(rows, 'lobby.crouchHold', 'crouchHold', ['lobby.crouchToggle', 'lobby.crouchHeld']);
      const guess = t(detectTouch() ? 'lobby.input.touch' : 'lobby.input.desktop');
      this.choice(rows, 'lobby.inputMode', 'inputMode', ['auto', 'desktop', 'touch'] as const, (v) => (v === 'auto' ? `${t('lobby.input.auto')} (${guess})` : t(`lobby.input.${v}` as MessageKey)));
    } else if (this.cat === 'keys') {
      this.keyRows(rows);
    } else if (this.cat === 'video') {
      this.slider(rows, 'lobby.fov', 'fov', 60, 100, 1, (v) => `${Math.round(v)}°`);
      this.slider(rows, 'lobby.renderScale', 'renderScale', 0.5, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
      // What auto picks needs the GPU's name (a throwaway WebGL context): asked once.
      autoQuality ??= resolveQuality('auto');
      const auto = t(`lobby.q.${autoQuality}` as MessageKey);
      this.choice(rows, 'lobby.quality', 'quality', ['auto', 'low', 'medium', 'high'] as const, (v) => (v === 'auto' ? `${t('lobby.q.auto')} (${auto})` : t(`lobby.q.${v}` as MessageKey)));
      this.toggle(rows, 'lobby.showFps', 'showFps');
      this.choice(rows, 'lobby.progressNotices', 'progressNotices', ['all', 'levels', 'off'] as const, (v) => t(v === 'off' ? 'lobby.off' : (`lobby.pn.${v}` as MessageKey)));
      if (!this.opts.live) this.toggle(rows, 'lobby.menuScene', 'menuScene');
    } else {
      this.slider(rows, 'lobby.volume', 'masterVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
      this.slider(rows, 'lobby.voiceVolume', 'voiceVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
      this.slider(rows, 'lobby.musicVolume', 'musicVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
      this.toggle(rows, 'lobby.subtitles', 'subtitles');
      this.choice(rows, 'lobby.language', 'locale', ['ko', 'en'] as const, (v) => (v === 'ko' ? '한국어' : 'English'));
    }
  }

  /** Q / E from the page around it: the category before / after. */
  stepCategory(dir: -1 | 1): void {
    const i = CATEGORIES.indexOf(this.cat);
    const next = CATEGORIES[Math.max(0, Math.min(CATEGORIES.length - 1, i + dir))]!;
    if (next !== this.cat) this.pickCategory(next);
  }

  /** Waiting for a key to bind (the page around it leaves keys alone then). */
  get capturing(): boolean {
    return !!this.capture;
  }

  private pickCategory(c: Category): void {
    this.stopCapture();
    if (c !== this.cat) uiSound('move');
    this.cat = c;
    this.render();
  }

  /** The right column: what the row under the pointer is and does. */
  private describe(title: string, text: string, warn = false): void {
    this.descTitle.textContent = title;
    this.descText.textContent = text;
    this.desc.classList.toggle('warn', warn);
  }

  private set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.s[key] = value;
    saveSettings(this.s);
    if (key === 'locale' && !this.opts.live) setLocale(value as Settings['locale']);
    this.opts.onChange?.(key);
  }

  /** A row: the label, the control, and its description at the bottom while the pointer is on it. */
  private row(parent: HTMLElement, label: MessageKey, key: keyof Settings): HTMLDivElement {
    const r = el('div', 'sp-row', parent);
    el('div', 'sp-label', r).textContent = t(label);
    const ctl = el('div', 'sp-ctl', r);
    const later = this.opts.live && (key === 'quality' || key === 'locale' || key === 'inputMode');
    const text = t(`setDesc.${key}` as MessageKey) + (later ? ` ${t('settings.nextMatch')}` : '');
    r.addEventListener('pointerenter', () => this.describe(t(label), text));
    if (later) r.classList.add('later');
    return ctl;
  }

  private slider(parent: HTMLElement, label: MessageKey, key: 'sensitivity' | 'adsSensitivity' | 'fov' | 'masterVolume' | 'voiceVolume' | 'musicVolume' | 'renderScale', min: number, max: number, step: number, show: (v: number) => string): void {
    const ctl = this.row(parent, label, key);
    const input = el('input', 'ds-slider sp-range', ctl);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(this.s[key]);
    const fill = (v: number) => input.style.setProperty('--p', `${(((v - min) / (max - min)) * 100).toFixed(1)}%`);
    fill(this.s[key]);
    const out = el('span', 'sp-val ds-num', ctl);
    out.textContent = show(this.s[key]);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = show(v);
      fill(v);
      this.set(key, v);
    });
  }

  private choice<K extends 'quality' | 'locale' | 'progressNotices' | 'inputMode', V extends Settings[K]>(parent: HTMLElement, label: MessageKey, key: K, values: readonly V[], name: (v: V) => string): void {
    const seg = el('div', 'ds-seg sp-seg', this.row(parent, label, key));
    for (const v of values) {
      const b = el('button', v === this.s[key] ? 'sel' : '', seg);
      b.type = 'button';
      b.textContent = name(v);
      b.addEventListener('click', () => {
        if (v !== this.s[key]) uiSound('select');
        this.set(key, v);
        if (key === 'locale' && !this.opts.live) return; // the lobby redraws itself in the new language
        this.render();
      });
    }
  }

  /** Two choices, off / on (or named by `names`). */
  private toggle(parent: HTMLElement, label: MessageKey, key: 'invertY' | 'showFps' | 'crouchHold' | 'menuScene' | 'subtitles', names: [MessageKey, MessageKey] = ['lobby.off', 'lobby.on']): void {
    const seg = el('div', 'ds-seg sp-seg', this.row(parent, label, key));
    for (const on of [false, true]) {
      const b = el('button', on === this.s[key] ? 'sel' : '', seg);
      b.type = 'button';
      b.textContent = t(names[on ? 1 : 0]);
      b.addEventListener('click', () => {
        if (on !== this.s[key]) uiSound('select');
        this.set(key, on);
        this.render();
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Key bindings: a row an action with its two keys; click one, then press a key
  // or a mouse button (Esc: cancel, Backspace: clear). Shared keys show in red.

  private keyRows(rows: HTMLElement): void {
    rows.classList.add('sp-keys');
    const b = bindings();
    const clash = conflicts(b);
    const names = (acts: Action[]) => acts.map((a) => this.actionName(a)).join(', ');
    const clashText = (a: Action): string =>
      b[a]
        .filter((c) => clash.get(c)?.includes(a))
        .map((c) =>
          t('keys.conflict')
            .replace('{key}', keyName(c))
            .replace('{names}', names(clash.get(c)!.filter((o) => o !== a))),
        )
        .join(' · ');
    this.describe(t('lobby.keys'), this.keyNote || (clash.size ? t('keys.conflicts') : t('keys.hint')), clash.size > 0 || !!this.keyNote);
    for (const [head, actions] of KEY_GROUPS) {
      el('div', 'ds-label sp-group', rows).textContent = t(head);
      for (const a of actions) {
        const bad = clashText(a);
        const r = el('div', `sp-row sp-keyrow${bad ? ' clash' : ''}`, rows);
        el('div', 'sp-label', r).textContent = this.actionName(a);
        const ctl = el('div', 'sp-ctl', r);
        for (let slot = 0; slot < 2; slot++) {
          const code = b[a][slot];
          const waiting = this.capture?.action === a && this.capture.slot === slot;
          const k = el('button', `sp-key${waiting ? ' waiting' : ''}${code && clash.get(code)?.includes(a) ? ' clash' : ''}${code ? '' : ' empty'}`, ctl);
          k.type = 'button';
          k.textContent = waiting ? t('keys.press') : code ? keyName(code) : '—';
          k.addEventListener('click', () => this.startCapture(a, Math.min(slot, b[a].length)));
        }
        const about = a === 'crouch' ? t('keys.crouchDesc') : a === 'view' ? t('keys.viewDesc') : a.startsWith('slot') ? t('keys.slotDesc') : t('keys.hint');
        // A refused key's note stays until the next binding; shared keys are said on every row.
        r.addEventListener('pointerenter', () =>
          this.describe(this.actionName(a), this.keyNote || (bad ? `${bad}. ${about}` : clash.size ? `${t('keys.conflicts')} ${about}` : about), !!this.keyNote || !!bad || clash.size > 0),
        );
      }
    }
    const reset = el('button', 'ds-btn ghost sp-reset', rows);
    reset.type = 'button';
    reset.textContent = t('keys.reset');
    reset.addEventListener('click', () => {
      this.stopCapture();
      resetBindings();
      this.keyNote = '';
      this.render();
    });
  }

  private actionName(a: Action): string {
    const slot = /^slot(\d)$/.exec(a);
    return slot ? t('keys.slot').replace('{n}', slot[1]!) : t(`keys.${a}` as MessageKey);
  }

  private startCapture(action: Action, slot: number): void {
    this.stopCapture();
    this.capture = { action, slot };
    this.keyNote = '';
    window.addEventListener('keydown', this.onCaptureKey, true);
    window.addEventListener('mousedown', this.onCaptureMouse, true);
    this.render();
  }

  private stopCapture(): void {
    if (!this.capture) return;
    this.capture = null;
    window.removeEventListener('keydown', this.onCaptureKey, true);
    window.removeEventListener('mousedown', this.onCaptureMouse, true);
  }

  private finishCapture(code: string | null): void {
    const c = this.capture;
    this.stopCapture();
    if (c) {
      bind(bindings(), c.action, c.slot, code);
      commitBindings();
    }
    this.render();
  }

  /** Takes the key before the game, the pause screen or the menu see it. */
  private onCaptureKey = (e: KeyboardEvent): void => {
    // The panel was closed while waiting: nothing to bind.
    if (!this.root.isConnected) return this.stopCapture();
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      this.stopCapture();
      this.render();
    } else if (e.code === 'Backspace' || e.code === 'Delete') this.finishCapture(null);
    else if (RESERVED.has(e.code) || !e.code) {
      this.keyNote = t('keys.reserved').replace('{key}', e.code ? keyName(e.code) : e.key);
      this.stopCapture();
      this.render();
    } else this.finishCapture(e.code);
  };

  /** A mouse button binds too; its click and context menu go nowhere else. */
  private onCaptureMouse = (e: MouseEvent): void => {
    if (!this.root.isConnected) return this.stopCapture();
    e.preventDefault();
    e.stopImmediatePropagation();
    // What this button sends after its mousedown (left: click, right: context menu, others: auxclick) goes nowhere.
    const after = e.button === 0 ? ['click'] : e.button === 2 ? ['contextmenu', 'auxclick'] : ['auxclick'];
    const swallow = (ev: Event) => {
      if ((ev as MouseEvent).button !== e.button) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    for (const type of after) window.addEventListener(type, swallow, true);
    // Until the button comes up (and a little after): the events follow mouseup.
    setTimeout(() => after.forEach((type) => window.removeEventListener(type, swallow, true)), 1000);
    this.finishCapture(`Mouse${e.button}`);
  };
}
