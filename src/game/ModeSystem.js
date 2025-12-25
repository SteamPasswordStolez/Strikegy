// src/game/ModeSystem.js
// Patch 9-1: Mode rules + zone capture core (Zone / Conquest / Frontline)
// Maintainable, deterministic state. UI pulls a summarized view from this.

export class ModeSystem {
  constructor({ mode = "zone", zones = [], opts = {} } = {}) {
    this.mode = (mode === "conquest" || mode === "frontline") ? mode : "zone";
    this.opts = opts || {};

    // Normalize zone list
    this.zones = (zones || []).map(z => ({
      id: String(z.id ?? "").trim(),
      shape: z.shape || "circle",
      pos: Array.isArray(z.pos) ? z.pos : [0,0,0],
      radius: Number(z.radius ?? 20),
    })).filter(z => z.id);

    // Deterministic order (A,B,C...)
    this.order = this.zones
      .map(z => z.id)
      .slice()
      .sort((a,b)=> a.localeCompare(b, undefined, { numeric:true, sensitivity:"base" }));

    // Per-zone capture state (Zone/Conquest)
    // owner: -1(red) 0(neutral) 1(blue)
    // prog: 0..1 progress toward changing owner by ONE STEP (opp->neutral or neutral->team)
    // capTeam: team pushing right now ("blue"/"red"/null)
    // phase: "idle"|"capture"|"decap"|"recover" (for UI direction)
    this.cap = new Map();
    for (const id of this.order) {
      this.cap.set(id, { owner: 0, prog: 0, capTeam: null, phase: "idle" });
    }

    // Zone tickets
    this.ticketsBlue = Number(opts.ticketsBlue ?? 200);
    this.ticketsRed = Number(opts.ticketsRed ?? 200);

    // Conquest config
    this.conquestTimeLimit = Number(opts.conquestTimeLimit ?? 15 * 60); // sec
    this.conquestTimeLeft = this.conquestTimeLimit;
    this.conquestAttacker = "blue";
    this.conquestDefender = "red";
    this.conquestFrontIndex = 0; // last attacker-owned index in order

    // Frontline config
    this.frontlineSwapSec = Number(opts.frontlineSwapSec ?? 5 * 60);
    

    // Frontline match time limit (A win condition)
    this.frontlineTimeLimit = Number(opts.frontlineTimeLimit ?? 15 * 60);
    this.frontlineTimeLeft = this.frontlineTimeLimit;
this.frontlineSwapLeft = this.frontlineSwapSec;
    this.frontlineAttacker = "blue"; // current attacker team
    this.frontlineDefender = "red";
    

    // Round end state
    this.roundEnded = false;
    this.roundResult = null;

    // Patch 9-3C: event queue (economy hooks, HUD, etc.)
    this._events = [];
// contiguous split index: count of BLUE zones from left
    this.frontlineIndex = Math.max(1, Math.min(this.order.length - 1, Math.floor(this.order.length / 2)));
    // frontline per-zone scalar (-50..+50)
    this.frontlineVal = new Map();
    for (const id of this.order) this.frontlineVal.set(id, 0);

    this._initOwnership();
  }

  _teamToSign(team){
    return (String(team).toLowerCase() === "red") ? -1 : 1;
  }
  _signToTeam(sign){
    return sign < 0 ? "red" : "blue";
  }

  _initOwnership(){
    if (this.mode === "zone") {
      // all neutral
      for (const id of this.order) {
        const s = this.cap.get(id);
        s.owner = 0; s.prog = 0; s.capTeam = null; s.phase="idle";
      }
      return;
    }

    if (this.mode === "conquest") {
      // attacker owns first, defender owns rest
      for (let i=0;i<this.order.length;i++){
        const id = this.order[i];
        const s = this.cap.get(id);
        s.owner = (i === 0) ? 1 : -1; // Blue attacker default
        s.prog = 0; s.capTeam = null; s.phase="idle";
      }
      this.conquestFrontIndex = 0;
      this.conquestTimeLeft = this.conquestTimeLimit;
      return;
    }

    // frontline
    // left half blue, right half red (contiguous)
    for (let i=0;i<this.order.length;i++){
      const id = this.order[i];
      const owner = (i < this.frontlineIndex) ? 1 : -1;
      const s = this.cap.get(id);
      s.owner = owner; s.prog = 0; s.capTeam = null; s.phase="idle";
      this.frontlineVal.set(id, owner * 50);
    }
    this.frontlineAttacker = "blue";
    this.frontlineDefender = "red";
    this.frontlineSwapLeft = this.frontlineSwapSec;
  }

