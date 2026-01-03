import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { WEAPONS } from "../weapons/WeaponData.js";

// Patch 2-FP (Core): First-person viewmodel system
// - Low-poly gloves hands
// - Procedural placeholder weapon meshes per weapon class
// - Idle/Sway/Bob/ADS/Recoil + simple reload pose
//
// Why procedural meshes?
// 1) GitHub Pages friendly (no asset pipeline required)
// 2) Stable placeholders you can later replace with real models (glTF)

const clamp = (n, a, b)=> Math.max(a, Math.min(b, n));
const lerp = (a,b,t)=> a + (b-a)*t;

function weaponClassFromId(id){
  const s = String(id||"").toLowerCase();
  if(s.startsWith("ar")) return "AR";
  if(s.startsWith("smg")) return "SMG";
  if(s.startsWith("lmg")) return "LMG";
  if(s.startsWith("sg")) return "SG";
  if(s.startsWith("dmr")) return "DMR";
  if(s.startsWith("sr")) return "SR";
  if(s.startsWith("p") || s.startsWith("pistol") || s=== "pistol1" || s === "mp1") return "PISTOL";
  return "AR";
}

function makeStdMat(hex, rough=0.65, metal=0.05){
  const m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
  // Viewmodel: always on top, no depth interaction.
  m.depthTest = false;
  m.depthWrite = false;
  return m;
}

function tagViewModelObject(obj){
  obj.traverse?.((o)=>{
    if(o && o.isMesh){
      o.frustumCulled = false;
      o.renderOrder = 999;
      // Ensure viewmodel meshes never cast/receive world shadows.
      o.castShadow = false;
      o.receiveShadow = false;
      if(o.material){
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for(const m of mats){
          if(m){ m.depthTest = false; m.depthWrite = false; }
        }
      }
    }
  });
}

function makeLowPolyGloveHands(){
  const root = new THREE.Group();
  root.name = "vm_hands";

  const glove = makeStdMat(0x1b1f26, 0.9, 0.05);
  const pad   = makeStdMat(0x2a313c, 0.85, 0.06);

  // simple palm + thumb + finger block = readable silhouette
  function makeHand(side=1){
    const g = new THREE.Group();

    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.18), glove);
    palm.position.set(0, 0, 0);
    g.add(palm);

    const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.03, 0.08), pad);
    knuckle.position.set(0, 0.03, -0.02);
    g.add(knuckle);

    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.04, 0.13), glove);
    fingers.position.set(0, -0.005, -0.14);
    g.add(fingers);

    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.08), glove);
    thumb.position.set(0.065 * side, -0.01, -0.03);
    thumb.rotation.y = -0.6 * side;
    g.add(thumb);

    // wrist/forearm stub
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.18, 8), glove);
    arm.position.set(0, -0.08, 0.08);
    arm.rotation.x = Math.PI/2;
    g.add(arm);

    // mirror
    g.scale.x = side;
    return g;
  }

  const right = makeHand(1);
  const left  = makeHand(-1);

  // Default rifle hold stance (tuned in ViewModelSystem poses)
  right.position.set(0.15, -0.16, -0.22);
  right.rotation.set(-0.10, 0.15, 0.10);

  left.position.set(-0.14, -0.17, -0.18);
  left.rotation.set(-0.15, -0.18, -0.05);

  root.add(left, right);
  tagViewModelObject(root);
  return { root, left, right };
}

