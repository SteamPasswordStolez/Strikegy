// src/game/ModeRuleSystem.js
// Patch 9-1: Mode rules + objective capture logic (Zone / Conquest / Frontline)
//
// Design goals:
// - Keep logic decoupled from rendering + bots.
// - Deterministic-ish, easy to tune.
//
// Terminology
// - team: 'blue' | 'red'
// - owner: 'blue' | 'red' | 'neutral'

const EPS = 1e-6;

function normTeam(t){
  const x = String(t || '').toLowerCase();
  return (x === 'red' || x === 't') ? 'red' : 'blue';
}

function ownerFromState(state){
  if(state === 1) return 'blue';
  if(state === -1) return 'red';
  return 'neutral';
}

function stateFromOwner(owner){
  const o = String(owner||'').toLowerCase();
  if(o === 'blue') return 1;
  if(o === 'red') return -1;
  return 0;
}

export class ModeRuleSystem {
  constructor({ mode='zone', map=null, getPlayer=null, getBots=null } = {}){
    this.mode = String(mode || 'zone').toLowerCase();
    this.map = map || { zones: [] };
    this.getPlayer = (typeof getPlayer === 'function') ? getPlayer : (()=>null);
    this.getBots = (typeof getBots === 'function') ? getBots : (()=>[]);

    // --- Common objective model
    this.order = this._deriveObjectiveOrder(this.map?.zones || []);
    this.objectives = this.order.map(id => {
      const z = (this.map?.zones || []).find(v => String(v?.id) === String(id)) || {};
      const pos = z.pos ?? z.position ?? [0,0,0];
      const radius = Number(z.radius ?? z.r ?? z.captureRadius ?? 22) || 22;
      return {
        id: String(id),
        x: Number(pos[0] ?? pos.x ?? 0) || 0,
        z: Number(pos[2] ?? pos.z ?? 0) || 0,
        radius,

        // Zone/Conquest: controlVal in [-1,1] (two-step capture)
        ownerState: 0,        // -1 red, 0 neutral, 1 blue
        controlVal: 0,        // float, moves toward desiredState

        // Frontline: controlVal in [-50,50] (two-step by boundaries)
        flOwnerState: 0,      // -50 red, 0 neutral, 50 blue
        flControlVal: 0,
      };
    });

    // --- Mode-specific match state
    this._time = 0;

    // Zone tickets
    this.tickets = { blue: 200, red: 200 };

    // Conquest timer (seconds)
    this.conquestTimeTotal = 15 * 60;
    this.conquestTimeLeft = this.conquestTimeTotal;

    // Frontline swap timer
    this.frontlineSwapTotal = 5 * 60;
    this.frontlineSwapLeft = this.frontlineSwapTotal;

    // Attack/defense teams
    this.attackTeam = 'blue';
    this.defenseTeam = 'red';

    // Active objective (one-at-a-time modes)
    this.activeObjectiveId = (this.order[0] || null);

    // Match end
    this.ended = false;
    this.winner = null; // 'blue'|'red'

    this._initOwnership();
  }

  // -------------------------
  // Init ownership per mode
  // -------------------------
  _initOwnership(){
    const n = this.objectives.length;
    if(this.mode === 'conquest'){
      // Defender starts with everything, attacker starts with the first objective.
      // (Maps can override later; for now keep deterministic default.)
      const startId = this.order[0] || null;
      for(const o of this.objectives){
        const isStart = (String(o.id) === String(startId));
        const owner = isStart ? this.attackTeam : this.defenseTeam;
        o.ownerState = stateFromOwner(owner);
        o.controlVal = o.ownerState;
      }
      this.activeObjectiveId = this._getNextConquestObjective();
    }else if(this.mode === 'frontline'){
      // Split objectives into 3/3 (or half/half) by order.
      const half = Math.floor(n / 2);
      for(let i=0;i<n;i++){
        const owner = (i < half) ? 'blue' : 'red';
        const st = owner === 'blue' ? 50 : -50;
        this.objectives[i].flOwnerState = st;
        this.objectives[i].flControlVal = st;
      }
      this.attackTeam = 'blue';
      this.defenseTeam = 'red';
      this.frontlineSwapLeft = this.frontlineSwapTotal;
      this.activeObjectiveId = this._getFrontlineActiveObjective();
    }else{
      // Zone: start neutral
      for(const o of this.objectives){
        o.ownerState = 0;
        o.controlVal = 0;
      }
      this.tickets.blue = 200;
      this.tickets.red = 200;
    }
  }

