import { t } from '@/i18n';
import { uiSound } from '@/audio/uiSounds';
import type { MapImage } from './mapPainter';
import { icon, type IconName } from './icons';
import './ds.css';
import './deploy.css';

export type Tone = 'ally' | 'enemy' | 'neutral';

export interface DeployOption {
  key: string;
  kind: 'base' | 'zone' | 'mate' | 'beacon' | 'vehicle' | 'ride';
  label: string;
  /** Map position of the marker (world x, z). */
  x: number;
  z: number;
  /** Reason it cannot be picked now, shown greyed out. */
  blocked: string | null;
  /** Allowed but risky (zone under attack). */
  warn: string | null;
  /** An aircraft (vehicles and rides: the jet icon instead of the tank). */
  air?: boolean;
}

export interface DeployState {
  options: DeployOption[];
  selected: string;
  /** Seconds until deploying is allowed (0 = ready). */
  wait: number;
  /** Instead of the countdown on the button (S&D: waiting for the next round). */
  waitText?: string;
  /** Extra text under the countdown (e.g. squad wiped). */
  note: string | null;
  /** The map's name. */
  title: string;
  /** Mode, its state and the score both sides, or null outside a zone match. */
  matchLine: string | null;
  zones: { id: string; x: number; z: number; r: number; owner: Tone; pushing: boolean }[];
  /** Enemy base marker (not a spawn option). */
  enemyBase: { x: number; z: number } | null;
  squad: { name: string; members: { name: string; state: 'ok' | 'combat' | 'down' | 'dead'; you: boolean }[] } | null;
}

