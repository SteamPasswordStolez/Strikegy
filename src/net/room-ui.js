import { LobbyWSClient } from "./LobbyWSClient.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);

function defaultServerUrl(){
  if (location.protocol === "https:") return "wss://ws.strikegy.org/ws";
  return "ws://161.33.12.159:3000";
}

let client = null;
let joining = false;

function setStatus(txt, cls=""){
  const el = $("#st");
  el.textContent = txt;
  el.className = "pill " + cls;
}

function getRoomId(){
  const url = new URL(location.href);
  return url.searchParams.get("room") || sessionStorage.getItem("mp_roomId") || "";
}

function getPassword(){
  const url = new URL(location.href);
  return url.searchParams.get("pw") || sessionStorage.getItem("mp_roomPassword") || "";
}

function render(room){
  if (!room) return;
  $("#roomName").textContent = `${room.name} (${room.id})`;

  const youId = client?.you?.id;
  const isHost = room.hostId === youId;
  $("#hostHint").style.display = isHost ? "none" : "";

  // players
  const p = $("#players");
  p.innerHTML = (room.players || []).map(pl => {
    const host = pl.id === room.hostId ? " 👑" : "";
    const me = pl.id === youId ? " <span class=\"tag me\">YOU</span>" : "";
    const ready = pl.ready ? "<span class=\"tag ok\">READY</span>" : "<span class=\"tag\">NOT READY</span>";
    const team = `<span class=\"tag\">${esc(pl.team)}</span>`;
    return `<div class=\"row\"><div><b>${esc(pl.nick)}${host}</b><div class=\"muted\">ID ${esc(pl.id.slice(0,6))}</div></div><div>${me} ${team} ${ready}</div></div>`;
  }).join("");

  // settings -> inputs (host only editable)
  const s = room.settings || {};
  const bots = s.bots || {};
  const econ = s.economy || {};
  const rules = s.rules || {};

  $("#botsEnabled").checked = !!bots.enabled;
  $("#botsCount").value = Number(bots.count ?? 0);

  $("#zoneTickets").value = Number((rules.zoneTickets ?? 0) || 0);
  $("#respawn").value = Number((rules.respawnTime ?? 5) || 5);

  $("#moneyStart").value = Number(econ.startMoney ?? 1200);
  $("#moneyCap").value = Number(econ.moneyCap ?? 9000);
  $("#moneyPer30").value = Number(econ.per30 ?? 100);
  $("#moneyKill").value = Number(econ.kill ?? 300);
  $("#moneyCapObj").value = Number(econ.captureBase ?? 200);
  $("#moneyCapN").value = Number(econ.captureDiv ?? 1);

  // lock if not host
  document.querySelectorAll("#settings input, #settings button").forEach(el => {
    if (["btnReady","btnLeave"].includes(el.id)) return;
    if (!isHost && el.id !== "team") el.disabled = true;
  });
  $("#btnStart").disabled = !isHost;
}

function collectSettings(){
  const botsEnabled = !!$("#botsEnabled").checked;
  const botsCount = Math.max(0, Math.min(20, Number($("#botsCount").value || 0)));

  const zoneTickets = Math.max(0, Number($("#zoneTickets").value || 0));
  const respawnTime = Math.max(0, Number($("#respawn").value || 0));

  const econ = {
    startMoney: Math.max(0, Number($("#moneyStart").value || 0)),
    moneyCap: Math.max(0, Number($("#moneyCap").value || 0)),
    per30: Math.max(0, Number($("#moneyPer30").value || 0)),
    kill: Math.max(0, Number($("#moneyKill").value || 0)),
    captureBase: Math.max(0, Number($("#moneyCapObj").value || 0)),
    captureDiv: Math.max(1, Number($("#moneyCapN").value || 1)),
  };

  return {
    bots: { enabled: botsEnabled, count: botsCount },
    rules: { zoneTickets, respawnTime },
    economy: econ,
    // safety: server can ignore; this is a client-side guard marker
    safety: { confirmed: true }
  };
}

function bind(){
  const roomId = getRoomId();
  if (!roomId) {
    setStatus("room 파라미터 없음", "bad");
    return;
  }

  client = new LobbyWSClient(defaultServerUrl());

  client.on("open", () => {
    setStatus("연결됨", "ok");
    joining = true;
    client.joinRoom(roomId, getPassword() || null);
  });
  client.on("close", () => setStatus("연결 끊김", "warn"));
  client.on("error", () => setStatus("연결 오류", "bad"));

  client.on("INIT", () => {
    $("#you").textContent = `${client.you.nick} (${client.you.id})`;
  });

  client.on("ROOM_UPDATE", (m) => {
    joining = false;
    render(m.room);
  });

  client.on("ROOM_LEFT", () => {
    location.href = "multiplay.html";
  });

  client.on("ERROR", (m) => {
    setStatus(`오류: ${m.code}`, "bad");
    const box = $("#log");
    box.textContent = `${m.code}: ${m.message}\n` + (box.textContent || "");
    // join 실패하면 로비로
    if (joining) setTimeout(() => location.href = "multiplay.html", 800);
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

  // buttons
  $("#btnLeave").addEventListener("click", () => client.leaveRoom());
  $("#team").addEventListener("change", (e) => client.setTeam(e.target.value));
  $("#btnReady").addEventListener("click", () => {
    const room = client.room;
    const youId = client.you?.id;
    const me = room?.players?.find(p => p.id === youId);
    client.ready(!me?.ready);
  });

  $("#btnApply").addEventListener("click", () => {
    const s = collectSettings();
    // safety latch: extremely low respawn needs explicit confirm
    if (s.rules.respawnTime < 2) {
      if (!confirm("리스폰 시간이 2초 미만이면 게임이 난장판 될 수 있어. 진짜 적용할까?") ) return;
    }
    client.setSettings(s);
  });

  $("#btnStart").addEventListener("click", () => client.start());

  client.connect({ reconnect: true });
}

window.addEventListener("DOMContentLoaded", bind);
