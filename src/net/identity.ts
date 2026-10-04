import { loadJSON, saveJSON } from '@/core/storage';
import { cleanName } from './lobbyProtocol';

const KEY = 'strikegy.player.v1';

/** The player's name and a hidden id kept per browser (to recognise a reconnect). */
export interface Identity {
  name: string | null;
  uid: string;
}

function newUid(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function loadIdentity(): Identity {
  const saved = loadJSON<Partial<Identity>>(KEY);
  const id: Identity = {
    name: typeof saved?.name === 'string' ? cleanName(saved.name) : null,
    uid: typeof saved?.uid === 'string' && /^[0-9a-f]{24}$/.test(saved.uid) ? saved.uid : newUid(),
  };
  if (id.uid !== saved?.uid) saveJSON(KEY, id);
  return id;
}

const SEAT_KEY = 'strikegy.seat.v1';

/**
 * The id the game server knows this browser tab by: the browser's hidden id
 * plus one kept per tab (session storage survives a reload, not a new tab).
 * A reload gets its seat in a match back; a second tab is someone else.
 */
export function seatId(): string {
  let tab: string;
  try {
    tab = sessionStorage.getItem(SEAT_KEY) ?? '';
    if (!/^[0-9a-f]{8}$/.test(tab)) {
      tab = newUid().slice(0, 8);
      sessionStorage.setItem(SEAT_KEY, tab);
    }
  } catch {
    tab = newUid().slice(0, 8);
  }
  return `${loadIdentity().uid}-${tab}`;
}

/** Saves a new name; returns the cleaned name or null when it can't be used. */
export function saveName(raw: string): string | null {
  const name = cleanName(raw);
  if (!name) return null;
  saveJSON(KEY, { ...loadIdentity(), name });
  cachedName = name;
  return name;
}

let cachedName: string | null | undefined;

/** The player's name in kill feeds, the scoreboard and squads: the saved name, else "you". */
export function playerName(fallback: string): string {
  if (cachedName === undefined) cachedName = loadIdentity().name;
  return cachedName ?? fallback;
}
