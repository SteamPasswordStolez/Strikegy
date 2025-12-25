// src/combat/DamageSystem.js
// Patch 8-2A: Minimal damage registry + headshot detection helper.
// - Keeps game logic decoupled from WeaponSystem ray hits.
// - Designed for bots/multiplayer later (damageables registry).
// NOTE: Local player HP is still managed in game.html (CombatOverlayUI + playerHP vars).

export class DamageSystem {
  constructor({ combatUI=null } = {}) {
    this.combatUI = combatUI;
    this._nextId = 1;
    this._byId = new Map();        // id -> entity
    this._meshToId = new WeakMap();// mesh -> id
  }

  register(mesh, {
    team="neutral",
    maxHp=100,
    height=1.8,
    headshotYRatio=0.78,
  } = {}) {
    if(!mesh) return null;
    const id = `dmg_${this._nextId++}`;
    const ent = {
      id,
      mesh,
      team,
      hp: maxHp,
      maxHp,
      height,
      headshotYRatio,
      alive: true,
    };
    this._byId.set(id, ent);

    // Mark this mesh AND its descendants so ray hits can resolve to this entity.
    // IMPORTANT: Do NOT tag parents (Scene/root), or every object in the scene would
    // inherit the same damageableId via parent traversal.
    const tag = (obj)=>{
      try{ obj.userData = obj.userData || {}; }catch{}
      if(obj.userData) obj.userData.damageableId = id;
      this._meshToId.set(obj, id);
    };
    tag(mesh);
    mesh.traverse?.((child)=>{
      if(child && child !== mesh) tag(child);
    });
    return id;
  }

  unregister(id){
    const ent = this._byId.get(id);
    if(!ent) return;
    this._byId.delete(id);
  }

  getEntityById(id){ return this._byId.get(id) || null; }

  getEntityFromHitObject(obj){
    let cur = obj;
    while(cur){
      const id = cur?.userData?.damageableId;
      if(id && this._byId.has(id)) return this._byId.get(id);
      cur = cur.parent;
    }
    return null;
  }

  getDamageableMeshes(){
    // Return only root meshes (raycaster with recursive=true will hit children)
    const arr=[];
    for(const ent of this._byId.values()){
      if(ent?.mesh) arr.push(ent.mesh);
    }
    return arr;
  }

  isHeadshot(hit, ent){
    if(!hit || !ent || !ent.mesh) return false;

    // Explicit region tag wins (useful when we create head hitbox meshes later)
    const region = hit?.object?.userData?.hitRegion;
    if(region === "head") return true;

    const baseY = ent.mesh.position?.y ?? 0;
    const yRel = (hit.point?.y ?? baseY) - baseY;
    const h = Math.max(0.1, Number(ent.height) || 1.8);
    const ratio = Math.max(0.55, Math.min(0.92, Number(ent.headshotYRatio) || 0.78));
    return yRel >= h * ratio;
  }

  applyDamage(id, amount, { weaponId=null, sourceTeam=null, headshot=false } = {}){
    const ent = this._byId.get(id);
    if(!ent || !ent.alive) return { ok:false, reason:"no_entity" };
    const dmg = Math.max(0, Number(amount)||0);
    ent.hp = Math.max(0, ent.hp - dmg);
    if(ent.hp <= 0){
      ent.alive = false;
    }
    return { ok:true, ent, dmg, killed: !ent.alive, weaponId, sourceTeam, headshot };
  }
}
