import { t, type MessageKey } from '@/i18n';
import { MAPS, TEAM_SIZES, type LobbyMode } from '@/data/maps';
import { loadJSON, saveJSON } from '@/core/storage';
import { loadIdentity, seatId } from '@/net/identity';
import { ServerLink, ServerError } from '@/net/ServerLink';
import { serverUrls } from '@/net/servers';
import { chatOf, isMuted, setMuted } from '@/net/chat';
import { PROTOCOL_VERSION, hasSides, simpleAllowed, type Device, type Lineup, type InputRule, type MatchStart, type Member, type Room, type RoomInfo, type RoomSettings, type Side, type TeamPick } from '@/net/lobbyProtocol';
import { ChatPanel, nameView } from './ChatPanel';
import { modeName, renderMatchSetup, simpleField, stepGroup, stepMode, thumb, type SetupField, type SetupMap } from './MatchSetup';
import { uiSound } from '@/audio/uiSounds';
import { icon } from './icons';
import './multiplayer.css';

const CREATE_KEY = 'strikegy.mpCreate.v1';
const LINEUPS: readonly Lineup[] = ['users', 'usersBots', 'coop'];
const INPUTS: readonly InputRule[] = ['all', 'desktop', 'mobile'];
const PICKS: readonly TeamPick[] = ['random', 'self', 'host'];
const DIFFS = ['easy', 'normal', 'hard'] as const;
const SIDES: readonly Side[] = ['blue', 'red'];
/** Room sizes the form steps through: both sides of the solo team sizes (2..300). */
const SIZES = TEAM_SIZES.map((n) => n * 2);
/** How often the round trip to the server is measured (ms). */
const PING_EVERY = 2000;

type View = 'connecting' | 'offline' | 'list' | 'create' | 'edit' | 'room';
type Filter = 'all' | 'lobby' | 'playing';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** A design-system button with an optional icon before the label (and the hover sound). */
function button(parent: HTMLElement, cls: string, label: string, ic?: Parameters<typeof icon>[0]): HTMLButtonElement {
  const b = el('button', cls, parent);
  b.type = 'button';
  if (ic) b.insertAdjacentHTML('beforeend', icon(ic));
  if (label) el('span', '', b, label);
  b.addEventListener('pointerenter', () => uiSound('hover'));
  return b;
}

const step = <T>(list: readonly T[], cur: T, d: number): T => list[(Math.max(0, list.indexOf(cur)) + d + list.length) % list.length]!;
const mapName = (id: string): string => t(`map.${id}` as MessageKey);
const sideCap = (r: RoomInfo): number => Math.ceil(r.humanCap / 2);

export interface MultiplayerHost {
  /** Modes the map offers (from its JSON, once loaded). */
  modesFor(map: string): LobbyMode[];
  /** Every map with its picture and facts (the setup page). */
  setupMaps(): SetupMap[];
  /** Redraws the menu (the multiplayer page is drawn by `render`). */
  redraw(): void;
  device: Device;
  /** The room's match starts (or is under way and we're in): the game takes the connection. */
  startMatch(start: MatchStart, link: ServerLink): void;
}

/**
 * The multiplayer pages of the main menu (remade 2026-10-14; on the design
 * system since 2026-10-17, multiplayer.css): connect to the game server; the server browser (rooms with
 * their owner's tag, filters and search, the picked room's details and join
 * buttons, a side to join a match under way on where players pick); creating
 * a room or changing its settings (the shared setup page, plus who picks the
 * sides); and the waiting room (the two sides, or one list where the sides
 * are drawn at the start; moving between sides as the room's rule allows,
 * kicking, blocking someone's chat; the room's chat). Keeps the connection
 * while the menu redraws; `close` drops it.
 */
export class MultiplayerMenu {
  private view: View = 'connecting';
  link: ServerLink | null = null;
  /** The room we are in, as the server last sent it. */
  room: Room | null = null;
  /** Round trip to the server (ms), null until measured. */
  private ping: number | null = null;
  private pingTimer = 0;
  /** Where the round trip is shown (updated in place: a redraw would take the chat's focus). */
  private pingEls: HTMLElement[] = [];
  private rooms: RoomInfo[] = [];
  private selected: string | null = null;
  private filter: Filter = 'all';
  private search = '';
  /** Typed into the picked room's password box. */
  private password = '';
  private notice: string | null = null;
  private form: RoomSettings & { password: string };
  private redrawQueued = false;
  private offs: (() => void)[] = [];
  private chat: ChatPanel | null = null;

