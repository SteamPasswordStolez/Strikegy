import { firebaseConfig } from "./firebaseConfig.js";

// Firebase modular SDK (CDN ES modules)
// Pinned version to keep builds stable on GitHub Pages.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const CONFIG_PLACEHOLDER = "PASTE_";

// Room code format: 6 characters, lowercase letters + digits
const ROOM_CODE_LEN = 6;
const ROOM_CODE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function looksUnconfigured(cfg){
  if(!cfg) return true;
  const keys = ["apiKey","authDomain","projectId","appId"];
  return keys.some(k => !cfg[k] || String(cfg[k]).startsWith(CONFIG_PLACEHOLDER));
}

function clampInt(n, min, max, fallback){
  let v = Number(n);
  if(!Number.isFinite(v)) v = fallback;
  v = Math.round(v);
  v = Math.max(min, Math.min(max, v));
  return v;
}

function toTeam(teamPref){
  if(teamPref === "A" || teamPref === "B") return teamPref;
  return "R"; // random
}

export class FirebaseLobby {
  constructor({ mode }) {
    this.mode = mode;

    this.app = null;
    this.auth = null;
    this.db = null;

    this.user = null;

    this.unsubRooms = null;
    this.unsubRoom = null;
    this.unsubPlayers = null;
  }

  async init(){
    if(looksUnconfigured(firebaseConfig)){
      throw new Error("Firebase 설정이 비어 있습니다. src/mp/firebaseConfig.js 를 채워주세요.");
    }

    this.app = initializeApp(firebaseConfig);
    this.auth = getAuth(this.app);
    this.db = getFirestore(this.app);

    // Ensure auth
    await new Promise((resolve, reject)=>{
      const timeout = setTimeout(()=>reject(new Error("Firebase Auth timeout")), 10000);

      const unsub = onAuthStateChanged(this.auth, async (user)=>{
        if(user){
          clearTimeout(timeout);
          unsub();
          this.user = user;
          resolve();
          return;
        }
        try{
          await signInAnonymously(this.auth);
        }catch(e){
          clearTimeout(timeout);
          unsub();
          reject(e);
        }
      });
    });

    return this.user;
  }

  // ---- Rooms list ----
  subscribeRooms(cb){
    this._clearRoomsSub();
    const roomsRef = collection(this.db, "rooms");
    // Avoid composite indexes: single equality filter only.
    const modeStatus = `${this.mode}|lobby`;
    const q = query(roomsRef, where("modeStatus","==", modeStatus), limit(30));
    this.unsubRooms = onSnapshot(q, (snap)=>{
      const rooms = [];
      snap.forEach(d=>{
        const data = d.data();
        rooms.push({
          id: d.id,
          ...data,
        });
      });
      cb?.(rooms);
    }, (err)=>{
      cb?.([], err);
    });
  }

  _clearRoomsSub(){
    try{ this.unsubRooms?.(); }catch{}
    this.unsubRooms = null;
  }

  // ---- Room join/create ----
  _generateRoomCode(){
    let out = "";
    for(let i=0;i<ROOM_CODE_LEN;i++){
      out += ROOM_CODE_CHARS[(Math.random()*ROOM_CODE_CHARS.length)|0];
    }
    return out;
  }

  async _getAvailableRoomRef(){
    // Firestore doc IDs are unique; we probe a few candidates to avoid collisions.
    for(let i=0;i<20;i++){
      const code = this._generateRoomCode();
      const ref = doc(this.db, "rooms", code);
      const snap = await getDoc(ref);
      if(!snap.exists()) return { code, ref };
    }
    throw new Error("룸코드 생성에 실패했습니다. 다시 시도해주세요.");
  }

  async createRoom({ name, classId }, opts = {}){
    const seed = Math.floor(Math.random()*1e9);

    const spectator = !!opts.spectator;
    const teamPref = toTeam(opts.teamPref);
    const team = spectator ? "S" : (teamPref === "R" ? this._pickTeamByUid(this.user.uid) : teamPref);

    const mode = this.mode;
    const defaults = this._defaultsForMode(mode);

    const { code: roomId, ref: roomRef } = await this._getAvailableRoomRef();

    await setDoc(roomRef, {
      mode,
      status: "lobby",
      modeStatus: `${mode}|lobby`,
      hostUid: this.user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      startAtMs: null,
      seed,
      version: "4.5Beta",
      settings: {
        mapId: defaults.mapId,
        maxPlayers: 8,

        // gameplay
        friendlyFire: false,
        joinInProgress: true,
        timeLimitSec: 900,
        // Tickets are Zone-only. Other modes ignore/disable this.
        ticketLimit: (mode === "zone") ? 200 : null,
        respawnDelaySec: 5,

        // zone/conq capture tuning (one step)
        captureStepSec: defaults.captureStepSec,

        // economy (room-level)
        economy: {
          baseIncomePer30Sec: 100,
          killReward: 300,
          damageRewardMul: 1,
          headshotRewardMul: 2,
        },

        // bots
        botsEnabled: false,

        // privacy
        isPrivate: false,
        password: "",

        region: "auto",
      }
    });

    await this._upsertPlayer(roomId, {
      uid: this.user.uid,
      name,
      classId,
      team,
      teamPref,
      spectator,
      ready: false,
      isBot: false,
    });

    return roomId;
  }