  _deriveObjectiveOrder(zones){
    const ids = (zones || []).map(z => String(z?.id ?? '')).filter(Boolean);
    // Prefer alphabetic; stable default.
    return ids.sort((a,b)=> a.localeCompare(b));
  }

  // -------------------------
  // Public API
  // -------------------------
  onDeath(team){
    if(this.ended) return;
    if(this.mode !== 'zone') return;
    const t = normTeam(team);
    this.tickets[t] = Math.max(0, (this.tickets[t] || 0) - 1);
    if(this.tickets[t] <= 0){
      this._endMatch(t === 'blue' ? 'red' : 'blue');
    }
  }

  setConquestTimeMinutes(min){
    const m = Math.max(1, Math.min(30, Number(min)||15));
    this.conquestTimeTotal = Math.floor(m * 60);
    this.conquestTimeLeft = Math.min(this.conquestTimeLeft, this.conquestTimeTotal);
  }

  update(dt){
    const d = Math.max(0, Number(dt)||0);
    this._time += d;
    if(this.ended) return;

    // Tick timers
    if(this.mode === 'conquest'){
      this.conquestTimeLeft = Math.max(0, this.conquestTimeLeft - d);
      if(this.conquestTimeLeft <= 0){
        // Defender wins if time runs out
        this._endMatch(this.defenseTeam);
        return;
      }
    }
    if(this.mode === 'frontline'){
      this.frontlineSwapLeft = Math.max(0, this.frontlineSwapLeft - d);
      if(this.frontlineSwapLeft <= 0){
        this._swapFrontlineRoles('timer');
      }
    }

    // Capture update
    if(this.mode === 'frontline'){
      this._updateFrontlineCapture(d);
    }else{
      this._updateTimeRatioCapture(d);
    }

    // Win checks
    if(this.mode === 'conquest'){
      const allOwned = this.objectives.every(o => ownerFromState(o.ownerState) === this.attackTeam);
      if(allOwned){
        this._endMatch(this.attackTeam);
        return;
      }
      // refresh active objective
      this.activeObjectiveId = this._getNextConquestObjective();
    }
    if(this.mode === 'frontline'){
      this.activeObjectiveId = this._getFrontlineActiveObjective();
    }
  }

  // For UI + minimap
  getZoneStates(){
    if(this.mode === 'frontline'){
      return this.objectives.map(o => ({
        id: o.id,
        owner: ownerFromState(this._frontlineOwnerStateToTeamState(o.flOwnerState)),
        progress: this._frontlineProgress01(o),
      }));
    }
    return this.objectives.map(o => ({
      id: o.id,
      owner: ownerFromState(o.ownerState),
      progress: this._timeRatioProgress01(o),
    }));
  }

