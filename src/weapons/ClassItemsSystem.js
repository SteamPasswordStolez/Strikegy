import ArcCrosshair from "../ui/ArcCrosshair.js";

/**
 * Patch 7-4B: ClassItemsSystem
 * Handles:
 *  - Panzerfaust (2) + Smoke launcher (4): parabolic fire via ThrowablesSystem.throwInstant()
 *  - Bandage + Ammo pack: fire/handshake priority logic (give within 2m else self-use if needed)
 *  - Binoculars: zoom 2x..16x (PC wheel, mobile +/-)
 *  - Melee remains in WeaponSwitchManager (F), jackknife visuals handled elsewhere (Patch 8+)
 *
 * Notes:
 *  - HP/Ammo concrete application is deferred; we keep hooks so Patch 8 can connect.
 */
export default class ClassItemsSystem{
  constructor({ scene, camera, inputManager, throwablesSystem, playerProfile, getPlayers, ui, soundSystem, getCollidables }){
    this.scene = scene;
    this.camera = camera;
    this.input = inputManager;
    this.throwables = throwablesSystem;
    this.p = playerProfile;
    this.getPlayers = getPlayers || (()=>[]);
    this.ui = ui;
    this.sound = soundSystem;
    this.getCollidables = getCollidables || (()=>[]);

    this.arc = new ArcCrosshair({ scene, camera });

    this._prevFire = false;
    this._prevHandshake = false;

    // Binocular zoom state
    this.binocularZoom = 4; // 2..16
    this._binocularActive = false;
  }

  destroy(){
    this.arc?.destroy?.();
  }

  // Call when local player takes damage -> cancel heal immediately
  onLocalDamaged(){
    if(!this.p) return;
    if(this.p._healing){
      this.p._healing = false;
      this.ui?.setHealActive?.(false);
    }
  }

  onPlayerDied(playerId){
    // reset per-target give limits on death
    if(!this.p?.classItemState) this.p.classItemState = {};
    const s = this.p.classItemState;
    s.medicGiven = s.medicGiven || {};
    s.supportGiven = s.supportGiven || {};
    delete s.medicGiven[playerId];
    delete s.supportGiven[playerId];
  }

  _ensureState(){
    if(!this.p.classItemState) this.p.classItemState = {};
    const s = this.p.classItemState;

    // ammo pools
    if(typeof s.panzerAmmo !== "number") s.panzerAmmo = 2;
    if(typeof s.smokeLauncherAmmo !== "number") s.smokeLauncherAmmo = 4;

    // give-limits
    if(!s.medicGiven) s.medicGiven = {};   // targetId -> true for this life
    if(!s.supportGiven) s.supportGiven = {};

    // everyone spawns with 1 bandage (LoadoutManager sets bandageCount)
    if(typeof this.p.bandageCount !== "number") this.p.bandageCount = 1;
  }

  update(dt, { hudState, mouseLeftDown, mouseWheelDelta=0 } = {}){
    if(!this.p) return;
    this._ensureState();

    const aSlot = this.p.activeSlot;
    const inv = this.p.inventory;
    const isClassItem = !!aSlot && aSlot.type === "classItem";
    const itemId = isClassItem ? (inv?.classItems?.[aSlot.index] || null) : null;

    // Arc crosshair enable for panzer/smoke launcher
    const arcOn = (itemId === "panzerfaust" || itemId === "launcher_grenade");
    this.arc.setEnabled(!!arcOn);
    if(arcOn){
      if(itemId === "panzerfaust") this.arc.setBallistics({ power: 32.0, upBoost: 2.6, gravity: 9.81 });
      if(itemId === "launcher_grenade") this.arc.setBallistics({ power: 22.5, upBoost: 2.4, gravity: 9.81 });
      this.arc.update({ getCollidables: this.getCollidables });
    }

    // Binocular zoom controls
    this._binocularActive = (itemId === "binocular");
    if(this._binocularActive){
      // PC wheel
      if(mouseWheelDelta){
        const dir = Math.sign(mouseWheelDelta);
        // wheel down => delta positive => zoom out; match common feel
        this._adjustBinocularZoom(dir > 0 ? -1 : +1);
      }
      // Mobile +/- pulses
      if(hudState?.zoomPlusPressed) this._adjustBinocularZoom(+1);
      if(hudState?.zoomMinusPressed) this._adjustBinocularZoom(-1);

      // Apply by changing camera fov
      this._applyBinocularFov();
    }else{
      this._resetBinocularFov();
    }

    // Bandage quick-use (C or mobile bandage button) works regardless of holding
    if(hudState?.bandagePressed){
      this._trySelfBandage();
    }

    // Fire/Handshake logic for give/self-use when holding bandage/ammo_pack
    const fireNow = !!mouseLeftDown || !!hudState?.fireHeld;
    const handshakeNow = !!hudState?.handshakePressed;

    const fireEdge = fireNow && !this._prevFire;
    const handshakeEdge = handshakeNow && !this._prevHandshake;

    if(isClassItem && (fireEdge || handshakeEdge)){
      if(itemId === "panzerfaust"){
        this._firePanzer();
      }else if(itemId === "launcher_grenade"){
        this._fireSmokeLauncher();
      }else if(itemId === "bandage"){
        // priority: give within 2m else self-use if hp < max
        this._bandageInteract();
      }else if(itemId === "ammo_pack"){
        this._ammoPackInteract();
      }else if(itemId === "landmine"){
        // (optional) place mine later; keep no-op for now
      }
    }

    // heal channel tick (placeholder): if healing, just keep flag; Patch 8 will apply HP changes.
    if(this.p._healing){
      this.p._healingT = (this.p._healingT || 0) - dt;
      if(this.p._healingT <= 0){
        this.p._healing = false;
        this.ui?.setHealActive?.(false);
        // Patch 8: set HP to max here
      }
    }

    this._prevFire = fireNow;
    this._prevHandshake = handshakeNow;
  }

