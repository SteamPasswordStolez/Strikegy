// src/modes/ModeRuleSystem.js
// Patch 9-1: Mode rules + objective capture state (Zone / Conquest / Frontline)
// - Zone: multi-objective capture, tickets decrease on death only (default 200).
// - Conquest: sequential capture; only one active objective can be captured at a time.
// - Frontline: single active frontline objective; capture value -50..+50 with (b-r) per second; role swap timer + swap on defense objective lost.

export const TEAM = {
  BLUE: "BLUE",
  RED: "RED",
  NEUTRAL: "NEUTRAL",
};

function normTeam(t){
  if(!t) return TEAM.NEUTRAL;
  const s = String(t).toUpperCase();
  if(s === "BLUE") return TEAM.BLUE;
  if(s === "RED") return TEAM.RED;
  return TEAM.NEUTRAL;
}

function dist2XZ(a,b){
  const dx = (a.x ?? a[0]) - (b.x ?? b[0]);
  const dz = (a.z ?? a[2]) - (b.z ?? b[2]);
  return dx*dx + dz*dz;
}

function sortedZoneIds(zones){
  return zones.map(z=>String(z.id)).sort((a,b)=>a.localeCompare(b, "en", { numeric:true }));
}

export class ModeRuleSystem {
  constructor({ mode="zone", zones=[] } = {}){
    this.mode = mode;
    this.zones = zones;
    this.stateById = new Map();
    this.order = sortedZoneIds(zones);
    this.attackTeam = TEAM.BLUE; // Frontline: current attacker
    this.swapEverySec = 300; // 5 min
    this.swapLeft = this.swapEverySec;
    this.conquestTimeLimitSec = 15*60; // default 15min
    this.conquestLeft = this.conquestTimeLimitSec;
    this.zoneTickets = { [TEAM.BLUE]: 200, [TEAM.RED]: 200 };

    this.activeObjectiveId = null;
    this._initForMode();
  }

  setMode(mode){
    this.mode = mode;
    this._initForMode();
  }

  setZones(zones){
    this.zones = zones || [];
    this.order = sortedZoneIds(this.zones);
    this._initForMode();
  }

  setConquestTimeLimit(minutes){
    const m = Math.max(1, Number(minutes)||15);
    this.conquestTimeLimitSec = Math.round(m*60);
    this.conquestLeft = this.conquestTimeLimitSec;
  }

  _initForMode(){
    this.stateById.clear();
    for(const z of this.zones){
      this.stateById.set(String(z.id), {
        id: String(z.id),
        owner: TEAM.NEUTRAL,
        // zone/conquest step capture
        cap01: 0,
        // frontline capture value
        capVal: 0,
      });
    }

    if(this.mode === "zone"){
      // start neutral
      this.activeObjectiveId = null; // any zone is active
      this.zoneTickets = { [TEAM.BLUE]: 200, [TEAM.RED]: 200 };
    } else if(this.mode === "conquest"){
      // sequential: attacker owns the first objective only, defender owns the rest.
      const first = this.order[0] || null;
      for(const id of this.order){
        const st = this.stateById.get(id);
        if(!st) continue;
        st.owner = (id === first) ? TEAM.BLUE : TEAM.RED;
        st.cap01 = 0;
      }
      this.activeObjectiveId = this._computeConquestActive();
      this.conquestLeft = this.conquestTimeLimitSec;
    } else if(this.mode === "frontline"){
      // split half/half (3/3 if 6)
      const n = this.order.length;
      const split = Math.floor(n/2);
      for(let i=0;i<n;i++){
        const id=this.order[i];
        const st=this.stateById.get(id);
        if(!st) continue;
        if(i < split){
          st.owner = TEAM.BLUE;
          st.capVal = +50;
        }else{
          st.owner = TEAM.RED;
          st.capVal = -50;
        }
      }
      this.attackTeam = TEAM.BLUE; // initial
      this.swapLeft = this.swapEverySec;
      this.activeObjectiveId = this._computeFrontlineActive();
    } else {
      // fallback
      this.mode = "zone";
      this._initForMode();
    }
  }

  // ---- Public state getters
  getZoneStateList(){
    return this.order.map(id=>this.stateById.get(id)).filter(Boolean);
  }

  getActiveObjectiveId(){
    return this.activeObjectiveId;
  }

