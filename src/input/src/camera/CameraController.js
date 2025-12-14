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
    this.player.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  applyRotation(){
    this._apply();
  }

  getDebug(){
    return {
      yawDeg: (this.yaw * 180 / Math.PI).toFixed(1),
      pitchDeg: (this.pitch * 180 / Math.PI).toFixed(1)
    };
  }

}
