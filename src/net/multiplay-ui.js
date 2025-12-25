import { LobbyWSClient } from "./LobbyWSClient.js";

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}

const LS_URL = "mp_server_url_v1";

function defaultServerUrl() {
  const saved = localStorage.getItem(LS_URL);
  if (saved) return saved;

  // GitHub Pages(https)에서는 ws://가 차단되므로 wss://를 추천
  if (location.protocol === "https:") return "wss://ws.strikegy.org/ws";
  return "ws://161.33.12.159:3000";
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
      // open join modal with prefilled room code
      openModal("mpJoinModal");
      $("#mpJoinCode").value = id;
      $("#mpJoinPassword").value = "";
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

  const s = room.settings || {};
  // Patch 11-C: Only expose a safe subset
  $("#mpSetMode").value = s.mode || "zone";
  $("#mpSetBots").value = (s.botsEnabled ? "on" : "off");
  $("#mpSetZoneTickets").value = Number(s.zoneTickets ?? 200);
  $("#mpSetRespawn").value = Number(s.respawnSeconds ?? 5);

  const eco = s.economy || {};
  $("#mpEcoStart").value = Number(eco.startMoney ?? 1200);
  $("#mpEcoCap").value = Number(eco.cap ?? 9000);
  $("#mpEcoIncome30").value = Number(eco.incomePer30s ?? 100);
  $("#mpEcoKill").value = Number(eco.killReward ?? 300);
  $("#mpEcoCapture").value = Number(eco.captureReward ?? 200);
  $("#mpEcoCaptureDiv").value = Number(eco.captureDivisor ?? 1);

  // Zone tickets only makes sense in zone mode
  const mode = $("#mpSetMode").value;
  $("#mpSetZoneTickets").disabled = (mode !== "zone") || !isHost;

  $("#mpHostOnlyHint").style.display = isHost ? "none" : "";
  $("#mpSettingsForm").querySelectorAll("input,select,button").forEach(el => {
    if (el.id === "mpBtnLeave" || el.id === "mpBtnReady" || el.id === "mpTeam") return;
    // Apply button requires safety ack too (handled elsewhere)
    if (el.id === "mpBtnApplySettings") return;
    el.disabled = !isHost;
  });
  $("#mpBtnStart").disabled = !isHost;

  // Safety: ack reset when room updates
  $("#mpSafetyAck").checked = false;
  $("#mpBtnApplySettings").disabled = true;

  const me = room.players.find(p => p.id === youId);
  $("#mpBtnReady").textContent = me?.ready ? "준비해제" : "준비";
}

function ensureClient() {
  if (client) return client;

  const url = $("#mpServerUrl").value.trim();
  localStorage.setItem(LS_URL, url);

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

    // Room not found: stay in SPA, just show lobby
    if (m.code === "ROOM_NOT_FOUND") {
      renderRoom(null);
      closeModal("mpJoinModal");
    }
  });

  client.on("GAME_START", (m) => {
    sessionStorage.setItem("mp_roomId", m.roomId);
    sessionStorage.setItem("mp_youId", client.you?.id || "");
    sessionStorage.setItem("mp_nick", client.you?.nick || "");
    sessionStorage.setItem("mp_settings", JSON.stringify(m.settings || {}));
    sessionStorage.setItem("mp_seed", String(m.seed ?? ""));

    // Also apply mode immediately for game load
    if (m.settings && m.settings.mode) {
      try { localStorage.setItem("selectedMode", String(m.settings.mode)); } catch (_) {}
    }

    // Patch 11-D1: in-game runs on multigame.html
    location.href = `multigame.html?mp=1&room=${encodeURIComponent(m.roomId)}`;
  });

  return client;
}

// --- Modal helpers (SPA UI) ---
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("show");
  el.setAttribute("aria-hidden", "false");
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("show");
  el.setAttribute("aria-hidden", "true");
}

function closeAllModals() {
  ["mpCreateModal","mpJoinModal"].forEach(closeModal);
}

