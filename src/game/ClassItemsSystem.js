// src/game/ClassItemsSystem.js
// Patch 7-4B: Class-specific items & HUD contract (start from Patch 7-4A base)
//
// Goals (7-4B v0):
// - When active slot is classItem, update AmmoHUD with item name + ammo format.
// - Panzerfaust / SmokeLauncher use mag=1 + reload=3.0s (uses existing mag/reserve pattern).
// - Landmine uses 1/0 then 0/0.
// - Binocular: ADS (RMB / mobile ADS) toggles overlay; zoom 2..16 (wheel / mobile +/-), show zoom text.
// - Bandage / Ammo pack: implemented as stubs (Patch 8 will rework health/ammo).
//
// This module avoids risky syntax (no leading '.' line chains).

const ITEM_NAME = {
  panzerfaust: "판처파우스트",
  launcher_grenade: "발사형 연막탄",
  landmine: "대인지뢰",
  binocular: "쌍안경",
  bandage: "붕대",
  ammo_pack: "탄포대",
};

export class ClassItemsSystem {
  constructor(opts){
    this.profile = opts.profile;           // window.playerProfile
    this.throwables = opts.throwables;     // ThrowablesSystem instance
    this.camera = opts.camera;             // THREE camera
    this.ui = opts.ui || {};               // { setBinocularOverlay(on), setBinocularZoomText(str) }
    this.getNow = opts.getNow || (()=>performance.now());

    this.state = {
      // per item ammo
      panzer: { magMax:1, mag:1, resMax:1, res:1, reloadMs:3000, reloadUntil:0 },
      launcher: { magMax:1, mag:1, resMax:3, res:3, reloadMs:3000, reloadUntil:0 },
      mine: { magMax:1, mag:1, resMax:0, res:0 },

      // binocular
      binoOn:false,
      binoZoom:4,
      binoMin:2,
      binoMax:16,
      _baseFov:null,
    };

    this._prevFire = false;
    this._prevAds = false;
  }

  // Call on respawn / round start
  resetForClassItems(inv){
    // inv.classItems = ["...", "..."]
    // We reset ammo according to class default (simple & deterministic).
    this.state.panzer.mag = 1; this.state.panzer.res = 1; this.state.panzer.reloadUntil = 0;
    this.state.launcher.mag = 1; this.state.launcher.res = 3; this.state.launcher.reloadUntil = 0;
    this.state.mine.mag = 1; this.state.mine.res = 0;
    this.state.binoOn = false;
    this.state.binoZoom = 4;
    this._applyBinocular(false);
    this.ui.setBinocularOverlay && this.ui.setBinocularOverlay(false);
    this.ui.setBinocularZoomText && this.ui.setBinocularZoomText("");
  }

  getActiveItemId(){
    const p = this.profile;
    const a = p && p.activeSlot;
    if(!a || a.type !== "classItem") return null;
    const inv = p.inventory;
    if(!inv || !inv.classItems) return null;
    return inv.classItems[a.index] || null;
  }

  // HUD payload for ammoHUD
  getHUD(){
    const id = this.getActiveItemId();
    if(!id) return null;

    if(id === "panzerfaust"){
      const s = this.state.panzer;
      return { name: ITEM_NAME[id], mag: String(s.mag), res: String(s.res), isReloading: this._isReloading(s) };
    }
    if(id === "launcher_grenade"){
      const s = this.state.launcher;
      return { name: ITEM_NAME[id], mag: String(s.mag), res: String(s.res), isReloading: this._isReloading(s) };
    }
    if(id === "landmine"){
      const s = this.state.mine;
      return { name: ITEM_NAME[id], mag: String(s.mag), res: String(s.res), isReloading:false };
    }
    // ammo-less items: show infinity/infinity
    if(id === "binocular" || id === "bandage" || id === "ammo_pack"){
      return { name: ITEM_NAME[id] || id, mag: "∞", res: "∞", isReloading:false };
    }
    return { name: ITEM_NAME[id] || id, mag: "∞", res: "∞", isReloading:false };
  }

