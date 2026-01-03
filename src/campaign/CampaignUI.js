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