function bindUI() {
  $("#mpServerUrl").value = defaultServerUrl();
  $("#mpServerUrl").setAttribute("readonly", "readonly");

  if (location.protocol === "https:") {
    $("#mpHttpsHint").style.display = "";
  }

  // Patch 11-C: auto-connect (no manual connect)
  {
    const c = ensureClient();
    setStatus("연결 중...", "");
    c.connect({ reconnect: true });
  }

  $("#mpBtnRefresh").addEventListener("click", () => client?.lobbyList());

  $("#mpBtnSetNick").addEventListener("click", () => {
    const nick = $("#mpNick").value.trim();
    if (!nick) return;
    ensureClient();
    client.setNick(nick);
  });

  // Open modals
  $("#mpBtnOpenCreate").addEventListener("click", () => {
    openModal("mpCreateModal");
    $("#mpCreateName").focus();
  });
  $("#mpBtnOpenJoin").addEventListener("click", () => {
    openModal("mpJoinModal");
    $("#mpJoinCode").focus();
  });

  // Modal close buttons + backdrop click
  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close")));
  });
  ["mpCreateModal","mpJoinModal"].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener("click", (e) => {
      if (e.target === el) closeModal(id);
    });
  });

  // Create / Join (from modal)
  $("#mpBtnCreate").addEventListener("click", () => {
    ensureClient();
    const name = $("#mpCreateName").value.trim() || "Room";
    const maxPlayers = Number($("#mpCreateMax").value || 8);
    const privateRoom = $("#mpCreatePrivate").value === "1";
    const password = $("#mpCreatePassword").value.trim();
    client.createRoom(name, maxPlayers, { privateRoom, password });
    closeModal("mpCreateModal");
  });

  $("#mpBtnJoin").addEventListener("click", () => {
    ensureClient();
    const code = $("#mpJoinCode").value.trim().toUpperCase();
    if (!code) return;
    const password = $("#mpJoinPassword").value.trim();
    client.joinRoom(code, { password });
    closeModal("mpJoinModal");
  });

  $("#mpBtnLeave").addEventListener("click", () => client?.leaveRoom());

  $("#mpBtnReady").addEventListener("click", () => {
    const room = client?.room;
    const youId = client?.you?.id;
    const me = room?.players?.find(p => p.id === youId);
    client?.ready(!me?.ready);
  });

  $("#mpTeam").addEventListener("change", (e) => client?.setTeam(e.target.value));

  // Apply settings safety toggle
  $("#mpSafetyAck").addEventListener("change", () => {
    const isHost = (client?.room?.hostId === client?.you?.id);
    $("#mpBtnApplySettings").disabled = !(isHost && $("#mpSafetyAck").checked);
  });

  $("#mpSetMode").addEventListener("change", () => {
    const isHost = (client?.room?.hostId === client?.you?.id);
    $("#mpSetZoneTickets").disabled = ($("#mpSetMode").value !== "zone") || !isHost;
  });

  $("#mpBtnApplySettings").addEventListener("click", () => {
    const settings = {
      mode: $("#mpSetMode").value,
      botsEnabled: $("#mpSetBots").value === "on",
      zoneTickets: Number($("#mpSetZoneTickets").value || 200),
      respawnSeconds: Number($("#mpSetRespawn").value || 5),
      economy: {
        startMoney: Number($("#mpEcoStart").value || 1200),
        cap: Number($("#mpEcoCap").value || 9000),
        incomePer30s: Number($("#mpEcoIncome30").value || 100),
        killReward: Number($("#mpEcoKill").value || 300),
        captureReward: Number($("#mpEcoCapture").value || 200),
        captureDivisor: Number($("#mpEcoCaptureDiv").value || 1),
      }
    };
    client?.setSettings(settings);
    $("#mpSafetyAck").checked = false;
    $("#mpBtnApplySettings").disabled = true;
  });

  $("#mpBtnStart").addEventListener("click", () => client?.start());

  // ESC closes modals
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModals();
  });
}

window.addEventListener("DOMContentLoaded", bindUI);
