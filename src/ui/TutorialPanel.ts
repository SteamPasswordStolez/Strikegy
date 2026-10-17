import { t, type MessageKey } from '@/i18n';
import { actionKey, bindingsVersion } from '@/input/bindings';
import type { TutorialRun } from '@/core/tutorial';
import { icon } from './icons';
import './ds.css';
import './hud.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

/**
 * The tutorial's card (hud.css; its own `ds-root`): "Tutorial 3/11", the
 * step's keys (desktop) and what to do, a bar while it fills, green when
 * done. Right under the kill feed in a match, in the head of the deploy
 * screen. Skipping: Esc and the pause menu on a desktop, the close button on
 * a touch screen.
 */
export class TutorialPanel {
  readonly root: HTMLDivElement;
  private readonly head: HTMLDivElement;
  private readonly keys: HTMLDivElement;
  private readonly text: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private drawn = '';

  constructor(
    parent: HTMLElement,
    private readonly touch: boolean,
    onSkip: () => void,
  ) {
    this.root = el('div', 'tut ds-root', parent);
    this.root.dataset.dsTheme = 'bfv';
    const top = el('div', 'tut-top', this.root);
    this.head = el('div', 'tut-head', top);
    if (touch) {
      const x = el('button', 'tut-skip', top);
      x.innerHTML = icon('close');
      x.title = t('tut.skip');
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        onSkip();
      });
      x.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    } else el('div', 'tut-skiphint', top).textContent = t('tut.skipHint');
    const body = el('div', 'tut-body', this.root);
    this.keys = el('div', 'tut-keys', body);
    this.text = el('div', 'tut-text', body);
    this.fill = el('div', 'tut-fill', el('div', 'tut-track', this.root));
  }

  /**
   * Draws the run's step (`ended`: the closing line instead); hidden when
   * `show` is false (dead, menus) or there is nothing to show.
   */
  update(run: TutorialRun | null, show: boolean, deploying: boolean, ended: boolean): void {
    const step = run?.current ?? null;
    const on = show && (ended || !!step);
    this.root.classList.toggle('on', on);
    this.root.classList.toggle('at-deploy', deploying);
    if (!on) return;
    this.fill.style.width = `${Math.round((ended ? 1 : run!.progress) * 100)}%`;
    const done = ended || run!.doneLeft > 0;
    this.root.classList.toggle('done', done);
    const id = ended ? 'end' : `${step!.id}:${run!.index}`;
    const key = `${id}|${bindingsVersion()}`;
    if (key === this.drawn) return;
    this.drawn = key;
    this.keys.replaceChildren();
    if (ended) {
      this.head.textContent = t('tut.title');
      this.text.textContent = t('tut.done');
      return;
    }
    this.head.textContent = `${t('tut.title')} ${run!.index + 1}/${run!.steps.length}`;
    if (!this.touch) for (const a of step!.keys) el('span', 'ds-kbd', this.keys).textContent = actionKey(a) || '—';
    const touchText = `tut.${step!.id}Touch` as MessageKey;
    this.text.textContent = this.touch && t(touchText) !== touchText ? t(touchText) : t(`tut.${step!.id}` as MessageKey);
  }
}
