import * as THREE from 'three';
import { LAYER_FX } from './layers';

/**
 * Friend-or-foe markers over aircraft (owner, 2026-10-02: "you can't tell
 * friendly from enemy jets, or a jet from the recon plane"): a diamond over
 * every jet, a ring over every recon plane, blue for the player's side, red
 * for the other. Friendly ones always show; enemy ones within a range that is
 * longer while the player is flying. Two point clouds, a draw call each.
 */
export const AIR_MARKERS = { friendly: 2500, enemyFlying: 2500, enemyOnFoot: 900, above: 4, max: 32 };

export interface AirMark {
  pos: THREE.Vector3;
  friendly: boolean;
  /** Recon plane (ring) rather than a jet (diamond). */
  recon: boolean;
}

const BLUE = new THREE.Color(0x5aa8ff);
const RED = new THREE.Color(0xff4a3a);

export class AirMarkers {
  readonly group = new THREE.Group();
  private readonly jets: THREE.Points;
  private readonly recons: THREE.Points;

  constructor() {
    this.jets = points(drawDiamond());
    this.recons = points(drawRing());
    this.group.add(this.jets, this.recons);
  }

  /** Places the markers for this frame; `flying`: the player is in an aircraft. */
  update(marks: readonly AirMark[], camera: THREE.Vector3, flying: boolean): void {
    const size = 0.026 * window.innerHeight;
    let nJ = 0;
    let nR = 0;
    for (const m of marks) {
      const range = m.friendly ? AIR_MARKERS.friendly : flying ? AIR_MARKERS.enemyFlying : AIR_MARKERS.enemyOnFoot;
      if (m.pos.distanceToSquared(camera) > range * range) continue;
      const pts = m.recon ? this.recons : this.jets;
      const i = m.recon ? nR++ : nJ++;
      if (i >= AIR_MARKERS.max) continue;
      (pts.geometry.getAttribute('position') as THREE.BufferAttribute).setXYZ(i, m.pos.x, m.pos.y + AIR_MARKERS.above, m.pos.z);
      const c = m.friendly ? BLUE : RED;
      (pts.geometry.getAttribute('color') as THREE.BufferAttribute).setXYZ(i, c.r, c.g, c.b);
    }
    for (const [pts, n] of [[this.jets, nJ], [this.recons, nR]] as const) {
      (pts.material as THREE.PointsMaterial).size = size;
      pts.geometry.setDrawRange(0, Math.min(n, AIR_MARKERS.max));
      pts.geometry.getAttribute('position').needsUpdate = true;
      pts.geometry.getAttribute('color').needsUpdate = true;
    }
  }
}

function points(map: THREE.Texture): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(AIR_MARKERS.max * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(AIR_MARKERS.max * 3), 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({ map, vertexColors: true, sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, alphaTest: 0.05 });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 10;
  pts.layers.set(LAYER_FX);
  return pts;
}

/** White shapes with a dark rim (tinted per point by the vertex colour). */
function canvas(draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(0,0,0,0.65)';
  g.fillStyle = '#ffffff';
  draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawDiamond(): THREE.Texture {
  return canvas((g) => {
    // A hollow diamond: the plane stays visible inside it.
    const path = (r: number) => {
      g.beginPath();
      g.moveTo(32, 32 - r);
      g.lineTo(32 + r, 32);
      g.lineTo(32, 32 + r);
      g.lineTo(32 - r, 32);
      g.closePath();
    };
    g.lineWidth = 11;
    path(22);
    g.stroke();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    path(22);
    g.stroke();
  });
}

function drawRing(): THREE.Texture {
  return canvas((g) => {
    g.lineWidth = 10;
    g.beginPath();
    g.arc(32, 32, 18, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 5;
    g.stroke();
    // A dot in the middle tells it apart from the jets' diamond at a glance.
    g.beginPath();
    g.arc(32, 32, 4, 0, Math.PI * 2);
    g.fill();
  });
}
