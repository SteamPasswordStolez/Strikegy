// src/ui/HUD.js
// Patch 5B: HUD is always present (PC + Mobile). Minimal, safe overlay.
export default class HUD {
  constructor({ root = document.body } = {}) {
    this.root = root;

    this.el = document.createElement("div");
    this.el.id = "hud-root";
    this.el.style.cssText = `
      position: fixed; inset: 0; pointer-events: none;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color: white; z-index: 9999;
    `;

    this.topLeft = document.createElement("div");
    this.topLeft.style.cssText = `
      position:absolute; left:12px; top:10px;
      background: rgba(0,0,0,0.35);
      padding:6px 10px; border-radius:12px;
      font-size: 13px; backdrop-filter: blur(4px);
    `;
    this.topLeft.textContent = "HUD OK";

    this.el.appendChild(this.topLeft);
    root.appendChild(this.el);
  }

  setText(text) {
    this.topLeft.textContent = text;
  }

  destroy() {
    this.el?.remove();
  }
}
