// src/game/WeaponSwitchManager.js
// Patch 6-3: unified weapon/slot switching (primary/secondary/grenades/melee/class items)

function canonId(id){
  if(!id) return null;
  return String(id).trim().toLowerCase();
}

export class WeaponSwitchManager {
  constructor(opts){
    this.profile = opts?.profile;
    this.weaponSystem = opts?.weaponSystem;
    this.onMelee = opts?.onMelee || null;

    this._meleeActive = false;
    this._meleeTimer = 0;
    this._meleeDuration = 0.32;
    this._prevSlot = null;
  }

  ensureActiveSlot(){
    const p = this.profile;
    if(!p) return;
    if(!p.activeSlot){
      // default: secondary if exists, else primary
      if(p.inventory?.secondary){
        p.activeSlot = { type:"secondary", index:0 };
      } else {
        p.activeSlot = { type:"primary", index:0 };
      }
    }
  }

  get active(){ return this.profile?.activeSlot || null; }
  get meleeActive(){ return this._meleeActive; }

  update(dt){
    if(!this.profile) return;
    if(this._meleeActive){
      this._meleeTimer -= dt;
      if(this._meleeTimer <= 0){
        this._meleeActive = false;
        if(this._prevSlot){
          this.profile.activeSlot = this._prevSlot;
          this._prevSlot = null;
          this._syncWeaponSystem();
        }
      }
    }
  }

  _syncWeaponSystem(){
    const p = this.profile;
    const inv = p?.inventory;
    if(!p || !inv || !this.weaponSystem) return;

    const a = p.activeSlot;
    if(!a) return;

    if(a.type === "primary"){
      const id = canonId(inv.primary);
      if(id) this.weaponSystem.switchWeapon?.(id);
      return;
    }
    if(a.type === "secondary"){
      const id = canonId(inv.secondary);
      if(id) this.weaponSystem.switchWeapon?.(id);
      return;
    }
    // grenade/class/melee: no WeaponSystem switch (keep last gun state)
  }

  _setSlot(type, index=0){
    const p = this.profile;
    if(!p) return false;
    p.activeSlot = { type, index };
    this._syncWeaponSystem();
    return true;
  }

  switchToPrimary(){
    this.ensureActiveSlot();
    const inv = this.profile?.inventory;
    if(!inv?.primary) return false;
    return this._setSlot("primary", 0);
  }

  switchToSecondary(){
    this.ensureActiveSlot();
    const inv = this.profile?.inventory;
    if(!inv?.secondary) return false;
    return this._setSlot("secondary", 0);
  }

  togglePrimarySecondary(){
    this.ensureActiveSlot();
    const inv = this.profile?.inventory;
    if(!inv) return false;
    const a = this.profile.activeSlot;
    if(a?.type === "primary"){
      if(inv.secondary) return this.switchToSecondary();
      return false;
    }
    // else prefer primary if owned
    if(inv.primary) return this.switchToPrimary();
    if(inv.secondary) return this.switchToSecondary();
    return false;
  }

  // Patch 7-3B: cycle through owned slots in a stable order.
  // Order: primary -> secondary -> grenades(0..2) -> classItem(0..1). Melee is excluded.
  cycleNext(){
    this.ensureActiveSlot();
    const p = this.profile;
    const inv = p?.inventory;
    if(!p || !inv) return false;

    const slots = [];
    if(inv.primary) slots.push({ type:"primary", index:0 });
    if(inv.secondary) slots.push({ type:"secondary", index:0 });
    if(Array.isArray(inv.grenades)){
      for(let i=0;i<3;i++) if(inv.grenades[i]) slots.push({ type:"grenade", index:i });
    }
    if(Array.isArray(inv.classItems)){
      for(let i=0;i<2;i++) if(inv.classItems[i]) slots.push({ type:"classItem", index:i });
    }

    if(slots.length<=0) return false;

    const a = p.activeSlot;
    let idx = -1;
    if(a && (a.type === "primary" || a.type === "secondary" || a.type === "grenade" || a.type === "classItem")){
      idx = slots.findIndex(s=> s.type===a.type && (s.index|0)===(a.index|0));
    }
    if(idx < 0) idx = 0;

    const next = slots[(idx + 1) % slots.length];
    return this._setSlot(next.type, next.index);
  }

  switchToGrenade(idx){
    this.ensureActiveSlot();
    const inv = this.profile?.inventory;
    if(!inv?.grenades || idx<0 || idx>2) return false;
    if(!inv.grenades[idx]) return false;
    return this._setSlot("grenade", idx);
  }

  switchToClassItem(idx){
    this.ensureActiveSlot();
    const inv = this.profile?.inventory;
    if(!inv?.classItems || idx<0 || idx>1) return false;
    if(!inv.classItems[idx]) return false;
    return this._setSlot("classItem", idx);
  }

  triggerMeleeAttack(){
    this.ensureActiveSlot();
    if(this._meleeActive) return false;

    // Save previous slot and switch to melee temporarily
    this._prevSlot = { ...(this.profile.activeSlot || {type:"secondary", index:0}) };
    this.profile.activeSlot = { type:"melee", index:0 };
    this._meleeActive = true;
    this._meleeTimer = this._meleeDuration;

    try{ this.onMelee?.(); }catch{}

    // NOTE: actual melee hit logic will be implemented later (Patch 7+)
    return true;
  }

  getActiveLabel(){
    const p = this.profile;
    const inv = p?.inventory;
    const a = p?.activeSlot;
    if(!a) return "";
    if(a.type === "primary") return "주무기";
    if(a.type === "secondary") return "보조";
    if(a.type === "grenade") return `투척${(a.index|0)+1}`;
    if(a.type === "classItem") return `고유${(a.index|0)+1}`;
    if(a.type === "melee") return "근접";
    return "";
  }
}
