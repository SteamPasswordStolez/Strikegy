// Patch 11-D: Client-side protocol mirror (must match server src/protocol.js)

// Bump when message shapes change (keep in sync with server PROTOCOL_VERSION)
// Patch 11-D1: add minimal in-game authoritative movement + snapshots
export const EXPECTED_PROTOCOL_VERSION = "11D1-1";

// Client -> Server
export const C2S = Object.freeze({
  // Patch 11-D1: reconnect across page navigation
  RECONNECT: "RECONNECT",
  LOBBY_LIST: "LOBBY_LIST",
  ROOM_CREATE: "ROOM_CREATE",
  ROOM_JOIN: "ROOM_JOIN",
  ROOM_LEAVE: "ROOM_LEAVE",
  ROOM_READY: "ROOM_READY",
  ROOM_SET_TEAM: "ROOM_SET_TEAM",
  ROOM_SET_NICK: "ROOM_SET_NICK",
  ROOM_SET_SETTINGS: "ROOM_SET_SETTINGS",
  ROOM_START: "ROOM_START",
  DEBUG_ECHO: "DEBUG_ECHO",

  // Patch 11-D1 (in-game)
  GAME_INPUT: "GAME_INPUT",
});

// Server -> Client
export const S2C = Object.freeze({
  INIT: "INIT",
  RECONNECT_OK: "RECONNECT_OK",
  LOBBY_LIST: "LOBBY_LIST",
  ROOM_UPDATE: "ROOM_UPDATE",
  ROOM_JOINED: "ROOM_JOINED",
  ROOM_LEFT: "ROOM_LEFT",
  NICK_UPDATED: "NICK_UPDATED",
  GAME_START: "GAME_START",
  ERROR: "ERROR",
  OK: "OK",
  DEBUG_ECHO: "DEBUG_ECHO",

  // Patch 11-D1 (in-game)
  GAME_SNAPSHOT: "GAME_SNAPSHOT",
});

// Utility: quick C2S validator for send-guard
export function isValidC2S(type) {
  return !!Object.values(C2S).includes(type);
}
