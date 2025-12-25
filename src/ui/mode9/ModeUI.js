// src/ui/mode9/ModeUI.js
// Patch 9-1: Mode HUD + Objectives bar + Capture widget + Hit feedback.
// This is lightweight DOM UI; game passes snapshots to update().

import { TEAM } from "../../modes/ModeRuleSystem.js";

function el(tag, css, parent){
  const d=document.createElement(tag);
  if(css) d.style.cssText = css;
  if(parent) parent.appendChild(d);
  return d;
}

function pad2(n){ return String(n).padStart(2,"0"); }
function fmtMMSS(sec){
  sec = Math.max(0, Math.floor(sec||0));
  const m = Math.floor(sec/60), s = sec%60;
  return `${pad2(m)}:${pad2(s)}`;
}

function ownerColor(owner){
  if(owner===TEAM.BLUE) return "rgba(80,170,255,0.85)";
  if(owner===TEAM.RED) return "rgba(255,90,90,0.85)";
  return "rgba(210,210,210,0.55)";
}

export class ModeUI {
  constructor({ root=document.body } = {}){
    this.root=root;

    this.wrap = el("div", `
      position:fixed; inset:0; pointer-events:none; z-index:10050;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color:white;
    `, root);

    // Top bar
    this.top = el("div", `
      position:absolute; left:50%; top:10px; transform:translateX(-50%);
      display:flex; gap:10px; align-items:center;
      padding:8px 12px; border-radius:16px;
      background: rgba(0,0,0,0.35); backdrop-filter: blur(6px);
      border: 1px solid rgba(255,255,255,0.12);
      font-size:14px; letter-spacing:0.2px;
    `, this.wrap);

    this.modeTxt = el("div", `font-weight:700;`, this.top);
    this.subTxt  = el("div", `opacity:0.95;`, this.top);

    // Objectives bar (mode-specific)
    this.objBar = el("div", `
      position:absolute; left:50%; top:52px; transform:translateX(-50%);
      display:flex; gap:6px; align-items:center;
      padding:6px 10px; border-radius:16px;
      background: rgba(0,0,0,0.25); backdrop-filter: blur(6px);
      border: 1px solid rgba(255,255,255,0.10);
      font-size:12px;
    `, this.wrap);

    // Capture widget
    this.capture = el("div", `
      position:absolute; left:50%; top:70%; transform:translate(-50%,-50%);
      width: 340px; max-width: 80vw;
      padding:10px 12px; border-radius:16px;
      background: rgba(0,0,0,0.35); backdrop-filter: blur(6px);
      border: 1px solid rgba(255,255,255,0.12);
      display:none;
    `, this.wrap);

    this.capTitle = el("div", `font-weight:800; font-size:14px; margin-bottom:8px;`, this.capture);
    this.capBar = el("div", `
      height:10px; border-radius:10px; overflow:hidden;
      background: rgba(255,255,255,0.14);
    `, this.capture);
    this.capFill = el("div", `height:100%; width:0%; background: rgba(80,170,255,0.9);`, this.capBar);
    this.capSub = el("div", `margin-top:8px; font-size:12px; opacity:0.9;`, this.capture);

    // Hit feedback
    this.hitMarker = el("div", `
      position:absolute; left:50%; top:50%;
      width:20px; height:20px; transform:translate(-50%,-50%) rotate(45deg);
      border: 2px solid rgba(255,255,255,0.0);
      border-left-color: rgba(255,255,255,0.0);
      border-top-color: rgba(255,255,255,0.0);
      pointer-events:none;
    `, this.wrap);

    this.vignette = el("div", `
      position:absolute; inset:0;
      background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(255,0,0,0.35) 100%);
      opacity:0;
      transition: opacity 120ms ease;
      pointer-events:none;
    `, this.wrap);

    this._hmT=0;
    this._vigT=0;
  }

  destroy(){
    this.wrap?.remove();
  }

