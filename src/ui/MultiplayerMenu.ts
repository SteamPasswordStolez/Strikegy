import { t, type MessageKey } from '@/i18n';
import { MAPS, TEAM_SIZES, type LobbyMode } from '@/data/maps';
import { loadJSON, saveJSON } from '@/core/storage';
import { loadIdentity, seatId } from '@/net/identity';
import { ServerLink, ServerError } from '@/net/ServerLink';
import { serverUrls } from '@/net/servers';
import type { Device, Lineup, InputRule, MatchStart, Room, RoomInfo, RoomSettings } from '@/net/lobbyProtocol';

const CREATE_KEY = 'strikegy.mpCreate.v1';
const LINEUPS: readonly Lineup[] = ['users', 'usersBots', 'coop'];
const INPUTS: readonly InputRule[] = ['all', 'desktop', 'mobile'];
const DIFFS = ['easy', 'normal', 'hard'] as const;
/** Room sizes the form steps through: both sides of the solo team sizes (2..300). */
const SIZES = TEAM_SIZES.map((n) => n * 2);
/** How often the round trip to the server is measured (ms). */
const PING_EVERY = 2000;

type View = 'connecting' | 'offline' | 'list' | 'create' | 'room';
type FormRow = 'map' | 'mode' | 'size' | 'lineup' | 'difficulty' | 'input' | 'botShare';
const FORM_ROWS: readonly FormRow[] = ['map', 'mode', 'size', 'lineup', 'difficulty', 'input', 'botShare'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

const step = <T>(list: readonly T[], cur: T, d: number): T => list[(Math.max(0, list.indexOf(cur)) + d + list.length) % list.length]!;
const modeName = (m: string): string => t(m === 'skirmish' ? 'lobby.skirmish' : (`mode.${m}` as MessageKey));

export interface MultiplayerHost {
  /** Modes the map offers (from its JSON, once loaded). */
  modesFor(map: string): LobbyMode[];
  /** Redraws the menu (the multiplayer page is drawn by `render`). */
  redraw(): void;
  device: Device;
  /** The room's match starts (or is under way and we're in): the game takes the connection. */
  startMatch(start: MatchStart, link: ServerLink): void;
}

/**
 * The multiplayer pages of the main menu: connect to the game server, the
 * room list (join, quick join), creating a room, and the waiting room
 * (members, the round trip to the server). Keeps the connection while the
 * menu redraws; `close` drops it.
 */
export class MultiplayerMenu {
  private view: View = 'connecting';
  link: ServerLink | null = null;
  /** The room we are in, as the server last sent it. */
  room: Room | null = null;
  /** Round trip to the server (ms), null until measured. */
  private ping: number | null = null;
  private pingTimer = 0;
  private rooms: RoomInfo[] = [];
  private notice: string | null = null;
  private form: RoomSettings & { password: string };
  private redrawQueued = false;
  private offs: (() => void)[] = [];

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
      password: '',
    };
    void this.connect();
    if (import.meta.env.DEV) (window as unknown as { __mp: MultiplayerMenu }).__mp = this;
  }

  get title(): MessageKey {
    return this.view === 'create' ? 'mp.createTitle' : this.view === 'room' ? 'mp.roomTitle' : 'menu.multi';
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
        this.view = 'room';
        this.queueRedraw();
      }));
      offs.push(link.on('left', (m) => {
        this.room = null;
        if (m.reason === 'kicked') this.notice = t('mp.kicked');
        if (this.view === 'room') this.showList();
      }));
      offs.push(link.on('pong', (m) => {
        this.ping = performance.now() - m.at;
        if (this.view !== 'create') this.queueRedraw();
      }));
      this.startPing();
      // Back from a match (or a reload) the server may have put us straight back in our room.
      if (!this.room) this.showList();
    } catch (err) {
      this.view = 'offline';
      this.notice = err instanceof ServerError && err.code === 'version' ? t('mp.oldVersion') : t('mp.noServer');
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

  private join(room: RoomInfo): void {
    let password: string | undefined;
    if (room.locked) {
      const pw = prompt(t('mp.passwordPrompt'));
      if (pw === null) return;
      password = pw;
    }
    void this.act(async () => {
      await this.link!.request({ t: 'join', room: room.id, password }, 'room');
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
    void this.act(async () => {
      await this.link!.request({ t: 'create', settings, password: password || undefined }, 'room');
      this.view = 'room';
      this.host.redraw();
    });
  }

  // ---------------------------------------------------------------------------

  render(body: HTMLElement): void {
    body.classList.add('lb-mp');
    if (this.notice) el('div', 'mp-notice', body, this.notice);
    if (this.view === 'connecting') el('div', 'lb-desc', body, t('mp.connecting'));
    else if (this.view === 'offline') {
      const retry = el('button', 'lb-btn primary', body, t('mp.retry'));
      retry.addEventListener('click', () => {
        void this.connect();
        this.host.redraw();
      });
    } else if (this.view === 'list') this.renderList(body);
    else if (this.view === 'create') this.renderCreate(body);
    else this.renderRoom(body);
  }

  private renderList(body: HTMLElement): void {
    const bar = el('div', 'mp-bar', body);
    el('div', 'mp-me', bar, `${t('mp.you')}: ${this.link?.name ?? ''} · ${this.pingText()}`);
    const quick = el('button', 'lb-btn primary', bar, t('mp.quick'));
    quick.addEventListener('click', () => {
      const r = this.quickPick();
      if (r) this.join(r);
      else {
        this.notice = t('mp.noQuick');
        this.host.redraw();
      }
    });
    el('button', 'lb-btn', bar, t('mp.create')).addEventListener('click', () => {
      this.view = 'create';
      this.host.redraw();
    });
    el('button', 'lb-btn', bar, t('mp.refresh')).addEventListener('click', () => this.link?.send({ t: 'list' }));

    const list = el('div', 'mp-list', body);
    if (!this.rooms.length) el('div', 'lb-desc', list, t('mp.noRooms'));
    const head = el('div', 'mp-row mp-head', list);
    for (const k of ['mp.col.name', 'mp.col.map', 'mp.col.players', 'mp.col.state'] as const) el('span', '', head, t(k));
    for (const r of this.rooms) {
      const row = el('button', 'mp-row', list);
      el('span', 'mp-name', row, `${r.locked ? '🔒 ' : ''}${r.settings.name}`);
      el('span', '', row, `${t(`map.${r.settings.map}` as MessageKey)} · ${modeName(r.settings.mode)}`);
      el('span', 'mp-num', row, `${r.humans} / ${r.humanCap}${r.settings.lineup !== 'users' ? ` · ${t('mp.withBots')}` : ''}`);
      el('span', r.state === 'playing' ? 'mp-live' : '', row, t(r.state === 'playing' ? 'mp.state.playing' : 'mp.state.lobby'));
      row.addEventListener('click', () => this.join(r));
    }
  }

  private pingText(): string {
    return `${t('mp.ping')} ${this.ping === null ? '…' : `${Math.round(this.ping)} ms`}`;
  }

  private formValue(row: FormRow): string {
    const f = this.form;
    switch (row) {
      case 'map':
        return t(`map.${f.map}` as MessageKey);
      case 'mode':
        return modeName(f.mode);
      case 'size':
        return t('mp.sizeValue').replace('{n}', String(f.size)).replaceAll('{a}', String(f.size / 2));
      case 'lineup':
        return t(`mp.lineup.${f.lineup}` as MessageKey);
      case 'difficulty':
        return t(`lobby.diff.${f.difficulty}` as MessageKey);
      case 'input':
        return t(`mp.input.${f.input}` as MessageKey);
      case 'botShare':
        return t(f.botShare ? 'lobby.on' : 'lobby.off');
    }
  }

  private changeForm(row: FormRow, d: number): void {
    const f = this.form;
    if (row === 'map') {
      f.map = step(
        MAPS.map((m) => m.id),
        f.map,
        d,
      );
      f.size = Math.min(300, (MAPS.find((m) => m.id === f.map)?.team ?? 12) * 2);
    } else if (row === 'mode') f.mode = step(this.host.modesFor(f.map), f.mode as LobbyMode, d);
    else if (row === 'size') f.size = SIZES[Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(f.size as (typeof SIZES)[number]) + d))]!;
    else if (row === 'lineup') f.lineup = step(LINEUPS, f.lineup, d);
    else if (row === 'difficulty') f.difficulty = step(DIFFS, f.difficulty, d);
    else if (row === 'input') f.input = step(INPUTS, f.input, d);
    else f.botShare = !f.botShare;
    const modes = this.host.modesFor(f.map);
    if (!modes.includes(f.mode as LobbyMode)) f.mode = modes[0]!;
    this.host.redraw();
  }

  private renderCreate(body: HTMLElement): void {
    const setup = el('div', 'lb-setup', body);
    const rows = el('div', 'lb-rows', setup);
    const text = (label: MessageKey, value: string, set: (v: string) => void, type = 'text'): void => {
      const r = el('label', 'lb-srow mp-text', rows);
      el('span', 'lb-srow-label', r, t(label));
      const input = el('input', 'lb-input', r);
      input.type = type;
      input.maxLength = 32;
      input.value = value;
      input.addEventListener('input', () => set(input.value));
    };
    text('mp.roomName', this.form.name, (v) => (this.form.name = v));
    for (const id of FORM_ROWS) {
      const r = el('div', 'lb-srow', rows);
      el('span', 'lb-srow-label', r, t(`mp.row.${id}` as MessageKey));
      const left = el('button', 'lb-arrow', r, '◀');
      el('span', 'lb-srow-val', r, this.formValue(id));
      const right = el('button', 'lb-arrow', r, '▶');
      left.addEventListener('click', () => this.changeForm(id, -1));
      right.addEventListener('click', () => this.changeForm(id, 1));
    }
    text('mp.password', this.form.password, (v) => (this.form.password = v), 'password');
    el('div', 'lb-desc', setup, t('mp.createHint'));
    const go = el('button', 'lb-start', setup);
    el('span', 'lb-start-text', go, t('mp.createGo'));
    go.addEventListener('click', () => this.create());
  }

  private renderRoom(body: HTMLElement): void {
    const room = this.room;
    if (!room) {
      el('div', 'lb-desc', body, t('mp.connecting'));
      return;
    }
    const me = this.link?.id ?? '';
    const owner = room.owner === me;
    const info = el('div', 'mp-roominfo', body);
    el('div', 'lb-card-badge', info, `${modeName(room.settings.mode)} · ${t(`mp.lineup.${room.settings.lineup}` as MessageKey)}`);
    el('div', 'lb-card-name', info, `${room.locked ? '🔒 ' : ''}${room.settings.name}`);
    el(
      'div',
      'lb-card-facts',
      info,
      `${t(`map.${room.settings.map}` as MessageKey)} · ${t('mp.sizeValue').replace('{n}', String(room.settings.size)).replaceAll('{a}', String(room.settings.size / 2))} · ${t('mp.humans')} ${room.humans} / ${room.humanCap} · ${this.pingText()}`,
    );
    el('div', room.state === 'playing' ? 'mp-live' : 'lb-desc', info, t(room.state === 'playing' ? 'mp.playingNote' : 'mp.waitingNote'));

    const list = el('div', 'mp-list', body);
    const head = el('div', 'mp-row mp-head mp-members', list);
    for (const k of ['mp.col.player', ''] as const) el('span', '', head, k ? t(k) : '');
    for (const m of room.members) {
      const row = el('div', `mp-row mp-members${m.id === me ? ' mp-self' : ''}`, list);
      el('span', 'mp-name', row, `${m.device === 'mobile' ? '📱' : '🖥'} ${m.name}${m.id === room.owner ? ' ★' : ''}${m.away ? ` (${t('mp.away')})` : ''}`);
      const cell = el('span', '', row);
      if (owner && m.id !== me) {
        el('button', 'lb-btn small', cell, t('mp.kick')).addEventListener('click', () => this.link?.send({ t: 'kick', member: m.id }));
      }
    }

    const bar = el('div', 'mp-bar', body);
    el('button', 'lb-btn', bar, t('mp.leave')).addEventListener('click', () => this.back());
    if (owner && room.state === 'lobby') {
      el('button', 'lb-btn primary', bar, t('lobby.start')).addEventListener('click', () => this.link?.send({ t: 'start' }));
    }
    if (owner && room.state === 'playing') {
      el('button', 'lb-btn', bar, t('mp.end')).addEventListener('click', () => this.link?.send({ t: 'end' }));
    }
  }
}
