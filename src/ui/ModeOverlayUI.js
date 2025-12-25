// src/ui/ModeOverlayUI.js
// Patch 9-1: Mode UI (objectives + capture widget) + hit confirmation marker

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function ensureStyles(){
  if(document.getElementById('modeOverlayStyles')) return;
  const s = document.createElement('style');
  s.id = 'modeOverlayStyles';
  s.textContent = `
  #modeUIRoot{position:fixed; inset:0; pointer-events:none; z-index:10045; font-family:system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif;}
  #modeTop{position:fixed; left:50%; top:10px; transform:translateX(-50%); display:flex; gap:10px; align-items:center; padding:8px 12px; border-radius:12px; background:rgba(0,0,0,.38); border:1px solid rgba(255,255,255,.10); backdrop-filter: blur(8px); color:#fff; font-weight:700;}
  #modeTop .pill{display:inline-flex; gap:6px; align-items:center; padding:4px 8px; border-radius:999px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.10); font-weight:700; font-size:12px;}
  #modeTop .muted{opacity:.78; font-weight:650;}

  #objBar{position:fixed; left:50%; top:56px; transform:translateX(-50%); display:flex; gap:6px; align-items:center; padding:8px 10px; border-radius:12px; background:rgba(0,0,0,.28); border:1px solid rgba(255,255,255,.08); backdrop-filter: blur(8px); color:#fff;}
  .obj{width:26px; height:22px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:900; letter-spacing:.5px; border:1px solid rgba(255,255,255,.16); background:rgba(220,220,220,.14);}
  .obj.blue{background:rgba(79,163,255,.22); border-color:rgba(79,163,255,.55);}
  .obj.red{background:rgba(255,91,91,.22); border-color:rgba(255,91,91,.55);}
  .obj.neutral{background:rgba(220,220,220,.10); border-color:rgba(255,255,255,.18);}
  .obj.active{outline:2px solid rgba(255,255,255,.75); outline-offset:1px;}
  .obj.locked{opacity:.45; filter:saturate(.6);}

  /* Capture Ring (requested): shown under objective UI when inside a zone */
  #capRing{position:fixed; left:50%; top:108px; transform:translateX(-50%);
    width:96px; height:96px; display:none; align-items:center; justify-content:center;
    z-index:10046; pointer-events:none;}
  #capRing .ringWrap{position:relative; width:96px; height:96px; border-radius:999px;}
  #capRing svg{position:absolute; inset:0;}
  #capRing .inner{position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;
    color:#fff; text-shadow:0 2px 10px rgba(0,0,0,.55);}
  #capRing .inner .zid{font-weight:1000; font-size:14px; letter-spacing:.6px;}
  #capRing .inner .zstate{margin-top:2px; font-weight:900; font-size:10px; opacity:.9;}
  #capRing .hint{position:absolute; left:50%; top:100%; transform:translate(-50%, 6px);
    font-size:11px; font-weight:900; padding:4px 8px; border-radius:999px;
    background:rgba(0,0,0,.32); border:1px solid rgba(255,255,255,.12);
    backdrop-filter: blur(6px); display:none;}

  #capWidget{position:fixed; left:50%; top:58%; transform:translate(-50%,-50%); width:min(320px, 86vw);
    padding:10px 12px; border-radius:14px; background:rgba(0,0,0,.38); border:1px solid rgba(255,255,255,.10); backdrop-filter: blur(8px);
    color:#fff; display:none;}
  #capWidget .title{display:flex; align-items:baseline; justify-content:space-between; gap:10px; font-weight:900;}
  #capWidget .title .id{font-size:14px; letter-spacing:.4px;}
  #capWidget .title .state{font-size:12px; opacity:.85; font-weight:800;}
  #capWidget .bar{margin-top:8px; height:10px; border-radius:999px; overflow:hidden; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.12);}
  #capWidget .bar > div{height:100%; width:0%; background:rgba(255,255,255,.85);}
  #capWidget .sub{margin-top:6px; display:flex; justify-content:space-between; font-size:12px; opacity:.82; font-weight:700;}
  #capWidget .warn{margin-top:6px; font-size:12px; font-weight:900; color:rgba(255,210,110,.95);}

  #hitMarker{position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:22px; height:22px; opacity:0; z-index:10060;}
  #hitMarker:before, #hitMarker:after{content:""; position:absolute; inset:0; border:2px solid rgba(255,255,255,.92); border-left-color:transparent; border-right-color:transparent; transform:rotate(45deg); border-radius:2px;}
  #hitMarker:after{transform:rotate(-45deg);}
  #hitMarker.killed:before, #hitMarker.killed:after{border-color:rgba(255,110,110,.95); border-left-color:transparent; border-right-color:transparent;}
  @keyframes hitPop{0%{opacity:0; transform:translate(-50%,-50%) scale(.8);} 15%{opacity:1; transform:translate(-50%,-50%) scale(1.05);} 100%{opacity:0; transform:translate(-50%,-50%) scale(1.0);} }
  #hitMarker.show{animation:hitPop .22s ease-out;}
  `;
  document.head.appendChild(s);
}

