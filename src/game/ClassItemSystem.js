// src/game/ClassItemSystem.js
// Patch 7-4B: class items (bandage/ammo_pack/landmine/binocular) minimal implementation
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js";

export class ClassItemSystem {
  constructor({ profile, camera, scene, mobileHUD, inputManager, onSound }){
    this.profile = profile;
    this.camera = camera;
    this.scene = scene;
    this.mobileHUD = mobileHUD;
    this.inputManager = inputManager;
    this.onSound = onSound || (()=>{});

    // ---- Bandage (channel heal scaffold; HP not implemented yet) ----
    this.healing = false;
    this.healUntil = 0;
    this.healDurationMs = 900; // quick channel to "full" once HP exists
    this.lastDamageAt = 0;

    // ---- Give limits (per target per life; placeholder without multiplayer) ----
    this.givenBandage = new Map();
    this.givenAmmo = new Map();

    // ---- Landmines (simple scene objects + future trigger hook) ----
    this.mines = [];
    this.mineMax = 1;

    // ---- Binoculars ----
    this.binocularActive = false;
    this.zoom = 4;
    this.zoomMin = 2;
    this.zoomMax = 16;
    this.baseFov = camera?.fov || 75;
  }

  // ====== Bandage ======
  ensureSpawnBandage(){
    // everyone spawns with 1 bandage
    const inv = this.profile?.inventory;
    if(!inv) return;
    if(typeof inv.bandageCount !== "number") inv.bandageCount = 1;
    // medic bandage is infinite; count ignored
  }

  resetOnRespawn(){
    const inv = this.profile?.inventory;
    if(!inv) return;
    inv.bandageCount = 1;
    this.cancelHeal();
    // per-life limits would reset on death if multiplayer exists
  }

  onDamaged(){
    this.lastDamageAt = performance.now();
    if(this.healing) this.cancelHeal(true);
  }

  startHeal(){
    if(this.healing) return false;
    const cid = this.profile?.classId;
    const inv = this.profile?.inventory;
    if(!inv) return false;

    // if HP not implemented, allow start (for UX)
    // If later you have hp/maxHp, you can block when full.
    if(cid !== "medic"){
      if((inv.bandageCount|0) <= 0) return false;
      inv.bandageCount = Math.max(0, (inv.bandageCount|0)-1);
    }
    this.healing = true;
    this.healUntil = performance.now() + this.healDurationMs;
    this.onSound("bandage_start");
    return true;
  }

  cancelHeal(playSound=false){
    if(!this.healing) return;
    this.healing = false;
    this.healUntil = 0;
    if(playSound) this.onSound("bandage_cancel");
  }

  update(dt){
    if(this.healing && performance.now() >= this.healUntil){
      this.healing = false;
      this.onSound("bandage_finish");
      // TODO Patch 8: set hp to max here
    }
    // mines cleanup (fade)
    const now = performance.now();
    this.mines = this.mines.filter(m=>{
      if(!m || !m.__expiresAt) return true;
      if(now < m.__expiresAt) return true;
      try{ this.scene?.remove(m); }catch{}
      return false;
    });
  }

  // ====== Ammo pack ======
  useAmmoPackSelf(){
    // support only; refill reserve ammo (not mag) once ammo system exists
    if(this.profile?.classId !== "support") return false;
    this.onSound("ammo_pack");
    // TODO Patch 8: refill reserve ammo to max
    return true;
  }

  // ====== Landmine ======
  canPlaceMine(){
    if(this.profile?.classId !== "support") return false;
    const inv = this.profile?.inventory;
    if(!inv) return false;
    // count stored on inventory
    if(typeof inv.mineCount !== "number") inv.mineCount = 1;
    return (inv.mineCount|0) > 0;
  }

  placeMine(playerPos){
    if(!this.canPlaceMine()) return false;
    const inv = this.profile.inventory;
    inv.mineCount = Math.max(0,(inv.mineCount|0)-1);

    // simple visual: small dark disk + red dot
    const g = new THREE.CylinderGeometry(0.22,0.22,0.06,16);
    const m = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.9, metalness: 0.1 });
    const mesh = new THREE.Mesh(g,m);
    mesh.position.copy(playerPos);
    mesh.position.y += 0.03;

    const ledG = new THREE.SphereGeometry(0.03, 12, 12);
    const ledM = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    const led = new THREE.Mesh(ledG, ledM);
    led.position.set(0, 0.05, 0);
    mesh.add(led);

    // expire after 60s
    mesh.__expiresAt = performance.now() + 60000;

    this.scene?.add(mesh);
    this.mines.push(mesh);
    this.onSound("mine_place");
    return true;
  }

  // ====== Binoculars ======
  setBinocularActive(on){
    on = !!on;
    if(this.binocularActive === on) return;
    this.binocularActive = on;
    if(!on){
      this.zoom = 4;
      this._applyZoom();
    }else{
      this._applyZoom();
    }
  }

  adjustZoom(delta){
    this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoom + delta));
    this._applyZoom();
  }

  onWheel(ev){
    if(!this.binocularActive) return;
    const d = Math.sign(ev.deltaY);
    // wheel up zoom in
    this.adjustZoom(d>0 ? -1 : +1);
  }

  _applyZoom(){
    if(!this.camera) return;
    if(typeof this.baseFov !== "number") this.baseFov = this.camera.fov || 75;
    // simple: fov / zoom
    this.camera.fov = this.baseFov / this.zoom;
    this.camera.updateProjectionMatrix?.();
  }
}
