import { t } from '@/i18n';
import './ds.css';
import './scoreboard.css';

export interface ScoreboardRow {
  name: string;
  /** A person's server tag in a multiplayer match (names can repeat across rooms, tags can't be copied). */
  tag?: string;
  squad: string | null;
  kills: number;
  deaths: number;
  captures: number;
  score: number;
  alive: boolean;
  you: boolean;
  /** In the player's squad. */
  mate: boolean;
}

export interface ScoreboardSide {
  label: string;
  /** "Tickets 312" / "Points 240", or null. */
  stat: string | null;
  kills: number;
  rows: ScoreboardRow[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * BF-style scoreboard: allies left, enemies right, one row per soldier
 * (squad, name, kills, deaths, zones, score). Shown while Z is held (touch:
 * tap the zone bar) and at the end of a match. Rows shrink to fit big games.
 * On the design system (scoreboard.css): the element is its own `ds-root`
 * over the game; at the end the result screen (result.css) dresses it.
 */
export class Scoreboard {
  readonly root: HTMLDivElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'scoreboard ds-root hidden';
    this.root.dataset.dsTheme = 'bfv';
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  /** Match-end mode: laid out inside the result overlay instead of floating over the game. */
  setFinal(final: boolean): void {
    this.root.classList.toggle('final', final);
    // The result screen is a `ds-root` already, with its own unit on phones: no second root inside it.
    this.root.classList.toggle('ds-root', !final);
  }

  update(allies: ScoreboardSide, enemies: ScoreboardSide): void {
    const html = this.side(allies, 'ally') + this.side(enemies, 'enemy');
    if (html === this.last) return;
    this.last = html;
    this.root.innerHTML = html;
    this.root.style.setProperty('--rows', String(Math.max(8, allies.rows.length, enemies.rows.length)));
  }

  private side(s: ScoreboardSide, cls: 'ally' | 'enemy'): string {
    const head =
      `<div class="sb-head"><span class="sb-team">${esc(s.label)}</span>` +
      (s.stat !== null ? `<span class="sb-tickets">${esc(s.stat)}</span>` : '') +
      `<span class="sb-kills">${t('score.kills')} ${s.kills}</span></div>`;
    const cols =
      `<div class="sb-row sb-cols"><span class="sb-sq"></span><span class="sb-name">${t('score.name')}</span>` +
      `<span>${t('score.k')}</span><span>${t('score.d')}</span><span>${t('score.zones')}</span><span>${t('score.score')}</span></div>`;
    const rows = s.rows
      .map((r) => {
        const c = ['sb-row', r.you ? 'you' : '', r.mate ? 'mate' : '', r.alive ? '' : 'dead'].filter(Boolean).join(' ');
        return (
          `<div class="${c}"><span class="sb-sq">${r.squad ? esc(r.squad.slice(0, 1)) : ''}</span><span class="sb-name">${esc(r.name)}${r.tag ? `<span class="sb-tag">#${esc(r.tag)}</span>` : ''}</span>` +
          `<span>${r.kills}</span><span>${r.deaths}</span><span>${r.captures}</span><span class="sb-score">${r.score}</span></div>`
        );
      })
      .join('');
    return `<div class="sb-side ${cls}">${head}${cols}${rows}</div>`;
  }
}