  onPlayerHit({ kill=false } = {}){
    // show a quick hit marker
    this._hmT = 0.12;
    this.hitMarker.style.borderColor = kill ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.75)";
    this.hitMarker.style.borderLeftColor = "rgba(255,255,255,0)";
    this.hitMarker.style.borderTopColor  = "rgba(255,255,255,0)";
    this.hitMarker.style.opacity = "1";
    this.hitMarker.style.width = kill ? "26px" : "20px";
    this.hitMarker.style.height = kill ? "26px" : "20px";
  }

  onPlayerDamaged(strength=1){
    this._vigT = 0.18;
    const a = Math.max(0.12, Math.min(0.6, 0.25 + 0.35*(strength||0)));
    this.vignette.style.opacity = String(a);
  }

  update(dt, snap){
    // snap: { mode, tickets, conquestLeft, attackTeam, swapLeft, activeObjectiveId, zones:[{id,owner,cap01,capVal}], playerInZone:{id, kind, progressPct, statusText, fillOwner} }
    if(dt){
      if(this._hmT>0){
        this._hmT -= dt;
        if(this._hmT<=0){
          this.hitMarker.style.opacity="0";
        }
      }
      if(this._vigT>0){
        this._vigT -= dt;
        if(this._vigT<=0){
          this.vignette.style.opacity="0";
        }
      }
    }

    const mode = snap?.mode || "zone";
    this.modeTxt.textContent = mode.toUpperCase();

    // Top status line
    if(mode === "zone"){
      const t = snap?.tickets || {};
      this.subTxt.textContent = `BLUE ${t.BLUE ?? "-"}  ·  RED ${t.RED ?? "-"}`;
    } else if(mode === "conquest"){
      const left = fmtMMSS(snap?.conquestLeft ?? 0);
      const act = snap?.activeObjectiveId ? `ACTIVE ${snap.activeObjectiveId}` : `ALL CAPTURED`;
      this.subTxt.textContent = `ATTACK BLUE · DEFEND RED · TIME ${left} · ${act}`;
    } else if(mode === "frontline"){
      const left = fmtMMSS(snap?.swapLeft ?? 0);
      const atk = snap?.attackTeam || TEAM.BLUE;
      const def = (atk===TEAM.BLUE)?TEAM.RED:TEAM.BLUE;
      const act = snap?.activeObjectiveId ? `FRONT ${snap.activeObjectiveId}` : `FRONT -`;
      this.subTxt.textContent = `ATTACK ${atk} · DEFEND ${def} · SWAP ${left} · ${act}`;
    } else {
      this.subTxt.textContent = "";
    }

    // Objectives bar
    this.objBar.innerHTML = "";
    const zs = snap?.zones || [];
    if(mode === "zone"){
      for(const z of zs){
        const b = document.createElement("div");
        b.textContent = z.id;
        b.style.cssText = `
          width:22px; height:22px; border-radius:10px;
          display:flex; align-items:center; justify-content:center;
          background: ${ownerColor(z.owner)};
          border: 1px solid rgba(255,255,255,0.12);
          font-weight:700;
        `;
        this.objBar.appendChild(b);
      }
    } else if(mode === "conquest" || mode === "frontline"){
      for(const z of zs){
        const b = document.createElement("div");
        const isActive = (snap?.activeObjectiveId && String(snap.activeObjectiveId)===String(z.id));
        b.textContent = z.id;
        b.style.cssText = `
          width:22px; height:22px; border-radius:10px;
          display:flex; align-items:center; justify-content:center;
          background: ${ownerColor(z.owner)};
          border: ${isActive ? "2px solid rgba(255,255,255,0.85)" : "1px solid rgba(255,255,255,0.12)"};
          font-weight:800;
          transform: ${isActive ? "scale(1.08)" : "scale(1.0)"};
        `;
        this.objBar.appendChild(b);
        if(z !== zs[zs.length-1]){
          const dot=document.createElement("div");
          dot.style.cssText="width:10px; height:2px; border-radius:2px; background: rgba(255,255,255,0.25);";
          this.objBar.appendChild(dot);
        }
      }
    }

    // Capture widget
    const pz = snap?.playerInZone;
    if(pz && pz.id){
      this.capture.style.display = "block";
      this.capTitle.textContent = pz.title || `ZONE ${pz.id}`;
      this.capSub.textContent = pz.sub || "";
      const pct = Math.max(0, Math.min(100, pz.progressPct ?? 0));
      this.capFill.style.width = `${pct}%`;
      this.capFill.style.background = ownerColor(pz.fillOwner);
    } else {
      this.capture.style.display = "none";
    }
  }
}