  async joinRoom(roomId, { name, classId }, opts = {}){
    const roomRef = doc(this.db, "rooms", roomId);
    const snap = await getDoc(roomRef);
    if(!snap.exists()) throw new Error("방이 존재하지 않습니다.");
    const room = snap.data();
    if(room.status !== "lobby") throw new Error("이미 게임이 시작됐거나 종료된 방입니다.");

    // privacy check
    const isPrivate = !!room.settings?.isPrivate;
    const pw = String(room.settings?.password ?? "");
    const provided = String(opts.password ?? "");
    if(isPrivate){
      if(!pw) throw new Error("비공개 방이지만 비밀번호가 설정되어 있지 않습니다. (호스트 확인 필요)");
      if(provided !== pw) throw new Error("비밀번호가 올바르지 않습니다.");
    }

    const spectator = !!opts.spectator;
    const teamPref = toTeam(opts.teamPref);

    // Assign team
    let team = "A";
    if(spectator){
      team = "S";
    }else if(teamPref === "A" || teamPref === "B"){
      team = teamPref;
    }else{
      team = this._pickTeamByUid(this.user.uid);
    }

    await this._upsertPlayer(roomId, {
      uid: this.user.uid,
      name,
      classId,
      team,
      teamPref,
      spectator,
      ready: false,
      isBot: false,
    });

    await updateDoc(roomRef, { updatedAt: serverTimestamp() });

    return roomId;
  }

  async leaveRoom(roomId){
    const uid = this.user.uid;
    const playerRef = doc(this.db, "rooms", roomId, "players", uid);
    try{ await deleteDoc(playerRef); }catch{}

    // Host transfer (best-effort)
    const roomRef = doc(this.db, "rooms", roomId);
    const snap = await getDoc(roomRef);
    if(!snap.exists()) return;

    const room = snap.data();
    if(room.hostUid !== uid) return;

    const mode = room.mode || this.mode;

    // If host left, mark ended to keep it simple (clients will auto-exit)
    try{
      await updateDoc(roomRef, {
        status: "ended",
        modeStatus: `${mode}|ended`,
        updatedAt: serverTimestamp(),
        endedAt: serverTimestamp(),
      });
    }catch{}
  }

  subscribeRoom(roomId, { onRoom, onPlayers }){
    this._clearRoomSubs();

    const roomRef = doc(this.db, "rooms", roomId);
    this.unsubRoom = onSnapshot(roomRef, (snap)=>{
      if(!snap.exists()){
        onRoom?.(null);
        return;
      }
      onRoom?.({ id: roomId, ...snap.data() });
    }, (err)=>onRoom?.(null, err));

    const playersRef = collection(this.db, "rooms", roomId, "players");
    this.unsubPlayers = onSnapshot(playersRef, (snap)=>{
      const players = [];
      snap.forEach(d=>players.push({ id:d.id, ...d.data() }));
      players.sort((a,b)=>{
        const ta = a.joinedAtMs ?? 0;
        const tb = b.joinedAtMs ?? 0;
        return ta - tb;
      });
      onPlayers?.(players);
    }, (err)=>onPlayers?.([], err));
  }

  _clearRoomSubs(){
    try{ this.unsubRoom?.(); }catch{}
    try{ this.unsubPlayers?.(); }catch{}
    this.unsubRoom = null;
    this.unsubPlayers = null;
  }

  async setReady(roomId, ready){
    const uid = this.user.uid;
    const ref = doc(this.db, "rooms", roomId, "players", uid);
    await updateDoc(ref, { ready: !!ready, lastSeenAt: serverTimestamp() });
  }

  async updateMyPlayer(roomId, patch){
    const uid = this.user.uid;
    const ref = doc(this.db, "rooms", roomId, "players", uid);
    await setDoc(ref, { uid, ...patch, lastSeenAt: serverTimestamp() }, { merge: true });
  }

  // patch keys are under settings.* ; keys may include dots (e.g. "economy.killReward")
  async updateSettings(roomId, patch){
    const roomRef = doc(this.db, "rooms", roomId);
    const updates = { updatedAt: serverTimestamp() };
    for(const [k,v] of Object.entries(patch || {})){
      updates[`settings.${k}`] = v;
    }
    await updateDoc(roomRef, updates);
  }

  async updateRoomMode(roomId, newMode){
    const roomRef = doc(this.db, "rooms", roomId);
    const snap = await getDoc(roomRef);
    if(!snap.exists()) throw new Error("방이 존재하지 않습니다.");
    const room = snap.data();
    if(room.hostUid !== this.user.uid) throw new Error("호스트만 변경할 수 있습니다.");
    if(room.status !== "lobby") throw new Error("게임 시작 후에는 변경할 수 없습니다.");

    const mode = String(newMode || "").trim();
    if(!["zone","conquest","frontline"].includes(mode)) throw new Error("잘못된 모드");

    const defaults = this._defaultsForMode(mode);

    // Zone-only ticket defaults
    const ticketLimit = (mode === "zone") ? 200 : null;

    await updateDoc(roomRef, {
      mode,
      modeStatus: `${mode}|${room.status}`,
      updatedAt: serverTimestamp(),
      "settings.mapId": defaults.mapId,
      "settings.captureStepSec": defaults.captureStepSec,
      "settings.ticketLimit": ticketLimit,
    });

    return mode;
  }

