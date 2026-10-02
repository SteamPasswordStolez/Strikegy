import * as THREE from 'three';
import { LAYER_FX } from '@/render/layers';
import type { Team } from '@/world/mapTypes';
import type { ZoneState } from './zoneRules';

const COLORS: Record<Team | 'neutral', number> = { blue: 0x4d8cff, red: 0xe0473a, neutral: 0xd8d8d0 };
const POLE_H = 7;

interface Marker {
  zone: ZoneState;
  ring: THREE.Mesh;
  flag: THREE.Mesh;
  label: THREE.Sprite;
  labelCanvas: HTMLCanvasElement;
  key: string;
}

/**
 * World markers for zones: a ring on the ground following the terrain, a
 * flagpole whose flag takes the owner's color and height the capture
 * progress, and a letter floating above (visible through walls).
 */
export class ZoneVisuals {
  private readonly markers: Marker[] = [];
  private readonly group = new THREE.Group();

  constructor(scene: THREE.Scene, zones: readonly ZoneState[], groundAt: (x: number, z: number) => number) {
    this.group.name = 'zones';
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x9a9a96, metalness: 0.6, roughness: 0.4 });
    for (const zone of zones) {
      const ring = ringMesh(zone, groundAt);
      const base = groundAt(zone.x, zone.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, POLE_H, 8), poleMat);
      pole.position.set(zone.x, base + POLE_H / 2, zone.z);
      pole.castShadow = true;
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 1).translate(0.8, 0, 0),
        new THREE.MeshStandardMaterial({ color: COLORS.neutral, side: THREE.DoubleSide, roughness: 0.9 }),
      );
      flag.position.set(zone.x + 0.08, base + 1.2, zone.z);
      flag.userData.base = base;
      const labelCanvas = document.createElement('canvas');
      labelCanvas.width = labelCanvas.height = 64;
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(labelCanvas), depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false }),
      );
      label.scale.set(0.035, 0.035, 1);
      label.position.set(zone.x, base + POLE_H + 2.5, zone.z);
      label.renderOrder = 11;
      label.layers.set(LAYER_FX);
      this.group.add(ring, pole, flag, label);
      this.markers.push({ zone, ring, flag, label, labelCanvas, key: '' });
    }
    scene.add(this.group);
  }

  /** Refreshes colors and flag heights (cheap when nothing changed). */
  update(time: number, viewer: THREE.Vector3): void {
    for (const m of this.markers) {
      const z = m.zone;
      const progress = Math.abs(z.control);
      // The flag rises with control; neutral zones fly a pale flag at the bottom.
      const leaning: Team | null = z.control > 0.001 ? 'blue' : z.control < -0.001 ? 'red' : null;
      const colorTeam = z.owner ?? leaning;
      const key = `${z.owner}|${leaning}|${Math.round(progress * 40)}|${z.contested}`;
      if (key !== m.key) {
        m.key = key;
        m.flag.position.y = (m.flag.userData.base as number) + 1.2 + (POLE_H - 2) * progress;
        (m.flag.material as THREE.MeshStandardMaterial).color.setHex(colorTeam ? COLORS[colorTeam] : COLORS.neutral);
        (m.ring.material as THREE.MeshBasicMaterial).color.setHex(z.owner ? COLORS[z.owner] : COLORS.neutral);
        drawLabel(m.labelCanvas, z.id, z.owner ? COLORS[z.owner] : COLORS.neutral, z.contested);
        ((m.label.material as THREE.SpriteMaterial).map as THREE.CanvasTexture).needsUpdate = true;
      }
      // Flutter.
      m.flag.rotation.y = Math.sin(time * 2.1 + z.x) * 0.25;
      // Ring pulses while the zone is being taken.
      const mat = m.ring.material as THREE.MeshBasicMaterial;
      mat.opacity = z.pushing ? 0.45 + 0.25 * Math.sin(time * 6) : 0.4;
      // Labels of zones far away shrink a little so close ones stand out.
      const d = Math.hypot(viewer.x - z.x, viewer.z - z.z);
      const s = d < 30 ? 0.06 : 0.048;
      m.label.scale.set(s, s, 1);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

function ringMesh(zone: ZoneState, groundAt: (x: number, z: number) => number): THREE.Mesh {
  // About a segment per metre and a half so the ring keeps to the ground on big zones;
  // wider on big zones so it still reads from the far side.
  const seg = Math.max(96, Math.ceil((Math.PI * 2 * zone.radius) / 1.5));
  const inner = zone.radius - Math.max(0.35, zone.radius * 0.012);
  const outer = zone.radius;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    for (const r of [inner, outer]) {
      const x = zone.x + Math.cos(a) * r;
      const z = zone.z + Math.sin(a) * r;
      pos.push(x, groundAt(x, z) + 0.12, z);
    }
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: COLORS.neutral, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  );
  mesh.renderOrder = 2;
  return mesh;
}

function drawLabel(c: HTMLCanvasElement, id: string, color: number, contested: boolean): void {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fillStyle = 'rgba(10,12,14,0.55)';
  g.fill();
  g.lineWidth = contested ? 5 : 4;
  g.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.stroke();
  g.fillStyle = g.strokeStyle;
  g.font = 'bold 30px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(id, 32, 34);
}
