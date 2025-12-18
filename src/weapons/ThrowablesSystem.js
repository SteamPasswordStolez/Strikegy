// src/weapons/ThrowablesSystem.js
// Patch 7-4A (Refine): Throwables (parabolic throw + gravity + bounce)
// - Gravity + simple bounce + friction
// - Impact detonates on first collision
// - Smoke: particle cloud (THREE.Points) + optional mild blur overlay
// - Flash: angle-based whiteout + ringing
// - Teamkill/self-damage OFF by design (damage callback optional)

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js";

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();
const _tmpN = new THREE.Vector3();

const COS_60 = Math.cos(THREE.MathUtils.degToRad(60));

function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function lerp(a,b,t){ return a + (b-a)*t; }

function isMobileUA(){
  try{ return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }catch{ return false; }
}

// Visual helpers (no external textures)
function makeGrenadeMesh(kind="GEN", color=0xffffff, size=0.085){
  const g = new THREE.Group();

  // Body
  const bodyGeo = new THREE.SphereGeometry(size, 18, 14);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = false;
  body.receiveShadow = false;
  g.add(body);

  // Small cap / pin hint
  const capGeo = new THREE.CylinderGeometry(size*0.35, size*0.35, size*0.35, 10);
  const capMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6, metalness: 0.2 });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.set(0, size*0.75, 0);
  cap.rotation.z = Math.PI * 0.5;
  g.add(cap);

  // Ring (flash/impact) 
  if(kind === "FLASH" || kind === "IMPACT" || kind === "SMOKE"){
    const ringGeo = new THREE.TorusGeometry(size*0.55, size*0.10, 8, 16);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.35, metalness: 0.35 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(0, -size*0.15, 0);
    ring.rotation.x = Math.PI * 0.5;
    g.add(ring);
  }

  g.userData.__radius = size;
  return g;
}

function makePulseMesh(color=0xffaa55){
  const geo = new THREE.SphereGeometry(0.25, 14, 14);
  const mat = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.55, depthWrite:false });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 999;
  return m;
}

function makeRingMesh(color=0xffffff){
  const geo = new THREE.RingGeometry(0.2, 0.28, 28);
  const mat = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.85, depthWrite:false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 999;
  return m;
}

