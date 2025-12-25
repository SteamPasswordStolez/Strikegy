import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js";
import { WEAPONS } from "./WeaponData.js";

export default class WeaponSystem{
  constructor({camera,scene,getCollidables,getDamageables,onWallHit,onEntityHit,onSound,onShot,onEject}){
    this.camera=camera;
    this.scene=scene;
    this.getCollidables=getCollidables;
    this.getDamageables=getDamageables;
    this.onEntityHit=onEntityHit;
    this.onWallHit=onWallHit;
    this.onSound=onSound;
    this.onShot=onShot;
    this.onEject=onEject;

    this.ray=new THREE.Raycaster();

    // per-weapon persistent state
    this.weaponStates = {};
    for(const id in WEAPONS){
      const w = WEAPONS[id];
      this.weaponStates[id] = { mag: w.magSize, reserve: w.reserve };
    }

    this.currentId = "pistol1";
    this.current = WEAPONS[this.currentId];

    this.cooldown=0;
    this.dryCooldown=0;
    this.reloadTimer=0;
    this.isReloading=false;
    this.v7_reloadStyle = "mag"; // "mag" | "perShell"
    this.isADS=false;
    this.triggerHeld=false;

    // ===== Patch 7-1B fire-mode engine state (isolated to avoid conflicts) =====
    this.v7_prevTriggerHeld = false;
    this.v7_actionLock = 0; // seconds
    this.v7_burstActive = false;
    this.v7_burstLeft = 0;
    this.v7_burstInterval = 0; // seconds
    this.v7_burstTimer = 0;    // seconds until next burst shot

    // ===== Patch 7-3A weapon sound event helpers =====
    this.v7_cycleTimer = 0;      // seconds until cycle sound plays
    this.v7_cycleSoundKey = null;

    // ===== Patch 7-3C casing ejection (pooled in game layer) =====
    this.v7_ejectTimer = 0;
    this.v7_ejectPayload = null;
  }

  // Patch 7-3A: translate (event, weapon audio preset) into a stable sound key.
  _soundKey(event, weapon){
    const preset = weapon?.audio?.preset || "AR_LIGHT";
    const p = preset;
    const table = {
      AR_LIGHT:       { FIRE:"fire_ar_light",  DRY:"dry", RELOAD_START:"reload_ar",  RELOAD_END:"reload_end_ar" },
      AR_HEAVY:       { FIRE:"fire_ar_heavy",  DRY:"dry", RELOAD_START:"reload_ar",  RELOAD_END:"reload_end_ar" },
      SMG_FAST:       { FIRE:"fire_smg_fast",  DRY:"dry", RELOAD_START:"reload_smg", RELOAD_END:"reload_end_smg" },
      SMG_HEAVY:      { FIRE:"fire_smg_heavy", DRY:"dry", RELOAD_START:"reload_smg", RELOAD_END:"reload_end_smg" },
      LMG_LIGHT:      { FIRE:"fire_lmg_light", DRY:"dry", RELOAD_START:"reload_lmg", RELOAD_END:"reload_end_lmg" },
      LMG_HEAVY:      { FIRE:"fire_lmg_heavy", DRY:"dry", RELOAD_START:"reload_lmg", RELOAD_END:"reload_end_lmg" },
      SG_LIGHT:       { FIRE:"fire_sg_light",  DRY:"dry", RELOAD_START:"reload_sg",  RELOAD_END:"reload_end_sg", CYCLE:"cycle_pump", RELOAD_INSERT:"insert_sg" },
      SG_HEAVY:       { FIRE:"fire_sg_heavy",  DRY:"dry", RELOAD_START:"reload_sg",  RELOAD_END:"reload_end_sg", CYCLE:"cycle_pump", RELOAD_INSERT:"insert_sg" },
      DMR_LIGHT:      { FIRE:"fire_dmr_light", DRY:"dry", RELOAD_START:"reload_dmr", RELOAD_END:"reload_end_dmr" },
      DMR_HEAVY:      { FIRE:"fire_dmr_heavy", DRY:"dry", RELOAD_START:"reload_dmr", RELOAD_END:"reload_end_dmr" },
      SR_LIGHT:       { FIRE:"fire_sr_light",  DRY:"dry", RELOAD_START:"reload_sr",  RELOAD_END:"reload_end_sr", CYCLE:"cycle_bolt", RELOAD_INSERT:"insert_sr" },
      SR_HEAVY:       { FIRE:"fire_sr_heavy",  DRY:"dry", RELOAD_START:"reload_sr",  RELOAD_END:"reload_end_sr", CYCLE:"cycle_bolt", RELOAD_INSERT:"insert_sr" },
      PISTOL:         { FIRE:"fire_pistol",    DRY:"dry", RELOAD_START:"reload_pistol", RELOAD_END:"reload_end_pistol" },
      MACHINE_PISTOL: { FIRE:"fire_machine_pistol", DRY:"dry", RELOAD_START:"reload_pistol", RELOAD_END:"reload_end_pistol" },
    };
    const row = table[p] || table.AR_LIGHT;
    return row[event] || null;
  }