  getTickets(){
    return { ...this.zoneTickets };
  }

  getConquestTimeLeft(){
    return this.conquestLeft;
  }

  getFrontlineSwapLeft(){
    return this.swapLeft;
  }

  getFrontlineAttackTeam(){
    return this.attackTeam;
  }

  // ---- Events
  onEntityDeath(team){
    if(this.mode !== "zone") return;
    const t = normTeam(team);
    if(t !== TEAM.BLUE && t !== TEAM.RED) return;
    this.zoneTickets[t] = Math.max(0, (this.zoneTickets[t]||0) - 1);
  }

  // ---- Update capture
  update(dt, entities){
    // entities: [{team, pos:{x,z}, alive}]
    if(!dt) return;
    const list = Array.isArray(entities) ? entities : [];

    if(this.mode === "zone"){
      for(const z of this.zones){
        this._updateStepCapture(z, dt, list, 8); // 8 sec per step
      }
    } else if(this.mode === "conquest"){
      this.conquestLeft = Math.max(0, this.conquestLeft - dt);
      const active = this.activeObjectiveId;
      if(active){
        const z = this.zones.find(v=>String(v.id)===String(active));
        if(z) this._updateStepCapture(z, dt, list, 20, /*locked=*/false, /*conquest=*/true);
      }
      // keep all other zones locked (no progress)
      // win condition: attacker owns all
      this.activeObjectiveId = this._computeConquestActive();
    } else if(this.mode === "frontline"){
      this.swapLeft -= dt;
      if(this.swapLeft <= 0){
        this._swapRoles("timer");
      }
      const active = this.activeObjectiveId;
      if(active){
        const z = this.zones.find(v=>String(v.id)===String(active));
        if(z) this._updateFrontlineCapture(z, dt, list);
      }
      this.activeObjectiveId = this._computeFrontlineActive();
    }
  }

  // ---- Step capture (Zone/Conquest)
  _updateStepCapture(zone, dt, entities, stepSec, locked=false, conquest=false){
    const id = String(zone.id);
    const st = this.stateById.get(id);
    if(!st) return;

    // In conquest, only active objective is capturable; others are locked by caller
    if(conquest && this.activeObjectiveId && id !== String(this.activeObjectiveId)) return;

    const rad = (zone.radius ?? 20);
    const rad2 = rad*rad;
    let b=0, r=0;
    for(const e of entities){
      if(!e || e.alive === false) continue;
      const team = normTeam(e.team);
      if(team !== TEAM.BLUE && team !== TEAM.RED) continue;
      if(dist2XZ(e.pos, zone.pos) <= rad2){
        if(team === TEAM.BLUE) b++; else r++;
      }
    }
    if(b === r) return;
    const adv = (b > r) ? TEAM.BLUE : TEAM.RED;
    const total = b + r;
    const ratio = Math.abs(b - r) / total; // 0..1
    const rate = (ratio / Math.max(0.001, stepSec)); // cap01 per sec

    // Determine which step we're pushing: owner transition in 2 steps max.
    // If zone owner is adv -> we're "defending": do nothing (no progress).
    // Else we need to either move owner->neutral or neutral->adv.
    // We store cap01 in [0,1]. When reach 1, advance one step and reset to 0.
    if(st.owner === adv){
      // optional: allow "undo" if enemy has advantage while you own? We'll require step transitions only away from current owner.
      return;
    }

    // Can only move one direction per tick.
    st.cap01 = Math.min(1, st.cap01 + rate * dt);
    if(st.cap01 >= 1){
      // advance one step
      const from = st.owner;
      if(st.owner === TEAM.NEUTRAL){
        st.owner = adv;
      } else {
        // owner is opposite team
        st.owner = TEAM.NEUTRAL;
      }
      st.cap01 = 0;
      // If conquest and step moved, active objective might advance later in compute.
      st._lastOwnerChange = { from, to: st.owner, at: performance.now?.() || Date.now() };
    }
  }

