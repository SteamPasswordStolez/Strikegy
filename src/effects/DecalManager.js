import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

function makeBulletHoleTexture(){
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const ctx = c.getContext("2d");
  ctx.clearRect(0,0,128,128);
  // soft outer
  const g1 = ctx.createRadialGradient(64,64,6, 64,64,58);
  g1.addColorStop(0, "rgba(0,0,0,0.85)");
  g1.addColorStop(0.35, "rgba(0,0,0,0.35)");
  g1.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g1;
  ctx.beginPath(); ctx.arc(64,64,58,0,Math.PI*2); ctx.fill();
  // core
  const g2 = ctx.createRadialGradient(64,64,2, 64,64,18);
  g2.addColorStop(0, "rgba(0,0,0,0.95)");
  g2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g2;
  ctx.beginPath(); ctx.arc(64,64,18,0,Math.PI*2); ctx.fill();

  // tiny debris specks
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  for(let i=0;i<22;i++){
    const a = Math.random()*Math.PI*2;
    const r = 18 + Math.random()*30;
    const x = 64 + Math.cos(a)*r;
    const y = 64 + Math.sin(a)*r;
    ctx.beginPath(); ctx.arc(x,y, 1+Math.random()*2, 0, Math.PI*2); ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export default class DecalManager{
  constructor(scene){
    this.scene=scene;
    this.decals=[];
    this.tex = makeBulletHoleTexture();
    this.geo = new THREE.PlaneGeometry(0.34,0.34);
  }
  add(hit){
    const size = 0.26 + Math.random()*0.14;
    const geo = new THREE.PlaneGeometry(size,size);
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex,
      transparent:true,
      opacity: 0.95,
      depthWrite:false,
    });
    const m=new THREE.Mesh(geo,mat);
    m.name = "decal_bullethole";
    m.position.copy(hit.point).add(hit.face.normal.clone().multiplyScalar(0.012));
    m.lookAt(hit.point.clone().add(hit.face.normal));
    m.rotateZ(Math.random()*Math.PI*2);
    this.scene.add(m);
    this.decals.push({m, t:60, fade:8}); // last 8s fade out
  }
  update(dt){
    this.decals=this.decals.filter(d=>{
      d.t-=dt;
      if(d.t<=0){ this.scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); return false; }
      if(d.t<d.fade){
        d.m.material.opacity = Math.max(0, (d.t/d.fade)*0.95);
      }
      return true;
    });
  }
}