  getUIState(){
    const mode = this.mode;
    const objectives = this.objectives.map(o => {
      let owner = 'neutral', progress=0;
      if(mode === 'frontline'){
        owner = ownerFromState(this._frontlineOwnerStateToTeamState(o.flOwnerState));
        progress = this._frontlineProgress01(o);
      }else{
        owner = ownerFromState(o.ownerState);
        progress = this._timeRatioProgress01(o);
      }
      return {
        id: o.id,
        owner,
        progress,
        isActive: (this.activeObjectiveId && String(this.activeObjectiveId) === String(o.id)),
      };
    });

    const player = this.getPlayer?.();
    const inside = this._getPlayerInsideObjective(player);

    return {
      mode,
      ended: this.ended,
      winner: this.winner,
      tickets: (mode === 'zone') ? { ...this.tickets } : null,
      conquestTimeLeft: (mode === 'conquest') ? this.conquestTimeLeft : null,
      attackTeam: (mode === 'conquest' || mode === 'frontline') ? this.attackTeam : null,
      defenseTeam: (mode === 'conquest' || mode === 'frontline') ? this.defenseTeam : null,
      frontlineSwapLeft: (mode === 'frontline') ? this.frontlineSwapLeft : null,
      activeObjectiveId: this.activeObjectiveId,
      objectives,
      playerContext: inside,
    };
  }

  // -------------------------
  // Zone/Conquest capture (time/ratio)
  // -------------------------
  _updateTimeRatioCapture(dt){
    const stepSec = (this.mode === 'conquest') ? 20 : 8;

    const activeOnly = (this.mode === 'conquest');
    const activeId = this.activeObjectiveId;

    for(const o of this.objectives){
      if(activeOnly && activeId && String(o.id) !== String(activeId)) continue;

      const counts = this._countTeamsInObjective(o);
      const b = counts.blue, r = counts.red;
      if(b === r) continue;
      if(b <= 0 && r <= 0) continue;

      const advTeam = (b > r) ? 'blue' : 'red';
      const ownerTeam = ownerFromState(o.ownerState);

      let desiredState;
      if(o.ownerState === 0){
        desiredState = (advTeam === 'blue') ? 1 : -1;
      }else if(ownerTeam === advTeam){
        desiredState = o.ownerState; // defend back to full
      }else{
        desiredState = 0; // neutralize first
      }

      const adv = Math.abs(b - r);
      const total = Math.max(1, b + r);
      const ratio = Math.max(0, Math.min(1, adv / total));
      if(ratio <= 0) continue;

      const speed = ratio / Math.max(0.001, stepSec); // 1.0 distance per stepSec at ratio=1
      o.controlVal = this._moveToward(o.controlVal, desiredState, speed * dt);

      // Snap + stage completion
      if(Math.abs(o.controlVal - desiredState) <= 1e-4){
        o.controlVal = desiredState;
        if(desiredState === 0 && o.ownerState !== 0){
          o.ownerState = 0;
        }else if((desiredState === 1 || desiredState === -1) && o.ownerState === 0){
          o.ownerState = desiredState;
        }

        // Conquest: if attacker captured active objective, advance.
        if(this.mode === 'conquest'){
          if(String(o.id) === String(this.activeObjectiveId)){
            const attackerState = (this.attackTeam === 'blue') ? 1 : -1;
            if(o.ownerState === attackerState){
              this.activeObjectiveId = this._getNextConquestObjective();
            }
          }
        }
      }
    }
  }

  _timeRatioProgress01(o){
    // 0..1 in current stage (distance from ownerState toward neutral/target).
    // If ownerState is team: stage to neutral uses controlVal in [0..1] distance.
    // If ownerState is neutral: stage to team uses controlVal distance.
    try{
      if(this.mode === 'frontline') return 0;
      const st = o.ownerState;
      const v = o.controlVal;
      if(st === 0){
        return Math.min(1, Math.abs(v - 0));
      }
      // st is -1 or +1
      return Math.min(1, Math.abs(v - st));
    }catch{ return 0; }
  }

  // -------------------------
  // Frontline capture (count-per-second)
  // -------------------------
  _frontlineOwnerStateToTeamState(flOwnerState){
    if(flOwnerState >= 50) return 1;
    if(flOwnerState <= -50) return -1;
    return 0;
  }