  // ---- Frontline capture (active objective only)
  _updateFrontlineCapture(zone, dt, entities){
    const id = String(zone.id);
    const st = this.stateById.get(id);
    if(!st) return;
    const rad = (zone.radius ?? 20);
    const rad2 = rad*rad;
    let b=0, r=0;
    for(const e of entities){
      if(!e || e.alive === false) continue;
      const team = normTeam(e.team);
      if(team !== TEAM.BLUE && team !== TEAM.RED) continue;
      if(dist2XZ(e.pos, zone.pos) <= rad2){
        if(team === TEAM.BLUE) b++; else r++;
      }
    }
    if(b === r) return;

    const delta = (b - r); // per sec
    st.capVal = Math.max(-50, Math.min(50, st.capVal + delta * dt));

    const prevOwner = st.owner;
    if(st.capVal >= 50) st.owner = TEAM.BLUE;
    else if(st.capVal <= -50) st.owner = TEAM.RED;
    else if(Math.abs(st.capVal) < 0.0001) st.owner = TEAM.NEUTRAL;

    if(prevOwner !== st.owner){
      // if defense team lost the active objective, swap roles immediately (design)
      const defense = (this.attackTeam === TEAM.BLUE) ? TEAM.RED : TEAM.BLUE;
      if(prevOwner === defense && st.owner === this.attackTeam){
        this._swapRoles("captured");
      }
    }
  }

  _swapRoles(reason){
    this.attackTeam = (this.attackTeam === TEAM.BLUE) ? TEAM.RED : TEAM.BLUE;
    this.swapLeft = this.swapEverySec;
    this._lastSwapReason = reason;
  }

  // ---- Active objective calculations
  _computeConquestActive(){
    // active = first objective owned by defender that is immediately after the last attacker-owned in order
    // If attacker owns all => null.
    let lastBlueIdx = -1;
    for(let i=0;i<this.order.length;i++){
      const st=this.stateById.get(this.order[i]);
      if(st?.owner === TEAM.BLUE) lastBlueIdx = i;
    }
    if(lastBlueIdx >= this.order.length-1){
      return null;
    }
    const nextId = this.order[lastBlueIdx+1];
    // capturable only if owned by defender or neutral
    const stN = this.stateById.get(nextId);
    if(!stN) return null;
    return nextId;
  }

  _computeFrontlineActive(){
    // frontline boundary: last BLUE-owned index + 1 => first non-blue zone.
    // Active objective = first zone that is not owned by attacker adjacent to attacker's last owned zone.
    const att = this.attackTeam;
    const def = (att === TEAM.BLUE) ? TEAM.RED : TEAM.BLUE;

    // determine boundary for attacker: contiguous owned from its side is not strictly required; use order.
    // We'll set active as the first zone in order owned by defense (or neutral) that is adjacent to any attacker-owned immediate neighbor.
    // With linear order, it's boundary between highest index attacker zone and next.
    let attLastIdx = -1;
    for(let i=0;i<this.order.length;i++){
      const st=this.stateById.get(this.order[i]);
      if(st?.owner === att) attLastIdx = i;
    }
    const candidateIdx = Math.min(this.order.length-1, Math.max(0, attLastIdx+1));
    const candId = this.order[candidateIdx];
    const stC = this.stateById.get(candId);
    if(!stC) return null;
    // ensure it's not already attacker-owned; if it is (because attacker owns far), move further
    if(stC.owner === att){
      // find first not attacker after attLastIdx
      for(let j=attLastIdx+1;j<this.order.length;j++){
        const st=this.stateById.get(this.order[j]);
        if(st && st.owner !== att) return this.order[j];
      }
      return null;
    }
    return candId;
  }

  // ---- Game end checks (for UI/loop to use)
  getOutcome(){
    if(this.mode === "zone"){
      if(this.zoneTickets[TEAM.BLUE] <= 0) return { ended:true, winner: TEAM.RED, reason:"tickets" };
      if(this.zoneTickets[TEAM.RED] <= 0) return { ended:true, winner: TEAM.BLUE, reason:"tickets" };
      return { ended:false };
    }
    if(this.mode === "conquest"){
      const allBlue = this.order.every(id => this.stateById.get(id)?.owner === TEAM.BLUE);
      if(allBlue) return { ended:true, winner: TEAM.BLUE, reason:"captured_all" };
      if(this.conquestLeft <= 0) return { ended:true, winner: TEAM.RED, reason:"time" };
      return { ended:false };
    }
    if(this.mode === "frontline"){
      // optional: no hard end in 9-1. We'll keep endless until future patch.
      return { ended:false };
    }
    return { ended:false };
  }
}