  // Called by player/bot death hooks
  onDeath(team){
    if (this.mode !== "zone") return;
    const t = String(team).toLowerCase();
    if (t === "red") this.ticketsRed = Math.max(0, this.ticketsRed - 1);
    else this.ticketsBlue = Math.max(0, this.ticketsBlue - 1);
  }

  // Which zone is capturable in this mode right now?
  getActiveZoneId(){
    if (this.mode === "conquest") {
      const idx = this.conquestFrontIndex + 1;
      return (idx >= 0 && idx < this.order.length) ? this.order[idx] : null;
    }
    if (this.mode === "frontline") {
      if (this.frontlineAttacker === "blue") {
        const idx = this.frontlineIndex;
        return (idx >= 0 && idx < this.order.length) ? this.order[idx] : null;
      } else {
        const idx = this.frontlineIndex - 1;
        return (idx >= 0 && idx < this.order.length) ? this.order[idx] : null;
      }
    }
    return null;
  }

  // Patch 9-3C: consume and clear queued events
  consumeEvents(){
    const out = this._events;
    this._events = [];
    return out;
  }

  // Update capture logic each frame
  update(dt, { playerPos = null, playerTeam = "blue", playerAlive = true, bots = [] } = {}) {
    const dts = Math.max(0, Number(dt) || 0);

    // time limits
    if (this.mode === "conquest") {
      this.conquestTimeLeft = Math.max(0, this.conquestTimeLeft - dts);
    }
    if (this.mode === "frontline") {
      this.frontlineTimeLeft = Math.max(0, this.frontlineTimeLeft - dts);
      this.frontlineSwapLeft -= dts;
      if (this.frontlineSwapLeft <= 0) {
        this._frontlineSwapRoles("timer");
        this.frontlineSwapLeft = this.frontlineSwapSec;
      }
    }

    // Build entity list (positions + teams)
    const ents = [];
    if (playerPos && playerAlive) {
      ents.push({ id: "player", kind: "player", team: String(playerTeam).toLowerCase()==="red"?"red":"blue", pos: playerPos });
    }
    if (Array.isArray(bots)) {
      for (const b of bots) {
        if (!b || !b.alive || !b.mesh || !b.mesh.position) continue;
        const t = String(b.team || "red").toLowerCase()==="blue" ? "blue" : "red";
        ents.push({ id: String(b.id ?? ""), kind: "bot", team: t, pos: b.mesh.position });
      }
    }

    const active = this.getActiveZoneId();

    for (const zid of this.order) {
      const z = this._getZoneById(zid);
      if (!z) continue;

      // capturable gating
      let capturable = true;
      if (this.mode === "conquest" || this.mode === "frontline") {
        capturable = (zid === active);
      }

      // count inside + capture contributors
      let b=0, r=0;
      const blueIds = [];
      const redIds = [];
      if (capturable) {
        for (const e of ents) {
          if (!e?.pos) continue;
          const dx = e.pos.x - z.pos[0];
          const dz = e.pos.z - z.pos[2];
          if ((dx*dx + dz*dz) <= (z.radius*z.radius)) {
            if (e.team === "blue") { b++; if (e.id) blueIds.push(e.id); }
            else { r++; if (e.id) redIds.push(e.id); }
          }
        }
      }

      // Patch 9-3C: detect capture gauge movement for economy rewards
      const s = this.cap.get(zid);
      const prevProg = s ? s.prog : 0;
      const prevOwner = s ? s.owner : 0;

      if (this.mode === "frontline") {
        this._updateFrontlineZone(dts, zid, b, r);
      } else {
        const stepSec = (this.mode === "conquest") ? 20 : 8;
        this._updateStepZone(dts, zid, b, r, capturable, stepSec);
      }

      // emit events
      if (capturable && s) {
        const total = (b + r);
        if (total > 0 && b !== r) {
          const advTeam = (b > r) ? "blue" : "red";
          const advSign = (advTeam === "blue") ? 1 : -1;
          const ids = (advTeam === "blue") ? blueIds : redIds;
          // only reward when attacker is pushing gauge forward (capture/decap)
          if (s.owner !== advSign && (s.phase === "capture" || s.phase === "decap") && s.prog > prevProg + 1e-6) {
            this._events.push({ type: "ZONE_CAPTURING", team: advTeam, zoneId: zid, dt: dts, ids });
          }
          // capture completed: neutral -> team (not decap)
          if (prevOwner === 0 && s.owner === advSign) {
            this._events.push({ type: "ZONE_CAPTURE", team: advTeam, zoneId: zid, ids });
          }
        }
      }
    }

    // Win conditions
    if (!this.roundEnded) {
      if (this.mode === "zone") {
        if (this.ticketsBlue <= 0) this._endRound({ winner: "red", reason: "tickets" });
        else if (this.ticketsRed <= 0) this._endRound({ winner: "blue", reason: "tickets" });
      } else if (this.mode === "conquest") {
        if (this.conquestTimeLeft <= 0) {
          this._endRound({ winner: this.conquestDefender, reason: "time" });
        } else {
          // capture state lives in this.cap
          const allOwned = this.order.every(id => (this.cap.get(id)?.owner ?? 0) === 1);
          if (allOwned) this._endRound({ winner: this.conquestAttacker, reason: "all" });
        }
      } else if (this.mode === "frontline") {
        if (this.frontlineTimeLeft <= 0) {
          let blueOwned = 0, redOwned = 0;
          for (const id of this.order) {
            const o = this.cap.get(id)?.owner ?? 0;
            if (o > 0) blueOwned++;
            else if (o < 0) redOwned++;
          }
          if (blueOwned > redOwned) this._endRound({ winner: "blue", reason: "time" });
          else if (redOwned > blueOwned) this._endRound({ winner: "red", reason: "time" });
          else {
            const aid = this.getActiveZoneId();
            const v = Number(this.frontlineVal.get(aid) || 0);
            if (v > 0) this._endRound({ winner: "blue", reason: "time_tiebreak" });
            else if (v < 0) this._endRound({ winner: "red", reason: "time_tiebreak" });
            else this._endRound({ winner: "draw", reason: "time_tiebreak" });
          }
        }
      }
    }
  }

