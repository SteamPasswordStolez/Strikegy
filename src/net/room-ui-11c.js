import { LobbyWSClient } from "./LobbyWSClient.js";

const $ = (sel) => document.querySelector(sel);

const LS_URL = "mp_server_url_v1";
const DEFAULT_WSS = "wss://ws.strikegy.org/ws";

function defaultServerUrl() {
  const saved = localStorage.getItem(LS_URL);
  if (saved) return saved;
  if (location.protocol === "https:") return DEFAULT_WSS;
  return "ws://161.33.12.159:3000";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]|'/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

let client = null;
let currentRoomId = null;

function setStatus(text, cls = "") {
  const el = $("#rStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "status " + cls;
}

function showError(message) {
  const card = $("#rErrorCard");
  const txt = $("#rErrorText");
  if (txt) txt.textContent = String(message || "");
  if (card) card.style.display = "";
}

function hideError() {
  const card = $("#rErrorCard");
  if (card) card.style.display = "none";
}

function getRoomIdFromUrl() {
  const u = new URL(location.href);
  return (u.searchParams.get("room") || "").trim().toUpperCase();
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function renderRoom(room) {
  if (!room) return;
  currentRoomId = room.id;
  $("#rTitle").textContent = `${room.name} (${room.id})`;
  const youId = client?.you?.id;
  const isHost = room.hostId === youId;

  // players
  const list = $("#rPlayers");
  if (list) {
    list.innerHTML = (room.players || []).map(p => {
      const host = p.id === room.hostId ? `<span class="tag tag-host">HOST</span>` : "";
      const me = p.id === youId ? `<span class="tag tag-me">YOU</span>` : "";
      const team = `<span class="tag tag-team">${esc(p.team)}</span>`;
      const ready = p.ready ? `<span class="tag tag-ready">READY</span>` : `<span class="tag">NOT READY</span>`;
      return `
        <div class="player">
          <div>
            <b>${esc(p.nick)}</b>
            <div class="hint" style="margin-top:4px;">ID ${esc(String(p.id).slice(0,6))}</div>
          </div>
          <div>
            ${me} ${host} ${team} ${ready}
          </div>
        </div>
      `;
    }).join("");
  }

  // settings fill
  const s = room.settings || {};
  const rules = s.rules || {};
  const econ = s.economy || {};
  const bots = s.bots || {};

  $("#rMode").value = s.mode || "zone";
  $("#rZoneTickets").value = clampNum(rules.zoneTickets ?? 300, 1, 999, 300);
  $("#rRespawn").value = clampNum(rules.respawnTime ?? 5, 0, 30, 5);
  $("#rBotsEnabled").checked = !!bots.enabled;

  $("#rMoneyStart").value = clampNum(econ.startMoney ?? 1200, 0, 20000, 1200);
  $("#rMoneyCap").value = clampNum(econ.capMoney ?? 9000, 0, 20000, 9000);
  $("#rIncome30").value = clampNum(econ.incomePer30 ?? 100, 0, 5000, 100);
  $("#rKill").value = clampNum(econ.killReward ?? 300, 0, 5000, 300);
  $("#rCapture").value = clampNum(econ.captureReward ?? 200, 0, 5000, 200);
  $("#rCaptureN").value = clampNum(econ.captureDivisor ?? 1, 1, 16, 1);

  // host-only UI lock
  $("#rHostHint").style.display = isHost ? "none" : "";
  $("#rBtnStart").disabled = !isHost;

  // apply safety + host
  const confirm = $("#rConfirm");
  const applyBtn = $("#rBtnApply");
  applyBtn.disabled = !(isHost && confirm.checked);

  // disable inputs for non-host
  const lock = !isHost;
  $("#rMode").disabled = lock;
  $("#rZoneTickets").disabled = lock;
  $("#rRespawn").disabled = lock;
  $("#rBotsEnabled").disabled = lock;
  $("#rMoneyStart").disabled = lock;
  $("#rMoneyCap").disabled = lock;
  $("#rIncome30").disabled = lock;
  $("#rKill").disabled = lock;
  $("#rCapture").disabled = lock;
  $("#rCaptureN").disabled = lock;
  $("#rConfirm").disabled = lock;
  $("#rBtnApply").disabled = !(isHost && confirm.checked);

  // ready button label
  const meObj = (room.players || []).find(p => p.id === youId);
  $("#rBtnReady").textContent = meObj?.ready ? "준비해제" : "준비";

  // zone tickets only visible in zone
  const isZone = (s.mode || "zone") === "zone";
  $("#rZoneTickets").parentElement.style.opacity = isZone ? "1" : "0.45";
  $("#rZoneTickets").disabled = lock || !isZone;
}

function ensureClient() {
  if (client) return client;
  const url = defaultServerUrl();
  localStorage.setItem(LS_URL, url);

  client = new LobbyWSClient(url);

  client.on("open", () => {
    setStatus("연결됨", "ok");
    // immediately try join if roomId known
    const rid = getRoomIdFromUrl() || sessionStorage.getItem("mp_roomId") || "";
    if (rid) client.joinRoom(rid, null);
  });
  client.on("close", () => setStatus("연결 끊김", "warn"));
  client.on("error", () => setStatus("연결 오류", "bad"));

  client.on("INIT", () => {
    $("#rYou").textContent = `${client.you?.nick ?? "-"} (${client.you?.id ?? "-"})`;
  });

  client.on("ROOM_UPDATE", (m) => {
    hideError();
    if (m.room) renderRoom(m.room);
  });

  client.on("ROOM_LEFT", () => {
    showError("방에서 나왔습니다.");
  });

  client.on("ERROR", (m) => {
    // ROOM_NOT_FOUND이면 빠르게 안내
    if (m.code === "ROOM_NOT_FOUND") {
      showError("방을 찾을 수 없어요. (서버가 빈 방을 즉시 삭제하는 설정일 수 있음)\n멀티 로비로 돌아가서 다시 방을 만들어주세요.");
    } else {
      showError(`${m.code}: ${m.message}`);
    }
  });

  client.on("GAME_START", (m) => {
    sessionStorage.setItem("mp_roomId", m.roomId);
    sessionStorage.setItem("mp_youId", client.you?.id || "");
    sessionStorage.setItem("mp_nick", client.you?.nick || "");
    sessionStorage.setItem("mp_settings", JSON.stringify(m.settings || {}));
    sessionStorage.setItem("mp_seed", String(m.seed ?? ""));
    if (m.settings && m.settings.mode) {
      try { localStorage.setItem("selectedMode", String(m.settings.mode)); } catch (_) {}
    }
    location.href = `game.html?mp=1&room=${encodeURIComponent(m.roomId)}`;
  });

  return client;
}

function bindUI() {
  if (location.protocol === "https:") {
    $("#rHintHttps").style.display = "";
  }

  const rid = getRoomIdFromUrl() || sessionStorage.getItem("mp_roomId") || "";
  if (!rid) {
    showError("room 파라미터가 없습니다. 멀티 로비에서 방을 만들거나 참가해 주세요.");
  }

  const c = ensureClient();
  setStatus("CONNECTING…", "");
  c.connect({ reconnect: true });

  // ready/team/leave
  $("#rTeam").addEventListener("change", (e) => client?.setTeam(e.target.value));
  $("#rBtnReady").addEventListener("click", () => {
    const room = client?.room;
    const youId = client?.you?.id;
    const me = room?.players?.find(p => p.id === youId);
    client?.ready(!me?.ready);
  });
  $("#rBtnLeave").addEventListener("click", () => {
    client?.leaveRoom();
    location.href = "multiplay.html";
  });

  // safety checkbox
  const confirm = $("#rConfirm");
  confirm.addEventListener("change", () => {
    const room = client?.room;
    const youId = client?.you?.id;
    const isHost = room?.hostId === youId;
    $("#rBtnApply").disabled = !(isHost && confirm.checked);
  });

  // apply settings
  $("#rBtnApply").addEventListener("click", () => {
    const room = client?.room;
    const youId = client?.you?.id;
    if (!room || room.hostId !== youId) return;

    const mode = $("#rMode").value;
    const settings = {
      ...(room.settings || {}),
      mode,
      bots: {
        ...(room.settings?.bots || {}),
        enabled: !!$("#rBotsEnabled").checked,
      },
      rules: {
        ...(room.settings?.rules || {}),
        respawnTime: clampNum($("#rRespawn").value, 0, 30, 5),
        zoneTickets: clampNum($("#rZoneTickets").value, 1, 999, 300),
      },
      economy: {
        ...(room.settings?.economy || {}),
        startMoney: clampNum($("#rMoneyStart").value, 0, 20000, 1200),
        capMoney: clampNum($("#rMoneyCap").value, 0, 20000, 9000),
        incomePer30: clampNum($("#rIncome30").value, 0, 5000, 100),
        killReward: clampNum($("#rKill").value, 0, 5000, 300),
        captureReward: clampNum($("#rCapture").value, 0, 5000, 200),
        captureDivisor: clampNum($("#rCaptureN").value, 1, 16, 1),
      },
    };

    // If not zone, ignore zoneTickets visually (still sent; server may ignore)
    if (mode !== "zone") {
      settings.rules = { ...settings.rules, zoneTickets: settings.rules.zoneTickets };
    }

    client?.setSettings(settings);

    // after apply, force user to re-confirm for next change
    $("#rConfirm").checked = false;
    $("#rBtnApply").disabled = true;
  });

  $("#rBtnStart").addEventListener("click", () => client?.start());

  // simple back button on error card
  $("#rBtnBack").addEventListener("click", () => location.href = "multiplay.html");
}

window.addEventListener("DOMContentLoaded", bindUI);