  constructor(private readonly host: MultiplayerHost) {
    const saved = loadJSON<Partial<RoomSettings>>(CREATE_KEY) ?? {};
    const name = loadIdentity().name ?? 'STRIKEGY';
    this.form = {
      name: typeof saved.name === 'string' && saved.name ? saved.name : t('mp.roomOf').replace('{name}', name),
      map: MAPS.some((m) => m.id === saved.map) ? saved.map! : MAPS[0]!.id,
      mode: saved.mode ?? 'zone',
      size: SIZES.includes(saved.size as (typeof SIZES)[number]) ? saved.size! : 24,
      lineup: LINEUPS.includes(saved.lineup as Lineup) ? saved.lineup! : 'users',
      difficulty: DIFFS.includes(saved.difficulty as (typeof DIFFS)[number]) ? saved.difficulty! : 'normal',
      input: INPUTS.includes(saved.input as InputRule) ? saved.input! : 'all',
      botShare: saved.botShare ?? true,
      teamPick: PICKS.includes(saved.teamPick as TeamPick) ? saved.teamPick! : 'random',
      chat: saved.chat !== false,
      simple: saved.simple === true,
      password: '',
    };
    void this.connect();
    if (import.meta.env.DEV) (window as unknown as { __mp: MultiplayerMenu }).__mp = this;
  }

  /** The create / edit page (the shared setup page, on the design system). */
  get onSetupPage(): boolean {
    return this.view === 'create' || this.view === 'edit';
  }

  /** What the setup page's start button does. */
  get setupStart(): MessageKey {
    return this.view === 'edit' ? 'mp.saveSettings' : 'mp.createGo';
  }

  /** The page's keys for the bottom line (the menu adds Esc). */
  get hints(): [string[], string][] {
    if (this.view === 'list') return [[['↑', '↓'], t('mp.hint.room')], [['ENTER'], t('mp.join')]];
    return [];
  }

  get title(): MessageKey {
    return this.view === 'create' ? 'mp.createTitle' : this.view === 'edit' ? 'mp.editTitle' : this.view === 'room' ? 'mp.roomTitle' : 'menu.multi';
  }

  private async connect(): Promise<void> {
    this.view = 'connecting';
    this.notice = null;
    const id = loadIdentity();
    try {
      const urls = await serverUrls();
      if (!urls.length) throw new ServerError('connect', 'no server');
      const link = await ServerLink.connect(urls, { name: id.name ?? 'player', uid: seatId(), device: this.host.device });
      this.link = link;
      const store = chatOf(link);
      this.chat?.dispose();
      this.chat = new ChatPanel({
        store,
        kind: 'room',
        send: (text, team) => link.send({ t: 'chat', text, team }),
        teamOk: () => !!this.room && hasSides(this.room.settings) && this.room.settings.teamPick !== 'random',
        myTeam: () => this.me()?.team ?? null,
        touch: this.host.device === 'mobile',
        blocked: () => (this.room && !this.room.settings.chat ? t('chat.off') : this.me()?.muted ? t('chat.youMuted') : null),
      });
      const offs = this.offs;
      offs.push(link.on('match', (m) => this.host.startMatch(m.match, link)));
      offs.push(link.on('close', () => {
        this.stopPing();
        this.room = null;
        this.view = 'offline';
        this.notice = t('mp.lost');
        this.host.redraw();
      }));
      offs.push(link.on('rooms', (m) => {
        this.rooms = m.rooms;
        if (this.view === 'list') this.host.redraw();
      }));
      offs.push(link.on('room', (m) => {
        this.room = m.room;
        if (this.view !== 'edit') this.view = 'room';
        this.queueRedraw();
      }));
      offs.push(link.on('left', (m) => {
        this.room = null;
        if (m.reason === 'kicked') this.notice = t('mp.kicked');
        if (m.reason === 'admin') this.notice = t('mp.closedByAdmin');
        if (this.view === 'room' || this.view === 'edit') this.showList();
      }));
      offs.push(link.on('error', (m) => {
        // Errors that answer no request of ours (a side change refused, a start too soon...).
        if (this.view !== 'room') return;
        this.notice = t(`mp.err.${m.code}` as MessageKey);
        this.queueRedraw();
      }));
      offs.push(link.on('pong', (m) => {
        this.ping = performance.now() - m.at;
        this.showPing();
      }));
      this.startPing();
      // Back from a match (or a reload) the server may have put us straight back in our room.
      if (!this.room) this.showList();
    } catch (err) {
      this.view = 'offline';
      if (err instanceof ServerError && err.code === 'version') {
        this.notice = t('mp.oldVersion');
        // The site moved on before the server did (or the other way round): to the build that matches it.
        const where = await matchingBuild(Number(err.detail));
        if (where) {
          location.href = where;
          return;
        }
        if (Number(err.detail) < PROTOCOL_VERSION) this.notice = t('mp.serverOld');
      } else this.notice = t('mp.noServer');
      this.host.redraw();
    }
  }

  private startPing(): void {
    this.stopPing();
    const send = (): void => this.link?.send({ t: 'ping', at: performance.now() });
    send();
    this.pingTimer = window.setInterval(send, PING_EVERY);
  }

  private stopPing(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = 0;
  }

  /** Redraws at most once a frame. */
  private queueRedraw(): void {
    if (this.redrawQueued) return;
    this.redrawQueued = true;
    requestAnimationFrame(() => {
      this.redrawQueued = false;
      if (this.offs.length) this.host.redraw();
    });
  }

