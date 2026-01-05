// src/campaign/CampaignRuntime.js

import { CampaignDB, CAMPAIGN_KEY } from './CampaignData.js';
import { CampaignUI } from './CampaignUI.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t){ return t*t*(3-2*t); }

function lerpVec3(out, a, b, t) {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.z = lerp(a.z, b.z, t);
  return out;
}

function findKeyframes(cameraKeys, t) {
  if (!Array.isArray(cameraKeys) || cameraKeys.length === 0) return null;
  if (t <= cameraKeys[0].t) return { a: cameraKeys[0], b: cameraKeys[0], u: 0 };
  for (let i = 0; i < cameraKeys.length - 1; i++) {
    const a = cameraKeys[i], b = cameraKeys[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = Math.max(0.0001, b.t - a.t);
      return { a, b, u: clamp((t - a.t) / span, 0, 1) };
    }
  }
  const last = cameraKeys[cameraKeys.length - 1];
  return { a: last, b: last, u: 0 };
}

function safeJSONParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function normAngleRad(a){
  while(a > Math.PI) a -= Math.PI*2;
  while(a < -Math.PI) a += Math.PI*2;
  return a;
}

export class CampaignRuntime {
  constructor({ THREE, camera, inputManager, playerController, getPlayerObject, getPlayerTeam, getSceneRoot=null, lockPointer = null } = {}) {
    this.THREE = THREE;
    this.camera = camera;
    this.inputManager = inputManager;
    this.playerController = playerController;
    this.getPlayerObject = getPlayerObject;
    this.getPlayerTeam = getPlayerTeam;
    this.getSceneRoot = getSceneRoot;
    this.lockPointer = lockPointer;

    this.ui = new CampaignUI({ root: document.body });

    // HF9-B2: audio hooks
    this.soundSystem = (typeof window !== 'undefined') ? window.soundSystem : null;
    this.ttsManager = (typeof window !== 'undefined') ? window.ttsManager : null;

    this.session = null;
    this.mission = null;
    this.stepIndex = 0;
    this.stepState = null;

    this.killCount = 0;
    this._inCutscene = false;

    // 3D waypoint marker (HF8: improved navigation)
    this._wp3d = null;

    // Interaction key (E)
    this._interactPressed = false;
    this._onKeyDown = (e)=>{
      if(!e) return;
      const k = String(e.key || '').toLowerCase();
      if(k === 'e') this._interactPressed = true;
    };
    window.addEventListener('keydown', this._onKeyDown);

    // Cutscene camera restore snapshot
    this._cutsceneSnap = null;

    this._tmpA = new (THREE?.Vector3 || class { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} })();
    this._tmpB = new (THREE?.Vector3 || class { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} })();
    this._tmpC = new (THREE?.Vector3 || class { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} })();

    this.triggers = {}; // name -> {pos:[x,y,z], r}

    // Checklist state (objective steps)
    this.checklist = []; // {key,text,done}

    // Mission timer
    this.missionTime = 0;

    // HF9-B2: simple combat music bump timer
    this._combatMusicTimer = 0;

    // HF9-C2: Dialogue gate for TTS/subtitle sync
    this._dialogueChain = Promise.resolve();
    this._dialoguePending = 0;

    // Restart events (UI buttons)
    window.addEventListener('campaign:restart', (ev)=>{
      const mode = ev?.detail?.mode || 'checkpoint';
      if(mode === 'mission') this.restartMission();
      else this.restartCheckpoint();
    });

    // Next mission (only available if mission defines nextMissionId)
    window.addEventListener('campaign:next', ()=>{
      try{
        const nextId = this.mission?.nextMissionId || this.session?.nextMissionId || null;
        if(!nextId) return;
        this.session = this.session || {};
        this.session.missionId = nextId;
        this.session.stepIndex = 0;
        this.session.checkpointId = 'start';
        this.session.updatedAt = Date.now();
        this.saveSession(this.session);
        // Reload to ensure map/bot state resets cleanly.
        const url = new URL(window.location.href);
        url.searchParams.set('campaign','1');
        url.searchParams.set('mission', nextId);
        window.location.href = url.toString();
      }catch(e){}
    });
  }

  loadSession({ createIfMissing = true } = {}) {
    const raw = (() => { try { return localStorage.getItem(CAMPAIGN_KEY); } catch { return null; } })();
    const s = raw ? safeJSONParse(raw) : null;
    if (s && typeof s === 'object') {
      this.session = s;
      return this.session;
    }
    if (!createIfMissing) return null;
    this.session = {
      version: 1,
      chapter: 1,
      missionId: 'c1_m1_insertion',
      stepIndex: 0,
      checkpointId: 'start',
      difficulty: { id: 'normal', playerDamage: 1, enemyDamage: 1 },
      updatedAt: Date.now(),
    };
    this.saveSession();
    return this.session;
  }

  saveSession(patch = {}) {
    try {
      this.session = Object.assign(this.session || {}, patch || {}, { updatedAt: Date.now() });
      localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(this.session));
    } catch { /* ignore */ }
  }

  loadMission(missionId) {
    const m = CampaignDB?.missions?.[missionId];
    if (!m) return null;
    this.mission = m;
    // HF9-C2: reset dialogue queue per mission load
    this._dialogueChain = Promise.resolve();
    this._dialoguePending = 0;
    return m;
  }

  // HF9-B2: mission-level audio preset (ambience + initial music state)
  _applyMissionAudioPreset(){
    try{
      const mid = String(this.mission?.id || this.mission?.map || '').toLowerCase();
      const ss = this.soundSystem || (typeof window !== 'undefined' ? window.soundSystem : null);
      if(!ss) return;

      const amb = this._inferAmbiencePreset(mid);
      ss.setAmbiencePreset?.(amb);

      // Default: stealth pacing unless mission screams otherwise.
      const base = (mid.includes('escape') || mid.includes('exfil') || mid.includes('exodus')) ? 'escape'
        : (mid.includes('assault') || mid.includes('siege') || mid.includes('bridge') || mid.includes('final')) ? 'combat'
        : 'stealth';
      ss.setMusicState?.(base);
    }catch{}
  }

  _inferAmbiencePreset(mid){
    const s = String(mid||'').toLowerCase();
    if(s.includes('beach') || s.includes('coast') || s.includes('shore') || s.includes('insertion')) return 'coast';
    if(s.includes('facility') || s.includes('blacksite') || s.includes('lab') || s.includes('data') || s.includes('tower')) return 'facility';
    if(s.includes('city') || s.includes('street') || s.includes('port') || s.includes('harbor')) return 'city';
    if(s.includes('trench') || s.includes('front') || s.includes('hold') || s.includes('war')) return 'trench';
    return 'none';
  }

  _musicForStep(step){
    const t = String(step?.type||'');
    const txt = String(step?.text||'').toLowerCase();
    if(t === 'complete') return 'success';
    if(t === 'kill') return 'combat';
    if(t === 'defend') return 'combat';
    if(t === 'interact'){
      if(txt.includes('해킹') || txt.includes('데이터') || txt.includes('잠입')) return 'stealth';
    }
    if(t === 'reach'){
      if(txt.includes('탈출') || txt.includes('철수') || txt.includes('exfil') || txt.includes('escape')) return 'escape';
    }
    // Default stays
    return null;
  }

  _channelFromText(text){
    const s = String(text||'');
    if(s.includes('[속삭임]')) return 'WHISPER';
    if(s.includes('[내선]') || s.includes('[인터컴]')) return 'INTERCOM';
    if(s.includes('[잡음]')) return 'UNKNOWN';
    if(s.includes('[무전]')) return 'RADIO';
    return 'RADIO';
  }

  attachMap(mapJson) {
    this.mapJson = mapJson;
    // Campaign triggers can be defined inside map JSON:
    // { campaign: { triggers: { rally:{pos:[...], r:..}, exfil:{pos:[...], r:..} } } }
    this.triggers = {};
    const t = mapJson?.campaign?.triggers || mapJson?.meta?.campaign?.triggers;
    if (t && typeof t === 'object') {
      for (const [k, v] of Object.entries(t)) {
        const pos = Array.isArray(v?.pos) ? v.pos : null;
        if (!pos || pos.length < 3) continue;
        this.triggers[k] = { pos: [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0], r: Math.max(1, Number(v?.r) || 6) };
      }
    }
    // sensible defaults if missing
    if (!this.triggers.rally) this.triggers.rally = { pos: [-110, 2, 0], r: 8 };
    if (!this.triggers.exfil) this.triggers.exfil = { pos: [-20, 2, 0], r: 10 };
  

    // HF9-B: scripts may reference new triggers before maps are rebuilt.
    // Create deterministic fallback trigger positions so missions remain playable.
    this._ensureFallbackTriggersFromScript?.();
}

  _ensureFallbackTriggersFromScript() {
    try {
      const steps = Array.isArray(this.mission?.script) ? this.mission.script : [];
      const want = [];
      const seen = new Set();
      for (const s of steps) {
        const t = String(s?.trigger || '').trim();
        if (!t) continue;
        if (s?.type !== 'reach' && s?.type !== 'interact') continue;
        if (this.triggers?.[t]) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        want.push(t);
      }
      if (!want.length) return;

      const a = (this.triggers?.rally?.pos || [-110, 2, 0]).slice();
      const b = (this.triggers?.exfil?.pos || [-20, 2, 0]).slice();
      const ax = Number(a[0]) || 0, ay = Number(a[1]) || 2, az = Number(a[2]) || 0;
      const bx = Number(b[0]) || 0, by = Number(b[1]) || 2, bz = Number(b[2]) || 0;
      const vx = bx - ax, vz = bz - az;
      // perpendicular for small separation
      const len = Math.hypot(vx, vz) || 1;
      const px = -vz / len, pz = vx / len;

      const n = want.length;
      for (let i = 0; i < n; i++) {
        const key = want[i];
        // spread between 0.30 ~ 0.80 of the line from rally to exfil
        const f = n === 1 ? 0.55 : (0.30 + 0.50 * (i / (n - 1)));
        const side = (i % 2 === 0) ? 1 : -1;
        const off = 10 + (i * 2);
        const x = ax + vx * f + px * off * side;
        const z = az + vz * f + pz * off * side;
        const y = (ay + by) * 0.5;
        this.triggers[key] = { pos: [x, y, z], r: 7 };
      }
    } catch { /* ignore */ }
  }


  start({ mapJson, continueFromSave = true } = {}) {
    this.loadSession({ createIfMissing: true });
    const mid = String(this.session?.missionId || 'c1_m1_insertion');
    this.loadMission(mid);
    if (!this.mission) return;

    this.attachMap(mapJson);
    this.killCount = 0;
    this.missionTime = 0;

    this.stepIndex = continueFromSave ? Math.max(0, Number(this.session?.stepIndex || 0)) : 0;
    // HF9-A: 기존 '브리핑 오버레이 컷신' 자동 삽입은 제거. (스크립트에서 컷신/대사 흐름을 직접 구성)
    this.stepState = null;
    this._inCutscene = false;

    // Build checklist from objective steps
    this.checklist = [];
    for (const s of (this.mission?.script || [])) {
      if (s?.type === 'objective') {
        this.checklist.push({ key: String(s.key || s.id || ''), text: String(s.text || ''), done: false });
      }
    }
    this.ui.setChecklist(this.checklist);
    this.ui.hideResult();

    this.ui.toast(`캠페인 시작 · ${this.mission.title}`, 2.2);

    // HF9-B2: ambience + baseline music for the mission
    try{ this._applyMissionAudioPreset(); }catch{}

    this._enterStep();
  }

  // Called by game when any enemy is killed
  onKill({ team = null } = {}) {
    if (!team) return;
    if (String(team) !== 'red') return;
    this.killCount++;

    // HF9-B2: quick combat bump (prevents dead-silent moments)
    try{
      this._combatMusicTimer = Math.max(0, Number(this._combatMusicTimer) || 0);
      this._combatMusicTimer = Math.max(this._combatMusicTimer, 6.0);
      const ss = (this.soundSystem||window.soundSystem);
      ss?.setMusicState?.('combat');
    }catch{}
  }

  // Called by game when local player dies (campaign fail)
  onPlayerDeath() {
    if (!this.mission) return;
    if (!this.mission.failOnDeath) return;
    if (this.session?.checkpointId === 'failed') return;

    this.saveSession({ checkpointId: 'failed' });
    this._setPlayerLock(true);
    this.ui.setCinematic(true);
    this.ui.setFade(0.35, 12);
    try{
      const ss = (this.soundSystem||window.soundSystem);
      ss?.setMusicState?.('none');
      ss?.stinger?.('fail');
    }catch{}
    this.ui.showResult({ title: 'MISSION FAILED', desc: '작전이 중단되었습니다. 체크포인트에서 재시작하세요.' });
  }

  restartCheckpoint() {
    // Keep current stepIndex (already saved during progression), just reload.
    try { location.reload(); } catch { /* ignore */ }
  }

  restartMission() {
    this.saveSession({ stepIndex: 0, checkpointId: 'start' });
    try { location.reload(); } catch { /* ignore */ }
  }

  isPlayerLocked() {
    return !!this._inCutscene;
  }

  _consumeInteract(){
    const v = !!this._interactPressed;
    this._interactPressed = false;
    return v;
  }

  _setPlayerLock(locked) {
    this._inCutscene = !!locked;
    try {
      if (this.inputManager && typeof this.inputManager.setEnabled === 'function') {
        this.inputManager.setEnabled(!locked);
      }
    } catch { /* ignore */ }
    try {
      if (typeof this.lockPointer === 'function') this.lockPointer(!locked);
    } catch { /* ignore */ }
  }

  _speakerTag(speaker){
    const s = String(speaker||'').trim();
    if(!s) return '';
    const parts = s.split(/\s+/).filter(Boolean);
    const tag = parts[parts.length-1] || s;
    return String(tag).toUpperCase();
  }

  _stripTagAndDetectChannel(raw){
    let txt = String(raw || '');
    let ch = null;

    // Accept: [무전], [속삭임], [잡음], [HQ], [오버워치] ... (markdown의 *[무전]* 형태도 흡수)
    const m = txt.match(/\[([^\]]+)\]/);
    if(m){
      ch = String(m[1]||'').trim();
      txt = txt.replace(m[0], '').trim();
    }

    // Leading patterns like "*[무전]*:" or "(무전):" etc.
    txt = txt.replace(/^\*?\s*\(?\s*(무전|속삭임|잡음|hq|본부|오버워치|내부통신|인터콤)\s*\)?\s*\*?\s*[:：-]?\s*/i, '').trim();
    return { text: txt, channel: ch };
  }

  _normalizeChannelLabel(ch, speakerTag=''){
    const c = String(ch||'').toLowerCase();
    const st = String(speakerTag||'').toUpperCase();

    if(!c){
      if(st==='NOVA') return 'HQ';
      if(st==='KESTREL') return 'OVERWATCH';
      if(st==='???' || st==='UNKNOWN') return 'UNKNOWN';
      return 'RADIO';
    }

    if(c.includes('무전') || c==='radio') return 'RADIO';
    if(c.includes('속삭') || c==='whisper') return 'WHISPER';
    if(c.includes('잡음') || c.includes('noise') || c.includes('static')) return 'NOISE';
    if(c.includes('hq') || c.includes('본부') || c.includes('analysis')) return 'HQ';
    if(c.includes('오버워치') || c.includes('overwatch') || c.includes('drone')) return 'OVERWATCH';
    if(c.includes('내부') || c.includes('인터콤') || c.includes('intercom')) return 'INTERCOM';
    if(c.includes('미상') || c.includes('unknown')) return 'UNKNOWN';

    return String(ch).toUpperCase();
  }

  _playCommsSfx(label, urgent=false){
    try{
      const ss = window.soundSystem;
      if(!ss || typeof ss.play !== 'function') return;
      const L = String(label||'').toUpperCase();
      if(urgent) { ss.play('comms_urgent'); return; }
      if(L==='WHISPER') { ss.play('whisper'); return; }
      if(L==='INTERCOM' || L==='HQ') { ss.play('intercom'); return; }
      if(L==='NOISE' || L==='UNKNOWN') { ss.play('radio_static'); ss.play('radio_in'); return; }
      ss.play('radio_in');
    }catch{}
  }


  // HF9-C2: queue dialogue so subtitles never overlap; wait until voice ends
  _queueDialogue(task){
    try{
      this._dialoguePending = (Number(this._dialoguePending)||0) + 1;
      const run = async () => {
        try { await task(); }
        finally { this._dialoguePending = Math.max(0, (Number(this._dialoguePending)||0) - 1); }
      };
      this._dialogueChain = (this._dialogueChain || Promise.resolve()).catch(()=>{}).then(run);
      return this._dialogueChain;
    }catch{
      this._dialoguePending = Math.max(0, (Number(this._dialoguePending)||0) - 1);
      return Promise.resolve();
    }
  }

  _estimateSpeechSec(text, channel='RADIO', urgent=false){
    const t = String(text||'').trim();
    if(!t) return 0;
    const words = t.split(/\s+/).filter(Boolean).length;
    const base = (words / 2.6) + 0.45;
    const rate = (String(channel).toUpperCase()==='WHISPER') ? 0.96 : (urgent ? 1.05 : 1.0);
    return Math.max(0.8, base / rate);
  }

  // HF9-B2: high-quality TTS (via /tts proxy). Best-effort and cancellable.
  _voiceForSpeaker(tag){
    const t = String(tag||'').toUpperCase();
    // These are symbolic IDs; your TTS proxy can map them to real provider voices.
    const map = {
      'RAVEN': 'en_male_01',
      'GHOST': 'en_male_02',
      'NOVA': 'en_female_01',
      'KESTREL': 'en_female_02',
      'JIN': 'en_male_03',
      'ECHO': 'en_male_04',
    };
    return map[t] || 'en_neutral_01';
  }

  _ttsSpeakLine({ speakerTag='', label='RADIO', text='', urgent=false, volume=1.0, maxWaitMs=null } = {}){
    const tts = this.ttsManager || (typeof window !== 'undefined' ? window.ttsManager : null);
    if(!tts || !text) return null;
    const voice = this._voiceForSpeaker(speakerTag);

    // Map UI labels to FX channels
    let channel = String(label||'RADIO').toUpperCase();
    if(channel === 'HQ') channel = 'INTERCOM';
    if(channel === 'OVERWATCH') channel = 'RADIO';
    if(channel === 'NOISE') channel = 'UNKNOWN';

    const lang = String((this.mission?.lang || 'en-GB'));
    return tts.speak({
      text: String(text),
      lang,
      speakerTag: String(speakerTag||''),
      voice,
      channel,
      urgent: !!urgent,
      volume: (volume==null?1.0:Number(volume)||1.0),
      maxWaitMs: (maxWaitMs!=null?maxWaitMs:undefined),
    });
  }


  _getSubtitleLangPref(){
    try{
      const w = (typeof window !== 'undefined') ? window : null;
      const forced = w?.__strikegySubtitleLang;
      const ls = w?.localStorage?.getItem?.('strikegy_subtitle_lang');
      return String(forced || ls || 'auto').toLowerCase();
    }catch{
      return 'auto';
    }
  }

  _pickDialogueText(obj){
    const mode = this._getSubtitleLangPref();
    if(mode === 'en') return (obj?.en ?? obj?.text ?? obj?.ko ?? '');
    if(mode === 'ko') return (obj?.ko ?? obj?.text ?? obj?.en ?? '');
    return (obj?.text ?? obj?.ko ?? obj?.en ?? '');
  }

  _showCommsLine(line){
    const speaker = line?.speaker ?? '';
    const speakerTag = this._speakerTag(speaker);
    const raw = this._pickDialogueText(line);
    const parsed = this._stripTagAndDetectChannel(raw);
    const label = this._normalizeChannelLabel(line?.channel ?? parsed.channel, speakerTag);
    const urgent = !!(line?.urgent || line?.priority==='high');

    const text = String(parsed.text || '').trim();
    if(!text) return;

    // HF9-C2: queue so we never show a new subtitle while the previous voice is still playing.
    this._queueDialogue(async () => {
      const est = this._estimateSpeechSec(text, label, urgent);
      const baseHold = Number(line?.holdSec) || (2.2 + Math.min(3.2, text.length/26));
      const hold = Math.max(1.6, Math.min(9.5, Math.max(baseHold, est + 0.45)));

      this._playCommsSfx(label, urgent);
      this.ui.showSubtitle({ channel: label, speaker: speakerTag, text, holdSec: hold, urgent });

      const startMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const ttsAllowed = (line?.tts !== false);
      if(ttsAllowed){
        try{
          const maxWaitMs = Math.max(1800, Math.min(25000, Math.round((est + 1.2) * 1000)));
          const p = this._ttsSpeakLine({ speakerTag, label, text, urgent, maxWaitMs });
          if(p) await p;
        }catch{}
      }

      // Always enforce a minimum on-screen time so lines don't "skip" even if TTS fails.
      const endMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const elapsed = Math.max(0, endMs - startMs);
      const target = Math.max(600, Math.round(hold * 1000));
      const remain = target - elapsed;
      if(remain > 0) await new Promise(r => setTimeout(r, remain));

      // tiny gap so consecutive lines don't feel "snapped"
      await new Promise(r => setTimeout(r, 90));
    });
  }

  async _say(step) {
    const speaker = step?.speaker || '';
    const speakerTag = this._speakerTag(speaker);

    const rawText = this._pickDialogueText(step);
    const parsed = this._stripTagAndDetectChannel(rawText);
    const label = this._normalizeChannelLabel(step?.channel ?? parsed.channel, speakerTag);
    const urgent = !!(step?.urgent || step?.priority==='high');
    const text = String(parsed.text || '').trim();
    if(!text) return;

    // HF9-C2: Queue dialogue so the subtitle and voice stay in sync.
    await this._queueDialogue(async () => {
      const est = this._estimateSpeechSec(text, label, urgent);
      const baseHold = Number(step?.holdSec) || (2.2 + Math.min(3.2, text.length/26));
      const hold = Math.max(1.6, Math.min(9.5, Math.max(baseHold, est + 0.45)));

      this._playCommsSfx(label, urgent);
      this.ui.showSubtitle({ channel: label, speaker: speakerTag, text, holdSec: hold, urgent });

      const startMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const ttsAllowed = (step?.tts !== false);
      if(ttsAllowed){
        try{
          const maxWaitMs = Math.max(1800, Math.min(25000, Math.round((est + 1.2) * 1000)));
          const p = this._ttsSpeakLine({ speakerTag, label, text, urgent, maxWaitMs });
          if(p) await p;
        }catch{}
      }

      // Always enforce a minimum on-screen time so lines don't "skip" even if TTS fails.
      const endMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const elapsed = Math.max(0, endMs - startMs);
      const target = Math.max(600, Math.round(hold * 1000));
      const remain = target - elapsed;
      if(remain > 0) await new Promise(r => setTimeout(r, remain));

      await new Promise(r => setTimeout(r, 90));
    });
  }


  _markObjectiveDone(key) {
    const k = String(key || '');
    if (!k) return;
    const it = this.checklist.find(x => x.key === k);
    if (it && !it.done) {
      it.done = true;
      this.ui.setChecklist(this.checklist);
    }
  }

  // (HF8 브리핑 오버레이 컷신/자동 주입 로직은 HF9-A에서 제거됨)

  _ensureWorldWaypoint3D(){
    if (this._wp3d) return;
    const THREE = this.THREE;
    const scene = this.getSceneRoot?.();
    if (!THREE || !scene) return;

    const group = new THREE.Group();
    group.name = 'campaignWaypoint3D';
    group.visible = false;

    // Ring + beam (simple, cheap)
    const ringGeo = new THREE.TorusGeometry(1.9, 0.08, 10, 26);
    const ringMat = new THREE.MeshBasicMaterial({ transparent:true, opacity:0.55, depthWrite:false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.15;

    const beamGeo = new THREE.CylinderGeometry(0.20, 0.20, 6.2, 10, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({ transparent:true, opacity:0.22, depthWrite:false });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 3.2;

    const tipGeo = new THREE.ConeGeometry(0.35, 0.9, 10);
    const tipMat = new THREE.MeshBasicMaterial({ transparent:true, opacity:0.35, depthWrite:false });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.y = 6.6;

    group.add(ring, beam, tip);
    scene.add(group);

    this._wp3d = { group, ring, beam, tip, t: 0, active: false };
  }

  _setWorldWaypoint(pos){
    if (!pos || pos.length < 3) return;
    this._ensureWorldWaypoint3D();
    if (!this._wp3d) return;
    const g = this._wp3d.group;
    g.position.set(Number(pos[0])||0, Number(pos[1]||2), Number(pos[2])||0);
    g.visible = true;
    this._wp3d.active = true;
    // 2D marker will be updated each tick
  }

  _clearWorldWaypoint(){
    if (!this._wp3d) return;
    this._wp3d.group.visible = false;
    this._wp3d.active = false;
    try{ this.ui?.setWaypointMarker?.({ visible:false }); }catch{}
  }

  _tickWorldWaypoint(dt){
    if (!this._wp3d || !this._wp3d.active) return;
    this._wp3d.t += dt;
    const t = this._wp3d.t;
    const pulse = 1.0 + Math.sin(t * 3.1) * 0.09;
    try{ this._wp3d.ring.scale.set(pulse, pulse, pulse); }catch{}
    try{ this._wp3d.tip.position.y = 6.6 + (0.25 * Math.sin(t * 2.3)); }catch{}
    try{ this._wp3d.beam.material.opacity = 0.18 + 0.10 * (0.5 + 0.5 * Math.sin(t * 2.7)); }catch{}

    // HF9-B2: screen-space waypoint marker (MW-style)
    this._tickWaypointMarker();
  }

  _tickWaypointMarker(){
    const ui = this.ui;
    const camera = this.camera;
    const THREE = this.THREE;
    if(!ui?.setWaypointMarker || !camera || !THREE || !this._wp3d?.group?.visible) {
      try{ ui?.setWaypointMarker?.({ visible:false }); }catch{}
      return;
    }

    const w = Math.max(1, window.innerWidth || 1);
    const h = Math.max(1, window.innerHeight || 1);
    const margin = 56;

    // world -> screen
    const target = this._tmpA;
    target.copy?.(this._wp3d.group.position) || target.set(this._wp3d.group.position.x, this._wp3d.group.position.y, this._wp3d.group.position.z);
    target.y += 1.8; // aim slightly above ground marker

    const camPos = this._tmpB;
    camera.getWorldPosition?.(camPos);
    const camDir = this._tmpC;
    camera.getWorldDirection?.(camDir);
    const to = target.clone?.() ? target.clone().sub(camPos) : { x: target.x-camPos.x, y: target.y-camPos.y, z: target.z-camPos.z };
    const dot = (to.x*camDir.x + to.y*camDir.y + to.z*camDir.z);
    const inFront = dot > 0;

    const ndc = new THREE.Vector3(target.x, target.y, target.z).project(camera);
    let sx = (ndc.x * 0.5 + 0.5) * w;
    let sy = (-ndc.y * 0.5 + 0.5) * h;

    // if behind camera, flip direction so arrow still points correctly
    if(!inFront){
      sx = w - sx;
      sy = h - sy;
    }

    const offscreen = !inFront || sx < margin || sx > (w - margin) || sy < margin || sy > (h - margin);
    let x = sx, y = sy;
    if(offscreen){
      x = clamp(sx, margin, w - margin);
      y = clamp(sy, margin, h - margin);
      const dx = sx - (w/2);
      const dy = sy - (h/2);
      const ang = Math.atan2(dy, dx);
      ui.setWaypointMarker({ visible:true, x, y, offscreen:true, angleRad: ang });
    }else{
      ui.setWaypointMarker({ visible:true, x, y, offscreen:false, angleRad: 0 });
    }
  }


  _enterStep() {
    const steps = this.mission?.script || [];
    const step = steps[this.stepIndex];
    if (!step) return;

    // HF9-B2: step-based music state (unless a recent combat bump is active)
    try{
      const ss = this.soundSystem || (typeof window !== 'undefined' ? window.soundSystem : null);
      if(ss && !(this._combatMusicTimer > 0)){
        const ms = this._musicForStep(step);
        if(ms) ss.setMusicState?.(ms);
      }
    }catch{}

    this.stepState = { t: 0, done: false };
    this.saveSession({ stepIndex: this.stepIndex });

    if (step.type === 'objective') {
      this.ui.setObjective(step.text || '');
      this.ui.toast('목표 갱신', 1.1);
      this._advance();
      return;
    }

    if (step.type === 'say') {
      this._say(step).then(() => {
        if (this.stepIndex >= steps.length) return;
        const cur = (this.mission?.script || [])[this.stepIndex];
        if (cur && cur.id === step.id) this._advance();
      });
      return;
    }

    if (step.type === 'cutscene') {
      this._beginCutscene(step);
      return;
    }

    if (step.type === 'complete') {
      this.ui.setObjective('미션 완료');
      this.ui.toast('미션 완료!', 2.6);
      try{
        const ss = (this.soundSystem||window.soundSystem);
        ss?.setMusicState?.('success');
        ss?.stinger?.('success');
      }catch{}
      this.ui.setWaypoint(null);
      this.ui.setCinematic(false);
      this.ui.setFade(0, 10);
      const nextId = this.mission?.nextMissionId || null;
      this.ui.showResult({
        title: 'MISSION COMPLETE',
        desc: nextId ? '작전 성공. 다음 미션으로 이동할 수 있습니다.' : '작전 성공. (다음 미션은 확장 예정)',
        canNext: !!nextId,
      });
      this.saveSession({ checkpointId: 'complete', nextMissionId: nextId || null });
      this._setPlayerLock(true);
      return;
    }
  }

  _advance() {
    const steps = this.mission?.script || [];
    this.stepIndex = clamp(this.stepIndex + 1, 0, Math.max(0, steps.length));
    this.stepState = null;
    this._enterStep();
  }

  _distToTrigger(name, playerPos) {
    const trg = this.triggers?.[name];
    if (!trg || !playerPos) return Infinity;
    const dx = (playerPos.x - trg.pos[0]);
    const dy = (playerPos.y - trg.pos[1]);
    const dz = (playerPos.z - trg.pos[2]);
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  _beginCutscene(step){
    // Snapshot current camera parent/local so we can restore after cutscene.
    try {
      const cam = this.camera;
      const scene = this.getSceneRoot?.();
      if (!cam || !scene) throw new Error('no camera/scene');

      cam.updateMatrixWorld?.(true);
      const wpos = new this.THREE.Vector3();
      const wquat = new this.THREE.Quaternion();
      cam.getWorldPosition?.(wpos);
      cam.getWorldQuaternion?.(wquat);

      this._cutsceneSnap = {
        parent: cam.parent || null,
        localPos: cam.position?.clone?.() || null,
        localQuat: cam.quaternion?.clone?.() || null,
        localRotX: Number(cam.rotation?.x || 0),
        worldPos: wpos,
        worldQuat: wquat,
        playerYaw: Number(this.getPlayerObject?.()?.rotation?.y || 0),
      };

      // Detach to scene root (keyframes are world space)
      try{ cam.parent?.remove?.(cam); }catch{}
      try{ scene.add?.(cam); }catch{}
      try{ cam.position.copy(wpos); cam.quaternion.copy(wquat); }catch{}

    } catch {
      this._cutsceneSnap = null;
    }

    const cine = step?.cinematic || {};
    this.ui.setCinematic(!!cine?.bars);
    if (cine?.fadeIn) this.ui.setFade(0, 14);

    // HF9-B2: 컷신 중에는 게임 진행이 멈추게 (항상 플레이어/월드 잠금)
    // - 컷신 중 피격/사망 문제 방지
    // - presentation 안정화
    this._setPlayerLock(true);

    // HF9-B2: soften BGM during cutscenes (dialogue focus)
    try{ (this.soundSystem||window.soundSystem)?.setMusicState?.('stealth'); }catch{}

    // Timed comms lines inside cutscenes
    try{ this.stepState._lineIdx = 0; }catch{}

    // HF9-A: 컷신 중에는 모든 챕터에서 HUD 숨김
    try{
      document.body.dataset.campCutscene = '1';
      window.dispatchEvent(new CustomEvent('campaign:cutscene', { detail: { active:true, chapter: this.mission?.chapter || 0, missionId: this.mission?.id || '' } }));
    }catch{}

    // Optional: title card
    try{
      if(step?.titleCard){
        const tc = step.titleCard;
        if(typeof tc === 'string') this.ui.showTitleCard({ title: tc });
        else this.ui.showTitleCard(tc);
      }
    }catch{}
  }

  _endCutscene(step){
    const cam = this.camera;
    const snap = this._cutsceneSnap;
    try{ this.ui.hideTitleCard(); }catch{}

    try{
      delete document.body.dataset.campCutscene;
      window.dispatchEvent(new CustomEvent('campaign:cutscene', { detail: { active:false, chapter: this.mission?.chapter || 0, missionId: this.mission?.id || '' } }));
    }catch{}

    // fade out bars quickly
    const cine = step?.cinematic || {};
    if (cine?.fadeOut) this.ui.setFade(0, 12);
    this.ui.setCinematic(false);

    try {
      const scene = this.getSceneRoot?.();
      if (snap?.parent && cam && scene) {
        try{ scene.remove?.(cam); }catch{}
        try{ snap.parent.add?.(cam); }catch{}
        if (snap.localPos && cam?.position?.copy) cam.position.copy(snap.localPos);
        if (snap.localQuat && cam?.quaternion?.copy) cam.quaternion.copy(snap.localQuat);
        if (cam?.rotation) cam.rotation.x = Number(snap.localRotX || 0);
        const po = this.getPlayerObject?.();
        if (po?.rotation) po.rotation.y = Number(snap.playerYaw || 0);
      }
    } catch { /* ignore */ }

    this._cutsceneSnap = null;
    this._setPlayerLock(false);
    this._advance();
  }

  _updateCutscene(step, dt) {
    const tMax = Math.max(0.1, Number(step.duration) || 5);
    this.stepState.t += dt;
    const t = clamp(this.stepState.t, 0, tMax);

    const kf = findKeyframes(step.camera, t);
    if (kf) {
      const u = smoothstep(kf.u);
      const aPos = kf.a.pos, bPos = kf.b.pos;
      const aLook = kf.a.look, bLook = kf.b.look;

      this._tmpA.set(aPos[0], aPos[1], aPos[2]);
      this._tmpB.set(bPos[0], bPos[1], bPos[2]);
      this._tmpC.set(aLook[0], aLook[1], aLook[2]);

      const lookB = this._tmpB;
      lookB.set(bLook[0], bLook[1], bLook[2]);

      lerpVec3(this.camera.position, this._tmpA, this._tmpB, u);
      const look = lerpVec3(this._tmpC, this._tmpC, lookB, u);
      this.camera.lookAt(look);
    }

    // HF9-A: 컷신 타임라인 기반 대사(line) 지원
    try{
      const lines = Array.isArray(step?.lines) ? step.lines : null;
      if(lines){
        if(typeof this.stepState._lineIdx !== 'number') this.stepState._lineIdx = 0;
        while(this.stepState._lineIdx < lines.length){
          const ln = lines[this.stepState._lineIdx];
          const at = Number(ln?.t ?? ln?.at ?? 0);
          if (t + 1e-3 < at) break;
          this._showCommsLine(ln);
          this.stepState._lineIdx++;
        }
      }
    }catch(e){}


    if (this.stepState.t >= tMax) {
      // HF9-C2: don't end cutscene while a comms line is still speaking
      const pending = Number(this._dialoguePending)||0;
      const lines = Array.isArray(step?.lines) ? step.lines : null;
      const allScheduled = !lines || (typeof this.stepState._lineIdx === 'number' && this.stepState._lineIdx >= lines.length);
      if (pending <= 0 && allScheduled) {
        this._endCutscene(step);
      }
    }
  }

  _tickStepLines(step, t) {
    try {
      const lines = Array.isArray(step?.lines) ? step.lines : null;
      if (!lines) return;
      if (typeof this.stepState._lineIdx !== 'number') this.stepState._lineIdx = 0;
      while (this.stepState._lineIdx < lines.length) {
        const ln = lines[this.stepState._lineIdx];
        const at = Number(ln?.t ?? ln?.at ?? 0);
        if (t + 1e-3 < at) break;
        this._showCommsLine(ln);
        this.stepState._lineIdx++;
      }
    } catch { /* ignore */ }
  }


  update(dt) {
    this.ui.update(dt);
    this._tickWorldWaypoint(dt);
    if (!this.mission) return;

    // Mission timer
    this.missionTime += dt;
    const limit = Number(this.mission?.timeLimitSec || 0);
    if (limit > 0 && this.missionTime >= limit) {
      this.onPlayerDeath();
      return;
    }

    const steps = this.mission.script || [];
    const step = steps[this.stepIndex];
    if (!step) return;

    // HF9-B2: combat bump timer decay
    if(this._combatMusicTimer > 0){
      this._combatMusicTimer = Math.max(0, (Number(this._combatMusicTimer) || 0) - dt);
      if(this._combatMusicTimer <= 0.001){
        try{
          const ss = (this.soundSystem||window.soundSystem);
          const ms = this._musicForStep(step);
          if(ms) ss?.setMusicState?.(ms);
          else {
            // fall back to mission baseline
            const mid = String(this.mission?.id || this.mission?.map || '').toLowerCase();
            const base = (mid.includes('escape') || mid.includes('exfil') || mid.includes('exodus')) ? 'escape'
              : (mid.includes('assault') || mid.includes('siege') || mid.includes('bridge') || mid.includes('final')) ? 'combat'
              : 'stealth';
            ss?.setMusicState?.(base);
          }
        }catch{}
      }
    }

    if (!this.stepState) this.stepState = { t: 0, done: false };

    // HF9-B: allow timed dialogue lines during any step (reach/interact/kill/defend/wait)
    if (step.type !== 'cutscene') {
      this.stepState.t = (this.stepState.t || 0) + dt;
      this._tickStepLines(step, this.stepState.t);
    }

    if (step.type === 'cutscene') {
      this._updateCutscene(step, dt);
      return;
    }

    // World waypoint is only for navigation steps.
    if (step.type !== 'reach' && step.type !== 'interact') {
      this._clearWorldWaypoint();
    }

    if (step.type === 'reach') {
      const po = this.getPlayerObject?.();
      const p = po?.position || null;
      const d = this._distToTrigger(step.trigger, p);
      const r = (this.triggers?.[step.trigger]?.r ?? 7);

      if (p && this.triggers?.[step.trigger]) {
        const trg = this.triggers[step.trigger];
        this._setWorldWaypoint(trg.pos);
        const dx = trg.pos[0] - p.x;
        const dz = trg.pos[2] - p.z;
        const dist = Math.sqrt(dx*dx + dz*dz);

        // Direction hint (left/right/forward)
        let hint = '';
        const yaw = Number(po?.rotation?.y || 0);
        const ang = Math.atan2(dx, dz); // world forward +Z
        const diff = normAngleRad(ang - yaw);
        const deg = diff * 180/Math.PI;
        if(Math.abs(deg) < 18) hint = '정면';
        else if(deg > 0) hint = '우측';
        else hint = '좌측';

        this.ui.setWaypoint({
          label: step.label || step.trigger,
          distText: `${Math.max(0, Math.round(dist))}m`,
          hint: `방향: ${hint}`,
        });
      }

      if (d <= r) {
        this.saveSession({ checkpointId: String(step.trigger || 'reach') });
        this.ui.toast('체크포인트 저장', 1.6);
        this.ui.setWaypoint(null);
        this._clearWorldWaypoint();
        // mark corresponding objective done (if any)
        try{
          const ok = step.objectiveKey || step.key || step.trigger || '';
          if (ok) this._markObjectiveDone(ok);
        }catch{}
        this._advance();
      }
      return;
    }

    if (step.type === 'kill') {
      const need = Math.max(1, Number(step.count) || 1);
      if (this.killCount >= need) {
        this.saveSession({ checkpointId: `kill_${need}` });
        this.ui.toast('체크포인트 저장', 1.6);
        // objective auto-mark (preferred: objectiveKey)
        try{
          let ok = step.objectiveKey || step.key || '';
          if(!ok){
            const cand = `elim${need}`;
            if(this.checklist?.some(x=>x.key===cand)) ok = cand;
          }
          if(ok) this._markObjectiveDone(ok);
        }catch{}
        this._advance();
      } else {
        this.ui.setObjective(`적 제거 ${this.killCount}/${need}`);
      }
      return;
    }

    if (step.type === 'interact') {
      const po = this.getPlayerObject?.();
      const p = po?.position || null;
      const trgName = String(step.trigger || '');
      const d = this._distToTrigger(trgName, p);
      const r = (this.triggers?.[trgName]?.r ?? 6);

      // reuse waypoint panel for prompt
      if (p && this.triggers?.[trgName]) {
        const trg = this.triggers[trgName];
        this._setWorldWaypoint(trg.pos);
        const dx = trg.pos[0] - p.x;
        const dz = trg.pos[2] - p.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        this.ui.setWaypoint({
          label: step.label || trgName || 'INTERACT',
          distText: `${Math.max(0, Math.round(dist))}m`,
          hint: d <= r ? (step.hint || 'E로 상호작용') : (step.hintFar || '접근 중...'),
        });
      }

      if (d <= r && this._consumeInteract()) {
        this.ui.toast(step.toast || '상호작용', 1.2);
        this.ui.setWaypoint(null);
        if (step.objectiveKey) this._markObjectiveDone(step.objectiveKey);
        this.saveSession({ checkpointId: String(step.checkpointId || trgName || 'interact') });
        this._advance();
      }
      return;
    }

    if (step.type === 'wait') {
      const total = Math.max(0.1, Number(step.sec) || 1);
      const left = Math.max(0, total - (this.stepState.t || 0));
      this.ui.setObjective(step.text ? `${step.text} (${left.toFixed(1)}s)` : `대기... (${left.toFixed(1)}s)`);
      if (left <= 0) {
        if (step.objectiveKey) this._markObjectiveDone(step.objectiveKey);
        this.saveSession({ checkpointId: String(step.checkpointId || 'wait') });
        this._advance();
      }
      return;
    }

    if (step.type === 'defend') {
      const total = Math.max(1, Number(step.sec) || 30);

      const left = Math.max(0, total - (this.stepState.t || 0));
      const label = step.text || '버텨라';
      this.ui.setObjective(`${label} (${Math.ceil(left)}s)`);

      // Optional: completion also requires kills
      const needKills = Math.max(0, Number(step.kills) || 0);
      if (needKills > 0) {
        this.ui.setObjective(`${label} · ${this.killCount}/${needKills} (${Math.ceil(left)}s)`);
      }

      const okTime = left <= 0;
      const okKills = (needKills <= 0) || (this.killCount >= needKills);
      if (okTime && okKills) {
        if (step.objectiveKey) this._markObjectiveDone(step.objectiveKey);
        this.saveSession({ checkpointId: String(step.checkpointId || 'defend') });
        this.ui.toast('체크포인트 저장', 1.4);
        this._advance();
      }
      return;
    }
  }
}
