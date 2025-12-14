export default class MobileHUD {
  /**
   * @param {{root:HTMLElement, input:any, presetGetter:()=>string}} opts
   */
  constructor(opts){
    this.root = opts.root;
    this.input = opts.input;
    this.getPreset = opts.presetGetter;

    this.el = document.createElement("div");
    this.el.id = "mobileHUD";
    this.el.className = "mobileHUD hidden";

    this.el.innerHTML = `
      <div class="mh-joystickArea" id="mhJoyArea"><div class="mh-joyBase" id="mhJoyBase"><div class="mh-joyKnob" id="mhJoyKnob"></div></div></div>
      <div class="mh-buttons">
        <button class="mh-btn" id="mhJump">JUMP</button>
        <button class="mh-btn" id="mhSprint">SPRINT</button>
        <button class="mh-btn" id="mhCrouch">CROUCH</button>
      </div>
      <div class="mh-lookHint">Drag right side to look</div>
    `;

    this.root.appendChild(this.el);

    // touch tracking
    this.joy = { active:false, id:null, cx:0, cy:0, x:0, y:0 };
    this.look = { active:false, id:null, lx:0, ly:0 };

    this._bind();
  }

  show(){
    this.el.classList.remove("hidden");
  }
  hide(){
    this.el.classList.add("hidden");
    this.input.setVirtualMove(0,0);
  }

  _bind(){
    const joyArea = this.el.querySelector("#mhJoyArea");
    const joyBase = this.el.querySelector("#mhJoyBase");
    const joyKnob = this.el.querySelector("#mhJoyKnob");
    const btnJump = this.el.querySelector("#mhJump");
    const btnSprint = this.el.querySelector("#mhSprint");
    const btnCrouch = this.el.querySelector("#mhCrouch");

    // Buttons
    btnJump.addEventListener("click", (e)=>{ e.preventDefault(); this.input.pressJump(); });
    btnSprint.addEventListener("click", (e)=>{ e.preventDefault(); this.input.toggleSprint(); btnSprint.classList.toggle("on"); });
    btnCrouch.addEventListener("click", (e)=>{ e.preventDefault(); this.input.toggleCrouch(); btnCrouch.classList.toggle("on"); });

    // Joystick: left side zone (move handling on window so it still works outside the area)
    const startJoy = (t)=>{
      this.joy.active = true;
      this.joy.id = t.identifier;
      this.joy.cx = t.clientX;
      this.joy.cy = t.clientY;
      this.joy.x = 0; this.joy.y = 0;
      // place base at touch start
      joyBase.style.left = `${t.clientX}px`;
      joyBase.style.top = `${t.clientY}px`;
      joyBase.classList.add('on');
      joyKnob.style.transform = `translate(0px, 0px)`;
      this.input.setVirtualMove(0,0);
    };

    const moveJoy = (t)=>{
      const dx = t.clientX - this.joy.cx;
      const dy = t.clientY - this.joy.cy;
      const max = 55;
      const nx = Math.max(-1, Math.min(1, dx / max));
      const ny = Math.max(-1, Math.min(1, dy / max));
      this.joy.x = nx; this.joy.y = ny;

      // move knob
      joyKnob.style.transform = `translate(${nx*28}px, ${ny*28}px)`;

      // forward is negative dy
      this.input.setVirtualMove(nx, -ny);
    };

    const endJoy = ()=>{
      this.joy.active = false;
      this.joy.id = null;
      this.input.setVirtualMove(0,0);
      joyBase.classList.remove('on');
      joyKnob.style.transform = `translate(0px, 0px)`;
    };

    joyArea.addEventListener("touchstart", (e)=>{
      if(this.getPreset() !== "mobile") return;
      const t = e.changedTouches[0];
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
    window.addEventListener("touchend", endJoyByEvent, { passive:false });
    window.addEventListener("touchcancel", endJoyByEvent, { passive:false });

    // Look swipe: right half of screen excluding buttons
    window.addEventListener("touchstart", (e)=>{
      const preset = this.getPreset();
      if(preset !== "mobile" && preset !== "mobile_kb") return;

      for(const t of e.changedTouches){
        // ignore touches on HUD elements
        const target = document.elementFromPoint(t.clientX, t.clientY);
        if(target && (target.closest("#mobileHUD") || target.closest(".overlay"))) continue;

        // right side only
        if(t.clientX < window.innerWidth * 0.45) continue;

        this.look.active = true;
        this.look.id = t.identifier;
        this.look.lx = t.clientX;
        this.look.ly = t.clientY;
        break;
      }
    }, { passive:true });

    window.addEventListener("touchmove", (e)=>{
      if(!this.look.active) return;
      const t = [...e.changedTouches].find(tt=>tt.identifier===this.look.id);
      if(!t) return;

      const dx = t.clientX - this.look.lx;
      const dy = t.clientY - this.look.ly;
      this.look.lx = t.clientX;
      this.look.ly = t.clientY;

      // scale
      this.input.addVirtualLook(dx * 0.6, dy * 0.6);
    }, { passive:true });

    const endLook = (e)=>{
      const t = [...e.changedTouches].find(tt=>tt.identifier===this.look.id);
      if(!t) return;
      this.look.active = false;
      this.look.id = null;
    };
    window.addEventListener("touchend", endLook, { passive:true });
    window.addEventListener("touchcancel", endLook, { passive:true });
  }
}
