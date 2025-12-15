// src/ui/ShopModal.js
// Patch 6-2b: Shop modal UI (B key / 🛒 button)

function el(tag, cls, text){
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(text != null) n.textContent = text;
  return n;
}

function fmtMoney(n){
  try{ return `$${Math.max(0, Math.floor(n||0)).toLocaleString()}`; }catch{ return `$${n||0}`; }
}

export default class ShopModal {
  constructor(opts){
    this.root = opts.root || document.body;
    this.input = opts.input;
    this.settings = opts.settingsStore;
    this.mobileHUD = opts.mobileHUD;
    this.getProfile = opts.getProfile || (()=>window.playerProfile);
    this.shopSystem = opts.shopSystem;

    this._open = false;
    this._tab = "primary";
    this._toastT = 0;

    this._ensureDom();
    this.close(true);
  }

  isOpen(){ return !!this._open; }

  toggle(){
    if(this._open) this.close();
    else this.open();
  }

  open(){
    this._open = true;
    this.overlay.style.display = "flex";
    try{ this.input?.setUILocked?.(true); }catch{}
    try{ window.__strikegyUILock = { ...(window.__strikegyUILock||{}), shop:true }; }catch{}
    try{ this.mobileHUD?.hide?.(); }catch{}
    this.render();
  }

  close(force){
    this._open = false;
    if(this.overlay) this.overlay.style.display = "none";
    try{ this.input?.setUILocked?.(false); }catch{}
    try{ window.__strikegyUILock = { ...(window.__strikegyUILock||{}), shop:false }; }catch{}
    try{
      const preset = this.settings?.controlPreset || this.settings?.get?.("controlPreset");
      if(preset && preset !== "pc") this.mobileHUD?.show?.();
    }catch{}
    if(!force) this._toast("");
  }

  _ensureDom(){
    if(this.overlay) return;

    this.overlay = el("div","shopOverlay");
    this.modal = el("div","shopModal");
    this.overlay.appendChild(this.modal);

    const header = el("div","shopHeader");
    const title = el("div","shopTitle","🛒 상점");
    this.moneyEl = el("div","shopMoney","$0");
    const closeBtn = el("button","shopClose","✕");
    closeBtn.addEventListener("click", ()=>this.close());

    header.appendChild(title);
    header.appendChild(this.moneyEl);
    header.appendChild(closeBtn);

    this.tabs = el("div","shopTabs");
    const mkTab = (id, label)=>{
      const b = el("button","shopTab",label);
      b.dataset.tab = id;
      b.addEventListener("click", ()=>{
        this._tab = id;
        this.render();
      });
      return b;
    };
    this.tabs.appendChild(mkTab("primary","주무기"));
    this.tabs.appendChild(mkTab("secondary","보조"));
    this.tabs.appendChild(mkTab("grenade","투척"));
    this.tabs.appendChild(mkTab("utility","기타"));

    this.list = el("div","shopList");

    this.toast = el("div","shopToast","");

    this.modal.appendChild(header);
    this.modal.appendChild(this.tabs);
    this.modal.appendChild(this.list);
    this.modal.appendChild(this.toast);

    this.root.appendChild(this.overlay);

    // Escape to close
    window.addEventListener("keydown", (e)=>{
      if(!this._open) return;
      if(e.code === "Escape"){ this.close(); e.preventDefault(); }
    }, { passive:false });
  }

  _toast(msg){
    this.toast.textContent = msg || "";
    this.toast.style.opacity = msg ? "1" : "0";
  }

  render(){
    const profile = this.getProfile();
    const money = profile?.money ?? 0;
    this.moneyEl.textContent = fmtMoney(money);

    // tab active
    for(const b of this.tabs.querySelectorAll(".shopTab")){
      b.classList.toggle("active", b.dataset.tab === this._tab);
    }

    this.list.innerHTML = "";
    const catalog = this.shopSystem?.getCatalog?.();
    if(!catalog){
      this.list.appendChild(el("div","shopHint","카탈로그 로드 실패"));
      return;
    }

    const classId = profile?.classId || profile?.class || "assault";
    const inv = profile?.inventory;

    const addItem = (item, icon)=>{
      const card = el("div","shopItem");
      const left = el("div","shopItemLeft");
      const ic = el("div","shopIcon", icon || "•");
      const nm = el("div","shopName", item.name);
      const sub = el("div","shopSub", fmtMoney(item.price));
      left.appendChild(ic);
      const mid = el("div","shopMid");
      mid.appendChild(nm);
      mid.appendChild(sub);
      left.appendChild(mid);

      const buy = el("button","shopBuy","구매");
      let disabled = false;
      if(item.type === "primary"){
        disabled = !!inv?.primary || !this.shopSystem.canBuyPrimaryForClass(classId, item.category);
      }else if(item.type === "secondary"){
        disabled = (inv?.secondary && inv.secondary !== "basic_pistol");
      }else if(item.type === "grenade"){
        const g = inv?.grenades || [];
        disabled = g.filter(Boolean).length >= 3;
      }else if(item.type === "utility"){
        if(item.id==="ammo_primary") disabled = !inv?.primary;
        if(item.id==="ammo_secondary") disabled = !inv?.secondary;
      }
      if(disabled){
        buy.disabled = true;
        buy.classList.add("disabled");
      }

      buy.addEventListener("click", ()=>{
        const res = this.shopSystem.buy(item);
        if(res.ok){
          this._toast("✅ 구매 완료");
        }else{
          const reason = res.reason || "FAIL";
          const map = {
            NO_MONEY:"돈이 부족해",
            PRIMARY_FILLED:"주무기 슬롯이 이미 차있어",
            SECONDARY_FILLED:"보조무기 슬롯이 이미 차있어",
            NO_GRENADE_SLOT:"투척 슬롯이 가득 찼어",
            CLASS_RESTRICTED:"병과 제한 때문에 구매 불가",
            NO_PRIMARY:"주무기가 없어서 탄약 보충 불가",
            NO_SECONDARY:"보조무기가 없어서 탄약 보충 불가",
          };
          this._toast("❌ " + (map[reason] || "구매 실패"));
        }
        this.render();
      });

      card.appendChild(left);
      card.appendChild(buy);
      this.list.appendChild(card);
    };

    const sectionTitle = (t)=>this.list.appendChild(el("div","shopSection",t));

    if(this._tab === "primary"){
      sectionTitle("주무기");
      for(const item of (catalog.primaries||[])){
        addItem(item, item.icon || "🔫");
      }
      const hint = el("div","shopHint","※ 병과별 구매 제한 적용됨");
      this.list.appendChild(hint);
    }else if(this._tab === "secondary"){
      sectionTitle("보조무기");
      for(const item of (catalog.secondaries||[])){
        addItem(item, item.icon || "🔫");
      }
      const hint = el("div","shopHint","※ 시작 권총은 무료(기본). 업그레이드는 사망 시 소실.");
      this.list.appendChild(hint);
    }else if(this._tab === "grenade"){
      sectionTitle("투척무기 (3슬롯)");
      for(const item of (catalog.grenades||[])){
        addItem(item, item.icon || "💣");
      }
      const hint = el("div","shopHint","※ 투척은 사망 시 전부 소실");
      this.list.appendChild(hint);
    }else if(this._tab === "utility"){
      sectionTitle("기타");
      for(const item of (catalog.utility||[])){
        addItem(item, item.icon || "🧰");
      }
      const hint = el("div","shopHint","※ 탄약 보충은 돈으로 사는 '편의' (보급병 가치 유지)");
      this.list.appendChild(hint);
    }
  }
}