  /** The room list page. Asks once; the server pushes changes while we're here (no polling). */
  private showList(): void {
    this.view = 'list';
    this.link?.send({ t: 'list' });
    this.host.redraw();
  }

  /** Esc / back: out of the form or the room to the list; from the list, false (leave the page). */
  back(): boolean {
    if (this.view === 'create') {
      this.showList();
      return true;
    }
    if (this.view === 'edit') {
      this.view = this.room ? 'room' : 'list';
      this.host.redraw();
      return true;
    }
    if (this.view === 'room') {
      this.leave();
      this.showList();
      return true;
    }
    return false;
  }

  private leave(): void {
    if (this.room) this.link?.send({ t: 'leave' });
    this.room = null;
  }

  close(): void {
    this.leave();
    this.handOver();
    this.link?.close();
  }

  /** The game takes the connection: this menu stops listening and pinging (the link stays open). */
  handOver(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.stopPing();
    this.chat?.dispose();
    this.chat = null;
    this.link = null;
  }

  private async act(fn: () => Promise<unknown>): Promise<void> {
    this.notice = null;
    try {
      await fn();
    } catch (err) {
      const code = err instanceof ServerError ? err.code : 'bad';
      this.notice = t(`mp.err.${code}` as MessageKey) || String(err);
      this.host.redraw();
    }
  }

  private join(room: RoomInfo, team?: Side): void {
    if (room.locked && !this.password) {
      this.selected = room.id;
      this.notice = t('mp.needPassword');
      this.host.redraw();
      return;
    }
    const password = room.locked ? this.password : undefined;
    void this.act(async () => {
      await this.link!.request({ t: 'join', room: room.id, password, team }, 'room');
      this.password = '';
      this.view = 'room';
      this.host.redraw();
    }).finally(() => {
      if (this.view === 'list') this.showList();
    });
  }

  /** The fullest open room with space and fitting this device; null when none. */
  private quickPick(): RoomInfo | null {
    const fits = this.rooms.filter((r) => !r.locked && r.humans < r.humanCap && (r.settings.input === 'all' || r.settings.input === this.host.device));
    fits.sort((a, b) => b.humans - a.humans);
    return fits[0] ?? null;
  }

  private create(): void {
    const { password, ...settings } = this.form;
    saveJSON(CREATE_KEY, settings);
    if (this.view === 'edit') {
      this.link?.send({ t: 'settings', settings });
      this.view = 'room';
      this.host.redraw();
      return;
    }
    void this.act(async () => {
      await this.link!.request({ t: 'create', settings, password: password || undefined }, 'room');
      this.view = 'room';
      this.host.redraw();
    });
  }

  private get touch(): boolean {
    return this.host.device === 'mobile';
  }

  private me(): Member | null {
    return this.room?.members.find((m) => m.id === this.link?.id) ?? null;
  }

  private pingText(): string {
    return this.ping === null ? '…' : `${Math.round(this.ping)} ms`;
  }

  /** Bars and the round trip, updated in place. */
  private pingView(parent: HTMLElement): void {
    const box = el('span', 'mp-ping', parent);
    this.pingEls.push(box);
    this.fillPing(box);
  }

  private fillPing(box: HTMLElement): void {
    const ms = this.ping;
    const q = ms === null ? '' : ms < 80 ? ' good' : ms < 160 ? ' mid' : ' bad';
    box.replaceChildren();
    const b = el('span', `ds-ping${q}`, box);
    for (let i = 0; i < 3; i++) el('i', '', b);
    el('span', 'ds-num mp-ping-ms', box, this.pingText());
    box.title = t('mp.ping');
  }

  private showPing(): void {
    this.pingEls = this.pingEls.filter((e) => e.isConnected);
    for (const e of this.pingEls) this.fillPing(e);
  }

  // ---------------------------------------------------------------------------

  render(body: HTMLElement): void {
    body.classList.add('lb-mp');
    this.pingEls = [];
    if (this.view === 'connecting' || this.view === 'offline') {
      const box = el('div', 'mp-status', body);
      if (this.notice) el('div', 'mp-status-note', box, this.notice);
      if (this.view === 'connecting') {
        el('div', 'mp-spinner', box);
        el('div', 'ds-dim', box, t('mp.connecting'));
      } else {
        const retry = button(box, 'ds-btn primary', t('mp.retry'), 'refresh');
        retry.addEventListener('click', () => {
          void this.connect();
          this.host.redraw();
        });
      }
      return;
    }
    if (this.view === 'list') this.renderList(body);
    else if (this.view === 'create' || this.view === 'edit') this.renderCreate(body);
    else this.renderRoom(body);
  }

  /** The player's own card: name, tag, the round trip. */
  private idCard(parent: HTMLElement): void {
    const card = el('div', 'mp-id', parent);
    card.insertAdjacentHTML('beforeend', icon('user'));
    nameView(card, { name: this.link?.name ?? '', tag: this.link?.tag ?? '' }, 'mp-id-name');
    card.title = t('mp.you');
    this.pingView(card);
  }

