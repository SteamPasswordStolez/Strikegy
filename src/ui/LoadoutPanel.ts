import { t, type MessageKey } from '@/i18n';
import {
  CLASS_IDS,
  GRENADE_COUNT,
  GRENADE_TYPES,
  PISTOLS,
  RECON_ZOOM,
  primariesFor,
  weaponStats,
  zoomedLabel,
  type ClassId,
  type Loadout,
} from '@/data/classes';
import type { LoadoutStore } from '@/data/loadoutStore';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';

const ICON: Record<ClassId, string> = {
  assault: '<path d="M4 17l9-9 3 3-9 9H4z"/><path d="M13 8l3-3 3 3-3 3"/>',
  medic: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  support: '<rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M7 8V5h10v3M8 12v4M12 12v4M16 12v4"/>',
  recon: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
};

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${paths}</svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

type Slot = 'primary0' | 'primary1' | 'pistol' | 'grenade' | 'gadget';

/**
 * BFV-style class and kit picker on the deploy screen: four class buttons,
 * one row per slot; a row opens a list over the map with stat bars. Choices
 * are kept per class and apply on the next deploy.
 */
export class LoadoutPanel {
  readonly root: HTMLDivElement;
  private readonly picker: HTMLDivElement;
  private open: Slot | null = null;

  constructor(
    side: HTMLElement,
    mapBox: HTMLElement,
    private readonly store: LoadoutStore,
    private readonly onChange: (l: Loadout) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'loadout';
    side.prepend(this.root);
    this.picker = el('div', 'loadout-picker', mapBox);
    this.render();
  }

  private get current(): Loadout {
    return this.store.current;
  }

  private setClass(cls: ClassId): void {
    this.store.setClass(cls);
    this.open = null;
    this.changed();
  }

  private update(l: Loadout): void {
    this.store.update(l);
    this.open = null;
    this.changed();
  }

  private changed(): void {
    this.render();
    this.onChange(this.current);
  }

  /** Closes the weapon list (e.g. when the deploy screen hides). */
  close(): void {
    if (!this.open) return;
    this.open = null;
    this.renderPicker();
  }

  private render(): void {
    const l = this.current;
    this.root.replaceChildren();
    el('div', 'deploy-section', this.root).textContent = t('loadout.title');
    const classes = el('div', 'lo-classes', this.root);
    for (const c of CLASS_IDS) {
      const b = el('button', `lo-class${c === l.cls ? ' sel' : ''}`, classes);
      b.innerHTML = svg(ICON[c]);
      el('span', '', b).textContent = t(`class.${c}` as MessageKey);
      b.addEventListener('click', () => this.setClass(c));
    }
    el('div', 'lo-passive', this.root).textContent = t(`class.${l.cls}.passive` as MessageKey);
    const row = (slot: Slot, label: string, value: string, sub = '') => {
      const r = el('button', `lo-row${this.open === slot ? ' open' : ''}`, this.root);
      el('span', 'lo-slot', r).textContent = label;
      el('span', 'lo-value', r).textContent = value;
      if (sub) el('span', 'lo-sub', r).textContent = sub;
      r.addEventListener('click', () => {
        this.open = this.open === slot ? null : slot;
        this.render();
      });
    };
    row('primary0', t('loadout.primary1'), WEAPONS[l.primary[0]].name);
    row('primary1', t('loadout.primary2'), WEAPONS[l.primary[1]].name);
    row('pistol', t('loadout.pistol'), WEAPONS[l.pistol].name);
    row('grenade', t('loadout.grenade'), `${t(`grenade.${l.grenade}` as MessageKey)} ×${GRENADE_COUNT[l.grenade]}`);
    const gadget = l.cls === 'recon' ? t(`gadget.${l.reconGadget}`) : t(`gadget.${l.cls}` as MessageKey);
    row('gadget', t('loadout.gadget'), gadget, t('gadget.soon'));
    this.renderPicker();
  }

