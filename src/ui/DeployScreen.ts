import { t } from '@/i18n';
import type { MapImage } from './mapPainter';

export type Tone = 'ally' | 'enemy' | 'neutral';

export interface DeployOption {
  key: string;
  kind: 'base' | 'zone' | 'mate' | 'beacon';
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
  title: string;
  tickets: { allies: number; enemies: number } | null;
  zones: { id: string; x: number; z: number; r: number; owner: Tone; pushing: boolean }[];
  /** Enemy base marker (not a spawn option). */
  enemyBase: { x: number; z: number } | null;
  squad: { name: string; members: { name: string; state: 'ok' | 'combat' | 'down' | 'dead'; you: boolean }[] } | null;
}

const COLOR: Record<Tone, string> = { ally: '#4d8cff', enemy: '#e0473a', neutral: '#d8d8d0' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

/**
 * Battlefield-style deploy screen: a tactical map with every spawn point on
 * it, a list of the same options, the squad roster and a deploy button that
 * unlocks when the respawn timer runs out. Keys: 1-9 select, Space/Enter deploy.
 */
export class DeployScreen {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly list: HTMLDivElement;
  private readonly squadEl: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly title: HTMLDivElement;
  private readonly tickets: HTMLDivElement;
  private readonly note: HTMLDivElement;
  /** Scrolling part of the side column (the loadout panel goes on top). */
  readonly sideTop: HTMLDivElement;
  readonly mapBox: HTMLDivElement;
  private state: DeployState | null = null;
  private listKey = '';
  private squadKey = '';
  private hover: string | null = null;
  private readonly touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  constructor(
    parent: HTMLElement,
    private readonly map: MapImage,
    private readonly onSelect: (key: string) => void,
    private readonly onDeploy: () => void,
  ) {
    this.root = el('div', 'deploy', parent);
    const head = el('div', 'deploy-head', this.root);
    this.title = el('div', 'deploy-title', head);
    this.tickets = el('div', 'deploy-tickets', head);
    const body = el('div', 'deploy-body', this.root);
    const mapBox = el('div', 'deploy-map', body);
    this.mapBox = mapBox;
    this.canvas = el('canvas', 'deploy-canvas', mapBox);
    this.canvas.width = map.canvas.width;
    this.canvas.height = map.canvas.height;
    const side = el('div', 'deploy-side', body);
    this.sideTop = el('div', 'deploy-scroll', side);
    el('div', 'deploy-section', this.sideTop).textContent = t('deploy.spawns');
    this.list = el('div', 'deploy-list', this.sideTop);
    this.squadEl = el('div', 'deploy-squad', this.sideTop);
    const foot = el('div', 'deploy-foot', side);
    this.note = el('div', 'deploy-note', foot);
    this.button = el('button', 'deploy-button', foot);
    this.button.addEventListener('click', () => this.tryDeploy());

    this.canvas.addEventListener('click', (e) => {
      const key = this.pick(e);
      if (key) this.onSelect(key);
    });
    this.canvas.addEventListener('mousemove', (e) => {
      this.hover = this.pick(e);
      this.canvas.style.cursor = this.hover ? 'pointer' : 'default';
    });
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
  }

  hide(): void {
    this.root.classList.remove('on');
  }

  private tryDeploy(): void {
    if (this.state && this.state.wait <= 0) this.onDeploy();
  }

  /** Option under the mouse (within 16 px of its marker). */
  private pick(e: MouseEvent): string | null {
    if (!this.state) return null;
    const r = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / r.width;
    const px = (e.clientX - r.left) * sx;
    const py = (e.clientY - r.top) * sx;
    let best: string | null = null;
    let bestD = 18 * sx;
    for (const o of this.state.options) {
      if (o.blocked) continue;
      const [u, v] = this.map.project(o.x, o.z);
      const d = Math.hypot(u - px, v - py);
      if (d < bestD) {
        bestD = d;
        best = o.key;
      }
    }
    return best;
  }

  update(s: DeployState): void {
    this.state = s;
    if (!this.visible) return;
    this.title.textContent = s.title;
    this.tickets.textContent = s.tickets ? `${t('hud.allies')} ${s.tickets.allies}  ·  ${s.tickets.enemies} ${t('hud.enemies')}` : '';
    this.note.textContent = s.note ?? '';
    const ready = s.wait <= 0;
    this.button.disabled = !ready;
    // Touch screens have no Space key: drop the hint.
    const go = this.touch ? t('deploy.go').replace(/\s*\(.*\)$/, '') : t('deploy.go');
    this.button.textContent = ready ? go : `${t('deploy.wait')} ${Math.ceil(s.wait)}`;

    const listKey = `${s.selected}|${s.options.map((o) => `${o.key}${o.blocked}${o.warn}`).join()}`;
    if (listKey !== this.listKey) {
      this.listKey = listKey;
      this.list.replaceChildren();
      s.options.forEach((o, i) => {
        const row = el('button', `deploy-opt k-${o.kind}${o.key === s.selected ? ' sel' : ''}${o.blocked ? ' blocked' : ''}${o.warn ? ' warn' : ''}`, this.list);
        row.disabled = !!o.blocked;
        el('span', 'deploy-num', row).textContent = String(i + 1);
        el('span', 'deploy-label', row).textContent = o.label;
        if (o.blocked || o.warn) el('span', 'deploy-why', row).textContent = o.blocked ?? o.warn ?? '';
        row.addEventListener('click', () => this.onSelect(o.key));
      });
    }
    const squadKey = s.squad ? `${s.squad.name}|${s.squad.members.map((m) => m.name + m.state).join()}` : '';
    if (squadKey !== this.squadKey) {
      this.squadKey = squadKey;
      this.squadEl.replaceChildren();
      if (s.squad) {
        el('div', 'deploy-section', this.squadEl).textContent = `${t('squad.label')} ${s.squad.name}`;
        for (const m of s.squad.members) {
          const row = el('div', `deploy-member m-${m.state}${m.you ? ' you' : ''}`, this.squadEl);
          el('span', 'dot', row);
          el('span', 'name', row).textContent = m.name;
          el('span', 'state', row).textContent = t(`squad.${m.state}`);
        }
      }
    }
    this.draw(s);
  }

  private draw(s: DeployState): void {
    const g = this.canvas.getContext('2d')!;
    g.drawImage(this.map.canvas, 0, 0);
    const k = this.map.scale;
    // The canvas is scaled down to fit; draw markers at a constant on-screen size.
    const shown = this.canvas.getBoundingClientRect().width;
    const px = shown > 0 ? Math.max(1, this.canvas.width / shown) : 1;
    const font = (size: number) => `bold ${Math.round(size * px)}px sans-serif`;
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
      g.fillStyle = `${COLOR[z.owner]}33`;
      g.fill();
      g.lineWidth = (z.pushing ? 3 : 2) * px;
      g.strokeStyle = COLOR[z.owner];
      g.stroke();
    }
    for (const o of s.options) {
      const [u, v] = this.map.project(o.x, o.z);
      const sel = o.key === s.selected;
      const hot = o.key === this.hover;
      const color = o.blocked ? '#777' : o.kind === 'mate' ? '#6bdc6b' : o.kind === 'zone' ? COLOR.ally : o.kind === 'beacon' ? '#ffb070' : '#9cc2ff';
      if (sel || hot) {
        g.beginPath();
        g.arc(u, v, 17 * px, 0, Math.PI * 2);
        g.lineWidth = 3 * px;
        g.strokeStyle = sel ? '#ffd34d' : '#ffffff99';
        g.stroke();
      }
      g.beginPath();
      if (o.kind === 'mate') g.arc(u, v, 8 * px, 0, Math.PI * 2);
      else g.rect(u - 11 * px, v - 11 * px, 22 * px, 22 * px);
      g.fillStyle = '#101214cc';
      g.fill();
      g.lineWidth = 2 * px;
      g.strokeStyle = color;
      g.stroke();
      g.fillStyle = color;
      g.font = font(13);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (o.kind === 'mate') g.fillText(o.label.slice(0, 1), u, v + 0.5);
      else g.fillText(o.kind === 'base' ? '⌂' : o.kind === 'beacon' ? '▲' : o.key.replace('zone:', ''), u, v + 0.5);
    }
    // Enemy-held and neutral zone letters (not spawnable) for orientation.
    for (const z of s.zones) {
      if (s.options.some((o) => o.key === `zone:${z.id}`)) continue;
      const [u, v] = this.map.project(z.x, z.z);
      g.fillStyle = COLOR[z.owner];
      g.font = font(16);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(z.id, u, v);
    }
  }
}
