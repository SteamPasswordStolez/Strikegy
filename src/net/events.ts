import { EVENT_MULT, liveEvents, type EventKind, type ServerEvents } from './lobbyProtocol';

/**
 * The server's double events (XP / weapon XP / supply tickets) as this page
 * last heard them: from `/api/config` when the menu finds the server, and
 * from the game server's `events` message (on hello and whenever the staff
 * change them). The main menu and the multiplayer page show a banner; a bot
 * match started under one multiplies the same way the server's rooms do.
 */

let current: ServerEvents = {};
const listeners = new Set<() => void>();

export function setServerEvents(ev: ServerEvents | undefined): void {
  const next = ev ?? {};
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = { ...next };
  for (const fn of listeners) fn();
}

export function onServerEvents(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The kinds on now, each with when it ends (0: until the staff turn it off). */
export function eventsNow(now = Date.now()): { kind: EventKind; until: number }[] {
  return liveEvents(current, now).map((kind) => ({ kind, until: current[kind]! }));
}

/** Multipliers for a match starting now (none: no event on). */
export function eventMults(now = Date.now()): Partial<Record<EventKind, number>> | undefined {
  const on = liveEvents(current, now);
  return on.length ? Object.fromEntries(on.map((k) => [k, EVENT_MULT])) : undefined;
}
