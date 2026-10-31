import { t, type MessageKey } from '@/i18n';
import type { LobbyMode } from '@/data/maps';
import { uiSound } from '@/audio/uiSounds';
import { icon } from './icons';
import './ds.css';
import './matchSetup.css';

/**
 * The match setup page shared by "play" and creating / editing a multiplayer
 * room, on the design system (owner, 2026-10-17; ds.css, BFV theme;
 * matchSetup.css). The page around it (head, keys along the bottom) is the
 * menu's; this draws:
 *
 * - tabs of mode groups (zone fights, attack / defence, team fights, every
 *   soldier for themselves, practice); a tab picks its first mode the map has;
 * - the group's modes as rows with a short tag at the side, the ones the
 *   picked map lacks greyed out;
 * - the picked map large (picture, name, zones, size, players it is made for)
 *   over a strip of every map;
 * - the picked mode (name, one line, its rules behind "show rules"), the
 *   settings as rows (stepper / choices / text box; a note only when it
 *   warns, otherwise it is the label's tooltip) and the start button, which
 *   stays in sight while the settings scroll.
 *
 * Keys (handled by the menu): Q / E group, ↑ ↓ mode, ← → map, Enter start.
 *
 * Where the caller can switch maps for a mode (`mapFor`, the solo setup;
 * owner, 2026-10-31: "make it convenient"), a mode the picked map lacks is
 * still picked, naming the map it moves to; maps without the picked mode are
 * marked in the strip; a random-map button, the team size's suggested-size
 * button and a one-line summary over the start button.
 */

export type ModeGroupId = 'objective' | 'attack' | 'team' | 'solo' | 'practice';

export const MODE_GROUPS: readonly { id: ModeGroupId; modes: readonly LobbyMode[] }[] = [
  { id: 'objective', modes: ['zone', 'frontline', 'conquest', 'hardpoint', 'fleet'] },
  { id: 'attack', modes: ['rush', 'snd', 'escort', 'fortress'] },
  { id: 'team', modes: ['tdm', 'killconfirm'] },
  { id: 'solo', modes: ['ffa', 'gungame', 'lastman'] },
  { id: 'practice', modes: ['skirmish'] },
];

/** Every soldier for themselves (no sides to pick). */
export const SOLO_LOBBY_MODES: readonly LobbyMode[] = ['ffa', 'gungame', 'lastman'];

export const modeName = (m: LobbyMode | string): string => t(m === 'skirmish' ? 'lobby.skirmish' : (`mode.${m}` as MessageKey));

export interface SetupMap {
  id: string;
  name: string;
  picture: HTMLCanvasElement | null;
  /** "5 zones · 329 × 210 m". */
  facts: string;
  /** Zones and playable size (width, depth in m), once the map has loaded. */
  zones?: number;
  size?: [number, number];
  /** Its own team size (players a side it is made for). */
  team: number;
  blurb: string;
  /** The modes it offers, once loaded (the strip marks maps without the picked mode). */
  modes?: readonly LobbyMode[];
}

export type SetupField =
  | { kind: 'stepper'; id: string; label: string; value: string; note?: string; warn?: boolean; change(d: number): void; reset?: { label: string; apply(): void } }
  | { kind: 'choice'; id: string; label: string; note?: string; options: { value: string; label: string }[]; value: string; pick(v: string): void }
  | { kind: 'text'; id: string; label: string; value: string; secret?: boolean; placeholder?: string; set(v: string): void };

/** The room's "전부 해금" (progression step 3): every weapon open whatever the level. */
export function allUnlockedField(on: boolean, set: (on: boolean) => void): SetupField {
  return {
    kind: 'choice',
    id: 'allUnlocked',
    label: t('lobby.allUnlocked'),
    note: t('lobby.allUnlockedDesc'),
    options: [
      { value: 'off', label: t('lobby.off') },
      { value: 'on', label: t('lobby.on') },
    ],
    value: on ? 'on' : 'off',
    pick: (v) => set(v === 'on'),
  };
}

/**
 * The simplified-controls switch (owner, 2026-10-18; `MATCH.simple`): the
 * solo setup and the room's create / edit page show the same row.
 */
export function simpleField(on: boolean, set: (on: boolean) => void): SetupField {
  return {
    kind: 'choice',
    id: 'simple',
    label: t('lobby.simple'),
    note: t('lobby.simpleDesc'),
    options: [
      { value: 'off', label: t('lobby.off') },
      { value: 'on', label: t('lobby.on') },
    ],
    value: on ? 'on' : 'off',
    pick: (v) => set(v === 'on'),
  };
}

