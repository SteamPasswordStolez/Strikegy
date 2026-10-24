/**
 * Rank insignia drawn in code (progression plan 3-1): bars for the enlisted,
 * chevrons for NCOs, diamonds for company officers, rose of Sharon blossoms
 * for field officers, stars for generals. Filled with the text colour; the
 * generals' stars are gold (`.rk[data-tier="general"]`, progress.css).
 */
import { rankAt, type Rank, type RankId } from '@/progression/levels';
import { t, type MessageKey } from '@/i18n';

const TIER: Record<Rank['kind'], string> = {
  bar: 'enlisted',
  chevron: 'nco',
  diamond: 'officer',
  blossom: 'officer',
  star: 'general',
};

/** One mark in a 20 x 24 cell, centred at x = 10. */
function mark(kind: Rank['kind'], i: number, n: number): string {
  if (kind === 'bar') {
    // Stacked bars in one cell.
    const h = 3.2;
    const gap = 2;
    const top = 12 - (n * h + (n - 1) * gap) / 2 + i * (h + gap);
    return `<rect x="1" y="${top.toFixed(2)}" width="18" height="${h}"/>`;
  }
  if (kind === 'chevron') {
    const y = 12 - ((n - 1) * 4.4) / 2 + i * 4.4 - 2.6;
    return `<path d="M1 ${(y + 5.2).toFixed(2)} 10 ${y.toFixed(2)} 19 ${(y + 5.2).toFixed(2)}v3.2L10 ${(y + 3.2).toFixed(2)} 1 ${(y + 8.4).toFixed(2)}Z"/>`;
  }
  const x = 10 + i * 20;
  if (kind === 'diamond')
    return `<path d="M${x} 3 ${x + 7} 12 ${x} 21 ${x - 7} 12Z"/><path d="M${x} 8 ${x + 3} 12 ${x} 16 ${x - 3} 12Z" fill="var(--rk-cut, #000)" opacity=".45"/>`;
  if (kind === 'blossom') {
    let petals = '';
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
      petals += `<circle cx="${(x + Math.cos(a) * 4.6).toFixed(2)}" cy="${(12 + Math.sin(a) * 4.6).toFixed(2)}" r="3.9"/>`;
    }
    return `${petals}<circle cx="${x}" cy="12" r="2" fill="var(--rk-cut, #000)" opacity=".45"/>`;
  }
  // A five-pointed star.
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
    const r = k % 2 ? 3.8 : 9;
    pts.push(`${(x + Math.cos(a) * r).toFixed(2)} ${(12.6 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `<path d="M${pts.join(' ')}Z"/>`;
}

/** The insignia of `rank` as inline SVG (`.rk`; height from CSS, width follows). */
export function insigniaSvg(rank: Rank): string {
  const stacked = rank.kind === 'bar' || rank.kind === 'chevron';
  const cells = stacked ? 1 : rank.n;
  let body = '';
  for (let i = 0; i < rank.n; i++) body += mark(rank.kind, i, rank.n);
  return `<svg class="rk" data-tier="${TIER[rank.kind]}" viewBox="0 0 ${cells * 20} 24" aria-hidden="true">${body}</svg>`;
}

/** The insignia for a level. */
export function insigniaAt(level: number): string {
  return insigniaSvg(rankAt(level));
}

/** "상병" for a level. */
export function rankName(level: number): string {
  return t(`rank.${rankAt(level).id}` as MessageKey);
}

/** "상병 Lv 42". */
export function rankLabel(level: number): string {
  return `${rankName(level)} Lv ${level}`;
}

/** The rank's title ("믿음직한 상병"). */
export function rankTitle(id: RankId): string {
  return t(`rankTitle.${id}` as MessageKey);
}
