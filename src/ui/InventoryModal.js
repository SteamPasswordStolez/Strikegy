// src/ui/InventoryModal.js
// Patch 6-1b (Progress): Inventory modal (display only)
// - Open via I key / 🎒 button
// - Modal + overlay
// - Input lock while open
// - Slot structure: Primary1 / Secondary1 / Throwables3 / Melee1 / ClassItems(1~2, locked shown)

import { CLASSES, ITEM_ICONS, normalizeClassId } from "../data/classes.js";

function el(tag, cls, text){
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(text != null) n.textContent = text;
  return n;
}

export default class InventoryModal{
  /**
   * @param {{root:HTMLElement, input:any, settingsStore:any, mobileHUD?:any, getProfile?:()=>any}} opts
   */
  constructor(opts){
    this.root = opts.root || document.body;
    this.input = opts.input;
    this.settings = opts.settingsStore;
    this.mobileHUD = opts.mobileHUD || null;
    this.getProfile = typeof opts.getProfile === "function" ? opts.getProfile : ()=>window.playerProfile;

    this._open = false;
    this._selected = null;

    this._ensureDom();
    this.close(true);
  }

  _ensureDom(){
    if(this.overlay) return;

    this.overlay = el("div", "invOverlay");
    this.modal = el("div", "invModal");
    this.overlay.appendChild(this.modal);

    // click outside closes
    this.overlay.addEventListener("click", (e)=>{
      if(e.target === this.overlay) this.close();
    });

    // stop bubbling inside modal
    this.modal.addEventListener("click", (e)=> e.stopPropagation());

    // header
    this.header = el("div", "invHeader");
    this.title = el("div", "invTitle", "인벤토리");
    this.sub = el("div", "invSub", "");
    this.btnClose = el("button", "invCloseBtn", "✖");
    this.btnClose.type = "button";
    this.btnClose.addEventListener("click", ()=>this.close());
    this.header.appendChild(this.title);
    this.header.appendChild(this.sub);
    this.header.appendChild(this.btnClose);

    // grid
    this.grid = el("div", "invGrid");

    this.modal.appendChild(this.header);
    this.modal.appendChild(this.grid);

    this.root.appendChild(this.overlay);
  }

  isOpen(){ return !!this._open; }

  toggle(profile){
    if(this.isOpen()) this.close();
    else this.open(profile);
  }

  open(profile){
    if(this._open) return;
    const p = profile || this.getProfile?.() || {};
    this._render(p);

    this._open = true;
    this.overlay.style.display = "flex";

    // lock input
    try{ this.input?.setUILocked?.(true); }catch{}
    try{ window.__strikegyUILock = { ...(window.__strikegyUILock||{}), inventory:true }; }catch{}

    // hide mobile hud while modal open (prevents accidental presses)
    try{ this.mobileHUD?.hide?.(); }catch{}

    // pointer lock: best-effort exit so mouse can click UI
    try{
      if(document.pointerLockElement){
        document.exitPointerLock?.();
      }
    }catch{}
  }

  close(silent=false){
    if(!silent && !this._open) return;
    this._open = false;
    if(this.overlay) this.overlay.style.display = "none";

    // unlock input
    try{ this.input?.setUILocked?.(false); }catch{}
    try{ window.__strikegyUILock = { ...(window.__strikegyUILock||{}), inventory:false }; }catch{}

    // restore hud depending on preset
    try{
      const preset = this.settings?.controlPreset || this.settings?.get?.("controlPreset");
      if(this.mobileHUD && (preset === "mobile" || preset === "mobile_kb")) this.mobileHUD.show?.();
    }catch{}
  }

  _slot(label, value, key, locked=false){
    const slot = el("button", "invSlot");
    slot.type = "button";
    slot.setAttribute("data-key", key);

    if(locked){
      slot.classList.add("is-locked");
      slot.appendChild(el("div", "invSlotIcon", "🔒"));
      slot.appendChild(el("div", "invSlotLabel", label));
    }else{
      const icon = value ? (ITEM_ICONS[value] || "📦") : "—";
      const name = value ? String(value) : "비어있음";
      slot.appendChild(el("div", "invSlotIcon", icon));
      slot.appendChild(el("div", "invSlotLabel", label));
      slot.appendChild(el("div", "invSlotName", name));
    }

    slot.addEventListener("click", ()=>{
      // display-only: toggle highlight
      const k = slot.getAttribute("data-key");
      if(this._selected === k) this._selected = null;
      else this._selected = k;
      this._applySelection();
    });

    return slot;
  }

  _applySelection(){
    const slots = this.grid.querySelectorAll(".invSlot");
    slots.forEach(s=>{
      const k = s.getAttribute("data-key");
      if(k && this._selected === k) s.classList.add("is-selected");
      else s.classList.remove("is-selected");
    });
  }

  _render(profile){
    const classId = normalizeClassId(profile?.classId || profile?.classType || profile?.class || "assault");
    const cls = CLASSES[classId] || CLASSES.assault;

    this.sub.textContent = `${cls.icon} ${cls.name}`;

    const inv = profile?.inventory || profile?.inv || {};
    const grenades = Array.isArray(inv.grenades) ? inv.grenades : [null,null,null];
    const classItems = Array.isArray(inv.classItems) ? inv.classItems : [cls.classItems?.[0] ?? null, cls.classItems?.[1] ?? null];

    // rebuild grid
    this.grid.innerHTML = "";
    this.grid.appendChild(this._slot("주무기", inv.primary, "primary"));
    this.grid.appendChild(this._slot("보조무기", inv.secondary, "secondary"));

    this.grid.appendChild(this._slot("투척 1", grenades[0], "grenades0"));
    this.grid.appendChild(this._slot("투척 2", grenades[1], "grenades1"));
    this.grid.appendChild(this._slot("투척 3", grenades[2], "grenades2"));

    this.grid.appendChild(this._slot("근접", inv.melee, "melee"));

    // class items always two slots, second can be locked
    const ci0 = classItems[0] ?? null;
    const ci1 = classItems[1] ?? null;
    this.grid.appendChild(this._slot("고유 1", ci0, "class0", !ci0));
    this.grid.appendChild(this._slot("고유 2", ci1, "class1", !ci1));

    this._applySelection();
  }
}
