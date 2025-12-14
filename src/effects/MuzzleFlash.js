import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js";

function makeFlashTexture(){
  const c=document.createElement("canvas"); c.width=64; c.height=64;
  const ctx=c.getContext("2d");
  ctx.clearRect(0,0,64,64);
  const g=ctx.createRadialGradient(32,32,2, 32,32,30);
  g.addColorStop(0,"rgba(255,255,255,0.95)");
  g.addColorStop(0.25,"rgba(255,220,120,0.85)");
  g.addColorStop(0.6,"rgba(255,160,60,0.35)");
  g.addColorStop(1,"rgba(255,120,40,0)");
  ctx.fillStyle=g;
  ctx.beginPath(); ctx.arc(32,32,30,0,Math.PI*2); ctx.fill();
  const tex=new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default class MuzzleFlash{
  constructor(scene,camera){
    this.scene=scene; this.camera=camera;
    this.tex = makeFlashTexture();
    this.mat = new THREE.SpriteMaterial({ map:this.tex, transparent:true, opacity:0.9, depthWrite:false });
    this.items=[];
  }
  spawn(){
    const s=new THREE.Sprite(this.mat.clone());
    s.scale.setScalar(0.25 + Math.random()*0.12);
    const dir=new THREE.Vector3(); this.camera.getWorldDirection(dir);
    const pos=new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    s.position.copy(pos).add(dir.multiplyScalar(0.8));
    this.scene.add(s);
    this.items.push({s, t:0.05});
  }
  update(dt){
    this.items=this.items.filter(it=>{
      it.t-=dt;
      if(it.t<=0){ this.scene.remove(it.s); it.s.material.dispose(); return false; }
      it.s.material.opacity = Math.max(0, it.t/0.05);
      return true;
    });
  }
}