  private notices(parent: HTMLElement): void {
    if (!this.notice) return;
    const text = this.notice;
    const n = el('div', 'ds-toast danger mp-toast', parent);
    n.insertAdjacentHTML('beforeend', icon('info'));
    el('span', '', n, text);
    const dismiss = (): void => {
      if (this.notice === text) this.notice = null;
      n.remove();
    };
    n.addEventListener('click', dismiss);
    setTimeout(dismiss, 6000);
  }

  private visibleRooms(): RoomInfo[] {
    const q = this.search.trim().toLowerCase();
    return this.rooms.filter((r) => {
      if (this.filter !== 'all' && r.state !== this.filter) return false;
      if (!q) return true;
      const hay = `${r.settings.name} ${r.host.name}#${r.host.tag} ${mapName(r.settings.map)} ${modeName(r.settings.mode)}`.toLowerCase();
      return hay.includes(q);
    });
  }

  private renderList(body: HTMLElement): void {
    body.classList.add('mpb');
    const top = el('div', 'mpb-top', body);
    this.idCard(top);
    const acts = el('div', 'mpb-acts', top);
    const quick = button(acts, 'ds-btn primary', t('mp.quick'), 'play');
    quick.addEventListener('click', () => {
      const r = this.quickPick();
      if (r) this.join(r);
      else {
        this.notice = t('mp.noQuick');
        this.host.redraw();
      }
    });
    button(acts, 'ds-btn ghost', t('mp.create'), 'plus').addEventListener('click', () => {
      this.view = 'create';
      this.host.redraw();
    });
    const refresh = button(acts, 'ds-btn ghost mp-icon-btn', '', 'refresh');
    refresh.title = t('mp.refresh');
    refresh.setAttribute('aria-label', t('mp.refresh'));
    refresh.addEventListener('click', () => this.link?.send({ t: 'list' }));
    this.notices(body);

    // The list: filters and search over the rooms.
    const left = el('div', 'mpb-list', body);
    const tools = el('div', 'mpb-tools', left);
    const seg = el('div', 'ds-seg mpb-filter', tools);
    for (const f of ['all', 'lobby', 'playing'] as const) {
      const n = f === 'all' ? this.rooms.length : this.rooms.filter((r) => r.state === f).length;
      const c = el('button', this.filter === f ? 'sel' : '', seg, t(`mp.filter.${f}` as MessageKey));
      c.type = 'button';
      el('span', 'ds-num mpb-filter-n', c, String(n));
      c.addEventListener('click', () => {
        if (this.filter !== f) uiSound('move');
        this.filter = f;
        this.host.redraw();
      });
    }
    const find = el('label', 'mpb-search', tools);
    find.insertAdjacentHTML('beforeend', icon('search'));
    const search = el('input', 'ds-input', find);
    search.type = 'search';
    search.placeholder = t('mp.search');
    search.value = this.search;
    search.addEventListener('input', () => {
      this.search = search.value;
      this.fillRows(rows);
    });
    const head = el('div', 'mpb-row mpb-head', left);
    for (const k of ['mp.col.name', 'mp.col.map', 'mp.col.players', 'mp.col.state'] as const) el('span', 'ds-label', head, t(k));
    const rows = el('div', 'mpb-rows', left);
    this.fillRows(rows);

    // The picked room.
    const side = el('div', 'mpb-detail', body);
    const room = this.rooms.find((r) => r.id === this.selected) ?? this.visibleRooms()[0];
    if (room) this.renderDetail(side, room);
    else {
      el('div', 'mpb-empty-title', side, t('mp.noRooms'));
      el('div', 'ds-dim', side, t('mp.noRoomsHint'));
    }
  }

  private fillRows(rows: HTMLElement): void {
    rows.replaceChildren();
    const list = this.visibleRooms();
    // No rooms at all: the detail column says so (and what to do); here only "none match".
    if (!list.length && this.rooms.length) el('div', 'mpb-none', rows, t('mp.noMatch'));
    const pick = this.selected ?? list[0]?.id;
    for (const r of list) {
      const row = el('button', `mpb-row${r.id === pick ? ' sel' : ''}${r.humans >= r.humanCap ? ' full' : ''}`, rows);
      row.type = 'button';
      const name = el('span', 'mpb-name', row);
      const title = el('span', 'mpb-title', name);
      if (r.locked) title.insertAdjacentHTML('beforeend', icon('lock'));
      el('span', '', title, r.settings.name);
      nameView(name, r.host, 'mpb-host');
      const what = el('span', 'mpb-what', row);
      el('span', '', what, mapName(r.settings.map));
      el('span', 'mpb-mode', what, modeName(r.settings.mode));
      const num = el('span', 'mpb-num', row);
      el('span', 'ds-num', num, `${r.humans} / ${r.humanCap}`);
      if (r.settings.lineup !== 'users') el('span', 'mpb-bots', num, t('mp.withBots'));
      const bar = el('span', 'mpb-bar', num);
      el('i', '', bar).style.width = `${Math.min(100, (r.humans / Math.max(1, r.humanCap)) * 100)}%`;
      el('span', `mpb-state st-${r.state}`, row, t(r.state === 'playing' ? 'mp.state.playing' : 'mp.state.lobby'));
      row.addEventListener('pointerenter', () => uiSound('hover'));
      row.addEventListener('click', () => {
        if (this.selected !== r.id) {
          this.password = '';
          uiSound('move');
        }
        this.selected = r.id;
        this.host.redraw();
      });
      row.addEventListener('dblclick', () => this.join(r));
    }
  }

