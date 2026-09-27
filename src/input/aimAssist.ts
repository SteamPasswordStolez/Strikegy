/**
 * Light aim assist for touch screens (thumbs can't aim like a mouse):
 * - friction: look input slows down while the crosshair is on or near an enemy;
 * - magnetism: while aiming down sights or firing, the view drifts toward
 *   that enemy a little each frame (never a snap).
 * Angles in radians. Pure, so it can be tested and tuned in isolation.
 */

const DEG = Math.PI / 180;

export interface AssistTarget {
  /** Angle from the current aim to the target (yaw: + = to the left, like applyLook). */
  yaw: number;
  pitch: number;
  /** Meters. */
  distance: number;
}

export interface AssistOptions {
  ads: boolean;
  firing: boolean;
  dt: number;
}

/** Widest cone (degrees) in which a target is considered at all. */
export const ASSIST_CONE_DEG = 8;

/** Radius of the "sticky" zone around a target at this distance (radians): about a body width plus a margin. */
function stickyRadius(distance: number): number {
  return Math.atan2(0.9, Math.max(2, distance)) + 1.5 * DEG;
}

export function applyAimAssist(lookYaw: number, lookPitch: number, target: AssistTarget | null, o: AssistOptions): [number, number] {
  if (!target) return [lookYaw, lookPitch];
  const off = Math.hypot(target.yaw, target.pitch);
  if (off > ASSIST_CONE_DEG * DEG) return [lookYaw, lookPitch];
  const sticky = stickyRadius(target.distance);
  let yaw = lookYaw;
  let pitch = lookPitch;
  // Friction: full inside the sticky zone, fading out to the edge of the cone.
  const near = off <= sticky ? 1 : Math.max(0, 1 - (off - sticky) / (ASSIST_CONE_DEG * DEG - sticky));
  const slow = 1 - near * (o.ads ? 0.55 : 0.4);
  yaw *= slow;
  pitch *= slow;
  // Magnetism: only while aiming or shooting, and only near the target.
  if ((o.ads || o.firing) && off < sticky * 2.5) {
    const rate = o.ads ? 3 : 1.5; // fraction of the offset closed per second
    const k = Math.min(1, rate * o.dt);
    const max = 2 * DEG * Math.min(1, o.dt * 60);
    yaw += Math.max(-max, Math.min(max, target.yaw * k));
    pitch += Math.max(-max, Math.min(max, target.pitch * k));
  }
  return [yaw, pitch];
}