  // Main update: handles click/ads edges & reload timers.
  update(dtSec, input){
    const id = this.getActiveItemId();
    if(!id) {
      // If we were in binocular mode, turn it off when item not active.
      if(this.state.binoOn) {
        this.state.binoOn = false;
        this._applyBinocular(false);
        this.ui.setBinocularOverlay && this.ui.setBinocularOverlay(false);
        this.ui.setBinocularZoomText && this.ui.setBinocularZoomText("");
      }
      this._prevFire = false;
      this._prevAds = false;
      return;
    }

    // reload completion
    this._tickReload(this.state.panzer);
    this._tickReload(this.state.launcher);

    const fireDown = !!input.fireDown;
    const firePressed = fireDown && !this._prevFire;
    this._prevFire = fireDown;

    const adsDown = !!input.adsDown;
    const adsPressed = adsDown && !this._prevAds;
    this._prevAds = adsDown;

    // Binocular ADS toggles overlay
    if(id === "binocular"){
      if(adsPressed){
        this.state.binoOn = !this.state.binoOn;
        this._applyBinocular(this.state.binoOn);
        this.ui.setBinocularOverlay && this.ui.setBinocularOverlay(this.state.binoOn);
        this._updateBinoText();
      }
      // zoom input
      const zoomDelta = (input.zoomDelta|0);
      if(this.state.binoOn && zoomDelta){
        this.state.binoZoom = this._clamp(this.state.binoZoom + zoomDelta, this.state.binoMin, this.state.binoMax);
        this._applyBinocular(true);
        this._updateBinoText();
      }
      return;
    }

    // Bandage / Ammo pack: stub for Patch 8; no action on fire by default.
    if(id === "bandage" || id === "ammo_pack"){
      // You can still implement later; for now, no side effects.
      return;
    }

    // Landmine placement (simple): click to place if available
    if(id === "landmine"){
      if(firePressed && this.state.mine.mag > 0){
        this.state.mine.mag = 0;
        // Optional: trigger a simple event the game can listen to
        if(typeof input.onPlaceMine === "function"){
          input.onPlaceMine();
        }
      }
      return;
    }

    // Panzer / Launcher: click fires 1, then reload 3s if reserve >0
    if(id === "panzerfaust"){
      if(firePressed){
        this._fireOne(this.state.panzer, "panzer");
      }
      return;
    }
    if(id === "launcher_grenade"){
      if(firePressed){
        this._fireOne(this.state.launcher, "smoke_launch");
      }
      return;
    }
  }

  _fireOne(s, throwId){
    // s has mag/res/reloadUntil
    if(this._isReloading(s)) return false;
    if(s.mag <= 0) {
      // If mag empty but reserve exists, start reload
      if(s.res > 0) this._startReload(s);
      return false;
    }
    // Consume mag
    s.mag = 0;
    // Fire projectile via ThrowablesSystem (parabolic throw)
    if(this.throwables && typeof this.throwables.throwInstant === "function"){
      this.throwables.throwInstant(throwId);
    } else if(this.throwables && typeof this.throwables.beginHold === "function"){
      // fallback: use slot 0 throw (will likely be wrong; prefer throwInstant)
      try{
        this.throwables.beginHold(0, throwId);
        this.throwables.releaseThrow(0);
      }catch(e){}
    }
    // Start reload if reserve exists
    if(s.res > 0){
      this._startReload(s);
    }
    return true;
  }

  _startReload(s){
    const now = this.getNow();
    s.reloadUntil = now + (s.reloadMs|0);
  }

  _tickReload(s){
    if(!s || !s.reloadUntil) return;
    const now = this.getNow();
    if(now < s.reloadUntil) return;
    // complete reload
    s.reloadUntil = 0;
    if(s.mag === 0 && s.res > 0){
      s.mag = 1;
      s.res = Math.max(0, s.res - 1);
    }
  }

  _isReloading(s){
    if(!s) return false;
    const now = this.getNow();
    return !!s.reloadUntil && now < s.reloadUntil;
  }

  _applyBinocular(on){
    if(!this.camera) return;
    if(this.state._baseFov == null){
      this.state._baseFov = this.camera.fov;
    }
    if(!on){
      this.camera.fov = this.state._baseFov;
      if(this.camera.updateProjectionMatrix) this.camera.updateProjectionMatrix();
      return;
    }
    // zoom => smaller fov
    const base = this.state._baseFov || this.camera.fov;
    this.camera.fov = base / (this.state.binoZoom || 4);
    if(this.camera.updateProjectionMatrix) this.camera.updateProjectionMatrix();
  }

  _updateBinoText(){
    if(!this.ui || !this.ui.setBinocularZoomText) return;
    this.ui.setBinocularZoomText("×" + String(this.state.binoZoom|0));
  }

  _clamp(v, a, b){
    return Math.max(a, Math.min(b, v));
  }
}
