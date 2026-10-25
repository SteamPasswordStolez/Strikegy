/**
 * The panel aboard a vehicle (bottom right, where the gun's block sits on
 * foot): the vehicle and the seat, its health, the seat's guns with heat /
 * reload / rounds, gauges (speed, altitude, throttle, telegraph, depth), the
 * seats with who sits where (click or tap to move), warnings as chips, and the
 * keys that do something here. It replaced one long line of text.
 */
import { t } from '@/i18n';
import { uiSound } from '@/audio/uiSounds';
import { icon, type IconName } from './icons';

export interface VehicleHudSeat {
  /** "운전석", "사수석", a station's name. */
  label: string;
  /** Who sits there (null: free). */
  who: string | null;
  me: boolean;
  /** The key that moves here ('' on touch or where seats aren't picked by key). */
  key: string;
  role: 'driver' | 'gunner' | 'passenger';
  /** Kept for the squad leader (rocket truck) or someone's plane. */
  locked: boolean;
}

export interface VehicleHudGun {
  name: string;
  /** Its trigger ('LMB', 'RMB'; '' on touch). */
  key: string;
  /** 0..1 heat for guns that overheat (null: none), and whether it is cooling off now. */
  heat: number | null;
  overheated: boolean;
  /** 0..1 how far the next shell is (null: no reload to wait for). */
  reload: number | null;
  /** Rounds left where they run out ("12"), else null. */
  ammo: string | null;
}

export interface VehicleHudGauge {
  label: string;
  value: string;
  unit?: string;
  warn?: boolean;
}

export interface VehicleHudAlert {
  text: string;
  tone: 'bad' | 'warn' | 'info' | 'ok';
}