function makeProceduralWeaponMesh(kind="AR", weaponId=""){
  const root = new THREE.Group();
  root.name = `vm_weapon_${kind}`;

  const body = makeStdMat(0x2b2f36, 0.55, 0.10);
  const dark = makeStdMat(0x171a1f, 0.85, 0.05);
  const metal= makeStdMat(0x8c939d, 0.30, 0.80);

  const add = (mesh)=>{ root.add(mesh); return mesh; };

  // Common sizes (scaled per class)
  const scale = {
    AR: 1.0,
    SMG: 0.88,
    LMG: 1.10,
    SG: 0.98,
    DMR: 1.05,
    SR: 1.12,
    PISTOL: 0.60,
    GRENADE: 0.45,
    KNIFE: 0.55,
    GADGET: 0.70,
  }[kind] || 1.0;

  const wid = String(weaponId||"").toLowerCase();
  const grenadeType = (wid.includes("impact") ? "IMPACT" : (wid.includes("smoke") ? "SMOKE" : (wid.includes("flash") || wid.includes("stun") ? "FLASH" : "FRAG")));

  if(kind === "PISTOL"){
    const frame = add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.26), body));
    frame.position.set(0, 0, 0);
    const slide = add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.05, 0.20), dark));
    slide.position.set(0, 0.04, -0.02);
    const grip = add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.10, 0.10), dark));
    grip.position.set(0, -0.07, 0.08);
    grip.rotation.x = 0.25;
    const muzzle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.06, 10), metal));
    muzzle.rotation.x = Math.PI/2;
    muzzle.position.set(0, 0.03, -0.14);
  }else if(kind === "GRENADE"){
    // Four distinct throwable silhouettes: FRAG / FLASH / SMOKE / IMPACT
    if(grenadeType === "FRAG"){
      // "pineapple"-ish frag
      const g = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.085, 1), body));
      g.position.set(0, 0, 0);
      const band = add(new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 14), metal));
      band.rotation.x = Math.PI/2;
      band.position.set(0, 0.02, 0);
      const lever = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.01), metal));
      lever.position.set(0.03, 0.10, 0.00);
      lever.rotation.z = 0.25;
      const pin = add(new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.055, 8), metal));
      pin.rotation.z = Math.PI/2;
      pin.position.set(0.055, 0.085, 0);
    }else if(grenadeType === "FLASH"){
      // short can w/ vent holes
      const can = add(new THREE.Mesh(new THREE.CylinderGeometry(0.060, 0.060, 0.12, 16), body));
      can.rotation.x = Math.PI/2;
      can.position.set(0, 0.01, 0);
      const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.015, 16), metal));
      cap.rotation.x = Math.PI/2;
      cap.position.set(0, 0.02, 0.06);
      const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.040, 0.007, 6, 12), metal));
      ring.rotation.x = Math.PI/2;
      ring.position.set(0.04, 0.04, 0.06);
      // fake vents (tiny studs)
      for(let i=0;i<6;i++){
        const a = (i/6)*Math.PI*2;
        const v = add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.01, 8), metal));
        v.rotation.x = Math.PI/2;
        v.position.set(Math.cos(a)*0.05, Math.sin(a)*0.05, -0.02);
      }
    }else if(grenadeType === "SMOKE"){
      // taller can w/ top nozzle
      const can = add(new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.16, 16), body));
      can.rotation.x = Math.PI/2;
      can.position.set(0, 0.01, 0);
      const top = add(new THREE.Mesh(new THREE.CylinderGeometry(0.050, 0.050, 0.02, 14), metal));
      top.rotation.x = Math.PI/2;
      top.position.set(0, 0.02, 0.09);
      const nozzle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.020, 0.03, 12), metal));
      nozzle.rotation.x = Math.PI/2;
      nozzle.position.set(0, 0.03, 0.105);
      const tape = add(new THREE.Mesh(new THREE.TorusGeometry(0.057, 0.006, 6, 18), dark));
      tape.rotation.x = Math.PI/2;
      tape.position.set(0, -0.02, 0.00);
    }else{
      // IMPACT: front sensor cap + side lugs
      const bodyCan = add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.060, 0.14, 16), body));
      bodyCan.rotation.x = Math.PI/2;
      bodyCan.position.set(0, 0.01, 0);
      const sensor = add(new THREE.Mesh(new THREE.SphereGeometry(0.040, 12, 12), metal));
      sensor.position.set(0, 0.02, -0.08);
      const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.02, 16), metal));
      cap.rotation.x = Math.PI/2;
      cap.position.set(0, 0.02, 0.08);
      const lug1 = add(new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.02, 0.04), dark));
      lug1.position.set(0.06, 0.00, 0.02);
      const lug2 = lug1.clone();
      lug2.position.x = -0.06;
      root.add(lug2);
    }
  }else if(kind === "KNIFE"){
    const blade = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.26), metal));
    blade.position.set(0, 0.02, -0.10);
    const hilt = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.06), dark));
    hilt.position.set(0, 0, 0.05);
    const grip = add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.020, 0.10, 8), dark));
    grip.rotation.x = Math.PI/2;
    grip.position.set(0, -0.01, 0.10);
  }else if(kind === "GADGET"){
    const box = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.18), body));
    box.position.set(0, 0, 0);
    const screen = add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.01), metal));
    screen.position.set(0, 0.02, -0.095);
    const knob = add(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 10), dark));
    knob.position.set(0.06, -0.02, 0.06);
  }else{
    // Rifle-like baseline: receiver + barrel + stock + grip + mag
    const receiver = add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.42), body));
    receiver.position.set(0, 0.01, -0.02);

    const barrel = add(new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.020, 0.46, 12), metal));
    barrel.rotation.x = Math.PI/2;
    barrel.position.set(0, 0.03, -0.36);

    const stock = add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.18), dark));
    stock.position.set(0, 0.02, 0.24);
    stock.rotation.x = 0.03;

    const grip = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.08), dark));
    grip.position.set(0, -0.08, 0.10);
    grip.rotation.x = 0.30;

    const magH = (kind === "LMG") ? 0.16 : 0.13;
    const mag = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, magH, 0.10), body));
    mag.position.set(0, -0.10, -0.02);
    mag.rotation.x = -0.12;

    // class flavor bits (silhouette boosters)
    if(kind === "AR"){
      const handguard = add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.20), dark));
      handguard.position.set(0, 0.00, -0.22);
      const sight = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.05), metal));
      sight.position.set(0, 0.07, 0.10);
    }
    if(kind === "SMG"){
      // shorter barrel + chunkier mag
      barrel.scale.y = 0.75;
      barrel.position.z += 0.10;
      mag.scale.y = 0.9;
      mag.scale.z = 0.7;
      mag.position.z += 0.02;
      const shroud = add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.16), dark));
      shroud.position.set(0, 0.01, -0.16);
    }
    if(kind === "SR"){
      const scope = add(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.22, 12), dark));
      scope.rotation.x = Math.PI/2;
      scope.position.set(0, 0.075, 0.02);
      const bolt = add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 8), metal));
      bolt.rotation.z = Math.PI/2;
      bolt.position.set(0.08, 0.03, 0.12);
      const brake = add(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 12), metal));
      brake.rotation.x = Math.PI/2;
      brake.position.set(0, 0.03, -0.58);
    }
    if(kind === "SG"){
      // pump + tube magazine
      const pump = add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.20), dark));
      pump.position.set(0, -0.02, -0.30);
      const tube = add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.40, 10), metal));
      tube.rotation.x = Math.PI/2;
      tube.position.set(0.03, -0.02, -0.34);
      barrel.scale.y = 0.90;
      barrel.position.z -= 0.05;
    }
    if(kind === "LMG"){
      const top = add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.035, 0.26), dark));
      top.position.set(0, 0.075, -0.02);
      const box = add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.12), body));
      box.position.set(0.10, -0.12, -0.02);
      const bipodL = add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 6), metal));
      bipodL.rotation.x = Math.PI/2;
      bipodL.rotation.z = 0.35;
      bipodL.position.set(0.06, -0.05, -0.44);
      const bipodR = bipodL.clone();
      bipodR.position.x = -0.06;
      bipodR.rotation.z = -0.35;
      root.add(bipodR);
    }
  }

  root.scale.setScalar(scale);
  tagViewModelObject(root);
  return root;
}