export interface SetupView {
  mode: LobbyMode;
  map: string;
  /** Modes the picked map offers. */
  offered: readonly LobbyMode[];
  maps: SetupMap[];
  fields: SetupField[];
  start: string;
  /** What will happen, one line over the start button. */
  summary?: string;
  touch: boolean;
  /** The map picking `m` would move to when the picked one lacks it (null: none has it); without it such modes are greyed. */
  mapFor?(m: LobbyMode): string | null;
  /** A random map (shown as a button over the map card). */
  onRandom?(): void;
  onMode(m: LobbyMode): void;
  onMap(id: string): void;
  onStart(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** The rules list stays open (or shut) from one redraw to the next. */
let rulesOpen = false;
/** Where the settings column was scrolled, so a pick doesn't throw it back to the top. */
let fieldsScroll = 0;

const hover = (e: HTMLElement): void => e.addEventListener('pointerenter', () => uiSound('hover'));

export function renderMatchSetup(body: HTMLElement, v: SetupView): void {
  body.classList.add('mset');
  const group = groupOf(v.mode);

  // Mode groups.
  const tabs = el('div', 'ds-tabs mset-tabs', body);
  const elsewhere = (m: LobbyMode): string | null => (v.offered.includes(m) ? null : (v.mapFor?.(m) ?? null));
  for (const g of MODE_GROUPS) {
    const first = g.modes.find((m) => v.offered.includes(m)) ?? g.modes.find((m) => elsewhere(m));
    const tab = el('button', `ds-tab${g.id === group ? ' sel' : ''}${first ? '' : ' off'}`, tabs, t(`modeGroup.${g.id}` as MessageKey));
    if (!first) tab.disabled = true;
    else if (g.id !== group) {
      hover(tab);
      tab.addEventListener('click', () => {
        uiSound('select');
        v.onMode(first);
      });
    }
  }

  // The group's modes.
  const modes = el('div', 'mset-modes', body);
  for (const m of MODE_GROUPS.find((g) => g.id === group)?.modes ?? []) {
    const ok = v.offered.includes(m);
    const other = elsewhere(m);
    const row = el('button', `ds-row${m === v.mode ? ' sel' : ''}${ok ? '' : other ? ' other' : ' off'}`, modes);
    el('span', 'ds-row-main', row, modeName(m));
    const otherName = other ? (v.maps.find((x) => x.id === other)?.name ?? other) : '';
    el('span', 'ds-row-side', row, ok ? t(`modeTag.${m}` as MessageKey) : other ? t('lobby.onMap').replace('{map}', otherName) : t('lobby.notOnMap'));
    if (!ok && !other) row.disabled = true;
    else if (m !== v.mode) {
      hover(row);
      row.addEventListener('click', () => {
        uiSound('select');
        v.onMode(m);
      });
    }
  }

  // The map.
  const mapCol = el('div', 'mset-map', body);
  const cur = v.maps.find((m) => m.id === v.map) ?? v.maps[0];
  if (cur) {
    const card = el('div', 'ds-card sel mset-card', mapCol);
    if (cur.picture) card.style.backgroundImage = `url(${picture(cur.picture, 960)})`;
    const info = el('div', 'mset-card-info', card);
    el('div', 'ds-label', info, t('lobby.map'));
    el('div', 'mset-map-name', info, cur.name);
    const facts = el('div', 'mset-facts', info);
    const fact = (label: string, value: string) => {
      const f = el('div', 'mset-fact', facts);
      el('span', 'ds-label', f, label);
      el('span', 'ds-num', f, value);
    };
    if (cur.zones !== undefined) fact(t('lobby.factZones'), String(cur.zones));
    if (cur.size) fact(t('lobby.factSize'), `${cur.size[0]} × ${cur.size[1]} m`);
    fact(t('lobby.factFor'), `${cur.team} vs ${cur.team}`);
    if (v.onRandom) {
      const dice = el('button', 'ds-btn ghost mset-random', card);
      dice.innerHTML = icon('refresh');
      el('span', '', dice, t('lobby.random'));
      if (!v.touch) el('span', 'ds-kbd', dice, 'R');
      hover(dice);
      dice.addEventListener('click', () => {
        uiSound('select');
        v.onRandom!();
      });
    }
  }
  const strip = el('div', 'mset-strip', mapCol);
  for (const m of v.maps) {
    const lacks = !!m.modes && !m.modes.includes(v.mode);
    const b = el('button', `ds-card${m.id === v.map ? ' sel' : ''}${lacks ? ' lacks' : ''}`, strip);
    if (m.picture) b.style.backgroundImage = `url(${picture(m.picture, 320)})`;
    if (lacks) b.title = t('lobby.noMode').replace('{mode}', modeName(v.mode));
    el('span', 'ds-card-name', b, m.name);
    if (m.id !== v.map) {
      hover(b);
      b.addEventListener('click', () => {
        uiSound('select');
        v.onMap(m.id);
      });
    }
  }

  // The mode, its rules, the settings, start.
  const side = el('div', 'mset-side', body);
  const head = el('div', 'mset-mode', side);
  el('div', 'ds-label', head, t(`modeGroup.${group}` as MessageKey));
  el('div', 'mset-mode-name', head, modeName(v.mode));
  el('div', 'mset-mode-tag', head, t(`modeTag.${v.mode}` as MessageKey));
  const toggle = el('button', 'ds-btn ghost mset-rules-btn', head);
  toggle.innerHTML = icon('info');
  el('span', '', toggle, t(rulesOpen ? 'lobby.rulesHide' : 'lobby.rulesShow'));
  const rules = el('ul', `mset-rules${rulesOpen ? ' open' : ''}`, head);
  for (const r of t(`modeRules.${v.mode}` as MessageKey).split('|')) el('li', '', rules, r.trim());
  hover(toggle);
  toggle.addEventListener('click', () => {
    rulesOpen = !rulesOpen;
    uiSound(rulesOpen ? 'open' : 'back');
    rules.classList.toggle('open', rulesOpen);
    toggle.lastElementChild!.textContent = t(rulesOpen ? 'lobby.rulesHide' : 'lobby.rulesShow');
  });

  const fields = el('div', 'mset-fields', side);
  for (const f of v.fields) {
    const warn = f.kind === 'stepper' && f.warn;
    const row = el('div', `mset-field${warn ? ' warn' : ''}`, fields);
    const label = el('span', 'mset-field-label', row, f.label);
    const note = f.kind !== 'text' ? f.note : undefined;
    if (note && !warn) label.title = note;
    if (f.kind === 'stepper') {
      const ctl = el('div', 'ds-stepper', row);
      const less = el('button', '', ctl);
      less.innerHTML = icon('back');
      el('output', 'ds-num', ctl, f.value);
      const more = el('button', '', ctl);
      more.innerHTML = icon('next');
      for (const [b, d] of [
        [less, -1],
        [more, 1],
      ] as const) {
        hover(b);
        b.addEventListener('click', () => {
          uiSound('move');
          f.change(d);
        });
      }
      if (f.reset) {
        const r = el('button', 'ds-btn ghost mset-reset', row, f.reset.label);
        hover(r);
        r.addEventListener('click', () => {
          uiSound('select');
          f.reset!.apply();
        });
      }
    } else if (f.kind === 'choice') {
      const seg = el('div', 'ds-seg', row);
      for (const o of f.options) {
        const c = el('button', o.value === f.value ? 'sel' : '', seg, o.label);
        if (o.value === f.value) continue;
        hover(c);
        c.addEventListener('click', () => {
          uiSound('select');
          f.pick(o.value);
        });
      }
    } else {
      const input = el('input', 'ds-input', row);
      input.type = f.secret ? 'password' : 'text';
      input.maxLength = 32;
      input.value = f.value;
      if (f.placeholder) input.placeholder = f.placeholder;
      input.addEventListener('input', () => f.set(input.value));
    }
    if (warn && note) el('div', 'mset-field-note', row, note);
  }
  // Keep the column where it was across the redraw a pick causes.
  requestAnimationFrame(() => (fields.scrollTop = fieldsScroll));
  fields.addEventListener('scroll', () => (fieldsScroll = fields.scrollTop), { passive: true });

  if (v.summary) el('div', 'mset-summary ds-dim', side, v.summary);
  const go = el('button', 'ds-btn primary mset-start', side);
  el('span', '', go, v.start);
  if (!v.touch) el('span', 'ds-kbd', go, 'ENTER');
  go.addEventListener('click', () => v.onStart());
}

/** The group a mode is in (practice for anything unknown). */
export function groupOf(mode: LobbyMode): ModeGroupId {
  return MODE_GROUPS.find((g) => g.modes.includes(mode))?.id ?? 'practice';
}

/** The first mode the map offers in the next / previous group that has one (Q / E). */
export function stepGroup(cur: LobbyMode, offered: readonly LobbyMode[], d: number): LobbyMode {
  const at = MODE_GROUPS.findIndex((g) => g.id === groupOf(cur));
  for (let k = 1; k < MODE_GROUPS.length; k++) {
    const g = MODE_GROUPS[(at + d * k + MODE_GROUPS.length * k) % MODE_GROUPS.length]!;
    const first = g.modes.find((m) => offered.includes(m));
    if (first) return first;
  }
  return cur;
}

/** Copies of the map pictures at a given width, as image addresses (made once each). */
const copies = new WeakMap<HTMLCanvasElement, Map<number, string>>();
function picture(c: HTMLCanvasElement, width: number): string {
  let byWidth = copies.get(c);
  if (!byWidth) copies.set(c, (byWidth = new Map()));
  let url = byWidth.get(width);
  if (!url) {
    const w = Math.min(width, c.width);
    const s = document.createElement('canvas');
    s.width = w;
    s.height = Math.round((w * c.height) / Math.max(1, c.width));
    s.getContext('2d')!.drawImage(c, 0, 0, s.width, s.height);
    url = s.toDataURL('image/jpeg', 0.8);
    byWidth.set(width, url);
  }
  return url;
}

/** Small copies of the map pictures (the server browser's room card). */
export function thumb(c: HTMLCanvasElement): string {
  return picture(c, 240);
}

/** The next / previous mode the map offers, in the list's order (↑ ↓; crosses into the next group). */
export function stepMode(cur: LobbyMode, offered: readonly LobbyMode[], d: number): LobbyMode {
  const order = MODE_GROUPS.flatMap((g) => g.modes).filter((m) => offered.includes(m));
  if (!order.length) return cur;
  const i = order.indexOf(cur);
  return order[(Math.max(0, i) + d + order.length) % order.length]!;
}
