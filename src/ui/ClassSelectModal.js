// Patch 6-1a: Lobby class selection modal (required before start)
import { CLASSES, ITEM_ICONS } from "../data/classes.js";

export default class ClassSelectModal{
  constructor({ title = "병과 선택", onConfirm } = {}){
    this.title = title;
    this.onConfirm = typeof onConfirm === "function" ? onConfirm : null;
    this._selected = null;

    this._ensureDom();
    this.close();
  }

  _ensureDom(){
    if(this.root) return;

    const style = document.createElement("style");
    style.textContent = `
      .cs-overlay{ position:fixed; inset:0; background:rgba(0,0,0,.55); display:flex;
        align-items:center; justify-content:center; z-index:9999; padding:16px; }
      .cs-modal{ width:min(720px, 96vw); background:rgba(17,26,43,.98); border:1px solid rgba(255,255,255,.12);
        border-radius:16px; box-shadow:0 24px 80px rgba(0,0,0,.55); color:#eaf0ff; overflow:hidden; }
      .cs-head{ display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid rgba(255,255,255,.10);}
      .cs-title{ font-weight:800; letter-spacing:.2px; }
      .cs-sub{ color:rgba(234,240,255,.7); font-size:12px; }
      .cs-body{ padding:14px 16px; }
      .cs-grid{ display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:10px; }
      @media (max-width:560px){ .cs-grid{ grid-template-columns:1fr; } }
      .cs-card{ border:1px solid rgba(255,255,255,.12); border-radius:14px; padding:12px;
        background:rgba(26,42,68,.5); cursor:pointer; user-select:none; transition:transform .08s ease, border-color .08s ease; }
      .cs-card:hover{ transform:translateY(-1px); border-color:rgba(255,255,255,.22); }
      .cs-card.is-selected{ border-color:rgba(31,79,255,.95); box-shadow:0 0 0 2px rgba(31,79,255,.35) inset; }
      .cs-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .cs-name{ font-weight:800; }
      .cs-icon{ font-size:22px; }
      .cs-items{ margin-top:8px; display:flex; gap:8px; flex-wrap:wrap; color:rgba(234,240,255,.85); font-size:13px; }
      .cs-pill{ padding:6px 8px; border:1px solid rgba(255,255,255,.12); border-radius:999px; background:rgba(0,0,0,.12); }
      .cs-foot{ display:flex; gap:10px; justify-content:flex-end; padding:14px 16px; border-top:1px solid rgba(255,255,255,.10);}
      .cs-btn{ padding:10px 14px; border-radius:12px; border:1px solid rgba(255,255,255,.12);
        background:rgba(26,42,68,.8); color:#eaf0ff; font-weight:800; cursor:pointer; }
      .cs-btn.primary{ background:#1f4fff; border-color:rgba(31,79,255,.9); }
      .cs-btn:disabled{ opacity:.45; cursor:not-allowed; }
      .cs-note{ margin-top:10px; font-size:12px; color:rgba(234,240,255,.7); }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.className = "cs-overlay";
    overlay.style.display = "none";
    overlay.setAttribute("role","dialog");
    overlay.setAttribute("aria-modal","true");

    const modal = document.createElement("div");
    modal.className = "cs-modal";

    modal.innerHTML = `
      <div class="cs-head">
        <div>
          <div class="cs-title"></div>
          <div class="cs-sub">게임 시작 전에 병과를 선택해야 합니다.</div>
        </div>
      </div>
      <div class="cs-body">
        <div class="cs-grid"></div>
        <div class="cs-note">6-1a: 병과/인벤 구조 확정 단계(기능은 6-2/6-3/7에서).</div>
      </div>
      <div class="cs-foot">
        <button class="cs-btn primary" id="csConfirm" disabled>확정</button>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    this.root = overlay;
    this.titleEl = modal.querySelector(".cs-title");
    this.gridEl = modal.querySelector(".cs-grid");
    this.confirmBtn = modal.querySelector("#csConfirm");

    this.titleEl.textContent = this.title;

    // Prevent closing by clicking overlay (required selection)
    overlay.addEventListener("click", (e)=>{
      if(e.target === overlay){
        // no-op (required)
      }
    });

    this.confirmBtn.addEventListener("click", ()=>{
      if(!this._selected) return;
      this.close();
      this.onConfirm?.(this._selected);
    });

    // ESC disabled (required)
    this._onKeyDown = (e)=>{
      if(e.key === "Escape"){
        e.preventDefault();
        e.stopPropagation();
      }
    };

    this._renderCards();
  }

  _renderCards(){
    const entries = Object.values(CLASSES);
    this.gridEl.innerHTML = "";
    for(const cls of entries){
      const card = document.createElement("div");
      card.className = "cs-card";
      card.dataset.classId = cls.id;

      const items = cls.classItems.filter(Boolean).map(id=>{
        const icon = ITEM_ICONS[id] ?? "•";
        return `<span class="cs-pill">${icon} ${id}</span>`;
      }).join("");

      card.innerHTML = `
        <div class="cs-row">
          <div class="cs-name">${cls.name}</div>
          <div class="cs-icon">${cls.icon}</div>
        </div>
        <div class="cs-items">${items}</div>
      `;

      card.addEventListener("click", ()=>{
        this.select(cls.id);
      });

      this.gridEl.appendChild(card);
    }
  }

  select(classId){
    this._selected = classId;
    for(const el of this.gridEl.querySelectorAll(".cs-card")){
      el.classList.toggle("is-selected", el.dataset.classId === classId);
    }
    this.confirmBtn.disabled = !this._selected;
  }

  open(){
    this._selected = null;
    this.confirmBtn.disabled = true;
    for(const el of this.gridEl.querySelectorAll(".cs-card")){
      el.classList.remove("is-selected");
    }
    this.root.style.display = "flex";
    window.addEventListener("keydown", this._onKeyDown, true);
  }

  close(){
    if(!this.root) return;
    this.root.style.display = "none";
    window.removeEventListener("keydown", this._onKeyDown, true);
  }
}
