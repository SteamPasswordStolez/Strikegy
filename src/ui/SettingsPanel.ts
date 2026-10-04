import { setLocale, t, type MessageKey } from '@/i18n';
import { resolveQuality, saveSettings, type Settings } from '@/core/Settings';

type Category = 'controls' | 'video' | 'audio';

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

/**
 * The settings, Modern Warfare style: categories in a column on the left, the
 * rows of the picked one on the right, what the row under the pointer does at
 * the bottom. Edits the given settings object in place and saves on every
 * change; the lobby and the pause screen both use it.
 */
export class SettingsPanel {
  readonly root: HTMLDivElement;
  private cat: Category = 'controls';
  private desc!: HTMLDivElement;

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
    const cats = el('div', 'sp-cats', this.root);
    for (const c of ['controls', 'video', 'audio'] as const) {
      const b = el('button', `sp-cat${c === this.cat ? ' sel' : ''}`, cats);
      b.textContent = t(c === 'audio' ? 'lobby.audioLang' : (`lobby.${c}` as MessageKey));
      b.addEventListener('click', () => {
        this.cat = c;
        this.render();
      });
    }
    const main = el('div', 'sp-main', this.root);
    const rows = el('div', 'sp-rows', main);
    this.desc = el('div', 'sp-desc', main);
    this.desc.textContent = t('settings.hint');
    if (this.cat === 'controls') {
      this.slider(rows, 'lobby.sensitivity', 'sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2));
      this.slider(rows, 'lobby.adsSensitivity', 'adsSensitivity', 0.3, 1.5, 0.05, (v) => v.toFixed(2));
      this.toggle(rows, 'lobby.invertY', 'invertY');
    } else if (this.cat === 'video') {
      this.slider(rows, 'lobby.fov', 'fov', 60, 100, 1, (v) => `${Math.round(v)}°`);
      // What auto picks needs the GPU's name (a throwaway WebGL context): asked once.
      autoQuality ??= resolveQuality('auto');
      const auto = t(`lobby.q.${autoQuality}` as MessageKey);
      this.choice(rows, 'lobby.quality', 'quality', ['auto', 'low', 'medium', 'high'] as const, (v) => (v === 'auto' ? `${t('lobby.q.auto')} (${auto})` : t(`lobby.q.${v}` as MessageKey)));
      this.toggle(rows, 'lobby.showFps', 'showFps');
    } else {
      this.slider(rows, 'lobby.volume', 'masterVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
      this.choice(rows, 'lobby.language', 'locale', ['ko', 'en'] as const, (v) => (v === 'ko' ? '한국어' : 'English'));
    }
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
    const later = this.opts.live && (key === 'quality' || key === 'locale');
    const text = t(`setDesc.${key}` as MessageKey) + (later ? ` ${t('settings.nextMatch')}` : '');
    r.addEventListener('pointerenter', () => (this.desc.textContent = text));
    if (later) r.classList.add('later');
    return ctl;
  }

  private slider(parent: HTMLElement, label: MessageKey, key: 'sensitivity' | 'adsSensitivity' | 'fov' | 'masterVolume', min: number, max: number, step: number, show: (v: number) => string): void {
    const ctl = this.row(parent, label, key);
    const input = el('input', 'sp-range', ctl);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(this.s[key]);
    const out = el('span', 'sp-val', ctl);
    out.textContent = show(this.s[key]);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = show(v);
      this.set(key, v);
    });
  }

  private choice<K extends 'quality' | 'locale', V extends Settings[K]>(parent: HTMLElement, label: MessageKey, key: K, values: readonly V[], name: (v: V) => string): void {
    const seg = el('div', 'sp-seg', this.row(parent, label, key));
    for (const v of values) {
      const b = el('button', `sp-opt${v === this.s[key] ? ' sel' : ''}`, seg);
      b.textContent = name(v);
      b.addEventListener('click', () => {
        this.set(key, v);
        if (key === 'locale' && !this.opts.live) return; // the lobby redraws itself in the new language
        this.render();
      });
    }
  }

  private toggle(parent: HTMLElement, label: MessageKey, key: 'invertY' | 'showFps'): void {
    const seg = el('div', 'sp-seg', this.row(parent, label, key));
    for (const on of [false, true]) {
      const b = el('button', `sp-opt${on === this.s[key] ? ' sel' : ''}`, seg);
      b.textContent = t(on ? 'lobby.on' : 'lobby.off');
      b.addEventListener('click', () => {
        this.set(key, on);
        this.render();
      });
    }
  }
}
