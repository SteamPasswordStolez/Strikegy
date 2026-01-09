// src/campaign/CampaignUI.js

export class CampaignUI {
  constructor({ root = document.body } = {}) {
    this.root = root;

    this.wrap = document.createElement('div');
    this.wrap.id = 'campaignHUD';
    this.wrap.innerHTML = `
      <div class="campCinematic" aria-hidden="true">
        <div class="campBar campBar--top"></div>
        <div class="campBar campBar--bottom"></div>
        <div class="campFade" id="campFade"></div>
      </div>

      <div class="campTitleCard" id="campTitleCard" aria-hidden="true">
        <div class="campTitleCard__kicker" id="campTitleKicker"></div>
        <div class="campTitleCard__title" id="campTitleTitle"></div>
        <div class="campTitleCard__sub" id="campTitleSub"></div>
      </div>

      <div class="campObjective" id="campObjective"></div>

      <div class="campWaypoint" id="campWaypoint" aria-hidden="true">
        <div class="campWaypoint__label" id="campWaypointLabel"></div>
        <div class="campWaypoint__dist" id="campWaypointDist"></div>
        <div class="campWaypoint__hint" id="campWaypointHint"></div>
      </div>

      <!-- HF9-B2: on-screen/off-screen waypoint marker (MW-ish) -->
      <div class="campWpMarker" id="campWpMarker" aria-hidden="true">
        <div class="campWpMarker__arrow" id="campWpMarkerArrow"></div>
        <div class="campWpMarker__dot" id="campWpMarkerDot"></div>
      </div>

      <div class="campChecklist" id="campChecklist"></div>

      <div class="campComms" id="campSubtitle" aria-hidden="true">
        <div class="campComms__top">
          <div class="campComms__ch" id="campSubtitleChannel"></div>
          <div class="campComms__spk" id="campSubtitleSpeaker"></div>
        </div>
        <div class="campComms__text" id="campSubtitleText"></div>
      </div>

      <div class="campToast" id="campToast" aria-hidden="true"></div>

      <div class="campResult" id="campResult" aria-hidden="true">
        <div class="campResult__panel">
          <div class="campResult__title" id="campResultTitle"></div>
          <div class="campResult__desc" id="campResultDesc"></div>
          <div class="campResult__buttons">
            <button class="campBtn" id="campBtnCampaignMenu">캠페인 메뉴</button>
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

    this.wpMarker = this.wrap.querySelector('#campWpMarker');
    this.wpMarkerArrow = this.wrap.querySelector('#campWpMarkerArrow');
    this.wpMarkerDot = this.wrap.querySelector('#campWpMarkerDot');

    this.checklistEl = this.wrap.querySelector('#campChecklist');

    this.subWrap = this.wrap.querySelector('#campSubtitle');
    this.subChannel = this.wrap.querySelector('#campSubtitleChannel');
    this.subSpeaker = this.wrap.querySelector('#campSubtitleSpeaker');
    this.subText = this.wrap.querySelector('#campSubtitleText');

    this.toastEl = this.wrap.querySelector('#campToast');

    this.fadeEl = this.wrap.querySelector('#campFade');

    this.titleWrap = this.wrap.querySelector('#campTitleCard');
    this.titleKicker = this.wrap.querySelector('#campTitleKicker');
    this.titleTitle = this.wrap.querySelector('#campTitleTitle');
    this.titleSub = this.wrap.querySelector('#campTitleSub');

    this.resultWrap = this.wrap.querySelector('#campResult');
    this.resultTitle = this.wrap.querySelector('#campResultTitle');
    this.resultDesc = this.wrap.querySelector('#campResultDesc');

    this.btnRestartCP = this.wrap.querySelector('#campBtnRestartCP');
    this.btnRestartMission = this.wrap.querySelector('#campBtnRestartMission');
    this.btnNextMission = this.wrap.querySelector('#campBtnNextMission');
    this.btnCampaignMenu = this.wrap.querySelector('#campBtnCampaignMenu');

    this._subHideT = 0;
    this._toastHideT = 0;
    this._titleHideT = 0;

    this._fade = 0;
    this._fadeVel = 0;

    // Result buttons must be clickable
    this.resultWrap.style.pointerEvents = 'auto';

    this.btnRestartCP.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('campaign:restart', { detail: { mode: 'checkpoint' } }));
    });
    this.btnRestartMission.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('campaign:restart', { detail: { mode: 'mission' } }));
    });
    this.btnNextMission.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('campaign:next'));
    });

    // HF9-C3b: Campaign menu button (MW-style "Mission Select")
    this.btnCampaignMenu.addEventListener('click', () => {
      try {
        window.dispatchEvent(new CustomEvent('campaign:menu'));
      } catch { /* ignore */ }
      // Fallback (if no handler is attached)
      try {
        setTimeout(() => {
          try { window.location.href = 'campaign.html'; } catch { /* ignore */ }
        }, 30);
      } catch { /* ignore */ }
    });

    this.ensureStyles();

    this.setObjective('');
    this.setWaypoint(null);
    this.setChecklist([]);
    this.hideSubtitle();
    this.hideToast();
    this.hideTitleCard();
    this.setCinematic(false);
    this.hideResult();
  }

  ensureStyles() {
    if (document.getElementById('campaignHUDStyles')) return;
    const s = document.createElement('style');
    s.id = 'campaignHUDStyles';
    s.textContent = `
      #campaignHUD{position:fixed;inset:0;pointer-events:none;z-index:60;font-family:system-ui,-apple-system,"Noto Sans KR",Segoe UI,Roboto,Arial,sans-serif;}

      /* Cinematic bars + fade */
      #campaignHUD .campCinematic{position:absolute;inset:0;pointer-events:none;}
      #campaignHUD .campBar{position:absolute;left:0;right:0;height:12vh;max-height:120px;background:rgba(0,0,0,.95);opacity:0;transform:translateY(-8px);transition:opacity .25s ease, transform .25s ease;}
      #campaignHUD .campBar--top{top:0;}
      #campaignHUD .campBar--bottom{bottom:0;transform:translateY(8px);}
      #campaignHUD .campCinematic.on .campBar{opacity:1;transform:translateY(0);}  
      #campaignHUD .campFade{position:absolute;inset:0;background:rgba(0,0,0,1);opacity:0;pointer-events:none;}

      /* Title card */
      #campaignHUD .campTitleCard{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transform:translateY(8px);transition:opacity .25s ease, transform .25s ease;}
      #campaignHUD .campTitleCard.on{opacity:1;transform:translateY(0);}
      #campaignHUD .campTitleCard>div{pointer-events:none;}
      #campaignHUD .campTitleCard__kicker{color:rgba(255,255,255,.72);font-weight:800;letter-spacing:.22em;font-size:12px;text-transform:uppercase;text-align:center;}
      #campaignHUD .campTitleCard__title{margin-top:8px;color:#ffffff;font-weight:950;letter-spacing:.06em;font-size:28px;text-align:center;text-transform:uppercase;}
      #campaignHUD .campTitleCard__sub{margin-top:10px;color:rgba(255,255,255,.78);font-weight:650;font-size:14px;text-align:center;max-width:min(720px,calc(100vw - 40px));line-height:1.4;}

      /* Objective */
      #campaignHUD .campObjective{position:fixed;left:16px;top:16px;max-width:min(580px,calc(100vw-32px));
        padding:10px 12px;border-radius:14px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.14);
        color:#eaf0ff;font-weight:950;letter-spacing:.02em;box-shadow:0 10px 24px rgba(0,0,0,.35);backdrop-filter: blur(10px);
      }
      #campaignHUD .campObjective:empty{display:none;}

      /* Waypoint */
      #campaignHUD .campWaypoint{position:fixed;left:16px;top:66px;max-width:min(360px,calc(100vw-32px));
        padding:10px 12px;border-radius:14px;background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.12);
        color:#eaf0ff;box-shadow:0 10px 24px rgba(0,0,0,.28);backdrop-filter: blur(10px);
      }
      #campaignHUD .campWaypoint.hidden{display:none;}
      #campaignHUD .campWaypoint__label{font-weight:950;letter-spacing:.04em;text-transform:uppercase;font-size:12px;opacity:.95;}
      #campaignHUD .campWaypoint__dist{margin-top:4px;font-weight:950;font-size:18px;}
      #campaignHUD .campWaypoint__hint{margin-top:2px;font-weight:650;font-size:12px;opacity:.8;}

      /* HF9-B2: screen waypoint marker (on/off-screen) */
      #campaignHUD .campWpMarker{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9998;pointer-events:none;opacity:0;transition:opacity .12s ease, transform .12s ease;}
      #campaignHUD .campWpMarker.isVisible{opacity:1}
      #campaignHUD .campWpMarker__arrow{width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:16px solid rgba(240,240,240,.95);filter:drop-shadow(0 2px 6px rgba(0,0,0,.55));display:none;transform-origin:50% 65%;}
      #campaignHUD .campWpMarker__dot{width:10px;height:10px;border:2px solid rgba(240,240,240,.95);border-radius:2px;transform:rotate(45deg);filter:drop-shadow(0 2px 6px rgba(0,0,0,.55));display:none;}
      #campaignHUD .campWpMarker.isOffscreen .campWpMarker__arrow{display:block}
      #campaignHUD .campWpMarker.isOnscreen .campWpMarker__dot{display:block}

      /* Checklist */
      #campaignHUD .campChecklist{position:fixed;left:16px;top:146px;max-width:min(460px,calc(100vw-32px));
        padding:10px 12px;border-radius:14px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.10);
        color:#eaf0ff;box-shadow:0 10px 24px rgba(0,0,0,.22);backdrop-filter: blur(10px);
      }
      #campaignHUD .campChecklist:empty{display:none;}
      #campaignHUD .campChecklist .item{display:flex;gap:10px;align-items:flex-start;margin:6px 0;}
      #campaignHUD .campChecklist .dot{width:10px;height:10px;border-radius:999px;margin-top:5px;background:rgba(255,255,255,.38);flex:0 0 auto;}
      #campaignHUD .campChecklist .item.done .dot{background:rgba(140,255,200,.9);}
      #campaignHUD .campChecklist .txt{font-size:13px;line-height:1.32;font-weight:700;opacity:.92;}
      #campaignHUD .campChecklist .item.done .txt{opacity:.7;text-decoration:line-through;}

      /* MW-style comms (HF9-B: move to center-bottom so it never hides behind HP HUD) */
      #campaignHUD .campComms{position:fixed;left:50%;bottom:92px;max-width:min(760px,calc(100vw-32px));
        padding:10px 12px;border-radius:16px;
        background:linear-gradient(90deg, rgba(0,0,0,.62), rgba(0,0,0,.28));
        border:1px solid rgba(255,255,255,.16);
        box-shadow:0 18px 40px rgba(0,0,0,.45);
        backdrop-filter: blur(10px);
        opacity:0;transform:translate(-50%, 10px);transition:opacity .18s ease, transform .18s ease;
      }
      #campaignHUD .campComms.on{opacity:1;transform:translate(-50%, 0);}
      #campaignHUD .campComms::before{content:"";position:absolute;inset:0;border-radius:16px;pointer-events:none;opacity:.30;
        background:repeating-linear-gradient(180deg, rgba(255,255,255,.06) 0px, rgba(255,255,255,.06) 1px, rgba(255,255,255,0) 2px, rgba(255,255,255,0) 4px);
        mix-blend-mode: overlay;
      }
      #campaignHUD .campComms.urgent{border-color:rgba(255,110,110,.55);box-shadow:0 18px 40px rgba(255,0,0,.10),0 18px 40px rgba(0,0,0,.45);}
      #campaignHUD .campComms__top{display:flex;gap:10px;align-items:center;}
      #campaignHUD .campComms__ch{font-size:11px;font-weight:950;letter-spacing:.22em;text-transform:uppercase;opacity:.85;}
      #campaignHUD .campComms__spk{font-size:12px;font-weight:950;letter-spacing:.12em;text-transform:uppercase;opacity:.95;}
      #campaignHUD .campComms__text{margin-top:6px;font-size:14px;font-weight:750;line-height:1.38;}

      /* Toast */
      #campaignHUD .campToast{position:fixed;left:50%;top:12px;transform:translateX(-50%);
        padding:8px 12px;border-radius:14px;background:rgba(0,0,0,.30);border:1px solid rgba(255,255,255,.12);
        color:#ffffff;font-weight:900;letter-spacing:.04em;box-shadow:0 12px 30px rgba(0,0,0,.34);
        backdrop-filter: blur(10px);
        opacity:0;transition:opacity .18s ease;
      }
      #campaignHUD .campToast.on{opacity:1;}

      /* Result */
      #campaignHUD .campResult{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);pointer-events:auto;}
      #campaignHUD .campResult.on{display:flex;}
      #campaignHUD .campResult__panel{width:min(560px,calc(100vw-28px));border-radius:18px;padding:18px 16px;
        background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.16);box-shadow:0 18px 50px rgba(0,0,0,.55);
        backdrop-filter: blur(12px);
      }
      #campaignHUD .campResult__title{font-weight:950;letter-spacing:.08em;text-transform:uppercase;color:#fff;font-size:20px;}
      #campaignHUD .campResult__desc{margin-top:8px;color:rgba(255,255,255,.84);font-weight:650;line-height:1.4;font-size:13px;}
      #campaignHUD .campResult__buttons{margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;}
      #campaignHUD .campBtn{pointer-events:auto;cursor:pointer;border:none;border-radius:14px;padding:10px 12px;
        font-weight:950;letter-spacing:.04em;background:rgba(255,255,255,.14);color:#fff;
        box-shadow:0 10px 22px rgba(0,0,0,.28);
      }
      #campaignHUD .campBtn:hover{background:rgba(255,255,255,.18);}

      @media (max-width: 520px){
        #campaignHUD .campObjective{left:12px;top:12px;}
        #campaignHUD .campWaypoint{left:12px;top:60px;}
        #campaignHUD .campChecklist{left:12px;top:132px;}
        #campaignHUD .campComms{left:50%;bottom:78px;}
      }
    `;
    document.head.appendChild(s);
  }

  setObjective(text) {
    this.objEl.textContent = String(text || '');
  }

  setWaypoint(wp) {
    if (!wp) {
      this.wpWrap.classList.add('hidden');
      this.wpLabel.textContent = '';
      this.wpDist.textContent = '';
      this.wpHint.textContent = '';
      this.setWaypointMarker(null);
      return;
    }
    this.wpWrap.classList.remove('hidden');
    this.wpLabel.textContent = String(wp.label || '');
    this.wpDist.textContent = String(wp.distText || '');
    this.wpHint.textContent = String(wp.hint || '');
  }

  // HF9-B2: marker = { x, y, onScreen, angleRad }
  setWaypointMarker(marker) {
    if (!this.wpMarker) return;
    if (!marker) {
      this.wpMarker.classList.remove('isVisible', 'isOnscreen', 'isOffscreen');
      return;
    }
    const x = Number(marker.x);
    const y = Number(marker.y);
    const onScreen = !!marker.onScreen;
    const a = Number(marker.angleRad) || 0;

    this.wpMarker.style.left = `${x}px`;
    this.wpMarker.style.top = `${y}px`;
    this.wpMarker.style.transform = 'translate(-50%,-50%)';

    this.wpMarker.classList.add('isVisible');
    this.wpMarker.classList.toggle('isOnscreen', onScreen);
    this.wpMarker.classList.toggle('isOffscreen', !onScreen);

    if (this.wpMarkerArrow) {
      this.wpMarkerArrow.style.transform = `rotate(${a}rad)`;
    }
  }

  setChecklist(items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      this.checklistEl.innerHTML = '';
      return;
    }
    this.checklistEl.innerHTML = list
      .map(it => {
        const done = !!it.done;
        const cls = done ? 'item done' : 'item';
        const txt = String(it.text || '');
        return `<div class="${cls}"><div class="dot"></div><div class="txt">${escapeHtml(txt)}</div></div>`;
      })
      .join('');
  }

  showSubtitle({ channel = 'RADIO', speaker = '', text = '', holdSec = 3.2, urgent = false } = {}) {
    const t = String(text || '').trim();
    if (!t) return;

    this.subWrap.classList.add('on');
    this.subWrap.classList.toggle('urgent', !!urgent);
    this.subWrap.setAttribute('aria-hidden', 'false');

    this.subChannel.textContent = String(channel || '');
    this.subSpeaker.textContent = String(speaker || '');
    this.subText.textContent = t;

    const sec = Math.max(0.5, Number(holdSec) || 2.8);
    this._subHideT = sec;
  }

  hideSubtitle() {
    this.subWrap.classList.remove('on', 'urgent');
    this.subWrap.setAttribute('aria-hidden', 'true');
    this.subChannel.textContent = '';
    this.subSpeaker.textContent = '';
    this.subText.textContent = '';
    this._subHideT = 0;
  }

  toast(msg, sec = 1.4) {
    const t = String(msg || '').trim();
    if (!t) return;
    this.toastEl.textContent = t;
    this.toastEl.classList.add('on');
    this.toastEl.setAttribute('aria-hidden', 'false');
    this._toastHideT = Math.max(0.35, Number(sec) || 1.2);
  }

  hideToast() {
    this.toastEl.textContent = '';
    this.toastEl.classList.remove('on');
    this.toastEl.setAttribute('aria-hidden', 'true');
    this._toastHideT = 0;
  }

  showTitleCard({ kicker = '', title = '', sub = '', holdSec = 2.6 } = {}) {
    const ttl = String(title || '').trim();
    if (!ttl) return;

    this.titleWrap.classList.add('on');
    this.titleWrap.setAttribute('aria-hidden', 'false');
    this.titleKicker.textContent = String(kicker || '').trim();
    this.titleTitle.textContent = ttl;
    this.titleSub.textContent = String(sub || '').trim();
    this._titleHideT = Math.max(0.6, Number(holdSec) || 2.6);
  }

  hideTitleCard() {
    this.titleWrap.classList.remove('on');
    this.titleWrap.setAttribute('aria-hidden', 'true');
    this.titleKicker.textContent = '';
    this.titleTitle.textContent = '';
    this.titleSub.textContent = '';
    this._titleHideT = 0;
  }

  // Backward-compat: HF8 briefing overlay APIs (no-op in HF9-A)
  showBriefing() {}
  hideBriefing() {}

  setCinematic(on) {
    const c = this.wrap.querySelector('.campCinematic');
    if (!c) return;
    if (on) c.classList.add('on');
    else c.classList.remove('on');
  }

  setFade(target = 0, vel = 10) {
    this._fade = clamp(Number(target) || 0, 0, 1);
    this._fadeVel = Math.max(0, Number(vel) || 0);
  }

  showResult({ title = 'RESULT', desc = '', canNext = false } = {}) {
    this.resultWrap.classList.add('on');
    this.resultWrap.setAttribute('aria-hidden', 'false');
    this.resultTitle.textContent = String(title || '');
    this.resultDesc.textContent = String(desc || '');
    this.btnNextMission.style.display = canNext ? '' : 'none';
  }

  hideResult() {
    this.resultWrap.classList.remove('on');
    this.resultWrap.setAttribute('aria-hidden', 'true');
  }

  update(dt) {
    const d = Math.max(0, Number(dt) || 0);

    if (this._subHideT > 0) {
      this._subHideT -= d;
      if (this._subHideT <= 0) this.hideSubtitle();
    }

    if (this._toastHideT > 0) {
      this._toastHideT -= d;
      if (this._toastHideT <= 0) this.hideToast();
    }

    if (this._titleHideT > 0) {
      this._titleHideT -= d;
      if (this._titleHideT <= 0) this.hideTitleCard();
    }

    if (this._fadeVel > 0) {
      const cur = Number(this.fadeEl.style.opacity || 0) || 0;
      const target = clamp(this._fade, 0, 1);
      const k = clamp(d * (this._fadeVel / 10), 0, 1);
      const next = cur + (target - cur) * k;
      this.fadeEl.style.opacity = String(next);
    }
  }
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