  _endRound(result){
    this.roundEnded = true;
    this.roundResult = result || { winner:"draw", reason:"unknown" };
  }

  getRoundResult(){
    return this.roundResult;
  }

  _getZoneById(id){
    // zones list is small; linear is ok.
    for (const z of this.zones) if (z.id === id) return z;
    return null;
  }

  _updateStepZone(dt, zid, blueCount, redCount, capturable, stepSec){
    const s = this.cap.get(zid);
    if (!s) return;

    // inactive zones freeze
    if (!capturable) {
      s.prog = 0; s.capTeam = null; s.phase = "idle";
      return;
    }

    const b = blueCount|0, r = redCount|0;
    const total = b + r;
    if (total <= 0 || b === r) {
      // contested or empty => no progress (keep current prog/phase)
      return;
    }

    const advTeam = (b > r) ? "blue" : "red";
    const advSign = (advTeam === "blue") ? 1 : -1;

    // Speed factor: net advantage / total
    const ratio = Math.max(0, Math.min(1, Math.abs(b - r) / total));
    const rate = (ratio / Math.max(0.01, stepSec)); // per sec
    const delta = rate * dt;

    // If we were progressing with another team on a NEUTRAL zone, and control flips, reset
    if (s.owner === 0 && s.capTeam && s.capTeam !== advTeam) {
      s.prog = 0;
      s.capTeam = advTeam;
      s.phase = "idle";
    }

    // Defender recovery: if advantage equals current owner, unwind progress
    if (s.owner === advSign) {
      if (s.prog > 0) {
        s.prog = Math.max(0, s.prog - delta);
        s.phase = "recover";
        if (s.prog <= 0) {
          s.capTeam = null;
          s.phase = "idle";
        }
      }
      return;
    }

    // Attacker progress: decap if owned by enemy, otherwise capture
    const isDecap = (s.owner !== 0 && s.owner !== advSign);
    s.capTeam = advTeam;

    s.prog = Math.min(1, s.prog + delta);
    s.phase = isDecap ? "decap" : "capture";

    if (s.prog >= 1) {
      // step complete: enemy->neutral OR neutral->attacker
      if (isDecap) s.owner = 0;
      else s.owner = advSign;
      s.prog = 0;
      s.capTeam = null;
      s.phase = "idle";

      // conquest advancement
      if (this.mode === "conquest") {
        const active = this.getActiveZoneId();
        if (active === zid && s.owner === 1) {
          // attacker is blue; if you later add attacker swap, adjust
          this.conquestFrontIndex = Math.min(this.order.length - 1, this.conquestFrontIndex + 1);
        }
      }
    }
  }

