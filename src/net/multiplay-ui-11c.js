import { LobbyWSClient } from "./LobbyWSClient.js";

const $ = (sel) => document.querySelector(sel);

const LS_URL = "mp_server_url_v1";
const DEFAULT_WSS = "wss://ws.strikegy.org/ws";

function defaultServerUrl() {
  const saved = localStorage.getItem(LS_URL);
  if (saved) return saved;
  // GitHub Pages(https) -> must be wss
  if (location.protocol === "https:") return DEFAULT_WSS;
  return "ws://161.33.12.159:3000";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

let client = null;
let pendingNav = null; // { type: 'create'|'join', roomId?: string }

function setStatus(text, cls = "") {
  const el = $("#mpStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "mp-status " + cls;
}

function logLine(line) {
  const box = $("#mpLog");
  if (!box) return;
  box.textContent = String(line) + "\n" + (box.textContent || "");
}

function openModal(id) {
  const el = $(id);
  if (!el) return;
  el.style.display = "";
}

function closeModal(id) {
  const el = $(id);
  if (!el) return;
  el.style.display = "none";
}

function renderLobby(rooms = []) {
  const list = $("#mpRoomList");
  if (!list) return;

  if (!rooms.length) {
    list.innerHTML = `<div class="mp-empty">방이 아직 없어요. 오른쪽 위에서 만들어보자!</div>`;
    return;
  }

  list.innerHTML = rooms.map(r => {
    const disabled = (r.state !== "LOBBY" || r.players >= r.maxPlayers) ? "disabled" : "";
    const badge = r.state === "IN_GAME" ? `<span class="mp-badge">IN GAME</span>` : "";
    const lock = r.private ? `<span class="mp-badge">LOCK</span>` : "";
    return `
      <div class="mp-room">
        <div class="mp-room-main">
          <div class="mp-room-title">${esc(r.name)} ${badge} ${lock}</div>
          <div class="mp-room-meta">코드 <b>${esc(r.id)}</b> · ${r.players}/${r.maxPlayers}</div>
        </div>
        <button class="mp-btn mp-join" data-room="${esc(r.id)}" ${disabled}>참가</button>
      </div>
    `;
  }).join("");

  list.querySelectorAll("button[data-room]").forEach(btn => {
    btn.addEventListener("click", () => {
      const rid = btn.getAttribute("data-room");
      $("#mpJoinCode").value = String(rid || "");
      $("#mpJoinPass").value = "";
      openModal("#mpModalJoin");
    });
  });
}

function ensureClient() {
  if (client) return client;

  const url = defaultServerUrl();
  localStorage.setItem(LS_URL, url);

  client = new LobbyWSClient(url);

  client.on("open", () => {
    setStatus("연결됨", "ok");
    client.lobbyList();
  });

  client.on("close", () => setStatus("연결 끊김", "warn"));
  client.on("error", () => setStatus("연결 오류", "bad"));

  client.on("INIT", () => {
    $("#mpYou").textContent = `${client.you?.nick ?? "-"} (${client.you?.id ?? "-"})`;
    renderLobby(client.rooms);
  });

  client.on("LOBBY_LIST", (m) => renderLobby(m.rooms || []));

  client.on("ROOM_UPDATE", (m) => {
    const room = m.room;
    if (!room) return;

    // 방을 만든/참가한 직후에는 room.html로 넘겨준다.
    if (pendingNav && room.id) {
      const rid = String(room.id);
      sessionStorage.setItem("mp_roomId", rid);
      sessionStorage.setItem("mp_nick", client.you?.nick || "");
      sessionStorage.setItem("mp_youId", client.you?.id || "");

      // NOTE: 서버가 방을 '즉시 삭제'하는 구조라면, room.html 이동 시 방이 사라질 수 있음.
      // 11-D에서 서버 TTL(예: 60초 유지)을 넣으면 완전히 해결됨.

      pendingNav = null;
      location.href = `room.html?room=${encodeURIComponent(rid)}`;
    }
  });

  client.on("ERROR", (m) => {
    setStatus(`오류: ${m.code}`, "bad");
    logLine(`${m.code}: ${m.message}`);
  });

  return client;
}

function bindUI() {
  if (location.protocol === "https:") {
    $("#mpHttpsHint").style.display = "";
  }

  const c = ensureClient();
  setStatus("CONNECTING…", "");
  c.connect({ reconnect: true });

  $("#mpBtnRefresh").addEventListener("click", () => client?.lobbyList());

  $("#mpBtnSetNick").addEventListener("click", () => {
    const nick = $("#mpNick").value.trim();
    if (!nick) return;
    client?.setNick(nick);
  });

  // 모달 열기/닫기
  $("#mpBtnOpenCreate").addEventListener("click", () => openModal("#mpModalCreate"));
  $("#mpBtnOpenJoin").addEventListener("click", () => openModal("#mpModalJoin"));

  $("#mpCloseCreate").addEventListener("click", () => closeModal("#mpModalCreate"));
  $("#mpCloseJoin").addEventListener("click", () => closeModal("#mpModalJoin"));

  // 배경 클릭하면 닫기
  $("#mpModalCreate").addEventListener("click", (e) => { if (e.target.id === "mpModalCreate") closeModal("#mpModalCreate"); });
  $("#mpModalJoin").addEventListener("click", (e) => { if (e.target.id === "mpModalJoin") closeModal("#mpModalJoin"); });

  // 비공개 체크 시 비밀번호 활성화
  const priv = $("#mpCreatePrivate");
  const pass = $("#mpCreatePass");
  const syncPass = () => { pass.disabled = !priv.checked; if (!priv.checked) pass.value = ""; };
  priv.addEventListener("change", syncPass);
  syncPass();

  // 생성
  $("#mpBtnCreate").addEventListener("click", () => {
    const name = $("#mpCreateName").value.trim() || "Room";
    const maxPlayers = Math.max(2, Math.min(16, Number($("#mpCreateMax").value || 8)));
    const isPrivate = !!$("#mpCreatePrivate").checked;
    const password = $("#mpCreatePass").value;

    pendingNav = { type: "create" };

    // 서버가 private/password를 지원하지 않더라도 무시되도록 설계됨
    client?.createRoom(name, maxPlayers, {
      private: isPrivate,
      password: (isPrivate && password) ? password : null,
      settings: {
        mode: "zone",
        rules: {
          zoneTickets: 300,
          respawnTime: 5,
        },
        economy: {
          startMoney: 1200,
          capMoney: 9000,
          incomePer30: 100,
          killReward: 300,
          captureReward: 200,
          captureDivisor: 1,
        },
        bots: { enabled: false },
      }
    });

    closeModal("#mpModalCreate");
    logLine(`[CREATE] ${name} (${maxPlayers})`);
  });

  // 참가
  $("#mpBtnJoin").addEventListener("click", () => {
    const roomId = $("#mpJoinCode").value.trim().toUpperCase();
    const password = $("#mpJoinPass").value;
    if (!roomId) return;

    pendingNav = { type: "join", roomId };
    client?.joinRoom(roomId, password || null);

    closeModal("#mpModalJoin");
    logLine(`[JOIN] ${roomId}`);
  });
}

window.addEventListener("DOMContentLoaded", bindUI);
