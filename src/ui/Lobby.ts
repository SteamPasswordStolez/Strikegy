import { setLocale, t, type MessageKey } from '@/i18n';
import { loadSettings, type Settings } from '@/core/Settings';
import { loadJSON, saveJSON } from '@/core/storage';
import { BIG_TEAM, MAPS, PLAYLISTS, RANGE_ID, TEAM_SIZES, matchQuery, snapTeam, voteMaps, type Difficulty, type LobbyMode, type LobbyPick, type Playlist } from '@/data/maps';
import { CAREER, botLevel, levelOf, loadCareer, takeLast, type Career } from '@/data/career';
import type { ClassId } from '@/data/classes';
import { botName } from '@/ai/names';
import { botClass } from '@/ai/personality';
import type { MapDef, Team } from '@/world/mapTypes';
import { paintMap } from './mapPainter';
import { SettingsPanel } from './SettingsPanel';
import { CLASS_ICON } from './classIcons';

const PICK_KEY = 'strikegy.lobby.v1';
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
type Row = 'mode' | 'map' | 'team' | 'difficulty';
const ROWS: readonly Row[] = ['mode', 'map', 'team', 'difficulty'];
const ROW_LABEL: Record<Row, MessageKey> = { mode: 'lobby.mode', map: 'lobby.map', team: 'lobby.team', difficulty: 'lobby.difficulty' };

/** Menu entries: the playlists, then a custom game and the practice range. */
type Tile = { kind: 'playlist'; p: Playlist } | { kind: 'custom' } | { kind: 'range' };
const TILES: readonly Tile[] = [...PLAYLISTS.map((p) => ({ kind: 'playlist' as const, p })), { kind: 'custom' }, { kind: 'range' }];
const tileId = (x: Tile): string => (x.kind === 'playlist' ? x.p.id : x.kind);

/**
 * Lobby timings in seconds [제안]: searching takes `search`; in the room the
 * others come in over `fill`, then the countdown runs, the map vote closes
 * `voteClose` before the start, and ready cuts what is left to `ready`. A
 * custom game's room has no vote and is shorter.
 */
const ROOM = { search: [1.4, 3.2], fill: 5, countdown: 15, voteClose: 6, ready: 4, customFill: 2.5, customCountdown: 8 } as const;

interface Saved extends Partial<LobbyPick> {
  tile?: string;
}

/** Someone in the room: the player or a bot (named as the match will name it). */
interface Member {
  name: string;
  team: Team;
  cls: ClassId;
  level: number;
  you: boolean;
  joinAt: number;
  voteAt: number;
  /** Index into the vote's maps, -1 before voting. */
  vote: number;
  row: HTMLElement | null;
}

interface Room {
  /** null: a custom game (no vote). */
  playlist: Playlist | null;
  pick: LobbyPick;
  options: string[];
  members: Member[];
  time: number;
  /** Seconds to the start; null while players are still coming in. */
  left: number | null;
  locked: boolean;
  winner: number;
  ready: boolean;
  starting: boolean;
}

/** The room's moving parts, kept to update in place (the roster only grows). */
interface RoomUi {
  status: HTMLElement;
  timer: HTMLElement;
  sub: HTMLElement;
  count: HTMLElement;
  voteBox: HTMLElement;
  votes: { card: HTMLElement; count: HTMLElement; bar: HTMLElement }[];
  preview: HTMLElement;
  previewFor: string;
  lists: Record<Team, HTMLElement>;
  heads: Record<Team, HTMLElement>;
  ready: HTMLButtonElement;
}

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
const num = (n: number): string => Math.round(n).toLocaleString('en-US');
const modeName = (m: LobbyMode): string => t(m === 'skirmish' ? 'lobby.skirmish' : (`mode.${m}` as MessageKey));
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The class the player last played (the deploy screen keeps it), for the roster. */
function playerClass(): ClassId {
  const cls = loadJSON<{ cls?: ClassId }>('strikegy.loadouts.v1')?.cls;
  return cls && (['assault', 'medic', 'support', 'recon'] as const).includes(cls) ? cls : 'assault';
}

/**
 * The lobby, Call of Duty style. The main menu lists playlists (a mode at a
 * set size over a few maps), a custom game and the practice range, with the
 * picked one described on the right and the player's calling card (career
 * level and XP) at the top. Picking a playlist searches for a match, then
 * opens the room: the others come in one by one (each with a level and a
 * class), everyone votes on the next map (bots too), and a countdown starts
 * the match; ready cuts it short. The custom game sets map, mode, players a
 * side and difficulty and opens the room without a vote. Settings are a tab.
 * `onStart` gets the match address (main.ts loads the game).
 */