  /** A room's picture over its facts. */
  private mapCard(parent: HTMLElement, s: RoomSettings): void {
    const pic = el('div', 'mp-pic', parent);
    const m = this.host.setupMaps().find((x) => x.id === s.map);
    if (m?.picture) {
      const img = el('img', '', pic);
      img.src = thumb(m.picture);
      img.alt = '';
    }
    const cap = el('div', 'mp-pic-cap', pic);
    el('span', 'ds-label mp-pic-mode', cap, modeName(s.mode));
    el('span', 'mp-pic-map', cap, mapName(s.map));
  }

  private facts(parent: HTMLElement, s: RoomSettings, r: RoomInfo): void {
    const dl = el('dl', 'mp-facts', parent);
    const row = (k: MessageKey, v: string): void => {
      el('dt', 'ds-label', dl, t(k));
      el('dd', '', dl, v);
    };
    row('mp.row.size', t('mp.sizeValue').replace('{n}', String(s.size)).replaceAll('{a}', String(s.size / 2)));
    row('mp.humans', `${r.humans} / ${r.humanCap}`);
    row('mp.row.lineup', t(`mp.lineup.${s.lineup}` as MessageKey));
    if (hasSides(s)) row('mp.row.teamPick', t(`mp.pick.${s.teamPick}` as MessageKey));
    if (s.lineup !== 'users') row('mp.row.difficulty', t(`lobby.diff.${s.difficulty}` as MessageKey));
    row('mp.row.input', t(`mp.input.${s.input}` as MessageKey));
    row('mp.row.chat', t(s.chat ? 'lobby.on' : 'lobby.off'));
    row('lobby.simple', t(s.simple ? 'lobby.on' : 'lobby.off'));
  }

