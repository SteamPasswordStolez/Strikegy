// src/game/ShopSystem.js
// Patch 6-2b: Shop purchase rules (no weapon stats tuning here)

import { SHOP, PRIMARY_CATEGORIES, CLASS_PRIMARY_ALLOW } from "../data/shopCatalog.js";
import { normalizeClassId } from "../data/classes.js";

export class ShopSystem {
  constructor(opts){
    this.getProfile = opts?.getProfile || (()=>window.playerProfile);
    this.getEconomy = opts?.getEconomy || (()=>window.economyManager || null);
  }

  getCatalog(){
    return SHOP;
  }

  canBuyPrimaryForClass(classId, category){
    const cid = normalizeClassId(classId);
    const allow = CLASS_PRIMARY_ALLOW[cid] || [];
    return allow.includes(category);
  }

  buy(item){
    const profile = this.getProfile();
    const eco = this.getEconomy();
    if(!profile) return { ok:false, reason:"NO_PROFILE" };
    if(!eco) return { ok:false, reason:"NO_ECONOMY" };

    const inv = profile.inventory || (profile.inventory = { primary:null, secondary:"pistol1", grenades:[null,null,null], melee:null, classItems:[] });

    // money check
    if(!eco.spendMoney(item.price)){
      return { ok:false, reason:"NO_MONEY" };
    }

    // apply
    if(item.type === "primary"){
      if(inv.primary) { eco.addMoney(item.price); return { ok:false, reason:"PRIMARY_FILLED" }; }
      const classId = profile.classId || profile.class || "assault";
      if(!this.canBuyPrimaryForClass(classId, item.category)){
        eco.addMoney(item.price);
        return { ok:false, reason:"CLASS_RESTRICTED" };
      }
      inv.primary = item.id;
      return { ok:true };
    }

    if(item.type === "secondary"){
      // Allow upgrading from basic pistol only in 6-2b
      if(inv.secondary && inv.secondary !== "basic_pistol" && inv.secondary !== "pistol1"){
        eco.addMoney(item.price);
        return { ok:false, reason:"SECONDARY_FILLED" };
      }
      inv.secondary = item.id;
      return { ok:true };
    }

    if(item.type === "grenade"){
      if(!Array.isArray(inv.grenades)) inv.grenades = [null,null,null];
      const idx = inv.grenades.findIndex(x=>!x);
      if(idx < 0){
        eco.addMoney(item.price);
        return { ok:false, reason:"NO_GRENADE_SLOT" };
      }
      inv.grenades[idx] = item.id;
      return { ok:true };
    }

    if(item.type === "utility"){
      // Ammo refills: only allowed if weapon exists (primary for primary refill, any secondary for secondary refill)
      if(item.id === "ammo_primary" && !inv.primary){
        eco.addMoney(item.price);
        return { ok:false, reason:"NO_PRIMARY" };
      }
      if(item.id === "ammo_secondary" && !inv.secondary){
        eco.addMoney(item.price);
        return { ok:false, reason:"NO_SECONDARY" };
      }

      // Try to call weapon system if present; otherwise it's a no-op (still consumes money)
      try{
        const ws = profile.weaponSystem || window.weaponSystem || null;
        if(ws && typeof ws.refillAmmo === "function"){
          ws.refillAmmo(item.id);
        }else if(ws && typeof ws.refillPrimaryAmmo === "function" && item.id==="ammo_primary"){
          ws.refillPrimaryAmmo();
        }else if(ws && typeof ws.refillSecondaryAmmo === "function" && item.id==="ammo_secondary"){
          ws.refillSecondaryAmmo();
        }
      }catch{}

      return { ok:true };
    }

    // unknown type
    eco.addMoney(item.price);
    return { ok:false, reason:"UNKNOWN_ITEM" };
  }
}