  async addBot(roomId, team){
    const roomRef = doc(this.db, "rooms", roomId);
    const snap = await getDoc(roomRef);
    if(!snap.exists()) throw new Error("방이 존재하지 않습니다.");
    const room = snap.data();
    if(room.hostUid !== this.user.uid) throw new Error("호스트만 봇을 추가할 수 있습니다.");
    if(room.status !== "lobby") throw new Error("게임 시작 후에는 봇을 추가할 수 없습니다.");
    if(!room.settings?.botsEnabled) throw new Error("봇 설정이 OFF 입니다.");

    const t = (team === "B") ? "B" : "A";
    const botId = "BOT_" + Math.random().toString(36).slice(2,8).toUpperCase();
    const ref = doc(this.db, "rooms", roomId, "players", botId);

    await setDoc(ref, {
      uid: botId,
      name: `BOT-${botId.slice(4)}`,
      team: t,
      teamPref: t,
      spectator: false,
      classId: "assault",
      ready: true,
      isBot: true,
      joinedAt: serverTimestamp(),
      joinedAtMs: Date.now(),
      lastSeenAt: serverTimestamp(),
    }, { merge: true });

    await updateDoc(roomRef, { updatedAt: serverTimestamp() });
    return botId;
  }

  async removeBot(roomId, botUid){
    const roomRef = doc(this.db, "rooms", roomId);
    const snap = await getDoc(roomRef);
    if(!snap.exists()) return;
    const room = snap.data();
    if(room.hostUid !== this.user.uid) throw new Error("호스트만 봇을 제거할 수 있습니다.");
    const ref = doc(this.db, "rooms", roomId, "players", botUid);
    await deleteDoc(ref);
    await updateDoc(roomRef, { updatedAt: serverTimestamp() });
  }

  async setBotTeam(roomId, botUid, team){
    const roomRef = doc(this.db, "rooms", roomId);
    const snap = await getDoc(roomRef);
    if(!snap.exists()) return;
    const room = snap.data();
    if(room.hostUid !== this.user.uid) throw new Error("호스트만 봇 팀을 바꿀 수 있습니다.");
    if(room.status !== "lobby") throw new Error("게임 시작 후에는 변경할 수 없습니다.");

    const t = (team === "B") ? "B" : "A";
    const botRef = doc(this.db, "rooms", roomId, "players", botUid);
    // Best-effort: only update fields that matter. If the doc is not a bot, this still works,
    // but the UI only exposes this for bots.
    await updateDoc(botRef, { team: t, teamPref: t, spectator: false, updatedAt: serverTimestamp() });
    await updateDoc(roomRef, { updatedAt: serverTimestamp() });
  }

  async startGame(roomId){
    const roomRef = doc(this.db, "rooms", roomId);
    const snap = await getDoc(roomRef);
    if(!snap.exists()) throw new Error("방이 존재하지 않습니다.");
    const room = snap.data();
    if(room.hostUid !== this.user.uid) throw new Error("호스트만 시작할 수 있습니다.");
    if(room.status !== "lobby") throw new Error("이미 시작된 방입니다.");

    const mode = room.mode || this.mode;

    // Start after 3 seconds (client-side time). We'll refine with WS time sync later.
    const startAtMs = Date.now() + 3000;

    await updateDoc(roomRef, {
      status: "in_game",
      modeStatus: `${mode}|in_game`,
      startAtMs,
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return startAtMs;
  }

  async _upsertPlayer(roomId, { uid, name, classId, team, teamPref, spectator, ready, isBot }){
    const ref = doc(this.db, "rooms", roomId, "players", uid);
    await setDoc(ref, {
      uid,
      name: name ?? "Player",
      team: team ?? "A",
      teamPref: teamPref ?? "R",
      spectator: !!spectator,
      classId: classId ?? "assault",
      ready: !!ready,
      isBot: !!isBot,
      joinedAt: serverTimestamp(),
      joinedAtMs: Date.now(),
      lastSeenAt: serverTimestamp(),
    }, { merge: true });
  }

  _pickTeamByUid(uid){
    let hash = 0;
    for(let i=0;i<uid.length;i++) hash = (hash*31 + uid.charCodeAt(i))|0;
    return (hash & 1) ? "A" : "B";
  }

  _defaultsForMode(mode){
    if(mode === "zone") return { mapId: "zone_5_v1", captureStepSec: 8 };
    if(mode === "conquest") return { mapId: "conquest_5_v1", captureStepSec: 15 };
    if(mode === "frontline") return { mapId: "frontline_6_lane_v1", captureStepSec: 15 };
    return { mapId: "zone_5_v1", captureStepSec: 8 };
  }

  destroy(){
    this._clearRoomsSub();
    this._clearRoomSubs();
  }
}
