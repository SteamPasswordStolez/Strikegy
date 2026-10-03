import { t } from '@/i18n';
import type { MapImage } from './mapPainter';

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
}

export interface DeployState {
  options: DeployOption[];
  selected: string;
  /** Seconds until deploying is allowed (0 = ready). */
  wait: number;
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

const COLOR: Record<Tone, string> = { ally: '#42b4ff', enemy: '#f04a3a', neutral: '#d8d8d0' };

/** The glyph in a spawn marker / list row by kind (zones show their letter). */
const GLYPH: Record<DeployOption['kind'], string> = { base: '⌂', zone: '', mate: '◆', beacon: '▲', vehicle: '▣', ride: '▣' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

const glyphOf = (o: DeployOption) => (o.kind === 'zone' ? o.key.replace('zone:', '') : GLYPH[o.kind]);

/**
 * Battlefield V style deploy screen: the soldier (class and kit) on the left,
 * the map in the middle with every spawn point on it as a button (click to
 * pick it), the squad and the full spawn list on the right, and a deploy
 * button that names the pick and fills up while the respawn timer runs out.
 * Keys: 1-9 pick, Space / Enter deploy.
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
  private readonly touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  constructor(
    parent: HTMLElement,
    private readonly map: MapImage,
    private readonly onSelect: (key: string) => void,
    private readonly onDeploy: () => void,
  ) {
    this.root = el('div', 'deploy', parent);
    const head = el('div', 'deploy-head', this.root);
    const titles = el('div', 'deploy-titles', head);
    el('div', 'deploy-eyebrow', titles).textContent = t('deploy.title');
    this.title = el('div', 'deploy-title', titles);
    this.tickets = el('div', 'deploy-tickets', head);
    const body = el('div', 'deploy-body', this.root);

    this.sideTop = el('div', 'deploy-left', body);

    const mapBox = el('div', 'deploy-map', body);
    this.mapBox = mapBox;
    this.canvas = el('canvas', 'deploy-canvas', mapBox);
    this.canvas.width = map.canvas.width;
    this.canvas.height = map.canvas.height;
    this.marks = el('div', 'deploy-marks', mapBox);
    el('div', 'deploy-maphint', mapBox).textContent = t(this.touch ? 'deploy.mapHintTouch' : 'deploy.mapHint');

    const side = el('div', 'deploy-side', body);
    const scroll = el('div', 'deploy-scroll', side);
    this.squadEl = el('div', 'deploy-squad', scroll);
    el('div', 'deploy-section', scroll).textContent = t('deploy.spawns');
    this.list = el('div', 'deploy-list', scroll);
    const foot = el('div', 'deploy-foot', side);
    const pick = el('div', 'deploy-pick', foot);
    el('div', 'deploy-pick-head', pick).textContent = t('deploy.at');
    this.pickName = el('div', 'deploy-pick-name', pick);
    this.pickWhy = el('div', 'deploy-pick-why', pick);
    this.note = el('div', 'deploy-note', foot);
    this.button = el('button', 'deploy-button', foot);
    el('span', 'deploy-button-fill', this.button);
    this.buttonText = el('span', 'deploy-button-text', this.button);
    this.button.addEventListener('click', () => this.tryDeploy());

    window.addEventListener('keydown', (e) => {
      if (!this.visible || !this.state) return;
      const d = /^Digit([1-9])$/.exec(e.code);
      if (d) {
        const opt = this.state.options[Number(d[1]) - 1];
        if (opt && !opt.blocked) this.onSelect(opt.key);
        e.preventDefault();
      } else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        this.tryDeploy();
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

  private tryDeploy(): void {
    if (this.state && this.state.wait <= 0) this.onDeploy();
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
    this.button.style.setProperty('--p', ready ? '1' : (1 - s.wait / Math.max(0.01, this.waitFrom)).toFixed(3));
    // Touch screens have no Space key: drop the hint.
    const go = this.touch ? t('deploy.go').replace(/\s*\(.*\)$/, '') : t('deploy.go');
    this.buttonText.textContent = ready ? go : `${t('deploy.wait')} ${Math.ceil(s.wait)}`;

    const listKey = `${s.selected}|${s.options.map((o) => `${o.key}${o.label}${o.blocked}${o.warn}`).join()}`;
    if (listKey !== this.listKey) {
      this.listKey = listKey;
      this.list.replaceChildren();
      s.options.forEach((o, i) => {
        const row = el('button', `deploy-opt k-${o.kind}${o.key === s.selected ? ' sel' : ''}${o.blocked ? ' blocked' : ''}${o.warn ? ' warn' : ''}`, this.list);
        row.disabled = !!o.blocked;
        el('span', 'deploy-num', row).textContent = this.touch ? '' : String(i + 1);
        el('span', 'deploy-glyph', row).textContent = glyphOf(o);
        el('span', 'deploy-label', row).textContent = o.label;
        if (o.blocked || o.warn) el('span', 'deploy-why', row).textContent = o.blocked ?? o.warn ?? '';
        row.addEventListener('click', () => this.onSelect(o.key));
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
    el('div', 'deploy-section', this.squadEl).textContent = `${t('squad.label')} ${s.squad.name}`;
    for (const m of s.squad.members) {
      const opt = m.you ? undefined : mates.find((o) => o.label === m.name);
      const row = el('div', `deploy-member m-${m.state}${m.you ? ' you' : ''}${opt && opt.key === s.selected ? ' sel' : ''}`, this.squadEl);
      el('span', 'dot', row);
      el('span', 'name', row).textContent = m.name;
      if (opt && !opt.blocked) {
        const b = el('button', 'deploy-onmate', row);
        b.textContent = t('deploy.onMate');
        b.addEventListener('click', () => this.onSelect(opt.key));
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
        b.addEventListener('click', () => this.onSelect(key));
        this.markEls.set(o.key, b);
      }
      const cls = `dm k-${o.kind}${o.key === s.selected ? ' sel' : ''}${o.blocked ? ' blocked' : ''}${o.warn ? ' warn' : ''}`;
      if (b.className !== cls) b.className = cls;
      b.disabled = !!o.blocked;
      const icon = b.firstChild as HTMLSpanElement;
      const label = b.lastChild as HTMLSpanElement;
      const glyph = glyphOf(o);
      if (icon.textContent !== glyph) icon.textContent = glyph;
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
    const font = (size: number) => `bold ${Math.round(size * px)}px sans-serif`;
    // Dim the picture a little so the markers stand out.
    g.fillStyle = 'rgba(6, 9, 12, 0.18)';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (s.enemyBase) {
      const [u, v] = this.map.project(s.enemyBase.x, s.enemyBase.z);
      g.beginPath();
      g.rect(u - 11 * px, v - 11 * px, 22 * px, 22 * px);
      g.fillStyle = '#101214cc';
      g.fill();
      g.lineWidth = 2 * px;
      g.strokeStyle = COLOR.enemy;
      g.stroke();
      g.fillStyle = COLOR.enemy;
      g.font = font(14);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('⌂', u, v);
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
      g.font = font(18);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3 * px;
      g.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      g.strokeText(z.id, u, v);
      g.fillText(z.id, u, v);
    }
  }
}
