// src/game/ClassItemSystem.js
// Patch 7-4B: class items (Key6/7) + ammo semantics + binocular zoom UI hooks

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js";

const clamp = (v,a,b)=> Math.max(a, Math.min(b, v));

export class ClassItemSystem {
  constructor(opts={}){
    this.profile = opts.profile;
    this.camera = opts.camera;
    this.scene = opts.scene;
    this.getCollidables = opts.getCollidables || (()=>[]);
    this.getPlayerObject = opts.getPlayerObject || (()=>null);
    this.getEntities = opts.getEntities || (()=>[]); // for heal-smoke later
    this.throwablesSystem = opts.throwablesSystem || null;
    this.ammoRefill = opts.ammoRefill || null;
    this.onSound = opts.onSound || (()=>{});
    this.onHUD = opts.onHUD || (()=>{}); // (payload) => {}

    // Per-life item states live on inventory.__classItemState
    this._ensureState();

    // Binocular
    this.bino = {
      aiming: false,
      zoom: 8,
      min: 2,
      max: 16,
      baseFov: (this.camera?.fov ?? 75),
    };

    // Heal smoke zones (visual is handled by ThrowablesSystem smoke detonation)
    this._healSmokes = []; // {pos, r, t, team}

    // Simple projectile sim for class launchers (panzer/heal-smoke)
    // We keep it lightweight and deterministic: ballistic integration + raycast segment collision.
    this._projs = []; // { type, pos, prev, vel, g, ttl, mesh }

    // Ladder (sniper slot1): placement preview + single placed ladder
    this.ladder = {
      placing: false,
      valid: false,
      base: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 0, 1),
      height: 5.0,
      preview: null,
      mesh: null,
      _tmp: { hit: null },
    };
  }

  _ensureState(){
    const inv = this.profile?.inventory;
    if(!inv) return null;
    if(!inv.__classItemState) inv.__classItemState = {};
    const s = inv.__classItemState;
    if(!s.panzer){ s.panzer = { reserve: 3, chamber: 1, reload: 0, reloading:false }; }
    if(!s.healSmoke){ s.healSmoke = { reserve: 4, chamber: 1, reload: 0, reloading:false }; }
    if(typeof s.mineLoaded !== 'number') s.mineLoaded = 1;
    return s;
  }

  resetOnRespawn(){
    const s = this._ensureState();
    if(!s) return;
    // Panzerfaust: total 4 rounds => 1 chamber + 3 reserve
    s.panzer.reserve = 3;
    s.panzer.chamber = 1;
    s.panzer.reload = 0;
    s.panzer.reloading = false;

    // Medic fired heal-smoke: total 5 => 1 chamber + 4 reserve
    s.healSmoke.reserve = 4;
    s.healSmoke.chamber = 1;
    s.healSmoke.reload = 0;
    s.healSmoke.reloading = false;

    // Landmine: 1 use
    s.mineLoaded = 1;

    // Binocular resets when you re-aim
    this.bino.aiming = false;
    this.bino.zoom = 8;
    this._applyBinoFov(false);

    // Ladder placement UI/state resets
    this._setLadderPlacing(false);
  }

  // Patch 7-4B+: On death, class-item ammo/mag must reset immediately (not only on respawn)
  resetOnDeath(){
    this.resetOnRespawn();
  }

  // ===== Public API =====
  use(slotIndex){
    const inv = this.profile?.inventory;
    if(!inv) return false;
    const id = inv.classItems?.[slotIndex] || null;
    if(!id) return false;

    // dead / respawn guard lives in game.html (playerDead), but keep a soft guard
    if(this.profile?.isDead) return false;

    if(id === 'ammo_pack') return this._useAmmoPack();
    if(id === 'panzerfaust') return this._usePanzer();
    if(id === 'smoke_launcher_heal') return this._useHealSmoke();
    if(id === 'landmine') return this._placeMine();
    if(id === 'binocular') return this._toggleBinocular();
    if(id === 'ladder') return this._useLadder();

    return false;
  }

  setBinocularAiming(on){
    on = !!on;
    if(!this._isBinocularEquipped()){
      this.bino.aiming = false;
      this._applyBinoFov(false);
      this.onHUD?.({ type:'bino', show:false, zoom:this.bino.zoom });
      return;
    }
    if(on && !this.bino.aiming){
      // first time aim => default 8x
      this.bino.zoom = 8;
    }
    this.bino.aiming = on;
    this._applyBinoFov(on);
    this.onHUD?.({ type:'bino', show:on, zoom:this.bino.zoom });
  }

  adjustBinoZoom(delta){
    if(!this.bino.aiming) return;
    this.bino.zoom = clamp(this.bino.zoom + delta, this.bino.min, this.bino.max);
    this._applyBinoFov(true);
    this.onHUD?.({ type:'bino', show:true, zoom:this.bino.zoom });
  }

  onWheel(ev){
    if(!this.bino.aiming) return false;
    const d = Math.sign(ev.deltaY);
    // wheel up => zoom in
    this.adjustBinoZoom(d>0 ? -1 : +1);
    return true;
  }

  isBinoAiming(){ return !!this.bino.aiming; }

  getHUDInfo(){
    const inv = this.profile?.inventory;
    const a = this.profile?.activeSlot;
    if(!inv || !a || a.type !== 'classItem') return null;
    const id = inv.classItems?.[a.index] || null;
    const s = inv.__classItemState || {};

    if(id === 'ammo_pack'){
      return {
        weapon: '탄포대',
        slot: `고유${(a.index|0)+1}`,
        magText: '∞',
        resText: '',
        status: (this.ammoRefill?.busy ? '보급중..' : ''),
        blink: !!this.ammoRefill?.busy,
      };
    }
    if(id === 'panzerfaust'){
      const st = s.panzer || { reserve:0, chamber:0, reloading:false };
      const totalMax = 4;
      const totalNow = (st.reserve|0) + (st.chamber|0);
      return {
        weapon: '판처파우스트',
        slot: `고유${(a.index|0)+1}`,
        magText: String(st.chamber|0),
        resText: `${totalNow}/${totalMax}`,
        status: st.reloading ? 'RELOADING' : (totalNow<=0 ? 'EMPTY' : ''),
        blink: !!st.reloading || totalNow<=0,
      };
    }
    if(id === 'smoke_launcher_heal'){
      const st = s.healSmoke || { reserve:0, chamber:0, reloading:false };
      const totalMax = 5;
      const totalNow = (st.reserve|0) + (st.chamber|0);
      return {
        weapon: '힐 연막탄',
        slot: `고유${(a.index|0)+1}`,
        magText: String(st.chamber|0),
        resText: `${totalNow}/${totalMax}`,
        status: st.reloading ? 'RELOADING' : (totalNow<=0 ? 'EMPTY' : ''),
        blink: !!st.reloading || totalNow<=0,
      };
    }
    if(id === 'landmine'){
      const loaded = (s.mineLoaded|0);
      return {
        weapon: '대인지뢰',
        slot: `고유${(a.index|0)+1}`,
        magText: String(loaded),
        resText: '/1',
        status: (loaded<=0 ? 'EMPTY' : ''),
        blink: loaded<=0,
      };
    }
    if(id === 'binocular'){
      return {
        weapon: '쌍안경',
        slot: `고유${(a.index|0)+1}`,
        magText: '∞',
        resText: '',
        status: this.bino.aiming ? `${this.bino.zoom}x` : '',
        blink: false,
      };
    }
    if(id === 'ladder'){
      return {
        weapon: '사다리',
        slot: `고유${(a.index|0)+1}`,
        magText: '∞',
        resText: '',
        status: this.ladder.placing ? '설치 모드' : '',
        blink: this.ladder.placing,
      };
    }
    return null;
  }

  update(dt){
    // ammo refill timers
    this.ammoRefill?.update?.(dt);

    // Ladder placement preview (only when ladder is the active class item)
    this._updateLadderPreview?.(dt);

    // launchers projectiles (panzer / heal-smoke)
    this._updateProjectiles(dt);

    // class projectiles
    this._updateProjectiles(dt);

    const inv = this.profile?.inventory;
    const s = inv?.__classItemState;
    if(!inv || !s) return;

    // Panzer reload
    if(s.panzer?.reloading){
      s.panzer.reload -= dt;
      if(s.panzer.reload <= 0){
        s.panzer.reloading = false;
        if(s.panzer.chamber === 0 && s.panzer.reserve > 0){
          s.panzer.chamber = 1;
          s.panzer.reserve = Math.max(0, (s.panzer.reserve|0) - 1);
        }
      }
    }

    // Heal smoke reload
    if(s.healSmoke?.reloading){
      s.healSmoke.reload -= dt;
      if(s.healSmoke.reload <= 0){
        s.healSmoke.reloading = false;
        if(s.healSmoke.chamber === 0 && s.healSmoke.reserve > 0){
          s.healSmoke.chamber = 1;
          s.healSmoke.reserve = Math.max(0, (s.healSmoke.reserve|0) - 1);
        }
      }
    }

    // Heal smoke zone tick (HP system exists in Patch 8)
    // NOTE: we keep it safe; if entity.hp isn't present, it won't do anything.
    for(let i=this._healSmokes.length-1;i>=0;i--){
      const z = this._healSmokes[i];
      z.t -= dt;
      if(z.t <= 0){ this._healSmokes.splice(i,1); continue; }
      const ents = this.getEntities?.() || [];
      for(const e of ents){
        if(!e || !e.position) continue;
        if(z.team && e.team && e.team !== z.team) continue;
        const hp = e.hp; const maxHp = e.maxHp || 100;
        if(typeof hp !== 'number') continue;
        if(hp >= maxHp) continue;
        const d = e.position.distanceTo(z.pos);
        if(d <= z.r){
          e.hp = Math.min(maxHp, hp + 8 * dt);
        }
      }
    }
  }

  _updateProjectiles(dt){
    if(!dt || dt<=0) return;
    if(!this._projs.length) return;
    const cols = this.getCollidables?.() || [];
    const ray = new THREE.Raycaster();

    for(let i=this._projs.length-1;i>=0;i--){
      const p = this._projs[i];
      p.ttl -= dt;
      if(p.ttl <= 0){
        this._killProj(i);
        continue;
      }

      p.prev.copy(p.pos);
      // gravity
      p.vel.y += p.g * dt;
      p.pos.addScaledVector(p.vel, dt);

      // collision: raycast segment prev->pos
      const dir = new THREE.Vector3().subVectors(p.pos, p.prev);
      const dist = dir.length();
      if(dist > 1e-5){
        dir.multiplyScalar(1/dist);
        ray.set(p.prev, dir);
        ray.far = dist;
        const hits = ray.intersectObjects(cols, true);
        if(hits && hits.length){
          const hitPos = hits[0].point.clone();
          this._onProjHit(p, hitPos);
          this._killProj(i);
          continue;
        }
      }

      if(p.mesh){
        p.mesh.position.copy(p.pos);
        // face velocity direction for "rocket" feel
        const v = p.vel.clone();
        if(v.lengthSq() > 1e-6){
          v.normalize();
          p.mesh.lookAt(p.pos.clone().add(v));
        }
      }
    }
  }

  _killProj(index){
    const p = this._projs[index];
    try{ if(p?.mesh) this.scene?.remove?.(p.mesh); }catch{}
    this._projs.splice(index,1);
  }

  _onProjHit(p, hitPos){
    if(!p || !hitPos) return;
    if(p.type === 'panzer'){
      // Use impact explosion payload (local damage is already wired through ThrowablesSystem callbacks)
      this.throwablesSystem?.triggerDetonation?.('impact', hitPos);
      return;
    }
    if(p.type === 'healSmoke'){
      this.throwablesSystem?.triggerDetonation?.('smoke', hitPos);
      // Heal zone mirrors smoke duration/radius
      this._healSmokes.push({ pos: hitPos.clone(), r: 11.6, t: 9.5, team: this.profile?.team || null });
      return;
    }
  }

  _spawnProj({ type, speed=38, up=1.8, gravity=-12, ttl=4.5, color=0xffffff } = {}){
    const cam = this.camera;
    if(!cam) return false;
    const origin = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    dir.normalize();
    const start = origin.clone().add(dir.clone().multiplyScalar(0.85));
    // little raise so it doesn't clip the floor at close range
    start.y += 0.02;

    const vel = dir.multiplyScalar(speed);
    vel.y += up;

    // visible projectile
    let mesh = null;
    try{
      const geom = (type==='panzer')
        ? new THREE.CylinderGeometry(0.05, 0.05, 0.45, 10)
        : new THREE.SphereGeometry(0.08, 10, 10);
      const mat = new THREE.MeshStandardMaterial({ color, roughness:0.35, metalness:0.15, emissive:0x000000 });
      mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(start);
      if(type==='panzer') mesh.rotation.x = Math.PI/2;
      this.scene?.add?.(mesh);
    }catch{}

    this._projs.push({ type, pos: start, prev: start.clone(), vel, g: gravity, ttl, mesh });
    return true;
  }

  // ===== Ladder (Sniper slot1) =====
  _isLadderEquipped(){
    const inv = this.profile?.inventory;
    const a = this.profile?.activeSlot;
    if(!inv || !a || a.type !== 'classItem') return false;
    return inv.classItems?.[a.index] === 'ladder';
  }

  _setLadderPlacing(on){
    on = !!on;
    this.ladder.placing = on;
    if(!on){
      this.ladder.valid = false;
      this._hideLadderPreview();
    }
  }

  _hideLadderPreview(){
    try{ if(this.ladder.preview) this.scene?.remove?.(this.ladder.preview); }catch{}
    this.ladder.preview = null;
  }

  _ensureLadderPreview(){
    if(this.ladder.preview) return;
    try{
      const geom = new THREE.BoxGeometry(0.35, this.ladder.height, 0.12);
      const mat = new THREE.MeshStandardMaterial({ color: 0x00ff88, transparent: true, opacity: 0.35, roughness: 0.9, metalness: 0.05 });
      const m = new THREE.Mesh(geom, mat);
      m.name = 'ladder_preview';
      this.ladder.preview = m;
      this.scene?.add?.(m);
    }catch{}
  }

  _raycastWallForLadder(){
    if(!this.camera) return null;
    const ray = new THREE.Raycaster();
    const origin = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.normalize();
    ray.set(origin, dir);
    ray.far = 6.5;

    // Prefer explicit collidables, but fall back to scene children if missing.
    let targets = this.getCollidables?.() || [];
    if(!targets || !targets.length){
      try{ targets = this.scene?.children || []; }catch{ targets = []; }
    }

    const hits = ray.intersectObjects(targets, true);
    if(hits && hits.length) return hits[0];
    return null;
  }

  _validateLadderPlacement(hit){
    if(!hit || !hit.point || !hit.normal) return false;
    // 1) Must be near-vertical wall
    if(Math.abs(hit.normal.y) > 0.2) return false;

    const base = hit.point.clone();

    // 2) Ground check under base
    const gRay = new THREE.Raycaster(base.clone().add(new THREE.Vector3(0, 0.25, 0)), new THREE.Vector3(0, -1, 0), 0, 3.0);
    const gHits = gRay.intersectObjects(this.getCollidables?.() || [], true);
    if(!gHits || !gHits.length) return false;
    const g = gHits[0];
    if(!g.normal || g.normal.y < 0.85) return false;
    base.copy(g.point);

    // 3) Height clamp (hard anti-map-break)
    const h = clamp(this.ladder.height, 2.5, 5.5);

    // 4) Wall continuity probes (prevents placing through gaps / out of bounds)
    const n = hit.normal.clone().normalize();
    const inward = n.clone().multiplyScalar(-1);
    const probeRay = new THREE.Raycaster();
    const samples = [0.2, h*0.5, h-0.2];
    for(const y of samples){
      const p = base.clone().add(new THREE.Vector3(0, y, 0));
      probeRay.set(p, inward);
      probeRay.far = 0.55;
      const ph = probeRay.intersectObjects(this.getCollidables?.() || [], true);
      if(!ph || !ph.length) return false;
    }

    // Save
    this.ladder.base.copy(base);
    this.ladder.normal.copy(n);
    this.ladder.height = h;
    return true;
  }

  _updateLadderPreview(dt){
    // Only for sniper and only when ladder is active
    if(this.profile?.classId !== 'sniper'){
      if(this.ladder.placing) this._setLadderPlacing(false);
      return;
    }
    if(this.profile?.isDead){
      if(this.ladder.placing) this._setLadderPlacing(false);
      return;
    }
    const active = this._isLadderEquipped();
    if(!active){
      if(this.ladder.placing) this._setLadderPlacing(false);
      return;
    }

    // When ladder item is selected, we always show preview mode.
    this._setLadderPlacing(true);
    this._ensureLadderPreview();
    const hit = this._raycastWallForLadder();
    // HF1: Keep preview visible even when placement is invalid or no wall is hit.
    try{
      if(hit && hit.point){
        this.ladder.base.copy(hit.point);
        if(hit.normal) this.ladder.normal.copy(hit.normal).normalize();
      }else{
        const po = this.getPlayerObject?.();
        const base = po?.position ? po.position : new THREE.Vector3();
        const fwd = new THREE.Vector3();
        this.camera?.getWorldDirection?.(fwd);
        fwd.normalize();
        this.ladder.base.copy(base).add(fwd.multiplyScalar(2.0));
        this.ladder.normal.set(0,0,1);
      }
    }catch{}
    const ok = this._validateLadderPlacement(hit);
    this.ladder.valid = !!ok;

    if(this.ladder.preview){
      this.ladder.preview.visible = true;
      const m = this.ladder.preview;
      m.position.copy(this.ladder.base).add(new THREE.Vector3(0, this.ladder.height*0.5, 0));
      // face inward (so it hugs the wall)
      const face = this.ladder.base.clone().add(this.ladder.normal.clone().multiplyScalar(-1));
      m.lookAt(face);
      // green when valid, red when invalid
      const mat = m.material;
      if(mat && mat.color){
        mat.color.setHex(ok ? 0x00ff88 : 0xff3344);
        mat.opacity = ok ? 0.35 : 0.25;
      }
    }
  }

  _buildLadderMesh(){
    const h = this.ladder.height;
    const group = new THREE.Group();
    group.name = 'ladder';
    const railGeom = new THREE.CylinderGeometry(0.035, 0.035, h, 10);
    const rungGeom = new THREE.CylinderGeometry(0.025, 0.025, 0.38, 10);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.55, metalness: 0.35 });
    const left = new THREE.Mesh(railGeom, mat);
    const right = new THREE.Mesh(railGeom, mat);
    left.position.set(-0.16, h*0.5, 0);
    right.position.set(0.16, h*0.5, 0);
    group.add(left, right);
    const rungCount = 8;
    for(let i=0;i<rungCount;i++){
      const t = (i+1)/(rungCount+1);
      const rung = new THREE.Mesh(rungGeom, mat);
      rung.rotation.z = Math.PI/2;
      rung.position.set(0, h*t, 0);
      group.add(rung);
    }
    return group;
  }

  _placeLadder(){
    if(!this.ladder.valid) return false;
    try{ if(this.ladder.mesh) this.scene?.remove?.(this.ladder.mesh); }catch{}
    const mesh = this._buildLadderMesh();
    mesh.position.copy(this.ladder.base);
    mesh.position.y += 0.0;
    const face = this.ladder.base.clone().add(this.ladder.normal.clone().multiplyScalar(-1));
    mesh.lookAt(face);
    this.scene?.add?.(mesh);
    this.ladder.mesh = mesh;
    this.onSound?.('swap');
    return true;
  }

  _useLadder(){
    if(this.profile?.classId !== 'sniper') return false;
    // Left-click confirms placement while ladder is selected.
    return this._placeLadder();
  }

  // Returns climb assist info. game.html may choose to apply it to PlayerController.
  getClimbAssist(input, dt){
    if(!this.ladder.mesh) return { active:false };
    if(this.profile?.isDead) return { active:false };
    const po = this.getPlayerObject?.();
    if(!po) return { active:false };
    const moveZ = input?.moveZ ?? 0;
    if(Math.abs(moveZ) < 0.15) return { active:false };

    // Compute distance to ladder base in XZ
    const p = po.position;
    const base = this.ladder.base;
    const dx = p.x - base.x;
    const dz = p.z - base.z;
    const distXZ = Math.hypot(dx, dz);
    if(distXZ > 0.85) return { active:false };

    // Climb speed
    const climbSpeed = 3.2;
    const dir = moveZ > 0 ? 1 : -1; // W => +, S => -
    const deltaY = dir * climbSpeed * (dt || 0);
    return { active:true, deltaY, lockXZ:true };
  }

  // ===== Internal helpers =====
  _isBinocularEquipped(){
    const inv = this.profile?.inventory;
    const a = this.profile?.activeSlot;
    if(!inv || !a || a.type !== 'classItem') return false;
    return inv.classItems?.[a.index] === 'binocular';
  }

  _applyBinoFov(on){
    if(!this.camera) return;
    if(typeof this.bino.baseFov !== 'number') this.bino.baseFov = (this.camera.fov || 75);
    if(!on){
      this.camera.fov = this.bino.baseFov;
    }else{
      this.camera.fov = this.bino.baseFov / this.bino.zoom;
    }
    this.camera.updateProjectionMatrix?.();
  }

  _useAmmoPack(){
    if(this.profile?.classId !== 'support') return false;
    if(!this.ammoRefill) return false;
    const ok = this.ammoRefill.refill({ primary:true, secondary:true, delaySec:3, statusText:'보급중..' });
    if(ok) this.onSound?.('ammo_pack');
    return ok;
  }

  _startReload(st, sec){
    if(!st) return false;
    if(st.reloading) return false;
    if(st.chamber === 1) return false;
    if((st.reserve|0) <= 0) return false;
    st.reloading = true;
    st.reload = sec;
    return true;
  }

  _usePanzer(){
    if(this.profile?.classId !== 'assault') return false;
    const s = this._ensureState();
    const st = s?.panzer;
    if(!st) return false;
    if(st.reloading) return false;
    const total = (st.reserve|0) + (st.chamber|0);
    if(total <= 0) return false;
    if(st.chamber <= 0){
      // auto reload
      this._startReload(st, 2.5);
      return false;
    }
    // Fire (projectile: straight + slight arc)
    st.chamber = 0;
    this.onSound?.('swap'); // placeholder
    this._spawnProj({ type:'panzer', speed:46, up:1.6, gravity:-10, ttl:4.0, color:0xffe2b0 });

    // auto reload if still has reserve
    this._startReload(st, 2.5);
    return true;
  }

  _useHealSmoke(){
    if(this.profile?.classId !== 'medic') return false;
    const s = this._ensureState();
    const st = s?.healSmoke;
    if(!st) return false;
    if(st.reloading) return false;
    const total = (st.reserve|0) + (st.chamber|0);
    if(total <= 0) return false;
    if(st.chamber <= 0){
      this._startReload(st, 3.0);
      return false;
    }
    st.chamber = 0;
    this.onSound?.('grenade_smoke');
    // Fire (projectile)
    this._spawnProj({ type:'healSmoke', speed:28, up:2.3, gravity:-14, ttl:5.0, color:0xb7f3ff });

    this._startReload(st, 3.0);
    return true;
  }

  _placeMine(){
    if(this.profile?.classId !== 'support') return false;
    const s = this._ensureState();
    if(!s) return false;
    if((s.mineLoaded|0) <= 0) return false;
    const p = this._raycastGroundAhead();
    if(!p) return false;
    s.mineLoaded = 0;

    // Visual: black round object (disk)
    const geom = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 18);
    const mat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95, metalness: 0.08 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(p);
    mesh.position.y += 0.04;
    mesh.name = 'landmine';
    this.scene?.add?.(mesh);
    // TODO Patch 9+: trigger + explosion when enemy enters radius
    this.onSound?.('mine_place');
    return true;
  }

  _toggleBinocular(){
    if(this.profile?.classId !== 'sniper') return false;
    // No action on left-click; binocular uses ADS aim. Return true so input edge doesn't re-fire.
    return true;
  }

  _raycastForward(){
    if(!this.camera) return null;
    const ray = new THREE.Raycaster();
    const origin = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.normalize();
    ray.set(origin, dir);
    ray.far = 80;
    const hits = ray.intersectObjects(this.getCollidables?.() || [], true);
    if(hits && hits.length){
      return hits[0].point.clone();
    }
    // fallback: some point in front
    return origin.add(dir.multiplyScalar(28));
  }

  _raycastGroundAhead(){
    const po = this.getPlayerObject?.();
    if(!po) return null;
    // ahead point
    const forward = new THREE.Vector3();
    if(this.camera){
      this.camera.getWorldDirection(forward);
    }else{
      forward.set(0,0,-1);
    }
    forward.y = 0;
    forward.normalize();
    const start = po.position.clone().add(forward.multiplyScalar(1.35));
    start.y += 2.0;

    const ray = new THREE.Raycaster(start, new THREE.Vector3(0,-1,0), 0, 6);
    const hits = ray.intersectObjects(this.getCollidables?.() || [], true);
    if(hits && hits.length){
      return hits[0].point.clone();
    }
    // fallback flat
    start.y = po.position.y;
    return start;
  }
}