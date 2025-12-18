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

    // Melee swing overlay (bottom-right)
    const melee = document.createElement("div");
    melee.className = "combat-melee";
    melee.innerHTML = `<div class="combat-melee__knife">🗡️</div>`;
    this.melee = melee;

    wrap.appendChild(dmg);
    wrap.appendChild(flash);
    wrap.appendChild(melee);
    wrap.appendChild(hpPanel);
    wrap.appendChild(death);
    wrap.appendChild(respawn);
    this.root.appendChild(wrap);
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
}


