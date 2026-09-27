import * as THREE from 'three';

const STEP = 1 / 60;

/**
 * Where a thrown body lands (first time it comes down through `groundY`),
 * integrated like Rapier does: gravity, then linear damping per step.
 */
export function landing(from: THREE.Vector3, vel: THREE.Vector3, groundY: number, gravity = 9.81, damping = 0.4): THREE.Vector3 {
  const p = from.clone();
  const v = vel.clone();
  const damp = 1 / (1 + STEP * damping);
  for (let i = 0; i < 600; i++) {
    v.y -= gravity * STEP;
    v.multiplyScalar(damp);
    p.addScaledVector(v, STEP);
    if (v.y < 0 && p.y <= groundY) return p;
  }
  return p;
}

/**
 * Launch velocity to lob something from `from` onto `to` at `angleDeg` above
 * the horizontal (steeper arcs clear cover), found by bisecting the speed.
 * Returns null if it can't get there within `maxSpeed`.
 */
export function lobVelocity(
  from: THREE.Vector3,
  to: THREE.Vector3,
  angleDeg = 40,
  maxSpeed = 24,
  gravity = 9.81,
  damping = 0.4,
): THREE.Vector3 | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.5) return new THREE.Vector3(0, 2, 0);
  const a = (angleDeg * Math.PI) / 180;
  const dir = new THREE.Vector3((dx / dist) * Math.cos(a), Math.sin(a), (dz / dist) * Math.cos(a));
  const reach = (speed: number) => {
    const p = landing(from, dir.clone().multiplyScalar(speed), to.y, gravity, damping);
    return Math.hypot(p.x - from.x, p.z - from.z);
  };
  if (reach(maxSpeed) < dist) return null;
  let lo = 0;
  let hi = maxSpeed;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (reach(mid) < dist) lo = mid;
    else hi = mid;
  }
  return dir.multiplyScalar((lo + hi) / 2);
}