  _firePanzer(){
    const s = this.p.classItemState;
    if(s.panzerAmmo <= 0) return false;
    s.panzerAmmo--;

    this.throwables?.throwInstant?.("panzerfaust", 0);
    this.sound?.play?.("throw_cast");
    return true;
  }

  _fireSmokeLauncher(){
    const s = this.p.classItemState;
    if(s.smokeLauncherAmmo <= 0) return false;
    s.smokeLauncherAmmo--;

    this.throwables?.throwInstant?.("launcher_grenade", 0);
    this.sound?.play?.("throw_cast");
    return true;
  }

  _nearestAllyWithin(radius=2.0){
    const me = this.p;
    const players = this.getPlayers() || [];
    let best=null, bestD=Infinity;
    for(const pl of players){
      if(!pl || pl.id===me.id) continue;
      if(pl.team !== me.team) continue;
      if(pl.dead) continue;
      const d = this._dist(me.position, pl.position);
      if(d <= radius && d < bestD){ best=pl; bestD=d; }
    }
    return best;
  }

  _bandageInteract(){
    // Medic gives if possible else self-use if hp < max
    if(this.p.classId === "medic" || this.p.class === "medic"){
      if(this._tryGiveBandage()) return true;
    }
    // If no eligible target and self needs -> self-use
    const t = this._nearestAllyWithin(2.0);
    const eligible = (this.p.classId==="medic"||this.p.class==="medic") && t && !this.p.classItemState.medicGiven[t.id] && (t.bandageCount||0)<1;
    if(!eligible){
      return this._trySelfBandage();
    }
    return false;
  }

  _ammoPackInteract(){
    if(this.p.classId === "support" || this.p.class === "support"){
      if(this._tryGiveAmmoPack()) return true;
    }
    const t = this._nearestAllyWithin(2.0);
    const eligible = (this.p.classId==="support"||this.p.class==="support") && t && !this.p.classItemState.supportGiven[t.id];
    if(!eligible){
      return this._trySelfAmmoPack();
    }
    return false;
  }

  _trySelfBandage(){
    // Only if hp < max (if HP exists), else ignore
    if(typeof this.p.hp==="number" && typeof this.p.maxHp==="number"){
      if(this.p.hp >= this.p.maxHp) return false;
    }
    // consume if not medic
    const isMedic = (this.p.classId==="medic" || this.p.class==="medic");
    if(!isMedic){
      if((this.p.bandageCount||0) <= 0) return false;
      this.p.bandageCount = Math.max(0, (this.p.bandageCount||0)-1);
    }
    // start heal channel (1.0s)
    this.p._healing = true;
    this.p._healingT = 1.0;
    this.ui?.setHealActive?.(true);
    this.sound?.play?.("bandage");
    return true;
  }

  _tryGiveBandage(){
    const t = this._nearestAllyWithin(2.0);
    if(!t) return false;
    const s = this.p.classItemState;
    if(s.medicGiven[t.id]) return false;
    if((t.bandageCount||0) >= 1) return false;
    t.bandageCount = 1;
    s.medicGiven[t.id] = true;
    this.sound?.play?.("swap");
    return true;
  }

  _trySelfAmmoPack(){
    // Only if reserve ammo < max (if tracked)
    if(typeof this.p.reserveAmmo==="number" && typeof this.p.maxReserveAmmo==="number"){
      if(this.p.reserveAmmo >= this.p.maxReserveAmmo) return false;
    }
    // Patch 8: refill reserve ammo here
    this.sound?.play?.("swap");
    this.ui?.toast?.("예비탄 보급");
    return true;
  }

  _tryGiveAmmoPack(){
    const t = this._nearestAllyWithin(2.0);
    if(!t) return false;
    const s = this.p.classItemState;
    if(s.supportGiven[t.id]) return false;
    s.supportGiven[t.id] = true;
    // Patch 8: refill t reserve ammo here
    this.sound?.play?.("swap");
    this.ui?.toast?.("예비탄 보급");
    return true;
  }

  _adjustBinocularZoom(delta){
    this.binocularZoom = Math.max(2, Math.min(16, this.binocularZoom + delta));
  }

  _applyBinocularFov(){
    if(!this.camera) return;
    const base = this.camera._baseFov ?? this.camera.fov;
    this.camera._baseFov = base;
    this.camera.fov = base / this.binocularZoom;
    this.camera.updateProjectionMatrix?.();
    this.ui?.setBinocularZoom?.(this.binocularZoom);
  }

  _resetBinocularFov(){
    if(!this.camera) return;
    if(this.camera._baseFov){
      this.camera.fov = this.camera._baseFov;
      this.camera.updateProjectionMatrix?.();
    }
  }

  _dist(a,b){
    if(!a||!b) return Infinity;
    const dx=a.x-b.x, dy=a.y-b.y, dz=a.z-b.z;
    return Math.sqrt(dx*dx+dy*dy+dz*dz);
  }
}
