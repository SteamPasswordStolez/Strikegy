/**
 * The staff's page, strikegy.xyz/admin (owner, 2026-10-14): logs in to the
 * game server with its admin key (kept in the server's `.strikegy-admin-key`;
 * this page keeps it for the tab only, if asked) and shows the server's
 * numbers, every room with its people and chat, everyone connected, the bans
 * and mutes; it closes rooms and ends matches, kicks, mutes and bans people
 * (server-wide, by browser and address), posts notices to everyone and keeps
 * a list of extra words the chat masks. Korean only (the owner's tool).
 *
 * Addresses are never shown, only a short hash (the same address, the same
 * hash), so two names from one household can be told apart without the page
 * holding anyone's IP.
 */
import './admin.css';
import { EVENT_KINDS, PROTOCOL_VERSION, liveEvents, type EventKind, type AdminMark, type AdminOp, type AdminPerson, type AdminReport, type AdminRoom, type AdminState, type ChatLine, type ServerMsg } from '@/net/lobbyProtocol';

/** Report reasons in Korean. */
const REASON: Record<string, string> = { abuse: '욕설·비하', cheat: '핵·부정 행위', name: '부적절한 이름', grief: '팀 방해', other: '기타' };

const KEY_STORE = 'strikegy.admin.key';
/** How often the state is asked for (ms). */
const REFRESH = 2000;