export default class ViewModelSystem{
  constructor({ camera, weaponSystem, getActiveSlot, getInventory }){
    this.camera = camera;
    this.weaponSystem = weaponSystem;
    this.getActiveSlot = typeof getActiveSlot === "function" ? getActiveSlot : ()=> null;
    this.getInventory = typeof getInventory === "function" ? getInventory : ()=> null;

    this.root = new THREE.Group();
    this.root.name = "viewmodel_root";
    // Attach to camera so it follows viewpoint without world jitter.
    this.camera.add(this.root);

    // Weapon placeholder root (weapon-space). Hands are parented under weaponRoot so they
    // never "separate" from the weapon when we move/rotate the viewmodel.
    this.weaponRoot = new THREE.Group();
    this.weaponRoot.name = "vm_weapon_root";
    this.root.add(this.weaponRoot);

    // Weapon mesh holder (we clear/rebuild this only)
    this.weaponMeshHolder = new THREE.Group();
    this.weaponMeshHolder.name = "vm_weapon_mesh_holder";
    this.weaponRoot.add(this.weaponMeshHolder);

    // Hands (kept persistent; positioned in weapon local space)
    const hands = makeLowPolyGloveHands();
    this.handsRoot = hands.root;
    this.handL = hands.left;
    this.handR = hands.right;
    this.handsRoot.position.set(0,0,0);
    this.handsRoot.rotation.set(0,0,0);
    this.weaponRoot.add(this.handsRoot);

    this._currentVMKind = null;
    this._currentWeaponId = null;

    // motion state
    this.time = 0;
    this.adsAlpha = 0;
    this.reloadAlpha = 0;
    this._prevReloading = false;
    this._kickPos = new THREE.Vector3();
    this._kickRot = new THREE.Vector3();

    this._sway = new THREE.Vector2(0,0);
    this._bob = 0;
    this.visible = true;

    // initial build
    this._rebuildForActiveSlot();
    this._applyPoseImmediate();
  }