  _playWeaponSound(event, weapon){
    const key = this._soundKey(event, weapon);
    if(key) this.onSound?.(key);
  }

  get mag(){ return this.weaponStates[this.currentId].mag; }
  get reserve(){ return this.weaponStates[this.currentId].reserve; }

  setTriggerHeld(v){ this.triggerHeld=v; }
  setADS(v){ this.isADS=v; }

  switchWeapon(id){
    const w = WEAPONS[id];
    if(!w || id===this.currentId) return;
    // cancel reload on switch
    this.isReloading=false; this.reloadTimer=0;
    this.currentId = id;
    this.current = w;
    this.cooldown = 0;
    this.onSound?.("swap");
  }

  // Patch 8-4A2: Reset all weapon magazines/reserve on death (per design).
  // This makes per-life ammo state deterministic and avoids partial-mag edge cases.
  resetAllAmmoFull(){
    try{
      for(const id in WEAPONS){
        const w = WEAPONS[id];
        if(!w) continue;
        if(!this.weaponStates[id]) this.weaponStates[id] = { mag: 0, reserve: 0 };
        this.weaponStates[id].mag = Number(w.magSize ?? 0) || 0;
        this.weaponStates[id].reserve = Number(w.reserve ?? 0) || 0;
      }
      // Cancel any reload/burst state as well.
      this.isReloading = false;
      this.reloadTimer = 0;
      this.v7_actionLock = 0;
      this.v7_burstActive = false;
      this.v7_burstLeft = 0;
      this.v7_burstTimer = 0;
    }catch(e){}
  }

  startReload(){
    const st = this.weaponStates[this.currentId];
    if(this.isReloading) return;
    if(st.mag >= this.current.magSize) return;
    if(st.reserve <= 0) return;
    this.isReloading=true;
    // Patch 7-3C: per-shell reload for SG/SR (and anything explicitly marked)
    this.v7_reloadStyle = (this.current.reloadStyle === "perShell") ? "perShell" : "mag";
    if(this.v7_reloadStyle === "perShell"){
      // Small start delay so RELOAD_START reads separately from the first insert.
      this.reloadTimer = 0.25;
    }else{
      this.reloadTimer=this.current.reloadTime;
    }
    this._playWeaponSound("RELOAD_START", this.current);
  }

