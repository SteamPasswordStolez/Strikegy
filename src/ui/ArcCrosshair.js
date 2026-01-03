import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

/**
 * Patch 7-4B: ArcCrosshair (ballistic aiming line)
 * Used by Panzerfaust + Smoke Launcher (class items) when equipped.
 */
export default class ArcCrosshair{
  constructor({scene, camera}){
    this.scene = scene;
    this.camera = camera;

    this.enabled = false;

    this.maxSteps = 36;
    this.step = 0.055;

    this.gravity = 9.81;
    this.power = 22.0;
    this.upBoost = 2.2;

    this._points = new Array(this.maxSteps).fill(0).map(()=>new THREE.Vector3());
    this._geo = new THREE.BufferGeometry();
    this._pos = new Float32Array(this.maxSteps*3);
    this._geo.setAttribute("position", new THREE.BufferAttribute(this._pos, 3));
    this._mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent:true, opacity:0.85, depthWrite:false });
    this._line = new THREE.Line(this._geo, this._mat);
    this._line.frustumCulled = false;
    this._line.visible = false;
    this._line.renderOrder = 999;
    this.scene?.add(this._line);

    // end marker
    this._dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 10, 10),
      new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:0.9, depthWrite:false })
    );
    this._dot.visible = false;
    this._dot.renderOrder = 1000;
    this.scene?.add(this._dot);

    this._tmpO = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
    this._tmpRight = new THREE.Vector3();
    this._tmpUp = new THREE.Vector3();
    this._tmpVel = new THREE.Vector3();
    this._tmpP = new THREE.Vector3();
    this._tmpHit = new THREE.Vector3();
  }

  setEnabled(on){
    this.enabled = !!on;
    this._line.visible = this.enabled;
    this._dot.visible = this.enabled;
  }
  setBallistics({power, upBoost, gravity}){
    if(typeof power==="number") this.power = power;
    if(typeof upBoost==="number") this.upBoost = upBoost;
    if(typeof gravity==="number") this.gravity = gravity;
  }

  update({getCollidables}){
    if(!this.enabled || !this.camera || !this.scene) return;

    const cam = this.camera;
    const origin = this._tmpO.setFromMatrixPosition(cam.matrixWorld);
    cam.getWorldDirection(this._tmpDir).normalize();

    const q = cam.quaternion;
    this._tmpRight.set(1,0,0).applyQuaternion(q);
    this._tmpUp.set(0,1,0).applyQuaternion(q);

    // start slightly forward so it doesn't clip camera
    const start = this._tmpP.copy(origin)
      .add(this._tmpDir.clone().multiplyScalar(0.75))
      .add(this._tmpRight.clone().multiplyScalar(0.14))
      .add(this._tmpUp.clone().multiplyScalar(-0.08));

    // initial vel
    this._tmpVel.copy(this._tmpDir).multiplyScalar(this.power).add(this._tmpUp.clone().multiplyScalar(this.upBoost));

    const cols = getCollidables ? getCollidables() : [];
    let p = start.clone();
    let v = this._tmpVel.clone();
    let hitIndex = this.maxSteps-1;

    for(let i=0;i<this.maxSteps;i++){
      this._points[i].copy(p);
      // integrate
      v.y -= this.gravity * this.step;
      p = p.clone().add(v.clone().multiplyScalar(this.step));

      // cheap collision test: ray from prev to next
      const prev = this._points[i];
      const dir = this._tmpHit.copy(p).sub(prev);
      const dist = dir.length();
      if(dist>0.001 && cols && cols.length){
        dir.normalize();
        const ray = new THREE.Raycaster(prev, dir, 0, dist);
        const hits = ray.intersectObjects(cols, true);
        if(hits && hits.length){
          // stop at hit point
          p.copy(hits[0].point);
          this._points[i].copy(p);
          hitIndex = i;
          break;
        }
      }
    }

    // write positions
    for(let i=0;i<this.maxSteps;i++){
      const pt = this._points[Math.min(i, hitIndex)];
      const k=i*3;
      this._pos[k]=pt.x; this._pos[k+1]=pt.y; this._pos[k+2]=pt.z;
    }
    this._geo.attributes.position.needsUpdate = true;

    const end = this._points[hitIndex];
    this._dot.position.copy(end);
  }

  destroy(){
    this.scene?.remove(this._line);
    this.scene?.remove(this._dot);
    this._geo?.dispose?.();
    this._mat?.dispose?.();
    this._dot?.geometry?.dispose?.();
    this._dot?.material?.dispose?.();
  }
}
