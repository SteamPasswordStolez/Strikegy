import * as THREE from 'three';

/** Lasers drawn at most (nearest first is the caller's business), and how far a beam reaches. */
const MAX = 12;
const REACH = 45;
/** Beams from soldiers past this are not drawn. */
export const LASER_SEEN_M = 70;

export interface LaserSource {
  from: THREE.Vector3;
  dir: THREE.Vector3;
  kind: 'hip' | 'tac';
}

const COLOR = { hip: 0xff2a1a, tac: 0x49ff62 };

/**
 * The laser attachments' beams (progression step 4: "enemies see the laser"):
 * a faint thin line from the muzzle to whatever it meets within 45 m and a
 * bright dot there. One pool for the player's own gun, bots and other
 * players; filled each frame (`begin`, `add`, `end`).
 */
export class LaserBeams {
  readonly group = new THREE.Group();
  private readonly beams: THREE.Mesh[] = [];
  private readonly dots: THREE.Mesh[] = [];
  private used = 0;
  private readonly mats: Record<'hip' | 'tac', { beam: THREE.MeshBasicMaterial; dot: THREE.MeshBasicMaterial }>;

  constructor(private readonly cast: (from: THREE.Vector3, dir: THREE.Vector3, reach: number) => number | null) {
    const mk = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.mats = {
      hip: { beam: mk(COLOR.hip, 0.22), dot: mk(COLOR.hip, 0.95) },
      tac: { beam: mk(COLOR.tac, 0.2), dot: mk(COLOR.tac, 0.95) },
    };
    // A unit beam along -z, scaled to length; a small dot.
    const beamGeo = new THREE.BoxGeometry(0.0035, 0.0035, 1).translate(0, 0, -0.5);
    const dotGeo = new THREE.SphereGeometry(0.018, 8, 6);
    for (let i = 0; i < MAX; i++) {
      const b = new THREE.Mesh(beamGeo, this.mats.hip.beam);
      const d = new THREE.Mesh(dotGeo, this.mats.hip.dot);
      b.visible = d.visible = false;
      b.frustumCulled = d.frustumCulled = false;
      b.renderOrder = d.renderOrder = 5;
      this.beams.push(b);
      this.dots.push(d);
      this.group.add(b, d);
    }
  }

  begin(): void {
    this.used = 0;
  }

  add(s: LaserSource): void {
    if (this.used >= MAX) return;
    const i = this.used++;
    const b = this.beams[i]!;
    const d = this.dots[i]!;
    const hit = this.cast(s.from, s.dir, REACH);
    const len = hit ?? REACH;
    b.material = this.mats[s.kind].beam;
    d.material = this.mats[s.kind].dot;
    b.position.copy(s.from);
    b.lookAt(s.from.x + s.dir.x, s.from.y + s.dir.y, s.from.z + s.dir.z);
    // lookAt points +z at the target; the beam runs along -z.
    b.rotateY(Math.PI);
    b.scale.set(1, 1, len);
    b.visible = true;
    d.visible = hit !== null;
    if (hit !== null) d.position.copy(s.from).addScaledVector(s.dir, hit - 0.02);
  }

  end(): void {
    for (let i = this.used; i < MAX; i++) this.beams[i]!.visible = this.dots[i]!.visible = false;
  }
}
