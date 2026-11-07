import './killCard.css';
import { t } from '@/i18n';
import { badgeHtml, plateColour } from '@/ui/badges';
import type { Badge } from '@/net/lobbyProtocol';
import { weaponPortrait } from '@/ui/weaponPortraits';
import type { WeaponId } from '@/weapons/weaponData';

/** Who killed the player, as the death camera shows it (players asked what killed them, 2026-11). */
export interface KillInfo {
  name: string;
  /** A person's tag (`name#TAG`); bots have none. */
  tag?: string;
  badge?: Badge;
  /** What hit: the gun's name, or the vehicle / call-in. */
  weapon: string;
  /** The gun, when it was one (its picture). */
  weaponId?: WeaponId;
  /** Their vehicle's name, when they were in one. */
  vehicle?: string;
  headshot: boolean;
  /** Metres from where the player fell; null when unknown. */
  distance: number | null;
  /** Their health left, 0..1 (a vehicle's when they were in one); null when unknown. */
  health: number | null;
}

/**
 * The card under the middle of the screen while the death camera looks at the
 * killer: who (name#tag, emblem and rank for people), with what, how far, and
 * what they have left.
 */
export class KillCard {
  private readonly root: HTMLDivElement;
  private shown = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'kc';
    parent.appendChild(this.root);
  }

  show(k: KillInfo): void {
    const id = ++this.shown;
    const r = this.root;
    r.replaceChildren();
    const head = div('kc-head', r);
    head.textContent = t('kc.killedBy');
    const who = div('kc-who', r);
    who.innerHTML = badgeHtml(k.badge, 20);
    const name = span('kc-name', who);
    name.textContent = k.name;
    const plate = plateColour(k.badge);
    if (plate) name.style.setProperty('--plate', plate);
    if (k.tag) span('kc-tag', who).textContent = `#${k.tag}`;
    const gun = div('kc-gun', r);
    const pic = document.createElement('img');
    pic.className = 'kc-pic';
    pic.alt = '';
    gun.appendChild(pic);
    span('kc-wname', gun).textContent = k.vehicle ? `${k.vehicle} · ${k.weapon}` : k.weapon;
    if (k.weaponId)
      void weaponPortrait(k.weaponId).then((url) => {
        if (url && id === this.shown) {
          pic.src = url;
          pic.classList.add('on');
        }
      });
    const facts = div('kc-facts', r);
    if (k.headshot) span('kc-head-shot', facts).textContent = t('kc.headshot');
    if (k.distance !== null) fact(facts, t('kc.distance'), `${Math.round(k.distance)} m`);
    if (k.health !== null) {
      const f = fact(facts, t(k.vehicle ? 'kc.vehicleHealth' : 'kc.health'), `${Math.max(0, Math.round(k.health * 100))}`);
      const bar = div('kc-hp', f);
      div('kc-hp-fill', bar).style.width = `${Math.max(0, Math.min(1, k.health)) * 100}%`;
    }
    r.classList.remove('on');
    void r.offsetWidth;
    r.classList.add('on');
  }

  hide(): void {
    this.shown++;
    this.root.classList.remove('on');
  }
}

function div(cls: string, parent: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  parent.appendChild(d);
  return d;
}

function span(cls: string, parent: HTMLElement): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  parent.appendChild(s);
  return s;
}

function fact(parent: HTMLElement, label: string, value: string): HTMLDivElement {
  const f = div('kc-fact', parent);
  span('kc-flabel', f).textContent = label;
  span('kc-fvalue', f).textContent = value;
  return f;
}
