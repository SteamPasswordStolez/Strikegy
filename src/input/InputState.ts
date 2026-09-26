/**
 * Device-agnostic input snapshot. Keyboard/mouse and touch both write into
 * this; gameplay code only ever reads it.
 */
export interface InputState {
  /** Strafe axis, -1 (left) .. 1 (right). */
  moveX: number;
  /** Forward axis, -1 (back) .. 1 (forward). */
  moveY: number;
  /** Accumulated look delta in radians since last consume (already sensitivity-scaled). */
  lookYaw: number;
  lookPitch: number;
  fire: boolean;
  /** Pulse: trigger went down since the last sim step (catches taps shorter than a frame). */
  firePressed: boolean;
  ads: boolean;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
  reload: boolean;
  /** Pulse: -1 / +1 to cycle weapons, 0 = none. */
  weaponCycle: number;
  /** Pulse: select loadout slot (0-based), or -1. */
  weaponSlot: number;
  /** Pulse: throw the selected grenade. */
  throwGrenade: boolean;
  /** Pulse: select the next grenade type. */
  cycleGrenade: boolean;
}

export function createInputState(): InputState {
  return {
    moveX: 0,
    moveY: 0,
    lookYaw: 0,
    lookPitch: 0,
    fire: false,
    firePressed: false,
    ads: false,
    sprint: false,
    crouch: false,
    jump: false,
    reload: false,
    weaponCycle: 0,
    weaponSlot: -1,
    throwGrenade: false,
    cycleGrenade: false,
  };
}

/** Clears one-shot pulses after a simulation step has consumed them. */
export function consumePulses(s: InputState): void {
  s.jump = false;
  s.firePressed = false;
  s.reload = false;
  s.weaponCycle = 0;
  s.weaponSlot = -1;
  s.throwGrenade = false;
  s.cycleGrenade = false;
}

export function resetFrameInput(s: InputState): void {
  s.moveX = 0;
  s.moveY = 0;
  s.fire = false;
  s.ads = false;
  s.sprint = false;
  s.crouch = false;
}

export interface InputSource {
  /** Writes this device's contribution into the shared state for the current frame. */
  apply(state: InputState): void;
  dispose(): void;
}
