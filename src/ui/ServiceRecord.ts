/**
 * The service record (병적부; progression plan 3-8, progression-data.md N), the
 * basic version of step 1: the rank with the XP bar and the next promotion,
 * the career numbers (all / multiplayer / bot matches), the last 20 matches,
 * and the profile's buttons (change name, export / import as a file: until
 * the server account, progress lives in this browser only).
 */
import { t, type MessageKey } from '@/i18n';
import { levelOf, nextRank, rankAt, xpForLevel } from '@/progression/levels';
import {
  exportProfile,
  importProfile,
  loadProfile,
  saveProfile,
  totalStats,
  type CareerStats,
  type MatchRecord,
  type Profile,
} from '@/progression/profile';
import { uiSound } from '@/audio/uiSounds';
import { insigniaAt, rankLabel, rankTitle } from './rankInsignia';
import './progress.css';

type Kind = 'all' | 'multi' | 'bots';
let kind: Kind = 'all';

/** Bot-match XP an hour when the player's own pace isn't known yet (plan: 180,000 in multiplayer, half in bot matches). */
const BOT_XP_HOUR = 90000;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

const n = (v: number) => Math.round(v).toLocaleString();
const pct = (a: number, b: number) =>
  b > 0 ? `${Math.min(100, Math.round((a / b) * 100))}%` : '—';

function duration(sec: number): string {
  const h = sec / 3600;
  if (h < 1) return t('rec.minutes').replace('{n}', String(Math.max(1, Math.round(sec / 60))));
  return t('rec.hours').replace('{n}', h < 10 ? h.toFixed(1) : n(h));
}

export interface ServiceRecordOptions {
  /** Change the name (the name dialog). */
  rename: () => void;
  /** Redraw the page (after an import or a filter change). */
  redraw: () => void;
  /** Where a dialog goes. */
  root: HTMLElement;
}

export function renderServiceRecord(body: HTMLElement, o: ServiceRecordOptions): void {
  body.classList.add('lb-record');
  const p = loadProfile();
  const sr = el('div', 'sr', body);
  head(sr, p);
  const left = el('div', 'sr-section', sr);
  const seg = el('div', 'ds-seg sr-kinds', left);
  for (const k of ['all', 'multi', 'bots'] as const) {
    const b = el('button', k === kind ? 'sel' : '', seg, t(`rec.${k}`));
    b.type = 'button';
    b.addEventListener('click', () => {
      if (k === kind) return;
      uiSound('select');
      kind = k;
      o.redraw();
    });
  }
  numbers(left, kind === 'all' ? totalStats(p) : p.stats[kind]);
  const right = el('div', 'sr-section', sr);
  recent(
    right,
    p.history.filter((h) => kind === 'all' || h.kind === kind),
  );
  account(right, p, o);
}

function head(parent: HTMLElement, p: Profile): void {
  const at = levelOf(p.xp);
  const h = el('div', 'sr-head', parent);
  el('div', 'sr-pic', h).innerHTML = insigniaAt(at.level);
  const name = el('div', '', h);
  el('div', 'sr-rank', name, rankLabel(at.level));
  el('div', 'sr-title', name, rankTitle(rankAt(at.level).id));
  const total = el('div', 'sr-total', h);
  el('div', 'ds-label', total, t('rec.totalXp'));
  el('div', 'ds-num', total, n(p.xp));
  const bar = el('div', 'sr-bar', h);
  bar.style.gridColumn = '2 / 4';
  el('i', '', bar).style.setProperty('--p', (at.into / at.need).toFixed(4));
  const next = el('div', 'sr-next', h);
  el('span', '', next, t('rec.toNext').replace('{n}', n(at.need - at.into)));
  const up = nextRank(at.level);
  if (!up) el('span', '', next, t('rec.topRank'));
  else {
    const need = xpForLevel(up.from) - p.xp;
    // The player's own pace in bot matches once there is enough of it.
    const s = p.stats.bots;
    const rate = s.seconds > 900 && s.xp > 0 ? (s.xp / s.seconds) * 3600 : BOT_XP_HOUR;
    el(
      'span',
      '',
      next,
      t('rec.nextRank')
        .replace('{rank}', t(`rank.${up.id}` as MessageKey))
        .replace('{n}', String(up.from - at.level))
        .replace('{time}', duration((need / rate) * 3600)),
    );
  }
}

