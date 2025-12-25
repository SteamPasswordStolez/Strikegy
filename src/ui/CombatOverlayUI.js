// src/ui/CombatOverlayUI.js
// Patch 8-0X: Combat UI/FX overlay (HP + damage + death + respawn)
// Pure DOM overlay on top of the Three.js canvas.

export class CombatOverlayUI {
  constructor({ root = document.body } = {}) {
    this.root = root;
    this.state = "alive"; // alive | dead | respawning
    this.hpCur = 100;
    this.hpMax = 100;
    this.invincible = false;

    this._damageRaf = 0;
    this._damageTarget = 0;
    this._damageNow = 0;

    this._ensureStyle();
    this._build();

    this.setHP(100, 100);
    this.setInvincible(false);
    this.setAlive();
  }

  // -----------------------------
  // Public API (call from systems)
  // -----------------------------
  setHP(cur, max) {
    this.hpCur = Math.max(0, Number(cur) || 0);
    this.hpMax = Math.max(1, Number(max) || 1);
    const ratio = Math.max(0, Math.min(1, this.hpCur / this.hpMax));

    this.hpText.textContent = `${Math.round(this.hpCur)}/${Math.round(this.hpMax)}`;
    this.hpFill.style.transform = `scaleX(${ratio})`;

    // subtle low HP pulse
    this.hpPanel.dataset.low = ratio <= 0.25 ? "1" : "0";
  }

  setInvincible(on) {
    this.invincible = !!on;
    this.invTag.style.display = this.invincible ? "inline-flex" : "none";
  }

  // amount01: 0..1 (recommended: damage/maxHP)
  flashDamage(amount01 = 0.25) {
    const a = Math.max(0.08, Math.min(1, Number(amount01) || 0.25));
    // stack but cap
    this._damageTarget = Math.min(1, this._damageTarget + a * 0.9);
    this._startDamageTween();
  }

  setAlive() {
    this.state = "alive";
    this.deathScreen.style.opacity = "0";
    this.deathScreen.style.pointerEvents = "none";
    this.respawnScreen.style.opacity = "0";
    this.respawnScreen.style.pointerEvents = "none";
  }

  setDead({ killerText = "KILLED" } = {}) {
    this.state = "dead";
    this.deathTitle.textContent = killerText;
    this.deathScreen.style.opacity = "1";
    this.deathScreen.style.pointerEvents = "none";
    this.respawnScreen.style.opacity = "0";
  }

  // secondsLeft: number
  setRespawning(secondsLeft) {
    this.state = "respawning";
    const s = Math.max(0, Math.ceil(Number(secondsLeft) || 0));
    this.respawnCounter.textContent = String(s);
    this.respawnScreen.style.opacity = "1";
    this.respawnScreen.style.pointerEvents = "none";
    // keep death vignette faint while respawning
    this.deathScreen.style.opacity = "0.35";
  }

  respawnFlash() {
    // quick white flash + fade
    this.flash.style.opacity = "1";
    // force reflow
    void this.flash.offsetHeight;
    this.flash.style.transition = "opacity 260ms ease";
    this.flash.style.opacity = "0";
    window.setTimeout(() => {
      this.flash.style.transition = "";
    }, 300);
  }

  // Patch 7-4B: melee feedback (visual-only)
  meleeSwing(){
    if(!this.melee) return;
    this.melee.classList.remove('play');
    // restart animation
    void this.melee.offsetHeight;
    this.melee.classList.add('play');
  }

  destroy() {
    if (this._damageRaf) cancelAnimationFrame(this._damageRaf);
    this._damageRaf = 0;
    this.wrap?.remove();
  }

