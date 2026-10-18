import { setLocale, t, type MessageKey } from '@/i18n';
import { isTouchDevice, loadSettings, saveSettings, type Settings } from '@/core/Settings';
import { loadJSON, saveJSON } from '@/core/storage';
import { BIG_TEAM, MAPS, RANGE_ID, SIDES, TEAM_SIZES, matchQuery, snapTeam, type Difficulty, type LobbyMode, type LobbyPick } from '@/data/maps';
import type { MapDef } from '@/world/mapTypes';
import { mapOutline, paintMapCard } from './mapPainter';
import { icon } from './icons';
import { loadUiSounds, setUiVolume, uiSound } from '@/audio/uiSounds';
import './ds.css';
import './mainMenu.css';
import './menuPages.css';
import { renderHint } from './Overlay';
import { SettingsPanel } from './SettingsPanel';
import { MultiplayerMenu } from './MultiplayerMenu';
import { askName } from './NameDialog';
import { installState, onInstallChange, promptInstall } from './install';
import './dialogs.css';
import { loadIdentity } from '@/net/identity';
import { inRoom } from '@/core/session';
import { simpleAllowed, type MatchStart } from '@/net/lobbyProtocol';
import { CREDITS } from '@/data/credits';
import { SOLO_LOBBY_MODES, renderMatchSetup, simpleField, stepGroup, stepMode, type SetupField, type SetupMap } from './MatchSetup';
import type { ServerLink } from '@/net/ServerLink';

const PICK_KEY = 'strikegy.lobby.v1';
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** The main menu's entries, top to bottom: play the biggest, then two more, then the small ones. */
const ALL_ENTRIES = ['play', 'multi', 'range', 'tutorial', 'controls', 'settings', 'credits'] as const;
type Entry = (typeof ALL_ENTRIES)[number];
const ENTRIES: readonly Entry[] = ALL_ENTRIES;
const BIG_ENTRIES: readonly Entry[] = ['multi', 'range'];
type Screen = 'main' | 'play' | 'multi' | 'controls' | 'settings' | 'credits';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

/** Modes a map offers (Zone whenever it has zones, skirmish always). */
function modesOf(map: MapDef | undefined): LobbyMode[] {
  const out: LobbyMode[] = [];
  // A fleet map plays its fleet battle only.
  if (map?.modes?.fleet) return ['fleet'];
  if (!map || (map.zones?.length ?? 0) > 0) {
    out.push('zone');
    if (map?.modes?.frontline) out.push('frontline');
    if (map?.modes?.conquest) out.push('conquest');
    if (!map || (map.zones?.length ?? 0) >= 2) out.push('hardpoint');
    out.push('tdm', 'killconfirm', 'ffa', 'gungame', 'lastman');
    if (!map || (map.zones?.length ?? 0) >= 2) out.push('rush', 'snd', 'escort', 'fortress');
  }
  out.push('skirmish');
  return out;
}

/** The playable area's width and depth (m, rounded). */
function mapSize(map: MapDef): [number, number] {
  const pts = mapOutline(map);
  const w = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  const d = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
  return [Math.round(w), Math.round(d)];
}

const step = <T>(list: readonly T[], cur: T, d: number): T => list[(Math.max(0, list.indexOf(cur)) + d + list.length) % list.length]!;
const modeName = (m: LobbyMode): string => t(m === 'skirmish' ? 'lobby.skirmish' : (`mode.${m}` as MessageKey));

/**
 * The main menu: a screen of its own before any match, on the design system
 * (ds.css, BFV theme; mainMenu.css): the name, one big entry (play) over the
 * rest, the player's card top right, and a card that starts the last setup
 * again, over the menu film (main.ts) or the last map drifting behind. Play
 * opens the game setup (mode, map, players a side, bot difficulty, the map's
 * picture) and its start button goes straight into the match; the range
 * starts at once. `onStart` gets the match address (main.ts loads the game).
 */
export class Lobby {
  readonly root: HTMLDivElement;
  private screen: Screen = 'main';
  private entry = 0;
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
  /** The "continue" card's picture (filled in once the map has loaded). */
  private continuePic: HTMLElement | null = null;
  private readonly pictureUrls = new Map<string, string>();
  private multi: MultiplayerMenu | null = null;
  /** The settings page's panel (Q / E step its tabs). */
  private settingsPanel: SettingsPanel | null = null;
  private playerName = loadIdentity().name;

