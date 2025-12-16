export default class SoundSystem{
  constructor(){
    this.ctx = null;
    this.master = null;
    this.enabled = true;
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

      // Backward compat keys (older patches)
      case "ar_fire":      return this.play("fire_ar_light");
      case "pistol_fire":  return this.play("fire_pistol");
      case "reload":       return this.play("reload_ar");

      default: return;
    }
  }
}