  update(dt){
    if(this.cooldown>0) this.cooldown=Math.max(0,this.cooldown-dt);
    if(this.dryCooldown>0) this.dryCooldown=Math.max(0,this.dryCooldown-dt);
    if(this.v7_actionLock>0) this.v7_actionLock=Math.max(0,this.v7_actionLock-dt);
    if(this.v7_burstTimer>0) this.v7_burstTimer=Math.max(0,this.v7_burstTimer-dt);

    // Patch 7-3C: deferred casing ejection (SR ejects on bolt timing)
    if(this.v7_ejectTimer>0){
      this.v7_ejectTimer = Math.max(0, this.v7_ejectTimer - dt);
      if(this.v7_ejectTimer<=0 && this.v7_ejectPayload){
        this.onEject?.(this.v7_ejectPayload);
        this.v7_ejectPayload = null;
      }
    }

    // Patch 7-3A: deferred cycle sound (bolt/pump)
    if(this.v7_cycleTimer>0){
      this.v7_cycleTimer = Math.max(0, this.v7_cycleTimer - dt);
      if(this.v7_cycleTimer<=0 && this.v7_cycleSoundKey){
        this.onSound?.(this.v7_cycleSoundKey);
        this.v7_cycleSoundKey = null;
      }
    }

    // Normalize trigger input into held/pressed.
    const held = !!this.triggerHeld;
    const pressed = held && !this.v7_prevTriggerHeld;
    this.v7_prevTriggerHeld = held;

    // ---- Patch 7-1B fire-mode engine ----
    const st = this.weaponStates[this.currentId];
    const w = this.current;

    const canAuto = (w.fireMode === "auto");
    const wantsFire = canAuto ? held : pressed; // ✅ non-auto cannot be held to repeat

    // Reload handling (supports interruption + per-shell)
    if(this.isReloading){
      // If we already have ammo in mag, allow firing to cancel reload.
      if(wantsFire && st.mag>0){
        this.isReloading = false;
        this.reloadTimer = 0;
        // Continue into normal firing logic this frame.
      }else{
        this.reloadTimer -= dt;
        if(this.reloadTimer<=0){
          if(this.v7_reloadStyle === "perShell"){
            // Insert a single round/shell
            if(st.mag < this.current.magSize && st.reserve > 0){
              st.mag += 1;
              st.reserve -= 1;
              this._playWeaponSound("RELOAD_INSERT", this.current);
              const ins = (this.current.insertMs ?? (this.current.fireMode === "bolt" ? 720 : 450)) / 1000;
              this.reloadTimer = Math.max(0.05, ins);
            }
            // Finish if full or no reserve
            if(st.mag >= this.current.magSize || st.reserve <= 0){
              this.isReloading = false;
              this._playWeaponSound("RELOAD_END", this.current);
            }
          }else{
            // Mag-style reload
            const need = this.current.magSize - st.mag;
            const take = Math.min(need, st.reserve);
            st.mag += take;
            st.reserve -= take;
            this.isReloading=false;
            this._playWeaponSound("RELOAD_END", this.current);
          }
        }
        return;
      }
    }

    // 1) Burst continuation (AR-3 Sentinel). Runs even if trigger is released.
    if(this.v7_burstActive){
      if(this.v7_burstLeft<=0){
        this.v7_burstActive=false;
      }else if(this.v7_burstTimer<=0 && this.cooldown<=0 && this.v7_actionLock<=0){
        if(st.mag>0){
          this._shoot();
          this.v7_burstLeft--;
          this.v7_burstTimer = this.v7_burstInterval;
          // keep a small cooldown so we never exceed rpm even if interval is tiny
          this.cooldown = Math.max(this.cooldown, 60/Math.max(1, w.rpm));
        }else{
          // Out of mag while bursting: stop burst and attempt reload/dry
          this.v7_burstActive=false;
          if(st.reserve>0) this.startReload();
          else if(this.dryCooldown<=0){ this._playWeaponSound("DRY", w); this.dryCooldown=0.18; }
        }
      }
    }

    if(!wantsFire) return;
    if(this.cooldown>0 || this.v7_actionLock>0) return;

    if(st.mag>0){
      if(w.fireMode === "burst"){
        // Start burst: click = 1 burst (A option), cannot be canceled by holding.
        if(!this.v7_burstActive){
          const count = w.burst?.count ?? 3;
          const intervalMs = w.burst?.intervalMs ?? 80;
          this.v7_burstActive = true;
          this.v7_burstLeft = count;
          this.v7_burstInterval = intervalMs/1000;
          // Fire first shot immediately so the burst feels snappy.
          if(st.mag>0){
            this._shoot();
            this.v7_burstLeft = Math.max(0, count-1);
            this.v7_burstTimer = this.v7_burstInterval;
          }else{
            this.v7_burstActive = false;
          }
        }
        return;
      }

      // One-shot (auto/semi/bolt/pump)
      this._shoot();
      this.cooldown = 60/Math.max(1, w.rpm);

      if(w.fireMode === "bolt"){
        this.v7_actionLock = (w.boltCycleMs ?? 900)/1000;
      }else if(w.fireMode === "pump"){
        this.v7_actionLock = (w.pumpMs ?? 650)/1000;
      }
      return;
    }

    // No mag
    if(st.reserve>0){
      this.startReload();
    }else{
      if(this.dryCooldown<=0){
        this._playWeaponSound("DRY", w);
        this.dryCooldown=0.18;
      }
    }
  }