  // -----------------------------
  // Internals
  // -----------------------------
  _build() {
    // root wrapper
    const wrap = document.createElement("div");
    wrap.id = "combat-ui";
    wrap.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:10050;";
    this.wrap = wrap;

    // HP panel (bottom-left)
    const hpPanel = document.createElement("div");
    hpPanel.className = "combat-hp";
    hpPanel.dataset.low = "0";
    hpPanel.innerHTML = `
      <div class="combat-hp__row">
        <div class="combat-hp__label">HP</div>
        <div class="combat-hp__value" id="_hpText"></div>
        <div class="combat-hp__inv" id="_invTag">INV</div>
      </div>
      <div class="combat-hp__bar">
        <div class="combat-hp__fill" id="_hpFill"></div>
      </div>
    
      <div class="combat-bandage" id="_bandageWrap">
        <div class="combat-bandage__icon">🩹</div>
        <div class="combat-bandage__count" id="_bandageCount">1</div>
        <div class="combat-bandage__hint" id="_bandageHint">C</div>
      </div>
`;
    this.hpPanel = hpPanel;
    this.hpText = hpPanel.querySelector("#_hpText");
    this.hpFill = hpPanel.querySelector("#_hpFill");
    this.invTag = hpPanel.querySelector("#_invTag");

    // Bandage UI
    this.bandageWrap = hpPanel.querySelector("#_bandageWrap");
    this.bandageCountEl = hpPanel.querySelector("#_bandageCount");
    this.bandageHintEl = hpPanel.querySelector("#_bandageHint");
    this.setBandageHintActive(false);
    this.invTag.style.display = "none";

    // Damage vignette overlay
    const dmg = document.createElement("div");
    dmg.className = "combat-damage";
    this.damage = dmg;

    // Death screen
    const death = document.createElement("div");
    death.className = "combat-death";
    death.innerHTML = `
      <div class="combat-death__inner">
        <div class="combat-death__title" id="_deathTitle">KILLED</div>
        <div class="combat-death__sub">Press nothing. Respawn soon.</div>
      </div>
    `;
    this.deathScreen = death;
    this.deathTitle = death.querySelector("#_deathTitle");

    // Respawn screen
    const respawn = document.createElement("div");
    respawn.className = "combat-respawn";
    respawn.innerHTML = `
      <div class="combat-respawn__inner">
        <div class="combat-respawn__label">RESPAWNING</div>
        <div class="combat-respawn__counter" id="_respawnCounter">5</div>
      </div>
    `;
    this.respawnScreen = respawn;
    this.respawnCounter = respawn.querySelector("#_respawnCounter");

    // Respawn flash
    const flash = document.createElement("div");
    flash.className = "combat-flash";
    flash.style.opacity = "0";
    this.flash = flash;

    // Patch 9-1: Mode HUD (top) + capture pie (when inside a zone)
    const modeHud = document.createElement("div");
    modeHud.className = "modehud";
    modeHud.innerHTML = `
      <div class="modehud__top">
        <div class="modehud__mode" id="_mhMode">MODE</div>
        <div class="modehud__meta" id="_mhMeta">-</div>
      </div>
      <div class="modehud__objs" id="_mhObjs"></div>
      <div class="modehud__inzone" id="_mhInZone" style="display:none;">
        <div class="modehud__inzoneTitle" id="_mhInZoneTitle">ZONE</div>
        <div class="modehud__pie">
          <div class="pie pie--lg">
            <div class="pie__fill" id="_mhPieFill"></div>
          </div>
        </div>
      </div>
    `;
    this.modeHud = modeHud;
    this.mhMode = modeHud.querySelector("#_mhMode");
    this.mhMeta = modeHud.querySelector("#_mhMeta");
    this.mhObjs = modeHud.querySelector("#_mhObjs");
    this.mhInZone = modeHud.querySelector("#_mhInZone");
    this.mhInZoneTitle = modeHud.querySelector("#_mhInZoneTitle");
    this.mhPieFill = modeHud.querySelector("#_mhPieFill");
    this._objEls = new Map(); // id -> { el, pieFill, label }

    // Patch 9-1: Hit marker (center)
    const hit = document.createElement("div");
    hit.className = "hitmarker";
    hit.innerHTML = `<div class="hitmarker__x"></div>`;
    this.hit = hit;

    // Melee swing overlay (bottom-right)
    const melee = document.createElement("div");
    melee.className = "combat-melee";
    melee.innerHTML = `<div class="combat-melee__knife">🗡️</div>`;
    this.melee = melee;

    wrap.appendChild(dmg);
    wrap.appendChild(flash);
    wrap.appendChild(this.modeHud);
    wrap.appendChild(this.hit);
    wrap.appendChild(melee);
    wrap.appendChild(hpPanel);
    wrap.appendChild(death);
    wrap.appendChild(respawn);
    this.root.appendChild(wrap);

    // Patch 9-1B: Round end overlay (BF5-ish minimal)
    this.roundOverlay = document.createElement("div");
    this.roundOverlay.style.cssText = "position:absolute;inset:0;display:none;place-items:center;background:rgba(0,0,0,0.55);pointer-events:auto;z-index:999999;";
    const card = document.createElement("div");
    card.style.cssText = "width:min(520px,92vw);padding:18px 16px;border-radius:16px;background:rgba(18,18,18,0.92);border:1px solid rgba(255,255,255,0.10);box-shadow:0 20px 60px rgba(0,0,0,0.45);";
    this.roundTitle = document.createElement("div");
    this.roundTitle.style.cssText = "font-size:22px;font-weight:900;margin-bottom:8px;";
    this.roundDesc = document.createElement("div");
    this.roundDesc.style.cssText = "font-size:14px;opacity:0.92;margin-bottom:14px;";
    const btn = document.createElement("button");
    btn.textContent = "Restart";
    btn.style.cssText = "padding:10px 14px;border-radius:12px;border:none;font-weight:800;cursor:pointer;";
    btn.addEventListener("click", ()=> location.reload());
    card.append(this.roundTitle, this.roundDesc, btn);
    this.roundOverlay.appendChild(card);
    wrap.appendChild(this.roundOverlay);

  }

