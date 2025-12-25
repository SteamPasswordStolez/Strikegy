// Patch 11-D: Lightweight WebSocket client for Lobby/Rooms
import { C2S, S2C, EXPECTED_PROTOCOL_VERSION, isValidC2S } from "./protocol.js";
export class LobbyWSClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.isOpen = false;
    this.you = null;          // {id, nick}
    this.rooms = [];          // lobby list
    this.room = null;         // current room snapshot
    this.handlers = new Map();// type -> [fn]

    this._reconnectTimer = null;
    this._shouldReconnect = false;
    this._reconnectDelayMs = 1200;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }
  emit(type, payload) {
    const arr = this.handlers.get(type) || [];
    for (const fn of arr) { try { fn(payload); } catch (_) {} }
  }

  connect({ reconnect = false } = {}) {
    this._shouldReconnect = !!reconnect;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => { this.isOpen = true; this.emit("open", null); };
    this.ws.onclose = () => {
      this.isOpen = false; this.emit("close", null);
      if (this._shouldReconnect) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(() => this.connect({ reconnect }), this._reconnectDelayMs);
      }
    };
    this.ws.onerror = (e) => this.emit("error", e);

    this.ws.onmessage = (e) => {
      let msg = null;
      try { msg = JSON.parse(e.data); } catch (_) {}
      if (!msg || !msg.type) return;

      // keep state
      if (msg.type === S2C.INIT) {
        this.you = msg.you || null;
        this.rooms = msg.lobby || [];

        // Patch 11-D1: persist reconnect token for navigation (lobby -> multigame)
        if (msg.reconnectToken) {
          try { sessionStorage.setItem('mp_reconnectToken', String(msg.reconnectToken)); } catch(_) {}
        }

        const pv = msg?.server?.protocolVersion;
        if (pv && pv !== EXPECTED_PROTOCOL_VERSION) {
          console.error("[PROTOCOL_MISMATCH] server=", pv, "client=", EXPECTED_PROTOCOL_VERSION);
          this.emit("protocol_mismatch", { server: pv, client: EXPECTED_PROTOCOL_VERSION });
        }
      } else if (msg.type === S2C.RECONNECT_OK) {
        this.you = msg.you || this.you;
        if (msg.room) this.room = msg.room;
        if (msg.lobby) this.rooms = msg.lobby;
        if (msg.reconnectToken) {
          try { sessionStorage.setItem('mp_reconnectToken', String(msg.reconnectToken)); } catch(_) {}
        }
      } else if (msg.type === S2C.LOBBY_LIST) {
        this.rooms = msg.rooms || [];
      } else if (msg.type === S2C.ROOM_UPDATE) {
        this.room = msg.room || null;
      } else if (msg.type === S2C.ROOM_LEFT) {
        this.room = null;
      } else if (msg.type === S2C.NICK_UPDATED) {
        if (this.you) this.you.nick = msg.nick;
      }

      this.emit("message", msg);
      this.emit(msg.type, msg);
    };
  }

  disconnect() {
    this._shouldReconnect = false;
    clearTimeout(this._reconnectTimer);
    if (this.ws) this.ws.close();
    this.ws = null;
    this.isOpen = false;
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (!obj || typeof obj.type !== "string") return false;

    // 11-D safety: never send unknown types (prevents UNKNOWN_TYPE desync)
    if (!isValidC2S(obj.type)) {
      console.error("[BLOCKED_SEND] invalid C2S type:", obj.type, obj);
      this.emit("blocked_send", { type: obj.type, obj });
      return false;
    }

    this.ws.send(JSON.stringify(obj));
    return true;
  }

  lobbyList() { return this.send({ type: C2S.LOBBY_LIST }); }
  setNick(nick) { return this.send({ type: C2S.ROOM_SET_NICK, nick }); }
  createRoom(name, maxPlayers = 8, { settings = null, privateRoom = false, password = "" } = {}) {
    const payload = { type: C2S.ROOM_CREATE, name, maxPlayers };
    if (settings) payload.settings = settings;
    // Optional fields (server may ignore in 11-A)
    payload.private = !!privateRoom;
    if (password) payload.password = String(password);
    return this.send(payload);
  }
  joinRoom(roomId, { password = "" } = {}) {
    const payload = { type: C2S.ROOM_JOIN, roomId };
    if (password) payload.password = String(password);
    return this.send(payload);
  }
  leaveRoom() { return this.send({ type: C2S.ROOM_LEAVE }); }
  ready(ready) { return this.send({ type: C2S.ROOM_READY, ready: !!ready }); }
  setTeam(team) { return this.send({ type: C2S.ROOM_SET_TEAM, team }); }
  setSettings(settings) { return this.send({ type: C2S.ROOM_SET_SETTINGS, settings }); }
  start() { return this.send({ type: C2S.ROOM_START }); }

  // Patch 11-D1
  reconnect(token) { return this.send({ type: C2S.RECONNECT, token: String(token || "") }); }
}