  _applyHandsPose(kind){
    // Hands are defined relative to weapon root. This keeps them glued to the weapon.
    // Values are simple placeholders: you can later replace with IK/attachments.
    const set = (obj, p, r)=>{
      obj.position.set(p[0], p[1], p[2]);
      obj.rotation.set(r[0], r[1], r[2]);
    };

    const poses = {
      // rifle-ish
      AR: {
        R: { p:[ 0.03, -0.11,  0.11], r:[-0.12,  0.18,  0.08] },
        L: { p:[-0.04, -0.10, -0.20], r:[-0.10, -0.22, -0.06] },
      },
      SMG: {
        R: { p:[ 0.03, -0.11,  0.10], r:[-0.13,  0.20,  0.08] },
        L: { p:[-0.04, -0.10, -0.18], r:[-0.11, -0.24, -0.06] },
      },
      LMG: {
        R: { p:[ 0.03, -0.12,  0.12], r:[-0.12,  0.18,  0.10] },
        L: { p:[-0.05, -0.11, -0.22], r:[-0.10, -0.22, -0.06] },
      },
      SG: {
        R: { p:[ 0.03, -0.12,  0.12], r:[-0.10,  0.18,  0.10] },
        L: { p:[-0.05, -0.10, -0.26], r:[-0.10, -0.20, -0.06] },
      },
      DMR: {
        R: { p:[ 0.03, -0.11,  0.11], r:[-0.12,  0.18,  0.08] },
        L: { p:[-0.05, -0.10, -0.22], r:[-0.10, -0.22, -0.06] },
      },
      SR: {
        R: { p:[ 0.03, -0.12,  0.12], r:[-0.10,  0.16,  0.08] },
        L: { p:[-0.05, -0.10, -0.24], r:[-0.10, -0.20, -0.06] },
      },

      // pistol / tools
      PISTOL: {
        R: { p:[ 0.02, -0.10,  0.08], r:[-0.10,  0.22,  0.10] },
        L: { p:[-0.02, -0.09,  0.00], r:[-0.10, -0.12, -0.06] },
      },
      GRENADE: {
        R: { p:[ 0.03, -0.09,  0.02], r:[-0.18,  0.24,  0.10] },
        L: { p:[-0.03, -0.09,  0.02], r:[-0.18, -0.24, -0.10] },
      },
      KNIFE: {
        R: { p:[ 0.03, -0.10,  0.10], r:[-0.10,  0.20,  0.12] },
        L: { p:[-0.12, -0.16, -0.10], r:[-0.12, -0.10, -0.20] },
      },
      GADGET: {
        R: { p:[ 0.05, -0.09,  0.06], r:[-0.12,  0.18,  0.10] },
        L: { p:[-0.05, -0.09,  0.06], r:[-0.12, -0.18, -0.10] },
      },
    };

    const key = poses[kind] ? kind : "AR";
    set(this.handR, poses[key].R.p, poses[key].R.r);
    set(this.handL, poses[key].L.p, poses[key].L.r);
  }

