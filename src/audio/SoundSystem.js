export default class SoundSystem{
  constructor(){
    this.ctx = null;
    this.master = null;
    this.enabled = true;

    // HF9-B2: procedural ambience/BGM (no external audio assets)
    this._music = null;   // {state,target,bus,droneGain,pulseGain,nextBeat}
    this._amb = null;     // {preset,targetGain,bus,noise,hum,filters}
  }
  _ensure(){
    if(!this.enabled) return null;
    if(this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if(!Ctx) return null;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }
  _beep({type="sine", f0=200, f1=200, t=0.08, gain=0.8}){
    const ctx=this._ensure(); if(!ctx) return;
    if(ctx.state==="suspended") ctx.resume().catch(()=>{});
    const o=ctx.createOscillator();
    const g=ctx.createGain();
    o.type=type;
    const now=ctx.currentTime;
    o.frequency.setValueAtTime(f0, now);
    o.frequency.linearRampToValueAtTime(f1, now + t);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    o.connect(g); g.connect(this.master);
    o.start(now); o.stop(now + t + 0.01);
  }

  _noiseBurst({t=0.12, gain=0.7, hp=800, lp=80}={}){
    const ctx=this._ensure(); if(!ctx) return;
    if(ctx.state==="suspended") ctx.resume().catch(()=>{});
    const now = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * t));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i] = (Math.random()*2-1) * (1 - i/len);

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = hp;

    const lpF = ctx.createBiquadFilter();
    lpF.type = "lowpass";
    lpF.frequency.value = Math.max(lp, 60);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);

    src.connect(bp); bp.connect(lpF); lpF.connect(g); g.connect(this.master);
    src.start(now);
    src.stop(now + t + 0.02);
  }

  _ring({f=900, t=0.9, gain=0.25}={}){
    const ctx=this._ensure(); if(!ctx) return;
    if(ctx.state==="suspended") ctx.resume().catch(()=>{});
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f, now);
    // slight fall
    o.frequency.exponentialRampToValueAtTime(Math.max(120, f*0.65), now + t);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    o.connect(g); g.connect(this.master);
    o.start(now);
    o.stop(now + t + 0.02);
  }
  unlock(){ this._ensure(); if(this.ctx && this.ctx.state==='suspended'){ this.ctx.resume().catch(()=>{}); } }

  // --- HF9-B2: Music / ambience -------------------------------------------------
  _ensureBuses(){
    const ctx=this._ensure(); if(!ctx) return null;
    if(ctx.state==="suspended") ctx.resume().catch(()=>{});
    if(!this._music){
      const bus = ctx.createGain();
      bus.gain.value = 0.0001;
      bus.connect(this.master);

      const droneGain = ctx.createGain();
      droneGain.gain.value = 0.0001;
      const pulseGain = ctx.createGain();
      pulseGain.gain.value = 0.0001;

      // Drone (two detuned oscillators)
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = 'sine';
      o2.type = 'triangle';
      o1.frequency.value = 55;
      o2.frequency.value = 110;
      o2.detune.value = -8;

      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 1400;

      o1.connect(droneGain);
      o2.connect(droneGain);
      droneGain.connect(filt);
      filt.connect(bus);

      // Pulse (gated square)
      const pulse = ctx.createOscillator();
      pulse.type = 'square';
      pulse.frequency.value = 110;
      const pulseFilt = ctx.createBiquadFilter();
      pulseFilt.type = 'bandpass';
      pulseFilt.frequency.value = 420;
      pulseFilt.Q.value = 0.9;
      pulse.connect(pulseFilt);
      pulseFilt.connect(pulseGain);
      pulseGain.connect(bus);

      try{ o1.start(); o2.start(); pulse.start(); }catch(e){}

      this._music = {
        state: 'none',
        target: 'none',
        bus,
        droneGain,
        pulseGain,
        filt,
        pulseFilt,
        bpm: 96,
        nextBeat: 0,
        _t: 0,
      };
    }

    if(!this._amb){
      const bus = ctx.createGain();
      bus.gain.value = 0.0001;
      bus.connect(this.master);

      // looped noise
      const noiseBuf = this._makeNoiseBuf(1.0);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 600;
      bp.Q.value = 0.6;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      const g = ctx.createGain();
      g.gain.value = 0.18;
      noise.connect(bp); bp.connect(lp); lp.connect(g); g.connect(bus);

      // hum
      const hum = ctx.createOscillator();
      hum.type = 'sine';
      hum.frequency.value = 60;
      const humGain = ctx.createGain();
      humGain.gain.value = 0.0001;
      const humLp = ctx.createBiquadFilter();
      humLp.type = 'lowpass';
      humLp.frequency.value = 180;
      hum.connect(humLp); humLp.connect(humGain); humGain.connect(bus);

      try{ noise.start(); hum.start(); }catch(e){}

      this._amb = {
        preset: 'none',
        targetPreset: 'none',
        bus,
        noise,
        hum,
        g,
        humGain,
        bp,
        lp,
        humLp,
        targetGain: 0.0001,
      };
    }

    return ctx;
  }

  _makeNoiseBuf(seconds=1.0){
    const ctx=this._ensure(); if(!ctx) return null;
    const t=Math.max(0.2, Math.min(2.0, seconds));
    const len=Math.max(1, Math.floor(ctx.sampleRate * t));
    const buf=ctx.createBuffer(1, len, ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<len;i++){
      const k=1 - (i/len);
      d[i]=(Math.random()*2-1) * (0.35 + 0.65*k);
    }
    return buf;
  }

  setMusicState(state='none'){
    this._ensureBuses();
    if(!this._music) return;
    this._music.target = String(state||'none');
  }

  setAmbiencePreset(preset='none'){
    this._ensureBuses();
    if(!this._amb) return;
    this._amb.targetPreset = String(preset||'none');
  }

  // Called from main loop (game.html). Keeps transitions smooth and schedules simple beats.
  update(dt){
    const ctx=this._ensureBuses();
    if(!ctx) return;
    const d = Math.max(0, Math.min(0.05, Number(dt)||0));

    // --- ambience ---
    if(this._amb){
      if(this._amb.preset !== this._amb.targetPreset){
        this._amb.preset = this._amb.targetPreset;
        // Preset tuning (procedural, lightweight)
        const p = String(this._amb.preset||'none');
        let gain = 0.0001;
        if(p==='coast'){
          gain = 0.16;
          this._amb.bp.frequency.value = 420;
          this._amb.lp.frequency.value = 1800;
          this._amb.hum.frequency.value = 48;
          this._amb.humGain.gain.value = 0.018;
          this._amb.humLp.frequency.value = 140;
        }else if(p==='facility'){
          gain = 0.14;
          this._amb.bp.frequency.value = 720;
          this._amb.lp.frequency.value = 2600;
          this._amb.hum.frequency.value = 60;
          this._amb.humGain.gain.value = 0.028;
          this._amb.humLp.frequency.value = 200;
        }else if(p==='city'){
          gain = 0.12;
          this._amb.bp.frequency.value = 980;
          this._amb.lp.frequency.value = 3200;
          this._amb.hum.frequency.value = 50;
          this._amb.humGain.gain.value = 0.012;
          this._amb.humLp.frequency.value = 180;
        }else if(p==='trench'){
          gain = 0.18;
          this._amb.bp.frequency.value = 520;
          this._amb.lp.frequency.value = 1500;
          this._amb.hum.frequency.value = 42;
          this._amb.humGain.gain.value = 0.020;
          this._amb.humLp.frequency.value = 130;
        }else if(p==='escape'){
          gain = 0.10;
          this._amb.bp.frequency.value = 840;
          this._amb.lp.frequency.value = 2400;
          this._amb.hum.frequency.value = 66;
          this._amb.humGain.gain.value = 0.010;
          this._amb.humLp.frequency.value = 220;
        }else{
          gain = 0.0001;
          this._amb.humGain.gain.value = 0.0001;
        }
        this._amb.targetGain = gain;
      }
      // smooth fade
      const g = this._amb.bus.gain;
      const tg = this._amb.targetGain;
      g.value = g.value + (tg - g.value) * Math.min(1, d * 2.5);
    }

    // --- music ---
    if(this._music){
      if(this._music.state !== this._music.target){
        this._music.state = this._music.target;
        const s = String(this._music.state||'none');
        // base tuning
        if(s==='stealth'){
          this._music.bpm = 86;
          this._music.filt.frequency.value = 1100;
          this._music.pulseFilt.frequency.value = 420;
        }else if(s==='combat'){
          this._music.bpm = 120;
          this._music.filt.frequency.value = 1800;
          this._music.pulseFilt.frequency.value = 520;
        }else if(s==='escape'){
          this._music.bpm = 132;
          this._music.filt.frequency.value = 2100;
          this._music.pulseFilt.frequency.value = 640;
        }else if(s==='success'){
          this._music.bpm = 0;
          // quick stinger
          this.play('swap');
          setTimeout(()=>this.play('swap'), 90);
          setTimeout(()=>this.play('swap'), 210);
        }else{
          this._music.bpm = 0;
        }
      }

      const s = String(this._music.state||'none');
      const bus = this._music.bus.gain;
      const dg = this._music.droneGain.gain;
      const pg = this._music.pulseGain.gain;

      let busT=0.0001, dT=0.0001, pT=0.0001;
      if(s==='stealth'){
        busT = 0.070;
        dT = 0.38;
        pT = 0.08;
      }else if(s==='combat'){
        busT = 0.095;
        dT = 0.48;
        pT = 0.22;
      }else if(s==='escape'){
        busT = 0.085;
        dT = 0.36;
        pT = 0.32;
      }else{
        busT = 0.0001;
        dT = 0.0001;
        pT = 0.0001;
      }

      bus.value = bus.value + (busT - bus.value) * Math.min(1, d * 2.0);
      dg.value  = dg.value  + (dT  - dg.value)  * Math.min(1, d * 2.0);
      pg.value  = pg.value  + (pT  - pg.value)  * Math.min(1, d * 3.0);

      // Beat scheduling: simple gate clicks for combat/escape.
      if(this._music.bpm > 0){
        const now = ctx.currentTime;
        if(!this._music.nextBeat) this._music.nextBeat = now + 0.05;
        const interval = 60 / Math.max(30, this._music.bpm);
        while(this._music.nextBeat < now + 0.10){
          if(s==='combat' || s==='escape'){
            // short click
            const o = ctx.createOscillator();
            o.type = 'triangle';
            o.frequency.value = (s==='escape') ? 240 : 200;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, this._music.nextBeat);
            g.gain.exponentialRampToValueAtTime(0.10, this._music.nextBeat + 0.006);
            g.gain.exponentialRampToValueAtTime(0.0001, this._music.nextBeat + 0.05);
            o.connect(g); g.connect(this._music.bus);
            try{ o.start(this._music.nextBeat); o.stop(this._music.nextBeat + 0.06); }catch(e){}
          }
          this._music.nextBeat += interval;
        }
      }else{
        this._music.nextBeat = 0;
      }
    }
  }

  play(name){
    // Synth SFX (stand-in until real assets). Names are stable API keys.
    const r = 0.95 + Math.random()*0.10; // small pitch variation
    const F = (x)=> x*r;
    switch(name){
      // --- UI / generic ---
      case "swap":      return this._beep({type:"sine",     f0:F(520), f1:F(320), t:0.08, gain:0.35});
      case "dry":       return this._beep({type:"triangle", f0:F( 90), f1:F( 60), t:0.06, gain:0.45});

      // --- Patch 7-4A: Throwables ---
      case "throw_pin":     return this._beep({type:"square",   f0:F(620), f1:F(420), t:0.04, gain:0.18});
      case "throw_cast":    return this._beep({type:"sawtooth", f0:F(220), f1:F(140), t:0.07, gain:0.22});
      case "grenade_bounce":  return this._beep({type:"triangle", f0:F(260), f1:F(180), t:0.05, gain:0.22});
      case "grenade_explode":
        this._noiseBurst({t:0.16, gain:0.85, hp:650, lp:120});
        return this._beep({type:"triangle", f0:F(120), f1:F( 55), t:0.18, gain:0.55});
      case "grenade_smoke":
        this._noiseBurst({t:0.22, gain:0.35, hp:420, lp:140});
        return this._beep({type:"sawtooth", f0:F(220), f1:F(110), t:0.14, gain:0.18});
      case "grenade_flash":
        this._noiseBurst({t:0.08, gain:0.45, hp:1400, lp:700});
        return this._beep({type:"sine",     f0:F(980), f1:F(520), t:0.08, gain:0.40});
      case "grenade_impact":
        this._noiseBurst({t:0.10, gain:0.55, hp:900, lp:180});
        return this._beep({type:"triangle", f0:F(180), f1:F( 90), t:0.10, gain:0.35});

      case "flash_ring_strong":
        return this._ring({f:F(1150), t:1.05, gain:0.22});
      case "flash_ring_weak":
        return this._ring({f:F(820), t:0.65, gain:0.16});

      // --- Reloads ---
      case "reload_ar":     return this._beep({type:"sawtooth", f0:F(160), f1:F(110), t:0.18, gain:0.32});
      case "reload_end_ar": return this._beep({type:"square",   f0:F(180), f1:F(120), t:0.06, gain:0.22});
      case "reload_smg":    return this._beep({type:"sawtooth", f0:F(190), f1:F(120), t:0.16, gain:0.30});
      case "reload_end_smg":return this._beep({type:"square",   f0:F(210), f1:F(140), t:0.05, gain:0.21});
      case "reload_lmg":    return this._beep({type:"sawtooth", f0:F(120), f1:F( 80), t:0.22, gain:0.34});
      case "reload_end_lmg":return this._beep({type:"square",   f0:F(150), f1:F(100), t:0.07, gain:0.24});
      case "reload_pistol": return this._beep({type:"sawtooth", f0:F(210), f1:F(140), t:0.14, gain:0.28});
      case "reload_end_pistol": return this._beep({type:"square", f0:F(230), f1:F(150), t:0.05, gain:0.20});
      case "reload_dmr":    return this._beep({type:"sawtooth", f0:F(150), f1:F(100), t:0.20, gain:0.30});
      case "reload_end_dmr":return this._beep({type:"square",   f0:F(170), f1:F(110), t:0.06, gain:0.21});
      case "reload_sg":     return this._beep({type:"sawtooth", f0:F(130), f1:F( 95), t:0.18, gain:0.30});
      case "reload_end_sg": return this._beep({type:"square",   f0:F(150), f1:F(105), t:0.06, gain:0.22});
      case "reload_sr":     return this._beep({type:"sawtooth", f0:F(115), f1:F( 85), t:0.20, gain:0.30});
      case "reload_end_sr": return this._beep({type:"square",   f0:F(135), f1:F( 95), t:0.07, gain:0.22});

      // --- Inserts / cycles (used fully in 7-3C, but keys exist now) ---
      case "insert_sg":  return this._beep({type:"square",   f0:F(260), f1:F(180), t:0.07, gain:0.25});
      case "insert_sr":  return this._beep({type:"square",   f0:F(240), f1:F(160), t:0.08, gain:0.24});
      // Patch 7-3B: make pump/bolt cycle clearly audible (players reported it was too subtle)
      case "cycle_pump": return this._beep({type:"triangle", f0:F(200), f1:F(120), t:0.14, gain:0.42});
      case "cycle_bolt": return this._beep({type:"triangle", f0:F(180), f1:F(100), t:0.15, gain:0.42});

      // --- Weapon fires ---
      case "fire_ar_light":   return this._beep({type:"square",   f0:F(230), f1:F(150), t:0.06, gain:0.70});
      case "fire_ar_heavy":   return this._beep({type:"square",   f0:F(200), f1:F(120), t:0.07, gain:0.72});
      case "fire_smg_fast":   return this._beep({type:"square",   f0:F(320), f1:F(220), t:0.045, gain:0.55});
      case "fire_smg_heavy":  return this._beep({type:"square",   f0:F(280), f1:F(180), t:0.055, gain:0.60});
      case "fire_lmg_light":  return this._beep({type:"square",   f0:F(170), f1:F(110), t:0.075, gain:0.78});
      case "fire_lmg_heavy":  return this._beep({type:"square",   f0:F(150), f1:F( 95), t:0.090, gain:0.82});
      case "fire_sg_light":   return this._beep({type:"sawtooth", f0:F(220), f1:F( 90), t:0.11, gain:0.85});
      case "fire_sg_heavy":   return this._beep({type:"sawtooth", f0:F(200), f1:F( 70), t:0.13, gain:0.90});
      case "fire_dmr_light":  return this._beep({type:"square",   f0:F(210), f1:F(140), t:0.085, gain:0.78});
      case "fire_dmr_heavy":  return this._beep({type:"square",   f0:F(190), f1:F(120), t:0.095, gain:0.82});
      case "fire_sr_light":   return this._beep({type:"triangle", f0:F(180), f1:F( 60), t:0.16, gain:0.92});
      case "fire_sr_heavy":   return this._beep({type:"triangle", f0:F(160), f1:F( 50), t:0.18, gain:0.95});
      case "fire_pistol":     return this._beep({type:"square",   f0:F(340), f1:F(180), t:0.07, gain:0.68});
      case "fire_machine_pistol": return this._beep({type:"square", f0:F(360), f1:F(220), t:0.05, gain:0.58});

      // --- Campaign comms (HF9-A) ---
      case "radio_in":      return this._beep({type:"triangle", f0:F(1200), f1:F(650), t:0.07, gain:0.28});
      case "radio_out":     return this._beep({type:"triangle", f0:F(650), f1:F(1200), t:0.06, gain:0.22});
      case "radio_bleep":   return this._beep({type:"sine",     f0:F(980),  f1:F(980),  t:0.04, gain:0.20});
      case "radio_static":  return this._noiseBurst({t:0.09, gain:0.12, lp:2200, hp:180});
      case "intercom":      return this._beep({type:"square",   f0:F(520),  f1:F(420),  t:0.06, gain:0.22});
      case "whisper":       return this._beep({type:"sine",     f0:F(220),  f1:F(160),  t:0.08, gain:0.12});
      case "comms_urgent":  return this._beep({type:"square",   f0:F(1400), f1:F(900),  t:0.08, gain:0.35});

      // Backward compat keys (older patches)
      case "ar_fire":      return this.play("fire_ar_light");
      case "pistol_fire":  return this.play("fire_pistol");
      case "reload":       return this.play("reload_ar");

      default: return;
    }
  }


  // ==============================
  // HF9-B2: Procedural ambience/BGM
  // ==============================
  _ensureMusic(){
    const ctx = this._ensure();
    if(!ctx) return null;
    if(this._music) return this._music;

    if(ctx.state==="suspended") ctx.resume().catch(()=>{});

    const bus = ctx.createGain();
    bus.gain.value = 0.0;
    bus.connect(this.master);

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.0;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;

    droneGain.connect(lp);
    lp.connect(bus);

    // Two detuned drones (cheap but atmospheric)
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sine';
    o2.type = 'triangle';
    o1.frequency.value = 55;
    o2.frequency.value = 110;
    o2.detune.value = 7;
    const g1 = ctx.createGain();
    const g2 = ctx.createGain();
    g1.gain.value = 0.22;
    g2.gain.value = 0.18;
    o1.connect(g1); g1.connect(droneGain);
    o2.connect(g2); g2.connect(droneGain);
    try{ o1.start(); o2.start(); }catch{}

    // Pulse layer for combat/escape (gated square)
    const pulseGain = ctx.createGain();
    pulseGain.gain.value = 0.0;
    pulseGain.connect(bus);
    const po = ctx.createOscillator();
    po.type = 'square';
    po.frequency.value = 220;
    const pg = ctx.createGain();
    pg.gain.value = 0.0001;
    po.connect(pg);
    pg.connect(pulseGain);
    try{ po.start(); }catch{}

    // Tension noise bed (looped buffer)
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = makeNoiseBuf(ctx, 0.55);
    noiseSrc.loop = true;
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = 900;
    nbp.Q.value = 0.7;
    const nGain = ctx.createGain();
    nGain.gain.value = 0.0;
    noiseSrc.connect(nbp);
    nbp.connect(nGain);
    nGain.connect(bus);
    try{ noiseSrc.start(); }catch{}

    this._music = {
      state: 'none',
      target: 'none',
      bus,
      lp,
      droneGain,
      pulseGain,
      pulseGate: pg,
      tensionGain: nGain,
      bpm: 112,
      nextBeat: 0,
      t: 0,
    };
    return this._music;
  }

  _ensureAmbience(){
    const ctx = this._ensure();
    if(!ctx) return null;
    if(this._amb) return this._amb;
    if(ctx.state==="suspended") ctx.resume().catch(()=>{});

    const bus = ctx.createGain();
    bus.gain.value = 0.0;
    bus.connect(this.master);

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = makeNoiseBuf(ctx, 1.2);
    noiseSrc.loop = true;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 80;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;

    const g = ctx.createGain();
    g.gain.value = 0.0;

    noiseSrc.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(bus);
    try{ noiseSrc.start(); }catch{}

    const humO = ctx.createOscillator();
    humO.type = 'sine';
    humO.frequency.value = 60;
    const humG = ctx.createGain();
    humG.gain.value = 0.0;
    humO.connect(humG);
    humG.connect(bus);
    try{ humO.start(); }catch{}

    this._amb = {
      preset: 'none',
      target: 'none',
      bus,
      noiseGain: g,
      hp,
      lp,
      humGain: humG,
      humOsc: humO,
    };
    return this._amb;
  }

  setMusicState(state='none'){
    const m = this._ensureMusic();
    if(!m) return;
    m.target = String(state||'none').toLowerCase();
  }

  setAmbiencePreset(preset='none'){
    const a = this._ensureAmbience();
    if(!a) return;
    a.target = String(preset||'none').toLowerCase();
  }

  stinger(type='success'){
    // small musical feedback without assets
    const t = String(type||'').toLowerCase();
    if(t==='success'){
      this._beep({type:'sine', f0:760, f1:980, t:0.12, gain:0.22});
      setTimeout(()=> this._beep({type:'sine', f0:980, f1:1170, t:0.12, gain:0.20}), 110);
      return;
    }
    if(t==='fail'){
      this._beep({type:'triangle', f0:320, f1:150, t:0.20, gain:0.26});
      return;
    }
    // checkpoint
    this._beep({type:'triangle', f0:520, f1:620, t:0.08, gain:0.18});
  }

  update(dt=0.016){
    // dt in seconds
    const ctx = this.ctx;
    if(!ctx || !this.master) return;
    const now = ctx.currentTime;

    // --- ambience ---
    const a = this._amb;
    if(a){
      const tgt = a.target || 'none';
      let nGain = 0.0, humGain = 0.0, lpHz = 2200, hpHz = 80, humHz = 60;
      switch(tgt){
        case 'coast':
        case 'beach':
          nGain = 0.11; humGain = 0.0; lpHz = 1600; hpHz = 120; humHz = 38; break;
        case 'facility':
          nGain = 0.07; humGain = 0.08; lpHz = 2400; hpHz = 90; humHz = 60; break;
        case 'city':
          nGain = 0.09; humGain = 0.03; lpHz = 2600; hpHz = 120; humHz = 52; break;
        case 'trench':
        case 'war':
          nGain = 0.12; humGain = 0.02; lpHz = 1900; hpHz = 70; humHz = 42; break;
        default:
          nGain = 0.0; humGain = 0.0; lpHz = 2200; hpHz = 80; humHz = 60; break;
      }
      a.lp.frequency.setTargetAtTime(lpHz, now, 0.20);
      a.hp.frequency.setTargetAtTime(hpHz, now, 0.20);
      a.humOsc.frequency.setTargetAtTime(humHz, now, 0.25);
      a.noiseGain.gain.setTargetAtTime(nGain, now, 0.25);
      a.humGain.gain.setTargetAtTime(humGain, now, 0.35);
      // overall bus gain (small)
      a.bus.gain.setTargetAtTime((nGain+humGain)>0?1.0:0.0, now, 0.35);
      a.preset = tgt;
    }

    // --- music ---
    const m = this._music;
    if(m){
      const tgt = m.target || 'none';
      let bus = 0.0, drone = 0.0, pulse = 0.0, tension = 0.0, lpHz = 1400, bpm = 112;
      switch(tgt){
        case 'stealth':
          bus = 0.95; drone = 0.09; pulse = 0.0; tension = 0.015; lpHz = 1200; bpm = 96; break;
        case 'combat':
          bus = 1.0; drone = 0.13; pulse = 0.055; tension = 0.032; lpHz = 1800; bpm = 118; break;
        case 'escape':
          bus = 1.0; drone = 0.10; pulse = 0.075; tension = 0.020; lpHz = 2100; bpm = 128; break;
        case 'success':
          bus = 0.95; drone = 0.08; pulse = 0.020; tension = 0.0; lpHz = 1600; bpm = 108; break;
        default:
          bus = 0.0; drone = 0.0; pulse = 0.0; tension = 0.0; lpHz = 1400; bpm = 112; break;
      }

      m.bus.gain.setTargetAtTime(bus*0.20, now, 0.35); // overall music volume
      m.droneGain.gain.setTargetAtTime(drone, now, 0.35);
      m.pulseGain.gain.setTargetAtTime(pulse, now, 0.20);
      m.tensionGain.gain.setTargetAtTime(tension, now, 0.25);
      m.lp.frequency.setTargetAtTime(lpHz, now, 0.35);
      m.bpm = bpm;

      // Beat gating (very light)
      m.t += Number(dt)||0.016;
      const spb = 60 / Math.max(40, m.bpm);
      if(m.pulseGain.gain.value > 0.001){
        if(m.nextBeat === 0) m.nextBeat = now;
        while(m.nextBeat < now + 0.05){
          const t0 = m.nextBeat;
          // gate: quick envelope on pulse oscillator gain
          try{
            m.pulseGate.gain.cancelScheduledValues(t0);
            m.pulseGate.gain.setValueAtTime(0.0001, t0);
            m.pulseGate.gain.exponentialRampToValueAtTime(0.9, t0 + 0.01);
            m.pulseGate.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
          }catch{}

          // occasional tick for combat/escape
          if(tgt==='combat' || tgt==='escape'){
            const tickF = (tgt==='escape') ? 1200 : 980;
            this._beep({type:'sine', f0:tickF, f1:tickF*0.8, t:0.03, gain:0.06});
          }
          m.nextBeat += spb;
        }
      }else{
        m.nextBeat = 0;
      }

      m.state = tgt;
    }
  }
}

function makeNoiseBuf(ctx, seconds=0.55){
  const t = Math.max(0.2, Math.min(2.0, Number(seconds)||0.55));
  const len = Math.max(1, Math.floor(ctx.sampleRate * t));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for(let i=0;i<len;i++){
    const k = 1 - (i/len);
    d[i] = (Math.random()*2-1) * (0.15 + 0.85*k);
  }
  return buf;
}