  constructor(
    container: HTMLElement,
    private readonly onStart: (query: string) => void,
    private readonly prefetch: () => void = () => {},
    /** A room's match on the game server starts: the game takes it from here. */
    private readonly onNetStart: (start: MatchStart, link: ServerLink) => void = () => {},
    /** A setting changed (already saved). */
    private readonly onSetting: (key: keyof Settings) => void = () => {},
  ) {
    setLocale(this.settings.locale);
    // The install button comes and goes with the browser's install event.
    onInstallChange(() => {
      if (this.screen === 'main') this.render();
    });
    const saved = loadJSON<Partial<LobbyPick>>(PICK_KEY) ?? {};
    const entry = MAPS.find((m) => m.id === saved.map);
    this.pick = {
      map: entry ? entry.id : MAPS[0]!.id,
      mode: saved.mode ?? 'zone',
      team: snapTeam(saved.team ?? entry?.team ?? MAPS[0]!.team),
      difficulty: DIFFICULTIES.includes(saved.difficulty as Difficulty) ? saved.difficulty! : 'normal',
      side: SIDES.find((s) => s === saved.side) ?? 'random',
      simple: saved.simple === true,
    };
    this.root = el('div', 'lobby', container);
    this.bg = el('div', 'lb-bg', this.root);
    el('div', 'lb-shade', this.root);
    this.frame = el('div', 'lb-frame', this.root);
    window.addEventListener('keydown', this.onKey);
    // Menu sounds: browsers start audio only after a press, so the clips load then.
    setUiVolume(this.settings.masterVolume);
    for (const ev of ['pointerdown', 'keydown'] as const) document.addEventListener(ev, () => void loadUiSounds(), { once: true });
    this.render();
    for (const m of [...MAPS.map((e) => e.id), RANGE_ID]) void this.load(m);
    // First visit: a name before anything else.
    if (!this.playerName) this.editName(true);
    // Back from a match (or reloaded in one): straight to the multiplayer pages.
    else if (inRoom() || new URLSearchParams(location.search).has('multi')) this.go('multi');
  }

  private editName(required: boolean): void {
    askName(
      this.root,
      this.playerName,
      required,
      (name) => {
        if (name) this.playerName = name;
        this.render();
      },
      () => this.toggleLocale(),
    );
  }

  /** Korean <-> English, at once (a button named in the other language, so either reader finds it). */
  private toggleLocale(): void {
    this.settings.locale = this.settings.locale === 'ko' ? 'en' : 'ko';
    saveSettings(this.settings);
    setLocale(this.settings.locale);
    this.render();
  }

  /** The map the menu shows behind it (the last one picked). */
  get backdropMap(): string {
    return this.pick.map;
  }

  private save(): void {
    saveJSON(PICK_KEY, this.pick);
  }

  /** Leaves for the match (main.ts takes the menu down once the loading screen is up). */
  private finish(pick: LobbyPick, extra = ''): void {
    uiSound('start');
    this.save();
    window.removeEventListener('keydown', this.onKey);
    this.onStart(matchQuery(pick) + extra);
  }

  private go(screen: Screen): void {
    if (screen !== 'multi' && this.multi) {
      this.multi.close();
      this.multi = null;
    }
    if (screen === 'multi')
      this.multi ??= new MultiplayerMenu({
        modesFor: (map) => modesOf(this.maps.get(map)),
        setupMaps: () => this.setupMaps(),
        redraw: () => {
          if (this.screen === 'multi' && this.multi) this.render();
        },
        device: this.touch ? 'mobile' : 'desktop',
        startMatch: (start, link) => {
          window.removeEventListener('keydown', this.onKey);
          this.multi?.handOver();
          this.multi = null;
          this.onNetStart(start, link);
        },
      });
    this.screen = screen;
    // The game's code starts downloading while the player sets up.
    if (screen === 'play' || screen === 'multi') this.prefetch();
    this.render();
  }

  private activate(e: Entry): void {
    if (e === 'range') this.finish({ ...this.pick, map: RANGE_ID });
    else if (e === 'tutorial') this.finish({ ...this.pick, map: RANGE_ID }, '&tutorial');
    else {
      uiSound('select');
      this.go(e);
    }
  }

