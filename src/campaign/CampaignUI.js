// src/campaign/CampaignUI.js

export class CampaignUI {
  constructor({ root = document.body } = {}) {
    this.root = root;

    this.wrap = document.createElement('div');
    this.wrap.id = 'campaignHUD';
    this.wrap.innerHTML = `
      <div class="campCinematic">
        <div class="campBar campBar--top"></div>
        <div class="campBar campBar--bottom"></div>
        <div class="campFade" id="campFade"></div>
      </div>

      <div class="campBrief" id="campBrief">
        <div class="campBrief__panel">
          <div class="campBrief__top">
            <div>
              <div class="campBrief__title" id="campBriefTitle"></div>
              <div class="campBrief__meta" id="campBriefMeta"></div>
            </div>
            <div class="campBrief__badge">BRIEFING</div>
          </div>
          <div class="campBrief__grid">
            <div class="campBrief__map">
              <div class="campBrief__mapGrid" id="campBriefMap"></div>
            </div>
            <div class="campBrief__text">
              <div class="campBrief__intel" id="campBriefIntel"></div>
              <div class="campBrief__obj" id="campBriefObj"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="campObjective" id="campObjective"></div>

      <div class="campWaypoint" id="campWaypoint">
        <div class="campWaypoint__label" id="campWaypointLabel"></div>
        <div class="campWaypoint__dist" id="campWaypointDist"></div>
        <div class="campWaypoint__hint" id="campWaypointHint"></div>
      </div>

      <div class="campChecklist" id="campChecklist"></div>

      <div class="campSubtitle" id="campSubtitle">
        <div class="campSubtitle__speaker" id="campSubtitleSpeaker"></div>
        <div class="campSubtitle__text" id="campSubtitleText"></div>
      </div>

      <div class="campToast" id="campToast"></div>

      <div class="campResult" id="campResult">
        <div class="campResult__panel">
          <div class="campResult__title" id="campResultTitle"></div>
          <div class="campResult__desc" id="campResultDesc"></div>
          <div class="campResult__buttons">
            <button class="campBtn" id="campBtnNextMission" style="display:none">다음 미션</button>
            <button class="campBtn" id="campBtnRestartCP">체크포인트 재시작</button>
            <button class="campBtn" id="campBtnRestartMission">미션 재시작</button>
          </div>
        </div>
      </div>
    `;
    root.appendChild(this.wrap);

    this.objEl = this.wrap.querySelector('#campObjective');

    this.wpWrap = this.wrap.querySelector('#campWaypoint');
    this.wpLabel = this.wrap.querySelector('#campWaypointLabel');
    this.wpDist = this.wrap.querySelector('#campWaypointDist');
    this.wpHint = this.wrap.querySelector('#campWaypointHint');

    this.checklistEl = this.wrap.querySelector('#campChecklist');

    this.subWrap = this.wrap.querySelector('#campSubtitle');
    this.subSpeaker = this.wrap.querySelector('#campSubtitleSpeaker');
    this.subText = this.wrap.querySelector('#campSubtitleText');

    this.toastEl = this.wrap.querySelector('#campToast');

    this.fadeEl = this.wrap.querySelector('#campFade');

    this.briefWrap = this.wrap.querySelector('#campBrief');
    this.briefTitle = this.wrap.querySelector('#campBriefTitle');
    this.briefMeta = this.wrap.querySelector('#campBriefMeta');
    this.briefIntel = this.wrap.querySelector('#campBriefIntel');
    this.briefObj = this.wrap.querySelector('#campBriefObj');
    this.briefMap = this.wrap.querySelector('#campBriefMap');

    this.resultWrap = this.wrap.querySelector('#campResult');
    this.resultTitle = this.wrap.querySelector('#campResultTitle');
    this.resultDesc = this.wrap.querySelector('#campResultDesc');

    this.btnRestartCP = this.wrap.querySelector('#campBtnRestartCP');
    this.btnRestartMission = this.wrap.querySelector('#campBtnRestartMission');
    this.btnNextMission = this.wrap.querySelector('#campBtnNextMission');

    this._subHideT = 0;
    this._toastHideT = 0;

    this._fade = 0;
    this._fadeVel = 0;

    this.btnRestartCP.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('campaign:restart', { detail: { mode: 'checkpoint' } }));
    });
    this.btnRestartMission.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('campaign:restart', { detail: { mode: 'mission' } }));
    });

    this.btnNextMission.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('campaign:next'));
    });

    this.setObjective('');
    this.setWaypoint(null);
    this.setChecklist([]);
    this.hideSubtitle();
    this.hideToast();
    this.setCinematic(false);
    this.hideBriefing();
    this.hideResult();
  }

  ensureStyles() {
    if (document.getElementById('campaignHUDStyles')) return;
    const s = document.createElement('style');
    s.id = 'campaignHUDStyles';
    s.textContent = `
      #campaignHUD{position:fixed;inset:0;pointer-events:none;z-index:60;font-family:system-ui,-apple-system,"Noto Sans KR",Segoe UI,Roboto,Arial,sans-serif;}
      #campaignHUD .campObjective{position:fixed;left:16px;top:16px;max-width:min(560px,calc(100vw-32px));
        padding:10px 12px;border-radius:14px;
        background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.14);
        color:#eaf0ff;font-weight:950;letter-spacing:.02em;
        box-shadow:0 10px 24px rgba(0,0,0,.35);
        backdrop-filter: blur(10px);
      }
      #campaignHUD .campObjective:empty{display:none;}

      #campaignHUD .campWaypoint{position:fixed;left:50%;transform:translateX(-50%);top:16px;
        width:min(520px,calc(100vw-32px));
        padding:10px 14px;border-radius:16px;
        background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.14);
        color:#eaf0ff;box-shadow:0 14px 28px rgba(0,0,0,.35);
        backdrop-filter: blur(10px);
        display:none;
      }
      #campaignHUD .campWaypoint__label{font-weight:1000;letter-spacing:.14em;font-size:12px;opacity:.92}
      #campaignHUD .campWaypoint__dist{font-weight:950;font-size:18px;line-height:1.2;margin-top:2px}
      #campaignHUD .campWaypoint__hint{font-weight:850;font-size:12px;opacity:.85;margin-top:2px}

      #campaignHUD .campChecklist{position:fixed;right:16px;top:16px;width:min(320px,calc(100vw-32px));
        padding:10px 12px;border-radius:16px;
        background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.12);
        color:#eaf0ff;box-shadow:0 14px 28px rgba(0,0,0,.30);
        backdrop-filter: blur(10px);
      }
      #campaignHUD .campChecklist:empty{display:none;}
      #campaignHUD .campChecklist__title{font-weight:1000;letter-spacing:.14em;font-size:11px;opacity:.85;margin-bottom:6px}
      #campaignHUD .campChecklist__item{display:flex;gap:8px;align-items:flex-start;margin:6px 0;}
      #campaignHUD .campChecklist__dot{width:10px;height:10px;border-radius:999px;margin-top:4px;border:1px solid rgba(255,255,255,.25);}
      #campaignHUD .campChecklist__dot.done{background:rgba(120,255,160,.85);border-color:rgba(120,255,160,.6)}
      #campaignHUD .campChecklist__dot.todo{background:rgba(255,255,255,.08)}
      #campaignHUD .campChecklist__text{font-weight:850;font-size:13px;line-height:1.35;opacity:.95}
      #campaignHUD .campChecklist__text.done{opacity:.55;text-decoration:line-through}

      #campaignHUD .campSubtitle{position:fixed;left:50%;transform:translateX(-50%);bottom:68px;
        width:min(920px,calc(100vw-24px));
        padding:10px 14px;border-radius:16px;
        background:rgba(0,0,0,.38);border:1px solid rgba(255,255,255,.14);
        color:#eaf0ff;box-shadow:0 14px 30px rgba(0,0,0,.42);
        backdrop-filter: blur(10px);
      }
      #campaignHUD .campSubtitle__speaker{font-weight:1000;opacity:.9;font-size:12px;letter-spacing:.12em;margin-bottom:2px}
      #campaignHUD .campSubtitle__text{font-weight:900;font-size:16px;line-height:1.4}

      #campaignHUD .campToast{position:fixed;left:50%;transform:translateX(-50%);top:86px;
        padding:8px 12px;border-radius:14px;
        background:rgba(31,79,255,.22);border:1px solid rgba(31,79,255,.55);
        color:#eaf0ff;font-weight:950;letter-spacing:.03em;
        box-shadow:0 12px 26px rgba(0,0,0,.35);
        backdrop-filter: blur(10px);
      }
      

      #campaignHUD .campBrief{position:fixed;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none;z-index:70;}
      #campaignHUD .campBrief__panel{width:min(980px,calc(100vw-32px));
        padding:14px 14px;border-radius:18px;
        background:linear-gradient(180deg, rgba(10,12,18,.76), rgba(10,12,18,.56));
        border:1px solid rgba(255,255,255,.16);
        box-shadow:0 18px 70px rgba(0,0,0,.55);
        backdrop-filter: blur(12px);
      }
      #campaignHUD .campBrief__top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      #campaignHUD .campBrief__title{font-weight:1000;font-size:22px;letter-spacing:.10em}
      #campaignHUD .campBrief__meta{margin-top:4px;font-weight:850;opacity:.8}
      #campaignHUD .campBrief__badge{font-weight:1000;letter-spacing:.18em;font-size:11px;opacity:.9;padding:6px 10px;border-radius:999px;
        border:1px solid rgba(255,255,255,.16);background:rgba(31,79,255,.18);
      }
      #campaignHUD .campBrief__grid{display:grid;grid-template-columns: 1.1fr .9fr;gap:12px;margin-top:12px}
      #campaignHUD .campBrief__map{height:280px;border-radius:16px;border:1px solid rgba(255,255,255,.12);
        background:radial-gradient(900px 520px at 20% 15%, rgba(31,79,255,.22), transparent 55%),
                   radial-gradient(700px 520px at 80% 80%, rgba(57,255,209,.08), transparent 60%),
                   linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
        overflow:hidden;position:relative;
      }
      #campaignHUD .campBrief__mapGrid{position:absolute;inset:0;
        background-image: linear-gradient(rgba(255,255,255,.10) 1px, transparent 1px),
                          linear-gradient(90deg, rgba(255,255,255,.10) 1px, transparent 1px);
        background-size: 22px 22px;
        opacity:.55;
      }

      /* HF8: dynamic briefing map (grid drift + scanline + pulsing marks + route) */
      @keyframes campBriefGridDrift{
        0%{ background-position: 0px 0px, 0px 0px; }
        100%{ background-position: 44px 44px, 44px 44px; }
      }
      @keyframes campBriefScan{
        0%{ transform: translateY(-120%); opacity:0; }
        10%{ opacity:.55; }
        90%{ opacity:.55; }
        100%{ transform: translateY(120%); opacity:0; }
      }
      @keyframes campBriefPulse{
        0%,100%{ transform: translate(-50%,-50%) scale(1); filter:brightness(1); }
        50%{ transform: translate(-50%,-50%) scale(1.22); filter:brightness(1.2); }
      }
      #campaignHUD .campBrief__map::before{
        content:""; position:absolute; inset:-40px 0;
        background: linear-gradient(180deg, transparent, rgba(255,255,255,.22), transparent);
        animation: campBriefScan 2.2s linear infinite;
        pointer-events:none; mix-blend-mode: screen; opacity:.35;
      }
      #campaignHUD .campBrief__mapGrid{ animation: campBriefGridDrift 6s linear infinite; }
      #campaignHUD .campBrief__mark{ animation: campBriefPulse 1.1s ease-in-out infinite; }
      #campaignHUD .campBrief__route{ position:absolute; inset:0; pointer-events:none; }
      #campaignHUD .campBrief__route path{
        fill:none; stroke: rgba(255,255,255,.62); stroke-width: 2.2;
        stroke-dasharray: 7 7; stroke-linecap: round;
        animation: campRouteDash 1.0s linear infinite;
        filter: drop-shadow(0 0 10px rgba(31,79,255,.25));
      }
      @keyframes campRouteDash{ to{ stroke-dashoffset:-28; } }

      #campaignHUD .campBrief__mark{position:absolute;width:10px;height:10px;border-radius:999px;
        background:rgba(255,255,255,.88);box-shadow:0 0 0 4px rgba(31,79,255,.22), 0 0 28px rgba(31,79,255,.25);
      }
      #campaignHUD .campBrief__mark.obj{background:rgba(255,210,120,.92);box-shadow:0 0 0 4px rgba(255,210,120,.22),0 0 30px rgba(255,210,120,.25)}
      #campaignHUD .campBrief__mark.you{background:rgba(120,255,160,.95);box-shadow:0 0 0 4px rgba(120,255,160,.22),0 0 30px rgba(120,255,160,.22)}
      #campaignHUD .campBrief__text{padding:10px 12px;border-radius:16px;border:1px solid rgba(255,255,255,.12);
        background:rgba(0,0,0,.18);
      }
      #campaignHUD .campBrief__intel{font-weight:850;opacity:.92;line-height:1.5;min-height:88px}
      #campaignHUD .campBrief__obj{margin-top:10px;font-weight:900;opacity:.95}
      #campaignHUD .campBrief__obj b{letter-spacing:.14em;font-size:11px;opacity:.78}
      #campaignHUD .campBrief__obj ul{margin:6px 0 0 18px;padding:0}
      #campaignHUD .campBrief__obj li{margin:4px 0}

      @media (max-width:720px){
        #campaignHUD .campBrief__grid{grid-template-columns:1fr}
        #campaignHUD .campBrief__map{height:220px}
      }


      #campaignHUD .campToast:empty{display:none;}

      #campaignHUD .campCinematic{position:fixed;inset:0;pointer-events:none;}
      #campaignHUD .campBar{position:absolute;left:0;right:0;height:0;background:rgba(0,0,0,.92);transition:height .22s ease;}
      #campaignHUD .campBar--top{top:0}
      #campaignHUD .campBar--bottom{bottom:0}
      #campaignHUD[data-cine="1"] .campBar--top{height:10vh}
      #campaignHUD[data-cine="1"] .campBar--bottom{height:10vh}
      #campaignHUD .campFade{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .08s linear;}

      #campaignHUD .campResult{position:fixed;inset:0;display:none;align-items:center;justify-content:center;
        background:rgba(0,0,0,.65);pointer-events:auto;z-index:999;}
      #campaignHUD .campResult__panel{width:min(520px,calc(100vw-32px));
        padding:18px 16px;border-radius:18px;
        background:rgba(10,12,18,.88);border:1px solid rgba(255,255,255,.16);
        box-shadow:0 18px 50px rgba(0,0,0,.55);
      }
      #campaignHUD .campResult__title{font-weight:1000;font-size:22px;letter-spacing:.08em}
      #campaignHUD .campResult__desc{margin-top:8px;font-weight:850;opacity:.85;line-height:1.4}
      #campaignHUD .campResult__buttons{margin-top:14px;display:flex;gap:10px;flex-wrap:wrap}
      #campaignHUD .campBtn{pointer-events:auto;cursor:pointer;border:1px solid rgba(255,255,255,.18);
        background:rgba(255,255,255,.10);color:#eaf0ff;font-weight:950;border-radius:14px;
        padding:10px 12px;}
      #campaignHUD .campBtn:hover{background:rgba(255,255,255,.14)}

      @media (max-width:520px){
        #campaignHUD .campSubtitle{bottom:84px}
        #campaignHUD .campSubtitle__text{font-size:14px}
        #campaignHUD .campChecklist{top:auto;bottom:150px;right:12px;left:12px;width:auto}
      }
    `;
    document.head.appendChild(s);
  }

  setObjective(text) {
    this.ensureStyles();
    this.objEl.textContent = text || '';
  }

  setWaypoint(data) {
    this.ensureStyles();
    if (!data) {
      this.wpWrap.style.display = 'none';
      return;
    }
    this.wpWrap.style.display = 'block';
    this.wpLabel.textContent = (data.label || '').toUpperCase();
    this.wpDist.textContent = data.distText || '';
    this.wpHint.textContent = data.hint || '';
  }

  setChecklist(items) {
    this.ensureStyles();
    if (!Array.isArray(items) || items.length === 0) {
      this.checklistEl.innerHTML = '';
      return;
    }
    const lines = items.map(it => {
      const done = !!it.done;
      return `
        <div class="campChecklist__item">
          <div class="campChecklist__dot ${done ? 'done' : 'todo'}"></div>
          <div class="campChecklist__text ${done ? 'done' : ''}">${this._esc(it.text || '')}</div>
        </div>
      `;
    }).join('');
    this.checklistEl.innerHTML = `<div class="campChecklist__title">MISSION</div>${lines}`;
  }

  showSubtitle({ speaker = '', text = '', holdSec = 3.2 } = {}) {
    this.ensureStyles();
    this.subSpeaker.textContent = speaker ? String(speaker).toUpperCase() : '';
    this.subText.textContent = text || '';
    this.subWrap.style.display = 'block';
    this._subHideT = Math.max(0.5, Number(holdSec) || 3.2);
  }

  hideSubtitle() {
    this.subWrap.style.display = 'none';
    this._subHideT = 0;
  }

  toast(text, holdSec = 2.0) {
    this.ensureStyles();
    this.toastEl.textContent = text || '';
    this._toastHideT = Math.max(0.6, Number(holdSec) || 2.0);
  }

  hideToast() {
    this.toastEl.textContent = '';
    this._toastHideT = 0;
  }

  setCinematic(on) {
    this.ensureStyles();
    this.wrap.dataset.cine = on ? '1' : '0';
  }

  setFade(target01, speed = 10) {
    this.ensureStyles();
    this._fadeVel = Math.max(1, Number(speed) || 10);
    this._fadeTarget = Math.max(0, Math.min(1, Number(target01) || 0));
  }

  showResult({ title = 'MISSION FAILED', desc = '', canNext = false } = {}) {
    this.ensureStyles();
    this.resultTitle.textContent = title;
    this.resultDesc.textContent = desc;
    if(this.btnNextMission) this.btnNextMission.style.display = canNext ? 'inline-flex' : 'none';
    this.resultWrap.style.display = 'flex';
  }

  hideResult() {
    this.resultWrap.style.display = 'none';
  }


  showBriefing(data = {}) {
    this.ensureStyles();
    const d = data || {};
    this.briefTitle.textContent = d.title || '작전 브리핑';
    this.briefMeta.textContent = [d.location, d.time, d.tag].filter(Boolean).join(' · ');
    this.briefIntel.innerHTML = this._esc(d.intel || '').replace(/\n/g, '<br>');
    const objs = Array.isArray(d.objectives) ? d.objectives : [];
    this.briefObj.innerHTML = '<b>OBJECTIVES</b><ul>' + objs.map(x => '<li>' + this._esc(x) + '</li>').join('') + '</ul>';

    // map marks: { you:[0..1,0..1], obj:[0..1,0..1] }
    const marks = d.marks || {};
    this.briefMap.innerHTML = '';

    // Route overlay (you -> obj)
    try{
      const you = marks.you;
      const obj = marks.obj;
      if(you && obj && you.length>=2 && obj.length>=2){
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('campBrief__route');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const x1 = (Math.max(0, Math.min(1, Number(you[0]))) * 100).toFixed(2);
        const y1 = (Math.max(0, Math.min(1, Number(you[1]))) * 100).toFixed(2);
        const x2 = (Math.max(0, Math.min(1, Number(obj[0]))) * 100).toFixed(2);
        const y2 = (Math.max(0, Math.min(1, Number(obj[1]))) * 100).toFixed(2);
        path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
        svg.appendChild(path);
        this.briefMap.appendChild(svg);
      }
    }catch{}

    const addMark = (cls, pt) => {
      if (!pt || pt.length < 2) return;
      const x = Math.max(0, Math.min(1, Number(pt[0])));
      const y = Math.max(0, Math.min(1, Number(pt[1])));
      const el = document.createElement('div');
      el.className = 'campBrief__mark ' + cls;
      el.style.left = (x * 100).toFixed(1) + '%';
      el.style.top = (y * 100).toFixed(1) + '%';
      this.briefMap.appendChild(el);
    };
    addMark('you', marks.you);
    addMark('obj', marks.obj);

    this.briefWrap.style.display = 'flex';
  }

  hideBriefing() {
    if (this.briefWrap) this.briefWrap.style.display = 'none';
  }


  update(dt) {
    if (this._subHideT > 0) {
      this._subHideT -= dt;
      if (this._subHideT <= 0) this.hideSubtitle();
    }
    if (this._toastHideT > 0) {
      this._toastHideT -= dt;
      if (this._toastHideT <= 0) this.hideToast();
    }

    // Fade tween
    if (typeof this._fadeTarget === 'number') {
      const t = 1 - Math.exp(-(this._fadeVel || 10) * dt);
      this._fade = this._fade + (this._fadeTarget - this._fade) * t;
      if (this.fadeEl) this.fadeEl.style.opacity = String(this._fade.toFixed(3));
    }
  }

  _esc(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}
