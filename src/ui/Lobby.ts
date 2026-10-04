import { setLocale, t, type MessageKey } from '@/i18n';
import { isTouchDevice, loadSettings, type Settings } from '@/core/Settings';
import { loadJSON, saveJSON } from '@/core/storage';
import { BIG_TEAM, MAPS, RANGE_ID, TEAM_SIZES, matchQuery, snapTeam, type Difficulty, type LobbyMode, type LobbyPick } from '@/data/maps';
import type { MapDef } from '@/world/mapTypes';
import { paintMap } from './mapPainter';
import { renderHint } from './Overlay';
import { SettingsPanel } from './SettingsPanel';
import { MultiplayerMenu } from './MultiplayerMenu';
import { askName } from './NameDialog';
import { loadIdentity } from '@/net/identity';

const PICK_KEY = 'strikegy.lobby.v1';
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
type Row = 'mode' | 'map' | 'team' | 'difficulty';
const ROWS: readonly Row[] = ['mode', 'map', 'team', 'difficulty'];
const ROW_LABEL: Record<Row, MessageKey> = { mode: 'lobby.mode', map: 'lobby.map', team: 'lobby.team', difficulty: 'lobby.difficulty' };

/** The main menu's entries, top to bottom. */
const ENTRIES = ['play', 'multi', 'range', 'controls', 'settings'] as const;
type Entry = (typeof ENTRIES)[number];
type Screen = 'main' | 'play' | 'multi' | 'controls' | 'settings';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

/** Modes a map offers (Zone whenever it has zones, skirmish always). */
function modesOf(map: MapDef | undefined): LobbyMode[] {
  const out: LobbyMode[] = [];
  if (!map || (map.zones?.length ?? 0) > 0) {
    out.push('zone');
    if (map?.modes?.frontline) out.push('frontline');
    if (map?.modes?.conquest) out.push('conquest');
  }
  out.push('skirmish');
  return out;
}

function outline(map: MapDef): [number, number][] {
  if (map.world.boundary?.length) return map.world.boundary;
  const [w, d] = map.world.size;
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
}

const step = <T>(list: readonly T[], cur: T, d: number): T => list[(Math.max(0, list.indexOf(cur)) + d + list.length) % list.length]!;
const modeName = (m: LobbyMode): string => t(m === 'skirmish' ? 'lobby.skirmish' : (`mode.${m}` as MessageKey));

/**
 * The main menu: a screen of its own before any match. The game's name and
 * a column of entries (play / firing range / controls / settings) over the
 * last map, drifting slowly behind. Play
 * opens the game setup (mode, map, players a side, bot difficulty, the map's
 * picture) and its start button goes straight into the match; the range
 * starts at once. `onStart` gets the match address (main.ts loads the game).
 */
export class Lobby {
  readonly root: HTMLDivElement;
  private screen: Screen = 'main';
  private entry = 0;
  private focus = 0;
  private pick: LobbyPick;
  private readonly settings: Settings = loadSettings();
  private readonly maps = new Map<string, MapDef>();
  private readonly loading = new Set<string>();
  private readonly pictures = new Map<string, HTMLCanvasElement>();
  private readonly bg: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly touch = isTouchDevice();
  /** What moves without a redraw: the entries / rows and the line describing the picked one. */
  private picks: HTMLElement[] = [];
  private pickDesc: HTMLElement | null = null;
  private multi: MultiplayerMenu | null = null;
  private playerName = loadIdentity().name;

  constructor(
    container: HTMLElement,
    private readonly onStart: (query: string) => void,
    private readonly prefetch: () => void = () => {},
  ) {
    setLocale(this.settings.locale);
    const saved = loadJSON<Partial<LobbyPick>>(PICK_KEY) ?? {};
    const entry = MAPS.find((m) => m.id === saved.map);
    this.pick = {
      map: entry ? entry.id : MAPS[0]!.id,
      mode: saved.mode ?? 'zone',
      team: snapTeam(saved.team ?? entry?.team ?? MAPS[0]!.team),
      difficulty: DIFFICULTIES.includes(saved.difficulty as Difficulty) ? saved.difficulty! : 'normal',
    };
    this.root = el('div', 'lobby', container);
    this.bg = el('div', 'lb-bg', this.root);
    el('div', 'lb-shade', this.root);
    this.frame = el('div', 'lb-frame', this.root);
    window.addEventListener('keydown', this.onKey);
    this.render();
    for (const m of [...MAPS.map((e) => e.id), RANGE_ID]) void this.load(m);
    // First visit: a name before anything else.
    if (!this.playerName) this.editName(true);
  }

  private editName(required: boolean): void {
    askName(this.root, this.playerName, required, (name) => {
      if (name) this.playerName = name;
      this.render();
    });
  }

  private save(): void {
    saveJSON(PICK_KEY, this.pick);
  }

