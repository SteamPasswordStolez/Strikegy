/**
 * The field contract on the deploy screen (progression step 5): three goals
 * offered until the first deploy, one picked (the first by default), a reroll
 * for supply tickets; after that the picked one with whether it is met, and the
 * boosters running.
 */
import { getLocale, t, type MessageKey } from '@/i18n';
import { uiSound } from '@/audio/uiSounds';
import { CONTRACT_REROLL, type ContractDef } from '@/progression/contracts';
import type { BoostKind } from '@/progression/economy';
import { icon } from './icons';

export interface ContractView {
  offers: readonly ContractDef[];
  pick: string;
  /** Fixed: the player has deployed. */
  locked: boolean;
  met: boolean;
  /** Rerolls left this match (0: none). */
  rolls: number;
  tickets: number;
  boosts: Partial<Record<BoostKind, number>>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

export const contractName = (c: ContractDef): string => c.name[getLocale() === 'en' ? 1 : 0];

export class ContractPanel {
  private key = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly onPick: (id: string) => void,
    private readonly onReroll: () => void,
  ) {}

  update(v: ContractView): void {
    const boosts = (Object.entries(v.boosts) as [BoostKind, number][]).filter(([, s]) => s > 0);
    const key = JSON.stringify([v.offers.map((c) => c.id), v.pick, v.locked, v.met, v.rolls, v.tickets, boosts.map(([k, s]) => [k, Math.ceil(s / 60)])]);
    if (key === this.key) return;
    this.key = key;
    const r = this.root;
    r.replaceChildren();
    const head = el('div', 'deploy-contract-head', r);
    el('span', 'ds-label', head, v.locked ? t('contract.locked') : t('contract.title'));
    if (!v.locked) el('span', 'ds-dim deploy-contract-note', head, t('contract.note'));
    const shown = v.locked ? v.offers.filter((c) => c.id === v.pick) : v.offers;
    for (const c of shown) {
      const b = el('button', `deploy-contract-row${c.id === v.pick ? ' sel' : ''}${v.locked && v.met ? ' met' : ''}`, r);
      b.disabled = v.locked;
      el('span', 'deploy-contract-name', b, contractName(c));
      const pay = el('span', 'deploy-contract-pay', b);
      pay.innerHTML = icon('star');
      el('span', '', pay, v.locked && v.met ? t('contract.met') : `+${c.tickets}`);
      if (!v.locked)
        b.addEventListener('click', () => {
          if (c.id === v.pick) return;
          uiSound('move');
          this.onPick(c.id);
        });
    }
    if (!v.locked && v.rolls > 0) {
      const b = el('button', 'ds-btn ghost deploy-contract-roll', r);
      b.disabled = v.tickets < CONTRACT_REROLL.price;
      b.textContent = t('contract.reroll').replace('{p}', String(CONTRACT_REROLL.price)).replace('{n}', String(v.rolls));
      b.addEventListener('click', () => {
        uiSound('select');
        this.onReroll();
      });
    }
    if (boosts.length) {
      const line = el('div', 'deploy-contract-boost', r);
      line.innerHTML = icon('star');
      el('span', '', line, boosts.map(([k, s]) => `${t(`pp.boost.${k}` as MessageKey)} ${t('pp.minutes').replace('{n}', String(Math.ceil(s / 60)))}`).join(' · '));
    }
  }
}
