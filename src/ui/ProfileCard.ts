import { t, type MessageKey } from '@/i18n';
import { item } from '@/progression/catalog';
import { REPORT_NOTE, REPORT_REASONS, type PublicCard, type ReportReason } from '@/net/lobbyProtocol';
import type { ServerLink } from '@/net/ServerLink';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import { uiSound } from '@/audio/uiSounds';
import { cardCanvas, emblemSvg } from './cosmetics';
import { insigniaAt, rankLabel } from './rankInsignia';
import { plateColour } from './badges';
import './ds.css';
import './dialogs.css';
import './progress.css';
import './badges.css';

/**
 * Someone's account card in multiplayer (owner, 2026-10-25): their card,
 * emblem, name in the plate's colour, rank, and their record when they let
 * everyone see it; a report button for anyone but oneself. Opened from the
 * waiting room's member cards and the result screen's standings.
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** A dialog shade over everything (its own `ds-root`); Esc or a click outside closes it. */
function shade(): { box: HTMLElement; close: () => void } {
  const sh = el('div', 'dlg-shade ds-root pc-shade', document.body);
  sh.dataset.dsTheme = 'bfv';
  const box = el('div', 'ds-dialog dlg pc', sh);
  const close = () => {
    sh.remove();
    removeEventListener('keydown', key, true);
  };
  const key = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    uiSound('back');
    close();
  };
  addEventListener('keydown', key, true);
  sh.addEventListener('pointerdown', (e) => {
    if (e.target === sh) close();
  });
  return { box, close };
}

function button(parent: HTMLElement, label: string, cls: string, fn: () => void): HTMLButtonElement {
  const b = el('button', `ds-btn ${cls}`, parent, label);
  b.type = 'button';
  b.addEventListener('pointerenter', () => uiSound('hover'));
  b.addEventListener('click', fn);
  return b;
}

/** Shows `card`; `report` (not for oneself) opens the report form. */
export function showProfileCard(card: PublicCard, report?: () => void): void {
  uiSound('open');
  const { box, close } = shade();
  const head = el('div', 'pc-head', box);
  const look = card.badge?.card ? item(card.badge.card)?.card : undefined;
  if (look) head.appendChild(cardCanvas(look, 440, 110));
  else head.classList.add('plain');
  const who = el('div', 'pc-who', head);
  const emb = card.badge?.emblem ? item(card.badge.emblem)?.emblem : undefined;
  if (emb) who.insertAdjacentHTML('beforeend', emblemSvg(emb, 52));
  const names = el('div', 'pc-names', who);
  const nm = el('div', 'pc-name', names, card.name);
  const plate = plateColour(card.badge);
  if (plate) nm.style.setProperty('--plate', plate);
  el('span', 'pc-tag', nm, `#${card.tag}`);
  const lv = card.badge?.lv;
  const rank = el('div', 'pc-rank', names);
  if (lv) {
    rank.insertAdjacentHTML('beforeend', insigniaAt(lv));
    el('span', '', rank, rankLabel(lv));
  } else el('span', '', rank, t(card.account ? 'pc.rankHidden' : 'pc.guest'));
  const s = card.stats;
  if (s) {
    const grid = el('div', 'pc-stats', box);
    const stat = (k: MessageKey, v: string) => {
      const c = el('div', 'pc-stat', grid);
      el('div', 'pc-v', c, v);
      el('div', 'pc-k', c, t(k));
    };
    stat('pc.matches', String(s.matches));
    stat('pc.winRate', s.matches ? `${Math.round((s.wins / s.matches) * 100)}%` : '-');
    stat('pc.kd', (s.kills / Math.max(1, s.deaths)).toFixed(2));
    stat('pc.kills', String(s.kills));
    stat('pc.headshots', s.kills ? `${Math.round((s.headshots / s.kills) * 100)}%` : '-');
    stat('pc.hours', `${s.hours}h`);
    const foot = el('div', 'pc-foot', box);
    if (s.best) el('span', '', foot, `${t('pc.best')} ${WEAPONS[s.best as WeaponId]?.name ?? s.best}`);
    if (s.since) el('span', '', foot, `${t('pc.since')} ${new Date(s.since).toLocaleDateString()}`);
  } else if (card.account) el('p', 'pc-hidden', box, t('pc.hidden'));
  const acts = el('div', 'ds-actions', box);
  if (report)
    button(acts, t('pc.report'), 'ghost danger', () => {
      close();
      report();
    });
  button(acts, t('pp.close'), 'primary', () => {
    uiSound('back');
    close();
  });
}

/** The report form for `name#tag`: a reason and a short note, then `send`. */
export function askReport(name: string, tag: string, send: (reason: ReportReason, note: string) => void): void {
  uiSound('open');
  const { box, close } = shade();
  box.classList.add('pc-report');
  el('h3', '', box, t('pc.reportTitle').replace('{name}', `${name}#${tag}`));
  let reason: ReportReason | null = null;
  const list = el('div', 'pc-reasons', box);
  const go = () => (ok.disabled = !reason);
  for (const r of REPORT_REASONS) {
    const b = button(list, t(`pc.reason.${r}` as MessageKey), 'ghost', () => {
      reason = r;
      for (const x of list.children) x.classList.toggle('sel', x === b);
      uiSound('select');
      go();
    });
  }
  const note = el('textarea', 'ds-input pc-note', box);
  note.maxLength = REPORT_NOTE;
  note.rows = 3;
  note.placeholder = t('pc.notePlaceholder');
  el('div', 'dlg-note', box, t('pc.reportRule'));
  const acts = el('div', 'ds-actions', box);
  button(acts, t('mp.cancel'), 'ghost', () => {
    uiSound('back');
    close();
  });
  const ok = button(acts, t('pc.send'), 'primary', () => {
    if (!reason) return;
    uiSound('select');
    send(reason, note.value.trim());
    close();
  });
  go();
}

/** A short note at the top of the screen (the report was taken, a card couldn't be shown). */
function toast(text: string): void {
  const wrap = el('div', 'ds-root pc-toast', document.body);
  wrap.dataset.dsTheme = 'bfv';
  el('div', 'ds-toast', wrap, text);
  setTimeout(() => wrap.remove(), 4000);
}

type CardLink = Pick<ServerLink, 'tag' | 'send' | 'on'>;

const wired = new WeakSet<object>();

/** Shows the account cards and report answers that come down `link` (once a link). */
function wire(link: CardLink): void {
  if (wired.has(link)) return;
  wired.add(link);
  link.on('card', (m) => {
    const c = m.card;
    showProfileCard(c, c.tag === link.tag ? undefined : () => reportOn(link, c.name, c.tag));
  });
  link.on('reported', () => toast(t('pc.reported')));
}

/** Asks the server for `tag`'s account card in our room and shows it (with a report button for others). */
export function openCard(link: CardLink, tag: string): void {
  wire(link);
  link.send({ t: 'card', tag });
}

/** The report form for `name#tag`, sent down `link`. */
export function reportOn(link: CardLink, name: string, tag: string): void {
  wire(link);
  askReport(name, tag, (reason, note) => link.send({ t: 'report', tag, reason, ...(note ? { note } : {}) }));
}
