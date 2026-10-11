import * as THREE from 'three';

/** What the menu's battle camera needs to know about the match behind it. */
export interface ShowcaseScene {
  zones: readonly { x: number; y: number; z: number; radius: number }[];
  /** Soldiers on foot, alive: where, which way they face, whether they are fighting. */
  actors(): readonly { id: number; pos: THREE.Vector3; yaw: number; fighting: boolean }[];
  /** Ground height under x, z (null off the map). */
  ground(x: number, z: number): number | null;
  /** Nothing solid between the two points. */
  clear(from: THREE.Vector3, to: THREE.Vector3): boolean;
}

type Shot =
  | { kind: 'orbit'; center: THREE.Vector3; a: number; spin: number; r: number; h: number }
  | { kind: 'follow'; id: number; side: number };

/** Shot lengths, s. */
const ORBIT_LEN = [11, 15] as const;
const FOLLOW_LEN = [7, 10] as const;

const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

/**
 * The main menu's camera over a bot match: slow orbits high over a zone
 * and low shots trailing a soldier in a fight, cut every ten seconds or so
 * (a trailed soldier who falls ends the shot). Never inside a wall: a shot
 * that can't see its subject from where it would stand is not picked.
 */
export class ShowcaseCamera {
  private shot: Shot | null = null;
  private left = 0;
  private count = 0;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private readonly wantLook = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly scene: ShowcaseScene) {}

  update(dt: number, cam: THREE.PerspectiveCamera): void {
    this.left -= dt;
    const follow = this.shot?.kind === 'follow' ? this.scene.actors().find((a) => a.id === (this.shot as { id: number }).id) : null;
    const cut = !this.shot || this.left <= 0 || (this.shot.kind === 'follow' && !follow);
    if (cut) this.pick();
    const s = this.shot!;
    if (s.kind === 'orbit') {
      s.a += s.spin * dt;
      this.want.set(s.center.x + Math.cos(s.a) * s.r, s.center.y + s.h, s.center.z + Math.sin(s.a) * s.r);
      this.wantLook.copy(s.center).setY(s.center.y + 2);
    } else {
      const a = this.scene.actors().find((x) => x.id === s.id);
      if (a) this.trail(a, s.side, this.want, this.wantLook);
    }
    if (cut) {
      this.pos.copy(this.want);
      this.look.copy(this.wantLook);
    } else {
      // Orbits move on rails; a trailed soldier is followed softly (no jitter from their steps).
      const k = s.kind === 'orbit' ? 1 : 1 - Math.exp(-2.5 * dt);
      this.pos.lerp(this.want, k);
      this.look.lerp(this.wantLook, 1 - Math.exp(-4 * dt));
    }
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - 58) > 0.01) {
      cam.fov = 58;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /** Behind and beside a soldier, a little above the head. */
  private trail(a: { pos: THREE.Vector3; yaw: number }, side: number, out: THREE.Vector3, look: THREE.Vector3): void {
    const fx = -Math.sin(a.yaw);
    const fz = -Math.cos(a.yaw);
    look.set(a.pos.x + fx * 8, a.pos.y + 1.4, a.pos.z + fz * 8);
    out.set(a.pos.x - fx * 5.5 + fz * side * 1.6, a.pos.y + 2.3, a.pos.z - fz * 5.5 - fx * side * 1.6);
    const g = this.scene.ground(out.x, out.z);
    if (g !== null) out.y = Math.max(out.y, g + 1.2);
  }

  private pick(): void {
    this.count++;
    const actors = this.scene.actors();
    const fighting = actors.filter((a) => a.fighting);
    // Every other shot trails someone (in a fight if anyone is), the first one is a wide orbit.
    if (this.count > 1 && this.count % 2 === 0) {
      const pool = fighting.length ? fighting : actors;
      for (let i = 0; i < 6 && pool.length; i++) {
        const a = pool[Math.floor(Math.random() * pool.length)]!;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.trail(a, side, this.tmp, this.wantLook);
        if (!this.scene.clear(a.pos.clone().setY(a.pos.y + 1.6), this.tmp)) continue;
        this.shot = { kind: 'follow', id: a.id, side };
        this.left = rand(...FOLLOW_LEN);
        return;
      }
    }
    const zones = this.scene.zones;
    // Orbit the zone with the most fighting near it (or any zone).
    let center: THREE.Vector3;
    if (zones.length) {
      const near = (z: { x: number; z: number; radius: number }) => fighting.filter((a) => Math.hypot(a.pos.x - z.x, a.pos.z - z.z) < z.radius + 40).length;
      const ranked = [...zones].sort((p, q) => near(q) - near(p) + (Math.random() - 0.5) * 2);
      const z = ranked[0]!;
      center = new THREE.Vector3(z.x, z.y, z.z);
    } else center = actors[0]?.pos.clone() ?? new THREE.Vector3();
    const r = rand(38, 62);
    const h = rand(14, 26);
    const start = Math.random() * Math.PI * 2;
    const eye = center.clone().setY(center.y + 2);
    for (let i = 0; i < 8; i++) {
      const a = start + (i * Math.PI) / 4;
      this.tmp.set(center.x + Math.cos(a) * r, center.y + h, center.z + Math.sin(a) * r);
      const g = this.scene.ground(this.tmp.x, this.tmp.z);
      if (g !== null && g > this.tmp.y - 6) continue;
      if (!this.scene.clear(eye, this.tmp)) continue;
      this.shot = { kind: 'orbit', center, a, spin: (Math.random() < 0.5 ? -1 : 1) * rand(0.04, 0.07), r, h };
      this.left = rand(...ORBIT_LEN);
      return;
    }
    // Nothing clear at that height: straight above.
    this.shot = { kind: 'orbit', center, a: start, spin: 0.05, r: 20, h: 45 };
    this.left = rand(...ORBIT_LEN);
  }
}
