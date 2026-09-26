/** Movement tuning in meters / seconds. */
export const MOVE = {
  walkSpeed: 4.6,
  sprintSpeed: 6.8,
  crouchSpeed: 2.4,
  adsSpeed: 3.0,
  groundAccel: 85,
  /** Braking when input is released or reversed: stops in ~50 ms from a walk. */
  groundDecel: 110,
  airAccel: 14,
  /** Jump pressed this long before landing still counts. */
  jumpBuffer: 0.12,
  /** Jump still allowed this long after walking off a ledge. */
  coyoteTime: 0.1,
  jumpVelocity: 5.4,
  gravity: 18,
  maxFallSpeed: 40,
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.15,
  /** Eye distance below the top of the capsule. */
  eyeInset: 0.14,
  crouchTransitionSpeed: 8,
} as const;

export interface MoveIntent {
  moveX: number;
  moveY: number;
  sprint: boolean;
  crouching: boolean;
  ads: boolean;
}

export function targetSpeed(i: MoveIntent): number {
  if (i.crouching) return MOVE.crouchSpeed;
  if (i.ads) return MOVE.adsSpeed;
  // Sprinting only makes sense while pushing forward.
  if (i.sprint && i.moveY > 0.5) return MOVE.sprintSpeed;
  return MOVE.walkSpeed;
}

/** Wish direction in world XZ for a yaw where yaw = 0 faces -Z. Length <= 1. */
export function wishDirection(moveX: number, moveY: number, yaw: number): [number, number] {
  let x = moveX;
  let y = moveY;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  return [x * cos - y * sin, -x * sin - y * cos];
}

/** Moves (vx, vz) toward (tx, tz) by at most accel * dt. */
export function approachVelocity(
  vx: number,
  vz: number,
  tx: number,
  tz: number,
  accel: number,
  dt: number,
): [number, number] {
  const dx = tx - vx;
  const dz = tz - vz;
  const dist = Math.hypot(dx, dz);
  const maxStep = accel * dt;
  if (dist <= maxStep || dist === 0) return [tx, tz];
  return [vx + (dx / dist) * maxStep, vz + (dz / dist) * maxStep];
}

export function capsuleHalfHeight(totalHeight: number): number {
  return Math.max(0.05, (totalHeight - MOVE.radius * 2) / 2);
}
