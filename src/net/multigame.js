import { LobbyWSClient } from "./LobbyWSClient.js";
import { C2S } from "./protocol.js";

const $ = (s) => document.querySelector(s);
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

function qs(name) {
  try { return new URLSearchParams(location.search).get(name); } catch (_) { return null; }
}

function log(...a) {
  const box = document.getElementById("log");
  if (!box) return;
  const s = a.map(x => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  box.textContent = `${s}\n` + (box.textContent || "");
}

function setStatus(text, good) {
  $("#st").textContent = text;
  const dot = $("#dot");
  dot.classList.toggle("good", !!good);
  dot.classList.toggle("bad", !good);
}

// --- boot params ---
const roomId = (qs("room") || sessionStorage.getItem("mp_roomId") || "").toUpperCase();
const wsUrl = localStorage.getItem("strikegy_mp_url") || (location.protocol === "https:" ? `wss://${location.host}/ws` : `ws://${location.host}/ws`);

log(`[SYSTEM] wsUrl=${wsUrl}`);

// Show known params immediately (even before INIT/ROOM_UPDATE).
if (roomId) {
  try { $("#room").textContent = roomId; } catch (_) {}
}

// --- net ---
const client = new LobbyWSClient(wsUrl);

let recvCount = 0;

let state = {
  roomId,
  youId: sessionStorage.getItem("mp_youId") || "",
  mode: "-",
  players: new Map(), // id -> {pos:{x,z}, yaw, money}
};

if (!roomId) {
  log("[HINT] room 파라미터/세션이 없습니다. 로비에서 방을 시작한 뒤 multigame으로 들어오세요.");
}

// IMPORTANT: register handlers BEFORE connecting.
// The server sends INIT immediately on connect; if we connect first, we can miss INIT.

client.on("open", () => setStatus("서버 연결됨", true));
client.on("close", () => setStatus("연결 끊김", false));
client.on("ERROR", (m) => log(`[ERROR] ${m.code}: ${m.message}`));

// Debug: show all incoming message types so we can see whether INIT/ROOM_UPDATE is arriving.
client.on("message", (m) => {
  if (!m || !m.type) return;
  recvCount++;
  // Avoid spamming on deltas: log them compactly
  if (m.type === "GAME_DELTA") return;
  log(`[RECV] ${m.type}`);
});

client.on("DEBUG_ECHO", (m) => {
  log(`[ECHO] ${JSON.stringify(m.data ?? null)}`);
});

// IMPORTANT: In some cases INIT handler could be missed due to page caching/instant server send.
// We still try to re-join the room as soon as the socket opens.
client.on("open", () => {
  // sanity ping (server should reply even if you're not in a room)
  client.send({ type: C2S.DEBUG_ECHO, data: { from: "multigame", t: Date.now() } });

  if (roomId) {
    const ok = client.joinRoom(roomId);
    if (ok) log(`[SYSTEM] ROOM_JOIN 요청: ${roomId}`);
  }

  // Force a lobby refresh so we can verify server->client traffic even if INIT is missed.
  client.lobbyList();

  // If nothing arrives shortly, we are connected to a wrong endpoint/proxy.
  setTimeout(() => {
    if (recvCount === 0) {
      log("[WARN] 서버에서 어떤 메시지도 받지 못했습니다. wsUrl/프록시 라우팅이 다른 서비스로 연결된 것일 수 있어요.");
    }
  }, 800);
});

client.on("INIT", (m) => {
  // If this page was opened directly, try to re-join the room.
  state.youId = client.you?.id || state.youId;
  $("#you").textContent = `${client.you?.nick || "?"} (${client.you?.id || "?"})`;
  if (roomId) $("#room").textContent = roomId;

  // If we are not in the room anymore, attempt join (works when user opened a new tab)
  if (roomId && (!client.room || client.room.id !== roomId)) {
    client.joinRoom(roomId);
  }
});

client.on("ROOM_UPDATE", (m) => {
  const room = m.room;
  if (!room) return;
  if (roomId && room.id !== roomId) return;

  state.roomId = room.id;
  $("#room").textContent = room.id;
  $("#pcount").textContent = `${room.players?.length || 0}/${room.maxPlayers || "?"}`;
  $("#mode").textContent = room.settings?.mode || "-";

  // If room already in game and we somehow missed GAME_START, request snapshot.
  if (room.state === "IN_GAME") {
    client.send({ type: C2S.GAME_REQUEST_SNAPSHOT });
  }
});

client.on("GAME_START", (m) => {
  $("#mode").textContent = m.settings?.mode || "-";
  log(`[SYSTEM] GAME_START room=${m.roomId} tick=${m.settings?.tickRate ?? "?"}`);
  // Request fresh snapshot to seed render state
  client.send({ type: C2S.GAME_REQUEST_SNAPSHOT });
});

client.on("GAME_SNAPSHOT", (m) => {
  const st = m.state;
  if (!st) return;
  state.players.clear();
  for (const p of (st.players || [])) {
    state.players.set(p.id, {
      id: p.id,
      nick: p.nick,
      team: p.team,
      pos: { x: p.pos?.x ?? p.pos?.[0] ?? 0, z: p.pos?.z ?? p.pos?.[2] ?? 0 },
      yaw: p.yaw ?? 0,
      money: p.money ?? 0,
    });
  }
  updateMoneyUI();
});

client.on("GAME_DELTA", (m) => {
  for (const p of (m.players || [])) {
    const cur = state.players.get(p.id) || { id: p.id, pos: { x: 0, z: 0 }, yaw: 0, money: 0 };
    if (p.pos) {
      cur.pos = { x: p.pos.x ?? p.pos[0] ?? cur.pos.x, z: p.pos.z ?? p.pos[2] ?? cur.pos.z };
    }
    if (typeof p.yaw !== "undefined") cur.yaw = p.yaw;
    if (typeof p.money !== "undefined") cur.money = p.money;
    state.players.set(p.id, cur);
  }
  updateMoneyUI();
});

// Now that all handlers are registered, connect.
client.connect({ reconnect: true });

function updateMoneyUI() {
  const me = state.players.get(client.you?.id || state.youId);
  if (me) $("#money").textContent = Math.floor(me.money).toString();
}

// --- UI buttons ---
// Going back to lobby is an intentional action.
// If the server sends GAME_START on reconnect (because you are already IN_GAME),
// the lobby page would instantly redirect back to multigame.
// We set a one-shot flag so the lobby UI can stay put.
$("#btnBack").onclick = () => {
  try { sessionStorage.setItem("mp_suppressAutoGame", "1"); } catch (_) {}
  location.href = "multiplay.html";
};
$("#btnSnap").onclick = () => {
  const ok = client.send({ type: C2S.GAME_REQUEST_SNAPSHOT });
  if (!ok) {
    log("[WARN] 스냅샷 요청 실패: WS가 아직 열리지 않았거나, 잘못된 상태일 수 있어요.");
    return;
  }
  log("[SYSTEM] 스냅샷 요청 전송됨");
  // If the server doesn't respond, it's likely because you're not in a room/game yet.
  setTimeout(() => {
    if (state.players.size === 0) {
      log("[HINT] 스냅샷이 오지 않았다면: (1) 방에 안 들어가있음 (2) 게임이 시작되지 않음 (3) roomId가 잘못됨");
    }
  }, 600);
};

// --- input (scaffold) ---
let input = { mx: 0, mz: 0, yaw: 0 };
const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

let dragging = false;
let lastX = 0;
canvas.addEventListener("mousedown", (e) => { dragging = true; lastX = e.clientX; });
window.addEventListener("mouseup", () => (dragging = false));
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  input.yaw += dx * 0.01;
});