  _updateFrontlineCapture(dt){
    const activeId = this._getFrontlineActiveObjective();
    if(!activeId) return;

    const o = this.objectives.find(v => String(v.id) === String(activeId));
    if(!o) return;

    const counts = this._countTeamsInObjective(o);
    const b = counts.blue, r = counts.red;
    if(b === r) return;
    if(b <= 0 && r <= 0) return;

    const diff = b - r; // + means blue advantage
    const advTeam = (diff > 0) ? 'blue' : 'red';

    // Desired state based on current discrete owner and advantage.
    const ownerTeam = this._frontlineOwnerFrom(o);
    let desired;
    if(o.flOwnerState === 0){
      desired = (advTeam === 'blue') ? 50 : -50;
    }else if(ownerTeam === advTeam){
      desired = o.flOwnerState; // defend back to full
    }else{
      desired = 0; // neutralize
    }

    // Speed: 1 per second per advantage player (spec)
    const speed = Math.abs(diff); // units per second
    o.flControlVal = this._moveToward(o.flControlVal, desired, speed * dt);

    if(Math.abs(o.flControlVal - desired) <= 1e-4){
      o.flControlVal = desired;
      if(desired === 0 && o.flOwnerState !== 0){
        o.flOwnerState = 0;
      }else if((desired === 50 || desired === -50) && o.flOwnerState === 0){
        o.flOwnerState = desired;
        // If defender lost the active objective, swap roles immediately.
        const newOwner = this._frontlineOwnerFrom(o);
        if(newOwner === this.attackTeam){
          this._swapFrontlineRoles('capture');
        }
      }
    }
  }

  _frontlineOwnerFrom(o){
    if(o.flOwnerState >= 50) return 'blue';
    if(o.flOwnerState <= -50) return 'red';
    return 'neutral';
  }

  _frontlineProgress01(o){
    // 0..1 within current stage (distance from ownerState toward desired boundary)
    try{
      const st = o.flOwnerState;
      const v = o.flControlVal;
      if(st === 0){
        return Math.min(1, Math.abs(v) / 50);
      }
      return Math.min(1, Math.abs(v - st) / 50);
    }catch{ return 0; }
  }

  _swapFrontlineRoles(reason='timer'){
    // swap attack/defense and reset swap timer
    const prevA = this.attackTeam;
    this.attackTeam = this.defenseTeam;
    this.defenseTeam = prevA;
    this.frontlineSwapLeft = this.frontlineSwapTotal;
    this.activeObjectiveId = this._getFrontlineActiveObjective();
    // eslint-disable-next-line no-console
    console.log('[Frontline] roles swapped:', { reason, attack: this.attackTeam, defense: this.defenseTeam });
  }

  // -------------------------
  // Active objective helpers
  // -------------------------
  _getNextConquestObjective(){
    // Attacker can only take objectives in order. Find first not owned by attacker.
    const attackerState = (this.attackTeam === 'blue') ? 1 : -1;
    for(const id of this.order){
      const o = this.objectives.find(v => String(v.id) === String(id));
      if(!o) continue;
      if(o.ownerState !== attackerState) return o.id;
    }
    return null;
  }

  _getFrontlineActiveObjective(){
    // Determine boundary between attackTeam and defenseTeam.
    const n = this.objectives.length;
    if(n <= 0) return null;
    const order = this.order;
    const own = (id)=>{
      const o = this.objectives.find(v=>String(v.id)===String(id));
      if(!o) return 'neutral';
      return this._frontlineOwnerFrom(o);
    };

    // Scan adjacent pairs in order; pick the objective that belongs to defenseTeam adjacent to attacker.
    for(let i=0;i<order.length-1;i++){
      const a = own(order[i]);
      const b = own(order[i+1]);
      if(a === this.attackTeam && b === this.defenseTeam){
        return order[i+1];
      }
      if(a === this.defenseTeam && b === this.attackTeam){
        return order[i];
      }
    }

    // Fallback: if somehow all same, choose middle.
    return order[Math.floor(order.length/2)] || order[0] || null;
  }

