// Patch 11-A: Minimal bootstrap inside game.html when launched from multiplay.html.
// This does NOT sync gameplay yet — it only keeps room id / player id ready for Patch 11-B.
export function initMPBootstrap() {
  const params = new URLSearchParams(location.search);
  if (params.get("mp") !== "1") return;

  const roomId = params.get("room") || sessionStorage.getItem("mp_roomId") || "";
  const youId = sessionStorage.getItem("mp_youId") || "";
  const nick = sessionStorage.getItem("mp_nick") || "";
  const settingsRaw = sessionStorage.getItem("mp_settings") || "{}";
  let settings = {};
  try { settings = JSON.parse(settingsRaw); } catch (_) {}

  // Apply mode to existing singleplayer setting so game loads the correct mode UI
  if (settings && settings.mode) {
    try { localStorage.setItem("selectedMode", String(settings.mode)); } catch (_) {}
  }

  const banner = document.createElement("div");
  banner.style.cssText = [
    "position:fixed","left:12px","top:12px","z-index:999999",
    "padding:10px 12px","border-radius:12px",
    "background:rgba(15,18,28,.72)","backdrop-filter: blur(10px)",
    "border:1px solid rgba(255,255,255,.12)",
    "font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    "color:#eaf0ff","font-size:13px","line-height:1.35"
  ].join(";");
  banner.innerHTML = `
    <b>멀티플레이 (Patch 11-A)</b><br/>
    room: <b>${roomId || "-"}</b><br/>
    you: <b>${nick || "-"} ${youId ? "(" + youId.slice(0,6) + ")" : ""}</b><br/>
    mode: <b>${(settings && settings.mode) ? settings.mode : "-"}</b><br/>
    <span style="opacity:.75">※ 실제 동기화/판정은 Patch 11-B부터</span>
  `;
  document.body.appendChild(banner);
}