function ownerClass(owner){
  const o = String(owner||'neutral').toLowerCase();
  if(o === 'blue') return 'blue';
  if(o === 'red') return 'red';
  return 'neutral';
}

export class ModeOverlayUI {
  constructor({ root=document.body } = {}){
    ensureStyles();
    this.root = root;
    this.el = document.createElement('div');
    this.el.id = 'modeUIRoot';
    this.root.appendChild(this.el);

    this.top = document.createElement('div');
    this.top.id = 'modeTop';
    this.el.appendChild(this.top);

    this.objBar = document.createElement('div');
    this.objBar.id = 'objBar';
    this.el.appendChild(this.objBar);

    // Capture ring (shown under objective UI when inside a zone)
    this.capRing = document.createElement('div');
    this.capRing.id = 'capRing';
    this.capRing.innerHTML = `
      <div class="ringWrap">
        <svg viewBox="0 0 120 120" width="96" height="96" aria-hidden="true">
          <g class="g" transform="rotate(-90 60 60)">
            <circle class="bg" cx="60" cy="60" r="50" fill="none" stroke="rgba(200,200,200,.35)" stroke-width="10"/>
            <circle class="fgOwner" cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="314.159" stroke-dashoffset="314.159"/>
            <circle class="fgAdv" cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="314.159" stroke-dashoffset="314.159"/>
          </g>
        </svg>
        <div class="inner">
          <div class="zid">-</div>
          <div class="zstate">-</div>
        </div>
        <div class="hint"></div>
      </div>
    `;
    this.el.appendChild(this.capRing);
    this.capRingOwner = this.capRing.querySelector('circle.fgOwner');
    this.capRingAdv = this.capRing.querySelector('circle.fgAdv');
    this.capRingG = this.capRing.querySelector('g.g');
    this.capRingId = this.capRing.querySelector('.inner .zid');
    this.capRingState = this.capRing.querySelector('.inner .zstate');
    this.capRingHint = this.capRing.querySelector('.hint');

    this.cap = document.createElement('div');
    this.cap.id = 'capWidget';
    this.cap.innerHTML = `
      <div class="title"><div class="id">-</div><div class="state">-</div></div>
      <div class="bar"><div></div></div>
      <div class="sub"><span class="counts">-</span><span class="owner">-</span></div>
      <div class="warn" style="display:none"></div>
    `;
    this.el.appendChild(this.cap);
    this.capTitleId = this.cap.querySelector('.title .id');
    this.capTitleState = this.cap.querySelector('.title .state');
    this.capBarFill = this.cap.querySelector('.bar > div');
    this.capCounts = this.cap.querySelector('.sub .counts');
    this.capOwner = this.cap.querySelector('.sub .owner');
    this.capWarn = this.cap.querySelector('.warn');

    this.hit = document.createElement('div');
    this.hit.id = 'hitMarker';
    this.el.appendChild(this.hit);

    this._mode = null;
    this._objEls = new Map();
  }

