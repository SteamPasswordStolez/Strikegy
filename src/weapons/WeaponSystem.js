import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js";
import { WEAPONS } from "./WeaponData.js";

export default class WeaponSystem{
  constructor({camera,scene,getCollidables,onWallHit,onSound,onShot}){
    this.camera=camera;
    this.scene=scene;
    this.getCollidables=getCollidables;
    this.onWallHit=onWallHit;
    this.onSound=onSound;
    this.onShot=onShot;

    this.ray=new THREE.Raycaster();

    // per-weapon persistent state
    this.weaponStates = {};
    for(const id in WEAPONS){
      const w = WEAPONS[id];
      this.weaponStates[id] = { mag: w.magSize, reserve: w.reserve };
    }

    this.currentId = "ar1";
    this.current = WEAPONS[this.currentId];

    this.cooldown=0;
    this.dryCooldown=0;
    this.reloadTimer=0;
    this.isReloading=false;
    this.isADS=false;
    this.triggerHeld=false;
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

  startReload(){
    const st = this.weaponStates[this.currentId];
    if(this.isReloading) return;
    if(st.mag >= this.current.magSize) return;
    if(st.reserve <= 0) return;
    this.isReloading=true;
    this.reloadTimer=this.current.reloadTime;
    this.onSound?.("reload");
  }

  update(dt){
    if(this.cooldown>0) this.cooldown=Math.max(0,this.cooldown-dt);
    if(this.dryCooldown>0) this.dryCooldown=Math.max(0,this.dryCooldown-dt);

    if(this.isReloading){
      this.reloadTimer -= dt;
      if(this.reloadTimer<=0){
        const st = this.weaponStates[this.currentId];
        const need = this.current.magSize - st.mag;
        const take = Math.min(need, st.reserve);
        st.mag += take;
        st.reserve -= take;
        this.isReloading=false;
      }
      return;
    }

    if(this.triggerHeld && this.cooldown<=0){
      const st = this.weaponStates[this.currentId];
      if(st.mag>0){
        this._shoot();
      }else if(st.reserve>0){
        this.startReload();
      }else{
        if(this.dryCooldown<=0){
          this.onSound?.("dry");
          this.dryCooldown=0.18;
        }
      }
    }
  }

  _shoot(){
    const st = this.weaponStates[this.currentId];
    st.mag--;
    this.cooldown = 60/this.current.rpm;

    this.onSound?.(this.currentId==="pistol1" ? "pistol_fire" : "ar_fire");
    this.onShot?.();

    const dir=new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const origin=new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    this.ray.set(origin,dir);
    this.ray.far=this.current.range;

    const hits=this.ray.intersectObjects(this.getCollidables(),true);
    if(hits.length) this.onWallHit?.(hits[0]);
  }
}