const root = document.getElementById('admin')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement | null, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Servers to choose from: the game's own list (and, in a dev build, the one on this machine). */
async function servers(): Promise<string[]> {
  let list: string[] = [];
  try {
    const res = await fetch(new URL('../servers.json', location.href), { cache: 'no-cache' });
    const body = (await res.json()) as { servers?: unknown };
    if (Array.isArray(body.servers)) list = body.servers.filter((s): s is string => typeof s === 'string' && /^wss?:\/\//.test(s));
  } catch {
    /* none */
  }
  if (import.meta.env.DEV) list.unshift(`ws://${location.hostname || 'localhost'}:8787/play`);
  return [...new Set(list)];
}

const time = (ms: number): string => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const until = (m: AdminMark): string => (m.until === 0 ? '영구' : `${time(m.until)}까지`);
const uptime = (s: number): string => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d}일 ${h}시간` : `${h}시간 ${Math.floor((s % 3600) / 60)}분`;
};
const MODE: Record<string, string> = { zone: '거점', frontline: '전선', conquest: '돌파', hardpoint: '하드포인트', rush: '러시', snd: '폭파', escort: '호위', fortress: '요새', tdm: '팀 데스매치', killconfirm: '킬 컨펌', ffa: '개인전', gungame: '건 게임', lastman: '최후의 1인' };
const SYS: Record<string, string> = { join: '입장', leave: '퇴장', kicked: '강퇴됨', host: '방장이 됨', team: '팀 이동', start: '경기 시작', muted: '방장이 채금', unmuted: '채금 해제' };
const MAP: Record<string, string> = { iron_gate: '철문 주둔지', ardennes: '아르덴 숲', lyon: '리옹', bilbao: '빌바오', persia: '페르시아', ashfall: '재의 섬' };

class AdminPage {
  private ws: WebSocket | null = null;
  private state: AdminState | null = null;
  private tab: 'rooms' | 'people' | 'marks' | 'reports' | 'events' | 'accounts' | 'tools' = 'rooms';
  /** The reports tab shows seen-to reports too. */
  private reportsAll = false;
  /** The accounts tab's search (game name or id). */
  private acctQuery = '';
  private open = new Set<string>();
  private timer = 0;
  private status: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private tabs: HTMLElement | null = null;
  private stats: HTMLElement | null = null;
  /** Draws wait while a menu or a box in the lists is in use. */
  private held = false;

  async start(): Promise<void> {
    this.login(await servers(), null);
  }

  // ---------------------------------------------------------------------------
  // Logging in

  private login(list: string[], error: string | null): void {
    root.replaceChildren();
    const box = el('form', 'ad-login', root);
    el('div', 'ad-eyebrow', box, 'STRIKEGY');
    el('h1', 'ad-title', box, '운영 페이지');
    el('p', 'ad-desc', box, '게임 서버의 운영자 키로 로그인합니다. 키는 서버 노트북의 ~/strikegy/.strikegy-admin-key 에 있습니다.');
    if (error) el('div', 'ad-error', box, error);
    el('label', 'ad-label', box, '서버');
    const pick = el('select', 'ad-input', box);
    for (const url of list) el('option', '', pick, url).value = url;
    el('label', 'ad-label', box, '운영자 키');
    const key = el('input', 'ad-input', box);
    key.type = 'password';
    key.autocomplete = 'current-password';
    key.required = true;
    key.value = sessionStorage.getItem(KEY_STORE) ?? '';
    const keep = el('label', 'ad-check', box);
    const keepBox = el('input', '', keep);
    keepBox.type = 'checkbox';
    keepBox.checked = !!key.value;
    el('span', '', keep, '이 탭을 닫을 때까지 기억');
    const go = el('button', 'ad-btn primary', box, '로그인');
    go.type = 'submit';
    box.addEventListener('submit', (e) => {
      e.preventDefault();
      go.disabled = true;
      if (keepBox.checked) sessionStorage.setItem(KEY_STORE, key.value);
      else sessionStorage.removeItem(KEY_STORE);
      this.connect(pick.value, key.value, list);
    });
    if (!list.length) {
      go.disabled = true;
      el('div', 'ad-error', box, 'servers.json 에 서버가 없습니다.');
    }
    key.focus();
  }

  private connect(url: string, key: string, list: string[]): void {
    this.ws?.close();
    const ws = new WebSocket(url);
    this.ws = ws;
    let ok = false;
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'adminAuth', key })));
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === 'adminOk') {
        ok = true;
        this.shell(url);
        clearInterval(this.timer);
        this.timer = window.setInterval(() => this.op({ op: 'refresh' }), REFRESH);
      } else if (msg.t === 'admState') {
        this.state = msg.state;
        this.draw();
      } else if (msg.t === 'error' && !ok) {
        sessionStorage.removeItem(KEY_STORE);
        this.login(list, msg.code === 'password' ? '키가 맞지 않습니다.' : msg.code === 'rate' ? '시도가 너무 많습니다. 10분 뒤에 다시 하세요.' : `로그인하지 못했습니다 (${msg.code}).`);
      }
    });
    ws.addEventListener('close', () => {
      clearInterval(this.timer);
      if (this.ws !== ws) return;
      if (!ok) this.login(list, '서버에 연결하지 못했습니다.');
      else if (this.status) {
        this.status.textContent = '연결 끊김 — 새로고침하세요';
        this.status.className = 'ad-conn off';
      }
    });
  }

  private op(op: AdminOp): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'adm', op }));
  }

  // ---------------------------------------------------------------------------
  // The page

  private shell(url: string): void {
    root.replaceChildren();
    const head = el('header', 'ad-head', root);
    const brand = el('div', 'ad-brand', head);
    el('span', 'ad-eyebrow', brand, 'STRIKEGY');
    el('span', 'ad-brand-title', brand, '운영');
    this.status = el('span', 'ad-conn', head, url);
    const out = el('button', 'ad-btn', head, '로그아웃');
    out.addEventListener('click', () => {
      sessionStorage.removeItem(KEY_STORE);
      this.ws?.close();
      location.reload();
    });
    this.stats = el('section', 'ad-stats', root);
    this.tabs = el('nav', 'ad-tabs', root);
    this.body = el('main', 'ad-body', root);
    // A menu or a text box in use (buttons don't count: they would hold the lists still after a click).
    this.body.addEventListener('focusin', (e) => (this.held = /^(SELECT|INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)));
    this.body.addEventListener('focusout', () => {
      this.held = false;
      this.draw();
    });
    this.tools();
  }

  private draw(): void {
    const s = this.state;
    if (!s || !this.body || !this.stats || !this.tabs) return;
    // Numbers.
    this.stats.replaceChildren();
    const v = s.server;
    const tile = (label: string, value: string): void => {
      const t = el('div', 'ad-tile', this.stats);
      el('span', 'ad-tile-v', t, value);
      el('span', 'ad-tile-k', t, label);
    };
    tile('접속자', String(v.clients ?? 0));
    tile('방', String(v.rooms ?? 0));
    tile('병력 / 한도', `${v.load ?? 0} / ${v.max ?? '?'}`);
    tile('진행 중 경기', String(v.matches ?? 0));
    tile('틱 (ms)', String(v.stepMs ?? '-'));
    if (v.cpu !== undefined) tile('CPU', `${Math.round(Number(v.cpu) * 100)}%`);
    if (v.memoryMB !== undefined) tile('메모리', `${v.memoryMB} MB`);
    if (v.uptime !== undefined) tile('가동', uptime(Number(v.uptime)));
    tile('프로토콜', `v${v.protocol ?? PROTOCOL_VERSION}`);
    // Tabs.
    const people = s.lobby.length + s.rooms.reduce((n, r) => n + r.members.length, 0);
    this.tabs.replaceChildren();
    for (const [id, label] of [
      ['rooms', `방 ${s.rooms.length}`],
      ['people', `접속자 ${people}`],
      ['marks', `제재 ${s.bans.length + s.mutes.length}`],
      ['reports', `신고 ${(s.reports ?? []).filter((x) => !x.done).length}`],
      ['events', `이벤트${liveEvents(s.events, Date.now()).length ? ' ●' : ''}`],
      ...(s.accounts ? ([['accounts', `계정 ${s.accountCount ?? 0}`]] as const) : []),
      ['tools', '공지 · 금칙어'],
    ] as const) {
      const b = el('button', `ad-tab${this.tab === id ? ' sel' : ''}`, this.tabs, label);
      b.addEventListener('click', () => {
        this.tab = id;
        this.held = false;
        this.draw();
      });
    }
    // Lists (not while a menu or box in them is in use).
    if (this.held) return;
    const keep = this.body.querySelector('.ad-tools');
    this.body.replaceChildren();
    if (this.tab === 'rooms') this.rooms(s);
    else if (this.tab === 'people') this.people(s);
    else if (this.tab === 'marks') this.marks(s);
    else if (this.tab === 'reports') this.reports(s);
    else if (this.tab === 'events') this.events(s);
    else if (this.tab === 'accounts') this.accounts(s);
    if (keep) {
      this.body.appendChild(keep);
      (keep as HTMLElement).hidden = this.tab !== 'tools';
      if (this.tab === 'tools') this.fillWords(s);
    }
  }

  private rooms(s: AdminState): void {
    if (!s.rooms.length) el('div', 'ad-empty', this.body, '열린 방이 없습니다.');
    for (const r of s.rooms) this.room(r);
  }

  private room(r: AdminRoom): void {
    const card = el('details', 'ad-room', this.body);
    card.open = this.open.has(r.id);
    card.addEventListener('toggle', () => (card.open ? this.open.add(r.id) : this.open.delete(r.id)));
    const sum = el('summary', 'ad-room-sum', card);
    el('span', 'ad-room-name', sum, `${r.locked ? '🔒 ' : ''}${r.settings.name}`);
    el('span', 'ad-dim', sum, `#${r.id}`);
    el('span', '', sum, `${MAP[r.settings.map] ?? r.settings.map} · ${MODE[r.settings.mode] ?? r.settings.mode}`);
    el('span', `ad-badge ${r.state}`, sum, r.state === 'playing' ? '경기 중' : '대기 중');
    el('span', '', sum, `${r.members.length}명 / ${r.settings.size}`);
    if (!r.settings.chat) el('span', 'ad-badge', sum, '채팅 꺼짐');
    const acts = el('div', 'ad-acts', card);
    if (r.state === 'playing') this.button(acts, '경기 종료', () => this.op({ op: 'end', room: r.id }), `"${r.settings.name}"의 경기를 끝낼까요?`);
    this.button(acts, '방 닫기', () => this.op({ op: 'close', room: r.id }), `"${r.settings.name}" 방을 닫고 모두 내보낼까요?`, true);
    this.peopleTable(card, r.members, r.owner);
    el('div', 'ad-sub', card, '채팅 (팀 채팅 포함, 최근 40줄)');
    const log = el('div', 'ad-chat', card);
    if (!r.chat.length) el('div', 'ad-dim', log, '대화 없음');
    for (const line of r.chat) this.chatLine(log, line);
  }

  private chatLine(parent: HTMLElement, l: ChatLine): void {
    const row = el('div', `ad-line${l.from ? '' : ' sys'}`, parent);
    el('span', 'ad-dim', row, time(l.at));
    if (l.from) {
      if (l.team) el('span', 'ad-badge', row, `팀 ${l.side === 'red' ? '레드' : '블루'}`);
      el('b', l.from.team ? `side-${l.from.team}` : '', row, `${l.from.name}#${l.from.tag}`);
      el('span', '', row, l.text ?? '');
    } else {
      const what = SYS[l.sys ?? ''] ?? l.sys ?? '';
      el('span', '', row, l.sys === 'notice' ? `[공지] ${l.text ?? ''}` : `${what}${l.who ? ` · ${l.who.name}#${l.who.tag}` : ''}`);
    }
  }

  private people(s: AdminState): void {
    const all = [...s.rooms.flatMap((r) => r.members), ...s.lobby];
    if (!all.length) el('div', 'ad-empty', this.body, '접속한 사람이 없습니다.');
    else this.peopleTable(this.body!, all, null, s);
  }

  private peopleTable(parent: HTMLElement, list: AdminPerson[], owner: string | null, s?: AdminState): void {
    const table = el('table', 'ad-table', parent);
    const head = el('tr', '', el('thead', '', table));
    for (const h of ['이름#태그', s ? '방' : '팀', '기기', '주소', '상태', '']) el('th', '', head, h);
    const tbody = el('tbody', '', table);
    for (const p of list) {
      const tr = el('tr', '', tbody);
      el('td', 'ad-who', tr, `${p.name}#${p.tag}`);
      el('td', '', tr, s ? (p.room ? (s.rooms.find((r) => r.id === p.room)?.settings.name ?? p.room) : '로비') : p.team === 'red' ? '레드' : p.team === 'blue' ? '블루' : '-');
      el('td', '', tr, p.device === 'mobile' ? '모바일' : 'PC');
      el('td', 'ad-mono', tr, p.addr);
      const st = el('td', '', tr);
      if (p.id === owner) el('span', 'ad-badge host', st, '방장');
      if (p.away) el('span', 'ad-badge', st, '연결 끊김');
      if (p.muted) el('span', 'ad-badge warn', st, '채금');
      const acts = el('td', 'ad-acts', tr);
      if (p.room) this.button(acts, '강퇴', () => this.op({ op: 'kick', client: p.id }), `${p.name}#${p.tag} 를 방에서 내보낼까요?`);
      this.menu(acts, '채금', [['10분', 10], ['1시간', 60], ['1일', 1440], ['영구', 0]], (m) => this.op({ op: 'mute', client: p.id, minutes: m }));
      this.menu(acts, '차단', [['1시간', 60], ['1일', 1440], ['7일', 10080], ['영구', 0]], (m) => {
        const reason = prompt(`${p.name}#${p.tag} 를 ${m ? `${m}분` : '영구'} 차단합니다. 사유 (상대에게 보입니다):`, '운영 정책 위반');
        if (reason !== null) this.op({ op: 'ban', client: p.id, minutes: m, reason });
      });
    }
  }

  private marks(s: AdminState): void {
    for (const [title, list, op] of [
      ['차단', s.bans, 'unban'],
      ['채금 (서버 전체)', s.mutes, 'unmute'],
    ] as const) {
      el('h2', 'ad-h2', this.body, `${title} ${list.length}`);
      if (!list.length) {
        el('div', 'ad-empty', this.body, '없음');
        continue;
      }
      const table = el('table', 'ad-table', this.body);
      const head = el('tr', '', el('thead', '', table));
      for (const h of ['이름#태그', '주소', '사유', '시작', '만료', '']) el('th', '', head, h);
      const tbody = el('tbody', '', table);
      for (const m of list) {
        const tr = el('tr', '', tbody);
        el('td', 'ad-who', tr, `${m.name}#${m.tag}`);
        el('td', 'ad-mono', tr, m.addr);
        el('td', '', tr, m.reason || '-');
        el('td', '', tr, time(m.at));
        el('td', '', tr, until(m));
        this.button(el('td', 'ad-acts', tr), '해제', () => this.op({ op, id: m.id }), `${m.name}#${m.tag} 의 ${title}를 풀까요?`);
      }
    }
  }

  /** Players' reports (owner, 2026-10-25): who, why, the room's chat at the time; marked seen to here. */
  private reports(s: AdminState): void {
    el('p', 'ad-desc', this.body, '방 안에서 플레이어가 보낸 신고입니다. 신고 당시 방의 최근 채팅(팀 채팅 포함)이 함께 저장됩니다. 제재는 접속자 탭에서 하고, 처리한 신고는 "처리함"으로 넘기세요.');
    const row = el('div', 'ad-row', this.body);
    this.button(row, this.reportsAll ? '처리 안 한 것만' : '처리한 것도 보기', () => {
      this.reportsAll = !this.reportsAll;
      this.draw();
    });
    const list = (s.reports ?? []).filter((x) => this.reportsAll || !x.done);
    if (!list.length) {
      el('div', 'ad-empty', this.body, '신고가 없습니다.');
      return;
    }
    for (const r of list) this.report(r);
  }

  private report(r: AdminReport): void {
    const card = el('section', `ad-room${r.done ? ' ad-done' : ''}`, this.body);
    const sum = el('div', 'ad-sum', card);
    el('span', 'ad-badge', sum, REASON[r.reason] ?? r.reason);
    el('b', '', sum, `${r.who.name}#${r.who.tag}`);
    el('span', 'ad-dim', sum, `${r.who.account ? `계정 ${r.who.account.slice(0, 8)}` : '손님'} · 주소 ${r.who.addr}`);
    el('span', 'ad-dim', sum, `신고자 ${r.from.name}#${r.from.tag} · 방 "${r.room}" · ${time(r.at)}`);
    if (r.note) el('div', 'ad-note', card, r.note);
    const acts = el('div', 'ad-acts', card);
    this.button(acts, r.done ? '다시 열기' : '처리함', () => this.op({ op: 'reportDone', id: r.id, done: !r.done }));
    const log = el('div', 'ad-chat', card);
    if (!r.chat.length) el('div', 'ad-dim', log, '대화 없음');
    for (const line of r.chat) this.chatLine(log, line);
  }

  /** Accounts (progression step 2): find by game name or id, reset progress, sign out everywhere. */
  private accounts(s: AdminState): void {
    el('p', 'ad-desc', this.body, '로그인한 계정입니다. 이름은 마지막에 쓴 게임 이름이고, 로그인 제공자의 번호·이메일은 서버에도 없습니다(해시만). 차단·채금은 접속자 탭에서 하면 계정에도 걸립니다.');
    const row = el('div', 'ad-row', this.body);
    const q = el('input', 'ad-input', row);
    q.maxLength = 40;
    q.placeholder = '게임 이름 일부 또는 계정 id 앞부분 (비우면 최근 순)';
    q.value = this.acctQuery;
    const go = (): void => {
      this.acctQuery = q.value.trim();
      this.op({ op: 'accounts', q: this.acctQuery });
    };
    el('button', 'ad-btn', row, '찾기').addEventListener('click', go);
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    const list = s.accounts ?? [];
    if (!list.length) {
      el('div', 'ad-empty', this.body, '찾은 계정이 없습니다.');
      return;
    }
    const table = el('table', 'ad-table', this.body);
    const head = el('tr', '', el('thead', '', table));
    for (const h of ['이름', '레벨', '경험치', '보급표', '경기', '로그인', '최근', 'id', '']) el('th', '', head, h);
    const tbody = el('tbody', '', table);
    for (const a of list) {
      const tr = el('tr', '', tbody);
      const who = el('td', 'ad-who', tr, a.name || '-');
      if (a.staff) el('span', 'ad-badge staff', who, '운영');
      el('td', '', tr, `Lv ${a.level}`);
      el('td', '', tr, a.xp.toLocaleString());
      el('td', '', tr, (a.tickets ?? 0).toLocaleString());
      el('td', '', tr, String(a.matches));
      el('td', '', tr, a.providers.map((p) => (p === 'google' ? 'Google' : p === 'discord' ? 'Discord' : p)).join(' · ') || '-');
      el('td', '', tr, a.updated ? time(a.updated) : '-');
      el('td', 'ad-mono', tr, a.id.slice(0, 10));
      const acts = el('td', 'ad-acts', tr);
      this.button(acts, '진행 초기화', () => this.op({ op: 'acctReset', id: a.id }), `${a.name || a.id} 의 진행(레벨, 전적, 기록)을 처음으로 되돌릴까요? 되돌릴 수 없습니다.`, true);
      this.button(acts, '모든 기기 로그아웃', () => this.op({ op: 'acctRevoke', id: a.id }), `${a.name || a.id} 를 모든 기기에서 로그아웃시킬까요?`);
      // Supply tickets (a prompt for how many; negative takes them away) and the staff mark.
      this.button(acts, '보급표 지급', () => {
        const raw = prompt(`${a.name || a.id} 에게 줄 보급표 수 (빼려면 음수)`, '10000');
        const n = raw === null ? NaN : Math.trunc(Number(raw.replace(/[,\s]/g, '')));
        if (Number.isFinite(n) && n !== 0) this.op({ op: 'acctTickets', id: a.id, n });
      });
      this.button(
        acts,
        a.staff ? '운영자 해제' : '운영자 지정',
        () => this.op({ op: 'acctStaff', id: a.id, on: !a.staff }),
        a.staff ? `${a.name || a.id} 의 운영자 표시를 뗄까요?` : `${a.name || a.id} 를 운영자로 지정할까요? 이름 옆에 "운영" 배지가 붙고, 상점에서 자기 보급표를 마음대로 늘릴 수 있게 됩니다. (관리자 페이지는 여전히 키로만 들어옵니다.)`,
      );
    }
  }

  /** The double events (owner, 2026-10-25): XP, weapon XP, supply tickets; the lobby's banner shows them. */
  private events(s: AdminState): void {
    el('p', 'ad-desc', this.body, '켜면 그때부터 시작하는 경기(멀티 방과 봇전)에 2배가 붙고, 메인 메뉴와 멀티 화면에 배너가 뜹니다. 이미 진행 중인 방은 다음 경기부터 적용됩니다.');
    const now = Date.now();
    const names: Record<EventKind, string> = { xp: '경험치 2배', weapon: '무기 경험치 2배', tickets: '보급표 2배' };
    for (const k of EVENT_KINDS) {
      const card = el('section', 'ad-room', this.body);
      const sum = el('div', 'ad-sum', card);
      el('b', '', sum, names[k]);
      const u = s.events?.[k];
      const on = u !== undefined && (u === 0 || u > now);
      el('span', `ad-badge ${on ? 'playing' : ''}`, sum, on ? (u === 0 ? '진행 중 (끌 때까지)' : `진행 중 · ${time(u!)} 까지`) : '꺼짐');
      const acts = el('div', 'ad-acts', card);
      for (const [label, minutes] of [['1시간', 60], ['1일', 1440], ['7일', 10080], ['끌 때까지', 0]] as const)
        this.button(acts, on ? `${label}로 다시` : `${label} 켜기`, () => this.op({ op: 'event', kind: k, on: true, minutes }), `${names[k]} 이벤트를 ${label} 켤까요?`);
      if (on) this.button(acts, '끄기', () => this.op({ op: 'event', kind: k, on: false, minutes: 0 }), `${names[k]} 이벤트를 끌까요?`, true);
    }
  }

  /** Notices and words: built once (what is being typed survives the redraws). */
  private tools(): void {
    const box = el('section', 'ad-tools', this.body);
    box.hidden = true;
    el('h2', 'ad-h2', box, '공지');
    el('p', 'ad-desc', box, '접속한 모든 사람의 채팅(대기실·게임)에 [공지]로 나갑니다. 사람의 채팅과 다른 모양이라 흉내 낼 수 없습니다.');
    const text = el('textarea', 'ad-input', box);
    text.maxLength = 120;
    text.rows = 2;
    const send = el('button', 'ad-btn primary', box, '공지 보내기');
    send.addEventListener('click', () => {
      const v = text.value.trim();
      if (!v || !confirm(`모두에게 보낼까요?\n\n${v}`)) return;
      this.op({ op: 'notice', text: v });
      text.value = '';
    });
    el('h2', 'ad-h2', box, '금칙어');
    el('p', 'ad-desc', box, '기본 욕설 목록에 더해 채팅에서 가릴 말과 이름·방 제목에 못 쓰게 할 말입니다. 띄어쓰기·숫자·기호를 끼워 넣어도 걸립니다.');
    const row = el('div', 'ad-row', box);
    const word = el('input', 'ad-input', row);
    word.maxLength = 32;
    word.placeholder = '추가할 말';
    const add = el('button', 'ad-btn', row, '추가');
    const submit = (): void => {
      const w = word.value.trim();
      if (w) this.op({ op: 'word', word: w, on: true });
      word.value = '';
    };
    add.addEventListener('click', submit);
    word.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    el('div', 'ad-words', box);
  }

  private fillWords(s: AdminState): void {
    const list = this.body?.querySelector<HTMLElement>('.ad-words');
    if (!list) return;
    list.replaceChildren();
    if (!s.words.length) el('span', 'ad-dim', list, '추가한 말이 없습니다.');
    for (const w of s.words) {
      const chip = el('span', 'ad-chip', list, w);
      const x = el('button', '', chip, '×');
      x.title = '빼기';
      x.addEventListener('click', () => this.op({ op: 'word', word: w, on: false }));
    }
  }

  private button(parent: HTMLElement, label: string, fn: () => void, ask?: string, danger = false): void {
    const b = el('button', `ad-btn small${danger ? ' danger' : ''}`, parent, label);
    b.addEventListener('click', () => {
      if (!ask || confirm(ask)) fn();
    });
  }

  private menu(parent: HTMLElement, label: string, options: [string, number][], fn: (minutes: number) => void): void {
    const sel = el('select', 'ad-btn small', parent);
    el('option', '', sel, label).value = '';
    for (const [t, m] of options) el('option', '', sel, t).value = String(m);
    sel.addEventListener('change', () => {
      const v = sel.value;
      sel.value = '';
      if (v !== '') fn(Number(v));
      sel.blur();
    });
  }
}

void new AdminPage().start();