  private renderDetail(side: HTMLElement, r: RoomInfo): void {
    const s = r.settings;
    this.mapCard(side, s);
    const head = el('div', 'mpb-dhead', side);
    const dname = el('div', 'mpb-dname', head);
    if (r.locked) dname.insertAdjacentHTML('beforeend', icon('lock'));
    el('span', '', dname, s.name);
    const by = el('div', 'mpb-dby', head);
    el('span', '', by, t('mp.hostBy'));
    nameView(by, r.host);
    el('div', `mpb-dstate st-${r.state}`, head, t(r.state === 'playing' ? 'mp.playingNote' : 'mp.waitingNote'));
    this.facts(side, s, r);
    const full = r.humans >= r.humanCap;
    const fits = s.input === 'all' || s.input === this.host.device;
    if (r.locked) {
      const pw = el('input', 'ds-input mpb-pw', side);
      pw.type = 'password';
      pw.placeholder = t('mp.passwordPrompt');
      pw.maxLength = 64;
      pw.value = this.password;
      pw.addEventListener('input', () => (this.password = pw.value));
      pw.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.join(r);
      });
    }
    const go = el('div', 'mpb-go', side);
    if (!fits) el('div', 'ds-dim', go, t('mp.err.full'));
    // A match under way where players pick their side: join one of them.
    if (r.state === 'playing' && s.teamPick === 'self' && hasSides(s)) {
      for (const team of SIDES) {
        const open = r.sides[team] < sideCap(r);
        const b = el('button', `ds-btn mpb-side side-${team}`, go);
        b.type = 'button';
        el('span', '', b, t(`mp.joinSide.${team}` as MessageKey));
        el('span', 'ds-num mpb-side-n', b, `${r.sides[team]} / ${sideCap(r)}`);
        b.disabled = !open || full || !fits;
        b.addEventListener('click', () => this.join(r, team));
      }
      return;
    }
    const b = button(go, 'ds-btn primary mp-big mpb-join', t(r.state === 'playing' ? 'mp.joinLive' : 'mp.join'));
    if (!this.touch) el('span', 'ds-kbd', b, 'ENTER');
    b.disabled = full || !fits;
    b.addEventListener('click', () => this.join(r));
  }

  /** The create page's map: its team size sets the room size, and the mode stays if the map has it. */
  private setFormMap(id: string): void {
    const f = this.form;
    if (f.map === id) return;
    f.map = id;
    if (this.view === 'create') f.size = Math.min(300, (MAPS.find((m) => m.id === id)?.team ?? 12) * 2);
    const modes = this.host.modesFor(id);
    if (!modes.includes(f.mode as LobbyMode)) f.mode = modes[0]!;
    this.host.redraw();
  }

  /** Keys on the create page (Q / E mode group, ↑ ↓ mode, ← → map, Enter create); true when used. */
  key(code: string): boolean {
    if (this.view === 'list') return this.listKey(code);
    if (this.view !== 'create' && this.view !== 'edit') return false;
    const f = this.form;
    if (code === 'KeyQ' || code === 'KeyE') {
      uiSound('move');
      f.mode = stepGroup(f.mode as LobbyMode, this.host.modesFor(f.map), code === 'KeyQ' ? -1 : 1);
      this.host.redraw();
    } else if (code === 'ArrowUp' || code === 'ArrowDown') {
      uiSound('move');
      f.mode = stepMode(f.mode as LobbyMode, this.host.modesFor(f.map), code === 'ArrowUp' ? -1 : 1);
      this.host.redraw();
    } else if (code === 'ArrowLeft' || code === 'ArrowRight') {
      uiSound('move');
      this.setFormMap(step(
        MAPS.map((m) => m.id),
        f.map,
        code === 'ArrowLeft' ? -1 : 1,
      ));
    } else if (code === 'Enter') this.create();
    else return false;
    return true;
  }

  /** The server browser: ↑ ↓ pick a room, Enter join it. */
  private listKey(code: string): boolean {
    const list = this.visibleRooms();
    if (!list.length) return false;
    const at = Math.max(0, list.findIndex((r) => r.id === (this.selected ?? list[0]!.id)));
    if (code === 'ArrowUp' || code === 'ArrowDown') {
      const next = list[Math.max(0, Math.min(list.length - 1, at + (code === 'ArrowUp' ? -1 : 1)))]!;
      if (next.id !== this.selected) {
        uiSound('move');
        this.password = '';
      }
      this.selected = next.id;
      this.host.redraw();
    } else if (code === 'Enter') {
      uiSound('select');
      this.join(list[at]!);
    } else return false;
    return true;
  }

  /** The owner changes the room's settings: the form starts from them. */
  private editSettings(): void {
    const r = this.room;
    if (!r) return;
    this.form = { ...r.settings, password: '' };
    this.view = 'edit';
    this.host.redraw();
  }

  private renderCreate(body: HTMLElement): void {
    const f = this.form;
    const redraw = () => this.host.redraw();
    const bots = f.lineup !== 'users';
    const edit = this.view === 'edit';
    const fields: SetupField[] = [
      { kind: 'text', id: 'name', label: t('mp.roomName'), value: f.name, set: (v) => (f.name = v) },
      {
        kind: 'stepper',
        id: 'size',
        label: t('mp.row.size'),
        value: t('mp.sizeValue').replace('{n}', String(f.size)).replaceAll('{a}', String(f.size / 2)),
        note: t('mp.note.size').replace('{n}', String((MAPS.find((m) => m.id === f.map)?.team ?? 12) * 2)),
        change: (d) => {
          const i = SIZES.indexOf(f.size as (typeof SIZES)[number]);
          const at = i < 0 ? SIZES.findIndex((n) => n >= f.size) : i;
          f.size = SIZES[Math.max(0, Math.min(SIZES.length - 1, at + d))]!;
          redraw();
        },
      },
      {
        kind: 'choice',
        id: 'lineup',
        label: t('mp.row.lineup'),
        note: t(`mp.note.lineup.${f.lineup}` as MessageKey),
        options: LINEUPS.map((l) => ({ value: l, label: t(`mp.lineup.${l}` as MessageKey) })),
        value: f.lineup,
        pick: (v) => {
          f.lineup = v as Lineup;
          redraw();
        },
      },
    ];
    if (hasSides(f)) {
      fields.push({
        kind: 'choice',
        id: 'teamPick',
        label: t('mp.row.teamPick'),
        note: t(`mp.note.pick.${f.teamPick}` as MessageKey),
        options: PICKS.map((p) => ({ value: p, label: t(`mp.pick.${p}` as MessageKey) })),
        value: f.teamPick,
        pick: (v) => {
          f.teamPick = v as TeamPick;
          redraw();
        },
      });
    }
    if (bots) {
      fields.push(
        {
          kind: 'choice',
          id: 'difficulty',
          label: t('mp.row.difficulty'),
          options: DIFFS.map((d) => ({ value: d, label: t(`lobby.diff.${d}` as MessageKey) })),
          value: f.difficulty,
          pick: (v) => {
            f.difficulty = v as (typeof DIFFS)[number];
            redraw();
          },
        },
        {
          kind: 'choice',
          id: 'botShare',
          label: t('mp.row.botShare'),
          note: t('mp.note.botShare'),
          options: [
            { value: 'on', label: t('lobby.on') },
            { value: 'off', label: t('lobby.off') },
          ],
          value: f.botShare ? 'on' : 'off',
          pick: (v) => {
            f.botShare = v === 'on';
            redraw();
          },
        },
      );
    }
    if (simpleAllowed(f.mode))
      fields.push(
        simpleField(f.simple, (on) => {
          f.simple = on;
          redraw();
        }),
      );
    fields.push({
      kind: 'choice',
      id: 'chat',
      label: t('mp.row.chat'),
      note: t(f.chat ? 'mp.note.chatOn' : 'mp.note.chatOff'),
      options: [
        { value: 'on', label: t('lobby.on') },
        { value: 'off', label: t('lobby.off') },
      ],
      value: f.chat ? 'on' : 'off',
      pick: (v) => {
        f.chat = v === 'on';
        redraw();
      },
    });
    fields.push({
      kind: 'choice',
      id: 'input',
      label: t('mp.row.input'),
      options: INPUTS.map((i) => ({ value: i, label: t(`mp.input.${i}` as MessageKey) })),
      value: f.input,
      pick: (v) => {
        f.input = v as InputRule;
        redraw();
      },
    });
    // A room's password is set when it is made.
    if (!edit) fields.push({ kind: 'text', id: 'password', label: t('mp.password'), value: f.password, secret: true, set: (v) => (f.password = v) });
    renderMatchSetup(body, {
      mode: f.mode as LobbyMode,
      map: f.map,
      offered: this.host.modesFor(f.map),
      maps: this.host.setupMaps(),
      fields,
      start: t(edit ? 'mp.saveSettings' : 'mp.createGo'),
      summary: t(edit ? 'mp.editHint' : 'mp.createHint'),
      touch: this.host.device === 'mobile',
      onMode: (m) => {
        f.mode = m;
        redraw();
      },
      onMap: (id) => this.setFormMap(id),
      onStart: () => this.create(),
    });
    this.notices(body);
  }

  // ---------------------------------------------------------------------------
  // The waiting room

  private renderRoom(body: HTMLElement): void {
    const room = this.room;
    if (!room) {
      el('div', 'ds-dim', body, t('mp.connecting'));
      return;
    }
    body.classList.add('mpr');
    const s = room.settings;
    const meId = this.link?.id ?? '';
    const owner = room.owner === meId;

    // Head: the room, its state, me.
    const head = el('div', 'mpr-head', body);
    const titles = el('div', 'mpr-titles', head);
    const badges = el('div', 'mpr-badges', titles);
    el('span', 'ds-badge accent', badges, modeName(s.mode));
    el('span', 'ds-badge line', badges, mapName(s.map));
    el('span', `ds-badge line st-${room.state}`, badges, t(room.state === 'playing' ? 'mp.state.playing' : 'mp.state.lobby'));
    if (s.simple) el('span', 'ds-badge line', badges, t('lobby.simpleBadge'));
    if (room.locked) {
      const lock = el('span', 'ds-badge line', badges);
      lock.insertAdjacentHTML('beforeend', icon('lock'));
      el('span', '', lock, t('mp.locked'));
    }
    el('div', 'mpr-name', titles, s.name);
    this.idCard(head);
    this.notices(body);

    // The sides (or one list), then the chat.
    const main = el('div', 'mpr-main', body);
    const teams = el('div', 'mpr-teams', main);
    const sides = hasSides(s) && s.teamPick !== 'random';
    if (sides) {
      for (const team of SIDES) this.sideColumn(teams, room, team, owner);
    } else {
      const col = el('div', 'mpr-side all', teams);
      const h = el('div', 'mpr-side-head', col);
      el('span', 'mpr-side-name', h, t('mp.col.player'));
      el('span', 'ds-num mpr-side-n', h, `${room.humans} / ${room.humanCap}`);
      el('div', 'mpr-side-note', col, t(!hasSides(s) ? (s.lineup === 'coop' ? 'mp.note.coopSide' : 'mp.note.noSides') : 'mp.note.pick.random'));
      const list = el('div', 'mpr-members', col);
      for (const m of room.members) this.memberCard(list, room, m, owner, null);
    }
    const chatBox = el('div', 'mpr-chat', main);
    el('div', 'ds-label mpr-chat-head', chatBox, t('chat.title'));
    this.chat?.attach(chatBox);

    // The room's card and the buttons.
    const aside = el('div', 'mpr-aside', body);
    this.mapCard(aside, s);
    this.facts(aside, s, room);
    if (owner && room.state === 'lobby') button(aside, 'ds-btn ghost mpr-edit', t('mp.editRoom'), 'settings').addEventListener('click', () => this.editSettings());
    const foot = el('div', 'mpr-foot', aside);
    if (owner && room.state === 'lobby') {
      const go = button(foot, 'ds-btn primary mp-big', t('lobby.start'), 'play');
      go.addEventListener('click', () => {
        uiSound('start');
        this.link?.send({ t: 'start' });
      });
    } else if (owner && room.state === 'playing') {
      button(foot, 'ds-btn ghost', t('mp.end')).addEventListener('click', () => this.link?.send({ t: 'end' }));
    } else {
      el('div', 'mpr-wait', foot, t(room.state === 'playing' ? 'mp.playingNote' : 'mp.waitingNote'));
    }
    button(foot, 'ds-btn ghost mpr-leave', t('mp.leave'), 'exit').addEventListener('click', () => this.back());
  }

  private sideColumn(parent: HTMLElement, room: Room, team: Side, owner: boolean): void {
    const s = room.settings;
    const members = room.members.filter((m) => m.team === team);
    const col = el('div', `mpr-side side-${team}`, parent);
    const h = el('div', 'mpr-side-head', col);
    el('span', 'mpr-side-name', h, t(`chat.side.${team}` as MessageKey));
    el('span', 'ds-num mpr-side-n', h, `${members.length} / ${sideCap(room)}`);
    const me = this.me();
    if (s.teamPick === 'self' && me && me.team !== team && room.state === 'lobby') {
      const b = button(h, 'ds-btn ghost mp-sm mpr-switch', t('mp.toSide'));
      b.disabled = members.length >= sideCap(room);
      b.addEventListener('click', () => this.link?.send({ t: 'team', team }));
    }
    const list = el('div', 'mpr-members', col);
    for (const m of members) this.memberCard(list, room, m, owner, team);
    if (!members.length) el('div', 'mpr-none', list, t('mp.sideEmpty'));
  }

  private memberCard(list: HTMLElement, room: Room, m: Member, owner: boolean, team: Side | null): void {
    const meId = this.link?.id ?? '';
    const self = m.id === meId;
    const card = el('div', `mpr-member${self ? ' self' : ''}${m.away ? ' away' : ''}`, list);
    const dev = el('span', 'mpr-dev', card);
    dev.insertAdjacentHTML('beforeend', icon(m.device === 'mobile' ? 'phone' : 'desktop'));
    const who = el('span', 'mpr-who', card);
    nameView(who, m);
    const tags = el('span', 'mpr-tags', card);
    if (m.id === room.owner) el('span', 'ds-badge accent', tags, t('mp.hostBadge'));
    if (self) el('span', 'ds-badge', tags, t('mp.meBadge'));
    if (m.away) el('span', 'ds-badge line', tags, t('mp.away'));
    if (isMuted(m.tag) && !self) el('span', 'ds-badge line mpr-muted', tags, t('mp.muted'));
    if (m.muted) el('span', 'ds-badge line mpr-muted', tags, t('mp.chatBanned'));
    const acts = el('span', 'mpr-acts', card);
    // The owner moves people between sides (rooms where the owner picks).
    if (owner && team && room.settings.teamPick === 'host' && room.state === 'lobby') {
      const other: Side = team === 'blue' ? 'red' : 'blue';
      const mv = button(acts, 'ds-btn ghost mp-sm', t(`mp.moveTo.${other}` as MessageKey));
      mv.addEventListener('click', () => this.link?.send({ t: 'team', team: other, member: m.id }));
    }
    // Blocking goes by tag: not one's own (another tab of this browser has it too).
    if (!self && m.tag && m.tag !== this.link?.tag) {
      const muted = isMuted(m.tag);
      const mu = button(acts, 'ds-btn ghost mp-sm', t(muted ? 'mp.unmute' : 'mp.mute'));
      mu.title = t('mp.muteHint');
      mu.addEventListener('click', () => {
        setMuted(m.tag, !muted);
        this.chat?.refresh();
        this.host.redraw();
      });
    }
    // The owner takes someone's chat away in this room (or gives it back).
    if (owner && !self) {
      const cb = button(acts, 'ds-btn ghost mp-sm', t(m.muted ? 'mp.chatUnban' : 'mp.chatBan'));
      cb.title = t('mp.chatBanHint');
      cb.addEventListener('click', () => this.link?.send({ t: 'mute', member: m.id, on: !m.muted }));
    }
    if (owner && !self) {
      button(acts, 'ds-btn ghost mp-sm danger', t('mp.kick')).addEventListener('click', () => this.link?.send({ t: 'kick', member: m.id }));
    }
  }
}

/**
 * When the server runs another game version than this page: the address of
 * a build that matches it, or null. The site keeps the build of the commit
 * the server laptop runs under `mp/` while that is older than the site
 * (deploy.yml, server/laptop.json), so people can still play together
 * before the server is updated; from that build, a server that has moved on
 * means the site's own root again.
 */
async function matchingBuild(server: number): Promise<string | null> {
  if (!Number.isFinite(server)) return null;
  const root = new URL(import.meta.env.BASE_URL, location.href);
  const inOld = /\/mp\/$/.test(root.pathname);
  if (server > PROTOCOL_VERSION) return inOld ? new URL('../?multi', root).href : null;
  if (inOld) return null;
  try {
    const res = await fetch(new URL('mp/version.json', root), { cache: 'no-store' });
    if (!res.ok) return null;
    const v = (await res.json()) as { protocol?: unknown };
    return v.protocol === server ? new URL('mp/?multi', root).href : null;
  } catch {
    return null;
  }
}