export class Lobby {
  readonly root: HTMLDivElement;
  private tab: 'play' | 'settings' = 'play';
  private phase: 'menu' | 'custom' | 'search' | 'room' = 'menu';
  private tile = 0;
  private focus = 0;
  /** The custom game's setup; difficulty also applies to the playlists. */
  private pick: LobbyPick;
  private readonly settings: Settings = loadSettings();
  private readonly career: Career = loadCareer();
  private readonly last = takeLast();
  private readonly maps = new Map<string, MapDef>();
  private readonly loading = new Set<string>();
  private readonly pictures = new Map<string, HTMLCanvasElement>();
  private readonly thumbs = new Map<string, string>();
  private readonly bg: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  private search: { left: number; total: number; time: number; count: HTMLElement | null; playlist: Playlist } | null = null;
  private room: Room | null = null;
  private ui: RoomUi | null = null;
  private timer = 0;
  private lastTick = 0;

  constructor(
    container: HTMLElement,
    private readonly onStart: (query: string) => void,
    private readonly prefetch: () => void = () => {},
  ) {
    setLocale(this.settings.locale);
    const saved = loadJSON<Saved>(PICK_KEY) ?? {};
    const entry = MAPS.find((m) => m.id === saved.map);
    this.pick = {
      map: entry ? entry.id : MAPS[0]!.id,
      mode: saved.mode ?? 'zone',
      team: snapTeam(saved.team ?? entry?.team ?? MAPS[0]!.team),
      difficulty: DIFFICULTIES.includes(saved.difficulty as Difficulty) ? saved.difficulty! : 'normal',
    };
    this.tile = Math.max(0, TILES.findIndex((x) => tileId(x) === saved.tile));
    this.root = el('div', 'lobby', container);
    this.bg = el('div', 'lb-bg', this.root);
    el('div', 'lb-shade', this.root);
    this.frame = el('div', 'lb-frame', this.root);
    window.addEventListener('keydown', this.onKey);
    this.render();
    for (const m of [...MAPS.map((e) => e.id), RANGE_ID]) void this.load(m);
  }

  private save(): void {
    saveJSON(PICK_KEY, { ...this.pick, tile: tileId(TILES[this.tile]!) } satisfies Saved);
  }

  /** Leaves for the match. */
  private finish(pick: LobbyPick): void {
    this.save();
    window.clearInterval(this.timer);
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
    this.onStart(matchQuery(pick));
  }

