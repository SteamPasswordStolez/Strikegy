// src/camera/CameraController.js
// Patch 4: yaw/pitch 관리 + 감도 적용(유일 지점)

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

export class CameraController {
  constructor({ playerObject, camera, settingsStore }){
    this.player = playerObject;
    this.camera = camera;
    this.settings = settingsStore;

    this.yaw = -Math.PI / 2; // -90° initial
     // -90° (initial)
     // -90° (initial)
       // radians, applied to player rotation.y
    this.pitch = 0; // radians, applied to camera rotation.x

    this.pitchMin = -Math.PI * 0.49;
    this.pitchMax =  Math.PI * 0.49;

    // base multipliers
    this.mouseScale = 0.0020;
    this.touchScale = 0.0035; // touch tends to be smaller deltas

    // ===== Patch 7-2B: recoil offsets (applied on top of yaw/pitch) =====
    // Keep base yaw/pitch pristine; recoil is temporary offset that decays back to 0.
    this.recoilYaw = 0;   // radians
    this.recoilPitch = 0; // radians
  
    this.applyRotation();
}

  setFromSpawnYawDegrees(yawDeg){
    const yawRad = (Number(yawDeg) || 0) * Math.PI / 180;
    this.yaw = yawRad;
    this._apply();
  }

  applyLookDelta(dx, dy, isTouch=false){
    const sens = this.settings.sensitivity;
    const scale = (isTouch ? this.touchScale : this.mouseScale) * sens;

    this.yaw   -= dx * scale; // mouse right -> yaw right
    this.pitch -= dy * scale; // mouse down -> look down

    this.pitch = clamp(this.pitch, this.pitchMin, this.pitchMax);
    this._apply();
  }

  _apply(){
    // Apply recoil as an offset so input and recoil never fight.
    this.player.rotation.y = this.yaw + this.recoilYaw;
    this.camera.rotation.x = this.pitch + this.recoilPitch;
  }

  applyRotation(){
    this._apply();
  }

  // --- Patch 7-2B API ---
  // Add recoil kick in radians. Caller may scale based on ADS.
  addRecoil(pitchKick, yawKick){
    this.recoilPitch += (Number(pitchKick) || 0);
    this.recoilYaw   += (Number(yawKick)   || 0);
    // Clamp pitch recoil so we don't snap beyond clamp range.
    this.recoilPitch = clamp(this.recoilPitch, -0.35, 0.55);
    this.recoilYaw = clamp(this.recoilYaw, -0.55, 0.55);
    this._apply();
  }

  // Frame-independent recoil recovery.
  // returnSpeed: how fast recoil decays (higher = faster return)
  updateRecoil(dt, returnSpeed=14){
    const t = 1 - Math.exp(-(Number(returnSpeed)||14) * dt);
    this.recoilPitch = this.recoilPitch + (0 - this.recoilPitch) * t;
    this.recoilYaw   = this.recoilYaw   + (0 - this.recoilYaw)   * t;
    this._apply();
  }

  getDebug(){
    return {
      yawDeg: (this.yaw * 180 / Math.PI).toFixed(1),
      pitchDeg: (this.pitch * 180 / Math.PI).toFixed(1)
    };
  }

}