  /** Back one page (the multiplayer pages step back inside themselves first). */
  private back(): void {
    uiSound('back');
    if (this.screen === 'multi' && this.multi?.back()) return;
    this.go('main');
  }

  private onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    const key = e.code;
    if (key.startsWith('Arrow') || key === 'Enter') e.preventDefault();
    if (this.screen === 'main') {
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        // Stops at the ends (it used to wrap from play to credits).
        const i = Math.max(0, Math.min(ENTRIES.length - 1, this.entry + (key === 'ArrowUp' ? -1 : 1)));
        if (i !== this.entry) uiSound('move');
        this.select(i);
      } else if (key === 'Enter') this.activate(ENTRIES[this.entry]!);
      else if (key === 'KeyF') this.finish(this.pick);
      return;
    }
    if (key === 'Escape' || key === 'Backspace') return this.back();
    if (this.screen === 'settings' && this.settingsPanel && (key === 'KeyQ' || key === 'KeyE')) return this.settingsPanel.stepCategory(key === 'KeyQ' ? -1 : 1);
    if (this.screen === 'multi' && this.multi?.key(key)) return;
    if (this.screen !== 'play') return;
    // The setup page: Q / E mode group, ↑ ↓ mode, ← → map, Enter start.
    const offered = modesOf(this.maps.get(this.pick.map));
    if (key === 'KeyQ' || key === 'KeyE') {
      uiSound('move');
      this.setMode(stepGroup(this.pick.mode, offered, key === 'KeyQ' ? -1 : 1));
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      uiSound('move');
      this.setMode(stepMode(this.pick.mode, offered, key === 'ArrowUp' ? -1 : 1));
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      uiSound('move');
      this.setMap(this.step(MAPS.map((m) => m.id), this.pick.map, key === 'ArrowLeft' ? -1 : 1));
    } else if (key === 'Enter') this.finish(this.pick);
  };

  private step<T>(list: readonly T[], cur: T, d: number): T {
    return step(list, cur, d);
  }

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
      this.paintContinue();
    }
    // The setup pages show every map's picture.
    if (this.screen === 'play' || this.screen === 'multi') this.render();
  }

  /** Moves the highlight of the main entries in place: the entrance doesn't replay. */
  private select(i: number): void {
    if (this.screen !== 'main') return;
    this.entry = i;
    this.picks.forEach((e, k) => e.classList.toggle('sel', k === i));
  }

  private render(): void {
    this.frame.replaceChildren();
    this.picks = [];
    this.continuePic = null;
    this.settingsPanel = null;
    // Every page is on the design system: the main screen (mainMenu.css) and the
    // pages in the `.dsp` frame (head with back + title, keys along the bottom).
    const main = this.screen === 'main';
    this.root.className = `lobby lb-scr-${this.screen} lb-ds`;
    this.frame.className = main ? 'lb-frame mm ds-root' : 'lb-frame dsp ds-root';
    this.frame.dataset.dsTheme = 'bfv';
    if (!main)
      this.renderPageHead(
        this.screen === 'play' ? 'lobby.setupTitle' : this.screen === 'multi' ? this.multi!.title : this.screen === 'controls' ? 'menu.controls' : this.screen === 'credits' ? 'menu.credits' : 'menu.settings',
      );
    const body = el('div', 'lb-body', this.frame);
    if (this.screen === 'main') this.renderMain(body);
    else if (this.screen === 'play') this.renderPlay(body);
    else if (this.screen === 'multi') this.multi!.render(body);
    else if (this.screen === 'controls') {
      body.classList.add('lb-controls');
      const keys = el('div', 'ds-keys lb-keys', body);
      renderHint(keys, t(this.touch ? 'start.hintTouch' : 'start.hint'));
    } else if (this.screen === 'credits') {
      body.classList.add('lb-credits');
      el('p', 'lb-credit-note', body).textContent = t('credits.note');
      const list = el('div', 'lb-credit-list', body);
      for (const c of CREDITS) {
        const row = el('a', 'ds-row lb-credit', list);
        row.href = c.url;
        row.target = '_blank';
        row.rel = 'noopener noreferrer';
        el('span', 'ds-row-main lb-credit-work', row).textContent = c.work;
        el('span', 'ds-row-side lb-credit-by', row).textContent = c.author;
        el('span', 'ds-badge line lb-credit-lic', row).textContent = c.license;
      }
    } else {
      body.classList.add('lb-settings');
      const panel = (this.settingsPanel = new SettingsPanel(this.settings, {
        live: false,
        onChange: (key) => {
          if (key === 'locale') this.render();
          this.onSetting(key);
        },
      }));
      body.appendChild(panel.root);
    }
    if (!main) this.renderPageFoot();
    this.updateBackground();
  }

  /** A design-system page's head: back (Esc) and the title. */
  private renderPageHead(title: MessageKey): void {
    const head = el('div', 'dsp-head', this.frame);
    const back = el('button', 'ds-btn ghost dsp-back', head);
    back.innerHTML = icon('back');
    el('span', '', back).textContent = t('lobby.hint.back');
    if (!this.touch) el('span', 'ds-kbd', back).textContent = 'ESC';
    back.addEventListener('pointerenter', () => uiSound('hover'));
    back.addEventListener('click', () => this.back());
    el('div', 'dsp-title', head).textContent = t(title);
  }

  /** A page's keys along the bottom (keyboard only). */
  private renderPageFoot(): void {
    if (this.touch) return;
    const foot = el('div', 'dsp-foot', this.frame);
    const hint = (keys: string[], what: string) => {
      const h = el('span', 'ds-hint', foot);
      for (const k of keys) el('span', 'ds-kbd', h).textContent = k;
      el('span', '', h).textContent = what;
    };
    const setup = this.screen === 'play' || (this.screen === 'multi' && !!this.multi?.onSetupPage);
    if (setup) {
      hint(['Q', 'E'], t('lobby.modeKind'));
      hint(['↑', '↓'], t('lobby.mode'));
      hint(['←', '→'], t('lobby.map'));
      hint(['ENTER'], t(this.screen === 'play' ? 'lobby.start' : this.multi!.setupStart));
    } else if (this.screen === 'settings') hint(['Q', 'E'], t('lobby.category'));
    else if (this.screen === 'multi') for (const [keys, what] of this.multi!.hints) hint(keys, what);
    hint(['ESC'], t('lobby.hint.back'));
  }

  // ---------------------------------------------------------------------------
  // Main: the name and the entries

  /** iPhone / iPad: there is no install button in the browser; the share menu adds the game to the home screen. */
  private iosInstallHelp(): void {
    const shade = el('div', 'dlg-shade ds-root', this.root);
    shade.dataset.dsTheme = 'bfv';
    const box = el('div', 'ds-dialog dlg', shade);
    el('h3', '', box).textContent = t('install.title');
    const steps = el('ol', 'dlg-steps', box);
    const share = el('li', '', steps);
    share.append(t('install.ios1'), ' ');
    share.insertAdjacentHTML('beforeend', icon('share'));
    el('li', '', steps).textContent = t('install.ios2');
    el('li', '', steps).textContent = t('install.ios3');
    const row = el('div', 'ds-actions', box);
    const ok = el('button', 'ds-btn primary', row);
    ok.textContent = t('lobby.hint.ok');
    const close = () => {
      uiSound('back');
      shade.remove();
    };
    ok.addEventListener('click', close);
    shade.addEventListener('click', (e) => {
      if (e.target === shade) close();
    });
    ok.focus();
  }

  private renderMain(body: HTMLElement): void {
    body.classList.add('mm-body');
    const top = el('div', 'mm-top', body);
    el('div', 'mm-wordmark', top).textContent = t('title');
    const corner = el('div', 'mm-corner', top);
    // Install as an app (the browser's own dialog; on iPhones / iPads how to add it to the home screen).
    const inst = installState();
    if (inst !== 'none') {
      const b = el('button', 'ds-btn ghost mm-lang mm-install', corner);
      b.innerHTML = icon('install');
      el('span', '', b).textContent = t('install.button');
      b.title = t('install.title');
      b.addEventListener('pointerenter', () => uiSound('hover'));
      b.addEventListener('click', () => {
        uiSound('open');
        if (inst === 'prompt') void promptInstall();
        else this.iosInstallHelp();
      });
    }
    const lang = el('button', 'ds-btn ghost mm-lang', corner);
    lang.textContent = t('lobby.otherLanguage');
    lang.title = t('lobby.language');
    lang.addEventListener('click', () => {
      uiSound('select');
      this.toggleLocale();
    });
    const prof = el('button', 'mm-profile', corner);
    prof.title = t('name.label');
    prof.innerHTML = icon('user');
    el('span', 'mm-profile-name', prof).textContent = this.playerName ?? '—';
    prof.addEventListener('click', () => {
      uiSound('open');
      this.editName(false);
    });
    for (const b of [lang, prof]) b.addEventListener('pointerenter', () => uiSound('hover'));

    const menu = el('div', 'ds-menu mm-menu', body);
    ENTRIES.forEach((id, i) => {
      const size = id === 'play' ? ' hero' : BIG_ENTRIES.includes(id) ? '' : ' small';
      const b = el('button', `ds-menu-item${size}${i === this.entry ? ' sel' : ''}`, menu);
      b.style.setProperty('--i', String(i));
      b.textContent = t(`menu.${id}`);
      b.addEventListener('pointerenter', () => {
        if (this.touch) return;
        if (i !== this.entry) uiSound('hover');
        this.select(i);
      });
      b.addEventListener('click', () => this.activate(id));
      this.picks.push(b);
    });

    // The last setup, one press away.
    const p = this.pick;
    const card = el('button', 'ds-card mm-continue', body);
    this.continuePic = el('div', 'mm-continue-pic', card);
    const head = el('div', 'mm-continue-head', card);
    el('span', 'ds-badge accent', head).textContent = t('menu.continue');
    if (!this.touch) el('span', 'ds-kbd', head).textContent = 'F';
    const info = el('div', 'mm-continue-info', card);
    el('div', 'ds-card-name', info).textContent = t(`map.${p.map}` as MessageKey);
    el('div', 'ds-dim', info).textContent = `${modeName(p.mode)} · ${p.team} vs ${p.team} · ${t('lobby.difficulty')} ${t(`lobby.diff.${p.difficulty}` as MessageKey)}`;
    card.addEventListener('pointerenter', () => uiSound('hover'));
    card.addEventListener('click', () => this.finish(this.pick));
    this.paintContinue();

    const foot = el('div', 'mm-foot', body);
    if (!this.touch) {
      const hint = (keys: string[], what: string) => {
        const h = el('span', 'ds-hint', foot);
        for (const k of keys) el('span', 'ds-kbd', h).textContent = k;
        el('span', '', h).textContent = what;
      };
      hint(['↑', '↓'], t('lobby.hint.select'));
      hint(['ENTER'], t('lobby.hint.ok'));
      hint(['F'], t('menu.continue'));
    }
    el('span', 'mm-version ds-label', foot).textContent = t('menu.version');
  }

  /** The continue card's picture: the picked map from above. */
  private paintContinue(): void {
    const url = this.pictureUrl(this.pick.map);
    if (this.continuePic && url) this.continuePic.style.backgroundImage = `url(${url})`;
  }

  // ---------------------------------------------------------------------------
  // Play: the setup rows and the map's card

  private renderPlay(body: HTMLElement): void {
    const p = this.pick;
    const fields: SetupField[] = [
      {
        kind: 'stepper',
        id: 'team',
        label: t('lobby.team'),
        value: `${p.team} vs ${p.team}`,
        warn: p.team >= BIG_TEAM,
        note: p.team >= BIG_TEAM ? t('lobby.bigTeam') : t('lobby.teamHint').replace('{n}', String(MAPS.find((m) => m.id === p.map)?.team ?? 12)),
        change: (d) => {
          const i = TEAM_SIZES.indexOf(p.team as (typeof TEAM_SIZES)[number]);
          p.team = TEAM_SIZES[Math.max(0, Math.min(TEAM_SIZES.length - 1, i + d))]!;
          this.saveAndRender();
        },
      },
    ];
    // Free-for-all has no sides to pick.
    if (!SOLO_LOBBY_MODES.includes(p.mode)) {
      fields.push({
        kind: 'choice',
        id: 'side',
        label: t('lobby.side'),
        note: t('lobby.sideDesc'),
        options: SIDES.map((s) => ({ value: s, label: t(`lobby.side.${s}` as MessageKey) })),
        value: p.side,
        pick: (v) => {
          p.side = v as LobbyPick['side'];
          this.saveAndRender();
        },
      });
    }
    fields.push({
      kind: 'choice',
      id: 'difficulty',
      label: t('lobby.difficulty'),
      note: t(`lobby.diffDesc.${p.difficulty}` as MessageKey),
      options: DIFFICULTIES.map((d) => ({ value: d, label: t(`lobby.diff.${d}` as MessageKey) })),
      value: p.difficulty,
      pick: (v) => {
        p.difficulty = v as Difficulty;
        this.saveAndRender();
      },
    });
    // Fortress is about building, which the simplified controls take away.
    if (simpleAllowed(p.mode))
      fields.push(simpleField(!!p.simple, (on) => {
        p.simple = on;
        this.saveAndRender();
      }));
    renderMatchSetup(body, {
      mode: p.mode,
      map: p.map,
      offered: modesOf(this.maps.get(p.map)),
      maps: this.setupMaps(),
      fields,
      start: t('lobby.start'),
      summary: t('lobby.summary')
        .replace('{mode}', modeName(p.mode))
        .replace('{map}', t(`map.${p.map}` as MessageKey))
        .replaceAll('{n}', String(p.team))
        .replace('{diff}', t(`lobby.diff.${p.difficulty}` as MessageKey)),
      touch: this.touch,
      onMode: (m) => this.setMode(m),
      onMap: (id) => this.setMap(id),
      onStart: () => this.finish(this.pick),
    });
  }

  /** Every map for the setup page: picture (once loaded), facts, its team size, blurb. */
  setupMaps(): SetupMap[] {
    return MAPS.map((m) => {
      const def = this.maps.get(m.id);
      return {
        id: m.id,
        name: t(`map.${m.id}` as MessageKey),
        picture: this.picture(m.id),
        facts: def ? this.mapFacts(def) : '',
        zones: def ? (def.zones?.length ?? 0) : undefined,
        size: def ? mapSize(def) : undefined,
        team: m.team,
        blurb: t(`mapDesc.${m.id}` as MessageKey),
      };
    });
  }

  private setMode(m: LobbyMode): void {
    this.pick.mode = m;
    this.saveAndRender();
  }

  private setMap(id: string): void {
    const p = this.pick;
    if (p.map === id) return;
    p.map = id;
    p.team = MAPS.find((m) => m.id === id)!.team;
    // Keep the mode when the new map has it.
    if (!modesOf(this.maps.get(id)).includes(p.mode)) p.mode = this.maps.get(id)?.modes?.default ?? 'zone';
    this.fixMode();
    this.saveAndRender();
  }

  private saveAndRender(): void {
    this.save();
    this.render();
  }

  /** Keeps the mode to one the picked map offers (its own default when the old one isn't). */
  private fixMode(): void {
    const map = this.maps.get(this.pick.map);
    if (!map) return;
    const offered = modesOf(map);
    if (!offered.includes(this.pick.mode)) this.pick.mode = map.modes?.default ?? offered[0]!;
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
    const [w, d] = mapSize(map);
    return `${t('lobby.zones').replace('{n}', String(map.zones?.length ?? 0))} · ${w} × ${d} m`;
  }

  // ---------------------------------------------------------------------------
  // Pictures

  /** The map from above with its zones and both bases (drawn once per map). */
  private picture(id: string): HTMLCanvasElement | null {
    const cached = this.pictures.get(id);
    if (cached) return cached;
    const map = this.maps.get(id);
    if (!map) return null;
    const canvas = paintMapCard(map);
    canvas.className = 'lb-canvas';
    this.pictures.set(id, canvas);
    return canvas;
  }

  /** The same picture as an image address (backgrounds), made once per map. */
  private pictureUrl(id: string): string | null {
    const cached = this.pictureUrls.get(id);
    if (cached) return cached;
    const c = this.picture(id);
    if (!c) return null;
    const url = c.toDataURL('image/jpeg', 0.78);
    this.pictureUrls.set(id, url);
    return url;
  }

  /** The picked map, dark and drifting, behind everything. */
  private bgFor = '';
  private updateBackground(): void {
    const id = this.pick.map;
    if (this.bgFor === id) return;
    const url = this.pictureUrl(id);
    if (!url) return;
    this.bgFor = id;
    this.bg.style.backgroundImage = `url(${url})`;
  }
}