  destroy(){
    try{ this.el?.remove?.(); }catch{}
  }

  hitConfirm({ killed=false } = {}){
    try{
      this.hit.classList.remove('show');
      void this.hit.offsetWidth; // restart anim
      if(killed) this.hit.classList.add('killed');
      else this.hit.classList.remove('killed');
      this.hit.classList.add('show');
    }catch{}
  }

  update(state){
    if(!state) return;
    const mode = String(state.mode||'zone');
    if(mode !== this._mode){
      this._mode = mode;
      this._rebuildObjectiveBar(state);
    }
    this._renderTop(state);
    this._renderObjectives(state);
    this._renderCaptureWidget(state);
  }

  _renderTop(state){
    const mode = String(state.mode||'zone');
    const ended = !!state.ended;
    const winner = state.winner ? String(state.winner).toUpperCase() : null;

    const parts = [];
    const modeLabel = (mode === 'zone') ? 'ZONE' : (mode === 'conquest') ? 'CONQUEST' : 'FRONTLINE';
    parts.push(`<span class="pill">${modeLabel}</span>`);

    if(mode === 'zone' && state.tickets){
      parts.push(`<span class="pill"><span class="muted">BLUE</span> ${state.tickets.blue}</span>`);
      parts.push(`<span class="pill"><span class="muted">RED</span> ${state.tickets.red}</span>`);
    }
    if(mode === 'conquest' && Number.isFinite(state.conquestTimeLeft)){
      const t = Math.max(0, Math.floor(state.conquestTimeLeft));
      const mm = String(Math.floor(t/60)).padStart(2,'0');
      const ss = String(t%60).padStart(2,'0');
      parts.push(`<span class="pill"><span class="muted">TIME</span> ${mm}:${ss}</span>`);
      parts.push(`<span class="pill"><span class="muted">ATK</span> ${String(state.attackTeam||'blue').toUpperCase()}</span>`);
    }
    if(mode === 'frontline' && Number.isFinite(state.frontlineSwapLeft)){
      const t = Math.max(0, Math.floor(state.frontlineSwapLeft));
      const mm = String(Math.floor(t/60)).padStart(2,'0');
      const ss = String(t%60).padStart(2,'0');
      parts.push(`<span class="pill"><span class="muted">SWAP</span> ${mm}:${ss}</span>`);
      parts.push(`<span class="pill"><span class="muted">ATK</span> ${String(state.attackTeam||'blue').toUpperCase()}</span>`);
    }
    if(state.activeObjectiveId){
      parts.push(`<span class="pill"><span class="muted">OBJ</span> ${String(state.activeObjectiveId).toUpperCase()}</span>`);
    }
    if(ended && winner){
      parts.push(`<span class="pill">WINNER ${winner}</span>`);
    }

    this.top.innerHTML = parts.join('');
  }

  _rebuildObjectiveBar(state){
    this.objBar.innerHTML = '';
    this._objEls.clear();
    const objs = Array.isArray(state.objectives) ? state.objectives : [];
    for(const o of objs){
      const el = document.createElement('div');
      el.className = `obj neutral`;
      el.textContent = String(o.id||'?').toUpperCase().slice(0,2);
      this.objBar.appendChild(el);
      this._objEls.set(String(o.id), el);
    }
  }

  _renderObjectives(state){
    const activeId = state.activeObjectiveId ? String(state.activeObjectiveId) : null;
    const playerCtx = state.playerContext || null;
    const lockedId = (playerCtx && playerCtx.locked && playerCtx.insideObjectiveId) ? String(playerCtx.insideObjectiveId) : null;

    for(const o of (state.objectives||[])){
      const id = String(o.id);
      const el = this._objEls.get(id);
      if(!el) continue;
      const cls = ownerClass(o.owner);
      el.className = `obj ${cls}`;
      if(activeId && id === activeId) el.classList.add('active');
      if((state.mode==='conquest' || state.mode==='frontline') && activeId && id !== activeId) el.classList.add('locked');
      if(lockedId && id === lockedId) el.classList.add('active');
    }
  }

