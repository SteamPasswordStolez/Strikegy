// src/input/InputManager.js
// Patch 4: 프리셋별 입력을 공통 포맷으로 통합한다.

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

export class InputManager {
  constructor({ domElement, settingsStore }){
    this.dom = domElement;
    this.settings = settingsStore;

    this.enabled = true;

    // keyboard state
    this.keys = new Set();

    // one-shot presses
    this._jumpPressed = false;
    this._crouchTogglePressed = false;

    // look deltas (accumulated per frame)
    this.lookDX = 0;
    this.lookDY = 0;

    // touch state (mobile look / move)
    this._touchMoveActive = false;
    this._touchLookActive = false;
    this._moveStart = null; // {id,x,y}
    this._lookStart = null; // {id,x,y, lastX, lastY}

    // output
    this.state = { moveX:0, moveZ:0, lookDX:0, lookDY:0, jumpPressed:false, sprintHeld:false, crouchTogglePressed:false };

    // bind
    this._onKeyDown = (e)=>this._handleKey(e, true);
    this._onKeyUp   = (e)=>this._handleKey(e, false);
    this._onMouseMove = (e)=>this._handleMouseMove(e);
    this._onPointerLockChange = ()=>{ /* no-op: game decides */ };

    this._onTouchStart = (e)=>this._handleTouchStart(e);
    this._onTouchMove  = (e)=>this._handleTouchMove(e);
    this._onTouchEnd   = (e)=>this._handleTouchEnd(e);

    window.addEventListener("keydown", (e) => {
      // avoid ctrl-based browser shortcuts: we don't bind ctrl at all
      if(e.code === "ControlLeft" || e.code === "ControlRight") return;

      // edge detect
      const wasDown = this.keys.has(e.code);
      if(e.code === "Space") e.preventDefault();
      this.keys.add(e.code);

      if(!wasDown){
        if(e.code === "Space") { this._jumpPressed = true; e.preventDefault(); }

        if(e.code === "KeyX") this._crouchTogglePressed = true;
      }
    });

    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener("mousemove", this._onMouseMove);

    // touch on canvas
    this.dom.addEventListener("touchstart", this._onTouchStart, { passive:false });
    this.dom.addEventListener("touchmove",  this._onTouchMove,  { passive:false });
    this.dom.addEventListener("touchend",   this._onTouchEnd,   { passive:false });
    this.dom.addEventListener("touchcancel",this._onTouchEnd,   { passive:false });
  }

  destroy(){
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("mousemove", this._onMouseMove);

    this.dom.removeEventListener("touchstart", this._onTouchStart);
    this.dom.removeEventListener("touchmove",  this._onTouchMove);
    this.dom.removeEventListener("touchend",   this._onTouchEnd);
    this.dom.removeEventListener("touchcancel",this._onTouchEnd);
  }

  _handleKey(e, down){
    // 입력이 UI에 먹히지 않도록: form 요소 등은 무시
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    if(tag === "input" || tag === "textarea" || tag === "select") return;

    const k = e.key.toLowerCase();

    if(down) this.keys.add(k);
    else this.keys.delete(k);
  }

  _handleMouseMove(e){
    // PC 프리셋에서만 마우스 시점 사용
    const preset = this.settings.controlPreset;
    if(preset !== "pc") return;

    // 포인터락 상태에서만 누적
    if(document.pointerLockElement !== this.dom) return;

    this.lookDX += e.movementX || 0;
    this.lookDY += e.movementY || 0;
  }

  _handleTouchStart(e){
    const preset = this.settings.controlPreset;
    if(preset === "pc") return;

    // 화면을 좌/우로 나눠서: 왼쪽 = 이동, 오른쪽 = 시점
    const rect = this.dom.getBoundingClientRect();
    const midX = rect.left + rect.width * 0.5;

    for(const t of Array.from(e.changedTouches)){
      const x = t.clientX, y = t.clientY;
      if(x < midX && !this._touchMoveActive){
        this._touchMoveActive = true;
        this._moveStart = { id: t.identifier, x, y, lastX:x, lastY:y };
      } else if(x >= midX && !this._touchLookActive){
        this._touchLookActive = true;
        this._lookStart = { id: t.identifier, x, y, lastX:x, lastY:y };
      }
    }
  }

