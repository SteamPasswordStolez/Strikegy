import { t, type MessageKey } from '@/i18n';
import { SUPPORT, SUPPORT_ORDER, type SupportId } from '@/data/support';

export interface SupportMenuState {
  /** The squad's RP. */
  rp: number;
  /** Seconds left on each kind's team cooldown. */
  cooldown: Record<SupportId, number>;
  /** The kind being aimed, if any. */
  aiming: SupportId | null;
}

/**
 * The squad leader's call-in menu (B): the five call-ins with cost and
 * cooldown, picked with 1..5 or a tap. Only touches the DOM when shown
 * values change.
 */
export class SupportMenu {
  private readonly root: HTMLDivElement;
  private readonly head: HTMLDivElement;
  private readonly rows = new Map<SupportId, { el: HTMLButtonElement; state: HTMLSpanElement }>();
  private last = '';
  open = false;

  constructor(parent: HTMLElement, onPick: (id: SupportId) => void) {
    this.root = document.createElement('div');
    this.root.className = 'support-menu';
    this.head = document.createElement('div');
    this.head.className = 'support-head';
    this.root.appendChild(this.head);
    SUPPORT_ORDER.forEach((id, i) => {
      const el = document.createElement('button');
      el.className = 'support-row';
      el.innerHTML = `<span class="support-key">${i + 1}</span><span class="support-name">${t(`support.${id}` as MessageKey)}</span><span class="support-cost">${SUPPORT[id].cost} RP</span>`;
      const state = document.createElement('span');
      state.className = 'support-state';
      el.appendChild(state);
      const pick = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        onPick(id);
      };
      el.addEventListener('click', pick);
      el.addEventListener('touchstart', pick, { passive: false });
      this.root.appendChild(el);
      this.rows.set(id, { el, state });
    });
    parent.appendChild(this.root);
  }

  /** Can `id` be called now? */
  static ready(s: SupportMenuState, id: SupportId): boolean {
    return s.rp >= SUPPORT[id].cost && s.cooldown[id] <= 0;
  }

  update(s: SupportMenuState | null): void {
    const show = this.open && !!s;
    this.root.classList.toggle('show', show);
    if (!show) return;
    const key = `${s.rp}:${SUPPORT_ORDER.map((id) => Math.ceil(s.cooldown[id])).join(',')}:${s.aiming}`;
    if (key === this.last) return;
    this.last = key;
    this.head.textContent = `${t('support.title')} · ${t('support.rp')} ${s.rp}`;
    for (const id of SUPPORT_ORDER) {
      const r = this.rows.get(id)!;
      const cd = s.cooldown[id];
      r.el.classList.toggle('off', !SupportMenu.ready(s, id));
      r.el.classList.toggle('on', s.aiming === id);
      r.state.textContent = cd > 0 ? `${Math.ceil(cd)}s` : s.rp < SUPPORT[id].cost ? t('support.short') : '';
    }
  }
}