  _ensureStyle() {
    if (document.getElementById("combat-ui-style")) return;
    const style = document.createElement("style");
    style.id = "combat-ui-style";
    style.textContent = `
      /* Patch 8-0X Combat UI */
      .combat-hp{position:fixed;left:14px;bottom:14px;min-width:180px;max-width:260px;
        padding:10px 12px;border-radius:14px;background:rgba(0,0,0,0.45);
        backdrop-filter: blur(6px);-webkit-backdrop-filter: blur(6px);
        border:1px solid rgba(255,255,255,0.08);
        color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      }
      .combat-hp__row{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
      .combat-hp__label{font-weight:700;font-size:12px;letter-spacing:0.06em;opacity:0.9;}
      .combat-hp__value{margin-left:auto;font-variant-numeric: tabular-nums; font-size:12px; opacity:0.95;}
      .combat-hp__inv{display:inline-flex;align-items:center;justify-content:center;
        padding:2px 6px;border-radius:999px;font-size:11px;font-weight:700;
        background:rgba(80,190,255,0.22); border:1px solid rgba(80,190,255,0.35);
      }
      
.combat-bandage{display:flex;align-items:center;gap:8px;margin-top:8px;font-weight:700;font-size:14px;opacity:0.95}
.combat-bandage__icon{font-size:18px;line-height:1}
.combat-bandage__count{min-width:18px;text-align:left}
.combat-bandage__hint{margin-left:auto;border:1px solid rgba(255,255,255,0.35);border-radius:8px;padding:2px 8px;font-weight:800;letter-spacing:0.5px}
.combat-bandage__hint.blink{animation:combatBlink 0.8s infinite}
@keyframes combatBlink{0%,49%{opacity:1}50%,100%{opacity:0.25}}
.combat-hp__bar{height:10px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,0.10);
        border:1px solid rgba(255,255,255,0.08);
      }
      .combat-hp__fill{height:100%;width:100%;transform-origin:left center;transform:scaleX(1);
        background:linear-gradient(90deg, rgba(80,255,160,0.95), rgba(255,220,70,0.95), rgba(255,90,90,0.95));
      }
      .combat-hp[data-low="1"]{animation: combatHpPulse 900ms ease-in-out infinite;}
      @keyframes combatHpPulse{0%,100%{box-shadow:0 0 0 rgba(255,90,90,0)}50%{box-shadow:0 0 18px rgba(255,90,90,0.20)}}

      .combat-damage{position:fixed;inset:0;opacity:0;pointer-events:none;
        background: radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(255,0,0,0.30) 100%);
        transition: opacity 80ms linear;
        mix-blend-mode: screen;
      }

      .combat-death{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
        opacity:0;pointer-events:none;
        background:rgba(0,0,0,0.55);
        backdrop-filter: blur(2px) grayscale(0.8); -webkit-backdrop-filter: blur(2px) grayscale(0.8);
        transition: opacity 180ms ease;
      }
      .combat-death__inner{text-align:center;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
      .combat-death__title{font-size:34px;font-weight:900;letter-spacing:0.08em;}
      .combat-death__sub{margin-top:8px;font-size:13px;opacity:0.75;}

      .combat-respawn{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
        opacity:0;pointer-events:none;transition: opacity 120ms ease;
      }
      .combat-respawn__inner{text-align:center;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
      .combat-respawn__label{font-size:13px;letter-spacing:0.22em;font-weight:800;opacity:0.85;}
      .combat-respawn__counter{margin-top:10px;font-size:52px;font-weight:900;font-variant-numeric: tabular-nums;}

      /* Patch 7-4B: melee swing */
      .combat-melee{position:fixed;right:18px;bottom:18px;width:240px;height:240px;
        display:flex;align-items:flex-end;justify-content:flex-end;opacity:0;transform:translate(26px, 28px) rotate(-10deg);
        pointer-events:none;filter:drop-shadow(0 12px 18px rgba(0,0,0,0.35));
      }
      .combat-melee__knife{font-size:120px;line-height:1;transform:rotate(10deg);}
      .combat-melee.play{animation: combatMeleeSwing 320ms ease-out forwards;}
      @keyframes combatMeleeSwing{
        0%{opacity:0;transform:translate(30px, 34px) rotate(-18deg) scale(0.95)}
        20%{opacity:1}
        45%{opacity:1;transform:translate(-8px, -10px) rotate(18deg) scale(1.0)}
        100%{opacity:0;transform:translate(-28px, -16px) rotate(24deg) scale(0.98)}
      }

      .combat-flash{position:fixed;inset:0;pointer-events:none;background:rgba(255,255,255,0.92);}

      /* Patch 9-1: Mode + Objectives HUD */
      .modehud{position:fixed;left:50%;top:12px;transform:translateX(-50%);
        display:flex;flex-direction:column;align-items:center;gap:8px;
        pointer-events:none;z-index:10055;
        font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;
        text-shadow: 0 2px 10px rgba(0,0,0,.55);
      }
      .modehud__top{display:flex;align-items:baseline;gap:10px;
        padding:6px 10px;border-radius:14px;
        background:rgba(0,0,0,.30);border:1px solid rgba(255,255,255,.10);
        backdrop-filter: blur(6px);-webkit-backdrop-filter: blur(6px);
      }
      .modehud__mode{font-weight:900;letter-spacing:.10em;font-size:12px;opacity:.92;}
      .modehud__meta{font-weight:800;font-size:12px;opacity:.88;white-space:nowrap;}
      .modehud__objs{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:min(92vw,880px);}
      .objChip{position:relative;min-width:52px;height:30px;padding:0 10px;border-radius:999px;
        display:flex;align-items:center;justify-content:center;gap:8px;
        background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.12);
        backdrop-filter: blur(6px);-webkit-backdrop-filter: blur(6px);
      }
      .objChip[data-locked="1"]{opacity:.70;filter:saturate(.85);}
      .objChip[data-active="1"]{box-shadow:0 0 0 2px rgba(255,255,255,.22) inset;}
      .objChip__pieWrap{position:absolute;left:6px;top:50%;transform:translateY(-50%);width:18px;height:18px;pointer-events:none;}
      .objChip__label{font-weight:900;font-size:12px;letter-spacing:.12em;opacity:.95;line-height:1;}
      .pie{position:relative;width:18px;height:18px;border-radius:50%;background:rgba(180,180,180,.40);overflow:hidden;}
      .pie--lg{width:86px;height:86px;background:rgba(160,160,160,.40);}
      .pie__fill{position:absolute;inset:0;border-radius:50%;
        background: conic-gradient(var(--fill, rgba(255,255,255,.9)) 0deg var(--deg, 0deg), transparent 0deg);
        transform-origin:center;
      }
      .pie__fill[data-dir="ccw"]{transform:scaleX(-1);}
      .modehud__inzone{display:flex;flex-direction:column;align-items:center;gap:8px;
        padding:10px 12px;border-radius:18px;
        background:rgba(0,0,0,.30);border:1px solid rgba(255,255,255,.12);
        backdrop-filter: blur(6px);-webkit-backdrop-filter: blur(6px);
      }
      .modehud__inzoneTitle{font-weight:1000;font-size:12px;letter-spacing:.16em;opacity:.92;}
      .hitmarker{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
        width:52px;height:52px;pointer-events:none;opacity:0;
        z-index:10060;
      }
      .hitmarker__x{position:absolute;inset:0;
        background:
          linear-gradient(45deg, transparent 46%, rgba(255,255,255,.95) 47%, rgba(255,255,255,.95) 53%, transparent 54%),
          linear-gradient(-45deg, transparent 46%, rgba(255,255,255,.95) 47%, rgba(255,255,255,.95) 53%, transparent 54%);
        filter: drop-shadow(0 2px 10px rgba(0,0,0,.65));
        opacity:.95;
      }
      .hitmarker[data-kill="1"] .hitmarker__x{
        background:
          linear-gradient(45deg, transparent 44%, rgba(255,120,120,.95) 45%, rgba(255,120,120,.95) 55%, transparent 56%),
          linear-gradient(-45deg, transparent 44%, rgba(255,120,120,.95) 45%, rgba(255,120,120,.95) 55%, transparent 56%);
      }

    `;
    document.head.appendChild(style);
  }