function computeMove() {
  const up = keys.has("w") || keys.has("arrowup");
  const dn = keys.has("s") || keys.has("arrowdown");
  const lf = keys.has("a") || keys.has("arrowleft");
  const rt = keys.has("d") || keys.has("arrowright");
  input.mx = (rt ? 1 : 0) - (lf ? 1 : 0);
  input.mz = (dn ? 1 : 0) - (up ? 1 : 0);
}

// Send input ~20Hz
setInterval(() => {
  computeMove();
  client.send({ type: C2S.GAME_INPUT, input });
}, 50);

// --- render (top-down) ---
function worldToScreen(wx, wz) {
  // simple camera centered on local player
  const me = state.players.get(client.you?.id || state.youId);
  const cx = me?.pos?.x ?? 0;
  const cz = me?.pos?.z ?? 0;
  const scale = 6; // px per world unit
  const sx = (window.innerWidth / 2) + (wx - cx) * scale;
  const sy = (window.innerHeight / 2) + (wz - cz) * scale;
  return [sx, sy];
}

function draw() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // grid
  const step = 40;
  ctx.globalAlpha = 0.25;
  for (let x = 0; x < window.innerWidth; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, window.innerHeight); ctx.stroke();
  }
  for (let y = 0; y < window.innerHeight; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(window.innerWidth, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // players
  for (const p of state.players.values()) {
    const [sx, sy] = worldToScreen(p.pos.x, p.pos.z);
    const r = (p.id === (client.you?.id || state.youId)) ? 10 : 7;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    // name
    ctx.fillText(p.nick || p.id.slice(0, 4), sx + r + 4, sy - r);
  }

  requestAnimationFrame(draw);
}

// set some readable defaults for canvas drawing
ctx.strokeStyle = "rgba(255,255,255,.08)";
ctx.fillStyle = "rgba(110,243,197,.9)";
ctx.font = "12px system-ui, -apple-system, 'Noto Sans KR', Segoe UI, Roboto, Arial";
draw();
