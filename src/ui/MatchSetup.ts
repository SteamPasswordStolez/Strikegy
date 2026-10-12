import { t, type MessageKey } from '@/i18n';
import type { LobbyMode } from '@/data/maps';

/**
 * The match setup page shared by "play" and creating a multiplayer room
 * (owner, 2026-10-12: with this many modes and settings they need more
 * explaining and better order). Three columns:
 *
 * - modes, grouped by kind (zone fights, attack / defence, team deathmatch,
 *   every soldier for themselves, practice), each with a one-line tag; the
 *   ones the picked map doesn't offer greyed out;
 * - the picked map large (picture, name, size, players, blurb) over a strip
 *   of every map to pick from;
 * - the picked mode: what it is, its rules as a short list, then the
 *   settings (steppers, choice chips, text boxes) and the start button.
 *
 * Keys (desktop): ↑ ↓ mode, ← → map, Enter start.
 */

export const MODE_GROUPS: readonly { id: 'objective' | 'attack' | 'team' | 'solo' | 'practice'; modes: readonly LobbyMode[] }[] = [
  { id: 'objective', modes: ['zone', 'frontline', 'conquest', 'hardpoint'] },
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
  /** Its own team size (players a side it is made for). */
  team: number;
  blurb: string;
}

export type SetupField =
  | { kind: 'stepper'; id: string; label: string; value: string; note?: string; warn?: boolean; change(d: number): void }
  | { kind: 'choice'; id: string; label: string; note?: string; options: { value: string; label: string }[]; value: string; pick(v: string): void }
  | { kind: 'text'; id: string; label: string; value: string; secret?: boolean; placeholder?: string; set(v: string): void };

export interface SetupView {
  mode: LobbyMode;
  map: string;
  /** Modes the picked map offers. */
  offered: readonly LobbyMode[];
  maps: SetupMap[];
  fields: SetupField[];
  start: string;
  /** A line over the start button (what will happen), optional. */
  summary?: string;
  touch: boolean;
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

export function renderMatchSetup(body: HTMLElement, v: SetupView): void {
  body.classList.add('ms');
  // Modes.
  const modes = el('div', 'ms-col ms-modes', body);
  for (const g of MODE_GROUPS) {
    el('div', 'ms-group', modes, t(`modeGroup.${g.id}` as MessageKey));
    for (const m of g.modes) {
      const ok = v.offered.includes(m);
      const b = el('button', `ms-mode${m === v.mode ? ' sel' : ''}${ok ? '' : ' off'}`, modes);
      el('span', 'ms-mode-name', b, modeName(m));
      el('span', 'ms-mode-tag', b, ok ? t(`modeTag.${m}` as MessageKey) : t('lobby.notOnMap'));
      if (ok) b.addEventListener('click', () => v.onMode(m));
      else b.disabled = true;
    }
  }

  // The map.
  const mapCol = el('div', 'ms-col ms-map', body);
  const cur = v.maps.find((m) => m.id === v.map) ?? v.maps[0];
  if (cur) {
    const pic = el('div', 'ms-pic', mapCol);
    if (cur.picture) pic.appendChild(cur.picture);
    else el('div', 'lb-loading', pic, t('loading'));
    const head = el('div', 'ms-map-head', mapCol);
    el('div', 'ms-map-name', head, cur.name);
    el('div', 'ms-map-facts', head, `${cur.facts} · ${t('lobby.madeFor').replaceAll('{n}', String(cur.team))}`);
    el('div', 'ms-map-blurb', mapCol, cur.blurb);
  }
  const strip = el('div', 'ms-strip', mapCol);
  for (const m of v.maps) {
    const b = el('button', `ms-thumb${m.id === v.map ? ' sel' : ''}`, strip);
    if (m.picture) {
      const img = el('img', 'ms-thumb-img', b);
      img.src = thumb(m.picture);
      img.alt = '';
    }
    el('span', 'ms-thumb-name', b, m.name);
    b.addEventListener('click', () => v.onMap(m.id));
  }

  // The mode, its rules, the settings, start.
  const side = el('div', 'ms-col ms-detail', body);
  const groupOf = MODE_GROUPS.find((g) => g.modes.includes(v.mode));
  if (groupOf) el('div', 'ms-eyebrow', side, t(`modeGroup.${groupOf.id}` as MessageKey));
  el('div', 'ms-title', side, modeName(v.mode));
  el('div', 'ms-desc', side, t(`modeDesc.${v.mode}` as MessageKey));
  const rules = el('ul', 'ms-rules', side);
  for (const r of t(`modeRules.${v.mode}` as MessageKey).split('|')) el('li', '', rules, r.trim());
  const fields = el('div', 'ms-fields', side);
  for (const f of v.fields) {
    const row = el('div', `ms-field${f.kind === 'stepper' && f.warn ? ' warn' : ''}`, fields);
    el('span', 'ms-field-label', row, f.label);
    const ctl = el('div', 'ms-field-ctl', row);
    if (f.kind === 'stepper') {
      el('button', 'lb-arrow', ctl, '◀').addEventListener('click', () => f.change(-1));
      el('span', 'ms-field-val', ctl, f.value);
      el('button', 'lb-arrow', ctl, '▶').addEventListener('click', () => f.change(1));
    } else if (f.kind === 'choice') {
      for (const o of f.options) {
        const c = el('button', `ms-chip${o.value === f.value ? ' sel' : ''}`, ctl, o.label);
        c.addEventListener('click', () => f.pick(o.value));
      }
    } else {
      const input = el('input', 'lb-input ms-input', ctl);
      input.type = f.secret ? 'password' : 'text';
      input.maxLength = 32;
      input.value = f.value;
      if (f.placeholder) input.placeholder = f.placeholder;
      input.addEventListener('input', () => f.set(input.value));
    }
    const note = f.kind !== 'text' ? f.note : undefined;
    if (note) el('div', 'ms-field-note', row, note);
  }
  if (v.summary) el('div', 'ms-summary', side, v.summary);
  const go = el('button', 'lb-start ms-start', side);
  el('span', 'lb-start-text', go, v.start);
  if (!v.touch) el('span', 'keycap', go, 'Enter');
  go.addEventListener('click', () => v.onStart());
}

/** Small copies of the map pictures for the strip (made once each). */
const thumbs = new WeakMap<HTMLCanvasElement, string>();
function thumb(c: HTMLCanvasElement): string {
  let url = thumbs.get(c);
  if (!url) {
    const s = document.createElement('canvas');
    s.width = 240;
    s.height = Math.round((240 * c.height) / Math.max(1, c.width));
    s.getContext('2d')!.drawImage(c, 0, 0, s.width, s.height);
    url = s.toDataURL('image/jpeg', 0.8);
    thumbs.set(c, url);
  }
  return url;
}

/** The next / previous mode the map offers, in the list's order (↑ ↓). */
export function stepMode(cur: LobbyMode, offered: readonly LobbyMode[], d: number): LobbyMode {
  const order = MODE_GROUPS.flatMap((g) => g.modes).filter((m) => offered.includes(m));
  if (!order.length) return cur;
  const i = order.indexOf(cur);
  return order[(Math.max(0, i) + d + order.length) % order.length]!;
}