  private onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    const key = e.code;
    const arrows = key.startsWith('Arrow');
    if (arrows || key === 'Space' || key === 'Enter') e.preventDefault();
    if (this.phase === 'search') {
      if (key === 'Escape') this.toMenu();
      return;
    }
    if (this.phase === 'room') {
      const n = Number(key.replace('Digit', ''));
      if (key.startsWith('Digit') && n >= 1) this.vote(n - 1);
      else if (key === 'Space' || key === 'Enter') this.setReady();
      else if (key === 'Escape') this.toMenu();
      return;
    }
    if (key === 'KeyQ' || key === 'KeyE') {
      this.tab = this.tab === 'play' ? 'settings' : 'play';
      this.render();
      return;
    }
    if (this.tab === 'settings') {
      if (key === 'Escape') {
        this.tab = 'play';
        this.render();
      }
      return;
    }
    if (this.phase === 'menu') {
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        this.tile = (this.tile + (key === 'ArrowUp' ? -1 : 1) + TILES.length) % TILES.length;
        this.save();
        this.render();
      } else if (key === 'ArrowLeft' || key === 'ArrowRight') this.stepDifficulty(key === 'ArrowLeft' ? -1 : 1);
      else if (key === 'Enter') this.activate();
    } else if (this.phase === 'custom') {
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        this.focus = (this.focus + (key === 'ArrowUp' ? -1 : 1) + ROWS.length) % ROWS.length;
        this.render();
      } else if (key === 'ArrowLeft' || key === 'ArrowRight') this.change(ROWS[this.focus]!, key === 'ArrowLeft' ? -1 : 1);
      else if (key === 'Enter') this.openRoom(null);
      else if (key === 'Escape') this.toMenu();
    }
  };

  /** Fetches a map's JSON once (modes, size, picture), then redraws what shows it. */
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
    if (id === this.pick.map) this.fixMode();
    if (this.phase === 'room') this.buildVotes();
    else if (this.phase !== 'search' && this.tab === 'play') this.render();
  }

  // ---------------------------------------------------------------------------
  // Frame: top bar (brand, tabs or where you are, calling card), body, keys

  private render(): void {
    this.frame.replaceChildren();
    this.ui = null;
    const top = el('div', 'lb-top', this.frame);
    const brand = el('div', 'lb-brand', top);
    el('div', 'lb-wordmark', brand).textContent = t('title');
    el('div', 'lb-tag', brand).textContent = t('lobby.multiplayer');
    if (this.phase === 'menu' || this.phase === 'custom') {
      const tabs = el('div', 'lb-tabs', top);
      if (!this.touch) el('span', 'keycap lb-tabkey', tabs).textContent = 'Q';
      for (const id of ['play', 'settings'] as const) {
        const b = el('button', `lb-tab${this.tab === id ? ' on' : ''}`, tabs);
        b.textContent = t(`lobby.${id}`);
        b.addEventListener('click', () => {
          this.tab = id;
          this.render();
        });
      }
      if (!this.touch) el('span', 'keycap lb-tabkey', tabs).textContent = 'E';
    } else {
      const crumb = el('div', 'lb-crumb', top);
      el('span', '', crumb).textContent = t('lobby.play');
      el('span', 'lb-crumb-sep', crumb).textContent = '›';
      el('span', 'lb-crumb-here', crumb).textContent = this.room?.playlist || this.search ? this.playlistName((this.room?.playlist ?? this.search?.playlist)!) : t('lobby.custom');
    }
    this.callingCard(top);

    const body = el('div', 'lb-body', this.frame);
    if (this.tab === 'settings' && (this.phase === 'menu' || this.phase === 'custom')) {
      body.classList.add('lb-settings');
      const panel = new SettingsPanel(this.settings, {
        live: false,
        onChange: (key) => {
          if (key === 'locale') this.render();
        },
      });
      body.appendChild(panel.root);
    } else if (this.phase === 'menu') this.renderMenu(body);
    else if (this.phase === 'custom') this.renderCustom(body);
    else if (this.phase === 'search') this.renderSearch(body);
    else this.renderRoom(body);
    this.renderHints();
  }

  /** Top right: level badge, name, XP toward the next level, what the last match earned. */
  private callingCard(parent: HTMLElement): void {
    const c = this.career;
    const lv = levelOf(c.xp);
    const card = el('div', 'lb-ccard', parent);
    el('div', 'lb-cc-art', card);
    el('div', 'lb-cc-badge', card).textContent = String(lv.level);
    const body = el('div', 'lb-cc-body', card);
    el('div', 'lb-cc-name', body).textContent = t('lobby.player');
    const line = el('div', 'lb-cc-line', body);
    el('span', 'lb-cc-lv', line).textContent = `${t('lobby.level')} ${lv.level}`;
    el('span', 'lb-cc-xp', line).textContent = lv.level >= CAREER.maxLevel ? t('lobby.maxLevel') : `${num(lv.progress * lv.need)} / ${num(lv.need)} XP`;
    el('div', 'lb-cc-bar', body).style.setProperty('--p', String(lv.progress));
    el('div', 'lb-cc-record', body).textContent = t('lobby.record').replace('{m}', String(c.matches)).replace('{w}', String(c.wins));
    if (this.last) {
      const gain = el('div', `lb-cc-gain${this.last.won ? ' won' : ''}`, card);
      const up = levelOf(this.last.before).level < lv.level;
      gain.textContent = `+${num(this.last.xp)} XP${up ? ` · ${t('lobby.levelUp')}` : ''}`;
    }
  }

  private renderHints(): void {
    if (this.touch) return;
    const bar = el('div', 'lb-hints', this.frame);
    const hint = (key: string, what: MessageKey) => {
      const h = el('span', 'lb-hint', bar);
      el('span', 'keycap', h).textContent = key;
      el('span', '', h).textContent = t(what);
    };
    if (this.tab === 'settings' && (this.phase === 'menu' || this.phase === 'custom')) hint('Q / E', 'lobby.hint.tabs');
    else if (this.phase === 'menu') {
      hint('↑ ↓', 'lobby.hint.select');
      hint('← →', 'lobby.difficulty');
      hint('Enter', 'lobby.hint.start');
      hint('Q / E', 'lobby.hint.tabs');
    } else if (this.phase === 'custom') {
      hint('↑ ↓', 'lobby.hint.select');
      hint('← →', 'lobby.hint.change');
      hint('Enter', 'lobby.createRoom');
      hint('Esc', 'lobby.hint.back');
    } else if (this.phase === 'search') hint('Esc', 'lobby.cancel');
    else {
      if ((this.room?.options.length ?? 0) > 1) hint(`1 – ${this.room!.options.length}`, 'lobby.hint.vote');
      hint('Space', 'lobby.ready');
      hint('Esc', 'lobby.leave');
    }
  }

  // ---------------------------------------------------------------------------
  // Main menu: playlist tiles and the picked one's details

  private playlistName(p: Playlist): string {
    return t(`playlist.${p.id}` as MessageKey);
  }

  private renderMenu(body: HTMLElement): void {
    body.classList.add('lb-menu');
    const list = el('div', 'lb-tiles', body);
    el('div', 'lb-eyebrow', list).textContent = t('lobby.quickPlay');
    TILES.forEach((x, i) => {
      if (x.kind === 'custom') el('div', 'lb-eyebrow lb-eyebrow-gap', list).textContent = t('lobby.private');
      const b = el('button', `lb-tile${i === this.tile ? ' sel' : ''}${x.kind === 'playlist' && x.p.team >= BIG_TEAM ? ' big' : ''}`, list);
      const art = x.kind === 'playlist' ? x.p.maps[0]! : x.kind === 'range' ? RANGE_ID : this.pick.map;
      const thumb = this.thumb(art);
      if (thumb) b.style.setProperty('--art', `url(${thumb})`);
      const text = el('span', 'lb-tile-text', b);
      el('span', 'lb-tile-name', text).textContent = x.kind === 'playlist' ? this.playlistName(x.p) : t(x.kind === 'custom' ? 'lobby.custom' : 'map.sandbox');
      el('span', 'lb-tile-sub', text).textContent =
        x.kind === 'playlist' ? `${modeName(x.p.mode)} · ${x.p.team} vs ${x.p.team}` : t(x.kind === 'custom' ? 'lobby.customSub' : 'lobby.rangeSub');
      if (x.kind === 'playlist' && x.p.team >= BIG_TEAM) el('span', 'lb-tile-tag', b).textContent = t('lobby.bigTag');
      b.addEventListener('click', () => {
        if (this.tile === i) return this.activate();
        this.tile = i;
        this.save();
        this.render();
      });
    });
    this.renderDetail(body, TILES[this.tile]!);
    this.updateBackground(TILES[this.tile]!.kind === 'playlist' ? (TILES[this.tile] as { p: Playlist }).p.maps[0]! : TILES[this.tile]!.kind === 'range' ? RANGE_ID : this.pick.map);
  }

  /** The picked tile: what it is, its maps, bot difficulty, and the button. */
  private renderDetail(body: HTMLElement, x: Tile): void {
    const d = el('div', 'lb-detail', body);
    // Key art: the first map from above, fading into the panel.
    const hero = el('div', 'lb-hero', d);
    const art = this.thumb(x.kind === 'playlist' ? x.p.maps[0]! : x.kind === 'range' ? RANGE_ID : this.pick.map);
    if (art) hero.style.backgroundImage = `url(${art})`;
    el('div', 'lb-eyebrow', d).textContent = x.kind === 'playlist' ? `${modeName(x.p.mode)} · ${x.p.team} vs ${x.p.team}` : x.kind === 'custom' ? t('lobby.private') : t('lobby.solo');
    el('div', 'lb-title', d).textContent = x.kind === 'playlist' ? this.playlistName(x.p) : t(x.kind === 'custom' ? 'lobby.custom' : 'map.sandbox');
    el('div', 'lb-text', d).textContent =
      x.kind === 'playlist' ? `${t(`playlistDesc.${x.p.id}` as MessageKey)} ${t(`modeDesc.${x.p.mode}` as MessageKey)}` : t(x.kind === 'custom' ? 'lobby.customDesc' : 'lobby.rangeNote');
    if (x.kind === 'playlist') {
      el('div', 'lb-head', d).textContent = t('lobby.rotation');
      const maps = el('div', 'lb-rotation', d);
      for (const id of x.p.maps) {
        const m = el('div', 'lb-rmap', maps);
        const pic = el('div', 'lb-rmap-pic', m);
        const thumb = this.thumb(id);
        if (thumb) pic.style.backgroundImage = `url(${thumb})`;
        el('div', 'lb-rmap-name', m).textContent = t(`map.${id}` as MessageKey);
      }
    }
    if (x.kind !== 'range') {
      const r = el('div', 'lb-srow lb-diff', d);
      el('span', 'lb-srow-label', r).textContent = t('lobby.difficulty');
      const left = el('button', 'lb-arrow', r);
      left.textContent = '◀';
      el('span', 'lb-srow-val', r).textContent = t(`lobby.diff.${this.pick.difficulty}` as MessageKey);
      const right = el('button', 'lb-arrow', r);
      right.textContent = '▶';
      left.addEventListener('click', () => this.stepDifficulty(-1));
      right.addEventListener('click', () => this.stepDifficulty(1));
    }
    this.startButton(d, x.kind === 'playlist' ? 'lobby.find' : x.kind === 'custom' ? 'lobby.setUp' : 'lobby.startRange', () => this.activate());
  }

  private stepDifficulty(d: number): void {
    this.pick.difficulty = step(DIFFICULTIES, this.pick.difficulty, d);
    this.save();
    this.render();
  }

  private activate(): void {
    const x = TILES[this.tile]!;
    this.save();
    if (x.kind === 'range') this.finish({ ...this.pick, map: RANGE_ID });
    else if (x.kind === 'custom') {
      this.phase = 'custom';
      this.render();
    } else this.startSearch(x.p);
  }

  private startButton(parent: HTMLElement, label: MessageKey, onClick: () => void): HTMLButtonElement {
    const go = el('button', 'lb-start', parent);
    el('span', 'lb-start-text', go).textContent = t(label);
    if (!this.touch) el('span', 'keycap', go).textContent = 'Enter';
    go.addEventListener('click', onClick);
    return go;
  }

  private toMenu(): void {
    window.clearInterval(this.timer);
    this.search = null;
    this.room = null;
    this.phase = 'menu';
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Custom game: setup rows and the map's card

  private renderCustom(body: HTMLElement): void {
    body.classList.add('lb-custom');
    const p = this.pick;
    const setup = el('div', 'lb-setup', body);
    el('div', 'lb-eyebrow', setup).textContent = t('lobby.private');
    el('div', 'lb-title', setup).textContent = t('lobby.custom');
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
        if (this.focus === i) return;
        this.focus = i;
        this.render();
      });
      left.addEventListener('click', () => this.change(id, -1));
      right.addEventListener('click', () => this.change(id, 1));
    });
    el('div', `lb-desc${ROWS[this.focus] === 'team' && p.team >= BIG_TEAM ? ' warn' : ''}`, setup).textContent = this.describe(ROWS[this.focus]!);
    const buttons = el('div', 'lb-buttons', setup);
    const back = el('button', 'lb-ghost', buttons);
    back.textContent = t('lobby.hint.back');
    back.addEventListener('click', () => this.toMenu());
    this.startButton(buttons, 'lobby.createRoom', () => this.openRoom(null));
    this.mapCard(body, p.map, modeName(p.mode));
    this.updateBackground(p.map);
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
  private mapCard(body: HTMLElement, id: string, badge: string): HTMLElement {
    const card = el('div', 'lb-card', body);
    const pic = el('div', 'lb-card-pic', card);
    const canvas = this.picture(id);
    if (canvas) pic.appendChild(canvas);
    else el('div', 'lb-loading', pic).textContent = t('loading');
    const info = el('div', 'lb-card-info', card);
    el('div', 'lb-card-badge', info).textContent = badge;
    el('div', 'lb-card-name', info).textContent = t(`map.${id}` as MessageKey);
    const map = this.maps.get(id);
    if (map && id !== RANGE_ID) el('div', 'lb-card-facts', info).textContent = this.mapFacts(map);
    el('div', 'lb-card-desc', info).textContent = t(`mapDesc.${id}` as MessageKey);
    return card;
  }

  /** "5 zones · 500 × 360 m". */
  private mapFacts(map: MapDef): string {
    const pts = outline(map);
    const w = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
    const d = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
    return `${t('lobby.zones').replace('{n}', String(map.zones?.length ?? 0))} · ${Math.round(w)} × ${Math.round(d)} m`;
  }

  // ---------------------------------------------------------------------------
  // Searching

  private startSearch(p: Playlist): void {
    const [lo, hi] = ROOM.search;
    this.search = { left: lo + Math.random() * (hi - lo), total: p.team * 2, time: 0, count: null, playlist: p };
    this.phase = 'search';
    this.render();
    this.prefetch();
    this.startTimer();
  }

  private renderSearch(body: HTMLElement): void {
    const s = this.search!;
    body.classList.add('lb-searchbody');
    const box = el('div', 'lb-search', body);
    el('div', 'lb-eyebrow', box).textContent = `${this.playlistName(s.playlist)} · ${s.playlist.team} vs ${s.playlist.team}`;
    el('div', 'lb-search-title', box).textContent = t('lobby.searching');
    el('div', 'lb-search-bar', box);
    s.count = el('div', 'lb-search-count', box);
    const cancel = el('button', 'lb-ghost', box);
    cancel.textContent = t('lobby.cancel');
    cancel.addEventListener('click', () => this.toMenu());
    this.updateBackground(s.playlist.maps[0]!);
    this.tickSearch(0);
  }

  private tickSearch(dt: number): void {
    const s = this.search!;
    s.time += dt;
    s.left -= dt;
    // Players found: most at once, the last few trickling in.
    const found = Math.min(s.total, Math.max(1, Math.round(s.total * Math.min(1, s.time / (s.time + Math.max(0.01, s.left))) ** 0.6)));
    if (s.count) s.count.textContent = t('lobby.searchPlayers').replace('{n}', String(found)).replace('{m}', String(s.total));
    if (s.left <= 0) this.openRoom(s.playlist);
  }

  private startTimer(): void {
    window.clearInterval(this.timer);
    this.lastTick = performance.now();
    this.timer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.5, (now - this.lastTick) / 1000);
      this.lastTick = now;
      if (this.phase === 'search') this.tickSearch(dt);
      else if (this.phase === 'room') this.tickRoom(dt);
    }, 100);
  }

  // ---------------------------------------------------------------------------
  // The room: roster, vote, countdown

  private openRoom(playlist: Playlist | null): void {
    const options = playlist ? voteMaps(playlist) : [this.pick.map];
    const pick: LobbyPick = playlist ? { map: options[0]!, mode: playlist.mode, team: playlist.team, difficulty: this.pick.difficulty } : { ...this.pick };
    const fill = playlist ? ROOM.fill : ROOM.customFill;
    const members: Member[] = [{ name: t('lobby.player'), team: 'blue', cls: playerClass(), level: levelOf(this.career.xp).level, you: true, joinAt: 0, voteAt: Infinity, vote: -1, row: null }];
    const bot = (team: Team, i: number, cls: ClassId): Member => {
      const name = botName(team, i);
      const r = Math.random();
      const joinAt = 0.25 + fill * r * r;
      return { name, team, cls, level: botLevel(`${team}:${name}`), you: false, joinAt, voteAt: joinAt + 0.8 + Math.random() * 9, vote: -1, row: null };
    };
    // Named and classed as BotManager will: allies after the player in the roster.
    for (let i = 0; i < pick.team - 1; i++) members.push(bot('blue', i, botClass(i + 1)));
    for (let i = 0; i < pick.team; i++) members.push(bot('red', i, botClass(i)));
    members.sort((a, b) => a.joinAt - b.joinAt);
    this.room = { playlist, pick, options, members, time: 0, left: null, locked: options.length < 2, winner: 0, ready: false, starting: false };
    this.search = null;
    this.phase = 'room';
    this.save();
    this.render();
    this.prefetch();
    this.startTimer();
  }

  private renderRoom(body: HTMLElement): void {
    const r = this.room!;
    body.classList.add('lb-room');
    const side = el('div', 'lb-rside', body);
    const name = r.playlist ? this.playlistName(r.playlist) : t('lobby.custom');
    const mode = modeName(r.pick.mode);
    el('div', 'lb-eyebrow', side).textContent = `${name}${name.includes(mode) ? '' : ` · ${mode}`} · ${r.pick.team} vs ${r.pick.team}`;
    el('div', 'lb-title', side).textContent = t('lobby.room');
    const clockBox = el('div', 'lb-clock', side);
    const status = el('div', 'lb-clock-label', clockBox);
    const timer = el('div', 'lb-clock-time', clockBox);
    const sub = el('div', 'lb-clock-sub', clockBox);
    el('div', 'lb-head', side).textContent = r.options.length > 1 ? t('lobby.vote') : t('lobby.map');
    const votes = el('div', 'lb-votes', side);
    const buttons = el('div', 'lb-buttons', side);
    const leave = el('button', 'lb-ghost', buttons);
    leave.textContent = t('lobby.leave');
    leave.addEventListener('click', () => this.toMenu());
    const ready = this.startButton(buttons, 'lobby.ready', () => this.setReady());
    ready.classList.add('lb-ready');
    const keycap = ready.querySelector('.keycap');
    if (keycap) keycap.textContent = 'Space';

    const preview = el('div', 'lb-rpreview', body);

    const roster = el('div', 'lb-roster', body);
    const count = el('div', 'lb-head lb-count', roster);
    const lists = {} as Record<Team, HTMLElement>;
    const heads = {} as Record<Team, HTMLElement>;
    const scroll = el('div', 'lb-roster-scroll', roster);
    for (const team of ['blue', 'red'] as const) {
      heads[team] = el('div', `lb-team-head ${team === 'blue' ? 'ally' : 'enemy'}`, scroll);
      lists[team] = el('div', 'lb-team', scroll);
    }
    this.ui = { status, timer, sub, count, voteBox: votes, votes: [], preview, previewFor: '', lists, heads, ready };
    for (const m of r.members) m.row = null;
    this.buildVotes();
    this.tickRoom(0);
  }

  /** The vote's map cards (rebuilt when a picture arrives or the vote closes). */
  private buildVotes(): void {
    const r = this.room;
    const ui = this.ui;
    if (!r || !ui) return;
    ui.votes = [];
    const box = ui.voteBox;
    box.replaceChildren();
    r.options.forEach((id, i) => {
      const card = el('button', 'lb-vote', box);
      const pic = el('span', 'lb-vote-pic', card);
      const thumb = this.thumb(id);
      if (thumb) pic.style.backgroundImage = `url(${thumb})`;
      const text = el('span', 'lb-vote-text', card);
      el('span', 'lb-vote-name', text).textContent = t(`map.${id}` as MessageKey);
      const map = this.maps.get(id);
      el('span', 'lb-vote-facts', text).textContent = map ? this.mapFacts(map) : '';
      const count = el('span', 'lb-vote-count', card);
      if (r.options.length > 1 && !this.touch) el('span', 'keycap lb-vote-key', card).textContent = String(i + 1);
      const bar = el('span', 'lb-vote-bar', card);
      card.addEventListener('click', () => this.vote(i));
      ui.votes.push({ card, count, bar });
    });
    ui.previewFor = '';
    this.updateRoom();
  }

  private vote(i: number): void {
    const r = this.room;
    if (!r || r.locked || i >= r.options.length) return;
    r.members.find((m) => m.you)!.vote = i;
    this.updateRoom();
  }

  /** Ready: everyone is in, the vote closes, the countdown jumps near its end. */
  private setReady(): void {
    const r = this.room;
    if (!r || r.ready || r.starting) return;
    r.ready = true;
    for (const m of r.members) m.joinAt = Math.min(m.joinAt, r.time);
    r.left = Math.min(r.left ?? ROOM.ready, ROOM.ready);
    this.tickRoom(0);
  }

  private tally(): number[] {
    const r = this.room!;
    const counts = r.options.map(() => 0);
    for (const m of r.members) if (m.vote >= 0) counts[m.vote]!++;
    return counts;
  }

  private lockVote(): void {
    const r = this.room!;
    const counts = this.tally();
    const best = Math.max(...counts);
    const tied = counts.flatMap((c, i) => (c === best ? [i] : []));
    const mine = r.members.find((m) => m.you)!.vote;
    // A tie goes the player's way if they voted for one of the tied maps.
    r.winner = tied.includes(mine) ? mine : tied[Math.floor(Math.random() * tied.length)]!;
    r.pick.map = r.options[r.winner]!;
    r.locked = true;
  }

  private tickRoom(dt: number): void {
    const r = this.room;
    if (!r || !this.ui) return;
    r.time += dt;
    for (const m of r.members) if (!m.row && m.joinAt <= r.time) this.addRow(m);
    if (r.left === null) {
      if (r.time >= (r.playlist ? ROOM.fill : ROOM.customFill) + 0.4) r.left = r.playlist ? ROOM.countdown : ROOM.customCountdown;
    } else r.left = Math.max(0, r.left - dt);
    if (!r.locked) {
      for (const m of r.members) if (!m.you && m.row && m.vote < 0 && (m.voteAt <= r.time || r.ready)) m.vote = Math.floor(Math.random() * r.options.length);
      if (r.left !== null && r.left <= ROOM.voteClose) this.lockVote();
    }
    if (r.left === 0 && !r.starting) {
      r.starting = true;
      window.setTimeout(() => this.finish(r.pick), 700);
    }
    this.updateRoom();
  }

  private addRow(m: Member): void {
    const ui = this.ui!;
    const row = el('div', `lb-member${m.you ? ' you' : ''}`, ui.lists[m.team]);
    el('span', 'lb-lv', row).textContent = String(m.level);
    const icon = el('span', 'lb-cls', row);
    icon.innerHTML = CLASS_ICON[m.cls];
    icon.title = t(`class.${m.cls}` as MessageKey);
    el('span', 'lb-member-name', row).textContent = m.name;
    if (m.you) el('span', 'lb-you', row).textContent = t('feed.you');
    m.row = row;
  }

  private updateRoom(): void {
    const r = this.room;
    const ui = this.ui;
    if (!r || !ui) return;
    if (r.starting) {
      ui.status.textContent = t('lobby.loadingMatch');
      ui.timer.textContent = '0:00';
    } else if (r.left === null) {
      ui.status.textContent = t('lobby.waiting');
      ui.timer.textContent = '–:––';
    } else {
      ui.status.textContent = t('lobby.startsIn');
      ui.timer.textContent = clock(Math.ceil(r.left));
    }
    ui.timer.classList.toggle('soon', r.left !== null && r.left <= 5);
    ui.sub.textContent = r.options.length < 2 ? t(`map.${r.pick.map}` as MessageKey) : r.locked ? `${t('lobby.nextMap')}: ${t(`map.${r.pick.map}` as MessageKey)}` : t('lobby.voting');

    const counts = this.tally();
    const voted = counts.reduce((a, c) => a + c, 0);
    const mine = r.members.find((m) => m.you)!.vote;
    ui.votes.forEach((v, i) => {
      v.count.textContent = r.options.length > 1 ? t('lobby.votes').replace('{n}', String(counts[i])) : '';
      v.bar.style.setProperty('--p', String(voted ? counts[i]! / voted : 0));
      v.card.classList.toggle('mine', i === mine);
      v.card.classList.toggle('won', r.locked && i === r.winner && r.options.length > 1);
      v.card.classList.toggle('lost', r.locked && i !== r.winner);
    });

    // The middle shows the winner, else the player's vote, else the one ahead.
    const lead = counts.indexOf(Math.max(...counts));
    const show = r.options[r.locked ? r.winner : mine >= 0 ? mine : Math.max(0, lead)]!;
    if (ui.previewFor !== show && (this.picture(show) || !ui.previewFor)) {
      ui.previewFor = show;
      ui.preview.replaceChildren();
      this.mapCard(ui.preview, show, modeName(r.pick.mode));
      this.updateBackground(show);
    }

    let n = 0;
    for (const team of ['blue', 'red'] as const) {
      const inTeam = r.members.filter((m) => m.team === team);
      const joined = inTeam.filter((m) => m.row).length;
      n += joined;
      const role = r.pick.mode === 'conquest' ? ` · ${t(team === 'blue' ? 'mode.defend' : 'mode.attack')}` : '';
      ui.heads[team].textContent = `${t(team === 'blue' ? 'lobby.allies' : 'lobby.enemies')}${role}  ${joined} / ${inTeam.length}`;
    }
    ui.count.textContent = t('lobby.searchPlayers').replace('{n}', String(n)).replace('{m}', String(r.members.length));
    ui.ready.classList.toggle('done', r.ready);
    ui.ready.querySelector('.lb-start-text')!.textContent = t(r.ready ? 'lobby.readyDone' : 'lobby.ready');
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

  /** The picture as an image address (tiles, vote cards, the background). */
  private thumb(id: string): string | null {
    const cached = this.thumbs.get(id);
    if (cached) return cached;
    const c = this.picture(id);
    if (!c) return null;
    const url = c.toDataURL('image/jpeg', 0.72);
    this.thumbs.set(id, url);
    return url;
  }

  /** The map in focus, blurred and dark, behind everything. */
  private bgFor = '';
  private updateBackground(id: string): void {
    if (this.bgFor === id) return;
    const url = this.thumb(id);
    if (!url) return;
    this.bgFor = id;
    this.bg.style.backgroundImage = `url(${url})`;
  }
}