function makeSoftParticleTexture(){
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32,32,0, 32,32,32);
  g.addColorStop(0.00, "rgba(255,255,255,0.95)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1.00, "rgba(255,255,255,0.00)");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,64,64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function makeNoiseAlphaTexture(){
  const c = document.createElement("canvas");
  c.width = 96; c.height = 96;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(c.width, c.height);
  for(let i=0;i<img.data.length;i+=4){
    // soft cloudy noise
    const v = Math.floor(140 + Math.random()*115); // 140..255
    img.data[i+0] = v;
    img.data[i+1] = v;
    img.data[i+2] = v;
    img.data[i+3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // slightly blur by drawing scaled
  const c2 = document.createElement("canvas");
  c2.width = 96; c2.height = 96;
  const ctx2 = c2.getContext("2d");
  ctx2.globalAlpha = 0.85;
  ctx2.drawImage(c, 0, 0);
  ctx2.globalAlpha = 0.55;
  ctx2.drawImage(c, -6, -4);
  ctx2.drawImage(c,  4,  6);

  const tex = new THREE.CanvasTexture(c2);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.6, 1.6);
  tex.needsUpdate = true;
  return tex;
}


export default class ThrowablesSystem{
  constructor(opts){
    this.camera = opts?.camera || null;
    this.scene = opts?.scene || null;
    this.getCollidables = opts?.getCollidables || (()=>[]);
    this.getPlayerPosition = opts?.getPlayerPosition || null;

    this.onSound = opts?.onSound || null;
    this.onDamage = opts?.onDamage || null;           // optional (future)
    this.onCameraKick = opts?.onCameraKick || null;   // (pitch, yaw)
    this.onOverlay = opts?.onOverlay || null;         // ({smoke, flash})
    this.onLookLock = opts?.onLookLock || null;       // (seconds) freeze look input

    this.isMobile = opts?.isMobile ?? isMobileUA();

    // Throw tuning
    this.throwPower = 16.5;
    this.throwUpBoost = 3.8;

    // Physics
    this.gravity = new THREE.Vector3(0, -18.0, 0); // tuned for small maps
    this.restitution = 0.35;
    this.friction = 0.35;
    this.stopSpeed = 1.35;

    this.maxLifetime = 10.0; // safety cleanup

    this._ray = new THREE.Raycaster();

    this._holding = false;
    this._holdGrenadeId = null;
    this._holdSlotIndex = -1;

    // {id, fuse, age, pos, vel, ang, stuck, mesh, impact, kind, radius}
    this._projectiles = [];

    // Smoke volumes (for mild overlay) + particle clouds
    // _smokes: {pos, radius, t, cloud}
    this._smokes = [];

    // Flashes: {base, t, dur}
    this._flashes = [];

    // Shakes: {t, dur, pitchAmp, yawAmp}
    this._shakes = [];

    // Shakes: {t, dur, ampPitch, ampYaw}
    this._shakes = [];

    // Visual pulses/rings
    this._pulses = []; // {mesh, t, dur}
    this._rings = [];  // {mesh, t, dur, grow}

    // Particle texture cache
    this._softTex = null;
  }

  beginHold(grenadeId, slotIndex=0){
    if(!grenadeId) return false;
    this._holding = true;
    this._holdGrenadeId = String(grenadeId);
    this._holdSlotIndex = slotIndex|0;
    this.onSound?.("throw_pin");
    return true;
  }

  cancelHold(){
    this._holding = false;
    this._holdGrenadeId = null;
    this._holdSlotIndex = -1;
  }

  get holding(){ return this._holding; }
  get holdGrenadeId(){ return this._holdGrenadeId; }
  get holdSlotIndex(){ return this._holdSlotIndex; }

  releaseThrow(grenadeId, slotIndex=0){
    if(!this._holding) return false;
    if(!grenadeId) return false;

    const id = String(grenadeId);
    const idx = slotIndex|0;
    this._holding = false;
    this._holdGrenadeId = null;
    this._holdSlotIndex = -1;

    const cam = this.camera;
    const scn = this.scene;
    if(!cam || !scn) return false;

    const origin = _v0.setFromMatrixPosition(cam.matrixWorld);
    cam.getWorldDirection(_tmpDir);
    _tmpDir.normalize();

    const right = _v1.set(1,0,0).applyQuaternion(cam.quaternion);
    const up = _v2.set(0,1,0).applyQuaternion(cam.quaternion);

    // spawn slightly in front/right so it doesn't clip camera
    const pos = origin.clone()
      .add(_tmpDir.clone().multiplyScalar(0.70))
      .add(right.clone().multiplyScalar(0.14))
      .add(up.clone().multiplyScalar(-0.10));

    const spec = this._specFor(id);

    // parabolic: forward + slight up
    const vel = _tmpDir.clone().multiplyScalar(this.throwPower)
      .add(up.clone().multiplyScalar(this.throwUpBoost));

    const mesh = makeGrenadeMesh(spec.kind, spec.color, spec.size);
    mesh.position.copy(pos);
    mesh.name = `throw_${id}`;
    scn.add(mesh);

    this._projectiles.push({
      id,
      slotIndex: idx,
      fuse: spec.fuse,
      age: 0,
      pos,
      vel,
      ang: new THREE.Vector3(
        (Math.random()*2-1) * 8,
        (Math.random()*2-1) * 10,
        (Math.random()*2-1) * 8
      ),
      stuck: false,
      mesh,
      impact: !!spec.impact,
      kind: spec.kind,
      radius: spec.size,
      bounces: 0,
    });

    this.onSound?.("throw_cast");
    return true;
  }

  _specFor(id){
    switch(String(id)){
      case "frag":
        // Fuse (final): 2.5s
        return { fuse: 2.5, color: 0xffb347, size: 0.085, impact:false, kind:"HE" };
      case "smoke":
        // Fuse (final): 1.2s
        return { fuse: 1.2, color: 0xbfd6ff, size: 0.085, impact:false, kind:"SMOKE" };
      case "flash":
        // Fuse (final): 3.0s
        return { fuse: 3.0, color: 0xffffff, size: 0.080, impact:false, kind:"FLASH" };
      case "impact":
        return { fuse: 0.0, color: 0xa7fffb, size: 0.080, impact:true,  kind:"IMPACT" };
      default:
        return { fuse: 1.2, color: 0xffffff, size: 0.080, impact:false, kind:"HE" };
    }
  }

  update(dt){
    // pulses
    for(let i=this._pulses.length-1;i>=0;i--){
      const p = this._pulses[i];
      p.t += dt;
      const t = clamp01(p.t / p.dur);
      if(typeof p.update === "function"){
        // custom VFX (e.g. shrapnel burst)
        try{ p.update(dt, t); }catch{}
      }else{
        p.mesh.scale.setScalar(lerp(1.0, 3.2, t));
        if(p.mesh.material) p.mesh.material.opacity = lerp(0.55, 0.0, t);
      }
      if(p.t >= p.dur){
        if(typeof p.dispose === "function"){
          try{ p.dispose(); }catch{}
        }else{
          try{ this.scene?.remove?.(p.mesh); }catch{}
        }
        this._pulses.splice(i,1);
      }
    }

    // rings
    for(let i=this._rings.length-1;i>=0;i--){
      const r = this._rings[i];
      r.t += dt;
      const t = clamp01(r.t / r.dur);
      const s = lerp(1.0, r.grow, t);
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = lerp(0.85, 0.0, t);
      if(r.t >= r.dur){
        try{ this.scene?.remove?.(r.mesh); }catch{}
        this._rings.splice(i,1);
      }
    }

    // projectiles
    for(let i=this._projectiles.length-1;i>=0;i--){
      const g = this._projectiles[i];
      g.age += dt;

      if(g.age > this.maxLifetime){
        this._removeProjectile(i);
        continue;
      }

      if(!g.stuck){
        // integrate
        g.vel.addScaledVector(this.gravity, dt);

        const step = _v0.copy(g.vel).multiplyScalar(dt);
        const dist = step.length();

        // spin a bit (visual only)
        g.mesh.rotation.x += g.ang.x * dt;
        g.mesh.rotation.y += g.ang.y * dt;
        g.mesh.rotation.z += g.ang.z * dt;

        if(dist > 1e-6){
          const dir = step.clone().multiplyScalar(1/dist);
          this._ray.set(g.pos, dir);
          this._ray.far = dist + g.radius;
          const hits = this._ray.intersectObjects(this.getCollidables(), true);
          if(hits && hits.length){
            const hit = hits[0];
            const hp = hit.point;

            g.pos.copy(hp);
            g.mesh.position.copy(g.pos);

            // world normal
            _tmpN.set(0,1,0);
            if(hit.face){
              _tmpN.copy(hit.face.normal);
              const nrm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
              _tmpN.applyMatrix3(nrm).normalize();
            }

	            if(g.impact){
	              // Impact grenade: detonate only when it hits the ground ("바닥에 떨어지자마자")
	              // Wall hits should bounce, then it will explode on the first ground contact.
	              if(_tmpN.y > 0.35){
	                this._detonate(g);
	                this._removeProjectile(i);
	                continue;
	              }
	              // else: treat as a normal bounce below
	            }

            // bounce
            const v = g.vel;
            const vn = _tmpN.clone().multiplyScalar(v.dot(_tmpN));
            const vt = v.clone().sub(vn);

            // reflect normal component
            const reflN = vn.multiplyScalar(-this.restitution);
            // friction reduces tangential component
            vt.multiplyScalar(Math.max(0, 1 - this.friction));

            v.copy(vt.add(reflN));

            g.bounces++;
            this.onSound?.("grenade_bounce");

            // stop if too slow
            if(v.length() < this.stopSpeed || g.bounces >= 6){
              g.stuck = true;
              g.vel.set(0,0,0);
            }
          }else{
            g.pos.add(step);
            g.mesh.position.copy(g.pos);
          }
        }
      }

      // fuse
      if(!g.impact){
        g.fuse -= dt;
        if(g.fuse <= 0){
          this._detonate(g);
          this._removeProjectile(i);
          continue;
        }
      }
    }

    // smokes (volume + particles)
    for(let i=this._smokes.length-1;i>=0;i--){
      const s = this._smokes[i];
      s.t -= dt;

      // update particle cloud
      s.cloud?.update?.(dt);

	      // drive volume opacity (fade in/out) + dynamic volume motion
      if(s.volume?.setOpacity){
        const life = 9.5;
        const age = Math.max(0, life - s.t);
        const fadeIn = 0.20;
        const fadeOut = 1.25;

        let o = s.baseOpacity ?? 0.92;

        if(age < fadeIn){
          o *= clamp01(age / fadeIn);
        }
        if(s.t < fadeOut){
          o *= clamp01(s.t / fadeOut);
        }
        // keep it very dense
	        s.volume.setOpacity(Math.min(0.99, o));
      }
	      // Dynamic "shader" motion even while fading
	      s.volume?.update?.(dt);

      if(s.t <= 0){
        s.cloud?.dispose?.();
        s.volume?.dispose?.();
        this._smokes.splice(i,1);
      }
    }

    // flashes
    for(let i=this._flashes.length-1;i>=0;i--){
      const f = this._flashes[i];
      f.t -= dt;
      if(f.t <= 0) this._flashes.splice(i,1);
    }

    // shakes (camera-only; input lock handled separately)
    for(let i=this._shakes.length-1;i>=0;i--){
      const s = this._shakes[i];
      s.t -= dt;
      const t = clamp01(s.t / s.dur);
      // ease out; very noisy shake
      const ampP = s.pitchAmp * (t*t);
      const ampY = s.yawAmp * (t*t);
      if(ampP > 0.0001 || ampY > 0.0001){
        this.onCameraKick?.(
          (Math.random()*2-1) * ampP,
          (Math.random()*2-1) * ampY
        );
      }
      if(s.t <= 0) this._shakes.splice(i,1);
    }

    // overlay sampling
    const playerPos = this.getPlayerPosition ? this.getPlayerPosition() : null;
    let smoke = 0;
    if(playerPos){
      for(const s of this._smokes){
        const d = playerPos.distanceTo(s.pos);
        const t = 1 - (d / Math.max(0.001, s.radius));
        smoke = Math.max(smoke, clamp01(t));
      }
    }

	    // make smoke feel *extremely* dense (near total vision block)
	    smoke = Math.min(1, Math.pow(smoke * 1.55, 0.42));

    let flash = 0;
    for(const f of this._flashes){
      // Hold full white for a moment, then fade.
      const elapsed = Math.max(0, f.dur - f.t);
      const hold = f.hold || 0;
      if(elapsed < hold){
        flash = Math.max(flash, f.base);
      }else{
        const fadeDur = Math.max(0.001, f.dur - hold);
        const t = clamp01(f.t / fadeDur);
        flash = Math.max(flash, f.base * (t*t));
      }
    }

    this.onOverlay?.({ smoke, flash });
  }

  // ---- VFX helpers (lightweight; no external textures) ----
  _spawnShrapnelBurst(pos, {count=48, speed=18, life=0.65} = {}){
    if(!this.scene) return;
    const geo = new THREE.BoxGeometry(0.018, 0.006, 0.006);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent:true, opacity: 0.95, depthWrite:false });
    const group = new THREE.Group();
    group.position.copy(pos);
    group.renderOrder = 999;
    this.scene.add(group);

    const pieces = [];
    for(let i=0;i<count;i++){
      const m = new THREE.Mesh(geo, mat);
      // random direction on a sphere
      const u = Math.random()*2-1;
      const a = Math.random()*Math.PI*2;
      const r = Math.sqrt(1-u*u);
      const dir = new THREE.Vector3(Math.cos(a)*r, u, Math.sin(a)*r).normalize();
      const v = dir.multiplyScalar(speed * (0.55 + Math.random()*0.65));
      m.position.set(0,0,0);
      m.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      group.add(m);
      pieces.push({ m, v });
    }

    this._pulses.push({
      mesh: group,
      t: 0,
      dur: life,
      update: (dt, tNorm)=>{
        // integrate fragments
        for(const p of pieces){
          p.v.y += -22 * dt;
          p.m.position.x += p.v.x * dt;
          p.m.position.y += p.v.y * dt;
          p.m.position.z += p.v.z * dt;
          p.m.rotation.x += (p.v.x*0.08) * dt;
          p.m.rotation.y += (p.v.y*0.06) * dt;
          p.m.rotation.z += (p.v.z*0.08) * dt;
        }
        // fade
        group.traverse((o)=>{
          if(o.material && o.material.opacity != null) o.material.opacity = lerp(0.95, 0.0, tNorm);
        });
      },
      dispose: ()=>{
        try{ this.scene?.remove?.(group); }catch{}
        try{ geo.dispose?.(); }catch{}
        try{ mat.dispose?.(); }catch{}
      }
    });
  }

  _removeProjectile(i){
    const g = this._projectiles[i];
    try{ this.scene?.remove?.(g.mesh); }catch{}
    this._projectiles.splice(i,1);
  }

  _detonate(g){
    const id = String(g.id);

    // core pulse
    const pulse = makePulseMesh(id === "flash" ? 0xffffff : (id === "smoke" ? 0x9fb6ff : 0xffb347));
    pulse.position.copy(g.pos);
    this.scene?.add?.(pulse);
    if(id === "frag") pulse.scale.setScalar(1.45);
    this._pulses.push({ mesh: pulse, t:0, dur: (id==="frag" ? 0.28 : 0.20) });

    // ring (helps read detonation)
    const ring = makeRingMesh(id === "flash" ? 0xffffff : (id === "smoke" ? 0x9fb6ff : 0xffd29b));
    ring.position.copy(g.pos);
    ring.lookAt(this.camera ? _v0.setFromMatrixPosition(this.camera.matrixWorld) : _v0.set(0,0,0));
    this.scene?.add?.(ring);
    const grow = (id==="flash" ? 10 : (id==="frag" ? 14 : 6));
    this._rings.push({ mesh: ring, t:0, dur: (id==="frag" ? 0.34 : 0.28), grow });

    if(id === "frag"){
      this.onSound?.("grenade_explode");
      // Big explosion: stronger ring + shrapnel burst
      this._spawnShrapnelBurst(g.pos, { count: this.isMobile ? 36 : 64, speed: 22, life: 0.75 });
      // Secondary blast ring ("펑" 느낌)
      try{
        const r2 = makeRingMesh(0xffc37a);
        r2.position.copy(g.pos);
        r2.lookAt(this.camera ? _v0.setFromMatrixPosition(this.camera.matrixWorld) : _v0.set(0,0,0));
        this.scene?.add?.(r2);
        this._rings.push({ mesh: r2, t:0, dur: 0.42, grow: 22 });
      }catch{}
      this._applyExplosionDamage({ pos: g.pos, radius: 6, max: 120, min: 20 });
      // Stronger shake
      this._shakes.push({ t: 0.55, dur: 0.55, pitchAmp: 0.18, yawAmp: 0.22 });
      this._cameraKickNear({ pos: g.pos, radius: 6, maxPitch: 0.22, maxYaw: 0.18 });
      return;
    }

    if(id === "smoke"){
      this.onSound?.("grenade_smoke");
      // Wider + denser (final tuning)
      const SMOKE_RADIUS = 11.6;
      const cloud = this._spawnSmokeCloud(g.pos, SMOKE_RADIUS);
      const volume = this._spawnSmokeVolume(g.pos, SMOKE_RADIUS);
      // 9.5s duration: near-total vision block inside/outside
      this._smokes.push({ pos: g.pos.clone(), radius: SMOKE_RADIUS, t: 9.5, cloud, volume, baseOpacity: 0.975 });
      return;
    }

    if(id === "flash"){
      this.onSound?.("grenade_flash");
      this._applyFlashToLocal({ pos: g.pos });
      return;
    }

    if(id === "impact"){
      this.onSound?.("grenade_impact");
      // Impact grenade: primarily disorienting, but can finish low-HP targets.
      // (Patch 8 PRO+ tuning) Make it meaningfully dangerous at very close range.
      this._applyExplosionDamage({ pos: g.pos, radius: 4.6, max: 80, min: 18 });
      // Disorient: lock look for ~1.2s + strong shake
      this.onLookLock?.(1.2);
      this._shakes.push({ t: 1.2, dur: 1.2, pitchAmp: 0.20, yawAmp: 0.32 });
      this._cameraKickNear({ pos: g.pos, radius: 4.6, maxPitch: 0.16, maxYaw: 0.26 });
      return;
    }

    this.onSound?.("grenade_explode");
  }

  // Patch 7-4B: allow other systems (class items) to reuse detonation FX safely.
  // NOTE: This is a *visual + local-damage* helper. Balance numbers come from the id's preset.
  triggerDetonation(id, pos){
    if(!pos) return false;
    const p = (pos.clone ? pos.clone() : pos);
    // Fake projectile payload for _detonate.
    const g = { id: String(id), pos: p };
    try{ this._detonate(g); }catch(e){ console.warn('triggerDetonation failed', e); return false; }
    return true;
  }

	_spawnSmokeCloud(pos, radius=11.6){
    if(!this.scene) return null;
    if(!this._softTex){
      try{ this._softTex = makeSoftParticleTexture(); }catch{ this._softTex = null; }
    }

	    // Dense cloud: aim to make the inside / through-smoke nearly opaque.
	    // Scale particle budget slightly with radius (kept bounded for perf).
	    const base = this.isMobile ? 1100 : 2600;
	    const rMul = Math.max(0.9, Math.min(1.25, radius / 11.6));
	    const count = Math.floor(base * rMul);
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocity = new Float32Array(count * 3);
    const size = new Float32Array(count);

    for(let i=0;i<count;i++){
	      // spawn inside a sphere scaled to the smoke radius
	      const r = Math.random() * (radius * 0.11);
      const a = Math.random() * Math.PI * 2;
	      const h = (Math.random()*2 - 1) * (radius * 0.045);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = h;

      positions[i*3+0] = pos.x + x;
      positions[i*3+1] = pos.y + y;
      positions[i*3+2] = pos.z + z;

	      // gentle outward + upward drift (scaled with radius)
	      const drift = 0.28 + Math.random()*0.55;
	      const vx = x * drift + (Math.random()*2-1) * 0.16;
	      const vz = z * drift + (Math.random()*2-1) * 0.16;
	      const vy = (0.42 + Math.random()*0.85);
      velocity[i*3+0] = vx;
      velocity[i*3+1] = vy;
      velocity[i*3+2] = vz;

	      size[i] = this.isMobile ? (14 + Math.random()*22) : (18 + Math.random()*30);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

    const mat = new THREE.PointsMaterial({
      color: 0x9fb6ff,
      size: 0.55,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      map: this._softTex || null,
      alphaMap: this._softTex || null,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 998;

    this.scene.add(points);

    const cloud = {
      t: 0,
      fadeIn: 0.35,
      life: 9.5,
      points,
      geo,
      positions,
      velocity,
      update: (dt)=>{
        cloud.t += dt;
        const alive = Math.max(0, cloud.life - cloud.t);

        // opacity: fade in then ease out
        const oIn = clamp01(cloud.t / cloud.fadeIn);
        // keep opaque most of the time; fade out only near the end
        const oOut = clamp01(alive / 2.8);
	        // Keep it extremely dense ("외부에서 보이지 않을 정도")
	        points.material.opacity = Math.min(0.995, oIn * oOut * 1.18);

        // expand + drift
        for(let i=0;i<count;i++){
          const ix = i*3;
          positions[ix+0] += velocity[ix+0] * dt;
          positions[ix+1] += velocity[ix+1] * dt;
          positions[ix+2] += velocity[ix+2] * dt;

          // slight turbulence
          velocity[ix+0] += (Math.random()*2-1) * 0.04 * dt;
          velocity[ix+2] += (Math.random()*2-1) * 0.04 * dt;

          // slow down over time
          const damp = 1 - (dt * 0.06);
          velocity[ix+0] *= damp;
          velocity[ix+1] *= damp;
          velocity[ix+2] *= damp;
        }
        geo.attributes.position.needsUpdate = true;
      },
      dispose: ()=>{
        try{ (points.parent||null)?.remove?.(points); }catch{}
        try{ geo.dispose?.(); }catch{}
        try{ points.material.dispose?.(); }catch{}
      }
    };

	    // register + return so the caller can manage lifetime
	    this._smokeClouds?.push?.(cloud);
	    return cloud;
	  }

	  _spawnSmokeVolume(pos, radius){
    if(!this.scene) return null;
    if(!this._noiseTex){
      try{ this._noiseTex = makeNoiseAlphaTexture(); }catch{ this._noiseTex = null; }
    }

    const detail = this.isMobile ? 1 : 2;
    const geo = new THREE.IcosahedronGeometry(radius, detail);

	    const mat = new THREE.MeshBasicMaterial({
	      color: 0x6a6a6a,
	      transparent: true,
	      opacity: 0.975,
	      // depthWrite ON makes the volume "really" block what's behind it
	      depthWrite: true,
	      depthTest: true,
	      side: THREE.DoubleSide
	    });

    // "shader-ish" cloudy breakup without custom GLSL
	    if(this._noiseTex){
	      mat.alphaMap = this._noiseTex;
	      mat.alphaTest = 0.04;
	      mat.alphaMap.needsUpdate = true;
	    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.frustumCulled = false;
    mesh.renderOrder = 997; // behind particles but still covers

    this.scene.add(mesh);

	    let tPhase = 0;
	    return {
      mesh,
      geo,
      mat,
	      baseOpacity: 0.975,
	      setOpacity: (o)=>{ mat.opacity = o; },
	      // Dynamic "shader-like" motion: swirl the alpha texture + slow volume rotation
	      update: (dt)=>{
	        tPhase += dt;
	        if(mat.alphaMap){
	          // subtle UV drift
	          mat.alphaMap.offset.x = (mat.alphaMap.offset.x + dt*0.06) % 1;
	          mat.alphaMap.offset.y = (mat.alphaMap.offset.y + dt*0.045) % 1;
	          // micro breathing opacity variation
	          // (final opacity still controlled by setOpacity in the smoke loop)
	          mat.alphaMap.rotation = Math.sin(tPhase*0.55) * 0.08;
	        }
	        mesh.rotation.y += dt * 0.18;
	        mesh.rotation.x += dt * 0.06;
	      },
      dispose: ()=>{
        try{ (mesh.parent||null)?.remove?.(mesh); }catch{}
        try{ geo.dispose?.(); }catch{}
        try{ mat.dispose?.(); }catch{}
      }
    };
  }

  _applyExplosionDamage({pos, radius, max, min}){
    // Teamkill/self-damage OFF by spec.
    if(typeof this.onDamage !== "function") return;
    this.onDamage({ pos, radius, max, min });
  }

  _cameraKickNear({pos, radius, maxPitch, maxYaw}){
    if(typeof this.onCameraKick !== "function") return;
    const playerPos = this.getPlayerPosition ? this.getPlayerPosition() : null;
    if(!playerPos) return;
    const d = playerPos.distanceTo(pos);
    if(d > radius) return;
    const t = 1 - (d / Math.max(0.001, radius));
    const pitch = maxPitch * t;
    const yaw = (Math.random()*2-1) * maxYaw * t;
    this.onCameraKick(pitch, yaw);
  }

  _applyFlashToLocal({pos}){
    const cam = this.camera;
    if(!cam) return;

    // Final tuning: small radius so thrower isn't constantly self-flashed
    const FLASH_RADIUS = 10.0;

    const camPos = _v0.setFromMatrixPosition(cam.matrixWorld);
    const d = camPos.distanceTo(pos);
    if(d > FLASH_RADIUS) return;

    const to = _v1.copy(pos).sub(camPos);
    if(to.lengthSq() < 1e-6) return;
    to.normalize();

    cam.getWorldDirection(_tmpDir);
    _tmpDir.normalize();

    // Strong flash only if within ~60� cone total (�30�)
    const COS_30 = Math.cos(THREE.MathUtils.degToRad(30));
    const dot = _tmpDir.dot(to);
    const strong = dot >= COS_30;

    const dur = strong ? 1.2 : 0.4;
    // Bright enough to fully whiteout. Consumer clamps to 1.
    const base = strong ? 2.2 : 1.2;
    const hold = strong ? 0.35 : 0.18;

    this._flashes.push({ base, t: dur, dur, hold });

    // ear ring / aftershock
    this.onSound?.(strong ? "flash_ring_strong" : "flash_ring_weak");
  }
}