  setVisible(v){
    this.visible = !!v;
    this.root.visible = this.visible;
  }

  // --- external events ---
  onShot(payload){
    // small kick (decays in update)
    const wid = payload?.weaponId || this.weaponSystem?.currentId || "";
    const kind = weaponClassFromId(wid);
    const ads = !!(payload?.isADS ?? this.weaponSystem?.isADS);

    // tuned per class
    const base = {
      AR:   { pos:0.010, rot:0.020 },
      SMG:  { pos:0.009, rot:0.018 },
      LMG:  { pos:0.013, rot:0.024 },
      SG:   { pos:0.018, rot:0.030 },
      DMR:  { pos:0.015, rot:0.026 },
      SR:   { pos:0.020, rot:0.032 },
      PISTOL:{pos:0.010, rot:0.022 },
    }[kind] || { pos:0.010, rot:0.020 };

    const mul = ads ? 0.55 : 1.0;
    this._kickPos.z -= base.pos * mul;
    this._kickRot.x -= base.rot * mul;
    this._kickRot.y += (Math.random()*2-1) * base.rot * 0.35 * mul;
  }

  // --- internal: decide which viewmodel should be shown ---
  _rebuildForActiveSlot(){
    const a = this.getActiveSlot?.();
    const inv = this.getInventory?.();

    let kind = "AR";
    let weaponId = this.weaponSystem?.currentId || "pistol1";

    if(a?.type === "grenade"){
      kind = "GRENADE";
      weaponId = inv?.grenades?.[a.index|0] || "grenade";
    }else if(a?.type === "classItem"){
      kind = "GADGET";
      weaponId = inv?.classItems?.[a.index|0] || "gadget";
    }else if(a?.type === "melee"){
      kind = "KNIFE";
      weaponId = "knife";
    }else{
      // gun (primary/secondary)
      kind = weaponClassFromId(weaponId);
    }

    if(kind === this._currentVMKind && weaponId === this._currentWeaponId) return;

    // clear previous weapon mesh only (hands stay parented under weaponRoot)
    while(this.weaponMeshHolder.children.length){
      this.weaponMeshHolder.remove(this.weaponMeshHolder.children[0]);
    }
    const mesh = makeProceduralWeaponMesh(kind, weaponId);
    this.weaponMeshHolder.add(mesh);

    // keep hands glued to the new weapon class pose
    this._applyHandsPose(kind);

    this._currentVMKind = kind;
    this._currentWeaponId = weaponId;
  }

