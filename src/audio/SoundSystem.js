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
  unlock(){ this._ensure(); if(this.ctx && this.ctx.state==='suspended'){ this.ctx.resume().catch(()=>{}); } }

  play(name){
    // placeholder synth SFX (replace later with real assets)
    switch(name){
      case "ar_fire":   return this._beep({type:"square", f0:220, f1:150, t:0.06, gain:0.7});
      case "pistol_fire": return this._beep({type:"square", f0:320, f1:180, t:0.07, gain:0.7});
      case "dry":       return this._beep({type:"triangle", f0:90, f1:60, t:0.06, gain:0.45});
      case "reload":    return this._beep({type:"sawtooth", f0:140, f1:90, t:0.18, gain:0.35});
      case "swap":      return this._beep({type:"sine", f0:520, f1:320, t:0.08, gain:0.35});
      default: return;
    }
  }
}
