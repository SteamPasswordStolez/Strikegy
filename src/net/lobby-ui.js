import { LobbyWSClient } from "./LobbyWSClient.js";

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}

function wsDefaultUrl() {
  const ip = "161.33.12.159:3000";
  // GitHub Pages is https, ws:// will be blocked. We still default by scheme.
  return (location.protocol === "https:" ? "wss://" : "ws://") + ip;
}

let client = null;

function setStatus(text, cls = "") {
  const el = $("#mpStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "mp-status " + cls;
}

function renderLobby(rooms = []) {
  const list = $("#mpRoomList");
  if (!list) return;

  if (!rooms.length) {
    list.innerHTML = `<div class="mp-empty">방이 아직 없어요. 만들어보자!</div>`;
    return;
  }

  list.innerHTML = rooms.map(r => {
    const disabled = (r.state !== "LOBBY" || r.players >= r.maxPlayers) ? "disabled" : "";
    const badge = r.state === "IN_GAME" ? `<span class="mp-badge">IN GAME</span>` : "";
    return `
      <div class="mp-room">
        <div class="mp-room-main">
          <div class="mp-room-title">${esc(r.name)} ${badge}</div>
          <div class="mp-room-meta">코드 <b>${esc(r.id)}</b> · ${r.players}/${r.maxPlayers}</div>
        </div>
        <button class="mp-btn mp-join" data-room="${esc(r.id)}" ${disabled}>참가</button>
      </div>
    `;
  }).join("");

  list.querySelectorAll("button[data-room]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-room");
      client?.joinRoom(id);
    });
  });
}

function renderRoom(room) {
  const panel = $("#mpRoomPanel");
  const lobbyPanel = $("#mpLobbyPanel");
  if (!panel || !lobbyPanel) return;

  if (!room) {
    panel.style.display = "none";
    lobbyPanel.style.display = "";
    return;
  }

  lobbyPanel.style.display = "none";
  panel.style.display = "";

  $("#mpRoomName").textContent = `${room.name} (${room.id})`;
  $("#mpRoomState").textContent = room.state;

  const youId = client?.you?.id;
  const isHost = room.hostId === youId;

  // players
  const pList = $("#mpPlayerList");
  pList.innerHTML = room.players.map(p => {
    const hostMark = (p.id === room.hostId) ? " 👑" : "";
    const ready = p.ready ? `<span class="mp-tag mp-tag-ready">READY</span>` : `<span class="mp-tag">NOT READY</span>`;
    const team = `<span class="mp-tag mp-tag-team">${esc(p.team)}</span>`;
    const me = (p.id === youId) ? `<span class="mp-tag mp-tag-me">YOU</span>` : "";
    return `
      <div class="mp-player">
        <div class="mp-player-left">
          <b>${esc(p.nick)}${hostMark}</b>
          <div class="mp-player-sub">ID ${esc(p.id.slice(0,6))}</div>
        </div>
        <div class="mp-player-right">${me} ${team} ${ready}</div>
      </div>
    `;
  }).join("");

  // settings
  const s = room.settings || {};
  $("#mpSetMode").value = s.mode || "ZONE";
  $("#mpSetMap").value = s.map || "default";
  $("#mpSetMaxPlayers").value = s.maxPlayers || room.maxPlayers || 8;
  $("#mpSetFF").checked = !!s.friendlyFire;
  $("#mpSetTick").value = s.tickRate || 20;

  // host controls
  $("#mpHostOnlyHint").style.display = isHost ? "none" : "";
  $("#mpSettingsForm").querySelectorAll("input,select,button").forEach(el => {
    if (el.id === "mpBtnLeave" || el.id === "mpBtnReady" || el.id === "mpTeam") return;
    el.disabled = !isHost;
  });
  $("#mpBtnStart").disabled = !isHost;

  // ready button state
  const me = room.players.find(p => p.id === youId);
  const readyText = me?.ready ? "준비해제" : "준비";
  $("#mpBtnReady").textContent = readyText;
}