  _poseFor(kind){
    // These are tuned for a 75~80 FOV baseline.
    // Each pose contains: basePos/baseRot, adsPos/adsRot
    const poses = {
      AR: {
        basePos: new THREE.Vector3(0.18, -0.20, -0.36),
        baseRot: new THREE.Euler(-0.15, 0.22, 0.06),
        adsPos:  new THREE.Vector3(0.02, -0.16, -0.22),
        adsRot:  new THREE.Euler(-0.08, 0.05, 0.00),
      },
      SMG: {
        basePos: new THREE.Vector3(0.18, -0.20, -0.33),
        baseRot: new THREE.Euler(-0.16, 0.25, 0.06),
        adsPos:  new THREE.Vector3(0.03, -0.16, -0.21),
        adsRot:  new THREE.Euler(-0.09, 0.06, 0.00),
      },
      LMG: {
        basePos: new THREE.Vector3(0.20, -0.22, -0.38),
        baseRot: new THREE.Euler(-0.14, 0.24, 0.08),
        adsPos:  new THREE.Vector3(0.03, -0.17, -0.23),
        adsRot:  new THREE.Euler(-0.08, 0.06, 0.00),
      },
      SG: {
        basePos: new THREE.Vector3(0.20, -0.22, -0.36),
        baseRot: new THREE.Euler(-0.12, 0.24, 0.08),
        adsPos:  new THREE.Vector3(0.03, -0.17, -0.22),
        adsRot:  new THREE.Euler(-0.06, 0.06, 0.00),
      },
      DMR: {
        basePos: new THREE.Vector3(0.20, -0.21, -0.38),
        baseRot: new THREE.Euler(-0.14, 0.22, 0.06),
        adsPos:  new THREE.Vector3(0.02, -0.17, -0.23),
        adsRot:  new THREE.Euler(-0.07, 0.04, 0.00),
      },
      SR: {
        basePos: new THREE.Vector3(0.22, -0.22, -0.40),
        baseRot: new THREE.Euler(-0.12, 0.22, 0.06),
        adsPos:  new THREE.Vector3(0.02, -0.17, -0.24),
        adsRot:  new THREE.Euler(-0.06, 0.03, 0.00),
      },
      PISTOL: {
        basePos: new THREE.Vector3(0.18, -0.22, -0.28),
        baseRot: new THREE.Euler(-0.12, 0.20, 0.06),
        adsPos:  new THREE.Vector3(0.05, -0.18, -0.20),
        adsRot:  new THREE.Euler(-0.06, 0.05, 0.00),
      },
      GRENADE: {
        basePos: new THREE.Vector3(0.14, -0.20, -0.26),
        baseRot: new THREE.Euler(-0.10, 0.20, 0.06),
        adsPos:  new THREE.Vector3(0.14, -0.20, -0.26),
        adsRot:  new THREE.Euler(-0.10, 0.20, 0.06),
      },
      KNIFE: {
        basePos: new THREE.Vector3(0.18, -0.24, -0.26),
        baseRot: new THREE.Euler(-0.12, 0.20, 0.06),
        adsPos:  new THREE.Vector3(0.18, -0.24, -0.26),
        adsRot:  new THREE.Euler(-0.12, 0.20, 0.06),
      },
      GADGET: {
        basePos: new THREE.Vector3(0.16, -0.22, -0.26),
        baseRot: new THREE.Euler(-0.10, 0.20, 0.06),
        adsPos:  new THREE.Vector3(0.16, -0.22, -0.26),
        adsRot:  new THREE.Euler(-0.10, 0.20, 0.06),
      },
    };
    return poses[kind] || poses.AR;
  }

  _applyPoseImmediate(){
    const pose = this._poseFor(this._currentVMKind || "AR");
    this.weaponRoot.position.copy(pose.basePos);
    this.weaponRoot.rotation.copy(pose.baseRot);
    this.root.position.set(0,0,0);
    this.root.rotation.set(0,0,0);
  }

