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

    this.session = null;
    this.mission = null;
    this.stepIndex = 0;
    this.stepState = null;

    this.killCount = 0;
    this._inCutscene = false;

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
    return m;
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

    // Inject per-mission intro briefing cutscene (>=15s).
    this._injectIntroStepIfNeeded(!!continueFromSave);
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
    this._enterStep();
  }

  // Called by game when any enemy is killed
  onKill({ team = null } = {}) {
    if (!team) return;
    if (String(team) !== 'red') return;
    this.killCount++;
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

  async _say(step) {
    const speaker = step?.speaker || '';
    const ko = step?.ko || '';
    const en = step?.en || '';
    this.ui.showSubtitle({ speaker, text: ko, holdSec: 4.2 });

    // Web Speech API (TTS) — English voice, best-effort.
    const canSpeak = typeof window !== 'undefined' && !!window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined';
    if (!canSpeak || !en) {
      await new Promise(r => setTimeout(r, 1200));
      return;
    }

    await new Promise(resolve => {
      try {
        const utt = new SpeechSynthesisUtterance(String(en));
        utt.lang = 'en-US';
        utt.rate = 1.02;
        utt.pitch = 1.0;
        utt.volume = 0.85;
        utt.onend = () => resolve();
        utt.onerror = () => resolve();

        const pickVoice = () => {
          const voices = window.speechSynthesis.getVoices?.() || [];
          const v = voices.find(v => /en/i.test(v.lang)) || voices[0];
          if (v) utt.voice = v;
        };
        pickVoice();
        window.speechSynthesis.onvoiceschanged = () => pickVoice();

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utt);
      } catch {
        resolve();
      }
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


  _buildIntroCameraFrames() {
    const sp = (this.mapJson?.spawns || []).find(s=>String(s.team||'')==='blue');
    const spawn = sp?.pos || [0,2,0];
    const sPos = [spawn[0], Math.max(2.2, (spawn[1]||2) + 1.0), spawn[2]];

    // Pick a target trigger from the mission script (first reach)
    let trgName = null;
    const scr = this._baseScript || this.mission?.script || [];
    for (const st of scr) {
      if (st && st.type === 'reach' && st.trigger) { trgName = String(st.trigger); break; }
    }
    const trg = (trgName && this.triggers?.[trgName]) ? this.triggers[trgName] : null;
    const tPos = trg?.pos || [spawn[0]+40, 2, spawn[2]+40];

    // Cinematic camera rail (15.5s)
    return [
      { t: 0.0,  pos: [sPos[0]-18, 14, sPos[2]-22], look: [sPos[0], 2.2, sPos[2]] },
      { t: 5.0,  pos: [sPos[0]-6,  10, sPos[2]-10], look: [sPos[0]+10, 2.4, sPos[2]+12] },
      { t: 9.0,  pos: [tPos[0]-80, 90, tPos[2]-40], look: [tPos[0], 2.3, tPos[2]] },
      { t: 12.5, pos: [tPos[0]-35, 28, tPos[2]-28], look: [tPos[0], 2.4, tPos[2]] },
      { t: 15.5, pos: [tPos[0]-18, 16, tPos[2]-18], look: [tPos[0], 2.4, tPos[2]] },
    ];
  }

  _injectIntroStepIfNeeded(isContinue) {
    const m = this.mission;
    if (!m) return;
    // Keep original script for target pick
    this._baseScript = Array.isArray(m.script) ? m.script.slice() : [];

    const sess = this.session || {};
    const already = !!sess.introInjected;

    // If continuing from an old save (pre-HF7), step indices need to shift
    if (isContinue && !already && Number(sess.stepIndex||0) > 0) {
      sess.stepIndex = Number(sess.stepIndex||0) + 1;
    }
    sess.introInjected = true;

    const first = this._baseScript?.[0];
    if (first && first.type === 'cutscene' && String(first.id||'').startsWith('intro_brief')) {
      m.script = this._baseScript;
      this.session = sess;
      return;
    }

    const briefing = (m.briefing || {});
    const title = briefing.title || m.title || 'OPERATION BRIEFING';
    const location = briefing.location || 'UNKNOWN AO';
    const time = briefing.time || 'LOCAL';
    const intel = briefing.intel || '목표 지역 진입 후 상황을 확인하고, 지정 목표를 달성하라.';
    const objectives = briefing.objectives || (this._baseScript.filter(s=>s.type==='objective').slice(0,3).map(s=>s.text).filter(Boolean));

    // show briefing overlay during intro cutscene
    try {
      this.ui.showBriefing({
        title: title,
        location,
        time,
        intel,
        objectives,
        marks: this._computeBriefingMarks(),
      });
    } catch {}

    const introStep = {
      id: 'intro_brief_15s',
      type: 'cutscene',
      duration: 15.5,
      lockPlayer: true,
      cinematic: { bars: true, fadeIn: 0.6, fadeOut: 0.6 },
      camera: this._buildIntroCameraFrames(),
      __isBriefing: true,
    };

    m.script = [introStep, ...this._baseScript];
    this.session = sess;
  }

  _computeBriefingMarks(){
    // normalize positions into 0..1 for UI marks (rough)
    const gw = this.mapJson?.world?.groundSize?.[0] ?? 240;
    const gd = this.mapJson?.world?.groundSize?.[1] ?? 240;
    const toUV = (pos)=>{
      const x = (pos[0] + gw/2) / gw;
      const y = 1 - ((pos[2] + gd/2) / gd);
      return [x,y];
    };
    const sp = (this.mapJson?.spawns || []).find(s=>String(s.team||'')==='blue');
    const spawn = sp?.pos || [0,2,0];

    let trgName = null;
    for (const st of (this._baseScript || [])) {
      if (st && st.type === 'reach' && st.trigger) { trgName = String(st.trigger); break; }
    }
    const trg = (trgName && this.triggers?.[trgName]) ? this.triggers[trgName] : null;
    const tPos = trg?.pos || [spawn[0]+40, 2, spawn[2]+40];

    return { you: toUV(spawn), obj: toUV(tPos) };
  }

  _enterStep() {
    const steps = this.mission?.script || [];
    const step = steps[this.stepIndex];
    if (!step) return;

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

    this._setPlayerLock(!!step.lockPlayer);
  }

  _endCutscene(step){
    const cam = this.camera;
    const snap = this._cutsceneSnap;

    try{ if(step?.__isBriefing) this.ui.hideBriefing(); }catch{}

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

    if (this.stepState.t >= tMax) {
      this._endCutscene(step);
    }
  }

  update(dt) {
    this.ui.update(dt);
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

    if (!this.stepState) this.stepState = { t: 0, done: false };

    if (step.type === 'cutscene') {
      this._updateCutscene(step, dt);
      return;
    }

    if (step.type === 'reach') {
      const po = this.getPlayerObject?.();
      const p = po?.position || null;
      const d = this._distToTrigger(step.trigger, p);
      const r = (this.triggers?.[step.trigger]?.r ?? 7);

      if (p && this.triggers?.[step.trigger]) {
        const trg = this.triggers[step.trigger];
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
        // mark corresponding objective done (if any)
        if (String(step.trigger) === 'rally') this._markObjectiveDone('rally');
        if (String(step.trigger) === 'exfil') this._markObjectiveDone('exfil');
        this._advance();
      }
      return;
    }

    if (step.type === 'kill') {
      const need = Math.max(1, Number(step.count) || 1);
      if (this.killCount >= need) {
        this.saveSession({ checkpointId: `kill_${need}` });
        this.ui.toast('체크포인트 저장', 1.6);
        this._markObjectiveDone('elim5');
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
      this.stepState.t = (this.stepState.t || 0) + dt;
      const left = Math.max(0, total - this.stepState.t);
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
      this.stepState.t = (this.stepState.t || 0) + dt;

      const left = Math.max(0, total - this.stepState.t);
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