  /** Leaves for the match (main.ts takes the menu down once the loading screen is up). */
  private finish(pick: LobbyPick): void {
    this.save();
    window.removeEventListener('keydown', this.onKey);
    this.onStart(matchQuery(pick));
  }

  private go(screen: Screen): void {
    if (screen !== 'multi' && this.multi) {
      this.multi.close();
      this.multi = null;
    }
    if (screen === 'multi')
      this.multi ??= new MultiplayerMenu({
        modesFor: (map) => modesOf(this.maps.get(map)),
        redraw: () => {
          if (this.screen === 'multi') this.render();
        },
        device: this.touch ? 'mobile' : 'desktop',
      });
    this.screen = screen;
    // The game's code starts downloading while the player sets up.
    if (screen === 'play') this.prefetch();
    this.render();
  }

  private activate(e: Entry): void {
    if (e === 'range') this.finish({ ...this.pick, map: RANGE_ID });
    else this.go(e);
  }

  /** Back one page (the multiplayer pages step back inside themselves first). */
  private back(): void {
    if (this.screen === 'multi' && this.multi?.back()) return;
    this.go('main');
  }

  private onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    const key = e.code;
    if (key.startsWith('Arrow') || key === 'Enter') e.preventDefault();
    if (this.screen === 'main') {
      if (key === 'ArrowUp' || key === 'ArrowDown') this.select((this.entry + (key === 'ArrowUp' ? -1 : 1) + ENTRIES.length) % ENTRIES.length);
      else if (key === 'Enter') this.activate(ENTRIES[this.entry]!);
      return;
    }
    if (key === 'Escape' || key === 'Backspace') return this.back();
    if (this.screen !== 'play') return;
    if (key === 'ArrowUp' || key === 'ArrowDown') this.select((this.focus + (key === 'ArrowUp' ? -1 : 1) + ROWS.length) % ROWS.length);
    else if (key === 'ArrowLeft' || key === 'ArrowRight') this.change(ROWS[this.focus]!, key === 'ArrowLeft' ? -1 : 1);
    else if (key === 'Enter') this.finish(this.pick);
  };

  /** Fetches a map's JSON once (modes, size, picture), then redraws. */
  private async load(id: string): Promise<void> {
    if (this.maps.has(id) || this.loading.has(id)) return;
    this.loading.add(id);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}maps/${encodeURIComponent(id)}.json`);
      if (!res.ok) return;
      this.maps.set(id, (await res.json()) as MapDef);
    } catch {
      return;
    } finally {
      this.loading.delete(id);
    }
    if (id === this.pick.map) {
      this.fixMode();
      this.updateBackground();
      if (this.screen === 'play') this.render();
    }
  }

  /** Moves the highlight (main entries or setup rows) in place: the logo's entrance doesn't replay. */
  private select(i: number): void {
    if (this.screen === 'main') this.entry = i;
    else this.focus = i;
    this.picks.forEach((e, k) => e.classList.toggle(this.screen === 'main' ? 'sel' : 'focus', k === i));
    if (!this.pickDesc) return;
    if (this.screen === 'main') this.pickDesc.textContent = t(`menu.${ENTRIES[i]!}Desc`);
    else {
      const warn = ROWS[i] === 'team' && this.pick.team >= BIG_TEAM;
      this.pickDesc.textContent = this.describe(ROWS[i]!);
      this.pickDesc.classList.toggle('warn', warn);
    }
  }

  private render(): void {
    this.frame.replaceChildren();
    this.picks = [];
    this.pickDesc = null;
    this.root.className = `lobby lb-scr-${this.screen}`;
    if (this.screen !== 'main') {
      const top = el('div', 'lb-top', this.frame);
      const back = el('button', 'lb-back', top);
      el('span', 'lb-back-arrow', back).textContent = '◀';
      el('span', '', back).textContent = t('lobby.hint.back');
      if (!this.touch) el('span', 'keycap', back).textContent = 'Esc';
      back.addEventListener('click', () => this.back());
      const head = el('div', 'lb-pagehead', top);
      el('div', 'lb-eyebrow', head).textContent = t('title');
      el('div', 'lb-pagetitle', head).textContent = t(
        this.screen === 'play' ? 'lobby.setupTitle' : this.screen === 'multi' ? this.multi!.title : this.screen === 'controls' ? 'menu.controls' : 'menu.settings',
      );
    }
    const body = el('div', 'lb-body', this.frame);
    if (this.screen === 'main') this.renderMain(body);
    else if (this.screen === 'play') this.renderPlay(body);
    else if (this.screen === 'multi') this.multi!.render(body);
    else if (this.screen === 'controls') {
      body.classList.add('lb-controls');
      const keys = el('div', 'overlay-hint lb-keys', body);
      renderHint(keys, t(this.touch ? 'start.hintTouch' : 'start.hint'));
    } else {
      body.classList.add('lb-settings');
      const panel = new SettingsPanel(this.settings, {
        live: false,
        onChange: (key) => {
          if (key === 'locale') this.render();
        },
      });
      body.appendChild(panel.root);
    }
    this.renderHints();
    this.updateBackground();
  }

  // ---------------------------------------------------------------------------
  // Main: the name and the entries

  private renderMain(body: HTMLElement): void {
    body.classList.add('lb-main');
    const col = el('div', 'lb-maincol', body);
    const logo = el('div', 'lb-logo', col);
    el('div', 'lb-wordmark', logo).textContent = t('title');
    el('div', 'lb-logo-rule', logo);
    el('div', 'lb-tag', logo).textContent = t('menu.tagline');
    const list = el('div', 'lb-menu', col);
    ENTRIES.forEach((id, i) => {
      const b = el('button', `lb-item${i === this.entry ? ' sel' : ''}`, list);
      el('span', 'lb-item-name', b).textContent = t(`menu.${id}`);
      b.addEventListener('pointerenter', () => {
        if (!this.touch) this.select(i);
      });
      b.addEventListener('click', () => this.activate(id));
      this.picks.push(b);
    });
    this.pickDesc = el('div', 'lb-item-desc', col);
    this.pickDesc.textContent = t(`menu.${ENTRIES[this.entry]!}Desc`);
    el('div', 'lb-version', body).textContent = t('menu.version');
    const name = el('button', 'lb-name', body);
    el('span', 'lb-name-label', name).textContent = t('name.label');
    el('span', 'lb-name-value', name).textContent = this.playerName ?? '—';
    name.addEventListener('click', () => this.editName(false));
  }

  // ---------------------------------------------------------------------------
  // Play: the setup rows and the map's card

  private renderPlay(body: HTMLElement): void {
    body.classList.add('lb-play');
    const p = this.pick;
    const setup = el('div', 'lb-setup', body);
    const rows = el('div', 'lb-rows', setup);
    const value: Record<Row, string> = {
      mode: modeName(p.mode),
      map: t(`map.${p.map}` as MessageKey),
      team: `${p.team} vs ${p.team}`,
      difficulty: t(`lobby.diff.${p.difficulty}` as MessageKey),
    };
    ROWS.forEach((id, i) => {
      const r = el('div', `lb-srow${i === this.focus ? ' focus' : ''}${id === 'team' && p.team >= BIG_TEAM ? ' warn' : ''}`, rows);
      el('span', 'lb-srow-label', r).textContent = t(ROW_LABEL[id]);
      const left = el('button', 'lb-arrow', r);
      left.textContent = '◀';
      el('span', 'lb-srow-val', r).textContent = value[id];
      const right = el('button', 'lb-arrow', r);
      right.textContent = '▶';
      r.addEventListener('pointerenter', () => {
        if (!this.touch) this.select(i);
      });
      left.addEventListener('click', () => this.change(id, -1));
      right.addEventListener('click', () => this.change(id, 1));
      this.picks.push(r);
    });
    this.pickDesc = el('div', `lb-desc${ROWS[this.focus] === 'team' && p.team >= BIG_TEAM ? ' warn' : ''}`, setup);
    this.pickDesc.textContent = this.describe(ROWS[this.focus]!);
    const go = el('button', 'lb-start', setup);
    el('span', 'lb-start-text', go).textContent = t('lobby.start');
    if (!this.touch) el('span', 'keycap', go).textContent = 'Enter';
    go.addEventListener('click', () => this.finish(this.pick));
    this.mapCard(body, p.map, modeName(p.mode));
  }

  private describe(row: Row): string {
    const p = this.pick;
    if (row === 'mode') return t(`modeDesc.${p.mode}` as MessageKey);
    if (row === 'map') return t(`mapDesc.${p.map}` as MessageKey);
    if (row === 'team') return p.team >= BIG_TEAM ? t('lobby.bigTeam') : t('lobby.teamHint').replace('{n}', String(MAPS.find((m) => m.id === p.map)?.team ?? 12));
    return t(`lobby.diffDesc.${p.difficulty}` as MessageKey);
  }

  /** Keeps the mode to one the picked map offers (its own default when the old one isn't). */
  private fixMode(): void {
    const map = this.maps.get(this.pick.map);
    if (!map) return;
    const offered = modesOf(map);
    if (!offered.includes(this.pick.mode)) this.pick.mode = map.modes?.default ?? offered[0]!;
  }

  private change(row: Row, d: number): void {
    const p = this.pick;
    if (row === 'mode') p.mode = step(modesOf(this.maps.get(p.map)), p.mode, d);
    else if (row === 'map') {
      p.map = step(
        MAPS.map((m) => m.id),
        p.map,
        d,
      );
      p.team = MAPS.find((m) => m.id === p.map)!.team;
      p.mode = this.maps.get(p.map)?.modes?.default ?? 'zone';
      this.fixMode();
    } else if (row === 'team') {
      const i = TEAM_SIZES.indexOf(p.team as (typeof TEAM_SIZES)[number]);
      p.team = TEAM_SIZES[Math.max(0, Math.min(TEAM_SIZES.length - 1, i + d))]!;
    } else p.difficulty = step(DIFFICULTIES, p.difficulty, d);
    this.focus = ROWS.indexOf(row);
    this.save();
    this.render();
  }

  /** A map's picture, name, facts and blurb. */
  private mapCard(body: HTMLElement, id: string, badge: string): void {
    const card = el('div', 'lb-card', body);
    const pic = el('div', 'lb-card-pic', card);
    const canvas = this.picture(id);
    if (canvas) pic.appendChild(canvas);
    else el('div', 'lb-loading', pic).textContent = t('loading');
    const info = el('div', 'lb-card-info', card);
    el('div', 'lb-card-badge', info).textContent = badge;
    el('div', 'lb-card-name', info).textContent = t(`map.${id}` as MessageKey);
    const map = this.maps.get(id);
    if (map) el('div', 'lb-card-facts', info).textContent = this.mapFacts(map);
    el('div', 'lb-card-desc', info).textContent = t(`mapDesc.${id}` as MessageKey);
  }

  /** "5 zones · 500 × 360 m". */
  private mapFacts(map: MapDef): string {
    const pts = outline(map);
    const w = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
    const d = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
    return `${t('lobby.zones').replace('{n}', String(map.zones?.length ?? 0))} · ${Math.round(w)} × ${Math.round(d)} m`;
  }

  /** Keys along the bottom (keyboard only). */
  private renderHints(): void {
    if (this.touch) return;
    const bar = el('div', 'lb-hints', this.frame);
    const hint = (key: string, what: MessageKey) => {
      const h = el('span', 'lb-hint', bar);
      el('span', 'keycap', h).textContent = key;
      el('span', '', h).textContent = t(what);
    };
    if (this.screen === 'main') {
      hint('↑ ↓', 'lobby.hint.select');
      hint('Enter', 'lobby.hint.ok');
      return;
    }
    if (this.screen === 'play') {
      hint('↑ ↓', 'lobby.hint.select');
      hint('← →', 'lobby.hint.change');
      hint('Enter', 'lobby.start');
    }
    hint('Esc', 'lobby.hint.back');
  }

  // ---------------------------------------------------------------------------
  // Pictures

  /** The map from above with its zones and both bases (drawn once per map). */
  private picture(id: string): HTMLCanvasElement | null {
    const cached = this.pictures.get(id);
    if (cached) return cached;
    const map = this.maps.get(id);
    if (!map) return null;
    const img = paintMap(map, { points: outline(map) }, 1000);
    const g = img.canvas.getContext('2d')!;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const z of map.zones ?? []) {
      const [u, v] = img.project(z.pos[0], z.pos[2]);
      g.beginPath();
      g.arc(u, v, z.radius * img.scale, 0, Math.PI * 2);
      g.fillStyle = 'rgba(242, 242, 238, 0.14)';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = '#f2f2ee';
      g.stroke();
      g.font = 'bold 24px sans-serif';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      g.strokeText(z.id, u, v);
      g.fillStyle = '#f2f2ee';
      g.fillText(z.id, u, v);
    }
    for (const team of ['blue', 'red'] as const) {
      const own = map.spawns.filter((s) => s.team === team || (team === 'blue' && s.team === 'player'));
      if (!own.length) continue;
      const [u, v] = img.project(own.reduce((a, s) => a + s.pos[0], 0) / own.length, own.reduce((a, s) => a + s.pos[2], 0) / own.length);
      const color = team === 'blue' ? '#3fb2ff' : '#f2453a';
      g.fillStyle = 'rgba(8, 10, 13, 0.85)';
      g.fillRect(u - 14, v - 14, 28, 28);
      g.lineWidth = 2.5;
      g.strokeStyle = color;
      g.strokeRect(u - 14, v - 14, 28, 28);
      g.fillStyle = color;
      g.font = 'bold 17px sans-serif';
      g.fillText('⌂', u, v + 1);
    }
    img.canvas.className = 'lb-canvas';
    this.pictures.set(id, img.canvas);
    return img.canvas;
  }

  /** The picked map, dark and drifting, behind everything. */
  private bgFor = '';
  private updateBackground(): void {
    const id = this.pick.map;
    if (this.bgFor === id) return;
    const c = this.picture(id);
    if (!c) return;
    this.bgFor = id;
    this.bg.style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.72)})`;
  }
}
