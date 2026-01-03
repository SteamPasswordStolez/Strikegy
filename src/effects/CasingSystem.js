import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

// Patch 7-3C: lightweight pooled casing/shell ejection.
// - Max count: configurable (PC 80 / Mobile 30)
// - Lifetime: configurable (default 30s)
// - Simple gravity + ground bounce (no complex collision)

export default class CasingSystem{
  constructor(scene, camera, {maxCount=80, lifeSeconds=30}={}){
    this.scene = scene;
    this.camera = camera;
    this.maxCount = maxCount;
    this.lifeSeconds = lifeSeconds;

    this._items = [];
    this._next = 0;

    // Shared geometry/material for performance
    this._geo = new THREE.CylinderGeometry(0.02, 0.02, 0.07, 10);
    this._mat = new THREE.MeshStandardMaterial({ color: 0xb59b4c, metalness: 0.35, roughness: 0.5 });

    // prewarm pool to maxCount
    for(let i=0;i<this.maxCount;i++) this._items.push(this._makeOne());
  }

  setLimits({maxCount, lifeSeconds}={}){
    if(typeof lifeSeconds === 'number') this.lifeSeconds = lifeSeconds;
    if(typeof maxCount === 'number' && maxCount !== this.maxCount){
      this.maxCount = maxCount;
      // grow pool if needed; shrinking just hides extras
      while(this._items.length < this.maxCount) this._items.push(this._makeOne());
      for(let i=this.maxCount; i<this._items.length; i++){
        this._items[i].mesh.visible = false;
        this._items[i].active = false;
      }
      this._next = 0;
    }
  }

  _makeOne(){
    const mesh = new THREE.Mesh(this._geo, this._mat);
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    return { mesh, vel: new THREE.Vector3(), angVel: new THREE.Vector3(), age: 0, active: false };
  }

  spawn({mode="", weaponId=""}={}){
    if(!this.scene || !this.camera) return;

    // choose item (ring buffer)
    const idx = this._next % this.maxCount;
    this._next++;
    const it = this._items[idx];
    if(!it) return;

    // world origin near camera "ejection port"
    const origin = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const right = new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion);
    const up    = new THREE.Vector3(0,1,0).applyQuaternion(this.camera.quaternion);
    const fwd   = new THREE.Vector3(0,0,-1).applyQuaternion(this.camera.quaternion);

    // base offset: right + a bit down + slight forward
    origin.add(right.clone().multiplyScalar(0.14));
    origin.add(up.clone().multiplyScalar(-0.10));
    origin.add(fwd.clone().multiplyScalar(0.08));

    it.mesh.position.copy(origin);
    it.mesh.rotation.set(
      Math.random()*Math.PI,
      Math.random()*Math.PI,
      Math.random()*Math.PI
    );

    // velocity: toss to the right with a bit upward
    const side = (mode === 'bolt') ? 2.2 : 2.0; // bolt eject reads snappier
    const v = new THREE.Vector3();
    v.add(right.clone().multiplyScalar(side + Math.random()*0.8));
    v.add(up.clone().multiplyScalar(1.2 + Math.random()*0.8));
    v.add(fwd.clone().multiplyScalar(0.3 + Math.random()*0.3));
    // small randomness
    v.add(new THREE.Vector3((Math.random()-0.5)*0.4, (Math.random()-0.5)*0.2, (Math.random()-0.5)*0.4));

    it.vel.copy(v);
    it.angVel.set(
      (Math.random()-0.5)*8,
      (Math.random()-0.5)*10,
      (Math.random()-0.5)*8
    );

    it.age = 0;
    it.active = true;
    it.mesh.visible = true;
    it.mesh.userData.weaponId = weaponId;
  }

  update(dt){
    if(!dt || dt<=0) return;
    const g = -9.8;
    for(let i=0;i<Math.min(this._items.length, this.maxCount); i++){
      const it = this._items[i];
      if(!it.active) continue;

      it.age += dt;
      if(it.age >= this.lifeSeconds){
        it.active = false;
        it.mesh.visible = false;
        continue;
      }

      // integrate
      it.vel.y += g * dt;
      it.mesh.position.addScaledVector(it.vel, dt);
      it.mesh.rotation.x += it.angVel.x * dt;
      it.mesh.rotation.y += it.angVel.y * dt;
      it.mesh.rotation.z += it.angVel.z * dt;

      // cheap ground bounce at y=0
      const yMin = 0.03;
      if(it.mesh.position.y < yMin){
        it.mesh.position.y = yMin;
        if(Math.abs(it.vel.y) > 0.5){
          it.vel.y = -it.vel.y * 0.35;
          it.vel.x *= 0.65;
          it.vel.z *= 0.65;
        }else{
          // settle
          it.vel.y = 0;
          it.vel.x *= 0.92;
          it.vel.z *= 0.92;
          it.angVel.multiplyScalar(0.92);
        }
      }
    }
  }
}