function numbers(parent: HTMLElement, s: CareerStats): void {
  const group = (label: MessageKey, rows: [MessageKey, string][]) => {
    el('div', 'ds-label sr-group', parent, t(label));
    const tiles = el('div', 'sr-tiles', parent);
    for (const [k, v] of rows) {
      const tile = el('div', 'sr-tile', tiles);
      el('div', 'ds-label', tile, t(k));
      el('div', 'ds-num', tile, v);
    }
  };
  const finished = s.matches - s.quits - s.idle;
  group('rec.summary', [
    ['rec.matches', n(s.matches)],
    ['rec.winRate', pct(s.wins, finished)],
    ['rec.quits', n(s.quits)],
    ['rec.time', s.seconds > 0 ? duration(s.seconds) : '—'],
    ['rec.bestScore', n(s.bestScore)],
  ]);
  group('rec.combat', [
    ['rec.kills', n(s.kills)],
    ['rec.deaths', n(s.deaths)],
    ['rec.kd', s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : s.kills > 0 ? n(s.kills) : '—'],
    ['rec.kpm', s.seconds > 0 ? (s.kills / (s.seconds / 60)).toFixed(2) : '—'],
    ['rec.hsRate', pct(s.headshots, s.kills)],
    ['rec.accuracy', pct(s.hits, s.shots)],
    ['rec.streak', n(s.bestStreak)],
    ['rec.melee', n(s.meleeKills)],
  ]);
  group('rec.team', [
    ['rec.revives', n(s.revives)],
    ['rec.resupplies', n(s.resupplies)],
    ['rec.captures', n(s.captures)],
    ['rec.neutralizes', n(s.neutralizes)],
    ['rec.builds', n(s.builds)],
  ]);
}

function recent(parent: HTMLElement, list: MatchRecord[]): void {
  el('div', 'ds-label sr-group', parent, t('rec.recent'));
  const box = el('div', 'sr-matches', parent);
  if (!list.length) {
    el('div', 'sr-empty', box, t('rec.none'));
    return;
  }
  for (const m of list) {
    const row = el('div', 'ds-row', box);
    el('span', `sr-res ${m.result}`, row, t(`rec.res.${m.result}` as MessageKey));
    const main = el('span', 'sr-match-main', row);
    const mapKey = `map.${m.map}` as MessageKey;
    const modeKey = `mode.${m.mode}` as MessageKey;
    const map = t(mapKey) === mapKey ? m.map : t(mapKey);
    const mode = t(modeKey) === modeKey ? m.mode : t(modeKey);
    main.textContent = `${map} · ${mode}`;
    if (m.promoted) main.title = t(`rank.${m.promoted}` as MessageKey);
    const date = new Date(m.at);
    const when = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    el(
      'span',
      'sr-match-side',
      row,
      m.result === 'left' || m.result === 'idle'
        ? when
        : `${m.kills}/${m.deaths} · +${n(m.xp)} XP · ${when}`,
    );
  }
}

function account(parent: HTMLElement, p: Profile, o: ServiceRecordOptions): void {
  el('div', 'ds-label sr-group', parent, t('rec.account'));
  const acts = el('div', 'sr-acts', parent);
  const button = (label: MessageKey, fn: () => void) => {
    const b = el('button', 'ds-btn ghost', acts, t(label));
    b.type = 'button';
    b.addEventListener('pointerenter', () => uiSound('hover'));
    b.addEventListener('click', fn);
  };
  button('rec.rename', () => {
    uiSound('open');
    o.rename();
  });
  button('rec.export', () => {
    uiSound('select');
    const blob = new Blob([exportProfile(p)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `strikegy-profile-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const file = el('input', '', acts);
  file.type = 'file';
  file.accept = '.json,application/json';
  file.hidden = true;
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    void f.text().then((text) => {
      const got = importProfile(text);
      if (!got) return dialog(o.root, t('rec.importBad'), null);
      const ask = t('rec.importAsk')
        .replace('{n}', String(levelOf(p.xp).level))
        .replace('{m}', String(levelOf(got.xp).level));
      dialog(o.root, ask, () => {
        saveProfile(got);
        o.redraw();
      });
    });
  });
  button('rec.import', () => {
    uiSound('select');
    file.click();
  });
  el('div', 'sr-acts-note', parent, t('rec.localNote'));
}

/** A small design-system dialog: a line, then OK (and cancel when there is something to confirm). */
function dialog(root: HTMLElement, text: string, onOk: (() => void) | null): void {
  const shade = el('div', 'dlg-shade ds-root', root);
  shade.dataset.dsTheme = 'bfv';
  const box = el('div', 'ds-dialog dlg', shade);
  el('p', '', box, text);
  const row = el('div', 'ds-actions', box);
  const close = () => shade.remove();
  if (onOk) {
    const no = el('button', 'ds-btn ghost', row, t('lobby.hint.back'));
    no.addEventListener('click', () => {
      uiSound('back');
      close();
    });
  }
  const ok = el('button', 'ds-btn primary', row, t('lobby.hint.ok'));
  ok.addEventListener('click', () => {
    uiSound('select');
    close();
    onOk?.();
  });
  ok.focus();
}
