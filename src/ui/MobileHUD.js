export default class MobileHUD {
  /**
   * Patch 5B-1 (Progress)
   * - FPS mobile layout (circular buttons)
   * - Add buttons: Fire(🔫), ADS Toggle(🎯), Reload(🔄), Next Weapon TEST(🔁)
   * - Keep contract: show()/hide()/destroy()
   * - NO weapon logic wiring here (UI + state only). Input wiring remains virtual move/look + jump/sprint/crouch.
   *
   * @param {{root:HTMLElement, input:any, presetGetter:()=>string}} opts
   */
  constructor(opts){
    this.root = opts.root;
    this.input = opts.input;
    this.getPreset = opts.presetGetter || (()=>"pc");

    this.state = {
      fireHeld:false,
      adsOn:false,
      reloadPressed:false,
      nextWeaponPressed:false,
    };

    this.joy = { active:false, id:null, startX:0, startY:0, curX:0, curY:0 };
    this.look = { active:false, id:null, lastX:0, lastY:0 };

    this.el = document.createElement("div");
    this.el.id = "mobileHUD";
    this.el.className = "mobileHUD hidden";

    this.el.innerHTML = `
      <div class="mh-joystickArea" id="mhJoyArea" aria-label="Move joystick area">
        <div class="mh-joyBase" id="mhJoyBase" aria-hidden="true">
          <div class="mh-joyKnob" id="mhJoyKnob" aria-hidden="true"></div>
        </div>
      </div>

      <div class="mh-combat" aria-label="Combat buttons">
        <button class="mh-btn mh-btn--small" id="mhADS" type="button" aria-label="Aim toggle">🎯</button>
        <button class="mh-btn mh-btn--small" id="mhReload" type="button" aria-label="Reload">🔄</button>
        <button class="mh-btn mh-btn--small" id="mhNextWeapon" type="button" aria-label="Next weapon">🔁</button>
        <button class="mh-btn mh-btn--jump" id="mhJump" type="button" aria-label="Jump">⬆️</button>
        <button class="mh-btn mh-btn--fire" id="mhFire" type="button" aria-label="Fire">🔫</button>
      </div>

      <div class="mh-actions" aria-label="Action buttons">
        <button class="mh-btn" id="mhSprint" type="button" aria-label="Sprint toggle">🏃</button>
        <button class="mh-btn" id="mhCrouch" type="button" aria-label="Crouch toggle">⬇️</button>
      </div>

      <div class="mh-lookHint">Drag upper-right to look</div>
    `;

    this.root.appendChild(this.el);
    this._bind();
  }

  show(){
    this.el.classList.remove("hidden");
  }

  hide(){
    this.el.classList.add("hidden");
    // stop any held state to avoid stuck input
    this._setFireHeld(false);
    this._setVirtualMove(0, 0);
    this._stopLook();
    this.consumePulses();
  }

  consumePulses(){
    this.state.reloadPressed = false;
    this.state.nextWeaponPressed = false;
  }

  destroy(){
    this.hide();
    this.el.remove();
  }

  // ---- internal helpers ----
  _setVirtualMove(x, z){
    if(this.input?.setVirtualMove) this.input.setVirtualMove(x, z);
  }

  _addVirtualLook(dx, dy){
    if(this.input?.addVirtualLook) this.input.addVirtualLook(dx, dy);
  }

  _setFireHeld(v){
    this.state.fireHeld = !!v;
    const b = this.el.querySelector("#mhFire");
    if(b) b.classList.toggle("on", this.state.fireHeld);
  }

  _toggleADS(){
    this.state.adsOn = !this.state.adsOn;
    const b = this.el.querySelector("#mhADS");
    if(b){
      b.classList.toggle("active", this.state.adsOn);
      b.textContent = this.state.adsOn ? "🎯✨" : "🎯";
    }
  }

  _pulse(btn){
    if(!btn) return;
    btn.classList.add("pulse");
    window.setTimeout(()=>btn.classList.remove("pulse"), 140);
  }

  _stopLook(){
    this.look.active = false;
    this.look.id = null;
  }

  _bind(){
    const joyArea = this.el.querySelector("#mhJoyArea");
    const joyBase = this.el.querySelector("#mhJoyBase");
    const joyKnob = this.el.querySelector("#mhJoyKnob");

    const btnJump = this.el.querySelector("#mhJump");
    const btnSprint = this.el.querySelector("#mhSprint");
    const btnCrouch = this.el.querySelector("#mhCrouch");

    const btnFire = this.el.querySelector("#mhFire");
    const btnADS = this.el.querySelector("#mhADS");
    const btnReload = this.el.querySelector("#mhReload");
    const btnNext = this.el.querySelector("#mhNextWeapon");

    // ---- action buttons (existing behavior) ----
    btnJump?.addEventListener("click", (e)=>{ e.preventDefault(); this.input?.pressJump?.(); });

    btnSprint?.addEventListener("click", (e)=>{
      e.preventDefault();
      this.input?.toggleSprint?.();
      btnSprint.classList.toggle("on");
    });

    btnCrouch?.addEventListener("click", (e)=>{
      e.preventDefault();
      this.input?.toggleCrouch?.();
      btnCrouch.classList.toggle("on");
    });

    // ---- new combat buttons (5B-1: UI + state only) ----
    // Fire: hold
    const fireDown = (e)=>{ e.preventDefault?.(); this._setFireHeld(true); };
    const fireUp = (e)=>{ this._setFireHeld(false); };
    btnFire?.addEventListener("touchstart", fireDown, { passive:false });
    btnFire?.addEventListener("touchend", fireUp, { passive:true });
    btnFire?.addEventListener("touchcancel", fireUp, { passive:true });
    btnFire?.addEventListener("mousedown", fireDown);
    window.addEventListener("mouseup", fireUp);

    // ADS: toggle with visual state (C: outline/glow + icon change)
    btnADS?.addEventListener("click", (e)=>{ e.preventDefault(); this._toggleADS(); });

    // Reload / NextWeapon: momentary
    btnReload?.addEventListener("click", (e)=>{
      e.preventDefault();
      this.state.reloadPressed = true;
      this._pulse(btnReload);});

    btnNext?.addEventListener("click", (e)=>{
      e.preventDefault();
      this.state.nextWeaponPressed = true;
      this._pulse(btnNext);});

    // ---- joystick (move) ----
    const clamp = (v, a, b)=>Math.max(a, Math.min(b, v));

    const setJoyVisual = (x, y)=>{
      // x,y in [-1,1]
      const max = 44;
      joyKnob.style.transform = `translate(calc(-50% + ${x*max}px), calc(-50% + ${y*max}px))`;
    };

    const startJoy = (t)=>{
      this.joy.active = true;
      this.joy.id = t.identifier;
      this.joy.startX = t.clientX;
      this.joy.startY = t.clientY;
      // place base centered at touch
      joyBase.style.left = `${t.clientX}px`;
      joyBase.style.top = `${t.clientY}px`;
      joyBase.classList.add("show");
      setJoyVisual(0,0);
      this._setVirtualMove(0,0);
    };

    const moveJoy = (t)=>{
      const dx = t.clientX - this.joy.startX;
      const dy = t.clientY - this.joy.startY;
      const nx = clamp(dx / 60, -1, 1);
      const ny = clamp(dy / 60, -1, 1);

      // Virtual move uses x,z where z forward is negative screen y (up)
      const moveX = nx;
      const moveZ = -ny;

      this._setVirtualMove(moveX, moveZ);
      setJoyVisual(nx, ny);
    };

    const endJoy = ()=>{
      this.joy.active = false;
      this.joy.id = null;
      joyBase.classList.remove("show");
      setJoyVisual(0,0);
      this._setVirtualMove(0,0);
    };

    joyArea?.addEventListener("touchstart", (e)=>{
      if(this.getPreset() === "pc") return;
      const t = e.changedTouches[0];
      if(!t) return;
      startJoy(t);
      e.preventDefault();
    }, { passive:false });

    window.addEventListener("touchmove", (e)=>{
      if(!this.joy.active) return;
      const t = [...e.changedTouches].find(tt=>tt.identifier===this.joy.id);
      if(!t) return;
      moveJoy(t);
      e.preventDefault();
    }, { passive:false });

    const endJoyByEvent = (e)=>{
      if(!this.joy.active) return;
      const t = [...e.changedTouches].find(tt=>tt.identifier===this.joy.id);
      if(!t) return;
      endJoy();
    };
    window.addEventListener("touchend", endJoyByEvent, { passive:true });
    window.addEventListener("touchcancel", endJoyByEvent, { passive:true });

    // ---- swipe look (right side drag) ----
    const isOnHudControl = (el)=>{
      if(!el) return false;
      return !!el.closest?.(".mh-btn") || !!el.closest?.("#mhJoyArea");
    };

    window.addEventListener("touchstart", (e)=>{
      if(this.getPreset() === "pc") return;
      // ignore if touching a HUD control
      const t = e.changedTouches[0];
      if(!t) return;
      if(isOnHudControl(document.elementFromPoint(t.clientX, t.clientY))) return;

      // right side zone (B: top/mid only; bottom reserved for buttons)
      if(t.clientX < window.innerWidth * 0.45) return;
      const reservedBottom = 260; // px, includes HUD buttons/ammo UI area
      if(t.clientY > window.innerHeight - reservedBottom) return;
      this.look.active = true;
      this.look.id = t.identifier;
      this.look.lastX = t.clientX;
      this.look.lastY = t.clientY;
    }, { passive:true });

    window.addEventListener("touchmove", (e)=>{
      if(!this.look.active) return;
      const t = [...e.changedTouches].find(tt=>tt.identifier===this.look.id);
      if(!t) return;

      const dx = t.clientX - this.look.lastX;
      const dy = t.clientY - this.look.lastY;
      this.look.lastX = t.clientX;
      this.look.lastY = t.clientY;

      // scale: tune later
      this._addVirtualLook(dx * 0.6, dy * 0.6);
    }, { passive:true });

    window.addEventListener("touchend", (e)=>{
      if(!this.look.active) return;
      const t = [...e.changedTouches].find(tt=>tt.identifier===this.look.id);
      if(!t) return;
      this._stopLook();
    }, { passive:true });

    window.addEventListener("touchcancel", (e)=>{
      if(!this.look.active) return;
      const t = [...e.changedTouches].find(tt=>tt.identifier===this.look.id);
      if(!t) return;
      this._stopLook();
    }, { passive:true });

    // prevent page scroll while HUD visible on mobile presets
    this.el.addEventListener("touchmove", (e)=>{ if(this.getPreset()!=="pc") e.preventDefault(); }, { passive:false });
  }
}
