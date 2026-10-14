import { loadJSON, saveJSON } from '@/core/storage';
import type { ChatLine } from './lobbyProtocol';
import type { ServerLink } from './ServerLink';

/** Lines kept in the browser (the waiting room and the match share them). */
const KEEP = 80;
const MUTE_KEY = 'strikegy.muted.v1';

/**
 * A connection's chat: every line from the moment it connected (the server
 * also sends the room's recent lines on joining), kept while the menu hands
 * the connection to the match, so both show the same conversation.
 */
export class ChatStore {
  readonly lines: ChatLine[] = [];
  private readonly listeners = new Set<(line: ChatLine | null) => void>();

  constructor(link: ServerLink) {
    link.on('chat', (m) => this.add(m.line));
    link.on('chatLog', (m) => {
      this.lines.length = 0;
      this.lines.push(...m.lines.slice(-KEEP));
      this.emit(null);
    });
  }

  private add(line: ChatLine): void {
    this.lines.push(line);
    if (this.lines.length > KEEP) this.lines.shift();
    this.emit(line);
  }

  private emit(line: ChatLine | null): void {
    for (const fn of this.listeners) fn(line);
  }

  /** Called with each new line, or null when the whole log was replaced. */
  on(fn: (line: ChatLine | null) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
}

const stores = new WeakMap<ServerLink, ChatStore>();

/** The chat of a connection (made on first ask; ask as soon as it is open). */
export function chatOf(link: ServerLink): ChatStore {
  let s = stores.get(link);
  if (!s) stores.set(link, (s = new ChatStore(link)));
  return s;
}

/** Tags this browser doesn't want to read (blocked people), kept per browser. */
let muted: Set<string> | null = null;

function mutedSet(): Set<string> {
  if (!muted) {
    const saved = loadJSON<string[]>(MUTE_KEY);
    muted = new Set(Array.isArray(saved) ? saved.filter((x) => typeof x === 'string').slice(0, 500) : []);
  }
  return muted;
}

export function isMuted(tag: string): boolean {
  return !!tag && mutedSet().has(tag);
}

/** Blocks or unblocks someone's chat (by tag: names can be taken again, tags can't). */
export function setMuted(tag: string, on: boolean): void {
  const set = mutedSet();
  if (on) set.add(tag);
  else set.delete(tag);
  saveJSON(MUTE_KEY, [...set]);
}