  private renderPicker(): void {
    const p = this.picker;
    p.replaceChildren();
    p.classList.toggle('on', !!this.open);
    const slot = this.open;
    if (!slot) return;
    const l = this.current;
    const head = el('div', 'lp-head', p);
    el('span', '', head).textContent =
      slot === 'primary0' ? t('loadout.primary1') : slot === 'primary1' ? t('loadout.primary2') : slot === 'pistol' ? t('loadout.pistol') : slot === 'grenade' ? t('loadout.grenade') : t('loadout.gadget');
    const close = el('button', 'lp-close', head);
    close.textContent = t('loadout.close');
    close.addEventListener('click', () => this.close());
    const list = el('div', 'lp-list', p);

    if (slot === 'grenade') {
      for (const g of GRENADE_TYPES) {
        const b = el('button', `lp-item simple${g === l.grenade ? ' sel' : ''}`, list);
        el('span', 'lp-name', b).textContent = `${t(`grenade.${g}` as MessageKey)} ×${GRENADE_COUNT[g]}`;
        b.addEventListener('click', () => this.update({ ...l, grenade: g }));
      }
      return;
    }
    if (slot === 'gadget') {
      const options = l.cls === 'recon' ? (['beacon', 'mine'] as const) : null;
      if (!options) {
        const b = el('div', 'lp-item simple sel', list);
        el('span', 'lp-name', b).textContent = t(`gadget.${l.cls}` as MessageKey);
        el('span', 'lp-note', b).textContent = t('gadget.soon');
        return;
      }
      for (const g of options) {
        const b = el('button', `lp-item simple${g === l.reconGadget ? ' sel' : ''}`, list);
        el('span', 'lp-name', b).textContent = t(`gadget.${g}`);
        el('span', 'lp-note', b).textContent = t('gadget.soon');
        b.addEventListener('click', () => this.update({ ...l, reconGadget: g }));
      }
      return;
    }

    const ids: readonly WeaponId[] = slot === 'pistol' ? PISTOLS : primariesFor(l.cls);
    const current = slot === 'pistol' ? l.pistol : l.primary[slot === 'primary0' ? 0 : 1];
    const other = slot === 'primary0' ? l.primary[1] : slot === 'primary1' ? l.primary[0] : null;
    let group = '';
    for (const id of ids) {
      const w = WEAPONS[id];
      if (w.class !== group) {
        group = w.class;
        el('div', 'lp-group', list).textContent = t(`wclass.${w.class}` as MessageKey);
      }
      const b = el('button', `lp-item${id === current ? ' sel' : ''}${id === other ? ' taken' : ''}`, list);
      b.disabled = id === other;
      const top = el('div', 'lp-top', b);
      el('span', 'lp-name', top).textContent = w.name;
      const scope = w.scope ? (l.cls === 'recon' ? `${w.scope}→${zoomedLabel(w.scope, RECON_ZOOM)}` : w.scope) : '';
      el('span', 'lp-note', top).textContent = id === other ? t('loadout.inUse') : [scope, `${t('stat.mag')} ${w.magSize}`].filter(Boolean).join(' · ');
      const stats = weaponStats(w);
      const bars = el('div', 'lp-bars', b);
      for (const k of ['damage', 'rate', 'range', 'handling'] as const) {
        const s = el('div', 'lp-stat', bars);
        el('span', '', s).textContent = t(`stat.${k}`);
        const bar = el('i', '', s);
        bar.style.setProperty('--v', String(stats[k]));
      }
      b.addEventListener('click', () => {
        if (slot === 'pistol') this.update({ ...l, pistol: id });
        else {
          const primary: [WeaponId, WeaponId] = [...l.primary];
          primary[slot === 'primary0' ? 0 : 1] = id;
          this.update({ ...l, primary });
        }
      });
    }
    // Keep the chosen weapon in view.
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
}