  update(dt, inputState, ctx={}){
    if(!this.visible) return;
    this.time += dt;

    // Decide which model should be active (gun/grenade/melee/class)
    this._rebuildForActiveSlot();

    const a = this.getActiveSlot?.();
    const holdingGun = !!a && (a.type === "primary" || a.type === "secondary");

    // ADS (gun only)
    const targetADS = (holdingGun && !!this.weaponSystem?.isADS) ? 1 : 0;
    const adsT = 1 - Math.exp(-18 * dt);
    this.adsAlpha = this.adsAlpha + (targetADS - this.adsAlpha) * adsT;

    // Reload pose blend (gun only)
    const reloading = (holdingGun && !!this.weaponSystem?.isReloading);
    const targetReload = reloading ? 1 : 0;
    const rT = 1 - Math.exp(-12 * dt);
    this.reloadAlpha = this.reloadAlpha + (targetReload - this.reloadAlpha) * rT;

    // Movement intensity for bob
    const mx = Number(inputState?.moveX || 0);
    const mz = Number(inputState?.moveZ || 0);
    const moveLen = Math.min(1, Math.hypot(mx, mz));
    const sprint = !!inputState?.sprintHeld;
    const bobSpeed = (sprint ? 10.5 : 8.0) * (0.25 + 0.75 * moveLen);
    this._bob += dt * bobSpeed;

    // Look sway (small lag behind look delta)
    const ldx = Number(inputState?.lookDX || 0);
    const ldy = Number(inputState?.lookDY || 0);
    const swayTargetX = clamp(-ldx * 0.0009, -0.08, 0.08);
    const swayTargetY = clamp(-ldy * 0.0009, -0.06, 0.06);
    const sT = 1 - Math.exp(-20 * dt);
    this._sway.x = lerp(this._sway.x, swayTargetX, sT);
    this._sway.y = lerp(this._sway.y, swayTargetY, sT);

    // Recoil decay
    const kT = 1 - Math.exp(-22 * dt);
    this._kickPos.lerp(new THREE.Vector3(0,0,0), kT);
    this._kickRot.lerp(new THREE.Vector3(0,0,0), kT);

    // Base pose blend (hip -> ads)
    const pose = this._poseFor(this._currentVMKind || "AR");
    const px = lerp(pose.basePos.x, pose.adsPos.x, this.adsAlpha);
    const py = lerp(pose.basePos.y, pose.adsPos.y, this.adsAlpha);
    const pz = lerp(pose.basePos.z, pose.adsPos.z, this.adsAlpha);

    // Reload pulls weapon slightly down/right
    const rx = px + this.reloadAlpha * 0.06;
    const ry = py - this.reloadAlpha * 0.06;
    const rz = pz + this.reloadAlpha * 0.04;

    this.weaponRoot.position.set(rx, ry, rz);

    // Rotation blend
    const ex = lerp(pose.baseRot.x, pose.adsRot.x, this.adsAlpha);
    const ey = lerp(pose.baseRot.y, pose.adsRot.y, this.adsAlpha);
    const ez = lerp(pose.baseRot.z, pose.adsRot.z, this.adsAlpha);

    // Bob (position only, subtle)
    const bobA = moveLen * (sprint ? 0.020 : 0.013) * (1 - 0.65 * this.adsAlpha);
    const bobX = Math.sin(this._bob) * bobA;
    const bobY = Math.abs(Math.cos(this._bob * 2.0)) * bobA * 0.55;

    // Apply final transform to root (sway/bob/recoil)
    this.root.position.set(
      this._sway.x * 0.25 + bobX * 0.35 + this._kickPos.x,
      this._sway.y * 0.20 - bobY * 0.60 + this._kickPos.y,
      0 + this._kickPos.z
    );
    this.root.rotation.set(
      ex + this._sway.y * 0.10 + this._kickRot.x,
      ey + this._sway.x * 0.08 + this._kickRot.y,
      ez + this._kickRot.z
    );

    // Very small weapon micro-jitter to feel "alive"
    const micro = (1 - this.adsAlpha) * 0.0022;
    this.weaponRoot.position.x += Math.sin(this.time * 1.3) * micro;
    this.weaponRoot.position.y += Math.cos(this.time * 1.7) * micro;
  }
}
