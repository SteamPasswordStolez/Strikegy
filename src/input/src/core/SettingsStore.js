// src/core/SettingsStore.js
// Patch 4: 단일 설정 진실 공급원 (Patch 2 localStorage 연동)

const KEY = "strikegy_settings";

const DEFAULTS = Object.freeze({
  controlPreset: "pc",      // "pc" | "mobile" | "mobile_kb"
  sensitivity: 1.0          // 0.2 ~ 3.0 (Patch 2 기준)
});

function clamp(n, a, b){
  return Math.max(a, Math.min(b, n));
}

export class SettingsStore {
  constructor(){
    this._data = { ...DEFAULTS, ...this._readRaw() };
    this._sanitize();
  }

  _readRaw(){
    try{
      const raw = localStorage.getItem(KEY);
      if(!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : {};
    }catch(e){
      return {};
    }
  }

  _write(){
    try{
      localStorage.setItem(KEY, JSON.stringify(this._data));
    }catch(e){}
  }

  _sanitize(){
    const p = this._data.controlPreset;
    if(p !== "pc" && p !== "mobile" && p !== "mobile_kb") this._data.controlPreset = "pc";

    const s = Number(this._data.sensitivity);
    this._data.sensitivity = clamp(Number.isFinite(s) ? s : 1.0, 0.2, 3.0);
  }

  refresh(){
    this._data = { ...DEFAULTS, ...this._readRaw() };
    this._sanitize();
  }

  get controlPreset(){ return this._data.controlPreset; }
  get sensitivity(){ return this._data.sensitivity; }

  // (선택) Patch 4에서 직접 저장할 일은 거의 없지만, 필요하면 사용 가능
  set(controlPreset, sensitivity){
    if(controlPreset != null) this._data.controlPreset = controlPreset;
    if(sensitivity != null) this._data.sensitivity = sensitivity;
    this._sanitize();
    this._write();
  }
}