/** The sides on the map picture (the ds theme's colours). */
const COLOR: Record<Tone, string> = { ally: '#4fa3ff', enemy: '#ff5b3a', neutral: '#efebe2' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

/** A spawn's icon by kind (zones show their letter instead). */
function iconOf(o: DeployOption): IconName | null {
  switch (o.kind) {
    case 'base':
      return 'base';
    case 'mate':
      return 'user';
    case 'beacon':
      return 'beacon';
    case 'vehicle':
    case 'ride':
      return o.air ? 'jet' : 'tank';
    default:
      return null;
  }
}

/** Fills a marker / row's badge: the icon, or the zone's letter. */
function badge(span: HTMLElement, o: DeployOption): void {
  const name = iconOf(o);
  const want = name ?? `#${o.key.replace('zone:', '')}`;
  if (span.dataset.badge === want) return;
  span.dataset.badge = want;
  if (name) span.innerHTML = icon(name);
  else span.textContent = o.key.replace('zone:', '');
}

/**
 * Battlefield V style deploy screen on the design system (owner, 2026-10-17;
 * ds.css, BFV theme; deploy.css): the soldier (class and kit, LoadoutPanel)
 * on the left, the map in the middle as large as it fits with every spawn
 * point on it as a button, the squad and the numbered spawn list on the
 * right, and the deploy button, which names the pick and fills while the
 * respawn timer runs out. Keys: 1-9 pick, Space / Enter deploy, Esc (or the
 * button top right) pauses.
 */
export class DeployScreen {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly marks: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly squadEl: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly buttonText: HTMLSpanElement;
  private readonly pickName: HTMLDivElement;
  private readonly pickWhy: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly tickets: HTMLDivElement;
  private readonly note: HTMLDivElement;
  /** Left column: the loadout panel goes in here. */
  readonly sideTop: HTMLDivElement;
  readonly mapBox: HTMLDivElement;
  private state: DeployState | null = null;
  private listKey = '';
  private squadKey = '';
  private readonly markEls = new Map<string, HTMLButtonElement>();
  /** Longest wait seen since the screen opened (the button's fill runs against it). */
  private waitFrom = 0;
  private wasReady = false;
  private readonly touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  constructor(
    parent: HTMLElement,
    private readonly map: MapImage,
    private readonly onSelect: (key: string) => void,
    private readonly onDeploy: () => void,
    private readonly onPause: () => void = () => {},
  ) {
    this.root = el('div', 'deploy ds-root', parent);
    this.root.dataset.dsTheme = 'bfv';
    const head = el('div', 'deploy-head', this.root);
    const titles = el('div', 'deploy-titles', head);
    el('div', 'ds-label', titles).textContent = t('deploy.title');
    this.title = el('div', 'deploy-title', titles);
    this.tickets = el('div', 'deploy-tickets', head);
    const pause = el('button', 'ds-btn ghost deploy-pause', head);
    pause.innerHTML = icon('pause');
    el('span', '', pause).textContent = t('paused');
    if (!this.touch) el('span', 'ds-kbd', pause).textContent = 'ESC';
    pause.addEventListener('pointerenter', () => uiSound('hover'));
    pause.addEventListener('click', () => {
      uiSound('open');
      this.onPause();
    });
    const body = el('div', 'deploy-body', this.root);

    this.sideTop = el('div', 'deploy-left', body);

    const mapBox = el('div', 'deploy-map', body);
    this.mapBox = mapBox;
    this.canvas = el('canvas', 'deploy-canvas', mapBox);
    this.canvas.width = map.canvas.width;
    this.canvas.height = map.canvas.height;
    this.marks = el('div', 'deploy-marks', mapBox);

    const side = el('div', 'deploy-side', body);
    const scroll = el('div', 'deploy-scroll', side);
    this.squadEl = el('div', 'deploy-squad', scroll);
    el('div', 'ds-label deploy-section', scroll).textContent = t('deploy.spawns');
    this.list = el('div', 'deploy-list', scroll);
    const foot = el('div', 'deploy-foot', side);
    const pick = el('div', 'deploy-pick', foot);
    el('div', 'ds-label', pick).textContent = t('deploy.at');
    this.pickName = el('div', 'deploy-pick-name', pick);
    this.pickWhy = el('div', 'deploy-pick-why', pick);
    this.note = el('div', 'deploy-note', foot);
    this.button = el('button', 'ds-btn primary deploy-button', foot);
    el('span', 'deploy-button-fill', this.button);
    this.buttonText = el('span', 'deploy-button-text', this.button);
    this.button.addEventListener('click', () => this.tryDeploy());

    window.addEventListener('keydown', (e) => {
      if (!this.visible || !this.state || e.defaultPrevented || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const d = /^Digit([1-9])$/.exec(e.code);
      if (d) {
        const opt = this.state.options[Number(d[1]) - 1];
        if (opt && !opt.blocked) this.pick(opt.key);
        e.preventDefault();
      } else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        this.tryDeploy();
      } else if (e.code === 'Escape') {
        // Handled here: the pause screen's own Esc (back to this screen) must not see it.
        e.preventDefault();
        this.onPause();
      }
    });
  }

  get visible(): boolean {
    return this.root.classList.contains('on');
  }

  show(): void {
    this.root.classList.add('on');
    this.waitFrom = 0;
  }

  hide(): void {
    this.root.classList.remove('on');
  }

  private pick(key: string): void {
    if (this.state?.selected !== key) uiSound('move');
    this.onSelect(key);
  }

  private tryDeploy(): void {
    if (!this.state || this.state.wait > 0) return;
    uiSound('start');
    this.onDeploy();
  }

  update(s: DeployState): void {
    this.state = s;
    if (!this.visible) return;
    this.title.textContent = s.title;
    this.tickets.textContent = s.matchLine ?? '';
    this.note.textContent = s.note ?? '';

    // The pick, named over the button; the button fills while the wait runs out.
    const sel = s.options.find((o) => o.key === s.selected) ?? s.options[0];
    this.pickName.textContent = sel?.label ?? '';
    this.pickWhy.textContent = sel?.warn ?? '';
    const ready = s.wait <= 0;
    this.waitFrom = ready ? 0 : Math.max(this.waitFrom, s.wait);
    this.button.disabled = !ready;
    this.button.classList.toggle('waiting', !ready);
    this.button.style.setProperty('--p', ready ? '1' : (1 - s.wait / Math.max(0.01, this.waitFrom)).toFixed(3));
    // Touch screens have no Space key: drop the hint.
    const go = this.touch ? t('deploy.go').replace(/\s*\(.*\)$/, '') : t('deploy.go');
    this.buttonText.textContent = ready ? go : (s.waitText ?? `${t('deploy.wait')} ${Math.ceil(s.wait)}`);
    if (ready && !this.wasReady) this.button.classList.add('ready-pulse');
    else if (!ready) this.button.classList.remove('ready-pulse');
    this.wasReady = ready;

    const listKey = `${s.selected}|${s.options.map((o) => `${o.key}${o.label}${o.blocked}${o.warn}`).join()}`;
    if (listKey !== this.listKey) {
      this.listKey = listKey;
      this.list.replaceChildren();
      s.options.forEach((o, i) => {
        const row = el('button', `ds-row deploy-opt${o.key === s.selected ? ' sel' : ''}${o.blocked ? ' off' : ''}${o.warn ? ' warn' : ''}`, this.list);
        row.disabled = !!o.blocked;
        if (!this.touch) el('span', 'ds-kbd deploy-num', row).textContent = String(i + 1);
        badge(el('span', 'deploy-badge', row), o);
        const text = el('span', 'ds-row-main deploy-label', row);
        text.textContent = o.label;
        if (o.blocked || o.warn) el('span', 'deploy-why', text).textContent = o.blocked ?? o.warn ?? '';
        if (!o.blocked && o.key !== s.selected) row.addEventListener('pointerenter', () => uiSound('hover'));
        row.addEventListener('click', () => this.pick(o.key));
      });
    }
    this.updateSquad(s);
    this.placeMarks(s);
    this.draw(s);
  }

  /** Squad roster; a member you can spawn on gets a button that picks them. */
  private updateSquad(s: DeployState): void {
    const mates = s.options.filter((o) => o.kind === 'mate');
    const squadKey = s.squad ? `${s.squad.name}|${s.selected}|${s.squad.members.map((m) => m.name + m.state).join()}|${mates.map((o) => o.label + o.blocked).join()}` : '';
    if (squadKey === this.squadKey) return;
    this.squadKey = squadKey;
    this.squadEl.replaceChildren();
    if (!s.squad) return;
    el('div', 'ds-label deploy-section', this.squadEl).textContent = `${t('squad.label')} ${s.squad.name}`;
    for (const m of s.squad.members) {
      const opt = m.you ? undefined : mates.find((o) => o.label === m.name);
      const row = el('div', `deploy-member m-${m.state}${m.you ? ' you' : ''}${opt && opt.key === s.selected ? ' sel' : ''}`, this.squadEl);
      el('span', 'dot', row);
      el('span', 'name', row).textContent = m.name;
      if (opt && !opt.blocked) {
        const b = el('button', 'ds-btn ghost deploy-onmate', row);
        b.textContent = t('deploy.onMate');
        b.addEventListener('pointerenter', () => uiSound('hover'));
        b.addEventListener('click', () => this.pick(opt.key));
      } else el('span', 'state', row).textContent = opt?.blocked ?? t(`squad.${m.state}`);
    }
  }

  /**
   * Spawn points as buttons over the map picture. The layer is laid over the
   * picture's shown box (it is scaled to fit), the buttons sit at fractions of it.
   */
  private placeMarks(s: DeployState): void {
    const c = this.canvas;
    const m = this.marks.style;
    m.left = `${c.offsetLeft}px`;
    m.top = `${c.offsetTop}px`;
    m.width = `${c.offsetWidth}px`;
    m.height = `${c.offsetHeight}px`;
    const seen = new Set<string>();
    for (const o of s.options) {
      // Vehicles from the base are in the list only.
      if (o.kind === 'vehicle') continue;
      seen.add(o.key);
      let b = this.markEls.get(o.key);
      if (!b) {
        b = el('button', '', this.marks);
        el('span', 'dm-icon', b);
        el('span', 'dm-label', b);
        const key = o.key;
        b.addEventListener('pointerenter', () => {
          if (this.state?.selected !== key && !b!.disabled) uiSound('hover');
        });
        b.addEventListener('click', () => this.pick(key));
        this.markEls.set(o.key, b);
      }
      const cls = `dm k-${o.kind}${o.key === s.selected ? ' sel' : ''}${o.blocked ? ' blocked' : ''}${o.warn ? ' warn' : ''}`;
      if (b.className !== cls) b.className = cls;
      b.disabled = !!o.blocked;
      badge(b.firstChild as HTMLSpanElement, o);
      const label = b.lastChild as HTMLSpanElement;
      // Tags stay short on the map: a zone's warning, a vehicle's name (seat and crew are in the list).
      const text = o.kind === 'zone' ? (o.warn ?? '') : o.kind === 'ride' ? o.label.split(' — ')[0]! : o.label;
      if (label.textContent !== text) label.textContent = text;
      const [u, v] = this.map.project(o.x, o.z);
      // Off the picture (a mate in a plane over the hills): no marker, the list still has it.
      const fu = u / c.width;
      const fv = v / c.height;
      b.style.display = fu < 0 || fu > 1 || fv < 0 || fv > 1 ? 'none' : '';
      b.style.left = `${(fu * 100).toFixed(2)}%`;
      b.style.top = `${(fv * 100).toFixed(2)}%`;
    }
    for (const [key, b] of this.markEls) {
      if (seen.has(key)) continue;
      b.remove();
      this.markEls.delete(key);
    }
  }

  /** The picture: zones as areas, the enemy base, letters of zones you can't spawn on. */
  private draw(s: DeployState): void {
    const g = this.canvas.getContext('2d')!;
    g.drawImage(this.map.canvas, 0, 0);
    const k = this.map.scale;
    // The canvas is scaled down to fit; draw at a constant on-screen size.
    const shown = this.canvas.getBoundingClientRect().width;
    const px = shown > 0 ? Math.max(1, this.canvas.width / shown) : 1;
    const font = (size: number) => `bold ${Math.round(size * px)}px "Barlow Condensed", "Pretendard Std Variable", sans-serif`;
    // Dim and cool the picture a little so the markers stand out.
    g.fillStyle = 'rgba(12, 12, 11, 0.28)';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (s.enemyBase) {
      const [u, v] = this.map.project(s.enemyBase.x, s.enemyBase.z);
      const r = 11 * px;
      g.fillStyle = 'rgba(12, 12, 11, 0.85)';
      g.fillRect(u - r, v - r, r * 2, r * 2);
      g.lineWidth = 2 * px;
      g.strokeStyle = COLOR.enemy;
      g.strokeRect(u - r, v - r, r * 2, r * 2);
      g.fillStyle = COLOR.enemy;
      g.fillRect(u - r * 0.4, v - r * 0.4, r * 0.8, r * 0.8);
    }
    for (const z of s.zones) {
      const [u, v] = this.map.project(z.x, z.z);
      g.beginPath();
      g.arc(u, v, z.r * k, 0, Math.PI * 2);
      g.fillStyle = `${COLOR[z.owner]}30`;
      g.fill();
      g.lineWidth = (z.pushing ? 3 : 2) * px;
      g.setLineDash(z.pushing ? [6 * px, 4 * px] : []);
      g.strokeStyle = COLOR[z.owner];
      g.stroke();
      g.setLineDash([]);
    }
    // Zones you can't spawn on keep their letter on the picture (spawnable ones are buttons).
    for (const z of s.zones) {
      if (s.options.some((o) => o.key === `zone:${z.id}`)) continue;
      const [u, v] = this.map.project(z.x, z.z);
      g.fillStyle = COLOR[z.owner];
      g.font = font(20);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3 * px;
      g.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      g.strokeText(z.id, u, v);
      g.fillText(z.id, u, v);
    }
  }
}