  _shoot(){
    const st = this.weaponStates[this.currentId];
    st.mag--;
    this.cooldown = 60/this.current.rpm;

    // Patch 7-3A: weapon-specific fire sound
    this._playWeaponSound("FIRE", this.current);

    // Patch 7-3A: schedule bolt/pump cycle sound slightly after the shot
    if(this.current.fireMode === "bolt"){
      // Patch 7-3B: cycle a bit later so it reads as "after-shot" bolt action
      this.v7_cycleTimer = 0.18;
      this.v7_cycleSoundKey = this._soundKey("CYCLE", this.current) || "cycle_bolt";

      // Patch 7-3C: SR casings eject on bolt timing (same delay as cycle)
      this.v7_ejectTimer = 0.18;
      this.v7_ejectPayload = {
        weaponId: this.currentId,
        weapon: this.current,
        mode: "bolt",
      };
    }else if(this.current.fireMode === "pump"){
      this.v7_cycleTimer = 0.14;
      this.v7_cycleSoundKey = this._soundKey("CYCLE", this.current) || "cycle_pump";

      // Patch 7-3C: SG casings eject immediately on shot (spec)
      this.onEject?.({ weaponId: this.currentId, weapon: this.current, mode: "pump" });
    }else{
      // Patch 7-3C: all other weapons eject immediately
      this.onEject?.({ weaponId: this.currentId, weapon: this.current, mode: this.current.fireMode || "" });
    }
    // Patch 7-2B: pass weapon context to callback (keeps backward compatibility)
    this.onShot?.({
      weaponId: this.currentId,
      weapon: this.current,
      isADS: this.isADS,
      fireMode: this.current.fireMode,
    });

    const dir=new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const origin=new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    // Patch 7-3B: shotgun buckshot (multi-ray) with spread + multiple decals
    const isShotgun = !!this.current?.pellets && (this.current.id?.startsWith?.("sg") || this.current.fireMode === "pump");
    if(isShotgun){
      const pellets = Math.max(1, this.current.pellets|0);
      const spreadDeg = this.isADS ? (this.current.spreadDegAds ?? this.current.spreadDegHip ?? 6) : (this.current.spreadDegHip ?? 6);
      const spread = THREE.MathUtils.degToRad(spreadDeg);
      const right = new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion);
      const up    = new THREE.Vector3(0,1,0).applyQuaternion(this.camera.quaternion);

      let decalsLeft = Math.min(5, Math.max(1, Math.round(pellets/3)));
      for(let i=0;i<pellets;i++){
        // cheap gaussian-ish distribution for tighter center
        const rx = ((Math.random()+Math.random()+Math.random())-1.5)/1.5;
        const ry = ((Math.random()+Math.random()+Math.random())-1.5)/1.5;
        const d2 = dir.clone()
          .add(right.clone().multiplyScalar(rx * spread))
          .add(up.clone().multiplyScalar(ry * spread))
          .normalize();

        this.ray.set(origin, d2);
        this.ray.far = this.current.range;
        const hits = this.ray.intersectObjects(this.getCollidables(), true);
        if(hits.length && decalsLeft>0){
          this.onWallHit?.(hits[0]);
          decalsLeft--;
        }
      }
      return;
    }

    // Default: single hitscan ray (world + damageables)
    this.ray.set(origin,dir);
    this.ray.far=this.current.range;

    let worldHits=this.ray.intersectObjects(this.getCollidables(),true);
    // Filter out damageable hits so entities (bots/players) don't get treated like walls.
    // If we don't do this, a bot mesh included in collidables can swallow the hit and
    // prevent onEntityHit from firing.
    if(worldHits && worldHits.length){
      worldHits = worldHits.filter(h => !h?.object?.userData?.damageableId);
    }

    // Optional: damageable hits (bots / remote players / dummies)
    let dmgHit = null;
    try{
      const dmgRoots = (typeof this.getDamageables === "function") ? (this.getDamageables() || []) : [];
      if(dmgRoots.length){
        const dh = this.ray.intersectObjects(dmgRoots, true);
        if(dh && dh.length) dmgHit = dh[0];
      }
    }catch{}

    const worldHit = (worldHits && worldHits.length) ? worldHits[0] : null;

    // Choose nearest hit
    const best = (!worldHit) ? dmgHit : (!dmgHit ? worldHit : (dmgHit.distance < worldHit.distance ? dmgHit : worldHit));

    if(best){
      if(best === dmgHit){
        this.onEntityHit?.(best, this.current);
      }else{
        this.onWallHit?.(best);
      }
    }
  }
}
