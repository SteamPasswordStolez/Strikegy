// src/game/AmmoRefillService.js
// Patch 7-4B: shared ammo refill engine (used by ammo_pack + shop ammo refills)

import { WEAPONS } from "../weapons/WeaponData.js";

export class AmmoRefillService {
  constructor({ profile, weaponSystem, onStatus } = {}){
    this.profile = profile;
    this.weaponSystem = weaponSystem;
    this.onStatus = onStatus || null; // (text, blink=false)

    this._pending = null; // { t, doPrimary, doSecondary, text }
  }

  _refillWeaponId(id){
    if(!id || !this.weaponSystem) return;
    // Inventory ids can be uppercase (e.g., "AR1") while WEAPONS keys are lowercase ("ar1").
    // Canonicalize here so both ammo_pack and shop refills work for every owned gun.
    const wid = String(id).trim().toLowerCase();
    const w = WEAPONS[wid];
    if(!w) return;
    const st = this.weaponSystem.weaponStates?.[wid];
    if(!st) return;
    st.mag = w.magSize;
    st.reserve = w.reserve;
  }

  _apply(doPrimary, doSecondary){
    const inv = this.profile?.inventory;
    if(!inv) return;
    if(doPrimary) this._refillWeaponId(inv.primary);
    if(doSecondary) this._refillWeaponId(inv.secondary);
  }

  // delaySec=0 => immediate
  refill({ primary=false, secondary=false, delaySec=0, statusText="" } = {}){
    const d = Math.max(0, +delaySec || 0);
    if(d <= 0){
      this._apply(primary, secondary);
      return true;
    }
    // Ignore if a refill is already in progress.
    if(this._pending) return false;
    this._pending = {
      t: d,
      doPrimary: !!primary,
      doSecondary: !!secondary,
      text: statusText || "보급중..",
    };
    this.onStatus?.(this._pending.text, true);
    return true;
  }

  update(dt){
    if(!this._pending) return;
    this._pending.t -= dt;
    if(this._pending.t > 0) return;
    const p = this._pending;
    this._pending = null;
    this._apply(p.doPrimary, p.doSecondary);
    this.onStatus?.("", false);
  }

  get busy(){ return !!this._pending; }
}