function ensureClient() {
  if (client) return client;

  const url = $("#mpServerUrl").value.trim();
  client = new LobbyWSClient(url);

  client.on("open", () => {
    setStatus("연결됨", "ok");
    client.lobbyList();
  });

  client.on("close", () => setStatus("연결 끊김", "warn"));
  client.on("error", () => setStatus("연결 오류", "bad"));

  client.on("INIT", () => {
    $("#mpYou").textContent = `${client.you.nick} (${client.you.id})`;
    renderLobby(client.rooms);
    renderRoom(client.room);
  });

  client.on("LOBBY_LIST", (m) => renderLobby(m.rooms || []));
  client.on("ROOM_UPDATE", (m) => renderRoom(m.room));
  client.on("ROOM_LEFT", () => renderRoom(null));
  client.on("ERROR", (m) => {
    setStatus(`오류: ${m.code}`, "bad");
    const box = $("#mpLog");
    if (box) box.textContent = `${m.code}: ${m.message}\n` + (box.textContent || "");
  });
  client.on("OK", (m) => {
    const box = $("#mpLog");
    if (box && m.type) box.textContent = `OK: ${m.type}\n` + (box.textContent || "");
  });
  client.on("GAME_START", (m) => {
    // Persist MP session info for game.html
    sessionStorage.setItem("mp_roomId", m.roomId);
    sessionStorage.setItem("mp_youId", client.you?.id || "");
    sessionStorage.setItem("mp_nick", client.you?.nick || "");
    sessionStorage.setItem("mp_settings", JSON.stringify(m.settings || {}));
    sessionStorage.setItem("mp_seed", String(m.seed ?? ""));
    // Go to game
    location.href = `game.html?mp=1&room=${encodeURIComponent(m.roomId)}`;
  });

  return client;
}

function bindUI() {
  // defaults
  $("#mpServerUrl").value = wsDefaultUrl();

  if (location.protocol === "https:") {
    $("#mpHttpsHint").style.display = "";
  }

  $("#mpBtnConnect").addEventListener("click", () => {
    const c = ensureClient();
    setStatus("연결 중...", "");
    c.connect({ reconnect: true });
  });

  $("#mpBtnRefresh").addEventListener("click", () => client?.lobbyList());

  $("#mpBtnSetNick").addEventListener("click", () => {
    const nick = $("#mpNick").value.trim();
    if (!nick) return;
    ensureClient();
    client.setNick(nick);
  });

  $("#mpBtnCreate").addEventListener("click", () => {
    ensureClient();
    const name = $("#mpCreateName").value.trim() || "Room";
    const maxPlayers = Number($("#mpCreateMax").value || 8);
    client.createRoom(name, maxPlayers);
  });

  $("#mpBtnJoin").addEventListener("click", () => {
    ensureClient();
    const code = $("#mpJoinCode").value.trim().toUpperCase();
    if (!code) return;
    client.joinRoom(code);
  });

  $("#mpBtnLeave").addEventListener("click", () => client?.leaveRoom());

  $("#mpBtnReady").addEventListener("click", () => {
    const room = client?.room;
    const youId = client?.you?.id;
    const me = room?.players?.find(p => p.id === youId);
    client?.ready(!me?.ready);
  });

  $("#mpTeam").addEventListener("change", (e) => {
    const v = e.target.value;
    client?.setTeam(v);
  });

  $("#mpBtnApplySettings").addEventListener("click", () => {
    const settings = {
      mode: $("#mpSetMode").value,
      map: $("#mpSetMap").value.trim() || "default",
      maxPlayers: Number($("#mpSetMaxPlayers").value || 8),
      friendlyFire: $("#mpSetFF").checked,
      tickRate: Number($("#mpSetTick").value || 20),
    };
    client?.setSettings(settings);
  });

  $("#mpBtnStart").addEventListener("click", () => client?.start());
}

window.addEventListener("DOMContentLoaded", () => {
  bindUI();
});