export interface VehicleHudState {
  name: string;
  icon: IconName;
  /** The seat or station the player is in. */
  seat: string;
  /** 0..1, and the number shown. */
  health: number;
  hp: number;
  third: boolean;
  /** Every seat (small vehicles), or null and a crew line (warships). */
  seats: VehicleHudSeat[] | null;
  crew: string | null;
  guns: VehicleHudGun[];
  gauges: VehicleHudGauge[];
  alerts: VehicleHudAlert[];
  /** Lines for what a station sees (contacts, the plane picked at flight control). */
  info: string[];
  /** Keys that do something in this seat (desktop only). */
  keys: { key: string; label: string }[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

export class VehicleHud {
  readonly root: HTMLDivElement;
  private readonly head: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpNum: HTMLSpanElement;
  private readonly gunsEl: HTMLDivElement;
  private readonly gaugesEl: HTMLDivElement;
  private readonly seatsEl: HTMLDivElement;
  private readonly infoEl: HTMLDivElement;
  private readonly keysEl: HTMLDivElement;
  private readonly alertsEl: HTMLDivElement;
  private keys: Record<string, string> = {};
  /** Live gun bars, re-used while the gun list keeps its shape. */
  private gunBars: { fill: HTMLDivElement; ammo: HTMLSpanElement; row: HTMLDivElement }[] = [];

  constructor(
    parent: HTMLElement,
    private readonly onSeat: (i: number) => void,
  ) {
    this.root = el('div', 'vh', parent);
    this.alertsEl = el('div', 'vh-alerts', parent);
    this.head = el('div', 'vh-head', this.root);
    const hp = el('div', 'vh-hp', this.root);
    const track = el('div', 'vh-hp-track', hp);
    this.hpFill = el('div', 'vh-hp-fill', track);
    this.hpNum = el('span', 'vh-hp-num', hp);
    this.gunsEl = el('div', 'vh-guns', this.root);
    this.gaugesEl = el('div', 'vh-gauges', this.root);
    this.infoEl = el('div', 'vh-info', this.root);
    this.seatsEl = el('div', 'vh-seats', this.root);
    this.keysEl = el('div', 'vh-keys', this.root);
  }

  /** Redraws a part only when its text changed. */
  private part(name: string, key: string, draw: () => void): void {
    if (this.keys[name] === key) return;
    this.keys[name] = key;
    draw();
  }

  update(s: VehicleHudState | null): void {
    this.root.classList.toggle('on', !!s);
    this.alertsEl.classList.toggle('on', !!s && s.alerts.length > 0);
    if (!s) {
      this.keys = {};
      return;
    }
    this.part('head', `${s.name}|${s.icon}|${s.seat}|${s.third}`, () => {
      this.head.innerHTML = icon(s.icon, 'vh-icon');
      const txt = el('div', 'vh-title', this.head);
      el('div', 'vh-name', txt, s.name);
      el('div', 'vh-seat', txt, s.seat);
      el('span', 'ds-badge vh-view', this.head, t(s.third ? 'vh.third' : 'vh.first'));
    });
    const hp = Math.max(0, Math.min(1, s.health));
    this.hpFill.style.width = `${(hp * 100).toFixed(1)}%`;
    this.root.classList.toggle('hurt', hp < 0.35);
    this.hpNum.textContent = String(Math.max(0, Math.ceil(s.hp)));

    // Guns: the row shape is redrawn on change, the bars every frame.
    this.part('guns', s.guns.map((g) => `${g.name}|${g.key}|${g.heat !== null}|${g.reload !== null}|${g.ammo !== null}`).join(';'), () => {
      this.gunsEl.replaceChildren();
      this.gunBars = s.guns.map((g) => {
        const row = el('div', 'vh-gun', this.gunsEl);
        if (g.key) el('span', 'ds-kbd', row, g.key);
        el('span', 'vh-gun-name', row, g.name);
        const ammo = el('span', 'vh-gun-ammo ds-num', row);
        const track = el('div', 'vh-gun-track', row);
        return { fill: el('div', 'vh-gun-fill', track), ammo, row };
      });
    });
    s.guns.forEach((g, i) => {
      const b = this.gunBars[i];
      if (!b) return;
      // Heat fills toward red; a reload fills toward ready.
      const v = g.heat !== null ? g.heat : g.reload !== null ? 1 - g.reload : 1;
      b.fill.style.width = `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`;
      b.row.classList.toggle('heat', g.heat !== null);
      b.row.classList.toggle('hot', g.overheated);
      b.row.classList.toggle('loading', g.reload !== null && g.reload > 0);
      b.row.classList.toggle('empty', g.ammo === '0');
      const label = g.overheated ? t('vehicle.overheat') : g.reload !== null && g.reload > 0 ? t('vehicle.reloading') : g.ammo ?? (g.heat === null ? t('vh.ready') : '');
      if (b.ammo.textContent !== label) b.ammo.textContent = label;
    });

    this.part('gauges', s.gauges.map((g) => `${g.label}=${g.value}${g.unit ?? ''}${g.warn ? '!' : ''}`).join(';'), () => {
      this.gaugesEl.replaceChildren();
      for (const g of s.gauges) {
        const box = el('div', `vh-gauge${g.warn ? ' warn' : ''}`, this.gaugesEl);
        el('span', 'vh-gauge-label', box, g.label);
        const v = el('span', 'vh-gauge-value ds-num', box, g.value);
        if (g.unit) el('small', '', v, g.unit);
      }
    });

    this.part('info', s.info.join('\n'), () => {
      this.infoEl.replaceChildren();
      for (const line of s.info) el('div', 'vh-info-line', this.infoEl, line);
    });

    this.part('seats', s.seats ? s.seats.map((x) => `${x.label}|${x.who}|${x.me}|${x.key}|${x.locked}`).join(';') : `crew:${s.crew}`, () => {
      this.seatsEl.replaceChildren();
      if (!s.seats) {
        if (s.crew) el('div', 'vh-crew', this.seatsEl, s.crew);
        return;
      }
      s.seats.forEach((x, i) => {
        const b = el('button', `vh-slot ${x.role}${x.me ? ' me' : ''}${x.who && !x.me ? ' taken' : ''}${x.locked ? ' locked' : ''}`, this.seatsEl);
        b.title = x.label;
        el('span', 'vh-slot-key', b, x.key || String(i + 1));
        b.insertAdjacentHTML('beforeend', icon(x.role === 'driver' ? 'wheel' : x.role === 'gunner' ? 'target' : 'user', 'vh-slot-icon'));
        el('span', 'vh-slot-who', b, x.me ? t('vh.you') : x.who ?? (x.locked ? t('vehicle.reserved') : t('vh.free')));
        if (!x.me && !x.who && !x.locked)
          b.addEventListener('click', () => {
            uiSound('move');
            this.onSeat(i);
          });
      });
    });

    this.part('keys', s.keys.map((k) => `${k.key}=${k.label}`).join(';'), () => {
      this.keysEl.replaceChildren();
      for (const k of s.keys) {
        const h = el('span', 'vh-key', this.keysEl);
        for (const part of k.key.split(' ')) el('span', 'ds-kbd', h, part);
        el('span', '', h, k.label);
      }
    });

    this.part('alerts', s.alerts.map((a) => `${a.tone}:${a.text}`).join(';'), () => {
      this.alertsEl.replaceChildren();
      for (const a of s.alerts) el('span', `vh-alert ${a.tone}`, this.alertsEl, a.text);
    });
  }
}