  _handleTouchMove(e){
    const preset = this.settings.controlPreset;
    if(preset === "pc") return;

    // 스크롤 방지
    e.preventDefault();

    const move = this._moveStart;
    const look = this._lookStart;

    for(const t of Array.from(e.changedTouches)){
      if(move && t.identifier === move.id){
        move.lastX = t.clientX;
        move.lastY = t.clientY;
      }
      if(look && t.identifier === look.id){
        // look delta 누적
        const dx = t.clientX - look.lastX;
        const dy = t.clientY - look.lastY;
        look.lastX = t.clientX;
        look.lastY = t.clientY;
        this.lookDX += dx;
        this.lookDY += dy;
      }
    }
  }

  _handleTouchEnd(e){
    const preset = this.settings.controlPreset;
    if(preset === "pc") return;

    for(const t of Array.from(e.changedTouches)){
      if(this._moveStart && t.identifier === this._moveStart.id){
        this._moveStart = null;
        this._touchMoveActive = false;
      }
      if(this._lookStart && t.identifier === this._lookStart.id){
        this._lookStart = null;
        this._touchLookActive = false;
      }
    }
  }

  setEnabled(v){ this.enabled = !!v; }

  // frame update: produce unified state
  poll(){
    if(!this.enabled){
      this.state = { moveX:0, moveZ:0, lookDX:0, lookDY:0, jumpPressed:false, sprintHeld:false, crouchTogglePressed:false };
      this.lookDX = 0; this.lookDY = 0;
      return this.state;
    }

    const preset = this.settings.controlPreset;

    // move from keyboard or virtual stick
    let moveX = 0, moveZ = 0;
    let sprintHeld = false;
    let jumpPressed = false;
    let crouchTogglePressed = false;

    const k = this.keys;
    // WASD only for pc and mobile_kb
    if(preset === "pc" || preset === "mobile_kb"){
      if(k.has("KeyA")) moveX -= 1;
      if(k.has("KeyD")) moveX += 1;
      if(k.has("KeyW")) moveZ += 1;
      if(k.has("KeyS")) moveZ -= 1;

      // sprint (Shift hold)
      sprintHeld = k.has("ShiftLeft") || k.has("ShiftRight");
    }

    // mobile move: simple "virtual stick" using touch drag on left side
    if(preset === "mobile"){
      if(this._moveStart){
        const dx = (this._moveStart.lastX - this._moveStart.x);
        const dy = (this._moveStart.lastY - this._moveStart.y);
        // normalize by 60px deadzone
        moveX = clamp(dx / 60, -1, 1);
        moveZ = clamp(-dy / 60, -1, 1); // up drag -> forward
      }
      // jump button은 Patch 4.1에서(이 패치에서는 점프는 비활성)
      jump = false;
    }


    // sprint (Shift hold) — pc/mobile_kb only
    if(preset === "pc" || preset === "mobile_kb"){
      sprintHeld = k.has("ShiftLeft") || k.has("ShiftRight");
    }

    // one-shot buttons
    jumpPressed = this._jumpPressed;
    crouchTogglePressed = this._crouchTogglePressed;
    this._jumpPressed = false;
    this._crouchTogglePressed = false;

    // look deltas
    const lookDX = this.lookDX;
    const lookDY = this.lookDY;
    this.lookDX = 0;
    this.lookDY = 0;

    this.state = { moveX, moveZ, lookDX, lookDY, jumpPressed, sprintHeld, crouchTogglePressed };
    return this.state;
  }
}
