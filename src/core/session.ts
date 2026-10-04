/**
 * What the page is doing, kept in the tab (session storage) instead of the
 * address, so the address stays the site's own (strikegy.xyz): the solo match
 * being played (a reload or "again" starts it again) and being in a
 * multiplayer room (a reload comes back to it). Lost with the tab; every
 * call fails soft (no storage: a reload just goes to the menu).
 */
const MATCH = 'strikegy.match';
const ROOM = 'strikegy.room';

function get(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* no storage */
  }
}

/** The solo match being played: its settings as a query string ('?map=...&bots=...'). */
export const rememberMatch = (query: string): void => set(MATCH, query);
export const recallMatch = (): string | null => get(MATCH);

/** In a multiplayer room (or its match). */
export const rememberRoom = (): void => set(ROOM, '1');
export const inRoom = (): boolean => get(ROOM) === '1';

/** Back to the main menu: nothing to come back to. */
export function forgetPlay(): void {
  set(MATCH, null);
  set(ROOM, null);
}