  // -------------------------
  // Counting + player context
  // -------------------------
  _countTeamsInObjective(o){
    let blue=0, red=0;
    const p = this.getPlayer?.();
    if(p && p.alive !== false && p.pos){
      const t = normTeam(p.team);
      if(this._isInside(o, p.pos.x, p.pos.z)){
        if(t === 'blue') blue++; else red++;
      }
    }
    const bots = this.getBots?.() || [];
    for(const b of bots){
      if(!b || b.alive === false) continue;
      const pos = b.pos || b.position;
      if(!pos) continue;
      const x = Number(pos.x ?? pos[0] ?? 0) || 0;
      const z = Number(pos.z ?? pos[2] ?? 0) || 0;
      if(!this._isInside(o, x, z)) continue;
      const t = normTeam(b.team);
      if(t === 'blue') blue++; else red++;
    }
    return { blue, red };
  }

  _getPlayerInsideObjective(player){
    if(!player || !player.pos) return null;
    const px = player.pos.x, pz = player.pos.z;
    const t = normTeam(player.team);

    // Find the closest objective the player is inside (helps when circles overlap).
    let best=null;
    for(const o of this.objectives){
      if(!this._isInside(o, px, pz)) continue;
      const dx = o.x - px;
      const dz = o.z - pz;
      const d2 = dx*dx + dz*dz;
      if(!best || d2 < best.d2) best = { o, d2 };
    }
    if(!best) return null;
    const o = best.o;

    const activeOnly = (this.mode === 'conquest' || this.mode === 'frontline');
    const locked = activeOnly && this.activeObjectiveId && String(this.activeObjectiveId) !== String(o.id);

    const counts = this._countTeamsInObjective(o);
    const totalIn = (counts.blue + counts.red);
    const contested = counts.blue === counts.red && totalIn > 0;
    const advTeam = (!contested && totalIn > 0 && counts.blue !== counts.red)
      ? (counts.blue > counts.red ? 'blue' : 'red')
      : null;

    let owner='neutral', progress=0;
    if(this.mode === 'frontline'){
      owner = ownerFromState(this._frontlineOwnerStateToTeamState(o.flOwnerState));
      progress = this._frontlineProgress01(o);
    }else{
      owner = ownerFromState(o.ownerState);
      progress = this._timeRatioProgress01(o);
    }

    // Phase hint for UI (ring): stable/capture/takeover/defend/contested/locked
    let phase = 'stable';
    if(locked) phase = 'locked';
    else if(contested) phase = 'contested';
    else if(advTeam){
      const ownerTeam = String(owner||'neutral').toLowerCase();
      if(ownerTeam === 'neutral') phase = 'capture';
      else if(ownerTeam !== advTeam) phase = 'takeover';
      else phase = 'defend';
    }

    return {
      insideObjectiveId: o.id,
      locked,
      owner,
      progress,
      counts,
      team: t,
      contested,
      advTeam,
      phase,
    };
  }

  _isInside(o, x, z){
    const dx = (Number(x)||0) - o.x;
    const dz = (Number(z)||0) - o.z;
    const r = Math.max(1, Number(o.radius)||22);
    return (dx*dx + dz*dz) <= (r*r);
  }

  // -------------------------
  // Utils
  // -------------------------
  _moveToward(from, to, delta){
    const f = Number(from)||0;
    const t = Number(to)||0;
    const d = Math.max(0, Number(delta)||0);
    if(Math.abs(t - f) <= EPS) return t;
    const dir = (t > f) ? 1 : -1;
    const next = f + dir * d;
    if((dir > 0 && next >= t) || (dir < 0 && next <= t)) return t;
    return next;
  }

  _endMatch(winnerTeam){
    this.ended = true;
    this.winner = normTeam(winnerTeam);
    // eslint-disable-next-line no-console
    console.log('[ModeRuleSystem] match ended:', { mode:this.mode, winner:this.winner });
  }
}
