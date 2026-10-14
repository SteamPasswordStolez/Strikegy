import { t, type MessageKey } from '@/i18n';
import { bindings, type Action } from '@/input/bindings';
import { typing } from '@/input/typing';
import { isMuted, type ChatStore } from '@/net/chat';
import { CHAT_MAX, type ChatLine, type Side } from '@/net/lobbyProtocol';

/** HUD lines fade after this long while the box is closed (ms). */
const FADE_MS = 10_000;
/** Lines drawn at most. */
const SHOW = 60;

export interface ChatPanelOptions {
  store: ChatStore;
  send(text: string, team: boolean): void;
  /**
   * `room`: the waiting room's box (always open, names in side colours);
   * `hud`: in a match (closed until a key or tap opens it, lines fade, names
   * as ally / enemy).
   */
  kind: 'room' | 'hud';
  /** Whether there is a side to talk to on its own. */
  teamOk(): boolean;
  /** The reader's side (colours ally / enemy in the HUD). */
  myTeam(): Side | null;
  /** Whether a key may open the HUD box now (in play, nothing else up). */
  canOpen?(): boolean;
  touch?: boolean;
  /** The HUD box closed (the game takes the keys back). */
  onClose?(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

const keyOf = (a: Action, code: string): boolean => bindings()[a].includes(code);

/**
 * A room's chat box (owner, 2026-10-14): the log and a line to type in, with
 * a switch between everyone and one's own side. Every name carries its
 * server tag, the server's own notes look different from what people write,
 * and lines from blocked tags are left out. All text goes in as text, never
 * as markup.
 */
export class ChatPanel {
  readonly root: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly scope: HTMLButtonElement;
  private team = false;
  private isOpen: boolean;
  private readonly offs: (() => void)[] = [];

  constructor(private readonly o: ChatPanelOptions) {
    this.isOpen = o.kind === 'room';
    this.root = document.createElement('div');
    this.root.className = `chat chat-${o.kind}${this.isOpen ? ' open' : ''}${o.touch ? ' touch' : ''}`;
    this.log = el('div', 'chat-log', this.root);
    const form = el('div', 'chat-form', this.root);
    this.scope = el('button', 'chat-scope', form);
    this.scope.type = 'button';
    this.scope.addEventListener('mousedown', (e) => e.preventDefault());
    this.scope.addEventListener('click', () => this.setTeam(!this.team));
    this.input = el('input', 'chat-input', form);
    this.input.type = 'text';
    this.input.maxLength = CHAT_MAX;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = t(o.kind === 'room' ? 'chat.placeholder' : 'chat.placeholderHud');
    this.input.addEventListener('keydown', (e) => this.onInputKey(e));
    if (o.kind === 'hud') this.input.addEventListener('blur', () => this.close());
    if (o.kind === 'room') {
      const send = el('button', 'lb-btn chat-send', form, t('chat.send'));
      send.type = 'button';
      send.addEventListener('click', () => this.submit());
    }
    if (o.kind === 'hud' && o.touch) {
      const open = el('button', 'chat-open', this.root, '💬');
      open.type = 'button';
      open.setAttribute('aria-label', t('chat.open'));
      open.addEventListener('click', () => (this.isOpen ? this.close() : this.open(false)));
    }
    this.setTeam(false);
    this.redraw();
    this.offs.push(o.store.on((line) => (line ? this.append(line, true) : this.redraw())));
    if (o.kind === 'hud') {
      const onKey = (e: KeyboardEvent): void => {
        if (this.isOpen || typing(e) || e.repeat || !(this.o.canOpen?.() ?? true)) return;
        const all = keyOf('chat', e.code);
        const side = keyOf('teamChat', e.code);
        if (!all && !side) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.open(side && this.o.teamOk());
      };
      window.addEventListener('keydown', onKey, true);
      this.offs.push(() => window.removeEventListener('keydown', onKey, true));
    }
  }

  get opened(): boolean {
    return this.isOpen;
  }

  /** Puts the box into `parent` (again after a menu redraw), keeping what was being typed and the focus. */
  attach(parent: HTMLElement): void {
    const focused = document.activeElement === this.input;
    const start = this.input.selectionStart;
    parent.appendChild(this.root);
    this.scrollDown();
    if (focused) {
      this.input.focus({ preventScroll: true });
      if (start !== null) this.input.setSelectionRange(start, start);
    }
    this.setTeam(this.team);
  }

  /** Draws the log again (after someone was blocked or unblocked). */
  refresh(): void {
    this.redraw();
  }

  open(team: boolean): void {
    if (this.o.kind !== 'hud') return;
    this.isOpen = true;
    this.root.classList.add('open');
    this.setTeam(team);
    this.scrollDown();
    this.input.focus({ preventScroll: true });
  }

  close(): void {
    if (this.o.kind !== 'hud' || !this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.input.value = '';
    if (document.activeElement === this.input) this.input.blur();
    this.o.onClose?.();
  }

  private setTeam(on: boolean): void {
    this.team = on && this.o.teamOk();
    this.scope.textContent = t(this.team ? 'chat.scope.team' : 'chat.scope.all');
    this.scope.classList.toggle('team', this.team);
    this.scope.disabled = !this.o.teamOk();
    this.root.classList.toggle('to-team', this.team);
  }

  private onInputKey(e: KeyboardEvent): void {
    // The game's and the menu's keys never see what is typed here.
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      this.submit();
      if (this.o.kind === 'hud') this.close();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.setTeam(!this.team);
    } else if (e.key === 'Escape' && this.o.kind === 'hud') {
      this.close();
    }
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.o.send(text, this.team);
    this.input.value = '';
  }

  private redraw(): void {
    this.log.replaceChildren();
    for (const line of this.o.store.lines.slice(-SHOW)) this.append(line, false);
    if (!this.log.childElementCount && this.o.kind === 'room') el('div', 'chat-empty', this.log, t('chat.empty'));
  }

  private append(line: ChatLine, fresh: boolean): void {
    if (line.from && isMuted(line.from.tag)) return;
    this.log.querySelector('.chat-empty')?.remove();
    const row = lineView(line, this.o.kind === 'hud' ? this.o.myTeam() : null);
    this.log.appendChild(row);
    while (this.log.childElementCount > SHOW) this.log.firstElementChild?.remove();
    if (this.o.kind === 'hud') {
      if (fresh) setTimeout(() => row.classList.add('old'), FADE_MS);
      else row.classList.add('old');
    }
    this.scrollDown();
  }

  private scrollDown(): void {
    this.log.scrollTop = this.log.scrollHeight;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.root.remove();
  }
}

/** `name#TAG` as two spans (the tag fainter), coloured by side. */
export function nameView(parent: HTMLElement, who: { name: string; tag: string }, cls = ''): HTMLSpanElement {
  const span = el('span', `chat-who ${cls}`.trim(), parent);
  el('span', 'chat-name', span, who.name);
  if (who.tag) el('span', 'chat-tag', span, `#${who.tag}`).title = t('mp.tagNote');
  return span;
}

/** A name's colour: ally / enemy to the reader in a match, the side's own colour in the waiting room. */
function sideClass(side: Side | null, mine: Side | null): string {
  return !side ? '' : mine ? (side === mine ? 'ally' : 'enemy') : `side-${side}`;
}

/** One line: the server's notes in their own look; people's lines as [side] name#TAG: text. */
function lineView(line: ChatLine, mine: Side | null): HTMLDivElement {
  const row = document.createElement('div');
  if (!line.from) {
    row.className = 'chat-line sys';
    el('span', 'chat-sys-mark', row, '◆');
    const key = `chat.sys.${line.sys ?? 'join'}` as MessageKey;
    const [before, after = ''] = t(key).split('{who}');
    if (before) el('span', '', row, before);
    if (line.who) nameView(row, line.who, sideClass(line.side ?? null, mine));
    if (after) el('span', '', row, after.replace('{side}', line.side ? t(`chat.side.${line.side}`) : ''));
    return row;
  }
  row.className = `chat-line${line.team ? ' team' : ''}`;
  if (line.team) el('span', 'chat-badge', row, t('chat.scope.team'));
  nameView(row, line.from, sideClass(line.from.team, mine));
  el('span', 'chat-colon', row, ':');
  el('span', 'chat-text', row, line.text ?? '');
  return row;
}