  _updateFrontlineZone(dt, zid, blueCount, redCount){
    const active = this.getActiveZoneId();
    const s = this.cap.get(zid);
    if (!s) return;

    // Only active zone changes; others stay hard-owned
    if (zid !== active) return;

    const b = blueCount|0, r = redCount|0;
    if (b === r) return;

    const net = b - r; // positive = blue advantage
    const v0 = Number(this.frontlineVal.get(zid) || 0);
    let v = v0 + net * dt;
    v = Math.max(-50, Math.min(50, v));
    this.frontlineVal.set(zid, v);

    // For UI: owner flips only at ends; neutral is exactly 0
    const prevOwner = s.owner;
    if (v >= 50) s.owner = 1;
    else if (v <= -50) s.owner = -1;
    else if (Math.abs(v) < 0.001) s.owner = 0;

    // Phase for UI: capturing pushes towards advTeam
    const advTeam = net > 0 ? "blue" : "red";
    s.capTeam = advTeam;
    s.phase = "capture"; // frontline is continuous; UI uses fillDeg + dir
    s.prog = Math.min(1, Math.abs(v) / 50);

    // Capture event: if endpoint reached and owner changed
    if (prevOwner !== s.owner && (s.owner === 1 || s.owner === -1)) {
      const attackerSign = this._teamToSign(this.frontlineAttacker);
      const defenderSign = this._teamToSign(this.frontlineDefender);

      // If attacker captured the active objective, shift frontline index
      if (s.owner === attackerSign) {
        if (this.frontlineAttacker === "blue") {
          this.frontlineIndex = Math.min(this.order.length - 1, this.frontlineIndex + 1);
        } else {
          this.frontlineIndex = Math.max(1, this.frontlineIndex - 1);
        }
        this._frontlineSwapRoles("capture");
        this.frontlineSwapLeft = this.frontlineSwapSec;
      } else if (s.owner === defenderSign) {
        // Defender "secured" it (could happen if it was neutral and defender pushed it)
        // Keep roles.
      }
    }
  }

  _frontlineSwapRoles(reason="timer"){
    const a = this.frontlineAttacker;
    this.frontlineAttacker = this.frontlineDefender;
    this.frontlineDefender = a;
  }

  // UI summary helpers
  getUIState({ playerPos = null } = {}){
    const active = this.getActiveZoneId();

    // find player current zone
    let inZoneId = null;
    if (playerPos) {
      for (const z of this.zones) {
        const dx = playerPos.x - z.pos[0];
        const dz = playerPos.z - z.pos[2];
        if ((dx*dx + dz*dz) <= (z.radius*z.radius)) { inZoneId = z.id; break; }
      }
    }

    const zones = this.order.map(id => {
      const s = this.cap.get(id);
      const locked = (this.mode === "conquest" || this.mode === "frontline") ? (id !== active) : false;

      // Determine filled pie for this zone (full fill for owned)
      let fillTeam = null;
      let fill = 0; // 0..1
      let dir = "cw"; // cw or ccw
      if (!s) {
        fillTeam = null; fill = 0; dir = "cw";
      } else if (s.phase === "decap" && s.owner !== 0) {
        // decapping current owner: show owner's color decreasing (CCW)
        fillTeam = (s.owner < 0) ? "red" : "blue";
        fill = Math.max(0, Math.min(1, 1 - s.prog));
        dir = "ccw";
      } else if (s.phase === "recover" && s.owner !== 0) {
        // defender recovering: show owner's color increasing back to full (CW)
        fillTeam = (s.owner < 0) ? "red" : "blue";
        fill = Math.max(0, Math.min(1, 1 - s.prog)); // as prog unwinds, fill goes to 1
        dir = "cw";
      } else if (s.phase === "capture" && s.owner === 0) {
        // capturing neutral: show attacker color increasing (CW)
        fillTeam = s.capTeam || "blue";
        fill = Math.max(0, Math.min(1, s.prog));
        dir = "cw";
      } else if (this.mode === "frontline" && id === active) {
        // frontline: fill reflects current owner-ish, but we just show the pushing side if contested
        const v = Number(this.frontlineVal.get(id) || 0);
        if (v >= 0) { fillTeam = "blue"; fill = Math.min(1, v / 50); dir = "cw"; }
        else { fillTeam = "red"; fill = Math.min(1, (-v) / 50); dir = "cw"; }
      } else {
        // stable state: full fill for owned, none for neutral
        if (s.owner === 0) { fillTeam = null; fill = 0; dir = "cw"; }
        else { fillTeam = (s.owner < 0) ? "red" : "blue"; fill = 1; dir = "cw"; }
      }

      return {
        id,
        owner: s ? s.owner : 0,
        active: id === active,
        locked,
        fillTeam,
        fill,
        dir,
      };
    });

    return {
      mode: this.mode,
      roundEnded: this.roundEnded,
      roundResult: this.roundResult,
      activeZoneId: active,
      inZoneId,
      tickets: { blue: this.ticketsBlue, red: this.ticketsRed },
      conquest: { timeLeft: this.conquestTimeLeft, timeLimit: this.conquestTimeLimit },
      frontline: { attacker: this.frontlineAttacker, defender: this.frontlineDefender,  swapLeft: this.frontlineSwapLeft, swapSec: this.frontlineSwapSec, timeLeft: this.frontlineTimeLeft, timeLimit: this.frontlineTimeLimit },
      zones,
    };
  }
}
