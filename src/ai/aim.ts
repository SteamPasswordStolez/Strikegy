/** Pure aiming helpers for bots (angles in radians unless noted). */

const TAU = Math.PI * 2;

/** Wraps an angle to [-PI, PI). */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Yaw (0 = -Z, like the player) and pitch from a direction. */
export function yawPitchOf(dx: number, dy: number, dz: number): [yaw: number, pitch: number] {
  const flat = Math.hypot(dx, dz);
  return [Math.atan2(-dx, -dz), Math.atan2(dy, flat)];
}

/** Moves `current` toward `target` by at most `maxStep` (shortest way around). */
export function turnToward(current: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/**
 * Aim error cone (degrees) after tracking a target for `tracked` seconds:
 * starts wide and eases down to a floor, like a person settling their aim.
 */
export function aimErrorDeg(start: number, floor: number, settle: number, tracked: number): number {
  const t = Math.min(1, Math.max(0, tracked) / settle);
  return floor + (start - floor) * (1 - t) * (1 - t);
}

/**
 * Seconds a bot needs to notice an enemy: slower at range and toward the edge
 * of its view, faster when the enemy is shooting.
 */
export function noticeTime(reaction: number, distance: number, offAxisDeg: number, halfFovDeg: number, firing: boolean): number {
  const range = 1 + Math.min(1.5, distance / 40);
  const edge = 1 + 1.5 * Math.min(1, Math.max(0, offAxisDeg) / Math.max(1, halfFovDeg)) ** 2;
  return reaction * range * edge * (firing ? 0.6 : 1);
}

/** Angle (degrees) between a facing yaw and the direction to a point. */
export function offAxisDeg(yaw: number, dx: number, dz: number): number {
  const [toYaw] = yawPitchOf(dx, 0, dz);
  return (Math.abs(wrapAngle(toYaw - yaw)) * 180) / Math.PI;
}