  _startDamageTween() {
    if (this._damageRaf) return;
    const step = () => {
      // approach target
      this._damageNow += (this._damageTarget - this._damageNow) * 0.35;
      // decay target
      this._damageTarget *= 0.88;
      if (this._damageTarget < 0.01) this._damageTarget = 0;

      this.damage.style.opacity = String(Math.max(0, Math.min(1, this._damageNow)));

      if (this._damageNow < 0.02 && this._damageTarget === 0) {
        this._damageNow = 0;
        this.damage.style.opacity = "0";
        this._damageRaf = 0;
        return;
      }
      this._damageRaf = requestAnimationFrame(step);
    };
    this._damageRaf = requestAnimationFrame(step);
  }

  setBandageCount(count){
    // count can be Infinity for unlimited
    if(!this.bandageCountEl) return;
    const inf = (count === Infinity || count === -1);
    this._bandageInf = inf;
    if(inf){
      this.bandageCountEl.textContent = "∞";
      this.bandageWrap?.classList.add("is-inf");
    }else{
      const n = Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0);
      this.bandageCountEl.textContent = String(n);
      this.bandageWrap?.classList.remove("is-inf");
    }
  }

  setBandageHintActive(active){
    if(!this.bandageHintEl) return;
    this.bandageHintEl.style.opacity = active ? "1" : "0.35";
    if(active) this.bandageHintEl.classList.add("blink");
    else this.bandageHintEl.classList.remove("blink");
  }
  // Patch 9-1: Mode/Capture UI update
  setModeState(state){
    if(!state || !this.modeHud) return;

    const mode = String(state.mode || "zone").toUpperCase();
    this.mhMode.textContent = mode;

    // Meta line
    let meta = "";
    if(state.mode === "zone"){
      meta = `Tickets B:${state.tickets?.blue ?? "-"} / R:${state.tickets?.red ?? "-"}`;
    }else if(state.mode === "conquest"){
      const t = Math.max(0, Math.ceil(state.conquest?.timeLeft ?? 0));
      const mm = String(Math.floor(t/60)).padStart(2,"0");
      const ss = String(t%60).padStart(2,"0");
      meta = `Time ${mm}:${ss}  |  Active ${state.activeZoneId ?? "-"}`;
    }else if(state.mode === "frontline"){
      const a = (state.frontline?.attacker || "blue").toUpperCase();
      const t = Math.max(0, Math.ceil(state.frontline?.swapLeft ?? 0));
      const mm = String(Math.floor(t/60)).padStart(2,"0");
      const ss = String(t%60).padStart(2,"0");
      meta = `ATK ${a}  |  Swap ${mm}:${ss}  |  Active ${state.activeZoneId ?? "-"}`;
    }else{
      meta = `Active ${state.activeZoneId ?? "-"}`;
    }
    this.mhMeta.textContent = meta;

    // Ensure objective chips
    const zones = Array.isArray(state.zones) ? state.zones : [];
    this._ensureObjectiveChips(zones);

    // Update chips
    for(const z of zones){
      const row = this._objEls.get(z.id);
      if(!row) continue;
      row.el.dataset.locked = z.locked ? "1" : "0";
      row.el.dataset.active = z.active ? "1" : "0";

      // Fill
      const fillColor = this._teamColor(z.fillTeam);
      const deg = Math.max(0, Math.min(360, (Number(z.fill)||0) * 360));
      row.pieFill.style.setProperty("--fill", fillColor);
      row.pieFill.style.setProperty("--deg", `${deg}deg`);
      row.pieFill.dataset.dir = (z.dir === "ccw") ? "cw" : "ccw";
    }

    // In-zone big pie
    const inId = state.inZoneId;
    if(inId){
      const z = zones.find(x=>x.id===inId) || null;
      this.mhInZone.style.display = "";
      this.mhInZoneTitle.textContent = `ZONE ${inId}`;
      const fillColor = this._teamColor(z?.fillTeam);
      const deg = Math.max(0, Math.min(360, (Number(z?.fill)||0) * 360));
      this.mhPieFill.style.setProperty("--fill", fillColor);
      this.mhPieFill.style.setProperty("--deg", `${deg}deg`);
      this.mhPieFill.dataset.dir = (z?.dir === "ccw") ? "cw" : "ccw";
    }else{
      this.mhInZone.style.display = "none";
    }
  }

  _ensureObjectiveChips(zones){
    // Create missing, remove extra
    const want = new Set(zones.map(z=>z.id));
    // Remove old
    for(const [id,row] of this._objEls.entries()){
      if(!want.has(id)){
        row.el.remove();
        this._objEls.delete(id);
      }
    }
    // Create new in order
    for(const z of zones){
      if(this._objEls.has(z.id)) continue;
      const chip = document.createElement("div");
      chip.className = "objChip";
      chip.dataset.locked = "0";
      chip.dataset.active = "0";
      chip.innerHTML = `
        <div class="objChip__pieWrap">
          <div class="pie"><div class="pie__fill" data-dir="cw"></div></div>
        </div>
        <div class="objChip__label">${z.id}</div>
      `;
      const pieFill = chip.querySelector(".pie__fill");
      this.mhObjs.appendChild(chip);
      this._objEls.set(z.id, { el: chip, pieFill, label: chip.querySelector(".objChip__label") });
    }
  }

  _teamColor(team){
    const t = String(team||"").toLowerCase();
    if(t === "blue") return "rgba(70, 170, 255, 0.95)";
    if(t === "red") return "rgba(255, 90, 90, 0.95)";
    return "rgba(255,255,255,0)"; // transparent fill
  }

  // Patch 9-1: Hit marker feedback when YOU hit an enemy
  hitMarker({ killed = false } = {}){
    if(!this.hit) return;
    try{ clearTimeout(this._hitTO); }catch(e){}
    this.hit.dataset.kill = killed ? "1" : "0";
    this.hit.style.opacity = "1";
    // quick pulse
    this.hit.animate?.(
      [{ transform:"translate(-50%,-50%) scale(0.85)", opacity:0.0 },
       { transform:"translate(-50%,-50%) scale(1.00)", opacity:1.0 },
       { transform:"translate(-50%,-50%) scale(0.92)", opacity:0.0 }],
      { duration: 160, easing:"ease-out" }
    );
    this._hitTO = setTimeout(()=>{ if(this.hit) this.hit.style.opacity="0"; }, 180);
  }


  showRoundResult(res){
    if(!this.roundOverlay) return;
    const r = res || {};
    const w = (r.winner || '').toString().toUpperCase();
    this.roundTitle.textContent = `${w} WIN`;
    const reason = r.reason || '';
    this.roundDesc.textContent = (reason==='tickets') ? '상대 티켓이 0이 되었습니다.' :
      (reason==='all') ? '모든 목표를 점령했습니다.' :
      (reason==='time') ? '시간이 종료되었습니다.' :
      (reason==='time_tiebreak') ? '동률: 전선 점령 우세로 판정되었습니다.' : '라운드 종료';
    this.roundOverlay.style.display = 'grid';
  }
}