  _renderCaptureWidget(state){
    const ctx = state.playerContext;
    if(!ctx || !ctx.insideObjectiveId){
      this.cap.style.display = 'none';
      this.capRing.style.display = 'none';
      return;
    }

    const id = String(ctx.insideObjectiveId).toUpperCase();
    const owner = String(ctx.owner||'neutral').toUpperCase();
    const b = ctx.counts?.blue ?? 0;
    const r = ctx.counts?.red ?? 0;
    const contested = !!ctx.contested;
    const locked = !!ctx.locked;

    let stateText = contested ? 'CONTESTED' : 'CAPTURING';
    if(locked) stateText = 'LOCKED';
    if(!contested && !locked){
      if(owner === 'NEUTRAL') stateText = 'CAPTURE';
      else if(owner === String(ctx.team).toUpperCase()) stateText = 'DEFEND';
      else stateText = 'NEUTRALIZE';
    }

    // Ring rendering (neutral=grey full; capture=cw fill; neutralize/shrink=ccw shrink)
    const CIRC = 314.159; // 2*pi*50
    const prog = clamp(Number(ctx.progress)||0, 0, 1);
    const phase = String(ctx.phase||'stable');
    const advTeam = ctx.advTeam ? String(ctx.advTeam).toLowerCase() : null;
    const ownerTeam = String(ctx.owner||'neutral').toLowerCase();

    const teamColor = (t)=>{
      const x = String(t||'neutral').toLowerCase();
      if(x==='blue') return 'rgba(79,163,255,.95)';
      if(x==='red') return 'rgba(255,91,91,.95)';
      return 'rgba(200,200,200,.70)';
    };

    // Helper: set arc (0..1 length). Direction: cw (default) or ccw (mirrored)
    const setArc = (el, value01, color, dir='cw')=>{
      const v = clamp(Number(value01)||0, 0, 1);
      el.style.stroke = color;
      el.style.strokeDasharray = `${CIRC}`;
      // dashoffset such that visible length = v*CIRC
      el.style.strokeDashoffset = `${CIRC * (1 - v)}`;
      if(dir === 'ccw') el.setAttribute('transform', 'scale(-1 1) translate(-120 0)');
      else el.removeAttribute('transform');
    };

    // Default: stable owner full
    let ownerArc = 0;
    let advArc = 0;
    let ownerDir = 'cw';
    let advDir = 'cw';
    let ownerCol = teamColor(ownerTeam);
    let advCol = teamColor(advTeam);

    if(locked){
      // locked: show grey ring + hint
      ownerArc = 1; ownerCol = teamColor('neutral');
      advArc = 0;
    }else if(contested){
      // contested: show owner full but muted
      ownerArc = 1;
      advArc = 0;
      ownerCol = 'rgba(255,255,255,.65)';
    }else{
      if(ownerTeam === 'neutral'){
        // capture from neutral: adv fills CW
        ownerArc = 1; ownerCol = teamColor('neutral');
        advArc = prog; advDir = 'cw';
      }else if(advTeam && advTeam !== ownerTeam){
        // takeover: owner shrinks CCW, attacker fills CW (UI-only transfer)
        ownerArc = 1 - prog; ownerDir = 'ccw';
        advArc = prog; advDir = 'cw';
      }else{
        // stable/defend: show owner full
        ownerArc = 1;
        advArc = 0;
      }
    }

    this.capRing.style.display = 'flex';
    this.capRingId.textContent = id;
    this.capRingState.textContent = stateText;
    setArc(this.capRingOwner, ownerArc, ownerCol, ownerDir);
    setArc(this.capRingAdv, advArc, advCol, advDir);
    this.capRingHint.style.display = '';
    this.capRingHint.textContent = `BLUE ${b} | RED ${r} · OWNER ${owner}`;

    // Keep the legacy bar widget hidden by default (less clutter). It still exists for debugging.
    this.cap.style.display = 'none';

    if(locked){
      this.capRingHint.style.display = '';
      this.capRingHint.textContent = 'LOCKED · 활성 목표만 점령 가능';
    }
  }
}
